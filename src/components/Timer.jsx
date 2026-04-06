import { TIMER_WARNING_SEC, TIMER_DANGER_SEC } from "../config.js"

const SIZE = 220
const STROKE_BG = 10
const STROKE_FG = 12
const R = (SIZE - STROKE_FG - 4) / 2
const CX = SIZE / 2
const CY = SIZE / 2
const CIRC = 2 * Math.PI * R

export default function Timer({ seconds, maxSeconds = 60, paused }) {
  const pct = Math.max(0, Math.min(1, seconds / maxSeconds))
  const dashOffset = CIRC * (1 - pct)
  const isWarning = seconds <= TIMER_WARNING_SEC && seconds > 0
  const isDanger  = seconds <= TIMER_DANGER_SEC  && seconds > 0
  const isEmpty = seconds <= 0

  const arcColor = isEmpty
    ? 'var(--text-dim)'
    : isDanger
    ? '#ff3a00'
    : isWarning
    ? 'var(--timer-warning)'
    : 'var(--timer-normal)'

  const textColor = isEmpty ? 'var(--text-dim)' : arcColor

  return (
    <div className={`timer-container ${isWarning ? 'timer-warning-anim' : ''}`}>
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
        <defs>
          <filter id="timerGlow">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {/* Background track */}
        <circle
          cx={CX} cy={CY} r={R}
          fill="none"
          stroke="rgba(201,168,76,0.08)"
          strokeWidth={STROKE_BG}
        />

        {/* Tick marks (12 marks = every 5 seconds) */}
        {Array.from({ length: 12 }, (_, i) => {
          const a = ((i / 12) * 360 - 90) * (Math.PI / 180)
          const r1 = R + STROKE_FG / 2 + 4
          const r2 = r1 + 6
          return (
            <line
              key={i}
              x1={CX + r1 * Math.cos(a)} y1={CY + r1 * Math.sin(a)}
              x2={CX + r2 * Math.cos(a)} y2={CY + r2 * Math.sin(a)}
              stroke="rgba(201,168,76,0.3)"
              strokeWidth="1.5"
            />
          )
        })}

        {/* Progress arc */}
        <circle
          cx={CX} cy={CY} r={R}
          fill="none"
          stroke={arcColor}
          strokeWidth={STROKE_FG}
          strokeLinecap="round"
          strokeDasharray={CIRC}
          strokeDashoffset={dashOffset}
          transform={`rotate(-90 ${CX} ${CY})`}
          filter={isWarning ? 'url(#timerGlow)' : undefined}
          style={{
            transition: 'stroke-dashoffset 0.95s linear, stroke 0.4s ease',
          }}
        />

        {/* Seconds number */}
        <text
          x={CX} y={CY - 8}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize="62"
          fontFamily="Georgia, serif"
          fontWeight="bold"
          fill={textColor}
          style={{ transition: 'fill 0.4s' }}
        >
          {seconds}
        </text>

        {/* "СЕК" label */}
        <text
          x={CX} y={CY + 34}
          textAnchor="middle"
          fontSize="12"
          fontFamily="Georgia, serif"
          letterSpacing="4"
          fill="var(--text-dim)"
        >
          {paused ? 'ПАУЗА' : 'СЕК'}
        </text>
      </svg>

      <style>{`
        .timer-container {
          display: inline-flex;
          filter: drop-shadow(0 0 12px rgba(201,168,76,0.2));
        }
      `}</style>
    </div>
  )
}
