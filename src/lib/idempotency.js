const TABLE = 'idempotency_keys';
const DEFAULT_TTL_HOURS = 24;
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const HEADER_NAME = 'idempotency-key';

export function createIdempotencyService({ supabase, ttlHours = DEFAULT_TTL_HOURS } = {}) {
  if (!supabase) return createDisabledService();

  return {
    async find({ tenantId = 'midway', actorId = null, key, route, method }) {
      if (!key) return null;
      const { data, error } = await supabase
        .from(TABLE)
        .select('id, status_code, response_body, expires_at')
        .eq('tenant_id', tenantId)
        .eq('actor_id', actorId)
        .eq('key', key)
        .eq('route', route)
        .eq('method', method)
        .gt('expires_at', new Date().toISOString())
        .maybeSingle();
      if (error) {
        console.warn('[Idempotency] find failed:', error.message);
        return null;
      }
      return data ?? null;
    },

    async record({ tenantId = 'midway', actorId = null, key, route, method, statusCode, responseBody }) {
      if (!key) return;
      const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString();
      const { error } = await supabase
        .from(TABLE)
        .upsert({
          tenant_id: tenantId,
          actor_id: actorId,
          key,
          route,
          method,
          status_code: statusCode,
          response_body: responseBody,
          expires_at: expiresAt,
        }, { onConflict: 'tenant_id,actor_id,key,route,method' });
      if (error) console.warn('[Idempotency] record failed:', error.message);
    },
  };
}

export function isWriteMethod(method) {
  return WRITE_METHODS.has(String(method || '').toUpperCase());
}

export function createIdempotencyMiddleware({ service, tenantId = 'midway' } = {}) {
  if (!service) return (_req, _res, next) => next();
  return async function idempotencyMiddleware(req, res, next) {
    if (!isWriteMethod(req.method)) return next();
    const key = req.get?.(HEADER_NAME);
    if (!key) return next();
    const route = req.baseUrl ? `${req.baseUrl}${req.path}` : req.path;
    const actorId = req.adminUser?.id || null;

    const cached = await service.find({ tenantId, actorId, key, route, method: req.method });
    if (cached) {
      res.setHeader('Idempotent-Replay', 'true');
      res.status(cached.status_code).json(cached.response_body);
      return;
    }

    const originalJson = res.json.bind(res);
    let captured = null;
    res.json = (body) => {
      captured = body;
      return originalJson(body);
    };

    res.on('finish', () => {
      if (!captured) return;
      if (res.statusCode >= 500) return;
      service.record({
        tenantId,
        actorId,
        key,
        route,
        method: req.method,
        statusCode: res.statusCode,
        responseBody: captured,
      }).catch(error => console.warn('[Idempotency] record failed:', error.message));
    });

    next();
  };
}

function createDisabledService() {
  return {
    async find() { return null; },
    async record() { /* no-op */ },
  };
}
