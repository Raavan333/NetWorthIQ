import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Modal } from '../common/Modal';
import { Transaction, TransactionKind } from '../../types';
import { Upload, AlertTriangle, CheckCircle2, FileText } from 'lucide-react';

interface BulkImportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ParsedImportRow {
  date: string;
  amount: number;
  category: string;
  reason: string;
  kind?: TransactionKind;
  sourceId?: string;
}

export const BulkImportModal: React.FC<BulkImportModalProps> = ({ isOpen, onClose }) => {
  const { addTransaction, holdings, liabilities, settings } = useApp();
  const [inputText, setInputText] = useState('');
  const [error, setError] = useState('');
  const [successCount, setSuccessCount] = useState<number | null>(null);

  const baseCurr = settings.baseCurrency || 'INR';

  const handleImport = async () => {
    setError('');
    setSuccessCount(null);

    const trimmed = inputText.trim();
    if (!trimmed) {
      setError('Please paste CSV or JSON transaction records to import.');
      return;
    }

    try {
      let parsedRecords: ParsedImportRow[] = [];

      if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
        // Parse JSON
        const parsed = JSON.parse(trimmed);
        const arr = Array.isArray(parsed) ? parsed : [parsed];
        parsedRecords = arr.map((item: any) => ({
          date: item.date || new Date().toISOString().split('T')[0],
          amount: Math.abs(parseFloat(item.amount) || 0),
          category: item.category || 'General',
          reason: item.reason || item.description || 'Imported Transaction',
          kind: (item.kind || item.type || 'spend') as TransactionKind,
          sourceId: item.sourceId || item.sourceAssetId || holdings[0]?.id || liabilities[0]?.id || 'manual',
        }));
      } else {
        // Parse CSV (Header: Date, Amount, Category, Reason/Description)
        const lines = trimmed.split('\n').filter((l) => l.trim().length > 0);
        if (lines.length === 0) {
          setError('No valid rows found.');
          return;
        }

        const startIndex = lines[0].toLowerCase().includes('date') || lines[0].toLowerCase().includes('amount') ? 1 : 0;

        for (let i = startIndex; i < lines.length; i++) {
          const cols = lines[i].split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
          if (cols.length >= 2) {
            const date = cols[0] || new Date().toISOString().split('T')[0];
            const amount = parseFloat(cols[1]) || 0;
            const category = cols[2] || 'General';
            const reason = cols[3] || 'Imported Transaction';

            parsedRecords.push({
              date,
              amount: Math.abs(amount),
              category,
              reason,
              kind: 'spend',
              sourceId: holdings[0]?.id || liabilities[0]?.id || 'manual',
            });
          }
        }
      }

      if (parsedRecords.length === 0) {
        setError('No valid transaction records could be parsed.');
        return;
      }

      let count = 0;
      for (const rec of parsedRecords) {
        if (rec.amount && rec.amount > 0) {
          const newTx: Transaction = {
            id: `tx-import-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            date: rec.date || new Date().toISOString().split('T')[0],
            amount: rec.amount,
            currency: baseCurr,
            kind: rec.kind || 'spend',
            category: rec.category || 'General',
            reason: rec.reason || 'Imported transaction',
            sourceId: rec.sourceId || holdings[0]?.id || 'manual',
            paymentMode: 'upi',
            fxRateUsed: 1.0,
            createdAt: new Date().toISOString(),
          };
          await addTransaction(newTx);
          count++;
        }
      }

      setSuccessCount(count);
      setInputText('');
      setTimeout(() => {
        onClose();
        setSuccessCount(null);
      }, 1200);
    } catch (err: any) {
      setError(`Failed to parse import data: ${err.message || 'Invalid format'}`);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Bulk Import Ledger Transactions"
      subtitle="Import past transactions from CSV (Date, Amount, Category, Description) or JSON"
      maxWidth="max-w-xl"
    >
      <div className="space-y-4">
        {error && (
          <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/50 text-rose-300 text-xs flex items-center gap-2">
            <AlertTriangle size={15} className="shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {successCount !== null && (
          <div className="p-3 rounded-xl bg-emerald-500/15 border border-emerald-500/50 text-emerald-300 text-xs flex items-center gap-2">
            <CheckCircle2 size={15} className="shrink-0" />
            <span>Successfully imported {successCount} transaction(s)!</span>
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-slate-300 mb-1.5 flex items-center gap-1.5">
            <FileText size={14} className="text-slate-400" />
            <span>Paste CSV lines or JSON array:</span>
          </label>
          <textarea
            rows={7}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder={`YYYY-MM-DD, Amount, Category, Reason\n2025-05-10, 450, Food & Dining, Supermarket groceries\n2025-05-11, 1200, Utilities, Electricity Bill\n\nOr JSON: [{"date": "2025-05-10", "amount": 450, "category": "Food", "reason": "Snacks"}]`}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-slate-200 font-mono focus:outline-none focus:border-emerald-500 resize-none"
          />
        </div>

        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 text-xs font-semibold cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleImport}
            className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-sm"
          >
            <Upload size={14} />
            <span>Process Import</span>
          </button>
        </div>
      </div>
    </Modal>
  );
};
