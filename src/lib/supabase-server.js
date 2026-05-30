import { createClient } from '@supabase/supabase-js';

import { createTenantConfigFromSupabaseRows } from './tenant-config.js';

export function getSupabaseServerConfig(env = process.env) {
  const url = readEnv(env, 'SUPABASE_URL')
    || readEnv(env, 'NEXT_PUBLIC_SUPABASE_URL')
    || readEnv(env, 'VITE_SUPABASE_URL');
  const serviceRoleKey = readEnv(env, 'SUPABASE_SERVICE_ROLE_KEY')
    || readEnv(env, 'SUPABASE_SERVICE_KEY');

  return {
    url,
    serviceRoleKey,
    configured: Boolean(isHttpUrl(url) && serviceRoleKey),
    invalidUrl: Boolean(url && !isHttpUrl(url)),
  };
}

export function createSupabaseServerClient({ env = process.env } = {}) {
  const config = getSupabaseServerConfig(env);
  if (!config.configured) return null;

  return createClient(config.url, config.serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export function assertProductionPersistence(env = process.env) {
  const nodeEnv = readEnv(env, 'NODE_ENV');
  const allowMemoryStore = readEnv(env, 'MIDWAY_ALLOW_MEMORY_STORE') === 'true';
  const config = getSupabaseServerConfig(env);

  if (nodeEnv === 'production' && !config.configured && !allowMemoryStore) {
    if (config.invalidUrl) {
      throw new Error('Supabase persistence is required in production. Supabase URL must be a valid HTTP or HTTPS URL.');
    }
    throw new Error(
      'Supabase persistence is required in production. Set SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, or set MIDWAY_ALLOW_MEMORY_STORE=true for a temporary maintenance run.',
    );
  }

  return config;
}

export async function loadTenant(supabase, { tenantId } = {}) {
  assertSupabaseClient(supabase);
  assertTenantId(tenantId);

  const { data, error } = await supabase
    .from('tenants')
    .select('*')
    .eq('id', tenantId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function loadLocation(supabase, { tenantId, locationId } = {}) {
  assertSupabaseClient(supabase);
  assertTenantId(tenantId);
  if (!locationId) return null;

  const { data, error } = await supabase
    .from('locations')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('id', locationId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function loadSiteSettings(supabase, { tenantId, locationId } = {}) {
  assertSupabaseClient(supabase);
  assertTenantId(tenantId);

  return loadLocationScopedRecord(supabase, {
    table: 'site_settings',
    tenantId,
    locationId,
  });
}

export async function loadProviderConnections(supabase, { tenantId, locationId } = {}) {
  assertSupabaseClient(supabase);
  assertTenantId(tenantId);

  const tenantConnections = await loadProviderConnectionsForLocation(supabase, { tenantId, locationId: null });
  const locationConnections = locationId
    ? await loadProviderConnectionsForLocation(supabase, { tenantId, locationId })
    : [];
  const byProvider = new Map();

  for (const connection of tenantConnections) byProvider.set(connection.provider_key, connection);
  for (const connection of locationConnections) byProvider.set(connection.provider_key, connection);

  return [...byProvider.values()];
}

export async function loadFrontendConfig(supabase, { tenantId, locationId } = {}) {
  assertSupabaseClient(supabase);
  assertTenantId(tenantId);

  return loadLocationScopedRecord(supabase, {
    table: 'frontend_configs',
    tenantId,
    locationId,
  });
}

export async function loadTenantRuntimeConfig(supabase, { tenantId, locationId } = {}) {
  assertSupabaseClient(supabase);
  assertTenantId(tenantId);

  const [tenant, location, siteSettings, providerConnections, frontendConfig] = await Promise.all([
    loadTenant(supabase, { tenantId }),
    loadLocation(supabase, { tenantId, locationId }),
    loadSiteSettings(supabase, { tenantId, locationId }),
    loadProviderConnections(supabase, { tenantId, locationId }),
    loadFrontendConfig(supabase, { tenantId, locationId }),
  ]);

  return createTenantConfigFromSupabaseRows({
    tenant,
    location,
    siteSettings,
    providerConnections,
    frontendConfig,
  });
}

export async function updateTenantRuntimeConfig(supabase, config, input = {}) {
  assertSupabaseClient(supabase);
  assertTenantId(config?.tenantId);

  const now = new Date().toISOString();

  const siteSettings = {
    tenant_id: config.tenantId,
    location_id: config.locationId,
    business_name: config.business.name,
    public_brand_name: config.business.publicBrandName,
    address: config.business.address,
    phone: config.business.phone,
    email: config.business.email,
    instagram_handle: config.business.instagramHandle,
    instagram_url: config.business.instagramUrl,
    instagram_posts: config.publicSite.instagramPosts ?? [],
    timezone: config.business.timezone,
    public_site_url: config.publicSite.url,
    theme_key: config.publicSite.theme,
    updated_at: now,
  };
  const frontendConfig = {
    tenant_id: config.tenantId,
    location_id: config.locationId,
    theme_key: config.publicSite.theme,
    business_profile: config.frontend.businessProfile || config.tenant.businessProfile || 'convenience_store_rv',
    sections: config.publicSite.sections ?? [],
    published_config: config.frontend.publishedConfig ?? {},
    draft_config: config.frontend.draftConfig ?? {},
    updated_at: now,
  };

  const [{ error: settingsError }, { error: frontendError }] = await Promise.all([
    supabase
      .from('site_settings')
      .upsert(siteSettings, { onConflict: 'tenant_id,location_id' }),
    supabase
      .from('frontend_configs')
      .upsert(frontendConfig, { onConflict: 'tenant_id,location_id' }),
  ]);
  if (settingsError) throw settingsError;
  if (frontendError) throw frontendError;
}

export async function loadStoreHours(supabase) {
  assertSupabaseClient(supabase);
  const { data, error } = await supabase
    .from('store_hours')
    .select('*');
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function upsertStoreHours(supabase, rows = []) {
  assertSupabaseClient(supabase);
  if (!rows.length) return;
  const now = new Date().toISOString();
  const payload = rows.map(row => ({
    day: row.day,
    open_time: row.closed ? '' : (row.open || ''),
    close_time: row.closed ? '' : (row.close || ''),
    updated_at: now,
  }));
  const { error } = await supabase
    .from('store_hours')
    .upsert(payload, { onConflict: 'day' });
  if (error) throw error;
}

function readEnv(env, name) {
  const value = env[name];
  return typeof value === 'string' ? value.trim() : value;
}

function isHttpUrl(value) {
  return typeof value === 'string' && /^https?:\/\//i.test(value);
}

async function loadLocationScopedRecord(supabase, { table, tenantId, locationId }) {
  if (locationId) {
    const locationRecord = await maybeSingle(
      supabase
        .from(table)
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('location_id', locationId),
    );
    if (locationRecord) return locationRecord;
  }

  return maybeSingle(
    supabase
      .from(table)
      .select('*')
      .eq('tenant_id', tenantId)
      .is('location_id', null),
  );
}

async function loadProviderConnectionsForLocation(supabase, { tenantId, locationId }) {
  let query = supabase
    .from('provider_connections')
    .select('*')
    .eq('tenant_id', tenantId);

  query = locationId
    ? query.eq('location_id', locationId)
    : query.is('location_id', null);

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

async function maybeSingle(query) {
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data;
}

function assertSupabaseClient(supabase) {
  if (!supabase) throw new Error('Supabase client is required.');
}

function assertTenantId(tenantId) {
  if (!tenantId) throw new Error('Tenant id is required.');
}
