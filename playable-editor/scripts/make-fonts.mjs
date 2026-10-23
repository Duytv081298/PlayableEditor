// Nhúng thẳng font Be Vietnam Pro vào src/fonts.css dưới dạng base64, để bản dist-single
// chạy được hoàn toàn ngoại tuyến (không còn phải tải font từ fonts.googleapis.com).
// Chạy lại khi đổi font / đổi độ đậm:  node scripts/make-fonts.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dir = resolve(root, 'node_modules/@fontsource/be-vietnam-pro/files');
const WEIGHTS = [400, 500, 600, 700];
// Chỉ lấy 2 bộ ký tự cần dùng: latin (giao diện) + vietnamese (dấu tiếng Việt).
const SUBSETS = ['latin', 'vietnamese'];
const RANGES = {
  latin:
    'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+2074,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
  vietnamese:
    'U+0102-0103,U+0110-0111,U+0128-0129,U+0168-0169,U+01A0-01A1,U+01AF-01B0,U+0300-0301,U+0303-0304,U+0308-0309,U+0323,U+0329,U+1EA0-1EF9,U+20AB',
};

let css = '/* TỰ SINH bằng scripts/make-fonts.mjs — đừng sửa tay. */\n';
let total = 0;
for (const w of WEIGHTS) {
  for (const s of SUBSETS) {
    const file = resolve(dir, `be-vietnam-pro-${s}-${w}-normal.woff2`);
    const b64 = readFileSync(file).toString('base64');
    total += b64.length;
    css +=
      `@font-face{font-family:'Be Vietnam Pro';font-style:normal;font-weight:${w};font-display:swap;` +
      `src:url(data:font/woff2;base64,${b64}) format('woff2');unicode-range:${RANGES[s]}}\n`;
  }
}
writeFileSync(resolve(root, 'src/fonts.css'), css);
console.log(`src/fonts.css: ${WEIGHTS.length * SUBSETS.length} font, ${(total / 1024).toFixed(0)} KB base64`);
