import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { AssetType, LiquidityClass, ReturnMode } from '../../types';
import { Plus, Trash2, Edit2, Layers, AlertTriangle } from 'lucide-react';

export const AssetCategoriesManager: React.FC = () => {
  const { assetTypes, addAssetType, updateAssetType, deleteAssetType, holdings } = useApp();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('Cash & Liquid Assets');
  const [returnMode, setReturnMode] = useState<ReturnMode>('realised-only');
  const [defaultLiquidity, setDefaultLiquidity] = useState<LiquidityClass>('Immediate');
  const [isAdding, setIsAdding] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!name.trim()) {
      setError('Category / type name is required.');
      return;
    }

    if (editingId) {
      const existing = assetTypes.find((a) => a.id === editingId);
      if (existing) {
        await updateAssetType({
          ...existing,
          name: name.trim(),
          category: category.trim(),
          returnMode,
          defaultLiquidity,
        });
      }
      setEditingId(null);
    } else {
      const id = `custom-asset-type-${Date.now()}`;
      await addAssetType({
        id,
        name: name.trim(),
        category: category.trim(),
        returnMode,
        defaultLiquidity,
        isBuiltIn: false,
      });
      setIsAdding(false);
    }

    setName('');
  };

  const handleStartEdit = (t: AssetType) => {
    setEditingId(t.id);
    setName(t.name);
    setCategory(t.category || 'Cash & Liquid Assets');
    setReturnMode(t.returnMode);
    setDefaultLiquidity(t.defaultLiquidity);
    setIsAdding(true);
  };

  const handleDelete = async (id: string) => {
    const isReferenced = holdings.some((h) => h.typeId === id);
    if (isReferenced) {
      setError('Cannot delete an asset category currently referenced by active holdings.');
      return;
    }
    await deleteAssetType(id);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
            <Layers size={15} className="text-cyan-400" />
            <span>Asset Classes &amp; Classification Types</span>
          </h4>
          <p className="text-xs text-slate-400">
            Define custom asset types, liquidity classes, and yield return behavior.
          </p>
        </div>

        {!isAdding && (
          <button
            onClick={() => {
              setEditingId(null);
              setName('');
              setCategory('Cash & Liquid Assets');
              setReturnMode('realised-only');
              setDefaultLiquidity('Immediate');
              setIsAdding(true);
            }}
            className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1 cursor-pointer"
          >
            <Plus size={14} /> Add Asset Type
          </button>
        )}
      </div>

      {error && (
        <div className="p-2.5 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-1.5">
          <AlertTriangle size={14} className="shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {isAdding && (
        <form onSubmit={handleSave} className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
          <span className="text-xs font-bold text-white">
            {editingId ? 'Edit Asset Type' : 'Add New Asset Classification'}
          </span>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Type Name</label>
              <input
                type="text"
                placeholder="e.g. Sovereign Gold Bonds, Crypto, Private Equity"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Macro Category</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
              >
                <option value="Cash & Liquid Assets">Cash &amp; Liquid Assets</option>
                <option value="Equities & Market">Equities &amp; Market</option>
                <option value="Fixed Income & Lending">Fixed Income &amp; Lending</option>
                <option value="Commodities & Real Estate">Commodities &amp; Real Estate</option>
                <option value="Alternative Investments">Alternative Investments</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Return Mode</label>
              <select
                value={returnMode}
                onChange={(e) => setReturnMode(e.target.value as ReturnMode)}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
              >
                <option value="realised-only">Realised / Market Price Appreciation</option>
                <option value="fixed">Fixed Compounding Return Rate</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Default Liquidity</label>
              <select
                value={defaultLiquidity}
                onChange={(e) => setDefaultLiquidity(e.target.value as LiquidityClass)}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
              >
                <option value="Immediate">Immediate (0-24 Hours)</option>
                <option value="Short">Short Term (1-7 Days)</option>
                <option value="Locked">Locked (Maturity / Illiquid)</option>
              </select>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
            <button
              type="button"
              onClick={() => {
                setIsAdding(false);
                setEditingId(null);
              }}
              className="px-3.5 py-1.5 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold cursor-pointer shadow-sm"
            >
              {editingId ? 'Update Type' : 'Save Type'}
            </button>
          </div>
        </form>
      )}

      {/* Asset Types Table */}
      <div className="border border-slate-800 rounded-xl overflow-hidden">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-950 text-slate-400 font-semibold border-b border-slate-800">
            <tr>
              <th className="p-3">Type Name</th>
              <th className="p-3">Category</th>
              <th className="p-3">Return Mode</th>
              <th className="p-3">Liquidity</th>
              <th className="p-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60 font-mono">
            {assetTypes.map((t) => {
              const holdingCount = holdings.filter((h) => h.typeId === t.id).length;
              return (
                <tr key={t.id} className="hover:bg-slate-800/30">
                  <td className="p-3 font-bold text-white font-sans flex items-center gap-1.5">
                    {t.name}
                    {t.isBuiltIn && (
                      <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 text-[9px]">
                        SYSTEM
                      </span>
                    )}
                    {holdingCount > 0 && (
                      <span className="text-[10px] text-slate-500 font-normal">
                        ({holdingCount} asset{holdingCount === 1 ? '' : 's'})
                      </span>
                    )}
                  </td>
                  <td className="p-3 text-slate-300 font-sans">{t.category || 'General'}</td>
                  <td className="p-3 text-slate-400 font-sans">
                    {t.returnMode === 'fixed' ? 'Fixed Yield' : 'Market Realised'}
                  </td>
                  <td className="p-3 font-sans">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                        t.defaultLiquidity === 'Immediate'
                          ? 'bg-emerald-500/15 text-emerald-400'
                          : t.defaultLiquidity === 'Short'
                          ? 'bg-cyan-500/15 text-cyan-400'
                          : 'bg-amber-500/15 text-amber-400'
                      }`}
                    >
                      {t.defaultLiquidity}
                    </span>
                  </td>
                  <td className="p-3 text-right font-sans">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => handleStartEdit(t)}
                        className="p-1 rounded text-slate-400 hover:text-white cursor-pointer"
                        title="Edit Type"
                      >
                        <Edit2 size={13} />
                      </button>
                      {!t.isBuiltIn && holdingCount === 0 && (
                        <button
                          onClick={() => handleDelete(t.id)}
                          className="p-1 rounded text-slate-500 hover:text-rose-400 cursor-pointer"
                          title="Delete Type"
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
