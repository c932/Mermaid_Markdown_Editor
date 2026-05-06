// electron-builder afterPack hook
// 使用 node_modules/electron-winstaller 自带的 rcedit.exe 重写 win32 exe 的 VersionInfo，
// 让 Windows "选择打开方式" 等对话框显示 "Mermaid Markdown Editor" 而非 "Electron"。
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

function findRcedit() {
  const candidates = [
    path.join(__dirname, '..', 'node_modules', 'electron-winstaller', 'vendor', 'rcedit.exe'),
    path.join(__dirname, '..', 'node_modules', 'app-builder-lib', 'vendor', 'rcedit.exe'),
    path.join(__dirname, '..', 'node_modules', 'electron-builder', 'node_modules', 'app-builder-lib', 'vendor', 'rcedit.exe'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const RCEDIT_PATH = findRcedit();

function runRcedit(exePath, fields) {
  const args = [exePath];
  for (const [key, value] of Object.entries(fields)) {
    if (value == null || value === '') continue;
    args.push(key, String(value));
  }
  const r = spawnSync(RCEDIT_PATH, args, { stdio: 'pipe', encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(
      `rcedit failed (exit=${r.status}): ${r.stderr || r.stdout || 'unknown error'}`
    );
  }
}

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  if (!RCEDIT_PATH || !fs.existsSync(RCEDIT_PATH)) {
    console.warn('[after-pack] rcedit.exe not found, skip');
    return;
  }

  const appInfo = context.packager.appInfo;
  const productName = appInfo.productName || 'Mermaid Markdown Editor';
  const version = appInfo.version || '0.1.0';
  const description = appInfo.description || productName;
  // electron-builder 会生成 ${productFilename}.exe
  const exePath = path.join(context.appOutDir, `${appInfo.productFilename}.exe`);
  if (!fs.existsSync(exePath)) {
    console.warn(`[after-pack] exe not found: ${exePath}`);
    return;
  }

  const fourPartVersion = (() => {
    const parts = String(version).split('.');
    while (parts.length < 4) parts.push('0');
    return parts.slice(0, 4).join('.');
  })();

  // rcedit 调用方式：每组 --set-version-string KEY VALUE 串起来
  const argGroups = [
    ['--set-version-string', 'FileDescription', productName],
    ['--set-version-string', 'ProductName', productName],
    ['--set-version-string', 'InternalName', productName],
    ['--set-version-string', 'OriginalFilename', `${productName}.exe`],
    ['--set-version-string', 'CompanyName', productName],
    ['--set-version-string', 'LegalCopyright', `Copyright © ${new Date().getFullYear()} ${productName}`],
    ['--set-version-string', 'Comments', description],
    ['--set-file-version', fourPartVersion],
    ['--set-product-version', fourPartVersion]
  ];

  const flatArgs = [exePath, ...argGroups.flat()];
  const r = spawnSync(RCEDIT_PATH, flatArgs, { stdio: 'pipe', encoding: 'utf8' });
  if (r.status !== 0) {
    console.warn(
      `[after-pack] rcedit failed (exit=${r.status}): ${r.stderr || r.stdout}`
    );
    return;
  }
  console.log(`[after-pack] updated VersionInfo for ${exePath} => "${productName}"`);
};
