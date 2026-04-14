/**
 * OpenAI Responses API — Game Brain (Voroshilov moderator)
 *
 * - Local deterministic script building for question reading.
 * - Text Responses API for evaluation/commentary.
 * - Cheap structured-output evaluator for Session 2.
 */

import { mockEvaluateAnswer, mockCommentary } from "./mock";
import {
  RESPONSES_MODEL,
  EVALUATOR_MODEL,
  FAST_EVALUATOR_MODEL,
} from "../config.js";

const USE_MOCK = import.meta.env.VITE_USE_MOCK === "true";
const API_URL = "https://api.openai.com/v1/responses";

// Cached system prompt (loaded once from public/system-prompt.txt)
let SYSTEM_PROMPT = null;

async function getSystemPrompt() {
  if (SYSTEM_PROMPT) return SYSTEM_PROMPT;
  const res = await fetch("/system-prompt.txt");
  SYSTEM_PROMPT = res.ok ? await res.text() : "";
  return SYSTEM_PROMPT;
}

function extractOutputText(data) {
  if (typeof data?.output_text === "string" && data.output_text) {
    return data.output_text;
  }
  if (Array.isArray(data?.output)) {
    for (const item of data.output) {
      if (item?.type === "message" && Array.isArray(item.content)) {
        for (const c of item.content) {
          if (c?.type === "output_text" || c?.type === "text") {
            if (typeof c.text === "string" && c.text) return c.text;
          }
        }
      }
    }
  }
  return "";
}

// ─── Local script builder for question reading ────────────────────────────────

const CHARACTER_RU = {
  "Walter White": {
    name: "Уолтер Уайт",
    city: "Альбукерке, Нью-Мексико",
    desc: "учитель химии",
  },
  "Jesse Pinkman": {
    name: "Джесси Пинкман",
    city: "Альбукерке, Нью-Мексико",
    desc: "уличный химик",
  },
  "Saul Goodman": {
    name: "Сол Гудман",
    city: "Альбукерке, Нью-Мексико",
    desc: "адвокат",
  },
  "Skyler White": {
    name: "Скайлер Уайт",
    city: "Альбукерке, Нью-Мексико",
    desc: "бухгалтер",
  },
  "Hank Schrader": {
    name: "Хэнк Шрейдер",
    city: "Альбукерке, Нью-Мексико",
    desc: "агент DEA",
  },
  "Mike Ehrmantraut": {
    name: "Майк Эрмантраут",
    city: "Филадельфия",
    desc: "решатель проблем",
  },
  "Gustavo Fring": {
    name: "Густаво Фринг",
    city: "Сантьяго, Чили",
    desc: "владелец Pollos Hermanos",
  },
  "Jane Margolis": {
    name: "Джейн Марголис",
    city: "Альбукерке, Нью-Мексико",
    desc: "художница",
  },
  "Todd Alquist": {
    name: "Тодд Олквист",
    city: "Альбукерке, Нью-Мексико",
    desc: "химик-самоучка",
  },
};

const CHARACTER_UK = {
  "Walter White": {
    name: "Волтер Вайт",
    city: "Альбукерке, Нью-Мексико",
    desc: "вчитель хімії",
  },
  "Jesse Pinkman": {
    name: "Джессі Пінкман",
    city: "Альбукерке, Нью-Мексико",
    desc: "вуличний хімік",
  },
  "Saul Goodman": {
    name: "Сол Гудман",
    city: "Альбукерке, Нью-Мексико",
    desc: "адвокат",
  },
  "Skyler White": {
    name: "Скайлер Вайт",
    city: "Альбукерке, Нью-Мексико",
    desc: "бухгалтер",
  },
  "Hank Schrader": {
    name: "Генк Шрейдер",
    city: "Альбукерке, Нью-Мексико",
    desc: "агент DEA",
  },
  "Mike Ehrmantraut": {
    name: "Майк Ерментраут",
    city: "Філадельфія",
    desc: "вирішувач проблем",
  },
  "Gustavo Fring": {
    name: "Густаво Фрінг",
    city: "Сантьяго, Чилі",
    desc: "власник Pollos Hermanos",
  },
  "Jane Margolis": {
    name: "Джейн Марголіс",
    city: "Альбукерке, Нью-Мексико",
    desc: "художниця",
  },
  "Todd Alquist": {
    name: "Тодд Олквіст",
    city: "Альбукерке, Нью-Мексико",
    desc: "хімік-самоучка",
  },
};

const BLITZ_POS_RU = ["Первый", "Второй", "Третий"];
const BLITZ_POS_UK = ["Перший", "Другий", "Третій"];

function buildReadScript(gameContext) {
  const { current_question: q, game_language, sector_number } = gameContext;
  const isRu = game_language !== "uk";
  const chars = isRu ? CHARACTER_RU : CHARACTER_UK;
  const meta = chars[q.character] || { name: q.character, city: "", desc: "" };
  const sector = sector_number ?? "?";
  const timeEnd = isRu
    ? "Время! Минута обсуждения!"
    : "Час! Хвилина обговорення!";

  if (q.round_type === "blitz") {
    const pos = q.blitz_position || 1;
    const posLabel = isRu
      ? BLITZ_POS_RU[pos - 1] || `${pos}-й`
      : BLITZ_POS_UK[pos - 1] || `${pos}-е`;
    const lines = [];

    if (pos === 1) {
      lines.push(
        isRu
          ? `Сектор ${sector}. Сектор Блиц на столе! Три вопроса.  Двадцать секунд на каждый.`
          : `Сектор ${sector}. Сектор Бліц на столі! Три питання. Двадцять секунд на кожне.`
      );
    }
    lines.push(
      isRu
        ? `${posLabel} вопрос. Против знатоков играет ${meta.name} из ${meta.city}.`
        : `${posLabel} питання. Проти знавців грає ${meta.name} із міста ${meta.city}.`
    );
    lines.push(q.question_text);
    lines.push(isRu ? "Время! Двадцать секунд!" : "Час! Двадцять секунд!");
    return lines.join("\n");
  }

  const sectorLine = `Сектор ${sector}!`;
  const charLine = isRu
    ? `Против знатоков играет ${meta.name} из ${meta.city}${
        meta.desc ? `, ${meta.desc}` : ""
      }.`
    : `Проти знавців грає ${meta.name} із міста ${meta.city}${
        meta.desc ? `, ${meta.desc}` : ""
      }.`;
  const questionIntro = isRu ? "Внимание! Вопрос!" : "Увага! Питання!";

  return `${sectorLine}\n${charLine}\n${questionIntro}\n${q.question_text}\n${timeEnd}`;
}

export function buildListeningScript(earlyAnswer, gameLanguage) {
  const isRu = gameLanguage !== "uk";
  if (earlyAnswer) {
    return isRu
      ? "Досрочный ответ! Господин капитан, слушаем вас."
      : "Достроковa відповідь! Пане капітане, слухаємо вас.";
  }
  return isRu
    ? "Стоп! Время! Господин капитан, кто отвечает?"
    : "Стоп! Час! Пане капітане, хто відповідає?";
}

// ─── Core Responses API call ──────────────────────────────────────────────────

async function postResponses(body) {
  const apiKey = import.meta.env.VITE_OPENAI_API_KEY;
  if (!apiKey) throw new Error("VITE_OPENAI_API_KEY not set in .env");

  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenAI Responses API error ${response.status}: ${err}`);
  }

  return response.json();
}

async function callOpenAI(gameContext, previousResponseId) {
  const vectorStoreId = import.meta.env.VITE_VECTOR_STORE_ID;
  const instructions = await getSystemPrompt();

  const body = {
    model: RESPONSES_MODEL,
    instructions,
    input: JSON.stringify(gameContext),
    ...(previousResponseId ? { previous_response_id: previousResponseId } : {}),
    ...(vectorStoreId && vectorStoreId !== "vs_placeholder"
      ? { tools: [{ type: "file_search", vector_store_ids: [vectorStoreId] }] }
      : {}),
  };

  const data = await postResponses(body);
  return { text: extractOutputText(data), responseId: data.id };
}

function buildEvaluationInstructions() {
  return [
    'You are the final answer judge for the TV game "What? Where? When?".',
    "Return ONLY structured JSON that matches the provided schema.",
    "Decide whether the team answer is essentially correct.",
    "Accept semantic matches, transliterations, and wording variants when they preserve the key fact.",
    'Set who_scores to "experts" for a correct answer, otherwise "viewers".',
    "moderator_phrase must be short and suitable for the final spoken verdict.",
    "correct_answer_reveal must contain the canonical correct answer text.",
    'For the "explanation" field: write 3–5 sentences in the SAME language as the question ' +
      '(if Language is "ru" → write in Russian; if Language is "uk" → write in Ukrainian; NEVER write in English). ' +
      "Write as a TV show moderator speaking aloud: recap the team answer → give brief reasoning or context → " +
      "reveal the correct answer → state the verdict → announce the new score (+1 point for who_scores). " +
      "Spoken natural style. No markdown. Maximum 60 words. No English.",
  ].join("\n");
}

function buildEvaluationInput(gameContext) {
  const q = gameContext.current_question || {};
  return [
    `Language: ${gameContext.game_language || "ru"}`,
    `Early answer: ${Boolean(gameContext.early_answer)}`,
    `Question: ${q.question_text || ""}`,
    `Correct answer: ${q.correct_answer || ""}`,
    q.answer_variants?.length
      ? `Accepted variants: ${q.answer_variants.join(", ")}`
      : "",
    q.hint_for_evaluator ? `Evaluator hint: ${q.hint_for_evaluator}` : "",
    `Team answer: ${gameContext.team_answer_transcript || ""}`,
    gameContext.score
      ? `Current score — experts: ${gameContext.score.experts}, viewers: ${gameContext.score.viewers}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function evaluationSchema() {
  return {
    type: "json_schema",
    name: "answer_evaluation",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: [
        "correct",
        "score_delta",
        "who_scores",
        "moderator_phrase",
        "correct_answer_reveal",
        "explanation",
      ],
      properties: {
        correct: { type: "boolean" },
        score_delta: { type: "integer", minimum: 0, maximum: 1 },
        who_scores: { type: "string", enum: ["experts", "viewers"] },
        moderator_phrase: { type: "string" },
        correct_answer_reveal: { type: "string" },
        explanation: { type: "string" },
      },
    },
  };
}

async function callStructuredEvaluation(gameContext) {
  const body = {
    model: EVALUATOR_MODEL,
    instructions: buildEvaluationInstructions(),
    input: buildEvaluationInput(gameContext),
    text: {
      format: evaluationSchema(),
    },
  };

  const data = await postResponses(body);

  const refusal = data?.output?.find?.((item) => item?.type === "refusal");
  if (refusal) {
    throw new Error(`OpenAI evaluator refusal: ${JSON.stringify(refusal)}`);
  }

  const parsed = data?.output_parsed;
  if (parsed && typeof parsed === "object") {
    return { evaluation: parsed, responseId: data.id };
  }

  const text = extractOutputText(data).trim();
  if (!text) {
    throw new Error("OpenAI returned empty structured evaluation output");
  }

  try {
    return { evaluation: JSON.parse(text), responseId: data.id };
  } catch (err) {
    throw new Error(`OpenAI returned invalid evaluation JSON: ${text}`);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function readQuestion(gameContext, previousResponseId = null) {
  const text = buildReadScript(gameContext);
  return { text, responseId: previousResponseId };
}

export async function evaluateAnswer(gameContext, previousResponseId = null) {
  if (USE_MOCK) {
    const evaluation = await mockEvaluateAnswer(gameContext);
    return { evaluation, responseId: null };
  }
  return callStructuredEvaluation({
    ...gameContext,
    action: "evaluate_answer",
  });
}

export async function commentary(gameContext, previousResponseId = null) {
  if (USE_MOCK) {
    const text = await mockCommentary(gameContext);
    return { text, responseId: null };
  }
  return callOpenAI(
    { ...gameContext, action: "commentary" },
    previousResponseId
  );
}

export async function evaluateAnswerFast(transcript, question) {
  const gameContext = {
    game_language: "en",
    early_answer: false,
    current_question: {
      question_text: question.question_text,
      correct_answer: question.correct_answer,
      answer_variants: question.answer_variants,
      hint_for_evaluator: question.hint_for_evaluator,
    },
    team_answer_transcript: transcript,
  };

  if (USE_MOCK) {
    return {
      correct: false,
      score_delta: 1,
      who_scores: "viewers",
      moderator_phrase: "Ответ не принят. Очко получает телезритель.",
      correct_answer_reveal: question.correct_answer,
    };
  }

  const body = {
    model: FAST_EVALUATOR_MODEL,
    instructions: buildEvaluationInstructions(),
    input: buildEvaluationInput(gameContext),
    format: evaluationSchema(),
  };

  const data = await postResponses(body);
  const text = extractOutputText(data).trim();
  if (!text) {
    throw new Error("evaluateAnswerFast: empty structured output");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("evaluateAnswerFast: invalid JSON: " + text);
  }
}
