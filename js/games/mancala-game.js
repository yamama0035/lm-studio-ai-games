(() => {
  "use strict";

  const M = globalThis.MancalaEngine;
  const AI = globalThis.OthelloAI;

  function createPebblesElement(count, indexOffset, maxPebbles) {
    const wrap = document.createElement("div");
    wrap.className = "pit-pebbles";
    const visibleCount = Math.min(count, maxPebbles);
    for (let i = 0; i < visibleCount; i++) {
      const pebble = document.createElement("span");
      const colorIdx = (indexOffset * 7 + i) % 5;
      pebble.className = `pebble pebble-c${colorIdx}`;
      wrap.appendChild(pebble);
    }
    return wrap;
  }

  function applyHighlights(el, index, lastResult) {
    if (!lastResult) return;
    if (lastResult.pickedIndex === index) el.classList.add("last-picked");
    if (lastResult.visitedIndices.includes(index)) el.classList.add("last-sown");
    if (lastResult.lastIndex === index) el.classList.add("last-target");
    if (
      lastResult.captured.occurred &&
      (lastResult.captured.pitIndex === index || lastResult.captured.oppositeIndex === index)
    ) {
      el.classList.add("just-captured");
    }
  }

  function buildHistoryDetail(sim) {
    const parts = [` (${sim.stonesSown}個→${sim.lastLabel})`];
    if (sim.captured.occurred) parts.push(` [横取り +${sim.captured.totalCaptured}石]`);
    if (sim.extraTurn) parts.push(" [★連続手番]");
    return parts.join("");
  }

  function renderBoard(stageEl, state, { canPlayerAct, onUserAction }) {
    const area = document.createElement("div");
    area.className = "mancala-area";

    const topHint = document.createElement("div");
    topHint.className = "mancala-flow-hint top";
    topHint.textContent = "← AIの進行方向（反時計回り）";

    const boardEl = document.createElement("div");
    boardEl.className = "mancala-board";

    const validMoves = canPlayerAct ? M.getValidMoves(state.pits, M.HUMAN) : [];
    const validMap = new Map(validMoves.map(m => [m.index, m]));

    // AI ゴール
    const aiStoreEl = document.createElement("div");
    aiStoreEl.className = "mancala-store mancala-store-ai";
    applyHighlights(aiStoreEl, M.AI_STORE, state.lastResult);
    const aiLabel = document.createElement("span");
    aiLabel.className = "pit-coord";
    aiLabel.textContent = "AI";
    const aiCount = document.createElement("span");
    aiCount.className = "pit-count";
    aiCount.textContent = String(state.pits[M.AI_STORE]);
    aiStoreEl.append(aiLabel, createPebblesElement(state.pits[M.AI_STORE], M.AI_STORE, 24), aiCount);
    boardEl.appendChild(aiStoreEl);

    // AI ポケット (上段)
    M.AI_PIT_INDICES.forEach((pitIndex, colIdx) => {
      const pitEl = document.createElement("div");
      pitEl.className = "mancala-pit mancala-pit-ai";
      pitEl.style.gridColumn = String(colIdx + 2);
      pitEl.style.gridRow = "1";
      applyHighlights(pitEl, pitIndex, state.lastResult);

      const coord = document.createElement("span");
      coord.className = "pit-coord";
      coord.textContent = M.PIT_LABELS[pitIndex];

      const count = document.createElement("span");
      count.className = "pit-count";
      count.textContent = String(state.pits[pitIndex]);

      pitEl.append(coord, createPebblesElement(state.pits[pitIndex], pitIndex, 12), count);
      boardEl.appendChild(pitEl);
    });

    // あなた ポケット (下段)
    M.HUMAN_PIT_INDICES.forEach((pitIndex, colIdx) => {
      const pitEl = document.createElement("div");
      pitEl.className = "mancala-pit mancala-pit-human";
      pitEl.style.gridColumn = String(colIdx + 2);
      pitEl.style.gridRow = "2";
      applyHighlights(pitEl, pitIndex, state.lastResult);

      const coord = document.createElement("span");
      coord.className = "pit-coord";
      coord.textContent = M.PIT_LABELS[pitIndex];

      const count = document.createElement("span");
      count.className = "pit-count";
      count.textContent = String(state.pits[pitIndex]);

      pitEl.append(coord, createPebblesElement(state.pits[pitIndex], pitIndex, 12), count);

      const move = validMap.get(pitIndex);
      if (move) {
        pitEl.classList.add("clickable");
        pitEl.setAttribute("role", "button");
        pitEl.setAttribute("tabindex", "0");
        pitEl.setAttribute("aria-label", `${move.label} (${move.stones}個)`);
        pitEl.title = `${move.label} (${move.stones}個)`;
        pitEl.onclick = () => onUserAction(move);
        pitEl.onkeydown = (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onUserAction(move);
          }
        };
      }

      boardEl.appendChild(pitEl);
    });

    // あなた ゴール
    const humanStoreEl = document.createElement("div");
    humanStoreEl.className = "mancala-store mancala-store-human";
    applyHighlights(humanStoreEl, M.HUMAN_STORE, state.lastResult);
    const humanLabel = document.createElement("span");
    humanLabel.className = "pit-coord";
    humanLabel.textContent = "あなた";
    const humanCount = document.createElement("span");
    humanCount.className = "pit-count";
    humanCount.textContent = String(state.pits[M.HUMAN_STORE]);
    humanStoreEl.append(humanLabel, createPebblesElement(state.pits[M.HUMAN_STORE], M.HUMAN_STORE, 24), humanCount);
    boardEl.appendChild(humanStoreEl);

    const bottomHint = document.createElement("div");
    bottomHint.className = "mancala-flow-hint bottom";
    bottomHint.textContent = "あなたの進行方向（反時計回り） →";

    const actionBanner = document.createElement("div");
    actionBanner.className = "mancala-last-action";
    const lastRes = state.lastResult;
    if (!lastRes) {
      actionBanner.textContent = state.playerIsFirst
        ? "対局開始：下段のポケット（A1〜F1）を選んで石をまいてください。"
        : "対局開始：AI（先手）の初手を待っています...";
    } else {
      const actorName = lastRes.actor === M.HUMAN ? "あなた" : "AI";
      const base = `${actorName}が ${lastRes.pickedLabel} (${lastRes.stonesSown}個) をまきました`;
      if (lastRes.gameEnded) {
        actionBanner.textContent = `${base} → 片側の陣地が空になり終局（残石回収: あなた+${lastRes.sweptStones.human} / AI+${lastRes.sweptStones.ai}）`;
      } else if (lastRes.extraTurn) {
        actionBanner.classList.add("highlight-extra");
        actionBanner.textContent = `${base} → ぴったりゴール！${actorName}の連続手番です！`;
      } else if (lastRes.captured.occurred) {
        actionBanner.classList.add("highlight-capture");
        actionBanner.textContent = `${base} → 横取り成功！向かい側から+${lastRes.captured.capturedFromOpposite}石（計+${lastRes.captured.totalCaptured}石）をゴールへ！`;
      } else {
        actionBanner.textContent = `${base} → 最後の石は ${lastRes.lastLabel} に着地しました。`;
      }
    }

    area.append(topHint, boardEl, bottomHint, actionBanner);
    stageEl.appendChild(area);
  }

  function applyMoveResult(state, sim, actorLabel, roleLabel) {
    const entries = [{
      type: "move",
      turnNumber: state.moveCount + 1,
      actor: actorLabel,
      colorLabel: roleLabel,
      label: sim.pickedLabel,
      detailText: buildHistoryDetail(sim)
    }];

    let nextTurn = M.getOpponent(sim.actor);
    let autoAdvanceDelayMs = 0;

    if (sim.gameEnded) {
      if (sim.sweptStones.human > 0 || sim.sweptStones.ai > 0) {
        entries.push({
          type: "info",
          text: `盤面残石回収: あなた +${sim.sweptStones.human}石 / AI +${sim.sweptStones.ai}石`
        });
      }
    } else if (sim.extraTurn) {
      nextTurn = sim.actor;
      entries.push({
        type: "extra",
        text: `${sim.actor === M.HUMAN ? "あなた" : "AI"}: 最後の石がゴールに入り連続手番！`
      });
      if (sim.actor === M.AI) {
        autoAdvanceDelayMs = 650;
      }
    }

    return {
      state: {
        pits: sim.pits,
        playerIsFirst: state.playerIsFirst,
        currentTurn: nextTurn,
        moveCount: state.moveCount + 1,
        lastResult: sim,
        gameOver: sim.gameEnded
      },
      historyEntries: entries,
      autoAdvanceDelayMs
    };
  }

  globalThis.GameRegistry.register({
    id: "mancala",
    category: "board",
    name: "マンカラ",
    title: "マンカラ (Mancala)",
    difficultyLabels: {
      easy: "かんたん（直感打ち）",
      normal: "ふつう（基本戦術）",
      hard: "つよい（連続手番と横取り重視）",
      master: "達人（連鎖・相手リスク計算）"
    },
    sideLabel: "あなた",
    sideOptions: [
      { value: "first", text: "先手（先攻）" },
      { value: "second", text: "後手（後攻）" }
    ],
    defaultSide: "first",
    coordPattern: "[A-F][12]",
    rulesHtml: `
      <ul>
        <li><strong>石まき</strong>：自陣（下段）のポケットを選び、石を反時計回りに1個ずつまきます（相手のゴールは飛ばします）。</li>
        <li><strong>連続手番</strong>：最後の石がちょうど自分のゴールに入ると、もう一度続けて自分の手番になります。</li>
        <li><strong>横取り</strong>：最後の石が自陣の空ポケットに入り、向かい側（上段）に石があるときは、両方の石を自分のゴールに入れます。</li>
        <li><strong>終局</strong>：どちらかの6ポケットがすべて空になると終了し、残った石はその陣地のゴールに入って勝敗が決まります。</li>
      </ul>
    `,

    createInitialState(sideValue) {
      const playerIsFirst = sideValue !== "second";
      return {
        pits: M.createInitialPits(),
        playerIsFirst,
        currentTurn: playerIsFirst ? M.HUMAN : M.AI,
        moveCount: 0,
        lastResult: null,
        gameOver: false
      };
    },

    cloneState(state) {
      return {
        pits: M.clonePits(state.pits),
        playerIsFirst: state.playerIsFirst,
        currentTurn: state.currentTurn,
        moveCount: state.moveCount,
        lastResult: state.lastResult ? {
          ...state.lastResult,
          pits: M.clonePits(state.lastResult.pits),
          visitedIndices: [...state.lastResult.visitedIndices],
          captured: { ...state.lastResult.captured },
          sweptStones: { ...state.lastResult.sweptStones }
        } : null,
        gameOver: state.gameOver
      };
    },

    isAiTurn(state) {
      return !state.gameOver && state.currentTurn === M.AI;
    },

    isGameOver(state) {
      return state.gameOver;
    },

    getScoreDisplay(state) {
      const counts = M.countStones(state.pits);
      return {
        firstDotClass: "dot mancala-human",
        firstLabel: "あなた(ゴール)",
        firstValue: counts.humanStore,
        secondDotClass: "dot mancala-ai",
        secondLabel: "AI(ゴール)",
        secondValue: counts.aiStore
      };
    },

    getTurnText(state, { isAiThinking, hasError }) {
      const counts = M.countStones(state.pits);
      const humanRole = state.playerIsFirst ? "先手" : "後手";
      const aiRole = state.playerIsFirst ? "後手" : "先手";
      if (state.gameOver) {
        let result = "引き分け";
        if (counts.humanStore > counts.aiStore) result = "あなたの勝利！";
        else if (counts.aiStore > counts.humanStore) result = "AIの勝利！";
        return `終局: ${result}`;
      }
      if (isAiThinking) return `手番: AI (${aiRole}) が考慮中...`;
      if (hasError) return `手番: AI (${aiRole}) - 待機中`;
      return state.currentTurn === M.HUMAN ? `手番: あなた (${humanRole})` : `手番: AI (${aiRole})`;
    },

    getStartHistoryText(state) {
      return `対局開始（マンカラ）: あなたは${state.playerIsFirst ? "先手（先攻）" : "後手（後攻）"}です。`;
    },

    getPlaceholderText(state) {
      return state.playerIsFirst
        ? "手番を待っています。ポケット（A1〜F1）を選ぶとAIが思考を開始します。"
        : "AI（先手）の思考を待っています。";
    },

    getEndText(state) {
      const counts = M.countStones(state.pits);
      let result = "引き分けです。";
      if (counts.humanStore > counts.aiStore) result = "あなたの勝利！";
      else if (counts.aiStore > counts.humanStore) result = "AIの勝利！";
      return `【終局】 あなた: ${counts.humanStore}石 / AI: ${counts.aiStore}石（${result}）`;
    },

    renderBoard,

    getValidAiActions(state) {
      return M.getValidMoves(state.pits, M.AI);
    },

    getDifficultyConfig(diffKey) {
      return AI.MANCALA_DIFFICULTY_SETTINGS[diffKey] || AI.MANCALA_DIFFICULTY_SETTINGS.normal;
    },

    buildAiPrompt(state, validActions, diffConfig) {
      return AI.buildMancalaAiPrompt({
        pits: state.pits,
        validMoves: validActions,
        moveCount: state.moveCount,
        diffConfig,
        playerIsFirst: state.playerIsFirst
      });
    },

    applyUserAction(state, move) {
      const sim = M.simulateMove(state.pits, move.index, M.HUMAN);
      return applyMoveResult(state, sim, "あなた", state.playerIsFirst ? "先手" : "後手");
    },

    applyAiAction(state, chosenMove, diffName, isFallback) {
      const sim = M.simulateMove(state.pits, chosenMove.index, M.AI);
      return applyMoveResult(
        state,
        sim,
        isFallback ? "AI (フォールバック)" : `AI (${diffName})`,
        state.playerIsFirst ? "後手" : "先手"
      );
    }
  });
})();
