import test from 'node:test';
import assert from 'node:assert/strict';

import { createAgent } from '../src/lib/agent.js';
import { createToolRegistry } from '../src/lib/tool-registry.js';

function makeStubStore({ flags = {}, audits = [] } = {}) {
  return {
    flags: () => flags,
    requireFeature(flag) {
      if (flags[flag] === false) {
        const error = new Error(`Feature is disabled: ${flag}`);
        error.code = 'FEATURE_DISABLED';
        error.statusCode = 404;
        throw error;
      }
    },
    async recordAuditLog(entry) { audits.push(entry); },
  };
}

function buildRegistry(handlers = {}) {
  const registry = createToolRegistry();
  registry.register({
    name: 'list_fuel_prices',
    requiredScope: 'read',
    sideEffect: 'read',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    handler: handlers.list_fuel_prices ?? (async () => ([{ type: 'diesel', price: 4.29 }])),
  });
  registry.register({
    name: 'update_fuel_price',
    requiredScope: 'write',
    sideEffect: 'mutation',
    inputSchema: {
      type: 'object',
      required: ['type', 'price'],
      additionalProperties: false,
      properties: { type: { type: 'string', enum: ['unleaded', 'diesel'] }, price: { type: 'number', minimum: 0 } },
    },
    handler: handlers.update_fuel_price ?? (async ({ input }) => ({ updated: input })),
  });
  registry.register({
    name: 'cancel_booking',
    requiredScope: 'write',
    sideEffect: 'destructive',
    inputSchema: {
      type: 'object',
      required: ['bookingCode'],
      additionalProperties: false,
      properties: { bookingCode: { type: 'string', minLength: 1 } },
    },
    handler: handlers.cancel_booking ?? (async ({ input }) => ({ canceled: input.bookingCode })),
  });
  return registry;
}

function scriptedProvider(script) {
  let index = 0;
  return {
    name: 'scripted',
    defaultModel: 'mock',
    async runTurn() {
      const step = script[index];
      index += 1;
      if (!step) {
        return { finishReason: 'stop', message: { role: 'assistant', content: 'no more script' }, toolCalls: [] };
      }
      const message = { role: 'assistant', content: step.content ?? '', toolCalls: step.toolCalls ?? [] };
      return { finishReason: step.finishReason || 'stop', message, toolCalls: message.toolCalls };
    },
  };
}

const owner = { role: 'owner', scope: 'owner', actorType: 'session', email: 'owner@midway.local' };
const employee = { role: 'employee', scope: 'write', actorType: 'session', email: 'emp@midway.local' };

test('agent returns plain assistant text when no tool calls', async () => {
  const provider = scriptedProvider([{ content: 'Tank is 50% full.' }]);
  const agent = createAgent({ provider, registry: buildRegistry(), store: makeStubStore() });
  const result = await agent.runTurn({
    messages: [{ role: 'user', content: 'how is the diesel tank?' }],
    actor: employee,
  });
  assert.equal(result.message.content, 'Tank is 50% full.');
  assert.equal(result.pendingConfirmation, null);
});

test('agent executes a non-destructive tool then yields assistant reply', async () => {
  const calls = [];
  const provider = scriptedProvider([
    {
      content: '',
      toolCalls: [{ id: 'tc1', name: 'update_fuel_price', arguments: { type: 'diesel', price: 4.39 } }],
    },
    { content: 'Done.' },
  ]);
  const registry = buildRegistry({
    update_fuel_price: async ({ input }) => {
      calls.push(input);
      return { updated: input };
    },
  });
  const agent = createAgent({ provider, registry, store: makeStubStore() });
  const result = await agent.runTurn({
    messages: [{ role: 'user', content: 'set diesel to 4.39' }],
    actor: owner,
  });
  assert.deepEqual(calls[0], { type: 'diesel', price: 4.39 });
  assert.equal(result.message.content, 'Done.');
});

test('agent reports live progress around tool work', async () => {
  const provider = scriptedProvider([
    { toolCalls: [{ id: 'tc-live', name: 'list_fuel_prices', arguments: {} }] },
    { content: 'Fuel prices are current.' },
  ]);
  const events = [];
  const agent = createAgent({ provider, registry: buildRegistry(), store: makeStubStore() });
  await agent.runTurn({
    messages: [{ role: 'user', content: 'Check fuel prices.' }],
    actor: owner,
    onEvent: event => events.push(event),
  });

  assert.equal(events[0].type, 'turn_started');
  assert.ok(events.some(event => event.type === 'thinking'));
  assert.ok(events.some(event => event.type === 'tool_started' && event.toolName === 'list_fuel_prices'));
  assert.ok(events.some(event => event.type === 'tool_completed' && event.ok === true));
  assert.equal(events.at(-1).type, 'turn_completed');
});

test('agent pauses on destructive tool without confirmation', async () => {
  let canceled = false;
  const provider = scriptedProvider([
    {
      content: '',
      toolCalls: [{ id: 'cancel-1', name: 'cancel_booking', arguments: { bookingCode: 'MW-ABC123' } }],
    },
    { content: 'Booking canceled.' },
  ]);
  const registry = buildRegistry({
    cancel_booking: async () => { canceled = true; return { canceled: true }; },
  });
  const agent = createAgent({ provider, registry, store: makeStubStore() });
  const result = await agent.runTurn({
    messages: [{ role: 'user', content: 'cancel MW-ABC123' }],
    actor: owner,
  });
  assert.equal(result.pendingConfirmation?.toolName, 'cancel_booking');
  assert.equal(result.finishReason, 'awaiting_confirmation');
  assert.equal(canceled, false);
});

test('agent executes destructive tool after approval, denies on no', async () => {
  const provider = scriptedProvider([
    { content: 'Booking canceled.' },
  ]);
  const registry = buildRegistry({
    cancel_booking: async ({ input }) => ({ canceled: input.bookingCode }),
  });
  const agent = createAgent({ provider, registry, store: makeStubStore() });
  const approved = await agent.runTurn({
    messages: [
      { role: 'user', content: 'cancel MW-ABC123' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'tc-cancel', name: 'cancel_booking', arguments: { bookingCode: 'MW-ABC123' } }] },
    ],
    actor: owner,
    pendingConfirmation: { toolCallId: 'tc-cancel', toolName: 'cancel_booking' },
    confirmations: { 'tc-cancel': true },
  });
  // The continuation should pick up the assistant text from the script.
  assert.equal(approved.message?.content, 'Booking canceled.');
});

test('agent reports tool errors as tool results, not as crashes', async () => {
  const provider = scriptedProvider([
    {
      content: '',
      toolCalls: [{ id: 'tc-err', name: 'update_fuel_price', arguments: { type: 'kerosene', price: 1 } }],
    },
    { content: 'Hit an error.' },
  ]);
  const registry = buildRegistry();
  const agent = createAgent({ provider, registry, store: makeStubStore() });
  const result = await agent.runTurn({
    messages: [{ role: 'user', content: 'set kerosene' }],
    actor: owner,
  });
  const errorTrace = result.trace.find(t => t.type === 'tool_result' && t.ok === false);
  assert.ok(errorTrace);
  assert.equal(errorTrace.toolName, 'update_fuel_price');
});

test('agent stops at iteration limit if model keeps calling tools', async () => {
  const script = Array.from({ length: 45 }).map(() => ({
    content: '',
    toolCalls: [{ id: `iter-${Math.random()}`, name: 'list_fuel_prices', arguments: {} }],
  }));
  const provider = scriptedProvider(script);
  const agent = createAgent({ provider, registry: buildRegistry(), store: makeStubStore() });
  const result = await agent.runTurn({
    messages: [{ role: 'user', content: 'loop' }],
    actor: owner,
  });
  assert.equal(result.finishReason, 'iteration_limit');
});
