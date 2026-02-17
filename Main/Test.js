const fetch = require('node-fetch');
const clipboardy = require('clipboardy');

// Einfaches Mock-HTML zum Testen (falls Clipboard leer ist)
const MOCK_HTML = `
<div class="que multichoice" id="q1">
    <div class="qtext">Was ist 2 + 2?</div>
    <div class="answer">
        <div class="r0"><input type="radio" id="answer_A" /><label for="answer_A">3</label></div>
        <div class="r1"><input type="radio" id="answer_B" /><label for="answer_B">4</label></div>
        <div class="r0"><input type="radio" id="answer_C" /><label for="answer_C">5</label></div>
    </div>
</div>
`;

(async () => {
    console.log("🧪 Teste Server...");

    // Versuche HTML aus Clipboard zu holen, sonst nimm Mock
    let htmlToSend = MOCK_HTML;
    try {
        const clip = clipboardy.readSync();
        if (clip && clip.includes('<html')) {
            console.log("Nutze HTML aus Zwischenablage.");
            htmlToSend = clip;
        } else {
            console.log("Nutze Mock-HTML (Clipboard leer/ungültig).");
        }
    } catch(e) { console.log("Nutze Mock-HTML."); }

    try {
        const res = await fetch('http://localhost:3000/solve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ html: htmlToSend })
        });

        const data = await res.json();
        console.log("\n📦 Antwort vom Server:");
        console.log(JSON.stringify(data, null, 2));

        if (data.targets && data.targets.length > 0) {
            console.log("\n✅ Test erfolgreich! Der Server hat Ziele zum Klicken zurückgegeben.");
        } else {
            console.log("\n⚠️ Server lief, hat aber keine Ziele gefunden (vllt. KI Fehler?).");
        }

    } catch (e) {
        console.error("❌ Fehler: Server läuft wahrscheinlich nicht.", e.message);
    }
})();