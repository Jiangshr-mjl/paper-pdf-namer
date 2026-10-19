import './theme.css';
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = ''): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag); n.textContent = text; n.className = className; return n;
}
export async function request<T = any>(type: string, fields: Record<string, unknown> = {}): Promise<T> {
  const result = await chrome.runtime.sendMessage({ type, ...fields });
  if (result?.error) throw new Error(result.error);
  return result;
}
export function button(text: string, action: () => unknown | Promise<unknown>, className = ''): HTMLButtonElement {
  const b = el('button', text, className);
  b.type = 'button';
  b.addEventListener('click', () => {
    try { Promise.resolve(action()).catch(error => toast((error as Error).message, true)); }
    catch (error) { toast((error as Error).message, true); }
  });
  return b;
}
export function toast(text: string, error = false) {
  let box = document.getElementById('toast');
  if (!box) { box = el('div'); box.id = 'toast'; box.setAttribute('role', 'status'); document.body.append(box); }
  box.className = error ? 'toast error' : 'toast'; box.textContent = text;
}
export function heading(label: string, subtitle: string) {
  const h = el('header'); const brand = el('div', 'PAPER / PDF', 'eyebrow');
  const title = el('h1', label); const icon = el('img'); icon.src = chrome.runtime.getURL('icons/icon-48.png'); icon.alt = ''; icon.width = 32; icon.height = 32; icon.className = 'brand-icon'; title.prepend(icon);
  h.append(brand, title, el('p', subtitle, 'muted')); return h;
}
