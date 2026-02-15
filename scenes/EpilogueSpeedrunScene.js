import EpilogueText from "../systems/EpilogueText.js";
import { GameState } from "../systems/GameState.js";

export default class EpilogueSpeedrunScene extends Phaser.Scene {
  constructor() {
    super("EpilogueSpeedrunScene");
  }

  create() {
    this.cameras.main.setBackgroundColor("#000000");
    const ep = new EpilogueText(this, { typingSpeedMs: 24, autoAdvance: true, allowManualAdvance: false });

    const t = Math.floor((GameState.flags?.minesweeperEntryMs ?? GameState.realTimeMs ?? 0) / 1000);

    ep.start(
      [
        "…",
        "You practically sprinted here.",
        `You reached the mine in ${t}s.`,
        "",
        "Napper blinks like he wasn't ready.",
        "But then he laughs.",
        "",
        "Speed can be its own kind of courage.",
        "",
        "ENDING: SPEEDRUN",
      ],
      () => {
        GameState.flags.speedrunEndingSeen = true;
      }
    );
  }
}
