import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { InsightCardData, InsightType } from '../../types';
import { formatMoney, formatCompactMoney } from '../../lib/formatters';
import { MLInvestmentAllocationEngine } from './MLInvestmentAllocationEngine';
import { HistoricalNetWorthChart } from './HistoricalNetWorthChart';
import { ENGAGEMENT_STRATEGY_LABELS } from '../../lib/mlEngine';
import {
  Lightbulb,
  AlertTriangle,
  TrendingUp,
  CheckCircle2,
  Calendar,
  X,
  Clock,
  ArrowRight,
  ShieldCheck,
  Sparkles,
  Brain,
  Zap,
  Check,
  Bell,
  GraduationCap,
} from 'lucide-react';

export const InsightsView: React.FC = () => {
  const {
    insights,
    dismissInsight,
    snoozeInsight,
    setActiveTab,
    setActiveModal,
    rlRecommendations,
    executeRLRecommendation,
    dismissRLRecommendation,
    closedLoopMLState,
    brokerUsageForecast,
    currencies,
    settings,
    careerPrediction,
  } = useApp();

  const [period, setPeriod] = useState<'month' | '3m' | '6m' | '12m' | 'ytd'>('month');
  const [comparison, setComparison] = useState<'prev' | 'last_year'>('prev');
  const [filterType, setFilterType] = useState<string>('ALL');

  // RL Recommendation feedback modal states
  const [feedbackPromptRecId, setFeedbackPromptRecId] = useState<string | null>(null);
  const [feedbackReason, setFeedbackReason] = useState<string>('Need cash buffer for upcoming expenses');
  const [rlSuccessMessage, setRlSuccessMessage] = useState<string | null>(null);

  const baseCurr = settings.baseCurrency || 'INR';
  const currSym = currencies.find((c) => c.code === baseCurr)?.symbol || '₹';

  // Filter out snoozed or dismissed cards
  const now = new Date().toISOString();
  const activeInsights = insights.filter((i) => {
    if (i.snoozedUntil && i.snoozedUntil > now) return false;
    if (filterType !== 'ALL' && i.type !== filterType) return false;
    return true;
  });

  const handleAction = (card: InsightCardData) => {
    if (card.actionPayload?.tab) {
      if (card.actionPayload.tab === 'settings' || card.actionPayload.tab === 'tax') {
        setActiveModal(card.actionPayload.tab);
      } else {
        setActiveTab(card.actionPayload.tab as any);
      }
    }
  };

  const handleExecuteRL = async (recId: string) => {
    await executeRLRecommendation(recId);
    setRlSuccessMessage('Rebalance executed! Internal transfer logged in ledger and RL model rewarded (+2.0 reward score).');
    setTimeout(() => setRlSuccessMessage(null), 5000);
  };

  const handleConfirmDismissRL = (recId: string) => {
    dismissRLRecommendation(recId, feedbackReason);
    setFeedbackPromptRecId(null);
    setRlSuccessMessage(`Feedback logged: "${feedbackReason}". RL policy tuned weights to refine future suggestions.`);
    setTimeout(() => setRlSuccessMessage(null), 5000);
  };

  return (
    <div className="space-y-4 pb-20 animate-fade-in">
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">Financial Insights</h2>
          <p className="text-xs text-slate-400">
            Cashflow analysis, allocation recommendations, and tax planning
          </p>
        </div>
        <button
          onClick={() => setActiveModal('career')}
          className="px-3 py-1.5 rounded-xl bg-purple-950/60 border border-purple-800/60 hover:bg-purple-900/60 text-purple-300 text-xs font-semibold flex items-center gap-1.5 cursor-pointer shadow-sm transition-colors"
          title="Open Career & Human Skill Valuation Hub"
        >
          <GraduationCap size={15} className="text-purple-400" />
          <span>Career & Skill Valuation</span>
        </button>
      </div>

      {/* RL Flash Feedback Message */}
      {rlSuccessMessage && (
        <div className="p-3.5 rounded-xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-xs flex items-center gap-2 animate-fade-in shadow-sm">
          <Sparkles size={16} className="text-emerald-400 shrink-0" />
          <span>{rlSuccessMessage}</span>
        </div>
      )}

      {/* Historical Net Worth Growth Trend Line Chart */}
      <HistoricalNetWorthChart />

      {/* ML Human Skill & Lifetime Earning Trajectory Overview */}
      <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/20 flex items-center justify-center shrink-0">
            <GraduationCap size={20} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-white tracking-tight">Career & Human Skill Valuation</h3>
              <span className="text-[10px] text-purple-300 bg-purple-950/60 border border-purple-800/50 px-2 py-0.5 rounded-full font-semibold">
                +{careerPrediction.netRateContributionPct.toFixed(1)}% Velocity
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              5-Yr NPV: <strong className="text-slate-200 font-mono">{formatMoney(careerPrediction.humanCapitalNpv5Yr, baseCurr, currSym)}</strong> · 10-Yr NPV: <strong className="text-emerald-400 font-mono">{formatMoney(careerPrediction.humanCapitalNpv10Yr, baseCurr, currSym)}</strong>
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setActiveModal('career')}
          className="px-4 py-2 rounded-xl bg-purple-950/60 border border-purple-800/60 hover:bg-purple-900/60 text-purple-200 text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors shadow-xs shrink-0"
        >
          <span>Open Career Hub</span>
          <ArrowRight size={14} />
        </button>
      </div>

      {/* ML Excess Cash Flow, Safe Buffer & Market Cap Allocation Engine */}
      <MLInvestmentAllocationEngine />

      {/* Closed-Loop Reality vs. Prediction Engine & Broker Fee Correlation */}
      <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-3.5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-indigo-500/15 text-indigo-400 flex items-center justify-center shrink-0">
              <ShieldCheck size={16} />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-white tracking-tight">
                Closed-Loop Reality Audit
              </h3>
              <p className="text-xs text-slate-400">
                Ledger reality vs. model predictions across fees, debt, spend, and yield
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span className="font-semibold text-indigo-300">
              {ENGAGEMENT_STRATEGY_LABELS[closedLoopMLState.activeStrategy]}
            </span>
            <span className="text-slate-600">·</span>
            <span className="font-mono tabular-nums text-slate-400">
              {closedLoopMLState.totalRealityAudits} audits
            </span>
          </div>
        </div>

        {/* Notify-Only Broker Usage Pattern Banner */}
        {brokerUsageForecast.hasPattern && (
          <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 space-y-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-300">
                <Bell size={13} className="shrink-0" />
                <span>
                  {brokerUsageForecast.predictedBrokerName || 'Card Broker'} (~{brokerUsageForecast.avgIntervalDays}d cycle)
                </span>
              </div>
              <span className="text-[11px] font-mono tabular-nums text-amber-200">
                Est. {brokerUsageForecast.expectedNextDateStr}
              </span>
            </div>
            <p className="text-xs text-slate-300 leading-snug">
              Typical <strong className="font-mono tabular-nums text-white">{formatMoney(brokerUsageForecast.typicalAmount, baseCurr, currSym)}</strong>
              {brokerUsageForecast.recommendedCardName ? (
                <>
                  {' '}· Use <strong className="text-emerald-400">{brokerUsageForecast.recommendedCardName}</strong> (fee{' '}
                  <strong className="font-mono tabular-nums text-emerald-300">{formatMoney(brokerUsageForecast.recommendedProjectedFee, baseCurr, currSym)}</strong>
                  {brokerUsageForecast.potentialFeeSaved > 0
                    ? `, saves ${formatMoney(brokerUsageForecast.potentialFeeSaved, baseCurr, currSym)}`
                    : ''}
                  ).
                </>
              ) : '.'}
            </p>
          </div>
        )}

        {/* Latest Failure Self-Acknowledgment (when prior warning failed to persuade user) */}
        {(() => {
          const latestFail = closedLoopMLState.recentOutcomes.find((o) => o.outcome === 'fail' && o.failureAcknowledgment);
          if (!latestFail) return null;
          return (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-200 space-y-1">
              <div className="font-semibold text-rose-300 flex items-center gap-1.5">
                <AlertTriangle size={13} className="shrink-0" />
                <span>Model Strategy Recalibration ({latestFail.domain.replace('_', ' ')})</span>
              </div>
              <p className="text-[11px] text-slate-300 leading-relaxed">{latestFail.failureAcknowledgment}</p>
              <div className="text-[11px] text-slate-400 font-mono">
                Ledger: {latestFail.actualRealitySummary} · Expected: {latestFail.predictedSummary}
              </div>
            </div>
          );
        })()}

        {/* 5-Domain Reality Accuracy Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
          {(
            [
              { key: 'broker_fees', label: 'Broker Fees' },
              { key: 'debt_strategy', label: 'Debt & Prepay' },
              { key: 'spending', label: 'Spend Forecast' },
              { key: 'earnings', label: 'Earnings' },
              { key: 'asset_allocation', label: 'Asset Yield' },
            ] as const
          ).map((dom) => {
            const stat = closedLoopMLState.domainStats[dom.key];
            return (
              <div key={dom.key} className="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800">
                <div className="text-[10px] text-slate-400 font-semibold uppercase truncate">{dom.label}</div>
                <div className="flex items-baseline justify-between gap-1 mt-1 font-mono tabular-nums text-[11px]">
                  <span className="text-emerald-400 font-bold">{stat.successes} followed</span>
                  <span className="text-slate-400">{stat.failures} skipped</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Learned Card-Broker Fee Correlation Table */}
        {closedLoopMLState.brokerProfiles.length > 0 && (
          <div className="space-y-1.5 pt-1">
            <div className="text-[11px] font-semibold text-slate-300">
              Learned Card &amp; Broker Fee Benchmarks
            </div>
            <div className="overflow-x-auto rounded-xl border border-slate-800">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950 text-[10px] uppercase text-slate-400">
                  <tr>
                    <th className="px-3 py-2">Card / Source</th>
                    <th className="px-3 py-2">Broker</th>
                    <th className="px-3 py-2 text-right">Eff. Charge</th>
                    <th className="px-3 py-2 text-right">Uses</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70 bg-slate-950/40">
                  {closedLoopMLState.brokerProfiles.slice(0, 6).map((bp) => (
                    <tr key={`${bp.sourceId}-${bp.brokerName}`}>
                      <td className="px-3 py-2 font-medium text-slate-200">{bp.sourceName}</td>
                      <td className="px-3 py-2 text-slate-300">{bp.brokerName}</td>
                      <td className="px-3 py-2 text-right font-mono text-amber-300">
                        {bp.effectiveFeePct.toFixed(2)}%
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-slate-400">{bp.sampleCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Reinforcement Learning Cashflow Re-investment & Surplus Allocation Engine */}
      <div className="p-4 rounded-2xl bg-gradient-to-br from-slate-900 via-slate-900 to-slate-950 border border-slate-800 space-y-3.5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-cyan-500/15 text-cyan-400 flex items-center justify-center">
              <Brain size={16} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white tracking-tight">
                Surplus Cash Allocation
              </h3>
              <p className="text-xs text-slate-400">
                Verified idle cash above safety buffer vs. debt &amp; yield opportunities
              </p>
            </div>
          </div>
        </div>

        {rlRecommendations.length === 0 ? (
          <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 text-xs text-slate-400">
            <span className="text-slate-200 font-semibold">Balanced:</span> No idle cash above your <span className="font-mono tabular-nums text-slate-300">{formatMoney(settings.minCashCustom || 25000, baseCurr, currSym)}</span> floor.
          </div>
        ) : (
          <div className="space-y-3">
            {rlRecommendations.map((rec) => {
              const isPromptOpen = feedbackPromptRecId === rec.id;
              const isDebt = rec.id.includes('debt');

              return (
                <div
                  key={rec.id}
                  className="p-4 rounded-xl bg-slate-950/90 border border-cyan-500/30 hover:border-cyan-500/50 transition-all space-y-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-white">
                          {isDebt ? 'Debt Prepayment' : 'Yield Optimization'}
                        </span>
                      </div>
                      <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                        Move <strong className="text-emerald-400 font-mono">{formatMoney(rec.suggestedAmount, baseCurr, currSym)}</strong> surplus cash from{' '}
                        <strong className="text-slate-200">{rec.fromSourceName}</strong> ({rec.fromYieldPct}% p.a.) to{' '}
                        <strong className="text-cyan-300">{rec.toAssetName}</strong> ({rec.toYieldPct}% p.a.).
                      </p>
                    </div>

                    <div className="text-right">
                      <span className="text-[10px] text-slate-400 uppercase font-semibold">
                        {isDebt ? 'Est. Annual Interest Saved' : 'Est. Annual Potential Gain'}
                      </span>
                      <div className="text-base font-bold text-emerald-400 font-mono">
                        +{formatMoney(rec.annualPotentialGain, baseCurr, currSym)}/yr
                      </div>
                    </div>
                  </div>

                  {/* Actions & Feedback loop */}
                  {!isPromptOpen ? (
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800">
                      <div className="text-[11px] text-slate-400">
                        Updates RL allocation weights on execution or pass.
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => setFeedbackPromptRecId(rec.id)}
                          className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer transition-colors whitespace-nowrap shrink-0"
                        >
                          Pass
                        </button>
                        <button
                          onClick={() => handleExecuteRL(rec.id)}
                          className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-md shadow-emerald-600/30 cursor-pointer transition-all whitespace-nowrap shrink-0"
                        >
                          <Zap size={13} />
                          <span>Rebalance</span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="p-3 rounded-lg bg-slate-900 border border-slate-700 space-y-2.5 text-xs animate-fade-in">
                      <div className="font-bold text-slate-200">
                        Help RL model learn: Why are you passing on this advice?
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {[
                          'Need higher liquidity buffer for upcoming expenses',
                          'Destination asset is too volatile / market risk',
                          'Prefer allocating to debt or different asset',
                          'Will rebalance manually at a later date',
                        ].map((opt) => (
                          <button
                            key={opt}
                            type="button"
                            onClick={() => setFeedbackReason(opt)}
                            className={`p-2 rounded-lg text-left text-xs border transition-colors cursor-pointer ${
                              feedbackReason === opt
                                ? 'bg-cyan-500/20 border-cyan-500 text-cyan-200 font-semibold'
                                : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                            }`}
                          >
                            {opt}
                          </button>
                        ))}
                      </div>

                      <div className="flex justify-end gap-2 pt-1">
                        <button
                          onClick={() => setFeedbackPromptRecId(null)}
                          className="px-3 py-1 rounded-lg bg-slate-800 text-slate-400 hover:text-slate-200 text-xs cursor-pointer"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => handleConfirmDismissRL(rec.id)}
                          className="px-3.5 py-1 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold cursor-pointer"
                        >
                          Submit Feedback & Tune Model
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Period & Comparison Controls */}
      <div className="p-3 rounded-2xl bg-slate-900 border border-slate-800 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-1.5 text-slate-400 font-semibold">
            <Calendar size={14} className="text-emerald-400" />
            <span>Analysis Horizon:</span>
          </div>

          <div className="flex bg-slate-950 p-0.5 rounded-xl border border-slate-800 text-[11px]">
            {(['month', '3m', '6m', '12m', 'ytd'] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-2.5 py-1 rounded-lg font-medium transition-colors cursor-pointer uppercase ${
                  period === p
                    ? 'bg-slate-800 text-emerald-400 font-bold shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800/60 text-xs">
          <div className="flex items-center gap-1.5 text-slate-400">
            <span>Compare Against:</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setComparison('prev')}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
                comparison === 'prev'
                  ? 'bg-slate-800 text-cyan-400 font-semibold border border-slate-700'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Previous Period
            </button>
            <button
              onClick={() => setComparison('last_year')}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
                comparison === 'last_year'
                  ? 'bg-slate-800 text-cyan-400 font-semibold border border-slate-700'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Same Period Last Year
            </button>
          </div>
        </div>
      </div>

      {/* Filter Chips */}
      <div className="flex items-center gap-1.5 text-xs">
        <button
          onClick={() => setFilterType('ALL')}
          className={`px-3 py-1 rounded-xl font-medium cursor-pointer transition-all ${
            filterType === 'ALL'
              ? 'bg-slate-800 text-white font-bold'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          All ({insights.length})
        </button>
        <button
          onClick={() => setFilterType('warning')}
          className={`px-3 py-1 rounded-xl font-medium cursor-pointer transition-all ${
            filterType === 'warning'
              ? 'bg-rose-500/20 text-rose-300 font-bold border border-rose-500/40'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Warnings & Risks
        </button>
        <button
          onClick={() => setFilterType('positive')}
          className={`px-3 py-1 rounded-xl font-medium cursor-pointer transition-all ${
            filterType === 'positive'
              ? 'bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/40'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Positive Momentum
        </button>
      </div>

      {/* Feed Cards */}
      {activeInsights.length === 0 ? (
        <div className="p-8 rounded-2xl bg-slate-900 border border-slate-800 text-center text-xs text-slate-400">
          No insights currently active for this filter.
        </div>
      ) : (
        <div className="space-y-2.5">
          {activeInsights.map((card) => {
            const isWarning = card.type === 'warning';
            const isPositive = card.type === 'positive';

            return (
              <div
                key={card.id}
                className={`p-3.5 rounded-xl border transition-all ${
                  isWarning
                    ? 'bg-rose-950/15 border-rose-500/35'
                    : isPositive
                    ? 'bg-emerald-950/15 border-emerald-500/35'
                    : 'bg-slate-900 border-slate-800'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2.5 min-w-0">
                    <div
                      className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
                        isWarning
                          ? 'bg-rose-500/15 text-rose-400'
                          : isPositive
                          ? 'bg-emerald-500/15 text-emerald-400'
                          : 'bg-slate-800 text-cyan-400'
                      }`}
                    >
                      {isWarning ? (
                        <AlertTriangle size={14} />
                      ) : isPositive ? (
                        <TrendingUp size={14} />
                      ) : (
                        <Lightbulb size={14} />
                      )}
                    </div>

                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <h4 className="text-xs sm:text-sm font-bold text-white tracking-tight">
                          {card.headline}
                        </h4>
                      </div>
                      <p className="text-xs text-slate-300 mt-0.5 font-mono tabular-nums leading-snug">
                        {card.evidence}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-0.5 shrink-0">
                    <button
                      onClick={() => snoozeInsight(card.id, 7)}
                      className="p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-slate-800 transition-colors cursor-pointer"
                      title="Snooze 7d"
                    >
                      <Clock size={14} />
                    </button>
                    <button
                      onClick={() => dismissInsight(card.id)}
                      className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-slate-800 transition-colors cursor-pointer"
                      title="Dismiss"
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>

                {card.suggestedAction && (
                  <div className="flex items-center justify-between gap-2 pt-2.5 border-t border-slate-800/70 mt-2.5 text-xs">
                    <div className="text-slate-300 min-w-0">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mr-1.5">
                        Action
                      </span>
                      <span className="font-medium text-slate-200">{card.suggestedAction}</span>
                    </div>

                    {card.actionPayload && (
                      <button
                        onClick={() => handleAction(card)}
                        className={`px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1 cursor-pointer transition-all whitespace-nowrap shrink-0 ${
                          isWarning
                            ? 'bg-rose-600 hover:bg-rose-500 text-white'
                            : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                        }`}
                      >
                        <span>Open</span>
                        <ArrowRight size={12} />
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
