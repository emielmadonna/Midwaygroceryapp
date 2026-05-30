import {
  exchangeXeroCode,
  listXeroConnections,
  refreshXeroToken,
  tokenExpiresAtIso,
  xeroRequest,
} from './xero-api.js';

export function createXeroService({ store, env = process.env, fetchImpl = globalThis.fetch } = {}) {
  if (!store) throw new Error('Xero service requires a store.');

  return {
    async completeAuth({ code, redirectUri, clientId, clientSecret, actor }) {
      const token = await exchangeXeroCode({ code, redirectUri, clientId, clientSecret, fetchImpl });
      const connections = await listXeroConnections({ accessToken: token.accessToken, fetchImpl });
      const primary = connections?.[0] ?? null;
      if (!primary) {
        throw new Error('No Xero organization was authorized for this connection.');
      }
      const connection = await store.upsertProviderConnection?.({
        tenantId: store.tenantId,
        locationId: store.locationId,
        providerKey: 'xero',
        status: 'connected',
        accessToken: token.accessToken,
        refreshToken: token.refreshToken,
        externalAccountId: primary.tenantId,
        publicConfig: {
          tenantName: primary.tenantName,
          tenantType: primary.tenantType,
          tenantIds: connections.map(c => c.tenantId),
          tenantOptions: connections.map(c => ({ id: c.tenantId, name: c.tenantName })),
          tokenExpiresAt: tokenExpiresAtIso(token),
          scope: token.scope,
        },
        updatedBy: actor?.email || 'admin',
      });
      return { connection, organizations: connections };
    },

    async getValidAccessToken({ clientId, clientSecret } = {}) {
      const connection = await store.getProviderConnection?.({
        tenantId: store.tenantId,
        locationId: store.locationId,
        providerKey: 'xero',
      });
      if (!connection || !connection.accessToken) return null;
      const expiresAt = connection.publicConfig?.tokenExpiresAt
        ? new Date(connection.publicConfig.tokenExpiresAt).getTime()
        : null;
      if (!expiresAt || expiresAt > Date.now() + 30_000) {
        return { connection, accessToken: connection.accessToken };
      }
      if (!connection.refreshToken) return { connection, accessToken: connection.accessToken };
      const refreshed = await refreshXeroToken({
        refreshToken: connection.refreshToken,
        clientId,
        clientSecret,
        fetchImpl,
      });
      const updated = await store.upsertProviderConnection?.({
        tenantId: store.tenantId,
        locationId: store.locationId,
        providerKey: 'xero',
        status: 'connected',
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken || connection.refreshToken,
        externalAccountId: connection.externalAccountId,
        publicConfig: {
          ...(connection.publicConfig || {}),
          tokenExpiresAt: tokenExpiresAtIso(refreshed),
          scope: refreshed.scope,
        },
        updatedBy: 'xero-refresh',
      });
      return { connection: updated, accessToken: refreshed.accessToken };
    },

    async request({ method = 'GET', path, query = null, body = null, tenantOverride = null, clientId, clientSecret }) {
      const ctx = await this.getValidAccessToken({ clientId, clientSecret });
      if (!ctx) throw new Error('Xero is not connected.');
      const tenantId = tenantOverride || ctx.connection.externalAccountId;
      return xeroRequest({
        accessToken: ctx.accessToken,
        tenantId,
        method,
        path,
        query,
        body,
        fetchImpl,
      });
    },

    async getStatus() {
      const connection = await store.getProviderConnection?.({
        tenantId: store.tenantId,
        locationId: store.locationId,
        providerKey: 'xero',
      });
      if (!connection || connection.status !== 'connected') {
        return { connected: false };
      }
      return {
        connected: true,
        tenantId: connection.externalAccountId,
        tenantName: connection.publicConfig?.tenantName ?? null,
        tokenExpiresAt: connection.publicConfig?.tokenExpiresAt ?? null,
        organizations: connection.publicConfig?.tenantOptions ?? [],
      };
    },
  };
}
