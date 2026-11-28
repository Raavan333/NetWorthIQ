import { safeJsonParse, sanitizeObjectArray, dbStorage } from '../src/lib/storage';
import {
  checkLockout,
  registerFailedAttempt,
  resetLockout,
  generateSecureSalt,
  LockoutState,
} from '../src/lib/securityArgon2';
import { handleAppBack, registerBackHandler } from '../src/lib/modalBackStack';

function installMockLocalStorage() {
  const store = new Map<string, string>();
  const mockStorage: Storage = {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };
  Object.defineProperty(globalThis, 'localStorage', {
    value: mockStorage,
    configurable: true,
    writable: true,
  });
  return store;
}

async function runOfflineAndSecurityTests() {
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, label: string) {
    if (condition) {
      passed++;
    } else {
      failed++;
      console.error(`FAIL: ${label}`);
    }
  }

  console.log('\n[Offline Storage & Corrupt-State Recovery Tests]');
  const backingMap = installMockLocalStorage();

  // 1. safeJsonParse handles malformed JSON and type mismatches
  let corruptTriggered = 0;
  const parsedValid = safeJsonParse('{"a": 1}', { a: 0 }, () => corruptTriggered++);
  assert(parsedValid.a === 1 && corruptTriggered === 0, 'safeJsonParse parses valid object JSON');

  const parsedBroken = safeJsonParse('{bad-json', { a: 42 }, () => corruptTriggered++);
  assert(parsedBroken.a === 42 && corruptTriggered === 1, 'safeJsonParse returns fallback on corrupt syntax');

  const parsedMismatchArr = safeJsonParse('{"not":"array"}', [1, 2], () => corruptTriggered++);
  assert(
    Array.isArray(parsedMismatchArr) && parsedMismatchArr.length === 2 && corruptTriggered === 2,
    'safeJsonParse rejects object when array fallback expected'
  );

  const parsedMismatchObj = safeJsonParse('[1,2,3]', { ok: true }, () => corruptTriggered++);
  assert(
    !Array.isArray(parsedMismatchObj) && parsedMismatchObj.ok === true && corruptTriggered === 3,
    'safeJsonParse rejects array when object fallback expected'
  );

  // 2. sanitizeObjectArray strips corrupt primitives/nulls/missing keys
  const sanitized = sanitizeObjectArray<{ id: string; name: string }>(
    [null, undefined, 'str', 123, ['nested'], { name: 'missing-id' }, { id: 'h-1', name: 'Valid' }],
    'id'
  );
  assert(
    sanitized.length === 1 && sanitized[0].id === 'h-1',
    'sanitizeObjectArray strips null, primitives, arrays, and entries missing requiredKey'
  );

  // 3. dbStorage offline fallback + ACID rollback + clearAll purge
  await dbStorage.setAll('holdings', [{ id: 'h-1', name: 'Bank A', principalOrValue: 1000 }]);
  const loadedHoldings = await dbStorage.getAll<any>('holdings');
  assert(
    loadedHoldings.length === 1 && loadedHoldings[0].principalOrValue === 1000,
    'dbStorage setAll/getAll round-trips via localStorage fallback'
  );

  await dbStorage.put('holdings', { id: 'h-2', name: 'Bank B', principalOrValue: 2500 });
  const afterPut = await dbStorage.getAll<any>('holdings');
  assert(afterPut.length === 2, 'dbStorage put inserts new item in fallback mode');

  await dbStorage.delete('holdings', 'h-1');
  const afterDelete = await dbStorage.getAll<any>('holdings');
  assert(
    afterDelete.length === 1 && afterDelete[0].id === 'h-2',
    'dbStorage delete removes item by key in fallback mode'
  );

  // Test ACID rollback on circular payload error during multi-store transaction
  const circular: Record<string, unknown> = { id: 'bad-tx' };
  circular.self = circular;
  let txRolledBack = false;
  try {
    await dbStorage.runAcidTransaction([
      { storeName: 'holdings', mode: 'setAll', items: [{ id: 'h-should-rollback' }] },
      { storeName: 'transactions', mode: 'setAll', items: [circular] },
    ]);
  } catch {
    txRolledBack = true;
  }
  const afterRollbackHoldings = await dbStorage.getAll<any>('holdings');
  assert(
    txRolledBack && afterRollbackHoldings.length === 1 && afterRollbackHoldings[0].id === 'h-2',
    'runAcidTransaction rolls back previous store mutation when a later mutation fails'
  );

  // Test corrupt singleton recovery counter
  localStorage.setItem('nwiq_settings_current', '{broken');
  const recoveredSettings = await dbStorage.getSingleton('settings');
  const recoveryCount = dbStorage.consumeRecoveryCount();
  assert(
    recoveredSettings === null && recoveryCount >= 1 && dbStorage.consumeRecoveryCount() === 0,
    'getSingleton safely recovers from corrupt JSON and consumeRecoveryCount resets counter'
  );

  // Test clearAll clears both nwiq_* and networthiq_* keys
  localStorage.setItem('networthiq_pin_lockout', JSON.stringify({ failedAttempts: 3 }));
  await dbStorage.clearAll();
  assert(
    !backingMap.has('nwiq_holdings') && !backingMap.has('networthiq_pin_lockout'),
    'clearAll purges both nwiq_* and networthiq_* keys cleanly'
  );

  console.log('\n[PIN Security & Lockout Tests]');
  let lockState: LockoutState = resetLockout();
  assert(checkLockout(lockState).isLocked === false, 'Fresh lockout state is unlocked');

  for (let i = 0; i < 4; i++) {
    lockState = registerFailedAttempt(lockState);
  }
  assert(
    lockState.failedAttempts === 4 && checkLockout(lockState).isLocked === false,
    'First 4 failed PIN attempts do not lock out'
  );

  lockState = registerFailedAttempt(lockState);
  const lockCheck = checkLockout(lockState);
  assert(
    lockState.failedAttempts === 5 && lockCheck.isLocked === true && lockCheck.remainingSeconds > 200,
    '5th failed PIN attempt triggers 5-minute lockout'
  );

  const expiredLock = checkLockout({
    failedAttempts: 5,
    lockoutUntil: new Date(Date.now() - 5000).toISOString(),
    lastFailedAt: new Date(Date.now() - 305000).toISOString(),
  });
  assert(expiredLock.isLocked === false && expiredLock.remainingSeconds === 0, 'Expired lockout unlocks automatically');

  const saltA = generateSecureSalt(16);
  const saltB = generateSecureSalt(16);
  assert(
    saltA.length === 32 && saltB.length === 32 && saltA !== saltB,
    'generateSecureSalt returns unique 128-bit hex salts'
  );

  console.log('\n[Android Hardware Back Stack (LIFO) Tests]');
  assert(handleAppBack() === 'exit', 'Empty back stack returns exit');

  const events: string[] = [];
  const unregisterTab = registerBackHandler(() => {
    events.push('tab-home');
  }, false);
  const unregisterModal = registerBackHandler(() => {
    events.push('close-modal');
  }, true);

  assert(handleAppBack() === 'handled', 'Top-most modal handles hardware back first');
  unregisterModal();
  assert(handleAppBack() === 'handled', 'Root tab handler runs after modal closes');
  unregisterTab();
  assert(handleAppBack() === 'exit', 'Empty stack returns exit after all handlers unregister');
  assert(
    events.length === 2 && events[0] === 'close-modal' && events[1] === 'tab-home',
    'LIFO order respected strictly (modal before root tab)'
  );

  console.log(`\nOffline & Security Tests Completed: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
  if (failed > 0) {
    process.exit(1);
  }
}

runOfflineAndSecurityTests().catch((err) => {
  console.error('Offline & Security test suite failed:', err);
  process.exit(1);
});
