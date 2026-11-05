import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Modal } from '../common/Modal';
import { Upload, Download, Check, AlertCircle } from 'lucide-react';
import { downloadFile } from '../../lib/downloadHelper';
import { ExportDownloadModal } from '../common/ExportDownloadModal';

interface UpdateValuesTableModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const UpdateValuesTableModal: React.FC<UpdateValuesTableModalProps> = ({
  isOpen,
  onClose,
}) => {
  const { holdings, updateHoldingValuesBulk, settings, currencies } = useApp();
  const [editedValues, setEditedValues] = useState<Record<string, { currentPrice?: number; principalOrValue?: number }>>(
    {}
  );
  const [csvStatus, setCsvStatus] = useState<string>('');
  const [exported, setExported] = useState(false);
  const [exportModal, setExportModal] = useState<{
    isOpen: boolean;
    title: string;
    filename: string;
    content: string;
    mimeType: string;
  } | null>(null);

  const handlePriceChange = (id: string, val: string, isMarket: boolean) => {
    const num = parseFloat(val);
    setEditedValues((prev) => ({
      ...prev,
      [id]: isMarket
        ? { ...prev[id], currentPrice: isNaN(num) ? undefined : num }
        : { ...prev[id], principalOrValue: isNaN(num) ? undefined : num },
    }));
  };

  const handleSaveAll = async () => {
    const updates = Object.entries(editedValues).map(([id, vals]) => ({
      id,
      ...vals,
    }));
    await updateHoldingValuesBulk(updates);
    onClose();
  };

  // Export current table as CSV
  const handleExportCSV = () => {
    const headers = ['type,name,currency,units,price_or_value,rate_pct,start_date,maturity_date,liquidity'];
    const rows = holdings.map((h) => {
      const isMarket = h.units !== undefined && h.units > 0;
      const priceOrVal = isMarket ? h.currentPrice || 0 : h.principalOrValue || 0;
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
    downloadFile(filename, csvContent, 'text/csv');
    setExported(true);
    setTimeout(() => setExported(false), 2500);
    setExportModal({
      isOpen: true,
      title: 'Holdings & Current Values (CSV Export)',
      filename,
      content: csvContent,
      mimeType: 'text/csv',
    });
  };

  // Import CSV to update holdings
  const handleImportCSV = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const text = event.target?.result as string;
        const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
        if (lines.length < 2) {
          setCsvStatus('CSV has no data rows');
          return;
        }

        const updates: { id: string; currentPrice?: number; principalOrValue?: number }[] = [];
        let matchedCount = 0;

        for (let i = 1; i < lines.length; i++) {
          const cols = lines[i].split(',').map((c) => c.replace(/^"|"$/g, '').trim());
          if (cols.length >= 5) {
            const name = cols[1];
            const priceOrVal = parseFloat(cols[4]);

            // Find matching holding by name
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
          setCsvStatus(`Successfully updated ${matchedCount} holdings from CSV!`);
        } else {
          setCsvStatus('No matching holdings found by name in CSV.');
        }
      } catch (err) {
        setCsvStatus('Failed to parse CSV file.');
      }
    };
    reader.readAsText(file);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Update Asset Values (Bulk Mode)"
      subtitle="Fast table to update prices, stock quotes, and bank balances at once"
      maxWidth="max-w-2xl"
    >
      <div className="space-y-4">
        {/* CSV Action Buttons */}
        <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl bg-slate-950/70 border border-slate-800">
          <div className="text-xs text-slate-300">
            Export table to CSV, edit in Excel/Sheets, and import back.
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleExportCSV}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 cursor-pointer transition-all ${
                exported
                  ? 'bg-emerald-600 text-white font-bold'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
              }`}
            >
              {exported ? <Check size={14} className="text-white" /> : <Download size={14} />}
              <span>{exported ? 'CSV Downloaded!' : 'Export CSV'}</span>
            </button>
            <label className="px-3 py-1.5 rounded-lg bg-emerald-600/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-600/30 text-xs font-semibold flex items-center gap-1.5 cursor-pointer">
              <Upload size={14} /> Import CSV
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={handleImportCSV}
                className="hidden"
              />
            </label>
          </div>
        </div>

        {csvStatus && (
          <div className="p-2.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2">
            <Check size={14} /> {csvStatus}
          </div>
        )}

        {/* Bulk Editing Grid */}
        <div className="border border-slate-800 rounded-xl overflow-hidden">
          <div className="max-h-80 overflow-y-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950 text-slate-400 font-semibold sticky top-0 border-b border-slate-800 z-10">
                <tr>
                  <th className="p-3">Asset</th>
                  <th className="p-3">Type / Mode</th>
                  <th className="p-3">Units</th>
                  <th className="p-3">Current Price / Value</th>
                  <th className="p-3">Curr</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {holdings.map((h) => {
                  const isMarket = h.units !== undefined && h.units > 0;
                  const currentVal = isMarket
                    ? editedValues[h.id]?.currentPrice ?? h.currentPrice ?? 0
                    : editedValues[h.id]?.principalOrValue ?? h.principalOrValue ?? 0;

                  return (
                    <tr key={h.id} className="hover:bg-slate-800/30">
                      <td className="p-3 font-semibold text-slate-200">{h.name}</td>
                      <td className="p-3 text-slate-400">
                        {isMarket ? 'Market Price' : 'Balance'}
                      </td>
                      <td className="p-3 font-mono text-slate-300">
                        {isMarket ? h.units : '-'}
                      </td>
                      <td className="p-2">
                        <input
                          type="number"
                          step="any"
                          value={currentVal}
                          onChange={(e) => handlePriceChange(h.id, e.target.value, isMarket)}
                          className="w-32 bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1 text-slate-100 font-mono text-xs focus:outline-none focus:border-emerald-500"
                        />
                      </td>
                      <td className="p-3 font-mono text-slate-400">{h.currency}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 text-xs font-semibold cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={handleSaveAll}
            className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-md shadow-emerald-600/25 flex items-center gap-1.5 cursor-pointer"
          >
            <Check size={14} /> Save All Values
          </button>
        </div>
      </div>

      {exportModal && (
        <ExportDownloadModal
          isOpen={exportModal.isOpen}
          onClose={() => setExportModal(null)}
          title={exportModal.title}
          filename={exportModal.filename}
          content={exportModal.content}
          mimeType={exportModal.mimeType}
        />
      )}
    </Modal>
  );
};
