import { button, el, heading, request, toast } from './ui';
import { PRIORITY_ORIGINS, CROSSREF_ORIGIN } from './permissions';
import type { State } from './store';

const app = document.getElementById('app')!;
let activeSection = 'general';
async function render() {
  const state = await request<State>('GET_STATE');
  const permissions = await chrome.permissions.getAll();
  app.replaceChildren(heading('Name-paper-cloud', '一次授权，之后照常下载。你的文献和记录留在本机。'));
  const example = el('section', '', 'example'); example.append(el('span', '命名格式', 'eyebrow'), el('p', '期刊缩写 - 年份 - 第一作者姓氏 - 题目.pdf'), el('small', '例如：Nature - 2026 - Zhu - Atmospheric CH4 plateau.pdf')); app.append(example);
  const general = el('section', '', 'panel'); general.append(el('h2', '01　自动命名'));
  const toggle = el('label', '', 'check'); const enabled = el('input'); enabled.type = 'checkbox'; enabled.checked = state.settings.enabled;
  enabled.addEventListener('change', () => void request('SETTINGS', { settings: { enabled: enabled.checked } }).then(() => toast('设置已保存')).catch(e => toast(e.message, true)));
  toggle.append(enabled, document.createTextNode('自动处理可可靠识别的 PDF 下载')); general.append(toggle);
  general.append(el('p', '资料不完整、来源冲突或处理超时，均保留原名。通过弹窗补全后，可复制名称手动改名。', 'muted')); app.append(general);

  const sites = el('section', '', 'panel'); sites.append(el('h2', '02　授权出版平台'), el('p', '只读取已授权网页中的文献信息与下载链接。授权后请刷新已打开的文章页。', 'muted'));
  sites.append(button('授权重点平台与 DOI 补查', async () => {
    const granted = await chrome.permissions.request({ origins: [...PRIORITY_ORIGINS, CROSSREF_ORIGIN] });
    if (granted) { await request('SYNC'); toast('授权完成，请刷新文章页'); await render(); } else toast('未授权，仍可正常下载');
  }, 'primary'));
  sites.append(el('p', '重点平台：AGU / Wiley、AMS、Copernicus、Nature、PNAS。', 'hint'));
  const custom = el('div', '', 'inline'); const site = el('input'); site.type = 'url'; site.placeholder = '其他平台，例如 https://example.org'; site.setAttribute('aria-label', '其他网站地址');
  custom.append(site, button('授权此网站', async () => {
    const u = new URL(site.value);
    if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password) throw new Error('请输入 http 或 https 网站地址');
    const granted = await chrome.permissions.request({ origins: [u.origin + '/*'] });
    if (granted) { await request('SYNC'); await render(); toast('已授权此域名；通用识别不保证所有网站均可自动命名'); }
  })); sites.append(custom);
  const grants = el('div', '', 'grants');
  if (!permissions.origins?.length) grants.append(el('p', '尚未授权任何网站', 'hint'));
  for (const origin of permissions.origins || []) {
    const row = el('div', '', 'toolbar'); row.append(el('span', origin.replace('https://', '').replace('http://', '').replace('/*', '')),
      button('撤销', async () => { await chrome.permissions.remove({ origins: [origin] }); await render(); toast('授权已撤销；相关缓存已清除'); }, 'link'));
    grants.append(row);
  }
  sites.append(grants); app.append(sites);

  const crossref = el('section', '', 'panel'); crossref.append(el('h2', '03　补查缺失信息'));
  const cross = el('label', '', 'check'); const checkbox = el('input'); checkbox.type = 'checkbox'; checkbox.checked = state.settings.crossref;
  checkbox.addEventListener('change', async () => {
    try {
      if (checkbox.checked && !await chrome.permissions.request({ origins: [CROSSREF_ORIGIN] })) { checkbox.checked = false; return; }
      await request('SETTINGS', { settings: { crossref: checkbox.checked } }); toast('补查设置已保存，请刷新文章页');
    } catch (error) { toast((error as Error).message, true); }
  });
  cross.append(checkbox, document.createTextNode('允许通过 DOI 查询 Crossref')); crossref.append(cross);
  crossref.append(el('p', '仅向 Crossref 发送 DOI。不上传 PDF、文章全文、浏览记录或登录凭据；不使用大模型。', 'muted'));
  if (!(permissions.origins || []).includes(CROSSREF_ORIGIN)) crossref.append(el('p', 'Crossref 尚未授权，当前仅使用页面信息。', 'hint'));
  app.append(crossref);

  const journals = el('section', '', 'panel'); journals.append(el('h2', '04　已核实的期刊缩写'), el('p', '每行填写“期刊全名或 ISSN = 通行英文缩写”。仅填写你已核实的结果，缩写句点会自动移除。', 'muted'));
  const overrides = el('textarea'); overrides.rows = 6; overrides.setAttribute('aria-label', '期刊缩写映射'); overrides.placeholder = 'Nature Communications = Nat Commun';
  overrides.value = Object.entries(state.settings.abbreviations).map(([key, value]) => `${key} = ${value}`).join('\n'); journals.append(overrides);
  journals.append(button('保存缩写表', async () => {
    const mapping: Record<string, string> = {};
    for (const [i, line] of overrides.value.split('\n').entries()) {
      if (!line.trim()) continue;
      const index = line.indexOf('=');
      if (index <= 0 || !line.slice(index + 1).trim()) throw new Error(`第 ${i + 1} 行格式应为：期刊全名或 ISSN = 缩写`);
      const key = line.slice(0, index).trim(), value = line.slice(index + 1).trim().replace(/\./g, '');
      if (key.length > 300 || value.length > 150 || /[<>:"/\\|?*\x00-\x1f]/.test(value)) throw new Error(`第 ${i + 1} 行包含非法字符或过长内容`);
      mapping[key] = value;
    }
    await request('SETTINGS', { settings: { abbreviations: mapping } }); toast('缩写表已保存');
  })); app.append(journals);

  const privacy = el('section', '', 'panel'); privacy.append(el('h2', '05　本地记录与能力边界'));
  privacy.append(el('p', '元数据缓存保留 7 天，最近下载记录最多 100 条，不跨设备同步。清除记录不会影响下载文件或期刊缩写设置。', 'muted'));
  privacy.append(button('清除本地记录和缓存', async () => { await request('CLEAR'); toast('本地记录和缓存已清除'); }, 'secondary'));
  privacy.append(el('p', '纯浏览器插件无法验证已下载 PDF 的页数和首页，也无法按内容去重或改名已有文件。重复文件由浏览器加编号。另存为或其他下载扩展可能修改最终名称，以实际文件为准。', 'hint'));
  app.append(privacy, el('footer', `Name-paper-cloud · v${chrome.runtime.getManifest().version} · Chrome / Edge`));
  // Keep existing controls and handlers intact; navigation only changes visibility.
  enabled.className = 'switch'; checkbox.className = 'switch';
  const header = app.querySelector('header')!; const footer = app.querySelector('footer')!;
  general.querySelector('h2')!.textContent = '下载与命名';
  sites.querySelector('h2')!.textContent = '网站授权';
  crossref.querySelector('h2')!.textContent = '元数据补查';
  journals.querySelector('h2')!.textContent = '已核实的期刊缩写';
  privacy.querySelector('h2')!.textContent = '本地记录';
  example.querySelector('p')!.textContent = '期刊缩写  −  年份  −  作者姓氏  −  题目.pdf';
  example.querySelector('small')!.textContent = '信息不足时保留原名，并在弹窗中提示。';
  const shell = el('div', '', 'settings-shell'); const nav = el('nav', '', 'sidebar'); nav.setAttribute('aria-label', '设置分类');
  const brand = el('div', 'Name-paper-cloud', 'sidebrand'); const icon = el('img'); icon.src = chrome.runtime.getURL('icons/icon-32.png'); icon.alt = ''; icon.width = 22; icon.height = 22; brand.prepend(icon); nav.append(brand);
  const content = el('div', '', 'settings-content');
  const groups = { general: [general, example, crossref], sites: [sites], journals: [journals], privacy: [privacy] };
  const select = (key: keyof typeof groups) => {
    activeSection = key;
    for (const [id, panels] of Object.entries(groups)) for (const panel of panels) panel.hidden = id !== key;
    for (const b of nav.querySelectorAll('button')) { b.classList.toggle('active', b.dataset.section === key); if (b.dataset.section === key) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); }
  };
  for (const [key, label] of [['general', '常规设置'], ['sites', '网站授权'], ['journals', '期刊缩写'], ['privacy', '本地记录']] as const) {
    const b = button(label, () => select(key), 'nav'); b.dataset.section = key; nav.append(b);
  }
  content.append(header, general, example, crossref, sites, journals, privacy, footer); shell.append(nav, content); app.replaceChildren(shell);
  select(activeSection as keyof typeof groups);
}
void render().catch(error => toast(error.message, true));
