import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Holding } from '../../types';
import { convertToBase, getHoldingLocalValue } from '../../lib/calcEngine';
import { formatMoney, formatCompactMoney } from '../../lib/formatters';
import { AddEditAssetModal } from './AddEditAssetModal';
import { BatchAddAssetsModal } from './BatchAddAssetsModal';
import { SellHoldingModal } from './SellHoldingModal';
import { SweepInRedeemModal } from './SweepInRedeemModal';
import { ProcessDepositPayoutModal } from './ProcessDepositPayoutModal';
import { ReceivablesManager } from './ReceivablesManager';
import { ReconciliationAuditModal } from '../common/ReconciliationAuditModal';
import { PayLoanModal } from '../liabilities/PayLoanModal';
import { Modal } from '../common/Modal';
import { downloadFile } from '../../lib/downloadHelper';
import {
  Plus,
  TableProperties,
  Search,
  TrendingUp,
  MoreVertical,
  Edit2,
  Trash2,
  Coins,
  Banknote,
  ChevronDown,
  Layers,
  Zap,
  Building2,
  ShieldCheck,
  GraduationCap,
  Download,
  Upload,
  Check,
  X,
  RotateCcw,
  ArrowRight,
} from 'lucide-react';

export const AssetsView: React.FC = () => {
  const {
    holdings,
    liabilities,
    assetTypes,
    currencies,
    settings,
    deleteHolding,
    updateHolding,
    updateHoldingValuesBulk,
    setActiveModal,
    careerPrediction,
    engineResult,
  } = useApp();

  const [search, setSearch] = useState('');
  const [selectedHoldingForEdit, setSelectedHoldingForEdit] = useState<Holding | null>(null);
  const [holdingToDelete, setHoldingToDelete] = useState<Holding | null>(null);
  const [isAddEditOpen, setIsAddEditOpen] = useState(false);
  const [isBatchAddOpen, setIsBatchAddOpen] = useState(false);
  const [selectedHoldingForSale, setSelectedHoldingForSale] = useState<Holding | null>(null);
  const [selectedSweepInHolding, setSelectedSweepInHolding] = useState<Holding | null>(null);
  const [selectedDepositForPayout, setSelectedDepositForPayout] = useState<Holding | null>(null);
  const [payDebtHolding, setPayDebtHolding] = useState<Holding | null>(null);
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [isAuditModalOpen, setIsAuditModalOpen] = useState(false);
  const [auditHoldingId, setAuditHoldingId] = useState<string | undefined>(undefined);

  // Single-window Values Spreadsheet & Dropdown state
  const [isActionsMenuOpen, setIsActionsMenuOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards');
  const [editedValues, setEditedValues] = useState<Record<string, { currentPrice?: number; principalOrValue?: number }>>({});
  const [isSavingBulk, setIsSavingBulk] = useState(false);
  const [saveBulkStatus, setSaveBulkStatus] = useState<string | null>(null);
  const [quickEditHoldingId, setQuickEditHoldingId] = useState<string | null>(null);
  const [quickEditVal, setQuickEditVal] = useState<string>('');
  const [isQuickSaving, setIsQuickSaving] = useState(false);

  const baseCurr = settings.baseCurrency || 'INR';
  const currMap: Record<string, typeof currencies[0]> = {};
  for (const c of currencies) currMap[c.code] = c;
  const baseCurrSymbol = currMap[baseCurr]?.symbol || '₹';

  const typeMap: Record<string, typeof assetTypes[0]> = {};
  for (const t of assetTypes) typeMap[t.id] = t;

  // Helper to identify Fixed / Term Deposit assets
  const isFdAsset = (h: Holding) => {
    const tName = (typeMap[h.typeId]?.name || '').toLowerCase();
    return (
      h.typeId === 'type-fd' ||
      h.typeId.includes('fd') ||
      tName.includes('fixed deposit') ||
      tName.includes('term deposit') ||
      tName.includes('deposit') ||
      Boolean(h.isSweepIn) ||
      (h.fixedRatePct !== undefined && Boolean(h.maturityDate))
    );
  };

  // Helper to identify Bank Account assets
  const isBankAccount = (h: Holding) => {
    const tName = (typeMap[h.typeId]?.name || '').toLowerCase();
    return (
      h.typeId === 'type-bank' ||
      h.typeId.includes('bank') ||
      tName.includes('bank') ||
      tName.includes('checking') ||
      tName.includes('savings')
    );
  };

  // Active holdings: physical bank/cash accounts may remain at 0; non-physical 0-value assets are automatically written off
  const activeHoldings = holdings.filter((h) => isBankAccount(h) || ((h.principalOrValue || 0) > 0 && !h.isMatured));

  // Filtered active holdings matching search criteria
  const filtered = activeHoldings.filter(
    (h) =>
      h.name.toLowerCase().includes(search.toLowerCase()) ||
      (typeMap[h.typeId]?.name || '').toLowerCase().includes(search.toLowerCase())
  );

  // Group by Asset Type (active only)
  const groupedByType: Record<string, Holding[]> = {};
  for (const h of filtered) {
    const tName = typeMap[h.typeId]?.name || 'Other';
    if (!groupedByType[tName]) groupedByType[tName] = [];
    groupedByType[tName].push(h);
  }

  // Handle price/value changes in the single window values spreadsheet
  const handlePriceChange = (id: string, val: string, isMarket: boolean) => {
    const num = parseFloat(val);
    setEditedValues((prev) => ({
      ...prev,
      [id]: isMarket
        ? { ...prev[id], currentPrice: isNaN(num) ? undefined : num }
        : { ...prev[id], principalOrValue: isNaN(num) ? undefined : num },
    }));
  };

  const handleSaveBulk = async () => {
    setIsSavingBulk(true);
    try {
      const updates = Object.entries(editedValues).map(([id, vals]) => ({
        id,
        ...vals,
      }));
      if (updates.length > 0) {
        await updateHoldingValuesBulk(updates);
        setSaveBulkStatus(`Successfully updated ${updates.length} asset values!`);
        setTimeout(() => setSaveBulkStatus(null), 3000);
      }
      setEditedValues({});
    } finally {
      setIsSavingBulk(false);
    }
  };

  const handleDiscardBulk = () => {
    setEditedValues({});
  };

  // Export current table as CSV directly from single window
  const handleExportCSV = async () => {
    const headers = ['type,name,currency,units,price_or_value,rate_pct,start_date,maturity_date,liquidity'];
    const rows = holdings.map((h) => {
      const isMarket = h.units !== undefined && h.units > 0;
      const priceOrVal = isMarket
        ? editedValues[h.id]?.currentPrice ?? h.currentPrice ?? 0
        : editedValues[h.id]?.principalOrValue ?? h.principalOrValue ?? 0;
      return [
        h.typeId,
        `"${h.name}"`,
        h.currency,
        h.units || '',
        priceOrVal,
        h.fixedRatePct || '',
        h.startDate || '',
        h.maturityDate || '',
        h.liquidityClass,
      ].join(',');
    });

    const csvContent = [headers, ...rows].join('\n');
    const filename = `networthiq_assets_${new Date().toISOString().split('T')[0]}.csv`;
    await downloadFile(filename, csvContent, 'text/csv');
    setSaveBulkStatus('Assets CSV exported successfully!');
    setTimeout(() => setSaveBulkStatus(null), 3000);
  };

  // Import CSV directly on single window
  const handleImportCSV = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const text = event.target?.result as string;
        const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
        if (lines.length < 2) {
          setSaveBulkStatus('CSV has no data rows');
          return;
        }

        const updates: { id: string; currentPrice?: number; principalOrValue?: number }[] = [];
        let matchedCount = 0;

        for (let i = 1; i < lines.length; i++) {
          const cols = lines[i].split(',').map((c) => c.replace(/^"|"$/g, '').trim());
          if (cols.length >= 5) {
            const name = cols[1];
            const priceOrVal = parseFloat(cols[4]);

            const target = holdings.find((h) => h.name.toLowerCase() === name.toLowerCase());
            if (target && !isNaN(priceOrVal)) {
              matchedCount++;
              if (target.units !== undefined && target.units > 0) {
                updates.push({ id: target.id, currentPrice: priceOrVal });
              } else {
                updates.push({ id: target.id, principalOrValue: priceOrVal });
              }
            }
          }
        }

        if (updates.length > 0) {
          await updateHoldingValuesBulk(updates);
          setSaveBulkStatus(`Successfully updated ${matchedCount} holdings from CSV!`);
          setTimeout(() => setSaveBulkStatus(null), 3000);
        } else {
          setSaveBulkStatus('No matching holdings found by name in CSV.');
          setTimeout(() => setSaveBulkStatus(null), 3000);
        }
      } catch {
        setSaveBulkStatus('Failed to parse CSV file.');
        setTimeout(() => setSaveBulkStatus(null), 3000);
      }
    };
    reader.readAsText(file);
  };

  const handleStartQuickEdit = (h: Holding) => {
    setQuickEditHoldingId(h.id);
    const isMarket = h.units !== undefined && h.units > 0;
    const currentVal = isMarket ? h.currentPrice || 0 : h.principalOrValue || 0;
    setQuickEditVal(currentVal.toString());
  };

  const handleSaveQuickEdit = async (h: Holding) => {
    const num = parseFloat(quickEditVal);
    if (isNaN(num) || num < 0) return;
    setIsQuickSaving(true);
    try {
      const isMarket = h.units !== undefined && h.units > 0;
      await updateHolding({
        ...h,
        ...(isMarket ? { currentPrice: num } : { principalOrValue: num }),
      });
      setQuickEditHoldingId(null);
    } finally {
      setIsQuickSaving(false);
    }
  };

  const pendingEditsCount = Object.keys(editedValues).length;

  return (
    <div className="space-y-4 pb-20 animate-fade-in">
      {/* Top Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">Assets Portfolio</h2>
          <p className="text-xs text-slate-400 font-mono tabular-nums">
            {activeHoldings.length} active holdings · {Object.keys(groupedByType).length} categories
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Manage Portfolio Dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setIsActionsMenuOpen(!isActionsMenuOpen)}
              className="px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 hover:bg-slate-800 text-xs font-semibold text-slate-200 flex items-center justify-center gap-1.5 cursor-pointer shadow-sm active:scale-[0.98] transition-all"
              aria-haspopup="true"
              aria-expanded={isActionsMenuOpen}
            >
              <TableProperties size={14} className="text-cyan-400" />
              <span>Manage</span>
              <ChevronDown
                size={14}
                className={`text-slate-400 transition-transform duration-200 ${
                  isActionsMenuOpen ? 'rotate-180' : ''
                }`}
              />
            </button>

            {isActionsMenuOpen && (
              <>
                <div
                  className="fixed inset-0 z-30"
                  onClick={() => setIsActionsMenuOpen(false)}
                />
                <div className="absolute right-0 top-11 z-40 min-w-56 bg-slate-950 border border-slate-700/80 rounded-xl shadow-2xl p-1.5 flex flex-col gap-1 backdrop-blur-md animate-fade-in text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      setIsActionsMenuOpen(false);
                      setViewMode((m) => (m === 'table' ? 'cards' : 'table'));
                    }}
                    className="px-2.5 py-2 rounded-lg text-xs font-medium text-slate-200 hover:bg-slate-800/80 flex items-center gap-2 cursor-pointer text-left transition-colors"
                  >
                    <TableProperties size={14} className="text-cyan-400 shrink-0" />
                    <span>{viewMode === 'table' ? 'Switch to Category Cards' : 'Update Values (Single Window)'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setIsActionsMenuOpen(false);
                      setIsBatchAddOpen(true);
                    }}
                    className="px-2.5 py-2 rounded-lg text-xs font-medium text-slate-200 hover:bg-slate-800/80 flex items-center gap-2 cursor-pointer text-left transition-colors"
                  >
                    <Layers size={14} className="text-emerald-400 shrink-0" />
                    <span>Batch Add Assets</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setIsActionsMenuOpen(false);
                      setAuditHoldingId(undefined);
                      setIsAuditModalOpen(true);
                    }}
                    className="px-2.5 py-2 rounded-lg text-xs font-medium text-slate-200 hover:bg-slate-800/80 flex items-center gap-2 cursor-pointer text-left transition-colors"
                  >
                    <ShieldCheck size={14} className="text-indigo-400 shrink-0" />
                    <span>Audit Ledger Balance</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setIsActionsMenuOpen(false);
                      const el = document.getElementById('human-capital-section');
                      if (el) el.scrollIntoView({ behavior: 'smooth' });
                    }}
                    className="px-2.5 py-2 rounded-lg text-xs font-medium text-slate-200 hover:bg-slate-800/80 flex items-center gap-2 cursor-pointer text-left transition-colors"
                  >
                    <GraduationCap size={14} className="text-purple-400 shrink-0" />
                    <span>Skill Asset / Human Capital</span>
                  </button>
                </div>
              </>
            )}
          </div>

          <button
            type="button"
            onClick={() => {
              setSelectedHoldingForEdit(null);
              setIsAddEditOpen(true);
            }}
            className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center justify-center gap-1 shadow-md shadow-emerald-600/25 cursor-pointer shrink-0 whitespace-nowrap active:scale-[0.98] transition-all"
          >
            <Plus size={15} />
            <span>Add Asset</span>
          </button>
        </div>
      </div>

      {/* Receivables & Personal Loans Given (Dedicated Asset Ledger) */}
      <ReceivablesManager />

      {/* Search & Single Window View Switcher Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search
            size={16}
            className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500"
          />
          <input
            type="text"
            placeholder="Search by asset name or type..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-10 pr-4 py-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 transition-colors"
          />
        </div>

        {/* View Switcher: Single Window Category Cards vs Single Window Values Editor */}
        <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 rounded-xl p-1 text-xs shrink-0">
          <button
            type="button"
            onClick={() => setViewMode('cards')}
            className={`px-3 py-1.5 rounded-lg font-medium transition-all cursor-pointer ${
              viewMode === 'cards'
                ? 'bg-slate-800 text-white shadow-xs'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Categories
          </button>
          <button
            type="button"
            onClick={() => setViewMode('table')}
            className={`px-3 py-1.5 rounded-lg font-medium transition-all cursor-pointer flex items-center gap-1.5 ${
              viewMode === 'table'
                ? 'bg-cyan-950/70 text-cyan-300 border border-cyan-700/50 shadow-xs'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <TableProperties size={13} className="text-cyan-400" />
            <span>Values Editor</span>
            {pendingEditsCount > 0 && (
              <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
            )}
          </button>
        </div>
      </div>

      {/* SINGLE WINDOW VALUES EDITOR TABLE */}
      {viewMode === 'table' && (
        <div className="rounded-2xl bg-slate-900 border border-slate-800 shadow-sm p-4 space-y-3 animate-fade-in">
          <div className="flex flex-wrap items-center justify-between gap-2.5 pb-2 border-b border-slate-800/80">
            <div>
              <div className="text-xs font-bold text-white flex items-center gap-1.5">
                <TableProperties size={14} className="text-cyan-400" />
                <span>Single-Window Asset Values Spreadsheet</span>
              </div>
              <p className="text-[11px] text-slate-400">
                Directly edit prices, stock quotes, and bank balances in place without leaving this page.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleExportCSV}
                className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium flex items-center gap-1 cursor-pointer transition-colors"
                title="Export holding values table to CSV"
              >
                <Download size={13} />
                <span>Export CSV</span>
              </button>

              <label className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium flex items-center gap-1 cursor-pointer transition-colors">
                <Upload size={13} />
                <span>Import CSV</span>
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={handleImportCSV}
                  className="hidden"
                />
              </label>

              {pendingEditsCount > 0 && (
                <>
                  <button
                    type="button"
                    onClick={handleDiscardBulk}
                    className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-rose-950/40 text-slate-400 hover:text-rose-300 text-xs font-medium cursor-pointer transition-colors"
                  >
                    Discard
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveBulk}
                    disabled={isSavingBulk}
                    className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1 cursor-pointer shadow-sm shadow-emerald-600/30 transition-colors"
                  >
                    <Check size={13} />
                    <span>Save {pendingEditsCount} Changes</span>
                  </button>
                </>
              )}
            </div>
          </div>

          {saveBulkStatus && (
            <div className="p-2 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2">
              <Check size={13} />
              <span>{saveBulkStatus}</span>
            </div>
          )}

          <div className="border border-slate-800/80 rounded-xl overflow-hidden overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950 text-slate-400 font-semibold border-b border-slate-800/80">
                <tr>
                  <th className="p-3">Asset</th>
                  <th className="p-3">Category</th>
                  <th className="p-3">Units</th>
                  <th className="p-3 min-w-[150px]">Current Price / Balance</th>
                  <th className="p-3">Currency</th>
                  <th className="p-3 text-right">Computed Base</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {filtered.map((h) => {
                  const isMarket = h.units !== undefined && h.units > 0;
                  const itemCurrSym = currMap[h.currency]?.symbol || h.currency;
                  const currentVal = isMarket
                    ? editedValues[h.id]?.currentPrice ?? h.currentPrice ?? 0
                    : editedValues[h.id]?.principalOrValue ?? h.principalOrValue ?? 0;
                  const isChanged = editedValues[h.id] !== undefined;

                  const liveLocal = isMarket ? (h.units || 0) * currentVal : currentVal;
                  const liveBase = convertToBase(liveLocal, h.currency, currMap);

                  return (
                    <tr
                      key={h.id}
                      className={`hover:bg-slate-800/30 transition-colors ${
                        isChanged ? 'bg-cyan-950/20' : ''
                      }`}
                    >
                      <td className="p-3 font-semibold text-slate-100 font-sans">
                        <div className="flex items-center gap-1.5">
                          <span>{h.name}</span>
                          {isChanged && (
                            <span className="text-[9px] px-1 py-0.2 rounded bg-cyan-500/20 text-cyan-300 font-sans">
                              edited
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="p-3 text-slate-400 font-sans">
                        {typeMap[h.typeId]?.name || 'Other'}
                      </td>
                      <td className="p-3 text-slate-300">
                        {isMarket ? h.units : '—'}
                      </td>
                      <td className="p-3">
                        <div className="relative flex items-center max-w-[170px]">
                          <span className="absolute left-2.5 text-xs text-slate-400 pointer-events-none">
                            {itemCurrSym}
                          </span>
                          <input
                            type="number"
                            step="any"
                            value={currentVal}
                            onChange={(e) => handlePriceChange(h.id, e.target.value, isMarket)}
                            className={`w-full bg-slate-950 border rounded-lg pl-7 pr-2 py-1 text-xs text-white focus:outline-none transition-colors ${
                              isChanged
                                ? 'border-cyan-500 ring-1 ring-cyan-500/30'
                                : 'border-slate-700/80 focus:border-cyan-500'
                            }`}
                          />
                        </div>
                      </td>
                      <td className="p-3 text-slate-400 uppercase">
                        {h.currency}
                      </td>
                      <td className="p-3 text-right text-slate-200 font-semibold tabular-nums">
                        {formatMoney(liveBase, baseCurr, baseCurrSymbol, settings.numberGrouping, 0)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Holdings Grouped List */}
      {Object.entries(groupedByType).length === 0 ? (
        <div className="p-8 rounded-2xl bg-slate-900/50 border border-slate-800 text-center">
          <p className="text-sm text-slate-400">No assets found matching your criteria.</p>
          <button
            type="button"
            onClick={() => {
              setSelectedHoldingForEdit(null);
              setIsAddEditOpen(true);
            }}
            className="mt-3 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold cursor-pointer inline-flex items-center gap-1.5 shadow-md shadow-emerald-600/20"
          >
            <Plus size={14} /> Add First Asset
          </button>
        </div>
      ) : (
        Object.entries(groupedByType).map(([typeName, items]) => {
          const typeTotalBase = items.reduce((sum, h) => {
            const loc = getHoldingLocalValue(h);
            return sum + convertToBase(loc, h.currency, currMap);
          }, 0);

          return (
            <div key={typeName} className="rounded-2xl bg-slate-900 border border-slate-800 shadow-sm relative">
              {/* Type Category Header */}
              <div className="flex items-center justify-between px-4 py-3 bg-slate-950/60 border-b border-slate-800/80 rounded-t-2xl">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-200">
                    {typeName}
                  </span>
                  <span className="px-1.5 py-0.2 rounded-md bg-slate-800 text-slate-400 text-[10px] font-semibold">
                    {items.length}
                  </span>
                </div>
                <div className="text-xs font-mono font-bold text-white">
                  {formatMoney(typeTotalBase, baseCurr, baseCurrSymbol, settings.numberGrouping, 0)}
                </div>
              </div>

              {/* Items List */}
              <div className="divide-y divide-slate-800/50">
                {items.map((h) => {
                  const localVal = getHoldingLocalValue(h);
                  const baseVal = convertToBase(localVal, h.currency, currMap);
                  const isCrossCurrency = h.currency !== baseCurr;
                  const itemCurrSym = currMap[h.currency]?.symbol || h.currency;
                  const isMarket = h.units !== undefined && h.units > 0;
                  const typeObj = typeMap[h.typeId];
                  const isFixed = typeObj ? typeObj.returnMode === 'fixed' : true;

                  return (
                    <div
                      key={h.id}
                      className="p-3.5 sm:p-4 hover:bg-slate-800/30 transition-colors flex flex-wrap sm:flex-nowrap items-start sm:items-center justify-between gap-2.5 sm:gap-3 relative overflow-hidden"
                    >
                      <div className="flex-1 min-w-0 overflow-hidden">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="text-sm font-semibold text-white break-words truncate max-w-full">{h.name}</h4>
                          {h.isSweepIn && (
                            <span className="text-[10px] font-bold text-emerald-400 bg-emerald-950/60 border border-emerald-800/40 px-1.5 py-0.5 rounded shrink-0">
                              Sweep-in
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5 sm:gap-2 mt-1 text-xs text-slate-400 flex-wrap break-words max-w-full overflow-hidden">
                          {isMarket ? (
                            <span className="break-all xs:break-normal">
                              {h.units} units × {formatMoney(h.currentPrice || 0, h.currency, itemCurrSym)}
                            </span>
                          ) : (
                            <span className="break-all xs:break-normal">Balance: {formatMoney(h.principalOrValue, h.currency, itemCurrSym)}</span>
                          )}

                          <span className="text-slate-600 shrink-0">·</span>
                          <span className="text-slate-400 shrink-0">{h.liquidityClass}</span>

                          {isFixed && h.fixedRatePct !== undefined ? (
                            <>
                              <span className="text-slate-600 shrink-0">·</span>
                              <span className="font-mono text-[11px] text-emerald-400 shrink-0">
                                {h.fixedRatePct}% p.a.
                              </span>
                            </>
                          ) : !isFixed && h.expectedRatePct !== undefined && h.expectedRatePct !== null ? (
                            <>
                              <span className="text-slate-600 shrink-0">·</span>
                              <span className="text-slate-400 font-mono text-[11px] shrink-0">
                                ~{h.expectedRatePct}% p.a.
                              </span>
                            </>
                          ) : null}

                          {h.marketCapCategory && (
                            <>
                              <span className="text-slate-600 shrink-0">·</span>
                              <span className="text-slate-400 capitalize shrink-0">
                                {h.marketCapCategory.replace('_', ' ')}
                              </span>
                            </>
                          )}
                        </div>

                        {h.withdrawnFromSourceId && (
                          <div className="flex flex-wrap items-center gap-2 mt-1 text-[11px] text-slate-400">
                            <span>Source: <strong className="text-slate-300 font-medium">{h.withdrawnFromSourceId}</strong></span>
                            {h.cashAdvanceFee && h.cashAdvanceFee > 0 ? (
                              <span className="text-amber-400 font-mono">
                                (Fee: {formatMoney(h.cashAdvanceFee, h.currency, itemCurrSym)})
                              </span>
                            ) : null}
                          </div>
                        )}
                      </div>

                      {/* Values & Actions — wraps cleanly on small screens so Edit, Delete, and MoreVertical are always visible */}
                      <div className="w-full sm:w-auto flex flex-wrap items-center justify-between sm:justify-end gap-2.5 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-800/50 shrink-0">
                        {quickEditHoldingId === h.id ? (
                          <div className="flex items-center gap-1.5 bg-slate-950 border border-cyan-500 rounded-lg p-1 animate-fade-in shadow-sm">
                            <span className="text-xs text-slate-400 pl-1 font-mono">{itemCurrSym}</span>
                            <input
                              type="number"
                              step="any"
                              value={quickEditVal}
                              onChange={(e) => setQuickEditVal(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSaveQuickEdit(h);
                                else if (e.key === 'Escape') setQuickEditHoldingId(null);
                              }}
                              autoFocus
                              className="w-24 bg-transparent text-xs font-mono font-bold text-white focus:outline-none"
                            />
                            <button
                              type="button"
                              onClick={() => handleSaveQuickEdit(h)}
                              disabled={isQuickSaving}
                              className="p-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer"
                              title="Save Value"
                            >
                              <Check size={12} />
                            </button>
                            <button
                              type="button"
                              onClick={() => setQuickEditHoldingId(null)}
                              className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer"
                              title="Cancel"
                            >
                              <X size={12} />
                            </button>
                          </div>
                        ) : (
                          <div className="text-left sm:text-right min-w-0">
                            <div
                              className={`text-sm font-bold font-mono tabular-nums ${
                                baseVal < 0 ? 'text-rose-400' : 'text-white'
                              }`}
                            >
                              {formatMoney(baseVal, baseCurr, baseCurrSymbol, settings.numberGrouping, 0)}
                            </div>
                            {isCrossCurrency && (
                              <div className="text-[11px] text-slate-400 font-mono tabular-nums">
                                {formatMoney(localVal, h.currency, itemCurrSym, settings.numberGrouping, 2)}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Direct Edit, Delete, and More quick action buttons */}
                        <div className="flex items-center gap-1.5 shrink-0 ml-auto sm:ml-0">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedHoldingForEdit(h);
                              setIsAddEditOpen(true);
                            }}
                            className="w-8 h-8 rounded-lg flex items-center justify-center bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700/80 hover:border-slate-500 transition-all cursor-pointer shadow-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 shrink-0"
                            title="Edit Asset"
                            aria-label={`Edit ${h.name}`}
                          >
                            <Edit2 size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => setHoldingToDelete(h)}
                            className="w-8 h-8 rounded-lg flex items-center justify-center bg-slate-800/80 hover:bg-rose-950/40 text-slate-300 hover:text-rose-400 border border-slate-700/80 hover:border-rose-500/50 transition-all cursor-pointer shadow-xs focus:outline-none focus:ring-2 focus:ring-rose-500 shrink-0"
                            title="Delete Asset"
                            aria-label={`Delete ${h.name}`}
                          >
                            <Trash2 size={14} />
                          </button>

                          {/* More Menu */}
                          <div className="relative shrink-0">
                            <button
                              type="button"
                              onClick={() => setActiveMenuId(activeMenuId === h.id ? null : h.id)}
                              aria-label={`More options for ${h.name}`}
                              aria-haspopup="menu"
                              aria-expanded={activeMenuId === h.id}
                              title={`More options for ${h.name}`}
                              className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all cursor-pointer border shrink-0 ${
                                activeMenuId === h.id
                                  ? 'bg-indigo-600 text-white border-indigo-500 shadow-md ring-2 ring-indigo-500/40'
                                  : 'bg-slate-800/90 hover:bg-slate-700 text-slate-200 hover:text-white border-slate-700/80 hover:border-slate-500 shadow-xs'
                              } focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1 focus:ring-offset-slate-900`}
                            >
                              <MoreVertical size={16} className="shrink-0" />
                            </button>

                            {activeMenuId === h.id && (
                              <>
                                <div
                                  className="fixed inset-0 z-40"
                                  onClick={() => setActiveMenuId(null)}
                                  aria-hidden="true"
                                />
                                <div
                                  role="menu"
                                  aria-label={`Options for ${h.name}`}
                                  className="absolute right-0 top-9 z-50 min-w-48 bg-slate-950 border border-slate-700 rounded-xl shadow-2xl p-1.5 flex flex-col gap-1 backdrop-blur-md animate-fade-in"
                                >
                                  {/* Quick Update Value directly on single window */}
                                  <button
                                    type="button"
                                    role="menuitem"
                                    onClick={() => {
                                      setActiveMenuId(null);
                                      handleStartQuickEdit(h);
                                    }}
                                    className="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-cyan-300 hover:bg-slate-800/80 flex items-center gap-2 cursor-pointer text-left transition-colors"
                                  >
                                    <TableProperties size={14} className="shrink-0 text-cyan-400" />
                                    <span>Quick Update Value</span>
                                  </button>

                                  {/* For Bank Accounts and Cash: Option to audit transactions vs ledger */}
                                  {(isBankAccount(h) || h.liquidityClass === 'Immediate') && (
                                    <button
                                      type="button"
                                      role="menuitem"
                                      onClick={() => {
                                        setActiveMenuId(null);
                                        setAuditHoldingId(h.id);
                                        setIsAuditModalOpen(true);
                                      }}
                                      className="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-indigo-300 hover:bg-slate-800/80 flex items-center gap-2 cursor-pointer text-left transition-colors"
                                    >
                                      <ShieldCheck size={14} className="shrink-0 text-cyan-400" />
                                      <span>Audit Ledger</span>
                                    </button>
                                  )}
                                  {isMarket && (
                                    <button
                                      type="button"
                                      role="menuitem"
                                      onClick={() => {
                                        setActiveMenuId(null);
                                        setSelectedHoldingForSale(h);
                                      }}
                                      className="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-emerald-400 hover:bg-slate-800/80 flex items-center gap-2 cursor-pointer text-left transition-colors"
                                    >
                                      <Coins size={14} className="shrink-0" />
                                      <span>Sell Units</span>
                                    </button>
                                  )}
                                  {(isBankAccount(h) || h.liquidityClass === 'Immediate') && liabilities.filter((l) => l.kind === 'loan' && (l.outstanding || 0) > 0).length > 0 && (
                                    <button
                                      type="button"
                                      role="menuitem"
                                      onClick={() => {
                                        setActiveMenuId(null);
                                        setPayDebtHolding(h);
                                      }}
                                      className="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-indigo-400 hover:bg-slate-800/80 flex items-center gap-2 cursor-pointer text-left transition-colors"
                                    >
                                      <Banknote size={14} className="shrink-0" />
                                      <span>Pay Loan / EMI</span>
                                    </button>
                                  )}
                                  {h.isSweepIn && (
                                    <button
                                      type="button"
                                      role="menuitem"
                                      onClick={() => {
                                        setActiveMenuId(null);
                                        setSelectedSweepInHolding(h);
                                      }}
                                      className="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-emerald-400 hover:bg-slate-800/80 flex items-center gap-2 cursor-pointer text-left transition-colors"
                                    >
                                      <Zap size={14} className="text-emerald-400 shrink-0" />
                                      <span>Sweep-In Redeem</span>
                                    </button>
                                  )}
                                  {(h.fixedRatePct && h.maturityDate) && (
                                    <button
                                      type="button"
                                      role="menuitem"
                                      onClick={() => {
                                        setActiveMenuId(null);
                                        setSelectedDepositForPayout(h);
                                      }}
                                      className="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-indigo-400 hover:bg-slate-800/80 flex items-center gap-2 cursor-pointer text-left transition-colors"
                                    >
                                      <Building2 size={14} className="text-indigo-400 shrink-0" />
                                      <span>Settle / Payout</span>
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    role="menuitem"
                                    onClick={() => {
                                      setActiveMenuId(null);
                                      setSelectedHoldingForEdit(h);
                                      setIsAddEditOpen(true);
                                    }}
                                    className="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-slate-200 hover:bg-slate-800/80 flex items-center gap-2 cursor-pointer text-left transition-colors"
                                  >
                                    <Edit2 size={14} className="shrink-0 text-slate-400" />
                                    <span>Edit</span>
                                  </button>
                                  <button
                                    type="button"
                                    role="menuitem"
                                    onClick={() => {
                                      setActiveMenuId(null);
                                      deleteHolding(h.id);
                                    }}
                                    className="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-rose-400 hover:bg-rose-500/10 flex items-center gap-2 cursor-pointer text-left w-full transition-colors"
                                  >
                                    <Trash2 size={14} className="shrink-0 text-rose-400" />
                                    <span>Delete</span>
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              </div>
            </div>
          );
        })
      )}


      {/* Bottom Action Bar for Easy Access on Mobile / Long Lists */}
      <div className="flex items-center justify-center pt-2">
        <button
          type="button"
          onClick={() => {
            setSelectedHoldingForEdit(null);
            setIsAddEditOpen(true);
          }}
          className="w-full sm:w-auto px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:scale-98 text-white font-bold text-xs sm:text-sm flex items-center justify-center gap-2 shadow-md shadow-emerald-600/25 cursor-pointer transition-all"
        >
          <Plus size={16} />
          <span>Add New Asset</span>
        </button>
      </div>

      {/* Human Capital & Lifetime Skill Asset Valuation Link Card */}
      <div id="human-capital-section" className="pt-2">
        <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/20 flex items-center justify-center shrink-0">
              <GraduationCap size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-white tracking-tight">Human Capital & Career Valuation</h3>
                <span className="text-[10px] text-purple-300 bg-purple-950/60 border border-purple-800/50 px-2 py-0.5 rounded-full font-semibold">
                  +{careerPrediction.netRateContributionPct.toFixed(1)}% Velocity
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Skill Earning Power: <strong className="text-emerald-400 font-mono">{formatMoney(engineResult.salaryYearlyIncomeBase, baseCurr, baseCurrSymbol)}/yr</strong> · 5-Yr NPV: <strong className="text-slate-200 font-mono">{formatMoney(careerPrediction.humanCapitalNpv5Yr, baseCurr, baseCurrSymbol)}</strong>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setActiveModal('career')}
            className="px-4 py-2 rounded-xl bg-purple-950/60 border border-purple-800/60 hover:bg-purple-900/60 text-purple-200 text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors shadow-xs shrink-0"
          >
            <span>Open Career Hub</span>
            <ArrowRight size={14} />
          </button>
        </div>
      </div>

      {/* Modals */}
      {isAddEditOpen && (
        <AddEditAssetModal
          key={selectedHoldingForEdit ? selectedHoldingForEdit.id : 'create-new-asset'}
          isOpen={isAddEditOpen}
          onClose={() => {
            setIsAddEditOpen(false);
            setSelectedHoldingForEdit(null);
          }}
          initialHolding={selectedHoldingForEdit}
        />
      )}

      {isBatchAddOpen && (
        <BatchAddAssetsModal
          isOpen={isBatchAddOpen}
          onClose={() => setIsBatchAddOpen(false)}
        />
      )}

      {selectedHoldingForSale && (
        <SellHoldingModal
          isOpen={!!selectedHoldingForSale}
          onClose={() => setSelectedHoldingForSale(null)}
          holding={selectedHoldingForSale}
        />
      )}

      {payDebtHolding && liabilities.filter((l) => l.kind === 'loan' && (l.outstanding || 0) > 0).length > 0 && (
        <PayLoanModal
          isOpen={!!payDebtHolding}
          onClose={() => setPayDebtHolding(null)}
          loan={liabilities.filter((l) => l.kind === 'loan' && (l.outstanding || 0) > 0)[0]}
          initialAssetId={payDebtHolding.id}
        />
      )}

      {selectedSweepInHolding && (
        <SweepInRedeemModal
          isOpen={!!selectedSweepInHolding}
          onClose={() => setSelectedSweepInHolding(null)}
          holding={selectedSweepInHolding}
        />
      )}

      {selectedDepositForPayout && (
        <ProcessDepositPayoutModal
          isOpen={!!selectedDepositForPayout}
          onClose={() => setSelectedDepositForPayout(null)}
          holding={selectedDepositForPayout}
        />
      )}

      {/* Delete Asset Confirmation Modal */}
      {holdingToDelete && (
        <Modal
          isOpen={!!holdingToDelete}
          onClose={() => setHoldingToDelete(null)}
          title="Delete Asset"
          subtitle={holdingToDelete.name}
          footer={
            <div className="flex items-center justify-end gap-2 w-full">
              <button
                type="button"
                onClick={() => setHoldingToDelete(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold cursor-pointer hover:bg-slate-700 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (holdingToDelete) {
                    await deleteHolding(holdingToDelete.id);
                    setHoldingToDelete(null);
                  }
                }}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold cursor-pointer transition-colors shadow-md shadow-rose-600/30 flex items-center gap-1.5"
              >
                <Trash2 size={14} />
                <span>Delete Asset</span>
              </button>
            </div>
          }
        >
          <div className="space-y-3 py-2 text-xs text-slate-300">
            <p>
              Are you sure you want to permanently delete <strong className="text-white">{holdingToDelete.name}</strong>?
            </p>
            <p className="text-slate-400">
              This will remove this asset from your portfolio calculations, net worth, and liquid cash reserves. This action cannot be undone.
            </p>
          </div>
        </Modal>
      )}

      {isAuditModalOpen && (
        <ReconciliationAuditModal
          holdingId={auditHoldingId}
          onClose={() => setIsAuditModalOpen(false)}
        />
      )}
    </div>
  );
};
