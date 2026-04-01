/**
 * OpenAI Responses API — Game Brain (Voroshilov moderator)
 *
 * POST https://api.openai.com/v1/responses
 * model: gpt-4o
 * Uses previous_response_id for stateful game continuity.
 * Uses file_search tool over Vector Store for questions + rules.
 *
 * Note: readQuestion() builds the script locally (no API call) for instant TTS.
 * Only evaluateAnswer() and commentary() use the Responses API.
 */

import { mockEvaluateAnswer, mockCommentary } from './mock'

const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true'
const API_URL  = 'https://api.openai.com/v1/responses'

// Cached system prompt (loaded once from public/system-prompt.txt)
let SYSTEM_PROMPT = null

async function getSystemPrompt() {
  if (SYSTEM_PROMPT) return SYSTEM_PROMPT
  const res = await fetch('/system-prompt.txt')
  SYSTEM_PROMPT = res.ok ? await res.text() : ''
  return SYSTEM_PROMPT
}

// ─── Local script builder for question reading ────────────────────────────────
// Builds the Voroshilov narration script from question data — no API call needed.

const CHARACTER_RU = {
  'Walter White':     { name: 'Уолтер Уайт',      city: 'Альбукерке, Нью-Мексико', desc: 'учитель химии' },
  'Jesse Pinkman':    { name: 'Джесси Пинкман',   city: 'Альбукерке, Нью-Мексико', desc: 'уличный химик' },
  'Saul Goodman':     { name: 'Сол Гудман',        city: 'Альбукерке, Нью-Мексико', desc: 'адвокат' },
  'Skyler White':     { name: 'Скайлер Уайт',      city: 'Альбукерке, Нью-Мексико', desc: 'бухгалтер' },
  'Hank Schrader':    { name: 'Хэнк Шрейдер',     city: 'Альбукерке, Нью-Мексико', desc: 'агент DEA' },
  'Mike Ehrmantraut': { name: 'Майк Эрмантраут',  city: 'Филадельфия',              desc: 'решатель проблем' },
  'Gustavo Fring':    { name: 'Густаво Фринг',     city: 'Сантьяго, Чили',           desc: 'владелец Pollos Hermanos' },
  'Jane Margolis':    { name: 'Джейн Марголис',   city: 'Альбукерке, Нью-Мексико', desc: 'художница' },
  'Todd Alquist':     { name: 'Тодд Олквист',     city: 'Альбукерке, Нью-Мексико', desc: 'химик-самоучка' },
}

const CHARACTER_UK = {
  'Walter White':     { name: 'Волтер Вайт',       city: 'Альбукерке, Нью-Мексико', desc: 'вчитель хімії' },
  'Jesse Pinkman':    { name: 'Джессі Пінкман',    city: 'Альбукерке, Нью-Мексико', desc: 'вуличний хімік' },
  'Saul Goodman':     { name: 'Сол Гудман',         city: 'Альбукерке, Нью-Мексико', desc: 'адвокат' },
  'Skyler White':     { name: 'Скайлер Вайт',       city: 'Альбукерке, Нью-Мексико', desc: 'бухгалтер' },
  'Hank Schrader':    { name: 'Генк Шрейдер',      city: 'Альбукерке, Нью-Мексико', desc: 'агент DEA' },
  'Mike Ehrmantraut': { name: 'Майк Ерментраут',   city: 'Філадельфія',              desc: 'вирішувач проблем' },
  'Gustavo Fring':    { name: 'Густаво Фрінг',      city: 'Сантьяго, Чилі',          desc: 'власник Pollos Hermanos' },
  'Jane Margolis':    { name: 'Джейн Марголіс',    city: 'Альбукерке, Нью-Мексико', desc: 'художниця' },
  'Todd Alquist':     { name: 'Тодд Олквіст',      city: 'Альбукерке, Нью-Мексико', desc: 'хімік-самоучка' },
}

const BLITZ_POS_RU = ['Первый', 'Второй', 'Третий']
const BLITZ_POS_UK = ['Перший', 'Другий', 'Третій']

function buildReadScript(gameContext) {
  const { current_question: q, game_language, sector_number } = gameContext
  const isRu    = game_language !== 'uk'
  const chars   = isRu ? CHARACTER_RU : CHARACTER_UK
  const meta    = chars[q.character] || { name: q.character, city: '', desc: '' }
  const sector  = sector_number ?? '?'
  const timeEnd = isRu ? 'Время! Минута обсуждения!' : 'Час! Хвилина обговорення!'

  if (q.round_type === 'blitz') {
    const pos      = q.blitz_position || 1
    const posLabel = isRu ? (BLITZ_POS_RU[pos - 1] || `${pos}-й`) : (BLITZ_POS_UK[pos - 1] || `${pos}-е`)
    const lines    = []

    if (pos === 1) {
      lines.push(
        isRu
          ? `Сектор ${sector}. Сектор Блиц на столе! Три вопроса. Три телезрителя. Двадцать секунд на каждый.`
          : `Сектор ${sector}. Сектор Бліц на столі! Три питання. Три телеглядачі. Двадцять секунд на кожне.`
      )
    }
    lines.push(
      isRu
        ? `${posLabel} вопрос. Против знатоков играет ${meta.name} из ${meta.city}.`
        : `${posLabel} питання. Проти знавців грає ${meta.name} із міста ${meta.city}.`
    )
    lines.push(q.question_text)
    lines.push(isRu ? 'Время! Двадцать секунд!' : 'Час! Двадцять секунд!')
    return lines.join('\n')
  }

  // Standard question
  const sectorLine = isRu
    ? `Сектор ${sector}!`
    : `Сектор ${sector}!`

  const charLine = isRu
    ? `Против знатоков играет ${meta.name} из ${meta.city}${meta.desc ? `, ${meta.desc}` : ''}.`
    : `Проти знавців грає ${meta.name} із міста ${meta.city}${meta.desc ? `, ${meta.desc}` : ''}.`

  const questionIntro = isRu ? 'Внимание! Вопрос!' : 'Увага! Питання!'

  return `${sectorLine}\n${charLine}\n${questionIntro}\n${q.question_text}\n${timeEnd}`
}

/**
 * Build the "STOP / early answer" announcement for the LISTENING phase.
 * No API call — instant local script.
 */
export function buildListeningScript(earlyAnswer, gameLanguage) {
  const isRu = gameLanguage !== 'uk'
  if (earlyAnswer) {
    return isRu
      ? 'Досрочный ответ! Господин капитан, слушаем вас.'
      : 'Достроковa відповідь! Пане капітане, слухаємо вас.'
  }
  return isRu
    ? 'Стоп! Время! Господин капитан, кто отвечает?'
    : 'Стоп! Час! Пане капітане, хто відповідає?'
}

// ─── Core Responses API call ──────────────────────────────────────────────────

async function callOpenAI(gameContext, previousResponseId) {
  const apiKey = import.meta.env.VITE_OPENAI_API_KEY
  if (!apiKey) throw new Error('VITE_OPENAI_API_KEY not set in .env')

  const vectorStoreId = import.meta.env.VITE_VECTOR_STORE_ID
  const instructions  = await getSystemPrompt()

  const body = {
    model: 'gpt-4o',
    instructions,
    input: JSON.stringify(gameContext),
    ...(previousResponseId ? { previous_response_id: previousResponseId } : {}),
    ...(vectorStoreId && vectorStoreId !== 'vs_placeholder'
      ? { tools: [{ type: 'file_search', vector_store_ids: [vectorStoreId] }] }
      : {}),
  }

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`OpenAI Responses API error ${response.status}: ${err}`)
  }

  const data = await response.json()

  // Extract text from output array
  let text = ''
  if (data.output_text) {
    text = data.output_text
  } else if (Array.isArray(data.output)) {
    for (const item of data.output) {
      if (item?.type === 'message' && Array.isArray(item.content)) {
        for (const c of item.content) {
          if (c?.type === 'output_text' || c?.type === 'text') {
            text = c.text
            break
          }
        }
      }
      if (text) break
    }
  }

  return { text, responseId: data.id }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Build the question-reading script and return it for TTS.
 * No OpenAI API call — instant response, no latency.
 * @returns {{ text: string, responseId: string|null }}
 */
export async function readQuestion(gameContext, previousResponseId = null) {
  const text = buildReadScript(gameContext)
  return { text, responseId: previousResponseId }
}

/**
 * Ask moderator to evaluate the team's answer.
 * @returns {{ evaluation: object, responseId: string }}
 *   evaluation: { correct, score_delta, who_scores, moderator_phrase, correct_answer_reveal }
 */
export async function evaluateAnswer(gameContext, previousResponseId = null) {
  if (USE_MOCK) {
    const evaluation = await mockEvaluateAnswer(gameContext)
    return { evaluation, responseId: null }
  }
  const { text, responseId } = await callOpenAI(
    { ...gameContext, action: 'evaluate_answer' },
    previousResponseId
  )
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('OpenAI returned invalid evaluation JSON: ' + text)
  return { evaluation: JSON.parse(jsonMatch[0]), responseId }
}

/**
 * Ask moderator for game commentary (score update, end of game, etc.)
 * @returns {{ text: string, responseId: string }}
 */
export async function commentary(gameContext, previousResponseId = null) {
  if (USE_MOCK) {
    const text = await mockCommentary(gameContext)
    return { text, responseId: null }
  }
  return callOpenAI({ ...gameContext, action: 'commentary' }, previousResponseId)
}
