// Hỗ trợ bóc tách và thay thế tài nguyên cho file Luna Labs (Unity to HTML5)
import { bytesToBase64, sniffMime } from './binary';
import type { Asset, ParseCtx, TextContainer, TextRef } from './project';

const o = [0, 10, 13, 34, 38, 92];
const ilMap = new Map<number, number>();
o.forEach((val, i) => ilMap.set(val, i));

/** Unescape các HTML entities (đặc biệt &lt;, &gt;, &amp;) có trong attribute HTML */
export function unescapeHtmlAttr(str: string): string {
  return str
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#([0-9]+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&amp;/g, '&');
}

/** Escape ký tự HTML-special trước khi nhúng vào attribute HTML */
export function escapeHtmlAttr(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Giải mã Base122 về Uint8Array (chuẩn dùng trong Luna Labs) */
export function decodeBase122(s: string): Uint8Array {
  if (s.includes('&')) s = unescapeHtmlAttr(s);
  const w = (1.75 * s.length) | 0;
  const a = new Uint8Array(w);
  let e = 0, r = 0, n = 0;
  function t(val: number) {
    e |= (val <<= 1) >>> r;
    r += 7;
    if (r >= 8) {
      a[n++] = e;
      r -= 8;
      e = (val << (7 - r)) & 255;
    }
  }
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code > 127) {
      const high = (code >>> 8) & 7;
      if (7 !== high) t(o[high]);
      t(127 & code);
    } else {
      t(code);
    }
  }
  return new Uint8Array(a.buffer, 0, n);
}

/** Mã hóa Uint8Array sang Base122 string */
export function encodeBase122(bytes: Uint8Array): string {
  let cur = 0;
  let curBits = 0;
  const sevens: number[] = [];

  for (let i = 0; i < bytes.length; i++) {
    cur = (cur << 8) | bytes[i];
    curBits += 8;
    while (curBits >= 7) {
      curBits -= 7;
      sevens.push((cur >>> curBits) & 0x7F);
    }
  }
  if (curBits > 0) {
    sevens.push((cur << (7 - curBits)) & 0x7F);
  }

  let res = '';
  for (let i = 0; i < sevens.length; i++) {
    const v = sevens[i];
    if (ilMap.has(v)) {
      const ilIdx = ilMap.get(v)!;
      if (i + 1 < sevens.length) {
        const next = sevens[++i];
        res += String.fromCharCode(0x80 | (ilIdx << 8) | (next & 0x7F));
      } else {
        res += String.fromCharCode(0x80 | (7 << 8) | (v & 0x7F));
      }
    } else {
      res += String.fromCharCode(v);
    }
  }
  return res;
}

/** Trích xuất bộ giải nén Brotli nhúng sẵn trong file Luna (từ window.makeBrotliDecodeStr) */
export function getLunaBrotliDecoder(html: string): ((bytes: Uint8Array) => Uint8Array) | null {
  const at = html.indexOf('window.makeBrotliDecodeStr');
  if (at < 0) return null;
  let i = at + 'window.makeBrotliDecodeStr='.length;
  while (i < html.length && html[i] !== "'" && html[i] !== '"') i++;
  if (i >= html.length) return null;
  const quote = html[i];
  i++;
  const start = i;
  while (i < html.length && !(html[i] === quote && html[i - 1] !== '\\')) i++;
  const raw = html.slice(start, i);
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const fnStr = (0, eval)(quote + raw + quote) as string;
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const decoder = (0, eval)('(' + fnStr + ')()') as (b: Uint8Array) => Uint8Array;
    return decoder;
  } catch {
    return null;
  }
}

export function isLunaHtml(html: string): boolean {
  return (
    html.includes('data-src122') ||
    html.includes('window.LUCID') ||
    html.includes('window.$environment') ||
    html.includes('Luna.Unity') ||
    html.includes('window.makeBrotliDecodeStr')
  );
}

export interface LunaImgData {
  id: string;
  src122Start: number;
  src122End: number;
  mimeStart: number;
  mimeEnd: number;
}

export interface LunaSoundData {
  soundPath: string;
  assignStart: number;
  assignEnd: number;
}

declare module './project' {
  interface TextRef {
    lunaImg?: LunaImgData;
    lunaSound?: LunaSoundData;
  }
}

const LUNA_IMG_TAG_RE = /<img\b([^>]*\bdata-src122=["'][^"']+["'][^>]*)>/gi;

/** Quét toàn bộ hình ảnh và âm thanh trong file Luna */
export function scanLunaAssets(
  tc: TextContainer,
  ctx: ParseCtx,
  makeAssetFn: (ctx: ParseCtx, name: string, mime: string, b64: string, bytes: Uint8Array | null, containerLabel: string, ref: TextRef) => Asset,
): void {
  const text = tc.text;

  // 1. Quét hình ảnh: <img id="..." data-src122="..." data-mime="...">
  for (const m of text.matchAll(LUNA_IMG_TAG_RE)) {
    const tag = m[0];
    const tagOffset = m.index!;

    const idMatch = tag.match(/\bid=["']([^"']+)["']/i);
    const srcMatch = tag.match(/\bdata-src122=(["'])([\s\S]*?)\1/i);
    const mimeMatch = tag.match(/\bdata-mime=(["'])([\s\S]*?)\1/i);

    if (!idMatch || !srcMatch || !mimeMatch) continue;

    const id = idMatch[1];
    const src122 = srcMatch[2];
    const mime = mimeMatch[2] || 'image/png';

    const src122Start = tagOffset + srcMatch.index! + 'data-src122='.length + 1;
    const src122End = src122Start + src122.length;

    const mimeStart = tagOffset + mimeMatch.index! + 'data-mime='.length + 1;
    const mimeEnd = mimeStart + mime.length;

    try {
      const bytes = decodeBase122(src122);
      if (bytes.length === 0) continue;
      const effectiveMime = sniffMime(bytes) || mime || 'image/png';
      const b64 = bytesToBase64(bytes);
      const name = id.split('/').pop() || id;

      const ref: TextRef = {
        type: 'text',
        container: tc,
        start: src122Start,
        end: src122End,
        form: 'luna122' as any,
        escapedSlash: false,
        obf: false,
        lunaImg: { id, src122Start, src122End, mimeStart, mimeEnd },
      };

      tc.assets.push(ref);
      ctx.assets.push(makeAssetFn(ctx, name, effectiveMime, b64, bytes, tc.label, ref));
    } catch {
      /* ignore decode error */
    }
  }

  // 2. Quét âm thanh: window.sounds[...] nạp qua decompressArrayBuffer/decompressString
  const brotli = getLunaBrotliDecoder(text);
  if (brotli) {
    const SOUND_ASSIGN_RE = /decompressArrayBuffer\(\s*(["'])([\s\S]*?)\1\s*,\s*true\s*,\s*\d+\s*\)\.then\(\s*function\(\s*sound\s*\)\s*\{\s*window\.sounds\[\s*(["'])(assets\/[^"']+)\3\s*\]\s*=\s*sound;\s*\}\s*\)/g;
    for (const m of text.matchAll(SOUND_ASSIGN_RE)) {
      const src122 = m[2];
      const soundPath = m[4];
      const matchStart = m.index!;
      const matchEnd = matchStart + m[0].length;

      try {
        const compressed = decodeBase122(src122);
        const rawDecomp = brotli(compressed);
        if (rawDecomp.length === 0) continue;
        const decompressed = new Uint8Array(rawDecomp.buffer, rawDecomp.byteOffset, rawDecomp.byteLength);

        const sniffed = sniffMime(decompressed.subarray(0, 32)) || 'audio/mpeg';
        const b64 = bytesToBase64(decompressed);
        const name = soundPath.split('/').pop() || soundPath;

        const ref: TextRef = {
          type: 'text',
          container: tc,
          start: matchStart,
          end: matchEnd,
          form: 'luna-sound' as any,
          escapedSlash: false,
          obf: false,
          lunaSound: { soundPath, assignStart: matchStart, assignEnd: matchEnd },
        };

        tc.assets.push(ref);
        ctx.assets.push(makeAssetFn(ctx, name, sniffed, b64, decompressed, tc.label, ref));
      } catch (err) {
        console.error('[luna] sound decode error:', err);
      }
    }
  }
}
