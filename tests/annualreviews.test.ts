import { describe, it, expect } from 'vitest';
import { extract } from '../src/core/extract';
import { decide } from '../src/core/decision';
import { annualReviewsPdfTarget, doiFromUrl, urlKey } from '../src/core/urls';
import { DEFAULT_SETTINGS, type DownloadLike } from '../src/types';

// Synthetic HTML using publisher-verified bibliography; not a captured publisher page.
const doi = '10.1146/annurev-fluid-010816-060231';
const page = `https://www.annualreviews.org/content/journals/${doi}`;
const pdf = 'https://www.annualreviews.org/docserver/fulltext/fluid/49/1/annurev-fluid-010816-060231.pdf';
const old = pdf + '?expires=1&id=test&accname=guest&checksum=old';
const fresh = pdf + '?checksum=new&accname=guest&id=test&expires=2';
function snapshot(label = 'Download PDF') {
  return extract(new DOMParser().parseFromString(`<meta name="citation_title" content="Cloud-Top Entrainment in Stratocumulus Clouds"><meta name="citation_journal_title" content="Annual Review of Fluid Mechanics"><meta name="citation_doi" content="${doi}"><meta name="citation_author_lastname" content="Mellado"><meta name="citation_volume" content="49"><meta name="citation_publication_date" content="2017/01/03"><a href="${old}">${label}</a>`, 'text/html'), page)!;
}
const item = (url = fresh): DownloadLike => ({ id: 1, url, finalUrl: url, referrer: '', filename: 'paper.pdf', mime: 'application/pdf' });
describe('Annual Reviews signed body URLs', () => {
  it('reads an explicit publisher article DOI route when DOI meta is absent', () => {
    const s = extract(new DOMParser().parseFromString('<meta name="citation_title" content="Cloud-Top Entrainment in Stratocumulus Clouds">', 'text/html'), page);
    expect(s?.metadata.doi).toBe(doi);
  });
  it('normalizes only known access parameters and identifies the exact DOI', () => {
    expect(urlKey(old)).toBe(pdf); expect(urlKey(fresh)).toBe(pdf);
    expect(doiFromUrl(fresh)).toBe(doi); expect(doiFromUrl(page)).toBe(doi);
    expect(urlKey('https://other.example/a.pdf?expires=1')).toContain('?expires=1');
  });
  it('extracts a body link without persisting access tokens, and names a new signed URL', async () => {
    const s = snapshot(); expect(s.links[0]).toMatchObject({ kind: 'Article', url: pdf });
    const r = await decide(item(), DEFAULT_SETTINGS, [s]);
    expect(r?.proposed).toBe('AROFM - 2017 - Mellado - Cloud-Top Entrainment in Stratocumulus Clouds.pdf');
  });
  it.each(['url', 'finalUrl'] as const)('matches redirects through %s without a referrer or cached link', async field => {
    const s = snapshot(); s.links = [];
    const r = await decide({ ...item('https://cdn.example/file.pdf'), [field]: fresh }, DEFAULT_SETTINGS, [s]);
    expect(r?.proposed).toContain('Mellado');
  });
  it.each([
    pdf.replace('.pdf', '-supplement.pdf'), pdf.replace('.pdf', '-fig1.pdf'),
    pdf.replace('/fluid/49', '/astro/49'), pdf.replace('www.annualreviews.org', 'other.example'),
    pdf.replace('https:', 'http:'), pdf.replace('https://', 'https://user:pass@'),
    pdf + '?article=other', pdf + '?checksum=x&file=other',
  ])('rejects unrecognized or non-body routes: %s', url => {
    expect(annualReviewsPdfTarget(url)).toBeUndefined(); expect(doiFromUrl(url)).toBe('');
  });
  it('keeps different articles, explicit attachments, old Unknown and conflicts conservative', async () => {
    expect((await decide(item(fresh.replace('060231', '060221')), DEFAULT_SETTINGS, [snapshot()]))?.proposed).toBeUndefined();
    expect(snapshot('Supplement PDF').links[0].kind).toBe('SI');
    expect(snapshot('Peer review PDF').links[0].kind).toBe('PeerReview');
    const s = snapshot(); s.links[0].kind = 'Unknown';
    expect((await decide(item(), DEFAULT_SETTINGS, [s]))?.reason).toContain('未确认正文');
    const other = snapshot(); other.metadata.doi = '10.1146/other';
    expect((await decide(item(), DEFAULT_SETTINGS, [snapshot(), other]))?.proposed).toBeUndefined();
  });
});
