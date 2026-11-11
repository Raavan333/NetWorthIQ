/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { TopHeader } from './components/navigation/TopHeader';
import { BottomNav } from './components/navigation/BottomNav';
import { HomeView } from './components/home/HomeView';
import { AssetsView } from './components/assets/AssetsView';
import { LiabilitiesView } from './components/liabilities/LiabilitiesView';
import { SpendView } from './components/spend/SpendView';
import { InsightsView } from './components/insights/InsightsView';
import { GoalsView } from './components/goals/GoalsView';
import { IncomeSalaryView } from './components/income/IncomeSalaryView';
import { TaxView } from './components/tax/TaxView';
import { SettingsView } from './components/settings/SettingsView';
import { PinLockScreen } from './components/common/PinLockScreen';
import { Modal } from './components/common/Modal';
import { NeedsAttentionPanel } from './components/home/NeedsAttentionPanel';
import { GoalReadyNotificationModal } from './components/goals/GoalReadyNotificationModal';
import { NotificationCenterModal } from './components/common/NotificationCenterModal';
import { ReceiveMoneyModal } from './components/common/ReceiveMoneyModal';
import { HumanCapitalSkillCard } from './components/assets/HumanCapitalSkillCard';
import { ReconciliationAuditModal } from './components/common/ReconciliationAuditModal';
import { WhatIfSimulatorModal } from './components/simulator/WhatIfSimulatorModal';

const MainLayout: React.FC = () => {
  const {
    activeTab,
    activeModal,
    setActiveModal,
    isLocked,
    lockApp,
    settings,
    theme,
    readyGoalNotification,
    clearReadyGoalNotification,
  } = useApp();

  const lastActivityRef = useRef<number>(Date.now());

  // Reset activity timestamp on unlock
  useEffect(() => {
    if (!isLocked) {
      lastActivityRef.current = Date.now();
    }
  }, [isLocked]);

  // Subtle tactile haptic micro-feedback on button press (when device supports vibration)
  useEffect(() => {
    const handlePointerDown = (e: PointerEvent) => {
      const target = (e.target as HTMLElement)?.closest('button, [role="button"]');
      if (
        target &&
        !target.hasAttribute('disabled') &&
        target.getAttribute('aria-disabled') !== 'true' &&
        !target.classList.contains('no-haptic')
      ) {
        if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
          try {
            navigator.vibrate(6); // Crisp 6ms micro-tap
          } catch {
            // ignore
          }
        }
      }
    };
    window.addEventListener('pointerdown', handlePointerDown, { passive: true });
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, []);

  // 1. Screen Turn-Off / Device Lock / App Background Auto-Logout
  useEffect(() => {
    const isSecurityActive = settings.pinLockEnabled !== false;
    if (!isSecurityActive) return;

    const shouldLockOnScreenOff = settings.lockOnScreenOff !== false;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        // Screen turned off, phone locked, lid closed, or tab minimized
        if (shouldLockOnScreenOff && !isLocked) {
          lockApp();
        }
      } else if (document.visibilityState === 'visible') {
        // Screen turned back on or tab restored: check elapsed inactivity
        const timeoutMs = (settings.autoLockMinutes || 1) * 60 * 1000;
        if (Date.now() - lastActivityRef.current >= timeoutMs && !isLocked) {
          lockApp();
        }
      }
    };

    const handlePageHide = () => {
      if (shouldLockOnScreenOff && !isLocked) {
        lockApp();
      }
    };

    const handleFreeze = () => {
      if (shouldLockOnScreenOff && !isLocked) {
        lockApp();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handlePageHide);
    document.addEventListener('freeze', handleFreeze);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handlePageHide);
      document.removeEventListener('freeze', handleFreeze);
    };
  }, [settings.pinLockEnabled, settings.lockOnScreenOff, settings.autoLockMinutes, isLocked, lockApp]);

  // 2. High-Precision Inactivity Auto-Logout Tracker
  useEffect(() => {
    const isSecurityActive = settings.pinLockEnabled !== false;
    if (!isSecurityActive || isLocked) return;

    const resetActivity = () => {
      lastActivityRef.current = Date.now();
    };

    const events = [
      'mousemove',
      'mousedown',
      'pointerdown',
      'touchstart',
      'touchmove',
      'keydown',
      'wheel',
      'scroll',
      'click',
    ];

    events.forEach((evt) => {
      window.addEventListener(evt, resetActivity, { passive: true });
    });

    // Check inactivity every 1 second
    const interval = setInterval(() => {
      const timeoutMs = (settings.autoLockMinutes || 1) * 60 * 1000;
      if (Date.now() - lastActivityRef.current >= timeoutMs) {
        lockApp();
      }
    }, 1000);

    return () => {
      events.forEach((evt) => {
        window.removeEventListener(evt, resetActivity);
      });
      clearInterval(interval);
    };
  }, [settings.pinLockEnabled, settings.autoLockMinutes, isLocked, lockApp]);

  // Determine dynamic font family from theme stack
  const getFontFamily = () => {
    switch (theme.fontStack) {
      case 'serif':
        return 'Georgia, Cambria, "Times New Roman", Times, serif';
      case 'mono':
        return 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
      case 'rounded':
        return 'ui-rounded, "Nunito", "SF Pro Rounded", system-ui, sans-serif';
      case 'sans':
      default:
        return 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    }
  };

  if (isLocked) {
    return <PinLockScreen />;
  }

  return (
    <div
      className="min-h-screen text-slate-100 flex flex-col selection:bg-emerald-500/30 selection:text-emerald-200 transition-colors duration-200 relative"
      style={{
        backgroundColor: theme.colors.bg || '#080d1a',
        color: theme.colors.text || '#f8fafc',
        fontFamily: getFontFamily(),
        fontSize: `${(theme.fontSizeScale || 1.0) * 100}%`,
      }}
    >
      {/* Dynamic User-Configured Background Atmosphere */}
      {theme.bgStyle === 'radial' && (
        <div
          className="fixed inset-0 pointer-events-none z-0 opacity-40 transition-opacity duration-300"
          style={{
            background: `radial-gradient(circle at 50% 0%, ${theme.colors.primary}25 0%, transparent 70%)`,
          }}
        />
      )}
      {theme.bgStyle === 'mesh' && (
        <div
          className="fixed inset-0 pointer-events-none z-0 opacity-35 transition-opacity duration-300"
          style={{
            background: `radial-gradient(at 0% 0%, ${theme.colors.primary}25 0px, transparent 50%), radial-gradient(at 100% 0%, ${theme.colors.accent || theme.colors.primary}20 0px, transparent 50%), radial-gradient(at 50% 100%, ${theme.colors.primary}15 0px, transparent 50%)`,
          }}
        />
      )}
      {theme.bgStyle === 'grid' && (
        <div
          className="fixed inset-0 pointer-events-none z-0 opacity-15 transition-opacity duration-300"
          style={{
            backgroundImage: `linear-gradient(${theme.colors.border || '#1e293b'} 1px, transparent 1px), linear-gradient(90deg, ${theme.colors.border || '#1e293b'} 1px, transparent 1px)`,
            backgroundSize: '28px 28px',
          }}
        />
      )}

      {/* Top Header */}
      <TopHeader />

      {/* Main Content Area */}
      <main className="flex-1 w-full max-w-4xl mx-auto px-2.5 sm:px-6 py-3 sm:py-4 pb-24 sm:pb-28">
        {activeTab === 'home' && <HomeView />}
        {activeTab === 'assets' && <AssetsView />}
        {activeTab === 'liabilities' && <LiabilitiesView />}
        {activeTab === 'spend' && <SpendView />}
        {activeTab === 'insights' && <InsightsView />}
      </main>

      {/* Global Bottom Navigation */}
      <BottomNav />

      {/* Top-Right Menu Modals */}
      {activeModal === 'goals' && (
        <Modal
          isOpen={true}
          onClose={() => setActiveModal(null)}
          title="Goals Hub"
          subtitle="Fund allocation milestones and horizon forecasting"
          maxWidth="max-w-3xl"
        >
          <GoalsView />
        </Modal>
      )}

      {activeModal === 'income' && (
        <Modal
          isOpen={true}
          onClose={() => setActiveModal(null)}
          title="Income & Earnings Hub"
          subtitle="Employment salary streams, payday triggers, and ad-hoc bonuses"
          maxWidth="max-w-3xl"
        >
          <IncomeSalaryView />
        </Modal>
      )}

      {activeModal === 'tax' && (
        <Modal
          isOpen={true}
          onClose={() => setActiveModal(null)}
          title="Tax Intelligence"
          subtitle="Capital gains liabilities, exemptions, and asset holding countdowns"
          maxWidth="max-w-3xl"
        >
          <TaxView />
        </Modal>
      )}

      {activeModal === 'career' && (
        <Modal
          isOpen={true}
          onClose={() => setActiveModal(null)}
          title="Career & Human Capital Asset"
          subtitle="Lifetime earning power, skill gap analysis, and compensation progression roadmap"
          maxWidth="max-w-4xl"
        >
          <div className="max-h-[82vh] overflow-y-auto pr-1">
            <HumanCapitalSkillCard />
          </div>
        </Modal>
      )}

      {(activeModal === 'settings' || activeModal === 'settings:nudges') && (
        <Modal
          isOpen={true}
          onClose={() => setActiveModal(null)}
          title="Settings"
          subtitle="Currencies, categories, subconscious nudges, scheduled transfers, themes, and security"
          maxWidth="max-w-3xl"
        >
          <SettingsView
            initialSection={activeModal === 'settings:nudges' ? 'nudges' : 'profile'}
          />
        </Modal>
      )}

      {activeModal === 'needsAttention' && (
        <Modal
          isOpen={true}
          onClose={() => setActiveModal(null)}
          title="Needs Your Attention"
          subtitle="Urgent items, stale exchange rates, due bills, or assumed defaults"
          maxWidth="max-w-xl"
        >
          <NeedsAttentionPanel />
        </Modal>
      )}

      {activeModal === 'notifications' && (
        <Modal
          isOpen={true}
          onClose={() => setActiveModal(null)}
          title="Notification Center"
          subtitle="Proactive obligation conflicts, cash-flow stress, and repayment plan risks"
          maxWidth="max-w-2xl"
        >
          <NotificationCenterModal onClose={() => setActiveModal(null)} />
        </Modal>
      )}

      {/* Global Receive Money / External Inflow Modal */}
      {activeModal === 'receiveMoney' && (
        <ReceiveMoneyModal
          isOpen={true}
          onClose={() => setActiveModal(null)}
        />
      )}

      {/* Global Audit Ledger Console */}
      {activeModal === 'audit' && (
        <ReconciliationAuditModal onClose={() => setActiveModal(null)} />
      )}

      {/* Global What-If Simulator */}
      {activeModal === 'whatif' && (
        <WhatIfSimulatorModal onClose={() => setActiveModal(null)} />
      )}

      {/* Immediate Notification when a Goal reaches 100% and is ready to use */}
      {readyGoalNotification && (
        <GoalReadyNotificationModal
          goal={readyGoalNotification}
          onClose={clearReadyGoalNotification}
        />
      )}
    </div>
  );
};

export default function App() {
  return (
    <AppProvider>
      <MainLayout />
    </AppProvider>
  );
}
