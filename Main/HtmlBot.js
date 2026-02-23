const clipboardy = require('clipboardy');
const fs = require('fs');
const path = require('path');
const { extractQuestionsClipboard } = require('./lib/Scraper');
const { askAiWithRetry } = require('./lib/AiService');
const { notify } = require('./lib/Notifier');

(async () => {
    try {
        const rawHtml = clipboardy.readSync().trim();
        if (!rawHtml || !rawHtml.includes('<')) {
            return console.log(' Clipboard empty or no HTML.');
        }

        console.log(' extracting questions...');
        const questions = extractQuestionsClipboard(rawHtml);

        if (questions.length === 0) {
            console.error(' No questions found in clipboard HTML.');
            return;
        }

        console.log(` ${questions.length} questions extracted.`);

        const cleanQuestionList = questions
            .map(q => `Question ${q.index}: ${q.question}\nOptions: ${q.optionsString}`)
            .join('\n---\n');

        console.log('\n---  QUESTION LIST ---\n', cleanQuestionList, '\n----------------------------------\n');

        // --- LOAD CONTEXT ---
        console.log(' Loading Context...');
        let fullContext = '';
        try {
            const fileContext = fs.readFileSync(path.join(__dirname, 'pruefungskontext.txt'), 'utf-8');
            const context = fs.readFileSync(path.join(__dirname, 'Context.txt'), 'utf-8');
            fullContext = `${context}\n\n${fileContext}`;
            console.log(` Context loaded (${fullContext.length} chars).`);
        } catch (e) {
            console.warn(` Could not load context files: ${e.message}`);
        }

        // --- ASK AI ---
        const solverPrompt = [
            {
                role: 'system',
                content: 'You are an exam assistant. Answer questions based on the context. Format:\nNr X: a\n\nCONTEXT:\n' + fullContext
            },
            { role: 'user', content: cleanQuestionList }
        ];

        const finalAnswer = await askAiWithRetry(solverPrompt);

        if (finalAnswer) {
            clipboardy.writeSync(finalAnswer);
            console.log('\n---  BOT SOLUTION ---');
            console.log(finalAnswer);
            notify(finalAnswer, 'Bot Solution');
            console.log('\n---------------------\n Solution copied to clipboard.');
        } else {
            console.error('\n No solution received from AI.');
        }

    } catch (e) {
        console.error('\n Critical Error:', e.message);
    }
})();
