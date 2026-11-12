/* Keyboard-safe viewport & focus guard for touch devices.
 * Prevents virtual keyboards from:
 *   1. Shrinking #gameContainer / #canvas visually,
 *   2. Firing Emscripten resize events ("Screen mode changed, reconnecting..."),
 *   3. Scrolling/panning the page,
 *   4. Popping back up randomly when dismissed.
 */
(function (g) {
  "use strict";
  var touch = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  g.__gtTouchDevice = touch;
  g.__gtLastTapAt = 0;
  g.__gtLastBlurAt = 0;

  document.addEventListener("pointerdown", function (e) {
    if (e.target && e.target.id === "textInput") return;
    g.__gtLastTapAt = Date.now();
  }, { capture: true, passive: true });
  document.addEventListener("touchstart", function (e) {
    if (e.target && e.target.id === "textInput") return;
    g.__gtLastTapAt = Date.now();
  }, { capture: true, passive: true });

  if (!touch) return;

  var nativeW = Object.getOwnPropertyDescriptor(g, "innerWidth");
  var nativeH = Object.getOwnPropertyDescriptor(g, "innerHeight");
  var protoCW = Object.getOwnPropertyDescriptor(Element.prototype, "clientWidth");
  var protoCH = Object.getOwnPropertyDescriptor(Element.prototype, "clientHeight");

  var readW = function () { return nativeW && nativeW.get ? nativeW.get.call(g) : (protoCW && protoCW.get ? protoCW.get.call(document.documentElement) : 0); };
  var readH = function () { return nativeH && nativeH.get ? nativeH.get.call(g) : (protoCH && protoCH.get ? protoCH.get.call(document.documentElement) : 0); };

  var stableW = readW(), stableH = readH();
  var kbActive = false, releaseTimer = null;
  var landscape = function (w, h) { return w >= h; };

  function isTextField(el) {
    return !!el && (el.id === "textInput" || el.tagName === "INPUT" || el.tagName === "TEXTAREA");
  }

  function isKeyboardShrink(w, h) {
    if (kbActive) return true;
    // Virtual keyboard in landscape can shrink height and occasionally nudge system bar width slightly.
    return landscape(stableW, stableH) && w >= stableW * 0.85 && h < stableH - 40;
  }

  function shouldLock() {
    if (kbActive) return true;
    return isKeyboardShrink(readW(), readH());
  }

  function applyBoxLock(locked) {
    var gc = document.getElementById("gameContainer");
    // Always keep horizontal width 100% so fullscreen/nav-bar/cutout shifts never leave a right-side black bar.
    document.documentElement.style.width = "100%";
    if (document.body) document.body.style.width = "100%";
    if (gc) gc.style.width = "100%";
    if (locked && stableH > 0) {
      var hpx = stableH + "px";
      if (gc) gc.style.height = hpx;
      document.documentElement.style.height = hpx;
      if (document.body) document.body.style.height = hpx;
    } else {
      if (gc) gc.style.height = "100%";
      document.documentElement.style.height = "100%";
      if (document.body) document.body.style.height = "100%";
    }
  }

  try {
    Object.defineProperty(g, "innerWidth", { configurable: true, get: function () { return shouldLock() ? stableW : readW(); } });
    Object.defineProperty(g, "innerHeight", { configurable: true, get: function () { return shouldLock() ? stableH : readH(); } });
    if (protoCW && protoCW.get && protoCH && protoCH.get) {
      Object.defineProperty(Element.prototype, "clientWidth", {
        configurable: true,
        get: function () {
          if ((this === document.documentElement || this === document.body) && shouldLock()) return stableW;
          return protoCW.get.call(this);
        }
      });
      Object.defineProperty(Element.prototype, "clientHeight", {
        configurable: true,
        get: function () {
          if ((this === document.documentElement || this === document.body) && shouldLock()) return stableH;
          return protoCH.get.call(this);
        }
      });
    }
  } catch (_e) {}

  function refreshStable() {
    if (kbActive) return;
    var w = readW(), h = readH();
    if (isKeyboardShrink(w, h)) return;
    if (w > 0 && h > 0) {
      stableW = w;
      stableH = h;
    }
  }

  g.addEventListener("resize", function (e) {
    var w = readW(), h = readH();
    if (isKeyboardShrink(w, h)) {
      applyBoxLock(true);
      e.stopImmediatePropagation();
      return;
    }
    if (kbActive) {
      // Real rotation while keyboard is up -> allow update.
      if (landscape(w, h) !== landscape(stableW, stableH) && Math.abs(w - stableH) < 100) {
        stableW = w; stableH = h; kbActive = false;
        applyBoxLock(false);
        return;
      }
      applyBoxLock(true);
      e.stopImmediatePropagation();
      return;
    }
    applyBoxLock(false);
    refreshStable();
  }, true);

  function onRealViewportChange() {
    if (kbActive) return;
    [80, 260, 550].forEach(function (delay) {
      setTimeout(function () {
        if (kbActive) return;
        applyBoxLock(false);
        var w = readW(), h = readH();
        if (w > 0 && h > 0 && !isKeyboardShrink(w, h)) { stableW = w; stableH = h; }
      }, delay);
    });
  }
  g.addEventListener("orientationchange", onRealViewportChange);
  document.addEventListener("fullscreenchange", onRealViewportChange);
  document.addEventListener("webkitfullscreenchange", onRealViewportChange);

  function pin() {
    try {
      g.scrollTo(0, 0);
      document.documentElement.scrollTop = 0;
      document.documentElement.scrollLeft = 0;
      if (document.body) {
        document.body.scrollTop = 0;
        document.body.scrollLeft = 0;
      }
      var gc = document.getElementById("gameContainer");
      if (gc) { gc.scrollTop = 0; gc.scrollLeft = 0; }
    } catch (_e) {}
  }
  function lock() {
    if (releaseTimer) { clearTimeout(releaseTimer); releaseTimer = null; }
    if (!kbActive) {
      refreshStable();
      kbActive = true;
      applyBoxLock(true);
    }
    pin();
  }
  function release() {
    if (releaseTimer) clearTimeout(releaseTimer);
    releaseTimer = setTimeout(function () {
      releaseTimer = null;
      if (isTextField(document.activeElement)) return;
      kbActive = false;
      applyBoxLock(false);
      pin();
      var w = readW(), h = readH();
      if (landscape(w, h) !== landscape(stableW, stableH) && w > 0 && h > 0) {
        stableW = w; stableH = h;
        g.dispatchEvent(new Event("resize"));
      } else if (w > 0 && h > 0 && !isKeyboardShrink(w, h)) {
        stableW = w; stableH = h;
      }
    }, 650);
  }

  document.addEventListener("focusin", function (e) {
    if (!isTextField(e.target)) return;
    lock();
    try {
      e.target.style.top = "8px"; e.target.style.bottom = "auto"; e.target.style.left = "8px";
    } catch (_e) {}
    setTimeout(pin, 50); setTimeout(pin, 250); setTimeout(pin, 600);
  }, true);
  document.addEventListener("focusout", function (e) {
    if (!isTextField(e.target)) return;
    g.__gtLastBlurAt = Date.now();
    release();
  }, true);

  try { if (navigator.virtualKeyboard) navigator.virtualKeyboard.overlaysContent = true; } catch (_e) {}

  if (g.visualViewport) {
    var vv = function () {
      if (kbActive || isKeyboardShrink(readW(), readH())) {
        applyBoxLock(true);
        pin();
      }
    };
    g.visualViewport.addEventListener("resize", vv);
    g.visualViewport.addEventListener("scroll", vv);
  }
  g.addEventListener("scroll", function () { if (kbActive) pin(); }, { passive: true });
  g.__viewportLock = { get active() { return kbActive; }, get size() { return [stableW, stableH]; } };
})(window);
