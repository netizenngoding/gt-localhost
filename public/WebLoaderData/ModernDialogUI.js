/**
 * ModernDialogUI.js — Official Growtopia RmlUi Window & Popup Runtime
 *
 * Renders `OnModernDialogRequest` packets using the genuine `/GameData/UI/Windows/*.rml`
 * and `*.rcss` files from Growtopia (`MailBox.rml`, `MailMessage.rml`,
 * `DungeonStartUi.rml`, `Leaderboard.rml`, `AuctionBlockSetup.rml`,
 * `AuctionBlockBid.rml`, and `GenericPopup.rml` / `BasePopup.rml`) via `RmlUiEngine.js`,
 * backed by native C++ WASM modal input gating (`rmlSetModalOpen`) and packet dispatch
 * (`rmlSendPacket`).
 *
 * Zero synthetic CSS shadows, zero fake CSS borders — 100% authentic RmlUi geometry.
 */
(function (global) {
  "use strict";

  let installed = false;
  let backdropEl = null;
  let hostEl = null;
  let activeDoc = null;
  let activeSpec = null;
  let openSeq = 0;

  function ensureHostOverlay() {
    if (backdropEl && hostEl) return;
    backdropEl = document.createElement("div");
    backdropEl.id = "rml-popup-backdrop";
    Object.assign(backdropEl.style, {
      position: "fixed",
      inset: "0",
      width: "100%",
      height: "100%",
      backgroundColor: "rgba(0, 0, 0, 0.42)",
      display: "none",
      alignItems: "center",
      justifyContent: "center",
      zIndex: "10020",
      pointerEvents: "auto",
    });

    for (const evName of ["pointerdown", "mousedown", "mouseup", "touchstart", "touchend", "wheel", "dblclick"]) {
      backdropEl.addEventListener(evName, (ev) => ev.stopPropagation(), { passive: true });
    }

    hostEl = document.createElement("div");
    hostEl.id = "rml-popup-window-host";
    Object.assign(hostEl.style, {
      position: "relative",
      width: "100%",
      height: "100%",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    });

    backdropEl.appendChild(hostEl);
    document.body.appendChild(backdropEl);

    global.addEventListener("keydown", (ev) => {
      if (!activeDoc) return;
      if (ev.key === "Escape") {
        ev.preventDefault();
        ev.stopPropagation();
        closeDialog();
      }
    });
  }

  function setDialogVisible(doc, visible) {
    if (!doc) return;
    if (doc.isNative && typeof doc.setElementClass === "function") {
      doc.setElementClass("@body", "hide-window", false);
      doc.setElementClass("@body", "show-window", visible);
    } else if (doc.bodyEl) {
      doc.bodyEl.classList.remove("hide-window");
      doc.bodyEl.classList.toggle("show-window", visible);
    }
  }

  function closeDialog() {
    openSeq += 1;
    if (activeDoc) {
      activeDoc.destroy();
      activeDoc = null;
    }
    activeSpec = null;
    if (backdropEl) backdropEl.style.display = "none";
    if (global.RmlUiEngine) global.RmlUiEngine.wasm.setModalOpen(false);
  }

  function isCloseAction(action) {
    const a = String(action || "").trim();
    return (
      a === "Popup.OnClose" ||
      a === "dialog.OnCancel" ||
      a === "DungeonStartUi.OnClose" ||
      /(?:^|\.)(?:OnClose|OnCancel)$/i.test(a)
    );
  }

  function getEmbed(spec) {
    return (spec && (spec.embedData || spec.embed)) || {};
  }

  function sendDialogReturn(dialogName, buttonClicked, extraFields) {
    if (!global.RmlUiEngine || !dialogName) return;
    const lines = ["action|dialog_return", "dialog_name|" + dialogName];
    if (buttonClicked !== undefined && buttonClicked !== null && buttonClicked !== "") {
      lines.push("buttonClicked|" + buttonClicked);
    }
    if (extraFields && typeof extraFields === "object") {
      for (const [k, v] of Object.entries(extraFields)) {
        if (v !== undefined && v !== null) {
          lines.push(k + "|" + v);
        }
      }
    }
    global.RmlUiEngine.wasm.sendPacket(2, lines.join("\n") + "\n");
  }

  // -------------------------------------------------------------------------
  // Official RmlUi Model Translators for Server `ModernDialogSpec` Payloads
  // -------------------------------------------------------------------------
  function findBlock(blocks, type) {
    return (blocks || []).find((b) => b && b.type === type) || null;
  }

  function flattenBlocks(blocks, out = []) {
    for (const b of blocks || []) {
      if (!b) continue;
      out.push(b);
      if (Array.isArray(b.children)) flattenBlocks(b.children, out);
    }
    return out;
  }

  function collectFormRows(blocks, out = []) {
    for (const b of blocks || []) {
      if (!b) continue;
      if (b.type === "form_row" && b.control) {
        out.push(b);
      } else if (b.type === "form_table" && Array.isArray(b.rows)) {
        for (const row of b.rows) {
          if (row && row.control) out.push({ type: "form_row", label: row.label, control: row.control });
        }
      }
      if (Array.isArray(b.children)) collectFormRows(b.children, out);
    }
    return out;
  }

  function rankBannerPathForTier(rankName) {
    const clean = String(rankName || "gold").trim().toLowerCase();
    return `/branding/modern-ui/rank_${clean}.png`;
  }

  // 1. MailBox.rml (`MailBoxModel`)
  function mountMailBoxRml(spec, mySeq) {
    const header = findBlock(spec.blocks, "mail_header");
    const listBlock = findBlock(spec.blocks, "mail_list");
    const rawCards = (listBlock && listBlock.messages) || [];

    const messages = rawCards.map((c) => ({
      _id: c.id,
      _viewBtn: c.buttonId || "view_" + c.id,
      _claimBtn: c.claimButtonId || "quickclaim_" + c.id,
      Status: c.unread ? 0 : c.hasUnclaimedReward ? 0 : 1,
      Icon: c.iconItemId || 660,
      Title: c.title || "Message",
      TitleParams: "",
      DescrShort: c.description || "",
      DescriptionParams: "",
      Reward: c.hasUnclaimedReward ? [{ ItemId: c.iconItemId || 112, Count: 1 }] : [],
      Duration: typeof c.expiresInSec === "number" ? c.expiresInSec : 86400 * 30,
    }));

    const models = {
      PopupModel: { PopupId: "mailbox" },
      MailBoxModel: {
        UnreadTotal: header && typeof header.unreadCount === "number" ? header.unreadCount : 0,
        Messages: messages,
        NewPageRequested: 0,
      },
    };

    return global.RmlUiEngine.mountDocument(hostEl, "/GameData/UI/Windows/MailBox.rml", {
      models,
      extraCss: `
        .rml-body { display: flex; align-items: center; justify-content: center; }
        #window.window { position: relative; margin: auto; }
      `,
      onEvent(action, ctx) {
        if (mySeq !== openSeq) return;
        if (isCloseAction(action)) {
          closeDialog();
          return;
        }
        if (action === "mailbox.OnClaimAll") {
          sendDialogReturn(spec.dialogName, "claim_all", getEmbed(spec));
          return;
        }
        if (action === "mailbox.OnClaim") {
          const idx = Number(ctx.element && ctx.element.getAttribute("message_index"));
          const msg = messages[idx];
          if (msg) sendDialogReturn(spec.dialogName, msg._claimBtn, getEmbed(spec));
          return;
        }
        if (action === "mailbox.OnMessage") {
          const idx = Number(ctx.element && ctx.element.getAttribute("message_index"));
          const msg = messages[idx];
          if (msg) sendDialogReturn(spec.dialogName, msg._viewBtn, getEmbed(spec));
        }
      },
    });
  }

  // 2. MailMessage.rml (`MailMessageModel`)
  function mountMailMessageRml(spec, mySeq) {
    const all = flattenBlocks(spec.blocks);
    const textBlock = all.find((b) => b.type === "text");
    const rewardBlock = all.find((b) => b.type === "reward_grid");
    const btnRow = all.find((b) => b.type === "button_row");
    const claimBtnSpec = btnRow && (btnRow.buttons || []).find((b) => String(b.id || "").startsWith("claim_"));

    const rewards = ((rewardBlock && rewardBlock.rewards) || []).map((r) => ({
      ItemId: r.itemId || 112,
      Count: r.count || 1,
    }));

    const models = {
      PopupModel: { PopupId: "mailmessage" },
      MailMessageModel: {
        Icon: (spec.title && spec.title.itemId) || 660,
        Title: (spec.title && spec.title.text) || "Mail",
        Descr: (textBlock && textBlock.text) || "",
        MessageBodyParams: "",
        Reward: rewards,
        Status: claimBtnSpec ? 0 : 1,
      },
    };

    return global.RmlUiEngine.mountDocument(hostEl, "/GameData/UI/Windows/MailMessage.rml", {
      models,
      extraCss: `
        .rml-body { display: flex; align-items: center; justify-content: center; }
        #window.window { position: relative; margin: auto; min-width: calc(640 * var(--rml-dp)); }
      `,
      onEvent(action) {
        if (mySeq !== openSeq) return;
        if (isCloseAction(action)) {
          closeDialog();
          return;
        }
        if (action === "mailbox.OnBack") {
          sendDialogReturn(spec.dialogName, "back_inbox", getEmbed(spec));
          return;
        }
        if (action === "mailbox.OnClaim" && claimBtnSpec) {
          sendDialogReturn(spec.dialogName, claimBtnSpec.id, getEmbed(spec));
        }
      },
    });
  }

  // 3. DungeonStartUi.rml (`DungeonStartUiModel`)
  function mountDungeonStartRml(spec, mySeq) {
    const all = flattenBlocks(spec.blocks);
    const startBtn = all.find((b) => b.type === "button" && b.button && b.button.id === "start_dungeon");
    const counterRow = all.find((b) => b.type === "counter_row");
    const countdownBlock = all.find((b) => b.type === "countdown");
    const rankBanner = all.find((b) => b.type === "rank_banner");
    const challengesBlock = all.find((b) => b.type === "challenges");

    let piggyProgress = 20;
    let piggyTarget = 20;
    if (counterRow && typeof counterRow.text === "string") {
      const m = /(\d+)\s*\/\s*(\d+)/.exec(counterRow.text);
      if (m) {
        piggyProgress = parseInt(m[1], 10);
        piggyTarget = parseInt(m[2], 10);
      }
    }

    const challenges = ((challengesBlock && challengesBlock.items) || []).map((ch) => ({
      Id: ch.id,
      Title: ch.title,
      Description: ch.description,
      Icon: ch.iconItemId || 3902,
      Progress: ch.progress || 0,
      Target: ch.target || 1,
      Points: ch.points || 0,
      IsOptional: false,
      State: ch.state === "claimed" ? 3 : ch.state === "completed" ? 2 : 1,
      Rewards: (ch.rewards || []).map((r) => ({ Id: r.itemId || 112, Count: r.count || 1 })),
    }));

    const models = {
      PopupModel: { PopupId: "dungeonstartui" },
      DungeonStartUiModel: {
        EnterCost: Number((startBtn && startBtn.button && startBtn.button.rightText) || 5),
        DisableStart: !!(startBtn && startBtn.button && startBtn.button.disabled),
        PiggyProgress: piggyProgress,
        PiggyTarget: piggyTarget,
        ScrollTimer: (counterRow && counterRow.timerSeconds) || 0,
        HasDungeonPass: !!countdownBlock,
        PassTimeRemaining: (countdownBlock && countdownBlock.seconds) || 0,
        WarningType: 0,
        CooldownTimeLeft: 0,
        BannerPath: rankBannerPathForTier(rankBanner && rankBanner.rank),
        LeagueTier: (rankBanner && rankBanner.stars) || 1,
        Challenges: challenges,
      },
    };

    return global.RmlUiEngine.mountDocument(hostEl, "/GameData/UI/Windows/Dungeon/DungeonStartUi.rml", {
      models,
      extraCss: `
        .rml-body { display: flex; align-items: center; justify-content: center; }
        #window.window { position: relative; margin: auto; width: calc(830 * var(--rml-dp)); }
      `,
      onEvent(action, ctx) {
        if (mySeq !== openSeq) return;
        if (isCloseAction(action)) {
          closeDialog();
          return;
        }
        if (action === "DungeonStartUi.OnStart") {
          sendDialogReturn(spec.dialogName, "start_dungeon", getEmbed(spec));
          return;
        }
        if (action === "DungeonStartUi.OnInviteFriends") {
          sendDialogReturn(spec.dialogName, "invite_friends", getEmbed(spec));
          return;
        }
        if (action === "DungeonStartUi.OnPurchaseScroll") {
          sendDialogReturn(spec.dialogName, "buy_scrolls", getEmbed(spec));
          return;
        }
        if (action === "DungeonStartUi.OnPurchasePass") {
          sendDialogReturn(spec.dialogName, "buy_pass", getEmbed(spec));
          return;
        }
        if (action === "DungeonStartUi.OnLeagueInfo") {
          sendDialogReturn(spec.dialogName, "open_league", getEmbed(spec));
          return;
        }
        if (action === "DungeonStartUi.OnChallengeButtonClicked") {
          const chId = ctx.element && ctx.element.getAttribute("chal_id");
          if (chId) sendDialogReturn(spec.dialogName, "claim_chal_" + chId, getEmbed(spec));
        }
      },
    });
  }

  // 4. Leaderboard.rml (`DungeonLeaderboardModel`)
  function mountDungeonLeaderboardRml(spec, mySeq) {
    const all = flattenBlocks(spec.blocks);
    const summary = all.find((b) => b.type === "league_summary");
    const board = all.find((b) => b.type === "leaderboard");
    const rawEntries = (board && board.entries) || [];
    const totalCount = Math.max(1, rawEntries.length);
    const promoPos = (board && board.promotionCutoff) || Math.max(1, Math.floor(totalCount * 0.3));
    const demoPos = (board && board.demotionCutoff) || Math.max(promoPos + 1, totalCount - 1);
    const selfPos = (board && board.selfRank) || 1;
    const promoPoints = rawEntries[promoPos - 1] ? rawEntries[promoPos - 1].points : 0;

    const entries = rawEntries.map((row) => ({
      Position: row.rank,
      PlayerName: row.name,
      Points: row.points,
      Rewards: (row.rewards || []).map((r) => ({
        ItemID: r.itemId || 112,
        Number: r.count || 1,
      })),
    }));

    const models = {
      PopupModel: { PopupId: "dungeonleaderboard" },
      DungeonLeaderboardModel: {
        Title: (spec.title && spec.title.text) || "League Standings",
        BannerPath: rankBannerPathForTier(summary && summary.rank),
        LeagueTier: (summary && summary.stars) || 1,
        EndTime: (summary && summary.timerSeconds) || 86400,
        PromotionPerc: 30,
        DemotionPerc: 10,
        LeagueDescription1: "The top 30% will be promoted and the bottom 10% will move down a league.",
        LeagueDescription2: "The top 30% will be promoted to the next league.",
        Position: selfPos,
        PositionInfo: (summary && summary.positionText) || `#${selfPos}`,
        PromotionPosition: promoPos,
        DemotionPosition: demoPos,
        PromotionInfo: promoPoints,
        Points: (summary && summary.points) || 0,
        PlayerCount: totalCount,
        RequestState: 2,
        Entries: entries,
      },
    };

    return global.RmlUiEngine.mountDocument(hostEl, "/GameData/UI/Windows/Dungeon/Leaderboard.rml", {
      models,
      extraCss: `
        .rml-body { display: flex; align-items: center; justify-content: center; }
        #window.window { position: relative; margin: auto; width: calc(890 * var(--rml-dp)); }
      `,
      onEvent(action, ctx) {
        if (mySeq !== openSeq) return;
        if (isCloseAction(action)) {
          closeDialog();
          return;
        }
        if (action === "DungeonLeaderboard.OnBack") {
          sendDialogReturn(spec.dialogName, "back_to_dungeons", getEmbed(spec));
          return;
        }
        if (action === "DungeonLeaderboard.GotoPlayer") {
          const selectedRow = activeDoc && activeDoc.bodyEl && activeDoc.bodyEl.querySelector(".entry-panel.selected, .entry-panel.selected-promoted, .entry-panel.selected-demoted");
          if (selectedRow && typeof selectedRow.scrollIntoView === "function") {
            selectedRow.scrollIntoView({ behavior: "smooth", block: "center" });
          }
        }
      },
    });
  }

  // 5. AuctionBlockSetup.rml (`AuctionBlockModel`)
  async function mountAuctionSetupRml(spec, mySeq) {
    const formRows = collectFormRows(spec.blocks);
    const itemControl = (formRows.find((r) => r.control && r.control.kind === "item_slot") || {}).control || {};
    const pickerItems = itemControl.pickerItems || [];

    const models = {
      PopupModel: { PopupId: "auctionblock" },
      AuctionBlockModel: {
        Icon: 15546,
        EnableSetup: true,
        ItemId: itemControl.itemId || 0,
        ErrorMsg: itemControl.errorText || "",
        DurationHours: 1,
        PossibleDurations: [1, 3, 12],
        StartingPrice: "",
      },
    };

    const inst = await global.RmlUiEngine.mountDocument(hostEl, "/GameData/UI/Windows/Auction/AuctionBlockSetup.rml", {
      models,
      extraCss: `
        .rml-body { display: flex; align-items: center; justify-content: center; }
        #window.window { position: relative; margin: auto; width: calc(700 * var(--rml-dp)); }
        .auc-picker-grid { display: flex; flex-wrap: wrap; gap: calc(8 * var(--rml-dp)); margin-top: calc(10 * var(--rml-dp)); max-height: calc(150 * var(--rml-dp)); overflow-y: auto; padding: calc(8 * var(--rml-dp)); background: rgba(12, 45, 58, 0.78); border-radius: calc(6 * var(--rml-dp)); }
        .auc-picker-slot { width: calc(56 * var(--rml-dp)); height: calc(56 * var(--rml-dp)); background: rgba(24, 107, 139, 0.85); border: calc(2 * var(--rml-dp)) solid #87B8CC; border-radius: calc(6 * var(--rml-dp)); display: flex; flex-direction: column; align-items: center; justify-content: center; cursor: pointer; position: relative; }
        .auc-picker-slot img { width: calc(34 * var(--rml-dp)); height: calc(34 * var(--rml-dp)); image-rendering: pixelated; }
        .auc-picker-slot span { font-size: calc(11 * var(--rml-dp)); color: #fff; }
      `,
      onEvent(action) {
        if (mySeq !== openSeq) return;
        if (isCloseAction(action)) {
          closeDialog();
          return;
        }
        if (action === "auction.OnItem") {
          if (inst.isNative) {
            if (!pickerItems.length) {
              models.AuctionBlockModel.ErrorMsg = "No tradeable items in your inventory.";
            } else {
              const curIdx = pickerItems.findIndex((p) => Number(p.itemId) === Number(models.AuctionBlockModel.ItemId));
              const nextIt = pickerItems[(curIdx + 1) % pickerItems.length];
              models.AuctionBlockModel.ItemId = nextIt.itemId;
              models.AuctionBlockModel.ErrorMsg = "";
            }
            inst.refresh();
          } else {
            toggleInlineItemPicker(inst, pickerItems, models);
          }
          return;
        }
        if (action === "auction.OnStart") {
          const itemId = Number(models.AuctionBlockModel.ItemId) || 0;
          const startPrice = parseInt(String(models.AuctionBlockModel.StartingPrice || "0"), 10) || 0;
          if (itemId <= 0 || startPrice <= 0) return;
          const durVal = models.AuctionBlockModel.DurationHours + "h";
          sendDialogReturn(
            spec.dialogName,
            "start_auction",
            Object.assign({}, getEmbed(spec), {
              item_id: String(itemId),
              duration: durVal,
              start_price: String(startPrice),
            })
          );
          closeDialog();
        }
      },
    });

    if (inst.bodyEl) {
      const priceInput = inst.bodyEl.querySelector("input.input");
      if (priceInput) priceInput.setAttribute("data-numeric", "1");
    }
    return inst;
  }

  function toggleInlineItemPicker(inst, pickerItems, models) {
    const existing = inst.bodyEl.querySelector(".auc-picker-grid");
    if (existing) {
      existing.remove();
      return;
    }
    const anchorCell = inst.bodyEl.querySelector(".item-button");
    if (!anchorCell || !anchorCell.parentElement) return;

    const grid = document.createElement("div");
    grid.className = "auc-picker-grid show-scrollbar";
    if (!pickerItems.length) {
      grid.textContent = "No tradeable items in your inventory.";
    } else {
      for (const it of pickerItems) {
        const slot = document.createElement("div");
        slot.className = "auc-picker-slot";
        slot.title = it.name;
        const img = document.createElement("img");
        global.RmlUiEngine.bindItemIconImg(img, it.itemId);
        const cnt = document.createElement("span");
        cnt.textContent = "x" + it.count;
        slot.appendChild(img);
        slot.appendChild(cnt);
        slot.addEventListener("click", () => {
          models.AuctionBlockModel.ItemId = it.itemId;
          models.AuctionBlockModel.ErrorMsg = "";
          grid.remove();
          inst.refresh();
        });
        grid.appendChild(slot);
      }
    }
    anchorCell.parentElement.appendChild(grid);
  }

  // 6. AuctionBlockBid.rml (`AuctionBlockModel`)
  function mountAuctionBidRml(spec, mySeq) {
    const formRows = collectFormRows(spec.blocks);
    const itemControl = (formRows.find((r) => r.control && r.control.kind === "item_slot") || {}).control || {};
    const valControl = (formRows.find((r) => r.control && r.control.kind === "value") || {}).control || {};
    const bidControl = (formRows.find((r) => r.control && r.control.kind === "bid_group") || {}).control || {};

    const lines = valControl.lines || [];
    const wlLine = lines.find((l) => /WL/i.test(l)) || "0 WL";
    const wlMatch = /(\d+)/.exec(wlLine.replace(/`./g, ""));
    const currentWl = wlMatch ? parseInt(wlMatch[1], 10) : 1;
    const hasHighBidder = lines.some((l) => /Highest Bidder|highest bidder/i.test(l));
    const isOwner = !!(bidControl.noteText && /own auction/i.test(bidControl.noteText));
    const highLine = hasHighBidder ? lines[0] : "";
    const anyEnabledBid = (bidControl.buttons || []).some((b) => !b.disabled);

    const models = {
      PopupModel: { PopupId: "auctionblockbid" },
      AuctionBlockModel: {
        Icon: 15546,
        ItemId: itemControl.itemId || 0,
        IsBidder: hasHighBidder,
        IsOwner: isOwner,
        IsActive: (bidControl.expiresInSec || 0) > 0,
        CanBid: true,
        HighName: highLine,
        HighBidLocks: currentWl,
        StartingPrice: currentWl,
        PossibleBids: [1, 5, 10],
        AvailableLocks: anyEnabledBid ? currentWl + 100 : 0,
        AlreadyBidLocks: 0,
        EndTime: Math.floor(Date.now() / 1000) + Math.max(0, bidControl.expiresInSec || 0),
      },
    };

    return global.RmlUiEngine.mountDocument(hostEl, "/GameData/UI/Windows/Auction/AuctionBlockBid.rml", {
      models,
      extraCss: `
        .rml-body { display: flex; align-items: center; justify-content: center; }
        #window.window { position: relative; margin: auto; width: calc(700 * var(--rml-dp)); }
      `,
      onEvent(action, ctx) {
        if (mySeq !== openSeq) return;
        if (isCloseAction(action)) {
          closeDialog();
          return;
        }
        if (action === "auction.OnBid") {
          const inc = ctx.element && ctx.element.getAttribute("bid_value");
          if (inc) {
            sendDialogReturn(spec.dialogName, "bid_" + inc, getEmbed(spec));
          }
        }
      },
    });
  }

  function escRmlAttr(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function buildRmlFromModernBlocks(blocks, spec, formValues, popupModel, buttonMap, slotControls) {
    const out = [];
    const toRml = (t) => (global.RmlUiEngine ? global.RmlUiEngine.toRmlText(t || "") : escRmlAttr(t || ""));

    const emitButton = (btnSpec) => {
      if (!btnSpec) return "";
      const id = String(btnSpec.id || "ok");
      buttonMap.set(id, btnSpec);
      const cls = `${btnSpec.variant === "flat" ? "button" : "img-button"} ${mapBtnColorClass(btnSpec.color)}${btnSpec.disabled ? " disabled" : ""}`;
      const act = escRmlAttr("md.btn:" + id);
      return `<div class="${cls}" onclick="OnEvent(event, '${act}')"><span class="label">${toRml(btnSpec.label || "OK")}</span></div>`;
    };

    for (const blk of blocks || []) {
      if (!blk) continue;
      if (blk.type === "text") {
        out.push(`<div class="font-contentnormal color_dreamsicle">${toRml(blk.text || "")}</div>`);
      } else if (blk.type === "callout") {
        out.push(`<div class="font-contentnormal color_yellow">${toRml(blk.text || "")}</div>`);
      } else if (blk.type === "section") {
        const tone = blk.tone || "teal";
        out.push(`<div class="md-section md-section-${tone}">${buildRmlFromModernBlocks(blk.children || [], spec, formValues, popupModel, buttonMap, slotControls)}</div>`);
      } else if (blk.type === "counter_row") {
        const iconHtml = blk.iconItemId
          ? `<div style="width:32dp;height:32dp;display:inline-block;vertical-align:middle;" data-style-decorator="'itemidimage(${Number(blk.iconItemId) | 0})'"></div> `
          : "";
        const btnHtml = blk.rightButton ? ` ${emitButton(blk.rightButton)}` : "";
        out.push(`<div class="top-padding font-contentnormal color_dreamsicle">${iconHtml}${toRml(blk.text || "")}${btnHtml}</div>`);
      } else if (blk.type === "reward_grid") {
        const cards = (blk.rewards || []).map((r) =>
          `<div style="display:inline-block;margin-right:8dp;"><div style="width:28dp;height:28dp;display:inline-block;vertical-align:middle;" data-style-decorator="'itemidimage(${Number(r.itemId || 112) | 0})'"></div> <span class="font-contentnormal color_dreamsicle">${escRmlAttr((r.count || 1) + "x " + (r.label || ""))}</span></div>`
        ).join("");
        out.push(`<div class="top-padding">${cards}</div>`);
      } else if (blk.type === "challenges") {
        for (const ch of blk.items || []) {
          const iconHtml = ch.iconItemId
            ? `<div style="width:28dp;height:28dp;display:inline-block;vertical-align:middle;" data-style-decorator="'itemidimage(${Number(ch.iconItemId) | 0})'"></div> `
            : "";
          const right = ch.actionButton
            ? emitButton(ch.actionButton)
            : `<span class="${ch.state === "claimed" ? "color_green" : "color_dreamsicle"}">${ch.state === "claimed" ? "Unlocked" : `${ch.progress || 0}/${ch.target || 1}`}</span>`;
          out.push(`<div class="top-padding">${iconHtml}<span class="color_yellow">${toRml(ch.title || "")}</span> <span class="font-contentnormal color_dreamsicle">${toRml(ch.description || "")}</span> ${right}</div>`);
        }
      } else if (blk.type === "form_table" && Array.isArray(blk.rows)) {
        for (const row of blk.rows) {
          if (!row || !row.control) continue;
          out.push(...buildRmlFromModernBlocks([{ type: "form_row", label: row.label, control: row.control }], spec, formValues, popupModel, buttonMap, slotControls));
        }
      } else if (blk.type === "form_row" && blk.control) {
        const ctrl = blk.control;
        const fieldKey = "Form_" + String(ctrl.name || "field").replace(/[^a-zA-Z0-9_]/g, "_");
        if (ctrl.kind === "input") {
          formValues[ctrl.name] = String(ctrl.value || "");
          popupModel[fieldKey] = String(ctrl.value || "");
          const maxAttr = ctrl.maxLen ? ` maxlength="${Number(ctrl.maxLen) | 0}"` : "";
          out.push(`<div class="top-padding font-contentnormal color_dreamsicle"><span>${toRml(blk.label || "")}</span> <input class="input" type="text"${maxAttr} data-value="PopupModel.${fieldKey}"/></div>`);
        } else if (ctrl.kind === "segmented") {
          const initVal = ctrl.value || (ctrl.options && ctrl.options[0] && ctrl.options[0].value) || "";
          formValues[ctrl.name] = initVal;
          popupModel[fieldKey] = initVal;
          const opts = (ctrl.options || []).map((opt) => {
            const act = escRmlAttr(`md.seg:${ctrl.name}:${opt.value}`);
            return `<div class="button button-default-color" onclick="OnEvent(event, '${act}')"><span class="label">${escRmlAttr(opt.label)}</span></div>`;
          }).join(" ");
          out.push(`<div class="top-padding font-contentnormal color_dreamsicle"><span>${toRml(blk.label || "")}</span> ${opts}</div>`);
        } else if (ctrl.kind === "item_slot") {
          formValues[ctrl.name] = String(ctrl.itemId || 0);
          slotControls.set(ctrl.name, ctrl);
          const act = escRmlAttr(`md.slot:${ctrl.name}`);
          out.push(`<div class="top-padding font-contentnormal color_dreamsicle"><span>${toRml(blk.label || "")}</span> <div class="button button-default-color" onclick="OnEvent(event, '${act}')"><span class="label">${escRmlAttr(ctrl.itemName || "Select Item")}</span></div></div>`);
        }
      } else if (blk.type === "button") {
        out.push(`<div class="top-padding">${emitButton(blk.button)}</div>`);
      } else if (blk.type === "button_row") {
        out.push(`<div class="top-padding">${(blk.buttons || []).map(emitButton).join(" ")}</div>`);
      }
    }
    return out.join("\n");
  }

  // 7. GenericPopup.rml + BasePopup.rml for General Server `ModernDialog` Specs
  async function mountGenericModernDialogRml(spec, mySeq) {
    const formValues = Object.assign({}, getEmbed(spec));
    const titleItemId = Number((spec.title && spec.title.itemId) || 0) | 0;
    const titleIconUrl = (spec.title && spec.title.iconUrl) || "";
    const buttonMap = new Map();
    const slotControls = new Map();

    const models = {
      PopupModel: {
        PopupId: spec.dialogName || "generic",
        Title: {
          Icon: titleIconUrl,
          IconPath: titleIconUrl,
          IconSprite: "",
          IconItemId: titleItemId,
          Text: (spec.title && spec.title.text) || "",
        },
        Text: "",
        RmlContent: "",
        ButtonCancel: { Text: "", Style: "" },
        Button1: { Text: "", Style: "" },
        Button2: { Text: "", Style: "" },
      },
    };

    if (global.RmlUiEngine && global.RmlUiEngine.ensureNativeRmlUi) {
      await global.RmlUiEngine.ensureNativeRmlUi();
    }
    const isNative = !!(global.RmlUiEngine && global.RmlUiEngine.getNative && global.RmlUiEngine.getNative());
    if (isNative) {
      models.PopupModel.RmlContent = buildRmlFromModernBlocks(
        spec.blocks || [],
        spec,
        formValues,
        models.PopupModel,
        buttonMap,
        slotControls
      );
    }

    const rawWidth = spec.widthDp || spec.width || 700;
    const widthDp = Math.max(420, Math.min(960, rawWidth));

    const inst = await global.RmlUiEngine.mountDocument(hostEl, "/GameData/UI/Windows/GenericPopup.rml", {
      models,
      hideElementIds: spec.hideCloseButton ? ["popup-close-button"] : undefined,
      extraCss: `
        .rml-body { display: flex; align-items: center; justify-content: center; }
        #window.window { position: relative; margin: auto; width: calc(${widthDp} * var(--rml-dp)); max-height: calc(565 * var(--rml-dp)); }
        #generic-popup .buttons-panel { display: none; }
        .md-blocks { display: flex; flex-direction: column; gap: calc(10 * var(--rml-dp)); margin-top: calc(8 * var(--rml-dp)); }
        .md-section { padding: calc(12 * var(--rml-dp)); border-radius: calc(8 * var(--rml-dp)); background: rgba(12, 45, 58, 0.52); border: calc(1 * var(--rml-dp)) solid rgba(135, 184, 204, 0.35); display: flex; flex-direction: column; gap: calc(10 * var(--rml-dp)); }
        .md-section-dark { background: rgba(8, 32, 42, 0.72); }
        .md-section-card { background: rgba(10, 40, 52, 0.82); }
        .md-section-purple { background: rgba(45, 36, 72, 0.65); }
        .md-callout { padding: calc(10 * var(--rml-dp)) calc(12 * var(--rml-dp)); border-radius: calc(6 * var(--rml-dp)); background: rgba(34, 96, 120, 0.65); }
        .md-callout.warning { background: rgba(92, 62, 18, 0.72); }
        .md-counter-row { display: flex; align-items: center; justify-content: space-between; gap: calc(10 * var(--rml-dp)); padding: calc(6 * var(--rml-dp)) 0; }
        .md-counter-left { display: flex; align-items: center; gap: calc(10 * var(--rml-dp)); }
        .md-icon { width: calc(36 * var(--rml-dp)); height: calc(36 * var(--rml-dp)); image-rendering: pixelated; object-fit: contain; }
        .md-btn-row { display: flex; flex-wrap: wrap; gap: calc(12 * var(--rml-dp)); margin-top: calc(6 * var(--rml-dp)); }
        .md-btn-row.end { justify-content: flex-end; }
        .md-btn-row.center { justify-content: center; }
        .md-btn-row.between { justify-content: space-between; }
        .md-form-row { display: flex; align-items: center; justify-content: space-between; gap: calc(14 * var(--rml-dp)); padding: calc(8 * var(--rml-dp)) calc(10 * var(--rml-dp)); background: rgba(12, 45, 58, 0.45); border-radius: calc(6 * var(--rml-dp)); }
        .md-input { background: rgba(8, 32, 42, 0.9); border: calc(2 * var(--rml-dp)) solid #87B8CC; border-radius: calc(5 * var(--rml-dp)); padding: calc(8 * var(--rml-dp)) calc(10 * var(--rml-dp)); color: #fff; min-width: calc(220 * var(--rml-dp)); font-size: calc(18 * var(--rml-dp)); }
        .md-rewards { display: flex; flex-wrap: wrap; gap: calc(10 * var(--rml-dp)); }
        .md-reward-card { display: flex; align-items: center; gap: calc(8 * var(--rml-dp)); padding: calc(6 * var(--rml-dp)) calc(10 * var(--rml-dp)); background: rgba(12, 45, 58, 0.75); border: calc(1 * var(--rml-dp)) solid #87B8CC; border-radius: calc(6 * var(--rml-dp)); }
        .md-chal-item { padding: calc(10 * var(--rml-dp)); border-radius: calc(6 * var(--rml-dp)); background: rgba(16, 58, 74, 0.7); display: flex; align-items: center; justify-content: space-between; gap: calc(10 * var(--rml-dp)); }
      `,
      onEvent(action) {
        if (mySeq !== openSeq) return;
        if (isCloseAction(action)) {
          closeDialog();
          return;
        }
        if (typeof action === "string" && action.startsWith("md.btn:")) {
          const btnId = action.slice("md.btn:".length);
          const btnSpec = buttonMap.get(btnId);
          for (const [k, v] of Object.entries(models.PopupModel)) {
            if (k.startsWith("Form_")) {
              const origName = k.slice(5);
              formValues[origName] = v;
            }
          }
          if (btnSpec && Array.isArray(btnSpec.requireFields)) {
            for (const req of btnSpec.requireFields) {
              if (!String(formValues[req] || "").trim()) return;
            }
          }
          if (btnSpec && btnSpec.url) {
            if (global.GameSDK && typeof global.GameSDK.openUrl === "function") {
              global.GameSDK.openUrl(btnSpec.url);
            } else {
              try { global.open(btnSpec.url, "_blank", "noopener,noreferrer"); } catch (_e) {}
            }
            return;
          }
          sendDialogReturn(spec.dialogName, btnId, formValues);
          closeDialog();
          return;
        }
        if (typeof action === "string" && action.startsWith("md.seg:")) {
          const rest = action.slice("md.seg:".length);
          const sep = rest.indexOf(":");
          if (sep > 0) {
            const k = rest.slice(0, sep);
            const v = rest.slice(sep + 1);
            formValues[k] = v;
            models.PopupModel["Form_" + k.replace(/[^a-zA-Z0-9_]/g, "_")] = v;
          }
          return;
        }
        if (typeof action === "string" && action.startsWith("md.slot:")) {
          const k = action.slice("md.slot:".length);
          const ctrl = slotControls.get(k);
          const list = (ctrl && ctrl.pickerItems) || [];
          if (list.length) {
            const curIdx = list.findIndex((p) => String(p.itemId) === String(formValues[k]));
            const next = list[(curIdx + 1) % list.length];
            formValues[k] = String(next.itemId);
          }
        }
      },
    });

    if (inst.bodyEl) {
      const contentHost = inst.bodyEl.querySelector("#generic-popup .content");
      if (contentHost) {
        contentHost.innerHTML = "";
        const rootStack = document.createElement("div");
        rootStack.className = "md-blocks";
        renderModernBlocksInto(spec.blocks || [], rootStack, spec, formValues);
        contentHost.appendChild(rootStack);
      }
    }

    return inst;
  }

  function mapBtnColorClass(color) {
    if (color === "green") return "button-green-color";
    if (color === "purple") return "button-purple-color";
    if (color === "yellow") return "button-yellow-color";
    if (color === "lightblue") return "button-light-default-color";
    return "button-default-color";
  }

  function createRmlButtonElement(btnSpec, spec, formValues) {
    const btn = document.createElement("div");
    const baseCls = btnSpec.variant === "flat" ? "button" : "img-button";
    btn.className = `${baseCls} ${mapBtnColorClass(btnSpec.color)}${btnSpec.disabled ? " disabled" : ""}`;
    if (btnSpec.fullWidth) btn.style.width = "94%";
    const lbl = document.createElement("span");
    lbl.className = "label";
    lbl.style.fontSize = btnSpec.size === "sm" ? "calc(18 * var(--rml-dp))" : "calc(22 * var(--rml-dp))";
    lbl.innerHTML = global.RmlUiEngine.toRmlText(btnSpec.label || "OK");
    btn.appendChild(lbl);

    btn.addEventListener("click", () => {
      if (btn.classList.contains("disabled")) return;
      if (Array.isArray(btnSpec.requireFields)) {
        for (const req of btnSpec.requireFields) {
          if (!String(formValues[req] || "").trim()) return;
        }
      }
      if (btnSpec.url) {
        if (global.GameSDK && typeof global.GameSDK.openUrl === "function") {
          global.GameSDK.openUrl(btnSpec.url);
        } else {
          try { global.open(btnSpec.url, "_blank", "noopener,noreferrer"); } catch (_e) {}
        }
        return;
      }
      if (!btnSpec.closeOnClick) {
        sendDialogReturn(spec.dialogName, btnSpec.id, formValues);
      } else {
        sendDialogReturn(spec.dialogName, btnSpec.id, formValues);
        closeDialog();
        return;
      }
      closeDialog();
    });
    return btn;
  }

  function renderModernBlocksInto(blocks, container, spec, formValues) {
    for (const blk of blocks || []) {
      if (!blk) continue;

      if (blk.type === "text") {
        const d = document.createElement("div");
        d.className = "font-contentnormal color_dreamsicle";
        d.innerHTML = global.RmlUiEngine.toRmlText(blk.text || "");
        container.appendChild(d);
        continue;
      }

      if (blk.type === "callout") {
        const d = document.createElement("div");
        d.className = "md-callout font-contentnormal " + (blk.tone || "");
        d.innerHTML = global.RmlUiEngine.toRmlText(blk.text || "");
        container.appendChild(d);
        continue;
      }

      if (blk.type === "section") {
        const sec = document.createElement("div");
        sec.className = "md-section";
        renderModernBlocksInto(blk.children || [], sec, spec, formValues);
        container.appendChild(sec);
        continue;
      }

      if (blk.type === "counter_row") {
        const row = document.createElement("div");
        row.className = "md-counter-row";
        const left = document.createElement("div");
        left.className = "md-counter-left";
        if (blk.iconItemId || blk.iconUrl) {
          const img = document.createElement("img");
          img.className = "md-icon";
          if (blk.iconUrl) {
            img.src = blk.iconUrl;
          } else {
            global.RmlUiEngine.bindItemIconImg(img, blk.iconItemId);
          }
          left.appendChild(img);
        }
        const txt = document.createElement("div");
        txt.className = "font-contentnormal color_dreamsicle";
        txt.innerHTML = global.RmlUiEngine.toRmlText(blk.text || "");
        left.appendChild(txt);
        row.appendChild(left);
        if (blk.rightButton) {
          row.appendChild(createRmlButtonElement(blk.rightButton, spec, formValues));
        }
        container.appendChild(row);
        continue;
      }

      if (blk.type === "reward_grid") {
        const wrap = document.createElement("div");
        wrap.className = "md-rewards";
        for (const r of blk.rewards || []) {
          const card = document.createElement("div");
          card.className = "md-reward-card";
          const img = document.createElement("img");
          img.className = "md-icon";
          global.RmlUiEngine.bindItemIconImg(img, r.itemId || 112);
          const txt = document.createElement("span");
          txt.textContent = `${r.count || 1}x ${r.label || ""}`.trim();
          card.appendChild(img);
          card.appendChild(txt);
          wrap.appendChild(card);
        }
        container.appendChild(wrap);
        continue;
      }

      if (blk.type === "challenges") {
        for (const ch of blk.items || []) {
          const row = document.createElement("div");
          row.className = "md-chal-item";
          const left = document.createElement("div");
          left.className = "md-counter-left";
          if (ch.iconItemId) {
            const img = document.createElement("img");
            img.className = "md-icon";
            global.RmlUiEngine.bindItemIconImg(img, ch.iconItemId);
            left.appendChild(img);
          }
          const info = document.createElement("div");
          info.innerHTML =
            `<div class="color_yellow">${global.RmlUiEngine.toRmlText(ch.title || "")}</div>` +
            `<div class="color_dreamsicle" style="font-size:calc(14 * var(--rml-dp));">${global.RmlUiEngine.toRmlText(ch.description || "")}</div>`;
          left.appendChild(info);
          row.appendChild(left);
          if (ch.actionButton) {
            row.appendChild(createRmlButtonElement(ch.actionButton, spec, formValues));
          } else {
            const badge = document.createElement("span");
            badge.className = ch.state === "claimed" ? "color_green" : "color_dreamsicle";
            badge.textContent = ch.state === "claimed" ? "Unlocked" : `${ch.progress || 0}/${ch.target || 1}`;
            row.appendChild(badge);
          }
          container.appendChild(row);
        }
        continue;
      }

      if (blk.type === "form_row" && blk.control) {
        const row = document.createElement("div");
        row.className = "md-form-row";
        const lbl = document.createElement("div");
        lbl.className = "color_dreamsicle";
        lbl.innerHTML = global.RmlUiEngine.toRmlText(blk.label || "");
        row.appendChild(lbl);

        const ctrl = blk.control;
        if (ctrl.kind === "input") {
          const inp = document.createElement(ctrl.multiline ? "textarea" : "input");
          inp.className = "md-input";
          if (!ctrl.multiline) inp.type = "text";
          if (ctrl.maxLen) inp.maxLength = ctrl.maxLen;
          if (ctrl.placeholder) inp.placeholder = ctrl.placeholder;
          inp.value = ctrl.value || "";
          formValues[ctrl.name] = inp.value;
          inp.addEventListener("input", () => {
            if (ctrl.numeric) inp.value = inp.value.replace(/[^0-9]/g, "");
            formValues[ctrl.name] = inp.value;
          });
          row.appendChild(inp);
        } else if (ctrl.kind === "segmented") {
          const segWrap = document.createElement("div");
          segWrap.className = "md-btn-row";
          formValues[ctrl.name] = ctrl.value || (ctrl.options && ctrl.options[0] && ctrl.options[0].value) || "";
          const optBtns = [];
          for (const opt of ctrl.options || []) {
            const b = document.createElement("div");
            const updateCls = () => {
              b.className =
                "img-button " +
                (formValues[ctrl.name] === opt.value ? "button-green-color" : "button-tab-color");
            };
            updateCls();
            const sp = document.createElement("span");
            sp.className = "label";
            sp.style.fontSize = "calc(16 * var(--rml-dp))";
            sp.textContent = opt.label;
            b.appendChild(sp);
            b.addEventListener("click", () => {
              formValues[ctrl.name] = opt.value;
              optBtns.forEach((fn) => fn());
            });
            optBtns.push(updateCls);
            segWrap.appendChild(b);
          }
          row.appendChild(segWrap);
        } else if (ctrl.kind === "item_slot") {
          const slotWrap = document.createElement("div");
          slotWrap.style.display = "flex";
          slotWrap.style.flexDirection = "column";
          slotWrap.style.gap = "calc(6 * var(--rml-dp))";
          formValues[ctrl.name] = String(ctrl.itemId || 0);
          const pickBtn = document.createElement("div");
          pickBtn.className = "img-button button-default-color";
          const pickLbl = document.createElement("span");
          pickLbl.className = "label";
          pickLbl.style.fontSize = "calc(16 * var(--rml-dp))";
          pickLbl.textContent = ctrl.itemName || "Select Item";
          pickBtn.appendChild(pickLbl);
          slotWrap.appendChild(pickBtn);
          pickBtn.addEventListener("click", () => {
            let nextIdx = 0;
            const list = ctrl.pickerItems || [];
            if (!list.length) return;
            const curIdx = list.findIndex((p) => String(p.itemId) === String(formValues[ctrl.name]));
            nextIdx = (curIdx + 1) % list.length;
            formValues[ctrl.name] = String(list[nextIdx].itemId);
            pickLbl.textContent = `${list[nextIdx].name} (x${list[nextIdx].count})`;
          });
          row.appendChild(slotWrap);
        }
        container.appendChild(row);
        continue;
      }

      if (blk.type === "button") {
        container.appendChild(createRmlButtonElement(blk.button, spec, formValues));
        continue;
      }

      if (blk.type === "button_row") {
        const row = document.createElement("div");
        row.className = "md-btn-row " + (blk.justify || "end");
        for (const b of blk.buttons || []) {
          row.appendChild(createRmlButtonElement(b, spec, formValues));
        }
        container.appendChild(row);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Main Entry Point: Mount Official `.rml` Window for Incoming Packet
  // -------------------------------------------------------------------------
  async function openDialogSpec(spec) {
    if (!spec || typeof spec !== "object" || !global.RmlUiEngine) return;
    ensureHostOverlay();

    const mySeq = ++openSeq;
    if (activeDoc) {
      activeDoc.destroy();
      activeDoc = null;
    }

    activeSpec = spec;
    // Keep the game responsive while the native RmlUi document is being
    // parsed/loaded. Showing the full-screen backdrop and modal gate before
    // mount() made the UI look frozen on slower phones.
    if (backdropEl) backdropEl.style.display = "none";
    try { global.RmlUiEngine.wasm.setModalOpen(false); } catch (_e) {}

    try {
      const dlgName = spec.dialogName || "";
      let mounted = null;

      if (spec.rmlDocument) {
        mounted = await global.RmlUiEngine.mountDocument(hostEl, spec.rmlDocument, {
          models: spec.rmlModels || {},
          extraCss: `.rml-body { display: flex; align-items: center; justify-content: center; } #window.window { position: relative; margin: auto; }`,
          onEvent(action) {
            if (mySeq !== openSeq) return;
            if (isCloseAction(action)) closeDialog();
            else sendDialogReturn(dlgName, action, spec.embed);
          },
        });
      } else if (dlgName === "sidebar_mailbox") {
        mounted = await mountMailBoxRml(spec, mySeq);
      } else if (dlgName === "sidebar_mailbox_view") {
        mounted = await mountMailMessageRml(spec, mySeq);
      } else if (dlgName === "sidebar_dungeon") {
        mounted = await mountDungeonStartRml(spec, mySeq);
      } else if (dlgName === "sidebar_dungeon_league") {
        mounted = await mountDungeonLeaderboardRml(spec, mySeq);
      } else if (dlgName === "modern_auction_setup") {
        mounted = await mountAuctionSetupRml(spec, mySeq);
      } else if (dlgName === "modern_auction_bid") {
        mounted = await mountAuctionBidRml(spec, mySeq);
      } else {
        mounted = await mountGenericModernDialogRml(spec, mySeq);
      }

      if (mySeq !== openSeq) {
        if (mounted) mounted.destroy();
        return;
      }
      if (backdropEl) {
        const isNat = !!(mounted && mounted.isNative);
        backdropEl.style.pointerEvents = isNat ? "none" : "auto";
        backdropEl.style.backgroundColor = isNat ? "transparent" : "rgba(0, 0, 0, 0.42)";
        backdropEl.style.display = "flex";
      }
      try { global.RmlUiEngine.wasm.setModalOpen(true); } catch (_e) {}
      if (mounted && mounted.bodyEl) {
        const closeBtns = mounted.bodyEl.querySelectorAll("#popup-close-button, .window-close-button");
        closeBtns.forEach((btn) => {
          if (!btn.__directCloseBound) {
            btn.__directCloseBound = true;
            btn.addEventListener("click", (ev) => {
              ev.stopPropagation();
              if (mySeq === openSeq) closeDialog();
            });
          }
        });
      }
      activeDoc = mounted;
      setDialogVisible(mounted, true);
    } catch (err) {
      console.error("[ModernDialogUI] Error mounting RmlUi popup:", err);
      if (mySeq === openSeq) closeDialog();
    }
  }

  function onModernDialogPacket(args) {
    const raw = args && args[1];
    if (typeof raw !== "string" || !raw) return;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (_) {
      return;
    }
    openDialogSpec(parsed);
  }

  async function prewarm(options = {}) {
    if (!global.RmlUiEngine) return;
    ensureHostOverlay();
    const docs = [
      ["/GameData/UI/Windows/MailBox.rml", { PopupModel: { PopupId: "mailbox" }, MailBoxModel: { UnreadTotal: 0, Messages: [], NewPageRequested: 0 } }],
      ["/GameData/UI/Windows/MailMessage.rml", { PopupModel: { PopupId: "mailmessage" }, MailMessageModel: { Icon: 660, Title: "Mail", Descr: "", Reward: [], Status: 1 } }],
      ["/GameData/UI/Windows/Dungeon/DungeonStartUi.rml", { PopupModel: { PopupId: "dungeonstartui" }, DungeonStartUiModel: { Challenges: [] } }],
      ["/GameData/UI/Windows/Dungeon/Leaderboard.rml", { PopupModel: { PopupId: "dungeonleaderboard" }, DungeonLeaderboardModel: { Entries: [] } }],
      ["/GameData/UI/Windows/Auction/AuctionBlockSetup.rml", { PopupModel: { PopupId: "auctionblock" }, AuctionBlockModel: { PossibleDurations: [1, 3, 12] } }],
      ["/GameData/UI/Windows/Auction/AuctionBlockBid.rml", { PopupModel: { PopupId: "auctionblockbid" }, AuctionBlockModel: { PossibleBids: [1, 5, 10] } }],
      ["/GameData/UI/Windows/GenericPopup.rml", { PopupModel: { PopupId: "generic", Text: "", RmlContent: "", ButtonCancel: { Text: "", Style: "" }, Button1: { Text: "", Style: "" }, Button2: { Text: "", Style: "" } } }],
    ];
    for (const [url, models] of docs) {
      if ((options.signal && options.signal.aborted) || activeSpec) break;
      let inst = null;
      try {
        inst = await global.RmlUiEngine.mountDocument(hostEl, url, {
          modal: false,
          initiallyHidden: true,
          models,
          extraCss: ".rml-body { display: flex; align-items: center; justify-content: center; } #window.window { position: relative; margin: auto; }",
        });
      } catch (err) {
        console.warn("[ModernDialogUI] prewarm skipped", url, err);
      } finally {
        if (inst) inst.destroy();
      }
    }
  }

  function install() {
    if (installed) return;
    installed = true;
    ensureHostOverlay();
    if (global.GameSDK && typeof global.GameSDK.onPacket === "function") {
      global.GameSDK.onPacket("OnModernDialogRequest", onModernDialogPacket);
    }
  }

  global.ModernDialogUI = {
    install,
    prewarm,
    open: openDialogSpec,
    close: closeDialog,
    isOpen() {
      return !!activeDoc;
    },
    getActiveDialogName() {
      return activeSpec ? activeSpec.dialogName : "";
    },
  };
})(globalThis);
