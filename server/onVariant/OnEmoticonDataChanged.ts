import { makeVariantPacket } from "../proton/packet";
import type { PlayerSession } from "../database/peer";

// Growmoji -> glyph code point mapping, verified against:
//   1. GTPS3 Base.h item emoji assignments (e.g. item 12544 "(moyai)|ļ|", 12542 "(plead)|Ľ|")
//   2. GTPS3 Base.h full growmoji string (59 entries, U+0100..U+013D ordering)
//   3. C++ EmoticonDataChanged.cpp for the newer fire..wilted range (U+013E..U+0145)
// The C++ map's older emoji block is NOT authoritative: it drifts by one after (bunny)
// and names a different face for grin/ill/eyes/moyai/plead than the font atlas glyphs.
// Verified mapping: grin=U+0135, ill=U+0136, eyes=U+0137, weary=U+0138,
// moyai=U+013C (stone head), plead=U+013D (pleading eyes).
// U+0139/U+013A/U+013B are unnamed gap glyphs in the atlas.
export const BASE_GROWMOJI_STRING =
  "(wl)|ā|1&(yes)|Ă|1&(no)|ă|1&(love)|Ą|1&(oops)|ą|1&(shy)|Ć|1&(wink)|ć|1&(tongue)|Ĉ|1&(agree)|ĉ|1&(sleep)|Ċ|1&(punch)|ċ|1&(music)|Č|1&(build)|č|1&(megaphone)|Ď|1&(sigh)|ď|1&(mad)|Đ|1&(wow)|đ|1&(dance)|Ē|1&(see-no-evil)|ē|1&(bheart)|Ĕ|1&(heart)|ĕ|1&(grow)|Ė|1&(gems)|ė|1&(kiss)|Ę|1&(gtoken)|ę|1&(lol)|Ě|1&(smile)|Ā|1&(cool)|Ĝ|1&(cry)|ĝ|1&(vend)|Ğ|1&(bunny)|ě|1&(cactus)|ğ|1&(pine)|Ĥ|1&(peace)|ģ|1&(terror)|ġ|1&(troll)|Ġ|1&(evil)|Ģ|1&(fireworks)|Ħ|1&(football)|ĥ|1&(alien)|ħ|1&(party)|Ĩ|1&(pizza)|ĩ|1&(clap)|Ī|1&(song)|ī|1&(ghost)|Ĭ|1&(nuke)|ĭ|1&(halo)|Į|1&(turkey)|į|1&(gift)|İ|1&(cake)|ı|1&(heartarrow)|Ĳ|1&(lucky)|ĳ|1&(shamrock)|Ĵ|1&(grin)|ĵ|1&(ill)|Ķ|1&(eyes)|ķ|1&(weary)|ĸ|1&(moyai)|ļ|1&(plead)|Ľ|1&(fire)|ľ|1&(flirty)|Ŀ|1&(lightbulb)|ŀ|1&(moneymouth)|Ł|1&(nerd)|ł|1&(skull)|Ń|1&(trophy)|ń|1&(wilted)|Ņ|1&";

export const SPECIAL_GROWMOJI_STRING =
  "";

export const FULL_GROWMOJI_STRING = BASE_GROWMOJI_STRING + SPECIAL_GROWMOJI_STRING;

/**
 * Sends the native OnEmoticonDataChanged variant packet to the peer.
 * Replicated 100% from GTPS3 World.h form_emoji() & Player.h.
 *
 * @param session The player's session
 * @param notification Whether to show the native "You've unlocked some new Growmojis!" popup
 * @param timeout Delay in MS before showing notification
 */
export function OnEmoticonDataChanged(
  session: PlayerSession,
  notification = false,
  timeout = 0
): void {
  if (notification) {
    const notifPkt = makeVariantPacket([
      "OnAddNotification",
      "interface/large/friend_button.rttex",
      "You've unlocked some new `$Growmojis``!",
      "audio/hub_open.wav",
      { type: "i32", value: timeout },
    ]);
    session.peer.sendPacket(0, notifPkt, true);
  }

  // Exact packet structure from GTPS3 World.h:1348-1353
  const pkt = makeVariantPacket([
    "OnEmoticonDataChanged",
    { type: "i32", value: 201560520 },
    FULL_GROWMOJI_STRING,
  ]);
  session.peer.sendPacket(0, pkt, true);
}
