import type { Metadata } from '../types';
import { abbreviation, journalKey } from './journals';
import { doiValue } from './urls';
// No HTML parser exists in an MV3 worker. Crossref title markup is restricted to simple readable tags.
function titleText(raw: string): string {
  return raw.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&#(\d+);/g, (_, n) => { const c = Number(n); return c <= 0x10ffff ? String.fromCodePoint(c) : ''; })
    .replace(/\s+/g, ' ').trim();
}
const titleKey = (s: string) => s.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
export function mergeCrossref(source: Metadata, data: any, custom: Record<string, string>): Metadata {
  const m = structuredClone(source);
  const issue = (s: string) => { if (!m.issues.includes(s)) m.issues.push(s); };
  if (doiValue(data?.DOI || '') !== m.doi) { issue('Crossref DOI 与文章不一致'); return m; }
  if (data.type && data.type !== 'journal-article') { issue('Crossref 记录不是期刊论文'); return m; }
  const rawTitle = String(data.title?.[0] || '');
  const remoteTitle = titleText(rawTitle);
  if (/<(?:\w+:)?(?:math|img|svg)\b|\$[^$]+\$|\\(?:frac|begin)\b|&[a-z]+;|&#x/i.test(rawTitle.replace(/&amp;|&lt;|&gt;|&quot;|&apos;/g, ''))) issue('Crossref 标题含待核实公式或实体');
  if (m.title && remoteTitle && titleKey(m.title) !== titleKey(remoteTitle)) issue('出版方与 Crossref 标题冲突');
  else if (!m.title && remoteTitle) { m.title = remoteTitle; m.sources.title = 'Crossref'; }
  const family = data.author?.[0]?.family;
  if (typeof family === 'string') {
    if (m.author && journalKey(m.author) !== journalKey(family)) issue('出版方与 Crossref 第一作者姓氏冲突');
    else if (!m.author) { m.author = family; m.sources.author = 'Crossref author.family'; }
  }
  const full = String(data['container-title']?.[0] || '');
  const ids: string[] = Array.isArray(data.ISSN) ? data.ISSN : [];
  if (m.journalFull && full && journalKey(m.journalFull) !== journalKey(full) && !ids.some(id => m.issn.includes(id)) &&
      !(abbreviation(full, ids) && abbreviation(full, ids) === abbreviation(m.journalFull, m.issn))) issue('出版方与 Crossref 期刊冲突');
  if (!m.journalFull) m.journalFull = full;
  m.issn = [...new Set([...m.issn, ...ids])];
  const supplied = String(data['short-container-title']?.[0] || '');
  m.journal = abbreviation(m.journalFull, m.issn, custom, m.journal || supplied);
  if (m.journal && !m.sources.journal) m.sources.journal = 'Crossref 期刊缩写';
  const hasVolume = !!(m.volume || data.volume || data.issue);
  const dateYear = (key: string) => String(data[key]?.['date-parts']?.[0]?.[0] || '');
  // Never use issued/created/deposited: they do not establish the formal citation year.
  const remoteYear = hasVolume ? dateYear('published-print') : dateYear('published-online');
  if (remoteYear && /^\d{4}$/.test(remoteYear)) {
    if (m.year && m.year !== remoteYear && m.sources.year === '出版方卷期引用日期') issue('出版方与 Crossref 卷期年份冲突');
    else if (!m.year || (hasVolume && m.sources.year === '出版方在线发表日期')) {
      m.year = remoteYear; m.sources.year = hasVolume ? 'Crossref 正式印刷卷期年份' : 'Crossref 在线发表年份';
    }
  } else if (hasVolume && m.sources.year === '出版方在线发表日期') {
    m.year = ''; delete m.sources.year;
  }
  if (data.volume && !m.volume) m.volume = String(data.volume);
  return m;
}
