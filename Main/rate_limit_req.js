const fetch = require('node-fetch');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const API_KEY = process.env.OPENROUTER_API_KEY;

if (!API_KEY) {
    console.error("❌ ERROR: OPENROUTER_API_KEY is missing in .env file.");
    process.exit(1);
}

async function checkRateLimit() {
    console.log("🔍 Checking OpenRouter API Key Status...\n");

    try {
        const response = await fetch("https://openrouter.ai/api/v1/auth/key", {
            method: 'GET',
            headers: {
                "Authorization": `Bearer ${API_KEY}`
            }
        });

        if (!response.ok) {
            const err = await response.text();
            console.error(`❌ Request Failed (Status ${response.status}): ${err}`);
            return;
        }

        const json = await response.json();
        const data = json.data;

        if (!data) {
            console.error("❌ Unexpected response structure:", json);
            return;
        }

        console.log(`✅ Key Status Retrieved`);
        console.log(`----------------------------------------`);
        console.log(`🏷️  Label:        ${data.label || 'N/A'}`);
        console.log(`💰 Usage:        $${(data.usage || 0).toFixed(4)}`);
        console.log(`🚧 Limit:        ${data.limit === null ? 'No Limit Set (Unlimited/Balance)' : '$' + data.limit}`);
        console.log(`🆓 Free Tier:    ${data.is_free_tier ? 'Yes 🛑 (Subject to heavy rate limits)' : 'No 🟢 (Paid Account)'}`);

        if (data.rate_limit) {
            console.log(`\n⏱️  Rate Limit Details:`);
            console.log(`   Requests:    ${data.rate_limit.requests}`);
            console.log(`   Interval:    ${data.rate_limit.interval}`);
        } else {
            console.log(`\n⏱️  Rate Limit Details: Not specified (Depends on exact model)`);
        }
        console.log(`----------------------------------------\n`);

    } catch (error) {
        console.error("❌ Network Error:", error.message);
    }
}

checkRateLimit();
