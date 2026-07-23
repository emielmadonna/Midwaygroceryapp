import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

import './styles/command-center.css';

const TOKEN_KEY = 'midway_admin_session';
const USER_KEY = 'midway_admin_user';
const API_ROOT = ['3000', '3002', '5173'].includes(window.location.port) || window.location.protocol === 'file:'
  ? 'http://127.0.0.1:3001/api'
  : '/api';

const NAV_ITEMS = [
  ['home', 'Command center', 'home'],
  ['sales', 'What’s selling', 'trend'],
  ['assistant', 'Ask Midway', 'spark'],
  ['inventory', 'Inventory', 'boxes'],
  ['orders', 'Orders', 'clipboard'],
  ['vendors', 'Vendors', 'truck'],
  ['bookings', 'Bookings', 'calendar'],
  ['connections', 'Connections', 'link'],
  ['settings', 'Store settings', 'gear'],
];

const QUICK_PROMPTS = [
  ['What needs attention?', 'Show me only the things that need my attention today.'],
  ['Build an order', 'Show me what is running low and help me make a vendor order draft.'],
  ['Reconcile inventory', 'Help me reconcile inventory. Start with the biggest differences or missing information.'],
  ['Review this delivery', 'I want to upload a delivery invoice or packing slip and compare it with what we ordered.'],
];

const REQUESTED_VIEW = new URLSearchParams(window.location.search).get('view');
const INITIAL_VIEW = NAV_ITEMS.some(([id]) => id === REQUESTED_VIEW) ? REQUESTED_VIEW : 'home';

function App() {
  const [token, setToken] = useState(() => sessionStorage.getItem(TOKEN_KEY) || '');
  const [user, setUser] = useState(() => safeJson(sessionStorage.getItem(USER_KEY)));
  const [view, setView] = useState(INITIAL_VIEW);
  const [overview, setOverview] = useState(null);
  const [inventory, setInventory] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [sites, setSites] = useState([]);
  const [reconciliations, setReconciliations] = useState([]);
  const [salesAnalytics, setSalesAnalytics] = useState(null);
  const [openAiStatus, setOpenAiStatus] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [activeConversationId, setActiveConversationId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [pendingConfirmation, setPendingConfirmation] = useState(null);
  const [liveReply, setLiveReply] = useState('');
  const [liveActivity, setLiveActivity] = useState([]);
  const [composerText, setComposerText] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [loading, setLoading] = useState(Boolean(token));
  const [busy, setBusy] = useState(false);
  const [syncProgress, setSyncProgress] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [inventorySearch, setInventorySearch] = useState('');
  const [inventoryFilter, setInventoryFilter] = useState('all');
  const [chatOpen, setChatOpen] = useState(false);
  const [voiceState, setVoiceState] = useState('off');
  const voiceRef = useRef(null);
  const conversationIdRef = useRef(null);
  useEffect(() => { conversationIdRef.current = activeConversationId; }, [activeConversationId]);
  useEffect(() => () => stopVoice(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const stopVoice = () => {
    const active = voiceRef.current;
    voiceRef.current = null;
    try { active?.channel?.close(); } catch { /* already closed */ }
    try { active?.pc?.close(); } catch { /* already closed */ }
    try { active?.stream?.getTracks().forEach(track => track.stop()); } catch { /* already stopped */ }
    try { active?.audio?.remove(); } catch { /* already removed */ }
    setVoiceState('off');
  };

  const startVoice = async () => {
    if (voiceRef.current) { stopVoice(); return; }
    setVoiceState('connecting'); setError('');
    try {
      const session = await api('/admin/agent/voice/session', { method: 'POST', body: {} });
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const pc = new RTCPeerConnection();
      const audio = document.createElement('audio');
      audio.autoplay = true;
      document.body.appendChild(audio);
      pc.ontrack = event => { audio.srcObject = event.streams[0]; };
      pc.addTrack(stream.getTracks()[0], stream);
      const channel = pc.createDataChannel('oai-events');
      channel.onmessage = async event => {
        let message;
        try { message = JSON.parse(event.data); } catch { return; }
        if (message.type === 'response.output_item.done' && message.item?.type === 'function_call' && message.item.name === 'ask_midway') {
          let args = {};
          try { args = JSON.parse(message.item.arguments || '{}'); } catch { /* leave empty */ }
          let answer = '';
          try {
            const turn = await api('/admin/agent/turn', {
              method: 'POST',
              body: { conversationId: conversationIdRef.current, userMessage: args.question || '' },
            });
            answer = turn.pendingConfirmation
              ? 'I have that ready, but it needs a tap on the approve button on the screen before I do it.'
              : (turn.message?.content || 'Done.');
            if (conversationIdRef.current) {
              api(`/admin/agent/conversations/${encodeURIComponent(conversationIdRef.current)}/messages`).then(setMessages).catch(() => {});
            }
            if (turn.pendingConfirmation) setPendingConfirmation(turn.pendingConfirmation);
          } catch (turnError) {
            answer = `That did not work: ${turnError.message}`;
          }
          try {
            channel.send(JSON.stringify({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: message.item.call_id, output: JSON.stringify({ answer }) } }));
            channel.send(JSON.stringify({ type: 'response.create' }));
          } catch { /* channel closed mid-call */ }
        }
      };
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const sdpResponse = await fetch(`https://api.openai.com/v1/realtime/calls?model=${encodeURIComponent(session.model)}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.clientSecret}`, 'Content-Type': 'application/sdp' },
        body: offer.sdp,
      });
      if (!sdpResponse.ok) throw new Error('The voice connection could not be established.');
      await pc.setRemoteDescription({ type: 'answer', sdp: await sdpResponse.text() });
      voiceRef.current = { pc, stream, audio, channel };
      setVoiceState('live');
    } catch (voiceError) {
      stopVoice();
      setError(/permission|denied|NotAllowed/i.test(voiceError.message || voiceError.name || '')
        ? 'Midway needs microphone access for voice — allow it in the browser and try again.'
        : voiceError.message);
    }
  };

  const api = async (path, options = {}) => {
    const response = await fetch(`${API_ROOT}${path}`, {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(['GET', 'HEAD'].includes(options.method || 'GET') ? {} : { 'Idempotency-Key': crypto.randomUUID() }),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) {
      const apiError = new Error(payload.error?.message || `Request failed (${response.status})`);
      apiError.status = response.status;
      apiError.code = payload.error?.code;
      apiError.data = payload.data;
      throw apiError;
    }
    return payload.data;
  };

  const refresh = async ({ quiet = false } = {}) => {
    if (!token) return;
    if (!quiet) setLoading(true);
    setError('');
    try {
      const [me, commandData, conversationData, bookingData, siteData, reconciliationData, salesData, aiStatus] = await Promise.all([
        api('/admin/me'),
        api('/admin/command-center/overview'),
        api('/admin/agent/conversations'),
        api('/admin/bookings'),
        api('/admin/rv-sites'),
        api('/admin/command-center/reconciliations'),
        api('/admin/command-center/sales?days=30'),
        api('/admin/providers/openai'),
      ]);
      setUser(me.user);
      sessionStorage.setItem(USER_KEY, JSON.stringify(me.user));
      setOverview(commandData);
      setInventory(commandData?.allInventory || commandData?.inventory || []);
      setBookings(bookingData || []);
      setSites(siteData || []);
      setReconciliations(reconciliationData || []);
      setSalesAnalytics(salesData);
      setOpenAiStatus(aiStatus);
      setConversations(conversationData || []);
      let nextConversationId = activeConversationId || conversationData?.[0]?.id;
      if (!nextConversationId) {
        const created = await api('/admin/agent/conversations', { method: 'POST', body: { title: 'Store command center' } });
        nextConversationId = created.id;
        setConversations([created]);
      }
      setActiveConversationId(nextConversationId);
      if (nextConversationId) setMessages(await api(`/admin/agent/conversations/${encodeURIComponent(nextConversationId)}/messages`));
    } catch (refreshError) {
      if (refreshError.status === 401) logout();
      else setError(refreshError.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (token) refresh(); }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!token || params.get('provider') !== 'xero' || !params.get('code')) return;
    const code = params.get('code');
    window.history.replaceState({}, '', `${window.location.pathname}?view=connections`);
    setView('connections');
    api('/admin/providers/xero/oauth/callback', {
      method: 'POST',
      body: { code, redirectUri: `${window.location.origin}/admin.html?provider=xero` },
    })
      .then(data => setNotice(`Xero is connected to ${data.organizations?.[0]?.tenantName || 'your organization'}. Your books are linked.`))
      .catch(callbackError => setError(`Xero could not finish connecting: ${callbackError.message}`));
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!token || params.get('provider') !== 'quickbooks' || !params.get('code')) return;
    const code = params.get('code');
    const realmId = params.get('realmId');
    window.history.replaceState({}, '', `${window.location.pathname}?view=connections`);
    setView('connections');
    api('/admin/providers/quickbooks/oauth/callback', {
      method: 'POST',
      body: { code, realmId, redirectUri: `${window.location.origin}/admin.html?provider=quickbooks` },
    })
      .then(data => setNotice(`QuickBooks is connected to ${data.companyName || 'your company'}. Your books are linked.`))
      .catch(callbackError => setError(`QuickBooks could not finish connecting: ${callbackError.message}`));
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  const logout = () => {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(USER_KEY);
    setToken('');
    setUser(null);
    setOverview(null);
  };

  const login = async ({ email, password }) => {
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`${API_ROOT}/admin/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error?.message || 'Sign in failed.');
      sessionStorage.setItem(TOKEN_KEY, payload.data.token);
      sessionStorage.setItem(USER_KEY, JSON.stringify(payload.data.user));
      setUser(payload.data.user);
      setToken(payload.data.token);
    } catch (loginError) {
      setError(loginError.message);
    } finally {
      setBusy(false);
    }
  };

  const openAssistant = (prompt = '') => {
    setComposerText(prompt);
    setView('assistant');
    requestAnimationFrame(() => document.querySelector('.cc-composer textarea')?.focus());
  };

  const loadConversation = async conversationId => {
    setActiveConversationId(conversationId);
    setMessages(await api(`/admin/agent/conversations/${encodeURIComponent(conversationId)}/messages`));
  };

  const newConversation = async () => {
    const created = await api('/admin/agent/conversations', { method: 'POST', body: { title: 'New conversation' } });
    setConversations(current => [created, ...current]);
    setActiveConversationId(created.id);
    setMessages([]);
    setPendingConfirmation(null);
  };

  const sendMessage = async (event, confirmationDecision) => {
    event?.preventDefault?.();
    if (busy || !activeConversationId) return;
    const text = composerText.trim();
    if (!text && !attachments.length && confirmationDecision === undefined) return;
    setBusy(true);
    setError('');
    setLiveReply('');
    setLiveActivity([]);
    const outgoingAttachments = attachments.map(({ name, type, dataUrl, uploadId }) => ({ name, type, dataUrl, uploadId }));
    if (confirmationDecision === undefined) {
      const displayText = text || (outgoingAttachments.length ? 'Please review the attached file and tell me what needs attention.' : '');
      setMessages(current => [...current, {
        id: `sending-${crypto.randomUUID()}`,
        role: 'user',
        content: displayText,
        createdAt: new Date().toISOString(),
        metadata: outgoingAttachments.length ? { attachments: outgoingAttachments.map(({ name, type }) => ({ name, type })) } : {},
      }]);
      setComposerText('');
      setAttachments([]);
    }
    try {
      const response = await fetch(`${API_ROOT}/admin/agent/turn/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({
          conversationId: activeConversationId,
          userMessage: confirmationDecision === undefined ? text : '',
          attachments: confirmationDecision === undefined ? outgoingAttachments : [],
          pendingConfirmation: confirmationDecision === undefined ? null : pendingConfirmation,
          confirmations: confirmationDecision === undefined || !pendingConfirmation
            ? {}
            : { [pendingConfirmation.toolCallId]: confirmationDecision },
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error?.message || `Request failed (${response.status})`);
      }
      let completed = null;
      let streamError = null;
      // Per-tool run counters so bulk work reads as one clean line
      // ("Creating the new register item — 12 of 35 done") instead of a blur.
      const toolRuns = {};
      await readEventStream(response, streamEvent => {
        if (streamEvent.type === 'text_delta') {
          setLiveReply(current => current + (streamEvent.delta || ''));
          setLiveActivity(current => completeActivity(current, 'thinking'));
        } else if (streamEvent.type === 'attachment_started') {
          setLiveActivity(current => upsertActivity(current, {
            id: `attachment-${streamEvent.name}`,
            label: `Reviewing ${streamEvent.name}`,
            status: 'active',
          }));
        } else if (streamEvent.type === 'attachment_progress') {
          setLiveActivity(current => upsertActivity(current, {
            id: `attachment-${streamEvent.name}`,
            label: streamEvent.label || `Reading ${streamEvent.name}`,
            status: 'active',
          }));
        } else if (streamEvent.type === 'attachment_completed') {
          setLiveActivity(current => completeActivity(upsertActivity(current, {
            id: `attachment-${streamEvent.name}`,
            label: streamEvent.totalPages ? `Read all ${streamEvent.totalPages} pages of ${streamEvent.name}` : `Read ${streamEvent.name}`,
            status: 'active',
          }), `attachment-${streamEvent.name}`));
        } else if (streamEvent.type === 'turn_started' || streamEvent.type === 'thinking') {
          setLiveActivity(current => upsertActivity(current, {
            id: 'thinking',
            label: streamEvent.iteration > 0 ? 'Putting the results together' : 'Understanding your request',
            status: 'active',
          }));
        } else if (streamEvent.type === 'tool_started') {
          const run = toolRuns[streamEvent.toolName] = toolRuns[streamEvent.toolName] || { started: 0, done: 0, failed: 0, label: '' };
          run.started += 1;
          run.label = friendlyToolActivity(streamEvent.toolName, streamEvent);
          setLiveActivity(current => upsertActivity(completeActivity(current, 'thinking'), {
            id: `tool-${streamEvent.toolName}`,
            label: run.started > 1 ? `${run.label} — ${run.done} of ${run.started} done` : run.label,
            status: 'active',
          }));
        } else if (streamEvent.type === 'tool_completed' || streamEvent.type === 'tool_denied') {
          const run = toolRuns[streamEvent.toolName] = toolRuns[streamEvent.toolName] || { started: 1, done: 0, failed: 0, label: friendlyToolActivity(streamEvent.toolName, streamEvent) };
          run.done += 1;
          if (streamEvent.ok === false) run.failed += 1;
          setLiveActivity(current => upsertActivity(current, {
            id: `tool-${streamEvent.toolName}`,
            label: run.started > 1 ? `${run.label} — ${run.done} of ${run.started} done` : run.label,
            status: run.done >= run.started ? (run.failed ? 'error' : 'done') : 'active',
          }));
        } else if (streamEvent.type === 'approval_required') {
          setLiveActivity(current => upsertActivity(completeActivity(current, 'thinking'), {
            id: streamEvent.toolCallId || 'approval',
            label: streamEvent.count > 1 ? `Waiting for your approval (${streamEvent.count} actions ready)` : 'Waiting for your approval',
            status: 'waiting',
          }));
        } else if (streamEvent.type === 'done') {
          completed = streamEvent.data;
        } else if (streamEvent.type === 'error') {
          streamError = new Error(streamEvent.message || 'Midway could not finish that request.');
        }
      });
      if (streamError) throw streamError;
      if (!completed) throw new Error('The live response ended before Midway finished.');
      setPendingConfirmation(completed.pendingConfirmation || null);
      setMessages(await api(`/admin/agent/conversations/${encodeURIComponent(activeConversationId)}/messages`));
      api('/admin/agent/conversations').then(list => setConversations(list || [])).catch(() => {});
      setLiveReply('');
      setLiveActivity([]);
      if (!completed.pendingConfirmation) refresh({ quiet: true });
    } catch (sendError) {
      setError(sendError.message);
      setLiveReply('');
      setLiveActivity([]);
    } finally {
      setBusy(false);
    }
  };

  const handleFiles = async fileList => {
    try {
      const selected = [...fileList].slice(0, 3);
      const loaded = await Promise.all(selected.map(async original => {
        const file = await shrinkImageForUpload(original) || original;
        const contentType = file.type || guessMime(file.name);
        if (file.size > 4 * 1024 * 1024) {
          if (contentType.startsWith('image/')) {
            throw new Error(`${original.name} could not be shrunk enough to send. Try taking the photo again in normal quality.`);
          }
          if (file.size > 45 * 1024 * 1024) {
            throw new Error(`${original.name} is ${(file.size / (1024 * 1024)).toFixed(1)} MB — files can be up to 45 MB.`);
          }
          // Big documents go straight to file storage, skipping API size caps.
          const direct = await api('/admin/command-center/uploads/direct', {
            method: 'POST',
            body: { fileName: file.name, contentType, sizeBytes: file.size, conversationId: activeConversationId, purpose: 'assistant' },
          });
          const put = await fetch(direct.uploadUrl, { method: 'PUT', headers: { 'Content-Type': contentType, 'x-upsert': 'false' }, body: file });
          if (!put.ok) throw new Error(`${original.name} could not be uploaded to storage. Try again.`);
          return { name: file.name, type: contentType, size: file.size, uploadId: direct.id };
        }
        const attachment = { name: file.name, type: contentType, size: file.size, dataUrl: await readDataUrl(file) };
        const saved = await api('/admin/command-center/uploads', {
          method: 'POST',
          body: { ...attachment, conversationId: activeConversationId, purpose: 'assistant' },
        });
        return { ...attachment, uploadId: saved.id, signedUrl: saved.signedUrl };
      }));
      setAttachments(loaded);
      setView('assistant');
    } catch (fileError) {
      setError(fileError.message);
    }
  };

  // Square sync runs as a stepped background job: each request does one small
  // chunk and reports progress, so nothing runs long enough to time out.
  const syncSquare = async () => {
    setBusy(true); setError('');
    try {
      let job = await api('/admin/command-center/square/sync/jobs', { method: 'POST', body: {} });
      setSyncProgress({ phase: job.phase, itemsDone: job.itemsDone });
      for (let step = 0; job.status === 'running' && step < 120; step += 1) {
        job = await api(`/admin/command-center/square/sync/jobs/${encodeURIComponent(job.id)}/step`, { method: 'POST', body: {} });
        setSyncProgress({ phase: job.phase, itemsDone: job.itemsDone });
      }
      if (job.status !== 'completed') throw new Error(job.errorMessage || 'The Square sync did not finish. Try again.');
      setNotice(`Square updated: ${job.itemsDone} catalog items and counts checked.`);
      await refresh({ quiet: true });
    } catch (syncError) {
      setError(syncError.message);
    } finally {
      setBusy(false);
      setSyncProgress(null);
    }
  };

  const syncSales = async days => {
    setBusy(true); setError('');
    try {
      const result = await api('/admin/command-center/sales/sync', { method: 'POST', body: { days } });
      setNotice(`Sales history updated: ${result.ordersStored} orders and ${result.linesStored} item lines checked.`);
      await refresh({ quiet: true });
    } catch (syncError) { setError(syncError.message); }
    finally { setBusy(false); }
  };

  const visibleInventory = useMemo(() => inventory.filter(item => {
    const matchesSearch = !inventorySearch || [item.name, item.sku, item.vendorName, item.category]
      .some(value => String(value || '').toLowerCase().includes(inventorySearch.toLowerCase()));
    const matchesFilter = inventoryFilter === 'all'
      || (inventoryFilter === 'low' && item.isLowStock)
      || (inventoryFilter === 'unmapped' && !item.vendorId);
    return matchesSearch && matchesFilter;
  }), [inventory, inventorySearch, inventoryFilter]);

  if (!token) return <Login onSubmit={login} busy={busy} error={error} />;

  return (
    <div className="cc-app">
      <Sidebar view={view} setView={setView} user={user} onLogout={logout} />
      <main className="cc-main">
        <Topbar view={view} overview={overview} user={user} onRefresh={() => refresh()} loading={loading} />
        {(error || notice) && <Toast tone={error ? 'danger' : 'success'} onClose={() => { setError(''); setNotice(''); }}>{error || notice}</Toast>}
        <div className={view === 'assistant' ? 'cc-content cc-content--assistant' : 'cc-content'}>
          {loading && !overview ? <LoadingScreen /> : null}
          {!loading && view === 'home' && <Dashboard overview={overview} onAsk={openAssistant} onView={setView} onSync={syncSquare} syncProgress={syncProgress} />}
          {view === 'sales' && <SalesView analytics={salesAnalytics} api={api} onSync={syncSales} busy={busy} onAsk={openAssistant} />}
          {view === 'assistant' && (
            <Assistant
              messages={messages}
              conversations={conversations}
              activeConversationId={activeConversationId}
              onConversation={loadConversation}
              onNew={newConversation}
              text={composerText}
              setText={setComposerText}
              attachments={attachments}
              setAttachments={setAttachments}
              onFiles={handleFiles}
              onSend={sendMessage}
              busy={busy}
              pending={pendingConfirmation}
              liveReply={liveReply}
              liveActivity={liveActivity}
              overview={overview}
              openAiStatus={openAiStatus}
              voiceState={voiceState}
              onVoice={startVoice}
            />
          )}
          {view === 'inventory' && (
            <InventoryView
              items={visibleInventory}
              total={inventory.length}
              search={inventorySearch}
              setSearch={setInventorySearch}
              filter={inventoryFilter}
              setFilter={setInventoryFilter}
              onSync={syncSquare}
              syncProgress={syncProgress}
              busy={busy}
              onAsk={openAssistant}
              api={api}
              onRefresh={() => refresh({ quiet: true })}
              reconciliations={reconciliations}
              user={user}
            />
          )}
          {view === 'orders' && <OrdersView overview={overview} onAsk={openAssistant} api={api} onRefresh={() => refresh({ quiet: true })} />}
          {view === 'vendors' && <VendorsView overview={overview} api={api} onRefresh={() => refresh({ quiet: true })} user={user} />}
          {view === 'bookings' && <BookingsView bookings={bookings} sites={sites} overview={overview} onAsk={openAssistant} api={api} onRefresh={() => refresh({ quiet: true })} user={user} />}
          {view === 'connections' && <ConnectionsView overview={overview} api={api} onRefresh={() => refresh({ quiet: true })} user={user} />}
          {view === 'settings' && <StoreSettingsView status={openAiStatus} api={api} onRefresh={() => refresh({ quiet: true })} user={user} onOpenAssistant={() => setView('assistant')} />}
        </div>
      </main>
      {view !== 'assistant' && !loading && (
        <>
          <button className="cc-chat-fab" onClick={() => setChatOpen(open => !open)} aria-label={chatOpen ? 'Close Midway chat' : 'Chat with Midway'}>
            {chatOpen ? <span aria-hidden="true">×</span> : <Icon name="message" />}
          </button>
          {chatOpen && (
            <div className="cc-chat-widget">
              <header>
                <span><Icon name="spark" /> Ask Midway</span>
                <div>
                  <button type="button" onClick={newConversation} title="Start a fresh conversation">+ New chat</button>
                  <button type="button" onClick={() => { setChatOpen(false); setView('assistant'); }}>Full screen</button>
                </div>
              </header>
              <Assistant
                compact
                messages={messages}
                conversations={conversations}
                activeConversationId={activeConversationId}
                onConversation={loadConversation}
                onNew={newConversation}
                text={composerText}
                setText={setComposerText}
                attachments={attachments}
                setAttachments={setAttachments}
                onFiles={handleFiles}
                onSend={sendMessage}
                busy={busy}
                pending={pendingConfirmation}
                liveReply={liveReply}
                liveActivity={liveActivity}
                overview={overview}
                openAiStatus={openAiStatus}
                voiceState={voiceState}
                onVoice={startVoice}
              />
            </div>
          )}
        </>
      )}
      <MobileNav view={view} setView={setView} />
    </div>
  );
}

function Login({ onSubmit, busy, error }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  return (
    <div className="cc-login">
      <div className="cc-login__art" aria-hidden="true">
        <div className="cc-login__orbit"><span /><span /><span /></div>
        <div className="cc-login__message">“What needs attention today?”</div>
      </div>
      <form className="cc-login__card" id="loginForm" onSubmit={event => { event.preventDefault(); onSubmit({ email, password }); }}>
        <img className="cc-login-logo" src="/assets/midway-logo.png" alt="Midway Gas & Grocery" />
        <p className="cc-kicker">MidwayOS</p>
        <h1>Your store,<br /><em>one clear view.</em></h1>
        <p>See what matters, ask questions, and take care of the day without digging through menus.</p>
        <label>Email<input id="loginEmail" type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="username" required /></label>
        <label>Password<input id="loginPassword" type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" required /></label>
        {error && <div className="cc-form-error" id="loginStatus">{error}</div>}
        <button className="cc-button cc-button--primary cc-button--large" disabled={busy}>{busy ? 'Signing in…' : 'Open command center'}</button>
        <small>Protected for Midway owners and staff.</small>
      </form>
    </div>
  );
}

function Sidebar({ view, setView, user, onLogout }) {
  return (
    <aside className="cc-sidebar">
      <div className="cc-sidebar__brand"><img className="cc-brand-logo" src="/assets/midway-logo.png" alt="Midway Gas & Grocery" /><span>Store command center</span></div>
      <nav>{NAV_ITEMS.map(([id, label, icon]) => <button key={id} className={view === id ? 'active' : ''} onClick={() => setView(id)}><Icon name={icon} />{label}</button>)}</nav>
      <div className="cc-sidebar__profile">
        <div className="cc-avatar">{initials(user?.displayName || user?.email)}</div>
        <div><strong>{user?.displayName || 'Midway owner'}</strong><span>{user?.role || 'owner'}</span></div>
        <button aria-label="Log out" onClick={onLogout}><Icon name="logout" /></button>
      </div>
    </aside>
  );
}

function Topbar({ view, overview, onRefresh, loading }) {
  const title = NAV_ITEMS.find(item => item[0] === view)?.[1] || 'Command center';
  const square = overview?.square;
  return (
    <header className="cc-topbar">
      <div><p>{formatLongDate(new Date())}</p><h1>{title}</h1></div>
      <div className="cc-topbar__actions">
        <span className={`cc-live-status ${square?.connected ? 'is-live' : ''}`}><i />{square?.connected ? 'Square live' : 'Square offline'}</span>
        <button className="cc-icon-button" onClick={onRefresh} aria-label="Refresh command center"><Icon name="refresh" className={loading ? 'spin' : ''} /></button>
      </div>
    </header>
  );
}

function Dashboard({ overview, onAsk, onView, onSync, syncProgress }) {
  const metrics = overview?.metrics || {};
  const square = overview?.square || {};
  const knownInventory = metrics.countedInventoryItems || 0;
  const healthyInventory = metrics.healthyInventoryItems || 0;
  const totalInventory = metrics.inventoryItems || 0;
  const inventoryHealth = totalInventory ? Math.round((healthyInventory / totalInventory) * 100) : null;
  return (
    <div className="cc-dashboard">
      <section className="cc-welcome">
        <div><p className="cc-kicker">Good {dayPart()}</p><h2>Here’s what’s happening<br /><em>at the store.</em></h2><p>{overview?.priorities?.[0]?.detail || 'Everything is ready for the day.'}</p></div>
        <button className="cc-button cc-button--dark" onClick={() => onAsk('Show me what needs my attention today and explain the easiest next step.')}><Icon name="spark" /> Ask Midway</button>
      </section>

      <DataSourceBanner sources={overview?.dataSources} onView={onView} />

      <section className="cc-metrics">
        <Metric label="Sales today" value={square.connected ? money(metrics.salesTodayCents) : '—'} detail={square.connected ? `${metrics.transactionsToday || 0} transactions` : 'Connect Square for live sales'} icon="trend" tone="green" />
        <Metric label="Inventory" value={inventoryHealth === null ? '—' : `${inventoryHealth}%`} detail={metrics.lowStockItems ? `${metrics.lowStockItems} items need attention` : knownInventory ? 'Stock levels look healthy' : 'Pull Square counts to begin'} icon="boxes" tone="amber" />
        <Metric label="Open orders" value={metrics.openOrders ?? 0} detail={`${metrics.vendors || 0} active vendors`} icon="clipboard" tone="blue" />
        <Metric label="Store activity" value={(overview?.dashboard?.arrivals?.length || 0) + (overview?.dashboard?.departures?.length || 0)} detail="Arrivals and departures today" icon="calendar" tone="violet" />
      </section>

      <section className="cc-dashboard-grid">
        <div className="cc-panel cc-panel--priorities">
          <div className="cc-panel__heading"><div><p className="cc-kicker">Today</p><h3>Needs your attention</h3></div><span>{overview?.priorities?.length || 0}</span></div>
          <div className="cc-priority-list">
            {(overview?.priorities || []).map(priority => (
              <button key={priority.id} className="cc-priority" onClick={() => routePriority(priority.id, onView, onAsk)}>
                <i className={`tone-${priority.tone}`}><Icon name={priorityIcon(priority.id)} /></i>
                <span><strong>{priority.title}</strong><small>{priority.detail}</small></span>
                <b>{priority.action}<Icon name="arrow" /></b>
              </button>
            ))}
          </div>
        </div>
        <div className="cc-panel cc-stock-card">
          <div className="cc-panel__heading"><div><p className="cc-kicker">Stock health</p><h3>Inventory at a glance</h3></div><button onClick={() => onView('inventory')}>View all</button></div>
          <div className="cc-stock-visual">
            <div className="cc-ring" style={{ '--value': `${(inventoryHealth || 0) * 3.6}deg` }}><span><strong>{inventoryHealth === null ? '—' : `${inventoryHealth}%`}</strong><small>healthy</small></span></div>
            <div className="cc-stock-legend"><span><i className="healthy" />Healthy <b>{healthyInventory}</b></span><span><i className="low" />Running low <b>{metrics.lowStockItems || 0}</b></span><span><i className="unknown" />Not counted <b>{Math.max(0, totalInventory - knownInventory)}</b></span></div>
          </div>
          <button className="cc-button cc-button--soft" onClick={onSync} disabled={Boolean(syncProgress)}><Icon name="refresh" /> {syncButtonLabel(syncProgress, 'Pull latest from Square')}</button>
        </div>
      </section>

      <section className="cc-quick-actions">
        <div className="cc-panel__heading"><div><p className="cc-kicker">Just ask</p><h3>What would you like to do?</h3></div></div>
        <div>{QUICK_PROMPTS.map(([label, prompt], index) => <button key={label} onClick={() => onAsk(prompt)}><span>{['01', '02', '03', '04'][index]}</span><strong>{label}</strong><Icon name="arrow" /></button>)}</div>
      </section>
    </div>
  );
}

function DataSourceBanner({ sources, onView }) {
  const issues = [];
  if (sources?.persistence?.persistent === false) issues.push('Changes are using temporary memory and will not survive a restart. Connect Supabase before using this in production.');
  if (sources?.squareSales?.live === false) issues.push(sources.squareSales.errorMessage || 'Live Square sales are not connected.');
  if (sources?.squareInventory?.live === false) issues.push(sources.squareInventory.errorMessage || 'Live Square inventory is not connected.');
  if (sources?.openai?.live === false) issues.push(sources.openai.errorMessage || 'The Ask Midway assistant needs a valid OpenAI API key.');
  if (!issues.length) return <div className="cc-data-source-banner tone-success"><Icon name="check" /><span><strong>Live data verified</strong><small>Sales and inventory are coming directly from Square, with operational records saved persistently.</small></span></div>;
  const onlyAssistantNeedsSetup = sources?.persistence?.persistent !== false && sources?.squareSales?.live !== false && sources?.squareInventory?.live !== false && sources?.openai?.live === false;
  return <button className="cc-data-source-banner tone-warning" onClick={() => onView(onlyAssistantNeedsSetup ? 'settings' : 'connections')}><Icon name="alert" /><span><strong>Live setup needs attention</strong><small>{issues.join(' ')}</small></span><Icon name="arrow" /></button>;
}

function SalesView({ analytics, api, onSync, busy, onAsk }) {
  const [days, setDays] = useState(30);
  const [data, setData] = useState(analytics);
  const [loading, setLoading] = useState(false);
  useEffect(() => { setData(analytics); }, [analytics]);
  const changePeriod = async nextDays => {
    setDays(nextDays); setLoading(true);
    try { setData(await api(`/admin/command-center/sales?days=${nextDays}`)); }
    finally { setLoading(false); }
  };
  if (!data) return <div className="cc-page"><div className="cc-page-intro"><div><p className="cc-kicker">Square sales history</p><h2>Turn every sale into a better decision.</h2><p>Import item-level Square orders to see dependable trends, returns, and forecast readiness.</p></div><button className="cc-button cc-button--dark" onClick={() => onSync(365)} disabled={busy}><Icon name="refresh" /> Build sales history</button></div><section className="cc-panel"><EmptyState icon="trend" title="Sales history is ready to connect" text="The first sync imports one year of completed Square orders without changing anything in Square." /></section></div>;
  const summary = data.summary || {}; const quality = data.quality || {}; const top = data.topItems || []; const forecast = data.forecast || {};
  const maxDaily = Math.max(1, ...(data.daily || []).map(day => day.netSalesCents));
  return <div className="cc-page">
    <div className="cc-page-intro"><div><p className="cc-kicker">Square sales history</p><h2>Know what sells—and when.</h2><p>Item-level sales, returns, weekday patterns, and honest forecast readiness from your Square history.</p></div><div><button className="cc-button cc-button--soft" onClick={() => onAsk(`Explain what sold best in the last ${days} days and what changed from the prior period.`)}><Icon name="spark" /> Ask about sales</button><button className="cc-button cc-button--dark" onClick={() => onSync(365)} disabled={busy}><Icon name="refresh" /> {busy ? 'Updating…' : 'Update history'}</button></div></div>
    <section className={`cc-quality-banner tone-${quality.status === 'strong' ? 'success' : quality.status === 'usable' ? 'info' : 'warning'}`}><div className="cc-quality-score"><strong>{quality.score || 0}</strong><span>/ 100<br />data quality</span></div><div><p className="cc-kicker">Forecast foundation</p><h3>{quality.status === 'strong' ? 'Your sales history is strong.' : quality.status === 'usable' ? 'Good enough for cautious forecasting.' : 'History is still being built.'}</h3><p>{quality.rows || 0} item lines · {quality.historyDays || 0} sales days · {quality.catalogCoveragePercent || 0}% catalog linked · {quality.inventorySnapshotDays || 0} inventory days</p></div><StatusPill tone={quality.status === 'strong' ? 'success' : 'warning'}>{friendlyStatus(quality.status)}</StatusPill></section>
    {quality.warnings?.length > 0 && <div className="cc-quality-warnings">{quality.warnings.map(warning => <span key={warning}><Icon name="alert" />{warning}</span>)}</div>}
    <div className="cc-sales-controls"><div>{[7, 30, 90, 365].map(value => <button key={value} className={days === value ? 'active' : ''} onClick={() => changePeriod(value)}>{value === 365 ? '1 year' : `${value} days`}</button>)}</div><span>{loading ? 'Loading…' : `${shortDate(data.period?.from)}–${shortDate(data.period?.to)}`}</span></div>
    <div className="cc-booking-summary"><Metric label="Net item sales" value={money(summary.netSalesCents)} detail={changeLabel(summary.revenueChangePercent, 'previous period')} icon="trend" tone="green" /><Metric label="Items sold" value={formatNumber(summary.unitsSold)} detail={changeLabel(summary.unitChangePercent, 'previous period')} icon="boxes" tone="blue" /><Metric label="Average day" value={money(summary.averageDailySalesCents)} detail={`${formatNumber(summary.averageDailyUnits)} items per day`} icon="calendar" tone="violet" /><Metric label="Average ticket" value={money(summary.averageTicketCents)} detail={`${summary.transactions || 0} completed orders`} icon="clipboard" tone="amber" /></div>
    <div className="cc-sales-layout"><section className="cc-panel cc-sales-chart"><div className="cc-panel__heading"><div><p className="cc-kicker">Sales rhythm</p><h3>Net item sales by day</h3></div></div><div className="cc-bar-chart">{(data.daily || []).map((day, index) => <span key={day.date} title={`${shortDate(day.date)}: ${money(day.netSalesCents)}`} style={{ '--bar': `${Math.max(day.netSalesCents ? 3 : 0, day.netSalesCents / maxDaily * 100)}%` }}><i /><small>{data.daily.length <= 31 && (index % Math.max(1, Math.ceil(data.daily.length / 7)) === 0) ? shortMonth(day.date) + ' ' + dayNumber(day.date) : ''}</small></span>)}</div></section><section className="cc-panel cc-forecast-card"><div className="cc-panel__heading"><div><p className="cc-kicker">Next seven days</p><h3>Planning forecast</h3></div><StatusPill tone={forecast.ready ? 'success' : 'warning'}>{forecast.ready ? `${forecast.confidence} confidence` : 'Not ready'}</StatusPill></div><strong>{forecast.ready ? money(forecast.totalExpectedSalesCents) : 'Keep learning'}</strong><p>{forecast.note}</p><div>{(forecast.daily || []).map(day => <span key={day.date}><small>{new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(new Date(`${day.date}T12:00:00`))}</small><b>{forecast.ready ? money(day.expectedSalesCents) : '—'}</b></span>)}</div></section></div>
    <div className="cc-sales-layout"><section className="cc-panel"><div className="cc-panel__heading"><div><p className="cc-kicker">Product performance</p><h3>What’s selling</h3></div><span>{top.length} products</span></div><div className="cc-seller-list">{top.length ? top.slice(0, 20).map(item => <article key={item.squareVariationId || `${item.name}-${item.variationName}`}><b>{item.rank}</b><span><strong>{item.name}{item.variationName ? ` · ${item.variationName}` : ''}</strong><small>{[item.sku, item.category].filter(Boolean).join(' · ')}</small></span><span><strong>{formatNumber(item.unitsSold)}</strong><small>items</small></span><span><strong>{money(item.netSalesCents)}</strong><small>{changeLabel(item.salesChangePercent, 'prior')}</small></span>{!item.catalogMatched && <StatusPill tone="warning">Needs catalog link</StatusPill>}</article>) : <EmptyState icon="trend" title="No sales in this period" text="Try a longer date range or update Square history." />}</div></section><section className="cc-panel"><div className="cc-panel__heading"><div><p className="cc-kicker">Weekly pattern</p><h3>Best days of the week</h3></div></div><div className="cc-weekday-list">{(data.dayOfWeek || []).map(day => { const max = Math.max(1, ...(data.dayOfWeek || []).map(item => item.averageSalesCents)); return <article key={day.day}><span>{day.label}</span><i style={{ '--width': `${day.averageSalesCents / max * 100}%` }} /><b>{money(day.averageSalesCents)}</b><small>{formatNumber(day.averageUnits)} items</small></article>; })}</div></section></div>
  </div>;
}

function Metric({ label, value, detail, icon, tone }) {
  return <article className="cc-metric"><div className={`cc-metric__icon tone-${tone}`}><Icon name={icon} /></div><p>{label}</p><strong>{value}</strong><span>{detail}</span></article>;
}

function Assistant({ messages, conversations, activeConversationId, onConversation, onNew, text, setText, attachments, setAttachments, onFiles, onSend, busy, pending, liveReply, liveActivity, overview = null, openAiStatus = null, compact = false, voiceState = 'off', onVoice = null }) {
  const threadRef = useRef(null);
  useEffect(() => { threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: 'smooth' }); }, [messages, pending, liveReply, liveActivity]);
  // Turns interrupted mid-approval persist an assistant message with tool
  // calls but no text — don't render those as empty bubbles.
  const visibleMessages = messages.filter(message => (message.role === 'user' || message.role === 'assistant')
    && (String(message.content || '').trim() || (message.metadata?.attachments || []).length));
  const connectorChips = [
    ...(overview?.square ? [{ label: 'Square', ok: Boolean(overview.square.connected) }] : []),
    ...(openAiStatus ? [{ label: 'Assistant', ok: openAiStatus.status === 'connected' }] : []),
    ...(overview?.connectors || []).map(connection => ({ label: connection.displayName, ok: connection.status === 'connected' })),
  ];
  return (
    <div className={compact ? 'cc-assistant cc-assistant--compact' : 'cc-assistant'}>
      {!compact && <aside className="cc-chat-history"><button className="cc-button cc-button--dark" onClick={onNew}><Icon name="plus" /> New conversation</button><p className="cc-kicker">Recent</p>{conversations.map(conversation => <button key={conversation.id} className={conversation.id === activeConversationId ? 'active' : ''} onClick={() => onConversation(conversation.id)}><Icon name="message" /><span><strong>{conversation.title || 'Conversation'}</strong><small>{shortDate(conversation.updatedAt)}</small></span></button>)}</aside>}
      <section
        className="cc-chat-pane"
        onDragOver={event => { event.preventDefault(); }}
        onDrop={event => { event.preventDefault(); if (event.dataTransfer?.files?.length) onFiles(event.dataTransfer.files); }}
      >
        {connectorChips.length > 0 && (
          <div className="cc-connector-chips" aria-label="Connected systems">
            {connectorChips.map(chip => <span key={chip.label} className={chip.ok ? 'is-on' : 'is-off'}><i />{chip.label}</span>)}
          </div>
        )}
        <div className="cc-chat-thread" ref={threadRef}>
          {!visibleMessages.length && <div className="cc-chat-empty"><div className="cc-assistant-mark"><Icon name="spark" /></div><p className="cc-kicker">Midway assistant</p><h2>What can I take care of?</h2><p>Ask about sales, inventory, orders, vendors, bookings—or attach a shelf photo, invoice, PDF, or spreadsheet.</p><div>{QUICK_PROMPTS.map(([label, prompt]) => <button key={label} onClick={() => setText(prompt)}>{label}<Icon name="arrow" /></button>)}</div></div>}
          {visibleMessages.map(message => <ChatMessage key={message.id || `${message.role}-${message.createdAt}`} message={message} />)}
          {busy && <LiveAssistant reply={liveReply} activity={liveActivity} />}
        </div>
        {pending && <div className="cc-approval"><div><Icon name="shield" /><span><strong>Please confirm this action</strong><small>{friendlyConfirmation(pending)}</small></span></div><div><button className="cc-button cc-button--ghost" onClick={event => onSend(event, false)} disabled={busy}>Not now</button><button className="cc-button cc-button--primary" onClick={event => onSend(event, true)} disabled={busy}>Yes, go ahead</button></div></div>}
        <form className="cc-composer" onSubmit={onSend}>
          {attachments.length > 0 && <div className="cc-attachment-row">{attachments.map((file, index) => <span key={`${file.name}-${index}`}><Icon name={file.type.startsWith('image/') ? 'image' : 'file'} /><b>{file.name}</b><button type="button" onClick={() => setAttachments(current => current.filter((_, itemIndex) => itemIndex !== index))}>×</button></span>)}</div>}
          <textarea value={text} onChange={event => setText(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); onSend(event); } }} onPaste={event => { const files = [...(event.clipboardData?.files || [])]; if (files.length) { event.preventDefault(); onFiles(files); } }} placeholder="Ask about the store, or attach, paste, or drop a photo or file…" rows="2" />
          <div><label className="cc-upload"><Icon name="paperclip" /><span>Attach</span><input type="file" multiple accept="image/*,.pdf,.csv,.tsv,.xlsx,.xls,.docx,.txt,.md,.json" onChange={event => { onFiles(event.target.files); event.target.value = ''; }} /></label><small>Photos, invoices, PDFs, and spreadsheets</small>{onVoice && <button type="button" className={`cc-voice is-${voiceState}`} onClick={onVoice} aria-label={voiceState === 'off' ? 'Talk to Midway' : 'Stop voice'} title={voiceState === 'off' ? 'Talk to Midway' : voiceState === 'connecting' ? 'Connecting…' : 'Voice is live — click to stop'}><Icon name="mic" />{voiceState === 'live' && <i className="cc-voice-pulse" aria-hidden="true" />}</button>}<button className="cc-send" disabled={busy || (!text.trim() && !attachments.length)} aria-label="Send message"><Icon name="arrowUp" /></button></div>
        </form>
      </section>
    </div>
  );
}

function LiveAssistant({ reply, activity }) {
  return <div className="cc-chat-message is-assistant cc-live-assistant" aria-live="polite" aria-label="Midway is working"><div className="cc-assistant-mark"><Icon name="spark" /></div><div className="cc-chat-bubble">{activity.length > 0 && <div className="cc-live-activity">{activity.slice(-4).map(item => <div key={item.id} className={`is-${item.status}`}><i>{item.status === 'done' ? <Icon name="check" /> : item.status === 'error' ? <Icon name="alert" /> : <span />}</i><span>{item.label}</span></div>)}</div>}{reply && <div className="cc-md cc-streaming-text">{renderMarkdown(reply)}<span className="cc-stream-cursor" aria-hidden="true" /></div>}{!reply && !activity.length && <div className="is-thinking"><span /><span /><span /></div>}</div></div>;
}

function ChatMessage({ message }) {
  const isUser = message.role === 'user';
  const files = message.metadata?.attachments || [];
  return <div className={`cc-chat-message ${isUser ? 'is-user' : 'is-assistant'}`}>{!isUser && <div className="cc-assistant-mark"><Icon name="spark" /></div>}<div className="cc-chat-bubble">{files.length > 0 && <div className="cc-message-files">{files.map(file => <span key={file.name}><Icon name={file.type?.startsWith('image/') ? 'image' : 'file'} />{file.name}</span>)}</div>}{isUser ? <p>{message.content}</p> : <div className="cc-md">{renderMarkdown(message.content)}</div>}<time>{shortTime(message.createdAt)}</time></div></div>;
}

// Lightweight markdown → React renderer for assistant replies (headings,
// bold/italic, inline code, bullet and numbered lists). Builds React elements
// only — no HTML injection.
function renderInlineMarkdown(text, keyPrefix = 'i') {
  const parts = [];
  const pattern = /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`\n]+`)/g;
  let cursor = 0;
  let index = 0;
  for (const match of String(text || '').matchAll(pattern)) {
    if (match.index > cursor) parts.push(text.slice(cursor, match.index));
    const token = match[0];
    if (token.startsWith('**')) parts.push(<strong key={`${keyPrefix}-${index}`}>{token.slice(2, -2)}</strong>);
    else if (token.startsWith('`')) parts.push(<code key={`${keyPrefix}-${index}`}>{token.slice(1, -1)}</code>);
    else parts.push(<em key={`${keyPrefix}-${index}`}>{token.slice(1, -1)}</em>);
    cursor = match.index + token.length;
    index += 1;
  }
  if (cursor < String(text || '').length) parts.push(text.slice(cursor));
  return parts;
}
function renderMarkdown(raw) {
  const lines = String(raw || '').split('\n');
  const blocks = [];
  let list = null;
  const flushList = () => {
    if (!list) return;
    const ListTag = list.ordered ? 'ol' : 'ul';
    blocks.push(<ListTag key={`b-${blocks.length}`}>{list.items.map((item, itemIndex) => <li key={itemIndex}>{renderInlineMarkdown(item, `li-${blocks.length}-${itemIndex}`)}</li>)}</ListTag>);
    list = null;
  };
  lines.forEach((line, lineIndex) => {
    const heading = line.match(/^(#{1,6})\s*(.+)$/);
    const bullet = line.match(/^\s*[-*•]\s+(.+)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (heading) {
      flushList();
      const level = Math.min(heading[1].length, 4);
      const HeadingTag = `h${Math.max(3, level + 1)}`;
      blocks.push(<HeadingTag key={`b-${blocks.length}`}>{renderInlineMarkdown(heading[2], `h-${lineIndex}`)}</HeadingTag>);
    } else if (bullet) {
      if (!list || list.ordered) { flushList(); list = { ordered: false, items: [] }; }
      list.items.push(bullet[1]);
    } else if (numbered) {
      if (!list || !list.ordered) { flushList(); list = { ordered: true, items: [] }; }
      list.items.push(numbered[1]);
    } else if (!line.trim()) {
      flushList();
    } else {
      flushList();
      blocks.push(<p key={`b-${blocks.length}`}>{renderInlineMarkdown(line, `p-${lineIndex}`)}</p>);
    }
  });
  flushList();
  return blocks;
}

function InventoryView({ items, total, search, setSearch, filter, setFilter, onSync, syncProgress, busy, onAsk, api, onRefresh, reconciliations = [], user }) {
  const [editing, setEditing] = useState(null);
  const [counting, setCounting] = useState(false);
  const [reviewing, setReviewing] = useState(null);
  const [working, setWorking] = useState(false);
  const [localError, setLocalError] = useState('');
  const saveRule = async event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await api(`/admin/command-center/inventory/${encodeURIComponent(editing.squareVariationId)}/rule`, { method: 'PATCH', body: { reorderPoint: form.get('reorderPoint'), targetStock: form.get('targetStock') } });
    setEditing(null);
    onRefresh();
  };
  const createCount = async event => {
    event.preventDefault();
    setWorking(true);
    setLocalError('');
    try {
      const form = new FormData(event.currentTarget);
      const lines = items.flatMap(item => {
        const value = form.get(`count-${item.squareVariationId}`);
        return value === '' || value === null ? [] : [{ squareVariationId: item.squareVariationId, countedQuantity: Number(value) }];
      });
      if (!lines.length) throw new Error('Enter at least one shelf count.');
      const created = await api('/admin/command-center/reconciliations', { method: 'POST', body: { lines, notes: form.get('notes') } });
      setCounting(false);
      setReviewing(created);
      await onRefresh();
    } catch (countError) {
      setLocalError(countError.message);
    } finally {
      setWorking(false);
    }
  };
  const applyCount = async reconciliation => {
    setWorking(true);
    setLocalError('');
    try {
      await api(`/admin/command-center/reconciliations/${encodeURIComponent(reconciliation.id)}/apply`, { method: 'POST', body: {} });
      setReviewing(null);
      await onRefresh();
    } catch (countError) {
      setLocalError(countError.message);
    } finally {
      setWorking(false);
    }
  };
  return (
    <div className="cc-page">
      <div className="cc-page-intro"><div><p className="cc-kicker">Square inventory</p><h2>Know what’s on the shelf.</h2><p>Live product information from Square, with vendor and reorder details layered on top.</p></div><div><button className="cc-button cc-button--soft" onClick={onSync} disabled={busy}><Icon name="refresh" /> {syncButtonLabel(syncProgress, 'Sync Square')}</button><button className="cc-button cc-button--dark" onClick={() => setCounting(true)} disabled={!items.length}><Icon name="camera" /> Start a count</button></div></div>
      <div className="cc-toolbar"><label><Icon name="search" /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search products, SKU, category, or vendor" /></label><div>{[['all', `All ${total}`], ['low', 'Running low'], ['unmapped', 'Needs vendor']].map(([id, label]) => <button key={id} className={filter === id ? 'active' : ''} onClick={() => setFilter(id)}>{label}</button>)}</div></div>
      <div className="cc-inventory-table">
        <div className="cc-table-head"><span>Product</span><span>On hand</span><span>Reorder at</span><span>Vendor</span><span>Status</span><span /></div>
        {items.length ? items.map(item => <div className="cc-table-row" key={item.squareVariationId}><span className="cc-product"><i>{item.name.slice(0, 1)}</i><b>{item.name}<small>{[item.sku, item.category].filter(Boolean).join(' · ')}</small></b></span><span className="cc-quantity">{item.quantity ?? '—'}</span><span>{item.reorderPoint ?? 'Not set'}</span><span>{item.vendorName || <em>Not mapped</em>}</span><span><StatusPill tone={item.isLowStock ? 'warning' : item.quantity === null ? 'neutral' : 'success'}>{item.isLowStock ? 'Running low' : item.quantity === null ? 'Not counted' : 'Healthy'}</StatusPill></span><span><button className="cc-row-action" onClick={() => setEditing(item)}>Set levels</button></span></div>) : <EmptyState icon="boxes" title="No products match" text="Try another search or pull the latest catalog from Square." />}
      </div>
      <section className="cc-panel cc-reconciliation-panel">
        <div className="cc-panel__heading"><div><p className="cc-kicker">Count history</p><h3>Inventory reconciliation</h3></div><button className="cc-row-action" onClick={() => onAsk('Review my latest inventory count and explain the differences.')}>Ask Midway</button></div>
        {reconciliations.length ? reconciliations.slice(0, 8).map(session => <button className="cc-reconciliation-row" key={session.id} onClick={() => setReviewing(session)}><span><strong>{shortDate(session.startedAt || session.createdAt)}</strong><small>{session.lines?.length || 0} products counted</small></span><span><b>{session.exceptionCount || 0}</b><small>differences</small></span><StatusPill tone={session.status === 'resolved' ? 'success' : 'warning'}>{friendlyStatus(session.status)}</StatusPill><Icon name="arrow" /></button>) : <EmptyState icon="camera" title="No counts yet" text="Start a count to compare what is on the shelf with Square." />}
      </section>
      {editing && <Modal title={`Stock levels for ${editing.name}`} onClose={() => setEditing(null)}><form className="cc-simple-form" onSubmit={saveRule}><p>Midway will flag this item when the Square count reaches the reorder level.</p><label>Reorder when there are<input name="reorderPoint" type="number" min="0" defaultValue={editing.reorderPoint ?? ''} required /></label><label>Order enough to reach<input name="targetStock" type="number" min="0" defaultValue={editing.targetStock ?? ''} required /></label><div><button type="button" className="cc-button cc-button--ghost" onClick={() => setEditing(null)}>Cancel</button><button className="cc-button cc-button--primary">Save levels</button></div></form></Modal>}
      {counting && <Modal title="Count what is on the shelf" onClose={() => setCounting(false)}><form className="cc-count-form" onSubmit={createCount}><p>Enter only the products you counted. Midway will show every difference before anything changes in Square.</p>{localError && <div className="cc-form-error">{localError}</div>}<div className="cc-count-list">{items.map(item => <label key={item.squareVariationId}><span><strong>{item.name}</strong><small>Square says {item.quantity ?? 'not counted'}{item.sku ? ` · ${item.sku}` : ''}</small></span><input name={`count-${item.squareVariationId}`} type="number" min="0" step="0.01" inputMode="decimal" placeholder="Actual" /></label>)}</div><label>Count notes<textarea name="notes" rows="2" placeholder="Example: counted front cooler and back stock" /></label><div><button type="button" className="cc-button cc-button--ghost" onClick={() => setCounting(false)}>Cancel</button><button className="cc-button cc-button--primary" disabled={working}>{working ? 'Comparing…' : 'Review differences'}</button></div></form></Modal>}
      {reviewing && <Modal title={reviewing.status === 'resolved' ? 'Completed inventory count' : 'Review inventory differences'} onClose={() => setReviewing(null)}><div className="cc-count-review"><p>{reviewing.status === 'resolved' ? 'These counts were sent to Square.' : 'Nothing has changed yet. Check the actual counts, then approve the update.'}</p>{localError && <div className="cc-form-error">{localError}</div>}<div>{(reviewing.lines || []).map(line => { const item = items.find(candidate => candidate.squareVariationId === line.squareVariationId); return <article key={line.squareVariationId}><span><strong>{item?.name || line.name || line.squareVariationId}</strong><small>Square {line.expectedQuantity ?? line.previousQuantity ?? '—'} → Counted {line.countedQuantity}</small></span><b className={Number(line.variance) === 0 ? '' : Number(line.variance) < 0 ? 'is-negative' : 'is-positive'}>{Number(line.variance) > 0 ? '+' : ''}{line.variance ?? 0}</b></article>; })}</div>{reviewing.status !== 'resolved' && user?.role === 'owner' && <footer><button className="cc-button cc-button--ghost" onClick={() => setReviewing(null)}>Go back</button><button className="cc-button cc-button--primary" disabled={working} onClick={() => applyCount(reviewing)}>{working ? 'Updating Square…' : 'Approve and update Square'}</button></footer>}</div></Modal>}
    </div>
  );
}

function OrdersView({ overview, onAsk }) {
  const orders = overview?.purchaseOrders || [];
  return <div className="cc-page"><div className="cc-page-intro"><div><p className="cc-kicker">Purchasing</p><h2>Order only what you need.</h2><p>Drafts stay inside Midway until you review and approve them.</p></div><button className="cc-button cc-button--dark" onClick={() => onAsk('Build a reorder draft from low-stock items. Group it by vendor and do not send anything yet.')}><Icon name="spark" /> Build an order with Midway</button></div><div className="cc-order-grid"><section className="cc-panel"><div className="cc-panel__heading"><div><p className="cc-kicker">Purchase orders</p><h3>Recent orders</h3></div></div>{orders.length ? orders.map(order => <article className="cc-order" key={order.id}><div><StatusPill tone={order.status === 'draft' ? 'warning' : 'success'}>{friendlyStatus(order.status)}</StatusPill><strong>{order.orderNumber}</strong><span>{order.lines?.length || 0} items · {money(order.subtotalCents)}</span></div><button className="cc-row-action" onClick={() => onAsk(`Review purchase order ${order.orderNumber} and tell me what needs checking.`)}>Review</button></article>) : <EmptyState icon="clipboard" title="No orders yet" text="Ask Midway to turn low-stock items into a draft." />}</section><section className="cc-panel cc-order-how"><div className="cc-panel__heading"><div><p className="cc-kicker">Simple and safe</p><h3>How ordering works</h3></div></div>{[['1', 'Midway finds low stock', 'Square counts and saved reorder levels are checked.'], ['2', 'You review the draft', 'Case sizes, quantities, and estimated cost stay editable.'], ['3', 'You approve the order', 'Nothing reaches a vendor until you say yes.'], ['4', 'Receiving closes the loop', 'Upload the packing slip and Midway updates the count.']].map(step => <div className="cc-how-step" key={step[0]}><i>{step[0]}</i><span><strong>{step[1]}</strong><small>{step[2]}</small></span></div>)}</section></div></div>;
}

function VendorsView({ overview, api, onRefresh, user }) {
  const [showForm, setShowForm] = useState(false);
  const create = async event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await api('/admin/command-center/vendors', { method: 'POST', body: Object.fromEntries(form) });
    setShowForm(false);
    onRefresh();
  };
  return <div className="cc-page"><div className="cc-page-intro"><div><p className="cc-kicker">Vendor network</p><h2>Every supplier, one place.</h2><p>Track who supplies what today, then add MCP or API connections when each vendor is ready.</p></div>{user?.role === 'owner' && <button className="cc-button cc-button--dark" onClick={() => setShowForm(true)}><Icon name="plus" /> Add vendor</button>}</div><div className="cc-vendor-grid">{(overview?.vendors || []).map(vendor => <article className="cc-vendor-card" key={vendor.id}><div className="cc-vendor-card__logo">{vendor.name.slice(0, 2).toUpperCase()}</div><div><StatusPill tone={vendor.status === 'active' ? 'success' : 'neutral'}>{vendor.status}</StatusPill><h3>{vendor.name}</h3><p>{vendor.notes || 'Vendor details are ready to be completed.'}</p></div><dl><div><dt>Ordering</dt><dd>{friendlyStatus(vendor.orderingMethod)}</dd></div><div><dt>Order day</dt><dd>{vendor.orderDay || 'Not set'}</dd></div><div><dt>Connection</dt><dd>{overview?.connectors?.some(connection => connection.vendorId === vendor.id && connection.status === 'connected') ? 'MCP connected' : 'Manual for now'}</dd></div></dl></article>)}</div>{showForm && <Modal title="Add a vendor" onClose={() => setShowForm(false)}><form className="cc-simple-form" onSubmit={create}><label>Vendor name<input name="name" required autoFocus /></label><label>How do you order?<select name="orderingMethod" defaultValue="manual"><option value="manual">Manually</option><option value="portal">Vendor website</option><option value="email">Email</option><option value="api">API</option><option value="mcp">MCP connection</option></select></label><label>Usual order day<input name="orderDay" placeholder="Example: Tuesday" /></label><label>Notes<textarea name="notes" rows="3" /></label><div><button type="button" className="cc-button cc-button--ghost" onClick={() => setShowForm(false)}>Cancel</button><button className="cc-button cc-button--primary">Add vendor</button></div></form></Modal>}</div>;
}

function BookingsView({ bookings, sites, overview, onAsk, api, onRefresh, user }) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('active');
  const [createMode, setCreateMode] = useState('');
  const [selected, setSelected] = useState(null);
  const [editing, setEditing] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [confirming, setConfirming] = useState(null);
  const [localError, setLocalError] = useState('');
  const [working, setWorking] = useState(false);
  const visible = bookings.filter(booking => {
    const needle = search.toLowerCase();
    const matchesSearch = !needle || [booking.bookingCode, booking.customerName, booking.customer?.name, booking.customerEmail, booking.customerPhone, booking.rvSiteId, booking.siteNumber].some(value => String(value || '').toLowerCase().includes(needle));
    const matchesStatus = status === 'all' || (status === 'active' ? ['confirmed', 'paid', 'hold', 'pending'].includes(booking.status) : booking.status === status);
    return matchesSearch && matchesStatus;
  });
  const openBooking = async booking => {
    setSelected(booking);
    setDocuments([]);
    setLocalError('');
    try { setDocuments(await api(`/admin/bookings/${encodeURIComponent(booking.bookingCode)}/documents`)); } catch (documentError) { setLocalError(documentError.message); }
  };
  const createBooking = async event => {
    event.preventDefault();
    setWorking(true);
    setLocalError('');
    try {
      const form = new FormData(event.currentTarget);
      const payload = {
        siteId: form.get('siteId'), startDate: form.get('startDate'), endDate: form.get('endDate'),
        guests: Number(form.get('guests') || 1), vehicles: Number(form.get('vehicles') || 1),
        customer: { name: form.get('customerName'), phone: form.get('customerPhone'), email: form.get('customerEmail') },
        notes: form.get('notes'),
      };
      if (createMode === 'block') {
        await api(`/admin/rv-sites/${encodeURIComponent(payload.siteId)}/block`, { method: 'POST', body: { startDate: payload.startDate, endDate: payload.endDate, reason: form.get('reason') } });
      } else if (createMode === 'payment') {
        const result = await api('/admin/bookings/checkout', { method: 'POST', body: payload });
        if (!result.checkout?.checkoutUrl) throw new Error('Square did not return a payment link.');
        window.open(result.checkout.checkoutUrl, '_blank', 'noopener,noreferrer');
      } else {
        await api('/admin/bookings', { method: 'POST', body: { ...payload, status: 'confirmed' } });
      }
      setCreateMode('');
      await onRefresh();
    } catch (bookingError) {
      setLocalError(bookingError.message);
    } finally { setWorking(false); }
  };
  const runBookingAction = async () => {
    setWorking(true);
    setLocalError('');
    try {
      const path = confirming.action === 'refund' ? 'refund' : 'cancel';
      await api(`/admin/bookings/${encodeURIComponent(confirming.booking.bookingCode)}/${path}`, { method: 'POST', body: { reason: confirming.reason || `${friendlyStatus(path)} from command center` } });
      setConfirming(null); setSelected(null); await onRefresh();
    } catch (bookingError) { setLocalError(bookingError.message); }
    finally { setWorking(false); }
  };
  const reviewDocument = async (documentId, nextStatus) => {
    try {
      await api(`/admin/bookings/${encodeURIComponent(selected.bookingCode)}/documents/${encodeURIComponent(documentId)}`, { method: 'PATCH', body: { status: nextStatus } });
      setDocuments(await api(`/admin/bookings/${encodeURIComponent(selected.bookingCode)}/documents`));
    } catch (documentError) { setLocalError(documentError.message); }
  };
  const changeSiteStatus = async (site, nextStatus) => {
    try { await api(`/admin/rv-sites/${encodeURIComponent(site.id)}`, { method: 'PATCH', body: { status: nextStatus } }); await onRefresh(); }
    catch (siteError) { setLocalError(siteError.message); }
  };
  return <div className="cc-page">
    <div className="cc-page-intro"><div><p className="cc-kicker">RV park</p><h2>Today’s guests, at a glance.</h2><p>Create stays, collect payment, manage sites, and review guest documents in one calm view.</p></div><div>{user?.role === 'owner' && <button className="cc-button cc-button--soft" onClick={() => setCreateMode('manual')}><Icon name="plus" /> New booking</button>}<button className="cc-button cc-button--dark" onClick={() => onAsk('Summarize today’s RV arrivals and departures. Flag anything unusual.')}><Icon name="spark" /> Ask about bookings</button></div></div>
    {localError && <div className="cc-inline-alert"><Icon name="alert" />{localError}<button onClick={() => setLocalError('')}>×</button></div>}
    <div className="cc-booking-summary"><Metric label="Arriving today" value={overview?.dashboard?.arrivals?.length || 0} detail="Guests to welcome" icon="arrowDown" tone="green" /><Metric label="Leaving today" value={overview?.dashboard?.departures?.length || 0} detail="Sites turning over" icon="arrowUp" tone="blue" /><Metric label="Upcoming stays" value={bookings.filter(item => ['confirmed', 'paid', 'hold'].includes(item.status)).length} detail="Active reservations" icon="calendar" tone="violet" /></div>
    <div className="cc-booking-layout"><section className="cc-panel"><div className="cc-panel__heading"><div><p className="cc-kicker">Reservations</p><h3>Find a booking</h3></div>{user?.role === 'owner' && <button className="cc-row-action" onClick={() => setCreateMode('payment')}>Send payment link</button>}</div><div className="cc-booking-tools"><label><Icon name="search" /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Guest, booking code, phone, or site" /></label><select value={status} onChange={event => setStatus(event.target.value)}><option value="active">Active stays</option><option value="all">All bookings</option><option value="confirmed">Confirmed</option><option value="paid">Paid</option><option value="pending">Pending payment</option><option value="canceled">Canceled</option><option value="refunded">Refunded</option><option value="blocked">Blocked dates</option></select></div><div className="cc-booking-list">{visible.length ? visible.slice(0, 100).map(booking => <button key={booking.id || booking.bookingCode} onClick={() => openBooking(booking)}><div className="cc-date-block"><strong>{shortMonth(booking.startDate)}</strong><span>{dayNumber(booking.startDate)}</span></div><div><strong>{booking.customerName || booking.customer?.name || (booking.status === 'blocked' ? 'Blocked dates' : 'Guest')}</strong><span>{siteLabel(booking, sites)} · {shortDate(booking.startDate)}–{shortDate(booking.endDate)}</span><small>{booking.bookingCode} {booking.totalCents !== undefined ? `· ${money(booking.totalCents)}` : ''}</small></div><StatusPill tone={bookingTone(booking.status)}>{friendlyStatus(booking.status)}</StatusPill><Icon name="arrow" /></button>) : <EmptyState icon="calendar" title="No bookings found" text="Try another search or status." />}</div></section>
    <section className="cc-panel cc-site-panel"><div className="cc-panel__heading"><div><p className="cc-kicker">RV sites</p><h3>Site availability</h3></div>{user?.role === 'owner' && <button className="cc-row-action" onClick={() => setCreateMode('block')}>Block dates</button>}</div><div className="cc-site-grid">{sites.map(site => <article key={site.id}><span><strong>{site.name || site.siteNumber || site.id}</strong><small>{[site.type, site.shade].filter(Boolean).join(' · ') || 'RV site'}</small></span><StatusPill tone={site.status === 'active' || site.status === 'available' ? 'success' : 'warning'}>{friendlyStatus(site.status || 'active')}</StatusPill>{user?.role === 'owner' && <select aria-label={`Change ${site.name || site.id} status`} value={site.status || 'active'} onChange={event => changeSiteStatus(site, event.target.value)}><option value="active">Open</option><option value="maintenance">Maintenance</option><option value="inactive">Closed</option></select>}</article>)}</div></section></div>
    {createMode && <Modal title={createMode === 'block' ? 'Block a site' : createMode === 'payment' ? 'Create booking and payment link' : 'Create a booking'} onClose={() => { setCreateMode(''); setLocalError(''); }}><BookingCreateForm mode={createMode} sites={sites} onSubmit={createBooking} onClose={() => setCreateMode('')} working={working} error={localError} /></Modal>}
    {selected && <Modal title={`Booking ${selected.bookingCode}`} onClose={() => setSelected(null)}><div className="cc-booking-detail"><div className="cc-booking-detail__hero"><div className="cc-date-block"><strong>{shortMonth(selected.startDate)}</strong><span>{dayNumber(selected.startDate)}</span></div><span><StatusPill tone={bookingTone(selected.status)}>{friendlyStatus(selected.status)}</StatusPill><h3>{selected.customerName || selected.customer?.name || 'Guest'}</h3><p>{siteLabel(selected, sites)} · {shortDate(selected.startDate)} to {shortDate(selected.endDate)}</p></span></div><dl><div><dt>Total</dt><dd>{money(selected.totalCents)}</dd></div><div><dt>Guests</dt><dd>{selected.guests || 1}</dd></div><div><dt>Vehicles</dt><dd>{selected.vehicles ?? 1}</dd></div><div><dt>Contact</dt><dd>{selected.customerPhone || selected.customer?.phone || selected.customerEmail || selected.customer?.email || 'Not provided'}</dd></div></dl><section><h4>Guest documents</h4>{documents.length ? documents.map(document => <article className="cc-document" key={document.id}><span><Icon name="file" /><b>{document.fileName || document.type || 'Driver license'}<small>{friendlyStatus(document.status || 'pending')}</small></b></span><div>{(document.signedUrl || document.url) && <a className="cc-row-action" href={document.signedUrl || document.url} target="_blank" rel="noreferrer">View</a>}<button className="cc-row-action" onClick={() => reviewDocument(document.id, 'verified')}>Verify</button><button className="cc-row-action is-danger" onClick={() => reviewDocument(document.id, 'rejected')}>Reject</button></div></article>) : <p className="cc-muted">No guest documents uploaded.</p>}</section>{user?.role === 'owner' && <footer>{['confirmed', 'paid'].includes(selected.status) && <button className="cc-button cc-button--soft" onClick={() => { setEditing(selected); setSelected(null); }}>Edit stay</button>}{['confirmed', 'paid'].includes(selected.status) && <button className="cc-button cc-button--ghost" onClick={() => setConfirming({ action: 'cancel', booking: selected, reason: '' })}>Cancel booking</button>}{['confirmed', 'paid'].includes(selected.status) && selected.squarePaymentId && <button className="cc-button cc-button--danger" onClick={() => setConfirming({ action: 'refund', booking: selected, reason: '' })}>Issue refund</button>}</footer>}</div></Modal>}
    {editing && <BookingEditModal booking={editing} sites={sites} api={api} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await onRefresh(); }} />}
    {confirming && <Modal title={confirming.action === 'refund' ? 'Confirm Square refund' : 'Cancel this booking?'} onClose={() => setConfirming(null)}><div className="cc-confirm-action"><Icon name="shield" /><h3>{confirming.action === 'refund' ? `Refund ${money(confirming.booking.totalCents)}?` : `Cancel ${confirming.booking.bookingCode}?`}</h3><p>{confirming.action === 'refund' ? 'This sends money back through Square and records the result. It cannot be undone here.' : 'The site dates will become available again. This does not automatically issue a refund.'}</p>{localError && <div className="cc-form-error">{localError}</div>}<label>Reason<textarea value={confirming.reason} onChange={event => setConfirming(current => ({ ...current, reason: event.target.value }))} rows="2" placeholder="Why is this happening?" /></label><div><button className="cc-button cc-button--ghost" onClick={() => setConfirming(null)}>Go back</button><button className={`cc-button ${confirming.action === 'refund' ? 'cc-button--danger' : 'cc-button--primary'}`} onClick={runBookingAction} disabled={working}>{working ? 'Working…' : confirming.action === 'refund' ? 'Yes, issue refund' : 'Yes, cancel booking'}</button></div></div></Modal>}
  </div>;
}

function BookingCreateForm({ mode, sites, onSubmit, onClose, working, error }) {
  const tomorrow = isoDateOffset(1); const nextDay = isoDateOffset(2);
  return <form className="cc-simple-form" onSubmit={onSubmit}>{mode === 'payment' && <p>Midway will hold the site and open a secure Square payment link you can send to the guest.</p>}{mode === 'block' && <p>Use this for maintenance, owner stays, or any dates that should not be bookable.</p>}{error && <div className="cc-form-error">{error}</div>}<label>RV site<select name="siteId" required autoFocus><option value="">Choose a site</option>{sites.map(site => <option key={site.id} value={site.id}>{site.name || site.siteNumber || site.id} · {friendlyStatus(site.status || 'active')}</option>)}</select></label><div className="cc-form-pair"><label>Arrival<input type="date" name="startDate" defaultValue={tomorrow} required /></label><label>Departure<input type="date" name="endDate" defaultValue={nextDay} required /></label></div>{mode === 'block' ? <label>Reason<input name="reason" required placeholder="Example: electrical repair" /></label> : <><label>Guest name<input name="customerName" required placeholder="Full name" /></label><div className="cc-form-pair"><label>Phone<input name="customerPhone" type="tel" /></label><label>Email<input name="customerEmail" type="email" /></label></div><div className="cc-form-pair"><label>Guests<input name="guests" type="number" min="1" defaultValue="1" /></label><label>Vehicles<input name="vehicles" type="number" min="0" defaultValue="1" /></label></div><label>Notes<textarea name="notes" rows="2" /></label></>}<div><button type="button" className="cc-button cc-button--ghost" onClick={onClose}>Cancel</button><button className="cc-button cc-button--primary" disabled={working}>{working ? 'Saving…' : mode === 'payment' ? 'Create payment link' : mode === 'block' ? 'Block these dates' : 'Create booking'}</button></div></form>;
}

function BookingEditModal({ booking, sites, api, onClose, onSaved }) {
  const [payment, setPayment] = useState(null); const [card, setCard] = useState(null); const [error, setError] = useState(''); const [working, setWorking] = useState(false); const formRef = useRef(null);
  useEffect(() => {
    if (!payment?.checkoutConfig) return undefined;
    let disposed = false; let mountedCard;
    (async () => {
      try {
        const config = payment.checkoutConfig;
        if (!window.Square) await loadExternalScript(config.environment === 'production' ? 'https://web.squarecdn.com/v1/square.js' : 'https://sandbox.web.squarecdn.com/v1/square.js');
        const payments = window.Square.payments(config.applicationId, config.locationId);
        mountedCard = await payments.card();
        await mountedCard.attach('#cc-square-card');
        if (!disposed) setCard(mountedCard);
      } catch (squareError) { if (!disposed) setError(`Square card form could not load: ${squareError.message}`); }
    })();
    return () => { disposed = true; mountedCard?.destroy?.(); };
  }, [payment]);
  const submit = async event => {
    event.preventDefault(); setWorking(true); setError('');
    try {
      const form = new FormData(formRef.current);
      const body = { startDate: form.get('startDate'), endDate: form.get('endDate'), siteIds: [form.get('siteId')], guests: Number(form.get('guests') || 1), vehicles: Number(form.get('vehicles') || 0) };
      if (payment) {
        if (!card) throw new Error('Wait for the secure Square card form to finish loading.');
        const token = await card.tokenize();
        if (token.status !== 'OK') throw new Error(token.errors?.[0]?.message || 'The card could not be authorized.');
        body.sourceId = token.token; body.idempotencyKey = `edit-${booking.bookingCode}-${Date.now()}`.slice(0, 45);
      }
      await api(`/admin/bookings/${encodeURIComponent(booking.bookingCode)}`, { method: 'PATCH', body });
      await onSaved();
    } catch (editError) {
      if (editError.status === 402 && editError.data?.diffCents > 0) setPayment(editError.data);
      else setError(editError.message);
    } finally { setWorking(false); }
  };
  return <Modal title={`Edit ${booking.bookingCode}`} onClose={onClose}><form className="cc-simple-form" ref={formRef} onSubmit={submit}><p>Midway checks site availability and recalculates the stay before saving.</p>{error && <div className="cc-form-error">{error}</div>}<label>RV site<select name="siteId" defaultValue={booking.rvSiteId || booking.siteIds?.[0]} required>{sites.map(site => <option key={site.id} value={site.id}>{site.name || site.siteNumber || site.id}</option>)}</select></label><div className="cc-form-pair"><label>Arrival<input type="date" name="startDate" defaultValue={booking.startDate} required /></label><label>Departure<input type="date" name="endDate" defaultValue={booking.endDate} required /></label></div><div className="cc-form-pair"><label>Guests<input name="guests" type="number" min="1" defaultValue={booking.guests || 1} /></label><label>Vehicles<input name="vehicles" type="number" min="0" defaultValue={booking.vehicles ?? 1} /></label></div>{payment && <section className="cc-square-payment"><StatusPill tone="warning">Additional payment</StatusPill><h4>{money(payment.diffCents)} is due for this change</h4><p>Enter a card below. Square processes the payment securely before the booking is updated.</p><div id="cc-square-card" /></section>}<div><button type="button" className="cc-button cc-button--ghost" onClick={onClose}>Cancel</button><button className="cc-button cc-button--primary" disabled={working || (payment && !card)}>{working ? 'Saving…' : payment ? `Pay ${money(payment.diffCents)} and save` : 'Review and save'}</button></div></form></Modal>;
}

function StoreSettingsView({ status, api, onRefresh, user, onOpenAssistant }) {
  const [current, setCurrent] = useState(status);
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [model, setModel] = useState(status?.publicConfig?.model || 'gpt-5.6-terra');
  const [reasoningEffort, setReasoningEffort] = useState(status?.publicConfig?.reasoningEffort || 'low');
  const [working, setWorking] = useState('');
  const [message, setMessage] = useState(null);
  const canEdit = user?.role === 'owner';
  const connected = current?.status === 'connected';

  useEffect(() => {
    setCurrent(status);
    setModel(status?.publicConfig?.model || 'gpt-5.6-terra');
    setReasoningEffort(status?.publicConfig?.reasoningEffort || 'low');
  }, [status]);

  const save = async event => {
    event.preventDefault();
    setWorking('save'); setMessage(null);
    try {
      if (!apiKey.trim() && !connected) throw new Error('Paste your OpenAI API key first.');
      const saved = await api('/admin/providers/openai', {
        method: 'PUT',
        body: { apiKey: apiKey.trim() || undefined, model, reasoningEffort },
      });
      setCurrent(saved); setApiKey(''); setShowKey(false);
      const checked = await api('/admin/providers/openai/test', { method: 'POST', body: {} });
      setMessage({ tone: 'success', text: `Connected successfully. Midway is ready to use ${checked.model}.` });
      await onRefresh();
    } catch (saveError) {
      setMessage({ tone: 'danger', text: saveError.message });
    } finally { setWorking(''); }
  };

  const test = async () => {
    setWorking('test'); setMessage(null);
    try {
      const checked = await api('/admin/providers/openai/test', { method: 'POST', body: {} });
      setMessage({ tone: 'success', text: `Connection looks good. ${checked.model} is available.` });
    } catch (testError) { setMessage({ tone: 'danger', text: testError.message }); }
    finally { setWorking(''); }
  };

  const remove = async () => {
    if (!window.confirm('Remove the saved OpenAI key? The Ask Midway chat will stop working until another key is added.')) return;
    setWorking('remove'); setMessage(null);
    try {
      const updated = await api('/admin/providers/openai', { method: 'DELETE' });
      setCurrent(updated);
      setMessage({ tone: 'success', text: updated.status === 'connected' ? 'The saved key was removed. A server-managed key is still active.' : 'The saved key was removed.' });
      await onRefresh();
    } catch (removeError) { setMessage({ tone: 'danger', text: removeError.message }); }
    finally { setWorking(''); }
  };

  return <div className="cc-page cc-settings-page">
    <div className="cc-page-intro"><div><p className="cc-kicker">Store settings</p><h2>Keep Midway connected.</h2><p>Add the store’s AI key here once. Staff can use the assistant, but only an owner can change this setting.</p></div></div>
    <section className="cc-ai-settings-card">
      <header>
        <div className="cc-ai-settings-mark"><Icon name="spark" /></div>
        <div><StatusPill tone={connected ? 'success' : 'warning'}>{connected ? 'AI connected' : 'Setup needed'}</StatusPill><h3>AI Assistant</h3><p>Used for Ask Midway, uploaded photos and files, Square questions, and vendor MCP tools.</p></div>
      </header>
      <div className="cc-ai-settings-status">
        <span><small>Model</small><strong>{current?.publicConfig?.model || model}</strong></span>
        <span><small>Saved key</small><strong>{connected && current?.publicConfig?.keyEnding ? `•••• ${current.publicConfig.keyEnding}` : 'Not added'}</strong></span>
        <span><small>Response style</small><strong>{reasoningEffort === 'low' ? 'Fast + smart' : friendlyStatus(reasoningEffort)}</strong></span>
      </div>
      {message && <div className={`cc-settings-message tone-${message.tone}`}><Icon name={message.tone === 'success' ? 'check' : 'alert'} /><span>{message.text}</span></div>}
      <form className="cc-ai-settings-form" onSubmit={save}>
        <label>OpenAI API key
          <div className="cc-secret-field"><input type={showKey ? 'text' : 'password'} value={apiKey} onChange={event => setApiKey(event.target.value)} autoComplete="new-password" spellCheck="false" placeholder={connected ? 'Paste a new key only to replace the saved one' : 'Paste your key beginning with sk-'} disabled={!canEdit || Boolean(working)} /><button type="button" onClick={() => setShowKey(value => !value)} disabled={!canEdit || !apiKey}>{showKey ? 'Hide' : 'Show'}</button></div>
          <small>The key is encrypted on the server and is never sent back to this browser.</small>
        </label>
        <a className="cc-key-help" href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer"><Icon name="plus" /> Create or copy an OpenAI API key</a>
        <details className="cc-ai-advanced">
          <summary>Speed and intelligence</summary>
          <div className="cc-form-pair"><label>Model<select value={model} onChange={event => setModel(event.target.value)} disabled={!canEdit || Boolean(working)}><option value="gpt-5.6-terra">Terra — recommended</option><option value="gpt-5.6-sol">Sol — strongest</option><option value="gpt-5.6-luna">Luna — fastest</option></select></label><label>Thinking<select value={reasoningEffort} onChange={event => setReasoningEffort(event.target.value)} disabled={!canEdit || Boolean(working)}><option value="low">Fast + smart</option><option value="medium">More careful</option><option value="high">Deep review</option></select></label></div>
        </details>
        <footer>
          <button className="cc-button cc-button--primary cc-button--large" disabled={!canEdit || Boolean(working)}>{working === 'save' ? 'Saving and checking…' : connected ? 'Save changes and check' : 'Connect AI assistant'}</button>
          {connected && <button type="button" className="cc-button cc-button--soft" onClick={test} disabled={!canEdit || Boolean(working)}>{working === 'test' ? 'Checking…' : 'Test connection'}</button>}
          {connected && <button type="button" className="cc-button cc-button--ghost is-danger" onClick={remove} disabled={!canEdit || Boolean(working)}>{working === 'remove' ? 'Removing…' : 'Remove saved key'}</button>}
        </footer>
      </form>
      {connected && <div className="cc-ai-ready"><Icon name="check" /><span><strong>Ready to use</strong><small>New chats use this key immediately. No server restart is needed.</small></span><button className="cc-row-action" onClick={onOpenAssistant}>Open Ask Midway</button></div>}
    </section>
  </div>;
}

function ConnectionsView({ overview, api, onRefresh, user }) {
  const [showForm, setShowForm] = useState(false);
  const [showTokenForm, setShowTokenForm] = useState(false);
  const [testing, setTesting] = useState('');
  const [message, setMessage] = useState(null);
  const [mcpTokens, setMcpTokens] = useState([]);
  const [mintedToken, setMintedToken] = useState(null);
  const [formAuthType, setFormAuthType] = useState('login');
  const [credConnector, setCredConnector] = useState(null);
  const [credAuthType, setCredAuthType] = useState('login');
  const [xero, setXero] = useState(null);
  const [quickbooks, setQuickbooks] = useState(null);
  const [openAi, setOpenAi] = useState(null);
  const [showOpenAiForm, setShowOpenAiForm] = useState(false);
  useEffect(() => {
    if (user?.role !== 'owner') return;
    api('/admin/tokens').then(setMcpTokens).catch(error => setMessage({ tone: 'danger', text: error.message }));
    api('/admin/providers/xero/status').then(setXero).catch(() => setXero({ connected: false }));
    api('/admin/providers/quickbooks/status').then(setQuickbooks).catch(() => setQuickbooks({ connected: false }));
    api('/admin/providers/openai').then(setOpenAi).catch(() => setOpenAi(null));
  }, [user?.role]); // eslint-disable-line react-hooks/exhaustive-deps
  const saveOpenAiKey = async event => {
    event.preventDefault();
    setTesting('openai'); setMessage(null);
    try {
      const form = new FormData(event.currentTarget);
      await api('/admin/providers/openai', { method: 'PUT', body: { apiKey: form.get('apiKey') } });
      const checked = await api('/admin/providers/openai/test', { method: 'POST', body: {} });
      const refreshed = await api('/admin/providers/openai');
      setOpenAi(refreshed);
      setShowOpenAiForm(false);
      setMessage({ tone: 'success', text: `OpenAI is connected and answering (${checked.model}).` });
      await onRefresh();
    } catch (openAiError) {
      setMessage({ tone: 'danger', text: openAiError.message });
    } finally { setTesting(''); }
  };
  const connectXero = async () => {
    setTesting('xero'); setMessage(null);
    try {
      const started = await api('/admin/providers/xero/oauth/start', {
        method: 'POST',
        body: { redirectUri: `${window.location.origin}/admin.html?provider=xero` },
      });
      window.location.href = started.authorizationUrl;
    } catch (xeroError) {
      setMessage({ tone: 'danger', text: xeroError.message });
      setTesting('');
    }
  };
  const disconnectXero = async () => {
    if (!window.confirm('Disconnect Xero? Midway will no longer be able to read or create invoices until you reconnect.')) return;
    setTesting('xero'); setMessage(null);
    try {
      await api('/admin/providers/xero', { method: 'DELETE' });
      setXero({ connected: false });
      setMessage({ tone: 'success', text: 'Xero is disconnected.' });
    } catch (xeroError) { setMessage({ tone: 'danger', text: xeroError.message }); }
    finally { setTesting(''); }
  };
  const connectQuickBooks = async () => {
    setTesting('quickbooks'); setMessage(null);
    try {
      const started = await api('/admin/providers/quickbooks/oauth/start', {
        method: 'POST',
        body: { redirectUri: `${window.location.origin}/admin.html?provider=quickbooks` },
      });
      window.location.href = started.authorizationUrl;
    } catch (quickbooksError) {
      setMessage({ tone: 'danger', text: quickbooksError.message });
      setTesting('');
    }
  };
  const disconnectQuickBooks = async () => {
    if (!window.confirm('Disconnect QuickBooks? Midway will no longer be able to read or create invoices until you reconnect.')) return;
    setTesting('quickbooks'); setMessage(null);
    try {
      await api('/admin/providers/quickbooks', { method: 'DELETE' });
      setQuickbooks({ connected: false });
      setMessage({ tone: 'success', text: 'QuickBooks is disconnected.' });
    } catch (quickbooksError) { setMessage({ tone: 'danger', text: quickbooksError.message }); }
    finally { setTesting(''); }
  };
  const openCredentials = connection => {
    setCredConnector(connection);
    setCredAuthType(connection.authType === 'bearer' ? 'bearer' : 'login');
  };
  const saveCredentials = async event => {
    event.preventDefault();
    setMessage(null);
    const form = new FormData(event.currentTarget);
    setTesting(credConnector.id);
    try {
      await api(`/admin/command-center/connectors/${credConnector.id}`, { method: 'PATCH', body: Object.fromEntries(form) });
      const checked = await api(`/admin/command-center/connectors/${credConnector.id}/test`, { method: 'POST', body: {} });
      setCredConnector(null);
      setMessage({ tone: 'success', text: `${checked.displayName} is signed in and working. ${checked.capabilities?.length || 0} tools ready.` });
      await onRefresh();
    } catch (credError) {
      setMessage({ tone: 'danger', text: credError.message });
    } finally { setTesting(''); }
  };
  const createMcpToken = async event => {
    event.preventDefault(); setTesting('mcp-token'); setMessage(null);
    try {
      const form = new FormData(event.currentTarget);
      const created = await api('/admin/tokens', { method: 'POST', body: { name: form.get('name'), scope: form.get('scope') } });
      setMintedToken(created);
      setMcpTokens(current => [created.record, ...current]);
    } catch (tokenError) { setMessage({ tone: 'danger', text: tokenError.message }); }
    finally { setTesting(''); }
  };
  const revokeMcpToken = async id => {
    setTesting(id); setMessage(null);
    try { await api(`/admin/tokens/${encodeURIComponent(id)}`, { method: 'DELETE' }); setMcpTokens(current => current.filter(token => token.id !== id)); }
    catch (tokenError) { setMessage({ tone: 'danger', text: tokenError.message }); }
    finally { setTesting(''); }
  };
  const create = async event => {
    event.preventDefault();
    setMessage(null);
    try {
      const form = new FormData(event.currentTarget);
      const created = await api('/admin/command-center/connectors', { method: 'POST', body: Object.fromEntries(form) });
      setTesting(created.id);
      await api(`/admin/command-center/connectors/${created.id}/test`, { method: 'POST', body: {} });
      setShowForm(false);
      setMessage({ tone: 'success', text: `${created.displayName} is connected and its tools were discovered.` });
      await onRefresh();
    } catch (createError) {
      setMessage({ tone: 'danger', text: createError.message });
    } finally { setTesting(''); }
  };
  const test = async id => { setTesting(id); setMessage(null); try { const checked = await api(`/admin/command-center/connectors/${id}/test`, { method: 'POST', body: {} }); setMessage({ tone: 'success', text: `${checked.displayName} is live. ${checked.capabilities?.length || 0} tools discovered.` }); await onRefresh(); } catch (testError) { setMessage({ tone: 'danger', text: testError.message }); } finally { setTesting(''); } };
  const square = overview?.square || {};
  const mcpReady = overview?.dataSources?.persistence?.persistent === true;
  const mcpEndpoint = `${window.location.origin}/api/mcp`;
  const mcpAccessCard = <><article className="cc-connection-card"><div className="cc-connection-logo"><Icon name="spark" /></div><div><StatusPill tone={mcpReady ? 'success' : 'warning'}>{mcpReady ? 'Ready' : 'Needs database'}</StatusPill><h3>Midway MCP server</h3><p>{mcpEndpoint}</p><small>{mcpTokens.length ? `${mcpTokens.length} active access token${mcpTokens.length === 1 ? '' : 's'}` : 'Create an access token for Codex, ChatGPT, or another MCP client.'}</small></div>{user?.role === 'owner' && <button className="cc-button cc-button--soft" onClick={() => { setMintedToken(null); setShowTokenForm(true); }}>Manage access</button>}</article>{showTokenForm && <Modal title="Midway MCP access" onClose={() => { setShowTokenForm(false); setMintedToken(null); }}><div className="cc-simple-form"><p>Use the endpoint and one-time bearer token in any streamable HTTP MCP client.</p><label>MCP endpoint<input value={mcpEndpoint} readOnly /></label>{mintedToken ? <><label>New bearer token<input value={mintedToken.token} readOnly autoFocus /></label><div className="cc-form-error">Copy this token now. It cannot be shown again.</div><button className="cc-button cc-button--primary" type="button" onClick={() => navigator.clipboard?.writeText(mintedToken.token)}>Copy token</button></> : <form className="cc-simple-form" onSubmit={createMcpToken}><label>Token name<input name="name" defaultValue="Midway MCP client" required /></label><label>Permission<select name="scope" defaultValue="owner"><option value="read">Read only</option><option value="write">Read and write</option><option value="owner">Owner tools with approvals</option></select></label><button className="cc-button cc-button--primary" disabled={testing === 'mcp-token'}>{testing === 'mcp-token' ? 'Creating…' : 'Create access token'}</button></form>} {mcpTokens.length > 0 && <section><h4>Active tokens</h4>{mcpTokens.map(token => <div className="cc-document" key={token.id}><span><b>{token.name}<small>{token.tokenPrefix}… · {friendlyStatus(token.scope)}</small></b></span><button className="cc-row-action is-danger" type="button" disabled={testing === token.id} onClick={() => revokeMcpToken(token.id)}>Revoke</button></div>)}</section>}</div></Modal>}</>;
  return <div className="cc-page"><div className="cc-page-intro"><div><p className="cc-kicker">Connections</p><h2>Your store’s connected systems.</h2><p>Square is the operational source of truth. Vendor MCP connections plug into the same approval-safe agent.</p></div>{user?.role === 'owner' && <button className="cc-button cc-button--dark" onClick={() => setShowForm(true)}><Icon name="plus" /> Add vendor MCP</button>}</div>{message && <div className={`cc-settings-message tone-${message.tone}`}><Icon name={message.tone === 'success' ? 'check' : 'alert'} /><span>{message.text}</span></div>}<div className="cc-connection-grid"><article className="cc-connection-card is-featured"><BrandLogo brand="square" /><div><StatusPill tone={square.connected ? 'success' : 'warning'}>{square.connected ? 'Live' : square.status || 'Not connected'}</StatusPill><h3>Square</h3><p>{square.errorMessage || 'Sales, payments, product catalog, and inventory counts.'}</p></div><dl><div><dt>Net sales today</dt><dd>{square.connected ? money(square.salesTodayCents) : 'Unavailable'}</dd></div><div><dt>Transactions</dt><dd>{square.transactionCount ?? '—'}</dd></div></dl></article><article className="cc-connection-card is-featured"><BrandLogo brand="xero" /><div><StatusPill tone={xero?.connected ? 'success' : 'neutral'}>{xero?.connected ? 'Connected' : 'Not connected'}</StatusPill><h3>Xero</h3><p>{xero?.connected ? `Your books are linked to ${xero.tenantName || 'your Xero organization'}. Ask Midway about invoices, payments, or profit any time.` : 'Connect your accounting so Midway can keep the books simple: invoices, payments, and profit summaries.'}</p></div>{user?.role === 'owner' && (xero?.connected
        ? <button className="cc-button cc-button--soft" disabled={testing === 'xero'} onClick={disconnectXero}>{testing === 'xero' ? 'Working…' : 'Disconnect'}</button>
        : <button className="cc-button cc-button--primary" disabled={testing === 'xero'} onClick={connectXero}>{testing === 'xero' ? 'Opening Xero…' : 'Connect Xero'}</button>)}</article><article className="cc-connection-card is-featured"><BrandLogo brand="quickbooks" /><div><StatusPill tone={quickbooks?.connected ? 'success' : 'neutral'}>{quickbooks?.connected ? 'Connected' : 'Not connected'}</StatusPill><h3>QuickBooks</h3><p>{quickbooks?.connected ? `Your books are linked to ${quickbooks.companyName || 'your QuickBooks company'}. Ask Midway about invoices, bills, or profit any time.` : 'Connect your accounting so Midway can keep the books simple: invoices, bills, and profit summaries.'}</p></div>{user?.role === 'owner' && (quickbooks?.connected
        ? <button className="cc-button cc-button--soft" disabled={testing === 'quickbooks'} onClick={disconnectQuickBooks}>{testing === 'quickbooks' ? 'Working…' : 'Disconnect'}</button>
        : <button className="cc-button cc-button--primary" disabled={testing === 'quickbooks'} onClick={connectQuickBooks}>{testing === 'quickbooks' ? 'Opening QuickBooks…' : 'Connect QuickBooks'}</button>)}</article><article className="cc-connection-card is-featured"><BrandLogo brand="openai" /><div><StatusPill tone={openAi?.status === 'connected' ? 'success' : 'warning'}>{openAi?.status === 'connected' ? 'Connected' : 'Needs API key'}</StatusPill><h3>Assistant brain</h3><p>{openAi?.status === 'connected' ? `Midway's assistant is powered by OpenAI (${openAi?.publicConfig?.model || 'GPT'}).` : 'Paste an OpenAI API key so Midway can answer questions and run the store assistant.'}</p><small>{openAi?.publicConfig?.keyEnding ? `Key saved securely · ends in ${openAi.publicConfig.keyEnding}` : 'The key is encrypted and can be replaced any time.'}</small></div>{user?.role === 'owner' && <button className="cc-button cc-button--soft" disabled={testing === 'openai'} onClick={() => setShowOpenAiForm(true)}>{openAi?.status === 'connected' ? 'Update key' : 'Add API key'}</button>}</article>{mcpAccessCard}{(overview?.connectors || []).map(connection => <article className="cc-connection-card" key={connection.id}><BrandLogo brand="harbor" /><div><StatusPill tone={connection.status === 'connected' ? 'success' : connection.status === 'error' ? 'danger' : 'neutral'}>{friendlyStatus(connection.status)}</StatusPill><h3>{connection.displayName}</h3><p>{connection.errorMessage || connection.endpointUrl}</p><small>{connection.authType === 'login' ? (connection.secretConfigured ? 'Signed in with your vendor account' : 'Needs your vendor sign-in') : connection.secretConfigured ? 'Credential saved securely' : 'No credential required'}</small></div><div className="cc-connection-actions"><button className="cc-button cc-button--soft" disabled={testing === connection.id} onClick={() => test(connection.id)}>{testing === connection.id ? 'Checking…' : 'Test connection'}</button>{user?.role === 'owner' && <button className="cc-button cc-button--ghost" disabled={testing === connection.id} onClick={() => openCredentials(connection)}>Update sign-in</button>}</div></article>)}</div>{showForm && <Modal title="Connect a vendor MCP server" onClose={() => setShowForm(false)}><form className="cc-simple-form" onSubmit={create}><p>Midway completes the MCP handshake, discovers tools, and still asks before any vendor action.</p>{message?.tone === 'danger' && <div className="cc-form-error">{message.text}</div>}<label>Vendor<select name="vendorId" required>{(overview?.vendors || []).map(vendor => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}</select></label><label>Connection name<input name="displayName" placeholder="Example: Harbor ordering" required /></label><label>MCP server URL<input name="endpointUrl" type="url" placeholder="https://vendor.example.com/mcp (Harbor: stdio://harborhub)" required /></label><label>How does Midway sign in?<select name="authType" value={formAuthType} onChange={event => setFormAuthType(event.target.value)}><option value="login">Vendor account sign-in (email and password)</option><option value="bearer">Bearer token</option><option value="none">No sign-in needed</option></select></label>{formAuthType === 'login' && <><label>Vendor account email<input name="email" type="email" autoComplete="off" placeholder="The email you use on the vendor website" required /></label><label>Vendor account password<input name="password" type="password" autoComplete="new-password" required /><small>Locked with encryption before it is saved, and never shown again.</small></label></>}{formAuthType === 'bearer' && <><label>Bearer token<input name="authToken" type="password" autoComplete="new-password" placeholder="Paste the vendor MCP token" /><small>Encrypted before it is saved and never returned to the browser.</small></label><details className="cc-ai-advanced"><summary>Use a server environment secret instead</summary><label>Credential reference<input name="secretRef" placeholder="Example: HARBOR_MCP_TOKEN" /><small>Use this only when the token is already configured on the server.</small></label></details></>}<div><button type="button" className="cc-button cc-button--ghost" onClick={() => setShowForm(false)}>Cancel</button><button className="cc-button cc-button--primary" disabled={Boolean(testing)}>{testing ? 'Connecting and discovering tools…' : 'Connect and test'}</button></div></form></Modal>}{showOpenAiForm && <Modal title="OpenAI API key" onClose={() => setShowOpenAiForm(false)}><form className="cc-simple-form" onSubmit={saveOpenAiKey}><p>Paste the key from platform.openai.com. Midway encrypts it, saves it, and checks it right away — you can replace it here whenever you rotate keys.</p>{message?.tone === 'danger' && <div className="cc-form-error">{message.text}</div>}<label>API key<input name="apiKey" type="password" autoComplete="new-password" placeholder="sk-..." required /><small>Encrypted before it is saved and never shown again.</small></label><div><button type="button" className="cc-button cc-button--ghost" onClick={() => setShowOpenAiForm(false)}>Cancel</button><button className="cc-button cc-button--primary" disabled={testing === 'openai'}>{testing === 'openai' ? 'Saving and checking…' : 'Save and test'}</button></div></form></Modal>}{credConnector && <Modal title={`Update sign-in for ${credConnector.displayName}`} onClose={() => setCredConnector(null)}><form className="cc-simple-form" onSubmit={saveCredentials}><p>Enter the new sign-in. Midway saves it encrypted, then checks the connection right away.</p>{message?.tone === 'danger' && <div className="cc-form-error">{message.text}</div>}<label>Sign-in type<select name="authType" value={credAuthType} onChange={event => setCredAuthType(event.target.value)}><option value="login">Vendor account sign-in (email and password)</option><option value="bearer">Bearer token</option></select></label>{credAuthType === 'login' ? <><label>Vendor account email<input name="email" type="email" autoComplete="off" required /></label><label>Vendor account password<input name="password" type="password" autoComplete="new-password" required /><small>Locked with encryption before it is saved, and never shown again.</small></label></> : <label>Bearer token<input name="authToken" type="password" autoComplete="new-password" placeholder="Paste the vendor MCP token" required /><small>Encrypted before it is saved and never returned to the browser.</small></label>}<div><button type="button" className="cc-button cc-button--ghost" onClick={() => setCredConnector(null)}>Cancel</button><button className="cc-button cc-button--primary" disabled={testing === credConnector.id}>{testing === credConnector.id ? 'Saving and checking…' : 'Save and test'}</button></div></form></Modal>}</div>;
}

function BrandLogo({ brand }) {
  if (brand === 'square') {
    return <div className="cc-connection-logo brand-square" aria-hidden="true"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm3.4 5.1a1.3 1.3 0 0 0-1.3 1.3v5.2a1.3 1.3 0 0 0 1.3 1.3h7.2a1.3 1.3 0 0 0 1.3-1.3V9.4a1.3 1.3 0 0 0-1.3-1.3zm2 3h2.4c.4 0 .7.3.7.7v2.4c0 .4-.3.7-.7.7h-2.4a.7.7 0 0 1-.7-.7v-2.4c0-.4.3-.7.7-.7z"/></svg></div>;
  }
  if (brand === 'xero') {
    return <div className="cc-connection-logo brand-xero" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="m7 7 10 10M17 7 7 17"/></svg></div>;
  }
  if (brand === 'openai') {
    return <div className="cc-connection-logo brand-openai" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"><path d="M12 4.2 17.9 7.6v6.8L12 17.8 6.1 14.4V7.6z"/><path d="M12 4.2V1.9m5.9 5.7 2-1.2M17.9 14.4l2 1.2M12 17.8v2.3m-5.9-5.7-2 1.2M6.1 7.6l-2-1.2"/></svg></div>;
  }
  if (brand === 'harbor') {
    return <div className="cc-connection-logo brand-harbor" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="5.5" r="2.2"/><path d="M12 7.7V20m0 0c-4.2 0-7.4-2.7-8-6.4l2.2 1M12 20c4.2 0 7.4-2.7 8-6.4l-2.2 1M8.6 10.5h6.8"/></svg></div>;
  }
  if (brand === 'quickbooks') {
    return <div className="cc-connection-logo brand-quickbooks" aria-hidden="true"><svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10.5"/><path d="M7.2 12a3.4 3.4 0 0 1 3.4-3.4h.5v1.8h-.5a1.6 1.6 0 1 0 0 3.2h1.3V7h1.8v8.4h-3.1A3.4 3.4 0 0 1 7.2 12zm9.6 0a3.4 3.4 0 0 1-3.4 3.4h-.5v-1.8h.5a1.6 1.6 0 1 0 0-3.2h-1.3V17h-1.8V8.6h3.1a3.4 3.4 0 0 1 3.4 3.4z" fill="white"/></svg></div>;
  }
  return <div className="cc-connection-logo" aria-hidden="true"><Icon name="spark" /></div>;
}

function Modal({ title, onClose, children }) {
  return <div className="cc-modal" role="dialog" aria-modal="true" aria-label={title} onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><div><header><h3>{title}</h3><button onClick={onClose} aria-label="Close">×</button></header>{children}</div></div>;
}

function EmptyState({ icon, title, text }) { return <div className="cc-empty"><Icon name={icon} /><strong>{title}</strong><p>{text}</p></div>; }
function StatusPill({ tone = 'neutral', children }) { return <span className={`cc-status tone-${tone}`}><i />{children}</span>; }
function Toast({ tone, onClose, children }) { return <div className={`cc-toast tone-${tone}`}><Icon name={tone === 'danger' ? 'alert' : 'check'} /><span>{children}</span><button onClick={onClose}>×</button></div>; }
function LoadingScreen() { return <div className="cc-loading"><div className="cc-assistant-mark"><Icon name="spark" /></div><p>Bringing the store into focus…</p></div>; }

function MobileNav({ view, setView }) {
  return <nav className="cc-mobile-nav">{NAV_ITEMS.map(([id, label, icon]) => <button key={id} className={view === id ? 'active' : ''} onClick={() => setView(id)}><Icon name={icon} /><span>{label === 'Command center' ? 'Home' : label}</span></button>)}</nav>;
}

function Icon({ name, className = '' }) {
  const paths = {
    home: '<path d="M3 10.8 12 3l9 7.8v9.1a1.1 1.1 0 0 1-1.1 1.1H4.1A1.1 1.1 0 0 1 3 19.9z"/><path d="M9 21v-7h6v7"/>',
    spark: '<path d="m12 3 1.4 4.2a5.1 5.1 0 0 0 3.4 3.4L21 12l-4.2 1.4a5.1 5.1 0 0 0-3.4 3.4L12 21l-1.4-4.2a5.1 5.1 0 0 0-3.4-3.4L3 12l4.2-1.4a5.1 5.1 0 0 0 3.4-3.4z"/>',
    mic: '<rect x="9" y="2.5" width="6" height="11.5" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3.5"/><path d="M8.5 21.5h7"/>',
    boxes: '<path d="m7.5 4.3 4.5 2.6 4.5-2.6L12 1.7zM3 7l4.5 2.6V15L3 12.4zM12 9.6 16.5 7 21 9.6 16.5 12.2zM12 15l4.5 2.6 4.5-2.6v5.3l-4.5 2.6-4.5-2.6z"/>',
    clipboard: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4.5V3h6v1.5M9 10h6M9 14h6M9 18h4"/>',
    truck: '<path d="M3 6h11v11H3zM14 10h4l3 3v4h-7z"/><circle cx="7" cy="19" r="2"/><circle cx="18" cy="19" r="2"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.2 1.2M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.2-1.2"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1z"/>',
    logout: '<path d="M10 4H5v16h5M14 8l4 4-4 4M18 12H9"/>', refresh: '<path d="M20 6v5h-5M4 18v-5h5"/><path d="M6.1 8a7 7 0 0 1 11.7-2L20 11M4 13l2.2 5a7 7 0 0 0 11.7-2"/>',
    trend: '<path d="m3 17 6-6 4 4 8-9"/><path d="M15 6h6v6"/>', arrow: '<path d="M5 12h14M14 7l5 5-5 5"/>', plus: '<path d="M12 5v14M5 12h14"/>', message: '<path d="M4 4h16v12H8l-4 4z"/>', shield: '<path d="M12 3 4 6v6c0 5 3.4 8 8 9 4.6-1 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/>',
    paperclip: '<path d="m9 12 5-5a3 3 0 0 1 4 4l-7 7a5 5 0 0 1-7-7l7-7"/>', arrowUp: '<path d="M12 19V5M6 11l6-6 6 6"/>', image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 15-5-5L5 20"/>', file: '<path d="M6 2h8l4 4v16H6z"/><path d="M14 2v5h5"/>', camera: '<path d="M4 7h4l2-3h4l2 3h4v13H4z"/><circle cx="12" cy="13" r="4"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/>', arrowDown: '<path d="M12 5v14M6 13l6 6 6-6"/>', check: '<path d="m5 12 4 4L19 6"/>', alert: '<path d="M12 3 2 21h20z"/><path d="M12 9v5M12 18h.01"/>',
  };
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: paths[name] || paths.spark }} />;
}

function routePriority(id, onView, onAsk) { if (id === 'low-stock') onView('inventory'); else if (id === 'draft-orders') onView('orders'); else if (id === 'vendor-errors' || id === 'square-sync') onView('connections'); else if (id === 'arrivals') onView('bookings'); else onAsk('What should I take care of next?'); }
function priorityIcon(id) { return ({ 'low-stock': 'boxes', 'draft-orders': 'clipboard', 'vendor-errors': 'link', 'square-sync': 'alert', arrivals: 'calendar', 'all-clear': 'check' })[id] || 'spark'; }
function friendlyConfirmation(pending) {
  const name = String(pending?.toolName || '').replaceAll('_', ' ');
  const batch = Array.isArray(pending?.batch) ? pending.batch : [];
  const count = pending?.count || batch.length || 1;
  if (count > 1) {
    const named = batch.map(entry => entry?.arguments?.name || entry?.arguments?.bookingCode || entry?.arguments?.toolName).filter(Boolean);
    const preview = named.slice(0, 3).join(', ');
    return `${count} actions at once — ${name}${preview ? `: ${preview}${named.length > 3 ? `, +${named.length - 3} more` : ''}` : ''}. One approval runs them all and records everything in the activity log.`;
  }
  const args = pending?.arguments || {};
  const target = args.bookingCode || args.toolName || args.name || '';
  return `${name}${target ? ` for ${target}` : ''}. Midway will record this in the activity log.`;
}
function friendlyStatus(value) { return String(value || '').replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase()); }
function changeLabel(percent, suffix) { if (percent === null || percent === undefined) return 'New sales in this period'; const direction = Number(percent) > 0 ? 'up' : Number(percent) < 0 ? 'down' : 'flat'; return direction === 'flat' ? `No change vs ${suffix}` : `${Math.abs(Number(percent)).toFixed(1)}% ${direction} vs ${suffix}`; }
function formatNumber(value) { return new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(Number(value || 0)); }
function bookingTone(status) { return ['confirmed', 'paid'].includes(status) ? 'success' : ['hold', 'pending'].includes(status) ? 'warning' : ['canceled', 'refunded'].includes(status) ? 'danger' : 'neutral'; }
function siteLabel(booking, sites = []) { const ids = booking.rvSiteIds || booking.siteIds || [booking.rvSiteId].filter(Boolean); const labels = ids.map(id => sites.find(site => site.id === id)?.name || sites.find(site => site.id === id)?.siteNumber || id).filter(Boolean); return labels.length ? `Site ${labels.join(', ')}` : booking.siteNumber ? `Site ${booking.siteNumber}` : 'Site not assigned'; }
function money(cents) { if (cents === null || cents === undefined) return '—'; return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(cents) / 100); }
function formatLongDate(date) { return new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).format(date); }
function shortDate(value) { if (!value) return ''; return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(value)); }
function shortTime(value) { if (!value) return ''; return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(new Date(value)); }
function shortMonth(value) { return new Intl.DateTimeFormat('en-US', { month: 'short' }).format(new Date(`${value}T12:00:00`)); }
function dayNumber(value) { return new Date(`${value}T12:00:00`).getDate(); }
function dayPart() { const hour = new Date().getHours(); return hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'; }

function syncButtonLabel(progress, idleLabel) { if (!progress) return idleLabel; return `Syncing… ${progress.phase === 'catalog' ? 'catalog' : 'counts'} ${progress.itemsDone}`; }
function isoDateOffset(days) { const date = new Date(); date.setDate(date.getDate() + days); return date.toISOString().slice(0, 10); }
function initials(value = '') { return String(value).split(/\s+|@/).filter(Boolean).slice(0, 2).map(part => part[0]?.toUpperCase()).join('') || 'M'; }
function safeJson(value) { try { return value ? JSON.parse(value) : null; } catch { return null; } }
function readDataUrl(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error(`Could not read ${file.name}.`)); reader.readAsDataURL(file); }); }

// Phone photos are often 8-35 MB; hosting caps request bodies around 4.5 MB.
// Downscale big images in the browser — multiple passes, progressively more
// aggressive — so any readable photo of any size uploads cleanly.
const UPLOAD_TARGET_BYTES = 3.5 * 1024 * 1024;

async function shrinkImageForUpload(file) {
  if (!file.type.startsWith('image/') || file.type === 'image/gif' || file.size <= UPLOAD_TARGET_BYTES) return null;
  const looksLikeHeic = /image\/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name);
  let bitmap = null;
  try { bitmap = await createImageBitmap(file); } catch { bitmap = null; }
  if (!bitmap) {
    if (looksLikeHeic) {
      throw new Error(`${file.name} is an iPhone HEIC photo this browser cannot read. On the phone, share it as JPEG — or set Settings › Camera › Formats to “Most Compatible” and retake it.`);
    }
    return null;
  }
  const passes = [
    { maxDimension: 2200, quality: 0.85 },
    { maxDimension: 1800, quality: 0.78 },
    { maxDimension: 1400, quality: 0.7 },
    { maxDimension: 1100, quality: 0.6 },
  ];
  for (const pass of passes) {
    const scale = Math.min(1, pass.maxDimension / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', pass.quality));
    if (blob && blob.size <= UPLOAD_TARGET_BYTES) {
      return new File([blob], file.name.replace(/\.[a-z0-9]+$/i, '') + '.jpg', { type: 'image/jpeg' });
    }
  }
  return null;
}
function guessMime(name) { const extension = name.split('.').pop()?.toLowerCase(); return ({ pdf: 'application/pdf', csv: 'text/csv', tsv: 'text/tab-separated-values', txt: 'text/plain', md: 'text/markdown', json: 'application/json', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xls: 'application/vnd.ms-excel', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })[extension] || 'application/octet-stream'; }
async function readEventStream(response, onEvent) {
  if (!response.body) throw new Error('Live responses are not supported by this browser.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done }).replaceAll('\r\n', '\n');
    let boundary = buffer.indexOf('\n\n');
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
      if (data) onEvent(JSON.parse(data));
      boundary = buffer.indexOf('\n\n');
    }
    if (done) break;
  }
}
function upsertActivity(items, next) {
  const index = items.findIndex(item => item.id === next.id);
  if (index < 0) return [...items, next];
  return items.map((item, itemIndex) => itemIndex === index ? { ...item, ...next } : item);
}
function completeActivity(items, id, status = 'done') { return items.map(item => item.id === id ? { ...item, status } : item); }
function friendlyToolActivity(toolName = '', detail = {}) {
  const labels = {
    get_command_center_overview: 'Checking today’s command center',
    admin_dashboard_today: 'Checking today’s store activity',
    get_sales_analytics: 'Reviewing Square sales history',
    sync_square_sales_history: 'Updating Square sales history',
    list_inventory: 'Checking inventory levels',
    list_inventory_reconciliations: 'Reviewing inventory counts',
    create_inventory_reconciliation: 'Preparing an inventory comparison',
    apply_inventory_reconciliation: 'Updating approved inventory counts',
    list_vendors: 'Checking vendor information',
    draft_vendor_reorder: 'Building a vendor order draft',
    list_vendor_mcp_tools: 'Checking the vendor connection',
    call_vendor_mcp_tool: 'Working with the connected vendor',
    list_bookings: 'Checking RV bookings',
    get_booking: 'Opening the booking details',
    create_booking: 'Creating the booking',
    update_booking: 'Updating the booking',
    cancel_booking: 'Canceling the approved booking',
    refund_booking: 'Sending the approved Square refund',
    list_rv_sites: 'Checking RV site availability',
    update_rv_site: 'Updating the RV site',
    block_rv_site: 'Blocking the selected RV dates',
    list_fuel_prices: 'Checking fuel prices',
    update_fuel_price: 'Updating the fuel price',
    list_fuel_inventory: 'Checking fuel levels',
    update_fuel_inventory: 'Updating fuel levels',
    list_provider_statuses: 'Checking connected services',
    list_notifications: 'Checking store notifications',
    list_audit_log: 'Reviewing recent store activity',
    list_settings: 'Checking store settings',
    update_settings: 'Updating store settings',
    xero_status: 'Checking Xero',
    xero_search_contacts: 'Searching Xero contacts',
    xero_list_invoices: 'Reviewing Xero invoices',
    xero_create_invoice: 'Preparing the Xero invoice',
    xero_record_payment: 'Recording the Xero payment',
    xero_get_pl_summary: 'Reviewing the profit and loss summary',
    qbo_status: 'Checking QuickBooks',
    qbo_search_customers: 'Searching QuickBooks customers',
    qbo_list_invoices: 'Reviewing QuickBooks invoices',
    qbo_list_bills: 'Reviewing QuickBooks bills',
    qbo_get_pl_summary: 'Reviewing the profit and loss summary',
    qbo_create_invoice: 'Preparing the QuickBooks invoice',
    qbo_record_payment: 'Recording the QuickBooks payment',
    create_square_item: 'Creating the new register item',
    update_square_item: 'Updating the register item',
    set_square_item_stock: 'Setting the on-hand count in Square',
    delete_square_item: 'Removing the item from the register',
    call_square_read_api: 'Looking it up in Square',
    call_square_api: 'Working in Square',
    map_item_to_vendor: 'Saving the vendor mapping',
    unmap_item_from_vendor: 'Removing the vendor mapping',
    propose_vendor_mappings: 'Matching items to the vendor catalog',
    apply_vendor_mappings: 'Saving the approved vendor mappings',
    set_inventory_rule: 'Saving the stock rule',
    call_vendor_read_tool: 'Checking the vendor',
  };
  const base = labels[toolName] || `Checking ${String(toolName).replaceAll('_', ' ')}`;
  const connector = detail.connector && !/^[0-9a-f-]{20,}$/i.test(detail.connector) ? detail.connector : null;
  if (detail.innerTool) {
    const server = connector || (String(detail.innerTool).startsWith('harbor_') ? 'Harbor' : 'the vendor');
    const doing = String(detail.innerTool).replace(/^harbor_/, '').replaceAll('_', ' ');
    return `${server} · ${doing}`;
  }
  if (detail.apiPath) {
    const section = String(detail.apiPath).replace(/^\/v2\//, '').split('/')[0].replaceAll('-', ' ');
    return section ? `Square · ${section}` : base;
  }
  if (detail.subject && ['create_square_item', 'update_square_item'].includes(toolName)) {
    return `${base}: ${detail.subject}`;
  }
  return base;
}
function loadExternalScript(src) { return new Promise((resolve, reject) => { const existing = document.querySelector(`script[src="${src}"]`); if (existing) { if (window.Square) resolve(); else existing.addEventListener('load', resolve, { once: true }); return; } const script = document.createElement('script'); script.src = src; script.async = true; script.onload = resolve; script.onerror = () => reject(new Error('Secure payment library unavailable.')); document.head.appendChild(script); }); }

createRoot(document.getElementById('root')).render(<App />);
