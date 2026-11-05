import React, { useState, useEffect, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { Modal } from '../common/Modal';
import { Liability } from '../../types';
import { formatMoney } from '../../lib/formatters';
import {
  isSpendableLiquidHolding,
  getSafeAssetName,
  getSafeLiabilityName,
  formatAssetOptionLabel,
} from '../../lib/assetRules';
import { assessCardFullVsEmiByCashFlow } from '../../lib/creditIntelligence';
import {
  Gift,
  Zap,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Plus,
  Sparkles,
} from 'lucide-react';

interface PayCardModalProps {
  isOpen: boolean;
  onClose: () => void;
  card: Liability;
  initialAmountOverride?: number;
  onOpenEmiComparison?: () => void;
}

export const PayCardModal: React.FC<PayCardModalProps> = ({
  isOpen,
  onClose,
  card,
  initialAmountOverride,
  onOpenEmiComparison,
}) => {
  const {
    holdings,
    assetTypes,
    payCardWithCashback,
    logCardCashback,
    currencies,
    settings,
    cashFlowForecast,
    goals,
    closedLoopMLState,
    getAccountLiquidityWithSweepIn,
  } = useApp();

  const bankAccounts = useMemo(
    () => holdings.filter((h) => isSpendableLiquidHolding(h, assetTypes)),
    [holdings, assetTypes]
  );

  const defaultBankId =
    card.linkedAccountId && bankAccounts.some((b) => b.id === card.linkedAccountId)
      ? card.linkedAccountId
      : bankAccounts.find((b) => (b.principalOrValue || 0) > 0)?.id || bankAccounts[0]?.id || '';

  const [fromAccountId, setFromAccountId] = useState<string>(defaultBankId);

  useEffect(() => {
    if (!fromAccountId || !bankAccounts.some((b) => b.id === fromAccountId)) {
      if (defaultBankId) setFromAccountId(defaultBankId);
    }
  }, [bankAccounts, defaultBankId, fromAccountId]);

  const accumulatedCashback = card.accumulatedCashback || 0;
  const [applyCashback, setApplyCashback] = useState(accumulatedCashback > 0);

  const originalBilledAmount = card.outstanding || 0;
  const maxCashbackApplicable = Math.min(accumulatedCashback, originalBilledAmount);
  const cashbackDeduction = applyCashback ? maxCashbackApplicable : 0;
  const reducedStatementAmount = Math.max(0, originalBilledAmount - cashbackDeduction);

  const [payOption, setPayOption] = useState<'full_reduced' | 'full_original' | 'min' | 'custom'>(
    initialAmountOverride && initialAmountOverride < reducedStatementAmount
      ? 'custom'
      : 'full_reduced'
  );
  const [customAmount, setCustomAmount] = useState<string>(
    initialAmountOverride ? String(initialAmountOverride) : ''
  );

  const defaultCalculatedPay =
    payOption === 'full_reduced'
      ? reducedStatementAmount
      : payOption === 'full_original'
      ? originalBilledAmount
      : payOption === 'min'
      ? Math.min(reducedStatementAmount, Math.max(500, Math.round(originalBilledAmount * 0.05)))
      : parseFloat(customAmount) || 0;

  const [actualPaidInLedger, setActualPaidInLedger] = useState<string>(
    initialAmountOverride ? String(initialAmountOverride) : defaultCalculatedPay.toString()
  );

  useEffect(() => {
    if (initialAmountOverride && initialAmountOverride > 0) {
      if (Math.abs(initialAmountOverride - reducedStatementAmount) <= 1) {
        setPayOption('full_reduced');
      } else {
        setPayOption('custom');
        setCustomAmount(String(initialAmountOverride));
      }
      setActualPaidInLedger(String(initialAmountOverride));
    }
  }, [initialAmountOverride, reducedStatementAmount]);

  useEffect(() => {
    if (payOption !== 'custom') {
      setActualPaidInLedger(defaultCalculatedPay.toString());
    }
  }, [payOption, reducedStatementAmount, originalBilledAmount]);

  const [showLogCashback, setShowLogCashback] = useState(false);
  const [newCashbackAmt, setNewCashbackAmt] = useState('');
  const [newCashbackNote, setNewCashbackNote] = useState('Purchase reward');
  const [isLoggingCashback, setIsLoggingCashback] = useState(false);
  const [cashbackSuccessMsg, setCashbackSuccessMsg] = useState<string | null>(null);

  const [error, setError] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const curr = currencies.find((c) => c.code === card.currency);
  const currSymbol = curr?.symbol || card.currency;
  const cardDisplayName = getSafeLiabilityName(card);

  const selectedBank = bankAccounts.find((h) => h.id === fromAccountId);
  const { balance: bankBal, totalSweepIn, totalAvailable } = selectedBank
    ? getAccountLiquidityWithSweepIn(selectedBank.id)
    : { balance: 0, totalSweepIn: 0, totalAvailable: 0 };

  const cashFlowAssessment = useMemo(
    () =>
      assessCardFullVsEmiByCashFlow({
        card,
        holdings,
        assetTypes,
        currencies,
        settings,
        cashFlowForecast,
        goals,
        closedLoopState: closedLoopMLState,
      }),
    [card, holdings, assetTypes, currencies, settings, cashFlowForecast, goals, closedLoopMLState]
  );

  const parsedActualAmount = parseFloat(actualPaidInLedger) || 0;
  const unpaidRevolvingRemainder = Math.max(0, reducedStatementAmount - parsedActualAmount);
  const monthlyPenaltyPct =
    card.penaltyRateMonthlyPct ?? settings.defaultCardPenaltyRateMonthly ?? 3.5;
  const projectedMonthlyInterestLoss = Math.round(
    unpaidRevolvingRemainder * (monthlyPenaltyPct / 100)
  );

  // Red glow strictly ONLY when user leaves unpaid revolving balance that loses money to interest charges
  const isLosingMoneyToRevolvingCharges =
    reducedStatementAmount > 0 &&
    unpaidRevolvingRemainder > 1 &&
    projectedMonthlyInterestLoss > 0;

  const handleLogCashback = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = parseFloat(newCashbackAmt);
    if (isNaN(amt) || amt <= 0) {
      setError('Enter a positive cashback amount.');
      return;
    }
    setIsLoggingCashback(true);
    setError('');
    try {
      await logCardCashback(card.id, amt, newCashbackNote);
      setIsLoggingCashback(false);
      setNewCashbackAmt('');
      setCashbackSuccessMsg(`+${formatMoney(amt, card.currency, currSymbol)} cashback recorded.`);
      setApplyCashback(true);
      setShowLogCashback(false);
      setTimeout(() => setCashbackSuccessMsg(null), 4000);
    } catch (err: unknown) {
      setIsLoggingCashback(false);
      setError(err instanceof Error ? err.message : 'Failed to log cashback.');
    }
  };

  const handlePay = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!fromAccountId || !selectedBank) {
      setError('Select a liquid bank or cash account.');
      return;
    }

    const actualAmount = parseFloat(actualPaidInLedger);
    if (isNaN(actualAmount) || actualAmount <= 0) {
      setError('Payment amount must be greater than zero.');
      return;
    }

    if (bankBal <= 0 && totalSweepIn <= 0) {
      setError(
        `"${getSafeAssetName(selectedBank, assetTypes)}" has no positive liquid balance.`
      );
      return;
    }

    if (actualAmount > totalAvailable) {
      setError(
        `Insufficient liquid funds in "${getSafeAssetName(
          selectedBank,
          assetTypes
        )}". Available: ${formatMoney(
          totalAvailable,
          selectedBank.currency,
          currSymbol
        )}, required: ${formatMoney(actualAmount, selectedBank.currency, currSymbol)}.`
      );
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await payCardWithCashback(
        card.id,
        fromAccountId,
        actualAmount,
        applyCashback ? cashbackDeduction : 0
      );

      setIsSubmitting(false);
      if (!res.success) {
        setError(res.error || 'Payment failed.');
      } else {
        onClose();
      }
    } catch (err: unknown) {
      setIsSubmitting(false);
      setError(err instanceof Error ? err.message : 'Error settling card statement.');
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      variant={isLosingMoneyToRevolvingCharges ? 'danger-glow' : 'default'}
      title={
        isLosingMoneyToRevolvingCharges
          ? `Revolving Interest Loss Alert: ${cardDisplayName}`
          : `Settle Card: ${cardDisplayName}`
      }
      subtitle={`Net payable ${formatMoney(reducedStatementAmount, card.currency, currSymbol)}`}
    >
      <form onSubmit={handlePay} className="space-y-4">
        {error && (
          <div className="p-3 rounded-xl bg-rose-500/20 border border-rose-500/40 text-rose-300 text-xs flex items-center gap-1.5">
            <AlertCircle size={15} className="shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {cashbackSuccessMsg && (
          <div className="p-2.5 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs flex items-center gap-1.5">
            <CheckCircle2 size={15} className="shrink-0" />
            <span>{cashbackSuccessMsg}</span>
          </div>
        )}

        {isLosingMoneyToRevolvingCharges && (
          <div className="p-3 rounded-xl bg-rose-950/80 border border-rose-500 text-rose-100 text-xs space-y-2">
            <div className="flex items-start gap-2">
              <AlertTriangle size={16} className="text-rose-400 shrink-0 mt-0.5" />
              <div className="flex-1 space-y-0.5">
                <div className="font-bold text-rose-200">
                  Losing ~{formatMoney(projectedMonthlyInterestLoss, card.currency, currSymbol)}/mo to Revolving Charges
                </div>
                <p className="text-[11px] text-rose-100/90 leading-snug">
                  {cashFlowAssessment.canAffordFullWithoutDeficit
                    ? `Your liquid cash covers full settlement. Leaving ${formatMoney(
                        unpaidRevolvingRemainder,
                        card.currency,
                        currSymbol
                      )} unpaid forfeits ${(monthlyPenaltyPct * 12).toFixed(0)}% APR interest with zero asset gain.`
                    : `Leaving ${formatMoney(
                        unpaidRevolvingRemainder,
                        card.currency,
                        currSymbol
                      )} unpaid triggers ${(monthlyPenaltyPct * 12).toFixed(0)}% APR charges. Compare lower-rate EMI shield if cash is tight.`}
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-1 border-t border-rose-500/30">
              {onOpenEmiComparison && !cashFlowAssessment.canAffordFullWithoutDeficit && (
                <button
                  type="button"
                  onClick={onOpenEmiComparison}
                  className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 text-[11px] font-semibold cursor-pointer whitespace-nowrap"
                >
                  Assess EMI Shield
                </button>
              )}
              {cashFlowAssessment.canAffordFullWithoutDeficit && (
                <button
                  type="button"
                  onClick={() => {
                    setPayOption('full_reduced');
                    setActualPaidInLedger(reducedStatementAmount.toString());
                  }}
                  className="px-2.5 py-1 rounded-lg bg-slate-950 hover:bg-slate-900 border border-rose-400/50 text-white text-[11px] font-semibold cursor-pointer whitespace-nowrap"
                >
                  Pay Full (0 Fee)
                </button>
              )}
            </div>
          </div>
        )}

        {/* Div 1: Statement Overview & Cash-Flow Verdict */}
        <div className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800 space-y-2.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400">Billed Statement</span>
            <span className="font-mono tabular-nums font-bold text-white text-sm">
              {formatMoney(originalBilledAmount, card.currency, currSymbol)}
            </span>
          </div>

          <div className="p-2.5 rounded-xl bg-indigo-950/30 border border-indigo-500/20 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <Gift size={15} className="text-indigo-400 shrink-0" />
              <span className="text-xs font-semibold text-indigo-200 truncate font-mono tabular-nums">
                Cashback: +{formatMoney(accumulatedCashback, card.currency, currSymbol)}
              </span>
            </div>

            <button
              type="button"
              onClick={() => setShowLogCashback(!showLogCashback)}
              className="px-2.5 py-1 rounded-lg bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-300 text-[11px] font-semibold flex items-center gap-1 cursor-pointer transition-colors shrink-0 whitespace-nowrap"
            >
              <Plus size={12} />
              <span>Log Cashback</span>
            </button>
          </div>

          {showLogCashback && (
            <div className="p-3 rounded-xl bg-slate-900 border border-slate-700/80 space-y-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] text-slate-400 mb-0.5">
                    Amount ({card.currency})
                  </label>
                  <input
                    type="number"
                    step="any"
                    placeholder="500"
                    value={newCashbackAmt}
                    onChange={(e) => setNewCashbackAmt(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-slate-400 mb-0.5">Note</label>
                  <input
                    type="text"
                    placeholder="Reward"
                    value={newCashbackNote}
                    onChange={(e) => setNewCashbackNote(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-1.5 pt-1">
                <button
                  type="button"
                  onClick={() => setShowLogCashback(false)}
                  className="px-2.5 py-1 rounded-lg bg-slate-800 text-slate-300 text-xs cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleLogCashback}
                  disabled={isLoggingCashback}
                  className="px-3 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold cursor-pointer"
                >
                  {isLoggingCashback ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          )}

          {accumulatedCashback > 0 && (
            <label className="flex items-center gap-2 cursor-pointer pt-1 border-t border-slate-800/80">
              <input
                type="checkbox"
                checked={applyCashback}
                onChange={(e) => setApplyCashback(e.target.checked)}
                className="w-4 h-4 rounded text-emerald-500 bg-slate-900 border-slate-700 focus:ring-emerald-400 cursor-pointer"
              />
              <span className="text-xs text-slate-300">
                Deduct{' '}
                <strong className="text-emerald-400 font-mono tabular-nums">
                  -{formatMoney(maxCashbackApplicable, card.currency, currSymbol)}
                </strong>{' '}
                cashback
              </span>
            </label>
          )}

          <div className="flex items-center justify-between text-xs pt-2 border-t border-slate-800">
            <span className="text-slate-300 font-semibold">Net Payable</span>
            <span className="font-mono tabular-nums font-black text-emerald-400 text-base">
              {formatMoney(reducedStatementAmount, card.currency, currSymbol)}
            </span>
          </div>

          {reducedStatementAmount > 0 && (
            <div className="pt-2 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-[11px]">
              <span className="text-slate-300 flex items-center gap-1.5">
                <Sparkles size={12} className="text-emerald-400 shrink-0" />
                <span>
                  {cashFlowAssessment.verdict === 'pay_full'
                    ? `Cash flow supports Full Payment · Saves +${formatMoney(
                        cashFlowAssessment.avoidableEmiLoss,
                        card.currency,
                        currSymbol,
                        settings.numberGrouping,
                        0
                      )} vs EMI`
                    : cashFlowAssessment.headline}
                </span>
              </span>
              {onOpenEmiComparison && (
                <button
                  type="button"
                  onClick={onOpenEmiComparison}
                  className="text-[11px] font-semibold text-cyan-400 hover:text-cyan-300 cursor-pointer whitespace-nowrap"
                >
                  EMI vs Full
                </button>
              )}
            </div>
          )}
        </div>

        {/* Div 2: Source Liquid Account Selection */}
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1">
            Debit Account
          </label>
          {bankAccounts.length === 0 ? (
            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs">
              No unlocked liquid cash or bank accounts available.
            </div>
          ) : (
            <select
              value={fromAccountId}
              onChange={(e) => setFromAccountId(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-slate-200"
              required
            >
              {bankAccounts.map((b) => {
                const bSym = currencies.find((c) => c.code === b.currency)?.symbol || `${b.currency} `;
                const { totalSweepIn: swp } = getAccountLiquidityWithSweepIn(b.id);
                return (
                  <option key={b.id} value={b.id}>
                    {formatAssetOptionLabel(b, assetTypes, {
                      currSymbol: bSym,
                      sweepInAmount: swp,
                    })}
                  </option>
                );
              })}
            </select>
          )}
          {selectedBank && (
            <div className="mt-1.5 px-3 py-1.5 rounded-lg bg-slate-950/60 border border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-300">
              <span className="font-medium break-words">{getSafeAssetName(selectedBank, assetTypes)}</span>
              <span className="font-mono tabular-nums">
                Cash: {formatMoney(bankBal, selectedBank.currency, currSymbol)}
                {totalSweepIn > 0 && (
                  <span className="text-cyan-400">
                    {' '}· +{formatMoney(totalSweepIn, selectedBank.currency, currSymbol)} Sweep-In
                  </span>
                )}
              </span>
            </div>
          )}
        </div>

        {/* Div 3: Payment Calculation Presets */}
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1">
            Settlement Preset
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <button
              type="button"
              onClick={() => {
                setPayOption('full_reduced');
                setActualPaidInLedger(reducedStatementAmount.toString());
              }}
              className={`p-2 rounded-xl border text-xs font-semibold cursor-pointer transition-all font-mono tabular-nums ${
                payOption === 'full_reduced'
                  ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300'
                  : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              Net ({formatMoney(reducedStatementAmount, card.currency, currSymbol, settings.numberGrouping, 0)})
            </button>

            <button
              type="button"
              onClick={() => {
                setPayOption('full_original');
                setActualPaidInLedger(originalBilledAmount.toString());
              }}
              className={`p-2 rounded-xl border text-xs font-semibold cursor-pointer transition-all font-mono tabular-nums ${
                payOption === 'full_original'
                  ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300'
                  : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              Gross ({formatMoney(originalBilledAmount, card.currency, currSymbol, settings.numberGrouping, 0)})
            </button>

            <button
              type="button"
              onClick={() => {
                setPayOption('min');
                setActualPaidInLedger(
                  Math.min(
                    reducedStatementAmount,
                    Math.max(500, Math.round(originalBilledAmount * 0.05))
                  ).toString()
                );
              }}
              className={`p-2 rounded-xl border text-xs font-semibold cursor-pointer transition-all font-mono tabular-nums ${
                payOption === 'min'
                  ? 'bg-rose-500/20 border-rose-500 text-rose-300'
                  : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              Min 5% ({formatMoney(Math.min(reducedStatementAmount, Math.max(500, Math.round(originalBilledAmount * 0.05))), card.currency, currSymbol, settings.numberGrouping, 0)})
            </button>

            <button
              type="button"
              onClick={() => setPayOption('custom')}
              className={`p-2 rounded-xl border text-xs font-semibold cursor-pointer transition-all ${
                payOption === 'custom'
                  ? 'bg-indigo-500/20 border-indigo-500 text-indigo-300'
                  : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              Custom
            </button>
          </div>
        </div>

        {payOption === 'custom' && (
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">
              Custom Amount ({card.currency})
            </label>
            <input
              type="number"
              step="any"
              placeholder="0.00"
              value={customAmount}
              onChange={(e) => {
                setCustomAmount(e.target.value);
                setActualPaidInLedger(e.target.value);
              }}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 font-mono tabular-nums"
              required
            />
          </div>
        )}

        {/* Div 4: Actual Statement Amount Paid in Ledger (Clean, Precise, No Verbose Paragraph) */}
        <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <label className="font-semibold text-slate-200">
              Ledger Debit Amount ({card.currency})
            </label>
            <span className="text-[10px] font-mono tabular-nums text-slate-400">
              Remaining card balance: {formatMoney(unpaidRevolvingRemainder, card.currency, currSymbol)}
            </span>
          </div>
          <input
            type="number"
            step="any"
            value={actualPaidInLedger}
            onChange={(e) => setActualPaidInLedger(e.target.value)}
            className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white font-mono tabular-nums font-bold focus:outline-none focus:border-emerald-500"
            required
          />
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 text-xs font-semibold cursor-pointer whitespace-nowrap"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSubmitting || bankAccounts.length === 0}
            className={`px-5 py-2 rounded-xl text-white text-xs font-bold shadow-md cursor-pointer disabled:opacity-50 whitespace-nowrap flex items-center gap-1.5 ${
              isLosingMoneyToRevolvingCharges
                ? 'bg-rose-600 hover:bg-rose-500 shadow-rose-600/30'
                : 'bg-emerald-600 hover:bg-emerald-500 shadow-emerald-600/20'
            }`}
          >
            {isSubmitting ? (
              <span>Processing...</span>
            ) : totalSweepIn > 0 && bankBal < parsedActualAmount ? (
              <>
                <Zap size={13} />
                <span>
                  Settle via Sweep-In ({formatMoney(parsedActualAmount, card.currency, currSymbol)})
                </span>
              </>
            ) : (
              <span>
                {isLosingMoneyToRevolvingCharges
                  ? `Proceed Partial (${formatMoney(parsedActualAmount, card.currency, currSymbol)})`
                  : `Settle ${formatMoney(parsedActualAmount, card.currency, currSymbol)}`}
              </span>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
};
