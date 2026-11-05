import {
  AppSettings,
  CashFlowForecastResult,
  ClosedLoopMLState,
  Currency,
  Goal,
  GoalLiquidSurplusPlan,
  GuidanceAggressiveness,
  Holding,
  Liability,
  OnlineSpendIncomeModelState,
  RLMovementRecommendation,
  SubconsciousNudgeFrequency,
  SubconsciousNudgePreferences,
  Transaction,
} from '../types';
import { DEFAULT_SUBCONSCIOUS_NUDGE_PREFS } from './defaults';
import { convertToBase } from './calcEngine';
import { formatCompactMoney, formatMoney } from './formatters';

export interface AggressivenessSpec {
  level: GuidanceAggressiveness;
  numericRank: number; // 1 to 5
  archetype: string;
  avatarIcon: string;
  badgeLabel: string;
  shieldPercentage: number;
  xpMultiplier: string;
  color: string;
  accentBorder: string;
  accentBg: string;
  accentText: string;
  toneDescription: string;
  sampleHeadline: string;
  sampleBody: string;
}

export const AGGRESSIVENESS_ORDER: GuidanceAggressiveness[] = [
  'subtle',
  'gentle',
  'balanced',
  'assertive',
  'direct',
];

export const AGGRESSIVENESS_SPECS: Record<GuidanceAggressiveness, AggressivenessSpec> = {
  subtle: {
    level: 'subtle',
    numericRank: 1,
    archetype: 'Zen Monk',
    avatarIcon: '🧘',
    badgeLabel: 'Level 1: Passive Observer',
    shieldPercentage: 20,
    xpMultiplier: '1.0x XP',
    color: 'emerald',
    accentBorder: 'border-emerald-500/40',
    accentBg: 'bg-emerald-500/10',
    accentText: 'text-emerald-400',
    toneDescription: 'Minimalist whispers. Observes quietly and trusts user discipline without friction.',
    sampleHeadline: 'Subtle Note: Safe surplus is quietly compounding in place',
    sampleBody: 'Surplus cash is comfortably buffering everyday runway. Tap whenever you wish to review allocations.',
  },
  gentle: {
    level: 'gentle',
    numericRank: 2,
    archetype: 'Mindful Guardian',
    avatarIcon: '🛡️',
    badgeLabel: 'Level 2: Mindful Scout',
    shieldPercentage: 40,
    xpMultiplier: '1.2x XP',
    color: 'cyan',
    accentBorder: 'border-cyan-500/40',
    accentBg: 'bg-cyan-500/10',
    accentText: 'text-cyan-400',
    toneDescription: 'Supportive, encouraging cues highlighting micro-wins and painless positive habits.',
    sampleHeadline: 'Mindful Insight: Small trim on dining keeps ₹1,400 protected',
    sampleBody: 'A light touch on discretionary outlays this week easily preserves full milestone velocity.',
  },
  balanced: {
    level: 'balanced',
    numericRank: 3,
    archetype: 'Balanced Strategist',
    avatarIcon: '⚖️',
    badgeLabel: 'Level 3: Wealth Tactician',
    shieldPercentage: 60,
    xpMultiplier: '1.5x XP',
    color: 'indigo',
    accentBorder: 'border-indigo-500/40',
    accentBg: 'bg-indigo-500/10',
    accentText: 'text-indigo-400',
    toneDescription: 'Tactical, objective, and analytical. Surfaces high-leverage milestones and fee shields.',
    sampleHeadline: 'Strategic Signal: Goal is 82% funded and ready to finish',
    sampleBody: 'Directing your liquid surplus right now completes this goal ahead of schedule with zero fee drag.',
  },
  assertive: {
    level: 'assertive',
    numericRank: 4,
    archetype: 'Tactical Enforcer',
    avatarIcon: '⚔️',
    badgeLabel: 'Level 4: Capital Commander',
    shieldPercentage: 80,
    xpMultiplier: '2.0x XP',
    color: 'amber',
    accentBorder: 'border-amber-500/40',
    accentBg: 'bg-amber-500/10',
    accentText: 'text-amber-400',
    toneDescription: 'Disciplined coaching. Actively flags discretionary drift and presses to crush liabilities.',
    sampleHeadline: 'Discipline Alert: Spend pace running 18% above monthly targets',
    sampleBody: 'Pace correction recommended: redirect ₹3,500 of discretionary outflow to clear revolving card balance now.',
  },
  direct: {
    level: 'direct',
    numericRank: 5,
    archetype: 'Ruthless Wealth Commander',
    avatarIcon: '👑',
    badgeLabel: 'Level 5: Master of Capital',
    shieldPercentage: 100,
    xpMultiplier: '2.5x XP Boost',
    color: 'rose',
    accentBorder: 'border-rose-500/50',
    accentBg: 'bg-rose-500/15',
    accentText: 'text-rose-400',
    toneDescription: 'Unfiltered executive commands. Zero tolerance for unhedged fees, interest traps, or idle cash.',
    sampleHeadline: 'DIRECT COMMAND: Zero out revolving balance immediately',
    sampleBody: 'Avoidable interest charges detected. Liquidate idle surplus and eliminate this liability before making any discretionary purchases.',
  },
};

export type SubconsciousNudgeCategory =
  | 'goal_milestones'
  | 'aggressive_savings'
  | 'gentle_spending'
  | 'capital_retention';

export interface SubconsciousWhisperItem {
  id: string;
  category: SubconsciousNudgeCategory;
  tag: string;
  headline: string;
  body: string;
  metricLabel: string;
  metricValue: string;
  actionLabel: string;
  actionTarget: 'goals' | 'assets' | 'liabilities' | 'spend';
  tone: 'celebrate' | 'protect' | 'compound' | 'mindful';
}

export interface FrequencySpec {
  id: SubconsciousNudgeFrequency;
  label: string;
  cadenceSummary: string;
  description: string;
  maxWhispers: number;
  cooldownHours: number;
  rotationSeconds: number;
}

export const SUBCONSCIOUS_FREQUENCY_SPECS: Record<SubconsciousNudgeFrequency, FrequencySpec> = {
  paused: {
    id: 'paused',
    label: 'Paused',
    cadenceSummary: '0/day · Silent',
    description: 'Suppresses all subconscious nudges on Home until resumed.',
    maxWhispers: 0,
    cooldownHours: 0,
    rotationSeconds: 0,
  },
  minimal: {
    id: 'minimal',
    label: 'Quiet',
    cadenceSummary: '1 signal · 24h rest',
    description: 'Surfaces only the single highest-conviction signal with a 24-hour quiet window after dismissal.',
    maxWhispers: 1,
    cooldownHours: 24,
    rotationSeconds: 0,
  },
  balanced: {
    id: 'balanced',
    label: 'Balanced',
    cadenceSummary: 'Up to 3 · 6h rest',
    description: 'Curates up to 3 tailored signals with a 6-hour cooldown after dismissal and gentle 22s cadence.',
    maxWhispers: 3,
    cooldownHours: 6,
    rotationSeconds: 22,
  },
  frequent: {
    id: 'frequent',
    label: 'Attentive',
    cadenceSummary: 'All active · 1h rest',
    description: 'Surfaces every eligible portfolio signal in real time with a 12s ambient cadence and 1-hour snooze.',
    maxWhispers: 6,
    cooldownHours: 1,
    rotationSeconds: 12,
  },
};

export function resolveSubconsciousNudgePrefs(
  settings: Pick<AppSettings, 'subconsciousNudgePrefs'>
): SubconsciousNudgePreferences {
  return {
    ...DEFAULT_SUBCONSCIOUS_NUDGE_PREFS,
    ...(settings.subconsciousNudgePrefs || {}),
  };
}

export function getCooldownRemainingMinutes(
  prefs: SubconsciousNudgePreferences,
  nowMs: number = Date.now()
): number {
  if (!prefs.lastDismissedAt || prefs.frequency === 'paused') return 0;
  const spec = SUBCONSCIOUS_FREQUENCY_SPECS[prefs.frequency];
  if (!spec || spec.cooldownHours <= 0) return 0;

  const dismissedMs = new Date(prefs.lastDismissedAt).getTime();
  if (Number.isNaN(dismissedMs)) return 0;

  const unlockAtMs = dismissedMs + spec.cooldownHours * 60 * 60 * 1000;
  const remainingMs = unlockAtMs - nowMs;
  return remainingMs > 0 ? Math.ceil(remainingMs / 60000) : 0;
}

export interface BuildSubconsciousWhispersInput {
  prefs: SubconsciousNudgePreferences;
  goals: Goal[];
  holdings: Holding[];
  liabilities: Liability[];
  transactions: Transaction[];
  currencies: Currency[];
  settings: AppSettings;
  goalLiquidPlan?: GoalLiquidSurplusPlan;
  closedLoopMLState?: ClosedLoopMLState;
  cashFlowForecast?: CashFlowForecastResult;
  onlineLearnerState?: OnlineSpendIncomeModelState;
  rlRecommendations?: RLMovementRecommendation[];
  freeCashBase: number;
}

export function buildSubconsciousWhispers({
  prefs,
  goals,
  holdings,
  liabilities,
  transactions,
  currencies,
  settings,
  goalLiquidPlan,
  closedLoopMLState,
  cashFlowForecast,
  onlineLearnerState,
  rlRecommendations,
  freeCashBase,
}: BuildSubconsciousWhispersInput): SubconsciousWhisperItem[] {
  if (!prefs.enabled || prefs.frequency === 'paused') {
    return [];
  }

  const currMap: Record<string, Currency> = {};
  for (const c of currencies) currMap[c.code] = c;

  const baseCurr = settings.baseCurrency || 'INR';
  const baseSym = currMap[baseCurr]?.symbol || '₹';
  const fmt = (amt: number) =>
    formatMoney(amt, baseCurr, baseSym, settings.numberGrouping, 0);
  const fmtCompact = (amt: number) =>
    formatCompactMoney(amt, baseCurr, baseSym);

  const list: SubconsciousWhisperItem[] = [];
  const activeGoals = goals.filter((g) => !g.isCompleted);
  const completedGoals = goals.filter((g) => Boolean(g.isCompleted));
  const microWins = closedLoopMLState?.microWinsCount || 0;
  const retainedBase = Math.max(0, closedLoopMLState?.cumulativeSavedBase || 0);
  const safeSurplusBase = Math.max(0, goalLiquidPlan?.netLiquidSurplusBase || 0);
  const isCashFlowSafe = (cashFlowForecast?.minProjectedBalance ?? 0) >= 0;

  // 1. GOAL MILESTONE ALERTS
  if (prefs.goalMilestoneAlerts) {
    const enrichedGoals = activeGoals
      .map((g) => {
        const isDebt = g.goalType === 'debt_payoff';
        const matchedLiab =
          isDebt && g.targetLiabilityId
            ? liabilities.find((l) => l.id === g.targetLiabilityId)
            : undefined;
        const targetLocal = isDebt ? g.startingDebtAmount || g.cost : g.cost;
        let fundedLocal = g.accumulatedTotal || 0;

        for (const src of g.sources || []) {
          const h = holdings.find((x) => x.id === src.sourceId);
          if (h) {
            const val =
              h.units && h.currentPrice
                ? h.units * h.currentPrice
                : h.principalOrValue || 0;
            if (
              src.allocationMode === 'fixed_amount' &&
              src.allocationAmount !== undefined &&
              src.allocationAmount > 0
            ) {
              fundedLocal += Math.min(val, src.allocationAmount);
            } else if (src.allocationPct) {
              fundedLocal += val * ((src.allocationPct || 0) / 100);
            }
          }
        }

        if (isDebt && matchedLiab) {
          fundedLocal = Math.max(0, targetLocal - (matchedLiab.outstanding || 0));
        }

        const remainingLocal = Math.max(0, targetLocal - fundedLocal);
        const remainingBase = convertToBase(remainingLocal, g.currency, currMap);
        const pct =
          targetLocal > 0
            ? Math.min(100, Math.max(0, (fundedLocal / targetLocal) * 100))
            : 0;
        const gSym = currMap[g.currency]?.symbol || g.currency;

        return {
          goal: g,
          pct,
          remainingLocal,
          remainingBase,
          gSym,
          canCrushCleanly:
            remainingBase > 0 &&
            isCashFlowSafe &&
            safeSurplusBase >= remainingBase &&
            pct >= 35,
        };
      })
      .sort(
        (a, b) => Number(b.canCrushCleanly) - Number(a.canCrushCleanly) || b.pct - a.pct
      );

    const crushableGoal = enrichedGoals.find((x) => x.canCrushCleanly || x.pct >= 80);
    const primaryGoal = enrichedGoals[0];

    if (crushableGoal) {
      const remStr = formatMoney(
        crushableGoal.remainingLocal,
        crushableGoal.goal.currency,
        crushableGoal.gSym,
        settings.numberGrouping,
        0
      );
      list.push({
        id: `crush-${crushableGoal.goal.id}`,
        category: 'goal_milestones',
        tag: 'Goal Milestone Alert',
        headline: `"${crushableGoal.goal.name}" Is Quietly Ready to Be Crushed`,
        body:
          crushableGoal.remainingLocal <= 0
            ? `Every unit of capital is already in position (${crushableGoal.pct.toFixed(0)}%) while your 30-day reserve stays untouched. Claim this win guilt-free — wealth exists to serve a life well lived.`
            : `At ${crushableGoal.pct.toFixed(0)}% funded, only ${remStr} stands between intention and completion — and your protected surplus covers it without fee drag.`,
        metricLabel: 'Goal Completion',
        metricValue: `${crushableGoal.pct.toFixed(0)}%`,
        actionLabel: 'Finish Milestone',
        actionTarget: 'goals',
        tone: 'celebrate',
      });
    } else if (primaryGoal) {
      const assessment = goalLiquidPlan?.assessmentsByGoalId?.[primaryGoal.goal.id];
      const safeSliceBase = Math.min(
        primaryGoal.remainingBase,
        Math.max(0, Math.round(safeSurplusBase * 0.25))
      );
      list.push({
        id: `momentum-${primaryGoal.goal.id}`,
        category: 'goal_milestones',
        tag: 'Goal Milestone Alert',
        headline: `"${primaryGoal.goal.name}" Is Closer Than Your Calendar Suggests`,
        body:
          safeSliceBase > 100 && isCashFlowSafe
            ? `Your accounts hold ${fmtCompact(safeSurplusBase)} beyond upcoming bills and safety reserves. Moving ${fmt(safeSliceBase)} today advances "${primaryGoal.goal.name}" past ${Math.min(
                100,
                primaryGoal.pct +
                  (safeSliceBase /
                    Math.max(
                      1,
                      convertToBase(primaryGoal.goal.cost, primaryGoal.goal.currency, currMap)
                    )) *
                    100
              ).toFixed(0)}% without straining your month.`
            : assessment?.estimatedMonthsToComplete
            ? `Steady, zero-fee execution places "${primaryGoal.goal.name}" (${primaryGoal.pct.toFixed(0)}%) on pace inside ~${assessment.estimatedMonthsToComplete} mo while keeping daily cash flow effortless.`
            : `Every fee you refuse to pay quietly compounds toward "${primaryGoal.goal.name}" (${primaryGoal.pct.toFixed(0)}% funded). Small retained slices finish milestones faster than austerity ever does.`,
        metricLabel: 'Funded Ratio',
        metricValue: `${primaryGoal.pct.toFixed(0)}%`,
        actionLabel: 'Advance Goal',
        actionTarget: 'goals',
        tone: 'compound',
      });
    } else if (holdings.length > 0 || freeCashBase > 0) {
      list.push({
        id: 'seed-goal-milestone',
        category: 'goal_milestones',
        tag: 'Goal Milestone Alert',
        headline: 'Unassigned Surplus Drifts; Named Milestones Compound',
        body:
          freeCashBase > 0
            ? `Your ledger generates ${fmt(freeCashBase)}/mo in free cash flow. Naming one meaningful goal gives every saved fee and idle balance a destination worth celebrating.`
            : `Define one personal or asset milestone so every avoided charge and monthly surplus quietly works toward a concrete reward.`,
        metricLabel: 'Free Cash Flow',
        metricValue: `${fmtCompact(Math.max(0, freeCashBase))}/mo`,
        actionLabel: 'Define First Goal',
        actionTarget: 'goals',
        tone: 'compound',
      });
    }
  }

  // 2. AGGRESSIVE SAVINGS
  if (prefs.aggressiveSavings) {
    const pendingSweep = (rlRecommendations || []).find((r) => r.status === 'pending');
    if (pendingSweep && pendingSweep.suggestedAmount > 0) {
      list.push({
        id: `sweep-${pendingSweep.id}`,
        category: 'aggressive_savings',
        tag: 'Aggressive Savings',
        headline: `Deploy ${fmtCompact(pendingSweep.suggestedAmount)} Idle Cash Into ${pendingSweep.toAssetName}`,
        body: `Reallocating surplus from ${pendingSweep.fromSourceName} (${pendingSweep.fromYieldPct.toFixed(1)}%) to ${pendingSweep.toAssetName} (${pendingSweep.toYieldPct.toFixed(1)}%) unlocks +${fmt(pendingSweep.annualPotentialGain)}/yr while keeping your safety buffer intact.`,
        metricLabel: 'Annual Yield Lift',
        metricValue: `+${fmtCompact(pendingSweep.annualPotentialGain)}/yr`,
        actionLabel: 'Deploy Surplus',
        actionTarget: 'assets',
        tone: 'compound',
      });
    } else if (safeSurplusBase > 0 && isCashFlowSafe) {
      const targetDeploy = Math.round(safeSurplusBase * 0.4);
      list.push({
        id: 'surplus-compound',
        category: 'aggressive_savings',
        tag: 'Aggressive Savings',
        headline: `${fmtCompact(safeSurplusBase)} Sits Above Your 30-Day Safety Cushion`,
        body:
          targetDeploy > 0
            ? `Locking ${fmt(targetDeploy)} into a high-yield Sweep-In FD or core equity position captures compounding return today without sacrificing emergency liquidity.`
            : `Your emergency reserve and upcoming bills are covered. Directing even a small slice of idle cash into productive assets raises your net return rate immediately.`,
        metricLabel: 'Deployable Surplus',
        metricValue: fmtCompact(safeSurplusBase),
        actionLabel: 'Grow Assets',
        actionTarget: 'assets',
        tone: 'compound',
      });
    } else if (retainedBase > 0 || microWins > 0 || completedGoals.length > 0) {
      list.push({
        id: 'retained-wealth',
        category: 'aggressive_savings',
        tag: 'Aggressive Savings',
        headline:
          completedGoals.length > 0
            ? `${completedGoals.length} Milestone${completedGoals.length > 1 ? 's' : ''} Conquered · Capital Retained`
            : `Silent Margin Protected Across ${Math.max(1, microWins)} Decision${microWins === 1 ? '' : 's'}`,
        body:
          retainedBase > 0
            ? `You have quietly kept ${fmt(retainedBase)} out of avoidable fees, interest, and duplicate spends. Channel that recaptured capital straight into an earning asset.`
            : `Disciplined settlements are compounding your free monthly cash flow (${fmtCompact(Math.max(0, freeCashBase))}/mo) into lasting net worth.`,
        metricLabel: retainedBase > 0 ? 'Capital Retained' : 'Monthly Free Cash',
        metricValue:
          retainedBase > 0
            ? `+${fmtCompact(retainedBase)}`
            : fmtCompact(Math.max(0, freeCashBase)),
        actionLabel: 'Compound Capital',
        actionTarget: 'assets',
        tone: 'celebrate',
      });
    }
  }

  // 3. GENTLE SPENDING REMINDERS
  if (prefs.gentleSpendingReminders) {
    const now = new Date();
    const currentMonthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const monthSpends = transactions.filter(
      (tx) => !tx.isReversed && tx.kind === 'spend' && tx.date.startsWith(currentMonthPrefix)
    );

    const catTotals: Record<string, number> = {};
    let observedMonthBase = 0;
    for (const tx of monthSpends) {
      const valBase = tx.amount * (tx.fxRateUsed || currMap[tx.currency]?.rateToBase || 1);
      observedMonthBase += valBase;
      const cat = tx.category || 'General';
      catTotals[cat] = (catTotals[cat] || 0) + valBase;
    }

    const topCategoryEntry = Object.entries(catTotals).sort((a, b) => b[1] - a[1])[0];
    const baselineEma = onlineLearnerState?.monthlySpendBaselineEma || 0;
    const projectedFullMonth =
      onlineLearnerState?.halfPredictions?.projectedFullMonthSpendBase || observedMonthBase;

    if (baselineEma > 0 && projectedFullMonth > baselineEma * 1.06) {
      const driftAmt = Math.max(0, projectedFullMonth - baselineEma);
      const driftPct = Math.round(((projectedFullMonth - baselineEma) / baselineEma) * 100);
      list.push({
        id: `spend-pace-drift-${currentMonthPrefix}`,
        category: 'gentle_spending',
        tag: 'Gentle Spending Reminder',
        headline: topCategoryEntry
          ? `A Quiet Pause on ${topCategoryEntry[0]} Keeps ${fmtCompact(driftAmt)} in Your Corner`
          : `Current Month Pace Is Running ${driftPct}% Warmer Than Usual`,
        body: `Full-month spend is tracking near ${fmt(projectedFullMonth)} against your ${fmt(baselineEma)} baseline. Trimming just one or two discretionary outflows this week effortlessly restores that margin to your goals.`,
        metricLabel: 'Recoverable Margin',
        metricValue: `+${fmtCompact(driftAmt)}`,
        actionLabel: 'Review Spend Pace',
        actionTarget: 'spend',
        tone: 'mindful',
      });
    } else if (monthSpends.length > 0) {
      const cushionSaved =
        baselineEma > observedMonthBase ? baselineEma - observedMonthBase : 0;
      list.push({
        id: `spend-pace-calm-${currentMonthPrefix}`,
        category: 'gentle_spending',
        tag: 'Gentle Spending Reminder',
        headline:
          cushionSaved > 0
            ? `Measured Spending Has Preserved ${fmtCompact(cushionSaved)} Below Baseline`
            : `Intentional Outflows Logged Across ${monthSpends.length} Entries This Month`,
        body: topCategoryEntry
          ? `${topCategoryEntry[0]} leads this month at ${fmt(topCategoryEntry[1])}. Keeping everyday outlays deliberate protects your monthly surplus without feeling restrictive.`
          : `Your current month's spending rhythm (${fmt(observedMonthBase)} observed) remains calm and well within your cash flow runway.`,
        metricLabel: 'Month-to-Date Spend',
        metricValue: fmtCompact(observedMonthBase),
        actionLabel: 'Inspect Ledger',
        actionTarget: 'spend',
        tone: 'mindful',
      });
    }
  }

  // 4. CAPITAL RETENTION & FEE SHIELDS
  if (prefs.capitalRetentionGuards) {
    const revolvingCards = liabilities.filter(
      (l) =>
        l.kind === 'card' &&
        (l.cardType === 'credit' || l.cardType === 'hybrid' || !l.cardType) &&
        (l.outstanding || 0) > 0
    );
    if (revolvingCards.length > 0) {
      const topCard = [...revolvingCards].sort(
        (a, b) => (b.outstanding || 0) - (a.outstanding || 0)
      )[0];
      const cSym = currMap[topCard.currency]?.symbol || topCard.currency;
      const cashback = topCard.accumulatedCashback || 0;
      list.push({
        id: `card-shield-${topCard.id}`,
        category: 'capital_retention',
        tag: 'Capital Retention',
        headline: `Keep Issuer Fees Inside Your Own Net Worth`,
        body:
          cashback > 0
            ? `${topCard.name} holds +${formatMoney(cashback, topCard.currency, cSym, settings.numberGrouping, 0)} in unclaimed cashback. Settling the statement in full captures that reward and surrenders ${cSym}0 to EMI conversion fees.`
            : `Clearing ${topCard.name} (${formatMoney(topCard.outstanding || 0, topCard.currency, cSym, settings.numberGrouping, 0)}) in full when cash flow allows keeps 100% of processing fees and interest inside your own goals.`,
        metricLabel: cashback > 0 ? 'Cashback Ready' : 'Zero-Fee Window',
        metricValue:
          cashback > 0
            ? `+${formatCompactMoney(cashback, topCard.currency, cSym)}`
            : '0% APR',
        actionLabel: 'Review Card',
        actionTarget: 'liabilities',
        tone: 'protect',
      });
    }
  }

  const aggressiveness = prefs.guidanceAggressiveness || 'balanced';
  const modulatedList = list.map((item) => {
    if (aggressiveness === 'direct') {
      return {
        ...item,
        headline: item.headline.startsWith('DIRECT') ? item.headline : `COMMAND: ${item.headline}`,
      };
    }
    if (aggressiveness === 'assertive') {
      return {
        ...item,
        headline: item.headline.startsWith('ACTION') ? item.headline : `ACTION REQUIRED: ${item.headline}`,
      };
    }
    if (aggressiveness === 'gentle') {
      return {
        ...item,
        headline: item.headline.startsWith('Gentle') ? item.headline : `Gentle Note: ${item.headline}`,
      };
    }
    if (aggressiveness === 'subtle') {
      return {
        ...item,
        headline: item.headline.startsWith('Subtle') ? item.headline : `Subtle Note: ${item.headline}`,
      };
    }
    return item;
  });

  const maxWhispers = SUBCONSCIOUS_FREQUENCY_SPECS[prefs.frequency]?.maxWhispers ?? 3;
  return modulatedList.slice(0, maxWhispers);
}
