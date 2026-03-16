# Gemini Council

> 4 Gemini AI agents with distinct personas debate your question in real time — inspired by Andrej Karpathy's LLM Council concept.

## What it does

You enter a question and watch 4 agents powered by Google's Gemini API argue across 2 rounds, then a neutral **Council Synthesizer** summarises the debate and gives a final answer.

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
npm run dev
```

Open [http://localhost:5173](http://localhost:5173), enter your Gemini API key and a question, then click **Convene the Council**.

### Build for production

```bash
npm run build
npm run preview
```

---

## Security note

Your API key is stored only in React component state for the lifetime of the browser session — it is never written to `localStorage`, cookies, or any external service.

The Gemini API requires the key as a URL query parameter (`?key=…`), which is the standard authentication method for Google's generative AI REST endpoints.

