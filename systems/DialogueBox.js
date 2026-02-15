// systems/DialogueBox.js
import { lockInteract } from "./GameState.js";

const UI_DEPTH = 100000; // must beat any tile layer / marker depth

export default class DialogueBox {
  constructor(scene, opts = {}) {
    this.scene = scene;

    this._ownedSounds = new Set();

    this.width = opts.width ?? 300;
    this.height = opts.height ?? 60;
    this.margin = opts.margin ?? 10;

    this.x = opts.x ?? scene.cameras.main.width / 2;
    this.y = opts.y ?? (scene.cameras.main.height - this.height / 2 - 8);

    this.typingSpeedMs = opts.typingSpeedMs ?? 18;

    // Prevent instant confirm when choices appear
    this.choiceConfirmDelayMs = opts.choiceConfirmDelayMs ?? 250;
    this.choiceConfirmReadyAt = 0;

    // Global input cooldown to prevent instant skipping (esp. around choices)
    this.inputCooldownMs = opts.inputCooldownMs ?? 500;
    this.nextInputReadyAt = 0;

    this.active = false;
    this.script = [];
    this.index = 0;

    this.isTyping = false;
    this.fullText = "";
    this.visibleText = "";
    this.typingEvent = null;

    this.inChoice = false;
    this.choiceIndex = 0;
    this.choiceOptions = [];
    this.choiceStepOnSelect = null;

    this.keyHandlersBound = false;

    this._buildUI();
    this.hide();
  }

  _buildUI() {
    this.container = this.scene.add.container(0, 0);
    this.container.setScrollFactor(0);
    this.container.setDepth(UI_DEPTH);

    this.panel = this.scene.add.rectangle(this.x, this.y, this.width, this.height, 0x000000, 0.85);
    this.panel.setStrokeStyle(2, 0xffffff, 1);

    this.speakerText = this.scene.add.text(
      this.x - this.width / 2 + this.margin,
      this.y - this.height / 2 + 6,
      "",
      { fontSize: "10px", fill: "#ffffff" }
    );

    this.bodyText = this.scene.add.text(
      this.x - this.width / 2 + this.margin,
      this.y - this.height / 2 + 20,
      "",
      { fontSize: "10px", fill: "#ffffff", wordWrap: { width: this.width - this.margin * 2 } }
    );

    this.choiceText = this.scene.add.text(
      this.x - this.width / 2 + this.margin,
      this.y - this.height / 2 + 38,
      "",
      { fontSize: "10px", fill: "#ffffff" }
    );

    this.choiceCursor = this.scene.add.text(
      this.x - this.width / 2 + 2,
      this.y - this.height / 2 + 38,
      "▶",
      { fontSize: "10px", fill: "#ffffff" }
    );

    this.container.add([this.panel, this.speakerText, this.bodyText, this.choiceText, this.choiceCursor]);

    // Ensure top-of-display-list in case something also has huge depth
    this.scene.children.bringToTop(this.container);
  }


  _gateInput(ms = this.inputCooldownMs) {
    const now = this.scene?.time?.now ?? performance.now();
    this.nextInputReadyAt = Math.max(this.nextInputReadyAt ?? 0, now + (Number(ms) || 0));
  }

  _canAcceptInput() {
    const now = this.scene?.time?.now ?? performance.now();
    return now >= (this.nextInputReadyAt ?? 0);
  }

  _ensureTop() {
    if (!this.container) return;
    this.container.setDepth(UI_DEPTH);
    this.scene.children.bringToTop(this.container);
  }

  show() {
    this._ensureTop();
    this.container.setVisible(true);
    this.choiceCursor.setVisible(false);
  }

  hide() {
    this.container.setVisible(false);
  }

  /**
   * Track a Phaser sound so it can be stopped when the dialogue closes.
   * Use persistAfterDialogue=true to keep it playing after stop().
   */
  trackSound(sound, { persistAfterDialogue = false } = {}) {
    if (!sound) return;
    if (persistAfterDialogue) return;
    this._ownedSounds.add(sound);
  }

  _stopOwnedSoundsOnExit() {
    if (!this._ownedSounds || !this._ownedSounds.size) return;
    for (const snd of this._ownedSounds) {
      try {
        snd.stop?.();
        snd.destroy?.();
      } catch (_) {}
    }
    this._ownedSounds.clear();
  }

  start(script, keys, onComplete = null) {
    this.stop(false);

    this.active = true;
    this.script = script;
    this.index = 0;
    this.onComplete = onComplete;

    this.show();
    this._bindKeys();
    this._gateInput();
    this._runCurrentStep();
  }

  stop(callOnComplete = true) {
    this.active = false;

    if (this.typingEvent) {
      this.typingEvent.remove(false);
      this.typingEvent = null;
    }

    this.isTyping = false;
    this.inChoice = false;

    this.fullText = "";
    this.visibleText = "";

    this.choiceOptions = [];
    this.choiceStepOnSelect = null;

    this.bodyText.setText("");
    this.speakerText.setText("");
    this.choiceText.setText("");
    this.choiceCursor.setVisible(false);

    this._unbindKeys();

    this._stopOwnedSoundsOnExit();
    this.hide();

    // block immediate world re-interaction after closing dialogue
    lockInteract(this.scene, 240, true);
    this._gateInput();

    if (callOnComplete && this.onComplete) {
      const cb = this.onComplete;
      this.onComplete = null;
      cb();
    }
  }

  isActive() {
    return this.active;
  }

  _bindKeys() {
    if (this.keyHandlersBound) return;

    this._onZ = () => {
      if (!this.active) return;

      // Global cooldown prevents ultra-fast skipping/confirming
      if (!this._canAcceptInput()) return;
      this._gateInput();

      lockInteract(this.scene, 240, true);

      if (this.isTyping) {
        this._finishTypingInstant();
        // Require another cooldown window before advancing/confirming.
        this._gateInput();
        return;
      }

      if (this.inChoice) {
        if (this.scene.time.now < this.choiceConfirmReadyAt) return;

        const chosen = this.choiceOptions[this.choiceIndex];
        if (!chosen) return;

        try {
          if (typeof this.choiceStepOnSelect === "function") {
            this.choiceStepOnSelect(this.choiceIndex, chosen, this.choiceOptions);
          }
          if (typeof chosen.onSelect === "function") {
            chosen.onSelect(this.choiceIndex, chosen, this.choiceOptions);
          }
        } catch (e) {
          console.error("Dialogue choice callback error:", e);
        }

        if (typeof chosen.next === "number") this.index = chosen.next;
        else this.index += 1;

        this.inChoice = false;
        this.choiceText.setText("");
        this.choiceCursor.setVisible(false);

        this._runCurrentStep();
        return;
      }

      this.index += 1;
      this._runCurrentStep();
    };

    this._onUp = () => {
      if (!this.active || !this.inChoice) return;
      if (!this._canAcceptInput()) return;
      this._gateInput(120);
      this.choiceIndex = (this.choiceIndex - 1 + this.choiceOptions.length) % this.choiceOptions.length;
      this._renderChoices();
    };

    this._onEsc = () => {
      if (!this.active) return;
      this.stop(false);
    };

    this._onDown = () => {
      if (!this.active || !this.inChoice) return;
      if (!this._canAcceptInput()) return;
      this._gateInput(120);
      this.choiceIndex = (this.choiceIndex + 1) % this.choiceOptions.length;
      this._renderChoices();
    };

    this.scene.input.keyboard.on("keydown-Z", this._onZ);
    this.scene.input.keyboard.on("keydown-ESC", this._onEsc);
    this.scene.input.keyboard.on("keydown-UP", this._onUp);
    this.scene.input.keyboard.on("keydown-DOWN", this._onDown);
    this.scene.input.keyboard.on("keydown-W", this._onUp);
    this.scene.input.keyboard.on("keydown-S", this._onDown);

    this.keyHandlersBound = true;
  }

  _unbindKeys() {
    if (!this.keyHandlersBound) return;

    this.scene.input.keyboard.off("keydown-Z", this._onZ);
    this.scene.input.keyboard.off("keydown-ESC", this._onEsc);
    this.scene.input.keyboard.off("keydown-UP", this._onUp);
    this.scene.input.keyboard.off("keydown-DOWN", this._onDown);
    this.scene.input.keyboard.off("keydown-W", this._onUp);
    this.scene.input.keyboard.off("keydown-S", this._onDown);

    this._onZ = null;
    this._onEsc = null;
    this._onUp = null;
    this._onDown = null;

    this.keyHandlersBound = false;
  }

  _runCurrentStep() {
    if (!this.active) return;

    this._ensureTop();

    if (this.index < 0 || this.index >= this.script.length) {
      this.stop(true);
      return;
    }

    const step = this.script[this.index];
    if (!step || !step.type) {
      this.index += 1;
      this._runCurrentStep();
      return;
    }

    if (step.type === "say") {
      this._gateInput();
      return this._say(step.speaker ?? "", step.text ?? "");
    }
    if (step.type === "pause") return this._pause(step.ms ?? 400);
    if (step.type === "choice") {
      this._gateInput();
      return this._choice(step.prompt ?? "", step.options ?? [], step.onSelect ?? null);
    }
    if (step.type === "action") {
      try { step.run?.(); } catch (e) { console.warn("[DialogueBox] action failed", e); }
      this.index += 1;
      return this._runCurrentStep();
    }
    if (step.type === "end") return this.stop(true);

    this.index += 1;
    this._runCurrentStep();
  }

  _pause(ms) {
    this.speakerText.setText("");
    this.bodyText.setText("");
    this.choiceText.setText("");
    this.choiceCursor.setVisible(false);

    this.scene.time.delayedCall(ms, () => {
      if (!this.active) return;
      this.index += 1;
      this._runCurrentStep();
    });
  }

  _say(speaker, text) {
    this._ensureTop();

    this.speakerText.setText(speaker ? `${speaker}` : "");
    this.choiceText.setText("");
    this.choiceCursor.setVisible(false);

    this.fullText = text;
    this.visibleText = "";
    this.bodyText.setText("");

    this.isTyping = true;

    if (this.typingEvent) {
      this.typingEvent.remove(false);
      this.typingEvent = null;
    }

    let i = 0;
    this.typingEvent = this.scene.time.addEvent({
      delay: this.typingSpeedMs,
      loop: true,
      callback: () => {
        if (!this.active) return;

        i += 1;
        this.visibleText = this.fullText.slice(0, i);
        this.bodyText.setText(this.visibleText);

        if (i >= this.fullText.length) {
          this.isTyping = false;
          if (this.typingEvent) {
            this.typingEvent.remove(false);
            this.typingEvent = null;
          }
        }
      },
    });
  }

  _finishTypingInstant() {
    if (!this.isTyping) return;

    this.isTyping = false;
    if (this.typingEvent) {
      this.typingEvent.remove(false);
      this.typingEvent = null;
    }

    this.visibleText = this.fullText;
    this.bodyText.setText(this.fullText);
  }

  _choice(prompt, options, stepOnSelect) {
    this._ensureTop();

    this.speakerText.setText("");
    this.fullText = prompt;
    this.visibleText = "";
    this.bodyText.setText("");

    this.choiceStepOnSelect = stepOnSelect;

    this.isTyping = true;
    if (this.typingEvent) {
      this.typingEvent.remove(false);
      this.typingEvent = null;
    }

    let i = 0;
    this.typingEvent = this.scene.time.addEvent({
      delay: this.typingSpeedMs,
      loop: true,
      callback: () => {
        if (!this.active) return;

        i += 1;
        this.visibleText = this.fullText.slice(0, i);
        this.bodyText.setText(this.visibleText);

        if (i >= this.fullText.length) {
          this.isTyping = false;
          if (this.typingEvent) {
            this.typingEvent.remove(false);
            this.typingEvent = null;
          }

          this.inChoice = true;
          this.choiceOptions = options;
          this.choiceIndex = 0;

          this.choiceConfirmReadyAt = Math.max(
            this.scene.time.now + this.choiceConfirmDelayMs,
            this.scene.time.now + this.inputCooldownMs
          );
          this._renderChoices();
        }
      },
    });
  }

  _renderChoices() {
    if (!this.inChoice) return;

    const lines = this.choiceOptions.map((o) => o.text ?? "");
    this.choiceText.setText(lines.join("\n"));

    const baseY = this.y - this.height / 2 + 38;
    const lineHeight = 12;
    this.choiceCursor.setVisible(true);
    this.choiceCursor.setPosition(this.x - this.width / 2 + 2, baseY + this.choiceIndex * lineHeight);

    this._ensureTop();
  }
}
