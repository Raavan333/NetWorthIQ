import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { FinancialNotification } from '../../types';
import {
  Bell,
  AlertTriangle,
  Info,
  Calendar,
  ArrowRight,
  CheckCircle2,
  CheckCheck,
  X,
  Sparkles,
  ShieldAlert,
  ShieldCheck,
  Repeat,
  Clock,
} from 'lucide-react';
import { formatMoney } from '../../lib/formatters';

interface NotificationCenterModalProps {
  onClose: () => void;
}

export const NotificationCenterModal: React.FC<NotificationCenterModalProps> = ({ onClose }) => {
  const {
    notifications,
    dismissNotification,
    markAllNotificationsAsRead,
    readNotificationIds,
    setActiveTab,
    setActiveModal,
    settings,
    currencies,
  } = useApp();

  const [filter, setFilter] = useState<'all' | 'conflicts' | 'critical' | 'info'>('all');

  const baseCurr = settings.baseCurrency || 'INR';
  const currSym = currencies.find((c) => c.code === baseCurr)?.symbol || '₹';

  const filteredNotifications = notifications.filter((n) => {
    if (filter === 'conflicts') return n.type === 'obligation_conflict';
    if (filter === 'critical') return n.severity === 'critical';
    if (filter === 'info')
      return (
        n.severity === 'info' ||
        n.type === 'goal_ready' ||
        n.type === 'positive_milestone'
      );
    return true;
  });

  const unreadCount = notifications.filter((n) => !readNotificationIds[n.id]).length;
  const criticalCount = notifications.filter((n) => n.severity === 'critical').length;

  const handleActionClick = (n: FinancialNotification) => {
    if (n.actionTab) {
      setActiveTab(n.actionTab);
    }
    if (n.actionModal && n.actionModal !== 'notifications') {
      setActiveModal(n.actionModal);
    } else {
      onClose();
    }
  };

  return (
    <div className="space-y-4">
      {/* Header Controls */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 pb-2 border-b border-slate-800">
        <div className="flex items-center gap-2.5">
          <div className="relative p-2 rounded-xl bg-slate-800/80 text-cyan-400 border border-slate-700/60">
            <Bell size={18} />
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 px-1.5 py-0.2 rounded-md bg-rose-500 text-white text-[10px] font-bold font-mono tabular-nums">
                {unreadCount}
              </span>
            )}
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-semibold text-slate-100">
                Alerts &amp; Progress Updates
              </h3>
              {criticalCount > 0 && (
                <>
                  <span className="text-slate-600" aria-hidden="true">·</span>
                  <span className="text-rose-400 text-xs font-semibold">
                    {criticalCount} need action
                  </span>
                </>
              )}
            </div>
            <p className="text-xs text-slate-400">
              Clear updates on what is going well and what needs your attention
            </p>
          </div>
        </div>

        {unreadCount > 0 && (
          <button
            type="button"
            onClick={markAllNotificationsAsRead}
            className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer border border-slate-700/80 whitespace-nowrap shrink-0"
          >
            <CheckCheck size={14} className="text-emerald-400" />
            <span>Mark all read</span>
          </button>
        )}
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
        <button
          type="button"
          onClick={() => setFilter('all')}
          className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer shrink-0 whitespace-nowrap ${
            filter === 'all'
              ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
              : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200'
          }`}
        >
          All ({notifications.length})
        </button>
        <button
          type="button"
          onClick={() => setFilter('critical')}
          className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer shrink-0 whitespace-nowrap ${
            filter === 'critical'
              ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
              : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200'
          }`}
        >
          Action Needed ({criticalCount})
        </button>
        <button
          type="button"
          onClick={() => setFilter('conflicts')}
          className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer shrink-0 whitespace-nowrap ${
            filter === 'conflicts'
              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
              : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200'
          }`}
        >
          Cash Shortfalls ({notifications.filter((n) => n.type === 'obligation_conflict').length})
        </button>
        <button
          type="button"
          onClick={() => setFilter('info')}
          className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer shrink-0 whitespace-nowrap ${
            filter === 'info'
              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
              : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200'
          }`}
        >
          Wins &amp; Goals
        </button>
      </div>

      {/* Notifications List */}
      <div className="space-y-3 max-h-[62vh] overflow-y-auto pr-1">
        {filteredNotifications.length === 0 ? (
          <div className="py-12 px-4 text-center rounded-2xl bg-slate-900/60 border border-slate-800/80 flex flex-col items-center justify-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center">
              <ShieldCheck size={28} />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-200">Everything Looks Good</p>
              <p className="text-xs text-slate-400 max-w-sm mt-1">
                No urgent bills, cash shortfalls, or pending alerts in this view.
              </p>
            </div>
          </div>
        ) : (
          filteredNotifications.map((n) => {
            const isRead = Boolean(readNotificationIds[n.id]);
            const isPositive = n.type === 'positive_milestone' || n.type === 'goal_ready';
            const willResurface = Boolean(n.requiresAction || n.severity === 'critical');

            return (
              <div
                key={n.id}
                className={`p-3.5 rounded-xl border transition-all ${
                  n.severity === 'critical'
                    ? 'bg-rose-950/25 border-rose-500/40 shadow-xs'
                    : n.severity === 'warning'
                    ? 'bg-amber-950/20 border-amber-500/35'
                    : isPositive
                    ? 'bg-emerald-950/15 border-emerald-500/35'
                    : 'bg-slate-900/80 border-slate-800 hover:border-slate-700'
                } ${isRead ? 'opacity-90' : ''}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2.5 min-w-0">
                    <div
                      className={`p-2 rounded-lg shrink-0 mt-0.5 ${
                        n.severity === 'critical'
                          ? 'bg-rose-500/20 text-rose-400'
                          : n.severity === 'warning'
                          ? 'bg-amber-500/20 text-amber-400'
                          : isPositive
                          ? 'bg-emerald-500/20 text-emerald-400'
                          : 'bg-cyan-500/20 text-cyan-400'
                      }`}
                    >
                      {n.severity === 'critical' ? (
                        <ShieldAlert size={18} />
                      ) : n.severity === 'warning' ? (
                        <AlertTriangle size={18} />
                      ) : isPositive ? (
                        <CheckCircle2 size={18} />
                      ) : (
                        <Info size={18} />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm text-slate-100">{n.title}</span>
                        {n.severity === 'critical' && (
                          <>
                            <span className="text-slate-600" aria-hidden="true">·</span>
                            <span className="text-rose-400 text-[11px] font-semibold">
                              Action needed
                            </span>
                          </>
                        )}
                        {isPositive && (
                          <>
                            <span className="text-slate-600" aria-hidden="true">·</span>
                            <span className="text-emerald-400 text-[11px] font-semibold">
                              Good progress
                            </span>
                          </>
                        )}
                        {!isRead && (
                          <span className="w-2 h-2 rounded-full bg-cyan-400" title="Unread" />
                        )}
                      </div>
                      <p className="text-xs text-slate-300 mt-1 leading-relaxed">{n.message}</p>

                      {/* Detailed Obligation Conflict Card */}
                      {n.conflictDetails && (
                        <div className="mt-2.5 p-2.5 rounded-lg bg-slate-950/70 border border-slate-800 text-xs space-y-2">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                            <div className="p-2 rounded-md bg-slate-900/80 border border-slate-800/80">
                              <span className="text-slate-400 flex items-center gap-1">
                                <Calendar size={12} className="text-indigo-400" /> Upcoming Bill
                              </span>
                              <span className="font-semibold text-slate-100 block mt-0.5">
                                {n.conflictDetails.obligationName}
                              </span>
                              <span className="text-rose-300 font-mono tabular-nums font-medium">
                                {formatMoney(n.conflictDetails.obligationAmount, baseCurr, currSym)} · Due {n.conflictDetails.obligationDate}
                              </span>
                            </div>

                            <div className="p-2 rounded-md bg-slate-900/80 border border-slate-800/80">
                              <span className="text-slate-400 flex items-center gap-1">
                                <Repeat size={12} className="text-amber-400" /> Cash Gap
                              </span>
                              <span className="font-semibold text-slate-100 block mt-0.5">
                                {n.conflictDetails.conflictingPlanName || 'Available Bank Cash'}
                              </span>
                              <span className="text-amber-300 font-mono tabular-nums font-medium">
                                Short by {formatMoney(n.conflictDetails.shortfallAmount, baseCurr, currSym)}
                              </span>
                            </div>
                          </div>

                          {n.conflictDetails.recommendedMitigation && (
                            <div className="p-2 rounded-md bg-indigo-950/40 border border-indigo-500/30 text-indigo-200 flex items-start gap-2 text-[11px]">
                              <Sparkles size={14} className="text-indigo-400 shrink-0 mt-0.5" />
                              <span>{n.conflictDetails.recommendedMitigation}</span>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Action & Dismiss Buttons */}
                      <div className="flex items-center gap-2 mt-3 pt-2 border-t border-slate-800/70">
                        {n.actionLabel && (
                          <button
                            type="button"
                            onClick={() => handleActionClick(n)}
                            className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
                          >
                            <span>{n.actionLabel}</span>
                            <ArrowRight size={13} />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => dismissNotification(n.id)}
                          className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 text-xs font-medium flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap"
                          title={
                            willResurface
                              ? 'Snoozes for 24 hours and resurfaces only if still unresolved'
                              : 'Clears permanently'
                          }
                        >
                          {willResurface && <Clock size={12} />}
                          <span>{willResurface ? 'Remind Later' : 'Clear'}</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => dismissNotification(n.id)}
                    className="p-1 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
                    title={
                      willResurface
                        ? 'Remind me later if still unresolved'
                        : 'Clear notification'
                    }
                  >
                    <X size={15} />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
