const cheerio = require('cheerio');

/**
 * Cleans text by removing extra whitespace and newlines.
 */
function cleanText(text) {
    return text ? text.replace(/\s+/g, ' ').trim() : '';
}

/**
 * Ultra clean HTML for AI context (removes scripts, styles, tags).
 */
function ultraCleanHtml(html) {
    return html
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Extracts questions from full HTML page (Cheerio method).
 * Best for Server mode where we have the full DOM structure.
 * 
 * @param {string} html - The raw HTML of the quiz page
 * @returns {Array} Array of question objects { number, question, options: [{index, id, text}] }
 */
function extractQuestionsServer(html) {
    const $ = cheerio.load(html);
    const extractedQuestions = [];

    // Moodle Class: .que
    $('.que').each((index, element) => {
        const qText = cleanText($(element).find('.qtext').text());
        const options = [];

        // Search inputs (Radio/Checkbox)
        $(element).find('input[type="radio"], input[type="checkbox"]').each((i, input) => {
            const inputId = $(input).attr('id');

            // Try to find label (either via 'for' attribute or parent)
            let labelText = cleanText($(element).find(`label[for="${inputId}"]`).text());
            if (!labelText) {
                labelText = cleanText($(input).closest('.r0, .r1, div').text());
            }

            if (inputId) {
                options.push({
                    index: i,
                    id: inputId,
                    text: labelText
                });
            }
        });

        if (options.length > 0) {
            extractedQuestions.push({
                number: index + 1,
                question: qText,
                options: options
            });
        }
    });

    return extractedQuestions;
}

/**
 * Extracts questions from Clipboard HTML snippets (String manipulation/Regex).
 * Best for Clipboard mode where HTML might be partial or broken.
 * 
 * @param {string} rawHtml - HTML content
 * @returns {Array} Array of simplified question objects { index, question, optionsString }
 */
function extractQuestionsClipboard(rawHtml) {
    // Split by ID anchor or fallback to class
    let blocks = rawHtml.split('id="question-').slice(1);

    if (blocks.length === 0) {
        blocks = rawHtml.split('class="que ').slice(1);
    }

    if (blocks.length === 0) {
        return [];
    }

    return blocks.map((block, i) => {
        const qMatch = block.match(/<div class="qtext">([\s\S]*?)<\/div>/i);
        const qText = ultraCleanHtml(qMatch ? qMatch[1] : "Frage nicht gefunden (Parse Error)");

        // Find options
        const optionMatches = [...block.matchAll(/<div[^>]*class="flex-fill[^>]*>([\s\S]*?)<\/div>/gi)];
        let options = optionMatches.map(m => ultraCleanHtml(m[1]));

        if (options.length === 0) {
            // Fallback for labels
            const labelMatches = [...block.matchAll(/<label[^>]*>([\s\S]*?)<\/label>/gi)];
            options = labelMatches.map(m => ultraCleanHtml(m[1]));
        }

        // Clean up and format
        options = [...new Set(options)].filter(opt => opt.length > 0 && !opt.includes('Clear my choice'));
        const formattedOptions = options.map((opt, idx) => `${String.fromCharCode(97 + idx)}. ${opt}`);

        return {
            index: i + 1,
            question: qText,
            optionsString: formattedOptions.join(' ')
        };
    });
}

module.exports = {
    extractQuestionsServer,
    extractQuestionsClipboard,
    cleanText,
    ultraCleanHtml
};
