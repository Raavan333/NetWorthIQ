import React from 'react';
import { FinancialAnomaly, Transaction } from '../../types';
import { useApp } from '../../context/AppContext';
import { formatMoney } from '../../lib/formatters';
import { useBackDismiss } from '../../lib/modalBackStack';
import { X, AlertTriangle, CheckCircle, Info, ShieldAlert, ArrowRight } from 'lucide-react';

interface Props {
  onClose: () => void;
  onSelectTransactionForReversal?: (tx: Transaction) => void;
}

export const AnomalyReviewDrawer: React.FC<Props> = ({ onClose, onSelectTransactionForReversal }) => {
  const { anomalies, dismissAnomaly, transactions, settings } = useApp();

  useBackDismiss(true, onClose);

  return (
    <div
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-xl bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90dvh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-neutral-800 bg-neutral-900/90 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20 shrink-0">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-white truncate">Financial Anomaly Review</h3>
              <p className="text-xs text-neutral-400">
                {anomalies.length} Flagged {anomalies.length === 1 ? 'Pattern' : 'Patterns'} for Verification
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="min-w-[44px] min-h-[44px] flex items-center justify-center text-neutral-400 hover:text-white rounded-lg hover:bg-neutral-800 transition cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 sm:p-5 overflow-y-auto overscroll-contain space-y-4 flex-1">
          {anomalies.length === 0 ? (
            <div className="text-center py-12 space-y-2">
              <CheckCircle className="w-8 h-8 text-emerald-400 mx-auto" />
              <p className="text-sm font-medium text-white">No Financial Anomalies Detected</p>
              <p className="text-xs text-neutral-400">
                All recent transactions and account balances match established historical patterns.
              </p>
            </div>
          ) : (
            anomalies.map((anomaly) => {
              const matchedTx = anomaly.transactionId
                ? transactions.find((t) => t.id === anomaly.transactionId)
                : undefined;

              return (
                <div
                  key={anomaly.id}
                  className="p-4 rounded-xl bg-neutral-950 border border-neutral-800 space-y-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      {anomaly.severity === 'critical' ? (
                        <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                      ) : anomaly.severity === 'warning' ? (
                        <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                      ) : (
                        <Info className="w-4 h-4 text-blue-400 shrink-0" />
                      )}
                      <h4 className="text-xs font-semibold text-white">{anomaly.title}</h4>
                    </div>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-neutral-900 border border-neutral-800 text-neutral-400 font-mono">
                      {Math.round(anomaly.confidenceScore * 100)}% Confidence
                    </span>
                  </div>

                  <p className="text-xs text-neutral-300 leading-relaxed">{anomaly.description}</p>

                  {anomaly.historicalBaseline && (
                    <div className="text-[11px] text-neutral-400 bg-neutral-900/60 p-2 rounded-lg border border-neutral-800/60">
                      <strong>Historical Baseline:</strong> {anomaly.historicalBaseline}
                    </div>
                  )}

                  <div className="text-[11px] text-neutral-400 italic">
                    Suggested Action: {anomaly.suggestedAction}
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-2 border-t border-neutral-800/80">
                    <button
                      type="button"
                      onClick={() => dismissAnomaly(anomaly.id)}
                      className="px-3 py-1.5 text-xs text-neutral-400 hover:text-white rounded-lg hover:bg-neutral-800 transition"
                    >
                      Dismiss
                    </button>
                    {matchedTx && onSelectTransactionForReversal && (
                      <button
                        type="button"
                        onClick={() => {
                          onSelectTransactionForReversal(matchedTx);
                          onClose();
                        }}
                        className="px-3 py-1.5 text-xs font-medium bg-amber-600/20 text-amber-300 border border-amber-600/30 hover:bg-amber-600/30 rounded-lg transition flex items-center gap-1"
                      >
                        Review / Reverse
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-neutral-800 bg-neutral-900/90 flex justify-end shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 min-h-[44px] rounded-lg bg-neutral-800 hover:bg-neutral-700 text-xs font-medium text-neutral-200 transition cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
