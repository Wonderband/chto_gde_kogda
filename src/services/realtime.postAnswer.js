import {
  TOOL_END_ROUND,
  buildModeratorBaseInstructions,
  buildPostAnswerInstructions,
} from "./realtime.prompts.js";

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForSpokenTurn(session, responseId, timeoutMs = 45000) {
  const done = await session.waitForResponseDone(responseId, timeoutMs);
  await session.waitForAudioStopped(responseId, timeoutMs);
  await delay(250);
  return done;
}

export async function playListeningCue({
  session,
  systemPrompt,
  gameContext,
  earlyAnswer = false,
}) {
  const isRu = (gameContext?.game_language || "ru") !== "uk";
  const cue = earlyAnswer
    ? isRu
      ? "Досрочный ответ принят. Кто отвечает?"
      : "Дострокову відповідь прийнято. Хто відповідає?"
    : isRu
      ? "Время вышло. Кто отвечает?"
      : "Час вийшов. Хто відповідає?";

  await session.setMonologueMode({
    tools: [],
    instructions: buildModeratorBaseInstructions(systemPrompt),
  });

  const created = await session.createResponse({
    instructions: `${buildModeratorBaseInstructions(systemPrompt)}\n\nТЕКУЩАЯ ФАЗА: КОРОТКАЯ СЛУЖЕБНАЯ РЕПЛИКА ПЕРЕД ОТВЕТОМ КОМАНДЫ.\n\nСкажи РОВНО ОДНУ фразу:\n«${cue}»\n\nНикаких добавлений. Сразу замолчи.`,
    outputModalities: ["audio"],
    metadata: { stage: "listening_cue" },
    maxOutputTokens: 80,
  });

  return waitForSpokenTurn(session, created.responseId, 30000);
}

export async function playVerdictCue({
  session,
  systemPrompt,
  evaluation,
  gameContext,
}) {
  const isRu = (gameContext?.game_language || "ru") !== "uk";
  const verdict = evaluation?.correct
    ? isRu
      ? "Ответ принят. Очко получают знатоки."
      : "Відповідь зараховано. Очко отримують знавці."
    : isRu
      ? "Ответ не принят. Очко получают телезрители."
      : "Відповідь не зараховано. Очко отримують телеглядачі.";

  const reveal = evaluation?.correct_answer_reveal || gameContext?.current_question?.correct_answer || "?";

  await session.setMonologueMode({
    tools: [],
    instructions: buildModeratorBaseInstructions(systemPrompt),
  });

  const created = await session.createResponse({
    instructions: `${buildModeratorBaseInstructions(systemPrompt)}\n\nТЕКУЩАЯ ФАЗА: КОРОТКИЙ ВЕРДИКТ ПОСЛЕ ОЦЕНКИ.\n\nСначала скажи: «${verdict}»\nЗатем скажи: ${isRu ? `«Правильный ответ: ${reveal}.»` : `«Правильна відповідь: ${reveal}.»`}\nПосле этого сразу замолчи.`,
    outputModalities: ["audio"],
    metadata: { stage: "verdict_cue" },
    maxOutputTokens: 180,
  });

  return waitForSpokenTurn(session, created.responseId, 45000);
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
  await session.waitForAudioStopped(tool.responseId || created.responseId, 30000);
  return tool.args;
}

export default {
  playListeningCue,
  playVerdictCue,
  runPostAnswerFlow,
};
