import { useCallback, useEffect, useRef, useState } from 'react'
import { GameProvider, useGame } from './game/GameContext'
import { STATES, EVENTS } from './game/gameStateMachine'
import Scoreboard from './components/Scoreboard'
import Roulette from './components/Roulette'
import Timer from './components/Timer'
import QuestionCard from './components/QuestionCard'
import ModeratorVoice from './components/ModeratorVoice'
import Controls from './components/Controls'
import { readQuestion, evaluateAnswer, evaluateAnswerFast } from './services/openai'
import {
  RealtimeSession,
  PRE_SESSION_TIMEOUT,
  ANSWER_SESSION_TIMEOUT,
  TOOL_START_QUESTION_READING,
  TOOL_START_TIMER,
  TOOL_VALIDATE_ANSWER,
  TOOL_END_ROUND,
  buildPreQuestionInstructions,
  buildAnswerSessionInstructions,
} from './services/realtime'
import { speak } from './services/tts'

const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true'

// ─── State labels for UI ──────────────────────────────────────────────────────
const STATE_LABELS = {
  [STATES.IDLE]:       null,
  [STATES.SPINNING]:   'Крутимо волчок...',
  [STATES.READING]:    'Ведучий читає питання',
  [STATES.DISCUSSING]: 'Хвилина обговорення!',
  [STATES.LISTENING]:  'Ведучий приймає відповідь...',
  [STATES.EVALUATING]: 'Оцінюємо відповідь...',
  [STATES.SCORING]:    null,
  [STATES.READY]:      null,
  [STATES.GAME_OVER]:  null,
}

function Game() {
  const { state, send } = useGame()
  const { gameState, currentQuestion, score, roundNumber, evaluation, lastResponseId, blitzQueue } = state

  const timerDuration = currentQuestion?.round_type === 'blitz' ? 20 : 60
  const [timerSec, setTimerSec]     = useState(60)
  const [paused, setPaused]         = useState(false)
  const [ttsPlaying, setTtsPlaying] = useState(false)
  const [micLive, setMicLive]       = useState(false)   // true when Realtime session has mic in dialog mode
  const [selectedSector, setSelectedSector] = useState(null)

  useEffect(() => {
    if (gameState === STATES.IDLE) setSelectedSector(null)
  }, [gameState])

  const timerRef             = useRef(null)
  const preSessionRef        = useRef(null)   // Realtime pre-question session
  const postSessionRef       = useRef(null)   // Realtime answer session
  const systemPromptRef      = useRef(null)   // cached /system-prompt.txt
  const selectedSectorRef    = useRef(null)
  const micStreamRef         = useRef(null)   // MediaStream from getUserMedia (mic)
  const validateCallIdRef    = useRef(null)   // callId of pending validate_answer tool call

  useEffect(() => { selectedSectorRef.current = selectedSector }, [selectedSector])

  // Load system prompt once on mount
  useEffect(() => {
    fetch('/system-prompt.txt')
      .then(r => r.ok ? r.text() : '')
      .then(t => { systemPromptRef.current = t })
      .catch(() => { systemPromptRef.current = '' })
  }, [])

  // Request mic permission on first game start (IDLE → SPINNING transition)
  useEffect(() => {
    if (gameState === STATES.SPINNING && !USE_MOCK && !micStreamRef.current) {
      navigator.mediaDevices.getUserMedia({ audio: true, video: false })
        .then(stream => { micStreamRef.current = stream })
        .catch(err => console.warn('[Mic] Permission denied or unavailable:', err))
    }
  }, [gameState])

  // ─── Timer ────────────────────────────────────────────────────────
  useEffect(() => {
    clearInterval(timerRef.current)
    if (gameState === STATES.DISCUSSING && !paused) {
      timerRef.current = setInterval(() => {
        setTimerSec((s) => {
          if (s <= 1) { clearInterval(timerRef.current); send(EVENTS.TIMER_DONE); return 0 }
          return s - 1
        })
      }, 1000)
    }
    return () => clearInterval(timerRef.current)
  }, [gameState, paused])

  useEffect(() => {
    if (gameState === STATES.DISCUSSING) { setTimerSec(timerDuration); setPaused(false) }
  }, [gameState])

  // ─── TTS helper (mock mode only) ─────────────────────────────────
  async function tts(text) {
    setTtsPlaying(true)
    try { await speak(text) }
    finally { setTtsPlaying(false) }
  }

  function buildCtx(extra = {}) {
    return {
      round_number: roundNumber,
      score,
      current_question: currentQuestion ? {
        id: currentQuestion.id,
        character: currentQuestion.character,
        question_text: import.meta.env.VITE_GAME_LANGUAGE === 'uk'
          ? currentQuestion.question_uk
          : currentQuestion.question_ru,
        correct_answer: currentQuestion.answer,
        answer_variants: currentQuestion.answer_variants,
        hint_for_evaluator: currentQuestion.hint_for_evaluator,
        round_type: currentQuestion.round_type,
        blitz_position: currentQuestion.blitz_position,
        blitz_group: currentQuestion.blitz_group,
      } : null,
      sector_number: (selectedSector ?? 0) + 1,
      blitz_queue_remaining: blitzQueue?.length ?? 0,
      game_language: import.meta.env.VITE_GAME_LANGUAGE || 'ru',
      ...extra,
    }
  }

  // ─── Realtime helpers ─────────────────────────────────────────────

  function closePreSession() {
    preSessionRef.current?.close()
    preSessionRef.current = null
  }

  function closePostSession() {
    postSessionRef.current?.close()
    postSessionRef.current = null
    setMicLive(false)
    validateCallIdRef.current = null
  }

  /**
   * Called by Roulette ~4.5 s before the wheel stops.
   * Opens the pre-question Realtime session in DIALOG mode.
   */
  function handleRouletteTarget(target) {
    if (USE_MOCK) return
    const apiKey = import.meta.env.VITE_OPENAI_API_KEY
    if (!apiKey || !systemPromptRef.current) return

    closePreSession()

    const pendingQ  = state.questions[0]
    const sectorNum = target + 1
    let introQ      = pendingQ

    if (pendingQ?.round_type === 'blitz') {
      const pos1 = state.questions.find(
        q => q.blitz_group === pendingQ.blitz_group && q.blitz_position === 1
      )
      if (pos1) introQ = pos1
    }

    const lang   = import.meta.env.VITE_GAME_LANGUAGE || 'ru'
    const preCtx = {
      round_number: roundNumber + 1,
      score,
      current_question: introQ ? {
        id: introQ.id,
        character: introQ.character,
        question_text: lang === 'uk' ? introQ.question_uk : introQ.question_ru,
        correct_answer: introQ.answer,
        round_type: introQ.round_type,
        blitz_position: introQ.blitz_position,
        blitz_group: introQ.blitz_group,
      } : null,
      sector_number: sectorNum,
      blitz_queue_remaining: blitzQueue?.length ?? 0,
      game_language: lang,
      early_answer: false,
    }

    const session = new RealtimeSession({ timeout: PRE_SESSION_TIMEOUT })

    session.onToolCall = (name, _args, callId) => {
      if (name === 'start_question_reading') {
        // Switch to monologue, then tell AI to read the question
        session.setDialogMode(false)
        session.sendToolOutput(callId, 'READ_QUESTION_NOW')
        setMicLive(false)
      } else if (name === 'start_timer') {
        session.sendToolOutput(callId, 'acknowledged')
        send(EVENTS.READING_DONE)
        setTimeout(() => closePreSession(), 800)
      }
    }

    session.onError = (err) => {
      console.error('[Pre-session error]', err.message)
      setMicLive(false)
      closePreSession()
      if (gameState === STATES.READING || gameState === STATES.SPINNING) {
        send(EVENTS.READING_DONE)
      }
    }

    session.open({
      apiKey,
      instructions: buildPreQuestionInstructions(systemPromptRef.current, preCtx),
      tools: [TOOL_START_QUESTION_READING, TOOL_START_TIMER],
      voice: 'echo',
      triggerText: 'НАЧНИ РАУНД',
      micStream: micStreamRef.current,
      dialogMode: true,
    })

    preSessionRef.current = session
    setMicLive(true)
  }

  // ─── State side-effects ───────────────────────────────────────────

  // READING: pre-session already speaking in real mode; TTS in mock mode
  useEffect(() => {
    if (gameState === STATES.READING && currentQuestion) {
      if (!USE_MOCK) return  // pre-session handles it

      let cancelled = false
      ;(async () => {
        try {
          const { text, responseId } = await readQuestion(buildCtx(), lastResponseId)
          if (cancelled) return
          if (responseId) send('SET_LAST_RESPONSE_ID', responseId)
          await tts(text)
        } catch (e) { console.error(e) }
        finally { if (!cancelled) send(EVENTS.READING_DONE) }
      })()
      return () => { cancelled = true }
    }
  }, [gameState, currentQuestion])

  // LISTENING: open answer session (real mode) or TTS+recorder fallback (mock)
  useEffect(() => {
    if (gameState !== STATES.LISTENING) return

    if (!USE_MOCK) {
      const apiKey = import.meta.env.VITE_OPENAI_API_KEY
      if (!apiKey || !systemPromptRef.current) {
        send(EVENTS.RECORDING_DONE, '')
        return
      }

      closePostSession()

      const answerCtx = {
        ...buildCtx({ early_answer: state.earlyAnswer }),
      }

      const session = new RealtimeSession({ timeout: ANSWER_SESSION_TIMEOUT })

      session.onToolCall = (name, args, callId) => {
        if (name === 'validate_answer') {
          // Store callId so EVALUATING effect can send the result back
          validateCallIdRef.current = callId
          // Transition to EVALUATING with the heard answer as transcript
          send(EVENTS.RECORDING_DONE, args.answer || '')
        } else if (name === 'end_round') {
          session.sendToolOutput(callId, 'acknowledged')
          const correct = args.correct ?? false
          setTimeout(() => {
            closePostSession()
            send(EVENTS.EVALUATION_DONE, {
              correct,
              score_delta: 1,
              who_scores: correct ? 'experts' : 'viewers',
              moderator_phrase: '',
              correct_answer_reveal: args.correct_answer_reveal ?? currentQuestion?.answer ?? '?',
            })
          }, 2500)
        }
      }

      session.onError = (err) => {
        console.error('[Answer session error]', err.message)
        closePostSession()
        // If we never got an answer, skip to evaluation with empty transcript
        if (gameState === STATES.LISTENING) {
          send(EVENTS.RECORDING_DONE, '')
        } else {
          send(EVENTS.EVALUATION_DONE, {
            correct: false, score_delta: 1, who_scores: 'viewers',
            moderator_phrase: '',
            correct_answer_reveal: currentQuestion?.answer || '?',
          })
        }
      }

      session.open({
        apiKey,
        instructions: buildAnswerSessionInstructions(systemPromptRef.current, answerCtx),
        tools: [TOOL_VALIDATE_ANSWER, TOOL_END_ROUND],
        voice: 'echo',
        triggerText: 'НАЧНИ ПРИЁМ ОТВЕТА',
        micStream: micStreamRef.current,
        dialogMode: true,
      })

      postSessionRef.current = session
      setMicLive(true)
      return
    }

    // Mock mode: TTS announcement + fake recording
    ;(async () => {
      try {
        const lang   = import.meta.env.VITE_GAME_LANGUAGE || 'ru'
        const script = state.earlyAnswer
          ? (lang === 'uk' ? 'Достроковa відповідь! Пане капітане, слухаємо вас.' : 'Досрочный ответ! Господин капитан, слушаем вас.')
          : (lang === 'uk' ? 'Стоп! Час! Пане капітане, хто відповідає?' : 'Стоп! Время! Господин капитан, кто отвечает?')
        await tts(script)
        setMicLive(true)
      } catch (e) { console.error(e) }
    })()
  }, [gameState])

  // EVALUATING:
  //   real mode — answer session is already open (postSessionRef); send evaluation result to it
  //   mock mode — call mock evaluateAnswer()
  useEffect(() => {
    if (gameState !== STATES.EVALUATING) return

    if (!USE_MOCK) {
      const callId    = validateCallIdRef.current
      const transcript = state.transcript
      const question   = buildCtx().current_question

      if (!callId || !postSessionRef.current) {
        // Fallback if session died before we got here
        send(EVENTS.EVALUATION_DONE, {
          correct: false, score_delta: 1, who_scores: 'viewers',
          moderator_phrase: '',
          correct_answer_reveal: currentQuestion?.answer || '?',
        })
        return
      }

      // Switch to monologue for the ritual, then send evaluation result
      ;(async () => {
        try {
          const result = await evaluateAnswerFast(transcript, question)
          postSessionRef.current?.setDialogMode(false)
          setMicLive(false)
          // sendToolOutput with afterRitual=true → session will call onRitualDone when ritual response.done fires
          postSessionRef.current?.sendToolOutput(callId, JSON.stringify(result), true)
          validateCallIdRef.current = null

          // When the ritual response.done fires, switch back to dialog for post-verdict chat
          postSessionRef.current.onRitualDone = () => {
            postSessionRef.current?.setDialogMode(true)
            setMicLive(true)
          }
        } catch (err) {
          console.error('[evaluateAnswerFast]', err)
          // Fallback evaluation
          const fallback = { correct: false, correct_answer: currentQuestion?.answer || '?' }
          postSessionRef.current?.setDialogMode(false)
          postSessionRef.current?.sendToolOutput(callId, JSON.stringify(fallback), true)
          validateCallIdRef.current = null
        }
      })()
      return
    }

    // Mock mode
    ;(async () => {
      try {
        const { evaluation: result, responseId } = await evaluateAnswer(
          buildCtx({ team_answer_transcript: state.transcript }),
          lastResponseId
        )
        if (responseId) send('SET_LAST_RESPONSE_ID', responseId)
        send(EVENTS.EVALUATION_DONE, result)
      } catch (e) {
        console.error(e)
        send(EVENTS.EVALUATION_DONE, {
          correct: false, score_delta: 1, who_scores: 'viewers',
          moderator_phrase: 'Відповідь не зараховано.',
          correct_answer_reveal: currentQuestion?.answer || '?',
        })
      }
    })()
  }, [gameState])

  // SCORING:
  //   real mode — Realtime already spoke; advance immediately
  //   mock mode — play moderator_phrase then advance
  useEffect(() => {
    if (gameState === STATES.SCORING && evaluation) {
      if (!USE_MOCK) {
        send(EVENTS.SCORING_DONE)
        return
      }
      ;(async () => {
        try { await tts(evaluation.moderator_phrase) }
        catch (e) { console.error(e) }
        finally { send(EVENTS.SCORING_DONE) }
      })()
    }
  }, [gameState, evaluation])

  // Clean up both sessions when game returns to IDLE
  useEffect(() => {
    if (gameState === STATES.IDLE) {
      closePreSession()
      closePostSession()
    }
  }, [gameState])

  // ─── WRAP_UP: stop recording (mock) or end post-verdict dialog (real) ────────
  const doMockStopRecording = useCallback(async () => {
    if (!micLive) return
    setMicLive(false)
    // Mock mode: just send empty transcript to trigger RECORDING_DONE
    send(EVENTS.RECORDING_DONE, '')
  }, [micLive, send])

  const doWrapUp = useCallback(() => {
    if (postSessionRef.current) {
      postSessionRef.current.sendTextMessage('WRAP_UP')
    }
  }, [])

  // ─── Global keyboard handler ──────────────────────────────────────
  const gameStateRef    = useRef(gameState)
  const micLiveRef      = useRef(micLive)
  const doMockStopRef   = useRef(doMockStopRecording)
  const doWrapUpRef     = useRef(doWrapUp)

  useEffect(() => { gameStateRef.current  = gameState },             [gameState])
  useEffect(() => { micLiveRef.current    = micLive },               [micLive])
  useEffect(() => { doMockStopRef.current = doMockStopRecording },   [doMockStopRecording])
  useEffect(() => { doWrapUpRef.current   = doWrapUp },              [doWrapUp])

  useEffect(() => {
    function onKey(e) {
      if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return

      const gs = gameStateRef.current

      switch (e.code) {
        case 'Space':
          e.preventDefault()
          if (gs === STATES.IDLE)       send(EVENTS.START)
          if (gs === STATES.READY)      send(EVENTS.NEXT_ROUND)
          // In EVALUATING: send WRAP_UP to post-session (end post-verdict dialog)
          if (gs === STATES.EVALUATING) doWrapUpRef.current()
          break

        case 'KeyE':
          if (gs === STATES.DISCUSSING) send(EVENTS.EARLY_ANSWER)
          break

        case 'KeyP':
          e.preventDefault()
          if (gs === STATES.DISCUSSING) setPaused((p) => !p)
          break

        case 'Enter':
          e.preventDefault()
          // Mock mode: stop recording
          if (gs === STATES.LISTENING && USE_MOCK && micLiveRef.current) {
            doMockStopRef.current()
          }
          break

        case 'KeyR':
          if (gs === STATES.GAME_OVER) send(EVENTS.RESTART)
          break

        default:
          break
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [send])

  // ─── Derived state for layout ─────────────────────────────────────
  const showRoulette = gameState === STATES.IDLE || gameState === STATES.SPINNING || gameState === STATES.READY
  const showQuestion = [STATES.READING, STATES.DISCUSSING, STATES.LISTENING, STATES.EVALUATING, STATES.SCORING].includes(gameState)
  const showTimer    = gameState === STATES.DISCUSSING
  const stateLabel   = STATE_LABELS[gameState]

  return (
    <div className="app">
      <Scoreboard />
      <div className="gold-line" />

      <div className="game-area felt-bg">

        {/* Top status strip */}
        <div className="status-strip">
          <div className="status-left">
            <ModeratorVoice playing={ttsPlaying} />
            {micLive && (
              <div className="rec-badge">
                <span className="rec-dot rec-blink">●</span> Мікрофон
              </div>
            )}
          </div>
          {paused ? (
            <div className="state-tag pause-tag">⏸ ПАУЗА</div>
          ) : stateLabel && (
            <div className="state-tag slide-down">{stateLabel}</div>
          )}
          <div className="status-right">
            {roundNumber > 0 && (
              <div className="round-counter">Раунд {roundNumber}</div>
            )}
          </div>
        </div>

        {/* ── Single Roulette instance ── */}
        <div style={{ display: showRoulette ? 'flex' : 'none', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: showRoulette ? 1 : 0 }}>

          {gameState === STATES.IDLE && (
            <div className="roulette-overlay-label fade-in">
              <div className="idle-title title-glow">ЩО? ДЕ? КОЛИ?</div>
              <div className="idle-subtitle">Breaking Bad Edition</div>
              <div className="idle-hint-key">Натисніть <kbd>Пробіл</kbd> щоб почати</div>
            </div>
          )}
          {gameState === STATES.SPINNING && (
            <div className="spin-label fade-in">Крутимо волчок!</div>
          )}
          {gameState === STATES.READY && (
            <div className="ready-label fade-in">Натисніть <kbd>Пробіл</kbd> — наступний раунд</div>
          )}

          <Roulette
            spinning={gameState === STATES.SPINNING}
            onTarget={handleRouletteTarget}
            onStop={(sector) => {
              setSelectedSector(sector)
              send(EVENTS.SPIN_DONE)
            }}
            selectedSector={selectedSector}
          />
        </div>

        {/* ── QUESTION screens ── */}
        {showQuestion && (
          <div className="screen-question fade-in">
            <div className="question-layout">
              <QuestionCard
                question={currentQuestion}
                evaluation={gameState === STATES.SCORING ? evaluation : null}
                hideText={gameState === STATES.READING}
              />
              {showTimer && (
                <div className="timer-column">
                  <Timer seconds={timerSec} maxSeconds={timerDuration} paused={paused} />
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── LISTENING hint ── */}
        {gameState === STATES.LISTENING && (
          <div className="listen-overlay fade-in">
            <div className="listen-hint">
              {USE_MOCK
                ? <span>Говоріть відповідь — <kbd>Enter</kbd> щоб зупинити</span>
                : <span>Ведучий слухає відповідь...</span>
              }
            </div>
          </div>
        )}

        {/* ── EVALUATING hint ── */}
        {gameState === STATES.EVALUATING && !USE_MOCK && (
          <div className="listen-overlay fade-in">
            <div className="listen-hint">
              Натисніть <kbd>Пробіл</kbd> коли готові до наступного раунду
            </div>
          </div>
        )}

        {/* ── GAME OVER ── */}
        {gameState === STATES.GAME_OVER && (
          <div className="screen-gameover fade-in-scale">
            <div className={`gameover-title victory-pulse ${state.winner === 'experts' ? 'experts-color' : 'viewers-color'}`}>
              {state.winner === 'experts' ? 'ЗНАТОКИ ПЕРЕМОГЛИ!' : 'ТЕЛЕГЛЯДАЧІ ПЕРЕМОГЛИ!'}
            </div>
            <div className="gameover-score">
              <span className="go-e">{score.experts}</span>
              <span className="go-sep"> : </span>
              <span className="go-v">{score.viewers}</span>
            </div>
            <div className="gameover-motto">Що наше життя? Гра!</div>
            <div className="gameover-hint">Натисніть <kbd>R</kbd> для нової гри</div>
          </div>
        )}
      </div>

      <Controls gameState={gameState} paused={paused} />
      <div className="state-label">{gameState}</div>

      <style>{`
        .game-area {
          flex: 1;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          position: relative;
        }

        /* Status strip */
        .status-strip {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0.55rem 1.5rem;
          border-bottom: 1px solid rgba(201,168,76,0.1);
          min-height: 3rem;
          flex-shrink: 0;
        }
        .status-left, .status-right {
          display: flex;
          align-items: center;
          gap: 0.8rem;
          min-width: 180px;
        }
        .status-right { justify-content: flex-end; }
        .rec-badge {
          display: flex;
          align-items: center;
          gap: 0.3rem;
          font-size: 0.85rem;
          color: var(--timer-warning);
          letter-spacing: 0.05em;
        }
        .rec-dot { font-size: 0.7rem; }
        .state-tag {
          font-size: 0.85rem;
          letter-spacing: 0.15em;
          color: var(--accent-gold);
          text-transform: uppercase;
          opacity: 0.9;
        }
        .pause-tag {
          font-size: 1rem;
          letter-spacing: 0.2em;
          color: var(--timer-warning);
          text-transform: uppercase;
          animation: rec-blink 1.2s ease-in-out infinite;
        }
        .round-counter {
          font-size: 0.8rem;
          color: var(--text-dim);
          letter-spacing: 0.1em;
        }

        /* ── IDLE ── */
        .roulette-overlay-label {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.4rem;
          margin-bottom: 1rem;
          text-align: center;
        }
        .idle-title {
          font-size: var(--font-display);
          color: var(--accent-gold);
          font-family: Georgia, serif;
          letter-spacing: 0.25em;
          font-weight: normal;
        }
        .idle-subtitle {
          font-size: var(--font-label);
          color: var(--text-secondary);
          letter-spacing: 0.1em;
        }
        .idle-hint-key {
          font-size: 0.88rem;
          color: var(--text-secondary);
          letter-spacing: 0.08em;
          margin-top: 0.3rem;
        }
        .idle-hint-key kbd {
          display: inline-block;
          padding: 0.1rem 0.5rem;
          border: 1px solid var(--border-gold-strong);
          border-radius: 4px;
          background: rgba(201,168,76,0.08);
          color: var(--accent-gold);
          font-family: monospace;
          font-size: 0.9em;
        }
        .ready-label {
          font-size: 0.95rem;
          color: var(--accent-gold);
          letter-spacing: 0.12em;
          margin-bottom: 1rem;
          opacity: 0.85;
        }
        .ready-label kbd {
          display: inline-block;
          padding: 0.1rem 0.5rem;
          border: 1px solid var(--border-gold-strong);
          border-radius: 4px;
          background: rgba(201,168,76,0.1);
          color: var(--accent-gold);
          font-family: monospace;
          font-size: 0.9em;
        }

        /* ── SPINNING ── */
        .spin-label {
          font-size: var(--font-title);
          color: var(--accent-gold);
          font-family: Georgia, serif;
          letter-spacing: 0.15em;
        }

        /* ── QUESTION ── */
        .screen-question {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 1.5rem 2rem;
          overflow: hidden;
        }
        .question-layout {
          display: flex;
          gap: 2rem;
          align-items: flex-start;
          max-width: 1100px;
          width: 100%;
        }
        .timer-column {
          flex-shrink: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.8rem;
          padding-top: 1.5rem;
        }

        /* ── LISTENING / EVALUATING overlay ── */
        .listen-overlay {
          position: absolute;
          bottom: 3rem;
          left: 50%;
          transform: translateX(-50%);
        }
        .listen-hint {
          font-size: var(--font-label);
          color: var(--accent-gold);
          letter-spacing: 0.08em;
          text-align: center;
          opacity: 0.8;
        }
        .listen-hint kbd {
          padding: 0.1rem 0.5rem;
          border: 1px solid var(--border-gold);
          border-radius: 4px;
          background: rgba(201,168,76,0.08);
          color: var(--accent-gold);
          font-family: monospace;
        }

        /* ── GAME OVER ── */
        .screen-gameover {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 1.5rem;
          text-align: center;
          padding: 2rem;
        }
        .gameover-title {
          font-size: var(--font-display);
          font-family: Georgia, serif;
          letter-spacing: 0.15em;
        }
        .experts-color { color: var(--score-experts); text-shadow: 0 0 40px rgba(90,184,90,0.5); }
        .viewers-color { color: var(--score-viewers); text-shadow: 0 0 40px rgba(184,90,90,0.5); }
        .gameover-score {
          font-size: clamp(4rem, 8vw, 8rem);
          font-family: Georgia, serif;
          font-weight: bold;
          line-height: 1;
        }
        .go-e { color: var(--score-experts); }
        .go-sep { color: var(--accent-gold); }
        .go-v { color: var(--score-viewers); }
        .gameover-motto {
          font-size: var(--font-title);
          color: var(--accent-gold);
          font-style: italic;
          opacity: 0.8;
        }
        .gameover-hint {
          font-size: var(--font-label);
          color: var(--text-dim);
          letter-spacing: 0.1em;
        }
        .gameover-hint kbd {
          padding: 0.1rem 0.5rem;
          border: 1px solid var(--border-gold);
          border-radius: 4px;
          background: rgba(201,168,76,0.08);
          color: var(--accent-gold);
          font-family: monospace;
        }
      `}</style>
    </div>
  )
}

export default function App() {
  return (
    <GameProvider>
      <Game />
    </GameProvider>
  )
}
