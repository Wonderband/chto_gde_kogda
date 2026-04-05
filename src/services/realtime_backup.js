const ENV =
  typeof import.meta !== "undefined" && import.meta.env ? import.meta.env : {};
const DEFAULT_MODEL = ENV.VITE_REALTIME_MODEL || "gpt-realtime-mini";
const DEFAULT_VOICE = ENV.VITE_REALTIME_VOICE || "echo";

function uid(prefix = "rt") {
  const rnd =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  return `${prefix}_${rnd}`;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeText(value = "") {
  return value
    .toLowerCase()
    .replace(/[“”«»"'.,!?;:()\[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function withTimeout(promise, ms, label) {
  if (!ms || ms <= 0) return promise;
  return new Promise((resolve, reject) => {
    const id = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms} ms`)),
      ms
    );
    promise.then(
      (value) => {
        clearTimeout(id);
        resolve(value);
      },
      (err) => {
        clearTimeout(id);
        reject(err);
      }
    );
  });
}

function makeDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function safeJsonParse(value, fallback = {}) {
  try {
    return JSON.parse(value || "{}");
  } catch {
    return fallback;
  }
}

function extractPersonaPrelude(systemPrompt = "") {
  if (!systemPrompt) return "";
  const stopMarkers = [
    "## СЦЕНАРИЙ ИГРЫ",
    "### ФАЗА 1",
    "## HOW TO USE THIS FILE",
    "--- SYSTEM PROMPT START ---",
  ];

  let end = systemPrompt.length;
  for (const marker of stopMarkers) {
    const idx = systemPrompt.indexOf(marker);
    if (idx !== -1) end = Math.min(end, idx);
  }

  return systemPrompt.slice(0, end).trim();
}

function inferQuestionTheme(gameContext) {
  const q = gameContext.current_question || {};
  const haystack = normalizeText(
    `${q.question_text || ""} ${q.correct_answer || ""} ${
      q.hint_for_evaluator || ""
    }`
  );

  const chemistry = [
    "хим",
    "chem",
    "молек",
    "реакц",
    "кислот",
    "элемент",
    "element",
    "atomic",
    "период",
    "лаборат",
  ];
  const law = [
    "адвокат",
    "law",
    "legal",
    "суд",
    "договор",
    "право",
    "юрист",
    "prosecut",
  ];
  const history = [
    "истор",
    "history",
    "войн",
    "корол",
    "век",
    "револю",
    "импер",
    "president",
    "полит",
  ];
  const language = [
    "слово",
    "word",
    "букв",
    "язык",
    "language",
    "назван",
    "slang",
    "термин",
  ];
  const math = [
    "числ",
    "матем",
    "логик",
    "number",
    "count",
    "формул",
    "calculate",
    "процент",
  ];

  const hit = (needles) => needles.some((n) => haystack.includes(n));

  if (hit(chemistry)) return "chemistry";
  if (hit(law)) return "law";
  if (hit(history)) return "history";
  if (hit(language)) return "language";
  if (hit(math)) return "math";
  return "general";
}

function warmupLineByTheme(theme, isRu) {
  const prompts = {
    chemistry: isRu
      ? "Скажите честно: кто из вас в школе любил химию?"
      : "Скажіть чесно: хто з вас у школі любив хімію?",
    law: isRu
      ? "У кого из вас сегодня особенно убедительный адвокатский тон?"
      : "У кого з вас сьогодні особливо переконливий адвокатський тон?",
    history: isRu
      ? "Кто из вас лучше всех дружил в школе с историей?"
      : "Хто з вас найкраще дружив у школі з історією?",
    language: isRu
      ? "Кто за этим столом любит играть со словами?"
      : "Хто за цим столом любить гратися зі словами?",
    math: isRu
      ? "Кто из вас любит задачи, где всё решают логика и точность?"
      : "Хто з вас любить задачі, де все вирішують логіка і точність?",
    general: isRu
      ? "Ну что, господа знатоки, настроение у стола боевое?"
      : "Ну що, панове знавці, настрій у столу бойовий?",
  };
  return prompts[theme] || prompts.general;
}

function themeFlavorByTheme(theme, isRu) {
  const flavors = {
    chemistry: isRu
      ? "Тема вопроса явно пахнет наукой, но без прямых подсказок."
      : "Тема питання виразно пахне наукою, але без прямих підказок.",
    law: isRu
      ? "Тут важны точные формулировки и холодная голова."
      : "Тут важливі точні формулювання і холодна голова.",
    history: isRu
      ? "Иногда память о прошлом спасает очко в настоящем."
      : "Іноді пам’ять про минуле рятує очко в теперішньому.",
    language: isRu
      ? "Сегодня одно слово может весить больше длинной речи."
      : "Сьогодні одне слово може важити більше за довгу промову.",
    math: isRu
      ? "Иногда интуиция полезна, но сегодня ей нужна логика."
      : "Іноді інтуїція корисна, але сьогодні їй потрібна логіка.",
    general: isRu
      ? "Вопрос выглядит простым только до первой ошибки."
      : "Питання виглядає простим лише до першої помилки.",
  };
  return flavors[theme] || flavors.general;
}

function wheelBanterSeed(index = 0, isRu) {
  const ru = [
    "Пока волчок разгоняется, как настроение у стола?",
    "Кто сегодня отвечает за спокойствие, а кто — за азарт?",
    "Как полагаете, лёгкий будет вопрос или коварный?",
    "Господа знатоки, стол сегодня звучит уверенно или делает вид?",
    "Кто из вас сейчас больше верит в интуицию, чем в знания?",
  ];
  const uk = [
    "Поки дзиґа розганяється, який настрій у столу?",
    "Хто сьогодні відповідає за спокій, а хто — за азарт?",
    "Як гадаєте, питання буде легке чи підступне?",
    "Панове знавці, стіл сьогодні звучить упевнено чи тільки вдає?",
    "Хто з вас зараз більше вірить в інтуїцію, ніж у знання?",
  ];
  const source = isRu ? ru : uk;
  return source[index % source.length];
}

export const TOOL_READY_FOR_QUESTION = {
  type: "function",
  name: "ready_for_question",
  description:
    "Call this ONLY after you finish one short warm-up exchange and are ready for the app to switch you into protected monologue question-reading mode. This must be the final action of the warm-up stage.",
  parameters: {
    type: "object",
    properties: {
      reason: {
        type: "string",
        description: "Brief reason why the warm-up is complete.",
      },
    },
    required: ["reason"],
  },
};

export const TOOL_END_ROUND = {
  type: "function",
  name: "end_round",
  description:
    "Call AFTER you have fully finished the evaluation ritual, including the correct answer and the updated score. This must be the final action of the evaluation response.",
  parameters: {
    type: "object",
    properties: {
      correct: {
        type: "boolean",
        description: "Whether the experts' answer was accepted as correct.",
      },
      who_scores: {
        type: "string",
        enum: ["experts", "viewers"],
      },
      correct_answer_reveal: {
        type: "string",
        description:
          "The correct answer phrased naturally for on-screen reveal.",
      },
    },
    required: ["correct", "who_scores", "correct_answer_reveal"],
  },
};

function timeLineForQuestion(gameContext) {
  const isRu = (gameContext.game_language || "ru") !== "uk";
  return gameContext.current_question?.round_type === "blitz"
    ? isRu
      ? "Время! Двадцать секунд."
      : "Час! Двадцять секунд."
    : isRu
    ? "Время! Минута обсуждения."
    : "Час! Хвилина обговорення.";
}

function attentionLineForQuestion(gameContext) {
  const isRu = (gameContext.game_language || "ru") !== "uk";
  const q = gameContext.current_question || {};
  const pos = q.blitz_position || 1;
  const blitzPosLabel = isRu
    ? ["Первый", "Второй", "Третий"][pos - 1] || `${pos}-й`
    : ["Перший", "Другий", "Третій"][pos - 1] || `${pos}-е`;

  if (q.round_type !== "blitz") {
    return isRu ? "Внимание! Вопрос!" : "Увага! Питання!";
  }

  if (pos === 1) {
    return isRu
      ? "Сектор Блиц! Три вопроса. Три телезрителя. Двадцать секунд на каждый. Внимание! Первый вопрос!"
      : "Сектор Бліц! Три питання. Три телеглядачі. Двадцять секунд на кожне. Увага! Перше питання!";
  }

  return isRu
    ? `Внимание! ${blitzPosLabel} вопрос!`
    : `Увага! ${blitzPosLabel} питання!`;
}

export function buildModeratorBaseInstructions(systemPrompt = "") {
  const personaPrelude = extractPersonaPrelude(systemPrompt);
  return `${personaPrelude}

---

ТЕКУЩАЯ РЕАЛТАЙМ-РОЛЬ:
Ты — живой ведущий у игрового стола. Приложение управляет фазами и таймингом.

ЖЁСТКИЕ ПРАВИЛА ДЛЯ REALTIME SESSION 1:
1. Выполняй только текущую фазу, указанную в instructions текущего response.create.
2. Во время wheel small talk говори только с игроками. Не обсуждай персонажей Breaking Bad, автора вопроса, сектор или правильный ответ.
3. Во время sector intro объявляй только сектор и автора вопроса. Не начинай warm-up и не читай вопрос.
4. Во время warm-up задай ОДИН короткий вопрос игрокам по теме вопроса, выслушай, дай ОДНУ короткую реакцию и затем вызови ready_for_question.
5. Во время protected monologue читай вопрос дословно и не реагируй на игроков.
6. Не импровизируй сюжет. Не придумывай дополнительных персонажей, событий или сцен.
7. Не называй правильный ответ до фазы оценки.
8. Если текущая фаза запрещает функцию — не вызывай её.
9. Все реплики должны быть короткими и сценически точными. Никаких длинных монологов вне question-read.
`;
}

export function buildWheelSmallTalkPrompt(gameContext, index = 0) {
  const isRu = (gameContext.game_language || "ru") !== "uk";
  return `${buildModeratorBaseInstructions("")}

ТЕКУЩАЯ ФАЗА: КОЛЕСО КРУТИТСЯ.

ЗАДАЧА:
- Скажи ОДНУ короткую живую реплику столу.
- Это должно быть приветствие, лёгкая шутка или один простой вопрос к игрокам.
- НЕЛЬЗЯ говорить о персонажах Breaking Bad, секторе, авторе вопроса, правильном ответе или содержании вопроса.
- Если игроки просят уже начать вопрос или назвать сектор, мягко отложи это одной короткой фразой и НЕ начинай следующий этап.
- НЕЛЬЗЯ уходить в длинный монолог.
- После одной реплики остановись.

Подсказка для этой реплики:
${wheelBanterSeed(index, isRu)}

Язык: ${isRu ? "русский" : "українська"}.
Счёт: ${gameContext.score?.experts ?? 0} : ${gameContext.score?.viewers ?? 0}.
Раунд: ${gameContext.round_number ?? 0}.
`;
}

export function buildSectorIntroPrompt(gameContext) {
  const isRu = (gameContext.game_language || "ru") !== "uk";
  const q = gameContext.current_question || {};
  const theme = inferQuestionTheme(gameContext);
  return `${buildModeratorBaseInstructions("")}

ТЕКУЩАЯ ФАЗА: МОНОЛОГ ПОСЛЕ ОСТАНОВКИ ВОЛЧКА.

Выполни ТОЛЬКО это:
1. Сразу объяви сектор номер ${gameContext.sector_number}.
2. Представь телезрителя / персонажа: ${q.character || "Неизвестный персонаж"}.
3. Добавь ОДНУ короткую тематическую реплику без спойлеров: ${themeFlavorByTheme(
    theme,
    isRu
  )}
4. На этом остановись.

ЗАПРЕЩЕНО:
- начинать warm-up,
- обращаться к игрокам с новым вопросом,
- говорить «Внимание! Вопрос!» / «Увага! Питання!»,
- читать текст вопроса,
- запускать какие-либо функции.
`;
}

export function buildWarmupPrompt(gameContext) {
  const isRu = (gameContext.game_language || "ru") !== "uk";
  const theme = inferQuestionTheme(gameContext);
  const questionText = gameContext.current_question?.question_text || "";
  return `${buildModeratorBaseInstructions("")}

ТЕКУЩАЯ ФАЗА: КОРОТКИЙ DIALOGUE WARM-UP.

Сценарий должен быть РОВНО таким:
1. Задай игрокам ОДИН короткий разогревающий вопрос по теме будущего вопроса, но без спойлеров.
2. Выслушай короткий ответ игрока.
3. Дай одну короткую реакцию на ответ.
4. Вызови ready_for_question({"reason": "warmup complete"}) и сразу замолчи.

Тема вопроса: ${theme}.
Подсказка для warm-up вопроса: ${warmupLineByTheme(theme, isRu)}
Скрытый текст будущего вопроса (не цитируй его и не раскрывай ответ): ${questionText}

ЖЁСТКИЕ ЗАПРЕТЫ:
- НЕ упоминай персонажей Breaking Bad в этой фазе.
- НЕ говори «Внимание! Вопрос!» / «Увага! Питання!» в этой фазе.
- НЕ читай вопрос.
- НЕ затягивай разговор дольше одного короткого обмена.
- После вызова ready_for_question ничего больше не говори.
`;
}

export function buildQuestionReadPrompt(gameContext) {
  const isRu = (gameContext.game_language || "ru") !== "uk";
  const q = gameContext.current_question || {};
  const questionText = q.question_text || "";
  return `${buildModeratorBaseInstructions("")}

ТЕКУЩАЯ ФАЗА: ЗАЩИЩЁННЫЙ МОНОЛОГ — ЧТЕНИЕ ВОПРОСА.

Выполни ТОЛЬКО это и затем замолчи:
1. Скажи: «${attentionLineForQuestion(gameContext)}»
2. Прочитай вопрос ДОСЛОВНО, без изменений и без комментариев:
«${questionText}»
3. Скажи: «${timeLineForQuestion(gameContext)}»
4. Замолчи.

ЖЁСТКИЕ ЗАПРЕТЫ:
- не задавай встречных вопросов,
- не вызывай функций,
- не добавляй small talk,
- не повторяй вопрос второй раз,
- не продолжай говорить после объявления времени.
`;
}

export function buildPostAnswerInstructions(systemPrompt, gameContext) {
  const isRu = (gameContext.game_language || "ru") !== "uk";
  const q = gameContext.current_question || {};
  const transcript = gameContext.team_answer_transcript || "";

  return `${buildModeratorBaseInstructions(systemPrompt)}

ТЕКУЩАЯ ФАЗА: ОЦЕНКА ОТВЕТА ПОСЛЕ ОБСУЖДЕНИЯ.

Сценарий:
1. Коротко повтори ответ знатоков: ${
    transcript
      ? `«${transcript}»`
      : isRu
      ? "«Ответ не прозвучал.»"
      : "«Відповіді не прозвучало.»"
  }
2. В 2–4 предложениях выстрой напряжение и логику, не объявляя вердикт слишком рано.
3. Назови правильный ответ: «${q.correct_answer || "?"}».
4. Скажи вердикт: ${
    isRu
      ? "«Верно!» или «К сожалению, нет.»"
      : "«Правильно!» або «На жаль, ні.»"
  }.
5. Оголоси новый счёт вслух.
6. Вызови функцию end_round() с корректными аргументами и сразу замолчи.

После end_round() ничего не говори.
`;
}

const DEFAULT_TRIGGER_PHRASES = [
  "внимание вопрос",
  "внимание первый вопрос",
  "увага питання",
  "увага перше питання",
];

export class RealtimeSession {
  constructor() {
    this._pc = null;
    this._dc = null;
    this._audioEl = null;
    this._localStream = null;
    this._ownsLocalStream = false;
    this._closed = false;

    this._sessionUpdatedWaiters = [];
    this._responseCreatedFallbackWaiters = [];
    this._responseCreatedByKey = new Map();
    this._responseDoneWaiters = new Map();
    this._audioStoppedWaiters = new Map();
    this._toolWaiters = [];

    this._responseMetaById = new Map();
    this._assistantItemByResponseId = new Map();
    this._transcriptByResponseId = new Map();
    this._triggerFiredByResponseId = new Set();
    this._lastResponseId = null;
    this._activeResponseIds = new Set();

    this.onError = null;
    this.onSessionUpdated = null;
    this.onResponseCreated = null;
    this.onResponseDone = null;
    this.onOutputAudioStopped = null;
    this.onToolCall = null;
    this.onOutputTranscriptDelta = null;
    this.onTriggerPhrase = null;
  }

  async open({
    apiKey,
    systemPrompt = "",
    voice = DEFAULT_VOICE,
    model = DEFAULT_MODEL,
    localStream = null,
    enableMic = true,
  } = {}) {
    if (this._closed) throw new Error("RealtimeSession is already closed");
    if (!apiKey)
      throw new Error("OpenAI API key is required for RealtimeSession.open()");

    this._pc = new RTCPeerConnection();

    this._audioEl = document.createElement("audio");
    this._audioEl.autoplay = true;
    this._audioEl.playsInline = true;
    this._audioEl.style.display = "none";
    document.body.appendChild(this._audioEl);
    this._pc.ontrack = (event) => {
      if (event.streams?.[0]) this._audioEl.srcObject = event.streams[0];
    };

    if (localStream) {
      this._localStream = localStream;
      this._ownsLocalStream = false;
    } else if (enableMic) {
      this._localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      this._ownsLocalStream = true;
    }

    if (this._localStream) {
      for (const track of this._localStream.getAudioTracks()) {
        this._pc.addTrack(track, this._localStream);
      }
    } else {
      this._pc.addTransceiver("audio", { direction: "recvonly" });
    }

    const dcReady = makeDeferred();
    this._dc = this._pc.createDataChannel("oai-events");
    this._dc.onopen = () => dcReady.resolve();
    this._dc.onerror = () =>
      this._handleError(new Error("Realtime data channel error"));
    this._dc.onmessage = (e) => {
      try {
        this._onEvent(JSON.parse(e.data));
      } catch (err) {
        console.error("[RealtimeSession] failed to parse event", err);
      }
    };

    const offer = await this._pc.createOffer();
    await this._pc.setLocalDescription(offer);

    const res = await fetch(
      `https://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/sdp",
        },
        body: offer.sdp,
      }
    );

    if (!res.ok) {
      throw new Error(`Realtime SDP failed: ${res.status} ${await res.text()}`);
    }

    const answerSdp = await res.text();
    await this._pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
    await withTimeout(dcReady.promise, 15000, "WebRTC data channel open");

    // Keep the low-level session config conservative. The app drives active speech
    // explicitly with response.create, while VAD is used for the short dialogue phases.
    await this.updateSession(
      {
        voice,
        instructions: buildModeratorBaseInstructions(systemPrompt),
        tools: [],
        tool_choice: "auto",
        turn_detection: {
          type: "semantic_vad",
          eagerness: "low",
          create_response: true,
          interrupt_response: true,
        },
      },
      15000
    );

    return this;
  }

  get audioElement() {
    return this._audioEl;
  }

  get micEnabled() {
    return !!this._localStream?.getAudioTracks?.().some((t) => t.enabled);
  }

  hasActiveResponse() {
    return this._activeResponseIds.size > 0;
  }

  setMicEnabled(enabled) {
    if (!this._localStream) return;
    for (const track of this._localStream.getAudioTracks()) {
      track.enabled = !!enabled;
    }
  }

  async updateSession(sessionPatch, timeoutMs = 10000) {
    const deferred = makeDeferred();
    this._sessionUpdatedWaiters.push(deferred);
    this._send({ type: "session.update", session: sessionPatch });
    return withTimeout(deferred.promise, timeoutMs, "session.update");
  }

  async setDialogueMode({
    tools = [],
    instructions = null,
    eagerness = "low",
    interruptResponse = true,
    createResponse = true,
  } = {}) {
    this.setMicEnabled(true);
    const patch = {
      tools,
      tool_choice: "auto",
      turn_detection: {
        type: "semantic_vad",
        eagerness,
        create_response: createResponse,
        interrupt_response: interruptResponse,
      },
    };
    if (instructions != null) patch.instructions = instructions;
    await this.updateSession(patch);
  }

  async setMonologueMode({ tools = [], instructions = null } = {}) {
    this.setMicEnabled(false);
    const patch = {
      tools,
      tool_choice: "auto",
      turn_detection: null,
    };
    if (instructions != null) patch.instructions = instructions;
    await this.updateSession(patch);
    this.clearInputBuffer();
  }

  clearInputBuffer() {
    this._send({ type: "input_audio_buffer.clear" });
  }

  async cancelAndTruncateCurrentResponse() {
    const responseId = this._lastResponseId;
    const hasActiveResponse =
      responseId && this._activeResponseIds.has(responseId);

    const itemId =
      hasActiveResponse && responseId
        ? this._assistantItemByResponseId.get(responseId)
        : null;

    const audioMs = Math.max(
      0,
      Math.floor((this._audioEl?.currentTime || 0) * 1000)
    );

    if (hasActiveResponse) {
      this._send({ type: "response.cancel", response_id: responseId });
    }

    this._send({ type: "output_audio_buffer.clear" });

    if (hasActiveResponse && itemId && audioMs > 0) {
      this._send({
        type: "conversation.item.truncate",
        item_id: itemId,
        content_index: 0,
        audio_end_ms: audioMs,
      });
    }

    this.clearInputBuffer();
    await delay(50);
  }

  async createResponse({
    instructions,
    tools = [],
    outputModalities = ["audio"],
    metadata = {},
    maxOutputTokens = 800,
    input = undefined,
    conversation = undefined,
    timeoutMs = 10000,
  } = {}) {
    const requestKey = metadata.request_key || uid("response");
    const deferred = makeDeferred();
    this._responseCreatedByKey.set(requestKey, deferred);
    this._responseCreatedFallbackWaiters.push({ requestKey, deferred });

    const modalities =
      Array.isArray(outputModalities) &&
      outputModalities.length === 1 &&
      outputModalities[0] === "audio"
        ? ["audio", "text"]
        : outputModalities;

    this._send({
      type: "response.create",
      response: {
        instructions,
        tools,
        tool_choice: "auto",
        modalities,
        max_output_tokens: maxOutputTokens,
        metadata: { ...metadata, request_key: requestKey },
        ...(conversation ? { conversation } : {}),
        ...(input ? { input } : {}),
      },
    });

    return withTimeout(
      deferred.promise,
      timeoutMs,
      `response.create(${requestKey})`
    );
  }

  waitForToolCall(name, timeoutMs = 45000, predicate = null) {
    const deferred = makeDeferred();
    this._toolWaiters.push({ name, predicate, deferred });
    return withTimeout(deferred.promise, timeoutMs, `tool:${name}`);
  }

  waitForResponseDone(responseId, timeoutMs = 30000) {
    const deferred = makeDeferred();
    const list = this._responseDoneWaiters.get(responseId) || [];
    list.push(deferred);
    this._responseDoneWaiters.set(responseId, list);
    return withTimeout(
      deferred.promise,
      timeoutMs,
      `response.done:${responseId}`
    );
  }

  waitForAudioStopped(responseId, timeoutMs = 30000) {
    const deferred = makeDeferred();
    const list = this._audioStoppedWaiters.get(responseId) || [];
    list.push(deferred);
    this._audioStoppedWaiters.set(responseId, list);
    return withTimeout(
      deferred.promise,
      timeoutMs,
      `output_audio_buffer.stopped:${responseId}`
    );
  }

  _send(payload) {
    if (this._closed) return;
    if (this._dc?.readyState !== "open") return;
    this._dc.send(JSON.stringify(payload));
  }

  _resolveSessionUpdated(event) {
    const waiter = this._sessionUpdatedWaiters.shift();
    if (waiter) waiter.resolve(event);
  }

  _resolveResponseCreated(event) {
    const key = event.response?.metadata?.request_key;
    if (key && this._responseCreatedByKey.has(key)) {
      const waiter = this._responseCreatedByKey.get(key);
      this._responseCreatedByKey.delete(key);
      this._responseCreatedFallbackWaiters =
        this._responseCreatedFallbackWaiters.filter(
          (w) => w.requestKey !== key
        );
      waiter.resolve({
        responseId: event.response.id,
        metadata: event.response.metadata || {},
      });
      return;
    }

    const fallback = this._responseCreatedFallbackWaiters.shift();
    if (fallback) {
      this._responseCreatedByKey.delete(fallback.requestKey);
      fallback.deferred.resolve({
        responseId: event.response.id,
        metadata: event.response.metadata || {},
      });
    }
  }

  _resolveResponseDone(event) {
    const list = this._responseDoneWaiters.get(event.response.id) || [];
    this._responseDoneWaiters.delete(event.response.id);
    for (const deferred of list) deferred.resolve(event);
  }

  _resolveAudioStopped(event) {
    const list = this._audioStoppedWaiters.get(event.response_id) || [];
    this._audioStoppedWaiters.delete(event.response_id);
    for (const deferred of list) deferred.resolve(event);
  }

  _resolveToolCall(toolEvent) {
    const remaining = [];
    for (const waiter of this._toolWaiters) {
      const nameMatches = waiter.name === toolEvent.name;
      const predicateMatches = waiter.predicate
        ? waiter.predicate(toolEvent)
        : true;
      if (nameMatches && predicateMatches) {
        waiter.deferred.resolve(toolEvent);
      } else {
        remaining.push(waiter);
      }
    }
    this._toolWaiters = remaining;
  }

  _maybeFireTriggerPhrase(event) {
    const responseId = event.response_id;
    const prev = this._transcriptByResponseId.get(responseId) || "";
    const next = prev + (event.delta || "");
    this._transcriptByResponseId.set(responseId, next);

    const normalized = normalizeText(next);
    if (this._triggerFiredByResponseId.has(responseId)) return;

    for (const phrase of DEFAULT_TRIGGER_PHRASES) {
      if (normalized.includes(phrase)) {
        this._triggerFiredByResponseId.add(responseId);
        if (typeof this.onTriggerPhrase === "function") {
          this.onTriggerPhrase({
            phrase,
            responseId,
            transcript: next,
          });
        }
        break;
      }
    }
  }

  _onEvent(event) {
    if (this._closed) return;

    switch (event.type) {
      case "session.updated":
        this._resolveSessionUpdated(event);
        if (typeof this.onSessionUpdated === "function")
          this.onSessionUpdated(event);
        break;

      case "response.created":
        this._lastResponseId = event.response.id;
        this._activeResponseIds.add(event.response.id);
        this._responseMetaById.set(
          event.response.id,
          event.response.metadata || {}
        );
        this._resolveResponseCreated(event);
        if (typeof this.onResponseCreated === "function")
          this.onResponseCreated(event);
        break;

      case "response.output_item.added":
      case "response.output_item.created":
        if (
          event.item?.type === "message" &&
          event.item?.role === "assistant"
        ) {
          this._assistantItemByResponseId.set(event.response_id, event.item.id);
        }
        break;

      case "response.output_audio.delta":
        this._lastResponseId = event.response_id || this._lastResponseId;
        if (
          event.item_id &&
          !this._assistantItemByResponseId.get(event.response_id)
        ) {
          this._assistantItemByResponseId.set(event.response_id, event.item_id);
        }
        break;

      case "response.output_audio_transcript.delta":
      case "response.audio_transcript.delta":
        if (typeof this.onOutputTranscriptDelta === "function")
          this.onOutputTranscriptDelta(event);
        this._maybeFireTriggerPhrase(event);
        break;

      case "response.function_call_arguments.done": {
        const toolEvent = {
          name: event.name,
          args: safeJsonParse(event.arguments),
          responseId: event.response_id,
          itemId: event.item_id,
          callId: event.call_id,
          raw: event,
        };

        this._send({
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: event.call_id,
            output: JSON.stringify({ ok: true }),
          },
        });

        this._resolveToolCall(toolEvent);
        if (typeof this.onToolCall === "function") this.onToolCall(toolEvent);
        break;
      }

      case "response.done":
        this._activeResponseIds.delete(event.response.id);
        this._responseMetaById.set(
          event.response.id,
          event.response.metadata || {}
        );
        this._resolveResponseDone(event);
        if (typeof this.onResponseDone === "function")
          this.onResponseDone(event);
        break;

      case "output_audio_buffer.stopped":
        this._resolveAudioStopped(event);
        if (typeof this.onOutputAudioStopped === "function")
          this.onOutputAudioStopped(event);
        break;

      case "error":
        this._handleError(
          new Error(event.error?.message || "Realtime API error")
        );
        break;

      default:
        break;
    }
  }

  _rejectOutstandingWaiters(err) {
    for (const waiter of this._sessionUpdatedWaiters) waiter.reject(err);
    this._sessionUpdatedWaiters = [];

    for (const waiter of this._responseCreatedByKey.values())
      waiter.reject(err);
    this._responseCreatedByKey.clear();
    for (const fallback of this._responseCreatedFallbackWaiters)
      fallback.deferred.reject(err);
    this._responseCreatedFallbackWaiters = [];

    for (const waiters of this._responseDoneWaiters.values()) {
      for (const waiter of waiters) waiter.reject(err);
    }
    this._responseDoneWaiters.clear();

    for (const waiters of this._audioStoppedWaiters.values()) {
      for (const waiter of waiters) waiter.reject(err);
    }
    this._audioStoppedWaiters.clear();

    for (const waiter of this._toolWaiters) waiter.deferred.reject(err);
    this._toolWaiters = [];
  }

  _handleError(err) {
    if (this._closed) return;
    const message = err?.message || "";

    if (message.includes("Cancellation failed: no active response found")) {
      console.warn("[RealtimeSession] benign cancel miss:", message);
      return;
    }

    console.error("[RealtimeSession]", err);
    this._rejectOutstandingWaiters(err);
    if (typeof this.onError === "function") this.onError(err);
  }

  close() {
    if (this._closed) return;
    this._closed = true;
    this._rejectOutstandingWaiters(new Error("RealtimeSession closed"));

    try {
      this._dc?.close();
      this._pc?.close();

      if (this._audioEl) {
        this._audioEl.srcObject = null;
        this._audioEl.remove();
      }

      if (this._ownsLocalStream && this._localStream) {
        for (const track of this._localStream.getTracks()) track.stop();
      }
    } catch {}

    this._pc = null;
    this._dc = null;
    this._audioEl = null;
    this._localStream = null;
    this._responseCreatedByKey.clear();
    this._responseDoneWaiters.clear();
    this._audioStoppedWaiters.clear();
    this._activeResponseIds.clear();
    this._sessionUpdatedWaiters = [];
    this._toolWaiters = [];
  }
}

export async function startWheelDialogue(session, systemPrompt, gameContext) {
  await session.setDialogueMode({
    tools: [],
    instructions: buildModeratorBaseInstructions(systemPrompt),
    eagerness: "low",
    interruptResponse: true,
    createResponse: true,
  });

  return session.createResponse({
    instructions: buildWheelSmallTalkPrompt(gameContext, 0),
    outputModalities: ["audio"],
    metadata: { stage: "wheel_small_talk", banter_index: "0" },
    maxOutputTokens: 80,
  });
}

export async function continueWheelDialogue(
  session,
  systemPrompt,
  gameContext,
  index = 1
) {
  if (!session || session.hasActiveResponse()) return null;

  await session.setDialogueMode({
    tools: [],
    instructions: buildModeratorBaseInstructions(systemPrompt),
    eagerness: "low",
    interruptResponse: true,
    createResponse: true,
  });

  return session.createResponse({
    instructions: buildWheelSmallTalkPrompt(gameContext, index),
    outputModalities: ["audio"],
    metadata: { stage: "wheel_small_talk", banter_index: String(index) },
    maxOutputTokens: 70,
  });
}

export async function runSessionOneFlow({
  session,
  systemPrompt,
  gameContext,
  warmupTimeoutMs = 12000,
}) {
  console.log("[Realtime][Session1] enter", {
    sector: gameContext?.sector_number,
    questionId: gameContext?.current_question?.id,
    character: gameContext?.current_question?.character,
  });
  if (!session)
    throw new Error("runSessionOneFlow requires an opened RealtimeSession");

  // Hard-cut any leftover wheel chatter again at stage entry.
  await session.cancelAndTruncateCurrentResponse().catch(() => null);
  await delay(120);

  await session.setMonologueMode({
    tools: [],
    instructions: buildModeratorBaseInstructions(systemPrompt),
  });
  console.log("[Realtime][Session1] monologue mode set for sector intro");

  const sectorIntro = await session.createResponse({
    instructions: buildSectorIntroPrompt(gameContext),
    outputModalities: ["audio"],
    metadata: { stage: "sector_intro" },
    maxOutputTokens: 180,
  });
  console.log(
    "[Realtime][Session1] sector intro response created",
    sectorIntro
  );
  await session.waitForAudioStopped(sectorIntro.responseId, 30000);
  console.log("[Realtime][Session1] sector intro audio stopped");

  await session.setDialogueMode({
    tools: [TOOL_READY_FOR_QUESTION],
    instructions: buildModeratorBaseInstructions(systemPrompt),
    eagerness: "low",
    interruptResponse: true,
    createResponse: true,
  });

  console.log("[Realtime][Session1] dialogue mode set for warmup");
  const warmup = await session.createResponse({
    instructions: buildWarmupPrompt(gameContext),
    tools: [TOOL_READY_FOR_QUESTION],
    outputModalities: ["audio"],
    metadata: { stage: "warmup" },
    maxOutputTokens: 120,
  });

  console.log("[Realtime][Session1] warmup response created", warmup);

  let readyEvent = null;
  const cutover = await Promise.race([
    session
      .waitForToolCall("ready_for_question", warmupTimeoutMs)
      .then((event) => ({ type: "tool", event }))
      .catch((err) => ({ type: "tool_error", err })),
    delay(warmupTimeoutMs).then(() => ({ type: "timeout" })),
  ]);

  if (cutover.type === "tool") {
    readyEvent = cutover.event;
    console.log("[Realtime][Session1] warmup tool received");
  } else if (cutover.type === "tool_error") {
    console.warn(
      "[Realtime][Session1] warmup tool wait failed, forcing cutover",
      cutover.err?.message || cutover.err
    );
  } else {
    console.warn(
      "[Realtime][Session1] warmup max duration reached, forcing cutover"
    );
  }

  // session.update does NOT stop an already-speaking dialogue response.
  // Explicitly cancel/clear before question reading.
  await session.cancelAndTruncateCurrentResponse().catch(() => null);
  await delay(120);

  await session.setMonologueMode({
    tools: [],
    instructions: buildModeratorBaseInstructions(systemPrompt),
  });
  console.log("[Realtime][Session1] monologue mode set for question read");

  const questionRead = await session.createResponse({
    instructions: buildQuestionReadPrompt(gameContext),
    outputModalities: ["audio"],
    metadata: { stage: "question_read" },
    maxOutputTokens: 700,
  });

  console.log("[Realtime][Session1] question response created", questionRead);
  await session.waitForAudioStopped(questionRead.responseId, 60000);
  console.log("[Realtime][Session1] question audio stopped");

  return {
    readyEvent,
    questionResponseId: questionRead.responseId,
  };
}

export async function runPostAnswerFlow({
  session,
  systemPrompt,
  gameContext,
}) {
  await session.setMonologueMode({
    tools: [TOOL_END_ROUND],
    instructions: buildModeratorBaseInstructions(systemPrompt),
  });

  const created = await session.createResponse({
    instructions: buildPostAnswerInstructions(systemPrompt, gameContext),
    tools: [TOOL_END_ROUND],
    outputModalities: ["audio"],
    metadata: { stage: "post_answer_evaluation" },
    maxOutputTokens: 700,
  });

  const tool = await session.waitForToolCall("end_round", 45000);
  await session.waitForAudioStopped(
    tool.responseId || created.responseId,
    30000
  );
  return tool.args;
}
