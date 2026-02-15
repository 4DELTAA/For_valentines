import DialogueBox from "../systems/DialogueBox.js";
import { ensureCharacterAnims, playCharacterAnim } from "../systems/CharacterAnims.js";
import { GameState, addScore, setFlag, isTrueReady, canWorldInteract } from "../systems/GameState.js";
import { ASSETS } from "../systems/Assets.js";


export default class MinesweeperScene extends Phaser.Scene {
  constructor() {
    super("MinesweeperScene");
    this._bgm = null;
    this._bgmKey = "";
  }


  _pickEndingScene(defaultSceneKey) {
    const flags = GameState.flags ?? {};
    const helpScore = Number(GameState.helpScore ?? 0);

    // Priority: minus help overrides speedrun.
    if (helpScore < 0) return "EpilogueMinusHelpScene";

    const entryMs = Number(flags.minesweeperEntryMs ?? NaN);
    const isSpeedrun = Number.isFinite(entryMs) && entryMs <= 60_000;
    if (isSpeedrun) return "EpilogueSpeedrunScene";

    const hasParty = flags.sagaJoined === true && flags.aloiseFollowing === true;
    if (hasParty) return "EpiloguePartyScene";

    return defaultSceneKey;
  }

  _audioExists(key) {
    return !!this.cache?.audio?.exists?.(key);
  }

  _resolveAudioKey(nameOrKey) {
    const s = String(nameOrKey ?? "").trim();
    if (!s) return "";
    if (this._audioExists(s)) return s;

    const def = ASSETS.sfx?.[s];
    const mapped = def?.key ?? "";
    if (mapped && this._audioExists(mapped)) return mapped;

    return "";
  }

  _playBgm() {
    const key = this._resolveAudioKey("minesweeper") || this._resolveAudioKey("sfx_minesweeper");
    // Diagnostics: show whether audio is locked by autoplay policy.
    try {
      console.log("[MinesweeperScene] sound.locked?", this.sound?.locked, "key:", key);
    } catch (_) {}

    if (this.sound?.locked) {
      this.input.once("pointerdown", () => {
        try { this.sound.unlock(); } catch (_) {}
        try { this.sound.context?.resume?.(); } catch (_) {}
        this._playBgm();
      });
      return;
    }

    try { this.sound.context?.resume?.(); } catch (_) {}
    if (!key) {
      console.warn("[MinesweeperScene] minesweeper music missing. Expected ASSETS.sfx.minesweeper.key='sfx_minesweeper' and audio preloaded.");
      // Helpful diagnostics
      try { console.log("[MinesweeperScene] cache has sfx_minesweeper?", this._audioExists("sfx_minesweeper")); } catch (_) {}
      return;
    }

    if (this._bgmKey === key && this._bgm?.isPlaying) return;

    this._stopBgm();
    this._bgmKey = key;
    this._bgm = this.sound.add(key, { loop: true, volume: 0.35 });
    this._bgm.__sceneOwned = true;
    try {
      this._bgm.play();
      console.log("[MinesweeperScene] bgm started?", this._bgm?.isPlaying, "volume:", this._bgm?.volume);
    } catch (e) {
      console.error("[MinesweeperScene] play() failed:", e);
    }
  }

  _stopBgm() {
    if (this._bgm) {
      try { this._bgm.stop(); } catch (_) {}
      try { this._bgm.destroy(); } catch (_) {}
    }
    this._bgm = null;
    this._bgmKey = "";
  }


  create() {
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this._stopBgm());
    this.events.once(Phaser.Scenes.Events.DESTROY, () => this._stopBgm());
    this._playBgm();

    this.cameras.main.setBackgroundColor("#050505");

    this.add.text(10, 10, "Minesweeper Area", { fontSize: "8px", fill: "#ffffff" });
    this.hudText = this.add.text(10, 22, "", { fontSize: "8px", fill: "#aaaaaa" });
    this.promptText = this.add.text(10, 160, "", { fontSize: "8px", fill: "#ffffff" });

    this.dialogue = new DialogueBox(this, { width: 300, height: 70, typingSpeedMs: 18 });

    this.keys = this.input.keyboard.addKeys({
      up: "W",
      down: "S",
      left: "A",
      right: "D",
      interact: "Z",
    });

    // Board config
    this.cell = 16;
    this.cols = 18;
    this.rows = 9;

    this.gridOriginX = 16;
    this.gridOriginY = 32;

    this.startCell = { c: 1, r: 7 };
    this.napperCell = { c: 16, r: 1 };

    // Tile palette
    this.tileColorA = 0xe5c29f; // #e5c29f
    this.tileColorB = 0xd7b899; // #d7b899
    this.borderAlpha = 0.08;
    this.floorAlpha = 0.28;

    // Number colors
    this.numColor = {
      1: "#1976d2",
      2: "#348d39",
      3: "#d32b2c",
      other: "#ffffff",
    };

    // Fixed bombs for this scene
    this.bombs = new Set([
      "3,7",
      "4,6",
      "5,6",
      "7,5",
      "8,5",
      "9,4",
      "11,3",
      "12,3",
      "13,2",
      "6,2",
      "5,3",
      "4,4",
      "10,6",
      "12,6",
      "14,5",
    ]);

    this.revealed = Array.from({ length: this.rows }, () => Array(this.cols).fill(false));

    // Visual grid
    this.tiles = [];
    this.numberTexts = [];
    for (let r = 0; r < this.rows; r++) {
      this.tiles[r] = [];
      this.numberTexts[r] = [];
      for (let c = 0; c < this.cols; c++) {
        const x = this.gridOriginX + c * this.cell + this.cell / 2;
        const y = this.gridOriginY + r * this.cell + this.cell / 2;

        const isBorder = c === 0 || r === 0 || c === this.cols - 1 || r === this.rows - 1;

        let fill = 0xffffff;
        let alpha = isBorder ? this.borderAlpha : this.floorAlpha;

        if (!isBorder) {
          const isEven = (c + r) % 2 === 0;
          fill = isEven ? this.tileColorA : this.tileColorB;
        }

        const rect = this.add.rectangle(x, y, this.cell - 1, this.cell - 1, fill, alpha);
        rect.setStrokeStyle(1, 0x000000, isBorder ? 0.0 : 0.12);
        this.tiles[r][c] = rect;

        const t = this.add.text(x - 3, y - 5, "", { fontSize: "10px", fill: "#ffffff" });
        t.setAlpha(0.0);
        this.numberTexts[r][c] = t;
      }
    }

    GameState.flags.minesweeperBoardCleared = GameState.flags.minesweeperBoardCleared ?? false;
    this.safeTotal = this._countSafeTiles();
    this.safeRevealed = 0;

    // Character sprites + anims
    this.playerCell = { ...this.startCell };
    this._trail = [];
    this._playerFacing = "down";

    this.player = this._makeCharSprite(["player"], 0xffffff, 1.0, 12, 12);
    this.player.setDepth(20);
    this._syncGameObjectToCell(this.player, this.playerCell);

    // Followers (transparent trail)
    this.followers = [];
    this._initFollowers();

    // Napper
    this.napper = this._makeCharSprite(["npc_napper", "napper"], 0xffffff, 1.0, 14, 14);
    this.napper.setDepth(15);
    this._syncGameObjectToCell(this.napper, this.napperCell);

    this.napperLabel = this.add.text(0, 0, "Napper", { fontSize: "7px", fill: "#aaaaaa" });
    this.napperLabel.setDepth(16);
    this._syncNapperLabel();

    // Setup animations if sprites exist
    this._ensureAnimsForSprite(this.player, "player");
    this._ensureAnimsForSprite(this.napper, this._spriteKey(this.napper));
    for (const f of this.followers) this._ensureAnimsForSprite(f.spr, f.texKey);

    this._setFacing(this.player, "player", this._playerFacing, false);

    // Saga help
    this._sagaHelpRects = new Map();
    this._initSagaHelp();

    // Input pacing
    this.moveCooldownUntil = 0;
    this.MOVE_COOLDOWN_MS = 120;

    this._revealAt(this.playerCell.c, this.playerCell.r, true);
    this._updateHUD();
    this._updateNapperFacing();
  }

  update() {
    if (this.dialogue.isActive()) {
      this.promptText.setText("");
      return;
    }

    this._updateHUD();
    this._updateNapperFacing();

    const nearNapper = this.playerCell.c === this.napperCell.c && this.playerCell.r === this.napperCell.r;
    this.promptText.setText(nearNapper ? "Press Z" : "");

    if (nearNapper && canWorldInteract(this, this.keys.interact) && Phaser.Input.Keyboard.JustDown(this.keys.interact)) {
      this._talkToNapper();
      return;
    }

    if (this.time.now < this.moveCooldownUntil) return;

    let dc = 0;
    let dr = 0;
    if (Phaser.Input.Keyboard.JustDown(this.keys.left)) dc = -1;
    else if (Phaser.Input.Keyboard.JustDown(this.keys.right)) dc = 1;
    else if (Phaser.Input.Keyboard.JustDown(this.keys.up)) dr = -1;
    else if (Phaser.Input.Keyboard.JustDown(this.keys.down)) dr = 1;

    if (dc !== 0 || dr !== 0) {
      this.moveCooldownUntil = this.time.now + this.MOVE_COOLDOWN_MS;
      this._tryMove(dc, dr);
    }
  }

  // ---------------------------------------------------------------------------
  // Sprite + animation helpers
  // ---------------------------------------------------------------------------

  _spriteKey(go) {
    if (!go || go.type !== "Sprite") return "";
    // Phaser stores key on texture
    return go.texture?.key ?? "";
  }

  _makeCharSprite(keys, fallbackColor, alpha, w, h) {
    for (const k of keys) {
      if (k && this.textures.exists(k)) {
        const spr = this.add.sprite(0, 0, k, 1);
        spr.setAlpha(alpha);
        spr.setOrigin(0.5, 0.5);
        return spr;
      }
    }
    return this.add.rectangle(0, 0, w, h, fallbackColor, alpha);
  }

  _ensureAnimsForSprite(go, sheetKey) {
    if (!go || go.type !== "Sprite") return;
    if (!sheetKey) return;
    try {
      ensureCharacterAnims(this, sheetKey, { prefix: sheetKey });
    } catch (_) {
      // Keep sprite visible even if anim creation fails for a non-standard sheet.
    }
  }

  _setFacing(go, sheetKey, dir, walking) {
    if (!go || go.type !== "Sprite") return;
    if (!sheetKey) sheetKey = this._spriteKey(go) || "player";
    try {
      playCharacterAnim(go, sheetKey, dir, walking);
    } catch (_) {
      // Fallback: at least flip horizontally
      if (typeof go.setFlipX === "function") {
        if (dir === "left") go.setFlipX(true);
        else if (dir === "right") go.setFlipX(false);
      }
    }
  }

  _dirFromDelta(dc, dr) {
    if (Math.abs(dc) > Math.abs(dr)) return dc < 0 ? "left" : "right";
    if (dr < 0) return "up";
    return "down";
  }

  _syncGameObjectToCell(go, cell) {
    go.x = this.gridOriginX + cell.c * this.cell + this.cell / 2;
    go.y = this.gridOriginY + cell.r * this.cell + this.cell / 2;
  }

  _initFollowers() {
    const wantSaga = !!GameState.flags.sagaJoined;
    const wantAloise = !!GameState.flags.aloiseFollowing;

    const followerSpecs = [];
    if (wantSaga) followerSpecs.push({ id: "Saga", texKey: "npc_saga" });
    if (wantAloise) followerSpecs.push({ id: "Aloise", texKey: "npc_aloise" });

    this.followers = followerSpecs.map((s, idx) => {
      const spr = this._makeCharSprite([s.texKey], 0xffffff, 0.45, 10, 10); // transparent followers
      spr.setDepth(19 - idx);
      return { id: s.id, texKey: s.texKey, spr, facing: "down" };
    });

    // Initialize trail
    this._trail = [];
    for (let i = 0; i < 12; i++) this._trail.push({ ...this.playerCell });
    this._syncFollowersToTrail();
  }

  _syncFollowersToTrail() {
    for (let i = 0; i < this.followers.length; i++) {
      const pos = this._trail[i + 1] ?? this.playerCell;
      this._syncGameObjectToCell(this.followers[i].spr, pos);
    }
  }

  _pushTrail(cell) {
    this._trail.unshift({ ...cell });
    const keep = Math.max(12, this.followers.length + 4);
    this._trail.length = Math.min(this._trail.length, keep);
  }

  // ---------------------------------------------------------------------------
  // Grid logic
  // ---------------------------------------------------------------------------

  _isWalkable(c, r) {
    if (c <= 0 || r <= 0 || c >= this.cols - 1 || r >= this.rows - 1) return false;
    return true;
  }

  _countSafeTiles() {
    let total = 0;
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (!this._isWalkable(c, r)) continue;
        if (this.bombs.has(`${c},${r}`)) continue;
        total++;
      }
    }
    return total;
  }

  _tryMove(dc, dr) {
    const nc = this.playerCell.c + dc;
    const nr = this.playerCell.r + dr;

    if (nc < 0 || nr < 0 || nc >= this.cols || nr >= this.rows) return;
    if (!this._isWalkable(nc, nr)) return;

    // Update trail BEFORE moving.
    this._pushTrail(this.playerCell);

    this.playerCell = { c: nc, r: nr };

    // Face + brief walk anim
    this._playerFacing = this._dirFromDelta(dc, dr);
    this._setFacing(this.player, "player", this._playerFacing, true);

    this._syncGameObjectToCell(this.player, this.playerCell);
    this._syncFollowersToTrail();

    // Followers briefly walk in the same direction as Mimi, then return to idle.
    for (const f of this.followers) {
      f.facing = this._playerFacing;
      this._setFacing(f.spr, f.texKey, f.facing, true);
    }

    // Return to idle after a short moment (player + followers)
    this.time.delayedCall(this.MOVE_COOLDOWN_MS * 0.9, () => {
      this._setFacing(this.player, "player", this._playerFacing, false);
      for (const f of this.followers) this._setFacing(f.spr, f.texKey, f.facing, false);
    });

    if (this.bombs.has(`${nc},${nr}`)) {
      this.cameras.main.shake(140, 0.006);

      this.tiles[nr][nc].setFillStyle(0xffffff, 0.35);
      this.time.delayedCall(120, () => {
        this._restoreTileVisual(nc, nr);
      });

      // Reset to start
      this.playerCell = { ...this.startCell };
      this._trail = [];
      for (let i = 0; i < 12; i++) this._trail.push({ ...this.playerCell });
      this._syncGameObjectToCell(this.player, this.playerCell);
      this._syncFollowersToTrail();

      this._playerFacing = "down";
      this._setFacing(this.player, "player", this._playerFacing, false);

      this._revealAt(this.playerCell.c, this.playerCell.r, true);
      return;
    }

    this._revealAt(nc, nr, true);
    this._maybeRunSagaStepEvent(nc, nr);
  }

  _restoreTileVisual(c, r) {
    const isBorder = c === 0 || r === 0 || c === this.cols - 1 || r === this.rows - 1;
    if (isBorder) {
      this.tiles[r][c].setFillStyle(0xffffff, this.borderAlpha);
      return;
    }
    const isEven = (c + r) % 2 === 0;
    const fill = isEven ? this.tileColorA : this.tileColorB;
    const alpha = this.revealed[r][c] ? 0.55 : this.floorAlpha;
    this.tiles[r][c].setFillStyle(fill, alpha);
  }

  _revealAt(c, r, expand) {
    if (this.revealed[r][c]) return;
    if (this.bombs.has(`${c},${r}`)) return;

    this.revealed[r][c] = true;
    this.safeRevealed += 1;

    this._clearSagaHighlight(c, r);

    // Brighten revealed tile
    const isEven = (c + r) % 2 === 0;
    const fill = isEven ? this.tileColorA : this.tileColorB;
    this.tiles[r][c].setFillStyle(fill, 0.55);

    const n = this._adjacentBombs(c, r);
    if (n > 0) {
      const fillStyle = this.numColor[n] ?? this.numColor.other;
      this.numberTexts[r][c].setText(String(n));
      this.numberTexts[r][c].setStyle({ fill: fillStyle });
      this.numberTexts[r][c].setAlpha(0.95);
    } else {
      this.numberTexts[r][c].setText("");
      this.numberTexts[r][c].setAlpha(0);
      if (expand) this._revealNeighbors3x3(c, r);
    }

    if (!GameState.flags.minesweeperBoardCleared && this.safeRevealed >= this.safeTotal) {
      setFlag("minesweeperBoardCleared", true);

      // Reward once for clearing the board (+8 HelpScore).
      if (!GameState.flags.__ms_help_rewarded) {
        GameState.flags.__ms_help_rewarded = true;
        GameState.helpScore += 8;
      }

      this.cameras.main.flash(180, 255, 255, 255);
    }
  }

  _revealNeighbors3x3(c, r) {
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dc === 0 && dr === 0) continue;
        const nc = c + dc;
        const nr = r + dr;

        if (nc < 0 || nr < 0 || nc >= this.cols || nr >= this.rows) continue;
        if (!this._isWalkable(nc, nr)) continue;

        this._revealAt(nc, nr, false);
      }
    }
  }

  _adjacentBombs(c, r) {
    let count = 0;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dc === 0 && dr === 0) continue;
        const nc = c + dc;
        const nr = r + dr;
        if (nc < 0 || nr < 0 || nc >= this.cols || nr >= this.rows) continue;
        if (this.bombs.has(`${nc},${nr}`)) count++;
      }
    }
    return count;
  }

  _updateHUD() {
    const saga = GameState.flags.sagaJoined ? "YES" : "no";
    const board = GameState.flags.minesweeperBoardCleared ? "CLEARED" : `${this.safeRevealed}/${this.safeTotal}`;
    const trueOk = isTrueReady() && GameState.flags.minesweeperBoardCleared;
    this.hudText.setText(
      `HelpScore: ${GameState.helpScore}
      Board: ${board}`
    );
  }

  // ---------------------------------------------------------------------------
  // Napper: look at player (4-dir)
  // ---------------------------------------------------------------------------

  _syncNapperLabel() {
    if (!this.napperLabel) return;
    this.napperLabel.x = this.napper.x - 12;
    this.napperLabel.y = this.napper.y + 10;
  }

  _updateNapperFacing() {
    this._syncNapperLabel();
    if (!this.napper || this.napper.type !== "Sprite") return;

    const dx = this.player.x - this.napper.x;
    const dy = this.player.y - this.napper.y;

    let dir = "down";
    if (Math.abs(dx) > Math.abs(dy)) dir = dx < 0 ? "left" : "right";
    else dir = dy < 0 ? "up" : "down";

    this._setFacing(this.napper, this._spriteKey(this.napper), dir, false);
  }

  // ---------------------------------------------------------------------------
  // Saga help
  // ---------------------------------------------------------------------------

  _initSagaHelp() {
    if (!GameState.flags.sagaJoined) return;

    if (GameState.flags.__ms_saga_step1_done) this._maybeAddSagaHint(5, 5);
    if (GameState.flags.__ms_saga_step2_done) this._maybeAddSagaHint(7, 3);
    if (GameState.flags.__ms_saga_step3_done) this._maybeAddSagaHint(6, 7);
  }

  _isSafeUnrevealed(c, r) {
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return false;
    if (!this._isWalkable(c, r)) return false;
    if (this.bombs.has(`${c},${r}`)) return false;
    if (this.revealed?.[r]?.[c]) return false;
    return true;
  }

  _maybeAddSagaHint(c, r) {
    if (!this._isSafeUnrevealed(c, r)) {
      this._clearSagaHighlight(c, r);
      return false;
    }
    this._ensureSagaHighlight(c, r);
    return true;
  }

  _ensureSagaHighlight(c, r) {
    const key = `${c},${r}`;
    if (this._sagaHelpRects.has(key)) return;

    const rect = this.add.rectangle(0, 0, this.cell - 3, this.cell - 3, 0xffff00, 0.22);
    rect.setStrokeStyle(1, 0xffff00, 0.55);
    rect.setDepth(12);
    this._syncGameObjectToCell(rect, { c, r });

    this._sagaHelpRects.set(key, rect);
  }

  _clearSagaHighlight(c, r) {
    const key = `${c},${r}`;
    const rect = this._sagaHelpRects.get(key);
    if (!rect) return;
    rect.destroy();
    this._sagaHelpRects.delete(key);
  }

  _maybeRunSagaStepEvent(c, r) {
    if (!GameState.flags.sagaJoined) return;

    if (c === 4 && r === 5 && !GameState.flags.__ms_saga_step1_done) {
      GameState.flags.__ms_saga_step1_done = true;
      this._maybeAddSagaHint(5, 5);
      const script = [{ type: "say", speaker: "Saga", text: "Mimi, I know this sounds crazy, but step on that." }, { type: "end" }];
      this.dialogue.start(script, this.keys);
      return;
    }

    if (c === 6 && r === 3 && !GameState.flags.__ms_saga_step2_done) {
      GameState.flags.__ms_saga_step2_done = true;
      this._maybeAddSagaHint(7, 3);
      const script = [{ type: "say", speaker: "Saga", text: "Saga points at another tile she believes to be safe" }, { type: "end" }];
      this.dialogue.start(script, this.keys);
      return;
    }

    if (c === 6 && r === 6 && !GameState.flags.__ms_saga_step3_done) {
      GameState.flags.__ms_saga_step3_done = true;
      this._maybeAddSagaHint(6, 7);
      const script = [{ type: "say", speaker: "Saga", text: "You trust me right?" }, { type: "end" }];
      this.dialogue.start(script, this.keys);
    }
  }

  // ---------------------------------------------------------------------------
  // Napper dialogue + easter egg
  // ---------------------------------------------------------------------------

  _talkToNapper() {
    const bothFollowers = !!GameState.flags.sagaJoined && !!GameState.flags.aloiseFollowing;
    if (bothFollowers && !GameState.flags.__ms_napper_easteregg) {
      GameState.flags.__ms_napper_easteregg = true;

      const egg = [
        { type: "say", speaker: "Napper", text: "…" },
        { type: "pause", ms: 450 },
        { type: "say", speaker: "Napper", text: "You brought… a committee." },
        { type: "pause", ms: 450 },
        { type: "say", speaker: "Aloise", text: "This is not a committee." },
        { type: "pause", ms: 450 },
        { type: "say", speaker: "Saga", text: "It’s a committee." },
        { type: "end" },
      ];

      this.dialogue.start(egg, this.keys, () => this._talkToNapper());
      return;
    }

    setFlag("minesweeperCleared", true);

    const trueEligible = isTrueReady() && GameState.flags.minesweeperBoardCleared;

    if (trueEligible) {
      GameState.helpScore = 88;

      const script = [
        { type: "say", speaker: "Napper", text: "…" },
        { type: "pause", ms: 700 },
        { type: "say", speaker: "Napper", text: "Hey." },
        { type: "pause", ms: 700 },
        { type: "say", speaker: "Napper", text: "Do you want to be my valentine?" },
        { type: "choice", prompt: "", options: [{ text: "Yes", next: 6 }, { text: "No", next: 7 }] },
        { type: "end" },

        { type: "say", speaker: "Napper", text: "…" },
        { type: "pause", ms: 800 },
        { type: "say", speaker: "Napper", text: "Okay. But like…" },
        { type: "pause", ms: 600 },
        { type: "say", speaker: "Napper", text: "Do you want to be my valentine?" },
        { type: "choice", prompt: "", options: [{ text: "Yes", next: 6 }, { text: "No", next: 7 }] },
      ];

      this.dialogue.start(script, this.keys, () => {
        addScore(12);
        this.scene.start(this._pickEndingScene("EpilogueTrueScene"));
      });
      return;
    }

    if (isTrueReady() && !GameState.flags.minesweeperBoardCleared) {
      const script = [
        { type: "say", speaker: "Napper", text: "…" },
        { type: "pause", ms: 700 },
        { type: "say", speaker: "Napper", text: "You’re here." },
        { type: "pause", ms: 600 },
        { type: "say", speaker: "Napper", text: "But the board isn’t cleared." },
        { type: "pause", ms: 800 },
        { type: "say", speaker: "Napper", text: "Go. Finish it." },
        { type: "end" },
      ];
      this.dialogue.start(script, this.keys);
      return;
    }

    const script = [
      { type: "say", speaker: "Napper", text: "…" },
      { type: "pause", ms: 800 },
      { type: "say", speaker: "Napper", text: "You made it." },
      { type: "pause", ms: 700 },
      {
        type: "choice",
        prompt: "Say something?",
        options: [
          { text: "Will you be my valentine?", next: 6 },
          { text: "…(awkward silence)", next: 10 },
        ],
      },
      { type: "end" },

      { type: "say", speaker: "Napper", text: "Yeah." },
      { type: "pause", ms: 600 },
      { type: "say", speaker: "Napper", text: "Of course." },
      { type: "end" },

      { type: "say", speaker: "Napper", text: "…" },
      { type: "pause", ms: 900 },
      { type: "say", speaker: "Napper", text: "You okay?" },
      { type: "pause", ms: 600 },
      { type: "say", speaker: "Napper", text: "I’ll still say yes." },
      { type: "end" },
    ];

    this.dialogue.start(script, this.keys, () => {
      this.scene.start(this._pickEndingScene("EpilogueNormalScene"));
    });
  }
}
