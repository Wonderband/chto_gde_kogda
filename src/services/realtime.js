/**
 * OpenAI Realtime API — WebRTC live moderator sessions
 *
 * Two session types per round:
 *   1. Pre-question  — opened during wheel spin (onTarget), 4.5 s head-start
 *      AI: sector → character intro → small talk → reads question → "Время!" → start_timer()
 *   2. Post-answer   — opened in EVALUATING state, after STT captures team transcript
 *      AI: 6-step evaluation ritual → end_round(correct, who_scores, correct_answer_reveal)
 *
 * Model: gpt-4o-mini-realtime-preview
 * Voice: echo  (deep, authoritative; Realtime API doesn't have "onyx")
 *
 * No microphone needed — we use recvonly audio + text data-channel input.
 */

const MODEL         = 'gpt-4o-mini-realtime-preview'
const RT_URL        = `https://api.openai.com/v1/realtime?model=${MODEL}`
export const SESSION_TIMEOUT = 40_000   // ms — fallback if AI never calls the tool

// ─── Tool definitions ─────────────────────────────────────────────────────────

export const TOOL_START_TIMER = {
  type: 'function',
  name: 'start_timer',
  description:
    'Call IMMEDIATELY after saying "Время! Минута обсуждения!" (RU) ' +
    'or "Час! Хвилина обговорення!" (UK). ' +
    'This signals the end of question reading and starts the team\'s timer.',
  parameters: { type: 'object', properties: {}, required: [] },
}

export const TOOL_END_ROUND = {
  type: 'function',
  name: 'end_round',
  description:
    'Call AFTER completing the full evaluation ritual — after announcing ' +
    'the correct answer AND the updated score. Do NOT call before the verdict.',
  parameters: {
    type: 'object',
    properties: {
      correct: {
        type: 'boolean',
        description: "Whether the team's answer is correct",
      },
      who_scores: {
        type: 'string',
        enum: ['experts', 'viewers'],
        description: 'Which side earns a point this round',
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
 * Instructions for the pre-question Realtime session.
 * Covers Phases 1–4+5 of the scenario: sector → character → small talk → question → timer.
 */
export function buildPreQuestionInstructions(systemPrompt, gameContext) {
  const isRu = gameContext.game_language !== 'uk'
  const q    = gameContext.current_question || {}
  const pos  = q.blitz_position || 1

  const blitzPosLabel = isRu
    ? (['Первый', 'Второй', 'Третий'][pos - 1] || `${pos}-й`)
    : (['Перший', 'Другий', 'Третій'][pos - 1]  || `${pos}-е`)

  const step4 = q.round_type === 'blitz'
    ? (pos === 1
        ? (isRu
            ? 'Объяви блиц: «Сектор Блиц! Три вопроса. Три телезрителя. Двадцять секунд на каждый.» Затем: «Внимание! Первый вопрос!»'
            : 'Оголоси бліц: «Сектор Бліц! Три питання. Три телеглядачі. Двадцять секунд на кожне.» Потім: «Увага! Перше питання!»')
        : (isRu
            ? `«Внимание! ${blitzPosLabel} вопрос!»`
            : `«Увага! ${blitzPosLabel} питання!»`))
    : (isRu ? '«Внимание! Вопрос!»' : '«Увага! Питання!»')

  const step6 = q.round_type === 'blitz'
    ? (isRu
        ? 'Скажи: «Время! Двадцать секунд!» — и НЕМЕДЛЕННО вызови start_timer().'
        : 'Скажи: «Час! Двадцять секунд!» — і НЕГАЙНО викличи start_timer().')
    : (isRu
        ? 'Скажи: «Время! Минута обсуждения!» — и НЕМЕДЛЕННО вызови start_timer().'
        : 'Скажи: «Час! Хвилина обговорення!» — і НЕГАЙНО викличи start_timer().')

  return `${systemPrompt}

---

## ТЕКУЩАЯ ЗАДАЧА — НАЧАЛО РАУНДА (Фазы 1–4)

Выполни ВСЕ шаги строго по порядку. Не останавливайся, не жди реакции.

**ШАГ 1 — Объяви сектор ${gameContext.sector_number}** (ветка A/B/C/D на выбор; замени [N] строго на ${gameContext.sector_number}):
ВАЖНО: произнеси именно число ${gameContext.sector_number} — не любое другое.

**ШАГ 2 — Представь телезрителя** (Фаза 2 сценария):
Персонаж: ${q.character || 'Неизвестный'}

**ШАГ 3 — Один короткий тематический штрих** (Фаза 3, не более 1–2 фраз).

**ШАГ 4 — Объяви вопрос:**
${step4}

**ШАГ 5 — Прочитай вопрос ДОСЛОВНО** (без изменений, без комментариев):
«${q.question_text || ''}»

**ШАГ 6 — Запусти таймер:**
${step6}

После вызова start_timer() — замолчи. Не произноси ничего.

---

Контекст игры (только для справки):
\`\`\`json
${JSON.stringify(gameContext, null, 2)}
\`\`\`
`
}

/**
 * Instructions for the post-answer Realtime session.
 * Covers Phase 7: full 6-step evaluation ritual → end_round().
 */
export function buildPostAnswerInstructions(systemPrompt, gameContext) {
  const isRu       = gameContext.game_language !== 'uk'
  const q          = gameContext.current_question || {}
  const transcript = gameContext.team_answer_transcript || ''
  const earlyAns   = gameContext.early_answer

  const step1 = earlyAns
    ? (isRu
        ? '«Досрочный ответ. Господин капитан, слушаем вас.»'
        : '«Дострокова відповідь. Пане капітане, слухаємо вас.»')
    : (isRu
        ? '«Стоп. Время вышло.» (или вариант: «Минута прошла.»)'
        : '«Стоп. Час вийшов.»')

  const step2 = transcript
    ? (isRu
        ? `Повтори ответ: «Знатоки отвечают: "${transcript}".»`
        : `Повтори відповідь: «Знавці кажуть: "${transcript}".»`)
    : (isRu ? '(Ответ не записан — скажи: «Ответ не прозвучал.»)'
             : '(Відповіді не було — скажи: «Відповіді не прозвучало.»)')

  return `${systemPrompt}

---

## ТЕКУЩАЯ ЗАДАЧА — ОЦЕНКА ОТВЕТА (Фаза 7)

Ведущий уже объявил конец обсуждения — начинай сразу с оценки ответа.
Выполни ВСЕ шаги строго по порядку. Не останавливайся.

**ШАГ 1 — Повтори ответ знатоков:**
${step2}

**ШАГ 2 — Выстрой логику** (2–4 предложения, НЕ произноси вердикт).
Используй тему вопроса. Создай напряжение.

**ШАГ 3 — Назови правильный ответ:**
${isRu ? '«Правильный ответ —' : '«Правильна відповідь —'} ${q.correct_answer || '?'}»

**ШАГ 4 — Произнеси вердикт** (Фаза 7 сценария):
«Верно!» или «К сожалению, нет.» — с характерной паузой перед ним.

**ШАГ 5 — Объяви счёт:**
Текущий: Знатоки ${gameContext.score.experts} — Телезрители ${gameContext.score.viewers}.
${isRu
  ? 'Прибавь очко нужной стороне и произнеси новый счёт вслух.'
  : 'Додай очко потрібній стороні та оголоси новий рахунок.'}

**ШАГ 6 — Вызови end_round()** с правильными аргументами. Это обязательный последний шаг.

После вызова end_round() — замолчи.

---

Контекст игры:
\`\`\`json
${JSON.stringify(gameContext, null, 2)}
\`\`\`
`
}

// ─── RealtimeSession ──────────────────────────────────────────────────────────

export class RealtimeSession {
  constructor() {
    this._pc      = null
    this._dc      = null
    this._audioEl = null
    this._closed  = false
    this._timeout = null

    /** (name: string, args: object) => void  — called when AI invokes a tool */
    this.onToolCall = null
    /** (error: Error) => void  — called on fatal error / timeout */
    this.onError    = null
  }

  /**
   * Open a WebRTC Realtime session.
   * @param {{ apiKey, instructions, tools, voice, triggerText }} opts
   */
  async open({ apiKey, instructions, tools = [], voice = 'echo', triggerText = 'START' }) {
    if (this._closed) return

    try {
      // RTCPeerConnection
      this._pc = new RTCPeerConnection()

      // Hidden audio element for AI voice output
      this._audioEl = document.createElement('audio')
      this._audioEl.autoplay = true
      document.body.appendChild(this._audioEl)
      this._pc.ontrack = (e) => {
        if (e.streams?.[0]) this._audioEl.srcObject = e.streams[0]
      }

      // recvonly transceiver — we receive AI audio, no mic needed
      this._pc.addTransceiver('audio', { direction: 'recvonly' })

      // Data channel for messages / events
      this._dc = this._pc.createDataChannel('oai-events')
      this._dc.onopen    = () => this._configure(instructions, tools, voice, triggerText)
      this._dc.onmessage = (e) => { try { this._onEvent(JSON.parse(e.data)) } catch {} }
      this._dc.onerror   = () => this._handleError(new Error('DataChannel error'))

      // Create SDP offer
      const offer = await this._pc.createOffer()
      await this._pc.setLocalDescription(offer)

      // Exchange SDP with OpenAI Realtime
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

      // Safety timeout — fire onError if AI never calls the expected tool
      this._timeout = setTimeout(() => {
        this._handleError(new Error('RealtimeSession: safety timeout'))
      }, SESSION_TIMEOUT)

    } catch (err) {
      this._handleError(err)
    }
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  _configure(instructions, tools, voice, triggerText) {
    if (this._closed || this._dc?.readyState !== 'open') return

    // Update session settings
    this._send({
      type: 'session.update',
      session: {
        instructions,
        voice,
        tools,
        tool_choice: 'auto',
        turn_detection: null,          // disable VAD — we control turns via text
        modalities: ['text', 'audio'],
      },
    })

    // Inject trigger message → AI starts speaking immediately
    this._send({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: triggerText }],
      },
    })

    // Request AI response
    this._send({ type: 'response.create' })
  }

  _onEvent(event) {
    if (this._closed) return

    if (event.type === 'response.function_call_arguments.done') {
      const name = event.name
      let args = {}
      try { args = JSON.parse(event.arguments || '{}') } catch {}

      // Acknowledge the function call so the session doesn't hang
      this._send({
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: event.call_id,
          output: 'acknowledged',
        },
      })

      if (typeof this.onToolCall === 'function') {
        this.onToolCall(name, args)
      }
    }

    if (event.type === 'error') {
      console.error('[RealtimeSession] API error event:', event.error)
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
