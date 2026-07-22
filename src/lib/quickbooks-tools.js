export function registerQuickBooksTools(registry, { quickbooksService, env } = {}) {
  if (!registry) throw new Error('Registry is required.');
  if (!quickbooksService) throw new Error('QuickBooks service is required.');

  const requestOptions = () => ({
    clientId: env?.QUICKBOOKS_CLIENT_ID || '',
    clientSecret: env?.QUICKBOOKS_CLIENT_SECRET || '',
  });

  const escapeQueryValue = value => String(value).replace(/'/g, "\\'");

  registry.register({
    name: 'qbo_status',
    description: 'Check whether QuickBooks is connected and which company file is linked.',
    requiredScope: 'read',
    requiredFlag: 'accounting.summaries',
    sideEffect: 'read',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    handler: async () => quickbooksService.getStatus(),
  });

  registry.register({
    name: 'qbo_search_customers',
    description: 'Look up customers in QuickBooks by name. Great for finding the right customer before invoicing.',
    requiredScope: 'read',
    requiredFlag: 'accounting.summaries',
    sideEffect: 'read',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['query'],
      properties: {
        query: { type: 'string', minLength: 1, maxLength: 80 },
      },
    },
    handler: async ({ input }) => {
      const sql = `select * from Customer where DisplayName like '%${escapeQueryValue(input.query)}%' maxresults 20`;
      const data = await quickbooksService.request({
        method: 'GET',
        path: '/query',
        query: { query: sql },
        ...requestOptions(),
      });
      return data?.QueryResponse?.Customer ?? [];
    },
  });

  registry.register({
    name: 'qbo_list_invoices',
    description: 'List recent invoices from QuickBooks, newest first. Optionally filter by customer or how much is still owed.',
    requiredScope: 'read',
    requiredFlag: 'accounting.summaries',
    sideEffect: 'read',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        customerId: { type: 'string', minLength: 1 },
        status: { type: 'string', enum: ['open', 'paid'] },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
      },
    },
    handler: async ({ input }) => {
      const clauses = [];
      if (input.customerId) clauses.push(`CustomerRef = '${escapeQueryValue(input.customerId)}'`);
      if (input.status === 'open') clauses.push('Balance > \'0\'');
      if (input.status === 'paid') clauses.push('Balance = \'0\'');
      const where = clauses.length ? ` where ${clauses.join(' and ')}` : '';
      const sql = `select * from Invoice${where} orderby TxnDate desc maxresults ${input.limit || 20}`;
      const data = await quickbooksService.request({
        method: 'GET',
        path: '/query',
        query: { query: sql },
        ...requestOptions(),
      });
      return data?.QueryResponse?.Invoice ?? [];
    },
  });

  registry.register({
    name: 'qbo_list_bills',
    description: 'List recent vendor bills from QuickBooks, newest first. Shows what the store owes suppliers.',
    requiredScope: 'read',
    requiredFlag: 'accounting.summaries',
    sideEffect: 'read',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 100 },
      },
    },
    handler: async ({ input }) => {
      const sql = `select * from Bill orderby TxnDate desc maxresults ${input.limit || 20}`;
      const data = await quickbooksService.request({
        method: 'GET',
        path: '/query',
        query: { query: sql },
        ...requestOptions(),
      });
      return data?.QueryResponse?.Bill ?? [];
    },
  });

  registry.register({
    name: 'qbo_get_pl_summary',
    description: 'Get a simple profit and loss summary from QuickBooks: income, expenses, and net profit for a date range. Defaults to the current month.',
    requiredScope: 'read',
    requiredFlag: 'accounting.summaries',
    sideEffect: 'read',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        startDate: { type: 'string' },
        endDate: { type: 'string' },
      },
    },
    handler: async ({ input }) => {
      const now = new Date();
      const startDate = input.startDate || `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
      const endDate = input.endDate || now.toISOString().slice(0, 10);
      const report = await quickbooksService.request({
        method: 'GET',
        path: '/reports/ProfitAndLoss',
        query: { start_date: startDate, end_date: endDate },
        ...requestOptions(),
      });
      return summarizeProfitAndLoss(report, { startDate, endDate });
    },
  });

  registry.register({
    name: 'qbo_create_invoice',
    description: 'Create a new invoice in QuickBooks for a customer. Provide the customer id and the line items to bill.',
    requiredScope: 'write',
    requiredFlag: 'accounting.summaries',
    sideEffect: 'destructive',
    auditTarget: { type: 'quickbooks_invoice', id: 'midway' },
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['customerId', 'lineItems'],
      properties: {
        customerId: { type: 'string', minLength: 1 },
        lineItems: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['description', 'amount'],
            properties: {
              description: { type: 'string', minLength: 1 },
              amount: { type: 'number', minimum: 0 },
              itemId: { type: 'string' },
            },
          },
        },
      },
    },
    handler: async ({ input, dryRun }) => {
      const payload = {
        CustomerRef: { value: input.customerId },
        Line: input.lineItems.map(line => ({
          Amount: line.amount,
          DetailType: 'SalesItemLineDetail',
          SalesItemLineDetail: { ItemRef: { value: line.itemId || '1' } },
          Description: line.description,
        })),
      };
      if (dryRun) return { dryRun: true, wouldExecute: { tool: 'qbo_create_invoice', payload } };
      const data = await quickbooksService.request({
        method: 'POST',
        path: '/invoice',
        body: payload,
        ...requestOptions(),
      });
      return data?.Invoice ?? data;
    },
  });

  registry.register({
    name: 'qbo_record_payment',
    description: 'Record a customer payment in QuickBooks and apply it to an existing invoice. Use after money actually comes in.',
    requiredScope: 'write',
    requiredFlag: 'accounting.summaries',
    sideEffect: 'destructive',
    auditTarget: { type: 'quickbooks_payment', id: 'midway' },
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['customerId', 'invoiceId', 'amount'],
      properties: {
        customerId: { type: 'string', minLength: 1 },
        invoiceId: { type: 'string', minLength: 1 },
        amount: { type: 'number', minimum: 0 },
      },
    },
    handler: async ({ input, dryRun }) => {
      const payload = {
        TotalAmt: input.amount,
        CustomerRef: { value: input.customerId },
        Line: [
          {
            Amount: input.amount,
            LinkedTxn: [{ TxnId: input.invoiceId, TxnType: 'Invoice' }],
          },
        ],
      };
      if (dryRun) return { dryRun: true, wouldExecute: { tool: 'qbo_record_payment', payload } };
      const data = await quickbooksService.request({
        method: 'POST',
        path: '/payment',
        body: payload,
        ...requestOptions(),
      });
      return data?.Payment ?? data;
    },
  });

  registry.register({
    name: 'qbo_query',
    description: 'Run any QuickBooks Online query (their SQL-like syntax) to look up any entity: Item, Account, Vendor, Bill, Purchase, JournalEntry, Employee, TimeActivity, and more. Example: "select * from Account where AccountType = \'Income\' maxresults 50".',
    requiredScope: 'read',
    requiredFlag: 'accounting.summaries',
    sideEffect: 'read',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['query'],
      properties: {
        query: { type: 'string', minLength: 10, maxLength: 500, description: 'The QuickBooks query, e.g. select * from Item maxresults 100.' },
      },
    },
    handler: async ({ input }) => {
      const data = await quickbooksService.request({
        method: 'GET',
        path: '/query',
        query: { query: input.query },
        ...requestOptions(),
      });
      return data?.QueryResponse ?? data;
    },
  });

  registry.register({
    name: 'qbo_api_request',
    description: 'Call any QuickBooks Online API endpoint that changes something — create or update bills, vendors, items, journal entries, purchases, and every other QuickBooks capability. Always requires explicit owner approval. Path is relative to the company, e.g. /bill, /vendor, /journalentry. For lookups use qbo_query instead.',
    requiredScope: 'owner',
    requiredFlag: 'accounting.summaries',
    sideEffect: 'destructive',
    auditTarget: { type: 'quickbooks_api', id: 'midway' },
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['path', 'body'],
      properties: {
        path: { type: 'string', minLength: 2, maxLength: 120, description: 'The QuickBooks entity path, e.g. /bill or /item.' },
        body: { type: 'object', additionalProperties: true, properties: {}, description: 'The JSON payload, following QuickBooks Online API conventions.' },
      },
    },
    handler: async ({ input }) => {
      const cleanPath = String(input.path || '').trim();
      if (!/^\/[a-z][a-z0-9/-]*$/i.test(cleanPath) || cleanPath.toLowerCase().startsWith('/query')) {
        throw Object.assign(new Error('The QuickBooks path must be a simple entity path like /bill.'), { code: 'QBO_PATH_INVALID', statusCode: 400 });
      }
      return quickbooksService.request({
        method: 'POST',
        path: cleanPath,
        body: input.body,
        ...requestOptions(),
      });
    },
  });

  return registry;
}

function summarizeProfitAndLoss(report, { startDate, endDate }) {
  const totals = {};
  collectSummaryRows(report?.Rows?.Row, totals);
  return {
    startDate,
    endDate,
    currency: report?.Header?.Currency ?? null,
    totalIncome: totals['Total Income'] ?? totals['Total Revenue'] ?? null,
    grossProfit: totals['Gross Profit'] ?? null,
    totalCostOfSales: totals['Total Cost of Goods Sold'] ?? null,
    totalExpenses: totals['Total Expenses'] ?? null,
    netIncome: totals['Net Income'] ?? totals['Net Earnings'] ?? null,
  };
}

function collectSummaryRows(rows, totals) {
  if (!Array.isArray(rows)) return;
  for (const row of rows) {
    const summary = row?.Summary?.ColData;
    if (Array.isArray(summary) && summary[0]?.value) {
      const amount = Number(summary[summary.length - 1]?.value);
      totals[summary[0].value] = Number.isFinite(amount) ? amount : null;
    }
    collectSummaryRows(row?.Rows?.Row, totals);
  }
}
