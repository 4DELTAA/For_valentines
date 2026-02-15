// systems/CharacterAnims.js

/**
 * Character spritesheet layout (default):
 * - frameWidth=16, frameHeight=16
 * - cols=3 (stepL, idle, stepR)
 * - rows=4 (down, left, right, up)
 * - frameIndex = row * cols + col
 *
 * Row order: down=0, left=1, right=2, up=3
 * Col order: stepL=0, idle=1, stepR=2
 */

/**
 * @typedef {Object} CharacterAnimOptions
 * @property {string} [prefix] Animation key prefix. Defaults to sheet key.
 * @property {number} [frameWidth] Defaults 16
 * @property {number} [frameHeight] Defaults 16
 * @property {number} [cols] Defaults 3
 * @property {Object} [rowIndex] Mapping for direction to row index
 * @property {boolean} [idleOnly] Create only idle animations
 * @property {2|4} [directions] 2 = left/right only, 4 = all dirs
 * @property {number} [frameRate] Walk frameRate (idle uses 0 repeat)
 * @property {number} [repeat] Walk repeat. Defaults -1
 * @property {Object} [twoDirMap] Fallback mapping for up/down when directions=2
 * @property {"down"|"left"|"right"|"up"} [defaultFacing] Default facing for invalid input
 */

const DEFAULT_ROW_INDEX = Object.freeze({
  down: 0,
  left: 1,
  right: 2,
  up: 3,
});

const DIRS_4 = Object.freeze(["down", "left", "right", "up"]);
const DIRS_2 = Object.freeze(["left", "right"]);

/**
 * Creates idle/walk animations for a character spritesheet (once).
 * @param {Phaser.Scene} scene
 * @param {string} sheetKey Phaser texture key used in load.spritesheet(...)
 * @param {CharacterAnimOptions} [opts]
 */
export function ensureCharacterAnims(scene, sheetKey, opts = {}) {
  const {
    prefix = sheetKey,
    frameWidth = 16,
    frameHeight = 16,
    cols = 3,
    rowIndex = DEFAULT_ROW_INDEX,
    idleOnly = false,
    directions = 4,
    frameRate = 8,
    repeat = -1,
    twoDirMap = { up: "left", down: "left" },
    defaultFacing = "down",
  } = opts;

  // Validate texture exists (helps catch missing loads early)
  if (!scene.textures.exists(sheetKey)) {
    throw new Error(
      `ensureCharacterAnims: texture "${sheetKey}" not found. Did you load.spritesheet("${sheetKey}", ...)?`
    );
  }

  const dirs = directions === 2 ? DIRS_2 : DIRS_4;

  const frame = (dir, col) => {
    const r = rowIndex[dir];
    if (typeof r !== "number") return rowIndex[defaultFacing] * cols + col;
    return r * cols + col;
  };

  // Idle: single frame (col 1)
  for (const dir of dirs) {
    const animKey = `${prefix}-idle-${dir}`;
    if (!scene.anims.exists(animKey)) {
      scene.anims.create({
        key: animKey,
        frames: [{ key: sheetKey, frame: frame(dir, 1) }],
        frameRate: 1,
        repeat: 0,
      });
    }
  }

  if (idleOnly) return;

  // Walk: 0 -> 1 -> 2 -> 1
  for (const dir of dirs) {
    const animKey = `${prefix}-walk-${dir}`;
    if (!scene.anims.exists(animKey)) {
      scene.anims.create({
        key: animKey,
        frames: [
          { key: sheetKey, frame: frame(dir, 0) },
          { key: sheetKey, frame: frame(dir, 1) },
          { key: sheetKey, frame: frame(dir, 2) },
          { key: sheetKey, frame: frame(dir, 1) },
        ],
        frameRate,
        repeat,
      });
    }
  }

  // For 2-dir characters, didn't use yet
  if (directions === 2) {
    const aliasDirs = ["up", "down"];
    for (const srcDir of aliasDirs) {
      const mapped = twoDirMap[srcDir] || "left";
      for (const mode of ["idle", "walk"]) {
        const srcKey = `${prefix}-${mode}-${srcDir}`;
        const mappedKey = `${prefix}-${mode}-${mapped}`;
        if (scene.anims.exists(srcKey)) continue;
        if (!scene.anims.exists(mappedKey)) continue;

        // Re-create using the mapped frames.
        const mappedAnim = scene.anims.get(mappedKey);
        scene.anims.create({
          key: srcKey,
          frames: mappedAnim.frames.map((f) => ({
            key: f.textureKey,
            frame: f.textureFrame,
          })),
          frameRate: mappedAnim.frameRate,
          repeat: mappedAnim.repeat,
        });
      }
    }
  }
}

/**
 * Compute facing direction from dx/dy with "dominant axis" logic.
 * @param {number} dx targetX - sourceX
 * @param {number} dy targetY - sourceY
 * @param {2|4} directions
 * @param {"down"|"left"|"right"|"up"} [defaultFacing]
 * @returns {"down"|"left"|"right"|"up"}
 */
export function facingFromDelta(dx, dy, directions = 4, defaultFacing = "down") {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return defaultFacing;

  if (directions === 2) {
    if (dx === 0) return defaultFacing;
    return dx < 0 ? "left" : "right";
  }

  if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? "left" : "right";
  if (dy === 0) return defaultFacing;
  return dy < 0 ? "up" : "down";
}

/**
 * Plays the correct animation for a sprite using the convention:
 *   `${prefix}-${state}-${dir}` where state is "idle" or "walk".
 *
 * @param {Phaser.GameObjects.Sprite} sprite
 * @param {string} prefix
 * @param {"down"|"left"|"right"|"up"} dir
 * @param {boolean} walking
 */
export function playCharacterAnim(sprite, prefix, dir, walking) {
  if (!sprite?.anims) return;
  const state = walking ? "walk" : "idle";
  const key = `${prefix}-${state}-${dir}`;
  sprite.anims.play(key, true);
}

/**
 * Convenience: make an NPC look at player if within radius.
 *
 * @param {Phaser.Scene} scene
 * @param {Phaser.GameObjects.Sprite} npcSprite
 * @param {Phaser.GameObjects.Sprite|Phaser.GameObjects.GameObject} player
 * @param {Object} cfg
 * @param {string} cfg.prefix animation prefix (usually same as texture key)
 * @param {number} cfg.radius pixels
 * @param {2|4} [cfg.directions] 2 or 4
 * @param {"down"|"left"|"right"|"up"} [cfg.defaultFacing]
 * @returns {"down"|"left"|"right"|"up"} facing (unchanged if out of range)
 */
export function lookAtPlayerIfClose(scene, npcSprite, player, cfg) {
  const {
    prefix,
    radius,
    directions = 4,
    defaultFacing = "down",
  } = cfg;

  const dx = (player.x ?? 0) - (npcSprite.x ?? 0);
  const dy = (player.y ?? 0) - (npcSprite.y ?? 0);
  const r2 = radius * radius;
  if (dx * dx + dy * dy > r2) return defaultFacing;

  const dir = facingFromDelta(dx, dy, directions, defaultFacing);
  playCharacterAnim(npcSprite, prefix, dir, false);
  return dir;
}
