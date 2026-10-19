import { chromium } from 'playwright';
import { mkdir, cp, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
const pdf = 'https://acp.copernicus.org/articles/26/14303/2026/acp-26-14303-2026.pdf';
const root = resolve('test-results', `real-acp-${Date.now()}`);
const extension = join(root, 'extension');
const downloads = resolve('downloads');
await mkdir(downloads, { recursive: true });
await mkdir(join(root, 'profile', 'Default'), { recursive: true });
await writeFile(join(root, 'profile', 'Default', 'Preferences'), JSON.stringify({ download: { default_directory: downloads, prompt_for_download: false }, plugins: { always_open_pdf_externally: false } }));
await cp(resolve('dist'), extension, { recursive: true });
const manifest = JSON.parse(await readFile(join(extension, 'manifest.json'), 'utf8'));
manifest.host_permissions = ['https://acp.copernicus.org/*'];
await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest));
const context = await chromium.launchPersistentContext(join(root, 'profile'), {
  executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true,
  ignoreDefaultArgs: ['--disable-extensions'], args: ['--enable-unsafe-extension-debugging'], acceptDownloads: true
});
try {
  const cdp = await context.browser().newBrowserCDPSession();
  const { id } = await cdp.send('Extensions.loadUnpacked', { path: extension });
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'default', eventsEnabled: true });
  const ui = await context.newPage();
  await ui.goto(`chrome-extension://${id}/popup.html`);
  await ui.evaluate(() => chrome.runtime.sendMessage({ type: 'SETTINGS', settings: { crossref: false } }));
  const page = await context.newPage();
  await page.goto(pdf, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(error => { if (!error.message.includes('ERR_ABORTED')) throw error; });
  let state;
  for (let i = 0; i < 100; i++) {
    state = await ui.evaluate(() => chrome.runtime.sendMessage({ type: 'GET_STATE' }));
    if (state.snapshots.some(s => s.metadata.author === 'Xu')) break;
    await new Promise(r => setTimeout(r, 200));
  }
  await writeFile(join(root, 'state.json'), JSON.stringify(state, null, 2));
  assert.ok(state.snapshots.some(s => s.metadata.author === 'Xu'), 'Direct PDF should resolve publisher metadata without an article-page visit or Crossref');
  console.log('PASS direct PDF metadata recovery from the real publisher');
  // Stop the viewer's redundant network transfer before the actual download below.
  await page.evaluate(() => window.stop());
  console.log('Frames:', JSON.stringify(page.frames().map(f => ({ url: f.url(), name: f.name() }))));
  console.log('Body:', (await page.content()).slice(0, 6000));
  const session = await context.newCDPSession(page);
  const ax = await session.send('Accessibility.getFullAXTree');
  console.log('Controls:', JSON.stringify(ax.nodes.filter(n => ['button', 'link'].includes(n.role?.value)).map(n => ({ role: n.role.value, name: n.name?.value }))));
  await page.screenshot({ path: join(root, 'pdf-viewer.png') });
  // An ordinary same-origin download link exercises the real browser filename event;
  // it does not replace metadata, fetch through a test server, or rename the resulting file.
  await page.evaluate(url => {
    const a = document.createElement('a'); a.href = url; a.download = ''; a.id = 'testDownload'; a.textContent = 'Download test PDF';
    a.style.cssText = 'position:fixed;top:80px;left:20px;z-index:2147483647;background:white;padding:20px';
    document.body.append(a);
  }, pdf);
  await page.locator('#testDownload').click();
  let record;
  for (let i = 0; i < 1200; i++) {
    const latest = await ui.evaluate(() => chrome.runtime.sendMessage({ type: 'GET_STATE' }));
    record = latest.records[0];
    if (record?.state === 'complete' || record?.state === 'interrupted') break;
    if (i > 0 && i % 80 === 0) console.log('Download progress:', JSON.stringify(await ui.evaluate(() => chrome.downloads.search({})).then(items => items.map(i => ({ bytes: i.bytesReceived, total: i.totalBytes, state: i.state })))));
    await new Promise(r => setTimeout(r, 250));
  }
  assert.equal(record?.state, 'complete', JSON.stringify(record));
  assert.ok(record.proposed?.startsWith('Atmos Chem Phys - 2026 - Xu - Cloud vertical structure'), JSON.stringify(record));
  assert.equal(record.nameMismatch, false);
  const bytes = await readFile(record.actual);
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
  await writeFile(join(root, 'download-result.json'), JSON.stringify({ record, size: bytes.length }, null, 2));
  console.log('PASS actual real-paper download filename:', record.actual);
  await ui.reload(); await ui.screenshot({ path: join(root, 'popup-result.png'), fullPage: true });
  console.log('Results:', root);
} finally { await context.close(); }
