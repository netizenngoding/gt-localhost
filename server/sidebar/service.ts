import type { ServerContext } from "../database/context";
import type { MailMessage, PlayerAccount, PlayerSession } from "../database/peer";
import { makeVariantPacket } from "../proton/packet";
import {
  OnConsoleMessage,
  OnModernDialogRequest,
  OnPlayPositioned,
  OnSetBux,
  OnTalkBubble,
} from "../onVariant";
import { displayName, hasPermission } from "../ranks";
import { getDailyQuestForDate } from "../action/dialog_return/telephone_locke";
import { ACHIEVEMENTS } from "../progression/catalog";
import { progression, recordProgress } from "../progression/service";
import {
  ModernDialog,
  type ModernButtonSpec,
  type ModernChallengeSpec,
  type ModernLeaderboardEntry,
  type ModernMailCardSpec,
  type ModernRankTier,
  type ModernRewardSpec,
} from "../tools/modern_dialog";
import {
  openAuctionBlockDialog,
  openAuctionSetupModal,
  openModernDialogPlayground,
  settleExpiredAuctions,
} from "../auction/service";

export const MAX_DUNGEON_SCROLLS = 20;
const SCROLL_REGEN_INTERVAL_MS = 15 * 60 * 1000; // +1 scroll every 15 minutes
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

interface RankBracketInfo {
  tier: ModernRankTier;
  stars: 1 | 2 | 3;
  title: string;
  minPoints: number;
  nextPoints: number;
}

const LEAGUE_BRACKETS: RankBracketInfo[] = [
  { tier: "bronze", stars: 1, title: "Bronze 1 League", minPoints: 0, nextPoints: 20000 },
  { tier: "bronze", stars: 2, title: "Bronze 2 League", minPoints: 20000, nextPoints: 45000 },
  { tier: "bronze", stars: 3, title: "Bronze 3 League", minPoints: 45000, nextPoints: 80000 },
  { tier: "silver", stars: 1, title: "Silver 1 League", minPoints: 80000, nextPoints: 130000 },
  { tier: "silver", stars: 2, title: "Silver 2 League", minPoints: 130000, nextPoints: 200000 },
  { tier: "silver", stars: 3, title: "Silver 3 League", minPoints: 200000, nextPoints: 290000 },
  { tier: "gold", stars: 1, title: "Gold 1 League", minPoints: 290000, nextPoints: 400000 },
  { tier: "gold", stars: 2, title: "Gold 2 League", minPoints: 400000, nextPoints: 530000 },
  { tier: "gold", stars: 3, title: "Gold 3 League", minPoints: 530000, nextPoints: 680000 },
  { tier: "ruby", stars: 1, title: "Ruby 1 League", minPoints: 680000, nextPoints: 860000 },
  { tier: "ruby", stars: 2, title: "Ruby 2 League", minPoints: 860000, nextPoints: 1080000 },
  { tier: "ruby", stars: 3, title: "Ruby 3 League", minPoints: 1080000, nextPoints: 1350000 },
  { tier: "emerald", stars: 1, title: "Emerald 1 League", minPoints: 1350000, nextPoints: 1650000 },
  { tier: "emerald", stars: 2, title: "Emerald 2 League", minPoints: 1650000, nextPoints: 2000000 },
  { tier: "emerald", stars: 3, title: "Emerald 3 League", minPoints: 2000000, nextPoints: 2450000 },
  { tier: "sapphire", stars: 1, title: "Sapphire 1 League", minPoints: 2450000, nextPoints: 3000000 },
  { tier: "sapphire", stars: 2, title: "Sapphire 2 League", minPoints: 3000000, nextPoints: 3800000 },
  { tier: "sapphire", stars: 3, title: "Sapphire 3 League", minPoints: 3800000, nextPoints: 5000000 },
];

function getBracketForPoints(points: number): RankBracketInfo {
  let chosen = LEAGUE_BRACKETS[0];
  for (const b of LEAGUE_BRACKETS) {
    if (points >= b.minPoints) chosen = b;
  }
  return chosen;
}

interface DailyChallengeDef {
  id: string;
  title: string;
  description: string;
  iconItemId: number;
  target: number;
  points: number;
  rewardGems: number;
  rewardItemId?: number;
  rewardItemCount?: number;
}

const DAILY_DUNGEON_CHALLENGES: DailyChallengeDef[] = [
  {
    id: "shriekgazer",
    title: "Defeat 8 Shriekgazer",
    description:
      "Venture deep into the Dungeon caverns and vanquish 8 Shriekgazer aberrations during Dungeon expeditions.",
    iconItemId: 14734, // Dungeons Shopkeeper
    target: 8,
    points: 20000,
    rewardGems: 1500,
  },
  {
    id: "damage_up",
    title: "Buy Damage Up Common 20 Times",
    description:
      "Spend Dungeon Coins inside expeditions to upgrade Damage Up Common 20 times.",
    iconItemId: 14734,
    target: 20,
    points: 20000,
    rewardGems: 2000,
  },
  {
    id: "clear_runs",
    title: "Complete 3 Dungeon Expeditions",
    description:
      "Start and complete 3 Dungeon runs today to claim bonus Leaderboard Points and a World Lock.",
    iconItemId: 14738, // Silver Dungeon Chest
    target: 3,
    points: 35000,
    rewardGems: 2500,
    rewardItemId: 242,
    rewardItemCount: 1,
  },
];

function ensureDungeonDailyState(account: PlayerAccount, now = Date.now()): Record<string, { progress: number; claimed: boolean }> {
  const dayKey = Math.floor(now / 86400000);
  if (account.dungeonChallengeDay !== dayKey || !account.dungeonChallenges) {
    account.dungeonChallengeDay = dayKey;
    account.dungeonChallenges = {};
    for (const ch of DAILY_DUNGEON_CHALLENGES) {
      account.dungeonChallenges[ch.id] = { progress: 0, claimed: false };
    }
  }
  for (const ch of DAILY_DUNGEON_CHALLENGES) {
    if (!account.dungeonChallenges[ch.id]) {
      account.dungeonChallenges[ch.id] = { progress: 0, claimed: false };
    }
  }
  return account.dungeonChallenges;
}

export function syncDungeonScrolls(account: PlayerAccount, now = Date.now()): number {
  let cur =
    typeof account.dungeonScrolls === "number"
      ? Math.max(0, Math.min(MAX_DUNGEON_SCROLLS, Math.floor(account.dungeonScrolls)))
      : MAX_DUNGEON_SCROLLS;
  let last = typeof account.dungeonScrollUpdatedAt === "number" ? account.dungeonScrollUpdatedAt : now;
  if (cur >= MAX_DUNGEON_SCROLLS) {
    account.dungeonScrolls = MAX_DUNGEON_SCROLLS;
    account.dungeonScrollUpdatedAt = now;
    return MAX_DUNGEON_SCROLLS;
  }
  const elapsed = Math.max(0, now - last);
  const gained = Math.floor(elapsed / SCROLL_REGEN_INTERVAL_MS);
  if (gained > 0) {
    cur = Math.min(MAX_DUNGEON_SCROLLS, cur + gained);
    last = cur >= MAX_DUNGEON_SCROLLS ? now : last + gained * SCROLL_REGEN_INTERVAL_MS;
    account.dungeonScrolls = cur;
    account.dungeonScrollUpdatedAt = last;
  }
  return cur;
}

export function countUnreadMail(account: PlayerAccount): number {
  const box = account.mailbox || [];
  const now = Date.now();
  let unread = 0;
  for (const msg of box) {
    if (msg.expiresAt && msg.expiresAt <= now) continue;
    const hasUnclaimedReward =
      !msg.claimed &&
      ((msg.rewardGems && msg.rewardGems > 0) ||
        (msg.rewardItemId && msg.rewardItemCount && msg.rewardItemCount > 0));
    if (!msg.read || hasUnclaimedReward) unread++;
  }
  return unread;
}

export function sendSidebarHudState(ctx: ServerContext, session: PlayerSession): void {
  if (!session.peer || !session.account) return;
  const acct = session.account;
  const now = Date.now();
  const scrolls = syncDungeonScrolls(acct, now);
  const nextScrollSec =
    scrolls >= MAX_DUNGEON_SCROLLS
      ? 0
      : Math.max(
          1,
          Math.ceil((SCROLL_REGEN_INTERVAL_MS - Math.max(0, now - (acct.dungeonScrollUpdatedAt || now))) / 1000)
        );

  const quest = getDailyQuestForDate(new Date(now));
  const questDone = acct.lastDailyQuestDay === quest.dayKey ? 1 : 0;
  const item1Name = ctx.itemsDb.get(quest.item1)?.name || "Dirt";
  const item2Name = ctx.itemsDb.get(quest.item2)?.name || "Rock";
  const have1 = acct.inventory.find((s) => s.itemId === quest.item1 && s.count > 0)?.count || 0;
  const have2 = acct.inventory.find((s) => s.itemId === quest.item2 && s.count > 0)?.count || 0;
  const questReady = !questDone && have1 >= quest.count1 && have2 >= quest.count2;

  const prog = progression(acct);
  const earnedCount = ACHIEVEMENTS.filter((a) => !!prog.earned[a.id]).length;
  const totalCount = ACHIEVEMENTS.length;

  const payload = {
    netId: session.netId || 0,
    rawName: acct.name,
    displayName: displayName(session),
    gems: acct.gems || 0,
    inWorld: !!session.world,
    worldName: session.world?.name || "",
    questDone,
    questMax: 1,
    questReady,
    questTitle: questDone ? "Daily Quest Completed!" : "Crazy Jim's Daily Quest",
    questDesc: questDone
      ? "Come back tomorrow for a fresh Growtoken quest from Crazy Jim!"
      : `Deliver ${quest.count1} ${item1Name} (${Math.min(have1, quest.count1)}/${quest.count1}) & ${quest.count2} ${item2Name} (${Math.min(have2, quest.count2)}/${quest.count2})`,
    scrolls,
    scrollsMax: MAX_DUNGEON_SCROLLS,
    nextScrollSec,
    unreadMail: countUnreadMail(acct),
    totalMail: (acct.mailbox || []).length,
    achievementsEarned: earnedCount,
    achievementsTotal: totalCount,
  };

  session.peer.sendPacket(
    0,
    makeVariantPacket(["OnMagnoliaSidebarHud", JSON.stringify(payload)]),
    true,
    false
  );
}

// ---------------------------------------------------------------------------
// 1. Modern Dungeons Modal (Matches image-23.png & image-24.png)
// ---------------------------------------------------------------------------
export function openDungeonScrollbankDialog(ctx: ServerContext, session: PlayerSession): void {
  const acct = session.account;
  const now = Date.now();
  const scrolls = syncDungeonScrolls(acct, now);
  const nextScrollSec =
    scrolls >= MAX_DUNGEON_SCROLLS
      ? 0
      : Math.max(
          1,
          Math.ceil((SCROLL_REGEN_INTERVAL_MS - Math.max(0, now - (acct.dungeonScrollUpdatedAt || now))) / 1000)
        );

  const points = Math.max(0, Math.floor(acct.dungeonPoints ?? 135000));
  if (acct.dungeonPoints == null) acct.dungeonPoints = points;
  const bracket = getBracketForPoints(points);

  const hasPass = !!(acct.dungeonPassUntil && acct.dungeonPassUntil > now);
  const passRemainingSec = hasPass ? Math.ceil((acct.dungeonPassUntil! - now) / 1000) : 0;

  const chMap = ensureDungeonDailyState(acct, now);
  const challengeSpecs: ModernChallengeSpec[] = DAILY_DUNGEON_CHALLENGES.map((ch) => {
    const st = chMap[ch.id] || { progress: 0, claimed: false };
    const prog = Math.min(ch.target, st.progress);
    const state: ModernChallengeSpec["state"] = st.claimed
      ? "claimed"
      : prog >= ch.target
      ? "completed"
      : prog > 0
      ? "inprogress"
      : "inprogress";

    const rewards: ModernRewardSpec[] = [{ itemId: 112, count: ch.rewardGems, label: "Gems" }];
    if (ch.rewardItemId && ch.rewardItemCount) {
      rewards.push({ itemId: ch.rewardItemId, count: ch.rewardItemCount });
    }

    return {
      id: ch.id,
      title: ch.title,
      description: ch.description,
      iconItemId: ch.iconItemId,
      progress: prog,
      target: ch.target,
      points: ch.points,
      state,
      rewards,
      actionButton:
        state === "completed"
          ? {
              id: `claim_chal_${ch.id}`,
              label: "Claim Reward",
              color: "green",
              size: "sm",
            }
          : undefined,
    };
  });

  const enterCost = hasPass ? 3 : 5;

  const dlg = new ModernDialog("sidebar_dungeon", { width: 830 })
    .setTitle("Dungeons", { iconUrl: "/branding/modern-ui/dungeon_title_icon.png" })
    .addText(
      "Go on an adventure, explore dungeons and use their unique currency to upgrade your abilities. Just remember, what happens in the dungeon stays in the dungeon!",
      { size: "md" }
    )
    .addAccordion(
      "Dungeon Information",
      "Spend `wScrolls`` to enter procedural Dungeon floors! Defeating monsters advances your `5Dungeon Daily Challenges`` and awards `wDungeons Leaderboard Points`` toward weekly League promotions (`6Bronze`` -> `wSilver`` -> `$Gold`` -> `4Ruby`` -> `2Emerald`` -> `!Sapphire``).\n\nScrollbank regenerates `+1 Scroll`` every 15 minutes up to `w20/20``.",
      { variant: "teal", defaultOpen: false }
    )
    .beginSection({ tone: "teal" })
    .addButton("start_dungeon", "Start Dungeon", {
      color: "purple",
      fullWidth: true,
      iconItemId: 14730,
      rightText: String(enterCost),
      disabled: scrolls < enterCost,
    })
    .addCounterRow({
      iconItemId: 14730,
      text: `Scrolls: ${scrolls}/${MAX_DUNGEON_SCROLLS}`,
      timerSeconds: nextScrollSec,
      timerPrefix: "More in: ",
      timerIdleText: "More in: --",
      rightButton: {
        id: "invite_friends",
        label: "Invite Friends",
        color: "default",
        iconUrl: "/branding/modern-ui/dungeon_invite_icon.png",
        size: "md",
      },
    });

  if (hasPass) {
    dlg
      .addButtonRow(
        [
          {
            id: "buy_scrolls",
            label: "Buy Scrolls",
            color: "green",
            disabled: scrolls >= MAX_DUNGEON_SCROLLS,
          },
        ],
        { justify: "between" }
      )
      .addCountdown("Dungeon Pass Active: ", passRemainingSec, "Pass Expired");
  } else {
    dlg.addButtonRow(
      [
        {
          id: "buy_scrolls",
          label: "Buy Scrolls",
          color: "green",
          disabled: scrolls >= MAX_DUNGEON_SCROLLS,
        },
        {
          id: "buy_pass",
          label: "Buy Dungeon Pass",
          color: "green",
        },
      ],
      { justify: "between" }
    );
  }

  dlg
    .addCallout(
      "Warning: Leaving the Dungeon at any point will prevent re-entry into the same world. All ability upgrades will be lost as well.",
      "warning"
    )
    .endSection()
    .addRankBanner({
      label: "Your Rank:",
      rank: bracket.tier,
      stars: bracket.stars,
      bgUrl: "/branding/modern-ui/dungeon_league_bg.png",
      button: {
        id: "open_league",
        label: "League Standings",
        color: "default",
      },
    })
    .beginSection({ tone: "teal" })
    .addChallenges({
      title: "Dungeon Daily Challenges",
      iconItemId: 3902, // Crazy Jim
      items: challengeSpecs,
    })
    .endSection()
    .addButton("close_dungeons", "Close", {
      color: "yellow",
      closeOnClick: true,
    });

  OnModernDialogRequest(session, dlg);
  sendSidebarHudState(ctx, session);
}

// ---------------------------------------------------------------------------
// 2. Modern League Standings Modal (Matches image-25.png)
// ---------------------------------------------------------------------------
export function openDungeonLeagueDialog(ctx: ServerContext, session: PlayerSession): void {
  const acct = session.account;
  const selfPoints = Math.max(0, Math.floor(acct.dungeonPoints ?? 135000));
  const bracket = getBracketForPoints(selfPoints);

  // Build competitive league bracket combining real server accounts + bracket rivals
  const poolMap = new Map<string, { name: string; points: number; isSelf: boolean }>();
  poolMap.set(acct.name.toLowerCase(), { name: acct.name, points: selfPoints, isSelf: true });

  for (const other of ctx.accounts.values()) {
    if (other.userId === acct.userId) continue;
    const pts = other.dungeonPoints ?? 0;
    if (pts > 0) {
      poolMap.set(other.name.toLowerCase(), { name: other.name, points: pts, isSelf: false });
    }
  }

  const seededRivals: Array<[string, number]> = [
    ["CelestialGT", bracket.minPoints + 92000],
    ["ShadowDelver", bracket.minPoints + 81500],
    ["AarQwarl", bracket.minPoints + 70000],
    ["WoAiMaoMao", bracket.minPoints + 69000],
    ["SkiPIBI", bracket.minPoints + 67500],
    ["KaitoRunes", bracket.minPoints + 58000],
    ["Nyxblade", bracket.minPoints + 49500],
    ["GrowKnight", bracket.minPoints + 38000],
    ["PixelMage", bracket.minPoints + 24000],
    ["TerraMiner", Math.max(2500, bracket.minPoints + 8500)],
  ];
  for (const [rName, rPts] of seededRivals) {
    if (!poolMap.has(rName.toLowerCase())) {
      poolMap.set(rName.toLowerCase(), { name: rName, points: rPts, isSelf: false });
    }
  }

  const sorted = Array.from(poolMap.values()).sort((a, b) => b.points - a.points);
  const totalCount = sorted.length;
  const promotionCutoff = Math.max(1, Math.floor(totalCount * 0.3));
  const demotionCutoff = Math.max(promotionCutoff + 1, totalCount - Math.max(1, Math.floor(totalCount * 0.1)));

  let selfRank = 1;
  const entries: ModernLeaderboardEntry[] = sorted.map((row, idx) => {
    const rank = idx + 1;
    if (row.isSelf) selfRank = rank;
    const gemReward =
      rank === 1 ? 15000 : rank <= promotionCutoff ? 10000 : rank <= Math.ceil(totalCount * 0.6) ? 7000 : 3000;
    const rewards: ModernRewardSpec[] = [{ itemId: 112, count: gemReward, label: "Gems" }];
    if (rank === 1) {
      rewards.push({ itemId: 242, count: 2, label: "World Lock" });
    }
    return {
      rank,
      name: row.name,
      points: row.points,
      rewards,
    };
  });

  const topPct = Math.max(1, Math.round((selfRank / Math.max(1, totalCount)) * 100));
  // Weekly league resets every Monday 00:00 UTC
  const now = Date.now();
  const weekMs = 7 * 86400 * 1000;
  const remainingSec = Math.max(60, Math.floor((weekMs - (now % weekMs)) / 1000));

  const dlg = new ModernDialog("sidebar_dungeon_league", { width: 900 })
    .setTitle(bracket.title)
    .addLeagueSummary({
      rank: bracket.tier,
      stars: bracket.stars,
      timerSeconds: remainingSec,
      timerPrefix: "Ends In: ",
      description:
        "The top 30% will be promoted to the next league bracket and the bottom 10% will drop down to previous league bracket",
      positionText: `Top ${topPct}% (#${selfRank})`,
      points: selfPoints,
      gotoButtonLabel: "Go To Your Rank",
    })
    .addAccordion(
      "League Info",
      "Complete dungeons to earn points and advance your rank. The higher your rank, the more rewarding the prizes!",
      {
        variant: "purple",
        defaultOpen: false,
        bannerUrl: "/branding/modern-ui/all_rank_banner.png",
      }
    )
    .addLeaderboard({
      entries,
      selfRank,
      promotionCutoff,
      demotionCutoff,
    })
    .addButtonRow(
      [{ id: "back_to_dungeons", label: "Back", color: "default" }],
      { justify: "start" }
    );

  OnModernDialogRequest(session, dlg);
}

// ---------------------------------------------------------------------------
// 3. Modern Mailbox Modal (Matches image-27.png + MailMessage.rml)
// ---------------------------------------------------------------------------
export function openMailboxDialog(ctx: ServerContext, session: PlayerSession): void {
  settleExpiredAuctions(ctx);
  const acct = session.account;
  if (!acct.mailbox) acct.mailbox = [];
  const now = Date.now();

  // Filter out expired messages that have already been claimed/read
  acct.mailbox = acct.mailbox.filter((m) => {
    if (!m.expiresAt || m.expiresAt > now) return true;
    const hasUnclaimed =
      !m.claimed &&
      ((m.rewardGems && m.rewardGems > 0) ||
        (m.rewardItemId && m.rewardItemCount && m.rewardItemCount > 0));
    return hasUnclaimed;
  });

  const box = acct.mailbox;
  const unreadCount = countUnreadMail(acct);

  const cards: ModernMailCardSpec[] = [];
  for (let i = box.length - 1; i >= 0; i--) {
    const m = box[i];
    const hasUnclaimedReward =
      !m.claimed &&
      ((m.rewardGems && m.rewardGems > 0) ||
        (m.rewardItemId && m.rewardItemCount && m.rewardItemCount > 0));
    const expAt = m.expiresAt || m.createdAt + THIRTY_DAYS_MS;
    const expiresInSec = Math.max(0, Math.floor((expAt - now) / 1000));

    const iconItemId =
      m.iconItemId ||
      (m.rewardItemId && !m.iconUrl ? m.rewardItemId : 660);

    cards.push({
      id: m.id,
      buttonId: `view_${m.id}`,
      title: m.subject,
      description: m.body,
      iconItemId,
      iconUrl: m.iconUrl,
      unread: !m.read,
      hasUnclaimedReward: !!hasUnclaimedReward,
      claimButtonId: hasUnclaimedReward ? `quickclaim_${m.id}` : undefined,
      claimLabel: "Claim",
      expiresInSec,
    });
  }

  const dlg = new ModernDialog("sidebar_mailbox", { width: 850, minHeightDp: 475 })
    .setTitle("Mailbox", { itemId: 660 })
    .addMailHeader({
      unreadCount,
      claimAllButton:
        unreadCount > 0
          ? {
              id: "claim_all",
              label: "Claim All",
              color: "green",
              size: "sm",
            }
          : undefined,
    })
    .addMailList({
      emptyText: "You don't have any messages.",
      messages: cards,
    });

  OnModernDialogRequest(session, dlg);
  sendSidebarHudState(ctx, session);
}

// ---------------------------------------------------------------------------
// 4. Modern Crazy Jim's Daily Quest, Salesman & Achievements
// ---------------------------------------------------------------------------
export function openCrazyJimSidebarDialog(ctx: ServerContext, session: PlayerSession): void {
  session.lastWrenchX = Math.floor((session.x || 320) / 32);
  session.lastWrenchY = Math.floor((session.y || 320) / 32);

  const quest = getDailyQuestForDate(new Date());
  if (session.account.lastDailyQuestDay === quest.dayKey) {
    const dlg = new ModernDialog("3898", { width: 680 })
      .setTitle("Crazy Jim's Daily Quest", { itemId: 3902 })
      .addCallout(
        "Thanks again for helping me out today! You already claimed today's `2Growtoken``. Come back tomorrow for a brand-new Daily Quest!",
        "success"
      )
      .addSpacer("sm")
      .addButtonRow([{ id: "cancel", label: "Close", color: "default", closeOnClick: true }], { justify: "end" });
    OnModernDialogRequest(session, dlg);
    return;
  }

  const item1Name = ctx.itemsDb.get(quest.item1)?.name || "Dirt";
  const item2Name = ctx.itemsDb.get(quest.item2)?.name || "Rock";
  const have1 = session.account.inventory.find((s) => s.itemId === quest.item1 && s.count > 0)?.count || 0;
  const have2 = session.account.inventory.find((s) => s.itemId === quest.item2 && s.count > 0)?.count || 0;
  const canTurnIn = have1 >= quest.count1 && have2 >= quest.count2;

  const dlg = new ModernDialog("3898", { width: 700 })
    .setTitle("Crazy Jim's Daily Quest", { itemId: 3902 })
    .addText("Howdy partner! Deliver both of these items before midnight to earn a `2Growtoken``:")
    .beginSection({ tone: "teal" })
    .addCounterRow({
      iconItemId: quest.item1,
      text: `\`2${quest.count1} ${item1Name}\`\` \`o(You have: ${have1})\`\``,
    })
    .addCounterRow({
      iconItemId: quest.item2,
      text: `\`2${quest.count2} ${item2Name}\`\` \`o(You have: ${have2})\`\``,
    })
    .addText("Reward:", { size: "sm" })
    .addRewardGrid([{ itemId: 1486, count: 1, label: "Growtoken" }])
    .endSection()
    .addButtonRow(
      [
        { id: "cancel", label: "Later", color: "default", closeOnClick: true },
        { id: "turnin", label: "Turn In Items", color: "green", disabled: !canTurnIn },
      ],
      { justify: "end" }
    );

  OnModernDialogRequest(session, dlg);
}

const ACHIEVEMENT_ICON_BY_METRIC: Record<string, number> = {
  blocks_placed: 14,
  trees_harvested: 2,
  blocks_broken: 98,
  gems_held: 112,
  world_locks_used: 242,
  locks_used: 202,
  consumables_used: 4604,
  level: 1486,
  backpack: 1486,
  other_players: 32,
  supporter: 1796,
  items_trashed: 18,
};

export function openModernAchievementsDialog(session: PlayerSession): void {
  const prog = progression(session.account);
  const earnedCount = ACHIEVEMENTS.filter((a) => !!prog.earned[a.id]).length;

  const items: ModernChallengeSpec[] = ACHIEVEMENTS.slice(0, 20).map((ach) => {
    const done = !!prog.earned[ach.id];
    const metricVal = Math.min(ach.target, (prog as any).counters?.[ach.metric] ?? (done ? ach.target : 0));
    return {
      id: ach.id,
      title: `${ach.title} (${ach.division})`,
      description: `Progress metric: ${ach.metric.replace(/_/g, " ")} (${metricVal.toLocaleString()}/${ach.target.toLocaleString()})`,
      iconItemId: ACHIEVEMENT_ICON_BY_METRIC[ach.metric] || 1486,
      progress: done ? ach.target : metricVal,
      target: ach.target,
      state: done ? "claimed" : "inprogress",
    };
  });

  const dlg = new ModernDialog("sidebar_achievements_modern", { width: 800 })
    .setTitle("Achievements & Goals", { itemId: 1486 })
    .addText(`Unlocked \`2${earnedCount}\`\` of \`w${ACHIEVEMENTS.length}\`\` Server Achievements!`)
    .beginSection({ tone: "teal" })
    .addChallenges({
      title: "Player Milestones",
      iconItemId: 1486,
      items,
    })
    .endSection();

  OnModernDialogRequest(session, dlg);
}

export function openModernSalesmanDialog(ctx: ServerContext, session: PlayerSession): void {
  const growtokens = session.account.inventory.find((s) => s.itemId === 1486)?.count || 0;
  const dlg = new ModernDialog("sidebar_salesman_modern", { width: 720 })
    .setTitle("Traveling Salesman", { itemId: 1486 })
    .addText(
      `Welcome, friend! Trade your hard-earned \`2Growtokens\`\` (You have: \`w${growtokens}\`\`) or Gems for exclusive traveling supplies:`
    )
    .beginSection({ tone: "teal" })
    .addCounterRow({
      iconItemId: 242,
      text: "`wWorld Lock Pack`` `o(2,000 Gems)``",
      rightButton: {
        id: "buy_wl_gems",
        label: "Buy (2,000 Gems)",
        color: "green",
        size: "sm",
        disabled: (session.account.gems || 0) < 2000,
      },
    })
    .addCounterRow({
      iconUrl: "/branding/modern-ui/dungeon_scroll.png",
      text: "`wFull Scrollbank Refill`` `o(1 Growtoken)``",
      rightButton: {
        id: "buy_scroll_gt",
        label: "Trade 1 GT",
        color: "purple",
        size: "sm",
        disabled: growtokens < 1,
      },
    })
    .addCounterRow({
      iconItemId: 1796,
      text: "`wDiamond Lock Bundle`` `o(10 Growtokens)``",
      rightButton: {
        id: "buy_dl_gt",
        label: "Trade 10 GT",
        color: "green",
        size: "sm",
        disabled: growtokens < 10,
      },
    })
    .addCounterRow({
      iconItemId: 15546,
      text: "`wAuction Block`` `o(5,000 Gems - Place & Wrench to Auction Items!)`",
      rightButton: {
        id: "buy_auction_block",
        label: "Buy (5,000 Gems)",
        color: "lightblue",
        size: "sm",
        disabled: (session.account.gems || 0) < 5000,
      },
    })
    .endSection();

  OnModernDialogRequest(session, dlg);
}

// ---------------------------------------------------------------------------
// 5. Mail Delivery Helper
// ---------------------------------------------------------------------------
export function deliverMailToAccount(
  ctx: ServerContext,
  targetAccount: PlayerAccount,
  mail: Omit<MailMessage, "id" | "createdAt" | "read" | "claimed">
): void {
  if (!targetAccount.mailbox) targetAccount.mailbox = [];
  const now = Date.now();
  targetAccount.mailbox.push({
    id: `${now.toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    sender: mail.sender.replace(/[|\r\n\0]/g, " ").slice(0, 32),
    subject: mail.subject.replace(/[|\r\n\0]/g, " ").slice(0, 64),
    body: mail.body.replace(/[|\r\n\0]/g, " ").slice(0, 360),
    createdAt: now,
    expiresAt: mail.expiresAt || now + THIRTY_DAYS_MS,
    read: false,
    claimed: !(mail.rewardGems || mail.rewardItemId),
    iconItemId: mail.iconItemId,
    iconUrl: mail.iconUrl,
    rewardGems: mail.rewardGems && mail.rewardGems > 0 ? Math.floor(mail.rewardGems) : undefined,
    rewardItemId: mail.rewardItemId && mail.rewardItemId > 0 ? Math.floor(mail.rewardItemId) : undefined,
    rewardItemCount:
      mail.rewardItemCount && mail.rewardItemCount > 0
        ? Math.min(200, Math.floor(mail.rewardItemCount))
        : undefined,
  });
  if (targetAccount.mailbox.length > 40) {
    targetAccount.mailbox = targetAccount.mailbox.slice(-40);
  }
  ctx.dirty = true;
  ctx.savePlayersNow();

  for (const live of ctx.sessions) {
    if (live.account.userId === targetAccount.userId) {
      OnConsoleMessage(
        live,
        `\`2[Mailbox]\`\` You received new mail from \`w${mail.sender}\`\`: \`$${mail.subject}\`\`!`
      );
      OnPlayPositioned(live, "audio/beep.wav", 0);
      sendSidebarHudState(ctx, live);
    }
  }
}

export function sendWelcomeMail(
  ctx: ServerContext,
  targetAccount: PlayerAccount,
  displayName = targetAccount.name
): void {
  const safeName = String(displayName || targetAccount.name || "Growtopian")
    .replace(/[`|\r\n\0]/g, "")
    .slice(0, 32);
  deliverMailToAccount(ctx, targetAccount, {
    sender: "Magnolia",
    subject: "Welcome to Magnolia!",
    body: `\`2Welcome to Magnolia, \`w${safeName}\`2!\`\` Your account is ready. This Mailbox is where we deliver rewards, auction results, and important news. Here is a small starter gift to say hello. Have fun and build something amazing!`,
    iconItemId: 660,
    rewardGems: 100,
    rewardItemId: 242,
    rewardItemCount: 1,
  });
}

function claimSingleMailReward(ctx: ServerContext, session: PlayerSession, msg: MailMessage): string[] {
  if (msg.claimed) return [];
  msg.claimed = true;
  msg.read = true;
  const parts: string[] = [];
  if (msg.rewardGems && msg.rewardGems > 0) {
    session.account.gems = (session.account.gems || 0) + msg.rewardGems;
    OnSetBux(session);
    parts.push(`\`$${msg.rewardGems.toLocaleString()} Gems\`\``);
  }
  if (msg.rewardItemId && msg.rewardItemCount && msg.rewardItemCount > 0) {
    ctx.giveInventoryItem(session, msg.rewardItemId, msg.rewardItemCount, true);
    const itemName = ctx.itemsDb.get(msg.rewardItemId)?.name || `Item #${msg.rewardItemId}`;
    parts.push(`\`2${msg.rewardItemCount} ${itemName}\`\``);
  }
  return parts;
}

// ---------------------------------------------------------------------------
// 6. Sidebar Action & Dialog Return Routers
// ---------------------------------------------------------------------------
export function handleSidebarHudAction(
  ctx: ServerContext,
  session: PlayerSession,
  kv: Record<string, string>
): void {
  const btn = (kv.button || "").trim();
  if (btn === "sync") {
    sendSidebarHudState(ctx, session);
    return;
  }
  if (btn === "daily_quest") {
    openCrazyJimSidebarDialog(ctx, session);
    return;
  }
  if (btn === "scrollbank") {
    openDungeonScrollbankDialog(ctx, session);
    return;
  }
  if (btn === "mailbox") {
    openMailboxDialog(ctx, session);
    return;
  }
  if (btn === "salesman") {
    openModernSalesmanDialog(ctx, session);
    return;
  }
  if (btn === "achievements") {
    openModernAchievementsDialog(session);
    return;
  }
  if (btn === "auction") {
    openAuctionSetupModal(ctx, session, `personal:${session.account.userId}`, session.world?.name || "START", 0, 0);
    return;
  }
}

export function handleSidebarDialogReturn(
  ctx: ServerContext,
  session: PlayerSession,
  dlgName: string,
  kv: Record<string, string>
): boolean {
  const btn = kv.buttonClicked || "";

  if (dlgName === "modern_ui_playground") {
    if (btn === "open_dungeons") {
      openDungeonScrollbankDialog(ctx, session);
      return true;
    }
    if (btn === "open_mailbox") {
      openMailboxDialog(ctx, session);
      return true;
    }
    if (btn === "open_auction") {
      openAuctionSetupModal(ctx, session, `personal:${session.account.userId}`, session.world?.name || "START", 0, 0);
      return true;
    }
    if (btn === "submit_demo") {
      const itemId = parseInt(kv.demo_item || "0", 10) || 0;
      const itemName = itemId > 0 ? ctx.itemsDb.get(itemId)?.name || `#${itemId}` : "None";
      OnConsoleMessage(
        session,
        `\`2[ModernDialog]\`\` Diterima! Item=\`w${itemName}\`\`, Mode=\`5${kv.demo_mode || "-"}\`\`, Pesan=\`$${kv.demo_msg || ""}\`\``
      );
      return true;
    }
    return true;
  }

  if (dlgName === "sidebar_dungeon_league") {
    if (btn === "back_to_dungeons") {
      openDungeonScrollbankDialog(ctx, session);
    }
    return true;
  }

  if (dlgName === "sidebar_dungeon") {
    if (btn === "open_league") {
      openDungeonLeagueDialog(ctx, session);
      return true;
    }

    if (btn === "invite_friends") {
      const worldName = session.world?.name || "START";
      let invited = 0;
      for (const fId of session.account.friendIds || []) {
        const liveFriend = Array.from(ctx.sessions).find((s) => s.account.userId === fId);
        if (liveFriend) {
          OnConsoleMessage(
            liveFriend,
            `\`5[Dungeons]\`\` Your friend \`w${session.account.name}\`\` invited you to join a Dungeon party in \`$${worldName}\`\`!`
          );
          invited++;
        }
      }
      OnConsoleMessage(
        session,
        invited > 0
          ? `\`2[Dungeons]\`\` Sent Dungeon party invite to \`w${invited}\`\` online friend(s)!`
          : "`6[Dungeons]`` None of your friends are currently online to invite."
      );
      openDungeonScrollbankDialog(ctx, session);
      return true;
    }

    if (btn === "buy_scrolls") {
      const costGems = 500;
      const curScrolls = syncDungeonScrolls(session.account);
      if (curScrolls >= MAX_DUNGEON_SCROLLS) {
        OnConsoleMessage(session, "`6[Dungeons]`` Your Scrollbank is already full (20/20)!");
        openDungeonScrollbankDialog(ctx, session);
        return true;
      }
      if ((session.account.gems || 0) < costGems) {
        OnConsoleMessage(session, "`4You need 500 Gems to purchase +5 Dungeon Scrolls!``");
        openDungeonScrollbankDialog(ctx, session);
        return true;
      }
      session.account.gems -= costGems;
      session.account.dungeonScrolls = Math.min(MAX_DUNGEON_SCROLLS, curScrolls + 5);
      session.account.dungeonScrollUpdatedAt = Date.now();
      OnSetBux(session);
      ctx.dirty = true;
      ctx.savePlayersNow();
      OnPlayPositioned(session, "audio/cash_register.wav", 0);
      OnConsoleMessage(session, "`2[Dungeons]`` Purchased `w+5 Scrolls`` for `$500 Gems``!");
      openDungeonScrollbankDialog(ctx, session);
      return true;
    }

    if (btn === "buy_pass") {
      const passCost = 2500;
      if ((session.account.gems || 0) < passCost) {
        OnConsoleMessage(session, "`4You need 2,500 Gems to activate a 7-Day Dungeon Pass!``");
        openDungeonScrollbankDialog(ctx, session);
        return true;
      }
      session.account.gems -= passCost;
      session.account.dungeonPassUntil = Date.now() + 7 * 86400 * 1000;
      OnSetBux(session);
      ctx.dirty = true;
      ctx.savePlayersNow();
      OnPlayPositioned(session, "audio/cash_register.wav", 0);
      OnConsoleMessage(
        session,
        "`2[Dungeons]`` Activated `5Dungeon Pass (7 Days)``! Dungeon entry now costs only `w3 Scrolls`` and awards `+50% Points``!"
      );
      openDungeonScrollbankDialog(ctx, session);
      return true;
    }

    if (btn.startsWith("claim_chal_")) {
      const chId = btn.slice("claim_chal_".length);
      const def = DAILY_DUNGEON_CHALLENGES.find((c) => c.id === chId);
      const chMap = ensureDungeonDailyState(session.account);
      const st = def ? chMap[def.id] : undefined;
      if (def && st && !st.claimed && st.progress >= def.target) {
        st.claimed = true;
        session.account.dungeonPoints = (session.account.dungeonPoints ?? 135000) + def.points;
        session.account.gems = (session.account.gems || 0) + def.rewardGems;
        OnSetBux(session);
        if (def.rewardItemId && def.rewardItemCount) {
          ctx.giveInventoryItem(session, def.rewardItemId, def.rewardItemCount, true);
        }
        ctx.dirty = true;
        ctx.savePlayersNow();
        OnPlayPositioned(session, "audio/cash_register.wav", 0);
        OnConsoleMessage(
          session,
          `\`2[Dungeons]\`\` Claimed challenge \`w${def.title}\`\`: \`+${def.points.toLocaleString()} Points\`\` & \`$${def.rewardGems.toLocaleString()} Gems\`\`!`
        );
      }
      openDungeonScrollbankDialog(ctx, session);
      return true;
    }

    if (btn === "start_dungeon" || btn === "run_goblin" || btn === "run_crypt" || btn === "run_dragon") {
      const hasPass = !!(session.account.dungeonPassUntil && session.account.dungeonPassUntil > Date.now());
      const cost = btn === "run_crypt" ? 10 : btn === "run_dragon" ? 20 : hasPass ? 3 : 5;
      const avail = syncDungeonScrolls(session.account);
      if (avail < cost) {
        OnConsoleMessage(
          session,
          `\`4Not enough Scrolls! You need ${cost} Scrolls (you have ${avail}/${MAX_DUNGEON_SCROLLS}).\`\``
        );
        openDungeonScrollbankDialog(ctx, session);
        return true;
      }

      if (avail === MAX_DUNGEON_SCROLLS) {
        session.account.dungeonScrollUpdatedAt = Date.now();
      }
      session.account.dungeonScrolls = avail - cost;

      const rewardGems = 450 + Math.floor(Math.random() * 550);
      const earnedPts = Math.round((7500 + Math.floor(Math.random() * 5000)) * (hasPass ? 1.5 : 1));
      const xp = 125;

      session.account.gems = (session.account.gems || 0) + rewardGems;
      session.account.dungeonPoints = (session.account.dungeonPoints ?? 135000) + earnedPts;
      OnSetBux(session);
      recordProgress(ctx, session, undefined, 0, xp);

      // Advance Daily Dungeon Challenges!
      const chMap = ensureDungeonDailyState(session.account);
      chMap.shriekgazer.progress = Math.min(8, chMap.shriekgazer.progress + 2 + Math.floor(Math.random() * 3));
      chMap.damage_up.progress = Math.min(20, chMap.damage_up.progress + 5 + Math.floor(Math.random() * 4));
      chMap.clear_runs.progress = Math.min(3, chMap.clear_runs.progress + 1);

      let bonusMsg = "";
      if (Math.random() < 0.08) {
        ctx.giveInventoryItem(session, 242, 1, true);
        bonusMsg = " + `21 World Lock``";
      }

      ctx.dirty = true;
      ctx.savePlayersNow();
      OnPlayPositioned(session, "audio/cash_register.wav", 0);
      if (session.netId) {
        OnTalkBubble(
          session,
          session.netId,
          `\`5+${earnedPts.toLocaleString()} Dungeon Pts\`\`, \`$${rewardGems} Gems\`\`${bonusMsg}!`,
          0
        );
      }
      OnConsoleMessage(
        session,
        `\`2[Dungeons]\`\` Expedition cleared! Earned \`5+${earnedPts.toLocaleString()} Leaderboard Points\`\`, \`$${rewardGems.toLocaleString()} Gems\`\`, \`#${xp} XP\`\`${bonusMsg}.`
      );
      sendSidebarHudState(ctx, session);
      openDungeonScrollbankDialog(ctx, session);
      return true;
    }
    return true;
  }

  if (dlgName === "sidebar_salesman_modern") {
    if (btn === "buy_wl_gems" && (session.account.gems || 0) >= 2000) {
      session.account.gems -= 2000;
      OnSetBux(session);
      ctx.giveInventoryItem(session, 242, 1, true);
      OnPlayPositioned(session, "audio/cash_register.wav", 0);
      OnConsoleMessage(session, "`2[Salesman]`` Purchased `w1 World Lock`` for `$2,000 Gems``!");
    } else if (btn === "buy_scroll_gt" && ctx.consumeInventoryItem(session, 1486, 1, true)) {
      session.account.dungeonScrolls = MAX_DUNGEON_SCROLLS;
      session.account.dungeonScrollUpdatedAt = Date.now();
      OnPlayPositioned(session, "audio/cash_register.wav", 0);
      OnConsoleMessage(session, "`2[Salesman]`` Refilled your `wDungeon Scrollbank (20/20)``!");
    } else if (btn === "buy_dl_gt" && ctx.consumeInventoryItem(session, 1486, 10, true)) {
      ctx.giveInventoryItem(session, 1796, 1, true);
      OnPlayPositioned(session, "audio/cash_register.wav", 0);
      OnConsoleMessage(session, "`2[Salesman]`` Traded 10 Growtokens for `w1 Diamond Lock``!");
    } else if (btn === "buy_auction_block" && (session.account.gems || 0) >= 5000) {
      session.account.gems -= 5000;
      OnSetBux(session);
      ctx.giveInventoryItem(session, 15546, 1, true);
      OnPlayPositioned(session, "audio/cash_register.wav", 0);
      OnConsoleMessage(
        session,
        "`2[Salesman]`` Purchased `w1 Auction Block``! Place it in your world and Wrench it to host auctions."
      );
    }
    ctx.dirty = true;
    ctx.savePlayersNow();
    sendSidebarHudState(ctx, session);
    openModernSalesmanDialog(ctx, session);
    return true;
  }

  if (dlgName === "sidebar_mailbox") {
    if (btn === "compose_mail") {
      const dlg = new ModernDialog("sidebar_mailbox_send", { width: 720 })
        .setTitle("Send Mail", { itemId: 660 })
        .addText("Send a message (and optional Gem gift!) directly to another player's Mailbox:", { size: "sm" })
        .addFormRow("Recipient Name", {
          kind: "input",
          name: "to_name",
          value: "",
          placeholder: "Player GrowID",
          maxLen: 18,
        })
        .addFormRow("Subject", {
          kind: "input",
          name: "subject",
          value: "Hello!",
          maxLen: 42,
        })
        .addFormRow("Message", {
          kind: "input",
          name: "body",
          value: "",
          multiline: true,
          rows: 3,
          maxLen: 220,
        })
        .addFormRow("Attach Gems", {
          kind: "input",
          name: "gift_gems",
          value: "0",
          numeric: true,
          maxLen: 9,
          trailingItemId: 112,
        })
        .addButtonRow(
          [
            { id: "back_inbox", label: "Back", color: "default" },
            { id: "send_now", label: "Send Mail", color: "green", requireFields: ["to_name"] },
          ],
          { justify: "end" }
        );
      OnModernDialogRequest(session, dlg);
      return true;
    }

    if (btn === "claim_all") {
      const claimedParts: string[] = [];
      for (const m of session.account.mailbox || []) {
        claimedParts.push(...claimSingleMailReward(ctx, session, m));
        m.read = true;
      }
      ctx.dirty = true;
      ctx.savePlayersNow();
      if (claimedParts.length > 0) {
        OnPlayPositioned(session, "audio/cash_register.wav", 0);
        OnConsoleMessage(session, `\`2[Mailbox]\`\` Claimed all rewards: ${claimedParts.join(", ")}!`);
      }
      sendSidebarHudState(ctx, session);
      openMailboxDialog(ctx, session);
      return true;
    }

    if (btn.startsWith("quickclaim_")) {
      const id = btn.slice("quickclaim_".length);
      const msg = (session.account.mailbox || []).find((m) => m.id === id);
      if (msg) {
        const parts = claimSingleMailReward(ctx, session, msg);
        ctx.dirty = true;
        ctx.savePlayersNow();
        if (parts.length > 0) {
          OnPlayPositioned(session, "audio/cash_register.wav", 0);
          OnConsoleMessage(session, `\`2[Mailbox]\`\` Claimed ${parts.join(" + ")}!`);
        }
      }
      sendSidebarHudState(ctx, session);
      openMailboxDialog(ctx, session);
      return true;
    }

    if (btn === "clear_read") {
      session.account.mailbox = (session.account.mailbox || []).filter((m) => {
        const hasUnclaimed =
          !m.claimed &&
          ((m.rewardGems && m.rewardGems > 0) ||
            (m.rewardItemId && m.rewardItemCount && m.rewardItemCount > 0));
        return !m.read || hasUnclaimed;
      });
      ctx.dirty = true;
      ctx.savePlayersNow();
      sendSidebarHudState(ctx, session);
      openMailboxDialog(ctx, session);
      return true;
    }

    if (btn.startsWith("view_")) {
      const id = btn.slice(5);
      const msg = (session.account.mailbox || []).find((m) => m.id === id);
      if (!msg) {
        openMailboxDialog(ctx, session);
        return true;
      }
      msg.read = true;
      ctx.dirty = true;
      ctx.savePlayersNow();

      const hasGift =
        !msg.claimed &&
        ((msg.rewardGems && msg.rewardGems > 0) ||
          (msg.rewardItemId && msg.rewardItemCount && msg.rewardItemCount > 0));

      const rewards: ModernRewardSpec[] = [];
      if (msg.rewardGems && msg.rewardGems > 0) {
        rewards.push({ itemId: 112, count: msg.rewardGems, label: "Gems" });
      }
      if (msg.rewardItemId && msg.rewardItemCount && msg.rewardItemCount > 0) {
        rewards.push({ itemId: msg.rewardItemId, count: msg.rewardItemCount });
      }

      const dlg = new ModernDialog("sidebar_mailbox_view", { width: 700 })
        .setTitle(msg.subject, {
          itemId: msg.iconUrl ? undefined : msg.iconItemId || msg.rewardItemId || 660,
          iconUrl: msg.iconUrl,
        })
        .addSpacer("sm")
        .addText(msg.body || "(No message text)");

      if (rewards.length > 0) {
        dlg.addRewardGrid(rewards, msg.claimed);
      }

      const footer: ModernButtonSpec[] = [
        { id: "back_inbox", label: "Back", color: "lightblue", variant: "flat" },
      ];
      if (hasGift) {
        footer.push({ id: `claim_${msg.id}`, label: "Claim", color: "green", variant: "flat" });
      }
      dlg.addSpacer("sm").addButtonRow(footer, { justify: "center" });

      OnModernDialogRequest(session, dlg);
      sendSidebarHudState(ctx, session);
      return true;
    }
    return true;
  }

  if (dlgName === "sidebar_mailbox_view") {
    if (btn === "back_inbox") {
      openMailboxDialog(ctx, session);
      return true;
    }
    if (btn.startsWith("claim_")) {
      const id = btn.slice(6);
      const msg = (session.account.mailbox || []).find((m) => m.id === id);
      if (msg) {
        const parts = claimSingleMailReward(ctx, session, msg);
        ctx.dirty = true;
        ctx.savePlayersNow();
        if (parts.length > 0) {
          OnPlayPositioned(session, "audio/cash_register.wav", 0);
          OnConsoleMessage(session, `\`2[Mailbox]\`\` Claimed ${parts.join(" + ")}!`);
        }
      }
      sendSidebarHudState(ctx, session);
      openMailboxDialog(ctx, session);
      return true;
    }
    if (btn.startsWith("delete_")) {
      const id = btn.slice(7);
      session.account.mailbox = (session.account.mailbox || []).filter((m) => m.id !== id);
      ctx.dirty = true;
      ctx.savePlayersNow();
      sendSidebarHudState(ctx, session);
      openMailboxDialog(ctx, session);
      return true;
    }
    return true;
  }

  if (dlgName === "sidebar_mailbox_send") {
    if (btn === "back_inbox" || btn === "cancel") {
      openMailboxDialog(ctx, session);
      return true;
    }
    const toRaw = (kv.to_name || "").trim();
    const subject = (kv.subject || "Mail").trim().slice(0, 48) || "Mail";
    const body = (kv.body || "").trim().slice(0, 240);
    const giftGems = Math.max(0, Math.floor(Number(kv.gift_gems || "0") || 0));

    if (!toRaw) {
      OnConsoleMessage(session, "`4Please enter a recipient player name.``");
      return true;
    }
    const target = ctx.accounts.get(toRaw.toLowerCase());
    if (!target) {
      OnConsoleMessage(session, `\`4Player '${toRaw}' was not found.\`\``);
      return true;
    }
    if (target.userId === session.account.userId) {
      OnConsoleMessage(session, "`4You cannot mail gifts to yourself!``");
      return true;
    }
    if (giftGems > 0 && (session.account.gems || 0) < giftGems) {
      OnConsoleMessage(session, `\`4You don't have enough Gems to attach ${giftGems.toLocaleString()} Gems!\`\``);
      return true;
    }
    if (giftGems > 0) {
      session.account.gems -= giftGems;
      OnSetBux(session);
    }

    deliverMailToAccount(ctx, target, {
      sender: session.account.name,
      subject,
      body: body || `${session.account.name} sent you a message!`,
      rewardGems: giftGems > 0 ? giftGems : undefined,
    });
    OnConsoleMessage(
      session,
      `\`2[Mailbox]\`\` Sent mail to \`w${target.name}\`\`${
        giftGems > 0 ? ` with \`$${giftGems.toLocaleString()} Gems\`\`` : ""
      }!`
    );
    sendSidebarHudState(ctx, session);
    openMailboxDialog(ctx, session);
    return true;
  }

  return false;
}

export function handleSidebarCommand(
  ctx: ServerContext,
  session: PlayerSession,
  cmd: string,
  parts: string[]
): boolean {
  if (cmd === "mail" || cmd === "mailbox") {
    openMailboxDialog(ctx, session);
    return true;
  }
  if (cmd === "dungeon" || cmd === "dungeons" || cmd === "scrolls") {
    openDungeonScrollbankDialog(ctx, session);
    return true;
  }
  if (cmd === "league" || cmd === "standings") {
    openDungeonLeagueDialog(ctx, session);
    return true;
  }
  if (cmd === "dailyquest" || cmd === "crazyjim") {
    openCrazyJimSidebarDialog(ctx, session);
    return true;
  }
  if (cmd === "modui" || cmd === "moderndialog") {
    openModernDialogPlayground(ctx, session);
    return true;
  }
  if (cmd === "testmail" || cmd === "welcomemail") {
    sendWelcomeMail(ctx, session.account, session.account.name);
    openMailboxDialog(ctx, session);
    return true;
  }
  if (cmd === "sendmail") {
    const targetName = parts[1] || "";
    if (!targetName || targetName.toLowerCase() === "demo") {
      deliverMailToAccount(ctx, session.account, {
        sender: "Growtopia System",
        subject: "System Message",
        body: "Greetings Growtopian, here is a complimentary care package for testing the official Mailbox!",
        iconItemId: 1432,
        rewardGems: 500,
      });
      deliverMailToAccount(ctx, session.account, {
        sender: "Auction System",
        subject: "Auction Won!",
        body: "Congratulations! You won `wRed Hair`` for `w2 World Lock``.",
        iconUrl: "/branding/modern-ui/auction_sold.png",
        rewardItemId: 44,
        rewardItemCount: 1,
      });
      sendSidebarHudState(ctx, session);
      openMailboxDialog(ctx, session);
      return true;
    }
    if (!hasPermission(session.account, "grantItems") && !hasPermission(session.account, "debug")) {
      OnConsoleMessage(session, "`4Unknown command.`` Enter `$/?`` for a list of valid commands.");
      return true;
    }
    const gems = Math.max(0, Math.floor(Number(parts[2] || "0") || 0));
    const msgText = parts.slice(3).join(" ").trim() || "Enjoy this reward from the server staff!";
    const target = ctx.accounts.get(targetName.toLowerCase());
    if (!target) {
      OnConsoleMessage(session, `\`4Player '${targetName}' not found.\`\``);
      return true;
    }
    deliverMailToAccount(ctx, target, {
      sender: `${session.account.name} (Staff)`,
      subject: gems > 0 ? `Reward: ${gems.toLocaleString()} Gems` : "System Message",
      body: msgText,
      iconItemId: 1432,
      rewardGems: gems > 0 ? gems : undefined,
    });
    OnConsoleMessage(session, `\`2[Mailbox]\`\` Delivered mail to \`w${target.name}\`\` (${gems.toLocaleString()} Gems).`);
    return true;
  }
  return false;
}

export { openAuctionBlockDialog };
