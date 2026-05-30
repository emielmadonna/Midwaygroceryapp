import crypto from 'node:crypto';

const TABLE = 'admin_api_tokens';
const TOKEN_PREFIX_LIVE = 'mw_live_';
const TOKEN_PREFIX_TEST = 'mw_test_';
const SECRET_BYTES = 24;
const VALID_SCOPES = new Set(['read', 'write', 'owner']);

export function createApiTokenService({ supabase, env = process.env } = {}) {
  if (!supabase) {
    return createDisabledService();
  }

  return {
    async list({ tenantId = 'midway', includeRevoked = false } = {}) {
      let query = supabase
        .from(TABLE)
        .select('id, tenant_id, location_id, name, token_prefix, scope, created_by_email, last_used_at, expires_at, revoked_at, created_at')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false });
      if (!includeRevoked) query = query.is('revoked_at', null);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []).map(toPublicRecord);
    },

    async mint({
      tenantId = 'midway',
      locationId = null,
      name,
      scope = 'write',
      expiresAt = null,
      createdByEmail = null,
      mode = isProduction(env) ? 'live' : 'test',
    }) {
      if (!name || typeof name !== 'string' || name.trim().length < 2) {
        throw badRequest('Token name is required.');
      }
      if (!VALID_SCOPES.has(scope)) {
        throw badRequest(`Token scope must be one of ${[...VALID_SCOPES].join(', ')}.`);
      }
      const token = generateToken(mode);
      const tokenHash = hashToken(token);
      const tokenPrefix = token.slice(0, 12);
      const { data, error } = await supabase
        .from(TABLE)
        .insert({
          tenant_id: tenantId,
          location_id: locationId,
          name: name.trim(),
          token_hash: tokenHash,
          token_prefix: tokenPrefix,
          scope,
          created_by_email: createdByEmail || null,
          expires_at: expiresAt || null,
        })
        .select('id, tenant_id, location_id, name, token_prefix, scope, created_by_email, expires_at, created_at')
        .single();
      if (error) throw error;
      return {
        token,
        record: toPublicRecord(data),
      };
    },

    async revoke({ id, tenantId = 'midway', revokedByEmail = null } = {}) {
      if (!id) throw badRequest('Token id is required.');
      const now = new Date().toISOString();
      const { data, error } = await supabase
        .from(TABLE)
        .update({
          revoked_at: now,
          updated_at: now,
          created_by_email: revokedByEmail || undefined,
        })
        .eq('id', id)
        .eq('tenant_id', tenantId)
        .select('id, revoked_at')
        .maybeSingle();
      if (error) throw error;
      if (!data) throw notFound('Token not found.');
      return { id: data.id, revokedAt: data.revoked_at };
    },

    async authenticate(rawToken) {
      if (!rawToken || typeof rawToken !== 'string') return null;
      if (!rawToken.startsWith(TOKEN_PREFIX_LIVE) && !rawToken.startsWith(TOKEN_PREFIX_TEST)) return null;
      const tokenHash = hashToken(rawToken);
      const { data, error } = await supabase
        .from(TABLE)
        .select('id, tenant_id, location_id, name, scope, expires_at, revoked_at')
        .eq('token_hash', tokenHash)
        .maybeSingle();
      if (error) {
        console.warn('[ApiTokens] authenticate failed:', error.message);
        return null;
      }
      if (!data || data.revoked_at) return null;
      if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) return null;

      void supabase
        .from(TABLE)
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', data.id)
        .then(({ error: updateError }) => {
          if (updateError) console.warn('[ApiTokens] last_used update failed:', updateError.message);
        });

      return actorFromToken(data);
    },
  };
}

export function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

export function generateToken(mode = 'live') {
  const prefix = mode === 'test' ? TOKEN_PREFIX_TEST : TOKEN_PREFIX_LIVE;
  const secret = crypto.randomBytes(SECRET_BYTES).toString('base64url');
  return `${prefix}${secret}`;
}

function actorFromToken(record) {
  const role = record.scope === 'owner' ? 'owner' : 'employee';
  return {
    id: `api_token:${record.id}`,
    actorType: 'api_token',
    tokenId: record.id,
    name: record.name,
    role,
    scope: record.scope,
    tenantId: record.tenant_id,
    locationId: record.location_id,
  };
}

function toPublicRecord(record) {
  return {
    id: record.id,
    tenantId: record.tenant_id,
    locationId: record.location_id,
    name: record.name,
    tokenPrefix: record.token_prefix,
    scope: record.scope,
    createdByEmail: record.created_by_email,
    lastUsedAt: record.last_used_at ?? null,
    expiresAt: record.expires_at ?? null,
    revokedAt: record.revoked_at ?? null,
    createdAt: record.created_at,
  };
}

function createDisabledService() {
  const unavailable = () => {
    throw notFound('API tokens require Supabase persistence.');
  };
  return {
    async list() { return []; },
    async mint() { unavailable(); },
    async revoke() { unavailable(); },
    async authenticate() { return null; },
  };
}

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = 'API_TOKEN_INVALID';
  return error;
}

function notFound(message) {
  const error = new Error(message);
  error.statusCode = 404;
  error.code = 'API_TOKEN_NOT_FOUND';
  return error;
}

function isProduction(env) {
  return (env?.NODE_ENV || '').toLowerCase() === 'production';
}
