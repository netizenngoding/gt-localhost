import type { ServerContext } from "../database/context";
import type { PlayerSession } from "../database/peer";
import { OnConsoleMessage, OnDialogRequest, OnTalkBubble } from "../onVariant";
import { showFriendList } from "./friends";
import { makeVariantPacket } from "../proton/packet";

/**
 * Social Portal — AstroVerse parity (DialogHandle::Social_Portal + dialogMap "SocialPortal").
 *
 * AstroVerse renders the two tabs with `start_custom_tabs` and art from their
 * tianvan asset pack; this client only ships the stock dialog elements (its wasm
 * has no start_custom_tabs), so navigation and the six entries use regular
 * add_button. Every button id, theme RGBA value and behaviour is copied from
 * AstroVerse Server/Dialog/dialog_return.h (SocialPortal + settings_apply +
 * c_settings).
 */
export type PortalView = "Social" | "Bg_Setting" | "Custom_Theme";

const RGBA_RE = /^[0-9]{1,3}(,[0-9]{1,3}){3}$/;

// Theme borders/backgrounds = exact AstroVerse values (settings_apply).
// Icons = AstroVerse's frame ids, which match item ids in our database
// (166 Black Block, 520, 182, 2026, 170, 180, 172, 176, 174).
const THEMES = [
  { id: "theme_0", label: "`!Default``", icon: 520, border: "Default", bg: [0, 0, 0] },
  { id: "theme_1", label: "`bBlack``", icon: 166, border: "0,0,0,255", bg: [0, 0, 0] },
  { id: "theme_2", label: "`#Pink``", icon: 182, border: "255,0,255,255", bg: [252, 50, 212] },
  { id: "theme_3", label: "`pPurple``", icon: 2026, border: "117,27,107,255", bg: [133, 1, 118] },
  { id: "theme_4", label: "`4Red``", icon: 170, border: "255,3,11,255", bg: [250, 50, 56] },
  { id: "theme_5", label: "`eBlue``", icon: 180, border: "3,36,252,255", bg: [48, 75, 252] },
  { id: "theme_6", label: "`8Orange``", icon: 172, border: "181,102,45,255", bg: [181, 75, 0] },
  { id: "theme_7", label: "`2Green``", icon: 176, border: "47,117,33,255", bg: [21, 128, 0] },
  { id: "theme_8", label: "`9Yellow``", icon: 174, border: "245,245,0,1", bg: [128, 125, 0] },
] as const;

const TRANS_LABELS = ["`$0%``", "`$25%``", "`$50%``", "`$75%``", "`$100%``"];
const TRANS_ALPHA = [0, 64, 150, 210, 250];
const TRANS_ICON = 1052;

function currentThemeIndex(account: PlayerSession["account"]): number {
  const i = THEMES.findIndex((t) => t.border === account.borderColor);
  return i >= 0 ? i : 0;
}
function currentTransIndex(account: PlayerSession["account"]): number {
  const alpha = Number((account.bgColor || "").split(",")[3]);
  const i = TRANS_ALPHA.indexOf(alpha);
  return i >= 0 ? i : 2;
}

export function openSocialPortal(_ctx: ServerContext, session: PlayerSession, view: PortalView = "Social"): void {
  const account = session.account;
  const lines: string[] = [];
  lines.push("set_default_color|`o");
  if (view === "Social") {
    lines.push("add_label_with_icon|big|`wSocial Portal``|left|1366|");
    lines.push("add_spacer|small|");
    lines.push("add_button|showguild|`wMy Guild``|noflags|0|0|");
    lines.push("add_button|community_hub|`wCommunity Hub``|noflags|0|0|");
    lines.push("add_button|show_friends|`wShow Friends``|noflags|0|0|");
    lines.push("add_button|trade_history|`wTrade History``|noflags|0|0|");
    lines.push("add_button|marketplace|`wMarketplace``|noflags|0|0|");
    lines.push("add_button|proxy_menu|`wProxy Menu``|noflags|0|0|");
    lines.push("add_spacer|small|");
    lines.push("add_button|Background_Setting|`wBackground Settings``|noflags|0|0|");
    lines.push("add_spacer|small|");
    lines.push("add_quick_exit|");
    lines.push("end_dialog|SocialPortal|||");
    OnDialogRequest(session, lines.join("\n"));
    return;
  }

  if (view === "Bg_Setting") {
    const themeSel = currentThemeIndex(account);
    const transSel = currentTransIndex(account);
    lines.push("add_label_with_icon|big|`wBackground Settings``|left|32|");
    lines.push("add_textbox|Customize the appearance of your interface and make your gameplay experience feel more comfortable. You can change the Growtopia theme and adjust the transparency of your dialogs to match your personal preference.|left|");
    lines.push("add_spacer|small|");
    lines.push("add_smalltext|`wGrowtopia Theme:|left|");
    lines.push("add_textbox|Choose a theme color that suits your preference. The selected theme will be applied to your dialogs and interface elements throughout the game.|left|");
    lines.push("add_smalltext|`oChanging the theme will affect the appearance of Dialog windows and other interface elements.|left|");
    lines.push("add_spacer|small|");
    lines.push("max_checks|2|");
    lines.push("text_scaling_string|DEFIBRILLATOR|");
    THEMES.forEach((t, i) => lines.push(`add_checkicon|${t.id}|${t.label}|frame|${t.icon}||${i === themeSel ? 1 : 0}|`));
    lines.push("add_button_with_icon||END_LIST|noflags|0||");
    lines.push("add_spacer|small|");
    lines.push("add_smalltext|`wTheme Transparency:|left|");
    lines.push("add_textbox|Adjust how transparent the background of your dialogs appears. A lower percentage makes the dialog background more transparent, while a higher percentage makes it more solid.|left|");
    lines.push("add_smalltext|`oThe transparency setting only works when a custom theme is selected. The Default theme uses its original appearance.|left|");
    lines.push("add_spacer|small|");
    lines.push("text_scaling_string|DEFIBRILLATOR|");
    TRANS_LABELS.forEach((label, i) => lines.push(`add_checkicon|themetrans_${i}|${label}|frame|${TRANS_ICON}||${i === transSel ? 1 : 0}|`));
    lines.push("add_button_with_icon||END_LIST|noflags|0||");
    lines.push("add_spacer|small|");
    lines.push("add_smalltext|`wCustom Border & Theme:|left|");
    lines.push("add_textbox|Want to make your interface even more unique? Choose a custom border and theme style for your dialogs. Click the button below to explore the available customization options.|left|");
    lines.push("add_button|custom_border_theme|`wCustomize Border & Theme``|noflags|0|0|");
    lines.push("add_spacer|small|");
    lines.push("add_smalltext|`wPreview & Apply:|left|");
    lines.push("add_textbox|Your changes will be applied when you press the Apply Changes button below.|left|");
    lines.push("add_button|settings_apply|`wApply Changes``|noflags|0|0|");
    lines.push("add_spacer|small|");
    lines.push("add_button|social_back|`wBack``|noflags|0|0|");
    lines.push("add_quick_exit|");
    lines.push("end_dialog|SocialPortal|||");
    OnDialogRequest(session, lines.join("\n"));
    return;
  }

  // Custom_Theme — AstroVerse Custom_Theme view (c_border / c_background saves).
  const border = account.borderColor && account.borderColor !== "Default" && RGBA_RE.test(account.borderColor) ? account.borderColor : "";
  const bg = RGBA_RE.test(account.bgColor || "") ? account.bgColor! : "";
  lines.push("add_label_with_icon|big|`wCustom Border & Theme``|left|32|");
  lines.push("add_textbox|Customize the appearance of your interface by choosing your own border and background colors.|left|");
  lines.push("add_smalltext|`oUse RGBA format: `wR,G,B,A``. R, G and B represent the color, while A controls transparency.|left|");
  lines.push("add_smalltext|`oExample: `w0,0,0,255`` = Black with full opacity. `w255,255,255,128`` = White with 50% opacity.|left|");
  lines.push("add_spacer|small|");
  lines.push("add_smalltext|`wBorder Color:|left|");
  lines.push(`add_text_input|c_border|Border RGBA|${border}|15|`);
  lines.push("add_smalltext|`wBackground Color:|left|");
  lines.push(`add_text_input|c_background|Background RGBA|${bg}|15|`);
  lines.push("add_spacer|small|");
  lines.push("add_smalltext|`oAlpha (A) controls transparency: `w0 = Transparent`` - `w128 = 50%`` - `w255 = Solid``.|left|");
  lines.push("add_button|c_back|`wBack``|noflags|0|0|");
  lines.push("add_spacer|small|");
  lines.push("add_button|c_settings|`wSave``|noflags|0|0|");
  lines.push("add_quick_exit|");
  lines.push("end_dialog|SocialPortal|||");
  OnDialogRequest(session, lines.join("\n"));
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

function showUnavailable(_ctx: ServerContext, session: PlayerSession, title: string, icon: number, text: string): void {
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

export function handleSocialPortalReturn(ctx: ServerContext, session: PlayerSession, kv: Record<string, string>): void {
  const account = session.account;
  const btn = (kv.buttonClicked || "").trim();
  switch (btn) {
    case "social_back":
    case "c_back":
      return openSocialPortal(ctx, session, btn === "c_back" ? "Bg_Setting" : "Social");
    case "Background_Setting":
      return openSocialPortal(ctx, session, "Bg_Setting");
    case "custom_border_theme": {
      const border = account.borderColor && account.borderColor !== "Default" && RGBA_RE.test(account.borderColor) ? account.borderColor : "204,184,135,255";
      const bg = account.bgColor && RGBA_RE.test(account.bgColor) ? account.bgColor : "21,53,72,210";
      session.peer.sendPacket(0, makeVariantPacket(["OnMagnoliaColorPicker", border, bg]), true);
      return;
    }
    case "show_friends":
      return showFriendList(ctx, session);
    case "trade_history":
      return showTradeHistory(ctx, session);
    case "marketplace":
      // AstroVerse's marketplace is disabled there too; same behaviour.
      OnTalkBubble(session, session.netId, "The Marketplace is currently disabled.", 0, true);
      return;
    case "showguild":
      return showUnavailable(ctx, session, "Grow Guild", 5814, "Guilds are not available yet on this server.");
    case "community_hub":
      return showUnavailable(ctx, session, "Community Hub", 2480, "The Community Hub shows content from the official website and social channels. Use `w/discord`` to join the community!");
    case "proxy_menu":
      return showUnavailable(ctx, session, "Proxy Menu - Free Modes", 1660, "Proxy features are not available on this server.");
    case "c_settings": {
      const border = (kv.c_border || "").trim();
      const bg = (kv.c_background || "").trim();
      if (!RGBA_RE.test(border) || !RGBA_RE.test(bg)) {
        OnConsoleMessage(session, "`wPlease enter both border and background colors as R,G,B,A!``");
        return openSocialPortal(ctx, session, "Custom_Theme");
      }
      account.borderColor = border;
      account.bgColor = bg;
      OnConsoleMessage(session, "`2Custom theme saved!``");
      return openSocialPortal(ctx, session, "Custom_Theme");
    }
    case "settings_apply": {
      // AstroVerse settings_apply: max_checks|2 lets one theme + one transparency
      // stay checked; the rgba values below are exactly theirs.
      const pickedTheme = THEMES.findIndex((t) => kv[t.id] === "1");
      const theme = THEMES[pickedTheme >= 0 ? pickedTheme : 0];
      const pickedTrans = TRANS_ALPHA.findIndex((_, i) => kv[`themetrans_${i}`] === "1");
      const alpha = TRANS_ALPHA[pickedTrans >= 0 ? pickedTrans : currentTransIndex(account)];
      account.borderColor = theme.border;
      account.bgColor = theme.border === "Default" ? "" : `${theme.bg[0]},${theme.bg[1]},${theme.bg[2]},${alpha}`;
      OnConsoleMessage(session, "`2Theme applied!``");
      return;
    }
    default:
      return;
  }
}