import React, { useState, useMemo, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { Transaction } from '../../types';
import { formatMoney } from '../../lib/formatters';
import {
  isSpendableLiquidHolding,
  isBankAccountHolding,
  isLockedOrMarketAsset,
  getSafeAssetName,
  getSafeLiabilityName,
  formatAssetOptionLabel,
  formatCardOptionLabel,
} from '../../lib/assetRules';
import {
  evaluateDuplicateCandidate,
  formatDuplicateWindowLabel,
  DuplicateMatchResult,
} from '../../lib/anomalyDetector';
import { suggestCategoryFromDescription } from '../../lib/categorySuggester';
import {
  Plus,
  Trash2,
  Check,
  AlertCircle,
  AlertTriangle,
  CreditCard,
  Smartphone,
  ListPlus,
  ShieldCheck,
  Clock,
  Sparkles,
} from 'lucide-react';

interface SpendRow {
  id: string;
  date: string;
  amount: string;
  currency: string;
  reason: string;
  category: string;
  sourceId: string;
  chipId?: string;
  chipLabel?: string;
  confirmIntentionalDuplicate?: boolean;
  isDebitCard?: boolean; // Default false (UPI) per specification
  debitCardId?: string;
  suggestedCategory?: string;
  categoryManuallyEdited?: boolean;
}

export const QuickAddSpendGrid: React.FC<{ onComplete?: () => void }> = ({ onComplete }) => {
  const {
    holdings,
    liabilities,
    transactions,
    assetTypes,
    currencies,
    addTransactionsBulk,
    settings,
    updateSettings,
    spendCategories,
    quickChips,
    getAccountLiquidityWithSweepIn,
    getCardEffectiveMode,
    logDebitCardAtmWithdrawal,
    recordStrategyOutcome,
  } = useApp();

  // Unlocked liquid cash & bank holdings only (excludes FD, RD, Stocks, Bonds, Mutual Funds, P2P)
  const spendableHoldings = useMemo(
    () => holdings.filter((h) => isSpendableLiquidHolding(h, assetTypes)),
    [holdings, assetTypes]
  );

  // Credit Cards & Hybrid Cards (Hybrid operates in Debit mode when linked bank > 0, Credit mode when <= 0)
  const cardSources = useMemo(
    () => liabilities.filter((l) => l.kind === 'card' && l.cardType !== 'debit'),
    [liabilities]
  );

  // Available debit & hybrid cards for bank-rail payment tracking
  const debitCards = useMemo(
    () =>
      liabilities.filter(
        (l) => l.kind === 'card' && (l.cardType === 'debit' || l.cardType === 'hybrid')
      ),
    [liabilities]
  );

  const currMap = useMemo(() => {
    const m: Record<string, (typeof currencies)[0]> = {};
    for (const c of currencies) m[c.code] = c;
    return m;
  }, [currencies]);

  const defaultDate = new Date().toISOString().split('T')[0];
  const defaultCurrency = settings.baseCurrency || 'INR';
  const defaultSource =
    spendableHoldings.find((h) => (h.principalOrValue || 0) > 0)?.id ||
    spendableHoldings[0]?.id ||
    cardSources[0]?.id ||
    '';
  const defaultCategory = spendCategories[0]?.name || 'Food & Dining';

  const [rows, setRows] = useState<SpendRow[]>([
    {
      id: 'row-1',
      date: defaultDate,
      amount: '',
      currency: defaultCurrency,
      reason: '',
      category: defaultCategory,
      sourceId: defaultSource,
      isDebitCard: false,
      debitCardId: debitCards[0]?.id || '',
    },
  ]);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [isSuccess, setIsSuccess] = useState(false);

  // Keep rows synced if initial sourceId or category was empty or invalid
  useEffect(() => {
    const validIds = new Set([
      ...spendableHoldings.map((h) => h.id),
      ...cardSources.map((c) => c.id),
    ]);
    if (validIds.size === 0) return;

    setRows((prev) => {
      let changed = false;
      const next = prev.map((r) => {
        if (!r.sourceId || !validIds.has(r.sourceId)) {
          changed = true;
          const fallbackId = defaultSource;
          const matchHold = spendableHoldings.find((h) => h.id === fallbackId);
          const matchCard = cardSources.find((c) => c.id === fallbackId);
          return {
            ...r,
            sourceId: fallbackId,
            currency: matchHold?.currency || matchCard?.currency || r.currency,
          };
        }
        return r;
      });
      return changed ? next : prev;
    });
  }, [spendableHoldings, cardSources, defaultSource]);

  const handleAddRow = () => {
    const newId = `row-${Date.now()}-${Math.random()}`;
    const lastRow = rows[rows.length - 1];
    setRows([
      ...rows,
      {
        id: newId,
        date: lastRow ? lastRow.date : defaultDate,
        amount: '',
        currency: lastRow ? lastRow.currency : defaultCurrency,
        reason: '',
        category: lastRow ? lastRow.category : defaultCategory,
        sourceId: lastRow ? lastRow.sourceId : defaultSource,
        isDebitCard: false,
        debitCardId: debitCards[0]?.id || '',
      },
    ]);
  };

  const handleRemoveRow = (id: string) => {
    if (rows.length === 1) return;
    setRows(rows.filter((r) => r.id !== id));
    setRowErrors((prev) => {
      const copy = { ...prev };
      delete copy[id];
      return copy;
    });
  };

  const handleRowChange = (id: string, field: keyof SpendRow, value: string | boolean) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        const updated = { ...r, [field]: value };
        if (field === 'reason' && typeof value === 'string') {
          if (r.chipId) {
            const linkedChip = quickChips.find((c) => c.id === r.chipId);
            if (linkedChip && (linkedChip.reason || linkedChip.label) !== value) {
              updated.chipId = undefined;
              updated.chipLabel = undefined;
            }
          }
          // Suggest category based on transaction description / merchant
          const suggestion = suggestCategoryFromDescription(value, transactions, spendCategories);
          if (suggestion) {
            updated.suggestedCategory = suggestion.category;
            // Auto-apply suggested category if user hasn't manually selected one or it matches default
            if (!r.categoryManuallyEdited || r.category === defaultCategory) {
              updated.category = suggestion.category;
            }
          } else {
            updated.suggestedCategory = undefined;
          }
        }
        if (field === 'category') {
          updated.categoryManuallyEdited = true;
        }
        if (field !== 'confirmIntentionalDuplicate') {
          updated.confirmIntentionalDuplicate = false;
        }
        if (field === 'sourceId' && typeof value === 'string') {
          const matchHold = spendableHoldings.find((h) => h.id === value);
          const matchCard = cardSources.find((c) => c.id === value);
          if (matchHold) updated.currency = matchHold.currency;
          if (matchCard) updated.currency = matchCard.currency;
          const linkedDebit = debitCards.find((dc) => dc.linkedAccountId === value);
          if (linkedDebit) updated.debitCardId = linkedDebit.id;
        }
        return updated;
      })
    );
    if (rowErrors[id]) {
      setRowErrors((prev) => {
        const copy = { ...prev };
        delete copy[id];
        return copy;
      });
    }
  };

  const duplicateWindowMinutes = settings.duplicateDetectionWindowMinutes ?? 60;
  const enforceDuplicateGuard = Boolean(settings.enforceDuplicateGuard);

  // Live 4-factor duplicate prediction per row (against ledger AND earlier batch rows within duplicateWindowMinutes)
  const rowDuplicateMap = useMemo<Record<string, DuplicateMatchResult>>(() => {
    const map: Record<string, DuplicateMatchResult> = {};
    const nowIso = new Date().toISOString();
    const syntheticPriorRows: Transaction[] = [];

    for (const r of rows) {
      const amt = parseFloat(r.amount);
      if (isNaN(amt) || amt <= 0 || !r.reason.trim() || !r.sourceId) {
        continue;
      }
      const match = evaluateDuplicateCandidate(
        {
          id: r.id,
          date: r.date || defaultDate,
          createdAt: nowIso,
          kind: 'spend',
          amount: amt,
          currency: r.currency,
          fromId: r.sourceId,
          reason: r.reason.trim(),
          category: r.category.trim() || 'General',
          chipId: r.chipId,
          chipLabel: r.chipLabel,
        },
        [...syntheticPriorRows, ...transactions],
        duplicateWindowMinutes,
        quickChips
      );
      if (match.isDuplicate) {
        map[r.id] = match;
      }
      syntheticPriorRows.push({
        id: r.id,
        date: r.date || defaultDate,
        createdAt: nowIso,
        kind: 'spend',
        amount: amt,
        currency: r.currency,
        fromId: r.sourceId,
        reason: r.reason.trim(),
        category: r.category.trim() || 'General',
        chipId: r.chipId,
        chipLabel: r.chipLabel,
        fxRateUsed: 1,
      });
    }
    return map;
  }, [rows, transactions, duplicateWindowMinutes, quickChips, defaultDate]);

  const handleDropDuplicateRow = (row: SpendRow) => {
    const amt = Math.max(0, parseFloat(row.amount) || 0);
    const fx = currMap[row.currency]?.rateToBase || 1;
    if (amt > 0) {
      recordStrategyOutcome({
        domain: 'spending',
        subEventLabel: 'Duplicate Prevented',
        ledgerRefId: `dup-prevent-${row.id}-${Date.now()}`,
        predictedSummary: `Flagged duplicate ${amt} ${row.currency} (${row.chipLabel || row.reason}) within ${formatDuplicateWindowLabel(duplicateWindowMinutes)}`,
        actualRealitySummary: `Dropped duplicate entry and protected ${amt} ${row.currency}`,
        wasSuccess: true,
        partialSuccess: false,
        microSavedBase: amt * fx,
      });
    }
    if (rows.length === 1) {
      setRows([
        {
          ...row,
          amount: '',
          reason: '',
          chipId: undefined,
          chipLabel: undefined,
          confirmIntentionalDuplicate: false,
        },
      ]);
    } else {
      handleRemoveRow(row.id);
    }
  };

  const handleSaveAll = async () => {
    const newErrors: Record<string, string> = {};
    const validTxs: Transaction[] = [];
    const debitUsagesToRecord: string[] = [];

    // Track cumulative debits per source across batch rows
    const cumulativeBySource: Record<string, number> = {};

    for (let idx = 0; idx < rows.length; idx++) {
      const r = rows[idx];
      const amt = parseFloat(r.amount);
      if (isNaN(amt) || amt <= 0) {
        newErrors[r.id] = `Row ${idx + 1}: Enter a valid positive amount.`;
        continue;
      }
      if (!r.reason.trim()) {
        newErrors[r.id] = `Row ${idx + 1}: Description is required.`;
        continue;
      }
      if (!r.sourceId) {
        newErrors[r.id] = `Row ${idx + 1}: Select an eligible payment source.`;
        continue;
      }

      // Enforce Duplicate Guard when predicted duplicate occurs within configured window
      const dupCheck = rowDuplicateMap[r.id];
      if (dupCheck?.isDuplicate && enforceDuplicateGuard && !r.confirmIntentionalDuplicate) {
        newErrors[r.id] = `Row ${idx + 1}: Duplicate Guard Enforced — identical source, amount, chip, and category detected within ${formatDuplicateWindowLabel(duplicateWindowMinutes)}. Drop duplicate or mark "Intentional Repeat" below.`;
        continue;
      }

      const rawHold = holdings.find((h) => h.id === r.sourceId);
      if (rawHold && isLockedOrMarketAsset(rawHold, assetTypes)) {
        newErrors[r.id] = `Row ${idx + 1}: Locked or market-linked asset "${getSafeAssetName(
          rawHold,
          assetTypes
        )}" cannot be spent directly.`;
        continue;
      }

      const isBankSource = Boolean(rawHold && isBankAccountHolding(rawHold, assetTypes));
      const isDc = Boolean(isBankSource && r.isDebitCard && r.debitCardId);
      const selectedDebitCard = isDc
        ? debitCards.find((dc) => dc.id === r.debitCardId)
        : undefined;

      if (
        isDc &&
        selectedDebitCard?.linkedAccountId &&
        rawHold &&
        selectedDebitCard.linkedAccountId !== rawHold.id
      ) {
        newErrors[r.id] = `Row ${idx + 1}: Card "${getSafeLiabilityName(
          selectedDebitCard
        )}" can only draw from its linked bank account.`;
        continue;
      }

      const cumulativeAmt = (cumulativeBySource[r.sourceId] || 0) + amt;
      cumulativeBySource[r.sourceId] = cumulativeAmt;

      if (rawHold) {
        const { balance: curBal, totalSweepIn } = getAccountLiquidityWithSweepIn(rawHold.id);
        const positiveBank = Math.max(0, curBal);
        const bankPlusSweep = positiveBank + totalSweepIn;
        const holdName = getSafeAssetName(rawHold, assetTypes);

        if (selectedDebitCard?.cardType === 'hybrid') {
          // 3-Tier Cascade: 1. Bank Cash -> 2. Strictly Linked Sweep-In FDs -> 3. Hybrid Card Credit Limit
          const hybridLimit = selectedDebitCard.creditLimit || selectedDebitCard.limit || 50000;
          const hybridAvail = Math.max(0, hybridLimit - (selectedDebitCard.outstanding || 0));
          const maxCapacity = bankPlusSweep + hybridAvail;
          if (cumulativeAmt > maxCapacity) {
            newErrors[r.id] = `Row ${idx + 1}: Exceeds combined "${holdName}" cash (${positiveBank.toLocaleString()}), linked Sweep-In FDs (${totalSweepIn.toLocaleString()}), and "${getSafeLiabilityName(
              selectedDebitCard
            )}" credit limit (${hybridAvail.toLocaleString()}).`;
            continue;
          }
        } else {
          if (positiveBank <= 0 && totalSweepIn <= 0) {
            newErrors[r.id] = `Row ${idx + 1}: "${holdName}" has a non-positive balance (${curBal.toLocaleString()} ${rawHold.currency}) and no linked Sweep-In FDs.`;
            continue;
          }
          if (positiveBank < cumulativeAmt) {
            if (totalSweepIn <= 0) {
              newErrors[r.id] = `Row ${idx + 1}: Insufficient balance in "${holdName}" (${curBal.toLocaleString()} ${rawHold.currency}) and Sweep-In is not enabled.`;
              continue;
            }
            if (bankPlusSweep < cumulativeAmt) {
              newErrors[r.id] = `Row ${idx + 1}: Total funds across "${holdName}" and linked Sweep-In FDs (${bankPlusSweep.toLocaleString()} ${rawHold.currency}) cannot cover ${cumulativeAmt.toLocaleString()} ${rawHold.currency}.`;
              continue;
            }
          }
        }
      } else {
        const card = cardSources.find((c) => c.id === r.sourceId);
        if (!card) {
          newErrors[r.id] = `Row ${idx + 1}: Payment source not found.`;
          continue;
        }
        const cardLimit = card.creditLimit || card.limit || 100000;
        const availCredit = Math.max(0, cardLimit - (card.outstanding || 0));

        if (card.cardType === 'hybrid') {
          // Always evaluate 3-Tier Cascade: 1. Linked Bank Cash -> 2. Strictly Linked Sweep-In FDs -> 3. Hybrid Card Credit Limit
          const liq = card.linkedAccountId
            ? getAccountLiquidityWithSweepIn(card.linkedAccountId)
            : { balance: 0, totalSweepIn: 0 };
          const bankPlusSweep = Math.max(0, liq.balance) + liq.totalSweepIn;
          const maxHybridCapacity = bankPlusSweep + availCredit;
          if (cumulativeAmt > maxHybridCapacity) {
            newErrors[r.id] = `Row ${idx + 1}: Exceeds combined linked bank, Sweep-In FDs, and credit limit capacity (${maxHybridCapacity.toLocaleString()} ${card.currency}) on "${getSafeLiabilityName(card)}".`;
            continue;
          }
        } else {
          // Pure Credit Card
          if (cumulativeAmt > availCredit) {
            newErrors[r.id] = `Row ${idx + 1}: Exceeds available credit limit (${availCredit.toLocaleString()} ${card.currency}) on "${getSafeLiabilityName(card)}".`;
            continue;
          }
        }
      }

      if (isDc && r.debitCardId) {
        debitUsagesToRecord.push(r.debitCardId);
      }

      const curr = currMap[r.currency];
      const fxRate = curr?.rateToBase || 1.0;
      const isHybridRail = selectedDebitCard?.cardType === 'hybrid';

      const nowIso = new Date().toISOString();
      const dupMatch = rowDuplicateMap[r.id];
      if (dupMatch?.isDuplicate && r.confirmIntentionalDuplicate) {
        recordStrategyOutcome({
          domain: 'spending',
          subEventLabel: 'Duplicate Override',
          ledgerRefId: `dup-override-${Date.now()}-${idx}`,
          predictedSummary: `Warned of repeat ${amt} ${r.currency} (${r.chipLabel || r.reason}) within ${formatDuplicateWindowLabel(duplicateWindowMinutes)}`,
          actualRealitySummary: `Authorized intentional repeat of ${amt} ${r.currency}`,
          wasSuccess: false,
          microSavedBase: 0,
          avoidableCostOrDeltaBase: amt * fxRate,
        });
      }

      validTxs.push({
        id: `tx-bulk-${Date.now()}-${idx}`,
        date: r.date || defaultDate,
        createdAt: nowIso,
        kind: 'spend',
        amount: amt,
        currency: r.currency,
        fromId: r.sourceId,
        reason: r.reason.trim(),
        category: r.category.trim() || 'General',
        chipId: r.chipId,
        chipLabel: r.chipLabel,
        duplicateOverrideConfirmed: Boolean(dupMatch?.isDuplicate && r.confirmIntentionalDuplicate),
        fxRateUsed: fxRate,
        paymentMode: isHybridRail ? 'hybrid_card' : isDc ? 'debit_card' : 'upi',
        debitCardId: isDc ? r.debitCardId : undefined,
        isDebitCardPayment: isDc,
        notes: isHybridRail
          ? `Paid via Hybrid Card (${getSafeLiabilityName(selectedDebitCard)})`
          : isDc
          ? 'Paid using Debit Card (+1 usage)'
          : 'Paid using UPI (default)',
      });
    }

    if (Object.keys(newErrors).length > 0) {
      setRowErrors(newErrors);
      return;
    }

    if (validTxs.length > 0) {
      for (const dcId of debitUsagesToRecord) {
        await logDebitCardAtmWithdrawal(dcId, 'non_metro');
      }

      await addTransactionsBulk(validTxs);
      setIsSuccess(true);
      setRows([
        {
          id: `row-${Date.now()}`,
          date: defaultDate,
          amount: '',
          currency: defaultCurrency,
          reason: '',
          category: defaultCategory,
          sourceId: defaultSource,
          isDebitCard: false,
          debitCardId: debitCards[0]?.id || '',
        },
      ]);
      setTimeout(() => setIsSuccess(false), 3500);
      if (onComplete) onComplete();
    }
  };

  return (
    <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4 shadow-sm space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div>
          <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
            <ListPlus size={15} className="text-emerald-400" />
            <span>Multi-Row Spend Capture</span>
          </h3>
          <p className="text-xs text-slate-400">
            Categories and one-tap shortcuts adapt automatically from your ledger patterns; UPI is default for bank accounts
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleAddRow}
            className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 flex items-center gap-1 cursor-pointer transition-colors"
          >
            <Plus size={14} /> Add Row
          </button>
          <button
            type="button"
            onClick={handleSaveAll}
            className="px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-md shadow-emerald-600/25 flex items-center gap-1.5 cursor-pointer transition-all"
          >
            <Check size={14} /> Save All ({rows.length})
          </button>
        </div>
      </div>

      {isSuccess && (
        <div className="p-3 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2">
          <Check size={16} /> Spend entries recorded in ledger and account balances updated.
        </div>
      )}


      {/* Auto-Updated One-Tap Chips */}
      <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
        <span className="text-[11px] text-slate-400 mr-1">One-tap shortcuts:</span>
        {quickChips.map((chip, idx) => (
          <button
            key={`${chip.id || 'chip'}-${idx}`}
            type="button"
            onClick={() => {
              const lastRow = rows[rows.length - 1];
              if (lastRow) {
                setRows((prev) =>
                  prev.map((r) => {
                    if (r.id !== lastRow.id) return r;
                    const validSource =
                      chip.sourceId &&
                      (spendableHoldings.some((h) => h.id === chip.sourceId) ||
                        cardSources.some((c) => c.id === chip.sourceId))
                        ? chip.sourceId
                        : r.sourceId;
                    return {
                      ...r,
                      reason: chip.reason || chip.label,
                      category: chip.category || r.category,
                      amount: chip.amount ? String(chip.amount) : r.amount,
                      sourceId: validSource,
                      chipId: chip.id,
                      chipLabel: chip.label,
                      confirmIntentionalDuplicate: false,
                    };
                  })
                );
              }
            }}
            className="px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800 hover:border-emerald-500/50 text-slate-300 hover:text-emerald-300 text-[11px] cursor-pointer transition-colors whitespace-nowrap"
            title={
              chip.isMlGenerated
                ? `Auto-learned from ${chip.usageCount || 2}+ frequent transactions`
                : 'Quick preset'
            }
          >
            +{chip.label}
            {chip.amount ? ` (${chip.amount})` : ''}
          </button>
        ))}
      </div>

      {/* Multi-Row Entry Cards */}
      <div className="space-y-3">
        {rows.map((row) => {
          const hasError = Boolean(rowErrors[row.id]);
          const matchedBankHolding = spendableHoldings.find(
            (h) => h.id === row.sourceId && isBankAccountHolding(h, assetTypes)
          );
          const isBankSource = Boolean(matchedBankHolding);
          const matchedCard = cardSources.find((c) => c.id === row.sourceId);

          return (
            <div
              key={row.id}
              className={`p-3.5 rounded-xl bg-slate-950/70 border transition-all space-y-2.5 ${
                hasError ? 'border-rose-500 bg-rose-950/10' : 'border-slate-800 hover:border-slate-700'
              }`}
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-2.5 items-end">
                {/* Date */}
                <div className="lg:col-span-2">
                  <label className="block text-[10px] text-slate-400 mb-1">Date</label>
                  <input
                    type="date"
                    value={row.date}
                    onChange={(e) => handleRowChange(row.id, 'date', e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-2 text-xs text-slate-200"
                  />
                </div>

                {/* Amount & Currency */}
                <div className="lg:col-span-2">
                  <label className="block text-[10px] text-slate-400 mb-1">Amount &amp; Currency</label>
                  <div className="flex gap-1.5">
                    <input
                      type="number"
                      step="any"
                      placeholder="0.00"
                      value={row.amount}
                      onChange={(e) => handleRowChange(row.id, 'amount', e.target.value)}
                      className="w-full min-w-0 bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-2 text-xs text-slate-100 font-mono tabular-nums font-bold"
                    />
                    <select
                      value={row.currency}
                      onChange={(e) => handleRowChange(row.id, 'currency', e.target.value)}
                      className="w-20 shrink-0 bg-slate-900 border border-slate-800 rounded-lg px-1.5 py-2 text-xs text-slate-200 font-mono"
                    >
                      {currencies.map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.code}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Description */}
                <div className="lg:col-span-3">
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-[10px] text-slate-400">Description / Merchant</label>
                    {row.suggestedCategory && (
                      <span className="text-[10px] text-cyan-400/90 flex items-center gap-1 font-medium">
                        <Sparkles size={9} /> {row.suggestedCategory}
                      </span>
                    )}
                  </div>
                  <input
                    type="text"
                    placeholder="e.g. Swiggy, Uber, Groceries, Shell"
                    value={row.reason}
                    onChange={(e) => handleRowChange(row.id, 'reason', e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-2 text-xs text-slate-200 focus:border-cyan-500/50 focus:outline-none transition-colors"
                  />
                </div>

                {/* Category */}
                <div className="lg:col-span-2">
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-[10px] text-slate-400">Category</label>
                    {row.suggestedCategory && row.suggestedCategory !== row.category ? (
                      <button
                        type="button"
                        onClick={() => handleRowChange(row.id, 'category', row.suggestedCategory!)}
                        className="text-[10px] text-amber-400 hover:text-amber-300 flex items-center gap-1 font-semibold cursor-pointer transition-colors"
                        title="Click to apply suggested category"
                      >
                        <Sparkles size={10} /> Suggest: {row.suggestedCategory}
                      </button>
                    ) : row.suggestedCategory && row.suggestedCategory === row.category ? (
                      <span className="text-[10px] text-emerald-400 flex items-center gap-1 font-semibold">
                        <Sparkles size={10} /> Auto-applied
                      </span>
                    ) : null}
                  </div>
                  <select
                    value={row.category}
                    onChange={(e) => handleRowChange(row.id, 'category', e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-2 text-xs text-slate-200 focus:border-cyan-500/50 focus:outline-none transition-colors"
                  >
                    {spendCategories.map((c, idx) => (
                      <option key={`${c.id || 'cat'}-${idx}`} value={c.name}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Source Account / Card & Delete */}
                <div className="sm:col-span-2 lg:col-span-3">
                  <label className="block text-[10px] text-slate-400 mb-1">Payment Account or Card</label>
                  <div className="flex items-center gap-1.5">
                    <select
                      value={row.sourceId}
                      onChange={(e) => handleRowChange(row.id, 'sourceId', e.target.value)}
                      className="w-full min-w-0 bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-2 text-xs text-slate-100"
                    >
                      {spendableHoldings.length > 0 && (
                        <optgroup label="Liquid Bank & Cash">
                          {spendableHoldings.map((h) => {
                            const hSym = currMap[h.currency]?.symbol || `${h.currency} `;
                            const { totalSweepIn: swp } = getAccountLiquidityWithSweepIn(h.id);
                            return (
                              <option key={h.id} value={h.id}>
                                {formatAssetOptionLabel(h, assetTypes, {
                                  currSymbol: hSym,
                                  sweepInAmount: swp,
                                })}
                              </option>
                            );
                          })}
                        </optgroup>
                      )}
                      {cardSources.length > 0 && (
                        <optgroup label="Credit & Hybrid Cards">
                          {cardSources.map((c) => {
                            const cSym = currMap[c.currency]?.symbol || `${c.currency} `;
                            return (
                              <option key={c.id} value={c.id}>
                                {formatCardOptionLabel(c, getCardEffectiveMode(c), cSym)}
                              </option>
                            );
                          })}
                        </optgroup>
                      )}
                    </select>

                    <button
                      type="button"
                      onClick={() => handleRemoveRow(row.id)}
                      disabled={rows.length === 1}
                      className="p-2 rounded-lg text-slate-500 hover:text-rose-400 disabled:opacity-30 cursor-pointer shrink-0"
                      title="Remove row"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              </div>

              {/* Hybrid Card Live Mode & 3-Tier Split Context */}
              {matchedCard && matchedCard.cardType === 'hybrid' && (() => {
                const rowAmt = Math.max(0, parseFloat(row.amount) || 0);
                const liq = matchedCard.linkedAccountId
                  ? getAccountLiquidityWithSweepIn(matchedCard.linkedAccountId)
                  : { balance: 0, totalSweepIn: 0 };
                const posBank = Math.max(0, liq.balance);
                const t1 = Math.min(posBank, rowAmt);
                const rem1 = Math.max(0, rowAmt - t1);
                const t2 = Math.min(liq.totalSweepIn, rem1);
                const t3 = Math.max(0, rem1 - t2);
                const rowSym = currMap[matchedCard.currency]?.symbol || matchedCard.currency;
                return (
                  <div className="pt-1.5 border-t border-slate-800/80 text-[11px] text-slate-400 flex flex-wrap items-center justify-between gap-2">
                    <span>
                      <strong className="text-slate-200">{getSafeLiabilityName(matchedCard)}</strong>
                      {' '}·{' '}
                      {getCardEffectiveMode(matchedCard) === 'debit'
                        ? 'Debit Mode Active (deducts cash first, then linked Sweep-In FDs, then credit limit)'
                        : liq.totalSweepIn > 0
                        ? 'Bank Cash 0 · Linked Sweep-In FDs deduct first, then credit limit'
                        : 'Credit Mode Active (linked bank <= 0; charges credit limit)'}
                    </span>
                    {rowAmt > 0 && (
                      <span className="font-mono tabular-nums text-[10px] text-slate-300">
                        1. Bank: {formatMoney(t1, matchedCard.currency, rowSym)} · 2. Sweep-In:{' '}
                        {formatMoney(t2, matchedCard.currency, rowSym)} · 3. Credit:{' '}
                        {formatMoney(t3, matchedCard.currency, rowSym)}
                      </span>
                    )}
                  </div>
                );
              })()}

              {/* Debit / Hybrid Card vs UPI Rail when a Bank Account is selected */}
              {isBankSource && (() => {
                const bankLinkedCards = debitCards.filter(
                  (dc) => !dc.linkedAccountId || dc.linkedAccountId === row.sourceId
                );
                const availableBankCards = bankLinkedCards.length > 0 ? bankLinkedCards : debitCards;
                const linkedHybridForBank = availableBankCards.find(
                  (dc) => dc.cardType === 'hybrid' && dc.linkedAccountId === row.sourceId
                );
                const activeRowCard = row.isDebitCard
                  ? availableBankCards.find((dc) => dc.id === (row.debitCardId || availableBankCards[0]?.id))
                  : undefined;
                const rowAmt = Math.max(0, parseFloat(row.amount) || 0);
                const liq = matchedBankHolding
                  ? getAccountLiquidityWithSweepIn(matchedBankHolding.id)
                  : { balance: 0, totalSweepIn: 0 };
                const posBank = Math.max(0, liq.balance);
                const t1 = Math.min(posBank, rowAmt);
                const rem1 = Math.max(0, rowAmt - t1);
                const t2 = Math.min(liq.totalSweepIn, rem1);
                const t3 = Math.max(0, rem1 - t2);
                const rowSym = matchedBankHolding
                  ? currMap[matchedBankHolding.currency]?.symbol || matchedBankHolding.currency
                  : '';

                return (
                  <div className="pt-1.5 border-t border-slate-800/80 space-y-1.5 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[11px] text-slate-400">
                          {getSafeAssetName(matchedBankHolding, assetTypes)} Rail:
                        </span>
                        <button
                          type="button"
                          onClick={() => handleRowChange(row.id, 'isDebitCard', false)}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1 cursor-pointer transition-colors ${
                            !row.isDebitCard
                              ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                              : 'bg-slate-900 text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          <Smartphone size={11} />
                          <span>UPI (Default)</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            handleRowChange(row.id, 'isDebitCard', true);
                            if (!row.debitCardId && availableBankCards[0]) {
                              handleRowChange(row.id, 'debitCardId', availableBankCards[0].id);
                            }
                          }}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1 cursor-pointer transition-colors ${
                            row.isDebitCard && activeRowCard?.cardType !== 'hybrid'
                              ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/40'
                              : 'bg-slate-900 text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          <CreditCard size={11} />
                          <span>Debit Card</span>
                        </button>

                        {linkedHybridForBank && (
                          <button
                            type="button"
                            onClick={() => {
                              handleRowChange(row.id, 'isDebitCard', true);
                              handleRowChange(row.id, 'debitCardId', linkedHybridForBank.id);
                            }}
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1 cursor-pointer transition-colors ${
                              row.isDebitCard && activeRowCard?.id === linkedHybridForBank.id
                                ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40'
                                : 'bg-slate-900 text-slate-400 hover:text-slate-200'
                            }`}
                          >
                            <ShieldCheck size={11} />
                            <span>Hybrid Card</span>
                          </button>
                        )}
                      </div>

                      {row.isDebitCard && (
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] text-slate-400">Card used:</span>
                          {availableBankCards.length === 0 ? (
                            <span className="text-[11px] text-amber-400">No linked cards registered</span>
                          ) : (
                            <select
                              value={row.debitCardId || availableBankCards[0]?.id}
                              onChange={(e) => handleRowChange(row.id, 'debitCardId', e.target.value)}
                              className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1 text-[11px] text-slate-200"
                            >
                              {availableBankCards.map((dc) => (
                                <option key={dc.id} value={dc.id}>
                                  {getSafeLiabilityName(dc)} ({dc.cardType === 'hybrid' ? 'Hybrid' : 'Debit'})
                                </option>
                              ))}
                            </select>
                          )}
                        </div>
                      )}
                    </div>

                    {row.isDebitCard && activeRowCard?.cardType === 'hybrid' && rowAmt > 0 && matchedBankHolding && (
                      <div className="text-[10px] font-mono tabular-nums text-slate-300 bg-slate-900/80 border border-slate-800 rounded-lg px-2.5 py-1.5 flex flex-wrap items-center justify-between gap-2">
                        <span className="font-sans text-indigo-300 font-semibold">
                          3-Tier Hybrid Cascade ({getSafeLiabilityName(activeRowCard)}):
                        </span>
                        <span>
                          1. Bank Cash: {formatMoney(t1, matchedBankHolding.currency, rowSym)} · 2. Linked Sweep-In:{' '}
                          {formatMoney(t2, matchedBankHolding.currency, rowSym)} · 3. Credit Limit:{' '}
                          {formatMoney(t3, matchedBankHolding.currency, rowSym)}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })()}

              {rowDuplicateMap[row.id]?.isDuplicate && (() => {
                const dup = rowDuplicateMap[row.id];
                const mins = dup.elapsedMinutes;
                const elapsedStr =
                  mins < 1
                    ? 'moments ago'
                    : mins < 60
                    ? `${Math.round(mins)} min ago`
                    : `${(mins / 60).toFixed(1)} hrs ago`;
                return (
                  <div className="p-2.5 rounded-xl bg-amber-950/40 border border-amber-500/40 text-amber-200 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                    <div className="flex items-start gap-2 min-w-0">
                      <AlertTriangle size={14} className="text-amber-400 shrink-0 mt-0.5" />
                      <div>
                        <span className="font-bold text-amber-300">
                          Predicted Duplicate Within {formatDuplicateWindowLabel(duplicateWindowMinutes)}:
                        </span>{' '}
                        <span>
                          Matches same source, amount, chip ({row.chipLabel || row.reason}), and category recorded {elapsedStr}.
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 ml-auto shrink-0">
                      <button
                        type="button"
                        onClick={() => handleDropDuplicateRow(row)}
                        className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold cursor-pointer transition-colors whitespace-nowrap"
                      >
                        Drop Duplicate
                      </button>
                      <label className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-slate-900 border border-slate-700 text-slate-200 cursor-pointer whitespace-nowrap">
                        <input
                          type="checkbox"
                          checked={Boolean(row.confirmIntentionalDuplicate)}
                          onChange={(e) =>
                            handleRowChange(row.id, 'confirmIntentionalDuplicate', e.target.checked)
                          }
                          className="rounded border-slate-600 text-amber-500 focus:ring-0"
                        />
                        <span>Intentional Repeat</span>
                      </label>
                    </div>
                  </div>
                );
              })()}

              {hasError && (
                <div className="text-[11px] text-rose-400 font-medium mt-1 flex items-center gap-1.5">
                  <AlertCircle size={13} className="shrink-0" />
                  <span>{rowErrors[row.id]}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
