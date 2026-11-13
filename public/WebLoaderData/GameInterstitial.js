var gameStarted = false;

function isOnMobileDevice() {
  return (
    /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function isInLandscapeMode() {
  if (screen.orientation && screen.orientation.type) {
    return screen.orientation.type.indexOf("landscape") !== -1;
  }
  return window.innerWidth >= window.innerHeight;
}

function tryFullscreen() {
  try {
    var doc = document.documentElement;
    var req = doc.requestFullscreen || doc.webkitRequestFullscreen || doc.msRequestFullscreen || doc.mozRequestFullScreen;
    if (req && !document.fullscreenElement && !document.webkitFullscreenElement) {
      var p = req.call(doc);
      if (p && p.catch) p.catch(function () {});
    }
  } catch (_e) {}
  try {
    if (screen.orientation && screen.orientation.lock) {
      var lockP = screen.orientation.lock("landscape");
      if (lockP && lockP.catch) lockP.catch(function () {});
    }
  } catch (_e2) {}
}

// Called every frame by the native client on mobile (_JLIB_UpdateMobile).
// MUST exist and never throw, otherwise the WASM main loop dies -> black screen.
window.checkFullscreenChange = function () {
  try {
    if (!isOnMobileDevice() || !window.__clientRuntimeReady) return;
    var fs = document.fullscreenElement || document.webkitFullscreenElement;
    if (!fs && isInLandscapeMode() && !window.__fsRetryAt) {
      window.__fsRetryAt = Date.now();
    }
  } catch (_e) {}
};

function checkOrientationAndProgress() {
  var rotateOverlay = document.getElementById("rotateOverlay");
  var loader = document.getElementById("loader");

  if (!isOnMobileDevice()) {
    if (rotateOverlay) rotateOverlay.style.display = "none";
    if (!gameStarted) {
      launchGame();
    }
    return;
  }

  // Mobile Device:
  if (!isInLandscapeMode()) {
    if (rotateOverlay) rotateOverlay.style.display = "flex";
    if (loader) loader.style.display = "none";
  } else {
    if (rotateOverlay) rotateOverlay.style.display = "none";
    if (loader && !window.__clientRuntimeReady) {
      loader.style.display = "flex";
      loader.style.opacity = "1";
    }
    tryFullscreen();
    if (!gameStarted) {
      launchGame();
    }
  }
}

function enterFullscreenAndStart() {
  tryFullscreen();
  var rotateOverlay = document.getElementById("rotateOverlay");
  if (rotateOverlay) rotateOverlay.style.display = "none";
  var loader = document.getElementById("loader");
  if (loader && !window.__clientRuntimeReady) {
    loader.style.display = "flex";
    loader.style.opacity = "1";
  }
  if (!gameStarted) {
    launchGame();
  }
}

function enterFullscreenMode() {
  enterFullscreenAndStart();
}

function dismissInterstitial() {
  enterFullscreenAndStart();
}

function launchGame() {
  if (gameStarted) return;
  gameStarted = true;
  hideHideAllElement();
  hideEnterFullscreenPopup();
  showLoader();
  var script = document.createElement("script");
  script.src = "WebLoaderData/RTLoader.js?v=2801";
  document.body.appendChild(script);
}

function hideLoader() {
  var loader = document.getElementById("loader");
  if (loader) {
    loader.style.transition = "opacity 0.4s ease";
    loader.style.opacity = "0";
    setTimeout(function () {
      loader.style.display = "none";
    }, 420);
  }
}

function showLoader() {
  var loader = document.getElementById("loader");
  if (loader && (!isOnMobileDevice() || isInLandscapeMode())) {
    loader.style.display = "flex";
    loader.style.opacity = "1";
  }
}

function hideEnterFullscreenPopup() {
  var popup = document.getElementById("enterFullScreenPopup");
  if (popup) popup.style.display = "none";
}

function showEnterFullscreenPopup() {
  var popup = document.getElementById("enterFullScreenPopup");
  if (popup) popup.style.display = "flex";
}

function hideHideAllElement() {
  var elem = document.getElementById("hideAll");
  if (elem && elem.parentNode) elem.parentNode.removeChild(elem);
}

function showError(text) {
  var errorText = document.getElementById("loader-text") || document.getElementById("errortext");
  if (errorText) {
    errorText.innerHTML = text;
    errorText.style.color = "#ff5555";
  }
}

function initInterstitial() {
  hideHideAllElement();
  hideEnterFullscreenPopup();

  // Listen for orientation change events
  if (screen.orientation && screen.orientation.addEventListener) {
    screen.orientation.addEventListener("change", function () {
      setTimeout(checkOrientationAndProgress, 120);
    });
  }
  window.addEventListener("orientationchange", function () {
    setTimeout(checkOrientationAndProgress, 150);
  });
  var lastLandscape = isInLandscapeMode();
  window.addEventListener("resize", function () {
    // Virtual keyboard resizes the viewport; only react to real orientation flips.
    var now = isInLandscapeMode();
    if (now === lastLandscape) return;
    lastLandscape = now;
    setTimeout(checkOrientationAndProgress, 100);
  });

  // User gesture listener to assist entering fullscreen smoothly
  document.addEventListener("pointerdown", function () {
    var ae = document.activeElement;
    if (ae && (ae.id === "textInput" || ae.tagName === "INPUT" || ae.tagName === "TEXTAREA")) return;
    if (window.__viewportLock && window.__viewportLock.active) return;
    if (window.__gtLastBlurAt && (Date.now() - window.__gtLastBlurAt) < 1200) return;
    if (isOnMobileDevice() && isInLandscapeMode() && !document.fullscreenElement && !document.webkitFullscreenElement) {
      tryFullscreen();
    }
  }, { passive: true });

  checkOrientationAndProgress();
}

var Module = {};
initInterstitial();
