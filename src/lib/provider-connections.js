import crypto from 'node:crypto';

import { getProviderConfig } from './tenant-config.js';

export const PROVIDER_DEFINITIONS = [
  {
    providerKey: 'square',
    providerKind: 'payment',
    displayName: 'Square',
    requiredFor: ['payments', 'catalog', 'refunds'],
  },
  {
    providerKey: 'email',
    providerKind: 'messaging',
    displayName: 'Email',
    requiredFor: ['customer_notifications'],
  },
  {
    providerKey: 'slack',
    providerKind: 'messaging',
    displayName: 'Slack',
    requiredFor: ['admin_notifications'],
  },
  {
    providerKey: 'instagram',
    providerKind: 'social',
    displayName: 'Instagram',
    requiredFor: ['public_feed'],
  },
];

const DEFAULT_SQUARE_OAUTH_SCOPES = [
  'MERCHANT_PROFILE_READ',
  'PAYMENTS_READ',
  'PAYMENTS_WRITE',
  'ORDERS_READ',
  'ORDERS_WRITE',
  'ITEMS_READ',
];
const SQUARE_OAUTH_API_VERSION = '2026-01-22';

export function createProviderConnectionService({
  store = null,
  tenantConfig = null,
  platformProviderConfigs = [],
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
} = {}) {
  return {
    async listStatuses(input = {}) {
      const resolvedTenantConfig = await resolveTenantConfig({ store, tenantConfig });
      const scope = resolveScope({
        tenantId: resolvedTenantConfig?.tenantId,
        locationId: resolvedTenantConfig?.locationId,
        ...input,
      });
      const records = await listConnectionRecords({ store, tenantConfig: resolvedTenantConfig, scope });
      return PROVIDER_DEFINITIONS.map(definition => {
        const connection = records.find(record => record.providerKey === definition.providerKey)
          ?? connectionFromTenantProviderConfig({
            tenantConfig: resolvedTenantConfig,
            providerKey: definition.providerKey,
            providerKind: definition.providerKind,
            scope,
            now,
          });
        return toProviderStatus(connection, definition);
      });
    },

    async getProviderConfig(providerKey, input = {}) {
      const resolvedTenantConfig = await resolveTenantConfig({ store, tenantConfig });
      const scope = resolveScope({
        tenantId: resolvedTenantConfig?.tenantId,
        locationId: resolvedTenantConfig?.locationId,
        ...input,
      });
      const definition = getProviderDefinition(providerKey);
      const record = await getConnectionRecord({ store, tenantConfig: resolvedTenantConfig, providerKey, scope, now });
      return providerRuntimeConfig(record, definition);
    },

    async startSquareOAuth(input = {}) {
      const resolvedTenantConfig = await resolveTenantConfig({ store, tenantConfig });
      const scope = resolveScope({
        tenantId: resolvedTenantConfig?.tenantId,
        locationId: resolvedTenantConfig?.locationId,
        ...input,
      });
      const existing = await getConnectionRecord({
        store,
        tenantConfig: resolvedTenantConfig,
        providerKey: 'square',
        scope,
        now,
      });
      const platformConfig = await getSquareOAuthPlatformConfig({
        store,
        platformProviderConfigs,
        environment: input.environment || existing?.publicConfig?.environment,
      });
      const scopes = normalizeScopes(input.scopes || platformConfig.scopes || DEFAULT_SQUARE_OAUTH_SCOPES);

      if (!platformConfig.configured) {
        const connection = await upsertConnection({
          store,
          tenantConfig: resolvedTenantConfig,
          connection: {
            tenantId: scope.tenantId,
            locationId: scope.locationId,
            providerKey: 'square',
            providerKind: 'payment',
            status: 'not_connected',
            publicConfig: {
              environment: platformConfig.environment,
              checkoutSurface: 'web-payments',
              oauth: {
                configured: false,
                missing: platformConfig.missing,
                requestedScopes: scopes,
              },
            },
            scopes,
            errorMessage: 'Square OAuth platform credentials are not configured.',
            updatedBy: input.actor?.id ?? null,
          },
          now,
        });
        return {
          mode: 'placeholder',
          authorizationUrl: null,
          message: 'Square OAuth platform credentials are not configured yet.',
          missing: platformConfig.missing,
          connection: toProviderStatus(connection, getProviderDefinition('square')),
        };
      }

      const oauthState = crypto.randomBytes(24).toString('base64url');
      const authorizationUrl = buildSquareAuthorizationUrl({
        platformConfig,
        scopes,
        state: oauthState,
        redirectUri: input.redirectUri,
      });
      const connection = await upsertConnection({
        store,
        tenantConfig: resolvedTenantConfig,
        connection: {
          tenantId: scope.tenantId,
          locationId: scope.locationId,
          providerKey: 'square',
          providerKind: 'payment',
          status: 'connecting',
          publicConfig: {
            applicationId: platformConfig.applicationId,
            environment: platformConfig.environment,
            checkoutSurface: 'web-payments',
            oauth: {
              configured: true,
              state: oauthState,
              requestedScopes: scopes,
              redirectUri: input.redirectUri || platformConfig.redirectUri || '',
              startedAt: now().toISOString(),
            },
          },
          scopes,
          updatedBy: input.actor?.id ?? null,
        },
        now,
      });

      return {
        mode: 'oauth',
        authorizationUrl,
        state: oauthState,
        connection: toProviderStatus(connection, getProviderDefinition('square')),
      };
    },

    async completeSquareOAuth(input = {}) {
      const resolvedTenantConfig = await resolveTenantConfig({ store, tenantConfig });
      const scope = resolveScope({
        tenantId: resolvedTenantConfig?.tenantId,
        locationId: resolvedTenantConfig?.locationId,
        tenantId: input.tenantId,
        locationId: input.tenantLocationId || input.businessLocationId,
      });
      const definition = getProviderDefinition('square');
      const existing = await getConnectionRecord({
        store,
        tenantConfig: resolvedTenantConfig,
        providerKey: 'square',
        scope,
        now,
      });
      const platformConfig = await getSquareOAuthPlatformConfig({
        store,
        platformProviderConfigs,
        environment: input.environment || existing?.publicConfig?.environment,
      });

      if (input.error) {
        const connection = await upsertConnection({
          store,
          tenantConfig: resolvedTenantConfig,
          connection: {
            ...existing,
            tenantId: scope.tenantId,
            locationId: scope.locationId,
            providerKey: 'square',
            providerKind: 'payment',
            status: 'error',
            errorMessage: input.errorDescription || input.error,
            updatedBy: input.actor?.id ?? null,
          },
          now,
        });
        return { mode: 'error', connection: toProviderStatus(connection, definition) };
      }

      const expectedState = existing?.publicConfig?.oauth?.state;
      if (expectedState && input.state !== expectedState) {
        throw providerError('PROVIDER_OAUTH_STATE_MISMATCH', 'Square OAuth state did not match the pending connection.', 400);
      }
      if (!input.code) {
        throw providerError('PROVIDER_OAUTH_CODE_REQUIRED', 'Square OAuth authorization code is required.', 400);
      }

      if (!platformConfig.configured) {
        const connection = await upsertConnection({
          store,
          tenantConfig: resolvedTenantConfig,
          connection: {
            ...existing,
            tenantId: scope.tenantId,
            locationId: scope.locationId,
            providerKey: 'square',
            providerKind: 'payment',
            status: 'error',
            publicConfig: {
              ...(existing?.publicConfig ?? {}),
              oauth: {
                ...(existing?.publicConfig?.oauth ?? {}),
                configured: false,
                missing: platformConfig.missing,
              },
            },
            errorMessage: 'Square OAuth platform credentials are not configured.',
            updatedBy: input.actor?.id ?? null,
          },
          now,
        });
        return {
          mode: 'placeholder',
          message: 'Square OAuth callback was received, but platform credentials are not configured.',
          missing: platformConfig.missing,
          connection: toProviderStatus(connection, definition),
        };
      }

      const token = await exchangeSquareOAuthCode({
        code: input.code,
        redirectUri: input.redirectUri,
        platformConfig,
        fetchImpl,
      });
      const scopes = normalizeScopes(existing?.scopes?.length ? existing.scopes : DEFAULT_SQUARE_OAUTH_SCOPES);
      const connection = await upsertConnection({
        store,
        tenantConfig: resolvedTenantConfig,
        connection: {
          ...existing,
          tenantId: scope.tenantId,
          locationId: scope.locationId,
          providerKey: 'square',
          providerKind: 'payment',
          status: 'connected',
          publicConfig: {
            ...(existing?.publicConfig ?? {}),
            applicationId: platformConfig.applicationId,
            environment: platformConfig.environment,
            checkoutSurface: existing?.publicConfig?.checkoutSurface || 'web-payments',
            tokenType: token.token_type || 'bearer',
            tokenExpiresAt: token.expires_at || null,
            oauth: {
              configured: true,
              connectedAt: now().toISOString(),
              requestedScopes: scopes,
            },
          },
          encryptedCredentials: {
            accessToken: token.access_token,
            refreshToken: token.refresh_token,
            tokenType: token.token_type || 'bearer',
            expiresAt: token.expires_at || null,
          },
          scopes,
          externalAccountId: token.merchant_id || existing?.externalAccountId || null,
          externalLocationId: input.externalLocationId || input.locationId || existing?.externalLocationId || null,
          errorMessage: null,
          updatedBy: input.actor?.id ?? null,
        },
        now,
      });

      return {
        mode: 'oauth',
        connection: toProviderStatus(connection, definition),
      };
    },
  };
}

export function providerConnectionsFromTenantConfig(tenantConfig = null, { now = () => new Date() } = {}) {
  const tenantId = tenantConfig?.tenantId || 'midway';
  const locationId = tenantConfig?.locationId || 'plain';
  const scope = { tenantId, locationId };
  return PROVIDER_DEFINITIONS
    .map(definition => connectionFromTenantProviderConfig({
      tenantConfig,
      providerKey: definition.providerKey,
      providerKind: definition.providerKind,
      scope,
      now,
    }))
    .filter(connection => connection.status !== 'not_connected' || hasAnyConfig(connection));
}

async function resolveTenantConfig({ store, tenantConfig }) {
  if (tenantConfig) return tenantConfig;
  return await store?.getTenantConfig?.() ?? null;
}

function getProviderDefinition(providerKey) {
  return PROVIDER_DEFINITIONS.find(definition => definition.providerKey === providerKey)
    ?? { providerKey, providerKind: 'messaging', displayName: providerKey, requiredFor: [] };
}

async function listConnectionRecords({ store, tenantConfig, scope }) {
  const rows = await store?.listProviderConnections?.(scope);
  if (rows?.length) return rows.map(normalizeProviderConnection);
  return providerConnectionsFromTenantConfig(tenantConfig);
}

async function getConnectionRecord({ store, tenantConfig, providerKey, scope, now }) {
  const stored = await store?.getProviderConnection?.({ ...scope, providerKey });
  if (stored) return normalizeProviderConnection(stored);
  return connectionFromTenantProviderConfig({
    tenantConfig,
    providerKey,
    providerKind: getProviderDefinition(providerKey).providerKind,
    scope,
    now,
  });
}

async function upsertConnection({ store, tenantConfig, connection, now }) {
  if (store?.upsertProviderConnection) {
    return normalizeProviderConnection(await store.upsertProviderConnection(connection));
  }
  return normalizeProviderConnection({
    ...connectionFromTenantProviderConfig({
      tenantConfig,
      providerKey: connection.providerKey,
      providerKind: connection.providerKind,
      scope: connection,
      now,
    }),
    ...connection,
    updatedAt: now().toISOString(),
  });
}

function connectionFromTenantProviderConfig({
  tenantConfig,
  providerKey,
  providerKind,
  scope,
  now = () => new Date(),
}) {
  const config = getProviderConfig(tenantConfig, providerKey);
  const createdAt = now().toISOString();
  const base = {
    tenantId: scope.tenantId,
    locationId: scope.locationId,
    providerKey,
    providerKind,
    status: config?.status || (hasAnyConfig({ publicConfig: config }) ? 'configured' : 'not_connected'),
    publicConfig: {},
    secretRef: config?.secretRef || null,
    encryptedCredentials: {},
    scopes: normalizeScopes(config?.scopes || []),
    externalAccountId: config?.externalAccountId || null,
    externalLocationId: config?.externalLocationId || config?.locationId || null,
    lastSyncAt: config?.lastSyncAt || null,
    errorMessage: config?.errorMessage || null,
    updatedBy: null,
    createdAt,
    updatedAt: createdAt,
  };

  if (providerKey === 'square') {
    return normalizeProviderConnection({
      ...base,
      status: config?.status || (config?.accessToken || config?.secretRef ? 'connected' : 'not_connected'),
      publicConfig: pickDefined({
        applicationId: config?.applicationId,
        locationId: config?.locationId,
        environment: config?.environment,
        checkoutSurface: config?.checkoutSurface,
        strictCheckout: config?.strictCheckout,
        strictRefunds: config?.strictRefunds,
        apiVersion: config?.apiVersion,
        rvVariationIds: config?.rvVariationIds,
      }),
      encryptedCredentials: pickDefined({
        accessToken: config?.accessToken,
        webhookSignatureKey: config?.webhookSignatureKey,
      }),
    });
  }

  if (providerKey === 'email') {
    return normalizeProviderConnection({
      ...base,
      status: config?.status || (config?.bookingWebhookUrl || config?.webhookUrl || config?.secretRef ? 'connected' : 'not_connected'),
      publicConfig: pickDefined({
        from: config?.from,
        providerName: config?.providerName,
      }),
      encryptedCredentials: pickDefined({
        bookingWebhookUrl: config?.bookingWebhookUrl,
        webhookUrl: config?.webhookUrl,
      }),
    });
  }

  if (providerKey === 'slack') {
    return normalizeProviderConnection({
      ...base,
      status: config?.status || (config?.webhookUrl || config?.secretRef ? 'connected' : 'not_connected'),
      publicConfig: pickDefined({
        channel: config?.channel,
        providerName: config?.providerName,
      }),
      encryptedCredentials: pickDefined({
        webhookUrl: config?.webhookUrl,
      }),
    });
  }

  if (providerKey === 'instagram') {
    const handle = tenantConfig?.business?.instagramHandle || '';
    const profileUrl = tenantConfig?.business?.instagramUrl || '';
    const posts = tenantConfig?.publicSite?.instagramPosts || [];
    return normalizeProviderConnection({
      ...base,
      status: config?.status || (handle || profileUrl || posts.length ? 'connected' : 'not_connected'),
      publicConfig: pickDefined({
        handle,
        profileUrl,
        postsConfigured: posts.length,
        providerName: config?.providerName,
      }),
    });
  }

  return normalizeProviderConnection(base);
}

function providerRuntimeConfig(connection, definition) {
  const normalized = normalizeProviderConnection(connection);
  return {
    providerKey: definition.providerKey,
    providerKind: definition.providerKind,
    status: normalized.status,
    ...normalized.publicConfig,
    ...normalized.encryptedCredentials,
    secretRef: normalized.secretRef,
    scopes: normalized.scopes,
    externalAccountId: normalized.externalAccountId,
    externalLocationId: normalized.externalLocationId,
  };
}

function toProviderStatus(connection, definition) {
  const normalized = normalizeProviderConnection(connection);
  const credentialKeys = Object.keys(normalized.encryptedCredentials || {});
  return {
    providerKey: definition.providerKey,
    providerKind: definition.providerKind,
    displayName: definition.displayName,
    requiredFor: definition.requiredFor,
    status: normalized.status,
    publicConfig: normalized.publicConfig,
    scopes: normalized.scopes,
    externalAccountId: normalized.externalAccountId,
    externalLocationId: normalized.externalLocationId,
    lastSyncAt: normalized.lastSyncAt,
    errorMessage: normalized.errorMessage,
    hasSecretRef: Boolean(normalized.secretRef),
    hasEncryptedCredentials: credentialKeys.length > 0,
    credentialKeys,
    updatedAt: normalized.updatedAt,
  };
}

export function normalizeProviderConnection(input = {}) {
  return {
    id: input.id || null,
    tenantId: input.tenantId || input.tenant_id || 'midway',
    locationId: input.locationId ?? input.location_id ?? 'plain',
    providerKey: input.providerKey || input.provider_key,
    providerKind: input.providerKind || input.provider_kind || 'messaging',
    status: normalizeStatus(input.status),
    publicConfig: cloneJson(input.publicConfig ?? input.public_config ?? {}),
    secretRef: input.secretRef ?? input.secret_ref ?? null,
    encryptedCredentials: cloneJson(input.encryptedCredentials ?? input.encrypted_credentials ?? {}),
    scopes: normalizeScopes(input.scopes || []),
    externalAccountId: input.externalAccountId ?? input.external_account_id ?? null,
    externalLocationId: input.externalLocationId ?? input.external_location_id ?? null,
    lastSyncAt: input.lastSyncAt ?? input.last_sync_at ?? null,
    errorMessage: input.errorMessage ?? input.error_message ?? null,
    updatedBy: input.updatedBy ?? input.updated_by ?? null,
    createdAt: input.createdAt ?? input.created_at ?? null,
    updatedAt: input.updatedAt ?? input.updated_at ?? null,
  };
}

async function getSquareOAuthPlatformConfig({ store, platformProviderConfigs = [], environment } = {}) {
  const configuredRecord = await resolvePlatformProviderConfig({
    store,
    platformProviderConfigs,
    providerKey: 'square',
    environment,
  });
  const publicConfig = cloneJson(configuredRecord?.publicConfig ?? configuredRecord?.public_config ?? {});
  const credentials = cloneJson(configuredRecord?.encryptedCredentials ?? configuredRecord?.encrypted_credentials ?? {});
  const resolvedEnvironment = normalizeSquareEnvironment(
    configuredRecord?.environment
      || publicConfig.environment
  );
  const applicationId = configuredRecord?.applicationId
    || publicConfig.applicationId
    || publicConfig.application_id;
  const clientSecret = configuredRecord?.clientSecret
    || credentials.clientSecret
    || credentials.client_secret;
  const redirectUri = configuredRecord?.redirectUri
    || publicConfig.redirectUri
    || publicConfig.redirect_uri;
  const scopes = normalizeScopes(
    configuredRecord?.scopes
      || publicConfig.scopes
      || [],
  );
  const missing = [
    ['platform_provider_configs.square.environment', resolvedEnvironment],
    ['platform_provider_configs.square.public_config.applicationId', applicationId],
    ['platform_provider_configs.square.encrypted_credentials.clientSecret', clientSecret],
  ].filter(([, value]) => !value).map(([name]) => name);

  return {
    environment: resolvedEnvironment,
    applicationId,
    clientSecret,
    redirectUri,
    scopes,
    configured: missing.length === 0,
    missing,
  };
}

async function resolvePlatformProviderConfig({ store, platformProviderConfigs, providerKey, environment }) {
  const requestedEnvironment = normalizeSquareEnvironment(environment);
  const stored = await store?.getPlatformProviderConfig?.({
    providerKey,
    environment: requestedEnvironment,
  });
  if (stored) return stored;

  return findPlatformProviderConfig(platformProviderConfigs, {
    providerKey,
    environment: requestedEnvironment,
  });
}

function findPlatformProviderConfig(records, { providerKey, environment } = {}) {
  if (!Array.isArray(records)) return null;
  const matches = records.filter(record => (
    (record.providerKey || record.provider_key) === providerKey
    && (!environment || normalizeSquareEnvironment(record.environment || record.publicConfig?.environment || record.public_config?.environment) === environment)
  ));
  return matches.find(record => record.status !== 'disabled' && record.status !== 'inactive')
    ?? matches[0]
    ?? null;
}

function normalizeSquareEnvironment(value) {
  const normalized = String(value || '').trim();
  if (!normalized) return '';
  return normalized === 'production' ? 'production' : 'sandbox';
}

function buildSquareAuthorizationUrl({ platformConfig, scopes, state, redirectUri }) {
  const baseUrl = platformConfig.environment === 'production'
    ? 'https://connect.squareup.com/oauth2/authorize'
    : 'https://connect.squareupsandbox.com/oauth2/authorize';
  const url = new URL(baseUrl);
  url.searchParams.set('client_id', platformConfig.applicationId);
  url.searchParams.set('scope', scopes.join(' '));
  url.searchParams.set('state', state);
  if (platformConfig.environment === 'production') url.searchParams.set('session', 'false');
  if (redirectUri || platformConfig.redirectUri) url.searchParams.set('redirect_uri', redirectUri || platformConfig.redirectUri);
  return url.toString();
}

async function exchangeSquareOAuthCode({ code, redirectUri, platformConfig, fetchImpl }) {
  const tokenUrl = platformConfig.environment === 'production'
    ? 'https://connect.squareup.com/oauth2/token'
    : 'https://connect.squareupsandbox.com/oauth2/token';
  const body = {
    client_id: platformConfig.applicationId,
    client_secret: platformConfig.clientSecret,
    code,
    grant_type: 'authorization_code',
  };
  if (redirectUri || platformConfig.redirectUri) body.redirect_uri = redirectUri || platformConfig.redirectUri;

  const response = await fetchImpl(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Square-Version': SQUARE_OAUTH_API_VERSION,
    },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data.errors?.[0]?.detail || data.errors?.[0]?.code || `Square OAuth token exchange failed with ${response.status}`;
    throw providerError('PROVIDER_OAUTH_EXCHANGE_FAILED', message, 502);
  }
  if (!data.access_token || !data.refresh_token) {
    throw providerError('PROVIDER_OAUTH_TOKEN_INVALID', 'Square OAuth token response did not include the expected credentials.', 502);
  }
  return data;
}

function normalizeScopes(scopes) {
  const values = Array.isArray(scopes) ? scopes : String(scopes || '').split(/[\s,]+/);
  return [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))];
}

function normalizeStatus(status) {
  if (status === 'configured') return 'connected';
  return [
    'not_connected',
    'connecting',
    'connected',
    'degraded',
    'expired',
    'revoked',
    'error',
  ].includes(status) ? status : 'not_connected';
}

function resolveScope({ tenantId, locationId } = {}) {
  return {
    tenantId: tenantId || 'midway',
    locationId: locationId || 'plain',
  };
}

function hasAnyConfig(connection = {}) {
  return Object.keys(connection.publicConfig || {}).length > 0
    || Object.keys(connection.encryptedCredentials || {}).length > 0
    || Boolean(connection.secretRef);
}

function pickDefined(values) {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => (
    value !== undefined && value !== null && value !== ''
  )));
}

function cloneJson(value) {
  return structuredClone(value || {});
}

function providerError(code, message, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}
