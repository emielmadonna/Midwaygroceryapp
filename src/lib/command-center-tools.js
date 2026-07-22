export function registerCommandCenterTools(registry, { commandCenter } = {}) {
  if (!registry || !commandCenter) throw new Error('Command center tools require a registry and service.');

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
    name: 'list_vendors',
    description: 'List every store vendor and how orders are currently placed.',
    requiredScope: 'read',
    sideEffect: 'read',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    handler: () => commandCenter.listVendors(),
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
