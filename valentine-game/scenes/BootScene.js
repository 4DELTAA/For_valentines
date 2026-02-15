  import { ASSETS } from "../systems/Assets.js";

  export default class BootScene extends Phaser.Scene {
    constructor() {
      super("BootScene");
    }

    preload() {
      this.cameras.main.setBackgroundColor("#000000");

      const label = this.add.text(10, 10, "Loading...", { fontSize: "10px", fill: "#ffffff" });
      const barBg = this.add.rectangle(160, 95, 280, 10, 0xffffff, 0.15);
      const bar = this.add.rectangle(20, 95, 0, 8, 0xffffff, 0.7).setOrigin(0, 0.5);

      this.load.on("progress", (p) => {
        bar.width = Math.floor(280 * p);
        label.setText(`Loading... ${Math.floor(p * 100)}%`);
      });

      this.load.on("loaderror", (file) => {
        console.error("LOAD ERROR:", file?.key, file?.src);
        label.setText(`LOAD ERROR: ${file?.key}\n${file?.src}`);
      });


      const v = Date.now();

      // Maps
      this.load.tilemapTiledJSON(ASSETS.maps.city.key, `${ASSETS.maps.city.url}?v=${v}`);
      this.load.tilemapTiledJSON(ASSETS.maps.forest.key, `${ASSETS.maps.forest.url}?v=${v}`);
      this.load.tilemapTiledJSON(ASSETS.maps.library.key, `${ASSETS.maps.library.url}?v=${v}`);

      // Tilesets
      this.load.image(ASSETS.tilesets.cityTerrain.key, ASSETS.tilesets.cityTerrain.url);
      this.load.image(ASSETS.tilesets.cityObjects.key, ASSETS.tilesets.cityObjects.url);

      this.load.image(ASSETS.tilesets.forestTerrain.key, ASSETS.tilesets.forestTerrain.url);
      this.load.image(ASSETS.tilesets.forestObjects.key, ASSETS.tilesets.forestObjects.url);

      this.load.image(ASSETS.tilesets.library.key, ASSETS.tilesets.library.url);

      // Player spritesheet
  const p = ASSETS.spritesheets.player;
  this.load.spritesheet(p.key, `${p.url}?v=${v}`, {
    frameWidth: p.frameWidth,
    frameHeight: p.frameHeight,
  });

    
  // Spritesheets (player + NPCs)
for (const def of Object.values(ASSETS.spritesheets ?? {})) {
  this.load.spritesheet(def.key, `${def.url}?v=${v}`, {
    frameWidth: def.frameWidth,
    frameHeight: def.frameHeight,
    spacing: def.spacing ?? 0,
    margin: def.margin ?? 0,
  });
}


      

      // SFX
      for (const def of Object.values(ASSETS.sfx ?? {})) {
        if (!def?.key || !def?.url) continue;
        this.load.audio(def.key, `${def.url}?v=${v}`);
      }
    }

    create() {
      this.scene.start("CityScene");
      console.log("BootScene loaded npc_aloise?", this.textures.exists("npc_aloise"));
console.log("BootScene loaded keys:", this.textures.getTextureKeys());

    }
  }
