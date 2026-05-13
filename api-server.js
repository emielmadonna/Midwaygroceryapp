import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApiRouter } from './src/api/routes.js';
import { createMidwayHarness } from './src/lib/midway-harness.js';
import { assertProductionRuntime } from './src/lib/production-config.js';
import { getSupabaseServerConfig } from './src/lib/supabase-server.js';
import { createTenantConfig } from './src/lib/tenant-config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = process.env.MIDWAY_API_PORT || 3001;
const host = process.env.HOST || '127.0.0.1';
const localStore = createLocalStore(process.env);

assertProductionRuntime(process.env);

app.use(cors());
app.use(express.json({
  verify: (req, _res, buffer) => {
    req.rawBody = buffer.toString('utf8');
  },
}));

app.use('/api', createApiRouter({ store: localStore }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));

app.use((_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(port, host, () => {
  console.log(`Midway public API is running on http://${host}:${port}`);
});

function createLocalStore(env) {
  if (env.NODE_ENV === 'production') return null;
  if (getSupabaseServerConfig(env).enabled) return null;

  return createMidwayHarness({
    env,
    tenantConfig: createTenantConfig({
      tenantId: 'midway',
      locationId: 'plain',
      business: {
        name: 'Midway Gas & Grocery',
        publicBrandName: 'Midway Gas & Grocery',
        phone: '(509) 669-9378',
        address: '14193 Chiwawa Loop RD, Leavenworth, WA 98826',
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
    }),
  });
}
