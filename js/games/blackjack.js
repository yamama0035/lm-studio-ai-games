(() => {
  "use strict";

  const C = globalThis.CardUtils;

  const INITIAL_CHIPS = 100;
  const BET_OPTIONS = [10, 20, 50];

  const DIFFICULTIES = {
    easy: { temperature: 0.85, maxTokens: 1000, policy: "直感で気まぐれにヒットまたはスタンドを選ぶ。" },
    normal: { temperature: 0.3, maxTokens: 1400, policy: "基本的なセオリー（17前後を基準）とバースト回避を意識して判断する。" },
    hard: { temperature: 0.1, maxTokens: 1800, policy: "自分の合計点・ソフトハンドと相手の公開カードから勝率を考えて判断する。" },
    master: { temperature: 0.05, maxTokens: 2200, policy: "相手の公開カードと引いた枚数（スタンド状況）、バースト確率を精密に読み切って最適な判断をする。" }
  };

  function evaluateHand(hand) {
    let total = 0;
    let aces = 0;
    for (const card of hand) {
      if (card.rank === 14) {
        total += 11;
        aces++;
      } else if (card.rank >= 10) {
        total += 10;
      } else {
        total += card.rank;
      }
    }
    while (total > 21 && aces > 0) {
      total -= 10;
      aces--;
    }
    return {
      total,
      isSoft: aces > 0,
      isBust: total > 21,
      isNatural: hand.length === 2 && total === 21
    };
  }

  function dealNewRound(humanChips, aiChips, desiredBet, roundNum) {
    const deck = C.shuffle(C.createDeck());
    const bet = Math.max(1, Math.min(desiredBet, humanChips, aiChips));
    const nextHumanChips = humanChips - bet;
    const nextAiChips = aiChips - bet;
    const pot = bet * 2;

    const humanHand = [deck.pop(), deck.pop()];
    const aiHand = [deck.pop(), deck.pop()];

    const hEval = evaluateHand(humanHand);
    const aEval = evaluateHand(aiHand);

    let phase = "human_turn";
    let roundResult = "";
    let finalHumanChips = nextHumanChips;
    let finalAiChips = nextAiChips;
    let matchOver = false;

    if (hEval.isNatural || aEval.isNatural) {
      phase = "round_over";
      if (hEval.isNatural && aEval.isNatural) {
        finalHumanChips += bet;
        finalAiChips += bet;
        roundResult = "双方ナチュラル21！引き分け（チップ返却）。";
      } else if (hEval.isNatural) {
        finalHumanChips += pot;
        roundResult = `あなたの手札がナチュラル21！勝利（+${bet}チップ）`;
      } else {
        finalAiChips += pot;
        roundResult = `AIがナチュラル21！AIの勝利（-${bet}チップ）`;
      }
      if (finalHumanChips <= 0 || finalAiChips <= 0) {
        matchOver = true;
      }
    }

    return {
      deck,
      roundNum,
      desiredBet,
      currentBet: bet,
      pot,
      humanChips: finalHumanChips,
      aiChips: finalAiChips,
      humanHand,
      aiHand,
      humanStood: phase === "round_over",
      phase,
      roundResult,
      matchOver
    };
  }

  function settleShowdown(state) {
    const hEval = evaluateHand(state.humanHand);
    const aEval = evaluateHand(state.aiHand);
    let humanChips = state.humanChips;
    let aiChips = state.aiChips;
    let result = "";

    if (hEval.isBust) {
      aiChips += state.pot;
      result = `あなたがバースト（${hEval.total}）！AIの勝利（ポット${state.pot}獲得）`;
    } else if (aEval.isBust) {
      humanChips += state.pot;
      result = `AIがバースト（${aEval.total}）！あなたの勝利（ポット${state.pot}獲得）`;
    } else if (hEval.total > aEval.total) {
      humanChips += state.pot;
      result = `あなたの勝利！ (${hEval.total} vs ${aEval.total} / ポット${state.pot}獲得)`;
    } else if (aEval.total > hEval.total) {
      aiChips += state.pot;
      result = `AIの勝利！ (${aEval.total} vs ${hEval.total} / ポット${state.pot}獲得)`;
    } else {
      const half = Math.floor(state.pot / 2);
      humanChips += half;
      aiChips += state.pot - half;
      result = `引き分け (${hEval.total} vs ${aEval.total} / チップ返却)`;
    }

    const matchOver = humanChips <= 0 || aiChips <= 0;
    return {
      ...state,
      humanChips,
      aiChips,
      phase: "round_over",
      roundResult: result,
      matchOver
    };
  }

  function renderBoard(stageEl, state, { canPlayerAct, onUserAction }) {
    const table = document.createElement("div");
    table.className = "card-table blackjack-table";

    const infoBar = document.createElement("div");
    infoBar.className = "table-info-bar";
    infoBar.innerHTML = `<span>Round ${state.roundNum}</span><span>ポット: <strong>${state.pot}</strong> チップ (賭け金: ${state.currentBet})</span>`;
    table.appendChild(infoBar);

    // AI エリア
    const aiZone = document.createElement("div");
    aiZone.className = "card-zone";
    const revealAi = state.phase === "round_over";
    const aiEval = evaluateHand(state.aiHand);
    const aiHeader = document.createElement("div");
    aiHeader.className = "zone-header";
    aiHeader.innerHTML = `<span>AIの手札</span><span>${revealAi ? `合計: <strong>${aiEval.total}</strong>${aiEval.isBust ? " (バースト)" : ""}` : `公開札: ${C.formatCardText(state.aiHand[0])} + 伏せ札${state.aiHand.length - 1}枚`}</span>`;
    const aiCardsRow = document.createElement("div");
    aiCardsRow.className = "card-row";
    state.aiHand.forEach((card, idx) => {
      const faceDown = !revealAi && idx > 0;
      aiCardsRow.appendChild(C.createCardElement(card, { faceDown }));
    });
    aiZone.append(aiHeader, aiCardsRow);

    // あなたエリア
    const humanZone = document.createElement("div");
    humanZone.className = "card-zone";
    const hEval = evaluateHand(state.humanHand);
    const humanHeader = document.createElement("div");
    humanHeader.className = "zone-header";
    humanHeader.innerHTML = `<span>あなたの手札</span><span>合計: <strong>${hEval.total}</strong>${hEval.isSoft ? " (ソフト)" : ""}${hEval.isBust ? " (バースト!)" : ""}</span>`;
    const humanCardsRow = document.createElement("div");
    humanCardsRow.className = "card-row";
    state.humanHand.forEach(card => {
      humanCardsRow.appendChild(C.createCardElement(card));
    });
    humanZone.append(humanHeader, humanCardsRow);

    table.append(aiZone, humanZone);

    // アクションエリア
    const actionArea = document.createElement("div");
    actionArea.className = "card-action-bar";

    if (state.phase === "human_turn" && canPlayerAct) {
      const btnHit = document.createElement("button");
      btnHit.type = "button";
      btnHit.className = "btn-primary";
      btnHit.textContent = "ヒット（1枚引く）";
      btnHit.onclick = () => onUserAction({ type: "HIT" });

      const btnStand = document.createElement("button");
      btnStand.type = "button";
      btnStand.className = "btn-secondary";
      btnStand.textContent = "スタンド（勝負）";
      btnStand.onclick = () => onUserAction({ type: "STAND" });

      actionArea.append(btnHit, btnStand);

      const canDouble = state.humanHand.length === 2 &&
        state.humanChips >= state.currentBet &&
        state.aiChips >= state.currentBet;
      if (canDouble) {
        const btnDouble = document.createElement("button");
        btnDouble.type = "button";
        btnDouble.className = "btn-accent";
        btnDouble.textContent = `ダブル (+${state.currentBet})`;
        btnDouble.onclick = () => onUserAction({ type: "DOUBLE" });
        actionArea.appendChild(btnDouble);
      }
    } else if (state.phase === "round_over") {
      const resBanner = document.createElement("div");
      resBanner.className = "round-result-banner";
      resBanner.textContent = state.roundResult;
      table.appendChild(resBanner);

      if (!state.matchOver && canPlayerAct) {
        for (const b of BET_OPTIONS) {
          if (state.humanChips < b && state.humanChips > 0 && b !== BET_OPTIONS[0]) continue;
          const nextBtn = document.createElement("button");
          nextBtn.type = "button";
          nextBtn.className = b === state.desiredBet ? "btn-primary" : "btn-secondary";
          const actual = Math.min(b, state.humanChips, state.aiChips);
          nextBtn.textContent = `次へ (ベット${actual})`;
          nextBtn.onclick = () => onUserAction({ type: "NEXT_ROUND", bet: b });
          actionArea.appendChild(nextBtn);
        }
        const finishBtn = document.createElement("button");
        finishBtn.type = "button";
        finishBtn.className = "btn-mini";
        finishBtn.textContent = "このチップで対局終了";
        finishBtn.onclick = () => onUserAction({ type: "FINISH_MATCH" });
        actionArea.appendChild(finishBtn);
      }
    }

    if (actionArea.children.length > 0) {
      table.appendChild(actionArea);
    }

    stageEl.appendChild(table);
  }

  function extractAction(visibleContent, combinedReasoning, validActions) {
    const validSet = new Set(validActions.map(a => a.label));
    const re = /MOVE\s*[:：]\s*(?:\*\*|__|`|\[)*\s*(HIT|STAND)\b/gi;
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

    const wordRe = /\b(HIT|STAND|ヒット|スタンド)\b/gi;
    const scanWord = (txt) => {
      if (!txt) return null;
      let m;
      let last = null;
      while ((m = wordRe.exec(txt)) !== null) {
        const mapped = m[1].toUpperCase() === "HIT" || m[1] === "ヒット" ? "HIT" : "STAND";
        if (validSet.has(mapped)) last = mapped;
      }
      return last;
    };
    const c = scanWord(visibleContent);
    if (c) return { label: c, sourceLabel: "本文末抽出" };
    const d = scanWord(combinedReasoning);
    if (d) return { label: d, sourceLabel: "推論末抽出" };

    return { label: validActions[0].label, sourceLabel: "先頭手フォールバック" };
  }

  globalThis.GameRegistry.register({
    id: "blackjack",
    category: "card",
    name: "ブラックジャック",
    title: "ブラックジャック (1対1対戦)",
    difficultyLabels: {
      easy: "かんたん（直感判断）",
      normal: "ふつう（17基準）",
      hard: "つよい（公開札・勝率考慮）",
      master: "達人（相手枚数・期待値計算）"
    },
    sideLabel: "席順",
    sideOptions: [],
    defaultSide: "default",
    extractAction,
    rulesHtml: `
      <ul>
        <li>1対1のブラックジャック勝負です（初期チップ各100）。バースト（22以上）せずに<strong>21に近い方</strong>がポットを獲得します。</li>
        <li><strong>あなた</strong>：ヒット（追加1枚）／スタンド（勝負）／ダブル（賭け金2倍＋1枚）を選べます。</li>
        <li><strong>AI</strong>：自分の手札と、あなたの最初の公開カード1枚・引いた枚数だけを見てヒットかスタンドを思考します（フェアな隠匿情報対戦）。</li>
      </ul>
    `,

    createInitialState() {
      return dealNewRound(INITIAL_CHIPS, INITIAL_CHIPS, 20, 1);
    },

    cloneState(state) {
      return {
        ...state,
        deck: state.deck.map(c => ({ ...c })),
        humanHand: state.humanHand.map(c => ({ ...c })),
        aiHand: state.aiHand.map(c => ({ ...c }))
      };
    },

    isAiTurn(state) {
      return !state.matchOver && state.phase === "ai_turn";
    },

    isGameOver(state) {
      return state.matchOver;
    },

    getScoreDisplay(state) {
      return {
        firstDotClass: "dot mancala-human",
        firstLabel: "あなた(チップ)",
        firstValue: state.humanChips,
        secondDotClass: "dot mancala-ai",
        secondLabel: "AI(チップ)",
        secondValue: state.aiChips
      };
    },

    getTurnText(state, { isAiThinking, hasError }) {
      if (state.matchOver) {
        if (state.humanChips > state.aiChips) return "終局: あなたの勝利！";
        if (state.aiChips > state.humanChips) return "終局: AIの勝利！";
        return "終局: 引き分け";
      }
      if (state.phase === "round_over") return `Round ${state.roundNum} 決着（次のラウンドを選択）`;
      if (isAiThinking) return `Round ${state.roundNum}: AI が考慮中...`;
      if (hasError) return `Round ${state.roundNum}: AI - 待機中`;
      return `Round ${state.roundNum}: あなたの手番`;
    },

    getStartHistoryText() {
      return "対局開始（ブラックジャック）: 初期チップ あなた100 vs AI100";
    },

    getPlaceholderText() {
      return "手番を待っています。あなたのアクション完了後、AIがヒット／スタンドを判断します。";
    },

    getEndText(state) {
      const res = state.humanChips > state.aiChips
        ? "あなたの勝利！"
        : state.aiChips > state.humanChips
          ? "AIの勝利！"
          : "引き分けです。";
      return `【終局】 あなた:${state.humanChips}チップ / AI:${state.aiChips}チップ（${res}）`;
    },

    renderBoard,

    getValidAiActions() {
      return [
        { label: "HIT", desc: "もう1枚カードを引く" },
        { label: "STAND", desc: "この手札で確定して勝負する" }
      ];
    },

    getDifficultyConfig(diffKey) {
      return DIFFICULTIES[diffKey] || DIFFICULTIES.normal;
    },

    buildAiPrompt(state, validActions, diffConfig) {
      const aiEval = evaluateHand(state.aiHand);
      const humanUpcard = state.humanHand[0];
      const humanExtraCards = state.humanHand.length - 2;

      return `あなたは1対1ブラックジャックのAIプレイヤーです。思考の無限ループは禁止です。
以下の「3つのステップ」のみを日本語で簡潔に記述し、HITかSTANDを決定してください。

【現在の状況 (Round ${state.roundNum})】
・あなた(AI)の手札: ${C.formatCardsList(state.aiHand)} → 合計 ${aiEval.total}点${aiEval.isSoft ? " (ソフトハンド)" : ""}
・相手の公開カード(1枚目): ${C.formatCardText(humanUpcard)}
・相手の伏せ札状況: 初期2枚から${humanExtraCards > 0 ? `追加で${humanExtraCards}枚引いて` : "追加引きなしで"}計${state.humanHand.length}枚でスタンド済み（バーストしていない）
・現在のポット: ${state.pot}チップ

【選択肢】
・HIT: もう1枚引く（21を超えるとバーストで即負け）
・STAND: 現在の合計${aiEval.total}点で勝負する

【方針】
${diffConfig.policy}

【厳守する思考手順】
[思考ステップ1] 状況確認: （自分の点数と相手の公開カードを1文で整理）
[思考ステップ2] リスク評価: （バースト確率や相手想定点との比較を1〜2文で記述）
[思考ステップ3] 行動決定: （HITかSTANDの決定理由を1文で明記）
MOVE: HIT または STAND（例: MOVE: STAND）

※必ず日本語のみで出力し、末尾に「MOVE: HIT」または「MOVE: STAND」を1行出力してください。`;
    },

    applyUserAction(state, action) {
      if (action.type === "NEXT_ROUND") {
        const nextState = dealNewRound(state.humanChips, state.aiChips, action.bet, state.roundNum + 1);
        return {
          state: nextState,
          historyEntries: [{
            type: "info",
            text: `Round ${nextState.roundNum} 開始 (ベット:${nextState.currentBet} / ポット:${nextState.pot})`
          }],
          shouldPushUndo: true,
          autoAdvanceDelayMs: 0
        };
      }

      if (action.type === "FINISH_MATCH") {
        return {
          state: { ...this.cloneState(state), matchOver: true },
          historyEntries: [],
          shouldPushUndo: false,
          autoAdvanceDelayMs: 0
        };
      }

      const next = this.cloneState(state);
      const entries = [];

      if (action.type === "HIT" || action.type === "DOUBLE") {
        if (action.type === "DOUBLE") {
          next.humanChips -= next.currentBet;
          next.aiChips -= next.currentBet;
          next.pot += next.currentBet * 2;
          next.currentBet *= 2;
        }
        const drawn = next.deck.pop();
        next.humanHand.push(drawn);
        const hEval = evaluateHand(next.humanHand);
        entries.push({
          type: "move",
          turnNumber: next.roundNum,
          actor: "あなた",
          colorLabel: action.type === "DOUBLE" ? "ダブル" : "ヒット",
          label: C.formatCardText(drawn),
          detailText: ` (計:${hEval.total}${hEval.isBust ? "・バースト!" : ""})`
        });

        if (hEval.isBust) {
          const settled = settleShowdown(next);
          entries.push({ type: "info", text: settled.roundResult });
          return { state: settled, historyEntries: entries, shouldPushUndo: true, autoAdvanceDelayMs: 0 };
        }

        if (action.type === "DOUBLE" || hEval.total === 21) {
          next.humanStood = true;
          next.phase = "ai_turn";
        }
        return { state: next, historyEntries: entries, shouldPushUndo: true, autoAdvanceDelayMs: 0 };
      }

      // STAND
      const hEval = evaluateHand(next.humanHand);
      next.humanStood = true;
      next.phase = "ai_turn";
      entries.push({
        type: "move",
        turnNumber: next.roundNum,
        actor: "あなた",
        colorLabel: "スタンド",
        label: `${hEval.total}点`,
        detailText: ` (${next.humanHand.length}枚)`
      });
      return { state: next, historyEntries: entries, shouldPushUndo: true, autoAdvanceDelayMs: 0 };
    },

    applyAiAction(state, chosenMove, diffName, isFallback) {
      const next = this.cloneState(state);
      const actor = isFallback ? "AI (フォールバック)" : `AI (${diffName})`;
      const entries = [];

      if (chosenMove.label === "HIT") {
        const drawn = next.deck.pop();
        next.aiHand.push(drawn);
        const aEval = evaluateHand(next.aiHand);
        entries.push({
          type: "move",
          turnNumber: next.roundNum,
          actor,
          colorLabel: "ヒット",
          label: `${next.aiHand.length}枚目`,
          detailText: aEval.isBust ? " (バースト!)" : ""
        });

        if (aEval.isBust || aEval.total === 21) {
          const settled = settleShowdown(next);
          entries.push({ type: "info", text: settled.roundResult });
          return { state: settled, historyEntries: entries, autoAdvanceDelayMs: 0 };
        }

        return { state: next, historyEntries: entries, autoAdvanceDelayMs: 650 };
      }

      // STAND
      const aEval = evaluateHand(next.aiHand);
      const settled = settleShowdown(next);
      entries.push({
        type: "move",
        turnNumber: next.roundNum,
        actor,
        colorLabel: "スタンド",
        label: `${aEval.total}点`,
        detailText: ` (${C.formatCardsList(next.aiHand)})`
      });
      entries.push({ type: "info", text: settled.roundResult });
      return { state: settled, historyEntries: entries, autoAdvanceDelayMs: 0 };
    }
  });
})();
