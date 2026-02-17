const express = require('express');
const cors = require('cors');
const { extractQuestionsServer } = require('./lib/Scraper');
const { askAiWithRetry, extractJson } = require('./lib/AiService');

// App Setup
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors()); // Allow browser extension access
app.use(express.json({ limit: '50mb' })); // Allow huge HTML payloads

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
    console.log("⚡️ Processing Quiz...");

    try {
        const { html } = req.body;
        if (!html) {
            console.error("❌ No HTML in body.");
            return res.status(400).json({ error: 'HTML missing' });
        }

        console.log(`📄 Received HTML (${html.length} chars). Parsing...`);

        // 1. Scrape Questions
        const extractedQuestions = extractQuestionsServer(html);

        console.log(`✅ Extracted ${extractedQuestions.length} questions.`);

        if (extractedQuestions.length === 0) {
            console.warn("⚠️ No questions found (Wrong page?)");
            return res.json({ targets: [] });
        }

        // 2. Build Prompt
        const promptText = extractedQuestions.map(q => {
            const optText = q.options.map(o => `[${o.index}] ${o.text}`).join(' | ');
            return `Question ${q.number}: "${q.question}"\nOptions: ${optText}`;
        }).join('\n\n');

        const systemPrompt = `
        You are an expert exam solver. Solve the questions.
        Reply ONLY with a JSON object. No explanations outside the JSON.
        Format: { "1": 0, "2": 1 } 
        (Key = Question Number, Value = Index of correct option).
        `;

        // 3. Ask AI
        const aiRawResponse = await askAiWithRetry([
            { role: 'system', content: systemPrompt },
            { role: 'user', content: promptText }
        ]);

        if (!aiRawResponse) {
            return res.status(500).json({ error: 'AI did not respond.' });
        }

        // 4. Parse Response
        const cleanJsonString = extractJson(aiRawResponse);
        let solutions;
        try {
            solutions = JSON.parse(cleanJsonString);
            console.log("🎯 Parsed JSON:", JSON.stringify(solutions));
        } catch (e) {
            console.error("❌ JSON Parse Error. Cleaned text was:", cleanJsonString);
            return res.status(500).json({ error: 'AI response was invalid JSON.' });
        }

        // 5. Map to IDs
        const clickTargets = [];
        extractedQuestions.forEach(q => {
            let correctIndex = solutions[q.number.toString()];
            if (correctIndex === undefined) correctIndex = solutions[q.number];

            if (correctIndex !== undefined) {
                const targetOption = q.options.find(o => o.index === Number(correctIndex));
                if (targetOption) {
                    clickTargets.push(targetOption.id);
                }
            }
        });

        console.log(`🚀 Sending ${clickTargets.length} click targets to browser.`);

        res.json({
            success: true,
            targets: clickTargets
        });

    } catch (error) {
        console.error("❌ CRITICAL SERVER ERROR:", error);
        res.status(500).json({ error: error.message });
    }
});

// Server Start
app.listen(PORT, () => {
    console.log(`\n--------------------------------------------------`);
    console.log(`🤖 DEBUG-SERVER ready at http://localhost:${PORT}`);
    console.log(`Waiting for requests...`);
    console.log(`--------------------------------------------------\n`);
});
