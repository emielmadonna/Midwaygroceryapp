const XERO_IDENTITY = 'https://identity.xero.com/connect';
const XERO_API_BASE = 'https://api.xero.com/api.xro/2.0';
const XERO_CONNECTIONS_URL = 'https://api.xero.com/connections';

const DEFAULT_SCOPES = [
  'accounting.transactions',
  'accounting.contacts',
  'accounting.settings.read',
  'offline_access',
];

export function xeroProviderConfigFromEnv(env = process.env) {
  return {
    clientId: readEnv(env, 'XERO_CLIENT_ID'),
    clientSecret: readEnv(env, 'XERO_CLIENT_SECRET'),
    redirectUri: readEnv(env, 'XERO_REDIRECT_URI') || '',
    scopes: (readEnv(env, 'XERO_SCOPES') || DEFAULT_SCOPES.join(' ')).split(/[\s,]+/).filter(Boolean),
  };
}

export function buildXeroAuthUrl({ clientId, scopes = DEFAULT_SCOPES, redirectUri, state }) {
  if (!clientId) throw new Error('XERO_CLIENT_ID is required.');
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: scopes.join(' '),
    state,
  });
  return `${XERO_IDENTITY}/authorize?${params.toString()}`;
}

export async function exchangeXeroCode({ code, clientId, clientSecret, redirectUri, fetchImpl = globalThis.fetch }) {
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
  });
  const response = await fetchImpl(`${XERO_IDENTITY}/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth(clientId, clientSecret)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) {
    throw xeroError('XERO_OAUTH_FAILED', data?.error || 'Xero token exchange failed', data);
  }
  return parseTokenResponse(data);
}

export async function refreshXeroToken({ refreshToken, clientId, clientSecret, fetchImpl = globalThis.fetch }) {
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
  const response = await fetchImpl(`${XERO_IDENTITY}/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth(clientId, clientSecret)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) {
    throw xeroError('XERO_REFRESH_FAILED', data?.error || 'Xero refresh failed', data);
  }
  return parseTokenResponse(data);
}

export async function listXeroConnections({ accessToken, fetchImpl = globalThis.fetch }) {
  const response = await fetchImpl(XERO_CONNECTIONS_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    const errorBody = await safeJson(response);
    throw xeroError('XERO_CONNECTIONS_FAILED', 'Could not list Xero connections', errorBody);
  }
  return response.json();
}

export async function xeroRequest({
  accessToken,
  tenantId,
  method = 'GET',
  path,
  query = null,
  body = null,
  fetchImpl = globalThis.fetch,
}) {
  if (!accessToken) throw xeroError('XERO_NOT_CONNECTED', 'Xero is not connected.');
  if (!tenantId) throw xeroError('XERO_TENANT_REQUIRED', 'Xero tenant id is required.');
  const url = new URL(`${XERO_API_BASE}${path.startsWith('/') ? path : `/${path}`}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue;
      url.searchParams.set(key, String(value));
    }
  }
  const response = await fetchImpl(url.toString(), {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Xero-Tenant-Id': tenantId,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await safeJson(response);
  if (!response.ok) {
    throw xeroError('XERO_REQUEST_FAILED', `Xero ${method} ${path} failed (${response.status})`, data);
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
    tokenType: data.token_type,
    scope: data.scope,
    idToken: data.id_token,
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

function xeroError(code, message, data = null) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = code === 'XERO_NOT_CONNECTED' ? 503 : 502;
  if (data) error.data = data;
  return error;
}

function readEnv(env, name) {
  const value = env[name];
  return typeof value === 'string' ? value.trim() : value;
}
