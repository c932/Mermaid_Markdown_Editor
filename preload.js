const { contextBridge, ipcRenderer } = require('electron');
const hljs = require('highlight.js/lib/common');

contextBridge.exposeInMainWorld('mmeApi', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (payload) => ipcRenderer.invoke('settings:set', payload),
  openFile: () => ipcRenderer.invoke('file:open'),
  saveProject: (payload) => ipcRenderer.invoke('file:save-project', payload),
  saveText: (payload) => ipcRenderer.invoke('file:save-text', payload),
  highlightCode: (code, language) => {
    const source = String(code || '');
    if (language && hljs.getLanguage(language)) {
      return hljs.highlight(source, { language }).value;
    }
    return hljs.highlightAuto(source).value;
  },
  getPrinters: () => ipcRenderer.invoke('print:get-printers'),
  printHtml: (payload) => ipcRenderer.invoke('print:html', payload),
  exportSvg: (svgText) => ipcRenderer.invoke('export:svg', svgText),
  exportPng: (svgText) => ipcRenderer.invoke('export:png', svgText),
  exportDocx: (markdownText) => ipcRenderer.invoke('export:docx', markdownText),
  exportVisio: (svgText) => ipcRenderer.invoke('export:visio', svgText),
  onMenuAction: (channel, callback) => {
    const validChannels = [
      'menu:open', 'menu:save-project', 'menu:print',
      'menu:export-svg', 'menu:export-png', 'menu:export-docx', 'menu:export-visio',
      'menu:zoom-in', 'menu:zoom-out', 'menu:zoom-reset',
      'menu:toggle-grid', 'menu:toggle-layout',
      'menu:file-associations'
    ];
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, () => callback());
    }
  },
  // 外部打开（文件关联双击、命令行参数、macOS open-file）
  onFileOpen: (callback) => {
    ipcRenderer.on('file:open-external', (_e, payload) => callback(payload));
  },
  // 文件关联管理
  getFileAssociations: () => ipcRenderer.invoke('fileassoc:get'),
  setFileAssociations: (selections) => ipcRenderer.invoke('fileassoc:set', selections)
});
