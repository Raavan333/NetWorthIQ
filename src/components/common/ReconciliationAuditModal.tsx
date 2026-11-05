import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { formatMoney } from '../../lib/formatters';
import {
  ShieldCheck,
  AlertTriangle,
  X,
  CheckCircle2,
  FileSpreadsheet,
  ArrowRight,
  RefreshCw,
} from 'lucide-react';

interface ReconciliationAuditModalProps {
  holdingId?: string;
  onClose: () => void;
}

export const ReconciliationAuditModal: React.FC<ReconciliationAuditModalProps> = ({
  holdingId,
  onClose,
}) => {
  const { holdings, reconcileHoldingBalance, currencies, settings } = useApp();

  const [selectedId, setSelectedId] = useState(holdingId || holdings[0]?.id || '');

  const selectedHolding = holdings.find((h) => h.id === selectedId);
  const recon = selectedId ? reconcileHoldingBalance(selectedId) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-xl shadow-2xl overflow-hidden animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-400">
              <ShieldCheck size={18} />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-100">
                Ledger Reconciliation & Audit
              </h2>
              <p className="text-xs text-slate-400">
                Verify account balance against recorded transaction flows
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4 text-xs">
          {/* Account Selector */}
          <div className="space-y-1">
            <label className="font-medium text-slate-300">Select Account to Reconcile</label>
            <select
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-100 font-medium focus:outline-hidden focus:border-indigo-500"
            >
              {holdings.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name} ({h.principalOrValue?.toLocaleString()} {h.currency})
                </option>
              ))}
            </select>
          </div>

          {recon && selectedHolding && (
            <div className="space-y-3">
              {/* Reconciliation Status Badge */}
              <div
                className={`p-3 rounded-lg border flex items-start gap-2.5 ${
                  recon.isReconciled
                    ? 'bg-emerald-950/20 border-emerald-600/30 text-emerald-300'
                    : 'bg-amber-950/20 border-amber-600/30 text-amber-300'
                }`}
              >
                {recon.isReconciled ? (
                  <CheckCircle2 size={16} className="text-emerald-400 shrink-0 mt-0.5" />
                ) : (
                  <AlertTriangle size={16} className="text-amber-400 shrink-0 mt-0.5" />
                )}
                <div className="space-y-0.5">
                  <div className="font-semibold text-slate-100">
                    {recon.isReconciled ? 'Account Fully Synchronized' : 'Ledger Drift Detected'}
                  </div>
                  <p className="text-[11px] leading-relaxed text-slate-300">
                    {recon.message}
                  </p>
                </div>
              </div>

              {/* Numerical Breakdown */}
              {(() => {
                const currencySymbol =
                  currencies.find((c) => c.code === selectedHolding.currency)?.symbol || '₹';
                const fmt = (amt: number, dec: number = 2) =>
                  formatMoney(amt, selectedHolding.currency, currencySymbol, settings.numberGrouping, dec);

                return (
                  <div className="p-3 rounded-lg bg-slate-800/40 border border-slate-800 space-y-2">
                    <div className="flex justify-between items-center py-1 border-b border-slate-800">
                      <span className="text-slate-400">Current Recorded Balance</span>
                      <span className="font-bold text-slate-200">
                        {fmt(recon.currentBalance)}
                      </span>
                    </div>

                    <div className="flex justify-between items-center py-1 border-b border-slate-800">
                      <span className="text-slate-400">Total Recorded Inflows</span>
                      <span className="text-emerald-400 font-semibold">
                        +{fmt(recon.recordedInflows)}
                      </span>
                    </div>

                    <div className="flex justify-between items-center py-1 border-b border-slate-800">
                      <span className="text-slate-400">Total Recorded Outflows</span>
                      <span className="text-rose-400 font-semibold">
                        -{fmt(recon.recordedOutflows)}
                      </span>
                    </div>

                    <div className="flex justify-between items-center py-1 border-b border-slate-800">
                      <span className="text-slate-400">Net Ledger History</span>
                      <span className="font-semibold text-slate-200">
                        {fmt(recon.netLedgerFlow)}
                      </span>
                    </div>

                    <div className="flex justify-between items-center pt-1 font-semibold">
                      <span className={recon.isReconciled ? 'text-slate-400' : 'text-amber-400'}>
                        Discrepancy (Balance - Flow)
                      </span>
                      <span className={recon.isReconciled ? 'text-emerald-400' : 'text-amber-400'}>
                        {recon.discrepancy > 0 ? '+' : ''}
                        {fmt(recon.discrepancy)}
                      </span>
                    </div>
                  </div>
                );
              })()}

              {/* Data Provenance Details */}
              <div className="p-2.5 rounded-lg bg-slate-800/20 border border-slate-800/80 text-[11px] space-y-1 text-slate-400">
                <div className="font-semibold text-slate-300">Data Provenance:</div>
                <div className="flex justify-between">
                  <span>Record Source:</span>
                  <span className="text-slate-200 capitalize">
                    {selectedHolding.provenance?.source || 'user_entered'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Last Modified:</span>
                  <span className="text-slate-200">
                    {selectedHolding.provenance?.timestamp
                      ? new Date(selectedHolding.provenance.timestamp).toLocaleDateString()
                      : 'Initial Session'}
                  </span>
                </div>
              </div>
            </div>
          )}

          <div className="flex justify-end pt-2 border-t border-slate-800">
            <button
              onClick={onClose}
              className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
