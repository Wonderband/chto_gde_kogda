# Technical Design Document
## «Що? Де? Коли?» — AI-Powered Home Party Game (Breaking Bad Edition)
**Version:** 3.0 | **Updated:** Realtime API architecture + bug fixes

---

## 1. Project Overview

Local web app running authentic "Chto? Gde? Kogda?" game.
Host PC runs the app, casts browser to 4K TV via WiFi (Chromecast or local IP).
AI moderator (Voroshilov persona) manages the full game via live voice.

**Theme:** Breaking Bad characters as "TV viewers" sending questions.
**Stack:** React 18 + Vite, Pure CSS, no backend, single OpenAI API key.

---

## 2. Tech Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| UI | React 18 + Vite | Plain JSX, no TypeScript |
| Styling | Pure CSS + CSS Variables | No UI libraries |
| Live Moderator Voice | **OpenAI Realtime API** (gpt-4o-mini-realtime-preview) | WebRTC, tool calling |
| Answer Evaluation (mock) | **OpenAI Responses API** (gpt-4o) | Used only in VITE_USE_MOCK=true |
| STT | **gpt-4o-mini-transcribe** | Team answer speech-to-text |
| TTS | **tts-1**, voice: **onyx** | LISTENING announcement only |
| Mic | Web MediaRecorder API | Built into browser |
| TV | Chrome Cast Tab / local IP | Zero extra setup |

> ⚠️ **Assistants API** — deprecated, NOT used.
> ⚠️ **whisper-1** — legacy, replaced by gpt-4o-mini-transcribe.
> ⚠️ **Chat Completions** — NOT used. Use Responses API (mock) or Realtime API (live).
> ✅ All services use a **single OpenAI API key**.

---

## 3. Architecture Overview

```
BROWSER (React App)
  │
  ├── UI Layer
  │     Roulette (SVG, 13 sectors) · Timer · Scoreboard · QuestionCard
  │
  ├── Game State Machine (GameContext.jsx + gameStateMachine.js)
  │     IDLE → SPINNING → READING → DISCUSSING → LISTENING
  │          → EVALUATING → SCORING → READY → (loop or GAME_OVER)
  │
  ├── Realtime Moderator (services/realtime.js)   ← PRIMARY AI path
  │     WebRTC connection to gpt-4o-mini-realtime-preview
  │     Session 1 (Pre-question): opened during wheel SPIN via onTarget()
  │       AI: sector → character → small talk → question → "Время!" → start_timer()
  │     Session 2 (Post-answer): opened in EVALUATING after STT
  │       AI: repeat answer → logic → correct answer → verdict → score → end_round()
  │
  ├── Voice Input Pipeline
  │     MediaRecorder (mic) → audio blob
  │       → POST /v1/audio/transcriptions (gpt-4o-mini-transcribe)
  │       → transcript string → injected into Realtime session
  │
  ├── TTS (services/tts.js)                       ← LIMITED use
  │     Only for: LISTENING announcement ("Стоп!" / "Досрочный ответ!")
  │       → POST /v1/audio/speech (tts-1, onyx)
  │
  └── Mock Mode (VITE_USE_MOCK=true)              ← testing only
        Responses API (gpt-4o) for evaluation
        buildReadScript() for local TTS question reading
```

---

## 4. Realtime API — Core Architecture

### Why Realtime API?
The original architecture (TTS for every phrase) had a 3-7 second gap between wheel stopping and moderator starting to speak. Realtime API solves this by:
1. Pre-warming the session **during the spin** (4.5s head-start via `onTarget`)
2. AI speaks live with ~1.7s latency, no TTS pipeline needed
3. Tool calling (`start_timer`, `end_round`) signals game state transitions precisely

### Session 1 — Pre-Question
```
onTarget(sector) fired in Roulette
  → new RealtimeSession()
  → SDP exchange with api.openai.com/v1/realtime?model=gpt-4o-mini-realtime-preview
  → session.update: instructions = buildPreQuestionInstructions(systemPrompt, ctx)
  → conversation.item.create: { role: 'user', text: 'PRE_QUESTION_START' }
  → response.create
  → AI speaks: sector N → character → small talk → question → "Время!"
  → AI calls start_timer() tool
  → onToolCall('start_timer') → send(READING_DONE) immediately
                              → closePreSession() after 800ms (audio drain)
```

### Session 2 — Post-Answer
```
gameState = EVALUATING
  → new RealtimeSession()
  → SDP exchange
  → session.update: instructions = buildPostAnswerInstructions(systemPrompt, ctx)
    (ctx includes team_answer_transcript from STT)
  → conversation.item.create: { role: 'user', text: 'POST_ANSWER_START' }
  → response.create
  → AI speaks: repeat answer → logic → correct answer → verdict → score
  → AI calls end_round({ correct, who_scores, correct_answer_reveal })
  → onToolCall('end_round', args) → wait 2500ms (audio drain)
                                 → closePostSession()
                                 → send(EVALUATION_DONE, { correct, who_scores: correct ? 'experts' : 'viewers', ... })
```

### Tool Definitions
```javascript
TOOL_START_TIMER = {
  type: 'function', name: 'start_timer',
  description: 'Call IMMEDIATELY after saying "Время! Минута обсуждения!"',
  parameters: { type: 'object', properties: {}, required: [] }
}

TOOL_END_ROUND = {
  type: 'function', name: 'end_round',
  description: 'Call AFTER completing the full evaluation ritual.',
  parameters: {
    correct: boolean,
    who_scores: 'experts' | 'viewers',
    correct_answer_reveal: string
  }
}
```

### Safety Mechanism
- 40s timeout on each session → fires `onError` → fallback to `send(READING_DONE)` or `send(EVALUATION_DONE)`
- Pre-session `onError` in App.jsx: `send(EVENTS.READING_DONE)` to unblock game
- Post-session `onError`: `send(EVALUATION_DONE, { correct: false, who_scores: 'viewers', ... })`

---

## 5. Game State Machine

```
IDLE
  ↓ [Space]
SPINNING       onTarget(sector) → opens pre-question Realtime session (parallel)
  ↓ [Arrow stops → SPIN_DONE]
READING        Pre-session already speaking. READING_DONE fired by start_timer() tool
  ↓ [READING_DONE]
DISCUSSING     60s timer (20s for blitz). E=early answer → LISTENING
  ↓ [TIMER_DONE or EARLY_ANSWER]
LISTENING      TTS "Стоп!" via tts-1/onyx. MediaRecorder starts.
  ↓ [Enter → RECORDING_DONE]
EVALUATING     STT transcript ready. Post-answer Realtime session opens.
  ↓ [end_round tool called → EVALUATION_DONE]
SCORING        Real mode: no TTS (Realtime spoke). Immediately SCORING_DONE.
  ↓ [SCORING_DONE]
READY          Score updated. Space → next round.
  ↓ [Space → NEXT_ROUND]
SPINNING       (loop until score = 6)
  ↓ [score >= 6]
GAME_OVER      R → IDLE
```

---

## 6. Blitz Round Logic

Questions with `round_type: 'blitz'` come in groups of 3 sharing a `blitz_group` ID and `blitz_position` (1/2/3).

```
SPIN_DONE:
  - Detect blitz_group
  - Load all 3 questions from same group
  - currentQuestion = Q1 (blitz_position: 1)
  - blitzQueue = [Q2, Q3]
  - Remove all 3 from questions pool

SCORING_DONE:
  - if blitzQueue.length > 0 AND who_scores === 'experts':
      → pop Q2 from blitzQueue → READING (no score update yet)
  - else (wrong OR final blitz question):
      → score update → clear blitzQueue → READY

Timer: 20s for blitz (60s standard)
```

---

## 7. Instruction Builders (services/realtime.js)

### buildPreQuestionInstructions(systemPrompt, gameContext)
6-step instructions prepended to systemPrompt:
1. **Announce sector N** — sector number embedded in heading to prevent AI using wrong number
2. **Introduce character** — Breaking Bad character name/city
3. **Short thematic touch** — 1-2 sentences related to question topic
4. **Announce question type** — "Внимание! Вопрос!" / "Сектор Блиц!"
5. **Read question verbatim** — exact question_text, no changes
6. **Start timer** — "Время! Минута обсуждения!" → call start_timer()

### buildPostAnswerInstructions(systemPrompt, gameContext)
Starts at step 2 (step 1 "Стоп!" handled by TTS — no double voice):
1. **Repeat answer** — "Знатоки отвечают: '[transcript]'"
2. **Build logic** — 2-4 sentences, NO verdict yet, create tension
3. **Reveal correct answer** — "Правильный ответ — [answer]"
4. **Verdict** — "Верно!" / "К сожалению, нет."
5. **Announce score** — current + 1 for winner
6. **Call end_round()** — mandatory final step

---

## 8. Score Derivation (Important)

```javascript
// In App.jsx EVALUATING effect onToolCall:
const correct = args.correct ?? false
send(EVENTS.EVALUATION_DONE, {
  correct,
  who_scores: correct ? 'experts' : 'viewers',  // ← derived from correct, NOT args.who_scores
  ...
})
```

**Why:** AI verbally says correct score (e.g. 1:1) but can pass wrong `who_scores` enum in tool call. Deriving from `correct` boolean ensures score display matches verbal announcement.

---

## 9. Services Summary

### services/realtime.js
- `RealtimeSession` class — WebRTC lifecycle management
- `TOOL_START_TIMER`, `TOOL_END_ROUND` — tool definitions
- `buildPreQuestionInstructions(systemPrompt, ctx)` — pre-question instructions
- `buildPostAnswerInstructions(systemPrompt, ctx)` — post-answer instructions

### services/openai.js
- `buildReadScript(ctx)` — local TTS script (no API call) for mock mode
- `buildListeningScript(earlyAnswer, lang)` — "Стоп!" / "Досрочный ответ!" text
- `readQuestion(ctx, prevId)` — wraps buildReadScript, returns { text, responseId }
- `evaluateAnswer(ctx, prevId)` — calls Responses API (mock only)
- `callOpenAI(ctx, prevId)` — Responses API call with file_search

### services/transcribe.js
```
POST https://api.openai.com/v1/audio/transcriptions
model: gpt-4o-mini-transcribe
language: ru (or uk)
→ { text: "team answer" }
```

### services/tts.js
```
POST https://api.openai.com/v1/audio/speech
model: tts-1, voice: onyx
→ audio blob → Audio() → play()
```

### services/recorder.js
- `startRecording()` → MediaRecorder → returns recorder ref
- `stopRecording(recorder)` → returns audio blob

### services/mock.js
- `mockEvaluateAnswer(ctx)` — returns fake evaluation JSON, handles blitz

---

## 10. App.jsx Architecture

Key refs:
```javascript
preSessionRef   // current RealtimeSession (pre-question), null when closed
postSessionRef  // current RealtimeSession (post-answer), null when closed
systemPromptRef // string — /system-prompt.txt loaded on mount
timerRef        // setInterval handle for DISCUSSING timer
recorderRef     // MediaRecorder reference
```

Key functions:
```javascript
handleRouletteTarget(target)  // onTarget callback from Roulette — opens pre-session
closePreSession()             // cleans up preSessionRef
closePostSession()            // cleans up postSessionRef
buildCtx(extra)               // assembles gameContext object for API calls
tts(text)                     // wraps speak() with ttsPlaying state
```

State effects (useEffect):
- READING: real mode → no-op (pre-session running); mock → TTS buildReadScript
- LISTENING: TTS "Стоп!" → startRecording
- EVALUATING: real mode → open post-session; mock → evaluateAnswer()
- SCORING: real mode → immediately SCORING_DONE; mock → TTS moderator_phrase → SCORING_DONE
- IDLE: close both sessions (cleanup)

---

## 11. Question Schema

```json
{
  "id": "bb_01",
  "character": "Walter White",
  "character_image": "walter.jpg",
  "question_ru": "...",
  "question_uk": "...",
  "answer": "Heisenberg",
  "answer_variants": ["Хайзенберг", "Heisenberg"],
  "hint_for_evaluator": "Accept any transliteration of Heisenberg",
  "round_type": "standard",
  "difficulty": "easy",
  "blitz_group": null,
  "blitz_position": null
}
```

Blitz question:
```json
{
  "round_type": "blitz",
  "blitz_group": "blitz_chemistry_01",
  "blitz_position": 1
}
```

---

## 12. Environment Variables

```bash
VITE_OPENAI_API_KEY=sk-...        # Single key: Realtime + Responses + STT + TTS
VITE_VECTOR_STORE_ID=vs_...       # platform.openai.com/storage/vector-stores
VITE_GAME_LANGUAGE=ru             # "ru" or "uk"
VITE_USE_MOCK=false               # "true" → bypass all Realtime/Responses API
```

---

## 13. Cost Per Game Session (~30 min, 10 rounds)

| Service | Model | Est. Usage | Cost |
|---------|-------|-----------|------|
| Live Moderator | gpt-4o-mini-realtime-preview | ~20 sessions × ~45s audio | ~$0.30–0.50 |
| Speech-to-Text | gpt-4o-mini-transcribe | ~2.5 min audio | ~$0.008 |
| TTS (announcements) | tts-1 onyx | ~500 chars | ~$0.00001 |
| **Total** | | | **~$0.31–0.51** |

---

## 14. UI Design

```css
--bg-primary: #0a0a0a;        /* near-black studio */
--accent-gold: #c9a84c;       /* gold accents */
--text-primary: #f0ead6;      /* warm cream */
--score-experts: #4a9a4a;     /* green */
--score-viewers: #9a4a4a;     /* red */
--timer-warning: #e85d24;     /* orange at 10 sec */
```

- Dark theme, 1920×1080 reference, large fonts readable from sofa
- Roulette: 13 sectors, SVG, only red arrow spins (CSS transform)
- Timer: large circular countdown component
- Scoreboard: always visible top bar

---

## 15. Breaking Bad Characters

Walter White (Albuquerque), Jesse Pinkman (Albuquerque), Saul Goodman (Albuquerque),
Skyler White (Albuquerque), Hank Schrader (Albuquerque), Mike Ehrmantraut (Philadelphia),
Gustavo Fring (Santiago → Albuquerque), Todd Alquist (Albuquerque)

Jane Margolis: image missing (graceful fallback in QuestionCard)

---

## 16. Git & Development Workflow

- Repo: https://github.com/Wonderband/chto_gde_kogda
- Branch: main
- One task = one branch or direct commit to main (small project)
- Test before committing
- Never commit `.env`

---

## 17. Known Issues & Bug History

### Fixed (deployed, needs re-testing)
| # | Bug | Root Cause | Fix Applied |
|---|-----|-----------|-------------|
| 1 | Sector number wrong | AI ignoring dynamic context | Sector N embedded in ШАГ 1 heading text |
| 2 | Audio cut off mid-phrase | session.close() removed audio element too early | 800ms delay before closePreSession; 2500ms before closePostSession |
| 3 | Double "Стоп!" voice | TTS + Realtime both announced end of discussion | Removed ШАГ 1 from buildPostAnswerInstructions |
| 4 | Wrong score display | AI passes wrong who_scores enum | Derive who_scores from args.correct (not enum) |
| 5 | Game stuck on win | App.jsx sent GAME_OVER event, reducer had no handler | Always send SCORING_DONE; reducer handles game-over internally |
| 6 | Blitz: only 1 question | SPIN_DONE didn't load full blitz group | Load all 3 at SPIN_DONE, queue remaining in blitzQueue |

### Open / To Investigate
- Architecture review pending — user wants to reassess overall approach
- Re-test all 4 recent fixes after deployment
