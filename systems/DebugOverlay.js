import { ASSETS } from "./Assets.js";

const UI_DEPTH = 100000;

export default class DebugOverlay {
  static attach(scene, getActiveTilesetKey = () => null) {
    // Put overlay in a UI container that always stays on top
    const ui = scene.add.container(0, 0).setScrollFactor(0).setDepth(UI_DEPTH);
    scene.children.bringToTop(ui);

    const text = scene.add
      .text(6, scene.cameras.main.height - 6, "", {
        fontSize: "8px",
        fill: "#00ff9d",
        backgroundColor: "#000000aa",
      })
      .setOrigin(0, 1)
      .setScrollFactor(0)
      .setDepth(UI_DEPTH);

    ui.add(text);

    const update = () => {
      const exists = (k) => (k ? scene.textures.exists(k) : false);

      // ✅ these keys exist in your ASSETS.js
      const kCity = ASSETS.tilesets.cityTerrain.key;
      const kForest = ASSETS.tilesets.forestTerrain.key;
      const kLib = ASSETS.tilesets.library.key;

      const active = getActiveTilesetKey?.() ?? "";
      text.setText(
        [
          `ts_city: ${exists(kCity) ? "YES" : "NO"}`,
          `ts_forest: ${exists(kForest) ? "YES" : "NO"}`,
          `ts_library: ${exists(kLib) ? "YES" : "NO"}`,
          active ? `active: ${active}` : "",
        ]
          .filter(Boolean)
          .join(" | ")
      );

      ui.setDepth(UI_DEPTH);
      scene.children.bringToTop(ui);
    };

    update();
    scene.events.on("update", update);

    scene.events.once("shutdown", () => {
      scene.events.off("update", update);
      ui.destroy(true);
    });

    return text;
  }
}
