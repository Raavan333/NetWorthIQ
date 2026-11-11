import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { Receivable } from '../../types';
import { formatMoney } from '../../lib/formatters';
import { isSpendableLiquidHolding, formatAssetOptionLabel } from '../../lib/assetRules';
import {
  groupReceivablesByCounterparty,
  calculateAccruedInterest,
  isActiveCounterpartyRecord,
} from '../../lib/counterpartyEngine';
import { AddEditReceivableModal } from './AddEditReceivableModal';
import { RecordRepaymentModal } from './RecordRepaymentModal';
import { PayBillForCounterpartyModal } from './PayBillForCounterpartyModal';
import { CounterpartyPaidMyBillModal } from './CounterpartyPaidMyBillModal';
import {
  HandCoins,
  Plus,
  Receipt,
  Handshake,
  ArrowRightLeft,
  AlertTriangle,
  CheckCircle2,
  Edit2,
  Trash2,
  FileX,
  Users,
  ListFilter,
  ChevronDown,
  ChevronUp,
  X,
  Landmark,
} from 'lucide-react';

export const ReceivablesManager: React.FC = () => {
  const {
    receivables,
    holdings,
    assetTypes,
    deleteReceivable,
    writeOffReceivable,
    offsetCounterparty,
    repayBorrowedCounterparty,
    currencies,
    settings,
  } = useApp();

  const [activeModal, setActiveModal] = useState<
    'add' | 'edit' | 'repay' | 'pay_bill' | 'they_paid_bill' | 'repay_peer' | null
  >(null);
  const [selectedReceivable, setSelectedReceivable] = useState<Receivable | null>(null);
  const [selectedDebtorName, setSelectedDebtorName] = useState<string>('');
  const [repayPeerAmount, setRepayPeerAmount] = useState<number | ''>('');
  const [repayPeerSourceId, setRepayPeerSourceId] = useState<string>('');
  const [repayPeerError, setRepayPeerError] = useState<string | null>(null);
  const [isRepayingPeer, setIsRepayingPeer] = useState(false);

  const [viewMode, setViewMode] = useState<'grouped' | 'flat'>('grouped');
  const [expandedPerson, setExpandedPerson] = useState<string | null>(null);
  const [offsetNotice, setOffsetNotice] = useState<string | null>(null);

  const todayStr = new Date().toISOString().split('T')[0];

  const getSymbol = (code: string) => currencies.find((c) => c.code === code)?.symbol || '₹';
  const fmt = (amt: number, code: string = settings.baseCurrency, dec: number = 0) =>
    formatMoney(amt, code, getSymbol(code), settings.numberGrouping, dec);

  const spendableHoldings = useMemo(
    () => holdings.filter((h) => isSpendableLiquidHolding(h, assetTypes)),
    [holdings, assetTypes]
  );

  // Group strictly active counterparties; settled (0-balance) items stay archived out of sight in frontend
  const groupedCounterparties = useMemo(
    () => groupReceivablesByCounterparty(receivables),
    [receivables]
  );

  const activeGrouped = useMemo(
    () =>
      groupedCounterparties.filter(
        (g) => g.status === 'active' && Math.abs(g.netBalance) > 0.01
      ),
    [groupedCounterparties]
  );

  const activeFlat = useMemo(
    () => receivables.filter((r) => isActiveCounterpartyRecord(r)),
    [receivables]
  );

  const totalOwedToYou = useMemo(
    () =>
      activeGrouped
        .filter((g) => g.netBalance > 0)
        .reduce((sum, g) => sum + g.netBalance, 0),
    [activeGrouped]
  );

  const totalYouOwe = useMemo(
    () =>
      activeGrouped
        .filter((g) => g.netBalance < 0)
        .reduce((sum, g) => sum + Math.abs(g.netBalance), 0),
    [activeGrouped]
  );

  const netPosition = totalOwedToYou - totalYouOwe;

  const handleQuickOffset = async (name: string) => {
    const res = await offsetCounterparty(name);
    if (res.success && res.offsetAmount > 0) {
      setOffsetNotice(
        `Offset ${fmt(res.offsetAmount)} with ${name}. Settled obligations have been archived.`
      );
      setTimeout(() => setOffsetNotice(null), 4500);
    }
  };

  const openRepayPeerModal = (name: string, owedAmount: number) => {
    setSelectedDebtorName(name);
    setRepayPeerAmount(Math.round(owedAmount * 100) / 100);
    const defaultAcc =
      spendableHoldings.find((h) => (h.principalOrValue || 0) >= owedAmount)?.id ||
      spendableHoldings[0]?.id ||
      '';
    setRepayPeerSourceId(defaultAcc);
    setRepayPeerError(null);
    setActiveModal('repay_peer');
  };

  const handleConfirmRepayPeer = async (e: React.FormEvent) => {
    e.preventDefault();
    const numAmt = Number(repayPeerAmount);
    if (!numAmt || numAmt <= 0) {
      setRepayPeerError('Enter a valid amount to pay back.');
      return;
    }
    if (!repayPeerSourceId) {
      setRepayPeerError('Select a bank or cash account.');
      return;
    }
    setIsRepayingPeer(true);
    setRepayPeerError(null);
    const res = await repayBorrowedCounterparty(
      selectedDebtorName,
      numAmt,
      repayPeerSourceId
    );
    setIsRepayingPeer(false);
    if (!res.success) {
      setRepayPeerError(res.error || 'Could not complete settlement.');
      return;
    }
    setActiveModal(null);
    setOffsetNotice(
      `Paid ${fmt(numAmt)} to ${selectedDebtorName}. Settled balances and linked bills are archived.`
    );
    setTimeout(() => setOffsetNotice(null), 4500);
  };

  return (
    <div className="rounded-xl bg-slate-900/90 border border-slate-800 p-4 space-y-3.5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 shrink-0">
            <HandCoins size={16} />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-slate-200">
              Receivables &amp; Shared Settlements
            </h3>
            <p className="text-[11px] text-slate-400">
              Grouped by person and interest rate · Settled balances archive automatically
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              setSelectedDebtorName('');
              setActiveModal('pay_bill');
            }}
            className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            title="Pay a bill for someone else to offset what you owe or add to what they owe you"
          >
            <Receipt size={13} className="text-emerald-400" />
            <span>Pay Bill for Someone</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setSelectedDebtorName('');
              setActiveModal('they_paid_bill');
            }}
            className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            title="Record a bill someone paid on your behalf"
          >
            <Handshake size={13} className="text-cyan-400" />
            <span>They Paid My Bill</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setSelectedReceivable(null);
              setActiveModal('add');
            }}
            className="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <Plus size={13} />
            <span>Lend Money</span>
          </button>
        </div>
      </div>

      {offsetNotice && (
        <div className="p-2.5 rounded-lg bg-emerald-950/35 border border-emerald-500/35 text-emerald-300 text-xs flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={14} className="shrink-0" />
            <span>{offsetNotice}</span>
          </div>
          <button
            type="button"
            onClick={() => setOffsetNotice(null)}
            className="text-emerald-400 hover:text-emerald-200 text-xs cursor-pointer"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Aggregate Overview */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
        <div className="p-2.5 rounded-lg bg-slate-800/40 border border-slate-800">
          <div className="text-[10px] text-slate-400 uppercase tracking-wider">Owed to You</div>
          <div className="text-sm font-bold text-emerald-400 font-mono tabular-nums mt-0.5">
            {fmt(totalOwedToYou)}
          </div>
        </div>

        <div className="p-2.5 rounded-lg bg-slate-800/40 border border-slate-800">
          <div className="text-[10px] text-slate-400 uppercase tracking-wider">You Owe Others</div>
          <div className="text-sm font-bold text-amber-400 font-mono tabular-nums mt-0.5">
            {fmt(totalYouOwe)}
          </div>
        </div>

        <div className="p-2.5 rounded-lg bg-slate-800/40 border border-slate-800">
          <div className="text-[10px] text-slate-400 uppercase tracking-wider">Net Peer Balance</div>
          <div
            className={`text-sm font-bold font-mono tabular-nums mt-0.5 ${
              netPosition >= 0 ? 'text-slate-100' : 'text-amber-300'
            }`}
          >
            {netPosition < 0 ? `-${fmt(Math.abs(netPosition))}` : fmt(netPosition)}
          </div>
        </div>
      </div>

      {/* View Mode Bar */}
      <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-800/60 text-xs">
        <span className="text-[11px] text-slate-400">
          {activeGrouped.length} active {activeGrouped.length === 1 ? 'person' : 'people'}
        </span>

        <div className="flex items-center gap-1 bg-slate-950 p-0.5 rounded-lg border border-slate-800">
          <button
            type="button"
            onClick={() => setViewMode('grouped')}
            className={`px-2.5 py-1 rounded-md text-[11px] font-medium flex items-center gap-1 transition-colors cursor-pointer ${
              viewMode === 'grouped'
                ? 'bg-slate-800 text-slate-100 font-semibold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Users size={12} />
            <span>By Person</span>
          </button>
          <button
            type="button"
            onClick={() => setViewMode('flat')}
            className={`px-2.5 py-1 rounded-md text-[11px] font-medium flex items-center gap-1 transition-colors cursor-pointer ${
              viewMode === 'flat'
                ? 'bg-slate-800 text-slate-100 font-semibold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <ListFilter size={12} />
            <span>All Entries</span>
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      {viewMode === 'grouped' ? (
        activeGrouped.length === 0 ? (
          <div className="p-5 text-center text-xs text-slate-500 rounded-lg bg-slate-950/40 border border-slate-800/80">
            No active peer balances. Settled items are archived and included in file exports.
          </div>
        ) : (
          <div className="space-y-2.5">
            {activeGrouped.map((person) => {
              const isExpanded = expandedPerson === person.name;
              const hasMutualDebts =
                person.totalPrincipalOwedToUser > 0.01 && person.totalPrincipalUserOwes > 0.01;
              const netOwedToUser = person.netBalance > 0;
              const activeRecords = person.records.filter((r) => isActiveCounterpartyRecord(r));
              const primaryLentRecord = activeRecords.find(
                (r) => (r.direction || 'lent') === 'lent'
              );

              return (
                <div
                  key={person.name}
                  className={`rounded-xl border transition-colors overflow-hidden ${
                    netOwedToUser
                      ? 'bg-slate-950/45 border-slate-800 hover:border-slate-700'
                      : 'bg-slate-950/45 border-amber-900/40 hover:border-amber-800/60'
                  }`}
                >
                  {/* Person Summary Row */}
                  <div className="p-3 flex items-start sm:items-center justify-between gap-2.5 sm:gap-3">
                    <div className="flex items-start sm:items-center gap-2.5 min-w-0 flex-1 overflow-hidden">
                      <div
                        className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 mt-0.5 sm:mt-0 ${
                          netOwedToUser
                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/25'
                            : 'bg-amber-500/10 text-amber-300 border border-amber-500/25'
                        }`}
                      >
                        {person.name.slice(0, 1).toUpperCase()}
                      </div>

                      <div className="min-w-0 flex-1 overflow-hidden">
                        <div className="flex flex-wrap items-center gap-1.5 text-xs">
                          <span className="font-semibold text-slate-100 text-sm truncate max-w-[120px] xs:max-w-[180px] sm:max-w-none">
                            {person.name}
                          </span>
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider shrink-0 ${
                              netOwedToUser
                                ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-800/40'
                                : 'bg-amber-950/60 text-amber-300 border border-amber-800/40'
                            }`}
                          >
                            {netOwedToUser ? 'Owes you' : 'You owe'}
                          </span>
                          <span className="text-[10px] text-slate-400 font-medium bg-slate-800/80 px-1.5 py-0.5 rounded shrink-0">
                            {activeRecords.length} {activeRecords.length === 1 ? 'entry' : 'entries'}
                          </span>
                        </div>

                        {/* Interest-Rate Summed Buckets */}
                        {person.rateBuckets.length > 0 && (
                          <div className="text-[11px] text-slate-400 flex flex-wrap items-center gap-1.5 mt-1 font-mono tabular-nums overflow-hidden max-w-full">
                            {person.rateBuckets.map((bucket, idx) => (
                              <span
                                key={`${bucket.direction}-${bucket.interestRatePct}`}
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800/80 text-[10px] text-slate-300 font-mono break-all xs:break-normal max-w-full"
                              >
                                {bucket.interestRatePct > 0
                                  ? `${bucket.interestRatePct}% p.a.: ${fmt(bucket.totalWithInterest)}${
                                      bucket.accruedInterest > 0
                                        ? ` (+${fmt(bucket.accruedInterest)} int)`
                                        : ''
                                    }`
                                  : `0% rate: ${fmt(bucket.principalTotal)}`}
                                {bucket.count > 1 ? ` (${bucket.count} summed)` : ''}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 sm:gap-2.5 shrink-0 ml-auto">
                      <div className="text-right shrink-0">
                        <div className="text-[10px] text-slate-400 uppercase tracking-wider whitespace-nowrap">
                          Net Balance
                        </div>
                        <div
                          className={`text-sm sm:text-base font-bold font-mono tabular-nums whitespace-nowrap ${
                            netOwedToUser ? 'text-emerald-400' : 'text-amber-400'
                          }`}
                        >
                          {fmt(Math.abs(person.netBalance))}
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => setExpandedPerson(isExpanded ? null : person.name)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
                        title={isExpanded ? 'Hide entries' : 'Show entries'}
                      >
                        {isExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                      </button>
                    </div>
                  </div>

                  {/* Understated Action Bar */}
                  <div className="px-3 py-2 bg-slate-900/60 border-t border-slate-800/60 flex flex-wrap items-center justify-between gap-1.5 sm:gap-2 text-xs">
                    <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar max-w-full py-0.5">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedDebtorName(person.name);
                          setActiveModal('pay_bill');
                        }}
                        className="px-2 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-medium flex items-center gap-1 cursor-pointer transition-colors whitespace-nowrap"
                      >
                        <Receipt size={12} className="text-emerald-400" />
                        <span>Pay Their Bill</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setSelectedDebtorName(person.name);
                          setActiveModal('they_paid_bill');
                        }}
                        className="px-2 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-medium flex items-center gap-1 cursor-pointer transition-colors whitespace-nowrap"
                      >
                        <Handshake size={12} className="text-cyan-400" />
                        <span>They Paid Mine</span>
                      </button>

                      {hasMutualDebts && (
                        <button
                          type="button"
                          onClick={() => handleQuickOffset(person.name)}
                          className="px-2 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-cyan-300 text-[11px] font-semibold flex items-center gap-1 cursor-pointer transition-colors whitespace-nowrap"
                        >
                          <ArrowRightLeft size={12} />
                          <span>Offset</span>
                        </button>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5">
                      {netOwedToUser && primaryLentRecord && (
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedReceivable(primaryLentRecord);
                            setActiveModal('repay');
                          }}
                          className="px-2.5 py-1 rounded-md bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 text-[11px] font-semibold cursor-pointer transition-colors whitespace-nowrap"
                        >
                          Collect
                        </button>
                      )}

                      {!netOwedToUser && (
                        <button
                          type="button"
                          onClick={() =>
                            openRepayPeerModal(person.name, Math.abs(person.netBalance))
                          }
                          className="px-2.5 py-1 rounded-md bg-amber-600/20 hover:bg-amber-600/30 text-amber-200 text-[11px] font-semibold cursor-pointer transition-colors whitespace-nowrap"
                        >
                          Pay Back
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => {
                          setSelectedReceivable({
                            id: '',
                            debtorName: person.name,
                            currency: settings.baseCurrency,
                            principalAmount: 0,
                            outstandingAmount: 0,
                            issueDate: todayStr,
                            confidencePct: 90,
                            status: 'active',
                            repayments: [],
                          });
                          setActiveModal('add');
                        }}
                        className="px-2 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-medium flex items-center gap-1 cursor-pointer transition-colors whitespace-nowrap"
                      >
                        <Plus size={11} />
                        <span>Lend</span>
                      </button>
                    </div>
                  </div>

                  {/* Expandable Active Entries Breakdown */}
                  {isExpanded && (
                    <div className="p-3 border-t border-slate-800/80 bg-slate-950/60 space-y-1.5">
                      {activeRecords.map((rec) => {
                        const accrued = calculateAccruedInterest(rec);
                        const isRecOverdue = Boolean(rec.expectedDate && rec.expectedDate < todayStr);
                        const isBorrow = rec.direction === 'borrowed';

                        return (
                          <div
                            key={rec.id}
                            className="p-2.5 rounded-lg bg-slate-900 border border-slate-800/80 flex flex-col xs:flex-row xs:items-center justify-between gap-2 text-xs overflow-hidden"
                          >
                            <div className="min-w-0 flex-1 overflow-hidden">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span
                                  className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider shrink-0 ${
                                    isBorrow
                                      ? 'bg-amber-950/60 text-amber-300 border border-amber-800/40'
                                      : 'bg-emerald-950/60 text-emerald-400 border border-emerald-800/40'
                                  }`}
                                >
                                  {isBorrow ? 'Borrowed' : 'Lent'}
                                </span>
                                <span className="text-[11px] text-slate-300 truncate max-w-[150px] xs:max-w-[200px] sm:max-w-none">
                                  {rec.notes || (isBorrow ? 'Shared bill balance' : 'Direct loan')}
                                </span>
                                {isRecOverdue && (
                                  <span className="text-[10px] text-rose-400 font-semibold bg-rose-950/50 border border-rose-800/40 px-1.5 py-0.5 rounded inline-flex items-center gap-0.5 shrink-0">
                                    <AlertTriangle size={10} /> Overdue
                                  </span>
                                )}
                              </div>

                              <div className="text-[10px] text-slate-500 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 mt-1 font-mono tabular-nums overflow-hidden max-w-full">
                                <span>{rec.issueDate}</span>
                                {rec.expectedDate && <span>· Due {rec.expectedDate}</span>}
                                <span>
                                  ·{' '}
                                  {rec.interestRatePct && rec.interestRatePct > 0
                                    ? `${rec.interestRatePct}% p.a.${
                                        accrued > 0 ? ` (+${fmt(accrued)} int)` : ''
                                      }`
                                    : '0% rate'}
                                </span>
                              </div>
                            </div>

                            <div className="flex items-center justify-between xs:justify-end gap-1.5 shrink-0 pt-1 xs:pt-0 border-t xs:border-t-0 border-slate-800/60">
                              <div className="text-left xs:text-right font-mono tabular-nums mr-1">
                                <div className="font-bold text-slate-200">
                                  {fmt(rec.outstandingAmount + accrued, rec.currency)}
                                </div>
                                {rec.principalAmount !== rec.outstandingAmount && (
                                  <div className="text-[10px] text-slate-500">
                                    of {fmt(rec.principalAmount, rec.currency)}
                                  </div>
                                )}
                              </div>

                              {!isBorrow ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedReceivable(rec);
                                    setActiveModal('repay');
                                  }}
                                  className="px-2 py-1 rounded bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 text-[11px] font-semibold cursor-pointer"
                                >
                                  Collect
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() =>
                                    openRepayPeerModal(rec.debtorName, rec.outstandingAmount + accrued)
                                  }
                                  className="px-2 py-1 rounded bg-amber-600/20 hover:bg-amber-600/30 text-amber-200 text-[11px] font-semibold cursor-pointer"
                                >
                                  Pay Back
                                </button>
                              )}

                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedReceivable(rec);
                                  setActiveModal('edit');
                                }}
                                className="p-1 rounded text-slate-400 hover:text-slate-200 cursor-pointer"
                                title="Edit"
                              >
                                <Edit2 size={12} />
                              </button>

                              <button
                                type="button"
                                onClick={() => deleteReceivable(rec.id)}
                                className="p-1 rounded text-slate-400 hover:text-rose-400 cursor-pointer"
                                title="Delete"
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )
      ) : activeFlat.length === 0 ? (
        <div className="p-4 text-center text-xs text-slate-500 rounded-lg bg-slate-950/40 border border-slate-800/80">
          No active entries recorded.
        </div>
      ) : (
        <div className="space-y-2">
          {activeFlat.map((rec) => {
            const isOverdue = Boolean(rec.expectedDate && rec.expectedDate < todayStr);
            const isBorrow = rec.direction === 'borrowed';
            const accrued = calculateAccruedInterest(rec);

            return (
              <div
                key={rec.id}
                className={`p-3 rounded-lg border transition-colors overflow-hidden ${
                  isOverdue
                    ? 'bg-rose-950/15 border-rose-600/30'
                    : 'bg-slate-950/45 border-slate-800'
                } space-y-2`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1 overflow-hidden">
                    <div className="flex flex-wrap items-center gap-1.5 text-xs">
                      <span className="font-semibold text-slate-100 text-sm truncate max-w-[130px] xs:max-w-[200px] sm:max-w-none">
                        {rec.debtorName}
                      </span>
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider shrink-0 ${
                          isBorrow
                            ? 'bg-amber-950/60 text-amber-300 border border-amber-800/40'
                            : 'bg-emerald-950/60 text-emerald-400 border border-emerald-800/40'
                        }`}
                      >
                        {isBorrow ? 'You owe' : 'Owes you'}
                      </span>
                      {isOverdue && (
                        <span className="text-[10px] text-rose-400 font-semibold bg-rose-950/50 border border-rose-800/40 px-1.5 py-0.5 rounded inline-flex items-center gap-0.5 shrink-0">
                          <AlertTriangle size={10} /> Overdue
                        </span>
                      )}
                    </div>

                    <div className="text-[10px] text-slate-400 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 mt-1 font-mono tabular-nums overflow-hidden max-w-full">
                      <span>{rec.issueDate}</span>
                      {rec.expectedDate && <span>· Due {rec.expectedDate}</span>}
                      <span>
                        ·{' '}
                        {rec.interestRatePct && rec.interestRatePct > 0
                          ? `${rec.interestRatePct}% p.a.${
                              accrued > 0 ? ` (+${fmt(accrued)} int)` : ''
                            }`
                          : '0% rate'}
                      </span>
                    </div>
                  </div>

                  <div className="text-right shrink-0 ml-auto font-mono tabular-nums">
                    <div className="text-sm font-bold text-slate-100">
                      {fmt(rec.outstandingAmount + accrued, rec.currency)}
                    </div>
                    <div className="text-[10px] text-slate-500">
                      of {fmt(rec.principalAmount, rec.currency)}
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-1.5 border-t border-slate-800/60 text-xs">
                  <div className="text-[11px] text-slate-500 min-w-0 truncate">
                    {rec.notes || (isBorrow ? 'Shared bill balance' : 'Direct loan')}
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5 ml-auto">
                    {!isBorrow ? (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedReceivable(rec);
                          setActiveModal('repay');
                        }}
                        className="px-2 py-1 rounded bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 font-semibold text-[11px] cursor-pointer"
                      >
                        Collect
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() =>
                          openRepayPeerModal(rec.debtorName, rec.outstandingAmount + accrued)
                        }
                        className="px-2 py-1 rounded bg-amber-600/20 hover:bg-amber-600/30 text-amber-200 font-semibold text-[11px] cursor-pointer"
                      >
                        Pay Back
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        setSelectedReceivable(rec);
                        setActiveModal('edit');
                      }}
                      className="w-7 h-7 rounded-lg flex items-center justify-center bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700/80 cursor-pointer"
                      title="Edit"
                    >
                      <Edit2 size={13} />
                    </button>

                    {!isBorrow && (
                      <button
                        type="button"
                        onClick={() => writeOffReceivable(rec.id, 'Uncollectible debt')}
                        className="w-7 h-7 rounded-lg flex items-center justify-center bg-slate-800/80 hover:bg-amber-950/40 text-slate-300 hover:text-amber-400 border border-slate-700/80 cursor-pointer"
                        title="Write off"
                      >
                        <FileX size={13} />
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => deleteReceivable(rec.id)}
                      className="w-7 h-7 rounded-lg flex items-center justify-center bg-slate-800/80 hover:bg-rose-950/40 text-slate-300 hover:text-rose-400 border border-slate-700/80 cursor-pointer"
                      title="Delete"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pay Back Borrowed Peer Modal */}
      {activeModal === 'repay_peer' && selectedDebtorName && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs">
          <div className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-xl shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-slate-800">
              <div>
                <h2 className="text-sm font-semibold text-slate-100">
                  Pay Back {selectedDebtorName}
                </h2>
                <p className="text-[11px] text-slate-400">
                  Clears what you owe and archives settled items
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveModal(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleConfirmRepayPeer} className="p-4 space-y-3 text-xs">
              {repayPeerError && (
                <div className="p-2.5 rounded-lg bg-rose-950/40 border border-rose-500/30 text-rose-300">
                  {repayPeerError}
                </div>
              )}

              <div className="space-y-1">
                <label className="block text-[11px] font-medium text-slate-400">Amount</label>
                <input
                  type="number"
                  required
                  min="0.01"
                  step="any"
                  value={repayPeerAmount}
                  onChange={(e) =>
                    setRepayPeerAmount(e.target.value === '' ? '' : Number(e.target.value))
                  }
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 font-mono tabular-nums focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="space-y-1">
                <label className="block text-[11px] font-medium text-slate-400 flex items-center gap-1">
                  <Landmark size={12} className="text-cyan-400" />
                  <span>Pay From Liquid Account</span>
                </label>
                <select
                  value={repayPeerSourceId}
                  onChange={(e) => setRepayPeerSourceId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
                >
                  {spendableHoldings.map((h) => (
                    <option key={h.id} value={h.id}>
                      {formatAssetOptionLabel(h, assetTypes)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setActiveModal(null)}
                  className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isRepayingPeer}
                  className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold cursor-pointer disabled:opacity-50"
                >
                  {isRepayingPeer ? 'Settling...' : 'Confirm Payment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Existing Modals */}
      {activeModal === 'add' && (
        <AddEditReceivableModal
          receivable={
            selectedReceivable && selectedReceivable.id
              ? selectedReceivable
              : selectedReceivable?.debtorName
              ? undefined
              : undefined
          }
          initialDebtorName={selectedReceivable?.debtorName}
          onClose={() => {
            setActiveModal(null);
            setSelectedReceivable(null);
          }}
        />
      )}
      {activeModal === 'edit' && selectedReceivable && (
        <AddEditReceivableModal
          receivable={selectedReceivable}
          onClose={() => {
            setActiveModal(null);
            setSelectedReceivable(null);
          }}
        />
      )}
      {activeModal === 'repay' && selectedReceivable && (
        <RecordRepaymentModal
          receivable={selectedReceivable}
          onClose={() => {
            setActiveModal(null);
            setSelectedReceivable(null);
          }}
        />
      )}
      {activeModal === 'pay_bill' && (
        <PayBillForCounterpartyModal
          initialDebtorName={selectedDebtorName}
          onClose={() => {
            setActiveModal(null);
            setSelectedDebtorName('');
          }}
        />
      )}
      {activeModal === 'they_paid_bill' && (
        <CounterpartyPaidMyBillModal
          initialDebtorName={selectedDebtorName}
          onClose={() => {
            setActiveModal(null);
            setSelectedDebtorName('');
          }}
        />
      )}
    </div>
  );
};
