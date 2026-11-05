import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { ForecastScenario } from '../../lib/cashFlowForecast';
import { formatMoney } from '../../lib/formatters';
import {
  Calendar,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  ShieldCheck,
  ChevronDown,
  ChevronUp,
  Sliders,
  Info,
} from 'lucide-react';

export const CashFlowForecastCard: React.FC = () => {
  const { cashFlowForecast, generateCustomForecast, settings, currencies } = useApp();
  const [selectedScenario, setSelectedScenario] = useState<ForecastScenario>('normal');
  const [windowDays, setWindowDays] = useState<30 | 60 | 90>(30);
  const [isExpanded, setIsExpanded] = useState(false);
  const [showAssumptions, setShowAssumptions] = useState(false);

  // Compute active forecast based on selected scenario
  const activeForecast = selectedScenario === 'normal' && windowDays === 30
    ? cashFlowForecast
    : generateCustomForecast({ scenario: selectedScenario, windowDays });

  const currencySymbol =
    currencies.find((c) => c.code === settings.baseCurrency)?.symbol ||
    settings.baseCurrency ||
    '₹';

  const fmt = (amt: number, dec: number = 0) =>
    formatMoney(amt, settings.baseCurrency, currencySymbol, settings.numberGrouping, dec);

  const hasNegativeAlert = activeForecast.negativeCashDates.length > 0;
  const netFlow = activeForecast.totalProjectedInflows - activeForecast.totalProjectedOutflows;

  return (
    <div className="rounded-xl bg-slate-900/90 border border-slate-800 p-4 space-y-3.5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-400">
            <Calendar size={16} />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-200">
              Cash-Flow Forecast ({windowDays} Days)
            </h3>
            <p className="text-[11px] text-slate-400">
              Deterministic date-based liquidity runway
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setShowAssumptions(!showAssumptions)}
            className="p-1 text-slate-400 hover:text-slate-200 text-xs rounded transition-colors"
            title="Forecast assumptions and rules"
          >
            <Info size={14} />
          </button>
          <div className="flex bg-slate-800 rounded-lg p-0.5 text-[11px]">
            <button
              onClick={() => setWindowDays(30)}
              className={`px-2 py-0.5 rounded font-medium transition-colors ${
                windowDays === 30 ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              30d
            </button>
            <button
              onClick={() => setWindowDays(60)}
              className={`px-2 py-0.5 rounded font-medium transition-colors ${
                windowDays === 60 ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              60d
            </button>
          </div>
        </div>
      </div>

      {/* Assumptions Explanation */}
      {showAssumptions && (
        <div className="p-2.5 rounded-lg bg-slate-800/80 border border-slate-700/60 text-[11px] text-slate-300 space-y-1.5 animate-fade-in">
          <div className="font-semibold text-slate-200 flex items-center gap-1.5">
            <ShieldCheck size={13} className="text-emerald-400" />
            Audit & Invariance Rules
          </div>
          <ul className="list-disc list-inside space-y-1 text-slate-400">
            <li>Opening cash excludes locked FDs, credit lines, stocks, and promised receivables.</li>
            <li>Credit card statement dues reflect cool-off periods; card spends are never double-counted with bill settlements.</li>
            <li>Receivables are weighted by collection confidence; unreceived loans do not fund bills.</li>
          </ul>
        </div>
      )}

      {/* Negative Cash Alert Banner */}
      {hasNegativeAlert && (
        <div className="p-2.5 rounded-lg bg-rose-950/40 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-2 animate-pulse">
          <AlertTriangle size={15} className="text-rose-400 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <div className="font-semibold">Negative Cash Balance Warning</div>
            <p className="text-[11px] text-rose-300/80">
              Projected balance drops below zero on{' '}
              {activeForecast.negativeCashDates.slice(0, 3).join(', ')}
              {activeForecast.negativeCashDates.length > 3 ? ` (+${activeForecast.negativeCashDates.length - 3} more)` : ''}.
              Preemptively break sweep-in FDs or reschedule discretionary expenses.
            </p>
          </div>
        </div>
      )}

      {/* Scenario Stress-Test Switcher */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-[11px] text-slate-400">
          <span className="flex items-center gap-1 font-medium">
            <Sliders size={12} /> Stress Test Scenarios:
          </span>
          <span className="text-slate-500">{activeForecast.scenarioDescription}</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {[
            { id: 'normal', label: 'Baseline' },
            { id: 'delayed_salary', label: 'Salary +7d Late' },
            { id: 'delayed_receivables', label: 'No Loan Receipts' },
            { id: 'unexpected_expense', label: 'Emergency -₹25k' },
            { id: 'income_shock', label: '-50% Income Shock' },
          ].map((sc) => (
            <button
              key={sc.id}
              onClick={() => setSelectedScenario(sc.id as ForecastScenario)}
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all ${
                selectedScenario === sc.id
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-750 border border-slate-700/50'
              }`}
            >
              {sc.label}
            </button>
          ))}
        </div>
      </div>

      {/* Forecast Metric Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
        <div className="p-2.5 rounded-lg bg-slate-800/50 border border-slate-800">
          <div className="text-[10px] text-slate-400 uppercase tracking-wider">Opening Liquid</div>
          <div className="text-sm font-bold text-slate-200 mt-0.5">
            {fmt(activeForecast.initialLiquidCash)}
          </div>
          <div className="text-[10px] text-emerald-400 flex items-center gap-0.5 mt-0.5">
            Immediate cash
          </div>
        </div>

        <div className="p-2.5 rounded-lg bg-slate-800/50 border border-slate-800">
          <div className="text-[10px] text-slate-400 uppercase tracking-wider">Projected Inflows</div>
          <div className="text-sm font-bold text-emerald-400 mt-0.5 flex items-center gap-1">
            <TrendingUp size={13} />
            {fmt(activeForecast.totalProjectedInflows)}
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">Salary & collections</div>
        </div>

        <div className="p-2.5 rounded-lg bg-slate-800/50 border border-slate-800">
          <div className="text-[10px] text-slate-400 uppercase tracking-wider">Projected Outflows</div>
          <div className="text-sm font-bold text-rose-400 mt-0.5 flex items-center gap-1">
            <TrendingDown size={13} />
            {fmt(activeForecast.totalProjectedOutflows)}
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">Bills, EMIs & card dues</div>
        </div>

        <div className="p-2.5 rounded-lg bg-slate-800/50 border border-slate-800">
          <div className="text-[10px] text-slate-400 uppercase tracking-wider">Lowest Balance Floor</div>
          <div
            className={`text-sm font-bold mt-0.5 ${
              activeForecast.minProjectedBalance < 0
                ? 'text-rose-400'
                : activeForecast.minProjectedBalance < (settings.cashFlowBufferAmount || 25000)
                ? 'text-amber-400'
                : 'text-indigo-400'
            }`}
          >
            {fmt(activeForecast.minProjectedBalance)}
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">
            on {activeForecast.minBalanceDate.slice(5)}
          </div>
        </div>
      </div>

      {/* Expandable Daily Calendar Timeline */}
      <div className="pt-1">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="w-full py-1.5 px-3 rounded-lg bg-slate-800/60 hover:bg-slate-800 text-slate-300 text-xs font-medium flex items-center justify-between transition-colors"
        >
          <span>
            {isExpanded ? 'Hide' : 'View'} Day-by-Day Calendar Timeline ({activeForecast.dailyTimeline.filter(d => d.events.length > 0).length} active days)
          </span>
          {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>

        {isExpanded && (
          <div className="mt-2 space-y-1.5 max-h-60 overflow-y-auto pr-1 animate-fade-in text-xs">
            {activeForecast.dailyTimeline.map((day) => {
              const hasEvents = day.events.length > 0;
              if (!hasEvents && !day.isNegative && day.closingBalance >= (settings.cashFlowBufferAmount || 25000)) {
                return null; // keep view concise by only showing days with inflows/outflows or warnings
              }

              return (
                <div
                  key={day.date}
                  className={`p-2 rounded-lg border ${
                    day.isNegative
                      ? 'bg-rose-950/30 border-rose-600/30'
                      : day.isBelowBuffer
                      ? 'bg-amber-950/20 border-amber-600/20'
                      : 'bg-slate-800/40 border-slate-800'
                  } flex items-center justify-between gap-2`}
                >
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-200">{day.date}</span>
                      <span className="text-[10px] text-slate-400">({day.dayOfWeek})</span>
                      {day.isNegative && (
                        <span className="px-1.5 py-0.2 rounded text-[10px] bg-rose-600 text-white font-medium">
                          Deficit
                        </span>
                      )}
                    </div>
                    {day.events.map((ev) => (
                      <div
                        key={ev.id}
                        className={`text-[11px] flex items-center gap-1 ${
                          ev.type === 'inflow' ? 'text-emerald-400' : 'text-slate-300'
                        }`}
                      >
                        <span>{ev.type === 'inflow' ? '+' : '-'}</span>
                        <span>{ev.name}:</span>
                        <span className="font-medium">
                          {fmt(ev.amount)}
                        </span>
                        {!ev.isConfirmed && (
                          <span className="text-[10px] text-slate-400 italic">(estimated)</span>
                        )}
                      </div>
                    ))}
                  </div>

                  <div className="text-right">
                    <div className="text-[10px] text-slate-400">Closing</div>
                    <div
                      className={`font-semibold ${
                        day.closingBalance < 0
                          ? 'text-rose-400'
                          : day.closingBalance < (settings.cashFlowBufferAmount || 25000)
                          ? 'text-amber-400'
                          : 'text-slate-200'
                      }`}
                    >
                      {fmt(day.closingBalance)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
