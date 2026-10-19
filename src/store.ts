import { DEFAULT_SETTINGS, TTL, type RecordItem, type Settings, type Snapshot } from './types';
export interface CacheEntry { at: number; data: unknown }
export interface State { settings: Settings; snapshots: Snapshot[]; records: RecordItem[]; crossrefCache: Record<string, CacheEntry> }
let queue: Promise<unknown> = Promise.resolve();
export async function readState(): Promise<State> {
  const raw = await chrome.storage.local.get(['settings', 'snapshots', 'records', 'crossrefCache']) as Partial<State>;
  return {
    settings: { ...DEFAULT_SETTINGS, ...raw.settings },
    snapshots: (raw.snapshots || []).filter((s: Snapshot) => Date.now() - s.capturedAt < TTL).slice(-150),
    records: (raw.records || []).slice(0, 100),
    crossrefCache: Object.fromEntries(Object.entries(raw.crossrefCache || {}).filter(([, c]) => Date.now() - (c as CacheEntry).at < TTL)) as Record<string, CacheEntry>
  };
}
export function updateState(change: (state: State) => void): Promise<State> {
  const task = queue.then(async () => {
    const state = await readState(); change(state);
    state.records = state.records.slice(0, 100);
    state.snapshots = state.snapshots.filter(s => Date.now() - s.capturedAt < TTL).slice(-150);
    state.crossrefCache = Object.fromEntries(Object.entries(state.crossrefCache).sort((a, b) => b[1].at - a[1].at).slice(0, 150));
    await chrome.storage.local.set(state); return state;
  });
  queue = task.catch(() => {}); return task;
}
