(() => {
  "use strict";

  const games = new Map();
  const order = [];

  function register(gameDef) {
    if (!gameDef || !gameDef.id) {
      throw new Error("Game definition must include an id");
    }
    if (!games.has(gameDef.id)) {
      order.push(gameDef.id);
    }
    games.set(gameDef.id, gameDef);
  }

  function get(id) {
    return games.get(id) || null;
  }

  function list() {
    return order.map(id => games.get(id));
  }

  function has(id) {
    return games.has(id);
  }

  globalThis.GameRegistry = {
    register,
    get,
    list,
    has
  };
})();
