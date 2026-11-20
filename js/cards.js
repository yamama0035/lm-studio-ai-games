(() => {
  "use strict";

  const SUITS = [
    { id: "S", symbol: "♠", name: "スペード", color: "black" },
    { id: "H", symbol: "♥", name: "ハート", color: "red" },
    { id: "D", symbol: "♦", name: "ダイヤ", color: "red" },
    { id: "C", symbol: "♣", name: "クラブ", color: "black" }
  ];

  const SUIT_MAP = Object.fromEntries(SUITS.map(s => [s.id, s]));

  const RANKS = [
    { value: 2, label: "2" },
    { value: 3, label: "3" },
    { value: 4, label: "4" },
    { value: 5, label: "5" },
    { value: 6, label: "6" },
    { value: 7, label: "7" },
    { value: 8, label: "8" },
    { value: 9, label: "9" },
    { value: 10, label: "10" },
    { value: 11, label: "J" },
    { value: 12, label: "Q" },
    { value: 13, label: "K" },
    { value: 14, label: "A" }
  ];

  function createDeck({ includeJokers = 0 } = {}) {
    const deck = [];
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        deck.push({
          id: `${suit.id}${rank.label}`,
          suit: suit.id,
          suitSymbol: suit.symbol,
          color: suit.color,
          rank: rank.value,
          label: rank.label,
          isJoker: false
        });
      }
    }
    for (let j = 0; j < includeJokers; j++) {
      deck.push({
        id: `JOKER${j + 1}`,
        suit: "JOKER",
        suitSymbol: "★",
        color: "joker",
        rank: 99,
        label: "JOKER",
        isJoker: true
      });
    }
    return deck;
  }

  function shuffle(items) {
    const arr = items.map(c => ({ ...c }));
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  function formatCardText(card) {
    if (!card) return "??";
    if (card.isJoker) return "JOKER";
    return `${card.suitSymbol}${card.label}`;
  }

  function formatCardsList(cards) {
    return cards.map(formatCardText).join(" ");
  }

  function createCardElement(card, {
    faceDown = false,
    selected = false,
    playable = false,
    compact = false,
    mini = false,
    badge = "",
    coordLabel = "",
    onClick = null
  } = {}) {
    const el = document.createElement(onClick ? "button" : "div");
    if (onClick) el.type = "button";

    const classes = ["playing-card"];
    if (faceDown) {
      classes.push("face-down");
    } else if (card) {
      classes.push(`suit-${card.color}`);
    }
    if (selected) classes.push("selected");
    if (playable) classes.push("playable");
    if (compact) classes.push("compact");
    if (mini) classes.push("mini");
    el.className = classes.join(" ");

    if (coordLabel) {
      const coord = document.createElement("span");
      coord.className = "card-coord-tag";
      coord.textContent = coordLabel;
      el.appendChild(coord);
    }

    if (faceDown) {
      const backPattern = document.createElement("span");
      backPattern.className = "card-back-pattern";
      backPattern.textContent = "❖";
      el.appendChild(backPattern);
    } else if (card) {
      const top = document.createElement("span");
      top.className = "card-corner top";
      top.textContent = card.isJoker ? "JK" : `${card.label}${card.suitSymbol}`;

      const center = document.createElement("span");
      center.className = "card-center";
      center.textContent = card.isJoker ? "🃏" : card.suitSymbol;

      const bottom = document.createElement("span");
      bottom.className = "card-corner bottom";
      bottom.textContent = card.isJoker ? "JK" : `${card.label}${card.suitSymbol}`;

      el.appendChild(top);
      el.appendChild(center);
      el.appendChild(bottom);
    }

    if (badge) {
      const badgeEl = document.createElement("span");
      badgeEl.className = "card-badge";
      badgeEl.textContent = badge;
      el.appendChild(badgeEl);
    }

    if (onClick) {
      el.onclick = onClick;
    }

    return el;
  }

  // 5枚ポーカーの役判定（強さスコア配列付き）
  function evaluatePokerHand(cards) {
    if (!Array.isArray(cards) || cards.length !== 5) {
      return { category: 0, name: "不明", ranks: [0] };
    }

    const sortedRanks = cards.map(c => c.rank).sort((a, b) => b - a);
    const counts = new Map();
    for (const r of sortedRanks) {
      counts.set(r, (counts.get(r) || 0) + 1);
    }

    const isFlush = cards.every(c => c.suit === cards[0].suit);

    // ストレート判定 (A-2-3-4-5 のホイールも含む)
    const uniqueRanks = [...new Set(sortedRanks)];
    let isStraight = false;
    let straightHigh = sortedRanks[0];
    if (uniqueRanks.length === 5) {
      if (uniqueRanks[0] - uniqueRanks[4] === 4) {
        isStraight = true;
        straightHigh = uniqueRanks[0];
      } else if (
        uniqueRanks[0] === 14 &&
        uniqueRanks[1] === 5 &&
        uniqueRanks[2] === 4 &&
        uniqueRanks[3] === 3 &&
        uniqueRanks[4] === 2
      ) {
        isStraight = true;
        straightHigh = 5;
      }
    }

    const groups = Array.from(counts.entries())
      .sort((a, b) => (b[1] - a[1]) || (b[0] - a[0]));

    const groupCounts = groups.map(g => g[1]);
    const groupRanks = groups.map(g => g[0]);

    if (isFlush && isStraight) {
      return {
        category: 8,
        name: straightHigh === 14 ? "ロイヤルストレートフラッシュ" : "ストレートフラッシュ",
        ranks: [8, straightHigh]
      };
    }
    if (groupCounts[0] === 4) {
      return { category: 7, name: "フォーカード", ranks: [7, ...groupRanks] };
    }
    if (groupCounts[0] === 3 && groupCounts[1] === 2) {
      return { category: 6, name: "フルハウス", ranks: [6, ...groupRanks] };
    }
    if (isFlush) {
      return { category: 5, name: "フラッシュ", ranks: [5, ...sortedRanks] };
    }
    if (isStraight) {
      return { category: 4, name: "ストレート", ranks: [4, straightHigh] };
    }
    if (groupCounts[0] === 3) {
      return { category: 3, name: "スリーカード", ranks: [3, ...groupRanks] };
    }
    if (groupCounts[0] === 2 && groupCounts[1] === 2) {
      return { category: 2, name: "ツーペア", ranks: [2, ...groupRanks] };
    }
    if (groupCounts[0] === 2) {
      return { category: 1, name: "ワンペア", ranks: [1, ...groupRanks] };
    }
    return { category: 0, name: "ハイカード", ranks: [0, ...sortedRanks] };
  }

  function comparePokerHands(handA, handB) {
    const evalA = evaluatePokerHand(handA);
    const evalB = evaluatePokerHand(handB);
    const len = Math.max(evalA.ranks.length, evalB.ranks.length);
    for (let i = 0; i < len; i++) {
      const a = evalA.ranks[i] || 0;
      const b = evalB.ranks[i] || 0;
      if (a !== b) return a > b ? 1 : -1;
    }
    return 0;
  }

  globalThis.CardUtils = {
    SUITS,
    SUIT_MAP,
    RANKS,
    createDeck,
    shuffle,
    formatCardText,
    formatCardsList,
    createCardElement,
    evaluatePokerHand,
    comparePokerHands
  };
})();
