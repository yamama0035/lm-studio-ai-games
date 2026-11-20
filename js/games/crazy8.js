(() => {
  "use strict";

  const C = globalThis.CardUtils;

  const HUMAN = 1;
  const AI = 2;

  const DIFFICULTIES = {
    easy: { temperature: 0.85, maxTokens: 1200, policy: "直感で出せるカードを出す。" },
    normal: { temperature: 0.3, maxTokens: 1600, policy: "出せる枚数を減らしつつ、手札にあるスートの多いマークに誘導する。" },
    hard: { temperature: 0.1, maxTokens: 2048, policy: "8（スート指定）・2（2枚引かせる）・J（スキップ）を効果的に使い、相手より先に手札を空にする。" },
    master: { temperature: 0.05, maxTokens: 2400, policy: "相手の残り枚数と自分の最多スートを計算し、特殊カードと8の温存・切りどころを精密に選ぶ。" }
  };

  function isPlayable(card, topCard, activeSuit) {
    if (!card) return false;
    return card.rank === 8 || card.suit === activeSuit || card.rank === topCard.rank;
  }

  function dealGame(playerIsFirst) {
    let deck = C.shuffle(C.createDeck());
    const humanHand = deck.splice(0, 7);
    const aiHand = deck.splice(0, 7);

    // 初期場札は特殊効果のないカードにする
    let topIdx = deck.findIndex(c => c.rank !== 8 && c.rank !== 2 && c.rank !== 11);
    if (topIdx < 0) topIdx = 0;
    const [topCard] = deck.splice(topIdx, 1);

    return {
      playerIsFirst,
      deck,
      discardPile: [topCard],
      topCard,
      activeSuit: topCard.suit,
      humanHand,
      aiHand,
      pendingSuitForEightCardId: null,
      hasDrawnThisTurn: false,
      currentTurn: playerIsFirst ? HUMAN : AI,
      moveCount: 0,
      winner: 0,
      gameOver: false,
      lastActionText: "対局開始：場札と同じマークか同じ数字（または8）を出してください。"
    };
  }

  function drawCardsFromDeck(state, count) {
    const drawn = [];
    for (let i = 0; i < count; i++) {
      if (state.deck.length === 0) {
        if (state.discardPile.length <= 1) break;
        const top = state.discardPile[state.discardPile.length - 1];
        const recycled = C.shuffle(state.discardPile.slice(0, -1));
        state.discardPile = [top];
        state.deck = recycled;
      }
      if (state.deck.length > 0) {
        drawn.push(state.deck.pop());
      }
    }
    return drawn;
  }

  function getAiMoves(state) {
    const moves = [];
    state.aiHand.forEach(card => {
      if (!isPlayable(card, state.topCard, state.activeSuit)) return;
      if (card.rank === 8) {
        for (const s of C.SUITS) {
          moves.push({
            kind: "play",
            card,
            declaredSuit: s.id,
            label: `${card.id}_${s.id}`,
            desc: `${C.formatCardText(card)}を出してスートを「${s.symbol}」に変更`
          });
        }
      } else {
        let note = "";
        if (card.rank === 2) note = " (相手+2枚＆スキップ)";
        else if (card.rank === 11) note = " (スキップ・再手番)";
        moves.push({
          kind: "play",
          card,
          declaredSuit: card.suit,
          label: card.id,
          desc: `${C.formatCardText(card)}${note}`
        });
      }
    });

    if (!state.hasDrawnThisTurn) {
      moves.push({
        kind: "draw",
        label: "DRAW",
        desc: "山札から1枚引く"
      });
    } else {
      moves.push({
        kind: "pass",
        label: "PASS",
        desc: "引いた上でパスして相手へ手番を渡す"
      });
    }
    return moves;
  }

  function applyCardPlay(state, actor, actorName, card, declaredSuit) {
    const next = {
      ...state,
      deck: state.deck.map(c => ({ ...c })),
      discardPile: state.discardPile.map(c => ({ ...c })),
      humanHand: state.humanHand.map(c => ({ ...c })),
      aiHand: state.aiHand.map(c => ({ ...c })),
      pendingSuitForEightCardId: null,
      hasDrawnThisTurn: false,
      moveCount: state.moveCount + 1
    };

    if (actor === HUMAN) {
      next.humanHand = next.humanHand.filter(c => c.id !== card.id);
    } else {
      next.aiHand = next.aiHand.filter(c => c.id !== card.id);
    }

    next.discardPile.push(card);
    next.topCard = card;
    next.activeSuit = card.rank === 8 ? declaredSuit : card.suit;

    const remaining = actor === HUMAN ? next.humanHand.length : next.aiHand.length;
    const suitSym = C.SUIT_MAP[next.activeSuit].symbol;
    const entries = [{
      type: "move",
      turnNumber: next.moveCount,
      actor: actorName,
      colorLabel: `場:${suitSym}`,
      label: C.formatCardText(card),
      detailText: card.rank === 8 ? ` [8ワイルド→${suitSym}指定]` : card.rank === 2 ? " [相手+2枚!]" : card.rank === 11 ? " [スキップ!]" : ""
    }];

    if (remaining === 0) {
      next.winner = actor;
      next.gameOver = true;
      next.lastActionText = `${actorName}が ${C.formatCardText(card)} を出して手札0枚・勝利！`;
      return { state: next, historyEntries: entries, autoAdvanceDelayMs: 0 };
    }

    if (card.rank === 2) {
      const drawn = drawCardsFromDeck(next, 2);
      if (actor === HUMAN) next.aiHand.push(...drawn);
      else next.humanHand.push(...drawn);
      next.currentTurn = actor;
      next.lastActionText = `${actorName}が ${C.formatCardText(card)}！相手が2枚引き、再び${actorName}の手番です。`;
      entries.push({ type: "extra", text: `${actorName}: 「2」の効果で相手+2枚＆連続手番！` });
      return { state: next, historyEntries: entries, autoAdvanceDelayMs: actor === AI ? 650 : 0 };
    }

    if (card.rank === 11) {
      next.currentTurn = actor;
      next.lastActionText = `${actorName}が ${C.formatCardText(card)} (スキップ)！再び${actorName}の手番です。`;
      entries.push({ type: "extra", text: `${actorName}: 「J」の効果で相手スキップ＆連続手番！` });
      return { state: next, historyEntries: entries, autoAdvanceDelayMs: actor === AI ? 650 : 0 };
    }

    next.currentTurn = actor === HUMAN ? AI : HUMAN;
    next.lastActionText = card.rank === 8
      ? `${actorName}が ${C.formatCardText(card)} を出し、マークを「${suitSym}」に指定しました。`
      : `${actorName}が ${C.formatCardText(card)} を出しました。`;
    return { state: next, historyEntries: entries, autoAdvanceDelayMs: 0 };
  }

  function renderBoard(stageEl, state, { canPlayerAct, onUserAction }) {
    const table = document.createElement("div");
    table.className = "card-table crazy8-table";

    const suitInfo = C.SUIT_MAP[state.activeSuit];
    const infoBar = document.createElement("div");
    infoBar.className = "table-info-bar";
    infoBar.innerHTML = `<span>山札: <strong>${state.deck.length}</strong>枚</span><span>指定スート: <strong class="suit-pill ${suitInfo.color}">${suitInfo.symbol} ${suitInfo.name}</strong></span>`;
    table.appendChild(infoBar);

    const aiRow = document.createElement("div");
    aiRow.className = "card-row compact-overlap";
    for (let i = 0; i < state.aiHand.length; i++) {
      aiRow.appendChild(C.createCardElement(null, { faceDown: true, mini: true }));
    }
    table.appendChild(aiRow);

    const centerArea = document.createElement("div");
    centerArea.className = "crazy8-center";
    const deckCard = C.createCardElement(null, {
      faceDown: true,
      playable: canPlayerAct && !state.hasDrawnThisTurn,
      badge: `${state.deck.length}`,
      onClick: canPlayerAct && !state.hasDrawnThisTurn ? () => onUserAction({ type: "DRAW" }) : null
    });
    const topCardEl = C.createCardElement(state.topCard);
    centerArea.append(deckCard, topCardEl);
    table.appendChild(centerArea);

    const actionNote = document.createElement("div");
    actionNote.className = "field-last-note";
    actionNote.textContent = state.lastActionText;
    table.appendChild(actionNote);

    if (state.pendingSuitForEightCardId && canPlayerAct) {
      const suitPicker = document.createElement("div");
      suitPicker.className = "suit-picker-bar";
      const label = document.createElement("span");
      label.textContent = "「8」を出します — 次のマークを選択：";
      suitPicker.appendChild(label);
      for (const s of C.SUITS) {
        const sBtn = document.createElement("button");
        sBtn.type = "button";
        sBtn.className = `btn-suit suit-${s.color}`;
        sBtn.textContent = `${s.symbol} ${s.name}`;
        sBtn.onclick = () => onUserAction({ type: "CONFIRM_EIGHT_SUIT", suit: s.id });
        suitPicker.appendChild(sBtn);
      }
      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "btn-mini";
      cancelBtn.textContent = "キャンセル";
      cancelBtn.onclick = () => onUserAction({ type: "CANCEL_EIGHT" });
      suitPicker.appendChild(cancelBtn);
      table.appendChild(suitPicker);
    }

    const humanZone = document.createElement("div");
    humanZone.className = "card-zone";
    const humanHeader = document.createElement("div");
    humanHeader.className = "zone-header";
    humanHeader.innerHTML = `<span>あなたの手札</span><span>残り <strong>${state.humanHand.length}</strong>枚</span>`;
    const humanRow = document.createElement("div");
    humanRow.className = "card-row hand-wrap";

    state.humanHand.forEach(card => {
      const ok = canPlayerAct && isPlayable(card, state.topCard, state.activeSuit);
      const isPending = state.pendingSuitForEightCardId === card.id;
      humanRow.appendChild(C.createCardElement(card, {
        playable: ok,
        selected: isPending,
        compact: true,
        onClick: ok ? () => onUserAction({ type: "PLAY_CARD", card }) : null
      }));
    });
    humanZone.append(humanHeader, humanRow);
    table.appendChild(humanZone);

    if (canPlayerAct) {
      const bar = document.createElement("div");
      bar.className = "card-action-bar";
      if (!state.hasDrawnThisTurn) {
        const btnDraw = document.createElement("button");
        btnDraw.type = "button";
        btnDraw.className = "btn-secondary";
        btnDraw.textContent = "山札から1枚引く";
        btnDraw.onclick = () => onUserAction({ type: "DRAW" });
        bar.appendChild(btnDraw);
      } else {
        const btnPass = document.createElement("button");
        btnPass.type = "button";
        btnPass.className = "btn-secondary";
        btnPass.textContent = "パス（手番を渡す）";
        btnPass.onclick = () => onUserAction({ type: "PASS" });
        bar.appendChild(btnPass);
      }
      table.appendChild(bar);
    }

    stageEl.appendChild(table);
  }

  function extractAction(visibleContent, combinedReasoning, validActions) {
    const validSet = new Set(validActions.map(a => a.label.toUpperCase()));
    const re = /MOVE\s*[:：]\s*(?:\*\*|__|`|\[)*\s*([SHDC](?:10|[2-9JQKA])(?:_[SHDC])?|DRAW|PASS)\b/gi;
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

    const plainRe = /\b([SHDC](?:10|[2-9JQKA])(?:_[SHDC])?|DRAW|PASS)\b/gi;
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

  globalThis.GameRegistry.register({
    id: "crazy8",
    category: "card",
    name: "クレイジー8",
    title: "クレイジーエイト (UNO風トランプ)",
    difficultyLabels: {
      easy: "かんたん（気まぐれ）",
      normal: "ふつう（手札減らし）",
      hard: "つよい（特殊札・スート管理）",
      master: "達人（相手枚数・完全戦略）"
    },
    sideLabel: "あなた",
    sideOptions: [
      { value: "first", text: "先手" },
      { value: "second", text: "後手" }
    ],
    defaultSide: "first",
    extractAction,
    rulesHtml: `
      <ul>
        <li>場札と<strong>同じマーク（スート）</strong>または<strong>同じ数字</strong>を出して、先に手札を0枚にした方が勝利です。</li>
        <li><strong>8（ワイルド）</strong>：いつでも出せて、次のマークを自由に指定できます。</li>
        <li><strong>2（ドロー2）</strong>：相手に2枚引かせて連続で自分の手番になります。<strong>J（スキップ）</strong>：相手を飛ばして連続手番になります。</li>
        <li>出せる札がないときは山札から1枚引き、それでも出せなければパスします。</li>
      </ul>
    `,

    createInitialState(sideValue) {
      return dealGame(sideValue !== "second");
    },

    cloneState(state) {
      return {
        ...state,
        deck: state.deck.map(c => ({ ...c })),
        discardPile: state.discardPile.map(c => ({ ...c })),
        topCard: { ...state.topCard },
        humanHand: state.humanHand.map(c => ({ ...c })),
        aiHand: state.aiHand.map(c => ({ ...c }))
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
      return `対局開始（クレイジーエイト）: 各7枚配布・初期場札 ${C.formatCardText(state.topCard)}`;
    },

    getPlaceholderText(state) {
      return state.playerIsFirst
        ? "手番を待っています。カードを出すか山札を引くとAIが思考します。"
        : "AI（先手）の初手を待っています。";
    },

    getEndText(state) {
      return `【終局】 ${state.moveCount}手 ${state.winner === HUMAN ? "あなたの勝利！" : "AIの勝利！"}`;
    },

    renderBoard,

    getValidAiActions(state) {
      return getAiMoves(state);
    },

    getDifficultyConfig(diffKey) {
      return DIFFICULTIES[diffKey] || DIFFICULTIES.normal;
    },

    buildAiPrompt(state, validActions, diffConfig) {
      const handStr = C.formatCardsList(state.aiHand);
      const suitInfo = C.SUIT_MAP[state.activeSuit];
      const movesStr = validActions.map(m => `・${m.label}: ${m.desc}`).join("\n");

      return `あなたはクレイジーエイト（UNO風トランプ）のAIです。思考の無限ループは禁止です。

【現在の状況】
・現在の場札: ${C.formatCardText(state.topCard)} / 有効マーク: ${suitInfo.symbol} (${suitInfo.name})
・あなた(AI)の手札 (${state.aiHand.length}枚): ${handStr}
・相手の残り枚数: ${state.humanHand.length}枚（手札非公開）
・山札残り: ${state.deck.length}枚

【選べる行動】
${movesStr}

【方針】
${diffConfig.policy}

【厳守する思考手順】
[思考ステップ1] 状況確認: （場のマーク・手札・相手枚数を1文で整理）
[思考ステップ2] 戦略検討: （出せる札や8のマーク指定を比較し1〜2文で検討）
[思考ステップ3] 行動決定: （選んだコードと理由を1文で明記）
MOVE: 選んだコード（例: MOVE: ${validActions[0].label}）

※必ず日本語のみで出力し、末尾に「MOVE: コード」を1行出力してください。`;
    },

    applyUserAction(state, action) {
      if (action.type === "PLAY_CARD") {
        if (action.card.rank === 8) {
          const next = this.cloneState(state);
          next.pendingSuitForEightCardId = action.card.id;
          return { state: next, historyEntries: [], shouldPushUndo: false, autoAdvanceDelayMs: 0 };
        }
        const res = applyCardPlay(state, HUMAN, "あなた", action.card, action.card.suit);
        res.shouldPushUndo = true;
        return res;
      }

      if (action.type === "CONFIRM_EIGHT_SUIT") {
        const card = state.humanHand.find(c => c.id === state.pendingSuitForEightCardId);
        if (!card) return { state: this.cloneState(state), historyEntries: [], shouldPushUndo: false, autoAdvanceDelayMs: 0 };
        const res = applyCardPlay(state, HUMAN, "あなた", card, action.suit);
        res.shouldPushUndo = true;
        return res;
      }

      if (action.type === "CANCEL_EIGHT") {
        const next = this.cloneState(state);
        next.pendingSuitForEightCardId = null;
        return { state: next, historyEntries: [], shouldPushUndo: false, autoAdvanceDelayMs: 0 };
      }

      if (action.type === "DRAW") {
        const next = this.cloneState(state);
        next.pendingSuitForEightCardId = null;
        const [drawn] = drawCardsFromDeck(next, 1);
        if (!drawn) {
          next.moveCount++;
          next.currentTurn = AI;
          next.hasDrawnThisTurn = false;
          next.lastActionText = "山札がなく引けないためパスしました。";
          return {
            state: next,
            historyEntries: [{ type: "pass", text: `${next.moveCount}. あなた: パス（山札なし）` }],
            shouldPushUndo: true,
            autoAdvanceDelayMs: 0
          };
        }
        next.humanHand.push(drawn);
        next.hasDrawnThisTurn = true;
        const canPlayAny = next.humanHand.some(c => isPlayable(c, next.topCard, next.activeSuit));
        if (!canPlayAny) {
          next.moveCount++;
          next.currentTurn = AI;
          next.hasDrawnThisTurn = false;
          next.lastActionText = `あなたが1枚引きましたが、出せる札がなくパスしました。`;
          return {
            state: next,
            historyEntries: [{ type: "pass", text: `${next.moveCount}. あなた: 1枚引いてパス` }],
            shouldPushUndo: true,
            autoAdvanceDelayMs: 0
          };
        }
        next.lastActionText = `1枚引きました（${C.formatCardText(drawn)}）。出せるカードを出すかパスしてください。`;
        return {
          state: next,
          historyEntries: [{ type: "info", text: `あなた: 山札から1枚引きました (${C.formatCardText(drawn)})` }],
          shouldPushUndo: true,
          autoAdvanceDelayMs: 0
        };
      }

      // PASS after drawing
      const next = this.cloneState(state);
      next.moveCount++;
      next.hasDrawnThisTurn = false;
      next.currentTurn = AI;
      next.lastActionText = "あなたがパスしました。";
      return {
        state: next,
        historyEntries: [{ type: "pass", text: `${next.moveCount}. あなた: パス` }],
        shouldPushUndo: true,
        autoAdvanceDelayMs: 0
      };
    },

    applyAiAction(state, chosenMove, diffName, isFallback) {
      const actor = isFallback ? "AI (フォールバック)" : `AI (${diffName})`;
      if (chosenMove.kind === "play") {
        return applyCardPlay(state, AI, actor, chosenMove.card, chosenMove.declaredSuit);
      }

      const next = this.cloneState(state);
      if (chosenMove.kind === "draw") {
        const [drawn] = drawCardsFromDeck(next, 1);
        if (drawn) {
          next.aiHand.push(drawn);
          next.hasDrawnThisTurn = true;
          const hasPlayable = next.aiHand.some(c => isPlayable(c, next.topCard, next.activeSuit));
          if (hasPlayable) {
            next.lastActionText = "AIが山札から1枚引きました（続けて判定）。";
            return {
              state: next,
              historyEntries: [{ type: "info", text: `${actor}: 山札から1枚引きました` }],
              autoAdvanceDelayMs: 650
            };
          }
        }
        next.moveCount++;
        next.hasDrawnThisTurn = false;
        next.currentTurn = HUMAN;
        next.lastActionText = "AIが1枚引いてパスしました。";
        return {
          state: next,
          historyEntries: [{ type: "pass", text: `${next.moveCount}. ${actor}: 1枚引いてパス` }],
          autoAdvanceDelayMs: 0
        };
      }

      // PASS
      next.moveCount++;
      next.hasDrawnThisTurn = false;
      next.currentTurn = HUMAN;
      next.lastActionText = "AIがパスしました。";
      return {
        state: next,
        historyEntries: [{ type: "pass", text: `${next.moveCount}. ${actor}: パス` }],
        autoAdvanceDelayMs: 0
      };
    }
  });
})();
