export default class EpilogueText {
  constructor(scene, opts = {}) {
    this.scene = scene;

    this.typingSpeedMs = opts.typingSpeedMs ?? 26;
    this.autoAdvance = opts.autoAdvance ?? true;
    this.autoAdvanceDelayMs = opts.autoAdvanceDelayMs ?? 250;
    this.allowManualAdvance = opts.allowManualAdvance ?? false;

    this.x = 14;
    this.y = 16;

    this.lines = [];
    this.index = 0;

    this.isTyping = false;
    this.full = "";
    this.visible = "";
    this.event = null;

    this.text = scene.add.text(this.x, this.y, "", {
      fontSize: "10px",
      fill: "#ffffff",
      wordWrap: { width: scene.cameras.main.width - 24 },
    });

    this._onZ = null;
    this._autoEvent = null;
  }

  start(lines, onDone = null) {
    this.lines = lines ?? [];
    this.index = 0;
    this.onDone = onDone;

    this._bind();
    this._showLine();
  }

  _bind() {
    if (!this.allowManualAdvance) return;
    if (this._onZ) return;

    this._onZ = () => {
      if (this.isTyping) {
        this._finishTyping();
        return;
      }
      this._advanceLine();
    };

    this.scene.input.keyboard.on("keydown-Z", this._onZ);
  }

  _unbind() {
    if (!this._onZ) return;
    this.scene.input.keyboard.off("keydown-Z", this._onZ);
    this._onZ = null;
  }

  _advanceLine() {
    this._cancelAutoAdvance();

    this.index += 1;
    if (this.index >= this.lines.length) {
      this._unbind();
      if (this.onDone) this.onDone();
      return;
    }
    this._showLine();
  }

  _cancelAutoAdvance() {
    if (this._autoEvent) {
      this._autoEvent.remove(false);
      this._autoEvent = null;
    }
  }

  _scheduleAutoAdvance() {
    if (!this.autoAdvance) return;
    this._cancelAutoAdvance();

    this._autoEvent = this.scene.time.delayedCall(this.autoAdvanceDelayMs, () => {
      if (this.isTyping) return;
      this._advanceLine();
    });
  }

  _showLine() {
    const line = this.lines[this.index] ?? "";
    const prior = this.text.text ? `${this.text.text}\n` : "";
    this._typeAppend(prior, line);
  }

  _typeAppend(prefix, suffix) {
    if (this.event) {
      this.event.remove(false);
      this.event = null;
    }

    const pre = String(prefix ?? "");
    const suf = String(suffix ?? "");
    this.full = pre + suf;

    // Avoid blank-frame flicker: keep existing content visible and only type the new suffix.
    this.visible = pre;
    this.text.setText(pre);

    this.isTyping = true;
    let i = pre.length;

    if (i >= this.full.length) {
      this.isTyping = false;
      this._scheduleAutoAdvance();
      return;
    }

    this.event = this.scene.time.addEvent({
      delay: this.typingSpeedMs,
      loop: true,
      callback: () => {
        i += 1;
        this.visible = this.full.slice(0, i);
        this.text.setText(this.visible);

        if (i >= this.full.length) {
          this.isTyping = false;
          if (this.event) {
            this.event.remove(false);
            this.event = null;
          }
          this._scheduleAutoAdvance();
        }
      },
    });
  }

  _finishTyping() {
    this.isTyping = false;
    if (this.event) {
      this.event.remove(false);
      this.event = null;
    }
    this.text.setText(this.full);
    this._scheduleAutoAdvance();
  }
}