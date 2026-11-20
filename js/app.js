(() => {
  "use strict";

  const Registry = globalThis.GameRegistry;
  const AI = globalThis.OthelloAI;

  const STORAGE_KEYS = {
    activeGame: "lm_othello_active_game",
    apiUrl: "lm_othello_api_url",
    model: "lm_othello_model",
    difficulty: "lm_othello_difficulty",
    showReasoning: "lm_othello_show_reasoning",
    legacyOthelloSide: "lm_othello_player_color",
    legacyMancalaSide: "lm_mancala_player_order"
  };

  let activeGameId = "othello";
  let gameState = null;
  let isAiThinking = false;
  let isGameOver = false;
  let gameSessionId = 0;
  let currentAbortController = null;
  let currentAbortReason = null;
  let passTimerId = null;

  let undoStack = [];
  let historyEntries = [];
  let thinkingRecords = [];
  let activeThinking = null;
  let firstFetchedModelId = "";
  let lastThinkingHistoryKey = "";
  let thinkingHistoryContainer = null;
  let thinkingCurrentContainer = null;

  const savedSessions = {};
  const perGameSides = {};

  // DOM 要素
  const gameTitleEl = document.getElementById("game-title");
  const gameTabButtons = Array.from(document.querySelectorAll(".game-tab"));
  const gameStageEl = document.getElementById("game-stage");
  const gameRulesBoxEl = document.getElementById("game-rules-box");
  const gameRulesSummaryEl = document.getElementById("game-rules-summary");
  const gameRulesContentEl = document.getElementById("game-rules-content");
  const playerSideRowEl = document.getElementById("player-side-row");
  const playerSideLabelEl = document.getElementById("player-side-label");

  const turnIndicatorEl = document.getElementById("turn-indicator");
  const dotFirstEl = document.getElementById("dot-first");
  const dotSecondEl = document.getElementById("dot-second");
  const labelFirstEl = document.getElementById("label-black");
  const labelSecondEl = document.getElementById("label-white");
  const scoreFirstEl = document.getElementById("score-black");
  const scoreSecondEl = document.getElementById("score-white");
  const thinkingLogEl = document.getElementById("thinking-log");
  const historyLogEl = document.getElementById("history-log");
  const apiUrlInput = document.getElementById("api-url");
  const modelSelect = document.getElementById("model-select");
  const difficultySelect = document.getElementById("difficulty");
  const playerColorSelect = document.getElementById("player-color");
  const toggleReasoningCheckbox = document.getElementById("toggle-reasoning");
  const statusTagEl = document.getElementById("ai-status-tag");
  const connStatusEl = document.getElementById("conn-status");
  const errorBarEl = document.getElementById("ai-error-bar");
  const errorTextEl = document.getElementById("ai-error-text");
  const btnUndo = document.getElementById("btn-undo");
  const btnReset = document.getElementById("btn-reset");
  const btnAbort = document.getElementById("btn-abort");
  const btnRetry = document.getElementById("btn-retry");
  const btnFallback = document.getElementById("btn-fallback");
  const btnLocalhost = document.getElementById("btn-localhost");
  const btnRefreshModels = document.getElementById("btn-refresh-models");

  function getActiveGameDef() {
    return Registry.get(activeGameId) || Registry.list()[0];
  }

  function getSideStorageKey(gameId) {
    if (gameId === "othello") return STORAGE_KEYS.legacyOthelloSide;
    if (gameId === "mancala") return STORAGE_KEYS.legacyMancalaSide;
    return `lm_game_side_${gameId}`;
  }

  function getSelectedSideFor(gameDef) {
    if (!gameDef.sideOptions || gameDef.sideOptions.length === 0) {
      return gameDef.defaultSide || "default";
    }
    const stored = perGameSides[gameDef.id];
    if (stored && gameDef.sideOptions.some(o => o.value === stored)) {
      return stored;
    }
    return gameDef.defaultSide || gameDef.sideOptions[0].value;
  }

  function loadSettings() {
    try {
      apiUrlInput.value = localStorage.getItem(STORAGE_KEYS.apiUrl) || AI.DEFAULT_API_URL;

      const savedDiff = localStorage.getItem(STORAGE_KEYS.difficulty);
      if (savedDiff && AI.DIFFICULTY_SETTINGS[savedDiff]) {
        difficultySelect.value = savedDiff;
      }

      for (const g of Registry.list()) {
        const val = localStorage.getItem(getSideStorageKey(g.id));
        if (val && g.sideOptions?.some(o => o.value === val)) {
          perGameSides[g.id] = val;
        }
      }

      const savedGame = localStorage.getItem(STORAGE_KEYS.activeGame);
      if (savedGame && Registry.has(savedGame)) {
        activeGameId = savedGame;
      }

      toggleReasoningCheckbox.checked = localStorage.getItem(STORAGE_KEYS.showReasoning) === "true";
    } catch (_) {}
  }

  function saveSetting(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (_) {}
  }

  function syncGameChrome() {
    const gameDef = getActiveGameDef();
    gameTitleEl.textContent = gameDef.title || gameDef.name;

    for (const btn of gameTabButtons) {
      const isSelected = btn.dataset.game === activeGameId;
      btn.classList.toggle("active", isSelected);
      btn.setAttribute("aria-selected", String(isSelected));
    }

    const diffLabels = gameDef.difficultyLabels || {};
    for (const opt of difficultySelect.options) {
      if (diffLabels[opt.value]) {
        opt.textContent = diffLabels[opt.value];
      }
    }

    const hasSideOptions = Array.isArray(gameDef.sideOptions) && gameDef.sideOptions.length > 0;
    playerSideRowEl.hidden = !hasSideOptions;
    if (hasSideOptions) {
      playerSideLabelEl.textContent = gameDef.sideLabel || "あなた";
      playerColorSelect.innerHTML = "";
      for (const item of gameDef.sideOptions) {
        const opt = document.createElement("option");
        opt.value = item.value;
        opt.textContent = item.text;
        playerColorSelect.appendChild(opt);
      }
      playerColorSelect.value = getSelectedSideFor(gameDef);
    }

    if (gameDef.rulesHtml) {
      gameRulesBoxEl.hidden = false;
      gameRulesSummaryEl.textContent = `${gameDef.name}のルール早見表`;
      gameRulesContentEl.innerHTML = gameDef.rulesHtml;
    } else {
      gameRulesBoxEl.hidden = true;
    }
  }

  async function refreshModels() {
    connStatusEl.textContent = "確認中...";
    connStatusEl.className = "status-tag active";

    const previousSelection = modelSelect.value || (() => {
      try { return localStorage.getItem(STORAGE_KEYS.model) || ""; } catch (_) { return ""; }
    })();

    const result = await AI.fetchAvailableModels(apiUrlInput.value);
    modelSelect.innerHTML = "";

    if (!result.ok) {
      firstFetchedModelId = "";
      const fallbackOpt = document.createElement("option");
      fallbackOpt.value = "";
      fallbackOpt.textContent = "自動（接続後に取得）";
      modelSelect.appendChild(fallbackOpt);
      connStatusEl.textContent = "未接続";
      connStatusEl.className = "status-tag error";
      return;
    }

    firstFetchedModelId = result.firstModelId;
    const autoOpt = document.createElement("option");
    autoOpt.value = "";
    autoOpt.textContent = firstFetchedModelId ? `自動 (${firstFetchedModelId})` : "自動（ロード済みモデル）";
    modelSelect.appendChild(autoOpt);

    for (const m of result.models) {
      const opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent = m.id;
      modelSelect.appendChild(opt);
    }

    if (previousSelection && result.models.some(m => m.id === previousSelection)) {
      modelSelect.value = previousSelection;
    }

    connStatusEl.textContent = result.models.length > 0 ? `接続OK (${result.models.length})` : "接続OK (モデル0)";
    connStatusEl.className = "status-tag done";
  }

  function abortActiveRequest(reason = "reset") {
    if (passTimerId !== null) {
      clearTimeout(passTimerId);
      passTimerId = null;
    }
    if (currentAbortController) {
      currentAbortReason = reason;
      currentAbortController.abort();
      currentAbortController = null;
    }
  }

  function hideErrorBanner() {
    errorBarEl.classList.remove("visible");
    errorTextEl.textContent = "";
  }

  function showErrorBanner(message) {
    errorTextEl.textContent = message;
    errorBarEl.classList.add("visible");
  }

  function pushUndoSnapshot() {
    const gameDef = getActiveGameDef();
    undoStack.push({
      gameState: gameDef.cloneState(gameState),
      isGameOver,
      historyEntries: historyEntries.map(entry => ({ ...entry })),
      thinkingRecords: thinkingRecords.map(rec => ({ ...rec }))
    });
  }

  function undoMove() {
    if (undoStack.length === 0) return;

    const gameDef = getActiveGameDef();
    gameSessionId++;
    abortActiveRequest("undo");
    isAiThinking = false;
    activeThinking = null;
    hideErrorBanner();

    const snap = undoStack.pop();
    gameState = gameDef.cloneState(snap.gameState);
    isGameOver = Boolean(snap.isGameOver) || gameDef.isGameOver(gameState);
    historyEntries = snap.historyEntries;
    thinkingRecords = snap.thinkingRecords;

    renderHistoryLog();
    renderThinkingLog();
    render();
  }

  function initBoard() {
    const gameDef = getActiveGameDef();
    gameSessionId++;
    abortActiveRequest("reset");

    isAiThinking = false;
    isGameOver = false;
    undoStack = [];
    activeThinking = null;
    thinkingRecords = [];
    hideErrorBanner();

    const sideVal = getSelectedSideFor(gameDef);
    gameState = gameDef.createInitialState(sideVal);
    isGameOver = gameDef.isGameOver(gameState);
    historyEntries = [{
      type: "info",
      text: gameDef.getStartHistoryText(gameState, sideVal)
    }];

    syncGameChrome();
    renderHistoryLog();
    renderThinkingLog();
    render();

    if (!isGameOver && gameDef.isAiTurn(gameState)) {
      runAiTurn();
    }
  }

  function switchGame(targetGameId) {
    if (!Registry.has(targetGameId) || targetGameId === activeGameId) return;

    const currentDef = getActiveGameDef();
    const wasThinking = isAiThinking || passTimerId !== null;
    const hadError = errorBarEl.classList.contains("visible");
    const interruptedAiTurn = !isGameOver && currentDef.isAiTurn(gameState) && (wasThinking || hadError);

    gameSessionId++;
    abortActiveRequest("switch_game");
    isAiThinking = false;
    activeThinking = null;

    savedSessions[activeGameId] = {
      gameState: currentDef.cloneState(gameState),
      isGameOver,
      undoStack: undoStack.map(s => ({
        gameState: currentDef.cloneState(s.gameState),
        isGameOver: s.isGameOver,
        historyEntries: s.historyEntries.map(e => ({ ...e })),
        thinkingRecords: s.thinkingRecords.map(r => ({ ...r }))
      })),
      historyEntries: historyEntries.map(e => ({ ...e })),
      thinkingRecords: thinkingRecords.map(r => ({ ...r })),
      sideValue: getSelectedSideFor(currentDef),
      interruptedAiTurn
    };

    activeGameId = targetGameId;
    saveSetting(STORAGE_KEYS.activeGame, activeGameId);

    const nextDef = getActiveGameDef();
    const existing = savedSessions[activeGameId];
    if (existing) {
      gameState = nextDef.cloneState(existing.gameState);
      isGameOver = existing.isGameOver;
      undoStack = existing.undoStack;
      historyEntries = existing.historyEntries;
      thinkingRecords = existing.thinkingRecords;
      if (existing.sideValue) {
        perGameSides[activeGameId] = existing.sideValue;
      }

      syncGameChrome();
      if (existing.interruptedAiTurn) {
        showErrorBanner("ゲーム切り替えによりAIの思考を中断しました。「再試行」または「フォールバック手で続行」を選べます。");
      } else {
        hideErrorBanner();
      }
      renderHistoryLog();
      renderThinkingLog();
      render();

      if (!isGameOver && !existing.interruptedAiTurn && nextDef.isAiTurn(gameState) && (gameState.moveCount || 0) === 0) {
        runAiTurn();
      }
    } else {
      initBoard();
    }
  }

  function addHistoryEntries(entries) {
    if (!entries || entries.length === 0) return;
    for (const entry of entries) {
      historyEntries.push(entry);
    }
    renderHistoryLog();
  }

  function renderHistoryLog() {
    historyLogEl.innerHTML = "";
    for (const entry of historyEntries) {
      const div = document.createElement("div");
      div.className = "history-entry";

      if (entry.type === "move") {
        const prefix = document.createTextNode(`${entry.turnNumber}. ${entry.actor} (${entry.colorLabel}): `);
        const strong = document.createElement("strong");
        strong.textContent = entry.label;
        const suffix = document.createTextNode(entry.detailText || "");
        div.appendChild(prefix);
        div.appendChild(strong);
        div.appendChild(suffix);
      } else if (entry.type === "pass") {
        div.classList.add("history-pass");
        div.textContent = entry.text;
      } else if (entry.type === "extra") {
        div.classList.add("history-extra");
        div.textContent = entry.text;
      } else if (entry.type === "end") {
        div.classList.add("history-end");
        div.textContent = entry.text;
      } else {
        div.textContent = entry.text;
      }
      historyLogEl.appendChild(div);
    }
    historyLogEl.scrollTop = historyLogEl.scrollHeight;
  }

  function ensureThinkingContainers() {
    if (!thinkingHistoryContainer || !thinkingCurrentContainer) {
      thinkingLogEl.innerHTML = "";
      thinkingHistoryContainer = document.createElement("div");
      thinkingCurrentContainer = document.createElement("div");
      thinkingLogEl.appendChild(thinkingHistoryContainer);
      thinkingLogEl.appendChild(thinkingCurrentContainer);
      lastThinkingHistoryKey = "";
    }
  }

  function renderThinkingLog() {
    const gameDef = getActiveGameDef();
    const showReasoning = toggleReasoningCheckbox.checked;
    ensureThinkingContainers();

    const sideKey = getSelectedSideFor(gameDef);
    const historyKey = `${activeGameId}:${gameSessionId}:${thinkingRecords.length}:${showReasoning}:${sideKey}:${Boolean(activeThinking)}`;
    if (historyKey !== lastThinkingHistoryKey) {
      lastThinkingHistoryKey = historyKey;
      thinkingHistoryContainer.innerHTML = "";

      if (thinkingRecords.length === 0 && !activeThinking) {
        const span = document.createElement("span");
        span.className = "thought-placeholder";
        span.textContent = gameDef.getPlaceholderText(gameState);
        thinkingHistoryContainer.appendChild(span);
      } else {
        for (const rec of thinkingRecords) {
          const details = document.createElement("details");
          details.className = "thought-history-item";
          const summary = document.createElement("summary");
          const sourceNote = rec.sourceLabel ? ` [${rec.sourceLabel}]` : "";
          summary.textContent = `第${rec.turnNumber}手 ${rec.label} (${rec.diffName})${sourceNote}`;
          details.appendChild(summary);

          if (showReasoning && rec.reasoning) {
            const rBox = document.createElement("div");
            rBox.className = "reasoning-block";
            rBox.textContent = `[内部推論]\n${rec.reasoning}`;
            details.appendChild(rBox);
          }

          const body = document.createElement("div");
          body.className = "thought-body";
          body.textContent = rec.content || "思考ログなし";
          details.appendChild(body);
          thinkingHistoryContainer.appendChild(details);
        }
      }
    }

    thinkingCurrentContainer.innerHTML = "";
    if (activeThinking) {
      const header = document.createElement("div");
      header.className = "thought-current-header";
      header.textContent = activeThinking.statusText || "思考中...";
      thinkingCurrentContainer.appendChild(header);

      if (activeThinking.reasoning && (showReasoning || !activeThinking.visible)) {
        const rBox = document.createElement("div");
        rBox.className = "reasoning-block";
        rBox.textContent = activeThinking.visible || showReasoning
          ? `[内部推論]\n${activeThinking.reasoning}`
          : `内部推論を実行中...\n${activeThinking.reasoning.slice(-220)}`;
        thinkingCurrentContainer.appendChild(rBox);
      }

      if (activeThinking.visible) {
        const body = document.createElement("div");
        body.className = "thought-body";
        body.textContent = activeThinking.visible;
        thinkingCurrentContainer.appendChild(body);
      }
    }

    thinkingLogEl.scrollTop = thinkingLogEl.scrollHeight;
  }

  function render() {
    const gameDef = getActiveGameDef();
    const canPlayerAct = !isGameOver && !gameDef.isAiTurn(gameState) && !isAiThinking && !gameState.pendingFlipBack;

    gameStageEl.innerHTML = "";
    gameDef.renderBoard(gameStageEl, gameState, {
      canPlayerAct,
      onUserAction: handleUserMove
    });

    const scores = gameDef.getScoreDisplay(gameState);
    dotFirstEl.className = scores.firstDotClass;
    labelFirstEl.textContent = scores.firstLabel;
    scoreFirstEl.textContent = String(scores.firstValue);
    dotSecondEl.className = scores.secondDotClass;
    labelSecondEl.textContent = scores.secondLabel;
    scoreSecondEl.textContent = String(scores.secondValue);

    btnUndo.disabled = undoStack.length === 0;
    btnAbort.hidden = !isAiThinking;

    const hasError = errorBarEl.classList.contains("visible");
    turnIndicatorEl.textContent = gameDef.getTurnText(gameState, { isAiThinking, hasError });

    if (isGameOver) {
      statusTagEl.textContent = "終局";
      statusTagEl.className = "status-tag done";
    } else if (isAiThinking) {
      statusTagEl.textContent = "考慮中";
      statusTagEl.className = "status-tag active";
    } else if (hasError) {
      statusTagEl.textContent = "エラー";
      statusTagEl.className = "status-tag error";
    } else {
      statusTagEl.textContent = "待機中";
      statusTagEl.className = "status-tag";
    }
  }

  function scheduleAutoAdvance(delayMs) {
    const mySession = gameSessionId;
    const myGame = activeGameId;
    passTimerId = setTimeout(() => {
      passTimerId = null;
      if (mySession !== gameSessionId || isGameOver || activeGameId !== myGame) return;

      const gameDef = getActiveGameDef();
      if (gameDef.onAutoAdvance) {
        const res = gameDef.onAutoAdvance(gameState);
        if (res) {
          gameState = res.state;
          addHistoryEntries(res.historyEntries);
          if (gameDef.isGameOver(gameState)) {
            endGame();
            return;
          }
          render();
          if (res.autoAdvanceDelayMs > 0) {
            scheduleAutoAdvance(res.autoAdvanceDelayMs);
            return;
          }
        }
      }

      if (!isGameOver && gameDef.isAiTurn(gameState)) {
        runAiTurn();
      }
    }, delayMs);
  }

  function handleTransitionResult(result, { isUser }) {
    const gameDef = getActiveGameDef();
    if (isUser && result.shouldPushUndo !== false) {
      pushUndoSnapshot();
    }
    if (isUser) {
      hideErrorBanner();
    }

    gameState = result.state;
    addHistoryEntries(result.historyEntries);

    if (gameDef.isGameOver(gameState)) {
      endGame();
      return;
    }

    renderThinkingLog();
    render();

    if (result.autoAdvanceDelayMs > 0) {
      scheduleAutoAdvance(result.autoAdvanceDelayMs);
      return;
    }

    if (gameDef.isAiTurn(gameState)) {
      runAiTurn();
    }
  }

  function handleUserMove(action) {
    const gameDef = getActiveGameDef();
    if (isGameOver || gameDef.isAiTurn(gameState) || isAiThinking || gameState.pendingFlipBack) return;

    const result = gameDef.applyUserAction(gameState, action);
    handleTransitionResult(result, { isUser: true });
  }

  async function runAiTurn() {
    const gameDef = getActiveGameDef();
    if (isGameOver || isAiThinking || !gameDef.isAiTurn(gameState)) return;

    const validActions = gameDef.getValidAiActions(gameState);
    if (!validActions || validActions.length === 0) {
      endGame();
      return;
    }

    const mySession = gameSessionId;
    const myGame = activeGameId;
    const diffKey = difficultySelect.value;
    const diffConfig = gameDef.getDifficultyConfig(diffKey);
    const diffName = difficultySelect.options[difficultySelect.selectedIndex].text.split("（")[0];
    const prompt = gameDef.buildAiPrompt(gameState, validActions, diffConfig);

    hideErrorBanner();
    isAiThinking = true;
    const stepNo = (gameState.moveCount || 0) + 1;
    activeThinking = {
      statusText: `第${stepNo}手を考慮中 (${diffName})...`,
      reasoning: "",
      visible: ""
    };
    renderThinkingLog();
    render();

    const controller = new AbortController();
    currentAbortController = controller;
    currentAbortReason = null;
    const timeoutId = setTimeout(() => {
      currentAbortReason = "timeout";
      controller.abort();
    }, AI.AI_REQUEST_TIMEOUT_MS);

    try {
      const selectedModel = modelSelect.value.trim() || firstFetchedModelId;
      const result = await AI.streamAiMove({
        apiUrl: apiUrlInput.value,
        model: selectedModel,
        prompt,
        diffConfig,
        validMoves: validActions,
        coordPattern: gameDef.coordPattern,
        extractAction: gameDef.extractAction,
        signal: controller.signal,
        onConnected: () => {
          if (mySession !== gameSessionId) return;
          connStatusEl.textContent = "接続OK";
          connStatusEl.className = "status-tag done";
        },
        onProgress: ({ reasoning, visible }) => {
          if (mySession !== gameSessionId) return;
          activeThinking = {
            statusText: `第${stepNo}手を考慮中 (${diffName})...`,
            reasoning,
            visible
          };
          renderThinkingLog();
        }
      });

      if (mySession !== gameSessionId || myGame !== activeGameId) return;

      thinkingRecords.push({
        turnNumber: stepNo,
        label: result.chosenMove.label,
        diffName,
        sourceLabel: result.sourceLabel,
        reasoning: result.reasoning,
        content: result.content
      });
      activeThinking = null;
      isAiThinking = false;

      const transition = gameDef.applyAiAction(gameState, result.chosenMove, diffName, false);
      handleTransitionResult(transition, { isUser: false });
    } catch (err) {
      if (mySession !== gameSessionId || myGame !== activeGameId) return;
      isAiThinking = false;
      activeThinking = null;

      let errMsg = "";
      if (currentAbortReason === "user_abort") {
        errMsg = "AIの思考を中断しました。「再試行」または「フォールバック手で続行」を選べます。";
      } else if (currentAbortReason === "timeout") {
        errMsg = `応答がタイムアウトしました（${AI.AI_REQUEST_TIMEOUT_MS / 1000}秒）。モデルサイズや接続先を確認して再試行してください。`;
      } else {
        const hint = err.message === "Failed to fetch"
          ? "（LM Studioのサーバー起動・接続先URL・CORS設定を確認してください）"
          : "";
        errMsg = `通信エラー: ${err.message} ${hint}`.trim();
        connStatusEl.textContent = "通信エラー";
        connStatusEl.className = "status-tag error";
      }

      showErrorBanner(errMsg);
      renderThinkingLog();
      render();
    } finally {
      clearTimeout(timeoutId);
      if (currentAbortController === controller) {
        currentAbortController = null;
      }
    }
  }

  function fallbackAiTurn() {
    const gameDef = getActiveGameDef();
    if (isGameOver || isAiThinking || !gameDef.isAiTurn(gameState)) return;

    const validActions = gameDef.getValidAiActions(gameState);
    if (!validActions || validActions.length === 0) {
      endGame();
      return;
    }
    const chosenMove = validActions[0];
    thinkingRecords.push({
      turnNumber: (gameState.moveCount || 0) + 1,
      label: chosenMove.label,
      diffName: "フォールバック",
      sourceLabel: "通信失敗時代替",
      reasoning: "",
      content: `通信エラーまたは中断のため、合法手の先頭 (${chosenMove.label}) を選択しました。`
    });
    const transition = gameDef.applyAiAction(gameState, chosenMove, "フォールバック", true);
    handleTransitionResult(transition, { isUser: false });
  }

  function endGame() {
    const gameDef = getActiveGameDef();
    isGameOver = true;
    isAiThinking = false;
    addHistoryEntries([{
      type: "end",
      text: gameDef.getEndText(gameState)
    }]);
    renderThinkingLog();
    render();
  }

  function resetGame() {
    initBoard();
  }

  for (const btn of gameTabButtons) {
    btn.addEventListener("click", () => {
      switchGame(btn.dataset.game);
    });
  }

  btnUndo.addEventListener("click", undoMove);
  btnReset.addEventListener("click", resetGame);
  btnAbort.addEventListener("click", () => abortActiveRequest("user_abort"));
  btnRetry.addEventListener("click", runAiTurn);
  btnFallback.addEventListener("click", fallbackAiTurn);

  btnLocalhost.addEventListener("click", () => {
    apiUrlInput.value = AI.LOCALHOST_API_URL;
    saveSetting(STORAGE_KEYS.apiUrl, AI.LOCALHOST_API_URL);
    refreshModels();
  });

  btnRefreshModels.addEventListener("click", refreshModels);

  apiUrlInput.addEventListener("change", () => {
    saveSetting(STORAGE_KEYS.apiUrl, apiUrlInput.value.trim());
    refreshModels();
  });

  modelSelect.addEventListener("change", () => {
    saveSetting(STORAGE_KEYS.model, modelSelect.value);
  });

  difficultySelect.addEventListener("change", () => {
    saveSetting(STORAGE_KEYS.difficulty, difficultySelect.value);
  });

  playerColorSelect.addEventListener("change", () => {
    perGameSides[activeGameId] = playerColorSelect.value;
    saveSetting(getSideStorageKey(activeGameId), playerColorSelect.value);
    resetGame();
  });

  toggleReasoningCheckbox.addEventListener("change", () => {
    saveSetting(STORAGE_KEYS.showReasoning, String(toggleReasoningCheckbox.checked));
    renderThinkingLog();
  });

  loadSettings();
  syncGameChrome();
  initBoard();
  refreshModels();

  // テスト・デバッグ向けに最低限の参照を公開
  globalThis.OthelloApp = {
    getActiveGame: () => activeGameId,
    switchGame,
    getState: () => {
      const gameDef = getActiveGameDef();
      return {
        activeGame: activeGameId,
        ...gameDef.cloneState(gameState),
        isAiThinking,
        isGameOver,
        thinkingRecords: [...thinkingRecords],
        historyEntries: [...historyEntries]
      };
    },
    handleUserMove,
    undoMove,
    resetGame,
    fallbackAiTurn,
    refreshModels
  };
})();
