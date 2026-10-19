import type { DownloadLike, RecordItem, Settings, Snapshot } from '../types';
import { filename, parentPath } from './naming';
import { isPdf, matchDownload, readyMetadata } from './match';
export async function decide(item: DownloadLike, settings: Settings, snapshots: Snapshot[]): Promise<RecordItem | undefined> {
  if (!settings.enabled || !isPdf(item)) return;
  const result = matchDownload(item, snapshots);
  const record: RecordItem = { id: item.id, createdAt: Date.now(), original: item.filename, state: 'progress', reason: '', kind: 'Unknown', label: '' };
  if (!result.match) { record.reason = result.reason || '未找到文章'; return record; }
  const m = result.match;
  const checked = readyMetadata(m.metadata, settings.abbreviations);
  Object.assign(record, { metadata: checked.metadata, kind: m.kind, label: m.label, pageUrl: m.pageUrl });
  if (m.kind === 'Unknown') checked.reasons.push('未确认正文或附件类型');
  if ((m.kind === 'SI' || m.kind === 'PeerReview') && !m.label) checked.reasons.push('缺少原附件标识');
  if (checked.reasons.length) { record.reason = [...checked.reasons, m.note].filter(Boolean).join('；'); return record; }
  try { record.proposed = await filename({ ...checked.metadata, kind: m.kind, label: m.label }, parentPath(item.filename)); }
  catch (error) { record.reason = (error as Error).message; }
  return record;
}
// The browser callback must run exactly once, even when storage or metadata processing stalls.
export async function bounded<T>(operation: Promise<T>, fallback: () => T, ms = 1900): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([operation, new Promise<T>(resolve => { timer = setTimeout(() => resolve(fallback()), ms); })]); }
  finally { clearTimeout(timer); }
}
