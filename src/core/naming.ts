import type { Kind } from '../types';
import { DEFAULT_TEMPLATE } from '../types';
export function validateTemplate(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > 300) throw new Error('命名格式须为 1–300 个字符');
  const tokens = [...value.matchAll(/\{([^{}]*)\}/g)].map(m => m[1]);
  if (/[{}]/.test(value.replace(/\{[^{}]*\}/g, '')) || tokens.some(t => !['journal', 'year', 'author', 'title'].includes(t))) throw new Error('仅支持 {journal}、{year}、{author}、{title}，请检查花括号');
  if (tokens.filter(t => t === 'title').length !== 1) throw new Error('命名格式必须包含且仅包含一个 {title}');
  if (new Set(tokens).size !== tokens.length) throw new Error('每个字段最多使用一次');
  if (/\.pdf\s*$/i.test(value)) throw new Error('无需填写 .pdf，扩展名会自动添加');
  if (/[\x00-\x1f]/.test(value)) throw new Error('命名格式不能包含换行或控制字符');
}
export function clean(value: string): string {
  const bad = '<>:"/\\|?*', good = '＜＞：＂／＼｜？＊';
  return value.normalize('NFC').replace(/[<>:"/\\|?*]/g, c => good[bad.indexOf(c)])
    .replace(/[\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').replace(/^[ .]+|[ .]+$/g, '');
}
const length = (s: string) => Array.from(s).length;
export function parentPath(path: string): string { const index = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/')); return index < 0 ? '' : path.slice(0, index); }
export function basename(path: string): string { return path.split(/[\\/]/).pop() || path; }
export async function filename(input: { journal: string; year: string; author: string; title: string; kind?: Kind; label?: string }, directory = '', template = DEFAULT_TEMPLATE): Promise<string> {
  validateTemplate(template);
  const fields = [input.journal, input.year, input.author, input.title].map(clean);
  if (fields.some(x => !x)) throw new Error('期刊缩写、年份、第一作者姓氏和标题均需填写');
  if (!/^\d{4}$/.test(fields[1])) throw new Error('年份须为四位数字');
  if (input.kind === 'Unknown') throw new Error('正文或附件类型尚未确认');
  const attachment = input.kind === 'SI' || input.kind === 'PeerReview';
  if (attachment && !clean(input.label || '')) throw new Error('附件须填写原附件标识');
  const values: Record<string, string> = { journal: fields[0], year: fields[1], author: fields[2] };
  const render = (title: string) => clean(template.replace(/\{(journal|year|author|title)\}/g, (_, key: string) => key === 'title' ? title : values[key]));
  const suffix = attachment ? ` - ${input.kind} - ${clean(input.label!)}` : '';
  // Same budget and raw-title hash as the supplied rename_pdf.py. Reserve 5 characters for a browser collision suffix.
  const budget = Math.min(220, 240 - length(directory) - 1) - (length(render('X')) - 1) - length(suffix) - 4 - 5;
  if (budget < 24) throw new Error('目录或前缀过长，请选用更短的下载目录');
  let title = fields[3];
  if (length(title) > budget) {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input.title));
    const hash = Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('').slice(0, 10);
    title = Array.from(title).slice(0, budget - 11).join('').trimEnd() + '~' + hash;
  }
  const stem = render(title) + suffix;
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(stem)) throw new Error('生成的名称是系统保留名称，请添加年份或作者字段');
  return stem + '.pdf';
}
