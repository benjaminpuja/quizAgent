const { execFile } = require('child_process');
const os = require('os');

/**
 * Sends a system notification if the platform supports it.
 * On Windows, this is currently a no-op (log only) per user request.
 * 
 * @param {string} message - The message body
 * @param {string} [title='Moodle Bot'] - The notification title
 */
function notify(message, title = 'Moodle Bot') {
    const platform = os.platform();

    // 1. Console Log (Always active)
    console.log(`\n🔔 [NOTIFICATION] ${title}: ${message}\n`);

    // 2. Platform specific handling
    if (platform === 'darwin') {
        // macOS: Use AppleScript
        const flatMessage = (message || '')
            .replace(/\n/g, '  |  ')
            .replace(/\s+/g, ' ')
            .replace(/"/g, "'")
            .trim();
        
        const shortMessage = flatMessage.length > 120
            ? flatMessage.substring(0, 117) + '...'
            : flatMessage;

        const script = `display notification "${shortMessage}" with title "${title}" sound name "Ping"`;

        execFile('/usr/bin/osascript', ['-e', script], (err) => {
            if (err) console.error('❌ Notification Error (macOS):', err);
        });
    } else if (platform === 'win32') {
        // Windows: User requested to SKIP notifications on platform.
        // If we wanted to add it later, we could use 'node-notifier'.
        // console.log("Windows notification skipped."); 
    }
}

module.exports = { notify };
