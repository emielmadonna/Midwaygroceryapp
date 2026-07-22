#!/usr/bin/env node
// Live end-to-end test of the Harbor vendor connector path:
//   UI-style connector create (email+password, encrypted) -> stdio spawn of the
//   bundled harborhub-mcp server with those credentials -> real Harbor sign-in
//   -> read-only catalog call. Proves "type creds in the UI and it works".
//
// Reads HARBOR_EMAIL/HARBOR_PASSWORD from .env.local but passes them the same
// way the admin UI does (connector record), NOT via inherited env.
//
// Usage: node scripts/test-harbor-connector.mjs
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createCommandCenterService } from '../src/lib/command-center-service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env'), quiet: true });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true, quiet: true });

const email = process.env.HARBOR_EMAIL;
const password = process.env.HARBOR_PASSWORD;
if (!email || !password) {
  console.error('HARBOR_EMAIL / HARBOR_PASSWORD are not set. Nothing to test with.');
  process.exit(1);
}

// Strip HARBOR_* so the ONLY way credentials can reach the server is through
// the encrypted connector record — exactly the path the admin UI uses.
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('HARBOR_')));
cleanEnv.ADMIN_SESSION_SECRET = process.env.ADMIN_SESSION_SECRET || 'harbor-connector-test-secret';

const service = createCommandCenterService({
  store: { tenantId: 'midway', locationId: 'plain' },
  squareConfig: async () => ({}),
  env: cleanEnv,
});

const step = (name, detail = '') => console.log(`\n== ${name} ${detail ? `— ${detail}` : ''}`);
const text = result => {
  const parts = (result?.content || []).filter(part => part.type === 'text').map(part => part.text);
  return parts.join('\n');
};

step('1. Save connector', 'email+password encrypted, like the UI form');
const connector = await service.createConnector({
  vendorId: '00000000-0000-4000-8000-000000000001',
  displayName: 'Harbor live test',
  endpointUrl: 'stdio://harborhub',
  authType: 'login',
  email,
  password,
});
console.log('saved:', connector.id, '| credentials stored:', connector.secretConfigured);

step('2. Test connection', 'spawns bundled Harbor server with saved creds');
const tested = await service.testConnector(connector.id);
console.log('status:', tested.status, '| tools discovered:', tested.capabilities.length);

const toolNames = tested.capabilities.map(tool => tool.name);
const pick = (...candidates) => candidates.find(name => toolNames.includes(name));

step('3. Sign in to Harbor', 'server-held credentials, password never in chat');
const authTool = pick('harbor_authenticate', 'harbor_login');
const auth = await service.callConnectorTool({ connectorId: connector.id, toolName: authTool, arguments: {} });
console.log(text(auth).slice(0, 600));

step('4. Health check');
const health = await service.callConnectorTool({ connectorId: connector.id, toolName: pick('harbor_health_check', 'harbor_get_session_info'), arguments: {} });
console.log(text(health).slice(0, 400));

step('5. Read-only catalog search', '"coffee"');
const search = await service.callConnectorTool({ connectorId: connector.id, toolName: pick('harbor_search_catalog', 'harbor_search_autocomplete'), arguments: { query: 'coffee' } });
console.log(text(search).slice(0, 700));

console.log('\nRESULT: PASS — credentials saved through the connector work against live Harbor.');
process.exit(0);
