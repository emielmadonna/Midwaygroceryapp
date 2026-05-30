export function registerXeroTools(registry, { xeroService, env } = {}) {
  if (!registry) throw new Error('Registry is required.');
  if (!xeroService) throw new Error('Xero service is required.');

  const requestOptions = () => ({
    clientId: env?.XERO_CLIENT_ID || '',
    clientSecret: env?.XERO_CLIENT_SECRET || '',
  });

  registry.register({
    name: 'xero_status',
    description: 'Check the Xero connection status and which Xero organization is linked.',
    requiredScope: 'read',
    requiredFlag: 'accounting.summaries',
    sideEffect: 'read',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    handler: async () => xeroService.getStatus(),
  });

  registry.register({
    name: 'xero_search_contacts',
    description: 'Search Xero contacts (customers) by name or email substring.',
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
      const where = `Name.ToLower().Contains("${input.query.toLowerCase().replace(/"/g, '')}") OR EmailAddress.ToLower().Contains("${input.query.toLowerCase().replace(/"/g, '')}")`;
      const data = await xeroService.request({ method: 'GET', path: '/Contacts', query: { where }, ...requestOptions() });
      return data?.Contacts ?? [];
    },
  });

  registry.register({
    name: 'xero_list_invoices',
    description: 'List recent Xero invoices. Defaults to the latest 20.',
    requiredScope: 'read',
    requiredFlag: 'accounting.summaries',
    sideEffect: 'read',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 100 },
        status: { type: 'string', enum: ['DRAFT', 'SUBMITTED', 'AUTHORISED', 'PAID', 'VOIDED'] },
      },
    },
    handler: async ({ input }) => {
      const query = {};
      if (input.status) query.where = `Status=="${input.status}"`;
      const data = await xeroService.request({ method: 'GET', path: '/Invoices', query, ...requestOptions() });
      const invoices = data?.Invoices ?? [];
      return invoices.slice(0, input.limit || 20);
    },
  });

  registry.register({
    name: 'xero_create_invoice',
    description: 'Create a per-booking sales invoice in Xero. Provide the customer (contactId OR name + email), line items, and the booking reference.',
    requiredScope: 'write',
    requiredFlag: 'accounting.summaries',
    sideEffect: 'mutation',
    auditTarget: { type: 'xero_invoice', id: 'midway' },
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['contact', 'lineItems'],
      properties: {
        contact: {
          type: 'object',
          additionalProperties: false,
          properties: {
            contactId: { type: 'string' },
            name: { type: 'string' },
            email: { type: 'string' },
          },
        },
        lineItems: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['description', 'unitAmount'],
            properties: {
              description: { type: 'string', minLength: 1 },
              quantity: { type: 'number', minimum: 0 },
              unitAmount: { type: 'number', minimum: 0 },
              accountCode: { type: 'string' },
              taxType: { type: 'string' },
              itemCode: { type: 'string' },
            },
          },
        },
        date: { type: 'string' },
        dueDate: { type: 'string' },
        reference: { type: 'string', maxLength: 120 },
        status: { type: 'string', enum: ['DRAFT', 'SUBMITTED', 'AUTHORISED'] },
      },
    },
    handler: async ({ input, dryRun }) => {
      const payload = {
        Type: 'ACCREC',
        Contact: input.contact.contactId
          ? { ContactID: input.contact.contactId }
          : { Name: input.contact.name, EmailAddress: input.contact.email },
        LineItems: input.lineItems.map(line => ({
          Description: line.description,
          Quantity: line.quantity ?? 1,
          UnitAmount: line.unitAmount,
          AccountCode: line.accountCode,
          TaxType: line.taxType,
          ItemCode: line.itemCode,
        })),
        Date: input.date,
        DueDate: input.dueDate,
        Reference: input.reference,
        Status: input.status || 'AUTHORISED',
      };
      if (dryRun) return { dryRun: true, wouldExecute: { tool: 'xero_create_invoice', payload } };
      const data = await xeroService.request({
        method: 'POST',
        path: '/Invoices',
        body: { Invoices: [payload] },
        ...requestOptions(),
      });
      return data?.Invoices?.[0] ?? data;
    },
  });

  registry.register({
    name: 'xero_record_payment',
    description: 'Apply a payment to an existing Xero invoice. Use after Square confirms a booking payment.',
    requiredScope: 'write',
    requiredFlag: 'accounting.summaries',
    sideEffect: 'mutation',
    auditTarget: { type: 'xero_payment', id: 'midway' },
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['invoiceId', 'accountId', 'amount'],
      properties: {
        invoiceId: { type: 'string', minLength: 1 },
        accountId: { type: 'string', minLength: 1 },
        amount: { type: 'number', minimum: 0 },
        date: { type: 'string' },
        reference: { type: 'string', maxLength: 120 },
      },
    },
    handler: async ({ input, dryRun }) => {
      const payload = {
        Invoice: { InvoiceID: input.invoiceId },
        Account: { AccountID: input.accountId },
        Amount: input.amount,
        Date: input.date,
        Reference: input.reference,
      };
      if (dryRun) return { dryRun: true, wouldExecute: { tool: 'xero_record_payment', payload } };
      const data = await xeroService.request({
        method: 'POST',
        path: '/Payments',
        body: { Payments: [payload] },
        ...requestOptions(),
      });
      return data?.Payments?.[0] ?? data;
    },
  });

  registry.register({
    name: 'xero_get_pl_summary',
    description: 'Fetch a profit-and-loss summary from Xero for a date range.',
    requiredScope: 'read',
    requiredFlag: 'accounting.summaries',
    sideEffect: 'read',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['fromDate', 'toDate'],
      properties: {
        fromDate: { type: 'string' },
        toDate: { type: 'string' },
      },
    },
    handler: async ({ input }) => {
      return xeroService.request({
        method: 'GET',
        path: '/Reports/ProfitAndLoss',
        query: { fromDate: input.fromDate, toDate: input.toDate },
        ...requestOptions(),
      });
    },
  });

  return registry;
}
