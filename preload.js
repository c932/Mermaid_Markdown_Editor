const { contextBridge, ipcRenderer } = require('electron');
const hljs = require('highlight.js/lib/common');

contextBridge.exposeInMainWorld('mmeApi', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (payload) => ipcRenderer.invoke('settings:set', payload),
  openFile: () => ipcRenderer.invoke('file:open'),
  saveProject: (payload) => ipcRenderer.invoke('file:save-project', payload),
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
      'menu:toggle-grid', 'menu:toggle-layout'
    ];
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, () => callback());
    }
  }
});
