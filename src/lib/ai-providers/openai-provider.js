import OpenAI from 'openai';

const DEFAULT_MODEL = 'gpt-4o';

export function createOpenAiProvider({ env = process.env, model = DEFAULT_MODEL } = {}) {
  const apiKey = env?.OPENAI_API_KEY || env?.OPENAI_KEY || '';
  if (!apiKey) {
    return createDisabledProvider('OPENAI_API_KEY is not set.');
  }
  const client = new OpenAI({ apiKey });

  return {
    name: 'openai',
    defaultModel: model,
    async runTurn({ messages, tools = [], model: overrideModel = model, temperature = 0.2 } = {}) {
      const response = await client.chat.completions.create({
        model: overrideModel,
        messages: toOpenAiMessages(messages),
        tools: tools.length ? tools.map(toOpenAiTool) : undefined,
        tool_choice: tools.length ? 'auto' : undefined,
        temperature,
      });
      const choice = response.choices?.[0];
      if (!choice) {
        return { finishReason: 'stop', message: { role: 'assistant', content: '' }, toolCalls: [] };
      }
      const assistantMessage = {
        role: 'assistant',
        content: choice.message?.content ?? '',
        toolCalls: (choice.message?.tool_calls ?? []).map(call => ({
          id: call.id,
          name: call.function?.name,
          arguments: safeJsonParse(call.function?.arguments),
        })),
      };
      return {
        finishReason: choice.finish_reason,
        message: assistantMessage,
        toolCalls: assistantMessage.toolCalls,
        usage: response.usage,
      };
    },
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
  return messages.map(message => {
    if (message.role === 'tool') {
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
  });
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
