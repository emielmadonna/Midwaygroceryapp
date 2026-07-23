import { createVendorMappingSweep } from './vendor-mapping-sweep.js';

export function registerCommandCenterTools(registry, { commandCenter } = {}) {
  if (!registry || !commandCenter) throw new Error('Command center tools require a registry and service.');
  const mappingSweep = createVendorMappingSweep({ commandCenter });

  registry.register({
    name: 'get_command_center_overview',
    description: 'Get the store command center summary: live Square sales, inventory exceptions, vendors, purchase orders, bookings, and urgent priorities.',
    requiredScope: 'read',
    sideEffect: 'read',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { refreshSquare: { type: 'boolean' } },
    },
    handler: ({ input }) => commandCenter.getOverview({ refreshSquare: input.refreshSquare !== false }),
  });

  registry.register({
    name: 'list_inventory',
    description: 'Search the Square-backed store inventory and show quantities, low-stock status, reorder rules, and mapped vendor information.',
    requiredScope: 'read',
    sideEffect: 'read',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        search: { type: 'string' },
        lowStockOnly: { type: 'boolean' },
        limit: { type: 'integer', minimum: 1, maximum: 500 },
        live: { type: 'boolean', description: 'Refresh the Square catalog and inventory counts before returning results. Defaults to true.' },
      },
    },
    handler: ({ input }) => commandCenter.listInventory({ ...input, live: input.live !== false }),
  });

  registry.register({
    name: 'get_sales_analytics',
    description: 'Analyze item-level Square sales history, including top sellers, changes versus the prior period, returns, weekday patterns, forecast readiness, and data-quality warnings.',
    requiredScope: 'read',
    sideEffect: 'read',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { days: { type: 'integer', minimum: 7, maximum: 365 } },
    },
    handler: ({ input }) => commandCenter.getSalesAnalytics(input),
  });

  registry.register({
    name: 'sync_square_sales_history',
    description: 'Import completed Square orders and item-level sales into Midway history. This is idempotent and never changes Square data.',
    requiredScope: 'owner',
    sideEffect: 'mutation',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { days: { type: 'integer', minimum: 7, maximum: 730 } },
    },
    handler: ({ input, actor }) => commandCenter.syncSalesHistory({ ...input, actor }),
  });

  registry.register({
    name: 'create_square_item',
    description: 'Add a product to the live Square register — but ONLY for a product the store does not already carry. This tool first checks whether the item already exists (same barcode/UPC, or the same name); if it does, it UPDATES that existing item in place instead of creating a duplicate, and returns alreadyExisted: true. So use it for every product line on a delivery or invoice: brand-new products get a new record (a new item number is auto-assigned when none is given), and products already in the register are updated. Provide the barcode (upc) whenever you have it — it is the most reliable way to recognize an existing item. Give the price in cents and the starting on-hand quantity in individual sellable units when known.',
    requiredScope: 'owner',
    sideEffect: 'destructive',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['name'],
      properties: {
        name: { type: 'string', minLength: 1, description: 'The product name as it should appear on the register.' },
        description: { type: 'string' },
        priceCents: { type: ['integer', 'null'], minimum: 0, description: 'Selling price per individual unit in cents. Omit only if the price is genuinely unknown.' },
        sku: { type: 'string', description: 'Item number. Leave blank to auto-assign the next free number.' },
        upc: { type: 'string', description: 'The barcode (UPC/GTIN) if known, e.g. from an invoice or the vendor catalog. Strongly recommended — used to detect an item already in the register and avoid duplicates.' },
        categoryName: { type: 'string', description: 'Register category, e.g. Snacks, Beverages, Tobacco. Created automatically if it does not exist yet.' },
        initialQuantity: { type: ['integer', 'null'], minimum: 0, description: 'Starting on-hand stock in individual sellable units.' },
        forceCreate: { type: 'boolean', description: 'Leave unset for normal use. Set true ONLY to force a brand-new record when you are certain this is a distinct product that happens to share a name with an existing one (e.g. a different size or pack) and it has no matching barcode.' },
      },
    },
    handler: ({ input, actor }) => commandCenter.createCatalogItem({ ...input, actor }),
  });

  registry.register({
    name: 'update_square_item',
    description: 'Change a live Square register item: name, description, price, item number (SKU), barcode (UPC), or category. Only the fields provided are changed.',
    requiredScope: 'owner',
    sideEffect: 'destructive',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['squareVariationId'],
      properties: {
        squareVariationId: { type: 'string', minLength: 1, description: 'The Square variation id of the item, from list_inventory.' },
        name: { type: 'string' },
        description: { type: 'string' },
        priceCents: { type: 'integer', minimum: 0, description: 'New selling price per individual unit in cents.' },
        sku: { type: 'string' },
        upc: { type: 'string' },
        categoryName: { type: 'string' },
      },
    },
    handler: ({ input, actor }) => commandCenter.updateCatalogItem({ ...input, actor }),
  });

  registry.register({
    name: 'set_square_item_stock',
    description: 'Set the current on-hand quantity of one item directly in Square (a physical count), in individual sellable units. For counting many items at once, prefer create_inventory_reconciliation so the owner can review first.',
    requiredScope: 'owner',
    sideEffect: 'destructive',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['squareVariationId', 'quantity'],
      properties: {
        squareVariationId: { type: 'string', minLength: 1, description: 'The Square variation id of the item, from list_inventory.' },
        quantity: { type: 'integer', minimum: 0, description: 'On-hand quantity in individual sellable units.' },
      },
    },
    handler: ({ input, actor }) => commandCenter.setItemStock({ ...input, actor }),
  });

  registry.register({
    name: 'delete_square_item',
    description: 'Permanently remove an item (and all its variations) from the live Square register. This cannot be undone — restate the exact item first and wait for approval.',
    requiredScope: 'owner',
    sideEffect: 'destructive',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['squareItemId'],
      properties: {
        squareItemId: { type: 'string', minLength: 1, description: 'The Square ITEM id (squareItemId from list_inventory), not the variation id.' },
      },
    },
    handler: ({ input, actor }) => commandCenter.deleteCatalogItem({ ...input, actor }),
  });

  registry.register({
    name: 'call_square_read_api',
    description: 'Look up anything in the connected Square account with a GET request to any Square API v2 endpoint — payments, orders, customers, invoices, discounts, taxes, team members, locations, loyalty, gift cards, and more. Example paths: /v2/payments, /v2/customers, /v2/catalog/list, /v2/team-members. Never guess ids — list first.',
    requiredScope: 'owner',
    sideEffect: 'read',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['path'],
      properties: {
        path: { type: 'string', minLength: 4, description: 'The Square API path starting with /v2/, including any query string.' },
      },
    },
    handler: ({ input }) => commandCenter.callSquareApi({ method: 'GET', path: input.path, readOnly: true }),
  });

  registry.register({
    name: 'call_square_api',
    description: 'Call any Square API v2 endpoint that changes something (POST/PUT/DELETE) — create discounts, taxes, customers, orders, invoices, gift cards, and every other Square capability. Always requires explicit owner approval. For plain lookups use call_square_read_api instead.',
    requiredScope: 'owner',
    sideEffect: 'destructive',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['method', 'path'],
      properties: {
        method: { type: 'string', enum: ['POST', 'PUT', 'DELETE'], description: 'The HTTP method.' },
        path: { type: 'string', minLength: 4, description: 'The Square API path starting with /v2/.' },
        body: { type: 'object', additionalProperties: true, properties: {}, description: 'The JSON request body, following Square API v2 conventions (snake_case fields, money as {amount, currency}, include idempotency_key where the endpoint requires one).' },
      },
    },
    handler: ({ input }) => commandCenter.callSquareApi(input),
  });

  registry.register({
    name: 'list_vendors',
    description: 'List every store vendor and how orders are currently placed.',
    requiredScope: 'read',
    sideEffect: 'read',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    handler: () => commandCenter.listVendors(),
  });

  registry.register({
    name: 'map_item_to_vendor',
    description: 'Record which vendor supplies a store item, with the vendor\'s SKU/item number, case pack, and cost. Each item keeps one vendor mapping, so mapping again replaces the old one. Before mapping a Harbor item, look it up in the live catalog first (call_vendor_read_tool with harbor_get_product or harbor_search_by_item_number) and read its BuyingOptions for the real pack size and per-unit price instead of guessing.',
    requiredScope: 'write',
    sideEffect: 'mutation',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['squareVariationId', 'vendorId'],
      properties: {
        squareVariationId: { type: 'string', minLength: 1, description: 'The Square variation id of the store item, from list_inventory.' },
        vendorId: { type: 'string', minLength: 1, description: 'The vendor UUID from list_vendors (not the vendor name).' },
        vendorSku: { type: 'string', description: 'The vendor\'s own SKU or item number for this product, e.g. a Harbor item number.' },
        casePack: { type: 'integer', minimum: 1, description: 'How many individual sellable units come in one vendor case/carton — e.g. a cigarette carton is 10 packs. From the vendor catalog BuyingOptions.' },
        unitCostCents: { type: 'integer', minimum: 0, description: 'Cost per INDIVIDUAL sellable unit in cents, not per case. If the catalog only shows a case price, divide by the case pack first.' },
      },
    },
    handler: ({ input }) => commandCenter.mapVendorProduct(input),
  });

  registry.register({
    name: 'unmap_item_from_vendor',
    description: 'Remove the saved vendor mapping from a store item, e.g. when the store stops buying it from that vendor.',
    requiredScope: 'write',
    sideEffect: 'mutation',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['squareVariationId'],
      properties: {
        squareVariationId: { type: 'string', minLength: 1, description: 'The Square variation id of the store item, from list_inventory.' },
      },
    },
    handler: ({ input }) => commandCenter.unmapVendorProduct(input),
  });

  registry.register({
    name: 'propose_vendor_mappings',
    description: 'Scan Square items and match them to the vendor\'s catalog by barcode (UPC), returning proposed mappings with pack sizes and per-unit costs for the owner to review. Nothing is saved — pass the reviewed proposals to apply_vendor_mappings to save them.',
    requiredScope: 'owner',
    sideEffect: 'read',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        vendorId: { type: 'string', minLength: 1, description: 'The vendor UUID from list_vendors. Optional when only one vendor connection exists.' },
        limit: { type: 'integer', minimum: 1, maximum: 50, description: 'How many items to look up in the vendor catalog this sweep. Defaults to 25.' },
        onlyUnmapped: { type: 'boolean', description: 'Skip items that already have a vendor mapping. Defaults to true.' },
      },
    },
    handler: ({ input }) => mappingSweep.propose(input),
  });

  registry.register({
    name: 'apply_vendor_mappings',
    description: 'Save vendor mappings the owner has reviewed from propose_vendor_mappings. This writes vendor/SKU/case-pack/cost records for each item and always requires explicit approval.',
    requiredScope: 'owner',
    sideEffect: 'destructive',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['vendorId', 'proposals'],
      properties: {
        vendorId: { type: 'string', minLength: 1, description: 'The vendor UUID from list_vendors (not the vendor name).' },
        proposals: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            additionalProperties: true,
            required: ['squareVariationId'],
            properties: {
              squareVariationId: { type: 'string', minLength: 1 },
              vendorItemId: { type: 'string', description: 'The vendor\'s item number, saved as the mapping\'s vendor SKU.' },
              casePack: { type: ['integer', 'null'], description: 'Individual sellable units per vendor case/carton.' },
              unitCostCents: { type: ['integer', 'null'], description: 'Cost per individual sellable unit in cents.' },
            },
          },
        },
      },
    },
    handler: ({ input }) => mappingSweep.apply(input),
  });

  registry.register({
    name: 'set_inventory_rule',
    description: 'Set when an item counts as running low (reorderPoint) and how many to stock up to (targetStock), in individual sellable units. If the owner states a rule in cases or cartons, convert to individual units first using the item\'s case pack. Omit a value to leave it unchanged.',
    requiredScope: 'write',
    sideEffect: 'mutation',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['squareVariationId'],
      properties: {
        squareVariationId: { type: 'string', minLength: 1, description: 'The Square variation id of the store item, from list_inventory.' },
        reorderPoint: { type: ['integer', 'null'], minimum: 0, description: 'The item shows as running low once on-hand quantity is at or below this many individual units.' },
        targetStock: { type: ['integer', 'null'], minimum: 0, description: 'How many individual units to stock back up to when reordering.' },
      },
    },
    handler: ({ input }) => commandCenter.updateInventoryRule(input),
  });

  registry.register({
    name: 'draft_vendor_reorder',
    description: 'Create a draft purchase order for a vendor using low-stock items and saved target quantities. This creates a draft only and does not send the order.',
    requiredScope: 'owner',
    sideEffect: 'mutation',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['vendorId'],
      properties: {
        vendorId: { type: 'string', minLength: 1 },
        notes: { type: 'string' },
        items: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['name', 'quantity'],
            properties: {
              squareVariationId: { type: 'string' },
              name: { type: 'string', minLength: 1 },
              vendorSku: { type: 'string' },
              quantity: { type: 'integer', minimum: 1 },
              casePack: { type: 'integer', minimum: 1 },
              unitCostCents: { type: 'integer', minimum: 0 },
            },
          },
        },
      },
    },
    handler: ({ input }) => commandCenter.draftReorder(input),
  });

  registry.register({
    name: 'list_vendor_mcp_tools',
    description: 'Discover the tools exposed by an approved vendor MCP connection. connectorId also accepts a vendor name like "Harbor", or can be omitted when only one vendor is connected.',
    requiredScope: 'owner',
    sideEffect: 'read',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { connectorId: { type: 'string', minLength: 1 } },
    },
    handler: ({ input }) => commandCenter.listConnectorTools(input.connectorId),
  });

  registry.register({
    name: 'call_vendor_read_tool',
    description: 'Call a read-only vendor tool (search, browse, get, list, validate — e.g. Harbor catalog search or price checks). Rejected for anything that could change vendor data; use call_vendor_mcp_tool for those. connectorId also accepts a vendor name like "Harbor", or can be omitted when only one vendor is connected.',
    requiredScope: 'owner',
    sideEffect: 'read',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['toolName'],
      properties: {
        connectorId: { type: 'string', minLength: 1 },
        toolName: { type: 'string', minLength: 1 },
        arguments: { type: 'object', additionalProperties: true, properties: {} },
      },
    },
    handler: ({ input }) => commandCenter.callConnectorTool({ ...input, readOnly: true }),
  });

  registry.register({
    name: 'list_inventory_reconciliations',
    description: 'List recent physical inventory counts and whether each one is still waiting for review or has been applied to Square.',
    requiredScope: 'read',
    sideEffect: 'read',
    inputSchema: { type: 'object', additionalProperties: false, properties: { limit: { type: 'integer', minimum: 1, maximum: 100 } } },
    handler: ({ input }) => commandCenter.listReconciliations(input),
  });

  registry.register({
    name: 'create_inventory_reconciliation',
    description: 'Create a reviewable physical-count reconciliation from counted inventory. This does not change Square until it is explicitly applied.',
    requiredScope: 'write',
    sideEffect: 'mutation',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['lines'],
      properties: {
        notes: { type: 'string' },
        lines: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['squareVariationId', 'countedQuantity'],
            properties: {
              squareVariationId: { type: 'string', minLength: 1 },
              countedQuantity: { type: 'integer', minimum: 0 },
            },
          },
        },
      },
    },
    handler: ({ input, actor }) => commandCenter.createReconciliation({ ...input, actor }),
  });

  registry.register({
    name: 'apply_inventory_reconciliation',
    description: 'Apply a reviewed physical inventory count to Square and close the reconciliation. This changes live Square inventory and always requires explicit approval.',
    requiredScope: 'owner',
    sideEffect: 'destructive',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['reconciliationId'],
      properties: { reconciliationId: { type: 'string', minLength: 1 } },
    },
    handler: ({ input, actor }) => commandCenter.applyReconciliation({ ...input, actor }),
  });

  registry.register({
    name: 'call_vendor_mcp_tool',
    description: 'Call a vendor tool that can change something (carts, orders, lists, prices). Always requires explicit owner approval. For read-only lookups prefer call_vendor_read_tool. connectorId also accepts a vendor name like "Harbor", or can be omitted when only one vendor is connected.',
    requiredScope: 'owner',
    sideEffect: 'destructive',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['toolName'],
      properties: {
        connectorId: { type: 'string', minLength: 1 },
        toolName: { type: 'string', minLength: 1 },
        arguments: { type: 'object', additionalProperties: true, properties: {} },
      },
    },
    handler: ({ input }) => commandCenter.callConnectorTool(input),
  });

  return registry;
}
