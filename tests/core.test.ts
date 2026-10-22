import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { webcrypto } from 'node:crypto';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { filename, clean, validateTemplate } from '../src/core/naming';
import { abbreviation, journalInitials } from '../src/core/journals';
import { extract, readableTitle } from '../src/core/extract';
import { mergeCrossref } from '../src/core/crossref';
import { matchDownload, isPdf, readyMetadata } from '../src/core/match';
import { decide, bounded } from '../src/core/decision';
import { doiFromUrl } from '../src/core/urls';
import { DEFAULT_SETTINGS, TTL, type DownloadLike, type Snapshot } from '../src/types';
Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
function fixture(name: string, origin = 'https://publisher.example'): Snapshot {
  const html = readFileSync(resolve('tests', 'fixtures', `${name}.html`), 'utf8');
  return extract(new DOMParser().parseFromString(html, 'text/html'), origin + '/article/' + name)!;
}
function item(snapshot: Snapshot, index = 0): DownloadLike {
  return { id: 42, url: snapshot.links[index].url, finalUrl: snapshot.links[index].url, referrer: snapshot.pageUrl, filename: 'C:\\Downloads\\paper.pdf', mime: 'application/pdf' };
}
afterEach(() => vi.useRealTimers());
describe('skill-compatible naming', () => {
  it('supports reordered and omitted fields, literal text and safe separators', async () => {
    const m = { journal: 'Nature', year: '2026', author: 'de Roode', title: 'A long-term study' };
    expect(await filename(m, '', '{author}_{year}_{title}')).toBe('de Roode_2026_A long-term study.pdf');
    expect(await filename(m, '', '{title} [{journal}]')).toBe('A long-term study [Nature].pdf');
    expect(await filename(m, '', '{year}/{title}')).toBe('2026／A long-term study.pdf');
  });
  it('rejects malformed, unknown, repeated and extension-bearing formats', () => {
    for (const value of ['', '{doi} - {title}', '{title', '{{title}}', '{author}', '{title} {title}', '{author}{author}{title}', '{title}.pdf', '{title}\n']) expect(() => validateTemplate(value)).toThrow();
  });
  it('keeps attachment identifiers and only truncates the title wherever it appears', async () => {
    const m = { journal: 'Nature', year: '2026', author: 'García-López', title: '长标题'.repeat(200), kind: 'SI' as const, label: 'S1' };
    const result = await filename(m, 'C:\\Downloads', '{title} — {author} ({year})');
    expect(result).toMatch(/^长标题.*~[a-f0-9]{10} — García-López \(2026\) - SI - S1\.pdf$/);
    expect(Array.from(result).length).toBeLessThanOrEqual(215);
  });
  it('rejects reserved Windows filenames in title-only format', async () => {
    await expect(filename({ journal: 'Nature', year: '2026', author: 'Xu', title: 'CON' }, '', '{title}')).rejects.toThrow('保留名称');
  });
  it('uses configured formats in automatic download decisions', async () => {
    const s = fixture('nature');
    const r = await decide(item(s), { ...DEFAULT_SETTINGS, namingTemplate: '{author}_{year}_{title}' }, [s]);
    expect(r?.proposed).toMatch(/^Zhu_2026_Atmospheric/);
  });
  it('matches the supplied PNAS example verbatim', async () => {
    const m = fixture('pnas').metadata;
    expect(await filename(m)).toBe('Proc Natl Acad Sci USA - 2018 - Schiro - GoAmazon2014-5 campaign points to deep-inflow approach to deep convection across scales.pdf');
  });
  it('preserves family prefixes, accents, Chinese and title hyphens', async () => {
    expect(await filename({ journal: 'Nature', year: '2026', author: 'de Roode', title: '云–气溶胶与 long-term café' })).toContain('de Roode - 云–气溶胶与 long-term café.pdf');
    expect(clean('  Garci\u0301a-López \t ')).toBe('García-López');
  });
  it('replaces all Windows forbidden characters with fullwidth equivalents', () => {
    expect(clean('<>:"/\\|?*')).toBe('＜＞：＂／＼｜？＊');
    expect(clean(' A\n B\u0000C. ')).toBe('A B C');
  });
  it('only shortens title and reserves room for the collision suffix', async () => {
    const data = { journal: 'Nature', year: '2026', author: 'Zhu', title: 'long-title '.repeat(80), kind: 'SI' as const, label: 'MOESM1' };
    const name = await filename(data, 'C:\\Downloads');
    expect(name).toMatch(/^Nature - 2026 - Zhu - long-title .*~[a-f0-9]{10} - SI - MOESM1\.pdf$/);
    expect(name.length).toBeLessThanOrEqual(215);
    expect(await filename(data, 'C:\\Downloads')).toBe(name);
  });
  it('rejects missing fields, bad years, uncertain attachments and impossible paths', async () => {
    const m = fixture('nature').metadata;
    await expect(filename({ ...m, author: '' })).rejects.toThrow('均需填写');
    await expect(filename({ ...m, year: '26' })).rejects.toThrow('四位');
    await expect(filename({ ...m, kind: 'Unknown' })).rejects.toThrow('类型');
    await expect(filename({ ...m, kind: 'SI' })).rejects.toThrow('附件标识');
    await expect(filename(m, 'C:\\' + 'folder'.repeat(40))).rejects.toThrow('目录');
  });
  it('formats SI and PeerReview suffixes', async () => {
    const m = fixture('nature').metadata;
    expect(await filename({ ...m, kind: 'SI', label: 'MOESM1' })).toMatch(/ - SI - MOESM1\.pdf$/);
    expect(await filename({ ...m, kind: 'PeerReview', label: 'review1' })).toMatch(/ - PeerReview - review1\.pdf$/);
  });
});
describe('metadata extraction and journal verification', () => {
  it.each(['agu', 'ams', 'copernicus', 'nature', 'pnas'])('%s extracts article and SI without treating data as PDF', name => {
    const s = fixture(name);
    expect(s.metadata.journal).not.toBe(''); expect(s.metadata.author).not.toBe('');
    expect(s.links.some(l => l.kind === 'Article')).toBe(true);
    expect(s.links.some(l => l.kind === 'SI' && l.label)).toBe(true);
    expect(s.links.some(l => l.url.endsWith('.csv'))).toBe(false);
  });
  it('recognizes peer review files independently of SI', () => {
    for (const name of ['nature', 'copernicus']) expect(fixture(name).links.some(l => l.kind === 'PeerReview')).toBe(true);
  });
  it('converts chemical subscripts without losing characters', () => expect(fixture('nature').metadata.title).toContain('CH4 plateau sustained by NOx'));
  it('flags unknown formula images and preserves readable alt text', () => {
    expect(readableTitle('Cloud <img src="x">', document).unsafe).toBe(true);
    expect(readableTitle('CH<sub>4</sub> &amp; <math alttext="NOx"></math>', document)).toEqual({ text: 'CH4 & NOx', unsafe: false });
  });
  it('does not infer a family name from the last word of a full name', () => {
    const doc = new DOMParser().parseFromString('<meta name="citation_title" content="Clouds"><meta name="citation_journal_title" content="Nature"><meta name="citation_author" content="Stephan de Roode">', 'text/html');
    expect(extract(doc, 'https://example.org/article')?.metadata.author).toBe('');
  });
  it('uses citation field precedence independent of DOM order and rejects different DOIs', () => {
    const doc = new DOMParser().parseFromString('<meta name="dc.title" content="Site title"><meta name="dc.identifier" content="https://publisher.example"><meta name="dc.identifier.doi" content="10.1000/right"><meta name="citation_title" content="Paper title"><meta name="citation_journal_title" content="Nature"><meta name="citation_date" content="2025"><meta name="citation_publication_date" content="2026"><meta name="citation_issue" content="1">', 'text/html');
    const s = extract(doc, 'https://publisher.example/paper')!;
    expect(s.metadata.title).toBe('Paper title'); expect(s.metadata.doi).toBe('10.1000/right'); expect(s.metadata.year).toBe('2026');
    const other = doc.createElement('meta'); other.name = 'citation_doi'; other.content = '10.1000/wrong'; doc.head.append(other);
    expect(extract(doc, 'https://publisher.example/paper')?.metadata.issues).toContain('页面包含多个不同的文献 DOI');
  });
  it('does not classify a generic PDF or blog as a paper', () => expect(extract(new DOMParser().parseFromString('<title>Report.pdf</title>', 'text/html'), 'https://example.org/report')).toBeUndefined());
  it('never conflates Nature subjournals or invents an abbreviation', () => {
    expect(abbreviation('Nature Communications')).toBe('');
    expect(abbreviation('Unknown Journal')).toBe('');
    expect(abbreviation('Nature Communications', [], {}, 'Nat. Commun.')).toBe('Nat Commun');
    expect(abbreviation('Unknown', ['1942-2466'])).toBe('J Adv Model Earth Syst');
    expect(abbreviation('Example Journal', [], { 'Example Journal': 'Ex. J.' })).toBe('Ex J');
  });
});
describe('Crossref DOI-only reconciliation', () => {
  const response = () => ({ DOI: '10.1038/test-nature', type: 'journal-article', title: ['Atmospheric CH<sub>4</sub> plateau sustained by NO<sub>x</sub> emission rise'], author: [{ family: 'Zhu' }], 'container-title': ['Nature'], volume: '650', 'published-print': { 'date-parts': [[2026, 1]] } });
  it('fills a missing family name from structured author data', () => {
    const m = fixture('nature').metadata; m.author = '';
    expect(mergeCrossref(m, response(), {}).author).toBe('Zhu');
  });
  it('flags DOI, title, journal and family name conflicts', () => {
    const m = fixture('nature').metadata;
    expect(mergeCrossref(m, { ...response(), DOI: '10.1000/wrong' }, {}).issues).toContain('Crossref DOI 与文章不一致');
    expect(mergeCrossref(m, { ...response(), title: ['Other paper'] }, {}).issues).toContain('出版方与 Crossref 标题冲突');
    expect(mergeCrossref(m, { ...response(), 'container-title': ['Other Journal'] }, {}).issues).toContain('出版方与 Crossref 期刊冲突');
    expect(mergeCrossref(m, { ...response(), author: [{ family: 'Wrong' }] }, {}).issues).toContain('出版方与 Crossref 第一作者姓氏冲突');
  });
  it('prefers formal volume year over previous online publication', () => {
    const m = fixture('nature').metadata; m.year = '2025'; m.volume = ''; m.sources.year = '出版方在线发表日期';
    expect(mergeCrossref(m, response(), {}).year).toBe('2026');
  });
  it('does not use issued or download year when the formal year is unknown', () => {
    const m = fixture('nature').metadata; m.year = ''; const r: any = response(); delete r['published-print']; r.issued = { 'date-parts': [[2025]] };
    expect(mergeCrossref(m, r, {}).year).toBe('');
  });
  it('flags conflicting formal years rather than silently replacing', () => {
    const m = fixture('nature').metadata; m.year = '2025';
    expect(mergeCrossref(m, response(), {}).issues).toContain('出版方与 Crossref 卷期年份冲突');
  });
});
describe('download identity and fail-open decisions', () => {
  it.each([
    ['Example Journal of Climate', 'EJOC'],
    ['  Earth-System & Atmospheric Research  ', 'ESAR'],
    ['Études of the Atmosphere', 'ÉOTA'],
    ["Earth's Climate", 'EC'],
    ['Nature Communications', 'NC'],
    ['---', ''],
  ])('generates all word initials for %s', (full, expected) => {
    expect(journalInitials(full)).toBe(expected);
  });
  it('names unknown journals and labels the fallback without modifying cached metadata', async () => {
    const s = fixture('nature'); Object.assign(s.metadata, { journal: '', journalFull: 'Example Journal of Climate', issn: [] });
    delete s.metadata.sources.journal;
    const result = await decide(item(s), DEFAULT_SETTINGS, [s]);
    expect(result?.proposed).toMatch(/^EJOC - /);
    expect(result?.reason).toBe('');
    expect(result?.metadata?.sources.journal).toContain('自动生成');
    expect(s.metadata.journal).toBe(''); expect(s.metadata.sources.journal).toBeUndefined();
  });
  it('prefers verified and custom abbreviations, and keeps equal initials from masking journal conflicts', () => {
    const m = fixture('nature').metadata;
    expect(readyMetadata(m, {}).metadata.journal).toBe('Nature');
    Object.assign(m, { journal: '', journalFull: 'Example Journal', issn: [] });
    expect(readyMetadata(m, { 'Example Journal': 'Ex J' }).metadata.journal).toBe('Ex J');
    m.journal = 'Ex Journal'; expect(readyMetadata(m, {}).metadata.journal).toBe('Ex Journal');
    m.journal = '';
    expect(mergeCrossref(m, { DOI: m.doi, 'container-title': ['Earth Journal'] }, {}).issues).toContain('出版方与 Crossref 期刊冲突');
  });
  it('still requires a journal name, surname and conflict-free metadata', async () => {
    const s = fixture('nature'); Object.assign(s.metadata, { journal: '', journalFull: '', issn: [] });
    expect((await decide(item(s), DEFAULT_SETTINGS, [s]))?.reason).toContain('缺少期刊名称');
    s.metadata.journalFull = 'Example Journal'; s.metadata.author = '';
    expect((await decide(item(s), DEFAULT_SETTINGS, [s]))?.reason).toContain('第一作者姓氏');
    s.metadata.author = 'Zhu'; s.metadata.issues = ['标题冲突'];
    expect((await decide(item(s), DEFAULT_SETTINGS, [s]))?.proposed).toBeUndefined();
  });
  it('matches each concurrent download to its own paper', async () => {
    const a = fixture('agu'), b = fixture('nature');
    const [ra, rb] = await Promise.all([decide(item(a), DEFAULT_SETTINGS, [a, b]), decide(item(b), DEFAULT_SETTINGS, [a, b])]);
    expect(ra?.proposed).toContain('de Roode'); expect(rb?.proposed).toContain('Zhu');
  });
  it('matches a redirect using the original URL without requiring a referrer', () => {
    const s = fixture('pnas'); const d = item(s); d.finalUrl = 'https://cdn.example.org/signed-token'; d.referrer = '';
    expect(matchDownload(d, [s]).match?.metadata.author).toBe('Schiro');
  });
  it('matches PDF viewer download against the stored exact PDF URL', () => {
    const s = fixture('nature'), d = item(s); d.referrer = s.links[0].url;
    expect(matchDownload(d, [s]).match?.kind).toBe('Article');
  });
  it('falls back for an unknown direct PDF and unrelated PDF with only page referrer', async () => {
    const s = fixture('nature'), d = item(s); d.url = d.finalUrl = 'https://cdn.example.org/unknown.pdf';
    expect((await decide(d, DEFAULT_SETTINGS, [s]))?.proposed).toBeUndefined();
    d.referrer = ''; expect(matchDownload(d, [s]).match).toBeUndefined();
  });
  it('rejects conflicting multi-tab link and referrer evidence', () => {
    const s = fixture('pnas'), other = fixture('nature'), d = item(s); d.referrer = other.pageUrl;
    expect(matchDownload(d, [s, other]).reason).toContain('多篇文献');
  });
  it('never takes a DOI substring from an attachment as the parent PDF', () => {
    expect(doiFromUrl('https://publisher.example/doi/suppl/10.1000/test/file.pdf')).toBe('');
    expect(doiFromUrl('https://publisher.example/doi/pdf/10.1000/test')).toBe('10.1000/test');
  });
  it('falls back on missing author, metadata conflict, and expired cache', async () => {
    const s = fixture('nature'), d = item(s); s.metadata.author = '';
    expect((await decide(d, DEFAULT_SETTINGS, [s]))?.reason).toContain('第一作者姓氏');
    s.metadata.issues = ['标题冲突']; expect((await decide(d, DEFAULT_SETTINGS, [s]))?.reason).toContain('标题冲突');
    s.capturedAt = Date.now() - TTL - 1; expect(matchDownload(d, [s]).match).toBeUndefined();
  });
  it('leaves non-PDF downloads and disabled mode alone', async () => {
    const s = fixture('nature'), d = item(s);
    expect(isPdf({ ...d, mime: 'text/html' })).toBe(false);
    expect(await decide({ ...d, filename: 'data.csv', mime: 'text/csv' }, DEFAULT_SETTINGS, [s])).toBeUndefined();
    expect(await decide(d, { ...DEFAULT_SETTINGS, enabled: false }, [s])).toBeUndefined();
  });
  it('returns within 1.9 seconds and ignores late completion', async () => {
    vi.useFakeTimers(); let resolve: (value: string) => void = () => {};
    const pending = new Promise<string>(r => resolve = r);
    const result = bounded(pending, () => 'original');
    await vi.advanceTimersByTimeAsync(1900); expect(await result).toBe('original');
    resolve('late name'); expect(await result).toBe('original');
  });
});
