import { DEFAULT_BOARDS, type LayoutDocument, type WidgetInstance } from '../types/layout.ts';
import { deriveSecretKey, fromHex, hashPassword, openSecrets, randomBytes, sealSecrets, toHex, verifyPassword } from './crypto.ts';
import { isPrivateApp } from './privateApps.ts';

export interface ProfileAccount {
  id: string;
  name: string;
  salt: string;
  hash: string;
}

export interface SealedSecrets {
  iv: string;
  data: string;
}

export interface ProfileDatabase {
  accounts: ProfileAccount[];
  /** Older private-widget lists. Boards now live in `layouts`. */
  widgets: Record<string, WidgetInstance[]>;
  layouts: Record<string, LayoutDocument>;
  secrets: Record<string, SealedSecrets>;
}

export function emptyUserLayout(now = 0): LayoutDocument {
  return { version: 1, boards: DEFAULT_BOARDS, widgets: [], updatedAt: now };
}

export function emptyProfileDatabase(): ProfileDatabase {
  return { accounts: [], widgets: {}, layouts: {}, secrets: {} };
}

export async function createProfileAccount(
  db: ProfileDatabase,
  name: string,
  password: string,
  id: string,
): Promise<{ db: ProfileDatabase; account: ProfileAccount; key: CryptoKey }> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Enter a profile name.');
  if (!password) throw new Error('Enter a password.');
  if (db.accounts.some((account) => account.name.toLowerCase() === trimmed.toLowerCase())) {
    throw new Error('That profile name is already in use.');
  }
  const salt = randomBytes(16);
  const account: ProfileAccount = {
    id,
    name: trimmed,
    salt: toHex(salt),
    hash: await hashPassword(password, salt),
  };
  const key = await deriveSecretKey(password, salt);
  return {
    db: {
      ...db,
      accounts: [...db.accounts, account],
      widgets: { ...(db.widgets ?? {}), [id]: [] },
      layouts: { ...(db.layouts ?? {}), [id]: emptyUserLayout() },
    },
    account,
    key,
  };
}

export function readLayout(db: ProfileDatabase, profileId: string): LayoutDocument {
  const saved = db.layouts?.[profileId];
  if (saved && saved.version === 1 && Array.isArray(saved.widgets)) return saved;
  const legacy = db.widgets?.[profileId];
  if (Array.isArray(legacy) && legacy.length > 0) {
    return { version: 1, boards: DEFAULT_BOARDS, widgets: legacy, updatedAt: 0 };
  }
  return emptyUserLayout();
}

export function writeLayout(db: ProfileDatabase, profileId: string, layout: LayoutDocument): ProfileDatabase {
  return {
    ...db,
    layouts: {
      ...db.layouts,
      [profileId]: { ...layout, version: 1, updatedAt: layout.updatedAt },
    },
  };
}

export async function unlockProfile(
  db: ProfileDatabase,
  name: string,
  password: string,
): Promise<{ account: ProfileAccount; key: CryptoKey }> {
  const account = db.accounts.find((row) => row.name.toLowerCase() === name.trim().toLowerCase());
  if (!account || !(await verifyPassword(password, account.salt, account.hash))) {
    throw new Error('Wrong name or password.');
  }
  return { account, key: await deriveSecretKey(password, fromHex(account.salt)) };
}

export function privateWidgetsFor(db: ProfileDatabase, profileId: string): WidgetInstance[] {
  return db.widgets[profileId] ?? [];
}

export function addPrivateWidget(db: ProfileDatabase, profileId: string, widget: WidgetInstance): ProfileDatabase {
  if (!isPrivateApp(widget.type)) throw new Error('Only a private app can be saved on a profile.');
  const current = db.widgets[profileId] ?? [];
  return { ...db, widgets: { ...db.widgets, [profileId]: [...current, widget] } };
}

export function removePrivateWidget(db: ProfileDatabase, profileId: string, widgetId: string): ProfileDatabase {
  const current = db.widgets[profileId] ?? [];
  return { ...db, widgets: { ...db.widgets, [profileId]: current.filter((widget) => widget.id !== widgetId) } };
}

export function movePrivateWidgets(
  db: ProfileDatabase,
  profileId: string,
  moved: Pick<WidgetInstance, 'id' | 'x' | 'y' | 'w' | 'h'>[],
): ProfileDatabase {
  const byId = new Map(moved.map((item) => [item.id, item]));
  const current = db.widgets[profileId] ?? [];
  return {
    ...db,
    widgets: {
      ...db.widgets,
      [profileId]: current.map((widget) => {
        const next = byId.get(widget.id);
        return next ? { ...widget, x: next.x, y: next.y, w: next.w, h: next.h } : widget;
      }),
    },
  };
}

export async function writeProfileSecret(
  db: ProfileDatabase,
  profileId: string,
  key: CryptoKey,
  app: string,
  value: string,
): Promise<ProfileDatabase> {
  if (!isPrivateApp(app)) throw new Error('Credentials can only be saved for a private app.');
  const sealed = db.secrets[profileId];
  const current = sealed ? await openSecrets(key, sealed) : {};
  if (value) current[app] = value;
  else delete current[app];
  const next = await sealSecrets(key, current);
  return { ...db, secrets: { ...db.secrets, [profileId]: next } };
}

export async function readProfileSecret(
  db: ProfileDatabase,
  profileId: string,
  key: CryptoKey,
  app: string,
): Promise<string> {
  const sealed = db.secrets[profileId];
  if (!sealed) return '';
  const current = await openSecrets(key, sealed);
  return current[app] ?? '';
}
