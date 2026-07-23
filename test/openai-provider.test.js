import test from 'node:test';
import assert from 'node:assert/strict';

import { createOpenAiProvider, toResponsesInput } from '../src/lib/ai-providers/openai-provider.js';

test('Responses API input preserves uploads and function-call continuation', () => {
  const input = toResponsesInput([
    { role: 'system', content: 'Be helpful.' },
    {
      role: 'user',
      content: [
        { type: 'input_text', text: 'Count this delivery.' },
        { type: 'input_image', image_url: 'data:image/jpeg;base64,abc' },
        { type: 'input_file', filename: 'invoice.pdf', file_data: 'data:application/pdf;base64,xyz' },
      ],
    },
    { role: 'assistant', content: '', toolCalls: [{ id: 'call_1', name: 'list_inventory', arguments: { lowStockOnly: true } }] },
    { role: 'tool', toolCallId: 'call_1', content: { items: [] } },
  ]);

  assert.equal(input.length, 3);
  assert.equal(input[0].content[1].type, 'input_image');
  assert.equal(input[0].content[2].filename, 'invoice.pdf');
  assert.deepEqual(input[1], {
    type: 'function_call',
    call_id: 'call_1',
    name: 'list_inventory',
    arguments: '{"lowStockOnly":true}',
  });
  assert.deepEqual(input[2], {
    type: 'function_call_output',
    call_id: 'call_1',
    output: '{"items":[]}',
  });
});

test('Responses API input drops orphaned tool outputs from older conversations', () => {
  const input = toResponsesInput([
    { role: 'user', content: 'What is low on stock?' },
    { role: 'assistant', content: 'Nothing is low right now.' },
    // Orphan: persisted without the assistant toolCalls message (pre-fix data).
    { role: 'tool', toolCallId: 'call_orphan', toolName: 'list_inventory', content: '{"ok":true}' },
    { role: 'assistant', content: '', toolCalls: [{ id: 'call_ok', name: 'list_inventory', arguments: '{}' }] },
    { role: 'tool', toolCallId: 'call_ok', toolName: 'list_inventory', content: '{"ok":true}' },
  ]);

  const outputs = input.filter(item => item.type === 'function_call_output');
  assert.equal(outputs.length, 1);
  assert.equal(outputs[0].call_id, 'call_ok');
  const calls = input.filter(item => item.type === 'function_call');
  assert.equal(calls.length, 1);
});

test('placeholder OpenAI credentials keep chat safely disabled', async () => {
  const provider = createOpenAiProvider({ env: { OPENAI_API_KEY: 'your_openai_api_key_here' } });
  assert.match(provider.disabledReason, /not connected yet/);
  await assert.rejects(() => provider.runTurn(), /valid OpenAI API key/);
});

test('Responses API forwards text deltas while preserving the completed response', async () => {
  const requests = [];
  const response = {
    status: 'completed',
    output_text: 'Stock looks healthy.',
    output: [{ type: 'message', content: [{ type: 'output_text', text: 'Stock looks healthy.' }] }],
    usage: { input_tokens: 10, output_tokens: 4 },
  };
  const client = {
    responses: {
      async create(request) {
        requests.push(request);
        return (async function* events() {
          yield { type: 'response.created', response: { id: 'resp_1' } };
          yield { type: 'response.output_text.delta', delta: 'Stock looks ' };
          yield { type: 'response.output_text.delta', delta: 'healthy.' };
          yield { type: 'response.completed', response };
        }());
      },
    },
  };
  const deltas = [];
  const provider = createOpenAiProvider({ env: {}, client });
  const result = await provider.runTurn({
    messages: [{ role: 'user', content: 'How is stock?' }],
    onEvent: event => deltas.push(event),
  });

  assert.equal(requests[0].stream, true);
  assert.equal(requests[0].model, 'gpt-5.6-terra');
  assert.deepEqual(requests[0].reasoning, { effort: 'low' });
  assert.equal('temperature' in requests[0], false);
  assert.deepEqual(deltas, [
    { type: 'text_delta', delta: 'Stock looks ' },
    { type: 'text_delta', delta: 'healthy.' },
  ]);
  assert.equal(result.message.content, 'Stock looks healthy.');
  assert.deepEqual(result.toolCalls, []);
});

test('OpenAI model and reasoning effort can be tuned without code changes', async () => {
  const requests = [];
  const client = {
    responses: {
      async create(request) {
        requests.push(request);
        return (async function* events() {
          yield { type: 'response.completed', response: { status: 'completed', output_text: 'Ready.', output: [] } };
        }());
      },
    },
  };
  const provider = createOpenAiProvider({
    env: { OPENAI_MODEL: 'gpt-5.6-sol', OPENAI_REASONING_EFFORT: 'medium' },
    client,
  });
  await provider.runTurn({ messages: [{ role: 'user', content: 'Check everything.' }] });
  assert.equal(provider.defaultModel, 'gpt-5.6-sol');
  assert.deepEqual(requests[0].reasoning, { effort: 'medium' });
});

test('Responses API completes streamed function calls for the agent loop', async () => {
  const client = {
    responses: {
      async create() {
        return (async function* events() {
          yield {
            type: 'response.completed',
            response: {
              status: 'completed',
              output: [{ type: 'function_call', call_id: 'call_inventory', name: 'list_inventory', arguments: '{"lowStockOnly":true}' }],
            },
          };
        }());
      },
    },
  };
  const provider = createOpenAiProvider({ env: {}, client });
  const result = await provider.runTurn({ messages: [{ role: 'user', content: 'What is low?' }] });
  assert.equal(result.finishReason, 'tool_calls');
  assert.deepEqual(result.toolCalls[0], {
    id: 'call_inventory',
    name: 'list_inventory',
    arguments: { lowStockOnly: true },
  });
});

test('toResponsesInput synthesizes outputs for interrupted (orphaned) tool calls', async () => {
  const { toResponsesInput } = await import('../src/lib/ai-providers/openai-provider.js');
  const input = toResponsesInput([
    { role: 'user', content: 'add the items' },
    {
      role: 'assistant',
      content: '',
      toolCalls: [
        { id: 'call-answered', name: 'list_inventory', arguments: {} },
        { id: 'call-orphan', name: 'create_square_item', arguments: { name: 'Snickers' } },
      ],
    },
    { role: 'tool', toolCallId: 'call-answered', content: '{"ok":true}' },
    { role: 'user', content: 'proceed' },
  ]);
  const outputs = input.filter(item => item.type === 'function_call_output');
  assert.equal(outputs.length, 2, 'the orphaned call gets a synthesized output');
  const orphanOutput = outputs.find(item => item.call_id === 'call-orphan');
  assert.match(orphanOutput.output, /Not executed/);
  const calls = input.filter(item => item.type === 'function_call');
  assert.equal(calls.length, 2);
});
