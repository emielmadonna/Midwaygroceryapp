import crypto from 'node:crypto';

const SLACK_BASE = 'https://slack.com/api';
const SIGNATURE_VERSION = 'v0';
const SIGNATURE_MAX_AGE_SECONDS = 60 * 5;

export function slackProviderConfigFromEnv(env = process.env) {
  return {
    clientId: readEnv(env, 'SLACK_CLIENT_ID'),
    clientSecret: readEnv(env, 'SLACK_CLIENT_SECRET'),
    signingSecret: readEnv(env, 'SLACK_SIGNING_SECRET'),
    botScopes: (readEnv(env, 'SLACK_BOT_SCOPES') || 'app_mentions:read,chat:write,im:history,im:read,im:write').split(',').map(s => s.trim()).filter(Boolean),
    redirectUri: readEnv(env, 'SLACK_REDIRECT_URI') || '',
  };
}

export function buildSlackInstallUrl({ clientId, scopes = [], redirectUri, state }) {
  if (!clientId) throw new Error('SLACK_CLIENT_ID is required.');
  const params = new URLSearchParams({
    client_id: clientId,
    scope: scopes.join(','),
    redirect_uri: redirectUri,
    state,
  });
  return `https://slack.com/oauth/v2/authorize?${params.toString()}`;
}

export async function exchangeSlackOAuthCode({ code, clientId, clientSecret, redirectUri, fetchImpl = globalThis.fetch }) {
  const params = new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri });
  const response = await fetchImpl(`${SLACK_BASE}/oauth.v2.access`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  const data = await response.json();
  if (!data.ok) {
    throw createSlackError(data.error || 'oauth_failed', data);
  }
  return {
    accessToken: data.access_token,
    botUserId: data.bot_user_id,
    appId: data.app_id,
    scope: data.scope,
    teamId: data.team?.id,
    teamName: data.team?.name,
    authedUserId: data.authed_user?.id,
    enterpriseId: data.enterprise?.id ?? null,
    raw: data,
  };
}

export async function postSlackMessage({ token, channel, text, threadTs = null, blocks = null, fetchImpl = globalThis.fetch }) {
  if (!token) throw new Error('Slack access token is required.');
  const body = {
    channel,
    text,
  };
  if (threadTs) body.thread_ts = threadTs;
  if (blocks) body.blocks = blocks;
  const response = await fetchImpl(`${SLACK_BASE}/chat.postMessage`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!data.ok) {
    throw createSlackError(data.error || 'post_failed', data);
  }
  return data;
}

export function verifySlackSignature({ signingSecret, body, signature, timestamp, now = Math.floor(Date.now() / 1000) }) {
  if (!signingSecret) throw new Error('Slack signing secret is required.');
  if (!signature || !timestamp) return false;
  const ageSeconds = Math.abs(now - Number(timestamp));
  if (!Number.isFinite(ageSeconds) || ageSeconds > SIGNATURE_MAX_AGE_SECONDS) return false;
  const base = `${SIGNATURE_VERSION}:${timestamp}:${body}`;
  const expected = `${SIGNATURE_VERSION}=${crypto.createHmac('sha256', signingSecret).update(base).digest('hex')}`;
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signature);
  if (expectedBuffer.length !== actualBuffer.length) return false;
  return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

function createSlackError(code, data) {
  const error = new Error(`Slack error: ${code}`);
  error.code = `SLACK_${String(code).toUpperCase()}`;
  error.statusCode = 502;
  error.data = data;
  return error;
}

function readEnv(env, name) {
  const value = env[name];
  return typeof value === 'string' ? value.trim() : value;
}
