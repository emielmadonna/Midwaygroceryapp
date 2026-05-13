import { buildPublicBootstrap } from './public-bootstrap.js';
import { createBookingStore } from './booking-store.js';
import { denormalizeMapSite, rvMapSites } from './rv-map-data.js';
import { createFeatureFlagEvaluator } from './feature-flags.js';
import { quoteBooking } from './rv-booking.js';
import {
  assertProductionPersistence,
  createSupabaseServerClient,
  loadProviderConnections,
  loadTenantRuntimeConfig,
  updateTenantRuntimeConfig,
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
  rvMapSites.map(site => {
    const denormalized = denormalizeMapSite(site);
    return {
      ...denormalized,
      type: denormalized.type === 'pull-through' ? 'pull' : 'back',
    };
  }),
);

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
  tenantId = tenantConfig?.tenantId || DEFAULT_TENANT_ID,
  locationId = tenantConfig?.locationId || DEFAULT_LOCATION_ID,
} = {}) {
  assertProductionPersistence(env);
  const resolvedSupabase = supabase ?? createSupabaseServerClient({ env });
  const hasExplicitTenantConfig = tenantConfig !== null && tenantConfig !== undefined;
  let tenantConfigCache = hasExplicitTenantConfig ? createTenantConfig(tenantConfig) : null;
  const resolvedBookingStore = bookingStore ?? createBookingStore({
    supabase: resolvedSupabase,
    sites: SEEDED_RV_SITES,
    providerConnections: hasExplicitTenantConfig ? providerConnectionsFromTenantConfig(tenantConfigCache) : [],
  });
  const state = {
    rvSites: [...SEEDED_RV_SITES],
    squareProducts,
    fuelPrices,
    hours,
  };
  const flagEvaluator = createFeatureFlagEvaluator({ env, overrides: featureFlagOverrides });

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
      return createProviderConnectionService({
        store: resolvedBookingStore,
        tenantConfig: await resolveTenantConfig(),
        platformProviderConfigs,
      }).listStatuses(input);
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
    async getPublicSiteUrl(options = {}) {
      const resolvedTenantConfig = await resolveTenantConfig(options);
      return resolvedTenantConfig.publicSite?.url || '';
    },
    async getAdminSettings({ featureFlags = {}, refresh = false } = {}) {
      const resolvedTenantConfig = await resolveTenantConfig({ refresh });
      return adminSettingsFromTenantConfig(resolvedTenantConfig, { featureFlags });
    },
    async updateAdminSettings(input) {
      const resolvedTenantConfig = await resolveTenantConfig();
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
      const resolvedTenantConfig = await resolveTenantConfig();
      const flags = flagEvaluator.all();
      const sites = await resolvedBookingStore.listSites({ publicOnly: true });
      const persistedProducts = await resolvedBookingStore.listStoreInventory?.({ activeOnly: true }) ?? [];
      const availability = flags.rvBooking && startDate && endDate
        ? (await resolvedBookingStore.listAvailability({
            startDate,
            endDate,
            publicOnly: true,
          })).map(site => site.id)
        : [];

      return buildPublicBootstrap({
        settings: publicSettingsFromTenantConfig(resolvedTenantConfig),
        hours: state.hours,
        fuelPrices: flags.fuel ? state.fuelPrices : [],
        squareProducts: flags.products ? (persistedProducts.length ? persistedProducts : state.squareProducts) : [],
        rvSites: flags.rvBooking ? sites : [],
        rvAvailability: availability,
        featureFlags: flags,
      });
    },
    async quote(input) {
      const sites = await resolvedBookingStore.listSites();
      const site = sites.find(candidate => candidate.id === input.siteId);
      return quoteBooking({ site, ...input });
    },
    async listSites(input) {
      return resolvedBookingStore.listSites(input);
    },
    async hold(input) {
      return resolvedBookingStore.createHold(input);
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

function findPlatformProviderConfig(records, { providerKey, environment } = {}) {
  return (records ?? []).find(record => (
    (record.providerKey || record.provider_key) === providerKey
    && (!environment || (record.environment || record.publicConfig?.environment || record.public_config?.environment) === environment)
  )) ?? null;
}
