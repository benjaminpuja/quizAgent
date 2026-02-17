const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const cheerio = require('cheerio');

const app = express();
const PORT = 3000;

// ==========================================
// KONFIGURATION
// ==========================================
const API_KEY = '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';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL_SOLVER = 'deepseek/deepseek-r1-0528:free'; // Das Free Model

// ==========================================
// MIDDLEWARE (Vorverarbeitung)
// ==========================================
app.use(cors()); // Erlaubt Browser-Extension Zugriff
app.use(express.json({ limit: '50mb' })); // Erlaubt riesiges HTML

// Logging für jeden Request
app.use((req, res, next) => {
    console.log(`\n[${new Date().toLocaleTimeString()}] 📨 ${req.method} Request an ${req.url}`);
    next();
});

// ==========================================
// HILFSFUNKTIONEN
// ==========================================

// Text bereinigen (Leerzeichen entfernen)
function cleanText(text) {
    return text ? text.replace(/\s+/g, ' ').trim() : '';
}

// Anfrage an die KI senden
async function askAI(messages) {
    console.log(`📡 Sende Anfrage an KI (${MODEL_SOLVER})...`);
    try {
        const response = await fetch(OPENROUTER_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${API_KEY}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'http://localhost:3000',
            },
            body: JSON.stringify({
                model: MODEL_SOLVER,
                messages: messages,
                temperature: 0.0,
                // Wir bitten um JSON, aber DeepSeek ignoriert das manchmal,
                // deshalb haben wir unten den Cleaner eingebaut.
            })
        });

        const json = await response.json();

        if (json.error) {
            console.error("❌ API Fehler:", JSON.stringify(json.error, null, 2));
            return null;
        }

        return json.choices?.[0]?.message?.content;
    } catch (error) {
        console.error("❌ Netzwerkfehler zur KI:", error.message);
        return null;
    }
}

// JSON Bereiniger (Der WICHTIGSTE Teil für DeepSeek!)
function extractJsonFromResponse(aiText) {
    if (!aiText) return null;

    // 1. <think> Tags entfernen
    let cleanText = aiText.replace(/<think>[\s\S]*?<\/think>/gi, '');

    // 2. Markdown Code-Blöcke entfernen (```json ...)
    cleanText = cleanText.replace(/```json/gi, '').replace(/```/g, '');

    // 3. Alles vor der ersten '{' und nach der letzten '}' wegschneiden
    const firstBrace = cleanText.indexOf('{');
    const lastBrace = cleanText.lastIndexOf('}');

    if (firstBrace !== -1 && lastBrace !== -1) {
        cleanText = cleanText.substring(firstBrace, lastBrace + 1);
    } else {
        console.warn("⚠️ Kein JSON-Objekt ({...}) im KI-Text gefunden!");
        return null;
    }

    return cleanText.trim();
}

// ==========================================
// ROUTEN
// ==========================================

// 1. Ping (Lebenszeichen für die grüne Box)
app.get('/ping', (req, res) => {
    res.json({ status: 'alive', message: 'Server läuft!' });
});

// 2. Solve (Die Hauptlogik)
app.post('/solve', async (req, res) => {
    console.log("⚡️ Verarbeite Quiz...");

    try {
        const { html } = req.body;
        if (!html) {
            console.error("❌ Kein HTML im Body gefunden.");
            return res.status(400).json({ error: 'HTML fehlt' });
        }

        console.log(`📄 HTML erhalten (${html.length} Zeichen). Starte Cheerio...`);

        // --- HTML Parsen ---
        const $ = cheerio.load(html);
        const extractedQuestions = [];

        // Gehe alle Fragen durch (Moodle Klasse: .que)
        $('.que').each((index, element) => {
            const qText = cleanText($(element).find('.qtext').text());
            const options = [];

            // Suche Inputs (Radio/Checkbox)
            $(element).find('input[type="radio"], input[type="checkbox"]').each((i, input) => {
                const inputId = $(input).attr('id');

                // Versuche Label zu finden (entweder über 'for' Attribut oder Parent)
                let labelText = cleanText($(element).find(`label[for="${inputId}"]`).text());
                if (!labelText) {
                    labelText = cleanText($(input).closest('.r0, .r1, div').text());
                }

                if (inputId) {
                    options.push({
                        index: i,      // 0, 1, 2...
                        id: inputId,   // ID für den Klick
                        text: labelText
                    });
                }
            });

            if (options.length > 0) {
                extractedQuestions.push({
                    number: index + 1,
                    question: qText,
                    options: options
                });
            }
        });

        console.log(`✅ ${extractedQuestions.length} Fragen extrahiert.`);

        if (extractedQuestions.length === 0) {
            console.warn("⚠️ Keine Fragen gefunden (vielleicht falsche Seite?)");
            return res.json({ targets: [] });
        }

        // --- Prompt bauen ---
        const promptText = extractedQuestions.map(q => {
            const optText = q.options.map(o => `[${o.index}] ${o.text}`).join(' | ');
            return `Frage ${q.number}: "${q.question}"\nOptionen: ${optText}`;
        }).join('\n\n');

        const systemPrompt = `
        Du bist ein Experte. Löse die Fragen.
        Antworte NUR mit einem JSON-Objekt. Keine Erklärungen außerhalb des JSONs.
        Format: { "1": 0, "2": 1 } 
        (Schlüssel = Fragennummer, Wert = Index der korrekten Option).
        `;

        // --- KI Fragen ---
        const aiRawResponse = await askAI([
            { role: 'system', content: systemPrompt },
            { role: 'user', content: promptText }
        ]);

        if (!aiRawResponse) {
            return res.status(500).json({ error: 'KI hat nicht geantwortet.' });
        }

        // --- Antwort verarbeiten ---
        console.log("📝 Rohe KI Antwort (Ausschnitt):", aiRawResponse.substring(0, 100) + "...");

        const cleanJsonString = extractJsonFromResponse(aiRawResponse);

        let solutions;
        try {
            solutions = JSON.parse(cleanJsonString);
            console.log("🎯 Geparsetes JSON:", JSON.stringify(solutions));
        } catch (e) {
            console.error("❌ Konnte JSON nicht parsen. Bereinigter String war:", cleanJsonString);
            return res.status(500).json({ error: 'KI Antwort war ungültig.' });
        }

        // --- IDs zuordnen ---
        const clickTargets = [];
        extractedQuestions.forEach(q => {
            // Versuche String-Schlüssel "1" oder Number 1
            let correctIndex = solutions[q.number.toString()];
            if (correctIndex === undefined) correctIndex = solutions[q.number];

            if (correctIndex !== undefined) {
                const targetOption = q.options.find(o => o.index === Number(correctIndex));
                if (targetOption) {
                    clickTargets.push(targetOption.id);
                }
            }
        });

        console.log(`🚀 Sende ${clickTargets.length} Klick-Ziele an Browser.`);

        res.json({
            success: true,
            targets: clickTargets
        });

    } catch (error) {
        console.error("❌ KRITISCHER SERVER FEHLER:", error);
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// SERVER START
// ==========================================
app.listen(PORT, () => {
    console.log(`\n--------------------------------------------------`);
    console.log(`🤖 DEBUG-SERVER ist bereit auf http://localhost:${PORT}`);
    console.log(`Waiting for requests...`);
    console.log(`--------------------------------------------------\n`);
});