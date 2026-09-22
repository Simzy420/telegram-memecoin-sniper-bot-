const PLACEHOLDER_MARKERS = ["change-me", "changeme", "dev-only", "placeholder"];

/** A key we will actually use to encrypt wallet material. Placeholders are rejected. */
export function isRealEncryptionKey(value: string | undefined | null): boolean {
  if (!value) return false;
  const key = value.trim();
  if (key.length < 32) return false;
  const lower = key.toLowerCase();
  return !PLACEHOLDER_MARKERS.some((mark) => lower.includes(mark));
}

export class EncryptionKeyError extends Error {
  constructor() {
    super(
      "WALLET_ENCRYPTION_KEY must be a real 32+ character secret that you have backed up offline. Placeholder keys are refused. No wallet was stored.",
    );
    this.name = "EncryptionKeyError";
  }
}

export function requireEncryptionKey(): string {
  const key = process.env.WALLET_ENCRYPTION_KEY ?? "";
  if (!isRealEncryptionKey(key)) throw new EncryptionKeyError();
  return key.trim();
}
