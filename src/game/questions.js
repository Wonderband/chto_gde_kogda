import allQuestions from '../data/questions.json'

export function shuffleQuestions(questions) {
  const arr = [...questions]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

/**
 * Returns one question per wheel sector (12 slots).
 * Blitz sub-questions (position > 1) are excluded — they are loaded on-demand
 * via getBlitzSubQuestions when a blitz round fires.
 */
export function loadQuestions() {
  const slotQuestions = allQuestions.filter(
    (q) => !q.blitz_position || q.blitz_position === 1
  )
  return shuffleQuestions(slotQuestions)
}

/**
 * Returns all questions belonging to the given blitz group, sorted by position.
 * Used by the reducer when a blitz round fires to load Q2/Q3 into blitzQueue.
 */
export function getBlitzSubQuestions(blitzGroup) {
  return allQuestions
    .filter((q) => q.blitz_group === blitzGroup)
    .sort((a, b) => (a.blitz_position || 0) - (b.blitz_position || 0))
}

export function getQuestionById(id) {
  return allQuestions.find((q) => q.id === id) ?? null
}
