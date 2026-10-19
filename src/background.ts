import { decide, bounded } from './core/decision';
import { isPdf } from './core/match';
import { basename, validateTemplate } from './core/naming';
import { mergeCrossref } from './core/crossref';
import { doiValue, urlKey } from './core/urls';
import { readState, updateState } from './store';
import { CROSSREF_ORIGIN, syncScripts } from './permissions';
import type { RecordItem, Snapshot } from './types';
import { copernicusTarget, parsePublisherPage } from './core/publisher';

const lookups = new Map<string, Promise<unknown>>();
const publisherLookups = new Map<string, Promise<void>>();
let generation = 0;
let permissionQueue: Promise<unknown> = Promise.resolve();
function synchronize(inject = false) {
  permissionQueue = permissionQueue.catch(() => {}).then(async () => {
    await syncScripts(inject);
    // PDF viewers cannot host our content script. Also warm PDFs already open when permission is granted.
    const tabs = await chrome.tabs.query({ url: ['https://acp.copernicus.org/articles/*'] });
    for (const tab of tabs) if (tab.url) void preparePdf(tab.url).catch(() => {});
  });
  void permissionQueue.catch(console.error);
}
async function preparePdf(url: string): Promise<void> {
  const target = copernicusTarget(url);
  if (!target) return;
  const epoch = generation;
  if (!await chrome.permissions.contains({ origins: ['https://acp.copernicus.org/*'] })) return;
  const state = await readState();
  if (!state.settings.enabled) return;
  if (state.snapshots.some(s => s.metadata.doi === target.doi && s.metadata.author && s.links.some(l => urlKey(l.url) === target.pdf))) return;
  const pending = publisherLookups.get(target.page);
  if (pending) return pending;
  const task = (async () => {
    const response = await fetch(target.page, { credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`出版方元数据查询失败（${response.status}）`);
    const html = await response.text();
    if (html.length > 3_000_000) throw new Error('出版方页面过大');
    const snapshot = parsePublisherPage(html, url);
    if (epoch !== generation) return;
    await updateState(s => {
      if (epoch !== generation || !s.settings.enabled) return;
      s.snapshots = s.snapshots.filter(x => x.pageUrl !== snapshot.pageUrl); s.snapshots.push(snapshot);
    });
  })();
  publisherLookups.set(target.page, task);
  try { await task; } finally { publisherLookups.delete(target.page); }
}
chrome.tabs.onUpdated.addListener((_tabId, change, tab) => {
  const url = change.url || tab.url;
  if (url && (change.url || change.status === 'complete')) void preparePdf(url).catch(() => {});
});
chrome.downloads.onCreated.addListener(item => {
  if (!item.incognito) void preparePdf(item.finalUrl || item.url).catch(() => {});
});
async function badge() {
  const { records } = await readState();
  const count = records.filter(r => !r.proposed && !r.draft && r.state !== 'interrupted').length;
  await chrome.action.setBadgeBackgroundColor({ color: '#b05c25' });
  await chrome.action.setBadgeText({ text: count ? String(count) : '' });
}
async function warm(snapshot: Snapshot, epoch: number) {
  const state = await readState(), doi = snapshot.metadata.doi;
  if (!doi || !state.settings.crossref || !await chrome.permissions.contains({ origins: [CROSSREF_ORIGIN] })) return;
  let note = '', data: unknown = state.crossrefCache[doi]?.data;
  if (!data) {
    let lookup = lookups.get(doi);
    if (!lookup) {
      lookup = (async () => {
        const response = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, {
          credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(6000)
        });
        if (!response.ok) throw new Error(response.status === 429 ? 'Crossref 限流，稍后刷新文章页重试' : `Crossref 查询失败（${response.status}）`);
        const body = await response.json();
        if (!body.message || doiValue(body.message.DOI || '') !== doi) throw new Error('Crossref DOI 核对失败');
        // Persist only bibliographic fields; never the full API response or PDF links.
        const keys = ['DOI', 'type', 'title', 'author', 'container-title', 'short-container-title', 'ISSN', 'volume', 'issue', 'published-print', 'published-online'];
        return Object.fromEntries(keys.filter(k => k in body.message).map(k => [k, body.message[k]]));
      })();
      lookups.set(doi, lookup);
      void lookup.finally(() => lookups.delete(doi)).catch(() => {});
    }
    try { data = await lookup; } catch (error) { note = (error as Error).name === 'TimeoutError' ? 'Crossref 查询超时，可刷新文章页重试' : (error as Error).message; }
  }
  if (epoch !== generation) return;
  await updateState(s => {
    if (epoch !== generation || !s.settings.crossref) return;
    if (data) s.crossrefCache[doi] = { at: Date.now(), data };
    const current = s.snapshots.find(x => x.pageUrl === snapshot.pageUrl && x.capturedAt === snapshot.capturedAt);
    if (current) {
      if (data) current.metadata = mergeCrossref(current.metadata, data, s.settings.abbreviations);
      current.lookupNote = note;
    }
  });
}
async function acceptSnapshot(raw: unknown, sender: chrome.runtime.MessageSender) {
  if (!sender.tab || sender.frameId !== 0 || !sender.url || !/^https?:/.test(sender.url)) return;
  if (JSON.stringify(raw).length > 160000) return;
  const snapshot = raw as Snapshot;
  if (!snapshot?.metadata || !Array.isArray(snapshot.links) || snapshot.links.length > 250 || urlKey(snapshot.pageUrl) !== urlKey(sender.url)) return;
  if (!await chrome.permissions.contains({ origins: [new URL(sender.url).origin + '/*'] })) return;
  const state = await readState();
  if (!state.settings.enabled) return;
  const epoch = generation;
  snapshot.capturedAt = Date.now();
  const cached = state.crossrefCache[snapshot.metadata.doi];
  if (cached && state.settings.crossref) snapshot.metadata = mergeCrossref(snapshot.metadata, cached.data, state.settings.abbreviations);
  await updateState(s => { s.snapshots = s.snapshots.filter(x => x.pageUrl !== snapshot.pageUrl); s.snapshots.push(snapshot); });
  void warm(snapshot, epoch).catch(console.error);
}
async function refreshRecord(id: number) {
  const [item] = await chrome.downloads.search({ id });
  if (!item) return;
  await updateState(s => {
    const r = s.records.find(x => x.id === id);
    if (!r) return;
    r.actual = item.filename;
    r.state = item.state === 'in_progress' ? 'progress' : item.state;
    r.downloadError = item.error;
    if (r.state === 'complete' && r.proposed) {
      const actual = basename(item.filename);
      const expected = r.proposed.slice(0, -4);
      const withoutNumber = actual.replace(/ \(\d+\)(?=\.pdf$)/i, '');
      r.nameMismatch = actual !== r.proposed && withoutNumber !== expected + '.pdf';
    }
  });
  await badge();
}
chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  if (!isPdf(item) || item.incognito || (item.byExtensionId && item.byExtensionId !== chrome.runtime.id)) { suggest(); return; }
  const fallback = (): RecordItem => ({ id: item.id, createdAt: Date.now(), original: item.filename, state: 'progress', reason: copernicusTarget(item.finalUrl || item.url) ? '出版方元数据仍在准备中。请先打开文章页，或稍候重新下载；本次保留原名' : '命名处理超时或暂不可用，已保留原名', kind: 'Unknown', label: '' });
  const epoch = generation;
  const operation = (async () => {
    await preparePdf(item.finalUrl || item.url).catch(() => {});
    const state = await readState();
    return decide(item, state.settings, state.snapshots);
  })().catch(() => fallback());
  void bounded(operation, fallback).then(record => {
    // Always release the browser before persisting history.
    if (record?.proposed) suggest({ filename: record.proposed, conflictAction: 'uniquify' }); else suggest();
    if (!record || epoch !== generation) return;
    void updateState(s => { s.records = [record, ...s.records.filter(r => r.id !== record.id)]; })
      .then(() => refreshRecord(record.id)).catch(console.error);
  });
  return true;
});
chrome.downloads.onChanged.addListener(delta => {
  if (delta.state || delta.filename || delta.error) void refreshRecord(delta.id).catch(console.error);
});
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return;
  if (message?.type === 'SNAPSHOT') {
    void acceptSnapshot(message.snapshot, sender).then(() => respond({ ok: true })).catch(() => respond({ ok: false })); return true;
  }
  if (!sender.url?.startsWith(chrome.runtime.getURL(''))) return;
  const run = async () => {
    switch (message.type) {
      case 'GET_STATE': return await readState();
      case 'SETTINGS':
          if (Object.prototype.hasOwnProperty.call(message.settings || {}, 'namingTemplate')) validateTemplate(message.settings.namingTemplate);
        await updateState(s => { s.settings = { ...s.settings, ...message.settings }; });
        return { ok: true };
      case 'SAVE_DRAFT':
        await updateState(s => { const record = s.records.find(r => r.id === message.id); if (record) record.draft = message.draft; });
        await badge(); return { ok: true };
      case 'CLEAR':
        generation++;
        await updateState(s => { s.snapshots = []; s.records = []; s.crossrefCache = {}; });
        await badge(); return { ok: true };
      case 'SYNC': synchronize(true); await permissionQueue; return { ok: true };
      default: throw new Error('未知操作');
    }
  };
  void run().then(respond).catch(error => respond({ error: (error as Error).message })); return true;
});
chrome.permissions.onAdded.addListener(() => synchronize(true));
chrome.permissions.onRemoved.addListener(() => {
  generation++;
  void updateState(s => { s.snapshots = []; s.crossrefCache = {}; }).catch(console.error);
  synchronize();
});
chrome.runtime.onInstalled.addListener(details => {
  void chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  synchronize(true);
  if (details.reason === 'install') void chrome.runtime.openOptionsPage();
});
chrome.runtime.onStartup.addListener(() => {
  synchronize();
  void readState().then(s => Promise.allSettled(s.records.filter(r => r.state === 'progress').map(r => refreshRecord(r.id))));
});
void updateState(() => {}).then(badge).catch(console.error);
