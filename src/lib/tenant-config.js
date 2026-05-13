export const DEFAULT_TENANT_ID = 'midway';
export const DEFAULT_LOCATION_ID = 'plain';

export function createTenantConfig({
  tenantId = DEFAULT_TENANT_ID,
  locationId = DEFAULT_LOCATION_ID,
  tenant = {},
  location = {},
  business = {},
  publicSite = {},
  providers = {},
  frontend = {},
} = {}) {
  const instagramHandle = normalizeInstagramHandle(business.instagramHandle ?? publicSite.instagramHandle);
  const instagramPosts = normalizeInstagramPosts(publicSite.instagramPosts ?? business.instagramPosts);
  const themeKey = publicSite.theme || frontend.themeKey || '';
  const businessName = business.name || location.name || tenant.name || '';
  const publicBrandName = business.publicBrandName || businessName;
  const sections = normalizeSections(publicSite.sections ?? frontend.sections);

  return {
    tenantId,
    locationId,
    tenant: {
      name: tenant.name || '',
      status: tenant.status || '',
      businessProfile: tenant.businessProfile || frontend.businessProfile || '',
    },
    location: {
      name: location.name || '',
      status: location.status || '',
    },
    business: {
      name: businessName,
      publicBrandName,
      phone: business.phone || location.phone || '',
      smsPhone: business.smsPhone || '',
      address: business.address || location.address || '',
      email: business.email || '',
      timezone: business.timezone || location.timezone || '',
      instagramHandle,
      instagramUrl: business.instagramUrl || buildInstagramUrl(instagramHandle),
      googleMapsUrl: business.googleMapsUrl || '',
      logoUrl: business.logoUrl || '',
    },
    publicSite: {
      url: publicSite.url || '',
      theme: themeKey,
      instagramPosts,
      sections,
    },
    frontend: {
      themeKey,
      businessProfile: frontend.businessProfile || tenant.businessProfile || '',
      sections,
      draftConfig: isPlainObject(frontend.draftConfig) ? frontend.draftConfig : {},
      publishedConfig: isPlainObject(frontend.publishedConfig) ? frontend.publishedConfig : {},
    },
    providers: normalizeProviders(providers),
  };
}

export function createTenantConfigFromSupabaseRows({
  tenant,
  location,
  siteSettings,
  providerConnections = [],
  frontendConfig,
} = {}) {
  if (!tenant) throw new Error('Tenant config could not be loaded: tenant was not found.');

  const resolvedLocationId = location?.id ?? siteSettings?.location_id ?? frontendConfig?.location_id ?? DEFAULT_LOCATION_ID;
  const resolvedBusinessName = siteSettings?.business_name || location?.name || tenant.name || '';
  const themeKey = frontendConfig?.theme_key || siteSettings?.theme_key || tenant.default_theme || '';
  const businessProfile = frontendConfig?.business_profile || tenant.business_profile || '';

  return createTenantConfig({
    tenantId: tenant.id,
    locationId: resolvedLocationId,
    tenant: {
      name: tenant.name,
      status: tenant.status,
      businessProfile,
    },
    location: {
      name: location?.name,
      status: location?.status,
    },
    business: {
      name: resolvedBusinessName,
      publicBrandName: siteSettings?.public_brand_name || resolvedBusinessName,
      phone: siteSettings?.phone || location?.phone || '',
      smsPhone: siteSettings?.sms_phone || '',
      address: siteSettings?.address || location?.address || '',
      email: siteSettings?.email || '',
      timezone: siteSettings?.timezone || location?.timezone || '',
      instagramHandle: siteSettings?.instagram_handle || '',
      instagramUrl: siteSettings?.instagram_url || '',
      instagramPosts: siteSettings?.instagram_posts || [],
      googleMapsUrl: siteSettings?.google_maps_url || '',
      logoUrl: siteSettings?.logo_url || '',
    },
    publicSite: {
      url: siteSettings?.public_site_url || '',
      theme: themeKey,
      instagramPosts: siteSettings?.instagram_posts || [],
    },
    frontend: {
      themeKey,
      businessProfile,
      sections: frontendConfig?.sections || [],
      draftConfig: frontendConfig?.draft_config || {},
      publishedConfig: frontendConfig?.published_config || {},
    },
    providers: Object.fromEntries(
      providerConnections.map(connection => [
        connection.provider_key,
        providerConnectionToConfig(connection),
      ]),
    ),
  });
}

export function publicSettingsFromTenantConfig(config) {
  if (!config) throw new Error('Tenant config is required.');

  return {
    businessName: config.business.publicBrandName,
    phone: config.business.phone,
    address: config.business.address,
    email: config.business.email,
    timezone: config.business.timezone,
    instagramHandle: config.business.instagramHandle,
    instagramUrl: config.business.instagramUrl,
    instagramPosts: config.publicSite.instagramPosts,
    sections: config.publicSite.sections,
    googleMapsUrl: config.business.googleMapsUrl,
    logoUrl: config.business.logoUrl,
    theme: config.publicSite.theme,
  };
}

export function adminSettingsFromTenantConfig(config, { featureFlags = {} } = {}) {
  if (!config) throw new Error('Tenant config is required.');

  return {
    business: {
      businessName: config.business.name,
      publicBrandName: config.business.publicBrandName,
      phone: config.business.phone,
      address: config.business.address,
      email: config.business.email,
      timezone: config.business.timezone,
      instagramHandle: config.business.instagramHandle,
      instagramUrl: config.business.instagramUrl,
    },
    publicSite: {
      url: config.publicSite.url,
      theme: config.publicSite.theme,
      instagramPosts: config.publicSite.instagramPosts,
      sections: config.publicSite.sections,
    },
    providers: featureFlags['core.provider_adapters'] === false
      ? []
      : providerStatusesFromTenantConfig(config),
  };
}

export function updateTenantConfigSettings(config, input = {}) {
  const business = input.business ?? {};
  const publicSite = input.publicSite ?? {};

  assignString(config.business, 'name', business.businessName, { required: true });
  assignString(config.business, 'publicBrandName', business.publicBrandName, { required: true });
  assignString(config.business, 'phone', business.phone);
  assignString(config.business, 'address', business.address);
  assignString(config.business, 'email', business.email);
  assignString(config.business, 'timezone', business.timezone, { required: true });

  if ('instagramHandle' in business) {
    config.business.instagramHandle = normalizeInstagramHandle(business.instagramHandle);
  }
  if ('instagramUrl' in business) {
    config.business.instagramUrl = String(business.instagramUrl || '').trim()
      || buildInstagramUrl(config.business.instagramHandle);
  }

  assignString(config.publicSite, 'url', publicSite.url);
  assignString(config.publicSite, 'theme', publicSite.theme, { required: true });
  if ('instagramPosts' in publicSite) {
    config.publicSite.instagramPosts = normalizeInstagramPosts(publicSite.instagramPosts);
  }
  if ('sections' in publicSite) {
    config.publicSite.sections = normalizeSections(publicSite.sections);
    config.frontend.sections = config.publicSite.sections;
  }

  return config;
}

export function getProviderConfig(config, providerKey) {
  return config?.providers?.[providerKey] || {};
}

function normalizeProviders(providers = {}) {
  return Object.fromEntries(
    Object.entries(providers)
      .filter(([providerKey]) => providerKey)
      .map(([providerKey, provider]) => [
        providerKey,
        providerKey === 'square'
          ? normalizeSquareProvider(provider)
          : normalizeGenericProvider(providerKey, provider),
      ]),
  );
}

function providerConnectionToConfig(connection = {}) {
  const publicConfig = jsonObject(connection.public_config);
  const credentials = jsonObject(connection.encrypted_credentials);
  const providerKey = connection.provider_key;
  const baseConfig = {
    ...publicConfig,
    ...credentials,
    providerKey,
    providerKind: connection.provider_kind || '',
    status: connection.status || 'not_connected',
    secretRef: connection.secret_ref || '',
    scopes: Array.isArray(connection.scopes) ? connection.scopes : [],
    externalAccountId: connection.external_account_id || '',
    externalLocationId: connection.external_location_id || '',
    lastSyncAt: connection.last_sync_at || '',
    errorMessage: connection.error_message || '',
  };

  if (providerKey === 'square') {
    return normalizeSquareProvider({
      ...baseConfig,
      locationId: publicConfig.locationId || publicConfig.location_id || connection.external_location_id || '',
      applicationId: publicConfig.applicationId || publicConfig.application_id || '',
      accessToken: credentials.accessToken || credentials.access_token || '',
      webhookSignatureKey: credentials.webhookSignatureKey || credentials.webhook_signature_key || '',
      rvVariationIds: publicConfig.rvVariationIds || publicConfig.rv_variation_ids || {},
    });
  }

  return normalizeGenericProvider(providerKey, baseConfig);
}

function providerStatusesFromTenantConfig(config) {
  return [
    providerStatus('square', 'Square', 'payment', config.providers?.square, {
      configuredKeys: ['accessToken', 'applicationId', 'locationId'],
      publicKeys: ['environment', 'checkoutSurface', 'applicationId', 'locationId'],
    }),
    providerStatus('email', 'Email', 'messaging', config.providers?.email, {
      configuredKeys: ['apiKey', 'smtpUrl', 'fromEmail', 'senderEmail'],
      publicKeys: ['fromEmail', 'senderEmail', 'fromName'],
    }),
    providerStatus('slack', 'Slack', 'messaging', config.providers?.slack, {
      configuredKeys: ['webhookUrl', 'botToken', 'workspace', 'channel'],
      publicKeys: ['workspace', 'channel'],
    }),
    providerStatus('instagram', 'Instagram', 'social', {
      ...config.providers?.instagram,
      handle: config.business.instagramHandle,
      profileUrl: config.business.instagramUrl,
      postsConfigured: config.publicSite.instagramPosts.length,
    }, {
      configuredKeys: ['handle', 'profileUrl', 'postsConfigured'],
      publicKeys: ['handle', 'profileUrl', 'postsConfigured'],
    }),
  ];
}

function providerStatus(providerKey, label, kind, provider = {}, { configuredKeys = [], publicKeys = [] } = {}) {
  const configured = configuredKeys.some(key => Boolean(provider[key]));
  const normalizedStatus = normalizeProviderStatus(provider.status);
  const status = normalizedStatus && (normalizedStatus !== 'not_connected' || !configured)
    ? normalizedStatus
    : configured ? 'connected' : 'not_connected';
  const publicConfig = Object.fromEntries(publicKeys
    .filter(key => provider[key] !== undefined && provider[key] !== null && provider[key] !== '')
    .map(key => [key, provider[key]]));

  return {
    providerKey,
    label,
    kind,
    status,
    publicConfig,
    lastSyncAt: provider.lastSyncAt || null,
    errorMessage: status === 'error' || status === 'degraded' ? provider.errorMessage || '' : '',
  };
}

function normalizeProviderStatus(value) {
  const status = String(value || '').trim();
  return ['not_connected', 'connecting', 'connected', 'degraded', 'expired', 'revoked', 'error'].includes(status)
    ? status
    : '';
}

function assignString(target, key, value, { required = false } = {}) {
  if (!(key in target) && value === undefined) return;
  if (value === undefined) return;
  const nextValue = String(value || '').trim();
  if (required && !nextValue) return;
  target[key] = nextValue;
}

function normalizeSquareProvider(square = {}) {
  return {
    providerKey: 'square',
    providerKind: square.providerKind || square.provider_kind || 'payment',
    status: square.status || (square.accessToken ? 'connected' : 'not_connected'),
    accessToken: square.accessToken || '',
    applicationId: square.applicationId || '',
    locationId: square.locationId || '',
    environment: square.environment || '',
    checkoutSurface: square.checkoutSurface || '',
    webhookSignatureKey: square.webhookSignatureKey || '',
    rvVariationIds: square.rvVariationIds || {},
    apiVersion: square.apiVersion || '',
    strictCheckout: square.strictCheckout || '',
    strictRefunds: square.strictRefunds || '',
    secretRef: square.secretRef || '',
    scopes: Array.isArray(square.scopes) ? square.scopes : [],
    externalAccountId: square.externalAccountId || '',
    externalLocationId: square.externalLocationId || '',
    lastSyncAt: square.lastSyncAt || '',
    errorMessage: square.errorMessage || '',
  };
}

function normalizeGenericProvider(providerKey, provider = {}) {
  return {
    ...provider,
    providerKey,
    status: provider.status || 'not_connected',
  };
}

function normalizeInstagramHandle(value) {
  return String(value || '').replace(/^@/, '').trim();
}

function normalizeInstagramPosts(value) {
  const values = Array.isArray(value)
    ? value
    : String(value || '').split(/[\n,]+/);
  return values.map(normalizeInstagramPost).filter(Boolean);
}

function normalizeInstagramPost(value) {
  const url = String(value || '').trim();
  if (!/^https:\/\/(www\.)?instagram\.com\/(p|reel|tv)\//.test(url)) return null;
  return url;
}

function normalizeSections(value) {
  const sections = Array.isArray(value) ? value : [];
  return sections
    .map(section => ({
      key: String(section?.key || '').trim(),
      enabled: section?.enabled !== false,
      title: String(section?.title || '').trim(),
      copy: String(section?.copy || '').trim(),
      items: Array.isArray(section?.items) ? section.items : [],
    }))
    .filter(section => section.key);
}

function buildInstagramUrl(handle) {
  const normalized = normalizeInstagramHandle(handle);
  return normalized ? `https://www.instagram.com/${normalized}/` : '';
}

function jsonObject(value) {
  return isPlainObject(value) ? value : {};
}

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}
