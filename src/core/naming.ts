import type { Kind } from '../types';
export function clean(value: string): string {
  const bad = '<>:"/\\|?*', good = '＜＞：＂／＼｜？＊';
  return value.normalize('NFC').replace(/[<>:"/\\|?*]/g, c => good[bad.indexOf(c)])
    .replace(/[\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').replace(/^[ .]+|[ .]+$/g, '');
}
const length = (s: string) => Array.from(s).length;
export function parentPath(path: string): string { const index = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/')); return index < 0 ? '' : path.slice(0, index); }
export function basename(path: string): string { return path.split(/[\\/]/).pop() || path; }
export async function filename(input: { journal: string; year: string; author: string; title: string; kind?: Kind; label?: string }, directory = ''): Promise<string> {
  const fields = [input.journal, input.year, input.author, input.title].map(clean);
  if (fields.some(x => !x)) throw new Error('期刊缩写、年份、第一作者姓氏和标题均需填写');
  if (!/^\d{4}$/.test(fields[1])) throw new Error('年份须为四位数字');
  if (input.kind === 'Unknown') throw new Error('正文或附件类型尚未确认');
  const attachment = input.kind === 'SI' || input.kind === 'PeerReview';
  if (attachment && !clean(input.label || '')) throw new Error('附件须填写原附件标识');
  const prefix = fields.slice(0, 3).join(' - ') + ' - ';
  const suffix = attachment ? ` - ${input.kind} - ${clean(input.label!)}` : '';
  // Same budget and raw-title hash as the supplied rename_pdf.py. Reserve 5 characters for a browser collision suffix.
  const budget = Math.min(220, 240 - length(directory) - 1) - length(prefix) - length(suffix) - 4 - 5;
  if (budget < 24) throw new Error('目录或前缀过长，请选用更短的下载目录');
  let title = fields[3];
  if (length(title) > budget) {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input.title));
    const hash = Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('').slice(0, 10);
    title = Array.from(title).slice(0, budget - 11).join('').trimEnd() + '~' + hash;
  }
  return prefix + title + suffix + '.pdf';
}
