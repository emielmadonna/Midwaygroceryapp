const tokenKey = 'midway_admin_session';
const pendingProviderKey = 'midway_pending_provider_connection';
const API_ROOT = ['3000', '3002', '5173'].includes(window.location.port) || window.location.protocol === 'file:'
  ? 'http://127.0.0.1:3001/api'
  : '/api';
const state = {
  token: sessionStorage.getItem(tokenKey) || '',
  user: null,
  featureFlags: {},
  sites: [],
  bookings: [],
  dashboard: null,
  settings: null,
  providerStatuses: [],
  catalogProducts: [],
  notifications: [],
  audit: [],
  selectedDate: todayIso(),
  selectedSiteId: null,
};

const els = {
  loginScreen: document.getElementById('loginScreen'),
  dashboard: document.getElementById('adminDashboard'),
  loginForm: document.getElementById('loginForm'),
  loginEmail: document.getElementById('loginEmail'),
  loginPassword: document.getElementById('loginPassword'),
  loginStatus: document.getElementById('loginStatus'),
  logoutBtn: document.getElementById('logoutBtn'),
  refreshBtn: document.getElementById('refreshBtn'),
  userRole: document.getElementById('userRole'),
  adminApiStatus: document.getElementById('adminApiStatus'),
  stats: document.getElementById('dashboardStats'),
  alerts: document.getElementById('alertsList'),
  arrivals: document.getElementById('arrivalsList'),
  departures: document.getElementById('departuresList'),
  employeeTaskPanel: document.getElementById('employeeTaskPanel'),
  employeeTaskGrid: document.getElementById('employeeTaskGrid'),
  settingsPanel: document.getElementById('settingsPanel'),
  settingsForm: document.getElementById('businessSettingsForm'),
  settingsRoleNote: document.getElementById('settingsRoleNote'),
  instagramForm: document.getElementById('instagramSettingsForm'),
  instagramStatus: document.getElementById('instagramStatus'),
  sectionControlsGrid: document.getElementById('sectionControlsGrid'),
  sectionStatusSummary: document.getElementById('sectionStatusSummary'),
  providerPanel: document.getElementById('providerPanel'),
  providerStatusGrid: document.getElementById('providerStatusGrid'),
  calendarPanel: document.getElementById('calendarPanel'),
  calendarDate: document.getElementById('calendarDate'),
  calendarDateHeading: document.getElementById('calendarDateHeading'),
  calendarDateList: document.getElementById('calendarDateList'),
  calendarGrid: document.getElementById('calendarGrid'),
  calendarPrevBtn: document.getElementById('calendarPrevBtn'),
  calendarTodayBtn: document.getElementById('calendarTodayBtn'),
  calendarNextBtn: document.getElementById('calendarNextBtn'),
  propertyMapPanel: document.getElementById('propertyMapPanel'),
  propertyMap: document.getElementById('propertyMap'),
  siteInspector: document.getElementById('siteInspector'),
  bookingsList: document.getElementById('bookingsList'),
  notificationsList: document.getElementById('notificationsList'),
  auditList: document.getElementById('auditList'),
  manualForm: document.getElementById('manualBookingForm'),
  blockForm: document.getElementById('blockSiteForm'),
  siteSelects: document.querySelectorAll('[data-site-select]'),
  siteStatusList: document.getElementById('siteStatusList'),
  catalogSyncBtn: document.getElementById('catalogSyncBtn'),
  toast: document.getElementById('toast'),
};

els.loginForm?.addEventListener('submit', async event => {
  event.preventDefault();
  setLoginStatus('');
  const email = els.loginEmail.value.trim();
  const password = els.loginPassword.value;
  if (!email || !password) {
    setLoginStatus('Enter your email and password.');
    return;
  }

  const submitButton = els.loginForm.querySelector('[type="submit"]');
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = 'Signing in...';
  }

  try {
    const session = await api('/api/admin/auth/login', {
      method: 'POST',
      body: { email, password },
      auth: false,
    });
    state.token = session.token;
    state.user = session.user;
    sessionStorage.setItem(tokenKey, session.token);
    await boot();
  } catch (error) {
    setLoginStatus(loginErrorMessage(error));
    showToast(error.message, 'error');
  } finally {
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = 'Sign In';
    }
  }
});

els.logoutBtn?.addEventListener('click', () => {
  sessionStorage.removeItem(tokenKey);
  state.token = '';
  state.user = null;
  location.reload();
});

els.refreshBtn?.addEventListener('click', () => {
  loadAdminData().catch(error => showToast(error.message, 'error'));
});

els.settingsForm?.addEventListener('submit', async event => {
  event.preventDefault();
  if (state.user?.role !== 'owner') return;

  const form = new FormData(els.settingsForm);
  await updateSettings({
    business: {
      businessName: form.get('businessName'),
      publicBrandName: form.get('publicBrandName'),
      phone: form.get('phone'),
      email: form.get('email'),
      address: form.get('address'),
      timezone: form.get('timezone'),
      instagramHandle: state.settings?.business?.instagramHandle || '',
      instagramUrl: state.settings?.business?.instagramUrl || '',
    },
    publicSite: {
      url: form.get('publicSiteUrl'),
      theme: form.get('theme'),
      instagramPosts: [],
      sections: collectSectionSettings(form),
    },
  });
});

els.instagramForm?.addEventListener('submit', async event => {
  event.preventDefault();
  if (state.user?.role !== 'owner') return;

  const form = new FormData(els.instagramForm);
  await updateInstagramSettings({
    instagramHandle: form.get('instagramHandle'),
    instagramUrl: form.get('instagramUrl'),
    instagramEnabled: form.get('instagramEnabled') === 'on',
    instagramUserId: form.get('instagramUserId'),
    instagramAccessToken: form.get('instagramAccessToken'),
    instagramTokenExpiresAt: datetimeLocalToIso(form.get('instagramTokenExpiresAt')),
    instagramFeedLimit: form.get('instagramFeedLimit'),
    instagramApiVersion: form.get('instagramApiVersion'),
  });
});

els.instagramForm?.querySelector('[data-provider-action="instagram-refresh"]')?.addEventListener('click', async event => {
  await refreshInstagramToken(event);
});

els.catalogSyncBtn?.addEventListener('click', async () => {
  try {
    await api('/api/admin/square/catalog/sync', { method: 'POST', body: {} });
    showToast('Square catalog synced.', 'success');
    await loadAdminData();
  } catch (error) {
    showToast(error.message, 'error');
  }
});

els.calendarDate?.addEventListener('change', () => {
  state.selectedDate = els.calendarDate.value || todayIso();
  renderCalendar();
  renderPropertyMap();
});

els.calendarPrevBtn?.addEventListener('click', () => shiftSelectedDate(-1));
els.calendarNextBtn?.addEventListener('click', () => shiftSelectedDate(1));
els.calendarTodayBtn?.addEventListener('click', () => {
  state.selectedDate = todayIso();
  renderCalendar();
  renderPropertyMap();
});

bindDateRangeForm(els.manualForm, { startName: 'startDate', endName: 'endDate' });
bindDateRangeForm(els.blockForm, { startName: 'startDate', endName: 'endDate' });

els.propertyMap?.addEventListener('click', event => {
  const marker = event.target.closest('[data-map-site]');
  if (!marker) return;
  state.selectedSiteId = marker.dataset.mapSite;
  renderPropertyMap();
});

els.manualForm?.addEventListener('submit', async event => {
  event.preventDefault();
  const form = new FormData(els.manualForm);
  const payload = {
    siteId: form.get('siteId'),
    startDate: form.get('startDate'),
    endDate: form.get('endDate'),
    guests: Number(form.get('guests') || 1),
    vehicles: Number(form.get('vehicles') || 1),
    customer: {
      name: form.get('customerName'),
      phone: form.get('customerPhone'),
      email: form.get('customerEmail'),
    },
  };
  if (form.get('bookingAction') === 'payment-link') {
    const checkout = await api('/api/admin/bookings/checkout', {
      method: 'POST',
      body: payload,
    });
    if (checkout.checkout?.checkoutUrl) {
      window.open(checkout.checkout.checkoutUrl, '_blank', 'noopener,noreferrer');
      showToast('Square payment link opened. Booking is pending until payment completes.', 'success');
    } else {
      showToast('Payment session created, but Square did not return a link.', 'success');
    }
    await loadAdminData();
  } else {
    await mutate('/api/admin/bookings', payload, 'Manual booking created.');
  }
  els.manualForm.reset();
  syncDateRangeForm(els.manualForm, { startName: 'startDate', endName: 'endDate' });
});

els.blockForm?.addEventListener('submit', async event => {
  event.preventDefault();
  const form = new FormData(els.blockForm);
  await mutate(`/api/admin/rv-sites/${encodeURIComponent(form.get('siteId'))}/block`, {
    startDate: form.get('startDate'),
    endDate: form.get('endDate'),
    reason: form.get('reason') || 'Maintenance block',
  }, 'Site dates blocked.');
  els.blockForm.reset();
  syncDateRangeForm(els.blockForm, { startName: 'startDate', endName: 'endDate' });
});

boot().catch(error => {
  showLogin();
  if (state.token) showToast(error.message, 'error');
});

async function boot() {
  if (!state.token) {
    showLogin();
    return;
  }

  const me = await api('/api/admin/me');
  state.user = me.user;
  state.featureFlags = me.featureFlags || {};
  showDashboard();
  await completePendingProviderCallback();
  try {
    await loadAdminData();
  } catch (error) {
    showToast(`Signed in, but dashboard data could not load: ${error.message}`, 'error');
  }
}

async function loadAdminData() {
  const [dashboard, sites, bookings, notifications, audit, settings, providerStatuses, catalogProducts] = await Promise.all([
    api('/api/admin/dashboard/today'),
    api('/api/admin/rv-sites'),
    api('/api/admin/bookings'),
    api('/api/admin/notifications'),
    state.user?.role === 'owner' ? api('/api/admin/audit-log') : Promise.resolve([]),
    featureEnabled('core.tenant_config') ? api('/api/admin/settings') : Promise.resolve(null),
    featureEnabled('core.provider_adapters') ? api('/api/admin/providers') : Promise.resolve([]),
    state.user?.role === 'owner' && featureEnabled('core.provider_adapters') ? api('/api/admin/square/catalog') : Promise.resolve([]),
  ]);

  state.dashboard = dashboard;
  state.sites = sites;
  state.bookings = bookings;
  state.notifications = notifications;
  state.audit = audit;
  state.settings = settings;
  state.providerStatuses = providerStatuses;
  state.catalogProducts = catalogProducts;

  render();
}

async function mutate(path, body, successMessage) {
  await api(path, {
    method: 'POST',
    body,
  });
  showToast(successMessage, 'success');
  await loadAdminData();
}

async function cancelBooking(bookingCode) {
  const confirmed = window.confirm(`Cancel booking ${bookingCode}?`);
  if (!confirmed) return;
  await mutate(`/api/admin/bookings/${encodeURIComponent(bookingCode)}/cancel`, {
    reason: 'Canceled from admin dashboard',
  }, 'Booking canceled.');
}

async function refundBooking(bookingCode) {
  const reason = window.prompt(`Refund booking ${bookingCode}? Add a reason for the audit log.`, 'Owner approved refund');
  if (reason === null) return;
  await mutate(`/api/admin/bookings/${encodeURIComponent(bookingCode)}/refund`, {
    reason: reason.trim() || 'Owner approved refund',
  }, 'Booking refunded.');
}

async function updateSiteStatus(siteId, status) {
  await api(`/api/admin/rv-sites/${encodeURIComponent(siteId)}`, {
    method: 'PATCH',
    body: { status },
  });
  showToast('Site status updated.', 'success');
  await loadAdminData();
}

async function updateSiteDetails(siteId, form) {
  await api(`/api/admin/rv-sites/${encodeURIComponent(siteId)}`, {
    method: 'PATCH',
    body: {
      displayName: form.get('displayName'),
      status: form.get('status'),
      nightlyPriceCents: Number(form.get('nightlyPriceCents') || 0),
      maxRvLengthFeet: nullableNumber(form.get('maxRvLengthFeet')),
      amp: form.get('amp'),
      type: form.get('type'),
      shade: form.get('shade'),
      sku: form.get('sku'),
      squareCatalogObjectId: form.get('squareCatalogObjectId') || null,
      customerNotes: form.get('customerNotes'),
      adminNotes: form.get('adminNotes'),
      amenities: splitTextList(form.get('amenities')),
      mapX: nullableNumber(form.get('mapX')),
      mapY: nullableNumber(form.get('mapY')),
      mapWidth: nullableNumber(form.get('mapWidth')),
      mapHeight: nullableNumber(form.get('mapHeight')),
      rotation: nullableNumber(form.get('rotation')),
    },
  });
  showToast('RV site updated.', 'success');
  await loadAdminData();
}

async function updateSettings(body) {
  state.settings = await api('/api/admin/settings', {
    method: 'PATCH',
    body,
  });
  showToast('Site settings updated.', 'success');
  await loadAdminData();
}

async function updateInstagramSettings(input) {
  const settings = state.settings ?? {};
  const business = settings.business ?? {};
  const publicSite = settings.publicSite ?? {};
  const instagramSection = {
    ...sectionByKey(publicSite.sections, 'instagram'),
    key: 'instagram',
    enabled: Boolean(input.instagramEnabled),
  };
  state.settings = await api('/api/admin/settings', {
    method: 'PATCH',
    body: {
      business: {
        businessName: business.businessName,
        publicBrandName: business.publicBrandName,
        phone: business.phone,
        email: business.email,
        address: business.address,
        timezone: business.timezone,
        instagramHandle: input.instagramHandle,
        instagramUrl: input.instagramUrl,
      },
      publicSite: {
        url: publicSite.url,
        theme: publicSite.theme,
        instagramPosts: [],
        sections: mergeSectionSettings(publicSite.sections, instagramSection),
      },
    },
  });
  await api('/api/admin/providers/instagram', {
    method: 'PUT',
    body: {
      handle: input.instagramHandle,
      profileUrl: input.instagramUrl,
      instagramUserId: input.instagramUserId,
      accessToken: input.instagramAccessToken,
      tokenExpiresAt: input.instagramTokenExpiresAt,
      feedLimit: input.instagramFeedLimit ? Number(input.instagramFeedLimit) : undefined,
      apiVersion: input.instagramApiVersion,
    },
  }).then(data => {
    const connected = data.status === 'connected' && data.hasEncryptedCredentials;
    showToast(
      connected ? 'Instagram API feed is connected.' : 'Instagram settings saved. Connect Instagram before refreshing the token.',
      connected ? 'success' : 'error',
    );
  });
  await loadAdminData();
}

async function refreshInstagramToken(event) {
  if (state.user?.role !== 'owner') return;
  const instagramProvider = getInstagramProviderStatus();
  if (!(instagramProvider.status === 'connected' && instagramProvider.hasEncryptedCredentials)) {
    await startInstagramConnection(event);
    return;
  }
  try {
    const data = await api('/api/admin/providers/instagram/refresh', {
      method: 'POST',
      body: {},
    });
    showToast(data.mode === 'refreshed' ? 'Instagram token refreshed.' : 'Instagram token refresh checked.', 'success');
    await loadAdminData();
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function startInstagramConnection(event) {
  const redirectUri = providerRedirectUri('instagram');
  const trigger = event?.currentTarget;
  setButtonBusy(trigger, 'Connecting...');
  try {
    const data = await api('/api/admin/providers/instagram/oauth/start', {
      method: 'POST',
      body: { redirectUri },
    });
    if (data.authorizationUrl) {
      sessionStorage.setItem(pendingProviderKey, JSON.stringify({
        provider: 'instagram',
        state: data.state || '',
        redirectUri: data.redirectUri || redirectUri,
      }));
      window.location.assign(data.authorizationUrl);
      return;
    }

    showToast(providerPlaceholderMessage(data), 'error');
    await loadAdminData();
  } catch (error) {
    showToast(providerConnectionErrorMessage('Instagram', error), 'error');
  } finally {
    setButtonBusy(trigger, null);
  }
}

async function startSquareConnection(event) {
  const redirectUri = providerRedirectUri('square');
  const trigger = event?.currentTarget;
  setButtonBusy(trigger, 'Connecting...');
  try {
    const data = await api('/api/admin/providers/square/oauth/start', {
      method: 'POST',
      body: { redirectUri },
    });
    if (data.authorizationUrl) {
      sessionStorage.setItem(pendingProviderKey, JSON.stringify({
        provider: 'square',
        state: data.state || '',
        redirectUri,
      }));
      window.location.assign(data.authorizationUrl);
      return;
    }

    showToast(providerPlaceholderMessage(data), 'error');
    await loadAdminData();
  } catch (error) {
    showToast(providerConnectionErrorMessage('Square', error), 'error');
  } finally {
    setButtonBusy(trigger, null);
  }
}

async function completePendingProviderCallback() {
  const params = new URLSearchParams(window.location.search);
  const pending = readPendingProviderConnection();
  const provider = params.get('provider') || pending?.provider || (params.has('code') || params.has('error') ? 'instagram' : '');
  if (!['instagram', 'square'].includes(provider)) return;
  if (!params.has('code') && !params.has('error')) return;

  const redirectUri = pending?.redirectUri || providerRedirectUri(provider);
  const endpoint = provider === 'instagram'
    ? '/api/admin/providers/instagram/oauth/callback'
    : '/api/admin/providers/square/oauth/callback';
  const label = provider === 'instagram' ? 'Instagram' : 'Square';

  try {
    const data = await api(endpoint, {
      method: 'POST',
      body: {
        code: params.get('code') || '',
        state: params.get('state') || pending?.state || '',
        error: params.get('error') || '',
        errorDescription: params.get('error_description') || '',
        redirectUri,
      },
    });
    sessionStorage.removeItem(pendingProviderKey);
    clearProviderCallbackQuery();
    showToast(data.mode === 'placeholder'
      ? providerPlaceholderMessage(data)
      : `${label} is connected.`, data.mode === 'placeholder' ? 'error' : 'success');
  } catch (error) {
    clearProviderCallbackQuery();
    showToast(`${label} connection failed: ${error.message}`, 'error');
  }
}

async function api(path, { method = 'GET', body, auth = true } = {}) {
  const url = apiUrl(path);
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        ...(auth ? { Authorization: `Bearer ${state.token}` } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    throw new Error(`Admin API could not be reached at ${API_ROOT}. ${error.message}`);
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error?.message || `Request failed with ${response.status}`);
  }
  return payload.data;
}

function showLogin() {
  els.loginScreen.hidden = false;
  els.dashboard.hidden = true;
}

function showDashboard() {
  els.loginScreen.hidden = true;
  els.dashboard.hidden = false;
  if (els.userRole) els.userRole.textContent = state.user ? `${state.user.name} · ${state.user.role}` : '';
}

function render() {
  renderAdminApiStatus();
  renderStats();
  renderEmployeeMode();
  renderInstagramSettings();
  renderSettings();
  renderProviderStatuses();
  renderSiteSelects();
  renderBookingLists();
  renderCalendar();
  renderPropertyMap();
  renderSites();
  renderNotifications();
  renderAudit();
  document.body.dataset.role = state.user?.role || 'employee';
  document.body.dataset.manualBooking = state.featureFlags.manualAdminBooking ? 'on' : 'off';
  document.body.dataset.siteStatus = state.featureFlags['booking.site_status_management'] ? 'on' : 'off';
  document.body.dataset.tenantConfig = featureEnabled('core.tenant_config') ? 'on' : 'off';
  document.body.dataset.dynamicSections = featureEnabled('public.dynamic_sections') ? 'on' : 'off';
  document.body.dataset.providerAdapters = featureEnabled('core.provider_adapters') ? 'on' : 'off';
  document.body.dataset.adminCalendar = featureEnabled('booking.admin_calendar', 'adminCalendar') ? 'on' : 'off';
  document.body.dataset.adminPropertyMap = featureEnabled('booking.admin_property_map', 'adminPropertyMap') ? 'on' : 'off';
  document.body.dataset.employeeMode = featureEnabled('admin.employee_mode', 'employeeMode') ? 'on' : 'off';
}

function renderAdminApiStatus() {
  if (!els.adminApiStatus) return;
  els.adminApiStatus.textContent = API_ROOT === '/api'
    ? 'API connected on this site'
    : `API target ${API_ROOT}`;
}

function renderStats() {
  const totals = state.dashboard?.totals ?? {};
  const stats = [
    ['Occupied tonight', totals.occupiedTonight ?? 0],
    ['Available tonight', totals.availableTonight ?? 0],
    ['Arrivals today', totals.arrivalsToday ?? 0],
    ['Departures today', totals.departuresToday ?? 0],
    ['Open alerts', totals.openAlerts ?? 0],
    ['RV revenue', formatMoney(totals.revenueCents ?? 0)],
  ];

  els.stats.innerHTML = stats.map(([label, value]) => `
    <article class="admin-card admin-stat">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </article>
  `).join('');

  renderSimpleList(els.alerts, state.dashboard?.openAlerts ?? [], alert => `
    <li><strong>${escapeHtml(alert.type)}</strong><span>${escapeHtml(alert.label)}</span></li>
  `, 'No open alerts.');
}

function renderEmployeeMode() {
  if (!els.employeeTaskGrid) return;

  const enabled = featureEnabled('admin.employee_mode', 'employeeMode') && state.user?.role === 'employee';
  if (!enabled) {
    els.employeeTaskGrid.innerHTML = '';
    return;
  }

  const arrivals = guestBookings(state.dashboard?.arrivalsToday ?? []);
  const departures = guestBookings(state.dashboard?.departuresToday ?? []);
  const siteTasks = state.sites
    .filter(site => ['maintenance', 'inactive'].includes(site.status))
    .sort(compareSites);
  const blockedToday = bookingsForDate(todayIso()).filter(booking => booking.status === 'blocked');
  const occupiedTonight = guestBookings(state.dashboard?.occupiedTonight ?? bookingsForDate(todayIso()));

  const groups = [
    {
      title: 'Arrivals',
      count: arrivals.length,
      empty: 'No arrivals today.',
      items: arrivals.map(booking => taskItem({
        label: `${siteLabel(booking.rvSiteId)} · ${booking.customerName}`,
        meta: `${booking.bookingCode} · ${formatDateRange(booking)}`,
        status: 'arrival',
      })),
    },
    {
      title: 'Departures',
      count: departures.length,
      empty: 'No departures today.',
      items: departures.map(booking => taskItem({
        label: `${siteLabel(booking.rvSiteId)} · ${booking.customerName}`,
        meta: `${booking.bookingCode} · ${formatDateRange(booking)}`,
        status: 'departure',
      })),
    },
    {
      title: 'Tonight',
      count: occupiedTonight.length,
      empty: 'All sites are open tonight.',
      items: occupiedTonight.map(booking => taskItem({
        label: `${siteLabel(booking.rvSiteId)} occupied`,
        meta: `${booking.customerName} · leaves ${formatDisplayDate(booking.endDate)}`,
        status: booking.status,
      })),
    },
    {
      title: 'Site Tasks',
      count: siteTasks.length + blockedToday.length,
      empty: 'No maintenance or inactive sites.',
      items: [
        ...siteTasks.map(site => taskItem({
          label: `Site ${site.siteNumber}`,
          meta: `${site.status} · ${site.adminNotes || site.type || 'Check status'}`,
          status: site.status,
        })),
        ...blockedToday.map(booking => taskItem({
          label: `${siteLabel(booking.rvSiteId)} blocked`,
          meta: `${booking.bookingCode} · ${formatDateRange(booking)}`,
          status: 'blocked',
        })),
      ],
    },
  ];

  els.employeeTaskGrid.innerHTML = groups.map(group => `
    <article class="employee-task-card">
      <div class="employee-task-card__header">
        <h3>${escapeHtml(group.title)}</h3>
        <strong>${escapeHtml(group.count)}</strong>
      </div>
      <ul class="admin-list">
        ${group.items.length ? group.items.join('') : `<li class="empty">${escapeHtml(group.empty)}</li>`}
      </ul>
    </article>
  `).join('');
}

function renderSettings() {
  if (!els.settingsForm) return;

  const canEdit = state.user?.role === 'owner';
  const settings = state.settings ?? {};
  const business = settings.business ?? {};
  const publicSite = settings.publicSite ?? {};
  const fields = {
    businessName: business.businessName,
    publicBrandName: business.publicBrandName,
    phone: business.phone,
    email: business.email,
    address: business.address,
    timezone: business.timezone,
    publicSiteUrl: publicSite.url,
    theme: publicSite.theme,
  };

  for (const [name, value] of Object.entries(fields)) {
    const field = els.settingsForm.elements.namedItem(name);
    if (field) field.value = value ?? '';
  }

  renderSectionControls(publicSite.sections ?? []);

  els.settingsForm.querySelectorAll('input, textarea, select, button').forEach(control => {
    control.disabled = !canEdit;
  });
  if (els.settingsRoleNote) {
    els.settingsRoleNote.textContent = canEdit ? 'Owner edit access' : 'Read only';
  }
  els.settingsForm.dataset.readonly = canEdit ? 'false' : 'true';
}

function renderInstagramSettings() {
  if (!els.instagramForm) return;

  const canEdit = state.user?.role === 'owner';
  const settings = state.settings ?? {};
  const business = settings.business ?? {};
  const publicSite = settings.publicSite ?? {};
  const instagramProvider = state.providerStatuses.find(provider => provider.providerKey === 'instagram') || {};
  const providerConfig = instagramProvider.publicConfig ?? {};
  const instagramSection = sectionByKey(publicSite.sections, 'instagram');
  const fields = {
    instagramHandle: business.instagramHandle,
    instagramUrl: business.instagramUrl,
    instagramUserId: instagramProvider.externalAccountId || '',
    instagramTokenExpiresAt: isoToDatetimeLocal(providerConfig.tokenExpiresAt),
    instagramAccessToken: '',
    instagramFeedLimit: providerConfig.feedLimit || '',
    instagramApiVersion: providerConfig.apiVersion || '',
  };

  for (const [name, value] of Object.entries(fields)) {
    const field = els.instagramForm.elements.namedItem(name);
    if (field) field.value = value ?? '';
  }
  const enabledField = els.instagramForm.elements.namedItem('instagramEnabled');
  if (enabledField) enabledField.checked = instagramSection?.enabled !== false;

  els.instagramForm.querySelectorAll('input, textarea, button').forEach(control => {
    control.disabled = !canEdit;
  });
  const refreshButton = els.instagramForm.querySelector('[data-provider-action="instagram-refresh"]');
  if (refreshButton) {
    const connected = instagramProvider.status === 'connected' && instagramProvider.hasEncryptedCredentials;
    refreshButton.textContent = connected ? 'Refresh token now' : 'Connect Instagram';
    refreshButton.disabled = !canEdit;
  }

  if (els.instagramStatus) {
    const handle = business.instagramHandle ? `@${business.instagramHandle}` : 'No handle';
    const apiState = instagramProvider.status === 'connected' && instagramProvider.hasEncryptedCredentials
      ? 'API connected'
      : 'API token needed';
    els.instagramStatus.textContent = `${handle} · ${apiState}`;
  }
}

function getInstagramProviderStatus() {
  return state.providerStatuses.find(provider => provider.providerKey === 'instagram') || {};
}

function renderSectionControls(sections = []) {
  if (!els.sectionControlsGrid) return;
  const configured = new Map((sections ?? []).map(section => [section.key, section]));
  const descriptors = [
    { key: 'instagram', label: 'Instagram', content: state.providerStatuses.some(provider => provider.providerKey === 'instagram' && provider.status === 'connected') ? 1 : 0 },
    { key: 'events', label: 'Events', content: sectionItemCount(configured.get('events')) },
    { key: 'coffee', label: 'Coffee/menu', content: sectionItemCount(configured.get('coffee')) },
    { key: 'products', label: 'Store products', content: state.catalogProducts.length },
    { key: 'gallery', label: 'Gallery', content: sectionItemCount(configured.get('gallery')) },
  ];
  const liveCount = descriptors.filter(item => sectionState(configured.get(item.key), item.content) === 'live').length;
  if (els.sectionStatusSummary) {
    els.sectionStatusSummary.textContent = `${liveCount} live · ${descriptors.length - liveCount} hidden or disabled`;
  }

  els.sectionControlsGrid.innerHTML = descriptors.map(item => {
    const section = configured.get(item.key) ?? {};
    const status = sectionState(section, item.content);
    return `
      <fieldset class="section-control" data-section-state="${escapeHtml(status)}">
        <legend>
          <span>${escapeHtml(item.label)}</span>
          <em>${escapeHtml(status)}</em>
        </legend>
        <input type="hidden" name="sectionKey_${escapeHtml(item.key)}" value="${escapeHtml(item.key)}" />
        <label class="section-control__toggle">
          <input type="checkbox" name="sectionEnabled_${escapeHtml(item.key)}" ${section.enabled === false ? '' : 'checked'} />
          Enabled
        </label>
        <label>Title
          <input type="text" name="sectionTitle_${escapeHtml(item.key)}" value="${escapeHtml(section.title || '')}" />
        </label>
        <label>Copy
          <textarea name="sectionCopy_${escapeHtml(item.key)}" rows="2">${escapeHtml(section.copy || '')}</textarea>
        </label>
        ${item.key === 'events' || item.key === 'coffee' || item.key === 'gallery' ? `
          <label>Items
            <textarea name="sectionItems_${escapeHtml(item.key)}" rows="3">${escapeHtml(sectionItemsText(section.items))}</textarea>
          </label>
        ` : ''}
      </fieldset>
    `;
  }).join('');
}

function renderProviderStatuses() {
  if (!els.providerStatusGrid) return;

  const providers = state.providerStatuses?.length ? state.providerStatuses : state.settings?.providers ?? [];
  els.providerStatusGrid.innerHTML = providers.length
    ? providers.map(renderProviderStatus).join('')
    : '<p class="empty">No provider adapters configured.</p>';

  els.providerStatusGrid.querySelectorAll('[data-provider-action="square-oauth"]').forEach(button => {
    button.addEventListener('click', startSquareConnection);
  });
  els.providerStatusGrid.querySelectorAll('[data-provider-action="instagram-refresh"]').forEach(button => {
    button.addEventListener('click', refreshInstagramToken);
  });
  els.providerStatusGrid.querySelectorAll('[data-provider-action="instagram-oauth"]').forEach(button => {
    button.addEventListener('click', startInstagramConnection);
  });
}

function renderProviderStatus(provider) {
  const details = providerDetails(provider);
  const action = providerAction(provider);
  return `
    <article class="provider-status-card">
      <div class="provider-status-card__header">
        <div>
          <p class="admin-eyebrow">${escapeHtml(provider.providerKind || provider.kind || 'provider')}</p>
          <h3>${escapeHtml(provider.displayName || provider.label || provider.providerKey)}</h3>
        </div>
        <span class="status-pill" data-status="${escapeHtml(provider.status)}">${escapeHtml(formatProviderStatus(provider.status))}</span>
      </div>
      <dl class="provider-status-card__facts">
        ${details.length ? details.map(([label, value]) => `
          <div>
            <dt>${escapeHtml(label)}</dt>
            <dd>${escapeHtml(value)}</dd>
          </div>
        `).join('') : '<div><dt>Status</dt><dd>No public connection details</dd></div>'}
      </dl>
      ${provider.errorMessage ? `<p class="provider-status-card__error">${escapeHtml(provider.errorMessage)}</p>` : ''}
      ${action}
    </article>
  `;
}

function renderBookingLists() {
  renderSimpleList(els.arrivals, state.dashboard?.arrivalsToday ?? [], renderBookingRow, 'No arrivals today.');
  renderSimpleList(els.departures, state.dashboard?.departuresToday ?? [], renderBookingRow, 'No departures today.');
  renderSimpleList(els.bookingsList, state.bookings, booking => `
    <li class="booking-row">
      <div>
        <strong>${escapeHtml(booking.bookingCode)}</strong>
        <span>${escapeHtml(booking.customerName)} · Site ${escapeHtml(booking.rvSiteId)} · ${escapeHtml(booking.startDate)} to ${escapeHtml(booking.endDate)}</span>
      </div>
      <div class="booking-row__actions">
        <span class="status-pill" data-status="${escapeHtml(booking.status)}">${escapeHtml(booking.status)}</span>
        ${canRefundBooking(booking)
          ? `<button type="button" class="admin-link" data-refund="${escapeHtml(booking.bookingCode)}">Refund</button>`
          : ''}
        ${state.user?.role === 'owner' && !['canceled', 'expired', 'refunded'].includes(booking.status)
          ? `<button type="button" class="admin-link" data-cancel="${escapeHtml(booking.bookingCode)}">Cancel</button>`
          : ''}
      </div>
    </li>
  `, 'No bookings yet.');

  els.bookingsList.querySelectorAll('[data-cancel]').forEach(button => {
    button.addEventListener('click', () => cancelBooking(button.dataset.cancel));
  });
  els.bookingsList.querySelectorAll('[data-refund]').forEach(button => {
    button.addEventListener('click', () => refundBooking(button.dataset.refund));
  });
}

function renderBookingRow(booking) {
  return `
    <li>
      <strong>${escapeHtml(booking.bookingCode)}</strong>
      <span>${escapeHtml(booking.customerName)} · Site ${escapeHtml(booking.rvSiteId)} · ${escapeHtml(booking.startDate)} to ${escapeHtml(booking.endDate)}</span>
    </li>
  `;
}

function renderCalendar() {
  if (!els.calendarGrid || !els.calendarDateList || !featureEnabled('booking.admin_calendar', 'adminCalendar')) return;

  els.calendarDate.value = state.selectedDate;
  els.calendarDateHeading.textContent = formatDisplayDate(state.selectedDate);

  const days = monthDays(state.selectedDate);
  els.calendarGrid.innerHTML = `
    <div class="calendar-month__head">${escapeHtml(monthLabel(state.selectedDate))}</div>
    <div class="calendar-weekdays">
      ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => `<span>${day}</span>`).join('')}
    </div>
    <div class="calendar-days">
      ${days.map(day => day
        ? renderCalendarDay(day)
        : '<span class="calendar-day calendar-day--blank" aria-hidden="true"></span>').join('')}
    </div>
  `;

  els.calendarGrid.querySelectorAll('[data-calendar-day]').forEach(button => {
    button.addEventListener('click', () => {
      state.selectedDate = button.dataset.calendarDay;
      renderCalendar();
      renderPropertyMap();
    });
  });

  const selectedBookings = bookingsTouchingDate(state.selectedDate);
  renderSimpleList(els.calendarDateList, selectedBookings, booking => `
    <li class="booking-row">
      <div>
        <strong>${escapeHtml(siteLabel(booking.rvSiteId))} · ${escapeHtml(booking.customerName)}</strong>
        <span>${escapeHtml(booking.bookingCode)} · ${escapeHtml(formatDateRange(booking))}</span>
      </div>
      <div class="booking-row__actions">
        <span class="status-pill" data-status="${escapeHtml(dayStatus(booking, state.selectedDate))}">${escapeHtml(dayStatus(booking, state.selectedDate))}</span>
      </div>
    </li>
  `, 'No bookings on this date.');
}

function renderCalendarDay(date) {
  const bookings = bookingsTouchingDate(date);
  const arrivals = state.bookings.filter(booking => isActiveBooking(booking) && booking.startDate === date).length;
  const departures = state.bookings.filter(booking => isActiveBooking(booking) && booking.endDate === date).length;
  const isSelected = date === state.selectedDate;
  const isToday = date === todayIso();

  return `
    <button class="calendar-day" type="button" data-calendar-day="${escapeHtml(date)}" data-selected="${isSelected ? 'true' : 'false'}" data-today="${isToday ? 'true' : 'false'}">
      <strong>${escapeHtml(localDayNumber(date))}</strong>
      <span>${bookings.length ? `${bookings.length} booked` : 'open'}</span>
      ${arrivals || departures ? `<small>${arrivals ? `${arrivals} in` : ''}${arrivals && departures ? ' · ' : ''}${departures ? `${departures} out` : ''}</small>` : ''}
    </button>
  `;
}

function renderPropertyMap() {
  if (!els.propertyMap || !els.siteInspector || !featureEnabled('booking.admin_property_map', 'adminPropertyMap')) return;

  if (!state.selectedSiteId && state.sites[0]) state.selectedSiteId = state.sites[0].id;

  const activeForDate = bookingsForDate(state.selectedDate);
  els.propertyMap.innerHTML = `
    ${renderPropertyMapBase()}
    <div class="property-map__label property-map__label--store">Store</div>
    <div class="property-map__label property-map__label--road">Chiwawa Loop RD</div>
    <div class="property-map__label property-map__label--island">Future tent island</div>
    ${state.sites.map(site => renderMapSite(site, activeForDate)).join('')}
  `;

  const selectedSite = state.sites.find(site => site.id === state.selectedSiteId) || state.sites[0] || null;
  renderSiteInspector(selectedSite, activeForDate);
}

function renderPropertyMapBase() {
  return `
    <svg class="property-map__svg" viewBox="0 0 1200 800" aria-hidden="true" focusable="false">
      <rect width="1200" height="800" fill="#f4efe2"></rect>
      <path d="M-80 150 L560 -42" stroke="#2f2d28" stroke-width="58" stroke-linecap="round" opacity=".76" fill="none"></path>
      <path d="M-80 150 L560 -42" stroke="#fff9eb" stroke-width="3" stroke-dasharray="18 18" fill="none"></path>
      <path d="M286 158 C318 232 346 266 372 300" stroke="#6f695f" stroke-width="34" stroke-linecap="round" fill="none"></path>
      <path d="M286 158 C318 232 346 266 372 300" stroke="#fff9eb" stroke-width="3" stroke-dasharray="7 11" fill="none"></path>
      <path d="M372 300 C496 232 700 238 820 320 C922 392 908 566 780 650 C656 732 454 698 356 578 C272 476 288 374 372 300 Z" stroke="#6f695f" stroke-width="44" stroke-linecap="round" stroke-linejoin="round" fill="none"></path>
      <path d="M372 300 C496 232 700 238 820 320 C922 392 908 566 780 650 C656 732 454 698 356 578 C272 476 288 374 372 300 Z" stroke="#fff9eb" stroke-width="3" stroke-dasharray="7 11" fill="none"></path>
      <path d="M430 364 C526 312 668 314 748 366 C812 408 802 522 724 582 C632 654 480 626 414 536 C358 458 368 400 430 364 Z" fill="#d8d5b4" opacity=".9"></path>
      <rect x="118" y="206" width="130" height="84" fill="#fffdf9" stroke="#5b5144" stroke-width="3" rx="4"></rect>
      <path d="M118 206 L183 176 L248 206 Z" fill="#b65a46" stroke="#5b5144" stroke-width="3"></path>
      <rect x="260" y="118" width="150" height="56" fill="#fffdf9" stroke="#5b5144" stroke-width="3" rx="4"></rect>
      <rect x="474" y="84" width="160" height="70" fill="#dcc4a6" stroke="#5b5144" stroke-width="3" rx="4"></rect>
      <rect x="104" y="316" width="186" height="56" fill="#35322d" stroke="#5b5144" stroke-width="3" rx="4"></rect>
      <path d="M42 246 L74 304 L52 362 L88 430 L56 520 L96 626 L40 800 L0 800 L0 242 Z" fill="#586944" opacity=".18"></path>
      <path d="M956 190 C1036 318 1024 508 930 674 L1200 800 L1200 0 Z" fill="#586944" opacity=".18"></path>
    </svg>
  `;
}

function renderMapSite(site, activeForDate) {
  const booking = activeForDate.find(candidate => candidate.rvSiteId === site.id);
  const status = mapSiteStatus(site, booking);
  const selected = site.id === state.selectedSiteId;
  const style = [
    `left: ${mapPercent(site.mapX, 1200)};`,
    `top: ${mapPercent(site.mapY, 800)};`,
    `width: ${mapPercent(site.mapWidth || 88, 1200)};`,
    `height: ${mapPercent(site.mapHeight || 38, 800)};`,
    `transform: translate(-50%, -50%) rotate(${Number(site.rotation || 0)}deg);`,
  ].join(' ');

  return `
    <button class="map-site" type="button" style="${escapeHtml(style)}" data-map-site="${escapeHtml(site.id)}" data-status="${escapeHtml(status)}" data-selected="${selected ? 'true' : 'false'}">
      <strong>${escapeHtml(site.siteNumber)}</strong>
      <span>${escapeHtml(status)}</span>
    </button>
  `;
}

function renderSiteInspector(site, activeForDate) {
  if (!site) {
    els.siteInspector.innerHTML = '<p class="empty">No RV sites configured.</p>';
    return;
  }

  const booking = activeForDate.find(candidate => candidate.rvSiteId === site.id);
  const upcoming = upcomingBookingsForSite(site.id).slice(0, 4);
  const status = mapSiteStatus(site, booking);
  const canUpdateStatus = state.user?.role === 'owner' && featureEnabled('booking.site_status_management');

  els.siteInspector.innerHTML = `
    <div>
      <p class="admin-eyebrow">Selected Site</p>
      <h3>Site ${escapeHtml(site.siteNumber)}</h3>
      <span class="status-pill" data-status="${escapeHtml(status)}">${escapeHtml(status)}</span>
    </div>
    <dl class="site-inspector__facts">
      <div><dt>Power</dt><dd>${escapeHtml(site.amp || 'Unknown')}</dd></div>
      <div><dt>Type</dt><dd>${escapeHtml(site.type || 'Unknown')}</dd></div>
      <div><dt>Rate</dt><dd>${escapeHtml(formatMoney(site.nightlyPriceCents))}</dd></div>
      <div><dt>Shade</dt><dd>${escapeHtml(site.shade || 'Unknown')}</dd></div>
    </dl>
    <div class="site-inspector__section">
      <h4>Amenities</h4>
      <div class="site-inspector__chips">
        ${(site.amenities ?? []).length
          ? site.amenities.map(amenity => `<span>${escapeHtml(amenity)}</span>`).join('')
          : '<span>Confirm amenities</span>'}
      </div>
      ${site.customerNotes ? `<p>${escapeHtml(site.customerNotes)}</p>` : ''}
      ${site.adminNotes && state.user?.role === 'owner' ? `<p><strong>Owner note:</strong> ${escapeHtml(site.adminNotes)}</p>` : ''}
    </div>
    ${booking ? `
      <div class="site-inspector__section">
        <h4>${escapeHtml(formatDisplayDate(state.selectedDate))}</h4>
        <p><strong>${escapeHtml(booking.customerName)}</strong></p>
        <p>${escapeHtml(booking.bookingCode)} · ${escapeHtml(formatDateRange(booking))}</p>
      </div>
    ` : `
      <div class="site-inspector__section">
        <h4>${escapeHtml(formatDisplayDate(state.selectedDate))}</h4>
        <p>Open on selected date.</p>
      </div>
    `}
    ${canUpdateStatus ? `
      <label class="site-inspector__status">Site status
        <select data-map-status="${escapeHtml(site.id)}">
          ${['active', 'maintenance', 'inactive'].map(option => `
            <option value="${option}" ${site.status === option ? 'selected' : ''}>${option}</option>
          `).join('')}
        </select>
      </label>
    ` : ''}
    <div class="site-inspector__section">
      <h4>Next Bookings</h4>
      <ul class="admin-list">
        ${upcoming.length ? upcoming.map(booking => `
          <li>
            <strong>${escapeHtml(booking.customerName)}</strong>
            <span>${escapeHtml(booking.startDate)} to ${escapeHtml(booking.endDate)}</span>
          </li>
        `).join('') : '<li class="empty">No upcoming bookings.</li>'}
      </ul>
    </div>
  `;

  els.siteInspector.querySelector('[data-map-status]')?.addEventListener('change', event => {
    updateSiteStatus(event.target.dataset.mapStatus, event.target.value).catch(error => showToast(error.message, 'error'));
  });
}

function renderSites() {
  renderSimpleList(els.siteStatusList, state.sites, site => `
    <li class="site-row site-editor-row">
      <form class="site-editor-form" data-site-form="${escapeHtml(site.id)}">
        <div class="site-editor-form__header">
          <div>
            <strong>${escapeHtml(site.displayName || `Site ${site.siteNumber}`)}</strong>
            <span>${formatMoney(site.nightlyPriceCents)} · ${escapeHtml(site.amp || '')} · ${escapeHtml(site.type || '')}</span>
          </div>
          <span class="status-pill" data-status="${escapeHtml(site.squareCatalogObjectId ? 'mapped' : 'unmapped')}">${site.squareCatalogObjectId ? 'mapped' : 'unmapped'}</span>
        </div>
        <div class="site-editor-grid">
          <label>Name<input type="text" name="displayName" value="${escapeHtml(site.displayName || '')}" /></label>
          <label>Status<select name="status">
            ${['active', 'maintenance', 'inactive'].map(status => `
              <option value="${status}" ${site.status === status ? 'selected' : ''}>${status}</option>
            `).join('')}
          </select></label>
          <label>Nightly cents<input type="number" name="nightlyPriceCents" min="0" step="1" value="${escapeHtml(site.nightlyPriceCents ?? 0)}" /></label>
          <label>Max RV feet<input type="number" name="maxRvLengthFeet" min="0" step="1" value="${escapeHtml(site.maxRvLengthFeet ?? '')}" /></label>
          <label>Amp<input type="text" name="amp" value="${escapeHtml(site.amp || '')}" /></label>
          <label>Site type<input type="text" name="type" value="${escapeHtml(site.type || '')}" /></label>
          <label>Shade<input type="text" name="shade" value="${escapeHtml(site.shade || '')}" /></label>
          <label>SKU<input type="text" name="sku" value="${escapeHtml(site.sku || '')}" /></label>
          <label>Square variation<select name="squareCatalogObjectId">
            <option value="">Unmapped custom amount</option>
            ${catalogOptions(site.squareCatalogObjectId)}
          </select></label>
        </div>
        <div class="site-editor-grid site-editor-grid--map">
          ${['mapX', 'mapY', 'mapWidth', 'mapHeight', 'rotation'].map(field => `
            <label>${escapeHtml(field)}<input type="number" name="${field}" step="1" value="${escapeHtml(site[field] ?? '')}" /></label>
          `).join('')}
        </div>
        <label>Amenities<textarea name="amenities" rows="2">${escapeHtml((site.amenities ?? []).join('\\n'))}</textarea></label>
        <label>Customer notes<textarea name="customerNotes" rows="2">${escapeHtml(site.customerNotes || '')}</textarea></label>
        <label>Admin notes<textarea name="adminNotes" rows="2">${escapeHtml(site.adminNotes || '')}</textarea></label>
        <div class="site-editor-form__actions owner-only">
          <button type="submit" class="admin-button">Save Site</button>
        </div>
      </form>
    </li>
  `, 'No RV sites configured.');

  els.siteStatusList.querySelectorAll('[data-site-form]').forEach(form => {
    form.querySelectorAll('input, textarea, select, button').forEach(control => {
      control.disabled = state.user?.role !== 'owner' || !state.featureFlags['booking.site_status_management'];
    });
    form.addEventListener('submit', event => {
      event.preventDefault();
      updateSiteDetails(form.dataset.siteForm, new FormData(form)).catch(error => showToast(error.message, 'error'));
    });
  });
}

function renderSiteSelects() {
  const options = state.sites.map(site => `
    <option value="${escapeHtml(site.id)}">Site ${escapeHtml(site.siteNumber)} · ${formatMoney(site.nightlyPriceCents)}</option>
  `).join('');

  els.siteSelects.forEach(select => {
    const selected = select.value;
    select.innerHTML = options;
    if (selected) select.value = selected;
  });
}

function renderNotifications() {
  renderSimpleList(els.notificationsList, state.notifications, notification => `
    <li>
      <strong>${escapeHtml(notification.subject)}</strong>
      <span>${escapeHtml(notification.channel)} · ${escapeHtml(notification.status)} · ${escapeHtml(notification.createdAt)}</span>
    </li>
  `, 'No notifications recorded.');
}

function renderAudit() {
  if (state.user?.role !== 'owner') {
    els.auditList.innerHTML = '<li class="empty">Owner permission required.</li>';
    return;
  }

  renderSimpleList(els.auditList, state.audit, record => `
    <li>
      <strong>${escapeHtml(record.action)}</strong>
      <span>${escapeHtml(record.actorRole)} · ${escapeHtml(record.targetId || record.targetType || '')} · ${escapeHtml(record.createdAt)}</span>
    </li>
  `, 'No audit records yet.');
}

function taskItem({ label, meta, status }) {
  return `
    <li class="employee-task">
      <div>
        <strong>${escapeHtml(label)}</strong>
        <span>${escapeHtml(meta)}</span>
      </div>
      <span class="status-pill" data-status="${escapeHtml(status)}">${escapeHtml(status)}</span>
    </li>
  `;
}

function activeBookings(bookings) {
  return (bookings ?? []).filter(isActiveBooking);
}

function guestBookings(bookings) {
  return activeBookings(bookings).filter(booking => booking.status !== 'blocked');
}

function isActiveBooking(booking) {
  return !['canceled', 'expired', 'failed', 'refunded'].includes(booking.status);
}

function bookingsForDate(date) {
  return activeBookings(state.bookings)
    .filter(booking => booking.startDate <= date && booking.endDate > date)
    .sort(compareBookings);
}

function bookingsTouchingDate(date) {
  return activeBookings(state.bookings)
    .filter(booking => booking.startDate <= date && booking.endDate >= date)
    .sort(compareBookings);
}

function upcomingBookingsForSite(siteId) {
  const today = todayIso();
  return activeBookings(state.bookings)
    .filter(booking => booking.rvSiteId === siteId && booking.endDate >= today)
    .sort(compareBookings);
}

function dayStatus(booking, date) {
  if (booking.startDate === date) return 'arrival';
  if (booking.endDate === date) return 'departure';
  return booking.status;
}

function mapSiteStatus(site, booking) {
  if (site.status === 'maintenance' || site.status === 'inactive') return site.status;
  if (booking?.status === 'blocked') return 'blocked';
  if (booking) return 'occupied';
  return 'active';
}

function siteLabel(siteId) {
  const site = state.sites.find(candidate => candidate.id === siteId);
  return site ? `Site ${site.siteNumber}` : `Site ${siteId}`;
}

function formatDateRange(booking) {
  return `${formatDisplayDate(booking.startDate)} to ${formatDisplayDate(booking.endDate)}`;
}

function monthDays(selectedDate) {
  const [year, month] = selectedDate.split('-').map(Number);
  const first = new Date(year, month - 1, 1);
  const totalDays = new Date(year, month, 0).getDate();
  const blanks = Array.from({ length: first.getDay() }, () => null);
  const days = Array.from({ length: totalDays }, (_, index) => localDateString(new Date(year, month - 1, index + 1)));
  return [...blanks, ...days];
}

function monthLabel(date) {
  return formatLocalDate(date, { month: 'long', year: 'numeric' });
}

function localDayNumber(date) {
  return Number(date.slice(-2));
}

function formatDisplayDate(date) {
  return formatLocalDate(date, { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatLocalDate(date, options) {
  const [year, month, day] = date.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', options).format(new Date(year, month - 1, day));
}

function shiftSelectedDate(days) {
  const [year, month, day] = state.selectedDate.split('-').map(Number);
  const nextDate = new Date(year, month - 1, day + days);
  state.selectedDate = localDateString(nextDate);
  renderCalendar();
  renderPropertyMap();
}

function todayIso() {
  return localDateString(new Date());
}

function bindDateRangeForm(form, options) {
  if (!form) return;
  const startInput = form.elements.namedItem(options.startName);
  const endInput = form.elements.namedItem(options.endName);
  if (!startInput || !endInput) return;

  const sync = () => syncDateRangeForm(form, options);
  startInput.min = todayIso();
  endInput.min = startInput.value ? addLocalDays(startInput.value, 1) : todayIso();
  startInput.addEventListener('input', sync);
  startInput.addEventListener('change', sync);
  endInput.addEventListener('input', sync);
  endInput.addEventListener('change', sync);
}

function syncDateRangeForm(form, options) {
  if (!form) return;
  const startInput = form.elements.namedItem(options.startName);
  const endInput = form.elements.namedItem(options.endName);
  if (!startInput || !endInput) return;

  startInput.min = todayIso();
  if (!startInput.value) {
    endInput.min = todayIso();
    return;
  }

  const minimumEnd = addLocalDays(startInput.value, 1);
  endInput.min = minimumEnd;
  if (!endInput.value || endInput.value <= startInput.value) {
    endInput.value = minimumEnd;
  }
}

function addLocalDays(value, days) {
  const [year, month, day] = String(value || '').split('-').map(Number);
  if (!year || !month || !day) return todayIso();
  const date = new Date(year, month - 1, day + days);
  return localDateString(date);
}

function localDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function mapPercent(value, axisSize) {
  const number = Number(value || 0);
  const ratio = number > 1 ? number / axisSize : number;
  return `${ratio * 100}%`;
}

function compareBookings(a, b) {
  return String(a.startDate).localeCompare(String(b.startDate))
    || String(a.rvSiteId).localeCompare(String(b.rvSiteId))
    || String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
}

function compareSites(a, b) {
  return String(a.siteNumber).localeCompare(String(b.siteNumber), undefined, { numeric: true });
}

function featureEnabled(canonical, alias = null) {
  return Boolean(state.featureFlags[canonical] || (alias ? state.featureFlags[alias] : false));
}

function splitTextList(value) {
  return String(value || '')
    .split(/[\n,]+/)
    .map(item => item.trim())
    .filter(Boolean);
}

function nullableNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function collectSectionSettings(form) {
  return ['instagram', 'events', 'coffee', 'products', 'gallery'].map(key => ({
    key,
    enabled: form.get(`sectionEnabled_${key}`) === 'on',
    title: form.get(`sectionTitle_${key}`) || '',
    copy: form.get(`sectionCopy_${key}`) || '',
    items: parseSectionItems(form.get(`sectionItems_${key}`)),
  }));
}

function parseSectionItems(value) {
  return String(value || '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const [title, dateOrPrice, description] = line.split('|').map(part => part.trim());
      return {
        title,
        name: title,
        date: dateOrPrice || '',
        price: dateOrPrice || '',
        description: description || '',
      };
    });
}

function sectionItemCount(section = {}) {
  return Array.isArray(section.items) ? section.items.length : 0;
}

function sectionState(section = {}, contentCount = 0) {
  if (section.enabled === false) return 'disabled';
  return contentCount > 0 ? 'live' : 'hidden empty';
}

function sectionItemsText(items = []) {
  return (items ?? []).map(item => [
    item.title || item.name || '',
    item.date || item.price || '',
    item.description || item.copy || '',
  ].filter(Boolean).join(' | ')).join('\n');
}

function catalogOptions(selectedVariationId) {
  return state.catalogProducts.map(product => {
    const variationId = product.squareVariationId || product.variationId;
    return `
      <option value="${escapeHtml(variationId)}" ${variationId === selectedVariationId ? 'selected' : ''}>
        ${escapeHtml(product.name)}${product.sku ? ` · ${escapeHtml(product.sku)}` : ''}${product.priceCents ? ` · ${escapeHtml(formatMoney(product.priceCents))}` : ''}
      </option>
    `;
  }).join('');
}

function providerDetails(provider = {}) {
  const config = provider.publicConfig ?? {};
  const labels = {
    applicationId: 'Application ID',
    locationId: 'Location ID',
    environment: 'Environment',
    checkoutSurface: 'Checkout surface',
    fromEmail: 'From email',
    senderEmail: 'Sender email',
    fromName: 'From name',
    workspace: 'Workspace',
    channel: 'Channel',
    handle: 'Handle',
    profileUrl: 'Profile URL',
    postsConfigured: 'Embed posts',
    feedSource: 'Feed source',
    feedLimit: 'Feed limit',
    apiVersion: 'API version',
    tokenType: 'Token type',
    tokenExpiresAt: 'Token expires',
  };
  const entries = Object.entries(config)
    .filter(([key, value]) => !/secret|token|password|key|credential/i.test(key) && value !== null && typeof value !== 'object')
    .map(([key, value]) => [labels[key] || titleize(key), value]);
  if (provider.lastSyncAt) entries.push(['Last sync', provider.lastSyncAt]);
  return entries;
}

function providerAction(provider = {}) {
  if (state.user?.role !== 'owner') return '';
  if (provider.providerKey === 'instagram') {
    const connected = provider.status === 'connected';
    const label = connected ? 'Reconnect Instagram' : 'Connect Instagram';
    return `
      <div class="provider-status-card__actions">
        <button class="admin-button" type="button" data-provider-action="instagram-oauth">${escapeHtml(label)}</button>
        ${connected ? '<button class="admin-button" type="button" data-provider-action="instagram-refresh">Refresh Instagram token</button>' : ''}
      </div>
    `;
  }
  if (provider.providerKey !== 'square') return '';

  const connected = provider.status === 'connected';
  const label = connected ? 'Reconnect Square' : 'Connect Square';
  return `
    <div class="provider-status-card__actions">
      <button class="admin-button" type="button" data-provider-action="square-oauth">${escapeHtml(label)}</button>
    </div>
  `;
}

function apiUrl(path) {
  if (/^https?:\/\//i.test(path)) return path;
  const cleanRoot = API_ROOT.replace(/\/$/, '');
  const cleanPath = String(path || '').replace(/^\/api/, '').replace(/^\//, '');
  return `${cleanRoot}/${cleanPath}`;
}

function setButtonBusy(button, label) {
  if (!button) return;
  if (label) {
    button.dataset.previousLabel = button.textContent;
    button.textContent = label;
    button.disabled = true;
    return;
  }
  button.textContent = button.dataset.previousLabel || button.textContent;
  button.disabled = false;
  delete button.dataset.previousLabel;
}

function providerConnectionErrorMessage(providerName, error) {
  if (/Admin API could not be reached|Failed to fetch|NetworkError/i.test(error.message)) {
    return `${providerName} connection could not reach the admin API. Expected API root: ${API_ROOT}.`;
  }
  return `${providerName} connection failed: ${error.message}`;
}

function sectionByKey(sections = [], key) {
  return (sections ?? []).find(section => section.key === key) ?? null;
}

function mergeSectionSettings(sections = [], updatedSection = {}) {
  const existing = new Map((sections ?? []).map(section => [section.key, section]));
  existing.set(updatedSection.key, updatedSection);
  return [...existing.values()];
}

function providerRedirectUri(provider) {
  const url = new URL(window.location.href);
  url.pathname = '/admin.html';
  url.search = provider === 'instagram' ? '' : `?provider=${encodeURIComponent(provider)}`;
  url.hash = '';
  return url.toString();
}

function readPendingProviderConnection() {
  try {
    return JSON.parse(sessionStorage.getItem(pendingProviderKey) || 'null');
  } catch {
    return null;
  }
}

function clearProviderCallbackQuery() {
  const url = new URL(window.location.href);
  url.searchParams.delete('provider');
  url.searchParams.delete('code');
  url.searchParams.delete('state');
  url.searchParams.delete('error');
  url.searchParams.delete('error_description');
  window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
}

function providerPlaceholderMessage(data = {}) {
  const missing = (data.missing ?? [])
    .map(providerMissingLabel)
    .filter(Boolean);
  const label = data.connection?.providerLabel || providerLabelFromMissing(data.missing) || 'Provider';
  return missing.length
    ? `${label} OAuth is not configured yet. Missing ${missing.join(', ')}.`
    : `${label} OAuth is not configured yet.`;
}

function providerMissingLabel(value) {
  const labels = {
    'platform_provider_configs.square.environment': 'Square environment',
    'platform_provider_configs.square.public_config.applicationId': 'Square application ID',
    'platform_provider_configs.square.encrypted_credentials.clientSecret': 'Square OAuth client secret',
    'platform_provider_configs.instagram.public_config.applicationId': 'Instagram app ID',
    'platform_provider_configs.instagram.encrypted_credentials.clientSecret': 'Instagram app secret',
  };
  return labels[value] || value;
}

function providerLabelFromMissing(missing = []) {
  if (missing.some(value => String(value).includes('.instagram.'))) return 'Instagram';
  if (missing.some(value => String(value).includes('.square.'))) return 'Square';
  return '';
}

function setLoginStatus(message) {
  if (!els.loginStatus) return;
  els.loginStatus.textContent = message;
  els.loginStatus.hidden = !message;
}

function loginErrorMessage(error) {
  if (/Request failed with 404|Failed to fetch|Unexpected token/i.test(error.message)) {
    return 'The admin API is not responding. Start the API server or open the admin page from the full Midway server.';
  }
  return error.message;
}

function formatProviderStatus(status) {
  return titleize(String(status || 'not_connected').replaceAll('_', ' '));
}

function isoToDatetimeLocal(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function datetimeLocalToIso(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function titleize(value) {
  return String(value || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, char => char.toUpperCase());
}

function canRefundBooking(booking) {
  return state.user?.role === 'owner'
    && featureEnabled('payments.refunds', 'refunds')
    && ['paid', 'confirmed'].includes(booking.status);
}

function renderSimpleList(target, items, renderItem, emptyText) {
  target.innerHTML = items.length > 0
    ? items.map(renderItem).join('')
    : `<li class="empty">${escapeHtml(emptyText)}</li>`;
}

function formatMoney(cents) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(Number(cents || 0) / 100);
}

function showToast(message, type = 'success') {
  els.toast.textContent = message;
  els.toast.dataset.type = type;
  els.toast.hidden = false;
  window.setTimeout(() => {
    els.toast.hidden = true;
  }, 3200);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
