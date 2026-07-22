// Auto-mapping sweep: bulk-propose vendor mappings by matching the Square
// catalog against the live Harbor wholesale catalog by UPC, so the owner can
// review a batch instead of mapping items one by one. Proposals are pure
// reads; nothing is saved until apply() is called with the reviewed list.

const UPC_PATTERN = /^\d{8,14}$/;

export function createVendorMappingSweep({ commandCenter } = {}) {
  if (!commandCenter) throw new Error('Vendor mapping sweep requires the command center service.');

  async function propose({ vendorId = null, limit = 25, onlyUnmapped = true } = {}) {
    const cap = clampInteger(limit, 1, 50, 25);
    const inventory = await commandCenter.listInventory({ limit: 1000 });
    const skipped = [];
    const candidates = [];
    for (const item of inventory ?? []) {
      const upc = normalizeUpc(item.sku);
      if (!upc) {
        skipped.push({ name: item.name, reason: 'no_upc' });
        continue;
      }
      if (onlyUnmapped && item.vendorId) {
        skipped.push({ name: item.name, reason: 'already_mapped' });
        continue;
      }
      candidates.push({ squareVariationId: item.squareVariationId, name: item.name, upc });
    }

    const proposals = [];
    let scannedCount = 0;
    // Sequential on purpose: the vendor MCP fronts a live wholesale portal,
    // so a parallel burst of catalog lookups would hammer it.
    for (const item of candidates.slice(0, cap)) {
      scannedCount += 1;
      let search;
      try {
        search = await callVendorTool(vendorId, 'harbor_search_by_upc', { upc: item.upc });
      } catch (error) {
        skipped.push({ name: item.name, upc: item.upc, reason: 'search_failed', error: errorMessage(error) });
        continue;
      }
      const match = findExactUpcMatch(search, item.upc);
      if (!match) {
        skipped.push({ name: item.name, upc: item.upc, reason: 'no_exact_upc_match' });
        continue;
      }
      const vendorItemId = firstString(match.ItemID, match.ItemId, match.itemId, match.ItemNumber, match.itemNumber);
      if (!vendorItemId) {
        skipped.push({ name: item.name, upc: item.upc, reason: 'match_missing_item_id' });
        continue;
      }
      let casePack = null;
      let unitCostCents = null;
      try {
        const product = await callVendorTool(vendorId, 'harbor_get_product', { itemId: vendorItemId });
        ({ casePack, unitCostCents } = deriveCaseTerms(extractBuyingOptions(product)));
      } catch {
        // The exact-UPC match still stands; the owner just reviews the
        // proposal without pack/cost details rather than losing it.
      }
      proposals.push({
        squareVariationId: item.squareVariationId,
        name: item.name,
        upc: item.upc,
        vendorItemId,
        vendorDescription: firstString(match.ItemDescription, match.itemDescription, match.Description) ?? null,
        brand: firstString(match.BrandName, match.brandName, match.Brand) ?? null,
        casePack,
        unitCostCents,
        confidence: 'exact_upc',
      });
    }

    return { proposals, skipped, scannedCount };
  }

  async function apply({ vendorId, proposals = [] } = {}) {
    const vendorRef = String(vendorId || '').trim();
    if (!vendorRef) throw new Error('Choose which vendor these mappings belong to.');
    if (!Array.isArray(proposals) || !proposals.length) throw new Error('Pass the reviewed proposals to save.');
    const failures = [];
    let mappedCount = 0;
    for (const proposal of proposals) {
      try {
        await commandCenter.mapVendorProduct({
          squareVariationId: proposal.squareVariationId,
          vendorId: vendorRef,
          vendorSku: proposal.vendorItemId ?? null,
          casePack: proposal.casePack ?? null,
          unitCostCents: proposal.unitCostCents ?? null,
        });
        mappedCount += 1;
      } catch (error) {
        failures.push({
          squareVariationId: proposal.squareVariationId ?? null,
          name: proposal.name ?? null,
          error: errorMessage(error),
        });
      }
    }
    return { requestedCount: proposals.length, mappedCount, failedCount: failures.length, failures };
  }

  async function callVendorTool(vendorId, toolName, args) {
    const result = await commandCenter.callConnectorTool({
      ...(vendorId ? { connectorId: vendorId } : {}),
      toolName,
      arguments: args,
      readOnly: true,
    });
    return parseVendorPayload(result, toolName);
  }

  return { propose, apply };
}

// Vendor MCP tool results come back as { content: [{ type: 'text', text: '<json>' }] }
// where the JSON is { success, data } or { success: false, error }. Everything
// here is untrusted vendor output, so parse defensively.
export function parseVendorPayload(result, toolName = 'vendor tool') {
  if (result?.isError) throw new Error(`${toolName} failed: ${mcpText(result) || 'vendor tool error'}`);
  const text = mcpText(result);
  if (!text) throw new Error(`${toolName} returned no readable payload.`);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${toolName} returned a payload that is not valid JSON.`);
  }
  if (parsed && typeof parsed === 'object' && 'success' in parsed) {
    if (!parsed.success) throw new Error(`${toolName} failed: ${errorMessage(parsed.error) || 'unknown vendor error'}`);
    return parsed.data ?? null;
  }
  return parsed;
}

export function findExactUpcMatch(data, upc) {
  const wanted = digitsOnly(upc);
  if (!wanted) return null;
  const items = Array.isArray(data) ? data : (data?.Items ?? data?.items ?? []);
  if (!Array.isArray(items)) return null;
  return items.find(item => {
    const candidate = digitsOnly(item?.RetailUPC ?? item?.retailUpc ?? item?.UPC ?? item?.upc);
    // UPCs travel with inconsistent leading zeros (UPC-A vs EAN-13 padding),
    // so compare the zero-stripped digits — still an exact-barcode match.
    return Boolean(candidate) && stripLeadingZeros(candidate) === stripLeadingZeros(wanted);
  }) ?? null;
}

export function extractBuyingOptions(product) {
  const options = product?.BuyingOptions ?? product?.buyingOptions
    ?? product?.Item?.BuyingOptions ?? product?.Product?.BuyingOptions
    ?? (Array.isArray(product?.Items) ? product.Items[0]?.BuyingOptions : null);
  return Array.isArray(options) ? options : [];
}

// Derive the case pack (retail units per case/carton) and the per-unit cost in
// cents from a Harbor BuyingOptions breakdown. When the payload is ambiguous
// or non-numeric, return nulls — a wrong pack size or cost is worse than none.
export function deriveCaseTerms(options) {
  const byCode = code => options.find(option => String(option?.code ?? option?.Code ?? '').toUpperCase() === code);
  const byName = pattern => options.find(option => pattern.test(String(option?.name ?? option?.Name ?? '')));
  const caseOption = byCode('CS') ?? byCode('CT') ?? byName(/\bcase\b/i) ?? byName(/\bcarton\b/i);
  if (!caseOption) return { casePack: null, unitCostCents: null };

  const retailUnits = finitePositive(caseOption.retailUnits ?? caseOption.RetailUnits);
  const casePack = retailUnits !== null && Number.isInteger(retailUnits) ? retailUnits : null;

  const perUnitDollars = finitePositive(caseOption.pricePerRetailUnit ?? caseOption.PricePerRetailUnit);
  const casePriceDollars = finitePositive(caseOption.unitPrice ?? caseOption.UnitPrice);
  let unitCostCents = null;
  if (perUnitDollars !== null) {
    unitCostCents = Math.round(perUnitDollars * 100);
  } else if (casePriceDollars !== null && casePack !== null) {
    unitCostCents = Math.round((casePriceDollars / casePack) * 100);
  }
  return { casePack, unitCostCents };
}

function normalizeUpc(sku) {
  const digits = String(sku ?? '').trim();
  return UPC_PATTERN.test(digits) ? digits : null;
}

function mcpText(result) {
  const content = Array.isArray(result?.content) ? result.content : [];
  const entry = content.find(part => part?.type === 'text' && typeof part.text === 'string');
  return entry?.text ?? null;
}

function digitsOnly(value) {
  return String(value ?? '').replace(/\D/g, '');
}

function stripLeadingZeros(value) {
  return value.replace(/^0+/, '') || '0';
}

function firstString(...values) {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text) return text;
  }
  return null;
}

function finitePositive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function clampInteger(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(number)));
}

function errorMessage(error) {
  if (error == null) return '';
  if (typeof error === 'string') return error;
  return error.message ?? JSON.stringify(error);
}
