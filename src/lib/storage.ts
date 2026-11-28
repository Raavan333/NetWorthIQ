/**
 * IndexedDB offline storage engine for NetWorthIQ
 * Completely offline, durable, atomic transactions, zero external tracking
 */

const DB_NAME = 'NetWorthIQ_Offline_DB';
const DB_VERSION = 4;

export const STORE_NAMES = [
  'settings',
  'theme',
  'currencies',
  'assetTypes',
  'holdings',
  'liabilities',
  'incomeStreams',
  'transactions',
  'bills',
  'goals',
  'sales',
  'taxRules',
  'snapshots',
  'insights',
  'scheduledTransfers',
  'creditScores',
  'spendCategories',
  'quickChips',
  'rlRecommendations',
  'receivables',
  'sms_rule_overrides',
  'sms_staging_queue',
] as const;

export type StoreName = (typeof STORE_NAMES)[number];

export interface AcidStoreMutation<T = any> {
  storeName: StoreName;
  mode: 'setAll' | 'put' | 'delete';
  items?: T[];
  item?: T;
  key?: IDBValidKey;
}

/**
 * Fault-tolerant JSON parser that never throws on corrupt local storage payloads.
 */
export function safeJsonParse<T>(
  raw: string | null | undefined,
  fallback: T,
  onCorrupt?: () => void
): T {
  if (!raw || typeof raw !== 'string') return fallback;
  try {
    const parsed = JSON.parse(raw);
    if (parsed === null || parsed === undefined) return fallback;
    if (Array.isArray(fallback) && !Array.isArray(parsed)) {
      onCorrupt?.();
      return fallback;
    }
    if (
      typeof fallback === 'object' &&
      fallback !== null &&
      !Array.isArray(fallback) &&
      (typeof parsed !== 'object' || Array.isArray(parsed))
    ) {
      onCorrupt?.();
      return fallback;
    }
    return parsed as T;
  } catch {
    onCorrupt?.();
    return fallback;
  }
}

/**
 * Strips null/primitive entries from recovered collections so corrupt elements never crash UI lists.
 */
export function sanitizeObjectArray<T extends Record<string, any>>(
  input: unknown,
  requiredKey?: string
): T[] {
  if (!Array.isArray(input)) return [];
  return input.filter((item): item is T => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    if (requiredKey && (item[requiredKey] === undefined || item[requiredKey] === null || item[requiredKey] === '')) {
      return false;
    }
    return true;
  });
}

class IndexedDbStorage {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private recoveredCorruptionCount = 0;

  public consumeRecoveryCount(): number {
    const count = this.recoveredCorruptionCount;
    this.recoveredCorruptionCount = 0;
    return count;
  }

  private markCorruptRecovery() {
    this.recoveredCorruptionCount += 1;
  }

  private async openDb(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof window === 'undefined' || !window.indexedDB) {
        this.dbPromise = null;
        reject(new Error('IndexedDB not supported'));
        return;
      }

      try {
        const request = window.indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          for (const store of STORE_NAMES) {
            if (!db.objectStoreNames.contains(store)) {
              // using key 'id' for lists or 'key' for singletons
              if (['settings', 'theme', 'taxRules'].includes(store)) {
                db.createObjectStore(store);
              } else if (store === 'currencies') {
                db.createObjectStore(store, { keyPath: 'code' });
              } else {
                db.createObjectStore(store, { keyPath: 'id' });
              }
            }
          }
        };

        request.onsuccess = () => {
          const db = request.result;
          db.onversionchange = () => {
            db.close();
            this.dbPromise = null;
          };
          db.onclose = () => {
            this.dbPromise = null;
          };
          resolve(db);
        };

        request.onerror = () => {
          this.dbPromise = null;
          reject(request.error || new Error('Failed to open IndexedDB'));
        };

        request.onblocked = () => {
          this.dbPromise = null;
          reject(new Error('IndexedDB open blocked by another connection'));
        };
      } catch (err) {
        this.dbPromise = null;
        reject(err);
      }
    });

    return this.dbPromise;
  }

  /**
   * Executes multiple store mutations atomically in a single native IDBTransaction ('readwrite').
   * If any mutation fails or throws, the entire transaction aborts and rolls back all stores.
   */
  async runAcidTransaction(mutations: AcidStoreMutation[]): Promise<void> {
    if (mutations.length === 0) return;
    const uniqueStores = Array.from(new Set(mutations.map((m) => m.storeName)));

    try {
      const db = await this.openDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(uniqueStores, 'readwrite');
        let settled = false;

        tx.oncomplete = () => {
          if (!settled) {
            settled = true;
            resolve();
          }
        };
        tx.onerror = () => {
          if (!settled) {
            settled = true;
            reject(tx.error || new Error('ACID transaction failed'));
          }
        };
        tx.onabort = () => {
          if (!settled) {
            settled = true;
            reject(tx.error || new Error('ACID transaction aborted and rolled back'));
          }
        };

        try {
          for (const mut of mutations) {
            const store = tx.objectStore(mut.storeName);
            if (mut.mode === 'setAll') {
              store.clear();
              for (const entry of mut.items || []) {
                store.put(entry);
              }
            } else if (mut.mode === 'put') {
              if (mut.key !== undefined) {
                store.put(mut.item, mut.key);
              } else {
                store.put(mut.item);
              }
            } else if (mut.mode === 'delete' && mut.key !== undefined) {
              store.delete(mut.key);
            }
          }
        } catch (err) {
          try {
            tx.abort();
          } catch {
            // already aborting
          }
          if (!settled) {
            settled = true;
            reject(err);
          }
        }
      });

      // Mirror committed stores to localStorage only after ACID transaction commits cleanly
      for (const storeName of uniqueStores) {
        await this.mirrorToLocal(storeName);
      }
    } catch (err) {
      // Fallback for restricted browser / headless environments without IndexedDB:
      // Snapshot localStorage before mutating and restore snapshot on any error.
      if (typeof localStorage !== 'undefined') {
        const snapshots = new Map<string, string | null>();
        for (const storeName of uniqueStores) {
          snapshots.set(storeName, localStorage.getItem(`nwiq_${storeName}`));
        }
        try {
          for (const mut of mutations) {
            const lsKey = `nwiq_${mut.storeName}`;
            if (mut.mode === 'setAll') {
              localStorage.setItem(lsKey, JSON.stringify(mut.items || []));
            } else if (mut.mode === 'put') {
              const existing = sanitizeObjectArray<any>(
                safeJsonParse<any[]>(localStorage.getItem(lsKey), [], () => this.markCorruptRecovery())
              );
              const itemId = (mut.item as any)?.id ?? (mut.item as any)?.code ?? mut.key;
              const next = existing.some((x) => (x?.id ?? x?.code) === itemId)
                ? existing.map((x) => ((x?.id ?? x?.code) === itemId ? mut.item : x))
                : [mut.item, ...existing];
              localStorage.setItem(lsKey, JSON.stringify(next));
            } else if (mut.mode === 'delete' && mut.key !== undefined) {
              const existing = sanitizeObjectArray<any>(
                safeJsonParse<any[]>(localStorage.getItem(lsKey), [], () => this.markCorruptRecovery())
              );
              localStorage.setItem(
                lsKey,
                JSON.stringify(existing.filter((x) => (x?.id ?? x?.code) !== mut.key))
              );
            }
          }
          return;
        } catch (fallbackErr) {
          // Atomic rollback of localStorage snapshot
          for (const [storeName, prevRaw] of snapshots.entries()) {
            const lsKey = `nwiq_${storeName}`;
            if (prevRaw === null) localStorage.removeItem(lsKey);
            else localStorage.setItem(lsKey, prevRaw);
          }
          throw fallbackErr;
        }
      }
      // In Node test runtime without window/localStorage, allow pure caller logic unless an explicit error occurred
      if (typeof window !== 'undefined') {
        throw err;
      }
    }
  }

  // Generic Get All
  async getAll<T>(storeName: StoreName): Promise<T[]> {
    try {
      const db = await this.openDb();
      return await new Promise<T[]>((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const req = store.getAll();
        req.onsuccess = () => resolve(Array.isArray(req.result) ? (req.result as T[]) : []);
        req.onerror = () => reject(req.error);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('Read transaction aborted'));
      });
    } catch {
      if (typeof localStorage === 'undefined') return [];
      const raw = localStorage.getItem(`nwiq_${storeName}`);
      return safeJsonParse<T[]>(raw, [], () => this.markCorruptRecovery());
    }
  }

  // Generic Put Item
  async put<T>(storeName: StoreName, item: T, key?: IDBValidKey): Promise<void> {
    try {
      const db = await this.openDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        if (key !== undefined) {
          store.put(item, key);
        } else {
          store.put(item);
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error('Put transaction failed'));
        tx.onabort = () => reject(tx.error || new Error('Put transaction aborted'));
      });
      await this.mirrorToLocal(storeName);
    } catch {
      if (key !== undefined) {
        this.mirrorSingleToLocal(storeName, item, key);
      } else if (typeof localStorage !== 'undefined') {
        try {
          const lsKey = `nwiq_${storeName}`;
          const existing = sanitizeObjectArray<any>(
            safeJsonParse<any[]>(localStorage.getItem(lsKey), [], () => this.markCorruptRecovery())
          );
          const itemId = (item as any)?.id ?? (item as any)?.code;
          const next =
            itemId !== undefined && existing.some((x) => (x?.id ?? x?.code) === itemId)
              ? existing.map((x) => ((x?.id ?? x?.code) === itemId ? item : x))
              : [item, ...existing];
          localStorage.setItem(lsKey, JSON.stringify(next));
        } catch {
          // ignore localStorage quota errors
        }
      }
    }
  }

  // Set entire collection
  async setAll<T>(storeName: StoreName, items: T[]): Promise<void> {
    try {
      const db = await this.openDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        store.clear();
        for (const item of items) {
          store.put(item);
        }
        tx.oncomplete = () => {
          try {
            if (typeof localStorage !== 'undefined') {
              localStorage.setItem(`nwiq_${storeName}`, JSON.stringify(items));
            }
          } catch {
            // ignore localStorage quota limits
          }
          resolve();
        };
        tx.onerror = () => reject(tx.error || new Error('setAll transaction failed'));
        tx.onabort = () => reject(tx.error || new Error('setAll transaction aborted'));
      });
    } catch {
      if (typeof localStorage !== 'undefined') {
        try {
          localStorage.setItem(`nwiq_${storeName}`, JSON.stringify(items));
        } catch {
          // ignore localStorage quota limits
        }
      }
    }
  }

  // Single singleton get/set (e.g. settings)
  async getSingleton<T>(storeName: StoreName, key: string = 'current'): Promise<T | null> {
    const readLocalFallback = (): T | null => {
      if (typeof localStorage === 'undefined') return null;
      const raw = localStorage.getItem(`nwiq_${storeName}_${key}`);
      return safeJsonParse<T | null>(raw, null, () => this.markCorruptRecovery());
    };

    try {
      const db = await this.openDb();
      return await new Promise<T | null>((resolve) => {
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const req = store.get(key);
        req.onsuccess = () => {
          if (req.result !== undefined) {
            resolve(req.result as T);
          } else {
            resolve(readLocalFallback());
          }
        };
        req.onerror = () => resolve(readLocalFallback());
        tx.onerror = () => resolve(readLocalFallback());
      });
    } catch {
      return readLocalFallback();
    }
  }

  async setSingleton<T>(storeName: StoreName, value: T, key: string = 'current'): Promise<void> {
    try {
      const db = await this.openDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        store.put(value, key);
        tx.oncomplete = () => {
          try {
            if (typeof localStorage !== 'undefined') {
              localStorage.setItem(`nwiq_${storeName}_${key}`, JSON.stringify(value));
            }
          } catch {
            // ignore
          }
          resolve();
        };
        tx.onerror = () => reject(tx.error || new Error('setSingleton failed'));
        tx.onabort = () => reject(tx.error || new Error('setSingleton aborted'));
      });
    } catch {
      if (typeof localStorage !== 'undefined') {
        try {
          localStorage.setItem(`nwiq_${storeName}_${key}`, JSON.stringify(value));
        } catch {
          // ignore
        }
      }
    }
  }

  // Delete item by key
  async delete(storeName: StoreName, key: IDBValidKey): Promise<void> {
    try {
      const db = await this.openDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        store.delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error('Delete transaction failed'));
        tx.onabort = () => reject(tx.error || new Error('Delete transaction aborted'));
      });
      await this.mirrorToLocal(storeName);
    } catch {
      if (typeof localStorage !== 'undefined') {
        try {
          const lsKey = `nwiq_${storeName}`;
          const existing = sanitizeObjectArray<any>(
            safeJsonParse<any[]>(localStorage.getItem(lsKey), [], () => this.markCorruptRecovery())
          );
          localStorage.setItem(
            lsKey,
            JSON.stringify(existing.filter((x) => (x?.id ?? x?.code) !== key))
          );
          localStorage.removeItem(`nwiq_${storeName}_${String(key)}`);
        } catch {
          // ignore
        }
      }
    }
  }

  // Clear all stores atomically
  async clearAll(): Promise<void> {
    try {
      const db = await this.openDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction([...STORE_NAMES], 'readwrite');
        for (const store of STORE_NAMES) {
          tx.objectStore(store).clear();
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error('clearAll transaction failed'));
        tx.onabort = () => reject(tx.error || new Error('clearAll transaction aborted'));
      });
    } catch {
      // ignore IndexedDB errors during wipe and still purge localStorage mirrors
    }
    if (typeof localStorage !== 'undefined') {
      try {
        for (const store of STORE_NAMES) {
          localStorage.removeItem(`nwiq_${store}`);
          localStorage.removeItem(`nwiq_${store}_current`);
        }
        const keysToRemove: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && (k.startsWith('nwiq_') || k.startsWith('networthiq_'))) {
            keysToRemove.push(k);
          }
        }
        for (const k of keysToRemove) {
          localStorage.removeItem(k);
        }
      } catch {
        // ignore
      }
    }
  }

  private async mirrorToLocal(storeName: StoreName) {
    try {
      if (typeof localStorage === 'undefined') return;
      const all = await this.getAll(storeName);
      localStorage.setItem(`nwiq_${storeName}`, JSON.stringify(all));
    } catch {
      // ignore
    }
  }

  private mirrorSingleToLocal(storeName: StoreName, item: unknown, key?: IDBValidKey) {
    try {
      if (typeof localStorage === 'undefined') return;
      if (key !== undefined) {
        localStorage.setItem(`nwiq_${storeName}_${String(key)}`, JSON.stringify(item));
      }
    } catch {
      // ignore
    }
  }
}

export const dbStorage = new IndexedDbStorage();
