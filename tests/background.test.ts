import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve as pathResolve } from 'node:path';
import { DEFAULT_SETTINGS, emptyMetadata, TTL, type RecordItem, type Snapshot } from '../src/types';
let data: Record<string, any>;
let listeners: Record<string, (...args: any[]) => any>;
let downloads: Record<number, any>;
const event = (name: string) => ({ addListener: (fn: (...args: any[]) => any) => listeners[name] = fn });
async function settle() { for (let i = 0; i < 30; i++) await new Promise(r => setTimeout(r, 0)); }
async function message(type: string, fields = {}) {
  return new Promise<any>(resolve => listeners.message({ type, ...fields }, { id: 'test', url: 'chrome-extension://test/options.html' }, resolve));
}
function snapshot(): Snapshot {
  return { pageUrl: 'https://www.nature.com/articles/test', canonicalUrl: 'https://www.nature.com/articles/test', capturedAt: Date.now(), links: [{ url: 'https://www.nature.com/articles/test.pdf', kind: 'Article', label: '' }], metadata: { ...emptyMetadata(), journal: 'Nature', journalFull: 'Nature', year: '2026', title: 'Test paper', author: 'Zhu' } };
}
function download(id: number) {
  downloads[id] = { id, url: snapshot().links[0].url, finalUrl: snapshot().links[0].url, filename: 'C:\\Downloads\\paper.pdf', mime: 'application/pdf', referrer: snapshot().pageUrl, state: 'in_progress' };
  return downloads[id];
}
beforeEach(async () => {
  vi.resetModules(); data = { settings: { ...DEFAULT_SETTINGS, crossref: false }, snapshots: [snapshot()], records: [] }; downloads = {}; listeners = {};
  vi.stubGlobal('chrome', {
    storage: { local: { get: async () => structuredClone(data), set: async (next: unknown) => { Object.assign(data, structuredClone(next)); }, setAccessLevel: vi.fn(async () => {}) } },
    runtime: { id: 'test', getURL: (s: string) => 'chrome-extension://test/' + s, onMessage: event('message'), onStartup: event('startup'), onInstalled: event('installed'), openOptionsPage: vi.fn() },
    downloads: { onCreated: event('created'), onDeterminingFilename: event('determine'), onChanged: event('changed'), search: async ({ id }: { id: number }) => downloads[id] ? [structuredClone(downloads[id])] : [] },
    permissions: { getAll: async () => ({ origins: ['https://www.nature.com/*'] }), contains: vi.fn(async () => true), onAdded: event('grant'), onRemoved: event('revoke') },
    scripting: { getRegisteredContentScripts: async () => [], unregisterContentScripts: vi.fn(), registerContentScripts: vi.fn(), executeScript: vi.fn() },
    tabs: { query: async () => [], onUpdated: event('tabUpdated') }, action: { setBadgeBackgroundColor: vi.fn(), setBadgeText: vi.fn() }
  });
  await import('../src/background'); await settle();
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('MV3 download and storage lifecycle', () => {
  it('warms a direct ACP PDF tab from its publisher without a content script or Crossref', async () => {
    data.snapshots = [];
    const html = readFileSync(pathResolve('tests/fixtures/acp-real-2026.html'), 'utf8');
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => html }); vi.stubGlobal('fetch', fetchMock);
    const url = 'https://acp.copernicus.org/articles/26/14303/2026/acp-26-14303-2026.pdf';
    listeners.tabUpdated(2, { url }, { url }); await settle();
    expect(data.snapshots[0].metadata.author).toBe('Xu');
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('https://acp.copernicus.org/articles/26/14303/2026/', expect.objectContaining({ credentials: 'omit', redirect: 'error' }));
  });
  it('never fetches a publisher page without granted host permission', async () => {
    data.snapshots = [];
    vi.mocked(chrome.permissions.contains as (permissions: chrome.permissions.Permissions) => Promise<boolean>).mockResolvedValue(false);
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    const url = 'https://acp.copernicus.org/articles/26/14303/2026/acp-26-14303-2026.pdf';
    listeners.tabUpdated(2, { url }, { url }); await settle();
    expect(fetchMock).not.toHaveBeenCalled(); expect(data.snapshots).toHaveLength(0);
  });
  it('does not repopulate cleared data when an old publisher request completes', async () => {
    data.snapshots = [];
    let complete: (value: unknown) => void = () => {};
    vi.stubGlobal('fetch', vi.fn(() => new Promise(r => complete = r)));
    const url = 'https://acp.copernicus.org/articles/26/14303/2026/acp-26-14303-2026.pdf';
    listeners.tabUpdated(2, { url }, { url }); await settle(); await message('CLEAR');
    complete({ ok: true, text: async () => readFileSync(pathResolve('tests/fixtures/acp-real-2026.html'), 'utf8') }); await settle();
    expect(data.snapshots).toHaveLength(0);
  });
  it('suggests once per download and keeps concurrent records', async () => {
    const one = vi.fn(), two = vi.fn();
    expect(listeners.determine(download(1), one)).toBe(true); listeners.determine(download(2), two);
    await settle();
    expect(one).toHaveBeenCalledExactlyOnceWith({ filename: 'Nature - 2026 - Zhu - Test paper.pdf', conflictAction: 'uniquify' });
    expect(two).toHaveBeenCalledTimes(1); expect(data.records).toHaveLength(2);
  });
  it('tracks actual paths and failures without claiming PDF verification', async () => {
    listeners.determine(download(1), vi.fn()); await settle();
    downloads[1].state = 'complete'; downloads[1].filename = 'C:\\Downloads\\Nature - 2026 - Zhu - Test paper (1).pdf';
    listeners.changed({ id: 1, state: { current: 'complete' } }); await settle();
    expect(data.records[0].actual).toContain('(1).pdf'); expect(data.records[0].reason).toBe('');
    downloads[1].state = 'interrupted'; downloads[1].error = 'NETWORK_FAILED';
    listeners.changed({ id: 1, error: { current: 'NETWORK_FAILED' } }); await settle();
    expect(data.records[0].state).toBe('interrupted'); expect(data.records[0].downloadError).toBe('NETWORK_FAILED');
    downloads[1].state = 'complete'; delete downloads[1].error;
    listeners.changed({ id: 1, state: { current: 'complete' } }); await settle();
    expect(data.records[0].downloadError).toBeUndefined(); expect(data.records[0].reason).toBe('');
  });
  it('shows a mismatch after an external filename override', async () => {
    listeners.determine(download(1), vi.fn()); await settle();
    downloads[1].state = 'complete'; downloads[1].filename = 'C:\\Downloads\\my-name.pdf';
    listeners.changed({ id: 1, state: { current: 'complete' } }); await settle();
    expect(data.records[0].nameMismatch).toBe(true);
  });
  it('does not interfere with disabled mode, non-PDF, incognito or another extension', async () => {
    data.settings.enabled = false; const callback = vi.fn(); listeners.determine(download(1), callback); await settle();
    expect(callback).toHaveBeenCalledExactlyOnceWith(); expect(data.records).toHaveLength(0);
    for (const override of [{ mime: 'text/csv', filename: 'data.csv' }, { incognito: true }, { byExtensionId: 'other' }]) {
      const cb = vi.fn(); listeners.determine({ ...download(2), ...override }, cb); expect(cb).toHaveBeenCalledExactlyOnceWith();
    }
  });
  it('caps local history, prunes expired metadata and preserves settings on clear', async () => {
    data.records = Array.from({ length: 105 }, (_, id) => ({ id, createdAt: Date.now(), state: 'complete', original: 'p.pdf', kind: 'Unknown', label: '', reason: 'unknown' } as RecordItem));
    data.snapshots = [{ ...snapshot(), capturedAt: Date.now() - TTL - 100 }];
    const state = await message('GET_STATE'); expect(state.records).toHaveLength(100); expect(state.snapshots).toHaveLength(0);
    data.settings.abbreviations = { Test: 'Tst' }; await message('CLEAR');
    expect(data.records).toHaveLength(0); expect(data.snapshots).toHaveLength(0); expect(data.settings.abbreviations).toEqual({ Test: 'Tst' });
  });
  it('revocation clears metadata so old content scripts cannot keep naming', async () => {
    listeners.revoke(); await settle(); expect(data.snapshots).toHaveLength(0);
    const cb = vi.fn(); listeners.determine(download(1), cb); await settle(); expect(cb).toHaveBeenCalledExactlyOnceWith();
  });
  it('survives API lookup failure and only sends the DOI without credentials', async () => {
    data.settings.crossref = true;
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 429 }); vi.stubGlobal('fetch', fetchMock);
    const s = snapshot(); s.metadata.doi = '10.1038/test'; s.metadata.author = '';
    await new Promise(resolve => listeners.message({ type: 'SNAPSHOT', snapshot: s }, { id: 'test', frameId: 0, tab: { id: 1 }, url: s.pageUrl }, resolve));
    await settle();
    expect(fetchMock).toHaveBeenCalledWith('https://api.crossref.org/works/10.1038%2Ftest', expect.objectContaining({ credentials: 'omit', referrerPolicy: 'no-referrer' }));
    expect(data.snapshots[0].lookupNote).toContain('限流');
    const cb = vi.fn(); listeners.determine(download(1), cb); await settle();
    expect(cb).toHaveBeenCalledExactlyOnceWith(); expect(data.records[0].reason).toContain('第一作者姓氏');
  });
});
