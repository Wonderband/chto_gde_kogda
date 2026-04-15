import { createContext, useContext, useReducer, useCallback } from "react";
import { STATES, EVENTS } from "./gameStateMachine";
import { loadQuestions, getBlitzSubQuestions } from "./questions";
import { WINNING_SCORE } from "../config.js";

const initialState = {
  gameState: STATES.IDLE,
  score: { experts: 0, viewers: 0 },
  currentQuestion: null,
  questions: [],
  blitzQueue: [], // remaining blitz sub-questions for the current blitz round
  roundNumber: 0,
  transcript: "",
  evaluation: null,
  retryCount: 0,
  isRecording: false,
  ttsPlaying: false,
  earlyAnswer: false,
  winner: null, // 'experts' | 'viewers'
  lastResponseId: null, // OpenAI Responses API — stateful game continuity
};

function reducer(state, action) {
  console.log("[GameContext][Reducer]", {
    from: state.gameState,
    action: action.type,
    payload: action.payload,
  });
  switch (action.type) {
    case EVENTS.START: {
      const questions = loadQuestions();
      return {
        ...initialState,
        gameState: STATES.ANNOUNCING,
        questions,
      };
    }

    case "SET_LAST_RESPONSE_ID":
      return { ...state, lastResponseId: action.payload };

    case EVENTS.RESTART:
      return { ...initialState };

    case EVENTS.SPIN_DONE: {
      const sector = action.payload?.sector ?? 0;
      const first = state.questions[sector];

      if (!first) {
        // Guard: should not happen since the wheel skips opened sectors
        console.warn("[GameContext][SPIN_DONE] No question at sector", sector);
        return state;
      }

      // Null out this sector slot — preserves all other sector indices
      const questionsAfter = state.questions.map((q, i) => (i === sector ? null : q));

      // Blitz: load Q2/Q3 from the source data (they are not in state.questions)
      if (first?.round_type === "blitz") {
        const allInGroup = getBlitzSubQuestions(first.blitz_group);
        const blitzQueue = allInGroup.filter((q) => q.blitz_position > 1);

        return {
          ...state,
          gameState: STATES.READING,
          currentQuestion: first,
          blitzQueue,
          questions: questionsAfter,
          roundNumber: state.roundNumber + 1,
          transcript: "",
          evaluation: null,
          retryCount: 0,
          earlyAnswer: false,
        };
      }

      // Standard question
      return {
        ...state,
        gameState: STATES.READING,
        currentQuestion: first,
        blitzQueue: [],
        questions: questionsAfter,
        roundNumber: state.roundNumber + 1,
        transcript: "",
        evaluation: null,
        retryCount: 0,
        earlyAnswer: false,
      };
    }

    case EVENTS.READING_DONE:
      if (state.gameState !== STATES.READING) return state;
      return { ...state, gameState: STATES.DISCUSSING };

    case EVENTS.EARLY_ANSWER:
      return {
        ...state,
        gameState: STATES.LISTENING,
        earlyAnswer: true,
      };

    case EVENTS.TIMER_DONE:
      return { ...state, gameState: STATES.LISTENING };

    case "SET_RECORDING":
      return { ...state, isRecording: action.payload };

    case EVENTS.RECORDING_DONE:
      return {
        ...state,
        gameState: STATES.EVALUATING,
        transcript: action.payload,
        isRecording: false,
      };

    case "SET_TTS_PLAYING":
      return { ...state, ttsPlaying: action.payload };

    case EVENTS.CLARIFICATION_NEEDED:
      return {
        ...state,
        gameState: STATES.LISTENING,
        transcript: "",
        retryCount: state.retryCount + 1,
      };

    case EVENTS.EVALUATION_DONE:
      return {
        ...state,
        gameState: STATES.SCORING,
        evaluation: action.payload,
      };

    case EVENTS.SCORING_DONE: {
      // Always go to EXPLAINING — each question (including intermediate blitz) gets
      // its own full evaluation ritual (intrigue → answer reveal → verdict).
      // Blitz advancement and score application are both handled in EXPLAINING_DONE.
      return { ...state, gameState: STATES.EXPLAINING };
    }

    case EVENTS.EXPLAINING_DONE: {
      const { who_scores } = state.evaluation;

      // Intermediate blitz: explicit flag set at evaluation time → advance without scoring
      if (state.evaluation?.blitz_intermediate === true) {
        const [nextQ, ...blitzRemaining] = state.blitzQueue;
        // roundNumber stays the same — Q2/Q3 are part of the same blitz round as Q1
        return {
          ...state,
          gameState: STATES.READING,
          currentQuestion: nextQ,
          blitzQueue: blitzRemaining,
          transcript: "",
          evaluation: null,
          retryCount: 0,
          earlyAnswer: false,
        };
      }

      // Final blitz question (all correct or wrong answer) OR standard question → apply score
      const newScore = {
        experts: state.score.experts + (who_scores === "experts" ? 1 : 0),
        viewers: state.score.viewers + (who_scores === "viewers" ? 1 : 0),
      };
      const expertWon = newScore.experts >= WINNING_SCORE;
      const viewerWon = newScore.viewers >= WINNING_SCORE;
      const isOver = expertWon || viewerWon;
      return {
        ...state,
        score: newScore,
        blitzQueue: [],
        gameState: isOver ? STATES.GAME_OVER : STATES.READY,
        winner: expertWon ? "experts" : viewerWon ? "viewers" : null,
      };
    }

    case EVENTS.NEXT_ROUND:
      return { ...state, gameState: STATES.ANNOUNCING };

    case EVENTS.ANNOUNCING_DONE:
      return { ...state, gameState: STATES.SPINNING };

    default:
      return state;
  }
}

const GameContext = createContext(null);

export function GameProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  const send = useCallback((event, payload) => {
    console.log("[GameContext][send]", { event, payload });
    dispatch({ type: event, payload });
  }, []);

  return (
    <GameContext.Provider value={{ state, send }}>
      {children}
    </GameContext.Provider>
  );
}

export function useGame() {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error("useGame must be used inside GameProvider");
  return ctx;
}
