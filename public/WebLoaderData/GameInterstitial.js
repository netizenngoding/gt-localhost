function initInterstitial() {
  hideEnterFullscreenPopup();
  hideHideAllElement();
  launchGame();
}

function evenSupportsFullscreen() {
  return document.documentElement.requestFullscreen !== undefined;
}

function enterFullscreenMode() {
  if (document.documentElement.requestFullscreen) {
    document.documentElement.requestFullscreen().catch(function () {});
  }
  hideEnterFullscreenPopup();
}

function dismissInterstitial() {
  launchGame();
}

function isOnMobileDevice() {
  return /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isInLandscapeMode() {
  return window.innerWidth >= window.innerHeight;
}

function launchGame() {
  var interstitial = document.getElementById("interstitial");
  if (interstitial && interstitial.parentNode) {
    interstitial.parentNode.removeChild(interstitial);
  }
  showLoader();
  var script = document.createElement("script");
  script.src = "WebLoaderData/RTLoader.js?v=1900";
  document.body.appendChild(script);
}

function hideLoader() {
  var loader = document.getElementById("loader");
  if (loader) loader.style.display = "none";
}

function showLoader() {
  var loader = document.getElementById("loader");
  if (loader) loader.style.display = "";
}

function hideEnterFullscreenPopup() {
  var popup = document.getElementById("enterFullScreenPopup");
  if (popup) popup.style.display = "none";
}

function showEnterFullscreenPopup() {
  var popup = document.getElementById("enterFullScreenPopup");
  if (popup) popup.style.display = "";
}

function hideHideAllElement() {
  var elem = document.getElementById("hideAll");
  if (elem && elem.parentNode) elem.parentNode.removeChild(elem);
}

function showError(text) {
  var errorText = document.getElementById("errortext");
  if (errorText) errorText.innerHTML = text;
}

function isInFullScreen() {
  if (!evenSupportsFullscreen()) return true;
  return !!document.fullscreenElement;
}

function checkFullscreenChange() {
  hideEnterFullscreenPopup();
}

var Module = {};
initInterstitial();
