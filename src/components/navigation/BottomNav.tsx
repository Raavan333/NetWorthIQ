import React from 'react';
import { useApp } from '../../context/AppContext';
import { Home, Wallet, CreditCard, Receipt, Sparkles } from 'lucide-react';

export const BottomNav: React.FC = () => {
  const { activeTab, setActiveTab, anomalies, smsStagingQueue } = useApp();

  const stagedCount = smsStagingQueue.filter((s) => s.status === 'staged').length;

  const tabs: {
    id: 'home' | 'assets' | 'liabilities' | 'spend' | 'insights';
    label: string;
    icon: React.ComponentType<{ size?: number; className?: string }>;
    badge?: number;
  }[] = [
    { id: 'home', label: 'Home', icon: Home },
    { id: 'assets', label: 'Assets', icon: Wallet },
    { id: 'liabilities', label: 'Liabilities', icon: CreditCard },
    {
      id: 'spend',
      label: 'Spend',
      icon: Receipt,
      badge: stagedCount > 0 ? stagedCount : undefined,
    },
    {
      id: 'insights',
      label: 'Insights',
      icon: Sparkles,
      badge: anomalies.length > 0 ? anomalies.length : undefined,
    },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-30 border-t border-slate-800/80 bg-slate-950/90 backdrop-blur-md px-3 py-1.5 sm:py-2">
      <div className="max-w-md mx-auto flex items-center justify-around">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex flex-col items-center justify-center py-1 px-3 rounded-xl transition-all cursor-pointer relative ${
                isActive ? 'text-emerald-400 font-semibold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <div className="relative">
                <Icon size={20} />
                {tab.badge && (
                  <span className="absolute -top-1 -right-2 px-1.5 py-0.2 rounded-full bg-emerald-500 text-slate-950 font-bold text-[9px] leading-tight shadow-xs">
                    {tab.badge}
                  </span>
                )}
              </div>
              <span className="text-[11px] mt-0.5 tracking-tight">{tab.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
