# 文献 PDF 规范命名

适用于 Windows Chrome / Edge 的 Manifest V3 扩展。点击出版平台的普通下载按钮时，自动将能可靠关联、元数据齐全的 PDF 命名为：

```text
期刊缩写 - 年份 - 第一作者姓氏 - 题目.pdf
期刊缩写 - 年份 - 第一作者姓氏 - 题目 - SI - 原附件标识.pdf
期刊缩写 - 年份 - 第一作者姓氏 - 题目 - PeerReview - 原附件标识.pdf
```

命名规则来自用户提供的 `paper-pdf-naming` 技能，命名函数移植了其 `rename_pdf.py` 的字符清理、路径预算、标题截短及 SHA-256 后缀逻辑。插件无需 Python、本地助手或服务器。

## 安装与使用

1. 使用已经构建的 `dist` 文件夹，或解压 `release/paper-pdf-namer-0.1.2.zip` 至固定位置。不要直接加载 ZIP，也不要在安装后移动或删除该文件夹。
2. Chrome 地址栏打开 `chrome://extensions`；Edge 打开 `edge://extensions`。
3. 开启“开发者模式”，选择“加载已解压的扩展程序”，选中包含 `manifest.json` 的文件夹。
4. 首次打开设置页，点击“授权重点平台与 DOI 补查”，确认浏览器授权提示。也可只授权单个网站；弹窗提供“授权 ACP”快捷按钮。仅安装插件不会获得网站访问权限。
5. **刷新已经打开的文章页**，等待文献信息准备好，再照常下载 PDF。首次 DOI 查询可能需要几秒；刚打开页面就下载时可能保留原名。
6. 将扩展固定到工具栏。点击图标查看结果；遇到“保留原名”时，展开编辑区，补全、核实字段并复制名称，再到文件管理器中手动改名。

设置页可关闭自动命名、撤销网站权限、关闭 Crossref、维护已核实的期刊缩写，以及清除本地记录。保存设置后不需要重启浏览器。修改源代码并重新构建后，需要在扩展管理页点击“重新加载”，并刷新文章页。

0.1.2 更新弹窗卡片和设置分组，新增“待处理”筛选与已完成记录的文件名复制。原有字段补全、来源说明和草稿保存仍保留。更新时覆盖原安装目录并重新加载即可，无需卸载；设置、授权及本地记录的数据结构保持不变。

## 识别规则与适用范围

- 优先读取 `citation_*`、PRISM、DC 和 `ScholarlyArticle` JSON-LD 等网页文献元数据。重点处理 AGU/Wiley、AMS、Copernicus、Nature、PNAS 的常见正文／附件链接形式。
- 依据精确下载链接、明确的 DOI 路由及来源页关联文章；不使用当前活动标签页猜测归属，不剥离 URL 查询参数来猜测签名链接。
- DOI 可靠时，可用 Crossref 补查结构化第一作者姓氏等字段；只查询该 DOI，不自动选用模糊标题搜索结果。
- 正式卷期年份优先；不使用 Crossref 的 `issued`、入库时间、下载年份或 DOI 中的年份。无法核实则保留原名。
- 默认内置技能中列出的 8 种期刊缩写。其他期刊可采用出版方／Crossref 明确提供的缩写，或用户已核实的自定义映射。不会将 Nature 子刊改为 Nature，不会按首字母发明缩写。
- 姓氏只取明确结构化字段，不从完整姓名的最后一个单词猜测。标题中的化学式上下标转为可读文本；复杂公式需要人工确认。
- 补充材料和审稿文件必须能关联母文章且明确附件标识。非 PDF 不处理。由其他扩展发起的下载以及隐身窗口不处理。
- ACP 的标准正文及 supplement PDF 直链可在获得 ACP 权限后，提前读取公开文章页，核对 DOI 和精确 PDF 链接后准备命名数据；首次网络请求尚未完成时仍保留原名。不会根据 PDF 路径猜测发表年份。
- 其他直接 PDF、临时 blob、无文献元数据、未授权网站或不明确的跳转，可能无法建立关联，会保留原名。PDF 查看器下载需要能关联到已准备的文章记录；内置下载按钮仍需人工验收。

## 纯浏览器版本的边界

本项目在 **浏览器确定下载文件名时**提出名称建议，最多等待约 1.9 秒。它不会在下载后读取、验证或改名本地文件。

- “已规范命名”表示下载完成后，浏览器报告的实际名称符合建议；**不表示验证过 PDF 文件头、页数或首页内容**。
- 无法按内容去重；同名使用浏览器 `uniquify` 加编号，不覆盖。浏览器编号格式与原 Python 脚本不同。
- 无法改名已下载文件、清理旧副本、移动附件或扫描历史下载目录；不生成 `.metadata.json`、备份或对照表文件。
- 文件名长度按当时已知目录预算，仅截短标题并加哈希。之后另存为到更长路径可能仍触发系统限制。
- “另存为”或其他命名扩展可能改动最终结果；弹窗会标示已检测到的差异，以实际文件为准。
- 没有管理员权限、付费内容获取或登录绕过功能；下载由原网站及浏览器照常执行。

## 权限与隐私

必需权限为 `downloads`、`storage`、`scripting`。网站和 `api.crossref.org` 均通过可选权限按需授权，默认不请求读取所有网站。

只有获授权的文章页会由内容脚本采集文献信息与相关链接。用户启用补查且授权 Crossref 后，请求只携带 DOI；不发送页面 URL、PDF、全文或登录凭据。不使用第三方分析、远程代码或大模型服务。

记录仅使用 `chrome.storage.local`，元数据有效期 7 天，最多缓存 150 个页面和 150 个 DOI；最近下载最多 100 条。访问和后台启动时清理过期缓存。不存在后台常驻计时清理任务，浏览器未运行时旧缓存会保留在本机但不会被用于命名。撤销任一网站权限时清空关联缓存；清除记录不会删除下载文件。

## 开发与测试

使用 Node.js 22.12+ 或 Node.js 24 LTS：

```powershell
npm ci
npm test
npm run build
npm run package
```

真实下载集成测试使用独立浏览器配置，不接触个人浏览器资料；测试副本仅额外预授权本地测试服务器，发行版权限不变。可以直接使用本机 Chrome 或 Edge：

```powershell
$env:PAPER_TEST_EXECUTABLE = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
npm run test:browser
$env:PAPER_TEST_EXECUTABLE = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
npm run test:browser
```

也可以使用 Playwright 独立测试浏览器：

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path (Get-Location) '.browser-binaries'
npx playwright install chromium
npm run test:browser
```

测试结果、实际下载及界面截图保存在 `test-results/`。人工构造的 HTML 夹具见 `tests/fixtures/README.md`；它们覆盖常见元数据形态，不代表出版方在线页面已经逐篇验收。

模块分工：`src/core` 为提取、核对、匹配和命名；`background.ts` 处理下载事件及持久化；`content.ts` 采集获授权网页；`popup.ts` / `options.ts` 提供中文界面。

### Chrome / Edge 手动验收

- 分别加载发行版，确认首次授权、撤销权限、自动命名开关和重启后设置保留。
- 在实际有权访问的文章页，检查正文、补充材料和审稿 PDF 的最终磁盘文件名。
- 验证同时下载两篇文章、通过 PDF 查看器保存、重定向、重复下载、另存为和中断下载。
- 检查普通 PDF、离线、缺姓氏、未知期刊、标题或年份冲突时保留原名。
- 检查 Crossref 被拒绝授权或限流时下载仍然继续。

测试脚本使用浏览器扩展调试接口加载测试副本，并恢复正常下载流程；不使用会绕过文件名确定事件的 CDP 下载接管模式。浏览器的授权对话框与另存为流程仍需上述手动验收。

## 接口依据

- [Chrome Downloads API](https://developer.chrome.com/docs/extensions/reference/api/downloads)
- [Chrome Scripting API](https://developer.chrome.com/docs/extensions/reference/api/scripting)
- [Chrome Content Scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)
- [Crossref REST API](https://www.crossref.org/documentation/retrieve-metadata/rest-api/)
