const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { extractQuestionsServer } = require('./lib/Scraper');
const { askAiWithRetry, askSpecificAi, extractJson, EXTRACTION_MODELS } = require('./lib/AiService');

// Helper for file logging
function logToFile(text) {
    const logPath = path.join(__dirname, 'logs.txt');
    const timestamp = new Date().toLocaleTimeString();
    try {
        fs.appendFileSync(logPath, `\n[${timestamp}] \n${text}\n--------------------------------------------------\n`);
    } catch (e) {
        console.error("Failed to write to logs.txt:", e);
    }
}

// Load context on startup
let fileContext = '';
try {
    fileContext = fs.readFileSync(path.join(__dirname, 'prüfungskontext.txt'), 'utf-8');
    console.log(`✅ Loaded PRÜFUNGSKONTEXT (${fileContext.length} chars)`);
} catch (e) {
    console.warn(`⚠️ Could not load context file: ${e.message}`);
}

// App Setup
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors()); // Allow browser extension access
app.use(express.json({ limit: '200mb' })); // Allow huge HTML payloads (increased for Moodle)

// Logging
app.use((req, res, next) => {
    console.log(`\n[${new Date().toLocaleTimeString()}] 📨 ${req.method} Request to ${req.url}`);
    next();
});

// Routes
app.get('/ping', (req, res) => {
    res.json({ status: 'alive', message: 'Server is running!' });
});

app.post('/solve', async (req, res) => {
    console.log(`\n[${new Date().toLocaleTimeString()}] ⚡️ Processing Quiz...`);

    try {
        const { html } = req.body;
        if (!html) {
            console.error("❌ No HTML in body.");
            return res.status(400).json({ error: 'HTML missing' });
        }
        console.log(`📥 Body received. HTML size: ${(html.length / 1024 / 1024).toFixed(2)} MB`);

        console.log(`📄 Received HTML (${html.length} chars). Parsing...`);

        // 1. Scrape Questions
        const extractedQuestions = extractQuestionsServer(html);

        console.log(`✅ Extracted ${extractedQuestions.length} questions.`);

        if (extractedQuestions.length === 0) {
            console.warn("⚠️ No questions found (Wrong page?)");
            return res.json({ targets: [] });
        }

        // Enable Streaming Response explicitly
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        });

        // Essential: Flush the headers immediately so the browser starts downloading the stream
        if (res.flushHeaders) {
            res.flushHeaders();
        }

        // Helper to send events to frontend and force explicitly flush buffer
        const sendEvent = (data) => {
            res.write(`data: ${JSON.stringify(data)}\n\n`);
            if (res.flush) res.flush(); // If utilizing compression
        };

        // Step A: Bulk Extraction with R1
        const extractorModel = EXTRACTION_MODELS && EXTRACTION_MODELS.length > 0 ? EXTRACTION_MODELS[0] : 'deepseek/deepseek-r1-0528:free';
        console.log(`🧠 [Step 1] Asking ${extractorModel} for BULK context extraction...`);

        let allQuestionsText = "";
        extractedQuestions.forEach(q => {
            const optText = q.options.map(o => `[${o.index}] ${o.text}`).join('\n');
            allQuestionsText += `Question ${q.number}: "${q.question}"\nOptions:\n${optText}\n\n`;
        });

        const extractSystem = `You are a data extractor. You will be given a massive CONTEXT and a list of QUESTIONS.
Your job is to read the CONTEXT and extract ONLY the facts explicitly relevant to answering EACH question.
If the information to answer a question is NOT found directly in the CONTEXT, you must explicitly state that by strictly outputting "NOT_FOUND" for that question.
Output format: A strictly formatted JSON map where the key is the Question Number, and the value is the extracted context.
Example: { "1": "extracted facts go here...", "2": "NOT_FOUND", "3": "more facts..." }`;

        const extractUser = `CONTEXT:\n${fileContext}\n\nQUESTIONS to extract context for:\n${allQuestionsText}`;

        logToFile(`--- BULK EXTRACTION PROMPT ---\nMODEl: ${extractorModel}\nSYSTEM:\n${extractSystem}\n\nUSER:\nCONTEXT: [Omitted for brevity]\nQUESTIONS:\n${allQuestionsText}`);

        sendEvent({ status: "Extracting Context...", progress: "Step 1/2" });

        const r1Response = await askSpecificAi(extractorModel, [
            { role: 'system', content: extractSystem },
            { role: 'user', content: extractUser }
        ], 0.2);

        logToFile(`--- BULK EXTRACTION RESPONSE (${extractorModel}) ---\n${r1Response}`);

        const cleanR1Raw = extractJson(r1Response);
        let extractedContexts = {};
        if (cleanR1Raw) {
            try {
                extractedContexts = JSON.parse(cleanR1Raw);
            } catch (e) {
                console.warn("⚠️ Could not parse R1 bulk extraction, using empty contexts.");
            }
        }

        // Step B: Sequential Solving Loop
        let solvedCount = 0;
        for (let i = 0; i < extractedQuestions.length; i++) {
            const q = extractedQuestions[i];
            console.log(`\n─────────❓ Question ${q.number} ─────────`);

            const optText = q.options.map(o => `[${o.index}] ${o.text}`).join('\n');
            const rawQuestionString = `Question: "${q.question}"\nOptions:\n${optText}`;

            let qContext = extractedContexts[q.number.toString()] || "NOT_FOUND";

            if (qContext === "NOT_FOUND") {
                console.log(`⚠️ Extractor reported: Information NOT in context for Q${q.number}.`);
                qContext = "No specific context found. Answer using your own general reasoning and knowledge.";
            }

            console.log(`🤖 [Step 2] Asking Solver Model...`);
            sendEvent({ status: `Solving Question ${q.number}...`, progress: `Step 2/2` });

            const solveSystem = `You are an expert exam solver. Solve the question using the provided Context.
Reply ONLY with a formated JSON object. No explanations outside the JSON.
Format: { "answer": index } 
(Value = 0-BASED Index of correct option).
IMPORTANT: The first option is ALWAYS index 0. The second is 1. The third is 2. ONLY OUTPUT THE EXACT OPTION INDEX AS AN INTEGER starting from 0.`;

            const solveUser = `Context: ${qContext}\n\n${rawQuestionString}`;

            logToFile(`--- Q${q.number} SOLVER PROMPT ---\nSYSTEM:\n${solveSystem}\n\nUSER:\n${solveUser}`);

            const aiRawResponse = await askAiWithRetry([
                { role: 'system', content: solveSystem },
                { role: 'user', content: solveUser }
            ]);

            logToFile(`--- Q${q.number} SOLVER RESPONSE ---\n${aiRawResponse}`);
            console.log("💬 Solver Response:", aiRawResponse ? aiRawResponse.substring(0, 100).replace(/\n/g, ' ') : "NULL");

            if (!aiRawResponse) {
                console.error(`❌ AI did not respond for question ${q.number}.`);
                continue;
            }

            const cleanJsonStr = extractJson(aiRawResponse);

            if (cleanJsonStr) {
                try {
                    const parsed = JSON.parse(cleanJsonStr);
                    if (parsed.answer !== undefined) {
                        const targetId = q.options.find(o => o.index == parsed.answer)?.id;
                        if (targetId) {
                            solvedCount++;
                            sendEvent({ questionNum: q.number, targetId: targetId });
                            console.log(`🎯 Solved Q${q.number}. Streaming: ${targetId}`);
                        } else {
                            console.warn(`⚠️ Target ID not found for Option ${parsed.answer}`);
                        }
                    }
                } catch (e) {
                    console.error("❌ Failed to parse Solver JSON.");
                    sendEvent({ error: `JSON Parse failed for Q${q.number}` });
                }
            } else {
                console.error("❌ Valid JSON block not found in Solver output.");
            }

            // Rate limit delay (Delay before next question solver)
            if (i < extractedQuestions.length - 1) {
                // Unlimited requests per 10s based on user, so let's keep it extremely fast
                await new Promise(r => setTimeout(r, 250));
            }
        }

        console.log(`\n🚀 Finished streaming. Solved ${solvedCount} questions.`);
        sendEvent({ done: true });
        res.end(); // Close stream

    } catch (error) {
        console.error("❌ CRITICAL SERVER ERROR:", error);
        res.status(500).json({ error: error.message });
    }
});

// Server Start
const server = app.listen(PORT, () => {
    console.log(`\n--------------------------------------------------`);
    console.log(`🤖 DEBUG-SERVER ready at http://localhost:${PORT}`);
    console.log(`Waiting for requests...`);
    console.log(`--------------------------------------------------\n`);
});

// DEBUG: Keep Event Loop Alive & Log Exit
setInterval(() => { }, 1000); // Hack to keep process alive if Express fails to

process.on('exit', (code) => {
    console.log(`🛑 Process is EXITING with code: ${code}`);
});

process.on('SIGINT', () => {
    console.log('🛑 Received SIGINT. Shutting down gracefully.');
    process.exit();
});

// Global Error Handlers
process.on('uncaughtException', (err) => {
    console.error('💥 UNCAUGHT EXCEPTION:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('💥 UNHANDLED REJECTION:', reason);
});
