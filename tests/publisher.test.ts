import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { copernicusTarget, parsePublisherPage } from '../src/core/publisher';
import { extract } from '../src/core/extract';
import { decide } from '../src/core/decision';
import { DEFAULT_SETTINGS } from '../src/types';
const html = readFileSync(resolve('tests/fixtures/acp-real-2026.html'), 'utf8');
const page = 'https://acp.copernicus.org/articles/26/14303/2026/';
const pdf = page + 'acp-26-14303-2026.pdf';
describe('real ACP regression', () => {
  it('uses explicit publisher family,given notation without Crossref', () => {
    const s = extract(new DOMParser().parseFromString(html, 'text/html'), page)!;
    expect(s.metadata.author).toBe('Xu'); expect(s.metadata.year).toBe('2026');
    expect(s.metadata.sources.author).toContain('姓, 名');
  });
  it('preserves family prefixes and does not infer space-separated names', () => {
    const doc = (text: string) => new DOMParser().parseFromString(html.replace('Xu, Hui', text), 'text/html');
    expect(extract(doc('de Roode, Stephan'), page)?.metadata.author).toBe('de Roode');
    expect(extract(doc('Hui Xu'), page)?.metadata.author).toBe('');
    expect(extract(doc('Xu, Jr.'), page)?.metadata.author).toBe('');
    expect(extract(doc('Xu, Hui'), 'https://example.org/')?.metadata.author).toBe('');
  });
  it('parses the same metadata inside a worker with no native DOM', async () => {
    const s = parsePublisherPage(html, pdf);
    expect(s.metadata.title).toContain('Cloud vertical structure'); expect(s.metadata.author).toBe('Xu');
    const r = await decide({ id: 1, url: pdf, finalUrl: pdf, referrer: '', filename: 'C:\\Downloads\\paper.pdf', mime: 'application/pdf' }, DEFAULT_SETTINGS, [s]);
    expect(r?.proposed).toMatch(/^Atmos Chem Phys - 2026 - Xu - Cloud vertical structure/);
    expect(r?.reason).toBe('');
  });
  it('does not turn a figure or unrelated URL into a paper', () => {
    expect(copernicusTarget(pdf.replace('.pdf', '-f02-high-res.pdf'))).toBeUndefined();
    expect(copernicusTarget(pdf.replace('acp.copernicus.org', 'attacker.example'))).toBeUndefined();
    expect(copernicusTarget(pdf.replace('/26/14303/', '/24/14303/'))).toBeUndefined();
    expect(copernicusTarget(pdf + '?version=other')).toBeUndefined();
    expect(copernicusTarget(pdf + '#page=2')?.page).toBe(page);
  });
  it('requires returned DOI and PDF link to agree', () => {
    expect(() => parsePublisherPage(html.replace('10.5194/acp-26-14303-2026', '10.5194/other'), pdf)).toThrow('相互核实');
  });
  it('keeps supplement classification on recovery', () => {
    const s = parsePublisherPage(html, pdf.replace('.pdf', '-supplement.pdf'));
    expect(s.links.find(l => l.url.endsWith('-supplement.pdf'))?.kind).toBe('SI');
  });
});
