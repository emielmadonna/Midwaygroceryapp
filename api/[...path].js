import express from 'express';

import { createApiRouter } from '../src/api/routes.js';
import { createMidwayHarness } from '../src/lib/midway-harness.js';
import { getSupabaseServerConfig } from '../src/lib/supabase-server.js';
import { createTenantConfig } from '../src/lib/tenant-config.js';

const app = express();
const runtimeEnv = {
  ...process.env,
  MIDWAY_ALLOW_MEMORY_STORE: process.env.MIDWAY_ALLOW_MEMORY_STORE || 'true',
};
const hasSupabase = getSupabaseServerConfig(runtimeEnv).configured;
const store = createMidwayHarness({
  env: runtimeEnv,
  ...(hasSupabase ? {} : { tenantConfig: createFallbackTenantConfig() }),
});
const router = createApiRouter({ store, env: runtimeEnv });

app.use(express.json({
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
      phone: '(509) 669-9378',
      address: '14193 US-2, Leavenworth, WA 98826',
      timezone: 'America/Los_Angeles',
      instagramHandle: 'midwayplain',
    },
    publicSite: {
      theme: 'midway_farmhouse',
      instagramPosts: [],
    },
    providers: {
      square: {
        status: 'not_connected',
        environment: 'sandbox',
      },
    },
  });
}
