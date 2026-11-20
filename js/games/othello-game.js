(() => {
  "use strict";

  const E = globalThis.OthelloEngine;
  const AI = globalThis.OthelloAI;
  const { BLACK, WHITE, COLS } = E;

  function renderBoard(stageEl, state, { canPlayerAct, onUserAction }) {
    const wrapper = document.createElement("div");
    wrapper.className = "board-wrapper";

    const colLabels = document.createElement("div");
    colLabels.className = "col-labels";
    for (let i = 0; i < 8; i++) {
      const col = document.createElement("div");
      col.textContent = COLS[i];
      colLabels.appendChild(col);
    }

    const rowLabels = document.createElement("div");
    rowLabels.className = "row-labels";
    for (let i = 0; i < 8; i++) {
      const row = document.createElement("div");
      row.textContent = String(i + 1);
      rowLabels.appendChild(row);
    }

    const boardEl = document.createElement("div");
    boardEl.id = "board";

    const shouldAnimate = state.animateTurnId !== state._lastRenderedAnimateId;
    state._lastRenderedAnimateId = state.animateTurnId;

    const flipSet = new Set();
    if (state.lastMove) {
      for (const [fr, fc] of state.lastMove.flips) {
        flipSet.add(`${fr},${fc}`);
      }
    }

    const validMoves = canPlayerAct ? E.getValidMoves(state.board, state.playerColor, state.playerColor) : [];
    const validMap = new Map(validMoves.map(m => [`${m.r},${m.c}`, m]));

    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const cell = document.createElement("div");
        cell.className = "cell";
        const key = `${r},${c}`;
        const isLastPlaced = state.lastMove && state.lastMove.r === r && state.lastMove.c === c;
        if (isLastPlaced) {
          cell.classList.add("last-move");
        }

        const val = state.board[r][c];
        if (val === BLACK || val === WHITE) {
          const piece = document.createElement("div");
          piece.className = `piece ${val === BLACK ? "black" : "white"}`;
          if (isLastPlaced) {
            piece.classList.add("last-placed");
            if (shouldAnimate) piece.classList.add("placed");
          } else if (shouldAnimate && flipSet.has(key)) {
            piece.classList.add("flipped");
          }
          cell.appendChild(piece);
        } else {
          const move = validMap.get(key);
          if (move) {
            cell.classList.add("clickable");
            cell.title = `${move.label} (+${move.flips.length}石)`;
            const hint = document.createElement("div");
            hint.className = "hint";
            cell.appendChild(hint);
            cell.onclick = () => onUserAction(move);
          }
        }
        boardEl.appendChild(cell);
      }
    }

    wrapper.appendChild(colLabels);
    wrapper.appendChild(rowLabels);
    wrapper.appendChild(boardEl);
    stageEl.appendChild(wrapper);
  }

  function advanceTurnState(nextBoard, playerColor, aiColor, moveCount, lastMove, animateTurnId, nextPlayer, extraEntries) {
    const nextMoves = E.getValidMoves(nextBoard, nextPlayer, nextPlayer);
    const otherPlayer = E.getOpponent(nextPlayer);
    const otherMoves = E.getValidMoves(nextBoard, otherPlayer, otherPlayer);

    if (nextMoves.length === 0 && otherMoves.length === 0) {
      return {
        state: {
          board: nextBoard,
          playerColor,
          aiColor,
          currentTurn: nextPlayer,
          moveCount,
          lastMove,
          animateTurnId,
          _lastRenderedAnimateId: animateTurnId - 1,
          gameOver: true
        },
        historyEntries: extraEntries,
        autoAdvanceDelayMs: 0
      };
    }

    if (nextMoves.length === 0) {
      const passActor = nextPlayer === playerColor ? "あなた" : "AI";
      extraEntries.push({
        type: "pass",
        text: `${passActor} (${E.getColorLabel(nextPlayer)}) は置ける場所がないためパスしました。`
      });
      return {
        state: {
          board: nextBoard,
          playerColor,
          aiColor,
          currentTurn: otherPlayer,
          moveCount,
          lastMove,
          animateTurnId,
          _lastRenderedAnimateId: animateTurnId - 1,
          gameOver: false
        },
        historyEntries: extraEntries,
        autoAdvanceDelayMs: otherPlayer === aiColor ? 650 : 0
      };
    }

    return {
      state: {
        board: nextBoard,
        playerColor,
        aiColor,
        currentTurn: nextPlayer,
        moveCount,
        lastMove,
        animateTurnId,
        _lastRenderedAnimateId: animateTurnId - 1,
        gameOver: false
      },
      historyEntries: extraEntries,
      autoAdvanceDelayMs: 0
    };
  }

  globalThis.GameRegistry.register({
    id: "othello",
    category: "board",
    name: "オセロ",
    title: "オセロ (Othello)",
    difficultyLabels: {
      easy: "かんたん（直感打ち）",
      normal: "ふつう（石数重視）",
      hard: "つよい（角と定石重視）",
      master: "達人（盤面・手数・リスク計算）"
    },
    sideLabel: "あなた",
    sideOptions: [
      { value: "black", text: "黒（先手）" },
      { value: "white", text: "白（後手）" }
    ],
    defaultSide: "black",
    coordPattern: "[A-H][1-8]",
    rulesHtml: `
      <ul>
        <li>相手の石を自分の石で縦・横・斜めに挟むと自分の色に裏返せます。</li>
        <li>打てる場所がない場合は自動的にパスになります。</li>
        <li>双方打てなくなるか全64マス埋まると終局し、石数が多い方の勝ちです。</li>
      </ul>
    `,

    createInitialState(sideValue) {
      const playerColor = sideValue === "white" ? WHITE : BLACK;
      const aiColor = E.getOpponent(playerColor);
      return {
        board: E.createInitialBoard(),
        playerColor,
        aiColor,
        currentTurn: BLACK,
        moveCount: 0,
        lastMove: null,
        animateTurnId: 0,
        _lastRenderedAnimateId: 0,
        gameOver: false
      };
    },

    cloneState(state) {
      return {
        board: E.cloneBoard(state.board),
        playerColor: state.playerColor,
        aiColor: state.aiColor,
        currentTurn: state.currentTurn,
        moveCount: state.moveCount,
        lastMove: state.lastMove ? { ...state.lastMove, flips: state.lastMove.flips.map(f => [...f]) } : null,
        animateTurnId: state.animateTurnId,
        _lastRenderedAnimateId: state._lastRenderedAnimateId,
        gameOver: state.gameOver
      };
    },

    isAiTurn(state) {
      return !state.gameOver && state.currentTurn === state.aiColor;
    },

    isGameOver(state) {
      return state.gameOver;
    },

    getScoreDisplay(state) {
      const counts = E.countStones(state.board);
      return {
        firstDotClass: "dot black",
        firstLabel: `黒(${state.playerColor === BLACK ? "あなた" : "AI"})`,
        firstValue: counts.black,
        secondDotClass: "dot white",
        secondLabel: `白(${state.playerColor === WHITE ? "あなた" : "AI"})`,
        secondValue: counts.white
      };
    },

    getTurnText(state, { isAiThinking, hasError }) {
      const counts = E.countStones(state.board);
      if (state.gameOver) {
        let result = "引き分け";
        if (counts.black > counts.white) result = state.playerColor === BLACK ? "あなたの勝利！" : "AIの勝利！";
        else if (counts.white > counts.black) result = state.playerColor === WHITE ? "あなたの勝利！" : "AIの勝利！";
        return `終局: ${result}`;
      }
      if (isAiThinking) return `手番: AI (${E.getColorLabel(state.aiColor)}) が考慮中...`;
      if (hasError) return `手番: AI (${E.getColorLabel(state.aiColor)}) - 待機中`;
      return state.currentTurn === state.playerColor
        ? `手番: あなた (${E.getColorLabel(state.playerColor)})`
        : `手番: AI (${E.getColorLabel(state.aiColor)})`;
    },

    getStartHistoryText(state) {
      return `対局開始（オセロ）: あなたは${E.getColorLabel(state.playerColor)}番（${state.playerColor === BLACK ? "先手" : "後手"}）です。`;
    },

    getPlaceholderText(state) {
      return state.playerColor === BLACK
        ? "手番を待っています。石を置くとAIが思考を開始します。"
        : "AI（黒・先手）の思考を待っています。";
    },

    getEndText(state) {
      const counts = E.countStones(state.board);
      let result = "引き分けです。";
      if (counts.black > counts.white) result = state.playerColor === BLACK ? "あなたの勝利！" : "AIの勝利！";
      else if (counts.white > counts.black) result = state.playerColor === WHITE ? "あなたの勝利！" : "AIの勝利！";
      return `【終局】 黒: ${counts.black}石 / 白: ${counts.white}石（${result}）`;
    },

    renderBoard,

    getValidAiActions(state) {
      return E.getValidMoves(state.board, state.aiColor, state.aiColor);
    },

    getDifficultyConfig(diffKey) {
      return AI.DIFFICULTY_SETTINGS[diffKey] || AI.DIFFICULTY_SETTINGS.normal;
    },

    buildAiPrompt(state, validActions, diffConfig) {
      return AI.buildAiPrompt({
        board: state.board,
        validMoves: validActions,
        aiColor: state.aiColor,
        playerColor: state.playerColor,
        moveCount: state.moveCount,
        diffConfig
      });
    },

    applyUserAction(state, move) {
      const nextBoard = E.cloneBoard(state.board);
      E.applyMove(nextBoard, move.r, move.c, state.playerColor, move.flips);
      const nextCount = state.moveCount + 1;
      const lastMove = { r: move.r, c: move.c, flips: move.flips.map(f => [...f]), player: state.playerColor, label: move.label };
      const entries = [{
        type: "move",
        turnNumber: nextCount,
        actor: "あなた",
        colorLabel: E.getColorLabel(state.playerColor),
        label: move.label,
        detailText: ` (+${move.flips.length}石)`
      }];
      return advanceTurnState(
        nextBoard,
        state.playerColor,
        state.aiColor,
        nextCount,
        lastMove,
        state.animateTurnId + 1,
        state.aiColor,
        entries
      );
    },

    applyAiAction(state, chosenMove, diffName, isFallback) {
      const nextBoard = E.cloneBoard(state.board);
      E.applyMove(nextBoard, chosenMove.r, chosenMove.c, state.aiColor, chosenMove.flips);
      const nextCount = state.moveCount + 1;
      const lastMove = { r: chosenMove.r, c: chosenMove.c, flips: chosenMove.flips.map(f => [...f]), player: state.aiColor, label: chosenMove.label };
      const entries = [{
        type: "move",
        turnNumber: nextCount,
        actor: isFallback ? "AI (フォールバック)" : `AI (${diffName})`,
        colorLabel: E.getColorLabel(state.aiColor),
        label: chosenMove.label,
        detailText: ` (+${chosenMove.flips.length}石)`
      }];
      return advanceTurnState(
        nextBoard,
        state.playerColor,
        state.aiColor,
        nextCount,
        lastMove,
        state.animateTurnId + 1,
        state.playerColor,
        entries
      );
    }
  });
})();
