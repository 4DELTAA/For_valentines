import EpilogueText from "../systems/EpilogueText.js";
import { GameState } from "../systems/GameState.js";

export default class EpilogueTrueScene extends Phaser.Scene {
  constructor() {
    super("EpilogueTrueScene");
  }

  create() {
    this.cameras.main.setBackgroundColor("#000000");
    const ep = new EpilogueText(this, { typingSpeedMs: 18, autoAdvance: true, allowManualAdvance: false });

    ep.start(
      [
        "…",
        "You made Napper confess to you.",
        "The hairpin caught his eye.",
        "The love letter made him laugh.",
        "You completed the full board.",
        "You helped everyone.",
        "Maybe it wasn't a perfect 100 score.",
        "But it was still enough for him.",
        "",
        `HelpScore: ${GameState.helpScore}`,
        "",
        "THE END: TRUE ENDING",
        
      ],
      null
    );
  }
}
