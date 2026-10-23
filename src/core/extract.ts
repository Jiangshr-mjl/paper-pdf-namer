import { emptyMetadata, type Kind, type PaperLink, type Snapshot } from '../types';
import { abbreviation } from './journals';
import { doiFromUrl, doiValue, urlKey, isAmsArticlePdf, annualReviewsPdfTarget } from './urls';

export function readableTitle(raw: string, doc: Document): { text: string; unsafe: boolean } {
  const el = doc.createElement('template'); el.innerHTML = raw;
  let unsafe = false;
  el.content.querySelectorAll('script, style').forEach(n => n.remove());
  el.content.querySelectorAll('math, img, svg, .MathJax').forEach(n => {
    const alt = n.getAttribute('alttext') || n.getAttribute('alt') || n.getAttribute('aria-label');
    if (alt) n.replaceWith(doc.createTextNode(alt)); else unsafe = true;
  });
  const text = Array.from(el.content.childNodes).map(n => n.textContent || '').join('').replace(/\s+/g, ' ').trim();
  return { text, unsafe: unsafe || /\$[^$]+\$|\\\(|\\\[|\\(?:frac|mathrm|text|begin)\b/.test(text) };
}
function scholarlyNodes(doc: Document): Record<string, any>[] {
  const nodes: Record<string, any>[] = [];
  const walk = (x: any, depth = 0) => {
    if (!x || depth > 8) return;
    if (Array.isArray(x)) { x.forEach(v => walk(v, depth + 1)); return; }
    if (typeof x !== 'object') return;
    const type = Array.isArray(x['@type']) ? x['@type'] : [x['@type']];
    if (type.some((t: unknown) => ['ScholarlyArticle', 'MedicalScholarlyArticle'].includes(String(t)))) nodes.push(x);
    if (x['@graph']) walk(x['@graph'], depth + 1);
    if (x.mainEntity) walk(x.mainEntity, depth + 1);
  };
  doc.querySelectorAll('script[type="application/ld+json"]').forEach(s => { try { walk(JSON.parse(s.textContent || '')); } catch { /* invalid structured data */ } });
  return nodes;
}
export function classifyLink(anchor: HTMLAnchorElement, primary: Set<string>, page: string, doi: string): PaperLink | undefined {
  let url: URL;
  try { url = new URL(anchor.getAttribute('href') || '', page); } catch { return; }
  if (!['http:', 'https:', 'blob:'].includes(url.protocol)) return;
  const href = url.href, key = urlKey(href);
  const text = `${anchor.textContent || ''} ${anchor.title} ${anchor.getAttribute('aria-label') || ''}`;
  const context = anchor.closest('[id*="supplement"], [id*="Supplement"], [class*="supplement"], [id*="peer-review"], [id*="PeerReview"]');
  const hint = text + ' ' + url.pathname + ' ' + (context?.id || '') + ' ' + (context?.className || '');
  const amsBody = isAmsArticlePdf(href, page);
  const isPdf = /\.pdf$/i.test(url.pathname) || /\bPDF\b/i.test(text) || anchor.type === 'application/pdf' || primary.has(key) || amsBody;
  if (!isPdf) return;
  let kind: Kind = 'Unknown';
  if (/peer[\s_-]*review|review[\s_-]*history|reviewer[\s_-]*(?:report|comment)/i.test(hint)) kind = 'PeerReview';
  else if (/supplement|supporting[\s_-]*(?:information|material)|MOESM\d+|\bsuppl\b|\.s\d+\./i.test(hint)) kind = 'SI';
  else if (primary.has(key) || amsBody || (doi && doiFromUrl(href) === doi)) kind = 'Article';
  else {
    // Nature article PDF and Copernicus /article.pdf; match the article path, not arbitrary PDF links in references.
    const article = new URL(page);
    if (url.hostname === article.hostname && url.pathname.replace(/\.pdf$/, '') === article.pathname.replace(/\/$/, '')) kind = 'Article';
  }
  let label = '';
  if (kind === 'SI' || kind === 'PeerReview') {
    try { label = decodeURIComponent(url.pathname.split('/').pop() || '').replace(/\.pdf$/i, ''); } catch { /* unresolved label */ }
    if (!/\.pdf$/i.test(url.pathname)) label = anchor.getAttribute('download')?.replace(/\.pdf$/i, '') || '';
  }
  return { url: annualReviewsPdfTarget(href)?.pdf || href, kind, label };
}
export function extract(doc: Document, pageUrl: string): Snapshot | undefined {
  const m = emptyMetadata();
  const metas = Array.from(doc.querySelectorAll('meta[name], meta[property]'));
  const values = (...names: string[]) => metas.filter(n => names.includes((n.getAttribute('name') || n.getAttribute('property') || '').toLowerCase())).map(n => n.getAttribute('content')?.trim() || '').filter(Boolean);
  const get = (...names: string[]) => names.map(name => values(name)[0]).find(Boolean) || '';
  const json = scholarlyNodes(doc);
  const node = json.length === 1 ? json[0] : undefined;
  if (json.length > 1) m.issues.push('页面包含多篇文献，需确认归属');
  m.journalFull = get('citation_journal_title', 'prism.publicationname');
  m.issn = values('citation_issn', 'prism.issn', 'prism.eissn');
  const dois = ['citation_doi', 'prism.doi', 'dc.identifier.doi', 'dc.identifier'].flatMap(name => values(name)).map(doiValue).filter(Boolean);
  m.doi = dois[0] || '';
  if (new Set(dois).size > 1) m.issues.push('页面包含多个不同的文献 DOI');
  if (!m.doi && node) {
    const id = node.identifier;
    m.doi = doiValue(typeof id === 'string' ? id : id?.value || '') || doiFromUrl(node.sameAs || '');
  }
  if (!m.doi && new URL(pageUrl).origin === 'https://www.annualreviews.org') m.doi = doiFromUrl(pageUrl);
  m.volume = get('citation_volume', 'prism.volume');
  if (node?.isPartOf) {
    let part = node.isPartOf;
    for (let i = 0; part && i < 4; i++, part = part.isPartOf) {
      if (!m.volume && part.volumeNumber) m.volume = String(part.volumeNumber);
      if (!m.journalFull && part['@type'] === 'Periodical') m.journalFull = part.name || '';
    }
  }
  const rawTitle = get('citation_title', 'dc.title') || node?.headline || node?.name || '';
  // A generic PDF or blog title alone is insufficient evidence of a journal article.
  if (!rawTitle || (!m.journalFull && !m.doi)) return;
  const title = readableTitle(String(rawTitle), doc);
  m.title = title.text;
  if (title.unsafe) m.issues.push('标题含无法可靠转换的公式或图片');
  if (m.title) m.sources.title = '出版方页面';
  const firstAuthor = Array.isArray(node?.author) ? node.author[0] : node?.author;
  m.author = get('citation_author_lastname', 'citation_author_surname') || (typeof firstAuthor?.familyName === 'string' ? firstAuthor.familyName : '');
  if (m.author) m.sources.author = '出版方结构化姓氏';
  if (!m.author && /(^|\.)copernicus\.org$/i.test(new URL(pageUrl).hostname)) {
    // Copernicus explicitly exports citation_author as "family, given". Never split a space-separated name.
    const author = get('citation_author').match(/^([^,;]+),\s*([^,;]+)$/);
    if (author && !/^(?:jr\.?|sr\.?|ii|iii|iv)$/i.test(author[2].trim())) {
      m.author = author[1].trim(); m.sources.author = 'Copernicus citation_author（姓, 名）';
    }
  }
  const year = (v: unknown) => String(v || '').match(/^(\d{4})(?:\D|$)/)?.[1] || '';
  const citationDate = get('citation_publication_date', 'citation_date', 'prism.publicationdate');
  const assigned = !!(m.volume || get('citation_issue', 'prism.number'));
  m.year = assigned ? year(citationDate) : year(get('citation_online_date') || node?.datePublished || citationDate);
  if (m.year) m.sources.year = assigned ? '出版方卷期引用日期' : '出版方在线发表日期';
  m.journal = abbreviation(m.journalFull, m.issn, {}, get('citation_journal_abbrev'));
  if (m.journal) m.sources.journal = '已核实期刊表／出版方缩写';
  let canonicalUrl = pageUrl;
  try {
    const canonical = doc.querySelector('link[rel="canonical"]')?.getAttribute('href');
    if (canonical) { const u = new URL(canonical, pageUrl); if (u.origin === new URL(pageUrl).origin) canonicalUrl = u.href; }
  } catch { /* use source URL */ }
  const links: PaperLink[] = [];
  const primary = new Set<string>();
  for (const value of values('citation_pdf_url')) {
    try {
      const url = new URL(value, pageUrl);
      if (!['https:', 'http:'].includes(url.protocol)) continue;
        primary.add(urlKey(url.href)); links.push({ url: annualReviewsPdfTarget(url.href)?.pdf || url.href, kind: 'Article', label: '' });
    } catch { /* malformed publisher URL */ }
  }
  for (const a of doc.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    const link = classifyLink(a, primary, canonicalUrl, m.doi);
    if (link && links.length < 250) {
      const prior = links.findIndex(x => urlKey(x.url) === urlKey(link.url));
      if (prior < 0) links.push(link);
      else if (links[prior].kind !== link.kind && link.kind !== 'Unknown') links[prior] = { ...link, kind: 'Unknown' };
    }
  }
  return { pageUrl, canonicalUrl, metadata: m, links, capturedAt: Date.now() };
}
