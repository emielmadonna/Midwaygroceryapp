import crypto from 'node:crypto';

import {
  batchCreateSquarePhysicalCounts,
  batchRetrieveSquareInventoryCounts,
  listSquareCatalogItems,
  listSquarePayments,
  normalizeSquareCatalogItemsForInventory,
  searchSquareOrders,
} from './square-api.js';
import { createVendorMcpClient } from './vendor-mcp.js';
import { isBookingCatalogProduct } from './public-bootstrap.js';
import { buildSalesAnalytics, normalizeSquareOrders } from './sales-analytics.js';

const HARBOR_VENDOR = Object.freeze({
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Harbor Wholesale',
  slug: 'harbor-wholesale',
  status: 'active',
  orderingMethod: 'portal',
  notes: 'Primary wholesale vendor. MCP/API connection can be added when credentials are available.',
});

export function createCommandCenterService({
  store,
  supabase = null,
  providerConnections = null,
  squareConfig = async () => ({}),
  fetchImpl = globalThis.fetch,
  env = process.env,
  now = () => new Date(),
} = {}) {
  if (!store) throw new Error('Command center requires the Midway store service.');

  const memory = {
    vendors: [clone(HARBOR_VENDOR)],
    connectors: [],
    balances: new Map(),
    vendorProducts: [],
    purchaseOrders: [],
    uploads: [],
    reconciliations: [],
    salesOrders: new Map(),
    salesLines: new Map(),
    salesSyncRuns: [],
    inventorySnapshots: new Map(),
  };
  let squareInventoryRefresh = null;
  let squareInventoryRefreshedAt = 0;
  let lastSquareInventorySync = null;

  async function listInventory({ search = '', lowStockOnly = false, limit = 250, live = false } = {}) {
    if (live) await syncSquare({ force: false });
    const [catalog, balances, vendorProducts, vendors] = await Promise.all([
      store.listStoreInventory?.({ activeOnly: false }) ?? [],
      listBalances(),
      listVendorProducts(),
      listVendors(),
    ]);
    const balanceByVariation = new Map(balances.map(row => [row.squareVariationId, row]));
    const mappingByVariation = new Map(vendorProducts.map(row => [row.squareVariationId, row]));
    const vendorById = new Map(vendors.map(vendor => [vendor.id, vendor]));
    const needle = String(search || '').trim().toLowerCase();

    return catalog
      .filter(item => !isBookingCatalogProduct(item))
      .map(item => {
        const balance = balanceByVariation.get(item.squareVariationId) ?? {};
        const mapping = mappingByVariation.get(item.squareVariationId) ?? {};
        const quantity = finiteOrNull(balance.quantity);
        const reorderPoint = finiteOrNull(balance.reorderPoint);
        const targetStock = finiteOrNull(balance.targetStock);
        // Until the owner sets a reorder point, flag anything at 3 or fewer
        // on hand so "running low" is useful out of the box.
        const isLowStock = quantity !== null && (reorderPoint !== null ? quantity <= reorderPoint : quantity <= DEFAULT_LOW_STOCK_THRESHOLD);
        return {
          ...item,
          name: cleanItemName(item.name),
          quantity,
          reorderPoint,
          targetStock,
          isLowStock,
          lastCountedAt: balance.lastCountedAt ?? null,
          vendorId: mapping.vendorId ?? null,
          vendorName: vendorById.get(mapping.vendorId)?.name ?? null,
          vendorSku: mapping.vendorSku ?? null,
          casePack: finiteOrNull(mapping.casePack),
          unitCostCents: finiteOrNull(mapping.unitCostCents),
        };
      })
      .filter(item => !needle || [item.name, item.sku, item.vendorSku, item.category].some(value => String(value || '').toLowerCase().includes(needle)))
      .filter(item => !lowStockOnly || item.isLowStock)
      .sort((a, b) => Number(b.isLowStock) - Number(a.isLowStock) || String(a.name).localeCompare(String(b.name)))
      .slice(0, Math.max(1, Math.min(1000, Number(limit) || 250)));
  }

  async function getOverview({ refreshSquare = true } = {}) {
    const squarePromise = refreshSquare ? getSquareSnapshot() : Promise.resolve(null);
    const inventoryPromise = getOverviewInventory({ refreshSquare });
    const [dashboard, inventoryResult, vendors, connectors, purchaseOrders, fuelInventory, fuelPrices, providers, square] = await Promise.all([
      store.adminDashboard?.({}) ?? {},
      inventoryPromise,
      listVendors(),
      listConnectors(),
      listPurchaseOrders({ limit: 20 }),
      store.listFuelInventory?.().catch?.(() => []) ?? [],
      store.listFuelPrices?.().catch?.(() => []) ?? [],
      providerConnections?.listStatuses?.().catch?.(() => []) ?? [],
      squarePromise,
    ]);
    const inventory = inventoryResult.rows;

    const lowStock = inventory.filter(item => item.isLowStock);
    const draftOrders = purchaseOrders.filter(order => ['draft', 'ready_for_review'].includes(order.status));
    const squareProvider = providers.find(provider => provider.providerKey === 'square');
    const openAiProvider = providers.find(provider => provider.providerKey === 'openai');
    const alerts = buildPriorities({ dashboard, lowStock, connectors, draftOrders, squareProvider, square });
    return {
      generatedAt: now().toISOString(),
      dataSources: {
        persistence: { status: supabase ? 'live' : 'memory', persistent: Boolean(supabase) },
        squareSales: {
          status: square?.status ?? 'not_connected',
          live: square?.connected === true,
          checkedAt: square?.checkedAt ?? now().toISOString(),
          errorMessage: square?.errorMessage ?? null,
        },
        squareInventory: {
          status: inventoryResult.status,
          live: inventoryResult.status === 'live',
          syncedAt: lastSquareInventorySync?.syncedAt ?? null,
          errorMessage: inventoryResult.errorMessage ?? null,
        },
        openai: {
          status: openAiProvider?.status ?? 'not_connected',
          live: openAiProvider?.status === 'connected',
          errorMessage: openAiProvider?.errorMessage ?? null,
        },
      },
      metrics: {
        salesTodayCents: square?.salesTodayCents ?? null,
        transactionsToday: square?.transactionCount ?? null,
        inventoryItems: inventory.length,
        countedInventoryItems: inventory.filter(item => item.quantity !== null).length,
        healthyInventoryItems: inventory.filter(item => item.quantity !== null && !item.isLowStock).length,
        lowStockItems: lowStock.length,
        vendors: vendors.filter(vendor => vendor.status === 'active').length,
        openOrders: purchaseOrders.filter(order => !['received', 'canceled'].includes(order.status)).length,
      },
      square: square ?? {
        connected: squareProvider?.status === 'connected',
        status: squareProvider?.status ?? 'not_connected',
        errorMessage: squareProvider?.errorMessage ?? null,
      },
      dashboard,
      priorities: alerts,
      inventory: inventory.slice(0, 12),
      allInventory: inventory,
      lowStock: lowStock.slice(0, 12),
      vendors,
      connectors,
      purchaseOrders,
      fuel: { inventory: fuelInventory, prices: fuelPrices },
    };
  }

  async function syncSquare({ force = true, actor = null } = {}) {
    const maxAgeMs = Math.max(5_000, Number(env.SQUARE_LIVE_CACHE_MS) || 30_000);
    if (!force && lastSquareInventorySync && Date.now() - squareInventoryRefreshedAt < maxAgeMs) {
      return clone(lastSquareInventorySync);
    }
    if (squareInventoryRefresh) return squareInventoryRefresh;
    squareInventoryRefresh = (async () => {
      const config = await squareConfig();
      const locationId = config.locationId || config.externalLocationId;
      if (!config.accessToken || !locationId || !['sandbox', 'production'].includes(config.environment)) {
        throw serviceError('SQUARE_INVENTORY_NOT_CONNECTED', 'Connect a valid Square account, location, and environment before loading live inventory.', 409);
      }
      const objects = await listSquareCatalogItems({ env: config, fetchImpl });
      const normalized = normalizeSquareCatalogItemsForInventory(objects);
      const catalog = await store.upsertStoreInventory?.(normalized) ?? normalized;
      const counts = await batchRetrieveSquareInventoryCounts({
        catalogObjectIds: catalog.map(item => item.squareVariationId),
        locationIds: [locationId],
        env: config,
        fetchImpl,
      });
      await upsertBalances(counts.map(count => ({
        squareVariationId: count.catalogObjectId,
        locationId: count.locationId,
        quantity: count.quantity,
        lastCountedAt: count.calculatedAt,
        source: 'square',
      })));
      await persistInventorySnapshots(counts, { source: 'square_sync' });
      const result = {
        syncedAt: now().toISOString(),
        catalogItems: catalog.length,
        inventoryCounts: counts.length,
      };
      lastSquareInventorySync = result;
      squareInventoryRefreshedAt = Date.now();
      await store.recordAuditLog?.({
        action: 'command_center.square_sync',
        actor: actor || { id: 'command-center', role: 'system' },
        targetType: 'store_inventory',
        targetId: 'square',
        metadata: { catalogItems: catalog.length, inventoryCounts: counts.length },
      });
      return clone(result);
    })();
    try {
      return await squareInventoryRefresh;
    } finally {
      squareInventoryRefresh = null;
    }
  }

  async function getOverviewInventory({ refreshSquare }) {
    if (!refreshSquare) return { rows: await listInventory({ limit: 1000 }), status: 'stored', errorMessage: null };
    try {
      return { rows: await listInventory({ limit: 1000, live: true }), status: 'live', errorMessage: null };
    } catch (error) {
      return {
        rows: await listInventory({ limit: 1000 }),
        status: 'degraded',
        errorMessage: error.message,
      };
    }
  }

  async function getSquareSnapshot() {
    try {
      const config = await squareConfig();
      const locationId = config.locationId || config.externalLocationId;
      if (!config?.accessToken || !locationId || !['sandbox', 'production'].includes(config.environment)) {
        return {
          connected: false,
          status: 'not_connected',
          errorMessage: 'Square needs a valid access token, location ID, and environment.',
          checkedAt: now().toISOString(),
        };
      }
      const day = localDayBounds(now(), config.timezone || 'America/Los_Angeles');
      const payments = await listSquarePayments({
        beginTime: day.begin,
        endTime: day.end,
        locationId,
        env: config,
        fetchImpl,
      });
      const completed = payments.filter(payment => payment.status === 'COMPLETED');
      return {
        connected: true,
        status: 'connected',
        salesTodayCents: completed.reduce((sum, payment) => sum + (payment.netAmountCents ?? payment.amountCents), 0),
        grossSalesTodayCents: completed.reduce((sum, payment) => sum + payment.amountCents, 0),
        refundsTodayCents: completed.reduce((sum, payment) => sum + (payment.refundedCents ?? 0), 0),
        transactionCount: completed.length,
        lastPaymentAt: completed[0]?.createdAt ?? null,
        checkedAt: now().toISOString(),
      };
    } catch (error) {
      return { connected: false, status: 'degraded', errorMessage: error.message, checkedAt: now().toISOString() };
    }
  }

  async function updateInventoryRule({ squareVariationId, reorderPoint, targetStock } = {}) {
    if (!squareVariationId) throw serviceError('INVENTORY_ITEM_REQUIRED', 'Choose an inventory item.', 400);
    const rows = await upsertBalances([{
      squareVariationId,
      reorderPoint: optionalNonNegativeInteger(reorderPoint, 'Reorder point'),
      targetStock: optionalNonNegativeInteger(targetStock, 'Target stock'),
      source: 'midway',
    }]);
    return rows[0] ?? null;
  }

  async function listVendors() {
    if (!supabase) return memory.vendors.map(clone).sort(compareNames);
    const { data, error } = await supabase.from('vendors').select('*').order('name');
    if (error) throw error;
    return (data ?? []).map(fromVendor);
  }

  async function createVendor(input = {}) {
    const name = String(input.name || '').trim();
    if (!name) throw serviceError('VENDOR_NAME_REQUIRED', 'Vendor name is required.', 400);
    const record = {
      id: crypto.randomUUID(),
      name,
      slug: slugify(input.slug || name),
      status: input.status || 'active',
      orderingMethod: input.orderingMethod || 'manual',
      contactName: String(input.contactName || '').trim() || null,
      contactEmail: String(input.contactEmail || '').trim() || null,
      contactPhone: String(input.contactPhone || '').trim() || null,
      orderDay: String(input.orderDay || '').trim() || null,
      notes: String(input.notes || '').trim() || null,
      createdAt: now().toISOString(),
      updatedAt: now().toISOString(),
    };
    if (!supabase) {
      if (memory.vendors.some(vendor => vendor.slug === record.slug)) throw serviceError('VENDOR_EXISTS', 'That vendor already exists.', 409);
      memory.vendors.push(record);
      return clone(record);
    }
    const { data, error } = await supabase.from('vendors').insert(toVendorRow(record)).select('*').single();
    if (error) throw error;
    return fromVendor(data);
  }

  async function listConnectors() {
    if (!supabase) return memory.connectors.map(publicConnector).sort(compareNames);
    const { data, error } = await supabase.from('vendor_connectors').select('*').order('display_name');
    if (error) throw error;
    return (data ?? []).map(fromConnector).map(publicConnector);
  }

  async function createConnector(input = {}) {
    const vendorId = String(input.vendorId || '').trim();
    const displayName = String(input.displayName || '').trim();
    const endpointUrl = String(input.endpointUrl || '').trim();
    if (!vendorId || !displayName || !endpointUrl) {
      throw serviceError('CONNECTOR_FIELDS_REQUIRED', 'Vendor, connection name, and MCP URL are required.', 400);
    }
    const authType = ['none', 'bearer', 'login'].includes(input.authType) ? input.authType : 'bearer';
    const authToken = String(input.authToken || '').trim();
    const secretRef = String(input.secretRef || '').trim() || null;
    if (authType === 'bearer' && !authToken && !secretRef) {
      throw serviceError('CONNECTOR_CREDENTIAL_REQUIRED', 'Paste the MCP bearer token or provide a server credential reference.', 400);
    }
    createVendorMcpClient({ endpointUrl, env, fetchImpl });
    const record = {
      id: crypto.randomUUID(),
      vendorId,
      displayName,
      connectorType: 'mcp',
      transport: input.transport || 'streamable_http',
      endpointUrl,
      authType,
      secretRef: authType === 'bearer' && authToken ? encodeEncryptedSecretRef(encryptConnectorSecret(authToken, env)) : authType === 'bearer' ? secretRef : null,
      encryptedCredentials: authType === 'login' ? encryptLoginCredentials(input, env) : {},
      status: 'not_tested',
      capabilities: [],
      lastCheckedAt: null,
      errorMessage: null,
      createdAt: now().toISOString(),
      updatedAt: now().toISOString(),
    };
    if (!supabase) {
      memory.connectors.push(record);
      return publicConnector(record);
    }
    const { data, error } = await supabase.from('vendor_connectors').insert(toConnectorRow(record)).select('*').single();
    if (error) throw error;
    return publicConnector(fromConnector(data));
  }

  async function updateConnectorCredentials(connectorId, input = {}) {
    const connector = await getConnector(connectorId);
    if (!connector) throw serviceError('CONNECTOR_NOT_FOUND', 'Vendor connection was not found.', 404);
    const authType = ['none', 'bearer', 'login'].includes(input.authType) ? input.authType : connector.authType;
    const patch = {
      authType,
      status: 'not_tested',
      errorMessage: null,
    };
    if (authType === 'login') {
      patch.encryptedCredentials = encryptLoginCredentials(input, env);
      patch.secretRef = null;
    } else if (authType === 'bearer') {
      const authToken = String(input.authToken || '').trim();
      const secretRef = String(input.secretRef || '').trim() || null;
      if (!authToken && !secretRef) {
        throw serviceError('CONNECTOR_CREDENTIAL_REQUIRED', 'Paste the MCP bearer token or provide a server credential reference.', 400);
      }
      patch.secretRef = authToken ? encodeEncryptedSecretRef(encryptConnectorSecret(authToken, env)) : secretRef;
      patch.encryptedCredentials = {};
    } else {
      patch.secretRef = null;
      patch.encryptedCredentials = {};
    }
    const updated = await updateConnector(connectorId, patch);
    return publicConnector(updated);
  }

  async function testConnector(connectorId) {
    const connector = await getConnector(connectorId);
    if (!connector) throw serviceError('CONNECTOR_NOT_FOUND', 'Vendor connection was not found.', 404);
    try {
      const client = connectorClient(connector);
      const tools = await client.listTools();
      const updated = await updateConnector(connector.id, {
        status: 'connected',
        capabilities: tools.map(tool => ({ name: tool.name, description: tool.description || '' })),
        lastCheckedAt: now().toISOString(),
        errorMessage: null,
      });
      return publicConnector(updated);
    } catch (error) {
      await updateConnector(connector.id, {
        status: 'error',
        lastCheckedAt: now().toISOString(),
        errorMessage: error.message,
      });
      throw error;
    }
  }

  async function listConnectorTools(connectorId) {
    const connector = await resolveConnector(connectorId);
    return connectorClient(connector).listTools();
  }

  async function callConnectorTool({ connectorId, toolName, arguments: args = {}, readOnly = false } = {}) {
    const connector = await resolveConnector(connectorId);
    if (readOnly && !isReadOnlyVendorToolName(toolName)) {
      throw serviceError('VENDOR_TOOL_NOT_READ_ONLY', `${toolName} can change vendor data, so it needs the approval flow (call_vendor_mcp_tool).`, 400);
    }
    const client = connectorClient(connector);
    const result = await client.callTool(toolName, args);
    // Vendor servers (Harbor) reject catalog calls without a session. Sign in
    // with server-held credentials and retry once so the agent never has to
    // manage vendor sessions itself.
    const authToolName = `${toolName.split('_')[0]}_authenticate`;
    if (toolName !== authToolName && vendorCallLooksUnauthenticated(result)) {
      try {
        await client.callTool(authToolName, {});
      } catch {
        return result;
      }
      return client.callTool(toolName, args);
    }
    return result;
  }

  async function draftReorder({ vendorId, items = [], notes = '' } = {}) {
    if (!vendorId) throw serviceError('VENDOR_REQUIRED', 'Choose a vendor for this order.', 400);
    const inventory = await listInventory({ lowStockOnly: true, limit: 500 });
    const requested = items.length ? items : inventory
      .filter(item => item.vendorId === vendorId)
      .map(item => ({
        squareVariationId: item.squareVariationId,
        name: item.name,
        vendorSku: item.vendorSku,
        quantity: suggestedOrderQuantity(item),
        casePack: item.casePack,
        unitCostCents: item.unitCostCents,
      }));
    const lines = requested.map(normalizeOrderLine).filter(line => line.quantity > 0);
    if (!lines.length) throw serviceError('ORDER_LINES_REQUIRED', 'No orderable low-stock items were found for this vendor.', 400);
    const createdAt = now().toISOString();
    const record = {
      id: crypto.randomUUID(),
      vendorId,
      orderNumber: `PO-${createdAt.slice(0, 10).replaceAll('-', '')}-${String(memory.purchaseOrders.length + 1).padStart(3, '0')}`,
      status: 'draft',
      lines,
      subtotalCents: lines.reduce((sum, line) => sum + (line.unitCostCents || 0) * line.quantity, 0),
      notes: String(notes || '').trim() || null,
      createdAt,
      updatedAt: createdAt,
    };
    if (!supabase) {
      memory.purchaseOrders.unshift(record);
      return clone(record);
    }
    const { data, error } = await supabase.from('purchase_orders').insert({
      id: record.id,
      vendor_id: record.vendorId,
      order_number: record.orderNumber,
      status: record.status,
      lines: record.lines,
      subtotal_cents: record.subtotalCents,
      notes: record.notes,
    }).select('*').single();
    if (error) throw error;
    return fromPurchaseOrder(data);
  }

  async function listPurchaseOrders({ limit = 50 } = {}) {
    if (!supabase) return memory.purchaseOrders.slice(0, limit).map(clone);
    const { data, error } = await supabase.from('purchase_orders').select('*').order('created_at', { ascending: false }).limit(limit);
    if (error) throw error;
    return (data ?? []).map(fromPurchaseOrder);
  }

  async function syncSalesHistory({ days = 365, actor = null } = {}) {
    const safeDays = Math.max(7, Math.min(730, Number(days) || 365));
    const config = await squareConfig();
    const locationId = config.locationId || config.externalLocationId;
    if (!config.accessToken || !locationId) throw serviceError('SQUARE_SALES_NOT_CONNECTED', 'Connect Square before syncing sales history.', 409);
    const completedAt = now();
    const startAt = new Date(completedAt.getTime() - safeDays * 24 * 60 * 60 * 1000).toISOString();
    const endAt = completedAt.toISOString();
    const run = await startSalesSyncRun({ startAt, endAt, actor });
    try {
      const squareOrders = await searchSquareOrders({ locationIds: [locationId], startAt, endAt, env: config, fetchImpl });
      const normalized = normalizeSquareOrders(squareOrders, { ingestedAt: endAt, timezone: config.timezone || 'America/Los_Angeles' });
      await persistSalesFacts(normalized);
      const finished = await finishSalesSyncRun(run.id, { status: 'completed', ordersSeen: squareOrders.length, ordersStored: normalized.orders.length, linesStored: normalized.lines.length, completedAt: endAt });
      await store.recordAuditLog?.({ action: 'command_center.sales_history_sync', actor: actor || { id: 'command-center', role: 'system' }, targetType: 'square_sales_history', targetId: run.id, metadata: { days: safeDays, orders: normalized.orders.length, lines: normalized.lines.length } });
      return { ...finished, days: safeDays };
    } catch (error) {
      await finishSalesSyncRun(run.id, { status: 'failed', errorMessage: error.message, completedAt: now().toISOString() }).catch(() => {});
      throw error;
    }
  }

  async function captureInventorySnapshot() {
    const config = await squareConfig();
    const locationId = config.locationId || config.externalLocationId;
    if (!config.accessToken || !locationId) throw serviceError('SQUARE_INVENTORY_NOT_CONNECTED', 'Connect Square inventory before taking a stock snapshot.', 409);
    const catalog = await store.listStoreInventory?.({ activeOnly: false }) ?? [];
    const ids = catalog.filter(item => !isBookingCatalogProduct(item)).map(item => item.squareVariationId).filter(Boolean);
    const counts = await batchRetrieveSquareInventoryCounts({ catalogObjectIds: ids, locationIds: [locationId], env: config, fetchImpl });
    await persistInventorySnapshots(counts, { source: 'daily_snapshot' });
    return { capturedAt: now().toISOString(), items: counts.length };
  }

  async function getSalesAnalytics({ days = 30 } = {}) {
    const safeDays = Math.max(7, Math.min(365, Number(days) || 30));
    const historyDays = Math.max(365, safeDays * 2);
    const to = now().toISOString().slice(0, 10);
    const from = new Date(now().getTime() - historyDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const [lines, syncRuns, catalog, inventorySnapshots] = await Promise.all([
      listSalesLines({ from, to }),
      listSalesSyncRuns({ limit: 5 }),
      store.listStoreInventory?.({ activeOnly: false }) ?? [],
      listInventorySnapshots({ from, to }),
    ]);
    return buildSalesAnalytics({ lines, days: safeDays, now: now(), lastSync: syncRuns.find(run => run.status === 'completed') || null, catalog, inventorySnapshots });
  }

  async function getDailySalesTotals({ businessDate } = {}) {
    if (!businessDate) throw serviceError('BUSINESS_DATE_REQUIRED', 'Provide a business date (YYYY-MM-DD).', 400);
    let orders;
    if (!supabase) {
      orders = [...memory.salesOrders.values()]
        .filter(order => order.businessDate === businessDate)
        .map(order => ({ totalCents: Number(order.totalCents || 0), taxCents: Number(order.taxCents || 0), refundCents: Number(order.refundCents || 0) }));
    } else {
      const { data, error } = await supabase
        .from('square_sales_orders')
        .select('total_cents, tax_cents, refund_cents')
        .eq('business_date', businessDate)
        .limit(10000);
      if (error) throw error;
      orders = (data ?? []).map(row => ({ totalCents: Number(row.total_cents || 0), taxCents: Number(row.tax_cents || 0), refundCents: Number(row.refund_cents || 0) }));
    }
    const grossCents = orders.reduce((sum, order) => sum + order.totalCents, 0);
    const taxCents = orders.reduce((sum, order) => sum + order.taxCents, 0);
    const refundCents = orders.reduce((sum, order) => sum + order.refundCents, 0);
    return { businessDate, orders: orders.length, grossCents, taxCents, refundCents, netCents: grossCents - refundCents };
  }

  async function persistInventorySnapshots(counts = [], { source = 'square' } = {}) {
    const capturedAt = now().toISOString();
    const snapshotDate = capturedAt.slice(0, 10);
    const records = counts.filter(count => count.catalogObjectId && count.locationId).map(count => ({ id: `${count.catalogObjectId}:${count.locationId}:${snapshotDate}`, squareVariationId: count.catalogObjectId, locationId: count.locationId, snapshotDate, quantity: Number(count.quantity || 0), capturedAt, source }));
    if (!supabase) { for (const record of records) memory.inventorySnapshots.set(record.id, record); return records; }
    for (const batch of chunks(records.map(toInventorySnapshotRow), 300)) {
      const result = await supabase.from('inventory_daily_snapshots').upsert(batch, { onConflict: 'square_variation_id,location_id,snapshot_date' });
      if (result.error) throw result.error;
    }
    return records;
  }

  async function listInventorySnapshots({ from, to } = {}) {
    if (!supabase) return [...memory.inventorySnapshots.values()].filter(item => (!from || item.snapshotDate >= from) && (!to || item.snapshotDate <= to)).map(clone);
    let query = supabase.from('inventory_daily_snapshots').select('*').order('snapshot_date', { ascending: true }).limit(50000);
    if (from) query = query.gte('snapshot_date', from);
    if (to) query = query.lte('snapshot_date', to);
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []).map(row => ({ id: row.id, squareVariationId: row.square_variation_id, locationId: row.location_id, snapshotDate: row.snapshot_date, quantity: Number(row.quantity), capturedAt: row.captured_at, source: row.source }));
  }

  async function persistSalesFacts({ orders = [], lines = [] } = {}) {
    if (!supabase) {
      for (const order of orders) memory.salesOrders.set(order.orderId, clone(order));
      const orderIds = new Set(orders.map(order => order.orderId));
      for (const [id, line] of memory.salesLines) if (orderIds.has(line.orderId)) memory.salesLines.delete(id);
      for (const line of lines) memory.salesLines.set(line.id, clone(line));
      return;
    }
    for (const batch of chunks(orders.map(toSalesOrderRow), 200)) {
      const result = await supabase.from('square_sales_orders').upsert(batch, { onConflict: 'order_id' });
      if (result.error) throw result.error;
    }
    const orderIds = orders.map(order => order.orderId);
    for (const batch of chunks(orderIds, 100)) {
      const result = await supabase.from('square_sales_line_items').delete().in('order_id', batch);
      if (result.error) throw result.error;
    }
    for (const batch of chunks(lines.map(toSalesLineRow), 300)) {
      const result = await supabase.from('square_sales_line_items').insert(batch);
      if (result.error) throw result.error;
    }
  }

  async function listSalesLines({ from, to } = {}) {
    if (!supabase) return [...memory.salesLines.values()].filter(line => (!from || line.businessDate >= from) && (!to || line.businessDate <= to)).map(clone);
    const rows = [];
    for (let start = 0; ; start += 1000) {
      let query = supabase.from('square_sales_line_items').select('*').order('business_date', { ascending: true }).range(start, start + 999);
      if (from) query = query.gte('business_date', from);
      if (to) query = query.lte('business_date', to);
      const { data, error } = await query;
      if (error) throw error;
      rows.push(...(data ?? []).map(fromSalesLine));
      if (!data || data.length < 1000) break;
    }
    return rows;
  }

  async function listSalesSyncRuns({ limit = 20 } = {}) {
    if (!supabase) return memory.salesSyncRuns.slice(0, limit).map(clone);
    const { data, error } = await supabase.from('sales_sync_runs').select('*').order('started_at', { ascending: false }).limit(Math.min(100, limit));
    if (error) throw error;
    return (data ?? []).map(fromSalesSyncRun);
  }

  async function startSalesSyncRun({ startAt, endAt, actor }) {
    const record = { id: crypto.randomUUID(), status: 'running', rangeStart: startAt, rangeEnd: endAt, startedBy: actor?.email || actor?.id || null, startedAt: now().toISOString(), completedAt: null, ordersSeen: 0, ordersStored: 0, linesStored: 0, errorMessage: null };
    if (!supabase) { memory.salesSyncRuns.unshift(record); return clone(record); }
    const { data, error } = await supabase.from('sales_sync_runs').insert(toSalesSyncRunRow(record)).select('*').single();
    if (error) throw error;
    return fromSalesSyncRun(data);
  }

  async function finishSalesSyncRun(id, patch = {}) {
    if (!supabase) { const target = memory.salesSyncRuns.find(item => item.id === id); Object.assign(target, patch); return clone(target); }
    const { data, error } = await supabase.from('sales_sync_runs').update(definedOnly({ status: patch.status, completed_at: patch.completedAt, orders_seen: patch.ordersSeen, orders_stored: patch.ordersStored, lines_stored: patch.linesStored, error_message: patch.errorMessage })).eq('id', id).select('*').single();
    if (error) throw error;
    return fromSalesSyncRun(data);
  }

  async function saveUpload({ fileName, contentType, buffer, sizeBytes, actor, conversationId = null, purpose = 'assistant' } = {}) {
    if (!fileName || !contentType || !buffer?.length) throw serviceError('UPLOAD_REQUIRED', 'Choose a file to upload.', 400);
    const createdAt = now().toISOString();
    const record = {
      id: crypto.randomUUID(),
      fileName: safeFileName(fileName),
      contentType,
      sizeBytes: Number(sizeBytes || buffer.length),
      purpose,
      conversationId,
      uploadedBy: actor?.email || actor?.id || null,
      storageBucket: null,
      storagePath: null,
      createdAt,
    };
    if (!supabase) {
      memory.uploads.unshift(record);
      return clone(record);
    }
    const bucket = env.COMMAND_CENTER_UPLOADS_BUCKET || 'midway-command-center';
    const storagePath = `${createdAt.slice(0, 10)}/${record.id}-${record.fileName}`;
    const { error: uploadError } = await supabase.storage.from(bucket).upload(storagePath, buffer, { contentType, upsert: false });
    if (uploadError) throw uploadError;
    const { data, error } = await supabase.from('command_center_uploads').insert({
      id: record.id,
      file_name: record.fileName,
      content_type: record.contentType,
      size_bytes: record.sizeBytes,
      purpose: record.purpose,
      conversation_id: record.conversationId,
      uploaded_by: record.uploadedBy,
      storage_bucket: bucket,
      storage_path: storagePath,
    }).select('*').single();
    if (error) throw error;
    return withUploadUrl(fromUpload(data));
  }

  // Direct-to-storage upload: the browser sends file bytes straight to the
  // storage bucket via a one-time signed URL, so hosting request-body caps
  // (~4.5 MB) never apply. The metadata row is created up front.
  async function createDirectUpload({ fileName, contentType, sizeBytes, actor, conversationId = null, purpose = 'assistant' } = {}) {
    if (!fileName || !contentType) throw serviceError('UPLOAD_REQUIRED', 'Choose a file to upload.', 400);
    if (!supabase) throw serviceError('UPLOAD_STORAGE_REQUIRED', 'Large file uploads need file storage, which is not configured on this server.', 409);
    if (Number(sizeBytes) > 45 * 1024 * 1024) throw serviceError('UPLOAD_TOO_LARGE', 'Files can be up to 45 MB.', 400);
    const createdAt = now().toISOString();
    const id = crypto.randomUUID();
    const safeName = safeFileName(fileName);
    const bucket = env.COMMAND_CENTER_UPLOADS_BUCKET || 'midway-command-center';
    const storagePath = `${createdAt.slice(0, 10)}/${id}-${safeName}`;
    const { data: signed, error: signError } = await supabase.storage.from(bucket).createSignedUploadUrl(storagePath);
    if (signError) throw signError;
    const { data, error } = await supabase.from('command_center_uploads').insert({
      id,
      file_name: safeName,
      content_type: contentType,
      size_bytes: Number(sizeBytes || 0),
      purpose,
      conversation_id: conversationId,
      uploaded_by: actor?.email || actor?.id || null,
      storage_bucket: bucket,
      storage_path: storagePath,
    }).select('*').single();
    if (error) throw error;
    return { ...fromUpload(data), uploadUrl: signed.signedUrl, uploadToken: signed.token };
  }

  async function readUploadContent(uploadId, { pageStart = null } = {}) {
    if (!supabase) throw serviceError('UPLOAD_STORAGE_REQUIRED', 'File storage is not configured on this server.', 409);
    const { data: row, error } = await supabase.from('command_center_uploads').select('*').eq('id', uploadId).maybeSingle();
    if (error) throw error;
    const record = row ? fromUpload(row) : null;
    if (!record?.storageBucket || !record?.storagePath) {
      throw serviceError('UPLOAD_NOT_FOUND', 'That uploaded file could not be found.', 404);
    }
    const { data: blob, error: downloadError } = await supabase.storage.from(record.storageBucket).download(record.storagePath);
    if (downloadError) throw downloadError;
    let buffer = Buffer.from(await blob.arrayBuffer());
    let note = null;
    let lastPage = null;
    let totalPages = null;
    if (record.contentType === 'application/pdf' && (pageStart || buffer.length > 28 * 1024 * 1024)) {
      const shrunk = await shrinkPdfBuffer(buffer, { pageStart: pageStart || 1 });
      buffer = shrunk.buffer;
      lastPage = shrunk.lastPage;
      totalPages = shrunk.totalPages;
      if (shrunk.keptPages !== null && shrunk.lastPage !== null && shrunk.lastPage < shrunk.totalPages) {
        note = `This is pages ${shrunk.firstPage}-${shrunk.lastPage} of ${shrunk.totalPages} in ${record.fileName}. Nothing is lost: when the owner says "keep reading", the next pages (from page ${shrunk.lastPage + 1}) are attached automatically. Offer that.`;
      } else if (pageStart && shrunk.firstPage > 1) {
        note = `This is pages ${shrunk.firstPage}-${shrunk.lastPage ?? shrunk.totalPages} of ${shrunk.totalPages} in ${record.fileName}.`;
      }
    }
    if (buffer.length > 28 * 1024 * 1024) {
      throw serviceError('UPLOAD_TOO_LARGE_TO_READ', `${record.fileName} is too large to read even after shrinking. Split it into smaller files and try again.`, 400);
    }
    return {
      fileName: record.fileName,
      contentType: record.contentType,
      dataUrl: `data:${record.contentType};base64,${buffer.toString('base64')}`,
      sizeBytes: buffer.length,
      note,
      lastPage,
      totalPages,
    };
  }

  async function listUploads({ limit = 50, conversationId } = {}) {
    if (!supabase) return memory.uploads.filter(item => !conversationId || item.conversationId === conversationId).slice(0, limit).map(clone);
    let query = supabase.from('command_center_uploads').select('*').order('created_at', { ascending: false }).limit(Math.min(100, limit));
    if (conversationId) query = query.eq('conversation_id', conversationId);
    const { data, error } = await query;
    if (error) throw error;
    return Promise.all((data ?? []).map(row => withUploadUrl(fromUpload(row))));
  }

  async function withUploadUrl(record) {
    if (!supabase || !record?.storageBucket || !record?.storagePath) return record;
    const { data } = await supabase.storage.from(record.storageBucket).createSignedUrl(record.storagePath, 3600);
    return { ...record, signedUrl: data?.signedUrl ?? null };
  }

  async function listReconciliations({ limit = 30 } = {}) {
    if (!supabase) return memory.reconciliations.slice(0, limit).map(clone);
    const { data, error } = await supabase.from('reconciliation_sessions').select('*').order('created_at', { ascending: false }).limit(Math.min(100, limit));
    if (error) throw error;
    return (data ?? []).map(fromReconciliation);
  }

  async function createReconciliation({ lines = [], notes = '', actor = null } = {}) {
    if (!Array.isArray(lines) || !lines.length) throw serviceError('RECONCILIATION_LINES_REQUIRED', 'Enter at least one physical count.', 400);
    const inventory = await listInventory({ limit: 1000 });
    const inventoryById = new Map(inventory.map(item => [item.squareVariationId, item]));
    const normalizedLines = lines.map(line => {
      const item = inventoryById.get(line.squareVariationId);
      if (!item) throw serviceError('RECONCILIATION_ITEM_NOT_FOUND', 'One of the counted items is no longer in inventory.', 400);
      const countedQuantity = optionalNonNegativeInteger(line.countedQuantity, `${item.name} count`);
      if (countedQuantity === undefined) throw serviceError('RECONCILIATION_COUNT_REQUIRED', `Enter a count for ${item.name}.`, 400);
      return {
        squareVariationId: item.squareVariationId,
        name: item.name,
        sku: item.sku || null,
        expectedQuantity: item.quantity,
        countedQuantity,
        variance: item.quantity === null ? null : countedQuantity - item.quantity,
      };
    });
    const createdAt = now().toISOString();
    const record = {
      id: crypto.randomUUID(),
      status: 'review',
      startedBy: actor?.email || actor?.id || null,
      lines: normalizedLines,
      exceptionCount: normalizedLines.filter(line => line.variance === null || line.variance !== 0).length,
      notes: String(notes || '').trim() || null,
      startedAt: createdAt,
      resolvedAt: null,
      createdAt,
      updatedAt: createdAt,
    };
    if (!supabase) {
      memory.reconciliations.unshift(record);
      return clone(record);
    }
    const { data, error } = await supabase.from('reconciliation_sessions').insert({
      id: record.id,
      status: record.status,
      started_by: record.startedBy,
      lines: record.lines,
      exception_count: record.exceptionCount,
      notes: record.notes,
    }).select('*').single();
    if (error) throw error;
    return fromReconciliation(data);
  }

  async function applyReconciliation({ reconciliationId, actor = null } = {}) {
    const session = await getReconciliation(reconciliationId);
    if (!session) throw serviceError('RECONCILIATION_NOT_FOUND', 'Inventory count was not found.', 404);
    if (session.status === 'resolved') return session;
    const config = await squareConfig();
    const locationId = config.locationId || config.externalLocationId;
    if (!config.accessToken || !locationId) throw serviceError('SQUARE_INVENTORY_NOT_CONNECTED', 'Connect Square inventory before applying a physical count.', 409);
    const occurredAt = now().toISOString();
    await batchCreateSquarePhysicalCounts({
      counts: session.lines.map(line => ({ catalogObjectId: line.squareVariationId, quantity: line.countedQuantity, locationId })),
      locationId,
      occurredAt,
      idempotencyKey: `reconcile-${session.id}`,
      env: config,
      fetchImpl,
    });
    await upsertBalances(session.lines.map(line => ({
      squareVariationId: line.squareVariationId,
      locationId,
      quantity: line.countedQuantity,
      lastCountedAt: occurredAt,
      source: 'physical_count',
    })));
    await persistInventorySnapshots(session.lines.map(line => ({ catalogObjectId: line.squareVariationId, locationId, quantity: line.countedQuantity })), { source: 'reconciliation' });
    if (supabase) {
      const events = session.lines.map(line => ({
        square_variation_id: line.squareVariationId,
        event_type: 'physical_count',
        quantity_delta: line.variance,
        resulting_quantity: line.countedQuantity,
        source: 'command_center',
        source_reference: session.id,
        actor_id: actor?.email || actor?.id || null,
        occurred_at: occurredAt,
      }));
      const eventResult = await supabase.from('inventory_events').insert(events);
      if (eventResult.error) throw eventResult.error;
      const { data, error } = await supabase.from('reconciliation_sessions').update({ status: 'resolved', resolved_at: occurredAt, updated_at: occurredAt }).eq('id', session.id).select('*').single();
      if (error) throw error;
      return fromReconciliation(data);
    }
    const target = memory.reconciliations.find(item => item.id === session.id);
    Object.assign(target, { status: 'resolved', resolvedAt: occurredAt, updatedAt: occurredAt });
    return clone(target);
  }

  async function getReconciliation(id) {
    if (!id) return null;
    if (!supabase) return clone(memory.reconciliations.find(item => item.id === id) ?? null);
    const { data, error } = await supabase.from('reconciliation_sessions').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    return data ? fromReconciliation(data) : null;
  }

  async function listBalances() {
    if (!supabase) return [...memory.balances.values()].map(clone);
    const { data, error } = await supabase.from('inventory_balances').select('*');
    if (error) throw error;
    return (data ?? []).map(fromBalance);
  }

  async function upsertBalances(items = []) {
    if (!items.length) return [];
    if (!supabase) {
      return items.map(item => {
        const existing = memory.balances.get(item.squareVariationId) ?? {};
        const record = {
          ...existing,
          ...definedOnly(item),
          squareVariationId: item.squareVariationId,
          updatedAt: now().toISOString(),
        };
        memory.balances.set(item.squareVariationId, record);
        return clone(record);
      });
    }
    const existingRows = await listBalances();
    const existingById = new Map(existingRows.map(row => [row.squareVariationId, row]));
    const rows = items.map(item => toBalanceRow({ ...existingById.get(item.squareVariationId), ...definedOnly(item) }, now()));
    const { data, error } = await supabase.from('inventory_balances').upsert(rows, { onConflict: 'square_variation_id' }).select('*');
    if (error) throw error;
    return (data ?? []).map(fromBalance);
  }

  async function listVendorProducts() {
    if (!supabase) return memory.vendorProducts.map(clone);
    const { data, error } = await supabase.from('vendor_products').select('*');
    if (error) throw error;
    return (data ?? []).map(fromVendorProduct);
  }

  async function mapVendorProduct({ squareVariationId, vendorId, vendorSku = null, casePack = null, unitCostCents = null } = {}) {
    const variationId = String(squareVariationId || '').trim();
    const vendorRef = String(vendorId || '').trim();
    if (!variationId) throw serviceError('INVENTORY_ITEM_REQUIRED', 'Choose an inventory item to map to a vendor.', 400);
    if (!vendorRef) throw serviceError('VENDOR_REQUIRED', 'Choose which vendor supplies this item.', 400);
    const vendors = await listVendors();
    const vendor = vendors.find(item => item.id === vendorRef);
    if (!vendor) throw serviceError('VENDOR_NOT_FOUND', 'That vendor is not set up yet. List the vendors first and use one of their ids.', 404);
    const record = {
      id: crypto.randomUUID(),
      vendorId: vendor.id,
      squareVariationId: variationId,
      vendorSku: String(vendorSku || '').trim() || null,
      casePack: nullablePositiveInteger(casePack, 'Case pack'),
      unitCostCents: nullableNonNegativeInteger(unitCostCents, 'Unit cost'),
    };
    if (!supabase) {
      memory.vendorProducts = memory.vendorProducts.filter(item => item.squareVariationId !== variationId);
      memory.vendorProducts.push(record);
      return clone(record);
    }
    // The table's unique key is (vendor_id, square_variation_id), but the store
    // wants exactly one supplier per item, so clear any mapping for this
    // variation before inserting the replacement.
    const { error: deleteError } = await supabase.from('vendor_products').delete().eq('square_variation_id', variationId);
    if (deleteError) throw deleteError;
    const { data, error } = await supabase.from('vendor_products').insert({
      vendor_id: record.vendorId,
      square_variation_id: record.squareVariationId,
      vendor_sku: record.vendorSku,
      case_pack: record.casePack,
      unit_cost_cents: record.unitCostCents,
      updated_at: now().toISOString(),
    }).select('*').single();
    if (error) throw error;
    return fromVendorProduct(data);
  }

  async function unmapVendorProduct({ squareVariationId } = {}) {
    const variationId = String(squareVariationId || '').trim();
    if (!variationId) throw serviceError('INVENTORY_ITEM_REQUIRED', 'Choose an inventory item to unmap.', 400);
    if (!supabase) {
      const before = memory.vendorProducts.length;
      memory.vendorProducts = memory.vendorProducts.filter(item => item.squareVariationId !== variationId);
      return { squareVariationId: variationId, removed: memory.vendorProducts.length < before };
    }
    const { data, error } = await supabase.from('vendor_products').delete().eq('square_variation_id', variationId).select('id');
    if (error) throw error;
    return { squareVariationId: variationId, removed: (data ?? []).length > 0 };
  }

  async function getConnector(connectorId) {
    if (!isUuid(connectorId)) return null;
    if (!supabase) return clone(memory.connectors.find(connector => connector.id === connectorId) ?? null);
    const { data, error } = await supabase.from('vendor_connectors').select('*').eq('id', connectorId).maybeSingle();
    if (error) throw error;
    return data ? fromConnector(data) : null;
  }

  // Accepts a connector id, a vendor id, or a human reference ("Harbor",
  // "harbor-wholesale", a connection name). With no reference, falls back to
  // the only (or only connected) vendor connection so the agent never needs
  // to know internal ids.
  async function resolveConnector(reference) {
    const direct = await getConnector(reference);
    if (direct) return direct;
    const [connectors, vendors] = await Promise.all([listRawConnectors(), listVendors()]);
    if (!connectors.length) {
      throw serviceError('CONNECTOR_NOT_FOUND', 'No vendor connections are set up yet. Add one on the Connections page.', 404);
    }
    const needle = String(reference || '').trim().toLowerCase();
    let candidates = connectors;
    if (needle) {
      const vendorIds = new Set(
        vendors
          .filter(vendor => vendor.id === reference || vendor.slug?.toLowerCase() === needle || vendor.name?.toLowerCase().includes(needle))
          .map(vendor => vendor.id),
      );
      candidates = connectors.filter(connector => vendorIds.has(connector.vendorId)
        || connector.displayName?.toLowerCase().includes(needle));
      if (!candidates.length) {
        throw serviceError('CONNECTOR_NOT_FOUND', `No vendor connection matches "${reference}". Check the Connections page.`, 404);
      }
    }
    const connected = candidates.filter(connector => connector.status === 'connected');
    const pool = connected.length ? connected : candidates;
    if (pool.length > 1) {
      throw serviceError('CONNECTOR_AMBIGUOUS', `More than one vendor connection matches. Choose one of: ${pool.map(connector => connector.displayName).join(', ')}.`, 409);
    }
    return pool[0];
  }

  async function listRawConnectors() {
    if (!supabase) return memory.connectors.map(clone);
    const { data, error } = await supabase.from('vendor_connectors').select('*').order('display_name');
    if (error) throw error;
    return (data ?? []).map(fromConnector);
  }

  async function updateConnector(connectorId, patch) {
    if (!supabase) {
      const connector = memory.connectors.find(item => item.id === connectorId);
      if (!connector) return null;
      Object.assign(connector, patch, { updatedAt: now().toISOString() });
      return clone(connector);
    }
    const rowPatch = {};
    if (patch.status !== undefined) rowPatch.status = patch.status;
    if (patch.capabilities !== undefined) rowPatch.capabilities = patch.capabilities;
    if (patch.lastCheckedAt !== undefined) rowPatch.last_checked_at = patch.lastCheckedAt;
    if (patch.errorMessage !== undefined) rowPatch.error_message = patch.errorMessage;
    if (patch.authType !== undefined) rowPatch.auth_type = patch.authType;
    if (patch.secretRef !== undefined) rowPatch.secret_ref = patch.secretRef;
    if (patch.encryptedCredentials !== undefined) rowPatch.encrypted_credentials = patch.encryptedCredentials;
    rowPatch.updated_at = now().toISOString();
    const { data, error } = await supabase.from('vendor_connectors').update(rowPatch).eq('id', connectorId).select('*').single();
    if (error) throw error;
    return fromConnector(data);
  }

  function connectorClient(connector) {
    if (connector.authType === 'oauth') {
      throw serviceError('CONNECTOR_AUTH_UNSUPPORTED', 'OAuth vendor MCP connections are not supported by this connector yet.', 409);
    }
    if (connector.authType === 'login') {
      const stored = connector.encryptedCredentials || {};
      if (!stored.emailCiphertext || !stored.passwordCiphertext) {
        throw serviceError('CONNECTOR_CREDENTIAL_MISSING', 'This vendor connection is missing its saved sign-in. Enter the email and password again.', 409);
      }
      return createVendorMcpClient({
        endpointUrl: connector.endpointUrl,
        credentials: {
          email: decryptConnectorSecret(stored.emailCiphertext, env),
          password: decryptConnectorSecret(stored.passwordCiphertext, env),
        },
        fetchImpl,
        env,
      });
    }
    const encryptedToken = connector.encryptedCredentials?.authTokenCiphertext
      || decodeEncryptedSecretRef(connector.secretRef);
    const authToken = encryptedToken
      ? decryptConnectorSecret(encryptedToken, env)
      : connector.secretRef ? String(env[connector.secretRef] || '') : '';
    if (connector.authType === 'bearer' && !authToken) {
      throw serviceError('CONNECTOR_CREDENTIAL_MISSING', 'This MCP connection is missing its bearer token. Edit the connection or add the configured server secret.', 409);
    }
    return createVendorMcpClient({ endpointUrl: connector.endpointUrl, authToken, fetchImpl, env });
  }

  return {
    getOverview,
    getSquareSnapshot,
    syncSquare,
    listInventory,
    updateInventoryRule,
    mapVendorProduct,
    unmapVendorProduct,
    listVendors,
    createVendor,
    listConnectors,
    createConnector,
    updateConnectorCredentials,
    testConnector,
    listConnectorTools,
    callConnectorTool,
    draftReorder,
    listPurchaseOrders,
    syncSalesHistory,
    captureInventorySnapshot,
    getSalesAnalytics,
    getDailySalesTotals,
    listSalesSyncRuns,
    saveUpload,
    createDirectUpload,
    readUploadContent,
    listUploads,
    listReconciliations,
    createReconciliation,
    applyReconciliation,
  };
}

function buildPriorities({ dashboard = {}, lowStock = [], connectors = [], draftOrders = [], squareProvider, square }) {
  const priorities = [];
  if (square?.status !== 'connected' || ['error', 'not_connected'].includes(squareProvider?.status)) {
    priorities.push({ id: 'square-sync', tone: 'danger', title: 'Square needs attention', detail: square?.errorMessage || squareProvider?.errorMessage || 'Reconnect Square to restore live sales data.', action: 'Review connection' });
  }
  if (lowStock.length) priorities.push({ id: 'low-stock', tone: 'warning', title: `${lowStock.length} item${lowStock.length === 1 ? '' : 's'} running low`, detail: lowStock.slice(0, 3).map(item => item.name).join(', '), action: 'Build an order' });
  const connectorErrors = connectors.filter(connector => connector.status === 'error');
  if (connectorErrors.length) priorities.push({ id: 'vendor-errors', tone: 'warning', title: `${connectorErrors.length} vendor connection${connectorErrors.length === 1 ? '' : 's'} offline`, detail: connectorErrors.map(item => item.displayName).join(', '), action: 'Check connections' });
  if (draftOrders.length) priorities.push({ id: 'draft-orders', tone: 'info', title: `${draftOrders.length} order draft${draftOrders.length === 1 ? '' : 's'} waiting`, detail: 'Review quantities before sending anything to a vendor.', action: 'Review orders' });
  const arrivals = dashboard.arrivals?.length ?? 0;
  if (arrivals) priorities.push({ id: 'arrivals', tone: 'info', title: `${arrivals} arrival${arrivals === 1 ? '' : 's'} today`, detail: 'Guest arrival details are ready in the bookings view.', action: 'View arrivals' });
  if (!priorities.length) priorities.push({ id: 'all-clear', tone: 'success', title: 'Everything looks good', detail: 'No urgent inventory, vendor, or booking issues right now.', action: 'Ask Midway' });
  return priorities;
}

function localDayBounds(date, timezone = 'America/Los_Angeles') {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = Object.fromEntries(formatter.formatToParts(new Date(date)).map(part => [part.type, part.value]));
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const nextDate = new Date(Date.UTC(year, month - 1, day + 1));
  return {
    begin: zonedMidnightUtc(year, month, day, timezone).toISOString(),
    end: zonedMidnightUtc(nextDate.getUTCFullYear(), nextDate.getUTCMonth() + 1, nextDate.getUTCDate(), timezone).toISOString(),
  };
}

function zonedMidnightUtc(year, month, day, timezone) {
  let estimate = Date.UTC(year, month - 1, day);
  const formatter = new Intl.DateTimeFormat('en-US-u-hc-h23', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
  });
  for (let iteration = 0; iteration < 2; iteration += 1) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(estimate)).map(part => [part.type, part.value]));
    const representedAsUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    estimate -= representedAsUtc - Date.UTC(year, month - 1, day);
  }
  return new Date(estimate);
}

function normalizeOrderLine(line = {}) {
  return {
    squareVariationId: line.squareVariationId ?? null,
    name: String(line.name || 'Item').trim(),
    vendorSku: String(line.vendorSku || '').trim() || null,
    quantity: Math.max(0, Math.round(Number(line.quantity) || 0)),
    casePack: finiteOrNull(line.casePack),
    unitCostCents: finiteOrNull(line.unitCostCents),
  };
}

function suggestedOrderQuantity(item) {
  const target = item.targetStock ?? item.reorderPoint ?? 0;
  const needed = Math.max(0, target - (item.quantity ?? 0));
  const pack = Math.max(1, item.casePack ?? 1);
  return Math.ceil(needed / pack) * pack;
}

function fromVendor(row) {
  return { id: row.id, name: row.name, slug: row.slug, status: row.status, orderingMethod: row.ordering_method, contactName: row.contact_name, contactEmail: row.contact_email, contactPhone: row.contact_phone, orderDay: row.order_day, notes: row.notes, createdAt: row.created_at, updatedAt: row.updated_at };
}

function toVendorRow(record) {
  return { id: record.id, name: record.name, slug: record.slug, status: record.status, ordering_method: record.orderingMethod, contact_name: record.contactName, contact_email: record.contactEmail, contact_phone: record.contactPhone, order_day: record.orderDay, notes: record.notes };
}

function fromConnector(row) {
  return { id: row.id, vendorId: row.vendor_id, displayName: row.display_name, connectorType: row.connector_type, transport: row.transport, endpointUrl: row.endpoint_url, authType: row.auth_type, secretRef: row.secret_ref, encryptedCredentials: row.encrypted_credentials ?? {}, status: row.status, capabilities: row.capabilities ?? [], lastCheckedAt: row.last_checked_at, errorMessage: row.error_message, createdAt: row.created_at, updatedAt: row.updated_at };
}

function toConnectorRow(record) {
  return { id: record.id, vendor_id: record.vendorId, display_name: record.displayName, connector_type: record.connectorType, transport: record.transport, endpoint_url: record.endpointUrl, auth_type: record.authType, secret_ref: record.secretRef, encrypted_credentials: record.encryptedCredentials ?? {}, status: record.status, capabilities: record.capabilities, last_checked_at: record.lastCheckedAt, error_message: record.errorMessage };
}

function publicConnector(record) {
  const { encryptedCredentials: _encryptedCredentials, secretRef: _secretRef, ...safe } = record;
  return { ...safe, secretConfigured: Boolean(record.secretRef || record.encryptedCredentials?.authTokenCiphertext || record.encryptedCredentials?.passwordCiphertext) };
}

const DEFAULT_LOW_STOCK_THRESHOLD = 3;

// Re-save (and if needed, page-trim) a PDF that is too large to hand to the
// AI model. Loaded lazily so the dependency only costs when actually needed.
export async function shrinkPdfBuffer(buffer, { pageStart = 1 } = {}) {
  try {
    const { PDFDocument } = await import('pdf-lib');
    const source = await PDFDocument.load(buffer, { ignoreEncryption: true });
    const totalPages = source.getPageCount();
    const firstIndex = Math.min(Math.max(1, pageStart), totalPages) - 1;
    if (firstIndex === 0) {
      const resaved = await source.save({ useObjectStreams: true });
      if (resaved.length <= 28 * 1024 * 1024) {
        return { buffer: Buffer.from(resaved), keptPages: totalPages, totalPages, firstPage: 1, lastPage: totalPages };
      }
    }
    // Adaptive chunk sizes all the way down to a single page, so even a
    // handful of enormous scanned pages can be read piece by piece.
    for (const pageLimit of [80, 40, 20, 10, 5, 2, 1]) {
      const count = Math.min(pageLimit, totalPages - firstIndex);
      if (count <= 0) break;
      if (firstIndex === 0 && count >= totalPages && totalPages > 1) continue;
      const trimmed = await PDFDocument.create();
      const pages = await trimmed.copyPages(source, Array.from({ length: count }, (_, index) => firstIndex + index));
      for (const page of pages) trimmed.addPage(page);
      const saved = await trimmed.save({ useObjectStreams: true });
      if (saved.length <= 28 * 1024 * 1024) {
        return { buffer: Buffer.from(saved), keptPages: count, totalPages, firstPage: firstIndex + 1, lastPage: firstIndex + count };
      }
    }
    return { buffer, keptPages: totalPages, totalPages, firstPage: 1, lastPage: totalPages };
  } catch {
    return { buffer, keptPages: null, totalPages: null, firstPage: 1, lastPage: null };
  }
}

// Square names the default variation "Regular", which turns every item into
// "Thing - Regular" in lists. Drop that noise for display.
function cleanItemName(value) {
  return String(value || '').replace(/\s*[-–—]\s*Regular$/i, '').replace(/\s*\(Regular\)$/i, '').trim();
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ''));
}

const READ_ONLY_VENDOR_TOOL_PATTERN = /^([a-z0-9]+_)?(get|list|search|browse|view|filter|read|describe|health|setup|status|authenticate|validate)(_|$)/i;

function isReadOnlyVendorToolName(toolName) {
  return READ_ONLY_VENDOR_TOOL_PATTERN.test(String(toolName || '').trim());
}

function vendorCallLooksUnauthenticated(result) {
  try {
    const text = (result?.content ?? [])
      .filter(part => part.type === 'text')
      .map(part => part.text)
      .join('\n');
    if (!text) return false;
    const payload = JSON.parse(text);
    if (payload?.success !== false) return false;
    const statusCode = payload?.error?.statusCode;
    const code = String(payload?.error?.code || '');
    return [401, 403, 404].includes(statusCode) || /AUTH|SESSION/i.test(code);
  } catch {
    return false;
  }
}

function encryptLoginCredentials(input, env) {
  const email = String(input.email || '').trim();
  const password = String(input.password || '');
  if (!email || !password) {
    throw serviceError('CONNECTOR_LOGIN_REQUIRED', 'Enter the vendor account email and password.', 400);
  }
  return {
    emailCiphertext: encryptConnectorSecret(email, env),
    passwordCiphertext: encryptConnectorSecret(password, env),
  };
}

function encryptConnectorSecret(value, env = process.env) {
  const key = connectorEncryptionKey(env);
  if (!key) throw serviceError('CONNECTOR_ENCRYPTION_REQUIRED', 'Set PROVIDER_CREDENTIALS_ENCRYPTION_KEY or ADMIN_SESSION_SECRET before saving MCP credentials.', 409);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return {
    version: 1,
    algorithm: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

function decryptConnectorSecret(payload, env = process.env) {
  const key = connectorEncryptionKey(env);
  if (!key) throw serviceError('CONNECTOR_ENCRYPTION_REQUIRED', 'The server credential encryption key is missing.', 409);
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(payload.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(payload.ciphertext, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    throw serviceError('CONNECTOR_CREDENTIAL_INVALID', 'The saved MCP credential could not be decrypted. Replace it and test the connection again.', 409);
  }
}

function connectorEncryptionKey(env = process.env) {
  const secret = String(
    env.MCP_CREDENTIALS_ENCRYPTION_KEY
    || env.PROVIDER_CREDENTIALS_ENCRYPTION_KEY
    || env.ADMIN_SESSION_SECRET
    || env.ADMIN_OWNER_TOKEN
    || '',
  ).trim();
  return secret ? crypto.createHash('sha256').update(secret).digest() : null;
}

function encodeEncryptedSecretRef(payload) {
  return `enc:v1:${Buffer.from(JSON.stringify(payload)).toString('base64url')}`;
}

function decodeEncryptedSecretRef(value) {
  const reference = String(value || '');
  if (!reference.startsWith('enc:v1:')) return null;
  try {
    return JSON.parse(Buffer.from(reference.slice(7), 'base64url').toString('utf8'));
  } catch {
    throw serviceError('CONNECTOR_CREDENTIAL_INVALID', 'The saved MCP credential is malformed. Replace it and test the connection again.', 409);
  }
}

function fromPurchaseOrder(row) {
  return { id: row.id, vendorId: row.vendor_id, orderNumber: row.order_number, status: row.status, lines: row.lines ?? [], subtotalCents: row.subtotal_cents ?? 0, notes: row.notes, createdAt: row.created_at, updatedAt: row.updated_at };
}

function fromBalance(row) {
  return { squareVariationId: row.square_variation_id, locationId: row.location_id, quantity: Number(row.quantity), reorderPoint: finiteOrNull(row.reorder_point), targetStock: finiteOrNull(row.target_stock), source: row.source, lastCountedAt: row.last_counted_at, updatedAt: row.updated_at };
}

function fromUpload(row) {
  return { id: row.id, fileName: row.file_name, contentType: row.content_type, sizeBytes: row.size_bytes, purpose: row.purpose, conversationId: row.conversation_id, uploadedBy: row.uploaded_by, storageBucket: row.storage_bucket, storagePath: row.storage_path, createdAt: row.created_at };
}

function fromReconciliation(row) {
  return { id: row.id, status: row.status, startedBy: row.started_by, lines: row.lines ?? [], exceptionCount: row.exception_count ?? 0, notes: row.notes, startedAt: row.started_at, resolvedAt: row.resolved_at, createdAt: row.created_at, updatedAt: row.updated_at };
}

function fromSalesLine(row) {
  return { id: row.id, orderId: row.order_id, lineUid: row.line_uid, locationId: row.location_id, squareVariationId: row.square_variation_id, itemName: row.item_name, variationName: row.variation_name, quantity: Number(row.quantity), returnedQuantity: Number(row.returned_quantity), netQuantity: Number(row.net_quantity), grossSalesCents: row.gross_sales_cents, discountCents: row.discount_cents, taxCents: row.tax_cents, netSalesCents: row.net_sales_cents, returnedNetCents: row.returned_net_cents, currency: row.currency, occurredAt: row.occurred_at, businessDate: row.business_date, source: row.source, ingestedAt: row.ingested_at };
}

function fromSalesSyncRun(row) {
  return { id: row.id, status: row.status, rangeStart: row.range_start, rangeEnd: row.range_end, startedBy: row.started_by, startedAt: row.started_at, completedAt: row.completed_at, ordersSeen: row.orders_seen || 0, ordersStored: row.orders_stored || 0, linesStored: row.lines_stored || 0, errorMessage: row.error_message };
}

function toSalesOrderRow(record) {
  return { order_id: record.orderId, location_id: record.locationId, state: record.state, source: record.source, total_cents: record.totalCents, tax_cents: record.taxCents, discount_cents: record.discountCents, refund_cents: record.refundCents, currency: record.currency, occurred_at: record.occurredAt, business_date: record.businessDate, square_updated_at: record.updatedAt, ingested_at: record.ingestedAt, raw_order: record.rawOrder };
}

function toSalesLineRow(record) {
  return { id: record.id, order_id: record.orderId, line_uid: record.lineUid, location_id: record.locationId, square_variation_id: record.squareVariationId, item_name: record.itemName, variation_name: record.variationName, quantity: record.quantity, returned_quantity: record.returnedQuantity, net_quantity: record.netQuantity, gross_sales_cents: record.grossSalesCents, discount_cents: record.discountCents, tax_cents: record.taxCents, net_sales_cents: record.netSalesCents, returned_net_cents: record.returnedNetCents, currency: record.currency, occurred_at: record.occurredAt, business_date: record.businessDate, source: record.source, ingested_at: record.ingestedAt };
}

function toSalesSyncRunRow(record) {
  return { id: record.id, status: record.status, range_start: record.rangeStart, range_end: record.rangeEnd, started_by: record.startedBy, started_at: record.startedAt, completed_at: record.completedAt, orders_seen: record.ordersSeen, orders_stored: record.ordersStored, lines_stored: record.linesStored, error_message: record.errorMessage };
}

function toInventorySnapshotRow(record) {
  return { id: record.id, square_variation_id: record.squareVariationId, location_id: record.locationId, snapshot_date: record.snapshotDate, quantity: record.quantity, captured_at: record.capturedAt, source: record.source };
}

function toBalanceRow(record, date) {
  return { square_variation_id: record.squareVariationId, location_id: record.locationId ?? null, quantity: finiteOrNull(record.quantity) ?? 0, reorder_point: finiteOrNull(record.reorderPoint), target_stock: finiteOrNull(record.targetStock), source: record.source || 'midway', last_counted_at: record.lastCountedAt ?? null, updated_at: date.toISOString() };
}

function fromVendorProduct(row) {
  return {
    id: row.id,
    vendorId: row.vendor_id,
    squareVariationId: row.square_variation_id,
    vendorSku: row.vendor_sku,
    casePack: row.case_pack,
    unitCostCents: row.unit_cost_cents,
  };
}

function nullablePositiveInteger(value, label) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw serviceError('VENDOR_MAPPING_INVALID', `${label} must be a whole number of 1 or more.`, 400);
  return number;
}

function nullableNonNegativeInteger(value, label) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) throw serviceError('VENDOR_MAPPING_INVALID', `${label} must be zero or more.`, 400);
  return number;
}

function optionalNonNegativeInteger(value, label) {
  if (value === undefined || value === null || value === '') return undefined;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw serviceError('INVENTORY_RULE_INVALID', `${label} must be zero or more.`, 400);
  return Math.round(number);
}

function finiteOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function slugify(value) {
  return String(value || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || crypto.randomUUID().slice(0, 8);
}

function safeFileName(value) {
  return String(value || 'upload').trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 160) || 'upload';
}

function definedOnly(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function chunks(items, size) {
  const output = [];
  for (let index = 0; index < items.length; index += size) output.push(items.slice(index, index + size));
  return output;
}

function compareNames(a, b) {
  return String(a.name || a.displayName || '').localeCompare(String(b.name || b.displayName || ''));
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function serviceError(code, message, statusCode) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}
