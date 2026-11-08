import React from 'react';
import { useApp } from '../../context/AppContext';
import { formatMoney, formatCompactMoney } from '../../lib/formatters';
import { TrendingUp, TrendingDown, Clock, ShieldAlert } from 'lucide-react';

export const LiveTickerHero: React.FC = () => {
  const { tickerValue, engineResult, settings, currencies, continuousEngineStats } = useApp();

  const baseCurr = settings.baseCurrency || 'INR';
  const currSym = currencies.find((c) => c.code === baseCurr)?.symbol || '₹';
  const isPositiveRate = engineResult.finalRatePct > 0 || engineResult.finalRateAmountPerYear > 0;
  const isNegativeRate = engineResult.finalRatePct < 0 || engineResult.finalRateAmountPerYear < 0;

  const showAwayAccrual =
    continuousEngineStats &&
    continuousEngineStats.closedDurationSeconds >= 2 &&
    Math.abs(continuousEngineStats.accruedWhileClosed) > 0.0001;

  return (
    <div className="relative overflow-hidden rounded-2xl bg-slate-900 border border-slate-800 p-4 sm:p-5">
      <div
        className={`absolute -top-24 -right-24 w-56 h-56 rounded-full blur-3xl opacity-15 pointer-events-none transition-all ${
          isPositiveRate ? 'bg-emerald-500' : isNegativeRate ? 'bg-rose-500' : 'bg-slate-700'
        }`}
      />

      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-400">
          <Clock size={13} className="text-emerald-400" />
          <span className="uppercase tracking-wider text-[11px]">Settled Net Worth</span>
        </div>
        <span className="text-[11px] text-slate-500 font-mono tabular-nums">
          {isPositiveRate ? 'Compounding' : isNegativeRate ? 'Degrading' : 'Steady'}
        </span>
      </div>

      {/* Main Live Net Worth Number */}
      <div className="my-2">
        <div
          className={`text-2xl min-[360px]:text-3xl sm:text-4xl font-black tracking-tight font-mono tabular-nums flex items-baseline gap-1 break-all sm:break-normal ${
            tickerValue < 0 ? 'text-rose-400' : 'text-white'
          }`}
        >
          <span>
            {formatMoney(
              tickerValue,
              baseCurr,
              currSym,
              settings.numberGrouping,
              2
            )}
          </span>
        </div>

        <div className="mt-1 flex items-center gap-2">
          {showAwayAccrual ? (
            <div className="text-[11px] text-slate-400 font-mono tabular-nums flex items-center gap-1">
              <span
                className={`font-medium ${
                  continuousEngineStats.accruedWhileClosed >= 0
                    ? 'text-emerald-400'
                    : 'text-rose-400'
                }`}
              >
                {continuousEngineStats.accruedWhileClosed > 0 ? '+' : ''}
                {formatMoney(
                  continuousEngineStats.accruedWhileClosed,
                  baseCurr,
                  currSym,
                  settings.numberGrouping,
                  2
                )}
              </span>
              <span className="font-sans">since last session</span>
            </div>
          ) : (
            <p className="text-[11px] text-slate-400">
              Assets compounding offset against liabilities growth
            </p>
          )}
        </div>
      </div>

      {/* Realistic Net Worth Rate Row */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-2.5 border-t border-slate-800/80 mt-3">
        <div className="flex items-center gap-2">
          <div
            className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors ${
              engineResult.finalRatePct > 0
                ? 'bg-emerald-500/15 text-emerald-400'
                : engineResult.finalRatePct < 0
                ? 'bg-rose-500/15 text-rose-400'
                : 'bg-slate-800 text-slate-400'
            }`}
          >
            {engineResult.finalRatePct > 0 ? (
              <TrendingUp size={15} />
            ) : engineResult.finalRatePct < 0 ? (
              <TrendingDown size={15} />
            ) : (
              <Clock size={15} />
            )}
          </div>
          <div>
            <div className="flex items-baseline gap-1.5 flex-wrap font-mono tabular-nums">
              <span
                className={`text-sm font-bold tracking-tight ${
                  engineResult.finalRatePct > 0
                    ? 'text-emerald-400'
                    : engineResult.finalRatePct < 0
                    ? 'text-rose-400'
                    : 'text-slate-300'
                }`}
              >
                {engineResult.finalRatePct > 0 ? '+' : ''}
                {engineResult.finalRatePct.toFixed(2)}% p.a.
              </span>
              <span className="text-xs text-slate-400">
                ({engineResult.finalRateAmountPerYear > 0 ? '+' : ''}
                {formatCompactMoney(
                  engineResult.finalRateAmountPerYear,
                  baseCurr,
                  currSym,
                  settings.numberGrouping
                )}
                /yr)
              </span>
            </div>
            <p className="text-[10px] text-slate-500">
              Realistic net worth rate · Excludes uncredited salary
            </p>
          </div>
        </div>

        {engineResult.denominatorWarning && (
          <div className="flex items-center gap-1.5 text-[11px] text-rose-300 bg-rose-500/10 px-2.5 py-1 rounded-lg border border-rose-500/30 font-mono tabular-nums">
            <ShieldAlert size={13} className="text-rose-400 shrink-0" />
            <span>Deficit: {formatMoney(engineResult.netWorthBase, baseCurr, currSym)}</span>
          </div>
        )}
      </div>
    </div>
  );
};
