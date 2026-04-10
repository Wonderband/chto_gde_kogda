import { useEffect, useRef, useState } from "react";
import { SPIN_DURATION_MS } from "../config.js";

const SECTORS = 12;
const SIZE = 620;
const CX = SIZE / 2;
const CY = SIZE / 2;

const R_TABLE = 294;
const R_BRASS_O = 284;
const R_BRASS_I = 269;
const R_OUTER = 266;
const R_INNER = 56;

const ENV_W = 96;
const ENV_H = 64;
const ENV_R = R_INNER + (R_OUTER - R_INNER) * 0.7;

const PTR_TIP = R_INNER + (R_OUTER - R_INNER) * 0.62;

const STEP = 360 / SECTORS;

function polar(r, deg) {
  const rad = (deg * Math.PI) / 180;
  return { x: CX + r * Math.cos(rad), y: CY + r * Math.sin(rad) };
}

function arcPath(rOut, rIn, a1, a2) {
  const p1 = polar(rOut, a1),
    p2 = polar(rOut, a2);
  const p3 = polar(rIn, a2),
    p4 = polar(rIn, a1);
  const lg = a2 - a1 > 180 ? 1 : 0;
  return `M${p1.x} ${p1.y} A${rOut} ${rOut} 0 ${lg} 1 ${p2.x} ${p2.y} L${p3.x} ${p3.y} A${rIn} ${rIn} 0 ${lg} 0 ${p4.x} ${p4.y}Z`;
}

const sectorStart = (i) => STEP * i - 90;
const sectorMid = (i) => STEP * i - 90 + STEP / 2;
const arrowRotForSector = (i) => sectorMid(i) + 90;

function CwArrow({ mid }) {
  const r = ENV_R;
  const span = 11;

  const p1 = polar(r, mid - span + 2);
  const p2 = polar(r, mid + span);

  const pB = polar(r, mid + span - 5);
  const dx = p2.x - pB.x,
    dy = p2.y - pB.y;
  const dist = Math.hypot(dx, dy) || 1;
  const ux = dx / dist,
    uy = dy / dist;
  const nx = -uy * 11,
    ny = ux * 11;
  const tip = { x: p2.x + ux * 13, y: p2.y + uy * 13 };

  return (
    <g>
      <path
        d={`M${p1.x} ${p1.y} A${r} ${r} 0 0 1 ${p2.x} ${p2.y}`}
        fill="none"
        stroke="#c9a84c"
        strokeWidth="6"
        strokeLinecap="round"
      />
      <polygon
        points={`${tip.x},${tip.y} ${p2.x - nx},${p2.y - ny} ${p2.x + nx},${
          p2.y + ny
        }`}
        fill="#c9a84c"
      />
    </g>
  );
}

function Envelope({ number, fading }) {
  return (
    <g
      style={{
        opacity: fading ? 0 : 1,
        transition: fading ? "opacity 0.55s ease-in" : "none",
      }}
    >
      <rect
        x={-ENV_W / 2}
        y={-ENV_H / 2}
        width={ENV_W}
        height={ENV_H}
        rx="4"
        ry="4"
        fill="url(#envGrad)"
        stroke="rgba(150,130,100,0.55)"
        strokeWidth="1"
        filter="url(#envShadow)"
      />
      <polyline
        points={`${-ENV_W / 2},${-ENV_H / 2} 0,${-ENV_H * 0.05} ${ENV_W / 2},${
          -ENV_H / 2
        }`}
        fill="none"
        stroke="rgba(130,110,80,0.45)"
        strokeWidth="0.9"
      />
      <line
        x1={-ENV_W / 2}
        y1={-ENV_H / 2}
        x2={0}
        y2={ENV_H * 0.12}
        stroke="rgba(130,110,80,0.3)"
        strokeWidth="0.7"
      />
      <line
        x1={ENV_W / 2}
        y1={-ENV_H / 2}
        x2={0}
        y2={ENV_H * 0.12}
        stroke="rgba(130,110,80,0.3)"
        strokeWidth="0.7"
      />
      <text
        x="0"
        y="4"
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize="28"
        fontWeight="bold"
        fontFamily="Georgia,'Times New Roman',serif"
        fill="#c41010"
        stroke="rgba(60,0,0,0.25)"
        strokeWidth="0.5"
        style={{ userSelect: "none" }}
      >
        {number}
      </text>
    </g>
  );
}

export default function Roulette({
  spinning,
  onStop,
  onTarget,
  selectedSector,
  durationMs = SPIN_DURATION_MS,
}) {
  const [arrowAngle, setArrowAngle] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  const [openingSector, setOpeningSector] = useState(null);
  const [openedSectors, setOpenedSectors] = useState(new Set());
  const [spinDurationMs, setSpinDurationMs] = useState(durationMs);
  const spinTimer = useRef(null);
  const openTimer = useRef(null);
  const onStopRef = useRef(onStop);
  const onTargetRef = useRef(onTarget);
  const stoppedRef = useRef(false); // true after natural stop fires, until spinning resets

  useEffect(() => {
    onStopRef.current = onStop;
  }, [onStop]);

  useEffect(() => {
    onTargetRef.current = onTarget;
  }, [onTarget]);

  useEffect(() => {
    if (selectedSector == null) {
      setOpenedSectors(new Set());
      setOpeningSector(null);
    }
  }, [selectedSector]);

  useEffect(() => {
    if (!spinning) {
      stoppedRef.current = false; // reset for the next spin
      console.log("[Roulette][effect idle]", { spinning, isAnimating });
      return () => clearTimeout(spinTimer.current);
    }

    if (isAnimating || stoppedRef.current) {
      console.log("[Roulette][effect already animating or stopped]", { isAnimating, stopped: stoppedRef.current });
      return;
    }

    console.log("[Roulette][effect start spin]", { durationMs });

    setIsAnimating(true);
    const raw = Math.floor(Math.random() * SECTORS);
    let target = raw;
    for (let i = 0; i < SECTORS; i++) {
      if (!openedSectors.has(target)) break;
      target = (target + 1) % SECTORS;
    }
    console.log("[Roulette][target chosen]", { raw, target });
    onTargetRef.current?.(target);

    const spins = (22 + Math.floor(Math.random() * 6)) * 360;
    const targetAbsAngle = arrowRotForSector(target);
    const dur = durationMs;
    setSpinDurationMs(dur);

    setArrowAngle((prev) => {
      const currentNorm = ((prev % 360) + 360) % 360;
      let delta = targetAbsAngle - currentNorm;
      if (delta <= 0) delta += 360;
      return prev + spins + delta;
    });

    clearTimeout(spinTimer.current);
    spinTimer.current = setTimeout(() => {
      console.log("[Roulette][timeout fired]", { target, dur });
      stoppedRef.current = true; // block re-trigger while parent processes async stop
      setIsAnimating(false);
      onStopRef.current?.(target);
    }, dur);

    return () => {
      if (!spinning) {
        console.log("[Roulette][cleanup clear timer]");
        clearTimeout(spinTimer.current);
      }
    };
  }, [spinning, durationMs, isAnimating, openedSectors]);

  useEffect(() => {
    if (selectedSector != null && !spinning && !isAnimating) {
      console.log("[Roulette][open envelope]", { selectedSector });
      clearTimeout(openTimer.current);
      openTimer.current = setTimeout(() => {
        setOpeningSector(selectedSector);
        openTimer.current = setTimeout(() => {
          setOpenedSectors((prev) => new Set([...prev, selectedSector]));
          setOpeningSector(null);
        }, 650);
      }, 450);
    }
    return () => clearTimeout(openTimer.current);
  }, [selectedSector, spinning, isAnimating]);

  return (
    <div className="roulette-root">
      <div className="roulette-rim">
        <div style={{ position: "relative", width: SIZE, height: SIZE }}>
          <svg
            width={SIZE}
            height={SIZE}
            viewBox={`0 0 ${SIZE} ${SIZE}`}
            style={{ position: "absolute", top: 0, left: 0 }}
          >
            <defs>
              <radialGradient id="tableGlass" cx="40%" cy="35%" r="60%">
                <stop offset="0%" stopColor="#202020" />
                <stop offset="40%" stopColor="#111111" />
                <stop offset="100%" stopColor="#030303" />
              </radialGradient>
              <radialGradient id="glassShin" cx="30%" cy="25%" r="42%">
                <stop offset="0%" stopColor="rgba(255,255,255,0.09)" />
                <stop offset="100%" stopColor="rgba(255,255,255,0)" />
              </radialGradient>
              <linearGradient id="brassGrad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#f6e070" />
                <stop offset="25%" stopColor="#c9a84c" />
                <stop offset="50%" stopColor="#eed858" />
                <stop offset="75%" stopColor="#9a7020" />
                <stop offset="100%" stopColor="#dfc050" />
              </linearGradient>
              <linearGradient id="envGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#f9f7f0" />
                <stop offset="100%" stopColor="#e4ddc6" />
              </linearGradient>
              <radialGradient id="hubBase" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#1c1c1c" />
                <stop offset="100%" stopColor="#050505" />
              </radialGradient>
              <filter
                id="envShadow"
                x="-25%"
                y="-25%"
                width="150%"
                height="150%"
              >
                <feDropShadow
                  dx="0"
                  dy="3"
                  stdDeviation="4"
                  floodColor="#000"
                  floodOpacity="0.8"
                />
              </filter>
            </defs>

            <circle cx={CX} cy={CY} r={R_TABLE} fill="url(#tableGlass)" />
            <circle cx={CX} cy={CY} r={R_TABLE} fill="url(#glassShin)" />

            <circle
              cx={CX}
              cy={CY}
              r={(R_BRASS_O + R_BRASS_I) / 2}
              fill="none"
              stroke="url(#brassGrad)"
              strokeWidth={R_BRASS_O - R_BRASS_I}
            />
            <circle
              cx={CX}
              cy={CY}
              r={R_BRASS_I}
              fill="none"
              stroke="rgba(200,168,60,0.4)"
              strokeWidth="1.2"
            />

            {Array.from({ length: SECTORS }, (_, i) => {
              const a1 = sectorStart(i);
              const a2 = sectorStart(i + 1);
              const mid = sectorMid(i);
              const ep = polar(ENV_R, mid);
              const isOpened = openedSectors.has(i);
              const isOpening = openingSector === i;

              return (
                <g key={i}>
                  <path d={arcPath(R_OUTER, R_INNER, a1, a2)} fill="#080808" />
                  <line
                    x1={polar(R_INNER, a1).x}
                    y1={polar(R_INNER, a1).y}
                    x2={polar(R_OUTER, a1).x}
                    y2={polar(R_OUTER, a1).y}
                    stroke="#c9a84c"
                    strokeWidth="2"
                    opacity="0.8"
                  />
                  <CwArrow mid={mid} />
                  {!isOpened && (
                    <g
                      transform={`translate(${ep.x} ${ep.y}) rotate(${
                        mid + 90
                      })`}
                    >
                      <Envelope number={i + 1} fading={isOpening} />
                    </g>
                  )}
                </g>
              );
            })}

            <line
              x1={polar(R_INNER, sectorStart(0)).x}
              y1={polar(R_INNER, sectorStart(0)).y}
              x2={polar(R_OUTER, sectorStart(0)).x}
              y2={polar(R_OUTER, sectorStart(0)).y}
              stroke="#c9a84c"
              strokeWidth="2"
              opacity="0.8"
            />

            <circle
              cx={CX}
              cy={CY}
              r={R_INNER}
              fill="none"
              stroke="#c9a84c"
              strokeWidth="2.8"
              opacity="0.9"
            />
            <circle cx={CX} cy={CY} r={R_INNER - 1} fill="url(#hubBase)" />

            <path
              d={`M${CX - R_TABLE * 0.52} ${CY - R_TABLE * 0.48} A${
                R_TABLE * 0.78
              } ${R_TABLE * 0.48} 0 0 1 ${CX + R_TABLE * 0.52} ${
                CY - R_TABLE * 0.48
              }`}
              fill="none"
              stroke="rgba(255,255,255,0.032)"
              strokeWidth="26"
              strokeLinecap="round"
            />
          </svg>

          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: SIZE,
              height: SIZE,
              transform: `rotate(${arrowAngle}deg)`,
              transformOrigin: `${CX}px ${CY}px`,
              transition: isAnimating
                ? `transform ${spinDurationMs}ms cubic-bezier(0.08,0.92,0.16,1.0)`
                : "none",
              pointerEvents: "none",
            }}
          >
            <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
              <defs>
                <linearGradient id="ptrGrad" x1="0" y1="1" x2="0" y2="0">
                  <stop offset="0%" stopColor="#880808" />
                  <stop offset="55%" stopColor="#dd1818" />
                  <stop offset="100%" stopColor="#ff3a3a" />
                </linearGradient>
                <filter id="ptrGlow">
                  <feGaussianBlur stdDeviation="2.2" result="b" />
                  <feMerge>
                    <feMergeNode in="b" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>
              <g filter="url(#ptrGlow)">
                <polygon
                  points={`${CX - 5} ${CY + 18} ${CX + 5} ${CY + 18} ${
                    CX + 2.5
                  } ${CY - PTR_TIP + 16} ${CX - 2.5} ${CY - PTR_TIP + 16}`}
                  fill="url(#ptrGrad)"
                />
                <polygon
                  points={`${CX} ${CY - PTR_TIP} ${CX - 11} ${
                    CY - PTR_TIP + 20
                  } ${CX + 11} ${CY - PTR_TIP + 20}`}
                  fill="#ff2222"
                />
                <polygon
                  points={`${CX - 7} ${CY + 18} ${CX + 7} ${CY + 18} ${
                    CX + 5
                  } ${CY + 32} ${CX - 5} ${CY + 32}`}
                  fill="#771010"
                />
              </g>
            </svg>
          </div>

          <svg
            width={SIZE}
            height={SIZE}
            viewBox={`0 0 ${SIZE} ${SIZE}`}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              pointerEvents: "none",
            }}
          >
            <defs>
              <radialGradient id="domeRed" cx="36%" cy="30%" r="58%">
                <stop offset="0%" stopColor="#cc2020" />
                <stop offset="55%" stopColor="#921010" />
                <stop offset="100%" stopColor="#5e0808" />
              </radialGradient>
              <radialGradient id="domeShine" cx="28%" cy="22%" r="50%">
                <stop offset="0%" stopColor="rgba(255,255,255,0.55)" />
                <stop offset="100%" stopColor="rgba(255,255,255,0)" />
              </radialGradient>
            </defs>
            <circle
              cx={CX}
              cy={CY}
              r={30}
              fill="url(#domeRed)"
              stroke="#c9a84c"
              strokeWidth="2.5"
            />
            <circle
              cx={CX}
              cy={CY}
              r={22}
              fill="none"
              stroke="rgba(201,168,76,0.38)"
              strokeWidth="1.5"
            />
            <ellipse
              cx={CX - 7}
              cy={CY - 9}
              rx={13}
              ry={9}
              fill="url(#domeShine)"
              opacity="0.85"
            />
            <circle
              cx={CX}
              cy={CY}
              r={7}
              fill="#d8be38"
              stroke="#987018"
              strokeWidth="1.5"
            />
            <circle
              cx={CX - 2}
              cy={CY - 2}
              r={2.5}
              fill="rgba(255,250,200,0.55)"
            />
          </svg>
        </div>
      </div>

      <style>{`
        .roulette-root {
          display: flex;
          flex-direction: column;
          align-items: center;
        }
        .roulette-rim {
          border-radius: 50%;
          background: #030303;
          box-shadow:
            0 0 0 5px  #c9a84c,
            0 0 0 9px  #6a4808,
            0 0 0 14px #c9a84c,
            0 0 0 18px #3e2804,
            0 0 0 22px rgba(201,168,76,0.2),
            0 30px 120px rgba(0,0,0,0.98);
        }
      `}</style>
    </div>
  );
}
