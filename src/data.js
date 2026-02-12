import { supabase } from './supabase.js';

const STORAGE_KEYS = {
    FUEL: 'midway_fuel_prices',
    HOURS: 'midway_hours',
    PRODUCTS: 'midway_products',
    SETTINGS: 'midway_settings',
    AI_NOTES: 'midway_ai_notes',
    FUEL_INV: 'midway_fuel_inventory',
    RENTALS: 'midway_rentals',
};

// Check if cloud sync is active (and not just placeholder strings)
const env = import.meta.env;
const isCloudSyncActive = !!(
    env.VITE_SUPABASE_URL &&
    env.VITE_SUPABASE_ANON_KEY &&
    !env.VITE_SUPABASE_URL.includes('your_') &&
    !env.VITE_SUPABASE_ANON_KEY.includes('your_')
);

// ─── Default Data ───

const DEFAULT_FUEL = {
    unleaded: '3.89',
    diesel: '4.29',
    updatedAt: new Date().toISOString(),
};

const DEFAULT_HOURS = {
    monday: { open: '6:00 AM', close: '9:00 PM' },
    tuesday: { open: '6:00 AM', close: '9:00 PM' },
    wednesday: { open: '6:00 AM', close: '9:00 PM' },
    thursday: { open: '6:00 AM', close: '9:00 PM' },
    friday: { open: '6:00 AM', close: '10:00 PM' },
    saturday: { open: '7:00 AM', close: '10:00 PM' },
    sunday: { open: '7:00 AM', close: '8:00 PM' },
};

const DEFAULT_PRODUCTS = [
    { icon: '⛽', name: 'Fuel' },
    { icon: '☕', name: 'Espresso' },
    { icon: '🍦', name: 'Ice Cream' },
    { icon: '🥤', name: 'Cold Drinks' },
    { icon: '🍿', name: 'Snacks' },
    { icon: '🍷', name: 'Wine & Beer' },
    { icon: '🛒', name: 'Groceries' },
    { icon: '🏕️', name: 'Camping' },
];

const DEFAULT_SETTINGS = {
    slackWebhookUrl: '',
    address: '14193 US-2, Leavenworth, WA 98826',
    phone: '(509) 669-9378',
    locallyOwnedSince: '',
    adminPassword: 'midway2025',
};

const DEFAULT_RENTALS = {
    cabins: { total: 2, available: 2, photo: '/images/exterior-wide.jpg' },
    rvSpots: { total: 4, available: 4, photo: '/images/exterior-detailed.jpg' },
};

// ─── Cloud Sync ───

/**
 * Bootstraps the app with cloud data if available.
 * This ensures the rest of the app can remain synchronous.
 */
export async function syncCloudData() {
    if (!isCloudSyncActive) return;

    try {
        console.log('[Data] Syncing with Supabase...');

        // 1. Sync Fuel
        const { data: fuel, error: fuelError } = await supabase.from('fuel_prices').select('*');
        if (!fuelError && fuel.length > 0) {
            const prices = {};
            fuel.forEach(f => prices[f.type] = f.price.toString());
            setFuelPrices(prices, false); // false to avoid loop
        }

        // 2. Sync Hours
        const { data: hours, error: hoursError } = await supabase.from('store_hours').select('*');
        if (!hoursError && hours.length > 0) {
            const hObj = {};
            hours.forEach(h => hObj[h.day] = { open: h.open_time, close: h.close_time });
            setHours(hObj, false);
        }

        // 3. Sync AI Notes
        const { data: notes, error: notesError } = await supabase.from('store_intelligence').select('*').eq('key', 'ai_notes').single();
        if (!notesError && notes) {
            setAINotes(notes.content, false);
        }

        // 4. Sync Fuel Inventory
        const { data: fuelInv, error: fuelInvError } = await supabase.from('fuel_inventory').select('*');
        if (!fuelInvError && fuelInv.length > 0) {
            const invObj = { unleaded: 0, diesel: 0 };
            fuelInv.forEach(i => invObj[i.type] = i.current_gallons);
            setFuelInventory(invObj, false);
        }

        // 5. Sync Rentals
        const { data: rentals, error: rentalsError } = await supabase.from('rentals').select('*');
        if (!rentalsError && rentals.length > 0) {
            const rObj = {};
            rentals.forEach(r => rObj[r.type] = { total: r.total, available: r.available, photo: r.photo_url });
            setRentals(rObj, false);
        }

        // 6. Sync Square Store
        const { data: store, error: storeError } = await supabase.from('store_inventory').select('*');
        if (!storeError && store) {
            window.midway_live_store = store; // Make available for main.js rendering
        }

        console.log('[Data] Cloud sync complete.');
    } catch (err) {
        console.error('[Data] Cloud sync failed:', err);
    }
}

// ─── Getters ───

export function getFuelPrices() {
    try {
        const data = localStorage.getItem(STORAGE_KEYS.FUEL);
        return data ? JSON.parse(data) : { ...DEFAULT_FUEL };
    } catch {
        return { ...DEFAULT_FUEL };
    }
}

export function getHours() {
    try {
        const data = localStorage.getItem(STORAGE_KEYS.HOURS);
        return data ? JSON.parse(data) : { ...DEFAULT_HOURS };
    } catch {
        return { ...DEFAULT_HOURS };
    }
}

export function getProducts() {
    try {
        const data = localStorage.getItem(STORAGE_KEYS.PRODUCTS);
        return data ? JSON.parse(data) : [...DEFAULT_PRODUCTS];
    } catch {
        return [...DEFAULT_PRODUCTS];
    }
}

export function getSettings() {
    try {
        const data = localStorage.getItem(STORAGE_KEYS.SETTINGS);
        return data ? { ...DEFAULT_SETTINGS, ...JSON.parse(data) } : { ...DEFAULT_SETTINGS };
    } catch {
        return { ...DEFAULT_SETTINGS };
    }
}

export function getRentals() {
    try {
        const data = localStorage.getItem(STORAGE_KEYS.RENTALS);
        return data ? JSON.parse(data) : { ...DEFAULT_RENTALS };
    } catch {
        return { ...DEFAULT_RENTALS };
    }
}

// ─── Setters ───

export function setFuelPrices(prices, syncToCloud = true) {
    const data = {
        ...prices,
        updatedAt: new Date().toISOString(),
    };
    localStorage.setItem(STORAGE_KEYS.FUEL, JSON.stringify(data));

    if (syncToCloud && isCloudSyncActive) {
        Object.entries(prices).forEach(([type, price]) => {
            if (type === 'unleaded' || type === 'diesel') {
                supabase.from('fuel_prices').upsert({ type, price, updated_at: new Date() }, { onConflict: 'type' }).then();
            }
        });
    }
    return data;
}

export function setHours(hours, syncToCloud = true) {
    localStorage.setItem(STORAGE_KEYS.HOURS, JSON.stringify(hours));

    if (syncToCloud && isCloudSyncActive) {
        Object.entries(hours).forEach(([day, times]) => {
            supabase.from('store_hours').upsert({
                day,
                open_time: times.open,
                close_time: times.close,
                updated_at: new Date()
            }, { onConflict: 'day' }).then();
        });
    }
    return hours;
}

export function setProducts(products) {
    localStorage.setItem(STORAGE_KEYS.PRODUCTS, JSON.stringify(products));
    return products;
}

export function setSettings(settings) {
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
    return settings;
}

export function getAINotes() {
    return localStorage.getItem(STORAGE_KEYS.AI_NOTES) || '';
}

export function setAINotes(notes, syncToCloud = true) {
    localStorage.setItem(STORAGE_KEYS.AI_NOTES, notes);

    if (syncToCloud && isCloudSyncActive) {
        supabase.from('store_intelligence').upsert({
            key: 'ai_notes',
            content: notes,
            updated_at: new Date()
        }, { onConflict: 'key' }).then();
    }
    return notes;
}

export function getFuelInventory() {
    try {
        const data = localStorage.getItem(STORAGE_KEYS.FUEL_INV);
        return data ? JSON.parse(data) : { unleaded: 3000, diesel: 2000, threshold: 1000 };
    } catch {
        return { unleaded: 3000, diesel: 2000, threshold: 1000 };
    }
}

export function setFuelInventory(inv, syncToCloud = true) {
    localStorage.setItem(STORAGE_KEYS.FUEL_INV, JSON.stringify(inv));

    if (syncToCloud && isCloudSyncActive) {
        if (inv.unleaded !== undefined) {
            supabase.from('fuel_inventory').upsert({ type: 'unleaded', current_gallons: inv.unleaded, updated_at: new Date() }, { onConflict: 'type' }).then();
        }
        if (inv.diesel !== undefined) {
            supabase.from('fuel_inventory').upsert({ type: 'diesel', current_gallons: inv.diesel, updated_at: new Date() }, { onConflict: 'type' }).then();
        }
    }
    return inv;
}

export function setRentals(rentals, syncToCloud = true) {
    localStorage.setItem(STORAGE_KEYS.RENTALS, JSON.stringify(rentals));

    if (syncToCloud && isCloudSyncActive) {
        Object.entries(rentals).forEach(([type, r]) => {
            supabase.from('rentals').upsert({
                type,
                total: r.total,
                available: r.available,
                photo_url: r.photo,
                updated_at: new Date()
            }, { onConflict: 'type' }).then();
        });
    }
    return rentals;
}

// ─── Helpers ───

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function getTodayKey() {
    return DAY_NAMES[new Date().getDay()];
}

export function getDayLabel(key) {
    const idx = DAY_NAMES.indexOf(key);
    return idx >= 0 ? DAY_LABELS[idx] : key;
}

export function getDayOrder() {
    // Return days starting from Monday
    return ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
}

export function isOpenNow() {
    const hours = getHours();
    const today = getTodayKey();
    const todayHours = hours[today];

    if (!todayHours || !todayHours.open || !todayHours.close) return false;

    const now = new Date();
    const openTime = parseTime(todayHours.open);
    const closeTime = parseTime(todayHours.close);

    if (!openTime || !closeTime) return false;

    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    return nowMinutes >= openTime && nowMinutes <= closeTime;
}

function parseTime(timeStr) {
    const match = timeStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (!match) return null;

    let hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    const period = match[3].toUpperCase();

    if (period === 'PM' && hours !== 12) hours += 12;
    if (period === 'AM' && hours === 12) hours = 0;

    return hours * 60 + minutes;
}

export function formatUpdatedTime(isoString) {
    if (!isoString) return 'Not yet updated';
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} min ago`;

    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;

    return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    });
}
