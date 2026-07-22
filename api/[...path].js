import express from 'express';

import { createApiRouter } from '../src/api/routes.js';
import { createMidwayHarness } from '../src/lib/midway-harness.js';
import { getSupabaseServerConfig } from '../src/lib/supabase-server.js';
import { createTenantConfig } from '../src/lib/tenant-config.js';

const app = express();
// Production must fail loudly if Supabase is ever missing. A serverless
// in-memory fallback would lose bookings, credentials, and command-center work
// whenever Vercel starts a new function instance.
const runtimeEnv = { ...process.env };
const hasSupabase = getSupabaseServerConfig(runtimeEnv).configured;
const store = createMidwayHarness({
  env: runtimeEnv,
  ...(hasSupabase ? {} : { tenantConfig: createFallbackTenantConfig() }),
});
const router = createApiRouter({ store, env: runtimeEnv });

app.use(express.json({
  limit: '30mb',
  verify: (req, _res, buffer) => {
    req.rawBody = buffer.toString('utf8');
  },
}));
app.use('/api', router);
app.use('/', router);

export default app;

function createFallbackTenantConfig() {
  return createTenantConfig({
    tenantId: 'midway',
    locationId: 'plain',
    business: {
      name: 'Midway Gas & Grocery',
      publicBrandName: 'Midway Gas & Grocery',
      phone: '(509) 596-1076',
      address: '14193 Chiwawa Loop RD, Leavenworth, WA 98826',
      timezone: 'America/Los_Angeles',
      instagramHandle: 'midwaygrocer',
      instagramUrl: 'https://www.instagram.com/midwaygrocer/',
    },
    publicSite: {
      theme: 'midway_farmhouse',
      instagramPosts: [],
      sections: [
        {
          key: 'instagram',
          enabled: true,
          title: 'Fresh from Midway.',
          copy: 'Live updates from the Midway Instagram account.',
          items: [],
        },
      ],
    },
    providers: {
      square: {
        status: 'not_connected',
        environment: 'sandbox',
      },
    },
  });
}
