(() => {
  "use strict";

  const ROWS = 6;
  const COLS = 7;
  const COL_NAMES = ["A", "B", "C", "D", "E", "F", "G"];
  const EMPTY = 0;
  const RED = 1;
  const YELLOW = 2;

  const DIFFICULTIES = {
    easy: { temperature: 0.85, maxTokens: 1200, includeBoard: false, includeLookahead: false, policy: "直感で好きな列に落とす。" },
    normal: { temperature: 0.3, maxTokens: 1600, includeBoard: true, includeLookahead: false, policy: "中央列の活用や3連の構築、相手の3連阻止を意識して選ぶ。" },
    hard: { temperature: 0.1, maxTokens: 2048, includeBoard: true, includeLookahead: true, policy: "即勝利と相手の4連阻止を最優先し、相手に即勝を献上する手を避ける。" },
    master: { temperature: 0.05, maxTokens: 2400, includeBoard: true, includeLookahead: true, policy: "即勝利・阻止・上段献上回避を徹底し、中央主導権と二重リーチ（両天秤）を狙う。" }
  };

  function createEmptyBoard() {
    return Array.from({ length: ROWS }, () => new Array(COLS).fill(EMPTY));
  }

  function cloneBoard(board) {
    return board.map(r => [...r]);
  }

  function getLandingRow(board, col) {
    for (let r = ROWS - 1; r >= 0; r--) {
      if (board[r][col] === EMPTY) return r;
    }
    return -1;
  }

  function checkWinnerFrom(board, r, c) {
    const color = board[r][c];
    if (color === EMPTY) return null;
    const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
    for (const [dr, dc] of dirs) {
      const line = [[r, c]];
      for (let s = 1; s < 4; s++) {
        const nr = r + dr * s;
        const nc = c + dc * s;
        if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS || board[nr][nc] !== color) break;
        line.push([nr, nc]);
      }
      for (let s = 1; s < 4; s++) {
        const nr = r - dr * s;
        const nc = c - dc * s;
        if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS || board[nr][nc] !== color) break;
        line.push([nr, nc]);
      }
      if (line.length >= 4) return { winner: color, line };
    }
    return null;
  }

  function getValidColumns(board) {
    const moves = [];
    for (let c = 0; c < COLS; c++) {
      const r = getLandingRow(board, c);
      if (r !== -1) {
        moves.push({ col: c, row: r, label: COL_NAMES[c] });
      }
    }
    return moves;
  }

  function countPieces(board) {
    let red = 0;
    let yellow = 0;
    let empty = 0;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (board[r][c] === RED) red++;
        else if (board[r][c] === YELLOW) yellow++;
        else empty++;
      }
    }
    return { red, yellow, empty };
  }

  function boardToText(board) {
    const lines = ["  A B C D E F G"];
    for (let r = 0; r < ROWS; r++) {
      const chars = board[r].map(v => (v === RED ? "●" : v === YELLOW ? "○" : "·"));
      lines.push(`${r + 1} ${chars.join(" ")}`);
    }
    return lines.join("\n");
  }

  function extractAction(visibleContent, combinedReasoning, validActions) {
    const validSet = new Set(validActions.map(m => m.label.toUpperCase()));
    const findLast = (text, regex) => {
      if (!text) return null;
      let m;
      let last = null;
      while ((m = regex.exec(text)) !== null) {
        const col = m[1].toUpperCase();
        if (validSet.has(col)) last = col;
      }
      return last;
    };

    const moveRe = () => /MOVE\s*[:：]\s*(?:\*\*|__|`|\[)*\s*([A-G])(?:列)?\b/gi;
    const colWordRe = () => /([A-G])列/gi;

    let hit = findLast(visibleContent, moveRe());
    if (hit) return { label: hit, sourceLabel: "" };

    hit = findLast(combinedReasoning, moveRe());
    if (hit) return { label: hit, sourceLabel: "推論内MOVE抽出" };

    const step3 = visibleContent.match(/\[?思考ステップ\s*3\]?([\s\S]*)$/i);
    if (step3) {
      hit = findLast(step3[1], colWordRe()) || findLast(step3[1], /\b([A-G])\b/g);
      if (hit) return { label: hit, sourceLabel: "ステップ3抽出" };
    }

    hit = findLast(visibleContent, colWordRe());
    if (hit) return { label: hit, sourceLabel: "本文末列抽出" };

    hit = findLast(combinedReasoning, colWordRe());
    if (hit) return { label: hit, sourceLabel: "推論末列抽出" };

    return { label: validActions[0].label, sourceLabel: "先頭手フォールバック" };
  }

  function renderBoard(stageEl, state, { canPlayerAct, onUserAction }) {
    const wrapper = document.createElement("div");
    wrapper.className = "c4-wrapper";

    const validCols = canPlayerAct ? getValidColumns(state.board) : [];
    const validMap = new Map(validCols.map(m => [m.col, m]));
    const winSet = new Set((state.winLine || []).map(([r, c]) => `${r},${c}`));

    const headers = document.createElement("div");
    headers.className = "c4-col-headers";
    for (let c = 0; c < COLS; c++) {
      const move = validMap.get(c);
      const btn = document.createElement(move ? "button" : "div");
      if (move) btn.type = "button";
      btn.className = `c4-col-btn ${move ? "clickable" : ""}`;
      btn.textContent = `${COL_NAMES[c]}`;
      if (move) {
        btn.title = `${COL_NAMES[c]}列に落とす`;
        btn.onclick = () => onUserAction(move);
      }
      headers.appendChild(btn);
    }

    const boardEl = document.createElement("div");
    boardEl.className = "c4-board";

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const cell = document.createElement("div");
        cell.className = "c4-cell";
        const move = validMap.get(c);
        if (move) {
          cell.classList.add("clickable");
          cell.onclick = () => onUserAction(move);
        }

        const disc = document.createElement("div");
        const val = state.board[r][c];
        disc.className = "c4-disc";
        if (val === RED) disc.classList.add("red");
        else if (val === YELLOW) disc.classList.add("yellow");
        else disc.classList.add("empty");

        const isLast = state.lastMove && state.lastMove.r === r && state.lastMove.c === c;
        if (isLast) disc.classList.add("last-placed");
        if (winSet.has(`${r},${c}`)) disc.classList.add("win-disc");

        cell.appendChild(disc);
        boardEl.appendChild(cell);
      }
    }

    wrapper.append(headers, boardEl);
    stageEl.appendChild(wrapper);
  }

  function applyDrop(state, move, color, actorName) {
    const nextBoard = cloneBoard(state.board);
    const r = getLandingRow(nextBoard, move.col);
    nextBoard[r][move.col] = color;
    const winInfo = checkWinnerFrom(nextBoard, r, move.col);
    const counts = countPieces(nextBoard);
    const isDraw = !winInfo && counts.empty === 0;

    return {
      state: {
        board: nextBoard,
        playerColor: state.playerColor,
        aiColor: state.aiColor,
        currentTurn: color === RED ? YELLOW : RED,
        moveCount: state.moveCount + 1,
        lastMove: { r, c: move.col, label: move.label },
        winLine: winInfo ? winInfo.line : null,
        winner: winInfo ? winInfo.winner : 0,
        gameOver: Boolean(winInfo) || isDraw
      },
      historyEntries: [{
        type: "move",
        turnNumber: state.moveCount + 1,
        actor: actorName,
        colorLabel: color === RED ? "赤" : "黄",
        label: `${move.label}列`,
        detailText: ` (${r + 1}段目${winInfo ? "・4連達成！" : ""})`
      }],
      autoAdvanceDelayMs: 0
    };
  }

  globalThis.GameRegistry.register({
    id: "connect4",
    category: "board",
    name: "四目並べ",
    title: "四目並べ (Connect Four)",
    difficultyLabels: {
      easy: "かんたん（直感打ち）",
      normal: "ふつう（列バランス）",
      hard: "つよい（即勝と阻止重視）",
      master: "達人（上段リスク・両天秤）"
    },
    sideLabel: "あなた",
    sideOptions: [
      { value: "red", text: "赤（先手）" },
      { value: "yellow", text: "黄（後手）" }
    ],
    defaultSide: "red",
    extractAction,
    rulesHtml: `
      <ul>
        <li>7列×6段の盤面で、列（A〜G）を選ぶと一番下の空きマスに石が落ちます。</li>
        <li>縦・横・斜めのいずれかに自分の石を<strong>4つ並べる</strong>と勝利です。</li>
      </ul>
    `,

    createInitialState(sideValue) {
      const playerColor = sideValue === "yellow" ? YELLOW : RED;
      return {
        board: createEmptyBoard(),
        playerColor,
        aiColor: playerColor === RED ? YELLOW : RED,
        currentTurn: RED,
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
        winLine: state.winLine ? state.winLine.map(x => [...x]) : null,
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
      const counts = countPieces(state.board);
      return {
        firstDotClass: "dot c4-red",
        firstLabel: `赤(${state.playerColor === RED ? "あなた" : "AI"})`,
        firstValue: counts.red,
        secondDotClass: "dot c4-yellow",
        secondLabel: `黄(${state.playerColor === YELLOW ? "あなた" : "AI"})`,
        secondValue: counts.yellow
      };
    },

    getTurnText(state, { isAiThinking, hasError }) {
      if (state.gameOver) {
        if (state.winner === 0) return "終局: 引き分け";
        return `終局: ${state.winner === state.playerColor ? "あなたの勝利！" : "AIの勝利！"}`;
      }
      const aiLabel = state.aiColor === RED ? "赤" : "黄";
      const playerLabel = state.playerColor === RED ? "赤" : "黄";
      if (isAiThinking) return `手番: AI (${aiLabel}) が考慮中...`;
      if (hasError) return `手番: AI (${aiLabel}) - 待機中`;
      return state.currentTurn === state.playerColor ? `手番: あなた (${playerLabel})` : `手番: AI (${aiLabel})`;
    },

    getStartHistoryText(state) {
      return `対局開始（四目並べ）: あなたは${state.playerColor === RED ? "赤（先手）" : "黄（後手）"}です。`;
    },

    getPlaceholderText(state) {
      return state.playerColor === RED
        ? "手番を待っています。列（A〜G）を選んで落としてください。"
        : "AI（赤・先手）の思考を待っています。";
    },

    getEndText(state) {
      if (state.winner === 0) return `【終局】 ${state.moveCount}手 引き分けです。`;
      return `【終局】 ${state.moveCount}手 ${state.winner === state.playerColor ? "あなたの勝利！" : "AIの勝利！"}`;
    },

    renderBoard,

    getValidAiActions(state) {
      return getValidColumns(state.board);
    },

    getDifficultyConfig(diffKey) {
      return DIFFICULTIES[diffKey] || DIFFICULTIES.normal;
    },

    buildAiPrompt(state, validActions, diffConfig) {
      const aiSymbol = state.aiColor === RED ? "赤 (●)" : "黄 (○)";
      const playerSymbol = state.playerColor === RED ? "赤 (●)" : "黄 (○)";

      const listText = validActions.map(m => {
        let info = `・${m.label}列 (着地:${m.row + 1}段目)`;
        if (diffConfig.includeLookahead) {
          const simWin = cloneBoard(state.board);
          simWin[m.row][m.col] = state.aiColor;
          const aiWin = checkWinnerFrom(simWin, m.row, m.col);

          const simOpp = cloneBoard(state.board);
          simOpp[m.row][m.col] = state.playerColor;
          const oppWinNow = checkWinnerFrom(simOpp, m.row, m.col);

          const notes = [];
          if (aiWin) notes.push("★即勝利！");
          if (oppWinNow) notes.push("⚠️相手4連阻止必須");
          if (m.row - 1 >= 0) {
            simWin[m.row - 1][m.col] = state.playerColor;
            if (checkWinnerFrom(simWin, m.row - 1, m.col)) {
              notes.push("⚠️上に置くと相手が4連になる危険あり");
            }
          }
          if (notes.length > 0) info += ` [${notes.join(" / ")}]`;
        }
        return info;
      }).join("\n");

      const boardSection = diffConfig.includeBoard
        ? `\n【現在の盤面 (7列×6段・下が底)】(●=赤 / ○=黄 / ·=空)\n${boardToText(state.board)}\n`
        : `\n【局面】${state.moveCount + 1}手目\n`;

      return `あなたは四目並べの${aiSymbol}番、相手は${playerSymbol}番です。思考の無限ループは禁止です。
以下の「3つのステップ」のみを日本語で簡潔に記述してください。
${boardSection}
【選べる列】
${listText}

【方針】
${diffConfig.policy}

【厳守する思考手順】
[思考ステップ1] 局面の確認: （現在の並びと脅威を1文で整理）
[思考ステップ2] 列の比較: （方針に沿って候補列を1〜2文で比較）
[思考ステップ3] 列の決定: （選んだ列と理由を1文で明記）
MOVE: 選んだ列のアルファベット（例: MOVE: D）

※必ず日本語のみで出力し、末尾に「MOVE: A〜Gの1文字」を出力してください。`;
    },

    applyUserAction(state, move) {
      return applyDrop(state, move, state.playerColor, "あなた");
    },

    applyAiAction(state, chosenMove, diffName, isFallback) {
      return applyDrop(
        state,
        chosenMove,
        state.aiColor,
        isFallback ? "AI (フォールバック)" : `AI (${diffName})`
      );
    }
  });
})();
