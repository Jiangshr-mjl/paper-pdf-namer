import { parseHTML } from 'linkedom';
import { extract } from './extract';
import { urlKey } from './urls';
import type { Snapshot } from '../types';

export function copernicusTarget(value: string): { page: string; doi: string; pdf: string } | undefined {
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' || u.hostname !== 'acp.copernicus.org' || u.search || u.username || u.password) return;
    const m = u.pathname.match(/^\/articles\/(\d+)\/(\d+)\/(\d{4})\/acp-\1-\2-\3(?:-supplement)?\.pdf$/);
    if (!m) return;
    return { page: `${u.origin}/articles/${m[1]}/${m[2]}/${m[3]}/`, doi: `10.5194/acp-${m[1]}-${m[2]}-${m[3]}`, pdf: urlKey(value) };
  } catch { return; }
}

export function parsePublisherPage(html: string, pdfUrl: string): Snapshot {
  const target = copernicusTarget(pdfUrl);
  if (!target) throw new Error('不支持的 PDF 来源');
  // A bundled inert parser: no page scripts execute and no referenced resources are loaded.
  const document = parseHTML(html).document;
  const snapshot = extract(document as unknown as Document, target.page);
  if (!snapshot || snapshot.metadata.doi !== target.doi || !snapshot.links.some(l => urlKey(l.url) === target.pdf && l.kind !== 'Unknown')) {
    throw new Error('出版方元数据与 PDF 地址未能相互核实');
  }
  return snapshot;
}
