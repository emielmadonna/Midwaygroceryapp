import { buildPublicBootstrap } from './public-bootstrap.js';
import { createBookingStore } from './booking-store.js';
import { bookableMapSites, denormalizeMapSite } from './rv-map-data.js';
import { createFeatureFlagEvaluator } from './feature-flags.js';
import {
  fetchInstagramFeed,
  instagramProviderConfigFromEnv,
  mergeInstagramProviderConfig,
} from './instagram-api.js';
import { quoteBooking, quoteMultiSiteBooking } from './rv-booking.js';
import {
  assertProductionPersistence,
  createSupabaseServerClient,
  loadFuelInventory,
  loadFuelPrices,
  loadProviderConnections,
  loadStoreHours,
  loadTenantRuntimeConfig,
  updateTenantRuntimeConfig,
  upsertFuelInventory,
  upsertFuelPrice,
  upsertStoreHours,
} from './supabase-server.js';
import {
  DEFAULT_LOCATION_ID,
  DEFAULT_TENANT_ID,
  adminSettingsFromTenantConfig,
  createTenantConfig,
  publicSettingsFromTenantConfig,
  updateTenantConfigSettings,
} from './tenant-config.js';
import {
  createProviderConnectionService,
  providerConnectionsFromTenantConfig,
} from './provider-connections.js';

export const SEEDED_RV_SITES = withSquareCatalog(
  bookableMapSites.map(site => {
    const denormalized = denormalizeMapSite(site);
    return {
      ...denormalized,
      type: denormalized.type === 'pull-through'
        ? 'pull'
        : denormalized.type === 'tent'
          ? 'tent'
          : 'back',
    };
  }),
);

export const SEEDED_RV_BOOKINGS = Object.freeze([
  {
    id: 'seed-block-rv-07-2026-06-20',
    bookingCode: 'BLOCK-RV07-JUN20',
    rvSiteId: 'rv-07',
    customer: { name: 'Owner Hold', phone: '' },
    customerName: 'Owner Hold',
    customerPhone: '',
    customerEmail: null,
    startDate: '2026-06-20',
    endDate: '2026-06-21',
    nights: 1,
    guests: 1,
    vehicles: 1,
    subtotalCents: 0,
    taxCents: 0,
    feeCents: 0,
    totalCents: 0,
    currency: 'USD',
    status: 'blocked',
    source: 'admin',
    createdAt: '2026-05-20T00:00:00.000Z',
    updatedAt: '2026-05-20T00:00:00.000Z',
  },
  {
    id: 'seed-block-rv-08-2026-06-20',
    bookingCode: 'BLOCK-RV08-JUN20',
    rvSiteId: 'rv-08',
    customer: { name: 'Owner Hold', phone: '' },
    customerName: 'Owner Hold',
    customerPhone: '',
    customerEmail: null,
    startDate: '2026-06-20',
    endDate: '2026-06-21',
    nights: 1,
    guests: 1,
    vehicles: 1,
    subtotalCents: 0,
    taxCents: 0,
    feeCents: 0,
    totalCents: 0,
    currency: 'USD',
    status: 'blocked',
    source: 'admin',
    createdAt: '2026-05-20T00:00:00.000Z',
    updatedAt: '2026-05-20T00:00:00.000Z',
  },
]);

export function createMidwayHarness({
  squareProducts = [],
  fuelPrices = [],
  hours = [],
  bookingStore = null,
  supabase = null,
  env = process.env,
  featureFlagOverrides = {},
  tenantConfig = null,
  platformProviderConfigs = [],
  fetchImpl = globalThis.fetch,
  tenantId = tenantConfig?.tenantId || DEFAULT_TENANT_ID,
  locationId = tenantConfig?.locationId || DEFAULT_LOCATION_ID,
} = {}) {
  assertProductionPersistence(env);
  const resolvedSupabase = supabase ?? createSupabaseServerClient({ env });
  const hasExplicitTenantConfig = tenantConfig !== null && tenantConfig !== undefined;
  let tenantConfigCache = hasExplicitTenantConfig ? createTenantConfig(tenantConfig) : null;
  const resolvedBookingStore = bookingStore ?? createBookingStore({
    supabase: resolvedSupabase,
    env,
    sites: SEEDED_RV_SITES,
    bookings: SEEDED_RV_BOOKINGS,
    providerConnections: hasExplicitTenantConfig ? providerConnectionsFromTenantConfig(tenantConfigCache) : [],
  });
  const state = {
    rvSites: [...SEEDED_RV_SITES],
    squareProducts,
    fuelPrices,
    hours,
  };
  const flagEvaluator = createFeatureFlagEvaluator({ env, overrides: featureFlagOverrides });

  async function safeLoadStoreHours() {
    if (!resolvedSupabase) return [];
    try {
      const rows = await loadStoreHours(resolvedSupabase);
      return rows.map(row => normalizeHourRow(row)).filter(Boolean);
    } catch (error) {
      console.warn('[Hours] Failed to load store_hours:', error.message);
      return [];
    }
  }

  return {
    state,
    tenantId,
    locationId,
    get tenantConfig() {
      return tenantConfigCache;
    },
    async getTenantConfig({ refresh = false } = {}) {
      return resolveTenantConfig({ refresh });
    },
    flags({ role = null } = {}) {
      return createFeatureFlagEvaluator({ env, overrides: featureFlagOverrides, role }).all();
    },
    async getProviderConfig(providerKey, options = {}) {
      const resolvedTenantConfig = await resolveTenantConfig(options);
      return createProviderConnectionService({
        store: resolvedBookingStore,
        tenantConfig: resolvedTenantConfig,
        platformProviderConfigs,
      }).getProviderConfig(providerKey);
    },
    async listProviderStatuses(input) {
      const statuses = await createProviderConnectionService({
        store: resolvedBookingStore,
        tenantConfig: await resolveTenantConfig(),
        platformProviderConfigs,
      }).listStatuses(input);
      return mergeInstagramStatusFromEnv(statuses, env);
    },
    async listProviderConnections(input) {
      if (resolvedSupabase) {
        return loadProviderConnections(resolvedSupabase, {
          tenantId,
          locationId,
          ...input,
        });
      }
      return resolvedBookingStore.listProviderConnections?.(input) ?? [];
    },
    async getProviderConnection(input) {
      if (resolvedSupabase) {
        const connections = await loadProviderConnections(resolvedSupabase, {
          tenantId,
          locationId,
          ...input,
        });
        return connections.find(connection => (
          connection.provider_key === input?.providerKey
          || connection.providerKey === input?.providerKey
        )) ?? null;
      }
      return resolvedBookingStore.getProviderConnection?.(input) ?? null;
    },
    async upsertProviderConnection(input) {
      return resolvedBookingStore.upsertProviderConnection?.(input);
    },
    async getPlatformProviderConfig(input = {}) {
      return findPlatformProviderConfig(platformProviderConfigs, input);
    },
    async startSquareOAuth(input) {
      return createProviderConnectionService({
        store: resolvedBookingStore,
        tenantConfig: await resolveTenantConfig(),
        platformProviderConfigs,
      }).startSquareOAuth(input);
    },
    async completeSquareOAuth(input) {
      return createProviderConnectionService({
        store: resolvedBookingStore,
        tenantConfig: await resolveTenantConfig(),
        platformProviderConfigs,
      }).completeSquareOAuth(input);
    },
    async upsertInstagramConnection(input) {
      return createProviderConnectionService({
        store: resolvedBookingStore,
        tenantConfig: await resolveTenantConfig(),
        platformProviderConfigs,
        fetchImpl,
      }).upsertInstagramConnection(input);
    },
    async refreshInstagramConnection(input) {
      return createProviderConnectionService({
        store: resolvedBookingStore,
        tenantConfig: await resolveTenantConfig(),
        platformProviderConfigs,
        fetchImpl,
      }).refreshInstagramConnection(input);
    },
    async getPublicSiteUrl(options = {}) {
      const resolvedTenantConfig = await resolveTenantConfig(options);
      return resolvedTenantConfig.publicSite?.url || '';
    },
    async getAdminSettings({ featureFlags = {}, refresh = false } = {}) {
      const resolvedTenantConfig = await resolveTenantConfig({ refresh });
      return adminSettingsFromTenantConfig(resolvedTenantConfig, { featureFlags });
    },
    async updateAdminSettings(input) {
      const resolvedTenantConfig = await resolveTenantConfig({ refresh: true });
      updateTenantConfigSettings(resolvedTenantConfig, input);
      if (resolvedSupabase) {
        await updateTenantRuntimeConfig(resolvedSupabase, resolvedTenantConfig, input);
      }
      return adminSettingsFromTenantConfig(resolvedTenantConfig, {
        featureFlags: createFeatureFlagEvaluator({ env, overrides: featureFlagOverrides, role: 'owner' }).all(),
      });
    },
    requireFeature(flag, { role = null } = {}) {
      return createFeatureFlagEvaluator({ env, overrides: featureFlagOverrides, role }).require(flag);
    },
    async publicBootstrap({ startDate, endDate } = {}) {
      const resolvedTenantConfig = await resolveTenantConfig({ refresh: true });
      const flags = flagEvaluator.all();
      const sites = await resolvedBookingStore.listSites({ publicOnly: true });
      const persistedProducts = await resolvedBookingStore.listStoreInventory?.({ activeOnly: true }) ?? [];
      const settings = publicSettingsFromTenantConfig(resolvedTenantConfig);
      const instagramFeed = flags.instagram
        ? await resolveInstagramFeed({
            store: this,
            env,
            fetchImpl,
          })
        : [];
      const availability = flags.rvBooking && startDate && endDate
        ? (await resolvedBookingStore.listAvailability({
            startDate,
            endDate,
            publicOnly: true,
          })).map(site => site.id)
        : [];
      const persistedHours = await safeLoadStoreHours();
      const hoursForBootstrap = persistedHours.length ? persistedHours : state.hours;
      const persistedFuelPrices = flags.fuel ? await safeLoadFuelPrices() : [];
      const fuelForBootstrap = persistedFuelPrices.length
        ? persistedFuelPrices.map(normalizeFuelPriceRow).filter(Boolean)
        : (state.fuelPrices || []);

      return buildPublicBootstrap({
        settings: {
          ...settings,
          instagramFeed,
        },
        hours: hoursForBootstrap,
        fuelPrices: flags.fuel ? fuelForBootstrap : [],
        squareProducts: flags.products ? (persistedProducts.length ? persistedProducts : state.squareProducts) : [],
        rvSites: flags.rvBooking ? sites : [],
        rvAvailability: availability,
        featureFlags: flags,
      });
    },
    async quote(input) {
      const sites = await resolvedBookingStore.listSites();
      if (Array.isArray(input.siteIds) && input.siteIds.length > 1) {
        return quoteMultiSiteBooking({ sites, ...input });
      }
      const site = sites.find(candidate => candidate.id === input.siteId);
      return quoteBooking({ site, ...input });
    },
    async listSites(input) {
      return resolvedBookingStore.listSites(input);
    },
    async hold(input) {
      return resolvedBookingStore.createHold(input);
    },
    async releaseHold(input) {
      return resolvedBookingStore.releaseHold(input);
    },
    async recordPendingBooking({ hold, customer, bookingCode, squareOrderId, checkoutUrl }) {
      return resolvedBookingStore.createPendingBooking({
        holdId: hold.id,
        hold,
        customer,
        bookingCode,
        squareOrderId,
        checkoutUrl,
      });
    },
    async getBooking(bookingCode) {
      return resolvedBookingStore.getBooking(bookingCode);
    },
    async listStoreHours() {
      const persisted = await safeLoadStoreHours();
      const source = persisted.length ? persisted : state.hours;
      return mergeHoursWithDefaults(source);
    },
    async updateStoreHours(rows = []) {
      const normalized = normalizeHoursInput(rows);
      if (resolvedSupabase) {
        await upsertStoreHours(resolvedSupabase, normalized);
      }
      state.hours = normalized;
      return mergeHoursWithDefaults(normalized);
    },
    async recordDriverLicenseUpload(input) {
      return resolvedBookingStore.recordDriverLicenseUpload?.(input);
    },
    async listBookings(input) {
      return resolvedBookingStore.listBookings(input);
    },
    async createAdminBooking(input) {
      return resolvedBookingStore.createAdminBooking(input);
    },
    async updateBookingStatus(input) {
      return resolvedBookingStore.updateBookingStatus(input);
    },
    async updateSiteStatus(input) {
      return resolvedBookingStore.updateSiteStatus(input);
    },
    async updateSiteDetails(input) {
      return resolvedBookingStore.updateSiteDetails(input);
    },
    async listStoreInventory(input) {
      return resolvedBookingStore.listStoreInventory?.(input) ?? [];
    },
    async upsertStoreInventory(input) {
      return resolvedBookingStore.upsertStoreInventory?.(input) ?? [];
    },
    async findStoreInventoryByVariationId(input) {
      return resolvedBookingStore.findStoreInventoryByVariationId?.(input) ?? null;
    },
    async listFuelPrices() {
      const rows = await safeLoadFuelPrices();
      if (rows.length) return rows.map(normalizeFuelPriceRow).filter(Boolean);
      return (state.fuelPrices || []).map(normalizeFuelPriceRow).filter(Boolean);
    },
    async updateFuelPrice({ type, price } = {}) {
      if (!type) throw badRequest('Fuel type is required.');
      if (!['unleaded', 'diesel'].includes(type)) throw badRequest('Fuel type must be "unleaded" or "diesel".');
      const numeric = Number(price);
      if (!Number.isFinite(numeric) || numeric < 0) throw badRequest('Fuel price must be a non-negative number.');
      if (resolvedSupabase) {
        await upsertFuelPrice(resolvedSupabase, { type, price: numeric });
      }
      state.fuelPrices = (state.fuelPrices || []).filter(row => row.type !== type)
        .concat([{ type, price: numeric, updatedAt: new Date().toISOString() }]);
      return { type, price: numeric };
    },
    async listFuelInventory() {
      const rows = await safeLoadFuelInventory();
      return rows.map(normalizeFuelInventoryRow).filter(Boolean);
    },
    async updateFuelInventory({ type, currentGallons, capacityGallons, alertThreshold } = {}) {
      if (!type) throw badRequest('Fuel type is required.');
      if (!['unleaded', 'diesel'].includes(type)) throw badRequest('Fuel type must be "unleaded" or "diesel".');
      if (currentGallons !== undefined && (!Number.isFinite(Number(currentGallons)) || Number(currentGallons) < 0)) {
        throw badRequest('currentGallons must be a non-negative number.');
      }
      if (capacityGallons !== undefined && (!Number.isFinite(Number(capacityGallons)) || Number(capacityGallons) <= 0)) {
        throw badRequest('capacityGallons must be a positive number.');
      }
      if (alertThreshold !== undefined && (!Number.isFinite(Number(alertThreshold)) || Number(alertThreshold) < 0)) {
        throw badRequest('alertThreshold must be a non-negative number.');
      }
      if (resolvedSupabase) {
        await upsertFuelInventory(resolvedSupabase, { type, currentGallons, capacityGallons, alertThreshold });
      }
      const rows = await safeLoadFuelInventory();
      return rows.map(normalizeFuelInventoryRow).find(row => row?.type === type) || null;
    },
    async adminDashboard({ from, to } = {}) {
      const [sites, bookings, notifications] = await Promise.all([
        resolvedBookingStore.listSites(),
        resolvedBookingStore.listBookings({ from, to }),
        resolvedBookingStore.listNotifications?.({ limit: 10 }) ?? [],
      ]);

      return buildAdminDashboard({ sites, bookings, notifications });
    },
    async confirmBooking(input) {
      return resolvedBookingStore.confirmBooking(input);
    },
    async recordSquareEvent(input) {
      return resolvedBookingStore.recordSquareEvent(input);
    },
    async markSquareEvent(input) {
      return resolvedBookingStore.markSquareEvent(input);
    },
    async recordAuditLog(input) {
      return resolvedBookingStore.recordAuditLog?.(input);
    },
    async listAuditLogs(input) {
      return resolvedBookingStore.listAuditLogs?.(input) ?? [];
    },
    async recordNotification(input) {
      return resolvedBookingStore.recordNotification?.(input);
    },
    async listNotifications(input) {
      return resolvedBookingStore.listNotifications?.(input) ?? [];
    },
  };

  async function resolveTenantConfig({ refresh = false } = {}) {
    if (tenantConfigCache && (!refresh || hasExplicitTenantConfig)) return tenantConfigCache;
    if (!resolvedSupabase) {
      throw new Error('Tenant config requires Supabase or an explicit in-memory tenantConfig.');
    }

    tenantConfigCache = await loadTenantRuntimeConfig(resolvedSupabase, {
      tenantId,
      locationId,
    });
    return tenantConfigCache;
  }

  async function safeLoadFuelPrices() {
    if (!resolvedSupabase) return [];
    try {
      return await loadFuelPrices(resolvedSupabase);
    } catch (error) {
      console.warn('[Fuel] load fuel_prices failed:', error.message);
      return [];
    }
  }

  async function safeLoadFuelInventory() {
    if (!resolvedSupabase) return [];
    try {
      return await loadFuelInventory(resolvedSupabase);
    } catch (error) {
      console.warn('[Fuel] load fuel_inventory failed:', error.message);
      return [];
    }
  }
}

function normalizeFuelPriceRow(row) {
  if (!row || !row.type) return null;
  const price = Number(row.price);
  if (!Number.isFinite(price)) return null;
  return { type: row.type, price, updatedAt: row.updated_at ?? row.updatedAt ?? null };
}

function normalizeFuelInventoryRow(row) {
  if (!row || !row.type) return null;
  const currentGallons = Number(row.current_gallons ?? row.currentGallons ?? 0);
  const capacityGallons = Number(row.capacity_gallons ?? row.capacityGallons ?? 0);
  const alertThreshold = Number(row.alert_threshold ?? row.alertThreshold ?? 0);
  const percentFull = capacityGallons > 0 ? Math.round((currentGallons / capacityGallons) * 100) : 0;
  return {
    type: row.type,
    currentGallons,
    capacityGallons,
    alertThreshold,
    percentFull,
    belowThreshold: alertThreshold > 0 && currentGallons <= alertThreshold,
    updatedAt: row.updated_at ?? row.updatedAt ?? null,
  };
}

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = 'FUEL_INVALID';
  return error;
}

function buildAdminDashboard({ sites, bookings, notifications }) {
  const today = new Date().toISOString().slice(0, 10);
  const activeStatuses = new Set(['hold', 'paid', 'confirmed', 'blocked']);
  const activeBookings = bookings.filter(booking => activeStatuses.has(booking.status));
  const arrivalsToday = activeBookings.filter(booking => booking.startDate === today);
  const departuresToday = activeBookings.filter(booking => booking.endDate === today);
  const occupiedTonight = activeBookings.filter(booking => booking.startDate <= today && booking.endDate > today);
  const openAlerts = [
    ...bookings
      .filter(booking => booking.status === 'hold')
      .map(booking => ({
        type: 'payment_pending',
        label: `${booking.bookingCode} is waiting on payment`,
        bookingCode: booking.bookingCode,
      })),
    ...notifications
      .filter(notification => notification.status === 'failed')
      .map(notification => ({
        type: 'notification_failed',
        label: `${notification.channel} failed for ${notification.bookingCode ?? notification.recipient}`,
        bookingCode: notification.bookingCode,
      })),
  ];

  return {
    today,
    totals: {
      sites: sites.length,
      activeBookings: activeBookings.length,
      occupiedTonight: occupiedTonight.length,
      availableTonight: Math.max(sites.filter(site => site.status === 'active').length - occupiedTonight.length, 0),
      arrivalsToday: arrivalsToday.length,
      departuresToday: departuresToday.length,
      openAlerts: openAlerts.length,
      revenueCents: bookings
        .filter(booking => ['paid', 'confirmed'].includes(booking.status))
        .reduce((sum, booking) => sum + Number(booking.totalCents ?? 0), 0),
    },
    arrivalsToday,
    departuresToday,
    occupiedTonight,
    openAlerts,
    notifications,
  };
}

function withSquareCatalog(sites) {
  return sites.map(site => {
    const ampKey = site.amp === '50A' ? '50A' : '30A';
    return {
      ...site,
      sku: site.sku || `RV-${ampKey}-NIGHT`,
      squareCatalogObjectId: site.squareCatalogObjectId || null,
    };
  });
}

async function resolveInstagramFeed({ store, env, fetchImpl }) {
  const providerConfig = await store.getProviderConfig?.('instagram');
  const envConfig = instagramProviderConfigFromEnv(env);
  const config = mergeInstagramProviderConfig(providerConfig, envConfig);
  const limit = Number(config.feedLimit || config.feed_limit || env.INSTAGRAM_FEED_LIMIT || 6);

  if (!config.accessToken || !(config.instagramUserId || config.externalAccountId || config.externalLocationId)) {
    return [];
  }

  try {
    return await fetchInstagramFeed({
      config,
      limit,
      fetchImpl,
    });
  } catch (error) {
    console.warn('[Instagram] Feed sync unavailable:', error.message);
    return [];
  }
}

function mergeInstagramStatusFromEnv(statuses, env) {
  const envConfig = instagramProviderConfigFromEnv(env);
  if (!envConfig.accessToken && !envConfig.instagramUserId) return statuses;

  return statuses.map(status => {
    if (status.providerKey !== 'instagram') return status;
    const fullyConfigured = Boolean(envConfig.accessToken && envConfig.instagramUserId);
    return {
      ...status,
      status: fullyConfigured ? 'connected' : 'not_connected',
      publicConfig: {
        ...status.publicConfig,
        feedSource: 'Instagram Graph API',
        feedLimit: envConfig.feedLimit,
        apiVersion: envConfig.apiVersion,
      },
      externalAccountId: envConfig.instagramUserId || status.externalAccountId,
      hasEncryptedCredentials: Boolean(envConfig.accessToken) || status.hasEncryptedCredentials,
      credentialKeys: envConfig.accessToken
        ? Array.from(new Set([...(status.credentialKeys || []), 'accessToken']))
        : status.credentialKeys,
      errorMessage: fullyConfigured ? '' : 'Instagram API feed is missing an access token or user ID.',
    };
  });
}

function findPlatformProviderConfig(records, { providerKey, environment } = {}) {
  return (records ?? []).find(record => (
    (record.providerKey || record.provider_key) === providerKey
    && (!environment || (record.environment || record.publicConfig?.environment || record.public_config?.environment) === environment)
  )) ?? null;
}

const HOURS_DAY_ORDER = Object.freeze([
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
]);

function normalizeHourRow(row = {}) {
  const day = String(row.day || '').toLowerCase();
  if (!HOURS_DAY_ORDER.includes(day)) return null;
  const open = String(row.open ?? row.open_time ?? '').trim();
  const close = String(row.close ?? row.close_time ?? '').trim();
  const closed = row.closed === true || (!open && !close);
  return closed ? { day, closed: true } : { day, open, close };
}

function normalizeHoursInput(rows = []) {
  if (!Array.isArray(rows)) return [];
  const seen = new Map();
  for (const row of rows) {
    const normalized = normalizeHourRow(row);
    if (normalized) seen.set(normalized.day, normalized);
  }
  return HOURS_DAY_ORDER
    .filter(day => seen.has(day))
    .map(day => seen.get(day));
}

function mergeHoursWithDefaults(rows = []) {
  const byDay = new Map(rows.map(row => [row.day, row]));
  return HOURS_DAY_ORDER.map(day => byDay.get(day) || { day, closed: true });
}
