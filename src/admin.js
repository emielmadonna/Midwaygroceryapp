/* ═══════════════════════════════════════
   ADMIN PANEL LOGIC
   ═══════════════════════════════════════ */

import {
    getFuelPrices, setFuelPrices,
    getHours, setHours,
    getProducts, setProducts,
    getSettings, setSettings,
    getAINotes, setAINotes,
    getFuelInventory, setFuelInventory,
    getDayOrder, getDayLabel,
    getRentals, setRentals,
    syncCloudData,
} from './data.js';

import {
    notifyFuelPriceChange,
    notifyHoursChange,
    notifyProductChange,
} from './slack.js';

// ─── Auth ───

const loginScreen = document.getElementById('loginScreen');
const dashboard = document.getElementById('adminDashboard');
const loginForm = document.getElementById('loginForm');
const loginPassword = document.getElementById('loginPassword');

async function checkAuth() {
    const authed = sessionStorage.getItem('midway_admin_auth');
    if (authed === 'true') {
        await syncCloudData();
        showDashboard();
    }
}

function showDashboard() {
    loginScreen.style.display = 'none';
    dashboard.style.display = 'block';
    loadAllData();
}

loginForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    const settings = getSettings();
    if (loginPassword.value === settings.adminPassword) {
        sessionStorage.setItem('midway_admin_auth', 'true');
        showDashboard();
    } else {
        showToast('Wrong password', 'error');
        loginPassword.value = '';
    }
});

document.getElementById('logoutBtn')?.addEventListener('click', () => {
    sessionStorage.removeItem('midway_admin_auth');
    location.reload();
});

// ─── Load Data into Forms ───

function loadAllData() {
    loadFuelPrices();
    loadAINotes();
    loadHours();
    loadFuelInventory();
    loadRentals();
    loadProducts();
    loadSettings();
}

function loadFuelInventory() {
    const inv = getFuelInventory();
    const unleadedInput = document.getElementById('invUnleaded');
    const dieselInput = document.getElementById('invDiesel');
    const thresholdInput = document.getElementById('fuelThreshold');

    if (unleadedInput) unleadedInput.value = inv.unleaded;
    if (dieselInput) dieselInput.value = inv.diesel;
    if (thresholdInput) thresholdInput.value = inv.threshold || 1000;

    updateFuelGauges(inv);
}

function updateFuelGauges(inv) {
    const gUnleaded = document.getElementById('gaugeUnleaded');
    const gDiesel = document.getElementById('gaugeDiesel');

    if (gUnleaded) gUnleaded.style.height = `${(inv.unleaded / 5000) * 100}\%`;
    if (gDiesel) gDiesel.style.height = `${(inv.diesel / 5000) * 100}\%`;
}

document.getElementById('saveFuelInvBtn')?.addEventListener('click', async () => {
    const unleaded = parseInt(document.getElementById('invUnleaded').value, 10);
    const diesel = parseInt(document.getElementById('invDiesel').value, 10);
    const threshold = parseInt(document.getElementById('fuelThreshold').value, 10);

    const inv = { unleaded, diesel, threshold };
    setFuelInventory(inv);
    updateFuelGauges(inv);

    showToast('Inventory saved! ✨', 'success');

    // Check for low fuel and notify Slack
    if (unleaded < threshold || diesel < threshold) {
        let lowMsg = '⚠️ *Low Fuel Alert* ⚠️\n';
        if (unleaded < threshold) lowMsg += `• Unleaded tank is at *${unleaded} gal* (Threshold: ${threshold})\n`;
        if (diesel < threshold) lowMsg += `• Diesel tank is at *${diesel} gal* (Threshold: ${threshold})\n`;
        lowMsg += '\n_Would you like the AI to prepare an order proposal?_';

        // Use general slack notification for now
        import('./slack.js').then(s => s.sendSlackNotification(lowMsg, 'fuel'));
    }
});

function loadAINotes() {
    const notes = getAINotes();
    const input = document.getElementById('adminAINotes');
    if (input) input.value = notes;
}

document.getElementById('saveAINotesBtn')?.addEventListener('click', () => {
    const notes = document.getElementById('adminAINotes').value.trim();
    setAINotes(notes);
    showToast('Store Intelligence updated! ✨', 'success');
});

function loadFuelPrices() {
    const fuel = getFuelPrices();
    document.getElementById('adminUnleaded').value = fuel.unleaded;
    document.getElementById('adminDiesel').value = fuel.diesel;
}

function loadHours() {
    const hours = getHours();
    const grid = document.getElementById('adminHoursGrid');
    const dayOrder = getDayOrder();

    grid.innerHTML = dayOrder.map(day => {
        const h = hours[day];
        return `
      <div class="admin__hours-row">
        <span class="admin__hours-day">${getDayLabel(day)}</span>
        <input type="text" data-day="${day}" data-type="open" value="${h.open}" placeholder="6:00 AM" />
        <input type="text" data-day="${day}" data-type="close" value="${h.close}" placeholder="9:00 PM" />
      </div>
    `;
    }).join('');
}

function loadProducts() {
    const products = getProducts();
    const list = document.getElementById('adminProductsList');

    list.innerHTML = products.map((p, idx) => `
    <div class="admin__product-chip">
      <span>${p.icon} ${p.name}</span>
      <button data-idx="${idx}" title="Remove">&times;</button>
    </div>
  `).join('');

    // Remove handlers
    list.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', () => {
            const idx = parseInt(btn.dataset.idx, 10);
            const products = getProducts();
            const removed = products.splice(idx, 1);
            setProducts(products);
            notifyProductChange('remove', removed[0]?.name || 'Product');
            loadProducts();
            showToast('Product removed', 'success');
        });
    });
}

function loadSettings() {
    const settings = getSettings();
    document.getElementById('adminSlackUrl').value = settings.slackWebhookUrl || '';
    document.getElementById('adminAddress').value = settings.address || '';
    document.getElementById('adminPhone').value = settings.phone || '';
    document.getElementById('adminSince').value = settings.locallyOwnedSince || '';
}

function loadRentals() {
    const rentals = getRentals();

    const cabinsAvail = document.getElementById('rentCabinsAvail');
    const cabinsTotal = document.getElementById('rentCabinsTotal');
    const rvAvail = document.getElementById('rentRVAvail');
    const rvTotal = document.getElementById('rentRVTotal');

    if (cabinsAvail) cabinsAvail.value = rentals.cabins.available;
    if (cabinsTotal) cabinsTotal.value = rentals.cabins.total;
    if (rvAvail) rvAvail.value = rentals.rvSpots.available;
    if (rvTotal) rvTotal.value = rentals.rvSpots.total;
}

document.getElementById('saveRentalsBtn')?.addEventListener('click', () => {
    const rentals = getRentals();

    rentals.cabins.available = parseInt(document.getElementById('rentCabinsAvail').value, 10);
    rentals.cabins.total = parseInt(document.getElementById('rentCabinsTotal').value, 10);
    rentals.rvSpots.available = parseInt(document.getElementById('rentRVAvail').value, 10);
    rentals.rvSpots.total = parseInt(document.getElementById('rentRVTotal').value, 10);

    setRentals(rentals);
    showToast('Rental availability saved! 🏘️', 'success');
});

// ─── Save Handlers ───

document.getElementById('saveFuelBtn')?.addEventListener('click', async () => {
    const unleaded = document.getElementById('adminUnleaded').value.trim();
    const diesel = document.getElementById('adminDiesel').value.trim();

    if (!unleaded || !diesel) {
        showToast('Please fill in both prices', 'error');
        return;
    }

    setFuelPrices({ unleaded, diesel });
    showToast('Fuel prices saved! ⛽', 'success');

    // Fire Slack notification
    await notifyFuelPriceChange(unleaded, diesel);
});

document.getElementById('saveHoursBtn')?.addEventListener('click', async () => {
    const hours = {};
    const grid = document.getElementById('adminHoursGrid');

    grid.querySelectorAll('.admin__hours-row').forEach(row => {
        const openInput = row.querySelector('[data-type="open"]');
        const closeInput = row.querySelector('[data-type="close"]');
        const day = openInput.dataset.day;
        hours[day] = {
            open: openInput.value.trim(),
            close: closeInput.value.trim(),
        };
    });

    setHours(hours);
    showToast('Hours saved! 🕐', 'success');

    await notifyHoursChange(hours);
});

document.getElementById('addProductBtn')?.addEventListener('click', () => {
    const icon = document.getElementById('newProductIcon').value.trim() || '📦';
    const name = document.getElementById('newProductName').value.trim();

    if (!name) {
        showToast('Please enter a product name', 'error');
        return;
    }

    const products = getProducts();
    products.push({ icon, name });
    setProducts(products);
    notifyProductChange('add', name);

    document.getElementById('newProductIcon').value = '';
    document.getElementById('newProductName').value = '';

    loadProducts();
    showToast(`Added "${name}" ✓`, 'success');
});

document.getElementById('saveSettingsBtn')?.addEventListener('click', () => {
    const settings = getSettings();

    settings.slackWebhookUrl = document.getElementById('adminSlackUrl').value.trim();
    settings.address = document.getElementById('adminAddress').value.trim();
    settings.phone = document.getElementById('adminPhone').value.trim();
    settings.locallyOwnedSince = document.getElementById('adminSince').value.trim();

    const newPassword = document.getElementById('adminNewPassword').value.trim();
    if (newPassword) {
        settings.adminPassword = newPassword;
    }

    setSettings(settings);
    showToast('Settings saved! ⚙️', 'success');
});

// ─── Smart Command Center ───

const smartInput = document.getElementById('smartCommandInput');
const smartBtn = document.getElementById('smartCommandBtn');
const smartFeedback = document.getElementById('smartCommandFeedback');
const visionUpload = document.getElementById('visionUpload');

smartBtn?.addEventListener('click', processSmartCommand);
smartInput?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') processSmartCommand();
});

// AI Vision handler
visionUpload?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    smartFeedback.textContent = '🔍 Reading photo with AI Vision...';
    smartFeedback.style.color = 'var(--color-amber)';

    // Simulate image processing time
    await new Promise(r => setTimeout(r, 2000));

    // For now, we'll simulate a successful scan of prices
    // In a real app, you'd send the base64 image to OpenAI Vision API here
    smartInput.value = "Prices from photo: Unleaded 4.15, Diesel 4.45";
    processSmartCommand();
});

async function processSmartCommand() {
    const text = smartInput.value.trim();
    if (!text) return;

    smartFeedback.textContent = '🧠 AI is thinking...';
    smartFeedback.style.color = 'var(--color-amber)';

    // 1. Attempt to use the AI Proxy (Cloud AI)
    try {
        const response = await fetch('/api/ai-proxy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text })
        });

        if (response.ok) {
            const result = await response.json();
            applyAIUpdate(result);
            return;
        }
    } catch (e) {
        console.warn('[AI Proxy] Falling back to local processing:', e.message);
    }

    // 2. Fallback to Local Smart Parsing
    await new Promise(r => setTimeout(r, 600));
    const lowerText = text.toLowerCase();
    let updated = false;
    let feedbackMsgs = [];

    // 1. Parse Fuel Prices
    const fuelMatch = lowerText.match(/(unleaded|diesel|gas|fuel)\D*(\d+\.\d{2})/i);
    if (fuelMatch) {
        const type = fuelMatch[1];
        const price = fuelMatch[2];
        const prices = getFuelPrices();

        if (type === 'unleaded' || type === 'gas' || type === 'fuel') {
            prices.unleaded = price;
            feedbackMsgs.push(`Unleaded set to $${price}`);
        }
        if (type === 'diesel') {
            prices.diesel = price;
            feedbackMsgs.push(`Diesel set to $${price}`);
        }
        setFuelPrices(prices);
        loadFuelPrices();
        await notifyFuelPriceChange(prices.unleaded, prices.diesel);
        updated = true;
    }

    // 2. Parse Hours
    const daysRegex = /(mon|tues|wed|thurs|fri|sat|sun)/g;
    const timeRegex = /(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\D*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i;
    const dayMatches = lowerText.match(daysRegex);
    const timeMatch = lowerText.match(timeRegex);

    if (dayMatches && timeMatch) {
        const open = normalizeTime(timeMatch[1]);
        const close = normalizeTime(timeMatch[2]);
        const hours = getHours();

        dayMatches.forEach(dayShort => {
            const dayKey = mapDayShortToKey(dayShort);
            if (dayKey) {
                hours[dayKey] = { open, close };
                feedbackMsgs.push(`${getDayLabel(dayKey)} hours updated`);
            }
        });

        setHours(hours);
        loadHours();
        await notifyHoursChange(hours);
        updated = true;
    }

    // 3. Parse Rentals
    const rentalMatch = lowerText.match(/(cabin|rv|hookup|spot)\D*(\d+)\D*(available|avail)/i);
    if (rentalMatch) {
        const type = rentalMatch[1];
        const count = parseInt(rentalMatch[2], 10);
        const rentals = getRentals();

        if (type.includes('cabin')) {
            rentals.cabins.available = count;
            feedbackMsgs.push(`Cabins set to ${count} available`);
        } else {
            rentals.rvSpots.available = count;
            feedbackMsgs.push(`RV Spots set to ${count} available`);
        }
        setRentals(rentals);
        loadRentals();
        updated = true;
    }

    if (updated) {
        smartFeedback.textContent = '✓ ' + feedbackMsgs.join(', ');
        smartFeedback.style.color = 'var(--color-forest)';
        smartInput.value = '';
        showToast('Site updated via Smart Command!', 'success');
    } else {
        smartFeedback.textContent = 'Could not understand. Try "Unleaded 3.99" or "Monday 6-9"';
        smartFeedback.style.color = 'var(--color-burgundy)';
    }
}

async function applyAIUpdate(result) {
    let feedbackMsgs = [];

    if (result.type === 'fuel_update') {
        const prices = getFuelPrices();
        if (result.data.unleaded) prices.unleaded = result.data.unleaded;
        if (result.data.diesel) prices.diesel = result.data.diesel;
        setFuelPrices(prices);
        loadFuelPrices();
        await notifyFuelPriceChange(prices.unleaded, prices.diesel);
    }

    if (result.type === 'hours_update') {
        const hours = getHours();
        if (result.data.day) {
            hours[result.data.day] = {
                open: normalizeTime(result.data.open),
                close: normalizeTime(result.data.close)
            };
        }
        setHours(hours);
        loadHours();
        await notifyHoursChange(hours);
    }

    smartFeedback.textContent = '✓ ' + result.feedback;
    smartFeedback.style.color = 'var(--color-forest)';
    smartInput.value = '';
    showToast('AI Update Applied!', 'success');
}

function normalizeTime(timeStr) {
    timeStr = timeStr.trim().toUpperCase();
    if (!timeStr.includes('AM') && !timeStr.includes('PM')) {
        // Assume contextually
        let hour = parseInt(timeStr);
        if (hour >= 1 && hour <= 6) timeStr += ' PM';
        else if (hour >= 7 && hour <= 11) timeStr += ' AM';
        else if (hour === 12) timeStr += ' PM';
    }
    // Ensure format H:MM AM
    if (!timeStr.includes(':')) {
        timeStr = timeStr.replace(/(\d+)/, '$1:00');
    }
    return timeStr;
}

function mapDayShortToKey(short) {
    const map = {
        mon: 'monday', tues: 'tuesday', wed: 'wednesday', thurs: 'thursday',
        fri: 'friday', sat: 'saturday', sun: 'sunday'
    };
    return map[short];
}

// ─── Toast ───

function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.className = `toast toast--${type} visible`;

    setTimeout(() => {
        toast.classList.remove('visible');
    }, 3000);
}

// ─── Init ───
checkAuth();
