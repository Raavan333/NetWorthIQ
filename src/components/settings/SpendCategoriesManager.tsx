import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { QuickSpendChip, SpendCategoryConfig } from '../../types';
import { Plus, Trash2, Edit2, Check, Tag, Zap, Sparkles } from 'lucide-react';

export const SpendCategoriesManager: React.FC = () => {
  const {
    spendCategories,
    addSpendCategory,
    updateSpendCategory,
    deleteSpendCategory,
    quickChips,
    addQuickChip,
    updateQuickChip,
    deleteQuickChip,
    holdings,
    liabilities,
    transactions,
  } = useApp();

  const [patternSyncMessage, setPatternSyncMessage] = useState<string | null>(null);

  // Category Edit State
  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  const [catName, setCatName] = useState('');
  const [catColor, setCatColor] = useState('#10b981');
  const [isAddingCat, setIsAddingCat] = useState(false);

  // Chip Edit State
  const [editingChipId, setEditingChipId] = useState<string | null>(null);
  const [chipLabel, setChipLabel] = useState('');
  const [chipReason, setChipReason] = useState('');
  const [chipCategory, setChipCategory] = useState(spendCategories[0]?.name || 'Food & Dining');
  const [chipAmount, setChipAmount] = useState('');
  const [isAddingChip, setIsAddingChip] = useState(false);

  // Handlers for Categories
  const handleSaveCategory = async () => {
    if (!catName.trim()) return;

    if (editingCatId) {
      await updateSpendCategory({
        id: editingCatId,
        name: catName.trim(),
        color: catColor,
      });
      setEditingCatId(null);
    } else {
      await addSpendCategory({
        id: `cat-${Date.now()}`,
        name: catName.trim(),
        color: catColor,
        isDefault: false,
      });
      setIsAddingCat(false);
    }
    setCatName('');
  };

  const handleStartEditCat = (cat: SpendCategoryConfig) => {
    setEditingCatId(cat.id);
    setCatName(cat.name);
    setCatColor(cat.color || '#10b981');
    setIsAddingCat(false);
  };

  // Handlers for Quick Chips
  const handleSaveChip = async () => {
    if (!chipLabel.trim()) return;

    const amt = chipAmount ? parseFloat(chipAmount) : undefined;

    if (editingChipId) {
      await updateQuickChip({
        id: editingChipId,
        label: chipLabel.trim(),
        reason: chipReason.trim() || chipLabel.trim(),
        category: chipCategory,
        amount: amt,
      });
      setEditingChipId(null);
    } else {
      await addQuickChip({
        id: `chip-${Date.now()}`,
        label: chipLabel.trim(),
        reason: chipReason.trim() || chipLabel.trim(),
        category: chipCategory,
        amount: amt,
      });
      setIsAddingChip(false);
    }
    setChipLabel('');
    setChipReason('');
    setChipAmount('');
  };

  const handleStartEditChip = (chip: QuickSpendChip) => {
    setEditingChipId(chip.id);
    setChipLabel(chip.label);
    setChipReason(chip.reason);
    setChipCategory(chip.category);
    setChipAmount(chip.amount ? String(chip.amount) : '');
    setIsAddingChip(false);
  };

  const handleAutoSyncSpendingPatterns = async () => {
    const spends = transactions.filter((t) => t.kind === 'spend');
    if (spends.length === 0) {
      setPatternSyncMessage('No spend history yet. Add spend entries to train quick chips.');
      setTimeout(() => setPatternSyncMessage(null), 4000);
      return;
    }

    const counts: Record<string, { count: number; sample: (typeof spends)[0] }> = {};
    for (const s of spends) {
      const key = `${(s.reason || 'General').toLowerCase().trim()}:::${s.category || 'General'}`;
      if (!counts[key]) counts[key] = { count: 0, sample: s };
      counts[key].count += 1;
    }

    const sorted = Object.values(counts).sort((a, b) => b.count - a.count).slice(0, 5);
    let addedCount = 0;
    for (const item of sorted) {
      const label = item.sample.reason.slice(0, 16);
      const alreadyExists = quickChips.some((q) => q.label.toLowerCase() === label.toLowerCase());
      if (!alreadyExists && label.trim().length > 0) {
        await addQuickChip({
          id: `chip-${Date.now()}-${Math.random()}`,
          label,
          reason: item.sample.reason,
          category: item.sample.category || 'Food & Dining',
          amount: item.sample.amount,
          sourceId: item.sample.fromId || item.sample.sourceId,
        });
        addedCount++;
      }
    }

    setPatternSyncMessage(
      addedCount > 0
        ? `Added ${addedCount} smart one-tap chips from your most frequent spending patterns!`
        : 'Quick chips are already up to date with your frequent spending patterns.'
    );
    setTimeout(() => setPatternSyncMessage(null), 5000);
  };

  return (
    <div className="space-y-6">
      {/* 1. Spend Categories Configuration */}
      <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
              <Tag size={15} className="text-emerald-400" />
              <span>Spend Categories</span>
            </h4>
            <p className="text-xs text-slate-400">
              Fully configurable: add new categories, edit names, customize color tags, or delete unneeded ones.
            </p>
          </div>
          {!isAddingCat && !editingCatId && (
            <button
              onClick={() => {
                setIsAddingCat(true);
                setCatName('');
                setCatColor('#10b981');
              }}
              className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1 cursor-pointer transition-colors"
            >
              <Plus size={13} /> Add Category
            </button>
          )}
        </div>

        {/* Add/Edit Category Form */}
        {(isAddingCat || editingCatId) && (
          <div className="p-3.5 rounded-xl bg-slate-950 border border-emerald-500/30 space-y-3">
            <div className="text-xs font-bold text-white">
              {editingCatId ? 'Edit Category' : 'Create New Category'}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <div className="sm:col-span-2">
                <label className="block text-[11px] text-slate-400 mb-1">Category Name</label>
                <input
                  type="text"
                  placeholder="e.g. Dining, Pets, Subscriptions, Fitness"
                  value={catName}
                  onChange={(e) => setCatName(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Tag Color</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={catColor}
                    onChange={(e) => setCatColor(e.target.value)}
                    className="w-8 h-8 rounded-lg border-0 bg-transparent cursor-pointer"
                  />
                  <span className="text-xs font-mono text-slate-300">{catColor}</span>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  setIsAddingCat(false);
                  setEditingCatId(null);
                }}
                className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 text-xs font-medium cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveCategory}
                className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1 cursor-pointer"
              >
                <Check size={13} /> Save Category
              </button>
            </div>
          </div>
        )}

        {/* Categories List */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
          {spendCategories.map((cat, idx) => (
            <div
              key={`${cat.id || 'cat'}-${idx}`}
              className="p-2.5 rounded-xl bg-slate-950/70 border border-slate-800/80 flex items-center justify-between gap-2 hover:border-slate-700 transition-colors"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className="w-3 h-3 rounded-full shrink-0 shadow-sm"
                  style={{ backgroundColor: cat.color || '#10b981' }}
                />
                <span className="text-xs font-semibold text-slate-200 truncate">{cat.name}</span>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => handleStartEditCat(cat)}
                  className="p-1 rounded text-slate-400 hover:text-emerald-400 cursor-pointer"
                  title="Edit Category"
                >
                  <Edit2 size={12} />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    deleteSpendCategory(cat.id);
                  }}
                  className="p-1 rounded text-slate-500 hover:text-rose-400 cursor-pointer"
                  title="Delete Category"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 2. One-Tap Quick Spend Chips */}
      <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
              <Zap size={15} className="text-amber-400" />
              <span>One-Tap Quick Chips</span>
            </h4>
            <p className="text-xs text-slate-400">
              Customize speed-entry chips to match your exact daily spending pattern (coffee, grocery run, fuel, transit).
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleAutoSyncSpendingPatterns}
              className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors"
              title="Detect frequent spends from ledger and suggest one-tap chips"
            >
              <Sparkles size={13} className="text-amber-400" />
              <span>Auto-Learn from Spends</span>
            </button>
            {!isAddingChip && !editingChipId && (
              <button
                onClick={() => {
                  setIsAddingChip(true);
                  setChipLabel('');
                  setChipReason('');
                  setChipCategory(spendCategories[0]?.name || 'Food & Dining');
                  setChipAmount('');
                }}
                className="px-3 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold flex items-center gap-1 cursor-pointer transition-colors"
              >
                <Plus size={13} /> Add Quick Chip
              </button>
            )}
          </div>
        </div>

        {patternSyncMessage && (
          <div className="p-3 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-300 text-xs flex items-center gap-2">
            <Sparkles size={15} />
            <span>{patternSyncMessage}</span>
          </div>
        )}

        {/* Add/Edit Chip Form */}
        {(isAddingChip || editingChipId) && (
          <div className="p-3.5 rounded-xl bg-slate-950 border border-amber-500/30 space-y-3">
            <div className="text-xs font-bold text-white">
              {editingChipId ? 'Edit Quick Chip' : 'Create New Quick Chip'}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Chip Label (Shown on button)</label>
                <input
                  type="text"
                  placeholder="e.g. Fuel Refill, Coffee, Milk"
                  value={chipLabel}
                  onChange={(e) => setChipLabel(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Default Description</label>
                <input
                  type="text"
                  placeholder="e.g. Petrol bunk refill"
                  value={chipReason}
                  onChange={(e) => setChipReason(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
                />
              </div>

              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Assign Category</label>
                <select
                  value={chipCategory}
                  onChange={(e) => setChipCategory(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
                >
                  {spendCategories.map((c, idx) => (
                    <option key={`${c.id || 'cat'}-${idx}`} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Default Amount (Optional)</label>
                <input
                  type="number"
                  step="any"
                  placeholder="e.g. 150"
                  value={chipAmount}
                  onChange={(e) => setChipAmount(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  setIsAddingChip(false);
                  setEditingChipId(null);
                }}
                className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 text-xs font-medium cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveChip}
                className="px-3.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold flex items-center gap-1 cursor-pointer"
              >
                <Check size={13} /> Save Chip
              </button>
            </div>
          </div>
        )}

        {/* Chips Grid */}
        <div className="flex flex-wrap gap-2">
          {quickChips.map((chip, idx) => (
            <div
              key={`${chip.id || 'chip'}-${idx}`}
              className="px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 flex items-center gap-2 hover:border-slate-700 transition-colors"
            >
              <span className="text-xs font-bold text-emerald-400">+{chip.label}</span>
              <span className="text-[10px] text-slate-400 font-mono">({chip.category})</span>
              <div className="flex items-center gap-1 ml-1 border-l border-slate-800 pl-1.5">
                <button
                  type="button"
                  onClick={() => handleStartEditChip(chip)}
                  className="p-0.5 text-slate-500 hover:text-emerald-400 cursor-pointer"
                  title="Edit chip"
                >
                  <Edit2 size={11} />
                </button>
                <button
                  type="button"
                  onClick={() => deleteQuickChip(chip.id)}
                  className="p-0.5 text-slate-500 hover:text-rose-400 cursor-pointer"
                  title="Delete chip"
                >
                  <Trash2 size={11} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
