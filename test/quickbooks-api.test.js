import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildQuickBooksAuthUrl,
  exchangeQuickBooksCode,
  quickbooksProviderConfigFromEnv,
  quickbooksRequest,
  refreshQuickBooksToken,
  tokenExpiresAtIso,
} from '../src/lib/quickbooks-api.js';

test('quickbooksProviderConfigFromEnv reads vars with sensible defaults', () => {
  const config = quickbooksProviderConfigFromEnv({
    QUICKBOOKS_CLIENT_ID: 'cid',
    QUICKBOOKS_CLIENT_SECRET: 'sec',
  });
  assert.equal(config.clientId, 'cid');
  assert.equal(config.clientSecret, 'sec');
  assert.equal(config.environment, 'production');
  assert.ok(config.scopes.includes('com.intuit.quickbooks.accounting'));
});

test('quickbooksProviderConfigFromEnv honors sandbox environment', () => {
  const config = quickbooksProviderConfigFromEnv({
    QUICKBOOKS_CLIENT_ID: 'cid',
    QUICKBOOKS_CLIENT_SECRET: 'sec',
    QUICKBOOKS_ENVIRONMENT: 'sandbox',
  });
  assert.equal(config.environment, 'sandbox');
});

test('buildQuickBooksAuthUrl sets the expected query params', () => {
  const url = new URL(buildQuickBooksAuthUrl({
    clientId: 'cid',
    redirectUri: 'https://example.com/cb',
    scopes: ['com.intuit.quickbooks.accounting'],
    state: 'st',
  }));
  assert.equal(url.origin + url.pathname, 'https://appcenter.intuit.com/connect/oauth2');
  assert.equal(url.searchParams.get('client_id'), 'cid');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://example.com/cb');
  assert.equal(url.searchParams.get('scope'), 'com.intuit.quickbooks.accounting');
  assert.equal(url.searchParams.get('state'), 'st');
});

test('exchangeQuickBooksCode posts Basic auth form body and normalizes tokens', async () => {
  let captured = null;
  const fakeFetch = async (url, options) => {
    captured = { url, options };
    return {
      ok: true,
      async json() {
        return {
          access_token: 'a',
          refresh_token: 'r',
          expires_in: 3600,
          x_refresh_token_expires_in: 8726400,
          token_type: 'bearer',
        };
      },
    };
  };
  const token = await exchangeQuickBooksCode({ code: 'c', clientId: 'i', clientSecret: 's', redirectUri: 'https://example.com/cb', fetchImpl: fakeFetch });
  assert.equal(captured.url, 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer');
  assert.equal(captured.options.method, 'POST');
  assert.equal(captured.options.headers.Authorization, `Basic ${Buffer.from('i:s').toString('base64')}`);
  assert.equal(captured.options.headers['Content-Type'], 'application/x-www-form-urlencoded');
  const body = new URLSearchParams(captured.options.body);
  assert.equal(body.get('grant_type'), 'authorization_code');
  assert.equal(body.get('code'), 'c');
  assert.equal(body.get('redirect_uri'), 'https://example.com/cb');
  assert.equal(token.accessToken, 'a');
  assert.equal(token.refreshToken, 'r');
  assert.equal(token.expiresIn, 3600);
  assert.equal(token.refreshTokenExpiresIn, 8726400);
});

test('exchangeQuickBooksCode throws on error payload', async () => {
  const fakeFetch = async () => ({
    ok: false,
    async json() { return { error: 'invalid_grant' }; },
  });
  await assert.rejects(
    exchangeQuickBooksCode({ code: 'c', clientId: 'i', clientSecret: 's', redirectUri: 'r', fetchImpl: fakeFetch }),
    /QUICKBOOKS_OAUTH_FAILED|invalid_grant/,
  );
});

test('refreshQuickBooksToken sends refresh grant and returns the same shape', async () => {
  let captured = null;
  const fakeFetch = async (url, options) => {
    captured = { url, options };
    return {
      ok: true,
      async json() {
        return {
          access_token: 'na',
          refresh_token: 'nr',
          expires_in: 3600,
        };
      },
    };
  };
  const token = await refreshQuickBooksToken({ refreshToken: 'old', clientId: 'i', clientSecret: 's', fetchImpl: fakeFetch });
  const body = new URLSearchParams(captured.options.body);
  assert.equal(body.get('grant_type'), 'refresh_token');
  assert.equal(body.get('refresh_token'), 'old');
  assert.equal(token.accessToken, 'na');
  assert.equal(token.refreshToken, 'nr');
});

test('quickbooksRequest sets Bearer header, minorversion, and parses JSON', async () => {
  let captured = null;
  const fakeFetch = async (url, options) => {
    captured = { url, options };
    return { ok: true, async json() { return { QueryResponse: { Invoice: [{ Id: 'inv-1' }] } }; } };
  };
  const data = await quickbooksRequest({
    accessToken: 'tok',
    realmId: 'realm-1',
    method: 'GET',
    path: '/query',
    query: { query: 'select * from Invoice' },
    fetchImpl: fakeFetch,
  });
  assert.equal(data.QueryResponse.Invoice[0].Id, 'inv-1');
  assert.equal(captured.options.headers.Authorization, 'Bearer tok');
  assert.ok(captured.url.startsWith('https://quickbooks.api.intuit.com/v3/company/realm-1/query'));
  assert.ok(captured.url.includes('minorversion=75'));
  assert.ok(captured.url.includes('query=select+*+from+Invoice'));
});

test('quickbooksRequest uses the sandbox base when asked', async () => {
  let captured = null;
  const fakeFetch = async (url, options) => {
    captured = { url, options };
    return { ok: true, async json() { return {}; } };
  };
  await quickbooksRequest({
    accessToken: 'tok',
    realmId: 'realm-1',
    path: '/companyinfo/realm-1',
    environment: 'sandbox',
    fetchImpl: fakeFetch,
  });
  assert.ok(captured.url.startsWith('https://sandbox-quickbooks.api.intuit.com/v3/company/realm-1/companyinfo/realm-1'));
});

test('quickbooksRequest throws on non-OK responses', async () => {
  const fakeFetch = async () => ({
    ok: false,
    status: 401,
    async json() { return { Fault: { Error: [{ Message: 'AuthenticationFailed' }] } }; },
  });
  await assert.rejects(
    quickbooksRequest({ accessToken: 'tok', realmId: 'realm-1', path: '/query', fetchImpl: fakeFetch }),
    err => err.code === 'QUICKBOOKS_REQUEST_FAILED',
  );
});

test('quickbooksRequest rejects when accessToken or realmId missing', async () => {
  await assert.rejects(
    quickbooksRequest({ accessToken: null, realmId: 'x', path: '/query' }),
    err => err.code === 'QUICKBOOKS_NOT_CONNECTED',
  );
  await assert.rejects(
    quickbooksRequest({ accessToken: 'tok', realmId: null, path: '/query' }),
    err => err.code === 'QUICKBOOKS_REALM_REQUIRED',
  );
});

test('tokenExpiresAtIso returns a future ISO timestamp', () => {
  const iso = tokenExpiresAtIso({ expiresIn: 3600 });
  assert.ok(iso);
  assert.ok(new Date(iso).getTime() > Date.now());
});
