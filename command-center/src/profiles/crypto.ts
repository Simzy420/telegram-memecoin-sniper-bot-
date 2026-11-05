const ITERATIONS = 100_000;

function subtle(): SubtleCrypto {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.subtle) throw new Error('Web Crypto is unavailable.');
  return cryptoApi.subtle;
}

export function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

export function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function source(bytes: Uint8Array): BufferSource {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function deriveBits(password: string, salt: Uint8Array): Promise<ArrayBuffer> {
  const base = await subtle().importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return subtle().deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: source(salt), iterations: ITERATIONS }, base, 256);
}

export async function hashPassword(password: string, salt: Uint8Array): Promise<string> {
  return toHex(new Uint8Array(await deriveBits(password, salt)));
}

export async function verifyPassword(password: string, saltHex: string, hashHex: string): Promise<boolean> {
  const actual = await hashPassword(password, fromHex(saltHex));
  if (actual.length !== hashHex.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i += 1) diff |= actual.charCodeAt(i) ^ hashHex.charCodeAt(i);
  return diff === 0;
}

export async function deriveSecretKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await subtle().importKey('raw', new TextEncoder().encode(`key:${password}`), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: source(salt), iterations: ITERATIONS },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function sealSecrets(key: CryptoKey, secrets: Record<string, string>): Promise<{ iv: string; data: string }> {
  const iv = randomBytes(12);
  const cipher = await subtle().encrypt(
    { name: 'AES-GCM', iv: source(iv) },
    key,
    new TextEncoder().encode(JSON.stringify(secrets)),
  );
  return { iv: toHex(iv), data: toHex(new Uint8Array(cipher)) };
}

export async function openSecrets(key: CryptoKey, sealed: { iv: string; data: string }): Promise<Record<string, string>> {
  const plain = await subtle().decrypt(
    { name: 'AES-GCM', iv: source(fromHex(sealed.iv)) },
    key,
    source(fromHex(sealed.data)),
  );
  const parsed: unknown = JSON.parse(new TextDecoder().decode(plain));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(parsed)) {
    if (typeof value === 'string') out[name] = value;
  }
  return out;
}
