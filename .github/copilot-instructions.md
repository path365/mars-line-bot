# Copilot Instructions — mars-line-bot

## Project Overview

LINE Bot deployed on **Vercel** (serverless), using **Google Gemini 2.5 Flash** as the AI backend. The bot implements a **Supervisor → Sub-agents → Synthesizer** multi-agent pattern to handle complex user requests.

## Architecture

```
api/index.js              ← Express app, webhook handler, Vercel entry point
prompts/index.js          ← All prompt templates + feature definitions + Rich Menu actions
scripts/setup-rich-menu.js ← Rich Menu 建立/圖片上傳/設為預設（本地執行）
test-gemini.js            ← Local multi-agent pipeline test (no LINE needed)
list-models.js            ← List available Gemini models
vercel.json               ← Vercel routing & build config
```

- **Single entry point**: `api/index.js` — Express app exported (`module.exports = app`) as a Vercel serverless function.
- **Routing**: All requests (`/.*`) are routed to `api/index.js` via `vercel.json`. The webhook listens on `POST /api/webhook`.
- **Prompt & config centralization**: All prompt templates, feature definitions, and Rich Menu action constants live in `prompts/index.js`. When adding or modifying AI behavior, edit this file — **do NOT inline prompts in `api/index.js`**.
- **No database** — stateless request/response; no conversation history is persisted (yet).

### Multi-Agent Flow (core logic in `handleEvent`)

1. **Supervisor**: Receives user text, prompts Gemini to decompose it into sub-tasks as a JSON array `[{"role": "...", "instruction": "..."}]`. If the task is simple, returns `[]` and falls back to a single Gemini call.
2. **Sub-agents**: Each task runs in parallel via `Promise.all`, with a role-specific prompt built by `buildAgentPrompt()`.
3. **Synthesizer**: Combines all sub-agent outputs into a single coherent reply via `buildSynthesizerPrompt()`.

Fallback: If Supervisor JSON parsing fails or returns empty, the bot sends the raw user message directly to Gemini for a simple response.

### Rich Menu & Postback Handling

- **Rich Menu**: Fixed bottom menu with 3 areas (AI 智能問答 / 功能列表 / 使用說明). Set up via `npm run setup:richmenu`.
- **Postback events**: Handled by `handlePostback()` in `api/index.js`. Action constants defined in `prompts/index.js` as `ACTIONS` object.
- **Adding new menu items**: 1) Add action constant to `ACTIONS` in `prompts/index.js`, 2) Add feature entry to `FEATURE_LIST`, 3) Add `case` branch in `handlePostback()`, 4) Update Rich Menu areas in `scripts/setup-rich-menu.js` and re-run setup.

## Tech Stack & Dependencies

- **Runtime**: Node.js (CommonJS `require` syntax, no ESM)
- **Framework**: Express 4
- **LINE SDK**: `@line/bot-sdk` v8 — uses `line.middleware()` for signature validation and body parsing (do NOT add `express.json()` middleware before it)
- **AI**: `@google/generative-ai` (Gemini) — model: `gemini-2.5-flash`
- **Deployment**: Vercel with `@vercel/node`, max duration 60s

## Environment Variables (required)

| Variable | Purpose |
|---|---|
| `LINE_CHANNEL_ACCESS_TOKEN` | LINE Messaging API token |
| `LINE_CHANNEL_SECRET` | LINE webhook signature verification |
| `GEMINI_API_KEY` | Google Generative AI API key |

Loaded via `dotenv` locally; set in Vercel dashboard for production.

## Developer Workflows

```bash
npm run dev              # Local dev via `vercel dev --yes`
npm run setup:richmenu   # Create/update LINE Rich Menu (requires LINE_CHANNEL_ACCESS_TOKEN)
node test-gemini.js      # Test the multi-agent pipeline locally (no LINE needed)
node list-models.js      # List available Gemini models for the configured API key
```

## Key Conventions

- **Language**: User-facing prompts and error messages are in **Traditional Chinese (繁體中文)**.
- **Prompt management**: All prompt templates live in `prompts/index.js`. Use constants for static prompts (e.g. `SUPERVISOR_PROMPT`) and builder functions for dynamic prompts (e.g. `buildAgentPrompt(role, instruction, userMessage)`).
- **Feature registry**: Available features are listed in `FEATURE_LIST` array in `prompts/index.js`. This is the single source of truth for the "功能列表" response — add new features here.
- **Error handling**: Webhook always returns HTTP 200 to LINE to avoid being flagged as server error, even on failures. Actual errors are logged to `console.error`.
- **LINE verification tokens**: `handleEvent` silently ignores LINE's dummy verification tokens (`000...0` and `fff...f`).
- **Non-text messages**: Silently ignored (only text messages and postback events are processed).
- **No `express.json()` middleware**: `line.middleware(lineConfig)` handles body parsing; adding `express.json()` before it will break signature validation.

## Extending the Bot

The project is actively expanding. When adding new features, follow these patterns:

- **New Rich Menu actions**: Add to `ACTIONS` in `prompts/index.js` → handle in `handlePostback()` → update `scripts/setup-rich-menu.js` areas → re-run `npm run setup:richmenu`.
- **New message types** (image, audio, video): Add handler branches inside `handleEvent` after the text-only guard. Consider creating a `handlers/` directory if complexity grows.
- **Conversation history**: Will require a storage layer (e.g. external DB or Vercel KV). Keep the current stateless path as fallback.
- **New agent roles / tools**: Add prompt templates to `prompts/index.js`; implement tool-calling logic as separate modules.
- **File organization**: As the codebase grows, prefer grouping by concern: `prompts/`, `handlers/`, `scripts/`, `utils/`.
