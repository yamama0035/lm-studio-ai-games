(() => {
  "use strict";

  const C = globalThis.CardUtils;

  const HUMAN = 1;
  const AI = 2;

  // 通常強さ順序: 3(0) .. A(11), 2(12), JOKER(99)
  const NORMAL_ORDER = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 2];

  const DIFFICULTIES = {
    easy: { temperature: 0.85, maxTokens: 1200, showHints: false, policy: "深く考えず出せるカードから気まぐれに出す。" },
    normal: { temperature: 0.3, maxTokens: 1600, showHints: true, policy: "弱いカードから出しつつ、2やジョーカーなど強いカードを温存する。" },
    hard: { temperature: 0.1, maxTokens: 2048, showHints: true, policy: "複数枚出し・8切り・階段で場を制御し、2やジョーカーを切り札として残す。" },
    master: { temperature: 0.05, maxTokens: 2400, showHints: true, policy: "相手残り枚数と革命・8切り・スペ3返しを意識し、無駄なパスを避けつつ上がりルートを組み立てる。" }
  };

  function getNormalIndex(rank) {
    if (rank === 99) return 99;
    return NORMAL_ORDER.indexOf(rank);
  }

  function getStrength(rank, isRevolution) {
    if (rank === 99) return 99;
    const idx = getNormalIndex(rank);
    return isRevolution ? (12 - idx) : idx;
  }

  function sortHand(hand, isRevolution) {
    return [...hand].sort((a, b) => getStrength(a.rank, isRevolution) - getStrength(b.rank, isRevolution));
  }

  function formatPlayDesc(play) {
    if (play.isPass) return "パス";
    const cardsStr = C.formatCardsList(play.cards);
    const flags = [];
    if (play.type === "stair") flags.push("階段");
    else if (play.count >= 2) flags.push(`${play.count}枚組`);
    if (play.isSpade3Return) flags.push("★スペ3返し");
    if (play.hasReal8) flags.push("★8切り");
    if (play.causesRevolution) flags.push("★革命");
    return flags.length > 0 ? `${cardsStr} [${flags.join("・")}]` : cardsStr;
  }

  function generateLegalPlays(hand, tablePlay, isRevolution, { includeAllSubsets = false } = {}) {
    const sorted = sortHand(hand, isRevolution);
    const jokers = sorted.filter(c => c.isJoker);
    const nonJokers = sorted.filter(c => !c.isJoker);
    const plays = [];

    const addGroupSubsets = (arr, size, start, curr, cb) => {
      if (curr.length === size) {
        cb([...curr]);
        return;
      }
      for (let i = start; i < arr.length; i++) {
        curr.push(arr[i]);
        addGroupSubsets(arr, size, i + 1, curr, cb);
        curr.pop();
      }
    };

    // 1) 単体 (1枚)
    for (const card of sorted) {
      const s = getStrength(card.rank, isRevolution);
      const isSpade3Return = Boolean(tablePlay && tablePlay.isJokerSingle && !card.isJoker && card.suit === "S" && card.rank === 3);
      const valid = !tablePlay ||
        (tablePlay.type === "single" && s > tablePlay.strength) ||
        isSpade3Return;

      if (valid) {
        plays.push({
          type: "single",
          count: 1,
          cards: [card],
          strength: s,
          isJokerSingle: card.isJoker,
          isSpade3Return,
          hasReal8: !card.isJoker && card.rank === 8,
          causesRevolution: false
        });
      }
    }

    // 2) 同ランク複数枚 (2〜5枚、ジョーカー込み)
    const byRank = new Map();
    for (const c of nonJokers) {
      if (!byRank.has(c.rank)) byRank.set(c.rank, []);
      byRank.get(c.rank).push(c);
    }

    for (const [rank, group] of byRank.entries()) {
      const s = getStrength(rank, isRevolution);
      const maxTotal = group.length + jokers.length;
      for (let count = 2; count <= maxTotal; count++) {
        if (tablePlay && (tablePlay.type !== "group" || tablePlay.count !== count || s <= tablePlay.strength)) {
          continue;
        }
        for (let useJokers = 0; useJokers <= Math.min(jokers.length, count - 1); useJokers++) {
          const needNormal = count - useJokers;
          if (needNormal > group.length) continue;
          if (includeAllSubsets) {
            addGroupSubsets(group, needNormal, 0, [], (chosen) => {
              const cards = [...chosen, ...jokers.slice(0, useJokers)];
              plays.push({
                type: "group",
                count,
                cards,
                strength: s,
                isJokerSingle: false,
                isSpade3Return: false,
                hasReal8: rank === 8,
                causesRevolution: count >= 4
              });
            });
          } else {
            const cards = [...group.slice(0, needNormal), ...jokers.slice(0, useJokers)];
            plays.push({
              type: "group",
              count,
              cards,
              strength: s,
              isJokerSingle: false,
              isSpade3Return: false,
              hasReal8: rank === 8,
              causesRevolution: count >= 4
            });
          }
        }
      }
    }

    // 3) 階段 (同スート3枚以上、ジョーカー1枚まで穴埋め可)
    const bySuit = new Map();
    for (const c of nonJokers) {
      if (!bySuit.has(c.suit)) bySuit.set(c.suit, []);
      bySuit.get(c.suit).push(c);
    }
    for (const suitCards of bySuit.values()) {
      const posMap = new Map(suitCards.map(c => [getNormalIndex(c.rank), c]));
      for (let len = 3; len <= 13; len++) {
        if (tablePlay && (tablePlay.type !== "stair" || tablePlay.count !== len)) continue;
        for (let start = 0; start <= 13 - len; start++) {
          if (tablePlay) {
            if (isRevolution && start >= tablePlay.startPos) continue;
            if (!isRevolution && start <= tablePlay.startPos) continue;
          }
          const runCards = [];
          let missing = 0;
          for (let p = start; p < start + len; p++) {
            const found = posMap.get(p);
            if (found) runCards.push(found);
            else missing++;
          }
          if (missing === 0) {
            plays.push({
              type: "stair",
              count: len,
              startPos: start,
              cards: runCards,
              strength: isRevolution ? (12 - start) : (start + len - 1),
              isJokerSingle: false,
              isSpade3Return: false,
              hasReal8: runCards.some(c => c.rank === 8),
              causesRevolution: len >= 4
            });
          } else if (missing === 1 && jokers.length >= 1) {
            const cards = [...runCards, jokers[0]];
            plays.push({
              type: "stair",
              count: len,
              startPos: start,
              cards,
              strength: isRevolution ? (12 - start) : (start + len - 1),
              isJokerSingle: false,
              isSpade3Return: false,
              hasReal8: runCards.some(c => c.rank === 8),
              causesRevolution: len >= 4
            });
          }
        }
      }
    }

    if (tablePlay !== null) {
      plays.push({
        type: "pass",
        isPass: true,
        count: 0,
        cards: [],
        label: "PASS"
      });
    }

    return plays.map((p, idx) => ({
      ...p,
      label: p.isPass ? "PASS" : `M${idx + 1}`
    }));
  }

  function findPlayMatchingSelection(selectedIds, legalPlays) {
    if (selectedIds.length === 0) return null;
    const selKey = [...selectedIds].sort().join("|");
    for (const p of legalPlays) {
      if (p.isPass) continue;
      const key = p.cards.map(c => c.id).sort().join("|");
      if (key === selKey) return p;
    }
    return null;
  }

  function dealGame(playerIsFirst) {
    const deck = C.shuffle(C.createDeck({ includeJokers: 1 }));
    const humanHand = sortHand(deck.slice(0, 13), false);
    const aiHand = sortHand(deck.slice(13, 26), false);
    return {
      playerIsFirst,
      humanHand,
      aiHand,
      selectedCardIds: [],
      tablePlay: null,
      tableOwner: 0,
      isRevolution: false,
      currentTurn: playerIsFirst ? HUMAN : AI,
      moveCount: 0,
      winner: 0,
      gameOver: false,
      lastActionText: "親が最初のカードを出してください。"
    };
  }

  function renderBoard(stageEl, state, { canPlayerAct, onUserAction }) {
    const table = document.createElement("div");
    table.className = "card-table daifugo-table";

    const statusStrip = document.createElement("div");
    statusStrip.className = "table-info-bar";
    statusStrip.innerHTML = `<span>${state.isRevolution ? "🔥 <strong>革命中</strong> (強さ逆転)" : "通常強さ (3弱 ←→ 2強)"}</span><span>AI残り: <strong>${state.aiHand.length}</strong>枚</span>`;
    table.appendChild(statusStrip);

    // AI 手札 (裏向き)
    const aiRow = document.createElement("div");
    aiRow.className = "card-row compact-overlap";
    for (let i = 0; i < state.aiHand.length; i++) {
      aiRow.appendChild(C.createCardElement(null, { faceDown: true, mini: true }));
    }
    table.appendChild(aiRow);

    // 場札エリア
    const centerField = document.createElement("div");
    centerField.className = "daifugo-field";
    if (state.tablePlay) {
      const ownerTag = document.createElement("div");
      ownerTag.className = "field-label";
      ownerTag.textContent = `現在の場 (${state.tableOwner === HUMAN ? "あなた" : "AI"}が出したカード)`;
      const fieldCards = document.createElement("div");
      fieldCards.className = "card-row center";
      state.tablePlay.cards.forEach(c => fieldCards.appendChild(C.createCardElement(c, { compact: true })));
      centerField.append(ownerTag, fieldCards);
    } else {
      const emptyTag = document.createElement("div");
      emptyTag.className = "field-empty";
      emptyTag.textContent = "場は空です（好きな手を出せます）";
      centerField.appendChild(emptyTag);
    }
    const lastBanner = document.createElement("div");
    lastBanner.className = "field-last-note";
    lastBanner.textContent = state.lastActionText;
    centerField.appendChild(lastBanner);
    table.appendChild(centerField);

    // あなたの手札
    const humanZone = document.createElement("div");
    humanZone.className = "card-zone";
    const humanHeader = document.createElement("div");
    humanHeader.className = "zone-header";
    humanHeader.innerHTML = `<span>あなたの手札</span><span>残り <strong>${state.humanHand.length}</strong>枚</span>`;
    const humanRow = document.createElement("div");
    humanRow.className = "card-row hand-wrap";

    const legalPlaysAll = canPlayerAct
      ? generateLegalPlays(state.humanHand, state.tablePlay, state.isRevolution, { includeAllSubsets: true })
      : [];

    state.humanHand.forEach(card => {
      const isSelected = state.selectedCardIds.includes(card.id);
      humanRow.appendChild(C.createCardElement(card, {
        selected: isSelected,
        playable: canPlayerAct,
        compact: true,
        onClick: canPlayerAct ? () => onUserAction({ type: "TOGGLE_CARD", cardId: card.id }) : null
      }));
    });
    humanZone.append(humanHeader, humanRow);
    table.appendChild(humanZone);

    if (canPlayerAct) {
      const matchedPlay = findPlayMatchingSelection(state.selectedCardIds, legalPlaysAll);
      const actionBar = document.createElement("div");
      actionBar.className = "card-action-bar";

      const btnPlay = document.createElement("button");
      btnPlay.type = "button";
      btnPlay.className = "btn-primary";
      btnPlay.disabled = !matchedPlay;
      btnPlay.textContent = matchedPlay
        ? `出す: ${formatPlayDesc(matchedPlay)}`
        : state.selectedCardIds.length > 0
          ? "出せない組合せです"
          : "カードを選んでください";
      btnPlay.onclick = () => {
        if (matchedPlay) onUserAction({ type: "PLAY", play: matchedPlay });
      };
      actionBar.appendChild(btnPlay);

      if (state.tablePlay !== null) {
        const btnPass = document.createElement("button");
        btnPass.type = "button";
        btnPass.className = "btn-secondary";
        btnPass.textContent = "パス（場を流す）";
        btnPass.onclick = () => onUserAction({ type: "PASS" });
        actionBar.appendChild(btnPass);
      }

      if (state.selectedCardIds.length > 0) {
        const btnClear = document.createElement("button");
        btnClear.type = "button";
        btnClear.className = "btn-mini";
        btnClear.textContent = "選択解除";
        btnClear.onclick = () => onUserAction({ type: "CLEAR_SELECTION" });
        actionBar.appendChild(btnClear);
      }

      table.appendChild(actionBar);
    }

    stageEl.appendChild(table);
  }

  function extractAction(visibleContent, combinedReasoning, validActions) {
    const validSet = new Set(validActions.map(a => a.label.toUpperCase()));
    const re = /MOVE\s*[:：]\s*(?:\*\*|__|`|\[)*\s*(M\d+|PASS)\b/gi;
    const scan = (txt) => {
      if (!txt) return null;
      let m;
      let last = null;
      while ((m = re.exec(txt)) !== null) {
        const u = m[1].toUpperCase();
        if (validSet.has(u)) last = u;
      }
      return last;
    };
    const a = scan(visibleContent);
    if (a) return { label: a, sourceLabel: "" };
    const b = scan(combinedReasoning);
    if (b) return { label: b, sourceLabel: "推論内MOVE抽出" };

    const plainRe = /\b(M\d+|PASS)\b/gi;
    const scanPlain = (txt) => {
      if (!txt) return null;
      let m;
      let last = null;
      while ((m = plainRe.exec(txt)) !== null) {
        const u = m[1].toUpperCase();
        if (validSet.has(u)) last = u;
      }
      return last;
    };
    const c = scanPlain(visibleContent);
    if (c) return { label: c, sourceLabel: "本文末抽出" };
    const d = scanPlain(combinedReasoning);
    if (d) return { label: d, sourceLabel: "推論末抽出" };

    return { label: validActions[0].label, sourceLabel: "先頭手フォールバック" };
  }

  function executePlay(state, actor, actorName, play) {
    const next = {
      ...state,
      humanHand: [...state.humanHand],
      aiHand: [...state.aiHand],
      selectedCardIds: [],
      moveCount: state.moveCount + 1
    };

    if (play.isPass || play.type === "pass") {
      next.tablePlay = null;
      next.tableOwner = 0;
      next.currentTurn = actor === HUMAN ? AI : HUMAN;
      next.lastActionText = `${actorName}がパスしました。場が流れて${next.currentTurn === HUMAN ? "あなた" : "AI"}の親番です。`;
      return {
        state: next,
        historyEntries: [{
          type: "pass",
          text: `${next.moveCount}. ${actorName}: パス（場が流れました）`
        }],
        autoAdvanceDelayMs: 0
      };
    }

    const playIds = new Set(play.cards.map(c => c.id));
    if (actor === HUMAN) {
      next.humanHand = next.humanHand.filter(c => !playIds.has(c.id));
    } else {
      next.aiHand = next.aiHand.filter(c => !playIds.has(c.id));
    }

    const remaining = actor === HUMAN ? next.humanHand.length : next.aiHand.length;
    if (play.causesRevolution) {
      next.isRevolution = !next.isRevolution;
      next.humanHand = sortHand(next.humanHand, next.isRevolution);
      next.aiHand = sortHand(next.aiHand, next.isRevolution);
    }

    const desc = formatPlayDesc(play);
    const entries = [{
      type: "move",
      turnNumber: next.moveCount,
      actor: actorName,
      colorLabel: state.isRevolution ? "革命" : "通常",
      label: C.formatCardsList(play.cards),
      detailText: `${play.hasReal8 ? " [8切り!]" : ""}${play.isSpade3Return ? " [スペ3返し!]" : ""}${play.causesRevolution ? " [革命!]" : ""}`
    }];

    if (remaining === 0) {
      next.winner = actor;
      next.gameOver = true;
      next.tablePlay = play;
      next.tableOwner = actor;
      next.lastActionText = `${actorName}が ${desc} で上がりました！`;
      return { state: next, historyEntries: entries, autoAdvanceDelayMs: 0 };
    }

    if (play.hasReal8 || play.isSpade3Return) {
      next.tablePlay = null;
      next.tableOwner = 0;
      next.currentTurn = actor;
      const reason = play.isSpade3Return ? "スペ3返し" : "8切り";
      next.lastActionText = `${actorName}が ${C.formatCardsList(play.cards)} で${reason}！再び${actorName}の手番です。`;
      entries.push({ type: "extra", text: `${actorName}: ${reason}により場が流れて連続手番！` });
      return {
        state: next,
        historyEntries: entries,
        autoAdvanceDelayMs: actor === AI ? 650 : 0
      };
    }

    next.tablePlay = play;
    next.tableOwner = actor;
    next.currentTurn = actor === HUMAN ? AI : HUMAN;
    next.lastActionText = `${actorName}が ${desc} を出しました。`;
    return { state: next, historyEntries: entries, autoAdvanceDelayMs: 0 };
  }

  globalThis.GameRegistry.register({
    id: "daifugo",
    category: "card",
    name: "大富豪",
    title: "大富豪 (1対1・13枚ルール)",
    difficultyLabels: {
      easy: "かんたん（気まぐれ）",
      normal: "ふつう（基本出し）",
      hard: "つよい（切り札温存・8切り）",
      master: "達人（革命・手札構築）"
    },
    sideLabel: "あなた",
    sideOptions: [
      { value: "first", text: "先手（親番）" },
      { value: "second", text: "後手" }
    ],
    defaultSide: "first",
    extractAction,
    rulesHtml: `
      <ul>
        <li>各13枚の手札から先に0枚にした方が勝利です（1対1ルール・ジョーカー1枚入り）。</li>
        <li>強さ順：<code>3 ＜ 4 ＜ ... ＜ K ＜ A ＜ 2 ＜ ジョーカー</code>（<strong>革命</strong>時は3〜2が逆転）。</li>
        <li><strong>特殊ルール</strong>：<strong>8切り</strong>（8を含む手で場が流れ再手番）、<strong>革命</strong>（4枚同位または4枚以上階段で強さ逆転）、<strong>スペ3返し</strong>（ジョーカー単体に♠3で返して流す）。</li>
      </ul>
    `,

    createInitialState(sideValue) {
      return dealGame(sideValue !== "second");
    },

    cloneState(state) {
      return {
        ...state,
        humanHand: state.humanHand.map(c => ({ ...c })),
        aiHand: state.aiHand.map(c => ({ ...c })),
        selectedCardIds: [...state.selectedCardIds],
        tablePlay: state.tablePlay ? { ...state.tablePlay, cards: state.tablePlay.cards.map(c => ({ ...c })) } : null
      };
    },

    isAiTurn(state) {
      return !state.gameOver && state.currentTurn === AI;
    },

    isGameOver(state) {
      return state.gameOver;
    },

    getScoreDisplay(state) {
      return {
        firstDotClass: "dot mancala-human",
        firstLabel: "あなた(残札)",
        firstValue: state.humanHand.length,
        secondDotClass: "dot mancala-ai",
        secondLabel: "AI(残札)",
        secondValue: state.aiHand.length
      };
    },

    getTurnText(state, { isAiThinking, hasError }) {
      if (state.gameOver) return `終局: ${state.winner === HUMAN ? "あなたの勝利！" : "AIの勝利！"}`;
      if (isAiThinking) return "手番: AI が考慮中...";
      if (hasError) return "手番: AI - 待機中";
      return state.currentTurn === HUMAN ? "手番: あなた" : "手番: AI";
    },

    getStartHistoryText(state) {
      return `対局開始（大富豪）: 各13枚配布・あなたは${state.playerIsFirst ? "先手（親番）" : "後手"}です。`;
    },

    getPlaceholderText(state) {
      return state.playerIsFirst
        ? "手番を待っています。手札からカードを選んで出すとAIが思考します。"
        : "AI（親番）の初手を待っています。";
    },

    getEndText(state) {
      return `【終局】 ${state.moveCount}手 ${state.winner === HUMAN ? "あなたの勝利！" : "AIの勝利！"}`;
    },

    renderBoard,

    getValidAiActions(state) {
      return generateLegalPlays(state.aiHand, state.tablePlay, state.isRevolution, { includeAllSubsets: false });
    },

    getDifficultyConfig(diffKey) {
      return DIFFICULTIES[diffKey] || DIFFICULTIES.normal;
    },

    buildAiPrompt(state, validActions, diffConfig) {
      const handStr = C.formatCardsList(state.aiHand);
      const tableStr = state.tablePlay ? formatPlayDesc(state.tablePlay) : "なし（親番・何でも出せます）";
      const listStr = validActions.slice(0, 30).map(a =>
        `・${a.label}: ${formatPlayDesc(a)}`
      ).join("\n");

      return `あなたは1対1大富豪のAIプレイヤーです。思考の無限ループは禁止です。

【現在の状態】
・あなた(AI)の手札 (${state.aiHand.length}枚): ${handStr}
・相手の残り枚数: ${state.humanHand.length}枚（手札は非公開）
・場のカード: ${tableStr}
・革命状態: ${state.isRevolution ? "革命中（3強・2弱）" : "通常（3弱・2強）"}

【出せる合法手】
${listStr}

【方針】
${diffConfig.policy}

【厳守する思考手順】
[思考ステップ1] 状況確認: （場の強さと自分の手札のバランスを1文で整理）
[思考ステップ2] 手の評価: （温存や8切り・上がりを見据えて1〜2文で比較）
[思考ステップ3] 行動決定: （選んだコードと理由を1文で明記）
MOVE: 選んだ手コード（例: MOVE: ${validActions[0].label}）

※必ず日本語のみで出力し、末尾に「MOVE: コード（M1等またはPASS）」を1行出力してください。`;
    },

    applyUserAction(state, action) {
      if (action.type === "TOGGLE_CARD") {
        const next = this.cloneState(state);
        const idx = next.selectedCardIds.indexOf(action.cardId);
        if (idx >= 0) next.selectedCardIds.splice(idx, 1);
        else next.selectedCardIds.push(action.cardId);
        return { state: next, historyEntries: [], shouldPushUndo: false, autoAdvanceDelayMs: 0 };
      }

      if (action.type === "CLEAR_SELECTION") {
        const next = this.cloneState(state);
        next.selectedCardIds = [];
        return { state: next, historyEntries: [], shouldPushUndo: false, autoAdvanceDelayMs: 0 };
      }

      if (action.type === "PASS") {
        const res = executePlay(state, HUMAN, "あなた", { isPass: true, type: "pass", cards: [] });
        res.shouldPushUndo = true;
        return res;
      }

      const res = executePlay(state, HUMAN, "あなた", action.play);
      res.shouldPushUndo = true;
      return res;
    },

    applyAiAction(state, chosenMove, diffName, isFallback) {
      const actor = isFallback ? "AI (フォールバック)" : `AI (${diffName})`;
      return executePlay(state, AI, actor, chosenMove);
    }
  });
})();
