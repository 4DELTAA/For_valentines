import BootScene from "./scenes/BootScene.js";

import CityScene from "./scenes/CityScene.js";
import ForestScene from "./scenes/ForestScene.js";
import LibraryScene from "./scenes/LibraryScene.js";

import MinesweeperScene from "./scenes/MinesweeperScene.js";
import EpilogueTrueScene from "./scenes/EpilogueTrueScene.js";
import EpilogueNormalScene from "./scenes/EpilogueNormalScene.js";
import EpilogueWorldScene from "./scenes/EpilogueWorldScene.js";
import EpilogueMinusHelpScene from "./scenes/EpilogueMinusHelpScene.js";
import EpilogueSpeedrunScene from "./scenes/EpilogueSpeedrunScene.js";
import EpiloguePartyScene from "./scenes/EpiloguePartyScene.js";

import TilePickerScene from "./scenes/TilePickerScene.js";

const BASE_W = 480;
const BASE_H = 270;

function computeIntegerZoom() {
  const z = Math.min(
    Math.floor(window.innerWidth / BASE_W),
    Math.floor(window.innerHeight / BASE_H)
  );
  return Math.max(1, z);
}

const config = {
  type: Phaser.AUTO,
  width: BASE_W,
  height: BASE_H,
  pixelArt: true,
  roundPixels: true,

  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: BASE_W,
    height: BASE_H,
    zoom: computeIntegerZoom(), // keeps pixel art crisp when possible
  },

  physics: {
    default: "arcade",
    arcade: { debug: false },
  },

  scene: [
    BootScene,
    CityScene,
    ForestScene,
    LibraryScene,
    MinesweeperScene,
    EpilogueTrueScene,
    EpilogueNormalScene,
    EpilogueWorldScene,
    EpilogueSpeedrunScene,
    EpilogueMinusHelpScene,
    EpiloguePartyScene,
    TilePickerScene,
  ],
};

const game = new Phaser.Game(config);

// Recompute zoom on resize (optional but nice)
window.addEventListener("resize", () => {
  const z = computeIntegerZoom();
  game.scale.setZoom(z);
});
