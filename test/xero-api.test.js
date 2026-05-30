import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildXeroAuthUrl,
  exchangeXeroCode,
  listXeroConnections,
  refreshXeroToken,
  xeroProviderConfigFromEnv,
  xeroRequest,
  tokenExpiresAtIso,
} from '../src/lib/xero-api.js';

test('xeroProviderConfigFromEnv reads vars with sensible scope default', () => {
  const config = xeroProviderConfigFromEnv({
    XERO_CLIENT_ID: 'cid',
    XERO_CLIENT_SECRET: 'sec',
  });
  assert.equal(config.clientId, 'cid');
  assert.equal(config.clientSecret, 'sec');
  assert.ok(config.scopes.includes('accounting.transactions'));
  assert.ok(config.scopes.includes('offline_access'));
});

test('buildXeroAuthUrl sets the expected query params', () => {
  const url = new URL(buildXeroAuthUrl({
    clientId: 'cid',
    redirectUri: 'https://example.com/cb',
    scopes: ['accounting.transactions', 'offline_access'],
    state: 'st',
  }));
  assert.equal(url.searchParams.get('client_id'), 'cid');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://example.com/cb');
  assert.equal(url.searchParams.get('scope'), 'accounting.transactions offline_access');
  assert.equal(url.searchParams.get('state'), 'st');
});

test('exchangeXeroCode normalizes token shape', async () => {
  const fakeFetch = async () => ({
    ok: true,
    async json() {
      return {
        access_token: 'a',
        refresh_token: 'r',
        expires_in: 1800,
        token_type: 'Bearer',
        scope: 'accounting.transactions',
      };
    },
  });
  const token = await exchangeXeroCode({ code: 'c', clientId: 'i', clientSecret: 's', redirectUri: 'r', fetchImpl: fakeFetch });
  assert.equal(token.accessToken, 'a');
  assert.equal(token.refreshToken, 'r');
  assert.equal(token.expiresIn, 1800);
});

test('exchangeXeroCode throws on Xero error payload', async () => {
  const fakeFetch = async () => ({
    ok: false,
    async json() { return { error: 'invalid_grant' }; },
  });
  await assert.rejects(
    exchangeXeroCode({ code: 'c', clientId: 'i', clientSecret: 's', redirectUri: 'r', fetchImpl: fakeFetch }),
    /XERO_OAUTH_FAILED|invalid_grant/,
  );
});

test('refreshXeroToken returns the same shape', async () => {
  const fakeFetch = async () => ({
    ok: true,
    async json() {
      return {
        access_token: 'na',
        refresh_token: 'nr',
        expires_in: 1800,
      };
    },
  });
  const token = await refreshXeroToken({ refreshToken: 'old', clientId: 'i', clientSecret: 's', fetchImpl: fakeFetch });
  assert.equal(token.accessToken, 'na');
  assert.equal(token.refreshToken, 'nr');
});

test('listXeroConnections returns array, errors when not 2xx', async () => {
  const okFetch = async () => ({ ok: true, async json() { return [{ tenantId: 't1', tenantName: 'Midway' }]; } });
  const list = await listXeroConnections({ accessToken: 'x', fetchImpl: okFetch });
  assert.equal(list[0].tenantId, 't1');

  const badFetch = async () => ({ ok: false, async json() { return { Title: 'Forbidden' }; } });
  await assert.rejects(
    listXeroConnections({ accessToken: 'x', fetchImpl: badFetch }),
    err => err.code === 'XERO_CONNECTIONS_FAILED',
  );
});

test('xeroRequest sets tenant header and parses JSON', async () => {
  let captured = null;
  const fakeFetch = async (url, options) => {
    captured = { url, options };
    return { ok: true, async json() { return { Invoices: [{ InvoiceID: 'inv-1' }] }; } };
  };
  const data = await xeroRequest({
    accessToken: 'tok',
    tenantId: 'org-1',
    method: 'GET',
    path: '/Invoices',
    query: { where: 'Status=="DRAFT"' },
    fetchImpl: fakeFetch,
  });
  assert.equal(data.Invoices[0].InvoiceID, 'inv-1');
  assert.equal(captured.options.headers['Xero-Tenant-Id'], 'org-1');
  assert.ok(captured.url.includes('where=Status%3D%3D%22DRAFT%22'));
});

test('xeroRequest rejects when accessToken missing', async () => {
  await assert.rejects(
    xeroRequest({ accessToken: null, tenantId: 'x', path: '/foo' }),
    err => err.code === 'XERO_NOT_CONNECTED',
  );
});

test('tokenExpiresAtIso returns a future ISO timestamp', () => {
  const iso = tokenExpiresAtIso({ expiresIn: 1800 });
  assert.ok(iso);
  assert.ok(new Date(iso).getTime() > Date.now());
});
