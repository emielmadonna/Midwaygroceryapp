const ISO_DATE_PATTERN = '^\\d{4}-\\d{2}-\\d{2}$';

export function registerCoreTools(registry, { store } = {}) {
  if (!registry) throw new Error('Registry is required.');
  if (!store) throw new Error('Store is required.');

  registry.register({
    name: 'list_settings',
    description: 'Read the current public site and business settings (phone, address, hours of operation, theme, instagram, etc).',
    requiredScope: 'read',
    requiredFlag: 'core.tenant_config',
    sideEffect: 'read',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    handler: async () => {
      const data = await store.getAdminSettings({ featureFlags: store.flags?.() ?? {}, refresh: true });
      return data;
    },
  });

  registry.register({
    name: 'update_settings',
    description: 'Update business profile fields (name, brand, phone, email, address, timezone, theme, instagram handle/url) and dynamic public sections.',
    requiredScope: 'owner',
    requiredFlag: 'core.tenant_config',
    sideEffect: 'mutation',
    auditTarget: { type: 'site_settings', id: 'midway' },
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        business: {
          type: 'object',
          additionalProperties: true,
          properties: {
            businessName: { type: 'string' },
            publicBrandName: { type: 'string' },
            phone: { type: 'string' },
            email: { type: 'string' },
            address: { type: 'string' },
            timezone: { type: 'string' },
            instagramHandle: { type: 'string' },
            instagramUrl: { type: 'string' },
          },
        },
        publicSite: {
          type: 'object',
          additionalProperties: true,
          properties: {
            url: { type: 'string' },
            theme: { type: 'string' },
            sections: { type: 'array', items: { type: 'object', additionalProperties: true, properties: {} } },
          },
        },
      },
    },
    handler: async ({ input }) => store.updateAdminSettings(input),
  });

  registry.register({
    name: 'list_rv_sites',
    description: 'List the RV/tent sites Midway can book, including status, amenities, and admin notes.',
    requiredScope: 'read',
    requiredFlag: 'booking.rv.enabled',
    sideEffect: 'read',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        publicOnly: { type: 'boolean' },
      },
    },
    handler: async ({ input }) => store.listSites({ publicOnly: input.publicOnly === true }),
  });

  registry.register({
    name: 'update_rv_site',
    description: 'Update an RV/tent site\'s status, amenities, nightly price (in cents), or map coordinates.',
    requiredScope: 'write',
    requiredFlag: 'booking.site_status_management',
    sideEffect: 'mutation',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['siteId'],
      properties: {
        siteId: { type: 'string', minLength: 1 },
        status: { type: 'string', enum: ['active', 'inactive', 'maintenance'] },
        nightlyPriceCents: { type: 'integer', minimum: 0 },
        amenities: { type: 'array', items: { type: 'string' } },
        maxRvLengthFeet: { type: 'integer', minimum: 0 },
        adminNotes: { type: 'string' },
        mapX: { type: 'number' },
        mapY: { type: 'number' },
        mapWidth: { type: 'number' },
        mapHeight: { type: 'number' },
        rotation: { type: 'number' },
      },
    },
    handler: async ({ input }) => {
      const { siteId, status, ...rest } = input;
      if (status) {
        await store.updateSiteStatus({ siteId, status });
      }
      const hasDetails = Object.keys(rest).length > 0;
      if (hasDetails) {
        await store.updateSiteDetails({ siteId, ...rest });
      }
      return { siteId, updated: { status: Boolean(status), details: hasDetails } };
    },
  });

  registry.register({
    name: 'list_bookings',
    description: 'List recent RV bookings, optionally filtered by date range or status. Returns booking codes, guests, sites, dates, totals.',
    requiredScope: 'read',
    sideEffect: 'read',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        startDate: { type: 'string', pattern: ISO_DATE_PATTERN },
        endDate: { type: 'string', pattern: ISO_DATE_PATTERN },
        status: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 200 },
      },
    },
    handler: async ({ input }) => store.listBookings(input),
  });

  registry.register({
    name: 'get_booking',
    description: 'Fetch a single booking by booking code (e.g. MW-ABC123).',
    requiredScope: 'read',
    sideEffect: 'read',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['bookingCode'],
      properties: { bookingCode: { type: 'string', minLength: 4 } },
    },
    handler: async ({ input }) => store.getBooking(input.bookingCode),
  });

  registry.register({
    name: 'create_booking',
    description: 'Create a manual admin booking for a site on a date range with a customer. Use when an owner books on behalf of a guest (no Square payment link).',
    requiredScope: 'write',
    requiredFlag: 'booking.manual_admin',
    sideEffect: 'mutation',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['siteId', 'startDate', 'endDate', 'customer'],
      properties: {
        siteId: { type: 'string', minLength: 1 },
        siteIds: { type: 'array', items: { type: 'string' } },
        startDate: { type: 'string', pattern: ISO_DATE_PATTERN },
        endDate: { type: 'string', pattern: ISO_DATE_PATTERN },
        guests: { type: 'integer', minimum: 1 },
        vehicles: { type: 'integer', minimum: 0 },
        customer: {
          type: 'object',
          required: ['name'],
          additionalProperties: false,
          properties: {
            name: { type: 'string', minLength: 1 },
            phone: { type: 'string' },
            email: { type: 'string' },
          },
        },
        status: { type: 'string', enum: ['confirmed', 'pending', 'blocked'] },
        notes: { type: 'string' },
      },
    },
    handler: async ({ input }) => store.createAdminBooking(input),
  });

  registry.register({
    name: 'cancel_booking',
    description: 'Cancel a booking by code. Does not issue a refund.',
    requiredScope: 'write',
    sideEffect: 'destructive',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['bookingCode'],
      properties: {
        bookingCode: { type: 'string', minLength: 4 },
        reason: { type: 'string' },
      },
    },
    handler: async ({ input, actor }) => store.updateBookingStatus({
      bookingCode: input.bookingCode,
      status: 'canceled',
      reason: input.reason || 'Canceled via tool',
      actor,
    }),
  });

  registry.register({
    name: 'refund_booking',
    description: 'Refund a paid booking via Square. Requires owner scope.',
    requiredScope: 'owner',
    requiredFlag: 'payments.refunds',
    sideEffect: 'destructive',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['bookingCode', 'reason'],
      properties: {
        bookingCode: { type: 'string', minLength: 4 },
        reason: { type: 'string', minLength: 4 },
      },
    },
    handler: async ({ input, actor }) => store.updateBookingStatus({
      bookingCode: input.bookingCode,
      status: 'refunded',
      reason: input.reason,
      actor,
      issueRefund: true,
    }),
  });

  registry.register({
    name: 'block_rv_site',
    description: 'Reserve a site for the owner (e.g. for maintenance or a personal hold) without a paying customer.',
    requiredScope: 'write',
    sideEffect: 'mutation',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['siteId', 'startDate', 'endDate'],
      properties: {
        siteId: { type: 'string', minLength: 1 },
        startDate: { type: 'string', pattern: ISO_DATE_PATTERN },
        endDate: { type: 'string', pattern: ISO_DATE_PATTERN },
        reason: { type: 'string' },
      },
    },
    handler: async ({ input, actor }) => store.createAdminBooking({
      siteId: input.siteId,
      startDate: input.startDate,
      endDate: input.endDate,
      status: 'blocked',
      customer: { name: 'Owner Hold', phone: '' },
      notes: input.reason || 'Blocked via tool',
      actor,
    }),
  });

  registry.register({
    name: 'list_provider_statuses',
    description: 'List Midway\'s third-party provider connections (Square, Instagram, Slack) with their connection status.',
    requiredScope: 'read',
    requiredFlag: 'core.provider_adapters',
    sideEffect: 'read',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    handler: async () => store.listProviderStatuses(),
  });

  registry.register({
    name: 'list_notifications',
    description: 'List recent operator notifications (booking confirmations, low stock alerts, etc).',
    requiredScope: 'read',
    sideEffect: 'read',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 200 },
      },
    },
    handler: async ({ input }) => store.listNotifications(input),
  });

  registry.register({
    name: 'list_audit_log',
    description: 'List recent admin audit log entries (who did what when).',
    requiredScope: 'owner',
    requiredFlag: 'core.audit_log',
    sideEffect: 'read',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 500 },
      },
    },
    handler: async ({ input }) => store.listAuditLogs(input),
  });

  registry.register({
    name: 'list_fuel_prices',
    description: 'Read current pump prices for non-ethanol and diesel.',
    requiredScope: 'read',
    requiredFlag: 'fuel.prices',
    sideEffect: 'read',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    handler: async () => store.listFuelPrices(),
  });

  registry.register({
    name: 'update_fuel_price',
    description: 'Set the pump price for a single fuel type (unleaded or diesel).',
    requiredScope: 'write',
    requiredFlag: 'fuel.prices',
    sideEffect: 'mutation',
    auditTarget: { type: 'fuel_prices', id: 'midway' },
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'price'],
      properties: {
        type: { type: 'string', enum: ['unleaded', 'diesel'] },
        price: { type: 'number', minimum: 0, maximum: 50 },
      },
    },
    handler: async ({ input }) => store.updateFuelPrice(input),
  });

  registry.register({
    name: 'list_fuel_inventory',
    description: 'Read tank levels per fuel type (current gallons, capacity, alert threshold, percent full).',
    requiredScope: 'read',
    requiredFlag: 'fuel.tank_levels',
    sideEffect: 'read',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    handler: async () => store.listFuelInventory(),
  });

  registry.register({
    name: 'update_fuel_inventory',
    description: 'Update tank levels for a fuel type. Any field is optional but type is required.',
    requiredScope: 'write',
    requiredFlag: 'fuel.tank_levels',
    sideEffect: 'mutation',
    auditTarget: { type: 'fuel_inventory', id: 'midway' },
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['type'],
      properties: {
        type: { type: 'string', enum: ['unleaded', 'diesel'] },
        currentGallons: { type: 'integer', minimum: 0, maximum: 100000 },
        capacityGallons: { type: 'integer', minimum: 1, maximum: 100000 },
        alertThreshold: { type: 'integer', minimum: 0, maximum: 100000 },
      },
    },
    handler: async ({ input }) => store.updateFuelInventory(input),
  });

  registry.register({
    name: 'admin_dashboard_today',
    description: 'Snapshot of today\'s arrivals, departures, occupancy, and totals.',
    requiredScope: 'read',
    sideEffect: 'read',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        from: { type: 'string', pattern: ISO_DATE_PATTERN },
        to: { type: 'string', pattern: ISO_DATE_PATTERN },
      },
    },
    handler: async ({ input }) => store.adminDashboard(input),
  });

  return registry;
}
