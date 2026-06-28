# AI Backend Architecture

## Overview

Three distinct AI backends, each with its own toggle. Future subscription tiers will gate access:
- **Tier 1**: Local ML only
- **Tier 2**: Gemini
- **Tier 3**: Claude Haiku

## Settings & Toggles

In `src/store/appStore.tsx`, add three independent settings:

```typescript
settings: {
  broaderAi: boolean,              // Legacy — keep for now, may refactor later
  aiBackend: 'local' | 'gemini' | 'haiku',  // NEW: which backend is active
  // Or use three booleans for explicit tier control:
  localMLEnabled: boolean,
  geminiEnabled: boolean,
  claudeHaikuEnabled: boolean,
}
```

Recommend the three-boolean approach (clearer for future tier gating).

## API Keys

### Google Gemini
1. Go to **https://aistudio.google.com/apikey**
2. Click **"Create API Key"** → select or create a Google Cloud project
3. Copy the key (starts with `AIza...`)
4. Add to `server/.env`:
   ```
   GOOGLE_GEMINI_API_KEY=AIza...
   ```

### Claude Haiku (existing)
Already documented in `server/.env.example`:
```
ANTHROPIC_API_KEY=sk-ant-...
```

## Backend Selection Flow

When the user turns on AI (or selects a tier):

1. **Local ML only** → use `src/engine/featureSuggester.ts` and `src/engine/codeGenerator.ts` with local classifier
   - No API calls, deterministic, free
   - **Endpoint**: none (all in-browser)

2. **Gemini enabled** → call `POST /api/suggest` and `POST /api/generate-feature` with `GOOGLE_GEMINI_API_KEY`
   - Backend routes to Gemini API
   - **Endpoints**: `server/index.js` needs `/api/suggest` and `/api/generate-feature` variants or a model-selection param

3. **Claude Haiku enabled** → call same endpoints but with `ANTHROPIC_API_KEY`
   - Backend routes to Anthropic API
   - **Endpoints**: existing setup in `server/index.js`

## Implementation Tasks

### Backend (`server/index.js`)
- [ ] Read `AI_MODEL` from env, default to `claude-haiku-4-5`
- [ ] Add `GOOGLE_GEMINI_API_KEY` to env
- [ ] Modify `/api/suggest` and `/api/generate-feature` to check which API key is set and route accordingly
  - If `GOOGLE_GEMINI_API_KEY` is set and Gemini is enabled → use Gemini
  - If `ANTHROPIC_API_KEY` is set and Haiku is enabled → use Haiku
  - Otherwise → local only (no API calls, return error or fallback)

### Frontend (`src/`)
- [ ] Add three toggles to settings UI (or a selector: Local / Gemini / Haiku)
- [ ] Store selection in `appStore.tsx` as `settings.aiBackend` or three booleans
- [ ] Pass selected backend to API calls (optional: embed in request body or let backend auto-detect from which key is configured)
- [ ] Update error messages: "Gemini is enabled but no key configured" vs. "Haiku is enabled but no key configured"

### Local ML Expansion
- Ongoing work in `src/engine/classify.ts` and `src/engine/entities.ts`
- Goal: make the local-only tier genuinely useful without API calls
- Current status: basic keywords and entity extraction; can be significantly expanded

## Key Files

| File | Purpose |
|---|---|
| `server/index.js` | Backend routing; reads env keys, decides which API to call |
| `server/.env` | Stores API keys: `ANTHROPIC_API_KEY`, `GOOGLE_GEMINI_API_KEY` |
| `src/store/appStore.tsx` | Settings state: which backend is active |
| `src/services/api.ts` | Frontend API calls; may need model/backend param |
| `src/engine/featureSuggester.ts` | Calls `/api/suggest`; works with any backend |
| `src/engine/codeGenerator.ts` | Calls `/api/generate-feature`; works with any backend |
| `src/ui/FeatureGenerator.tsx` | UI toggle + error states |

## Error States

- **Backend disabled, all keys missing**: Show "Turn on an AI tier to use Evolve"
- **Backend enabled, matching key missing**: Show "Tier enabled but no API key — add to `server/.env` and restart"
- **API error from Gemini/Haiku**: Show error message from backend

## Notes for Future Sessions

- Ollama is **fully removed** (no `localhost:11434` references remain)
- Local ML is the free default and should be kept strong (expand keywords/patterns)
- Three toggles (or backend selector) allow clean tier gating later
- Backend auto-detection (based on which env key exists) keeps config simple
