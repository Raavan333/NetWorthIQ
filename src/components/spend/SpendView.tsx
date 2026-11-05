import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { QuickAddSpendGrid } from './QuickAddSpendGrid';
import { BillsManager } from './BillsManager';
import { SpendHistory } from './SpendHistory';
import { TransferModal } from './TransferModal';
import { BulkImportModal } from './BulkImportModal';
import { AnomalyReviewDrawer } from './AnomalyReviewDrawer';
import { SmsIngestionModal } from './SmsIngestionModal';
import {
  ArrowLeftRight,
  Upload,
  Receipt,
  Clock,
  ListPlus,
  ShieldAlert,
  MessageSquareText,
} from 'lucide-react';

export const SpendView: React.FC = () => {
  const { anomalies, smsStagingQueue } = useApp();
  const [activeSubTab, setActiveSubTab] = useState<'quick' | 'bills' | 'history'>('quick');
  const [isTransferOpen, setIsTransferOpen] = useState(false);
  const [isBulkImportOpen, setIsBulkImportOpen] = useState(false);
  const [isSmsModalOpen, setIsSmsModalOpen] = useState(false);
  const [isAnomalyDrawerOpen, setIsAnomalyDrawerOpen] = useState(false);

  const stagedSmsCount = smsStagingQueue.filter((s) => s.status === 'staged').length;

  return (
    <div className="space-y-4 pb-20 animate-fade-in">
      {/* Top Header & Fast Action Triggers */}
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">Spending & Cash Flow</h2>
          <p className="text-xs text-slate-400">
            Multi-row quick capture, recurring commitments, and account transfers
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setIsSmsModalOpen(true)}
            className="px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 hover:bg-slate-800 text-xs font-semibold text-slate-200 flex items-center gap-1.5 cursor-pointer shadow-sm"
          >
            <MessageSquareText size={15} className="text-emerald-400" />
            <span>
              SMS Capture{stagedSmsCount > 0 ? ` (${stagedSmsCount})` : ''}
            </span>
          </button>

          <button
            onClick={() => setIsTransferOpen(true)}
            className="px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 hover:bg-slate-800 text-xs font-semibold text-slate-200 flex items-center gap-1.5 cursor-pointer shadow-sm"
          >
            <ArrowLeftRight size={15} className="text-cyan-400" />
            <span>Transfer</span>
          </button>

          <button
            onClick={() => setIsBulkImportOpen(true)}
            className="px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 hover:bg-slate-800 text-xs font-semibold text-slate-200 flex items-center gap-1.5 cursor-pointer shadow-sm"
          >
            <Upload size={15} className="text-emerald-400" />
            <span>Import CSV/JSON</span>
          </button>
        </div>
      </div>

      {/* Financial Anomaly Alert (Only rendered if anomalies detected) */}
      {anomalies.length > 0 && (
        <button
          onClick={() => setIsAnomalyDrawerOpen(true)}
          className="w-full p-2.5 rounded-xl bg-amber-950/40 border border-amber-800/40 hover:bg-amber-900/40 text-amber-300 text-xs font-semibold flex items-center justify-between transition cursor-pointer shadow-xs"
        >
          <div className="flex items-center gap-2">
            <ShieldAlert size={15} className="text-amber-400 shrink-0" />
            <span>
              {anomalies.length} Financial {anomalies.length === 1 ? 'Anomaly' : 'Anomalies'} Flagged for Review
            </span>
          </div>
          <span className="text-[11px] underline">Review & Actions →</span>
        </button>
      )}

      {/* Sub Tabs */}
      <div className="flex bg-slate-950 p-1 rounded-2xl border border-slate-800 text-xs font-semibold">
        <button
          onClick={() => setActiveSubTab('quick')}
          className={`flex-1 py-2 rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
            activeSubTab === 'quick'
              ? 'bg-slate-800 text-white shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <ListPlus size={14} className="text-emerald-400" />
          <span>Quick Add (Multi-Row)</span>
        </button>

        <button
          onClick={() => setActiveSubTab('bills')}
          className={`flex-1 py-2 rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
            activeSubTab === 'bills'
              ? 'bg-slate-800 text-white shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Receipt size={14} className="text-amber-400" />
          <span>Recurring Bills</span>
        </button>

        <button
          onClick={() => setActiveSubTab('history')}
          className={`flex-1 py-2 rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
            activeSubTab === 'history'
              ? 'bg-slate-800 text-white shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Clock size={14} className="text-cyan-400" />
          <span>Ledger History</span>
        </button>
      </div>

      {/* Sub Tab Content */}
      {activeSubTab === 'quick' && <QuickAddSpendGrid />}
      {activeSubTab === 'bills' && <BillsManager />}
      {activeSubTab === 'history' && <SpendHistory />}

      {/* Modals */}
      {isSmsModalOpen && (
        <SmsIngestionModal
          isOpen={isSmsModalOpen}
          onClose={() => setIsSmsModalOpen(false)}
        />
      )}

      {isTransferOpen && (
        <TransferModal
          isOpen={isTransferOpen}
          onClose={() => setIsTransferOpen(false)}
        />
      )}

      {isBulkImportOpen && (
        <BulkImportModal
          isOpen={isBulkImportOpen}
          onClose={() => setIsBulkImportOpen(false)}
        />
      )}

      {isAnomalyDrawerOpen && (
        <AnomalyReviewDrawer
          onClose={() => setIsAnomalyDrawerOpen(false)}
        />
      )}
    </div>
  );
};
