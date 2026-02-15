import EpilogueText from "../systems/EpilogueText.js";
import { GameState } from "../systems/GameState.js";

export default class EpilogueNormalScene extends Phaser.Scene {
  constructor() {
    super("EpilogueNormalScene");
  }

  create() {
    this.cameras.main.setBackgroundColor("#000000");
    const ep = new EpilogueText(this, { typingSpeedMs: 26, autoAdvance: true, allowManualAdvance: false });

    ep.start(
      [
        "…",
        "You made it.",
        "Some things were messy.",
        "But you showed up anyway.",
        "",
        `HelpScore: ${GameState.helpScore}`,
        "",
        "THE END: (Normal ending)",
        
      ],
      null
    );
  }
}
