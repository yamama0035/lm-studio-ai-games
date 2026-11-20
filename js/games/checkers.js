(() => {
  "use strict";

  const SIZE = 8;
  const COLS = ["A", "B", "C", "D", "E", "F", "G", "H"];
  const EMPTY = 0;
  const HUMAN_MAN = 1;
  const HUMAN_KING = 2;
  const AI_MAN = 3;
  const AI_KING = 4;

  const HUMAN = 1;
  const AI = 2;

  const DIFFICULTIES = {
    easy: { temperature: 0.85, maxTokens: 1200, includeBoard: false, includeLookahead: false, policy: "深く読まず直感で動かす。" },
    normal: { temperature: 0.3, maxTokens: 1600, includeBoard: true, includeLookahead: false, policy: "駒を取られない安全なマスやキング成りを目指す。" },
    hard: { temperature: 0.1, maxTokens: 2048, includeBoard: true, includeLookahead: true, policy: "連続ジャンプやキング成りを狙い、相手にジャンプ捕獲されない手を選ぶ。" },
    master: { temperature: 0.05, maxTokens: 2400, includeBoard: true, includeLookahead: true, policy: "盤面中央・キング育成・端の安全地帯を活かし、次手で相手に取られない最善手を選ぶ。" }
  };

  function ownerOf(piece) {
    if (piece === HUMAN_MAN || piece === HUMAN_KING) return HUMAN;
    if (piece === AI_MAN || piece === AI_KING) return AI;
    return 0;
  }

  function isKing(piece) {
    return piece === HUMAN_KING || piece === AI_KING;
  }

  function cloneBoard(board) {
    return board.map(r => [...r]);
  }

  function coord(r, c) {
    return `${COLS[c]}${r + 1}`;
  }

  function createInitialBoard() {
    const board = Array.from({ length: SIZE }, () => new Array(SIZE).fill(EMPTY));
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < SIZE; c++) {
        if ((r + c) % 2 === 1) board[r][c] = AI_MAN;
      }
    }
    for (let r = 5; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if ((r + c) % 2 === 1) board[r][c] = HUMAN_MAN;
      }
    }
    return board;
  }

  function getDirsForPiece(piece) {
    if (isKing(piece)) return [[-1, -1], [-1, 1], [1, -1], [1, 1]];
    if (piece === HUMAN_MAN) return [[-1, -1], [-1, 1]];
    if (piece === AI_MAN) return [[1, -1], [1, 1]];
    return [];
  }

  function getSingleJumpsFrom(board, r, c, piece) {
    const owner = ownerOf(piece);
    const jumps = [];
    for (const [dr, dc] of getDirsForPiece(piece)) {
      const mr = r + dr;
      const mc = c + dc;
      const lr = r + dr * 2;
      const lc = c + dc * 2;
      if (lr < 0 || lr >= SIZE || lc < 0 || lc >= SIZE) continue;
      if (ownerOf(board[mr][mc]) === (owner === HUMAN ? AI : HUMAN) && board[lr][lc] === EMPTY) {
        jumps.push({
          fromR: r,
          fromC: c,
          toR: lr,
          toC: lc,
          capR: mr,
          capC: mc
        });
      }
    }
    return jumps;
  }

  // 完全な手（単移動または連続ジャンプシーケンス）を列挙
  function getFullCaptureSequencesFrom(board, r, c, piece, pathCoords, capturedCoords) {
    const singleJumps = getSingleJumpsFrom(board, r, c, piece);
    const results = [];

    for (const j of singleJumps) {
      const sim = cloneBoard(board);
      sim[j.fromR][j.fromC] = EMPTY;
      sim[j.capR][j.capC] = EMPTY;

      const promoted = (piece === HUMAN_MAN && j.toR === 0) || (piece === AI_MAN && j.toR === SIZE - 1);
      const nextPiece = promoted ? (piece === HUMAN_MAN ? HUMAN_KING : AI_KING) : piece;
      sim[j.toR][j.toC] = nextPiece;

      const nextPath = [...pathCoords, [j.toR, j.toC]];
      const nextCaps = [...capturedCoords, [j.capR, j.capC]];

      // キング成りしたら手番終了（標準アメリカンチェッカー）
      if (!promoted) {
        const continuations = getFullCaptureSequencesFrom(sim, j.toR, j.toC, nextPiece, nextPath, nextCaps);
        if (continuations.length > 0) {
          results.push(...continuations);
          continue;
        }
      }

      results.push({
        path: nextPath,
        captures: nextCaps,
        promoted
      });
    }
    return results;
  }

  function getAllFullMoves(board, actor) {
    const captures = [];
    const simples = [];

    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const piece = board[r][c];
        if (ownerOf(piece) !== actor) continue;

        const seqs = getFullCaptureSequencesFrom(board, r, c, piece, [[r, c]], []);
        for (const seq of seqs) {
          captures.push({
            fromR: r,
            fromC: c,
            toR: seq.path[seq.path.length - 1][0],
            toC: seq.path[seq.path.length - 1][1],
            path: seq.path,
            captures: seq.captures,
            promoted: seq.promoted,
            isCapture: true,
            label: `${coord(r, c)}-${coord(seq.path[seq.path.length - 1][0], seq.path[seq.path.length - 1][1])}`,
            displayPath: seq.path.map(([pr, pc]) => coord(pr, pc)).join("→")
          });
        }
      }
    }

    if (captures.length > 0) {
      // ラベル衝突（同じ始点・終点で別経路の連続ジャンプ）があれば識別番号を付与
      const labelCounts = new Map();
      for (const m of captures) {
        labelCounts.set(m.label, (labelCounts.get(m.label) || 0) + 1);
      }
      const seen = new Map();
      return captures.map(m => {
        if (labelCounts.get(m.label) > 1) {
          const idx = (seen.get(m.label) || 0) + 1;
          seen.set(m.label, idx);
          const fullLabel = m.path.map(([pr, pc]) => coord(pr, pc)).join("-");
          return { ...m, label: fullLabel };
        }
        return m;
      });
    }

    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const piece = board[r][c];
        if (ownerOf(piece) !== actor) continue;
        for (const [dr, dc] of getDirsForPiece(piece)) {
          const nr = r + dr;
          const nc = c + dc;
          if (nr < 0 || nr >= SIZE || nc < 0 || nc >= SIZE || board[nr][nc] !== EMPTY) continue;
          const promoted = (piece === HUMAN_MAN && nr === 0) || (piece === AI_MAN && nr === SIZE - 1);
          simples.push({
            fromR: r,
            fromC: c,
            toR: nr,
            toC: nc,
            path: [[r, c], [nr, nc]],
            captures: [],
            promoted,
            isCapture: false,
            label: `${coord(r, c)}-${coord(nr, nc)}`,
            displayPath: `${coord(r, c)}→${coord(nr, nc)}`
          });
        }
      }
    }

    return simples;
  }

  function applyFullMoveToBoard(board, move) {
    const next = cloneBoard(board);
    const piece = next[move.fromR][move.fromC];
    next[move.fromR][move.fromC] = EMPTY;
    for (const [cr, cc] of move.captures) {
      next[cr][cc] = EMPTY;
    }
    let finalPiece = piece;
    if (move.promoted) {
      finalPiece = ownerOf(piece) === HUMAN ? HUMAN_KING : AI_KING;
    }
    next[move.toR][move.toC] = finalPiece;
    return next;
  }

  function countPieces(board) {
    let human = 0;
    let ai = 0;
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const o = ownerOf(board[r][c]);
        if (o === HUMAN) human++;
        else if (o === AI) ai++;
      }
    }
    return { human, ai };
  }

  function boardToText(board) {
    const lines = ["  A B C D E F G H"];
    for (let r = 0; r < SIZE; r++) {
      const chars = [];
      for (let c = 0; c < SIZE; c++) {
        const p = board[r][c];
        if (p === HUMAN_MAN) chars.push("●");
        else if (p === HUMAN_KING) chars.push("◆");
        else if (p === AI_MAN) chars.push("○");
        else if (p === AI_KING) chars.push("◇");
        else chars.push((r + c) % 2 === 1 ? "·" : " ");
      }
      lines.push(`${r + 1} ${chars.join(" ")}`);
    }
    return lines.join("\n");
  }

  function extractAction(visibleContent, combinedReasoning, validActions) {
    const normalizedMap = new Map(validActions.map(m => [m.label.toUpperCase(), m.label]));
    const findLast = (text) => {
      if (!text) return null;
      const re = /MOVE\s*[:：]\s*(?:\*\*|__|`|\[)*\s*([A-H][1-8](?:[-→>][A-H][1-8])+)/gi;
      let m;
      let last = null;
      while ((m = re.exec(text)) !== null) {
        const raw = m[1].toUpperCase().replace(/[→>]/g, "-");
        if (normalizedMap.has(raw)) {
          last = normalizedMap.get(raw);
        } else {
          // 始点-終点形式でも一致するか確認
          const parts = raw.split("-");
          const short = `${parts[0]}-${parts[parts.length - 1]}`;
          if (normalizedMap.has(short)) last = normalizedMap.get(short);
        }
      }
      return last;
    };

    const fromMove = findLast(visibleContent);
    if (fromMove) return { label: fromMove, sourceLabel: "" };

    const fromReason = findLast(combinedReasoning);
    if (fromReason) return { label: fromReason, sourceLabel: "推論内MOVE抽出" };

    // 本文から任意の合法ラベルの最後の出現を探す
    const fullRe = /\b([A-H][1-8](?:[-→>][A-H][1-8])+)\b/gi;
    const scanLast = (txt) => {
      if (!txt) return null;
      let m;
      let last = null;
      while ((m = fullRe.exec(txt)) !== null) {
        const raw = m[1].toUpperCase().replace(/[→>]/g, "-");
        if (normalizedMap.has(raw)) last = normalizedMap.get(raw);
      }
      return last;
    };

    const hitVis = scanLast(visibleContent);
    if (hitVis) return { label: hitVis, sourceLabel: "本文末座標抽出" };

    const hitReas = scanLast(combinedReasoning);
    if (hitReas) return { label: hitReas, sourceLabel: "推論末座標抽出" };

    return { label: validActions[0].label, sourceLabel: "先頭手フォールバック" };
  }

  function getHumanStepChoices(state) {
    if (state.jumpingFrom) {
      const { r, c } = state.jumpingFrom;
      const piece = state.board[r][c];
      return getSingleJumpsFrom(state.board, r, c, piece).map(j => ({
        kind: "jump_step",
        ...j
      }));
    }

    const fullMoves = getAllFullMoves(state.board, HUMAN);
    const hasMandatoryCapture = fullMoves.some(m => m.isCapture);
    const selectableFromSet = new Set(fullMoves.map(m => `${m.fromR},${m.fromC}`));

    let destinations = [];
    if (state.selectedCell) {
      const { r, c } = state.selectedCell;
      if (hasMandatoryCapture) {
        const piece = state.board[r][c];
        destinations = getSingleJumpsFrom(state.board, r, c, piece).map(j => ({
          kind: "jump_step",
          ...j
        }));
      } else {
        destinations = fullMoves
          .filter(m => m.fromR === r && m.fromC === c)
          .map(m => ({
            kind: "simple",
            fromR: m.fromR,
            fromC: m.fromC,
            toR: m.toR,
            toC: m.toC,
            promoted: m.promoted
          }));
      }
    }

    return { hasMandatoryCapture, selectableFromSet, destinations };
  }

  function renderBoard(stageEl, state, { canPlayerAct, onUserAction }) {
    const wrapper = document.createElement("div");
    wrapper.className = "board-wrapper checkers-wrapper";

    const colLabels = document.createElement("div");
    colLabels.className = "col-labels";
    for (const c of COLS) {
      const div = document.createElement("div");
      div.textContent = c;
      colLabels.appendChild(div);
    }

    const rowLabels = document.createElement("div");
    rowLabels.className = "row-labels";
    for (let r = 0; r < SIZE; r++) {
      const div = document.createElement("div");
      div.textContent = String(r + 1);
      rowLabels.appendChild(div);
    }

    const boardEl = document.createElement("div");
    boardEl.className = "checkers-board";

    let stepChoices = { hasMandatoryCapture: false, selectableFromSet: new Set(), destinations: [] };
    if (canPlayerAct) {
      if (state.jumpingFrom) {
        const jumpSteps = getHumanStepChoices(state);
        stepChoices = {
          hasMandatoryCapture: true,
          selectableFromSet: new Set([`${state.jumpingFrom.r},${state.jumpingFrom.c}`]),
          destinations: jumpSteps
        };
      } else {
        stepChoices = getHumanStepChoices(state);
      }
    }

    const destMap = new Map(stepChoices.destinations.map(d => [`${d.toR},${d.toC}`, d]));

    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const cell = document.createElement("div");
        const isDark = (r + c) % 2 === 1;
        cell.className = `checkers-cell ${isDark ? "dark" : "light"}`;

        const key = `${r},${c}`;
        const isSelected = state.selectedCell && state.selectedCell.r === r && state.selectedCell.c === c;
        const isJumping = state.jumpingFrom && state.jumpingFrom.r === r && state.jumpingFrom.c === c;
        if (isSelected || isJumping) cell.classList.add("selected");

        if (state.lastMove && ((state.lastMove.toR === r && state.lastMove.toC === c) || (state.lastMove.fromR === r && state.lastMove.fromC === c))) {
          cell.classList.add("last-move");
        }

        const val = state.board[r][c];
        if (val !== EMPTY) {
          const piece = document.createElement("div");
          const owner = ownerOf(val);
          piece.className = `checkers-piece ${owner === HUMAN ? "human" : "ai"} ${isKing(val) ? "king" : ""}`;
          if (isKing(val)) {
            piece.textContent = "♛";
          }
          if (canPlayerAct && !state.jumpingFrom && stepChoices.selectableFromSet.has(key)) {
            cell.classList.add("clickable");
            cell.title = `${coord(r, c)} を選択`;
            cell.onclick = () => onUserAction({ kind: "select", r, c });
          }
          cell.appendChild(piece);
        } else {
          const dest = destMap.get(key);
          if (dest && canPlayerAct) {
            cell.classList.add("clickable", "dest-highlight");
            const dot = document.createElement("div");
            dot.className = "hint";
            cell.appendChild(dot);
            cell.title = `${coord(dest.fromR, dest.fromC)} → ${coord(dest.toR, dest.toC)}`;
            cell.onclick = () => onUserAction(dest);
          }
        }

        boardEl.appendChild(cell);
      }
    }

    wrapper.append(colLabels, rowLabels, boardEl);
    stageEl.appendChild(wrapper);

    if (canPlayerAct && (stepChoices.hasMandatoryCapture || state.jumpingFrom)) {
      const note = document.createElement("div");
      note.className = "game-sub-note";
      note.textContent = state.jumpingFrom
        ? `連続ジャンプ中（${coord(state.jumpingFrom.r, state.jumpingFrom.c)}）：続けて飛び越えるマスを選んでください。`
        : "相手駒を取れる配置があります（ジャンプ捕獲は必須です）。";
      stageEl.appendChild(note);
    }
  }

  function finalizeTurnState(nextBoard, state, moveCount, lastMove, entries, nextActor) {
    const counts = countPieces(nextBoard);
    const nextMoves = getAllFullMoves(nextBoard, nextActor);
    const gameOver = counts.human === 0 || counts.ai === 0 || nextMoves.length === 0 || state.stagnantMoves >= 80;
    let winner = 0;
    if (gameOver) {
      if (counts.human === 0 || (nextActor === HUMAN && nextMoves.length === 0)) winner = AI;
      else if (counts.ai === 0 || (nextActor === AI && nextMoves.length === 0)) winner = HUMAN;
      else if (counts.human > counts.ai) winner = HUMAN;
      else if (counts.ai > counts.human) winner = AI;
    }

    return {
      state: {
        board: nextBoard,
        playerIsFirst: state.playerIsFirst,
        currentTurn: nextActor,
        moveCount,
        lastMove,
        selectedCell: null,
        jumpingFrom: null,
        chainCaptures: 0,
        chainOrigin: null,
        stagnantMoves: state.stagnantMoves,
        winner,
        gameOver
      },
      historyEntries: entries,
      autoAdvanceDelayMs: 0
    };
  }

  globalThis.GameRegistry.register({
    id: "checkers",
    category: "board",
    name: "チェッカー",
    title: "チェッカー (Checkers 8×8)",
    difficultyLabels: {
      easy: "かんたん（直感打ち）",
      normal: "ふつう（安全・キング志向）",
      hard: "つよい（連続ジャンプ・防衛）",
      master: "達人（反撃計算・中央制圧）"
    },
    sideLabel: "あなた",
    sideOptions: [
      { value: "first", text: "先手（先攻）" },
      { value: "second", text: "後手（後攻）" }
    ],
    defaultSide: "first",
    extractAction,
    rulesHtml: `
      <ul>
        <li>黒マス（斜め方向）を使って進みます。通常駒（マン）は前斜め1マス、<strong>キング（♛）</strong>は前後斜め1マスへ移動できます。</li>
        <li>斜め前に相手駒があり、その奥が空いていれば飛び越えて捕獲します（<strong>捕獲できる手は必須</strong>・連続ジャンプ可）。</li>
        <li>相手陣の最奥段（1段目）に到達するとキングに昇格します（昇格した瞬間にその手番は終了）。</li>
        <li>相手駒をすべて取るか、相手が動けなくなると勝利です。</li>
      </ul>
    `,

    createInitialState(sideValue) {
      const playerIsFirst = sideValue !== "second";
      return {
        board: createInitialBoard(),
        playerIsFirst,
        currentTurn: playerIsFirst ? HUMAN : AI,
        moveCount: 0,
        lastMove: null,
        selectedCell: null,
        jumpingFrom: null,
        chainCaptures: 0,
        chainOrigin: null,
        stagnantMoves: 0,
        winner: 0,
        gameOver: false
      };
    },

    cloneState(state) {
      return {
        board: cloneBoard(state.board),
        playerIsFirst: state.playerIsFirst,
        currentTurn: state.currentTurn,
        moveCount: state.moveCount,
        lastMove: state.lastMove ? { ...state.lastMove } : null,
        selectedCell: state.selectedCell ? { ...state.selectedCell } : null,
        jumpingFrom: state.jumpingFrom ? { ...state.jumpingFrom } : null,
        chainCaptures: state.chainCaptures,
        chainOrigin: state.chainOrigin ? { ...state.chainOrigin } : null,
        stagnantMoves: state.stagnantMoves,
        winner: state.winner,
        gameOver: state.gameOver
      };
    },

    isAiTurn(state) {
      return !state.gameOver && state.currentTurn === AI;
    },

    isGameOver(state) {
      return state.gameOver;
    },

    getScoreDisplay(state) {
      const counts = countPieces(state.board);
      return {
        firstDotClass: "dot checkers-human",
        firstLabel: "あなた(残駒)",
        firstValue: counts.human,
        secondDotClass: "dot checkers-ai",
        secondLabel: "AI(残駒)",
        secondValue: counts.ai
      };
    },

    getTurnText(state, { isAiThinking, hasError }) {
      if (state.gameOver) {
        if (state.winner === 0) return "終局: 引き分け";
        return `終局: ${state.winner === HUMAN ? "あなたの勝利！" : "AIの勝利！"}`;
      }
      if (isAiThinking) return "手番: AI が考慮中...";
      if (hasError) return "手番: AI - 待機中";
      return state.currentTurn === HUMAN ? "手番: あなた" : "手番: AI";
    },

    getStartHistoryText(state) {
      return `対局開始（チェッカー）: あなたは${state.playerIsFirst ? "先手（下側）" : "後手（下側）"}です。`;
    },

    getPlaceholderText(state) {
      return state.playerIsFirst
        ? "手番を待っています。自分の駒をクリックして進めてください。"
        : "AI（先手）の初手を待っています。";
    },

    getEndText(state) {
      const counts = countPieces(state.board);
      const res = state.winner === 0 ? "引き分けです。" : state.winner === HUMAN ? "あなたの勝利！" : "AIの勝利！";
      return `【終局】 あなた:${counts.human}駒 / AI:${counts.ai}駒（${res}）`;
    },

    renderBoard,

    getValidAiActions(state) {
      return getAllFullMoves(state.board, AI);
    },

    getDifficultyConfig(diffKey) {
      return DIFFICULTIES[diffKey] || DIFFICULTIES.normal;
    },

    buildAiPrompt(state, validActions, diffConfig) {
      const listText = validActions.map(m => {
        let info = `・${m.label}`;
        if (m.displayPath !== m.label.replace(/-/g, "→")) {
          info += ` (経路:${m.displayPath})`;
        }
        const tags = [];
        if (m.isCapture) tags.push(`${m.captures.length}枚捕獲`);
        if (m.promoted) tags.push("★キング昇格");
        if (diffConfig.includeLookahead) {
          const simBoard = applyFullMoveToBoard(state.board, m);
          const oppMoves = getAllFullMoves(simBoard, HUMAN);
          const oppCaps = oppMoves.filter(om => om.isCapture);
          if (oppMoves.length === 0) tags.push("★相手手詰まり・即勝利");
          else if (oppCaps.length > 0) {
            const maxCap = Math.max(...oppCaps.map(om => om.captures.length));
            tags.push(`⚠️次手で相手に${maxCap}枚取られる`);
          } else {
            tags.push("安全");
          }
        }
        if (tags.length > 0) info += ` [${tags.join(" / ")}]`;
        return info;
      }).join("\n");

      const boardSection = diffConfig.includeBoard
        ? `\n【現在の盤面】(○=AI通常 / ◇=AIキング / ●=相手通常 / ◆=相手キング)\n${boardToText(state.board)}\n`
        : `\n【局面】${state.moveCount + 1}手目\n`;

      return `あなたはチェッカーのAI（上側から下へ進行）です。思考の無限ループは禁止です。
以下の「3つのステップ」のみを日本語で簡潔に記述してください。
${boardSection}
【合法手一覧】
${listText}

【方針】
${diffConfig.policy}

【厳守する思考手順】
[思考ステップ1] 局面の確認: （駒数と捕獲機会を1文で整理）
[思考ステップ2] 手の評価: （方針に沿って候補手を1〜2文で比較）
[思考ステップ3] 着手の決定: （選んだ手と理由を1文で明記）
MOVE: 選んだ手（例: MOVE: ${validActions[0].label}）

※必ず上記の形式通り日本語のみで出力し、末尾に「MOVE: 座標-座標」を1行出力してください。`;
    },

    applyUserAction(state, action) {
      if (action.kind === "select") {
        const same = state.selectedCell && state.selectedCell.r === action.r && state.selectedCell.c === action.c;
        return {
          state: {
            ...this.cloneState(state),
            selectedCell: same ? null : { r: action.r, c: action.c }
          },
          historyEntries: [],
          shouldPushUndo: false,
          autoAdvanceDelayMs: 0
        };
      }

      if (action.kind === "simple") {
        const nextBoard = cloneBoard(state.board);
        const piece = nextBoard[action.fromR][action.fromC];
        nextBoard[action.fromR][action.fromC] = EMPTY;
        nextBoard[action.toR][action.toC] = action.promoted ? HUMAN_KING : piece;
        const nextCount = state.moveCount + 1;
        const stagnant = piece === HUMAN_MAN ? 0 : state.stagnantMoves + 1;
        const nextState = { ...state, stagnantMoves: stagnant };
        return finalizeTurnState(
          nextBoard,
          nextState,
          nextCount,
          { fromR: action.fromR, fromC: action.fromC, toR: action.toR, toC: action.toC },
          [{
            type: "move",
            turnNumber: nextCount,
            actor: "あなた",
            colorLabel: state.playerIsFirst ? "先手" : "後手",
            label: `${coord(action.fromR, action.fromC)}→${coord(action.toR, action.toC)}`,
            detailText: action.promoted ? " [★キング昇格]" : ""
          }],
          AI
        );
      }

      // jump_step
      const isChainStart = !state.jumpingFrom;
      const nextBoard = cloneBoard(state.board);
      const piece = nextBoard[action.fromR][action.fromC];
      nextBoard[action.fromR][action.fromC] = EMPTY;
      nextBoard[action.capR][action.capC] = EMPTY;
      const promoted = piece === HUMAN_MAN && action.toR === 0;
      const nextPiece = promoted ? HUMAN_KING : piece;
      nextBoard[action.toR][action.toC] = nextPiece;

      const moreJumps = !promoted ? getSingleJumpsFrom(nextBoard, action.toR, action.toC, nextPiece) : [];
      const totalCaps = state.chainCaptures + 1;
      const origin = state.chainOrigin || { r: action.fromR, c: action.fromC };

      if (moreJumps.length > 0) {
        return {
          state: {
            board: nextBoard,
            playerIsFirst: state.playerIsFirst,
            currentTurn: HUMAN,
            moveCount: state.moveCount,
            lastMove: { fromR: action.fromR, fromC: action.fromC, toR: action.toR, toC: action.toC },
            selectedCell: { r: action.toR, c: action.toC },
            jumpingFrom: { r: action.toR, c: action.toC },
            chainCaptures: totalCaps,
            chainOrigin: origin,
            stagnantMoves: 0,
            winner: 0,
            gameOver: false
          },
          historyEntries: [],
          shouldPushUndo: isChainStart,
          autoAdvanceDelayMs: 0
        };
      }

      const nextCount = state.moveCount + 1;
      const nextState = { ...state, stagnantMoves: 0 };
      const res = finalizeTurnState(
        nextBoard,
        nextState,
        nextCount,
        { fromR: origin.r, fromC: origin.c, toR: action.toR, toC: action.toC },
        [{
          type: "move",
          turnNumber: nextCount,
          actor: "あなた",
          colorLabel: state.playerIsFirst ? "先手" : "後手",
          label: `${coord(origin.r, origin.c)}→${coord(action.toR, action.toC)}`,
          detailText: ` (${totalCaps}枚捕獲${promoted ? "・★キング昇格" : ""})`
        }],
        AI
      );
      res.shouldPushUndo = isChainStart;
      return res;
    },

    applyAiAction(state, chosenMove, diffName, isFallback) {
      const nextBoard = applyFullMoveToBoard(state.board, chosenMove);
      const nextCount = state.moveCount + 1;
      const piece = state.board[chosenMove.fromR][chosenMove.fromC];
      const stagnant = (chosenMove.isCapture || piece === AI_MAN) ? 0 : state.stagnantMoves + 1;
      const nextState = { ...state, stagnantMoves: stagnant };
      const capText = chosenMove.isCapture ? ` (${chosenMove.captures.length}枚捕獲` : "";
      const promText = chosenMove.promoted ? (capText ? "・★キング昇格)" : " [★キング昇格]") : (capText ? ")" : "");

      return finalizeTurnState(
        nextBoard,
        nextState,
        nextCount,
        { fromR: chosenMove.fromR, fromC: chosenMove.fromC, toR: chosenMove.toR, toC: chosenMove.toC },
        [{
          type: "move",
          turnNumber: nextCount,
          actor: isFallback ? "AI (フォールバック)" : `AI (${diffName})`,
          colorLabel: state.playerIsFirst ? "後手" : "先手",
          label: chosenMove.displayPath,
          detailText: `${capText}${promText}`
        }],
        HUMAN
      );
    }
  });
})();
