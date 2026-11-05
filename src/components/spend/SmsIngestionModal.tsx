import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { isNativeAndroidSmsSupported } from '../../lib/smsBridge';
import { formatMoney } from '../../lib/formatters';
import { SmsParsedTxKind } from '../../types';
import {
  X,
  MessageSquareText,
  Smartphone,
  Check,
  Trash2,
  SlidersHorizontal,
  AlertCircle,
  AlertTriangle,
  Sparkles,
} from 'lucide-react';

interface SmsIngestionModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SmsIngestionModal: React.FC<SmsIngestionModalProps> = ({ isOpen, onClose }) => {
  const {
    holdings,
    liabilities,
    spendCategories,
    currencies,
    settings,
    smsStagingQueue,
    smsRuleOverrides,
    smsPermissionStatus,
    smsBalanceAlerts,
    resolveSmsBalanceAlert,
    requestSmsAccessAndSync,
    ingestSmsMessages,
    commitStagedSmsItem,
    discardStagedSmsItem,
    deleteSmsRuleOverride,
  } = useApp();

  const [activeTab, setActiveTab] = useState<'capture' | 'staging' | 'rules'>('capture');
  const [pasteBuffer, setPasteBuffer] = useState('');
  const [autoCommit, setAutoCommit] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  // Per-staged-item user review edits (learned by the on-device ML model on commit)
  const [txKindSelections, setTxKindSelections] = useState<Record<string, SmsParsedTxKind>>({});
  const [sourceSelections, setSourceSelections] = useState<Record<string, string>>({});
  const [targetLiabilitySelections, setTargetLiabilitySelections] = useState<
    Record<string, string>
  >({});
  const [reasonSelections, setReasonSelections] = useState<Record<string, string>>({});
  const [categorySelections, setCategorySelections] = useState<Record<string, string>>({});
  const [dateSelections, setDateSelections] = useState<Record<string, string>>({});
  const [amountSelections, setAmountSelections] = useState<Record<string, string>>({});

  if (!isOpen) return null;

  const isNativeAndroid = isNativeAndroidSmsSupported();
  const pendingStaged = smsStagingQueue.filter((s) => s.status === 'staged');

  const bankSources = holdings
    .filter((h) => h.liquidityClass === 'Immediate' || h.typeId === 'type-bank')
    .map((h) => ({
      id: h.id,
      label: `${h.name}${h.accountLastDigits ? ` (··${h.accountLastDigits})` : ''}`,
    }));

  const selectableSpendOrIncomeSources = [
    ...bankSources,
    ...liabilities
      .filter((l) => l.kind === 'card')
      .map((l) => ({
        id: l.id,
        label: `${l.name}${l.accountLastDigits ? ` (··${l.accountLastDigits})` : ''} · Card`,
      })),
  ];

  const selectableTargetLiabilities = liabilities.map((l) => ({
    id: l.id,
    kind: l.kind,
    label: `${l.name}${l.accountLastDigits ? ` (··${l.accountLastDigits})` : ''} · ${
      l.kind === 'loan' ? 'Loan / Card EMI' : 'Card'
    }`,
  }));

  const sourceLabelMap = new Map([
    ...holdings.map((h) => [h.id, h.name] as const),
    ...liabilities.map((l) => [l.id, l.name] as const),
  ]);

  const handleNativeSync = async () => {
    setErrorBanner(null);
    setStatusBanner(null);
    setIsProcessing(true);
    try {
      const res = await requestSmsAccessAndSync();
      if (res.status === 'denied') {
        setErrorBanner(
          'SMS permission is disabled. Paste bank or UPI notification messages below instead.'
        );
      } else if (res.status === 'manual_fallback') {
        setStatusBanner('Paste bank or UPI messages below for local parsing.');
      } else {
        setStatusBanner(
          `Recorded ${res.committedCount} transaction(s), staged ${res.stagedCount} for review, ignored ${res.droppedNoiseCount} non-financial message(s), skipped ${res.duplicateCount} duplicate(s).`
        );
        if (res.stagedCount > 0) setActiveTab('staging');
      }
    } catch (err: any) {
      setErrorBanner(err?.message || 'Unable to read device SMS.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleManualParse = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pasteBuffer.trim()) return;
    setErrorBanner(null);
    setStatusBanner(null);
    setIsProcessing(true);
    try {
      const res = await ingestSmsMessages(pasteBuffer, autoCommit);
      setPasteBuffer('');
      setStatusBanner(
        `Recorded ${res.committedCount} transaction(s), staged ${res.stagedCount} for review, dropped ${res.droppedNoiseCount} non-financial message(s), skipped ${res.duplicateCount} duplicate(s)${
          res.blacklistedCount > 0 ? `, blocked ${res.blacklistedCount} blacklisted pattern(s)` : ''
        }.`
      );
      if (res.stagedCount > 0) {
        setActiveTab('staging');
      }
    } catch (err: any) {
      setErrorBanner(err?.message || 'Failed to parse SMS messages.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCommitItem = async (stagingId: string) => {
    setErrorBanner(null);
    const staged = pendingStaged.find((s) => s.id === stagingId);
    if (!staged) return;

    const chosenKind: SmsParsedTxKind =
      txKindSelections[stagingId] ??
      staged.txKind ??
      (staged.direction === 'debit' ? 'spend' : 'income');
    const chosenSource = sourceSelections[stagingId] ?? staged.matchedSourceId;
    const chosenTarget =
      targetLiabilitySelections[stagingId] ?? staged.matchedTargetLiabilityId;
    const chosenReason = reasonSelections[stagingId] ?? staged.merchantName;
    const chosenCategory = categorySelections[stagingId] ?? staged.matchedCategory;
    const chosenDate = dateSelections[stagingId] ?? staged.parsedDate;
    const parsedAmt =
      amountSelections[stagingId] !== undefined
        ? parseFloat(amountSelections[stagingId])
        : staged.amount;

    const res = await commitStagedSmsItem(stagingId, {
      txKind: chosenKind,
      sourceId: chosenSource,
      targetLiabilityId: chosenTarget,
      reason: chosenReason,
      category: chosenCategory,
      date: chosenDate,
      amount: !isNaN(parsedAmt) && parsedAmt > 0 ? parsedAmt : staged.amount,
    });
    if (!res.success) {
      setErrorBanner(res.error || 'Could not post staged SMS item.');
    }
  };

  const baseCurr = settings.baseCurrency || 'INR';
  const baseSym = currencies.find((c) => c.code === baseCurr)?.symbol || '₹';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs">
      <div className="w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden animate-fade-in flex flex-col max-h-[88vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400">
              <MessageSquareText size={18} />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white tracking-tight">
                SMS Expense Capture &amp; Review
              </h2>
              <p className="text-xs text-slate-400">
                Processed locally on this device · Learns from your reviews
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="grid grid-cols-3 bg-slate-950 p-1 mx-5 mt-3 rounded-xl border border-slate-800 text-xs font-semibold">
          <button
            type="button"
            onClick={() => setActiveTab('capture')}
            className={`py-2 rounded-lg transition-colors cursor-pointer ${
              activeTab === 'capture'
                ? 'bg-slate-800 text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Sync &amp; Paste
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('staging')}
            className={`py-2 rounded-lg transition-colors cursor-pointer ${
              activeTab === 'staging'
                ? 'bg-slate-800 text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Review Queue ({pendingStaged.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('rules')}
            className={`py-2 rounded-lg transition-colors cursor-pointer ${
              activeTab === 'rules'
                ? 'bg-slate-800 text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Learned Rules ({smsRuleOverrides.length})
          </button>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto space-y-4 text-xs flex-1">
          {errorBanner && (
            <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-500/30 text-rose-300 flex items-center gap-2">
              <AlertCircle size={15} className="shrink-0" />
              <span>{errorBanner}</span>
            </div>
          )}

          {statusBanner && (
            <div className="p-3 rounded-xl bg-emerald-950/30 border border-emerald-500/30 text-emerald-300">
              {statusBanner}
            </div>
          )}

          {/* Post-Transaction Bank Balance Mismatch Alerts */}
          {smsBalanceAlerts.length > 0 && (
            <div className="space-y-2">
              {smsBalanceAlerts.map(({ stagingId, discrepancy }) => {
                const sym =
                  currencies.find((c) => c.code === discrepancy.currency)?.symbol || baseSym;
                return (
                  <div
                    key={discrepancy.id}
                    className="p-3.5 rounded-xl bg-amber-950/30 border border-amber-500/40 space-y-2"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-2">
                        <AlertTriangle
                          size={15}
                          className="text-amber-400 shrink-0 mt-0.5"
                        />
                        <div>
                          <div className="text-xs font-semibold text-amber-200">
                            Balance Mismatch on {discrepancy.holdingName}
                            {discrepancy.accountLastDigits
                              ? ` (··${discrepancy.accountLastDigits})`
                              : ''}
                          </div>
                          <p className="text-[11px] text-slate-300 mt-0.5 leading-relaxed">
                            Prior app balance{' '}
                            <span className="font-mono tabular-nums text-white">
                              {formatMoney(
                                discrepancy.previousAppBalance,
                                discrepancy.currency,
                                sym
                              )}
                            </span>{' '}
                            {discrepancy.direction === 'credit' ? '+' : '-'}{' '}
                            <span className="font-mono tabular-nums text-white">
                              {formatMoney(discrepancy.smsAmount, discrepancy.currency, sym)}
                            </span>{' '}
                            ={' '}
                            <span className="font-mono tabular-nums font-semibold text-white">
                              {formatMoney(
                                discrepancy.expectedAppBalance,
                                discrepancy.currency,
                                sym
                              )}
                            </span>
                            , but bank SMS reports{' '}
                            <span className="font-mono tabular-nums font-semibold text-amber-300">
                              {formatMoney(
                                discrepancy.smsReportedBalance,
                                discrepancy.currency,
                                sym
                              )}
                            </span>{' '}
                            (difference{' '}
                            <span className="font-mono tabular-nums font-semibold text-amber-300">
                              {discrepancy.delta >= 0 ? '+' : ''}
                              {formatMoney(discrepancy.delta, discrepancy.currency, sym)}
                            </span>
                            ). Investigate missing transactions or sync your balance.
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => resolveSmsBalanceAlert(stagingId, 'dismiss')}
                        className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 text-[11px] cursor-pointer"
                      >
                        Dismiss
                      </button>
                      <button
                        type="button"
                        onClick={() => resolveSmsBalanceAlert(stagingId, 'sync_balance')}
                        className="px-3 py-1 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-semibold text-[11px] cursor-pointer"
                      >
                        Sync Balance to{' '}
                        {formatMoney(
                          discrepancy.smsReportedBalance,
                          discrepancy.currency,
                          sym
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {activeTab === 'capture' && (
            <div className="space-y-4">
              {isNativeAndroid ? (
                <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <div className="text-sm font-medium text-slate-100 flex items-center gap-2">
                      <Smartphone size={15} className="text-emerald-400" />
                      <span>Device SMS Inbox</span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      {smsPermissionStatus === 'granted'
                        ? 'SMS permission active. Financial alerts are parsed locally on-device.'
                        : smsPermissionStatus === 'denied'
                        ? 'SMS access denied — paste notifications manually below or grant access.'
                        : 'Grant local SMS read access to scan bank, card, and UPI alerts automatically.'}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={isProcessing}
                    onClick={handleNativeSync}
                    className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {isProcessing ? 'Scanning...' : 'Sync Device SMS'}
                  </button>
                </div>
              ) : (
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-slate-400 leading-relaxed">
                  Direct SMS inbox access runs on Android. Paste single-line or multi-line bank,
                  card, IMPS, or UPI messages below — card repayments and numeric UPI handles open in
                  the Review Queue so your edits train the local model.
                </div>
              )}

              {/* Manual Notification / SMS Paste Form */}
              <form onSubmit={handleManualParse} className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Paste Bank / Card / UPI SMS Messages
                  </label>
                  <textarea
                    rows={6}
                    value={pasteBuffer}
                    onChange={(e) => setPasteBuffer(e.target.value)}
                    placeholder={`Txn Rs.52.00\nOn HDFC Bank Card 3230\nAt paytm-8774066@ptybl\nby UPI 173332464899\nOn 15-07`}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-slate-200 font-mono focus:outline-none focus:border-emerald-500 resize-y"
                  />
                </div>

                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <label className="flex items-center gap-2 text-slate-300 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={autoCommit}
                      onChange={(e) => setAutoCommit(e.target.checked)}
                      className="rounded border-slate-700 bg-slate-950 text-emerald-500"
                    />
                    <span>Auto-post clear matches (stage card payments &amp; unknown handles)</span>
                  </label>

                  <button
                    type="submit"
                    disabled={isProcessing || !pasteBuffer.trim()}
                    className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold transition-colors cursor-pointer disabled:opacity-40"
                  >
                    {isProcessing ? 'Processing...' : 'Parse Messages'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {activeTab === 'staging' && (
            <div className="space-y-3">
              {pendingStaged.length === 0 ? (
                <div className="p-8 rounded-xl bg-slate-950 border border-slate-800 text-center text-slate-400">
                  No pending SMS items in review queue.
                </div>
              ) : (
                pendingStaged.map((item) => {
                  const selectedKind: SmsParsedTxKind =
                    txKindSelections[item.id] ??
                    item.txKind ??
                    (item.direction === 'debit' ? 'spend' : 'income');
                  const isRepayment =
                    selectedKind === 'cardPayment' || selectedKind === 'emi';

                  const selectedSource =
                    sourceSelections[item.id] ?? item.matchedSourceId ?? '';
                  const selectedTargetLiability =
                    targetLiabilitySelections[item.id] ??
                    item.matchedTargetLiabilityId ??
                    '';
                  const selectedReason =
                    reasonSelections[item.id] ?? item.merchantName ?? '';
                  const selectedCategory =
                    categorySelections[item.id] ??
                    item.matchedCategory ??
                    (selectedKind === 'emi'
                      ? 'Loans & EMI'
                      : selectedKind === 'cardPayment'
                      ? 'Credit Cards'
                      : selectedKind === 'income'
                      ? 'Income'
                      : 'General');
                  const selectedDate = dateSelections[item.id] ?? item.parsedDate;
                  const selectedAmount =
                    amountSelections[item.id] ?? item.amount.toString();

                  const sym =
                    currencies.find((c) => c.code === item.currency)?.symbol || baseSym;

                  return (
                    <div
                      key={item.id}
                      className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2.5"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-white truncate">
                            {selectedReason || item.merchantName}
                          </div>
                          <div className="text-[11px] text-slate-400 font-mono tabular-nums mt-0.5">
                            {selectedDate}
                            {item.accountLastDigits ? ` · ··${item.accountLastDigits}` : ''}
                            {item.paymentMode ? ` · ${item.paymentMode.toUpperCase()}` : ''}
                            {item.refId ? ` · Ref ${item.refId}` : ''}
                            {item.reportedBalance !== undefined
                              ? ` · SMS Bal ${formatMoney(item.reportedBalance, item.currency, sym)}`
                              : ''}
                            {item.reportedAvailableLimit !== undefined
                              ? ` · Avl Limit ${formatMoney(item.reportedAvailableLimit, item.currency, sym)}`
                              : ''}
                          </div>
                        </div>
                        <div
                          className={`text-sm font-bold font-mono tabular-nums shrink-0 ${
                            selectedKind === 'income' ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {selectedKind === 'income' ? '+' : '-'}
                          {formatMoney(
                            parseFloat(selectedAmount) || item.amount,
                            item.currency,
                            sym
                          )}
                        </div>
                      </div>

                      {item.reviewHint && (
                        <div className="text-[11px] text-cyan-300 leading-snug">
                          {item.reviewHint}
                        </div>
                      )}

                      <p className="text-[11px] text-slate-500 font-mono whitespace-pre-line line-clamp-3">
                        {item.rawSms}
                      </p>

                      {/* ML Suggested Reasons from Previous Spends */}
                      {item.suggestedReasons && item.suggestedReasons.length > 0 && (
                        <div className="space-y-1">
                          <div className="text-[11px] text-slate-400 flex items-center gap-1">
                            <Sparkles size={12} className="text-emerald-400" />
                            <span>Suggested from your previous spends:</span>
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {item.suggestedReasons.map((sug, idx) => (
                              <button
                                key={`${item.id}-sug-${idx}`}
                                type="button"
                                onClick={() => {
                                  setReasonSelections((prev) => ({
                                    ...prev,
                                    [item.id]: sug.reason,
                                  }));
                                  setCategorySelections((prev) => ({
                                    ...prev,
                                    [item.id]: sug.category,
                                  }));
                                }}
                                className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-[11px] text-slate-200 transition-colors cursor-pointer text-left"
                                title={sug.basis}
                              >
                                <span className="font-medium text-emerald-300">{sug.reason}</span>
                                <span className="text-slate-400"> · {sug.category}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Editable Review Controls */}
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <div>
                          <label className="block text-[10px] text-slate-500 mb-0.5">
                            Entry Type
                          </label>
                          <select
                            value={selectedKind}
                            onChange={(e) => {
                              const nextKind = e.target.value as SmsParsedTxKind;
                              setTxKindSelections((prev) => ({
                                ...prev,
                                [item.id]: nextKind,
                              }));
                              if (nextKind === 'emi') {
                                setCategorySelections((prev) => ({
                                  ...prev,
                                  [item.id]: 'Loans & EMI',
                                }));
                              } else if (nextKind === 'cardPayment') {
                                setCategorySelections((prev) => ({
                                  ...prev,
                                  [item.id]: 'Credit Cards',
                                }));
                              }
                            }}
                            className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200"
                          >
                            <option value="spend">Spend (Outflow)</option>
                            <option value="income">Income / Credit</option>
                            <option value="cardPayment">Credit Card Bill Payment</option>
                            <option value="emi">Loan / Loan-Against-Card Payment</option>
                          </select>
                        </div>

                        <div>
                          <label className="block text-[10px] text-slate-500 mb-0.5">
                            Date
                          </label>
                          <input
                            type="date"
                            value={selectedDate}
                            onChange={(e) =>
                              setDateSelections((prev) => ({
                                ...prev,
                                [item.id]: e.target.value,
                              }))
                            }
                            className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 font-mono tabular-nums"
                          />
                        </div>

                        <div>
                          <label className="block text-[10px] text-slate-500 mb-0.5">
                            Amount ({item.currency})
                          </label>
                          <input
                            type="number"
                            step="any"
                            value={selectedAmount}
                            onChange={(e) =>
                              setAmountSelections((prev) => ({
                                ...prev,
                                [item.id]: e.target.value,
                              }))
                            }
                            className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 font-mono tabular-nums"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[10px] text-slate-500 mb-0.5">
                            {isRepayment
                              ? 'Paid From Bank Account'
                              : selectedKind === 'income'
                              ? 'Credited To Account'
                              : 'Paid From Account / Card'}
                          </label>
                          <select
                            value={selectedSource}
                            onChange={(e) =>
                              setSourceSelections((prev) => ({
                                ...prev,
                                [item.id]: e.target.value,
                              }))
                            }
                            className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200"
                          >
                            <option value="">
                              {isRepayment
                                ? 'Select Paying Bank Account...'
                                : 'Select Account / Card...'}
                            </option>
                            {(isRepayment ? bankSources : selectableSpendOrIncomeSources).map(
                              (s) => (
                                <option key={s.id} value={s.id}>
                                  {s.label}
                                </option>
                              )
                            )}
                          </select>
                        </div>

                        {isRepayment ? (
                          <div>
                            <label className="block text-[10px] text-slate-500 mb-0.5">
                              Towards Card / Loan (··{item.accountLastDigits || 'target'})
                            </label>
                            <select
                              value={selectedTargetLiability}
                              onChange={(e) => {
                                const val = e.target.value;
                                setTargetLiabilitySelections((prev) => ({
                                  ...prev,
                                  [item.id]: val,
                                }));
                                const picked = liabilities.find((l) => l.id === val);
                                if (picked?.kind === 'loan') {
                                  setTxKindSelections((prev) => ({
                                    ...prev,
                                    [item.id]: 'emi',
                                  }));
                                  setCategorySelections((prev) => ({
                                    ...prev,
                                    [item.id]: 'Loans & EMI',
                                  }));
                                } else if (picked?.kind === 'card') {
                                  setTxKindSelections((prev) => ({
                                    ...prev,
                                    [item.id]: 'cardPayment',
                                  }));
                                  setCategorySelections((prev) => ({
                                    ...prev,
                                    [item.id]: 'Credit Cards',
                                  }));
                                }
                              }}
                              className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200"
                            >
                              <option value="">Select Card or Loan...</option>
                              {selectableTargetLiabilities.map((l) => (
                                <option key={l.id} value={l.id}>
                                  {l.label}
                                </option>
                              ))}
                            </select>
                          </div>
                        ) : (
                          <div>
                            <label className="block text-[10px] text-slate-500 mb-0.5">
                              Category
                            </label>
                            <input
                              type="text"
                              list="sms-category-suggestions"
                              value={selectedCategory}
                              onChange={(e) =>
                                setCategorySelections((prev) => ({
                                  ...prev,
                                  [item.id]: e.target.value,
                                }))
                              }
                              placeholder="Category (e.g. Food & Dining)"
                              className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200"
                            />
                          </div>
                        )}
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div className={isRepayment ? '' : 'sm:col-span-2'}>
                          <label className="block text-[10px] text-slate-500 mb-0.5">
                            Reason / Description (trains future suggestions)
                          </label>
                          <input
                            type="text"
                            value={selectedReason}
                            onChange={(e) =>
                              setReasonSelections((prev) => ({
                                ...prev,
                                [item.id]: e.target.value,
                              }))
                            }
                            placeholder="What was this for? (e.g. Tea & Snacks, Loan Against Card EMI)"
                            className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200"
                          />
                        </div>

                        {isRepayment && (
                          <div>
                            <label className="block text-[10px] text-slate-500 mb-0.5">
                              Category
                            </label>
                            <input
                              type="text"
                              list="sms-category-suggestions"
                              value={selectedCategory}
                              onChange={(e) =>
                                setCategorySelections((prev) => ({
                                  ...prev,
                                  [item.id]: e.target.value,
                                }))
                              }
                              placeholder="Loans & EMI / Credit Cards"
                              className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200"
                            />
                          </div>
                        )}
                      </div>

                      <div className="flex items-center justify-end gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => discardStagedSmsItem(item.id)}
                          className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-rose-400 flex items-center gap-1 cursor-pointer"
                        >
                          <Trash2 size={13} />
                          <span>Discard</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleCommitItem(item.id)}
                          className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold flex items-center gap-1 cursor-pointer"
                        >
                          <Check size={13} />
                          <span>Save &amp; Post to Ledger</span>
                        </button>
                      </div>
                    </div>
                  );
                })
              )}

              <datalist id="sms-category-suggestions">
                {spendCategories.map((c) => (
                  <option key={c.id} value={c.name} />
                ))}
              </datalist>
            </div>
          )}

          {activeTab === 'rules' && (
            <div className="space-y-2.5">
              {smsRuleOverrides.length === 0 ? (
                <div className="p-8 rounded-xl bg-slate-950 border border-slate-800 text-center text-slate-400">
                  No learned SMS rules yet. Reviewing items in the queue, editing transaction
                  reasons/categories, or flagging a faulty SMS automatically trains local rules here.
                </div>
              ) : (
                smsRuleOverrides.map((rule) => (
                  <div
                    key={rule.id}
                    className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex items-center gap-2 text-slate-100 font-medium">
                        <SlidersHorizontal size={13} className="text-cyan-400 shrink-0" />
                        {rule.ruleType === 'merchant_category' && (
                          <span className="truncate">
                            {rule.rawCounterpartyKey || rule.merchantDisplayName || rule.merchantAlias} →{' '}
                            {rule.mappedReason ? (
                              <>
                                <strong className="text-white">{rule.mappedReason}</strong> ·{' '}
                              </>
                            ) : null}
                            <strong className="text-emerald-400">{rule.mappedCategory}</strong>
                          </span>
                        )}
                        {rule.ruleType === 'account_mapping' && (
                          <span className="truncate">
                            Digits ··{rule.accountLastDigits || '—'} →{' '}
                            <strong className="text-cyan-400">
                              {rule.mappedSourceId
                                ? sourceLabelMap.get(rule.mappedSourceId) || rule.mappedSourceId
                                : 'Blocked Wrong Source'}
                            </strong>
                          </span>
                        )}
                        {rule.ruleType === 'repayment_routing' && (
                          <span className="truncate">
                            Payment ··{rule.accountLastDigits || '—'} →{' '}
                            <strong className="text-cyan-400">
                              {rule.mappedSourceId
                                ? sourceLabelMap.get(rule.mappedSourceId) || rule.mappedSourceId
                                : 'Bank'}
                            </strong>{' '}
                            to{' '}
                            <strong className="text-emerald-400">
                              {rule.mappedTargetLiabilityId
                                ? sourceLabelMap.get(rule.mappedTargetLiabilityId) ||
                                  rule.mappedTargetLiabilityId
                                : 'Card/Loan'}
                            </strong>{' '}
                            ({rule.mappedTxKind === 'emi' ? 'Loan EMI' : 'Card Bill'})
                          </span>
                        )}
                        {rule.ruleType === 'pattern_blacklist' && (
                          <span className="truncate text-rose-300">
                            Blacklisted SMS Pattern (
                            {rule.merchantDisplayName || rule.flagReason || 'Invalid'})
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-500 font-mono tabular-nums">
                        Confidence {(rule.confidence * 100).toFixed(0)}% · Applied {rule.hitCount}x
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => deleteSmsRuleOverride(rule.id)}
                      className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-slate-800 cursor-pointer shrink-0"
                      title="Delete learned rule"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
