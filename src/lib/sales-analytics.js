const DAY_MS = 24 * 60 * 60 * 1000;

export function normalizeSquareOrders(orders = [], { ingestedAt = new Date().toISOString(), timezone = 'America/Los_Angeles' } = {}) {
  const orderFacts = [];
  const lineFacts = [];
  for (const order of orders) {
    if (!order?.id || order.state !== 'COMPLETED') continue;
    const occurredAt = order.closed_at || order.updated_at || order.created_at;
    if (!occurredAt) continue;
    const businessDate = businessDateInTimezone(occurredAt, timezone);
    orderFacts.push({
      orderId: order.id,
      locationId: order.location_id || null,
      state: order.state,
      source: order.source?.name || order.source?.external_details?.source || order.source?.square_product || null,
      totalCents: moneyAmount(order.total_money),
      taxCents: moneyAmount(order.total_tax_money),
      discountCents: moneyAmount(order.total_discount_money),
      refundCents: sum(order.returns, item => moneyAmount(item.return_amounts?.total_money)),
      currency: order.total_money?.currency || 'USD',
      occurredAt,
      businessDate,
      updatedAt: order.updated_at || occurredAt,
      ingestedAt,
      rawOrder: order,
    });

    const returnsByLine = collectReturns(order.returns || []);
    for (const [index, line] of (order.line_items || []).entries()) {
      const lineUid = line.uid || `${line.catalog_object_id || 'custom'}-${index}`;
      const returned = returnsByLine.get(lineUid) || { quantity: 0, netCents: 0 };
      const quantity = decimal(line.quantity);
      const taxCents = moneyAmount(line.total_tax_money);
      const totalCents = moneyAmount(line.total_money);
      const netCents = Math.max(0, totalCents - taxCents);
      lineFacts.push({
        id: `${order.id}:${lineUid}`,
        orderId: order.id,
        lineUid,
        locationId: order.location_id || null,
        squareVariationId: line.catalog_object_id || null,
        itemName: line.name || 'Unnamed item',
        variationName: line.variation_name || null,
        quantity,
        returnedQuantity: returned.quantity,
        netQuantity: quantity - returned.quantity,
        grossSalesCents: moneyAmount(line.gross_sales_money),
        discountCents: moneyAmount(line.total_discount_money),
        taxCents,
        netSalesCents: netCents - returned.netCents,
        returnedNetCents: returned.netCents,
        currency: line.total_money?.currency || order.total_money?.currency || 'USD',
        occurredAt,
        businessDate,
        source: order.source?.name || order.source?.square_product || null,
        ingestedAt,
      });
    }
  }
  return { orders: orderFacts, lines: lineFacts };
}

export function buildSalesAnalytics({
  lines = [],
  days = 30,
  now = new Date(),
  lastSync = null,
  catalog = [],
  inventorySnapshots = [],
} = {}) {
  const safeDays = Math.max(7, Math.min(365, Number(days) || 30));
  const endDate = dateOnly(now);
  const periodStart = addDays(endDate, -(safeDays - 1));
  const previousStart = addDays(periodStart, -safeDays);
  const catalogById = new Map(catalog.map(item => [item.squareVariationId, item]));
  const normalized = lines.map(line => ({
    ...line,
    businessDate: line.businessDate || String(line.occurredAt || '').slice(0, 10),
    quantity: number(line.quantity),
    returnedQuantity: number(line.returnedQuantity),
    netQuantity: line.netQuantity === undefined ? number(line.quantity) - number(line.returnedQuantity) : number(line.netQuantity),
    netSalesCents: number(line.netSalesCents),
    returnedNetCents: number(line.returnedNetCents),
    catalog: catalogById.get(line.squareVariationId),
  })).filter(line => line.businessDate);
  const current = normalized.filter(line => line.businessDate >= periodStart && line.businessDate <= endDate);
  const previous = normalized.filter(line => line.businessDate >= previousStart && line.businessDate < periodStart);
  const daily = fillDays(periodStart, endDate, current);
  const previousDaily = fillDays(previousStart, addDays(periodStart, -1), previous);
  const topItems = rankItems(current, previous, catalogById);
  const dayOfWeek = weekdaySummary(current);
  const quality = salesDataQuality({ lines: normalized, lastSync, now, requestedDays: safeDays, inventorySnapshots });
  const forecast = forecastNextSevenDays(normalized, endDate, quality);
  const summary = summarize(current);
  const previousSummary = summarize(previous);

  return {
    generatedAt: now.toISOString(),
    period: { days: safeDays, from: periodStart, to: endDate },
    summary: {
      ...summary,
      revenueChangePercent: percentChange(summary.netSalesCents, previousSummary.netSalesCents),
      unitChangePercent: percentChange(summary.unitsSold, previousSummary.unitsSold),
      averageDailySalesCents: Math.round(summary.netSalesCents / safeDays),
      averageDailyUnits: round(summary.unitsSold / safeDays, 1),
    },
    previousSummary,
    daily,
    previousDaily,
    topItems,
    dayOfWeek,
    forecast,
    quality,
  };
}

function collectReturns(returns) {
  const result = new Map();
  for (const returned of returns) {
    for (const line of returned.return_line_items || []) {
      const uid = line.source_line_item_uid || line.uid;
      if (!uid) continue;
      const current = result.get(uid) || { quantity: 0, netCents: 0 };
      const total = moneyAmount(line.total_money);
      const tax = moneyAmount(line.total_tax_money);
      result.set(uid, { quantity: current.quantity + decimal(line.quantity), netCents: current.netCents + Math.max(0, total - tax) });
    }
  }
  return result;
}

function fillDays(from, to, lines) {
  const totals = new Map();
  for (const line of lines) {
    const value = totals.get(line.businessDate) || { netSalesCents: 0, unitsSold: 0, transactions: new Set() };
    value.netSalesCents += number(line.netSalesCents);
    value.unitsSold += number(line.netQuantity);
    if (line.orderId) value.transactions.add(line.orderId);
    totals.set(line.businessDate, value);
  }
  const result = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const value = totals.get(date) || { netSalesCents: 0, unitsSold: 0, transactions: new Set() };
    result.push({ date, netSalesCents: Math.round(value.netSalesCents), unitsSold: round(value.unitsSold, 2), transactions: value.transactions.size });
  }
  return result;
}

function rankItems(current, previous, catalogById) {
  const currentItems = groupItems(current);
  const previousItems = groupItems(previous);
  return [...currentItems.values()].sort((a, b) => b.netSalesCents - a.netSalesCents || b.unitsSold - a.unitsSold).slice(0, 50).map((item, index) => {
    const prior = previousItems.get(item.key) || {};
    const catalog = catalogById.get(item.squareVariationId);
    return {
      rank: index + 1,
      squareVariationId: item.squareVariationId,
      name: item.name,
      variationName: item.variationName,
      sku: catalog?.sku || null,
      category: catalog?.category || 'Uncategorized',
      unitsSold: round(item.unitsSold, 2),
      returnedUnits: round(item.returnedUnits, 2),
      netSalesCents: Math.round(item.netSalesCents),
      averagePriceCents: item.unitsSold > 0 ? Math.round(item.netSalesCents / item.unitsSold) : 0,
      salesChangePercent: percentChange(item.netSalesCents, prior.netSalesCents || 0),
      unitsChangePercent: percentChange(item.unitsSold, prior.unitsSold || 0),
      catalogMatched: Boolean(item.squareVariationId && catalog),
    };
  });
}

function groupItems(lines) {
  const result = new Map();
  for (const line of lines) {
    const key = line.squareVariationId || `name:${line.itemName}|${line.variationName || ''}`;
    const value = result.get(key) || { key, squareVariationId: line.squareVariationId || null, name: line.itemName, variationName: line.variationName || null, unitsSold: 0, returnedUnits: 0, netSalesCents: 0 };
    value.unitsSold += number(line.netQuantity);
    value.returnedUnits += number(line.returnedQuantity);
    value.netSalesCents += number(line.netSalesCents);
    result.set(key, value);
  }
  return result;
}

function weekdaySummary(lines) {
  const dates = new Map();
  for (const line of lines) {
    const value = dates.get(line.businessDate) || { netSalesCents: 0, unitsSold: 0 };
    value.netSalesCents += number(line.netSalesCents); value.unitsSold += number(line.netQuantity); dates.set(line.businessDate, value);
  }
  const weekdays = Array.from({ length: 7 }, (_, day) => ({ day, label: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][day], daysObserved: 0, netSalesCents: 0, unitsSold: 0 }));
  for (const [date, value] of dates) {
    const item = weekdays[new Date(`${date}T12:00:00Z`).getUTCDay()]; item.daysObserved += 1; item.netSalesCents += value.netSalesCents; item.unitsSold += value.unitsSold;
  }
  return weekdays.map(item => ({ ...item, averageSalesCents: item.daysObserved ? Math.round(item.netSalesCents / item.daysObserved) : 0, averageUnits: item.daysObserved ? round(item.unitsSold / item.daysObserved, 1) : 0 }));
}

function forecastNextSevenDays(lines, endDate, quality) {
  const byDate = new Map();
  for (const line of lines) {
    const value = byDate.get(line.businessDate) || { netSalesCents: 0, unitsSold: 0 };
    value.netSalesCents += number(line.netSalesCents); value.unitsSold += number(line.netQuantity); byDate.set(line.businessDate, value);
  }
  const dates = [...byDate.keys()].sort();
  const historyDays = dates.length ? Math.round((new Date(`${endDate}T00:00:00Z`) - new Date(`${dates[0]}T00:00:00Z`)) / DAY_MS) + 1 : 0;
  const daily = [];
  for (let offset = 1; offset <= 7; offset += 1) {
    const date = addDays(endDate, offset);
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    const samples = [...byDate.entries()].filter(([sampleDate]) => new Date(`${sampleDate}T12:00:00Z`).getUTCDay() === weekday && sampleDate <= endDate).sort(([a], [b]) => b.localeCompare(a)).map(([, value]) => value);
    const recent = samples.slice(0, 6);
    const weights = recent.map((_, index) => 1 / (index + 1));
    const denominator = sum(weights, value => value) || 1;
    daily.push({
      date,
      expectedSalesCents: Math.round(sum(recent, (value, index) => value.netSalesCents * weights[index]) / denominator),
      expectedUnits: round(sum(recent, (value, index) => value.unitsSold * weights[index]) / denominator, 1),
      samples: samples.length,
    });
  }
  const minimumHistoryDays = 56;
  return {
    ready: quality.score >= 70 && historyDays >= minimumHistoryDays && quality.stockoutCoveragePercent >= 50,
    confidence: historyDays >= 168 && quality.score >= 85 ? 'high' : historyDays >= minimumHistoryDays && quality.score >= 70 ? 'medium' : 'low',
    historyDays,
    minimumHistoryDays,
    totalExpectedSalesCents: sum(daily, day => day.expectedSalesCents),
    totalExpectedUnits: round(sum(daily, day => day.expectedUnits), 1),
    daily,
    note: historyDays < minimumHistoryDays ? `Keep collecting clean sales for ${minimumHistoryDays - historyDays} more ${minimumHistoryDays - historyDays === 1 ? 'day' : 'days'} before relying on forecasts.` : quality.stockoutCoveragePercent < 50 ? 'Keep collecting daily inventory snapshots so zero sales can be separated from out-of-stock days.' : quality.score < 70 ? 'Resolve the data-quality warnings before using this forecast for purchasing.' : 'Forecast uses recent same-weekday sales and should be combined with weather, events, stock-outs, and vendor lead times.',
  };
}

function salesDataQuality({ lines, lastSync, now, requestedDays, inventorySnapshots = [] }) {
  const dated = lines.filter(line => line.businessDate).sort((a, b) => a.businessDate.localeCompare(b.businessDate));
  const mapped = lines.filter(line => line.squareVariationId && line.catalog).length;
  const named = lines.filter(line => line.itemName && line.itemName !== 'Unnamed item').length;
  const firstDate = dated[0]?.businessDate || null;
  const lastDate = dated.at(-1)?.businessDate || null;
  const historyDays = firstDate && lastDate ? Math.round((new Date(`${lastDate}T00:00:00Z`) - new Date(`${firstDate}T00:00:00Z`)) / DAY_MS) + 1 : 0;
  const syncDate = lastSync?.completedAt || lastSync?.completed_at || lastSync?.createdAt || lastSync?.created_at || null;
  const freshnessHours = syncDate ? Math.max(0, (now - new Date(syncDate)) / 3_600_000) : Infinity;
  const catalogCoverage = lines.length ? mapped / lines.length : 0;
  const namingCoverage = lines.length ? named / lines.length : 0;
  const historyCoverage = Math.min(1, historyDays / Math.max(90, requestedDays));
  const freshnessCoverage = freshnessHours <= 26 ? 1 : freshnessHours <= 72 ? 0.65 : freshnessHours <= 168 ? 0.35 : 0;
  const snapshotDays = new Set(inventorySnapshots.map(item => item.snapshotDate || item.snapshot_date).filter(Boolean)).size;
  const stockoutCoverage = Math.min(1, snapshotDays / Math.min(Math.max(historyDays, 1), 90));
  const score = Math.round(catalogCoverage * 30 + namingCoverage * 10 + historyCoverage * 25 + freshnessCoverage * 20 + stockoutCoverage * 15);
  const warnings = [];
  if (!lines.length) warnings.push('No item-level Square order history has been synced yet.');
  if (catalogCoverage < 0.9 && lines.length) warnings.push(`${Math.round((1 - catalogCoverage) * 100)}% of sales lines are not linked to a Square catalog item.`);
  if (historyDays < 56 && lines.length) warnings.push(`Only ${historyDays} days of history are available; forecasts need at least 56.`);
  if (freshnessHours > 26) warnings.push(syncDate ? 'Sales history is more than a day old.' : 'No successful sales-history sync is recorded.');
  if (stockoutCoverage < 0.5) warnings.push('Daily inventory history is still building, so stock-outs cannot yet be fully separated from low demand.');
  return {
    score,
    status: score >= 85 ? 'strong' : score >= 70 ? 'usable' : score >= 45 ? 'building' : 'needs_attention',
    rows: lines.length,
    firstDate,
    lastDate,
    historyDays,
    catalogCoveragePercent: Math.round(catalogCoverage * 100),
    namingCoveragePercent: Math.round(namingCoverage * 100),
    freshnessHours: Number.isFinite(freshnessHours) ? round(freshnessHours, 1) : null,
    lastSyncAt: syncDate,
    inventorySnapshotDays: snapshotDays,
    stockoutCoveragePercent: Math.round(stockoutCoverage * 100),
    warnings,
  };
}

function summarize(lines) {
  const orders = new Set(lines.map(line => line.orderId).filter(Boolean));
  return { netSalesCents: Math.round(sum(lines, line => line.netSalesCents)), unitsSold: round(sum(lines, line => line.netQuantity), 2), returnedUnits: round(sum(lines, line => line.returnedQuantity), 2), returnValueCents: Math.round(sum(lines, line => line.returnedNetCents)), transactions: orders.size, averageTicketCents: orders.size ? Math.round(sum(lines, line => line.netSalesCents) / orders.size) : 0 };
}

function percentChange(current, previous) { if (!previous) return current ? null : 0; return round(((current - previous) / Math.abs(previous)) * 100, 1); }
function moneyAmount(value) { return number(value?.amount); }
function decimal(value) { const parsed = Number.parseFloat(value); return Number.isFinite(parsed) ? parsed : 0; }
function number(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
function sum(items = [], selector = value => value) { return items.reduce((total, item, index) => total + number(selector(item, index)), 0); }
function round(value, places = 0) { const factor = 10 ** places; return Math.round(number(value) * factor) / factor; }
function dateOnly(value) { return (value instanceof Date ? value : new Date(value)).toISOString().slice(0, 10); }
function addDays(value, amount) { const date = new Date(`${value}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + amount); return date.toISOString().slice(0, 10); }
function businessDateInTimezone(value, timezone) { const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value)); const byType = Object.fromEntries(parts.map(part => [part.type, part.value])); return `${byType.year}-${byType.month}-${byType.day}`; }
