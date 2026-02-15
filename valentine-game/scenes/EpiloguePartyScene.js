import EpilogueText from "../systems/EpilogueText.js";
import { GameState } from "../systems/GameState.js";

export default class EpiloguePartyScene extends Phaser.Scene {
  constructor() {
    super("EpiloguePartyScene");
  }

  create() {
    this.cameras.main.setBackgroundColor("#000000");
    const ep = new EpilogueText(this, { typingSpeedMs: 20, autoAdvance: true, allowManualAdvance: false });

    const hs = Number(GameState.helpScore ?? 0);

    ep.start(
      [
        "…",
        "You didn’t make it alone, and instead brought a whole party with you.",
        "",
        "Saga stayed close, and protective.",
        "Aloise kept pace, pretending it wasn’t a big deal that he was never able to go to the anime shop.",
        "",
        "When you hesitate, they don’t push.",
        "They just… remain.",
        "",
        "And somehow that’s enough.",
        "",
        `HelpScore: ${hs}`,
        "",
        "THE END (Together)",
      ],
      null
    );
  }
}
