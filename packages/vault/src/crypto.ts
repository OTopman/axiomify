import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ALGORITHM = 'aes-256-gcm';

export interface EncryptedEnvelope {
  ciphertext: string;
  iv: string;
  tag: string;
}

/**
 * Encrypts a plaintext string with a given key.
 */
export function encrypt(plaintext: string, key: Buffer): EncryptedEnvelope {
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
 */
export function loadOrCreateLocalKEK(projectRoot: string): Buffer {
  const vaultDir = join(projectRoot, '.axiomify');
  const keyPath = join(vaultDir, 'vault.key');

  if (!existsSync(vaultDir)) {
    mkdirSync(vaultDir, { recursive: true });
  }

  if (existsSync(keyPath)) {
    const keyHex = readFileSync(keyPath, 'utf8').trim();
    return Buffer.from(keyHex, 'hex');
  }

  const newKey = randomBytes(32);
  writeFileSync(keyPath, newKey.toString('hex'), 'utf8');
  return newKey;
}

/**
 * Resolves the Key Encryption Key (KEK) using custom option, environment, or local fallback.
 */
export function resolveKEK(projectRoot: string, optionsKek?: Buffer | string): Buffer {
  if (optionsKek) {
    if (Buffer.isBuffer(optionsKek)) return optionsKek;
    const encoding = optionsKek.length === 64 ? 'hex' : 'base64';
    return Buffer.from(optionsKek, encoding);
  }

  const envKek = process.env.AXIOMIFY_VAULT_KEK;
  if (envKek) {
    const encoding = envKek.length === 64 ? 'hex' : 'base64';
    return Buffer.from(envKek, encoding);
  }

  return loadOrCreateLocalKEK(projectRoot);
}
