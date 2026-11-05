import React, { useState, useEffect, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { Modal } from '../common/Modal';
import { Liability } from '../../types';
import {
  isBankAccountHolding,
  getSafeAssetName,
  formatAssetOptionLabel,
} from '../../lib/assetRules';
import { CreditCard, Landmark, AlertTriangle, ShieldCheck, Zap, Gift } from 'lucide-react';

interface AddEditCardModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialCard?: Liability | null;
}

export const AddEditCardModal: React.FC<AddEditCardModalProps> = ({
  isOpen,
  onClose,
  initialCard,
}) => {
  const { currencies, addLiability, updateLiability, settings, holdings, assetTypes } = useApp();

  const [cardType, setCardType] = useState<'credit' | 'debit' | 'hybrid'>(
    initialCard?.cardType || 'credit'
  );
  const [name, setName] = useState(initialCard?.name || '');
  const [accountLastDigits, setAccountLastDigits] = useState(initialCard?.accountLastDigits || '');
  const [currency, setCurrency] = useState(initialCard?.currency || settings.baseCurrency || 'INR');
  const [linkedAccountId, setLinkedAccountId] = useState(initialCard?.linkedAccountId || '');
  const [outstanding, setOutstanding] = useState(initialCard?.outstanding?.toString() || '0');
  const [limit, setLimit] = useState(initialCard?.limit?.toString() || '150000');
  const [statementDay, setStatementDay] = useState(initialCard?.statementDay?.toString() || '20');
  const [nextStatementDate, setNextStatementDate] = useState(() => {
    if (initialCard?.nextStatementDate) return initialCard.nextStatementDate;
    const now = new Date();
    const sDay = initialCard?.statementDay || 20;
    const d = new Date(now.getFullYear(), now.getMonth(), sDay);
    if (d.getTime() < now.getTime()) {
      d.setMonth(d.getMonth() + 1);
    }
    return d.toISOString().split('T')[0];
  });
  const [coolOffDays, setCoolOffDays] = useState(
    initialCard?.coolOffDays?.toString() ||
    initialCard?.interestFreeDays?.toString() ||
    (settings.defaultCardInterestFreeDays || 20).toString()
  );
  const [interestFreeDays, setInterestFreeDays] = useState(
    initialCard?.interestFreeDays?.toString() || (settings.defaultCardInterestFreeDays || 20).toString()
  );
  const [penaltyMonthlyPct, setPenaltyMonthlyPct] = useState(
    initialCard?.penaltyRateMonthlyPct?.toString() || (settings.defaultCardPenaltyRateMonthly || 3.5).toString()
  );
  const [alertLeadDays, setAlertLeadDays] = useState(
    initialCard?.alertLeadDays?.toString() || (settings.defaultAlertLeadDays || 5).toString()
  );

  // Annual fees & fee waiver rules (Per User Specification)
  const [annualFee, setAnnualFee] = useState(initialCard?.annualFee?.toString() || '0');
  const [annualFeeWaiverSpend, setAnnualFeeWaiverSpend] = useState(
    initialCard?.annualFeeWaiverSpend?.toString() || ''
  );

  // Cashback tracking & rewards
  const [cashbackRatePct, setCashbackRatePct] = useState(
    initialCard?.cashbackRatePct?.toString() || '1.0'
  );
  const [accumulatedCashback, setAccumulatedCashback] = useState(
    initialCard?.accumulatedCashback?.toString() || '0'
  );

  // Debit Card ATM limits
  const [metroAtmLimit, setMetroAtmLimit] = useState(
    initialCard?.metroAtmFreeLimit?.toString() || (settings.debitCardMetroAtmLimit || 5).toString()
  );
  const [nonMetroAtmLimit, setNonMetroAtmLimit] = useState(
    initialCard?.nonMetroAtmFreeLimit?.toString() || (settings.debitCardNonMetroAtmLimit || 3).toString()
  );
  const [atmExtraFee, setAtmExtraFee] = useState(
    initialCard?.atmExtraFeeAmount?.toString() || (settings.debitCardExtraFeePerWithdrawal || 21).toString()
  );

  const [error, setError] = useState('');

  // Debit & Hybrid cards can ONLY be linked to bank accounts (excludes cash-in-hand, FDs, RDs, Stocks, Bonds, MFs)
  const bankAccounts = useMemo(
    () => (holdings || []).filter((h) => isBankAccountHolding(h, assetTypes)),
    [holdings, assetTypes]
  );

  useEffect(() => {
    if ((cardType === 'debit' || cardType === 'hybrid') && bankAccounts.length > 0) {
      if (!linkedAccountId || !bankAccounts.some((b) => b.id === linkedAccountId)) {
        setLinkedAccountId(bankAccounts[0].id);
      }
    }
  }, [cardType, bankAccounts, linkedAccountId]);

  const selectedLinkedBank = bankAccounts.find((b) => b.id === linkedAccountId);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Incomplete Liability: Please provide a descriptive card name.');
      return;
    }

    if (cardType === 'debit' || cardType === 'hybrid') {
      if (!linkedAccountId) {
        if (bankAccounts.length === 0) {
          setError('Incomplete Liability: Please create a Bank Account in the Assets tab first so this card can be linked.');
        } else {
          setError(`Incomplete Liability: ${cardType === 'hybrid' ? 'Hybrid' : 'Debit'} cards must be linked to an active bank account.`);
        }
        return;
      }
    }

    if (cardType === 'debit') {
      const lim = parseFloat(limit);
      if (isNaN(lim) || lim <= 0) {
        setError('Incomplete Liability: Daily ATM/spend limit must be greater than 0.');
        return;
      }
    } else {
      // Credit card and Hybrid card credit limit & statement validation
      const lim = parseFloat(limit);
      if (isNaN(lim) || lim <= 0) {
        setError('Incomplete Liability: Card requires a valid credit limit greater than 0.');
        return;
      }
      const out = parseFloat(outstanding);
      if (isNaN(out) || out < 0) {
        setError('Invalid Liability Information: Current outstanding balance cannot be negative.');
        return;
      }
      const sDay = parseInt(statementDay, 10);
      if (isNaN(sDay) || sDay < 1 || sDay > 31) {
        setError('Incomplete Liability: Statement billing cycle day must be between 1 and 31.');
        return;
      }
      const cDays = parseInt(coolOffDays, 10);
      if (isNaN(cDays) || cDays < 1) {
        setError('Incomplete Liability: Cool-off period / grace days must be at least 1 day.');
        return;
      }
      const penalty = parseFloat(penaltyMonthlyPct);
      if (isNaN(penalty) || penalty <= 0) {
        setError('Incomplete Liability: Overdue penalty interest rate must be greater than 0% monthly.');
        return;
      }
    }

    const cDays = parseInt(coolOffDays, 10) || 20;

    const cardData: Liability = {
      id: initialCard?.id || `card-${Date.now()}`,
      name: name.trim(),
      kind: 'card',
      cardType,
      currency,
      accountLastDigits: accountLastDigits.trim() || undefined,
      linkedAccountId: linkedAccountId || undefined,
      outstanding: cardType === 'debit' ? 0 : parseFloat(outstanding) || 0,
      ratePct: cardType === 'debit' ? 0 : (parseFloat(penaltyMonthlyPct) || 3.5) * 12,
      limit: cardType === 'debit' ? (parseFloat(limit) || 50000) : parseFloat(limit) || 100000,
      statementDay: cardType === 'credit' || cardType === 'hybrid' ? parseInt(statementDay, 10) || 20 : undefined,
      nextStatementDate: (cardType === 'credit' || cardType === 'hybrid') && nextStatementDate ? nextStatementDate : undefined,
      coolOffDays: cardType === 'credit' || cardType === 'hybrid' ? cDays : undefined,
      interestFreeDays: cardType === 'credit' || cardType === 'hybrid' ? cDays : undefined,
      penaltyRateMonthlyPct: cardType === 'credit' || cardType === 'hybrid' ? parseFloat(penaltyMonthlyPct) || 3.5 : undefined,
      alertLeadDays: cardType === 'credit' || cardType === 'hybrid' ? parseInt(alertLeadDays, 10) || 5 : undefined,
      statements: initialCard?.statements,
      // Annual fee & fee waiver rules (Per User Specification)
      annualFee: parseFloat(annualFee) || 0,
      annualFeeWaiverSpend: annualFeeWaiverSpend ? parseFloat(annualFeeWaiverSpend) : undefined,
      // Cashback tracking & rewards
      accumulatedCashback: parseFloat(accumulatedCashback) || 0,
      cashbackRatePct: parseFloat(cashbackRatePct) || 1.0,
      // Debit & Hybrid card ATM usage
      metroAtmUsageThisMonth: initialCard?.metroAtmUsageThisMonth || 0,
      nonMetroAtmUsageThisMonth: initialCard?.nonMetroAtmUsageThisMonth || 0,
      debitUsageCount: initialCard?.debitUsageCount || 0,
      lastAtmUsageMonth: initialCard?.lastAtmUsageMonth || new Date().toISOString().substring(0, 7),
      metroAtmFreeLimit: parseInt(metroAtmLimit, 10) || 5,
      nonMetroAtmFreeLimit: parseInt(nonMetroAtmLimit, 10) || 3,
      atmExtraFeeAmount: parseFloat(atmExtraFee) || 21,
    };

    if (initialCard) {
      await updateLiability(cardData);
    } else {
      await addLiability(cardData);
    }
    onClose();
  };

  const modalFooter = (
    <div className="flex items-center justify-end gap-2 w-full">
      <button
        type="button"
        onClick={onClose}
        className="flex-1 sm:flex-none px-4 py-2.5 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 text-xs sm:text-sm font-semibold cursor-pointer transition-colors"
      >
        Cancel
      </button>
      <button
        type="submit"
        form="add-edit-card-form"
        className="flex-1 sm:flex-none px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:scale-98 text-white text-xs sm:text-sm font-bold shadow-md shadow-emerald-600/25 cursor-pointer transition-all"
      >
        {initialCard ? 'Save Changes' : cardType === 'hybrid' ? 'Add Hybrid Card' : cardType === 'debit' ? 'Add Debit Card' : 'Add Credit Card'}
      </button>
    </div>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={
        initialCard
          ? `Edit ${
              cardType === 'hybrid'
                ? 'Hybrid Card'
                : cardType === 'debit'
                ? 'Debit Card'
                : 'Credit Card'
            }`
          : 'Add New Card'
      }
      subtitle="Track credit statement cycles or debit card bank links & ATM usage limits"
      footer={modalFooter}
    >
      <form id="add-edit-card-form" onSubmit={handleSave} className="space-y-4">
        {error && (
          <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/50 text-rose-300 text-xs flex items-start gap-2.5 animate-shake shadow-sm">
            <AlertTriangle size={16} className="text-rose-400 shrink-0 mt-0.5" />
            <div className="flex-1 font-medium leading-relaxed">{error}</div>
          </div>
        )}

        {/* Card Type Selector */}
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1.5">Card Classification</label>
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => setCardType('credit')}
              className={`p-2.5 rounded-xl border flex flex-col items-center justify-center gap-1 text-xs font-bold transition-all cursor-pointer ${
                cardType === 'credit'
                  ? 'bg-rose-500/20 border-rose-500 text-rose-300 shadow-sm'
                  : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
              }`}
            >
              <CreditCard size={16} />
              <span>Credit Card</span>
            </button>
            <button
              type="button"
              onClick={() => setCardType('debit')}
              className={`p-2.5 rounded-xl border flex flex-col items-center justify-center gap-1 text-xs font-bold transition-all cursor-pointer ${
                cardType === 'debit'
                  ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300 shadow-sm'
                  : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
              }`}
            >
              <Landmark size={16} />
              <span>Debit Card</span>
            </button>
            <button
              type="button"
              onClick={() => setCardType('hybrid')}
              className={`p-2.5 rounded-xl border flex flex-col items-center justify-center gap-1 text-xs font-bold transition-all cursor-pointer ${
                cardType === 'hybrid'
                  ? 'bg-amber-500/20 border-amber-400 text-amber-300 shadow-sm ring-1 ring-amber-500/40'
                  : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
              }`}
            >
              <Zap size={16} />
              <span>Hybrid Card</span>
            </button>
          </div>
        </div>

        {/* HYBRID CARD EXPLANATION BANNER */}
        {cardType === 'hybrid' && (
          <div className="p-3.5 rounded-2xl bg-amber-950/20 border border-amber-500/40 text-amber-200 text-xs space-y-1.5 shadow-sm">
            <div className="flex items-center gap-1.5 font-bold text-amber-300">
              <Zap size={14} className="text-amber-400" />
              <span>Hybrid Debit + Credit Operating Rule</span>
            </div>
            <p className="text-[11px] leading-relaxed text-slate-300">
              When the linked bank account balance is <strong>positive (&gt; 0)</strong>, this card operates in <strong>Debit Card mode</strong> (deducting bank cash first, then linked Sweep-In FDs, and routing any remaining spend deficit to its credit limit). When the linked bank account balance is <strong>0 or non-positive (&lt;= 0)</strong>, it operates strictly in <strong>Credit Card mode</strong>.
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-slate-400 mb-1">Card Name</label>
            <input
              type="text"
              placeholder={cardType === 'debit' ? 'e.g. HDFC Millennia Debit, SBI Global' : cardType === 'hybrid' ? 'e.g. Slice Spark Hybrid, Fi Federal Hybrid' : 'e.g. ICICI Amazon Pay, HDFC Regalia'}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-emerald-500"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Currency</label>
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-emerald-500"
            >
              {currencies.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} ({c.symbol})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* CARD LAST 4 DIGITS & DEFAULT REPAYMENT BANK (For On-Device SMS Spend & Bill Payment Routing) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              Card Last 4 Digits <span className="text-slate-500 font-normal">(for SMS matching)</span>
            </label>
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              placeholder="e.g. 3230 or 6382"
              value={accountLastDigits}
              onChange={(e) => setAccountLastDigits(e.target.value.replace(/\D/g, '').slice(0, 6))}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200 font-mono tabular-nums focus:outline-none focus:border-emerald-500"
            />
            <span className="text-[10px] text-slate-500">
              Matches card spends &amp; bill payment SMS alerts automatically
            </span>
          </div>

          {cardType === 'credit' && (
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Default Bank Account <span className="text-slate-500 font-normal">(optional)</span>
              </label>
              <select
                value={linkedAccountId}
                onChange={(e) => setLinkedAccountId(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-emerald-500"
              >
                <option value="">Auto-detect or choose at payment</option>
                {bankAccounts.map((h) => {
                  const hSym = currencies.find((c) => c.code === h.currency)?.symbol || `${h.currency} `;
                  return (
                    <option key={h.id} value={h.id}>
                      {formatAssetOptionLabel(h, assetTypes, { currSymbol: hSym })}
                    </option>
                  );
                })}
              </select>
              <span className="text-[10px] text-slate-500">
                Links card to bank account for SMS card-bill payments
              </span>
            </div>
          )}
        </div>

        {/* BANK LINKING (Required for Debit AND Hybrid cards) */}
        {(cardType === 'debit' || cardType === 'hybrid') && (
          <div className="space-y-3 p-3.5 rounded-2xl bg-cyan-950/20 border border-cyan-800/40">
            <div>
              <label className="block text-xs font-bold text-cyan-200 mb-1 flex items-center gap-1.5">
                <Landmark size={14} className="text-cyan-400" />
                <span>Linked Bank Account (Strictly Required)</span>
              </label>
              {bankAccounts.length === 0 ? (
                <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs">
                  No Bank Accounts found. Add a Bank Account in the <strong>Assets tab</strong> first to link this card.
                </div>
              ) : (
                <>
                  <select
                    value={linkedAccountId}
                    onChange={(e) => setLinkedAccountId(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-slate-100 focus:border-cyan-400 focus:outline-none font-medium"
                    required
                  >
                    {bankAccounts.map((h) => {
                      const hSym = currencies.find((c) => c.code === h.currency)?.symbol || `${h.currency} `;
                      return (
                        <option key={h.id} value={h.id}>
                          {formatAssetOptionLabel(h, assetTypes, { currSymbol: hSym })}
                        </option>
                      );
                    })}
                  </select>
                  {selectedLinkedBank && (
                    <div className="mt-1.5 px-3 py-1.5 rounded-lg bg-slate-950/70 border border-slate-800 text-[11px] flex flex-wrap items-center justify-between gap-2 text-slate-300">
                      <span className="font-semibold text-white break-words">
                        {getSafeAssetName(selectedLinkedBank, assetTypes)}
                      </span>
                      <span className="font-mono tabular-nums">
                        Balance: {(selectedLinkedBank.principalOrValue || 0).toLocaleString()} {selectedLinkedBank.currency}
                        {cardType === 'hybrid' && (
                          <span className={(selectedLinkedBank.principalOrValue || 0) > 0 ? 'text-cyan-300' : 'text-amber-300'}>
                            {' '}· {(selectedLinkedBank.principalOrValue || 0) > 0 ? 'Debit Mode Active' : 'Credit Mode Active'}
                          </span>
                        )}
                      </span>
                    </div>
                  )}
                </>
              )}
              <p className="text-[10px] text-slate-400 mt-1">
                {cardType === 'hybrid'
                  ? 'Positive balance (> 0) activates Debit mode; zero or non-positive balance (<= 0) activates Credit mode.'
                  : 'All debit card spends and ATM withdrawals deduct strictly from this linked bank account.'}
              </p>
            </div>
          </div>
        )}

        {/* CREDIT / HYBRID CARD FIELDS */}
        {(cardType === 'credit' || cardType === 'hybrid') && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">
                  Current Outstanding Balance
                </label>
                <input
                  type="number"
                  step="any"
                  placeholder="e.g. 38500"
                  value={outstanding}
                  onChange={(e) => setOutstanding(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200 font-mono"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">
                  Total Credit Limit
                </label>
                <input
                  type="number"
                  step="any"
                  placeholder="e.g. 200000"
                  value={limit}
                  onChange={(e) => setLimit(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200 font-mono"
                  required
                />
              </div>
            </div>

            {/* Statement Generation Cycle & Cool-off Period */}
            <div className="p-3.5 rounded-2xl bg-gradient-to-br from-slate-950 via-slate-950 to-indigo-950/30 border border-indigo-500/30 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-indigo-300 flex items-center gap-1.5">
                  <CreditCard size={14} className="text-indigo-400" />
                  <span>Statement Generation & Payment Due Cycle</span>
                </span>
                <span className="text-[10px] text-indigo-400/80 font-medium bg-indigo-500/10 px-2 py-0.5 rounded-md border border-indigo-500/20">
                  Unbilled until statement
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Next Statement Generation Date
                  </label>
                  <input
                    type="date"
                    value={nextStatementDate}
                    onChange={(e) => {
                      setNextStatementDate(e.target.value);
                      if (e.target.value) {
                        const day = new Date(e.target.value).getDate();
                        if (!isNaN(day)) setStatementDay(day.toString());
                      }
                    }}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 font-mono focus:border-indigo-400 focus:outline-none"
                    required
                  />
                  <span className="text-[10px] text-slate-500">Date when bank generates statement</span>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Cool-Off Period (Grace Days)
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="60"
                    placeholder="e.g. 20"
                    value={coolOffDays}
                    onChange={(e) => {
                      setCoolOffDays(e.target.value);
                      setInterestFreeDays(e.target.value);
                    }}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 font-mono focus:border-indigo-400 focus:outline-none"
                    required
                  />
                  <span className="text-[10px] text-slate-500">Days allowed to pay after statement (default: 20)</span>
                </div>
              </div>

              {/* Dynamic Calculation Summary Banner */}
              {nextStatementDate && (
                <div className="p-2.5 rounded-xl bg-slate-900/90 border border-slate-800/80 text-[11px] space-y-1">
                  <div className="flex items-center justify-between text-slate-300">
                    <span>Statement Date: <strong className="text-indigo-300 font-mono">{nextStatementDate}</strong></span>
                    <span>Cool-Off: <strong className="text-white font-mono">{coolOffDays || 20} days</strong></span>
                  </div>
                  <div className="flex items-center justify-between text-slate-300 pt-1 border-t border-slate-800">
                    <span className="font-semibold text-white">Last Date to Pay (Due Date):</span>
                    <strong className="text-emerald-400 font-mono text-xs">
                      {(() => {
                        const sDate = new Date(nextStatementDate);
                        if (isNaN(sDate.getTime())) return '—';
                        const d = new Date(sDate);
                        d.setDate(d.getDate() + (parseInt(coolOffDays, 10) || 20));
                        return d.toISOString().split('T')[0];
                      })()}
                    </strong>
                  </div>
                </div>
              )}
            </div>

            {/* CASHBACK & STATEMENT REDUCTION (Per User Specification) */}
            <div className="p-3.5 rounded-2xl bg-emerald-950/20 border border-emerald-500/30 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-emerald-300 flex items-center gap-1.5">
                  <Gift size={14} className="text-emerald-400" />
                  <span>Cashback & Bill Reduction Benefits</span>
                </span>
                <span className="text-[10px] text-emerald-400 bg-emerald-950 px-2 py-0.5 rounded-full border border-emerald-500/30 font-medium">
                  Reduces next statement
                </span>
              </div>
              <p className="text-[11px] text-slate-300 leading-snug">
                Earned cashbacks can be logged anytime and will automatically reduce your statement amount when generated.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Cashback Reward Rate (%)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="100"
                    placeholder="e.g. 5"
                    value={cashbackRatePct}
                    onChange={(e) => setCashbackRatePct(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white font-mono"
                  />
                  <span className="text-[10px] text-slate-500">e.g. 5% on Amazon / 2% flat</span>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Accumulated Cashback Balance ({currency})
                  </label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    placeholder="e.g. 750"
                    value={accumulatedCashback}
                    onChange={(e) => setAccumulatedCashback(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-emerald-400 font-mono font-bold"
                  />
                  <span className="text-[10px] text-slate-500">Available to reduce next statement</span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-xl bg-slate-950/70 border border-slate-800">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">
                  Alert Lead Days
                </label>
                <input
                  type="number"
                  min="1"
                  max="15"
                  value={alertLeadDays}
                  onChange={(e) => setAlertLeadDays(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200 font-mono"
                />
                <span className="text-[10px] text-slate-500">Days before due date to alert (default: 5)</span>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">
                  Overdue Penalty Rate (% per month)
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={penaltyMonthlyPct}
                  onChange={(e) => setPenaltyMonthlyPct(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200 font-mono"
                />
                <span className="text-[10px] text-slate-500">
                  Default 3.5% (~42% APR). Applied only if unpaid after due date.
                </span>
              </div>
            </div>
          </>
        )}

        {/* ANNUAL FEES & WAIVER RULES (Per User Specification: Asked during card creation) */}
        <div className="p-3.5 rounded-2xl bg-slate-950/70 border border-slate-800 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
              <ShieldCheck size={14} className="text-amber-400" />
              <span>Card Annual Fees &amp; Waiver Spend</span>
            </span>
            <span className="text-[10px] text-slate-400 bg-slate-900 px-2 py-0.5 rounded-md border border-slate-800">
              Annual recurring fee
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Annual Fee ({currency})
              </label>
              <input
                type="number"
                step="any"
                min="0"
                placeholder="0 if Lifetime Free"
                value={annualFee}
                onChange={(e) => setAnnualFee(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white font-mono"
              />
              <span className="text-[10px] text-slate-500">Enter 0 for lifetime free cards</span>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Fee Waiver Annual Spend Threshold ({currency})
              </label>
              <input
                type="number"
                step="any"
                min="0"
                placeholder="e.g. 100000 (Optional)"
                value={annualFeeWaiverSpend}
                onChange={(e) => setAnnualFeeWaiverSpend(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white font-mono"
              />
              <span className="text-[10px] text-slate-500">Spend required in 1 yr to waive fee</span>
            </div>
          </div>
        </div>

        {/* DEBIT / HYBRID CARD ATM USAGE LIMITS */}
        {(cardType === 'debit' || cardType === 'hybrid') && (
          <div className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800 space-y-2.5">
            <div className="flex items-center gap-1.5 text-xs font-bold text-white">
              <ShieldCheck size={14} className="text-cyan-400" />
              <span>Monthly Free ATM Limits &amp; Surcharge Rules</span>
            </div>
            <p className="text-[11px] text-slate-400 leading-snug">
              RBI &amp; bank rules grant free ATM transactions each calendar month. Beyond these limits, extra fees apply.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">
                  Metro ATM Limit
                </label>
                <input
                  type="number"
                  min="0"
                  max="30"
                  value={metroAtmLimit}
                  onChange={(e) => setMetroAtmLimit(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono"
                />
                <span className="text-[10px] text-slate-500">Default: 5/mo</span>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">
                  Non-Metro Limit
                </label>
                <input
                  type="number"
                  min="0"
                  max="30"
                  value={nonMetroAtmLimit}
                  onChange={(e) => setNonMetroAtmLimit(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono"
                />
                <span className="text-[10px] text-slate-500">Default: 3/mo</span>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">
                  Extra Surcharge Fee
                </label>
                <input
                  type="number"
                  step="1"
                  value={atmExtraFee}
                  onChange={(e) => setAtmExtraFee(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono"
                />
                <span className="text-[10px] text-slate-500">₹ per extra tx</span>
              </div>
            </div>
          </div>
        )}
      </form>
    </Modal>
  );
};
