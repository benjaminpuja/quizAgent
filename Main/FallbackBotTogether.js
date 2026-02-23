const clipboardy = require('clipboardy');
const fs = require('fs');
const path = require('path');
const { askAiWithRetry } = require('./lib/AiService');
const { notify } = require('./lib/Notifier');

(async () => {
    const userText = clipboardy.readSync().trim();
    if (!userText) return console.log(' Clipboard is empty.');

    // --- LOAD CONTEXT ---
    let fullContext = '';
    try {
        const fileContext = fs.readFileSync(path.join(__dirname, 'pruefungskontext.txt'), 'utf-8');
        const context = fs.readFileSync(path.join(__dirname, 'Context.txt'), 'utf-8');
        fullContext = `${context}\n\n${fileContext}`;
    } catch (e) {
        console.warn(` Could not load context files: ${e.message}`);
    }

    // --- ASK AI ---
    // This bot seems to be a general purpose fallback that takes whatever is in the clipboard
    // and asks the AI about it using the exam context.
    const messages = [
        {
            role: 'system',
            content: 'Answer all questions exclusively based on the following exam context:\n\n' +
                fullContext +
                '\n Question:',
        },
        {
            role: 'user',
            content: userText
        },
    ];

    const answer = await askAiWithRetry(messages);

    if (answer) {
        clipboardy.writeSync(answer);
        console.log(' Answer copied to clipboard.');
        notify(answer, 'LLM Answer');
    } else {
        console.error(' No answer received.');
        notify('No answer received', 'LLM Error');
    }
})();
