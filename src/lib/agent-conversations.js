const CONVERSATIONS_TABLE = 'agent_conversations';
const MESSAGES_TABLE = 'agent_messages';

export function createAgentConversationStore({ supabase } = {}) {
  if (!supabase) return createMemoryConversationStore();

  return {
    async list({ tenantId = 'midway', channel = null, limit = 30 } = {}) {
      let query = supabase
        .from(CONVERSATIONS_TABLE)
        .select('id, tenant_id, location_id, channel, external_thread_id, title, created_by_email, created_at, updated_at')
        .eq('tenant_id', tenantId)
        .is('archived_at', null)
        .order('updated_at', { ascending: false })
        .limit(limit);
      if (channel) query = query.eq('channel', channel);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []).map(toPublicConversation);
    },

    async create({ tenantId = 'midway', locationId = null, channel = 'admin', externalThreadId = null, title = null, createdByEmail = null, createdByActorType = 'session' } = {}) {
      const { data, error } = await supabase
        .from(CONVERSATIONS_TABLE)
        .insert({
          tenant_id: tenantId,
          location_id: locationId,
          channel,
          external_thread_id: externalThreadId,
          title: title || 'New conversation',
          created_by_email: createdByEmail,
          created_by_actor_type: createdByActorType,
        })
        .select('*')
        .single();
      if (error) throw error;
      return toPublicConversation(data);
    },

    async findExternal({ channel, externalThreadId, tenantId = 'midway' }) {
      const { data, error } = await supabase
        .from(CONVERSATIONS_TABLE)
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('channel', channel)
        .eq('external_thread_id', externalThreadId)
        .is('archived_at', null)
        .maybeSingle();
      if (error) throw error;
      return data ? toPublicConversation(data) : null;
    },

    async listMessages({ conversationId, limit = 200 } = {}) {
      const { data, error } = await supabase
        .from(MESSAGES_TABLE)
        .select('id, conversation_id, role, content, tool_calls, tool_call_id, tool_name, metadata, created_at')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true })
        .limit(limit);
      if (error) throw error;
      return (data ?? []).map(toPublicMessage);
    },

    async appendMessages({ conversationId, messages }) {
      if (!messages.length) return [];
      const payload = messages.map(message => ({
        conversation_id: conversationId,
        role: message.role,
        content: typeof message.content === 'string' ? message.content : (message.content ? JSON.stringify(message.content) : null),
        tool_calls: Array.isArray(message.toolCalls) && message.toolCalls.length ? message.toolCalls : null,
        tool_call_id: message.toolCallId ?? null,
        tool_name: message.toolName ?? null,
        metadata: message.metadata ?? {},
      }));
      const { error } = await supabase.from(MESSAGES_TABLE).insert(payload);
      if (error) throw error;
      await supabase
        .from(CONVERSATIONS_TABLE)
        .update({ updated_at: new Date().toISOString() })
        .eq('id', conversationId);
      return payload;
    },

    async archive({ conversationId }) {
      const { error } = await supabase
        .from(CONVERSATIONS_TABLE)
        .update({ archived_at: new Date().toISOString() })
        .eq('id', conversationId);
      if (error) throw error;
      return { id: conversationId, archived: true };
    },

    async setTitle({ conversationId, title }) {
      const clean = String(title || '').trim().slice(0, 80);
      if (!clean) return null;
      const { error } = await supabase
        .from(CONVERSATIONS_TABLE)
        .update({ title: clean })
        .eq('id', conversationId);
      if (error) throw error;
      return { id: conversationId, title: clean };
    },
  };
}

function createMemoryConversationStore() {
  const conversations = new Map();
  const messages = new Map();
  return {
    async list() {
      return [...conversations.values()].sort((a, b) => (b.updatedAt > a.updatedAt ? 1 : -1));
    },
    async create({ channel = 'admin', externalThreadId = null, title = 'New conversation', createdByEmail = null, createdByActorType = 'session' } = {}) {
      const id = `mem_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const now = new Date().toISOString();
      const record = { id, channel, externalThreadId, title, createdByEmail, createdByActorType, createdAt: now, updatedAt: now };
      conversations.set(id, record);
      messages.set(id, []);
      return record;
    },
    async findExternal({ channel, externalThreadId }) {
      return [...conversations.values()].find(c => c.channel === channel && c.externalThreadId === externalThreadId) ?? null;
    },
    async listMessages({ conversationId }) {
      return messages.get(conversationId) ?? [];
    },
    async appendMessages({ conversationId, messages: items }) {
      const existing = messages.get(conversationId) ?? [];
      const stamped = items.map(message => ({ ...message, id: `m_${existing.length + 1}`, createdAt: new Date().toISOString() }));
      messages.set(conversationId, existing.concat(stamped));
      const conv = conversations.get(conversationId);
      if (conv) conv.updatedAt = new Date().toISOString();
      return stamped;
    },
    async archive({ conversationId }) {
      conversations.delete(conversationId);
      messages.delete(conversationId);
      return { id: conversationId, archived: true };
    },
    async setTitle({ conversationId, title }) {
      const conv = conversations.get(conversationId);
      const clean = String(title || '').trim().slice(0, 80);
      if (!conv || !clean) return null;
      conv.title = clean;
      return { id: conversationId, title: clean };
    },
  };
}

function toPublicConversation(row) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    locationId: row.location_id,
    channel: row.channel,
    externalThreadId: row.external_thread_id,
    title: row.title,
    createdByEmail: row.created_by_email,
    createdByActorType: row.created_by_actor_type,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toPublicMessage(row) {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role,
    content: row.content,
    toolCalls: row.tool_calls,
    toolCallId: row.tool_call_id,
    toolName: row.tool_name,
    metadata: row.metadata,
    createdAt: row.created_at,
  };
}
