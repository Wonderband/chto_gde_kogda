const CHARACTER_META = {
  'Walter White':    { city: 'Альбукерке, Нью-Мексико', img: '/characters/walter.jpg', desc: 'вчитель хімії' },
  'Jesse Pinkman':  { city: 'Альбукерке, Нью-Мексико', img: '/characters/jesse.jpg',  desc: 'вуличний хімік' },
  'Saul Goodman':   { city: 'Альбукерке, Нью-Мексико', img: '/characters/saul.jpg',   desc: 'адвокат' },
  'Skyler White':   { city: 'Альбукерке, Нью-Мексико', img: '/characters/skyler.jpg', desc: 'бухгалтер' },
  'Hank Schrader':  { city: 'Альбукерке, Нью-Мексико', img: '/characters/hank.jpg',   desc: 'агент DEA' },
  'Mike Ehrmantraut': { city: 'Філадельфія',            img: '/characters/mike.jpg',   desc: 'фіксер' },
  'Gustavo Fring':  { city: 'Сантьяго, Чилі',          img: '/characters/gus.jpg',    desc: 'власник Pollos Hermanos' },
  'Jane Margolis':  { city: 'Альбукерке, Нью-Мексико', img: '/characters/jane.jpg',   desc: 'художниця' },
  'Todd Alquist':   { city: 'Альбукерке, Нью-Мексико', img: '/characters/todd.jpg',   desc: 'хімік-самоук' },
}

const ROUND_LABELS = {
  standard: 'Стандартний раунд',
  blitz: 'Бліц',
  super_blitz: 'Суперблиц',
  black_box: 'Чорний ящик',
}

import { GAME_LANGUAGE } from '../config.js'

export default function QuestionCard({ question, evaluation, hideText = false }) {
  if (!question) return null

  const qText = GAME_LANGUAGE === 'uk' ? question.question_uk : question.question_ru
  const meta = CHARACTER_META[question.character] || { city: 'Невідоме місто', img: null, desc: '' }
  const roundLabel = ROUND_LABELS[question.round_type] || question.round_type

  return (
    <div className="qcard fade-in-up">
      {/* Header — character */}
      <div className="qcard-header">
        <div className="qcard-avatar-wrap">
          {meta.img ? (
            <img
              src={meta.img}
              alt={question.character}
              className="qcard-avatar"
              onError={(e) => {
                e.target.style.display = 'none'
                e.target.nextSibling.style.display = 'flex'
              }}
            />
          ) : null}
          <div className="qcard-avatar-fallback" style={{ display: meta.img ? 'none' : 'flex' }}>
            <span>?</span>
          </div>
        </div>

        <div className="qcard-character">
          <div className="qcard-character-name">{question.character}</div>
          <div className="qcard-character-city">{meta.city}</div>
          {meta.desc && <div className="qcard-character-desc">{meta.desc}</div>}
        </div>

        <div className="qcard-round-badge">{roundLabel}</div>
      </div>

      <div className="qcard-divider" />

      {/* Question text — hidden during READING so players hear it first */}
      {hideText ? (
        <div className="qcard-question qcard-question-hidden">
          <span className="qcard-listening-dot" />
          <span className="qcard-listening-dot" />
          <span className="qcard-listening-dot" />
        </div>
      ) : (
        <div className="qcard-question">{qText}</div>
      )}

      {/* Answer reveal */}
      {evaluation && (
        <div className={`qcard-result ${evaluation.correct ? 'result-correct result-correct-anim' : 'result-wrong result-wrong-anim'}`}>
          <div className="qcard-verdict">
            {evaluation.correct ? '✓ ПРАВИЛЬНО' : '✗ НЕПРАВИЛЬНО'}
          </div>
          <div className="qcard-answer-text">
            Правильна відповідь: <strong>{evaluation.correct_answer_reveal}</strong>
          </div>
        </div>
      )}

      <style>{`
        .qcard {
          background: linear-gradient(160deg, #0e1e0e 0%, #09120a 100%);
          border: 1px solid var(--border-gold-strong);
          border-radius: 14px;
          overflow: hidden;
          max-width: 860px;
          width: 100%;
          box-shadow: 0 8px 40px rgba(0,0,0,0.7), var(--shadow-gold);
        }
        .qcard-header {
          display: flex;
          align-items: center;
          gap: 1.4rem;
          padding: 1.4rem 1.8rem;
          background: rgba(0,0,0,0.3);
          position: relative;
        }
        .qcard-avatar-wrap {
          flex-shrink: 0;
          width: 88px;
          height: 88px;
          border-radius: 50%;
          overflow: hidden;
          border: 2px solid var(--accent-gold);
          box-shadow: 0 0 16px rgba(201,168,76,0.3);
        }
        .qcard-avatar {
          width: 100%;
          height: 100%;
          object-fit: cover;
          object-position: top center;
        }
        .qcard-avatar-fallback {
          width: 100%;
          height: 100%;
          background: var(--bg-table);
          align-items: center;
          justify-content: center;
          font-size: 2rem;
          color: var(--text-dim);
        }
        .qcard-character {
          flex: 1;
        }
        .qcard-character-name {
          font-size: clamp(1.3rem, 2.2vw, 2rem);
          color: var(--accent-gold);
          font-family: Georgia, serif;
          line-height: 1.2;
        }
        .qcard-character-city {
          font-size: var(--font-label);
          color: var(--text-secondary);
          margin-top: 0.2rem;
        }
        .qcard-character-desc {
          font-size: 0.85rem;
          color: var(--text-dim);
          font-style: italic;
          margin-top: 0.15rem;
        }
        .qcard-round-badge {
          font-size: 0.75rem;
          letter-spacing: 0.12em;
          padding: 0.25rem 0.7rem;
          border: 1px solid var(--border-gold);
          border-radius: 20px;
          color: var(--text-secondary);
          text-transform: uppercase;
          white-space: nowrap;
        }
        .qcard-divider {
          height: 1px;
          background: linear-gradient(90deg, transparent, var(--border-gold-strong), transparent);
        }
        .qcard-question {
          padding: 1.6rem 1.8rem;
          font-size: clamp(1.2rem, 2vw, 1.8rem);
          line-height: 1.65;
          color: var(--text-primary);
          font-family: Georgia, serif;
        }
        .qcard-question-hidden {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.6rem;
          min-height: 6rem;
        }
        .qcard-listening-dot {
          display: inline-block;
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background: var(--accent-gold);
          opacity: 0.4;
          animation: dot-pulse 1.4s ease-in-out infinite;
        }
        .qcard-listening-dot:nth-child(2) { animation-delay: 0.2s; }
        .qcard-listening-dot:nth-child(3) { animation-delay: 0.4s; }
        @keyframes dot-pulse {
          0%, 80%, 100% { transform: scale(0.8); opacity: 0.3; }
          40%            { transform: scale(1.2); opacity: 1; }
        }
        .qcard-result {
          margin: 0 1.4rem 1.4rem;
          border-radius: 10px;
          padding: 1rem 1.4rem;
          border-top: none;
        }
        .qcard-verdict {
          font-size: clamp(1.2rem, 2vw, 1.8rem);
          font-weight: bold;
          letter-spacing: 0.08em;
          margin-bottom: 0.4rem;
        }
        .result-correct .qcard-verdict { color: var(--score-experts); }
        .result-wrong .qcard-verdict   { color: var(--score-viewers); }
        .qcard-answer-text {
          font-size: var(--font-label);
          color: var(--text-secondary);
        }
        .qcard-answer-text strong {
          color: var(--text-primary);
          font-size: 1.1em;
        }
      `}</style>
    </div>
  )
}
