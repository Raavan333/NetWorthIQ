import React, { useState, useEffect, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { Bill, ExternalInflowCategory } from '../../types';
import { formatMoney } from '../../lib/formatters';
import {
  isSpendableLiquidHolding,
  getSafeAssetName,
  getSafeLiabilityName,
  formatAssetOptionLabel,
  formatCardOptionLabel,
} from '../../lib/assetRules';
import { Modal } from '../common/Modal';
import {
  Zap,
  CreditCard,
  Building2,
  Check,
  AlertCircle,
  Smartphone,
  ShieldCheck,
  Layers,
  Sparkles,
  Gift,
  HeartHandshake,
  Handshake,
} from 'lucide-react';
import { simulateLoanPrepayment } from '../../lib/loanPrepaymentEngine';
import { groupReceivablesByCounterparty } from '../../lib/counterpartyEngine';

interface PayBillModalProps {
  isOpen: boolean;
  onClose: () => void;
  bill: Bill;
  onSuccess?: (msg: string) => void;
  onError?: (msg: string) => void;
}

export const PayBillModal: React.FC<PayBillModalProps> = ({
  isOpen,
  onClose,
  bill,
  onSuccess,
  onError,
}) => {
  const {
    holdings,
    liabilities,
    receivables,
    assetTypes,
    currencies,
    settings,
    postBill,
    recordExternalInflow,
    counterpartyPaidMyBill,
    predictLoanPayment,
    getAccountLiquidityWithSweepIn,
    getCardEffectiveMode,
  } = useApp();

  const [payerRoute, setPayerRoute] = useState<'self' | 'peer_offset' | 'external_gift'>('self');
  const isExternalPayer = payerRoute === 'external_gift';
  const isPeerOffsetPayer = payerRoute === 'peer_offset';
  const [peerPayerName, setPeerPayerName] = useState('');
  const [externalPayerName, setExternalPayerName] = useState('Loved One');
  const [externalPayerCategory, setExternalPayerCategory] = useState<ExternalInflowCategory>('Gift');

  const activePeers = useMemo(
    () =>
      groupReceivablesByCounterparty(receivables).filter(
        (g) => g.status === 'active' && Math.abs(g.netBalance) > 0.01
      ),
    [receivables]
  );

  useEffect(() => {
    if (!isOpen) return;
    setPayerRoute('self');
    if (!peerPayerName && activePeers[0]) {
      setPeerPayerName(activePeers[0].name);
    }
  }, [isOpen, bill.id]);

  const isLoanBill = Boolean(
    bill.isAutoLiabilityBill && bill.liabilityKind === 'loan' && bill.liabilityId
  );
  const targetLoan = useMemo(
    () =>
      isLoanBill && bill.liabilityId
        ? liabilities.find((l) => l.id === bill.liabilityId && l.kind === 'loan')
        : undefined,
    [isLoanBill, bill.liabilityId, liabilities]
  );
  const predictedLoanPlan = useMemo(
    () => (isLoanBill && bill.liabilityId ? predictLoanPayment(bill.liabilityId) : null),
    [isLoanBill, bill.liabilityId, liabilities, holdings, settings, predictLoanPayment]
  );

  const hasPredictedExtraSlice = Boolean(
    predictedLoanPlan && predictedLoanPlan.extraPrincipalSlice > 0.5
  );
  const [loanBillMode, setLoanBillMode] = useState<'predicted' | 'scheduled'>(() =>
    settings.enableSubtleGuidanceFraming !== false ? 'predicted' : 'scheduled'
  );

  useEffect(() => {
    if (!isOpen) return;
    setLoanBillMode(
      settings.enableSubtleGuidanceFraming !== false && hasPredictedExtraSlice
        ? 'predicted'
        : 'scheduled'
    );
  }, [isOpen, bill.id, hasPredictedExtraSlice, settings.enableSubtleGuidanceFraming]);

  // Credit cards & Hybrid credit lines can pay regular bills, NEVER debt/liability/peer bills and NEVER goal contributions
  const canUseCreditFacility =
    !bill.isAutoLiabilityBill && !bill.isGoalContributionBill && !bill.isPeerBorrowBill;

  // Strictly unlocked liquid cash & bank holdings (excludes FD, Sweep-In FD, RD, Stocks, Bonds, Mutual Funds, P2P)
  const spendableHoldings = useMemo(
    () => holdings.filter((h) => isSpendableLiquidHolding(h, assetTypes)),
    [holdings, assetTypes]
  );

  // Eligible Credit & Hybrid Cards for direct bill settlement (only on non-debt, non-goal bills)
  const eligibleCreditAndHybridCards = useMemo(
    () =>
      canUseCreditFacility
        ? liabilities.filter((l) => l.kind === 'card' && l.cardType !== 'debit')
        : [],
    [liabilities, canUseCreditFacility]
  );

  // Debit & Hybrid cards for bank-rail payment tracking
  const debitCards = useMemo(
    () =>
      liabilities.filter(
        (l) => l.kind === 'card' && (l.cardType === 'debit' || l.cardType === 'hybrid')
      ),
    [liabilities]
  );

  const resolveDefaultSourceId = () => {
    if (
      isLoanBill &&
      predictedLoanPlan?.recommendedAssetId &&
      spendableHoldings.some((h) => h.id === predictedLoanPlan.recommendedAssetId)
    ) {
      return predictedLoanPlan.recommendedAssetId;
    }
    if (
      bill.sourceId &&
      (spendableHoldings.some((h) => h.id === bill.sourceId) ||
        eligibleCreditAndHybridCards.some((c) => c.id === bill.sourceId))
    ) {
      return bill.sourceId;
    }
    const positiveLiquid = spendableHoldings.find((h) => (h.principalOrValue || 0) > 0);
    if (positiveLiquid) return positiveLiquid.id;
    if (spendableHoldings[0]) return spendableHoldings[0].id;
    if (eligibleCreditAndHybridCards[0]) return eligibleCreditAndHybridCards[0].id;
    return '';
  };

  const [selectedSourceId, setSelectedSourceId] = useState<string>(resolveDefaultSourceId);
  const [paymentMode, setPaymentMode] = useState<
    'upi' | 'hybrid_card' | 'debit_card' | 'netbanking' | 'cheque'
  >('upi');
  const [selectedDebitCardId, setSelectedDebitCardId] = useState<string>('');
  const [atmZone, setAtmZone] = useState<'non_metro' | 'metro'>('non_metro');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync selectedSourceId whenever bill or valid sources change
  useEffect(() => {
    const isValidLiquid = spendableHoldings.some((h) => h.id === selectedSourceId);
    const isValidCard = eligibleCreditAndHybridCards.some((c) => c.id === selectedSourceId);
    if (!selectedSourceId || (!isValidLiquid && !isValidCard)) {
      setSelectedSourceId(resolveDefaultSourceId());
    }
  }, [bill.id, bill.sourceId, spendableHoldings, eligibleCreditAndHybridCards]);

  // Check if user selected a Credit Card or Hybrid Card directly as the source
  const directSelectedCard = eligibleCreditAndHybridCards.find((c) => c.id === selectedSourceId);
  const directCardMode = directSelectedCard ? getCardEffectiveMode(directSelectedCard) : null;

  // Linked Hybrid Card when a Bank Account is selected
  const linkedHybridCard = !directSelectedCard
    ? liabilities.find(
        (l) =>
          l.kind === 'card' &&
          l.cardType === 'hybrid' &&
          l.linkedAccountId === selectedSourceId
      )
    : undefined;

  // Pre-select debit/hybrid card linked to the chosen bank account
  useEffect(() => {
    if (!directSelectedCard && debitCards.length > 0) {
      const linked = debitCards.find((c) => c.linkedAccountId === selectedSourceId);
      if (linked) {
        setSelectedDebitCardId(linked.id);
      } else if (!selectedDebitCardId || !debitCards.some((c) => c.id === selectedDebitCardId)) {
        setSelectedDebitCardId(debitCards[0].id);
      }
    }
  }, [selectedSourceId, debitCards, directSelectedCard]);

  const currSym = currencies.find((c) => c.code === bill.currency)?.symbol || bill.currency;

  const sourceAsset = !directSelectedCard
    ? spendableHoldings.find((h) => h.id === selectedSourceId)
    : undefined;

  // Liquidity calculations for liquid holding (or Hybrid Card's strictly linked bank account)
  const effectiveHoldingId =
    directSelectedCard?.cardType === 'hybrid'
      ? directSelectedCard.linkedAccountId || ''
      : selectedSourceId;

  const {
    asset: resolvedBankAsset,
    balance,
    totalSweepIn,
    totalAvailable,
    sweepInFds,
  } = effectiveHoldingId
    ? getAccountLiquidityWithSweepIn(effectiveHoldingId)
    : { asset: undefined, balance: 0, totalSweepIn: 0, totalAvailable: 0, sweepInFds: [] };

  // Direct Card Credit Limit calculations
  const directCardLimit = directSelectedCard
    ? directSelectedCard.creditLimit || directSelectedCard.limit || 100000
    : 0;
  const directCardAvailCredit = directSelectedCard
    ? Math.max(0, directCardLimit - (directSelectedCard.outstanding || 0))
    : 0;

  // Bank-selected Hybrid Card calculations
  const activeHybridCard =
    directSelectedCard?.cardType === 'hybrid' ? directSelectedCard : linkedHybridCard;
  const hybridCreditLimit = activeHybridCard
    ? activeHybridCard.creditLimit || activeHybridCard.limit || 50000
    : 0;
  const hybridAvailableCredit = activeHybridCard
    ? Math.max(0, hybridCreditLimit - (activeHybridCard.outstanding || 0))
    : 0;

  const activeLoanPrincipalAmount =
    isLoanBill && loanBillMode === 'predicted' && predictedLoanPlan
      ? predictedLoanPlan.recommendedAmount
      : bill.amount;

  const activeLoanPenaltyAmount =
    isLoanBill &&
    loanBillMode === 'predicted' &&
    predictedLoanPlan &&
    predictedLoanPlan.extraPrincipalSlice > 0.5
      ? predictedLoanPlan.projectedPenaltyCharge
      : 0;

  const effectiveSettlementAmount =
    Math.round((activeLoanPrincipalAmount + activeLoanPenaltyAmount) * 100) / 100;

  const positiveBankBal = Math.max(0, balance);
  const bankCoverage = Math.min(positiveBankBal, effectiveSettlementAmount);
  const remainingAfterBank = effectiveSettlementAmount - bankCoverage;
  const sweepInCoverage = Math.min(totalSweepIn, remainingAfterBank);
  const hybridCreditNeeded = Math.max(0, remainingAfterBank - sweepInCoverage);

  const isAccountDeficit = balance < effectiveSettlementAmount;
  const isCoveredBySweepIn =
    !directSelectedCard &&
    isAccountDeficit &&
    totalSweepIn > 0 &&
    totalAvailable >= effectiveSettlementAmount;

  const isUsingHybridOnBank =
    !directSelectedCard &&
    canUseCreditFacility &&
    (paymentMode === 'hybrid_card' ||
      (paymentMode === 'debit_card' &&
        debitCards.find((c) => c.id === selectedDebitCardId)?.cardType === 'hybrid'));

  const isCoveredByHybridOnBank = Boolean(
    canUseCreditFacility &&
      linkedHybridCard &&
      hybridCreditNeeded <= hybridAvailableCredit
  );

  // Determine whether payment can proceed
  let canProceed = false;
  if (directSelectedCard) {
    if (directSelectedCard.cardType === 'hybrid') {
      // Hybrid Card always evaluates 3-tier cascade: Positive Linked Bank + Linked Sweep-In FDs + Credit Limit
      canProceed =
        canUseCreditFacility &&
        positiveBankBal + totalSweepIn + directCardAvailCredit >= effectiveSettlementAmount;
    } else {
      // Pure Credit Card
      canProceed = canUseCreditFacility && directCardAvailCredit >= effectiveSettlementAmount;
    }
  } else if (sourceAsset) {
    if (balance >= effectiveSettlementAmount && balance > 0) {
      canProceed = true;
    } else if (isCoveredBySweepIn) {
      canProceed = true;
    } else if (isUsingHybridOnBank && isCoveredByHybridOnBank) {
      canProceed = true;
    }
  }

  const isCompletelyInsufficient = !canProceed;
  const latestSweepInFd = sweepInFds[0];

  const handleConfirm = async (e: React.FormEvent) => {
    e.preventDefault();

    if (isPeerOffsetPayer) {
      if (!peerPayerName.trim()) {
        setError("Please enter the person's name who paid this bill for you.");
        return;
      }
      setIsSubmitting(true);
      setError(null);
      const res = await counterpartyPaidMyBill({
        debtorName: peerPayerName.trim(),
        billId: bill.id,
        billName: bill.name,
        amount: effectiveSettlementAmount,
      });
      setIsSubmitting(false);
      if (!res.success) {
        setError(res.error || 'Failed to record peer bill settlement.');
        if (onError) onError(res.error || 'Failed to record peer bill settlement.');
      } else {
        const msg = `"${bill.name}" (${formatMoney(
          effectiveSettlementAmount,
          bill.currency,
          currSym
        )}) settled by ${peerPayerName.trim()} and offset against your peer balance.`;
        if (onSuccess) onSuccess(msg);
        onClose();
      }
      return;
    }

    if (isExternalPayer) {
      if (!externalPayerName.trim()) {
        setError('Please specify who paid this bill (e.g. Loved One, Parents, Company).');
        return;
      }
      setIsSubmitting(true);
      setError(null);
      const res = await recordExternalInflow({
        sourceName: externalPayerName.trim(),
        category: externalPayerCategory,
        amount: effectiveSettlementAmount,
        currency: bill.currency,
        destinationType: 'direct_bill',
        targetBillId: bill.id,
      });
      setIsSubmitting(false);
      if (!res.success) {
        setError(res.error || 'Failed to record external bill payment.');
        if (onError) onError(res.error || 'Failed to record external bill payment.');
      } else {
        const msg = `Bill "${bill.name}" (${formatMoney(
          effectiveSettlementAmount,
          bill.currency,
          currSym
        )}) settled directly by ${externalPayerName.trim()} (${externalPayerCategory}). Personal bank accounts untouched.`;
        if (onSuccess) onSuccess(msg);
        onClose();
      }
      return;
    }

    if (!selectedSourceId) {
      setError('Select an eligible positive liquid account or card to settle this bill.');
      return;
    }

    if (!canProceed) {
      if (
        !directSelectedCard &&
        isAccountDeficit &&
        !isCoveredBySweepIn &&
        isCoveredByHybridOnBank &&
        !isUsingHybridOnBank
      ) {
        setError(
          `Insufficient liquid balance for ${paymentMode.toUpperCase()}. Switch payment method to "Hybrid Card" to route the remaining ${formatMoney(
            hybridCreditNeeded,
            bill.currency,
            currSym
          )} to your linked Hybrid Card credit limit.`
        );
        return;
      }

      if (directSelectedCard) {
        setError(
          `Insufficient available credit on "${getSafeLiabilityName(
            directSelectedCard
          )}". Required: ${formatMoney(bill.amount, bill.currency, currSym)}.`
        );
        return;
      }

      setError(
        `Insufficient positive liquid funds in "${getSafeAssetName(
          sourceAsset,
          assetTypes
        )}". ${
          canUseCreditFacility
            ? 'Select a positive liquid account, enable Sweep-In FDs, or choose an eligible Credit / Hybrid Card.'
            : 'Debt and goal commitments must be settled strictly from positive liquid cash or linked Sweep-In FDs.'
        }`
      );
      return;
    }

    if (!directSelectedCard && paymentMode === 'debit_card' && debitCards.length > 0 && !selectedDebitCardId) {
      setError('Select which debit card was used for this transaction.');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    const actualDebitCardId = directSelectedCard
      ? directSelectedCard.id
      : paymentMode === 'hybrid_card'
      ? linkedHybridCard?.id || selectedDebitCardId
      : paymentMode === 'debit_card'
      ? selectedDebitCardId
      : undefined;

    const effectiveModeToSend = directSelectedCard
      ? directSelectedCard.cardType === 'hybrid'
        ? 'hybrid_card'
        : 'upi'
      : paymentMode;

    let loanSettlementOverride:
      | {
          principalAmount: number;
          isEmi: boolean;
          prepaymentPenaltyCharge?: number;
          updatedTenureMonths?: number;
        }
      | undefined;

    if (isLoanBill && targetLoan && predictedLoanPlan) {
      const isExtra =
        loanBillMode === 'predicted' &&
        activeLoanPrincipalAmount > bill.amount + 0.5;
      if (isExtra) {
        const sim = simulateLoanPrepayment(targetLoan, activeLoanPrincipalAmount, {
          maintainTenureReduceEmi: false,
        });
        loanSettlementOverride = {
          principalAmount: activeLoanPrincipalAmount,
          isEmi: false,
          prepaymentPenaltyCharge: activeLoanPenaltyAmount,
          updatedTenureMonths:
            sim.revisedRemainingMonths > 0 ? sim.revisedRemainingMonths : undefined,
        };
      }
    }

    const res = await postBill(bill.id, selectedSourceId, {
      paymentMode: effectiveModeToSend,
      debitCardId: actualDebitCardId,
      atmZone,
      loanSettlementOverride,
    });

    setIsSubmitting(false);

    if (!res.success) {
      setError(res.error || 'Payment failed.');
      if (onError) onError(res.error || 'Payment failed.');
    } else {
      const sweepNote = res.sweepInNote ? ` [${res.sweepInNote}]` : '';
      const hybridNote = res.hybridCreditNote ? ` [${res.hybridCreditNote}]` : '';
      const cardNote = res.cardUsageNote ? ` [${res.cardUsageNote}]` : '';
      const modeLabel = directSelectedCard
        ? `${getSafeLiabilityName(directSelectedCard)} (${
            directSelectedCard.cardType === 'hybrid'
              ? directCardMode === 'debit'
                ? 'Hybrid Debit-First'
                : 'Hybrid Credit Mode'
              : 'Credit Card'
          })`
        : paymentMode === 'hybrid_card'
        ? 'Hybrid Card'
        : paymentMode === 'debit_card'
        ? 'Debit Card'
        : paymentMode === 'cheque'
        ? 'Cheque'
        : paymentMode === 'netbanking'
        ? 'NEFT / IMPS'
        : 'UPI';

      const msg = `Payment of ${formatMoney(
        effectiveSettlementAmount,
        bill.currency,
        currSym
      )} for "${bill.name}" settled via ${modeLabel}.${sweepNote}${hybridNote}${cardNote}`;
      if (onSuccess) onSuccess(msg);
      onClose();
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Confirm Bill Settlement"
      subtitle={`Verify settlement source and payment rail for "${bill.name}"`}
    >
      <form onSubmit={handleConfirm} className="space-y-4">
        {error && (
          <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-2">
            <AlertCircle size={16} className="text-rose-400 shrink-0 mt-0.5" />
            <div>
              <strong className="block font-semibold">Settlement Restriction</strong>
              <span>{error}</span>
            </div>
          </div>
        )}

        {/* Bill Summary Banner */}
        <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] text-slate-400 uppercase tracking-wider font-semibold">
              Commitment Details
            </div>
            <div className="text-sm font-bold text-white mt-0.5 truncate">{bill.name}</div>
            <div className="text-xs text-slate-400 mt-0.5">
              <span>{bill.category}</span>
              <span className="mx-1.5 text-slate-600">·</span>
              <span>Due day {bill.dueDay}</span>
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-base font-bold text-emerald-400 font-mono tabular-nums">
              {formatMoney(effectiveSettlementAmount, bill.currency, currSym)}
            </div>
            <div className="text-[10px] text-slate-400">
              {canUseCreditFacility ? 'Cash or Card eligible' : 'Positive liquid cash only'}
            </div>
          </div>
        </div>

        {/* ML-Predicted Optimal Loan Bill Allocation Selector */}
        {isLoanBill && predictedLoanPlan && (
          <div className="p-3.5 rounded-xl bg-slate-950/90 border border-slate-800 space-y-2.5 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-slate-100 flex items-center gap-1.5">
                <Sparkles size={14} className="text-emerald-400 shrink-0" />
                <span>
                  {settings.enableSubtleGuidanceFraming !== false
                    ? predictedLoanPlan.whisperHeadline
                    : 'Predicted Loan Bill Allocation'}
                </span>
              </span>
              {predictedLoanPlan.projectedNetBenefit > 0 && (
                <span className="text-[11px] font-mono tabular-nums font-bold text-emerald-400 whitespace-nowrap">
                  Saves +{formatMoney(predictedLoanPlan.projectedNetBenefit, bill.currency, currSym)}
                </span>
              )}
            </div>

            <p className="text-[11px] text-slate-300 leading-relaxed">
              {settings.enableSubtleGuidanceFraming !== false
                ? predictedLoanPlan.whisperBody
                : predictedLoanPlan.strategyRationale}
            </p>

            {hasPredictedExtraSlice ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setLoanBillMode('predicted')}
                  className={`p-2.5 rounded-xl border text-left cursor-pointer transition-all ${
                    loanBillMode === 'predicted'
                      ? 'bg-emerald-950/40 border-emerald-500 text-white'
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  <div className="font-bold text-xs flex items-center justify-between gap-1">
                    <span className="whitespace-nowrap">Predicted Optimal Manner</span>
                    <span className="text-[10px] text-emerald-300 font-mono tabular-nums">
                      -{predictedLoanPlan.projectedMonthsSaved} mo
                    </span>
                  </div>
                  <div className="font-mono tabular-nums text-[11px] text-emerald-400 mt-0.5">
                    {formatMoney(
                      predictedLoanPlan.recommendedAmount + predictedLoanPlan.projectedPenaltyCharge,
                      bill.currency,
                      currSym
                    )}{' '}
                    ({formatMoney(predictedLoanPlan.extraPrincipalSlice, bill.currency, currSym)} extra principal)
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setLoanBillMode('scheduled')}
                  className={`p-2.5 rounded-xl border text-left cursor-pointer transition-all ${
                    loanBillMode === 'scheduled'
                      ? 'bg-indigo-950/40 border-indigo-500 text-white'
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  <div className="font-bold text-xs whitespace-nowrap">Scheduled EMI Only</div>
                  <div className="font-mono tabular-nums text-[11px] text-slate-300 mt-0.5">
                    {formatMoney(bill.amount, bill.currency, currSym)} · Standard tenure
                  </div>
                </button>
              </div>
            ) : (
              <div className="text-[11px] text-emerald-300 font-medium pt-1 border-t border-slate-800/80">
                Exact scheduled EMI ({formatMoney(bill.amount, bill.currency, currSym)}) is the predicted optimal settlement for this cycle.
              </div>
            )}

            {hasPredictedExtraSlice &&
              loanBillMode === 'scheduled' &&
              settings.enableSubtleGuidanceFraming !== false && (
                <div className="text-[11px] text-amber-200/90 pt-1 border-t border-slate-800/80">
                  {predictedLoanPlan.deviationWhisper}
                </div>
              )}
          </div>
        )}

        {/* Settlement Route: Personal Account vs Peer Offset vs Gift Sponsor */}
        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-slate-300">
            Who is settling this bill?
          </label>
          <div
            className={`grid ${
              bill.isPeerBorrowBill ? 'grid-cols-2' : 'grid-cols-1 sm:grid-cols-3'
            } gap-1.5 p-1 bg-slate-950 rounded-xl border border-slate-800 text-xs font-semibold`}
          >
            <button
              type="button"
              onClick={() => {
                setPayerRoute('self');
                setError(null);
              }}
              className={`py-2 px-2 rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap ${
                payerRoute === 'self'
                  ? 'bg-slate-800 text-white shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Building2 size={13} className="text-cyan-400 shrink-0" />
              <span>My Accounts</span>
            </button>

            {!bill.isPeerBorrowBill && (
              <button
                type="button"
                onClick={() => {
                  setPayerRoute('peer_offset');
                  setError(null);
                }}
                className={`py-2 px-2 rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap ${
                  payerRoute === 'peer_offset'
                    ? 'bg-cyan-950/60 border border-cyan-500/40 text-cyan-200 shadow-xs'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Handshake size={13} className="text-cyan-400 shrink-0" />
                <span>Friend / Peer (Offset)</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                setPayerRoute('external_gift');
                setError(null);
              }}
              className={`py-2 px-2 rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap ${
                payerRoute === 'external_gift'
                  ? 'bg-emerald-950/60 border border-emerald-500/40 text-emerald-300 shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Gift size={13} className="text-emerald-400 shrink-0" />
              <span>Gift / Sponsor</span>
            </button>
          </div>
        </div>

        {isPeerOffsetPayer ? (
          <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 space-y-3">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-cyan-300">
              <Handshake size={14} className="shrink-0" />
              <span>Peer Settlement &amp; Balance Offset</span>
            </div>
            <p className="text-[11px] text-slate-300 leading-relaxed">
              Clears this bill without debiting your bank. Any balance they owe you is offset first; any remaining amount is tracked as what you owe them until settled.
            </p>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Person Paying This Bill
              </label>
              <input
                type="text"
                value={peerPayerName}
                onChange={(e) => setPeerPayerName(e.target.value)}
                placeholder="e.g. Rahul, Sanjay, Priya"
                className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white text-xs font-medium focus:border-cyan-500 focus:outline-none"
              />
              {activePeers.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {activePeers.slice(0, 6).map((p) => (
                    <button
                      key={p.name}
                      type="button"
                      onClick={() => setPeerPayerName(p.name)}
                      className={`px-2 py-0.5 rounded-md text-[10px] border cursor-pointer transition-colors ${
                        peerPayerName.trim().toLowerCase() === p.name.toLowerCase()
                          ? 'bg-cyan-950/60 border-cyan-500/50 text-cyan-200'
                          : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {p.name} (
                      {p.netBalance >= 0
                        ? `owes ${formatMoney(p.netBalance, bill.currency, currSym)}`
                        : `you owe ${formatMoney(Math.abs(p.netBalance), bill.currency, currSym)}`}
                      )
                    </button>
                  ))}
                </div>
              )}
            </div>

            {peerPayerName.trim() && (() => {
              const matched = activePeers.find(
                (p) => p.name.toLowerCase() === peerPayerName.trim().toLowerCase()
              );
              const nextNet = (matched ? matched.netBalance : 0) - effectiveSettlementAmount;
              return (
                <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 text-[11px] text-slate-300">
                  {Math.abs(nextNet) <= 0.01 ? (
                    <span>
                      Result: Balance with <strong className="text-white">{peerPayerName.trim()}</strong>{' '}
                      settles to <strong className="text-emerald-400 font-mono tabular-nums">{currSym}0</strong> and archives automatically.
                    </span>
                  ) : nextNet > 0 ? (
                    <span>
                      Result: <strong className="text-white">{peerPayerName.trim()}</strong> will owe you{' '}
                      <strong className="text-emerald-400 font-mono tabular-nums">
                        {formatMoney(nextNet, bill.currency, currSym)}
                      </strong>{' '}
                      after this offset.
                    </span>
                  ) : (
                    <span>
                      Result: You will owe <strong className="text-white">{peerPayerName.trim()}</strong>{' '}
                      <strong className="text-amber-300 font-mono tabular-nums">
                        {formatMoney(Math.abs(nextNet), bill.currency, currSym)}
                      </strong>{' '}
                      in your active queue until paid back.
                    </span>
                  )}
                </div>
              );
            })()}
          </div>
        ) : isExternalPayer ? (
          <div className="p-3.5 rounded-xl bg-emerald-950/20 border border-emerald-800/40 space-y-3 animate-fade-in">
            <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-400">
              <Gift size={15} />
              <span>Outside Sponsor / Gift Settlement</span>
            </div>
            <p className="text-[11px] text-slate-300 leading-relaxed">
              When a family member or sponsor pays this bill as a gift, your bank accounts are <strong>not debited</strong> and no repayment obligation is created.
            </p>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Paid By / Sponsor Name
              </label>
              <input
                type="text"
                value={externalPayerName}
                onChange={(e) => setExternalPayerName(e.target.value)}
                placeholder="e.g. Mom & Dad, Loved One, Company"
                className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white text-xs font-medium focus:border-emerald-500 focus:outline-none"
              />
              <div className="flex flex-wrap gap-1 mt-1.5">
                {['Loved One', 'Parents', 'Company'].map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setExternalPayerName(p)}
                    className="px-2 py-0.5 rounded-md text-[10px] bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200 cursor-pointer"
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Nature of Support
              </label>
              <select
                value={externalPayerCategory}
                onChange={(e) => setExternalPayerCategory(e.target.value as ExternalInflowCategory)}
                className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white text-xs font-medium focus:border-emerald-500 focus:outline-none"
              >
                <option value="Gift">Gift</option>
                <option value="Family Support">Family Support</option>
                <option value="Reimbursement">Reimbursement</option>
                <option value="Bonus">Bonus / Reward</option>
                <option value="Other">Other</option>
              </select>
            </div>
          </div>
        ) : (
          <>
            {/* Payment Source Selector */}
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-slate-300 flex items-center gap-1.5">
                <Building2 size={13} className="text-cyan-400 shrink-0" />
                <span>
                  {canUseCreditFacility
                    ? 'Settlement Source'
                    : 'Settlement Source (Liquid Cash / Sweep-In)'}
                </span>
              </label>

              {spendableHoldings.length === 0 && eligibleCreditAndHybridCards.length === 0 ? (
                <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs">
                  No unlocked liquid cash/bank accounts available. Locked holdings (FD, RD, Stocks, Bonds, Mutual Funds) cannot directly pay bills.
                </div>
              ) : (
                <select
                  value={selectedSourceId}
                  onChange={(e) => {
                    setSelectedSourceId(e.target.value);
                    setError(null);
                  }}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-slate-100 focus:outline-none focus:border-cyan-500"
                >
              {spendableHoldings.length > 0 && (
                <optgroup label="Liquid Bank & Cash Accounts">
                  {spendableHoldings.map((h) => {
                    const hSym = currencies.find((c) => c.code === h.currency)?.symbol || `${h.currency} `;
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

              {eligibleCreditAndHybridCards.length > 0 && (
                <optgroup label="Credit & Hybrid Cards (Non-Debt Bills)">
                  {eligibleCreditAndHybridCards.map((c) => {
                    const cSym = currencies.find((cur) => cur.code === c.currency)?.symbol || `${c.currency} `;
                    return (
                      <option key={c.id} value={c.id}>
                        {formatCardOptionLabel(c, getCardEffectiveMode(c), cSym)}
                      </option>
                    );
                  })}
                </optgroup>
              )}
            </select>
          )}

          {/* Selected Source Unclipped Readout */}
          {sourceAsset && (
            <div className="px-3 py-2 rounded-lg bg-slate-950/70 border border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-[11px]">
              <div className="text-slate-300 font-medium break-words">
                {getSafeAssetName(sourceAsset, assetTypes)}
              </div>
              <div className="font-mono tabular-nums text-slate-300">
                Cash: <strong className={balance > 0 ? 'text-emerald-400' : 'text-rose-400'}>{formatMoney(balance, sourceAsset.currency, currSym)}</strong>
                {totalSweepIn > 0 && (
                  <span className="text-cyan-400">
                    {' '}· +{formatMoney(totalSweepIn, sourceAsset.currency, currSym)} Sweep-In
                  </span>
                )}
              </div>
            </div>
          )}

          {directSelectedCard && (
            <div className="p-3 rounded-xl bg-slate-950/90 border border-slate-800 space-y-2 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-white">
                  {getSafeLiabilityName(directSelectedCard)}
                </span>
                <span className="text-[11px] text-slate-400">
                  {directSelectedCard.cardType === 'hybrid'
                    ? directCardMode === 'debit'
                      ? 'Hybrid Card · Debit Mode Active (Linked Bank > 0)'
                      : 'Hybrid Card · Credit Mode Active (Linked Bank <= 0)'
                    : 'Credit Card · Statement Billing'}
                </span>
              </div>

              {directSelectedCard.cardType === 'hybrid' && resolvedBankAsset ? (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
                  <div className="p-2 rounded-lg bg-slate-900 border border-slate-800">
                    <span className="text-[10px] text-slate-400 block">1. Linked Bank ({getSafeAssetName(resolvedBankAsset, assetTypes)})</span>
                    <span className="text-xs font-bold text-emerald-400 font-mono tabular-nums">
                      {formatMoney(bankCoverage, bill.currency, currSym)}
                    </span>
                  </div>
                  <div className="p-2 rounded-lg bg-slate-900 border border-slate-800">
                    <span className="text-[10px] text-slate-400 block">2. Linked Sweep-In FDs</span>
                    <span className="text-xs font-bold text-cyan-400 font-mono tabular-nums">
                      {formatMoney(sweepInCoverage, bill.currency, currSym)}
                    </span>
                  </div>
                  <div className="p-2 rounded-lg bg-slate-900 border border-slate-800">
                    <span className="text-[10px] text-slate-400 block">3. Credit Line Backup</span>
                    <span className="text-xs font-bold text-indigo-400 font-mono tabular-nums">
                      {formatMoney(hybridCreditNeeded, bill.currency, currSym)}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-300 pt-1 border-t border-slate-800/80">
                  <span>
                    Available Credit Limit:{' '}
                    <strong className="text-emerald-400 font-mono tabular-nums">
                      {formatMoney(directCardAvailCredit, directSelectedCard.currency, currSym)}
                    </strong>
                  </span>
                  <span>
                    Post-Payment Outstanding:{' '}
                    <strong className="text-white font-mono tabular-nums">
                      {formatMoney((directSelectedCard.outstanding || 0) + bill.amount, directSelectedCard.currency, currSym)}
                    </strong>
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* SITUATION 1 NOTICE: Sufficient Sweep-In FDs on Bank Account */}
        {!directSelectedCard && isCoveredBySweepIn && latestSweepInFd && (
          <div className="p-3.5 rounded-xl bg-emerald-950/30 border border-emerald-500/40 text-emerald-200 space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-emerald-300 flex items-center gap-1.5">
                <Zap size={14} className="text-emerald-400" />
                <span>Sweep-In Deposit Protection Active</span>
              </span>
              <span className="text-[11px] text-emerald-400">LIFO Auto-Redemption</span>
            </div>
            <p className="text-[11px] leading-relaxed text-slate-300">
              Account balance is <strong className="text-white font-mono tabular-nums">{formatMoney(balance, bill.currency, currSym)}</strong>, backed by{' '}
              <strong className="text-emerald-400 font-mono tabular-nums">{formatMoney(totalSweepIn, bill.currency, currSym)}</strong> in Sweep-In FDs (
              <strong className="text-white font-mono tabular-nums">{formatMoney(totalAvailable, bill.currency, currSym)}</strong> total available).
            </p>
            <div className="text-[11px] text-emerald-300 font-medium pt-0.5 flex items-center gap-1.5">
              <Layers size={13} className="text-emerald-400 shrink-0" />
              <span>
                Deficit of <strong className="text-white font-mono tabular-nums">{formatMoney(bill.amount - positiveBankBal, bill.currency, currSym)}</strong> deducts from newest Sweep-In FD:{' '}
                <strong className="text-cyan-300">{getSafeAssetName(latestSweepInFd, assetTypes)}</strong>.
              </span>
            </div>
          </div>
        )}

        {/* SITUATION 2 NOTICE: Hybrid Card Multi-Tier Protection on Bank Account (Non-Debt / Non-Goal Bills Only) */}
        {!directSelectedCard && canUseCreditFacility && isAccountDeficit && linkedHybridCard && isCoveredByHybridOnBank && (
          <div className="p-3.5 rounded-xl bg-indigo-950/30 border border-indigo-500/40 text-indigo-200 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-indigo-300 flex items-center gap-1.5">
                <ShieldCheck size={14} className="text-indigo-400" />
                <span>Hybrid Card Facility Available</span>
              </span>
              <span className="text-[11px] text-indigo-300">{getSafeLiabilityName(linkedHybridCard)}</span>
            </div>
            <p className="text-[11px] leading-relaxed text-slate-300">
              {balance > 0 ? (
                <>
                  Positive bank balance (<strong className="text-white font-mono tabular-nums">{formatMoney(balance, bill.currency, currSym)}</strong>) deducts first, followed by Sweep-In FDs, and the remaining deficit routes to{' '}
                  <strong className="text-white">{getSafeLiabilityName(linkedHybridCard)}</strong>.
                </>
              ) : (
                <>
                  Linked bank balance is non-positive (<strong className="text-white font-mono tabular-nums">{formatMoney(balance, bill.currency, currSym)}</strong>), so{' '}
                  <strong className="text-white">{getSafeLiabilityName(linkedHybridCard)}</strong> operates directly in Credit Card mode (<strong className="text-indigo-300 font-mono tabular-nums">{formatMoney(hybridAvailableCredit, linkedHybridCard.currency, currSym)}</strong> available credit).
                </>
              )}
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1 text-xs">
              <div className="p-2 rounded-lg bg-slate-900/80 border border-slate-800">
                <span className="text-[10px] text-slate-400 block font-semibold uppercase">1. Bank Cash</span>
                <span className="text-xs font-bold text-emerald-400 font-mono tabular-nums block mt-0.5">
                  {formatMoney(bankCoverage, bill.currency, currSym)}
                </span>
              </div>
              <div className="p-2 rounded-lg bg-slate-900/80 border border-slate-800">
                <span className="text-[10px] text-slate-400 block font-semibold uppercase">2. Sweep-In FDs</span>
                <span className="text-xs font-bold text-cyan-400 font-mono tabular-nums block mt-0.5">
                  {formatMoney(sweepInCoverage, bill.currency, currSym)}
                </span>
              </div>
              <div className="p-2 rounded-lg bg-slate-900/80 border border-slate-800">
                <span className="text-[10px] text-slate-400 block font-semibold uppercase">3. Hybrid Credit</span>
                <span className="text-xs font-bold text-indigo-400 font-mono tabular-nums block mt-0.5">
                  {formatMoney(hybridCreditNeeded, bill.currency, currSym)}
                </span>
              </div>
            </div>

            {paymentMode !== 'hybrid_card' && !isUsingHybridOnBank && (
              <div className="pt-1 flex items-center justify-between gap-2 bg-indigo-950/60 p-2 rounded-lg border border-indigo-500/30">
                <span className="text-[11px] text-slate-300">
                  Switch payment method to Hybrid Card to authorize credit-line settlement:
                </span>
                <button
                  type="button"
                  onClick={() => setPaymentMode('hybrid_card')}
                  className="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-bold cursor-pointer transition-colors shrink-0"
                >
                  Use Hybrid Card
                </button>
              </div>
            )}
          </div>
        )}

        {/* INSUFFICIENT NOTICE */}
        {isCompletelyInsufficient && (
          <div className="p-3.5 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs space-y-1">
            <div className="font-bold flex items-center gap-1.5">
              <AlertCircle size={15} />
              <span>Insufficient Eligible Funds</span>
            </div>
            {directSelectedCard ? (
              <p className="text-[11px] text-slate-300">
                {directSelectedCard.cardType === 'hybrid' ? (
                  <>
                    Combined capacity on <strong className="text-white">{getSafeLiabilityName(directSelectedCard)}</strong> (Bank Cash{' '}
                    <strong className="text-white font-mono tabular-nums">{formatMoney(positiveBankBal, directSelectedCard.currency, currSym)}</strong> + Linked Sweep-In{' '}
                    <strong className="text-white font-mono tabular-nums">{formatMoney(totalSweepIn, directSelectedCard.currency, currSym)}</strong> + Available Credit{' '}
                    <strong className="text-white font-mono tabular-nums">{formatMoney(directCardAvailCredit, directSelectedCard.currency, currSym)}</strong>) is below{' '}
                    <strong className="text-rose-400 font-mono tabular-nums">{formatMoney(bill.amount, bill.currency, currSym)}</strong>.
                  </>
                ) : (
                  <>
                    Available credit on <strong className="text-white">{getSafeLiabilityName(directSelectedCard)}</strong> is{' '}
                    <strong className="text-white font-mono tabular-nums">{formatMoney(directCardAvailCredit, directSelectedCard.currency, currSym)}</strong>, which is below the required{' '}
                    <strong className="text-rose-400 font-mono tabular-nums">{formatMoney(bill.amount, bill.currency, currSym)}</strong>.
                  </>
                )}
              </p>
            ) : (
              <p className="text-[11px] text-slate-300">
                Positive cash in <strong className="text-white">{getSafeAssetName(sourceAsset, assetTypes)}</strong> is{' '}
                <strong className="text-white font-mono tabular-nums">{formatMoney(positiveBankBal, bill.currency, currSym)}</strong> and Sweep-In FDs total{' '}
                <strong className="text-white font-mono tabular-nums">{formatMoney(totalSweepIn, bill.currency, currSym)}</strong>, while this commitment requires{' '}
                <strong className="text-rose-400 font-mono tabular-nums">{formatMoney(effectiveSettlementAmount, bill.currency, currSym)}</strong>.
              </p>
            )}
          </div>
        )}

        {/* Payment Mode Selection (Shown when a Bank / Cash Account is selected) */}
        {!directSelectedCard && (
          <div className="space-y-2 pt-2 border-t border-slate-800">
            <label className="block text-xs font-medium text-slate-300">
              Payment Rail <span className="text-slate-400 text-[11px]">(Default: UPI)</span>
            </label>

            <div className={`grid grid-cols-2 ${canUseCreditFacility ? 'sm:grid-cols-5' : 'sm:grid-cols-4'} gap-2`}>
              <button
                type="button"
                onClick={() => setPaymentMode('upi')}
                className={`p-2.5 rounded-xl border text-left cursor-pointer transition-all ${
                  paymentMode === 'upi'
                    ? 'bg-emerald-950/40 border-emerald-500 text-white'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                <div className="flex items-center gap-1 text-xs font-bold">
                  <Smartphone size={13} className={paymentMode === 'upi' ? 'text-emerald-400' : 'text-slate-400'} />
                  <span>UPI</span>
                </div>
                <div className="text-[10px] text-slate-500 mt-0.5">Default instant rail</div>
              </button>

              {canUseCreditFacility && (
                <button
                  type="button"
                  onClick={() => setPaymentMode('hybrid_card')}
                  className={`p-2.5 rounded-xl border text-left cursor-pointer transition-all ${
                    paymentMode === 'hybrid_card'
                      ? 'bg-indigo-950/40 border-indigo-500 text-white'
                      : linkedHybridCard
                      ? 'bg-slate-950 border-indigo-900/60 text-slate-300 hover:border-indigo-700'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <div className="flex items-center gap-1 text-xs font-bold">
                    <ShieldCheck size={13} className={paymentMode === 'hybrid_card' ? 'text-indigo-400' : 'text-slate-400'} />
                    <span>Hybrid Card</span>
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5">Bank / Credit split</div>
                </button>
              )}

              <button
                type="button"
                onClick={() => setPaymentMode('debit_card')}
                className={`p-2.5 rounded-xl border text-left cursor-pointer transition-all ${
                  paymentMode === 'debit_card'
                    ? 'bg-cyan-950/40 border-cyan-500 text-white'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                <div className="flex items-center gap-1 text-xs font-bold">
                  <CreditCard size={13} className={paymentMode === 'debit_card' ? 'text-cyan-400' : 'text-slate-400'} />
                  <span>Debit Card</span>
                </div>
                <div className="text-[10px] text-slate-500 mt-0.5">+1 card usage</div>
              </button>

              <button
                type="button"
                onClick={() => setPaymentMode('netbanking')}
                className={`p-2.5 rounded-xl border text-left cursor-pointer transition-all ${
                  paymentMode === 'netbanking'
                    ? 'bg-cyan-950/40 border-cyan-500 text-white'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                <div className="flex items-center gap-1 text-xs font-bold">
                  <Building2 size={13} className={paymentMode === 'netbanking' ? 'text-cyan-400' : 'text-slate-400'} />
                  <span>NEFT / IMPS</span>
                </div>
                <div className="text-[10px] text-slate-500 mt-0.5">Account transfer</div>
              </button>

              <button
                type="button"
                onClick={() => setPaymentMode('cheque')}
                className={`p-2.5 rounded-xl border text-left cursor-pointer transition-all ${
                  paymentMode === 'cheque'
                    ? 'bg-amber-950/40 border-amber-500 text-white'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                <div className="flex items-center gap-1 text-xs font-bold">
                  <Check size={13} className={paymentMode === 'cheque' ? 'text-amber-400' : 'text-slate-400'} />
                  <span>Cheque</span>
                </div>
                <div className="text-[10px] text-slate-500 mt-0.5">Clearing settlement</div>
              </button>
            </div>

            {/* Debit / Hybrid Card Selector */}
            {(paymentMode === 'debit_card' || paymentMode === 'hybrid_card') && (
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-2.5 mt-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                    <CreditCard size={14} className="text-cyan-400" />
                    <span>Card Instrument Used</span>
                  </span>
                  <span className="text-[11px] text-cyan-400">Logs +1 card usage</span>
                </div>

                {debitCards.length === 0 ? (
                  <p className="text-xs text-amber-300">
                    No debit or hybrid cards registered. Add a card under Liabilities &amp; Cards first.
                  </p>
                ) : (
                  <div className="space-y-2">
                    <select
                      value={
                        paymentMode === 'hybrid_card' && linkedHybridCard
                          ? linkedHybridCard.id
                          : selectedDebitCardId
                      }
                      onChange={(e) => setSelectedDebitCardId(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
                    >
                      {debitCards
                        .filter((c) => canUseCreditFacility || c.cardType === 'debit' || balance > 0)
                        .map((c) => {
                          const linked = holdings.find((h) => h.id === c.linkedAccountId);
                          const mode = getCardEffectiveMode(c);
                          return (
                            <option key={c.id} value={c.id}>
                              {getSafeLiabilityName(c)} ·{' '}
                              {c.cardType === 'hybrid'
                                ? mode === 'debit'
                                  ? 'Hybrid (Debit Active)'
                                  : 'Hybrid (Credit Mode)'
                                : 'Debit Card'}
                              {linked ? ` — Linked: ${getSafeAssetName(linked, assetTypes)}` : ''}
                            </option>
                          );
                        })}
                    </select>

                    <div className="flex items-center gap-3 pt-1 text-[11px] text-slate-300">
                      <span className="text-slate-400">Terminal Zone:</span>
                      <label className="flex items-center gap-1 cursor-pointer">
                        <input
                          type="radio"
                          name="atmZone"
                          checked={atmZone === 'non_metro'}
                          onChange={() => setAtmZone('non_metro')}
                          className="text-cyan-500"
                        />
                        <span>Non-Metro / POS</span>
                      </label>
                      <label className="flex items-center gap-1 cursor-pointer">
                        <input
                          type="radio"
                          name="atmZone"
                          checked={atmZone === 'metro'}
                          onChange={() => setAtmZone('metro')}
                          className="text-cyan-500"
                        />
                        <span>Metro</span>
                      </label>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        </>
      )}

        {/* Modal Actions */}
        <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={
              isSubmitting ||
              (!isExternalPayer && !isPeerOffsetPayer && !canProceed) ||
              (isPeerOffsetPayer && !peerPayerName.trim())
            }
            className={`px-5 py-2 rounded-xl text-white text-xs font-bold shadow-md flex items-center gap-1.5 cursor-pointer transition-all ${
              (!isExternalPayer && !isPeerOffsetPayer && !canProceed) ||
              (isPeerOffsetPayer && !peerPayerName.trim())
                ? 'bg-slate-800 opacity-50 cursor-not-allowed text-slate-500'
                : isPeerOffsetPayer
                ? 'bg-cyan-600 hover:bg-cyan-500 shadow-cyan-600/25'
                : isExternalPayer
                ? 'bg-emerald-600 hover:bg-emerald-500 shadow-emerald-600/25'
                : directSelectedCard || (isUsingHybridOnBank && hybridCreditNeeded > 0)
                ? 'bg-indigo-600 hover:bg-indigo-500 shadow-indigo-600/25'
                : 'bg-emerald-600 hover:bg-emerald-500 shadow-emerald-600/25'
            }`}
          >
            {isSubmitting ? (
              <span>Processing Settlement...</span>
            ) : isPeerOffsetPayer ? (
              <>
                <Handshake size={14} className="text-cyan-200" />
                <span>
                  Offset with {peerPayerName.trim() || 'Peer'} (
                  {formatMoney(effectiveSettlementAmount, bill.currency, currSym)})
                </span>
              </>
            ) : isExternalPayer ? (
              <>
                <HeartHandshake size={14} className="text-emerald-300" />
                <span>
                  Settle via {externalPayerName} ({formatMoney(effectiveSettlementAmount, bill.currency, currSym)})
                </span>
              </>
            ) : directSelectedCard ? (
              <>
                <CreditCard size={14} className="text-indigo-200" />
                <span>
                  Charge {getSafeLiabilityName(directSelectedCard)} ({formatMoney(bill.amount, bill.currency, currSym)})
                </span>
              </>
            ) : isUsingHybridOnBank && hybridCreditNeeded > 0 ? (
              <>
                <ShieldCheck size={14} className="text-indigo-300" />
                <span>Settle via Hybrid Split ({formatMoney(bill.amount, bill.currency, currSym)})</span>
              </>
            ) : isCoveredBySweepIn ? (
              <>
                <Zap size={14} className="text-emerald-300" />
                <span className="whitespace-nowrap">
                  Settle with Sweep-In ({formatMoney(effectiveSettlementAmount, bill.currency, currSym)})
                </span>
              </>
            ) : (
              <>
                <Check size={14} />
                <span className="whitespace-nowrap">
                  {isLoanBill &&
                  loanBillMode === 'predicted' &&
                  predictedLoanPlan &&
                  settings.enableSubtleGuidanceFraming !== false
                    ? `${predictedLoanPlan.ctaAnchorLabel} (${formatMoney(
                        effectiveSettlementAmount,
                        bill.currency,
                        currSym
                      )})`
                    : `Confirm Settlement (${formatMoney(
                        effectiveSettlementAmount,
                        bill.currency,
                        currSym
                      )})`}
                </span>
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
};
