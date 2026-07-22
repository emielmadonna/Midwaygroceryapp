import dotenv from 'dotenv';
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

dotenv.config({ path: path.join(__dirname, '.env'), quiet: true });
dotenv.config({ path: path.join(__dirname, '.env.local'), override: true, quiet: true });

const app = express();
const port = process.env.MIDWAY_API_PORT || 3001;
const host = process.env.HOST || '127.0.0.1';
const localStore = createLocalStore(process.env);

assertProductionRuntime(process.env);

app.use(cors());
app.use(express.json({
  limit: '8mb',
  verify: (req, _res, buffer) => {
    req.rawBody = buffer.toString('utf8');
  },
}));

app.use('/api', createApiRouter({ store: localStore }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));

app.get('/manage', (_req, res) => {
  res.sendFile(path.join(__dirname, 'manage.html'));
});

app.use((_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(port, host, () => {
  console.log(`Midway public API is running on http://${host}:${port}`);
});

function createLocalStore(env) {
  if (env.NODE_ENV === 'production') return null;
  if (getSupabaseServerConfig(env).configured && env.MIDWAY_ALLOW_MEMORY_STORE !== 'true') return null;

  const localEnv = env.MIDWAY_ALLOW_MEMORY_STORE === 'true'
    ? {
        ...env,
        SUPABASE_URL: '',
        NEXT_PUBLIC_SUPABASE_URL: '',
        VITE_SUPABASE_URL: '',
        SUPABASE_SERVICE_ROLE_KEY: '',
        SUPABASE_ANON_KEY: '',
        VITE_SUPABASE_ANON_KEY: '',
        SQUARE_ACCESS_TOKEN: '',
      }
    : env;

  return createMidwayHarness({
    env: localEnv,
    tenantConfig: createTenantConfig({
      tenantId: 'midway',
      locationId: 'plain',
      business: {
        name: 'Midway Gas & Grocery',
        publicBrandName: 'Midway Gas & Grocery',
        phone: '(509) 596-1076',
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
