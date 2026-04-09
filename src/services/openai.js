/**
 * OpenAI Responses API — Answer evaluator + script builder
 *
 * - Local deterministic script building for question reading (buildReadScript).
 * - Structured-output evaluator for answer judgment (evaluateAnswer, evaluateAnswerFast).
 */

import { mockEvaluateAnswer } from './mock'
import { EVALUATOR_MODEL, FAST_EVALUATOR_MODEL } from '../config.js'

const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true'
const API_URL = 'https://api.openai.com/v1/responses'

function extractOutputText(data) {
  if (typeof data?.output_text === 'string' && data.output_text) {
    return data.output_text
  }
  if (Array.isArray(data?.output)) {
    for (const item of data.output) {
      if (item?.type === 'message' && Array.isArray(item.content)) {
        for (const c of item.content) {
          if (c?.type === 'output_text' || c?.type === 'text') {
            if (typeof c.text === 'string' && c.text) return c.text
          }
        }
      }
    }
  }
  return ''
}

// ─── Local script builder for question reading ────────────────────────────────

const CHARACTER_RU = {
  'Walter White':     { name: 'Уолтер Уайт',        city: 'Альбукерке, Нью-Мексико', desc: 'учитель химии' },
  'Jesse Pinkman':   { name: 'Джесси Пинкман',      city: 'Альбукерке, Нью-Мексико', desc: 'уличный химик' },
  'Saul Goodman':    { name: 'Сол Гудман',           city: 'Альбукерке, Нью-Мексико', desc: 'адвокат' },
  'Skyler White':    { name: 'Скайлер Уайт',         city: 'Альбукерке, Нью-Мексико', desc: 'бухгалтер' },
  'Hank Schrader':   { name: 'Хэнк Шрейдер',        city: 'Альбукерке, Нью-Мексико', desc: 'агент DEA' },
  'Mike Ehrmantraut':{ name: 'Майк Эрмантраут',      city: 'Филадельфия',             desc: 'решатель проблем' },
  'Gustavo Fring':   { name: 'Густаво Фринг',        city: 'Сантьяго, Чили',          desc: 'владелец Pollos Hermanos' },
  'Jane Margolis':   { name: 'Джейн Марголис',       city: 'Альбукерке, Нью-Мексико', desc: 'художница' },
  'Todd Alquist':    { name: 'Тодд Олквист',         city: 'Альбукерке, Нью-Мексико', desc: 'химик-самоучка' },
  'Tuco Salamanca':  { name: 'Туко Саламанка',       city: 'Альбукерке, Нью-Мексико', desc: 'дилер наркотиків' },
  'Gale Boetticher': { name: 'Гейл Беттикер',        city: 'Альбукерке, Нью-Мексико', desc: 'химик-лаборант' },
  'Walter White Jr.':{ name: 'Уолтер Уайт-младший', city: 'Альбукерке, Нью-Мексико', desc: 'сын Уолтера Уайта' },
}

const CHARACTER_UK = {
  'Walter White':     { name: 'Волтер Вайт',           city: 'Альбукерке, Нью-Мексико', desc: 'вчитель хімії' },
  'Jesse Pinkman':   { name: 'Джессі Пінкман',         city: 'Альбукерке, Нью-Мексико', desc: 'вуличний хімік' },
  'Saul Goodman':    { name: 'Сол Гудман',              city: 'Альбукерке, Нью-Мексико', desc: 'адвокат' },
  'Skyler White':    { name: 'Скайлер Вайт',            city: 'Альбукерке, Нью-Мексико', desc: 'бухгалтер' },
  'Hank Schrader':   { name: 'Генк Шрейдер',           city: 'Альбукерке, Нью-Мексико', desc: 'агент DEA' },
  'Mike Ehrmantraut':{ name: 'Майк Ерментраут',         city: 'Філадельфія',             desc: 'вирішувач проблем' },
  'Gustavo Fring':   { name: 'Густаво Фрінг',           city: 'Сантьяго, Чилі',          desc: 'власник Pollos Hermanos' },
  'Jane Margolis':   { name: 'Джейн Марголіс',          city: 'Альбукерке, Нью-Мексико', desc: 'художниця' },
  'Todd Alquist':    { name: 'Тодд Олквіст',            city: 'Альбукерке, Нью-Мексико', desc: 'хімік-самоучка' },
  'Tuco Salamanca':  { name: 'Туко Саламанка',          city: 'Альбукерке, Нью-Мексико', desc: 'дилер наркотиків' },
  'Gale Boetticher': { name: 'Ґейл Беттікер',           city: 'Альбукерке, Нью-Мексико', desc: 'хімік-лаборант' },
  'Walter White Jr.':{ name: 'Волтер Вайт-молодший',   city: 'Альбукерке, Нью-Мексико', desc: 'син Волтера Вайта' },
}

const BLITZ_POS_RU = ['Первый', 'Второй', 'Третий']
const BLITZ_POS_UK = ['Перший', 'Другий', 'Третій']

function buildReadScript(gameContext) {
  const { current_question: q, game_language, sector_number } = gameContext
  const isRu = game_language !== 'uk'
  const chars = isRu ? CHARACTER_RU : CHARACTER_UK
  const meta = chars[q.character] || { name: q.character, city: '', desc: '' }
  const sector = sector_number ?? '?'
  const timeEnd = isRu ? 'Время! Минута обсуждения!' : 'Час! Хвилина обговорення!'

  if (q.round_type === 'blitz') {
    const pos = q.blitz_position || 1
    const posLabel = isRu ? (BLITZ_POS_RU[pos - 1] || `${pos}-й`) : (BLITZ_POS_UK[pos - 1] || `${pos}-е`)
    const lines = []

    if (pos === 1) {
      lines.push(
        isRu
          ? `Сектор ${sector}. Сектор Блиц на столе! Три вопроса. Три телезрителя. Двадцать секунд на каждый.`
          : `Сектор ${sector}. Сектор Бліц на столі! Три питання. Три телеглядачі. Двадцять секунд на кожне.`
      )
      // Only introduce the character for Q1
      lines.push(
        isRu
          ? `${posLabel} вопрос. Против знатоков играет ${meta.name} из ${meta.city}.`
          : `${posLabel} питання. Проти знавців грає ${meta.name} із міста ${meta.city}.`
      )
    } else {
      // Q2/Q3: just announce the position, no sector/character re-intro
      lines.push(isRu ? `${posLabel} вопрос.` : `${posLabel} питання.`)
    }
    lines.push(q.question_text)
    lines.push(isRu ? 'Время! Двадцать секунд!' : 'Час! Двадцять секунд!')
    return lines.join('\n')
  }

  const sectorLine = `Сектор ${sector}!`
  const charLine = isRu
    ? `Против знатоков играет ${meta.name} из ${meta.city}${meta.desc ? `, ${meta.desc}` : ''}.`
    : `Проти знавців грає ${meta.name} із міста ${meta.city}${meta.desc ? `, ${meta.desc}` : ''}.`
  const questionIntro = isRu ? 'Внимание! Вопрос!' : 'Увага! Питання!'

  return `${sectorLine}\n${charLine}\n${questionIntro}\n${q.question_text}\n${timeEnd}`
}

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

// ─── Responses API ────────────────────────────────────────────────────────────

async function postResponses(body) {
  const apiKey = import.meta.env.VITE_OPENAI_API_KEY
  if (!apiKey) throw new Error('VITE_OPENAI_API_KEY not set in .env')

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

  return response.json()
}

function buildEvaluationInstructions() {
  return [
    'Ти — суддя відповідей у грі «Що? Де? Коли?».',
    'Порівняй відповідь команди (Team answer) з правильною відповіддю (Correct answer) та прийнятними варіантами (Accepted variants).',
    '',
    'ПРАВИЛА ПРИЙНЯТТЯ:',
    '1. Відповідь правильна, якщо містить усі ключові факти з правильної відповіді або прийнятних варіантів — навіть у розгорнутому чи пояснювальному форматі.',
    '2. Транслітерації між мовами ПРИЙНЯТНІ — кириличне написання іноземного слова дорівнює оригіналу (Джуніор = Junior; Флінн = Flynn; Шварц = Schwartz). Якщо звучання схоже — це одна й та сама відповідь. Це стосується і різних кириличних написань одного іноземного імені: Вітмен = Уїтмен = Whitman; Флін = Флінн; Вайт = Уайт. Орфографічні варіанти одного звучання є рівнозначними.',
    '2а. Граматичні форми слова ПРИЙНЯТНІ — відмінювання, відмінки, число не змінюють суті відповіді (Волтерів = Волтер; змінами = зміни; трансформацією = трансформація). Якщо корінь слова збігається з правильною відповіддю або прийнятним варіантом — відповідь правильна.',
    '3. Парафраз прийнятний ТІЛЬКИ для ідентифікації ЛЮДЕЙ та ВЛАСНИХ НАЗВ (наприклад, «син Волтера» = «Walter White Jr», «дружина» = «Скайлер»). Для всіх інших відповідей (поняття, слова, назви серій, хімічні елементи) — ТІЛЬКИ точний збіг з Correct answer або Accepted variants, транслітерація або граматична форма того самого слова. ЗАБОРОНЕНО: приймати семантичні синоніми як правильну відповідь. «перетворення» ≠ «зміни». «реакції» ≠ «зміни». «мутація» ≠ «трансформація». Якщо слово відсутнє у Correct answer та Accepted variants — відхиляй.',
    '3а. СКЛАДЕНІ відповіді (кілька фактів): якщо питання вимагає кілька елементів і ВСІ вони присутні у відповіді команди (навіть розкидані по довгому поясненні) — відповідь правильна. Перевіряй кожен обов\'язковий елемент окремо.',
    '4. ВІДХИЛЯЙ, якщо відповідь є перекладом власного імені або специфічного терміна, що звучить ПОВНІСТЮ ІНАКШЕ і не ідентифікує однозначно правильну особу. Приклад: «Black» — НЕ правильна відповідь, якщо правильна відповідь «Schwartz», бо «Black» та «Schwartz» — різні слова з різним звучанням, хоч і однаковим значенням. Ключова ознака: різне звучання + переклад значення замість ідентифікації особи.',
    '5. ВІДХИЛЯЙ лише якщо ВЕСЬ текст відповіді є беззмістовним шумом, технічним повідомленням системи або взагалі не стосується питання. Якщо серед шуму є хоча б одне слово або фраза, що відповідає правильній відповіді чи прийнятному варіанту — ПРИЙМАЙ. Приклад: «Давид-давид... тобто це дружина» містить слово «дружина» — відповідь правильна.',
    '6. УВАГА — правильне ім\'я у другорядній ролі НЕ є відповіддю: якщо команда називає одну особу своєю відповіддю, а правильне ім\'я згадує лише як другорядну деталь (наприклад, «ведмедик передбачив долю Джейн, бо її вбив Густаво Фрінг» — суб\'єкт відповіді тут Джейн, Фрінг лише деталь), відповідь НЕПРАВИЛЬНА. Визнач, кого команда НАЗИВАЄ своєю відповіддю, а не просто згадує.',
    '',
    'Поверни JSON з трьома полями:',
    '- reasoning: спочатку виклади своє міркування — перелічи всі ключові факти з правильної відповіді та чи присутній кожен з них у відповіді команди. Для складених відповідей перевіряй кожен елемент окремо.',
    '- correct: true або false — лише після того, як виклав міркування.',
    '- correct_answer_reveal: канонічний текст правильної відповіді (скопіюй з Correct answer).',
  ].join('\n')
}

function buildEvaluationInput(gameContext) {
  const q = gameContext.current_question || {}
  const blitzRemaining = gameContext.blitz_queue_remaining ?? 0
  return [
    `Language: ${gameContext.game_language || 'uk'}`,
    `Early answer: ${Boolean(gameContext.early_answer)}`,
    q.round_type === 'blitz' ? `Blitz question: yes` : '',
    q.round_type === 'blitz' ? `Blitz position: ${q.blitz_position || 1}` : '',
    q.round_type === 'blitz' ? `Blitz remaining: ${blitzRemaining}` : '',
    `Question: ${q.question_text || ''}`,
    `Correct answer: ${q.correct_answer || ''}`,
    q.answer_variants?.length ? `Accepted variants: ${q.answer_variants.join(', ')}` : '',
    `Team answer: ${gameContext.team_answer_transcript || ''}`,
    gameContext.score
      ? `Current score — experts: ${gameContext.score.experts}, viewers: ${gameContext.score.viewers}`
      : '',
  ].filter(Boolean).join('\n')
}

function evaluationSchema() {
  return {
    type: 'json_schema',
    name: 'answer_evaluation',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['reasoning', 'correct', 'correct_answer_reveal'],
      properties: {
        reasoning: { type: 'string' },
        correct: { type: 'boolean' },
        correct_answer_reveal: { type: 'string' },
      },
    },
  }
}

async function callStructuredEvaluation(gameContext) {
  const input = buildEvaluationInput(gameContext)
  console.log('[Evaluator][INPUT]\n' + input)

  const body = {
    model: EVALUATOR_MODEL,
    instructions: buildEvaluationInstructions(),
    input,
    text: {
      format: evaluationSchema(),
    },
  }

  const data = await postResponses(body)

  const refusal = data?.output?.find?.((item) => item?.type === 'refusal')
  if (refusal) {
    throw new Error(`OpenAI evaluator refusal: ${JSON.stringify(refusal)}`)
  }

  const parsed = data?.output_parsed
  if (parsed && typeof parsed === 'object') {
    console.log('[Evaluator][REASONING]', parsed.reasoning)
    console.log('[Evaluator][OUTPUT]', { correct: parsed.correct, correct_answer_reveal: parsed.correct_answer_reveal })
    return { evaluation: parsed, responseId: data.id }
  }

  const text = extractOutputText(data).trim()
  if (!text) {
    throw new Error('OpenAI returned empty structured evaluation output')
  }

  try {
    const result = JSON.parse(text)
    console.log('[Evaluator][OUTPUT]', result)
    return { evaluation: result, responseId: data.id }
  } catch (err) {
    throw new Error(`OpenAI returned invalid evaluation JSON: ${text}`)
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function readQuestion(gameContext, previousResponseId = null) {
  const text = buildReadScript(gameContext)
  return { text, responseId: previousResponseId }
}

export async function evaluateAnswer(gameContext, previousResponseId = null) {
  if (USE_MOCK) {
    const evaluation = await mockEvaluateAnswer(gameContext)
    return { evaluation, responseId: null }
  }
  return callStructuredEvaluation({ ...gameContext, action: 'evaluate_answer' })
}

export async function evaluateAnswerFast(transcript, question) {
  const gameContext = {
    game_language: 'en',
    early_answer: false,
    current_question: {
      question_text: question.question_text,
      correct_answer: question.correct_answer,
      answer_variants: question.answer_variants,
    },
    team_answer_transcript: transcript,
  }

  if (USE_MOCK) {
    return {
      correct: false,
      score_delta: 1,
      who_scores: 'viewers',
      moderator_phrase: 'Ответ не принят. Очко получает телезритель.',
      correct_answer_reveal: question.correct_answer,
    }
  }

  const body = {
    model: FAST_EVALUATOR_MODEL,
    instructions: buildEvaluationInstructions(),
    input: buildEvaluationInput(gameContext),
    format: evaluationSchema(),
  }

  const data = await postResponses(body)
  const text = extractOutputText(data).trim()
  if (!text) {
    throw new Error('evaluateAnswerFast: empty structured output')
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new Error('evaluateAnswerFast: invalid JSON: ' + text)
  }
}
