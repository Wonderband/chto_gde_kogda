# CHGK Game — Claude Code Instructions

## Project Summary
AI-powered "Що? Де? Коли?" home party game app. Breaking Bad Edition.
Breaking Bad characters play TV viewers sending questions.
One team of guests plays against AI "viewers" — first to 6 points wins.
Local app only — runs on host PC, displayed on TV via Chromecast or local IP.

---

## Tech Stack
- React 18 + Vite (plain JSX, NO TypeScript)
- Pure CSS with CSS variables (NO Tailwind, NO MUI, NO UI libraries)
- No backend — all API calls via fetch() directly from browser
- API keys in .env via import.meta.env.VITE_*

---

## AI Services — All OpenAI, Single API Key

### 1. OpenAI Realtime API — gpt-4o-mini-realtime-preview (LIVE MODERATOR VOICE)
- This is the PRIMARY moderator voice — replaces TTS for speaking
- WebRTC-based: browser connects directly, no backend needed
- Two short sessions per round:
  - **Pre-question session** (opened during wheel spin via `onTarget` callback, ~4.5s head-start):
    AI announces sector → introduces Breaking Bad character → small talk → reads question → "Время!" → calls `start_timer()` tool → session closes
  - **Post-answer session** (opened in EVALUATING state after STT captures team answer):
    AI repeats answer → builds logic → reveals correct answer → pronounces verdict → announces score → calls `end_round()` tool → session closes
- Voice: `echo` (Realtime API doesn't have "onyx")
- Tool calling: `start_timer()` signals end of question reading; `end_round(correct, who_scores, correct_answer_reveal)` signals evaluation complete
- Model: `gpt-4o-mini-realtime-preview`
- SDP exchange: POST https://api.openai.com/v1/realtime?model=gpt-4o-mini-realtime-preview
- File: `src/services/realtime.js`

### 2. OpenAI Responses API — gpt-4o (MOCK MODE / FALLBACK ONLY)
- Used ONLY when VITE_USE_MOCK=true
- Was original AI moderator before Realtime API migration
- URL: POST https://api.openai.com/v1/responses
- Uses `previous_response_id` for stateful continuity
- File: `src/services/openai.js`

### 3. OpenAI STT — gpt-4o-mini-transcribe (Speech-to-Text)
- Converts team's spoken answer to text transcript
- ALWAYS used (even in real mode) — Realtime session receives transcript as text input
- Model: `gpt-4o-mini-transcribe` (NOT whisper-1)
- URL: POST https://api.openai.com/v1/audio/transcriptions
- Language: "ru" default, supports "uk"
- File: `src/services/transcribe.js`

### 4. OpenAI TTS — tts-1, voice: onyx (Text-to-Speech)
- Used for: LISTENING state announcement ("Стоп!" / "Досрочный ответ!")
- NOT used for main moderator speech (Realtime handles that)
- Model: `tts-1`, voice: `onyx`
- URL: POST https://api.openai.com/v1/audio/speech
- File: `src/services/tts.js`

### 5. Web MediaRecorder API (microphone)
- Records team answer as audio blob → sent to STT
- File: `src/services/recorder.js`

---

## Game State Machine
```
IDLE → SPINNING → READING → DISCUSSING → LISTENING → EVALUATING → SCORING → READY → (SPINNING or GAME_OVER)
```

**State details (real mode):**
- **SPINNING**: Roulette spins. `onTarget(sector)` fires immediately → opens pre-question Realtime session
- **READING**: Pre-session already speaking (sector → character → question → "Время!"). Session calls `start_timer()` → READING_DONE → DISCUSSING
- **DISCUSSING**: 60s timer (20s for blitz). E=early answer
- **LISTENING**: TTS plays "Стоп!" (onyx). Recording starts. Enter → RECORDING_DONE → EVALUATING
- **EVALUATING**: Post-answer Realtime session opens. Transcript injected. AI evaluates → calls `end_round()` → 2500ms delay → EVALUATION_DONE → SCORING
- **SCORING**: Real mode — no TTS (Realtime already spoke). Immediately SCORING_DONE → score update
- **READY**: Press Space for next round

---

## Blitz Round Logic
- Questions have `round_type: "blitz"`, `blitz_group`, `blitz_position` (1/2/3)
- On SPIN_DONE: all 3 questions from same group loaded; Q1 = currentQuestion, Q2+Q3 = blitzQueue
- Timer = 20s per blitz question
- Correct answer (experts) → next blitz question (no score yet)
- Wrong answer OR final blitz question → score update, clear blitzQueue

---

## File Structure
```
chto_gde_kogda/
├── .env                     # API keys — NEVER commit
├── .env.example
├── .gitignore
├── index.html
├── vite.config.js
├── package.json
├── CLAUDE.md                # this file — always read by Claude
├── docs/
│   ├── research.md
│   ├── tdd.md               # full technical design (keep updated!)
│   ├── system-prompt.md     # Voroshilov persona — uploaded to Vector Store
│   └── questions.json       # question bank — uploaded to Vector Store
├── src/
│   ├── main.jsx
│   ├── App.jsx              # main orchestration, all state effects
│   ├── components/
│   │   ├── Roulette.jsx     # 13-sector SVG wheel; props: spinning, onTarget, onStop, selectedSector
│   │   ├── Timer.jsx        # circular countdown; maxSeconds=60 (standard) or 20 (blitz)
│   │   ├── Scoreboard.jsx
│   │   ├── QuestionCard.jsx # hideText prop: shows dots during READING (no spoilers)
│   │   ├── ModeratorVoice.jsx
│   │   ├── Controls.jsx
│   │   └── Envelopes.jsx
│   ├── services/
│   │   ├── realtime.js      # RealtimeSession class + TOOL_START_TIMER + TOOL_END_ROUND
│   │   │                    # buildPreQuestionInstructions() + buildPostAnswerInstructions()
│   │   ├── openai.js        # buildReadScript(), buildListeningScript(), evaluateAnswer() (mock)
│   │   ├── transcribe.js    # gpt-4o-mini-transcribe STT
│   │   ├── tts.js           # tts-1 onyx TTS
│   │   ├── recorder.js      # MediaRecorder mic capture
│   │   └── mock.js          # mock evaluateAnswer for VITE_USE_MOCK=true
│   ├── game/
│   │   ├── GameContext.jsx  # reducer: all EVENTS, blitzQueue, score, evaluation
│   │   ├── gameStateMachine.js
│   │   └── questions.js
│   ├── data/
│   │   ├── questions.json
│   │   └── characters/      # BB character JPGs (walter, jesse, saul, skyler, hank, mike, gus, todd)
│   └── styles/
│       ├── global.css
│       └── animations.css
└── public/
    ├── system-prompt.txt    # fetched at runtime by openai.js
    ├── characters/          # same BB JPGs (walter, jesse, saul, skyler, hank, mike, gus, todd)
    └── sounds/              # gong.mp3, wheel-spin.mp3, timer-tick.mp3, correct.mp3
```

---

## Key Implementation Details

### RealtimeSession (src/services/realtime.js)
```javascript
const session = new RealtimeSession()
session.onToolCall = (name, args) => { /* name: 'start_timer' | 'end_round' */ }
session.onError = (err) => { /* fallback */ }
await session.open({ apiKey, instructions, tools, voice: 'echo', triggerText })
session.close()  // cleanup: stops WebRTC, removes audio element
```
- VAD disabled (`turn_detection: null`) — app controls turns via text
- 40s safety timeout if AI never calls the expected tool
- Instructions built by: `buildPreQuestionInstructions(systemPrompt, ctx)` and `buildPostAnswerInstructions(systemPrompt, ctx)`

### App.jsx key refs
```javascript
preSessionRef   // RealtimeSession — pre-question (opened in handleRouletteTarget)
postSessionRef  // RealtimeSession — post-answer (opened in EVALUATING effect)
systemPromptRef // string — /system-prompt.txt loaded on mount
```

### Score derivation (important!)
`who_scores` is derived from `args.correct` (NOT from AI's who_scores enum):
```javascript
who_scores: args.correct ? 'experts' : 'viewers'
```
This prevents AI reasoning errors where it says correct score verbally but passes wrong enum.

### sector_number in Realtime instructions
Sector number is embedded directly in ШАГ 1 heading:
`**ШАГ 1 — Объяви сектор ${sector_number}** ... ВАЖНО: произнеси именно число ${sector_number}`
Prevents AI from using wrong number from examples.

---

## Environment Variables (.env)
```
VITE_OPENAI_API_KEY=sk-...        # Single key for all OpenAI services
VITE_VECTOR_STORE_ID=vs_...       # From platform.openai.com/storage/vector-stores
VITE_GAME_LANGUAGE=uk             # "uk" (default) or "ru"
VITE_USE_MOCK=false               # "true" to bypass all API calls (mock mode)
```

---

## Keyboard Controls
- Space: Start game / Next round (from READY state)
- E: Early answer (during DISCUSSING)
- P: Pause/Resume timer (during DISCUSSING)
- Enter: Stop recording (during LISTENING)
- R: Restart (from GAME_OVER)

---

## Git Workflow
- Repo: https://github.com/Wonderband/chto_gde_kogda
- Branch: main
- Commit per task/bugfix — test before committing
- Never commit .env (it's in .gitignore)

---

## Important Rules
- Do NOT use Assistants API (deprecated Aug 2025)
- Do NOT use whisper-1 — use gpt-4o-mini-transcribe
- Do NOT use Chat Completions — use Responses API (mock mode) or Realtime API (live)
- Do NOT use TypeScript — plain JSX only
- Do NOT add UI libraries — pure CSS only
- Do NOT add backend — browser fetch() only

---

## Current State (update after each session)

### ✅ Working
- Roulette SVG with 13 sectors, envelope animation, arrow spin physics
- Game state machine (all states + blitz logic)
- Scoreboard, Timer (60s/20s), QuestionCard (hideText during READING)
- Blitz: 3 separate question objects (bb_q06_1/2/3), each with own hint/answer/variants
- Blitz Q1: announces sector + character; Q2/Q3: skips intro, just "Другий/Третій питання."
- Blitz scoring: `blitz_intermediate` flag — advances without score on correct; applies score on wrong or final
- Blitz mock: MOCK_TRANSCRIPTS include Уїтмен/Флінн/Скайлер so correct-path can be tested
- Realtime API pre-question session (WebRTC, SDP exchange, tool calling)
- Realtime API post-answer session (evaluation ritual + end_round tool)
- Answer reveal order enforced in both text evaluator and realtime: repeat → hint reasoning → answer → verdict
- TTS for LISTENING announcement ("Дострокова відповідь!" / "Час вийшов.")
- STT via gpt-4o-mini-transcribe
- Mock mode (VITE_USE_MOCK=true) fully functional for UI testing
- Ukrainian as primary language throughout (.env VITE_GAME_LANGUAGE=uk, all defaults)
- 12 unique Breaking Bad characters; 4 new: Tuco, Gale, Jane, Flynn (placeholder photos)
- All 14 hint_for_evaluator texts build suspense — answer appears only at end of hint
- **Intro video** (`intro.mp4`): fullscreen overlay on app load, disappears when video ends
- **ANNOUNCING state**: TTS round announcement ("Раунд Перший" etc.) before wheel spins — fires on both START and NEXT_ROUND
- **Gong** (`gong.mp3`): plays after "Увага! Питання!" before question text; plays after segue cue before explanation. Both real and mock modes. Question read split into two Realtime responses (`buildAttentionCuePrompt` + `buildQuestionBodyPrompt`).
- **Black box flow**: intro → "Увага, чорний ящик!" → black_box.mp3 music → warmup dialogue using intro_flavor → player responds → reaction ends "Увага на екран!" → gong → video
- **Pause music** (`pause.mp3`): loops in READY state, stops when Space pressed
- **Final music** (`final.mp3`): loops in GAME_OVER state, stops when R pressed
- All sound files use `src/utils/sounds.js`: `playSound`, `playLooped`, `playGong`, `playBlackBoxMusic`

### 🐛 Known Issues
- Character images for Tuco, Gale, Jane, Flynn are placeholders — need real photos
- Sound integration needs end-to-end test in real mode (mock tested)

### 📋 Next Tasks
- End-to-end test in real mode: verify all sound timings, gong placement, black_box warmup dialogue
- Provide real character photos for tuco.jpg, gale.jpg, jane.jpg, flynn.jpg
