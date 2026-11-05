import React from 'react';
import { useApp } from '../../context/AppContext';
import {
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  Info,
  ChevronRight,
  X,
} from 'lucide-react';

export const NeedsAttentionPanel: React.FC = () => {
  const {
    attentionItems,
    dismissAttentionItem,
    setActiveTab,
    setActiveModal,
  } = useApp();

  if (attentionItems.length === 0) return null;

  const hasActionItems = attentionItems.some(
    (item) => item.level === 'critical' || item.level === 'warning'
  );

  return (
    <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4 my-4">
      <div className="flex items-center justify-between mb-2.5">
        <h3
          className={`text-xs font-bold uppercase tracking-wider ${
            hasActionItems ? 'text-rose-400' : 'text-emerald-400'
          }`}
        >
          {hasActionItems
            ? `Action & Progress (${attentionItems.length})`
            : `Good Momentum (${attentionItems.length})`}
        </h3>
        <span className="text-[11px] text-slate-500">
          {hasActionItems ? 'Required items return if unresolved' : 'All key checks clear'}
        </span>
      </div>

      <div className="flex flex-col gap-2">
        {attentionItems.map((item) => {
          const isCritical = item.level === 'critical';
          const isWarning = item.level === 'warning';
          const isPositive = item.level === 'positive';

          return (
            <div
              key={item.id}
              onClick={() => {
                if (!item.linkTab) return;
                setActiveModal(null);
                if (['settings', 'tax', 'income', 'goals'].includes(item.linkTab)) {
                  setTimeout(() => setActiveModal(item.linkTab || null), 50);
                } else {
                  setActiveTab(
                    item.linkTab as 'home' | 'assets' | 'liabilities' | 'spend' | 'insights'
                  );
                }
              }}
              className={`px-3 py-2.5 rounded-xl border transition-colors ${
                item.linkTab ? 'cursor-pointer' : 'cursor-default'
              } flex items-center justify-between gap-2.5 ${
                isCritical
                  ? 'bg-rose-950/20 border-rose-500/40 hover:border-rose-400/60'
                  : isWarning
                  ? 'bg-amber-950/15 border-amber-500/35 hover:border-amber-400/60'
                  : isPositive
                  ? 'bg-emerald-950/15 border-emerald-500/30 hover:border-emerald-400/50'
                  : 'bg-slate-950/50 border-slate-800 hover:border-slate-700'
              }`}
            >
              <div className="flex items-start gap-2.5 min-w-0">
                <div className="mt-0.5 shrink-0">
                  {isCritical ? (
                    <AlertTriangle size={15} className="text-rose-400" />
                  ) : isWarning ? (
                    <AlertCircle size={15} className="text-amber-400" />
                  ) : isPositive ? (
                    <CheckCircle2 size={15} className="text-emerald-400" />
                  ) : (
                    <Info size={15} className="text-slate-400" />
                  )}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap text-xs">
                    <span className="font-semibold text-white">{item.title}</span>
                    {isCritical && (
                      <>
                        <span className="text-slate-600" aria-hidden="true">·</span>
                        <span className="text-[11px] text-rose-300 font-medium">Action needed</span>
                      </>
                    )}
                    {isPositive && (
                      <>
                        <span className="text-slate-600" aria-hidden="true">·</span>
                        <span className="text-[11px] text-emerald-400 font-medium">Nice move</span>
                      </>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-300 mt-0.5 leading-snug">
                    {item.description}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                {item.linkTab && (
                  <div className="flex items-center gap-0.5 whitespace-nowrap text-cyan-400 hover:text-cyan-300 font-semibold text-[11px]">
                    <span>
                      {item.actionLabel ||
                        (item.linkTab === 'assets'
                          ? 'Assets'
                          : item.linkTab === 'liabilities'
                          ? 'Liabilities'
                          : item.linkTab)}
                    </span>
                    <ChevronRight size={14} className="shrink-0" />
                  </div>
                )}

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    dismissAttentionItem(item.id);
                  }}
                  className="p-1 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
                  title={
                    item.requiresAction
                      ? 'Snooze for now (resurfaces later if still needed)'
                      : 'Clear alert'
                  }
                >
                  <X size={13} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
