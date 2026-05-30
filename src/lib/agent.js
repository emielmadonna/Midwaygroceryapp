const DEFAULT_SYSTEM_PROMPT = `You are the Midway Gas & Grocery operations assistant.
You help the owner manage the store: hours, fuel prices, tank levels, RV bookings,
public site settings, products, and Instagram. You can call tools listed for you.

Style:
- Be brief and direct. No filler.
- Confirm what you did, with the smallest possible quote of the result.
- If a tool returns an error, explain it plainly and offer a next step.
- Never guess values — call a list_* tool first if you don't know.
- For destructive actions (refund, cancel, delete) restate the action and the
  exact target before calling the tool, then call it.`;

const MAX_ITERATIONS = 10;

export function createAgent({ provider, registry, store, systemPrompt = DEFAULT_SYSTEM_PROMPT } = {}) {
  if (!provider) throw new Error('Agent requires an AI provider.');
  if (!registry) throw new Error('Agent requires a tool registry.');

  async function runTurn({
    messages = [],
    actor,
    pendingConfirmation = null,
    confirmations = {},
    model,
  } = {}) {
    if (!actor) throw authError('Agent requires an authenticated actor.');

    const tools = registry.list({ actor, store });
    const conversation = [
      { role: 'system', content: systemPrompt },
      ...messages,
    ];

    const trace = [];

    if (pendingConfirmation) {
      const decision = confirmations[pendingConfirmation.toolCallId];
      if (decision === false) {
        const refusal = `Tool call ${pendingConfirmation.toolName} was not approved by the user.`;
        conversation.push(toolResultMessage(pendingConfirmation.toolCallId, { ok: false, error: refusal }));
        trace.push({ type: 'tool_denied', toolCallId: pendingConfirmation.toolCallId, toolName: pendingConfirmation.toolName });
        pendingConfirmation = null;
      } else if (decision === true) {
        const tool = registry.get(pendingConfirmation.toolName);
        if (!tool) {
          conversation.push(toolResultMessage(pendingConfirmation.toolCallId, { ok: false, error: `Unknown tool: ${pendingConfirmation.toolName}` }));
          trace.push({ type: 'tool_error', toolCallId: pendingConfirmation.toolCallId, toolName: pendingConfirmation.toolName, error: 'unknown_tool' });
        } else {
          try {
            const result = await registry.execute(pendingConfirmation.toolName, {
              input: pendingConfirmation.arguments ?? {},
              actor,
              store,
            });
            conversation.push(toolResultMessage(pendingConfirmation.toolCallId, { ok: true, data: result }));
            trace.push({ type: 'tool_result', toolCallId: pendingConfirmation.toolCallId, toolName: tool.name, ok: true });
          } catch (error) {
            conversation.push(toolResultMessage(pendingConfirmation.toolCallId, { ok: false, error: error.message, code: error.code }));
            trace.push({ type: 'tool_result', toolCallId: pendingConfirmation.toolCallId, toolName: tool.name, ok: false, error: error.message });
          }
        }
        pendingConfirmation = null;
      }
    }

    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration += 1) {
      if (pendingConfirmation) {
        return {
          message: null,
          pendingConfirmation,
          trace,
          finishReason: 'awaiting_confirmation',
        };
      }
      const turn = await provider.runTurn({
        messages: conversation,
        tools,
        model,
      });
      conversation.push(turn.message);
      trace.push({ type: 'assistant', content: turn.message.content, toolCalls: turn.message.toolCalls });

      if (!turn.toolCalls?.length) {
        return {
          message: turn.message,
          pendingConfirmation: null,
          trace,
          finishReason: turn.finishReason || 'stop',
        };
      }

      let requestedConfirmation = null;
      for (const toolCall of turn.toolCalls) {
        const tool = registry.get(toolCall.name);
        if (!tool) {
          conversation.push(toolResultMessage(toolCall.id, { ok: false, error: `Unknown tool: ${toolCall.name}` }));
          trace.push({ type: 'tool_error', toolCallId: toolCall.id, toolName: toolCall.name, error: 'unknown_tool' });
          continue;
        }
        if (tool.sideEffect === 'destructive' && confirmations[toolCall.id] !== true) {
          requestedConfirmation = {
            toolCallId: toolCall.id,
            toolName: tool.name,
            arguments: toolCall.arguments ?? {},
            sideEffect: tool.sideEffect,
            description: tool.description,
          };
          break;
        }
        try {
          const result = await registry.execute(toolCall.name, {
            input: toolCall.arguments ?? {},
            actor,
            store,
          });
          conversation.push(toolResultMessage(toolCall.id, { ok: true, data: result }));
          trace.push({ type: 'tool_result', toolCallId: toolCall.id, toolName: tool.name, ok: true });
        } catch (error) {
          conversation.push(toolResultMessage(toolCall.id, {
            ok: false,
            error: error.message,
            code: error.code,
          }));
          trace.push({
            type: 'tool_result',
            toolCallId: toolCall.id,
            toolName: tool.name,
            ok: false,
            error: error.message,
          });
        }
      }

      if (requestedConfirmation) {
        pendingConfirmation = requestedConfirmation;
        trace.push({ type: 'awaiting_confirmation', ...requestedConfirmation });
        return {
          message: null,
          pendingConfirmation,
          trace,
          finishReason: 'awaiting_confirmation',
        };
      }
    }

    return {
      message: { role: 'assistant', content: 'I hit the tool-call iteration limit. Try simplifying your request.' },
      pendingConfirmation: null,
      trace,
      finishReason: 'iteration_limit',
    };
  }

  return { runTurn };
}

function toolResultMessage(toolCallId, payload) {
  return {
    role: 'tool',
    toolCallId,
    content: typeof payload === 'string' ? payload : JSON.stringify(payload),
  };
}

function authError(message) {
  const error = new Error(message);
  error.statusCode = 401;
  error.code = 'AGENT_AUTH_REQUIRED';
  return error;
}
