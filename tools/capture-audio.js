/* Run in DevTools Console after the game has loaded, on a session you may access.
   Observes SDL WebAudio starts only. No network requests, account data or packets.
   Commands: gtAudio.mark('before-splice'); gtAudio.save(); gtAudio.stop();
*/
(() => {
  if (globalThis.gtAudio?.stop) globalThis.gtAudio.stop();
  const sdl = (typeof Module !== 'undefined' && Module.SDL) ||
    (typeof SDL !== 'undefined' && SDL);
  if (!sdl || typeof sdl.playWebAudio !== 'function') {
    throw new Error('SDL is not ready. Run this after the game finishes loading.');
  }
  const original = sdl.playWebAudio;
  const events = [];
  const seen = new WeakSet();
  const started = performance.now();
  function observe(audio) {
    const result = original.apply(this, arguments);
    const node = audio?.webAudioNode;
    // Decode completion can call playWebAudio twice. Record each actual node once.
    if (node && !seen.has(node)) {
      seen.add(node);
      events.push({
        ms: Math.round((performance.now() - started) * 1000) / 1000,
        path: audio.resource?.source || '(unknown)',
        loop: !!audio.loop,
        volume: audio.volume,
        durationSeconds: node.buffer?.duration ?? null,
        contextState: sdl.audioContext?.state ?? null
      });
    }
    return result;
  }
  sdl.playWebAudio = observe;
  const api = {
    events,
    mark(label) { events.push({ms: performance.now() - started, marker: String(label)}); },
    clear() { events.length = 0; },
    json() {
      return JSON.stringify({schema: 1, note: 'SDL WebAudio source starts, not microphone recording', events}, null, 2);
    },
    save() {
      const blob = new Blob([api.json()], {type: 'application/json'});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'splice-audio-trace.json'; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
    stop() {
      if (sdl.playWebAudio === observe) sdl.playWebAudio = original;
      return events;
    }
  };
  globalThis.gtAudio = api;
  console.info('Audio observer ready. Mark before splice, perform one splice, then gtAudio.save(). Stop with gtAudio.stop().');
  return api;
})();
