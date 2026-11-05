import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Modal } from '../common/Modal';
import { Liability, LoanPrepaymentPolicy } from '../../types';
import { Plus, Trash2, Check, AlertCircle } from 'lucide-react';

interface BatchLiabilityRow {
  id: string;
  name: string;
  kind: 'card' | 'loan';
  cardType?: 'credit' | 'debit' | 'hybrid';
  currency: string;
  outstanding: string;
  ratePct: string;
  limitOrTenure: string;
  dueDay: string;
  lockInMonths: string;
  prepayPenaltyPct: string;
  prepayBasis: 'existing_principal' | 'prepaid_amount';
}

interface BatchAddLiabilitiesModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const BatchAddLiabilitiesModal: React.FC<BatchAddLiabilitiesModalProps> = ({
  isOpen,
  onClose,
}) => {
  const { currencies, addLiabilitiesBulk, settings } = useApp();
  const defaultBase = settings.baseCurrency || 'INR';

  const createEmptyRow = (): BatchLiabilityRow => ({
    id: `row-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    name: '',
    kind: 'card',
    cardType: 'credit',
    currency: defaultBase,
    outstanding: '',
    ratePct: '36.0',
    limitOrTenure: '100000',
    dueDay: '15',
    lockInMonths: '0',
    prepayPenaltyPct: '0',
    prepayBasis: 'existing_principal',
  });

  const [rows, setRows] = useState<BatchLiabilityRow[]>([
    createEmptyRow(),
    createEmptyRow(),
    createEmptyRow(),
  ]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [generalError, setGeneralError] = useState('');

  const handleAddRow = () => {
    setRows([...rows, createEmptyRow()]);
  };

  const handleRemoveRow = (id: string) => {
    if (rows.length <= 1) return;
    setRows(rows.filter((r) => r.id !== id));
    const newErrors = { ...errors };
    delete newErrors[id];
    setErrors(newErrors);
  };

  const handleRowChange = (id: string, field: keyof BatchLiabilityRow, val: any) => {
    setRows(
      rows.map((r) => {
        if (r.id !== id) return r;
        const updated = { ...r, [field]: val };
        if (field === 'kind') {
          if (val === 'loan') {
            updated.ratePct = '8.75';
            updated.limitOrTenure = '36';
            updated.cardType = undefined;
          } else {
            updated.ratePct = '36.0';
            updated.limitOrTenure = '100000';
            updated.cardType = 'credit';
          }
        }
        return updated;
      })
    );
  };

  const handleSaveAll = async (e: React.FormEvent) => {
    e.preventDefault();
    setGeneralError('');
    const newErrors: Record<string, string> = {};
    const validLiabilities: Liability[] = [];

    const filledRows = rows.filter((r) => r.name.trim() || r.outstanding.trim());
    if (filledRows.length === 0) {
      setGeneralError('Please fill in at least one card or loan entry.');
      return;
    }

    for (const r of filledRows) {
      if (!r.name.trim()) {
        newErrors[r.id] = 'Name is required';
        continue;
      }
      const outNum = parseFloat(r.outstanding);
      if (isNaN(outNum) || outNum < 0) {
        newErrors[r.id] = 'Valid outstanding amount required';
        continue;
      }

      const rate = parseFloat(r.ratePct) || 0;
      const numLimitOrTenure = parseFloat(r.limitOrTenure);
      const day = parseInt(r.dueDay, 10);

      if (r.kind === 'loan') {
        if (rate < 0) {
          newErrors[r.id] = 'Rate cannot be negative';
          continue;
        }
        if (isNaN(numLimitOrTenure) || numLimitOrTenure < 1) {
          newErrors[r.id] = 'Loan requires tenure >= 1 month';
          continue;
        }
        if (isNaN(day) || day < 1 || day > 31) {
          newErrors[r.id] = 'EMI due day must be 1-31';
          continue;
        }

        const todayStr = new Date().toISOString().split('T')[0];
        const roundedTenure = Math.round(numLimitOrTenure);
        const sDate = new Date();
        sDate.setMonth(sDate.getMonth() + roundedTenure);
        const endDateStr = sDate.toISOString().split('T')[0];

        const lockNum = Math.max(0, parseInt(r.lockInMonths, 10) || 0);
        const penPctNum = Math.max(0, parseFloat(r.prepayPenaltyPct) || 0);

        const policy: LoanPrepaymentPolicy = {
          mode: penPctNum > 0 ? 'flat_rate' : 'penalty_free',
          lockInMonths: lockNum,
          feeBasis: r.prepayBasis || 'existing_principal',
          flatPenaltyPct: penPctNum,
          applicableTaxPct: 0,
          isConfigured: true,
        };

        validLiabilities.push({
          id: `loan-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          name: r.name.trim(),
          kind: 'loan',
          currency: r.currency,
          outstanding: outNum,
          ratePct: rate,
          tenureMonths: roundedTenure,
          startDate: todayStr,
          endDate: endDateStr,
          dueDay: day,
          emiDay: day,
          prepaymentPolicy: policy,
          prepaymentLockInMonths: lockNum,
          prepaymentPenaltyPct: penPctNum,
          prepaymentFeeBasis: policy.feeBasis,
          applicableGstPct: 0,
        });
      } else {
        if (isNaN(numLimitOrTenure) || numLimitOrTenure <= 0) {
          newErrors[r.id] = 'Card requires credit limit > 0';
          continue;
        }
        if (isNaN(day) || day < 1 || day > 31) {
          newErrors[r.id] = 'Due day must be 1-31';
          continue;
        }

        validLiabilities.push({
          id: `card-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          name: r.name.trim(),
          kind: 'card',
          cardType: r.cardType || 'credit',
          currency: r.currency,
          outstanding: outNum,
          ratePct: rate,
          limit: numLimitOrTenure,
          dueDay: day,
          interestFreeDays: 45,
          statementDay: day > 15 ? day - 15 : 1,
        });
      }
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      setGeneralError('Please correct the highlighted errors in the grid.');
      return;
    }

    await addLiabilitiesBulk(validLiabilities, 'append');
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Batch Add Liabilities & Cards (Compact Grid)"
      subtitle="Enter multiple cards or loans with one-time prepayment policy terms (zero assumptions)"
      maxWidth="max-w-5xl"
    >
      <form onSubmit={handleSaveAll} className="space-y-4">
        {generalError && (
          <div className="p-3 rounded-xl bg-rose-500/20 text-rose-300 text-xs flex items-center gap-2">
            <AlertCircle size={15} />
            <span>{generalError}</span>
          </div>
        )}

        <div className="flex items-center justify-between text-xs text-slate-400 pb-1">
          <span>Fill one or more rows. Blank rows are ignored.</span>
          <button
            type="button"
            onClick={handleAddRow}
            className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-rose-400 font-bold flex items-center gap-1 cursor-pointer transition-colors"
          >
            <Plus size={14} /> Add Row
          </button>
        </div>

        <div className="border border-slate-800 rounded-2xl overflow-x-auto bg-slate-950/60 shadow-inner">
          <table className="w-full text-left text-xs min-w-[860px]">
            <thead className="bg-slate-900/90 text-slate-400 font-semibold border-b border-slate-800">
              <tr>
                <th className="p-2.5 pl-3 w-8">#</th>
                <th className="p-2.5 min-w-[130px]">Name</th>
                <th className="p-2.5 w-20">Kind</th>
                <th className="p-2.5 w-24">Sub-Type / Basis</th>
                <th className="p-2.5 w-20">Curr</th>
                <th className="p-2.5 min-w-[100px]">Outstanding</th>
                <th className="p-2.5 w-20">Rate %</th>
                <th className="p-2.5 min-w-[95px]">Limit / Tenure</th>
                <th className="p-2.5 w-16">Due Day</th>
                <th className="p-2.5 w-20">Lock-In Mo</th>
                <th className="p-2.5 w-20">Prepay %</th>
                <th className="p-2.5 w-10 text-center"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {rows.map((row, idx) => {
                const rowErr = errors[row.id];
                const isCard = row.kind === 'card';

                return (
                  <tr
                    key={row.id}
                    className={`hover:bg-slate-900/40 transition-colors ${
                      rowErr ? 'bg-rose-950/20' : ''
                    }`}
                  >
                    <td className="p-2.5 pl-3 text-slate-500 font-mono text-[11px]">{idx + 1}</td>
                    <td className="p-2">
                      <input
                        type="text"
                        placeholder={isCard ? 'e.g. HDFC Regalia' : 'e.g. Car Loan'}
                        value={row.name}
                        onChange={(e) => handleRowChange(row.id, 'name', e.target.value)}
                        className={`w-full bg-slate-900 border rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none ${
                          rowErr ? 'border-rose-500' : 'border-slate-800 focus:border-rose-500'
                        }`}
                      />
                    </td>
                    <td className="p-2">
                      <select
                        value={row.kind}
                        onChange={(e) => handleRowChange(row.id, 'kind', e.target.value as any)}
                        className="w-full bg-slate-900 border border-slate-800 rounded-lg px-1.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-rose-500"
                      >
                        <option value="card">Card</option>
                        <option value="loan">Loan</option>
                      </select>
                    </td>
                    <td className="p-2">
                      {isCard ? (
                        <select
                          value={row.cardType || 'credit'}
                          onChange={(e) => handleRowChange(row.id, 'cardType', e.target.value as any)}
                          className="w-full bg-slate-900 border border-slate-800 rounded-lg px-1.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-rose-500"
                        >
                          <option value="credit">Credit</option>
                          <option value="debit">Debit</option>
                          <option value="hybrid">Hybrid</option>
                        </select>
                      ) : (
                        <select
                          value={row.prepayBasis}
                          onChange={(e) =>
                            handleRowChange(row.id, 'prepayBasis', e.target.value as any)
                          }
                          title="Prepayment charge basis"
                          className="w-full bg-slate-900 border border-slate-800 rounded-lg px-1.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-rose-500"
                        >
                          <option value="existing_principal">On Principal</option>
                          <option value="prepaid_amount">On Prepaid</option>
                        </select>
                      )}
                    </td>
                    <td className="p-2">
                      <select
                        value={row.currency}
                        onChange={(e) => handleRowChange(row.id, 'currency', e.target.value)}
                        className="w-full bg-slate-900 border border-slate-800 rounded-lg px-1 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-rose-500"
                      >
                        {currencies.map((c) => (
                          <option key={c.code} value={c.code}>
                            {c.code}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="p-2">
                      <input
                        type="number"
                        step="any"
                        placeholder="25000"
                        value={row.outstanding}
                        onChange={(e) => handleRowChange(row.id, 'outstanding', e.target.value)}
                        className={`w-full bg-slate-900 border rounded-lg px-2 py-1.5 text-xs text-white font-mono tabular-nums focus:outline-none ${
                          rowErr ? 'border-rose-500' : 'border-slate-800 focus:border-rose-500'
                        }`}
                      />
                    </td>
                    <td className="p-2">
                      <input
                        type="number"
                        step="0.01"
                        placeholder={isCard ? '36.0' : '8.75'}
                        value={row.ratePct}
                        onChange={(e) => handleRowChange(row.id, 'ratePct', e.target.value)}
                        className="w-full bg-slate-900 border border-slate-800 rounded-lg px-1.5 py-1.5 text-xs text-slate-200 font-mono tabular-nums focus:outline-none focus:border-rose-500"
                      />
                    </td>
                    <td className="p-2">
                      <input
                        type="number"
                        step="any"
                        placeholder={isCard ? '100000' : '36 mo'}
                        value={row.limitOrTenure}
                        onChange={(e) => handleRowChange(row.id, 'limitOrTenure', e.target.value)}
                        className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-slate-200 font-mono tabular-nums focus:outline-none focus:border-rose-500"
                      />
                    </td>
                    <td className="p-2">
                      <input
                        type="number"
                        min="1"
                        max="31"
                        placeholder="15"
                        value={row.dueDay}
                        onChange={(e) => handleRowChange(row.id, 'dueDay', e.target.value)}
                        className="w-full bg-slate-900 border border-slate-800 rounded-lg px-1.5 py-1.5 text-xs text-slate-200 font-mono tabular-nums focus:outline-none focus:border-rose-500"
                      />
                    </td>
                    <td className="p-2">
                      {isCard ? (
                        <span className="text-[11px] text-slate-600 pl-2">—</span>
                      ) : (
                        <input
                          type="number"
                          min="0"
                          step="1"
                          placeholder="0"
                          value={row.lockInMonths}
                          onChange={(e) => handleRowChange(row.id, 'lockInMonths', e.target.value)}
                          className="w-full bg-slate-900 border border-slate-800 rounded-lg px-1.5 py-1.5 text-xs text-slate-200 font-mono tabular-nums focus:outline-none focus:border-rose-500"
                        />
                      )}
                    </td>
                    <td className="p-2">
                      {isCard ? (
                        <span className="text-[11px] text-slate-600 pl-2">—</span>
                      ) : (
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="0"
                          value={row.prepayPenaltyPct}
                          onChange={(e) =>
                            handleRowChange(row.id, 'prepayPenaltyPct', e.target.value)
                          }
                          className="w-full bg-slate-900 border border-slate-800 rounded-lg px-1.5 py-1.5 text-xs text-slate-200 font-mono tabular-nums focus:outline-none focus:border-rose-500"
                        />
                      )}
                    </td>
                    <td className="p-2 text-center">
                      <button
                        type="button"
                        onClick={() => handleRemoveRow(row.id)}
                        disabled={rows.length <= 1}
                        className="p-1 rounded text-slate-500 hover:text-rose-400 disabled:opacity-20 cursor-pointer"
                        title="Delete row"
                      >
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-slate-800">
          <button
            type="button"
            onClick={handleAddRow}
            className="px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-xs font-semibold text-slate-300 flex items-center gap-1.5 cursor-pointer border border-slate-800"
          >
            <Plus size={14} /> Add Another Row
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 text-xs font-semibold cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold shadow-md shadow-rose-600/20 flex items-center gap-1.5 cursor-pointer"
            >
              <Check size={14} />
              <span>Save All to Liabilities</span>
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
};
