import BaseExploreScene, { DEPTH } from "./BaseExploreScene.js";
import {
  GameState,
  addScore,
  addHelp,
  setFlag,
  markHelped,
  isHelped,
  setTransition,
  markSceneProgress,
  onLeaveScene,
} from "../systems/GameState.js";
import { ASSETS } from "../systems/Assets.js";

function safePoint(scene, layerName, name, fallback) {
  return scene.getTiledPoint(layerName, name) ?? fallback;
}

export default class CityScene extends BaseExploreScene {
  constructor() {
    super("CityScene");

    this.questMarkers = {};
    this.animeShopPos = { x: 0, y: 0 };
    this.gladAlleyPos = null;
    this.gladLampPos = null;
  }

  create() {
    this.baseCreate({
      title: "City",
      spawnX: 32,
      spawnY: 112,
      tiled: {
        mapKey: ASSETS.maps.city.key,
        tilesets: [
          { name: "Kenney city", key: ASSETS.tilesets.cityTerrain.key, spacing: 0, margin: 0 },
          // { name: "sprout_objects_tileset_16", key: ASSETS.tilesets.cityObjects.key, spacing: 0, margin: 0 },
        ],
        objectLayers: { colliders: "Collideables", interactables: "Interactables" },

        // The ONLY layer that should be above player in City:
        overPlayerLayers: ["TileOverPlayer"],

        collisionTileLayers: [],
        setActiveTilesetKey: ASSETS.tilesets.cityTerrain.key,
      },
      playerBody: { w: 10, h: 10, ox: 3, oy: 6 },
    });

    // Scene music
    this.setSceneMusic("city", { volume: 0.2, loop: true, fadeInMs: 250 });


    // If City.tmj uses "Points"
    const P = "Points";

    // Spawn selection
    const t = GameState.transition;
    const spawnDefault = safePoint(this, P, "spawnpoint", { x: 32, y: 112 });
    const spawnFromForest = safePoint(this, P, "spawn_from_forest", spawnDefault);

    let spawn = spawnDefault;
    if (t?.fromScene === "ForestScene") spawn = spawnFromForest;

    this.player.x = spawn.x;
    this.player.y = spawn.y;

    // NPC positions
    const xiaPos = safePoint(this, P, "npc_xia", { x: 80, y: 112 });
    const aloisePos = safePoint(this, P, "npc_aloise", { x: 96, y: 240 });
    const gladPos = safePoint(this, P, "npc_glad", { x: 256, y: 128 });

    this.gladAlleyPos = safePoint(this, P, "npc_glad_at_alleyway", safePoint(this, P, "glad_at_alleyway", null));
    this.gladLampPos = safePoint(this, P, "npc_glad_at_lampost", null);

    this.animeShopPos = safePoint(this, P, "anime_shop", { x: 400, y: 112 });

    // NPCs
    this.xia = this.makeNPC(xiaPos.x, xiaPos.y, "Xia");

    // Aloise: after escort completes, she should be gone permanently on re-enter.
    const aloiseEscortDone = GameState.flags.__aloiseEscortDone === true;
    if (!aloiseEscortDone) {
      this.aloise = this.makeNPC(aloisePos.x, aloisePos.y, "Aloise");
      if (!this.textures.exists("npc_aloise")) {
        console.warn('[CityScene] Missing texture key "npc_aloise". Add it to ASSETS.spritesheets and ensure BootScene loads spritesheets.');
      }
      if (GameState.flags.aloiseFollowing) this.hideNPC(this.aloise);
    } else {
      this.aloise = null;
    }

    this.glad = this.makeNPC(gladPos.x, gladPos.y, "Glad");
    this.registerSpawnedNpc("Glad", this.glad);
    // Exit to forest
    const exitForest = safePoint(this, P, "exit_to_forest", { x: this.map.widthInPixels - 16, y: 160 });
    this.addDoorZone(
      exitForest.x,
      exitForest.y,
      18,
      50,
      "→ Forest",
      exitForest.x - 52,
      exitForest.y - 20,
      "Press Z to enter Forest",
      () => this._goToForest()
    );

    // World label (ensure above tiles/overlays)
    this.addWorldText(this.animeShopPos.x - 26, this.animeShopPos.y - 18, "Anime Shop", {
      fontSize: "7px",
      fill: "#aaaaaa",
    });

    this._registerNPCInteractables();
    this._buildQuestMarkers();

    this._updateHUD();
    this._updateQuestMarkers();
  }

  _buildQuestMarkers() {
    const mk = (npc) => {
      if (!npc || !npc.rect) return null;
      return this.add
        .text(npc.rect.x - 2, npc.rect.y - 18, "!", { fontSize: "14px", fill: "#ffffff" })
        .setDepth(DEPTH.WORLD_TEXT)
        .setVisible(false);
    };

    this.questMarkers = {
      xia: mk(this.xia),
      aloise: mk(this.aloise),
      glad: mk(this.glad),
    };
  }

  _updateQuestMarkers() {
    const qm = this.questMarkers ?? {};

    if (qm.xia) qm.xia.setVisible(!isHelped("Xia"));

    if (qm.aloise && this.aloise?.rect) {
      const aloiseNeeds = !isHelped("Aloise") && !GameState.flags.aloiseFollowing;
      qm.aloise.setVisible(aloiseNeeds && this.aloise.rect.visible);
    }

    if (qm.glad && this.glad?.rect) {
      const gladNeeds = !isHelped("Glad");
      qm.glad.setVisible(gladNeeds && this.glad.rect.visible);
    }

    for (const [k, m] of Object.entries(qm)) {
      if (!m) continue;
      const npc = this[k];
      if (!npc?.rect) continue;
      m.x = npc.rect.x - 2;
      m.y = npc.rect.y - 18 + Math.round(Math.sin(this.time.now / 250) * 1);
    }
  }

  _registerNPCInteractables() {
    const addNpcTalk = (npc, name, talkFn) => {
      if (!npc?.rect) return;
      this.interactables.push({
        getPos: () => ({ x: npc.rect.x, y: npc.rect.y }),
        maxDist: 22,
        prompt: `Press Z to talk to ${name}`,
        isEnabled: () => npc.rect.visible && !this.isSpawnedNpcMoving(npc),
        action: talkFn,
      });
    };

    addNpcTalk(this.xia, "Xia", () => this._talkXia());

    const aloiseTiledActive = !GameState.interactions?.disabled?.Aloise;
    if (aloiseTiledActive) addNpcTalk(this.aloise, "Aloise", () => this._talkAloise());

    addNpcTalk(this.glad, "Glad", () => this._talkGlad());
  }

  update() {
    const alive = this.baseUpdateFrame();
    if (!alive) return;

    this._updateHUD();
    this._updateQuestMarkers();

    if (GameState.flags.aloiseFollowing) {
      const af = this.followers.find((f) => f.name === "Aloise");
      if (af) {
        const d = Phaser.Math.Distance.Between(af.rect.x, af.rect.y, this.animeShopPos.x, this.animeShopPos.y);
        if (d < 18) this._finishAloiseEscort();
      }
    }
  }

  _goToForest() {
    onLeaveScene("CityScene");
    setTransition("CityScene", "ForestScene", "toForest");
    this.cameras.main.fadeOut(250);
    this.cameras.main.once("camerafadeoutcomplete", () => this.scene.start("ForestScene"));
  }

  _updateHUD() {
    this.hudText.setText(
      `HelpScore: ${GameState.helpScore}`
    );
  }

  _talkXia() {
    if (isHelped("Xia")) {
      this.dialogue.start(
        [
          { type: "say", speaker: "Xia", text: "Oh. Hi again." },
          { type: "pause", ms: 450 },
          { type: "say", speaker: "Xia", text: "Thanks for earlier." },
          { type: "end" },
        ],
        this.keys,
        () => {
          this._updateHUD();
          this._updateQuestMarkers();
        }
      );
      return;
    }

    const script = [
      { type: "say", speaker: "Xia", text: "Hey." },
      { type: "pause", ms: 500 },
      { type: "say", speaker: "Xia", text: "This is embarrassing but..." },
      { type: "pause", ms: 700 },
      {
        type: "choice",
        prompt: "Do you think he even likes me?",
        options: [
          { text: "He does. You're overthinking.", next: 5 },
          { text: "Uh... maybe ask him?", next: 8 },
        ],
      },
      { type: "say", speaker: "Xia", text: "Oh." },
      { type: "pause", ms: 450 },
      { type: "say", speaker: "Xia", text: "Okay. That actually helps." },
      { type: "pause", ms: 600 },
      { type: "say", speaker: "Xia", text: "Here—take this heart hairpin." },
      { type: "end" },

      { type: "say", speaker: "Xia", text: "..." },
      { type: "pause", ms: 700 },
      { type: "say", speaker: "Xia", text: "Yeah. That makes sense." },
      { type: "pause", ms: 500 },
      { type: "say", speaker: "Xia", text: "Still. Take this hairpin. I can't think straight." },
      { type: "end" },
    ];

    this.dialogue.start(script, this.keys, () => {
      markHelped("Xia", true);
      setFlag("hasHairpin", true);
      addScore(11);
      markSceneProgress("CityScene");
      this._updateHUD();
      this._updateQuestMarkers();
    });
  }

  _talkAloise() {
    if (isHelped("Aloise")) {
      this.dialogue.start(
        [
          { type: "say", speaker: "Aloise", text: "I am inside the anime shop now." },
          { type: "pause", ms: 600 },
          { type: "say", speaker: "Aloise", text: "I have achieved peace." },
          { type: "end" },
        ],
        this.keys
      );
      return;
    }

    if (GameState.flags.aloiseFollowing) {
      this.dialogue.start(
        [
          { type: "say", speaker: "Aloise", text: "I am still lost." },
          { type: "pause", ms: 600 },
          { type: "say", speaker: "Aloise", text: "But now I'm lost with momentum." },
          { type: "end" },
        ],
        this.keys
      );
      return;
    }

    const script = [
      { type: "say", speaker: "Aloise", text: "Hi. I am... very lost." },
      { type: "pause", ms: 650 },
      { type: "say", speaker: "Aloise", text: "This city is shaped like anxiety." },
      { type: "pause", ms: 700 },
      {
        type: "choice",
        prompt: "Can you guide me to an anime shop?",
        options: [
          {
            text: "Yes.",
            next: 5,
            onSelect: () => {
              setFlag("aloiseFollowing", true);
              this.hideNPC(this.aloise);
              this.syncFollowersFromGameState();
              markSceneProgress("CityScene");
              this._updateHUD();
              this._updateQuestMarkers();
            },
          },
          { text: "No.", next: 8 },
        ],
      },
      { type: "say", speaker: "Aloise", text: "Thank you. I will follow you." },
      { type: "end" },

      { type: "say", speaker: "Aloise", text: "Oh." },
      { type: "pause", ms: 800 },
      { type: "say", speaker: "Aloise", text: "Okay. I will simply orbit this sidewalk then." },
      { type: "end" },
    ];

    this.dialogue.start(script, this.keys, () => this._updateHUD());
  }

  _finishAloiseEscort() {
    if (!GameState.flags.aloiseFollowing || GameState.flags.__aloiseEscortDone) return;

    setFlag("aloiseFollowing", false);
    setFlag("__aloiseEscortDone", true);
    markHelped("Aloise", true);
    addHelp(10);
    markSceneProgress("CityScene");

    this.syncFollowersFromGameState();

    // Aloise NPC should be gone permanently after escort completes.
    if (this.aloise?.rect) {
      try { this.aloise.rect.destroy(); } catch (_) {}
      try { this.aloise.label?.destroy?.(); } catch (_) {}
    }
    this.aloise = null;
    if (this.questMarkers?.aloise) {
      try { this.questMarkers.aloise.destroy(); } catch (_) {}
      this.questMarkers.aloise = null;
    }

    this._updateHUD();
    this._updateQuestMarkers();

    const script = [
      { type: "say", speaker: "Aloise", text: "This is it." },
      { type: "pause", ms: 600 },
      { type: "say", speaker: "Aloise", text: "Anime. Everywhere." },
      { type: "pause", ms: 650 },
      { type: "say", speaker: "Aloise", text: "I am going inside." },
      { type: "pause", ms: 650 },
      { type: "say", speaker: "Aloise", text: "Do not wait for me." },
      { type: "end" },
    ];

    this.dialogue.start(script, this.keys);
  }

  _talkGlad() {
    if (isHelped("Glad")) {
      this.dialogue.start(
        [
          { type: "say", speaker: "Glad", text: "I am still hiding." },
          { type: "pause", ms: 650 },
          { type: "say", speaker: "Glad", text: "The city is full of eyes." },
          { type: "end" },
        ],
        this.keys
      );
      return;
    }

    const script = [
      { type: "say", speaker: "Glad", text: "Psst." },
      { type: "pause", ms: 600 },
      { type: "say", speaker: "Glad", text: "I have a stalker. Do not ask follow-up questions." },
      { type: "pause", ms: 700 },
      {
        type: "choice",
        prompt: "Where should I hide?",
        options: [
          {
            text: "Lamp post.",
            next: 5,
            onSelect: () => {
              addScore(-5);
              markHelped("Glad", true);
              setFlag("gladOutcome", "bad");
              markSceneProgress("CityScene");
              if (this.gladLampPos) this.moveNPC(this.glad, this.gladLampPos.x, this.gladLampPos.y);
              this._updateHUD();
              this._updateQuestMarkers();
            },
          },
          {
            text: "Alley.",
            next: 8,
            onSelect: () => {
              addHelp(10);
              markHelped("Glad", true);
              setFlag("gladOutcome", "good");
              markSceneProgress("CityScene");
              if (this.gladAlleyPos) this.moveNPC(this.glad, this.gladAlleyPos.x, this.gladAlleyPos.y);
              this._updateHUD();
              this._updateQuestMarkers();
            },
          },
        ],
      },
      { type: "say", speaker: "Glad", text: "That is the worst hiding spot I have ever heard." },
      { type: "pause", ms: 700 },
      { type: "say", speaker: "Glad", text: "She's going to find me in 0.2 seconds." },
      { type: "end" },

      { type: "say", speaker: "Glad", text: "Okay." },
      { type: "pause", ms: 500 },
      { type: "say", speaker: "Glad", text: "You understand fear. Respect." },
      { type: "end" },
    ];

    this.dialogue.start(script, this.keys);
  }
}
