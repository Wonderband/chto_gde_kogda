export default function Envelopes({ selectedSector }) {
  return (
    <div className="envelopes-wrap">
      <div className="envelopes-grid">
        {Array.from({ length: 13 }, (_, i) => (
          <div
            key={i}
            className={`env-card ${selectedSector === i ? 'env-selected envelope-glow' : ''}`}
          >
            <div className="env-flap" />
            <div className="env-body">
              <span className="env-icon">✉</span>
            </div>
            <div className="env-num">{i + 1}</div>
          </div>
        ))}
      </div>

      <style>{`
        .envelopes-wrap {
          padding: 1rem;
        }
        .envelopes-grid {
          display: grid;
          grid-template-columns: repeat(7, 80px);
          grid-template-rows: repeat(2, 80px);
          gap: 10px;
          justify-content: center;
        }
        /* Last row: 6 items centered — offset by half a cell */
        .env-card:nth-child(8) { grid-column: 1; }

        .env-card {
          width: 80px;
          height: 80px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          background: linear-gradient(160deg, #172817 0%, #0f200f 100%);
          border: 1px solid var(--border-gold);
          border-radius: 8px;
          cursor: default;
          position: relative;
          transition: border-color 0.2s, background 0.2s;
          overflow: hidden;
        }

        /* V-shape flap on top like real envelope */
        .env-flap {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 34px;
          clip-path: polygon(0% 0%, 100% 0%, 50% 100%);
          background: rgba(201,168,76,0.06);
          border-bottom: 1px solid var(--border-gold);
        }

        .env-body {
          display: flex;
          align-items: center;
          justify-content: center;
          flex: 1;
          padding-top: 12px;
        }
        .env-icon {
          font-size: 1.7rem;
          color: var(--accent-gold);
          opacity: 0.7;
          transition: opacity 0.2s;
        }
        .env-num {
          position: absolute;
          bottom: 5px;
          right: 7px;
          font-size: 0.65rem;
          color: var(--text-dim);
          font-family: monospace;
        }

        .env-selected {
          background: linear-gradient(160deg, #1e3c1e 0%, #152815 100%);
          border-color: var(--accent-gold) !important;
        }
        .env-selected .env-icon {
          opacity: 1;
          text-shadow: 0 0 12px var(--accent-gold);
        }
        .env-selected .env-flap {
          background: rgba(201,168,76,0.12);
        }
      `}</style>
    </div>
  )
}
