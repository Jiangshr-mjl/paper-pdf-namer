import { describe, it, expect } from 'vitest';
import { isAmsArticlePdf } from '../src/core/urls';
import { extract } from '../src/core/extract';
import { decide } from '../src/core/decision';
import { DEFAULT_SETTINGS, type DownloadLike } from '../src/types';

// Synthetic metadata using verified bibliographic values, not a captured AMS HTML page.
const stem = 'apme/42/9/1520-0450_2003_042_1273_pacoau_2.0.co_2';
const page = `https://journals.ametsoc.org/view/journals/${stem}.xml`;
const pdf = page.replace(/\.xml$/, '.pdf');
const download = `https://journals.ametsoc.org/downloadpdf/journals/${stem}.xml`;
// Actual download route supplied by the user; bibliography below remains synthetic HTML.
const actualDownload = `https://journals.ametsoc.org/downloadpdf/view/journals/${stem}.pdf`;
function snapshot(href = pdf, label = 'Full Text PDF') {
  return extract(new DOMParser().parseFromString(`<meta name="citation_journal_title" content="Journal of Applied Meteorology"><meta name="citation_journal_abbrev" content="J. Appl. Meteor."><meta name="citation_title" content="Patterns and Causes of Atlanta's Urban Heat Island–Initiated Precipitation"><meta name="citation_author_lastname" content="Dixon"><meta name="citation_volume" content="42"><meta name="citation_publication_date" content="2003/09/01"><a href="${href}">${label}</a>`, 'text/html'), page)!;
}
const item = (url = pdf): DownloadLike => ({ id: 1, url, finalUrl: url, referrer: page, filename: 'paper.pdf', mime: 'application/pdf' });
describe('AMS exact article routes', () => {
  it.each([pdf, download, actualDownload])('classifies the exact body route %s without citation_pdf_url', async url => {
    const s = snapshot(url);
    expect(s.links[0].kind).toBe('Article');
    const result = await decide(item(url), DEFAULT_SETTINGS, [s]);
    expect(result?.proposed).toMatch(/^J Appl Meteor - 2003 - Dixon - Patterns and Causes/);
    expect(result?.reason).toBe('');
  });
  it.each(['url', 'finalUrl'] as const)('matches the actual download route in %s without links or referrer', async field => {
    const s = snapshot(); s.links = [];
    const result = await decide({ ...item('https://cdn.example.org/file.pdf'), referrer: '', [field]: actualDownload }, DEFAULT_SETTINGS, [s]);
    expect(result?.proposed).toMatch(/^J Appl Meteor - 2003 - Dixon - Patterns and Causes/);
  });
  it.each([
    actualDownload.replace('1273_pacoau', '9999_other'),
    actualDownload.replace('.pdf', '-supplement.pdf'),
    actualDownload.replace('.pdf', '-fig1.pdf'),
    actualDownload.replace('journals.ametsoc.org', 'other.example'),
    actualDownload + '?article=other',
    actualDownload.replace('https:', 'http:'),
  ])('rejects a non-body variant of the actual route %s', url => {
    expect(isAmsArticlePdf(url, page)).toBe(false);
  });
  it('preserves attachment hints and stale Unknown classification for the actual route', async () => {
    expect(snapshot(actualDownload, 'Supplement PDF').links[0].kind).toBe('SI');
    expect(snapshot(actualDownload, 'Peer review PDF').links[0].kind).toBe('PeerReview');
    const s = snapshot(actualDownload); s.links[0].kind = 'Unknown';
    expect((await decide(item(actualDownload), DEFAULT_SETTINGS, [s]))?.reason).toContain('未确认正文或附件类型');
  });
  it('matches a PDF viewer or redirect when the article snapshot has no PDF link', async () => {
    const s = snapshot(); s.links = [];
    const result = await decide({ ...item(), finalUrl: 'https://cdn.example.org/file.pdf', referrer: '' }, DEFAULT_SETTINGS, [s]);
    expect(result?.proposed).toContain('Dixon');
  });
  it.each([pdf.replace('1273_pacoau', '9999_other'), pdf.replace('.pdf', '-supplement.pdf'), pdf.replace('.pdf', '-fig1.pdf'), pdf.replace('journals.ametsoc.org', 'other.example'), pdf + '?article=other', pdf.replace('https:', 'http:'), page])('does not infer a body from %s', url => {
    expect(isAmsArticlePdf(url, page)).toBe(false);
  });
  it('preserves explicit supplementary and review classifications', () => {
    expect(snapshot(pdf, 'Supplement PDF').links[0].kind).toBe('SI');
    expect(snapshot(pdf, 'Peer review PDF').links[0].kind).toBe('PeerReview');
  });
  it('keeps cached Unknown links conservative until refresh', async () => {
    const s = snapshot(); s.links[0].kind = 'Unknown';
    expect((await decide(item(), DEFAULT_SETTINGS, [s]))?.reason).toContain('未确认正文或附件类型');
  });
  it('keeps conflicting article sources and missing fields fail-open', async () => {
    const s = snapshot(), other = snapshot(); other.metadata.title = 'Different article';
    expect((await decide(item(), DEFAULT_SETTINGS, [s, other]))?.proposed).toBeUndefined();
    s.metadata.author = '';
    expect((await decide(item(), DEFAULT_SETTINGS, [s]))?.reason).toContain('第一作者姓氏');
  });
});
