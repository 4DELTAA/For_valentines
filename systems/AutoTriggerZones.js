import { canWorldInteract, disableInteraction, setLayerHidden } from "./GameState.js";
import { parseProps, splitCsv } from "./TiledProps.js";

/**
 * Walk-into triggers.
 *
 * Core:
 *  - trigger=true (or autoFire=true)
 *  - triggerOnce=true => disable after first enter
 *  - hideLayers/showLayers on enter
 *  - exitHideLayers/exitShowLayers on exit
 *
 * Deny zones:
 *  - deny=true
 *  - denyDialogue="..."
 *  - denyCooldownMs=600
 *  - denyMode="rewind" | "push" (default rewind)
 *  - denyPush=12
 *  - denySfx="knock" (alias OK)
 *  - denyShakeMs=200
 *  - denyShakeIntensity=0.01
 *
 * Zone audio:
 *  - zoneSfx="knock" (alias OK), or zoneMusic/zoneAmbience
 *  - zoneLoop=true (default true)
 *  - zoneVolume=0.6
 *  - zoneFadeInMs=0
 *  - zoneFadeOutMs=0
 *
 * Ducking (optional):
 *  - zoneDuckMusic=true
 *  - zoneDuckFactor=0.25   (0..1, default 0.35)
 */
export function updateAutoTriggerZones(scene) {
  if (!scene?.player) return;
  if (!canWorldInteract(scene)) return;

  if (!scene._triggerInside) scene._triggerInside = new Set();
  if (!scene._triggerExitArmed) scene._triggerExitArmed = new Set();
  if (scene._denyCooldownUntil === undefined) scene._denyCooldownUntil = 0;

  if (!scene._zoneAudioById) scene._zoneAudioById = new Map();
  if (!scene._duckReasons) scene._duckReasons = new Map(); // reasonId -> factor
  if (!scene._duckedVolumes) scene._duckedVolumes = new Map(); // sound -> originalVolume

  const px = scene.player.x;
  const py = scene.player.y;

  const resolveAudioKey = (nameOrKey) => {
    if (!nameOrKey) return "";
    if (typeof scene._resolveAudioKey === "function") return scene._resolveAudioKey(nameOrKey);
    if (typeof scene._resolveSfxKey === "function") return scene._resolveSfxKey(nameOrKey);
    return String(nameOrKey).trim();
  };

  const audioExists = (key) => {
    if (!key) return false;
    if (typeof scene._audioExists === "function") return scene._audioExists(key);
    return !!scene.cache?.audio?.exists?.(key);
  };

  const applyLayerVisibility = (namesCsv, visible) => {
    for (const lname of splitCsv(namesCsv)) {
      const layer = scene.layers?.[lname];
      if (!layer) continue;
      layer.setVisible?.(visible);
      setLayerHidden(scene.scene.key, lname, !visible);
    }
  };

  const recomputeDuck = () => {
    let factor = 1;
    for (const f of scene._duckReasons.values()) factor = Math.min(factor, Number(f) || 1);

    if (factor >= 1) {
      for (const [snd, v] of scene._duckedVolumes.entries()) {
        try {
          snd.setVolume?.(v);
        } catch (_) {}
      }
      scene._duckedVolumes.clear();
      return;
    }

    const sounds = scene.sound?.sounds ?? [];
    for (const snd of sounds) {
      if (!snd?.isPlaying) continue;
      if (snd.__noDuck === true) continue;

      if (!scene._duckedVolumes.has(snd)) {
        scene._duckedVolumes.set(snd, Number(snd.volume ?? 1));
      }
      snd.setVolume?.(Math.max(0, Math.min(1, (scene._duckedVolumes.get(snd) ?? 1) * factor)));
    }
  };

  const setDuckReason = (reasonId, factor) => {
    scene._duckReasons.set(reasonId, Math.max(0, Math.min(1, Number(factor ?? 0.35))));
    recomputeDuck();
  };

  const clearDuckReason = (reasonId) => {
    scene._duckReasons.delete(reasonId);
    recomputeDuck();
  };

  const stopZoneAudio = (id, props) => {
    const handle = scene._zoneAudioById.get(id);
    if (!handle) return;

    const fadeOutMs = Number(props.zonefadeoutms ?? 0);
    if (fadeOutMs > 0 && typeof handle.setVolume === "function") {
      const startV = Number(handle.volume ?? 1);
      const steps = 8;
      const stepMs = Math.max(10, Math.floor(fadeOutMs / steps));
      let i = 0;

      const timer = scene.time.addEvent({
        delay: stepMs,
        repeat: steps - 1,
        callback: () => {
          i += 1;
          const v = startV * (1 - i / steps);
          try {
            handle.setVolume?.(Math.max(0, v));
          } catch (_) {}
          if (i >= steps) {
            try {
              handle.stop?.();
              handle.destroy?.();
            } catch (_) {}
            scene._zoneAudioById.delete(id);
          }
        },
      });

      handle.__fadeTimer = timer;
      return;
    }

    try {
      handle.stop?.();
      handle.destroy?.();
    } catch (_) {}
    scene._zoneAudioById.delete(id);
  };

  const startZoneAudio = (id, props) => {
    if (scene._zoneAudioById.has(id)) return;

    const name = props.zonesfx ?? props.zonemusic ?? props.zoneambience ?? "";
    const key = resolveAudioKey(name);
    if (!key || !audioExists(key)) return;

    const loop = props.zoneloop !== false;
    const volume = props.zonevolume !== undefined ? Number(props.zonevolume) : 0.6;

    const sound = scene.sound.add(key, { loop, volume: Math.max(0, Math.min(1, volume)) });

    // mark: don't duck itself (optional) + mark as scene-owned for shutdown cleanup
    sound.__noDuck = true;
    sound.__sceneOwned = true;

    scene._zoneAudioById.set(id, sound);

    const fadeInMs = Number(props.zonefadeinms ?? 0);
    if (fadeInMs > 0) {
      const target = sound.volume ?? 1;
      sound.setVolume?.(0);
      sound.play?.();

      const steps = 8;
      const stepMs = Math.max(10, Math.floor(fadeInMs / steps));
      let i = 0;

      sound.__fadeTimer = scene.time.addEvent({
        delay: stepMs,
        repeat: steps - 1,
        callback: () => {
          i += 1;
          const v = target * (i / steps);
          try {
            sound.setVolume?.(Math.max(0, Math.min(1, v)));
          } catch (_) {}
        },
      });
    } else {
      sound.play?.();
    }

    // Optional zone ducking (reduce other audio)
    const duck = props.zoneduckmusic === true || String(props.zoneduckmusic ?? "").toLowerCase() === "true";
    if (duck) {
      const factor = props.zoneduckfactor !== undefined ? Number(props.zoneduckfactor) : 0.35;
      setDuckReason(`__zone_${id}`, factor);
    }
  };

  const stopZoneDuck = (id) => {
    clearDuckReason(`__zone_${id}`);
  };

  for (const it of scene.interactables ?? []) {
    const obj = it?._tiledObj;
    if (!obj) continue;

    const props = parseProps(obj);
    const id = String(props.id ?? obj.name ?? "").trim();
    if (!id) continue;

    const isZoneLike =
      props.autofire === true ||
      props.trigger === true ||
      String(props.trigger ?? "").toLowerCase() === "true" ||
      props.deny === true ||
      String(props.deny ?? "").toLowerCase() === "true" ||
      !!String(props.zonesfx ?? "").trim() ||
      !!String(props.zonemusic ?? "").trim() ||
      !!String(props.zoneambience ?? "").trim();

    if (!isZoneLike) continue;

    const w = Number(obj.width ?? it.w ?? 0);
    const h = Number(obj.height ?? it.h ?? 0);
    const cx = it.center?.x ?? (obj.x ?? 0) + w / 2;
    const cy = it.center?.y ?? (obj.y ?? 0) + h / 2;

    const x0 = cx - w / 2;
    const y0 = cy - h / 2;
    const x1 = x0 + w;
    const y1 = y0 + h;

    const inside = px >= x0 && px <= x1 && py >= y0 && py <= y1;
    const wasInside = scene._triggerInside.has(id);

    if (inside && !wasInside) {
      scene._triggerInside.add(id);
      scene._triggerExitArmed.add(id);

      // enter layer effects
      applyLayerVisibility(props.hidelayers ?? props.hidelayer, false);
      applyLayerVisibility(props.showlayers ?? props.showlayer, true);

      // start zone audio if present
      startZoneAudio(id, props);

      // trigger interactions: run the same interaction script on ENTER (no Z press)
      // This enables trigger=true zones to use dialogue/sfx/shake/removeinteraction/once just like normal interactables.
      const isTrigger = props.autofire === true || props.trigger === true || String(props.trigger ?? "").toLowerCase() === "true";
      if (isTrigger && typeof scene._runTiledInteraction === "function") {
        const hasDialogue =
          !!String(props.dialogue ?? "").trim() ||
          Object.keys(props).some((k) => String(k).toLowerCase().startsWith("dialogue")) ||
          Object.keys(props).some((k) => String(k).toLowerCase().includes("postdialogue"));
        const hasFx =
          !!String(props.sfx ?? props.presfx ?? props.zonesfx ?? "").trim() ||
          props.shake !== undefined;

        if (hasDialogue || hasFx) {
          scene._runTiledInteraction(obj);
        }
      }

      // deny zone (rewind/push + dialogue/sfx/shake)
      const isDeny = props.deny === true || String(props.deny ?? "").toLowerCase() === "true";
      if (isDeny) {
        const now = scene.time.now;
        const cd = Number(props.denycooldownms ?? 600);
        if (now >= (scene._denyCooldownUntil ?? 0)) {
          scene._denyCooldownUntil = now + cd;

          const denySfxName = String(props.denysfx ?? "").trim();
          const denyKey = resolveAudioKey(denySfxName);
          if (denyKey && audioExists(denyKey)) scene.sound.play(denyKey);

          const shakeMs = Number(props.denyshakems ?? 0);
          if (shakeMs > 0) {
            const intensity = Number(props.denyshakeintensity ?? 0.01);
            scene.cameras?.main?.shake?.(shakeMs, intensity);
          }

          const mode = String(props.denymode ?? "rewind").toLowerCase();
          if (mode === "push") {
            const push = Number(props.denypush ?? 12);
            const dx = px - cx;
            const dy = py - cy;
            const d = Math.hypot(dx, dy) || 1;
            scene.player.x = px + (dx / d) * push;
            scene.player.y = py + (dy / d) * push;
            scene.player.body?.reset?.(scene.player.x, scene.player.y);
          } else {
            const prev = scene._prevPlayerPos;
            if (prev) {
              scene.player.x = prev.x;
              scene.player.y = prev.y;
              scene.player.body?.reset?.(prev.x, prev.y);
            }
          }

          const denyDialogue = String(props.denydialogue ?? "You can't go there.").trim();
          if (denyDialogue) {
            scene.dialogue?.start?.([{ type: "say", speaker: "", text: denyDialogue }, { type: "end" }], scene.keys);
          }
        }
      }

      const once =
        props.triggeronce === true || String(props.triggeronce ?? "").toLowerCase() === "true" ||
        props.once === true || String(props.once ?? "").toLowerCase() === "true";
      if (once) disableInteraction(id);
    }

    if (!inside && wasInside) {
      scene._triggerInside.delete(id);

      if (scene._triggerExitArmed.has(id)) {
        scene._triggerExitArmed.delete(id);
        applyLayerVisibility(props.exithidelayers ?? props.exithidelayer, false);
        applyLayerVisibility(props.exitshowlayers ?? props.exitshowlayer, true);
      }

      stopZoneAudio(id, props);
      stopZoneDuck(id);
    }
  }
}
