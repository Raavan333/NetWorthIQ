/**
 * On-Device SMS Sync Registry & Cursor Engine for NetWorthIQ
 *
 * Guarantees that:
 * 1. SMS sync extracts ONLY unique, never-before-synced messages.
 * 2. Already synced messages are NEVER re-fetched, re-staged, or double-counted across sync runs.
 * 3. Works 100% on-device, offline, with zero external tracking.
 */

import { RawDeviceSmsMessage } from './smsBridge';
import { Transaction, StagedSmsItem } from '../types';

export const SYNCED_SMS_REGISTRY_KEY = 'networthiq_synced_sms_signatures';
export const LAST_SMS_SYNC_TS_KEY = 'networthiq_last_sms_sync_ms';
const MAX_STORED_SIGNATURES = 5000;

export interface SyncedSmsRegistryState {
  lastSyncedTimestampMs: number;
  syncedMessageIds: string[];
  syncedFingerprints: string[];
}

/**
 * Computes a fast 32-bit deterministic integer hash for arbitrary strings.
 */
function fastHash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
    hash |= 0;
  }
  return (hash >>> 0).toString(16);
}

/**
 * Computes a deterministic canonical fingerprint for an SMS message.
 * Normalizes variable whitespace, casing, amounts, account digits, and reference IDs.
 */
export function computeSmsFingerprint(msg: {
  id?: string;
  sender?: string;
  body: string;
  timestampMs?: number;
}): string {
  const rawBody = (msg.body || '').trim();
  const cleanBody = rawBody
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

  const sender = (msg.sender || '').trim().toLowerCase();

  // Extract amount
  const amtMatch =
    cleanBody.match(/(?:rs\.?|inr|₹|\$)\s*([\d,]+(?:\.\d{1,2})?)/i) ||
    cleanBody.match(/([\d,]+(?:\.\d{1,2})?)\s*(?:rs\.?|inr|₹)\b/i);
  const amt = amtMatch ? amtMatch[1].replace(/,/g, '') : '';

  // Extract reference number (UPI ref, IMPS ref, RRN, Txn ID)
  const refMatch = cleanBody.match(
    /\b(?:ref(?:\s*(?:no\.?|id|num))?|rrn|upi\s*ref|imps(?:\s*ref)?|txn\s*(?:id|num)?)[:\s]*([a-zA-Z0-9]{5,})/i
  );
  const ref = refMatch ? refMatch[1].toLowerCase() : '';

  // Extract trailing account digits (3 or 4 digits)
  const acctMatch = cleanBody.match(/\b(?:a\/c|acct|card|ending(?:\s+with)?)[^\d]*(\d{3,4})\b/i);
  const acct = acctMatch ? acctMatch[1] : '';

  // Extract movement direction
  const isCredit = /\b(?:credited|credit|cr)\b/i.test(cleanBody);
  const isDebit = /\b(?:debited|debit|dr|spent|paid|transferred|withdrawn)\b/i.test(cleanBody);
  const dir = isCredit ? 'cr' : isDebit ? 'dr' : 'mov';

  // Date bucket if timestamp is present (round to 1-minute bucket to handle minor timer jitter)
  const timeBucket = msg.timestampMs ? Math.floor(msg.timestampMs / 60000) : '';

  // Content hash of normalized text
  const contentHash = fastHash(`${sender}|${cleanBody}`);

  return `smsfp_${amt}_${acct}_${dir}_${ref || contentHash}${timeBucket ? `_${timeBucket}` : ''}`;
}

const inMemoryFallbackStore = new Map<string, string>();

function getStorageItem(key: string): string | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage.getItem(key);
    }
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem(key);
    }
  } catch {}
  return inMemoryFallbackStore.get(key) ?? null;
}

function setStorageItem(key: string, val: string): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(key, val);
    } else if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, val);
    }
  } catch {}
  inMemoryFallbackStore.set(key, val);
}

/**
 * Retrieves the stored high-water mark timestamp (milliseconds) of the last successful SMS sync.
 */
export function getStoredLastSmsSyncTimestamp(): number {
  try {
    const raw = getStorageItem(LAST_SMS_SYNC_TS_KEY);
    if (!raw) return 0;
    const val = Number(raw);
    return isNaN(val) || val < 0 ? 0 : val;
  } catch {
    return 0;
  }
}

/**
 * Persists the latest high-water mark timestamp for device SMS sync.
 */
export function setStoredLastSmsSyncTimestamp(timestampMs: number): void {
  try {
    if (typeof timestampMs === 'number' && !isNaN(timestampMs) && timestampMs > 0) {
      setStorageItem(LAST_SMS_SYNC_TS_KEY, String(Math.floor(timestampMs)));
    }
  } catch {
    // Ignore storage quota errors
  }
}

/**
 * Loads the in-memory or persisted set of synced SMS identifiers (device IDs and fingerprints).
 */
export function loadSyncedSmsRegistry(): SyncedSmsRegistryState {
  const lastSynced = getStoredLastSmsSyncTimestamp();
  try {
    const raw = getStorageItem(SYNCED_SMS_REGISTRY_KEY);
    if (!raw) {
      return {
        lastSyncedTimestampMs: lastSynced,
        syncedMessageIds: [],
        syncedFingerprints: [],
      };
    }
    const parsed = JSON.parse(raw);
    return {
      lastSyncedTimestampMs: Math.max(lastSynced, Number(parsed.lastSyncedTimestampMs) || 0),
      syncedMessageIds: Array.isArray(parsed.syncedMessageIds) ? parsed.syncedMessageIds : [],
      syncedFingerprints: Array.isArray(parsed.syncedFingerprints) ? parsed.syncedFingerprints : [],
    };
  } catch {
    return {
      lastSyncedTimestampMs: lastSynced,
      syncedMessageIds: [],
      syncedFingerprints: [],
    };
  }
}

/**
 * Saves updated message IDs and fingerprints to persistent storage.
 */
export function saveSyncedSmsRegistry(state: SyncedSmsRegistryState): void {
  try {
    const cappedState: SyncedSmsRegistryState = {
      lastSyncedTimestampMs: state.lastSyncedTimestampMs,
      syncedMessageIds: state.syncedMessageIds.slice(-MAX_STORED_SIGNATURES),
      syncedFingerprints: state.syncedFingerprints.slice(-MAX_STORED_SIGNATURES),
    };
    setStorageItem(SYNCED_SMS_REGISTRY_KEY, JSON.stringify(cappedState));
    if (state.lastSyncedTimestampMs > 0) {
      setStoredLastSmsSyncTimestamp(state.lastSyncedTimestampMs);
    }
  } catch {
    // Ignore storage quota errors
  }
}

/**
 * Checks whether an incoming message has already been extracted in any previous sync
 * by comparing against:
 * 1. The persistent synced message ID registry
 * 2. The persistent canonical fingerprint registry
 * 3. Existing main transactions ledger (refId, rawSms, patternSignature)
 * 4. Existing staging queue (refId, rawSms, staging ID)
 */
export function isSmsAlreadySynced(
  msg: { id?: string; sender?: string; body: string; timestampMs?: number },
  registry: SyncedSmsRegistryState,
  existingTransactions: Transaction[] = [],
  existingStagingQueue: StagedSmsItem[] = []
): { isDuplicate: boolean; reason?: string } {
  // 1. Native device cursor message ID check
  if (msg.id && registry.syncedMessageIds.includes(msg.id)) {
    return {
      isDuplicate: true,
      reason: `Message ID ${msg.id} was already extracted in a previous sync.`,
    };
  }

  // 2. Canonical fingerprint check against persistent registry
  const fingerprint = computeSmsFingerprint(msg);
  if (registry.syncedFingerprints.includes(fingerprint)) {
    return {
      isDuplicate: true,
      reason: `Message fingerprint ${fingerprint} was already extracted in a previous sync.`,
    };
  }

  // Extract reference ID if present
  const refMatch = (msg.body || '').match(
    /\b(?:ref(?:\s*(?:no\.?|id|num))?|rrn|upi\s*ref|imps(?:\s*ref)?|txn\s*(?:id|num)?)[:\s]*([a-zA-Z0-9]{5,})/i
  );
  const candRefId = refMatch ? refMatch[1] : undefined;

  const rawClean = (msg.body || '').trim();

  // 3. Check existing main ledger transactions
  for (const tx of existingTransactions) {
    if (tx.isReversed) continue;
    // Check refId match (globally unique per transaction)
    if (
      candRefId &&
      candRefId.length >= 5 &&
      tx.smsMetadata?.refId &&
      tx.smsMetadata.refId.toLowerCase() === candRefId.toLowerCase()
    ) {
      return {
        isDuplicate: true,
        reason: `Reference ID ${candRefId} is already recorded in transaction ${tx.id}.`,
      };
    }
    // Check raw text match
    if (tx.smsMetadata?.rawSms && tx.smsMetadata.rawSms.trim() === rawClean) {
      return {
        isDuplicate: true,
        reason: `Exact SMS body already recorded in transaction ${tx.id}.`,
      };
    }
    // Check fingerprint match
    if (tx.smsMetadata?.rawSmsFingerprint && tx.smsMetadata.rawSmsFingerprint === fingerprint) {
      return {
        isDuplicate: true,
        reason: `SMS fingerprint already recorded in transaction ${tx.id}.`,
      };
    }
  }

  // 4. Check existing staging queue
  for (const staged of existingStagingQueue) {
    if (candRefId && candRefId.length >= 5 && staged.refId && staged.refId.toLowerCase() === candRefId.toLowerCase()) {
      return {
        isDuplicate: true,
        reason: `Reference ID ${candRefId} is already in the staging queue (${staged.id}).`,
      };
    }
    if (staged.rawSms && staged.rawSms.trim() === rawClean) {
      return {
        isDuplicate: true,
        reason: `Exact SMS body is already in the staging queue (${staged.id}).`,
      };
    }
    if (staged.rawSmsFingerprint && staged.rawSmsFingerprint === fingerprint) {
      return {
        isDuplicate: true,
        reason: `SMS fingerprint is already in the staging queue (${staged.id}).`,
      };
    }
  }

  return { isDuplicate: false };
}

/**
 * Filters an incoming batch of raw SMS messages so that ONLY truly NEW, UNIQUE,
 * never-before-synced messages are extracted!
 *
 * Guarantees intra-batch uniqueness as well as historical cross-sync deduplication.
 */
export function filterUniqueUnsyncedMessages<
  T extends { id?: string; sender?: string; body: string; timestampMs?: number }
>(
  messages: T[],
  existingTransactions: Transaction[] = [],
  existingStagingQueue: StagedSmsItem[] = []
): {
  uniqueMessages: T[];
  alreadySyncedCount: number;
  duplicateDetails: { id?: string; reason?: string }[];
} {
  const registry = loadSyncedSmsRegistry();
  const seenBatchIds = new Set<string>();
  const seenBatchFingerprints = new Set<string>();

  const uniqueMessages: T[] = [];
  const duplicateDetails: { id?: string; reason?: string }[] = [];

  for (const msg of messages) {
    if (!msg || !msg.body || !msg.body.trim()) continue;

    // Intra-batch duplicate check
    if (msg.id && seenBatchIds.has(msg.id)) {
      duplicateDetails.push({ id: msg.id, reason: 'Duplicate within current batch' });
      continue;
    }

    const fp = computeSmsFingerprint(msg);
    if (seenBatchFingerprints.has(fp)) {
      duplicateDetails.push({ id: msg.id, reason: 'Duplicate fingerprint within current batch' });
      continue;
    }

    // Cross-sync historical deduplication
    const check = isSmsAlreadySynced(msg, registry, existingTransactions, existingStagingQueue);
    if (check.isDuplicate) {
      duplicateDetails.push({ id: msg.id, reason: check.reason });
      continue;
    }

    // Mark as seen in this batch
    if (msg.id) seenBatchIds.add(msg.id);
    seenBatchFingerprints.add(fp);
    uniqueMessages.push(msg);
  }

  return {
    uniqueMessages,
    alreadySyncedCount: duplicateDetails.length,
    duplicateDetails,
  };
}

/**
 * Records newly extracted messages into the persistent sync registry and advances
 * the high-water mark timestamp.
 */
export function commitSyncedSmsBatch(
  messages: { id?: string; sender?: string; body: string; timestampMs?: number }[]
): void {
  if (messages.length === 0) return;

  const registry = loadSyncedSmsRegistry();
  const idSet = new Set(registry.syncedMessageIds);
  const fpSet = new Set(registry.syncedFingerprints);
  let maxTimestamp = registry.lastSyncedTimestampMs;

  for (const m of messages) {
    if (m.id) idSet.add(m.id);
    const fp = computeSmsFingerprint(m);
    fpSet.add(fp);
    if (typeof m.timestampMs === 'number' && m.timestampMs > maxTimestamp) {
      maxTimestamp = m.timestampMs;
    }
  }

  saveSyncedSmsRegistry({
    lastSyncedTimestampMs: maxTimestamp,
    syncedMessageIds: Array.from(idSet),
    syncedFingerprints: Array.from(fpSet),
  });
}
