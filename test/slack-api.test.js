import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import {
  buildSlackInstallUrl,
  exchangeSlackOAuthCode,
  postSlackMessage,
  slackProviderConfigFromEnv,
  verifySlackSignature,
} from '../src/lib/slack-api.js';

test('slackProviderConfigFromEnv reads env with defaults', () => {
  const config = slackProviderConfigFromEnv({
    SLACK_CLIENT_ID: 'a.b',
    SLACK_CLIENT_SECRET: 'secret',
    SLACK_SIGNING_SECRET: 'sign',
  });
  assert.equal(config.clientId, 'a.b');
  assert.equal(config.clientSecret, 'secret');
  assert.equal(config.signingSecret, 'sign');
  assert.ok(config.botScopes.includes('chat:write'));
  assert.ok(config.botScopes.includes('app_mentions:read'));
});

test('buildSlackInstallUrl includes client id, scopes, redirect, state', () => {
  const url = new URL(buildSlackInstallUrl({
    clientId: 'cid',
    scopes: ['chat:write', 'app_mentions:read'],
    redirectUri: 'https://example.com/cb',
    state: 'st',
  }));
  assert.equal(url.searchParams.get('client_id'), 'cid');
  assert.equal(url.searchParams.get('scope'), 'chat:write,app_mentions:read');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://example.com/cb');
  assert.equal(url.searchParams.get('state'), 'st');
});

test('verifySlackSignature accepts a valid signature and rejects tampered ones', () => {
  const signingSecret = 'shhh';
  const body = JSON.stringify({ type: 'event_callback' });
  const timestamp = Math.floor(Date.now() / 1000);
  const base = `v0:${timestamp}:${body}`;
  const signature = `v0=${crypto.createHmac('sha256', signingSecret).update(base).digest('hex')}`;

  assert.equal(verifySlackSignature({ signingSecret, body, signature, timestamp }), true);
  assert.equal(verifySlackSignature({ signingSecret, body: body + 'x', signature, timestamp }), false);
  assert.equal(verifySlackSignature({ signingSecret, body, signature: 'v0=ffff', timestamp }), false);
  assert.equal(verifySlackSignature({ signingSecret, body, signature, timestamp: timestamp - 99999 }), false);
});

test('exchangeSlackOAuthCode parses the OAuth payload', async () => {
  const fakeFetch = async (url, options) => ({
    async json() {
      return {
        ok: true,
        access_token: 'xoxb-bot',
        bot_user_id: 'U_BOT',
        app_id: 'A_APP',
        scope: 'chat:write,app_mentions:read',
        team: { id: 'T_ID', name: 'Midway' },
        authed_user: { id: 'U_USER' },
      };
    },
  });
  const exchange = await exchangeSlackOAuthCode({
    code: 'code',
    clientId: 'cid',
    clientSecret: 'csec',
    redirectUri: 'https://x/cb',
    fetchImpl: fakeFetch,
  });
  assert.equal(exchange.accessToken, 'xoxb-bot');
  assert.equal(exchange.botUserId, 'U_BOT');
  assert.equal(exchange.teamId, 'T_ID');
  assert.equal(exchange.teamName, 'Midway');
});

test('exchangeSlackOAuthCode throws on Slack error response', async () => {
  const fakeFetch = async () => ({ async json() { return { ok: false, error: 'invalid_code' }; } });
  await assert.rejects(
    exchangeSlackOAuthCode({ code: 'bad', clientId: 'c', clientSecret: 's', redirectUri: 'r', fetchImpl: fakeFetch }),
    /invalid_code/,
  );
});

test('postSlackMessage posts with bearer token and thread_ts when supplied', async () => {
  const sent = {};
  const fakeFetch = async (url, options) => {
    sent.url = url;
    sent.body = JSON.parse(options.body);
    sent.headers = options.headers;
    return { async json() { return { ok: true, ts: '123' }; } };
  };
  await postSlackMessage({ token: 'xoxb', channel: 'C1', text: 'hi', threadTs: '999', fetchImpl: fakeFetch });
  assert.equal(sent.url, 'https://slack.com/api/chat.postMessage');
  assert.equal(sent.body.channel, 'C1');
  assert.equal(sent.body.text, 'hi');
  assert.equal(sent.body.thread_ts, '999');
  assert.equal(sent.headers.Authorization, 'Bearer xoxb');
});
