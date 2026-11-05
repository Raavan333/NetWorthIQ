import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

/**
 * Universal file download, native Android save/share, and clipboard helper.
 * - On Web / AI Studio preview: executes synchronous Blob URL `<a download>` click
 *   within the active user gesture (avoiding async Web Share calls that consume
 *   transient user activation inside cross-origin iframes).
 * - On Android / iOS Capacitor APK: writes directly via `@capacitor/filesystem`
 *   to Documents (with Cache fallback) and opens the native Share sheet.
 */

export function isNativePlatform(): boolean {
  if (typeof window === 'undefined') return false;
  return Capacitor.isNativePlatform() || Boolean((window as any).Capacitor?.isNativePlatform?.());
}

export function createDownloadBlobUrl(content: string, mimeType: string = 'text/plain'): string {
  let finalContent = content;
  if (mimeType.includes('csv') && !content.startsWith('\uFEFF')) {
    finalContent = '\uFEFF' + content;
  }
  const blob = new Blob([finalContent], { type: `${mimeType};charset=utf-8` });
  return URL.createObjectURL(blob);
}

export function createDownloadDataUri(content: string, mimeType: string = 'text/plain'): string {
  let finalContent = content;
  if (mimeType.includes('csv') && !content.startsWith('\uFEFF')) {
    finalContent = '\uFEFF' + content;
  }
  return `data:${mimeType};charset=utf-8,${encodeURIComponent(finalContent)}`;
}

/**
 * Reliable clipboard copy that works across modern browsers, restricted iframes, and Android WebViews.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;

  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to synchronous execCommand fallback (common in sandboxed iframes)
    }
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '0';
    textarea.style.left = '-9999px';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    const copied = document.execCommand('copy');
    document.body.removeChild(textarea);
    return copied;
  } catch (err) {
    console.error('Clipboard copy failed:', err);
    return false;
  }
}

export async function saveFileViaPicker(
  filename: string,
  content: string,
  mimeType: string = 'text/plain'
): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  // Note: showSaveFilePicker throws SecurityError inside cross-origin iframes (like AI Studio preview)
  const isInIframe = (() => {
    try {
      return window.self !== window.top;
    } catch {
      return true;
    }
  })();
  if (isInIframe) return false;

  if ('showSaveFilePicker' in window && typeof (window as any).showSaveFilePicker === 'function') {
    try {
      let finalContent = content;
      if (mimeType.includes('csv') && !content.startsWith('\uFEFF')) {
        finalContent = '\uFEFF' + content;
      }
      const ext = filename.includes('.') ? filename.substring(filename.lastIndexOf('.')) : '.txt';
      const cleanMime = mimeType.split(';')[0].trim() || 'text/plain';
      const fileHandle = await (window as any).showSaveFilePicker({
        suggestedName: filename,
        types: [
          {
            description: `${ext.toUpperCase()} File`,
            accept: { [cleanMime]: [ext] },
          },
        ],
      });
      const writable = await fileHandle.createWritable();
      await writable.write(finalContent);
      await writable.close();
      return true;
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        return false;
      }
      console.warn('showSaveFilePicker unavailable, falling back to anchor download:', err);
    }
  }
  return false;
}

/**
 * Synchronous web browser download trigger so user activation is never lost.
 */
function triggerBrowserDownloadSync(filename: string, finalContent: string, mimeType: string): boolean {
  try {
    const cleanMime = mimeType.split(';')[0].trim() || 'application/octet-stream';
    const blob = new Blob([finalContent], { type: `${cleanMime};charset=utf-8` });

    if (typeof (window.navigator as any).msSaveOrOpenBlob === 'function') {
      (window.navigator as any).msSaveOrOpenBlob(blob, filename);
      return true;
    }

    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = filename;
    link.setAttribute('download', filename);
    link.rel = 'noopener';
    link.style.display = 'none';

    document.body.appendChild(link);
    link.click();

    setTimeout(() => {
      try {
        if (document.body.contains(link)) {
          document.body.removeChild(link);
        }
        URL.revokeObjectURL(objectUrl);
      } catch {}
    }, 60000);

    return true;
  } catch (err) {
    console.warn('Blob download failed, trying Data URI fallback:', err);
    try {
      const dataUri = createDownloadDataUri(finalContent, mimeType);
      const link = document.createElement('a');
      link.href = dataUri;
      link.download = filename;
      link.setAttribute('download', filename);
      link.style.display = 'none';

      document.body.appendChild(link);
      link.click();

      setTimeout(() => {
        try {
          if (document.body.contains(link)) {
            document.body.removeChild(link);
          }
        } catch {}
      }, 15000);

      return true;
    } catch (fallbackErr) {
      console.error('Data URI download fallback failed:', fallbackErr);
      return false;
    }
  }
}

export async function downloadFile(
  filename: string,
  content: string,
  mimeType: string = 'text/plain'
): Promise<boolean> {
  if (typeof window === 'undefined') return false;

  let finalContent = content;
  if (mimeType.includes('csv') && !content.startsWith('\uFEFF')) {
    finalContent = '\uFEFF' + content;
  }

  // 1. Native Android / iOS Capacitor APK Environment
  if (isNativePlatform()) {
    try {
      const writeResult = await Filesystem.writeFile({
        path: filename,
        data: finalContent,
        directory: Directory.Documents,
        encoding: Encoding.UTF8,
        recursive: true,
      });

      try {
        await Share.share({
          title: filename,
          text: filename,
          url: writeResult.uri,
          dialogTitle: `Save or Share ${filename}`,
        });
      } catch {
        // User dismissed share sheet; file remains saved in Documents
      }

      return true;
    } catch (nativeErr) {
      console.warn('Capacitor Documents write failed, trying Cache:', nativeErr);
      try {
        const cacheResult = await Filesystem.writeFile({
          path: filename,
          data: finalContent,
          directory: Directory.Cache,
          encoding: Encoding.UTF8,
          recursive: true,
        });

        await Share.share({
          title: filename,
          text: filename,
          url: cacheResult.uri,
          dialogTitle: `Save or Share ${filename}`,
        });
        return true;
      } catch (cacheErr) {
        console.error('All native file writes failed:', cacheErr);
      }
    }
  }

  // 2. Web Browser & Preview Iframe: Immediate synchronous anchor download
  return triggerBrowserDownloadSync(filename, finalContent, mimeType);
}

/**
 * Sequential downloader for multiple files to avoid browser multi-download blockers.
 */
export async function downloadMultipleFiles(
  files: { filename: string; content: string; mimeType: string }[],
  delayMs: number = 350
): Promise<void> {
  for (let index = 0; index < files.length; index++) {
    const file = files[index];
    await downloadFile(file.filename, file.content, file.mimeType);
    if (index < files.length - 1) {
      await new Promise((res) => setTimeout(res, delayMs));
    }
  }
}
