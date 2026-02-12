import pkg from '@slack/bolt';
const { App } = pkg;
import 'dotenv/config';
import OpenAI from 'openai';
import axios from 'axios';
import { createClient } from '@supabase/supabase-js';
import {
    addSquareProduct,
    deleteSquareProduct,
    getSquareProducts,
    syncSquareToSupabase,
    updateSquareInventory,
    getInventoryCounts
} from './src/square-handler.js';

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

// Initialize Supabase Admin (Service Role)
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabase = (supabaseUrl && supabaseKey)
    ? createClient(supabaseUrl, supabaseKey)
    : {
        from: () => ({
            select: () => ({ single: () => Promise.resolve({ data: null, error: null }), eq: () => ({ single: () => Promise.resolve({ data: null, error: null }) }), then: () => Promise.resolve({ data: [], error: null }) }),
            upsert: () => ({ then: () => Promise.resolve({ error: null }) })
        })
    };

const app = new App({
    token: process.env.SLACK_BOT_TOKEN,
    signingSecret: process.env.SLACK_SIGNING_SECRET,
});

// AI System Prompt to handle Midway Plain updates
const SYSTEM_PROMPT = `
You are the AI Assistant for Midway Gas & Grocery (midwayplain.com).
Your job is to parse messages from Slack and extract structured data for fuel prices and hours.

FORMAT FOR OUTPUT (JSON ONLY):
{
  "type": "fuel_update" | "hours_update" | "inventory_query" | "inventory_update" | "product_add" | "product_remove" | "product_query" | "stock_update" | "general_message",
  "data": {
    "unleaded": "price or gallons",
    "diesel": "price or gallons",
    "product_name": "string",
    "price": "number",
    "quantity": "number",
    "day": "monday" | "tuesday" | "etc", 
    "open": "time",
    "close": "time"
  },
  "feedback": "Friendly confirmation message"
}

If the user snaps a photo, use your vision capabilities to extract the text first.
`;

// Listener for Slack Messages
app.message(async ({ message, say, client }) => {
    try {
        const text = message.text;

        // Check if there are images
        let imageUrl = null;
        if (message.files && message.files.length > 0) {
            const file = message.files[0];
            if (file.mimetype.startsWith('image/')) {
                imageUrl = file.url_private;
            }
        }

        console.log(`[AI Proxy] Received message: "${text}" from user: ${message.user}`);

        // Call OpenAI to process the intent
        const response = await openai.chat.completions.create({
            model: imageUrl ? "gpt-4-vision-preview" : "gpt-4-turbo-preview",
            messages: [
                { role: "system", content: SYSTEM_PROMPT },
                {
                    role: "user",
                    content: imageUrl
                        ? [
                            { type: "text", text: text || "Please parse these prices/hours from the photo." },
                            { type: "image_url", image_url: { url: imageUrl, detail: "high" } }
                        ]
                        : text
                }
            ],
            response_format: { type: "json_object" }
        });

        const aiResult = JSON.parse(response.choices[0].message.content);

        // ─── PERSIST TO SUPABASE ───
        if (aiResult.type === 'fuel_update') {
            if (aiResult.data.unleaded) {
                await supabase.from('fuel_prices').upsert({ type: 'unleaded', price: aiResult.data.unleaded }, { onConflict: 'type' });
            }
            if (aiResult.data.diesel) {
                await supabase.from('fuel_prices').upsert({ type: 'diesel', price: aiResult.data.diesel }, { onConflict: 'type' });
            }
        }

        if (aiResult.type === 'hours_update' && aiResult.data.day) {
            const dayKey = aiResult.data.day.toLowerCase();
            await supabase.from('store_hours').upsert({
                day: dayKey,
                open_time: aiResult.data.open,
                close_time: aiResult.data.close
            }, { onConflict: 'day' });
        }

        if (aiResult.type === 'inventory_update') {
            if (aiResult.data.unleaded) {
                await supabase.from('fuel_inventory').upsert({ type: 'unleaded', current_gallons: parseInt(aiResult.data.unleaded) }, { onConflict: 'type' });
            }
            if (aiResult.data.diesel) {
                await supabase.from('fuel_inventory').upsert({ type: 'diesel', current_gallons: parseInt(aiResult.data.diesel) }, { onConflict: 'type' });
            }
        }

        if (aiResult.type === 'inventory_query') {
            const { data: inv } = await supabase.from('fuel_inventory').select('*');
            const unleaded = inv?.find(i => i.type === 'unleaded')?.current_gallons || 0;
            const diesel = inv?.find(i => i.type === 'diesel')?.current_gallons || 0;
            aiResult.feedback = `⛽ *Current Inventory:*\n• Unleaded: ${unleaded} gal\n• Diesel: ${diesel} gal`;
        }

        // ─── SQUARE PRODUCT MANAGEMENT ───
        if (aiResult.type === 'product_add') {
            await addSquareProduct(aiResult.data.product_name, aiResult.data.price);
            await syncSquareToSupabase();
            aiResult.feedback = `✅ Added *${aiResult.data.product_name}* ($${aiResult.data.price}) to your Square Store.`;
        }

        if (aiResult.type === 'product_remove') {
            const products = await getSquareProducts();
            const target = products.find(p => p.name.toLowerCase() === aiResult.data.product_name.toLowerCase());
            if (target) {
                await deleteSquareProduct(target.id);
                await syncSquareToSupabase();
                aiResult.feedback = `🗑️ Removed *${aiResult.data.product_name}* from Square and your site.`;
            } else {
                aiResult.feedback = `❌ Could not find product *${aiResult.data.product_name}* in your inventory.`;
            }
        }

        if (aiResult.type === 'product_query') {
            await syncSquareToSupabase();
            const products = await getSquareProducts();
            const list = products.slice(0, 10).map(p => `• ${p.name} ($${(Number(p.price) / 100).toFixed(2)})`).join('\n');
            aiResult.feedback = `🛒 *Store Catalog (Top 10):*\n${list || '_No products found in Square._'}`;
        }

        if (aiResult.type === 'stock_update') {
            // Need to find the item and its variation first
            const products = await getSquareProducts();
            // Note: getSquareProducts returns a simplified list. 
            // For stock, we need the Square Variation ID.
            // I'll update getSquareProducts to include the variationId.
            const target = products.find(p => p.name.toLowerCase() === aiResult.data.product_name.toLowerCase());
            if (target && target.variationId) {
                await updateSquareInventory(target.variationId, aiResult.data.quantity);
                aiResult.feedback = `📦 Updated *${target.name}* stock to *${aiResult.data.quantity}* items.`;
            } else {
                aiResult.feedback = `❌ Could not find *${aiResult.data.product_name}* to update stock.`;
            }
        }

        await say(`${aiResult.feedback}\n\n🤖 *AI Proxy:* Cloud Database updated. Status: OK.`);

    } catch (error) {
        console.error('[AI Proxy Error]', error);
        await say("❌ Sorry, I had trouble parsing that update. Please be more specific (e.g. 'Unleaded is 3.99').");
    }
});

// ─── MONITORING LOOPS ───

const STOCK_THRESHOLD = 5; // Default threshold for low stock alerts
const CHECK_INTERVAL = 30 * 60 * 1000; // Check every 30 minutes

/**
 * Periodically checks Square inventory for low stock items
 */
async function checkLowStock() {
    try {
        console.log('[Monitor] Checking Square inventory for low stock...');
        const products = await getSquareProducts();
        const variationIds = products.map(p => p.variationId).filter(id => id);

        if (variationIds.length === 0) return;

        const counts = await getInventoryCounts(variationIds);
        const lowStockItems = [];

        products.forEach(p => {
            const countObj = counts.find(c => c.catalogObjectId === p.variationId);
            const quantity = countObj ? parseInt(countObj.quantity) : 0;

            if (quantity <= STOCK_THRESHOLD) {
                lowStockItems.push({ name: p.name, quantity });
            }
        });

        if (lowStockItems.length > 0) {
            const list = lowStockItems.map(item => `• *${item.name}*: ${item.quantity} left`).join('\n');
            const alertMsg = `⚠️ *Low Stock Alert* ⚠️\nThe following items are running low in the Midway Market:\n${list}\n\n_Would you like me to prepare an order proposal?_`;

            // Post to the general channel (requires SLACK_GENERAL_CHANNEL_ID in .env)
            if (process.env.SLACK_GENERAL_CHANNEL_ID) {
                await app.client.chat.postMessage({
                    channel: process.env.SLACK_GENERAL_CHANNEL_ID,
                    text: alertMsg
                });
            } else {
                console.warn('[Monitor] Low stock detected but SLACK_GENERAL_CHANNEL_ID is not set.');
            }
        }
    } catch (error) {
        console.error('[Monitor Error]', error);
    }
}

(async () => {
    await app.start(process.env.PORT || 3001);
    console.log('⚡️ Midway AI Proxy is running on port ' + (process.env.PORT || 3001));

    // Kick off the monitoring loop
    checkLowStock();
    setInterval(checkLowStock, CHECK_INTERVAL);
})();
