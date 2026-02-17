// ---- deps ----
const fetch = require('node-fetch'); // Achtung: v2.6.x verwenden, sonst ESM (import) nötig
const clipboardy = require('clipboardy');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process'); // für Notification

// ---- config ----


// ---- notify (macOS) ----
function notifyMac(message, title = 'LLM Antwort') {
    const short = (message || '').replace(/\s+/g, ' ').slice(0, 180) || 'Fertig.';
    const script = `display notification "${short.replace(/"/g, '\\"')}" with title "${title.replace(/"/g, '\\"')}"`;
    execFile('/usr/bin/osascript', ['-e', script], (err) => {
        if (err) console.error('🔕 osascript Fehler:', err);
    });
}

// ---- small fetch w/ retry ----
async function postJSONWithRetry(url, options, tries = 3) {
    let lastErr;
    for (let i = 0; i < tries; i++) {
        try {
            const res = await fetch(url, options);
            if (res.ok) return res;
            const bodyText = await res.text().catch(() => '');
            // 429 / 5xx: retry
            if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
                const backoff = 500 * Math.pow(2, i); // 0.5s, 1s, 2s
                console.error(`⚠️ HTTP ${res.status}. Retry in ${backoff} ms. Body: ${bodyText}`);
                await new Promise(r => setTimeout(r, backoff));
                continue;
            }
            // andere Fehler: nicht retryen
            throw new Error(`HTTP ${res.status}: ${bodyText}`);
        } catch (e) {
            lastErr = e;
            // bei Netzwerkfehlern retryen
            const backoff = 500 * Math.pow(2, i);
            console.error(`⚠️ Netz/Fetch-Fehler (Try ${i+1}/${tries}): ${e.message}. Retry in ${backoff} ms.`);
            await new Promise(r => setTimeout(r, backoff));
        }
    }
    throw lastErr || new Error('Unbekannter Fehler bei postJSONWithRetry');
}

// ---- main ----
(async () => {
    if (!API_KEY || API_KEY === '$Key') {
        console.error('⚠️ OPENROUTER_API_KEY fehlt. Setze die ENV-Variable oder trage den echten Key ein.');
        notifyMac('OPENROUTER_API_KEY fehlt.', 'LLM Fehler');
        process.exit(1);
    }

    const userText = clipboardy.readSync().trim();
    if (!userText) return console.log('📋 Clipboard ist leer.');

    // 📚 Kontext laden
    const fileContext = fs.readFileSync(path.join(__dirname, 'prüfungskontext.txt'), 'utf-8');
    const Context = fs.readFileSync(path.join(__dirname, 'Context.txt'), 'utf-8');
    const fullContext = `${Context}\n\n${fileContext}`;

    const body = {
        model: MODEL,
        messages: [
            {
                role: 'system',
                content: 'Beantworte alle Fragen ausschließlich basierend auf folgendem Prüfungskontext:\n\n' +
                          fullContext +
                          '\n Frage:',
            },
            {
                role: 'user',
                content: userText
            },
        ],
        max_tokens: 512,
        temperature: 0.1,
    };

    try {
        const res = await postJSONWithRetry(OPENROUTER_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${API_KEY}`,
                'Content-Type': 'application/json',
                // empfohlen von OpenRouter (manchmal erforderlich)
                'HTTP-Referer': 'http://localhost', // oder deine echte App-/Website-URL
                'X-Title': 'Clipboard-Learning-Helper',
            },
            body: JSON.stringify(body),
        });

        let json;
        try {
            json = await res.json();
        } catch (e) {
            const txt = await res.text().catch(() => '');
            throw new Error(`Antwort kein gültiges JSON. Body:\n${txt}`);
        }

        const answer = json?.choices?.[0]?.message?.content;
        if (answer) {
            clipboardy.writeSync(answer);
            console.log('✅ Antwort ins Clipboard kopiert.');
            notifyMac(answer, 'LLM Antwort');
        } else {
            console.error('⚠️ Unerwartetes JSON:', JSON.stringify(json, null, 2));
            console.error('⚠️ Keine content-Antwort, reasoning war:', msg?.reasoning?.slice(0, 500));
            notifyMac('Keine Antwort im JSON.', 'LLM Antwort');
        }
    } catch (e) {
        console.error('❌ Fehler bei Anfrage:', e);
        notifyMac(String(e.message || e), 'LLM Fehler');
    }
})();
