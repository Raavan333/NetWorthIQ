import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { Modal } from '../common/Modal';
import {
  Liability,
  LoanPrepaymentPolicy,
  PrepaymentPolicyMode,
  PrepaymentTenureTier,
} from '../../types';
import { AlertTriangle, ShieldCheck, Info, Plus, Trash2 } from 'lucide-react';
import { DatePickerField } from '../common/DatePickerField';
import {
  resolveUserPrepaymentPolicy,
  calculateLoanPrepaymentCharge,
} from '../../lib/loanPrepaymentEngine';
import { isBankAccountHolding, formatAssetOptionLabel } from '../../lib/assetRules';
import { formatMoney } from '../../lib/formatters';
import { cleanAccountDigitsInput } from '../../lib/smsEngine';

interface AddEditLoanModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialLoan?: Liability | null;
}

interface EditableTierRow {
  id: string;
  minMonths: string;
  maxMonths: string; // empty string = no upper limit ("and above")
  penaltyPct: string;
}

export const AddEditLoanModal: React.FC<AddEditLoanModalProps> = ({
  isOpen,
  onClose,
  initialLoan,
}) => {
  const { currencies, addLiability, updateLiability, settings, holdings, assetTypes } = useApp();

  const existingPolicy = useMemo(
    () => (initialLoan ? resolveUserPrepaymentPolicy(initialLoan) : null),
    [initialLoan]
  );

  const bankAccounts = useMemo(
    () => (holdings || []).filter((h) => isBankAccountHolding(h, assetTypes)),
    [holdings, assetTypes]
  );

  const [name, setName] = useState(initialLoan?.name || '');
  const [accountLastDigits, setAccountLastDigits] = useState(initialLoan?.accountLastDigits || '');
  const [linkedAccountId, setLinkedAccountId] = useState(initialLoan?.linkedAccountId || '');
  const [currency, setCurrency] = useState(initialLoan?.currency || settings.baseCurrency || 'INR');
  const [outstanding, setOutstanding] = useState(initialLoan?.outstanding?.toString() || '');
  const [ratePct, setRatePct] = useState(initialLoan?.ratePct?.toString() || '');
  const [monthlyEmi, setMonthlyEmi] = useState(initialLoan?.monthlyEmi?.toString() || '');
  const [tenureMonths, setTenureMonths] = useState(initialLoan?.tenureMonths?.toString() || '');
  const [startDate, setStartDate] = useState(initialLoan?.startDate || '');
  const [emiDay, setEmiDay] = useState(initialLoan?.emiDay?.toString() || '10');

  // One-Time User-Defined Prepayment Policy State (zero assumptions: defaults to 0 / penalty-free unless user specifies)
  const [policyMode, setPolicyMode] = useState<PrepaymentPolicyMode>(
    existingPolicy?.mode || 'penalty_free'
  );
  const [lockInMonths, setLockInMonths] = useState<string>(
    existingPolicy ? existingPolicy.lockInMonths.toString() : '0'
  );
  const [feeBasis, setFeeBasis] = useState<'existing_principal' | 'prepaid_amount'>(
    existingPolicy?.feeBasis || 'existing_principal'
  );
  const [flatPenaltyPct, setFlatPenaltyPct] = useState<string>(
    existingPolicy ? existingPolicy.flatPenaltyPct.toString() : '0'
  );
  const [hasSeparateForeclosureRate, setHasSeparateForeclosureRate] = useState<boolean>(
    existingPolicy?.foreclosureOverridePct !== undefined
  );
  const [foreclosureOverridePct, setForeclosureOverridePct] = useState<string>(
    existingPolicy?.foreclosureOverridePct !== undefined
      ? existingPolicy.foreclosureOverridePct.toString()
      : '0'
  );
  const [applicableTaxPct, setApplicableTaxPct] = useState<string>(
    existingPolicy ? existingPolicy.applicableTaxPct.toString() : '0'
  );
  const [tierRows, setTierRows] = useState<EditableTierRow[]>(() => {
    if (existingPolicy?.tenureTiers && existingPolicy.tenureTiers.length > 0) {
      return existingPolicy.tenureTiers.map((t) => ({
        id: t.id,
        minMonths: t.minRemainingMonths.toString(),
        maxMonths: t.maxRemainingMonths !== null && t.maxRemainingMonths !== undefined ? t.maxRemainingMonths.toString() : '',
        penaltyPct: t.penaltyPct.toString(),
      }));
    }
    return [
      { id: 'tier-1', minMonths: '1', maxMonths: '12', penaltyPct: '0' },
      { id: 'tier-2', minMonths: '13', maxMonths: '', penaltyPct: '0' },
    ];
  });

  const [error, setError] = useState('');

  const currSymbol = currencies.find((c) => c.code === currency)?.symbol || currency;

  const buildPolicyObject = (): { policy?: LoanPrepaymentPolicy; validationError?: string } => {
    const lockNum = Math.max(0, parseInt(lockInMonths, 10) || 0);
    const taxNum = Math.max(0, parseFloat(applicableTaxPct) || 0);

    if (policyMode === 'penalty_free') {
      return {
        policy: {
          mode: 'penalty_free',
          lockInMonths: lockNum,
          feeBasis: 'existing_principal',
          flatPenaltyPct: 0,
          applicableTaxPct: 0,
          isConfigured: true,
        },
      };
    }

    const forecloseNum = hasSeparateForeclosureRate
      ? Math.max(0, parseFloat(foreclosureOverridePct) || 0)
      : undefined;

    if (policyMode === 'flat_rate') {
      const flatNum = parseFloat(flatPenaltyPct);
      if (isNaN(flatNum) || flatNum < 0) {
        return { validationError: 'Prepayment charge percentage must be 0% or greater.' };
      }
      return {
        policy: {
          mode: 'flat_rate',
          lockInMonths: lockNum,
          feeBasis,
          flatPenaltyPct: flatNum,
          foreclosureOverridePct: forecloseNum,
          applicableTaxPct: taxNum,
          isConfigured: true,
        },
      };
    }

    // tenure_tiered validation
    if (tierRows.length === 0) {
      return { validationError: 'Add at least one remaining-tenure tier or choose Penalty-Free.' };
    }
    const parsedTiers: PrepaymentTenureTier[] = [];
    for (let i = 0; i < tierRows.length; i++) {
      const r = tierRows[i];
      const minM = parseInt(r.minMonths, 10);
      const maxM = r.maxMonths.trim() === '' ? null : parseInt(r.maxMonths, 10);
      const pct = parseFloat(r.penaltyPct);
      if (isNaN(minM) || minM < 0) {
        return { validationError: `Tier #${i + 1}: Minimum remaining months must be 0 or greater.` };
      }
      if (maxM !== null && (isNaN(maxM) || maxM < minM)) {
        return {
          validationError: `Tier #${i + 1}: Maximum months must be greater than or equal to minimum months (or leave blank for no upper limit).`,
        };
      }
      if (isNaN(pct) || pct < 0) {
        return { validationError: `Tier #${i + 1}: Charge percentage must be 0% or greater.` };
      }
      parsedTiers.push({
        id: r.id,
        minRemainingMonths: minM,
        maxRemainingMonths: maxM,
        penaltyPct: pct,
      });
    }

    return {
      policy: {
        mode: 'tenure_tiered',
        lockInMonths: lockNum,
        feeBasis,
        flatPenaltyPct: 0,
        tenureTiers: parsedTiers,
        foreclosureOverridePct: forecloseNum,
        applicableTaxPct: taxNum,
        isConfigured: true,
      },
    };
  };

  // Live preview of the user's configured policy on the current principal & tenure
  const livePolicyPreview = useMemo(() => {
    const outNum = Math.max(0, parseFloat(outstanding) || 0);
    const tNum = Math.max(1, parseInt(tenureMonths, 10) || 1);
    const rNum = Math.max(0, parseFloat(ratePct) || 0);
    const { policy } = buildPolicyObject();
    if (!policy) return null;

    const previewLoan: Liability = {
      id: 'preview',
      name: name || 'Loan',
      kind: 'loan',
      currency,
      outstanding: outNum,
      ratePct: rNum,
      tenureMonths: tNum,
      startDate: startDate || new Date().toISOString().split('T')[0],
      prepaymentPolicy: policy,
    };

    const fullEval = calculateLoanPrepaymentCharge(previewLoan, outNum, {
      currentOutstanding: outNum,
      remainingTenureOverride: tNum,
    });
    return { policy, fullEval, outNum, tNum };
  }, [
    outstanding,
    tenureMonths,
    ratePct,
    policyMode,
    lockInMonths,
    feeBasis,
    flatPenaltyPct,
    hasSeparateForeclosureRate,
    foreclosureOverridePct,
    applicableTaxPct,
    tierRows,
    name,
    currency,
    startDate,
  ]);

  const calculateSuggestedEmi = () => {
    const P = parseFloat(outstanding);
    const R = (parseFloat(ratePct) || 0) / 12 / 100;
    const N = parseInt(tenureMonths, 10);
    if (P >= 0 && N > 0) {
      if (R === 0) {
        setMonthlyEmi(Math.round(P / N).toString());
      } else {
        const emi = (P * R * Math.pow(1 + R, N)) / (Math.pow(1 + R, N) - 1);
        if (!isNaN(emi) && isFinite(emi)) {
          setMonthlyEmi(Math.round(emi).toString());
        }
      }
    }
  };

  const handleAddTierRow = () => {
    const last = tierRows[tierRows.length - 1];
    const nextMin = last && last.maxMonths.trim() !== '' ? (parseInt(last.maxMonths, 10) + 1).toString() : '25';
    setTierRows([
      ...tierRows,
      {
        id: `tier-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        minMonths: nextMin,
        maxMonths: '',
        penaltyPct: '0',
      },
    ]);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      setError('Incomplete Liability: Please provide a descriptive loan name.');
      return;
    }

    const outNum = parseFloat(outstanding);
    if (isNaN(outNum) || outNum < 0) {
      setError('Incomplete Liability: Outstanding principal balance cannot be negative (0 or greater).');
      return;
    }

    const rate = parseFloat(ratePct);
    if (isNaN(rate) || rate < 0) {
      setError('Incomplete Liability: Interest rate must be 0% or greater.');
      return;
    }

    if (!startDate || startDate.trim() === '') {
      setError('Incomplete Liability: Please provide the loan disbursement / start date.');
      return;
    }
    if (isNaN(new Date(startDate).getTime())) {
      setError('Invalid Date: Please enter a valid loan start date (YYYY-MM-DD).');
      return;
    }

    if (!tenureMonths || tenureMonths.trim() === '') {
      setError('Incomplete Liability: Remaining loan tenure in months is strictly required.');
      return;
    }
    const tNum = parseInt(tenureMonths, 10);
    if (isNaN(tNum) || tNum < 1) {
      setError('Invalid Tenure: Remaining loan tenure must be at least 1 month.');
      return;
    }

    const dayNum = parseInt(emiDay, 10);
    if (isNaN(dayNum) || dayNum < 1 || dayNum > 31) {
      setError('Invalid Due Day: EMI debit day must be between 1 and 31.');
      return;
    }

    if (monthlyEmi) {
      const emiNum = parseFloat(monthlyEmi);
      if (isNaN(emiNum) || emiNum < 0) {
        setError('Monthly EMI amount cannot be negative.');
        return;
      }
    }

    const { policy, validationError } = buildPolicyObject();
    if (validationError || !policy) {
      setError(validationError || 'Invalid prepayment policy configuration.');
      return;
    }

    const sDate = new Date(startDate);
    sDate.setMonth(sDate.getMonth() + tNum);
    const calculatedEndDate = sDate.toISOString().split('T')[0];

    const draftForEval: Liability = {
      id: initialLoan?.id || `loan-${Date.now()}`,
      name: name.trim(),
      kind: 'loan',
      currency,
      outstanding: outNum,
      ratePct: rate,
      tenureMonths: tNum,
      startDate,
      prepaymentPolicy: policy,
    };
    const currentEval = calculateLoanPrepaymentCharge(draftForEval, outNum, {
      currentOutstanding: outNum,
      remainingTenureOverride: tNum,
    });

    const loanData: Liability = {
      ...(initialLoan || {}),
      id: draftForEval.id,
      name: name.trim(),
      kind: 'loan',
      currency,
      accountLastDigits: cleanAccountDigitsInput(accountLastDigits) || undefined,
      linkedAccountId: linkedAccountId || undefined,
      outstanding: outNum,
      ratePct: rate,
      monthlyEmi: monthlyEmi ? parseFloat(monthlyEmi) : undefined,
      tenureMonths: tNum,
      startDate,
      endDate: calculatedEndDate,
      emiDay: dayNum,
      dueDay: dayNum,
      prepaymentPolicy: policy,
      prepaymentLockInMonths: policy.lockInMonths,
      prepaymentPenaltyPct: currentEval.penaltyPct,
      prepaymentFeeBasis: policy.feeBasis,
      foreclosurePenaltyPct: policy.foreclosureOverridePct,
      applicableGstPct: policy.applicableTaxPct,
    };

    if (initialLoan) {
      await updateLiability(loanData);
    } else {
      await addLiability(loanData);
    }
    onClose();
  };

  const modalFooter = (
    <div className="flex items-center justify-end gap-2.5 w-full">
      <button
        type="button"
        onClick={onClose}
        className="flex-1 sm:flex-none px-4 py-2.5 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 text-xs sm:text-sm font-semibold cursor-pointer transition-colors"
      >
        Cancel
      </button>
      <button
        type="submit"
        form="add-edit-loan-form"
        className="flex-1 sm:flex-none px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:scale-98 text-white text-xs sm:text-sm font-bold shadow-md shadow-emerald-600/25 cursor-pointer transition-all"
      >
        {initialLoan ? 'Save Loan & Policy' : 'Add Loan & Save Policy'}
      </button>
    </div>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={initialLoan ? 'Edit Loan & Prepayment Policy' : 'Add Loan & Prepayment Policy'}
      subtitle="Configure loan terms and prepayment policy once — future payments calculate strictly from your rules"
      maxWidth="max-w-2xl"
      footer={modalFooter}
    >
      <form id="add-edit-loan-form" onSubmit={handleSave} className="space-y-4">
        {error && (
          <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/50 text-rose-300 text-xs flex items-start gap-2.5 animate-shake shadow-sm">
            <AlertTriangle size={16} className="text-rose-400 shrink-0 mt-0.5" />
            <div className="flex-1 font-medium leading-relaxed">{error}</div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">Loan Name *</label>
            <input
              type="text"
              placeholder="e.g. Home Mortgage, Car Loan, Personal Loan"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError('');
              }}
              className={`w-full bg-slate-950 border rounded-xl px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-emerald-500 ${
                !name.trim() && error ? 'border-rose-500/70' : 'border-slate-800'
              }`}
              required
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">Currency</label>
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

        {/* LOAN / LINKED CARD LAST 4 DIGITS & DEFAULT EMI BANK (For SMS Matching & Loan-Against-Card Routing) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              Loan / Linked Card Last 4 Digits <span className="text-slate-500 font-normal">(supports multiple, e.g. 6382, 3230)</span>
            </label>
            <input
              type="text"
              maxLength={60}
              placeholder="e.g. 6382, 3230"
              value={accountLastDigits}
              onChange={(e) => setAccountLastDigits(e.target.value.replace(/[^0-9,\s]/g, ''))}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200 font-mono tabular-nums focus:outline-none focus:border-emerald-500"
            />
            <span className="text-[10px] text-slate-500">
              Routes loan or Loan-Against-Card SMS payments automatically
            </span>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              Default EMI Bank Account <span className="text-slate-500 font-normal">(optional)</span>
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
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              Outstanding Principal Balance *
            </label>
            <input
              type="number"
              step="any"
              placeholder="e.g. 500000"
              value={outstanding}
              onChange={(e) => {
                setOutstanding(e.target.value);
                setError('');
              }}
              className={`w-full bg-slate-950 border rounded-xl px-3 py-2 text-sm text-slate-200 font-mono tabular-nums focus:outline-none focus:border-emerald-500 ${
                (!outstanding || parseFloat(outstanding) <= 0) && error ? 'border-rose-500/70' : 'border-slate-800'
              }`}
              required
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-medium text-slate-300">
                Interest Rate (% p.a.) *
              </label>
              <button
                type="button"
                onClick={() => {
                  setRatePct('0');
                  setPolicyMode('penalty_free');
                  setError('');
                  if (!name) setName('Loan from Friend');
                }}
                className="text-[11px] text-cyan-400 hover:text-cyan-300 font-semibold cursor-pointer transition-colors"
                title="Loan borrowed from a friend with 0% interest"
              >
                0% Friend Loan
              </button>
            </div>
            <input
              type="number"
              step="0.01"
              min="0"
              placeholder="e.g. 0 for Friend, 8.5 for Bank"
              value={ratePct}
              onChange={(e) => {
                setRatePct(e.target.value);
                setError('');
              }}
              className={`w-full bg-slate-950 border rounded-xl px-3 py-2 text-sm text-slate-200 font-mono tabular-nums focus:outline-none focus:border-emerald-500 ${
                (ratePct === '' || parseFloat(ratePct) < 0) && error ? 'border-rose-500/70' : 'border-slate-800'
              }`}
              required
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <DatePickerField
            label="Loan Origination / Start Date"
            required
            value={startDate}
            onChange={(d) => {
              setStartDate(d);
              setError('');
            }}
            placeholder="YYYY-MM-DD or DD/MM/YYYY"
            helperText="Date this loan was disbursed"
          />

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              Remaining Tenure (Months) *
            </label>
            <input
              type="number"
              min="1"
              placeholder="e.g. 36"
              value={tenureMonths}
              onChange={(e) => {
                setTenureMonths(e.target.value);
                setError('');
              }}
              className={`w-full bg-slate-950 border rounded-xl px-3 py-2 text-sm text-slate-200 font-mono tabular-nums focus:outline-none focus:border-emerald-500 ${
                (!tenureMonths || parseInt(tenureMonths, 10) < 1) && error ? 'border-rose-500/70' : 'border-slate-800'
              }`}
              required
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-medium text-slate-300">
                Monthly EMI Amount
              </label>
              {outstanding && ratePct !== '' && tenureMonths && (
                <button
                  type="button"
                  onClick={calculateSuggestedEmi}
                  className="text-[10px] text-emerald-400 hover:text-emerald-300 font-semibold cursor-pointer"
                >
                  Auto-Calc EMI
                </button>
              )}
            </div>
            <input
              type="number"
              step="any"
              placeholder="e.g. 15780"
              value={monthlyEmi}
              onChange={(e) => {
                setMonthlyEmi(e.target.value);
                setError('');
              }}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200 font-mono tabular-nums focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              EMI Due Day of Month *
            </label>
            <input
              type="number"
              min="1"
              max="31"
              placeholder="e.g. 10"
              value={emiDay}
              onChange={(e) => {
                setEmiDay(e.target.value);
                setError('');
              }}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200 font-mono tabular-nums focus:outline-none focus:border-emerald-500"
              required
            />
          </div>
        </div>

        {/* One-Time Contractual Prepayment Policy Configuration */}
        <div className="p-4 rounded-xl bg-slate-950/90 border border-slate-800 space-y-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-xs font-bold text-slate-100 flex items-center gap-1.5">
                <ShieldCheck size={15} className="text-emerald-400" />
                <span>Prepayment &amp; Foreclosure Policy (Configured Once)</span>
              </h3>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Define your lender&apos;s exact rule once. Future payments calculate strictly from this policy with zero assumptions.
              </p>
            </div>
          </div>

          {/* 1. Policy Mode Selector */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {(
              [
                {
                  id: 'penalty_free',
                  title: 'Penalty-Free (0%)',
                  desc: 'No prepayment or foreclosure fee',
                },
                {
                  id: 'flat_rate',
                  title: 'Fixed Rate (%)',
                  desc: 'Single contractual % charge',
                },
                {
                  id: 'tenure_tiered',
                  title: 'Tenure-Based Tiers',
                  desc: 'Rate varies by remaining months',
                },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => {
                  setPolicyMode(opt.id);
                  setError('');
                }}
                className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                  policyMode === opt.id
                    ? 'bg-emerald-950/40 border-emerald-500 text-white'
                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700'
                }`}
              >
                <div className="text-xs font-bold whitespace-nowrap">{opt.title}</div>
                <div className="text-[10px] text-slate-400 mt-0.5">{opt.desc}</div>
              </button>
            ))}
          </div>

          {/* 2. Lock-In Months (Applies to any policy mode) + Basis & Tax when applicable */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-slate-300 mb-1">
                Lock-In Period (Months)
              </label>
              <input
                type="number"
                min="0"
                step="1"
                placeholder="0 (No lock-in)"
                value={lockInMonths}
                onChange={(e) => setLockInMonths(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 font-mono tabular-nums focus:outline-none focus:border-emerald-500"
              />
              <span className="text-[10px] text-slate-500 block mt-0.5">
                0 = immediate prepay allowed
              </span>
            </div>

            {policyMode !== 'penalty_free' && (
              <>
                <div>
                  <label className="block text-[11px] font-medium text-slate-300 mb-1">
                    Charge Calculated On
                  </label>
                  <select
                    value={feeBasis}
                    onChange={(e) =>
                      setFeeBasis(e.target.value as 'existing_principal' | 'prepaid_amount')
                    }
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl px-2.5 py-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
                  >
                    <option value="existing_principal">% of Existing Principal</option>
                    <option value="prepaid_amount">% of Prepaid Amount</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-slate-300 mb-1">
                    Tax / GST on Fee (%)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    placeholder="0 (e.g. 18 if applicable)"
                    value={applicableTaxPct}
                    onChange={(e) => setApplicableTaxPct(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 font-mono tabular-nums focus:outline-none focus:border-emerald-500"
                  />
                  <span className="text-[10px] text-slate-500 block mt-0.5">
                    0% unless lender taxes fees
                  </span>
                </div>
              </>
            )}
          </div>

          {/* 3A. Flat Rate Input */}
          {policyMode === 'flat_rate' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <div>
                <label className="block text-[11px] font-medium text-slate-300 mb-1">
                  Prepayment Charge (%) *
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="e.g. 2.5"
                  value={flatPenaltyPct}
                  onChange={(e) => setFlatPenaltyPct(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white font-mono tabular-nums focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="space-y-1.5">
                <label className="flex items-center gap-2 text-[11px] font-medium text-slate-300 cursor-pointer mt-0.5">
                  <input
                    type="checkbox"
                    checked={hasSeparateForeclosureRate}
                    onChange={(e) => setHasSeparateForeclosureRate(e.target.checked)}
                    className="rounded bg-slate-900 border-slate-700 text-emerald-500 focus:ring-0 cursor-pointer"
                  />
                  <span>Different rate for 100% Full Payoff?</span>
                </label>
                {hasSeparateForeclosureRate && (
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="Full foreclosure % (e.g. 4.0)"
                    value={foreclosureOverridePct}
                    onChange={(e) => setForeclosureOverridePct(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-white font-mono tabular-nums focus:outline-none focus:border-emerald-500"
                  />
                )}
              </div>
            </div>
          )}

          {/* 3B. User-Defined Tenure Tiers */}
          {policyMode === 'tenure_tiered' && (
            <div className="space-y-2 pt-1">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-slate-300">
                  Remaining Tenure Tiers (Months Left → Charge %)
                </span>
                <button
                  type="button"
                  onClick={handleAddTierRow}
                  className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] font-semibold text-emerald-400 flex items-center gap-1 cursor-pointer transition-colors"
                >
                  <Plus size={12} />
                  <span>Add Tier</span>
                </button>
              </div>

              <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-900/60">
                <table className="w-full text-xs">
                  <thead className="bg-slate-900 text-slate-400 border-b border-slate-800 text-[11px]">
                    <tr>
                      <th className="py-1.5 px-2.5 text-left">Min Months</th>
                      <th className="py-1.5 px-2.5 text-left">Max Months (Blank = Above)</th>
                      <th className="py-1.5 px-2.5 text-left">Charge (%)</th>
                      <th className="py-1.5 px-2 w-9 text-center"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-mono tabular-nums">
                    {tierRows.map((row) => (
                      <tr key={row.id}>
                        <td className="p-1.5">
                          <input
                            type="number"
                            min="0"
                            step="1"
                            value={row.minMonths}
                            onChange={(e) =>
                              setTierRows((prev) =>
                                prev.map((r) =>
                                  r.id === row.id ? { ...r, minMonths: e.target.value } : r
                                )
                              )
                            }
                            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-emerald-500"
                          />
                        </td>
                        <td className="p-1.5">
                          <input
                            type="number"
                            min="1"
                            step="1"
                            placeholder="No upper limit"
                            value={row.maxMonths}
                            onChange={(e) =>
                              setTierRows((prev) =>
                                prev.map((r) =>
                                  r.id === row.id ? { ...r, maxMonths: e.target.value } : r
                                )
                              )
                            }
                            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-xs text-white placeholder:font-sans placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
                          />
                        </td>
                        <td className="p-1.5">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={row.penaltyPct}
                            onChange={(e) =>
                              setTierRows((prev) =>
                                prev.map((r) =>
                                  r.id === row.id ? { ...r, penaltyPct: e.target.value } : r
                                )
                              )
                            }
                            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-emerald-500"
                          />
                        </td>
                        <td className="p-1.5 text-center">
                          <button
                            type="button"
                            disabled={tierRows.length <= 1}
                            onClick={() =>
                              setTierRows((prev) => prev.filter((r) => r.id !== row.id))
                            }
                            className="p-1 rounded text-slate-400 hover:text-rose-400 disabled:opacity-30 cursor-pointer"
                            title="Remove tier"
                          >
                            <Trash2 size={13} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Live Policy Preview Summary */}
          {livePolicyPreview && (
            <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 flex flex-wrap items-center justify-between gap-2 text-[11px]">
              <span className="text-slate-300">
                Active Rule Preview ({livePolicyPreview.tNum} mo left):{' '}
                <strong className="text-white">{livePolicyPreview.fullEval.ruleLabel}</strong>
                {livePolicyPreview.policy.lockInMonths > 0
                  ? ` · ${livePolicyPreview.policy.lockInMonths}m lock-in`
                  : ''}
              </span>
              <span className="font-mono tabular-nums font-bold text-emerald-400">
                Current Full-Payoff Fee:{' '}
                {formatMoney(
                  livePolicyPreview.fullEval.totalPenaltyWithTax,
                  currency,
                  currSymbol,
                  settings.numberGrouping,
                  0
                )}
              </span>
            </div>
          )}
        </div>

        <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 text-[11px] text-slate-400 flex items-start gap-2">
          <Info size={15} className="text-cyan-400 shrink-0 mt-0.5" />
          <span>
            Once saved, the payment window and Debt Strategy Optimizer calculate charges strictly from this policy and your live balance/tenure without asking again.
          </span>
        </div>
      </form>
    </Modal>
  );
};
