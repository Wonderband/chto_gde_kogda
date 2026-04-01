# CHGK Game — Claude Code Instructions

## Project Summary
AI-powered "Что? Где? Когда?" home party game app.
Breaking Bad characters play the role of TV viewers sending questions.
One team of guests plays against AI "viewers" — classic ЧДК format, first to 6 points wins.

## Tech Stack
- React 18 + Vite (plain JSX, NO TypeScript)
- Pure CSS with CSS variables (NO Tailwind, NO MUI, NO UI libraries)
- No backend — all API calls via fetch() directly from browser
- API keys loaded from .env via import.meta.env.VITE_*

## AI Services — All OpenAI, Single API Key

### 1. OpenAI Responses API — gpt-4o (AI Moderator / Game Brain)
- Role: Voroshilov persona, reads questions, evaluates answers, game commentary
- This is the CURRENT standard API — NOT Assistants API (deprecated Aug 2025)
- URL: POST https://api.openai.com/v1/responses
- Uses `instructions` parameter for system prompt (moderator persona)
- Uses `previous_response_id` to maintain game state between rounds
- Uses `tools: [{ type: "file_search", vector_store_ids: [...] }]` for knowledge base
- Cost: ~$0.10–0.20 per full game session

### 2. OpenAI STT — gpt-4o-mini-transcribe (Speech-to-Text)
- Role: Converts team's spoken answer to text transcript
- Model: `gpt-4o-mini-transcribe` (NOT whisper-1 — newer, cheaper, better quality)
- URL: POST https://api.openai.com/v1/audio/transcriptions
- Language: set to "ru" (Russian), also supports "uk" (Ukrainian)
- Cost: ~$0.003/min → less than $0.01 per full game
- Why not whisper-1: gpt-4o-mini-transcribe is 2x cheaper ($0.003/min vs $0.006/min)
  and has better accuracy for Slavic languages

### 3. OpenAI TTS — tts-1, voice: onyx (Text-to-Speech)
- Role: Converts moderator text to deep authoritative voice output
- Model: `tts-1` (NOT tts-1-hd — same latency, half the cost, sufficient quality)
- Voice: `onyx` (deep, authoritative male voice — perfect for Voroshilov)
- URL: POST https://api.openai.com/v1/audio/speech
- Cost: $15/1M characters → less than $0.001 per full game
- Why not gpt-4o-mini-tts: higher latency, unnecessary quality for party game

### 4. Web MediaRecorder API (microphone recording)
- Built into browser, no external API, no cost
- Records team answer as audio blob → sent to gpt-4o-mini-transcribe

## Cost Summary per Game Session (~30 min, 10 questions)
| Service | Model | Cost |
|---------|-------|------|
| AI Moderator | gpt-4o Responses API | ~$0.10–0.20 |
| Speech-to-Text | gpt-4o-mini-transcribe | ~$0.01 |
| Text-to-Speech | tts-1 (onyx) | ~$0.001 |
| **Total** | | **~$0.15–0.25** |

## Vector Store (Knowledge Base — one-time setup)
- Created once on platform.openai.com/storage/vector-stores
- Files to upload: docs/system-prompt.md + docs/questions.json
- Vector Store ID stored in .env as VITE_VECTOR_STORE_ID
- Used by gpt-4o via file_search tool during every game call

## Language
Russian primary. Ukrainian also supported.
GPT-4o responds in the same language as the question.
gpt-4o-mini-transcribe language set to "ru" by default, supports "uk".

## Game Format
Classic ЧДК rules:
- One team of guests (знатоки) vs AI-generated "viewer" questions
- First to 6 points wins
- 60-second discussion timer per round
- Special rounds: Blitz (3 questions x 20sec), Super-blitz (one player alone), Black Box
- Moderator persona: Voroshilov — authoritative, ironic, theatrical, voice-only

## File Structure
```
chto_gde_kogda/
├── .env                    # API keys — never commit
├── .env.example            # template
├── .gitignore
├── index.html
├── vite.config.js
├── package.json
├── CLAUDE.md               # this file
├── docs/
│   ├── research.md         # full game research & rules
│   ├── tdd.md              # technical design document
│   ├── system-prompt.md    # AI moderator persona (upload to Vector Store)
│   └── questions.json      # question bank (upload to Vector Store)
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
│   │   ├── openai.js       # Responses API: game logic + answer evaluation
│   │   ├── transcribe.js   # gpt-4o-mini-transcribe: team answer STT
│   │   ├── tts.js          # tts-1 onyx: moderator voice output
│   │   ├── recorder.js     # MediaRecorder: mic capture
│   │   └── mock.js         # mock mode for UI testing without API
│   ├── game/
│   │   ├── GameContext.jsx  # includes lastResponseId for stateful game
│   │   ├── gameStateMachine.js
│   │   └── questions.js
│   ├── data/
│   │   ├── questions.json
│   │   └── characters/     # Breaking Bad images (jpg)
│   └── styles/
│       ├── global.css
│       └── animations.css
└── public/
    └── sounds/
        ├── gong.mp3
        ├── wheel-spin.mp3
        ├── timer-tick.mp3
        └── correct.mp3
```

## Key Service: openai.js (Responses API)
```javascript
// POST https://api.openai.com/v1/responses
// Auth: Authorization: Bearer ${VITE_OPENAI_API_KEY}
{
  model: "gpt-4o",
  instructions: "<full Voroshilov system prompt text>",
  input: JSON.stringify(gameContext),
  previous_response_id: lastResponseId,  // null on first call, saved after each call
  tools: [{ type: "file_search", vector_store_ids: [VITE_VECTOR_STORE_ID] }]
}
// Extract text: data.output_text  OR  data.output[N].content[0].text
// Save state:   lastResponseId = data.id
```

## Key Service: transcribe.js (STT)
```javascript
// POST https://api.openai.com/v1/audio/transcriptions
// model: "gpt-4o-mini-transcribe"  ← NOT whisper-1
// language: "ru"  (or "uk")
// Returns: { text: "команда сказала Хайзенберг" }
```

## Key Service: tts.js (TTS)
```javascript
// POST https://api.openai.com/v1/audio/speech
// model: "tts-1"
// voice: "onyx"
// Returns: audio blob → play via Audio()
```

## Game State Machine
IDLE → SPINNING → READING → DISCUSSING → LISTENING → EVALUATING → SCORING → (SPINNING or GAME_OVER)

## UI Notes
- Dark theme: near-black background, dark green baize table, gold accents
- TV-optimized layout: 1920x1080 reference, large fonts readable from sofa
- Roulette: 13 sectors with envelope icons, CSS spin animation
- Timer: large circular countdown, turns orange at 10 seconds
- Score: "ЗНАТОКИ X : Y ТЕЛЕГЛЯДАЧІ" always visible top bar

## Controls
- Space: Start game
- P: Pause/Resume
- E: Early answer (captain answers before timer ends)
- Enter: Stop recording (team finished answering)
- R: Restart game

## Environment Variables (.env)
VITE_OPENAI_API_KEY=sk-...        # Single key for all OpenAI services
VITE_VECTOR_STORE_ID=vs_...       # From platform.openai.com/storage/vector-stores
VITE_GAME_LANGUAGE=ru             # "ru" or "uk"
VITE_USE_MOCK=false               # "true" to test UI without API calls

## Important Notes
- LOCAL home-use app only — never deployed online
- API keys in .env is acceptable for this use case
- No auth, no database, no server needed
- TV: cast Chrome tab via Chromecast, or open http://192.168.x.x:5173 in TV browser
- Do NOT use Assistants API (deprecated Aug 2025)
- Do NOT use whisper-1 — use gpt-4o-mini-transcribe instead
- Do NOT use Chat Completions — use Responses API only
- Remove VITE_ANTHROPIC_API_KEY from .env if present — not needed
