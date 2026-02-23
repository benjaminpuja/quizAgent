const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { extractQuestionsServer } = require('./lib/Scraper');
const { askAiWithRetry, askSpecificAi, extractJson, EXTRACTION_MODELS, SOLVER_MODELS } = require('./lib/AiService');

// Helper for file logging
function logToFile(text) {
    const logPath = path.join(__dirname, 'logs.txt');
    const timestamp = new Date().toLocaleTimeString();
    try {
        fs.appendFileSync(logPath, `\n[${timestamp}] \n${text}\n--------------------------------------------------\n`);
    } catch (e) {
        console.error('Failed to write to logs.txt:', e);
    }
}

// Load context on startup
let fileContext = '';
try {
    fileContext = fs.readFileSync(path.join(__dirname, 'pruefungskontext.txt'), 'utf-8');
    console.log(` Loaded PRUeFUNGSKONTEXT (${fileContext.length} chars)`);
} catch (e) {
    console.warn(` Could not load context file: ${e.message}`);
}

// App Setup
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors()); // Allow browser extension access
app.use(express.json({ limit: '200mb' })); // Allow huge HTML payloads (increased for Moodle)

// Logging
app.use((req, res, next) => {
    console.log(`\n[${new Date().toLocaleTimeString()}]  ${req.method} Request to ${req.url}`);
    next();
});

// Routes
app.get('/ping', (req, res) => {
    res.json({ status: 'alive', message: 'Server is running!' });
});

app.post('/solve', async (req, res) => {
    console.log(`\n[${new Date().toLocaleTimeString()}]  Processing Quiz...`);

    try {
        const { html } = req.body;
        if (!html) {
            console.error(' No HTML in body.');
            return res.status(400).json({ error: 'HTML missing' });
        }
        console.log(` Body received. HTML size: ${(html.length / 1024 / 1024).toFixed(2)} MB`);

        console.log(` Received HTML (${html.length} chars). Parsing...`);

        // 1. Scrape Questions
        const extractedQuestions = extractQuestionsServer(html);

        console.log(` Extracted ${extractedQuestions.length} questions.`);

        if (extractedQuestions.length === 0) {
            console.warn(' No questions found (Wrong page?)');
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
        console.log(` [Step 1] Asking ${extractorModel} for BULK context extraction...`);

        let allQuestionsText = '';
        extractedQuestions.forEach(q => {
            const optText = q.options.map(o => `[${o.index}] ${o.text}`).join('\n');
            allQuestionsText += `Question ${q.number}: '${q.question}'\nOptions:\n${optText}\n\n`;
        });

        const extractSystemFilePath = path.join(__dirname, 'extractor_prompt.txt');
        const extractSystem = fs.existsSync(extractSystemFilePath)
            ? fs.readFileSync(extractSystemFilePath, 'utf-8').trim()
            : `You are a data extractor. You will be given a massive CONTEXT and a list of QUESTIONS.\nYour job is to read the CONTEXT and extract ONLY the facts explicitly relevant to answering EACH question.\nIf the information to answer a question is NOT found directly in the CONTEXT, you must explicitly state that by strictly outputting "NOT_FOUND" for that question.\nOutput format: A strictly formatted JSON map where the key is the Question Number, and the value is the extracted context.\nExample: { "1": "extracted facts go here...", "2": "NOT_FOUND", "3": "more facts..." }`;

        const extractUser = `CONTEXT:\n${fileContext}\n\nQUESTIONS to extract context for:\n${allQuestionsText}`;

        logToFile(`--- BULK EXTRACTION PROMPT ---\nMODEl: ${extractorModel}\nSYSTEM:\n${extractSystem}\n\nUSER:\nCONTEXT: [Omitted for brevity]\nQUESTIONS:\n${allQuestionsText}`);

        sendEvent({ status: 'Extracting Context...', progress: 'Step 1/2' });

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
                console.warn(' Could not parse R1 bulk extraction, using empty contexts.');
            }
        }

        // Step B: Sequential Solving Loop
        let solvedCount = 0;
        for (let i = 0; i < extractedQuestions.length; i++) {
            const q = extractedQuestions[i];
            console.log(`\n Question ${q.number} `);

            const optText = q.options.map(o => `[${o.index}] ${o.text}`).join('\n');
            const rawQuestionString = `Question: '${q.question}'\nOptions:\n${optText}`;

            let qContext = extractedContexts[q.number.toString()] || 'NOT_FOUND';

            if (qContext === 'NOT_FOUND') {
                console.log(` Extractor reported: Information NOT in context for Q${q.number}.`);
                qContext = 'No specific context found. Answer using your own general reasoning and knowledge.';
            }

            console.log(` [Step 2] Asking Solver Model...`);
            sendEvent({ status: `Solving Question ${q.number}...`, progress: `Step 2/2` });

            const solveSystemFilePath = path.join(__dirname, 'solver_prompt.txt');
            const solveSystem = fs.existsSync(solveSystemFilePath)
                ? fs.readFileSync(solveSystemFilePath, 'utf-8').trim()
                : `You are an expert exam solver. Solve the question using the provided Context.\nReply ONLY with a formated JSON object. No explanations outside the JSON.\nFormat: { "answer": index } \n(Value = 0-BASED Index of correct option).\nIMPORTANT: The first option is ALWAYS index 0. The second is 1. The third is 2. ONLY OUTPUT THE EXACT OPTION INDEX AS AN INTEGER starting from 0.`;

            const solveUser = `Context: ${qContext}\n\n${rawQuestionString}`;

            // We need 3 different models for consensus
            const targetModels = SOLVER_MODELS.slice(0, 3);

            if (targetModels.length < 3) {
                console.warn(" WARNING: Less than 3 solver models configured. Consensus logic might fall back to fewer models.");
            }

            let attempt = 0;
            const maxAttempts = 3;
            let finalAnswer = null;
            let consensusReached = false;

            while (attempt < maxAttempts && !consensusReached) {
                attempt++;
                console.log(`\n [Step 2] Asking 3 Solver Models (Attempt ${attempt}/${maxAttempts})...`);
                if (attempt === 1) sendEvent({ status: `Solving Question ${q.number} (Attempt ${attempt})...`, progress: `Step 2/2` });

                logToFile(`--- Q${q.number} SOLVER PROMPT (Attempt ${attempt}) ---\nSYSTEM:\n${solveSystem}\n\nUSER:\n${solveUser}`);

                // Send 3 requests concurrently
                const solverPromises = targetModels.map(model =>
                    askAiWithRetry([
                        { role: 'system', content: solveSystem },
                        { role: 'user', content: solveUser }
                    ], 0, model)
                );

                const responsesRaw = await Promise.all(solverPromises);

                // Parse answers
                const answers = [];
                for (let j = 0; j < responsesRaw.length; j++) {
                    const raw = responsesRaw[j];
                    const modelName = targetModels[j];
                    if (!raw) {
                        console.error(` ${modelName} returned NULL.`);
                        continue;
                    }

                    const cleanJsonStr = extractJson(raw);
                    if (cleanJsonStr) {
                        try {
                            const parsed = JSON.parse(cleanJsonStr);
                            if (parsed.answer !== undefined) {
                                answers.push(parsed.answer);
                                console.log(` ${modelName} chose Option [${parsed.answer}]`);
                            }
                        } catch (e) {
                            console.error(` Failed to parse JSON from ${modelName}`);
                        }
                    } else {
                        console.error(` No valid JSON from ${modelName}`);
                    }
                }

                logToFile(`--- Q${q.number} SOLVER RESPONSES (Attempt ${attempt}) ---\nAnswers Collected: ${JSON.stringify(answers)}`);

                // Check for consensus (majority vote)
                if (answers.length > 0) {
                    const counts = {};
                    let maxCount = 0;
                    let mostFrequentAnswer = null;

                    for (const ans of answers) {
                        counts[ans] = (counts[ans] || 0) + 1;
                        if (counts[ans] > maxCount) {
                            maxCount = counts[ans];
                            mostFrequentAnswer = ans;
                        }
                    }

                    // For 3 models, consensus is 2+ matching answers.
                    // If we only got 1 or 2 answers total, we just take the most frequent.
                    if (maxCount >= 2 || (answers.length < 3 && maxCount >= 1)) {
                        finalAnswer = mostFrequentAnswer;
                        consensusReached = true;
                        console.log(` Consensus reached! Option [${finalAnswer}] won with ${maxCount} votes.`);
                    } else if (answers.length === 3 && maxCount === 1) {
                        console.log(` ⚠️ EXACT TIE! All 3 models returned different answers. Retrying...`);
                        sendEvent({ status: `Retrying Question ${q.number} (Tie-Breaker)...` });
                    }
                } else {
                    console.log(` ⚠️ All 3 models failed to return a valid answer. Retrying...`);
                    // Backoff slightly
                    await new Promise(r => setTimeout(r, 1000));
                }
            }

            if (finalAnswer !== null) {
                const targetId = q.options.find(o => o.index == finalAnswer)?.id;
                if (targetId) {
                    solvedCount++;
                    sendEvent({ questionNum: q.number, targetId: targetId });
                    console.log(` Solved Q${q.number}. Streaming ID: ${targetId}`);
                } else {
                    console.warn(` Target ID not found for Option ${finalAnswer}`);
                }
            } else {
                console.error(` ❌ FAILED Q${q.number}: No consensus reached after ${maxAttempts} attempts.`);
                sendEvent({ error: `Failed Q${q.number} (No Consensus)` });
            }

            // Rate limit delay (Delay before next question solver)
            if (i < extractedQuestions.length - 1) {
                // Unlimited requests per 10s based on user, so let's keep it extremely fast
                await new Promise(r => setTimeout(r, 250));
            }
        }

        console.log(`\n Finished streaming. Solved ${solvedCount} questions.`);
        sendEvent({ done: true });
        res.end(); // Close stream

    } catch (error) {
        console.error(' CRITICAL SERVER ERROR:', error);
        res.status(500).json({ error: error.message });
    }
});

// Server Start
const server = app.listen(PORT, () => {
    console.log(`\n--------------------------------------------------`);
    console.log(` DEBUG-SERVER ready at http://localhost:${PORT}`);
    console.log(`Waiting for requests...`);
    console.log(`--------------------------------------------------\n`);
});

// DEBUG: Keep Event Loop Alive & Log Exit
setInterval(() => { }, 1000); // Hack to keep process alive if Express fails to

process.on('exit', (code) => {
    console.log(` Process is EXITING with code: ${code}`);
});

process.on('SIGINT', () => {
    console.log(' Received SIGINT. Shutting down gracefully.');
    process.exit();
});

// Global Error Handlers
process.on('uncaughtException', (err) => {
    console.error(' UNCAUGHT EXCEPTION:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error(' UNHANDLED REJECTION:', reason);
});
