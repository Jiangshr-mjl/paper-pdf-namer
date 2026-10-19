import { basename, filename, parentPath } from './core/naming';
import { el, button, heading, request, toast } from './ui';
import type { State } from './store';
import type { Kind, RecordItem } from './types';

const app = document.getElementById('app')!;
let activeTab = 'recent';
function editor(record: RecordItem) {
  const box = el('form', '', 'editor');
  box.addEventListener('submit', event => event.preventDefault());
  const initial = record.draft || { journal: record.metadata?.journal || '', year: record.metadata?.year || '', author: record.metadata?.author || '', title: record.metadata?.title || '', kind: record.kind, label: record.label };
  const inputs: Record<string, HTMLInputElement | HTMLTextAreaElement> = {};
  for (const [key, label] of [['journal', '期刊缩写'], ['year', '引用年份'], ['author', '第一作者姓氏'], ['title', '原文标题'], ['label', '原附件标识']] as const) {
    const field = el('label', label);
    const input = key === 'title' ? el('textarea') : el('input');
    input.value = initial[key]; input.name = key; input.maxLength = key === 'title' ? 4000 : 300;
    if (key !== 'label') input.required = true;
    if (key === 'year') input.inputMode = 'numeric';
    field.append(input); inputs[key] = input; box.append(field);
  }
  const kindLabel = el('label', '文件类型'); const kind = el('select'); kind.name = 'kind';
  for (const [value, label] of [['Unknown', '请选择文件类型'], ['Article', '论文正文'], ['SI', '补充材料'], ['PeerReview', '审稿文件']]) {
    const option = el('option', label); option.value = value; kind.append(option);
  }
  kind.value = initial.kind; kindLabel.append(kind); box.append(kindLabel);
  const confirmation = el('label', '', 'check'); const confirmed = el('input'); confirmed.type = 'checkbox';
  confirmation.append(confirmed, document.createTextNode('我已核实以上字段，年份和姓氏无误')); box.append(confirmation);
  const preview = el('output', '', 'preview'); box.append(preview);
  const draft = () => ({ journal: inputs.journal.value, year: inputs.year.value, author: inputs.author.value, title: inputs.title.value, kind: kind.value as Kind, label: inputs.label.value });
  let version = 0;
  const update = async () => {
    const seq = ++version;
    inputs.label.disabled = kind.value === 'Article';
    try { const name = await filename(draft(), parentPath(record.actual || record.original)); if (seq === version) preview.textContent = name; }
    catch (error) { if (seq === version) preview.textContent = (error as Error).message; }
  };
  box.addEventListener('input', () => void update()); void update();
  box.append(button('复制规范名称', async () => {
    if (!confirmed.checked) { toast('请先核实并勾选字段确认', true); return; }
    const values = draft(); const name = await filename(values, parentPath(record.actual || record.original));
    await navigator.clipboard.writeText(name);
    await request('SAVE_DRAFT', { id: record.id, draft: values });
    toast('已复制。请在文件管理器中手动重命名已下载文件。');
  }, 'primary'));
  box.append(el('p', '此处只生成名称，不会改动、删除或重复下载本地文件。', 'hint'));
  return box;
}
async function render() {
  const state = await request<State>('GET_STATE');
  app.replaceChildren(heading('Name-paper-cloud', '规范命名，自动完成'));
  const toolbar = el('div', '', 'toolbar');
  const toggle = el('label', '', 'check'); const input = el('input'); input.type = 'checkbox'; input.checked = state.settings.enabled;
  input.addEventListener('change', () => void request('SETTINGS', { settings: { enabled: input.checked } }).catch(e => toast(e.message, true)));
  input.className = 'switch';
  toggle.append(input, document.createTextNode('自动规范命名'));
  toolbar.append(toggle, button('设置与网站授权', () => chrome.runtime.openOptionsPage(), 'link')); app.append(toolbar);
  const permissions = await chrome.permissions.getAll();
  if (!(permissions.origins || []).some(x => !x.includes('api.crossref.org'))) {
    const notice = el('section', '', 'notice');
    notice.append(el('strong', '已安装，但尚未获得网站访问权限'), el('p', '未授权时无法读取文献信息，因此会保留原名。'),
      button('授权 ACP', async () => {
        const granted = await chrome.permissions.request({ origins: ['https://acp.copernicus.org/*'] });
        if (!granted) return;
        await request('SYNC'); await render(); toast('ACP 已授权，正在准备已打开的 PDF。请稍候再下载。');
      }, 'primary'), button('授权其他出版平台', () => chrome.runtime.openOptionsPage(), 'link'));
    app.append(notice);
  }
  const pending = state.records.filter(r => !r.proposed || r.nameMismatch || r.state === 'interrupted');
  const tabs = el('div', '', 'tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', '下载记录');
  for (const [key, label, count] of [['recent', '最近下载', state.records.length], ['pending', '待处理', pending.length]] as const) {
    const tab = button(`${label} ${count}`, () => { activeTab = key; return render(); }, activeTab === key ? 'tab active' : 'tab');
    tab.setAttribute('role', 'tab'); tab.setAttribute('aria-selected', String(activeTab === key)); tabs.append(tab);
  }
  tabs.append(button('刷新', render, 'link refresh')); app.append(tabs);
  const list = el('section', '', 'records'); app.append(list);
  const visible = activeTab === 'pending' ? pending : state.records;
  if (!visible.length) list.append(el('div', activeTab === 'pending' ? '暂无待处理记录。需要你补充或核对的信息会出现在这里。' : '尚无 PDF 下载记录。打开已授权的文章页并下载，即可在这里查看结果。', 'empty'));
  for (const record of visible) {
    const card = el('article', '', 'record');
    const status = record.state === 'interrupted' ? '下载失败' : record.proposed ? record.state === 'complete' ? record.nameMismatch ? '请核对名称' : '已规范命名' : '已建议名称 · 下载中' : '保留原名';
    const top = el('div', '', 'toolbar'); top.append(el('span', record.metadata?.journal || 'PDF 文档', 'journal'), el('span', status, `status ${record.proposed && !record.nameMismatch && record.state !== 'interrupted' ? 'success' : 'attention'}`)); card.append(top);
    card.append(el('h3', record.metadata?.title || basename(record.actual || record.original)));
    const kindNames = { Article: '正文 PDF', SI: '补充材料', PeerReview: '审稿文件', Unknown: '类型待确认' };
    card.append(el('p', [record.metadata?.author, record.metadata?.year, kindNames[record.kind]].filter(Boolean).join(' · '), 'meta'));
    card.append(el('time', new Date(record.createdAt).toLocaleString('zh-CN'), 'hint'));
    const saved = el('div', '', 'namebox'); saved.append(el('div', record.state === 'complete' ? '保存文件名' : '当前文件名', 'hint'), el('div', basename(record.actual || record.original), 'filename')); card.append(saved);
    if (record.reason) card.append(el('p', record.reason, 'reason'));
    if (record.downloadError) card.append(el('p', `下载失败：${record.downloadError}`, 'reason'));
    if (record.nameMismatch) card.append(el('p', '实际文件名与建议不同，可能被另存为操作或其他扩展修改；请核对实际名称', 'reason'));
    if (record.proposed && record.state !== 'complete') card.append(el('p', `建议名称：${record.proposed}`, 'hint'));
    if (record.proposed && record.state === 'complete' && !record.nameMismatch) card.append(button('复制名称', async () => { await navigator.clipboard.writeText(basename(record.actual || record.proposed!)); toast('已复制保存文件名'); }, 'link copy-name'));
    if (record.metadata) {
      const source = el('details'); source.append(el('summary', '查看元数据来源'));
      for (const [field, label] of [['journal', '期刊'], ['year', '年份'], ['author', '姓氏'], ['title', '标题']] as const) source.append(el('p', `${label}：${record.metadata.sources[field] || '未核实'}`, 'hint'));
      if (record.metadata.doi) source.append(el('p', `DOI：${record.metadata.doi}`, 'hint'));
      card.append(source);
    }
    const edit = el('details'); edit.append(el('summary', '补全 / 修改并复制名称'), editor(record)); card.append(edit);
    list.append(card);
  }
  app.append(el('footer', '仅处理下载名称 · 未验证 PDF 内容 · 重名由浏览器加编号'));
}
void render().catch(error => toast(error.message, true));
