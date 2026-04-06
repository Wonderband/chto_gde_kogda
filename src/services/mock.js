// Mock responses for all AI services
// Used when VITE_USE_MOCK=true in .env

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

// ── Claude mocks ──────────────────────────────────────────────────────────────

const READ_QUESTION_INTROS = [
  (char, city) =>
    `Внимание! Против знатоков играет ${char} из ${city}.\n\nВнимание... вопрос!`,
  (char, city) =>
    `Вопрос прислал ${char} из ${city}. Слушайте внимательно.\n\nВнимание, вопрос!`,
  (char, city) =>
    `Против знатоков играет ${char}.\n\nМинута обсуждения!`,
]

export async function mockReadQuestion(context) {
  await delay(800)
  const { current_question, round_number } = context
  const char = current_question?.character || 'Уолтер Уайт'
  const city = 'Альбукерке, Нью-Мексико'
  const intro = READ_QUESTION_INTROS[round_number % READ_QUESTION_INTROS.length](char, city)
  const questionText = current_question?.question_text || 'Вопрос не загружен.'
  return `${intro}\n\n${questionText}`
}

const CORRECT_PHRASES = [
  (answer, score) =>
    `Абсолютно верно! Правильный ответ — ${answer}. Знатоки зарабатывают очко. Счёт становится ${score.experts + 1}:${score.viewers} в пользу знатоков.`,
  (answer, score) =>
    `Правильный ответ — ${answer}. Что наша жизнь? Игра! Счёт ${score.experts + 1}:${score.viewers}.`,
  (answer, score) =>
    `Верно! ${answer}. Знатоки зарабатывают очко. Продолжаем. Счёт ${score.experts + 1}:${score.viewers}.`,
]

const WRONG_PHRASES = [
  (answer, score) =>
    `К сожалению, это неверный ответ. Правильный ответ был — ${answer}. Очко получают телезрители. Счёт ${score.experts}:${score.viewers + 1}.`,
  (answer, score) =>
    `Нет. Правильный ответ — ${answer}. Телезрители зарабатывают очко. Счёт ${score.experts}:${score.viewers + 1}.`,
]

export async function mockEvaluateAnswer(context) {
  await delay(1200)
  const { current_question, team_answer_transcript, score, round_number } = context
  const correctAnswer = current_question?.correct_answer || '?'
  const variants = current_question?.answer_variants || [correctAnswer]

  // Simple matching: check if transcript contains any variant (case-insensitive)
  const transcript = (team_answer_transcript || '').toLowerCase()
  const correct =
    variants.some((v) => transcript.includes(v.toLowerCase())) ||
    transcript.includes(correctAnswer.toLowerCase())

  const isBlitz = current_question?.round_type === 'blitz'
  const blitzRemaining = context.blitz_queue_remaining ?? 0

  let phrase
  if (isBlitz) {
    if (!correct) {
      phrase = `К сожалению, неверно. Правильный ответ — ${correctAnswer}. Блиц окончен. Очко получают телезрители. Счёт ${score.experts}:${score.viewers + 1}.`
    } else if (blitzRemaining > 0) {
      // Intermediate blitz question — correct but not yet scored
      phrase = `Верно! Правильный ответ — ${correctAnswer}. Продолжаем блиц!`
    } else {
      // Final blitz question — all correct, experts score
      phrase = `Блестяще! Все три вопроса отвечены верно! Правильный ответ — ${correctAnswer}. Знатоки зарабатывают очко за блиц. Счёт ${score.experts + 1}:${score.viewers}.`
    }
  } else {
    const idx = round_number % (correct ? CORRECT_PHRASES.length : WRONG_PHRASES.length)
    phrase = correct
      ? CORRECT_PHRASES[idx](correctAnswer, score)
      : WRONG_PHRASES[idx](correctAnswer, score)
  }

  const explanation = correct
    ? `Знатоки відповіли правильно. Правильна відповідь: ${correctAnswer}.`
    : `На жаль, знатоки помилилися. Правильна відповідь: ${correctAnswer}.`

  return {
    correct,
    score_delta: 1,
    who_scores: correct ? 'experts' : 'viewers',
    moderator_phrase: phrase,
    correct_answer_reveal: correctAnswer,
    explanation,
  }
}

export async function mockCommentary(context) {
  await delay(500)
  const { score } = context
  if (score.experts === score.viewers) {
    return `Счёт равный — ${score.experts}:${score.viewers}. Напряжение нарастает. Продолжаем!`
  }
  return `Что наша жизнь? Игра!`
}

// ── Whisper mock ──────────────────────────────────────────────────────────────

// Returns a random plausible-looking transcript
const MOCK_TRANSCRIPTS = [
  'Хайзенберг',
  'Метамфетамин',
  'Чёрный ящик содержит синтетику',
  'Я не знаю правильного ответа',
  'Уолтер Уайт',
  'Полос Эрмандос',
  'Альбукерке',
]

export async function mockTranscribeAudio(_blob) {
  await delay(600)
  return MOCK_TRANSCRIPTS[Math.floor(Math.random() * MOCK_TRANSCRIPTS.length)]
}

// ── TTS mock ──────────────────────────────────────────────────────────────────

// Preferred male voice names (Windows / macOS / Linux)
const MALE_VOICE_NAMES = [
  'microsoft pavel',   // Windows Russian male
  'microsoft dmitry',
  'yuri',
  'pavel',
  'dmitry',
  'male',
  'google русский',
]

function pickMaleVoice(voices) {
  // 1. Russian male by name
  for (const hint of MALE_VOICE_NAMES) {
    const v = voices.find((v) => v.name.toLowerCase().includes(hint))
    if (v) return v
  }
  // 2. Any Russian voice (better than nothing)
  const ru = voices.find((v) => v.lang.startsWith('ru'))
  if (ru) return ru
  // 3. Any English male by name
  const en = voices.find((v) => v.name.toLowerCase().includes('male'))
  if (en) return en
  return null
}

// Uses Web Speech API as fallback, or just resolves after delay
export async function mockSpeak(text, { onStart, onEnd } = {}) {
  onStart?.()

  if ('speechSynthesis' in window) {
    // Voices may load async — wait for them if empty
    let voices = window.speechSynthesis.getVoices()
    if (voices.length === 0) {
      await new Promise((res) => {
        window.speechSynthesis.onvoiceschanged = () => { res(); }
        setTimeout(res, 1000) // fallback timeout
      })
      voices = window.speechSynthesis.getVoices()
    }

    return new Promise((resolve) => {
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.lang = 'ru-RU'
      utterance.rate = 0.82   // slow, authoritative
      utterance.pitch = 0.6   // deep male pitch

      const maleVoice = pickMaleVoice(voices)
      if (maleVoice) utterance.voice = maleVoice

      utterance.onend = () => {
        onEnd?.()
        resolve()
      }
      utterance.onerror = () => {
        onEnd?.()
        resolve()
      }

      window.speechSynthesis.speak(utterance)
    })
  }

  // Fallback: estimate duration from text length (~120 words/min)
  const words = text.split(/\s+/).length
  const durationMs = Math.max(1000, (words / 120) * 60 * 1000)
  await delay(durationMs)
  onEnd?.()
}

export function mockStopSpeaking() {
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel()
  }
}

export function mockIsSpeaking() {
  return 'speechSynthesis' in window && window.speechSynthesis.speaking
}

// ── Recorder mock ─────────────────────────────────────────────────────────────

export async function mockStartRecording() {
  // Return a fake recorder object
  return { _mock: true, _startTime: Date.now() }
}

export async function mockStopRecording(_recorder) {
  await delay(300)
  return new Blob(['mock'], { type: 'audio/webm' })
}
