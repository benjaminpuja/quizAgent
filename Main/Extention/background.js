console.log(' Background Service Worker loaded.');

const SERVER_URL = 'http://127.0.0.1:3000/solve';
const PING_URL = 'http://127.0.0.1:3000/ping';

// ─────────────────────────────────────────────────────────────────────────────
// PORT-BASED FETCH PROXY
// Content scripts (running in HTTPS pages) cannot make HTTP requests due to
// Mixed Content blocking. The service worker is NOT subject to this restriction,
// so all fetch() calls live here. Content.js communicates via a named port.
// ─────────────────────────────────────────────────────────────────────────────
chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== 'solver-proxy') return;

    let activeController = null;

    port.onMessage.addListener(async (msg) => {

        // ── PING ──────────────────────────────────────────────────────────────
        if (msg.action === 'ping') {
            try {
                const response = await fetch(PING_URL, { cache: 'no-store' });
                if (!response.ok) throw new Error(`Status ${response.status}`);
                const data = await response.json();
                if (data.status !== 'alive') throw new Error('Invalid response');
                port.postMessage({ type: 'ping_ok' });
            } catch (err) {
                port.postMessage({ type: 'ping_fail', error: err.message });
            }

            // ── SOLVE ─────────────────────────────────────────────────────────────
        } else if (msg.action === 'solve') {
            if (activeController) activeController.abort();
            activeController = new AbortController();

            try {
                const response = await fetch(SERVER_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ html: msg.html }),
                    signal: activeController.signal
                });

                if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);

                const reader = response.body.getReader();
                const decoder = new TextDecoder('utf-8');
                let done = false;

                while (!done) {
                    const { value, done: streamDone } = await reader.read();
                    done = streamDone;
                    if (value) {
                        const chunk = decoder.decode(value, { stream: true });
                        port.postMessage({ type: 'chunk', chunk });
                    }
                }
                port.postMessage({ type: 'done' });

            } catch (err) {
                if (err.name === 'AbortError') {
                    port.postMessage({ type: 'aborted' });
                } else {
                    port.postMessage({ type: 'error', error: err.message });
                }
            } finally {
                activeController = null;
            }

            // ── ABORT ─────────────────────────────────────────────────────────────
        } else if (msg.action === 'abort') {
            if (activeController) {
                activeController.abort();
                activeController = null;
            }
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// SHORTCUT / TOOLBAR TRIGGER  (unchanged logic)
// ─────────────────────────────────────────────────────────────────────────────
function triggerSolver() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs.length === 0) { console.error('No active tab found.'); return; }
        const activeTab = tabs[0];
        console.log(`Target Tab ID: ${activeTab.id} (${activeTab.url})`);
        chrome.tabs.sendMessage(activeTab.id, { action: 'trigger_solver' }, (response) => {
            if (chrome.runtime.lastError) {
                console.error('ERROR: Could not reach content.js!', chrome.runtime.lastError.message);
            } else {
                console.log('Message sent to content.js.');
            }
        });
    });
}

chrome.action.onClicked.addListener(() => { triggerSolver(); });

chrome.commands.onCommand.addListener((command) => {
    console.log(`Command received: '${command}'`);
    if (command === 'solve_quiz') {
        triggerSolver();
    } else if (command === 'stop_solver') {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs.length > 0) {
                chrome.tabs.sendMessage(tabs[0].id, { action: 'stop_solver' });
            }
        });
    }
});