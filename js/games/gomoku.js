(() => {
  "use strict";

  const SIZE = 15;
  const EMPTY = 0;
  const BLACK = 1;
  const WHITE = 2;
  const COLS = Array.from({ length: SIZE }, (_, i) => String.fromCharCode(65 + i)); // A..O
  const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];

  const DIFFICULTIES = {
    easy: { temperature: 0.85, maxTokens: 1200, includeBoard: false, showTactics: false, policy: "直感で周囲の空きマスに石を置く。" },
    normal: { temperature: 0.3, maxTokens: 1600, includeBoard: true, showTactics: true, policy: "自分の石をつなげつつ、相手の連続（三や四）を適度に防ぐ。" },
    hard: { temperature: 0.1, maxTokens: 2048, includeBoard: true, showTactics: true, policy: "5連即勝・相手の4連阻止・活三阻止を最優先し、両面待ちを作る。" },
    master: { temperature: 0.05, maxTokens: 2400, includeBoard: true, showTactics: true, policy: "攻防の脅威度（5連・活四・止め四・活三）を精密に比較し、確実に主導権を握る最善手を選ぶ。" }
  };

  function createEmptyBoard() {
    return Array.from({ length: SIZE }, () => new Array(SIZE).fill(EMPTY));
  }

  function cloneBoard(board) {
    return board.map(row => [...row]);
  }

  function coordLabel(r, c) {
    return `${COLS[c]}${r + 1}`;
  }

  function checkWinnerFrom(board, r, c) {
    const color = board[r][c];
    if (color === EMPTY) return null;

    for (const [dr, dc] of DIRS) {
      const cells = [[r, c]];
      for (let step = 1; step < 5; step++) {
        const nr = r + dr * step;
        const nc = c + dc * step;
        if (nr < 0 || nr >= SIZE || nc < 0 || nc >= SIZE || board[nr][nc] !== color) break;
        cells.push([nr, nc]);
      }
      for (let step = 1; step < 5; step++) {
        const nr = r - dr * step;
        const nc = c - dc * step;
        if (nr < 0 || nr >= SIZE || nc < 0 || nc >= SIZE || board[nr][nc] !== color) break;
        cells.push([nr, nc]);
      }
      if (cells.length >= 5) {
        return { winner: color, line: cells };
      }
    }
    return null;
  }

  function countStones(board) {
    let black = 0;
    let white = 0;
    let empty = 0;
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (board[r][c] === BLACK) black++;
        else if (board[r][c] === WHITE) white++;
        else empty++;
      }
    }
    return { black, white, empty };
  }

  function evaluateLineAt(board, r, c, color) {
    let maxLen = 1;
    let openFours = 0;
    let closedFours = 0;
    let openThrees = 0;
    let openTwos = 0;

    for (const [dr, dc] of DIRS) {
      let count = 1;
      let openEnds = 0;

      let step = 1;
      while (true) {
        const nr = r + dr * step;
        const nc = c + dc * step;
        if (nr < 0 || nr >= SIZE || nc < 0 || nc >= SIZE) break;
        if (board[nr][nc] === color) {
          count++;
          step++;
        } else {
          if (board[nr][nc] === EMPTY) openEnds++;
          break;
        }
      }

      step = 1;
      while (true) {
        const nr = r - dr * step;
        const nc = c - dc * step;
        if (nr < 0 || nr >= SIZE || nc < 0 || nc >= SIZE) break;
        if (board[nr][nc] === color) {
          count++;
          step++;
        } else {
          if (board[nr][nc] === EMPTY) openEnds++;
          break;
        }
      }

      if (count > maxLen) maxLen = count;
      if (count === 4) {
        if (openEnds === 2) openFours++;
        else if (openEnds === 1) closedFours++;
      } else if (count === 3 && openEnds === 2) {
        openThrees++;
      } else if (count === 2 && openEnds === 2) {
        openTwos++;
      }
    }

    let score = 0;
    if (maxLen >= 5) score += 100000;
    score += openFours * 15000 + closedFours * 1800 + openThrees * 1400 + openTwos * 120 + maxLen * 25;
    return { score, maxLen, openFours, closedFours, openThrees };
  }

  function getCandidateMoves(board, aiColor, playerColor) {
    const allEmpty = [];
    const nearMoves = [];
    let hasStones = false;

    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (board[r][c] !== EMPTY) {
          hasStones = true;
          continue;
        }
        const move = { r, c, label: coordLabel(r, c) };
        allEmpty.push(move);
      }
    }

    if (!hasStones) {
      const center = { r: 7, c: 7, label: "H8", score: 100, tag: "天元（初手定石）" };
      const around = [
        center,
        { r: 6, c: 7, label: "H7", score: 60, tag: "中央付近" },
        { r: 7, c: 8, label: "I8", score: 60, tag: "中央付近" },
        { r: 8, c: 7, label: "H9", score: 60, tag: "中央付近" },
        { r: 7, c: 6, label: "G8", score: 60, tag: "中央付近" }
      ];
      return { allEmpty, candidates: around };
    }

    for (const m of allEmpty) {
      let near = false;
      for (let dr = -2; dr <= 2 && !near; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const nr = m.r + dr;
          const nc = m.c + dc;
          if (nr >= 0 && nr < SIZE && nc >= 0 && nc < SIZE && board[nr][nc] !== EMPTY) {
            near = true;
            break;
          }
        }
      }
      if (!near) continue;

      const off = evaluateLineAt(board, m.r, m.c, aiColor);
      const def = evaluateLineAt(board, m.r, m.c, playerColor);
      const centerBonus = 14 - (Math.abs(m.r - 7) + Math.abs(m.c - 7));
      const totalScore = off.score * 1.1 + def.score + centerBonus;

      const tags = [];
      if (off.maxLen >= 5) tags.push("★自5連・即勝利！");
      if (def.maxLen >= 5) tags.push("⚠️相手5連阻止必須");
      if (off.openFours > 0) tags.push("★活四生成");
      if (def.openFours > 0) tags.push("⚠️相手活四阻止");
      if (off.openThrees > 0) tags.push("活三");
      if (def.openThrees > 0) tags.push("相手活三牽制");
      if (off.closedFours > 0) tags.push("止め四");

      nearMoves.push({
        ...m,
        score: totalScore,
        tag: tags.join(" / ") || "周囲展開"
      });
    }

    nearMoves.sort((a, b) => b.score - a.score);
    return { allEmpty, candidates: nearMoves.slice(0, 14) };
  }

  function boardToText(board) {
    const header = "   " + COLS.join(" ");
    const lines = [header];
    for (let r = 0; r < SIZE; r++) {
      const rowStr = board[r].map(v => (v === BLACK ? "●" : v === WHITE ? "○" : "·")).join(" ");
      lines.push(`${String(r + 1).padStart(2, " ")} ${rowStr}`);
    }
    return lines.join("\n");
  }

  function renderBoard(stageEl, state, { canPlayerAct, onUserAction }) {
    const wrapper = document.createElement("div");
    wrapper.className = "gomoku-wrapper";

    const colLabels = document.createElement("div");
    colLabels.className = "gomoku-col-labels";
    for (const c of COLS) {
      const div = document.createElement("div");
      div.textContent = c;
      colLabels.appendChild(div);
    }

    const rowLabels = document.createElement("div");
    rowLabels.className = "gomoku-row-labels";
    for (let r = 0; r < SIZE; r++) {
      const div = document.createElement("div");
      div.textContent = String(r + 1);
      rowLabels.appendChild(div);
    }

    const boardEl = document.createElement("div");
    boardEl.className = "gomoku-board";

    const winSet = new Set((state.winLine || []).map(([r, c]) => `${r},${c}`));

    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const cell = document.createElement("div");
        cell.className = "gomoku-cell";
        const val = state.board[r][c];
        const isLast = state.lastMove && state.lastMove.r === r && state.lastMove.c === c;
        if (isLast) cell.classList.add("last-move");
        if (winSet.has(`${r},${c}`)) cell.classList.add("win-cell");

        if (val === BLACK || val === WHITE) {
          const stone = document.createElement("div");
          stone.className = `gomoku-stone ${val === BLACK ? "black" : "white"}`;
          if (isLast) stone.classList.add("last-placed");
          cell.appendChild(stone);
        } else if (canPlayerAct) {
          cell.classList.add("clickable");
          const label = coordLabel(r, c);
          cell.title = label;
          cell.onclick = () => onUserAction({ r, c, label });
        }
        boardEl.appendChild(cell);
      }
    }

    wrapper.append(colLabels, rowLabels, boardEl);
    stageEl.appendChild(wrapper);
  }

  function applyPlacement(state, move, color, actorName) {
    const nextBoard = cloneBoard(state.board);
    nextBoard[move.r][move.c] = color;
    const winInfo = checkWinnerFrom(nextBoard, move.r, move.c);
    const counts = countStones(nextBoard);
    const isDraw = !winInfo && counts.empty === 0;
    const gameOver = Boolean(winInfo) || isDraw;

    return {
      state: {
        board: nextBoard,
        playerColor: state.playerColor,
        aiColor: state.aiColor,
        currentTurn: color === BLACK ? WHITE : BLACK,
        moveCount: state.moveCount + 1,
        lastMove: { r: move.r, c: move.c, label: move.label, player: color },
        winLine: winInfo ? winInfo.line : null,
        winner: winInfo ? winInfo.winner : 0,
        gameOver
      },
      historyEntries: [{
        type: "move",
        turnNumber: state.moveCount + 1,
        actor: actorName,
        colorLabel: color === BLACK ? "黒" : "白",
        label: move.label,
        detailText: winInfo ? " (5連達成！)" : ""
      }],
      autoAdvanceDelayMs: 0
    };
  }

  globalThis.GameRegistry.register({
    id: "gomoku",
    category: "board",
    name: "五目並べ",
    title: "五目並べ (Gomoku 15×15)",
    difficultyLabels: {
      easy: "かんたん（直感打ち）",
      normal: "ふつう（基本攻防）",
      hard: "つよい（四三・阻止重視）",
      master: "達人（脅威計算・主導権）"
    },
    sideLabel: "あなた",
    sideOptions: [
      { value: "black", text: "黒（先手）" },
      { value: "white", text: "白（後手）" }
    ],
    defaultSide: "black",
    coordPattern: "[A-O](?:1[0-5]|[1-9])",
    rulesHtml: `
      <ul>
        <li>15×15の盤面に交互に石を置き、縦・横・斜めのいずれかに<strong>5つ以上連続</strong>で並べると勝利です。</li>
        <li>全225マスが埋まって勝敗がつかない場合は引き分けとなります。</li>
      </ul>
    `,

    createInitialState(sideValue) {
      const playerColor = sideValue === "white" ? WHITE : BLACK;
      return {
        board: createEmptyBoard(),
        playerColor,
        aiColor: playerColor === BLACK ? WHITE : BLACK,
        currentTurn: BLACK,
        moveCount: 0,
        lastMove: null,
        winLine: null,
        winner: 0,
        gameOver: false
      };
    },

    cloneState(state) {
      return {
        board: cloneBoard(state.board),
        playerColor: state.playerColor,
        aiColor: state.aiColor,
        currentTurn: state.currentTurn,
        moveCount: state.moveCount,
        lastMove: state.lastMove ? { ...state.lastMove } : null,
        winLine: state.winLine ? state.winLine.map(c => [...c]) : null,
        winner: state.winner,
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
      const counts = countStones(state.board);
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
      if (state.gameOver) {
        if (state.winner === 0) return "終局: 引き分け";
        return `終局: ${state.winner === state.playerColor ? "あなたの勝利！" : "AIの勝利！"}`;
      }
      const aiLabel = state.aiColor === BLACK ? "黒" : "白";
      const playerLabel = state.playerColor === BLACK ? "黒" : "白";
      if (isAiThinking) return `手番: AI (${aiLabel}) が考慮中...`;
      if (hasError) return `手番: AI (${aiLabel}) - 待機中`;
      return state.currentTurn === state.playerColor ? `手番: あなた (${playerLabel})` : `手番: AI (${aiLabel})`;
    },

    getStartHistoryText(state) {
      return `対局開始（五目並べ）: あなたは${state.playerColor === BLACK ? "黒（先手）" : "白（後手）"}です。`;
    },

    getPlaceholderText(state) {
      return state.playerColor === BLACK
        ? "手番を待っています。盤面をクリックして石を置いてください。"
        : "AI（黒・先手）の初手を待っています。";
    },

    getEndText(state) {
      if (state.winner === 0) return `【終局】 ${state.moveCount}手 引き分けです。`;
      return `【終局】 ${state.moveCount}手 ${state.winner === state.playerColor ? "あなたの勝利！" : "AIの勝利！"}`;
    },

    renderBoard,

    getValidAiActions(state) {
      const { allEmpty, candidates } = getCandidateMoves(state.board, state.aiColor, state.playerColor);
      // 先頭が最有力候補になるよう candidates を前に並べる
      const candSet = new Set(candidates.map(c => c.label));
      const rest = allEmpty.filter(m => !candSet.has(m.label));
      return [...candidates, ...rest];
    },

    getDifficultyConfig(diffKey) {
      return DIFFICULTIES[diffKey] || DIFFICULTIES.normal;
    },

    buildAiPrompt(state, validActions, diffConfig) {
      const { candidates } = getCandidateMoves(state.board, state.aiColor, state.playerColor);
      const aiLabel = state.aiColor === BLACK ? "黒 (●)" : "白 (○)";
      const playerLabel = state.playerColor === BLACK ? "黒 (●)" : "白 (○)";

      const listText = candidates.map(c =>
        diffConfig.showTactics ? `・${c.label}: [${c.tag}]` : `・${c.label}`
      ).join("\n");

      const boardSection = diffConfig.includeBoard
        ? `\n【現在の盤面 (15×15)】(●=黒 / ○=白 / ·=空)\n${boardToText(state.board)}\n`
        : `\n【局面】${state.moveCount + 1}手目\n`;

      return `あなたは五目並べの${aiLabel}番、相手は${playerLabel}番です。思考の無限ループは禁止です。
以下の「3つのステップ」のみを日本語で簡潔に記述し、着手を決めてください。
${boardSection}
【有力候補手】
${listText}

【方針】
${diffConfig.policy}

【厳守する思考手順】
[思考ステップ1] 局面の確認: （現在の攻防の要点を1文で整理）
[思考ステップ2] 候補手の評価: （方針に沿って候補手を1〜2文で比較）
[思考ステップ3] 着手の決定: （選んだ座標と理由を1文で明記）
MOVE: 選んだ座標（例: MOVE: H8）

※必ず上記の形式通り日本語のみで出力し、末尾に「MOVE: 座標」を1行出力してください。`;
    },

    applyUserAction(state, move) {
      return applyPlacement(state, move, state.playerColor, "あなた");
    },

    applyAiAction(state, chosenMove, diffName, isFallback) {
      return applyPlacement(
        state,
        chosenMove,
        state.aiColor,
        isFallback ? "AI (フォールバック)" : `AI (${diffName})`
      );
    }
  });
})();
