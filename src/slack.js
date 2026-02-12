/* ═══════════════════════════════════════
   SLACK INTEGRATION
   Send notifications to a Slack channel
   via Incoming Webhook
   ═══════════════════════════════════════ */

import { getSettings } from './data.js';

/**
 * Send a formatted notification to Slack
 * @param {string} message - The message text
 * @param {string} type - 'fuel' | 'hours' | 'product' | 'general'
 */
export async function sendSlackNotification(message, type = 'general') {
    const settings = getSettings();
    const webhookUrl = settings.slackWebhookUrl;

    if (!webhookUrl) {
        console.log('[Slack] No webhook URL configured. Skipping notification.');
        return { success: false, reason: 'no_webhook' };
    }

    const emoji = {
        fuel: '⛽',
        hours: '🕐',
        product: '📦',
        general: '📢',
    }[type] || '📢';

    const payload = {
        text: `${emoji} *Midway Gas & Grocery*\n${message}`,
        unfurl_links: false,
    };

    try {
        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });

        if (response.ok) {
            console.log('[Slack] Notification sent successfully.');
            return { success: true };
        } else {
            console.error('[Slack] Failed to send:', response.status);
            return { success: false, reason: 'http_error', status: response.status };
        }
    } catch (error) {
        console.error('[Slack] Error sending notification:', error);
        return { success: false, reason: 'network_error', error };
    }
}

/**
 * Notify about fuel price changes
 */
export function notifyFuelPriceChange(unleaded, diesel) {
    const message = `Fuel prices updated:\n• Unleaded: *$${unleaded}*/gal\n• Diesel: *$${diesel}*/gal\n_Updated at ${new Date().toLocaleString()}_`;
    return sendSlackNotification(message, 'fuel');
}

/**
 * Notify about hours changes
 */
export function notifyHoursChange(hours) {
    const lines = Object.entries(hours)
        .map(([day, times]) => `• ${day.charAt(0).toUpperCase() + day.slice(1)}: ${times.open} – ${times.close}`)
        .join('\n');
    const message = `Store hours updated:\n${lines}\n_Updated at ${new Date().toLocaleString()}_`;
    return sendSlackNotification(message, 'hours');
}

/**
 * Notify about product changes
 */
export function notifyProductChange(action, productName) {
    const verb = action === 'add' ? 'added' : action === 'remove' ? 'removed' : 'updated';
    const message = `Product ${verb}: *${productName}*\n_Updated at ${new Date().toLocaleString()}_`;
    return sendSlackNotification(message, 'product');
}
