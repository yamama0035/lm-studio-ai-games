(() => {
  "use strict";

  const C = globalThis.CardUtils;

  const INITIAL_CHIPS = 200;
  const ANTE = 10;

  const DIFFICULTIES = {
    easy: { temperature: 0.85, maxTokens: 1200, showAdvice: false, policy: "直感でカード交換やベットを決める。" },
    normal: { temperature: 0.3, maxTokens: 1600, showAdvice: true, policy: "現在の役の強さに応じて堅実に交換・ベットする。" },
    hard: { temperature: 0.1, maxTokens: 2048, showAdvice: true, policy: "役の完成期待値と相手の交換枚数を見て、有利な手でしっかりベットし不利なら降りる。" },
    master: { temperature: 0.05, maxTokens: 2400, showAdvice: true, policy: "相手の交換枚数・ベット額・ポットオッズを計算し、強い手でのバリューベットと適度なブラフ・フォールドを使い分ける。" }
  };

  function dealRound(humanChips, aiChips, roundNum) {
    const deck = C.shuffle(C.createDeck());
    const antePaid = Math.min(ANTE, humanChips, aiChips);
    const nextHumanChips = humanChips - antePaid;
    const nextAiChips = aiChips - antePaid;
    const pot = antePaid * 2;

    const humanHand = [];
    const aiHand = [];
    for (let i = 0; i < 5; i++) {
      humanHand.push(deck.pop());
      aiHand.push(deck.pop());
    }
    humanHand.sort((a, b) => a.rank - b.rank);
    aiHand.sort((a, b) => a.rank - b.rank);

    return {
      deck,
      roundNum,
      pot,
      humanChips: nextHumanChips,
      aiChips: nextAiChips,
      humanHand,
      aiHand,
      selectedDiscard: [],
      humanDrawCount: 0,
      aiDrawCount: 0,
      currentBetToCall: 0,
      phase: "human_draw", // human_draw -> ai_draw -> human_bet -> ai_bet -> human_respond -> round_over
      roundResult: "",
      matchOver: false
    };
  }

  function settleShowdown(state) {
    const cmp = C.comparePokerHands(state.humanHand, state.aiHand);
    const hEval = C.evaluatePokerHand(state.humanHand);
    const aEval = C.evaluatePokerHand(state.aiHand);
    let humanChips = state.humanChips;
    let aiChips = state.aiChips;
    let result = "";

    if (cmp > 0) {
      humanChips += state.pot;
      result = `あなたの勝利！ [${hEval.name}] vs AI [${aEval.name}] (ポット${state.pot}獲得)`;
    } else if (cmp < 0) {
      aiChips += state.pot;
      result = `AIの勝利！ [${aEval.name}] vs あなた [${hEval.name}] (ポット${state.pot}獲得)`;
    } else {
      const half = Math.floor(state.pot / 2);
      humanChips += half;
      aiChips += state.pot - half;
      result = `引き分け！ [${hEval.name}] (ポット分配)`;
    }

    const matchOver = humanChips < ANTE || aiChips < ANTE;
    return {
      ...state,
      humanChips,
      aiChips,
      phase: "round_over",
      roundResult: result,
      matchOver
    };
  }

  function getDrawAdvice(hand) {
    const evalRes = C.evaluatePokerHand(hand);
    const rankCounts = new Map();
    const suitCounts = new Map();
    hand.forEach((c, idx) => {
      if (!rankCounts.has(c.rank)) rankCounts.set(c.rank, []);
      rankCounts.get(c.rank).push(idx);
      if (!suitCounts.has(c.suit)) suitCounts.set(c.suit, []);
      suitCounts.get(c.suit).push(idx);
    });

    if (evalRes.category >= 4) return "完成役あり（KEEP推奨）";
    if (evalRes.category === 3) {
      const tripIndices = Array.from(rankCounts.values()).find(a => a.length === 3);
      const disc = [0, 1, 2, 3, 4].filter(i => !tripIndices.includes(i)).map(i => `P${i + 1}`);
      return `スリーカードあり（${disc.join(",")}交換推奨）`;
    }
    if (evalRes.category === 2) {
      const pairIndices = new Set(Array.from(rankCounts.values()).filter(a => a.length === 2).flat());
      const disc = [0, 1, 2, 3, 4].filter(i => !pairIndices.has(i)).map(i => `P${i + 1}`);
      return `ツーペアあり（${disc.join(",")}交換でフルハウス狙い）`;
    }
    for (const idxs of suitCounts.values()) {
      if (idxs.length === 4) {
        const disc = [0, 1, 2, 3, 4].filter(i => !idxs.includes(i)).map(i => `P${i + 1}`);
        return `フラッシュドロー（${disc.join(",")}の1枚交換推奨）`;
      }
    }
    if (evalRes.category === 1) {
      const pairIndices = Array.from(rankCounts.values()).find(a => a.length === 2);
      const disc = [0, 1, 2, 3, 4].filter(i => !pairIndices.includes(i)).map(i => `P${i + 1}`);
      return `ワンペアあり（${disc.join(",")}交換推奨）`;
    }
    return "役なし（K/A残し、または4〜5枚交換推奨）";
  }

  function renderBoard(stageEl, state, { canPlayerAct, onUserAction }) {
    const table = document.createElement("div");
    table.className = "card-table poker-table";

    const infoBar = document.createElement("div");
    infoBar.className = "table-info-bar";
    infoBar.innerHTML = `<span>Round ${state.roundNum}</span><span>ポット: <strong>${state.pot}</strong> チップ</span>`;
    table.appendChild(infoBar);

    const revealAi = state.phase === "round_over";
    const aiZone = document.createElement("div");
    aiZone.className = "card-zone";
    const aiEval = C.evaluatePokerHand(state.aiHand);
    const aiHeader = document.createElement("div");
    aiHeader.className = "zone-header";
    aiHeader.innerHTML = `<span>AIの手札</span><span>${revealAi ? `役: <strong>${aiEval.name}</strong>` : state.phase === "human_draw" ? "交換前 (5枚)" : `交換: ${state.aiDrawCount}枚`}</span>`;
    const aiRow = document.createElement("div");
    aiRow.className = "card-row";
    state.aiHand.forEach(card => {
      aiRow.appendChild(C.createCardElement(card, { faceDown: !revealAi }));
    });
    aiZone.append(aiHeader, aiRow);

    const humanZone = document.createElement("div");
    humanZone.className = "card-zone";
    const hEval = C.evaluatePokerHand(state.humanHand);
    const humanHeader = document.createElement("div");
    humanHeader.className = "zone-header";
    humanHeader.innerHTML = `<span>あなたの手札</span><span>現在の役: <strong>${hEval.name}</strong></span>`;
    const humanRow = document.createElement("div");
    humanRow.className = "card-row";
    const canToggleDraw = state.phase === "human_draw" && canPlayerAct;
    state.humanHand.forEach((card, idx) => {
      const isSelected = state.selectedDiscard.includes(idx);
      humanRow.appendChild(C.createCardElement(card, {
        selected: isSelected,
        playable: canToggleDraw,
        badge: isSelected ? "交換" : "",
        onClick: canToggleDraw ? () => onUserAction({ type: "TOGGLE_DISCARD", index: idx }) : null
      }));
    });
    humanZone.append(humanHeader, humanRow);

    table.append(aiZone, humanZone);

    const actionArea = document.createElement("div");
    actionArea.className = "card-action-bar";

    if (state.phase === "human_draw" && canPlayerAct) {
      const count = state.selectedDiscard.length;
      const btnDraw = document.createElement("button");
      btnDraw.type = "button";
      btnDraw.className = "btn-primary";
      btnDraw.textContent = count > 0 ? `選択カードを交換（${count}枚）` : "交換せずに勝負 (キープ)";
      btnDraw.onclick = () => onUserAction({ type: "COMMIT_DRAW" });
      actionArea.appendChild(btnDraw);
    } else if (state.phase === "human_bet" && canPlayerAct) {
      const maxAdd = Math.min(state.humanChips, state.aiChips);
      const btnCheck = document.createElement("button");
      btnCheck.type = "button";
      btnCheck.className = "btn-secondary";
      btnCheck.textContent = "チェック (0)";
      btnCheck.onclick = () => onUserAction({ type: "BET", amount: 0 });
      actionArea.appendChild(btnCheck);

      for (const amt of [20, 50]) {
        if (maxAdd >= amt) {
          const btnBet = document.createElement("button");
          btnBet.type = "button";
          btnBet.className = "btn-primary";
          btnBet.textContent = `ベット +${amt}`;
          btnBet.onclick = () => onUserAction({ type: "BET", amount: amt });
          actionArea.appendChild(btnBet);
        }
      }

      const btnFold = document.createElement("button");
      btnFold.type = "button";
      btnFold.className = "btn-danger";
      btnFold.textContent = "フォールド (降りる)";
      btnFold.onclick = () => onUserAction({ type: "FOLD" });
      actionArea.appendChild(btnFold);
    } else if (state.phase === "human_respond" && canPlayerAct) {
      const callAmt = Math.min(state.currentBetToCall, state.humanChips);
      const btnCall = document.createElement("button");
      btnCall.type = "button";
      btnCall.className = "btn-primary";
      btnCall.textContent = `コール (+${callAmt}で勝負)`;
      btnCall.onclick = () => onUserAction({ type: "CALL" });

      const btnFold = document.createElement("button");
      btnFold.type = "button";
      btnFold.className = "btn-danger";
      btnFold.textContent = "フォールド (降りる)";
      btnFold.onclick = () => onUserAction({ type: "FOLD" });
      actionArea.append(btnCall, btnFold);
    } else if (state.phase === "round_over") {
      const resBanner = document.createElement("div");
      resBanner.className = "round-result-banner";
      resBanner.textContent = state.roundResult;
      table.appendChild(resBanner);

      if (!state.matchOver && canPlayerAct) {
        const nextBtn = document.createElement("button");
        nextBtn.type = "button";
        nextBtn.className = "btn-primary";
        nextBtn.textContent = `次のラウンドへ (アンティ ${ANTE})`;
        nextBtn.onclick = () => onUserAction({ type: "NEXT_ROUND" });

        const finishBtn = document.createElement("button");
        finishBtn.type = "button";
        finishBtn.className = "btn-mini";
        finishBtn.textContent = "このチップで対局終了";
        finishBtn.onclick = () => onUserAction({ type: "FINISH_MATCH" });

        actionArea.append(nextBtn, finishBtn);
      }
    }

    if (actionArea.children.length > 0) {
      table.appendChild(actionArea);
    }

    stageEl.appendChild(table);
  }

  function extractAction(visibleContent, combinedReasoning, validActions) {
    // Draw フェーズかどうか判定
    if (validActions.some(a => a.kind === "draw")) {
      const scanDraw = (txt) => {
        if (!txt) return null;
        const moveLineRe = /MOVE\s*[:：]\s*(.+)$/gim;
        let m;
        let last = null;
        while ((m = moveLineRe.exec(txt)) !== null) {
          const raw = m[1].toUpperCase();
          if (raw.includes("KEEP") || raw.includes("交換なし")) {
            last = { label: "KEEP", indices: [] };
          } else {
            const matches = [...raw.matchAll(/P([1-5])/g)].map(x => Number(x[1]) - 1);
            const unique = [...new Set(matches)].sort((a, b) => a - b);
            if (unique.length > 0) {
              last = { label: unique.map(i => `P${i + 1}`).join(","), indices: unique };
            }
          }
        }
        return last;
      };

      const v = scanDraw(visibleContent);
      if (v) return { label: v.label, sourceLabel: "" };
      const r = scanDraw(combinedReasoning);
      if (r) return { label: r.label, sourceLabel: "推論内MOVE抽出" };
      return { label: validActions[0].label, sourceLabel: "先頭手フォールバック" };
    }

    // Bet フェーズ
    const validSet = new Set(validActions.map(a => a.label));
    const re = /MOVE\s*[:：]\s*(?:\*\*|__|`|\[)*\s*(CHECK|BET20|BET50|CALL|RAISE|FOLD)\b/gi;
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
    return { label: validActions[0].label, sourceLabel: "先頭手フォールバック" };
  }

  function buildDrawActionsForHand(hand) {
    // validMoves には KEEP + 任意の P1..P5 組合せ（最大32通り）を登録しておけば streamAiMove の find() が必ず一致！
    const actions = [{ kind: "draw", label: "KEEP", indices: [] }];
    for (let mask = 1; mask < 32; mask++) {
      const indices = [];
      for (let i = 0; i < 5; i++) {
        if (mask & (1 << i)) indices.push(i);
      }
      actions.push({
        kind: "draw",
        label: indices.map(i => `P${i + 1}`).join(","),
        indices
      });
    }
    return actions;
  }

  globalThis.GameRegistry.register({
    id: "poker",
    category: "card",
    name: "ポーカー",
    title: "5カード・ドローポーカー (1対1)",
    difficultyLabels: {
      easy: "かんたん（直感プレイ）",
      normal: "ふつう（役ベース）",
      hard: "つよい（交換枚数・確率考慮）",
      master: "達人（オッズ・ブラフ駆け引き）"
    },
    sideLabel: "席順",
    sideOptions: [],
    defaultSide: "default",
    extractAction,
    rulesHtml: `
      <ul>
        <li>1対1の5カード・ドローポーカーです（初期チップ各200・アンティ10）。</li>
        <li><strong>交換フェーズ</strong>：不要なカードをクリックで選んで1回だけ交換します（0〜5枚）。</li>
        <li><strong>ベットフェーズ</strong>：相手の交換枚数から手札を推理し、チェック／ベット／レイズ／フォールドで勝負します。</li>
      </ul>
    `,

    createInitialState() {
      return dealRound(INITIAL_CHIPS, INITIAL_CHIPS, 1);
    },

    cloneState(state) {
      return {
        ...state,
        deck: state.deck.map(c => ({ ...c })),
        humanHand: state.humanHand.map(c => ({ ...c })),
        aiHand: state.aiHand.map(c => ({ ...c })),
        selectedDiscard: [...state.selectedDiscard]
      };
    },

    isAiTurn(state) {
      return !state.matchOver && (state.phase === "ai_draw" || state.phase === "ai_bet");
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
      if (state.phase === "round_over") return `Round ${state.roundNum} 決着`;
      if (isAiThinking) return `Round ${state.roundNum}: AI が思考中...`;
      if (hasError) return `Round ${state.roundNum}: AI - 待機中`;
      if (state.phase === "human_draw") return `Round ${state.roundNum}: カード交換を選択`;
      if (state.phase === "human_respond") return `Round ${state.roundNum}: AIのレイズに応答`;
      return `Round ${state.roundNum}: ベットを選択`;
    },

    getStartHistoryText() {
      return `対局開始（5カード・ドローポーカー）: 初期チップ あなた200 vs AI200 (アンティ${ANTE})`;
    },

    getPlaceholderText() {
      return "手番を待っています。カード交換またはベットを決定するとAIが思考します。";
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

    getValidAiActions(state) {
      if (state.phase === "ai_draw") {
        return buildDrawActionsForHand(state.aiHand);
      }
      const maxBet = Math.min(state.humanChips, state.aiChips);
      if (state.currentBetToCall === 0) {
        const acts = [{ kind: "bet", label: "CHECK", amount: 0 }];
        if (maxBet >= 20) acts.push({ kind: "bet", label: "BET20", amount: 20 });
        if (maxBet >= 50) acts.push({ kind: "bet", label: "BET50", amount: 50 });
        return acts;
      }
      const acts = [{ kind: "bet", label: "CALL", amount: state.currentBetToCall }];
      if (maxBet >= state.currentBetToCall + 20) {
        acts.push({ kind: "bet", label: "RAISE", amount: state.currentBetToCall + 20 });
      }
      acts.push({ kind: "bet", label: "FOLD", amount: 0 });
      return acts;
    },

    getDifficultyConfig(diffKey) {
      return DIFFICULTIES[diffKey] || DIFFICULTIES.normal;
    },

    buildAiPrompt(state, validActions, diffConfig) {
      const aiEval = C.evaluatePokerHand(state.aiHand);
      const handText = state.aiHand.map((c, i) => `P${i + 1}:${C.formatCardText(c)}`).join("  ");

      if (state.phase === "ai_draw") {
        const advice = diffConfig.showAdvice ? `\n【手札分析】現在の役: ${aiEval.name} / ${getDrawAdvice(state.aiHand)}\n` : "";
        return `あなたは5カード・ドローポーカーのAIです。カード交換のフェーズです。思考の無限ループは禁止です。

【状況 (Round ${state.roundNum})】
・あなた(AI)の手札: ${handText}
・相手の交換枚数: ${state.humanDrawCount}枚（手札は非公開）
・ポット: ${state.pot}チップ
${advice}
【方針】
${diffConfig.policy}

【厳守する思考手順】
[思考ステップ1] 手札確認: （現在の手札と相手の交換枚数を1文で整理）
[思考ステップ2] 交換判断: （何を残し何を替えるか1〜2文で検討）
[思考ステップ3] 交換決定: （最終的な交換対象と理由を1文で明記）
MOVE: KEEP または 捨てる位置をカンマ区切り（例: MOVE: P2,P4,P5 または MOVE: KEEP）

※必ず日本語のみで出力し、末尾に「MOVE: KEEP」または「MOVE: P1,P3」のように出力してください。`;
      }

      const optsText = validActions.map(a => {
        if (a.label === "CHECK") return "・CHECK: チップを追加せず相手のベット段階へ進む（そのままショーダウン）";
        if (a.label === "BET20") return "・BET20: +20チップ賭けて勝負または降ろしを狙う";
        if (a.label === "BET50") return "・BET50: +50チップ強く賭ける";
        if (a.label === "CALL") return `・CALL: 相手のベット(${a.amount}チップ)に合わせてショーダウン`;
        if (a.label === "RAISE") return `・RAISE: コールに加えて+20チップ上乗せ(計${a.amount})で強気に攻める`;
        return "・FOLD: 降りてこのラウンドを譲る";
      }).join("\n");

      return `あなたは5カード・ドローポーカーのAIです。最終ベットフェーズです。思考の無限ループは禁止です。

【状況 (Round ${state.roundNum})】
・あなた(AI)の最終手札: ${handText}
・現在の役: ${aiEval.name}
・交換枚数: あなた(AI) ${state.aiDrawCount}枚 / 相手 ${state.humanDrawCount}枚
・現在のポット: ${state.pot}チップ（AI残り:${state.aiChips} / 相手残り:${state.humanChips}）
・相手の行動: ${state.currentBetToCall > 0 ? `${state.currentBetToCall}チップをベット` : "チェック (ベット0)"}

【選択肢】
${optsText}

【方針】
${diffConfig.policy}

【厳守する思考手順】
[思考ステップ1] 状況確認: （自分の役と相手の交換枚数・行動を1文で整理）
[思考ステップ2] 勝算評価: （勝率やブラフ余地を1〜2文で検討）
[思考ステップ3] 行動決定: （決定したアクションと理由を1文で明記）
MOVE: 選んだアクション名（例: MOVE: CALL）

※必ず日本語のみで出力し、末尾に「MOVE: ${validActions.map(a => a.label).join(" / ")} のいずれか」を1行出力してください。`;
    },

    applyUserAction(state, action) {
      if (action.type === "NEXT_ROUND") {
        const next = dealRound(state.humanChips, state.aiChips, state.roundNum + 1);
        return {
          state: next,
          historyEntries: [{ type: "info", text: `Round ${next.roundNum} 開始 (アンティ${ANTE} / ポット${next.pot})` }],
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

      if (action.type === "TOGGLE_DISCARD") {
        const idx = next.selectedDiscard.indexOf(action.index);
        if (idx >= 0) next.selectedDiscard.splice(idx, 1);
        else next.selectedDiscard.push(action.index);
        return { state: next, historyEntries: [], shouldPushUndo: false, autoAdvanceDelayMs: 0 };
      }

      if (action.type === "COMMIT_DRAW") {
        const count = next.selectedDiscard.length;
        const discSet = new Set(next.selectedDiscard);
        const kept = next.humanHand.filter((_, i) => !discSet.has(i));
        for (let i = 0; i < count; i++) kept.push(next.deck.pop());
        kept.sort((a, b) => a.rank - b.rank);
        next.humanHand = kept;
        next.selectedDiscard = [];
        next.humanDrawCount = count;
        next.phase = "ai_draw";
        return {
          state: next,
          historyEntries: [{
            type: "move",
            turnNumber: next.roundNum,
            actor: "あなた",
            colorLabel: "交換",
            label: count > 0 ? `${count}枚交換` : "キープ",
            detailText: ""
          }],
          shouldPushUndo: true,
          autoAdvanceDelayMs: 0
        };
      }

      if (action.type === "BET") {
        const amt = action.amount;
        if (amt > 0) {
          next.humanChips -= amt;
          next.pot += amt;
        }
        next.currentBetToCall = amt;
        next.phase = "ai_bet";
        return {
          state: next,
          historyEntries: [{
            type: "move",
            turnNumber: next.roundNum,
            actor: "あなた",
            colorLabel: amt > 0 ? "ベット" : "チェック",
            label: amt > 0 ? `+${amt}` : "0",
            detailText: ""
          }],
          shouldPushUndo: true,
          autoAdvanceDelayMs: 0
        };
      }

      if (action.type === "CALL") {
        const callAmt = Math.min(next.currentBetToCall, next.humanChips);
        next.humanChips -= callAmt;
        next.pot += callAmt;
        const settled = settleShowdown(next);
        return {
          state: settled,
          historyEntries: [
            { type: "move", turnNumber: next.roundNum, actor: "あなた", colorLabel: "コール", label: `+${callAmt}`, detailText: "" },
            { type: "info", text: settled.roundResult }
          ],
          shouldPushUndo: true,
          autoAdvanceDelayMs: 0
        };
      }

      // FOLD
      next.aiChips += next.pot;
      next.phase = "round_over";
      next.roundResult = `あなたがフォールドしました。AIがポット${next.pot}獲得！`;
      next.matchOver = next.humanChips < ANTE || next.aiChips < ANTE;
      return {
        state: next,
        historyEntries: [
          { type: "move", turnNumber: next.roundNum, actor: "あなた", colorLabel: "フォールド", label: "降り", detailText: "" },
          { type: "info", text: next.roundResult }
        ],
        shouldPushUndo: true,
        autoAdvanceDelayMs: 0
      };
    },

    applyAiAction(state, chosenMove, diffName, isFallback) {
      const next = this.cloneState(state);
      const actor = isFallback ? "AI (フォールバック)" : `AI (${diffName})`;

      if (chosenMove.kind === "draw") {
        const discSet = new Set(chosenMove.indices);
        const kept = next.aiHand.filter((_, i) => !discSet.has(i));
        for (let i = 0; i < chosenMove.indices.length; i++) kept.push(next.deck.pop());
        kept.sort((a, b) => a.rank - b.rank);
        next.aiHand = kept;
        next.aiDrawCount = chosenMove.indices.length;
        next.phase = "human_bet";
        return {
          state: next,
          historyEntries: [{
            type: "move",
            turnNumber: next.roundNum,
            actor,
            colorLabel: "交換",
            label: next.aiDrawCount > 0 ? `${next.aiDrawCount}枚交換` : "キープ",
            detailText: ""
          }],
          autoAdvanceDelayMs: 0
        };
      }

      // Betting phase
      const entries = [];
      if (chosenMove.label === "CHECK") {
        const settled = settleShowdown(next);
        entries.push({ type: "move", turnNumber: next.roundNum, actor, colorLabel: "チェック", label: "0", detailText: "" });
        entries.push({ type: "info", text: settled.roundResult });
        return { state: settled, historyEntries: entries, autoAdvanceDelayMs: 0 };
      }

      if (chosenMove.label === "BET20" || chosenMove.label === "BET50") {
        const amt = Math.min(chosenMove.amount, next.aiChips);
        next.aiChips -= amt;
        next.pot += amt;
        next.currentBetToCall = amt;
        next.phase = "human_respond";
        entries.push({ type: "move", turnNumber: next.roundNum, actor, colorLabel: "ベット", label: `+${amt}`, detailText: "" });
        return { state: next, historyEntries: entries, autoAdvanceDelayMs: 0 };
      }

      if (chosenMove.label === "CALL") {
        const callAmt = Math.min(next.currentBetToCall, next.aiChips);
        next.aiChips -= callAmt;
        next.pot += callAmt;
        const settled = settleShowdown(next);
        entries.push({ type: "move", turnNumber: next.roundNum, actor, colorLabel: "コール", label: `+${callAmt}`, detailText: "" });
        entries.push({ type: "info", text: settled.roundResult });
        return { state: settled, historyEntries: entries, autoAdvanceDelayMs: 0 };
      }

      if (chosenMove.label === "RAISE") {
        const callAmt = next.currentBetToCall;
        const totalPay = Math.min(chosenMove.amount, next.aiChips);
        const raiseDiff = Math.max(0, totalPay - callAmt);
        next.aiChips -= totalPay;
        next.pot += totalPay;
        next.currentBetToCall = raiseDiff;
        next.phase = "human_respond";
        entries.push({ type: "move", turnNumber: next.roundNum, actor, colorLabel: "レイズ", label: `+${totalPay}`, detailText: ` (差額+${raiseDiff})` });
        return { state: next, historyEntries: entries, autoAdvanceDelayMs: 0 };
      }

      // FOLD
      next.humanChips += next.pot;
      next.phase = "round_over";
      next.roundResult = `AIがフォールドしました。あなたがポット${next.pot}獲得！`;
      next.matchOver = next.humanChips < ANTE || next.aiChips < ANTE;
      entries.push({ type: "move", turnNumber: next.roundNum, actor, colorLabel: "フォールド", label: "降り", detailText: "" });
      entries.push({ type: "info", text: next.roundResult });
      return { state: next, historyEntries: entries, autoAdvanceDelayMs: 0 };
    }
  });
})();
