const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, '..', 'logs.txt');
function logToFile(text) {
    const timestamp = new Date().toLocaleTimeString();
    try {
        fs.appendFileSync(LOG_FILE, `\n[${timestamp}] [SERVER] \n${text}\n--------------------------------------------------\n`);
    } catch (e) { }
}
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
const EXTRACTION_MODELS = [
    'deepseek/deepseek-r1-0528:free' // Highly capable reasoning model for parsing huge contexts
];

const SOLVER_MODELS = [
    'arcee-ai/trinity-large-preview:free', // Top accuracy, fastest time
    'arcee-ai/trinity-mini:free',
    'nvidia/nemotron-3-nano-30b-a3b:free',
    'nvidia/nemotron-nano-9b-v2:free',
    'stepfun/step-3.5-flash:free',
    'z-ai/glm-4.5-air:free',
    'liquid/lfm-2.5-1.2b-thinking:free' // Smaller thinking model
];

// NO ROTATION: Immediately use the fastest model directly
async function askAiWithRetry(messages, customTemperature = 0) {
    if (!API_KEY) {
        console.error("❌ ERROR: OPENROUTER_API_KEY is missing in .env file.");
        return null;
    }

    const targetModel = SOLVER_MODELS[0] || 'arcee-ai/trinity-mini:free';

    console.log(`\n⚡ SOLVER ACTION: Instantly executing with fastest model: ${targetModel}\n`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // Fast fail if it hangs 15s

    try {
        console.log(`📡 Sending request to AI (${targetModel})...`);
        const startTime = Date.now();

        const requestBody = {
            model: targetModel,
            messages: messages,
            temperature: customTemperature
        };

        logToFile(`--- SOLVER (${targetModel}) PAYLOAD ---\n${JSON.stringify(requestBody, null, 2)}`);

        const response = await fetch(OPENROUTER_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${API_KEY}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'http://localhost:3000',
                'X-Title': 'Moodle-Quiz-Solver'
            },
            body: JSON.stringify(requestBody),
            signal: controller.signal
        });

        clearTimeout(timeoutId);
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);

        if (response.ok) {
            console.log(`⏱️ Success! Model ${targetModel} took ${duration} seconds.`);
            const json = await response.json();
            logToFile(`--- SOLVER (${targetModel}) RAW JSON RESPONSE ---\n${JSON.stringify(json, null, 2)}`);
            return json.choices?.[0]?.message?.content || null;
        }

        const errorText = await response.text();
        console.warn(`⚠️ Model ${targetModel} instantly failed (${response.status}): ${errorText}`);
        return null;

    } catch (error) {
        clearTimeout(timeoutId);
        console.error(`❌ Network error with ${targetModel}: ${error.message}`);
        return null;
    }
}

/**
 * Sends a request to a specific AI model without retries/rotation.
 * Uses exact specified model.
 */
async function askSpecificAi(model, messages, customTemperature = 0.1) {
    if (!API_KEY) {
        console.error("❌ ERROR: OPENROUTER_API_KEY is missing in .env file.");
        return null;
    }

    try {
        console.log(`📡 Sending targeted request to AI (${model})...`);
        const startTime = Date.now();

        const requestBody = {
            model: model,
            messages: messages,
            temperature: customTemperature
        };

        logToFile(`--- EXTRACTOR (${model}) PAYLOAD ---\n${JSON.stringify(requestBody, null, 2).substring(0, 1500)}... [TRUNCATED]`);

        const response = await fetch(OPENROUTER_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${API_KEY}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'http://localhost:3000',
                'X-Title': 'Moodle-Quiz-Agent-Extractor'
            },
            body: JSON.stringify(requestBody)
        });

        const duration = ((Date.now() - startTime) / 1000).toFixed(2);

        if (response.ok) {
            console.log(`⏱️ Success! Extractor ${model} took ${duration} s.`);
            const json = await response.json();
            logToFile(`--- EXTRACTOR (${model}) RAW JSON RESPONSE ---\n${JSON.stringify(json, null, 2)}`);
            return json.choices?.[0]?.message?.content || null;
        }

        const errorText = await response.text();
        console.warn(`⚠️ Extractor ${model} failed (${response.status}): ${errorText}`);

        // Primitive fallback if the main extractor fails
        if (model === EXTRACTION_MODELS[0] && EXTRACTION_MODELS.length > 1) {
            console.log(`🔄 Trying backup extractor...`);
            return await askSpecificAi(EXTRACTION_MODELS[1], messages, customTemperature);
        }

        return null;

    } catch (error) {
        console.error(`❌ Network error with Extractor ${model}: ${error.message}`);
        return null;
    }
}

module.exports = {
    askAiWithRetry,
    askSpecificAi,
    extractJson,
    EXTRACTION_MODELS
};
