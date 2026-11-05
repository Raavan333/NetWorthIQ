/**
 * Security & Authentication Engine for NetWorthIQ
 * Implements Argon2id password/PIN hashing, cryptographically secure salt generation,
 * transparent migration from legacy PBKDF2/SHA-256, and brute-force rate-limiting lockouts.
 * Strictly adheres to zero-sensitive-credential logging.
 */

import { argon2id } from 'hash-wasm';

export interface LockoutState {
  failedAttempts: number;
  lockoutUntil: string | null; // ISO timestamp if locked
  lastFailedAt: string | null;
}

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 5 * 60 * 1000; // 5 minutes lockout

// Generates a cryptographically strong random hex salt (16 bytes = 32 hex chars)
export function generateSecureSalt(byteLength: number = 16): string {
  const bytes = new Uint8Array(byteLength);
  if (typeof window !== 'undefined' && window.crypto && window.crypto.getRandomValues) {
    window.crypto.getRandomValues(bytes);
  } else {
    // Node environment fallback for testing
    for (let i = 0; i < byteLength; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Computes standard Argon2id hash of PIN with salt.
 * Uses standard OWASP recommendations: memory 32MB / 64MB, 3 iterations, 1 parallelism.
 */
export async function hashPinArgon2id(
  pin: string,
  saltHex: string,
  memorySizeKb: number = 32768,
  iterations: number = 3
): Promise<string> {
  // Convert hex salt to Uint8Array
  const saltBytes = new Uint8Array(
    saltHex.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) || [1, 2, 3, 4]
  );

  const hashHex = await argon2id({
    password: pin,
    salt: saltBytes,
    parallelism: 1,
    iterations,
    memorySize: memorySizeKb, // 32MB in KB
    hashLength: 32,
    outputType: 'hex',
  });

  return `$argon2id$v=19$m=${memorySizeKb},t=${iterations},p=1$${saltHex}$${hashHex}`;
}

/**
 * Legacy PBKDF2 verification for seamless migration
 */
async function verifyPbkdf2(pin: string, salt: string, storedHash: string): Promise<boolean> {
  if (typeof window === 'undefined' || !window.crypto?.subtle) {
    return false;
  }
  const enc = new TextEncoder();
  const saltBytes = enc.encode(salt);
  const keyMaterial = await window.crypto.subtle.importKey(
    'raw',
    enc.encode(pin),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const derivedBits = await window.crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  );
  const hashHex = Array.from(new Uint8Array(derivedBits))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `pbkdf2$100000$${hashHex}` === storedHash;
}

/**
 * Legacy SHA-256 verification for migration
 */
async function verifyLegacySha256(pin: string, salt: string, storedHash: string): Promise<boolean> {
  if (typeof window === 'undefined' || !window.crypto?.subtle) {
    return false;
  }
  const enc = new TextEncoder();
  const data = enc.encode(`${salt}:${pin}`);
  const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
  const hashHex = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return hashHex === storedHash;
}

/**
 * Universal PIN verification with automatic hash upgrade detection.
 * Returns: { isValid: boolean, needsUpgrade: boolean, newHash?: string }
 */
export async function verifyPinAndCheckUpgrade(
  pin: string,
  salt: string,
  storedHash: string
): Promise<{ isValid: boolean; needsUpgrade: boolean; newHash?: string }> {
  if (!storedHash || !pin) {
    return { isValid: false, needsUpgrade: false };
  }

  // 1. Argon2id check
  if (storedHash.startsWith('$argon2id$')) {
    const parts = storedHash.split('$');
    // Format: ["", "argon2id", "v=19", "m=32768,t=3,p=1", saltHex, hashHex]
    const hashSalt = parts[4] || salt;
    const computed = await hashPinArgon2id(pin, hashSalt);
    return {
      isValid: computed === storedHash,
      needsUpgrade: false,
    };
  }

  // 2. PBKDF2 check
  if (storedHash.startsWith('pbkdf2$')) {
    const isValid = await verifyPbkdf2(pin, salt, storedHash);
    if (isValid) {
      // Valid! Upgrade to Argon2id seamlessly
      const upgradedHash = await hashPinArgon2id(pin, salt);
      return { isValid: true, needsUpgrade: true, newHash: upgradedHash };
    }
    return { isValid: false, needsUpgrade: false };
  }

  // 3. Salted SHA-256 check
  const isLegacyValid = await verifyLegacySha256(pin, salt, storedHash);
  if (isLegacyValid) {
    // Valid! Upgrade to Argon2id seamlessly
    const upgradedHash = await hashPinArgon2id(pin, salt);
    return { isValid: true, needsUpgrade: true, newHash: upgradedHash };
  }

  return { isValid: false, needsUpgrade: false };
}

/**
 * Brute-force rate limiting validator
 */
export function checkLockout(state: LockoutState): { isLocked: boolean; remainingSeconds: number } {
  if (!state.lockoutUntil) {
    return { isLocked: false, remainingSeconds: 0 };
  }
  const now = Date.now();
  const lockTime = new Date(state.lockoutUntil).getTime();
  if (now < lockTime) {
    const remainingSeconds = Math.ceil((lockTime - now) / 1000);
    return { isLocked: true, remainingSeconds };
  }
  return { isLocked: false, remainingSeconds: 0 };
}

export function registerFailedAttempt(currentState: LockoutState): LockoutState {
  const failedAttempts = (currentState.failedAttempts || 0) + 1;
  const now = Date.now();
  if (failedAttempts >= MAX_FAILED_ATTEMPTS) {
    return {
      failedAttempts,
      lockoutUntil: new Date(now + LOCKOUT_DURATION_MS).toISOString(),
      lastFailedAt: new Date(now).toISOString(),
    };
  }
  return {
    failedAttempts,
    lockoutUntil: null,
    lastFailedAt: new Date(now).toISOString(),
  };
}

export function resetLockout(): LockoutState {
  return {
    failedAttempts: 0,
    lockoutUntil: null,
    lastFailedAt: null,
  };
}
