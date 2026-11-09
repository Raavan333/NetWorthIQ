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
  TrendingUp,
  Zap,
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

  // Psychological archetype and color accents tailored to tone
  const toneConfig = {
    celebrate: {
      accentBorder: 'border-emerald-500/40 hover:border-emerald-500/60',
      glowGradient: 'from-emerald-500/15 via-emerald-950/20 to-transparent',
      topBar: 'bg-gradient-to-r from-emerald-500/80 via-teal-400/80 to-transparent',
      badgeText: 'text-emerald-400',
      badgeBg: 'bg-emerald-500/10',
      pulseColor: 'bg-emerald-400',
      psychologicalAnchor: 'VICTORY MOMENTUM · DOPAMINE ANCHOR',
      icon: Sparkles,
      buttonBg: 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-950/50',
    },
    protect: {
      accentBorder: 'border-cyan-500/40 hover:border-cyan-500/60',
      glowGradient: 'from-cyan-500/15 via-cyan-950/20 to-transparent',
      topBar: 'bg-gradient-to-r from-cyan-500/80 via-blue-400/80 to-transparent',
      badgeText: 'text-cyan-400',
      badgeBg: 'bg-cyan-500/10',
      pulseColor: 'bg-cyan-400',
      psychologicalAnchor: 'WEALTH DEFENSE · LOSS AVERSION SHIELD',
      icon: ShieldCheck,
      buttonBg: 'bg-cyan-600 hover:bg-cyan-500 text-white shadow-cyan-950/50',
    },
    mindful: {
      accentBorder: 'border-amber-500/40 hover:border-amber-500/60',
      glowGradient: 'from-amber-500/15 via-amber-950/20 to-transparent',
      topBar: 'bg-gradient-to-r from-amber-500/80 via-orange-400/80 to-transparent',
      badgeText: 'text-amber-400',
      badgeBg: 'bg-amber-500/10',
      pulseColor: 'bg-amber-400',
      psychologicalAnchor: 'MINDFUL EQUILIBRIUM · HABIT COMPOUNDING',
      icon: Zap,
      buttonBg: 'bg-amber-600 hover:bg-amber-500 text-slate-950 font-bold shadow-amber-950/50',
    },
    compound: {
      accentBorder: 'border-indigo-500/40 hover:border-indigo-500/60',
      glowGradient: 'from-indigo-500/15 via-purple-950/20 to-transparent',
      topBar: 'bg-gradient-to-r from-indigo-500/80 via-purple-400/80 to-transparent',
      badgeText: 'text-indigo-400',
      badgeBg: 'bg-indigo-500/10',
      pulseColor: 'bg-indigo-400',
      psychologicalAnchor: 'FREEDOM VELOCITY · COMPOUND GRAVITY',
      icon: TrendingUp,
      buttonBg: 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-950/50',
    },
  }[current.tone || 'compound'];

  const ToneIcon = toneConfig.icon;

  return (
    <section
      aria-label="Subconscious Financial Guidance"
      onMouseEnter={() => setIsPausedByHover(true)}
      onMouseLeave={() => setIsPausedByHover(false)}
      onFocus={() => setIsPausedByHover(true)}
      onBlur={() => setIsPausedByHover(false)}
      className={`relative overflow-hidden rounded-2xl bg-gradient-to-b from-slate-900/95 to-slate-950/95 border ${toneConfig.accentBorder} p-4 sm:p-5 shadow-[0_16px_40px_-16px_rgba(0,0,0,0.65)] backdrop-blur-md transition-all duration-300`}
    >
      {/* Top ambient illumination hairline */}
      <div className={`absolute top-0 left-0 right-0 h-[2px] ${toneConfig.topBar}`} />

      {/* Atmospheric radial sheen */}
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${toneConfig.glowGradient} opacity-60`}
      />

      <div className="relative flex flex-col md:flex-row md:items-center justify-between gap-4">
        {/* Main Content Area */}
        <div className="space-y-2 min-w-0 flex-1">
          {/* Subconscious Psychological Anchor Header */}
          <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-wider font-semibold text-slate-400">
            <span className="flex items-center gap-1.5 font-bold tracking-widest text-slate-300">
              <span className={`w-2 h-2 rounded-full ${toneConfig.pulseColor} animate-pulse`} />
              <span>{toneConfig.psychologicalAnchor}</span>
            </span>
            <span aria-hidden="true" className="text-slate-600">·</span>
            <span className={`font-mono ${toneConfig.badgeText}`}>{current.tag}</span>
            {isPausedByHover && (
              <>
                <span aria-hidden="true" className="text-slate-600">·</span>
                <span className="text-slate-400 text-[9px] font-mono">Paused</span>
              </>
            )}
          </div>

          {/* Inspiring Headline */}
          <h3 className="text-sm sm:text-base font-bold text-white tracking-tight leading-snug flex items-center gap-2">
            <ToneIcon size={16} className={`${toneConfig.badgeText} shrink-0`} />
            <span className="break-words">{current.headline}</span>
          </h3>

          {/* Persuasive Behavioral Psychological Body */}
          <p className="text-xs sm:text-[13px] text-slate-300 leading-relaxed max-w-3xl font-normal">
            {current.body}
          </p>
        </div>

        {/* Right Metric & Interactive Actions Area */}
        <div className="flex flex-col sm:flex-row md:flex-col items-start sm:items-center md:items-end justify-between gap-3 shrink-0 pt-3 md:pt-0 border-t md:border-t-0 border-slate-800/80">
          {/* Key Metric Display Tile */}
          <div className="p-2.5 sm:px-3 sm:py-2 rounded-xl bg-slate-950/80 border border-slate-800/80 text-left sm:text-right w-full sm:w-auto md:w-full">
            <span className="block text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
              {current.metricLabel}
            </span>
            <div className={`text-lg sm:text-xl font-black font-mono tabular-nums ${toneConfig.badgeText}`}>
              {current.metricValue}
            </div>
          </div>

          {/* Carousel Stepper & Action Controls */}
          <div className="flex items-center justify-between sm:justify-end gap-2 w-full sm:w-auto">
            {/* Step Indicators */}
            {whispers.length > 1 && (
              <div className="flex items-center gap-1 mr-1">
                <button
                  type="button"
                  onClick={() =>
                    setActiveIndex((prev) => (prev - 1 + whispers.length) % whispers.length)
                  }
                  aria-label="Previous guidance whisper"
                  className="w-7 h-7 rounded-lg bg-slate-950 border border-slate-800 hover:border-slate-700 text-slate-400 hover:text-slate-200 flex items-center justify-center cursor-pointer transition-colors"
                >
                  <ChevronLeft size={13} />
                </button>
                <div className="flex items-center gap-1 px-1">
                  {whispers.map((_, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setActiveIndex(i)}
                      aria-label={`Go to nudge ${i + 1}`}
                      className={`h-1.5 rounded-full transition-all cursor-pointer ${
                        safeIdx === i
                          ? `w-4 ${toneConfig.pulseColor}`
                          : 'w-1.5 bg-slate-700 hover:bg-slate-600'
                      }`}
                    />
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setActiveIndex((prev) => (prev + 1) % whispers.length)}
                  aria-label="Next guidance whisper"
                  className="w-7 h-7 rounded-lg bg-slate-950 border border-slate-800 hover:border-slate-700 text-slate-400 hover:text-slate-200 flex items-center justify-center cursor-pointer transition-colors"
                >
                  <ChevronRight size={13} />
                </button>
              </div>
            )}

            {/* Motivational Action CTA */}
            <button
              type="button"
              onClick={handleAction}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-all shadow-md active:scale-95 whitespace-nowrap ${toneConfig.buttonBg}`}
            >
              <span>{current.actionLabel}</span>
              <ArrowUpRight size={14} className="shrink-0" />
            </button>

            {/* Preference & Dismiss controls */}
            <div className="flex items-center gap-1 ml-1">
              <button
                type="button"
                onClick={() => setActiveModal('settings:nudges')}
                aria-label="Configure Subconscious Nudge Preferences"
                title="Subconscious Nudge Preferences"
                className="w-7 h-7 rounded-lg bg-slate-950 border border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700 flex items-center justify-center cursor-pointer transition-colors"
              >
                <SlidersHorizontal size={12} />
              </button>
              <button
                type="button"
                onClick={handleDismiss}
                aria-label="Rest nudges for configured quiet window"
                title={`Quiet window for ${SUBCONSCIOUS_FREQUENCY_SPECS[prefs.frequency]?.cooldownHours || 4}h`}
                className="w-7 h-7 rounded-lg bg-slate-950 border border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700 flex items-center justify-center cursor-pointer transition-colors"
              >
                <X size={12} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
