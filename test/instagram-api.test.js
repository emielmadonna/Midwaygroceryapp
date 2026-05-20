import test from 'node:test';
import assert from 'node:assert/strict';

import {
  exchangeInstagramLongLivedToken,
  exchangeInstagramOAuthCode,
  fetchInstagramFeed,
  instagramProviderConfigFromEnv,
  normalizeInstagramMedia,
  refreshInstagramAccessToken,
} from '../src/lib/instagram-api.js';

test('Instagram media normalizes API feed items for public rendering', () => {
  const posts = normalizeInstagramMedia([
    {
      id: 'ig-1',
      caption: 'Fresh coffee and firewood today. Stop by.',
      media_type: 'IMAGE',
      media_url: 'https://cdn.example/image.jpg',
      permalink: 'https://www.instagram.com/p/demo/',
      timestamp: '2026-05-20T12:00:00+0000',
      username: 'midwayplain',
    },
  ]);

  assert.deepEqual(posts, [
    {
      id: 'ig-1',
      title: 'Fresh coffee and firewood today',
      caption: 'Fresh coffee and firewood today. Stop by.',
      image: 'https://cdn.example/image.jpg',
      mediaUrl: 'https://cdn.example/image.jpg',
      thumbnailUrl: '',
      permalink: 'https://www.instagram.com/p/demo/',
      mediaType: 'IMAGE',
      timestamp: '2026-05-20T12:00:00+0000',
      username: 'midwayplain',
      source: 'instagram-api',
    },
  ]);
});

test('Instagram feed request uses server-side credentials and hides token from output', async () => {
  let requestedUrl;
  const posts = await fetchInstagramFeed({
    config: {
      instagramUserId: '17841400000000000',
      accessToken: 'secret-token',
      apiVersion: 'v24.0',
    },
    fetchImpl: async (url) => {
      requestedUrl = url;
      return {
        ok: true,
        json: async () => ({
          data: [
            {
              id: 'ig-1',
              media_type: 'VIDEO',
              media_url: 'https://cdn.example/video.mp4',
              thumbnail_url: 'https://cdn.example/thumb.jpg',
              permalink: 'https://www.instagram.com/reel/demo/',
            },
          ],
        }),
      };
    },
  });

  assert.equal(requestedUrl.startsWith('https://graph.facebook.com/v24.0/17841400000000000/media?'), true);
  assert.equal(requestedUrl.includes('access_token=secret-token'), true);
  assert.equal(posts[0].image, 'https://cdn.example/thumb.jpg');
  assert.equal(JSON.stringify(posts).includes('secret-token'), false);
});

test('Instagram env config reads Meta credential aliases', () => {
  assert.deepEqual(instagramProviderConfigFromEnv({
    META_INSTAGRAM_USER_ID: 'ig-user',
    META_INSTAGRAM_ACCESS_TOKEN: 'token',
    INSTAGRAM_FEED_LIMIT: '4',
  }), {
    providerKey: 'instagram',
    providerKind: 'social',
    status: 'connected',
    accessToken: 'token',
    instagramUserId: 'ig-user',
    apiVersion: 'v24.0',
    apiBaseUrl: 'https://graph.facebook.com',
    feedLimit: 4,
  });
});

test('Instagram env config ignores checked-in placeholder values', () => {
  assert.deepEqual(instagramProviderConfigFromEnv({
    INSTAGRAM_USER_ID: 'your_instagram_professional_account_id_here',
    INSTAGRAM_ACCESS_TOKEN: 'your_instagram_graph_api_access_token_here',
  }), {});
});

test('Instagram token refresh uses the Graph refresh endpoint and returns expiry metadata', async () => {
  let requestedUrl;
  const refreshed = await refreshInstagramAccessToken({
    config: { accessToken: 'old-token' },
    now: () => new Date('2026-05-20T12:00:00.000Z'),
    fetchImpl: async (url) => {
      requestedUrl = url;
      return {
        ok: true,
        json: async () => ({
          access_token: 'new-token',
          token_type: 'bearer',
          expires_in: 5184000,
        }),
      };
    },
  });

  assert.equal(requestedUrl, 'https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=old-token');
  assert.equal(refreshed.accessToken, 'new-token');
  assert.equal(refreshed.expiresAt, '2026-07-19T12:00:00.000Z');
});

test('Instagram OAuth code exchange retries Meta JWT clock skew', async () => {
  const attempts = [];
  const token = await exchangeInstagramOAuthCode({
    code: 'auth-code',
    redirectUri: 'https://www.midwayplain.com/admin.html?provider=instagram',
    clientId: 'instagram-app',
    clientSecret: 'instagram-secret',
    retryDelayMs: 0,
    fetchImpl: async (url, options = {}) => {
      attempts.push({
        url,
        body: Object.fromEntries(new URLSearchParams(options.body.toString())),
      });
      if (attempts.length === 1) {
        return {
          ok: false,
          status: 400,
          json: async () => ({ error: { message: 'JWT issued at future' } }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          access_token: 'ig-short-token',
          user_id: '17841400000000000',
        }),
      };
    },
  });

  assert.equal(attempts.length, 2);
  assert.equal(attempts[0].url, 'https://api.instagram.com/oauth/access_token');
  assert.equal(attempts[0].body.redirect_uri, 'https://www.midwayplain.com/admin.html?provider=instagram');
  assert.deepEqual(token, {
    accessToken: 'ig-short-token',
    userId: '17841400000000000',
    permissions: [],
  });
});

test('Instagram long-lived token exchange retries Meta JWT clock skew', async () => {
  const attempts = [];
  const token = await exchangeInstagramLongLivedToken({
    accessToken: 'ig-short-token',
    clientSecret: 'instagram-secret',
    retryDelayMs: 0,
    now: () => new Date('2026-05-20T12:00:00.000Z'),
    fetchImpl: async (url) => {
      attempts.push(url);
      if (attempts.length === 1) {
        return {
          ok: false,
          status: 400,
          json: async () => ({ error: { message: 'JWT issued at future' } }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          access_token: 'ig-long-token',
          token_type: 'bearer',
          expires_in: 5184000,
        }),
      };
    },
  });

  assert.equal(attempts.length, 2);
  assert.equal(String(attempts[0]).startsWith('https://graph.instagram.com/access_token?'), true);
  assert.equal(token.accessToken, 'ig-long-token');
  assert.equal(token.expiresAt, '2026-07-19T12:00:00.000Z');
});
