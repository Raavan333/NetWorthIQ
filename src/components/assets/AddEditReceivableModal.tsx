import React, { useState, useMemo, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { Receivable } from '../../types';
import { createProvenance } from '../../lib/financialMath';
import {
  isPositiveLiquidHolding,
  formatAssetOptionLabel,
  formatCardOptionLabel,
  getSafeAssetName,
  getSafeLiabilityName,
} from '../../lib/assetRules';
import {
  computeBrokerFeeAmount,
  recommendBestCardForBrokerAmount,
  getStoredClosedLoopMLState,
} from '../../lib/mlEngine';
import { formatMoney } from '../../lib/formatters';
import { X, HandCoins, CreditCard, Landmark, AlertCircle, Sparkles, Building2 } from 'lucide-react';

interface AddEditReceivableModalProps {
  receivable?: Receivable;
  initialDebtorName?: string;
  onClose: () => void;
}

export const AddEditReceivableModal: React.FC<AddEditReceivableModalProps> = ({
  receivable,
  initialDebtorName,
  onClose,
}) => {
  const {
    addReceivable,
    updateReceivable,
    holdings,
    liabilities,
    assetTypes,
    currencies,
    settings,
    transactions,
    receivables,
    addTransaction,
    getAccountLiquidityWithSweepIn,
    getCardEffectiveMode,
  } = useApp();

  const isEditing = Boolean(receivable);

  // Available positive liquid bank/cash accounts
  const bankAccounts = useMemo(
    () =>
      holdings.filter(
        (h) => isPositiveLiquidHolding(h, assetTypes) || h.liquidityClass === 'Immediate'
      ),
    [holdings, assetTypes]
  );

  // Available credit / hybrid / debit cards
  const creditCards = useMemo(
    () => liabilities.filter((l) => l.kind === 'card'),
    [liabilities]
  );

  const initialSourceType: 'holding' | 'credit_card' =
    receivable?.fundingSourceType ||
    (bankAccounts.length > 0 ? 'holding' : creditCards.length > 0 ? 'credit_card' : 'holding');

  const initialSourceId =
    receivable?.fundingSourceId ||
    (initialSourceType === 'holding' ? bankAccounts[0]?.id || '' : creditCards[0]?.id || '');

  const [debtorName, setDebtorName] = useState(
    receivable?.debtorName || initialDebtorName || ''
  );
  const [disbursedInput, setDisbursedInput] = useState<number | ''>(
    receivable
      ? receivable.disbursedAmount ?? receivable.principalAmount
      : ''
  );
  const [currency, setCurrency] = useState(receivable?.currency || settings.baseCurrency || 'INR');
  const [interestRatePct, setInterestRatePct] = useState<number | ''>(
    receivable?.interestRatePct !== undefined ? receivable.interestRatePct : 0
  );
  const [issueDate, setIssueDate] = useState(
    receivable?.issueDate || new Date().toISOString().split('T')[0]
  );
  const [expectedDate, setExpectedDate] = useState(receivable?.expectedDate || '');
  const [confidencePct, setConfidencePct] = useState<number>(receivable?.confidencePct || 85);
  const [fundingSourceType, setFundingSourceType] = useState<'holding' | 'credit_card'>(
    initialSourceType
  );
  const [fundingSourceId, setFundingSourceId] = useState(initialSourceId);
  const [autoDeductSource, setAutoDeductSource] = useState(!isEditing);
  const [isOpeningBalance, setIsOpeningBalance] = useState<boolean>(receivable?.isOpeningBalance || false);

  // Broker & Transfer / Cash-Out Fee configuration
  const [brokerName, setBrokerName] = useState(receivable?.brokerName || '');
  const [feeMode, setFeeMode] = useState<'none' | 'percent' | 'per_unit' | 'flat'>(
    receivable?.feeMode || 'none'
  );
  const [feePct, setFeePct] = useState<string>(
    receivable?.feePct !== undefined ? String(receivable.feePct) : '0.3'
  );
  const [feePerUnitAmount, setFeePerUnitAmount] = useState<string>(
    receivable?.feePerUnitAmount !== undefined ? String(receivable.feePerUnitAmount) : '300'
  );
  const [feeUnitSize, setFeeUnitSize] = useState<string>(
    receivable?.feeUnitSize !== undefined ? String(receivable.feeUnitSize) : '10000'
  );
  const [passFeeToBorrower, setPassFeeToBorrower] = useState<boolean>(
    receivable?.passFeeToBorrower !== undefined ? receivable.passFeeToBorrower : true
  );

  const [notes, setNotes] = useState(receivable?.notes || '');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isEditing && !fundingSourceId) {
      if (fundingSourceType === 'holding' && bankAccounts[0]) {
        setFundingSourceId(bankAccounts[0].id);
      } else if (fundingSourceType === 'credit_card' && creditCards[0]) {
        setFundingSourceId(creditCards[0].id);
      }
    }
  }, [isEditing, fundingSourceId, fundingSourceType, bankAccounts, creditCards]);

  const currSymbol = currencies.find((c) => c.code === currency)?.symbol || '₹';
  const fmt = (amt: number) => formatMoney(amt, currency, currSymbol, settings.numberGrouping, 2);

  const disbursedAmountNum = Math.max(0, Number(disbursedInput) || 0);
  const calculatedFee = useMemo(
    () =>
      computeBrokerFeeAmount(disbursedAmountNum, feeMode, {
        feePct: parseFloat(feePct) || 0,
        feePerUnitAmount: parseFloat(feePerUnitAmount) || 0,
        feeUnitSize: parseFloat(feeUnitSize) || 10000,
        flatFee: parseFloat(feePerUnitAmount) || 0,
      }),
    [disbursedAmountNum, feeMode, feePct, feePerUnitAmount, feeUnitSize]
  );

  // Total deducted from source is ALWAYS disbursed + fee (single 1x deduction).
  // Total owed by borrower is disbursed + fee when passFeeToBorrower is true (default), else disbursed.
  const totalDeductedFromSource = Math.round((disbursedAmountNum + calculatedFee) * 100) / 100;
  const totalReceivablePrincipal = passFeeToBorrower
    ? totalDeductedFromSource
    : disbursedAmountNum;

  const closedLoopState = useMemo(() => getStoredClosedLoopMLState(), []);

  const mlBrokerRecommendation = useMemo(() => {
    if (disbursedAmountNum <= 0 || creditCards.length === 0) return null;
    return recommendBestCardForBrokerAmount({
      amountNeeded: disbursedAmountNum,
      liabilities,
      holdings,
      assetTypes,
      transactions,
      receivables,
      preferredBrokerName: brokerName,
      selectedSourceId: fundingSourceId,
      currentEnteredFee: feeMode !== 'none' || brokerName.trim() ? calculatedFee : undefined,
      activeStrategy: closedLoopState.activeStrategy,
      currSymbol,
    });
  }, [
    disbursedAmountNum,
    creditCards.length,
    liabilities,
    holdings,
    assetTypes,
    transactions,
    receivables,
    brokerName,
    fundingSourceId,
    feeMode,
    calculatedFee,
    closedLoopState.activeStrategy,
    currSymbol,
  ]);

  const getCardAvailableCapacity = (cardId: string): { available: number; detail: string } => {
    const card = creditCards.find((c) => c.id === cardId);
    if (!card) return { available: 0, detail: '0' };
    const creditLimit = card.creditLimit ?? card.limit ?? 0;
    const creditAvail = Math.max(0, creditLimit - (card.outstanding || 0));

    if (card.cardType === 'debit') {
      if (!card.linkedAccountId) return { available: 0, detail: 'No linked bank' };
      const { balance } = getAccountLiquidityWithSweepIn(card.linkedAccountId);
      const pos = Math.max(0, balance);
      return { available: pos, detail: `Linked Bank: ${fmt(pos)}` };
    }

    if (card.cardType === 'hybrid' && card.linkedAccountId) {
      const { totalAvailable } = getAccountLiquidityWithSweepIn(card.linkedAccountId);
      const bankPlusSweep = Math.max(0, totalAvailable);
      const combined = bankPlusSweep + creditAvail;
      return {
        available: combined,
        detail: `Bank+Sweep ${fmt(bankPlusSweep)} + Card Limit ${fmt(creditAvail)}`,
      };
    }

    return { available: creditAvail, detail: `Available Limit: ${fmt(creditAvail)}` };
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!debtorName.trim()) {
      setError('Please specify borrower or recipient name.');
      return;
    }

    if (!disbursedAmountNum || disbursedAmountNum <= 0) {
      setError('Amount lent must be a positive number.');
      return;
    }

    const recId = receivable?.id || `rec-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const cleanBroker = brokerName.trim() || undefined;

    // Deduct ONCE via addTransaction (AppContext.addTransaction handles holding balance, sweep-in FDs,
    // credit card outstanding, and 3-tier hybrid card cascade automatically — never call updateHolding/updateLiability here!)
    // For legacy opening balances, strictly skip deduction to avoid falsifying historical cash-outs!
    if (!isEditing && autoDeductSource && !isOpeningBalance) {
      if (!fundingSourceId) {
        setError('Please select the funding bank account or card, or uncheck automatic source deduction.');
        return;
      }

      if (fundingSourceType === 'holding') {
        const sourceHolding = bankAccounts.find((h) => h.id === fundingSourceId);
        if (!sourceHolding) {
          setError('Selected funding bank/cash account was not found.');
          return;
        }
        const { balance, totalSweepIn, totalAvailable } = getAccountLiquidityWithSweepIn(sourceHolding.id);
        if (totalAvailable < totalDeductedFromSource) {
          setError(
            `Insufficient funds in ${getSafeAssetName(sourceHolding, assetTypes)}: ${fmt(balance)} cash${
              totalSweepIn > 0 ? ` + ${fmt(totalSweepIn)} Sweep-In FD` : ''
            } available, but ${fmt(totalDeductedFromSource)} is required.`
          );
          return;
        }

        await addTransaction({
          id: `tx-rec-disburse-${Date.now()}`,
          date: issueDate,
          kind: 'spend',
          amount: totalDeductedFromSource,
          currency: sourceHolding.currency || currency,
          fromId: sourceHolding.id,
          reason: `Money lent to ${debtorName.trim()}${
            calculatedFee > 0 ? ` (Principal ${disbursedAmountNum} + Fee ${calculatedFee})` : ''
          }`,
          category: 'Receivables & Loans',
          tags: ['Personal Loan Given', 'Receivable', ...(cleanBroker ? [`Broker:${cleanBroker}`] : [])],
          fxRateUsed: 1.0,
          brokerName: cleanBroker,
          brokerageFee: calculatedFee > 0 ? calculatedFee : undefined,
          brokerFeeMode: feeMode !== 'none' ? feeMode : undefined,
          brokerFeePct: feeMode === 'percent' ? parseFloat(feePct) || 0 : undefined,
          brokerFeePerUnit:
            feeMode === 'per_unit' || feeMode === 'flat' ? parseFloat(feePerUnitAmount) || 0 : undefined,
          brokerFeeUnitSize: feeMode === 'per_unit' ? parseFloat(feeUnitSize) || 10000 : undefined,
          notes: `Disbursed ${disbursedAmountNum} to ${debtorName.trim()}${
            calculatedFee > 0 ? ` + ${calculatedFee} transfer/brokerage fee` : ''
          }${cleanBroker ? ` via ${cleanBroker}` : ''} from ${getSafeAssetName(sourceHolding, assetTypes)}.`,
          provenance: createProvenance('user_entered', 'Lent from bank/cash account'),
        });
      } else if (fundingSourceType === 'credit_card') {
        const sourceCard = creditCards.find((c) => c.id === fundingSourceId);
        if (!sourceCard) {
          setError('Selected funding card was not found.');
          return;
        }
        const capInfo = getCardAvailableCapacity(sourceCard.id);
        if (capInfo.available < totalDeductedFromSource) {
          setError(
            `Insufficient capacity on ${getSafeLiabilityName(sourceCard)} (${capInfo.detail}). Required: ${fmt(
              totalDeductedFromSource
            )}.`
          );
          return;
        }

        await addTransaction({
          id: `tx-rec-card-disburse-${Date.now()}`,
          date: issueDate,
          kind: 'spend',
          amount: totalDeductedFromSource,
          currency: sourceCard.currency || currency,
          fromId: sourceCard.id,
          reason: `Card-funded loan to ${debtorName.trim()}${
            calculatedFee > 0 ? ` (${disbursedAmountNum} + ${calculatedFee} fee)` : ''
          }`,
          category: 'Receivables & Loans',
          tags: ['Card Loan Given', 'Receivable', ...(cleanBroker ? [`Broker:${cleanBroker}`] : [])],
          fxRateUsed: 1.0,
          brokerName: cleanBroker,
          brokerageFee: calculatedFee > 0 ? calculatedFee : undefined,
          brokerFeeMode: feeMode !== 'none' ? feeMode : undefined,
          brokerFeePct: feeMode === 'percent' ? parseFloat(feePct) || 0 : undefined,
          brokerFeePerUnit:
            feeMode === 'per_unit' || feeMode === 'flat' ? parseFloat(feePerUnitAmount) || 0 : undefined,
          brokerFeeUnitSize: feeMode === 'per_unit' ? parseFloat(feeUnitSize) || 10000 : undefined,
          notes: `Funded personal loan to ${debtorName.trim()} using ${getSafeLiabilityName(sourceCard)}${
            cleanBroker ? ` via broker ${cleanBroker}` : ''
          }. Deducted ${totalDeductedFromSource} once.`,
          provenance: createProvenance('user_entered', 'Funded via card'),
        });
      }
    }

    const alreadyRepaid = isEditing
      ? Math.max(0, (receivable?.principalAmount || 0) - (receivable?.outstandingAmount || 0))
      : 0;
    const nextOutstanding = isEditing
      ? Math.max(0, totalReceivablePrincipal - alreadyRepaid)
      : totalReceivablePrincipal;

    const payload: Receivable = {
      id: recId,
      debtorName: debtorName.trim(),
      currency,
      principalAmount: totalReceivablePrincipal,
      disbursedAmount: disbursedAmountNum,
      transferFeeAmount: calculatedFee > 0 ? calculatedFee : 0,
      brokerName: cleanBroker,
      feeMode,
      feePct: feeMode === 'percent' ? parseFloat(feePct) || 0 : undefined,
      feePerUnitAmount:
        feeMode === 'per_unit' || feeMode === 'flat' ? parseFloat(feePerUnitAmount) || 0 : undefined,
      feeUnitSize: feeMode === 'per_unit' ? parseFloat(feeUnitSize) || 10000 : undefined,
      passFeeToBorrower,
      outstandingAmount: nextOutstanding,
      interestRatePct: interestRatePct !== '' ? Number(interestRatePct) : 0,
      issueDate,
      expectedDate: expectedDate || undefined,
      confidencePct,
      fundingSourceId: fundingSourceId || undefined,
      fundingSourceType,
      isOpeningBalance,
      origin: isOpeningBalance ? 'legacy_opening' : 'app_disbursed',
      status:
        nextOutstanding <= 0 && isEditing
          ? 'collected'
          : receivable?.status === 'collected' && nextOutstanding > 0
          ? 'active'
          : receivable?.status || 'active',
      notes: notes.trim() || undefined,
      repayments: receivable?.repayments || [],
      provenance: receivable?.provenance || createProvenance('user_entered'),
    };

    if (isEditing) {
      await updateReceivable(payload);
    } else {
      await addReceivable(payload);
    }

    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-xs overflow-y-auto">
      <div className="w-full max-w-lg my-auto bg-slate-900 border border-slate-800 rounded-xl shadow-2xl overflow-hidden animate-fade-in max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400">
              <HandCoins size={18} />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-100">
                {isEditing ? 'Edit Money Lent' : 'Record Money Lent (Receivable)'}
              </h2>
              <p className="text-xs text-slate-400">
                Single-deduction source accounting, broker fee pass-through &amp; card optimization
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSave} className="p-4 space-y-3.5 text-xs overflow-y-auto">
          {error && (
            <div className="p-2.5 rounded-lg bg-rose-950/40 border border-rose-500/30 text-rose-300 flex items-center gap-2">
              <AlertCircle size={14} className="shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Debtor Name */}
          <div className="space-y-1">
            <label className="font-medium text-slate-300">Borrower / Person Name *</label>
            <input
              type="text"
              required
              placeholder="e.g. Rahul Sharma, Friend Emergency, Security Deposit"
              value={debtorName}
              onChange={(e) => setDebtorName(e.target.value)}
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-100 focus:outline-hidden focus:border-emerald-500"
            />
          </div>

          {/* Disbursed Amount & Currency */}
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2 space-y-1">
              <label className="font-medium text-slate-300">Amount Handed to Borrower *</label>
              <input
                type="number"
                required
                min={1}
                step="any"
                placeholder="10000"
                value={disbursedInput}
                onChange={(e) => setDisbursedInput(e.target.value === '' ? '' : Number(e.target.value))}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-100 font-mono focus:outline-hidden focus:border-emerald-500"
              />
            </div>
            <div className="space-y-1">
              <label className="font-medium text-slate-300">Currency</label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="w-full px-2 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-100 focus:outline-hidden focus:border-emerald-500"
              >
                {currencies.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Dates & Interest */}
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <label className="font-medium text-slate-300">Date Lent</label>
              <input
                type="date"
                required
                value={issueDate}
                onChange={(e) => setIssueDate(e.target.value)}
                className="w-full px-2.5 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-slate-100 focus:outline-hidden focus:border-emerald-500"
              />
            </div>
            <div className="space-y-1">
              <label className="font-medium text-slate-300">Expected Return</label>
              <input
                type="date"
                value={expectedDate}
                onChange={(e) => setExpectedDate(e.target.value)}
                className="w-full px-2.5 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-slate-100 focus:outline-hidden focus:border-emerald-500"
              />
            </div>
            <div className="space-y-1">
              <label className="font-medium text-slate-300">Interest (% p.a.)</label>
              <input
                type="number"
                min={0}
                step="any"
                placeholder="0"
                value={interestRatePct}
                onChange={(e) => setInterestRatePct(e.target.value === '' ? '' : Number(e.target.value))}
                className="w-full px-2.5 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-slate-100 font-mono focus:outline-hidden focus:border-emerald-500"
              />
            </div>
          </div>

          {/* Funding Source & Card Backing */}
          {!isEditing && (
            <div className="space-y-2.5 p-3 rounded-lg bg-slate-800/40 border border-slate-800">
              <label className="font-medium text-slate-300 flex items-center gap-1.5">
                <Landmark size={13} className="text-indigo-400" />
                Source Account or Card
              </label>

              {/* Legacy Opening Balance Checkbox */}
              <label className="flex items-start gap-2 p-2 rounded-lg bg-slate-900/80 border border-slate-700/80 text-[11px] text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isOpeningBalance}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setIsOpeningBalance(checked);
                    if (checked) {
                      setAutoDeductSource(false);
                    } else {
                      setAutoDeductSource(true);
                    }
                  }}
                  className="rounded border-slate-700 text-emerald-500 focus:ring-0 mt-0.5"
                />
                <div>
                  <span className="font-semibold text-cyan-300 block">Pre-Existing Loan / Opening Balance</span>
                  <span className="text-slate-400">
                    Money was lent before using NetWorthIQ. Records the receivable without creating a new cash disbursement or altering existing card/account balances.
                  </span>
                </div>
              </label>

              <div className="grid grid-cols-2 gap-2">
                <label
                  className={`p-2 rounded-lg border cursor-pointer text-center flex flex-col items-center gap-1 transition-all ${
                    fundingSourceType === 'holding'
                      ? 'bg-indigo-600/20 border-indigo-500 text-slate-100'
                      : 'bg-slate-800/40 border-slate-700 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <input
                    type="radio"
                    name="fundingType"
                    checked={fundingSourceType === 'holding'}
                    onChange={() => {
                      setFundingSourceType('holding');
                      setFundingSourceId(bankAccounts[0]?.id || '');
                    }}
                    className="sr-only"
                  />
                  <Landmark size={15} />
                  <span className="font-medium">Bank / Cash Account</span>
                </label>

                <label
                  className={`p-2 rounded-lg border cursor-pointer text-center flex flex-col items-center gap-1 transition-all ${
                    fundingSourceType === 'credit_card'
                      ? 'bg-amber-600/20 border-amber-500 text-slate-100'
                      : 'bg-slate-800/40 border-slate-700 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <input
                    type="radio"
                    name="fundingType"
                    checked={fundingSourceType === 'credit_card'}
                    onChange={() => {
                      setFundingSourceType('credit_card');
                      setFundingSourceId(creditCards[0]?.id || '');
                    }}
                    className="sr-only"
                  />
                  <CreditCard size={15} />
                  <span className="font-medium">Credit / Hybrid Card</span>
                </label>
              </div>

              {fundingSourceType === 'holding' ? (
                <select
                  value={fundingSourceId}
                  onChange={(e) => setFundingSourceId(e.target.value)}
                  className="w-full px-2.5 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-200"
                >
                  <option value="">Select funding bank / cash account...</option>
                  {bankAccounts.map((b) => {
                    const sym = currencies.find((c) => c.code === b.currency)?.symbol || '₹';
                    const { totalSweepIn } = getAccountLiquidityWithSweepIn(b.id);
                    return (
                      <option key={b.id} value={b.id}>
                        {formatAssetOptionLabel(b, assetTypes, {
                          currSymbol: sym,
                          sweepInAmount: totalSweepIn,
                        })}
                      </option>
                    );
                  })}
                </select>
              ) : (
                <select
                  value={fundingSourceId}
                  onChange={(e) => setFundingSourceId(e.target.value)}
                  className="w-full px-2.5 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-200"
                >
                  <option value="">Select funding card...</option>
                  {creditCards.map((c) => {
                    const sym = currencies.find((cur) => cur.code === c.currency)?.symbol || '₹';
                    return (
                      <option key={c.id} value={c.id}>
                        {formatCardOptionLabel(c, getCardEffectiveMode(c), sym)}
                      </option>
                    );
                  })}
                </select>
              )}

              {fundingSourceId && (
                <label className="flex items-center gap-2 text-[11px] text-slate-300 cursor-pointer pt-0.5">
                  <input
                    type="checkbox"
                    checked={autoDeductSource}
                    onChange={(e) => setAutoDeductSource(e.target.checked)}
                    className="rounded border-slate-700 text-emerald-500 focus:ring-0"
                  />
                  <span>
                    {fundingSourceType === 'holding'
                      ? `Deduct ${disbursedAmountNum > 0 ? fmt(totalDeductedFromSource) : 'amount'} from bank/cash balance now`
                      : `Deduct ${disbursedAmountNum > 0 ? fmt(totalDeductedFromSource) : 'amount'} from card limit / linked source now`}
                  </span>
                </label>
              )}
            </div>
          )}

          {/* Broker Name & Transfer / Brokerage Charges */}
          <div className="space-y-2.5 p-3 rounded-lg bg-slate-800/40 border border-slate-800">
            <div className="flex items-center justify-between">
              <label className="font-medium text-slate-300 flex items-center gap-1.5">
                <Building2 size={13} className="text-cyan-400" />
                Broker &amp; Transfer / Cash-Out Charges
              </label>
              <span className="text-[10px] text-slate-400">Optional</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-[11px] text-slate-400">Broker / Platform Name</label>
                <input
                  type="text"
                  list="known-brokers-datalist"
                  placeholder="e.g. Cred, NoBroker, Paytm, Local Desk"
                  value={brokerName}
                  onChange={(e) => setBrokerName(e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-slate-100 focus:outline-hidden focus:border-cyan-500"
                />
                <datalist id="known-brokers-datalist">
                  {(mlBrokerRecommendation?.knownBrokers || []).map((b) => (
                    <option key={b} value={b} />
                  ))}
                </datalist>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] text-slate-400">Fee Structure</label>
                <select
                  value={feeMode}
                  onChange={(e) => setFeeMode(e.target.value as any)}
                  className="w-full px-2.5 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-slate-100 focus:outline-hidden focus:border-cyan-500"
                >
                  <option value="none">No Additional Fee (0)</option>
                  <option value="percent">Percentage (e.g. 0.3% or 3%)</option>
                  <option value="per_unit">Fixed X per every N amount</option>
                  <option value="flat">Flat Fixed Charge</option>
                </select>
              </div>
            </div>

            {feeMode === 'percent' && (
              <div className="grid grid-cols-2 gap-2 pt-0.5">
                <div className="space-y-1">
                  <label className="text-[11px] text-slate-400">Charge Rate (%)</label>
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={feePct}
                    onChange={(e) => setFeePct(e.target.value)}
                    placeholder="0.3"
                    className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-slate-100 font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] text-slate-400">Computed Charge</label>
                  <div className="px-2.5 py-1.5 rounded-lg bg-slate-900/70 border border-slate-800 font-mono font-semibold text-amber-300">
                    +{fmt(calculatedFee)}
                  </div>
                </div>
              </div>
            )}

            {feeMode === 'per_unit' && (
              <div className="grid grid-cols-2 gap-2 pt-0.5">
                <div className="space-y-1">
                  <label className="text-[11px] text-slate-400">Fixed Charge (X)</label>
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={feePerUnitAmount}
                    onChange={(e) => setFeePerUnitAmount(e.target.value)}
                    placeholder="300"
                    className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-slate-100 font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] text-slate-400">For Every Amount (N)</label>
                  <input
                    type="number"
                    min={1}
                    step="any"
                    value={feeUnitSize}
                    onChange={(e) => setFeeUnitSize(e.target.value)}
                    placeholder="10000"
                    className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-slate-100 font-mono"
                  />
                </div>
              </div>
            )}

            {feeMode === 'flat' && (
              <div className="space-y-1 pt-0.5">
                <label className="text-[11px] text-slate-400">Flat Charge Amount</label>
                <input
                  type="number"
                  min={0}
                  step="any"
                  value={feePerUnitAmount}
                  onChange={(e) => setFeePerUnitAmount(e.target.value)}
                  placeholder="300"
                  className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-slate-100 font-mono"
                />
              </div>
            )}

            {calculatedFee > 0 && (
              <label className="flex items-start gap-2 text-[11px] text-slate-300 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={passFeeToBorrower}
                  onChange={(e) => setPassFeeToBorrower(e.target.checked)}
                  className="mt-0.5 rounded border-slate-700 text-emerald-500 focus:ring-0"
                />
                <span>
                  Charge belongs to borrower — recover {fmt(totalDeductedFromSource)} ({fmt(disbursedAmountNum)} lent +{' '}
                  {fmt(calculatedFee)} fee)
                </span>
              </label>
            )}

            {disbursedAmountNum > 0 && (
              <div className="p-2.5 rounded-lg bg-slate-900/90 border border-slate-700/80 grid grid-cols-3 gap-2 text-[11px]">
                <div>
                  <div className="text-slate-400">Net Lent</div>
                  <div className="font-mono font-semibold text-slate-200">{fmt(disbursedAmountNum)}</div>
                </div>
                <div>
                  <div className="text-slate-400">Source Deducted</div>
                  <div className="font-mono font-bold text-rose-300">-{fmt(totalDeductedFromSource)}</div>
                </div>
                <div>
                  <div className="text-slate-400">To Be Returned</div>
                  <div className="font-mono font-bold text-emerald-400">{fmt(totalReceivablePrincipal)}</div>
                </div>
              </div>
            )}

            {/* Live ML Card & Broker Recommendation */}
            {mlBrokerRecommendation?.bestOption &&
              (brokerName.trim().length > 0 || feeMode !== 'none' || fundingSourceType === 'credit_card') && (
                <div className="p-2.5 rounded-lg bg-indigo-950/35 border border-indigo-500/30 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-indigo-300 flex items-center gap-1 text-[11px]">
                      <Sparkles size={12} /> ML Card-Broker Fee Comparison
                    </span>
                    {!isEditing &&
                      mlBrokerRecommendation.bestOption.sourceId !== fundingSourceId &&
                      mlBrokerRecommendation.potentialSavings > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            setFundingSourceType('credit_card');
                            setFundingSourceId(mlBrokerRecommendation.bestOption!.sourceId);
                          }}
                          className="px-2 py-0.5 rounded bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-200 text-[10px] font-semibold cursor-pointer"
                        >
                          Use {mlBrokerRecommendation.bestOption.sourceName}
                        </button>
                      )}
                  </div>
                  <p className="text-[11px] text-slate-300 leading-relaxed">
                    {mlBrokerRecommendation.advisoryMessage}
                  </p>
                </div>
              )}
          </div>

          {/* Collection Confidence Slider */}
          <div className="space-y-1 p-2.5 rounded-lg bg-slate-800/40 border border-slate-800">
            <div className="flex items-center justify-between text-slate-300">
              <span className="font-medium">Collection Confidence:</span>
              <span
                className={`font-bold ${
                  confidencePct >= 80
                    ? 'text-emerald-400'
                    : confidencePct >= 50
                    ? 'text-amber-400'
                    : 'text-rose-400'
                }`}
              >
                {confidencePct}%
              </span>
            </div>
            <input
              type="range"
              min={10}
              max={100}
              step={5}
              value={confidencePct}
              onChange={(e) => setConfidencePct(Number(e.target.value))}
              className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-emerald-500"
            />
          </div>

          {/* Notes */}
          <div className="space-y-1">
            <label className="font-medium text-slate-300">Notes / Agreement</label>
            <input
              type="text"
              placeholder="e.g. Emergency help, promised return in 3 days"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-slate-100 focus:outline-hidden focus:border-emerald-500"
            />
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold transition-colors cursor-pointer"
            >
              {isEditing ? 'Save Changes' : 'Record Receivable'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

