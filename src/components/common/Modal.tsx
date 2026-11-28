import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useBackDismiss } from '../../lib/modalBackStack';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  maxWidth?: string;
  footer?: React.ReactNode;
  variant?: 'default' | 'danger-glow';
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  maxWidth = 'max-w-xl',
  footer,
  variant = 'default',
}) => {
  const contentBodyRef = useRef<HTMLDivElement>(null);

  useBackDismiss(isOpen, onClose);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      if (contentBodyRef.current) {
        contentBodyRef.current.scrollTop = 0;
      }
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const isDangerGlow = variant === 'danger-glow';

  const modalContent = (
    <div
      className={`fixed inset-0 z-[100] flex flex-col sm:items-center sm:justify-center p-0 sm:p-4 backdrop-blur-sm overflow-hidden animate-fade-in ${
        isDangerGlow ? 'bg-rose-950/45' : 'bg-black/85'
      }`}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className={`w-full ${maxWidth || 'max-w-xl'} h-full sm:h-auto max-h-[100dvh] sm:max-h-[88dvh] bg-slate-900 sm:rounded-2xl rounded-none flex flex-col relative overflow-hidden my-0 sm:my-auto transition-all duration-200 ${
          isDangerGlow
            ? 'border-2 border-rose-500 ring-4 ring-rose-500/45 shadow-[0_0_65px_rgba(244,63,94,0.85)]'
            : 'sm:border border-slate-800 shadow-2xl'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Pinned Sticky Header */}
        <div
          className={`flex items-center justify-between px-4 sm:px-5 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:pt-3 border-b shrink-0 z-30 transition-colors ${
            isDangerGlow
              ? 'border-rose-500/60 bg-rose-950/75'
              : 'border-slate-800 bg-slate-900'
          }`}
        >
          <div className="min-w-0 pr-2">
            <h2
              className={`text-base sm:text-lg font-bold truncate ${
                isDangerGlow ? 'text-rose-50' : 'text-slate-100'
              }`}
            >
              {title}
            </h2>
            {subtitle && (
              <p
                className={`text-[11px] sm:text-xs mt-0.5 line-clamp-1 ${
                  isDangerGlow ? 'text-rose-200/90' : 'text-slate-400'
                }`}
              >
                {subtitle}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className={`min-w-[44px] min-h-[44px] sm:min-w-[36px] sm:min-h-[36px] rounded-xl active:scale-95 flex items-center justify-center transition-colors shrink-0 cursor-pointer ${
              isDangerGlow
                ? 'bg-rose-900/70 hover:bg-rose-800 text-rose-100'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-100'
            }`}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Scrollable Content Body */}
        <div
          ref={contentBodyRef}
          className="p-4 sm:p-5 overflow-y-auto flex-1 min-h-0 overscroll-contain text-slate-200"
          style={{ WebkitOverflowScrolling: 'touch' }}
        >
          {children}
        </div>

        {/* Pinned Sticky Footer */}
        {footer && (
          <div
            className={`px-4 sm:px-5 py-3 border-t shrink-0 z-30 safe-area-pb ${
              isDangerGlow
                ? 'border-rose-500/50 bg-rose-950/50'
                : 'border-slate-800 bg-slate-900'
            }`}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(modalContent, document.body) : modalContent;
};
