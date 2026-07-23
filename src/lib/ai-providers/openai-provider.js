import OpenAI from 'openai';

const DEFAULT_MODEL = 'gpt-5.6-terra';
const DEFAULT_REASONING_EFFORT = 'low';

export function createOpenAiProvider({ env = process.env, model = null, reasoningEffort = null, client = null } = {}) {
  const apiKey = env?.OPENAI_API_KEY || env?.OPENAI_KEY || '';
  if (!client && (!apiKey || isPlaceholderApiKey(apiKey))) {
    return createDisabledProvider('The Midway assistant is not connected yet. Add a valid OpenAI API key to enable chat and file analysis.');
  }
  const apiClient = client || new OpenAI({
    apiKey,
    ...(env?.OPENAI_BASE_URL ? { baseURL: env.OPENAI_BASE_URL } : {}),
  });
  const resolvedModel = model || env?.OPENAI_MODEL || DEFAULT_MODEL;
  const resolvedReasoningEffort = normalizeReasoningEffort(reasoningEffort || env?.OPENAI_REASONING_EFFORT);

  return {
    name: 'openai',
    defaultModel: resolvedModel,
    reasoningEffort: resolvedReasoningEffort,
    async runTurn({ messages, tools = [], model: overrideModel = resolvedModel, temperature, reasoningEffort: overrideReasoningEffort = resolvedReasoningEffort, onEvent } = {}) {
      if (env?.OPENAI_API_MODE !== 'chat_completions') {
        const stream = await apiClient.responses.create({
          model: overrideModel,
          instructions: systemInstructions(messages),
          input: toResponsesInput(messages),
          tools: tools.length ? tools.map(toResponsesTool) : undefined,
          tool_choice: tools.length ? 'auto' : undefined,
          ...(isGpt56Model(overrideModel)
            ? { reasoning: { effort: normalizeReasoningEffort(overrideReasoningEffort) } }
            : { temperature: temperature ?? 0.2 }),
          store: false,
          stream: true,
        });
        let completedResponse = null;
        let streamedText = '';
        for await (const event of stream) {
          if (event.type === 'response.output_text.delta') {
            streamedText += event.delta || '';
            await emit(onEvent, { type: 'text_delta', delta: event.delta || '' });
          } else if (event.type === 'response.completed') {
            completedResponse = event.response;
          } else if (event.type === 'response.failed') {
            throw providerError(event.response?.error?.message || 'The AI response failed.');
          } else if (event.type === 'error') {
            throw providerError(event.message || event.error?.message || 'The AI stream failed.');
          }
        }
        if (!completedResponse) throw providerError('The AI stream ended before it completed.');
        return normalizeResponsesTurn(completedResponse, streamedText);
      }

      const stream = await apiClient.chat.completions.create({
        model: overrideModel,
        messages: toOpenAiMessages(messages),
        tools: tools.length ? tools.map(toOpenAiTool) : undefined,
        tool_choice: tools.length ? 'auto' : undefined,
        ...(isGpt56Model(overrideModel)
          ? { reasoning_effort: tools.length ? 'none' : normalizeReasoningEffort(overrideReasoningEffort) }
          : { temperature: temperature ?? 0.2 }),
        stream: true,
      });
      let content = '';
      let finishReason = 'stop';
      let usage;
      const toolCallParts = new Map();
      for await (const chunk of stream) {
        usage = chunk.usage || usage;
        const choice = chunk.choices?.[0];
        if (!choice) continue;
        finishReason = choice.finish_reason || finishReason;
        const delta = choice.delta?.content || '';
        if (delta) {
          content += delta;
          await emit(onEvent, { type: 'text_delta', delta });
        }
        for (const call of choice.delta?.tool_calls ?? []) {
          const key = call.index ?? call.id ?? toolCallParts.size;
          const current = toolCallParts.get(key) || { id: '', name: '', arguments: '' };
          current.id += call.id || '';
          current.name += call.function?.name || '';
          current.arguments += call.function?.arguments || '';
          toolCallParts.set(key, current);
        }
      }
      const toolCalls = [...toolCallParts.values()].map(call => ({
        id: call.id,
        name: call.name,
        arguments: safeJsonParse(call.arguments),
      }));
      const assistantMessage = {
        role: 'assistant',
        content,
        toolCalls,
      };
      return {
        finishReason: toolCalls.length ? 'tool_calls' : finishReason,
        message: assistantMessage,
        toolCalls,
        usage,
      };
    },
  };
}

function isGpt56Model(model) {
  return /^gpt-5\.6(?:-|$)/i.test(String(model || ''));
}

function normalizeReasoningEffort(value) {
  const normalized = String(value || DEFAULT_REASONING_EFFORT).trim().toLowerCase();
  return ['none', 'low', 'medium', 'high', 'xhigh', 'max'].includes(normalized)
    ? normalized
    : DEFAULT_REASONING_EFFORT;
}

function normalizeResponsesTurn(response, streamedText = '') {
  const toolCalls = (response.output ?? [])
    .filter(item => item.type === 'function_call')
    .map(call => ({
      id: call.call_id || call.id,
      name: call.name,
      arguments: safeJsonParse(call.arguments),
    }));
  const content = response.output_text || (response.output ?? [])
    .filter(item => item.type === 'message')
    .flatMap(item => item.content ?? [])
    .filter(item => item.type === 'output_text')
    .map(item => item.text || '')
    .join('\n') || streamedText;
  return {
    finishReason: toolCalls.length ? 'tool_calls' : (response.status || 'stop'),
    message: { role: 'assistant', content, toolCalls },
    toolCalls,
    usage: response.usage,
  };
}

async function emit(onEvent, event) {
  if (typeof onEvent === 'function') await onEvent(event);
}

function providerError(message) {
  const error = new Error(message);
  error.code = 'AI_STREAM_FAILED';
  error.statusCode = 502;
  return error;
}

function isPlaceholderApiKey(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return !normalized
    || normalized.includes('your_openai')
    || normalized.includes('replace_me')
    || normalized.includes('api_key_here')
    || normalized === 'sk-placeholder';
}

export function toResponsesInput(messages = []) {
  const input = [];
  // Tool outputs are only valid when their originating function_call is also in
  // the input; older persisted conversations stored orphans, so skip those.
  // The reverse also holds: every function_call needs an output, and a turn
  // interrupted mid-approval persists calls with no results — synthesize an
  // output for those so the whole conversation stays valid.
  const knownCallIds = new Set();
  const answeredCallIds = new Set();
  for (const message of messages) {
    if (message.role === 'assistant' && Array.isArray(message.toolCalls)) {
      for (const call of message.toolCalls) knownCallIds.add(call.id);
    }
    if (message.role === 'tool' && message.toolCallId) answeredCallIds.add(message.toolCallId);
  }
  for (const message of messages) {
    if (message.role === 'system') continue;
    if (message.role === 'tool') {
      if (!knownCallIds.has(message.toolCallId)) continue;
      input.push({
        type: 'function_call_output',
        call_id: message.toolCallId,
        output: typeof message.content === 'string' ? message.content : JSON.stringify(message.content),
      });
      continue;
    }
    if (message.role === 'assistant' && Array.isArray(message.toolCalls) && message.toolCalls.length) {
      if (message.content) input.push({ role: 'assistant', content: message.content });
      for (const call of message.toolCalls) {
        input.push({
          type: 'function_call',
          call_id: call.id,
          name: call.name,
          arguments: typeof call.arguments === 'string' ? call.arguments : JSON.stringify(call.arguments ?? {}),
        });
        if (!answeredCallIds.has(call.id)) {
          input.push({
            type: 'function_call_output',
            call_id: call.id,
            output: JSON.stringify({ ok: false, error: 'Not executed: this action was interrupted before it could run. Call the tool again if it is still needed.' }),
          });
        }
      }
      continue;
    }
    input.push({
      role: message.role,
      content: Array.isArray(message.content)
        ? message.content.map(toResponseContentPart).filter(Boolean)
        : (message.content ?? ''),
    });
  }
  return input;
}

function systemInstructions(messages = []) {
  return messages
    .filter(message => message.role === 'system')
    .map(message => typeof message.content === 'string' ? message.content : JSON.stringify(message.content))
    .join('\n\n');
}

function toResponseContentPart(part = {}) {
  if (part.type === 'text' || part.type === 'input_text') {
    return { type: 'input_text', text: part.text || '' };
  }
  if (part.type === 'image_url' || part.type === 'input_image') {
    const imageUrl = part.image_url?.url || part.image_url;
    if (!imageUrl) return null;
    return { type: 'input_image', image_url: imageUrl, detail: part.detail || part.image_url?.detail || 'auto' };
  }
  if (part.type === 'input_file' || part.type === 'file') {
    if (!part.file_data && !part.file_id && !part.file_url) return null;
    return {
      type: 'input_file',
      ...(part.filename ? { filename: part.filename } : {}),
      ...(part.file_data ? { file_data: part.file_data } : {}),
      ...(part.file_id ? { file_id: part.file_id } : {}),
      ...(part.file_url ? { file_url: part.file_url } : {}),
      ...(part.detail ? { detail: part.detail } : {}),
    };
  }
  return null;
}

function toResponsesTool(tool) {
  return {
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema || { type: 'object', properties: {} },
  };
}

function createDisabledProvider(reason) {
  return {
    name: 'openai',
    defaultModel: DEFAULT_MODEL,
    disabledReason: reason,
    async runTurn() {
      const error = new Error(reason);
      error.statusCode = 503;
      error.code = 'AI_PROVIDER_UNAVAILABLE';
      throw error;
    },
  };
}

function toOpenAiMessages(messages = []) {
  const knownCallIds = new Set();
  for (const message of messages) {
    if (message.role === 'assistant' && Array.isArray(message.toolCalls)) {
      for (const call of message.toolCalls) knownCallIds.add(call.id);
    }
  }
  return messages.map(message => {
    if (message.role === 'tool') {
      if (!knownCallIds.has(message.toolCallId)) return null;
      return {
        role: 'tool',
        tool_call_id: message.toolCallId,
        content: typeof message.content === 'string' ? message.content : JSON.stringify(message.content),
      };
    }
    if (message.role === 'assistant' && Array.isArray(message.toolCalls) && message.toolCalls.length) {
      return {
        role: 'assistant',
        content: message.content || '',
        tool_calls: message.toolCalls.map(call => ({
          id: call.id,
          type: 'function',
          function: {
            name: call.name,
            arguments: typeof call.arguments === 'string' ? call.arguments : JSON.stringify(call.arguments ?? {}),
          },
        })),
      };
    }
    return {
      role: message.role,
      content: message.content ?? '',
    };
  }).filter(Boolean);
}

function toOpenAiTool(tool) {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema || { type: 'object', properties: {} },
    },
  };
}

function safeJsonParse(value) {
  if (value == null || value === '') return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return { _rawArguments: value };
  }
}
