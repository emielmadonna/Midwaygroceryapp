import crypto from 'node:crypto';
import express from 'express';

import { createAdminAuthService, requireAdminRole } from '../lib/admin-auth.js';
import { createApiTokenService } from '../lib/api-tokens.js';
import { createMcpServer } from '../lib/mcp-server.js';
import { createMidwayHarness } from '../lib/midway-harness.js';
import { createNotificationService } from '../lib/notifications.js';
import { createProviderConnectionService } from '../lib/provider-connections.js';
import { createSupabaseServerClient } from '../lib/supabase-server.js';
import { createToolRegistry } from '../lib/tool-registry.js';
import { registerCoreTools } from '../lib/registered-tools.js';
import {
  createRvCheckoutPaymentLink,
  createRvWebPaymentSession,
  createSquareRefund,
  createSquareWebPayment,
  listSquareCatalogItems,
  normalizeSquareCatalogItemsForInventory,
  verifySquareWebhookSignature,
} from '../lib/square-api.js';
import { normalizeSquareWebhookEvent } from '../lib/square-webhooks.js';

export function createApiRouter({
  store = null,
  env = process.env,
  fetchImpl = globalThis.fetch,
  platformProviderConfigs = [],
} = {}) {
  const router = express.Router();
  const resolvedStore = store ?? createMidwayHarness({ env, fetchImpl });
  const resolvedPlatformProviderConfigs = platformProviderConfigs.length
    ? platformProviderConfigs
    : platformProviderConfigsFromEnv(env);
  const providerConnections = createProviderConnectionService({
    store: resolvedStore,
    tenantConfig: resolvedStore.tenantConfig,
    env,
    fetchImpl,
    platformProviderConfigs: resolvedPlatformProviderConfigs,
  });
  const notifications = createNotificationService({ store: resolvedStore, env, fetchImpl });
  const supabase = createSupabaseServerClient({ env });
  const apiTokenService = createApiTokenService({ supabase, env });
  const adminAuth = createAdminAuthService({ env, apiTokenService });
  const toolRegistry = createToolRegistry();
  registerCoreTools(toolRegistry, { store: resolvedStore });
  const mcpServer = createMcpServer({ registry: toolRegistry, store: resolvedStore });
  const squareProviderConfig = async () => ({
    nodeEnv: env.NODE_ENV,
    ...(
      await resolvedStore.getProviderConfig?.('square')
      || await providerConnections.getProviderConfig('square')
      || {}
    ),
  });

  const runInstagramCronRefresh = async (req, res) => {
    try {
      requireCronAuth(req, env);
      const data = await providerConnections.refreshInstagramConnection({
        force: req.body?.force === true,
        refreshWithinDays: req.body?.refreshWithinDays,
        actor: { id: 'cron', role: 'system' },
      });
      await resolvedStore.recordAuditLog?.({
        action: data.mode === 'refreshed' ? 'provider.instagram.token_refresh' : `provider.instagram.token_refresh_${data.mode}`,
        actor: { id: 'cron', role: 'system' },
        targetType: 'provider_connection',
        targetId: 'instagram',
        metadata: {
          mode: data.mode,
          reason: data.reason ?? null,
          status: data.connection?.status ?? null,
          tokenExpiresAt: data.connection?.publicConfig?.tokenExpiresAt ?? null,
        },
      });
      res.status(data.mode === 'error' ? 502 : 200).json({ ok: data.mode !== 'error', data });
    } catch (error) {
      sendApiError(res, error, error.code || 'INSTAGRAM_REFRESH_FAILED', error.statusCode || 401);
    }
  };
  router.get('/cron/instagram-refresh', runInstagramCronRefresh);
  router.post('/cron/instagram-refresh', runInstagramCronRefresh);

  router.post('/admin/auth/login', async (req, res) => {
    try {
      resolvedStore.requireFeature?.('admin.auth.sessions');
      const session = await adminAuth.login({
        email: req.body.email,
        password: req.body.password,
      });
      await resolvedStore.recordAuditLog?.({
        action: 'admin.login',
        actor: session.user,
        targetType: 'admin_user',
        targetId: session.user.id,
      });
      res.json({ ok: true, data: session });
    } catch (error) {
      sendApiError(res, error, error.code || 'ADMIN_LOGIN_FAILED', error.statusCode || 401);
    }
  });

  router.post('/mcp', async (req, res) => {
    try {
      resolvedStore.requireFeature?.('mcp.server');
      const actor = await authenticateMcpRequest(req, { apiTokenService });
      if (!actor) {
        return res.status(401).json(apiError('MCP_AUTH_REQUIRED', 'A valid mw_ API token is required.'));
      }
      const response = await mcpServer.handleBatch(req.body, { actor });
      if (response === null) {
        return res.status(204).end();
      }
      res.json(response);
    } catch (error) {
      sendApiError(res, error, error.code || 'MCP_REQUEST_FAILED', error.statusCode || 500);
    }
  });

  router.get('/mcp', (req, res) => {
    res.json({
      ok: true,
      data: {
        protocolVersion: mcpServer.protocolVersion,
        serverInfo: { name: 'midway-mcp', version: '0.1.0' },
        transport: 'streamable-http',
        endpoint: '/api/mcp',
      },
    });
  });

  router.use('/admin', async (req, res, next) => {
    try {
      const user = await adminAuth.authenticateRequest(req);
      if (!user) {
        return res.status(401).json(apiError('ADMIN_AUTH_REQUIRED', 'Admin authentication is required.'));
      }
      req.adminUser = user;
      next();
    } catch (error) {
      sendApiError(res, error, 'ADMIN_AUTH_FAILED', 401);
    }
  });

  router.get('/public/bootstrap', async (req, res) => {
    try {
      const featureFlags = resolvedStore.flags?.() ?? {};
      if (featureFlags.products) {
        try {
          const squareConfig = await squareProviderConfig();
          const persistedProducts = await resolvedStore.listStoreInventory?.({ activeOnly: true }) ?? [];
          if (persistedProducts.length) {
            resolvedStore.state.squareProducts = persistedProducts;
          } else if (squareConfig.accessToken) {
            const items = await listSquareCatalogItems({ env: squareConfig, fetchImpl });
            resolvedStore.state.squareProducts = normalizeSquareCatalogItemsForInventory(items);
          }
        } catch (error) {
          console.warn('[Square] Product sync unavailable:', error.message);
          resolvedStore.state.squareProducts = [];
        }
      }

      res.json({
        ok: true,
        data: await resolvedStore.publicBootstrap({
          startDate: req.query.startDate,
          endDate: req.query.endDate,
        }),
      });
    } catch (error) {
      res.status(502).json(apiError('PUBLIC_BOOTSTRAP_UNAVAILABLE', error.message));
    }
  });

  router.post('/bookings/quote', async (req, res) => {
    try {
      const quote = await resolvedStore.quote(req.body);
      res.json({ ok: true, data: quote });
    } catch (error) {
      res.status(400).json(apiError('QUOTE_INVALID', error.message));
    }
  });

  router.post('/bookings/holds', async (req, res) => {
    try {
      const hold = await resolvedStore.hold({
        ...req.body,
        customerSessionId: req.body.customerSessionId || req.ip,
      });
      res.json({ ok: true, data: hold });
    } catch (error) {
      res.status(409).json(apiError('BOOKING_CONFLICT', error.message));
    }
  });

  router.post('/bookings/holds/:holdId/release', async (req, res) => {
    try {
      const hold = await resolvedStore.releaseHold({
        holdId: req.params.holdId,
        customerSessionId: req.body.customerSessionId || req.ip,
      });
      res.json({ ok: true, data: { hold } });
    } catch (error) {
      res.status(409).json(apiError('HOLD_RELEASE_FAILED', error.message));
    }
  });

  router.post('/bookings/checkout', async (req, res) => {
    const customerSessionId = req.body.customerSessionId || req.ip;
    let hold = null;
    try {
      hold = await resolvedStore.hold({
        siteId: req.body.siteId,
        siteIds: req.body.siteIds,
        startDate: req.body.startDate,
        endDate: req.body.endDate,
        guests: req.body.guests,
        vehicles: req.body.vehicles,
        customerSessionId,
      });

      const bookingCode = `MW-${hold.id.slice(0, 6).toUpperCase()}`;
      const squareConfig = await squareProviderConfig();
      const checkout = checkoutSurface(squareConfig) === 'payment-link'
        ? await createRvCheckoutPaymentLink({
          hold,
          bookingCode,
          customer: req.body.customer,
          redirectUrl: await buildBookingReturnUrl(req, bookingCode, resolvedStore),
          env: squareConfig,
          fetchImpl,
        })
        : createRvWebPaymentSession({
          hold,
          bookingCode,
          env: squareConfig,
        });
      const booking = await resolvedStore.recordPendingBooking({
        hold,
        customer: req.body.customer,
        bookingCode,
        squareOrderId: checkout.orderId,
        checkoutUrl: checkout.checkoutUrl,
      });

      res.json({
        ok: true,
        data: {
          bookingCode: booking.bookingCode,
          hold,
          checkout,
        },
      });
    } catch (error) {
      await releaseCheckoutHold(resolvedStore, hold, customerSessionId);
      res.status(409).json(apiError('CHECKOUT_UNAVAILABLE', error.message));
    }
  });

  router.post('/bookings/:bookingCode/driver-license', async (req, res) => {
    try {
      const documentImage = parseDriverLicenseImage(req.body);
      const document = await resolvedStore.recordDriverLicenseUpload?.({
        bookingCode: req.params.bookingCode,
        ...documentImage,
      });
      if (!document) {
        return res.status(404).json(apiError('BOOKING_NOT_FOUND', 'Booking was not found.'));
      }
      res.json({ ok: true, data: { document } });
    } catch (error) {
      res.status(400).json(apiError('DOCUMENT_UPLOAD_FAILED', error.message));
    }
  });

  router.post('/bookings/pay', async (req, res) => {
    try {
      resolvedStore.requireFeature?.('payments.enabled');
      resolvedStore.requireFeature?.('payments.provider.square');

      const booking = await resolvedStore.getBooking(req.body.bookingCode);
      if (!booking) return res.status(404).json(apiError('BOOKING_NOT_FOUND', 'Booking was not found.'));
      if (booking.status === 'confirmed') {
        return res.json({ ok: true, data: { booking, payment: null } });
      }
      if (booking.status !== 'hold') {
        return res.status(409).json(apiError('BOOKING_NOT_PAYABLE', 'Only held bookings can be paid online.'));
      }

      const payment = await createSquareWebPayment({
        booking,
        sourceId: req.body.sourceId,
        verificationToken: req.body.verificationToken,
        idempotencyKey: req.body.idempotencyKey || paymentAttemptIdempotencyKey(booking.bookingCode, req.body.sourceId),
        env: await squareProviderConfig(),
        fetchImpl,
      });

      if (!isPaymentComplete(payment.status)) {
        return res.status(402).json(apiError('PAYMENT_NOT_COMPLETED', `Square payment status is ${payment.status || 'unknown'}.`));
      }

      const confirmed = await resolvedStore.confirmBooking({
        bookingCode: booking.bookingCode,
        squareOrderId: payment.orderId,
        squarePaymentId: payment.paymentId,
        source: 'square-web-payments',
      });
      if (confirmed) await notifications.bookingConfirmed(confirmed);
      await resolvedStore.recordAuditLog?.({
        action: 'payment.succeeded',
        actor: { id: 'public-checkout', role: 'customer' },
        targetType: 'rv_booking',
        targetId: booking.bookingCode,
        metadata: {
          paymentMode: payment.mode,
          paymentStatus: payment.status,
          squarePaymentId: payment.paymentId,
          amountCents: payment.amountCents,
          currency: payment.currency,
        },
      });

      res.json({ ok: true, data: { booking: confirmed, payment } });
    } catch (error) {
      res.status(409).json(apiError('PAYMENT_FAILED', error.message));
    }
  });

  router.get('/bookings/:bookingCode', async (req, res) => {
    const booking = await resolvedStore.getBooking(req.params.bookingCode);
    if (!booking) {
      return res.status(404).json(apiError('BOOKING_NOT_FOUND', 'Booking was not found.'));
    }
    res.json({ ok: true, data: booking });
  });

  router.post('/square/webhook', async (req, res) => {
    const notificationUrl = requestPublicUrl(req);
    const signature = req.get('x-square-hmacsha256-signature');
    const squareConfig = await squareProviderConfig();
    if (!squareConfig.webhookSignatureKey && env.NODE_ENV === 'production') {
      return res.status(503).json(apiError('SQUARE_WEBHOOK_SIGNATURE_NOT_CONFIGURED', 'Square webhook signature verification is required in production.'));
    }
    if (squareConfig.webhookSignatureKey) {
      const valid = verifySquareWebhookSignature({
        rawBody: req.rawBody,
        signature,
        notificationUrl,
        signatureKey: squareConfig.webhookSignatureKey,
      });
      if (!valid) {
        return res.status(401).json(apiError('INVALID_WEBHOOK_SIGNATURE', 'Square webhook signature did not verify.'));
      }
    }

    const event = normalizeSquareWebhookEvent(req.body);
    const recorded = await resolvedStore.recordSquareEvent?.({ event, payload: req.body });
    if (recorded?.duplicate && recorded.event?.processingStatus === 'processed') {
      return res.json({
        ok: true,
        data: {
          event,
          duplicate: true,
          bookingConfirmed: Boolean(recorded.event.bookingCode || recorded.event.squareOrderId),
        },
      });
    }

    let booking = null;
    try {
      if (event.paid && (event.bookingCode || event.squareOrderId)) {
        booking = await resolvedStore.confirmBooking({
          bookingCode: event.bookingCode,
          squareOrderId: event.squareOrderId,
          squarePaymentId: event.squarePaymentId,
          source: 'square-webhook',
        });
        if (booking) await notifications.bookingConfirmed(booking);
      }

      await resolvedStore.markSquareEvent?.({
        eventId: event.eventId,
        status: booking || !event.paid ? 'processed' : 'ignored',
        booking,
      });
    } catch (error) {
      await resolvedStore.markSquareEvent?.({
        eventId: event.eventId,
        status: 'failed',
        errorMessage: error.message,
      });
      throw error;
    }

    res.json({ ok: true, data: { event, duplicate: false, bookingConfirmed: !!booking } });
  });

  router.get('/admin/me', (req, res) => {
    res.json({
      ok: true,
      data: {
        user: req.adminUser,
        featureFlags: resolvedStore.flags?.({ role: req.adminUser.role }) ?? {},
      },
    });
  });

  router.get('/admin/settings', async (req, res) => {
    try {
      resolvedStore.requireFeature?.('core.tenant_config', { role: req.adminUser.role });
      requireAdminRole(req.adminUser);
      const featureFlags = resolvedStore.flags?.({ role: req.adminUser.role }) ?? {};
      const data = await resolvedStore.getAdminSettings?.({ featureFlags, refresh: true });
      res.json({ ok: true, data: data ?? {} });
    } catch (error) {
      sendApiError(res, error, 'ADMIN_SETTINGS_UNAVAILABLE');
    }
  });

  router.patch('/admin/settings', async (req, res) => {
    try {
      resolvedStore.requireFeature?.('core.tenant_config', { role: req.adminUser.role });
      requireAdminRole(req.adminUser, ['owner']);
      const data = await resolvedStore.updateAdminSettings?.({
        business: req.body.business,
        publicSite: req.body.publicSite,
      });
      await resolvedStore.recordAuditLog?.({
        action: 'site_settings.update',
        actor: req.adminUser,
        targetType: 'site_settings',
        targetId: 'midway',
        metadata: {
          fields: safeSettingsFields(req.body),
        },
      });
      res.json({ ok: true, data: data ?? {} });
    } catch (error) {
      sendApiError(res, error, 'ADMIN_SETTINGS_UPDATE_FAILED');
    }
  });

  router.get('/admin/tokens', async (req, res) => {
    try {
      requireAdminRole(req.adminUser, ['owner']);
      const data = await apiTokenService.list({ tenantId: resolvedStore.tenantId });
      res.json({ ok: true, data });
    } catch (error) {
      sendApiError(res, error, 'ADMIN_TOKENS_UNAVAILABLE');
    }
  });

  router.post('/admin/tokens', async (req, res) => {
    try {
      requireAdminRole(req.adminUser, ['owner']);
      const { token, record } = await apiTokenService.mint({
        tenantId: resolvedStore.tenantId,
        locationId: resolvedStore.locationId,
        name: req.body?.name,
        scope: req.body?.scope || 'write',
        expiresAt: req.body?.expiresAt || null,
        createdByEmail: req.adminUser?.email || null,
      });
      await resolvedStore.recordAuditLog?.({
        action: 'admin.tokens.create',
        actor: req.adminUser,
        targetType: 'admin_api_token',
        targetId: record.id,
        metadata: { name: record.name, scope: record.scope, prefix: record.tokenPrefix },
      });
      res.status(201).json({ ok: true, data: { token, record } });
    } catch (error) {
      sendApiError(res, error, error.code || 'ADMIN_TOKEN_CREATE_FAILED', error.statusCode || 400);
    }
  });

  router.delete('/admin/tokens/:id', async (req, res) => {
    try {
      requireAdminRole(req.adminUser, ['owner']);
      const result = await apiTokenService.revoke({
        id: req.params.id,
        tenantId: resolvedStore.tenantId,
        revokedByEmail: req.adminUser?.email || null,
      });
      await resolvedStore.recordAuditLog?.({
        action: 'admin.tokens.revoke',
        actor: req.adminUser,
        targetType: 'admin_api_token',
        targetId: result.id,
        metadata: {},
      });
      res.json({ ok: true, data: result });
    } catch (error) {
      sendApiError(res, error, error.code || 'ADMIN_TOKEN_REVOKE_FAILED', error.statusCode || 400);
    }
  });

  router.get('/admin/providers', async (req, res) => {
    try {
      resolvedStore.requireFeature?.('core.tenant_config', { role: req.adminUser.role });
      resolvedStore.requireFeature?.('core.provider_adapters', { role: req.adminUser.role });
      requireAdminRole(req.adminUser);
      const data = await providerConnections.listStatuses();
      res.json({ ok: true, data });
    } catch (error) {
      sendApiError(res, error, 'ADMIN_PROVIDERS_UNAVAILABLE');
    }
  });

  router.put('/admin/providers/instagram', async (req, res) => {
    try {
      resolvedStore.requireFeature?.('core.tenant_config', { role: req.adminUser.role });
      resolvedStore.requireFeature?.('core.provider_adapters', { role: req.adminUser.role });
      requireAdminRole(req.adminUser, ['owner']);
      const data = await providerConnections.upsertInstagramConnection({
        instagramUserId: req.body.instagramUserId,
        accessToken: req.body.accessToken,
        tokenExpiresAt: req.body.tokenExpiresAt,
        feedLimit: req.body.feedLimit,
        apiVersion: req.body.apiVersion,
        handle: req.body.handle,
        profileUrl: req.body.profileUrl,
        actor: req.adminUser,
      });
      await resolvedStore.recordAuditLog?.({
        action: 'provider.instagram.update',
        actor: req.adminUser,
        targetType: 'provider_connection',
        targetId: 'instagram',
        metadata: {
          status: data.status,
          externalAccountId: data.externalAccountId ?? null,
          hasAccessToken: Boolean(req.body.accessToken),
          tokenExpiresAt: data.publicConfig?.tokenExpiresAt ?? null,
        },
      });
      res.json({ ok: true, data });
    } catch (error) {
      sendApiError(res, error, 'ADMIN_INSTAGRAM_UPDATE_FAILED');
    }
  });

  router.post('/admin/providers/instagram/refresh', async (req, res) => {
    try {
      resolvedStore.requireFeature?.('core.tenant_config', { role: req.adminUser.role });
      resolvedStore.requireFeature?.('core.provider_adapters', { role: req.adminUser.role });
      requireAdminRole(req.adminUser, ['owner']);
      const data = await providerConnections.refreshInstagramConnection({
        force: true,
        actor: req.adminUser,
      });
      await resolvedStore.recordAuditLog?.({
        action: data.mode === 'refreshed' ? 'provider.instagram.token_refresh_manual' : `provider.instagram.token_refresh_manual_${data.mode}`,
        actor: req.adminUser,
        targetType: 'provider_connection',
        targetId: 'instagram',
        metadata: {
          mode: data.mode,
          status: data.connection?.status ?? null,
          tokenExpiresAt: data.connection?.publicConfig?.tokenExpiresAt ?? null,
        },
      });
      res.status(data.mode === 'error' ? 502 : 200).json({ ok: data.mode !== 'error', data });
    } catch (error) {
      sendApiError(res, error, 'ADMIN_INSTAGRAM_REFRESH_FAILED');
    }
  });

  router.post('/admin/providers/instagram/oauth/start', async (req, res) => {
    try {
      resolvedStore.requireFeature?.('core.tenant_config', { role: req.adminUser.role });
      resolvedStore.requireFeature?.('core.provider_adapters', { role: req.adminUser.role });
      requireAdminRole(req.adminUser, ['owner']);
      const data = await providerConnections.startInstagramOAuth({
        redirectUri: req.body.redirectUri,
        scopes: req.body.scopes,
        actor: req.adminUser,
      });
      await resolvedStore.recordAuditLog?.({
        action: data.mode === 'placeholder' ? 'provider.instagram.oauth_placeholder' : 'provider.instagram.oauth_start',
        actor: req.adminUser,
        targetType: 'provider_connection',
        targetId: 'instagram',
        metadata: {
          mode: data.mode,
          missing: data.missing ?? [],
          status: data.connection?.status ?? null,
        },
      });
      res.status(data.mode === 'placeholder' ? 202 : 200).json({ ok: true, data });
    } catch (error) {
      sendApiError(res, error, 'ADMIN_INSTAGRAM_OAUTH_START_FAILED');
    }
  });

  router.post('/admin/providers/instagram/oauth/callback', async (req, res) => {
    try {
      resolvedStore.requireFeature?.('core.tenant_config', { role: req.adminUser.role });
      resolvedStore.requireFeature?.('core.provider_adapters', { role: req.adminUser.role });
      requireAdminRole(req.adminUser, ['owner']);
      const data = await providerConnections.completeInstagramOAuth({
        code: req.body.code,
        state: req.body.state,
        error: req.body.error,
        errorDescription: req.body.errorDescription,
        redirectUri: req.body.redirectUri,
        actor: req.adminUser,
      });
      await resolvedStore.recordAuditLog?.({
        action: data.mode === 'placeholder' ? 'provider.instagram.oauth_placeholder_complete' : 'provider.instagram.oauth_complete',
        actor: req.adminUser,
        targetType: 'provider_connection',
        targetId: 'instagram',
        metadata: {
          mode: data.mode,
          status: data.connection?.status ?? null,
          externalAccountId: data.connection?.externalAccountId ?? null,
        },
      });
      res.status(data.mode === 'placeholder' ? 202 : 200).json({ ok: data.mode !== 'error', data });
    } catch (error) {
      sendApiError(res, error, 'ADMIN_INSTAGRAM_OAUTH_COMPLETE_FAILED');
    }
  });

  router.post('/admin/providers/square/oauth/start', async (req, res) => {
    try {
      resolvedStore.requireFeature?.('core.tenant_config', { role: req.adminUser.role });
      resolvedStore.requireFeature?.('core.provider_adapters', { role: req.adminUser.role });
      requireAdminRole(req.adminUser, ['owner']);
      const data = await providerConnections.startSquareOAuth({
        redirectUri: req.body.redirectUri,
        scopes: req.body.scopes,
        actor: req.adminUser,
      });
      await resolvedStore.recordAuditLog?.({
        action: data.mode === 'placeholder' ? 'provider.square.oauth_placeholder' : 'provider.square.oauth_start',
        actor: req.adminUser,
        targetType: 'provider_connection',
        targetId: 'square',
        metadata: {
          mode: data.mode,
          missing: data.missing ?? [],
          status: data.connection?.status ?? null,
        },
      });
      res.status(data.mode === 'placeholder' ? 202 : 200).json({ ok: true, data });
    } catch (error) {
      sendApiError(res, error, 'ADMIN_SQUARE_OAUTH_START_FAILED');
    }
  });

  router.post('/admin/providers/square/oauth/callback', async (req, res) => {
    try {
      resolvedStore.requireFeature?.('core.tenant_config', { role: req.adminUser.role });
      resolvedStore.requireFeature?.('core.provider_adapters', { role: req.adminUser.role });
      requireAdminRole(req.adminUser, ['owner']);
      const data = await completeSquareOAuthForAdmin({
        providerConnections,
        input: {
          code: req.body.code,
          state: req.body.state,
          error: req.body.error,
          errorDescription: req.body.errorDescription,
          redirectUri: req.body.redirectUri,
          locationId: req.body.locationId,
          actor: req.adminUser,
        },
      });
      await resolvedStore.recordAuditLog?.({
        action: data.mode === 'placeholder' ? 'provider.square.oauth_placeholder_complete' : 'provider.square.oauth_complete',
        actor: req.adminUser,
        targetType: 'provider_connection',
        targetId: 'square',
        metadata: {
          mode: data.mode,
          status: data.connection?.status ?? null,
          externalAccountId: data.connection?.externalAccountId ?? null,
        },
      });
      res.status(data.mode === 'placeholder' ? 202 : 200).json({ ok: true, data });
    } catch (error) {
      sendApiError(res, error, 'ADMIN_SQUARE_OAUTH_COMPLETE_FAILED');
    }
  });

  router.get('/admin/providers/square/oauth/callback', async (req, res) => {
    try {
      resolvedStore.requireFeature?.('core.tenant_config', { role: req.adminUser.role });
      resolvedStore.requireFeature?.('core.provider_adapters', { role: req.adminUser.role });
      requireAdminRole(req.adminUser, ['owner']);
      const data = await completeSquareOAuthForAdmin({
        providerConnections,
        input: {
          code: req.query.code,
          state: req.query.state,
          error: req.query.error,
          errorDescription: req.query.error_description,
          redirectUri: req.query.redirect_uri,
          actor: req.adminUser,
        },
      });
      res.json({ ok: true, data });
    } catch (error) {
      sendApiError(res, error, 'ADMIN_SQUARE_OAUTH_COMPLETE_FAILED');
    }
  });

  router.get('/admin/dashboard/today', async (req, res) => {
    try {
      resolvedStore.requireFeature?.('admin.dashboard', { role: req.adminUser.role });
      requireAdminRole(req.adminUser);
      const data = await resolvedStore.adminDashboard({
        from: req.query.from,
        to: req.query.to,
      });
      res.json({ ok: true, data });
    } catch (error) {
      sendApiError(res, error, 'ADMIN_DASHBOARD_UNAVAILABLE');
    }
  });

  router.get('/admin/bookings', async (req, res) => {
    try {
      resolvedStore.requireFeature?.('booking.rv.enabled', { role: req.adminUser.role });
      requireAdminRole(req.adminUser);
      const data = await resolvedStore.listBookings({
        from: req.query.from,
        to: req.query.to,
        status: req.query.status,
      });
      res.json({ ok: true, data });
    } catch (error) {
      sendApiError(res, error, 'ADMIN_BOOKINGS_UNAVAILABLE');
    }
  });

  router.post('/admin/bookings', async (req, res) => {
    try {
      resolvedStore.requireFeature?.('booking.manual_admin', { role: req.adminUser.role });
      requireAdminRole(req.adminUser, ['owner']);
      const booking = await resolvedStore.createAdminBooking({
        siteId: req.body.siteId,
        siteIds: req.body.siteIds,
        startDate: req.body.startDate,
        endDate: req.body.endDate,
        guests: req.body.guests,
        vehicles: req.body.vehicles,
        customer: req.body.customer,
        status: req.body.status,
        notes: req.body.notes,
        source: 'admin',
      });
      await resolvedStore.recordAuditLog?.({
        action: booking.status === 'blocked' ? 'booking.block_site' : 'booking.create_manual',
        actor: req.adminUser,
        targetType: 'rv_booking',
        targetId: booking.bookingCode,
        metadata: {
          siteId: booking.rvSiteId,
          siteIds: booking.rvSiteIds ?? booking.siteIds ?? [booking.rvSiteId],
          startDate: booking.startDate,
          endDate: booking.endDate,
          status: booking.status,
        },
      });
      res.status(201).json({ ok: true, data: booking });
    } catch (error) {
      sendApiError(res, error, 'ADMIN_BOOKING_CREATE_FAILED', 409);
    }
  });

  router.post('/admin/bookings/checkout', async (req, res) => {
    let hold = null;
    let customerSessionId = null;
    try {
      resolvedStore.requireFeature?.('booking.manual_admin', { role: req.adminUser.role });
      resolvedStore.requireFeature?.('payments.enabled', { role: req.adminUser.role });
      resolvedStore.requireFeature?.('payments.provider.square', { role: req.adminUser.role });
      requireAdminRole(req.adminUser, ['owner']);

      customerSessionId = `admin-${req.adminUser.id}`;
      hold = await resolvedStore.hold({
        siteId: req.body.siteId,
        siteIds: req.body.siteIds,
        startDate: req.body.startDate,
        endDate: req.body.endDate,
        guests: req.body.guests,
        vehicles: req.body.vehicles,
        customerSessionId,
      });
      const bookingCode = `MW-${hold.id.slice(0, 6).toUpperCase()}`;
      const squareConfig = await squareProviderConfig();
      const checkout = await createRvCheckoutPaymentLink({
        hold,
        bookingCode,
        customer: req.body.customer,
        redirectUrl: await buildBookingReturnUrl(req, bookingCode, resolvedStore),
        env: squareConfig,
        fetchImpl,
      });
      const booking = await resolvedStore.recordPendingBooking({
        hold,
        customer: req.body.customer,
        bookingCode,
        squareOrderId: checkout.orderId,
        checkoutUrl: checkout.checkoutUrl,
      });
      await resolvedStore.recordAuditLog?.({
        action: 'booking.admin_payment_link',
        actor: req.adminUser,
        targetType: 'rv_booking',
        targetId: booking.bookingCode,
        metadata: {
          siteId: booking.rvSiteId,
          siteIds: booking.rvSiteIds ?? booking.siteIds ?? [booking.rvSiteId],
          startDate: booking.startDate,
          endDate: booking.endDate,
          checkoutUrl: checkout.checkoutUrl,
        },
      });
      res.status(201).json({
        ok: true,
        data: {
          bookingCode: booking.bookingCode,
          hold,
          checkout,
        },
      });
    } catch (error) {
      await releaseCheckoutHold(resolvedStore, hold, customerSessionId);
      sendApiError(res, error, 'ADMIN_BOOKING_CHECKOUT_FAILED', 409);
    }
  });

  router.post('/admin/bookings/:bookingCode/cancel', async (req, res) => {
    try {
      resolvedStore.requireFeature?.('booking.manual_admin', { role: req.adminUser.role });
      requireAdminRole(req.adminUser, ['owner']);
      const booking = await resolvedStore.updateBookingStatus({
        bookingCode: req.params.bookingCode,
        status: 'canceled',
        actor: req.adminUser,
      });
      if (!booking) return res.status(404).json(apiError('BOOKING_NOT_FOUND', 'Booking was not found.'));
      await resolvedStore.recordAuditLog?.({
        action: 'booking.cancel',
        actor: req.adminUser,
        targetType: 'rv_booking',
        targetId: booking.bookingCode,
        metadata: { reason: req.body.reason ?? null },
      });
      res.json({ ok: true, data: booking });
    } catch (error) {
      sendApiError(res, error, 'ADMIN_BOOKING_CANCEL_FAILED');
    }
  });

  router.post('/admin/bookings/:bookingCode/refund', async (req, res) => {
    try {
      resolvedStore.requireFeature?.('payments.refunds', { role: req.adminUser.role });
      requireAdminRole(req.adminUser, ['owner']);

      const booking = await resolvedStore.getBooking(req.params.bookingCode);
      if (!booking) return res.status(404).json(apiError('BOOKING_NOT_FOUND', 'Booking was not found.'));
      if (booking.status === 'refunded') {
        return res.status(409).json(apiError('BOOKING_ALREADY_REFUNDED', 'Booking has already been refunded.'));
      }
      if (!['paid', 'confirmed'].includes(booking.status)) {
        return res.status(409).json(apiError('BOOKING_NOT_REFUNDABLE', 'Only paid or confirmed bookings can be refunded.'));
      }

      const refund = await createSquareRefund({
        booking,
        amountCents: req.body.amountCents,
        reason: req.body.reason,
        idempotencyKey: req.body.idempotencyKey,
        env: await squareProviderConfig(),
        fetchImpl,
      });
      const refunded = await refundBookingRecord(resolvedStore, {
        bookingCode: booking.bookingCode,
        refund,
        actor: req.adminUser,
      });
      await resolvedStore.recordAuditLog?.({
        action: 'payment.refund',
        actor: req.adminUser,
        targetType: 'rv_booking',
        targetId: booking.bookingCode,
        metadata: {
          previousStatus: booking.status,
          providerMode: refund.mode,
          refundId: refund.refundId,
          refundStatus: refund.status,
          amountCents: refund.amountCents,
          currency: refund.currency,
          reason: req.body.reason ?? null,
          squarePaymentId: booking.squarePaymentId ?? null,
        },
      });

      res.json({ ok: true, data: { booking: refunded, refund } });
    } catch (error) {
      sendApiError(res, error, 'ADMIN_BOOKING_REFUND_FAILED', 409);
    }
  });

  router.get('/admin/rv-sites', async (req, res) => {
    try {
      resolvedStore.requireFeature?.('booking.rv.enabled', { role: req.adminUser.role });
      requireAdminRole(req.adminUser);
      const data = await resolvedStore.listSites();
      res.json({ ok: true, data });
    } catch (error) {
      sendApiError(res, error, 'ADMIN_RV_SITES_UNAVAILABLE');
    }
  });

  router.patch('/admin/rv-sites/:siteId', async (req, res) => {
    try {
      resolvedStore.requireFeature?.('booking.site_status_management', { role: req.adminUser.role });
      requireAdminRole(req.adminUser, ['owner']);
      const patch = pickSitePatch(req.body);
      if (patch.squareCatalogObjectId) {
        const inventory = await resolvedStore.listStoreInventory?.() ?? [];
        if (inventory.length && !inventory.some(item => item.squareVariationId === patch.squareCatalogObjectId)) {
          return res.status(400).json(apiError('INVALID_SQUARE_VARIATION', 'Square catalog variation was not found in the synced catalog.'));
        }
      }
      const site = await resolvedStore.updateSiteDetails({
        siteId: req.params.siteId,
        patch,
        actor: req.adminUser,
      });
      if (!site) return res.status(404).json(apiError('RV_SITE_NOT_FOUND', 'RV site was not found.'));
      await resolvedStore.recordAuditLog?.({
        action: Object.keys(patch).length === 1 && patch.status ? 'rv_site.update_status' : 'rv_site.update_details',
        actor: req.adminUser,
        targetType: 'rv_site',
        targetId: site.id,
        metadata: { fields: Object.keys(patch) },
      });
      res.json({ ok: true, data: site });
    } catch (error) {
      sendApiError(res, error, 'ADMIN_RV_SITE_UPDATE_FAILED');
    }
  });

  router.get('/admin/square/catalog', async (req, res) => {
    try {
      resolvedStore.requireFeature?.('core.provider_adapters', { role: req.adminUser.role });
      requireAdminRole(req.adminUser, ['owner']);
      const data = await resolvedStore.listStoreInventory?.() ?? [];
      res.json({ ok: true, data });
    } catch (error) {
      sendApiError(res, error, 'ADMIN_SQUARE_CATALOG_UNAVAILABLE');
    }
  });

  router.post('/admin/square/catalog/sync', async (req, res) => {
    try {
      resolvedStore.requireFeature?.('core.provider_adapters', { role: req.adminUser.role });
      requireAdminRole(req.adminUser, ['owner']);
      const squareConfig = await squareProviderConfig();
      const items = await listSquareCatalogItems({ env: squareConfig, fetchImpl });
      const inventory = normalizeSquareCatalogItemsForInventory(items);
      const data = await resolvedStore.upsertStoreInventory?.(inventory) ?? [];
      await resolvedStore.recordAuditLog?.({
        action: 'square.catalog_sync',
        actor: req.adminUser,
        targetType: 'store_inventory',
        targetId: 'square',
        metadata: {
          itemCount: items.length,
          variationCount: data.length,
        },
      });
      res.json({ ok: true, data });
    } catch (error) {
      sendApiError(res, error, 'ADMIN_SQUARE_CATALOG_SYNC_FAILED', 409);
    }
  });

  router.post('/admin/rv-sites/:siteId/block', async (req, res) => {
    try {
      resolvedStore.requireFeature?.('booking.manual_admin', { role: req.adminUser.role });
      requireAdminRole(req.adminUser, ['owner']);
      const booking = await resolvedStore.createAdminBooking({
        siteId: req.params.siteId,
        startDate: req.body.startDate,
        endDate: req.body.endDate,
        customer: { name: req.body.reason || 'Blocked', phone: '' },
        status: 'blocked',
        notes: req.body.reason ?? null,
        source: 'admin',
      });
      await resolvedStore.recordAuditLog?.({
        action: 'rv_site.block_dates',
        actor: req.adminUser,
        targetType: 'rv_site',
        targetId: req.params.siteId,
        metadata: {
          bookingCode: booking.bookingCode,
          startDate: booking.startDate,
          endDate: booking.endDate,
          reason: req.body.reason ?? null,
        },
      });
      res.status(201).json({ ok: true, data: booking });
    } catch (error) {
      sendApiError(res, error, 'ADMIN_RV_SITE_BLOCK_FAILED', 409);
    }
  });

  router.get('/admin/audit-log', async (req, res) => {
    try {
      resolvedStore.requireFeature?.('core.audit_log', { role: req.adminUser.role });
      requireAdminRole(req.adminUser, ['owner']);
      const data = await resolvedStore.listAuditLogs({ limit: Number(req.query.limit) || 50 });
      res.json({ ok: true, data });
    } catch (error) {
      sendApiError(res, error, 'ADMIN_AUDIT_LOG_UNAVAILABLE');
    }
  });

  router.get('/admin/notifications', async (req, res) => {
    try {
      resolvedStore.requireFeature?.('notifications.dashboard', { role: req.adminUser.role });
      requireAdminRole(req.adminUser);
      const data = await resolvedStore.listNotifications({ limit: Number(req.query.limit) || 50 });
      res.json({ ok: true, data });
    } catch (error) {
      sendApiError(res, error, 'ADMIN_NOTIFICATIONS_UNAVAILABLE');
    }
  });

  return router;
}

function platformProviderConfigsFromEnv(env = {}) {
  const squareApplicationId = envValue(env, 'SQUARE_OAUTH_APPLICATION_ID')
    || envValue(env, 'SQUARE_APPLICATION_ID')
    || envValue(env, 'VITE_SQUARE_APPLICATION_ID');
  const squareClientSecret = envValue(env, 'SQUARE_OAUTH_CLIENT_SECRET')
    || envValue(env, 'SQUARE_CLIENT_SECRET');
  const squareEnvironment = envValue(env, 'SQUARE_OAUTH_ENVIRONMENT')
    || envValue(env, 'SQUARE_ENVIRONMENT')
    || envValue(env, 'VITE_SQUARE_ENVIRONMENT')
    || '';
  const squareRedirectUri = envValue(env, 'SQUARE_OAUTH_REDIRECT_URI')
    || envValue(env, 'SQUARE_REDIRECT_URI')
    || '';
  const instagramApplicationId = envValue(env, 'INSTAGRAM_OAUTH_APPLICATION_ID')
    || envValue(env, 'INSTAGRAM_APP_ID')
    || envValue(env, 'META_APP_ID')
    || '';
  const instagramClientSecret = envValue(env, 'INSTAGRAM_OAUTH_CLIENT_SECRET')
    || envValue(env, 'INSTAGRAM_APP_SECRET')
    || envValue(env, 'META_APP_SECRET')
    || '';
  const instagramRedirectUri = envValue(env, 'INSTAGRAM_OAUTH_REDIRECT_URI')
    || envValue(env, 'INSTAGRAM_REDIRECT_URI')
    || '';
  const instagramApiVersion = envValue(env, 'INSTAGRAM_GRAPH_API_VERSION') || 'v24.0';
  const instagramFeedLimit = Number(envValue(env, 'INSTAGRAM_FEED_LIMIT') || 6);

  const configs = [];

  if (squareApplicationId || squareClientSecret || squareEnvironment || squareRedirectUri) {
    configs.push({
      providerKey: 'square',
      environment: squareEnvironment,
      publicConfig: {
        applicationId: squareApplicationId,
        environment: squareEnvironment,
        redirectUri: squareRedirectUri,
      },
      encryptedCredentials: {
        clientSecret: squareClientSecret,
      },
    });
  }

  if (instagramApplicationId || instagramClientSecret || instagramRedirectUri) {
    configs.push({
      providerKey: 'instagram',
      publicConfig: {
        applicationId: instagramApplicationId,
        redirectUri: instagramRedirectUri,
        apiVersion: instagramApiVersion,
        apiBaseUrl: 'https://graph.instagram.com',
        feedLimit: Number.isFinite(instagramFeedLimit) ? instagramFeedLimit : 6,
        scopes: ['instagram_business_basic'],
      },
      encryptedCredentials: {
        clientSecret: instagramClientSecret,
      },
    });
  }

  return configs;
}

function envValue(env, name) {
  const value = env[name];
  return typeof value === 'string' ? value.trim() : value;
}

async function buildBookingReturnUrl(req, bookingCode, store) {
  const configured = await store?.getPublicSiteUrl?.();
  if (configured) return `${configured.replace(/\/$/, '')}/?booking=${encodeURIComponent(bookingCode)}`;
  return `${req.protocol}://${req.get('host')}/?booking=${encodeURIComponent(bookingCode)}`;
}

function checkoutSurface(config = {}) {
  const surface = readConfig(config, 'checkoutSurface');
  if (surface) return surface;
  return 'web-payments';
}

function requestPublicUrl(req) {
  const forwardedProto = String(req.get?.('x-forwarded-proto') || '').split(',')[0].trim();
  const forwardedHost = String(req.get?.('x-forwarded-host') || '').split(',')[0].trim();
  const protocol = forwardedProto || req.protocol;
  const host = forwardedHost || req.get('host');
  return `${protocol}://${host}${req.originalUrl}`;
}

async function releaseCheckoutHold(store, hold, customerSessionId) {
  if (!hold?.id || !customerSessionId || !store?.releaseHold) return;
  try {
    await store.releaseHold({ holdId: hold.id, customerSessionId });
  } catch (releaseError) {
    console.warn('[Booking] Could not release failed checkout hold:', releaseError.message);
  }
}

function paymentAttemptIdempotencyKey(bookingCode, sourceId) {
  const booking = String(bookingCode || 'booking')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-|-$/g, '')
    || 'booking';
  const source = sourceId || crypto.randomUUID();
  const digest = crypto
    .createHash('sha256')
    .update(String(source))
    .digest('hex')
    .slice(0, 18);
  return `payment-${booking}-${digest}`.slice(0, 45);
}

function isPaymentComplete(status) {
  return ['APPROVED', 'COMPLETED'].includes(String(status || '').toUpperCase());
}

function parseDriverLicenseImage(body = {}) {
  const dataUrl = String(body.dataUrl || '');
  const match = dataUrl.match(/^data:(image\/(?:jpeg|jpg|png|webp));base64,([a-zA-Z0-9+/=]+)$/);
  if (!match) {
    throw new Error('Driver license image must be a JPG, PNG, or WebP file.');
  }

  const contentType = match[1] === 'image/jpg' ? 'image/jpeg' : match[1];
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length === 0) throw new Error('Driver license image is empty.');
  if (buffer.length > 5 * 1024 * 1024) {
    throw new Error('Driver license image must be under 5 MB.');
  }

  return {
    buffer,
    sizeBytes: buffer.length,
    contentType,
    fileName: String(body.fileName || 'driver-license.jpg').trim() || 'driver-license.jpg',
  };
}

function readConfig(config, key) {
  const value = config?.[key];
  if (value !== undefined && value !== null && value !== '') return typeof value === 'string' ? value.trim() : value;
  return undefined;
}

function requireCronAuth(req, env = {}) {
  const expected = env.MIDWAY_CRON_SECRET || env.CRON_SECRET || env.VERCEL_CRON_SECRET;
  if (!expected && env.NODE_ENV !== 'production') return true;
  const header = req.get('authorization') || req.get('x-cron-secret') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : header;
  if (expected && token === expected) return true;
  const error = new Error('Cron authentication is required.');
  error.code = 'CRON_AUTH_REQUIRED';
  error.statusCode = 401;
  throw error;
}

function apiError(code, message) {
  return {
    ok: false,
    error: { code, message },
  };
}

async function authenticateMcpRequest(req, { apiTokenService } = {}) {
  if (!apiTokenService) return null;
  const authHeader = req.get?.('authorization') || '';
  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!bearerMatch) return null;
  const token = bearerMatch[1].trim();
  if (!token.startsWith('mw_live_') && !token.startsWith('mw_test_')) return null;
  try {
    return await apiTokenService.authenticate(token);
  } catch {
    return null;
  }
}

function sendApiError(res, error, fallbackCode, fallbackStatus = 400) {
  res.status(error.statusCode || fallbackStatus).json(apiError(error.code || fallbackCode, error.message));
}

async function completeSquareOAuthForAdmin({ providerConnections, input }) {
  return providerConnections.completeSquareOAuth(input);
}

function safeSettingsFields(body = {}) {
  return {
    business: Object.keys(body.business || {}).filter(key => !/secret|token|password|key/i.test(key)),
    publicSite: Object.keys(body.publicSite || {}).filter(key => !/secret|token|password|key/i.test(key)),
  };
}

function pickSitePatch(body = {}) {
  const allowed = [
    'displayName',
    'status',
    'nightlyPriceCents',
    'maxRvLengthFeet',
    'amp',
    'type',
    'siteType',
    'shade',
    'sku',
    'squareCatalogObjectId',
    'customerNotes',
    'adminNotes',
    'amenities',
    'mapX',
    'mapY',
    'mapWidth',
    'mapHeight',
    'rotation',
  ];
  return Object.fromEntries(
    allowed
      .filter(key => key in body)
      .map(key => [key, body[key]]),
  );
}

async function refundBookingRecord(store, input) {
  if (store.refundBooking) return store.refundBooking(input);
  return store.updateBookingStatus({
    bookingCode: input.bookingCode,
    status: 'refunded',
    refund: input.refund,
    actor: input.actor,
  });
}
