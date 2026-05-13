const DEFAULT_FLAGS = {
  'core.tenant_config': true,
  'core.roles': true,
  'core.audit_log': true,
  'core.provider_adapters': true,
  'core.feature_flags': true,
  'admin.dashboard': true,
  'admin.auth.sessions': true,
  'admin.employee_mode': true,
  'public.dynamic_sections': true,
  'public.theme_skins': true,
  'public.section.hero': true,
  'public.section.services': true,
  'public.section.location': true,
  'public.section.hours_contact': true,
  'public.section.instagram': true,
  'public.section.gallery': false,
  'public.section.events': false,
  'booking.rv.enabled': true,
  'booking.property_map': true,
  'booking.holds': true,
  'booking.manual_admin': true,
  'booking.site_status_management': true,
  'booking.admin_calendar': false,
  'booking.admin_property_map': false,
  'booking.email_confirmations': true,
  'payments.enabled': true,
  'payments.provider.square': true,
  'payments.refunds': false,
  'inventory.cache': false,
  'inventory.low_stock_alerts': false,
  'fuel.prices': false,
  'fuel.tank_levels': false,
  'accounting.summaries': false,
  'accounting.exceptions': false,
  'accounting.export_packet': false,
  'ai.command_box': false,
  'ai.auto_actions': false,
  'mcp.server': false,
  'mcp.read_tools': false,
  'mcp.action_tools': false,
  'mcp.high_risk_tools': false,
  'messaging.email': true,
  'notifications.dashboard': true,
  'notifications.slack': false,
  'notifications.booking_confirmations': true,
  'messaging.sms': false,
  'messaging.staff_alerts': false,
  'domains.custom_domains': false,
};

const ROLE_OVERRIDES = {
  employee: {
    'booking.manual_admin': false,
    'payments.refunds': false,
    'core.audit_log': false,
  },
};

export function createFeatureFlagEvaluator({
  env = process.env,
  overrides = {},
  tenant = 'midway',
  location = 'plain',
  role = null,
  providerHealth = {},
} = {}) {
  const envOverrides = parseFlags(readEnv(env, 'FEATURE_FLAGS_JSON'));
  const envKeyOverrides = parseEnvFlagKeys(env);
  const merged = {
    ...DEFAULT_FLAGS,
    ...envOverrides,
    ...envKeyOverrides,
    ...overrides,
    ...(role ? ROLE_OVERRIDES[role] ?? {} : {}),
  };

  return {
    context: {
      tenant,
      location,
      role,
      environment: readEnv(env, 'NODE_ENV') || 'development',
    },
    all() {
      return toResponseFlags(merged, providerHealth);
    },
    isEnabled(flag) {
      return isFlagEnabled(merged[flag], providerHealth[flag]);
    },
    require(flag) {
      if (!isFlagEnabled(merged[flag], providerHealth[flag])) {
        const error = new Error(`Feature is disabled: ${flag}`);
        error.statusCode = 404;
        error.code = 'FEATURE_DISABLED';
        error.flag = flag;
        throw error;
      }
    },
  };
}

export function toResponseFlags(flags, providerHealth = {}) {
  const resolved = {};
  for (const [flag, value] of Object.entries(flags)) {
    resolved[flag] = isFlagEnabled(value, providerHealth[flag]);
  }

  return {
    ...resolved,
    fuel: resolved['fuel.prices'],
    products: resolved['inventory.cache'],
    rvBooking: resolved['booking.rv.enabled'],
    events: resolved['public.section.events'],
    coffee: resolved['public.section.services'],
    hours: resolved['public.section.hours_contact'],
    instagram: resolved['public.section.instagram'],
    adminDashboard: resolved['admin.dashboard'],
    manualAdminBooking: resolved['booking.manual_admin'],
    adminCalendar: resolved['booking.admin_calendar'],
    adminPropertyMap: resolved['booking.admin_property_map'],
    refunds: resolved['payments.refunds'],
    employeeMode: resolved['admin.employee_mode'],
  };
}

export function parseFlags(value) {
  if (!value) return {};
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).map(([key, raw]) => [key, normalizeFlagValue(raw)]));
  } catch {
    return {};
  }
}

function parseEnvFlagKeys(env) {
  const flags = {};
  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith('FEATURE_FLAG_')) continue;
    const flag = key
      .slice('FEATURE_FLAG_'.length)
      .toLowerCase()
      .replaceAll('__', '-')
      .replaceAll('_', '.');
    flags[flag] = normalizeFlagValue(value);
  }
  return flags;
}

function normalizeFlagValue(value) {
  if (typeof value === 'string') {
    const lower = value.trim().toLowerCase();
    if (['true', 'enabled', 'on', '1'].includes(lower)) return true;
    if (['false', 'disabled', 'off', '0'].includes(lower)) return false;
    if (lower === 'preview') return 'preview';
  }
  return value;
}

function isFlagEnabled(value, providerHealthy = true) {
  if (providerHealthy === false) return false;
  return value === true || value === 'enabled' || value === 'preview';
}

function readEnv(env, name) {
  const value = env[name];
  return typeof value === 'string' ? value.trim() : value;
}
