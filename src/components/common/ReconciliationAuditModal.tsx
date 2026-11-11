import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { formatMoney } from '../../lib/formatters';
import { downloadFile } from '../../lib/downloadHelper';
import { formatLastDigitsDisplay } from '../../lib/smsEngine';
import {
  ShieldCheck,
  AlertTriangle,
  X,
  CheckCircle2,
  Download,
  Search,
  Filter,
  ArrowUpRight,
  ArrowDownLeft,
  RefreshCw,
  FileText,
  Building2,
  Check,
  RotateCcw,
} from 'lucide-react';

interface ReconciliationAuditModalProps {
  holdingId?: string;
  onClose: () => void;
}

export const ReconciliationAuditModal: React.FC<ReconciliationAuditModalProps> = ({
  holdingId,
  onClose,
}) => {
  const {
    holdings,
    transactions,
    reconcileHoldingBalance,
    updateHolding,
    currencies,
    settings,
  } = useApp();

  const [selectedId, setSelectedId] = useState<string>(
    holdingId || holdings[0]?.id || ''
  );

  React.useEffect(() => {
    if (holdingId) {
      setSelectedId(holdingId);
    } else if (!selectedId && holdings.length > 0) {
      setSelectedId(holdings[0].id);
    }
  }, [holdingId, holdings]);
  const [searchQuery, setSearchQuery] = useState('');
  const [directionFilter, setDirectionFilter] = useState<'all' | 'inflow' | 'outflow'>('all');
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null);

  const selectedHolding = holdings.find((h) => h.id === selectedId) || holdings[0];
  const recon = selectedHolding ? reconcileHoldingBalance(selectedHolding.id) : null;

  const currSymbol = useMemo(() => {
    if (!selectedHolding) return '₹';
    return currencies.find((c) => c.code === selectedHolding.currency)?.symbol || `${selectedHolding.currency} `;
  }, [selectedHolding, currencies]);

  const fmt = (amt: number, dec: number = 2) => {
    if (!selectedHolding) return '';
    return formatMoney(amt, selectedHolding.currency, currSymbol, settings.numberGrouping, dec);
  };

  // Associated transactions for this account
  const accountTransactions = useMemo(() => {
    if (!selectedHolding) return [];
    return transactions
      .filter((t) => t.sourceId === selectedHolding.id || t.fromId === selectedHolding.id || t.toId === selectedHolding.id)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [transactions, selectedHolding]);

  // Filtered transactions by search query and direction
  const filteredTransactions = useMemo(() => {
    return accountTransactions.filter((t) => {
      const isTargetAccount = t.toId === selectedHolding?.id;
      const isSourceAccount = t.sourceId === selectedHolding?.id || t.fromId === selectedHolding?.id;
      const isInflow = isTargetAccount;
      const isOutflow = isSourceAccount;

      if (directionFilter === 'inflow' && !isInflow) return false;
      if (directionFilter === 'outflow' && !isOutflow) return false;

      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        (t.reason || '').toLowerCase().includes(q) ||
        (t.category || '').toLowerCase().includes(q) ||
        (t.date || '').toLowerCase().includes(q) ||
        String(t.amount).includes(q)
      );
    });
  }, [accountTransactions, selectedHolding, directionFilter, searchQuery]);

  // Auto-sync balance to ledger sum if drift detected
  const handleAutoSync = async () => {
    if (!selectedHolding || !recon) return;
    setIsSyncing(true);
    try {
      await updateHolding({
        ...selectedHolding,
        principalOrValue: recon.netLedgerFlow,
        provenance: {
          source: 'verified',
          timestamp: new Date().toISOString(),
        },
      });
      setSyncFeedback('Account balance synchronized with verified ledger history!');
      setTimeout(() => setSyncFeedback(null), 4000);
    } finally {
      setIsSyncing(false);
    }
  };

  // Export official audit report CSV
  const handleExportAuditCsv = () => {
    if (!selectedHolding || !recon) return;
    const header = [
      ['AUDIT REPORT FOR ACCOUNT', selectedHolding.name],
      ['CURRENCY', selectedHolding.currency],
      ['RECORDED BALANCE', String(recon.currentBalance)],
      ['RECORDED INFLOWS', String(recon.recordedInflows)],
      ['RECORDED OUTFLOWS', String(recon.recordedOutflows)],
      ['NET LEDGER FLOW', String(recon.netLedgerFlow)],
      ['DISCREPANCY DELTA', String(recon.discrepancy)],
      ['INVARIANCE STATUS', recon.isReconciled ? 'SYNCHRONIZED' : 'DRIFT DETECTED'],
      ['GENERATED AT', new Date().toISOString()],
      [],
      ['TxID', 'Date', 'Type', 'Description', 'Category', 'Direction', 'Amount', 'Reversed'],
    ];

    const rows = accountTransactions.map((t) => [
      t.id,
      t.date,
      t.kind,
      `"${(t.reason || '').replace(/"/g, '""')}"`,
      `"${(t.category || '').replace(/"/g, '""')}"`,
      t.toId === selectedHolding.id ? 'INFLOW' : 'OUTFLOW',
      String(t.amount),
      t.isReversed ? 'YES' : 'NO',
    ]);

    const csvContent = [...header.map((r) => r.join(',')), ...rows.map((r) => r.join(','))].join('\n');
    downloadFile(
      `audit-ledger-${selectedHolding.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${new Date().toISOString().split('T')[0]}.csv`,
      csvContent,
      'text/csv'
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-3 md:p-6 bg-black/85 backdrop-blur-md animate-fade-in">
      <div className="w-full h-full sm:h-[90vh] max-w-5xl bg-slate-900 border-0 sm:border sm:border-slate-800 sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden text-slate-100">
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3.5 sm:py-4 border-b border-slate-800 bg-slate-900/90 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 sm:p-2.5 rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 shrink-0">
              <ShieldCheck className="w-5 h-5 sm:w-6 sm:h-6" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base sm:text-lg font-bold text-slate-100 truncate">
                  Ledger Reconciliation &amp; Audit Console
                </h2>
                {recon && (
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 ${
                      recon.isReconciled
                        ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-600/30'
                        : 'bg-amber-950/60 text-amber-400 border border-amber-600/30'
                    }`}
                  >
                    {recon.isReconciled ? <CheckCircle2 size={11} /> : <AlertTriangle size={11} />}
                    {recon.isReconciled ? 'Verified Invariant' : 'Ledger Drift'}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 truncate">
                Mathematical invariance check: verifies current vault balance against atomic ledger inflows &amp; outflows
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0 ml-2">
            <button
              onClick={handleExportAuditCsv}
              className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 transition-colors cursor-pointer border border-slate-700"
              title="Download CSV audit report for this account"
            >
              <Download size={13} className="text-indigo-400" />
              <span>Export Audit</span>
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
              aria-label="Close"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Account Selector Strip (Occupies the width cleanly with 1-tap switching) */}
        <div className="px-4 sm:px-6 py-2.5 bg-slate-950/60 border-b border-slate-800 shrink-0">
          <div className="flex items-center justify-between gap-3 mb-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Select Holding to Audit ({holdings.length} Vault Accounts)
            </span>
            <span className="text-[11px] text-slate-500 font-mono">
              Active: {selectedHolding?.name}
            </span>
          </div>

          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-0.5">
            {holdings.map((h) => {
              const isSelected = h.id === selectedId;
              const hRecon = reconcileHoldingBalance(h.id);
              const sym = currencies.find((c) => c.code === h.currency)?.symbol || `${h.currency} `;
              return (
                <button
                  key={h.id}
                  onClick={() => setSelectedId(h.id)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-medium flex items-center gap-2 shrink-0 transition-all cursor-pointer border ${
                    isSelected
                      ? 'bg-indigo-950/60 border-indigo-600/50 text-indigo-200 shadow-sm'
                      : 'bg-slate-900/80 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                  }`}
                >
                  <Building2 size={13} className={isSelected ? 'text-indigo-400' : 'text-slate-500'} />
                  <span className="font-semibold">{h.name}</span>
                  {h.accountLastDigits && (
                    <span className="text-[10px] text-slate-500 font-mono">
                      ({formatLastDigitsDisplay(h.accountLastDigits)})
                    </span>
                  )}
                  <span className="text-slate-300 font-mono">
                    {formatMoney(h.principalOrValue, h.currency, sym, settings.numberGrouping, 0)}
                  </span>
                  {hRecon.isReconciled ? (
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" title="Synchronized" />
                  ) : (
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400" title="Drift detected" />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* 4-Card Invariance Metrics Overview (Occupies the width cleanly) */}
        <div className="px-4 sm:px-6 py-3 bg-slate-900/40 border-b border-slate-800 shrink-0">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3">
            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex flex-col justify-between">
              <span className="text-[11px] text-slate-400 font-medium">Recorded Vault Balance</span>
              <div className="mt-1 flex items-baseline justify-between">
                <span className="text-base sm:text-lg font-bold text-slate-100 font-mono">
                  {recon ? fmt(recon.currentBalance) : '—'}
                </span>
                <span className="text-[10px] text-slate-500">Source of Truth</span>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex flex-col justify-between">
              <span className="text-[11px] text-slate-400 font-medium">Total Recorded Inflows</span>
              <div className="mt-1 flex items-baseline justify-between">
                <span className="text-base sm:text-lg font-bold text-emerald-400 font-mono">
                  +{recon ? fmt(recon.recordedInflows) : '0'}
                </span>
                <span className="text-[10px] text-emerald-500/80 font-medium">Credits</span>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex flex-col justify-between">
              <span className="text-[11px] text-slate-400 font-medium">Total Recorded Outflows</span>
              <div className="mt-1 flex items-baseline justify-between">
                <span className="text-base sm:text-lg font-bold text-rose-400 font-mono">
                  -{recon ? fmt(recon.recordedOutflows) : '0'}
                </span>
                <span className="text-[10px] text-rose-500/80 font-medium">Debits</span>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-slate-400 font-medium">Ledger Discrepancy</span>
                {recon && (
                  <span
                    className={`text-[9px] font-bold px-1.5 py-0.2 rounded-md ${
                      recon.isReconciled ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'
                    }`}
                  >
                    {recon.isReconciled ? 'Exact 0.00' : 'Drift'}
                  </span>
                )}
              </div>
              <div className="mt-1 flex items-baseline justify-between">
                <span
                  className={`text-base sm:text-lg font-bold font-mono ${
                    recon?.isReconciled ? 'text-emerald-400' : 'text-amber-400'
                  }`}
                >
                  {recon ? (recon.discrepancy > 0 ? `+${fmt(recon.discrepancy)}` : fmt(recon.discrepancy)) : '0'}
                </span>
                <span className="text-[10px] text-slate-500 font-mono">
                  Net: {recon ? fmt(recon.netLedgerFlow) : '0'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Main Content Area (Dual Column Responsive Grid) */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            {/* Column 1: Diagnostic Verification & Provenance (lg:col-span-5) */}
            <div className="lg:col-span-5 space-y-4">
              {/* Invariance Check Card */}
              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                    <ShieldCheck size={14} className="text-indigo-400" />
                    Mathematical Invariance Test
                  </span>
                  <span className="text-[10px] text-slate-500 font-mono">
                    Zero-Sum Rule
                  </span>
                </div>

                <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 text-xs space-y-2">
                  <div className="flex justify-between items-center text-slate-400">
                    <span>Recorded Balance</span>
                    <span className="font-mono text-slate-200">{recon ? fmt(recon.currentBalance) : '—'}</span>
                  </div>
                  <div className="flex justify-between items-center text-slate-400">
                    <span>Net Cumulative Flow</span>
                    <span className="font-mono text-slate-200">{recon ? fmt(recon.netLedgerFlow) : '—'}</span>
                  </div>
                  <div className="h-px bg-slate-800" />
                  <div className="flex justify-between items-center font-semibold">
                    <span className={recon?.isReconciled ? 'text-slate-300' : 'text-amber-400'}>
                      Variance / Unaccounted Delta
                    </span>
                    <span className={`font-mono ${recon?.isReconciled ? 'text-emerald-400' : 'text-amber-400'}`}>
                      {recon ? fmt(recon.discrepancy) : '—'}
                    </span>
                  </div>
                </div>

                <p className="text-xs text-slate-400 leading-relaxed">
                  {recon?.message}
                </p>

                {/* Auto-sync button if drift detected */}
                {recon && !recon.isReconciled && (
                  <div className="pt-1">
                    <button
                      onClick={handleAutoSync}
                      disabled={isSyncing}
                      className="w-full py-2 px-3 rounded-xl bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/40 text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer transition-all active:scale-[0.98]"
                    >
                      <RefreshCw size={14} className={isSyncing ? 'animate-spin' : ''} />
                      <span>Synchronize Balance to Verified Ledger ({fmt(recon.netLedgerFlow)})</span>
                    </button>
                    <span className="text-[10px] text-slate-500 block mt-1 text-center">
                      Updates vault holding to match atomic ledger flow without altering past transactions
                    </span>
                  </div>
                )}

                {syncFeedback && (
                  <div className="p-2.5 rounded-lg bg-emerald-950/40 border border-emerald-600/40 text-emerald-300 text-xs flex items-center gap-2">
                    <Check size={14} className="text-emerald-400 shrink-0" />
                    <span>{syncFeedback}</span>
                  </div>
                )}
              </div>

              {/* Data Provenance & Holding Details Card */}
              {selectedHolding && (
                <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                    <FileText size={14} className="text-cyan-400" />
                    Account Provenance &amp; Configuration
                  </span>

                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between py-1 border-b border-slate-800/80">
                      <span className="text-slate-400">Account Name</span>
                      <span className="font-medium text-slate-200">{selectedHolding.name}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-800/80">
                      <span className="text-slate-400">Account Last Digits</span>
                      <span className="font-mono text-cyan-300">
                        {selectedHolding.accountLastDigits
                          ? formatLastDigitsDisplay(selectedHolding.accountLastDigits)
                          : 'Not Configured'}
                      </span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-800/80">
                      <span className="text-slate-400">Liquidity Class</span>
                      <span className="font-medium text-slate-200">{selectedHolding.liquidityClass}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-800/80">
                      <span className="text-slate-400">Origin / Provenance</span>
                      <span className="capitalize font-mono text-slate-300">
                        {selectedHolding.provenance?.source || 'user_entered'}
                      </span>
                    </div>
                    <div className="flex justify-between py-1">
                      <span className="text-slate-400">Total Account Transactions</span>
                      <span className="font-mono text-slate-200">{accountTransactions.length} items</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Column 2: Interactive Filterable Audited Ledger (lg:col-span-7) */}
            <div className="lg:col-span-7 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                    Audited Account Ledger ({filteredTransactions.length} records)
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Itemized debits, credits, and inter-account transfers tied to {selectedHolding?.name}
                  </p>
                </div>

                {/* Filters */}
                <div className="flex items-center gap-1.5 self-start sm:self-auto">
                  <div className="relative">
                    <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
                    <input
                      type="text"
                      placeholder="Search transactions..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-7 pr-2.5 py-1 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500 w-36 sm:w-44"
                    />
                  </div>

                  <div className="flex bg-slate-950 border border-slate-800 rounded-lg p-0.5">
                    <button
                      onClick={() => setDirectionFilter('all')}
                      className={`px-2 py-0.5 text-[10px] font-semibold rounded-md transition-colors ${
                        directionFilter === 'all'
                          ? 'bg-slate-800 text-slate-100 shadow-xs'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      All
                    </button>
                    <button
                      onClick={() => setDirectionFilter('inflow')}
                      className={`px-2 py-0.5 text-[10px] font-semibold rounded-md transition-colors ${
                        directionFilter === 'inflow'
                          ? 'bg-emerald-950/80 text-emerald-300 shadow-xs'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Inflows
                    </button>
                    <button
                      onClick={() => setDirectionFilter('outflow')}
                      className={`px-2 py-0.5 text-[10px] font-semibold rounded-md transition-colors ${
                        directionFilter === 'outflow'
                          ? 'bg-rose-950/80 text-rose-300 shadow-xs'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Outflows
                    </button>
                  </div>
                </div>
              </div>

              {/* Transactions List */}
              <div className="rounded-xl border border-slate-800 bg-slate-950 divide-y divide-slate-850 overflow-hidden max-h-[460px] overflow-y-auto">
                {filteredTransactions.length === 0 ? (
                  <div className="p-8 text-center space-y-2">
                    <p className="text-xs text-slate-400">
                      {accountTransactions.length === 0
                        ? 'No ledger transactions recorded for this account yet.'
                        : 'No transactions match your current search or direction filter.'}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      Inflows and outflows automatically log here via on-device SMS parsing, transfers, or manual spend entries.
                    </p>
                  </div>
                ) : (
                  filteredTransactions.map((tx) => {
                    const isTargetAccount = tx.toId === selectedHolding?.id;
                    const isInflow = isTargetAccount;

                    return (
                      <div
                        key={tx.id}
                        className="p-3 hover:bg-slate-900/60 transition-colors flex items-center justify-between gap-3 text-xs"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div
                            className={`p-2 rounded-xl shrink-0 ${
                              isInflow
                                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                            }`}
                          >
                            {isInflow ? <ArrowDownLeft size={14} /> : <ArrowUpRight size={14} />}
                          </div>

                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-semibold text-slate-200 truncate">
                                {tx.reason || tx.category || 'Transaction'}
                              </span>
                              {tx.isReversed && (
                                <span className="px-1.5 py-0.2 rounded-md bg-amber-500/20 text-amber-300 text-[9px] font-bold">
                                  Reversed
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 text-[10px] text-slate-500 mt-0.5">
                              <span>{tx.date}</span>
                              <span>•</span>
                              <span>{tx.category || 'General'}</span>
                              {tx.smsMetadata?.accountLastDigits && (
                                <>
                                  <span>•</span>
                                  <span className="font-mono text-cyan-400/80">
                                    ··{tx.smsMetadata.accountLastDigits}
                                  </span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="text-right shrink-0">
                          <span
                            className={`font-mono font-bold text-xs sm:text-sm ${
                              isInflow ? 'text-emerald-400' : 'text-slate-200'
                            }`}
                          >
                            {isInflow ? '+' : '-'}
                            {formatMoney(tx.amount, tx.currency || selectedHolding?.currency || 'INR', currSymbol, settings.numberGrouping, 2)}
                          </span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 sm:px-6 py-3 border-t border-slate-800 bg-slate-900/90 flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
          <div className="text-[11px] text-slate-400 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <span>Audit engine uses strict mathematical invariance (0 floating drift tolerance).</span>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            <button
              onClick={handleExportAuditCsv}
              className="sm:hidden flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 transition-colors cursor-pointer border border-slate-700 flex-1"
            >
              <Download size={13} className="text-indigo-400" />
              <span>Export CSV</span>
            </button>
            <button
              onClick={onClose}
              className="px-5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition-colors cursor-pointer border border-slate-700 flex-1 sm:flex-none text-center"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

