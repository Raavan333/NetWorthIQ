import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { SmsFlagReason, Transaction, StagedSmsItem, SmsParsedTxKind } from '../../types';
import { formatMoney } from '../../lib/formatters';
import {
  Search,
  Trash2,
  ArrowUpRight,
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpDown,
  Download,
  Copy,
  Check,
  Flag,
  X,
  Calendar,
  Filter,
  RotateCcw,
  MessageSquareText,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  AlertTriangle,
  Plus,
} from 'lucide-react';
import { exportTransactionsToCsv } from '../../lib/csvHelper';
import { downloadFile, copyTextToClipboard } from '../../lib/downloadHelper';
import { ExportDownloadModal } from '../common/ExportDownloadModal';
import { TransactionReversalModal } from './TransactionReversalModal';

type DatePreset =
  | 'all'
  | 'today'
  | 'yesterday'
  | 'this_week'
  | 'this_month'
  | 'last_month'
  | 'last_30_days'
  | 'last_90_days'
  | 'custom';

type TxTypeFilter = 'ALL' | 'spend' | 'income' | 'transfer' | 'cardPayment' | 'emi';

export type LedgerSortOption =
  | 'time_desc' // Latest First (Descending) - DEFAULT
  | 'time_asc'  // Oldest First (Ascending)
  | 'amount_desc' // Amount: Highest First
  | 'amount_asc'; // Amount: Lowest First

/**
 * Extracts precise epoch timestamp in milliseconds for accurate sub-day descending sorting.
 */
export function getTxTimestampMs(t: Transaction): number {
  const smsMeta = t.smsMetadata as Record<string, unknown> | undefined;
  if (smsMeta && typeof smsMeta.receivedTimestampMs === 'number' && Number.isFinite(smsMeta.receivedTimestampMs)) {
    return smsMeta.receivedTimestampMs;
  }
  if (t.createdAt) {
    const ms = new Date(t.createdAt).getTime();
    if (!isNaN(ms) && ms > 0) return ms;
  }
  if (t.provenance?.timestamp) {
    const ms = new Date(t.provenance.timestamp).getTime();
    if (!isNaN(ms) && ms > 0) return ms;
  }
  const match = t.id.match(/(\d{13})/);
  if (match) {
    const ms = Number(match[1]);
    if (!isNaN(ms) && ms > 1500000000000) return ms;
  }
  if (t.date) {
    const ms = new Date(t.date).getTime();
    if (!isNaN(ms) && ms > 0) return ms;
  }
  return 0;
}

export const SpendHistory: React.FC = () => {
  const {
    transactions,
    holdings,
    liabilities,
    currencies,
    spendCategories,
    smsStagingQueue,
    updateTransaction,
    flagSmsTransaction,
    commitStagedSmsItem,
    discardStagedSmsItem,
    ingestSmsMessages,
    settings,
  } = useApp();

  // Search & Filter State
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [sourceFilter, setSourceFilter] = useState('ALL');
  const [typeFilter, setTypeFilter] = useState<TxTypeFilter>('ALL');
  const [datePreset, setDatePreset] = useState<DatePreset>('all');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [sortBy, setSortBy] = useState<LedgerSortOption>('time_desc');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

  // Clipboard & Modal State
  const [copiedJson, setCopiedJson] = useState(false);
  const [reversalTargetTx, setReversalTargetTx] = useState<Transaction | null>(null);

  // Review Queue State inside Ledger
  const [isQueueCollapsed, setIsQueueCollapsed] = useState(false);
  const [rejectingItem, setRejectingItem] = useState<StagedSmsItem | null>(null);
  const [rejectionReasonChoice, setRejectionReasonChoice] = useState('invalid_message');
  const [customRejectionText, setCustomRejectionText] = useState('');
  const [isSubmittingRejection, setIsSubmittingRejection] = useState(false);

  // Quick SMS Paste Modal State
  const [isQuickPasteOpen, setIsQuickPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [isParsingPaste, setIsParsingPaste] = useState(false);
  const [pasteMessage, setPasteMessage] = useState<string | null>(null);

  // Inline reason & category editing state
  const [editingCategoryTxId, setEditingCategoryTxId] = useState<string | null>(null);
  const [categoryDraft, setCategoryDraft] = useState('');
  const [savingCategory, setSavingCategory] = useState(false);

  const [editingReasonTxId, setEditingReasonTxId] = useState<string | null>(null);
  const [reasonDraft, setReasonDraft] = useState('');
  const [savingReason, setSavingReason] = useState(false);

  // SMS Flag / Rollback modal state
  const [flagTargetTx, setFlagTargetTx] = useState<Transaction | null>(null);
  const [flagReason, setFlagReason] = useState<SmsFlagReason>('never_occurred');
  const [replacementSourceId, setReplacementSourceId] = useState('');
  const [flagError, setFlagError] = useState<string | null>(null);
  const [submittingFlag, setSubmittingFlag] = useState(false);

  // Export Modal State
  const [exportModal, setExportModal] = useState<{
    isOpen: boolean;
    title: string;
    filename: string;
    content: string;
    mimeType: string;
  } | null>(null);

  const currMap: Record<string, (typeof currencies)[0]> = {};
  for (const c of currencies) currMap[c.code] = c;
  const baseCurrency = settings.baseCurrency || 'INR';

  const allSources = [
    ...holdings.map((h) => ({
      id: h.id,
      name: `${h.name}${h.accountLastDigits ? ` (··${h.accountLastDigits})` : ''}`,
      rawName: h.name,
      lastDigits: h.accountLastDigits,
    })),
    ...liabilities.map((l) => ({
      id: l.id,
      name: `${l.name}${l.accountLastDigits ? ` (··${l.accountLastDigits})` : ''} · ${
        l.kind === 'card' ? 'Card' : 'Loan'
      }`,
      rawName: l.name,
      lastDigits: l.accountLastDigits,
    })),
  ];
  const sourceNameMap = new Map(allSources.map((s) => [s.id, s.name]));

  // Pending items in temporary SMS review queue
  const pendingStaged = useMemo(
    () => smsStagingQueue.filter((s) => s.status === 'staged'),
    [smsStagingQueue]
  );

  // Unique categories across ledger + configured spend categories
  const categoryOptions = Array.from(
    new Set([
      ...spendCategories.map((c) => c.name),
      ...transactions.map((t) => t.category).filter(Boolean),
    ])
  );

  // Calculate Date Bounds for Active Preset
  const { filterStartDate, filterEndDate } = useMemo(() => {
    if (datePreset === 'all') {
      return { filterStartDate: null, filterEndDate: null };
    }
    if (datePreset === 'custom') {
      return {
        filterStartDate: customStartDate || null,
        filterEndDate: customEndDate || null,
      };
    }

    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];

    if (datePreset === 'today') {
      return { filterStartDate: todayStr, filterEndDate: todayStr };
    }

    if (datePreset === 'yesterday') {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      const yStr = y.toISOString().split('T')[0];
      return { filterStartDate: yStr, filterEndDate: yStr };
    }

    if (datePreset === 'this_week') {
      const w = new Date(now);
      w.setDate(w.getDate() - 7);
      return { filterStartDate: w.toISOString().split('T')[0], filterEndDate: todayStr };
    }

    if (datePreset === 'this_month') {
      const firstDay = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
      return { filterStartDate: firstDay, filterEndDate: todayStr };
    }

    if (datePreset === 'last_month') {
      const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastDayOfPrevMonth = new Date(now.getFullYear(), now.getMonth(), 0);
      return {
        filterStartDate: prevMonth.toISOString().split('T')[0],
        filterEndDate: lastDayOfPrevMonth.toISOString().split('T')[0],
      };
    }

    if (datePreset === 'last_30_days') {
      const d30 = new Date(now);
      d30.setDate(d30.getDate() - 30);
      return { filterStartDate: d30.toISOString().split('T')[0], filterEndDate: todayStr };
    }

    if (datePreset === 'last_90_days') {
      const d90 = new Date(now);
      d90.setDate(d90.getDate() - 90);
      return { filterStartDate: d90.toISOString().split('T')[0], filterEndDate: todayStr };
    }

    return { filterStartDate: null, filterEndDate: null };
  }, [datePreset, customStartDate, customEndDate]);

  // Filter & Sort Transactions: strictly sorted by latest timestamp descending
  const sortedAndFiltered = useMemo(() => {
    const searchLower = search.trim().toLowerCase();

    const filtered = transactions.filter((t) => {
      // 1. Text Search
      if (searchLower) {
        const matchesReason = (t.reason || '').toLowerCase().includes(searchLower);
        const matchesCategory = (t.category || '').toLowerCase().includes(searchLower);
        const matchesNotes = (t.notes || '').toLowerCase().includes(searchLower);
        const matchesMerchant = (t.smsMetadata?.merchantName || '').toLowerCase().includes(searchLower);
        const matchesRef = (t.smsMetadata?.refId || '').toLowerCase().includes(searchLower);
        const matchesCounterparty = (t.smsMetadata?.rawCounterparty || '').toLowerCase().includes(searchLower);
        if (
          !matchesReason &&
          !matchesCategory &&
          !matchesNotes &&
          !matchesMerchant &&
          !matchesRef &&
          !matchesCounterparty
        ) {
          return false;
        }
      }

      // 2. Category
      if (categoryFilter !== 'ALL' && t.category !== categoryFilter) {
        return false;
      }

      // 3. Source Account
      if (sourceFilter !== 'ALL' && t.fromId !== sourceFilter && t.toId !== sourceFilter) {
        return false;
      }

      // 4. Transaction Type
      if (typeFilter !== 'ALL') {
        if (typeFilter === 'spend') {
          if (t.kind !== 'spend') return false;
        } else if (typeFilter === 'income') {
          if (t.kind !== 'income' && t.kind !== 'dividend' && t.kind !== 'saleProceeds') return false;
        } else if (typeFilter === 'transfer') {
          if (t.kind !== 'transfer') return false;
        } else if (typeFilter === 'cardPayment') {
          if (t.kind !== 'cardPayment') return false;
        } else if (typeFilter === 'emi') {
          if (t.kind !== 'emi') return false;
        }
      }

      // 5. Timestamp / Date Range Filter
      if (filterStartDate && t.date < filterStartDate) {
        return false;
      }
      if (filterEndDate && t.date > filterEndDate) {
        return false;
      }

      return true;
    });

    // Strictly sort according to selected sortBy option (default: latest timestamp descending)
    return filtered.sort((a, b) => {
      if (sortBy === 'time_desc') {
        // 1. Precise epoch ms descending (latest on top)
        const msA = getTxTimestampMs(a);
        const msB = getTxTimestampMs(b);
        if (msA !== msB) {
          return msB - msA;
        }
        // 2. Date string descending
        if (a.date !== b.date) {
          return b.date.localeCompare(a.date);
        }
        // 3. createdAt string descending
        if (a.createdAt && b.createdAt && a.createdAt !== b.createdAt) {
          return b.createdAt.localeCompare(a.createdAt);
        }
        // 4. Fallback id descending
        return b.id.localeCompare(a.id);
      }

      if (sortBy === 'time_asc') {
        const msA = getTxTimestampMs(a);
        const msB = getTxTimestampMs(b);
        if (msA !== msB) {
          return msA - msB;
        }
        if (a.date !== b.date) {
          return a.date.localeCompare(b.date);
        }
        if (a.createdAt && b.createdAt && a.createdAt !== b.createdAt) {
          return a.createdAt.localeCompare(b.createdAt);
        }
        return a.id.localeCompare(b.id);
      }

      if (sortBy === 'amount_desc') {
        if (b.amount !== a.amount) {
          return b.amount - a.amount;
        }
        const msA = getTxTimestampMs(a);
        const msB = getTxTimestampMs(b);
        return msB - msA;
      }

      if (sortBy === 'amount_asc') {
        if (a.amount !== b.amount) {
          return a.amount - b.amount;
        }
        const msA = getTxTimestampMs(a);
        const msB = getTxTimestampMs(b);
        return msB - msA;
      }

      return 0;
    });
  }, [
    transactions,
    search,
    categoryFilter,
    sourceFilter,
    typeFilter,
    filterStartDate,
    filterEndDate,
    sortBy,
  ]);

  // Has active filters applied
  const hasActiveFilters =
    search.trim() !== '' ||
    categoryFilter !== 'ALL' ||
    sourceFilter !== 'ALL' ||
    typeFilter !== 'ALL' ||
    datePreset !== 'all' ||
    Boolean(customStartDate) ||
    Boolean(customEndDate) ||
    sortBy !== 'time_desc';

  const handleResetFilters = () => {
    setSearch('');
    setCategoryFilter('ALL');
    setSourceFilter('ALL');
    setTypeFilter('ALL');
    setDatePreset('all');
    setCustomStartDate('');
    setCustomEndDate('');
    setSortBy('time_desc');
  };

  // Export that VERY SET of filtered transactions
  const handleExportTransactions = () => {
    const today = new Date().toISOString().split('T')[0];
    const csvContent = exportTransactionsToCsv(sortedAndFiltered, holdings, liabilities);
    const filename = `networthiq_ledger_filtered_${today}.csv`;
    downloadFile(filename, csvContent, 'text/csv');
    setExportModal({
      isOpen: true,
      title: 'Export Filtered Ledger (CSV)',
      filename,
      content: csvContent,
      mimeType: 'text/csv',
    });
  };

  const handleCopyLedgerJson = async () => {
    const jsonContent = JSON.stringify(sortedAndFiltered, null, 2);
    const ok = await copyTextToClipboard(jsonContent);
    if (ok) {
      setCopiedJson(true);
      setTimeout(() => setCopiedJson(false), 2500);
    } else {
      const today = new Date().toISOString().split('T')[0];
      setExportModal({
        isOpen: true,
        title: 'Filtered Ledger Transactions (JSON)',
        filename: `networthiq_ledger_filtered_${today}.json`,
        content: jsonContent,
        mimeType: 'application/json',
      });
    }
  };

  // Inline Reason & Category Edits
  const startEditingCategory = (tx: Transaction) => {
    if (tx.isReversed) return;
    setEditingCategoryTxId(tx.id);
    setCategoryDraft(tx.category || '');
  };

  const commitCategoryChange = async (tx: Transaction) => {
    const cleaned = categoryDraft.trim();
    if (!cleaned || cleaned === tx.category) {
      setEditingCategoryTxId(null);
      return;
    }
    setSavingCategory(true);
    try {
      await updateTransaction({
        ...tx,
        category: cleaned,
      });
    } finally {
      setSavingCategory(false);
      setEditingCategoryTxId(null);
    }
  };

  const startEditingReason = (tx: Transaction) => {
    if (tx.isReversed) return;
    setEditingReasonTxId(tx.id);
    setReasonDraft(tx.reason || '');
  };

  const commitReasonChange = async (tx: Transaction) => {
    const cleaned = reasonDraft.trim();
    if (!cleaned || cleaned === tx.reason) {
      setEditingReasonTxId(null);
      return;
    }
    setSavingReason(true);
    try {
      await updateTransaction({
        ...tx,
        reason: cleaned,
      });
    } finally {
      setSavingReason(false);
      setEditingReasonTxId(null);
    }
  };

  // Flag faulty SMS transaction
  const openFlagModal = (tx: Transaction) => {
    setFlagTargetTx(tx);
    setFlagReason('never_occurred');
    setReplacementSourceId('');
    setFlagError(null);
  };

  const submitFlagFeedback = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!flagTargetTx) return;
    setSubmittingFlag(true);
    setFlagError(null);
    try {
      const res = await flagSmsTransaction(
        flagTargetTx.id,
        flagReason,
        flagReason === 'wrong_source' ? replacementSourceId || undefined : undefined
      );
      if (!res.success) {
        setFlagError(res.error || 'Could not flag transaction.');
        return;
      }
      setFlagTargetTx(null);
    } finally {
      setSubmittingFlag(false);
    }
  };

  // Handle Verify & Add Staged SMS Item
  const handleVerifyStagedItem = async (stagingId: string) => {
    await commitStagedSmsItem(stagingId);
  };

  // Open Rejection Dialog for Staged SMS Item
  const openRejectionDialog = (item: StagedSmsItem) => {
    setRejectingItem(item);
    setRejectionReasonChoice('invalid_message');
    setCustomRejectionText('');
  };

  // Submit Rejection: Trains ML model and removes item from queue
  const submitRejection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectingItem) return;

    let finalReasonText = '';
    if (rejectionReasonChoice === 'invalid_message') {
      finalReasonText = 'Invalid or non-financial message (OTP, security, promotional offer)';
    } else if (rejectionReasonChoice === 'wrong_amount') {
      finalReasonText = 'Incorrect transaction amount parsed';
    } else if (rejectionReasonChoice === 'wrong_source') {
      finalReasonText = 'Wrong bank account or card matched';
    } else if (rejectionReasonChoice === 'duplicate') {
      finalReasonText = 'Duplicate transaction';
    } else if (rejectionReasonChoice === 'cancelled') {
      finalReasonText = 'Transaction failed or was cancelled';
    } else {
      finalReasonText = customRejectionText.trim() || 'Invalid message';
    }

    setIsSubmittingRejection(true);
    try {
      await discardStagedSmsItem(rejectingItem.id, finalReasonText);
      setRejectingItem(null);
    } finally {
      setIsSubmittingRejection(false);
    }
  };

  // Quick Parse SMS Input
  const handleQuickParseSms = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pasteText.trim()) return;
    setIsParsingPaste(true);
    setPasteMessage(null);
    try {
      const res = await ingestSmsMessages(pasteText.trim(), false);
      setPasteText('');
      setPasteMessage(
        `Parsed successfully: ${res.stagedCount} item(s) placed in review queue${
          res.droppedNoiseCount > 0 ? `, ${res.droppedNoiseCount} non-financial message(s) skipped` : ''
        }.`
      );
      setTimeout(() => {
        setIsQuickPasteOpen(false);
        setPasteMessage(null);
      }, 1800);
    } catch {
      setPasteMessage('Unable to parse SMS text. Please check format.');
    } finally {
      setIsParsingPaste(false);
    }
  };

  return (
    <div className="space-y-3.5">
      {/* TEMPORARY SMS REVIEW QUEUE (Visible right in the Ledger when items are pending) */}
      {pendingStaged.length > 0 && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/90 overflow-hidden shadow-sm">
          <div className="p-3.5 flex items-center justify-between border-b border-slate-800/60 bg-slate-950/60">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-400">
                <MessageSquareText size={15} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-white tracking-tight">
                    SMS Review Queue
                  </span>
                  <span className="px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 font-mono text-[10px] font-semibold">
                    {pendingStaged.length} Pending
                  </span>
                </div>
                <p className="text-[11px] text-slate-400">
                  Verify extracted transactions or reject to train the on-device parser
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsQuickPasteOpen(true)}
                className="px-2.5 py-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-800 text-[11px] font-medium text-slate-300 flex items-center gap-1 cursor-pointer transition-colors"
                title="Paste a bank/card SMS directly to parse"
              >
                <Plus size={12} className="text-emerald-400" />
                <span>Paste SMS</span>
              </button>
              <button
                type="button"
                onClick={() => setIsQueueCollapsed(!isQueueCollapsed)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
                title={isQueueCollapsed ? 'Expand Review Queue' : 'Collapse Review Queue'}
              >
                {isQueueCollapsed ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
              </button>
            </div>
          </div>

          {!isQueueCollapsed && (
            <div className="divide-y divide-slate-800/60 max-h-[380px] overflow-y-auto">
              {pendingStaged.map((item) => {
                const sym = currMap[item.currency]?.symbol || item.currency;
                const isDebit = item.direction === 'debit';
                const matchedSource = item.matchedSourceId
                  ? sourceNameMap.get(item.matchedSourceId)
                  : item.accountLastDigits
                  ? `Card / Account ending ··${item.accountLastDigits}`
                  : 'Source Unmatched';

                return (
                  <div
                    key={item.id}
                    className="p-3.5 hover:bg-slate-800/20 transition-colors flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs"
                  >
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <div
                        className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
                          isDebit
                            ? 'bg-rose-500/10 text-rose-400'
                            : 'bg-emerald-500/10 text-emerald-400'
                        }`}
                      >
                        {isDebit ? <ArrowDownLeft size={16} /> : <ArrowUpRight size={16} />}
                      </div>

                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-white truncate text-sm">
                            {item.merchantName || 'SMS Transaction'}
                          </span>
                          <span className="text-[11px] text-slate-400">
                            {item.matchedCategory || 'General'}
                          </span>
                          {item.accountLastDigits && (
                            <>
                              <span className="text-slate-600">·</span>
                              <span className="text-[11px] font-mono text-cyan-400">
                                ··{item.accountLastDigits}
                              </span>
                            </>
                          )}
                        </div>

                        <div className="flex items-center gap-2 text-[11px] text-slate-400 flex-wrap">
                          <span>
                            Source: <strong className="text-slate-300">{matchedSource}</strong>
                          </span>
                          <span>•</span>
                          <span>
                            Date: <strong className="text-slate-300">{item.parsedDate}</strong>
                          </span>
                          {item.refId && (
                            <>
                              <span>•</span>
                              <span className="font-mono">Ref: {item.refId}</span>
                            </>
                          )}
                        </div>

                        {item.reviewHint && (
                          <div className="text-[11px] text-amber-300/90 flex items-center gap-1 pt-0.5">
                            <AlertTriangle size={12} className="shrink-0 text-amber-400" />
                            <span className="truncate">{item.reviewHint}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-end shrink-0 pt-1 sm:pt-0">
                      <div className="text-right">
                        <div
                          className={`text-sm font-bold font-mono ${
                            isDebit ? 'text-rose-400' : 'text-emerald-400'
                          }`}
                        >
                          {isDebit ? '-' : '+'}
                          {formatMoney(item.amount, item.currency, sym)}
                        </div>
                        <div className="text-[10px] text-slate-500 capitalize">
                          {item.txKind || item.direction}
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => openRejectionDialog(item)}
                          className="px-2.5 py-1.5 rounded-xl border border-slate-800 bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-rose-300 text-xs font-semibold cursor-pointer transition-colors"
                          title="Reject and delete this message (trains ML parser)"
                        >
                          Reject
                        </button>

                        <button
                          type="button"
                          onClick={() => handleVerifyStagedItem(item.id)}
                          className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1 cursor-pointer transition-colors shadow-xs"
                          title="Verify and post into ledger"
                        >
                          <CheckCircle2 size={13} />
                          <span>Verify</span>
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* LEDGER FILTER & ACTION BAR */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-3 space-y-2.5 shadow-sm">
        {/* Top Filter Row: Search, Date Preset, Type Selector, Actions */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 flex-1 min-w-[300px]">
            {/* Search Input */}
            <div className="relative sm:col-span-4">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
              />
              <input
                type="text"
                placeholder="Search ledger (reason, ref, merchant)..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-8 pr-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 p-0.5"
                >
                  <X size={12} />
                </button>
              )}
            </div>

            {/* Timestamp / Date Preset Selector */}
            <div className="sm:col-span-3">
              <div className="relative">
                <Calendar
                  size={14}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none"
                />
                <select
                  value={datePreset}
                  onChange={(e) => setDatePreset(e.target.value as DatePreset)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-8 pr-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 cursor-pointer"
                >
                  <option value="all">All Dates / All Time</option>
                  <option value="today">Today</option>
                  <option value="yesterday">Yesterday</option>
                  <option value="this_week">This Week (Last 7 Days)</option>
                  <option value="this_month">This Month</option>
                  <option value="last_month">Last Month</option>
                  <option value="last_30_days">Last 30 Days</option>
                  <option value="last_90_days">Last 90 Days</option>
                  <option value="custom">Custom Date Range...</option>
                </select>
              </div>
            </div>

            {/* Transaction Type Filter */}
            <div className="sm:col-span-2">
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value as TxTypeFilter)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 cursor-pointer"
              >
                <option value="ALL">All Types</option>
                <option value="spend">Spends / Debits</option>
                <option value="income">Income / Credits</option>
                <option value="transfer">Transfers</option>
                <option value="cardPayment">Card Payments</option>
                <option value="emi">Loan EMIs</option>
              </select>
            </div>

            {/* Sort Order Filter (Default: Latest First / Descending) */}
            <div className="sm:col-span-3">
              <div className="relative">
                <ArrowUpDown
                  size={14}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none"
                />
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as LedgerSortOption)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-8 pr-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 cursor-pointer"
                  title="Sort transactions (default: latest timestamp descending)"
                >
                  <option value="time_desc">Time: Latest First (Desc)</option>
                  <option value="time_asc">Time: Oldest First (Asc)</option>
                  <option value="amount_desc">Amount: Highest First</option>
                  <option value="amount_asc">Amount: Lowest First</option>
                </select>
              </div>
            </div>
          </div>

          {/* Action Buttons: Toggle More Filters, Copy JSON, Download CSV */}
          <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
            <button
              type="button"
              onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
              className={`px-2.5 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors ${
                showAdvancedFilters || categoryFilter !== 'ALL' || sourceFilter !== 'ALL'
                  ? 'bg-slate-800 border-slate-700 text-white'
                  : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
              title="Category & Account filters"
            >
              <Filter size={13} />
              <span>Filters</span>
            </button>

            <button
              type="button"
              onClick={handleCopyLedgerJson}
              disabled={sortedAndFiltered.length === 0}
              className="px-2.5 py-1.5 rounded-xl bg-slate-950 border border-slate-800 hover:bg-slate-800 text-xs font-semibold text-slate-300 flex items-center gap-1 cursor-pointer transition-colors disabled:opacity-40"
              title="Copy current filtered transactions as JSON"
            >
              {copiedJson ? (
                <Check size={13} className="text-emerald-400" />
              ) : (
                <Copy size={13} className="text-slate-400" />
              )}
              <span>{copiedJson ? 'Copied' : 'JSON'}</span>
            </button>

            <button
              type="button"
              onClick={handleExportTransactions}
              disabled={sortedAndFiltered.length === 0}
              className="px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 hover:bg-slate-800 text-xs font-semibold text-slate-200 flex items-center gap-1.5 cursor-pointer transition-colors shadow-xs disabled:opacity-40"
              title="Download exact filtered transactions as CSV"
            >
              <Download size={13} className="text-emerald-400" />
              <span>Export CSV</span>
            </button>

            {pendingStaged.length === 0 && (
              <button
                type="button"
                onClick={() => setIsQuickPasteOpen(true)}
                className="p-1.5 rounded-xl bg-slate-950 border border-slate-800 hover:bg-slate-800 text-slate-400 hover:text-emerald-300 cursor-pointer"
                title="Paste an SMS to parse into review queue"
              >
                <Plus size={14} />
              </button>
            )}
          </div>
        </div>

        {/* Collapsible / Custom Range & Advanced Category / Account Filters */}
        {(showAdvancedFilters || datePreset === 'custom') && (
          <div className="pt-2 border-t border-slate-800/60 grid grid-cols-1 sm:grid-cols-4 gap-2 text-xs animate-fade-in">
            {datePreset === 'custom' && (
              <>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Start Date</label>
                  <input
                    type="date"
                    value={customStartDate}
                    onChange={(e) => setCustomStartDate(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">End Date</label>
                  <input
                    type="date"
                    value={customEndDate}
                    onChange={(e) => setCustomEndDate(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </>
            )}

            <div className={datePreset === 'custom' ? 'sm:col-span-1' : 'sm:col-span-2'}>
              <label className="block text-[11px] text-slate-400 mb-1">Category</label>
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
              >
                <option value="ALL">All Categories</option>
                {categoryOptions.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div className={datePreset === 'custom' ? 'sm:col-span-1' : 'sm:col-span-2'}>
              <label className="block text-[11px] text-slate-400 mb-1">Account or Card</label>
              <select
                value={sourceFilter}
                onChange={(e) => setSourceFilter(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
              >
                <option value="ALL">All Accounts & Cards</option>
                {allSources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        {/* Status / Active Filter Bar */}
        <div className="flex items-center justify-between text-[11px] text-slate-400 pt-0.5">
          <div className="flex items-center gap-2">
            <span>
              Showing <strong className="text-slate-200">{sortedAndFiltered.length}</strong> of{' '}
              {transactions.length} transactions
            </span>
            {hasActiveFilters && (
              <span className="text-slate-500">• (Filtered subset ready for export)</span>
            )}
          </div>

          {hasActiveFilters && (
            <button
              type="button"
              onClick={handleResetFilters}
              className="text-xs text-emerald-400 hover:text-emerald-300 font-medium flex items-center gap-1 cursor-pointer"
            >
              <RotateCcw size={12} />
              <span>Reset Filters</span>
            </button>
          )}
        </div>
      </div>

      {/* Datalist for inline category editing */}
      <datalist id="spend-history-category-suggestions">
        {categoryOptions.map((cat) => (
          <option key={cat} value={cat} />
        ))}
      </datalist>

      {/* LEDGER TRANSACTIONS LIST */}
      {sortedAndFiltered.length === 0 ? (
        <div className="p-8 rounded-2xl bg-slate-900 border border-slate-800 text-center text-xs text-slate-400 space-y-2">
          <p>No transactions found matching your criteria.</p>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={handleResetFilters}
              className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer"
            >
              Clear Active Filters
            </button>
          )}
        </div>
      ) : (
        <div className="border border-slate-800 rounded-2xl overflow-hidden bg-slate-900 shadow-sm">
          <div className="divide-y divide-slate-800/60">
            {sortedAndFiltered.map((t) => {
              const sym = currMap[t.currency]?.symbol || t.currency;
              const isSpend = t.kind === 'spend' || t.kind === 'cardPayment' || t.kind === 'emi';
              const isIncome =
                t.kind === 'income' || t.kind === 'dividend' || t.kind === 'saleProceeds';
              const fromName = t.fromId ? sourceNameMap.get(t.fromId) || 'Account' : null;
              const toName = t.toId ? sourceNameMap.get(t.toId) || 'Account' : null;
              const isSmsCaptured = Boolean(t.smsMetadata || t.tags?.includes('SMS Auto-Captured'));
              const isEditingThisCat = editingCategoryTxId === t.id;
              const isEditingThisReason = editingReasonTxId === t.id;

              return (
                <div
                  key={t.id}
                  className="p-3.5 hover:bg-slate-800/30 transition-colors flex items-center justify-between gap-3 text-xs"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                        isSpend
                          ? 'bg-rose-500/10 text-rose-400'
                          : isIncome
                          ? 'bg-emerald-500/10 text-emerald-400'
                          : 'bg-cyan-500/10 text-cyan-400'
                      }`}
                    >
                      {isSpend ? (
                        <ArrowDownLeft size={18} />
                      ) : isIncome ? (
                        <ArrowUpRight size={18} />
                      ) : (
                        <ArrowLeftRight size={18} />
                      )}
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        {isEditingThisReason ? (
                          <div className="inline-flex items-center gap-1">
                            <input
                              type="text"
                              value={reasonDraft}
                              onChange={(e) => setReasonDraft(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  commitReasonChange(t);
                                } else if (e.key === 'Escape') {
                                  setEditingReasonTxId(null);
                                }
                              }}
                              autoFocus
                              disabled={savingReason}
                              placeholder="Reason..."
                              className="bg-slate-950 border border-slate-700 rounded-lg px-2 py-0.5 text-xs text-slate-100 focus:outline-none focus:border-emerald-500 w-44"
                            />
                            <button
                              type="button"
                              onClick={() => commitReasonChange(t)}
                              disabled={savingReason}
                              className="p-1 rounded text-emerald-400 hover:bg-slate-800 cursor-pointer"
                              title="Save reason & train SMS rule"
                            >
                              <Check size={13} />
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingReasonTxId(null)}
                              className="p-1 rounded text-slate-400 hover:bg-slate-800 cursor-pointer"
                              title="Cancel"
                            >
                              <X size={13} />
                            </button>
                          </div>
                        ) : !t.isReversed ? (
                          <button
                            type="button"
                            onClick={() => startEditingReason(t)}
                            className="text-sm font-semibold truncate text-white hover:text-emerald-300 transition-colors cursor-pointer text-left"
                            title="Click to edit reason (learns merchant preference)"
                          >
                            {t.reason}
                          </button>
                        ) : (
                          <span className="text-sm font-semibold truncate text-slate-400 line-through">
                            {t.reason}
                          </span>
                        )}

                        {/* Inline Category Tag */}
                        {isEditingThisCat ? (
                          <div className="inline-flex items-center gap-1">
                            <input
                              type="text"
                              list="spend-history-category-suggestions"
                              value={categoryDraft}
                              onChange={(e) => setCategoryDraft(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  commitCategoryChange(t);
                                } else if (e.key === 'Escape') {
                                  setEditingCategoryTxId(null);
                                }
                              }}
                              autoFocus
                              disabled={savingCategory}
                              className="bg-slate-950 border border-slate-700 rounded-lg px-2 py-0.5 text-[11px] text-slate-100 focus:outline-none focus:border-emerald-500 w-28"
                            />
                            <button
                              type="button"
                              onClick={() => commitCategoryChange(t)}
                              disabled={savingCategory}
                              className="p-1 rounded text-emerald-400 hover:bg-slate-800 cursor-pointer"
                            >
                              <Check size={12} />
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingCategoryTxId(null)}
                              className="p-1 rounded text-slate-400 hover:bg-slate-800 cursor-pointer"
                            >
                              <X size={12} />
                            </button>
                          </div>
                        ) : !t.isReversed ? (
                          <button
                            type="button"
                            onClick={() => startEditingCategory(t)}
                            className="text-slate-400 hover:text-emerald-300 text-[11px] font-medium transition-colors cursor-pointer"
                            title="Click to edit category"
                          >
                            {t.category || 'General'}
                          </button>
                        ) : (
                          <span className="text-slate-500 text-[11px] font-medium">
                            {t.category || 'General'}
                          </span>
                        )}

                        {isSmsCaptured && !t.isReversed && (
                          <>
                            <span className="text-slate-600">·</span>
                            <span
                              className="text-[11px] font-medium text-emerald-400/90 font-mono"
                              title="Automatically captured from on-device SMS"
                            >
                              SMS
                            </span>
                          </>
                        )}

                        {t.isReversed && (
                          <>
                            <span className="text-slate-600">·</span>
                            <span className="text-[11px] font-medium text-rose-400 font-mono">
                              Reversed
                            </span>
                          </>
                        )}
                      </div>

                      <div className="flex items-center gap-2 text-xs text-slate-400 flex-wrap">
                        <span className="font-mono text-slate-300">
                          {t.date}
                          {(() => {
                            const timeRaw = t.createdAt || t.provenance?.timestamp;
                            if (timeRaw && timeRaw.includes('T')) {
                              try {
                                const d = new Date(timeRaw);
                                if (!isNaN(d.getTime())) {
                                  return (
                                    <span className="text-slate-500 font-sans ml-1.5 text-[11px]">
                                      {d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                  );
                                }
                              } catch {
                                return null;
                              }
                            }
                            return null;
                          })()}
                        </span>
                        <span>•</span>
                        {fromName && toName ? (
                          <span>
                            {fromName} → {toName}
                          </span>
                        ) : fromName ? (
                          <span>From: {fromName}</span>
                        ) : toName ? (
                          <span>To: {toName}</span>
                        ) : (
                          <span>Direct Settlement</span>
                        )}

                        {t.paymentMode && (
                          <>
                            <span>•</span>
                            <span className="uppercase text-[10px] font-mono text-slate-500">
                              {t.paymentMode}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2.5 shrink-0">
                    <div className="text-right">
                      <div
                        className={`text-sm font-bold font-mono ${
                          t.isReversed
                            ? 'text-slate-500 line-through'
                            : isSpend
                            ? 'text-rose-400'
                            : isIncome
                            ? 'text-emerald-400'
                            : 'text-cyan-400'
                        }`}
                      >
                        {isSpend ? '-' : isIncome ? '+' : ''}
                        {formatMoney(t.amount, t.currency, sym)}
                      </div>
                      <div className="text-[10px] text-slate-500 uppercase">{t.kind}</div>
                    </div>

                    {!t.isReversed && (
                      <div className="flex items-center gap-1">
                        {isSmsCaptured && (
                          <button
                            type="button"
                            onClick={() => openFlagModal(t)}
                            className="p-1.5 rounded-lg text-slate-500 hover:text-amber-400 hover:bg-slate-800 transition-colors cursor-pointer"
                            title="Flag this SMS transaction as incorrect (trains ML model)"
                          >
                            <Flag size={14} />
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => setReversalTargetTx(t)}
                          className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-slate-800 transition-colors cursor-pointer"
                          title="Reverse this transaction and restore source balances"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* REJECTION REASON MODAL (When user deletes an SMS from the review queue) */}
      {rejectingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs animate-fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-5 space-y-4 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-white tracking-tight">
                  Reject SMS Transaction
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Specify the reason so the on-device ML model improves its parsing accuracy
                </p>
              </div>
              <button
                type="button"
                onClick={() => setRejectingItem(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs space-y-1">
              <div className="text-slate-300 font-semibold">{rejectingItem.merchantName}</div>
              <div className="text-slate-400 font-mono">
                {rejectingItem.amount} {rejectingItem.currency} · {rejectingItem.parsedDate}
              </div>
              <div className="text-[11px] text-slate-500 line-clamp-2 mt-1">
                "{rejectingItem.rawSms}"
              </div>
            </div>

            <form onSubmit={submitRejection} className="space-y-3 text-xs">
              <div>
                <label className="block font-medium text-slate-300 mb-2">Reason for rejection:</label>
                <div className="space-y-1.5">
                  {[
                    {
                      id: 'invalid_message',
                      label: 'Not a financial transaction',
                      desc: 'OTP, security authentication, or promotional marketing spam',
                    },
                    {
                      id: 'wrong_amount',
                      label: 'Wrong amount parsed',
                      desc: 'Extracted amount differs from actual movement in SMS',
                    },
                    {
                      id: 'wrong_source',
                      label: 'Wrong account or card matched',
                      desc: 'Matched the wrong bank holding or card liability',
                    },
                    {
                      id: 'duplicate',
                      label: 'Duplicate transaction',
                      desc: 'Already captured in the ledger or previously recorded',
                    },
                    {
                      id: 'cancelled',
                      label: 'Transaction failed / cancelled',
                      desc: 'Payment did not clear or was refunded at gateway',
                    },
                    {
                      id: 'other',
                      label: 'Other / Write custom reason',
                      desc: 'Provide specific feedback for the model',
                    },
                  ].map((opt) => (
                    <label
                      key={opt.id}
                      className={`flex items-start gap-2.5 p-2.5 rounded-xl border cursor-pointer transition-colors ${
                        rejectionReasonChoice === opt.id
                          ? 'border-emerald-500/60 bg-emerald-950/20 text-white'
                          : 'border-slate-800 bg-slate-950/50 text-slate-400 hover:border-slate-700 hover:text-slate-300'
                      }`}
                    >
                      <input
                        type="radio"
                        name="rejectionReason"
                        value={opt.id}
                        checked={rejectionReasonChoice === opt.id}
                        onChange={() => setRejectionReasonChoice(opt.id)}
                        className="mt-0.5 text-emerald-500"
                      />
                      <div>
                        <div className="font-semibold text-slate-200">{opt.label}</div>
                        <div className="text-[11px] text-slate-500">{opt.desc}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {rejectionReasonChoice === 'other' && (
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
                    Custom rejection feedback
                  </label>
                  <input
                    type="text"
                    value={customRejectionText}
                    onChange={(e) => setCustomRejectionText(e.target.value)}
                    placeholder="Describe why this message was invalid..."
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
                    required
                  />
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setRejectingItem(null)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingRejection}
                  className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
                >
                  {isSubmittingRejection ? 'Rejecting...' : 'Confirm Rejection'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* QUICK PASTE SMS MODAL */}
      {isQuickPasteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs animate-fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg p-5 space-y-4 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-white tracking-tight">
                  Parse SMS Transaction
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Paste bank or card notification messages to stage in review queue
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsQuickPasteOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleQuickParseSms} className="space-y-3 text-xs">
              <textarea
                rows={4}
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder="Paste transaction SMS alert here (e.g. Txn Rs.450.00 On HDFC Bank Card 4913 at Swiggy on 02-Nov-26...)"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 font-mono resize-none"
                autoFocus
              />

              {pasteMessage && (
                <div className="p-2.5 rounded-xl bg-emerald-950/40 border border-emerald-500/30 text-emerald-300 text-xs">
                  {pasteMessage}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setIsQuickPasteOpen(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isParsingPaste || !pasteText.trim()}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
                >
                  {isParsingPaste ? 'Parsing...' : 'Parse & Stage'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* FLAG SMS REVERSAL & ACTIVE RL LEARNING MODAL */}
      {flagTargetTx && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs animate-fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-5 space-y-4 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-white tracking-tight">
                  Flag SMS Transaction
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Roll back ledger balance &amp; train offline model rules
                </p>
              </div>
              <button
                type="button"
                onClick={() => setFlagTargetTx(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={submitFlagFeedback} className="space-y-4 text-xs">
              <div className="space-y-2">
                <label className="block font-medium text-slate-300">Why was this incorrect?</label>
                <div className="grid grid-cols-1 gap-2">
                  {[
                    {
                      value: 'never_occurred' as const,
                      label: 'Transaction never occurred',
                      desc: 'Never spent or received this money; discard and blacklist pattern',
                    },
                    {
                      value: 'wrong_source' as const,
                      label: 'Debited from wrong account / card',
                      desc: 'Reverse from current source and exclude for future SMS parses',
                    },
                    {
                      value: 'invalid' as const,
                      label: 'SMS parsed incorrectly',
                      desc: 'Blacklist this pattern template to avoid future faulty parses',
                    },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setFlagReason(opt.value)}
                      className={`text-left p-3 rounded-xl border transition-colors cursor-pointer ${
                        flagReason === opt.value
                          ? 'bg-slate-800 border-emerald-500/70 text-white'
                          : 'bg-slate-950/60 border-slate-800 text-slate-300 hover:border-slate-700'
                      }`}
                    >
                      <div className="text-xs font-semibold">{opt.label}</div>
                      <div className="text-[11px] text-slate-400 mt-0.5">{opt.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {flagReason === 'wrong_source' && (
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-slate-300">
                    Correct Account or Card (optional re-post)
                  </label>
                  <select
                    value={replacementSourceId}
                    onChange={(e) => setReplacementSourceId(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
                  >
                    <option value="">Just reverse &amp; exclude wrong source</option>
                    {allSources
                      .filter(
                        (s) =>
                          s.id !==
                          (flagTargetTx.fromId || flagTargetTx.sourceId || flagTargetTx.toId)
                      )
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                  </select>
                </div>
              )}

              {flagError && <p className="text-xs text-rose-400">{flagError}</p>}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setFlagTargetTx(null)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingFlag}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white cursor-pointer disabled:opacity-50"
                >
                  {submittingFlag ? 'Applying...' : 'Roll Back & Save Rule'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Transaction Reversal Confirmation Modal */}
      {reversalTargetTx && (
        <TransactionReversalModal
          transaction={reversalTargetTx}
          onClose={() => setReversalTargetTx(null)}
          onSuccess={() => setReversalTargetTx(null)}
        />
      )}

      {/* Ledger CSV Export Modal */}
      {exportModal && (
        <ExportDownloadModal
          isOpen={exportModal.isOpen}
          onClose={() => setExportModal(null)}
          title={exportModal.title}
          filename={exportModal.filename}
          content={exportModal.content}
          mimeType={exportModal.mimeType}
        />
      )}
    </div>
  );
};
