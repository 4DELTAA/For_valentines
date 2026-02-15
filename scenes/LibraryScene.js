import BaseExploreScene from "./BaseExploreScene.js";
import {
  GameState,
  addHelp,
  markHelped,
  isHelped,
  setTransition,
  markSceneProgress,
  onLeaveScene,
  isWorldEnding,
  setLayerHidden,
} from "../systems/GameState.js";
import { ASSETS } from "../systems/Assets.js";

export default class LibraryScene extends BaseExploreScene {
  constructor() {
    super("LibraryScene");
    this._lastMusicMood = "";
  }

  /**
   * Single-direction idle-loop NPC (no facing system).
   * Expects `texKey` to be a spritesheet with frames.
   * Returns `{ rect, label, name, isSprite, animKey }` to match existing interactable usage.
   */
  makeIdleLoopNPC(x, y, name, texKey, opts = {}) {
    const animKey = String(opts.animKey ?? `${texKey}_idle`);
    const frames = Array.isArray(opts.frames) ? opts.frames : [0, 1, 2, 3];
    const frameRate = Number(opts.frameRate ?? 4);
    const repeat = Number.isFinite(opts.repeat) ? Number(opts.repeat) : -1;

    const scale = Number(opts.scale ?? 1);
    const originX = Number(opts.originX ?? 0.5);
    const originY = Number(opts.originY ?? 0.8);
    const depth = Number(opts.depth ?? 999);

    if (!this.anims.exists(animKey)) {
      this.anims.create({
        key: animKey,
        frames: frames.map((f) => ({ key: texKey, frame: f })),
        frameRate,
        repeat,
      });
    }

    const spr = this.add.sprite(x, y, texKey, frames[0]);
    spr.setDepth(depth);
    spr.setScale(scale);
    spr.setOrigin(originX, originY);
    spr.play(animKey);

    const label = this.addWorldText(
      x - 10,
      y + 10,
      name,
      { fontSize: "7px", fill: "#aaaaaa" },
      { depth: depth + 1 }
    );

    return {
      rect: spr,
      label,
      name,
      isSprite: true,
      animKey,
    };
  }

  create() {
    this.baseCreate({
      title: "Giant Library",
      spawnX: 60,
      spawnY: 60,
      playerBody: { w: 12, h: 14, ox: 2, oy: 2 },

      // ✅ Library only: default zoom 1.0
      cameraZoom: 1.0,

      tiled: {
        mapKey: ASSETS.maps.library.key,
        tilesets: [
          {
            name: "libassetpack-tiled",
            key: ASSETS.tilesets.library.key,
            spacing: 0,
            margin: 0,
            tileW: 24,
            tileH: 24,
          },
        ],
        objectLayers: { colliders: "Collideables" },

        overPlayerLayers: [
          "Objects downstairs 2",
          "Objects downstairs 1",
          "After cleaning",
          "Decor downstairs 3",
          "Decor downstairs 2",
          "Decor downstairs 1",
          "Blocking Bookshelf",
        ],

        setActiveTilesetKey: ASSETS.tilesets.library.key,
        collisionTileLayers: [],
      },
    });

    const P = "Points";

    // Spawn-from-forest support for Tiled (point)
    const spawnFromForest = this.getTiledPoint(P, "spawn_from_forest");
    if (GameState.transition?.fromScene === "ForestScene" && spawnFromForest) {
      this.player.x = spawnFromForest.x;
      this.player.y = spawnFromForest.y;
      this.player.body.reset(spawnFromForest.x, spawnFromForest.y);
    }

    // NPC points
    const snoopyPos = this.getTiledPoint(P, "npc_snoopy");
    const aresPos = this.getTiledPoint(P, "npc_ares");
    const leafeonPos = this.getTiledPoint(P, "npc_leafeon");

    // Snoopy: custom idle loop (single direction, 4 frames)
    this.snoopy = this.makeIdleLoopNPC(snoopyPos?.x ?? 140, snoopyPos?.y ?? 120, "Snoopy", "npc_snoopy", {
      frames: [0, 1, 2, 3],
      frameRate: 4,
      originY: 0.8,
      scale: 1,
    });

    // Others: keep standard NPC system
    this.ares = this.makeNPC(aresPos?.x ?? 120, aresPos?.y ?? 160, "Ares");
    this.registerSpawnedNpc("Ares", this.ares);
    this.leafeon = this.makeNPC(leafeonPos?.x ?? 220, leafeonPos?.y ?? 150, "Leafeon");
    this.registerSpawnedNpc("Leafeon", this.leafeon);

    // Doors
    const exitForest = this.getTiledPoint(P, "exit_to_forest");
    const exitMine = this.getTiledPoint(P, "exit_to_minesweeper");

    if (exitForest) {
      this.addDoorZone(
        exitForest.x,
        exitForest.y,
        24,
        48,
        "← Forest",
        exitForest.x + 18,
        exitForest.y - 18,
        "Press Z to return to Forest",
        () => this._goToForest()
      );
    }

    if (exitMine) {
      this.addDoorZone(
        exitMine.x,
        exitMine.y,
        24,
        48,
        "→ Mine",
        exitMine.x - 60,
        exitMine.y - 18,
        "Press Z to enter Mine",
        () => this._goToMine()
      );
    }

    // Per-scene flags container
    GameState.flags = GameState.flags ?? {};
    GameState.flags.library = GameState.flags.library ?? {};
    GameState.flags.library.aresFlipBookDone = !!GameState.flags.library.aresFlipBookDone;
    GameState.flags.library.aresFlipAresDone = !!GameState.flags.library.aresFlipAresDone;

    // Start correct music now
    this._updateLibraryMusic(true);

    this._registerNPCInteractables();
    this._updateHUD();
  }

  update() {
    const alive = this.baseUpdateFrame();
    if (!alive) return;

    // Swap music when mood flips (8 minutes global time)
    this._updateLibraryMusic(false);

    this._updateHUD();
  }

  _libraryMood() {
    return isWorldEnding() ? "sad" : "happy";
  }

  _updateLibraryMusic(force = false) {
    const mood = this._libraryMood();
    if (!force && mood === this._lastMusicMood) return;

    this._lastMusicMood = mood;

    if (mood === "sad") {
      this.setSceneMusic("library_lost", { volume: 0.4, loop: true });
    } else {
      this.setSceneMusic("library_happy", { volume: 0.4, loop: true });
    }
  }

  _registerNPCInteractables() {
    const addNpcTalk = (npc, name, talkFn) => {
      this.interactables.push({
        id: `npc_${name.toLowerCase()}_talk`,
        selectable: true,
        getPos: () => ({ x: npc.rect.x, y: npc.rect.y }),
        maxDist: 26,
        prompt: `Press Z to talk to ${name}`,
        isEnabled: () => npc.rect.visible,
        action: talkFn,
      });
    };

  //  addNpcTalk(this.snoopy, "Snoopy", () => this._talkSnoopy());
  //  addNpcTalk(this.ares, "Ares", () => this._talkAres());
  //  addNpcTalk(this.leafeon, "Leafeon", () => this._talkLeafeon());
  }

  _goToForest() {
    onLeaveScene("LibraryScene");
    setTransition("LibraryScene", "ForestScene", "toForest");
    this.scene.start("ForestScene");
  }

  _goToMine() {
    // After 8 minutes global time (paused during dialogue), entering Mine triggers EpilogueWorldScene.
    if (isWorldEnding()) {
      this.scene.start("EpilogueWorldScene");
      return;
    }

    // Record first time the player reaches the mine entrance (speedrun uses this).
    if (GameState.flags.minesweeperEntryMs == null) {
      GameState.flags.minesweeperEntryMs = GameState.realTimeMs ?? 0;
    }

    // Endings decided immediately on entering the mine from the Library.
    // Priority: minus-help overrides speedrun.
    if ((GameState.helpScore ?? 0) < 0) {
      onLeaveScene("LibraryScene");
      this.scene.start("EpilogueMinusHelpScene");
      return;
    }

    if ((GameState.realTimeMs ?? 0) <= 60_000) {
      onLeaveScene("LibraryScene");
      this.scene.start("EpilogueSpeedrunScene");
      return;
    }

    onLeaveScene("LibraryScene");
    setTransition("LibraryScene", "MinesweeperScene", "toMine");
    this.scene.start("MinesweeperScene");
  }

  _updateHUD() {
    const seconds = Math.floor((GameState.realTimeMs ?? 0) / 1000);
    this.hudText.setText(
      `HelpScore: ${GameState.helpScore}`
    );
  }

  // ---------------------------------------------------------------------------
  // Helpers: party + layer persistence
  // ---------------------------------------------------------------------------

  _partyTag() {
    const hasAloise = !!GameState.flags.aloiseFollowing;
    const hasSaga = !!GameState.flags.sagaJoined;

    if (hasAloise && hasSaga) return "ALOISE_SAGA";
    if (hasAloise) return "ALOISE";
    if (hasSaga) return "SAGA";
    return "NONE";
  }

  _setLayerVisiblePersist(layerName, isVisible) {
    const layer = this.layers?.[layerName];
    if (layer) layer.setVisible(!!isVisible);
    setLayerHidden(this.scene.key, layerName, !isVisible);
  }

  _hideAnyOfThese(names) {
    for (const n of names) {
      if (this.layers?.[n]) this._setLayerVisiblePersist(n, false);
    }
  }

  _swapLayersPersist(hideLayerName, showLayerName) {
    this._setLayerVisiblePersist(hideLayerName, false);
    this._setLayerVisiblePersist(showLayerName, true);
  }

  _flipAresVisualTest() {
    const r = this.ares?.rect;
    if (!r) return;
    const sy = r.scaleY ?? 1;
    r.setScale(r.scaleX ?? 1, -sy);
  }

  // ---------------------------------------------------------------------------
  // Snoopy
  // ---------------------------------------------------------------------------

  _talkSnoopy() {
    if (isHelped("Snoopy")) {
      const variant = this._partyTag();
      const extra =
        variant === "ALOISE_SAGA"
          ? "Aloise and Saga look like they want to nap here too."
          : variant === "ALOISE"
          ? "Aloise looks like she’s never taken a break in her life."
          : variant === "SAGA"
          ? "Saga is staring into nothing. Respectfully."
          : "The library air is heavy.";

      this.dialogue.start(
        [
          { type: "say", speaker: "Snoopy", text: "I took a break." },
          { type: "say", speaker: "Snoopy", text: extra },
          { type: "end" },
        ],
        this.keys
      );
      return;
    }

    const script = [
      { type: "say", speaker: "Snoopy", text: "I feel exhausted." }, // 0
      {
        type: "choice", // 1
        prompt: "What do you do?",
        options: [
          {
            text: "Help Snoopy",
            next: 2,
            onSelect: () => {
              markHelped("Snoopy", true);
              addHelp(10);
              markSceneProgress("LibraryScene");

              this._setLayerVisiblePersist("After cleaning", true);

              this._hideAnyOfThese(["Object downstairs 0", "Objects downstairs 0"]);
              this._hideAnyOfThese(["Object downstairs 1", "Objects downstairs 1"]);
              this._hideAnyOfThese(["Object downstairs 2", "Objects downstairs 2"]);
            },
          },
          { text: "Mind your own business", next: 4 },
        ],
      },
      { type: "say", speaker: "Snoopy", text: "Thanks... seriously." }, // 2
      { type: "end" }, // 3
      { type: "say", speaker: "Snoopy", text: "Okay..." }, // 4
      { type: "end" }, // 5
    ];

    this.dialogue.start(script, this.keys, () => this._updateHUD());
  }

  _talkLeafeon() {
    if (GameState.npcsHelped?.Leafeon) {
      this.dialogue.start([{ type: "say", speaker: "Leafeon", text: "Math is scary." }, { type: "end" }], this.keys);
      return;
    }

    const script = [
      { type: "say", speaker: "Leafeon", text: "2(3x+5)−4=10" }, // 0
      {
        type: "choice", // 1
        prompt: "What is x?",
        options: [
          {
            text: "x = 4",
            next: 2,
            onSelect: () => {
              markHelped("Leafeon", "4");
              addHelp(10);
              markSceneProgress("LibraryScene");
            },
          },
          {
            text: "x = -4",
            next: 2,
            onSelect: () => {
              markHelped("Leafeon", "-4");
              addHelp(10);
              markSceneProgress("LibraryScene");
            },
          },
        ],
      },
      { type: "say", speaker: "Leafeon", text: "Correct." }, // 2
      { type: "end" }, // 3
    ];

    this.dialogue.start(script, this.keys, () => this._updateHUD());
  }

  _talkAres() {
    const st = GameState.flags.library;

    if (st.aresFlipBookDone && st.aresFlipAresDone) {
      const variant = this._partyTag();
      const extra =
        variant === "ALOISE_SAGA"
          ? "Aloise: “We should not flip people.” Saga: “Counterpoint.”"
          : variant === "ALOISE"
          ? "Aloise looks offended by the concept of upside-downness."
          : variant === "SAGA"
          ? "Saga looks like she wants to flip the whole library."
          : "Ares looks calmer now.";

      this.dialogue.start(
        [
          { type: "say", speaker: "Ares", text: "I can read now." },
          { type: "say", speaker: "Ares", text: extra },
          { type: "end" },
        ],
        this.keys
      );
      return;
    }

    let intro = "I can't read this..";
    if (st.aresFlipBookDone && !st.aresFlipAresDone) intro = "The book is readable now. Don't get ideas about flipping me.";
    if (!st.aresFlipBookDone && st.aresFlipAresDone) intro = "Why did you do that. Also... the book still isn't readable.";

    const variant = this._partyTag();
    const bookExtra =
      variant === "ALOISE_SAGA"
        ? "Aloise nods once. Saga claps exactly one time."
        : variant === "ALOISE"
        ? "Aloise: “Finally.”"
        : variant === "SAGA"
        ? "Saga: “It was upside down. That’s illegal.”"
        : "The letters settle into place.";

    const aresExtra =
      variant === "ALOISE_SAGA"
        ? "Aloise: “Stop.” Saga: “Do it again.”"
        : variant === "ALOISE"
        ? "Aloise looks horrified."
        : variant === "SAGA"
        ? "Saga looks impressed. That’s worse."
        : "Ares makes a noise that could be a sigh or a threat.";

    const options = [];

    if (!st.aresFlipBookDone) {
      options.push({
        text: "Flip Book",
        next: 2,
        onSelect: () => {
          st.aresFlipBookDone = true;
          addHelp(10);
          markSceneProgress("LibraryScene");
          this._swapLayersPersist("UpsideDownBook", "BookFlipped");
        },
      });
    } else {
      options.push({ text: "Flip Book (already)", next: 10 });
    }

    if (!st.aresFlipAresDone) {
      options.push({
        text: "Flip Ares",
        next: 5,
        onSelect: () => {
          st.aresFlipAresDone = true;
          addHelp(10);
          markSceneProgress("LibraryScene");
          this._flipAresVisualTest();
        },
      });
    } else {
      options.push({ text: "Flip Ares (already)", next: 12 });
    }

    options.push({ text: "Mind your own business", next: 8 });

    const script = [
      { type: "say", speaker: "Ares", text: intro }, // 0
      { type: "choice", prompt: "What do you do?", options }, // 1

      { type: "say", speaker: "Ares", text: "Oh." }, // 2
      { type: "say", speaker: "Ares", text: bookExtra }, // 3
      { type: "end" }, // 4

      { type: "say", speaker: "Ares", text: "Please don't." }, // 5
      { type: "say", speaker: "Ares", text: aresExtra }, // 6
      { type: "end" }, // 7

      { type: "say", speaker: "Ares", text: "Okay." }, // 8
      { type: "end" }, // 9

      { type: "say", speaker: "Ares", text: "The book is already flipped." }, // 10
      { type: "end" }, // 11

      { type: "say", speaker: "Ares", text: "No." }, // 12
      { type: "end" }, // 13
    ];

    this.dialogue.start(script, this.keys, () => this._updateHUD());
  }
}

