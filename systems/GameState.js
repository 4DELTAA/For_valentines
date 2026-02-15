// systems/GameState.js
export const GameState = {
  score: 0,

  helpScore: 0,

  // Old "progress counter" time (used by some HUDs / logic)
  timePassed: 0,

  // NEW: real-life global time (ms) across the whole play session.
  realTimeMs: 0,

  transition: { fromScene: null, toScene: null, fromExit: null },

  // Global interaction gate (cooldown timer only)
  input: {
    interactLockUntil: 0,
    // kept for compatibility, but I'm not using anymore
    requireInteractKeyUp: false,
  },

  inventory: {},

  interactions: {
    counts: {}, // id -> number
    disabled: {}, // id -> true
    choices: {}, // id -> last chosen option (number)
  },

  hiddenLayers: {},

  flags: {
    hasHairpin: false,

    sagaPath: null,
    sagaJoined: false,

    gladOutcome: null,

    aloiseFollowing: false,
    aloiseParty: false,
    aloiseForestIntroShown: false,

    minesweeperCleared: false,
    minesweeperBoardCleared: false,
  },

  sceneProgress: {
    CityScene: false,
    ForestScene: false,
    LibraryScene: false,
  },

  forest: {
    strawberriesInitialized: false,
    strawberryPositions: [],
  },

  npcsHelped: {},
};

// -------------------------
// Inventory
// -------------------------

export function addItem(item, count = 1) {
  const k = String(item ?? "").trim();
  if (!k) return;
  GameState.inventory[k] = (GameState.inventory[k] ?? 0) + (count ?? 1);
}

export function removeItem(item, count = 1) {
  const k = String(item ?? "").trim();
  if (!k) return;
  GameState.inventory[k] = Math.max(0, (GameState.inventory[k] ?? 0) - (count ?? 1));
}

export function hasItem(item, count = 1) {
  const k = String(item ?? "").trim();
  if (!k) return false;
  return (GameState.inventory[k] ?? 0) >= (count ?? 1);
}

// -------------------------
// Interaction state
// -------------------------

export function incrementInteractionCount(id) {
  const k = String(id ?? "").trim();
  if (!k) return 0;
  GameState.interactions.counts[k] = (GameState.interactions.counts[k] ?? 0) + 1;
  return GameState.interactions.counts[k];
}

export function disableInteraction(id) {
  const k = String(id ?? "").trim();
  if (!k) return;
  GameState.interactions.disabled[k] = true;
}

export function isInteractionDisabled(id) {
  const k = String(id ?? "").trim();
  if (!k) return false;
  return GameState.interactions.disabled[k] === true;
}


export function setInteractionChoice(id, choice) {
  const k = String(id ?? "").trim();
  const c = Number(choice);
  if (!k) return;
  if (!Number.isFinite(c) || c <= 0) return;
  GameState.interactions.choices[k] = Math.trunc(c);
}

export function getInteractionChoice(id) {
  const k = String(id ?? "").trim();
  if (!k) return null;
  const c = GameState.interactions.choices[k];
  return Number.isFinite(Number(c)) ? Number(c) : null;
}


// -------------------------
// Layers persistence
// -------------------------

export function setLayerHidden(sceneKey, layerName, hidden) {
  const sk = String(sceneKey ?? "").trim();
  const ln = String(layerName ?? "").trim();
  if (!sk || !ln) return;

  GameState.hiddenLayers[sk] = GameState.hiddenLayers[sk] ?? {};
  GameState.hiddenLayers[sk][ln] = !!hidden;
}

export function isLayerHidden(sceneKey, layerName) {
  const sk = String(sceneKey ?? "").trim();
  const ln = String(layerName ?? "").trim();
  if (!sk || !ln) return false;
  return GameState.hiddenLayers?.[sk]?.[ln] === true;
}

// -------------------------
// NPC help / scoring
// -------------------------

export function addHelp(n = 1) {
  GameState.helpScore += Number(n) || 0;
}

export function addScore(n = 1) {
  GameState.score += Number(n) || 0;
}

export function markHelped(npcName, value = true) {
  const k = String(npcName ?? "").trim();
  if (!k) return;
  GameState.npcsHelped[k] = value;
}

export function isHelped(npcName) {
  return !!GameState.npcsHelped[String(npcName ?? "").trim()];
}

// -------------------------
// Scene progress + transitions
// -------------------------

export function setTransition(fromScene, toScene, fromExit) {
  GameState.transition = { fromScene, toScene, fromExit };
}

export function markSceneProgress(sceneKey) {
  if (sceneKey in GameState.sceneProgress) GameState.sceneProgress[sceneKey] = true;
}

export function onLeaveScene(sceneKey) {
  if (sceneKey in GameState.sceneProgress) {
    if (!GameState.sceneProgress[sceneKey]) GameState.timePassed += 1;
    GameState.sceneProgress[sceneKey] = false;
  }
}

// -------------------------
// True ending readiness (for Minesweeper / EpilogueTrueScene)
// -------------------------

export function isTrueReady() {
  const inv = GameState.inventory ?? {};
  const flags = GameState.flags ?? {};

  const hasHairRibbon =
    !!flags.hasHairpin || (Number(inv.hairribbon ?? inv.hairRibbon ?? inv.HairRibbon ?? 0) > 0);

  const hasLoveLetter =
    Number(inv.loveletter ?? inv.loveLetter ?? inv.LoveLetter ?? inv.Loveletter ?? 0) > 0;

  const hasMinesweeperClear = !!flags.minesweeperBoardCleared;
  const enoughHelp = Number(GameState.helpScore ?? 0) >= 88;

  return hasHairRibbon && hasLoveLetter && hasMinesweeperClear && enoughHelp;
}



// -------------------------
// World-ending condition (NEW: real-time based)
// -------------------------

export const WORLD_END_MS = 8 * 60 * 1000; // 8 minutes

export function isWorldEnding() {
  return (GameState.realTimeMs ?? 0) >= WORLD_END_MS;
}

/**
 * Cooldown-only lock. No key-up gate.
 */
export function lockInteract(scene, ms = 220) {
  const now = scene?.time?.now ?? performance.now();
  GameState.input.interactLockUntil = Math.max(GameState.input.interactLockUntil, now + ms);
}

export function canWorldInteract(scene) {
  const now = scene?.time?.now ?? performance.now();
  return now >= (GameState.input.interactLockUntil ?? 0);
}
// --- Flags helpers (restore for existing scenes) ---
export function setFlag(name, value = true) {
  const k = String(name ?? "").trim();
  if (!k) return;
  GameState.flags = GameState.flags ?? {};
  GameState.flags[k] = value;
}

export function getFlag(name, fallback = undefined) {
  const k = String(name ?? "").trim();
  if (!k) return fallback;
  return GameState.flags?.[k] ?? fallback;
}

