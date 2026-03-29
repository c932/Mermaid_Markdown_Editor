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

let activeTab = 'mermaid';
let autoUpdate = true;
let zoom = 1;
let renderedSvg = '';
let manualLayoutEnabled = true;
let printerList = [];

const manualLayoutState = {
  nodePositions: new Map(),
  edgeMidpoints: new Map()
};

markedApi.setOptions({
  gfm: true,
  breaks: true
});

mermaidApi.initialize({
  startOnLoad: false,
  theme: 'default',
  securityLevel: 'loose',
  fontFamily: 'Segoe UI'
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
  } else {
    markdownEditor.classList.remove('hidden');
    mermaidEditor.classList.add('hidden');
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
    try {
      block.innerHTML = window.mmeApi.highlightCode(block.textContent || '', language);
      block.classList.add('hljs');
    } catch {
      // Fallback to plain code when highlighting fails.
    }
  });
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
  return /^(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram|journey|gantt|pie)/m.test(content);
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
  const match = value.match(/translate\(([-\d.]+)[ ,]([-\d.]+)\)/i);
  if (!match) {
    return { x: 0, y: 0 };
  }

  return {
    x: Number(match[1]) || 0,
    y: Number(match[2]) || 0
  };
}

function setElementTranslate(element, x, y) {
  element.setAttribute('transform', `translate(${x}, ${y})`);
}

function getElementPointInSvg(svg, element, x, y) {
  const point = svg.createSVGPoint();
  point.x = x;
  point.y = y;
  return point.matrixTransform(element.getCTM());
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

  return svg.querySelector(`[data-id="${escapeSelector(nodeKey)}"]`) || svg.querySelector(`[id="${escapeSelector(nodeKey)}"]`);
}

function extractEdgeMeta(pathElement) {
  const className = pathElement.getAttribute('class') || '';
  const source = className.match(/\bLS-([^\s]+)/)?.[1] || '';
  const target = className.match(/\bLE-([^\s]+)/)?.[1] || '';
  const edgeId = pathElement.getAttribute('data-id') || pathElement.parentElement?.getAttribute('data-id') || `${source}__${target}`;

  return { source, target, edgeId };
}

function getEdgePathElements(svg) {
  return Array.from(svg.querySelectorAll('.edgePath .path, path.flowchart-link, .flowchart-link'));
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

function updateEdgeLabel(svg, edgeId, start, end, midpoint) {
  const labelAnchor = midpoint || {
    x: (start.x + end.x) / 2,
    y: (start.y + end.y) / 2
  };
  const labelNode = svg.querySelector(`.edgeLabel .label[data-id="${escapeSelector(edgeId)}"]`);
  const labelGroup = labelNode ? labelNode.closest('.edgeLabel') : null;

  if (labelGroup) {
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

  const sourceBox = getElementBoxInSvg(svg, sourceNode);
  const targetBox = getElementBoxInSvg(svg, targetNode);
  const start = chooseAnchor(sourceBox, targetBox.center);
  const end = chooseAnchor(targetBox, sourceBox.center);
  const midpoint = manualLayoutState.edgeMidpoints.get(meta.edgeId);
  pathElement.setAttribute('d', buildEdgePath(start, end, midpoint));
  updateEdgeLabel(svg, meta.edgeId, start, end, midpoint);
}

function refreshEdgesForNode(svg, nodeKey) {
  getEdgePathElements(svg).forEach((pathElement) => {
    const meta = extractEdgeMeta(pathElement);
    if (meta.source === nodeKey || meta.target === nodeKey) {
      updateEdgePath(svg, pathElement);
    }
  });
}

function refreshAllEdges(svg) {
  getEdgePathElements(svg).forEach((pathElement) => updateEdgePath(svg, pathElement));
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
  const nodeKey = element.getAttribute('data-id') || element.id;
  if (!nodeKey) {
    return {
      targets: [],
      affectedNodeKeys: []
    };
  }

  const targets = [];
  const seen = new Set();
  const affectedNodeKeys = new Set();
  const basePosition = manualLayoutState.nodePositions.get(nodeKey) || parseTranslate(element.getAttribute('transform'));
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

    const candidateKey = candidate.getAttribute('data-id') || candidate.id;
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
      startPosition: manualLayoutState.nodePositions.get(candidateKey) || parseTranslate(candidate.getAttribute('transform'))
    });
  });

  return {
    targets,
    affectedNodeKeys: Array.from(affectedNodeKeys)
  };
}

function refreshEdgesForNodes(svg, nodeKeys) {
  const relatedKeys = new Set(nodeKeys);
  getEdgePathElements(svg).forEach((pathElement) => {
    const meta = extractEdgeMeta(pathElement);
    if (relatedKeys.has(meta.source) || relatedKeys.has(meta.target)) {
      updateEdgePath(svg, pathElement);
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

    const nodeKey = element.getAttribute('data-id') || element.id;
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

    const meta = extractEdgeMeta(pathElement);
    if (!meta.edgeId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    pathElement.setPointerCapture(event.pointerId);

    const startPointer = clientPointToSvg(svg, event.clientX, event.clientY);
    const sourceNode = findDiagramNode(svg, meta.source);
    const targetNode = findDiagramNode(svg, meta.target);
    if (!sourceNode || !targetNode) {
      return;
    }

    const sourceCenter = getElementBoxInSvg(svg, sourceNode).center;
    const targetCenter = getElementBoxInSvg(svg, targetNode).center;
    const defaultMidpoint = {
      x: (sourceCenter.x + targetCenter.x) / 2,
      y: (sourceCenter.y + targetCenter.y) / 2
    };
    const startMidpoint = manualLayoutState.edgeMidpoints.get(meta.edgeId) || defaultMidpoint;

    const handlePointerMove = (moveEvent) => {
      const nextPointer = clientPointToSvg(svg, moveEvent.clientX, moveEvent.clientY);
      manualLayoutState.edgeMidpoints.set(meta.edgeId, {
        x: startMidpoint.x + (nextPointer.x - startPointer.x),
        y: startMidpoint.y + (nextPointer.y - startPointer.y)
      });
      updateEdgePath(svg, pathElement);
    };

    const handlePointerUp = () => {
      pathElement.removeEventListener('pointermove', handlePointerMove);
      pathElement.removeEventListener('pointerup', handlePointerUp);
      pathElement.removeEventListener('pointercancel', handlePointerUp);
      setStatus(`已调整连线: ${meta.edgeId}`, 'ok');
    };

    pathElement.addEventListener('pointermove', handlePointerMove);
    pathElement.addEventListener('pointerup', handlePointerUp);
    pathElement.addEventListener('pointercancel', handlePointerUp);
  });
}

function enableManualLayout(svg) {
  svg.classList.toggle('manual-layout', manualLayoutEnabled);

  Array.from(svg.querySelectorAll('g.node, g.cluster')).forEach((element) => {
    const nodeKey = element.getAttribute('data-id') || element.id;
    if (!nodeKey) {
      return;
    }

    const savedPosition = manualLayoutState.nodePositions.get(nodeKey);
    if (savedPosition) {
      setElementTranslate(element, savedPosition.x, savedPosition.y);
    }
    bindNodeDrag(svg, element);
  });

  getEdgePathElements(svg).forEach((pathElement) => bindEdgeDrag(svg, pathElement));
  refreshAllEdges(svg);
}

async function renderMermaid() {
  const code = mermaidEditor.value.trim();
  if (!code) {
    mermaidPreview.innerHTML = '<p>请输入 Mermaid 代码。</p>';
    renderedSvg = '';
    return;
  }

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
    renderedSvg = '';
    mermaidPreview.innerHTML = `<pre style="color:#b3312f; white-space:pre-wrap;">${String(err.message || err)}</pre>`;
    setStatus('Mermaid 渲染失败，请检查语法', 'error');
  }
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

async function handleOpen() {
  const result = await window.mmeApi.openFile();
  if (result.canceled) {
    return;
  }

  const projectFile = parseProjectFile(result.content, result.extension);

  if (projectFile) {
    mermaidEditor.value = projectFile.mermaid;
    markdownEditor.value = projectFile.markdown;
    setActiveTab(projectFile.mermaid ? 'mermaid' : 'markdown');
    await renderAll();
    setStatus(`已打开工程文件: ${result.filePath}`, 'ok');
    return;
  }

  const isLikelyMermaid = isLikelyMermaidText(result.content);

  if (isLikelyMermaid) {
    mermaidEditor.value = result.content;
    setActiveTab('mermaid');
    await renderMermaid();
    setStatus(`已打开 Mermaid 文件: ${result.filePath}`, 'ok');
  } else {
    markdownEditor.value = result.content;
    setActiveTab('markdown');
    renderMarkdown();
    setStatus(`已打开 Markdown 文件: ${result.filePath}`, 'ok');
  }
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

function bindEvents() {
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => setActiveTab(tab.dataset.tab));
  });

  mermaidEditor.addEventListener('input', async () => {
    if (autoUpdate) {
      await renderMermaid();
    }
  });

  markdownEditor.addEventListener('input', () => {
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

  // 菜单动作绑定
  window.mmeApi.onMenuAction('menu:open', handleOpen);
  window.mmeApi.onMenuAction('menu:save-project', handleSaveProject);
  window.mmeApi.onMenuAction('menu:print', openPrintDialog);
  window.mmeApi.onMenuAction('menu:export-svg', () => document.getElementById('btnExportSvg').click());
  window.mmeApi.onMenuAction('menu:export-png', exportPng);
  window.mmeApi.onMenuAction('menu:export-docx', () => document.getElementById('btnExportDocx').click());
  window.mmeApi.onMenuAction('menu:export-visio', () => document.getElementById('btnExportVisio').click());
  window.mmeApi.onMenuAction('menu:zoom-in', () => { zoom = Math.min(zoom + 0.1, 2.5); updateZoom(); });
  window.mmeApi.onMenuAction('menu:zoom-out', () => { zoom = Math.max(zoom - 0.1, 0.4); updateZoom(); });
  window.mmeApi.onMenuAction('menu:zoom-reset', () => { zoom = 1; updateZoom(); });
  window.mmeApi.onMenuAction('menu:toggle-grid', () => canvasViewport.classList.toggle('no-grid'));
  window.mmeApi.onMenuAction('menu:toggle-layout', () => toggleManualLayoutButton.click());

  document.getElementById('btnExportSvg').addEventListener('click', async () => {
    const currentSvg = getCurrentPreviewSvg();
    if (!currentSvg) {
      setStatus('没有可导出的 Mermaid 图形', 'error');
      return;
    }

    const result = await window.mmeApi.exportSvg(currentSvg);
    if (!result.canceled) {
      setStatus(`SVG 已导出: ${result.filePath}`, 'ok');
    }
  });

  document.getElementById('btnExportPng').addEventListener('click', exportPng);

  document.getElementById('btnExportDocx').addEventListener('click', async () => {
    const result = await window.mmeApi.exportDocx(markdownEditor.value || '');
    if (!result.canceled) {
      setStatus(`DOCX 已导出: ${result.filePath}`, 'ok');
    }
  });

  document.getElementById('btnExportVisio').addEventListener('click', async () => {
    const currentSvg = getCurrentPreviewSvg();
    if (!currentSvg) {
      setStatus('没有可导出的 Mermaid 图形', 'error');
      return;
    }

    const result = await window.mmeApi.exportVisio(currentSvg);
    if (!result.canceled) {
      if (result.warning) {
        setStatus(`Visio 导出有警告: ${result.warning}`, 'error');
      } else {
        setStatus(`Visio 已导出: ${result.filePath}`, 'ok');
      }
    }
  });

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

  document.getElementById('btnClosePrintDialog').addEventListener('click', closePrintDialog);
  document.querySelector('[data-close-dialog="true"]').addEventListener('click', closePrintDialog);
  document.getElementById('btnRefreshPreview').addEventListener('click', refreshPrintPreview);
  document.getElementById('btnConfirmPrint').addEventListener('click', executePrint);
  printContentSelect.addEventListener('change', refreshPrintPreview);
}

async function bootstrap() {
  const settings = await window.mmeApi.getSettings();
  autoUpdate = settings.autoUpdate;
  autoUpdateSwitch.checked = autoUpdate;

  mermaidEditor.value = sampleMermaid;
  markdownEditor.value = sampleMarkdown;

  bindEvents();
  await renderAll();
}

bootstrap().catch((error) => {
  setStatus(`初始化失败: ${String(error.message || error)}`, 'error');
});
