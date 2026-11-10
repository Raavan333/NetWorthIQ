import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Holding } from '../../types';
import { convertToBase, getHoldingLocalValue } from '../../lib/calcEngine';
import { formatMoney, formatCompactMoney } from '../../lib/formatters';
import { AddEditAssetModal } from './AddEditAssetModal';
import { BatchAddAssetsModal } from './BatchAddAssetsModal';
import { UpdateValuesTableModal } from './UpdateValuesTableModal';
import { SellHoldingModal } from './SellHoldingModal';
import { SweepInRedeemModal } from './SweepInRedeemModal';
import { ProcessDepositPayoutModal } from './ProcessDepositPayoutModal';
import { ReceivablesManager } from './ReceivablesManager';
import { ReconciliationAuditModal } from '../common/ReconciliationAuditModal';
import { PayLoanModal } from '../liabilities/PayLoanModal';
import { Modal } from '../common/Modal';
import { HumanCapitalSkillCard } from './HumanCapitalSkillCard';
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
} from 'lucide-react';

export const AssetsView: React.FC = () => {
  const {
    holdings,
    liabilities,
    assetTypes,
    currencies,
    settings,
    deleteHolding,
  } = useApp();

  const [search, setSearch] = useState('');
  const [selectedHoldingForEdit, setSelectedHoldingForEdit] = useState<Holding | null>(null);
  const [holdingToDelete, setHoldingToDelete] = useState<Holding | null>(null);
  const [isAddEditOpen, setIsAddEditOpen] = useState(false);
  const [isBatchAddOpen, setIsBatchAddOpen] = useState(false);
  const [isBulkUpdateOpen, setIsBulkUpdateOpen] = useState(false);
  const [selectedHoldingForSale, setSelectedHoldingForSale] = useState<Holding | null>(null);
  const [selectedSweepInHolding, setSelectedSweepInHolding] = useState<Holding | null>(null);
  const [selectedDepositForPayout, setSelectedDepositForPayout] = useState<Holding | null>(null);
  const [payDebtHolding, setPayDebtHolding] = useState<Holding | null>(null);
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [isAuditModalOpen, setIsAuditModalOpen] = useState(false);
  const [auditHoldingId, setAuditHoldingId] = useState<string | undefined>(undefined);

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

        <div className="flex items-center gap-1.5 flex-wrap sm:flex-nowrap w-full sm:w-auto">
          <button
            onClick={() => setIsBatchAddOpen(true)}
            className="flex-1 sm:flex-none px-2.5 py-2 rounded-xl bg-slate-900 border border-slate-800 hover:bg-slate-800 text-xs font-semibold text-slate-200 flex items-center justify-center gap-1.5 cursor-pointer shadow-sm"
            title="Add multiple assets at once in a compact grid"
          >
            <Layers size={14} className="text-emerald-400" />
            <span className="hidden sm:inline">Batch Add</span>
            <span className="sm:hidden">Batch</span>
          </button>

          <button
            onClick={() => setIsBulkUpdateOpen(true)}
            className="flex-1 sm:flex-none px-2.5 py-2 rounded-xl bg-slate-900 border border-slate-800 hover:bg-slate-800 text-xs font-semibold text-slate-200 flex items-center justify-center gap-1.5 cursor-pointer shadow-sm"
          >
            <TableProperties size={14} className="text-cyan-400" />
            <span className="hidden sm:inline">Update Values</span>
            <span className="sm:hidden">Values</span>
          </button>

          <button
            onClick={() => {
              setAuditHoldingId(undefined);
              setIsAuditModalOpen(true);
            }}
            className="flex-1 sm:flex-none px-2.5 py-2 rounded-xl bg-slate-900 border border-slate-800 hover:bg-slate-800 text-xs font-semibold text-slate-200 flex items-center justify-center gap-1.5 cursor-pointer shadow-sm"
            title="Reconcile account balance against recorded transaction ledger"
          >
            <ShieldCheck size={14} className="text-indigo-400" />
            <span className="hidden sm:inline">Audit Ledger</span>
            <span className="sm:hidden">Audit</span>
          </button>

          <button
            onClick={() => {
              const el = document.getElementById('human-capital-section');
              if (el) el.scrollIntoView({ behavior: 'smooth' });
            }}
            className="flex-1 sm:flex-none px-2.5 py-2 rounded-xl bg-purple-950/40 border border-purple-800/50 hover:bg-purple-900/40 text-xs font-semibold text-purple-300 flex items-center justify-center gap-1.5 cursor-pointer shadow-sm"
            title="Jump to Human Capital Lifetime Skill Valuation & Career Progression"
          >
            <GraduationCap size={14} className="text-purple-400" />
            <span className="hidden sm:inline">Skill Asset</span>
            <span className="sm:hidden">Skills</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setSelectedHoldingForEdit(null);
              setIsAddEditOpen(true);
            }}
            className="flex-1 sm:flex-none px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center justify-center gap-1 shadow-md shadow-emerald-600/25 cursor-pointer"
          >
            <Plus size={15} />
            <span className="whitespace-nowrap">Asset</span>
          </button>
        </div>
      </div>

      {/* Receivables & Personal Loans Given (Dedicated Asset Ledger) */}
      <ReceivablesManager />

      {/* Search Input */}
      <div className="relative">
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
                      className="p-3.5 sm:p-4 hover:bg-slate-800/30 transition-colors flex flex-wrap sm:flex-nowrap items-start sm:items-center justify-between gap-2.5 sm:gap-3 relative"
                    >
                      <div className="flex-1 min-w-[180px]">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="text-sm font-semibold text-white break-words">{h.name}</h4>
                          {h.isSweepIn && (
                            <span className="text-[11px] font-medium text-emerald-400 shrink-0">
                              Sweep-in
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2 mt-1 text-xs text-slate-400 flex-wrap">
                          {isMarket ? (
                            <span>
                              {h.units} units × {formatMoney(h.currentPrice || 0, h.currency, itemCurrSym)}
                            </span>
                          ) : (
                            <span>Balance: {formatMoney(h.principalOrValue, h.currency, itemCurrSym)}</span>
                          )}

                          <span className="text-slate-600">·</span>
                          <span className="text-slate-400">{h.liquidityClass}</span>

                          {isFixed && h.fixedRatePct !== undefined ? (
                            <>
                              <span className="text-slate-600">·</span>
                              <span className="font-mono text-[11px] text-emerald-400">
                                {h.fixedRatePct}% p.a.
                              </span>
                            </>
                          ) : !isFixed && h.expectedRatePct !== undefined && h.expectedRatePct !== null ? (
                            <>
                              <span className="text-slate-600">·</span>
                              <span className="text-slate-400 font-mono text-[11px]">
                                ~{h.expectedRatePct}% p.a.
                              </span>
                            </>
                          ) : null}

                          {h.marketCapCategory && (
                            <>
                              <span className="text-slate-600">·</span>
                              <span className="text-slate-400 capitalize">
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
                                      className="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-cyan-300 hover:bg-slate-800/80 flex items-center gap-2 cursor-pointer text-left transition-colors"
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

      {/* Human Capital & Lifetime Skill Asset Valuation (Intangible Earning Asset) */}
      <div id="human-capital-section" className="pt-4 border-t border-slate-800/80">
        <HumanCapitalSkillCard />
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

      {isBulkUpdateOpen && (
        <UpdateValuesTableModal
          isOpen={isBulkUpdateOpen}
          onClose={() => setIsBulkUpdateOpen(false)}
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
