import EpilogueText from "../systems/EpilogueText.js";
import { GameState } from "../systems/GameState.js";

export default class EpilogueMinusHelpScene extends Phaser.Scene {
  constructor() {
    super("EpilogueMinusHelpScene");
  }

  create() {
    this.cameras.main.setBackgroundColor("#000000");
    const ep = new EpilogueText(this, { typingSpeedMs: 26, autoAdvance: true, allowManualAdvance: false });

    ep.start(
      [
        "…",
        "You made it.",
        "But you left a trail of little hurts behind you.",
        "",
        `HelpScore: ${GameState.helpScore}`,
        "",
        "Napper looks at you for a long time.",
        "He still asks the question…",
        "but the room feels colder.",
        "",
        "ENDING: MINUS HELP",
      ],
      () => {
        GameState.flags.minusHelpEndingSeen = true;
      }
    );
  }
}
