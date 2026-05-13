const tokenKey = 'midway_admin_session';
const state = {
  token: sessionStorage.getItem(tokenKey) || '',
  user: null,
  featureFlags: {},
  sites: [],
  bookings: [],
  dashboard: null,
  settings: null,
  providerStatuses: [],
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
  logoutBtn: document.getElementById('logoutBtn'),
  refreshBtn: document.getElementById('refreshBtn'),
  userRole: document.getElementById('userRole'),
  stats: document.getElementById('dashboardStats'),
  alerts: document.getElementById('alertsList'),
  arrivals: document.getElementById('arrivalsList'),
  departures: document.getElementById('departuresList'),
  employeeTaskPanel: document.getElementById('employeeTaskPanel'),
  employeeTaskGrid: document.getElementById('employeeTaskGrid'),
  settingsPanel: document.getElementById('settingsPanel'),
  settingsForm: document.getElementById('businessSettingsForm'),
  settingsRoleNote: document.getElementById('settingsRoleNote'),
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
  toast: document.getElementById('toast'),
};

els.loginForm?.addEventListener('submit', async event => {
  event.preventDefault();
  const email = els.loginEmail.value.trim();
  const password = els.loginPassword.value;
  if (!email || !password) {
    showToast('Enter your email and password.', 'error');
    return;
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
    showToast(error.message, 'error');
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
      instagramHandle: form.get('instagramHandle'),
      instagramUrl: form.get('instagramUrl'),
    },
    publicSite: {
      url: form.get('publicSiteUrl'),
      theme: form.get('theme'),
      instagramPosts: splitTextList(form.get('instagramPosts')),
    },
  });
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

els.propertyMap?.addEventListener('click', event => {
  const marker = event.target.closest('[data-map-site]');
  if (!marker) return;
  state.selectedSiteId = marker.dataset.mapSite;
  renderPropertyMap();
});

els.manualForm?.addEventListener('submit', async event => {
  event.preventDefault();
  const form = new FormData(els.manualForm);
  await mutate('/api/admin/bookings', {
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
  }, 'Manual booking created.');
  els.manualForm.reset();
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
  await loadAdminData();
}

async function loadAdminData() {
  const [dashboard, sites, bookings, notifications, audit, settings, providerStatuses] = await Promise.all([
    api('/api/admin/dashboard/today'),
    api('/api/admin/rv-sites'),
    api('/api/admin/bookings'),
    api('/api/admin/notifications'),
    state.user?.role === 'owner' ? api('/api/admin/audit-log') : Promise.resolve([]),
    featureEnabled('core.tenant_config') ? api('/api/admin/settings') : Promise.resolve(null),
    featureEnabled('core.provider_adapters') ? api('/api/admin/providers') : Promise.resolve([]),
  ]);

  state.dashboard = dashboard;
  state.sites = sites;
  state.bookings = bookings;
  state.notifications = notifications;
  state.audit = audit;
  state.settings = settings;
  state.providerStatuses = providerStatuses;

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

async function updateSettings(body) {
  state.settings = await api('/api/admin/settings', {
    method: 'PATCH',
    body,
  });
  showToast('Site settings updated.', 'success');
  await loadAdminData();
}

async function api(path, { method = 'GET', body, auth = true } = {}) {
  const response = await fetch(path, {
    method,
    headers: {
      ...(auth ? { Authorization: `Bearer ${state.token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
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
  renderStats();
  renderEmployeeMode();
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
    instagramHandle: business.instagramHandle,
    instagramUrl: business.instagramUrl,
    publicSiteUrl: publicSite.url,
    theme: publicSite.theme,
    instagramPosts: (publicSite.instagramPosts ?? []).join('\n'),
  };

  for (const [name, value] of Object.entries(fields)) {
    const field = els.settingsForm.elements.namedItem(name);
    if (field) field.value = value ?? '';
  }

  els.settingsForm.querySelectorAll('input, textarea, select, button').forEach(control => {
    control.disabled = !canEdit;
  });
  if (els.settingsRoleNote) {
    els.settingsRoleNote.textContent = canEdit ? 'Owner edit access' : 'Read only';
  }
  els.settingsForm.dataset.readonly = canEdit ? 'false' : 'true';
}

function renderProviderStatuses() {
  if (!els.providerStatusGrid) return;

  const providers = state.providerStatuses?.length ? state.providerStatuses : state.settings?.providers ?? [];
  els.providerStatusGrid.innerHTML = providers.length
    ? providers.map(renderProviderStatus).join('')
    : '<p class="empty">No provider adapters configured.</p>';
}

function renderProviderStatus(provider) {
  const details = providerDetails(provider);
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
    <div class="property-map__label property-map__label--road">Hwy 22</div>
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
      <path d="M288 158 C320 232 354 268 404 314" stroke="#6f695f" stroke-width="34" stroke-linecap="round" fill="none"></path>
      <path d="M288 158 C320 232 354 268 404 314" stroke="#fff9eb" stroke-width="3" stroke-dasharray="7 11" fill="none"></path>
      <path d="M404 314 C496 246 660 232 792 260 C888 280 922 382 890 522 C862 644 754 716 610 704 C468 692 336 640 292 548 C246 450 302 366 404 314 Z" stroke="#6f695f" stroke-width="44" stroke-linecap="round" stroke-linejoin="round" fill="none"></path>
      <path d="M404 314 C496 246 660 232 792 260 C888 280 922 382 890 522 C862 644 754 716 610 704 C468 692 336 640 292 548 C246 450 302 366 404 314 Z" stroke="#fff9eb" stroke-width="3" stroke-dasharray="7 11" fill="none"></path>
      <path d="M426 366 C510 312 652 302 758 330 C830 350 846 430 816 536 C788 618 712 658 610 658 C488 658 392 616 356 542 C322 470 348 414 426 366 Z" fill="#d8d5b4" opacity=".9"></path>
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
    <li class="site-row">
      <div>
        <strong>Site ${escapeHtml(site.siteNumber)}</strong>
        <span>${formatMoney(site.nightlyPriceCents)} · ${escapeHtml(site.amp || '')} · ${escapeHtml(site.type || '')}</span>
      </div>
      <select data-site-status="${escapeHtml(site.id)}" ${state.user?.role !== 'owner' || !state.featureFlags['booking.site_status_management'] ? 'disabled' : ''}>
        ${['active', 'maintenance', 'inactive'].map(status => `
          <option value="${status}" ${site.status === status ? 'selected' : ''}>${status}</option>
        `).join('')}
      </select>
    </li>
  `, 'No RV sites configured.');

  els.siteStatusList.querySelectorAll('[data-site-status]').forEach(select => {
    select.addEventListener('change', () => updateSiteStatus(select.dataset.siteStatus, select.value));
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
  };
  const entries = Object.entries(config)
    .filter(([key, value]) => !/secret|token|password|key|credential/i.test(key) && value !== null && typeof value !== 'object')
    .map(([key, value]) => [labels[key] || titleize(key), value]);
  if (provider.lastSyncAt) entries.push(['Last sync', provider.lastSyncAt]);
  return entries;
}

function formatProviderStatus(status) {
  return titleize(String(status || 'not_connected').replaceAll('_', ' '));
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
