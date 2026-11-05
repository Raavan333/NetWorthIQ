import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Goal } from '../../types';
import { formatMoney } from '../../lib/formatters';
import { Modal } from '../common/Modal';
import { downloadFile } from '../../lib/downloadHelper';
import {
  Trophy,
  CheckCircle2,
  Sparkles,
  Download,
  ArrowRight,
  ShieldCheck,
  Calendar,
  Layers,
} from 'lucide-react';
import { ConfirmGoalPaymentModal } from './ConfirmGoalPaymentModal';

interface GoalReadyNotificationModalProps {
  goal: Goal;
  onClose: () => void;
}

export const GoalReadyNotificationModal: React.FC<GoalReadyNotificationModalProps> = ({
  goal,
  onClose,
}) => {
  const { currencies, holdings } = useApp();
  const [showConfirmPayment, setShowConfirmPayment] = useState(false);
  const [downloadSuccess, setDownloadSuccess] = useState(false);

  const currMap: Record<string, typeof currencies[0]> = {};
  for (const c of currencies) currMap[c.code] = c;
  const goalCurrSym = currMap[goal.currency]?.symbol || goal.currency;

  const handleDownloadCertificate = async () => {
    const lines = [
      '===========================================================',
      '        GOAL FULFILLMENT & READINESS CERTIFICATE',
      '===========================================================',
      `Goal Name:         ${goal.name}`,
      `Purpose:           ${goal.description || 'Target milestone achieved'}`,
      `Target Cost:       ${goal.cost.toLocaleString()} ${goal.currency}`,
      `Accumulated Total: ${(goal.accumulatedTotal || goal.cost).toLocaleString()} ${goal.currency}`,
      `Completion Status: 100% FUNDED & READY TO USE`,
      `Verified At:       ${new Date().toLocaleString()}`,
      `Target Date:       ${goal.deadline || 'Flexible'}`,
      '-----------------------------------------------------------',
      'FUNDING SOURCES CONTRIBUTION BREAKDOWN:',
      ...(goal.sources || []).map((src, idx) => {
        const h = holdings.find((x) => x.id === src.sourceId);
        const name = h ? h.name : src.sourceId;
        const amt = src.accumulatedAmount || (goal.cost * ((src.allocationPct || 0) / 100));
        return `  ${idx + 1}. ${name}: ${src.allocationPct || 0}% (~${amt.toLocaleString()} ${goal.currency})`;
      }),
      '-----------------------------------------------------------',
      'TRANSACTION HISTORY LEDGER ENTRIES:',
      ...(goal.transactions || []).map(
        (t) => `  [${t.date}] ${t.sourceAssetName}: +${t.amount.toLocaleString()} ${goal.currency} (TxID: ${t.ledgerTxId || t.id})`
      ),
      '===========================================================',
      'NetWorthIQ Immutable Double-Entry Ledger Verification',
    ];

    const safeName = goal.name.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    const ok = await downloadFile(`goal_ready_${safeName}.txt`, lines.join('\n'), 'text/plain;charset=utf-8');
    if (ok) {
      setDownloadSuccess(true);
      setTimeout(() => setDownloadSuccess(false), 3000);
    }
  };

  return (
    <>
      <Modal
        isOpen={true}
        onClose={onClose}
        title="Goal Target Reached 100%!"
        subtitle="Funds have accumulated and are ready for use"
        maxWidth="max-w-xl"
      >
        <div className="space-y-5">
          {/* Hero Celebration Card */}
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-950/70 via-slate-900 to-cyan-950/40 border border-emerald-500/40 p-6 shadow-2xl">
            <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none">
              <Trophy size={160} className="text-emerald-300" />
            </div>

            <div className="relative z-10 space-y-4">
              <div className="flex items-center gap-2">
                <span className="p-2 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                  <Sparkles size={20} className="animate-spin-slow" />
                </span>
                <span className="px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-xs font-bold uppercase tracking-wider">
                  100% Target Achieved
                </span>
              </div>

              <div>
                <h3 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2">
                  {goal.name}
                </h3>
                <p className="text-slate-300 text-sm mt-1 leading-relaxed">
                  {goal.description || 'Your allocated contributions have fully reached the target.'}
                </p>
              </div>

              <div className="p-4 rounded-xl bg-slate-950/60 border border-emerald-500/30 flex items-center justify-between">
                <div>
                  <div className="text-xs font-medium text-emerald-400">Total Available Ready Amount</div>
                  <div className="text-2xl font-extrabold text-white font-mono mt-0.5">
                    {formatMoney(goal.cost, goal.currency, goalCurrSym)}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs font-medium text-slate-400">Ledger Status</div>
                  <div className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-400 mt-0.5">
                    <ShieldCheck size={14} /> Ready to Use
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Allocation Sources Breakdown */}
          {goal.sources && goal.sources.length > 0 && (
            <div className="rounded-xl bg-slate-900/60 border border-slate-800 p-4 space-y-2.5">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
                <span className="flex items-center gap-1.5">
                  <Layers size={14} className="text-cyan-400" /> Contributed Assets
                </span>
                <span className="text-slate-400">Breakdown</span>
              </div>
              <div className="space-y-2">
                {goal.sources.map((src, i) => {
                  const h = holdings.find((x) => x.id === src.sourceId);
                  const name = h ? h.name : src.sourceId;
                  const amt = src.accumulatedAmount || (goal.cost * ((src.allocationPct || 0) / 100));
                  return (
                    <div
                      key={i}
                      className="flex items-center justify-between text-xs p-2.5 rounded-lg bg-slate-950/50 border border-slate-800"
                    >
                      <span className="font-medium text-slate-200">{name}</span>
                      <div className="flex items-center gap-2 font-mono">
                        <span className="text-slate-400">{src.allocationPct || 0}%</span>
                        <span className="font-bold text-white">
                          {formatMoney(amt, goal.currency, goalCurrSym)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* User Instructions / Notice */}
          <div className="p-3.5 rounded-xl bg-cyan-950/30 border border-cyan-800/40 text-xs text-cyan-200 leading-relaxed flex items-start gap-2.5">
            <CheckCircle2 size={16} className="text-cyan-400 mt-0.5 shrink-0" />
            <div>
              <strong className="font-semibold text-white">Ready for your defined purpose: </strong>
              The specified amount has been successfully accumulated. You can now execute the payment or purchase, deducting the accumulated amounts from your participating assets and logging an immutable fulfillment record in your double-entry ledger.
            </div>
          </div>

          {/* Action Buttons */}
          <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-3">
            <button
              onClick={handleDownloadCertificate}
              className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <Download size={14} />
              {downloadSuccess ? 'Downloaded!' : 'Download Certificate (.txt)'}
            </button>

            <div className="w-full sm:w-auto flex items-center gap-2">
              <button
                onClick={onClose}
                className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition-colors cursor-pointer"
              >
                Keep in Treasury
              </button>
              <button
                onClick={() => {
                  setShowConfirmPayment(true);
                }}
                className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center justify-center gap-1.5 shadow-lg shadow-emerald-950/40 transition-colors cursor-pointer"
              >
                <span>Use Funds & Fulfill</span>
                <ArrowRight size={14} />
              </button>
            </div>
          </div>
        </div>
      </Modal>

      {/* Nested Confirm Payment Modal if user clicks Use Funds & Fulfill */}
      {showConfirmPayment && (
        <ConfirmGoalPaymentModal
          isOpen={true}
          onClose={() => {
            setShowConfirmPayment(false);
          }}
          goal={goal}
          onSuccess={() => {
            setShowConfirmPayment(false);
            onClose();
          }}
        />
      )}
    </>
  );
};
