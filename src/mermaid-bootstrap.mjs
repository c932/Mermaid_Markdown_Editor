// Bootstrap：加载 Mermaid v11 ESM 版本并注册 ELK 布局引擎。
// 注册完成后把 mermaid 挂到 window.mermaid 供旧 UMD 风格的 renderer.js 使用，
// 同时派发 `mermaid-ready` 事件，由 HTML 里的普通 script 监听后再加载 renderer.js。
import mermaid from '../node_modules/mermaid/dist/mermaid.esm.min.mjs';
import elkLayouts from '../vendor/mermaid-layout-elk.bundle.mjs';

try {
  mermaid.registerLayoutLoaders(elkLayouts);
  console.log('[mermaid-bootstrap] ELK layout registered:', elkLayouts.map((l) => l.name).join(', '));
} catch (e) {
  console.warn('[mermaid-bootstrap] registerLayoutLoaders failed, fallback to dagre', e);
}

window.mermaid = mermaid;
window.dispatchEvent(new CustomEvent('mermaid-ready'));
