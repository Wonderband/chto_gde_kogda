import { buildModeratorBaseInstructions } from "./realtime.prompts.js";
import { TOKENS } from "../config.js";

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRu(gameContext = {}) {
  return (gameContext.game_language || "uk") !== "uk";
}

function buildListeningCuePrompt(gameContext = {}, earlyAnswer = false) {
  const ru = isRu(gameContext);
  const line = earlyAnswer
    ? ru
      ? "Досрочный ответ. Кто будет отвечать?"
      : "Дострокова відповідь. Хто відповідатиме?"
    : ru
    ? "Время вышло. Кто будет отвечать?"
    : "Час вийшов. Хто відповідатиме?";

  return `${buildModeratorBaseInstructions("")}

ПОТОЧНА ФАЗА: КОРОТКА ЗАХИЩЕНА РЕПЛІКА ПЕРЕД ЗАПИСОМ ВІДПОВІДІ.

Скажи РІВНО ЦЮ фразу і одразу замовкни:
«${line}»

ЖОРСТКІ ЗАБОРОНИ:
- не додавай другу фразу,
- не коментуй гру,
- не оголошуй правильну відповідь,
- не став уточнювальних запитань.`;
}

function buildVerdictCuePrompt(gameContext = {}, evaluation = {}) {
  const fallback = isRu(gameContext) ? "Ответ принят." : "Відповідь прийнято.";
  const phrase = (evaluation?.moderator_phrase || fallback).trim();

  return `${buildModeratorBaseInstructions("")}

ПОТОЧНА ФАЗА: КОРОТКИЙ ЗАХИЩЕНИЙ ВЕРДИКТ ПІСЛЯ ОЦІНКИ.

Скажи РІВНО ЦЮ фразу і одразу замовкни:
«${phrase}»

ЖОРСТКІ ЗАБОРОНИ:
- не додавай новий коментар,
- не змінюй смисл фрази,
- не став запитань,
- не починай наступний раунд.`;
}

async function waitForCompletedSpokenTurn(
  session,
  responseId,
  stage,
  timeoutMs = 30000
) {
  const done = await session.waitForResponseDone(responseId, timeoutMs);
  const status = done?.response?.status || "";
  const reason = done?.response?.status_details?.reason || "";
  console.log(`[Realtime][Session2] ${stage} response.done`, {
    responseId,
    status,
    reason,
  });

  await session.waitForAudioStopped(responseId, timeoutMs);
  console.log(`[Realtime][Session2] ${stage} output audio stopped`, {
    responseId,
    status,
    reason,
  });

  await delay(250);
  console.log(`[Realtime][Session2] ${stage} grace tail complete`, {
    responseId,
  });

  if (status !== "completed") {
    throw new Error(
      `${stage} did not complete cleanly (status=${status}, reason=${
        reason || ""
      })`
    );
  }
}

export async function playListeningCue({
  session,
  systemPrompt,
  gameContext,
  earlyAnswer = false,
}) {
  await session.setMonologueMode({
    tools: [],
    instructions: buildModeratorBaseInstructions(systemPrompt),
  });

  const created = await session.createResponse({
    instructions: buildListeningCuePrompt(gameContext, earlyAnswer),
    tools: [],
    outputModalities: ["audio"],
    metadata: { stage: earlyAnswer ? "early_answer_cue" : "time_over_cue" },
    maxOutputTokens: TOKENS.LISTENING_CUE,
  });

  console.log("[Realtime][Session2] listening cue response created", {
    responseId: created.responseId,
    earlyAnswer,
  });

  await waitForCompletedSpokenTurn(
    session,
    created.responseId,
    earlyAnswer ? "early answer cue" : "time over cue",
    30000
  );
}

export async function playVerdictCue({
  session,
  systemPrompt,
  gameContext,
  evaluation,
}) {
  await session.setMonologueMode({
    tools: [],
    instructions: buildModeratorBaseInstructions(systemPrompt),
  });

  const created = await session.createResponse({
    instructions: buildVerdictCuePrompt(gameContext, evaluation),
    tools: [],
    outputModalities: ["audio"],
    metadata: { stage: "session2_verdict" },
    maxOutputTokens: TOKENS.VERDICT_CUE,
  });

  console.log("[Realtime][Session2] verdict response created", {
    responseId: created.responseId,
  });

  await waitForCompletedSpokenTurn(
    session,
    created.responseId,
    "verdict cue",
    30000
  );
}

export async function playNeutralSegueCue({
  session,
  systemPrompt,
  gameContext,
}) {
  const ru = isRu(gameContext);
  const line = ru
    ? "А теперь — к правильному ответу."
    : "А тепер — правильна відповідь.";

  await session.setMonologueMode({
    tools: [],
    instructions: buildModeratorBaseInstructions(systemPrompt),
  });

  const created = await session.createResponse({
    instructions: `${buildModeratorBaseInstructions("")}

ПОТОЧНА ФАЗА: КОРОТКИЙ ПЕРЕХІД ДО ПОЯСНЕННЯ.

Скажи РІВНО ЦЮ фразу і одразу замовкни:
«${line}»

ЖОРСТКІ ЗАБОРОНИ:
- не називай відповідь, не оголошуй вердикт,
- не додавай жодного слова.`,
    tools: [],
    outputModalities: ["audio"],
    metadata: { stage: "segue_cue" },
    maxOutputTokens: TOKENS.SEGUE_CUE,
  });

  console.log("[Realtime][Session2] segue cue created", {
    responseId: created.responseId,
  });

  await waitForCompletedSpokenTurn(
    session,
    created.responseId,
    "segue cue",
    20000
  );
}

export async function playExplanationCue({
  session,
  systemPrompt,
  evaluation,
  gameContext,
}) {
  const ru = isRu(gameContext);
  const fallback = ru
    ? `Правильный ответ: ${evaluation.correct_answer_reveal}.`
    : `Правильна відповідь: ${evaluation.correct_answer_reveal}.`;
  const text = (evaluation.explanation || fallback).trim();

  // No setMonologueMode call — session is already in monologue mode from segue cue
  const created = await session.createResponse({
    instructions: `${buildModeratorBaseInstructions(systemPrompt)}

ПОТОЧНА ФАЗА: ЗАЧИТАЙ ПОЯСНЕННЯ ДОСЛІВНО І ЗАМОВКНИ.

Прочитай РІВНО ЦЕ:
«${text}»

ЖОРСТКІ ЗАБОРОНИ:
- не додавай нічого від себе,
- не змінюй жодного слова,
- не починай наступний раунд.`,
    tools: [],
    outputModalities: ["audio"],
    metadata: { stage: "explanation_cue" },
    maxOutputTokens: TOKENS.EXPLANATION_CUE,
  });

  console.log("[Realtime][Session2] explanation cue created", {
    responseId: created.responseId,
  });

  await waitForCompletedSpokenTurn(
    session,
    created.responseId,
    "explanation cue",
    60000
  );
}

export async function evaluateSessionTwo({
  buildCtx,
  state,
  currentQuestion,
  evaluateAnswerFn,
}) {
  const gameContext = buildCtx({
    team_answer_transcript: state.transcript,
    early_answer: state.earlyAnswer,
  });

  const { evaluation, responseId } = await evaluateAnswerFn(gameContext, null);

  const correct = evaluation?.correct ?? false;
  const correctAnswerReveal =
    evaluation?.correct_answer_reveal ?? currentQuestion?.answer ?? "?";

  // Return only the judgment — explanation is built by the caller (useGamePhaseEffects.buildSpeechText)
  return {
    responseId,
    evaluation: { correct, correct_answer_reveal: correctAnswerReveal },
  };
}
