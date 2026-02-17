// Konfiguration
const SERVER_URL = 'http://localhost:3000/solve';
const PING_URL = 'http://localhost:3000/ping';

// --- VISUELLE DEBUG BOX ---
const debugBox = document.createElement('div');
debugBox.id = "moodle-solver-debug";
Object.assign(debugBox.style, {
    position: 'fixed', bottom: '10px', left: '10px',
    backgroundColor: 'rgba(0,0,0,0.8)', color: '#0f0',
    padding: '10px', borderRadius: '5px', zIndex: '9999999',
    fontFamily: 'monospace', fontSize: '12px', pointerEvents: 'none',
    border: '1px solid #0f0', minWidth: '200px'
});
debugBox.innerHTML = "🛑 Solver: Bereit (Warte auf Shortcut)";
document.body.appendChild(debugBox);

function logStatus(msg, color = '#0f0') {
    console.log(`[Solver] ${msg}`);
    debugBox.style.color = color;
    debugBox.style.borderColor = color;
    debugBox.innerText = `➤ ${msg}`;
}

// 1. Initialer Test: Ist der Server überhaupt da?
fetch(PING_URL)
    .then(() => logStatus("✅ Server verbunden (Port 3000)", "#0f0"))
    .catch(() => logStatus("⚠️ Server NICHT erreichbar! Node läuft?", "#f00"));


// 2. Listener für Shortcut
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "trigger_solver") {
        runSolver();
        // Sende Bestätigung zurück an background.js
        sendResponse({status: "received"});
    }
    return true;
});

async function runSolver() {
    logStatus("🕵️ Shortcut erkannt! Sende HTML...", "yellow");

    const htmlContent = document.documentElement.outerHTML;

    try {
        const response = await fetch(SERVER_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ html: htmlContent })
        });

        if (!response.ok) throw new Error(`HTTP Fehler: ${response.status}`);

        const data = await response.json();

        if (data.targets && data.targets.length > 0) {
            logStatus(`✅ ${data.targets.length} Lösungen! Klicke...`, "#0f0");
            clickAnswersSlowly(data.targets);
        } else {
            logStatus("⚠️ Server ok, aber 0 Lösungen gefunden.", "orange");
        }

    } catch (err) {
        console.error(err);
        logStatus(`❌ FEHLER: ${err.message}`, "red");
    }
}

async function clickAnswersSlowly(targetIds) {
    for (const id of targetIds) {
        const element = document.getElementById(id);
        if (element) {
            const waitTime = Math.floor(Math.random() * 1000) + 500;
            await new Promise(r => setTimeout(r, waitTime));

            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            element.click();

            // Markierung
            const parent = element.closest('.r0, .r1, div');
            if(parent) parent.style.border = "2px solid lime";
        }
    }
    logStatus("🏁 Alle Klicks ausgeführt.", "#0f0");
    setTimeout(() => debugBox.style.display = 'none', 5000);
}