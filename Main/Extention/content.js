// Configuration
const SERVER_URL = 'http://localhost:3000/solve';
const PING_URL = 'http://localhost:3000/ping';

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
    display: 'none' // hidden until we know debug state
});
debugBox.innerHTML = "[Solver]: Ready (Waiting for Shortcut)";
document.body.appendChild(debugBox);

const statusIndicator = document.createElement('div');
statusIndicator.id = "moodle-solver-indicator";
Object.assign(statusIndicator.style, {
    position: 'fixed', bottom: '10px', left: '10px',
    width: '12px', height: '12px', borderRadius: '50%',
    backgroundColor: 'red', // Default red until connected
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

// Initial fetch
chrome.storage.local.get(['debugMode'], (result) => {
    isDebugMode = result.debugMode !== false;
    updateDebugVisibility();
});

// Listen for settings change
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

// 1. Initial Test: Is Server Alive?
// 1. Initial Test: Is Server Alive?
// 1. Initial Test: Is Server Alive?
fetch(PING_URL, { cache: 'no-store' }) // Disable caching
    .then(async (response) => {
        if (!response.ok) throw new Error(`Status ${response.status}`);
        const data = await response.json();
        if (data.status !== 'alive') throw new Error('Invalid Server Response');

        logStatus(' Connected to Server', '#0f0');
        updateIndicator('#0f0'); // Green
        // Hide after 3 seconds if idle
        setTimeout(() => {
            if (debugBox.innerHTML.includes('Connected')) debugBox.style.opacity = '0.5';
        }, 3000);
    })
    .catch((err) => {
        console.warn('Ping failed:', err);
        logStatus(' Server unreachable (Is Node.js running?)', '#f00');
        updateIndicator('red');
    });


// 2. Listener for Shortcut
let activeController = null;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'trigger_solver') {
        runSolver();
        // Send receipt back to background.js
        sendResponse({ status: 'received' });
    } else if (request.action === 'stop_solver') {
        if (activeController) {
            logStatus(' Cancelled manually by User.', 'orange');
            updateIndicator('#0f0'); // Back to green/ready
            activeController.abort();
            activeController = null;
        }
    }
    return true;
});

async function runSolver() {
    logStatus(' Shortcut! Sending HTML...', 'yellow');
    updateIndicator('yellow');

    // Send the entire DOM to the server
    // The server handles all scraping logic (via Scraper.js)
    const htmlContent = document.documentElement.outerHTML;

    try {
        if (activeController) {
            activeController.abort();
        }
        activeController = new AbortController();

        const response = await fetch(SERVER_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ html: htmlContent }),
            signal: activeController.signal
        });

        if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);

        // Handle Chunked Streaming Response (Server-Sent Events)
        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let isStreamDone = false;

        logStatus(' Awaiting Extraction & Solving...', 'cyan');

        while (!isStreamDone) {
            const { value, done } = await reader.read();
            isStreamDone = done;

            if (value) {
                const chunk = decoder.decode(value, { stream: true });
                const lines = chunk.split('\n');

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        try {
                            const data = JSON.parse(line.substring(6));

                            // Handle Status Updates
                            if (data.status) {
                                logStatus(` ${data.status} [${data.progress || ''}]`, 'cyan');
                                if (data.progress === 'Step 1/2') {
                                    updateIndicator('yellow');
                                } else if (data.progress === 'Step 2/2') {
                                    updateIndicator('blue');
                                }
                            }

                            // Handle Instant Clicks
                            if (data.targetId) {
                                console.log(`[Solver] Streaming click for Q${data.questionNum}: ${data.targetId}`);
                                // Call instantly
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
                        } catch (e) {
                            console.warn('Could not parse stream line:', line);
                        }
                    }
                }
            }
        }

    } catch (err) {
        if (err.name === 'AbortError') {
            console.log('Fetch aborted by user.');
            // Status already set by the message listener
        } else {
            console.error(err);
            logStatus(` Error: ${err.message}`, 'red');
            updateIndicator('red');
        }
    } finally {
        activeController = null;
    }
}

async function clickAnswersSlowly(targetIds) {
    for (const id of targetIds) {
        const element = document.getElementById(id);
        if (element) {
            // Human-like delay
            const waitTime = Math.floor(Math.random() * 800) + 400;
            await new Promise(r => setTimeout(r, waitTime));

            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            element.click();

            if (isDebugMode) {
                // Visual Highlight for successfully clicked items
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

    // Fade out debug box after a while
    setTimeout(() => debugBox.style.opacity = '0.5', 6000);
}
