const DEFAULT_GRAPH_API_VERSION = 'v24.0';
const DEFAULT_MEDIA_FIELDS = [
  'id',
  'caption',
  'media_type',
  'media_url',
  'thumbnail_url',
  'permalink',
  'timestamp',
  'username',
].join(',');

export async function fetchInstagramFeed({
  config = {},
  limit = 6,
  fetchImpl = globalThis.fetch,
} = {}) {
  const accessToken = readConfig(config, 'accessToken');
  const instagramUserId = readConfig(config, 'instagramUserId')
    || readConfig(config, 'userId')
    || readConfig(config, 'igUserId')
    || readConfig(config, 'externalAccountId')
    || readConfig(config, 'externalLocationId');
  if (!accessToken) throw new Error('Instagram access token is required.');
  if (!instagramUserId) throw new Error('Instagram user ID is required.');

  const url = buildInstagramMediaUrl({
    instagramUserId,
    accessToken,
    limit,
    apiVersion: readConfig(config, 'apiVersion') || DEFAULT_GRAPH_API_VERSION,
    apiBaseUrl: readConfig(config, 'apiBaseUrl'),
  });
  const response = await fetchImpl(url);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(instagramErrorMessage(body, response.status));
  }

  return normalizeInstagramMedia(body.data ?? [], { limit });
}

export async function refreshInstagramAccessToken({
  config = {},
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
} = {}) {
  const accessToken = readConfig(config, 'accessToken');
  if (!accessToken) throw new Error('Instagram access token is required.');

  const apiBaseUrl = readConfig(config, 'refreshApiBaseUrl') || 'https://graph.instagram.com';
  const url = new URL(`${String(apiBaseUrl).replace(/\/$/, '')}/refresh_access_token`);
  url.searchParams.set('grant_type', 'ig_refresh_token');
  url.searchParams.set('access_token', accessToken);

  const response = await fetchImpl(url.toString());
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(instagramErrorMessage(body, response.status));
  }

  const refreshedToken = String(body.access_token || '').trim();
  if (!refreshedToken) throw new Error('Instagram refresh response did not include an access token.');

  const expiresIn = Number(body.expires_in || 0);
  const issuedAt = now();
  const expiresAt = Number.isFinite(expiresIn) && expiresIn > 0
    ? new Date(issuedAt.getTime() + expiresIn * 1000).toISOString()
    : null;

  return {
    accessToken: refreshedToken,
    tokenType: body.token_type || 'bearer',
    expiresIn,
    expiresAt,
    refreshedAt: issuedAt.toISOString(),
  };
}

export async function exchangeInstagramOAuthCode({
  code,
  redirectUri,
  clientId,
  clientSecret,
  fetchImpl = globalThis.fetch,
  retryDelayMs = 1200,
} = {}) {
  if (!code) throw new Error('Instagram authorization code is required.');
  if (!clientId || !clientSecret) throw new Error('Instagram app credentials are required.');
  if (!redirectUri) throw new Error('Instagram redirect URI is required.');

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
    code,
  });
  const data = await fetchInstagramJsonWithRetry({
    fetchImpl,
    url: 'https://api.instagram.com/oauth/access_token',
    options: {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    },
    retryDelayMs,
  });
  if (!data.access_token || !data.user_id) {
    throw new Error('Instagram OAuth response did not include an access token and user ID.');
  }

  return {
    accessToken: String(data.access_token).trim(),
    userId: String(data.user_id).trim(),
    permissions: data.permissions ?? [],
  };
}

export async function exchangeInstagramLongLivedToken({
  accessToken,
  clientSecret,
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  retryDelayMs = 1200,
} = {}) {
  if (!accessToken) throw new Error('Instagram short-lived access token is required.');
  if (!clientSecret) throw new Error('Instagram app secret is required.');

  const url = new URL('https://graph.instagram.com/access_token');
  url.searchParams.set('grant_type', 'ig_exchange_token');
  url.searchParams.set('client_secret', clientSecret);
  url.searchParams.set('access_token', accessToken);

  const data = await fetchInstagramJsonWithRetry({
    fetchImpl,
    url: url.toString(),
    retryDelayMs,
  });
  if (!data.access_token) {
    throw new Error('Instagram long-lived token response did not include an access token.');
  }

  const expiresIn = Number(data.expires_in || 0);
  const issuedAt = now();
  const expiresAt = Number.isFinite(expiresIn) && expiresIn > 0
    ? new Date(issuedAt.getTime() + expiresIn * 1000).toISOString()
    : null;

  return {
    accessToken: String(data.access_token).trim(),
    tokenType: data.token_type || 'bearer',
    expiresIn,
    expiresAt,
    refreshedAt: issuedAt.toISOString(),
  };
}

export function normalizeInstagramMedia(items = [], { limit = 6 } = {}) {
  return (Array.isArray(items) ? items : [])
    .map(item => {
      const permalink = String(item.permalink || '').trim();
      const imageUrl = String(item.media_url || item.thumbnail_url || '').trim();
      const mediaType = String(item.media_type || '').toUpperCase();
      return {
        id: String(item.id || permalink || imageUrl).trim(),
        title: titleFromCaption(item.caption) || titleFromPermalink(permalink),
        caption: cleanCaption(item.caption),
        image: mediaType === 'VIDEO'
          ? String(item.thumbnail_url || item.media_url || '').trim()
          : imageUrl,
        mediaUrl: imageUrl,
        thumbnailUrl: String(item.thumbnail_url || '').trim(),
        permalink,
        mediaType,
        timestamp: String(item.timestamp || '').trim(),
        username: String(item.username || '').trim(),
        source: 'instagram-api',
      };
    })
    .filter(item => item.id && item.permalink && item.image)
    .slice(0, limit);
}

export function instagramProviderConfigFromEnv(env = {}) {
  const accessToken = cleanEnvValue(env.INSTAGRAM_ACCESS_TOKEN || env.META_INSTAGRAM_ACCESS_TOKEN);
  const instagramUserId = cleanEnvValue(env.INSTAGRAM_USER_ID || env.INSTAGRAM_ACCOUNT_ID || env.META_INSTAGRAM_USER_ID);
  if (!accessToken && !instagramUserId) return {};

  return {
    providerKey: 'instagram',
    providerKind: 'social',
    status: accessToken && instagramUserId ? 'connected' : 'not_connected',
    accessToken,
    instagramUserId,
    apiVersion: cleanEnvValue(env.INSTAGRAM_GRAPH_API_VERSION) || DEFAULT_GRAPH_API_VERSION,
    apiBaseUrl: cleanEnvValue(env.INSTAGRAM_GRAPH_API_BASE_URL) || 'https://graph.facebook.com',
    feedLimit: Number(env.INSTAGRAM_FEED_LIMIT || 6),
  };
}

export function mergeInstagramProviderConfig(...configs) {
  return Object.assign({}, ...configs.filter(Boolean).map(config => Object.fromEntries(
    Object.entries(config).filter(([, value]) => value !== undefined && value !== null && value !== ''),
  )));
}

function buildInstagramMediaUrl({
  instagramUserId,
  accessToken,
  limit,
  apiVersion,
  apiBaseUrl = 'https://graph.facebook.com',
}) {
  const cleanBase = String(apiBaseUrl || 'https://graph.facebook.com').replace(/\/$/, '');
  const url = isInstagramLoginApiBase(cleanBase)
    ? new URL(`${cleanBase}/me/media`)
    : new URL(`${cleanBase}/${String(apiVersion || DEFAULT_GRAPH_API_VERSION).replace(/^\/?/, '')}/${encodeURIComponent(instagramUserId)}/media`);
  url.searchParams.set('fields', DEFAULT_MEDIA_FIELDS);
  url.searchParams.set('limit', String(Math.max(1, Math.min(25, Number(limit) || 6))));
  url.searchParams.set('access_token', accessToken);
  return url.toString();
}

function isInstagramLoginApiBase(apiBaseUrl) {
  try {
    return new URL(apiBaseUrl).hostname === 'graph.instagram.com';
  } catch {
    return false;
  }
}

function instagramErrorMessage(body, status) {
  const detail = body?.error?.message || body?.error_description || body?.message;
  return `Instagram feed request failed${status ? ` with ${status}` : ''}${detail ? `: ${detail}` : '.'}`;
}

async function fetchInstagramJsonWithRetry({
  fetchImpl,
  url,
  options,
  attempts = 3,
  retryDelayMs = 1200,
} = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await fetchImpl(url, options);
    const data = await response.json().catch(() => ({}));
    if (response.ok) return data;

    const message = instagramErrorMessage(data, response.status);
    lastError = new Error(message);
    if (!isInstagramClockSkewError(message) || attempt === attempts) break;
    await delay(retryDelayMs);
  }
  throw lastError;
}

function isInstagramClockSkewError(message = '') {
  return /jwt issued at future/i.test(String(message));
}

function delay(ms) {
  const duration = Math.max(0, Number(ms) || 0);
  if (duration === 0) return Promise.resolve();
  return new Promise(resolve => setTimeout(resolve, duration));
}

function readConfig(config = {}, key) {
  const snakeKey = key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
  const value = config[key] ?? config[snakeKey];
  if (value === undefined || value === null || value === '') return undefined;
  return typeof value === 'string' ? value.trim() : value;
}

function cleanEnvValue(value) {
  const text = String(value || '').trim();
  if (!text || /^your_.+_here$/i.test(text)) return '';
  return text;
}

function cleanCaption(caption = '') {
  const text = String(caption || '').replace(/\s+/g, ' ').trim();
  if (text.length <= 160) return text;
  return `${text.slice(0, 157).trim()}...`;
}

function titleFromCaption(caption = '') {
  const firstSentence = String(caption || '').split(/[.!?\n]/)[0]?.trim();
  if (!firstSentence) return '';
  return firstSentence.length > 54 ? `${firstSentence.slice(0, 51).trim()}...` : firstSentence;
}

function titleFromPermalink(permalink = '') {
  const cleaned = String(permalink).replace(/^https?:\/\/(www\.)?instagram\.com\//, '').replace(/\/$/, '');
  return cleaned ? `Instagram ${cleaned}` : 'Instagram update';
}
