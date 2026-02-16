import BaseExploreScene from "./BaseExploreScene.js";
import { GameState, addHelp, markHelped, setTransition, markSceneProgress, onLeaveScene } from "../systems/GameState.js";
import { ASSETS } from "../systems/Assets.js";

/** @param {any} o */
function centerOfObject(o) {
  if (!o) return null;
  const w = o.width ?? 0;
  const h = o.height ?? 0;
  if ((w <= 0 && h <= 0) || o.point) return { x: o.x ?? 0, y: o.y ?? 0 };
  return { x: (o.x ?? 0) + w / 2, y: (o.y ?? 0) + h / 2 };
}

/** @param {any} o @param {string} key */
function getProp(o, key) {
  const want = String(key ?? "").toLowerCase();
  const props = o?.properties;

  if (Array.isArray(props)) {
    const p = props.find((x) => String(x?.name ?? "").toLowerCase() === want);
    return p?.value;
  }

  if (props && typeof props === "object") {
    for (const [k, v] of Object.entries(props)) {
      if (String(k ?? "").toLowerCase() === want) return v;
    }
  }

  return undefined;
}

function safePoint(scene, layerName, name, fallback) {
  return scene.getTiledPoint(layerName, name) ?? fallback;
}

export default class ForestScene extends BaseExploreScene {
  constructor() {
    super("ForestScene");

    this.DEBUG_TRIGGER_DEPTH = 999999;

    this.roofTriggers = [];
    this.roofTriggerRects = [];

    this.mona = null;
    this.sagaNPC = null;

    this._lastRoofVisibility = true;
  }

  create() {
    // Build the map + player FIRST (this.map is created here)
    this.baseCreate({
      title: "Forest",
      spawnX: this._resolveSpawn().x,
      spawnY: this._resolveSpawn().y,
      tiled: {
        mapKey: ASSETS.maps.forest.key,
        tilesets: [
          { name: "tileset_forest_sproutlands", key: ASSETS.tilesets.forestTerrain.key, spacing: 0, margin: 0 },
          { name: "sprout_objects_tileset_16", key: ASSETS.tilesets.forestObjects.key, spacing: 0, margin: 0 },
        ],
        objectLayers: { colliders: "Collideables", interactables: "Interactables" },
        overPlayerLayers: ["TileOverPlayer","roof"],
        collisionTileLayers: [],
        setActiveTilesetKey: ASSETS.tilesets.forestTerrain.key,
      },
      playerBody: { w: 10, h: 10, ox: 3, oy: 6 },
    });

    this.setSceneMusic("forest", { volume: 0.2, loop: true });

    this._applyPoints();

    // Roof triggers
    this._initRoofTriggersWithDebug();

    // Exits (Points layer): exit_to_city / exit_to_library
    this._registerExitDoors();

    // NPCs (Points layer): npc_mona / npc_saga
    this._initNPCsFromPoints();

    // NPC interactions
    this._registerNPCInteractables();

    this._updateHUD();
  }

  _resolveSpawn() {
    // Spawns in Points layer: spawn_from_city / spawn_from_library
    const fallback = { x: 32, y: 112 };

    const fromScene = String(GameState.transition?.fromScene ?? "");
    const fromExit = String(GameState.transition?.fromExit ?? "");

    if (fromExit === "toForestFromCity") return safePoint(this, "Points", "spawn_from_city", fallback);
    if (fromExit === "toForestFromLibrary") return safePoint(this, "Points", "spawn_from_library", fallback);

    if (fromExit === "toForest" && fromScene === "CityScene") return safePoint(this, "Points", "spawn_from_city", fallback);
    if (fromExit === "toForest" && fromScene === "LibraryScene") return safePoint(this, "Points", "spawn_from_library", fallback);

    // Fallbacks
    if (fromScene === "LibraryScene") return safePoint(this, "Points", "spawn_from_library", fallback);
    return safePoint(this, "Points", "spawn_from_city", fallback);
  }

  _registerExitDoors() {
    const exitToCity = safePoint(this, "Points", "exit_to_city", null);
    if (exitToCity) {
      this.addDoorZone(exitToCity.x, exitToCity.y, 18, 18, "", 0, 0, "Press Z to return to City", () => this._leaveToCity());
    } else {
      console.warn('[ForestScene] Missing Points object "exit_to_city"');
    }

    const exitToLibrary = safePoint(this, "Points", "exit_to_library", null);
    if (exitToLibrary) {
      this.addDoorZone(
        exitToLibrary.x,
        exitToLibrary.y,
        18,
        18,
        "",
        0,
        0,
        "Press Z to enter Library",
        () => this._leaveToLibrary()
      );
    } else {
      console.warn('[ForestScene] Missing Points object "exit_to_library"');
    }
  }

  update() {
    const alive = this.baseUpdateFrame();
    if (!alive) return;

    this._updateRoofVisibility();
    this._updateHUD();
  }

  _updateHUD() {
    const monaCount = Math.min(Number(GameState.flags?.__strawberryBushes ?? 0) || 0, 4);
    this.hudText.setText(
      `HelpScore: ${GameState.helpScore}   
      Mona: ${monaCount}/4`
    );
  }

  _applyPoints() {
    const time = GameState.timePassed ?? 0;
    if (time <= 0) return;
  }

  _leaveToCity() {
    onLeaveScene("ForestScene");

    setTransition("ForestScene", "CityScene", "toCity");

    this.cameras.main.fadeOut(250);
    this.cameras.main.once("camerafadeoutcomplete", () => this.scene.start("CityScene"));
  }

  _leaveToLibrary() {
    onLeaveScene("ForestScene");

    setTransition("ForestScene", "LibraryScene", "toLibrary");

    this.cameras.main.fadeOut(250);
    this.cameras.main.once("camerafadeoutcomplete", () => this.scene.start("LibraryScene"));
  }

  // ---------------------------------------------------------------------------
  // Roof triggers
  // ---------------------------------------------------------------------------

  _initRoofTriggersWithDebug() {
    const ol = this.map.getObjectLayer("RoofTriggers");
    if (!ol?.objects?.length) return;

    this.roofTriggers = [];
    this.roofTriggerRects = [];

    for (const o of ol.objects) {
      const c = centerOfObject(o);
      if (!c) continue;

      const w = o.width ?? 0;
      const h = o.height ?? 0;

      const trigger = {
        x: c.x,
        y: c.y,
        w,
        h,
        hideRoofs: Boolean(getProp(o, "hideroofs") ?? true),
        id: String(getProp(o, "id") ?? o.name ?? ""),
      };

      this.roofTriggers.push(trigger);

      const rect = this.add.rectangle(trigger.x, trigger.y, trigger.w, trigger.h, 0xffffff, 0.08).setDepth(this.DEBUG_TRIGGER_DEPTH);
      this.roofTriggerRects.push(rect);
    }
  }

  _updateRoofVisibility() {
    const p = this.player;
    if (!p) return;

    let inside = null;

    for (const t of this.roofTriggers) {
      if (!t) continue;
      const x0 = t.x - t.w / 2;
      const y0 = t.y - t.h / 2;
      const x1 = x0 + t.w;
      const y1 = y0 + t.h;

      const isInside = p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1;
      if (isInside) {
        inside = t;
        break;
      }
    }

    const wantVisible = inside ? !inside.hideRoofs : true;

    if (wantVisible !== this._lastRoofVisibility) {
      this._lastRoofVisibility = wantVisible;
      this.setRoofsVisible(wantVisible);
    }
  }

  setRoofsVisible(visible) {
    const roof = this.layers?.Roof;
    roof?.setVisible?.(visible);
  }

  _initNPCsFromPoints() {
    const monaP = this.getTiledPoint("Points", "npc_mona") ?? this.getTiledPoint("Points", "mona");
    if (monaP) {
      // Always create Mona (even after done), dialogue handles variant text.
      this.mona = this.makeNPC(monaP.x, monaP.y, "Mona");
    } else {
      console.warn('[ForestScene] Missing Points object "npc_mona"');
    }

    // Saga appears only if not already joined
    if (!GameState.flags?.sagaJoined) {
      const sagaP = this.getTiledPoint("Points", "npc_saga") ?? this.getTiledPoint("Points", "saga");
      if (sagaP) {
        this.sagaNPC = this.makeNPC(sagaP.x, sagaP.y, "Saga");
      } else {
        console.warn('[ForestScene] Missing Points object "npc_saga"');
      }
    } else {
      this.sagaNPC = null;
    }
  }

  // ---------------------------------------------------------------------------
  // NPC interactions
  // ---------------------------------------------------------------------------

  _registerNPCInteractables() {
    const addNpcTalk = (npc, name, talkFn) => {
      if (!npc) return;
      this.interactables.push({
        getPos: () => ({ x: npc.rect.x, y: npc.rect.y }),
        maxDist: 22,
        prompt: `Press Z to talk to ${name}`,
        isEnabled: () => npc.rect.visible,
        action: talkFn,
      });
    };

    addNpcTalk(this.mona, "Mona", () => this._talkMona());

    if (this.sagaNPC) addNpcTalk(this.sagaNPC, "Saga", () => this._talkSaga());
  }

    _talkMona() {
    const sagaHere = !!GameState.flags?.sagaJoined;
    const bushes = Math.min(Number(GameState.flags?.__strawberryBushes ?? 0) || 0, 4);

    if (GameState.npcsHelped.MonaDone) {
      const script = [
        {
          type: "say",
          speaker: "Mona",
          text: "I will tell everyone about this good deed you have done. Thank you once more.",
        },
      ];

      if (sagaHere) {
        script.push({ type: "pause", ms: 350 });
        script.push({ type: "say", speaker: "Saga", text: "Told you strawberries are serious business." });
      }

      script.push({ type: "end" });
      this.dialogue.start(script, this.keys);
      return;
    }

    // Main branching dialogue by bush count
    let monaLine = "";
    if (bushes <= 0)
      monaLine =
        "Hey, can you help me with collecting strawberries? They seem to have a growing effect on me and I have eaten 8 so far. I will be really happy!";
    else if (bushes === 1) monaLine = "Ohh that's good.. I WANT MORE!!!";
    else if (bushes === 2) monaLine = "DON'T STOP WE ARE ALMOST THERE!!";
    else if (bushes === 3) monaLine = "This quantity.. I am still not satisfied. COLLECT ONE MORE!!";
    else monaLine = "Oh my.. This might even be better than Sagas pasta. Thank you, I'm satisfied";

    const script = [{ type: "say", speaker: "Mona", text: monaLine }];

    // Saga custom lines for EVERY stage (0–4)
    if (sagaHere) {
      script.push({ type: "pause", ms: 350 });
      if (bushes <= 0) script.push({ type: "say", speaker: "Saga", text: "Mimi… please don’t encourage her." });
      else if (bushes === 1) script.push({ type: "say", speaker: "Saga", text: "She’s escalating fast." });
      else if (bushes === 2) script.push({ type: "say", speaker: "Saga", text: "Okay—this is officially a problem." });
      else if (bushes === 3) script.push({ type: "say", speaker: "Saga", text: "One more and we’re done. For real." });
      else script.push({ type: "say", speaker: "Saga", text: "Hey! My pasta is still good." });
    }

    script.push({ type: "end" });

    this.dialogue.start(script, this.keys, () => {
      markHelped("Mona", true);

      // Completion when bushes >= 4
      if (bushes >= 4) {
        markHelped("MonaDone", true);
        markSceneProgress("ForestScene");
      }

      this._updateHUD();
    });
  }


  destroyNPC(npc) {
    if (!npc) return;
    npc.rect?.destroy();
    npc.label?.destroy();
  }

  _talkSaga() {
    const script = [
      { type: "say", speaker: "Saga", text: "..." },
      { type: "pause", ms: 450 },
      { type: "say", speaker: "Saga", text: "Oh. Hi." },
      { type: "pause", ms: 450 },
      {
        type: "choice",
        prompt: "Do you want to join me?",
        options: [
          {
            text: "Yes",
            next: 5,
            onSelect: () => {
              if (!GameState.flags) GameState.flags = {};
              GameState.flags.sagaJoined = true;

              this.destroyNPC(this.sagaNPC);
              this.sagaNPC = null;

              this.syncFollowersFromGameState();
              markSceneProgress("ForestScene");
              this._updateHUD();
            },
          },
          { text: "No", next: 9 },
        ],
      },

      // YES branch (index 5)
      { type: "say", speaker: "Saga", text: "Okay." },
      { type: "pause", ms: 350 },
      { type: "say", speaker: "Saga", text: "I will follow you." },
      { type: "end" },

      // NO branch (index 9)
      { type: "say", speaker: "Saga", text: "Oh." },
      { type: "pause", ms: 450 },
      { type: "say", speaker: "Saga", text: "Okay. I will just stand here." },
      { type: "end" },
    ];

    this.dialogue.start(script, this.keys);
  }
}

