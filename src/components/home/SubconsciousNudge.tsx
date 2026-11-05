import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import {
  SUBCONSCIOUS_FREQUENCY_SPECS,
  buildSubconsciousWhispers,
  getCooldownRemainingMinutes,
  resolveSubconsciousNudgePrefs,
} from '../../lib/subconsciousNudges';
import {
  Compass,
  Sparkles,
  ArrowUpRight,
  ChevronRight,
  ChevronLeft,
  CheckCircle2,
  ShieldCheck,
  Feather,
  SlidersHorizontal,
  X,
} from 'lucide-react';

export const SubconsciousNudge: React.FC = () => {
  const {
    goals,
    holdings,
    liabilities,
    transactions,
    currencies,
    settings,
    updateSettings,
    goalLiquidPlan,
    closedLoopMLState,
    cashFlowForecast,
    onlineLearnerState,
    rlRecommendations,
    engineResult,
    setActiveModal,
    setActiveTab,
  } = useApp();

  const [activeIndex, setActiveIndex] = useState(0);
  const [isPausedByHover, setIsPausedByHover] = useState(false);

  const prefs = useMemo(
    () => resolveSubconsciousNudgePrefs(settings),
    [settings]
  );

  const cooldownRemainingMins = getCooldownRemainingMinutes(prefs);

  const whispers = useMemo(
    () =>
      buildSubconsciousWhispers({
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
        freeCashBase: engineResult.freeCashBase,
      }),
    [
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
      engineResult.freeCashBase,
    ]
  );

  const rotationSeconds =
    SUBCONSCIOUS_FREQUENCY_SPECS[prefs.frequency]?.rotationSeconds || 0;

  useEffect(() => {
    if (
      !prefs.enabled ||
      prefs.frequency === 'paused' ||
      !prefs.autoCycleWhispers ||
      settings.reduceMotion ||
      isPausedByHover ||
      whispers.length <= 1 ||
      rotationSeconds <= 0
    ) {
      return;
    }

    const timer = window.setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % whispers.length);
    }, rotationSeconds * 1000);

    return () => window.clearInterval(timer);
  }, [
    prefs.enabled,
    prefs.frequency,
    prefs.autoCycleWhispers,
    settings.reduceMotion,
    isPausedByHover,
    whispers.length,
    rotationSeconds,
  ]);

  if (
    !prefs.enabled ||
    prefs.frequency === 'paused' ||
    cooldownRemainingMins > 0 ||
    whispers.length === 0 ||
    (holdings.length === 0 &&
      liabilities.length === 0 &&
      goals.length === 0 &&
      transactions.length === 0)
  ) {
    return null;
  }

  const safeIdx = activeIndex % whispers.length;
  const current = whispers[safeIdx];

  const handleAction = () => {
    if (current.actionTarget === 'goals') {
      setActiveModal('goals');
    } else {
      setActiveTab(current.actionTarget);
    }
  };

  const handleDismiss = async () => {
    await updateSettings({
      subconsciousNudgePrefs: {
        ...prefs,
        lastDismissedAt: new Date().toISOString(),
      },
    });
  };

  return (
    <section
      aria-label="Subconscious Financial Guidance"
      onMouseEnter={() => setIsPausedByHover(true)}
      onMouseLeave={() => setIsPausedByHover(false)}
      onFocus={() => setIsPausedByHover(true)}
      onBlur={() => setIsPausedByHover(false)}
      className="relative overflow-hidden rounded-2xl bg-[#070b14] border border-slate-800/90 p-4 shadow-[0_12px_36px_-16px_rgba(16,185,129,0.22)] transition-all"
    >
      {/* Subtle atmospheric radial sheen */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(16,185,129,0.09),rgba(99,102,241,0.04)_45%,transparent_72%)]"
      />

      <div className="relative flex flex-col sm:flex-row sm:items-center justify-between gap-3.5">
        <div className="space-y-1.5 min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.16em] text-slate-400 font-semibold">
            {current.tone === 'celebrate' ? (
              <CheckCircle2 size={12} className="text-emerald-400 shrink-0" />
            ) : current.tone === 'protect' ? (
              <ShieldCheck size={12} className="text-cyan-400 shrink-0" />
            ) : current.tone === 'mindful' ? (
              <Feather size={12} className="text-amber-400 shrink-0" />
            ) : (
              <Compass size={12} className="text-indigo-400 shrink-0" />
            )}
            <span>Subconscious Nudge</span>
            <span aria-hidden="true" className="text-slate-600">·</span>
            <span className="text-emerald-400/90">{current.tag}</span>
          </div>

          <h3 className="text-sm font-semibold text-slate-100 tracking-tight leading-snug">
            {current.headline}
          </h3>

          <p className="text-xs text-slate-400 leading-relaxed max-w-3xl">
            {current.body}
          </p>
        </div>

        <div className="flex sm:flex-col items-center sm:items-end justify-between gap-2.5 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-800/80">
          <div className="flex items-center gap-2 sm:justify-end w-full sm:w-auto justify-between">
            <div className="sm:text-right">
              <span className="block text-[10px] uppercase tracking-wider text-slate-500">
                {current.metricLabel}
              </span>
              <span className="text-base font-bold font-mono tabular-nums text-emerald-400">
                {current.metricValue}
              </span>
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setActiveModal('settings:nudges')}
                aria-label="Configure Subconscious Nudge Preferences"
                title="Subconscious Nudge Preferences"
                className="w-7 h-7 rounded-lg bg-slate-900/80 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-slate-200 flex items-center justify-center cursor-pointer transition-colors"
              >
                <SlidersHorizontal size={12} />
              </button>
              <button
                type="button"
                onClick={handleDismiss}
                aria-label="Rest nudges for configured quiet window"
                title={`Rest for ${SUBCONSCIOUS_FREQUENCY_SPECS[prefs.frequency].cooldownHours}h`}
                className="w-7 h-7 rounded-lg bg-slate-900/80 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-slate-200 flex items-center justify-center cursor-pointer transition-colors"
              >
                <X size={12} />
              </button>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {whispers.length > 1 && (
              <div className="flex items-center gap-0.5 mr-1">
                <button
                  type="button"
                  onClick={() =>
                    setActiveIndex((prev) => (prev - 1 + whispers.length) % whispers.length)
                  }
                  aria-label="Previous guidance insight"
                  className="w-6 h-6 rounded-lg bg-slate-900/90 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-slate-200 flex items-center justify-center cursor-pointer transition-colors"
                >
                  <ChevronLeft size={12} />
                </button>
                <span className="text-[10px] font-mono tabular-nums text-slate-500 px-1">
                  {safeIdx + 1}/{whispers.length}
                </span>
                <button
                  type="button"
                  onClick={() => setActiveIndex((prev) => (prev + 1) % whispers.length)}
                  aria-label="Next guidance insight"
                  className="w-6 h-6 rounded-lg bg-slate-900/90 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-slate-200 flex items-center justify-center cursor-pointer transition-colors"
                >
                  <ChevronRight size={12} />
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={handleAction}
              className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-emerald-950/60 border border-slate-700/90 hover:border-emerald-500/50 text-slate-100 hover:text-emerald-200 text-xs font-semibold flex items-center gap-1 cursor-pointer transition-all whitespace-nowrap"
            >
              <Sparkles size={12} className="text-emerald-400 shrink-0" />
              <span>{current.actionLabel}</span>
              <ArrowUpRight size={12} className="text-slate-400 shrink-0" />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
};
