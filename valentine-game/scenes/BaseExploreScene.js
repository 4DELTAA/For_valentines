import DialogueBox from "../systems/DialogueBox.js";
import { ensureCharacterAnims, playCharacterAnim, lookAtPlayerIfClose } from "../systems/CharacterAnims.js";
import { ASSETS } from "../systems/Assets.js";
import {
  GameState,
  canWorldInteract,
  addItem,
  hasItem,
  removeItem,
  incrementInteractionCount,
  disableInteraction,
  isInteractionDisabled,
  setLayerHidden,
  isLayerHidden,
  markHelped,
  isHelped,
  addHelp,
  addScore,
} from "../systems/GameState.js";


import { parseProps, splitCsv } from "../systems/TiledProps.js";
import { appendFollowerDialogue, hasFollowerDialogueProps } from "../systems/TiledInteractions.js";
import { updateAutoTriggerZones } from "../systems/AutoTriggerZones.js";

export const DEPTH = Object.freeze({
  TILE_BELOW_PLAYER_MIN: 0,
  PLAYER: 1000,
  TILE_OVER_PLAYER_MIN: 2000,
  WORLD_TEXT: 3000,
  UI: 10000,
});

function objCenter(o) {
  if (!o) return null;
  const w = o.width ?? 0;
  const h = o.height ?? 0;
  if (o.point === true || (w <= 0 && h <= 0)) return { x: o.x ?? 0, y: o.y ?? 0 };
  return { x: (o.x ?? 0) + w / 2, y: (o.y ?? 0) + h / 2 };
}

function clampInt(n, min, max) {
  const x = Number.isFinite(Number(n)) ? Number(n) : 0;
  return Math.max(min, Math.min(max, Math.trunc(x)));
}

function clamp01(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function findObjectLayerInTiledJson(layers, targetName) {
  for (const layer of layers ?? []) {
    if (!layer) continue;
    if (layer.type === "objectgroup" && layer.name === targetName) return layer;
    if (layer.type === "group" && Array.isArray(layer.layers)) {
      const found = findObjectLayerInTiledJson(layer.layers, targetName);
      if (found) return found;
    }
  }
  return null;
}

function pointInRect(px, py, rectCenterX, rectCenterY, w, h) {
  const x0 = rectCenterX - w / 2;
  const y0 = rectCenterY - h / 2;
  const x1 = x0 + w;
  const y1 = y0 + h;
  return px >= x0 && px <= x1 && py >= y0 && py <= y1;
}

export default class BaseExploreScene extends Phaser.Scene {
  constructor(key) {
    super(key);

    this._prevPlayerPos = null;
    this._denyCooldownUntil = 0;

    this._playerAnimPrefix = "player";
    this._playerFacing = "down";

    // Music ducking during interactions (stacked)
    this._musicDuckStack = [];
    this._musicDuckOriginal = new Map(); // Phaser.Sound.BaseSound -> originalVolume

    // Scene BGM (owned by this scene)
    this._sceneMusic = null;
    this._sceneMusicKey = "";

    // Ambience zones (looping while inside) (owned by this scene)
    this._ambienceByZoneId = new Map(); // id -> Phaser.Sound.BaseSound

    // Followers / trail
    this.playerTrail = [];
    this.TRAIL_MAX = 300;
    this.TRAIL_STEP = 20;
    this.TRAIL_PUSH_MIN_DIST = 1;
    this.FOLLOWER_FALLBACK_SPACING = 12;
    this.FOLLOWER_SPRITE_SCALE = 1;
    this.NPC_SPRITE_SCALE = 1;

    this.followers = [];
    this.lastTrailX = 0;
    this.lastTrailY = 0;

    // NPC look-at behavior
    this.NPC_LOOK_RADIUS_DEFAULT = 48;
    this._npcsToFacePlayer = [];

    // Scenes can register spawned NPCs here (for removal after becoming follower)
    this._spawnedNpcsById = new Map(); // npcId -> npc object {rect,label,...}

    // Interact
    this.currentInteractable = null;
    this.interactables = [];
    this.facing = new Phaser.Math.Vector2(0, 1);

    // Trigger state (used by AutoTriggerZones.js)
    this._triggerInside = new Set();
    this._triggerExitArmed = new Set();

    // Tilemap
    this.map = null;
    this.layers = {};
    this.collisionLayers = [];
    this.objectColliders = null;
    this._colliderById = new Map();

    // Tiled objects (top-level cache)
    this.tiledObjects = {};

    // TilePicker
    this.activeTilesetKey = null;
    this.pickHintText = null;

    // Layer rules
    this._overPlayerLayerNames = new Set();
    this._roofLayerNames = new Set();

    // FX stacking
    this._shakeEndAt = 0;

    // Map key for cache lookup
    this._mapKey = null;

    // Input
    this.keys = null;
    this.cursors = null;

    // Choice pending effects
    this._pendingChoiceEffect = null;

    // Optional debug overlay
    this.debugText = null;
  
  }

// -------------------------
// Text styling (fonts / readability)
// -------------------------

_fontFamily() {
  return "GameFont, Verdana, Arial, sans-serif";
}

_uiTextStyle(overrides = {}) {
  return {
    fontFamily: this._fontFamily(),
    fontSize: "11px",
    color: "#ffffff",
    stroke: "#000000",
    strokeThickness: 3,
    shadow: { offsetX: 1, offsetY: 1, color: "#000000", blur: 0, fill: true },
    ...overrides,
  };
}

_hudTextStyle(overrides = {}) {
  return this._uiTextStyle({ fontSize: "10px", color: "#d0d0d0", ...overrides });
}

_worldLabelStyle(color = "#e0e0e0", overrides = {}) {
  return {
    fontFamily: this._fontFamily(),
    fontSize: "10px",
    color,
    stroke: "#000000",
    strokeThickness: 3,
    shadow: { offsetX: 1, offsetY: 1, color: "#000000", blur: 0, fill: true },
    ...overrides,
  };
}

_parseCssColor(v, fallback) {
  const s = String(v ?? "").trim();
  if (!s) return fallback;
  // Accept "#RRGGBB", "#RGB", "rgb(...)" or named colors.
  return s;
}

_getNpcLabelPropsByName(displayName) {
  // Convention: Points objects often named npc_<lowername> (e.g. npc_aloise).
  const n = String(displayName ?? "").trim().toLowerCase();
  if (!n) return null;

  const candidates = [`npc_${n}`, n, displayName];
  const layers = ["Points", "NPCs", "Interactables"];

  for (const layerName of layers) {
    const arr = this.tiledObjects?.[layerName] ?? [];
    for (const obj of arr) {
      const on = String(obj?.name ?? "").trim();
      if (!on) continue;
      if (!candidates.some((c) => c.toLowerCase() === on.toLowerCase())) continue;
      try {
        const p = parseProps(obj);
        return p ?? null;
      } catch (_) {
        return null;
      }
    }
  }
  return null;
}

  // -------------------------
  // Internal persistence helpers
  // -------------------------

  _flagKey(prefix, ...parts) {
    return `${prefix}__${parts.map((p) => String(p)).join("__")}`;
  }

  _getAnyFlag(key) {
    return GameState.flags?.[key];
  }

  _setAnyFlag(key, value) {
    if (!GameState.flags) GameState.flags = {};
    GameState.flags[key] = value;
  }

  _layerInitFlag(sceneKey, layerName) {
    return this._flagKey("__layer_init", sceneKey, layerName);
  }

  _tileRemovedFlag(sceneKey, id) {
    return this._flagKey("__tile_removed", sceneKey, id);
  }

  _colliderRemovedFlag(sceneKey, colliderId) {
    return this._flagKey("__collider_removed", sceneKey, colliderId);
  }

  _takeOnceFlag(sceneKey, id, item) {
    return this._flagKey("__take_once", sceneKey, id, item);
  }

  // -------------------------
  // NPC transform persistence (used by choice effects)
  // -------------------------

  _npcFlipYFlag(sceneKey, npcId) {
    return this._flagKey("__npcFlipY", sceneKey, String(npcId ?? "").trim().toLowerCase());
  }

  _getSpawnedNpcByIdCaseInsensitive(npcId) {
    const want = String(npcId ?? "").trim().toLowerCase();
    if (!want) return null;

    const direct = this._spawnedNpcsById?.get?.(npcId);
    if (direct) return direct;

    for (const [k, v] of this._spawnedNpcsById?.entries?.() ?? []) {
      if (String(k ?? "").trim().toLowerCase() === want) return v;
    }
    return null;
  }

  _applyNpcFlipY(npcObj, flipped) {
    const spr = npcObj?.rect;
    if (!spr || !npcObj?.isSprite) return false;

    const sx = Number(spr.scaleX ?? 1) || 1;
    const sy = Number(spr.scaleY ?? 1) || 1;
    const absY = Math.abs(sy) || 1;

    spr.setScale(sx, flipped ? -absY : absY);
    return true;
  }

  _reapplyNpcTransforms(npcId, npcObj) {
    const id = String(npcId ?? "").trim();
    if (!id || !npcObj) return;

    const rect = npcObj.rect ?? npcObj;
    if (!rect) return;

    const posKey = this._flagKey("__npc_pos", this.scene.key, id);
    const pos = this._getAnyFlag(posKey);
    if (pos && typeof pos === "object") {
      const x = Number(pos.x);
      const y = Number(pos.y);
      if (Number.isFinite(x) && Number.isFinite(y)) {
        rect.setPosition?.(x, y);
        try {
          npcObj.label?.setPosition?.(x + (npcObj.labelOffset?.x ?? -10), y + (npcObj.labelOffset?.y ?? 10));
        } catch (_) {}
      }
    }

    const flipKey = this._npcFlipYFlag(this.scene.key, id);
    const flip = this._getAnyFlag(flipKey) === true;
    if (flip) this._applyNpcFlipY(npcObj, true);
  }


  // -------------------------
  // Scene audio lifecycle (IMPORTANT FIX)
  // -------------------------

  _hookAudioLifecycle() {
    if (!this._audioCleanupFn) {
      this._audioCleanupFn = () => {
        this.stopSceneMusic();

        for (const snd of this._ambienceByZoneId.values()) {
          try {
            snd.stop?.();
            snd.destroy?.();
          } catch (_) {}
        }
        this._ambienceByZoneId.clear();

        if (this._zoneAudioById && typeof this._zoneAudioById.values === "function") {
          for (const snd of this._zoneAudioById.values()) {
            try {
              snd.stop?.();
              snd.destroy?.();
            } catch (_) {}
          }
          try {
            this._zoneAudioById.clear?.();
          } catch (_) {}
        }

        try {
          this._musicDuckStack.length = 0;
          this._applyMusicDuck(1);
        } catch (_) {}

        const sounds = this.sound?.sounds ?? [];
        for (const snd of sounds) {
          if (snd?.__sceneOwned === true) {
            try {
              snd.stop?.();
              snd.destroy?.();
            } catch (_) {}
          }
        }
      };
    }

    // Critical: re-attach for every shutdown cycle (scenes are reused)
    this.events.off(Phaser.Scenes.Events.SHUTDOWN, this._audioCleanupFn);
    this.events.on(Phaser.Scenes.Events.SHUTDOWN, this._audioCleanupFn);

    this.events.off(Phaser.Scenes.Events.DESTROY, this._audioCleanupFn);
    this.events.on(Phaser.Scenes.Events.DESTROY, this._audioCleanupFn);
  }

  // -------------------------
  // Base create
  // -------------------------

  baseCreate({ title, spawnX, spawnY, tiled = null, playerBody = { w: 10, h: 10, ox: 3, oy: 6 }, cameraZoom = 1.0 }) {
    // Hook audio cleanup early so even early-started music gets stopped.
    this._hookAudioLifecycle();
    this._hookNpcPersistenceLifecycle();

    this.cameras.main.setBackgroundColor("#0a0a0a");

    if (tiled?.mapKey) this._buildFromTiled(tiled);

    // Player
    this.player = this.physics.add.sprite(spawnX, spawnY, "player", 1); // frame 1 = idle col in many sheets
    this.player.setDepth(DEPTH.PLAYER);
    this.player.body.setCollideWorldBounds(true);

    if (playerBody && this.player.body) {
      this.player.body.setSize(playerBody.w, playerBody.h);
      this.player.body.setOffset(playerBody.ox, playerBody.oy);
    }

    // Player animations (requires spritesheet key "player" loaded in BootScene)
    this._playerAnimPrefix = "player";
    this._playerFacing = "down";
    ensureCharacterAnims(this, "player", { prefix: this._playerAnimPrefix, idleOnly: false, directions: 4 });
    playCharacterAnim(this.player, this._playerAnimPrefix, this._playerFacing, false);

    // Bounds + follow + collisions
    if (this.map) {
      this.physics.world.setBounds(0, 0, this.map.widthInPixels, this.map.heightInPixels);
      this.cameras.main.setBounds(0, 0, this.map.widthInPixels, this.map.heightInPixels);
      this.cameras.main.startFollow(this.player, true, 0.15, 0.15);
      this.cameras.main.setZoom(Number(cameraZoom) || 1);

      for (const layer of this.collisionLayers) this.physics.add.collider(this.player, layer);
      if (this.objectColliders) this.physics.add.collider(this.player, this.objectColliders);
    }

    // Keys
    this.keys = this.input.keyboard.addKeys({
      up: "W",
      down: "S",
      left: "A",
      right: "D",
      interact: "Z",
      pick: "P",
    });
    this.cursors = this.input.keyboard.createCursorKeys();
    this.facing = new Phaser.Math.Vector2(0, 1);

    // UI
    this.add.text(10, 10, title, this._uiTextStyle({ fontSize: "12px" })).setScrollFactor(0).setDepth(DEPTH.UI);
    this.hudText = this.add.text(10, 26, "", this._hudTextStyle()).setScrollFactor(0).setDepth(DEPTH.UI);
    this.hintText = this.add.text(10, 40, "", this._hudTextStyle({ color: "#b0b0b0" })).setScrollFactor(0).setDepth(DEPTH.UI);
    this.promptText = this.add.text(10, 170, "", this._uiTextStyle({ fontSize: "12px" })).setScrollFactor(0).setDepth(DEPTH.UI);

    // Optional debug overlay (you had this)
    this.debugText = this.add.text(10, 54, "", this._hudTextStyle({ color: "#55ff55" })).setScrollFactor(0).setDepth(DEPTH.UI);

    this.pickHintText = this.add.text(260, 10, "", this._hudTextStyle({ color: "#c0c0c0" })).setScrollFactor(0).setDepth(DEPTH.UI);
    this._updatePickHint();

    // Dialogue
    this.dialogue = new DialogueBox(this, { width: 300, height: 70, typingSpeedMs: 18 });
    this._forceDialogueDepthTop();

    // Followers init
    this.playerTrail = [];
    this.lastTrailX = this.player.x;
    this.lastTrailY = this.player.y;
    this.followers = [];
    this.syncFollowersFromGameState();

    // Interactables
    this.interactables = [];
    const interactLayerName = tiled?.objectLayers?.interactables ?? "Interactables";
    this._registerTiledInteractions(interactLayerName);

    // Re-apply persisted tile removals + disable those interactions (strawberries etc)
    this._reapplyPersistedTileRemovals(interactLayerName);

    return this;
  }

  _forceDialogueDepthTop() {
    const d = this.dialogue;
    if (!d) return;
    const top = DEPTH.UI + 50;
    if (d.panel) d.panel.setDepth(top);
    if (d.speakerText) d.speakerText.setDepth(top + 1);
    if (d.bodyText) d.bodyText.setDepth(top + 1);
    if (d.choiceText) d.choiceText.setDepth(top + 1);
    if (d.choiceCursor) d.choiceCursor.setDepth(top + 2);
  }

  // -------------------------
  // Tilemap build + persistence
  // -------------------------

  _buildFromTiled(tiled) {
    const mapKey = tiled.mapKey;
    this._mapKey = mapKey;

    const map = this.make.tilemap({ key: mapKey });

    this._overPlayerLayerNames = new Set(tiled.overPlayerLayers ?? tiled.overlayLayers ?? []);
    this._roofLayerNames = new Set(tiled.roofLayers ?? ["roof", "Roof"]);

    // Tilesets
    const tilesets = [];
    for (const ts of tiled.tilesets ?? []) {
      const added = map.addTilesetImage(
        ts.name,
        ts.key,
        ts.tileW ?? map.tileWidth,
        ts.tileH ?? map.tileHeight,
        ts.margin ?? 0,
        ts.spacing ?? 0
      );
      if (added) tilesets.push(added);
      else console.warn(`[Tiled] Tileset name mismatch: "${ts.name}" not found in map.`);
    }

    this.layers = {};
    this.collisionLayers = [];
    this.objectColliders = null;
    this._colliderById = new Map();

    let belowCursor = DEPTH.TILE_BELOW_PLAYER_MIN;
    let overCursor = DEPTH.TILE_OVER_PLAYER_MIN;

    for (const layerInfo of map.layers ?? []) {
      const name = layerInfo.name;
      const layer = map.createLayer(name, tilesets, 0, 0);
      if (!layer) continue;

      // startHidden should apply ONLY once ever; afterwards use persisted hiddenLayers
      const lp = parseProps(layerInfo);
      const initKey = this._layerInitFlag(this.scene.key, name);
      const initDone = this._getAnyFlag(initKey) === true;

      if (!initDone && lp.starthidden === true) {
        layer.setVisible(false);
        setLayerHidden(this.scene.key, name, true);
      } else {
        layer.setVisible(!isLayerHidden(this.scene.key, name));
      }

      this._setAnyFlag(initKey, true);

      const isOver = this._overPlayerLayerNames.has(name);
      layer.setDepth(isOver ? overCursor++ : belowCursor++);

      this.layers[name] = layer;
    }

    // Cache top-level object layers
    this.tiledObjects = {};
    for (const og of map.objects ?? []) this.tiledObjects[og.name] = og.objects ?? [];

    // Colliders (group-safe)
    const colliderLayerName = tiled.objectLayers?.colliders;
    if (colliderLayerName) {
      const colliderObjects = this._getObjectLayerObjects(colliderLayerName);
      if (colliderObjects.length) {
        this.objectColliders = this.physics.add.staticGroup();

        for (const o of colliderObjects) {
          const w = o.width ?? 0;
          const h = o.height ?? 0;
          if (w <= 0 || h <= 0) continue;

          const cx = (o.x ?? 0) + w / 2;
          const cy = (o.y ?? 0) + h / 2;

          const r = this.add.rectangle(cx, cy, w, h, 0xffffff, 0);
          this.physics.add.existing(r, true);

          const body = r.body;
          body?.setSize?.(w, h);
          body?.updateFromGameObject?.();
          body?.refreshBody?.();

          // Allow collider lookup by object.name OR by object property "id"
          const op = parseProps(o);
          const oid = String(op.id ?? o.name ?? "").trim();
          if (oid) this._colliderById.set(oid, r);

          this.objectColliders.add(r);
        }
      }
    }

    this._reapplyPersistedColliderRemovals(colliderLayerName);

    for (const lname of tiled.collisionTileLayers ?? []) {
      const layer = this.layers[lname];
      if (!layer) continue;
      layer.setCollisionByExclusion([-1]);
      this.collisionLayers.push(layer);
    }

    this.map = map;
    if (tiled.setActiveTilesetKey) this.activeTilesetKey = tiled.setActiveTilesetKey;
  }

  // -------------------------
  // Object layer access (group-safe)
  // -------------------------

  _getObjectLayerObjects(layerName) {
    const top = this.map?.getObjectLayer?.(layerName);
    if (top?.objects?.length) return top.objects;

    const key = this._mapKey ?? this.map?.key;
    const cached = key ? this.cache.tilemap.get(key) : null;
    const data = cached?.data;
    const found = data ? findObjectLayerInTiledJson(data.layers, layerName) : null;
    return found?.objects ?? [];
  }

  // -------------------------
  // NPC helpers + Doors + Followers
  // -------------------------

  addWorldText(x, y, text, style = {}, opts = {}) {
    const t = this.add.text(x, y, text ?? "", style);
    t.setDepth(opts.depth ?? DEPTH.WORLD_TEXT);
    if (opts.scrollFactor !== undefined) t.setScrollFactor(opts.scrollFactor);
    if (opts.origin) t.setOrigin(opts.origin.x ?? 0, opts.origin.y ?? 0);
    return t;
  }

  // Call this from scene-specific NPC spawners if you want follower-choice cleanup to work by npcId.
  registerSpawnedNpc(npcId, npcObj) {
    const id = String(npcId ?? "").trim();
    if (!id || !npcObj) return;
    if (!this._spawnedNpcsById) this._spawnedNpcsById = new Map();
    if (!this._movingNpcById) this._movingNpcById = new Map(); // npcId -> move state

    // Tag the object so we can correlate look-at NPCs with waypoint mover state.
    npcObj._spawnId = id;

    this._spawnedNpcsById.set(id, npcObj);

    this._reapplyNpcTransforms(id, npcObj);
  }


  _persistNpcTransforms(npcId, npcObj) {
    const id = String(npcId ?? "").trim();
    if (!id || !npcObj) return;

    const rect = npcObj.rect ?? npcObj;
    if (!rect) return;

    const x = Number(rect.x);
    const y = Number(rect.y);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      const posKey = this._flagKey("__npc_pos", this.scene.key, id);
      this._setAnyFlag(posKey, { x, y });
    }

    // Flip persistence already uses its own key.
    const flipKey = this._npcFlipYFlag(this.scene.key, id);
    const flip = npcObj.isSprite ? rect.flipY === true : false;
    if (flip) this._setAnyFlag(flipKey, true);
  }

  _persistAllNpcTransforms() {

    const map = this._spawnedNpcsById;
    if (!map || typeof map.forEach !== "function") return;

    map.forEach((npcObj, npcId) => {
      try {
        this._persistNpcTransforms(npcId, npcObj);
      } catch (e) {
        console.warn("[BaseExploreScene] failed to persist NPC", npcId, e);
      }
    });
  }

  
  _hookNpcPersistenceLifecycle() {
    if (!this._npcPersistFn) {
      this._npcPersistFn = () => {
        try {
          this._persistAllNpcTransforms();
        } catch (_) {}
      };
    }

    // Scenes can be re-entered many times; always ensure the handlers are attached.
    this.events?.off?.(Phaser.Scenes.Events.SHUTDOWN, this._npcPersistFn);
    this.events?.on?.(Phaser.Scenes.Events.SHUTDOWN, this._npcPersistFn);

    this.events?.off?.(Phaser.Scenes.Events.DESTROY, this._npcPersistFn);
    this.events?.on?.(Phaser.Scenes.Events.DESTROY, this._npcPersistFn);
  }


  /**
   * Returns true if the spawned NPC is currently moving along waypoints.
   * Accepts either an npcId string or an NPC object previously passed to registerSpawnedNpc().
   */
  isSpawnedNpcMoving(npcIdOrObj) {
    const id =
      typeof npcIdOrObj === "string"
        ? String(npcIdOrObj).trim()
        : String(npcIdOrObj?._spawnId ?? "").trim();

    if (!id) return false;
    return this._movingNpcById?.has?.(id) === true;
  }


  // Smoothly move a spawned NPC (created via makeNPC + registerSpawnedNpc) to a point marker.
  // pointName should be an object name in the "Points" object layer (point marker).
  
  // Ensure an NPC sprite has an Arcade body so it can collide + animate while moving.
  _ensureNpcDynamicBody(npc, { bodyW = 10, bodyH = 10, offX = 3, offY = 6, collideWorld = false } = {}) {
    if (!npc?.isSprite || !npc?.rect) return null;
    const spr = npc.rect;

    // If it already has a dynamic body, keep it.
    if (spr.body && spr.body.enable && spr.body.moves) return spr.body;

    // If it has a STATIC body (from a previous experiment), remove and re-add.
    try {
      if (spr.body && spr.body.isStatic) {
        this.physics.world.disableBody(spr.body);
        spr.body = null;
      }
    } catch (_) {}

    this.physics.add.existing(spr, false);

    const body = spr.body;
    if (!body) return null;

    body.setSize?.(bodyW, bodyH);
    body.setOffset?.(offX, offY);
    body.setCollideWorldBounds?.(collideWorld === true);

    // Collide with the same things the player collides with (tile collisions + object colliders)
    try {
      for (const layer of this.collisionLayers ?? []) this.physics.add.collider(spr, layer);
      if (this.objectColliders) this.physics.add.collider(spr, this.objectColliders);
    } catch (_) {}

    return body;
  }

  // Resolve a CSV list of point marker names into world positions.
  _resolveWaypointPoints(pointLayerName, namesCsv) {
    const layer = String(pointLayerName ?? "Points").trim() || "Points";
    const names = splitCsv(namesCsv).map((s) => String(s).trim()).filter(Boolean);
    const pts = [];
    for (const nm of names) {
      const p = this.getTiledPoint(layer, nm);
      if (p) pts.push({ x: p.x, y: p.y });
      else console.warn(`[Waypoints] Missing point "${nm}" in layer "${layer}" (${this.scene.key}).`);
    }
    return pts;
  }

  // Move a spawned NPC along a list of waypoint point markers (CSV), with collisions + walk anims.
  // Example: this.moveSpawnedNpcAlongWaypoints("Glad", "npc_glad_wp1,npc_glad_wp2,npc_glad_wp3")
  moveSpawnedNpcAlongWaypoints(
    npcId,
    waypointsCsv,
    opts = {}
  ) {
    const id = String(npcId ?? "").trim();
    if (!id) return false;

    const {
      pointLayer = "Points",
      speed = 40,
      arriveDist = 2,
      body = { w: 10, h: 10, ox: 3, oy: 6 },
      faceWhileMoving = true,
      walkAnim = true,
    } = opts ?? {};

    const npc = this._spawnedNpcsById?.get(id);
    if (!npc?.isSprite || !npc?.rect) {
      console.warn(`[Waypoints] NPC "${id}" not registered/spawned (call registerSpawnedNpc).`);
      return false;
    }

    const points = this._resolveWaypointPoints(pointLayer, waypointsCsv);
    if (!points.length) {
      console.warn(`[Waypoints] No waypoints resolved for "${id}".`);
      return false;
    }

    // Ensure it can collide
    this._ensureNpcDynamicBody(npc, { bodyW: body.w, bodyH: body.h, offX: body.ox, offY: body.oy });

    // Ensure it has WALK anims available (idleOnly: false)
    if (walkAnim !== false) {
      try {
        ensureCharacterAnims(this, npc.animPrefix, { prefix: npc.animPrefix, idleOnly: false, directions: 4 });
      } catch (_) {}
    }

    this._movingNpcById.set(id, {
      points,
      idx: 0,
      speed: Number(speed) || 40,
      arriveDist: Number(arriveDist) || 2,
      faceWhileMoving: faceWhileMoving !== false,
      walkAnim: walkAnim !== false,
    });

    return true;
  }

  // Backwards-compatible: move to a single point marker.
  moveSpawnedNpcToPoint(npcId, pointName, opts = {}) {
    const id = String(npcId ?? "").trim();
    const name = String(pointName ?? "").trim();
    if (!id || !name) return false;

    // If opts.useTween is explicitly true, keep old tween behavior.
    if (opts.useTween === true) {
      return this._moveSpawnedNpcToPointTween(id, name, opts);
    }

    // Otherwise use the waypoint mover with a single target.
    return this.moveSpawnedNpcAlongWaypoints(id, name, {
      pointLayer: opts.pointLayer ?? "Points",
      speed: opts.speed ?? 40,
      arriveDist: opts.arriveDist ?? 2,
      body: opts.body ?? { w: 10, h: 10, ox: 3, oy: 6 },
    });
  }

  // Original tween-based mover preserved (no collisions).
  _moveSpawnedNpcToPointTween(npcId, pointName, { speed = 40, pointLayer = "Points" } = {}) {
    const id = String(npcId ?? "").trim();
    const npc = this._spawnedNpcsById?.get(id);
    if (!npc) return false;

    const p = this.getTiledPoint(pointLayer, pointName);
    if (!p) {
      console.warn(`[moveSpawnedNpcToPoint] Missing point "${pointName}" in layer "${pointLayer}" (${this.scene.key}).`);
      return false;
    }

    // Stop any physics movement
    try { npc.rect?.body?.setVelocity?.(0, 0); } catch (_) {}

    const dx = p.x - npc.rect.x;
    const dy = p.y - npc.rect.y;
    const dist = Math.hypot(dx, dy);
    const duration = dist > 0 ? (dist / Math.max(1, speed)) * 1000 : 0;

    this.tweens.add({
      targets: npc.rect,
      x: p.x,
      y: p.y,
      duration,
      onUpdate: () => {
        const vx = npc.rect.x - (npc._lastTweenX ?? npc.rect.x);
        const vy = npc.rect.y - (npc._lastTweenY ?? npc.rect.y);
        npc._lastTweenX = npc.rect.x;
        npc._lastTweenY = npc.rect.y;

        if (Math.abs(vx) > 0.01 || Math.abs(vy) > 0.01) {
          if (Math.abs(vx) > Math.abs(vy)) npc.facing = vx < 0 ? "left" : "right";
          else npc.facing = vy < 0 ? "up" : "down";

          playCharacterAnim(npc.rect, npc.animPrefix, npc.facing, true);
        } else {
          playCharacterAnim(npc.rect, npc.animPrefix, npc.facing ?? "down", false);
        }
      },
      onComplete: () => {
        playCharacterAnim(npc.rect, npc.animPrefix, npc.facing ?? "down", false);
      },
    });

    return true;
  }

  // Per-frame update for moving NPCs (collisions + walk anims).
  updateMovingNpcs() {
    if (!this._movingNpcById?.size) return;

    for (const [id, st] of this._movingNpcById.entries()) {
      const npc = this._spawnedNpcsById?.get(id);
      if (!npc?.isSprite || !npc?.rect) {
        this._movingNpcById.delete(id);
        continue;
      }

      const spr = npc.rect;
      const body = spr.body;
      const pts = st.points ?? [];
      const i = st.idx ?? 0;

      if (!pts.length || i >= pts.length) {
        try { body?.setVelocity?.(0, 0); } catch (_) {}
        playCharacterAnim(spr, npc.animPrefix, npc.facing ?? npc.defaultFacing ?? "down", false);
        this._movingNpcById.delete(id);
        continue;
      }

      const target = pts[i];
      const dx = target.x - spr.x;
      const dy = target.y - spr.y;
      const dist = Math.hypot(dx, dy);

      const arrive = Math.max(6, Number(st.arriveDist) || 2);
      if (dist <= arrive || (Math.abs(dx) <= arrive && Math.abs(dy) <= arrive)) {
        st.idx = i + 1;

        // snap to the waypoint to avoid jitter
        spr.x = target.x;
        spr.y = target.y;
        try { body?.reset?.(spr.x, spr.y); } catch (_) {}

        // If this was the last waypoint, stop immediately so the NPC is interactable right away.
        if (st.idx >= pts.length) {
          try { body?.setVelocity?.(0, 0); } catch (_) {}
          playCharacterAnim(spr, npc.animPrefix, npc.facing ?? npc.defaultFacing ?? "down", false);
          this._movingNpcById.delete(id);
        }

        continue;
      }

      const spd = Math.max(1, Number(st.speed) || 40);
      const nx = dx / dist;
      const ny = dy / dist;

      try {
        body?.setVelocity?.(nx * spd, ny * spd);
      } catch (_) {}

      if (st.faceWhileMoving !== false) {
        if (Math.abs(nx) > Math.abs(ny)) npc.facing = nx < 0 ? "left" : "right";
        else npc.facing = ny < 0 ? "up" : "down";
      }

      playCharacterAnim(spr, npc.animPrefix, npc.facing ?? "down", st.walkAnim !== false);
    }
  }


  makeNPC(x, y, name, lookCfg = null) {
    const texKey = this._followerTextureKey?.(name) || "";

    if (texKey) {
      const spr = this.add.sprite(x, y, texKey, 1);
      spr.setDepth(DEPTH.PLAYER);
      spr.setScale(this.NPC_SPRITE_SCALE ?? 1);
      spr.setOrigin(0.5, 0.8);

      const cfg = {
        prefix: texKey,
        radius: Number(lookCfg?.radius ?? this.NPC_LOOK_RADIUS_DEFAULT),
        directions: Number(lookCfg?.directions ?? 4) === 2 ? 2 : 4,
        defaultFacing: String(lookCfg?.defaultFacing ?? "down"),
      };

      // NPCs idle-only, but respect 2-dir vs 4-dir if you ever need it
      ensureCharacterAnims(this, texKey, { prefix: texKey, idleOnly: true, directions: cfg.directions });
      playCharacterAnim(spr, texKey, cfg.defaultFacing, false);

      const lp = this._getNpcLabelPropsByName(name) ?? {};
      const labelColor = this._parseCssColor(lp.namecolor ?? lp.nametagcolor ?? lp.labelcolor, "#e0e0e0");
      const labelSize = lp.namefontsize ?? lp.nametagfontsize ?? lp.labelfontsize;

      const label = this.addWorldText(
        x - 10,
        y + 10,
        name,
        this._worldLabelStyle(labelColor, labelSize ? { fontSize: `${Number(labelSize) || 10}px` } : {}),
        { depth: DEPTH.WORLD_TEXT }
      );

      const npc = {
        rect: spr,
        label,
        labelOffset: { x: -10, y: 10 },
        name,
        isSprite: true,
        animPrefix: texKey,
        facing: cfg.defaultFacing,
        defaultFacing: cfg.defaultFacing,
        lookAt: cfg,
      };

      // only register if look-at is enabled
      if (cfg.radius > 0) this._npcsToFacePlayer.push(npc);

      return npc;
    }

    // fallback rectangle NPC
    const rect = this.add.rectangle(x, y, 16, 16, 0xffffff, 0.55);
    this.physics.add.existing(rect, true);
    rect.setDepth(DEPTH.PLAYER);

    const label = this.addWorldText(x - 10, y + 10, name, this._worldLabelStyle("#e0e0e0"), { depth: DEPTH.WORLD_TEXT });
    return { rect, label, name, isSprite: false };
  }

  addDoorZone(x, y, w, h, labelText, labelX, labelY, prompt, action) {
    const zone = this.add.rectangle(x, y, w, h, 0xffffff, 0.15);
    this.physics.add.existing(zone, true);
    zone.setDepth(DEPTH.WORLD_TEXT);

    if (labelText) {
      this.addWorldText(labelX, labelY, labelText, this._worldLabelStyle("#d0d0d0", { fontSize: "10px" }), { depth: DEPTH.WORLD_TEXT });
    }

    this.interactables.push({
      id: `__door_${x}_${y}_${w}_${h}`,
      selectable: true,
      getPos: () => ({ x: zone.x, y: zone.y }),
      maxDist: 18,
      prompt,
      action,
      isEnabled: () => true,
    });

    return zone;
  }

  makeFollower(name) {
    const texKey = this._followerTextureKey(name);

    if (texKey) {
      const spr = this.add.sprite(this.player.x, this.player.y, texKey, 1);
      spr.setDepth(DEPTH.PLAYER);
      spr.setScale(this.NPC_SPRITE_SCALE ?? 1);
      spr.setOrigin(0.5, 0.8);

      ensureCharacterAnims(this, texKey, { prefix: texKey, idleOnly: false, directions: 4 });
      playCharacterAnim(spr, texKey, "down", false);

      const label = this.addWorldText(
        spr.x - 9,
        spr.y + 9,
        name,
        this._worldLabelStyle("#c0c0c0", { fontSize: "9px" }),
        { depth: DEPTH.WORLD_TEXT }
      );

      return {
        name,
        rect: spr,
        label,
        isSprite: true,
        animPrefix: texKey,
        facing: "down",
        _lastX: spr.x,
        _lastY: spr.y,
      };
    }

    const rect = this.add.rectangle(this.player.x, this.player.y, 12, 12, 0xffffff, 0.35);
    rect.setDepth(DEPTH.PLAYER);

    const label = this.addWorldText(rect.x - 9, rect.y + 9, name, this._worldLabelStyle("#c0c0c0", { fontSize: "9px" }), { depth: DEPTH.WORLD_TEXT });
    return { rect, label, name, isSprite: false };
  }

  hideNPC(npc) {
    if (!npc) return;
    npc.rect?.setVisible?.(false);
    npc.label?.setVisible?.(false);
    try {
      if (npc.rect && npc.rect.body) npc.rect.body.enable = false;
    } catch (_) {}
  }

  destroyNPC(npc) {
    if (!npc) return;
    npc.rect?.destroy?.();
    npc.label?.destroy?.();
  }

  _hideOrDestroyNpcByName(name) {
    const n = String(name ?? "").trim();
    if (!n) return;
    const key = n.toLowerCase();

    const candidates = [
      this[key],
      this[`${key}npc`],
      this[`${key}NPC`],
      this[`${key}Npc`],
      this[`${key}Follower`],
    ].filter(Boolean);

    for (const npc of candidates) {
      // Prefer destroy for "static NPC" visuals to avoid duplicates
      if (npc?.rect || npc?.label) {
        this.destroyNPC(npc);
      } else {
        try {
          npc?.destroy?.();
          npc?.setVisible?.(false);
        } catch (_) {}
      }
    }
  }

  getTiledPoint(objectLayerName, objectName) {
    const arr = this.tiledObjects?.[objectLayerName] ?? [];
    const o = arr.find((x) => (x?.name ?? "") === objectName);
    return objCenter(o) ?? (o ? { x: o.x, y: o.y } : null);
  }

  getPointSnapped(objectLayerName, objectName, tileSize = 16) {
    const p = this.getTiledPoint(objectLayerName, objectName);
    if (!p) return null;
    return {
      x: Math.round(p.x / tileSize) * tileSize,
      y: Math.round(p.y / tileSize) * tileSize,
    };
  }

  syncFollowersFromGameState() {
    for (const f of this.followers) {
      f.rect?.destroy();
      f.label?.destroy();
    }
    this.followers = [];

    if (GameState?.flags?.aloiseFollowing) this.followers.push(this.makeFollower("Aloise"));
    if (GameState?.flags?.sagaJoined) this.followers.push(this.makeFollower("Saga"));
  }

  // -------------------------
  // Audio helpers (robust)
  // -------------------------

  _audioExists(key) {
    return !!this.cache?.audio?.exists?.(key);
  }

  // Accept:
  //  - "knock" (ASSETS.sfx name) OR
  //  - "sfx_knock" (already-loaded key)
  _resolveAudioKey(nameOrKey) {
    const s = String(nameOrKey ?? "").trim();
    if (!s) return "";

    if (this._audioExists(s)) return s;

    const def = ASSETS.sfx?.[s];
    const mapped = def?.key ?? "";
    if (mapped && this._audioExists(mapped)) return mapped;

    return "";
  }


  _setInteractionDisabled(id, disabled) {
    const k = String(id ?? "").trim();
    if (!k) return;
    if (!GameState.interactions) GameState.interactions = {};
    if (!GameState.interactions.disabled) GameState.interactions.disabled = {};
    if (disabled) GameState.interactions.disabled[k] = true;
    else delete GameState.interactions.disabled[k];
  }

  _safePlay(nameOrKey, opts = {}) {
    const key = this._resolveAudioKey(nameOrKey);
    if (!key) {
      console.warn(`[Audio] Missing audio key mapping/cache for "${nameOrKey}"`);
      return false;
    }
    this.sound.play(key, opts);
    return true;
  }

  _safeAdd(nameOrKey, opts = {}) {
    const key = this._resolveAudioKey(nameOrKey);
    if (!key) {
      console.warn(`[Audio] Missing audio key mapping/cache for "${nameOrKey}"`);
      return null;
    }
    const snd = this.sound.add(key, opts);
    // mark as scene-owned for shutdown safety
    snd.__sceneOwned = true;
    return snd;
  }

  // -------------------------
  // Music ducking during interactions
  // -------------------------

  _applyMusicDuck(factor) {
    const f = clamp01(factor);
    const sounds = this.sound?.sounds ?? [];

    if (f >= 1) {
      for (const [snd, v] of this._musicDuckOriginal.entries()) {
        try {
          snd.setVolume?.(v);
        } catch (_) {}
      }
      this._musicDuckOriginal.clear();
      return;
    }

    for (const snd of sounds) {
      if (!snd?.isPlaying) continue;
      if (snd.loop !== true) continue;

      if (!this._musicDuckOriginal.has(snd)) {
        this._musicDuckOriginal.set(snd, Number(snd.volume ?? 1));
      }

      const base = this._musicDuckOriginal.get(snd) ?? 1;
      snd.setVolume?.(base * f);
    }
  }

  _pushMusicDuck(factor) {
    const f = clamp01(factor);
    this._musicDuckStack.push(f);
    this._applyMusicDuck(Math.min(...this._musicDuckStack));
  }

  _popMusicDuck() {
    this._musicDuckStack.pop();
    if (!this._musicDuckStack.length) {
      this._applyMusicDuck(1);
      return;
    }
    this._applyMusicDuck(Math.min(...this._musicDuckStack));
  }

  // -------------------------
  // Scene BGM
  // -------------------------

    setSceneMusic(
    nameOrKey,
    {
      volume = 0.6,
      loop = true,
      fadeMs = 600,
      persist = false,
      ignoreOverride = false,
    } = {}
  ) {
    const sceneKey = this.scene?.key ?? this.sys?.settings?.key ?? "";

    // Apply persisted override unless explicitly ignored.
    if (!ignoreOverride) {
      const override = GameState?.flags?.__sceneMusicOverride?.[sceneKey];
      if (override) nameOrKey = override;
    }

    const key = this._resolveAudioKey(nameOrKey);
    if (!key) {
      console.warn(`[SceneMusic] Cannot start: missing key for "${nameOrKey}"`);
      return;
    }

    // Persist override for future re-entries.
    if (persist) {
      if (!GameState.flags) GameState.flags = {};
      if (!GameState.flags.__sceneMusicOverride) GameState.flags.__sceneMusicOverride = {};
      GameState.flags.__sceneMusicOverride[sceneKey] = String(nameOrKey);
    }

    // Already playing same track
    if (this._sceneMusicKey === key && this._sceneMusic?.isPlaying) return;

    const targetVol = clamp01(volume);
    const fade = clampInt(fadeMs ?? 0, 0, 5000);

    // No existing music or no fade requested -> hard switch
    if (!this._sceneMusic || fade <= 0) {
      this.stopSceneMusic();
      const snd = this.sound.add(key, { loop: loop === true, volume: targetVol });
      snd.__sceneOwned = true;
      snd.play();
      this._sceneMusic = snd;
      this._sceneMusicKey = key;
      return;
    }

    // Cross-fade old -> new
    const old = this._sceneMusic;
    const oldKey = this._sceneMusicKey;

    const next = this.sound.add(key, { loop: loop === true, volume: 0 });
    next.__sceneOwned = true;

    try {
      next.play();
    } catch (e) {
      console.warn("[SceneMusic] play() failed, falling back to hard switch:", e);
      try { next.destroy?.(); } catch (_) {}
      this.stopSceneMusic();
      const snd = this.sound.add(key, { loop: loop === true, volume: targetVol });
      snd.__sceneOwned = true;
      snd.play();
      this._sceneMusic = snd;
      this._sceneMusicKey = key;
      return;
    }

    this._sceneMusic = next;
    this._sceneMusicKey = key;

    this.tweens.add({
      targets: old,
      volume: 0,
      duration: fade,
      onComplete: () => {
        try {
          if (this._sceneMusic !== old && oldKey) {
            old.stop?.();
            old.destroy?.();
          }
        } catch (_) {}
      },
    });

    this.tweens.add({
      targets: next,
      volume: targetVol,
      duration: fade,
    });
  }


    _clearSceneMusicOverride() {
    const sceneKey = this.scene?.key ?? this.sys?.settings?.key ?? "";
    if (GameState?.flags?.__sceneMusicOverride?.[sceneKey]) {
      delete GameState.flags.__sceneMusicOverride[sceneKey];
    }
  }

  stopSceneMusic() {
    try {
      this._sceneMusic?.stop?.();
      this._sceneMusic?.destroy?.();
    } catch (_) {}
    this._sceneMusic = null;
    this._sceneMusicKey = "";
  }

  // -------------------------
  // Ambience zones (from interactables with properties)
  // -------------------------

  _updateAmbienceZones() {
    if (!this.player) return;

    for (const it of this.interactables) {
      if (!it?._props) continue;

      const p = it._props;

      const isAmbience =
        p.ambience === true ||
        String(p.ambience ?? "").toLowerCase() === "true" ||
        !!String(p.ambiencekey ?? p.ambiencesfx ?? p.ambiencetrack ?? "").trim();

      if (!isAmbience) continue;

      const w = Number(it.w ?? 0);
      const h = Number(it.h ?? 0);
      if (w <= 0 || h <= 0) continue;

      const inside = pointInRect(this.player.x, this.player.y, it.center.x, it.center.y, w, h);

      const zoneId = String(it.id ?? "").trim();
      const existing = this._ambienceByZoneId.get(zoneId);

      if (inside) {
        if (!existing || !existing.isPlaying) {
          const keyName = String(p.ambiencekey ?? p.ambiencesfx ?? p.ambiencetrack ?? "").trim();
          const vol = p.ambiencevolume !== undefined ? Number(p.ambiencevolume) : 0.35;
          const volPct = p.ambiencevolumepct !== undefined ? Number(p.ambiencevolumepct) / 100 : null;
          const volume = clamp01(volPct ?? vol);

          const snd = this._safeAdd(keyName, { loop: true, volume });
          if (snd) {
            snd.play();
            this._ambienceByZoneId.set(zoneId, snd);
          }
        }
      } else if (existing) {
        try {
          existing.stop();
          existing.destroy();
        } catch (_) {}
        this._ambienceByZoneId.delete(zoneId);
      }
    }
  }

  _updatePlayerAnim() {
    const b = this.player?.body;
    if (!b) return;

    const vx = b.velocity.x;
    const vy = b.velocity.y;
    const moving = Math.abs(vx) > 0.1 || Math.abs(vy) > 0.1;

    if (moving) {
      // dominant axis decides direction
      if (Math.abs(vx) > Math.abs(vy)) this._playerFacing = vx < 0 ? "left" : "right";
      else this._playerFacing = vy < 0 ? "up" : "down";

      playCharacterAnim(this.player, this._playerAnimPrefix, this._playerFacing, true);
    } else {
      playCharacterAnim(this.player, this._playerAnimPrefix, this._playerFacing, false);
    }
  }

  // -------------------------
  // FX
  // -------------------------

  _stackShake(ms) {
    const dur = clampInt(ms, 0, 5000);
    if (dur <= 0) return;
    const now = this.time.now;
    this._shakeEndAt = Math.max(this._shakeEndAt, now) + dur;
    this.cameras.main.shake(this._shakeEndAt - now, 0.01, true);
  }

  _playScaledSfx(sfxName, basePct, stepPct, maxPct, useIndex) {
    const base = clampInt(basePct ?? 20, 0, 100);
    const step = clampInt(stepPct ?? 5, 0, 100);
    const max = clampInt(maxPct ?? 80, 0, 100);
    const pct = Math.min(max, base + (useIndex - 1) * step);
    this._safePlay(sfxName, { volume: pct / 100 });
  }

  _getNumberedKeys(props, baseKey) {
    const keys = [];
    if (props[baseKey] !== undefined) keys.push(baseKey);
    for (let i = 2; i <= 99; i++) {
      const k = `${baseKey}${i}`;
      if (props[k] === undefined) break;
      keys.push(k);
    }
    return keys;
  }
  _lineIndexFromKey(prefix, key) {
    const p = String(prefix ?? "");
    const k = String(key ?? "");
    if (!p || !k) return 1;
    if (k === p) return 1;
    const m = k.match(new RegExp(`^${p}(\\d+)$`));
    if (!m) return 1;
    const n = Number(m[1]);
    return Number.isFinite(n) && n > 0 ? n : 1;
  }

  _resolveLineSpeaker(props, baseSpeaker, prefix, key) {
    const p = String(prefix ?? "");
    const k = String(key ?? "");
    const n = this._lineIndexFromKey(p, k);

    const direct = String(props[`${k}speaker`] ?? "").trim();
    if (direct) return direct;

    const numbered = String(props[`${p}${n}speaker`] ?? "").trim();
    if (numbered) return numbered;

    const group = String(props[`${p}speaker`] ?? "").trim();
    if (group) return group;

    return String(baseSpeaker ?? "").trim();
  }

  _appendLineMetaActions(interactionId, props, key, steps) {
    const id = String(interactionId ?? "").trim();
    const k = String(key ?? "").trim();
    if (!id || !k || !Array.isArray(steps)) return;

    const sfxName = String(props[`${k}sfx`] ?? "").trim();
    const sfxOnce = props[`${k}sfxonce`] === true || String(props[`${k}sfxonce`] ?? "").toLowerCase() === "true";
    const sfxBase = props[`${k}sfxbase`] !== undefined ? Number(props[`${k}sfxbase`]) : 100;

    const giveItem = String(props[`${k}giveitem`] ?? "").trim();
    const giveCountRaw = Number(props[`${k}givecount`]);
    const giveCount = Number.isFinite(giveCountRaw) && giveCountRaw > 0 ? Math.floor(giveCountRaw) : 1;
    const giveOnce = props[`${k}giveonce`] === true || String(props[`${k}giveonce`] ?? "").toLowerCase() === "true";

    const helpRaw = Number(props[`${k}addhelp`]);
    const addHelpAmt = Number.isFinite(helpRaw) ? Math.floor(helpRaw) : 0;

    const scoreRaw = Number(props[`${k}addscore`]);
    const addScoreAmt = Number.isFinite(scoreRaw) ? Math.floor(scoreRaw) : 0;

    const runOnceGuard = (type, extra = "") => {
      const flag = this._flagKey("__line_effect_once", this.scene.key, id, k, type, extra);
      if (this._getAnyFlag(flag) === true) return false;
      this._setAnyFlag(flag, true);
      return true;
    };

    if (sfxName) {
      steps.push({
        type: "action",
        run: () => {
          if (sfxOnce && !runOnceGuard("sfx")) return;

          const persist =
            props[`${k}sfxpersist`] === true ||
            String(props[`${k}sfxpersist`] ?? "").toLowerCase() === "true" ||
            props[`${k}sfxpersistafterdialogue`] === true ||
            String(props[`${k}sfxpersistafterdialogue`] ?? "").toLowerCase() === "true";

          const stopOnExit =
            props[`${k}sfxstoponexit`] === undefined
              ? true
              : props[`${k}sfxstoponexit`] === true ||
                String(props[`${k}sfxstoponexit`] ?? "").toLowerCase() === "true";

          const vol = clampInt(sfxBase, 0, 100) / 100;
          const snd = this._safeAdd(sfxName, { loop: false, volume: vol });
          if (!snd) return;
          try { snd.play(); } catch (_) {}

          // Default: stop SFX when dialogue exits, unless overridden.
          if (!persist && stopOnExit && typeof this.dialogue?.trackSound === "function") {
            this.dialogue.trackSound(snd, { persistAfterDialogue: false });
          }
        },
      });
    }

    if (giveItem) {
      steps.push({
        type: "action",
        run: () => {
          if (giveOnce && !runOnceGuard("giveitem", giveItem)) return;
          addItem(giveItem, giveCount);
        },
      });
    }

    if (addHelpAmt) {
      steps.push({
        type: "action",
        run: () => {
          if (!runOnceGuard("addhelp")) return;
          addHelp(addHelpAmt);
        },
      });
    }

    if (addScoreAmt) {
      steps.push({
        type: "action",
        run: () => {
          if (!runOnceGuard("addscore")) return;
          addScore(addScoreAmt);
        },
      });
    }
  }
  // -------------------------
  // Quest-style interaction gating (cross-scene)
  // -------------------------

  _interactionForceDisabledFlag(sceneKey, interactionId) {
    return this._flagKey("__int_forced_disabled", String(sceneKey ?? "").trim(), String(interactionId ?? "").trim());
  }

  _interactionForceEnabledFlag(sceneKey, interactionId) {
    return this._flagKey("__int_forced_enabled", String(sceneKey ?? "").trim(), String(interactionId ?? "").trim());
  }

  _isInteractionForcedDisabled(sceneKey, interactionId) {
    const k = this._interactionForceDisabledFlag(sceneKey, interactionId);
    return this._getAnyFlag(k) === true;
  }

  _isInteractionForcedEnabled(sceneKey, interactionId) {
    const k = this._interactionForceEnabledFlag(sceneKey, interactionId);
    return this._getAnyFlag(k) === true;
  }

  _setInteractionForcedDisabled(sceneKey, interactionId, disabled) {
    const disKey = this._interactionForceDisabledFlag(sceneKey, interactionId);
    const enKey = this._interactionForceEnabledFlag(sceneKey, interactionId);

    if (disabled) {
      this._setAnyFlag(disKey, true);
      this._setAnyFlag(enKey, false);
    } else {
      this._setAnyFlag(disKey, false);
    }
  }

  _setInteractionForcedEnabled(sceneKey, interactionId, enabled) {
    const enKey = this._interactionForceEnabledFlag(sceneKey, interactionId);
    const disKey = this._interactionForceDisabledFlag(sceneKey, interactionId);

    if (enabled) {
      this._setAnyFlag(enKey, true);
      this._setAnyFlag(disKey, false);
    } else {
      this._setAnyFlag(enKey, false);
    }
  }

  _parseInteractionTarget(raw, defaultSceneKey) {
    const s = String(raw ?? "").trim();
    if (!s) return null;

    const seps = [":", "|", "/"];
    for (const sep of seps) {
      const idx = s.indexOf(sep);
      if (idx > 0) {
        const sceneKey = s.slice(0, idx).trim();
        const id = s.slice(idx + 1).trim();
        if (sceneKey && id) return { sceneKey, id };
      }
    }

    return { sceneKey: String(defaultSceneKey ?? "").trim(), id: s };
  }

  _flagsAllTrue(flagNames) {
    for (const f of flagNames) {
      const k = String(f ?? "").trim();
      if (!k) continue;
      if (GameState.flags?.[k] !== true) return false;
    }
    return true;
  }

  _flagsAnyTrue(flagNames) {
    for (const f of flagNames) {
      const k = String(f ?? "").trim();
      if (!k) continue;
      if (GameState.flags?.[k] === true) return true;
    }
    return false;
  }





  // -------------------------
  // Interactables
  // -------------------------

  _registerTiledInteractions(layerName) {
    if (!this.map) return;
    const objects = this._getObjectLayerObjects(layerName);
    if (!objects.length) return;

    for (const obj of objects) {
      const props = parseProps(obj);
      const id = String(props.id ?? obj.name ?? "").trim();
      if (!id) continue;

      if (this.interactables.some((it) => it.id === id)) {
        console.warn(`[Interactables] Duplicate id "${id}" in ${this.scene.key}. Check Tiled object layer "${layerName}".`);
        continue;
      }

      const center = objCenter(obj);
      if (!center) continue;

      const isTrigger = props.autofire === true || String(props.trigger ?? "").toLowerCase() === "true";

      // Default: triggers are NOT selectable by Z to avoid interference.
      // Override in Tiled with selectable=true to allow selection.
      const selectable =
        props.selectable === true || String(props.selectable ?? "").toLowerCase() === "true" ? true : !isTrigger;

      const prompt = String(props.prompt ?? "Interact").trim();
      const maxDist = Number(props.maxdist ?? 22);
      const lookMaxDist = Number(props.lookmaxdist ?? 44);
      const lookMinDot = Number(props.lookmindot ?? 0.65);

      this.interactables.push({
        id,
        kind: String(props.kind ?? "").trim(),
        selectable,
        _tiledObj: obj,
        _props: props,
        x: Number(obj.x ?? 0),
        y: Number(obj.y ?? 0),
        w: Number(obj.width ?? 0),
        h: Number(obj.height ?? 0),
        center,
        getPos: () => {
        const npcId = String(props.npcid ?? props.targetnpc ?? props.npc ?? "").trim();
        const npc = npcId ? this._spawnedNpcsById?.get?.(npcId) : null;
        if (npc?.rect) return { x: npc.rect.x, y: npc.rect.y };
        return { x: center.x, y: center.y };
      },
        isEnabled: () => {
          const sceneKey = this.scene.key;

          // Cross-scene quest toggles (forced state)
          if (this._isInteractionForcedDisabled(sceneKey, id)) return false;
          if (isInteractionDisabled(id)) return false;
          if (this._isInteractionForcedEnabled(sceneKey, id)) return true;

          // Flag gating
          const enabledIf = splitCsv(props.enabledifflags ?? props.enabledifflag);
          if (enabledIf.length && !this._flagsAllTrue(enabledIf)) return false;

          const enabledIfAny = splitCsv(props.enabledifanyflags ?? props.enabledifanyflag);
          if (enabledIfAny.length && !this._flagsAnyTrue(enabledIfAny)) return false;

          const disabledIf = splitCsv(props.disabledifflags ?? props.disabledifflag);
          if (disabledIf.length && this._flagsAnyTrue(disabledIf)) return false;

          // If this interaction is tied to a spawned NPC, disable it while the NPC is moving.
          const npcId = String(props.npcid ?? props.targetnpc ?? props.npc ?? "").trim();
          if (npcId && this.isSpawnedNpcMoving(npcId)) return false;

          const reqChoiceId = String(props.requireschoiceid ?? props.requireschoice ?? "").trim();
          const reqChoiceValRaw = props.requireschoicevalue ?? props.requireschoiceval ?? props.requireschoiceindex;
          if (reqChoiceId) {
            const want = Number(reqChoiceValRaw);
            const got = Number(GameState.interactions?.choices?.[reqChoiceId]);
            if (Number.isFinite(want) && want > 0) return got === want;
            // If only id is provided, require that *any* choice exists.
            return Number.isFinite(got) && got > 0;
          }

          return true;
        },
        maxDist,
        lookMaxDist,
        lookMinDot,
        prompt,
        action: () => this._runTiledInteraction(obj),
      });
    }
  }

  // -------------------------
  // Tile removal persistence
  // -------------------------

  _removeTileAtWorld(x, y, preferredLayerName = "") {
    if (!this.map) return false;
    const tx = this.map.worldToTileX(x);
    const ty = this.map.worldToTileY(y);

    if (preferredLayerName) {
      const layer = this.layers?.[preferredLayerName];
      if (layer) {
        const t = layer.getTileAt(tx, ty);
        if (t) {
          layer.removeTileAt(tx, ty, true, true);
          return true;
        }
      }
    }

    const entries = Object.entries(this.layers ?? {});
    entries.sort((a, b) => (a[1]?.depth ?? 0) - (b[1]?.depth ?? 0));

    for (let i = entries.length - 1; i >= 0; i--) {
      const layer = entries[i][1];
      const t = layer?.getTileAt?.(tx, ty);
      if (t) {
        layer.removeTileAt(tx, ty, true, true);
        return true;
      }
    }

    return false;
  }

  _reapplyPersistedTileRemovals(interactablesLayerName) {
    const objects = this._getObjectLayerObjects(interactablesLayerName);
    for (const obj of objects) {
      const props = parseProps(obj);
      const id = String(props.id ?? obj.name ?? "").trim();
      if (!id) continue;

      const removedKey = this._tileRemovedFlag(this.scene.key, id);
      if (this._getAnyFlag(removedKey) !== true) continue;

      const c = objCenter(obj);
      if (!c) continue;

      const targetLayer = String(props.tileremovelayer ?? "").trim();
      this._removeTileAtWorld(c.x, c.y, targetLayer);

      disableInteraction(id);
      this.interactables = this.interactables.filter((it) => it.id !== id);
    }
  }

  _reapplyPersistedColliderRemovals(colliderLayerName) {
    const layerName = String(colliderLayerName ?? "").trim();
    if (!layerName) return;

    const objects = this._getObjectLayerObjects(layerName);
    for (const obj of objects) {
      const props = parseProps(obj);
      const id = String(props.id ?? obj.name ?? "").trim();
      if (!id) continue;

      const removedKey = this._colliderRemovedFlag(this.scene.key, id);
      if (this._getAnyFlag(removedKey) !== true) continue;

      this._removeColliderById(id);
    }
  }

  // -------------------------
  // Followers + collider removal
  // -------------------------

  _setFollowerFlag(name, enabled) {
    const n = String(name ?? "").trim().toLowerCase();
    if (!n) return;
    if (n === "saga") GameState.flags.sagaJoined = !!enabled;
    else if (n === "aloise") GameState.flags.aloiseFollowing = !!enabled;
    else {
      GameState.flags[`${n}joined`] = !!enabled;
      GameState.flags[`${n}following`] = !!enabled;
    }
  }

  _followerTextureKey(name) {
    const n = String(name ?? "").trim().toLowerCase();
    if (!n) return "";
    const candidates = [`npc_${n}`, n, `follower_${n}`];
    for (const key of candidates) {
      if (this.textures?.exists?.(key)) return key;
    }
    return "";
  }

  _updateFollowerAnim(follower, nextX, nextY) {
    if (!follower?.isSprite) return;

    const lastX = follower._lastX ?? nextX;
    const lastY = follower._lastY ?? nextY;

    const dx = nextX - lastX;
    const dy = nextY - lastY;

    const moving = Math.abs(dx) > 0.1 || Math.abs(dy) > 0.1;

    if (moving) {
      if (Math.abs(dx) > Math.abs(dy)) follower.facing = dx < 0 ? "left" : "right";
      else follower.facing = dy < 0 ? "up" : "down";

      playCharacterAnim(follower.rect, follower.animPrefix, follower.facing, true);
    } else {
      playCharacterAnim(follower.rect, follower.animPrefix, follower.facing ?? "down", false);
    }

    follower._lastX = nextX;
    follower._lastY = nextY;
  }


  _syncNpcLabels() {
    // Keep NPC name tags glued to their sprites, even while moving.
    if (!this._spawnedNpcsById) return;
    for (const npc of this._spawnedNpcsById.values()) {
      if (!npc?.label || !npc?.rect || !npc.isSprite) continue;
      const off = npc.labelOffset ?? { x: -10, y: 10 };
      npc.label.setPosition(npc.rect.x + (off.x ?? -10), npc.rect.y + (off.y ?? 10));
    }
  }


  updateNpcsLookAtPlayer() {
    if (!this.player) return;

    for (const npc of this._npcsToFacePlayer ?? []) {
      if (!npc?.isSprite) continue;
      if (!npc?.rect?.visible) continue;

      // If this NPC is currently being moved along waypoints, don't override its facing/anim here.
      const sid = npc._spawnId;
      if (sid && this._movingNpcById?.has?.(sid)) continue;

      const cfg = npc.lookAt;
      if (!cfg?.prefix || !cfg?.radius) continue;

      const dx = (this.player.x ?? 0) - (npc.rect.x ?? 0);
      const dy = (this.player.y ?? 0) - (npc.rect.y ?? 0);
      const r2 = cfg.radius * cfg.radius;

      // OUT OF RANGE: snap back to default idle
      if (dx * dx + dy * dy > r2) {
        const facing = npc.defaultFacing ?? cfg.defaultFacing ?? "down";
        if (npc.facing !== facing) {
          npc.facing = facing;
          playCharacterAnim(npc.rect, cfg.prefix, facing, false);
        }
        continue;
      }

      // IN RANGE: look at player (idle)
      npc.facing = lookAtPlayerIfClose(this, npc.rect, this.player, {
        prefix: cfg.prefix,
        radius: cfg.radius,
        directions: cfg.directions ?? 4,
        defaultFacing: npc.defaultFacing ?? cfg.defaultFacing ?? "down",
      });
    }
  }

  _removeColliderById(cid) {
    const key = String(cid ?? "").trim();
    if (!key) return;

    const go = this._colliderById?.get(key);
    if (!go) {
      console.warn("[removeCollider] not found:", key, "available:", [...this._colliderById.keys()]);
      return;
    }

    try {
      this.objectColliders?.remove?.(go, true, true);
    } catch (_) {}

    go.destroy?.();
    this._colliderById.delete(key);

    // Persist across scene reloads.
    this._setAnyFlag(this._colliderRemovedFlag(this.scene.key, key), true);
  }

  _hasFollower(name) {
    const n = String(name ?? "").trim().toLowerCase();
    if (!n) return false;
    if (n === "saga") return GameState?.flags?.sagaJoined === true;
    if (n === "aloise") return GameState?.flags?.aloiseFollowing === true;
    // generic: allow flags like "<name>Joined" or "<name>Following"
    const joinedKey = `${n}joined`;
    const followingKey = `${n}following`;
    return GameState?.flags?.[joinedKey] === true || GameState?.flags?.[followingKey] === true;
  }

  _selectDialogueVariantPrefix(props, basePrefix) {
    // basePrefix examples: "dialogue", "postdialogue", "choice1postdialogue"
    const hasSaga = this._hasFollower("Saga");
    const hasAloise = this._hasFollower("Aloise");

    if (hasSaga && hasAloise) {
      const p = `bothfollowers${basePrefix}`;
      if (this._getNumberedKeys(props, p).length) return p;
    }
    if (hasSaga) {
      const p = `sagafollower${basePrefix}`;
      if (this._getNumberedKeys(props, p).length) return p;
    }
    if (hasAloise) {
      const p = `aloisefollower${basePrefix}`;
      if (this._getNumberedKeys(props, p).length) return p;
    }
    return basePrefix;
  }

  _selectPromptVariant(props, basePromptKey) {
    const hasSaga = this._hasFollower("Saga");
    const hasAloise = this._hasFollower("Aloise");

    if (hasSaga && hasAloise) {
      const v = String(props[`bothfollowers${basePromptKey}`] ?? "").trim();
      if (v) return v;
    }
    if (hasSaga) {
      const v = String(props[`sagafollower${basePromptKey}`] ?? "").trim();
      if (v) return v;
    }
    if (hasAloise) {
      const v = String(props[`aloisefollower${basePromptKey}`] ?? "").trim();
      if (v) return v;
    }
    return String(props[basePromptKey] ?? "").trim();
  }
  _buildDialogueScriptFromPrefix(props, baseSpeaker, prefix, interactionId = null) {
    const p = String(prefix ?? "").trim();
    if (!p) return [];
    const keys = this._getNumberedKeys(props, p);
    const steps = [];

    for (const k of keys) {
      const text = String(props[k] ?? "").trim();
      if (!text) continue;

      this._appendLineMetaActions(interactionId, props, k, steps);

      const speaker = this._resolveLineSpeaker(props, baseSpeaker, p, k);
      steps.push({ type: "say", speaker, text });
    }

    // Support single unnumbered property even if _getNumberedKeys missed it (defensive)
    if (!keys.length) {
      const text = String(props[p] ?? "").trim();
      if (text) {
        this._appendLineMetaActions(interactionId, props, p, steps);
        const speaker = this._resolveLineSpeaker(props, baseSpeaker, p, p);
        steps.push({ type: "say", speaker, text });
      }
    }

    return steps;
  }
  _buildSequenceScriptFromKeys(keys, props, baseSpeaker, startIndex1 = 1, endIndex1 = null, interactionId = null) {
    const list = Array.isArray(keys) ? keys : [];
    if (!list.length) return [];
    const start = Math.max(1, Number(startIndex1) || 1);
    const end =
      endIndex1 == null ? list.length : Math.max(start, Math.min(list.length, Number(endIndex1) || list.length));

    const slice = list.slice(start - 1, end);
    const steps = [];

    for (const k of slice) {
      const text = String(props[k] ?? "").trim();
      if (!text) continue;

      // k already encodes its prefix; resolve prefix by stripping trailing digits
      const prefix = String(k).replace(/\d+$/, "");

      this._appendLineMetaActions(interactionId, props, k, steps);
      const speaker = this._resolveLineSpeaker(props, baseSpeaker, prefix, k);
      steps.push({ type: "say", speaker, text });
    }

    return steps;
  }


  // -------------------------
  // Post-help dialogue selection
  // -------------------------

  _postHelpedKey(props) {
    const k = String(props.posthelpedname ?? props.markhelped ?? props.speaker ?? "").trim();
    return k || null;
  }

  // -------------------------
  // Main interaction runner
  // -------------------------

  _runTiledInteraction(obj) {
    const props = parseProps(obj);
    const id = String(props.id ?? obj?.name ?? "").trim();
    const isTrigger = props.autofire === true || String(props.trigger ?? "").toLowerCase() === "true";
    if (!id) return;
    if (isInteractionDisabled(id)) return;

    // Requirement gating:
    // - By default, once an interaction is "helped"/completed, skip requiresItem checks so it doesn't relock.
    // - Optionally, requiresItemOnce only checks on the very first interaction use.
    const helpedKeyPre = this._postHelpedKey(props);
    const isAlreadyHelped = helpedKeyPre ? isHelped(helpedKeyPre) : false;

    const requireOnce =
      props.requiresitemonce === true || String(props.requiresitemonce ?? "").toLowerCase() === "true";
    const currentUses = Number(GameState?.interactions?.counts?.[id] ?? 0) || 0;

    const skipRequiresIfHelped =
      props.requiresitemskipifhelped === undefined
        ? true
        : props.requiresitemskipifhelped === true ||
          String(props.requiresitemskipifhelped ?? "").toLowerCase() === "true";

    // Persist "requirements satisfied" so denyDialogue can't relock later (e.g., if the key was consumed).
    const reqSatisfiedFlag = this._flagKey("__req_satisfied", this.scene.key, id);
    const reqSatisfiedAlready = this._getAnyFlag(reqSatisfiedFlag) === true;

    const shouldCheckRequires = !reqSatisfiedAlready && !(skipRequiresIfHelped && isAlreadyHelped) && !(requireOnce && currentUses > 0);

    if (shouldCheckRequires) {
      for (const item of splitCsv(props.requiresitem)) {
        if (!hasItem(item)) {
          const deny = String(props.denydialogue ?? "You can't do that yet.").trim();
          this.dialogue.start([{ type: "say", speaker: "", text: deny }, { type: "end" }], this.keys);
          return;
        }
      }
    

      // Requirements passed at least once; remember it so we never show denyDialogue for this interaction again.
      this._setAnyFlag(reqSatisfiedFlag, true);
    }

    const wantsDuck =
      props.mutemusic === true ||
      String(props.mutemusic ?? "").toLowerCase() === "true" ||
      props.duckmusic === true ||
      String(props.duckmusic ?? "").toLowerCase() === "true";

    const duckFactor = props.duckmusicfactor !== undefined ? Number(props.duckmusicfactor) : 0;

    const startDuck = () => {
      if (wantsDuck) this._pushMusicDuck(duckFactor);
    };

    const endDuck = () => {
      if (wantsDuck) this._popMusicDuck();
    };

    const helpedKey = this._postHelpedKey(props);
    if (helpedKey && isHelped(helpedKey)) {
      const speaker = String(props.speaker ?? "").trim();

      const sequenceDialogue =
        props.sequencedialogue === true || String(props.sequencedialogue ?? "").toLowerCase() === "true";

      // Prompt override (supports follower variants + choice variants)
      const lastChoice = Number(GameState?.interactions?.choices?.[id] ?? 0) || 0;

      // Determine which post-dialogue prefix to use:
      //  1) choiceNPostDialogue* (if last choice exists)
      //  2) postDialogue* fallback
      let basePrefix = "postdialogue";
      if (lastChoice > 0) {
        const cand = `choice${lastChoice}postdialogue`;
        if (this._getNumberedKeys(props, cand).length) basePrefix = cand;
      }

      // Apply follower variants: bothFollowers*, sagaFollower*, aloiseFollower*
      const prefix = this._selectDialogueVariantPrefix(props, basePrefix);

      // Prompt keys: choiceNPostPrompt or postPrompt, with follower variants too
      let basePromptKey = "postprompt";
      if (lastChoice > 0) {
        const candPromptKey = `choice${lastChoice}postprompt`;
        const candPrompt = String(props[candPromptKey] ?? "").trim();
        if (candPrompt) basePromptKey = candPromptKey;
      }
      const postPrompt = this._selectPromptVariant(props, basePromptKey);

      if (postPrompt) {
        const it = this.interactables.find((x) => x.id === id);
        if (it) it.prompt = postPrompt;
      }

      let script = this._buildDialogueScriptFromPrefix(props, speaker, prefix, id);
      if (!sequenceDialogue && script.length) {
        // Progressive post-dialogue: 1st visit -> line1, 2nd -> line2, ... then keep last.
        const k = `__postdlg_count|${this.scene.key}|${id}|${prefix}`;
        if (!GameState.flags) GameState.flags = {};
        const n = (Number(GameState.flags[k] ?? 0) || 0) + 1;
        GameState.flags[k] = n;

        const idx = Math.min(n, script.length) - 1;
        script = [script[idx]];
      }

      if (script.length || hasFollowerDialogueProps(props)) {
        appendFollowerDialogue(this, props, script, { basePrefix: "followdialogue" });
        script.push({ type: "end" });

        startDuck();
        this.dialogue.start(script, this.keys, () => endDuck());
      }
      return;
    }

    const useIndex = incrementInteractionCount(id);

    const preName = props.presfx ? String(props.presfx).trim() : "";
    const preOnce = props.presfxonce === true;
    const preDelay = clampInt(props.presfxdelayms ?? 0, 0, 3000);
    const preBase = clampInt(props.presfxbase ?? 100, 0, 100);
    const allowPre = !preName || (!preOnce || useIndex === 1);

    const runMain = () => {
      this._stackShake(props.shake ?? 0);

      if (props.sfx) {
        const once = props.sfxonce === true;
        const uses = clampInt(props.sfxuses ?? 0, 0, 999);
        const allow = (!once || useIndex === 1) && !(uses > 0 && useIndex > uses);
        if (allow) this._playScaledSfx(props.sfx, props.sfxbase, props.sfxstep, props.sfxmax, useIndex);
      }

      const choicePrompt = String(props.choiceprompt ?? "").trim();
      const choice1Text = String(props.choice1text ?? "").trim();
      if (choicePrompt && choice1Text) {
        this._runChoiceInteraction(id, props);
        return;
      }

      const speaker = String(props.speaker ?? "").trim();
      const loop = props.loopdialogue === true;

      const sequenceDialogue =
        props.sequencedialogue === true || String(props.sequencedialogue ?? "").toLowerCase() === "true";

      const dialoguePrefix = this._selectDialogueVariantPrefix(props, "dialogue");
      const keys = this._getNumberedKeys(props, dialoguePrefix);
      const endN = keys.length ? clampInt(props.enddialogue ?? keys.length, 1, keys.length) : 0;

      if (!keys.length || props.nodialogue === true) {
  if (hasFollowerDialogueProps(props)) {
    const script = [];
    appendFollowerDialogue(this, props, script, { basePrefix: "followdialogue" });
    script.push({ type: "end" });

    startDuck();
    this.dialogue.start(script, this.keys, () => endDuck());
    return;
  }


      // Replace main dialogue with follower dialogue (pure talk) when followers are present.
      const replaceMainWithFollower =
        (isTrigger ||
          props.replacewithfollower === true ||
          String(props.replacewithfollower ?? "").toLowerCase() === "true") &&
        hasFollowerDialogueProps(props);

      if (replaceMainWithFollower) {
        const script = [];
        appendFollowerDialogue(this, props, script, { basePrefix: "followdialogue" });

        if (script.length) {
          script.push({ type: "end" });
          startDuck();
          this.dialogue.start(script, this.keys, () => endDuck());
          return;
        }
      }

  this._applyInteractionEffects(id, props);
  return;
}


      let lineIndex = useIndex;
      if (loop) lineIndex = ((lineIndex - 1) % endN) + 1;
      else lineIndex = Math.min(lineIndex, endN);

      if (sequenceDialogue && !loop) {
        const script = this._buildSequenceScriptFromKeys(keys, props, speaker, lineIndex, endN, id);
        const onComplete = () => this._applyInteractionEffects(id, props);

        if (!script.length) {
          this._applyInteractionEffects(id, props);
          return;
        }

        script.push({ type: "end" });

        startDuck();
        this.dialogue.start(script, this.keys, () => {
          onComplete();
          endDuck();
        });
        return;
      }

      const key = lineIndex === 1 ? dialoguePrefix : `${dialoguePrefix}${lineIndex}`;
      const textLine = String(props[key] ?? props[dialoguePrefix] ?? "").trim();
      const isFinal = !loop && lineIndex === endN;

      const onComplete = () => {
        if (!isFinal) return;
        this._applyInteractionEffects(id, props);
      };

      startDuck();
      const script = [];
      this._appendLineMetaActions(id, props, key, script);
      const lineSpeaker = this._resolveLineSpeaker(props, speaker, dialoguePrefix, key);
      script.push({ type: "say", speaker: lineSpeaker, text: textLine });
      appendFollowerDialogue(this, props, script, { basePrefix: "followdialogue" });
      script.push({ type: "end" });
      this.dialogue.start(script, this.keys, () => {
        onComplete();
        endDuck();
      });
    };

    if (allowPre && preName) {
      this._safePlay(preName, { volume: preBase / 100 });
      if (preDelay > 0) this.time.delayedCall(preDelay, runMain);
      else runMain();
    } else {
      runMain();
    }
  }
  _runChoiceInteraction(id, props) {
    const baseSpeaker = String(props.speaker ?? "").trim();

    const sequenceDialogue =
      props.sequencedialogue === true || String(props.sequencedialogue ?? "").toLowerCase() === "true";

    // Support follower variants for the intro "dialogue*" too.
    const dialoguePrefix = this._selectDialogueVariantPrefix(props, "dialogue");
    const introKeys = this._getNumberedKeys(props, dialoguePrefix);

    const prompt = String(props.choiceprompt ?? "Choose").trim();

    const script = [];

    // Intro lines (dialogue, dialogue2, ...) with per-line speaker + meta actions.
    if (introKeys.length) {
      if (sequenceDialogue) {
        script.push(...this._buildSequenceScriptFromKeys(introKeys, props, baseSpeaker, 1, introKeys.length, id));
      } else {
        for (const k of introKeys) {
          const t = String(props[k] ?? "").trim();
          if (!t) continue;

          this._appendLineMetaActions(id, props, k, script);
          const sp = this._resolveLineSpeaker(props, baseSpeaker, dialoguePrefix, k);
          script.push({ type: "say", speaker: sp, text: t });
        }
      }
    } else {
      const intro = String(props[dialoguePrefix] ?? props.dialogue ?? "").trim();
      if (intro) {
        const k = props[dialoguePrefix] !== undefined ? dialoguePrefix : "dialogue";
        this._appendLineMetaActions(id, props, k, script);
        const sp = this._resolveLineSpeaker(props, baseSpeaker, dialoguePrefix, k);
        script.push({ type: "say", speaker: sp, text: intro });
      }
    }

    const choiceIndex = script.length;
    script.push({ type: "choice", prompt, options: [] });

    const options = [];

    for (let i = 1; i <= 6; i++) {
      const txt = String(props[`choice${i}text`] ?? "").trim();
      if (!txt) continue;

      const baseChoicePrefix = `choice${i}dialogue`;
      const choicePrefix = this._selectDialogueVariantPrefix(props, baseChoicePrefix);
      const dlgKeys = this._getNumberedKeys(props, choicePrefix);

      const start = script.length;

      if (dlgKeys.length) {
        for (const k of dlgKeys) {
          const t = String(props[k] ?? "").trim();
          if (!t) continue;

          this._appendLineMetaActions(id, props, k, script);
          const sp = this._resolveLineSpeaker(props, baseSpeaker, choicePrefix, k);
          script.push({ type: "say", speaker: sp, text: t });
        }
      } else {
        const key = props[choicePrefix] !== undefined ? choicePrefix : baseChoicePrefix;
        const t = String(props[key] ?? "").trim();
        if (t) {
          this._appendLineMetaActions(id, props, key, script);
          const sp = this._resolveLineSpeaker(props, baseSpeaker, choicePrefix, key);
          script.push({ type: "say", speaker: sp, text: t });
        }
      }

      script.push({ type: "end" });

      options.push({
        text: txt,
        next: start,
        onSelect: () => {
          this._pendingChoiceEffect = () => this._applyChoiceEffects(id, props, i);
        },
      });
    }

    script[choiceIndex] = { type: "choice", prompt, options };

    // Duck music during choice dialogues if desired.
    const wantsDuck =
      props.mutemusic === true ||
      String(props.mutemusic ?? "").toLowerCase() === "true" ||
      props.duckmusic === true ||
      String(props.duckmusic ?? "").toLowerCase() === "true";

    const duckFactor = props.duckmusicfactor !== undefined ? Number(props.duckmusicfactor) : 0;
    if (wantsDuck) this._pushMusicDuck(duckFactor);

    const onComplete = () => {
      const fn = this._pendingChoiceEffect;
      this._pendingChoiceEffect = null;
      fn?.();
    };

    this.dialogue.start(script, this.keys, () => {
      onComplete();
      if (wantsDuck) this._popMusicDuck();
    });
  }


  _applyChoiceEffects(id, props, i) {
    const helped = String(props[`choice${i}markhelped`] ?? "").trim();
    if (helped) markHelped(helped, true);

    // Persist last choice (used for choice-specific post-dialogue)
    if (!GameState.interactions.choices) GameState.interactions.choices = {};
    GameState.interactions.choices[id] = i;


    // Choice-level FX (reusable across interactions)
    // Properties supported (case-insensitive via parseProps):
    //  - choiceNSfx: string (sound name or key; same resolver as sfx)
    //  - choiceNSfxOnce: bool (play only the first time this choice is selected)
    //  - choiceNSfxUses: int (optional limit; play only for first N selections)
    //  - choiceNSfxBase/choiceNSfxStep/choiceNSfxMax: ints (0-100) volume scaling
    //  - choiceNShake: int (ms) camera shake duration, same as "shake"
    if (!GameState.flags) GameState.flags = {};
    const choiceFxKey = `__choicefx__${this.scene.key}__${id}__${i}`;
    const choiceFxCount = (Number(GameState.flags[choiceFxKey] ?? 0) || 0) + 1;
    GameState.flags[choiceFxKey] = choiceFxCount;

    const choiceShake = props[`choice${i}shake`];
    if (choiceShake !== undefined) this._stackShake(choiceShake);

    const choiceSfx = String(props[`choice${i}sfx`] ?? "").trim();
    if (choiceSfx) {
      const once = props[`choice${i}sfxonce`] === true;
      const uses = clampInt(props[`choice${i}sfxuses`] ?? 0, 0, 999);
      const allow = (!once || choiceFxCount === 1) && !(uses > 0 && choiceFxCount > uses);
      if (allow) {
        this._playScaledSfx(
          choiceSfx,
          props[`choice${i}sfxbase`],
          props[`choice${i}sfxstep`],
          props[`choice${i}sfxmax`],
          choiceFxCount
        );
      }
    }

    const addFollower = String(props[`choice${i}addfollower`] ?? "").trim();
    const removeFollower = String(props[`choice${i}removefollower`] ?? "").trim();

    if (addFollower) {
      // Remove the static NPC by npcId (if your scene registered it)
      const npcId = String(props.npcid ?? addFollower ?? "").trim();
      if (npcId) {
        GameState.flags[`__npcRemoved__${npcId}`] = true;

        const spawned = this._spawnedNpcsById?.get?.(npcId);
        try {
          spawned?.rect?.destroy?.();
          spawned?.label?.destroy?.();
        } catch (_) {}
        try {
          this._spawnedNpcsById?.delete?.(npcId);
        } catch (_) {}
      }

      this._setFollowerFlag(addFollower, true);

      // Removing interaction so no duplicates
      disableInteraction(id);
      this.interactables = this.interactables.filter((it) => it.id !== id);

      // Best-effort cleanup for older scene code paths
      this._hideOrDestroyNpcByName(addFollower);

      this.syncFollowersFromGameState();
    }

    if (removeFollower) {
      this._setFollowerFlag(removeFollower, false);
      this.syncFollowersFromGameState();
    }

    // HelpScore (supports negative numbers). Apply once per (interactionId, choiceIndex).
    const hsRaw = props[`choice${i}helpscore`];
    if (hsRaw !== undefined) {
      const hsKey = `__choicehs__${this.scene.key}__${id}__${i}`;
      const already = !!GameState.flags?.[hsKey];
      if (!already) {
        if (!GameState.flags) GameState.flags = {};
        GameState.flags[hsKey] = true;

        const delta = Number(hsRaw);
        if (Number.isFinite(delta) && delta !== 0) {
          GameState.helpScore = Number(GameState.helpScore) || 0;
          GameState.helpScore += delta;
        }
      }
    }

    // Tiled props:
    //  - choiceNTargetNpc / choiceNTargetNpcId
    //  - choiceNRotateNpcDeg (180 => vertical flip)
    //  - choiceNFlipNpcY (true/false) overrides rotate
    const targetNpcRaw = String(
      props[`choice${i}targetnpc`] ?? props[`choice${i}targetnpcid`] ?? props[`choice${i}target`] ?? ""
    ).trim();

    const flipNpcYRaw = props[`choice${i}flipnpcy`];
    const hasFlipNpcY = flipNpcYRaw !== undefined && String(flipNpcYRaw).trim() !== "";
    const flipNpcY = String(flipNpcYRaw).toLowerCase() === "true" || flipNpcYRaw === true;

    const rotDegRaw = props[`choice${i}rotatenpcdeg`];
    const rotDeg = rotDegRaw !== undefined ? Number(rotDegRaw) : NaN;

    if (targetNpcRaw) {
      const npcObj = this._getSpawnedNpcByIdCaseInsensitive(targetNpcRaw);
      if (!npcObj) {
        console.warn(`[ChoiceEffects] Target NPC not registered: "${targetNpcRaw}" (scene ${this.scene.key}).`);
      } else {
        const doFlip = hasFlipNpcY ? flipNpcY : (Number.isFinite(rotDeg) && Math.abs(rotDeg) % 360 === 180);
        if (doFlip) {
          this._applyNpcFlipY(npcObj, true);
          this._setAnyFlag(this._npcFlipYFlag(this.scene.key, targetNpcRaw), true);
        }
      }
    }

    // Tiled properties supported (case-insensitive via parseProps):
    //  - npcId: which spawned NPC to move (defaults to props.id)
    //  - choiceNMoveToPoint: point marker name in the "Points" layer
    const movePoint =
      String(props[`choice${i}movetopoint`] ?? props[`choice${i}movetomarker`] ?? props[`choice${i}moveto`] ?? "").trim();
    if (movePoint) {
      const npcId = String(props.npcid ?? props.id ?? "").trim();
      if (npcId) this.moveSpawnedNpcToPoint(npcId, movePoint, { speed: Number(props[`choice${i}movespeed`] ?? 18) || 18 });
    }


    for (const lname of splitCsv(props[`choice${i}showlayer`] ?? props[`choice${i}showlayers`])) {
      const layer = this.layers?.[lname];
      layer?.setVisible?.(true);
      setLayerHidden(this.scene.key, lname, false);
    }

    for (const lname of splitCsv(props[`choice${i}hidelayer`] ?? props[`choice${i}hidelayers`])) {
      const layer = this.layers?.[lname];
      layer?.setVisible?.(false);
      setLayerHidden(this.scene.key, lname, true);
    }

    for (const cid of splitCsv(props[`choice${i}removecollider`] ?? props[`choice${i}removecolliders`])) {
      this._removeColliderById(cid);
    }

    const postPrompt = String(props.postprompt ?? "").trim();
    if (postPrompt) {
      const it = this.interactables.find((x) => x.id === id);
      if (it) it.prompt = postPrompt;
    }

    const choicePostPrompt = String(props[`choice${i}postprompt`] ?? "").trim();
    if (choicePostPrompt) {
      const it = this.interactables.find((x) => x.id === id);
      if (it) it.prompt = choicePostPrompt;
    }

    // Enable/disable other interactions based on the chosen option.
    // Properties:
    //  - choiceNEnableInteractions: CSV of interaction ids to enable
    //  - choiceNDisableInteractions: CSV of interaction ids to disable
    for (const eid of splitCsv(props[`choice${i}enableinteractions`] ?? props[`choice${i}enableinteraction`])) {
      this._setInteractionDisabled(eid, false);
    }
    for (const did of splitCsv(props[`choice${i}disableinteractions`] ?? props[`choice${i}disableinteraction`])) {
      this._setInteractionDisabled(did, true);
    }

  
    // -------------------------
    // Optional: move a spawned NPC after a choice (waypoints or single point)
    // Tiled properties supported (per choice i):
    //  - choice{i}Waypoints: "pt1,pt2,pt3"  (names of Points layer point markers)
    //  - choice{i}MoveToPoint: "some_point_name"
    //  - choice{i}MoveSpeed: number (default 40)
    //  - choice{i}WaypointLayer: layer name (default "Points")
    // NOTE: the interactable should also have npcId (e.g. "Glad") and the scene must call registerSpawnedNpc(npcId, npcObj).
    const moveNpcId = String(props.npcid ?? props.id ?? "").trim();
    const wpCsv = String(props[`choice${i}waypoints`] ?? props[`choice${i}movewaypoints`] ?? "").trim();
    const moveToPoint = String(props[`choice${i}movetopoint`] ?? props[`choice${i}movetarget`] ?? "").trim();
    const wpLayer = String(props[`choice${i}waypointlayer`] ?? "Points").trim() || "Points";
    const moveSpeed = props[`choice${i}movespeed`] !== undefined ? Number(props[`choice${i}movespeed`]) : 40;

    if (moveNpcId) {
      if (wpCsv) {
        this.moveSpawnedNpcAlongWaypoints(moveNpcId, wpCsv, { pointLayer: wpLayer, speed: moveSpeed });
      } else if (moveToPoint) {
        this.moveSpawnedNpcToPoint(moveNpcId, moveToPoint, { pointLayer: wpLayer, speed: moveSpeed, useTween: false });
      }
    }

}

  _applyInteractionEffects(id, props) {
        // -------------------------
    // Music switching (interaction effects)
    // Tiled props:
    //   setMusic (string), setMusicOnce (string)
    //   setMusicPersist (bool), clearMusicPersist (bool)
    // Optional:
    //   setMusicFadeMs (int), setMusicVolume (float), setMusicLoop (bool)
    // -------------------------
    const clearPersist =
      props.clearmusicpersist === true ||
      String(props.clearmusicpersist ?? "").toLowerCase() === "true";

    if (clearPersist) this._clearSceneMusicOverride();

    const setOnceKey = String(props.setmusiconce ?? "").trim();
    const setKey = String(props.setmusic ?? "").trim();
    const pickKey = setOnceKey || setKey;

    if (pickKey) {
      const persist =
        props.setmusicpersist === true ||
        String(props.setmusicpersist ?? "").toLowerCase() === "true";

      const fadeMs = clampInt(props.setmusicfadems ?? 600, 0, 5000);

      const volRaw = Number(props.setmusicvolume);
      const volume = Number.isFinite(volRaw) ? volRaw : 0.6;

      const loopRaw = props.setmusicloop;
      const loop =
        loopRaw === undefined
          ? true
          : loopRaw === true || String(loopRaw).toLowerCase() === "true";

      if (setOnceKey) {
        const onceFlag = this._flagKey("__set_music_once", this.scene.key, id, pickKey);
        if (this._getAnyFlag(onceFlag) !== true) {
          this.setSceneMusic(pickKey, { volume, loop, fadeMs, persist });
          this._setAnyFlag(onceFlag, true);
        }
      } else {
        this.setSceneMusic(pickKey, { volume, loop, fadeMs, persist });
      }
    }

    const tileLayer = String(props.tileremovelayer ?? "").trim();
    if (tileLayer) {
      const it = this.interactables.find((x) => x.id === id);
      const c = it?.center ?? objCenter(it?._tiledObj);
      if (c) {
        this._removeTileAtWorld(c.x, c.y, tileLayer);
        this._setAnyFlag(this._tileRemovedFlag(this.scene.key, id), true);
      }
    }

    for (const lname of splitCsv(props.hidelayer ?? props.hidelayers)) {
      const layer = this.layers?.[lname];
      layer?.setVisible?.(false);
      setLayerHidden(this.scene.key, lname, true);
    }

    for (const lname of splitCsv(props.showlayer ?? props.showlayers)) {
      const layer = this.layers?.[lname];
      layer?.setVisible?.(true);
      setLayerHidden(this.scene.key, lname, false);
    }

    for (const item of splitCsv(props.giveitem)) addItem(item, 1);

    for (const item of splitCsv(props.giveitemonce)) {
      const k = this._flagKey("__give_once", this.scene.key, id, item);
      if (this._getAnyFlag(k) === true) continue;
      addItem(item, 1);
      this._setAnyFlag(k, true);

      // Code-driven so I don't need extra Tiled properties.
      if (
        String(item ?? "").trim().toLowerCase() === "strawberry" &&
        String(id ?? "").toLowerCase().includes("strawberrybush")
      ) {
        const curRaw = this._getAnyFlag("__strawberryBushes");
        const cur = Number(curRaw);
        const base = Number.isFinite(cur) ? cur : 0;
        this._setAnyFlag("__strawberryBushes", Math.min(4, base + 1));
      }
    }

    for (const item of splitCsv(props.takeitemonce)) {
      const k = this._takeOnceFlag(this.scene.key, id, item);
      if (this._getAnyFlag(k) === true) continue;
      removeItem(item, 1);
      this._setAnyFlag(k, true);
    }

    for (const item of splitCsv(props.takeitem)) removeItem(item, 1);

    for (const cid of splitCsv(props.removecollider ?? props.removecolliders)) this._removeColliderById(cid);

    if (props.helpscore !== undefined) addHelp(Number(props.helpscore) || 0);
    if (props.addscore !== undefined) addScore(Number(props.addscore) || 0);

    const helpedName = String(props.markhelped ?? "").trim();
    if (helpedName) markHelped(helpedName, true);

    // Quest flags + interaction toggles (cross-scene)
    for (const f of splitCsv(props.setflags ?? props.setflag)) {
      const k = String(f ?? "").trim();
      if (!k) continue;
      if (!GameState.flags) GameState.flags = {};
      GameState.flags[k] = true;
    }

    for (const f of splitCsv(props.clearflags ?? props.clearflag)) {
      const k = String(f ?? "").trim();
      if (!k) continue;
      if (!GameState.flags) GameState.flags = {};
      GameState.flags[k] = false;
    }

    const defaultSceneKey = this.scene.key;

    for (const tgtRaw of splitCsv(props.disableinteractions ?? props.disableinteraction)) {
      const tgt = this._parseInteractionTarget(tgtRaw, defaultSceneKey);
      if (!tgt) continue;
      this._setInteractionForcedDisabled(tgt.sceneKey, tgt.id, true);
      // Best-effort: if target is in the current scene, also remove from active list
      if (tgt.sceneKey === defaultSceneKey) {
        this.interactables = this.interactables.filter((it) => it.id !== tgt.id);
      }
    }

    for (const tgtRaw of splitCsv(props.enableinteractions ?? props.enableinteraction)) {
      const tgt = this._parseInteractionTarget(tgtRaw, defaultSceneKey);
      if (!tgt) continue;
      this._setInteractionForcedDisabled(tgt.sceneKey, tgt.id, false);
      this._setInteractionForcedEnabled(tgt.sceneKey, tgt.id, true);
    }

    const disableSelf =
      props.disableself === true || String(props.disableself ?? "").toLowerCase() === "true";
    if (disableSelf) {
      this._setInteractionForcedDisabled(defaultSceneKey, id, true);
      this.interactables = this.interactables.filter((it) => it.id !== id);
    }

    const removeIds = splitCsv(props.removeinteraction);
    if (removeIds.length) {
      for (const rid of removeIds) disableInteraction(rid);
    } else if (props.once === true) {
      disableInteraction(id);
    }

    if (props.once === true || removeIds.includes(id)) {
      this.interactables = this.interactables.filter((it) => it.id !== id);
    }
  }

  // -------------------------
  // Movement + interact selection
  // -------------------------

  findNearestInteractable() {
    const px = this.player.x;
    const py = this.player.y;

    const facing =
      this.facing && (this.facing.x !== 0 || this.facing.y !== 0)
        ? this.facing.clone().normalize()
        : new Phaser.Math.Vector2(0, 1);

    let best = null;
    let bestScore = Infinity;

    for (const it of this.interactables) {
      if (it.selectable === false) continue;
      if (it.isEnabled && !it.isEnabled()) continue;

      const pos = it.getPos ? it.getPos() : null;
      if (!pos) continue;

      const dx = pos.x - px;
      const dy = pos.y - py;

      const d = Math.hypot(dx, dy);
      const baseMax = it.maxDist ?? 22;

      const lookMax = it.lookMaxDist ?? 44;
      const lookMinDot = it.lookMinDot ?? 0.65;

      let ok = d <= baseMax;
      if (!ok && d <= lookMax) {
        const dir = new Phaser.Math.Vector2(dx, dy).normalize();
        ok = facing.dot(dir) >= lookMinDot;
      }

      if (!ok) continue;

      const dir = d > 0 ? new Phaser.Math.Vector2(dx / d, dy / d) : facing;
      const score = d - 6 * facing.dot(dir);

      if (score < bestScore) {
        bestScore = score;
        best = it;
      }
    }

    return best;
  }

  baseUpdateMovement() {
    const speed = 80;
    const body = this.player.body;

    const left = this.keys.left.isDown || this.cursors?.left?.isDown;
    const right = this.keys.right.isDown || this.cursors?.right?.isDown;
    const up = this.keys.up.isDown || this.cursors?.up?.isDown;
    const down = this.keys.down.isDown || this.cursors?.down?.isDown;

    let vx = 0;
    let vy = 0;

    if (left) vx -= 1;
    if (right) vx += 1;
    if (up) vy -= 1;
    if (down) vy += 1;

    body.setVelocity(0);

    if (vx !== 0 || vy !== 0) {
      const v = new Phaser.Math.Vector2(vx, vy).normalize();
      body.setVelocity(v.x * speed, v.y * speed);
      this.facing.copy(v);
    }
  }

  baseUpdateInteract() {
    this.currentInteractable = this.findNearestInteractable();
    this.promptText.setText(this.currentInteractable ? this.currentInteractable.prompt : "");

    const pressed = Phaser.Input.Keyboard.JustDown(this.keys.interact);
    if (!pressed) return;
    if (!this.currentInteractable) return;
    if (!canWorldInteract(this)) return;

    this.currentInteractable.action();
  }

  _tickGlobalRealTime() {
    const delta = this.game?.loop?.delta ?? 0;
    if (!Number.isFinite(delta) || delta <= 0) return;
    GameState.realTimeMs = (GameState.realTimeMs ?? 0) + delta;
  }

  baseUpdateFrame({ allowMovement = true } = {}) {
    this._updatePickHint();
    this._updateDebugOverlay();

    if (this.keys?.pick && Phaser.Input.Keyboard.JustDown(this.keys.pick)) this._toggleTilePicker();

    // PAUSE global timer while dialogue is active
    if (this.dialogue?.isActive?.()) {
      this.player.body.setVelocity(0);
      this.promptText.setText("");

      // keep zone ambience alive if standing still
      this._updateAmbienceZones();

      this.updateFollowers();
      this.updateMovingNpcs();
      this._syncNpcLabels();
      this.updateNpcsLookAtPlayer();

      this._updatePlayerAnim();
      return false;
    }

    // Tick real-time only when not in dialogue
    this._tickGlobalRealTime();

    if (allowMovement) {
      this._prevPlayerPos = { x: this.player.x, y: this.player.y };
      this.baseUpdateMovement();
    }

    // Auto-trigger zones (walk-in triggers + zone audio)
    updateAutoTriggerZones(this);

    // Ambience zones (walk-in loop)
    this._updateAmbienceZones();

    this.baseUpdateInteract();
    this.updateFollowers();
    this.updateMovingNpcs();
    this._syncNpcLabels();
    this.updateNpcsLookAtPlayer();

    this._updatePlayerAnim();
    return true;
  }

  // -------------------------
  // TilePicker
  // -------------------------

  _sceneKeyExists(sceneKey) {
    return !!this.scene?.manager?.keys?.[sceneKey];
  }

  _canOpenTilePicker() {
    const k = this.activeTilesetKey;
    if (!k) return false;
    if (!this.textures.exists(k)) return false;
    if (!this._sceneKeyExists("TilePickerScene")) return false;
    return true;
  }

  _updatePickHint() {
    if (!this.pickHintText) return;
    this.pickHintText.setText(this._canOpenTilePicker() ? "" : "");
  }

  _updateDebugOverlay() {
    if (!this.debugText) return;
    const ms = GameState.realTimeMs ?? 0;
    const s = Math.floor(ms / 1000);
    const ending = typeof GameState.realTimeMs === "number" ? ms >= 8 * 60 * 1000 : false;
    this.debugText.setText(`RealTime: ${s}s`);
  }

  _toggleTilePicker() {
    if (!this._canOpenTilePicker()) return;
    const tilesetKey = this.activeTilesetKey;
    const returnScene = this.scene.key;

    if (!this.scene.isActive("TilePickerScene")) {
      this.scene.launch("TilePickerScene", {
        tilesetKey,
        returnScene,
        packed: true,
        tileW: 16,
        tileH: 16,
        spacing: 0,
        margin: 0,
      });
    }

    this.scene.pause(returnScene);
    this.scene.bringToTop("TilePickerScene");
  }

  // -------------------------
  // Followers helpers
  // -------------------------

  pushTrailIfMoved() {
    const dx = this.player.x - this.lastTrailX;
    const dy = this.player.y - this.lastTrailY;
    const dist = Math.hypot(dx, dy);
    if (dist < this.TRAIL_PUSH_MIN_DIST) return;

    this.lastTrailX = this.player.x;
    this.lastTrailY = this.player.y;

    this.playerTrail.push({ x: this.player.x, y: this.player.y });
    if (this.playerTrail.length > this.TRAIL_MAX) this.playerTrail.shift();
  }

  updateFollowers() {
    if (!this.followers.length) return;

    this.pushTrailIfMoved();

    for (let i = 0; i < this.followers.length; i++) {
      const delay = this.TRAIL_STEP * (i + 1);
      const needed = delay + 1;
      const f = this.followers[i];

      if (this.playerTrail.length < needed) {
        f.rect.x = this.player.x;
        f.rect.y = this.player.y + (i + 1) * this.FOLLOWER_FALLBACK_SPACING;
      } else {
        const idx = Math.max(0, this.playerTrail.length - 1 - delay);
        const p = this.playerTrail[idx];
        f.rect.x = p.x;
        f.rect.y = p.y;
      }

      this._updateFollowerAnim(f, f.rect.x, f.rect.y);

      f.label.x = f.rect.x - 9;
      f.label.y = f.rect.y + 9;
    }
  }
}
