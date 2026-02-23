const fs = require('fs');
const path = require('path');
const http = require('http');

console.log('--- STARTING SIMULATED EXTENSION REQUEST ---');

// 1. Die korrekten Lösungen (0-basierter Index)
const EXPECTED_ANSWERS = {
    1: 3,  // d
    2: 2,  // c
    3: 0,  // a
    4: 3,  // d
    5: 2,  // c
    6: 0,  // a
    7: 2,  // c
    8: 1,  // b
    9: 2,  // c
    10: 2, // c
    11: 3, // d
    12: 1  // b
};

const actualAnswers = {};

// 2. Read the Mock HTML
const htmlPath = path.join(__dirname, 'test_exam.html');
const rawHtml = fs.readFileSync(htmlPath, 'utf8');

// 3. Prepare the Payload
const payload = JSON.stringify({ html: rawHtml });

const options = {
    hostname: '127.0.0.1',
    port: 3000,
    path: '/solve',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
    }
};

// 4. Send the Request
const req = http.request(options, (res) => {
    console.log(`STATUS: ${res.statusCode}`);

    res.setEncoding('utf8');

    res.on('data', (chunk) => {
        // The server sends Server-Sent Events (SSE) stream
        // E.g., data: {"status":"Parsing HTML...","progress":"Step 0/2"}
        const lines = chunk.split('\n');
        for (const line of lines) {
            if (line.startsWith('data: ')) {
                try {
                    const data = JSON.parse(line.substring(6));

                    if (data.status) {
                        console.log(`[STATUS] ${data.status} ${data.progress ? '(' + data.progress + ')' : ''}`);
                    }

                    // Server sendet targetId z.B. "q1_3" wenn Option 3 gewählt wurde
                    if (data.targetId) {
                        const qNum = data.questionNum;
                        const chosenIndex = parseInt(data.targetId.split('_')[1]);
                        actualAnswers[qNum] = chosenIndex;
                        console.log(`[ANSWER] Q${qNum} -> Modell wählte Index: ${chosenIndex}`);
                    }

                    if (data.done) {
                        console.log(`\n\n==================================================`);
                        console.log(`--- FINALE AUSWERTUNG ---`);
                        let correctCount = 0;
                        const totalQuestions = Object.keys(EXPECTED_ANSWERS).length;

                        for (let q = 1; q <= totalQuestions; q++) {
                            const expected = EXPECTED_ANSWERS[q];
                            const actual = actualAnswers[q];

                            if (actual === expected) {
                                console.log(`✅ Q${q}: Richtig (Index ${actual})`);
                                correctCount++;
                            } else {
                                console.log(`❌ Q${q}: Falsch! Erwartet: ${expected}, Gewählt: ${actual !== undefined ? actual : 'Keine Antwort'}`);
                            }
                        }

                        const percentage = ((correctCount / totalQuestions) * 100).toFixed(0);
                        console.log(`\n🏆 GESAMTERGEBNIS: ${correctCount} von ${totalQuestions} richtig (${percentage}%)`);
                        console.log(`==================================================\n`);
                        console.log(`[DONE] Processing Finished.`);
                    }

                    if (data.error) {
                        console.error(`[ERROR] ${data.error}`);
                    }
                } catch (e) {
                    // Ignorieren von unvollständigen Chunks in diesem rudimentären Skript
                }
            }
        }
    });

    res.on('end', () => {
        console.log('--- SIMULATED STREAM ENDED ---');
    });
});

req.on('error', (e) => {
    console.error(`Problem with request: ${e.message}`);
});

// Write data to request body
req.write(payload);
req.end();
