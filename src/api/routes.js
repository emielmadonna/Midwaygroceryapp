import crypto from 'node:crypto';
import express from 'express';

import { createAdminAuthService, requireAdminRole } from '../lib/admin-auth.js';
import { createAgent } from '../lib/agent.js';
import { createAgentConversationStore } from '../lib/agent-conversations.js';
import { createOpenAiProvider } from '../lib/ai-providers/openai-provider.js';
import { createApiTokenService } from '../lib/api-tokens.js';
import { createCommandCenterService } from '../lib/command-center-service.js';
import { registerCommandCenterTools } from '../lib/command-center-tools.js';
import { createIdempotencyMiddleware, createIdempotencyService } from '../lib/idempotency.js';
import { createMcpServer } from '../lib/mcp-server.js';
import { calculateCancellationRefund } from '../lib/rv-booking.js';
import { createMidwayHarness } from '../lib/midway-harness.js';
import { createNotificationService } from '../lib/notifications.js';
import { createProviderConnectionService } from '../lib/provider-connections.js';
import { createSupabaseServerClient } from '../lib/supabase-server.js';
import { createToolRegistry } from '../lib/tool-registry.js';
import { registerCoreTools } from '../lib/registered-tools.js';
import { registerXeroTools } from '../lib/xero-tools.js';
import {
  createEditPaymentSession,
  createRvCheckoutPaymentLink,
  createRvWebPaymentSession,
  createSquareRefund,
  createSquareSupplementPayment,
  createSquareWebPayment,
  listSquareCatalogItems,
  normalizeSquareCatalogItemsForInventory,
  verifySquareWebhookSignature,
} from '../lib/square-api.js';
import { getSquareStorefront } from '../lib/square-storefront.js';
import { createSquareOrder, retrieveSquareOrder, createOrderPayment, sendOrderConfirmationEmail, sendOwnerOrderEmail } from '../lib/order-checkout.js';
import { normalizeSquareWebhookEvent } from '../lib/square-webhooks.js';
import {
  buildSlackInstallUrl,
  exchangeSlackOAuthCode,
  postSlackMessage,
  slackProviderConfigFromEnv,
  verifySlackSignature,
} from '../lib/slack-api.js';
import { buildXeroAuthUrl, xeroProviderConfigFromEnv } from '../lib/xero-api.js';
import { createXeroService } from '../lib/xero-service.js';
import { buildQuickBooksAuthUrl, quickbooksProviderConfigFromEnv } from '../lib/quickbooks-api.js';
import { createQuickBooksService } from '../lib/quickbooks-service.js';
import { createQuickBooksDailySales } from '../lib/quickbooks-daily-sales.js';
import { registerQuickBooksTools } from '../lib/quickbooks-tools.js';

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
  const supabase = env.NODE_ENV !== 'production' && env.MIDWAY_ALLOW_MEMORY_STORE === 'true'
    ? null
    : createSupabaseServerClient({ env });
  const apiTokenService = createApiTokenService({ supabase, env });
  const idempotencyService = createIdempotencyService({ supabase });
  const adminAuth = createAdminAuthService({ env, apiTokenService });
  const squareProviderConfig = async () => {
    const providerConfig = await providerConnections.getProviderConfig('square').catch(() => ({}));
    let storeConfig = {};
    try {
      storeConfig = await resolvedStore.getProviderConfig?.('square') ?? {};
    } catch {
      storeConfig = {};
    }
    const environmentConfig = squareRuntimeConfigFromEnv(env);
    const hasSavedMerchantCredential = Boolean(storeConfig.accessToken || providerConfig.accessToken);
    return {
      nodeEnv: env.NODE_ENV,
      ...(hasSavedMerchantCredential
        ? { ...environmentConfig, ...providerConfig, ...storeConfig }
        : { ...providerConfig, ...storeConfig, ...environmentConfig }),
    };
  };
  const commandCenter = createCommandCenterService({
    store: resolvedStore,
    supabase,
    providerConnections,
    squareConfig: squareProviderConfig,
    fetchImpl,
    env,
  });
  const bookingActions = {
    async refund({ input, actor }) {
      const booking = await resolvedStore.getBooking(input.bookingCode);
      if (!booking) throw bookingActionError('BOOKING_NOT_FOUND', 'Booking was not found.', 404);
      if (!['paid', 'confirmed'].includes(booking.status)) throw bookingActionError('BOOKING_NOT_REFUNDABLE', 'Only paid or confirmed bookings can be refunded.', 409);
      const refund = await createSquareRefund({
        booking,
        reason: input.reason,
        env: await squareProviderConfig(),
        fetchImpl,
      });
      const updated = await refundBookingRecord(resolvedStore, { bookingCode: booking.bookingCode, refund, actor });
      return { booking: updated, refund };
    },
    async update({ input, actor }) {
      const booking = await resolvedStore.getBooking(input.bookingCode);
      if (!booking) throw bookingActionError('BOOKING_NOT_FOUND', 'Booking was not found.', 404);
      const { bookingCode, ...patch } = input;
      const preview = await resolvedStore.previewBookingEdit?.({ bookingCode, patch });
      if (!preview) throw bookingActionError('BOOKING_NOT_FOUND', 'Booking was not found.', 404);
      if (preview.diffCents > 0) {
        throw bookingActionError('BOOKING_PAYMENT_REQUIRED', `This change requires an additional ${formatMoneyForError(preview.diffCents)} payment. Open the booking screen to collect it safely.`, 409);
      }
      const applied = await resolvedStore.updateBookingDetails({ bookingCode, patch });
      if (preview.diffCents < 0 && booking.squarePaymentId) {
        const refund = await createSquareRefund({ booking, amountCents: Math.abs(preview.diffCents), reason: 'Booking edited — price reduced', env: await squareProviderConfig(), fetchImpl });
        return { ...applied, refund, changedBy: actor?.email || actor?.id || null };
      }
      return { ...applied, changedBy: actor?.email || actor?.id || null };
    },
  };
  const toolRegistry = createToolRegistry();
  registerCoreTools(toolRegistry, { store: resolvedStore, bookingActions });
  registerCommandCenterTools(toolRegistry, { commandCenter });
  const xeroService = createXeroService({ store: resolvedStore, env, fetchImpl });
  registerXeroTools(toolRegistry, { xeroService, env });
  const quickbooksService = createQuickBooksService({ store: resolvedStore, env, fetchImpl });
  registerQuickBooksTools(toolRegistry, { quickbooksService, env });
  const mcpServer = createMcpServer({ registry: toolRegistry, store: resolvedStore });
  const aiProvider = {
    name: 'openai',
    async runTurn(input) {
      const saved = await providerConnections.getProviderConfig('openai');
      return createOpenAiProvider({
        env: {
          ...env,
          OPENAI_API_KEY: saved.apiKey || env.OPENAI_API_KEY,
          OPENAI_MODEL: saved.model || env.OPENAI_MODEL,
          OPENAI_REASONING_EFFORT: saved.reasoningEffort || env.OPENAI_REASONING_EFFORT,
        },
      }).runTurn(input);
    },
  };
  const agent = createAgent({ provider: aiProvider, registry: toolRegistry, store: resolvedStore });
  const agentStore = createAgentConversationStore({ supabase });

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

  router.get('/health', async (_req, res) => {
    const [square, openai, connectors] = await Promise.all([
      commandCenter.getSquareSnapshot(),
      providerConnections.getOpenAiStatus().catch(error => ({ status: 'error', errorMessage: error.message })),
      commandCenter.listConnectors().catch(error => [{ status: 'error', errorMessage: error.message }]),
    ]);
    const persistenceReady = Boolean(supabase);
    const coreReady = persistenceReady && square.connected === true;
    const assistantReady = openai.status === 'connected';
    const data = {
      status: coreReady && assistantReady ? 'ready' : coreReady ? 'degraded' : 'setup_required',
      persistence: { ready: persistenceReady, mode: persistenceReady ? 'supabase' : 'memory' },
      square: { ready: square.connected === true, status: square.status, errorMessage: square.errorMessage ?? null },
      openai: { ready: openai.status === 'connected', status: openai.status, errorMessage: openai.errorMessage ?? null },
      mcp: {
        endpoint: '/api/mcp',
        inboundReady: persistenceReady,
        authentication: 'Bearer mw_ API token',
        vendorConnections: connectors.filter(connector => connector.status === 'connected').length,
        vendorConnectionErrors: connectors.filter(connector => connector.status === 'error').length,
      },
      checkedAt: new Date().toISOString(),
    };
    res.json({ ok: true, data });
  });

  const runSalesHistoryCron = async (req, res) => {
    try {
      requireCronAuth(req, env);
      // Re-read two weeks each day so late offline Square orders, edits, and
      // returns repair the existing facts instead of leaving stale history.
      const sales = await commandCenter.syncSalesHistory({ days: Number(req.body?.days) || 14, actor: { id: 'cron', role: 'system' } });
      const inventory = await commandCenter.captureInventorySnapshot();
      res.json({ ok: true, data: { sales, inventory } });
    } catch (error) {
      sendApiError(res, error, error.code || 'SALES_HISTORY_CRON_FAILED', error.statusCode || 502);
    }
  };
  router.get('/cron/sales-history', runSalesHistoryCron);
  router.post('/cron/sales-history', runSalesHistoryCron);

  const runQuickBooksDailySalesCron = async (req, res) => {
    try {
      requireCronAuth(req, env);
      // Post yesterday's Square totals to QuickBooks as one sales receipt.
      // Quietly skips until QuickBooks is connected, and never double-posts a day.
      const dailySales = createQuickBooksDailySales({ quickbooksService, commandCenter, env });
      const data = await dailySales.postDailySales({ businessDate: req.body?.businessDate || null });
      if (data.status === 'posted') {
        await resolvedStore.recordAuditLog?.({
          action: 'quickbooks.daily_sales_posted',
          actor: { id: 'cron', role: 'system' },
          targetType: 'quickbooks_sales_receipt',
          targetId: data.receiptId || data.businessDate,
          metadata: { businessDate: data.businessDate, netCents: data.netCents, taxCents: data.taxCents },
        });
      }
      res.json({ ok: true, data });
    } catch (error) {
      sendApiError(res, error, error.code || 'QBO_DAILY_SALES_CRON_FAILED', error.statusCode || 502);
    }
  };
  router.get('/cron/qbo-daily-sales', runQuickBooksDailySalesCron);
  router.post('/cron/qbo-daily-sales', runQuickBooksDailySalesCron);

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
        authentication: {
          type: 'bearer',
          tokenPrefix: 'mw_',
          createAt: '/admin.html?view=connections',
        },
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

  router.use('/admin', createIdempotencyMiddleware({
    service: idempotencyService,
    tenantId: resolvedStore.tenantId,
  }));

  router.get('/public/bootstrap', async (req, res) => {
    try {
      const featureFlags = resolvedStore.flags?.() ?? {};
      if (featureFlags.products || featureFlags.coffee) {
        try {
          const squareConfig = await squareProviderConfig();
          if (squareConfig.accessToken) {
            const storefront = await getSquareStorefront({ env: squareConfig, fetchImpl });
            resolvedStore.state.squareProducts = storefront.products;
            resolvedStore.state.squareCoffeeMenu = storefront.coffeeMenu;
          } else {
            const persistedProducts = await resolvedStore.listStoreInventory?.({ activeOnly: true }) ?? [];
            resolvedStore.state.squareProducts = persistedProducts;
          }
        } catch (error) {
          console.warn('[Square] Storefront sync unavailable:', error.message);
          resolvedStore.state.squareProducts = resolvedStore.state.squareProducts || [];
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

  // ─── Order ahead (Square catalog pickup orders) ───────────────────────────
  router.post('/orders/checkout', async (req, res) => {
    try {
      const items = (Array.isArray(req.body.items) ? req.body.items : [])
        .map(i => ({ variationId: String(i.variationId || ''), quantity: Math.max(1, parseInt(i.quantity, 10) || 1) }))
        .filter(i => i.variationId);
      if (!items.length) throw new Error('Your cart is empty.');
      const customer = req.body.customer || {};
      const squareConfig = await squareProviderConfig();
      if (!squareConfig.accessToken) throw new Error('Online ordering is unavailable right now.');
      const orderCode = `MWO-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
      const order = await createSquareOrder({ items, orderCode, customer, env: squareConfig, fetchImpl });
      res.json({
        ok: true,
        data: {
          orderCode,
          orderId: order.orderId,
          amountCents: order.amountCents,
          currency: order.currency,
          checkout: {
            mode: 'web-payments',
            environment: squareConfig.environment || (env.NODE_ENV === 'production' ? 'production' : 'sandbox'),
            applicationId: squareConfig.applicationId,
            locationId: squareConfig.locationId,
            currency: order.currency,
          },
        },
      });
    } catch (error) {
      res.status(400).json(apiError('ORDER_CHECKOUT_FAILED', error.message));
    }
  });

  router.post('/orders/pay', async (req, res) => {
    try {
      const { orderId, orderCode, sourceId, verificationToken, idempotencyKey } = req.body;
      const customer = req.body.customer || {};
      if (!orderId || !sourceId) throw new Error('Missing payment details.');
      const squareConfig = await squareProviderConfig();
      const authoritative = await retrieveSquareOrder({ orderId, env: squareConfig, fetchImpl });
      const payment = await createOrderPayment({
        orderId,
        amountCents: authoritative.amountCents,
        currency: authoritative.currency,
        sourceId,
        verificationToken,
        idempotencyKey,
        orderCode,
        buyerEmail: customer.email,
        env: squareConfig,
        fetchImpl,
      });
      const orderForEmail = {
        orderCode,
        amountCents: payment.amountCents,
        customerEmail: customer.email,
        customerName: customer.name,
        customerPhone: customer.phone,
        items: Array.isArray(req.body.itemsSummary) ? req.body.itemsSummary : [],
        receiptUrl: payment.receiptUrl,
      };
      try {
        await sendOrderConfirmationEmail({ order: orderForEmail, env, fetchImpl });
      } catch (emailError) {
        console.warn('[Order] customer email failed:', emailError.message);
      }
      const ownerEmail = env.ADMIN_OWNER_EMAIL || env.OWNER_EMAIL;
      if (ownerEmail) {
        try {
          await sendOwnerOrderEmail({ order: orderForEmail, ownerEmail, env, fetchImpl });
        } catch (emailError) {
          console.warn('[Order] owner email failed:', emailError.message);
        }
      }
      try {
        await resolvedStore.recordNotification?.({
          type: 'admin.order_received',
          channel: 'dashboard',
          recipient: 'owner',
          subject: `New pickup order ${orderCode}`,
          body: `${customer.name || 'A customer'} placed a pickup order for $${(payment.amountCents / 100).toFixed(2)}.`,
          status: 'queued',
        });
      } catch { /* best effort */ }
      res.json({ ok: true, data: { orderCode, payment, pickup: 'Wednesday afternoon' } });
    } catch (error) {
      res.status(402).json(apiError('ORDER_PAYMENT_FAILED', error.message));
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

  router.post('/bookings/lookup', async (req, res) => {
    try {
      const { phone, email } = req.body ?? {};
      if (!phone || !email) {
        return res.status(400).json(apiError('LOOKUP_FIELDS_REQUIRED', 'Phone and email are required.'));
      }
      const bookings = await resolvedStore.lookupPublicBookings({ phone, email });
      res.json({ ok: true, data: bookings });
    } catch (error) {
      sendApiError(res, error, 'LOOKUP_FAILED');
    }
  });

  router.post('/bookings/:bookingCode/edit', async (req, res) => {
    try {
      const booking = await resolvedStore.getBooking(req.params.bookingCode);
      if (!booking) return res.status(404).json(apiError('BOOKING_NOT_FOUND', 'Booking was not found.'));

      const { phone, email, sourceId, verificationToken, idempotencyKey, ...patch } = req.body ?? {};
      if (!verifyPublicBookingAuth(booking, { phone, email })) {
        return res.status(403).json(apiError('BOOKING_AUTH_FAILED', 'Phone or email does not match this booking.'));
      }
      if (!['confirmed', 'paid'].includes(booking.status)) {
        return res.status(409).json(apiError('BOOKING_NOT_EDITABLE', 'Only confirmed bookings can be edited.'));
      }

      const editPatch = pickEditPatch(patch);
      const preview = await resolvedStore.previewBookingEdit?.({ bookingCode: booking.bookingCode, patch: editPatch });
      if (!preview) return res.status(404).json(apiError('BOOKING_NOT_FOUND', 'Booking was not found.'));

      const { diffCents, prevTotalCents, newTotalCents } = preview;

      if (diffCents > 0) {
        if (!sourceId) {
          const squareConfig = await squareProviderConfig();
          let checkoutConfig = null;
          try {
            checkoutConfig = createEditPaymentSession({ bookingCode: booking.bookingCode, diffCents, env: squareConfig });
          } catch {
            // Square not configured — return diff without checkout config
          }
          return res.status(402).json({ ok: false, data: { diffCents, prevTotalCents, newTotalCents, checkoutConfig } });
        }
        const squareConfig = await squareProviderConfig();
        const payment = await createSquareSupplementPayment({
          booking,
          diffCents,
          sourceId,
          verificationToken,
          idempotencyKey,
          env: squareConfig,
          fetchImpl,
        });
        if (!isPaymentComplete(payment.status)) {
          return res.status(402).json(apiError('PAYMENT_NOT_COMPLETED', `Square payment status is ${payment.status || 'unknown'}.`));
        }
        const editResult = await resolvedStore.updateBookingDetails({ bookingCode: booking.bookingCode, patch: editPatch });
        if (!editResult) return res.status(404).json(apiError('BOOKING_NOT_FOUND', 'Booking was not found.'));
        const updated = editResult.booking;
        await resolvedStore.recordAuditLog?.({
          action: 'booking.edit_supplement_charged',
          actor: { id: 'public-checkout', role: 'customer' },
          targetType: 'rv_booking',
          targetId: updated.bookingCode,
          metadata: { diffCents, paymentId: payment.paymentId, prevTotalCents, newTotalCents },
        });
        await resolvedStore.recordAuditLog?.({
          action: 'booking.edit',
          actor: { id: 'self-service', role: 'customer' },
          targetType: 'rv_booking',
          targetId: updated.bookingCode,
          metadata: { prevTotalCents, newTotalCents, diffCents, patch: editPatch },
        });
        return res.json({ ok: true, data: { booking: updated, diffCents, prevTotalCents, newTotalCents } });
      }

      // No payment needed — apply the edit directly
      const editResult = await resolvedStore.updateBookingDetails({ bookingCode: booking.bookingCode, patch: editPatch });
      if (!editResult) return res.status(404).json(apiError('BOOKING_NOT_FOUND', 'Booking was not found.'));
      const { booking: updated } = editResult;

      if (diffCents < 0 && booking.squarePaymentId) {
        const squareConfig = await squareProviderConfig();
        const refund = await createSquareRefund({
          booking,
          amountCents: Math.abs(diffCents),
          reason: 'Booking edited — price reduced',
          env: squareConfig,
          fetchImpl,
        });
        await resolvedStore.recordAuditLog?.({
          action: 'booking.edit_refund_issued',
          actor: { id: 'public-checkout', role: 'customer' },
          targetType: 'rv_booking',
          targetId: updated.bookingCode,
          metadata: { diffCents, refundId: refund.refundId, prevTotalCents, newTotalCents },
        });
      }

      await resolvedStore.recordAuditLog?.({
        action: 'booking.edit',
        actor: { id: 'self-service', role: 'customer' },
        targetType: 'rv_booking',
        targetId: updated.bookingCode,
        metadata: { prevTotalCents, newTotalCents, diffCents, patch: pickEditPatch(patch) },
      });

      res.json({ ok: true, data: { booking: updated, diffCents, prevTotalCents, newTotalCents } });
    } catch (error) {
      sendApiError(res, error, 'BOOKING_EDIT_FAILED', 409);
    }
  });

  router.post('/bookings/:bookingCode/cancel', async (req, res) => {
    try {
      const booking = await resolvedStore.getBooking(req.params.bookingCode);
      if (!booking) return res.status(404).json(apiError('BOOKING_NOT_FOUND', 'Booking was not found.'));

      const { phone, email } = req.body ?? {};
      if (!verifyPublicBookingAuth(booking, { phone, email })) {
        return res.status(403).json(apiError('BOOKING_AUTH_FAILED', 'Phone or email does not match this booking.'));
      }
      if (['canceled', 'expired', 'refunded'].includes(booking.status)) {
        return res.status(409).json(apiError('BOOKING_ALREADY_CANCELED', 'This booking is already canceled.'));
      }

      const { refundCents, policyTier, daysUntilArrival } = calculateCancellationRefund(booking);

      if (refundCents > 0 && booking.squarePaymentId) {
        const squareConfig = await squareProviderConfig();
        const refund = await createSquareRefund({
          booking,
          amountCents: refundCents,
          reason: `Customer self-canceled — ${policyTier} refund policy`,
          env: squareConfig,
          fetchImpl,
        });
        await resolvedStore.updateBookingStatus({ bookingCode: booking.bookingCode, status: 'canceled' });
        await resolvedStore.recordAuditLog?.({
          action: 'booking.self_cancel',
          actor: { id: 'self-service', role: 'customer' },
          targetType: 'rv_booking',
          targetId: booking.bookingCode,
          metadata: { policyTier, refundCents, daysUntilArrival, refundId: refund.refundId },
        });
        const canceled = await resolvedStore.getBooking(booking.bookingCode);
        return res.json({ ok: true, data: { booking: canceled, policyTier, refundCents, daysUntilArrival } });
      }

      const canceled = await resolvedStore.updateBookingStatus({ bookingCode: booking.bookingCode, status: 'canceled' });
      await resolvedStore.recordAuditLog?.({
        action: 'booking.self_cancel',
        actor: { id: 'self-service', role: 'customer' },
        targetType: 'rv_booking',
        targetId: booking.bookingCode,
        metadata: { policyTier, refundCents: 0, daysUntilArrival },
      });
      res.json({ ok: true, data: { booking: canceled, policyTier, refundCents: 0, daysUntilArrival } });
    } catch (error) {
      sendApiError(res, error, 'BOOKING_CANCEL_FAILED');
    }
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

  router.get('/admin/hours', async (req, res) => {
    try {
      resolvedStore.requireFeature?.('core.tenant_config', { role: req.adminUser.role });
      requireAdminRole(req.adminUser);
      const data = await resolvedStore.listStoreHours?.();
      res.json({ ok: true, data: data ?? [] });
    } catch (error) {
      sendApiError(res, error, 'ADMIN_HOURS_UNAVAILABLE');
    }
  });

  router.patch('/admin/hours', async (req, res) => {
    try {
      resolvedStore.requireFeature?.('core.tenant_config', { role: req.adminUser.role });
      requireAdminRole(req.adminUser, ['owner']);
      const rows = Array.isArray(req.body?.hours) ? req.body.hours : [];
      const data = await resolvedStore.updateStoreHours?.(rows);
      await resolvedStore.recordAuditLog?.({
        action: 'store_hours.update',
        actor: req.adminUser,
        targetType: 'store_hours',
        targetId: 'midway',
        metadata: { dayCount: rows.length },
      });
      res.json({ ok: true, data: data ?? [] });
    } catch (error) {
      sendApiError(res, error, 'ADMIN_HOURS_UPDATE_FAILED');
    }
  });

  router.get('/admin/fuel-prices', async (req, res) => {
    try {
      resolvedStore.requireFeature?.('fuel.prices', { role: req.adminUser.role });
      const data = await resolvedStore.listFuelPrices?.();
      res.json({ ok: true, data: data ?? [] });
    } catch (error) {
      sendApiError(res, error, error.code || 'ADMIN_FUEL_PRICES_UNAVAILABLE', error.statusCode || 400);
    }
  });

  router.patch('/admin/fuel-prices', async (req, res) => {
    try {
      resolvedStore.requireFeature?.('fuel.prices', { role: req.adminUser.role });
      requireAdminRole(req.adminUser);
      const updates = Array.isArray(req.body?.prices) ? req.body.prices : [];
      const results = [];
      for (const update of updates) {
        results.push(await resolvedStore.updateFuelPrice?.(update));
      }
      await resolvedStore.recordAuditLog?.({
        action: 'fuel.prices.update',
        actor: req.adminUser,
        targetType: 'fuel_prices',
        targetId: 'midway',
        metadata: { count: results.length },
      });
      const data = await resolvedStore.listFuelPrices?.();
      res.json({ ok: true, data: data ?? [] });
    } catch (error) {
      sendApiError(res, error, error.code || 'ADMIN_FUEL_PRICES_UPDATE_FAILED', error.statusCode || 400);
    }
  });

  router.get('/admin/fuel-inventory', async (req, res) => {
    try {
      resolvedStore.requireFeature?.('fuel.tank_levels', { role: req.adminUser.role });
      const data = await resolvedStore.listFuelInventory?.();
      res.json({ ok: true, data: data ?? [] });
    } catch (error) {
      sendApiError(res, error, error.code || 'ADMIN_FUEL_INVENTORY_UNAVAILABLE', error.statusCode || 400);
    }
  });

  router.patch('/admin/fuel-inventory', async (req, res) => {
    try {
      resolvedStore.requireFeature?.('fuel.tank_levels', { role: req.adminUser.role });
      requireAdminRole(req.adminUser);
      const updates = Array.isArray(req.body?.tanks) ? req.body.tanks : [];
      for (const update of updates) {
        await resolvedStore.updateFuelInventory?.(update);
      }
      await resolvedStore.recordAuditLog?.({
        action: 'fuel.inventory.update',
        actor: req.adminUser,
        targetType: 'fuel_inventory',
        targetId: 'midway',
        metadata: { count: updates.length },
      });
      const data = await resolvedStore.listFuelInventory?.();
      res.json({ ok: true, data: data ?? [] });
    } catch (error) {
      sendApiError(res, error, error.code || 'ADMIN_FUEL_INVENTORY_UPDATE_FAILED', error.statusCode || 400);
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

  router.get('/admin/agent/conversations', async (req, res) => {
    try {
      resolvedStore.requireFeature?.('ai.command_box', { role: req.adminUser.role });
      requireAdminRole(req.adminUser);
      const data = await agentStore.list({ tenantId: resolvedStore.tenantId, channel: 'admin' });
      res.json({ ok: true, data });
    } catch (error) {
      sendApiError(res, error, error.code || 'AGENT_LIST_FAILED', error.statusCode || 400);
    }
  });

  router.post('/admin/agent/conversations', async (req, res) => {
    try {
      resolvedStore.requireFeature?.('ai.command_box', { role: req.adminUser.role });
      requireAdminRole(req.adminUser);
      const conversation = await agentStore.create({
        tenantId: resolvedStore.tenantId,
        locationId: resolvedStore.locationId,
        channel: 'admin',
        title: typeof req.body?.title === 'string' && req.body.title.trim() ? req.body.title.trim() : 'New conversation',
        createdByEmail: req.adminUser.email || null,
        createdByActorType: req.adminUser.actorType || 'session',
      });
      res.status(201).json({ ok: true, data: conversation });
    } catch (error) {
      sendApiError(res, error, error.code || 'AGENT_CREATE_FAILED', error.statusCode || 400);
    }
  });

  router.get('/admin/agent/conversations/:id/messages', async (req, res) => {
    try {
      resolvedStore.requireFeature?.('ai.command_box', { role: req.adminUser.role });
      requireAdminRole(req.adminUser);
      const data = await agentStore.listMessages({ conversationId: req.params.id });
      res.json({ ok: true, data });
    } catch (error) {
      sendApiError(res, error, error.code || 'AGENT_MESSAGES_FAILED', error.statusCode || 400);
    }
  });

  const runAdminAgentTurn = async (req, { onEvent } = {}) => {
      resolvedStore.requireFeature?.('ai.command_box', { role: req.adminUser.role });
      requireAdminRole(req.adminUser);
      const {
        conversationId,
        userMessage = '',
        confirmations = {},
        pendingConfirmation = null,
        attachments = [],
      } = req.body || {};
      if (!conversationId) throw badRequest('conversationId is required.');
      const persisted = await agentStore.listMessages({ conversationId });
      const conversationMessages = persisted.map(toAgentMessage);
      const newMessages = [];

      // "Keep reading" continuation: if the owner asks to continue a big file
      // that was only partially attached, re-attach the next page range from
      // storage automatically.
      let resolvedAttachments = attachments;
      if ((!attachments || !attachments.length) && /keep reading|read the rest|continue reading|next pages|rest of the (file|pages|pdf)/i.test(String(userMessage || ''))) {
        for (const message of [...persisted].reverse()) {
          const partial = (message.metadata?.attachments || []).find(item => item.uploadId && item.lastPageRead && item.totalPages && item.lastPageRead < item.totalPages);
          if (partial) {
            resolvedAttachments = [{ name: partial.name, type: partial.type, uploadId: partial.uploadId, pageStart: partial.lastPageRead + 1 }];
            break;
          }
        }
      }

      const parsedAttachments = await parseAgentAttachments(resolvedAttachments, { commandCenter });
      for (const attachment of parsedAttachments.metadata) {
        await onEvent?.({ type: 'attachment_started', name: attachment.name, fileType: attachment.type });
      }
      if ((userMessage && userMessage.trim()) || parsedAttachments.content.length) {
        const text = userMessage.trim() || 'Please review the attached file and tell me what needs attention.';
        const content = parsedAttachments.content.length
          ? [{ type: 'input_text', text }, ...parsedAttachments.content]
          : text;
        conversationMessages.push({ role: 'user', content });
        newMessages.push({
          role: 'user',
          content: text,
          metadata: parsedAttachments.metadata.length ? { attachments: parsedAttachments.metadata } : {},
        });
      }

      const result = await agent.runTurn({
        messages: conversationMessages,
        actor: req.adminUser,
        pendingConfirmation,
        confirmations,
        onEvent,
      });

      newMessages.push(...traceToPersistedMessages(result.trace));

      await agentStore.appendMessages({ conversationId, messages: newMessages });
      await resolvedStore.recordAuditLog?.({
        action: 'agent.turn',
        actor: req.adminUser,
        targetType: 'agent_conversation',
        targetId: conversationId,
        metadata: {
          provider: aiProvider.name,
          toolCalls: result.trace.filter(t => t.type === 'tool_result').map(t => t.toolName),
        },
      });

      return {
        finishReason: result.finishReason,
        pendingConfirmation: result.pendingConfirmation,
        message: result.message,
        trace: result.trace,
      };
  };

  router.post('/admin/agent/voice/session', async (req, res) => {
    try {
      resolvedStore.requireFeature?.('ai.command_box', { role: req.adminUser.role });
      requireAdminRole(req.adminUser);
      const config = await providerConnections.getProviderConfig('openai');
      const apiKey = config?.apiKey || String(env.OPENAI_API_KEY || '').trim();
      if (!apiKey) throw badRequest('Add an OpenAI API key on the Connections page first.', 'OPENAI_NOT_CONNECTED');
      const model = String(env.OPENAI_REALTIME_MODEL || 'gpt-realtime').trim();
      const response = await fetchImpl('https://api.openai.com/v1/realtime/client_secrets', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session: {
            type: 'realtime',
            model,
            audio: { output: { voice: String(env.OPENAI_REALTIME_VOICE || 'marin').trim() } },
            instructions: [
              'You are the friendly voice of Midway Gas & Grocery’s store assistant, talking with the store owner.',
              'Speak plainly and briefly, like a helpful longtime employee. No jargon, no IDs, no technical terms.',
              'For ANY question or request about the store — sales, inventory, vendors, Harbor, orders, bookings, books — call the ask_midway tool with the request in your own words, then relay its answer conversationally.',
              'Never invent store facts yourself; ask_midway is the source of truth.',
              'If ask_midway says something needs on-screen approval, tell the owner to tap the approve button on the screen.',
            ].join(' '),
            tools: [{
              type: 'function',
              name: 'ask_midway',
              description: 'Ask the Midway store assistant anything about the store or have it do store work (sales, inventory, vendors, Harbor ordering, bookings). Returns the answer to relay aloud.',
              parameters: {
                type: 'object',
                required: ['question'],
                properties: { question: { type: 'string', description: 'The owner’s request, in plain English.' } },
              },
            }],
          },
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw Object.assign(new Error(payload?.error?.message || 'The voice session could not be started.'), { statusCode: 502, code: 'VOICE_SESSION_FAILED' });
      }
      res.json({
        ok: true,
        data: {
          clientSecret: payload.value || payload.client_secret?.value,
          expiresAt: payload.expires_at || payload.client_secret?.expires_at || null,
          model,
        },
      });
    } catch (error) {
      sendApiError(res, error, error.code || 'VOICE_SESSION_FAILED', error.statusCode || 500);
    }
  });

  router.post('/admin/agent/turn', async (req, res) => {
    try {
      const data = await runAdminAgentTurn(req);
      res.json({ ok: true, data });
    } catch (error) {
      sendApiError(res, error, error.code || 'AGENT_TURN_FAILED', error.statusCode || 500);
    }
  });

  router.post('/admin/agent/turn/stream', async (req, res) => {
    res.status(200);
    res.set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders?.();
    let open = true;
    res.on('close', () => { open = false; });
    const writeEvent = event => {
      if (!open || res.writableEnded) return;
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    writeEvent({ type: 'connected' });
    try {
      const data = await runAdminAgentTurn(req, { onEvent: writeEvent });
      writeEvent({ type: 'done', data });
    } catch (error) {
      writeEvent({
        type: 'error',
        code: error.code || 'AGENT_TURN_FAILED',
        message: error.message || 'Midway could not finish that request.',
      });
    } finally {
      if (open && !res.writableEnded) res.end();
    }
  });

  router.get('/admin/command-center/uploads', async (req, res) => {
    try {
      requireAdminRole(req.adminUser);
      const data = await commandCenter.listUploads({
        limit: Number(req.query.limit) || 50,
        conversationId: req.query.conversationId || undefined,
      });
      res.json({ ok: true, data });
    } catch (error) {
      sendApiError(res, error, 'COMMAND_CENTER_UPLOADS_UNAVAILABLE');
    }
  });

  router.post('/admin/command-center/uploads/direct', async (req, res) => {
    try {
      requireAdminRole(req.adminUser);
      const data = await commandCenter.createDirectUpload({
        fileName: req.body?.fileName,
        contentType: String(req.body?.contentType || '').toLowerCase(),
        sizeBytes: Number(req.body?.sizeBytes) || 0,
        actor: req.adminUser,
        conversationId: req.body?.conversationId || null,
        purpose: req.body?.purpose || 'assistant',
      });
      await resolvedStore.recordAuditLog?.({
        action: 'command_center.file_upload_direct',
        actor: req.adminUser,
        targetType: 'command_center_upload',
        targetId: data.id,
        metadata: { fileName: data.fileName, contentType: data.contentType, sizeBytes: data.sizeBytes },
      });
      res.status(201).json({ ok: true, data });
    } catch (error) {
      sendApiError(res, error, error.code || 'COMMAND_CENTER_UPLOAD_FAILED', error.statusCode || 400);
    }
  });

  router.post('/admin/command-center/uploads', async (req, res) => {
    try {
      requireAdminRole(req.adminUser);
      const file = parseCommandCenterUpload(req.body || {});
      const data = await commandCenter.saveUpload({
        ...file,
        actor: req.adminUser,
        conversationId: req.body?.conversationId || null,
        purpose: req.body?.purpose || 'assistant',
      });
      await resolvedStore.recordAuditLog?.({
        action: 'command_center.file_upload',
        actor: req.adminUser,
        targetType: 'command_center_upload',
        targetId: data.id,
        metadata: { fileName: data.fileName, contentType: data.contentType, sizeBytes: data.sizeBytes, purpose: data.purpose },
      });
      res.status(201).json({ ok: true, data });
    } catch (error) {
      sendApiError(res, error, error.code || 'COMMAND_CENTER_UPLOAD_FAILED', error.statusCode || 400);
    }
  });

  router.get('/admin/command-center/reconciliations', async (req, res) => {
    try {
      requireAdminRole(req.adminUser);
      res.json({ ok: true, data: await commandCenter.listReconciliations({ limit: Number(req.query.limit) || 30 }) });
    } catch (error) {
      sendApiError(res, error, 'RECONCILIATIONS_UNAVAILABLE');
    }
  });

  router.post('/admin/command-center/reconciliations', async (req, res) => {
    try {
      requireAdminRole(req.adminUser);
      const data = await commandCenter.createReconciliation({ ...req.body, actor: req.adminUser });
      await resolvedStore.recordAuditLog?.({ action: 'inventory.reconciliation_create', actor: req.adminUser, targetType: 'reconciliation_session', targetId: data.id, metadata: { lines: data.lines.length, exceptions: data.exceptionCount } });
      res.status(201).json({ ok: true, data });
    } catch (error) {
      sendApiError(res, error, error.code || 'RECONCILIATION_CREATE_FAILED', error.statusCode || 400);
    }
  });

  router.post('/admin/command-center/reconciliations/:id/apply', async (req, res) => {
    try {
      requireAdminRole(req.adminUser, ['owner']);
      const data = await commandCenter.applyReconciliation({ reconciliationId: req.params.id, actor: req.adminUser });
      await resolvedStore.recordAuditLog?.({ action: 'inventory.reconciliation_apply', actor: req.adminUser, targetType: 'reconciliation_session', targetId: data.id, metadata: { lines: data.lines.length } });
      res.json({ ok: true, data });
    } catch (error) {
      sendApiError(res, error, error.code || 'RECONCILIATION_APPLY_FAILED', error.statusCode || 409);
    }
  });

  router.get('/admin/command-center/sales', async (req, res) => {
    try {
      requireAdminRole(req.adminUser);
      res.json({ ok: true, data: await commandCenter.getSalesAnalytics({ days: Number(req.query.days) || 30 }) });
    } catch (error) {
      sendApiError(res, error, error.code || 'SALES_ANALYTICS_UNAVAILABLE', error.statusCode || 500);
    }
  });

  router.post('/admin/command-center/sales/sync', async (req, res) => {
    try {
      requireAdminRole(req.adminUser, ['owner']);
      const data = await commandCenter.syncSalesHistory({ days: Number(req.body?.days) || 365, actor: req.adminUser });
      res.json({ ok: true, data });
    } catch (error) {
      sendApiError(res, error, error.code || 'SALES_HISTORY_SYNC_FAILED', error.statusCode || 502);
    }
  });

  router.get('/admin/command-center/overview', async (req, res) => {
    try {
      requireAdminRole(req.adminUser);
      const data = await commandCenter.getOverview({ refreshSquare: req.query.refreshSquare !== 'false' });
      res.json({ ok: true, data });
    } catch (error) {
      sendApiError(res, error, error.code || 'COMMAND_CENTER_UNAVAILABLE', error.statusCode || 500);
    }
  });

  router.get('/admin/command-center/inventory', async (req, res) => {
    try {
      requireAdminRole(req.adminUser);
      const data = await commandCenter.listInventory({
        search: req.query.search,
        lowStockOnly: req.query.lowStockOnly === 'true',
        limit: Number(req.query.limit) || 250,
        live: req.query.live !== 'false',
      });
      res.json({ ok: true, data });
    } catch (error) {
      sendApiError(res, error, error.code || 'COMMAND_CENTER_INVENTORY_UNAVAILABLE', error.statusCode || 500);
    }
  });

  router.patch('/admin/command-center/inventory/:variationId/rule', async (req, res) => {
    try {
      requireAdminRole(req.adminUser, ['owner']);
      const data = await commandCenter.updateInventoryRule({
        squareVariationId: req.params.variationId,
        reorderPoint: req.body?.reorderPoint,
        targetStock: req.body?.targetStock,
      });
      res.json({ ok: true, data });
    } catch (error) {
      sendApiError(res, error, error.code || 'INVENTORY_RULE_UPDATE_FAILED', error.statusCode || 400);
    }
  });

  router.post('/admin/command-center/square/sync', async (req, res) => {
    try {
      requireAdminRole(req.adminUser, ['owner']);
      const data = await commandCenter.syncSquare({ force: true, actor: req.adminUser });
      res.json({ ok: true, data });
    } catch (error) {
      sendApiError(res, error, error.code || 'COMMAND_CENTER_SQUARE_SYNC_FAILED', error.statusCode || 502);
    }
  });

  router.get('/admin/command-center/vendors', async (req, res) => {
    try {
      requireAdminRole(req.adminUser);
      res.json({ ok: true, data: await commandCenter.listVendors() });
    } catch (error) {
      sendApiError(res, error, error.code || 'VENDORS_UNAVAILABLE', error.statusCode || 500);
    }
  });

  router.post('/admin/command-center/vendors', async (req, res) => {
    try {
      requireAdminRole(req.adminUser, ['owner']);
      const data = await commandCenter.createVendor(req.body || {});
      res.status(201).json({ ok: true, data });
    } catch (error) {
      sendApiError(res, error, error.code || 'VENDOR_CREATE_FAILED', error.statusCode || 400);
    }
  });

  router.get('/admin/command-center/connectors', async (req, res) => {
    try {
      requireAdminRole(req.adminUser, ['owner']);
      res.json({ ok: true, data: await commandCenter.listConnectors() });
    } catch (error) {
      sendApiError(res, error, error.code || 'VENDOR_CONNECTORS_UNAVAILABLE', error.statusCode || 500);
    }
  });

  router.post('/admin/command-center/connectors', async (req, res) => {
    try {
      requireAdminRole(req.adminUser, ['owner']);
      const data = await commandCenter.createConnector(req.body || {});
      res.status(201).json({ ok: true, data });
    } catch (error) {
      sendApiError(res, error, error.code || 'VENDOR_CONNECTOR_CREATE_FAILED', error.statusCode || 400);
    }
  });

  router.patch('/admin/command-center/connectors/:id', async (req, res) => {
    try {
      requireAdminRole(req.adminUser, ['owner']);
      res.json({ ok: true, data: await commandCenter.updateConnectorCredentials(req.params.id, req.body || {}) });
    } catch (error) {
      sendApiError(res, error, error.code || 'VENDOR_CONNECTOR_UPDATE_FAILED', error.statusCode || 400);
    }
  });

  router.post('/admin/command-center/connectors/:id/test', async (req, res) => {
    try {
      requireAdminRole(req.adminUser, ['owner']);
      res.json({ ok: true, data: await commandCenter.testConnector(req.params.id) });
    } catch (error) {
      sendApiError(res, error, error.code || 'VENDOR_CONNECTOR_TEST_FAILED', error.statusCode || 502);
    }
  });

  router.get('/admin/command-center/orders', async (req, res) => {
    try {
      requireAdminRole(req.adminUser);
      res.json({ ok: true, data: await commandCenter.listPurchaseOrders({ limit: Number(req.query.limit) || 50 }) });
    } catch (error) {
      sendApiError(res, error, error.code || 'PURCHASE_ORDERS_UNAVAILABLE', error.statusCode || 500);
    }
  });

  router.post('/admin/command-center/orders/draft', async (req, res) => {
    try {
      requireAdminRole(req.adminUser, ['owner']);
      const data = await commandCenter.draftReorder(req.body || {});
      res.status(201).json({ ok: true, data });
    } catch (error) {
      sendApiError(res, error, error.code || 'PURCHASE_ORDER_DRAFT_FAILED', error.statusCode || 400);
    }
  });

  router.post('/admin/providers/xero/oauth/start', async (req, res) => {
    try {
      resolvedStore.requireFeature?.('core.provider_adapters', { role: req.adminUser.role });
      requireAdminRole(req.adminUser, ['owner']);
      const config = xeroProviderConfigFromEnv(env);
      if (!config.clientId || !config.clientSecret) {
        throw badRequest('Xero app is not configured. Set XERO_CLIENT_ID and XERO_CLIENT_SECRET in env.');
      }
      const redirectUri = req.body?.redirectUri || config.redirectUri || providerRedirectUriFromRequest(req, 'xero');
      const state = crypto.randomBytes(16).toString('hex');
      const authorizationUrl = buildXeroAuthUrl({
        clientId: config.clientId,
        scopes: config.scopes,
        redirectUri,
        state,
      });
      res.json({ ok: true, data: { authorizationUrl, redirectUri, state } });
    } catch (error) {
      sendApiError(res, error, error.code || 'XERO_OAUTH_START_FAILED', error.statusCode || 400);
    }
  });

  router.post('/admin/providers/xero/oauth/callback', async (req, res) => {
    try {
      resolvedStore.requireFeature?.('core.provider_adapters', { role: req.adminUser.role });
      requireAdminRole(req.adminUser, ['owner']);
      const config = xeroProviderConfigFromEnv(env);
      const code = req.body?.code;
      const redirectUri = req.body?.redirectUri || config.redirectUri || providerRedirectUriFromRequest(req, 'xero');
      if (!code) throw badRequest('Authorization code is required.');
      const data = await xeroService.completeAuth({
        code,
        redirectUri,
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        actor: req.adminUser,
      });
      await resolvedStore.recordAuditLog?.({
        action: 'provider.xero.connect',
        actor: req.adminUser,
        targetType: 'provider_connection',
        targetId: 'xero',
        metadata: { organizationCount: data.organizations.length },
      });
      res.json({ ok: true, data });
    } catch (error) {
      sendApiError(res, error, error.code || 'XERO_OAUTH_CALLBACK_FAILED', error.statusCode || 400);
    }
  });

  router.get('/admin/providers/xero/status', async (req, res) => {
    try {
      resolvedStore.requireFeature?.('core.provider_adapters', { role: req.adminUser.role });
      const data = await xeroService.getStatus();
      res.json({ ok: true, data });
    } catch (error) {
      sendApiError(res, error, error.code || 'XERO_STATUS_FAILED', error.statusCode || 400);
    }
  });

  router.delete('/admin/providers/xero', async (req, res) => {
    try {
      resolvedStore.requireFeature?.('core.provider_adapters', { role: req.adminUser.role });
      requireAdminRole(req.adminUser, ['owner']);
      await resolvedStore.upsertProviderConnection?.({
        tenantId: resolvedStore.tenantId,
        locationId: resolvedStore.locationId,
        providerKey: 'xero',
        status: 'not_connected',
        accessToken: null,
        refreshToken: null,
        externalAccountId: null,
        publicConfig: {},
        updatedBy: req.adminUser?.email || 'admin',
      });
      await resolvedStore.recordAuditLog?.({
        action: 'provider.xero.disconnect',
        actor: req.adminUser,
        targetType: 'provider_connection',
        targetId: 'xero',
      });
      res.json({ ok: true, data: {} });
    } catch (error) {
      sendApiError(res, error, error.code || 'XERO_DISCONNECT_FAILED', error.statusCode || 400);
    }
  });

  router.post('/admin/providers/quickbooks/oauth/start', async (req, res) => {
    try {
      resolvedStore.requireFeature?.('core.provider_adapters', { role: req.adminUser.role });
      requireAdminRole(req.adminUser, ['owner']);
      const config = quickbooksProviderConfigFromEnv(env);
      if (!config.clientId || !config.clientSecret) {
        throw badRequest('QuickBooks app is not configured. Set QUICKBOOKS_CLIENT_ID and QUICKBOOKS_CLIENT_SECRET in env.');
      }
      const redirectUri = req.body?.redirectUri || config.redirectUri || providerRedirectUriFromRequest(req, 'quickbooks');
      const state = crypto.randomBytes(16).toString('hex');
      const authorizationUrl = buildQuickBooksAuthUrl({
        clientId: config.clientId,
        scopes: config.scopes,
        redirectUri,
        state,
      });
      res.json({ ok: true, data: { authorizationUrl, redirectUri, state } });
    } catch (error) {
      sendApiError(res, error, error.code || 'QUICKBOOKS_OAUTH_START_FAILED', error.statusCode || 400);
    }
  });

  router.post('/admin/providers/quickbooks/oauth/callback', async (req, res) => {
    try {
      resolvedStore.requireFeature?.('core.provider_adapters', { role: req.adminUser.role });
      requireAdminRole(req.adminUser, ['owner']);
      const config = quickbooksProviderConfigFromEnv(env);
      const code = req.body?.code;
      const realmId = req.body?.realmId;
      const redirectUri = req.body?.redirectUri || config.redirectUri || providerRedirectUriFromRequest(req, 'quickbooks');
      if (!code) throw badRequest('Authorization code is required.');
      if (!realmId) throw badRequest('QuickBooks company id (realmId) is required.');
      const data = await quickbooksService.completeAuth({
        code,
        realmId,
        redirectUri,
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        actor: req.adminUser,
      });
      await resolvedStore.recordAuditLog?.({
        action: 'provider.quickbooks.connect',
        actor: req.adminUser,
        targetType: 'provider_connection',
        targetId: 'quickbooks',
        metadata: { realmId, companyName: data.companyName },
      });
      res.json({ ok: true, data });
    } catch (error) {
      sendApiError(res, error, error.code || 'QUICKBOOKS_OAUTH_CALLBACK_FAILED', error.statusCode || 400);
    }
  });

  router.get('/admin/providers/quickbooks/status', async (req, res) => {
    try {
      resolvedStore.requireFeature?.('core.provider_adapters', { role: req.adminUser.role });
      const data = await quickbooksService.getStatus();
      res.json({ ok: true, data });
    } catch (error) {
      sendApiError(res, error, error.code || 'QUICKBOOKS_STATUS_FAILED', error.statusCode || 400);
    }
  });

  router.delete('/admin/providers/quickbooks', async (req, res) => {
    try {
      resolvedStore.requireFeature?.('core.provider_adapters', { role: req.adminUser.role });
      requireAdminRole(req.adminUser, ['owner']);
      await resolvedStore.upsertProviderConnection?.({
        tenantId: resolvedStore.tenantId,
        locationId: resolvedStore.locationId,
        providerKey: 'quickbooks',
        status: 'not_connected',
        accessToken: null,
        refreshToken: null,
        externalAccountId: null,
        publicConfig: {},
        updatedBy: req.adminUser?.email || 'admin',
      });
      await resolvedStore.recordAuditLog?.({
        action: 'provider.quickbooks.disconnect',
        actor: req.adminUser,
        targetType: 'provider_connection',
        targetId: 'quickbooks',
      });
      res.json({ ok: true, data: {} });
    } catch (error) {
      sendApiError(res, error, error.code || 'QUICKBOOKS_DISCONNECT_FAILED', error.statusCode || 400);
    }
  });

  router.post('/admin/providers/slack/oauth/start', async (req, res) => {
    try {
      resolvedStore.requireFeature?.('core.provider_adapters', { role: req.adminUser.role });
      requireAdminRole(req.adminUser, ['owner']);
      const config = slackProviderConfigFromEnv(env);
      if (!config.clientId || !config.clientSecret || !config.signingSecret) {
        throw badRequest('Slack app is not configured. Set SLACK_CLIENT_ID, SLACK_CLIENT_SECRET, and SLACK_SIGNING_SECRET in env.');
      }
      const redirectUri = req.body?.redirectUri || config.redirectUri || providerRedirectUriFromRequest(req, 'slack');
      const state = crypto.randomBytes(16).toString('hex');
      const installUrl = buildSlackInstallUrl({
        clientId: config.clientId,
        scopes: config.botScopes,
        redirectUri,
        state,
      });
      res.json({ ok: true, data: { installUrl, redirectUri, state } });
    } catch (error) {
      sendApiError(res, error, error.code || 'SLACK_OAUTH_START_FAILED', error.statusCode || 400);
    }
  });

  router.post('/admin/providers/slack/oauth/callback', async (req, res) => {
    try {
      resolvedStore.requireFeature?.('core.provider_adapters', { role: req.adminUser.role });
      requireAdminRole(req.adminUser, ['owner']);
      const config = slackProviderConfigFromEnv(env);
      const code = req.body?.code;
      const redirectUri = req.body?.redirectUri || config.redirectUri || providerRedirectUriFromRequest(req, 'slack');
      if (!code) throw badRequest('Authorization code is required.');
      const exchange = await exchangeSlackOAuthCode({
        code,
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        redirectUri,
        fetchImpl,
      });
      const connection = await resolvedStore.upsertProviderConnection?.({
        tenantId: resolvedStore.tenantId,
        locationId: resolvedStore.locationId,
        providerKey: 'slack',
        status: 'connected',
        accessToken: exchange.accessToken,
        externalAccountId: exchange.teamId,
        publicConfig: {
          teamId: exchange.teamId,
          teamName: exchange.teamName,
          botUserId: exchange.botUserId,
          appId: exchange.appId,
          scope: exchange.scope,
          authedUserId: exchange.authedUserId,
        },
        updatedBy: req.adminUser?.email || 'admin',
      });
      await resolvedStore.recordAuditLog?.({
        action: 'provider.slack.connect',
        actor: req.adminUser,
        targetType: 'provider_connection',
        targetId: 'slack',
        metadata: { teamName: exchange.teamName, teamId: exchange.teamId },
      });
      res.json({ ok: true, data: { connection } });
    } catch (error) {
      sendApiError(res, error, error.code || 'SLACK_OAUTH_CALLBACK_FAILED', error.statusCode || 400);
    }
  });

  router.delete('/admin/providers/slack', async (req, res) => {
    try {
      resolvedStore.requireFeature?.('core.provider_adapters', { role: req.adminUser.role });
      requireAdminRole(req.adminUser, ['owner']);
      await resolvedStore.upsertProviderConnection?.({
        tenantId: resolvedStore.tenantId,
        locationId: resolvedStore.locationId,
        providerKey: 'slack',
        status: 'not_connected',
        accessToken: null,
        externalAccountId: null,
        publicConfig: {},
        updatedBy: req.adminUser?.email || 'admin',
      });
      await resolvedStore.recordAuditLog?.({
        action: 'provider.slack.disconnect',
        actor: req.adminUser,
        targetType: 'provider_connection',
        targetId: 'slack',
      });
      res.json({ ok: true, data: {} });
    } catch (error) {
      sendApiError(res, error, error.code || 'SLACK_DISCONNECT_FAILED', error.statusCode || 400);
    }
  });

  router.post('/webhooks/slack/events', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
    try {
      const rawBody = req.body instanceof Buffer ? req.body.toString('utf8') : (typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {}));
      const config = slackProviderConfigFromEnv(env);
      const signature = req.get('x-slack-signature');
      const timestamp = req.get('x-slack-request-timestamp');
      if (!verifySlackSignature({ signingSecret: config.signingSecret, body: rawBody, signature, timestamp })) {
        return res.status(401).json(apiError('SLACK_SIGNATURE_INVALID', 'Invalid Slack signature.'));
      }
      const payload = JSON.parse(rawBody);
      if (payload.type === 'url_verification') {
        return res.json({ challenge: payload.challenge });
      }
      res.status(200).end();
      handleSlackEvent(payload).catch(error => {
        console.warn('[Slack] event handler failed:', error.message);
      });
    } catch (error) {
      sendApiError(res, error, error.code || 'SLACK_EVENT_FAILED', error.statusCode || 400);
    }
  });

  async function handleSlackEvent(payload) {
    if (payload.type !== 'event_callback') return;
    const event = payload.event ?? {};
    if (event.bot_id || event.subtype === 'bot_message') return;
    const isDirectMessage = event.type === 'message' && event.channel_type === 'im';
    const isMention = event.type === 'app_mention';
    if (!isDirectMessage && !isMention) return;

    const text = String(event.text || '').replace(/<@[A-Z0-9]+>/g, '').trim();
    if (!text) return;

    const connection = await resolvedStore.getProviderConnection?.({
      tenantId: resolvedStore.tenantId,
      locationId: resolvedStore.locationId,
      providerKey: 'slack',
    });
    if (!connection?.accessToken) {
      console.warn('[Slack] event received but no bot token stored.');
      return;
    }

    const threadKey = `${event.team || payload.team_id || ''}:${event.channel}:${event.thread_ts || event.ts}`;
    let conversation = await agentStore.findExternal({ channel: 'slack', externalThreadId: threadKey, tenantId: resolvedStore.tenantId });
    if (!conversation) {
      conversation = await agentStore.create({
        tenantId: resolvedStore.tenantId,
        locationId: resolvedStore.locationId,
        channel: 'slack',
        externalThreadId: threadKey,
        title: text.slice(0, 60),
        createdByEmail: null,
        createdByActorType: 'slack',
      });
    }

    const persisted = await agentStore.listMessages({ conversationId: conversation.id });
    const conversationMessages = persisted.map(toAgentMessage);
    conversationMessages.push({ role: 'user', content: text });

    const slackActor = {
      id: `slack:${event.user || 'unknown'}`,
      actorType: 'slack',
      role: 'owner',
      scope: 'owner',
      name: `Slack user ${event.user || ''}`.trim(),
    };

    const result = await agent.runTurn({
      messages: conversationMessages,
      actor: slackActor,
    });

    const reply = result.pendingConfirmation
      ? `I want to run \`${result.pendingConfirmation.toolName}\` with ${JSON.stringify(result.pendingConfirmation.arguments)}. Reply "yes" to approve or "no" to cancel.`
      : (result.message?.content || '(no reply)');

    await postSlackMessage({
      token: connection.accessToken,
      channel: event.channel,
      text: reply,
      threadTs: event.thread_ts || event.ts,
      fetchImpl,
    });

    await agentStore.appendMessages({
      conversationId: conversation.id,
      messages: [
        { role: 'user', content: text, metadata: { slackUserId: event.user, slackTs: event.ts } },
        ...traceToPersistedMessages(result.trace),
      ],
    });
  }

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

  router.get('/admin/providers/openai', async (req, res) => {
    try {
      resolvedStore.requireFeature?.('core.provider_adapters', { role: req.adminUser.role });
      requireAdminRole(req.adminUser);
      res.json({ ok: true, data: await providerConnections.getOpenAiStatus() });
    } catch (error) {
      sendApiError(res, error, error.code || 'OPENAI_STATUS_UNAVAILABLE', error.statusCode || 500);
    }
  });

  router.put('/admin/providers/openai', async (req, res) => {
    try {
      resolvedStore.requireFeature?.('core.provider_adapters', { role: req.adminUser.role });
      requireAdminRole(req.adminUser, ['owner']);
      const data = await providerConnections.upsertOpenAiConnection({
        apiKey: req.body?.apiKey,
        model: req.body?.model,
        reasoningEffort: req.body?.reasoningEffort,
        actor: req.adminUser,
      });
      await resolvedStore.recordAuditLog?.({
        action: 'provider.openai.update',
        actor: req.adminUser,
        targetType: 'provider_connection',
        targetId: 'openai',
        metadata: {
          keyReplaced: Boolean(req.body?.apiKey),
          model: data.publicConfig?.model,
          reasoningEffort: data.publicConfig?.reasoningEffort,
        },
      });
      res.json({ ok: true, data });
    } catch (error) {
      sendApiError(res, error, error.code || 'OPENAI_UPDATE_FAILED', error.statusCode || 400);
    }
  });

  router.post('/admin/providers/openai/test', async (req, res) => {
    try {
      resolvedStore.requireFeature?.('core.provider_adapters', { role: req.adminUser.role });
      requireAdminRole(req.adminUser, ['owner']);
      const data = await providerConnections.testOpenAiConnection();
      await resolvedStore.recordAuditLog?.({
        action: 'provider.openai.test',
        actor: req.adminUser,
        targetType: 'provider_connection',
        targetId: 'openai',
        metadata: { model: data.model, connected: data.connected },
      });
      res.json({ ok: true, data });
    } catch (error) {
      sendApiError(res, error, error.code || 'OPENAI_TEST_FAILED', error.statusCode || 400);
    }
  });

  router.delete('/admin/providers/openai', async (req, res) => {
    try {
      resolvedStore.requireFeature?.('core.provider_adapters', { role: req.adminUser.role });
      requireAdminRole(req.adminUser, ['owner']);
      const data = await providerConnections.removeOpenAiConnection({ actor: req.adminUser });
      await resolvedStore.recordAuditLog?.({
        action: 'provider.openai.remove',
        actor: req.adminUser,
        targetType: 'provider_connection',
        targetId: 'openai',
        metadata: {},
      });
      res.json({ ok: true, data });
    } catch (error) {
      sendApiError(res, error, error.code || 'OPENAI_REMOVE_FAILED', error.statusCode || 400);
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

  router.get('/admin/bookings/lookup', async (req, res) => {
    try {
      resolvedStore.requireFeature?.('booking.rv.enabled', { role: req.adminUser.role });
      requireAdminRole(req.adminUser);
      const q = String(req.query.q || '').trim();
      if (!q) return res.json({ ok: true, data: [] });
      const data = await resolvedStore.lookupBookings({ query: q });
      res.json({ ok: true, data });
    } catch (error) {
      sendApiError(res, error, 'ADMIN_BOOKING_LOOKUP_FAILED');
    }
  });

  router.patch('/admin/bookings/:bookingCode', async (req, res) => {
    try {
      resolvedStore.requireFeature?.('booking.rv.enabled', { role: req.adminUser.role });
      requireAdminRole(req.adminUser, ['owner']);

      const booking = await resolvedStore.getBooking(req.params.bookingCode);
      if (!booking) return res.status(404).json(apiError('BOOKING_NOT_FOUND', 'Booking was not found.'));
      if (!['confirmed', 'paid'].includes(booking.status)) {
        return res.status(409).json(apiError('BOOKING_NOT_EDITABLE', 'Only confirmed bookings can be edited.'));
      }

      const { sourceId, verificationToken, idempotencyKey, ...patch } = req.body ?? {};
      const adminEditPatch = pickEditPatch(patch);
      const preview = await resolvedStore.previewBookingEdit?.({ bookingCode: booking.bookingCode, patch: adminEditPatch });
      if (!preview) return res.status(404).json(apiError('BOOKING_NOT_FOUND', 'Booking was not found.'));

      const { diffCents, prevTotalCents, newTotalCents } = preview;

      if (diffCents > 0) {
        if (!sourceId) {
          const squareConfig = await squareProviderConfig();
          let checkoutConfig = null;
          try {
            checkoutConfig = createEditPaymentSession({ bookingCode: booking.bookingCode, diffCents, env: squareConfig });
          } catch {
            // Square not configured
          }
          return res.status(402).json({ ok: false, data: { diffCents, prevTotalCents, newTotalCents, checkoutConfig } });
        }
        const squareConfig = await squareProviderConfig();
        const payment = await createSquareSupplementPayment({
          booking,
          diffCents,
          sourceId,
          verificationToken,
          idempotencyKey,
          env: squareConfig,
          fetchImpl,
        });
        if (!isPaymentComplete(payment.status)) {
          return res.status(402).json(apiError('PAYMENT_NOT_COMPLETED', `Square payment status is ${payment.status || 'unknown'}.`));
        }
        const applied = await resolvedStore.updateBookingDetails({ bookingCode: booking.bookingCode, patch: adminEditPatch });
        if (!applied) return res.status(404).json(apiError('BOOKING_NOT_FOUND', 'Booking was not found.'));
        const updated = applied.booking;
        await resolvedStore.recordAuditLog?.({
          action: 'booking.edit_supplement_charged',
          actor: req.adminUser,
          targetType: 'rv_booking',
          targetId: updated.bookingCode,
          metadata: { diffCents, paymentId: payment.paymentId, prevTotalCents, newTotalCents },
        });
        await resolvedStore.recordAuditLog?.({
          action: 'booking.admin_edit',
          actor: req.adminUser,
          targetType: 'rv_booking',
          targetId: updated.bookingCode,
          metadata: { prevTotalCents, newTotalCents, diffCents, patch: adminEditPatch },
        });
        return res.json({ ok: true, data: { booking: updated, diffCents, prevTotalCents, newTotalCents } });
      }

      // No payment needed — apply edit directly
      const applied = await resolvedStore.updateBookingDetails({ bookingCode: booking.bookingCode, patch: adminEditPatch });
      if (!applied) return res.status(404).json(apiError('BOOKING_NOT_FOUND', 'Booking was not found.'));
      if (diffCents < 0 && booking.squarePaymentId) {
        const squareConfig = await squareProviderConfig();
        const refund = await createSquareRefund({
          booking,
          amountCents: Math.abs(diffCents),
          reason: 'Booking edited — price reduced',
          env: squareConfig,
          fetchImpl,
        });
        await resolvedStore.recordAuditLog?.({
          action: 'booking.edit_refund_issued',
          actor: req.adminUser,
          targetType: 'rv_booking',
          targetId: applied.booking.bookingCode,
          metadata: { diffCents, refundId: refund.refundId, prevTotalCents, newTotalCents },
        });
      }
      await resolvedStore.recordAuditLog?.({
        action: 'booking.admin_edit',
        actor: req.adminUser,
        targetType: 'rv_booking',
        targetId: applied.booking.bookingCode,
        metadata: { prevTotalCents, newTotalCents, diffCents, patch: adminEditPatch },
      });
      res.json({ ok: true, data: { booking: applied.booking, diffCents, prevTotalCents, newTotalCents } });
    } catch (error) {
      sendApiError(res, error, 'ADMIN_BOOKING_EDIT_FAILED', 409);
    }
  });

  router.get('/admin/bookings/:bookingCode/documents', async (req, res) => {
    try {
      requireAdminRole(req.adminUser);
      const docs = await resolvedStore.listBookingDocuments({ bookingCode: req.params.bookingCode });
      res.json({ ok: true, data: docs });
    } catch (error) {
      sendApiError(res, error, 'ADMIN_DOCUMENTS_UNAVAILABLE');
    }
  });

  router.patch('/admin/bookings/:bookingCode/documents/:documentId', async (req, res) => {
    try {
      requireAdminRole(req.adminUser);
      const { status } = req.body ?? {};
      if (!['verified', 'rejected'].includes(status)) {
        return res.status(400).json(apiError('INVALID_STATUS', 'Status must be "verified" or "rejected".'));
      }
      const doc = await resolvedStore.updateDocumentStatus({
        bookingCode: req.params.bookingCode,
        documentId: req.params.documentId,
        status,
      });
      if (!doc) return res.status(404).json(apiError('DOCUMENT_NOT_FOUND', 'Document not found.'));
      await resolvedStore.recordAuditLog?.({
        action: `document.${status}`,
        actor: { id: req.adminUser.id, role: req.adminUser.role },
        targetType: 'booking_document',
        targetId: req.params.bookingCode,
        metadata: { documentId: req.params.documentId, status },
      });
      res.json({ ok: true, data: doc });
    } catch (error) {
      sendApiError(res, error, 'ADMIN_DOCUMENT_UPDATE_FAILED');
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

function squareRuntimeConfigFromEnv(env = {}) {
  return Object.fromEntries(Object.entries({
    accessToken: liveCredentialValue(env.SQUARE_ACCESS_TOKEN),
    applicationId: liveCredentialValue(env.SQUARE_APPLICATION_ID || env.VITE_SQUARE_APPLICATION_ID),
    locationId: liveCredentialValue(env.SQUARE_LOCATION_ID || env.VITE_SQUARE_LOCATION_ID),
    environment: liveCredentialValue(env.SQUARE_ENVIRONMENT || env.VITE_SQUARE_ENVIRONMENT),
    webhookSignatureKey: liveCredentialValue(env.SQUARE_WEBHOOK_SIGNATURE_KEY),
    apiVersion: liveCredentialValue(env.SQUARE_API_VERSION),
    checkoutSurface: liveCredentialValue(env.SQUARE_CHECKOUT_SURFACE),
    timezone: liveCredentialValue(env.MIDWAY_TIMEZONE) || 'America/Los_Angeles',
  }).filter(([, value]) => value !== undefined));
}

function liveCredentialValue(value) {
  const normalized = String(value || '').trim();
  if (!normalized || /your_|placeholder|replace[_-]?me|example(?:\.com)?/i.test(normalized)) return undefined;
  return normalized;
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

function parseCommandCenterUpload(body = {}) {
  const fileName = String(body.name || body.fileName || 'upload').trim().slice(0, 180);
  const contentType = String(body.type || body.contentType || '').trim().toLowerCase();
  const allowedTypes = commandCenterContentTypes();
  if (!allowedTypes.has(contentType)) throw badRequest(`${fileName} is not a supported file type.`, 'COMMAND_CENTER_UPLOAD_TYPE');
  const dataUrl = String(body.dataUrl || '');
  const match = dataUrl.match(/^data:([^;,]+);base64,([a-z0-9+/=]+)$/i);
  if (!match || match[1].toLowerCase() !== contentType) throw badRequest(`${fileName} could not be read.`, 'COMMAND_CENTER_UPLOAD_DATA');
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length || buffer.length > 20 * 1024 * 1024) throw badRequest('Files must be under 20 MB.', 'COMMAND_CENTER_UPLOAD_SIZE');
  return { fileName, contentType, buffer, sizeBytes: buffer.length };
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

function providerRedirectUriFromRequest(req, providerKey) {
  const baseUrl = requestPublicUrl(req).replace(/\/$/, '');
  return `${baseUrl}/admin.html?provider=${encodeURIComponent(providerKey)}`;
}

function badRequest(message, code = 'BAD_REQUEST') {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = code;
  return error;
}

function bookingActionError(code, message, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function formatMoneyForError(cents) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(cents || 0) / 100);
}

function traceToPersistedMessages(trace = []) {
  const messages = [];
  for (const entry of trace) {
    if (entry.type === 'assistant') {
      messages.push({
        role: 'assistant',
        content: entry.content || '',
        toolCalls: entry.toolCalls?.length ? entry.toolCalls : null,
      });
    } else if (entry.type === 'tool_result' || entry.type === 'tool_denied' || entry.type === 'tool_error') {
      messages.push({
        role: 'tool',
        toolCallId: entry.toolCallId,
        toolName: entry.toolName,
        content: JSON.stringify({ ok: entry.ok ?? false, error: entry.error ?? null }),
      });
    }
  }
  return messages;
}

function toAgentMessage(persisted) {
  const message = {
    role: persisted.role,
    content: persisted.content ?? '',
  };
  if (persisted.toolCalls) message.toolCalls = persisted.toolCalls;
  if (persisted.toolCallId) message.toolCallId = persisted.toolCallId;
  if (persisted.toolName) message.toolName = persisted.toolName;
  return message;
}

async function parseAgentAttachments(attachments = [], { commandCenter } = {}) {
  if (!Array.isArray(attachments)) throw badRequest('attachments must be an array.', 'AGENT_ATTACHMENTS_INVALID');
  if (attachments.length > 3) throw badRequest('Attach up to three files at a time.', 'AGENT_ATTACHMENTS_LIMIT');
  const allowedTypes = commandCenterContentTypes();
  let totalBytes = 0;
  const content = [];
  const metadata = [];
  for (const attachment of attachments) {
    const fileName = String(attachment?.name || 'attachment').slice(0, 180);
    const contentType = String(attachment?.type || '').toLowerCase();
    if (!allowedTypes.has(contentType)) throw badRequest(`${fileName} is not a supported file type.`, 'AGENT_ATTACHMENT_TYPE');
    let dataUrl = String(attachment?.dataUrl || '');
    let pageInfo = {};
    if (!dataUrl && attachment?.uploadId && commandCenter?.readUploadContent) {
      // Large files skip the request body: the browser puts them straight in
      // storage and we pull the bytes back here.
      const stored = await commandCenter.readUploadContent(attachment.uploadId, { pageStart: attachment?.pageStart || null });
      dataUrl = stored.dataUrl;
      if (stored.note) content.push({ type: 'input_text', text: stored.note });
      if (stored.lastPage) pageInfo = { lastPageRead: stored.lastPage, totalPages: stored.totalPages };
    }
    const match = dataUrl.match(/^data:([^;,]+);base64,([a-z0-9+/=]+)$/i);
    if (!match || match[1].toLowerCase() !== contentType) throw badRequest(`${fileName} could not be read.`, 'AGENT_ATTACHMENT_DATA');
    const sizeBytes = Math.floor(match[2].length * 0.75);
    totalBytes += sizeBytes;
    if (sizeBytes > 28 * 1024 * 1024 || totalBytes > 32 * 1024 * 1024) {
      throw badRequest('Attachments must be under 28 MB each and 32 MB total.', 'AGENT_ATTACHMENT_SIZE');
    }
    metadata.push({ name: fileName, type: contentType, sizeBytes, uploadId: attachment?.uploadId || null, ...pageInfo });
    if (contentType.startsWith('image/')) {
      content.push({ type: 'input_image', image_url: dataUrl, detail: 'high' });
    } else {
      content.push({ type: 'input_file', filename: fileName, file_data: dataUrl, detail: contentType === 'application/pdf' ? 'high' : undefined });
    }
  }
  return { content, metadata };
}

function commandCenterContentTypes() {
  return new Set([
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'application/pdf', 'text/plain', 'text/csv', 'text/tab-separated-values',
    'application/json', 'text/markdown',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ]);
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

function pickEditPatch(body = {}) {
  const result = {};
  if (body.startDate) result.startDate = body.startDate;
  if (body.endDate) result.endDate = body.endDate;
  if (body.siteIds) result.siteIds = body.siteIds;
  if (body.guests != null) result.guests = Number(body.guests);
  if (body.vehicles != null) result.vehicles = Number(body.vehicles);
  return result;
}

function verifyPublicBookingAuth(booking, { phone, email } = {}) {
  if (!phone || !email) return false;
  const normalizePhone = p => (p || '').replace(/\D/g, '');
  const phoneMatch = normalizePhone(booking.customerPhone) === normalizePhone(phone);
  const emailMatch = (booking.customerEmail || '').toLowerCase() === email.toLowerCase();
  return phoneMatch && emailMatch;
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
