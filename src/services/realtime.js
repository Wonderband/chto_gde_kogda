/**
 * OpenAI Realtime API — WebRTC live moderator sessions
 *
 * Two session types per round:
 *
 * 1. Pre-question (opens during wheel spin via onTarget, ~4.5s head-start)
 *    Starts in DIALOG mode (VAD=server_vad, mic live):
 *      AI: sector → character intro → small talk with players
 *      AI calls start_question_reading() → app switches to MONOLOGUE (VAD=null)
 *      AI: reads question verbatim → "Время!" → start_timer() → session closes
 *
 * 2. Answer session (opens when DISCUSSING timer ends)
 *    Starts in DIALOG mode (mic live):
 *      AI: "Время! Кто отвечает?" → hears players → clarifies if needed
 *      AI calls validate_answer({ answer }) → app calls text evaluator → returns result
 *      App switches to MONOLOGUE, sends evaluation result as tool output
 *      AI: evaluation ritual (repeat answer → logic → reveal → verdict → score)
 *      App switches back to DIALOG — post-verdict small talk
 *      Host sends "WRAP_UP" → AI calls end_round() → session closes
 *
 * Model: gpt-4o-mini-realtime-preview
 * Voice: echo
 *
 * VAD control: app calls session.setDialogMode(true/false) at key moments.
 * Tool output: app MUST call session.sendToolOutput(callId, output) for every tool call.
 */

const MODEL         = 'gpt-4o-mini-realtime-preview'
const RT_URL        = `https://api.openai.com/v1/realtime?model=${MODEL}`

export const PRE_SESSION_TIMEOUT    = 120_000  // ms — pre-question session max (dialog ~60s + reading ~30s)
export const ANSWER_SESSION_TIMEOUT = 300_000  // ms — answer session max (dialog is long)

// ─── Tool definitions ─────────────────────────────────────────────────────────

export const TOOL_START_QUESTION_READING = {
  type: 'function',
  name: 'start_question_reading',
  description:
    'Call IMMEDIATELY after saying "Внимание! Вопрос!" (RU) or "Увага! Питання!" (UK) ' +
    'to signal you are done with small talk and ready to read the question. ' +
    'The system will switch to monologue mode and send READ_QUESTION_NOW.',
  parameters: { type: 'object', properties: {}, required: [] },
}

export const TOOL_START_TIMER = {
  type: 'function',
  name: 'start_timer',
  description:
    'Call IMMEDIATELY after saying "Время! Минута обсуждения!" (RU) ' +
    'or "Час! Хвилина обговорення!" (UK). ' +
    'This signals the end of question reading and starts the team\'s discussion timer.',
  parameters: { type: 'object', properties: {}, required: [] },
}

export const TOOL_VALIDATE_ANSWER = {
  type: 'function',
  name: 'validate_answer',
  description:
    'Call ONLY when you have a clear, unambiguous answer from the team. ' +
    'If the answer is vague, ask one clarifying question first. ' +
    'The system will evaluate it and return the verdict.',
  parameters: {
    type: 'object',
    properties: {
      answer: {
        type: 'string',
        description: "The team's final answer as clearly stated",
      },
    },
    required: ['answer'],
  },
}

export const TOOL_END_ROUND = {
  type: 'function',
  name: 'end_round',
  description:
    'Call after completing the full evaluation ritual AND the post-verdict small talk. ' +
    'Only call when you receive the "WRAP_UP" signal from the host.',
  parameters: {
    type: 'object',
    properties: {
      correct: {
        type: 'boolean',
        description: "Whether the team's answer was correct",
      },
      who_scores: {
        type: 'string',
        enum: ['experts', 'viewers'],
        description: 'Which side earns a point',
      },
      correct_answer_reveal: {
        type: 'string',
        description: 'The correct answer, phrased naturally (shown on screen)',
      },
    },
    required: ['correct', 'who_scores', 'correct_answer_reveal'],
  },
}

// ─── Instruction builders ─────────────────────────────────────────────────────

/**
 * Pre-question session instructions.
 * Phase 0 (dialog): sector → character → small talk → start_question_reading()
 * Phase 1 (monologue, after READ_QUESTION_NOW received): question → start_timer()
 */
export function buildPreQuestionInstructions(systemPrompt, gameContext) {
  const isRu = gameContext.game_language !== 'uk'
  const q    = gameContext.current_question || {}
  const pos  = q.blitz_position || 1

  const blitzPosLabel = isRu
    ? (['Первый', 'Второй', 'Третий'][pos - 1] || `${pos}-й`)
    : (['Перший', 'Другий', 'Третій'][pos - 1]  || `${pos}-е`)

  const questionAnnounce = q.round_type === 'blitz'
    ? (pos === 1
        ? (isRu
            ? 'Объяви блиц: «Сектор Блиц! Три вопроса. Три телезрителя. Двадцять секунд на каждый.» Затем: «Внимание! Первый вопрос!»'
            : 'Оголоси бліц: «Сектор Бліц! Три питання. Три телеглядачі. Двадцять секунд на кожне.» Потім: «Увага! Перше питання!»')
        : (isRu
            ? `«Внимание! ${blitzPosLabel} вопрос!»`
            : `«Увага! ${blitzPosLabel} питання!»`))
    : (isRu ? '«Внимание! Вопрос!»' : '«Увага! Питання!»')

  const timerPhrase = q.round_type === 'blitz'
    ? (isRu ? '«Время! Двадцать секунд!»' : '«Час! Двадцять секунд!»')
    : (isRu ? '«Время! Минута обсуждения!»' : '«Час! Хвилина обговорення!»')

  return `${systemPrompt}

---

## ТЕКУЩАЯ ЗАДАЧА — НАЧАЛО РАУНДА

Ты находишься в ДИАЛОГОВОМ РЕЖИМЕ — микрофон игроков включён, можешь их слышать и говорить с ними.

### ФАЗА 0 — ДИАЛОГ (выполнять сейчас)

**ШАГ 1 — Объяви сектор ${gameContext.sector_number}:**
ВАЖНО: произнеси именно число ${gameContext.sector_number}.

**ШАГ 2 — Представь телезрителя:**
Персонаж: ${q.character || 'Неизвестный'}

**ШАГ 3 — Небольшой разговор с игроками** (1-2 реплики):
Задай короткий вопрос, связанный с темой или персонажем. Выслушай ответ. Прокомментируй.
НЕ раскрывай текст вопроса и правильный ответ!

**ШАГ 4 — Объяви переход к вопросу:**
${questionAnnounce}
Сразу после этих слов — вызови start_question_reading(). НЕ читай вопрос до ответа системы.

### ФАЗА 1 — МОНОЛОГ (после получения сообщения READ_QUESTION_NOW)

Система переключит режим. Когда получишь READ_QUESTION_NOW — выполни:

**ШАГ 5 — Прочитай вопрос ДОСЛОВНО** (без изменений, без комментариев):
«${q.question_text || ''}»

**ШАГ 6 — Запусти таймер:**
Скажи ${timerPhrase} — и НЕМЕДЛЕННО вызови start_timer().
После вызова start_timer() — замолчи.

---

Контекст игры:
\`\`\`json
${JSON.stringify(gameContext, null, 2)}
\`\`\`
`
}

/**
 * Answer session instructions.
 * Phase 0 (dialog): "Время! Кто отвечает?" → hear answer → validate_answer()
 * Phase 1 (monologue, after validation result received): full evaluation ritual
 * Phase 2 (dialog again): post-verdict small talk → WRAP_UP → end_round()
 */
export function buildAnswerSessionInstructions(systemPrompt, gameContext) {
  const isRu = gameContext.game_language !== 'uk'
  const q    = gameContext.current_question || {}

  const timeUpPhrase   = isRu ? '«Время! Кто отвечает?»' : '«Час! Хто відповідає?»'
  const acceptedPhrase = isRu ? '«Ваш ответ принят.»' : '«Вашу відповідь прийнято.»'
  const revealPhrase   = isRu ? 'Правильный ответ —' : 'Правильна відповідь —'

  return `${systemPrompt}

---

## ТЕКУЩАЯ ЗАДАЧА — ПРИНЯТЬ ОТВЕТ И ПРОВЕСТИ ОЦЕНКУ

Ты находишься в ДИАЛОГОВОМ РЕЖИМЕ — микрофон игроков включён.

### ФАЗА 0 — ПРИНЯТЬ ОТВЕТ (диалог, выполнять сейчас)

**ШАГ 1 — Объяви конец времени:**
Скажи: ${timeUpPhrase}

**ШАГ 2 — Прими ответ:**
- Выслушай, кто отвечает. Поприветствуй его.
- Выслушай ответ. Если ответ нечёткий — переспроси ОДИН РАЗ: «Точнее?» или «Что именно?»
- Когда ответ ясен — скажи: ${acceptedPhrase}
- Вызови validate_answer({ answer: "текст ответа" })

Можешь также:
- Потребовать тишины в зале, если нужно
- Повторить вопрос один раз, если тебя попросят

### ФАЗА 1 — РИТУАЛ ОЦЕНКИ (монолог, после получения результата от validate_answer)

Система переключит в монолог. Выполни строго по порядку:

**ШАГ 3 — Повтори ответ знатоков:**
${isRu ? '«Знатоки отвечают:' : '«Знавці відповідають:'} "[ответ из ШАГ 2]"»

**ШАГ 4 — Построй логику** (2-4 предложения). НЕ произноси вердикт. Создай напряжение.

**ШАГ 5 — Назови правильный ответ:**
«${revealPhrase} [correct_answer из результата validate_answer]»

**ШАГ 6 — Вердикт:**
${isRu ? '«Верно!» или «К сожалению, нет.»' : '«Вірно!» або «На жаль, ні.»'} — с паузой перед ним.

**ШАГ 7 — Объяви счёт:**
Текущий: Знатоки ${gameContext.score.experts} — Телезрители ${gameContext.score.viewers}.
Прибавь очко нужной стороне и произнеси новый счёт вслух.

### ФАЗА 2 — ПОСТВЕРDICT ДИАЛОГ (диалог восстановится автоматически)

Пообщайся с игроками. Обсуди вопрос. Реагируй на эмоции.

Когда получишь сообщение "WRAP_UP" — скажи финальную фразу и вызови end_round().

---

Контекст игры:
\`\`\`json
${JSON.stringify(gameContext, null, 2)}
\`\`\`
`
}

// ─── RealtimeSession ──────────────────────────────────────────────────────────

export class RealtimeSession {
  /**
   * @param {{ timeout?: number }} opts
   */
  constructor({ timeout = PRE_SESSION_TIMEOUT } = {}) {
    this._pc          = null
    this._dc          = null
    this._audioEl     = null
    this._closed      = false
    this._timeoutMs   = timeout
    this._timeout     = null
    this._afterRitual = false   // true after validate_answer result is sent → track response.done

    /** (name: string, args: object, callId: string) => void */
    this.onToolCall    = null
    /** (error: Error) => void */
    this.onError       = null
    /** () => void — fires after AI response.done following evaluate result (ritual complete) */
    this.onRitualDone  = null
  }

  /**
   * Open a WebRTC Realtime session.
   * @param {{ apiKey, instructions, tools, voice, triggerText, micStream, dialogMode }} opts
   *   micStream  — MediaStream with mic track (required for dialog mode)
   *   dialogMode — start in VAD=server_vad (default: false)
   */
  async open({ apiKey, instructions, tools = [], voice = 'echo', triggerText = 'START', micStream = null, dialogMode = false }) {
    if (this._closed) return

    try {
      this._pc = new RTCPeerConnection()

      // Hidden audio element for AI voice output
      this._audioEl = document.createElement('audio')
      this._audioEl.autoplay = true
      document.body.appendChild(this._audioEl)
      this._pc.ontrack = (e) => {
        if (e.streams?.[0]) this._audioEl.srcObject = e.streams[0]
      }

      if (micStream) {
        // sendrecv — we send mic audio AND receive AI audio
        this._pc.addTransceiver('audio', { direction: 'sendrecv' })
        micStream.getAudioTracks().forEach(track => this._pc.addTrack(track, micStream))
      } else {
        // recvonly — only receive AI audio
        this._pc.addTransceiver('audio', { direction: 'recvonly' })
      }

      this._dc = this._pc.createDataChannel('oai-events')
      this._dc.onopen    = () => this._configure(instructions, tools, voice, triggerText, dialogMode)
      this._dc.onmessage = (e) => { try { this._onEvent(JSON.parse(e.data)) } catch {} }
      this._dc.onerror   = () => this._handleError(new Error('DataChannel error'))

      const offer = await this._pc.createOffer()
      await this._pc.setLocalDescription(offer)

      const res = await fetch(RT_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/sdp',
        },
        body: offer.sdp,
      })

      if (!res.ok) {
        const err = await res.text()
        throw new Error(`Realtime SDP ${res.status}: ${err}`)
      }

      await this._pc.setRemoteDescription({ type: 'answer', sdp: await res.text() })

      this._timeout = setTimeout(() => {
        this._handleError(new Error('RealtimeSession: safety timeout'))
      }, this._timeoutMs)

    } catch (err) {
      this._handleError(err)
    }
  }

  // ── Public methods ───────────────────────────────────────────────────────────

  /**
   * Switch between dialog mode (VAD=server_vad) and monologue mode (VAD=null).
   */
  setDialogMode(enabled) {
    this._send({
      type: 'session.update',
      session: {
        turn_detection: enabled ? { type: 'server_vad' } : null,
      },
    })
  }

  /**
   * Send a tool call result back to the AI.
   * App MUST call this for every tool invocation.
   * @param {string}  callId       — from onToolCall's third argument
   * @param {string}  output       — result string (use JSON.stringify for structured data)
   * @param {boolean} afterRitual  — if true, the next response.done fires onRitualDone
   */
  sendToolOutput(callId, output, afterRitual = false) {
    if (afterRitual) this._afterRitual = true
    this._send({
      type: 'conversation.item.create',
      item: { type: 'function_call_output', call_id: callId, output },
    })
    this._send({ type: 'response.create' })
  }

  /**
   * Send a user text message to the session and request a response.
   * Used for triggers like 'READ_QUESTION_NOW' and 'WRAP_UP'.
   */
  sendTextMessage(text) {
    this._send({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text }],
      },
    })
    this._send({ type: 'response.create' })
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  _configure(instructions, tools, voice, triggerText, dialogMode) {
    if (this._closed || this._dc?.readyState !== 'open') return

    this._send({
      type: 'session.update',
      session: {
        instructions,
        voice,
        tools,
        tool_choice: 'auto',
        turn_detection: dialogMode ? { type: 'server_vad' } : null,
        modalities: ['text', 'audio'],
        ...(dialogMode ? { input_audio_transcription: { model: 'gpt-4o-mini-transcribe' } } : {}),
      },
    })

    // Initial trigger message
    this._send({
      type: 'conversation.item.create',
      item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: triggerText }] },
    })
    this._send({ type: 'response.create' })
  }

  _onEvent(event) {
    if (this._closed) return

    if (event.type === 'response.function_call_arguments.done') {
      const name = event.name
      let args = {}
      try { args = JSON.parse(event.arguments || '{}') } catch {}

      // App is responsible for calling sendToolOutput(callId, output)
      if (typeof this.onToolCall === 'function') {
        this.onToolCall(name, args, event.call_id)
      }
    }

    if (event.type === 'response.done') {
      if (this._afterRitual) {
        this._afterRitual = false
        if (typeof this.onRitualDone === 'function') this.onRitualDone()
      }
    }

    if (event.type === 'error') {
      console.error('[RealtimeSession] API error:', event.error)
      this._handleError(new Error(event.error?.message || 'Realtime API error'))
    }
  }

  _handleError(err) {
    if (this._closed) return
    console.error('[RealtimeSession]', err.message)
    if (typeof this.onError === 'function') this.onError(err)
    this.close()
  }

  _send(data) {
    if (this._dc?.readyState === 'open') {
      this._dc.send(JSON.stringify(data))
    }
  }

  close() {
    if (this._closed) return
    this._closed = true
    clearTimeout(this._timeout)
    try {
      this._dc?.close()
      this._pc?.close()
      if (this._audioEl) {
        this._audioEl.srcObject = null
        this._audioEl.remove()
      }
    } catch {}
    this._pc = null
    this._dc = null
    this._audioEl = null
  }
}
