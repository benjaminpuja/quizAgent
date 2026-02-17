console.log("🤖 Background Service Worker wurde geladen.");

chrome.commands.onCommand.addListener((command) => {
    console.log(`⌨️ Command empfangen: "${command}"`);

    if (command === "solve_quiz") {
        chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
            if (tabs.length === 0) {
                console.error("❌ Kein aktiver Tab gefunden.");
                return;
            }

            const activeTab = tabs[0];
            console.log(`Target Tab ID: ${activeTab.id} (${activeTab.url})`);

            chrome.tabs.sendMessage(activeTab.id, { action: "trigger_solver" }, (response) => {
                if (chrome.runtime.lastError) {
                    console.error("❌ FEHLER: Konnte content.js nicht erreichen!", chrome.runtime.lastError.message);
                    console.error("   --> Ist die Seite neu geladen? Ist es eine erlaubte URL?");
                } else {
                    console.log("✅ Nachricht erfolgreich an content.js gesendet.");
                }
            });
        });
    }
});