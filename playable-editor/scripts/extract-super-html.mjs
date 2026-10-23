// Trích dữ liệu adapter network từ extension super-html (Cocos Store)
// Dùng: node scripts/extract-super-html.mjs [đường_dẫn_tới_super-html]
// Mặc định: ../super-html (tức E:\ToolEditPlayable\super-html)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.argv[2] || path.join(here, '..', '..', 'super-html'));
const spFile = path.join(root, 'static', 'sp');
if (!fs.existsSync(spFile)) {
  console.error('Không tìm thấy ' + spFile);
  process.exit(1);
}
const raw = JSON.parse(Buffer.from(fs.readFileSync(spFile, 'utf8'), 'base64').toString('utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const channels = {};
for (const [key, value] of Object.entries(raw)) {
  const m = key.match(/^channel\/([^/]+)\/(.+)$/);
  if (!m) continue;
  const [, name, file] = m;
  channels[name] ??= {};
  const field = { 'meta.html': 'meta', 'script.js': 'script', 'head.js': 'head', 'config.json': 'config' }[file];
  if (field) channels[name][field] = value;
}

const out = {
  source: 'super-html ' + pkg.version,
  extractedAt: new Date().toISOString(),
  channels,
  common: raw['common.js'],
  jszip: [raw['jszip.js'], raw['jszip2.js']].filter(Boolean),
};
const dest = path.join(here, '..', 'src', 'data', 'superHtml.json');
fs.writeFileSync(dest, JSON.stringify(out, null, 1));
console.log(`OK: ${Object.keys(channels).length} channel -> ${dest} (${out.source})`);
