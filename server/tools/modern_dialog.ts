/**
 * Universal Modern Growtopia RmlUi Dialog Builder (`ModernDialog`)
 *
 * Designed after Ubisoft's official `assets/GameData/UI/Windows/*` RmlUi system
 * (`BasePopup.rml`, `DungeonStartUi.rml`, `Leaderboard.rml`, `MailBox.rml`,
 * `AuctionBlockSetup.rml`, `AuctionBlockBid.rml`).
 *
 * Can be used ANYWHERE on the server (sidebar, tile wrenching, slash commands,
 * NPCs, quests, custom items) via `OnModernDialogRequest(session, dialog)`.
 *
 * Automatically submits standard `action|dialog_return\ndialog_name|<name>\nbuttonClicked|<id>\n...`
 * packets back to `server/action/dialog_return/index.ts`, so server handlers work
 * identically to `OnDialogRequest` while unlocking modern RmlUi widgets!
 */

export type ModernButtonColor =
  | "purple"
  | "green"
  | "default"
  | "lightblue"
  | "yellow"
  | "red"
  | "tab";

export type ModernRankTier =
  | "bronze"
  | "silver"
  | "gold"
  | "ruby"
  | "emerald"
  | "sapphire";

export interface ModernButtonSpec {
  id: string;
  label: string;
  color?: ModernButtonColor;
  /** "ninepatch" = RmlUi `.img-button` (gui_box_upwhite.rttex 9-slice); "flat" = RmlUi `.button` (rounded flat fill + drop shadow). */
  variant?: "ninepatch" | "flat";
  iconItemId?: number;
  iconUrl?: string;
  rightText?: string;
  fullWidth?: boolean;
  disabled?: boolean;
  size?: "sm" | "md" | "lg";
  closeOnClick?: boolean;
  /** Optional link opened in a new tab; the dialog stays open. */
  url?: string;
  /** Optional list of input/slot field names that must be non-empty / > 0 to enable this button live. */
  requireFields?: string[];
}

export interface ModernRewardSpec {
  itemId?: number;
  iconUrl?: string;
  count: number;
  label?: string;
  buttonId?: string;
}

export interface ModernChallengeSpec {
  id: string;
  title: string;
  description: string;
  iconItemId?: number;
  iconUrl?: string;
  progress: number;
  target: number;
  points?: number;
  state: "notstarted" | "inprogress" | "completed" | "claimed";
  rewards?: ModernRewardSpec[];
  actionButton?: ModernButtonSpec;
  defaultOpen?: boolean;
}

export interface ModernLeaderboardEntry {
  rank: number;
  name: string;
  points: number;
  rewards?: ModernRewardSpec[];
}

export interface ModernMailCardSpec {
  id: string;
  buttonId: string;
  title: string;
  description: string;
  iconItemId?: number;
  iconUrl?: string;
  unread?: boolean;
  hasUnclaimedReward?: boolean;
  claimButtonId?: string;
  claimLabel?: string;
  expiresInSec?: number;
}

export interface ModernPickerItem {
  itemId: number;
  count: number;
  name?: string;
}

export type ModernFormControlSpec =
  | {
      kind: "item_slot";
      name: string;
      itemId: number;
      itemName?: string;
      errorText?: string;
      clickableButtonId?: string;
      /** When provided, clicking the slot opens an instant visual inventory picker right inside the modal! */
      pickerItems?: ModernPickerItem[];
    }
  | {
      kind: "segmented";
      name: string;
      value: string;
      options: Array<{ value: string; label: string }>;
    }
  | {
      kind: "input";
      name: string;
      value?: string | number;
      placeholder?: string;
      maxLen?: number;
      numeric?: boolean;
      password?: boolean;
      multiline?: boolean;
      rows?: number;
      trailingItemId?: number;
      trailingIconUrl?: string;
      widthDp?: number;
    }
  | {
      kind: "select";
      name: string;
      value: string;
      options: Array<{ value: string; label: string }>;
    }
  | {
      kind: "checkbox";
      name: string;
      label: string;
      checked?: boolean;
    }
  | {
      kind: "bid_group";
      buttons: ModernButtonSpec[];
      noteText?: string;
      expiresInSec?: number;
    }
  | {
      kind: "value";
      lines: string[];
    };

export type ModernBlockSpec =
  | {
      type: "text";
      text: string;
      size?: "sm" | "md" | "lg";
      align?: "left" | "center" | "right";
      color?: string;
    }
  | {
      type: "spacer";
      size?: "sm" | "md" | "lg";
    }
  | {
      type: "divider";
    }
  | {
      type: "section";
      tone?: "teal" | "purple" | "dark" | "card";
      paddingDp?: number;
      children: ModernBlockSpec[];
    }
  | {
      type: "callout";
      text: string;
      tone?: "warning" | "info" | "success" | "danger";
    }
  | {
      type: "accordion";
      title: string;
      variant?: "teal" | "purple";
      defaultOpen?: boolean;
      bannerUrl?: string;
      children: ModernBlockSpec[];
    }
  | {
      type: "button";
      button: ModernButtonSpec;
    }
  | {
      type: "button_row";
      buttons: ModernButtonSpec[];
      justify?: "between" | "start" | "center" | "end";
      equalWidth?: boolean;
    }
  | {
      type: "counter_row";
      iconItemId?: number;
      iconUrl?: string;
      text: string;
      timerSeconds?: number;
      timerPrefix?: string;
      timerIdleText?: string;
      rightButton?: ModernButtonSpec;
    }
  | {
      type: "rank_banner";
      label?: string;
      rank: ModernRankTier;
      stars?: number;
      bgUrl?: string;
      button: ModernButtonSpec;
    }
  | {
      type: "challenges";
      title: string;
      iconItemId?: number;
      iconUrl?: string;
      items: ModernChallengeSpec[];
    }
  | {
      type: "league_summary";
      rank: ModernRankTier;
      stars?: number;
      timerSeconds: number;
      timerPrefix?: string;
      description: string;
      positionText: string;
      nextPromotionText?: string;
      points: number;
      gotoButtonLabel?: string;
    }
  | {
      type: "leaderboard";
      entries: ModernLeaderboardEntry[];
      selfRank?: number;
      promotionCutoff?: number;
      demotionCutoff?: number;
      emptyText?: string;
    }
  | {
      type: "mail_header";
      unreadCount: number;
      claimAllButton?: ModernButtonSpec;
      extraButtons?: ModernButtonSpec[];
    }
  | {
      type: "mail_list";
      emptyText?: string;
      messages: ModernMailCardSpec[];
    }
  | {
      type: "reward_grid";
      rewards: ModernRewardSpec[];
      disabled?: boolean;
    }
  | {
      type: "form_table";
      labelWidthDp?: number;
      rows: Array<{ label: string; control: ModernFormControlSpec }>;
    }
  | {
      type: "countdown";
      prefix: string;
      seconds: number;
      expiredText?: string;
    }
  | {
      type: "incomplete_hint";
      text: string;
      requireFields: string[];
    };

export interface ModernDialogSpec {
  version: 1;
  dialogName: string;
  widthDp?: number;
  minHeightDp?: number;
  minHeightVh?: number;
  hideCloseButton?: boolean;
  closeButtonId?: string;
  title?: {
    text: string;
    itemId?: number;
    iconUrl?: string;
  };
  embedData?: Record<string, string>;
  /** Optional direct official RmlUi `.rml` path under `/GameData/UI/...` and bound data models. */
  rmlDocument?: string;
  rmlModels?: Record<string, unknown>;
  blocks: ModernBlockSpec[];
}

export class ModernDialog {
  private spec: ModernDialogSpec;
  private stack: ModernBlockSpec[][];

  constructor(
    dialogName: string,
    opts?: { width?: "sm" | "md" | "lg" | "xl" | number; minHeightDp?: number; minHeightVh?: number }
  ) {
    const widthMap: Record<string, number> = { sm: 540, md: 700, lg: 830, xl: 900 };
    const w =
      typeof opts?.width === "number"
        ? opts.width
        : opts?.width
        ? widthMap[opts.width] || 780
        : 780;
    this.spec = {
      version: 1,
      dialogName,
      widthDp: w,
      minHeightDp: opts?.minHeightDp,
      minHeightVh: opts?.minHeightVh,
      embedData: {},
      blocks: [],
    };
    this.stack = [this.spec.blocks];
  }

  /** Directly mount an official `/GameData/UI/*.rml` template with native `data-model` bindings. */
  useRmlDocument(rmlPath: string, models: Record<string, unknown> = {}): this {
    this.spec.rmlDocument = rmlPath;
    this.spec.rmlModels = models;
    return this;
  }

  private target(): ModernBlockSpec[] {
    return this.stack[this.stack.length - 1];
  }

  public setDialogName(name: string): this {
    this.spec.dialogName = name;
    return this;
  }

  public setWidth(width: "sm" | "md" | "lg" | "xl" | number): this {
    const widthMap: Record<string, number> = { sm: 540, md: 700, lg: 830, xl: 900 };
    this.spec.widthDp = typeof width === "number" ? width : widthMap[width] || 780;
    return this;
  }

  public setMinHeightVh(vh: number): this {
    this.spec.minHeightVh = vh;
    return this;
  }

  public setTitle(text: string, opts?: { itemId?: number; iconUrl?: string }): this {
    this.spec.title = {
      text,
      itemId: opts?.itemId,
      iconUrl: opts?.iconUrl,
    };
    return this;
  }

  public embedData(key: string, value: string | number | boolean): this {
    if (!this.spec.embedData) this.spec.embedData = {};
    this.spec.embedData[key] = String(value);
    return this;
  }

  public setCloseButtonId(buttonId: string): this {
    this.spec.closeButtonId = buttonId;
    return this;
  }

  public hideCloseButton(hide = true): this {
    this.spec.hideCloseButton = hide;
    return this;
  }

  public addText(
    text: string,
    opts?: { size?: "sm" | "md" | "lg"; align?: "left" | "center" | "right"; color?: string }
  ): this {
    this.target().push({
      type: "text",
      text,
      size: opts?.size || "md",
      align: opts?.align || "left",
      color: opts?.color,
    });
    return this;
  }

  public addSmallText(text: string, align: "left" | "center" | "right" = "left"): this {
    return this.addText(text, { size: "sm", align });
  }

  public addSpacer(size: "sm" | "md" | "lg" = "sm"): this {
    this.target().push({ type: "spacer", size });
    return this;
  }

  public addDivider(): this {
    this.target().push({ type: "divider" });
    return this;
  }

  public beginSection(opts?: { tone?: "teal" | "purple" | "dark" | "card"; paddingDp?: number }): this {
    const children: ModernBlockSpec[] = [];
    this.target().push({
      type: "section",
      tone: opts?.tone || "teal",
      paddingDp: opts?.paddingDp,
      children,
    });
    this.stack.push(children);
    return this;
  }

  public endSection(): this {
    if (this.stack.length > 1) this.stack.pop();
    return this;
  }

  public addCallout(text: string, tone: "warning" | "info" | "success" | "danger" = "warning"): this {
    this.target().push({ type: "callout", text, tone });
    return this;
  }

  public addAccordion(
    title: string,
    content: string | ((inner: ModernDialog) => void),
    opts?: { variant?: "teal" | "purple"; defaultOpen?: boolean; bannerUrl?: string }
  ): this {
    const sub = new ModernDialog(this.spec.dialogName);
    if (typeof content === "string") {
      sub.addText(content, { size: "sm" });
    } else {
      content(sub);
    }
    this.target().push({
      type: "accordion",
      title,
      variant: opts?.variant || "teal",
      defaultOpen: !!opts?.defaultOpen,
      bannerUrl: opts?.bannerUrl,
      children: sub.toSpec().blocks,
    });
    return this;
  }

  public addButton(
    id: string,
    label: string,
    opts?: Omit<ModernButtonSpec, "id" | "label">
  ): this {
    this.target().push({
      type: "button",
      button: { id, label, ...opts },
    });
    return this;
  }

  public addButtonRow(
    buttons: ModernButtonSpec[],
    opts?: { justify?: "between" | "start" | "center" | "end"; equalWidth?: boolean }
  ): this {
    this.target().push({
      type: "button_row",
      buttons,
      justify: opts?.justify || "between",
      equalWidth: opts?.equalWidth,
    });
    return this;
  }

  public addCounterRow(opts: {
    iconItemId?: number;
    iconUrl?: string;
    text: string;
    timerSeconds?: number;
    timerPrefix?: string;
    timerIdleText?: string;
    rightButton?: ModernButtonSpec;
  }): this {
    this.target().push({
      type: "counter_row",
      ...opts,
    });
    return this;
  }

  public addRankBanner(opts: {
    label?: string;
    rank: ModernRankTier;
    stars?: number;
    bgUrl?: string;
    button: ModernButtonSpec;
  }): this {
    this.target().push({
      type: "rank_banner",
      ...opts,
    });
    return this;
  }

  public addChallenges(opts: {
    title: string;
    iconItemId?: number;
    iconUrl?: string;
    items: ModernChallengeSpec[];
  }): this {
    this.target().push({
      type: "challenges",
      ...opts,
    });
    return this;
  }

  public addLeagueSummary(opts: {
    rank: ModernRankTier;
    stars?: number;
    timerSeconds: number;
    timerPrefix?: string;
    description: string;
    positionText: string;
    nextPromotionText?: string;
    points: number;
    gotoButtonLabel?: string;
  }): this {
    this.target().push({
      type: "league_summary",
      ...opts,
    });
    return this;
  }

  public addLeaderboard(opts: {
    entries: ModernLeaderboardEntry[];
    selfRank?: number;
    promotionCutoff?: number;
    demotionCutoff?: number;
    emptyText?: string;
  }): this {
    this.target().push({
      type: "leaderboard",
      ...opts,
    });
    return this;
  }

  public addMailHeader(opts: {
    unreadCount: number;
    claimAllButton?: ModernButtonSpec;
    extraButtons?: ModernButtonSpec[];
  }): this {
    this.target().push({
      type: "mail_header",
      ...opts,
    });
    return this;
  }

  public addMailList(opts: { emptyText?: string; messages: ModernMailCardSpec[] }): this {
    this.target().push({
      type: "mail_list",
      ...opts,
    });
    return this;
  }

  public addRewardGrid(rewards: ModernRewardSpec[], disabled = false): this {
    this.target().push({
      type: "reward_grid",
      rewards,
      disabled,
    });
    return this;
  }

  public addFormTable(
    rows: Array<{ label: string; control: ModernFormControlSpec }>,
    labelWidthDp = 200
  ): this {
    this.target().push({
      type: "form_table",
      labelWidthDp,
      rows,
    });
    return this;
  }

  public addFormRow(label: string, control: ModernFormControlSpec, labelWidthDp = 200): this {
    const arr = this.target();
    const prev = arr[arr.length - 1];
    if (prev && prev.type === "form_table" && prev.labelWidthDp === labelWidthDp) {
      prev.rows.push({ label, control });
    } else {
      arr.push({ type: "form_table", labelWidthDp, rows: [{ label, control }] });
    }
    return this;
  }

  public addCountdown(prefix: string, seconds: number, expiredText = "Expired"): this {
    this.target().push({
      type: "countdown",
      prefix,
      seconds,
      expiredText,
    });
    return this;
  }

  public addIncompleteHint(text: string, requireFields: string[]): this {
    this.target().push({
      type: "incomplete_hint",
      text,
      requireFields,
    });
    return this;
  }

  public toSpec(): ModernDialogSpec {
    return this.spec;
  }

  public toJson(): string {
    return JSON.stringify(this.spec);
  }

  /**
   * Converts a Growtopia pipe-delimited dialog string (classic `DialogBuilder`
   * OR extended modern pipe commands) into a `ModernDialogSpec`, so ANY classic
   * dialog can also be displayed with the modern RmlUi theme seamlessly!
   */
  public static fromPipeString(dialogStr: string): ModernDialogSpec {
    const dlg = new ModernDialog("popup");
    const lines = String(dialogStr || "").split(/\r?\n/);
    const pendingIconButtons: ModernButtonSpec[] = [];
    const flushIconButtons = () => {
      if (pendingIconButtons.length > 0) {
        dlg.addButtonRow(pendingIconButtons.splice(0, pendingIconButtons.length), { justify: "start" });
      }
    };

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      const parts = line.split("|");
      const cmd = parts[0];

      if (cmd === "add_label_with_icon") {
        flushIconButtons();
        const size = parts[1];
        const text = parts[2] || "";
        const itemId = parseInt(parts[4] || "0", 10) || 0;
        if (size === "big" && !dlg.spec.title) {
          dlg.setTitle(text, { itemId: itemId || undefined });
        } else {
          dlg.addCounterRow({ iconItemId: itemId || undefined, text });
        }
      } else if (cmd === "add_label") {
        flushIconButtons();
        const size = parts[1];
        const text = parts[2] || "";
        const align = (parts[3] as "left" | "center" | "right") || "left";
        if (size === "big" && !dlg.spec.title) {
          dlg.setTitle(text);
        } else {
          dlg.addText(text, { size: size === "big" ? "lg" : "md", align });
        }
      } else if (cmd === "add_textbox") {
        flushIconButtons();
        dlg.addText(parts[1] || "", {
          size: "md",
          align: (parts[2] as "left" | "center" | "right") || "left",
        });
      } else if (cmd === "add_smalltext") {
        flushIconButtons();
        dlg.addSmallText(parts[1] || "", (parts[2] as "left" | "center" | "right") || "left");
      } else if (cmd === "add_spacer") {
        flushIconButtons();
        dlg.addSpacer(parts[1] === "big" ? "lg" : "sm");
      } else if (cmd === "add_text_input" || cmd === "add_text_input_password") {
        flushIconButtons();
        dlg.addFormRow(parts[2] || parts[1] || "Input", {
          kind: "input",
          name: parts[1] || "input",
          value: parts[3] || "",
          maxLen: parseInt(parts[4] || "64", 10) || 64,
          password: cmd === "add_text_input_password",
        });
      } else if (cmd === "add_text_box_input") {
        flushIconButtons();
        dlg.addFormRow(parts[2] || parts[1] || "Message", {
          kind: "input",
          name: parts[1] || "input",
          value: parts[3] || "",
          maxLen: parseInt(parts[4] || "240", 10) || 240,
          multiline: true,
          rows: parseInt(parts[5] || "3", 10) || 3,
        });
      } else if (cmd === "add_checkbox") {
        flushIconButtons();
        dlg.addFormRow("", {
          kind: "checkbox",
          name: parts[1] || "check",
          label: parts[2] || "",
          checked: parts[3] === "1",
        });
      } else if (cmd === "add_button" || cmd === "add_small_font_button") {
        flushIconButtons();
        const btnId = parts[1] || "btn";
        const btnLabel = parts[2] || btnId;
        const color: ModernButtonColor =
          /start|purple/i.test(btnId)
            ? "purple"
            : /buy|claim|accept|confirm|send|create/i.test(btnId)
            ? "green"
            : /delete|remove|cancel|ban|kick/i.test(btnId)
            ? "red"
            : "default";
        dlg.addButton(btnId, btnLabel, { color, size: cmd === "add_small_font_button" ? "sm" : "md" });
      } else if (cmd === "add_button_with_icon") {
        if (parts[2] === "END_LIST") {
          flushIconButtons();
        } else {
          pendingIconButtons.push({
            id: parts[1] || "item_btn",
            label: parts[2] || "",
            iconItemId: parseInt(parts[4] || "0", 10) || undefined,
            rightText: parts[5] || undefined,
            color: "default",
          });
        }
      } else if (cmd === "add_accordion") {
        flushIconButtons();
        dlg.addAccordion(parts[1] || "Details", parts[2] || "", {
          variant: parts[3] === "purple" ? "purple" : "teal",
          defaultOpen: parts[4] === "1",
        });
      } else if (cmd === "embed_data") {
        dlg.embedData(parts[1] || "data", parts[2] || "");
      } else if (cmd === "end_dialog") {
        flushIconButtons();
        if (parts[1]) dlg.setDialogName(parts[1]);
        const cancelLabel = parts[2] || "";
        const okLabel = parts[3] || "";
        const footerBtns: ModernButtonSpec[] = [];
        if (cancelLabel) {
          footerBtns.push({ id: "cancel", label: cancelLabel, color: "default", closeOnClick: true });
        }
        if (okLabel) {
          footerBtns.push({ id: "ok", label: okLabel, color: "green" });
        }
        if (footerBtns.length > 0) {
          dlg.addSpacer("sm");
          dlg.addButtonRow(footerBtns, { justify: footerBtns.length === 1 ? "center" : "end" });
        }
      }
    }
    flushIconButtons();
    return dlg.toSpec();
  }
}
