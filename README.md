# Quiz Agent

An AI-powered Moodle quiz solver. A local Node.js server receives the raw HTML of a Moodle quiz page from a browser extension, extracts the questions, queries multiple AI models via OpenRouter, and streams the resolved answers back to the extension in real time.

---

## How It Works

1. The browser extension captures the current Moodle quiz page HTML and sends it to the local server.
2. The server parses the HTML and extracts all questions and answer options.
3. An extraction model reads a pre-loaded exam context file (`pruefungskontext.txt`) and identifies which facts are relevant to each question.
4. Three solver models answer each question in parallel. The answer with the majority vote is selected.
5. The resolved answers are streamed back to the extension via Server-Sent Events (SSE), which auto-clicks the correct options.

---

## Project Structure

```
quizAgent/
├── Main/
│   ├── Extention/              # Chrome extension source
│   │   ├── manifest.json
│   │   ├── background.js
│   │   ├── content.js
│   │   ├── popup.html
│   │   └── popup.js
│   ├── lib/
│   │   ├── AiService.js        # OpenRouter API client, model lists, retry logic
│   │   ├── Scraper.js          # HTML parser for Moodle question extraction
│   │   └── Notifier.js         # Desktop notifications
│   ├── server.js               # Main Express server (entry point)
│   ├── rate_limit_req.js       # Utility to check OpenRouter API key status
│   ├── Models.txt              # List of solver model IDs
│   ├── extractor_prompt.txt    # System prompt for the extraction step
│   ├── solver_prompt.txt       # System prompt for the solving step
│   └── pruefungskontext.txt    # Exam context loaded at server startup
├── .env                        # API keys (not committed)
├── package.json
└── README.md
```

---

## Prerequisites

- Node.js 18 or later
- An [OpenRouter](https://openrouter.ai) account with an API key
- Google Chrome (for the browser extension)

---

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

Create a `.env` file in the project root:

```
OPENROUTER_API_KEY=your_openrouter_api_key_here
```

### 3. Add your exam context

Edit `Main/pruefungskontext.txt` and paste the relevant study material or lecture notes. The AI uses this text to answer context-based questions.

### 4. Start the server

```bash
node Main/server.js
```

The server listens on `http://127.0.0.1:3000` by default. The port can be changed via the `PORT` environment variable.

---

## Installing the Browser Extension

1. Open Chrome and navigate to `chrome://extensions`.
2. Enable **Developer mode** in the top right corner.
3. Click **Load unpacked** and select the `Main/Extention` folder.
4. The extension icon will appear in the toolbar.

---

## Usage

1. Start the server (`node Main/server.js`).
2. Open a Moodle quiz page in Chrome.
3. Click the extension icon and press **Solve Quiz**.
4. The extension sends the page HTML to the server and highlights the recommended answers as they stream in.

---

## Configuration

### Solver and Extraction Models

The active AI models are defined in `Main/lib/AiService.js`:

- `SOLVER_MODELS` — three models are queried in parallel per question; the majority vote wins.
- `EXTRACTION_MODELS` — one model reads the full context and maps relevant facts to each question.

The file `Main/Models.txt` is used by the benchmark script to define the candidate pool.

### Prompts

- `Main/extractor_prompt.txt` — controls how the extraction model interprets the context.
- `Main/solver_prompt.txt` — controls the output format expected from solver models.

Both files are read at runtime so changes take effect without restarting the server.

---

## Checking API Key Status

To verify your OpenRouter API key and inspect rate limits:

```bash
node Main/rate_limit_req.js
```

---

## Notes

- The server must be running locally while using the extension. It is bound to `127.0.0.1` intentionally and is not exposed to the network.
- `pruefungskontext.txt` is loaded once on startup. Restart the server after editing it.
- Log output from each session is written to `Main/logs.txt`, which is excluded from version control.
