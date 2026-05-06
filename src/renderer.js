const mermaidApi = window.mermaid;
const markedApi = window.marked;

if (!mermaidApi || !markedApi) {
  throw new Error('Mermaid or Marked library failed to load.');
}

const sampleMermaid = `graph LR
  %% 电源链路
  subgraph PowerSystem["🔋 能源系统"]
    Solar["6V 太阳能板"] --> TP4056["TP4056 充电与保护"]
    Battery["18650 电池"] --> TP4056
  end

  %% 控制与执行
  subgraph Brain["🧠 控制核心"]
    Pico["RP2040 MicroPython"]
  end

  subgraph Actuator["⚙ 动力执行"]
    L298N["L298N 电机驱动板"] --> MotorL["左轮电机"]
    L298N --> MotorR["右轮电机"]
  end

  TP4056 --> Pico
  TP4056 --> L298N
`;

const sampleMarkdown = `# Mermaid Markdown Editor

这是一个面向 Windows 的现代化编辑器原型。

## 功能
- Mermaid 与 Markdown 双编辑
- 类 Mermaid.ai 的左右分栏 UI
- 导出 SVG / PNG / PDF / DOCX / Visio

## 提示
- 你可以在左侧切换 Mermaid 与 Markdown。
- 开启 Auto-Update 后会实时刷新预览。
`;

const tabs = document.querySelectorAll('.tab');
const mermaidEditor = document.getElementById('mermaidEditor');
const markdownEditor = document.getElementById('markdownEditor');
const mermaidPreview = document.getElementById('mermaidPreview');
const markdownPreview = document.getElementById('markdownPreview');
const autoUpdateSwitch = document.getElementById('autoUpdateSwitch');
const previewRoot = document.getElementById('previewRoot');
const statusBar = document.getElementById('statusBar');
const canvasViewport = document.getElementById('canvasViewport');
const toggleManualLayoutButton = document.getElementById('toggleManualLayout');
const printDialog = document.getElementById('printDialog');
const printerSelect = document.getElementById('printerSelect');
const printContentSelect = document.getElementById('printContentSelect');
const printPreviewFrame = document.getElementById('printPreviewFrame');
const editorTitle = document.getElementById('editorTitle');
const previewTitle = document.getElementById('previewTitle');

let activeTab = 'mermaid';
let autoUpdate = true;
let zoom = 1;
let renderedSvg = '';
let manualLayoutEnabled = true;
// 上一次"自动布局"触发前的手动布局快照，用于"撤销布局"按钮恢复
let lastAutoLayoutSnapshot = null;
let printerList = [];

const manualLayoutState = {
  nodePositions: new Map(),
  edgeMidpoints: new Map(),
  nodeRegistry: new Map(),
  edgeRegistry: [],
  clusterSizes: new Map(),
  clusterSourceIds: new WeakMap()
};

markedApi.setOptions({
  gfm: true,
  breaks: true
});

mermaidApi.initialize({
  startOnLoad: false,
  theme: 'default'
  // 对齐 VSCode `bierner.markdown-mermaid` 插件：完全使用 Mermaid 默认配置，
  // 不再覆盖 flowchart / layout / htmlLabels / curve / spacing / fontFamily /
  // securityLevel。Mermaid 11.12+ 已修复端点命中与 edgeLabel 定位问题。
  // ELK 仍通过 mermaid-bootstrap.mjs 注册为可选布局，单图可用
  // %%{init: {"layout": "elk"}}%% 临时启用。
});

function setStatus(text, type = 'info') {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  statusBar.textContent = `[${hh}:${mm}:${ss}] ${text}`;
  statusBar.style.color = type === 'error' ? '#b3312f' : type === 'ok' ? '#14855f' : '#5f7987';
}

function setActiveTab(tab) {
  activeTab = tab;
  tabs.forEach((item) => item.classList.toggle('active', item.dataset.tab === tab));
  if (tab === 'mermaid') {
    mermaidEditor.classList.remove('hidden');
    markdownEditor.classList.add('hidden');
    mermaidPreview.classList.remove('hidden');
    markdownPreview.classList.add('hidden');
    if (editorTitle) editorTitle.textContent = 'Mermaid 脚本';
    if (previewTitle) previewTitle.textContent = 'Mermaid 预览';
  } else {
    markdownEditor.classList.remove('hidden');
    mermaidEditor.classList.add('hidden');
    markdownPreview.classList.remove('hidden');
    mermaidPreview.classList.add('hidden');
    if (editorTitle) editorTitle.textContent = 'Markdown 脚本';
    if (previewTitle) previewTitle.textContent = 'Markdown 预览';
  }
}

function renderMarkdown() {
  const raw = markdownEditor.value || '';
  const html = markedApi.parse(raw);
  markdownPreview.innerHTML = html;
  markdownPreview.querySelectorAll('pre code').forEach((block) => {
    const classList = Array.from(block.classList || []);
    const langClass = classList.find((name) => name.startsWith('language-'));
    const language = langClass ? langClass.replace('language-', '') : undefined;
    // language-mermaid 交给下方异步渲染，这里不做 hljs 高亮
    if (language === 'mermaid') return;
    try {
      block.innerHTML = window.mmeApi.highlightCode(block.textContent || '', language);
      block.classList.add('hljs');
    } catch {
      // Fallback to plain code when highlighting fails.
    }
  });
  // 渲染 Markdown 里嵌入的 ```mermaid``` 代码块为 SVG 图
  renderEmbeddedMermaidBlocks();
}

async function renderEmbeddedMermaidBlocks() {
  const blocks = markdownPreview.querySelectorAll('pre > code.language-mermaid, code.language-mermaid');
  if (!blocks.length || !window.mermaid || typeof window.mermaid.render !== 'function') return;
  let idx = 0;
  for (const block of blocks) {
    const source = (block.textContent || '').trim();
    if (!source) continue;
    const host = block.closest('pre') || block;
    const container = document.createElement('div');
    container.className = 'md-mermaid-block';
    try {
      const id = `md-mermaid-${Date.now()}-${idx++}`;
      const { svg } = await window.mermaid.render(id, source);
      container.innerHTML = svg;
      host.parentNode && host.parentNode.replaceChild(container, host);
    } catch (err) {
      console.warn('[md-mermaid] render failed', err);
      container.innerHTML = `<pre class="md-mermaid-error">Mermaid 渲染失败：${(err && err.message) || err}</pre>`;
      host.parentNode && host.parentNode.replaceChild(container, host);
    }
  }
}

function getCurrentPreviewSvg() {
  const svgElement = mermaidPreview.querySelector('svg');
  return svgElement ? svgElement.outerHTML : renderedSvg;
}

function buildPrintDocumentHtml(mode) {
  const resolvedMode = mode === 'current' ? activeTab : mode;
  const title = resolvedMode === 'markdown' ? 'Markdown Print Preview' : 'Mermaid Diagram Print Preview';
  const markdownHtml = markdownPreview.innerHTML;
  const diagramSvg = getCurrentPreviewSvg();
  const body = resolvedMode === 'markdown'
    ? `<article class="print-markdown">${markdownHtml}</article>`
    : `<section class="print-diagram">${diagramSvg || '<p>No diagram available.</p>'}</section>`;

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>${title}</title>
    <style>
      :root {
        color-scheme: light;
      }
      * {
        box-sizing: border-box;
      }
      html, body {
        margin: 0;
        padding: 0;
        background: #dce7ee;
        font-family: "Segoe UI Variable", "Segoe UI", "Microsoft YaHei", sans-serif;
        color: #17313f;
      }
      .sheet {
        width: 210mm;
        min-height: 297mm;
        margin: 18px auto;
        background: #ffffff;
        box-shadow: 0 16px 48px rgba(18, 58, 79, 0.14);
        padding: 18mm 16mm;
      }
      .print-diagram {
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 240mm;
      }
      .print-diagram svg {
        max-width: 100%;
        max-height: 255mm;
        width: auto;
        height: auto;
      }
      .print-markdown {
        line-height: 1.7;
        font-size: 12pt;
      }
      .print-markdown pre {
        margin: 1em 0;
        padding: 14px 16px;
        overflow: auto;
        border-radius: 10px;
        background: #f2f6f8;
        border: 1px solid #dce6ec;
      }
      .print-markdown code {
        font-family: "Cascadia Code", "Consolas", monospace;
        font-size: 10.5pt;
      }
      .hljs-keyword,.hljs-selector-tag,.hljs-literal,.hljs-section,.hljs-link { color: #8a2be2; }
      .hljs-string,.hljs-title,.hljs-name,.hljs-type,.hljs-attribute,.hljs-symbol,.hljs-bullet,.hljs-addition,.hljs-template-tag,.hljs-template-variable { color: #0f7d4b; }
      .hljs-comment,.hljs-quote,.hljs-deletion,.hljs-meta { color: #697d88; }
      .hljs-number,.hljs-regexp,.hljs-selector-id,.hljs-selector-class,.hljs-variable,.hljs-tag .hljs-attr { color: #c2561a; }
      @page {
        size: A4;
        margin: 12mm;
      }
      @media print {
        html, body {
          background: #ffffff;
        }
        .sheet {
          width: auto;
          min-height: auto;
          margin: 0;
          box-shadow: none;
          padding: 0;
        }
      }
    </style>
  </head>
  <body>
    <main class="sheet">${body}</main>
  </body>
</html>`;
}

async function loadPrinters() {
  printerList = await window.mmeApi.getPrinters();
  printerSelect.innerHTML = '';
  printerList.forEach((printer) => {
    const option = document.createElement('option');
    option.value = printer.name;
    option.textContent = printer.isDefault ? `${printer.displayName}（默认）` : printer.displayName;
    printerSelect.appendChild(option);
  });
}

function refreshPrintPreview() {
  const html = buildPrintDocumentHtml(printContentSelect.value);
  printPreviewFrame.srcdoc = html;
}

async function openPrintDialog() {
  await loadPrinters();
  printContentSelect.value = 'current';
  refreshPrintPreview();
  printDialog.classList.remove('hidden');
  printDialog.setAttribute('aria-hidden', 'false');
}

function closePrintDialog() {
  printDialog.classList.add('hidden');
  printDialog.setAttribute('aria-hidden', 'true');
}

// ===== 自定义输入对话框（替代 Electron 禁用的 window.prompt） =====
const inputDialog = document.getElementById('inputDialog');
const inputDialogTitle = document.getElementById('inputDialogTitle');
const inputDialogHint = document.getElementById('inputDialogHint');
const inputDialogFields = document.getElementById('inputDialogFields');
const inputDialogCancel = document.getElementById('inputDialogCancel');
const inputDialogOk = document.getElementById('inputDialogOk');
let inputDialogResolver = null;

function closeInputDialog(result) {
  inputDialog.classList.add('hidden');
  inputDialog.setAttribute('aria-hidden', 'true');
  const resolver = inputDialogResolver;
  inputDialogResolver = null;
  if (resolver) resolver(result);
}

function openInputDialog({ title = '输入', hint = '', fields = [] } = {}) {
  return new Promise((resolve) => {
    // 若已有未完成的对话框，先 cancel
    if (inputDialogResolver) {
      const prev = inputDialogResolver;
      inputDialogResolver = null;
      prev(null);
    }
    inputDialogResolver = resolve;

    inputDialogTitle.textContent = title;
    inputDialogHint.textContent = hint || '';
    inputDialogHint.style.display = hint ? '' : 'none';
    inputDialogFields.innerHTML = '';

    const inputs = [];
    fields.forEach((field, index) => {
      const wrap = document.createElement('div');
      wrap.className = 'field';
      const label = document.createElement('span');
      label.textContent = field.label || `字段 ${index + 1}`;
      wrap.appendChild(label);
      const input = document.createElement('input');
      input.type = 'text';
      input.value = field.default != null ? String(field.default) : '';
      input.placeholder = field.placeholder || '';
      input.dataset.name = field.name || `field_${index}`;
      wrap.appendChild(input);
      inputDialogFields.appendChild(wrap);
      inputs.push(input);

      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          submit();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          cancel();
        }
      });
    });

    inputDialog.classList.remove('hidden');
    inputDialog.setAttribute('aria-hidden', 'false');
    if (inputs[0]) {
      setTimeout(() => { inputs[0].focus(); inputs[0].select(); }, 0);
    }

    function submit() {
      const result = {};
      inputs.forEach((input) => {
        result[input.dataset.name] = input.value;
      });
      closeInputDialog(result);
    }

    function cancel() {
      closeInputDialog(null);
    }

    inputDialogOk.onclick = submit;
    inputDialogCancel.onclick = cancel;
    const backdrop = inputDialog.querySelector('[data-cancel-input="true"]');
    if (backdrop) backdrop.onclick = cancel;
  });
}

async function executePrint() {
  if (!printerSelect.value) {
    setStatus('没有可用打印机', 'error');
    return;
  }

  const result = await window.mmeApi.printHtml({
    deviceName: printerSelect.value,
    html: buildPrintDocumentHtml(printContentSelect.value)
  });

  if (result.ok) {
    setStatus(`已发送到打印机: ${printerSelect.value}`, 'ok');
    closePrintDialog();
  } else {
    setStatus(`打印失败: ${result.error}`, 'error');
  }
}

function isLikelyMermaidText(content) {
  return /^(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram|journey|gantt|pie)\b/m.test(content);
}

// 扩展名 → 文件种类（优先于内容启发）
function classifyFileByExtension(extension) {
  const ext = (extension || '').toLowerCase();
  if (ext === '.md' || ext === '.markdown') return 'markdown';
  if (ext === '.mmd' || ext === '.mermaid') return 'mermaid';
  if (ext === '.json') return 'project';
  return 'unknown';
}

function parseProjectFile(content, extension) {
  if (extension !== '.json') {
    return null;
  }

  try {
    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    const mermaid = typeof parsed.mermaid === 'string' ? parsed.mermaid : '';
    const markdown = typeof parsed.markdown === 'string' ? parsed.markdown : '';
    if (!mermaid && !markdown) {
      return null;
    }

    return { mermaid, markdown };
  } catch {
    return null;
  }
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function escapeSelector(value) {
  if (window.CSS && typeof window.CSS.escape === 'function') {
    return window.CSS.escape(value);
  }

  return String(value).replace(/([#.;?+*~':"!^$\[\]()=>|/@])/g, '\\$1');
}

function parseTranslate(transformText) {
  const value = transformText || '';
  const match = value.match(/translate\(\s*([-\d.eE+]+)\s*[ ,]\s*([-\d.eE+]+)\s*\)/i);
  if (!match) {
    return { x: 0, y: 0 };
  }

  return {
    x: Number(match[1]) || 0,
    y: Number(match[2]) || 0
  };
}

function readElementTranslate(element) {
  if (!element) {
    return { x: 0, y: 0 };
  }

  try {
    const list = element.transform && element.transform.baseVal;
    if (list && list.numberOfItems > 0) {
      const consolidated = list.consolidate();
      const matrix = (consolidated && consolidated.matrix) || list.getItem(0).matrix;
      if (matrix) {
        return { x: matrix.e || 0, y: matrix.f || 0 };
      }
    }
  } catch {
    // Fall through to attribute parsing.
  }

  return parseTranslate(element.getAttribute('transform'));
}

function setElementTranslate(element, x, y) {
  element.setAttribute('transform', `translate(${x}, ${y})`);
}

// 收集一个 SVG 元素的自身 + 所有祖先 g.cluster 的 nodeKey，按从内到外顺序返回（去重）
function collectAncestorClusterKeys(element) {
  const keys = [];
  if (!element) return keys;
  const seen = new Set();
  const addKey = (k) => {
    if (!k || seen.has(k)) return;
    seen.add(k);
    keys.push(k);
  };
  addKey(getNodeKey(element));
  let cur = element.parentElement;
  while (cur && cur.nodeName && cur.nodeName.toLowerCase() !== 'svg') {
    if (cur.classList && cur.classList.contains('cluster')) {
      addKey(getNodeKey(cur));
    }
    cur = cur.parentElement;
  }
  return keys;
}

// 从当前 SVG 中移除一条连线对应的 DOM 元素：path 本身、可能挂在其 parent g.edgePath 上的 label、
// 以及一些辅助装饰（比如拖拽手柄 circle、拖拽 overlay path）。用于"删除连线但不重渲染"场景。
function removeEdgeDomArtifacts(entry) {
  if (!entry) return;
  const pathEl = entry.pathElement;
  if (!pathEl) return;
  const parent = pathEl.parentNode;
  // Mermaid 把每条 edge 组织在 <g class="edgePath"> 下（里面含 path + label 等）。若 parent 就是 edgePath，
  // 整体移除更干净；否则只移除 path 自身。
  if (parent && parent.classList && (parent.classList.contains('edgePath') || parent.classList.contains('edgePaths'))) {
    if (parent.classList.contains('edgePaths')) {
      // path 直接挂在 edgePaths 容器里，只删 path
      parent.removeChild(pathEl);
    } else {
      // parent 是单条 edgePath <g>，整体移除
      parent.parentNode && parent.parentNode.removeChild(parent);
    }
  } else if (parent) {
    parent.removeChild(pathEl);
  }
  // 同时尝试移除我们自己绑的拖拽手柄（如果有）
  const handleId = `edge-handle-${entry.edgeId}`;
  const svg = pathEl.ownerSVGElement || (parent && parent.ownerSVGElement);
  if (svg) {
    const handle = svg.querySelector(`#${CSS.escape(handleId)}`);
    if (handle && handle.parentNode) handle.parentNode.removeChild(handle);
  }
  // 尝试移除 edgeLabels 容器中对应的 label
  if (svg) {
    const labels = svg.querySelectorAll('g.edgeLabels g.edgeLabel, g.edgeLabels .edgeLabel');
    labels.forEach((lab) => {
      const labelId = lab.getAttribute('id') || '';
      if (labelId && entry.edgeId && (labelId === entry.edgeId || labelId.includes(entry.edgeId))) {
        lab.parentNode && lab.parentNode.removeChild(lab);
      }
    });
  }
}

// 从当前 SVG 中精准移除一个子图（cluster）+ 它内部的所有节点 + 与这些节点相关的所有连线。
// 用于"删除子图但不重渲染"场景，保证其余 DOM 元素一字不动。
// 采用"几何包含"策略判断哪些节点属于该 cluster：中心点落在 cluster 的屏幕 BBox 内视为内部节点。
// 返回实际被删除的内部节点源码 key 集合，供调用方用于源码 edge 行清理。
function removeClusterDomArtifacts(clusterElement, usedKey) {
  const svg = (clusterElement && clusterElement.ownerSVGElement)
    || mermaidPreview.querySelector('svg');
  if (!svg) return new Set();

  // 1. 定位 cluster 元素
  let cluster = clusterElement && svg.contains(clusterElement) ? clusterElement : null;
  if (!cluster && usedKey) {
    cluster = Array.from(svg.querySelectorAll('g.cluster')).find((c) => {
      const rid = c.getAttribute('id') || '';
      const did = c.getAttribute('data-id') || '';
      if (did === usedKey || rid === usedKey || rid.endsWith('-' + usedKey)) return true;
      try {
        if (manualLayoutState.clusterSourceIds && manualLayoutState.clusterSourceIds.get(c) === usedKey) return true;
      } catch {}
      return false;
    }) || null;
  }
  if (!cluster) return new Set();

  // 2. 用 cluster 屏幕 BBox 几何包含其他 g.node，判定"属于该 cluster 的内部节点"
  const cRect = cluster.getBoundingClientRect();
  const innerNodes = Array.from(svg.querySelectorAll('g.node')).filter((n) => {
    const nr = n.getBoundingClientRect();
    if (nr.width === 0 && nr.height === 0) return false;
    const cx = nr.left + nr.width / 2;
    const cy = nr.top + nr.height / 2;
    return cx >= cRect.left && cx <= cRect.right && cy >= cRect.top && cy <= cRect.bottom;
  });
  // 同样几何判定：嵌套在 cluster 内的 g.cluster（子子图）
  const innerClusters = Array.from(svg.querySelectorAll('g.cluster')).filter((c) => {
    if (c === cluster) return false;
    const nr = c.getBoundingClientRect();
    if (nr.width === 0 && nr.height === 0) return false;
    const cx = nr.left + nr.width / 2;
    const cy = nr.top + nr.height / 2;
    return cx >= cRect.left && cx <= cRect.right && cy >= cRect.top && cy <= cRect.bottom;
  });

  // 3. 从 DOM 节点反查源码 key（通过 data-id / id 末段 / clusterSourceIds）
  const insideKeys = new Set();
  const deriveNodeKey = (el) => {
    const did = el.getAttribute('data-id') || '';
    if (did) return did;
    const rid = el.getAttribute('id') || '';
    const m = rid.match(/(?:^|-)flowchart-(.+?)-\d+$/);
    if (m) return m[1];
    return '';
  };
  innerNodes.forEach((n) => {
    const k = deriveNodeKey(n);
    if (k) insideKeys.add(k);
  });
  innerClusters.forEach((c) => {
    try {
      const k = manualLayoutState.clusterSourceIds && manualLayoutState.clusterSourceIds.get(c);
      if (k) insideKeys.add(k);
    } catch {}
  });

  // 4. 找到与这些节点相关的 edge path / edgeLabel —— 优先通过 edgeRegistry 的 DOM 端点判断
  const nodeElSet = new Set([...innerNodes, ...innerClusters, cluster]);
  const relatedPaths = new Set();
  manualLayoutState.edgeRegistry.forEach((entry) => {
    if (nodeElSet.has(entry.sourceEl) || nodeElSet.has(entry.targetEl)) {
      relatedPaths.add(entry.pathElement);
    }
  });
  // 补一轮：edgeLabel 按包含节点 key 识别
  const keyRegexes = Array.from(insideKeys).map((k) => {
    const esc = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[-_])${esc}([-_]|$)`);
  });
  const edgeLabelsToRemove = Array.from(svg.querySelectorAll('g.edgeLabels > g'))
    .filter((l) => {
      const lid = l.getAttribute('id') || '';
      return keyRegexes.some((r) => r.test(lid));
    });

  // 5. 执行移除
  const removeFromDom = (el) => {
    if (el && el.parentNode) el.parentNode.removeChild(el);
  };
  relatedPaths.forEach((p) => {
    if (p && p.parentNode) {
      const parent = p.parentNode;
      if (parent.classList && parent.classList.contains('edgePath')) {
        removeFromDom(parent);
      } else {
        removeFromDom(p);
      }
    }
  });
  edgeLabelsToRemove.forEach(removeFromDom);
  innerNodes.forEach(removeFromDom);
  innerClusters.forEach(removeFromDom);
  removeFromDom(cluster);

  // 6. 清理 edgeRegistry
  manualLayoutState.edgeRegistry = manualLayoutState.edgeRegistry.filter((e) => !relatedPaths.has(e.pathElement));

  // 7. 清理 nodePositions / clusterSizes
  insideKeys.forEach((k) => {
    manualLayoutState.nodePositions.delete(k);
    manualLayoutState.clusterSizes.delete(k);
  });
  if (usedKey) {
    manualLayoutState.nodePositions.delete(usedKey);
    manualLayoutState.clusterSizes.delete(usedKey);
  }

  // 8. 清理空壳 pasted-cluster-wrapper
  svg.querySelectorAll('g.pasted-cluster-wrapper').forEach((w) => {
    if (!w.querySelector('g.node, g.cluster')) removeFromDom(w);
  });

  // 9. 重新收缩 viewBox
  try { fitSvgViewBox(svg); } catch {}

  return insideKeys;
}

// 从当前 SVG 中精准移除一个节点 + 与该节点相连的所有边。用于"删除/剪切单节点但不重渲染"。
// 返回被移除的 pathElement 集合（调用方可按需清理）。
function removeNodeDomArtifacts(nodeElement, nodeKey) {
  const svg = (nodeElement && nodeElement.ownerSVGElement)
    || mermaidPreview.querySelector('svg');
  if (!svg) return new Set();

  // 1. 定位节点元素
  let node = nodeElement && svg.contains(nodeElement) ? nodeElement : null;
  if (!node && nodeKey) {
    node = Array.from(svg.querySelectorAll('g.node')).find((n) => {
      const did = n.getAttribute('data-id') || '';
      const rid = n.getAttribute('id') || '';
      if (did === nodeKey) return true;
      const m = rid.match(/(?:^|-)flowchart-(.+?)-\d+$/);
      return m && m[1] === nodeKey;
    }) || null;
  }
  if (!node) return new Set();

  // 2. 找与该节点相关的所有 edge path
  const relatedPaths = new Set();
  manualLayoutState.edgeRegistry.forEach((entry) => {
    if (entry.sourceEl === node || entry.targetEl === node
        || entry.sourceKey === nodeKey || entry.targetKey === nodeKey) {
      relatedPaths.add(entry.pathElement);
    }
  });
  // 补一轮：id 字符串含 nodeKey 的 path（覆盖 registry 漏记）
  if (nodeKey) {
    const esc = nodeKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const keyRe = new RegExp(`(^|[-_])${esc}([-_]|$)`);
    svg.querySelectorAll('g.edgePaths > path, g.edgePaths > g').forEach((p) => {
      if (keyRe.test(p.getAttribute('id') || '')) relatedPaths.add(p);
    });
  }

  // 3. 收集要移除的 edgeLabel
  const edgeLabelsToRemove = [];
  if (nodeKey) {
    const esc = nodeKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const keyRe = new RegExp(`(^|[-_])${esc}([-_]|$)`);
    svg.querySelectorAll('g.edgeLabels > g').forEach((l) => {
      if (keyRe.test(l.getAttribute('id') || '')) edgeLabelsToRemove.push(l);
    });
  }

  // 4. 执行移除
  const removeFromDom = (el) => {
    if (el && el.parentNode) el.parentNode.removeChild(el);
  };
  relatedPaths.forEach((p) => {
    if (p && p.parentNode) {
      const parent = p.parentNode;
      if (parent.classList && parent.classList.contains('edgePath')) {
        removeFromDom(parent);
      } else {
        removeFromDom(p);
      }
    }
  });
  edgeLabelsToRemove.forEach(removeFromDom);
  removeFromDom(node);

  // 5. 清理 edgeRegistry / nodePositions
  manualLayoutState.edgeRegistry = manualLayoutState.edgeRegistry.filter((e) => !relatedPaths.has(e.pathElement));
  if (nodeKey) {
    manualLayoutState.nodePositions.delete(nodeKey);
  }

  // 6. 收缩 viewBox
  try { fitSvgViewBox(svg); } catch {}

  return relatedPaths;
}

// 离屏渲染整图，抽取单个新增节点 DOM，移植到当前 SVG 的右侧空白区。
// 用于"粘贴节点但不重渲染"。失败返回 false，调用方回退到全量 render。
async function pasteNodeInPlace(newNodeKey) {
  const baseSvg = mermaidPreview.querySelector('svg');
  if (!baseSvg) return false;
  const rootG = baseSvg.querySelector(':scope > g');
  if (!rootG) return false;
  const code = mermaidEditor.value.trim();
  if (!code) return false;

  const off = document.createElement('div');
  off.style.cssText = 'position:absolute;left:-99999px;top:-99999px;visibility:hidden;';
  document.body.appendChild(off);
  let fullSvg = null;
  try {
    const tmpId = `mmd_off_${Date.now()}`;
    const { svg: fullStr } = await mermaidApi.render(tmpId, code);
    off.innerHTML = fullStr;
    fullSvg = off.querySelector('svg');
  } catch {
    off.remove();
    return false;
  }
  if (!fullSvg) { off.remove(); return false; }

  try {
    // 找新节点
    const newNode = Array.from(fullSvg.querySelectorAll('g.node')).find((n) => {
      const rid = n.getAttribute('id') || '';
      const did = n.getAttribute('data-id') || '';
      if (did === newNodeKey || rid === newNodeKey) return true;
      const m = rid.match(/(?:^|-)flowchart-(.+?)-\d+$/);
      return m && m[1] === newNodeKey;
    });
    if (!newNode) return false;

    // 计算偏移：把新节点贴到当前内容右侧 + 60 间距
    const baseBox = getContentBBox(baseSvg);
    const newBox = getSubsetBBox([newNode]);
    if (!newBox) return false;
    const gap = 60;
    const dx = (baseBox ? (baseBox.x + baseBox.width + gap) : 0) - newBox.x;
    const dy = (baseBox ? baseBox.y : 0) - newBox.y;

    const NS = 'http://www.w3.org/2000/svg';
    const wrapper = document.createElementNS(NS, 'g');
    wrapper.setAttribute('class', 'pasted-node-wrapper');
    wrapper.setAttribute('transform', `translate(${dx}, ${dy})`);
    const nodesG = document.createElementNS(NS, 'g');
    nodesG.setAttribute('class', 'nodes');
    nodesG.appendChild(newNode);
    wrapper.appendChild(nodesG);
    rootG.appendChild(wrapper);

    try { enableManualLayout(baseSvg); } catch (e) { console.warn('enableManualLayout after paste node failed', e); }
    try { fitSvgViewBox(baseSvg); } catch {}
    return true;
  } finally {
    off.remove();
  }
}

// 扫描源码，删除"引用了给定节点 ID 集合"的所有 edge 行（含箭头符号如 --> / --- / ==> / -.-> 等）。
// 用于子图删除后清理写在 subgraph block 外面的跨子图连线，防止留下悬挂引用。
function stripEdgesReferencingIds(source, insideIds) {
  if (!source || !insideIds || insideIds.size === 0) return source;
  const keys = Array.from(insideIds).filter(Boolean);
  if (keys.length === 0) return source;
  const escKeys = keys.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const idRe = new RegExp(`(?<![A-Za-z0-9_\\u4e00-\\u9fff])(?:${escKeys.join('|')})(?![A-Za-z0-9_\\u4e00-\\u9fff])`);
  // edge 箭头标记：--- / --> / -.-> / ==> / -- text -->, 等；粗略判断行内含典型箭头即可
  const arrowRe = /(-{1,3}\s*-{0,2}>|-{2,3}[ox]|={2,3}>|={2,3}[ox]|-\.+->|-\.+-|~~~>|\s---\s|\s--\s)/;
  const lines = source.split(/\r?\n/);
  const kept = [];
  for (const line of lines) {
    // 跳过 Mermaid 注释行，防止误杀形如 `%% A --> B` 这种包含箭头的注释
    if (/^\s*%%/.test(line)) { kept.push(line); continue; }
    if (arrowRe.test(line) && idRe.test(line)) {
      // 这是一个引用了待删 ID 的 edge 行 → 整行丢弃
      continue;
    }
    kept.push(line);
  }
  return kept.join('\n');
}

// 尝试删除 (sourceKey, targetKey) 连线，如失败则回退尝试祖先 cluster 组合，
// 返回 { source, sourceKey, targetKey, usedSource, usedTarget }
function removeEdgeWithFallback(source, entry) {
  const { sourceKey, targetKey, sourceEl, targetEl } = entry;
  let after = removeEdgeFromSource(source, sourceKey, targetKey);
  if (after !== source) {
    return { after, usedSource: sourceKey, usedTarget: targetKey };
  }
  const sCandidates = collectAncestorClusterKeys(sourceEl);
  const tCandidates = collectAncestorClusterKeys(targetEl);
  if (sCandidates.length === 0) sCandidates.push(sourceKey);
  if (tCandidates.length === 0) tCandidates.push(targetKey);
  for (const sk of sCandidates) {
    for (const tk of tCandidates) {
      if (sk === sourceKey && tk === targetKey) continue;
      const trial = removeEdgeFromSource(source, sk, tk);
      if (trial !== source) {
        return { after: trial, usedSource: sk, usedTarget: tk };
      }
    }
  }
  return { after: source, usedSource: sourceKey, usedTarget: targetKey };
}

function getElementPointInSvg(svg, element, x, y) {
  const point = svg.createSVGPoint();
  point.x = x;
  point.y = y;
  return point.matrixTransform(element.getCTM());
}

function getElementPointInFrame(frame, element, x, y) {
  const svg = element.ownerSVGElement || frame.ownerSVGElement;
  const point = svg.createSVGPoint();
  point.x = x;
  point.y = y;
  const frameCTM = frame && frame.getCTM ? frame.getCTM() : null;
  const elementCTM = element.getCTM();
  if (!frameCTM || !elementCTM) {
    return point.matrixTransform(elementCTM || svg.createSVGMatrix());
  }
  return point.matrixTransform(frameCTM.inverse().multiply(elementCTM));
}

function transformPointBetweenFrames(sourceFrame, targetFrame, x, y) {
  const svg = sourceFrame.ownerSVGElement || targetFrame.ownerSVGElement;
  const point = svg.createSVGPoint();
  point.x = x;
  point.y = y;
  const sourceCTM = sourceFrame.getCTM();
  const targetCTM = targetFrame.getCTM();
  if (!sourceCTM || !targetCTM) {
    return { x, y };
  }
  return point.matrixTransform(targetCTM.inverse().multiply(sourceCTM));
}

function getElementBoxInFrame(frame, element) {
  const bbox = element.getBBox();
  const corners = [
    getElementPointInFrame(frame, element, bbox.x, bbox.y),
    getElementPointInFrame(frame, element, bbox.x + bbox.width, bbox.y),
    getElementPointInFrame(frame, element, bbox.x, bbox.y + bbox.height),
    getElementPointInFrame(frame, element, bbox.x + bbox.width, bbox.y + bbox.height)
  ];
  const xs = corners.map((point) => point.x);
  const ys = corners.map((point) => point.y);
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);

  return {
    left,
    right,
    top,
    bottom,
    width: right - left,
    height: bottom - top,
    center: {
      x: (left + right) / 2,
      y: (top + bottom) / 2
    }
  };
}

function getElementBoxInSvg(svg, element) {
  const bbox = element.getBBox();
  const corners = [
    getElementPointInSvg(svg, element, bbox.x, bbox.y),
    getElementPointInSvg(svg, element, bbox.x + bbox.width, bbox.y),
    getElementPointInSvg(svg, element, bbox.x, bbox.y + bbox.height),
    getElementPointInSvg(svg, element, bbox.x + bbox.width, bbox.y + bbox.height)
  ];

  const xs = corners.map((point) => point.x);
  const ys = corners.map((point) => point.y);
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);

  return {
    left,
    right,
    top,
    bottom,
    width: right - left,
    height: bottom - top,
    center: {
      x: (left + right) / 2,
      y: (top + bottom) / 2
    }
  };
}

function chooseAnchor(box, towardPoint) {
  const dx = towardPoint.x - box.center.x;
  const dy = towardPoint.y - box.center.y;
  const horizontal = Math.abs(dx) >= Math.abs(dy);

  if (horizontal) {
    return {
      x: dx >= 0 ? box.right : box.left,
      y: clamp(towardPoint.y, box.top + 8, box.bottom - 8)
    };
  }

  return {
    x: clamp(towardPoint.x, box.left + 8, box.right - 8),
    y: dy >= 0 ? box.bottom : box.top
  };
}

function findDiagramNode(svg, nodeKey) {
  if (!nodeKey) {
    return null;
  }

  const cached = manualLayoutState.nodeRegistry.get(nodeKey);
  if (cached && svg.contains(cached)) {
    return cached;
  }

  const escaped = escapeSelector(nodeKey);
  const candidates = [
    `g.node[data-id="${escaped}"]`,
    `g.cluster[data-id="${escaped}"]`,
    `g.node[id="${escaped}"]`,
    `g.cluster[id="${escaped}"]`,
    `g.node[id^="flowchart-${escaped}-"]`,
    `g.cluster[id^="flowchart-${escaped}-"]`,
    `g.node[id$="-${escaped}"]`,
    `[data-id="${escaped}"]`,
    `[id="${escaped}"]`
  ];

  for (const selector of candidates) {
    const found = svg.querySelector(selector);
    if (found) {
      return found;
    }
  }

  return null;
}

function extractEdgeMeta(pathElement) {
  const classNames = [
    pathElement.getAttribute('class') || '',
    pathElement.parentElement?.getAttribute('class') || ''
  ].join(' ');
  let source = classNames.match(/\bLS-([^\s]+)/)?.[1] || '';
  let target = classNames.match(/\bLE-([^\s]+)/)?.[1] || '';

  if (!source || !target) {
    const ids = [
      pathElement.getAttribute('id') || '',
      pathElement.parentElement?.getAttribute('id') || ''
    ];
    for (const rawId of ids) {
      if (!rawId) continue;
      // Mermaid 生成的边 id 形如 L_source_target_idx 或 L-source-target-idx
      const m = rawId.match(/^L[-_](.+?)[-_](.+?)(?:[-_]\d+)?$/);
      if (m) {
        source = source || m[1];
        target = target || m[2];
        if (source && target) break;
      }
    }
  }

  const edgeId = pathElement.getAttribute('data-id')
    || pathElement.parentElement?.getAttribute('data-id')
    || pathElement.getAttribute('id')
    || pathElement.parentElement?.getAttribute('id')
    || (source && target ? `${source}__${target}` : '');

  return { source, target, edgeId };
}

function getEdgePathElements(svg) {
  return Array.from(svg.querySelectorAll('.edgePath > .path, .edgePaths > path, path.flowchart-link'));
}

function getPathEndpointsInFrame(pathElement, frame) {
  try {
    const total = pathElement.getTotalLength();
    if (!total || !Number.isFinite(total)) {
      return null;
    }
    const startLocal = pathElement.getPointAtLength(0);
    const endLocal = pathElement.getPointAtLength(total);
    const pathFrame = pathElement.parentNode || frame;
    const start = transformPointBetweenFrames(pathFrame, frame, startLocal.x, startLocal.y);
    const end = transformPointBetweenFrames(pathFrame, frame, endLocal.x, endLocal.y);
    return { start, end };
  } catch {
    return null;
  }
}

function distanceToBox(box, point) {
  const dx = Math.max(box.left - point.x, 0, point.x - box.right);
  const dy = Math.max(box.top - point.y, 0, point.y - box.bottom);
  return Math.sqrt(dx * dx + dy * dy);
}

function findNearestNodeByPoint(svg, frame, point, excludeElement) {
  const candidates = Array.from(svg.querySelectorAll('g.node'));
  let best = null;
  let bestDist = Infinity;
  candidates.forEach((node) => {
    if (node === excludeElement) return;
    const box = getElementBoxInFrame(frame, node);
    const dist = distanceToBox(box, point);
    if (dist < bestDist) {
      bestDist = dist;
      best = node;
    }
  });
  return best;
}

function getNodeKey(element) {
  if (!element) return '';
  // 优先使用 cluster 源码映射（确保与 mermaidEditor 源码完全一致）
  if (manualLayoutState.clusterSourceIds && manualLayoutState.clusterSourceIds.has(element)) {
    return manualLayoutState.clusterSourceIds.get(element);
  }
  const dataId = element.getAttribute('data-id');
  if (dataId) return dataId;
  const rawId = element.getAttribute('id') || '';
  // Mermaid 生成的 id 可能形如 `flowchart-<uid>-<idx>`，
  // 或带上 svg 前缀 `<svgId>-flowchart-<uid>-<idx>`（v11 节点）。
  const m = rawId.match(/(?:^|-)flowchart-(.+)-\d+$/);
  if (m) return m[1];
  // subgraph/cluster 形如 `<svgId>-<uid>`，例如 `mmd_1777440747347-SG7321`
  const mCluster = rawId.match(/^mmd_\d+-(.+)$/);
  if (mCluster) return mCluster[1];
  return rawId;
}

// 扫描源码所有 `subgraph <ID>` 定义，与 DOM 中 g.cluster 按文档顺序配对
// 解决 Mermaid 不同版本 cluster id 格式差异导致解析失败的问题。
function indexClustersBySource(svg, source) {
  manualLayoutState.clusterSourceIds = new WeakMap();
  manualLayoutState.nodeIsCluster = new WeakSet();
  if (!svg) return;
  const src = String(source || '');
  // 提取源码中所有 subgraph（按顺序），同时取 ID 与 title
  const subgraphs = [];
  const re = /\bsubgraph\s+("[^"]+"|'[^']+'|[^\s\[\(\{;\r\n]+)(?:\s*\[\s*"?([^"\]]+)"?\s*\])?/g;
  let m;
  while ((m = re.exec(src))) {
    let id = m[1];
    if ((id.startsWith('"') && id.endsWith('"')) || (id.startsWith('\'') && id.endsWith('\''))) {
      id = id.slice(1, -1);
    }
    const title = (m[2] || id).trim();
    subgraphs.push({ id, title });
  }
  const clusters = Array.from(svg.querySelectorAll('g.cluster'));
  const matchedCluster = new Set();
  const matchedSg = new Set();
  // 第一轮：按 DOM id 内包含的 subgraph ID 精确匹配。
  clusters.forEach((cluster, ci) => {
    const rawId = cluster.getAttribute('id') || '';
    const dataId = cluster.getAttribute('data-id') || '';
    for (let si = 0; si < subgraphs.length; si++) {
      if (matchedSg.has(si)) continue;
      const sgId = subgraphs[si].id;
      const esc = sgId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (
        dataId === sgId ||
        rawId === sgId ||
        new RegExp('(^|-)' + esc + '(-\\d+)?$').test(rawId) ||
        new RegExp('(^|-)flowchart-' + esc + '-\\d+$').test(rawId)
      ) {
        manualLayoutState.clusterSourceIds.set(cluster, sgId);
        matchedCluster.add(ci);
        matchedSg.add(si);
        break;
      }
    }
  });
  // 第二轮：剩余 cluster 按文档顺序配对剩余 subgraph。
  let sgCursor = 0;
  clusters.forEach((cluster, ci) => {
    if (matchedCluster.has(ci)) return;
    while (sgCursor < subgraphs.length && matchedSg.has(sgCursor)) sgCursor++;
    if (sgCursor < subgraphs.length) {
      manualLayoutState.clusterSourceIds.set(cluster, subgraphs[sgCursor].id);
      matchedSg.add(sgCursor);
      sgCursor++;
    }
  });
  // 对未能映射到 g.cluster 的 subgraph（如空 subgraph 被 Mermaid 渲染为普通 node）
  // 在 g.node 中按 ID/title 查找，标记为 “伪装为 node 的 cluster”。
  const pending = subgraphs.filter((_, idx) => !matchedSg.has(idx));
  if (pending.length) {
    const nodes = Array.from(svg.querySelectorAll('g.node'));
    pending.forEach((sg) => {
      const match = nodes.find((n) => {
        if (manualLayoutState.nodeIsCluster.has(n)) return false;
        const nid = n.getAttribute('id') || '';
        const ndata = n.getAttribute('data-id') || '';
        const txt = (n.textContent || '').trim();
        return (
          (nid && (nid === sg.id || nid.endsWith('-' + sg.id) || nid.includes('-' + sg.id + '-') || nid.endsWith('-' + sg.id + '-0'))) ||
          (ndata && ndata === sg.id) ||
          (txt && txt === sg.title)
        );
      });
      if (match) {
        manualLayoutState.clusterSourceIds.set(match, sg.id);
        manualLayoutState.nodeIsCluster.add(match);
      }
    });
  }
}

function buildRegistries(svg) {
  manualLayoutState.nodeRegistry.clear();
  manualLayoutState.edgeRegistry = [];

  // 建立 cluster DOM 元素 -> 源码 subgraph ID 的顺序映射
  indexClustersBySource(svg, (typeof mermaidEditor !== 'undefined' && mermaidEditor) ? mermaidEditor.value : '');

  Array.from(svg.querySelectorAll('g.node, g.cluster')).forEach((element) => {
    const dataId = element.getAttribute('data-id');
    const rawId = element.getAttribute('id') || '';
    const keys = new Set();
    if (dataId) keys.add(dataId);
    if (rawId) {
      keys.add(rawId);
      const m = rawId.match(/(?:^|-)flowchart-(.+)-\d+$/);
      if (m) keys.add(m[1]);
      const mCluster = rawId.match(/^mmd_\d+-(.+)$/);
      if (mCluster) keys.add(mCluster[1]);
    }
    keys.forEach((key) => {
      if (!manualLayoutState.nodeRegistry.has(key)) {
        manualLayoutState.nodeRegistry.set(key, element);
      }
    });
  });

  const paths = getEdgePathElements(svg);
  paths.forEach((pathElement, index) => {
    const frame = pathElement.parentNode || svg;
    const endpoints = getPathEndpointsInFrame(pathElement, frame);
    if (!endpoints) return;

    const sourceEl = findNearestNodeByPoint(svg, frame, endpoints.start, null);
    const targetEl = findNearestNodeByPoint(svg, frame, endpoints.end, sourceEl);
    if (!sourceEl || !targetEl) return;

    const sourceKey = getNodeKey(sourceEl) || `__src_${index}`;
    const targetKey = getNodeKey(targetEl) || `__tgt_${index}`;
    const edgeId = pathElement.getAttribute('id')
      || pathElement.parentElement?.getAttribute('id')
      || `${sourceKey}__${targetKey}__${index}`;

    manualLayoutState.edgeRegistry.push({
      pathElement,
      edgeId,
      sourceKey,
      targetKey,
      sourceEl,
      targetEl
    });
  });
}

function buildEdgePath(start, end, midpoint) {
  if (midpoint) {
    return `M ${start.x},${start.y} Q ${midpoint.x},${midpoint.y} ${end.x},${end.y}`;
  }

  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    const offset = Math.max(Math.abs(dx) * 0.38, 48);
    return `M ${start.x},${start.y} C ${start.x + Math.sign(dx || 1) * offset},${start.y} ${end.x - Math.sign(dx || 1) * offset},${end.y} ${end.x},${end.y}`;
  }

  const offset = Math.max(Math.abs(dy) * 0.38, 48);
  return `M ${start.x},${start.y} C ${start.x},${start.y + Math.sign(dy || 1) * offset} ${end.x},${end.y - Math.sign(dy || 1) * offset} ${end.x},${end.y}`;
}

function updateEdgeLabel(svg, edgeId, start, end, midpoint, edgeFrame) {
  const labelAnchor = midpoint || {
    x: (start.x + end.x) / 2,
    y: (start.y + end.y) / 2
  };
  const labelNode = svg.querySelector(`.edgeLabel .label[data-id="${escapeSelector(edgeId)}"]`);
  const labelGroup = labelNode ? labelNode.closest('.edgeLabel') : null;

  if (labelGroup && labelGroup.parentNode && edgeFrame) {
    const labelParent = labelGroup.parentNode;
    const localAnchor = transformPointBetweenFrames(edgeFrame, labelParent, labelAnchor.x, labelAnchor.y);
    labelGroup.setAttribute('transform', `translate(${localAnchor.x}, ${localAnchor.y})`);
  } else if (labelGroup) {
    labelGroup.setAttribute('transform', `translate(${labelAnchor.x}, ${labelAnchor.y})`);
  }
}

function updateEdgePath(svg, pathElement) {
  const meta = extractEdgeMeta(pathElement);
  if (!meta.source || !meta.target) {
    return;
  }

  const sourceNode = findDiagramNode(svg, meta.source);
  const targetNode = findDiagramNode(svg, meta.target);
  if (!sourceNode || !targetNode) {
    return;
  }

  const frame = pathElement.parentNode || svg;
  const sourceBox = getElementBoxInFrame(frame, sourceNode);
  const targetBox = getElementBoxInFrame(frame, targetNode);
  const start = chooseAnchor(sourceBox, targetBox.center);
  const end = chooseAnchor(targetBox, sourceBox.center);
  const midpoint = manualLayoutState.edgeMidpoints.get(meta.edgeId);
  pathElement.setAttribute('d', buildEdgePath(start, end, midpoint));
  updateEdgeLabel(svg, meta.edgeId, start, end, midpoint, frame);
}

function updateEdgeEntry(svg, entry) {
  const pathElement = entry.pathElement;
  if (!pathElement || !svg.contains(pathElement)) {
    return;
  }
  const sourceNode = svg.contains(entry.sourceEl) ? entry.sourceEl : findDiagramNode(svg, entry.sourceKey);
  const targetNode = svg.contains(entry.targetEl) ? entry.targetEl : findDiagramNode(svg, entry.targetKey);
  if (!sourceNode || !targetNode) {
    return;
  }
  entry.sourceEl = sourceNode;
  entry.targetEl = targetNode;

  const frame = pathElement.parentNode || svg;
  const sourceBox = getElementBoxInFrame(frame, sourceNode);
  const targetBox = getElementBoxInFrame(frame, targetNode);
  const start = chooseAnchor(sourceBox, targetBox.center);
  const end = chooseAnchor(targetBox, sourceBox.center);
  const midpoint = manualLayoutState.edgeMidpoints.get(entry.edgeId);
  pathElement.setAttribute('d', buildEdgePath(start, end, midpoint));
  updateEdgeLabel(svg, entry.edgeId, start, end, midpoint, frame);
}

function refreshEdgesForNode(svg, nodeKey) {
  manualLayoutState.edgeRegistry.forEach((entry) => {
    if (entry.sourceKey === nodeKey || entry.targetKey === nodeKey) {
      updateEdgeEntry(svg, entry);
    }
  });
}

function refreshAllEdges(svg) {
  manualLayoutState.edgeRegistry.forEach((entry) => updateEdgeEntry(svg, entry));
}

function clientPointToSvg(svg, clientX, clientY) {
  const point = svg.createSVGPoint();
  point.x = clientX;
  point.y = clientY;
  return point.matrixTransform(svg.getScreenCTM().inverse());
}

function isBoxInside(containerBox, childBox, tolerance = 10) {
  return childBox.left >= containerBox.left - tolerance
    && childBox.right <= containerBox.right + tolerance
    && childBox.top >= containerBox.top - tolerance
    && childBox.bottom <= containerBox.bottom + tolerance;
}

function collectDragTargets(svg, element) {
  const nodeKey = getNodeKey(element) || element.getAttribute('data-id') || element.id;
  if (!nodeKey) {
    return {
      targets: [],
      affectedNodeKeys: []
    };
  }

  const targets = [];
  const seen = new Set();
  const affectedNodeKeys = new Set();
  const basePosition = manualLayoutState.nodePositions.get(nodeKey) || readElementTranslate(element);
  targets.push({
    element,
    nodeKey,
    startPosition: basePosition
  });
  seen.add(nodeKey);
  affectedNodeKeys.add(nodeKey);

  if (!element.classList.contains('cluster')) {
    return {
      targets,
      affectedNodeKeys: Array.from(affectedNodeKeys)
    };
  }

  const clusterBox = getElementBoxInSvg(svg, element);
  Array.from(svg.querySelectorAll('g.node, g.cluster')).forEach((candidate) => {
    if (candidate === element) {
      return;
    }

    const candidateKey = getNodeKey(candidate) || candidate.getAttribute('data-id') || candidate.id;
    if (!candidateKey || seen.has(candidateKey)) {
      return;
    }

    const candidateBox = getElementBoxInSvg(svg, candidate);
    if (!isBoxInside(clusterBox, candidateBox)) {
      return;
    }

    seen.add(candidateKey);
    affectedNodeKeys.add(candidateKey);

    if (element.contains(candidate)) {
      return;
    }

    targets.push({
      element: candidate,
      nodeKey: candidateKey,
      startPosition: manualLayoutState.nodePositions.get(candidateKey) || readElementTranslate(candidate)
    });
  });

  return {
    targets,
    affectedNodeKeys: Array.from(affectedNodeKeys)
  };
}

function refreshEdgesForNodes(svg, nodeKeys) {
  const relatedKeys = new Set(nodeKeys);
  manualLayoutState.edgeRegistry.forEach((entry) => {
    if (relatedKeys.has(entry.sourceKey) || relatedKeys.has(entry.targetKey)) {
      updateEdgeEntry(svg, entry);
    }
  });
}

function bindNodeDrag(svg, element) {
  if (element.dataset.dragBound === '1') {
    return;
  }

  element.dataset.dragBound = '1';
  element.addEventListener('pointerdown', (event) => {
    if (!manualLayoutEnabled || event.button !== 0) {
      return;
    }
    // 连线模式下不拖动，只选节点
    if (connectModeState) {
      return;
    }

    const nodeKey = getNodeKey(element) || element.getAttribute('data-id') || element.id;
    if (!nodeKey) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    element.classList.add('dragging');
    element.setPointerCapture(event.pointerId);

    const startPointer = clientPointToSvg(svg, event.clientX, event.clientY);
    const dragGroup = collectDragTargets(svg, element);
    const dragTargets = dragGroup.targets;
    const dragTargetKeys = dragGroup.affectedNodeKeys;

    const handlePointerMove = (moveEvent) => {
      const nextPointer = clientPointToSvg(svg, moveEvent.clientX, moveEvent.clientY);
      const deltaX = nextPointer.x - startPointer.x;
      const deltaY = nextPointer.y - startPointer.y;

      dragTargets.forEach((target) => {
        const nextPosition = {
          x: target.startPosition.x + deltaX,
          y: target.startPosition.y + deltaY
        };

        manualLayoutState.nodePositions.set(target.nodeKey, nextPosition);
        setElementTranslate(target.element, nextPosition.x, nextPosition.y);
      });

      refreshEdgesForNodes(svg, dragTargetKeys);
    };

    const handlePointerUp = () => {
      element.classList.remove('dragging');
      element.removeEventListener('pointermove', handlePointerMove);
      element.removeEventListener('pointerup', handlePointerUp);
      element.removeEventListener('pointercancel', handlePointerUp);
      const movedCount = dragTargets.length;
      setStatus(movedCount > 1 ? `已整体移动模块: ${nodeKey}（${movedCount} 个元素）` : `已移动节点: ${nodeKey}`, 'ok');
      fitSvgViewBox(svg);
    };

    element.addEventListener('pointermove', handlePointerMove);
    element.addEventListener('pointerup', handlePointerUp);
    element.addEventListener('pointercancel', handlePointerUp);
  });
}

function bindEdgeDrag(svg, pathElement) {
  if (pathElement.dataset.dragBound === '1') {
    return;
  }

  pathElement.dataset.dragBound = '1';
  pathElement.addEventListener('pointerdown', (event) => {
    if (!manualLayoutEnabled || event.button !== 0) {
      return;
    }

    const entry = manualLayoutState.edgeRegistry.find((item) => item.pathElement === pathElement);
    if (!entry) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    pathElement.setPointerCapture(event.pointerId);

    const startPointer = clientPointToSvg(svg, event.clientX, event.clientY);
    const sourceNode = svg.contains(entry.sourceEl) ? entry.sourceEl : findDiagramNode(svg, entry.sourceKey);
    const targetNode = svg.contains(entry.targetEl) ? entry.targetEl : findDiagramNode(svg, entry.targetKey);
    if (!sourceNode || !targetNode) {
      return;
    }

    const frame = pathElement.parentNode || svg;
    const sourceCenter = getElementBoxInFrame(frame, sourceNode).center;
    const targetCenter = getElementBoxInFrame(frame, targetNode).center;
    const defaultMidpoint = {
      x: (sourceCenter.x + targetCenter.x) / 2,
      y: (sourceCenter.y + targetCenter.y) / 2
    };
    const startMidpoint = manualLayoutState.edgeMidpoints.get(entry.edgeId) || defaultMidpoint;

    const handlePointerMove = (moveEvent) => {
      const nextPointer = clientPointToSvg(svg, moveEvent.clientX, moveEvent.clientY);
      manualLayoutState.edgeMidpoints.set(entry.edgeId, {
        x: startMidpoint.x + (nextPointer.x - startPointer.x),
        y: startMidpoint.y + (nextPointer.y - startPointer.y)
      });
      updateEdgeEntry(svg, entry);
    };

    const handlePointerUp = () => {
      pathElement.removeEventListener('pointermove', handlePointerMove);
      pathElement.removeEventListener('pointerup', handlePointerUp);
      pathElement.removeEventListener('pointercancel', handlePointerUp);
      setStatus(`已调整连线: ${entry.sourceKey} → ${entry.targetKey}`, 'ok');
      fitSvgViewBox(svg);
    };

    pathElement.addEventListener('pointermove', handlePointerMove);
    pathElement.addEventListener('pointerup', handlePointerUp);
    pathElement.addEventListener('pointercancel', handlePointerUp);
  });
}

// 清理已从源码中消失的节点对应的位置/连线中点记录
function pruneStaleLayoutState(svg) {
  const validKeys = new Set();
  Array.from(svg.querySelectorAll('g.node, g.cluster')).forEach((el) => {
    const key = getNodeKey(el);
    if (key) validKeys.add(key);
    const dataId = el.getAttribute('data-id');
    if (dataId) validKeys.add(dataId);
    const rawId = el.getAttribute('id');
    if (rawId) validKeys.add(rawId);
  });
  for (const key of Array.from(manualLayoutState.nodePositions.keys())) {
    if (!validKeys.has(key)) manualLayoutState.nodePositions.delete(key);
  }
  for (const key of Array.from(manualLayoutState.clusterSizes.keys())) {
    if (!validKeys.has(key)) manualLayoutState.clusterSizes.delete(key);
  }
  const validEdgeIds = new Set(manualLayoutState.edgeRegistry.map((e) => e.edgeId));
  for (const eid of Array.from(manualLayoutState.edgeMidpoints.keys())) {
    if (!validEdgeIds.has(eid)) manualLayoutState.edgeMidpoints.delete(eid);
  }
}

// 扩展 SVG 的 viewBox 和宽高以包含所有可见元素，
// 避免手动拖拽或新增节点后被固定 viewBox 裁切而"无法缩放看到"。
function fitSvgViewBox(svg) {
  if (!svg) return;
  try {
    const bbox = svg.getBBox();
    if (!bbox || !Number.isFinite(bbox.width) || !Number.isFinite(bbox.height)) return;
    if (bbox.width === 0 && bbox.height === 0) return;
    const pad = 20;
    const x = Math.floor(bbox.x - pad);
    const y = Math.floor(bbox.y - pad);
    const w = Math.ceil(bbox.width + pad * 2);
    const h = Math.ceil(bbox.height + pad * 2);
    svg.setAttribute('viewBox', `${x} ${y} ${w} ${h}`);
    svg.setAttribute('width', w);
    svg.setAttribute('height', h);
    svg.style.maxWidth = 'none';
  } catch {
    // 渲染时 getBBox 可能未就绪，忽略
  }
}

function enableManualLayout(svg) {
  svg.classList.toggle('manual-layout', manualLayoutEnabled);
  buildRegistries(svg);
  pruneStaleLayoutState(svg);

  Array.from(svg.querySelectorAll('g.node, g.cluster')).forEach((element) => {
    const nodeKey = getNodeKey(element) || element.getAttribute('data-id') || element.id;
    if (!nodeKey) {
      return;
    }

    const savedPosition = manualLayoutState.nodePositions.get(nodeKey);
    if (savedPosition) {
      let localX = savedPosition.x;
      let localY = savedPosition.y;
      // 优先按绝对坐标还原：读取当前 element 的 CTM，
      // 计算 parentCTM = selfCTM - currentLocal，再用 abs - parentCTM 得到新 local。
      if (Number.isFinite(savedPosition.absX) && Number.isFinite(savedPosition.absY)) {
        try {
          const selfCTM = element.getCTM && element.getCTM();
          const cur = readElementTranslate(element);
          if (selfCTM && Number.isFinite(selfCTM.e) && Number.isFinite(selfCTM.f) && cur) {
            const parentE = selfCTM.e - cur.x;
            const parentF = selfCTM.f - cur.y;
            localX = savedPosition.absX - parentE;
            localY = savedPosition.absY - parentF;
            // 同步更新 saved.x/y 为新 local，供后续 drag 使用
            savedPosition.x = localX;
            savedPosition.y = localY;
          }
        } catch {}
      }
      if (Number.isFinite(localX) && Number.isFinite(localY)) {
        setElementTranslate(element, localX, localY);
      }
    }
    bindNodeDrag(svg, element);
  });

  // 对 cluster（subgraph 黄框）应用保存尺寸 + 绑定右下角 resize handle
  Array.from(svg.querySelectorAll('g.cluster')).forEach((cluster) => {
    const key = getNodeKey(cluster);
    if (!key) return;
    const rect = findClusterRect(cluster);
    if (!rect) return;
    const saved = manualLayoutState.clusterSizes.get(key);
    if (saved) {
      if (Number.isFinite(saved.width)) rect.setAttribute('width', saved.width);
      if (Number.isFinite(saved.height)) rect.setAttribute('height', saved.height);
    }
    bindClusterResize(svg, cluster, rect, key);
  });

  getEdgePathElements(svg).forEach((pathElement) => bindEdgeDrag(svg, pathElement));
  bindNodeEditActions(svg);
  refreshAllEdges(svg);
  // 下一个帧再 fit，确保布局完成
  requestAnimationFrame(() => fitSvgViewBox(svg));
}

// 查找 cluster 主外框（优先第一个直接子 rect，其次任意 rect）
function findClusterRect(cluster) {
  if (!cluster) return null;
  const direct = cluster.querySelector(':scope > rect');
  if (direct) return direct;
  return cluster.querySelector('rect');
}

// 为 subgraph 黄框绑定右下角拖拽手柄，用于调整尺寸
function bindClusterResize(svg, cluster, rect, key) {
  if (cluster.dataset.resizeBound === '1') return;
  cluster.dataset.resizeBound = '1';

  const NS = 'http://www.w3.org/2000/svg';
  const handle = document.createElementNS(NS, 'rect');
  handle.setAttribute('class', 'cluster-resize-handle');
  handle.setAttribute('width', '12');
  handle.setAttribute('height', '12');
  handle.setAttribute('rx', '2');
  handle.style.cursor = 'nwse-resize';

  const placeHandle = () => {
    const x = parseFloat(rect.getAttribute('x') || '0');
    const y = parseFloat(rect.getAttribute('y') || '0');
    const w = parseFloat(rect.getAttribute('width') || '0');
    const h = parseFloat(rect.getAttribute('height') || '0');
    handle.setAttribute('x', x + w - 6);
    handle.setAttribute('y', y + h - 6);
  };
  placeHandle();
  cluster.appendChild(handle);

  handle.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    event.stopPropagation();
    handle.setPointerCapture(event.pointerId);
    const startPointer = clientPointToSvg(svg, event.clientX, event.clientY);
    const startW = parseFloat(rect.getAttribute('width') || '0');
    const startH = parseFloat(rect.getAttribute('height') || '0');

    const onMove = (moveEvent) => {
      const cur = clientPointToSvg(svg, moveEvent.clientX, moveEvent.clientY);
      const nextW = Math.max(60, startW + (cur.x - startPointer.x));
      const nextH = Math.max(40, startH + (cur.y - startPointer.y));
      rect.setAttribute('width', nextW);
      rect.setAttribute('height', nextH);
      placeHandle();
    };
    const onUp = () => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
      const finalW = parseFloat(rect.getAttribute('width') || '0');
      const finalH = parseFloat(rect.getAttribute('height') || '0');
      manualLayoutState.clusterSizes.set(key, { width: finalW, height: finalH });
      setStatus(`已调整子图大小: ${key} (${Math.round(finalW)} × ${Math.round(finalH)})`, 'ok');
      fitSvgViewBox(svg);
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  });
}

// 渲染前快照：把当前 SVG 里所有节点/子图的 translate 和尺寸写入 manualLayoutState，
// 使下次渲染后 enableManualLayout 自动恢复原位置——即“布局冻结”。
// 同时记录节点的绝对坐标（通过 getCTM），以便在 Mermaid 内部坐标系发生变化时仍能还原绝对位置。
function snapshotCurrentLayout(svg) {
  if (!svg) return;
  Array.from(svg.querySelectorAll('g.node, g.cluster')).forEach((element) => {
    const key = getNodeKey(element) || element.getAttribute('data-id') || element.id;
    if (!key) return;
    const pos = readElementTranslate(element);
    const entry = {};
    if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
      entry.x = pos.x;
      entry.y = pos.y;
    }
    try {
      const ctm = element.getCTM && element.getCTM();
      if (ctm && Number.isFinite(ctm.e) && Number.isFinite(ctm.f)) {
        entry.absX = ctm.e;
        entry.absY = ctm.f;
      }
    } catch {}
    if (Object.keys(entry).length) {
      manualLayoutState.nodePositions.set(key, entry);
    }
  });
  Array.from(svg.querySelectorAll('g.cluster')).forEach((cluster) => {
    const key = getNodeKey(cluster);
    if (!key) return;
    const rect = findClusterRect(cluster);
    if (!rect) return;
    const w = parseFloat(rect.getAttribute('width'));
    const h = parseFloat(rect.getAttribute('height'));
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
      manualLayoutState.clusterSizes.set(key, { width: w, height: h });
    }
  });
}

async function renderMermaid() {
  const code = mermaidEditor.value.trim();
  if (!code) {
    mermaidPreview.innerHTML = '<p>请输入 Mermaid 代码。</p>';
    renderedSvg = '';
    return;
  }
  // 重渲染前快照当前布局，使新增/删除/连线等操作后已有节点保持原位置。
  const prevSvg = mermaidPreview.querySelector('svg');
  if (prevSvg) snapshotCurrentLayout(prevSvg);

  try {
    const id = `mmd_${Date.now()}`;
    const { svg } = await mermaidApi.render(id, code);
    renderedSvg = svg;
    mermaidPreview.innerHTML = svg;
    const svgElement = mermaidPreview.querySelector('svg');
    if (svgElement) {
      enableManualLayout(svgElement);
    }
    setStatus('Mermaid 渲染成功', 'ok');
  } catch (err) {
    // 尝试自动修复源码后重试一次
    const fixed = autoFixMermaidSource(mermaidEditor.value);
    if (fixed && fixed !== mermaidEditor.value) {
      try {
        const id2 = `mmd_${Date.now()}_r`;
        const { svg } = await mermaidApi.render(id2, fixed.trim());
        mermaidEditor.value = fixed;
        renderedSvg = svg;
        mermaidPreview.innerHTML = svg;
        const svgElement = mermaidPreview.querySelector('svg');
        if (svgElement) enableManualLayout(svgElement);
        setStatus('已自动修复源码并渲染成功', 'ok');
        return;
      } catch (_) { /* 修复失败，继续显示原错误 */ }
    }
    renderedSvg = '';
    mermaidPreview.innerHTML = `<pre style="color:#b3312f; white-space:pre-wrap;">${String(err.message || err)}</pre>`;
    setStatus('Mermaid 渲染失败，请检查语法', 'error');
  }
}

// 粘贴子图时"保留布局"的核心实现：
// 离屏渲染完整新源码 → 从离屏 SVG 抽取新 cluster + 新节点 + 新边 → 包进带 translate 的 wrapper <g>
// 追加到当前 SVG 根 g 下；旧 DOM 不动，所以原布局精确保留。
// 失败返回 false，调用方应回退到全量 renderMermaid。
async function pasteClusterInPlace(newClusterId, addedNodeIds) {
  const baseSvg = mermaidPreview.querySelector('svg');
  if (!baseSvg) return false;
  const rootG = baseSvg.querySelector(':scope > g');
  if (!rootG) return false;
  const code = mermaidEditor.value.trim();
  if (!code) return false;

  // 1. 离屏渲染新源码
  const off = document.createElement('div');
  off.style.cssText = 'position:absolute;left:-99999px;top:-99999px;visibility:hidden;';
  document.body.appendChild(off);
  let fullSvg = null;
  try {
    const tmpId = `mmd_off_${Date.now()}`;
    const { svg: fullStr } = await mermaidApi.render(tmpId, code);
    off.innerHTML = fullStr;
    fullSvg = off.querySelector('svg');
  } catch (e) {
    off.remove();
    console.warn('paste offscreen render failed', e);
    return false;
  }
  if (!fullSvg) { off.remove(); return false; }

  try {
    // 2. 从 fullSvg 里定位新 cluster
    const newCluster = Array.from(fullSvg.querySelectorAll('g.cluster')).find((c) => {
      const rid = c.getAttribute('id') || '';
      const did = c.getAttribute('data-id') || '';
      return did === newClusterId || rid === newClusterId || rid.endsWith('-' + newClusterId);
    });
    if (!newCluster) return false;

    // 3. 从 fullSvg 里定位新节点（addedNodeIds）
    const idSet = new Set(addedNodeIds);
    const newNodes = Array.from(fullSvg.querySelectorAll('g.node')).filter((n) => {
      const rid = n.getAttribute('id') || '';
      const did = n.getAttribute('data-id') || '';
      if (idSet.has(did)) return true;
      const m = rid.match(/(?:^|-)flowchart-(.+?)-\d+$/);
      return m && idSet.has(m[1]);
    });

    // 4. 从 fullSvg 里定位新边 path + 新 edgeLabel（两端节点至少一端在 idSet 内）
    const idInside = (anyStr) => {
      if (!anyStr) return 0;
      let hits = 0;
      // 尝试从 id 里切段匹配；对 addedNodeIds 里的每个 id，看作整词是否出现
      for (const k of idSet) {
        const esc = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (new RegExp(`(^|[-_])${esc}([-_]|$)`).test(anyStr)) hits++;
      }
      return hits;
    };
    const newPaths = Array.from(fullSvg.querySelectorAll('g.edgePaths > path, g.edgePaths > g'));
    const newPathsKept = newPaths.filter((p) => idInside(p.getAttribute('id') || ''));
    const newEdgeLabels = Array.from(fullSvg.querySelectorAll('g.edgeLabels > g')).filter((l) => idInside(l.getAttribute('id') || ''));

    // 5. 计算 baseSvg 当前内容 BBox
    const baseBox = getContentBBox(baseSvg);
    const newBox = getSubsetBBox([newCluster, ...newNodes]);
    if (!newBox) return false;
    const gap = 60;
    const dx = (baseBox ? (baseBox.x + baseBox.width + gap) : 0) - newBox.x;
    const dy = (baseBox ? baseBox.y : 0) - newBox.y;

    // 6. 构造 wrapper 结构，按 Mermaid 原分类容器放置
    const NS = 'http://www.w3.org/2000/svg';
    const wrapper = document.createElementNS(NS, 'g');
    wrapper.setAttribute('class', 'pasted-cluster-wrapper');
    wrapper.setAttribute('transform', `translate(${dx}, ${dy})`);
    const mk = (cls) => { const g = document.createElementNS(NS, 'g'); g.setAttribute('class', cls); return g; };
    const wClusters = mk('clusters');
    const wEdgePaths = mk('edgePaths');
    const wEdgeLabels = mk('edgeLabels');
    const wNodes = mk('nodes');

    wClusters.appendChild(newCluster);
    newPathsKept.forEach((p) => wEdgePaths.appendChild(p));
    newEdgeLabels.forEach((l) => wEdgeLabels.appendChild(l));
    newNodes.forEach((n) => wNodes.appendChild(n));

    wrapper.appendChild(wClusters);
    wrapper.appendChild(wEdgePaths);
    wrapper.appendChild(wEdgeLabels);
    wrapper.appendChild(wNodes);

    rootG.appendChild(wrapper);

    // 7. 重建 registries + 重绑交互 + 扩展画布
    try { enableManualLayout(baseSvg); } catch (e) { console.warn('enableManualLayout after paste failed', e); }
    try { fitSvgViewBox(baseSvg); } catch {}

    return true;
  } finally {
    off.remove();
  }
}

// 计算 svg 里所有 g.node / g.cluster 的联合包围盒（svg 内部坐标系）
function getContentBBox(svg) {
  return getSubsetBBox(Array.from(svg.querySelectorAll('g.node, g.cluster')));
}

function getSubsetBBox(elements) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const el of elements) {
    try {
      const bb = el.getBBox();
      const t = readElementTranslate(el) || { x: 0, y: 0 };
      const x1 = t.x + bb.x;
      const y1 = t.y + bb.y;
      if (!Number.isFinite(x1) || !Number.isFinite(y1)) continue;
      if (x1 < minX) minX = x1;
      if (y1 < minY) minY = y1;
      if (x1 + bb.width > maxX) maxX = x1 + bb.width;
      if (y1 + bb.height > maxY) maxY = y1 + bb.height;
    } catch {}
  }
  if (minX === Infinity) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

// 尝试修复源码的常见结构性错误：
// 1. 同行内 end 拆到独立行
// 2. 移除与 subgraph 不配对的孤立 end
function autoFixMermaidSource(source) {
  let src = String(source || '');
  // 1) 把各种 "end" 夸行的情况拆到独立行（保护字符串内的 end 不动 -- 粗略处理，只看 \\bend\\b）
  src = src.replace(/([^\s\r\n])[ \t]+\bend\b/g, '$1\nend');
  src = src.replace(/\bend\b[ \t]+([^\s\r\n])/g, 'end\n$1');
  // 2) 逐行扫描，剩下孤立 end（与 subgraph 不配对的 end）则删掉
  const lines = src.split(/\r?\n/);
  const kept = [];
  let depth = 0;
  for (const line of lines) {
    if (/^\s*subgraph\s+/.test(line)) { depth++; kept.push(line); continue; }
    if (/^\s*end\s*$/.test(line)) {
      if (depth > 0) { depth--; kept.push(line); }
      else { /* 孤立 end，丢弃 */ }
      continue;
    }
    kept.push(line);
  }
  return kept.join('\n');
}

async function renderAll() {
  await renderMermaid();
  renderMarkdown();
}

function updateZoom() {
  previewRoot.style.transform = `scale(${zoom})`;
}

async function exportPng() {
  const currentSvg = getCurrentPreviewSvg();
  if (!currentSvg) {
    setStatus('没有可导出的 Mermaid 图形', 'error');
    return;
  }

  const result = await window.mmeApi.exportPng(currentSvg);
  if (!result.canceled) {
    if (result.error) {
      setStatus(`PNG 导出失败: ${result.error}`, 'error');
    } else {
      setStatus(`PNG 已导出: ${result.filePath}`, 'ok');
    }
  }
}

async function applyOpenedFile(payload) {
  if (!payload || typeof payload.content !== 'string') return;
  const { filePath, content, extension } = payload;
  const kind = classifyFileByExtension(extension);

  // 工程文件
  if (kind === 'project') {
    const projectFile = parseProjectFile(content, extension);
    if (projectFile) {
      mermaidEditor.value = projectFile.mermaid;
      markdownEditor.value = projectFile.markdown;
      setActiveTab(projectFile.mermaid ? 'mermaid' : 'markdown');
      await renderAll();
      setStatus(`已打开工程文件: ${filePath}`, 'ok');
      return;
    }
  }

  // 扩展名优先判断：.md/.markdown 一定当 Markdown，.mmd/.mermaid 一定当 Mermaid
  let asMermaid;
  if (kind === 'markdown') asMermaid = false;
  else if (kind === 'mermaid') asMermaid = true;
  else asMermaid = isLikelyMermaidText(content);

  if (asMermaid) {
    mermaidEditor.value = content;
    setActiveTab('mermaid');
    await renderMermaid();
    setStatus(`已打开 Mermaid 文件: ${filePath}`, 'ok');
  } else {
    markdownEditor.value = content;
    setActiveTab('markdown');
    renderMarkdown();
    setStatus(`已打开 Markdown 文件: ${filePath}`, 'ok');
  }
}

async function handleOpen() {
  const result = await window.mmeApi.openFile();
  if (result.canceled) return;
  await applyOpenedFile(result);
}

async function handleSaveProject() {
  const result = await window.mmeApi.saveProject({
    mermaid: mermaidEditor.value,
    markdown: markdownEditor.value
  });

  if (!result.canceled) {
    setStatus(`工程已保存: ${result.filePath}`, 'ok');
  }
}

// ===== 编辑历史（撤销/重做）=====
const historyState = {
  stack: [],
  cursor: -1,
  limit: 100,
  suspend: false,
  pendingTimer: null
};

function snapshotState() {
  // 同时快照当前预览 SVG 的 DOM，使撤销/重做能精确复原"布局保持"型操作（如删除连线）
  // 产生的 DOM 状态，而不触发 Mermaid 重新 dagre 布局。
  const svgEl = mermaidPreview && mermaidPreview.querySelector('svg');
  return {
    mermaid: mermaidEditor.value,
    markdown: markdownEditor.value,
    svgHtml: svgEl ? mermaidPreview.innerHTML : null
  };
}

function historyPush() {
  if (historyState.suspend) return;
  const current = snapshotState();
  const top = historyState.stack[historyState.cursor];
  if (top && top.mermaid === current.mermaid && top.markdown === current.markdown && top.svgHtml === current.svgHtml) {
    return;
  }
  // 丢弃 cursor 之后的分叉
  historyState.stack.length = historyState.cursor + 1;
  historyState.stack.push(current);
  if (historyState.stack.length > historyState.limit) {
    historyState.stack.shift();
  } else {
    historyState.cursor = historyState.stack.length - 1;
  }
  historyState.cursor = historyState.stack.length - 1;
}

function historySchedulePush(delay = 400) {
  if (historyState.suspend) return;
  if (historyState.pendingTimer) clearTimeout(historyState.pendingTimer);
  historyState.pendingTimer = setTimeout(() => {
    historyState.pendingTimer = null;
    historyPush();
  }, delay);
}

async function applyHistoryEntry(entry) {
  historyState.suspend = true;
  try {
    mermaidEditor.value = entry.mermaid;
    markdownEditor.value = entry.markdown;
    if (entry.svgHtml) {
      // 直接恢复当时的 SVG DOM，跳过 Mermaid 重新 dagre，保持精确布局
      // 先清空 manualLayoutState：旧的 DOM 引用会因 innerHTML 替换失效，留下僵尸条目会污染后续选中/删除/拖拽。
      // clusterSourceIds / nodeIsCluster 是 WeakMap/WeakSet，key DOM 失去引用后自动 GC，不显式处理。
      manualLayoutState.edgeRegistry.length = 0;
      manualLayoutState.nodePositions.clear();
      manualLayoutState.edgeMidpoints.clear();
      manualLayoutState.nodeRegistry.clear();
      manualLayoutState.clusterSizes.clear();

      mermaidPreview.innerHTML = entry.svgHtml;
      const svg = mermaidPreview.querySelector('svg');
      if (svg) {
        // innerHTML 赋值只保留 data-* 属性，但 event listener 全丢。
        // 必须清理 bindXxx 系列使用的防重入标记，否则 enableManualLayout 跳过绑定 → 选中/拖拽全失效。
        svg.querySelectorAll('[data-edit-bound],[data-select-bound],[data-drag-bound],[data-resize-bound]').forEach((el) => {
          el.removeAttribute('data-edit-bound');
          el.removeAttribute('data-select-bound');
          el.removeAttribute('data-drag-bound');
          el.removeAttribute('data-resize-bound');
        });
        // svg 根上的 clearSelectBound 也要清
        svg.removeAttribute('data-clear-select-bound');
        const card = svg.closest('.preview-card');
        if (card) card.removeAttribute('data-clear-select-bound');
        // 同时移除旧残留的 cluster resize handle（重新绑定时会重建）
        svg.querySelectorAll('.cluster-resize-handle').forEach((h) => h.parentNode && h.parentNode.removeChild(h));
        try { enableManualLayout(svg); } catch (e) { console.warn('enableManualLayout after undo failed', e); }
      }
      renderMarkdown();
    } else {
      await renderAll();
    }
  } finally {
    historyState.suspend = false;
  }
}

async function doUndo() {
  if (historyState.pendingTimer) {
    clearTimeout(historyState.pendingTimer);
    historyState.pendingTimer = null;
    historyPush();
  }
  if (historyState.cursor <= 0) {
    setStatus('已到达最早状态', 'info');
    return;
  }
  historyState.cursor -= 1;
  await applyHistoryEntry(historyState.stack[historyState.cursor]);
  setStatus('已撤销', 'ok');
}

async function doRedo() {
  if (historyState.cursor >= historyState.stack.length - 1) {
    setStatus('已到达最新状态', 'info');
    return;
  }
  historyState.cursor += 1;
  await applyHistoryEntry(historyState.stack[historyState.cursor]);
  setStatus('已重做', 'ok');
}

// ===== 剪切/复制/粘贴 =====
function getActiveEditor() {
  const el = document.activeElement;
  if (el === markdownEditor) return markdownEditor;
  return mermaidEditor;
}

function replaceSelection(editor, replacement) {
  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  const value = editor.value;
  editor.value = value.slice(0, start) + replacement + value.slice(end);
  const caret = start + replacement.length;
  editor.selectionStart = editor.selectionEnd = caret;
  editor.dispatchEvent(new Event('input', { bubbles: true }));
}

// ===== 添加节点 / 连线 / 双击编辑 =====
function sanitizeMermaidId(raw) {
  return String(raw || '').trim().replace(/[^\w\u4e00-\u9fff]/g, '_');
}

function appendMermaidLine(line) {
  const current = mermaidEditor.value;
  const needsNewline = current && !current.endsWith('\n');
  mermaidEditor.value = current + (needsNewline ? '\n' : '') + line + '\n';
}

async function doAddNode() {
  const result = await openInputDialog({
    title: '新增节点',
    hint: '输入节点 ID 与显示文本，ID 只允许字母、数字、下划线或中文',
    fields: [
      { name: 'id', label: '节点 ID', default: `N${Date.now().toString().slice(-4)}` },
      { name: 'label', label: '显示文本', default: '新节点' }
    ]
  });
  if (!result) return;
  const id = sanitizeMermaidId(result.id);
  if (!id) {
    setStatus('节点 ID 无效', 'error');
    return;
  }
  const label = result.label != null ? result.label : id;
  historyPush();
  const safeLabel = String(label).replace(/"/g, '\\"');
  appendMermaidLine(`  ${id}["${safeLabel}"]`);
  setActiveTab('mermaid');
  await renderMermaid();
  historyPush();
  setStatus(`已添加节点: ${id}`, 'ok');
}

async function doAddSubgraph() {
  const result = await openInputDialog({
    title: '新增子图 / 分组',
    hint: '输入子图 ID 与显示标题；可填入成员节点 ID（逗号或空格分隔），为空则生成空分组',
    fields: [
      { name: 'id', label: '子图 ID', default: `SG${Date.now().toString().slice(-4)}` },
      { name: 'title', label: '显示标题', default: '新分组' },
      { name: 'members', label: '成员节点 ID（可选）', default: '' }
    ]
  });
  if (!result) return;
  const id = sanitizeMermaidId(result.id);
  if (!id) {
    setStatus('子图 ID 无效', 'error');
    return;
  }
  const title = result.title != null ? String(result.title) : id;
  const safeTitle = title.replace(/"/g, '\\"');
  const memberText = String(result.members || '').trim();
  const members = memberText
    ? memberText.split(/[\s,，;；]+/).map((s) => sanitizeMermaidId(s)).filter(Boolean)
    : [];

  historyPush();
  let block = `  subgraph ${id}["${safeTitle}"]\n`;
  if (members.length === 0) {
    // Mermaid v11 会把空 subgraph 渲染为普通 node（紫框），故需加一个占位节点保证黄框籇
    block += `    ${id}_ph[" "]\n`;
  } else {
    members.forEach((m) => {
      block += `    ${m}\n`;
    });
  }
  block += `  end\n`;

  const current = mermaidEditor.value;
  const needsNewline = current.length && !current.endsWith('\n');
  mermaidEditor.value = current + (needsNewline ? '\n' : '') + block;
  setActiveTab('mermaid');
  await renderMermaid();
  historyPush();
  setStatus(`已插入 subgraph ${id}（${members.length} 成员）`, 'ok');
}

// 连线模式状态
let connectModeState = null;

function clearConnectHighlights() {
  const svg = mermaidPreview.querySelector('svg');
  if (!svg) return;
  svg.querySelectorAll('.connect-candidate').forEach((el) => el.classList.remove('connect-candidate'));
  svg.classList.remove('connect-mode');
}

function exitConnectMode(silent) {
  connectModeState = null;
  clearConnectHighlights();
  const addBtn = document.getElementById('btnAddMenu');
  if (addBtn) addBtn.classList.remove('active');
  if (!silent) setStatus('已退出连线模式', 'info');
}

function enterConnectMode() {
  const svg = mermaidPreview.querySelector('svg');
  if (!svg) {
    setStatus('当前没有可用的 Mermaid 图', 'error');
    return;
  }
  connectModeState = { source: null };
  svg.classList.add('connect-mode');
  const addBtn = document.getElementById('btnAddMenu');
  if (addBtn) addBtn.classList.add('active');
  setStatus('连线模式：先点击起点节点，再点击终点节点（Esc 取消）', 'info');
}

// 以已知起点 key 进入连线模式（跳过“选起点”步骤，直接等待用户点击终点）
function enterConnectModeFromSource(sourceKey) {
  const svg = mermaidPreview.querySelector('svg');
  if (!svg) {
    setStatus('当前没有可用的 Mermaid 图', 'error');
    return;
  }
  if (!sourceKey) return;
  connectModeState = { source: sourceKey };
  svg.classList.add('connect-mode');
  const addBtn = document.getElementById('btnAddMenu');
  if (addBtn) addBtn.classList.add('active');
  // 高亮已选起点（既可能是 g.node 也可能是 g.cluster）
  clearConnectHighlights();
  const candidates = Array.from(svg.querySelectorAll('g.node, g.cluster'));
  for (const el of candidates) {
    if (getNodeKey(el) === sourceKey) {
      el.classList.add('connect-candidate');
      break;
    }
  }
  setStatus(`连线模式：起点已选 ${sourceKey}，再点击终点节点（Esc 取消）`, 'info');
}

async function completeConnect(sourceKey, targetKey) {
  historyPush();
  appendMermaidLine(`  ${sourceKey} --> ${targetKey}`);
  setActiveTab('mermaid');
  // 先尝试"不重渲染"地在当前 SVG 里手工画一条 path；若失败再回退到全量 render。
  const svg = mermaidPreview.querySelector('svg');
  const ok = svg ? addEdgeInPlace(svg, sourceKey, targetKey) : false;
  if (ok) {
    historyPush();
    setStatus(`已添加连线: ${sourceKey} --> ${targetKey}（布局保持）`, 'ok');
    return;
  }
  await renderMermaid();
  historyPush();
  setStatus(`已添加连线: ${sourceKey} --> ${targetKey}`, 'ok');
}

// 直接在当前 SVG 里画一条 source→target 的贝塞尔 path，并注册到 edgeRegistry；
// 不触发 Mermaid 重渲染，保持现有布局不变。
function addEdgeInPlace(svg, sourceKey, targetKey) {
  try {
    const sourceEl = findDiagramNode(svg, sourceKey);
    const targetEl = findDiagramNode(svg, targetKey);
    if (!sourceEl || !targetEl) return false;

    const sCTM = sourceEl.getCTM();
    const tCTM = targetEl.getCTM();
    if (!sCTM || !tCTM) return false;

    const sBB = sourceEl.getBBox();
    const tBB = targetEl.getBBox();
    // 节点中心在 svg 内部绝对坐标（Mermaid 生成的 g.node 通常以中心为 transform 原点）
    const sAbsX = sCTM.e;
    const sAbsY = sCTM.f;
    const tAbsX = tCTM.e;
    const tAbsY = tCTM.f;

    // path 将挂到 svg 的根 g 下，要把绝对坐标转到根 g 局部坐标系
    const rootG = svg.querySelector(':scope > g');
    if (!rootG) return false;
    let rE = 0, rF = 0;
    try {
      const rCTM = rootG.getCTM();
      if (rCTM) { rE = rCTM.e; rF = rCTM.f; }
    } catch {}

    const sCx = sAbsX - rE;
    const sCy = sAbsY - rF;
    const tCx = tAbsX - rE;
    const tCy = tAbsY - rF;

    // 估算两端节点半宽/半高（用 bbox，在节点 local 坐标，translate 使其中心为原点）
    const sHw = Math.max(20, Math.abs(sBB.width) / 2);
    const sHh = Math.max(15, Math.abs(sBB.height) / 2);
    const tHw = Math.max(20, Math.abs(tBB.width) / 2);
    const tHh = Math.max(15, Math.abs(tBB.height) / 2);

    // 根据 source→target 的方向，从节点边框某个点起笔
    const dx = tCx - sCx;
    const dy = tCy - sCy;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);
    let sx, sy, tx, ty, cp1x, cp1y, cp2x, cp2y;
    if (absDx >= absDy) {
      // 水平优先
      const dir = dx >= 0 ? 1 : -1;
      sx = sCx + dir * sHw; sy = sCy;
      tx = tCx - dir * tHw; ty = tCy;
      const bend = Math.max(40, Math.abs(tx - sx) / 2);
      cp1x = sx + dir * bend; cp1y = sy;
      cp2x = tx - dir * bend; cp2y = ty;
    } else {
      // 垂直优先
      const dir = dy >= 0 ? 1 : -1;
      sx = sCx; sy = sCy + dir * sHh;
      tx = tCx; ty = tCy - dir * tHh;
      const bend = Math.max(40, Math.abs(ty - sy) / 2);
      cp1x = sx; cp1y = sy + dir * bend;
      cp2x = tx; cp2y = ty - dir * bend;
    }
    const d = `M${sx},${sy} C${cp1x},${cp1y} ${cp2x},${cp2y} ${tx},${ty}`;

    // 找一个可用的箭头 marker（Mermaid 在 svg 里已预定义）
    const marker = svg.querySelector('marker[id*="pointEnd"]')
      || svg.querySelector('marker[id*="flowchart"]')
      || svg.querySelector('defs marker');

    const NS = 'http://www.w3.org/2000/svg';
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('class', 'flowchart-link manually-added-edge');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', '#333');
    path.setAttribute('stroke-width', '1.5');
    if (marker && marker.id) {
      path.setAttribute('marker-end', `url(#${marker.id})`);
    }

    rootG.appendChild(path);

    // 注册到 edgeRegistry，让它可选中 / 可删除 / 可剪切
    const edgeId = `manual_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const entry = {
      pathElement: path,
      sourceEl,
      targetEl,
      sourceKey,
      targetKey,
      edgeId,
      isManuallyAdded: true
    };
    manualLayoutState.edgeRegistry.push(entry);

    // 绑定点击选中
    path.dataset.selectBound = '1';
    path.addEventListener('click', (event) => {
      if (connectModeState) return;
      const reg = manualLayoutState.edgeRegistry.find((e) => e.pathElement === path);
      if (!reg) return;
      event.stopPropagation();
      setSelection({ type: 'edge', entry: reg, element: path });
    });

    // 扩展画布以容纳可能超出原 viewBox 的新 path
    try { fitSvgViewBox(svg); } catch {}
    return true;
  } catch (e) {
    console.warn('addEdgeInPlace failed', e);
    return false;
  }
}

async function editNodeLabel(nodeKey) {
  if (!nodeKey) return;
  const source = mermaidEditor.value;
  // 匹配形如 `ID["label"]` / `ID("label")` / `ID[(label)]` / `ID{label}` 等括号标签
  const re = new RegExp(`(^|[^\\w])(${escapeRegex(nodeKey)})(\\s*)([\\[\\(\\{])([^\\]\\)\\}]*)([\\]\\)\\}])`);
  const match = re.exec(source);
  let currentLabel = nodeKey;
  if (match) {
    // 去掉成对的首尾引号
    currentLabel = String(match[5]).trim();
    if (currentLabel.startsWith('"') && currentLabel.endsWith('"')) {
      currentLabel = currentLabel.slice(1, -1);
    }
  }
  const result = await openInputDialog({
    title: `编辑节点：${nodeKey}`,
    hint: '修改该节点的显示文本',
    fields: [
      { name: 'label', label: '显示文本', default: currentLabel }
    ]
  });
  if (!result) return;
  const next = result.label;
  historyPush();
  const safe = String(next).replace(/"/g, '\\"');
  if (match) {
    const replacement = `${match[1]}${match[2]}${match[3]}${match[4]}"${safe}"${match[6]}`;
    mermaidEditor.value = source.replace(re, replacement);
  } else {
    appendMermaidLine(`  ${nodeKey}["${safe}"]`);
  }
  // 免重渲染：直接替换该节点 DOM 里的文字内容（节点框尺寸保持不变）
  const svg = mermaidPreview.querySelector('svg');
  const ok = svg ? updateNodeLabelInPlace(svg, nodeKey, String(next)) : false;
  if (ok) {
    historyPush();
    setStatus(`已更新节点文本: ${nodeKey}（布局保持；如需调整节点尺寸请拖拽右下角 handle）`, 'ok');
    return;
  }
  await renderMermaid();
  historyPush();
  setStatus(`已更新节点文本: ${nodeKey}`, 'ok');
}

// 在当前 SVG 中找到 nodeKey 对应节点，直接替换其文字内容（不重渲染）。
function updateNodeLabelInPlace(svg, nodeKey, newLabel) {
  try {
    const node = findDiagramNode(svg, nodeKey);
    if (!node) return false;
    // 优先替换 foreignObject 内部 div（Mermaid v11 默认 htmlLabels）
    const fo = node.querySelector('foreignObject');
    if (fo) {
      const labelHost = fo.querySelector('.nodeLabel, span, div, p');
      if (labelHost) {
        labelHost.textContent = newLabel;
        return true;
      }
    }
    // 回退：替换 <text> 元素
    const textEls = node.querySelectorAll('text');
    if (textEls.length > 0) {
      // 清空原文本节点后，往第一个 <text> 写入新内容
      const primary = textEls[0];
      while (primary.firstChild) primary.removeChild(primary.firstChild);
      const tspan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
      tspan.textContent = newLabel;
      primary.appendChild(tspan);
      return true;
    }
    return false;
  } catch (e) {
    console.warn('updateNodeLabelInPlace failed', e);
    return false;
  }
}

function bindNodeEditActions(svg) {
  Array.from(svg.querySelectorAll('g.node')).forEach((element) => {
    if (element.dataset.editBound === '1') return;
    element.dataset.editBound = '1';

    // 双击编辑文本
    element.addEventListener('dblclick', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const key = getNodeKey(element);
      editNodeLabel(key);
    });

    // 连线模式或普通点击选中
    element.addEventListener('click', (event) => {
      const key = getNodeKey(element);
      if (connectModeState) {
        event.preventDefault();
        event.stopPropagation();
        if (!key) return;
        if (!connectModeState.source) {
          connectModeState.source = key;
          element.classList.add('connect-candidate');
          setStatus(`起点已选: ${key}，再点击终点节点`, 'info');
        } else if (connectModeState.source === key) {
          setStatus('起点与终点不能相同', 'error');
        } else {
          const source = connectModeState.source;
          exitConnectMode(true);
          completeConnect(source, key);
        }
        return;
      }
      // 普通点击：选中节点
      if (!key) return;
      event.stopPropagation();
      // 特殊情况：该 node 其实是被 Mermaid 渲染为普通 node 的空 subgraph，按 cluster 选中。
      if (manualLayoutState.nodeIsCluster && manualLayoutState.nodeIsCluster.has(element)) {
        const cKey = manualLayoutState.clusterSourceIds.get(element) || key;
        setSelection({ type: 'cluster', key: cKey, element });
        return;
      }
      setSelection({ type: 'node', key, element });
    }, true);
  });

  // 绑定连线点击选中
  getEdgePathElements(svg).forEach((pathElement) => {
    if (pathElement.dataset.selectBound === '1') return;
    pathElement.dataset.selectBound = '1';
    pathElement.addEventListener('click', (event) => {
      if (connectModeState) return;
      const entry = manualLayoutState.edgeRegistry.find((item) => item.pathElement === pathElement);
      if (!entry) return;
      event.stopPropagation();
      setSelection({ type: 'edge', entry, element: pathElement });
    });
  });

  // 绑定子图 g.cluster 点击选中（仅当点击在子图黄框标题栏或背景、而非内部节点/连线上时生效）
  Array.from(svg.querySelectorAll('g.cluster')).forEach((cluster) => {
    if (cluster.dataset.selectBound === '1') return;
    cluster.dataset.selectBound = '1';
    cluster.addEventListener('click', (event) => {
      // 点内部节点时让 node handler 处理，不拦截
      if (event.target.closest('g.node')) return;
      // 点连线时交给 edge handler
      if (event.target.tagName === 'path') return;
      const key = getNodeKey(cluster);
      if (!key) return;
      // 连线模式下：子图也可作为起点/终点
      if (connectModeState) {
        event.preventDefault();
        event.stopPropagation();
        if (!connectModeState.source) {
          connectModeState.source = key;
          cluster.classList.add('connect-candidate');
          setStatus(`起点已选: ${key}，再点击终点节点`, 'info');
        } else if (connectModeState.source === key) {
          setStatus('起点与终点不能相同', 'error');
        } else {
          const source = connectModeState.source;
          exitConnectMode(true);
          completeConnect(source, key);
        }
        return;
      }
      event.stopPropagation();
      setSelection({ type: 'cluster', key, element: cluster });
      setStatus(`选中子图: ${key}`, 'info');
    });
  });

  // 点击画布空白取消选中
  if (!svg.dataset.clearSelectBound) {
    svg.dataset.clearSelectBound = '1';
    svg.addEventListener('click', (event) => {
      if (event.target === svg || event.target.tagName === 'g') {
        // 仅当点击在 svg 本身或最外层 group 时才清除
      }
    });
  }
  const card = svg.closest('.preview-card');
  if (card && !card.dataset.clearSelectBound) {
    card.dataset.clearSelectBound = '1';
    card.addEventListener('click', (event) => {
      // 点击发生在 svg 外（卡片空白处）
      if (!svg.contains(event.target)) {
        clearSelection();
      }
    });
  }
}

// ===== 选中状态管理 =====
let selectionState = null;

function clearSelection() {
  if (!selectionState) return;
  if (selectionState.element) {
    selectionState.element.classList.remove('selected');
    selectionState.element.classList.remove('edge-selected');
  }
  selectionState = null;
}

function setSelection(payload) {
  clearSelection();
  selectionState = payload;
  if (!payload || !payload.element) return;
  if (payload.type === 'node') {
    payload.element.classList.add('selected');
    setStatus(`已选中节点: ${payload.key}`, 'info');
  } else if (payload.type === 'cluster') {
    payload.element.classList.add('selected');
    setStatus(`已选中子图: ${payload.key}`, 'info');
  } else if (payload.type === 'edge') {
    payload.element.classList.add('edge-selected');
    setStatus(`已选中连线: ${payload.entry.sourceKey} → ${payload.entry.targetKey}`, 'info');
  }
}

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 在 mermaid 源中查找节点定义 `ID[...]` / `ID(...)` / `ID{...}`
function findNodeDefLine(source, nodeKey) {
  const lines = source.split(/\r?\n/);
  const re = new RegExp(`(^|[^\\w])${escapeRegex(nodeKey)}\\s*[\\[\\(\\{]`);
  const idx = lines.findIndex((line) => re.test(line));
  return { lines, index: idx };
}

// 提取单个节点定义片段（包括括号）
function extractNodeDefFragment(source, nodeKey) {
  const re = new RegExp(`(^|[^\\w])(${escapeRegex(nodeKey)}\\s*[\\[\\(\\{][^\\]\\)\\}]*[\\]\\)\\}])`);
  const m = re.exec(source);
  return m ? m[2] : nodeKey;
}

// ===== 删除 / 保存 / 导出 =====

// 内部剪贴板：记录是否是 mermaid 图形对象（node/edge）
let internalClipboard = null;

async function writeClipboardSafe(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // 忽略
  }
}

// 从 mermaid 源码中删除指定节点及其关联连线
function removeNodeFromSource(source, nodeKey) {
  const idRe = new RegExp(`(^|[^\\w\\u4e00-\\u9fff])${escapeRegex(nodeKey)}([^\\w\\u4e00-\\u9fff]|$)`);
  const lines = source.split(/\r?\n/);
  const kept = lines.filter((line) => {
    // 保护 subgraph 起始行和独立 end 行，避免 nodeKey 误伤 subgraph 结构
    if (/^\s*subgraph\s+/.test(line)) return true;
    if (/^\s*end\b/.test(line)) return true;
    return !idRe.test(line);
  });
  return kept.join('\n');
}

// 从源码中删除指定连线 source-->target（仅删除该连线，不删节点）
function removeEdgeFromSource(source, sourceKey, targetKey) {
  const lines = source.split(/\r?\n/);
  const sEsc = escapeRegex(sourceKey);
  const tEsc = escapeRegex(targetKey);
  // 允许两端带 shape 定义：`A["..."] --> B["..."]` / `A(...) -.-> B{...}` 等
  const shapeRe = `(\\[[^\\]]*\\]|\\([^\\)]*\\)|\\{[^\\}]*\\})?`;
  const connectorRe = `\\s*(?:-{1,}|\\.{1,}|={1,})[->.]*(?:\\|[^|]*\\|)?\\s*`;
  const edgeRe = new RegExp(
    `(^|[^\\w\\u4e00-\\u9fff])(${sEsc})${shapeRe}${connectorRe}(${tEsc})${shapeRe}(?![\\w\\u4e00-\\u9fff])`
  );
  const onlyEdgeRe = new RegExp(
    `^(${sEsc})${shapeRe}${connectorRe}(${tEsc})${shapeRe}$`
  );
  const kept = [];
  let removed = false;
  for (const line of lines) {
    if (!removed && edgeRe.test(line)) {
      const indent = (line.match(/^\s*/) || [''])[0];
      const trimmed = line.trim();
      const om = onlyEdgeRe.exec(trimmed);
      if (om) {
        // 整行即这条连线：删掉连线但保留两端的 shape 节点定义（若有）
        const sDef = om[2] ? `${om[1]}${om[2]}` : '';
        const tDef = om[4] ? `${om[3]}${om[4]}` : '';
        if (sDef) kept.push(`${indent}${sDef}`);
        if (tDef) kept.push(`${indent}${tDef}`);
        // 两端都没有 shape（裸 ID），证明节点定义在别处，整行直接丢弃
        removed = true;
        continue;
      }
      // 行内还有其他内容：只将这段连线替换为两端 shape 定义（以分号连接）
      const newLine = line.replace(edgeRe, (_full, lead, sId, sShape, tId, tShape) => {
        const parts = [];
        if (sShape) parts.push(`${sId}${sShape}`);
        if (tShape) parts.push(`${tId}${tShape}`);
        if (parts.length === 0) return lead;
        return `${lead}${parts.join('; ')}`;
      });
      kept.push(newLine);
      removed = true;
    } else {
      kept.push(line);
    }
  }
  return kept.join('\n');
}

async function doDelete() {
  // 1) 选中节点/连线/子图优先
  if (selectionState) {
    historyPush();
    if (selectionState.type === 'node') {
      const key = selectionState.key;
      const nodeEl = selectionState.element;
      mermaidEditor.value = removeNodeFromSource(mermaidEditor.value, key);
      // 免重渲染：直接从 DOM 移除节点 + 相关连线
      removeNodeDomArtifacts(nodeEl, key);
      clearSelection();
      setActiveTab('mermaid');
      historyPush();
      setStatus(`已删除节点及相关连线: ${key}（布局保持）`, 'ok');
    } else if (selectionState.type === 'cluster') {
      const key = selectionState.key;
      const before = mermaidEditor.value;
      let after = removeClusterFromSource(before, key);
      let usedKey = key;
      // 容错：如果 key 还带着 svg 前缀（如 mmd_xxx-SG7321），尝试剥离最后一段再试
      if (after === before && /-/.test(key)) {
        const tryKey = key.substring(key.lastIndexOf('-') + 1);
        const retry = removeClusterFromSource(before, tryKey);
        if (retry !== before) { after = retry; usedKey = tryKey; }
      }
      if (after === before) {
        // 反馈源码中实际存在的 subgraph ID 列表，方便用户诊断与指定正确的 key。
        const ids = [];
        const rr = /\bsubgraph\s+("[^"]+"|'[^']+'|[^\s\[\(\{;\r\n]+)/g;
        let mm;
        while ((mm = rr.exec(before))) {
          let idv = mm[1];
          if ((idv.startsWith('"') && idv.endsWith('"')) || (idv.startsWith('\'') && idv.endsWith('\''))) idv = idv.slice(1, -1);
          ids.push(idv);
        }
        setStatus(`未在源码中找到子图 ${key}（源码现有: ${ids.join(', ') || '无'}）`, 'warn');
        return;
      }
      // 先从 DOM 几何匹配拿到实际内部节点的源码 key（比源码解析更可靠），同时完成 DOM 精准移除
      const insideKeys = removeClusterDomArtifacts(selectionState.element, usedKey);

      // 额外清理：写在 subgraph block 外面、引用了内部节点 ID 的跨子图连线行
      // 不处理则会留下悬挂引用，下次自动布局时 Mermaid 会隐式创建空节点
      after = stripEdgesReferencingIds(after, insideKeys);

      mermaidEditor.value = after;
      clearSelection();
      setActiveTab('mermaid');
      historyPush();
      setStatus(`已删除子图: ${usedKey}（布局保持）`, 'ok');
    } else if (selectionState.type === 'edge') {
      const entry = selectionState.entry;
      const { sourceKey, targetKey } = entry;
      const before = mermaidEditor.value;
      const { after, usedSource, usedTarget } = removeEdgeWithFallback(before, entry);
      if (before === after) {
        setStatus(`删除连线失败：源码中未匹配到 ${sourceKey} → ${targetKey}（也尝试了祖先 cluster 组合）`, 'warn');
        return;
      }
      const delta = before.length - after.length;
      // 只改源码 + 从 DOM 移除该连线的 path/label/marker；不触发 Mermaid 重渲染，保证其他布局丝毫不动。
      mermaidEditor.value = after;
      removeEdgeDomArtifacts(entry);
      manualLayoutState.edgeRegistry = manualLayoutState.edgeRegistry.filter((e) => e.pathElement !== entry.pathElement);
      clearSelection();
      setActiveTab('mermaid');
      historyPush();
      if (usedSource !== sourceKey || usedTarget !== targetKey) {
        setStatus(`已删除连线: ${usedSource} → ${usedTarget}（回退到祖先 cluster，布局保持）`, 'ok');
      } else {
        setStatus(`已删除连线: ${sourceKey} → ${targetKey}（源码减少 ${delta} 字符，布局保持）`, 'ok');
      }
    }
    return;
  }

  // 2) 退化到 textarea 选区删除
  const editor = getActiveEditor();
  if (document.activeElement === editor) {
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    if (start !== end) {
      historyPush();
      replaceSelection(editor, '');
      historyPush();
      setStatus('已删除选中内容', 'ok');
      return;
    }
  }
  setStatus('请先在画布上选中节点/连线，或在编辑器中选中文本', 'info');
}

async function doCut() {
  if (selectionState) {
    if (selectionState.type === 'node') {
      const key = selectionState.key;
      const nodeEl = selectionState.element;
      const fragment = extractNodeDefFragment(mermaidEditor.value, key);
      internalClipboard = { type: 'node', text: fragment };
      await writeClipboardSafe(fragment);
      historyPush();
      mermaidEditor.value = removeNodeFromSource(mermaidEditor.value, key);
      removeNodeDomArtifacts(nodeEl, key);
      clearSelection();
      setActiveTab('mermaid');
      historyPush();
      setStatus(`已剪切节点: ${key}（布局保持）`, 'ok');
      return;
    }
    if (selectionState.type === 'cluster') {
      let key = selectionState.key;
      let fragment = extractClusterFragment(mermaidEditor.value, key);
      // 容错：如果 key 还带着 svg 前缀，尝试剥离最后一段再试
      if (!fragment && /-/.test(key)) {
        const tryKey = key.substring(key.lastIndexOf('-') + 1);
        const retry = extractClusterFragment(mermaidEditor.value, tryKey);
        if (retry) { fragment = retry; key = tryKey; }
      }
      if (!fragment) {
        setStatus(`未找到子图 ${selectionState.key} 的源码`, 'warn');
        return;
      }
      internalClipboard = { type: 'cluster', text: fragment };
      await writeClipboardSafe(fragment);
      historyPush();
      // 几何匹配取出实际内部节点 key，同时完成 DOM 移除
      const insideKeys = removeClusterDomArtifacts(selectionState.element, key);

      let nextSrc = removeClusterFromSource(mermaidEditor.value, key);
      // 清理 block 外跨子图连线，避免下次 render 时 Mermaid 隐式创建空节点
      nextSrc = stripEdgesReferencingIds(nextSrc, insideKeys);
      mermaidEditor.value = nextSrc;
      clearSelection();
      setActiveTab('mermaid');
      historyPush();
      setStatus(`已剪切子图: ${key}（布局保持）`, 'ok');
      return;
    }
    if (selectionState.type === 'edge') {
      const entry = selectionState.entry;
      const { sourceKey, targetKey } = entry;
      const before = mermaidEditor.value;
      const { after, usedSource, usedTarget } = removeEdgeWithFallback(before, entry);
      if (before === after) {
        setStatus(`剪切连线失败：源码中未匹配到 ${sourceKey} → ${targetKey}`, 'warn');
        return;
      }
      const text = `${usedSource} --> ${usedTarget}`;
      internalClipboard = { type: 'edge', text };
      await writeClipboardSafe(text);
      historyPush();
      mermaidEditor.value = after;
      // 同 delete：不触发 render，直接从 DOM 移除 path
      removeEdgeDomArtifacts(entry);
      manualLayoutState.edgeRegistry = manualLayoutState.edgeRegistry.filter((e) => e.pathElement !== entry.pathElement);
      clearSelection();
      setActiveTab('mermaid');
      historyPush();
      if (usedSource !== sourceKey || usedTarget !== targetKey) {
        setStatus(`已剪切连线: ${usedSource} → ${usedTarget}（回退到 cluster，布局保持）`, 'ok');
      } else {
        setStatus(`已剪切连线: ${sourceKey} → ${targetKey}（布局保持）`, 'ok');
      }
      return;
    }
  }
  // 退化到 textarea
  const editor = getActiveEditor();
  editor.focus();
  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  if (start === end) {
    setStatus('请先选中节点/连线或文本', 'info');
    return;
  }
  const text = editor.value.slice(start, end);
  await writeClipboardSafe(text);
  internalClipboard = null;
  replaceSelection(editor, '');
  setStatus('已剪切', 'ok');
}

async function doCopy() {
  if (selectionState) {
    if (selectionState.type === 'node') {
      const key = selectionState.key;
      const fragment = extractNodeDefFragment(mermaidEditor.value, key);
      internalClipboard = { type: 'node', text: fragment };
      await writeClipboardSafe(fragment);
      setStatus(`已复制节点: ${key}`, 'ok');
      return;
    }
    if (selectionState.type === 'cluster') {
      const key = selectionState.key;
      const fragment = extractClusterFragment(mermaidEditor.value, key);
      if (!fragment) {
        setStatus(`复制子图失败：源码中未找到 subgraph ${key}`, 'warn');
        return;
      }
      internalClipboard = { type: 'cluster', text: fragment };
      await writeClipboardSafe(fragment);
      const lineCnt = fragment.split(/\r?\n/).length;
      setStatus(`已复制子图: ${key}（${lineCnt} 行 / ${fragment.length} 字符）`, 'ok');
      return;
    }
    if (selectionState.type === 'edge') {
      const { sourceKey, targetKey } = selectionState.entry;
      const text = `${sourceKey} --> ${targetKey}`;
      internalClipboard = { type: 'edge', text };
      await writeClipboardSafe(text);
      setStatus(`已复制连线: ${sourceKey} → ${targetKey}`, 'ok');
      return;
    }
  }
  const editor = getActiveEditor();
  editor.focus();
  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  if (start === end) {
    setStatus('请先选中节点/连线或文本', 'info');
    return;
  }
  const text = editor.value.slice(start, end);
  await writeClipboardSafe(text);
  internalClipboard = null;
  setStatus('已复制', 'ok');
}

async function doPaste() {
  // 若内部剪贴板存在节点/连线/子图片段，则追加到 mermaid 源
  if (internalClipboard && internalClipboard.text) {
    historyPush();
    let doneMsg = '已粘贴';
    let doneKind = 'ok';
    if (internalClipboard.type === 'node') {
      // 为避免 ID 冲突，自动改为 <原ID>_copy_<时间戳各 3位>
      const frag = internalClipboard.text;
      const m = frag.match(/^(\w[\w\u4e00-\u9fff]*)(\s*[\[\(\{].*[\]\)\}])\s*$/);
      let newNodeKey = '';
      if (m) {
        const suffix = Date.now().toString().slice(-3);
        newNodeKey = `${m[1]}_copy_${suffix}`;
        const newFrag = `${newNodeKey}${m[2]}`;
        appendMermaidLine(`  ${newFrag}`);
        doneMsg = `已粘贴节点: ${newNodeKey}（布局保持）`;
      } else {
        appendMermaidLine(`  ${frag}`);
      }
      // 尝试原位粘贴单节点（不触发全量重渲染）
      setActiveTab('mermaid');
      if (newNodeKey) {
        const ok = await pasteNodeInPlace(newNodeKey);
        if (ok) {
          historyPush();
          setStatus(doneMsg, doneKind);
          return;
        }
      }
      // 回退：走下方的全量 renderMermaid
      if (newNodeKey) doneMsg = `已粘贴节点: ${newNodeKey}`;
    } else if (internalClipboard.type === 'cluster') {
      // 整块子图片段：改写 subgraph ID + 内部所有节点 ID 避免冲突
      const suffix = Date.now().toString().slice(-3);
      let newId = '';
      let block = String(internalClipboard.text).replace(
        /(^|\n)(\s*subgraph\s+)("[^"]+"|'[^']+'|[^\s\[\(\{;\r\n]+)/,
        (_all, lead, p2, id) => {
          let cleanId = id;
          if ((cleanId.startsWith('"') && cleanId.endsWith('"')) || (cleanId.startsWith('\'') && cleanId.endsWith('\''))) {
            cleanId = cleanId.slice(1, -1);
          }
          newId = `${cleanId}_copy_${suffix}`;
          return `${lead}${p2}${newId}`;
        }
      );
      // 重命名 block 内部所有定义的节点 ID（以避免与原子图节点重复导致 Mermaid 折叠为空子图）
      const definedIds = new Set();
      // 任意位置的 `ID[...]` / `ID(...)` / `ID{...}` 都视为定义（包含 `A --> B["..."]` 中的 B）
      const defRe = /(?<![A-Za-z0-9_\u4e00-\u9fff])([A-Za-z_][\w\u4e00-\u9fff]*)\s*[\[\(\{]/g;
      let dm;
      while ((dm = defRe.exec(block))) {
        definedIds.add(dm[1]);
      }
      // 同时也将裸 ID 引用（`A --> B`、`A -- B`）两端纳入 —— 如果它们同时在本 block 里被定义过
      // （未在 definedIds 中的引用表示定义在子图之外，保持不改）
      // 排除与新 subgraph id 重名、以及关键字
      ['subgraph', 'end', 'direction', newId].forEach((k) => definedIds.delete(k));
      // 按长度降序替换，避免短 ID 先被替换导致反复叠加
      const sortedIds = Array.from(definedIds).sort((a, b) => b.length - a.length);
      // 简易“引号内保护”：先把引号段抽出替为占位，替换完再还原
      const quoted = [];
      block = block.replace(/"[^"\n]*"|'[^'\n]*'/g, (m) => {
        quoted.push(m);
        return `\u0001QSTR${quoted.length - 1}\u0002`;
      });
      sortedIds.forEach((id) => {
        const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(`(?<![A-Za-z0-9_\\u4e00-\\u9fff])${esc}(?![A-Za-z0-9_\\u4e00-\\u9fff])`, 'g');
        block = block.replace(re, `${id}_copy_${suffix}`);
      });
      // 还原引号
      block = block.replace(/\u0001QSTR(\d+)\u0002/g, (_m, i) => quoted[Number(i)]);
      const current = mermaidEditor.value;
      const needsNewline = current.length && !current.endsWith('\n');
      mermaidEditor.value = current + (needsNewline ? '\n' : '') + block + (block.endsWith('\n') ? '' : '\n');
      doneMsg = `已粘贴子图: ${newId || '(新)'}（${block.split(/\r?\n/).length} 行，重命名 ${sortedIds.length} 个节点，布局保持）`;

      // 尝试原位粘贴（不触发全量重渲染）：所有原 block 内定义过的 ID 都被 rename 为 `<id>_copy_<suffix>`
      setActiveTab('mermaid');
      const addedKeys = sortedIds.map((id) => `${id}_copy_${suffix}`);
      const ok = await pasteClusterInPlace(newId, addedKeys);
      if (ok) {
        historyPush();
        setStatus(doneMsg, doneKind);
        return;
      }
      // 回退：继续走下方的全量 renderMermaid
      doneMsg = `已粘贴子图: ${newId || '(新)'}（${block.split(/\r?\n/).length} 行，重命名 ${sortedIds.length} 个节点）`;
    } else {
      appendMermaidLine(`  ${internalClipboard.text}`);
    }
    setActiveTab('mermaid');
    await renderMermaid();
    historyPush();
    setStatus(doneMsg, doneKind);
    return;
  }
  // 退化到 textarea 粘贴
  const editor = getActiveEditor();
  editor.focus();
  try {
    const text = await navigator.clipboard.readText();
    replaceSelection(editor, text);
    setStatus('已粘贴', 'ok');
  } catch (err) {
    setStatus(`粘贴失败: ${err.message || err}`, 'error');
  }
}

async function doSave() {
  // 根据当前模式保存为 .mmd / .md
  if (activeTab === 'mermaid') {
    const result = await window.mmeApi.saveText({
      content: mermaidEditor.value || '',
      defaultName: 'diagram.mmd',
      filters: [
        { name: 'Mermaid', extensions: ['mmd', 'mermaid'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });
    if (!result.canceled) setStatus(`Mermaid 已保存: ${result.filePath}`, 'ok');
  } else {
    const result = await window.mmeApi.saveText({
      content: markdownEditor.value || '',
      defaultName: 'document.md',
      filters: [
        { name: 'Markdown', extensions: ['md', 'markdown'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });
    if (!result.canceled) setStatus(`Markdown 已保存: ${result.filePath}`, 'ok');
  }
}

async function doSaveAs() {
  // 目前 saveText 始终弹出系统对话框，等同于另存为
  await doSave();
}

async function doExport(kind) {
  if (kind === 'png') {
    await exportPng();
    return;
  }
  if (kind === 'svg') {
    const currentSvg = getCurrentPreviewSvg();
    if (!currentSvg) { setStatus('没有可导出的 Mermaid 图形', 'error'); return; }
    const result = await window.mmeApi.exportSvg(currentSvg);
    if (!result.canceled) setStatus(`SVG 已导出: ${result.filePath}`, 'ok');
    return;
  }
  if (kind === 'docx') {
    const result = await window.mmeApi.exportDocx(markdownEditor.value || '');
    if (!result.canceled) setStatus(`DOCX 已导出: ${result.filePath}`, 'ok');
    return;
  }
  if (kind === 'visio') {
    const currentSvg = getCurrentPreviewSvg();
    if (!currentSvg) { setStatus('没有可导出的 Mermaid 图形', 'error'); return; }
    const result = await window.mmeApi.exportVisio(currentSvg);
    if (!result.canceled) {
      if (result.warning) setStatus(`Visio 导出有警告: ${result.warning}`, 'error');
      else setStatus(`Visio 已导出: ${result.filePath}`, 'ok');
    }
  }
}

// ===== 下拉菜单开关 =====
function bindDropdowns() {
  const dropdowns = document.querySelectorAll('.dropdown');
  dropdowns.forEach((dd) => {
    const trigger = dd.querySelector('.tool-btn');
    const menu = dd.querySelector('.dropdown-menu');
    if (!trigger || !menu) return;
    trigger.addEventListener('click', (event) => {
      event.stopPropagation();
      // 关闭其他下拉
      dropdowns.forEach((other) => {
        if (other !== dd) other.classList.remove('open');
      });
      const willOpen = !dd.classList.contains('open');
      dd.classList.toggle('open', willOpen);
      if (willOpen) {
        // 按钮度量位置，用 fixed 摆放，避免被 backdrop-filter 创建的 stacking context 遮挡
        const r = trigger.getBoundingClientRect();
        menu.style.position = 'fixed';
        menu.style.top = (r.bottom + 4) + 'px';
        menu.style.left = r.left + 'px';
        menu.style.zIndex = '9999';
      }
    });
  });

  document.addEventListener('click', () => {
    dropdowns.forEach((dd) => dd.classList.remove('open'));
  });
  window.addEventListener('resize', () => {
    dropdowns.forEach((dd) => dd.classList.remove('open'));
  });
}

function closeAllDropdowns() {
  document.querySelectorAll('.dropdown.open').forEach((dd) => dd.classList.remove('open'));
}

function bindEvents() {
  // 帮助文档对话框开关
  (function bindHelpDialog() {
    const btnHelp = document.getElementById('btnHelp');
    const dlg = document.getElementById('helpDialog');
    const btnClose = document.getElementById('btnCloseHelp');
    if (!btnHelp || !dlg) return;
    const open = () => { dlg.classList.remove('hidden'); dlg.setAttribute('aria-hidden', 'false'); };
    const close = () => { dlg.classList.add('hidden'); dlg.setAttribute('aria-hidden', 'true'); };
    btnHelp.addEventListener('click', open);
    if (btnClose) btnClose.addEventListener('click', close);
    dlg.querySelectorAll('[data-close-help]').forEach((el) => el.addEventListener('click', close));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !dlg.classList.contains('hidden')) close(); });
  })();

  // 文件关联对话框
  (function bindFileAssocDialog() {
    const dlg = document.getElementById('fileAssocDialog');
    const list = document.getElementById('faList');
    const exeBox = document.getElementById('faExePath');
    const btnSave = document.getElementById('btnFaSave');
    if (!dlg || !list || !btnSave) return;

    const close = () => { dlg.classList.add('hidden'); dlg.setAttribute('aria-hidden', 'true'); };

    const open = async () => {
      list.innerHTML = '<div style="color:#888;">加载中...</div>';
      dlg.classList.remove('hidden');
      dlg.setAttribute('aria-hidden', 'false');
      try {
        const info = await window.mmeApi.getFileAssociations();
        exeBox.textContent = '程序路径：' + (info.exe || '');
        const labelMap = {
          '.md': 'Markdown 文档 (.md)',
          '.markdown': 'Markdown 文档 (.markdown)',
          '.mmd': 'Mermaid 脚本 (.mmd)',
          '.mermaid': 'Mermaid 脚本 (.mermaid)',
          '.json': 'Mermaid Editor 工程 (.json)'
        };
        list.innerHTML = '';
        info.exts.forEach((ext) => {
          const row = document.createElement('label');
          row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid var(--border);border-radius:8px;cursor:pointer;background:#fff;';
          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.dataset.ext = ext;
          cb.checked = !!info.state[ext];
          const span = document.createElement('span');
          span.textContent = labelMap[ext] || ext;
          row.appendChild(cb);
          row.appendChild(span);
          list.appendChild(row);
        });
      } catch (err) {
        list.innerHTML = `<div style="color:#c0392b;">读取关联状态失败：${err && err.message || err}</div>`;
      }
    };

    dlg.querySelectorAll('[data-close-fa]').forEach((el) => el.addEventListener('click', close));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !dlg.classList.contains('hidden')) close(); });

    btnSave.addEventListener('click', async () => {
      const selections = {};
      list.querySelectorAll('input[type="checkbox"][data-ext]').forEach((cb) => {
        selections[cb.dataset.ext] = cb.checked;
      });
      btnSave.disabled = true;
      btnSave.textContent = '保存中...';
      try {
        const r = await window.mmeApi.setFileAssociations(selections);
        if (r && r.ok) {
          setStatus('文件关联已更新', 'ok');
          close();
        } else {
          setStatus(`文件关联更新失败：${r && r.error || '未知错误'}`, 'error');
        }
      } catch (err) {
        setStatus(`文件关联更新失败：${err && err.message || err}`, 'error');
      } finally {
        btnSave.disabled = false;
        btnSave.textContent = '保存';
      }
    });

    // 外部菜单触发
    if (typeof window.mmeApi.onMenuAction === 'function') {
      window.mmeApi.onMenuAction('menu:file-associations', open);
    }
  })();

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => setActiveTab(tab.dataset.tab));
  });

  mermaidEditor.addEventListener('input', async () => {
    historySchedulePush();
    if (autoUpdate) {
      await renderMermaid();
    }
  });

  markdownEditor.addEventListener('input', () => {
    historySchedulePush();
    if (autoUpdate) {
      renderMarkdown();
    }
  });

  autoUpdateSwitch.addEventListener('change', async () => {
    autoUpdate = autoUpdateSwitch.checked;
    await window.mmeApi.setSettings({ autoUpdate });
    setStatus(autoUpdate ? '已开启自动更新' : '已关闭自动更新');
    if (autoUpdate) {
      await renderAll();
    }
  });

  // 菜单动作绑定（原生菜单）
  window.mmeApi.onMenuAction('menu:open', handleOpen);
  // 关联文件双击 / 命令行参数传入的文件
  if (typeof window.mmeApi.onFileOpen === 'function') {
    window.mmeApi.onFileOpen((payload) => { applyOpenedFile(payload); });
  }
  window.mmeApi.onMenuAction('menu:save-project', handleSaveProject);
  window.mmeApi.onMenuAction('menu:print', openPrintDialog);
  window.mmeApi.onMenuAction('menu:export-svg', () => doExport('svg'));
  window.mmeApi.onMenuAction('menu:export-png', () => doExport('png'));
  window.mmeApi.onMenuAction('menu:export-docx', () => doExport('docx'));
  window.mmeApi.onMenuAction('menu:export-visio', () => doExport('visio'));
  window.mmeApi.onMenuAction('menu:zoom-in', () => { zoom = Math.min(zoom + 0.1, 2.5); updateZoom(); });
  window.mmeApi.onMenuAction('menu:zoom-out', () => { zoom = Math.max(zoom - 0.1, 0.4); updateZoom(); });
  window.mmeApi.onMenuAction('menu:zoom-reset', () => { zoom = 1; updateZoom(); });
  window.mmeApi.onMenuAction('menu:toggle-grid', () => canvasViewport.classList.toggle('no-grid'));
  window.mmeApi.onMenuAction('menu:toggle-layout', () => toggleManualLayoutButton.click());

  // 下拉菜单展开/收起
  bindDropdowns();

  // 防御：完全重建“新增”下拉菜单内容，绕开任何 HTML 解析/缓存问题
  (function rebuildAddMenu() {
    const addBtn = document.getElementById('btnAddMenu');
    if (!addBtn) return;
    const menu = addBtn.parentElement && addBtn.parentElement.querySelector('.dropdown-menu');
    if (!menu) return;
    menu.innerHTML = ''
      + '<li><button data-add="node"><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="2.5" y="4.5" width="11" height="7" rx="1"/></svg>节点（文本框）</button></li>'
      + '<li><button data-add="edge"><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M2 8h10"/><path d="M9 5l3 3-3 3"/></svg>连线</button></li>'
      + '<li><button data-add="subgraph"><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-dasharray="2,1.5"><rect x="1.5" y="2.5" width="13" height="11" rx="1"/></svg>子图 / 分组</button></li>';
    addBtn.addEventListener('click', () => {
      setStatus(`新增菜单已打开（${menu.children.length} 项）`, 'info');
    });
  })();

  // 关键：用 showContextMenu 作为“新增”按钮的绝对可见 fallback
  (function hookAddBtnToContextMenu() {
    const addBtn = document.getElementById('btnAddMenu');
    if (!addBtn) return;
    addBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      ev.preventDefault();
      closeAllDropdowns();
      const r = addBtn.getBoundingClientRect();
      if (typeof showContextMenu === 'function') {
        showContextMenu(r.left, r.bottom + 4, [
          { label: '节点（文本框）', onClick: doAddNode },
          { label: '连线', onClick: () => { if (connectModeState) exitConnectMode(); else enterConnectMode(); } },
          { label: '子图 / 分组', onClick: doAddSubgraph }
        ]);
      }
    }, true); // capture 阶段拦截，先于 bindDropdowns 的 toggle
  })();
  // 新增：下拉项（事件委托，兼容动态插入的项）
  document.addEventListener('click', (event) => {
    const btn = event.target.closest && event.target.closest('[data-add]');
    if (!btn) return;
    event.stopPropagation();
    closeAllDropdowns();
    const kind = btn.getAttribute('data-add');
    if (kind === 'node') {
      doAddNode();
    } else if (kind === 'edge') {
      if (connectModeState) exitConnectMode();
      else enterConnectMode();
    } else if (kind === 'subgraph') {
      doAddSubgraph();
    }
  });

  // 导出下拉项
  document.querySelectorAll('[data-export]').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      closeAllDropdowns();
      const kind = btn.getAttribute('data-export');
      doExport(kind);
    });
  });

  // 通用工具按钮
  document.getElementById('btnDelete').addEventListener('click', doDelete);
  document.getElementById('btnCut').addEventListener('click', doCut);
  document.getElementById('btnCopy').addEventListener('click', doCopy);
  document.getElementById('btnPaste').addEventListener('click', doPaste);
  document.getElementById('btnUndo').addEventListener('click', doUndo);
  document.getElementById('btnRedo').addEventListener('click', doRedo);
  document.getElementById('btnSave').addEventListener('click', doSave);
  document.getElementById('btnSaveAs').addEventListener('click', doSaveAs);
  document.getElementById('btnOpen').addEventListener('click', handleOpen);
  document.getElementById('btnPrintEntry').addEventListener('click', openPrintDialog);

  // 画布右侧缩放 / 网格 / 拖拽布局
  document.getElementById('zoomIn').addEventListener('click', () => {
    zoom = Math.min(zoom + 0.1, 2.5);
    updateZoom();
  });

  document.getElementById('zoomOut').addEventListener('click', () => {
    zoom = Math.max(zoom - 0.1, 0.4);
    updateZoom();
  });

  document.getElementById('zoomReset').addEventListener('click', () => {
    zoom = 1;
    updateZoom();
  });

  document.getElementById('toggleGrid').addEventListener('click', () => {
    canvasViewport.classList.toggle('no-grid');
  });

  toggleManualLayoutButton.addEventListener('click', () => {
    manualLayoutEnabled = !manualLayoutEnabled;
    toggleManualLayoutButton.classList.toggle('active', manualLayoutEnabled);
    const svgElement = mermaidPreview.querySelector('svg');
    if (svgElement) {
      svgElement.classList.toggle('manual-layout', manualLayoutEnabled);
    }
    setStatus(manualLayoutEnabled ? '已开启拖拽布局' : '已关闭拖拽布局');
  });

  // 自动布局：清空所有手动位置/尺寸/边中点，由 Mermaid 重新全量排布并适配窗口
  const btnAutoLayout = document.getElementById('btnAutoLayout');
  const btnUndoLayout = document.getElementById('btnUndoLayout');
  if (btnAutoLayout) {
    btnAutoLayout.addEventListener('click', async () => {
      // 保存当前手动布局快照，供"撤销布局"恢复
      lastAutoLayoutSnapshot = {
        nodePositions: new Map(manualLayoutState.nodePositions),
        clusterSizes: new Map(manualLayoutState.clusterSizes),
        edgeMidpoints: new Map(manualLayoutState.edgeMidpoints),
        zoom
      };
      if (btnUndoLayout) btnUndoLayout.disabled = false;

      manualLayoutState.nodePositions.clear();
      manualLayoutState.clusterSizes.clear();
      manualLayoutState.edgeMidpoints.clear();
      // 跳过 renderMermaid 开头的快照（否则刚清空又会被写回）：先把预览 innerHTML 清空
      mermaidPreview.innerHTML = '';
      await renderMermaid();
      const svgElement = mermaidPreview.querySelector('svg');
      if (svgElement) {
        requestAnimationFrame(() => fitSvgViewBox(svgElement));
      }
      zoom = 1;
      if (typeof updateZoom === 'function') updateZoom();
      setStatus('已重新自动布局（可点"撤销布局"恢复）', 'ok');
    });
  }

  if (btnUndoLayout) {
    btnUndoLayout.addEventListener('click', async () => {
      if (!lastAutoLayoutSnapshot) {
        setStatus('没有可撤销的布局', 'warn');
        return;
      }
      manualLayoutState.nodePositions = new Map(lastAutoLayoutSnapshot.nodePositions);
      manualLayoutState.clusterSizes = new Map(lastAutoLayoutSnapshot.clusterSizes);
      manualLayoutState.edgeMidpoints = new Map(lastAutoLayoutSnapshot.edgeMidpoints);
      const restoredZoom = lastAutoLayoutSnapshot.zoom;
      // 清空预览避免 renderMermaid 开头再次快照当前自动布局覆盖掉恢复的数据
      mermaidPreview.innerHTML = '';
      await renderMermaid();
      if (Number.isFinite(restoredZoom)) {
        zoom = restoredZoom;
        if (typeof updateZoom === 'function') updateZoom();
      }
      lastAutoLayoutSnapshot = null;
      btnUndoLayout.disabled = true;
      setStatus('已撤销自动布局，恢复到之前的手动布局', 'ok');
    });
  }

  // ====== Ctrl/滚轮缩放：以鼠标为中心放大缩小（按住 Ctrl 仅缩放，不触发垂直滚动）======
  canvasViewport.addEventListener(
    'wheel',
    (event) => {
      // 按住 Ctrl / Cmd 时为缩放；不按则保持原生滚动
      if (!(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      const rect = canvasViewport.getBoundingClientRect();
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      const oldZoom = zoom;
      const step = event.deltaY > 0 ? -0.1 : 0.1;
      let newZoom = oldZoom + step;
      newZoom = Math.max(0.2, Math.min(3, newZoom));
      if (newZoom === oldZoom) return;
      const contentX = (canvasViewport.scrollLeft + px) / oldZoom;
      const contentY = (canvasViewport.scrollTop + py) / oldZoom;
      zoom = newZoom;
      updateZoom();
      canvasViewport.scrollLeft = contentX * newZoom - px;
      canvasViewport.scrollTop = contentY * newZoom - py;
    },
    { passive: false }
  );

  // ====== 鼠标中键拖拉画布平移 ======
  let panState = null;
  canvasViewport.addEventListener('pointerdown', (event) => {
    if (event.button !== 1) return; // 仅中键
    event.preventDefault();
    panState = {
      startX: event.clientX,
      startY: event.clientY,
      scrollL: canvasViewport.scrollLeft,
      scrollT: canvasViewport.scrollTop,
      pointerId: event.pointerId
    };
    try { canvasViewport.setPointerCapture(event.pointerId); } catch {}
    canvasViewport.style.cursor = 'grabbing';
  });
  canvasViewport.addEventListener('pointermove', (event) => {
    if (!panState || event.pointerId !== panState.pointerId) return;
    canvasViewport.scrollLeft = panState.scrollL - (event.clientX - panState.startX);
    canvasViewport.scrollTop = panState.scrollT - (event.clientY - panState.startY);
  });
  const endPan = (event) => {
    if (!panState) return;
    try { canvasViewport.releasePointerCapture(panState.pointerId); } catch {}
    panState = null;
    canvasViewport.style.cursor = '';
  };
  canvasViewport.addEventListener('pointerup', endPan);
  canvasViewport.addEventListener('pointercancel', endPan);
  // 阻止中键点击默认的 Windows auto-scroll 圆盘
  canvasViewport.addEventListener('mousedown', (event) => {
    if (event.button === 1) event.preventDefault();
  });
  canvasViewport.addEventListener('auxclick', (event) => {
    if (event.button === 1) event.preventDefault();
  });

  // ====== 左右面板分隔条拖拽调整 ======
  const workspaceSplitter = document.getElementById('workspaceSplitter');
  const workspaceEl = document.querySelector('.workspace');
  if (workspaceSplitter && workspaceEl) {
    workspaceSplitter.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      workspaceSplitter.classList.add('dragging');
      try { workspaceSplitter.setPointerCapture(event.pointerId); } catch {}
      const startX = event.clientX;
      const wsRect = workspaceEl.getBoundingClientRect();
      const leftPanel = workspaceEl.querySelector('.code-panel');
      const startWidth = leftPanel ? leftPanel.getBoundingClientRect().width : wsRect.width * 0.4;
      const onMove = (ev) => {
        let newWidth = startWidth + (ev.clientX - startX);
        const min = 240;
        const max = wsRect.width - 320;
        if (newWidth < min) newWidth = min;
        if (newWidth > max) newWidth = max;
        workspaceEl.style.setProperty('--code-panel-width', `${newWidth}px`);
      };
      const onUp = (ev) => {
        workspaceSplitter.classList.remove('dragging');
        try { workspaceSplitter.releasePointerCapture(ev.pointerId); } catch {}
        workspaceSplitter.removeEventListener('pointermove', onMove);
        workspaceSplitter.removeEventListener('pointerup', onUp);
        workspaceSplitter.removeEventListener('pointercancel', onUp);
      };
      workspaceSplitter.addEventListener('pointermove', onMove);
      workspaceSplitter.addEventListener('pointerup', onUp);
      workspaceSplitter.addEventListener('pointercancel', onUp);
    });
    // 双击分隔条：恢复默认宽度（40%）
    workspaceSplitter.addEventListener('dblclick', () => {
      workspaceEl.style.removeProperty('--code-panel-width');
      setStatus('已恢复默认面板宽度', 'info');
    });
  }

  // 打印对话框
  document.getElementById('btnClosePrintDialog').addEventListener('click', closePrintDialog);
  document.querySelector('[data-close-dialog="true"]').addEventListener('click', closePrintDialog);
  document.getElementById('btnRefreshPreview').addEventListener('click', refreshPrintPreview);
  document.getElementById('btnConfirmPrint').addEventListener('click', executePrint);
  printContentSelect.addEventListener('change', refreshPrintPreview);

  // 全局快捷键
  document.addEventListener('keydown', async (event) => {
    const isMod = event.ctrlKey || event.metaKey;
    if (event.key === 'Escape') {
      if (connectModeState) { exitConnectMode(); return; }
      if (!inputDialog.classList.contains('hidden')) { closeInputDialog(null); return; }
    }
    // 判断当前焦点是否在可编辑文本控件内，避免拦截原生复制/粘贴/删除行为。
    const activeEl = document.activeElement;
    const isEditingText = activeEl && (
      activeEl.tagName === 'INPUT' ||
      activeEl.tagName === 'TEXTAREA' ||
      activeEl.isContentEditable
    );

    // Del / Backspace 删除图形对象（仅在非文本输入、且有选中时）
    if ((event.key === 'Delete' || event.key === 'Del') && !isEditingText && selectionState) {
      event.preventDefault();
      await doDelete();
      return;
    }

    if (!isMod) return;
    const key = event.key.toLowerCase();
    // Ctrl+X / Ctrl+C / Ctrl+V 对图形对象起作用（非文本输入场景）
    if (!isEditingText) {
      if (key === 'x' && selectionState) {
        event.preventDefault();
        await doCut();
        return;
      }
      if (key === 'c' && selectionState) {
        event.preventDefault();
        await doCopy();
        return;
      }
      if (key === 'v') {
        event.preventDefault();
        await doPaste();
        return;
      }
    }
    if (key === 'z' && !event.shiftKey) {
      event.preventDefault();
      await doUndo();
    } else if ((key === 'y') || (key === 'z' && event.shiftKey)) {
      event.preventDefault();
      await doRedo();
    } else if (key === 's') {
      event.preventDefault();
      if (event.shiftKey) await doSaveAs();
      else await doSave();
    } else if (key === 'o') {
      event.preventDefault();
      await handleOpen();
    } else if (key === 'p') {
      event.preventDefault();
      openPrintDialog();
    }
  });
}

// ===== 子图源码处理 =====
// 基于字符级关键字扫描定位目标 subgraph 的 [startIdx, endIdx)
// 支持嵌套 subgraph，且 `end` 和其他内容同行也能正确识别。
function _locateClusterRange(source, key) {
  const src = String(source || '');
  const k = String(key || '');
  if (!k) return null;

  // 采用最简单的 indexOf 遍历定位，寻找形如 `subgraph <KEY>` 或 `subgraph "<KEY>"` 或 `subgraph '<KEY>'` 的出现点。
  const needles = [
    `subgraph ${k}`,
    `subgraph "${k}"`,
    `subgraph '${k}'`,
    `subgraph\t${k}`,
  ];
  let startIdx = -1;
  let afterStart = -1;
  for (const needle of needles) {
    let from = 0;
    while (from <= src.length) {
      const pos = src.indexOf(needle, from);
      if (pos < 0) break;
      // 前边界：必须是行首或非标识符字符（避免 mysubgraph xxx 误匹）
      const prev = pos === 0 ? '\n' : src[pos - 1];
      const isWordChar = /[A-Za-z0-9_]/.test(prev);
      if (isWordChar) { from = pos + 1; continue; }
      // 后边界：needle 末尾之后应为 \s/[/(/{/;/行尾
      const endOfNeedle = pos + needle.length;
      const nextCh = endOfNeedle < src.length ? src[endOfNeedle] : '\n';
      if (nextCh && /[A-Za-z0-9_\u4e00-\u9fff]/.test(nextCh)) {
        // 不是完整词界，跳过
        from = pos + 1;
        continue;
      }
      startIdx = pos;
      afterStart = endOfNeedle;
      break;
    }
    if (startIdx >= 0) break;
  }
  if (startIdx < 0) return null;

  // 开始深度扫描匹配的 end
  const tokenRe = /\b(subgraph|end)\b/g;
  tokenRe.lastIndex = afterStart;
  let depth = 1;
  let endIdx = -1;
  let m;
  while ((m = tokenRe.exec(src))) {
    if (m[1] === 'subgraph') depth++;
    else if (m[1] === 'end') {
      depth--;
      if (depth === 0) { endIdx = m.index + m[0].length; break; }
    }
  }
  if (endIdx === -1) return null;
  return { startIdx, endIdx };
}

function extractClusterFragment(source, key) {
  const range = _locateClusterRange(source, key);
  if (!range) return '';
  return String(source).slice(range.startIdx, range.endIdx);
}

function removeClusterFromSource(source, key) {
  const src = String(source || '');
  let range = _locateClusterRange(src, key);
  // 容错 1：原 key 找不到时，尝试在所有 subgraph ID 中做模糊匹配
  if (!range) {
    const ids = [];
    const rr = /\bsubgraph\s+("[^"]+"|'[^']+'|[^\s\[\(\{;\r\n]+)/g;
    let mm;
    while ((mm = rr.exec(src))) {
      let idv = mm[1];
      if ((idv.startsWith('"') && idv.endsWith('"')) || (idv.startsWith('\'') && idv.endsWith('\''))) idv = idv.slice(1, -1);
      ids.push(idv);
    }
    const norm = (s) => String(s || '').replace(/[^A-Za-z0-9\u4e00-\u9fff]/g, '').toLowerCase();
    const nKey = norm(key);
    // 匹配优先级：精确（归一化后）、互为前后缀、互为子串
    let found = ids.find((id) => norm(id) === nKey);
    if (!found) found = ids.find((id) => norm(id).endsWith(nKey) || nKey.endsWith(norm(id)));
    if (!found) found = ids.find((id) => norm(id).includes(nKey) || nKey.includes(norm(id)));
    if (found) range = _locateClusterRange(src, found);
  }
  if (!range) return src;
  const before = src.slice(0, range.startIdx).replace(/\s+$/, '');
  let after = src.slice(range.endIdx).replace(/^[ \t]*\r?\n?/, '');
  const joiner = (before.length && after.length) ? '\n' : '';
  return before + joiner + after;
}

async function editClusterTitle(key) {
  if (!key) return;
  const source = mermaidEditor.value;
  const re = new RegExp(`(^|\\n)(\\s*subgraph\\s+${escapeRegex(key)})(\\s*\\[[^\\]]*\\])?`);
  const m = re.exec(source);
  let current = '';
  if (m && m[3]) {
    let inner = m[3].trim();
    if (inner.startsWith('[') && inner.endsWith(']')) inner = inner.slice(1, -1).trim();
    if (inner.startsWith('"') && inner.endsWith('"')) inner = inner.slice(1, -1);
    current = inner;
  }
  const result = await openInputDialog({
    title: `编辑子图：${key}`,
    hint: '修改子图的显示标题',
    fields: [{ name: 'title', label: '标题', default: current || key }]
  });
  if (!result) return;
  const safe = String(result.title).replace(/"/g, '\\"');
  historyPush();
  if (m) {
    const replacement = `${m[1]}${m[2]}["${safe}"]`;
    mermaidEditor.value = source.replace(re, replacement);
  }
  await renderMermaid();
  historyPush();
  setStatus(`已更新子图标题: ${key}`, 'ok');
}

// ===== 打印按钮轻封装 =====
function doPrint() {
  openPrintDialog();
}

// ===== 右键上下文菜单 =====
const _cmSubmenus = [];
let _cmRoot = null;

function _ensureCmRoot() {
  if (!_cmRoot) _cmRoot = document.getElementById('contextMenu');
  return _cmRoot;
}

function hideContextMenu() {
  while (_cmSubmenus.length) {
    const el = _cmSubmenus.pop();
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }
  const root = _ensureCmRoot();
  if (root) {
    root.classList.add('hidden');
    root.innerHTML = '';
  }
}

function _renderMenuInto(container, items) {
  container.innerHTML = '';
  items.forEach((it) => {
    if (it && it.separator) {
      const sep = document.createElement('div');
      sep.className = 'cm-separator';
      container.appendChild(sep);
      return;
    }
    if (!it || !it.label) return;
    const el = document.createElement('div');
    el.className = 'cm-item' + (it.disabled ? ' disabled' : '') + (it.children ? ' has-children' : '');
    el.setAttribute('role', 'menuitem');
    const lab = document.createElement('span');
    lab.className = 'cm-label';
    lab.textContent = it.label;
    el.appendChild(lab);

    if (!it.disabled) {
      if (it.children) {
        el.addEventListener('mouseenter', () => {
          // 关闭其他子菜单（同级）
          while (_cmSubmenus.length) {
            const last = _cmSubmenus.pop();
            if (last && last.parentNode) last.parentNode.removeChild(last);
          }
          const sub = document.createElement('div');
          sub.className = 'context-menu';
          _renderMenuInto(sub, it.children);
          document.body.appendChild(sub);
          const r = el.getBoundingClientRect();
          let left = r.right + 2;
          let top = r.top;
          const sr = sub.getBoundingClientRect();
          if (left + sr.width > window.innerWidth) left = Math.max(0, r.left - sr.width - 2);
          if (top + sr.height > window.innerHeight) top = Math.max(0, window.innerHeight - sr.height - 4);
          sub.style.left = left + 'px';
          sub.style.top = top + 'px';
          _cmSubmenus.push(sub);
        });
      } else {
        el.addEventListener('click', (event) => {
          event.stopPropagation();
          hideContextMenu();
          try { it.onClick && it.onClick(); } catch (err) {
            setStatus(`操作失败: ${err && err.message || err}`, 'error');
          }
        });
      }
    }
    container.appendChild(el);
  });
}

function showContextMenu(x, y, items) {
  hideContextMenu();
  const root = _ensureCmRoot();
  if (!root) return;
  _renderMenuInto(root, items);
  root.classList.remove('hidden');
  // 防止越界
  const rect = root.getBoundingClientRect();
  let left = x, top = y;
  if (left + rect.width > window.innerWidth) left = Math.max(0, window.innerWidth - rect.width - 4);
  if (top + rect.height > window.innerHeight) top = Math.max(0, window.innerHeight - rect.height - 4);
  root.style.left = left + 'px';
  root.style.top = top + 'px';
}

// 对象右键菜单（节点/连线/子图）
function buildObjectContextMenu() {
  const type = selectionState && selectionState.type;
  const canEdit = type === 'node' || type === 'cluster';
  const canConnectFrom = type === 'node' || type === 'cluster';
  return [
    {
      label: canEdit ? '编辑…' : '编辑',
      disabled: !canEdit,
      onClick: () => {
        if (!selectionState) return;
        if (selectionState.type === 'node') editNodeLabel(selectionState.key);
        else if (selectionState.type === 'cluster') editClusterTitle(selectionState.key);
      }
    },
    {
      label: '新建连接…',
      disabled: !canConnectFrom,
      onClick: () => {
        if (!selectionState || !selectionState.key) return;
        enterConnectModeFromSource(selectionState.key);
      }
    },
    { separator: true },
    { label: '剪切', onClick: doCut },
    { label: '复制', onClick: doCopy },
    { label: '删除', onClick: doDelete }
  ];
}

// 预览空白处右键菜单
function buildCanvasContextMenu() {
  return [
    {
      label: '新建',
      children: [
        { label: '节点（文本框）', onClick: doAddNode },
        { label: '连线', onClick: () => { if (connectModeState) exitConnectMode(); else enterConnectMode(); } },
        { label: '子图 / 分组', onClick: doAddSubgraph }
      ]
    },
    { label: '粘贴', onClick: doPaste },
    { separator: true },
    { label: '撤销', onClick: doUndo },
    { label: '重做', onClick: doRedo },
    { separator: true },
    {
      label: '导出',
      children: [
        { label: 'SVG', onClick: () => doExport('svg') },
        { label: 'PNG', onClick: () => doExport('png') },
        { label: 'DOCX', onClick: () => doExport('docx') },
        { label: 'Visio', onClick: () => doExport('visio') }
      ]
    },
    { label: '打印…', onClick: doPrint }
  ];
}

// 文本 textarea 右键菜单
function buildTextContextMenu(textarea) {
  const hasSel = textarea.selectionStart !== textarea.selectionEnd;
  return [
    { label: '剪切', disabled: !hasSel, onClick: () => _textCut(textarea) },
    { label: '复制', disabled: !hasSel, onClick: () => _textCopy(textarea) },
    { label: '粘贴', onClick: () => _textPaste(textarea) },
    { label: '删除', disabled: !hasSel, onClick: () => _textDelete(textarea) },
    { separator: true },
    { label: '撤销', onClick: doUndo },
    { label: '重做', onClick: doRedo },
    { separator: true },
    { label: '插入 emoji…', onClick: () => openEmojiPicker(textarea) }
  ];
}

async function _textCut(ta) {
  const s = ta.selectionStart, e = ta.selectionEnd;
  if (s === e) return;
  const text = ta.value.slice(s, e);
  await writeClipboardSafe(text);
  historyPush();
  ta.setRangeText('', s, e, 'end');
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  setStatus('已剪切', 'ok');
}
async function _textCopy(ta) {
  const s = ta.selectionStart, e = ta.selectionEnd;
  if (s === e) return;
  const text = ta.value.slice(s, e);
  await writeClipboardSafe(text);
  setStatus('已复制', 'ok');
}
async function _textPaste(ta) {
  try {
    const text = await navigator.clipboard.readText();
    const s = ta.selectionStart, e = ta.selectionEnd;
    historyPush();
    ta.setRangeText(text, s, e, 'end');
    ta.focus();
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    setStatus('已粘贴', 'ok');
  } catch (err) {
    setStatus(`粘贴失败: ${err && err.message || err}`, 'error');
  }
}
function _textDelete(ta) {
  const s = ta.selectionStart, e = ta.selectionEnd;
  if (s === e) return;
  historyPush();
  ta.setRangeText('', s, e, 'end');
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  setStatus('已删除', 'ok');
}

// ===== Emoji 选择器 =====
const EMOJI_GROUPS = [
  { tab: '😀', name: '表情', list: ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😇','🥰','😍','🤩','😘','😗','☺️','😚','😙','🥲','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','😐','😑','😶','🙄','😏','😣','😥','😮','🤫','🤥','😬','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤮','🤧','🥵','🥶','🥴','😵','🤯','🤠','🥸','😈','👿','👹','👺'] },
  { tab: '👍', name: '手势', list: ['👍','👎','👌','🤏','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','🖕','👇','☝️','👋','🤚','🖐️','✋','🖖','👏','🙌','🙏','🤲','🫂','👐','🤝','💪','🦾','🦿','🫀','🫁'] },
  { tab: '❤️', name: '爱心', list: ['❤️','🧡','💛','💚','💙','💜','🤎','🖤','🤍','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟','♥️','💋','🌹','🌺','🌸','🌷','🌻','🌼','💐','🌱','🌲','🌳','🌴'] },
  { tab: '🎉', name: '活动', list: ['🎉','🎊','🎈','🎂','🎁','🎄','🎃','🎗️','🎟️','🎫','🏆','🏅','🥇','🥈','🥉','⚽','🏀','🏈','⚾','🎾','🏐','🏉','🎱','🏓','🏸','🥊','🥋','⛳','⛸️','🎿','🛷','🏹'] },
  { tab: '⚙️', name: '符号', list: ['⚙️','🔧','🔨','🛠️','⛏️','🔩','⚗️','🧪','🧬','🔬','🔭','📡','💡','🔋','🔌','📱','💻','⌨️','🖥️','🖨️','🖱️','💾','💿','📀','📷','📸','📹','🎥','📺','📻','☎️','⏰'] },
  { tab: '✅', name: '指示', list: ['✅','❌','☑️','✔️','✖️','➕','➖','➗','❗','❓','❕','❔','🔴','🟠','🟡','🟢','🔵','🟣','⚫','⚪','⭐','🌟','⚠️','🚨','🔚','🔙','🔛','🔜','🔝','➡️','⬅️','⬆️'] }
];

let _emojiTarget = null;
let _emojiActiveIdx = 0;

function openEmojiPicker(textarea) {
  _emojiTarget = textarea;
  const picker = document.getElementById('emojiPicker');
  const tabs = document.getElementById('emojiTabs');
  const grid = document.getElementById('emojiGrid');
  if (!picker || !tabs || !grid) return;
  // 构建选项卡
  tabs.innerHTML = '';
  EMOJI_GROUPS.forEach((g, idx) => {
    const btn = document.createElement('button');
    btn.className = 'emoji-tab' + (idx === _emojiActiveIdx ? ' active' : '');
    btn.textContent = g.tab;
    btn.title = g.name;
    btn.addEventListener('click', () => {
      _emojiActiveIdx = idx;
      openEmojiPicker(textarea);
    });
    tabs.appendChild(btn);
  });
  // 构建网格
  grid.innerHTML = '';
  const list = EMOJI_GROUPS[_emojiActiveIdx].list;
  list.forEach((em) => {
    const cell = document.createElement('div');
    cell.className = 'emoji-item';
    cell.textContent = em;
    cell.addEventListener('click', () => {
      insertAtCursor(_emojiTarget, em);
    });
    grid.appendChild(cell);
  });
  // 定位：右下方显示
  picker.classList.remove('hidden');
  picker.setAttribute('aria-hidden', 'false');
  const vw = window.innerWidth, vh = window.innerHeight;
  const pw = 340, ph = 360;
  picker.style.left = Math.max(8, (vw - pw) / 2) + 'px';
  picker.style.top = Math.max(8, (vh - ph) / 2) + 'px';
}

function closeEmojiPicker() {
  const picker = document.getElementById('emojiPicker');
  if (!picker) return;
  picker.classList.add('hidden');
  picker.setAttribute('aria-hidden', 'true');
  _emojiTarget = null;
}

function insertAtCursor(textarea, text) {
  if (!textarea) return;
  const s = textarea.selectionStart, e = textarea.selectionEnd;
  historyPush();
  textarea.setRangeText(text, s, e, 'end');
  textarea.focus();
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

// ===== 全局右键事件绑定 =====
function initContextMenus() {
  // 预览卷卡：mermaid
mermaidPreview.addEventListener('contextmenu', (e) => _onPreviewContextMenu(e, mermaidPreview));
  // 预览卷卡：markdown仅供空白右键（没有节点概念）
  markdownPreview.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    clearSelection();
    showContextMenu(e.clientX, e.clientY, buildCanvasContextMenu());
  });
  // 脚本编辑器 textarea
  mermaidEditor.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showContextMenu(e.clientX, e.clientY, buildTextContextMenu(mermaidEditor));
  });
  markdownEditor.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showContextMenu(e.clientX, e.clientY, buildTextContextMenu(markdownEditor));
  });
  // 全局关闭
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.context-menu')) hideContextMenu();
    const picker = document.getElementById('emojiPicker');
    if (picker && !picker.classList.contains('hidden') && !e.target.closest('#emojiPicker') && !e.target.closest('.cm-item')) {
      closeEmojiPicker();
    }
  });
  window.addEventListener('resize', () => { hideContextMenu(); closeEmojiPicker(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { hideContextMenu(); closeEmojiPicker(); }
  });
  // Emoji 关闭按钮
  const btnClose = document.getElementById('emojiClose');
  if (btnClose) btnClose.addEventListener('click', closeEmojiPicker);
}

function _onPreviewContextMenu(e, previewEl) {
  e.preventDefault();
  const svg = previewEl.querySelector('svg');
  if (!svg) {
    clearSelection();
    showContextMenu(e.clientX, e.clientY, buildCanvasContextMenu());
    return;
  }
  // 识别对象：优先节点 g.node，其次连线 path，再次 g.cluster（避免子图遮住内部节点）
  const nodeEl = e.target.closest('g.node');
  if (nodeEl && svg.contains(nodeEl)) {
    // 特殊情况：该 node 其实是被 Mermaid 渲染为 node 的 subgraph
    if (manualLayoutState.nodeIsCluster && manualLayoutState.nodeIsCluster.has(nodeEl)) {
      const key = manualLayoutState.clusterSourceIds.get(nodeEl);
      if (key) {
        setSelection({ type: 'cluster', key, element: nodeEl });
        setStatus(`选中子图(伪装 node): key=${key}`, 'info');
        showContextMenu(e.clientX, e.clientY, buildObjectContextMenu());
        return;
      }
    }
    const key = getNodeKey(nodeEl);
    if (key) {
      setSelection({ type: 'node', key, element: nodeEl });
      showContextMenu(e.clientX, e.clientY, buildObjectContextMenu());
      return;
    }
  }
  const pathEl = e.target.closest('path');
  if (pathEl && svg.contains(pathEl)) {
    const entry = manualLayoutState.edgeRegistry.find((en) => en.pathElement === pathEl);
    if (entry) {
      setSelection({ type: 'edge', entry, element: pathEl });
      showContextMenu(e.clientX, e.clientY, buildObjectContextMenu());
      return;
    }
  }
  const clusterEl = e.target.closest('g.cluster');
  if (clusterEl && svg.contains(clusterEl)) {
    const key = getNodeKey(clusterEl);
    if (key) {
      setSelection({ type: 'cluster', key, element: clusterEl });
      setStatus(`选中子图: key=${key} | DOM id=${clusterEl.getAttribute('id') || '无'}`, 'info');
      showContextMenu(e.clientX, e.clientY, buildObjectContextMenu());
      return;
    }
  }
  // 空白
  clearSelection();
  showContextMenu(e.clientX, e.clientY, buildCanvasContextMenu());
}

async function bootstrap() {
  const settings = await window.mmeApi.getSettings();
  autoUpdate = settings.autoUpdate;
  autoUpdateSwitch.checked = autoUpdate;

  mermaidEditor.value = sampleMermaid;
  markdownEditor.value = sampleMarkdown;

  bindEvents();
  initContextMenus();
  await renderAll();
  historyPush(); // 把初始状态记入历史
}

bootstrap().catch((error) => {
  setStatus(`初始化失败: ${String(error.message || error)}`, 'error');
});
