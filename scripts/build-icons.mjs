import { chromium } from 'playwright';
import { readFile, mkdir } from 'node:fs/promises';
// Render vector artwork at each native toolbar/store size, with transparent corners.
const browser = await chromium.launch({ executablePath: process.env.PAPER_TEST_EXECUTABLE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true });
try {
  const source = await readFile('public/icons/icon.svg', 'utf8');
  const page = await browser.newPage({deviceScaleFactor:1});
  for (const size of [16, 32, 48, 128]) {
    await page.setViewportSize({width:size,height:size});
    await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:100vw;height:100vh}</style>${source}`);
    await page.screenshot({path:`public/icons/icon-${size}.png`,omitBackground:true});
  }
  await mkdir('design-preview', {recursive:true});
  await page.setViewportSize({width:850,height:340});
  await page.setContent(`<style>body{margin:0;padding:40px;background:#edf1f4;font-family:Segoe UI,Microsoft YaHei,sans-serif;color:#36566a}h1{font-size:20px;margin:0 0 32px}.row{display:flex;gap:35px;align-items:center}.tile{display:flex;align-items:center;justify-content:center;background:white;border-radius:15px;width:150px;height:155px}.dark{background:#263441}.label{text-align:center;margin-top:14px;font-size:12px;color:#71828e}svg{display:block}</style><h1>文献 PDF · 新图标</h1><div class="row">${[128,48,32,16].map((s,i)=>`<div><div class="tile ${i===3?'dark':''}">${source.replace('width="128" height="128"',`width="${s}" height="${s}"`)}</div><div class="label">${s} × ${s}${s===16?' · 工具栏':''}</div></div>`).join('')}</div>`);
  await page.screenshot({path:'design-preview/icon-preview.png'});
  console.log('Generated 16, 32, 48, 128 px PNGs and icon preview.');
} finally { await browser.close(); }
