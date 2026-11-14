import type { BypassKey } from './messages.ts';

export type SiteMode = 'denylist' | 'allowlist';

export interface Settings {
  /** Master switch. */
  enabled: boolean;
  /** denylist: run everywhere except `sites`. allowlist: run only on `sites`. */
  mode: SiteMode;
  /** Hostnames; an entry also matches its subdomains. `*.` prefix is accepted. */
  sites: string[];
  /** Holding this key while clicking skips the popover and opens the native picker. */
  bypassKey: BypassKey;
  /** Turn copied plain text into a .txt file. */
  pasteText: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  mode: 'denylist',
  sites: [],
  bypassKey: 'shift',
  pasteText: true,
};

export async function loadSettings(): Promise<Settings> {
  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS as unknown as Record<string, unknown>);
  return { ...DEFAULT_SETTINGS, ...(stored as Partial<Settings>) };
}

export function saveSettings(s: Partial<Settings>): Promise<void> {
  return chrome.storage.sync.set(s);
}

/** Normalises a user-entered site ("https://www.Foo.com/bar", "*.foo.com") to a hostname. */
export function normaliseSite(entry: string): string {
  let s = entry.trim().toLowerCase();
  if (!s || s.startsWith('#')) return '';
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/^\*\./, '');
  s = s.split(/[/?#]/)[0]!.replace(/:\d+$/, '');
  return s;
}

export function hostMatches(host: string, site: string): boolean {
  const h = host.toLowerCase();
  const s = normaliseSite(site);
  return !!s && (h === s || h.endsWith('.' + s));
}

/** Whether the extension should run, given the hosts relevant to this frame. */
export function isEnabledFor(settings: Settings, hosts: string[]): boolean {
  if (!settings.enabled) return false;
  const listed = hosts.some((host) => settings.sites.some((site) => hostMatches(host, site)));
  return settings.mode === 'denylist' ? !listed : listed;
}
