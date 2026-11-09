import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Liability } from '../../types';
import { convertToBase } from '../../lib/calcEngine';
import { formatMoney, formatCompactMoney } from '../../lib/formatters';
import { getSafeAssetName, getSafeLiabilityName } from '../../lib/assetRules';
import { AddEditLoanModal } from './AddEditLoanModal';
import { AddEditCardModal } from './AddEditCardModal';
import { BatchAddLiabilitiesModal } from './BatchAddLiabilitiesModal';
import { PayCardModal } from './PayCardModal';
import { PayLoanModal } from './PayLoanModal';
import { LogCashbackModal } from './LogCashbackModal';
import { CreditCardEmiModal } from './CreditCardEmiModal';
import { DebtStrategyCard } from './DebtStrategyCard';
import { WhatIfSimulatorModal } from '../simulator/WhatIfSimulatorModal';
import {
  CreditCard,
  Building2,
  Calendar,
  AlertTriangle,
  Banknote,
  MoreVertical,
  Edit2,
  Trash2,
  Layers,
  Landmark,
  ShieldCheck,
  Clock,
  CheckCircle2,
  Gift,
  Sparkles,
  Zap,
  Lock,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import {
  getLoanLockInStatus,
  calculateLoanPrepaymentCharge,
  resolveRemainingTenureMonths,
  getFullLoanAmortizationSchedule,
} from '../../lib/loanPrepaymentEngine';

export const LiabilitiesView: React.FC = () => {
  const {
    liabilities,
    holdings,
    transactions,
    assetTypes,
    currencies,
    settings,
    deleteLiability,
    engineResult,
    logDebitCardAtmWithdrawal,
    getCardEffectiveMode,
  } = useApp();

  const [isAddLoanOpen, setIsAddLoanOpen] = useState(false);
  const [isAddCardOpen, setIsAddCardOpen] = useState(false);
  const [isBatchAddOpen, setIsBatchAddOpen] = useState(false);
  const [editingLiability, setEditingLiability] = useState<Liability | null>(null);
  const [selectedCardForPay, setSelectedCardForPay] = useState<Liability | null>(null);
  const [cardPayAmountOverride, setCardPayAmountOverride] = useState<number | undefined>(undefined);
  const [selectedCardForCashback, setSelectedCardForCashback] = useState<Liability | null>(null);
  const [selectedLoanForPay, setSelectedLoanForPay] = useState<Liability | null>(null);
  const [expandedScheduleLoanId, setExpandedScheduleLoanId] = useState<string | null>(null);
  const [emiCard, setEmiCard] = useState<Liability | null>(null);
  const [isWhatIfOpen, setIsWhatIfOpen] = useState<boolean>(false);
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);

  const baseCurr = settings.baseCurrency || 'INR';
  const currMap: Record<string, typeof currencies[0]> = {};
  for (const c of currencies) currMap[c.code] = c;
  const baseCurrSymbol = currMap[baseCurr]?.symbol || '₹';

  // Credit cards remain visible even with a zero balance (outstanding === 0)
  const creditCards = liabilities.filter((l) => l.kind === 'card' && (l.cardType === 'credit' || !l.cardType));
  const debitCards = liabilities.filter((l) => l.kind === 'card' && l.cardType === 'debit');
  const hybridCards = liabilities.filter((l) => l.kind === 'card' && l.cardType === 'hybrid');

  // Automatically remove loans from active list if their balance reaches zero (preserved in exported files)
  const activeLoans = liabilities.filter((l) => l.kind === 'loan' && (l.outstanding || 0) > 0);

  const cardStateMap = new Map((engineResult.cardStates || []).map((cs) => [cs.id, cs]));

  return (
    <div className="space-y-5 pb-20 animate-fade-in">
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">Liabilities & Cards</h2>
          <p className="text-xs text-slate-400">
            Total debt:{' '}
            <strong className="text-rose-400 font-mono">
              {formatMoney(
                engineResult.totalLiabilitiesBase,
                baseCurr,
                baseCurrSymbol,
                settings.numberGrouping,
                0
              )}
            </strong>{' '}
            (Annual carrying cost:{' '}
            {formatMoney(
              engineResult.liabilitiesYearlyCostBase + engineResult.annualOverduePenaltyBase,
              baseCurr,
              baseCurrSymbol,
              settings.numberGrouping,
              0
            )}
            /yr)
          </p>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap sm:flex-nowrap w-full sm:w-auto">
          <button
            onClick={() => setIsWhatIfOpen(true)}
            className="flex-1 sm:flex-none px-2.5 py-2 rounded-xl bg-blue-950/60 border border-blue-800/50 hover:bg-blue-900/60 text-xs font-semibold text-blue-300 flex items-center justify-center gap-1.5 cursor-pointer shadow-sm"
            title="Simulate debt payoff & savings scenarios"
          >
            <Sparkles size={14} className="text-blue-400" />
            <span>What-If</span>
          </button>
          <button
            onClick={() => setIsBatchAddOpen(true)}
            className="flex-1 sm:flex-none px-2.5 py-2 rounded-xl bg-slate-900 border border-slate-800 hover:bg-slate-800 text-xs font-semibold text-slate-200 flex items-center justify-center gap-1.5 cursor-pointer shadow-sm"
            title="Add multiple cards and loans at once"
          >
            <Layers size={14} className="text-cyan-400" />
            <span className="hidden sm:inline">Batch Add</span>
            <span className="sm:hidden">Batch</span>
          </button>
          <button
            onClick={() => {
              setEditingLiability(null);
              setIsAddCardOpen(true);
            }}
            className="flex-1 sm:flex-none px-2.5 py-2 rounded-xl bg-slate-900 border border-slate-800 hover:bg-slate-800 text-xs font-semibold text-slate-200 flex items-center justify-center gap-1 cursor-pointer shadow-sm"
          >
            <CreditCard size={14} className="text-rose-400" />
            <span>+ Card</span>
          </button>
          <button
            onClick={() => {
              setEditingLiability(null);
              setIsAddLoanOpen(true);
            }}
            className="flex-1 sm:flex-none px-2.5 py-2 rounded-xl bg-slate-900 border border-slate-800 hover:bg-slate-800 text-xs font-semibold text-slate-200 flex items-center justify-center gap-1 cursor-pointer shadow-sm"
          >
            <Building2 size={14} className="text-indigo-400" />
            <span>+ Loan</span>
          </button>
        </div>
      </div>

      {/* Debt Payoff Intelligence: Avalanche vs Snowball vs Minimum - Displayed at Top */}
      <DebtStrategyCard onPayDebt={(loan) => setSelectedLoanForPay(loan)} />

      {/* Overall Credit Utilization Monitoring Card */}
      {(creditCards.length > 0 || hybridCards.length > 0) && (() => {
        const activeRevolvingCards = [
          ...creditCards,
          ...hybridCards.filter(
            (hc) => getCardEffectiveMode(hc) === 'credit' || (hc.outstanding || 0) > 0
          ),
        ];
        if (activeRevolvingCards.length === 0) return null;
        const totalCardDebt = activeRevolvingCards.reduce((sum, c) => sum + (c.outstanding || 0), 0);
        const totalCardLimit = activeRevolvingCards.reduce(
          (sum, c) => sum + (c.creditLimit || c.limit || 0),
          0
        );
        const overallUtilization = totalCardLimit > 0 ? (totalCardDebt / totalCardLimit) * 100 : 0;
        const utilThreshold = settings.creditUtilizationThresholdPct || 30;
        const isHighUtil = overallUtilization >= utilThreshold;

        return (
          <div className={`p-4 rounded-2xl border transition-all shadow-sm ${
            isHighUtil
              ? 'bg-rose-950/20 border-rose-500/40 text-rose-200'
              : 'bg-slate-900 border-slate-800 text-slate-300'
          }`}>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-2">
                <CreditCard size={16} className={isHighUtil ? 'text-rose-400' : 'text-emerald-400'} />
                <span className="text-xs font-bold uppercase tracking-wider text-white">
                  Total Credit Limit Utilization
                </span>
                <span className="text-slate-600" aria-hidden="true">·</span>
                <span className={`text-[11px] font-semibold ${
                  isHighUtil ? 'text-rose-300' : 'text-emerald-400'
                }`}>
                  {isHighUtil ? `Above ${utilThreshold}% limit` : `Healthy (under ${utilThreshold}%)`}
                </span>
              </div>
              <div className="text-xs font-mono font-bold text-white">
                {overallUtilization.toFixed(1)}% Used
              </div>
            </div>

            {/* Progress bar */}
            <div className="w-full h-2 rounded-full bg-slate-950 overflow-hidden my-2 border border-slate-800">
              <div
                className={`h-full rounded-full transition-all duration-300 ${
                  overallUtilization > 70
                    ? 'bg-rose-500'
                    : overallUtilization > utilThreshold
                    ? 'bg-amber-400'
                    : 'bg-emerald-400'
                }`}
                style={{ width: `${Math.min(100, overallUtilization)}%` }}
              />
            </div>

            <div className="flex flex-wrap items-center justify-between text-xs text-slate-400 mt-2">
              <span>
                Total card balances: <strong className="text-white font-mono">{formatMoney(totalCardDebt, baseCurr, baseCurrSymbol)}</strong> of{' '}
                <strong className="text-slate-200 font-mono">{formatMoney(totalCardLimit, baseCurr, baseCurrSymbol)}</strong> total limit
              </span>
              <span className="text-[11px] text-slate-400">
                {isHighUtil ? 'High utilization negatively affects credit score model' : 'Safely protecting your credit score'}
              </span>
            </div>
          </div>
        );
      })()}

      {/* Credit Cards Section */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
            <CreditCard size={15} className="text-rose-400" />
            <span>Credit Cards ({creditCards.length})</span>
          </h3>
          <span className="text-[11px] text-slate-400">
            Statement cycles & grace periods
          </span>
        </div>

        {creditCards.length === 0 ? (
          <div className="p-6 rounded-2xl bg-slate-900/50 border border-slate-800 text-center text-xs text-slate-400">
            No credit cards added. Click "+ Add Card" to track cycles and utilization.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {creditCards.map((card) => {
              const state = cardStateMap.get(card.id);
              const isOverdue = state?.status === 'Overdue';
              const isDueSoon = state?.status === 'DueSoon';
              const cardCurrSym = currMap[card.currency]?.symbol || card.currency;
              const limit = card.limit || 100000;
              const utilization = Math.min(100, (card.outstanding / limit) * 100);

              return (
                <div
                  key={card.id}
                  className={`rounded-2xl p-4 transition-all relative shadow-md ${
                    isOverdue
                      ? 'bg-rose-950/25 border-2 border-rose-500 text-slate-200'
                      : isDueSoon
                      ? 'bg-amber-950/20 border-2 border-amber-500 text-slate-200'
                      : 'bg-slate-900 border border-slate-800 hover:border-slate-700'
                  }`}
                >
                  {/* Card Header */}
                  <div className="flex flex-wrap items-start justify-between gap-2.5">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="text-base font-bold text-white break-words">{getSafeLiabilityName(card)}</h4>
                        {isOverdue && (
                          <span className="px-2 py-0.5 rounded bg-rose-500 text-white text-[10px] font-bold uppercase tracking-wider">
                            Overdue
                          </span>
                        )}
                        {isDueSoon && (
                          <span className="px-2 py-0.5 rounded bg-amber-500 text-slate-950 text-[10px] font-bold uppercase tracking-wider">
                            Due in {state?.daysRemaining}d
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Statement day {card.statementDay || 20} · {card.interestFreeDays || 18}d grace period
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 ml-auto">
                      {(card.outstanding || 0) > 0 && (
                        <button
                          onClick={() => setEmiCard(card)}
                          className="px-2.5 py-1.5 rounded-xl bg-purple-950/70 text-purple-300 border border-purple-800/40 hover:bg-purple-900/60 text-xs font-semibold cursor-pointer shadow-sm transition shrink-0"
                          title="Compare EMI Conversion vs Full Payment"
                        >
                          EMI vs Full
                        </button>
                      )}
                      <button
                        onClick={() => setSelectedCardForPay(card)}
                        className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-sm shadow-emerald-600/30 cursor-pointer shrink-0"
                      >
                        Pay Card
                      </button>

                      <div className="relative shrink-0">
                        <button
                          type="button"
                          onClick={() => setActiveMenuId(activeMenuId === card.id ? null : card.id)}
                          aria-label={`More options for ${getSafeLiabilityName(card)}`}
                          aria-haspopup="menu"
                          aria-expanded={activeMenuId === card.id}
                          title={`More options for ${getSafeLiabilityName(card)}`}
                          className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all cursor-pointer border ${
                            activeMenuId === card.id
                              ? 'bg-indigo-600 text-white border-indigo-500 shadow-md ring-2 ring-indigo-500/40'
                              : 'bg-slate-800/90 hover:bg-slate-700 text-slate-200 hover:text-white border-slate-700/80 hover:border-slate-500 shadow-xs'
                          } focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1 focus:ring-offset-slate-900`}
                        >
                          <MoreVertical size={16} className="shrink-0" />
                        </button>
                        {activeMenuId === card.id && (
                          <>
                            <div className="fixed inset-0 z-40" onClick={() => setActiveMenuId(null)} aria-hidden="true" />
                            <div
                              role="menu"
                              aria-label={`Options for ${getSafeLiabilityName(card)}`}
                              className="absolute right-0 top-9 z-50 min-w-36 bg-slate-950 border border-slate-700 rounded-xl shadow-2xl p-1.5 flex flex-col gap-1 backdrop-blur-md animate-fade-in"
                            >
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => {
                                  setActiveMenuId(null);
                                  setEditingLiability(card);
                                  setIsAddCardOpen(true);
                                }}
                                className="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-slate-200 hover:bg-slate-800/80 flex items-center gap-2 cursor-pointer text-left transition-colors"
                              >
                                <Edit2 size={13} className="shrink-0 text-slate-400" />
                                <span>Edit</span>
                              </button>
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => {
                                  setActiveMenuId(null);
                                  deleteLiability(card.id);
                                }}
                                className="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-rose-400 hover:bg-rose-500/10 flex items-center gap-2 cursor-pointer text-left w-full transition-colors"
                              >
                                <Trash2 size={13} className="shrink-0 text-rose-400" />
                                <span>Delete</span>
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Balance & Utilization */}
                  <div className="my-3 flex items-baseline justify-between">
                    <div>
                      <span className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">
                        Outstanding Due
                      </span>
                      <div className="text-xl font-black text-white font-mono mt-0.5">
                        {formatMoney(card.outstanding, card.currency, cardCurrSym)}
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">
                        Utilization
                      </span>
                      <div className="text-xs font-mono font-bold text-slate-200 mt-0.5">
                        {utilization.toFixed(0)}% of {formatCompactMoney(limit, card.currency, cardCurrSym)}
                      </div>
                    </div>
                  </div>

                  {/* Utilization Progress Bar */}
                  <div className="w-full h-1.5 rounded-full bg-slate-800 overflow-hidden mb-3">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${
                        utilization > 70
                          ? 'bg-rose-500'
                          : utilization > 30
                          ? 'bg-amber-400'
                          : 'bg-emerald-400'
                      }`}
                      style={{ width: `${utilization}%` }}
                    />
                  </div>

                  {/* Statement Generation Cycle & Unbilled Status (User Requested) */}
                  <div className="p-2.5 rounded-xl bg-slate-950/70 border border-slate-800/80 mb-3 space-y-1.5 text-[11px]">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Statement Date:</span>
                      <strong className="text-indigo-300 font-mono">
                        {state?.statementDate || card.nextStatementDate || `Day ${card.statementDay || 20}`}
                      </strong>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Cool-Off Grace Period:</span>
                      <strong className="text-slate-200 font-mono">
                        {state?.coolOffDays || card.coolOffDays || card.interestFreeDays || 20} days
                      </strong>
                    </div>
                    <div className="flex items-center justify-between pt-1 border-t border-slate-800/80">
                      <span className="text-slate-300 font-medium">Last Date to Pay (Due Date):</span>
                      <strong className="text-emerald-400 font-mono">
                        {state?.dueDate || 'Pending'}
                      </strong>
                    </div>

                    {card.outstanding > 0 && (
                      <div className="pt-1">
                        {!state?.isStatementGenerated ? (
                          <div className="px-2 py-1 rounded-lg bg-indigo-500/10 border border-indigo-500/25 text-indigo-300 text-[10px] flex items-center gap-1.5">
                            <Clock size={12} className="text-indigo-400 shrink-0" />
                            <span>
                              <strong>Unbilled Spends:</strong> Statement not generated yet. Amount is NOT due until statement generation date.
                            </span>
                          </div>
                        ) : (
                          <div className="px-2 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-emerald-300 text-[10px] flex items-center gap-1.5">
                            <CheckCircle2 size={12} className="text-emerald-400 shrink-0" />
                            <span>
                              <strong>Statement Generated:</strong> Amount billed. Pay before {state?.dueDate} ({state?.daysRemaining} days remaining).
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Cashback Rewards & Annual Fee */}
                  <div className="mt-2.5 pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px]">
                    <div className="flex items-center gap-1.5 text-slate-300">
                      <Gift size={13} className="text-indigo-400" />
                      <span>Cashback:</span>
                      <strong className="text-emerald-400 font-mono">
                        +{formatMoney(card.accumulatedCashback || 0, card.currency, cardCurrSym)}
                      </strong>
                      <button
                        type="button"
                        onClick={() => setSelectedCardForCashback(card)}
                        className="px-1.5 py-0.5 rounded bg-indigo-500/20 hover:bg-indigo-500/35 text-indigo-300 text-[10px] font-semibold cursor-pointer transition-colors"
                        title="Log cashback earned to reduce next statement"
                      >
                        + Log
                      </button>
                    </div>

                    <div className="text-[10px] text-slate-400 font-mono">
                      <span>Annual Fee: {formatMoney(card.annualFee || 0, card.currency, cardCurrSym)}</span>
                      {card.annualFeeWaiverSpend ? (
                        <span className="text-slate-500 block">
                          (Waiver at {formatMoney(card.annualFeeWaiverSpend, card.currency, cardCurrSym)})
                        </span>
                      ) : null}
                    </div>
                  </div>

                  {/* Cycle Status & Penalty Notice */}
                  <div className="flex items-center justify-between text-xs pt-2 border-t border-slate-800/60">
                    <div className="flex items-center gap-1.5 text-slate-300">
                      <Calendar size={13} className="text-slate-400" />
                      <span>Due: <strong className="text-white">{state?.dueDate || 'Current'}</strong></span>
                    </div>

                    {isOverdue ? (
                      <span className="text-rose-400 font-bold font-mono text-[11px]">
                        +{formatCompactMoney(state?.annualPenaltyCost || 0, baseCurr, baseCurrSymbol)}/yr penalty
                      </span>
                    ) : (
                      <span className="text-emerald-400 font-mono text-[11px]">
                        0% APR within grace period
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Hybrid Cards Section (Dual Credit + Debit functionality depending on linked bank balance) */}
      <div className="space-y-3 pt-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
            <Zap size={15} className="text-amber-400" />
            <span>Hybrid Cards ({hybridCards.length})</span>
          </h3>
          <span className="text-[11px] text-slate-400">
            Debit when linked bank &gt; 0 · Credit when &lt;= 0
          </span>
        </div>

        {hybridCards.length === 0 ? (
          <div className="p-6 rounded-2xl bg-slate-900/50 border border-slate-800 text-center text-xs text-slate-400">
            No hybrid cards added. Click &quot;+ Card&quot; and choose &quot;Hybrid Card&quot; to track cards that operate as Debit when linked bank balance is positive and Credit when 0 or non-positive.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {hybridCards.map((card) => {
              const linkedBank = holdings.find((h) => h.id === card.linkedAccountId);
              const bankBal = linkedBank?.principalOrValue || 0;
              const isDebitMode = getCardEffectiveMode(card) === 'debit';
              const cardCurrSym = currMap[card.currency]?.symbol || card.currency;
              const limit = card.creditLimit || card.limit || 100000;
              const utilization = Math.min(100, ((card.outstanding || 0) / limit) * 100);

              const curMonthStr = new Date().toISOString().substring(0, 7);
              const isThisMonth = card.lastAtmUsageMonth === curMonthStr;
              const metroUsage = isThisMonth ? (card.metroAtmUsageThisMonth || 0) : 0;
              const nonMetroUsage = isThisMonth ? (card.nonMetroAtmUsageThisMonth || 0) : 0;
              const metroLimit = card.metroAtmFreeLimit ?? settings.debitCardMetroAtmLimit ?? 5;
              const nonMetroLimit = card.nonMetroAtmFreeLimit ?? settings.debitCardNonMetroAtmLimit ?? 3;

              return (
                <div
                  key={card.id}
                  className="rounded-2xl p-4 bg-slate-900 border border-slate-800 hover:border-slate-700 transition-all relative shadow-md space-y-3"
                >
                  {/* Header */}
                  <div className="flex flex-wrap items-start justify-between gap-2.5">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="text-base font-bold text-white break-words">{getSafeLiabilityName(card)}</h4>
                        <span className="text-[11px] text-slate-400">
                          Hybrid Card ·{' '}
                          <strong className={isDebitMode ? 'text-cyan-300' : 'text-amber-300'}>
                            {isDebitMode ? 'Debit Mode (> 0)' : 'Credit Mode (<= 0)'}
                          </strong>
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Linked Bank:{' '}
                        <strong className="text-white">
                          {linkedBank ? getSafeAssetName(linkedBank, assetTypes) : 'Unlinked'}
                        </strong>{' '}
                        (Balance:{' '}
                        <span className={bankBal > 0 ? 'text-emerald-400 font-bold font-mono tabular-nums' : 'text-amber-300 font-mono tabular-nums'}>
                          {formatMoney(bankBal, linkedBank?.currency || card.currency, cardCurrSym)}
                        </span>
                        )
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 ml-auto">
                      <button
                        onClick={() => setSelectedCardForPay(card)}
                        className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-sm shadow-emerald-600/30 cursor-pointer shrink-0"
                      >
                        Pay Card
                      </button>

                      <div className="relative shrink-0">
                        <button
                          type="button"
                          onClick={() => setActiveMenuId(activeMenuId === card.id ? null : card.id)}
                          aria-label={`More options for ${getSafeLiabilityName(card)}`}
                          aria-haspopup="menu"
                          aria-expanded={activeMenuId === card.id}
                          title={`More options for ${getSafeLiabilityName(card)}`}
                          className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all cursor-pointer border ${
                            activeMenuId === card.id
                              ? 'bg-indigo-600 text-white border-indigo-500 shadow-md ring-2 ring-indigo-500/40'
                              : 'bg-slate-800/90 hover:bg-slate-700 text-slate-200 hover:text-white border-slate-700/80 hover:border-slate-500 shadow-xs'
                          } focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1 focus:ring-offset-slate-900`}
                        >
                          <MoreVertical size={16} className="shrink-0" />
                        </button>
                        {activeMenuId === card.id && (
                          <>
                            <div className="fixed inset-0 z-40" onClick={() => setActiveMenuId(null)} aria-hidden="true" />
                            <div
                              role="menu"
                              aria-label={`Options for ${getSafeLiabilityName(card)}`}
                              className="absolute right-0 top-9 z-50 min-w-36 bg-slate-950 border border-slate-700 rounded-xl shadow-2xl p-1.5 flex flex-col gap-1 backdrop-blur-md animate-fade-in"
                            >
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => {
                                  setActiveMenuId(null);
                                  setEditingLiability(card);
                                  setIsAddCardOpen(true);
                                }}
                                className="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-slate-200 hover:bg-slate-800/80 flex items-center gap-2 cursor-pointer text-left transition-colors"
                              >
                                <Edit2 size={13} className="shrink-0 text-slate-400" />
                                <span>Edit</span>
                              </button>
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => {
                                  setActiveMenuId(null);
                                  deleteLiability(card.id);
                                }}
                                className="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-rose-400 hover:bg-rose-500/10 flex items-center gap-2 cursor-pointer text-left w-full transition-colors"
                              >
                                <Trash2 size={13} className="shrink-0 text-rose-400" />
                                <span>Delete</span>
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Mode Explanation Banner */}
                  <div
                    className={`p-2.5 rounded-xl text-xs flex items-start gap-2 border ${
                      isDebitMode
                        ? 'bg-cyan-950/30 border-cyan-500/30 text-cyan-200'
                        : 'bg-amber-950/30 border-amber-500/30 text-amber-200'
                    }`}
                  >
                    <Zap size={14} className={isDebitMode ? 'text-cyan-400 shrink-0 mt-0.5' : 'text-amber-400 shrink-0 mt-0.5'} />
                    <div className="leading-snug text-[11px]">
                      {isDebitMode ? (
                        <span>
                          <strong>Debit Mode Active:</strong> Linked bank balance is positive ({formatMoney(bankBal, linkedBank?.currency || card.currency, cardCurrSym)}). Spends deduct bank cash first, then Sweep-In FDs, before touching the credit limit.
                        </span>
                      ) : (
                        <span>
                          <strong>Credit Mode Active:</strong> Linked bank balance is 0 or non-positive ({formatMoney(bankBal, linkedBank?.currency || card.currency, cardCurrSym)}). Card operates strictly as a Credit Card within its {formatCompactMoney(limit, card.currency, cardCurrSym)} limit.
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Balance & Utilization */}
                  <div className="flex items-baseline justify-between text-xs">
                    <div>
                      <span className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">
                        Outstanding Credit Balance
                      </span>
                      <div className="text-lg font-black text-white font-mono mt-0.5">
                        {formatMoney(card.outstanding, card.currency, cardCurrSym)}
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">
                        Credit Limit Used
                      </span>
                      <div className="text-xs font-mono font-bold text-slate-200 mt-0.5">
                        {utilization.toFixed(0)}% of {formatCompactMoney(limit, card.currency, cardCurrSym)}
                      </div>
                    </div>
                  </div>

                  {/* Utilization Progress Bar */}
                  <div className="w-full h-1.5 rounded-full bg-slate-800 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${
                        utilization > 70 ? 'bg-rose-500' : utilization > 30 ? 'bg-amber-400' : 'bg-emerald-400'
                      }`}
                      style={{ width: `${utilization}%` }}
                    />
                  </div>

                  {/* Cashback & Annual Fee */}
                  <div className="pt-2 border-t border-slate-800/70 flex items-center justify-between text-[11px]">
                    <div className="flex items-center gap-1.5 text-slate-300">
                      <Gift size={13} className="text-indigo-400" />
                      <span>Cashback:</span>
                      <strong className="text-emerald-400 font-mono">
                        +{formatMoney(card.accumulatedCashback || 0, card.currency, cardCurrSym)}
                      </strong>
                      <button
                        type="button"
                        onClick={() => setSelectedCardForCashback(card)}
                        className="px-1.5 py-0.5 rounded bg-indigo-500/20 hover:bg-indigo-500/35 text-indigo-300 text-[10px] font-semibold cursor-pointer transition-colors"
                      >
                        + Log
                      </button>
                    </div>

                    <div className="text-[10px] text-slate-400 font-mono">
                      <span>Annual Fee: {formatMoney(card.annualFee || 0, card.currency, cardCurrSym)}</span>
                    </div>
                  </div>

                  {/* ATM Monthly Usage Tracker (Active for hybrid debit functionality) */}
                  <div className="p-2.5 rounded-xl bg-slate-950/70 border border-slate-800 text-[11px] space-y-1.5">
                    <div className="flex justify-between items-center text-slate-400 font-semibold">
                      <span>ATM Free Limits (Non-Metro: {nonMetroLimit} | Metro: {metroLimit})</span>
                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => logDebitCardAtmWithdrawal(card.id, 'non_metro')}
                          className="px-1.5 py-0.5 rounded bg-slate-800 text-[10px] text-cyan-300 cursor-pointer"
                        >
                          + Non-Metro ({nonMetroUsage}/{nonMetroLimit})
                        </button>
                        <button
                          type="button"
                          onClick={() => logDebitCardAtmWithdrawal(card.id, 'metro')}
                          className="px-1.5 py-0.5 rounded bg-slate-800 text-[10px] text-emerald-300 cursor-pointer"
                        >
                          + Metro ({metroUsage}/{metroLimit})
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Debit Cards Section (Strictly Linked to Bank Accounts & ATM Usage Limits) */}
      <div className="space-y-3 pt-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
            <Landmark size={15} className="text-cyan-400" />
            <span>Debit Cards ({debitCards.length})</span>
          </h3>
          <span className="text-[11px] text-slate-400">
            Bank account links & monthly ATM surcharge tracker
          </span>
        </div>

        {debitCards.length === 0 ? (
          <div className="p-6 rounded-2xl bg-slate-900/50 border border-slate-800 text-center text-xs text-slate-400">
            No debit cards tracked. Click "+ Add Card" and select "Debit Card" to link with your bank account.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {debitCards.map((card) => {
              const linkedBank = holdings.find((h) => h.id === card.linkedAccountId);
              const curMonthStr = new Date().toISOString().substring(0, 7);
              const isThisMonth = card.lastAtmUsageMonth === curMonthStr;
              const metroUsage = isThisMonth ? (card.metroAtmUsageThisMonth || 0) : 0;
              const nonMetroUsage = isThisMonth ? (card.nonMetroAtmUsageThisMonth || 0) : 0;
              const totalUsage = metroUsage + nonMetroUsage;
              const metroLimit = card.metroAtmFreeLimit ?? settings.debitCardMetroAtmLimit ?? 5;
              const nonMetroLimit = card.nonMetroAtmFreeLimit ?? settings.debitCardNonMetroAtmLimit ?? 3;
              const isExceeded = nonMetroUsage >= nonMetroLimit || metroUsage >= metroLimit;
              const isHighUsage = totalUsage >= 3;
              const extraFee = card.atmExtraFeeAmount ?? settings.debitCardExtraFeePerWithdrawal ?? 21;

              return (
                <div
                  key={card.id}
                  className={`rounded-2xl p-4 transition-all relative shadow-md border ${
                    isExceeded
                      ? 'bg-rose-950/30 border-rose-500/80 shadow-rose-950/40 text-slate-200'
                      : isHighUsage
                      ? 'bg-amber-950/20 border-amber-500/60 shadow-amber-950/30 text-slate-200'
                      : 'bg-slate-900 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2.5">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="text-base font-bold text-white break-words">{getSafeLiabilityName(card)}</h4>
                        <span className="text-[11px] text-slate-400">
                          Debit Card · {totalUsage} uses this mo
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-slate-300 mt-1 flex-wrap">
                        <Landmark size={13} className="text-cyan-400 shrink-0" />
                        <span>Linked Bank:</span>
                        <strong className="text-white">
                          {linkedBank
                            ? `${getSafeAssetName(linkedBank, assetTypes)} (${linkedBank.currency} ${(linkedBank.principalOrValue || 0).toLocaleString()})`
                            : 'Unlinked Account'}
                        </strong>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 ml-auto">
                      <div className="relative shrink-0">
                        <button
                          type="button"
                          onClick={() => setActiveMenuId(activeMenuId === card.id ? null : card.id)}
                          aria-label={`More options for ${getSafeLiabilityName(card)}`}
                          aria-haspopup="menu"
                          aria-expanded={activeMenuId === card.id}
                          title={`More options for ${getSafeLiabilityName(card)}`}
                          className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all cursor-pointer border ${
                            activeMenuId === card.id
                              ? 'bg-indigo-600 text-white border-indigo-500 shadow-md ring-2 ring-indigo-500/40'
                              : 'bg-slate-800/90 hover:bg-slate-700 text-slate-200 hover:text-white border-slate-700/80 hover:border-slate-500 shadow-xs'
                          } focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1 focus:ring-offset-slate-900`}
                        >
                          <MoreVertical size={16} className="shrink-0" />
                        </button>
                        {activeMenuId === card.id && (
                          <>
                            <div className="fixed inset-0 z-40" onClick={() => setActiveMenuId(null)} aria-hidden="true" />
                            <div
                              role="menu"
                              aria-label={`Options for ${getSafeLiabilityName(card)}`}
                              className="absolute right-0 top-9 z-50 min-w-36 bg-slate-950 border border-slate-700 rounded-xl shadow-2xl p-1.5 flex flex-col gap-1 backdrop-blur-md animate-fade-in"
                            >
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => {
                                  setActiveMenuId(null);
                                  setEditingLiability(card);
                                  setIsAddCardOpen(true);
                                }}
                                className="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-slate-200 hover:bg-slate-800/80 flex items-center gap-2 cursor-pointer text-left transition-colors"
                              >
                                <Edit2 size={13} className="shrink-0 text-slate-400" />
                                <span>Edit</span>
                              </button>
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => {
                                  setActiveMenuId(null);
                                  deleteLiability(card.id);
                                }}
                                className="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-rose-400 hover:bg-rose-500/10 flex items-center gap-2 cursor-pointer text-left w-full transition-colors"
                              >
                                <Trash2 size={13} className="shrink-0 text-rose-400" />
                                <span>Delete</span>
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Surcharge Alert when limits are reached or high usage occurs */}
                  {isExceeded ? (
                    <div className="p-2.5 rounded-xl bg-rose-500/20 border border-rose-500/60 text-rose-200 text-xs my-3 flex items-start gap-2">
                      <AlertTriangle size={15} className="text-rose-400 shrink-0 mt-0.5" />
                      <div className="leading-snug">
                        <strong>ATM Surcharge Alert:</strong> Free monthly ATM quota exceeded! Further cash withdrawals on this specific card will incur an extra fee of <strong>₹{extraFee}</strong> by your bank.
                      </div>
                    </div>
                  ) : isHighUsage ? (
                    <div className="p-2.5 rounded-xl bg-amber-500/20 border border-amber-500/50 text-amber-200 text-xs my-3 flex items-start gap-2">
                      <AlertTriangle size={15} className="text-amber-400 shrink-0 mt-0.5" />
                      <div className="leading-snug">
                        <strong>Usage Warning ({totalUsage} uses this month):</strong> Beyond your free quota (3 Non-Metro / 5 Metro), if this specific card is used you will be asked to pay an extra fee of <strong>₹{extraFee}</strong> per withdrawal.
                      </div>
                    </div>
                  ) : null}

                  {/* ATM Monthly Usage Tracker */}
                  <div className="my-3 space-y-2 p-3 rounded-xl bg-slate-950/70 border border-slate-800">
                    <div className="flex items-center justify-between text-xs font-bold text-slate-300">
                      <span>Monthly Free ATM Usage</span>
                      <span className="text-[10px] text-slate-400 font-mono">{curMonthStr}</span>
                    </div>

                    {/* Non-Metro Progress */}
                    <div>
                      <div className="flex justify-between text-[11px] mb-1">
                        <span className="text-slate-400">Non-Metro ATMs (Limit: {nonMetroLimit})</span>
                        <span className={`font-mono font-bold ${nonMetroUsage >= nonMetroLimit ? 'text-rose-400' : 'text-slate-200'}`}>
                          {nonMetroUsage} / {nonMetroLimit} used
                        </span>
                      </div>
                      <div className="w-full h-1.5 rounded-full bg-slate-800 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${
                            nonMetroUsage >= nonMetroLimit ? 'bg-rose-500' : 'bg-cyan-400'
                          }`}
                          style={{ width: `${Math.min(100, (nonMetroUsage / nonMetroLimit) * 100)}%` }}
                        />
                      </div>
                    </div>

                    {/* Metro Progress */}
                    <div>
                      <div className="flex justify-between text-[11px] mb-1">
                        <span className="text-slate-400">Metro ATMs (Limit: {metroLimit})</span>
                        <span className={`font-mono font-bold ${metroUsage >= metroLimit ? 'text-rose-400' : 'text-slate-200'}`}>
                          {metroUsage} / {metroLimit} used
                        </span>
                      </div>
                      <div className="w-full h-1.5 rounded-full bg-slate-800 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${
                            metroUsage >= metroLimit ? 'bg-rose-500' : 'bg-emerald-400'
                          }`}
                          style={{ width: `${Math.min(100, (metroUsage / metroLimit) * 100)}%` }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Action buttons to log ATM withdrawal */}
                  <div className="flex items-center justify-between pt-2 border-t border-slate-800/70 text-xs">
                    <span className="text-[11px] text-slate-400">Log ATM Withdrawal:</span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => logDebitCardAtmWithdrawal(card.id, 'non_metro')}
                        className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] font-semibold text-cyan-300 border border-slate-700 cursor-pointer transition-colors"
                        title="Log a Non-Metro ATM withdrawal"
                      >
                        + Non-Metro
                      </button>
                      <button
                        type="button"
                        onClick={() => logDebitCardAtmWithdrawal(card.id, 'metro')}
                        className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] font-semibold text-emerald-300 border border-slate-700 cursor-pointer transition-colors"
                        title="Log a Metro ATM withdrawal"
                      >
                        + Metro
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Loans & Mortgages Section */}
      <div className="space-y-3 pt-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
            <Building2 size={15} className="text-indigo-400" />
            <span>Loans & Mortgages ({activeLoans.length})</span>
          </h3>
          <span className="text-[11px] text-slate-400">
            Long-term amortized liabilities
          </span>
        </div>

        {activeLoans.length === 0 ? (
          <div className="p-6 rounded-2xl bg-slate-900/50 border border-slate-800 text-center text-xs text-slate-400">
            No active loans right now. Click &quot;+ Loan&quot; to track principal balances and EMI schedules.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 items-start">
            {activeLoans.map((loan) => {
              const loanCurrSym = currMap[loan.currency]?.symbol || loan.currency;
              const annualCost = loan.outstanding * ((loan.ratePct || 0) / 100);
              const lockStatus = getLoanLockInStatus(loan);
              const remTenure = resolveRemainingTenureMonths(loan);
              const policyEval = calculateLoanPrepaymentCharge(loan, loan.outstanding || 0, {
                currentOutstanding: loan.outstanding || 0,
                remainingTenureOverride: remTenure,
              });
              const isScheduleOpen = expandedScheduleLoanId === loan.id;
              const fullScheduleData = isScheduleOpen
                ? getFullLoanAmortizationSchedule(loan)
                : null;
              const displayEmi =
                loan.monthlyEmi ||
                (fullScheduleData ? fullScheduleData.effectiveEmi : undefined);

              const curMonthStr = new Date().toISOString().substring(0, 7);
              const paidTxThisMonth = transactions.find(
                (t) =>
                  !t.isReversed &&
                  t.toId === loan.id &&
                  (t.kind === 'emi' || t.kind === 'transfer') &&
                  t.date.startsWith(curMonthStr)
              );
              const isPaidThisMonth = Boolean(paidTxThisMonth);

              return (
                <div
                  key={loan.id}
                  className="rounded-2xl bg-slate-900 border border-slate-800 p-4 hover:border-slate-700 transition-all shadow-sm relative"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2.5">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="text-base font-bold text-white break-words">
                          {getSafeLiabilityName(loan)}
                        </h4>
                        {isPaidThisMonth && (
                          <span className="text-[10px] font-semibold text-emerald-400 bg-emerald-950/60 border border-emerald-500/40 px-1.5 py-0.5 rounded flex items-center gap-1 shadow-xs">
                            <CheckCircle2 size={11} className="text-emerald-400 shrink-0" />
                            <span>Paid for this month</span>
                          </span>
                        )}
                        {isPaidThisMonth && policyEval.penaltyPct > 0 && (
                          <span
                            className="text-[10px] font-semibold text-amber-300 bg-amber-950/60 border border-amber-500/40 px-1.5 py-0.5 rounded flex items-center gap-1 shadow-xs"
                            title={`Prepayment charges (${policyEval.penaltyPct}%) apply if paid again this month`}
                          >
                            <AlertTriangle size={11} className="text-amber-400 shrink-0" />
                            <span>+{policyEval.penaltyPct}% Prepay fee if paid again</span>
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 mt-0.5 text-xs text-slate-400">
                        <span className="text-indigo-400 font-bold font-mono tabular-nums">
                          {loan.ratePct}% p.a.
                        </span>
                        {displayEmi !== undefined && displayEmi > 0 && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono tabular-nums">
                              EMI {formatMoney(displayEmi, loan.currency, loanCurrSym, settings.numberGrouping, 0)}
                            </span>
                          </>
                        )}
                        {loan.emiDay && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>Due {loan.emiDay}th</span>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 ml-auto shrink-0">
                      <button
                        type="button"
                        onClick={() => setSelectedLoanForPay(loan)}
                        className={`px-3 py-1.5 rounded-xl text-white text-xs font-bold flex items-center gap-1.5 shadow-sm cursor-pointer whitespace-nowrap shrink-0 transition-all ${
                          isPaidThisMonth && policyEval.penaltyPct > 0
                            ? 'bg-amber-600/90 hover:bg-amber-500 border border-amber-400/50 text-amber-50 shadow-amber-950/50'
                            : 'bg-indigo-600 hover:bg-indigo-500 shadow-indigo-600/30'
                        }`}
                        title={
                          isPaidThisMonth
                            ? `EMI already settled on ${paidTxThisMonth?.date}. Paying again will incur ${policyEval.penaltyPct}% prepayment charges.`
                            : 'Pay scheduled EMI, partial prepayment, or full payoff'
                        }
                      >
                        <Banknote size={14} />
                        <span>{isPaidThisMonth ? 'Prepay Loan' : 'Pay Loan'}</span>
                      </button>

                      <div className="relative shrink-0">
                        <button
                          type="button"
                          onClick={() => setActiveMenuId(activeMenuId === loan.id ? null : loan.id)}
                          aria-label={`More options for ${getSafeLiabilityName(loan)}`}
                          aria-haspopup="menu"
                          aria-expanded={activeMenuId === loan.id}
                          title={`More options for ${getSafeLiabilityName(loan)}`}
                          className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all cursor-pointer border ${
                            activeMenuId === loan.id
                              ? 'bg-indigo-600 text-white border-indigo-500 shadow-md ring-2 ring-indigo-500/40'
                              : 'bg-slate-800/90 hover:bg-slate-700 text-slate-200 hover:text-white border-slate-700/80 hover:border-slate-500 shadow-xs'
                          } focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1 focus:ring-offset-slate-900`}
                        >
                          <MoreVertical size={16} className="shrink-0" />
                        </button>
                        {activeMenuId === loan.id && (
                          <>
                            <div className="fixed inset-0 z-40" onClick={() => setActiveMenuId(null)} aria-hidden="true" />
                            <div
                              role="menu"
                              aria-label={`Options for ${getSafeLiabilityName(loan)}`}
                              className="absolute right-0 top-9 z-50 min-w-36 bg-slate-950 border border-slate-700 rounded-xl shadow-2xl p-1.5 flex flex-col gap-1 backdrop-blur-md animate-fade-in"
                            >
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => {
                                  setActiveMenuId(null);
                                  setEditingLiability(loan);
                                  setIsAddLoanOpen(true);
                                }}
                                className="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-slate-200 hover:bg-slate-800/80 flex items-center gap-2 cursor-pointer text-left transition-colors"
                              >
                                <Edit2 size={13} className="shrink-0 text-slate-400" />
                                <span>Edit</span>
                              </button>
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => {
                                  setActiveMenuId(null);
                                  if (expandedScheduleLoanId === loan.id) {
                                    setExpandedScheduleLoanId(null);
                                  }
                                  deleteLiability(loan.id);
                                }}
                                className="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-rose-400 hover:bg-rose-500/10 flex items-center gap-2 cursor-pointer text-left w-full transition-colors"
                              >
                                <Trash2 size={13} className="shrink-0 text-rose-400" />
                                <span>Delete</span>
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="my-3 flex flex-col gap-2">
                    <div className="flex items-baseline justify-between gap-2">
                      <div>
                        <span className="text-[11px] text-slate-400 font-medium">
                          Principal Outstanding
                        </span>
                        <div className="text-xl font-black text-white font-mono tabular-nums mt-0.5">
                          {formatMoney(loan.outstanding, loan.currency, loanCurrSym)}
                        </div>
                      </div>
                      <div className="text-right">
                        <span className="text-[11px] text-slate-400 font-medium">
                          Yearly Interest Cost
                        </span>
                        <div className="text-xs font-mono tabular-nums font-bold text-rose-400 mt-0.5">
                          -{formatMoney(annualCost, loan.currency, loanCurrSym, settings.numberGrouping, 0)}/yr
                        </div>
                      </div>
                    </div>

                    {/* Prepayment & Paid Status Alert Block */}
                    {isPaidThisMonth && (
                      <div
                        className={`p-2 rounded-xl flex items-center justify-between text-xs transition-colors ${
                          policyEval.penaltyPct > 0
                            ? 'bg-amber-950/30 border border-amber-500/40 text-amber-200'
                            : 'bg-emerald-950/25 border border-emerald-500/30 text-emerald-300'
                        }`}
                      >
                        <div className="flex items-center gap-1.5 min-w-0">
                          {policyEval.penaltyPct > 0 ? (
                            <AlertTriangle size={13} className="text-amber-400 shrink-0" />
                          ) : (
                            <CheckCircle2 size={13} className="text-emerald-400 shrink-0" />
                          )}
                          <span className="truncate">
                            {policyEval.penaltyPct > 0
                              ? `EMI settled on ${paidTxThisMonth?.date}. Paying again now incurs ${policyEval.penaltyPct}% prepayment penalty.`
                              : `EMI settled on ${paidTxThisMonth?.date}. No further payment due until next month.`}
                          </span>
                        </div>
                        {policyEval.penaltyPct > 0 && (
                          <span className="font-mono text-[11px] text-rose-300 font-bold shrink-0 ml-2">
                            ~{formatMoney(policyEval.totalPenaltyWithTax, loan.currency, loanCurrSym, settings.numberGrouping, 0)} fee
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400 pt-2.5 border-t border-slate-800/60">
                    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 font-mono tabular-nums">
                      <span className="font-sans">{remTenure} mo left</span>
                      <span aria-hidden="true">·</span>
                      {policyEval.isPolicyConfigured ? (
                        <span className={policyEval.totalPenaltyWithTax > 0 ? 'text-rose-300' : 'text-emerald-300'}>
                          {policyEval.penaltyPct > 0
                            ? `Prepay ${policyEval.penaltyPct}% (${formatMoney(policyEval.totalPenaltyWithTax, loan.currency, loanCurrSym, settings.numberGrouping, 0)})`
                            : 'Penalty-Free (0%)'}
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingLiability(loan);
                            setIsAddLoanOpen(true);
                          }}
                          className="text-amber-300 hover:text-amber-200 underline font-sans cursor-pointer"
                        >
                          Define Prepay Policy (0% now)
                        </button>
                      )}
                      {lockStatus.isLockedIn && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-amber-300 inline-flex items-center gap-0.5 font-sans">
                            <Lock size={10} /> Lock-in {lockStatus.remainingLockInMonths}m
                          </span>
                        </>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        setExpandedScheduleLoanId((prev) => (prev === loan.id ? null : loan.id))
                      }
                      aria-expanded={isScheduleOpen}
                      className="text-cyan-400 hover:text-cyan-300 font-semibold flex items-center gap-1 cursor-pointer whitespace-nowrap ml-auto transition-colors"
                    >
                      <span>
                        {isScheduleOpen ? 'Hide Schedule' : `Full Schedule (${remTenure} mo)`}
                      </span>
                      {isScheduleOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                    </button>
                  </div>

                  {isScheduleOpen && fullScheduleData && (
                    <div className="mt-3 pt-3 border-t border-slate-800 space-y-2.5 animate-fade-in">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400 font-mono tabular-nums">
                        <span>
                          Full Tenure: <strong className="text-white">{fullScheduleData.monthsCount} mo</strong>
                        </span>
                        <span>
                          Total Interest:{' '}
                          <strong className="text-rose-400">
                            {formatMoney(fullScheduleData.totalInterest, loan.currency, loanCurrSym, settings.numberGrouping, 0)}
                          </strong>
                        </span>
                        <span>
                          Total Outflow:{' '}
                          <strong className="text-slate-200">
                            {formatMoney(fullScheduleData.totalRepayment, loan.currency, loanCurrSym, settings.numberGrouping, 0)}
                          </strong>
                        </span>
                      </div>

                      <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-950/60">
                        <div className="max-h-64 overflow-y-auto">
                          <table className="w-full text-xs">
                            <thead className="bg-slate-950 text-slate-400 font-semibold sticky top-0 border-b border-slate-800">
                              <tr>
                                <th className="py-2 px-2.5 text-left">Month</th>
                                <th className="py-2 px-2.5 text-right">EMI</th>
                                <th className="py-2 px-2.5 text-right">Principal</th>
                                <th className="py-2 px-2.5 text-right">Interest</th>
                                <th className="py-2 px-2.5 text-right">Balance</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800/60 font-mono tabular-nums">
                              {fullScheduleData.schedule.map((row) => (
                                <tr key={row.monthIndex} className="hover:bg-slate-900/60">
                                  <td className="py-1.5 px-2.5 text-left text-slate-300 whitespace-nowrap">
                                    #{row.monthIndex}{' '}
                                    <span className="text-[10px] text-slate-500">{row.dateStr.slice(0, 7)}</span>
                                  </td>
                                  <td className="py-1.5 px-2.5 text-right text-slate-300 whitespace-nowrap">
                                    {formatMoney(row.emi, loan.currency, loanCurrSym, settings.numberGrouping, 0)}
                                  </td>
                                  <td className="py-1.5 px-2.5 text-right text-emerald-400 whitespace-nowrap">
                                    {formatMoney(row.principalComponent, loan.currency, loanCurrSym, settings.numberGrouping, 0)}
                                  </td>
                                  <td className="py-1.5 px-2.5 text-right text-rose-400 whitespace-nowrap">
                                    {formatMoney(row.interestComponent, loan.currency, loanCurrSym, settings.numberGrouping, 0)}
                                  </td>
                                  <td className="py-1.5 px-2.5 text-right text-slate-100 font-semibold whitespace-nowrap">
                                    {formatMoney(row.closingPrincipal, loan.currency, loanCurrSym, settings.numberGrouping, 0)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modals */}
      {isAddLoanOpen && (
        <AddEditLoanModal
          isOpen={isAddLoanOpen}
          onClose={() => {
            setIsAddLoanOpen(false);
            setEditingLiability(null);
          }}
          initialLoan={editingLiability}
        />
      )}

      {isAddCardOpen && (
        <AddEditCardModal
          isOpen={isAddCardOpen}
          onClose={() => {
            setIsAddCardOpen(false);
            setEditingLiability(null);
          }}
          initialCard={editingLiability}
        />
      )}

      {selectedCardForPay && (
        <PayCardModal
          isOpen={!!selectedCardForPay}
          onClose={() => {
            setSelectedCardForPay(null);
            setCardPayAmountOverride(undefined);
          }}
          card={selectedCardForPay}
          initialAmountOverride={cardPayAmountOverride}
          onOpenEmiComparison={() => {
            const c = selectedCardForPay;
            setSelectedCardForPay(null);
            setCardPayAmountOverride(undefined);
            setEmiCard(c);
          }}
        />
      )}

      {selectedCardForCashback && (
        <LogCashbackModal
          isOpen={!!selectedCardForCashback}
          onClose={() => setSelectedCardForCashback(null)}
          card={selectedCardForCashback}
        />
      )}

      {selectedLoanForPay && (
        <PayLoanModal
          isOpen={!!selectedLoanForPay}
          onClose={() => setSelectedLoanForPay(null)}
          loan={selectedLoanForPay}
        />
      )}

      {isBatchAddOpen && (
        <BatchAddLiabilitiesModal
          isOpen={isBatchAddOpen}
          onClose={() => setIsBatchAddOpen(false)}
        />
      )}

      {emiCard && (
        <CreditCardEmiModal
          card={emiCard}
          onClose={() => setEmiCard(null)}
          onProceedFullPayment={(amt) => {
            const target = emiCard;
            setEmiCard(null);
            setCardPayAmountOverride(amt);
            setSelectedCardForPay(target);
          }}
        />
      )}

      {isWhatIfOpen && (
        <WhatIfSimulatorModal
          onClose={() => setIsWhatIfOpen(false)}
        />
      )}
    </div>
  );
};
