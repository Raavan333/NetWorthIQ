/**
 * Standalone On-Device SMS Bridge for NetWorthIQ
 *
 * Connects to the native Android Capacitor SmsReaderPlugin (`READ_SMS` / `RECEIVE_SMS`)
 * with 100% on-device execution (zero network calls).
 * If SMS permission is denied, revoked, or unavailable (e.g. PWA / desktop browser),
 * degrades gracefully to manual SMS / notification paste while preserving the same
 * internal staging queue and active reinforcement learning pipeline.
 */

import { Capacitor, registerPlugin, PluginListenerHandle } from '@capacitor/core';

export interface RawDeviceSmsMessage {
  id: string;
  sender?: string;
  body: string;
  timestampMs?: number;
}

export type SmsPermissionStatus = 'granted' | 'denied' | 'prompt' | 'manual_fallback';

interface NativeSmsReaderPlugin {
  checkSmsPermission(): Promise<{ state: string; granted: boolean }>;
  requestSmsPermission(): Promise<{ state: string; granted: boolean }>;
  readRecentSms(options?: {
    limit?: number;
    sinceTimestampMs?: number;
  }): Promise<{ granted: boolean; messages: RawDeviceSmsMessage[] }>;
  addListener(
    eventName: 'smsReceived',
    listenerFunc: (msg: RawDeviceSmsMessage) => void
  ): Promise<PluginListenerHandle>;
}

const NativeSmsReader = registerPlugin<NativeSmsReaderPlugin>('SmsReader');

/**
 * Returns true only when running inside the native Android Capacitor container.
 */
export function isNativeAndroidSmsSupported(): boolean {
  try {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
  } catch {
    return false;
  }
}

/**
 * Checks current standalone SMS permission status without triggering a system dialog.
 * Gracefully degrades to `'manual_fallback'` on Web/PWA or if revoked.
 */
export async function checkStandaloneSmsPermission(): Promise<SmsPermissionStatus> {
  if (!isNativeAndroidSmsSupported()) {
    return 'manual_fallback';
  }
  try {
    const res = await NativeSmsReader.checkSmsPermission();
    if (res.granted || res.state === 'granted') return 'granted';
    if (res.state === 'denied') return 'denied';
    return 'prompt';
  } catch {
    return 'manual_fallback';
  }
}

/**
 * Requests `READ_SMS` and `RECEIVE_SMS` permissions on Android.
 * Degrades cleanly to `'manual_fallback'` or `'denied'` if rejected or unsupported.
 */
export async function requestStandaloneSmsPermission(): Promise<SmsPermissionStatus> {
  if (!isNativeAndroidSmsSupported()) {
    return 'manual_fallback';
  }
  try {
    const res = await NativeSmsReader.requestSmsPermission();
    if (res.granted || res.state === 'granted') return 'granted';
    return 'denied';
  } catch {
    return 'manual_fallback';
  }
}

/**
 * Reads recent SMS messages strictly on-device from the Android Inbox cursor.
 * Returns `{ status, messages }` and never throws on permission denial.
 */
export async function readOnDeviceSmsInbox(options?: {
  limit?: number;
  sinceTimestampMs?: number;
}): Promise<{ status: SmsPermissionStatus; messages: RawDeviceSmsMessage[] }> {
  if (!isNativeAndroidSmsSupported()) {
    return { status: 'manual_fallback', messages: [] };
  }
  try {
    const perm = await checkStandaloneSmsPermission();
    if (perm !== 'granted') {
      return { status: perm, messages: [] };
    }
    const res = await NativeSmsReader.readRecentSms({
      limit: options?.limit ?? 100,
      sinceTimestampMs: options?.sinceTimestampMs ?? 0,
    });
    if (!res.granted) {
      return { status: 'denied', messages: [] };
    }
    return {
      status: 'granted',
      messages: Array.isArray(res.messages) ? res.messages : [],
    };
  } catch {
    return { status: 'manual_fallback', messages: [] };
  }
}

/**
 * Registers a real-time listener for incoming SMS broadcasts (`RECEIVE_SMS`).
 * Returns an unsubscribe callback. Safe no-op on Web/PWA or when permission is not granted.
 */
export async function subscribeToIncomingSms(
  onMessage: (msg: RawDeviceSmsMessage) => void
): Promise<() => void> {
  if (!isNativeAndroidSmsSupported()) {
    return () => {};
  }
  try {
    const handle = await NativeSmsReader.addListener('smsReceived', (msg) => {
      if (msg && typeof msg.body === 'string' && msg.body.trim().length > 0) {
        onMessage(msg);
      }
    });
    return () => {
      try {
        handle.remove();
      } catch {
        // ignore
      }
    };
  } catch {
    return () => {};
  }
}

/**
 * Splits a manual notification / multi-SMS paste block into discrete raw SMS entries
 * while keeping multi-line single bank messages intact.
 */
export function splitManualPastedSmsBatch(rawPaste: string): RawDeviceSmsMessage[] {
  const trimmed = (rawPaste || '').trim();
  if (!trimmed) return [];

  // Split by blank lines first; within a paragraph, only split per line if EVERY line is an independent standalone SMS
  // (has its own currency+amount AND its own account/movement/noise trigger, and is NOT a continuation clause like "On ...", "At ...", "by UPI ...", "Not You?", "Call ...")
  const paragraphs = trimmed
    .split(/\n\s*\n+/)
    .map((p) => p.trim())
    .filter(Boolean);

  const isStandaloneSmsLine = (line: string): boolean => {
    if (/^(?:on|at|by|via|not\s+you|call|sms\s+block|if\s+not|avl\.?\s*bal|available\s+limit)/i.test(line)) {
      return false;
    }
    const hasCurrencyAmt =
      /(?:rs\.?|inr|₹|\$|usd|eur|gbp)\s*[\d,]+(?:\.\d{1,2})?/i.test(line) ||
      /[\d,]+(?:\.\d{1,2})?\s*(?:rs\.?|inr|₹)\b/i.test(line);
    const hasNoiseTrigger = /\b(otp|verification\s+code|do\s+not\s+share|available\s+balance\s+is|statement\s+generated|loan\s+approved|apply\s+now|cashback\s+offer)\b/i.test(
      line
    );
    const hasAccountOrVerb =
      /\b(debited|credited|cr|dr|spent|paid|transferred|withdrawn|payment\s+of|a\/c|acct|card|imps|neft|upi)\b/i.test(
        line
      );
    return (hasCurrencyAmt && hasAccountOrVerb) || hasNoiseTrigger;
  };

  const chunks: string[] = [];
  for (const para of paragraphs) {
    const lines = para
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length > 1 && lines.every(isStandaloneSmsLine)) {
      chunks.push(...lines);
    } else {
      chunks.push(lines.join('\n'));
    }
  }

  const now = Date.now();
  return chunks.map((body, idx) => ({
    id: `manual-sms-${now}-${idx}`,
    sender: 'Manual Paste',
    body,
    timestampMs: now + idx,
  }));
}
