// ============================================================================
// FloatingPhysics.js — native Das Red Balloon / Bubble Gum lift (web client)
//
// The server reports the "Floating!" playmod by putting a negative gravity
// (-30) into the SET_CHARACTER_STATE packet, exactly like the official GTPS3
// server (World.h: `if (has_playmod(peer, "Floating!")) high_jump = -30;`).
//
// This pinned 1.50 web client does not integrate gravity while the avatar is
// standing on a tile, so a negative value alone only produces the old "jump
// first, then slow-fall" behaviour.  This patch gives the native physics engine
// the small push it needs and then lets it do all of the work:
//
//   * while the local avatar's gravity is negative, put it into the airborne
//     state and give it a gentle upward velocity;
//   * keep the vertical speed bounded (a held jump cannot add to it);
//   * never write a position, so the engine's own collision stops the avatar
//     below a ceiling instead of teleporting it through the block;
//   * once the server sends normal gravity again (mod expired), let the native
//     gravity pull the avatar back down and land normally.
//
// Verified offsets in the local NetAvatar (ReGrowtopia 1.50 wasm):
//   +0    f32  x position
//   +4    f32  y position (grows downwards)
//   +172  i32  1 while standing on a tile, 0 while airborne
//   +180  f32  vertical speed (negative = rising)
//   +204  i32  1 while the jump/air physics is active
//   +284  f32  gravity supplied by the server
// ============================================================================
(function installNativeFloatingPhysics(global) {
  "use strict";

  var FLOAT_SPEED = 40;          // px/s upwards (about 3.75 tiles in 3 s)
  var MAX_FLOAT_MS = 6000;       // watchdog; the server expires the mod at 3 s
  var NORMAL_GRAVITY = 100;      // anything >= this is not a Floating! signal

  var state = {
    active: false,
    locked: false,
    startedAt: 0,
    baseY: 0,
  };

  function heapReady() {
    return !!(global.Module && global.Module.HEAPU32 && global.Module.HEAPF32);
  }

  // Same chain the client uses for its in-world local player.  The two
  // sub-object checks prevent touching a half-initialised avatar during login
  // or a world change.
  function localAvatar() {
    if (!heapReady()) return 0;
    try {
      var u32 = global.Module.HEAPU32;
      var app = u32[393364 >> 2];
      if (!app || app < 1024) return 0;
      var logic = u32[(app + 1800) >> 2];
      if (!logic || logic < 1024) return 0;
      if (!u32[(logic + 108) >> 2] || !u32[(logic + 140) >> 2]) return 0;
      var avatar = u32[(logic + 184) >> 2];
      if (!avatar || avatar < 1024) return 0;
      if ((avatar >> 2) + 120 >= global.Module.HEAPF32.length) return 0;
      return avatar;
    } catch (_e) {
      return 0;
    }
  }

  function finish(avatar) {
    state.active = false;
    state.locked = true;
    if (!avatar) return;
    // Leave the server's current gravity in place; it is the normal value the
    // mod expiry just restored (1000, or 500 with Slow Fall wings).  Clearing
    // the vertical speed and marking the avatar airborne lets native gravity
    // bring it down and land on the first solid tile.
    var f32 = global.Module.HEAPF32;
    var u32 = global.Module.HEAPU32;
    var normalGravity = f32[(avatar + 284) >> 2];
    // Start the descent immediately instead of hanging at the apex for the
    // first few frames.  With Slow Fall wings (gravity ~500) keep the slow
    // descent the player intentionally equipped.
    f32[(avatar + 180) >> 2] = normalGravity >= 900 ? 140 : 0;
    u32[(avatar + 172) >> 2] = 0;
    u32[(avatar + 204) >> 2] = 1;
    if (!(normalGravity >= NORMAL_GRAVITY)) {
      f32[(avatar + 284) >> 2] = 1000;
    }
  }

  function frame() {
    try {
      var avatar = localAvatar();
      if (!avatar) {
        if (state.active) state.active = false;
      } else {
        var f32 = global.Module.HEAPF32;
        var u32 = global.Module.HEAPU32;
        var gravity = f32[(avatar + 284) >> 2];
        var now = performance.now();

        if (state.active) {
          var elapsed = now - state.startedAt;

          // The server restored normal gravity (or the world/height changed):
          // give the vertical axis back to the engine.
          if (gravity >= NORMAL_GRAVITY || elapsed >= MAX_FLOAT_MS || !isFinite(gravity)) {
            finish(avatar);
          } else {
            // Always keep the gentle upward speed.  If a solid block is above,
            // the native collision simply clamps the position; as soon as the
            // player walks sideways out from under it, the same speed continues
            // the ascent instead of latching them to the ceiling.
            f32[(avatar + 284) >> 2] = 0; // remove the slow-fall gravity
            f32[(avatar + 180) >> 2] = -FLOAT_SPEED;
            u32[(avatar + 172) >> 2] = 0;
            u32[(avatar + 204) >> 2] = 1;
          }
        } else if (gravity < 0 && gravity >= -1000 && !state.locked) {
          // A negative server gravity is the Floating! signal.
          state.active = true;
          state.startedAt = now;
          state.baseY = f32[(avatar + 4) >> 2];
          f32[(avatar + 284) >> 2] = 0;
          f32[(avatar + 180) >> 2] = -FLOAT_SPEED;
          u32[(avatar + 172) >> 2] = 0;
          u32[(avatar + 204) >> 2] = 1;
        } else if (gravity >= NORMAL_GRAVITY) {
          state.locked = false;
        }
      }
    } catch (_err) {
      // Never break the client's render loop because of the patch.
      state.active = false;
    }
    global.requestAnimationFrame(frame);
  }

  // Swallow the jump keys while the float owns the vertical axis.  The client
  // handles a jump on keydown by writing a large upward velocity; without this
  // guard a second jump during the ride makes the avatar snap up one frame and
  // then get clamped again (the "teleport" stutter).
  function isJumpKey(event) {
    var key = event.key;
    return event.code === "KeyW" || event.code === "ArrowUp" ||
      event.code === "Space" || key === "w" || key === "W" ||
      key === "ArrowUp" || key === " " || key === "Spacebar";
  }
  global.addEventListener("keydown", function (event) {
    if (!state.active) return;
    if (!isJumpKey(event)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
  global.addEventListener("keyup", function (event) {
    if (!isJumpKey(event)) return;
    if (!state.active) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  global.requestAnimationFrame(frame);
})(window);
