const PACIFIC_TIMEZONE = 'America/Los_Angeles';
const DAY_MS = 24 * 60 * 60 * 1000;

export function createQuickBooksDailySales({ quickbooksService, commandCenter, env = process.env, now = () => new Date() } = {}) {
  if (!quickbooksService) throw new Error('QuickBooks daily sales requires a quickbooksService.');
  if (!commandCenter) throw new Error('QuickBooks daily sales requires a commandCenter.');

  const requestOptions = () => ({
    clientId: env?.QUICKBOOKS_CLIENT_ID || '',
    clientSecret: env?.QUICKBOOKS_CLIENT_SECRET || '',
  });

  const yesterdayPacific = () => new Intl.DateTimeFormat('en-CA', {
    timeZone: PACIFIC_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(now().getTime() - DAY_MS));

  const centsToDollars = cents => Number((Number(cents || 0) / 100).toFixed(2));

  return {
    async postDailySales({ businessDate = null } = {}) {
      const targetDate = businessDate || yesterdayPacific();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
        throw new Error('businessDate must be formatted YYYY-MM-DD.');
      }

      const status = await quickbooksService.getStatus();
      if (!status?.connected) {
        return { status: 'skipped', reason: 'quickbooks_not_connected', businessDate: targetDate };
      }

      const totals = await commandCenter.getDailySalesTotals({ businessDate: targetDate });
      if (!totals?.orders) {
        return { status: 'skipped', reason: 'no_sales', businessDate: targetDate };
      }

      const marker = `midway-daily-sales:${targetDate}`;
      const existing = await quickbooksService.request({
        method: 'GET',
        path: '/query',
        query: { query: `select * from SalesReceipt where TxnDate = '${targetDate}'` },
        ...requestOptions(),
      });
      const receipts = existing?.QueryResponse?.SalesReceipt ?? [];
      const alreadyPosted = receipts.find(receipt => String(receipt?.PrivateNote || '').includes(marker));
      if (alreadyPosted) {
        return { status: 'skipped', reason: 'already_posted', businessDate: targetDate, receiptId: alreadyPosted.Id ?? null };
      }

      const taxCents = Number(totals.taxCents || 0);
      const netSalesCents = Math.max(0, Number(totals.netCents || 0) - taxCents);
      const lines = [{
        Amount: centsToDollars(netSalesCents),
        DetailType: 'SalesItemLineDetail',
        SalesItemLineDetail: { ItemRef: { value: '1' } },
        Description: 'Daily store sales (net)',
      }];
      if (taxCents > 0) {
        lines.push({
          Amount: centsToDollars(taxCents),
          DetailType: 'SalesItemLineDetail',
          SalesItemLineDetail: { ItemRef: { value: '1' } },
          Description: 'Sales tax collected',
        });
      }

      const created = await quickbooksService.request({
        method: 'POST',
        path: '/salesreceipt',
        body: {
          TxnDate: targetDate,
          Line: lines,
          PrivateNote: `${marker} · posted automatically from Square by Midway`,
        },
        ...requestOptions(),
      });

      return {
        status: 'posted',
        businessDate: targetDate,
        netCents: netSalesCents,
        taxCents,
        receiptId: created?.SalesReceipt?.Id ?? null,
      };
    },
  };
}
