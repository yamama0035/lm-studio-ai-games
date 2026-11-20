(() => {
  "use strict";

  const C = globalThis.CardUtils;

  const HUMAN = 1;
  const AI = 2;
  const COLS = ["A", "B", "C", "D", "E", "F"];
  const ROWS = 4; // 6x4 = 24枚 (12ペア)

  const DIFFICULTIES = {
    easy: { temperature: 0.85, maxTokens: 1000, memoryLimit: 2, policy: "最近見た2枚くらいしか覚えていないため、気まぐれにカードをめくる。" },
    normal: { temperature: 0.3, maxTokens: 1400, memoryLimit: 6, policy: "記憶している範囲に揃うペアがあれば狙い、なければ未知の札をめくる。" },
    hard: { temperature: 0.1, maxTokens: 1800, memoryLimit: 12, policy: "記憶内の確定ペアを確実に回収し、なければまだ一度も見ていない位置を優先してめくる。" },
    master: { temperature: 0.05, maxTokens: 2000, memoryLimit: Infinity, policy: "公開済みの全カード位置を完全記憶し、確定ペアを即回収・情報収集に最適な未知カードを選ぶ。" }
  };

  function coordLabel(idx) {
    const r = Math.floor(idx / 6);
    const c = idx % 6;
    return `${COLS[c]}${r + 1}`;
  }

  function createInitialCards() {
    // ♠ と ♥ の A〜Q (12ランク×2 = 24枚)
    const ranks = C.RANKS.filter(r => r.value !== 13); // 2..10, J, Q, A (12個)
    const raw = [];
    for (const r of ranks) {
      for (const suitId of ["S", "H"]) {
        const s = C.SUIT_MAP[suitId];
        raw.push({
          id: `${suitId}${r.label}`,
          suit: suitId,
          suitSymbol: s.symbol,
          color: s.color,
          rank: r.value,
          label: r.label,
          isJoker: false,
          matched: false
        });
      }
    }
    return C.shuffle(raw);
  }

  function getRememberedMap(state, memoryLimit) {
    const map = new Map();
    const slice = memoryLimit === Infinity
      ? state.seenHistory
      : state.seenHistory.slice(-memoryLimit);
    for (const item of slice) {
      if (!state.cards[item.index].matched) {
        map.set(item.index, item.rankLabel);
      }
    }
    return map;
  }

  function renderBoard(stageEl, state, { canPlayerAct, onUserAction }) {
    const wrap = document.createElement("div");
    wrap.className = "memory-wrapper";

    const infoBar = document.createElement("div");
    infoBar.className = "table-info-bar";
    infoBar.innerHTML = `<span>残りペア: <strong>${12 - state.humanPairs - state.aiPairs}</strong>組</span><span>${state.pendingFlipBack ? "不一致…記憶中" : state.revealedIndices.length === 1 ? "2枚目を選択中" : "1枚目を選択"}</span>`;
    wrap.appendChild(infoBar);

    const grid = document.createElement("div");
    grid.className = "memory-grid";

    state.cards.forEach((card, idx) => {
      const slot = document.createElement("div");
      slot.className = "memory-slot";
      const label = coordLabel(idx);
      const isFaceUp = card.matched || state.revealedIndices.includes(idx);
      const canClick = canPlayerAct && !state.pendingFlipBack && !isFaceUp;

      const cardEl = C.createCardElement(card, {
        faceDown: !isFaceUp,
        playable: canClick,
        selected: state.revealedIndices.includes(idx),
        compact: true,
        coordLabel: label,
        onClick: canClick ? () => onUserAction({ index: idx, label }) : null
      });
      if (card.matched) {
        cardEl.classList.add("matched-card");
      }
      slot.appendChild(cardEl);
      grid.appendChild(slot);
    });

    wrap.appendChild(grid);

    const note = document.createElement("div");
    note.className = "field-last-note";
    note.textContent = state.lastActionText;
    wrap.appendChild(note);

    stageEl.appendChild(wrap);
  }

  function resolveFlip(state, idx, actor, actorName, isAi) {
    const next = {
      ...state,
      cards: state.cards.map(c => ({ ...c })),
      revealedIndices: [...state.revealedIndices, idx],
      seenHistory: [...state.seenHistory, { index: idx, rankLabel: state.cards[idx].label }]
    };

    const card = next.cards[idx];
    const label = coordLabel(idx);

    if (next.revealedIndices.length === 1) {
      next.lastActionText = `${actorName}が ${label} (${C.formatCardText(card)}) をめくりました。2枚目を選びます。`;
      return {
        state: next,
        historyEntries: [],
        shouldPushUndo: !isAi,
        autoAdvanceDelayMs: isAi ? 550 : 0
      };
    }

    // 2枚目
    const [idx1, idx2] = next.revealedIndices;
    const card1 = next.cards[idx1];
    const card2 = next.cards[idx2];
    const l1 = coordLabel(idx1);
    const l2 = coordLabel(idx2);
    next.moveCount++;

    if (card1.rank === card2.rank) {
      next.cards[idx1].matched = true;
      next.cards[idx2].matched = true;
      next.revealedIndices = [];
      if (actor === HUMAN) next.humanPairs++;
      else next.aiPairs++;

      const totalFound = next.humanPairs + next.aiPairs;
      const entries = [{
        type: "move",
        turnNumber: next.moveCount,
        actor: actorName,
        colorLabel: "ペア獲得",
        label: `${l1} & ${l2}`,
        detailText: ` (${card1.label}ペア! 計${actor === HUMAN ? next.humanPairs : next.aiPairs}組)`
      }];

      if (totalFound >= 12) {
        next.gameOver = true;
        next.lastActionText = `${actorName}が最後の ${card1.label} ペアを揃えて終局！`;
        return { state: next, historyEntries: entries, shouldPushUndo: false, autoAdvanceDelayMs: 0 };
      }

      next.lastActionText = `${actorName}が ${card1.label} ペアを獲得！連続手番です！`;
      entries.push({ type: "extra", text: `${actorName}: ペア成立で連続手番！` });
      return {
        state: next,
        historyEntries: entries,
        shouldPushUndo: false,
        autoAdvanceDelayMs: isAi ? 650 : 0
      };
    }

    // 不一致 -> 1000ms 見せてから裏返す
    next.pendingFlipBack = true;
    next.lastActionText = `${actorName}: ${l1}(${card1.label}) と ${l2}(${card2.label}) は不一致。`;
    return {
      state: next,
      historyEntries: [{
        type: "move",
        turnNumber: next.moveCount,
        actor: actorName,
        colorLabel: "不一致",
        label: `${l1} & ${l2}`,
        detailText: ` (${card1.label} ≠ ${card2.label})`
      }],
      shouldPushUndo: false,
      autoAdvanceDelayMs: 1000
    };
  }

  globalThis.GameRegistry.register({
    id: "memory",
    category: "card",
    name: "神経衰弱",
    title: "神経衰弱 (24枚・12ペア)",
    difficultyLabels: {
      easy: "かんたん（記憶2枚）",
      normal: "ふつう（記憶6枚）",
      hard: "つよい（記憶12枚）",
      master: "達人（完全記憶）"
    },
    sideLabel: "あなた",
    sideOptions: [
      { value: "first", text: "先手" },
      { value: "second", text: "後手" }
    ],
    defaultSide: "first",
    coordPattern: "[A-F][1-4]",
    rulesHtml: `
      <ul>
        <li>6×4（全24枚・12ペア、同じ数字が1ペア）を交互に2枚ずつめくります。</li>
        <li>同じ数字が揃うとペア獲得＋<strong>連続手番</strong>になります。外れると裏向きに戻り相手の手番になります。</li>
        <li>難易度に応じて AI が覚えていられる直近の公開カード枚数が変化します。</li>
      </ul>
    `,

    createInitialState(sideValue) {
      const playerIsFirst = sideValue !== "second";
      return {
        cards: createInitialCards(),
        playerIsFirst,
        currentTurn: playerIsFirst ? HUMAN : AI,
        revealedIndices: [],
        pendingFlipBack: false,
        seenHistory: [],
        humanPairs: 0,
        aiPairs: 0,
        moveCount: 0,
        gameOver: false,
        lastActionText: "同じ数字のペアを探してください（A〜Qの12ペア）。"
      };
    },

    cloneState(state) {
      return {
        ...state,
        cards: state.cards.map(c => ({ ...c })),
        revealedIndices: [...state.revealedIndices],
        seenHistory: state.seenHistory.map(s => ({ ...s }))
      };
    },

    isAiTurn(state) {
      return !state.gameOver && !state.pendingFlipBack && state.currentTurn === AI;
    },

    isGameOver(state) {
      return state.gameOver;
    },

    getScoreDisplay(state) {
      return {
        firstDotClass: "dot mancala-human",
        firstLabel: "あなた(組)",
        firstValue: state.humanPairs,
        secondDotClass: "dot mancala-ai",
        secondLabel: "AI(組)",
        secondValue: state.aiPairs
      };
    },

    getTurnText(state, { isAiThinking, hasError }) {
      if (state.gameOver) {
        if (state.humanPairs > state.aiPairs) return "終局: あなたの勝利！";
        if (state.aiPairs > state.humanPairs) return "終局: AIの勝利！";
        return "終局: 引き分け";
      }
      if (state.pendingFlipBack) return "カードを確認中...";
      if (isAiThinking) return "手番: AI が考慮中...";
      if (hasError) return "手番: AI - 待機中";
      return state.currentTurn === HUMAN ? "手番: あなた" : "手番: AI";
    },

    getStartHistoryText(state) {
      return `対局開始（神経衰弱）: 24枚（12ペア）・あなたは${state.playerIsFirst ? "先手" : "後手"}です。`;
    },

    getPlaceholderText(state) {
      return state.playerIsFirst
        ? "手番を待っています。カードをめくり終えるとAIの番になります。"
        : "AI（先手）の思考を待っています。";
    },

    getEndText(state) {
      const res = state.humanPairs > state.aiPairs
        ? "あなたの勝利！"
        : state.aiPairs > state.humanPairs
          ? "AIの勝利！"
          : "引き分けです。";
      return `【終局】 あなた:${state.humanPairs}組 / AI:${state.aiPairs}組（${res}）`;
    },

    renderBoard,

    getValidAiActions(state) {
      const moves = [];
      for (let i = 0; i < state.cards.length; i++) {
        if (!state.cards[i].matched && !state.revealedIndices.includes(i)) {
          moves.push({ index: i, label: coordLabel(i) });
        }
      }
      return moves;
    },

    getDifficultyConfig(diffKey) {
      return DIFFICULTIES[diffKey] || DIFFICULTIES.normal;
    },

    buildAiPrompt(state, validActions, diffConfig) {
      const mem = getRememberedMap(state, diffConfig.memoryLimit);
      const isSecondPick = state.revealedIndices.length === 1;
      const firstCard = isSecondPick ? state.cards[state.revealedIndices[0]] : null;
      const firstLabel = isSecondPick ? coordLabel(state.revealedIndices[0]) : "";

      const gridLines = ["   A    B    C    D    E    F"];
      for (let r = 0; r < ROWS; r++) {
        const cells = [];
        for (let c = 0; c < 6; c++) {
          const idx = r * 6 + c;
          const card = state.cards[idx];
          if (card.matched) cells.push("[済]");
          else if (state.revealedIndices.includes(idx)) cells.push(`[★${card.label}]`);
          else if (mem.has(idx)) cells.push(`[記${mem.get(idx)}]`);
          else cells.push("[？]");
        }
        gridLines.push(`${r + 1} ${cells.join(" ")}`);
      }

      // 記憶しているペアヒント（揃い候補を整理）
      const byRank = new Map();
      for (const [idx, lbl] of mem.entries()) {
        if (!byRank.has(lbl)) byRank.set(lbl, []);
        byRank.get(lbl).push(coordLabel(idx));
      }
      const knownPairs = [];
      for (const [lbl, coords] of byRank.entries()) {
        if (coords.length >= 2) knownPairs.push(`${lbl}: ${coords.join("と")}`);
      }

      let targetHint = "";
      if (isSecondPick) {
        const matchCoord = validActions.find(m => mem.get(m.index) === firstCard.label);
        targetHint = matchCoord
          ? `\n★記憶ヒント: 1枚目「${firstCard.label}」と同じ札を ${matchCoord.label} で記憶しています！`
          : `\n（1枚目「${firstCard.label}」の対になる位置は記憶にないため、未知の[？]を選ぶのが有効です）`;
      } else if (knownPairs.length > 0) {
        targetHint = `\n★記憶内の確定ペア: ${knownPairs.join(" / ")}`;
      }

      return `あなたは神経衰弱のAIです。思考の無限ループは禁止です。

【現在の盤面】(済=獲得済み / ★=今めくった札 / 記=記憶内の札 / ？=未知)
${gridLines.join("\n")}
・現在のスコア: AI ${state.aiPairs}組 / あなた ${state.humanPairs}組
・フェーズ: ${isSecondPick ? `2枚目を選択（1枚目は ${firstLabel}: ${firstCard.label}）` : "1枚目を選択"}${targetHint}

【選べる座標】
${validActions.map(m => m.label).join(", ")}

【方針】
${diffConfig.policy}

【厳守する思考手順】
[思考ステップ1] 盤面・記憶確認: （記憶にある位置や1枚目の数字を1文で整理）
[思考ステップ2] 候補比較: （方針に沿って選ぶ位置を1〜2文で検討）
[思考ステップ3] 位置決定: （選んだ座標と理由を1文で明記）
MOVE: 選んだ座標（例: MOVE: ${validActions[0].label}）

※必ず日本語のみで出力し、末尾に「MOVE: 座標（A1〜F4）」を1行出力してください。`;
    },

    applyUserAction(state, action) {
      return resolveFlip(state, action.index, HUMAN, "あなた", false);
    },

    applyAiAction(state, chosenMove, diffName, isFallback) {
      const actor = isFallback ? "AI (フォールバック)" : `AI (${diffName})`;
      return resolveFlip(state, chosenMove.index, AI, actor, true);
    },

    onAutoAdvance(state) {
      if (!state.pendingFlipBack) return null;
      const next = this.cloneState(state);
      next.revealedIndices = [];
      next.pendingFlipBack = false;
      next.currentTurn = state.currentTurn === HUMAN ? AI : HUMAN;
      next.lastActionText = `カードが裏に戻りました。${next.currentTurn === HUMAN ? "あなた" : "AI"}の手番です。`;
      return { state: next, historyEntries: [], autoAdvanceDelayMs: 0 };
    }
  });
})();
