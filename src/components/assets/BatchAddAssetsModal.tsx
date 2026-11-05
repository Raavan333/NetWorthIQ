import React, { useState, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import { Modal } from '../common/Modal';
import { Holding, LiquidityClass } from '../../types';
import { Plus, Trash2, Check, AlertCircle, Calendar } from 'lucide-react';

const BatchDateCell: React.FC<{
  value?: string;
  disabled?: boolean;
  isInvalid?: boolean;
  onChange: (val: string) => void;
}> = ({ value, disabled, isInvalid, onChange }) => {
  const nativeRef = useRef<HTMLInputElement>(null);

  const handleTextChange = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) {
      onChange('');
      return;
    }
    const parts = trimmed.split(/[/.\-\s]+/);
    if (parts.length === 3) {
      const p1 = parseInt(parts[0], 10);
      const p2 = parseInt(parts[1], 10);
      const p3 = parseInt(parts[2], 10);
      if (p1 >= 1970 && p1 <= 2100 && p2 >= 1 && p2 <= 12 && p3 >= 1 && p3 <= 31) {
        onChange(`${p1}-${String(p2).padStart(2, '0')}-${String(p3).padStart(2, '0')}`);
        return;
      }
      if (p3 >= 1970 && p3 <= 2100 && p2 >= 1 && p2 <= 12 && p1 >= 1 && p1 <= 31) {
        onChange(`${p3}-${String(p2).padStart(2, '0')}-${String(p1).padStart(2, '0')}`);
        return;
      }
    }
    onChange(raw);
  };

  return (
    <div className="relative flex items-center min-w-[120px]">
      <input
        type="text"
        value={value || ''}
        disabled={disabled}
        placeholder="YYYY-MM-DD"
        onChange={(e) => handleTextChange(e.target.value)}
        className={`w-full bg-slate-900 border rounded-lg pl-1.5 pr-6 py-1 text-[11px] text-slate-200 font-mono disabled:opacity-30 ${
          isInvalid ? 'border-amber-500/70' : 'border-slate-800'
        }`}
      />
      <input
        ref={nativeRef}
        type="date"
        value={value || ''}
        disabled={disabled}
        tabIndex={-1}
        className="sr-only"
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          if (nativeRef.current && typeof (nativeRef.current as any).showPicker === 'function') {
            try {
              (nativeRef.current as any).showPicker();
            } catch {}
          }
        }}
        className="absolute right-1.5 text-slate-400 hover:text-emerald-400 disabled:opacity-20 cursor-pointer"
        title="Open calendar picker"
      >
        <Calendar size={12} />
      </button>
    </div>
  );
};

interface BatchAssetRow {
  id: string;
  name: string;
  typeId: string;
  currency: string;
  amount: string;
  ratePct: string;
  liquidity: LiquidityClass;
  startDate?: string;
  maturityDate?: string;
}

interface BatchAddAssetsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const BatchAddAssetsModal: React.FC<BatchAddAssetsModalProps> = ({ isOpen, onClose }) => {
  const { assetTypes, currencies, addHoldingsBulk, settings } = useApp();
  const defaultBase = settings.baseCurrency || 'INR';

  const createEmptyRow = (): BatchAssetRow => {
    const defaultTypeId = assetTypes[0]?.id || 'type-bank';
    const isBank = defaultTypeId === 'type-bank' || defaultTypeId.includes('bank');
    return {
      id: `row-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      name: '',
      typeId: defaultTypeId,
      currency: defaultBase,
      amount: isBank ? '0' : '',
      ratePct: '2.5',
      liquidity: 'Immediate',
      startDate: '',
      maturityDate: '',
    };
  };

  const [rows, setRows] = useState<BatchAssetRow[]>([
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

  const handleRowChange = (id: string, field: keyof BatchAssetRow, val: any) => {
    setRows(
      rows.map((r) => {
        if (r.id !== id) return r;
        const updated = { ...r, [field]: val };
        // If type changed to bank, adjust default rate & liquidity and set default 0 amount if empty
        if (field === 'typeId') {
          const selectedType = assetTypes.find((t) => t.id === val);
          if (selectedType) {
            updated.liquidity = selectedType.defaultLiquidity;
            if (val === 'type-bank' || val.includes('bank')) {
              updated.ratePct = '2.5';
              if (!updated.amount || updated.amount.trim() === '') updated.amount = '0';
            } else if (val === 'type-cash-hand' || val === 'type-cash') {
              updated.ratePct = '0';
            } else if (val === 'type-fd') {
              updated.ratePct = '7.1';
              updated.liquidity = 'Locked';
            }
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
    const validHoldings: Holding[] = [];

    // Filter out rows that are completely empty (at least name provided)
    const filledRows = rows.filter((r) => r.name.trim());
    if (filledRows.length === 0) {
      setGeneralError('Please fill in at least one asset entry.');
      return;
    }

    for (const r of filledRows) {
      if (!r.name.trim()) {
        newErrors[r.id] = 'Name is required';
        continue;
      }
      const isBank = r.typeId === 'type-bank' || r.typeId.includes('bank');
      const isCash = r.typeId === 'type-cash-hand' || r.typeId === 'type-cash';
      const isFd = r.typeId === 'type-fd' || r.typeId.includes('fd') || r.typeId.includes('bond');

      const rawAmt = (r.amount.trim() === '' && isBank) ? '0' : r.amount;
      const amt = parseFloat(rawAmt);
      if (isNaN(amt) || amt < 0 || (amt <= 0 && !isBank)) {
        newErrors[r.id] = isBank ? 'Valid balance (>= 0) required' : 'Valid balance (> 0) required';
        continue;
      }
      const rate = parseFloat(r.ratePct);

      if (isFd) {
        if (isNaN(rate) || rate <= 0) {
          newErrors[r.id] = 'Fixed Deposits require valid rate > 0%';
          continue;
        }
        if (!r.startDate || r.startDate.trim() === '') {
          newErrors[r.id] = 'FD requires valid Start Date';
          continue;
        }
        if (!r.maturityDate || r.maturityDate.trim() === '') {
          newErrors[r.id] = 'FD requires valid Maturity Date';
          continue;
        }
        if (new Date(r.maturityDate).getTime() <= new Date(r.startDate).getTime()) {
          newErrors[r.id] = 'Maturity date must be after Start Date';
          continue;
        }
      }

      validHoldings.push({
        id: `hold-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        name: r.name.trim(),
        typeId: r.typeId,
        currency: r.currency,
        principalOrValue: amt,
        fixedRatePct: isCash ? 0 : !isNaN(rate) ? rate : isBank ? 2.5 : isFd ? 7.1 : undefined,
        startDate: r.startDate || undefined,
        maturityDate: r.maturityDate || undefined,
        liquidityClass: r.liquidity,
        isAssumed: false,
      });
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      setGeneralError('Please correct the highlighted errors. Incomplete assets with missing dates cannot be created.');
      return;
    }

    await addHoldingsBulk(validHoldings, 'append');
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Batch Add Assets (Compact Grid)"
      subtitle="Enter multiple bank accounts, cash, investments, or assets at once"
      maxWidth="max-w-5xl"
      footer={
        <div className="flex items-center justify-between w-full">
          <button
            type="button"
            onClick={handleAddRow}
            className="px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-xs font-semibold text-slate-300 flex items-center gap-1.5 cursor-pointer border border-slate-800"
          >
            <Plus size={14} /> Add Row
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
              form="batch-add-assets-form"
              className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-md shadow-emerald-600/20 flex items-center gap-1.5 cursor-pointer"
            >
              <Check size={14} />
              <span>Save All</span>
            </button>
          </div>
        </div>
      }
    >
      <form id="batch-add-assets-form" onSubmit={handleSaveAll} className="space-y-4">
        {generalError && (
          <div className="p-3 rounded-xl bg-rose-500/20 border border-rose-500/40 text-rose-300 text-xs flex items-center gap-2 animate-shake">
            <AlertCircle size={15} className="shrink-0" />
            <span>{generalError}</span>
          </div>
        )}

        <div className="flex items-center justify-between text-xs text-slate-400 pb-1">
          <span>Fill one or more rows. Blank rows are ignored.</span>
          <button
            type="button"
            onClick={handleAddRow}
            className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-emerald-400 font-bold flex items-center gap-1 cursor-pointer transition-colors"
          >
            <Plus size={14} /> Add Row
          </button>
        </div>

        {/* Compact Table / Grid */}
        <div className="border border-slate-800 rounded-2xl overflow-x-auto bg-slate-950/60 shadow-inner">
          <table className="w-full text-left text-xs min-w-[760px]">
            <thead className="bg-slate-900/90 text-slate-400 font-semibold border-b border-slate-800">
              <tr>
                <th className="p-2.5 pl-3 w-8">#</th>
                <th className="p-2.5 min-w-[130px]">Asset Name</th>
                <th className="p-2.5 min-w-[130px]">Type</th>
                <th className="p-2.5 w-20">Currency</th>
                <th className="p-2.5 min-w-[95px]">Balance / Value</th>
                <th className="p-2.5 w-24">Return % p.a.</th>
                <th className="p-2.5 min-w-[100px]">Liquidity</th>
                <th className="p-2.5 min-w-[110px]">Start Date</th>
                <th className="p-2.5 min-w-[110px]">Maturity Date</th>
                <th className="p-2.5 w-10 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {rows.map((row, idx) => {
                const rowErr = errors[row.id];
                const isBank = row.typeId === 'type-bank';
                const isCash = row.typeId === 'type-cash-hand' || row.typeId === 'type-cash';
                const isFd = row.typeId === 'type-fd' || row.typeId.includes('fd') || row.typeId.includes('bond');

                return (
                  <tr
                    key={row.id}
                    className={`hover:bg-slate-900/40 transition-colors ${
                      rowErr ? 'bg-rose-950/25' : ''
                    }`}
                  >
                    <td className="p-2.5 pl-3 text-slate-500 font-mono text-[11px]">{idx + 1}</td>
                    <td className="p-2">
                      <input
                        type="text"
                        placeholder="e.g. HDFC Fixed Deposit"
                        value={row.name}
                        onChange={(e) => handleRowChange(row.id, 'name', e.target.value)}
                        className={`w-full bg-slate-900 border rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none ${
                          rowErr ? 'border-rose-500' : 'border-slate-800 focus:border-emerald-500'
                        }`}
                      />
                      {rowErr && <span className="text-[10px] text-rose-400 block mt-0.5">{rowErr}</span>}
                    </td>
                    <td className="p-2">
                      <select
                        value={row.typeId}
                        onChange={(e) => handleRowChange(row.id, 'typeId', e.target.value)}
                        className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
                      >
                        {assetTypes.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="p-2">
                      <select
                        value={row.currency}
                        onChange={(e) => handleRowChange(row.id, 'currency', e.target.value)}
                        className="w-full bg-slate-900 border border-slate-800 rounded-lg px-1.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
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
                        placeholder="50000"
                        value={row.amount}
                        onChange={(e) => handleRowChange(row.id, 'amount', e.target.value)}
                        className={`w-full bg-slate-900 border rounded-lg px-2.5 py-1.5 text-xs text-white font-mono focus:outline-none ${
                          rowErr ? 'border-rose-500' : 'border-slate-800 focus:border-emerald-500'
                        }`}
                      />
                    </td>
                    <td className="p-2">
                      <input
                        type="number"
                        step="0.01"
                        disabled={isCash}
                        placeholder={isCash ? '0' : isBank ? '2.5' : '7.0'}
                        value={isCash ? '0' : row.ratePct}
                        onChange={(e) => handleRowChange(row.id, 'ratePct', e.target.value)}
                        className="w-full bg-slate-900 disabled:opacity-40 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-emerald-500"
                      />
                    </td>
                    <td className="p-2">
                      <select
                        value={row.liquidity}
                        onChange={(e) => handleRowChange(row.id, 'liquidity', e.target.value as LiquidityClass)}
                        className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
                      >
                        <option value="Immediate">Immediate</option>
                        <option value="Short">Short-Term</option>
                        <option value="Locked">Locked</option>
                      </select>
                    </td>
                    <td className="p-2">
                      <BatchDateCell
                        value={row.startDate}
                        disabled={isBank || isCash}
                        isInvalid={isFd && !row.startDate}
                        onChange={(val) => handleRowChange(row.id, 'startDate', val)}
                      />
                    </td>
                    <td className="p-2">
                      <BatchDateCell
                        value={row.maturityDate}
                        disabled={isBank || isCash}
                        isInvalid={isFd && !row.maturityDate}
                        onChange={(val) => handleRowChange(row.id, 'maturityDate', val)}
                      />
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
      </form>
    </Modal>
  );
};
