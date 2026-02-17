const fetch = require('node-fetch');
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL_SOLVER = process.env.MODEL_SOLVER || 'deepseek/deepseek-r1-0528:free';

/**
 * Extracts valid JSON from an AI response text that might contain markdown or 'thinking' tags.
 */
function extractJson(aiText) {
    if (!aiText) return null;

    // 1. Remove <think> tags
    let cleanText = aiText.replace(/<think>[\s\S]*?<\/think>/gi, '');

    // 2. Remove Markdown code blocks
    cleanText = cleanText.replace(/```json/gi, '').replace(/```/g, '');

    // 3. Find first '{' and last '}'
    const firstBrace = cleanText.indexOf('{');
    const lastBrace = cleanText.lastIndexOf('}');

    if (firstBrace !== -1 && lastBrace !== -1) {
        return cleanText.substring(firstBrace, lastBrace + 1).trim();
    }
    return null;
}

/**
 * Sends a request to the AI API with exponential backoff for retries.
 * 
 * @param {Array} messages - Chat messages [{role, content}]
 * @param {number} [retries=3] - Number of retries on 429/5xx errors
 * @returns {Promise<string|null>} The raw AI content string or null on failure
 */
async function askAiWithRetry(messages, retries = 3) {
    if (!API_KEY) {
        console.error("❌ ERROR: OPENROUTER_API_KEY is missing in .env file.");
        return null;
    }

    let lastError;

    for (let i = 0; i < retries; i++) {
        try {
            console.log(`📡 Sending request to AI (${MODEL_SOLVER}) - Attempt ${i + 1}/${retries}...`);

            const response = await fetch(OPENROUTER_URL, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${API_KEY}`,
                    'Content-Type': 'application/json',
                    'HTTP-Referer': 'http://localhost:3000',
                    'X-Title': 'Moodle-Quiz-Agent'
                },
                body: JSON.stringify({
                    model: MODEL_SOLVER,
                    messages: messages,
                    temperature: 0.1
                })
            });

            if (response.ok) {
                const json = await response.json();
                const content = json.choices?.[0]?.message?.content;

                if (!content) {
                    console.warn("⚠️ API returned empty content.");
                    // Treat empty content as a retryable error if we have attempts left? 
                    // Usually it's a model failure. Let's try once more if it's really empty.
                    throw new Error("Empty content received from AI");
                }
                return content;
            }

            // Handle errors
            const errorText = await response.text();
            if (response.status === 429 || response.status >= 500) {
                // Formatting backoff
                const backoff = 1000 * Math.pow(2, i);
                console.warn(`⚠️ API Error ${response.status}: ${errorText}. Retrying in ${backoff}ms...`);
                await new Promise(r => setTimeout(r, backoff));
                continue;
            } else {
                // Client error (400, 401, etc) - Do not retry
                console.error(`❌ Fatal API Error ${response.status}: ${errorText}`);
                return null;
            }

        } catch (error) {
            lastError = error;
            const backoff = 1000 * Math.pow(2, i);
            console.error(`❌ Network Error on attempt ${i + 1}: ${error.message}. Retrying in ${backoff}ms...`);
            await new Promise(r => setTimeout(r, backoff));
        }
    }

    console.error("❌ Failed to get AI response after multiple retries.");
    if (lastError) console.error(lastError);
    return null;
}

module.exports = {
    askAiWithRetry,
    extractJson
};
