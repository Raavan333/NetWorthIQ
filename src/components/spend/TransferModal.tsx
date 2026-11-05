import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { Modal } from '../common/Modal';
import { Holding, Transaction, ScheduledTransfer } from '../../types';
import { formatMoney } from '../../lib/formatters';
import {
  isFixedOrRecurringDeposit,
  isLockedOrMarketAsset,
  getSafeAssetName,
  getSafeLiabilityName,
  formatAssetOptionLabel,
  formatCardOptionLabel,
} from '../../lib/assetRules';
import { AlertCircle, AlertTriangle, Calendar, Building2, Sparkles } from 'lucide-react';
import { computeNextScheduledDate } from '../../lib/scheduledTransfers';
import { DatePickerField } from '../common/DatePickerField';
import {
  computeBrokerFeeAmount,
  recommendBestCardForBrokerAmount,
  getStoredClosedLoopMLState,
} from '../../lib/mlEngine';

interface TransferModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const TransferModal: React.FC<TransferModalProps> = ({ isOpen, onClose }) => {
  const {
    holdings,
    liabilities,
    assetTypes,
    currencies,
    transactions,
    receivables,
    addTransaction,
    addScheduledTransfer,
    updateHolding,
    getAccountLiquidityWithSweepIn,
    getCardEffectiveMode,
    breakSweepInForDeficit,
    logDebitCardAtmWithdrawal,
  } = useApp();

  // Cash or account transfer can never be made directly to and from FDs/RDs as they are locked deposits
  const isDepositAsset = (h: Holding) => isFixedOrRecurringDeposit(h, assetTypes);

  const validSources = [
    ...holdings
      .filter((h) => !isDepositAsset(h))
      .map((h) => {
        const sym = currencies.find((c) => c.code === h.currency)?.symbol || `${h.currency} `;
        const { totalSweepIn } = getAccountLiquidityWithSweepIn(h.id);
        return {
          id: h.id,
          name: formatAssetOptionLabel(h, assetTypes, { currSymbol: sym, sweepInAmount: totalSweepIn }),
          shortName: getSafeAssetName(h, assetTypes),
          currency: h.currency,
          type: 'asset' as const,
          cardType: undefined as 'credit' | 'debit' | 'hybrid' | undefined,
          raw: h,
        };
      }),
    ...liabilities
      .filter((l) => l.kind === 'card')
      .map((c) => {
        const sym = currencies.find((cur) => cur.code === c.currency)?.symbol || `${c.currency} `;
        return {
          id: c.id,
          name: formatCardOptionLabel(c, getCardEffectiveMode(c), sym),
          shortName: getSafeLiabilityName(c),
          currency: c.currency,
          type: 'card' as const,
          cardType: (c.cardType || 'credit') as 'credit' | 'debit' | 'hybrid' | undefined,
          raw: c,
        };
      }),
  ];

  const validDestinations = [
    ...holdings
      .filter((h) => !isDepositAsset(h))
      .map((h) => {
        const sym = currencies.find((c) => c.code === h.currency)?.symbol || `${h.currency} `;
        return {
          id: h.id,
          name: formatAssetOptionLabel(h, assetTypes, { currSymbol: sym }),
          shortName: getSafeAssetName(h, assetTypes),
          currency: h.currency,
          isHandCash: h.typeId === 'type-cash-hand' || h.typeId === 'type-cash',
          isLiabilityPaydown: false,
        };
      }),
    ...liabilities.map((l) => ({
      id: l.id,
      name: `${getSafeLiabilityName(l)} · Pay Down ${l.kind === 'card' ? 'Card' : 'Loan'} (${l.currency})`,
      shortName: getSafeLiabilityName(l),
      currency: l.currency,
      isHandCash: false,
      isLiabilityPaydown: true,
    })),
  ];

  const [fromId, setFromId] = useState(validSources[0]?.id || '');
  const [toId, setToId] = useState(validDestinations[1]?.id || validDestinations[0]?.id || '');
  const [amount, setAmount] = useState('');
  const [toAmount, setToAmount] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [reason, setReason] = useState('Account Transfer');
  const [customFxRate, setCustomFxRate] = useState('1.0');
  const [cashAdvanceFeePct, setCashAdvanceFeePct] = useState('2.5');
  const [brokerName, setBrokerName] = useState('');
  const [viaBrokerWithdrawal, setViaBrokerWithdrawal] = useState(false);
  const [brokerFeeMode, setBrokerFeeMode] = useState<'none' | 'percent' | 'per_unit' | 'flat'>('percent');
  const [brokerFeePerUnit, setBrokerFeePerUnit] = useState('300');
  const [brokerFeeUnitSize, setBrokerFeeUnitSize] = useState('10000');
  const [error, setError] = useState('');
  const [isScheduled, setIsScheduled] = useState(false);
  const [schedFrequency, setSchedFrequency] = useState<'monthly' | 'quarterly' | 'once'>('monthly');

  const [usedDebitCard, setUsedDebitCard] = useState(false);
  const [selectedDebitCardId, setSelectedDebitCardId] = useState('');
  const [atmZone, setAtmZone] = useState<'non_metro' | 'metro'>('non_metro');

  const debitCards = liabilities.filter(
    (l) => l.kind === 'card' && (l.cardType === 'debit' || l.cardType === 'hybrid')
  );

  useEffect(() => {
    if (!fromId || !validSources.some((s) => s.id === fromId)) {
      if (validSources[0]) setFromId(validSources[0].id);
    }
    if (!toId || !validDestinations.some((d) => d.id === toId)) {
      const alt = validDestinations.find((d) => d.id !== fromId) || validDestinations[0];
      if (alt) setToId(alt.id);
    }
  }, [holdings, liabilities]);

  useEffect(() => {
    if (debitCards.length > 0 && !selectedDebitCardId) {
      setSelectedDebitCardId(debitCards[0].id);
    }
  }, [debitCards, selectedDebitCardId]);

  useEffect(() => {
    if (usedDebitCard && selectedDebitCardId) {
      const card = debitCards.find((c) => c.id === selectedDebitCardId);
      if (card && card.linkedAccountId) {
        setFromId(card.linkedAccountId);
      }
    }
  }, [usedDebitCard, selectedDebitCardId, debitCards]);

  const fromAcc = validSources.find((a) => a.id === fromId);
  const toAcc = validDestinations.find((a) => a.id === toId);
  const isCrossCurrency = fromAcc && toAcc && fromAcc.currency !== toAcc.currency;

  const isFromCreditCard =
    fromAcc?.type === 'card' &&
    (fromAcc.cardType === 'credit' ||
      (fromAcc.cardType === 'hybrid' && getCardEffectiveMode(fromAcc.raw as any) === 'credit'));
  const isFromDebitCard = fromAcc?.type === 'card' && fromAcc.cardType === 'debit';
  const isToHandCash = toAcc?.isHandCash;
  const isToBankOrAsset = toAcc && !toAcc.isLiabilityPaydown && !toAcc.isHandCash;
  const isToLiabilityPaydown = Boolean(toAcc?.isLiabilityPaydown);

  const handleAmountChange = (val: string) => {
    setAmount(val);
    const num = parseFloat(val);
    if (!isNaN(num) && isCrossCurrency) {
      const rate = parseFloat(customFxRate) || 1.0;
      setToAmount((num * rate).toFixed(2));
    }
  };

  const handleRateChange = (rateVal: string) => {
    setCustomFxRate(rateVal);
    const num = parseFloat(amount);
    const rate = parseFloat(rateVal) || 1.0;
    if (!isNaN(num)) {
      setToAmount((num * rate).toFixed(2));
    }
  };

  const amtPreview = Math.max(0, parseFloat(amount) || 0);
  const isPersonalBrokerEligible = Boolean(
    isToHandCash || (isFromCreditCard && isToBankOrAsset) || viaBrokerWithdrawal
  );

  const previewCalculatedFee = (() => {
    if (amtPreview <= 0) return 0;
    if (isFromCreditCard && (isToHandCash || (isToBankOrAsset && viaBrokerWithdrawal))) {
      const mode = brokerFeeMode === 'none' ? 'none' : brokerFeeMode;
      return computeBrokerFeeAmount(amtPreview, mode, {
        feePct: parseFloat(cashAdvanceFeePct) || 0,
        feePerUnitAmount: parseFloat(brokerFeePerUnit) || 0,
        feeUnitSize: parseFloat(brokerFeeUnitSize) || 10000,
        flatFee: parseFloat(brokerFeePerUnit) || 0,
      });
    }
    if (viaBrokerWithdrawal && brokerFeeMode !== 'none') {
      return computeBrokerFeeAmount(amtPreview, brokerFeeMode, {
        feePct: parseFloat(cashAdvanceFeePct) || 0,
        feePerUnitAmount: parseFloat(brokerFeePerUnit) || 0,
        feeUnitSize: parseFloat(brokerFeeUnitSize) || 10000,
        flatFee: parseFloat(brokerFeePerUnit) || 0,
      });
    }
    return 0;
  })();

  const fromCurrSym = currencies.find((c) => c.code === fromAcc?.currency)?.symbol || '₹';
  const mlBrokerRec =
    amtPreview > 0 && (isFromCreditCard || viaBrokerWithdrawal || brokerName.trim().length > 0)
      ? recommendBestCardForBrokerAmount({
          amountNeeded: amtPreview,
          liabilities,
          holdings,
          assetTypes,
          transactions,
          receivables,
          preferredBrokerName: brokerName,
          selectedSourceId: fromId,
          currentEnteredFee: previewCalculatedFee,
          activeStrategy: getStoredClosedLoopMLState().activeStrategy,
          currSymbol: fromCurrSym,
        })
      : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fromId || !toId || !validSources.some((s) => s.id === fromId) || !validDestinations.some((d) => d.id === toId)) {
      setError('A valid source and destination account are required. Please define and add your financial accounts first.');
      return;
    }
    if (fromId === toId) {
      setError('Source and destination accounts must be different');
      return;
    }
    const amtNum = parseFloat(amount);
    if (isNaN(amtNum) || amtNum <= 0) {
      setError('Please enter a valid transfer amount');
      return;
    }

    // Rule: Debit card can ONLY be used to pay bills and withdraw cash, not internal transfers
    if (isFromDebitCard && isToBankOrAsset) {
      setError('Debit cards can only be used to pay bills and withdraw cash, not for internal account transfers.');
      return;
    }

    // Rule: Credit cards can NEVER pay down debt obligations ("not killing a bill with another bill").
    // Card-to-bank transfers are only permitted when explicitly routed as a brokered cash-out withdrawal.
    if (isFromCreditCard && isToLiabilityPaydown) {
      setError(
        'Loans and card balances cannot be paid down using a credit card or credit limit. Select a positive liquid cash or bank account.'
      );
      return;
    }
    if (isFromCreditCard && isToBankOrAsset && !viaBrokerWithdrawal) {
      setError(
        'Direct free credit-card-to-bank transfers are not permitted. Enable "Brokered Card-to-Bank Withdrawal" below to record the broker name and charges.'
      );
      return;
    }

    // Rule: Locked & market-linked assets cannot pay down liabilities directly
    const sourceHoldingCheck = holdings.find((h) => h.id === fromId);
    if (isToLiabilityPaydown && sourceHoldingCheck && isLockedOrMarketAsset(sourceHoldingCheck, assetTypes)) {
      setError(
        `Locked or market-linked holdings ("${getSafeAssetName(sourceHoldingCheck, assetTypes)}") cannot be used directly to pay down loans or credit card bills. Select a positive liquid cash or bank account.`
      );
      return;
    }

    // Rule: Sweep-in and Fixed Deposits cannot receive funds
    const destHolding = holdings.find((h) => h.id === toId);
    if (destHolding && isDepositAsset(destHolding)) {
      setError('Fixed Deposits and Sweep-In FDs cannot be incremented once created. They can only be broken in bits or redeemed completely to an account.');
      return;
    }

    // If scheduled transfer is enabled, register the schedule and wait for the target date
    if (isScheduled) {
      const schedDay = parseInt(date.split('-')[2], 10) || 1;
      const today = new Date();
      const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      const nextDate = computeNextScheduledDate(schedDay, schedFrequency, today);
      const currentYearMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;

      const newTransfer: ScheduledTransfer = {
        id: `sched-${Date.now()}`,
        name: reason.trim() || `Transfer to ${toAcc?.name || 'Account'}`,
        fromId,
        toId,
        amount: amtNum,
        currency: fromAcc?.currency || 'INR',
        dayOfMonth: schedDay,
        frequency: schedFrequency,
        isActive: true,
        createdAt: todayStr,
        nextExecutionDate: nextDate,
        lastExecutedMonth: today.getDate() > schedDay ? currentYearMonth : undefined,
      };

      await addScheduledTransfer(newTransfer);
      onClose();
      return;
    }

    let calculatedFee = 0;
    const activeFeeMode =
      isFromCreditCard && (isToHandCash || (isToBankOrAsset && viaBrokerWithdrawal))
        ? brokerFeeMode
        : viaBrokerWithdrawal
        ? brokerFeeMode
        : 'none';

    if (activeFeeMode !== 'none') {
      calculatedFee = computeBrokerFeeAmount(amtNum, activeFeeMode, {
        feePct: parseFloat(cashAdvanceFeePct) || 0,
        feePerUnitAmount: parseFloat(brokerFeePerUnit) || 0,
        feeUnitSize: parseFloat(brokerFeeUnitSize) || 10000,
        flatFee: parseFloat(brokerFeePerUnit) || 0,
      });
    }

    const totalNeeded = Math.round((amtNum + calculatedFee) * 100) / 100;

    // Validate capacity on source asset OR source card
    const { asset: fromHold, balance: avail, totalSweepIn, totalAvailable } = getAccountLiquidityWithSweepIn(fromId);
    if (fromHold) {
      if (totalAvailable < totalNeeded) {
        setError(
          `Insufficient funds in ${fromHold.name}. Available balance: ${avail.toLocaleString()} ${fromHold.currency} (+ ${totalSweepIn.toLocaleString()} in Sweep-in FDs = ${totalAvailable.toLocaleString()} total), but transfer requires: ${totalNeeded.toLocaleString()} ${fromHold.currency}.`
        );
        return;
      }
      if (avail < totalNeeded) {
        const deficit = totalNeeded - Math.max(0, avail);
        const sweepRes = await breakSweepInForDeficit(
          fromHold.id,
          deficit,
          `Transfer: ${toAcc?.shortName || toAcc?.name || 'Destination'}`
        );
        if (!sweepRes.success) {
          setError(sweepRes.error || 'Failed to auto-break sweep-in');
          return;
        }
      }
    } else if (fromAcc?.type === 'card') {
      const card = liabilities.find((l) => l.id === fromId && l.kind === 'card');
      if (card) {
        const creditAvail = Math.max(0, (card.creditLimit ?? card.limit ?? 0) - (card.outstanding || 0));
        let cardTotalCap = creditAvail;
        if (card.cardType === 'hybrid' && card.linkedAccountId) {
          const { totalAvailable: linkedCap } = getAccountLiquidityWithSweepIn(card.linkedAccountId);
          cardTotalCap = Math.max(0, linkedCap) + creditAvail;
        } else if (card.cardType === 'debit' && card.linkedAccountId) {
          const { balance: linkedBal } = getAccountLiquidityWithSweepIn(card.linkedAccountId);
          cardTotalCap = Math.max(0, linkedBal);
        }
        if (cardTotalCap < totalNeeded) {
          setError(
            `Insufficient capacity on ${getSafeLiabilityName(card)}: ${cardTotalCap.toLocaleString()} ${card.currency} available, ${totalNeeded.toLocaleString()} ${card.currency} required.`
          );
          return;
        }
      }
    }

    if (isToHandCash && usedDebitCard && selectedDebitCardId) {
      await logDebitCardAtmWithdrawal(selectedDebitCardId, atmZone);
    }

    const cleanBroker = brokerName.trim() || undefined;
    const netReceived = isCrossCurrency ? parseFloat(toAmount) || amtNum : amtNum;
    const tx: Transaction = {
      id: `tx-trans-${Date.now()}`,
      date,
      kind: 'transfer',
      amount: totalNeeded,
      currency: fromAcc?.currency || 'INR',
      fromId,
      toId,
      reason:
        (isFromCreditCard && (isToHandCash || viaBrokerWithdrawal)) || cleanBroker
          ? `${isToHandCash ? 'Cash Withdrawal' : 'Brokered Withdrawal'} from ${fromAcc?.shortName || fromAcc?.name}${
              cleanBroker ? ` via ${cleanBroker}` : ''
            }${calculatedFee > 0 ? ` (Fee: ${calculatedFee})` : ''}`
          : isToHandCash && usedDebitCard
          ? `ATM Cash Withdrawal via Debit Card from ${fromAcc?.shortName || fromAcc?.name}`
          : reason.trim() || 'Internal Transfer',
      category: isToHandCash || (isFromCreditCard && viaBrokerWithdrawal) ? 'Cash Withdrawal' : 'Transfer',
      fxRateUsed: parseFloat(customFxRate) || 1.0,
      toAmount: netReceived,
      paymentMode: usedDebitCard ? 'debit_card' : 'upi',
      isDebitCardPayment: usedDebitCard,
      atmZone: usedDebitCard ? atmZone : undefined,
      brokerName: cleanBroker,
      brokerageFee: calculatedFee > 0 ? calculatedFee : undefined,
      brokerFeeMode: activeFeeMode !== 'none' ? activeFeeMode : undefined,
      brokerFeePct: activeFeeMode === 'percent' ? parseFloat(cashAdvanceFeePct) || 0 : undefined,
      brokerFeePerUnit:
        activeFeeMode === 'per_unit' || activeFeeMode === 'flat'
          ? parseFloat(brokerFeePerUnit) || 0
          : undefined,
      brokerFeeUnitSize: activeFeeMode === 'per_unit' ? parseFloat(brokerFeeUnitSize) || 10000 : undefined,
    };

    await addTransaction(tx);

    // If destination is hand cash, record withdrawal source on the live holding without reverting its new balance
    if (isToHandCash && toAcc) {
      const { asset: liveTarget } = getAccountLiquidityWithSweepIn(toId);
      if (liveTarget) {
        await updateHolding({
          ...liveTarget,
          withdrawnFromSourceId: fromAcc?.shortName || fromAcc?.name,
          cashAdvanceFee: calculatedFee > 0 ? calculatedFee : undefined,
        });
      }
    }

    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Transfer Money & Cash Withdrawals"
      subtitle="Bank to bank, cash on hand withdrawals, or card pay-downs"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-2.5 rounded-xl bg-rose-500/20 text-rose-300 text-xs flex items-center gap-1.5">
            <AlertCircle size={15} className="shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">
              Transfer From (Source)
              {usedDebitCard && isToHandCash && (
                <span className="text-[10px] text-cyan-400 ml-1.5 font-bold">
                  (Locked to debit card&apos;s linked bank account)
                </span>
              )}
            </label>
            <select
              value={fromId}
              onChange={(e) => setFromId(e.target.value)}
              disabled={usedDebitCard && isToHandCash}
              className={`w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200 ${
                usedDebitCard && isToHandCash
                  ? 'opacity-80 cursor-not-allowed bg-slate-900 border-cyan-500/40 text-cyan-200'
                  : ''
              }`}
              required
            >
              {validSources.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <p className="text-[10px] text-slate-500 mt-1">
              {usedDebitCard && isToHandCash
                ? 'ATM cash withdrawal strictly pulls from linked bank account only (not FD, not credit card, not stocks).'
                : 'Outstanding term loans cannot be sources of funds.'}
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Transfer To (Destination)</label>
            <select
              value={toId}
              onChange={(e) => setToId(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200"
              required
            >
              {validDestinations.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Cash Withdrawal Debit Card Questionnaire (Per User Specification) */}
        {isToHandCash && (
          <div className="p-3.5 rounded-2xl bg-cyan-950/25 border border-cyan-500/40 space-y-3 animate-fade-in">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={usedDebitCard}
                onChange={(e) => setUsedDebitCard(e.target.checked)}
                className="w-4 h-4 rounded text-cyan-500 bg-slate-900 border-slate-700 focus:ring-cyan-400 cursor-pointer"
              />
              <span className="text-xs font-bold text-cyan-200">
                Did you use a Debit Card to withdraw cash at an ATM?
              </span>
            </label>

            {usedDebitCard && (
              <div className="space-y-3 pt-1 border-t border-cyan-800/40 animate-fade-in">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Select Debit Card (Strictly draws from its linked bank account)
                  </label>
                  {debitCards.length === 0 ? (
                    <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs">
                      No debit or hybrid cards registered. Please add a debit card in Liabilities &amp; Debt tab first.
                    </div>
                  ) : (
                    <select
                      value={selectedDebitCardId}
                      onChange={(e) => {
                        setSelectedDebitCardId(e.target.value);
                        const c = debitCards.find((dc) => dc.id === e.target.value);
                        if (c && c.linkedAccountId) setFromId(c.linkedAccountId);
                      }}
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
                      required
                    >
                      {debitCards.map((c) => {
                        const linked = holdings.find((h) => h.id === c.linkedAccountId);
                        return (
                          <option key={c.id} value={c.id}>
                            {getSafeLiabilityName(c)} {linked ? `— Linked Bank: ${getSafeAssetName(linked, assetTypes)}` : ''}
                          </option>
                        );
                      })}
                    </select>
                  )}
                  <p className="text-[10px] text-slate-400 mt-1">
                    <strong>Account Rule:</strong> Each debit card can only withdraw cash from its linked bank account (not FD, credit card, or stocks).
                  </p>
                </div>

                <div className="flex items-center gap-4 text-xs text-slate-300 pt-1">
                  <span className="text-slate-400">ATM Location:</span>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="transferAtmZone"
                      checked={atmZone === 'non_metro'}
                      onChange={() => setAtmZone('non_metro')}
                      className="text-cyan-500"
                    />
                    <span>Non-Metro ATM (3 free/mo)</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="transferAtmZone"
                      checked={atmZone === 'metro'}
                      onChange={() => setAtmZone('metro')}
                      className="text-cyan-500"
                    />
                    <span>Metro ATM (5 free/mo)</span>
                  </label>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Broker & Cash Advance / Card-to-Bank Withdrawal Section */}
        {!isToLiabilityPaydown && (isToHandCash || isFromCreditCard || viaBrokerWithdrawal) && (
          <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 font-bold text-xs text-amber-300">
                <Building2 size={15} />
                <span>
                  {isFromCreditCard && isToBankOrAsset
                    ? 'Brokered Card-to-Bank Withdrawal'
                    : 'Personal Withdrawal Broker & Fee Details'}
                </span>
              </div>
              {!isToHandCash && (
                <label className="flex items-center gap-1.5 text-[11px] text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={viaBrokerWithdrawal}
                    onChange={(e) => setViaBrokerWithdrawal(e.target.checked)}
                    className="rounded border-slate-700 text-amber-500"
                  />
                  <span>Routed via Broker / Platform</span>
                </label>
              )}
            </div>

            {isFromCreditCard && isToBankOrAsset && !viaBrokerWithdrawal && (
              <p className="text-[11px] text-rose-300">
                Direct free credit-card-to-bank transfers are blocked. Check &quot;Routed via Broker / Platform&quot; to record a brokered card-to-account withdrawal and its fee.
              </p>
            )}

            {(isToHandCash || viaBrokerWithdrawal) && (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[10px] text-slate-400 mb-0.5">Broker / Platform Name</label>
                    <input
                      type="text"
                      list="transfer-brokers-datalist"
                      placeholder="e.g. Cred, Paytm, NoBroker, ATM"
                      value={brokerName}
                      onChange={(e) => setBrokerName(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
                    />
                    <datalist id="transfer-brokers-datalist">
                      {(mlBrokerRec?.knownBrokers || []).map((b) => (
                        <option key={b} value={b} />
                      ))}
                    </datalist>
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-400 mb-0.5">Brokerage / Fee Structure</label>
                    <select
                      value={brokerFeeMode}
                      onChange={(e) => setBrokerFeeMode(e.target.value as any)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
                    >
                      <option value="none">No Fee (0)</option>
                      <option value="percent">Percentage (e.g. 0.3% or 2.5%)</option>
                      <option value="per_unit">Fixed X per every N amount</option>
                      <option value="flat">Flat Fixed Fee</option>
                    </select>
                  </div>
                </div>

                {brokerFeeMode === 'percent' && (
                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-[10px] text-slate-400 mb-0.5">Fee Rate (%)</label>
                      <input
                        type="number"
                        step="any"
                        min={0}
                        value={cashAdvanceFeePct}
                        onChange={(e) => setCashAdvanceFeePct(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-400 mb-0.5">Source Deduction (Principal + Fee)</label>
                      <div className="text-xs font-mono font-bold text-rose-400 pt-1.5">
                        {formatMoney(amtPreview + previewCalculatedFee, fromAcc?.currency, fromCurrSym)} (+
                        {formatMoney(previewCalculatedFee, fromAcc?.currency, fromCurrSym)} fee)
                      </div>
                    </div>
                  </div>
                )}

                {brokerFeeMode === 'per_unit' && (
                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-[10px] text-slate-400 mb-0.5">Fixed Fee (X)</label>
                      <input
                        type="number"
                        step="any"
                        min={0}
                        value={brokerFeePerUnit}
                        onChange={(e) => setBrokerFeePerUnit(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-400 mb-0.5">Per Every Amount (N)</label>
                      <input
                        type="number"
                        step="any"
                        min={1}
                        value={brokerFeeUnitSize}
                        onChange={(e) => setBrokerFeeUnitSize(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono"
                      />
                    </div>
                  </div>
                )}

                {brokerFeeMode === 'flat' && (
                  <div>
                    <label className="block text-[10px] text-slate-400 mb-0.5">Flat Fee Amount</label>
                    <input
                      type="number"
                      step="any"
                      min={0}
                      value={brokerFeePerUnit}
                      onChange={(e) => setBrokerFeePerUnit(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono"
                    />
                  </div>
                )}

                {mlBrokerRec?.bestOption && (
                  <div className="p-2.5 rounded-lg bg-indigo-950/45 border border-indigo-500/35 text-[11px] space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-indigo-300 flex items-center gap-1">
                        <Sparkles size={12} /> ML Card-Broker Recommendation
                      </span>
                      {mlBrokerRec.bestOption.sourceId !== fromId && mlBrokerRec.potentialSavings > 0 && (
                        <button
                          type="button"
                          onClick={() => setFromId(mlBrokerRec.bestOption!.sourceId)}
                          className="px-2 py-0.5 rounded bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-200 text-[10px] font-semibold cursor-pointer"
                        >
                          Switch to {mlBrokerRec.bestOption.sourceName}
                        </button>
                      )}
                    </div>
                    <p className="text-slate-300 leading-relaxed">{mlBrokerRec.advisoryMessage}</p>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {!isToHandCash && !isFromCreditCard && !isToLiabilityPaydown && !viaBrokerWithdrawal && (
          <div className="flex items-center justify-end">
            <button
              type="button"
              onClick={() => setViaBrokerWithdrawal(true)}
              className="text-[11px] text-cyan-400 hover:text-cyan-300 underline cursor-pointer"
            >
              + Record broker name &amp; brokerage charges for this withdrawal
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">
              Amount ({fromAcc?.currency})
            </label>
            <input
              type="number"
              step="any"
              placeholder="0.00"
              value={amount}
              onChange={(e) => handleAmountChange(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200 font-mono"
              required
            />
          </div>

          <DatePickerField
            label="Transfer Date"
            value={date}
            onChange={(d) => setDate(d)}
            required
            placeholder="Select date or type DD/MM/YYYY"
          />
        </div>

        {/* Cross Currency Configuration */}
        {isCrossCurrency && (
          <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 space-y-3">
            <div className="text-xs font-semibold text-cyan-400">
              Cross-Currency Transfer: {fromAcc?.currency} ➔ {toAcc?.currency}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Exchange Rate (1 {fromAcc?.currency} =) </label>
                <input
                  type="number"
                  step="any"
                  value={customFxRate}
                  onChange={(e) => handleRateChange(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-1.5 text-xs text-slate-200 font-mono"
                />
              </div>

              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Amount Received ({toAcc?.currency})</label>
                <input
                  type="number"
                  step="any"
                  value={toAmount}
                  onChange={(e) => setToAmount(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-1.5 text-xs text-slate-200 font-mono"
                />
              </div>
            </div>
            <p className="text-[10px] text-slate-500">
              FX rate is locked permanently to this transaction record and never altered by future rate changes.
            </p>
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1">Reason / Note</label>
          <input
            type="text"
            placeholder="e.g. ATM withdrawal, savings allocation, debt payment"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200"
          />
        </div>

        {/* Schedule Recurring / Future Option */}
        <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 space-y-2.5">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={isScheduled}
              onChange={(e) => setIsScheduled(e.target.checked)}
              className="w-4 h-4 rounded text-cyan-500 bg-slate-900 border-slate-700 focus:ring-cyan-400 cursor-pointer"
            />
            <span className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
              <Calendar size={13} className="text-cyan-400" />
              <span>Schedule as auto-transfer (wait for target date)</span>
            </span>
          </label>

          {isScheduled && (
            <div className="pt-2 border-t border-slate-800/80 space-y-2 animate-fade-in text-xs">
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Frequency</label>
                <select
                  value={schedFrequency}
                  onChange={(e) => setSchedFrequency(e.target.value as any)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
                >
                  <option value="monthly">Monthly (Every month on the {parseInt(date.split('-')[2], 10) || 1}th)</option>
                  <option value="quarterly">Quarterly (Every 3 months)</option>
                  <option value="once">One-Time (Wait until {date})</option>
                </select>
              </div>
              <p className="text-[11px] text-cyan-300">
                Balances will remain untouched today. The system will strictly wait for the scheduled date before executing.
              </p>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 text-xs font-semibold cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-md shadow-emerald-600/20 cursor-pointer"
          >
            {isScheduled ? 'Save Scheduled Transfer' : 'Confirm Transfer'}
          </button>
        </div>
      </form>
    </Modal>
  );
};
