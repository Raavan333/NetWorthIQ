import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { verifyPinAndCheckUpgrade, hashPinArgon2id, generateSecureSalt } from '../../lib/securityArgon2';
import {
  Shield,
  Delete,
  Check,
  AlertTriangle,
  ArrowLeft,
  Lock,
} from 'lucide-react';

export const PinLockScreen: React.FC = () => {
  const { settings, updateSettings, unlockApp, wipeAllData } = useApp();

  // Determine whether user has already configured a PIN
  const isPinConfigured = Boolean(
    settings.pinHash && settings.pinHash.trim() !== '' && settings.pinSalt
  );

  // Setup mode states (for first-time users or unconfigured PIN)
  const [setupStep, setSetupStep] = useState<'create' | 'confirm'>('create');
  const [initialPin, setInitialPin] = useState<string>('');
  const [confirmPin, setConfirmPin] = useState<string>('');

  // Unlock mode states (for returning users)
  const [enteredPin, setEnteredPin] = useState<string>('');
  const [failedAttempts, setFailedAttempts] = useState<number>(0);

  // Shared UX states
  const [status, setStatus] = useState<'idle' | 'verifying' | 'success'>('idle');
  const [error, setError] = useState<string>('');
  const [isShaking, setIsShaking] = useState<boolean>(false);

  // Reset confirmation modal
  const [showResetDialog, setShowResetDialog] = useState<boolean>(false);
  const [resetConfirmWord, setResetConfirmWord] = useState<string>('');
  const [isResetting, setIsResetting] = useState<boolean>(false);

  // Current active digits depending on flow
  const currentDigits = !isPinConfigured
    ? setupStep === 'create'
      ? initialPin
      : confirmPin
    : enteredPin;

  // Trigger shake animation on error
  const triggerError = (msg: string) => {
    setError(msg);
    setIsShaking(true);
    setTimeout(() => setIsShaking(false), 450);
  };

  // 1. FIRST-TIME PIN SETUP: Handle Digit Input
  const handleSetupDigit = async (digit: string) => {
    if (status !== 'idle') return;
    setError('');

    if (setupStep === 'create') {
      if (initialPin.length >= 4) return;
      const nextPin = initialPin + digit;
      setInitialPin(nextPin);

      // Once 4 digits are entered, transition to confirmation step
      if (nextPin.length === 4) {
        setTimeout(() => {
          setSetupStep('confirm');
          setConfirmPin('');
          setError('');
        }, 180);
      }
    } else {
      // Step 2: Confirming PIN
      if (confirmPin.length >= 4) return;
      const nextConfirm = confirmPin + digit;
      setConfirmPin(nextConfirm);

      if (nextConfirm.length === 4) {
        if (nextConfirm === initialPin) {
          // PINs match! Save salted hash to settings and unlock vault
          setStatus('verifying');
          try {
            const salt = generateSecureSalt(16);
            const hash = await hashPinArgon2id(nextConfirm, salt);
            await updateSettings({
              pinLockEnabled: true,
              pinSalt: salt,
              pinHash: hash,
            });
            setStatus('success');
            setTimeout(() => {
              unlockApp();
            }, 300);
          } catch {
            triggerError('Failed to save PIN. Please retry.');
            setStatus('idle');
            setConfirmPin('');
          }
        } else {
          // Mismatch
          triggerError("PINs don't match. Please try again.");
          setTimeout(() => {
            setConfirmPin('');
          }, 350);
        }
      }
    }
  };

  // 2. UNLOCK VAULT: Handle Digit Input
  const handleUnlockDigit = async (digit: string) => {
    if (status !== 'idle' || enteredPin.length >= 4) return;
    setError('');
    const nextPin = enteredPin + digit;
    setEnteredPin(nextPin);

    if (nextPin.length === 4) {
      setStatus('verifying');
      try {
        const verifyResult = await verifyPinAndCheckUpgrade(nextPin, settings.pinSalt, settings.pinHash);
        if (verifyResult.isValid) {
          // If legacy hash was verified, seamlessly upgrade stored hash to Argon2id
          if (verifyResult.needsUpgrade && verifyResult.newHash) {
            updateSettings({ pinHash: verifyResult.newHash });
          }
          setStatus('success');
          setFailedAttempts(0);
          setError('');
          setTimeout(() => {
            unlockApp();
          }, 260);
        } else {
          const nextFailed = failedAttempts + 1;
          setFailedAttempts(nextFailed);
          setStatus('idle');
          if (nextFailed >= 5) {
            triggerError('Too many failed attempts. Temporary security lockout active.');
          } else if (nextFailed >= 3) {
            triggerError('Incorrect PIN. You can reset below if forgotten.');
          } else {
            triggerError('Incorrect PIN');
          }
          setTimeout(() => {
            setEnteredPin('');
          }, 350);
        }
      } catch {
        setStatus('idle');
        triggerError('Verification error');
        setTimeout(() => {
          setEnteredPin('');
        }, 350);
      }
    }
  };

  const handleDigit = (digit: string) => {
    if (!isPinConfigured) {
      handleSetupDigit(digit);
    } else {
      handleUnlockDigit(digit);
    }
  };

  const handleDelete = () => {
    if (status !== 'idle') return;
    setError('');
    if (!isPinConfigured) {
      if (setupStep === 'create') {
        setInitialPin((prev) => prev.slice(0, -1));
      } else {
        setConfirmPin((prev) => prev.slice(0, -1));
      }
    } else {
      setEnteredPin((prev) => prev.slice(0, -1));
    }
  };

  const handleClear = () => {
    if (status !== 'idle') return;
    setError('');
    if (!isPinConfigured) {
      if (setupStep === 'create') {
        setInitialPin('');
      } else {
        setConfirmPin('');
      }
    } else {
      setEnteredPin('');
    }
  };

  // Physical keyboard support
  useEffect(() => {
    if (showResetDialog) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key >= '0' && e.key <= '9') {
        handleDigit(e.key);
      } else if (e.key === 'Backspace') {
        handleDelete();
      } else if (e.key === 'Escape') {
        handleClear();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    isPinConfigured,
    setupStep,
    initialPin,
    confirmPin,
    enteredPin,
    status,
    showResetDialog,
  ]);

  // Factory reset to purge data and start fresh
  const handlePerformReset = async () => {
    if (resetConfirmWord.trim().toUpperCase() !== 'RESET') return;
    setIsResetting(true);
    try {
      await wipeAllData();
      await updateSettings({
        pinLockEnabled: true,
        pinHash: '',
        pinSalt: '',
      });
      setShowResetDialog(false);
      setResetConfirmWord('');
      setFailedAttempts(0);
      setEnteredPin('');
      setInitialPin('');
      setConfirmPin('');
      setSetupStep('create');
      setStatus('idle');
      setError('');
    } catch {
      setError('Failed to purge vault data.');
    } finally {
      setIsResetting(false);
    }
  };

  // Dial keypad keys
  const keypadKeys = [
    { num: '1', letters: '' },
    { num: '2', letters: 'ABC' },
    { num: '3', letters: 'DEF' },
    { num: '4', letters: 'GHI' },
    { num: '5', letters: 'JKL' },
    { num: '6', letters: 'MNO' },
    { num: '7', letters: 'PQRS' },
    { num: '8', letters: 'TUV' },
    { num: '9', letters: 'WXYZ' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#070b14] text-slate-100 select-none overflow-y-auto px-4 py-3 sm:py-8 min-h-[100dvh]">
      {/* Ambient lighting backdrop */}
      <div
        className="fixed inset-0 pointer-events-none opacity-30 z-0"
        style={{
          background:
            'radial-gradient(ellipse at 50% 20%, rgba(16, 185, 129, 0.16) 0%, transparent 60%), radial-gradient(ellipse at 50% 80%, rgba(6, 78, 59, 0.14) 0%, transparent 55%)',
        }}
      />

      {/* Responsive Vault Container */}
      <div className="relative z-10 w-full max-w-[350px] sm:max-w-[380px] flex flex-col items-center justify-between sm:justify-center my-auto py-1 sm:py-3 gap-2 sm:gap-3">
        {/* Security Emblem Header */}
        <header className="flex flex-col items-center text-center">
          <div className="relative w-12 h-12 sm:w-15 sm:h-15 flex items-center justify-center mb-1.5 sm:mb-2.5">
            <div
              className={`absolute inset-0 rounded-2xl blur-xl transition-all duration-300 ${
                error
                  ? 'bg-rose-500/40'
                  : status === 'success'
                  ? 'bg-emerald-400/50 scale-110'
                  : 'bg-emerald-500/20'
              }`}
            />

            <div
              className={`relative w-11 h-11 sm:w-14 sm:h-14 rounded-2xl flex items-center justify-center border shadow-xl backdrop-blur-xl transition-all duration-300 ${
                error
                  ? 'bg-rose-950/70 border-rose-500/70 text-rose-400 shadow-rose-950/50 animate-shake'
                  : status === 'success'
                  ? 'bg-emerald-950/70 border-emerald-400 text-emerald-300 shadow-emerald-950/60 scale-105'
                  : 'bg-slate-900/90 border-slate-700/70 text-emerald-400 shadow-black/60'
              }`}
            >
              {status === 'success' ? (
                <Check size={22} className="text-emerald-400 stroke-[2.5]" />
              ) : status === 'verifying' ? (
                <Lock size={19} className="text-emerald-400 stroke-[2.2]" />
              ) : (
                <Shield size={21} className="stroke-[2.2] text-emerald-400" />
              )}
            </div>
          </div>

          <h1 className="text-lg sm:text-xl font-bold tracking-tight text-white">
            {settings.appName || 'NetWorthIQ'}
          </h1>
          <p className="text-[11px] text-slate-400 tracking-wider uppercase font-medium mt-0.5">
            Encrypted Offline Vault
          </p>
          <div className="flex items-center gap-1.5 mt-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-[10px] font-mono text-emerald-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span>Compounding Active 24/7 · Background Live</span>
          </div>
        </header>

        {/* Passcode Instruction */}
        <div className="text-center">
          <h2 className="text-sm sm:text-base font-semibold text-slate-100 tracking-tight">
            {!isPinConfigured
              ? setupStep === 'create'
                ? 'Create 4-Digit Passcode'
                : 'Confirm Passcode'
              : 'Enter Passcode'}
          </h2>
          {!isPinConfigured && (
            <p className="text-xs text-slate-400 mt-0.5">
              {setupStep === 'create'
                ? 'Set a 4-digit PIN to protect your local portfolio'
                : 'Re-enter your 4-digit PIN to verify'}
            </p>
          )}
        </div>

        {/* 4 Passcode Dots */}
        <div
          className={`flex items-center justify-center gap-4 h-7 transition-transform ${
            isShaking ? 'animate-shake' : ''
          }`}
          aria-live="polite"
        >
          {[0, 1, 2, 3].map((index) => {
            const isFilled = index < currentDigits.length;
            const isSuccess = status === 'success';

            return (
              <div
                key={index}
                className={`w-3.5 h-3.5 sm:w-4 sm:h-4 rounded-full transition-all duration-200 ${
                  error
                    ? 'bg-rose-500 border border-rose-400 shadow-md shadow-rose-500/50 scale-105'
                    : isSuccess
                    ? 'bg-emerald-400 scale-115 shadow-lg shadow-emerald-400/80'
                    : isFilled
                    ? 'bg-emerald-400 scale-110 shadow-md shadow-emerald-400/50 ring-2 ring-emerald-400/25'
                    : 'border-2 border-slate-700 bg-slate-900/80'
                }`}
              />
            );
          })}
        </div>

        {/* Dynamic status feedback text without layout shift */}
        <div className="min-h-[20px] flex items-center justify-center text-center px-2">
          {error ? (
            <p className="text-xs font-semibold text-rose-400 animate-fade-in flex items-center gap-1.5">
              <AlertTriangle size={14} className="shrink-0" />
              <span>{error}</span>
            </p>
          ) : status === 'success' ? (
            <p className="text-xs font-semibold text-emerald-400 animate-fade-in flex items-center gap-1.5">
              <Check size={14} className="shrink-0" />
              <span>{!isPinConfigured ? 'Passcode Configured' : 'Vault Unlocked'}</span>
            </p>
          ) : status === 'verifying' ? (
            <p className="text-xs font-medium text-slate-400">
              Verifying credentials...
            </p>
          ) : null}
        </div>

        {/* Fluid Tactile 3x4 Dial Keypad */}
        <div className="grid grid-cols-3 gap-2 sm:gap-3 w-full">
          {keypadKeys.map(({ num, letters }) => (
            <button
              key={num}
              type="button"
              onClick={() => handleDigit(num)}
              disabled={status !== 'idle'}
              className="min-h-[48px] h-[clamp(50px,7.8dvh,64px)] rounded-2xl bg-slate-900/90 hover:bg-slate-800/90 active:bg-emerald-500/25 active:border-emerald-400 active:scale-95 border border-slate-800/90 hover:border-slate-700 flex flex-col items-center justify-center transition-all duration-100 cursor-pointer shadow-md shadow-black/40 disabled:opacity-40 select-none group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
              aria-label={`Digit ${num}`}
            >
              <span className="text-xl sm:text-2xl font-bold tabular-nums text-slate-100 leading-none group-active:text-emerald-300">
                {num}
              </span>
              {letters ? (
                <span className="text-[10px] font-semibold tracking-wider text-slate-400 uppercase mt-1 leading-none">
                  {letters}
                </span>
              ) : (
                <span className="h-[10px] mt-1" />
              )}
            </button>
          ))}

          {/* Bottom Left Control: Back / Clear */}
          {!isPinConfigured && setupStep === 'confirm' ? (
            <button
              type="button"
              onClick={() => {
                setSetupStep('create');
                setInitialPin('');
                setConfirmPin('');
                setError('');
              }}
              disabled={status !== 'idle'}
              className="min-h-[48px] h-[clamp(50px,7.8dvh,64px)] rounded-2xl bg-slate-900/60 hover:bg-slate-800 active:scale-95 border border-slate-800 flex flex-col items-center justify-center text-slate-300 hover:text-white transition-all cursor-pointer text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
              title="Return to Step 1"
            >
              <ArrowLeft size={17} />
              <span className="text-[11px] mt-0.5">Back</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={handleClear}
              disabled={status !== 'idle' || currentDigits.length === 0}
              className="min-h-[48px] h-[clamp(50px,7.8dvh,64px)] rounded-2xl bg-slate-900/60 hover:bg-slate-800 active:scale-95 border border-slate-800 flex items-center justify-center text-xs sm:text-sm font-semibold text-slate-300 hover:text-white transition-all cursor-pointer disabled:opacity-25 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
            >
              Clear
            </button>
          )}

          {/* Zero Button */}
          <button
            type="button"
            onClick={() => handleDigit('0')}
            disabled={status !== 'idle'}
            className="min-h-[48px] h-[clamp(50px,7.8dvh,64px)] rounded-2xl bg-slate-900/90 hover:bg-slate-800/90 active:bg-emerald-500/25 active:border-emerald-400 active:scale-95 border border-slate-800/90 hover:border-slate-700 flex flex-col items-center justify-center transition-all duration-100 cursor-pointer shadow-md shadow-black/40 disabled:opacity-40 select-none group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
            aria-label="Digit 0"
          >
            <span className="text-xl sm:text-2xl font-bold tabular-nums text-slate-100 leading-none group-active:text-emerald-300">
              0
            </span>
          </button>

          {/* Backspace Button */}
          <button
            type="button"
            onClick={handleDelete}
            disabled={status !== 'idle' || currentDigits.length === 0}
            className="min-h-[48px] h-[clamp(50px,7.8dvh,64px)] rounded-2xl bg-slate-900/60 hover:bg-slate-800 active:scale-95 border border-slate-800 flex items-center justify-center text-slate-300 hover:text-white transition-all cursor-pointer disabled:opacity-25 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
            aria-label="Delete last digit"
          >
            <Delete size={21} />
          </button>
        </div>

        {/* Footer Zone: Recovery Option */}
        <footer className="w-full flex justify-center pt-1">
          {isPinConfigured ? (
            <button
              type="button"
              onClick={() => setShowResetDialog(true)}
              className="min-h-[40px] text-xs text-slate-400 hover:text-rose-400 transition-colors py-2 px-4 rounded-xl hover:bg-slate-900/60 cursor-pointer font-medium"
            >
              Forgot Passcode?
            </button>
          ) : (
            <div className="h-4" />
          )}
        </footer>
      </div>

      {/* Reset Vault Confirmation Modal */}
      {showResetDialog && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fade-in">
          <div className="w-full max-w-sm rounded-2xl bg-slate-900 border border-slate-800 p-5 shadow-2xl">
            <div className="flex items-center gap-2 text-rose-400 mb-2">
              <AlertTriangle size={18} />
              <h2 className="text-sm font-bold text-white">Reset Vault</h2>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed mb-4">
              Resetting will clear your PIN and purge local offline data. Type <strong className="text-rose-400 font-mono">RESET</strong> to confirm.
            </p>
            <input
              type="text"
              placeholder="Type RESET"
              value={resetConfirmWord}
              onChange={(e) => setResetConfirmWord(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 focus:border-rose-500 focus:outline-none rounded-xl px-3 py-2 text-sm text-white font-mono uppercase mb-4"
              autoFocus
            />
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => {
                  setShowResetDialog(false);
                  setResetConfirmWord('');
                }}
                className="px-3 py-1.5 rounded-lg bg-slate-800 text-xs font-semibold text-slate-300 hover:bg-slate-700 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handlePerformReset}
                disabled={resetConfirmWord.trim().toUpperCase() !== 'RESET' || isResetting}
                className={`px-4 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-colors ${
                  resetConfirmWord.trim().toUpperCase() === 'RESET'
                    ? 'bg-rose-600 hover:bg-rose-500 text-white'
                    : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                }`}
              >
                {isResetting ? 'Resetting...' : 'Reset'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
