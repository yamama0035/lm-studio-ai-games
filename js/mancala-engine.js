(() => {
  "use strict";

  const HUMAN = 1;
  const AI = 2;
  const HUMAN_STORE = 6;
  const AI_STORE = 13;
  const PIT_COUNT = 6;
  const INITIAL_STONES = 4;

  const COLS = ["A", "B", "C", "D", "E", "F"];
  const PIT_LABELS = [
    "A1", "B1", "C1", "D1", "E1", "F1", "あなたゴール",
    "F2", "E2", "D2", "C2", "B2", "A2", "AIゴール"
  ];

  // 左から右（A列〜F列）の順で配列を返す
  const HUMAN_PIT_INDICES = [0, 1, 2, 3, 4, 5];
  const AI_PIT_INDICES = [12, 11, 10, 9, 8, 7];

  function createInitialPits() {
    const pits = new Array(14).fill(INITIAL_STONES);
    pits[HUMAN_STORE] = 0;
    pits[AI_STORE] = 0;
    return pits;
  }

  function clonePits(pits) {
    return [...pits];
  }

  function getOpponent(actor) {
    return actor === HUMAN ? AI : HUMAN;
  }

  function getActorLabel(actor) {
    return actor === HUMAN ? "あなた" : "AI";
  }

  function getOwnStore(actor) {
    return actor === HUMAN ? HUMAN_STORE : AI_STORE;
  }

  function getOppStore(actor) {
    return actor === HUMAN ? AI_STORE : HUMAN_STORE;
  }

  function isOwnPit(actor, index) {
    if (actor === HUMAN) return index >= 0 && index <= 5;
    if (actor === AI) return index >= 7 && index <= 12;
    return false;
  }

  function getOwnPitIndices(actor) {
    return actor === HUMAN ? [...HUMAN_PIT_INDICES] : [...AI_PIT_INDICES];
  }

  function getOppositePitIndex(index) {
    if ((index >= 0 && index <= 5) || (index >= 7 && index <= 12)) {
      return 12 - index;
    }
    return -1;
  }

  function getDistanceToOwnStore(actor, index) {
    if (!isOwnPit(actor, index)) return -1;
    return getOwnStore(actor) - index;
  }

  function getValidMoves(pits, actor) {
    const moves = [];
    for (const index of getOwnPitIndices(actor)) {
      const stones = pits[index];
      if (stones > 0) {
        moves.push({
          index,
          label: PIT_LABELS[index],
          stones,
          distanceToStore: getDistanceToOwnStore(actor, index)
        });
      }
    }
    return moves;
  }

  function simulateMove(pits, pitIndex, actor) {
    if (!isOwnPit(actor, pitIndex)) {
      throw new Error(`Invalid pit index ${pitIndex} for actor ${actor}`);
    }
    const stones = pits[pitIndex];
    if (stones <= 0) {
      throw new Error(`Pit ${PIT_LABELS[pitIndex]} is empty`);
    }

    const next = clonePits(pits);
    next[pitIndex] = 0;

    const ownStore = getOwnStore(actor);
    const oppStore = getOppStore(actor);
    const visitedIndices = [];
    let idx = pitIndex;

    for (let i = 0; i < stones; i++) {
      idx = (idx + 1) % 14;
      if (idx === oppStore) {
        idx = (idx + 1) % 14;
      }
      next[idx] += 1;
      visitedIndices.push(idx);
    }

    const lastIndex = idx;
    let captured = {
      occurred: false,
      pitIndex: -1,
      oppositeIndex: -1,
      capturedFromOpposite: 0,
      totalCaptured: 0
    };

    // 最後の石が自分の空ポケットに入り、向かい側に相手の石がある場合は横取り
    if (isOwnPit(actor, lastIndex) && next[lastIndex] === 1) {
      const oppositeIndex = getOppositePitIndex(lastIndex);
      if (oppositeIndex !== -1 && next[oppositeIndex] > 0) {
        const oppStones = next[oppositeIndex];
        const totalCaptured = 1 + oppStones;
        next[ownStore] += totalCaptured;
        next[lastIndex] = 0;
        next[oppositeIndex] = 0;
        captured = {
          occurred: true,
          pitIndex: lastIndex,
          oppositeIndex,
          capturedFromOpposite: oppStones,
          totalCaptured
        };
      }
    }

    let humanRemaining = 0;
    for (let i = 0; i <= 5; i++) humanRemaining += next[i];
    let aiRemaining = 0;
    for (let i = 7; i <= 12; i++) aiRemaining += next[i];

    const gameEnded = humanRemaining === 0 || aiRemaining === 0;
    const sweptStones = { human: 0, ai: 0 };

    if (gameEnded) {
      sweptStones.human = humanRemaining;
      sweptStones.ai = aiRemaining;
      next[HUMAN_STORE] += humanRemaining;
      next[AI_STORE] += aiRemaining;
      for (let i = 0; i <= 5; i++) next[i] = 0;
      for (let i = 7; i <= 12; i++) next[i] = 0;
    }

    const extraTurn = !gameEnded && lastIndex === ownStore;

    return {
      pits: next,
      actor,
      pickedIndex: pitIndex,
      pickedLabel: PIT_LABELS[pitIndex],
      stonesSown: stones,
      lastIndex,
      lastLabel: PIT_LABELS[lastIndex],
      visitedIndices,
      extraTurn,
      captured,
      gameEnded,
      sweptStones
    };
  }

  function countStones(pits) {
    let humanPits = 0;
    for (let i = 0; i <= 5; i++) humanPits += pits[i];
    let aiPits = 0;
    for (let i = 7; i <= 12; i++) aiPits += pits[i];
    return {
      humanStore: pits[HUMAN_STORE],
      aiStore: pits[AI_STORE],
      humanPits,
      aiPits,
      totalOnBoard: humanPits + aiPits
    };
  }

  function boardToText(pits) {
    const pad = (n) => String(n).padStart(2, " ");
    const topRow = AI_PIT_INDICES.map(i => pad(pits[i])).join("  ");
    const bottomRow = HUMAN_PIT_INDICES.map(i => pad(pits[i])).join("  ");
    return [
      "         [A2] [B2] [C2] [D2] [E2] [F2]",
      `  (AI)   ${topRow}`,
      `[ ${pad(pits[AI_STORE])} ]                              [ ${pad(pits[HUMAN_STORE])} ] (あなた)`,
      `         ${bottomRow}`,
      "         [A1] [B1] [C1] [D1] [E1] [F1]",
      "※進行方向(反時計回り): 上段は左へ (F2→E2→D2→C2→B2→A2→AIゴール)、下段は右へ (A1→B1→C1→D1→E1→F1→あなたゴール)"
    ].join("\n");
  }

  globalThis.MancalaEngine = {
    HUMAN,
    AI,
    HUMAN_STORE,
    AI_STORE,
    PIT_COUNT,
    INITIAL_STONES,
    COLS,
    PIT_LABELS,
    HUMAN_PIT_INDICES,
    AI_PIT_INDICES,
    createInitialPits,
    clonePits,
    getOpponent,
    getActorLabel,
    getOwnStore,
    getOppStore,
    isOwnPit,
    getOwnPitIndices,
    getOppositePitIndex,
    getDistanceToOwnStore,
    getValidMoves,
    simulateMove,
    countStones,
    boardToText
  };
})();
