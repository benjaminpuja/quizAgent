const fetch = require('node-fetch');
const clipboardy = require('clipboardy');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

// ---- Konfiguration ----
const API_KEY = ''; // DEIN KEY HIER
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL_SOLVER = 'deepseek/deepseek-r1-0528:free';

function notifyMac(message, title = 'Moodle Bot') {
    // 1. Wir entfernen echte Zeilenumbrüche und ersetzen sie durch sichtbare Trenner
    // 2. Wir entfernen doppelte Leerzeichen
    const flatMessage = (message || '')
        .replace(/\n/g, '  |  ')
        .replace(/\s+/g, ' ')
        .replace(/"/g, "'")
        .trim();

    // Den Text auf ca. 120 Zeichen begrenzen, damit er sicher ins Banner passt
    const shortMessage = flatMessage.length > 120
        ? flatMessage.substring(0, 117) + '...'
        : flatMessage;

    const script = `display notification "${shortMessage}" with title "${title}" sound name "Ping"`;

    execFile('/usr/bin/osascript', ['-e', script], (err) => {
        if (err) console.error('❌ Notification Fehler:', err);
    });
}

function ultraCleanHtml(html) {
    return html
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

// ---- LLM API Aufruf mit viel Logging ----
async function askLLM(messages, model) {
    console.log(`📡 Sende Anfrage an OpenRouter (Modell: ${model})...`);

    try {
        const res = await fetch(OPENROUTER_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${API_KEY}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'http://localhost:3000', // Manchmal von OpenRouter gefordert
                'X-Title': 'Moodle-Bot-Debug',
            },
            body: JSON.stringify({
                model: model,
                messages: messages,
                temperature: 0.0
            }),
        });

        console.log(`📥 HTTP Status: ${res.status} ${res.statusText}`);

        const json = await res.json();

        // Vollständiges JSON zur Inspektion ausgeben
        console.log('📦 Rohe Antwort von der API:', JSON.stringify(json, null, 2));

        if (json.error) {
            console.error('❌ API Fehler Details:', json.error);
            return null;
        }

        const content = json?.choices?.[0]?.message?.content;

        if (!content) {
            console.warn('⚠️ Die API hat ein leeres Content-Feld zurückgegeben.');
        }

        return content;
    } catch (err) {
        console.error('❌ Netzwerk/Fetch Fehler:', err.message);
        return null;
    }
}

// ---- Hauptfunktion ----
(async () => {
    try {
        const rawHtml = clipboardy.readSync().trim();
        if (!rawHtml || !rawHtml.includes('<')) {
            return console.log('📋 Clipboard leer oder kein HTML.');
        }

        // --- SCHRITT 0: SCHNELLE EXTRAKTION (OHNE REGEX-FALLE) ---
        console.log('⏳ Schritt 0: Extrahiere Blöcke (Schnelle Methode)...');

        // Statt einer komplexen Regex nutzen wir einfaches Splitten am ID-Anker von Moodle
        // Das ist immun gegen das "Einfrieren" bei großen Dateien
        const questionBlocks = rawHtml.split('id="question-').slice(1);

        if (questionBlocks.length === 0) {
            // Falls das Splitten fehlschlägt, versuchen wir es mit der CSS-Klasse
            const fallbackBlocks = rawHtml.split('class="que ').slice(1);
            if (fallbackBlocks.length === 0) {
                throw new Error('Keine Moodle-Fragen im HTML gefunden.');
            }
            // Wir arbeiten mit den Fallback-Blöcken weiter
            var finalBlocks = fallbackBlocks;
        } else {
            var finalBlocks = questionBlocks;
        }

        console.log(`✅ ${finalBlocks.length} Fragen-Blöcke gefunden.`);

        // --- SCHRITT 1: STRUKTURIEREN ---
        const structuredQuestions = questionBlocks.map((block, i) => {
            const qMatch = block.match(/<div class="qtext">([\s\S]*?)<\/div>/i);
            const qText = ultraCleanHtml(qMatch ? qMatch[1] : "Frage nicht gefunden");
            const optionMatches = [...block.matchAll(/<div[^>]*class="flex-fill[^>]*>([\s\S]*?)<\/div>/gi)];
            let options = optionMatches.map(m => ultraCleanHtml(m[1]));
            if (options.length === 0) {
                const labelMatches = [...block.matchAll(/<label[^>]*>([\s\S]*?)<\/label>/gi)];
                options = labelMatches.map(m => ultraCleanHtml(m[1]));
            }
            options = [...new Set(options)].filter(opt => opt.length > 0 && !opt.includes('Clear my choice'));
            const formattedOptions = options.map((opt, idx) => `${String.fromCharCode(97 + idx)}. ${opt}`);

            return { index: i + 1, question: qText, options: formattedOptions.join(' ') };
        });

        const cleanQuestionList = structuredQuestions
            .map(q => `Frage ${q.index}: ${q.question}\nOptionen: ${q.options}`)
            .join('\n---\n');

        console.log('\n--- 📝 GEREINIGTE FRAGEN-LISTE ---\n', cleanQuestionList, '\n----------------------------------\n');

        // --- KONTEXT LADEN ---
        console.log('⏳ Lade Kontextdateien...');
        const fileContext = fs.readFileSync(path.join(__dirname, 'prüfungskontext.txt'), 'utf-8');
        const context = fs.readFileSync(path.join(__dirname, 'Context.txt'), 'utf-8');
        const fullContext = `${context}\n\n${fileContext}`;
        console.log(`✅ Kontext geladen (Gesamtlänge: ${fullContext.length} Zeichen).`,fullContext);

        // --- SCHRITT 2: KI LÖSUNG ---
        const solverPrompt = [
            {
                role: 'system',
                content: 'Du bist ein Prüfungs-Assistent. Beantworte die Fragen basierend auf dem Kontext. Format:\nNr X: a\n\nKONTEXT:\n' + fullContext
            },
            { role: 'user', content: cleanQuestionList }
        ];

        const finalAnswer = await askLLM(solverPrompt, MODEL_SOLVER);

        if (finalAnswer) {
            clipboardy.writeSync(finalAnswer);
            console.log('\n--- 💡 BOT LÖSUNG ---');
            console.log(finalAnswer);
            notifyMac(finalAnswer);
            console.log('\n---------------------\n✅ Lösung liegt im Clipboard.');
        } else {
            console.error('\n❌ Keine Lösung erhalten. Prüfe die API-Antwort oben.');
        }

    } catch (e) {
        console.error('\n❌ Kritischer Fehler im Ablauf:', e.message);
    }
})();