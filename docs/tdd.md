# Technical Design Document
## «Що? Де? Коли?» — AI-Powered Home Party Game
**Version:** 2.1 | **Updated:** Audio models research — gpt-4o-mini-transcribe replaces whisper-1

---

## 1. Project Overview

Local web app running authentic "Chto? Gde? Kogda?" game.
Host PC runs the app, casts browser to 4K TV via WiFi (Chromecast or local IP).
AI moderator (Voroshilov persona) manages the full game via voice.

**Theme:** Breaking Bad characters as "TV viewers" sending questions.

---

## 2. Tech Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| UI | React 18 + Vite | Plain JSX, no TypeScript |
| Styling | Pure CSS + CSS Variables | No UI libraries |
| AI Moderator | **OpenAI Responses API** (gpt-4o) | Game brain, answer evaluation |
| Knowledge Base | **OpenAI Vector Store** + file_search | Questions + rules stored server-side |
| STT | **gpt-4o-mini-transcribe** | Team answer speech-to-text |
| TTS | **tts-1**, voice: **onyx** | Moderator voice output |
| Mic | Web MediaRecorder API | Built into browser, no cost |
| TV | Chrome Cast Tab / local IP | Zero extra setup |

> ⚠️ **Assistants API is deprecated** (sunset Aug 2026) — NOT used.
> ⚠️ **whisper-1 is legacy** — replaced by gpt-4o-mini-transcribe (cheaper + better).
> ✅ All AI services use a **single OpenAI API key**.

---

## 3. Audio Models Decision

### STT — Speech-to-Text (team answer → text)

| Model | Price/min | Quality | Decision |
|-------|-----------|---------|----------|
| whisper-1 | $0.006 | Good | ❌ Legacy, more expensive |
| **gpt-4o-mini-transcribe** | **$0.003** | **Better** | ✅ **Chosen** |
| gpt-4o-transcribe | $0.006 | Best | ❌ Overkill for party game |

**Chosen: `gpt-4o-mini-transcribe`**
- 2x cheaper than whisper-1 at equal or better quality
- Better Russian/Ukrainian accuracy (GPT-4o family multilingual training)
- API: POST /v1/audio/transcriptions, model: "gpt-4o-mini-transcribe"

### TTS — Text-to-Speech (moderator text → voice)

| Model | Price | Quality | Latency | Decision |
|-------|-------|---------|---------|----------|
| **tts-1** | **$15/1M chars** | Good | **~0.5s** | ✅ **Chosen** |
| tts-1-hd | $30/1M chars | Higher | ~0.5s | ❌ 2x cost, marginal gain |
| gpt-4o-mini-tts | ~$0.015/min | Highest | Slower | ❌ Higher latency for live game |

**Chosen: `tts-1` voice: `onyx`**
- Lowest latency (~0.5s) — critical for live game flow
- onyx = deep authoritative male voice, perfect for Voroshilov
- API: POST /v1/audio/speech, model: "tts-1", voice: "onyx"

---

## 4. Architecture

```
BROWSER (React App)
  ├── UI Components (Roulette, Timer, Score, QuestionCard)
  ├── Game State Machine (React Context)
  │     IDLE → SPINNING → READING → DISCUSSING →
  │     LISTENING → EVALUATING → SCORING → (loop or GAME_OVER)
  │
  ├── Voice Input Pipeline:
  │     MediaRecorder (mic) → audio blob
  │     → POST /v1/audio/transcriptions (gpt-4o-mini-transcribe)
  │     → transcript string
  │
  ├── AI Moderator Service (services/openai.js):
  │     game context → POST /v1/responses (gpt-4o)
  │     ├── instructions: Voroshilov persona
  │     ├── tools: file_search → Vector Store
  │     ├── previous_response_id: game state continuity
  │     └── returns: speech text OR JSON evaluation
  │
  └── Voice Output:
        text → POST /v1/audio/speech (tts-1, onyx)
        → audio blob → Audio() → speakers

All APIs: api.openai.com — single VITE_OPENAI_API_KEY
```

---

## 5. File Structure

```
chto_gde_kogda/
├── .env
├── .env.example
├── .gitignore
├── index.html
├── vite.config.js
├── package.json
├── CLAUDE.md
├── docs/
│   ├── research.md
│   ├── tdd.md                   # this file
│   ├── system-prompt.md         # → upload to Vector Store
│   └── questions.json           # → upload to Vector Store
├── src/
│   ├── main.jsx
│   ├── App.jsx
│   ├── components/
│   │   ├── Roulette.jsx
│   │   ├── Envelopes.jsx
│   │   ├── Timer.jsx
│   │   ├── Scoreboard.jsx
│   │   ├── QuestionCard.jsx
│   │   ├── ModeratorVoice.jsx
│   │   └── Controls.jsx
│   ├── services/
│   │   ├── openai.js            # Responses API — game brain
│   │   ├── transcribe.js        # gpt-4o-mini-transcribe — STT
│   │   ├── tts.js               # tts-1 onyx — voice output
│   │   ├── recorder.js          # MediaRecorder — mic
│   │   └── mock.js              # mock mode for testing
│   ├── game/
│   │   ├── GameContext.jsx      # includes lastResponseId
│   │   ├── gameStateMachine.js
│   │   └── questions.js
│   ├── data/
│   │   ├── questions.json
│   │   └── characters/
│   └── styles/
│       ├── global.css
│       └── animations.css
└── public/
    └── sounds/
```

---

## 6. Game State Machine

```
IDLE
  ↓ [Start]
SPINNING       — wheel animation + волчок sound
  ↓ [Arrow stops]
READING        — openai.readQuestion() → tts.speak() → BB photo shown
  ↓ [TTS finishes]
DISCUSSING     — 60-sec timer + tick music
  ↓ [Timer=0 or E key]
LISTENING      — recorder.start() → mic records team answer
  ↓ [Silence or Enter]
EVALUATING     — transcribe(blob) → openai.evaluateAnswer() → result JSON
  ↓
SCORING        — tts.speak(result) → score updates
  ↓
SPINNING (score < 6) or GAME_OVER (score = 6)
```

---

## 7. OpenAI Responses API (openai.js)

### Endpoint & Auth
```
POST https://api.openai.com/v1/responses
Authorization: Bearer {VITE_OPENAI_API_KEY}
Content-Type: application/json
```

### Request
```json
{
  "model": "gpt-4o",
  "instructions": "<Voroshilov system prompt from system-prompt.md>",
  "input": "<game context as JSON string>",
  "previous_response_id": "<saved from previous round, null on first>",
  "tools": [{ "type": "file_search", "vector_store_ids": ["VITE_VECTOR_STORE_ID"] }]
}
```

### State: save `response.id` → `lastResponseId` in GameContext after every call.

### Three Call Types

**readQuestion(ctx)** — returns plain text for TTS
```json
{ "action": "read_question", "round": 4, "score": {...}, "current_question": {...} }
```

**evaluateAnswer(ctx)** — returns JSON
```json
{ "action": "evaluate_answer", "team_transcript": "Хайзенберг", "current_question": {...} }
→ { "correct": true, "score_delta": 1, "who_scores": "experts", "moderator_phrase": "..." }
```

**commentary(ctx)** — returns plain text for TTS
```json
{ "action": "commentary", "event": "score_update", "score": {...} }
```

---

## 8. STT Service (transcribe.js)

```
POST https://api.openai.com/v1/audio/transcriptions
Authorization: Bearer {VITE_OPENAI_API_KEY}

FormData:
  file: audioBlob (webm/wav from MediaRecorder)
  model: "gpt-4o-mini-transcribe"
  language: "ru"  (or "uk" based on VITE_GAME_LANGUAGE)

Response: { "text": "Хайзенберг" }
```

---

## 9. TTS Service (tts.js)

```
POST https://api.openai.com/v1/audio/speech
Authorization: Bearer {VITE_OPENAI_API_KEY}
Content-Type: application/json

Body:
  model: "tts-1"
  voice: "onyx"
  input: "<moderator speech text>"

Response: audio/mpeg blob → new Audio(URL.createObjectURL(blob)) → play()
```

---

## 10. Vector Store Setup (One-Time Manual Setup)

Do this ONCE before running the app:

1. Go to platform.openai.com → Storage → Vector Stores → **Create**
2. Name: "CHGK Game Knowledge Base"
3. Upload these files:
   - `docs/system-prompt.md` — Voroshilov persona + all game rules
   - `docs/questions.json` — all questions with answers and hints
4. Wait for indexing to complete (green status)
5. Copy the Vector Store ID (format: `vs_...`)
6. Add to `.env`: `VITE_VECTOR_STORE_ID=vs_...`

---

## 11. Question Schema

```json
{
  "id": "bb_01",
  "character": "Walter White",
  "character_image": "walter.jpg",
  "character_video": null,
  "question_ru": "...",
  "question_uk": "...",
  "answer": "Heisenberg",
  "answer_variants": ["Хайзенберг", "Heisenberg"],
  "hint_for_evaluator": "Accept any transliteration of Heisenberg",
  "round_type": "standard",
  "difficulty": "easy"
}
```

`round_type`: `standard` | `blitz` | `super_blitz` | `black_box`

---

## 12. UI Color Palette

```css
--bg-primary: #0a0a0a;        /* near-black studio */
--bg-table: #1a3a1a;          /* dark green baize */
--accent-gold: #c9a84c;       /* gold accents */
--text-primary: #f0ead6;      /* warm cream */
--text-secondary: #9a8a6a;    /* muted gold */
--score-experts: #4a9a4a;     /* green */
--score-viewers: #9a4a4a;     /* red */
--timer-warning: #e85d24;     /* orange last 10 sec */
```

---

## 13. Environment Variables

```bash
# .env — local only, never commit to git
VITE_OPENAI_API_KEY=sk-...          # Single key: Responses + Transcribe + TTS
VITE_VECTOR_STORE_ID=vs_...         # From platform.openai.com/storage/vector-stores
VITE_GAME_LANGUAGE=ru               # "ru" or "uk"
VITE_USE_MOCK=false                 # "true" for UI testing without API calls
```

---

## 14. Cost Per Game Session (~30 min, 10 questions)

| Service | Model | Usage | Cost |
|---------|-------|-------|------|
| AI Moderator | gpt-4o Responses API | ~30 calls | ~$0.10–0.20 |
| Speech-to-Text | gpt-4o-mini-transcribe | ~2.5 min audio | ~$0.008 |
| Text-to-Speech | tts-1 onyx | ~4000 chars | ~$0.001 |
| **Total** | | | **~$0.11–0.21** |

---

## 15. Breaking Bad Character Pool

Walter White, Jesse Pinkman, Saul Goodman, Skyler White,
Hank Schrader, Mike Ehrmantraut, Gustavo Fring, Jane Margolis, Todd Alquist

Mix: ~50% BB trivia + ~50% general knowledge (authentic ЧДК style).
Minimum 13 questions. Recommended 20–25.
