import { useCallback, useEffect, useRef, useState } from "react";
import { STATES, EVENTS } from "../game/gameStateMachine";

/**
 * Manages the selected-sector state and the two Roulette callbacks.
 * Also keeps a ref in sync so async closures can read the latest value.
 */
export function useRoulette(gameState, send, closePreSession) {
  const [selectedSector, setSelectedSector] = useState(null);
  const selectedSectorRef = useRef(null);

  // Keep ref in sync so async callbacks always see the latest sector.
  useEffect(() => {
    selectedSectorRef.current = selectedSector;
  }, [selectedSector]);

  // Reset the wheel when the game goes back to IDLE (new game).
  useEffect(() => {
    if (gameState === STATES.IDLE) setSelectedSector(null);
  }, [gameState]);

  const handleRouletteTarget = useCallback((sector) => {
    console.log("[App][Roulette target]", { sector });
  }, []);

  const handleRouletteStop = useCallback(
    (sector) => {
      console.log("[App][Roulette stop]", { sector });
      closePreSession();
      setSelectedSector(sector);
      send(EVENTS.SPIN_DONE);
    },
    [send, closePreSession]
  );

  return {
    selectedSector,
    selectedSectorRef,
    handleRouletteTarget,
    handleRouletteStop,
  };
}
