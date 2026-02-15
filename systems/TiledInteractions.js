import { addHelp, addItem, addScore, disableInteraction, incrementInteractionCount, isInteractionDisabled, markHelped, removeItem, setLayerHidden, GameState } from "./GameState.js";

import { parseProps, splitCsv } from "./TiledProps.js";

const TILE = 16;

function clampInt(n, min, max) {
  const x = Number.isFinite(Number(n)) ? Number(n) : 0;
  return Math.max(min, Math.min(max, Math.trunc(x)));
}


function objCenter(o) {
  if (!o) return null;
  const w = o.width ?? 0;
  const h = o.height ?? 0;
  if (o.point === true || (w <= 0 && h <= 0)) return { x: o.x ?? 0, y: o.y ?? 0 };
  return { x: (o.x ?? 0) + w / 2, y: (o.y ?? 0) + h / 2 };
}

function findObjectLayerInTiledJson(layers, layerName) {
  const want = String(layerName ?? "").trim();
  if (!want || !Array.isArray(layers)) return null;

  for (const layer of layers) {
    if (!layer) continue;
    if (layer.type === "objectgroup" && String(layer.name ?? "").trim() === want) return layer;

    if (Array.isArray(layer.layers)) {
      const found = findObjectLayerInTiledJson(layer.layers, want);
      if (found) return found;
    }
  }

  return null;
}




function flagKey(...parts) {
  return parts.filter(Boolean).join("|");
}

function tileRemovedFlag(sceneKey, id) {
  return flagKey("__tile_removed", sceneKey, id);
}

function takeOnceFlag(sceneKey, id, item) {
  return flagKey("__take_once", sceneKey, id, item);
}

function getAnyFlag(GameState, k) {
  return GameState.flags?.[k];
}

function setAnyFlag(GameState, k, v) {
  if (!GameState.flags) GameState.flags = {};
  GameState.flags[k] = v;
}

function removeTileAtWorld(scene, worldX, worldY, layerName) {
  if (!layerName) return;
  const layer = scene.layers?.[layerName];
  if (!layer) return;

  const tileX = Math.floor(worldX / TILE);
  const tileY = Math.floor(worldY / TILE);
  layer.removeTileAt(tileX, tileY);
}

/**
 * Gets objects from an object layer name.
 * BaseExploreScene already has map; we access Tiled JSON for group support.
 */
export function getObjectLayerObjects(scene, layerName) {
  const json = scene.map?.tilemapLayer?.tilemap?.map?.json;
  const tiledJson = scene.map?.tilemapLayer?.tilemap?.map?.format?.data ?? scene.map?.data ?? json ?? null;

  const layers = tiledJson?.layers ?? scene.map?.map?.layers ?? null;
  const layer = findObjectLayerInTiledJson(layers, layerName);
  if (!layer) return [];
  return Array.isArray(layer.objects) ? layer.objects : [];
}

/**
 * Registers interactables from a named object layer.
 * Adds bounds/center to support triggers.
 */
export function registerTiledInteractions(scene, layerName) {
  const objects = getObjectLayerObjects(scene, layerName);
  if (!objects.length) return;

  for (const obj of objects) {
    const props = parseProps(obj);
    const id = String(props.id ?? obj.name ?? "").trim();
    if (!id) continue;

    const center = objCenter(obj);
    if (!center) continue;

    const prompt = String(props.prompt ?? "Interact").trim();

    const maxDist = Number(props.maxdist ?? 22);
    const lookMaxDist = Number(props.lookmaxdist ?? 44);
    const lookMinDot = Number(props.lookmindot ?? 0.65);

    scene.interactables.push({
      id,
      kind: String(props.kind ?? "").trim(),
      _tiledObj: obj,
      x: Number(obj.x ?? 0),
      y: Number(obj.y ?? 0),
      w: Number(obj.width ?? 0),
      h: Number(obj.height ?? 0),
      center,
      getPos: () => ({ x: center.x, y: center.y }),
      isEnabled: () => !isInteractionDisabled(id),
      maxDist,
      lookMaxDist,
      lookMinDot,
      prompt,
      action: () => runTiledInteraction(scene, obj),
    });
  }
}

/**
 * Re-applies persisted tile removals so removed tiles stay removed.
 */
export function reapplyPersistedTileRemovals(scene, GameState, interactLayerName) {
  const objects = getObjectLayerObjects(scene, interactLayerName);
  if (!objects.length) return;

  for (const obj of objects) {
    const props = parseProps(obj);
    const id = String(props.id ?? obj.name ?? "").trim();
    if (!id) continue;

    const removedKey = tileRemovedFlag(scene.scene.key, id);
    if (getAnyFlag(GameState, removedKey) !== true) continue;

    const c = objCenter(obj);
    if (!c) continue;

    const targetLayer = String(props.tileremovelayer ?? "").trim();
    removeTileAtWorld(scene, c.x, c.y, targetLayer);

    disableInteraction(id);
    scene.interactables = scene.interactables.filter((it) => it.id !== id);
  }
}

function removeColliderById(scene, id) {
  const key = String(id ?? "").trim();
  if (!key) return;

  // Prefer scene's own implementation (handles persistence + groups + Map storage)
  if (typeof scene?._removeColliderById === "function") {
    scene._removeColliderById(key);
    return;
  }

  const byId = scene?._colliderById;
  const c = byId?.get?.(key) ?? byId?.[key] ?? null;
  if (!c) return;

  try {
    c.destroy?.();
  } catch {
    // ignore
  }
  if (byId?.delete) byId.delete(key);
  else if (byId) delete byId[key];
}

function applyChoiceEffects(scene, id, props, choiceN) {
  for (const lname of splitCsv(props[`choice${choiceN}hidelayer`] ?? props[`choice${choiceN}hidelayers`])) {
    const layer = scene.layers?.[lname];
    layer?.setVisible?.(false);
    setLayerHidden(scene.scene.key, lname, true);
  }

  for (const lname of splitCsv(props[`choice${choiceN}showlayer`] ?? props[`choice${choiceN}showlayers`])) {
    const layer = scene.layers?.[lname];
    layer?.setVisible?.(true);
    setLayerHidden(scene.scene.key, lname, false);
  }

  for (const cid of splitCsv(props[`choice${choiceN}removecollider`] ?? props[`choice${choiceN}removecolliders`])) {
    removeColliderById(scene, cid);
  }

  const hs = props[`choice${choiceN}helpscore`];
  if (hs !== undefined) addHelp(Number(hs) || 0);

  const as = props[`choice${choiceN}addscore`];
  if (as !== undefined) addScore(Number(as) || 0);

  const helpedName = String(props[`choice${choiceN}markhelped`] ?? "").trim();
  if (helpedName) markHelped(helpedName, true);

  const postPrompt = String(props.postprompt ?? "").trim();
  if (postPrompt) {
    const it = scene.interactables.find((x) => x.id === id);
    if (it) it.prompt = postPrompt;
  }
}

function applyInteractionEffects(scene, GameState, id, props) {
  // tileRemoveLayer
  const tileRemoveLayer = String(props.tileremovelayer ?? "").trim();
  if (tileRemoveLayer) {
    const it = scene.interactables.find((x) => x.id === id);
    const c = it?.center ?? objCenter(it?._tiledObj);
    if (c) {
      removeTileAtWorld(scene, c.x, c.y, tileRemoveLayer);
      setAnyFlag(GameState, tileRemovedFlag(scene.scene.key, id), true);
    }
  }

  for (const lname of splitCsv(props.hidelayer ?? props.hidelayers)) {
    const layer = scene.layers?.[lname];
    layer?.setVisible?.(false);
    setLayerHidden(scene.scene.key, lname, true);
  }

  for (const lname of splitCsv(props.showlayer ?? props.showlayers)) {
    const layer = scene.layers?.[lname];
    layer?.setVisible?.(true);
    setLayerHidden(scene.scene.key, lname, false);
  }

  for (const item of splitCsv(props.giveitem)) addItem(item, 1);

  for (const item of splitCsv(props.giveitemonce)) {
    const k = flagKey("__give_once", scene.scene.key, id, item);
    if (getAnyFlag(GameState, k) === true) continue;
    addItem(item, 1);
    setAnyFlag(GameState, k, true);
  }

  for (const item of splitCsv(props.takeitemonce)) {
    const k = takeOnceFlag(scene.scene.key, id, item);
    if (getAnyFlag(GameState, k) === true) continue;
    removeItem(item, 1);
    setAnyFlag(GameState, k, true);
  }

  for (const item of splitCsv(props.takeitem)) removeItem(item, 1);

  for (const cid of splitCsv(props.removecollider ?? props.removecolliders)) removeColliderById(scene, cid);

  if (props.helpscore !== undefined) addHelp(Number(props.helpscore) || 0);
  if (props.addscore !== undefined) addScore(Number(props.addscore) || 0);

  const helpedName = String(props.markhelped ?? "").trim();
  if (helpedName) markHelped(helpedName, true);

  const removeIds = splitCsv(props.removeinteraction);
  if (removeIds.length) {
    for (const rid of removeIds) disableInteraction(rid);
  } else if (props.once === true) {
    disableInteraction(id);
  }

  if (props.once === true || removeIds.includes(id)) {
    scene.interactables = scene.interactables.filter((it) => it.id !== id);
  }
}

/**
 * Runs a Tiled interaction using scene.dialogue format (script).
 *
 * Supported custom props (core):
 *  - id, prompt, speaker
 *  - dialogue/dialogue2... OR choicePrompt + choice1Text etc
 *  - once, removeInteraction
 *  - tileRemoveLayer
 *  - hideLayers/showLayers
 *  - giveItem/giveItemOnce/takeItem/takeItemOnce
 *  - removeCollider/removeColliders
 *  - helpScore/addScore/markHelped
 *  - postPrompt/postDialogue...
 *  - requiresItem/requiresCount/denyDialogue
 */
export function runTiledInteraction(scene, obj) {
  const props = parseProps(obj);
  const id = String(props.id ?? obj.name ?? "").trim();
  if (!id) return;
  if (isInteractionDisabled(id)) return;

  // requires item
  if (props.requiresitem) {
    const item = String(props.requiresitem ?? "").trim();
    const count = Number(props.requirescount ?? 1);
    const inv = scene.GameState?.inventory?.[item] ?? 0;
    if (inv < count) {
      const deny = String(props.denydialogue ?? props.denydialogue1 ?? "").trim();
      if (deny) scene.dialogue?.start?.([{ type: "say", speaker: String(props.speaker ?? ""), text: deny }, { type: "end" }], scene.keys);
      return;
    }
  }

  const choicePrompt = String(props.choiceprompt ?? "").trim();
  const choice1Text = String(props.choice1text ?? "").trim();

  if (choicePrompt && choice1Text) {
    // Defer to scene’s existing choice handler if I got one
    if (typeof scene._runChoiceInteraction === "function") {
      scene._runChoiceInteraction(id, props);
      return;
    }

    // Minimal fallback choice runner (2-4 choices)
    const options = [];
    for (let i = 1; i <= 4; i += 1) {
      const t = String(props[`choice${i}text`] ?? "").trim();
      if (t) options.push({ i, text: t });
    }
    if (!options.length) return;

    scene.dialogue?.start?.(
      [
        { type: "choice", prompt: choicePrompt, options: options.map((o) => ({ text: o.text })) },
        { type: "end" },
      ],
      scene.keys,
      (choiceIndex) => {
        const c = options[choiceIndex];
        if (!c) return;
        const d = String(props[`choice${c.i}dialogue`] ?? "").trim();
        if (d) {
          scene.dialogue?.start?.([{ type: "say", speaker: String(props.speaker ?? ""), text: d }, { type: "end" }], scene.keys, () =>
            applyChoiceEffects(scene, id, props, c.i)
          );
        } else {
          applyChoiceEffects(scene, id, props, c.i);
        }
      }
    );

    return;
  }

  // normal dialogue keys
  const keys = typeof scene._getNumberedKeys === "function" ? scene._getNumberedKeys(props, "dialogue") : [];
  const endN = keys.length ? clampInt(props.enddialogue ?? keys.length, 1, keys.length) : 0;

  if (!keys.length || props.nodialogue === true) {
    applyInteractionEffects(scene, scene.GameState ?? GameState, id, props);
    return;
  }

  const speaker = String(props.speaker ?? "").trim();
  const text = String(props.dialogue ?? "").trim();

  scene.dialogue?.start?.([{ type: "say", speaker, text }, { type: "end" }], scene.keys, () =>
    applyInteractionEffects(scene, scene.GameState ?? GameState, id, props)
  );
}


// ---------------------------------------------------------------------------
// Follower-trigger dialogue helpers
//
// These helpers are used by BaseExploreScene to inject follower-only dialogue
// based on the current follower party (Aloise / Saga / both).
//
// IMPORTANT (per project decision): if follower dialogue exists for the current
// party, it REPLACES the main dialogue line(s) for that interaction.
// ---------------------------------------------------------------------------

function _truthy(v) {
  return v === true || String(v ?? "").toLowerCase() === "true" || v === 1 || v === "1";
}

function _getFollowerStateFromGameState(gs) {
  const flags = gs?.flags ?? {};
  const aloise = _truthy(flags.aloiseFollowing) || _truthy(flags.aloiseJoined);
  const saga = _truthy(flags.sagaJoined) || _truthy(flags.sagaFollowing);
  return { aloise, saga, both: aloise && saga, any: aloise || saga };
}

function _getNumberedPropLines(props, baseKey) {
  const out = [];
  const k0 = String(baseKey ?? "").trim().toLowerCase();
  if (!k0) return out;

  const v0 = props?.[k0];
  if (v0 !== undefined && String(v0).trim()) out.push(String(v0).trim());

  for (let i = 2; i <= 50; i += 1) {
    const k = `${k0}${i}`;
    if (!(k in (props ?? {}))) break;
    const v = props?.[k];
    if (v !== undefined && String(v).trim()) out.push(String(v).trim());
  }
  return out;
}

function _parseSpeakerInline(line, defaultSpeaker = "") {
  const s = String(line ?? "").trim();
  if (!s) return { speaker: defaultSpeaker, text: "" };
  const idx = s.indexOf(":");
  if (idx <= 0) return { speaker: defaultSpeaker, text: s };
  return { speaker: s.slice(0, idx).trim(), text: s.slice(idx + 1).trim() };
}

function _selectFollowerBaseKey(gs, props, basePrefix = "followdialogue") {
  const f = _getFollowerStateFromGameState(gs);

  const base = String(basePrefix ?? "followdialogue").trim().toLowerCase() || "followdialogue";

  // Only replace when at least one follower is present.
  if (!f.any) return { baseKey: "", f };

  // Strict both-followers selection first.
  const bothKey = `bothfollowers${base}`;
  const sagaKey = `sagafollower${base}`;
  const aloiseKey = `aloisefollower${base}`;

  if (f.both && _getNumberedPropLines(props, bothKey).length) return { baseKey: bothKey, f };
  if (f.saga && _getNumberedPropLines(props, sagaKey).length) return { baseKey: sagaKey, f };
  if (f.aloise && _getNumberedPropLines(props, aloiseKey).length) return { baseKey: aloiseKey, f };

  // Fallback to generic followdialogue*
  if (_getNumberedPropLines(props, base).length) return { baseKey: base, f };

  return { baseKey: "", f };
}

export function hasFollowerDialogueProps(props) {
  if (!props) return false;
  const keys = Object.keys(props);
  for (const k of keys) {
    const key = String(k).toLowerCase();
    if (key === "followdialogue" || key.startsWith("followdialogue")) return true;
    if (key.startsWith("aloisefollowerfollowdialogue")) return true;
    if (key.startsWith("sagafollowerfollowdialogue")) return true;
    if (key.startsWith("bothfollowersfollowdialogue")) return true;
    if (key === "followpausems") return true;
  }
  return false;
}

/**
 * Injects follower dialogue into an existing script.
 *
 * By default, follower dialogue REPLACES the script (per project decision).
 * Pass { replaceMain: false } to append instead.
 *
 * @param {Phaser.Scene} scene
 * @param {object} props parsed Tiled props (lowercased keys)
 * @param {Array<object>} script dialogue script array
 * @param {object} opts { basePrefix?: "followdialogue", replaceMain?: boolean }
 */
export function appendFollowerDialogue(scene, props, script, opts = {}) {
  if (!Array.isArray(script)) return;

  const gs = scene?.GameState ?? GameState;
  const basePrefix = opts.basePrefix ?? "followdialogue";
  const { baseKey, f } = _selectFollowerBaseKey(gs, props, basePrefix);

  const debug =
    props?.debugfollowdialogue === true ||
    String(props?.debugfollowdialogue ?? "").toLowerCase() === "true" ||
    gs?.flags?.debugFollowDialogue === true ||
    String(gs?.flags?.debugFollowDialogue ?? "").toLowerCase?.() === "true";

  if (debug) {
    console.log("[followDialogue] state:", f, "baseKey:", baseKey, "propsKeys:", Object.keys(props || {}));
  }

  if (!baseKey) return;

  const lines = _getNumberedPropLines(props, baseKey);
  if (!lines.length) return;

  const pauseMs = clampInt(props.followpausems ?? 250, 0, 5000);
  const replaceMain = opts.replaceMain !== false; // default true

  const out = [];
  if (!replaceMain) {
    // append mode: add pause then lines
    if (pauseMs > 0) out.push({ type: "pause", ms: pauseMs });
    const defaultSpeaker = String(props?.speaker ?? "").trim();
    for (const ln of lines) {
      const { speaker, text } = _parseSpeakerInline(ln, defaultSpeaker);
      if (!text) continue;
      out.push({ type: "say", speaker, text });
    }
    script.push(...out);
    return;
  }

  // replace mode: discard main dialogue and show follower dialogue only
  script.length = 0;

  if (pauseMs > 0) script.push({ type: "pause", ms: pauseMs });

  const defaultSpeaker = String(props?.speaker ?? "").trim();
  for (const ln of lines) {
    const { speaker, text } = _parseSpeakerInline(ln, defaultSpeaker);
    if (!text) continue;
    script.push({ type: "say", speaker, text });
  }
}
