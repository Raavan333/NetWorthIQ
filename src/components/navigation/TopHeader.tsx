import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { THEME_PRESETS } from '../../lib/defaults';
import {
  Target,
  Briefcase,
  Receipt,
  Gift,
  Settings as SettingsIcon,
  AlertTriangle,
  Bell,
  Menu,
  ChevronDown,
  Sparkles,
  Palette,
  Lock,
  LogOut,
} from 'lucide-react';

export const TopHeader: React.FC = () => {
  const {
    settings,
    engineResult,
    setActiveModal,
    attentionItems,
    theme,
    updateTheme,
    lockApp,
    logoutApp,
    notifications,
    readNotificationIds,
  } = useApp();
  const [menuOpen, setMenuOpen] = useState(false);

  const cycleTheme = () => {
    const currentIndex = THEME_PRESETS.findIndex((p) => p.id === theme.id);
    const nextIndex = (currentIndex + 1) % THEME_PRESETS.length;
    updateTheme(THEME_PRESETS[nextIndex]);
  };

  const hasCriticalAlert = engineResult.hasCardAlert || engineResult.isFreeCashAlert;
  const criticalCount = attentionItems.filter((i) => i.level === 'critical').length;

  return (
    <header className="sticky top-0 z-30 w-full border-b border-slate-800/80 bg-slate-950/80 backdrop-blur-md px-3 sm:px-4 py-2.5 sm:py-3">
      <div className="max-w-4xl mx-auto flex items-center justify-between gap-2">
        {/* Brand / Logo */}
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div
            className="w-7 h-7 sm:w-8 sm:h-8 rounded-xl flex items-center justify-center font-bold text-xs sm:text-sm text-slate-950 shadow-md transition-transform shrink-0"
            style={{ backgroundColor: settings.avatarColor || '#10b981' }}
          >
            {settings.profileName ? settings.profileName.charAt(0).toUpperCase() : 'N'}
          </div>
          <div className="min-w-0">
            <span className="font-bold text-sm sm:text-base tracking-tight text-slate-100 truncate block">
              {settings.appName || 'NetWorthIQ'}
            </span>
            <p className="text-[10px] sm:text-[11px] text-slate-400 leading-none truncate block mt-0.5">
              {settings.profileName ? `${settings.profileName}'s Portfolio` : 'Personal Net Worth'}
            </p>
          </div>
        </div>

        {/* Right Action Icons & Menu */}
        <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
          {/* Global Alert badge if cards due soon / overdue / low cash */}
          {hasCriticalAlert && (
            <button
              onClick={() => setActiveModal('needsAttention')}
              className={`p-2 rounded-xl flex items-center gap-1 text-xs font-semibold cursor-pointer border ${
                settings.reduceMotion ? 'bg-rose-500/20 border-rose-500/50 text-rose-400' : 'bg-rose-500/20 border-rose-500/60 text-rose-400 animate-pulse'
              }`}
              title="Attention Needed"
            >
              <AlertTriangle size={15} />
              <span className="hidden sm:inline">Alert</span>
              {criticalCount > 0 && (
                <span className="w-4 h-4 rounded-full bg-rose-500 text-white text-[10px] flex items-center justify-center font-bold">
                  {criticalCount}
                </span>
              )}
            </button>
          )}

          {/* Centralized Notification Bell with Unread & Conflict Badges */}
          <button
            onClick={() => setActiveModal('notifications')}
            className={`relative p-2 rounded-xl text-slate-300 hover:text-white hover:bg-slate-800 transition-colors flex items-center justify-center cursor-pointer border ${
              notifications.some((n) => n.severity === 'critical')
                ? 'border-rose-500/50 bg-rose-500/10 text-rose-300'
                : 'border-slate-800 bg-slate-900/60'
            }`}
            title="Notification Center & Obligation Conflicts"
          >
            <Bell size={16} />
            {notifications.filter((n) => !readNotificationIds[n.id]).length > 0 && (
              <span
                className={`absolute -top-1 -right-1 px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                  notifications.some((n) => n.severity === 'critical')
                    ? 'bg-rose-500 text-white animate-pulse'
                    : 'bg-cyan-500 text-slate-950'
                }`}
              >
                {notifications.filter((n) => !readNotificationIds[n.id]).length}
              </span>
            )}
          </button>

          {/* Quick desktop icons */}
          <div className="hidden sm:flex items-center gap-1">
            <button
              onClick={() => setActiveModal('goals')}
              className="p-2 rounded-xl text-slate-400 hover:text-slate-100 hover:bg-slate-850 hover:bg-slate-800 transition-colors flex items-center gap-1.5 text-xs font-medium cursor-pointer"
              title="Goals"
            >
              <Target size={16} />
              <span>Goals</span>
            </button>
            <button
              onClick={() => setActiveModal('income')}
              className="p-2 rounded-xl text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors flex items-center gap-1.5 text-xs font-medium cursor-pointer"
              title="Income & Salary"
            >
              <Briefcase size={16} />
              <span>Income</span>
            </button>
            <button
              onClick={() => setActiveModal('tax')}
              className="p-2 rounded-xl text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors flex items-center gap-1.5 text-xs font-medium cursor-pointer"
              title="Tax Module"
            >
              <Receipt size={16} />
              <span>Tax</span>
            </button>
            <button
              onClick={() => setActiveModal('settings')}
              className="p-2 rounded-xl text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors flex items-center gap-1.5 text-xs font-medium cursor-pointer"
              title="Settings"
            >
              <SettingsIcon size={16} />
              <span>Settings</span>
            </button>
            <button
              onClick={cycleTheme}
              className="p-2 rounded-xl text-slate-400 hover:text-emerald-400 hover:bg-slate-800 transition-colors flex items-center gap-1.5 text-xs font-medium cursor-pointer"
              title={`Current Theme: ${theme.name}. Click to switch theme.`}
            >
              <Palette size={16} style={{ color: theme.colors.primary }} />
              <span className="hidden md:inline">Theme</span>
            </button>
            <button
              onClick={logoutApp}
              className="p-2 rounded-xl text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition-colors flex items-center gap-1.5 text-xs font-medium cursor-pointer"
              title="Lock Vault & Log Out"
            >
              <LogOut size={16} />
              <span className="hidden lg:inline">Log Out</span>
            </button>
          </div>

          {/* Mobile Top Menu Button */}
          <div className="sm:hidden relative">
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 hover:text-white flex items-center gap-1 cursor-pointer"
              aria-label="Navigation menu"
            >
              <Menu size={18} />
              <ChevronDown size={14} className={`transition-transform ${menuOpen ? 'rotate-180' : ''}`} />
            </button>

            {menuOpen && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 top-11 z-30 w-52 bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-1.5 flex flex-col gap-1">
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      setActiveModal('receiveMoney');
                    }}
                    className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-semibold text-emerald-400 hover:text-emerald-300 hover:bg-slate-800 transition-colors cursor-pointer text-left"
                  >
                    <Gift size={17} className="text-emerald-400" />
                    <span>Receive Money / Gift</span>
                  </button>
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      setActiveModal('notifications');
                    }}
                    className="flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-medium text-slate-300 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer text-left"
                  >
                    <div className="flex items-center gap-2.5">
                      <Bell size={17} className="text-cyan-400" />
                      <span>Notifications</span>
                    </div>
                    {notifications.filter((n) => !readNotificationIds[n.id]).length > 0 && (
                      <span className="px-1.5 py-0.2 rounded-full bg-rose-500 text-white text-[10px] font-bold">
                        {notifications.filter((n) => !readNotificationIds[n.id]).length}
                      </span>
                    )}
                  </button>
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      setActiveModal('goals');
                    }}
                    className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium text-slate-300 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer text-left"
                  >
                    <Target size={17} className="text-emerald-400" />
                    <span>Goals</span>
                  </button>
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      setActiveModal('income');
                    }}
                    className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium text-slate-300 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer text-left"
                  >
                    <Briefcase size={17} className="text-cyan-400" />
                    <span>Income & Salary</span>
                  </button>
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      setActiveModal('tax');
                    }}
                    className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium text-slate-300 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer text-left"
                  >
                    <Receipt size={17} className="text-amber-400" />
                    <span>Capital Gains Tax</span>
                  </button>
                  <div className="h-px bg-slate-800 my-1" />
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      setActiveModal('settings');
                    }}
                    className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium text-slate-300 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer text-left"
                  >
                    <SettingsIcon size={17} className="text-slate-400" />
                    <span>Settings</span>
                  </button>
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      cycleTheme();
                    }}
                    className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium text-slate-300 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer text-left border-t border-slate-800/80 pt-2"
                  >
                    <Palette size={17} style={{ color: theme.colors.primary }} />
                    <span className="truncate">Theme: {theme.name.split(' ')[0]}</span>
                  </button>
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      logoutApp();
                    }}
                    className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium text-rose-300 hover:text-white hover:bg-rose-500/20 transition-colors cursor-pointer text-left border-t border-slate-800/80 pt-2"
                  >
                    <LogOut size={17} className="text-rose-400" />
                    <span>Lock Vault & Log Out</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
