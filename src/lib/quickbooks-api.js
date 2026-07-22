const QBO_AUTHORIZE_URL = 'https://appcenter.intuit.com/connect/oauth2';
const QBO_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const QBO_API_BASE_PRODUCTION = 'https://quickbooks.api.intuit.com';
const QBO_API_BASE_SANDBOX = 'https://sandbox-quickbooks.api.intuit.com';
const QBO_MINOR_VERSION = '75';

const DEFAULT_SCOPES = [
  'com.intuit.quickbooks.accounting',
];

export function quickbooksProviderConfigFromEnv(env = process.env) {
  const environment = (readEnv(env, 'QUICKBOOKS_ENVIRONMENT') || 'production').toLowerCase();
  return {
    clientId: readEnv(env, 'QUICKBOOKS_CLIENT_ID'),
    clientSecret: readEnv(env, 'QUICKBOOKS_CLIENT_SECRET'),
    redirectUri: readEnv(env, 'QUICKBOOKS_REDIRECT_URI') || '',
    environment: environment === 'sandbox' ? 'sandbox' : 'production',
    scopes: (readEnv(env, 'QUICKBOOKS_SCOPES') || DEFAULT_SCOPES.join(' ')).split(/[\s,]+/).filter(Boolean),
  };
}

export function buildQuickBooksAuthUrl({ clientId, scopes = DEFAULT_SCOPES, redirectUri, state }) {
  if (!clientId) throw new Error('QUICKBOOKS_CLIENT_ID is required.');
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    scope: scopes.join(' '),
    redirect_uri: redirectUri,
    state,
  });
  return `${QBO_AUTHORIZE_URL}?${params.toString()}`;
}

export async function exchangeQuickBooksCode({ code, redirectUri, clientId, clientSecret, fetchImpl = globalThis.fetch }) {
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
  });
  const response = await fetchImpl(QBO_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth(clientId, clientSecret)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: params.toString(),
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) {
    throw quickbooksError('QUICKBOOKS_OAUTH_FAILED', data?.error || 'QuickBooks token exchange failed', data);
  }
  return parseTokenResponse(data);
}

export async function refreshQuickBooksToken({ refreshToken, clientId, clientSecret, fetchImpl = globalThis.fetch }) {
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
  const response = await fetchImpl(QBO_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth(clientId, clientSecret)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: params.toString(),
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) {
    throw quickbooksError('QUICKBOOKS_REFRESH_FAILED', data?.error || 'QuickBooks refresh failed', data);
  }
  return parseTokenResponse(data);
}

export async function quickbooksRequest({
  accessToken,
  realmId,
  method = 'GET',
  path,
  query = null,
  body = null,
  environment = 'production',
  fetchImpl = globalThis.fetch,
}) {
  if (!accessToken) throw quickbooksError('QUICKBOOKS_NOT_CONNECTED', 'QuickBooks is not connected.');
  if (!realmId) throw quickbooksError('QUICKBOOKS_REALM_REQUIRED', 'QuickBooks company (realm) id is required.');
  const base = environment === 'sandbox' ? QBO_API_BASE_SANDBOX : QBO_API_BASE_PRODUCTION;
  const url = new URL(`${base}/v3/company/${encodeURIComponent(realmId)}${path.startsWith('/') ? path : `/${path}`}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue;
      url.searchParams.set(key, String(value));
    }
  }
  url.searchParams.set('minorversion', QBO_MINOR_VERSION);
  const response = await fetchImpl(url.toString(), {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await safeJson(response);
  if (!response.ok) {
    throw quickbooksError('QUICKBOOKS_REQUEST_FAILED', `QuickBooks ${method} ${path} failed (${response.status})`, data);
  }
  return data;
}

export function tokenExpiresAtIso(token) {
  if (!token?.expiresIn) return null;
  const ms = Number(token.expiresIn) * 1000;
  if (!Number.isFinite(ms)) return null;
  return new Date(Date.now() + ms - 60_000).toISOString();
}

function parseTokenResponse(data) {
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
    refreshTokenExpiresIn: data.x_refresh_token_expires_in,
    tokenType: data.token_type,
    scope: data.scope,
    raw: data,
  };
}

function basicAuth(clientId, clientSecret) {
  return Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function quickbooksError(code, message, data = null) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = code === 'QUICKBOOKS_NOT_CONNECTED' ? 503 : 502;
  if (data) error.data = data;
  return error;
}

function readEnv(env, name) {
  const value = env[name];
  return typeof value === 'string' ? value.trim() : value;
}
