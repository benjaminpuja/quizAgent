// ─────────────────────────────────────────────────────────────────────────────
// NOTE: All fetch() calls are proxied through background.js (service worker)
// because this content script runs inside an HTTPS page. Chrome blocks HTTP
// requests (to localhost) made from HTTPS contexts as Mixed Content.
// The service worker is NOT subject to this restriction.
// ─────────────────────────────────────────────────────────────────────────────

// --- VISUAL DEBUG BOX ---
let isDebugMode = true; // Default

const debugBox = document.createElement('div');
debugBox.id = "moodle-solver-debug";
Object.assign(debugBox.style, {
    position: 'fixed', bottom: '10px', left: '10px',
    backgroundColor: 'rgba(0, 0, 0, 0.8)', color: '#0f0',
    padding: '12px', borderRadius: '8px', zIndex: '9999999',
    fontFamily: 'Consolas, monospace', fontSize: '13px',
    pointerEvents: 'none', border: '1px solid #0f0',
    minWidth: '220px', boxShadow: '0 4px 6px rgba(0,0,0,0.3)',
    transition: 'opacity 0.5s ease-in-out',
    display: 'none'
});
debugBox.innerHTML = "[Solver]: Ready (Waiting for Shortcut)";
document.body.appendChild(debugBox);

const statusIndicator = document.createElement('div');
statusIndicator.id = "moodle-solver-indicator";
Object.assign(statusIndicator.style, {
    position: 'fixed', bottom: '10px', left: '10px',
    width: '12px', height: '12px', borderRadius: '50%',
    backgroundColor: 'red',
    zIndex: '9999999', pointerEvents: 'none',
    boxShadow: '0 0 6px red',
    transition: 'background-color 0.3s, box-shadow 0.3s',
    display: 'none'
});
document.body.appendChild(statusIndicator);

function updateDebugVisibility() {
    debugBox.style.display = isDebugMode ? 'block' : 'none';
    statusIndicator.style.display = isDebugMode ? 'none' : 'block';
}

function updateIndicator(color) {
    statusIndicator.style.backgroundColor = color;
    statusIndicator.style.boxShadow = `0 0 8px ${color}`;
}

// Load debug mode preference
chrome.storage.local.get(['debugMode'], (result) => {
    isDebugMode = result.debugMode !== false;
    updateDebugVisibility();
});

chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.debugMode !== undefined) {
        isDebugMode = changes.debugMode.newValue;
        updateDebugVisibility();
    }
});

function logStatus(msg, color = '#0f0') {
    console.log(`[Solver] ${msg}`);
    if (!isDebugMode) return;
    debugBox.style.color = color;
    debugBox.style.borderColor = color;
    debugBox.innerHTML = `> ${msg}`;
    debugBox.style.opacity = '1';
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: Open a port to the background service worker
// ─────────────────────────────────────────────────────────────────────────────
function openProxyPort() {
    return chrome.runtime.connect({ name: 'solver-proxy' });
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. PING — routed through background.js to avoid mixed-content block
// ─────────────────────────────────────────────────────────────────────────────
(function pingServer() {
    const port = openProxyPort();

    port.onMessage.addListener((msg) => {
        if (msg.type === 'ping_ok') {
            logStatus(' Connected to Server', '#0f0');
            updateIndicator('#0f0');
            setTimeout(() => {
                if (debugBox.innerHTML.includes('Connected')) debugBox.style.opacity = '0.5';
            }, 3000);
        } else if (msg.type === 'ping_fail') {
            console.warn('Ping failed:', msg.error);
            logStatus(' Server unreachable (Is Node.js running?)', '#f00');
            updateIndicator('red');
        }
        port.disconnect();
    });

    port.onDisconnect.addListener(() => {
        if (chrome.runtime.lastError) {
            console.warn('Ping port disconnected with error:', chrome.runtime.lastError.message);
            logStatus(' Server unreachable (Is Node.js running?)', '#f00');
            updateIndicator('red');
        }
    });

    port.postMessage({ action: 'ping' });
})();

// ─────────────────────────────────────────────────────────────────────────────
// 2. SHORTCUT LISTENER
// ─────────────────────────────────────────────────────────────────────────────
let activePort = null;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'trigger_solver') {
        runSolver();
        sendResponse({ status: 'received' });
    } else if (request.action === 'stop_solver') {
        if (activePort) {
            logStatus(' Cancelled manually by User.', 'orange');
            updateIndicator('#0f0');
            activePort.postMessage({ action: 'abort' });
            activePort.disconnect();
            activePort = null;
        }
    }
    return true;
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. SOLVER — streams via port from background.js
// ─────────────────────────────────────────────────────────────────────────────
async function runSolver() {
    logStatus(' Shortcut! Sending HTML...', 'yellow');
    updateIndicator('yellow');

    const htmlContent = document.documentElement.outerHTML;

    // Abort any previous solve
    if (activePort) {
        activePort.postMessage({ action: 'abort' });
        activePort.disconnect();
        activePort = null;
    }

    const port = openProxyPort();
    activePort = port;

    // Buffer to handle SSE lines split across chunks
    let lineBuffer = '';

    port.onMessage.addListener((msg) => {
        if (msg.type === 'chunk') {
            // Accumulate and parse SSE lines
            lineBuffer += msg.chunk;
            const lines = lineBuffer.split('\n');
            // Keep the last (possibly incomplete) line in the buffer
            lineBuffer = lines.pop();

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    try {
                        const data = JSON.parse(line.substring(6));
                        handleStreamEvent(data);
                    } catch (e) {
                        console.warn('Could not parse stream line:', line);
                    }
                }
            }

        } else if (msg.type === 'done') {
            // Flush any remaining buffer
            if (lineBuffer.startsWith('data: ')) {
                try {
                    const data = JSON.parse(lineBuffer.substring(6));
                    handleStreamEvent(data);
                } catch (_) { }
            }
            lineBuffer = '';
            activePort = null;

        } else if (msg.type === 'aborted') {
            console.log('[Solver] Fetch aborted.');
            activePort = null;

        } else if (msg.type === 'error') {
            console.error('[Solver] Proxy error:', msg.error);
            logStatus(` Error: ${msg.error}`, 'red');
            updateIndicator('red');
            activePort = null;
        }
    });

    port.onDisconnect.addListener(() => {
        if (chrome.runtime.lastError) {
            console.error('Solve port disconnected unexpectedly:', chrome.runtime.lastError.message);
            logStatus(' Connection to background lost.', 'red');
            updateIndicator('red');
        }
        activePort = null;
    });

    port.postMessage({ action: 'solve', html: htmlContent });
    logStatus(' Awaiting Extraction & Solving...', 'cyan');
}

function handleStreamEvent(data) {
    if (data.status) {
        logStatus(` ${data.status} [${data.progress || ''}]`, 'cyan');
        if (data.progress === 'Step 1/2') updateIndicator('yellow');
        else if (data.progress === 'Step 2/2') updateIndicator('blue');
    }

    if (data.targetId) {
        console.log(`[Solver] Streaming click for Q${data.questionNum}: ${data.targetId}`);
        clickAnswersSlowly([data.targetId]);
    }

    if (data.done) {
        logStatus(' All queries processed.', '#0f0');
        updateIndicator('#0f0');
        setTimeout(() => debugBox.style.opacity = '0.5', 5000);
    }

    if (data.error) {
        logStatus(` Backend Error: ${data.error}`, 'red');
        updateIndicator('red');
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. CLICK HANDLER
// ─────────────────────────────────────────────────────────────────────────────
async function clickAnswersSlowly(targetIds) {
    for (const id of targetIds) {
        const element = document.getElementById(id);
        if (element) {
            const waitTime = Math.floor(Math.random() * 800) + 400;
            await new Promise(r => setTimeout(r, waitTime));

            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            element.click();

            if (isDebugMode) {
                const parent = element.closest('.r0, .r1, div');
                if (parent) {
                    parent.style.transition = "background 0.5s";
                    parent.style.backgroundColor = "rgba(0, 255, 0, 0.2)";
                    parent.style.border = "2px solid lime";
                }
            }
        } else {
            console.warn(`[Solver] Target element ${id} not found in DOM.`);
        }
    }
    logStatus(' All clicks executed.', '#0f0');
    setTimeout(() => debugBox.style.opacity = '0.5', 6000);
}
