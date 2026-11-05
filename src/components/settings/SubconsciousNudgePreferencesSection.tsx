import React, { useMemo, useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import {
  GuidanceAggressiveness,
  SubconsciousNudgeFrequency,
  SubconsciousNudgePreferences,
} from '../../types';
import { DEFAULT_SUBCONSCIOUS_NUDGE_PREFS } from '../../lib/defaults';
import {
  AGGRESSIVENESS_ORDER,
  AGGRESSIVENESS_SPECS,
  AggressivenessSpec,
  SUBCONSCIOUS_FREQUENCY_SPECS,
  buildSubconsciousWhispers,
  getCooldownRemainingMinutes,
  resolveSubconsciousNudgePrefs,
} from '../../lib/subconsciousNudges';
import { formatDuplicateWindowLabel } from '../../lib/anomalyDetector';
import {
  Compass,
  TrendingUp,
  Feather,
  Target,
  ShieldCheck,
  RefreshCw,
  RotateCcw,
  Flame,
  Zap,
  Swords,
  Trophy,
  Sparkles,
  Clock,
  Shield,
  Volume2,
} from 'lucide-react';

const FREQUENCY_ORDER: SubconsciousNudgeFrequency[] = [
  'paused',
  'minimal',
  'balanced',
  'frequent',
];

const DUPLICATE_PRESETS = [
  { v: 5, l: '5 min' },
  { v: 15, l: '15 min' },
  { v: 30, l: '30 min' },
  { v: 60, l: '1 hr' },
  { v: 180, l: '3 hrs' },
  { v: 360, l: '6 hrs' },
  { v: 1440, l: '24 hrs' },
  { v: 2880, l: '48 hrs' },
];

export const SubconsciousNudgePreferencesSection: React.FC = () => {
  const {
    settings,
    updateSettings,
    goals,
    holdings,
    liabilities,
    transactions,
    currencies,
    goalLiquidPlan,
    closedLoopMLState,
    cashFlowForecast,
    onlineLearnerState,
    rlRecommendations,
    engineResult,
  } = useApp();

  const prefs = useMemo(
    () => resolveSubconsciousNudgePrefs(settings),
    [settings]
  );

  const [dupMinutesInput, setDupMinutesInput] = useState<string>(
    String(settings.duplicateDetectionWindowMinutes ?? 60)
  );
  const [dupSaveSuccess, setDupSaveSuccess] = useState(false);

  useEffect(() => {
    setDupMinutesInput(String(settings.duplicateDetectionWindowMinutes ?? 60));
  }, [settings.duplicateDetectionWindowMinutes]);

  const patchPrefs = async (partial: Partial<SubconsciousNudgePreferences>) => {
    const nextPrefs: SubconsciousNudgePreferences = {
      ...prefs,
      ...partial,
    };
    await updateSettings({ subconsciousNudgePrefs: nextPrefs });
  };

  const handleFrequencyChange = async (freq: SubconsciousNudgeFrequency) => {
    await patchPrefs({
      frequency: freq,
      enabled: freq !== 'paused',
    });
  };

  const handleMasterToggle = async () => {
    const nextEnabled = !prefs.enabled;
    await patchPrefs({
      enabled: nextEnabled,
      frequency:
        nextEnabled && prefs.frequency === 'paused' ? 'balanced' : prefs.frequency,
    });
  };

  const activeWhispers = useMemo(
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

  const cooldownRemainingMins = getCooldownRemainingMinutes(prefs);
  const activeSpec = SUBCONSCIOUS_FREQUENCY_SPECS[prefs.frequency];
  const isEffectivelyActive = prefs.enabled && prefs.frequency !== 'paused';

  const nudgeTypeRows: {
    key: keyof Pick<
      SubconsciousNudgePreferences,
      | 'aggressiveSavings'
      | 'gentleSpendingReminders'
      | 'goalMilestoneAlerts'
      | 'capitalRetentionGuards'
    >;
    title: string;
    subtitle: string;
    icon: React.ComponentType<{ size?: number; className?: string }>;
    accentClass: string;
  }[] = [
    {
      key: 'aggressiveSavings',
      title: 'Aggressive Savings',
      subtitle:
        'Surfaces idle bank cash above your 30-day safety cushion, high-yield sweep opportunities, and recaptured fee compounding.',
      icon: TrendingUp,
      accentClass: 'text-emerald-400',
    },
    {
      key: 'gentleSpendingReminders',
      title: 'Gentle Spending Reminders',
      subtitle:
        'Offers calm, non-judgmental pace checks when monthly outflows drift above your learned EMA baseline or affirm measured restraint.',
      icon: Feather,
      accentClass: 'text-amber-400',
    },
    {
      key: 'goalMilestoneAlerts',
      title: 'Goal Milestone Alerts',
      subtitle:
        'Highlights goals approaching completion and guilt-free milestones that your protected liquid surplus can finish cleanly.',
      icon: Target,
      accentClass: 'text-indigo-400',
    },
    {
      key: 'capitalRetentionGuards',
      title: 'Capital Retention & Fee Shields',
      subtitle:
        'Signals zero-fee credit card settlement windows and unclaimed cashback rewards before issuer conversion charges apply.',
      icon: ShieldCheck,
      accentClass: 'text-cyan-400',
    },
  ];

  const enabledCategoryCount = nudgeTypeRows.filter((r) => Boolean(prefs[r.key])).length;

  return (
    <div className="rounded-2xl bg-[#070b14] border border-slate-800/90 overflow-hidden">
      {/* Section Header & Master Switch */}
      <div className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800/80">
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-2">
            <Compass size={16} className="text-emerald-400 shrink-0" />
            <h3 className="text-sm font-semibold text-white tracking-tight">
              Subconscious Nudge Preferences
            </h3>
          </div>
          <p className="text-xs text-slate-400 leading-relaxed max-w-xl">
            Curate which subtle financial whispers appear on your Home screen and how frequently they surface.
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0 self-start sm:self-center">
          <button
            type="button"
            onClick={() => updateSettings({ subconsciousNudgePrefs: DEFAULT_SUBCONSCIOUS_NUDGE_PREFS })}
            className="px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs font-medium text-slate-300 hover:text-white flex items-center gap-1.5 cursor-pointer transition-colors whitespace-nowrap"
          >
            <RefreshCw size={13} />
            <span>Reset</span>
          </button>

          <button
            type="button"
            role="switch"
            aria-checked={isEffectivelyActive}
            aria-label="Enable Subconscious Nudges"
            onClick={handleMasterToggle}
            className={`px-3.5 py-2 rounded-xl border text-xs font-semibold flex items-center gap-2 cursor-pointer transition-colors whitespace-nowrap ${
              isEffectivelyActive
                ? 'bg-emerald-950/60 border-emerald-500/50 text-emerald-200'
                : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                isEffectivelyActive ? 'bg-emerald-400' : 'bg-slate-600'
              }`}
            />
            <span>{isEffectivelyActive ? 'Guidance Enabled' : 'Guidance Muted'}</span>
          </button>
        </div>
      </div>

      {/* Frequency Selector */}
      <div className="p-5 space-y-3 border-b border-slate-800/80">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h4 className="text-xs font-semibold text-slate-200">
              Notification Cadence &amp; Quiet Window
            </h4>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Controls maximum concurrent whispers, ambient rotation timing, and rest duration after dismissing a nudge.
            </p>
          </div>
          <div className="text-[11px] text-slate-400 font-mono tabular-nums">
            <span>{activeSpec.label}</span>
            <span aria-hidden="true" className="mx-1.5 text-slate-600">·</span>
            <span className="text-emerald-400">{activeSpec.cadenceSummary}</span>
          </div>
        </div>

        <div
          role="radiogroup"
          aria-label="Subconscious Nudge Frequency"
          className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-1 rounded-xl bg-slate-950 border border-slate-800/90"
        >
          {FREQUENCY_ORDER.map((freqId) => {
            const spec = SUBCONSCIOUS_FREQUENCY_SPECS[freqId];
            const isSelected =
              (!prefs.enabled && freqId === 'paused') ||
              (prefs.enabled && prefs.frequency === freqId);

            return (
              <button
                key={freqId}
                type="button"
                role="radio"
                aria-checked={isSelected}
                onClick={() => handleFrequencyChange(freqId)}
                className={`px-3 py-2.5 rounded-lg text-left transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${
                  isSelected
                    ? 'bg-slate-800/95 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/50'
                }`}
              >
                <div className="text-xs font-semibold whitespace-nowrap">{spec.label}</div>
                <div className="text-[11px] font-mono tabular-nums text-slate-400 mt-0.5 whitespace-nowrap">
                  {spec.cadenceSummary}
                </div>
              </button>
            );
          })}
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1 text-xs">
          <p className="text-[11px] text-slate-400 leading-relaxed">
            {activeSpec.description}
          </p>

          {isEffectivelyActive && activeSpec.rotationSeconds > 0 && (
            <button
              type="button"
              role="switch"
              aria-checked={prefs.autoCycleWhispers}
              onClick={() => patchPrefs({ autoCycleWhispers: !prefs.autoCycleWhispers })}
              className="flex items-center gap-2.5 text-left sm:text-right shrink-0 py-1 cursor-pointer group focus-visible:outline-none"
            >
              <span className="text-[11px] text-slate-300 group-hover:text-white whitespace-nowrap">
                Ambient auto-cycle ({activeSpec.rotationSeconds}s)
              </span>
              <span
                className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                  prefs.autoCycleWhispers ? 'bg-emerald-600' : 'bg-slate-800'
                }`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                    prefs.autoCycleWhispers ? 'translate-x-4.5' : 'translate-x-1'
                  }`}
                />
              </span>
            </button>
          )}
        </div>

        {cooldownRemainingMins > 0 && isEffectivelyActive && (
          <div className="pt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-300 border-t border-slate-800/70">
            <span className="font-mono tabular-nums text-[11px] text-slate-400">
              Quiet rest window active · resumes in{' '}
              {cooldownRemainingMins >= 60
                ? `${Math.floor(cooldownRemainingMins / 60)}h ${cooldownRemainingMins % 60}m`
                : `${cooldownRemainingMins}m`}
            </span>
            <button
              type="button"
              onClick={() => patchPrefs({ lastDismissedAt: undefined })}
              className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs font-medium text-emerald-300 flex items-center gap-1.5 cursor-pointer transition-colors whitespace-nowrap"
            >
              <RotateCcw size={12} />
              <span>Resume Signals Now</span>
            </button>
          </div>
        )}
      </div>

      {/* Gamified AI Guidance Aggressiveness Slider */}
      {(() => {
        const currentAggressiveness: GuidanceAggressiveness =
          prefs.guidanceAggressiveness || 'balanced';
        const activeAggSpec = AGGRESSIVENESS_SPECS[currentAggressiveness];
        const currentAggIndex = AGGRESSIVENESS_ORDER.indexOf(currentAggressiveness);
        const sliderValue = (currentAggIndex >= 0 ? currentAggIndex : 2) + 1;

        return (
          <div className="p-5 space-y-4 border-b border-slate-800/80 bg-gradient-to-b from-slate-950/40 to-slate-900/30">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <Flame size={16} className="text-amber-400 shrink-0" />
                  <h4 className="text-xs font-semibold text-slate-200">
                    AI Guidance Aggressiveness &amp; Gamified Discipline
                  </h4>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${activeAggSpec.accentBorder} ${activeAggSpec.accentBg} ${activeAggSpec.accentText}`}>
                    {activeAggSpec.badgeLabel}
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 mt-1 max-w-xl">
                  Adjust how boldly the AI intervenes on spending drift, debt elimination, and surplus acceleration — from quiet Zen observations to ruthless executive commands.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-[11px] font-mono px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 flex items-center gap-1 font-semibold">
                  <Trophy size={12} className="text-amber-400" />
                  <span>{activeAggSpec.xpMultiplier}</span>
                </span>
                <span className="text-[11px] font-mono px-2.5 py-1 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 flex items-center gap-1 font-semibold">
                  <Shield size={12} className="text-cyan-400" />
                  <span>{activeAggSpec.shieldPercentage}% Shield</span>
                </span>
              </div>
            </div>

            {/* Interactive Slider */}
            <div className="space-y-3 pt-1">
              <div className="relative px-2">
                <input
                  type="range"
                  min="1"
                  max="5"
                  step="1"
                  value={sliderValue}
                  aria-label="Guidance Aggressiveness Slider"
                  onChange={(e) => {
                    const idx = Number(e.target.value) - 1;
                    const nextLevel = AGGRESSIVENESS_ORDER[idx] || 'balanced';
                    patchPrefs({ guidanceAggressiveness: nextLevel });
                  }}
                  className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/40"
                />
                {/* 5 Step Indicator Nodes */}
                <div className="flex justify-between text-[11px] font-semibold text-slate-400 pt-1.5 px-0.5">
                  {AGGRESSIVENESS_ORDER.map((level, idx) => {
                    const spec = AGGRESSIVENESS_SPECS[level];
                    const isSelected = level === currentAggressiveness;
                    return (
                      <button
                        key={level}
                        type="button"
                        onClick={() => patchPrefs({ guidanceAggressiveness: level })}
                        className={`text-left cursor-pointer transition-colors flex flex-col items-center ${
                          isSelected ? `${spec.accentText} font-bold scale-105` : 'text-slate-500 hover:text-slate-300'
                        }`}
                      >
                        <span className="text-xs">{spec.avatarIcon}</span>
                        <span className="text-[10px] capitalize tracking-tight mt-0.5">{level}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Archetype Quick-Select Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-2">
                {AGGRESSIVENESS_ORDER.map((level) => {
                  const spec = AGGRESSIVENESS_SPECS[level];
                  const isSelected = level === currentAggressiveness;
                  return (
                    <button
                      key={level}
                      type="button"
                      onClick={() => patchPrefs({ guidanceAggressiveness: level })}
                      className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer relative overflow-hidden ${
                        isSelected
                          ? `${spec.accentBorder} ${spec.accentBg} shadow-md`
                          : 'bg-slate-950/70 border-slate-800/80 hover:border-slate-700 text-slate-400'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1 mb-1">
                        <span className="text-base">{spec.avatarIcon}</span>
                        <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded ${
                          isSelected ? 'bg-slate-900/90 text-white' : 'bg-slate-900 text-slate-500'
                        }`}>
                          LVL {spec.numericRank}
                        </span>
                      </div>
                      <div className={`text-xs font-bold leading-tight ${isSelected ? 'text-white' : 'text-slate-300'}`}>
                        {spec.archetype}
                      </div>
                      <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 mt-1">
                        <span>{spec.xpMultiplier}</span>
                        <span className="text-[9px] text-slate-500">{spec.shieldPercentage}% Shld</span>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Live AI Voice Simulation & Archetype Bio */}
              <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800/90 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Volume2 size={13} className="text-indigo-400 shrink-0" />
                    <span className="text-xs font-semibold text-slate-300">
                      Live AI Whisper Voice Simulation · {activeAggSpec.archetype}
                    </span>
                  </div>
                  <span className="text-[10px] font-mono text-slate-500">
                    Discipline Strategy Matrix
                  </span>
                </div>

                <div className="p-2.5 rounded-lg bg-slate-900/90 border border-slate-800 text-xs space-y-1">
                  <div className="font-semibold text-white flex items-center gap-1.5">
                    <Sparkles size={12} className={activeAggSpec.accentText} />
                    <span>{activeAggSpec.sampleHeadline}</span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed italic">
                    "{activeAggSpec.sampleBody}"
                  </p>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400 pt-0.5">
                  <span className="italic">{activeAggSpec.toneDescription}</span>
                  <div className="flex items-center gap-2 font-mono text-[10px]">
                    <span className="text-slate-500">Willpower Shield:</span>
                    <div className="w-16 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-cyan-400 rounded-full transition-all duration-300"
                        style={{ width: `${activeAggSpec.shieldPercentage}%` }}
                      />
                    </div>
                    <span className="text-cyan-400 font-bold">{activeAggSpec.shieldPercentage}%</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Nudge Type Toggles */}
      <div className="divide-y divide-slate-800/80">
        {nudgeTypeRows.map((row) => {
          const Icon = row.icon;
          const isChecked = Boolean(prefs[row.key]);
          return (
            <div
              key={row.key}
              className={`p-5 flex items-start sm:items-center justify-between gap-4 transition-opacity ${
                isEffectivelyActive ? 'opacity-100' : 'opacity-50'
              }`}
            >
              <div className="flex items-start gap-3 min-w-0">
                <div className="mt-0.5 shrink-0">
                  <Icon size={16} className={isChecked ? row.accentClass : 'text-slate-500'} />
                </div>
                <div className="space-y-0.5 min-w-0">
                  <div className="text-xs font-semibold text-slate-100">{row.title}</div>
                  <p className="text-[11px] text-slate-400 leading-relaxed max-w-2xl">
                    {row.subtitle}
                  </p>
                </div>
              </div>

              <button
                type="button"
                role="switch"
                aria-checked={isChecked}
                aria-label={`Toggle ${row.title}`}
                disabled={!isEffectivelyActive}
                onClick={() => patchPrefs({ [row.key]: !isChecked })}
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${
                  !isEffectivelyActive
                    ? 'bg-slate-800 cursor-not-allowed'
                    : isChecked
                    ? 'bg-emerald-600 cursor-pointer'
                    : 'bg-slate-800 hover:bg-slate-700 cursor-pointer'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    isChecked ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
          );
        })}
      </div>

      {/* Duplicate Window Configuration Card (Configured inside Settings section; removed from main pages) */}
      <div className="p-5 border-t border-slate-800/80 bg-slate-950/60 space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <Clock size={15} className="text-cyan-400 shrink-0" />
              <h4 className="text-xs font-semibold text-slate-200">
                Duplicate Window (same source, amount, chip &amp; category):
              </h4>
              <span className="text-[11px] font-mono text-cyan-300 font-semibold">
                ({formatDuplicateWindowLabel(settings.duplicateDetectionWindowMinutes ?? 60)})
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-1 max-w-xl">
              Configured strictly here in Settings. Predicted as duplicate when <strong>same source, same amount, same chip, and same category</strong> occur within this window.
            </p>
          </div>

          <button
            type="button"
            onClick={() =>
              updateSettings({
                enforceDuplicateGuard: !Boolean(settings.enforceDuplicateGuard),
              })
            }
            className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors whitespace-nowrap ${
              settings.enforceDuplicateGuard
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                : 'bg-slate-900 text-slate-400 border border-slate-800 hover:text-slate-200'
            }`}
          >
            <ShieldCheck size={13} />
            <span>
              {settings.enforceDuplicateGuard ? 'Guard Enforced' : 'Guard Advisory'}
            </span>
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] text-slate-500 uppercase tracking-wider mr-1">Presets:</span>
            {DUPLICATE_PRESETS.map((p) => {
              const currentMin = settings.duplicateDetectionWindowMinutes ?? 60;
              const isSelected = currentMin === p.v;
              return (
                <button
                  key={p.v}
                  type="button"
                  onClick={() => {
                    updateSettings({ duplicateDetectionWindowMinutes: p.v });
                    setDupMinutesInput(String(p.v));
                  }}
                  className={`px-2.5 py-1 rounded-lg text-xs font-mono font-medium transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-cyan-600 text-white font-bold'
                      : 'bg-slate-900 text-slate-400 hover:bg-slate-800 hover:text-slate-200 border border-slate-800'
                  }`}
                >
                  {p.l}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-1.5">
            <input
              type="number"
              min="1"
              max="43200"
              value={dupMinutesInput}
              onChange={(e) => setDupMinutesInput(e.target.value)}
              className="w-20 bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-white font-mono tabular-nums text-center focus:border-cyan-500/50 focus:outline-none"
            />
            <span className="text-[11px] text-slate-400 font-mono">min</span>
            <button
              type="button"
              onClick={async () => {
                const parsed = parseInt(dupMinutesInput, 10);
                if (!isNaN(parsed) && parsed > 0) {
                  await updateSettings({ duplicateDetectionWindowMinutes: parsed });
                  setDupSaveSuccess(true);
                  setTimeout(() => setDupSaveSuccess(false), 2000);
                }
              }}
              className="px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold cursor-pointer whitespace-nowrap"
            >
              Apply
            </button>
            {dupSaveSuccess && (
              <span className="text-xs text-emerald-400 font-medium">Applied!</span>
            )}
          </div>
        </div>
      </div>

      {/* Live Signal Readiness Footer */}
      <div className="px-5 py-3.5 bg-slate-950/80 border-t border-slate-800/90 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
        <div className="flex flex-wrap items-center gap-1.5 font-mono tabular-nums">
          <span className="font-sans text-slate-300 font-medium">Live Home Stream</span>
          <span aria-hidden="true" className="text-slate-600">·</span>
          <span>
            {enabledCategoryCount}/4 channels enabled
          </span>
          <span aria-hidden="true" className="text-slate-600">·</span>
          <span className={activeWhispers.length > 0 ? 'text-emerald-400' : 'text-slate-500'}>
            {isEffectivelyActive
              ? `${activeWhispers.length} active signal${activeWhispers.length === 1 ? '' : 's'} queued`
              : 'Stream paused'}
          </span>
        </div>

        {isEffectivelyActive && activeWhispers[0] && (
          <div className="text-slate-400 truncate max-w-xs sm:max-w-sm">
            Next up: <span className="text-slate-200">{activeWhispers[0].tag}</span>
          </div>
        )}
      </div>
    </div>
  );
};
