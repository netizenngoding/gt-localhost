import type { ServerContext } from "../database/context";
import type { PlayerSession } from "../database/peer";
import { OnConsoleMessage, OnDialogRequest, OnTalkBubble } from "../onVariant";
import { DialogBuilder } from "../tools/create_dialog";
import { showFriendList } from "./friends";

/**
 * Social Portal & Background Settings (100% native WASM `add_color_slider|`, zero Lua).
 */
export type PortalView = "Social" | "Bg_Setting";

const RGBA_RE = /^[0-9]{1,3}(,[0-9]{1,3}){3}$/;
const DEFAULT_BG_RGBA: [number, number, number, number] = [21, 53, 72, 210];

function clampInt(val: number, min: number, max: number): number {
  if (!Number.isFinite(val)) return min;
  return Math.max(min, Math.min(max, Math.round(val)));
}

export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const hue = (((Math.round(h) % 360) + 360) % 360);
  const sf = clampInt(s, 0, 100) * 0.01;
  const vf = clampInt(v, 0, 100) * 0.01;
  const sector = Math.floor(hue / 60);
  const f = (hue % 60) / 60;
  const p = vf * (1 - sf);
  const q = vf * (1 - sf * f);
  const t = vf * (1 - sf * (1 - f));
  let rf = 0;
  let gf = 0;
  let bf = 0;
  switch (sector) {
    case 0: rf = vf; gf = t; bf = p; break;
    case 1: rf = q; gf = vf; bf = p; break;
    case 2: rf = p; gf = vf; bf = t; break;
    case 3: rf = p; gf = q; bf = vf; break;
    case 4: rf = t; gf = p; bf = vf; break;
    default: rf = vf; gf = p; bf = q; break;
  }
  return [
    clampInt(Math.floor(rf * 255 + 0.5), 0, 255),
    clampInt(Math.floor(gf * 255 + 0.5), 0, 255),
    clampInt(Math.floor(bf * 255 + 0.5), 0, 255),
  ];
}

export function rgbaToHsvPct(rgbaStr: string | undefined): {
  h: number;
  s: number;
  v: number;
  aPct: number;
} {
  let [r, g, b, a] = DEFAULT_BG_RGBA;
  if (rgbaStr && RGBA_RE.test(rgbaStr)) {
    const parts = rgbaStr.split(",").map(Number);
    r = clampInt(parts[0], 0, 255);
    g = clampInt(parts[1], 0, 255);
    b = clampInt(parts[2], 0, 255);
    a = clampInt(parts[3], 0, 255);
  }
  const rf = r / 255;
  const gf = g / 255;
  const bf = b / 255;
  const hi = Math.max(rf, gf, bf);
  const lo = Math.min(rf, gf, bf);
  const d = hi - lo;
  let h = 0;
  if (d > 0) {
    if (hi === rf) h = (((gf - bf) / d) % 6 + 6) % 6;
    else if (hi === gf) h = (bf - rf) / d + 2;
    else h = (rf - gf) / d + 4;
    h *= 60;
  }
  const s = hi === 0 ? 0 : (d / hi) * 100;
  const v = hi * 100;
  return {
    h: clampInt(h, 0, 360),
    s: clampInt(s, 0, 100),
    v: clampInt(v, 0, 100),
    aPct: clampInt((a / 255) * 100, 0, 100),
  };
}

export function openSocialPortal(
  _ctx: ServerContext,
  session: PlayerSession,
  view: PortalView = "Social"
): void {
  const account = session.account;

  if (view === "Social") {
    const dlg = new DialogBuilder()
      .setDefaultColor("`o")
      .addLabelWithIcon("big", "`wSocial Portal``", 1366, "left")
      .addSpacer("small")
      .addButton("showguild", "`wMy Guild``")
      .addButton("community_hub", "`wCommunity Hub``")
      .addButton("show_friends", "`wShow Friends``")
      .addButton("trade_history", "`wTrade History``")
      .addButton("marketplace", "`wMarketplace``")
      .addButton("proxy_menu", "`wProxy Menu``")
      .addButton("Background_Setting", "`wBackground Settings``")
      .addSpacer("small")
      .addQuickExit()
      .endDialog("SocialPortal", "", "");
    OnDialogRequest(session, dlg);
    return;
  }

  // Bg_Setting — native WASM color & transparency sliders (no Custom Border section, zero Lua)
  const current = rgbaToHsvPct(
    account.borderColor && account.borderColor !== "Default" && RGBA_RE.test(account.bgColor || "")
      ? account.bgColor
      : undefined
  );

  const dlg = new DialogBuilder()
    .setDefaultColor("`o")
    .addLabelWithIcon("big", "`wBackground Settings``", 32, "left")
    .addTextbox(
      "Customize the appearance of your interface and make your gameplay experience feel more comfortable. Drag the sliders below to preview your theme color and dialog transparency in real time.",
      "left"
    )
    .addSpacer("small")
    .addSmallText("`wChoose Theme Color:", "left")
    .addSmallText(
      "`oSlide Hue, Saturation, and Brightness to customize the color of all Dialog windows.",
      "left"
    )
    .addSpacer("small")
    .addColorSlider("theme_h", "`wHue``", "h", current.h, 360)
    .addColorSlider("theme_s", "`wSaturation``", "s", current.s, 100)
    .addColorSlider("theme_v", "`wBrightness``", "v", current.v, 100)
    .addSpacer("small")
    .addSmallText("`wTheme Transparency:", "left")
    .addSmallText(
      "`oLower percentages make dialog backgrounds more transparent, while higher percentages make them more solid.",
      "left"
    )
    .addSpacer("small")
    .addColorSlider("theme_a", "`wTransparency``", "a", current.aPct, 100)
    .addSpacer("small")
    .addButton("settings_apply", "`wApply Changes``")
    .addButton("settings_default", "`wReset to Default``")
    .addSpacer("small")
    .addButton("social_back", "`wBack``")
    .addQuickExit()
    .endDialog("SocialPortal", "", "");

  OnDialogRequest(session, dlg);
}

function showTradeHistory(_ctx: ServerContext, session: PlayerSession): void {
  const lines: string[] = [];
  lines.push("set_default_color|`o");
  lines.push(`add_label_with_icon|small|${session.account.name}'s Trade History|left|242|`);
  const history = session.account.tradeHistory || [];
  if (!history.length) {
    lines.push("add_spacer|small|");
    lines.push("add_smalltext|Nothing to show yet.|left|");
  } else {
    for (const entry of history.slice().reverse()) {
      lines.push("add_spacer|small|");
      lines.push(`add_smalltext|${entry}|left|`);
    }
  }
  lines.push("add_spacer|small|");
  lines.push("add_button|social_back|`wBack``|noflags|0|0|");
  lines.push("add_button||Close|noflags|0|0|");
  lines.push("add_quick_exit|");
  lines.push("end_dialog|SocialPortal|||");
  OnDialogRequest(session, lines.join("\n"));
}

function showUnavailable(
  _ctx: ServerContext,
  session: PlayerSession,
  title: string,
  icon: number,
  text: string
): void {
  OnDialogRequest(
    session,
    [
      "set_default_color|`o",
      `add_label_with_icon|big|\`w${title}\`\`|left|${icon}|`,
      "add_spacer|small|",
      `add_textbox|${text}|left|`,
      "add_spacer|small|",
      "add_button|social_back|`wBack``|noflags|0|0|",
      "add_quick_exit|",
      "end_dialog|SocialPortal|||",
    ].join("\n")
  );
}

export function handleSocialPortalReturn(
  ctx: ServerContext,
  session: PlayerSession,
  kv: Record<string, string>
): void {
  const account = session.account;
  const btn = (kv.buttonClicked || "").trim();
  switch (btn) {
    case "social_back":
      return openSocialPortal(ctx, session, "Social");
    case "Background_Setting":
      return openSocialPortal(ctx, session, "Bg_Setting");
    case "show_friends":
      return showFriendList(ctx, session);
    case "trade_history":
      return showTradeHistory(ctx, session);
    case "marketplace":
      OnTalkBubble(session, session.netId, "The Marketplace is currently disabled.", 0, true);
      return;
    case "showguild":
      return showUnavailable(
        ctx,
        session,
        "Grow Guild",
        5814,
        "Guilds are not available yet on this server."
      );
    case "community_hub":
      return showUnavailable(
        ctx,
        session,
        "Community Hub",
        2480,
        "The Community Hub shows content from the official website and social channels. Use `w/discord`` to join the community!"
      );
    case "proxy_menu":
      return showUnavailable(
        ctx,
        session,
        "Proxy Menu - Free Modes",
        1660,
        "Proxy features are not available on this server."
      );
    case "settings_default": {
      account.borderColor = "Default";
      account.bgColor = "";
      OnConsoleMessage(session, "`2Default Growtopia theme restored!``");
      return;
    }
    case "settings_apply": {
      const fallback = rgbaToHsvPct(account.bgColor);
      const h = clampInt(Number(kv.theme_h ?? fallback.h), 0, 360);
      const s = clampInt(Number(kv.theme_s ?? fallback.s), 0, 100);
      const v = clampInt(Number(kv.theme_v ?? fallback.v), 0, 100);
      const aPct = clampInt(Number(kv.theme_a ?? fallback.aPct), 0, 100);
      const alpha = clampInt(Math.floor(aPct * 2.55 + 0.5), 0, 255);

      const [r, g, b] = hsvToRgb(h, s, v);
      const [br, bg, bb] = hsvToRgb(h, s, Math.min(100, v + 22));

      account.bgColor = `${r},${g},${b},${alpha}`;
      account.borderColor = `${br},${bg},${bb},255`;
      OnConsoleMessage(session, "`2Theme applied!``");
      return;
    }
    default:
      return;
  }
}
