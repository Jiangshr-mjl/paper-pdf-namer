import { TTL, type DownloadLike, type Kind, type Metadata, type Snapshot } from '../types';
import { doiFromUrl, urlKey } from './urls';
import { abbreviation } from './journals';
export function isPdf(item: DownloadLike): boolean {
  if (item.mime && !['application/pdf', 'application/octet-stream', 'binary/octet-stream', ''].includes(item.mime.toLowerCase().split(';')[0])) return false;
  return item.mime.toLowerCase().split(';')[0] === 'application/pdf' || /\.pdf$/i.test(item.filename);
}
export interface Match { metadata: Metadata; kind: Kind; label: string; pageUrl: string; note?: string }
export function matchDownload(item: DownloadLike, snapshots: Snapshot[], now = Date.now()): { match?: Match; reason?: string } {
  const urls = [urlKey(item.url), urlKey(item.finalUrl)].filter(Boolean);
  const dois = [doiFromUrl(item.url), doiFromUrl(item.finalUrl)].filter(Boolean);
  const candidates: Match[] = [];
  for (const s of snapshots) {
    if (now - s.capturedAt > TTL) continue;
    const links = s.links.filter(l => urls.includes(urlKey(l.url)));
    const ref = urlKey(item.referrer);
    const referenceMatches = !!ref && [urlKey(s.pageUrl), urlKey(s.canonicalUrl)].includes(ref);
    const doiMatches = !!s.metadata.doi && dois.includes(s.metadata.doi);
    if (!links.length && !referenceMatches && !doiMatches) continue;
    for (const l of links.length ? links : [{ kind: doiMatches ? 'Article' as const : 'Unknown' as const, label: '' }]) {
      candidates.push({ metadata: s.metadata, kind: l.kind, label: l.label, pageUrl: s.pageUrl, note: s.lookupNote });
    }
  }
  if (!candidates.length) return { reason: '未找到可可靠关联的文章信息（未授权、直接 PDF 或普通 PDF）' };
  const identity = (m: Match) => m.metadata.doi || `${m.metadata.journalFull}|${m.metadata.title}`;
  if (new Set(candidates.map(identity)).size > 1) return { reason: '下载来源对应多篇文献，已保留原名' };
  const specific = candidates.filter(c => c.kind !== 'Unknown');
  const pool = specific.length ? specific : candidates;
  if (new Set(pool.map(c => `${c.kind}|${c.label}|${c.metadata.year}|${c.metadata.author}|${c.metadata.title}`)).size > 1) return { reason: '文章或附件信息冲突，已保留原名' };
  // Do not discard a conflicting snapshot of the same DOI.
  const problems = [...new Set(candidates.flatMap(c => c.metadata.issues))];
  return { match: { ...pool[0], metadata: { ...pool[0].metadata, issues: problems } } };
}
export function readyMetadata(m: Metadata, custom: Record<string, string>): { metadata: Metadata; reasons: string[] } {
  const result = { ...m, journal: abbreviation(m.journalFull, m.issn, custom, m.journal) };
  const reasons = [...m.issues];
  for (const [key, label] of [['journal', '期刊缩写'], ['year', '引用年份'], ['author', '第一作者姓氏'], ['title', '标题']] as const) {
    if (!result[key]) reasons.push(`缺少已核实的${label}`);
  }
  return { metadata: result, reasons };
}
