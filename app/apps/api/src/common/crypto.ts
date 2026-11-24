import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

// The HKDF salt 'assessiq' is a legacy constant from the product's old working name. It is NOT a brand
// string: changing it would make already-encrypted payout details unreadable. Never rename it.
const key = (secret: string) =>
  Buffer.from(hkdfSync('sha256', secret, 'assessiq', 'payout-details-v1', 32));

/** AES-256-GCM. Output is base64 of iv (12) + auth tag (16) + ciphertext. */
export function encryptText(plain: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(secret), iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
}

export function decryptText(payload: string, secret: string): string {
  const raw = Buffer.from(payload, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key(secret), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
}
