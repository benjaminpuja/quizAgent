const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const LABELS_FILE = path.join(__dirname, 'Models.txt');
const RESULTS_CSV = path.join(__dirname, 'model_benchmark_results.csv');
const LOG_FILE = path.join(__dirname, 'logs.txt');

function logToFile(text) {
    const timestamp = new Date().toLocaleTimeString();
    try {
        fs.appendFileSync(LOG_FILE, `\n[${timestamp}] [BENCHMARK] \n${text}\n--------------------------------------------------\n`);
    } catch (e) {
        console.error("Failed to write to logs.txt:", e);
    }
}

// Test Configuration with More Complex Questions
const QUESTIONS = [
    {
        id: 1,
        text: `Solve this logic puzzle. Return ONLY a JSON object with the correct answer index (0-based) in a "answer" property.
Question: "If A is faster than B, and B is faster than C, which one is the slowest?"
Options:
0. A
1. B
2. C
3. Nobody`,
        correctIndex: 2
    },
    {
        id: 2,
        text: `Solve this math problem. Return ONLY a JSON object with the correct answer index (0-based) in a "answer" property.
Question: "What is 15 * 12 + 8?"
Options:
0. 180
1. 188
2. 178
3. 200`,
        correctIndex: 1
    },
    {
        id: 3,
        text: `Solve this riddle. Return ONLY a JSON object with the correct answer index (0-based) in a "answer" property.
Question: "I speak without a mouth and hear without ears. I have no body, but I come alive with wind. What am I?"
Options:
0. An Echo
1. A Shadow
2. A Cloud
3. A Ghost`,
        correctIndex: 0
    },
    {
        id: 4,
        text: `Solve this tricky scenario. Return ONLY a JSON object with the correct answer index (0-based) in a "answer" property.
Question: "A bat and a ball cost $1.10 in total. The bat costs $1.00 more than the ball. How much does the ball cost?"
Options:
0. $0.10
1. $0.05
2. $1.00
3. $0.15`,
        correctIndex: 1
    }
];

const EXTRACT_FILE = path.join(__dirname, 'Extraction_Models.txt');

// 1. Load Models from both source files
function loadModels() {
    try {
        let allModels = [];

        // Load Solvers (or combined list)
        if (fs.existsSync(LABELS_FILE)) {
            const data1 = fs.readFileSync(LABELS_FILE, 'utf8');
            allModels.push(...data1.split(/[\n,]+/).map(m => m.trim()).filter(m => m.length > 0 && !m.startsWith('#')));
        }

        // Load Extractors
        if (fs.existsSync(EXTRACT_FILE)) {
            const data2 = fs.readFileSync(EXTRACT_FILE, 'utf8');
            allModels.push(...data2.split(/[\n,]+/).map(m => m.trim()).filter(m => m.length > 0 && !m.startsWith('#')));
        }

        // Deduplicate
        return [...new Set(allModels)];
    } catch (e) {
        console.error("❌ Could not read models", e);
        process.exit(1);
    }
}

// 2. Delay Function
const delay = ms => new Promise(res => setTimeout(res, ms));

// 3. Test Single Model on a single question
async function testModelQuestion(model, question) {
    const startTime = Date.now();

    let timeoutId;
    try {
        const requestBody = {
            model: model,
            messages: [
                { role: 'system', content: 'You are a smart assistant. Output JSON only: {"answer": index}' },
                { role: 'user', content: question.text }
            ],
            // Setting temperature 0 for more deterministic answers
            temperature: 0
        };

        logToFile(`--- TARGET: ${model} | Q${question.id} ---\nStarting request to OpenRouter...\nPAYLOAD:\n${JSON.stringify(requestBody, null, 2)}`);

        // Timeout Promise (45s to be safe)
        const controller = new AbortController();
        timeoutId = setTimeout(() => {
            logToFile(`--- TARGET: ${model} | Q${question.id} WARNING ---\n45s Timeout Reached. Forcing abort.`);
            controller.abort();
        }, 45000);

        const response = await fetch(OPENROUTER_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${API_KEY}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'http://localhost:3000',
                'X-Title': 'Moodle-Quiz-Benchmark'
            },
            body: JSON.stringify(requestBody),
            signal: controller.signal
        });

        clearTimeout(timeoutId);
        const duration = (Date.now() - startTime) / 1000;

        if (!response.ok) {
            const err = await response.text();
            console.log(`      ❌ Failed (Q${question.id} Status ${response.status})`);
            logToFile(`--- TARGET: ${model} | Q${question.id} HTTP ERROR ---\nTook: ${duration}s\nStatus: ${response.status}\nResponse:\n${err}`);
            return { success: false, time: null, error: `Status ${response.status}` };
        }

        const json = await response.json();
        const content = json.choices?.[0]?.message?.content || "";

        logToFile(`--- TARGET: ${model} | Q${question.id} SUCCESS ---\nTook: ${duration}s\nRAW JSON RESPONSE:\n${JSON.stringify(json, null, 2)}\n\nEXTRACTED CONTENT:\n${content}`);

        // Validation
        let isCorrect = false;
        if (content.includes(`"answer": ${question.correctIndex}`) || content.includes(`: ${question.correctIndex}`)) {
            isCorrect = true;
        } else if (content.includes(question.correctIndex.toString())) {
            // Loose check
            try {
                const match = content.match(/\{[\s\S]*?\}/);
                if (match) {
                    const parsed = JSON.parse(match[0]);
                    if (parsed.answer == question.correctIndex) isCorrect = true;
                }
            } catch (e) { }
            // Extremely loose check if content is very short
            if (!isCorrect && content.length < 50 && content.match(new RegExp(`\\b${question.correctIndex}\\b`))) {
                isCorrect = true;
            }
        }

        return {
            success: true,
            isCorrect: isCorrect,
            time: duration,
            content: content
        };

    } catch (e) {
        clearTimeout(timeoutId);
        let errMsg = e.message;
        if (e.name === 'AbortError') errMsg = "Request TIMED OUT (AbortError after 45s)";
        console.log(`      💥 Error Q${question.id}: ${errMsg}`);
        logToFile(`--- TARGET: ${model} | Q${question.id} FATAL EXCEPTION ---\nError: ${errMsg}\nTook: ${(Date.now() - startTime) / 1000}s`);
        return { success: false, time: null, error: errMsg };
    }
}

// 4. Test Model over all questions
async function evaluateModel(model) {
    console.log(`\n🧪 Evaluating: ${model}...`);
    let correctCount = 0;
    let totalTime = 0;
    let successCount = 0;
    const errors = [];

    for (const q of QUESTIONS) {
        const result = await testModelQuestion(model, q);
        if (result.success) {
            successCount++;
            totalTime += result.time;
            if (result.isCorrect) correctCount++;
            console.log(`   - Q${q.id}: ${result.isCorrect ? '✅ Right' : '❌ Wrong'} (${result.time.toFixed(2)}s) -> ${result.content.substring(0, 40).replace(/\n/g, '')}`);
        } else {
            errors.push(result.error);
        }

        // Delay between questions to avoid hitting rate limits too fast (2 seconds)
        await delay(2000);
    }

    const accuracy = successCount > 0 ? (correctCount / QUESTIONS.length) * 100 : 0;
    const avgTime = successCount > 0 ? totalTime / successCount : 999;

    console.log(`   � Result: ${accuracy.toFixed(0)}% accuracy, ${avgTime !== 999 ? avgTime.toFixed(2) + 's avg time' : 'N/A'}`);

    return {
        model,
        accuracy,
        avgTime,
        successCount,
        errors: errors.join(' | ') || ''
    };
}

// 5. Main Runner
async function runBenchmark() {
    const models = loadModels();
    console.log(`🚀 Starting Deep Benchmark for ${models.length} models...`);
    console.log(`ℹ️  Evaluating ${QUESTIONS.length} complex questions per model.`);
    console.log(`ℹ️  Delaying 2s between questions and 5s between models.\n`);

    const results = [];

    for (let i = 0; i < models.length; i++) {
        const model = models[i];
        const result = await evaluateModel(model);
        results.push(result);

        // Wait 10s between models, unless it's the last one
        if (i < models.length - 1) {
            await delay(10000);
        }
    }

    // Rank Results
    console.log(`\n\n🏆 --- BENCHMARK RESULTS --- 🏆`);

    // Sort by Accuracy (Desc), then Time (Asc)
    results.sort((a, b) => {
        if (b.accuracy !== a.accuracy) return b.accuracy - a.accuracy;
        return a.avgTime - b.avgTime;
    });

    console.table(results.map(r => ({
        Model: r.model,
        Accuracy: `${r.accuracy.toFixed(0)}%`,
        AvgTime: r.avgTime === 999 ? 'N/A' : `${r.avgTime.toFixed(2)}s`,
        Errors: r.errors || 'None'
    })));

    // Generate CSV
    let csvContent = "Model,Accuracy (%),Avg Time (s),Completed Requests,Errors\n";
    results.forEach(r => {
        csvContent += `"${r.model}",${r.accuracy.toFixed(2)},${r.avgTime !== 999 ? r.avgTime.toFixed(3) : 'N/A'},${r.successCount},"${r.errors}"\n`;
    });

    try {
        fs.writeFileSync(RESULTS_CSV, csvContent, 'utf8');
        console.log(`\n📄 Results saved to ${RESULTS_CSV}`);
    } catch (e) {
        console.error('Failed to save CSV:', e);
    }

    // Separate working and failed models
    const workingModels = results.filter(r => r.successCount > 0);
    const failedModels = results.filter(r => r.successCount === 0).map(r => r.model);

    // Split working models into Solvers (fast) and Extractors (slow, large context)
    const SPEED_THRESHOLD = 6.0; // Seconds threshold
    const solverModels = workingModels.filter(r => r.avgTime < SPEED_THRESHOLD).map(r => r.model);
    const extractionModels = workingModels.filter(r => r.avgTime >= SPEED_THRESHOLD || r.avgTime === 999).map(r => r.model);

    console.log(`\n🧹 Found ${solverModels.length} Solvers, ${extractionModels.length} Extractors, and ${failedModels.length} Failed models. Updating files...`);

    try {
        // Write solver models back to Models.txt
        fs.writeFileSync(LABELS_FILE, solverModels.map(m => m + ',').join('\n'), 'utf8');

        // Write extraction models to Extraction_Models.txt
        fs.writeFileSync(EXTRACT_FILE, extractionModels.map(m => m + ',').join('\n'), 'utf8');

        console.log(`   ✅ Solver models saved to Models.txt`);
        console.log(`   ✅ Extraction models saved to Extraction_Models.txt`);

        if (failedModels.length > 0) {
            // Append failed models to failed_models.txt
            const FAILED_FILE = path.join(__dirname, 'failed_models.txt');
            let existingFailed = [];
            if (fs.existsSync(FAILED_FILE)) {
                existingFailed = fs.readFileSync(FAILED_FILE, 'utf8')
                    .split(/[\n,]+/)
                    .map(m => m.trim())
                    .filter(m => m.length > 0);
            }
            const allFailed = [...new Set([...existingFailed, ...failedModels])];
            fs.writeFileSync(FAILED_FILE, allFailed.map(m => m + ',').join('\n'), 'utf8');
            console.log(`   🚫 Failed models moved to failed_models.txt`);
        }
    } catch (e) {
        console.error('   ❌ Error updating model files:', e);
    }

    console.log(`\n📌 Recommended Top 5 Solvers (Copy into AiService.js):`);
    solverModels.slice(0, 5).forEach(m => console.log(`'${m}',`));

    console.log(`\n📌 Recommended Extractors (Copy into AiService.js):`);
    extractionModels.forEach(m => console.log(`'${m}',`));
}

runBenchmark();
