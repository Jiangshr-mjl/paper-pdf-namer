export function urlKey(value: string): string {
  try { const u = new URL(value); u.hash = ''; return annualReviewsPdfTarget(value)?.pdf || u.href; } catch { return ''; }
}
// Normalize only the observed publisher body route and its known access parameters.
// Do not remove arbitrary queries globally or reinterpret supplement/figure filenames.
export function annualReviewsPdfTarget(value: string): { pdf: string; doi: string; page: string; origin: string } | undefined {
  try {
    const u = new URL(value);
    if (u.origin !== 'https://www.annualreviews.org' || u.username || u.password) return;
    const m = u.pathname.match(/^\/docserver\/fulltext\/([a-z]+)\/\d+\/\d+\/(annurev-\1-\d{6}-\d{6})\.pdf$/);
    if (!m || Array.from(u.searchParams.keys()).some(k => !['expires', 'id', 'accname', 'checksum'].includes(k))) return;
    const doi = `10.1146/${m[2]}`;
    return { pdf: u.origin + u.pathname, doi, page: `${u.origin}/content/journals/${doi}`, origin: u.origin };
  } catch { return; }
}
// AMS article routes retain journal/volume/issue/article identity when serving a PDF.
// Restrict this to the publisher host and exact article stem, never references or figures.
export function isAmsArticlePdf(pdf: string, page: string): boolean {
  try {
    const p = new URL(page), d = new URL(pdf);
    if (p.origin !== 'https://journals.ametsoc.org' || d.origin !== p.origin || p.username || p.password || d.username || d.password || p.search || d.search) return false;
    const article = p.pathname.match(/^\/view\/journals\/([^/]+\/\d+\/[^/]+\/[^/]+)\.xml$/);
    if (!article) return false;
    return d.pathname === `/view/journals/${article[1]}.pdf`
      || d.pathname === `/downloadpdf/journals/${article[1]}.xml`
      || d.pathname === `/downloadpdf/view/journals/${article[1]}.pdf`;
  } catch { return false; }
}
export function doiValue(value: string): string {
  let s = value.trim();
  try { s = decodeURIComponent(s); } catch { /* keep undecodable source */ }
  s = s.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '');
  return /^10\.\d{4,9}\/\S+$/i.test(s) ? s.toLowerCase() : '';
}
export function doiFromUrl(value: string): string {
  try {
    const annual = annualReviewsPdfTarget(value);
    if (annual) return annual.doi;
    const u = new URL(value);
    if (u.origin === 'https://www.annualreviews.org' && !u.username && !u.password && !u.search) {
      const article = u.pathname.match(/^\/content\/journals\/(10\.1146\/annurev-[a-z]+-\d{6}-\d{6})$/);
      if (article) return article[1];
    }
    if (/^(dx\.)?doi\.org$/.test(u.hostname)) return doiValue(u.pathname.slice(1));
    // Only explicit publisher DOI routes, never an arbitrary DOI substring or a DOI embedded in an attachment filename.
    const path = decodeURIComponent(u.pathname);
    const m = path.match(/\/doi\/(?:pdf|epdf|full|abs|pdfdirect)?\/?(10\.\d{4,9}\/[^?#]+)$/i);
    return m ? doiValue(m[1]) : '';
  } catch { return ''; }
}
