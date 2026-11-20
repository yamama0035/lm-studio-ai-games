(() => {
  "use strict";

  const EMPTY = 0;
  const BLACK = 1;
  const WHITE = 2;
  const COLS = ["A", "B", "C", "D", "E", "F", "G", "H"];
  const DIRS = [
    [-1, -1], [-1, 0], [-1, 1],
    [0, -1],           [0, 1],
    [1, -1],  [1, 0],  [1, 1]
  ];

  function createInitialBoard() {
    const board = Array(8).fill(null).map(() => Array(8).fill(EMPTY));
    board[3][3] = WHITE;
    board[3][4] = BLACK;
    board[4][3] = BLACK;
    board[4][4] = WHITE;
    return board;
  }

  function cloneBoard(board) {
    return board.map(row => [...row]);
  }

  function getOpponent(player) {
    return player === BLACK ? WHITE : BLACK;
  }

  function getColorLabel(color) {
    return color === BLACK ? "黒" : "白";
  }

  function isCornerCoord(r, c) {
    return (r === 0 || r === 7) && (c === 0 || c === 7);
  }

  function getCellType(r, c, board, perspectiveColor = WHITE) {
    if (isCornerCoord(r, c)) return "四隅の角（最重要・確定石）";

    const isX = (r === 1 || r === 6) && (c === 1 || c === 6);
    if (isX) {
      const cr = r === 1 ? 0 : 7;
      const cc = c === 1 ? 0 : 7;
      const cornerVal = board[cr][cc];
      if (cornerVal === EMPTY) return "危険なX打ち（角が空いており奪われるリスク）";
      return cornerVal === perspectiveColor ? "X位置（隣角は自石で確保済み）" : "X位置（隣角は相手石）";
    }

    const isC = ((r === 0 || r === 7) && (c === 1 || c === 6)) ||
                ((r === 1 || r === 6) && (c === 0 || c === 7));
    if (isC) {
      const cr = r <= 1 ? 0 : 7;
      const cc = c <= 1 ? 0 : 7;
      const cornerVal = board[cr][cc];
      if (cornerVal === EMPTY) return "注意なC打ち（角が空いており奪われるリスク）";
      return cornerVal === perspectiveColor ? "C位置（隣角は自石で確保済み）" : "C位置（隣角は相手石）";
    }

    if (r === 0 || r === 7 || c === 0 || c === 7) return "辺のマス（比較的安定）";
    return "中央エリア";
  }

  function getFlips(board, r, c, player) {
    if (board[r][c] !== EMPTY) return [];
    const opponent = getOpponent(player);
    const totalFlips = [];

    for (const [dr, dc] of DIRS) {
      let nr = r + dr;
      let nc = c + dc;
      const candidate = [];

      while (nr >= 0 && nr < 8 && nc >= 0 && nc < 8 && board[nr][nc] === opponent) {
        candidate.push([nr, nc]);
        nr += dr;
        nc += dc;
      }

      if (candidate.length > 0 && nr >= 0 && nr < 8 && nc >= 0 && nc < 8 && board[nr][nc] === player) {
        totalFlips.push(...candidate);
      }
    }
    return totalFlips;
  }

  function getValidMoves(board, player, perspectiveColor = player) {
    const moves = [];
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const flips = getFlips(board, r, c, player);
        if (flips.length > 0) {
          moves.push({
            r,
            c,
            flips,
            label: `${COLS[c]}${r + 1}`,
            type: getCellType(r, c, board, perspectiveColor)
          });
        }
      }
    }
    return moves;
  }

  function applyMove(board, r, c, player, flips) {
    board[r][c] = player;
    for (const [fr, fc] of flips) {
      board[fr][fc] = player;
    }
  }

  function countStones(board) {
    let black = 0;
    let white = 0;
    let empty = 0;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if (board[r][c] === BLACK) black++;
        else if (board[r][c] === WHITE) white++;
        else empty++;
      }
    }
    return { black, white, empty };
  }

  function boardToText(board) {
    const lines = ["  A B C D E F G H"];
    for (let r = 0; r < 8; r++) {
      const rowChars = [];
      for (let c = 0; c < 8; c++) {
        const val = board[r][c];
        rowChars.push(val === BLACK ? "●" : val === WHITE ? "○" : "·");
      }
      lines.push(`${r + 1} ${rowChars.join(" ")}`);
    }
    return lines.join("\n");
  }

  globalThis.OthelloEngine = {
    EMPTY,
    BLACK,
    WHITE,
    COLS,
    DIRS,
    createInitialBoard,
    cloneBoard,
    getOpponent,
    getColorLabel,
    isCornerCoord,
    getCellType,
    getFlips,
    getValidMoves,
    applyMove,
    countStones,
    boardToText
  };
})();
