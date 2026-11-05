import React, { useState, useEffect, useMemo } from 'react';
import { Modal } from './Modal';
import {
  downloadFile,
  createDownloadBlobUrl,
  copyTextToClipboard,
  saveFileViaPicker,
  isNativePlatform,
} from '../../lib/downloadHelper';
import {
  Download,
  Copy,
  Check,
  FileText,
  Save,
} from 'lucide-react';

interface ExportDownloadModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  filename: string;
  content: string;
  mimeType: string;
}

export const ExportDownloadModal: React.FC<ExportDownloadModalProps> = ({
  isOpen,
  onClose,
  title,
  filename,
  content,
  mimeType,
}) => {
  const [copied, setCopied] = useState(false);
  const [downloadTriggered, setDownloadTriggered] = useState(false);
  const [hasPicker, setHasPicker] = useState(false);
  const isNative = isNativePlatform();
  const [isSavingNative, setIsSavingNative] = useState(false);
  const [nativeStatus, setNativeStatus] = useState<string | null>(null);

  const isJson = mimeType.includes('json') || filename.toLowerCase().endsWith('.json');
  const copyLabel = isJson ? 'Copy JSON' : mimeType.includes('csv') ? 'Copy CSV' : 'Copy Text';

  useEffect(() => {
    const inIframe = (() => {
      try {
        return window.self !== window.top;
      } catch {
        return true;
      }
    })();
    setHasPicker(typeof window !== 'undefined' && !inIframe && 'showSaveFilePicker' in window);
  }, []);

  const blobUrl = useMemo(() => {
    if (!content) return '';
    try {
      return createDownloadBlobUrl(content, mimeType);
    } catch {
      return '';
    }
  }, [content, mimeType]);

  useEffect(() => {
    return () => {
      if (blobUrl) {
        try {
          URL.revokeObjectURL(blobUrl);
        } catch {}
      }
    };
  }, [blobUrl]);

  const handleDownloadClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    setDownloadTriggered(true);
    setTimeout(() => setDownloadTriggered(false), 3000);
    if (!blobUrl) {
      e.preventDefault();
      downloadFile(filename, content, mimeType);
    }
  };

  const handleNativeSave = async () => {
    setIsSavingNative(true);
    setNativeStatus(null);
    try {
      const success = await downloadFile(filename, content, mimeType);
      setNativeStatus(success ? 'Saved' : 'Saved to Documents');
      setDownloadTriggered(true);
      setTimeout(() => setDownloadTriggered(false), 3500);
    } catch (err) {
      console.error('Native save error:', err);
      setNativeStatus('Saved to Documents');
    } finally {
      setIsSavingNative(false);
    }
  };

  const handleCopy = async () => {
    const ok = await copyTextToClipboard(content);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  const handleSaveAsPicker = async () => {
    const saved = await saveFileViaPicker(filename, content, mimeType);
    if (saved) {
      setDownloadTriggered(true);
      setTimeout(() => setDownloadTriggered(false), 3000);
    } else {
      await downloadFile(filename, content, mimeType);
      setDownloadTriggered(true);
      setTimeout(() => setDownloadTriggered(false), 3000);
    }
  };

  const lineCount = content ? content.split('\n').length : 0;
  const fileSizeKb = content ? (new Blob([content]).size / 1024).toFixed(1) : '0';

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title || 'Export Data'}
      subtitle={filename}
      maxWidth="max-w-2xl"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2.5 w-full">
          <div className="text-[11px] text-slate-400 font-mono">
            {lineCount} lines · {fileSizeKb} KB
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={handleCopy}
              className={`px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                copied
                  ? 'bg-emerald-500 text-slate-950'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'
              }`}
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              <span>{copied ? 'Copied' : copyLabel}</span>
            </button>

            {hasPicker && !isNative && (
              <button
                type="button"
                onClick={handleSaveAsPicker}
                className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-all"
              >
                <Save size={14} />
                <span>Save As</span>
              </button>
            )}

            {isNative ? (
              <button
                type="button"
                onClick={handleNativeSave}
                disabled={isSavingNative}
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-all"
              >
                <Download size={14} />
                <span>
                  {isSavingNative
                    ? 'Saving...'
                    : nativeStatus || (downloadTriggered ? 'Saved' : 'Save & Share')}
                </span>
              </button>
            ) : (
              <a
                href={blobUrl || '#'}
                download={filename}
                rel="noopener"
                onClick={handleDownloadClick}
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-all no-underline"
              >
                <Download size={14} />
                <span>{downloadTriggered ? 'Downloaded' : 'Download File'}</span>
              </a>
            )}
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText size={15} className="text-emerald-400" />
            <span className="text-xs font-semibold text-slate-200 font-mono">{filename}</span>
          </div>
          <button
            type="button"
            onClick={handleCopy}
            className="text-xs text-emerald-400 hover:text-emerald-300 font-medium flex items-center gap-1 cursor-pointer transition-colors"
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
            <span>{copied ? 'Copied' : copyLabel}</span>
          </button>
        </div>

        <textarea
          readOnly
          value={content}
          onFocus={(e) => e.target.select()}
          rows={11}
          className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs font-mono text-slate-300 focus:outline-none focus:border-emerald-500 resize-none selection:bg-emerald-500/30"
        />
      </div>
    </Modal>
  );
};
