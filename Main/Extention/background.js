console.log(' Background Service Worker loaded.');

function triggerSolver() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs.length === 0) {
            console.error(' No active tab found.');
            return;
        }

        const activeTab = tabs[0];
        console.log(`Target Tab ID: ${activeTab.id} (${activeTab.url})`);

        chrome.tabs.sendMessage(activeTab.id, { action: 'trigger_solver' }, (response) => {
            if (chrome.runtime.lastError) {
                console.error(' ERROR: Could not reach content.js!', chrome.runtime.lastError.message);
                console.error('   --> Is the page reloaded? Is it a valid URL?');
            } else {
                console.log(' Message sent to content.js.');
            }
        });
    });
}

// 1. Toolbar Button Click
chrome.action.onClicked.addListener((tab) => {
    console.log(' Toolbar button clicked.');
    triggerSolver();
});

// 2. Shortcut
chrome.commands.onCommand.addListener((command) => {
    console.log(` Command received: '${command}'`);
    if (command === 'solve_quiz') {
        triggerSolver();
    } else if (command === 'stop_solver') {
        console.log(' Stop command triggered.');
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs.length > 0) {
                chrome.tabs.sendMessage(tabs[0].id, { action: 'stop_solver' });
            }
        });
    }
});