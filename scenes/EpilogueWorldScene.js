import EpilogueText from "../systems/EpilogueText.js";
import { GameState } from "../systems/GameState.js";

export default class EpilogueWorldScene extends Phaser.Scene {
  constructor() {
    super("EpilogueWorldScene");
  }

    create() {
    this.cameras.main.setBackgroundColor("#000000");
    const ep = new EpilogueText(this, {
      typingSpeedMs: 42,
      autoAdvance: true,
      allowManualAdvance: false,
    });

    ep.start(
      [

        "…",
        "You waited too long.",
        "The place you were supposed to meet him is quiet now.",
        "",
        "Maybe you spent some time helping others.",
        "Maybe you made some new friends.",
        "But in the end, you were alone.",
        ,
        `TimePassed: ${GameState.timePassed}`,
        `HelpScore: ${GameState.helpScore}`,
        "",
            ],
      () => {
        const inv = GameState.inventory ?? {};
        const helpScore = Number(GameState.helpScore ?? 0);
        if (helpScore < 0) {
          this.scene.start("EpilogueMinusHelpScene");
          return;
        }

        const flags = GameState.flags ?? {};

        const hasSaga = flags.sagaJoined === true;
        const hasAloise = flags.aloiseFollowing === true;
        const hasPartyEnding = hasSaga && hasAloise;

        const hasHairRibbon =
          !!flags.hasHairpin ||
          (Number(inv.hairribbon ?? inv.hairRibbon ?? inv.HairRibbon ?? 0) > 0);

        const hasLoveLetter =
          Number(inv.loveletter ?? inv.loveLetter ?? inv.LoveLetter ?? inv.Loveletter ?? 0) > 0;

        const hasMinesweeperClear = !!flags.minesweeperBoardCleared;
        const enoughHelp = Number(GameState.helpScore ?? 0) >= 88;

        const isTrue = hasHairRibbon && hasLoveLetter && hasMinesweeperClear && enoughHelp;
        console.log("[TRUE ENDING CHECK]", {
  helpScore: GameState.helpScore,
  minesweeperBoardCleared: GameState.flags?.minesweeperBoardCleared,
  hasHairpin: GameState.flags?.hasHairpin,
  inventory: GameState.inventory,
  loveletter: GameState.inventory?.loveletter,
  loveLetter: GameState.inventory?.loveLetter,
  LoveLetter: GameState.inventory?.LoveLetter,
});

        this.scene.start(hasPartyEnding ? "EpiloguePartyScene" : (isTrue ? "EpilogueTrueScene" : "EpilogueNormalScene"));
}
    );
  }

}
