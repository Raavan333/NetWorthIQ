import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { Currency, AppTheme } from '../../types';
import { DEFAULT_SETTINGS, THEME_PRESETS } from '../../lib/defaults';
import { generateSalt, hashPin, encryptExportData, decryptExportData } from '../../lib/crypto';
import { Modal } from '../common/Modal';
import {
  User,
  Coins,
  Palette,
  Shield,
  Sliders,
  Database,
  Check,
  AlertTriangle,
  Download,
  Upload,
  RefreshCw,
  Lock,
  Trash2,
  Plus,
  Tag,
  Calendar,
  Brain,
  Smartphone,
  Compass,
  RotateCcw,
  Sparkles,
} from 'lucide-react';
import { DataManagementSection } from './DataManagementSection';
import { SpendCategoriesManager } from './SpendCategoriesManager';
import { AssetCategoriesManager } from './AssetCategoriesManager';
import { ScheduledTransfersManager } from './ScheduledTransfersManager';
import { CreditAndMLEngineSection } from './CreditAndMLEngineSection';
import { SubconsciousNudgePreferencesSection } from './SubconsciousNudgePreferencesSection';

export type SettingsSectionId =
  | 'profile'
  | 'nudges'
  | 'currencies'
  | 'categories'
  | 'scheduled'
  | 'ml'
  | 'theme'
  | 'security'
  | 'defaults'
  | 'formats'
  | 'data';

interface SettingsViewProps {
  initialSection?: SettingsSectionId;
}

export const SettingsView: React.FC<SettingsViewProps> = ({ initialSection = 'profile' }) => {
  const {
    settings,
    updateSettings,
    theme,
    updateTheme,
    currencies,
    addCurrency,
    updateCurrency,
    deleteCurrency,
    wipeAllData,
    exportFullBackup,
    importFullBackup,
    lockApp,
  } = useApp();

  const [activeSection, setActiveSection] = useState<SettingsSectionId>(initialSection);

  const [categorySubTab, setCategorySubTab] = useState<'assets' | 'spend'>('assets');

  // Profile Form States
  const [appName, setAppName] = useState(settings.appName);
  const [profileName, setProfileName] = useState(settings.profileName);
  const [age, setAge] = useState(settings.age !== undefined ? String(settings.age) : '');
  const [avatarColor, setAvatarColor] = useState(settings.avatarColor);
  const [profileSaved, setProfileSaved] = useState(false);

  // Currency modal
  const [isCurrModalOpen, setIsCurrModalOpen] = useState(false);
  const [currCode, setCurrCode] = useState('');
  const [currSymbol, setCurrSymbol] = useState('');
  const [currRate, setCurrRate] = useState('');
  const [currError, setCurrError] = useState('');
  const [currencyDeleteError, setCurrencyDeleteError] = useState('');

  // Security PIN states
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [pinSuccess, setPinSuccess] = useState('');

  // Theme Customizer draft states & save status
  const [draftColors, setDraftColors] = useState<AppTheme['colors']>(theme.colors);
  const [draftBgStyle, setDraftBgStyle] = useState<'solid' | 'radial' | 'mesh' | 'grid'>(
    theme.bgStyle || 'mesh'
  );
  const [draftFontStack, setDraftFontStack] = useState<string>(theme.fontStack || 'sans');
  const [draftFontSizeScale, setDraftFontSizeScale] = useState<number>(theme.fontSizeScale || 1.0);
  const [themeSaveSuccess, setThemeSaveSuccess] = useState(false);

  // Sync draft states when active theme changes
  useEffect(() => {
    if (theme && theme.colors) {
      setDraftColors(theme.colors);
      setDraftBgStyle((theme.bgStyle as any) || 'mesh');
      setDraftFontStack(theme.fontStack || 'sans');
      setDraftFontSizeScale(theme.fontSizeScale || 1.0);
    }
  }, [theme]);

  const handleDraftColorChange = (key: keyof AppTheme['colors'], val: string) => {
    const next = { ...draftColors, [key]: val };
    if (key === 'surface') {
      next.card = val;
    }
    setDraftColors(next);
    // Instant live preview
    updateTheme({
      ...theme,
      colors: next,
    });
  };

  const handleSelectPresetTheme = (p: AppTheme) => {
    setDraftColors(p.colors);
    setDraftBgStyle((p.bgStyle as any) || 'mesh');
    setDraftFontStack(p.fontStack || 'sans');
    setDraftFontSizeScale(p.fontSizeScale || 1.0);
    updateTheme(p);
  };

  const handleSaveTheme = async () => {
    const customTheme: AppTheme = {
      ...theme,
      id: theme.id.startsWith('custom-') ? theme.id : `custom-${Date.now()}`,
      name: theme.name.includes('(Customized)')
        ? theme.name
        : `${theme.name.split(' ')[0]} (Customized)`,
      colors: draftColors,
      bgStyle: draftBgStyle,
      fontStack: draftFontStack,
      fontSizeScale: draftFontSizeScale,
    };
    await updateTheme(customTheme);
    setThemeSaveSuccess(true);
    setTimeout(() => setThemeSaveSuccess(false), 3500);
  };

  const handleResetTheme = async () => {
    const def = THEME_PRESETS[0];
    setDraftColors(def.colors);
    setDraftBgStyle((def.bgStyle as any) || 'mesh');
    setDraftFontStack(def.fontStack || 'sans');
    setDraftFontSizeScale(def.fontSizeScale || 1.0);
    await updateTheme(def);
    setThemeSaveSuccess(true);
    setTimeout(() => setThemeSaveSuccess(false), 3000);
  };

  // Handle Profile Save
  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsedAge = age.trim() !== '' ? parseFloat(age) : undefined;
    await updateSettings({
      appName: appName.trim() || 'NetWorthIQ',
      profileName: profileName.trim(),
      age: parsedAge !== undefined && !isNaN(parsedAge) && parsedAge > 0 ? parsedAge : undefined,
      avatarColor,
    });
    setProfileSaved(true);
    setTimeout(() => setProfileSaved(false), 2000);
  };

  // Handle Save Currency
  const handleSaveCurrency = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = currCode.trim().toUpperCase();
    if (!code) {
      setCurrError('Currency code is required');
      return;
    }
    const rate = parseFloat(currRate);
    if (isNaN(rate) || rate <= 0) {
      setCurrError('Exchange rate to base must be positive');
      return;
    }

    await addCurrency({
      code,
      symbol: currSymbol.trim() || code,
      rateToBase: rate,
      updatedAt: new Date().toISOString(),
    });
    setIsCurrModalOpen(false);
    setCurrCode('');
    setCurrSymbol('');
    setCurrRate('');
    setCurrError('');
  };

  // Handle Set PIN
  const handleSetPin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPin.length !== 4) {
      setPinError('PIN must be exactly 4 digits');
      return;
    }
    if (newPin !== confirmPin) {
      setPinError('PIN entries do not match');
      return;
    }

    const salt = generateSalt(16);
    const hash = await hashPin(newPin, salt);
    await updateSettings({
      pinLockEnabled: true,
      pinSalt: salt,
      pinHash: hash,
    });
    setPinSuccess('PIN lock enabled successfully!');
    setNewPin('');
    setConfirmPin('');
    setPinError('');
    setTimeout(() => setPinSuccess(''), 3000);
  };

  const handleDisablePin = async () => {
    await updateSettings({
      pinLockEnabled: false,
      pinHash: '',
      pinSalt: '',
    });
    setPinSuccess('PIN lock disabled.');
    setTimeout(() => setPinSuccess(''), 3000);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">Preferences & Controls</h2>
          <p className="text-xs text-slate-400">
            User-configurable currencies, spend categories, scheduled transfers, and local data backups
          </p>
        </div>
        <span className="text-[11px] font-mono text-slate-400 shrink-0">v4.0</span>
      </div>

      {/* Sections Tab Bar */}
      <div className="flex flex-wrap gap-1.5 p-1 rounded-2xl bg-slate-950 border border-slate-800 text-xs font-semibold">
        {[
          { id: 'profile', label: 'Profile', icon: User },
          { id: 'nudges', label: 'Subconscious Nudge Preferences', icon: Compass },
          { id: 'currencies', label: 'Currencies', icon: Coins },
          { id: 'categories', label: 'Spend & Quick Chips', icon: Tag },
          { id: 'scheduled', label: 'Auto Transfers', icon: Calendar },
          { id: 'ml', label: 'ML & Credit Health', icon: Brain },
          { id: 'theme', label: 'Theme & Fonts', icon: Palette },
          { id: 'security', label: 'Security & PIN', icon: Shield },
          { id: 'defaults', label: 'Defaults & Limits', icon: Sliders },
          { id: 'formats', label: 'Formats & FY', icon: Sliders },
          { id: 'data', label: 'Data Management', icon: Database },
        ].map((sec) => {
          const Icon = sec.icon;
          const isActive = activeSection === sec.id;
          return (
            <button
              key={sec.id}
              onClick={() => setActiveSection(sec.id as any)}
              className={`px-3 py-1.5 rounded-xl transition-all cursor-pointer flex items-center gap-1.5 ${
                isActive
                  ? 'bg-slate-800 text-emerald-400 font-bold shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Icon size={14} />
              <span>{sec.label}</span>
            </button>
          );
        })}
      </div>

      {/* 1. PROFILE */}
      {activeSection === 'profile' && (
        <form onSubmit={handleSaveProfile} className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
          <h3 className="text-sm font-bold text-white uppercase tracking-wider">Profile & Branding</h3>

          {profileSaved && (
            <div className="p-2.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-1.5">
              <Check size={14} /> Profile preferences saved!
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Application Name</label>
              <input
                type="text"
                value={appName}
                onChange={(e) => setAppName(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200"
              />
              <span className="text-[10px] text-slate-500">Default: NetWorthIQ (User-editable)</span>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Your Name / Title</label>
              <input
                type="text"
                value={profileName}
                onChange={(e) => setProfileName(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Age (Years)</label>
              <input
                type="number"
                step="any"
                min="14"
                max="100"
                placeholder="e.g. 24"
                value={age}
                onChange={(e) => setAge(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200 font-mono tabular-nums"
              />
              <span className="text-[10px] text-slate-500">Synced with Career ML &amp; exports</span>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-2">Avatar Brand Color</label>
            <div className="flex items-center gap-2">
              {['#10b981', '#3b82f6', '#8b5cf6', '#eab308', '#f43f5e', '#06b6d4', '#ec4899'].map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setAvatarColor(c)}
                  className={`w-7 h-7 rounded-xl transition-transform cursor-pointer ${
                    avatarColor === c ? 'scale-110 ring-2 ring-white shadow-lg' : 'opacity-80 hover:opacity-100'
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
              <input
                type="color"
                value={avatarColor}
                onChange={(e) => setAvatarColor(e.target.value)}
                className="w-8 h-8 rounded-xl bg-transparent border-0 cursor-pointer"
              />
            </div>
          </div>

          <div className="flex justify-end pt-2 border-t border-slate-800">
            <button
              type="submit"
              className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-md shadow-emerald-600/20 cursor-pointer"
            >
              Save Profile
            </button>
          </div>
        </form>
      )}

      {/* 2. CURRENCIES */}
      {activeSection === 'currencies' && (
        <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">Currencies & FX Rates</h3>
              <p className="text-xs text-slate-400">
                Only user-defined currencies can be selected anywhere. All rates are manually entered.
              </p>
            </div>
            <button
              onClick={() => setIsCurrModalOpen(true)}
              className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1 cursor-pointer"
            >
              <Plus size={14} /> Add Currency
            </button>
          </div>

          {/* Base Currency Selection */}
          <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 flex items-center justify-between text-xs">
            <div>
              <span className="font-semibold text-slate-200">Portfolio Base Currency:</span>
              <p className="text-slate-400 text-[11px] mt-0.5">
                All net worth valuations and final rates compute against this base.
              </p>
            </div>
            <select
              value={settings.baseCurrency}
              onChange={(e) => updateSettings({ baseCurrency: e.target.value })}
              className="bg-slate-900 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-white font-bold"
            >
              {currencies.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} ({c.symbol})
                </option>
              ))}
            </select>
          </div>

          {currencyDeleteError && (
            <div className="p-2.5 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5">
                <AlertTriangle size={14} className="shrink-0" />
                {currencyDeleteError}
              </span>
              <button
                type="button"
                onClick={() => setCurrencyDeleteError('')}
                className="text-slate-300 hover:text-white cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Currencies Table */}
          <div className="border border-slate-800 rounded-xl overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950 text-slate-400 font-semibold border-b border-slate-800">
                <tr>
                  <th className="p-3">Code</th>
                  <th className="p-3">Symbol</th>
                  <th className="p-3">Rate to Base ({settings.baseCurrency})</th>
                  <th className="p-3">Last Updated</th>
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {currencies.map((c) => {
                  const isBase = c.code === settings.baseCurrency;
                  const diffDays =
                    (Date.now() - new Date(c.updatedAt).getTime()) / (1000 * 60 * 60 * 24);
                  const isStale = !isBase && diffDays > (settings.staleRateDays || 7);

                  return (
                    <tr key={c.code} className="hover:bg-slate-800/30">
                      <td className="p-3 font-bold text-white font-sans flex items-center gap-1.5">
                        {c.code}
                        {isBase && (
                          <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 text-[9px] font-bold">
                            BASE
                          </span>
                        )}
                      </td>
                      <td className="p-3 text-slate-300">{c.symbol}</td>
                      <td className="p-3 font-bold text-slate-100">
                        {isBase ? (
                          '1.000'
                        ) : (
                          <input
                            type="number"
                            step="any"
                            value={c.rateToBase}
                            onChange={(e) =>
                              updateCurrency({
                                ...c,
                                rateToBase: parseFloat(e.target.value) || 1,
                                updatedAt: new Date().toISOString(),
                              })
                            }
                            className="w-24 bg-slate-950 border border-slate-700 rounded-lg px-2 py-0.5 text-xs text-white"
                          />
                        )}
                      </td>
                      <td className="p-3 font-sans">
                        <span className={isStale ? 'text-rose-400 font-bold' : 'text-slate-400'}>
                          {c.updatedAt ? c.updatedAt.split('T')[0] : 'Today'}
                          {isStale && ' (Stale)'}
                        </span>
                      </td>
                      <td className="p-3 text-right font-sans">
                        {!isBase && (
                          <button
                            onClick={async () => {
                              const deleted = await deleteCurrency(c.code);
                              if (!deleted) {
                                setCurrencyDeleteError(
                                  `Cannot delete currency ${c.code} while holdings or loans reference it.`
                                );
                              } else {
                                setCurrencyDeleteError('');
                              }
                            }}
                            className="p-1 rounded text-slate-500 hover:text-rose-400 cursor-pointer"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 3. THEME & FONTS */}
      {activeSection === 'theme' && (
        <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">Themes & Custom Colors</h3>
              <p className="text-xs text-slate-400">
                Personalize your color palette, surface styling, and background atmosphere
              </p>
            </div>

            {/* Prominent Save Theme Button */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleResetTheme}
                className="px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 hover:bg-slate-800 text-slate-300 text-xs font-medium flex items-center gap-1.5 cursor-pointer transition-colors shadow-xs"
                title="Reset to Obsidian Emerald default theme"
              >
                <RotateCcw size={13} />
                <span>Reset</span>
              </button>

              <button
                type="button"
                onClick={handleSaveTheme}
                className={`px-4 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-md transition-all ${
                  themeSaveSuccess
                    ? 'bg-emerald-500 text-slate-950 ring-2 ring-emerald-400'
                    : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/25'
                }`}
              >
                {themeSaveSuccess ? (
                  <>
                    <Check size={14} className="stroke-[3]" />
                    <span>Saved!</span>
                  </>
                ) : (
                  <>
                    <Sparkles size={14} />
                    <span>Save Theme Changes</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {themeSaveSuccess && (
            <div className="p-3 rounded-xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-xs flex items-center gap-2 animate-fade-in shadow-xs">
              <Check size={16} className="text-emerald-400 shrink-0" />
              <span>
                Theme changes saved successfully! Your custom colors and atmosphere are now permanently saved.
              </span>
            </div>
          )}

          {/* Presets */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-2">Curated Theme Presets</label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {THEME_PRESETS.map((p) => {
                const isActive = theme.id === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => handleSelectPresetTheme(p)}
                    className={`p-2.5 rounded-xl border text-xs font-semibold cursor-pointer transition-all text-left ${
                      isActive
                        ? 'bg-slate-800 border-emerald-500 text-emerald-300 ring-1 ring-emerald-500'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 mb-1">
                      <span
                        className="w-3.5 h-3.5 rounded-full border border-white/20 shrink-0"
                        style={{ backgroundColor: p.colors.primary }}
                      />
                      <span className="truncate">{p.name.split(' ')[0]}</span>
                    </div>
                    <span className="text-[10px] opacity-70 block">
                      {p.isDark ? 'Dark Mode' : 'Light Mode'}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Custom Background & Palette Studio */}
          <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 space-y-3.5">
            <div className="flex items-center justify-between">
              <div>
                <span className="font-semibold text-slate-200 text-xs block">Custom Palette Studio</span>
                <span className="text-[11px] text-slate-400">
                  Click a swatch or enter exact hex codes to build your custom colorway
                </span>
              </div>
              <span className="text-[10px] text-slate-500 font-mono">
                Live Preview Active
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
              {/* Background Color */}
              <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800/80">
                <label className="block text-[11px] font-medium text-slate-400 mb-1.5">Background Canvas</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={draftColors.bg || '#080d1a'}
                    onChange={(e) => handleDraftColorChange('bg', e.target.value)}
                    className="w-8 h-8 rounded-lg border border-slate-700 cursor-pointer bg-transparent"
                    title="Pick background color"
                  />
                  <input
                    type="text"
                    value={draftColors.bg || '#080d1a'}
                    onChange={(e) => handleDraftColorChange('bg', e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-xs text-slate-200 font-mono"
                    placeholder="#080d1a"
                  />
                </div>
              </div>

              {/* Surface Color */}
              <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800/80">
                <label className="block text-[11px] font-medium text-slate-400 mb-1.5">Surface Containers</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={draftColors.surface || '#0f172a'}
                    onChange={(e) => handleDraftColorChange('surface', e.target.value)}
                    className="w-8 h-8 rounded-lg border border-slate-700 cursor-pointer bg-transparent"
                    title="Pick surface color"
                  />
                  <input
                    type="text"
                    value={draftColors.surface || '#0f172a'}
                    onChange={(e) => handleDraftColorChange('surface', e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-xs text-slate-200 font-mono"
                    placeholder="#0f172a"
                  />
                </div>
              </div>

              {/* Card Color */}
              <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800/80">
                <label className="block text-[11px] font-medium text-slate-400 mb-1.5">Cards & Panels</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={draftColors.card || '#131e36'}
                    onChange={(e) => handleDraftColorChange('card', e.target.value)}
                    className="w-8 h-8 rounded-lg border border-slate-700 cursor-pointer bg-transparent"
                    title="Pick card color"
                  />
                  <input
                    type="text"
                    value={draftColors.card || '#131e36'}
                    onChange={(e) => handleDraftColorChange('card', e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-xs text-slate-200 font-mono"
                    placeholder="#131e36"
                  />
                </div>
              </div>

              {/* Primary Accent Color */}
              <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800/80">
                <label className="block text-[11px] font-medium text-slate-400 mb-1.5">Primary Accent Tint</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={draftColors.primary || '#10b981'}
                    onChange={(e) => handleDraftColorChange('primary', e.target.value)}
                    className="w-8 h-8 rounded-lg border border-slate-700 cursor-pointer bg-transparent"
                    title="Pick primary accent tint"
                  />
                  <input
                    type="text"
                    value={draftColors.primary || '#10b981'}
                    onChange={(e) => handleDraftColorChange('primary', e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-xs text-slate-200 font-mono"
                    placeholder="#10b981"
                  />
                </div>
              </div>

              {/* Secondary Accent Color */}
              <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800/80">
                <label className="block text-[11px] font-medium text-slate-400 mb-1.5">Secondary Accent</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={draftColors.accent || '#06b6d4'}
                    onChange={(e) => handleDraftColorChange('accent', e.target.value)}
                    className="w-8 h-8 rounded-lg border border-slate-700 cursor-pointer bg-transparent"
                    title="Pick secondary accent color"
                  />
                  <input
                    type="text"
                    value={draftColors.accent || '#06b6d4'}
                    onChange={(e) => handleDraftColorChange('accent', e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-xs text-slate-200 font-mono"
                    placeholder="#06b6d4"
                  />
                </div>
              </div>

              {/* Border Color */}
              <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800/80">
                <label className="block text-[11px] font-medium text-slate-400 mb-1.5">Border Tone</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={draftColors.border || '#1e293b'}
                    onChange={(e) => handleDraftColorChange('border', e.target.value)}
                    className="w-8 h-8 rounded-lg border border-slate-700 cursor-pointer bg-transparent"
                    title="Pick border tone"
                  />
                  <input
                    type="text"
                    value={draftColors.border || '#1e293b'}
                    onChange={(e) => handleDraftColorChange('border', e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-xs text-slate-200 font-mono"
                    placeholder="#1e293b"
                  />
                </div>
              </div>
            </div>

            {/* Atmosphere Overlay Style */}
            <div className="pt-1">
              <label className="block text-[11px] font-medium text-slate-400 mb-1.5">Background Atmosphere</label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  { id: 'solid', label: 'Solid Pure' },
                  { id: 'radial', label: 'Ambient Radial Glow' },
                  { id: 'mesh', label: 'Multi-Color Mesh' },
                  { id: 'grid', label: 'Blueprint Grid' },
                ].map((s) => {
                  const isActive = draftBgStyle === s.id;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => {
                        setDraftBgStyle(s.id as any);
                        updateTheme({ ...theme, bgStyle: s.id as any });
                      }}
                      className={`py-1.5 px-2 rounded-xl text-xs font-medium border text-center transition-all cursor-pointer ${
                        isActive
                          ? 'bg-emerald-500/15 border-emerald-500 text-emerald-300 font-semibold'
                          : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {s.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Reduce Motion */}
          <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 flex items-center justify-between text-xs">
            <div>
              <span className="font-semibold text-slate-200">Reduce Motion / Disable Animations</span>
              <p className="text-slate-400 text-[11px] mt-0.5">
                Stops glowing pulses and digit ticker animations for battery saving or accessibility.
              </p>
            </div>
            <input
              type="checkbox"
              checked={settings.reduceMotion}
              onChange={(e) => updateSettings({ reduceMotion: e.target.checked })}
              className="w-4 h-4 rounded text-emerald-500 bg-slate-900 border-slate-700 cursor-pointer"
            />
          </div>

          {/* Font Stack & Scale */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">System Font Stack</label>
              <select
                value={draftFontStack}
                onChange={(e) => {
                  setDraftFontStack(e.target.value);
                  updateTheme({ ...theme, fontStack: e.target.value });
                }}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200"
              >
                <option value="sans">Modern Sans-Serif (Inter / System UI)</option>
                <option value="serif">Classic Serif (Georgia / Editorial)</option>
                <option value="mono">Technical Monospace (SF Mono / JetBrains)</option>
                <option value="rounded">Rounded Geometric</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">
                Font Scale Multiplier: {(draftFontSizeScale * 100).toFixed(0)}%
              </label>
              <input
                type="range"
                min="0.85"
                max="1.25"
                step="0.05"
                value={draftFontSizeScale}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setDraftFontSizeScale(val);
                  updateTheme({ ...theme, fontSizeScale: val });
                }}
                className="w-full accent-emerald-500 cursor-pointer mt-2"
              />
            </div>
          </div>

          {/* Bottom Save Action Bar */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800/80">
            <button
              type="button"
              onClick={handleSaveTheme}
              className={`px-5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-md transition-all ${
                themeSaveSuccess
                  ? 'bg-emerald-500 text-slate-950 ring-2 ring-emerald-400'
                  : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/25'
              }`}
            >
              {themeSaveSuccess ? (
                <>
                  <Check size={14} className="stroke-[3]" />
                  <span>Theme Settings Saved!</span>
                </>
              ) : (
                <>
                  <Sparkles size={14} />
                  <span>Save All Theme Changes</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* 4. SECURITY & PIN */}
      {activeSection === 'security' && (
        <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
          <h3 className="text-sm font-bold text-white uppercase tracking-wider">Security & Vault Lock</h3>

          {pinSuccess && (
            <div className="p-2.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-1.5">
              <Check size={14} /> {pinSuccess}
            </div>
          )}

          {pinError && (
            <div className="p-2.5 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs">
              {pinError}
            </div>
          )}

          {settings.pinLockEnabled ? (
            <div className="p-4 rounded-xl bg-slate-950/70 border border-emerald-500/30 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <Lock size={16} className="text-emerald-400" />
                  <span className="text-sm font-bold text-white">PIN Lock is Active</span>
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  Salted SHA-256 hash stored locally in IndexedDB.
                </p>
              </div>
              <button
                onClick={handleDisablePin}
                className="px-3.5 py-1.5 rounded-xl bg-rose-600/20 text-rose-300 border border-rose-500/30 hover:bg-rose-600/30 text-xs font-semibold cursor-pointer"
              >
                Disable PIN
              </button>
            </div>
          ) : (
            <form onSubmit={handleSetPin} className="space-y-3 p-3.5 rounded-xl bg-slate-950/60 border border-slate-800">
              <span className="text-xs font-bold text-slate-200">Set 4-Digit Vault PIN</span>
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="password"
                  placeholder="New PIN (4 digits)"
                  maxLength={4}
                  value={newPin}
                  onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))}
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200 font-mono text-center tracking-widest"
                />
                <input
                  type="password"
                  placeholder="Confirm PIN"
                  maxLength={4}
                  value={confirmPin}
                  onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))}
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200 font-mono text-center tracking-widest"
                />
              </div>
              <button
                type="submit"
                className="w-full py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-md shadow-emerald-600/20 cursor-pointer transition-colors"
              >
                Enable 4-Digit PIN Protection
              </button>
            </form>
          )}



          {/* Screen Off & Background Auto-Logout */}
          <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 flex items-center justify-between text-xs">
            <div className="pr-3">
              <span className="font-semibold text-slate-200">Self Logout on Screen Turn-Off</span>
              <p className="text-slate-400 text-[11px] mt-0.5">
                Locks the vault immediately whenever your device screen turns off, locks, or the app goes into the background.
              </p>
            </div>
            <input
              type="checkbox"
              checked={settings.lockOnScreenOff !== false}
              onChange={(e) => updateSettings({ lockOnScreenOff: e.target.checked })}
              className="w-4 h-4 rounded text-emerald-500 bg-slate-900 border-slate-700 cursor-pointer shrink-0"
            />
          </div>

          {/* Inactivity Timeout */}
          <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
            <div>
              <span className="font-semibold text-slate-200">Inactivity Self Logout Timeout</span>
              <p className="text-slate-400 text-[11px] mt-0.5">
                Automatically locks the application after a period of user inactivity.
              </p>
            </div>
            <select
              value={settings.autoLockMinutes || 1}
              onChange={(e) => updateSettings({ autoLockMinutes: parseFloat(e.target.value) })}
              className="bg-slate-900 border border-slate-700 text-slate-200 text-xs rounded-xl px-3 py-1.5 cursor-pointer font-medium"
            >
              <option value={0.5}>30 Seconds (Ultra-Secure)</option>
              <option value={1}>1 Minute (Recommended)</option>
              <option value={2}>2 Minutes</option>
              <option value={5}>5 Minutes</option>
              <option value={10}>10 Minutes</option>
            </select>
          </div>

          {/* Instant Lock Trigger */}
          <div className="pt-1">
            <button
              type="button"
              onClick={lockApp}
              className="w-full py-2.5 px-4 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 hover:bg-slate-850 text-xs text-slate-300 hover:text-white font-semibold flex items-center justify-center gap-2 cursor-pointer transition-all shadow-sm"
            >
              <Lock size={14} className="text-emerald-400" />
              <span>Lock Vault Now (Instant Logout)</span>
            </button>
          </div>
        </div>
      )}

      {/* 5. DEFAULTS & THRESHOLDS */}
      {activeSection === 'defaults' && (
        <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">Documented Safe Defaults Table</h3>
              <p className="text-xs text-slate-400">
                Rule 4 & 5: Everything is configurable. Edit any system assumption or restore safe defaults.
              </p>
            </div>
            <button
              onClick={() => updateSettings(DEFAULT_SETTINGS)}
              className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold flex items-center gap-1 cursor-pointer"
            >
              <RefreshCw size={13} /> Reset All Defaults
            </button>
          </div>

          {/* Configurable Debit Card & ATM Thresholds Card */}
          <div className="p-4 rounded-xl bg-slate-950/80 border border-cyan-800/50 space-y-3">
            <div className="flex items-center gap-2">
              <Smartphone size={16} className="text-cyan-400" />
              <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                Debit Card ATM Free Limits & Surcharge Rules
              </h4>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Configure free ATM withdrawals per calendar month and the bank surcharge applied beyond the free limit. These defaults apply to all debit cards linked to your bank accounts.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
              <div>
                <label className="block text-[11px] font-medium text-slate-300 mb-1">
                  Metro ATM Limit (Free/Mo)
                </label>
                <input
                  type="number"
                  min="0"
                  max="30"
                  value={settings.debitCardMetroAtmLimit ?? 5}
                  onChange={(e) =>
                    updateSettings({ debitCardMetroAtmLimit: Math.max(0, parseInt(e.target.value, 10) || 0) })
                  }
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-cyan-400"
                />
                <span className="text-[10px] text-slate-500">Default: 5 free/mo</span>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-300 mb-1">
                  Non-Metro ATM Limit (Free/Mo)
                </label>
                <input
                  type="number"
                  min="0"
                  max="30"
                  value={settings.debitCardNonMetroAtmLimit ?? 3}
                  onChange={(e) =>
                    updateSettings({ debitCardNonMetroAtmLimit: Math.max(0, parseInt(e.target.value, 10) || 0) })
                  }
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-cyan-400"
                />
                <span className="text-[10px] text-slate-500">Default: 3 free/mo</span>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-300 mb-1">
                  Extra Fee Beyond Free Limit ({settings.baseCurrency})
                </label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={settings.debitCardExtraFeePerWithdrawal ?? 21}
                  onChange={(e) =>
                    updateSettings({ debitCardExtraFeePerWithdrawal: Math.max(0, parseFloat(e.target.value) || 0) })
                  }
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-cyan-400"
                />
                <span className="text-[10px] text-slate-500">Default: ₹21 per extra tx</span>
              </div>
            </div>
          </div>

          <div className="border border-slate-800 rounded-xl overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950 text-slate-400 font-semibold border-b border-slate-800">
                <tr>
                  <th className="p-3">Setting</th>
                  <th className="p-3">Configured Value</th>
                  <th className="p-3">Safe Default Rule</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                <tr className="hover:bg-slate-800/30">
                  <td className="p-3 font-sans font-semibold text-slate-200">Debit Card Metro ATM Limit</td>
                  <td className="p-3 text-cyan-400">{settings.debitCardMetroAtmLimit ?? 5} / month</td>
                  <td className="p-3 font-sans text-slate-400">5 free monthly withdrawals</td>
                </tr>
                <tr className="hover:bg-slate-800/30">
                  <td className="p-3 font-sans font-semibold text-slate-200">Debit Card Non-Metro ATM Limit</td>
                  <td className="p-3 text-cyan-400">{settings.debitCardNonMetroAtmLimit ?? 3} / month</td>
                  <td className="p-3 font-sans text-slate-400">3 free monthly withdrawals</td>
                </tr>
                <tr className="hover:bg-slate-800/30">
                  <td className="p-3 font-sans font-semibold text-slate-200">ATM Extra Surcharge Fee</td>
                  <td className="p-3 text-rose-400">{settings.debitCardExtraFeePerWithdrawal ?? 21} {settings.baseCurrency}</td>
                  <td className="p-3 font-sans text-slate-400">₹21 per extra withdrawal</td>
                </tr>
                <tr className="hover:bg-slate-800/30">
                  <td className="p-3 font-sans font-semibold text-slate-200">Card Interest-Free Days</td>
                  <td className="p-3 text-emerald-400">{settings.defaultCardInterestFreeDays} days</td>
                  <td className="p-3 font-sans text-slate-400">18 days</td>
                </tr>
                <tr className="hover:bg-slate-800/30">
                  <td className="p-3 font-sans font-semibold text-slate-200">Card Penalty Monthly Rate</td>
                  <td className="p-3 text-rose-400">{settings.defaultCardPenaltyRateMonthly}% / mo</td>
                  <td className="p-3 font-sans text-slate-400">3.5% per month (~42% APR)</td>
                </tr>
                <tr className="hover:bg-slate-800/30">
                  <td className="p-3 font-sans font-semibold text-slate-200">Alert Lead Days</td>
                  <td className="p-3 text-amber-400">{settings.defaultAlertLeadDays} days</td>
                  <td className="p-3 font-sans text-slate-400">5 days prior to due date</td>
                </tr>
                <tr className="hover:bg-slate-800/30">
                  <td className="p-3 font-sans font-semibold text-slate-200">Stale FX Rate Warning</td>
                  <td className="p-3 text-slate-300">{settings.staleRateDays} days</td>
                  <td className="p-3 font-sans text-slate-400">7 days</td>
                </tr>
                <tr className="hover:bg-slate-800/30">
                  <td className="p-3 font-sans font-semibold text-slate-200">Min Cash Threshold Safe Buffer</td>
                  <td className="p-3 text-cyan-400">{settings.minCashCustom}</td>
                  <td className="p-3 font-sans text-slate-400">3 months average expenses (or 25,000 base)</td>
                </tr>
                <tr className="hover:bg-slate-800/30">
                  <td className="p-3 font-sans font-semibold text-slate-200">Tax Slab Rate Assumption</td>
                  <td className="p-3 text-slate-300">30%</td>
                  <td className="p-3 font-sans text-slate-400">30% (safe default until explicitly configured)</td>
                </tr>
                <tr className="hover:bg-slate-800/30">
                  <td className="p-3 font-sans font-semibold text-slate-200">Include Tax in Liabilities</td>
                  <td className="p-3 text-slate-300">{settings.includeTaxInLiabilities ? 'ON' : 'OFF'}</td>
                  <td className="p-3 font-sans text-slate-400">ON (Deducts estimated tax from net worth)</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 6. FORMATS */}
      {activeSection === 'formats' && (
        <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
          <h3 className="text-sm font-bold text-white uppercase tracking-wider">Number & Date Formats</h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Number Grouping System</label>
              <select
                value={settings.numberGrouping}
                onChange={(e) => updateSettings({ numberGrouping: e.target.value as any })}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200"
              >
                <option value="inr">Indian Grouping (1,00,000 Lakh / 1,00,00,000 Crore)</option>
                <option value="international">International Grouping (100,000 / 1,000,000 Million)</option>
                <option value="auto">Auto (Indian for INR, International for others)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Date Format</label>
              <select
                value={settings.dateFormat}
                onChange={(e) => updateSettings({ dateFormat: e.target.value as any })}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200"
              >
                <option value="YYYY-MM-DD">YYYY-MM-DD (ISO standard)</option>
                <option value="DD/MM/YYYY">DD/MM/YYYY</option>
                <option value="MM/DD/YYYY">MM/DD/YYYY</option>
              </select>
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 flex items-center justify-between text-xs">
            <div>
              <span className="font-semibold text-slate-200">Financial Year Start Month</span>
              <p className="text-slate-400 text-[11px] mt-0.5">April for India (FY26-27), or January for calendar year.</p>
            </div>
            <select
              value={settings.fyStartMonth}
              onChange={(e) => updateSettings({ fyStartMonth: parseInt(e.target.value, 10) })}
              className="bg-slate-900 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-white"
            >
              <option value={4}>April (India)</option>
              <option value={1}>January (Calendar)</option>
              <option value={7}>July (Australia)</option>
            </select>
          </div>
        </div>
      )}

      {/* CATEGORIES (ASSETS & SPEND) */}
      {activeSection === 'categories' && (
        <div className="space-y-4">
          {/* Subtab Toggle */}
          <div className="flex items-center gap-2 p-1 rounded-2xl bg-slate-950 border border-slate-800">
            <button
              type="button"
              onClick={() => setCategorySubTab('assets')}
              className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                categorySubTab === 'assets'
                  ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Asset Categories & Types
            </button>
            <button
              type="button"
              onClick={() => setCategorySubTab('spend')}
              className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                categorySubTab === 'spend'
                  ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Spend & Expense Categories
            </button>
          </div>

          {categorySubTab === 'assets' ? (
            <AssetCategoriesManager />
          ) : (
            <SpendCategoriesManager />
          )}
        </div>
      )}

      {/* SCHEDULED INTERNAL TRANSFERS */}
      {activeSection === 'scheduled' && <ScheduledTransfersManager />}

      {/* SUBCONSCIOUS NUDGE PREFERENCES */}
      {activeSection === 'nudges' && <SubconsciousNudgePreferencesSection />}

      {/* REINFORCEMENT LEARNING & CREDIT HEALTH ENGINE */}
      {activeSection === 'ml' && <CreditAndMLEngineSection />}

      {/* 7. DATA & BACKUP */}
      {activeSection === 'data' && <DataManagementSection />}



      {/* Add Currency Modal */}
      {isCurrModalOpen && (
        <Modal
          isOpen={isCurrModalOpen}
          onClose={() => setIsCurrModalOpen(false)}
          title="Add New Currency"
          subtitle="Define foreign currency and current exchange rate to base"
        >
          <form onSubmit={handleSaveCurrency} className="space-y-4">
            {currError && (
              <div className="p-2.5 rounded-xl bg-rose-500/20 text-rose-300 text-xs">{currError}</div>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Currency Code (3 letters)</label>
              <input
                type="text"
                placeholder="e.g. SGD, JPY, CAD"
                maxLength={3}
                value={currCode}
                onChange={(e) => setCurrCode(e.target.value.toUpperCase())}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200 uppercase font-mono"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Currency Symbol</label>
                <input
                  type="text"
                  placeholder="e.g. S$, ¥, C$"
                  value={currSymbol}
                  onChange={(e) => setCurrSymbol(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">
                  Rate to 1 {settings.baseCurrency}
                </label>
                <input
                  type="number"
                  step="any"
                  placeholder="e.g. 64.5"
                  value={currRate}
                  onChange={(e) => setCurrRate(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200 font-mono"
                  required
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setIsCurrModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-md shadow-emerald-600/20 cursor-pointer"
              >
                Save Currency
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
};
