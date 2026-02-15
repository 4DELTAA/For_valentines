// scenes/TilePickerScene.js
import { ASSETS } from "../systems/Assets.js";

export default class TilePickerScene extends Phaser.Scene {
  constructor() {
    super("TilePickerScene");
    this.ready = false;
    this.keys = null;

    this._onEsc = null;
    this._onPointerMove = null;
    this._onPointerDown = null;
    this._onSetTileset = null;
  }

  init(data) {
    this.returnScene = data?.returnScene ?? "CityScene";
    this.tilesetKey = data?.tilesetKey ?? (ASSETS?.tilesets?.city?.key ?? "ts_city");
    this.packed = data?.packed ?? true;

    // Allow different tile sizes per tileset
    this.tileW = data?.tileW ?? 16;
    this.tileH = data?.tileH ?? 16;

    // Packed sheets typically spacing=0
    this.spacing = data?.spacing ?? (this.packed ? 0 : 1);
    this.margin = data?.margin ?? 0;
  }

  create() {
    this.cameras.main.setBackgroundColor("#000000");

    this.keys = this.input.keyboard.addKeys({
      up: "W",
      down: "S",
      left: "A",
      right: "D",
      zoomIn: "E",
      zoomOut: "Q",
      back: "ESC",
    });

    // always return by STARTING the scene (not resume),
    // because BaseExploreScene used scene.start() to enter this picker.
    this._onEsc = () => {
      this._cleanupListeners();
      this.scene.start(this.returnScene);
    };
    this.input.keyboard.on("keydown-ESC", this._onEsc);

    if (!this.textures.exists(this.tilesetKey)) {
      this.add.text(
        10,
        10,
        `TilePickerScene: tileset texture not loaded.\n\nExpected texture key: ${this.tilesetKey}\n\nPress ESC to return.`,
        { fontSize: "12px", fill: "#ffb3b3", wordWrap: { width: 300 } }
      );
      this.ready = false;
      return;
    }

    const src = this.textures.get(this.tilesetKey).getSourceImage();

    this.stepX = this.tileW + this.spacing;
    this.stepY = this.tileH + this.spacing;

    // margin support
    this.cols = Math.floor((src.width - this.margin * 2 + this.spacing) / this.stepX);
    this.rows = Math.floor((src.height - this.margin * 2 + this.spacing) / this.stepY);

    this.add.image(0, 0, this.tilesetKey).setOrigin(0, 0);
    this.cameras.main.setBounds(0, 0, src.width, src.height);

    this.cursorRect = this.add.rectangle(0, 0, this.tileW, this.tileH);
    this.cursorRect.setOrigin(0, 0);
    this.cursorRect.setStrokeStyle(1, 0xffffff, 1);
    this.cursorRect.setFillStyle(0x000000, 0);

    this.info = this.add
      .text(10, 10, "", { fontSize: "12px", fill: "#ffffff", backgroundColor: "#000000aa" })
      .setScrollFactor(0);

    this.selected = this.add
      .text(10, 40, "", { fontSize: "12px", fill: "#aaffaa", backgroundColor: "#000000aa" })
      .setScrollFactor(0);

    this.add
      .text(10, 160, "Hover=index | Click=copy | ESC=back | WASD pan | Q/E zoom", {
        fontSize: "10px",
        fill: "#aaaaaa",
        backgroundColor: "#000000aa",
      })
      .setScrollFactor(0);

    this._onPointerMove = (p) => this._updateHover(p);
    this._onPointerDown = (p) => this._select(p);

    this.input.on("pointermove", this._onPointerMove);
    this.input.on("pointerdown", this._onPointerDown);

    // Optional: allow live switching
    this._onSetTileset = (d) => {
      this.tilesetKey = d?.tilesetKey ?? this.tilesetKey;
      this.tileW = d?.tileW ?? this.tileW;
      this.tileH = d?.tileH ?? this.tileH;
      this.spacing = d?.spacing ?? this.spacing;
      this.margin = d?.margin ?? this.margin;

      this.scene.restart({
        returnScene: this.returnScene,
        tilesetKey: this.tilesetKey,
        packed: this.packed,
        tileW: this.tileW,
        tileH: this.tileH,
        spacing: this.spacing,
        margin: this.margin,
      });
    };
    this.events.on("set-tileset", this._onSetTileset);

    // Also clean up if the scene is shut down unexpectedly
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this._cleanupListeners());
    this.events.once(Phaser.Scenes.Events.DESTROY, () => this._cleanupListeners());

    this.ready = true;
  }

  _cleanupListeners() {
    if (this._onEsc) {
      this.input.keyboard.off("keydown-ESC", this._onEsc);
      this._onEsc = null;
    }

    if (this._onPointerMove) {
      this.input.off("pointermove", this._onPointerMove);
      this._onPointerMove = null;
    }

    if (this._onPointerDown) {
      this.input.off("pointerdown", this._onPointerDown);
      this._onPointerDown = null;
    }

    if (this._onSetTileset) {
      this.events.off("set-tileset", this._onSetTileset);
      this._onSetTileset = null;
    }
  }

  update() {
    if (!this.ready || !this.keys) return;

    const cam = this.cameras.main;
    const panSpeed = 6 / cam.zoom;

    if (this.keys.left.isDown) cam.scrollX -= panSpeed;
    if (this.keys.right.isDown) cam.scrollX += panSpeed;
    if (this.keys.up.isDown) cam.scrollY -= panSpeed;
    if (this.keys.down.isDown) cam.scrollY += panSpeed;

    if (Phaser.Input.Keyboard.JustDown(this.keys.zoomIn)) cam.setZoom(Math.min(6, cam.zoom + 0.25));
    if (Phaser.Input.Keyboard.JustDown(this.keys.zoomOut)) cam.setZoom(Math.max(0.5, cam.zoom - 0.25));
  }

  _tileAt(worldX, worldY) {
    if (worldX < 0 || worldY < 0) return null;

    const x = worldX - this.margin;
    const y = worldY - this.margin;
    if (x < 0 || y < 0) return null;

    const c = Math.floor(x / this.stepX);
    const r = Math.floor(y / this.stepY);
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return null;

    const localX = x - c * this.stepX;
    const localY = y - r * this.stepY;
    if (localX >= this.tileW || localY >= this.tileH) return null;

    return {
      c,
      r,
      index: r * this.cols + c,
      x: this.margin + c * this.stepX,
      y: this.margin + r * this.stepY,
    };
  }

  _updateHover(pointer) {
    const t = this._tileAt(pointer.worldX, pointer.worldY);
    if (!t) {
      this.info.setText(`Outside tileset\nCols:${this.cols} Rows:${this.rows}\nTile:${this.tileW}x${this.tileH}`);
      this.cursorRect.setVisible(false);
      return;
    }

    this.cursorRect.setVisible(true);
    this.cursorRect.setPosition(t.x, t.y);
    this.info.setText(
      `Index: ${t.index}\nCol: ${t.c} Row: ${t.r}\nCols:${this.cols} Rows:${this.rows}\nTile:${this.tileW}x${this.tileH}`
    );
  }

  async _select(pointer) {
    const t = this._tileAt(pointer.worldX, pointer.worldY);
    if (!t) return;

    this.selected.setText(`Selected index: ${t.index} (copied if supported)`);

    try {
      await navigator.clipboard.writeText(String(t.index));
    } catch {
      // ignore
    }
  }
}
