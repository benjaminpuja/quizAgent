document.addEventListener('DOMContentLoaded', () => {
    const debugToggle = document.getElementById('debugToggle');

    // Load saved settings
    chrome.storage.local.get(['debugMode'], (result) => {
        debugToggle.checked = result.debugMode !== false; // Default to true if not set
    });

    // Save on change
    debugToggle.addEventListener('change', () => {
        chrome.storage.local.set({ debugMode: debugToggle.checked }, () => {
            console.log('Debug mode set to: ' + debugToggle.checked);
        });
    });
});
