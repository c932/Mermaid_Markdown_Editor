const { app, BrowserWindow, dialog, ipcMain, nativeTheme, Menu } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const { Document, Packer, Paragraph, TextRun, HeadingLevel } = require('docx');
const { spawn } = require('child_process');

const defaultSettings = {
  autoUpdate: true,
  theme: 'light'
};

let appSettings = { ...defaultSettings };

let mainWindow = null;
const PNG_EXPORT_SCALE = 3;
const EXPORT_PADDING = 24;
const INITIAL_EXPORT_WIDTH = 2400;
const INITIAL_EXPORT_HEIGHT = 1800;

function getSettingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

async function loadSettings() {
  try {
    const raw = await fs.readFile(getSettingsPath(), 'utf-8');
    const parsed = JSON.parse(raw);
    appSettings = { ...defaultSettings, ...parsed };
  } catch {
    appSettings = { ...defaultSettings };
  }
}

async function persistSettings() {
  await fs.writeFile(getSettingsPath(), JSON.stringify(appSettings, null, 2), 'utf-8');
}

function buildAppMenu() {
  const template = [
    {
      label: '文件',
      submenu: [
        {
          label: '打开文件...',
          accelerator: 'CmdOrCtrl+O',
          click: () => mainWindow?.webContents.send('menu:open')
        },
        { type: 'separator' },
        {
          label: '保存工程...',
          accelerator: 'CmdOrCtrl+S',
          click: () => mainWindow?.webContents.send('menu:save-project')
        },
        { type: 'separator' },
        {
          label: '打印...',
          accelerator: 'CmdOrCtrl+P',
          click: () => mainWindow?.webContents.send('menu:print')
        },
        { type: 'separator' },
        {
          label: '关联文件格式...',
          click: () => mainWindow?.webContents.send('menu:file-associations')
        },
        { type: 'separator' },
        {
          label: '退出',
          accelerator: 'Alt+F4',
          role: 'quit'
        }
      ]
    },
    {
      label: '导出',
      submenu: [
        {
          label: '导出 SVG...',
          click: () => mainWindow?.webContents.send('menu:export-svg')
        },
        {
          label: '导出 PNG...',
          click: () => mainWindow?.webContents.send('menu:export-png')
        },
        {
          label: '导出 DOCX...',
          click: () => mainWindow?.webContents.send('menu:export-docx')
        },
        {
          label: '导出 Visio...',
          click: () => mainWindow?.webContents.send('menu:export-visio')
        }
      ]
    },
    {
      label: '视图',
      submenu: [
        {
          label: '放大',
          accelerator: 'CmdOrCtrl+=',
          click: () => mainWindow?.webContents.send('menu:zoom-in')
        },
        {
          label: '缩小',
          accelerator: 'CmdOrCtrl+-',
          click: () => mainWindow?.webContents.send('menu:zoom-out')
        },
        {
          label: '重置缩放',
          accelerator: 'CmdOrCtrl+0',
          click: () => mainWindow?.webContents.send('menu:zoom-reset')
        },
        { type: 'separator' },
        {
          label: '切换网格',
          click: () => mainWindow?.webContents.send('menu:toggle-grid')
        },
        {
          label: '切换拖拽布局',
          click: () => mainWindow?.webContents.send('menu:toggle-layout')
        }
      ]
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '关于 Mermaid Markdown Editor',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: '关于',
              message: 'Mermaid Markdown Editor',
              detail: '基于 Electron 构建的 Mermaid 图表与 Markdown 文档编辑器。'
            });
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function createMainWindow() {
  const theme = appSettings.theme || 'light';
  nativeTheme.themeSource = theme;

  mainWindow = new BrowserWindow({
    width: 1560,
    height: 960,
    minWidth: 1200,
    minHeight: 760,
    title: 'Mermaid Markdown Editor',
    backgroundColor: '#eef4f7',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  // 默认不打开 DevTools；开发时可用 `set MME_DEVTOOLS=1 && npm start` 显式启用。
  if (process.env.MME_DEVTOOLS === '1') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

async function saveTextFile(defaultPath, content, filters) {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath,
    filters
  });

  if (result.canceled || !result.filePath) {
    return { canceled: true };
  }

  await fs.writeFile(result.filePath, content, 'utf-8');
  return { canceled: false, filePath: result.filePath };
}

async function saveBinaryFile(defaultPath, buffer, filters) {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath,
    filters
  });

  if (result.canceled || !result.filePath) {
    return { canceled: true };
  }

  await fs.writeFile(result.filePath, buffer);
  return { canceled: false, filePath: result.filePath };
}

function parseSizeValue(value) {
  if (!value) {
    return null;
  }

  if (String(value).includes('%')) {
    return null;
  }

  const match = String(value).match(/([\d.]+)/);
  if (!match) {
    return null;
  }

  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeSvgForExport(svgText) {
  let normalized = svgText;

  if (/\bstyle\s*=\s*"[^"]*"/i.test(normalized)) {
    normalized = normalized.replace(/\bstyle\s*=\s*"([^"]*)"/i, (_match, styleText) => {
      const cleaned = String(styleText)
        .replace(/max-width\s*:[^;]+;?/ig, '')
        .replace(/width\s*:[^;]+;?/ig, '')
        .replace(/height\s*:[^;]+;?/ig, '')
        .trim();
      const suffix = cleaned ? `${cleaned}; ` : '';
      return `style="${suffix}background:#ffffff;"`;
    });
  } else {
    normalized = normalized.replace(/<svg\b/i, '<svg style="background:#ffffff;"');
  }

  return normalized;
}

function buildSvgHtml(svgText) {
  const normalizedSvg = normalizeSvgForExport(svgText);
  return `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <style>
      html, body {
        margin: 0;
        padding: 0;
        background: #ffffff;
        overflow: hidden;
      }
      .export-stage {
        position: relative;
        background: #ffffff;
        overflow: hidden;
      }
      .export-stage svg {
        display: block;
        background: #ffffff;
      }
    </style>
  </head>
  <body>
    <div class="export-stage">${normalizedSvg}</div>
  </body>
</html>`;
}

async function fitSvgToStage(renderWindow, scale, padding) {
  const metrics = await renderWindow.webContents.executeJavaScript(`(() => {
    const stage = document.querySelector('.export-stage');
    const svg = stage && stage.querySelector('svg');
    if (!stage || !svg) {
      return null;
    }

    const bbox = svg.getBBox();
    const safeWidth = Math.max(1, Math.ceil(bbox.width));
    const safeHeight = Math.max(1, Math.ceil(bbox.height));
    const safeX = Math.floor(bbox.x - ${padding});
    const safeY = Math.floor(bbox.y - ${padding});
    const paddedWidth = Math.ceil(bbox.width + ${padding * 2});
    const paddedHeight = Math.ceil(bbox.height + ${padding * 2});

    svg.setAttribute('viewBox', [safeX, safeY, paddedWidth, paddedHeight].join(' '));
    svg.setAttribute('width', paddedWidth);
    svg.setAttribute('height', paddedHeight);
    svg.style.width = paddedWidth + 'px';
    svg.style.height = paddedHeight + 'px';
    svg.style.transformOrigin = 'top left';
    svg.style.transform = 'scale(${scale})';

    stage.style.width = (paddedWidth * ${scale}) + 'px';
    stage.style.height = (paddedHeight * ${scale}) + 'px';
    document.body.style.width = (paddedWidth * ${scale}) + 'px';
    document.body.style.height = (paddedHeight * ${scale}) + 'px';

    return {
      width: Math.ceil(paddedWidth * ${scale}),
      height: Math.ceil(paddedHeight * ${scale})
    };
  })()`);

  return metrics || { width: INITIAL_EXPORT_WIDTH, height: INITIAL_EXPORT_HEIGHT };
}

async function createSvgRenderWindow(svgText, scale = 1, padding = EXPORT_PADDING) {
  const renderWindow = new BrowserWindow({
    show: false,
    width: INITIAL_EXPORT_WIDTH,
    height: INITIAL_EXPORT_HEIGHT,
    useContentSize: true,
    backgroundColor: '#ffffff',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  const html = buildSvgHtml(svgText);
  await renderWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await renderWindow.webContents.executeJavaScript('document.fonts ? document.fonts.ready.then(() => true) : Promise.resolve(true)');
  await new Promise((resolve) => setTimeout(resolve, 180));
  const fittedSize = await fitSvgToStage(renderWindow, scale, padding);
  await renderWindow.setContentSize(fittedSize.width, fittedSize.height);
  await new Promise((resolve) => setTimeout(resolve, 120));
  return {
    renderWindow,
    fittedSize
  };
}

function markdownToDocxParagraphs(markdownText) {
  const lines = markdownText.split(/\r?\n/);

  return lines.map((line) => {
    const trimmed = line.trim();

    if (trimmed.startsWith('### ')) {
      return new Paragraph({
        heading: HeadingLevel.HEADING_3,
        children: [new TextRun(trimmed.slice(4))]
      });
    }

    if (trimmed.startsWith('## ')) {
      return new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun(trimmed.slice(3))]
      });
    }

    if (trimmed.startsWith('# ')) {
      return new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun(trimmed.slice(2))]
      });
    }

    if (trimmed.startsWith('- ')) {
      return new Paragraph({
        bullet: { level: 0 },
        children: [new TextRun(trimmed.slice(2))]
      });
    }

    return new Paragraph({
      children: [new TextRun(line)]
    });
  });
}

async function exportVisioViaPowerShell(svgPath, outputPath) {
  const script = `
$ErrorActionPreference = 'Stop'
try {
  $visio = New-Object -ComObject Visio.Application
  $visio.Visible = $false
  $doc = $visio.Documents.Add("")
  $null = $visio.ActivePage.Import("${svgPath.replace(/\\/g, '\\\\')}")
  $doc.SaveAs("${outputPath.replace(/\\/g, '\\\\')}")
  $doc.Close()
  $visio.Quit()
  Write-Output 'OK'
} catch {
  Write-Error $_
  exit 1
}
`;

  return new Promise((resolve, reject) => {
    const child = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      windowsHide: true
    });

    let stderr = '';
    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(stderr || 'Visio export failed'));
      }
    });
  });
}

ipcMain.handle('settings:get', async () => {
  return {
    autoUpdate: appSettings.autoUpdate,
    theme: appSettings.theme
  };
});

ipcMain.handle('print:get-printers', async () => {
  if (!mainWindow) {
    return [];
  }

  const printers = await mainWindow.webContents.getPrintersAsync();
  return printers.map((printer) => ({
    name: printer.name,
    displayName: printer.displayName || printer.name,
    isDefault: Boolean(printer.isDefault),
    status: printer.status ?? 0
  }));
});

ipcMain.handle('print:html', async (_event, payload) => {
  if (!payload || typeof payload.html !== 'string' || !payload.deviceName) {
    return { ok: false, error: 'Invalid print payload.' };
  }

  const printWindow = new BrowserWindow({
    show: false,
    width: 1240,
    height: 1754,
    backgroundColor: '#ffffff',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  try {
    await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(payload.html)}`);
    await printWindow.webContents.executeJavaScript('document.fonts ? document.fonts.ready.then(() => true) : Promise.resolve(true)');
    await new Promise((resolve) => setTimeout(resolve, 180));

    const result = await new Promise((resolve, reject) => {
      printWindow.webContents.print({
        silent: true,
        deviceName: payload.deviceName,
        printBackground: true,
        color: true,
        margins: { marginType: 'printableArea' }
      }, (success, errorType) => {
        if (!success) {
          reject(new Error(errorType || 'Print failed'));
          return;
        }
        resolve({ ok: true });
      });
    });

    return result;
  } catch (error) {
    return { ok: false, error: String(error.message || error) };
  } finally {
    if (!printWindow.isDestroyed()) {
      printWindow.destroy();
    }
  }
});

ipcMain.handle('settings:set', async (_event, payload) => {
  if (typeof payload.autoUpdate === 'boolean') {
    appSettings.autoUpdate = payload.autoUpdate;
  }

  if (payload.theme === 'light' || payload.theme === 'dark' || payload.theme === 'system') {
    appSettings.theme = payload.theme;
    nativeTheme.themeSource = payload.theme;
  }

  await persistSettings();

  return { ok: true };
});

// ------- 文件关联：读写 HKCU\Software\Classes -------

const SUPPORTED_ASSOC_EXTS = ['.md', '.markdown', '.mmd', '.mermaid', '.json'];
const ASSOC_PROGID_MAP = {
  '.md': 'MermaidMarkdownEditor.Markdown',
  '.markdown': 'MermaidMarkdownEditor.Markdown',
  '.mmd': 'MermaidMarkdownEditor.Mermaid',
  '.mermaid': 'MermaidMarkdownEditor.Mermaid',
  '.json': 'MermaidMarkdownEditor.Project'
};
const ASSOC_DESC_MAP = {
  '.md': 'Markdown 文档 (Mermaid Markdown Editor)',
  '.markdown': 'Markdown 文档 (Mermaid Markdown Editor)',
  '.mmd': 'Mermaid 脚本 (Mermaid Markdown Editor)',
  '.mermaid': 'Mermaid 脚本 (Mermaid Markdown Editor)',
  '.json': 'Mermaid Editor Project (Mermaid Markdown Editor)'
};

function getAppExecutablePath() {
  // 打包态：app.getPath('exe') 就是用户看到的 exe
  // 开发态：指向 electron.exe，不适合写注册表；仍返回它仅用于调试
  return process.execPath;
}

function runReg(args) {
  return new Promise((resolve) => {
    const { spawn } = require('child_process');
    const p = spawn('reg.exe', args, { windowsHide: true });
    let stderr = '';
    p.stderr.on('data', (c) => { stderr += c.toString(); });
    p.on('close', (code) => resolve({ code, stderr }));
    p.on('error', () => resolve({ code: -1, stderr: 'spawn failed' }));
  });
}

async function regQueryExists(keyPath) {
  const r = await runReg(['query', keyPath]);
  return r.code === 0;
}

async function regAssocSet(extension) {
  const exe = getAppExecutablePath();
  const progId = ASSOC_PROGID_MAP[extension];
  const desc = ASSOC_DESC_MAP[extension];
  if (!progId) return false;

  // 1) ProgID 根
  await runReg(['add', `HKCU\\Software\\Classes\\${progId}`, '/ve', '/d', desc, '/f']);
  // 2) 图标
  await runReg(['add', `HKCU\\Software\\Classes\\${progId}\\DefaultIcon`, '/ve', '/d', `"${exe}",0`, '/f']);
  // 3) 打开命令
  await runReg(['add', `HKCU\\Software\\Classes\\${progId}\\shell\\open\\command`, '/ve', '/d', `"${exe}" "%1"`, '/f']);
  // 4) 友好名称（OpenWith 列表显示用）
  await runReg(['add', `HKCU\\Software\\Classes\\${progId}\\shell\\open`, '/v', 'FriendlyAppName', '/d', 'Mermaid Markdown Editor', '/f']);
  // 5) 扩展名 → ProgID（OpenWithProgids）
  await runReg(['add', `HKCU\\Software\\Classes\\${extension}\\OpenWithProgids`, '/v', progId, '/t', 'REG_SZ', '/d', '', '/f']);
  return true;
}

async function regAssocUnset(extension) {
  const progId = ASSOC_PROGID_MAP[extension];
  if (!progId) return false;
  // 只删 OpenWithProgids 中这一条，不动整个扩展
  await runReg(['delete', `HKCU\\Software\\Classes\\${extension}\\OpenWithProgids`, '/v', progId, '/f']);
  // ProgID 整个删掉（同一 ProgID 可能被多个扩展引用，所以仅在无其它引用时再删）
  // 简化：检查是否还有其他扩展指向同一 ProgID
  const stillUsed = SUPPORTED_ASSOC_EXTS.some((ext) => ext !== extension && ASSOC_PROGID_MAP[ext] === progId);
  if (!stillUsed) {
    await runReg(['delete', `HKCU\\Software\\Classes\\${progId}`, '/f']);
  }
  return true;
}

ipcMain.handle('fileassoc:get', async () => {
  const state = {};
  for (const ext of SUPPORTED_ASSOC_EXTS) {
    const progId = ASSOC_PROGID_MAP[ext];
    state[ext] = await regQueryExists(`HKCU\\Software\\Classes\\${ext}\\OpenWithProgids\\${progId}`);
  }
  return { exts: SUPPORTED_ASSOC_EXTS, state, exe: getAppExecutablePath() };
});

ipcMain.handle('fileassoc:set', async (_event, selections) => {
  // selections: { '.md': true, '.mmd': false, ... }
  if (!selections || typeof selections !== 'object') return { ok: false, error: 'invalid selections' };
  const results = {};
  for (const ext of SUPPORTED_ASSOC_EXTS) {
    try {
      if (selections[ext]) {
        await regAssocSet(ext);
        results[ext] = 'on';
      } else {
        await regAssocUnset(ext);
        results[ext] = 'off';
      }
    } catch (err) {
      results[ext] = `error: ${err && err.message || err}`;
    }
  }
  // 通知 shell 刷新（否则 Explorer 需要重启才生效）
  try {
    const { spawn } = require('child_process');
    spawn('ie4uinit.exe', ['-show'], { windowsHide: true, detached: true }).unref();
  } catch {}
  return { ok: true, results };
});

ipcMain.handle('file:open', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open Mermaid Markdown File',
    filters: [
      { name: 'Markdown & Mermaid', extensions: ['md', 'markdown', 'mmd', 'mermaid', 'txt'] },
      { name: 'Mermaid Editor Project', extensions: ['json'] },
      { name: 'All Files', extensions: ['*'] }
    ],
    properties: ['openFile']
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true };
  }

  const filePath = result.filePaths[0];
  const content = await fs.readFile(filePath, 'utf-8');
  return {
    canceled: false,
    filePath,
    content,
    extension: path.extname(filePath).toLowerCase()
  };
});

ipcMain.handle('file:save-project', async (_event, payload) => {
  const data = {
    mermaid: payload.mermaid || '',
    markdown: payload.markdown || ''
  };

  return saveTextFile('diagram.mme.json', JSON.stringify(data, null, 2), [
    { name: 'Mermaid Editor Project', extensions: ['json'] }
  ]);
});

ipcMain.handle('file:save-text', async (_event, payload) => {
  const defaultName = (payload && payload.defaultName) || 'document.txt';
  const content = (payload && payload.content) || '';
  const filters = (payload && Array.isArray(payload.filters) && payload.filters.length)
    ? payload.filters
    : [{ name: 'All Files', extensions: ['*'] }];
  return saveTextFile(defaultName, content, filters);
});

ipcMain.handle('export:svg', async (_event, svgText) => {
  return saveTextFile('diagram.svg', svgText, [{ name: 'SVG', extensions: ['svg'] }]);
});

ipcMain.handle('export:png', async (_event, svgText) => {
  if (!svgText || typeof svgText !== 'string') {
    return { canceled: true, error: 'No SVG content.' };
  }

  const save = await dialog.showSaveDialog(mainWindow, {
    defaultPath: 'diagram.png',
    filters: [{ name: 'PNG', extensions: ['png'] }]
  });

  if (save.canceled || !save.filePath) {
    return { canceled: true };
  }

  let renderWindow;
  let fittedSize;
  try {
    ({ renderWindow, fittedSize } = await createSvgRenderWindow(svgText, PNG_EXPORT_SCALE, EXPORT_PADDING));
    const image = await renderWindow.webContents.capturePage({
      x: 0,
      y: 0,
      width: fittedSize.width,
      height: fittedSize.height
    });

    const png = image.toPNG();

    await fs.writeFile(save.filePath, png);
    return { canceled: false, filePath: save.filePath };
  } catch (error) {
    return { canceled: false, filePath: save.filePath, error: String(error.message || error) };
  } finally {
    if (renderWindow && !renderWindow.isDestroyed()) {
      renderWindow.destroy();
    }
  }
});

ipcMain.handle('export:docx', async (_event, markdownText) => {
  const doc = new Document({
    sections: [{
      properties: {},
      children: markdownToDocxParagraphs(markdownText)
    }]
  });

  const buffer = await Packer.toBuffer(doc);
  return saveBinaryFile('document.docx', buffer, [{ name: 'Word Document', extensions: ['docx'] }]);
});

ipcMain.handle('export:visio', async (_event, svgText) => {
  const save = await dialog.showSaveDialog(mainWindow, {
    defaultPath: 'diagram.vsdx',
    filters: [{ name: 'Visio Drawing', extensions: ['vsdx'] }]
  });

  if (save.canceled || !save.filePath) {
    return { canceled: true };
  }

  const tempSvg = path.join(app.getPath('temp'), `mme_${Date.now()}.svg`);
  await fs.writeFile(tempSvg, svgText, 'utf-8');

  try {
    await exportVisioViaPowerShell(tempSvg, save.filePath);
    return { canceled: false, filePath: save.filePath };
  } catch (error) {
    return {
      canceled: false,
      filePath: save.filePath,
      warning: 'Visio COM export failed. Ensure Microsoft Visio is installed and activated.',
      error: String(error.message || error)
    };
  } finally {
    await fs.unlink(tempSvg).catch(() => {});
  }
});

const fsSync = require('fs');

// 从命令行参数里寻找一个存在的文件路径（Windows 双击关联的文件会作为 argv 末尾）。
// 忽略 electron.exe 本身、以 '-' 开头的 flag、以及不存在的路径。
function getFilePathFromArgv(argv) {
  if (!Array.isArray(argv)) return null;
  // 打包后 argv[0] 是自身 exe；开发态 argv[0] 是 electron、argv[1] 是 '.'
  const startIdx = app.isPackaged ? 1 : 2;
  for (let i = startIdx; i < argv.length; i++) {
    const a = argv[i];
    if (!a || typeof a !== 'string') continue;
    if (a.startsWith('-')) continue;
    if (a === '.' || a === './') continue;
    try {
      if (fsSync.existsSync(a) && fsSync.statSync(a).isFile()) return path.resolve(a);
    } catch { /* ignore */ }
  }
  return null;
}

// 等窗口就绪后把文件内容推送到 renderer
function sendFileToRenderer(filePath) {
  if (!filePath || !mainWindow) return;
  const push = async () => {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      mainWindow.webContents.send('file:open-external', {
        filePath,
        content,
        extension: path.extname(filePath).toLowerCase()
      });
    } catch (err) {
      console.warn('[file:open-external] failed to read', filePath, err);
    }
  };
  if (mainWindow.webContents.isLoading()) {
    mainWindow.webContents.once('did-finish-load', push);
  } else {
    push();
  }
}

// 单实例锁：第二次启动（例如双击另一个 md）时把文件路径转给已运行实例
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
    const fp = getFilePathFromArgv(argv);
    if (fp) sendFileToRenderer(fp);
  });
}

// macOS 的 open-file（双击文件关联）。Windows 走 argv 路径。
app.on('open-file', (event, filePath) => {
  event.preventDefault();
  if (mainWindow) sendFileToRenderer(filePath);
  else app.once('browser-window-created', () => sendFileToRenderer(filePath));
});

app.whenReady().then(async () => {
  await loadSettings();
  createMainWindow();
  buildAppMenu();
  // 启动参数里若带文件，则窗口加载完成后自动打开
  const initialPath = getFilePathFromArgv(process.argv);
  if (initialPath) sendFileToRenderer(initialPath);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  }
});
