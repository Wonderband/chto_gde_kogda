export const STATES = {
  IDLE: 'IDLE',
  ANNOUNCING: 'ANNOUNCING', // ← TTS announces round number before wheel spins
  SPINNING: 'SPINNING',
  READING: 'READING',
  DISCUSSING: 'DISCUSSING',
  LISTENING: 'LISTENING',
  EVALUATING: 'EVALUATING',
  SCORING: 'SCORING',
  EXPLAINING: 'EXPLAINING', // ← moderator narrates reasoning + reveals answer + announces score
  READY: 'READY',           // ← between rounds: waiting for Space to spin again
  GAME_OVER: 'GAME_OVER',
}

export const EVENTS = {
  START: 'START',
  ANNOUNCING_DONE: 'ANNOUNCING_DONE', // ← TTS round announcement finished → start spinning
  SPIN_DONE: 'SPIN_DONE',
  READING_DONE: 'READING_DONE',
  EARLY_ANSWER: 'EARLY_ANSWER',
  TIMER_DONE: 'TIMER_DONE',
  RECORDING_DONE: 'RECORDING_DONE',
  EVALUATION_DONE: 'EVALUATION_DONE',
  CLARIFICATION_NEEDED: 'CLARIFICATION_NEEDED',
  SCORING_DONE: 'SCORING_DONE',
  EXPLAINING_DONE: 'EXPLAINING_DONE', // ← score applied here, scoreboard flips after this
  NEXT_ROUND: 'NEXT_ROUND',  // ← Space after scoring
  GAME_OVER: 'GAME_OVER',
  RESTART: 'RESTART',
}

const transitions = {
  [STATES.IDLE]: {
    [EVENTS.START]: STATES.ANNOUNCING,
  },
  [STATES.ANNOUNCING]: {
    [EVENTS.ANNOUNCING_DONE]: STATES.SPINNING,
  },
  [STATES.SPINNING]: {
    [EVENTS.SPIN_DONE]: STATES.READING,
  },
  [STATES.READING]: {
    [EVENTS.READING_DONE]: STATES.DISCUSSING,
    // EARLY_ANSWER not allowed here — wait for timer to start
  },
  [STATES.DISCUSSING]: {
    [EVENTS.TIMER_DONE]: STATES.LISTENING,
    [EVENTS.EARLY_ANSWER]: STATES.LISTENING,
  },
  [STATES.LISTENING]: {
    [EVENTS.RECORDING_DONE]: STATES.EVALUATING,
  },
  [STATES.EVALUATING]: {
    [EVENTS.EVALUATION_DONE]: STATES.SCORING,
    [EVENTS.CLARIFICATION_NEEDED]: STATES.LISTENING,
  },
  [STATES.SCORING]: {
    [EVENTS.SCORING_DONE]: STATES.EXPLAINING, // ← neutral segue cue, then EXPLAINING
  },
  [STATES.EXPLAINING]: {
    [EVENTS.EXPLAINING_DONE]: STATES.READY,   // ← score applied here
  },
  [STATES.READY]: {
    [EVENTS.NEXT_ROUND]: STATES.ANNOUNCING,  // ← Space triggers this → announce round → spin
  },
  [STATES.GAME_OVER]: {
    [EVENTS.RESTART]: STATES.IDLE,
  },
}

export function getNextState(currentState, event) {
  const stateTransitions = transitions[currentState]
  if (!stateTransitions) return currentState
  return stateTransitions[event] ?? currentState
}
