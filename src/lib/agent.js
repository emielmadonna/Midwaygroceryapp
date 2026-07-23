const DEFAULT_SYSTEM_PROMPT = `You are Midway, the calm operations copilot for Midway Gas & Grocery.
You help the owner and staff run the entire store: live Square sales, inventory,
vendors, reorder drafts, receiving, reconciliation, fuel, RV bookings, hours,
public site settings, products, and integrations. You can review attached photos,
PDFs, spreadsheets, and vendor documents and call the tools listed for you.

Style:
- Write for a busy owner who is not technical. Be warm, brief, and direct.
- Lead with what needs attention, then the easiest next action.
- Never show raw JSON, internal tool names, IDs, or implementation details unless asked.
- Confirm what you did in plain language and show important before/after values.
- If a tool returns an error, explain it plainly and offer a next step.
- Never guess values — call a list_* tool first if you don't know.
- For sales questions, use get_sales_analytics and state the date range. Separate
  observed history from forecasts, mention data-quality warnings, and never present
  a low-confidence forecast as a fact.
- Draft orders before sending them. Never place a vendor order without explicit approval.
- Treat every external vendor MCP call as potentially consequential.
- For destructive actions (refund, cancel, delete, vendor call) restate the action
  and exact target before calling the tool, then wait for approval.
- Packs vs cartons matter. Wholesale items often ship in cases, cartons, or sales
  packs that contain many sellable units (a cigarette carton holds 10 packs; a
  case of candy may hold 24 bars). Inventory counts and Square always track the
  INDIVIDUAL sellable unit. When a count or delivery mentions cases or cartons,
  ask which one the number means if unclear, then convert to individual units
  before recording. When checking Harbor products, read the buying options
  (pack size and per-unit price) so orders and costs are stated per individual
  unit as well as per case.
- When the owner says a vendor handles certain items ("Harbor handles my
  smokes"), look up each item in that vendor's catalog for its pack size and
  per-unit cost, save the mapping with map_item_to_vendor, and confirm what was
  saved. When the owner states a stock rule in cases or cartons, convert to
  individual units before calling set_inventory_rule.
- You have FULL Square powers. You can create brand-new register items
  (create_square_item — a new item number is assigned automatically), change
  names/prices/barcodes (update_square_item), set on-hand stock, delete items,
  and reach every other Square capability (payments, orders, customers,
  discounts, taxes, invoices, team, loyalty, gift cards) through
  call_square_read_api and call_square_api.
- NEVER create a duplicate of a product already in the register. Before adding
  anything, know whether it already exists: an item is the SAME product if it
  shares a barcode (UPC) or the same name — check the barcode first. For each
  line on a delivery or invoice, call list_inventory (search by barcode AND by
  name) so you can tell new products from ones already stocked. Products already
  in the register get UPDATED — update_square_item for price/name/barcode, and
  set_square_item_stock (or a reconciliation) to add the received quantity onto
  the existing count, NOT a second item. Only a genuinely new product — not in
  the register under any barcode or name — gets create_square_item. Always pass
  the barcode (upc) to create_square_item; it now double-checks for an existing
  match and will update it instead of duplicating, but you should still do your
  own lookup so you know which lines are new and which are restocks.
- When the owner uploads a document (invoice, delivery slip, price list, count
  sheet — typed or scanned), the ENTIRE document is provided to you: as
  extracted text, attached page images, or a transcription. Read all of it and
  take action without being asked twice: match each line to inventory by barcode
  and name; restock and update the ones already carried, and create only the
  products that are genuinely new (price, barcode, and category from the document
  when present). Never ask the owner to re-upload, retype, or "continue reading".
- Documents from earlier in the conversation are automatically re-attached for
  you on every turn, so you ALWAYS still have them — never say you cannot see
  the file and never ask for it again. When the owner says "proceed", carry
  out the plan you described using the document you already have.`;

// High enough that very large jobs — a 100-line invoice, a full-store count
// sheet — can be acted on in one turn (each model round-trip may carry
// several parallel tool calls). The loop ends as soon as the model stops
// calling tools, so a high ceiling costs nothing on normal turns.
const MAX_ITERATIONS = 120;

export function createAgent({ provider, registry, store, systemPrompt = DEFAULT_SYSTEM_PROMPT } = {}) {
  if (!provider) throw new Error('Agent requires an AI provider.');
  if (!registry) throw new Error('Agent requires a tool registry.');

  async function runTurn({
    messages = [],
    actor,
    pendingConfirmation = null,
    confirmations = {},
    model,
    onEvent,
  } = {}) {
    if (!actor) throw authError('Agent requires an authenticated actor.');

    await emitAgentEvent(onEvent, { type: 'turn_started' });

    const tools = registry.list({ actor, store });
    const conversation = [
      { role: 'system', content: systemPrompt },
      ...messages,
    ];

    const trace = [];

    if (pendingConfirmation) {
      const decision = confirmations[pendingConfirmation.toolCallId];
      // A confirmation may cover a whole batch of destructive calls the model
      // issued together (e.g. "create these 35 items") — one approval runs all.
      const confirmationBatch = Array.isArray(pendingConfirmation.batch) && pendingConfirmation.batch.length
        ? pendingConfirmation.batch
        : [{ toolCallId: pendingConfirmation.toolCallId, toolName: pendingConfirmation.toolName, arguments: pendingConfirmation.arguments }];
      if (decision === false) {
        for (const entry of confirmationBatch) {
          const refusal = `Tool call ${entry.toolName} was not approved by the user.`;
          conversation.push(toolResultMessage(entry.toolCallId, { ok: false, error: refusal }));
          trace.push({ type: 'tool_denied', toolCallId: entry.toolCallId, toolName: entry.toolName });
          await emitAgentEvent(onEvent, { type: 'tool_denied', toolCallId: entry.toolCallId, toolName: entry.toolName });
        }
        pendingConfirmation = null;
      } else if (decision === true) {
        for (const entry of confirmationBatch) {
          const tool = registry.get(entry.toolName);
          if (!tool) {
            conversation.push(toolResultMessage(entry.toolCallId, { ok: false, error: `Unknown tool: ${entry.toolName}` }));
            trace.push({ type: 'tool_error', toolCallId: entry.toolCallId, toolName: entry.toolName, error: 'unknown_tool' });
            continue;
          }
          try {
            await emitAgentEvent(onEvent, { type: 'tool_started', toolCallId: entry.toolCallId, toolName: tool.name, ...toolActivityDetail(entry.arguments) });
            const result = await registry.execute(entry.toolName, {
              input: entry.arguments ?? {},
              actor,
              store,
            });
            conversation.push(toolResultMessage(entry.toolCallId, { ok: true, data: result }));
            trace.push({ type: 'tool_result', toolCallId: entry.toolCallId, toolName: tool.name, ok: true, result });
            await emitAgentEvent(onEvent, { type: 'tool_completed', toolCallId: entry.toolCallId, toolName: tool.name, ok: true });
          } catch (error) {
            conversation.push(toolResultMessage(entry.toolCallId, { ok: false, error: error.message, code: error.code }));
            trace.push({ type: 'tool_result', toolCallId: entry.toolCallId, toolName: tool.name, ok: false, error: error.message });
            await emitAgentEvent(onEvent, { type: 'tool_completed', toolCallId: entry.toolCallId, toolName: tool.name, ok: false });
          }
        }
        pendingConfirmation = null;
      }
    }

    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration += 1) {
      if (pendingConfirmation) {
        await emitAgentEvent(onEvent, { type: 'approval_required', toolCallId: pendingConfirmation.toolCallId, toolName: pendingConfirmation.toolName });
        return {
          message: null,
          pendingConfirmation,
          trace,
          finishReason: 'awaiting_confirmation',
        };
      }
      await emitAgentEvent(onEvent, { type: 'thinking', iteration });
      const turn = await provider.runTurn({
        messages: conversation,
        tools,
        model,
        onEvent,
      });
      conversation.push(turn.message);
      trace.push({ type: 'assistant', content: turn.message.content, toolCalls: turn.message.toolCalls });

      if (!turn.toolCalls?.length) {
        await emitAgentEvent(onEvent, { type: 'turn_completed', finishReason: turn.finishReason || 'stop' });
        return {
          message: turn.message,
          pendingConfirmation: null,
          trace,
          finishReason: turn.finishReason || 'stop',
        };
      }

      // Run every non-destructive call right away; gather ALL destructive
      // calls from this response into ONE approval so the owner taps once
      // (not once per item on a 35-item invoice).
      const destructiveBatch = [];
      for (const toolCall of turn.toolCalls) {
        const tool = registry.get(toolCall.name);
        if (!tool) {
          conversation.push(toolResultMessage(toolCall.id, { ok: false, error: `Unknown tool: ${toolCall.name}` }));
          trace.push({ type: 'tool_error', toolCallId: toolCall.id, toolName: toolCall.name, error: 'unknown_tool' });
          continue;
        }
        if (tool.sideEffect === 'destructive' && confirmations[toolCall.id] !== true) {
          destructiveBatch.push({
            toolCallId: toolCall.id,
            toolName: tool.name,
            arguments: toolCall.arguments ?? {},
            description: tool.description,
          });
          continue;
        }
        try {
          await emitAgentEvent(onEvent, { type: 'tool_started', toolCallId: toolCall.id, toolName: tool.name, ...toolActivityDetail(toolCall.arguments) });
          const result = await registry.execute(toolCall.name, {
            input: toolCall.arguments ?? {},
            actor,
            store,
          });
          conversation.push(toolResultMessage(toolCall.id, { ok: true, data: result }));
          trace.push({ type: 'tool_result', toolCallId: toolCall.id, toolName: tool.name, ok: true, result });
          await emitAgentEvent(onEvent, { type: 'tool_completed', toolCallId: toolCall.id, toolName: tool.name, ok: true });
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
          await emitAgentEvent(onEvent, { type: 'tool_completed', toolCallId: toolCall.id, toolName: tool.name, ok: false });
        }
      }

      if (destructiveBatch.length) {
        const requestedConfirmation = {
          ...destructiveBatch[0],
          sideEffect: 'destructive',
          batch: destructiveBatch,
          count: destructiveBatch.length,
        };
        pendingConfirmation = requestedConfirmation;
        trace.push({ type: 'awaiting_confirmation', ...requestedConfirmation });
        await emitAgentEvent(onEvent, { type: 'approval_required', toolCallId: requestedConfirmation.toolCallId, toolName: requestedConfirmation.toolName, count: requestedConfirmation.count });
        return {
          message: null,
          pendingConfirmation,
          trace,
          finishReason: 'awaiting_confirmation',
        };
      }
    }

    await emitAgentEvent(onEvent, { type: 'turn_completed', finishReason: 'iteration_limit' });
    return {
      message: { role: 'assistant', content: 'I hit the tool-call iteration limit. Try simplifying your request.' },
      pendingConfirmation: null,
      trace,
      finishReason: 'iteration_limit',
    };
  }

  return { runTurn };
}

// Small, safe details for the live activity feed: which vendor/MCP tool or
// API endpoint a pass-through call is using (never full arguments).
function toolActivityDetail(args = {}) {
  const detail = {};
  if (args && typeof args === 'object') {
    if (typeof args.toolName === 'string' && args.toolName) detail.innerTool = args.toolName;
    if (typeof args.connectorId === 'string' && args.connectorId) detail.connector = args.connectorId;
    if (typeof args.path === 'string' && args.path) detail.apiPath = args.path.split('?')[0];
    if (typeof args.name === 'string' && args.name) detail.subject = args.name.slice(0, 60);
  }
  return detail;
}

async function emitAgentEvent(onEvent, event) {
  if (typeof onEvent === 'function') await onEvent(event);
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
