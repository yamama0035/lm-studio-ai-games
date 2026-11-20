(() => {
  "use strict";

  const E = globalThis.OthelloEngine;
  const M = globalThis.MancalaEngine;

  const DEFAULT_API_URL = "http://localhost:1234/v1/chat/completions";
  const LOCALHOST_API_URL = "http://localhost:1234/v1/chat/completions";
  const AI_REQUEST_TIMEOUT_MS = 60000;

  const DIFFICULTY_SETTINGS = {
    easy: {
      temperature: 0.8,
      maxTokens: 1200,
      includeBoard: false,
      includeLookahead: false,
      policy: "深く読まず、直感で気まぐれに1手を選定する。必ずしも最善手や石数最大を選ばなくてよい。"
    },
    normal: {
      temperature: 0.3,
      maxTokens: 1600,
      includeBoard: true,
      includeLookahead: false,
      policy: "相手の石を多く獲得できる手や、角・辺の位置取りのバランスを見て1手を選定する。"
    },
    hard: {
      temperature: 0.1,
      maxTokens: 2048,
      includeBoard: true,
      includeLookahead: true,
      policy: "四隅の角の確保を最優先とし、相手に角を奪われる危険なX打ち・C打ち・角献上手を避けて選定する。"
    },
    master: {
      temperature: 0.05,
      maxTokens: 2400,
      includeBoard: true,
      includeLookahead: true,
      policy: "序盤・中盤は相手の手数（合法手数）を削り、角献上を徹底回避する手を選ぶ。終盤は相手パス誘発と最終石数の最大化を狙う。"
    }
  };

  const MANCALA_DIFFICULTY_SETTINGS = {
    easy: {
      temperature: 0.85,
      maxTokens: 1200,
      includeBoard: false,
      lookaheadLevel: 0,
      policy: "深く先読みせず、直感や気まぐれで1手を選定する。必ずしも最善手や連続手番を狙わなくてよい。"
    },
    normal: {
      temperature: 0.3,
      maxTokens: 1600,
      includeBoard: true,
      lookaheadLevel: 1,
      policy: "最後の石が自ゴールに入る連続手番や、相手の石を奪う横取りを狙いつつ、バランスの良い1手を選定する。"
    },
    hard: {
      temperature: 0.1,
      maxTokens: 2048,
      includeBoard: true,
      lookaheadLevel: 1,
      policy: "連続手番（ぴったりゴール）と横取り（Capture）の機会を優先して探し、自ゴールに効率よく石を増やす手を選ぶ。"
    },
    master: {
      temperature: 0.05,
      maxTokens: 2400,
      includeBoard: true,
      lookaheadLevel: 2,
      policy: "連続手番の連鎖や大量横取りを徹底的に狙うと同時に、次手で相手に連続手番や大きな横取りを許さない手を選ぶ。終盤はゴール差の最大化を狙う。"
    }
  };

  function getModelsEndpoint(chatCompletionsUrl) {
    return chatCompletionsUrl.trim().replace(/\/chat\/completions\/?$/, "") + "/models";
  }

  async function fetchAvailableModels(chatCompletionsUrl, timeoutMs = 5000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(getModelsEndpoint(chatCompletionsUrl), { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const models = Array.isArray(data.data) ? data.data.filter(m => m && m.id) : [];
      return {
        ok: true,
        models,
        firstModelId: models[0]?.id || ""
      };
    } catch (err) {
      return {
        ok: false,
        models: [],
        firstModelId: "",
        error: err
      };
    } finally {
      clearTimeout(timer);
    }
  }

  function parseContentWithThink(rawText) {
    let source = rawText;
    const thinkingParts = [];

    // チャットテンプレート側で <think> が先置きされ </think> のみ出力される場合に対応
    const firstOpen = source.indexOf("<think>");
    const firstClose = source.indexOf("</think>");
    if (firstClose !== -1 && (firstOpen === -1 || firstClose < firstOpen)) {
      thinkingParts.push(source.slice(0, firstClose));
      source = source.slice(firstClose + 8);
    }

    let visible = "";
    let i = 0;
    while (i < source.length) {
      const start = source.indexOf("<think>", i);
      if (start === -1) {
        visible += source.slice(i);
        break;
      }
      visible += source.slice(i, start);
      const end = source.indexOf("</think>", start + 7);
      if (end === -1) {
        thinkingParts.push(source.slice(start + 7));
        break;
      }
      thinkingParts.push(source.slice(start + 7, end));
      i = end + 8;
    }

    return {
      inlineThinking: thinkingParts.join("\n").trim(),
      visibleContent: visible.trim()
    };
  }

  function stripMoveDirectiveForDisplay(visibleText) {
    return visibleText
      .replace(/^\s*MOVE\s*[:：].*$/gim, "")
      .replace(/MOVE\s*[:：]\s*(?:\*\*|__|`|\[)*\s*[A-Za-z0-9-]*\s*[\]\*`_]*.*$/is, "")
      .trim();
  }

  function extractMoveFromResponse(visibleContent, combinedReasoning, validLabels, coordPattern = "[A-H][1-8]") {
    const validSet = new Set(validLabels.map(l => l.toUpperCase()));

    const findLastMatch = (text, regex) => {
      if (!text) return null;
      let match;
      let lastValid = null;
      while ((match = regex.exec(text)) !== null) {
        const coord = match[1].toUpperCase();
        if (validSet.has(coord)) lastValid = coord;
      }
      return lastValid;
    };

    const moveDirectiveRegex = () => new RegExp(`MOVE\\s*[:：]\\s*(?:\\*\\*|__|\\\`|\\[)*\\s*(${coordPattern})\\b`, "gi");
    const coordRegex = () => new RegExp(`\\b(${coordPattern})\\b`, "gi");

    const fromVisibleMove = findLastMatch(visibleContent, moveDirectiveRegex());
    if (fromVisibleMove) return { label: fromVisibleMove, source: "move_directive", sourceLabel: "" };

    const fromReasoningMove = findLastMatch(combinedReasoning, moveDirectiveRegex());
    if (fromReasoningMove) return { label: fromReasoningMove, source: "reasoning_move", sourceLabel: "推論内MOVE抽出" };

    const step3Match = visibleContent.match(/\[?思考ステップ\s*3\]?([\s\S]*)$/i);
    if (step3Match) {
      const fromStep3 = findLastMatch(step3Match[1], coordRegex());
      if (fromStep3) return { label: fromStep3, source: "step3", sourceLabel: "ステップ3抽出" };
    }

    const fromVisibleMention = findLastMatch(visibleContent, coordRegex());
    if (fromVisibleMention) return { label: fromVisibleMention, source: "visible_mention", sourceLabel: "本文末座標抽出" };

    const fromReasoningMention = findLastMatch(combinedReasoning, coordRegex());
    if (fromReasoningMention) return { label: fromReasoningMention, source: "reasoning_mention", sourceLabel: "推論末座標抽出" };

    return { label: validLabels[0], source: "fallback", sourceLabel: "先頭手フォールバック" };
  }

  function buildMovesSummary(board, validMoves, aiColor, playerColor, diffConfig) {
    return validMoves.map(m => {
      let line = `・${m.label}: +${m.flips.length}石 [${m.type}]`;
      if (diffConfig.includeLookahead) {
        const sim = E.cloneBoard(board);
        E.applyMove(sim, m.r, m.c, aiColor, m.flips);
        const oppMoves = E.getValidMoves(sim, playerColor, aiColor);
        const oppCorners = oppMoves.filter(om => E.isCornerCoord(om.r, om.c)).map(om => om.label);

        line += ` / 次手相手合法手:${oppMoves.length}手`;
        if (oppMoves.length === 0) {
          line += " ★相手パス確定";
        } else if (oppCorners.length > 0) {
          line += ` ⚠️相手に角(${oppCorners.join(",")})を取られる`;
        }
      }
      return line;
    }).join("\n");
  }

  function buildAiPrompt({ board, validMoves, aiColor, playerColor, moveCount, diffConfig }) {
    const counts = E.countStones(board);
    const phase = counts.empty >= 40 ? "序盤" : counts.empty >= 16 ? "中盤" : "終盤";
    const aiSymbol = aiColor === E.BLACK ? "黒 (●)" : "白 (○)";
    const playerSymbol = playerColor === E.BLACK ? "黒 (●)" : "白 (○)";
    const movesSummary = buildMovesSummary(board, validMoves, aiColor, playerColor, diffConfig);

    const boardSection = diffConfig.includeBoard
      ? `\n【現在の盤面】(●=黒 / ○=白 / ·=空)\n${E.boardToText(board)}\n石数: 黒 ${counts.black} / 白 ${counts.white} / 空き ${counts.empty} (${moveCount + 1}手目・${phase})\n`
      : `\n【局面】${moveCount + 1}手目（${phase}） 黒:${counts.black}石 / 白:${counts.white}石\n`;

    return `あなたはオセロの${aiSymbol}番、相手は${playerSymbol}番です。思考の無限ループや長文の自問自答は禁止です。
以下の「3つのステップ」のみを日本語で簡潔に記述し、上限ステップ内で直ちに思考を完了させてください。
${boardSection}
【候補手一覧】
${movesSummary}

【方針】
${diffConfig.policy}

【厳守する思考手順】
以下の枠組み通りの形式で、日本語のみを用いて3ステップで思考を完了させてください。

[思考ステップ1] 候補手の確認: （候補手の特徴を1文で整理）
[思考ステップ2] 盤面の評価: （方針に沿った手の比較を1〜2文で記述）
[思考ステップ3] 着手の決定: （最終決定した手と理由を1文で明記）
MOVE: 選んだ座標（例: MOVE: C4）

※外国語での思考は厳禁です。ステップ3を書き終えたら直ちに「MOVE: 座標」を1行出力して終了してください。`;
  }

  function buildMancalaMovesSummary(pits, validMoves, diffConfig) {
    if (!M) return validMoves.map(m => `・${m.label}: 石${m.stones}個`).join("\n");

    return validMoves.map(m => {
      let line = `・${m.label}: 石${m.stones}個（ゴールまで${m.distanceToStore}マス）`;
      if (diffConfig.lookaheadLevel >= 1) {
        const sim = M.simulateMove(pits, m.index, M.AI);
        line += ` → 着地:${sim.lastLabel}`;

        if (sim.gameEnded) {
          line += ` ★終局確定 (最終ゴール AI:${sim.pits[M.AI_STORE]} vs 相手:${sim.pits[M.HUMAN_STORE]})`;
        } else if (sim.extraTurn) {
          line += " ★ぴったりゴール（連続手番確定！）";
        } else if (sim.captured.occurred) {
          line += ` ★横取り成功 (+${sim.captured.totalCaptured}石をAIゴールへ)`;
        }

        if (diffConfig.lookaheadLevel >= 2 && !sim.gameEnded) {
          if (sim.extraTurn) {
            const followMoves = M.getValidMoves(sim.pits, M.AI);
            let maxGain = 0;
            let hasChain = false;
            for (const fm of followMoves) {
              const sim2 = M.simulateMove(sim.pits, fm.index, M.AI);
              const gain = sim2.pits[M.AI_STORE] - sim.pits[M.AI_STORE];
              if (gain > maxGain) maxGain = gain;
              if (sim2.extraTurn) hasChain = true;
            }
            line += ` / 連鎖候補:${followMoves.length}手${hasChain ? "(再連続手番あり)" : ""}・次手最大+${maxGain}石`;
          } else {
            const oppMoves = M.getValidMoves(sim.pits, M.HUMAN);
            let oppExtra = false;
            let maxOppCapture = 0;
            let oppCanEnd = false;
            for (const om of oppMoves) {
              const simOpp = M.simulateMove(sim.pits, om.index, M.HUMAN);
              if (simOpp.extraTurn) oppExtra = true;
              if (simOpp.captured.occurred && simOpp.captured.totalCaptured > maxOppCapture) {
                maxOppCapture = simOpp.captured.totalCaptured;
              }
              if (simOpp.gameEnded) oppCanEnd = true;
            }
            const risks = [];
            if (oppExtra) risks.push("相手に連続手番あり");
            if (maxOppCapture > 0) risks.push(`相手に最大+${maxOppCapture}石横取りリスク`);
            if (oppCanEnd) risks.push("相手が次手で終局可能");
            line += risks.length > 0 ? ` / ⚠️${risks.join("・")}` : " / 相手反撃リスク小";
          }
        }
      }
      return line;
    }).join("\n");
  }

  function buildMancalaAiPrompt({ pits, validMoves, moveCount, diffConfig, playerIsFirst }) {
    const counts = M.countStones(pits);
    const phase = counts.totalOnBoard >= 32 ? "序盤" : counts.totalOnBoard >= 14 ? "中盤" : "終盤";
    const aiOrderLabel = playerIsFirst ? "後手（上段 A2〜F2）" : "先手（上段 A2〜F2）";
    const movesSummary = buildMancalaMovesSummary(pits, validMoves, diffConfig);

    const boardSection = diffConfig.includeBoard
      ? `\n【現在の盤面】\n${M.boardToText(pits)}\nスコア: AIゴール ${counts.aiStore}石 / あなたゴール ${counts.humanStore}石 / 盤面残り ${counts.totalOnBoard}石 (${moveCount + 1}手目・${phase})\n`
      : `\n【局面】${moveCount + 1}手目（${phase}） AIゴール:${counts.aiStore}石 / あなたゴール:${counts.humanStore}石 / 盤面残り:${counts.totalOnBoard}石\n`;

    return `あなたはマンカラ（Kalah）のAI（${aiOrderLabel}）です。思考の無限ループや長文の自問自答は禁止です。
以下の「3つのステップ」のみを日本語で簡潔に記述し、上限ステップ内で直ちに思考を完了させてください。

【ルール要点】
・自分のポケット（A2〜F2）を1つ選び、石を反時計回りに1個ずつまく（相手ゴールは飛ばす）。
・最後の1個がちょうどAIゴールに入ると連続手番。
・最後の1個が自分の空ポケットに入り、向かい側（下段）に石があれば両方をAIゴールへ横取り。
・どちらかの6ポケットが空になったら終了し、残った石はそれぞれの陣地のゴールへ加算される。
${boardSection}
【候補手一覧】
${movesSummary}

【方針】
${diffConfig.policy}

【厳守する思考手順】
以下の枠組み通りの形式で、日本語のみを用いて3ステップで思考を完了させてください。

[思考ステップ1] 候補手の確認: （候補手の特徴を1文で整理）
[思考ステップ2] 局面の評価: （方針に沿った手の比較を1〜2文で記述）
[思考ステップ3] 着手の決定: （最終決定したポケットと理由を1文で明記）
MOVE: 選んだポケット名（例: MOVE: C2）

※外国語での思考は厳禁です。ステップ3を書き終えたら直ちに「MOVE: ポケット名」を1行出力して終了してください。`;
  }

  async function streamAiMove({
    apiUrl,
    model,
    prompt,
    diffConfig,
    validMoves,
    coordPattern = "[A-H][1-8]",
    extractAction = null,
    signal,
    onConnected,
    onProgress
  }) {
    const validLabels = validMoves.map(m => m.label);
    const requestBody = {
      messages: [{ role: "user", content: prompt }],
      temperature: diffConfig.temperature,
      max_tokens: diffConfig.maxTokens,
      stream: true
    };
    if (model) {
      requestBody.model = model;
    }

    const res = await fetch(apiUrl.trim(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
      signal
    });

    if (!res.ok) {
      let errorDetail = "";
      try {
        const errData = await res.json();
        errorDetail = errData.error?.message || JSON.stringify(errData);
      } catch (_) {
        errorDetail = res.statusText;
      }
      throw new Error(`HTTP ${res.status}: ${errorDetail}`);
    }

    if (onConnected) onConnected();

    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let streamedContent = "";
    let streamedReasoning = "";
    let streamDone = false;

    const processSseLine = (rawLine) => {
      const clean = rawLine.trim();
      if (!clean.startsWith("data:")) return;
      if (clean === "data: [DONE]") {
        streamDone = true;
        return;
      }

      try {
        const data = JSON.parse(clean.replace(/^data:\s*/, ""));
        const delta = data.choices?.[0]?.delta;
        if (!delta) return;

        const rDelta = delta.reasoning_content || delta.reasoning || "";
        if (rDelta) streamedReasoning += rDelta;
        if (delta.content) streamedContent += delta.content;

        if (onProgress) {
          const parsed = parseContentWithThink(streamedContent);
          const combinedReasoning = [streamedReasoning.trim(), parsed.inlineThinking].filter(Boolean).join("\n\n");
          const displayVisible = stripMoveDirectiveForDisplay(parsed.visibleContent);
          onProgress({
            reasoning: combinedReasoning,
            visible: displayVisible || (parsed.visibleContent ? "結論を確定中..." : "")
          });
        }
      } catch (_) {}
    };

    while (!streamDone) {
      if (signal?.aborted) {
        throw new Error("Aborted");
      }
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop();

      for (const line of lines) {
        processSseLine(line);
        if (streamDone) break;
      }
    }

    if (buffer.trim()) {
      processSseLine(buffer);
    }

    const parsed = parseContentWithThink(streamedContent);
    const combinedReasoning = [streamedReasoning.trim(), parsed.inlineThinking].filter(Boolean).join("\n\n");
    const extraction = extractAction
      ? extractAction(parsed.visibleContent, combinedReasoning, validMoves)
      : extractMoveFromResponse(parsed.visibleContent, combinedReasoning, validLabels, coordPattern);
    const chosenMove = validMoves.find(m => m.label.toUpperCase() === extraction.label.toUpperCase()) || validMoves[0];
    const cleanDisplayContent = stripMoveDirectiveForDisplay(parsed.visibleContent) || "思考完了：着手を決定しました。";

    return {
      chosenMove,
      reasoning: combinedReasoning,
      content: cleanDisplayContent,
      sourceLabel: extraction.sourceLabel || ""
    };
  }

  globalThis.OthelloAI = {
    DEFAULT_API_URL,
    LOCALHOST_API_URL,
    AI_REQUEST_TIMEOUT_MS,
    DIFFICULTY_SETTINGS,
    MANCALA_DIFFICULTY_SETTINGS,
    getModelsEndpoint,
    fetchAvailableModels,
    parseContentWithThink,
    stripMoveDirectiveForDisplay,
    extractMoveFromResponse,
    buildMovesSummary,
    buildAiPrompt,
    buildMancalaMovesSummary,
    buildMancalaAiPrompt,
    streamAiMove
  };
})();
