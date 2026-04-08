// Mock responses for all AI services
// Used when VITE_USE_MOCK=true in .env

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

// ── Claude mocks ──────────────────────────────────────────────────────────────

const READ_QUESTION_INTROS = [
  (char, city) =>
    `Увага! Проти знавців грає ${char} із міста ${city}.\n\nУвага... питання!`,
  (char, city) =>
    `Питання надіслав ${char} із міста ${city}. Слухайте уважно.\n\nУвага, питання!`,
  (char, city) =>
    `Проти знавців грає ${char}.\n\nХвилина обговорення!`,
]

export async function mockReadQuestion(context) {
  await delay(800)
  const { current_question, round_number } = context
  const char = current_question?.character || 'Волтер Вайт'
  const city = 'Альбукерке, Нью-Мексико'
  const intro = READ_QUESTION_INTROS[round_number % READ_QUESTION_INTROS.length](char, city)
  const questionText = current_question?.question_text || 'Питання не завантажено.'
  return `${intro}\n\n${questionText}`
}

const CORRECT_PHRASES = [
  (answer, score) =>
    `Абсолютно правильно! Правильна відповідь — ${answer}. Знавці заробляють очко. Рахунок стає ${score.experts + 1}:${score.viewers} на користь знавців.`,
  (answer, score) =>
    `Правильна відповідь — ${answer}. Що наше життя? Гра! Рахунок ${score.experts + 1}:${score.viewers}.`,
  (answer, score) =>
    `Правильно! ${answer}. Знавці заробляють очко. Продовжуємо. Рахунок ${score.experts + 1}:${score.viewers}.`,
]

const WRONG_PHRASES = [
  (answer, score) =>
    `На жаль, це неправильна відповідь. Правильна відповідь — ${answer}. Очко отримують телеглядачі. Рахунок ${score.experts}:${score.viewers + 1}.`,
  (answer, score) =>
    `Ні. Правильна відповідь — ${answer}. Телеглядачі заробляють очко. Рахунок ${score.experts}:${score.viewers + 1}.`,
]

export async function mockEvaluateAnswer(context) {
  await delay(1200)
  const { current_question, team_answer_transcript } = context
  const correctAnswer = current_question?.correct_answer || '?'
  const variants = current_question?.answer_variants || [correctAnswer]

  // Simple substring matching against correct answer and accepted variants (case-insensitive)
  const transcript = (team_answer_transcript || '').toLowerCase()
  const correct =
    variants.some((v) => transcript.includes(v.toLowerCase())) ||
    transcript.includes(correctAnswer.toLowerCase())

  // Return only judgment — explanation is built by useGamePhaseEffects.buildSpeechText
  return {
    correct,
    correct_answer_reveal: correctAnswer,
  }
}

export async function mockCommentary(context) {
  await delay(500)
  const { score } = context
  if (score.experts === score.viewers) {
    return `Рахунок рівний — ${score.experts}:${score.viewers}. Напруження наростає. Продовжуємо!`
  }
  return `Що наше життя? Гра!`
}

// ── Whisper mock ──────────────────────────────────────────────────────────────

// Returns a random plausible-looking transcript
// Includes correct answers for blitz questions so mock mode can exercise the advance-blitz path
const MOCK_TRANSCRIPTS = [
  'Хайзенберг',
  'Метамфетамін',
  'Уїтмен',         // matches blitz Q1 (Walt Whitman)
  'Флінн',          // matches blitz Q2 (Walter White Jr. / Flynn)
  'Скайлер',        // matches blitz Q3 (Skyler White)
  'Волтер Вайт',
  'Поллос Ерманос',
  'Альбукерке',
  'Я не знаю правильної відповіді',
]

export async function mockTranscribeAudio(_blob) {
  await delay(600)
  return MOCK_TRANSCRIPTS[Math.floor(Math.random() * MOCK_TRANSCRIPTS.length)]
}

// ── TTS mock ──────────────────────────────────────────────────────────────────

// Preferred male voice names for Ukrainian / fallback Russian (Windows / macOS / Linux)
const MALE_VOICE_NAMES = [
  'microsoft Oleksandr',  // Windows Ukrainian male
  'microsoft andrii',
  'oleksandr',
  'dmytro',
  'microsoft pavel',      // fallback Russian male
  'microsoft dmitry',
  'yuri',
  'pavel',
  'dmitry',
  'male',
]

function pickMaleVoice(voices) {
  // 1. Ukrainian voice by name
  for (const hint of MALE_VOICE_NAMES) {
    const v = voices.find((v) => v.name.toLowerCase().includes(hint))
    if (v) return v
  }
  // 2. Any Ukrainian voice
  const uk = voices.find((v) => v.lang.startsWith('uk'))
  if (uk) return uk
  // 3. Any Russian voice (better than nothing)
  const ru = voices.find((v) => v.lang.startsWith('ru'))
  if (ru) return ru
  // 4. Any English male by name
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
      utterance.lang = 'uk-UA'
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
