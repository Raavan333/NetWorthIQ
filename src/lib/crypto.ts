/**
 * Offline cryptographic security engine using standard WebCrypto API.
 * Provides salted PIN hashing, password-based AES-GCM data backup encryption/decryption,
 * and biometric unlock bridge for mobile APK.
 */

// Generate random hex salt
export function generateSalt(length: number = 16): string {
  const arr = new Uint8Array(length);
  window.crypto.getRandomValues(arr);
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// High-security PBKDF2-based PIN hashing with salt and 100,000 iterations
export async function hashPin(pin: string, salt: string): Promise<string> {
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
  const hashArray = Array.from(new Uint8Array(derivedBits));
  const hex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  return `pbkdf2$100000$${hex}`;
}

// Legacy salted SHA-256 hash for seamless migration
export async function hashPinLegacy(pin: string, salt: string): Promise<string> {
  const enc = new TextEncoder();
  const data = enc.encode(`${salt}:${pin}`);
  const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function verifyPin(pin: string, salt: string, storedHash: string): Promise<boolean> {
  if (!storedHash || storedHash.trim() === '') {
    return false;
  }
  if (storedHash.startsWith('pbkdf2$')) {
    const computed = await hashPin(pin, salt);
    return computed === storedHash;
  }
  // Seamless fallback for existing legacy salted SHA-256 hashes
  const legacyComputed = await hashPinLegacy(pin, salt);
  return legacyComputed === storedHash;
}

// Derive AES-GCM key from user passphrase using PBKDF2
async function deriveKeyFromPassphrase(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await window.crypto.subtle.importKey(
    'raw',
    enc.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as unknown as BufferSource,
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

// Encrypt payload with passphrase
export async function encryptExportData(plainJson: string, passphrase: string): Promise<string> {
  const enc = new TextEncoder();
  const salt = new Uint8Array(16);
  window.crypto.getRandomValues(salt);

  const iv = new Uint8Array(12);
  window.crypto.getRandomValues(iv);

  const key = await deriveKeyFromPassphrase(passphrase, salt);
  const cipherBuffer = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    enc.encode(plainJson)
  );

  const payload = {
    version: 1,
    salt: Array.from(salt),
    iv: Array.from(iv),
    data: Array.from(new Uint8Array(cipherBuffer)),
  };

  return JSON.stringify(payload);
}

// Decrypt payload with passphrase
export async function decryptExportData(encryptedJson: string, passphrase: string): Promise<string> {
  const payload = JSON.parse(encryptedJson);
  const salt = new Uint8Array(payload.salt);
  const iv = new Uint8Array(payload.iv);
  const data = new Uint8Array(payload.data);

  const key = await deriveKeyFromPassphrase(passphrase, salt);
  const decBuffer = await window.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    data
  );

  const dec = new TextDecoder();
  return dec.decode(decBuffer);
}

export function triggerHapticFeedback(pattern: number[] = [25, 40, 25]) {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try {
      navigator.vibrate(pattern);
    } catch {
      // ignore
    }
  }
}

