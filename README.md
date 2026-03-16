# Gemini Council

> 4 Gemini AI agents with distinct personas debate your question in real time — inspired by Andrej Karpathy's LLM Council concept.

## What it does

You enter a question and watch 4 agents powered by Google's Gemini API argue across 2 rounds, then a neutral **Council Synthesizer** summarises the debate and gives a final answer.

The app uses the official JavaScript SDK: `@google/genai`.

| Agent | Color | Role |
|---|---|---|
| **The Critic** | 🔴 Red | Challenges assumptions, finds flaws |
| **The Optimist** | 🟢 Green | Finds opportunities, constructive framing |
| **The Analyst** | 🔵 Blue | Data-driven, logical, structured |
| **The Devil's Advocate** | 🟡 Amber | Deliberately argues the opposite |

**Flow:** Round 1 → Round 2 (agents react to each other) → Synthesis

---

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org/) ≥ 18
- A [Google Gemini API key](https://aistudio.google.com/app/apikey)

### Run locally

```bash
npm install
```

Create your environment file before opening the app:

```bash
cp .env.example .env
# then edit .env and set VITE_GEMINI_API_KEY
npm run dev
```

Windows PowerShell:

```powershell
Copy-Item .env.example .env
# then edit .env and set VITE_GEMINI_API_KEY
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173), ask your question, then click **Convene council**.

## New chat UX

- Chat-style thread inspired by modern AI products (clean message bubbles, clear hierarchy, minimal chrome)
- Inline **Thinking** button on assistant messages to reveal/hide highlighted reasoning text
- Live status line while models are generating responses

### Build for production

```bash
npm run build
npm run preview
```

---

## Security note

Your API key is read from `VITE_GEMINI_API_KEY` in `.env` and injected by Vite at build/runtime.

Do not commit real `.env` files. This project ignores them by default and includes `.env.example` as a safe template.

Requests are sent through the official `@google/genai` SDK in the browser.

