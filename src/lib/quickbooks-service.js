import {
  exchangeQuickBooksCode,
  quickbooksProviderConfigFromEnv,
  quickbooksRequest,
  refreshQuickBooksToken,
  tokenExpiresAtIso,
} from './quickbooks-api.js';

export function createQuickBooksService({ store, env = process.env, fetchImpl = globalThis.fetch } = {}) {
  if (!store) throw new Error('QuickBooks service requires a store.');

  const environment = () => quickbooksProviderConfigFromEnv(env).environment;

  return {
    async completeAuth({ code, realmId, redirectUri, clientId, clientSecret, actor }) {
      if (!realmId) {
        throw new Error('QuickBooks did not return a company (realmId) for this connection.');
      }
      const token = await exchangeQuickBooksCode({ code, redirectUri, clientId, clientSecret, fetchImpl });
      const companyInfo = await quickbooksRequest({
        accessToken: token.accessToken,
        realmId,
        method: 'GET',
        path: `/companyinfo/${realmId}`,
        environment: environment(),
        fetchImpl,
      });
      const companyName = companyInfo?.CompanyInfo?.CompanyName ?? null;
      const connection = await store.upsertProviderConnection?.({
        tenantId: store.tenantId,
        locationId: store.locationId,
        providerKey: 'quickbooks',
        status: 'connected',
        accessToken: token.accessToken,
        refreshToken: token.refreshToken,
        externalAccountId: realmId,
        publicConfig: {
          companyName,
          tokenExpiresAt: tokenExpiresAtIso(token),
          scope: token.scope,
        },
        updatedBy: actor?.email || 'admin',
      });
      return { connection, companyName, realmId };
    },

    async getValidAccessToken({ clientId, clientSecret } = {}) {
      const connection = await store.getProviderConnection?.({
        tenantId: store.tenantId,
        locationId: store.locationId,
        providerKey: 'quickbooks',
      });
      if (!connection || !connection.accessToken) return null;
      const expiresAt = connection.publicConfig?.tokenExpiresAt
        ? new Date(connection.publicConfig.tokenExpiresAt).getTime()
        : null;
      if (!expiresAt || expiresAt > Date.now() + 30_000) {
        return { connection, accessToken: connection.accessToken };
      }
      if (!connection.refreshToken) return { connection, accessToken: connection.accessToken };
      const refreshed = await refreshQuickBooksToken({
        refreshToken: connection.refreshToken,
        clientId,
        clientSecret,
        fetchImpl,
      });
      const updated = await store.upsertProviderConnection?.({
        tenantId: store.tenantId,
        locationId: store.locationId,
        providerKey: 'quickbooks',
        status: 'connected',
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken || connection.refreshToken,
        externalAccountId: connection.externalAccountId,
        publicConfig: {
          ...(connection.publicConfig || {}),
          tokenExpiresAt: tokenExpiresAtIso(refreshed),
          scope: refreshed.scope,
        },
        updatedBy: 'quickbooks-refresh',
      });
      return { connection: updated, accessToken: refreshed.accessToken };
    },

    async request({ method = 'GET', path, query = null, body = null, clientId, clientSecret }) {
      const ctx = await this.getValidAccessToken({ clientId, clientSecret });
      if (!ctx) throw new Error('QuickBooks is not connected.');
      const realmId = ctx.connection.externalAccountId;
      return quickbooksRequest({
        accessToken: ctx.accessToken,
        realmId,
        method,
        path,
        query,
        body,
        environment: environment(),
        fetchImpl,
      });
    },

    async getStatus() {
      const connection = await store.getProviderConnection?.({
        tenantId: store.tenantId,
        locationId: store.locationId,
        providerKey: 'quickbooks',
      });
      if (!connection || connection.status !== 'connected') {
        return { connected: false };
      }
      return {
        connected: true,
        realmId: connection.externalAccountId,
        companyName: connection.publicConfig?.companyName ?? null,
        tokenExpiresAt: connection.publicConfig?.tokenExpiresAt ?? null,
      };
    },
  };
}
