import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ALGORITHM = 'aes-256-gcm';
const REQUIRED_KEY_BYTES = 32;

export interface EncryptedEnvelope {
  ciphertext: string;
  iv: string;
  tag: string;
}

/**
 * Validates that a key buffer is exactly 32 bytes (256 bits) for AES-256.
 * Throws a descriptive error if the key is the wrong size.
 */
function validateKeySize(key: Buffer, context: string): void {
  if (!Buffer.isBuffer(key)) {
    throw new Error(`[Axiomify Vault] ${context}: Expected a Buffer, got ${typeof key}.`);
  }
  if (key.byteLength !== REQUIRED_KEY_BYTES) {
    throw new Error(
      `[Axiomify Vault] ${context}: Key must be exactly ${REQUIRED_KEY_BYTES} bytes (256 bits), ` +
      `but received ${key.byteLength} bytes. ` +
      `Provide a 64-character hex string or a 44-character base64 string encoding a 32-byte key.`
    );
  }
}

/**
 * Encrypts a plaintext string with a given key.
 */
export function encrypt(plaintext: string, key: Buffer): EncryptedEnvelope {
  validateKeySize(key, 'encrypt');
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  let ciphertext = cipher.update(plaintext, 'utf8', 'hex');
  ciphertext += cipher.final('hex');
  const tag = cipher.getAuthTag();

  return {
    ciphertext,
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
  };
}

/**
 * Decrypts a ciphertext envelope with a given key.
 */
export function decrypt(envelope: EncryptedEnvelope, key: Buffer): string {
  validateKeySize(key, 'decrypt');
  const iv = Buffer.from(envelope.iv, 'hex');
  const tag = Buffer.from(envelope.tag, 'hex');
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  let plaintext = decipher.update(envelope.ciphertext, 'hex', 'utf8');
  plaintext += decipher.final('utf8');
  return plaintext;
}

/**
 * Loads or creates a local development KEK.
 * File is created with 0600 permissions (owner read/write only).
 */
export function loadOrCreateLocalKEK(projectRoot: string): Buffer {
  const vaultDir = join(projectRoot, '.axiomify');
  const keyPath = join(vaultDir, 'vault.key');

  if (!existsSync(vaultDir)) {
    mkdirSync(vaultDir, { recursive: true });
  }

  if (existsSync(keyPath)) {
    const keyHex = readFileSync(keyPath, 'utf8').trim();
    const key = Buffer.from(keyHex, 'hex');
    validateKeySize(key, 'loadOrCreateLocalKEK');
    return key;
  }

  const newKey = randomBytes(32);
  writeFileSync(keyPath, newKey.toString('hex'), { encoding: 'utf8', mode: 0o600 });
  // Belt-and-suspenders: ensure permissions even if umask overrode the mode
  try { chmodSync(keyPath, 0o600); } catch { /* ignore chmod failures on unsupported filesystems */ }
  return newKey;
}

/**
 * Decodes a string key using explicit format detection (not length heuristics).
 * Accepts:
 *   - 64-character hex string (32 bytes)
 *   - Base64 string that decodes to 32 bytes
 * Throws if the decoded result is not exactly 32 bytes.
 */
function decodeKeyString(keyStr: string, context: string): Buffer {
  // Check for valid hex (exactly 64 hex chars = 32 bytes)
  if (/^[0-9a-fA-F]{64}$/.test(keyStr)) {
    return Buffer.from(keyStr, 'hex');
  }

  // Try base64 decoding
  const decoded = Buffer.from(keyStr, 'base64');
  if (decoded.byteLength === REQUIRED_KEY_BYTES) {
    return decoded;
  }

  throw new Error(
    `[Axiomify Vault] ${context}: Unable to decode key string. ` +
    `Expected a 64-character hex string or a base64 string encoding exactly 32 bytes, ` +
    `but decoded to ${decoded.byteLength} bytes.`
  );
}

/**
 * Resolves the Key Encryption Key (KEK) using custom option, environment, or local fallback.
 */
export function resolveKEK(projectRoot: string, optionsKek?: Buffer | string): Buffer {
  if (optionsKek) {
    if (Buffer.isBuffer(optionsKek)) {
      validateKeySize(optionsKek, 'resolveKEK (options)');
      return optionsKek;
    }
    return decodeKeyString(optionsKek, 'resolveKEK (options)');
  }

  const envKek = process.env.AXIOMIFY_VAULT_KEK;
  if (envKek) {
    return decodeKeyString(envKek, 'resolveKEK (AXIOMIFY_VAULT_KEK)');
  }

  return loadOrCreateLocalKEK(projectRoot);
}
