// Phân tích file playable HTML thành cây "container" chứa tài nguyên,
// cho phép thay thế từng tài nguyên và ghi lại thành HTML mới.
//
// Container dạng text (HTML, JSON, JS...) quét:
//   - data URI base64:  data:image/png;base64,....
//   - chuỗi base64 "trần" trong dấu nháy, nhận diện bằng magic bytes
//   - zip nhúng base64 (vd. window.__zip của super-html) -> container zip lồng
//   - window.__adapter_zip__ của playable-ads-adapter (JSON nén zlib/pako, có thể
//     cắt thành nhiều thẻ script nối bằng +=) -> container text lồng
// Container dạng zip: mỗi file media là 1 asset, file text được quét đệ quy.

import JSZip from 'jszip';
import {
  AssetKind, base64DecodedSize, base64ToBytes, bytesToBase64, extFromMime, extOf,
  isMediaMime, kindOfMime, mimeFromName, peekBase64, readImageSize, sniffMime,
} from './binary';
import { GlbModel, buildGlb, materialLabelFor, parseGlb } from './glb';
import {
  FbxModel, FbxProp, buildFbx, hasFbxEdits, listColorProps, listEmbeddedTextures, parseFbx,
} from './fbx';
import { scanLunaAssets, isLunaHtml, encodeBase122, escapeHtmlAttr, LunaImgData, LunaSoundData } from './luna';

export interface AssetData {
  bytes: Uint8Array;
  mime: string;
}

export interface Replacement extends AssetData {
  fileName: string;
  width?: number;
  height?: number;
}

export interface TextRef {
  type: 'text';
  container: TextContainer;
  start: number;
  end: number;
  form: 'datauri' | 'raw' | 'luna122' | 'luna-sound';
  escapedSlash: boolean;
  obf: boolean;
  lunaImg?: LunaImgData;
  lunaSound?: LunaSoundData;
}

interface ZipFileRef {
  type: 'zipfile';
  container: ZipContainer;
  path: string;
}

/** Dùng cho asset "ảo": vật liệu tách ra từ bên trong 1 model (ảnh trong .glb, màu/texture
 *  trong .fbx...) — không có vị trí riêng trong HTML/zip nên không tự ghi lại được; việc
 *  "thay" nó được gom lại rồi dựng thành .replacement của chính asset model cha (xem
 *  syncGlbAssets / syncFbxAssets). */
interface VirtualRef {
  type: 'virtual';
}

export interface Asset {
  id: number;
  name: string;
  kind: AssetKind;
  mime: string;
  size: number;
  location: string;
  original: AssetData;
  /** base64 gốc (để tạo URL xem trước, so trùng) */
  originalB64: string;
  width?: number;
  height?: number;
  replacement?: Replacement;
  /** các asset có cùng nội dung gốc -> cùng nhóm */
  dupKey: string;
  ref: TextRef | ZipFileRef | VirtualRef;
  /** model .glb: danh sách ảnh vật liệu tách ra được (nếu tách được) */
  glb?: { source: GlbModel; images: Asset[] };
  /** ảnh vật liệu: chỉ số trong model.glb cha + chính asset model cha */
  glbParent?: { parent: Asset; imageIndex: number };
  /** model .fbx: màu vật liệu + texture nhúng kèm tách ra được */
  fbx?: { model: FbxModel; originalBytes: Uint8Array; colors: Asset[]; textures: Asset[] };
  /** màu vật liệu fbx: tham chiếu tới 3 property R,G,B gốc để ghi giá trị mới vào */
  fbxColorRef?: { components: [FbxProp, FbxProp, FbxProp] };
  /** texture nhúng trong fbx: tham chiếu tới property Content gốc để ghi ảnh mới vào */
  fbxContentRef?: { content: FbxProp };
}

interface NestedZipRef {
  start: number;
  end: number;
  form: 'datauri' | 'raw';
  escapedSlash: boolean;
  obf: boolean;
  mime: string;
  zip: ZipContainer;
}

/** window.__adapter_zip__="..." (+= "...") — base64(zlib(JSON {path: dataURI|text})) */
interface AdapterZipRef {
  /** vị trí phần nội dung trong dấu nháy của từng khúc */
  parts: Array<[number, number]>;
  child: TextContainer;
}

export class TextContainer {
  assets: TextRef[] = [];
  zips: NestedZipRef[] = [];
  adapters: AdapterZipRef[] = [];
  constructor(public text: string, public label: string) {}
}

export class ZipContainer {
  assetPaths = new Set<string>();
  texts = new Map<string, TextContainer>();
  constructor(public zip: JSZip, public originalB64: string, public label: string) {}
}

export interface ProjectInfo {
  /** HTML được build bởi super-html v5 (có window.super_html_channel) */
  superHtmlChannel: string | null;
  hasSuperHtmlCommon: boolean;
  hasResJson: boolean;
  hasResZip: boolean;
  /** playable-ads-adapter: tài nguyên trong window.__adapter_zip__ (nén pako) */
  hasAdapterZip: boolean;
  obfKey: number | null;
  engine: string;
}

export interface Project {
  fileName: string;
  originalHtml: string;
  root: TextContainer;
  assets: Asset[];
  info: ProjectInfo;
}

const DATA_URI_RE = /data:[^,"'`\s<>()]{3,160},(?:[A-Za-z0-9+/=]|\\\/)+/g;
const RAW_B64_RE = /(["'`])((?:[A-Za-z0-9+/]|\\\/){96,}={0,2})\1/g;
const STRICT_URI_RE = /^data:([\w.+-]+\/[\w.+-]+)((?:;[\w.+-]+=[^;,]*)*);base64,([A-Za-z0-9+/]+={0,2})$/;
const TEXT_EXT = new Set(['', 'json', 'js', 'mjs', 'txt', 'html', 'htm', 'css', 'xml', 'plist', 'atlas', 'fnt']);

export interface ParseCtx {
  obfKey: number | null;
  assets: Asset[];
  nextId: number;
}

function detectObfKey(html: string): number | null {
  const m = html.match(/window\.oasjidx\s*=\s*(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

function guessName(text: string, start: number): string | null {
  const before = text.slice(Math.max(0, start - 300), start);
  let m = before.match(/<(img|audio|source|video|image)\b[^>]*?\b(id|alt|class)=["']([^"']+)["'][^>]*?\b(?:src|href|xlink:href)=["']$/i);
  if (m) return `${m[1]}${m[2] === 'id' ? '#' : m[2] === 'class' ? '.' : ' '}${m[3]}`;
  m = before.match(/["']([^"'\n\\]{1,220})["']\s*:\s*\\?["'`]$/);
  if (m) return m[1];
  m = before.match(/\[\s*["']([^"'\n]{1,220})["']\s*\]\s*=\s*["'`]$/);
  if (m) return m[1];
  m = before.match(/\\"([^"\n\\]{1,220})\\"\s*:\s*\\"$/);
  if (m) return m[1];
  m = before.match(/([.#]?[\w-]+)\s*\{[^}]*url\(\s*["']?$/);
  if (m) return `css ${m[1]}`;
  m = before.match(/([A-Za-z_$][\w$.-]{0,80})\s*[:=]\s*["'`]$/);
  if (m && !/^(src|href|url|data|content|value|xlink:href)$/i.test(m[1])) return m[1];
  return null;
}

function dupKeyOf(b64: string): string {
  const n = b64.length;
  return `${n}:${b64.slice(0, 48)}:${b64.slice(n >> 1, (n >> 1) + 48)}:${b64.slice(-48)}`;
}

function makeAsset(
  ctx: ParseCtx, name: string, mime: string, b64: string, bytes: Uint8Array | null,
  location: string, ref: TextRef | ZipFileRef,
): Asset {
  const data = bytes ?? base64ToBytes(b64);
  const kind = kindOfMime(mime);
  const size = kind === 'image' ? readImageSize(data.subarray(0, 65536)) : null;
  const asset: Asset = {
    id: ctx.nextId++,
    name,
    kind,
    mime,
    size: data.length,
    location,
    original: { bytes: data, mime },
    originalB64: b64,
    width: size?.width,
    height: size?.height,
    dupKey: dupKeyOf(b64),
    ref,
  };
  if (mime === 'model/gltf-binary') augmentGlb(ctx, asset);
  if (mime === 'application/fbx') augmentFbx(ctx, asset);
  return asset;
}

/** Tách từng ảnh vật liệu (material) nhúng bên trong 1 model .glb ra thành asset
 *  riêng, có thể xem/thay như ảnh bình thường (xem syncGlbAssets để biết việc
 *  thay 1 ảnh được gộp lại thành .replacement của chính model cha thế nào). */
function augmentGlb(ctx: ParseCtx, asset: Asset): void {
  const model = parseGlb(asset.original.bytes);
  if (!model || !model.images.length) return;
  const children: Asset[] = [];
  for (const img of model.images) {
    const bv = model.json.bufferViews?.[img.bufferViewIndex];
    if (!bv) continue;
    const off = bv.byteOffset || 0;
    const bytes = model.bin.subarray(off, off + bv.byteLength);
    const b64 = bytesToBase64(bytes);
    const size = readImageSize(bytes.subarray(0, 65536));
    const child: Asset = {
      id: ctx.nextId++,
      name: materialLabelFor(model.json, img.index) ?? `${asset.name} · ${img.name}`,
      kind: 'image',
      mime: img.mime,
      size: bytes.length,
      location: `${asset.location} › ${asset.name}`,
      original: { bytes, mime: img.mime },
      originalB64: b64,
      width: size?.width,
      height: size?.height,
      dupKey: dupKeyOf(b64),
      ref: { type: 'virtual' },
      glbParent: { parent: asset, imageIndex: img.index },
    };
    children.push(child);
    ctx.assets.push(child);
  }
  if (children.length) asset.glb = { source: model, images: children };
}

/** Gọi sau khi thay/hoàn tác 1 ảnh vật liệu bên trong model .glb: dựng lại toàn
 *  bộ file .glb từ các ảnh hiện có, gán làm .replacement của model cha — để khi
 *  ghi HTML, model cha (đã tìm thấy qua TextRef/ZipFileRef bình thường) tự mang
 *  đúng vật liệu mới mà không cần project.ts biết gì thêm về glb. */
export function syncGlbAssets(assets: Asset[]): void {
  for (const a of assets) {
    if (!a.glb) continue;
    const reps = new Map<number, { bytes: Uint8Array; mime: string }>();
    for (const img of a.glb.images) {
      const p = img.glbParent!;
      if (img.replacement) reps.set(p.imageIndex, { bytes: img.replacement.bytes, mime: img.replacement.mime });
    }
    if (reps.size === 0) {
      if ((a as any)._glbRebuilt) a.replacement = undefined;
      (a as any)._glbRebuilt = false;
      continue;
    }
    const bytes = buildGlb(a.glb.source, reps);
    a.replacement = { bytes, mime: a.mime, fileName: a.name };
    (a as any)._glbRebuilt = true;
  }
}

const FBX_COLOR_MIME = 'application/x-fbx-color';

/** Mã hoá 1 màu RGB (0..1, đúng kiểu double của FBX) thành 24 byte — chỉ dùng nội bộ
 *  để màu "là" 1 asset như mọi loại khác (có bytes, so trùng, Hoàn tác...). */
function encodeFbxColor(r: number, g: number, b: number): Uint8Array {
  const buf = new Uint8Array(24);
  const dv = new DataView(buf.buffer);
  dv.setFloat64(0, r, true);
  dv.setFloat64(8, g, true);
  dv.setFloat64(16, b, true);
  return buf;
}

export function decodeFbxColor(bytes: Uint8Array): [number, number, number] {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return [dv.getFloat64(0, true), dv.getFloat64(8, true), dv.getFloat64(16, true)];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim()) || ['', '00', '00', '00'];
  return [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255];
}

/** Màu vật liệu fbx không đi qua input file — xây .replacement thẳng từ mã hex người dùng chọn. */
export function buildFbxColorReplacement(asset: Asset, hex: string): { bytes: Uint8Array; mime: string; fileName: string } {
  const [r, g, b] = hexToRgb(hex);
  return { bytes: encodeFbxColor(r, g, b), mime: FBX_COLOR_MIME, fileName: asset.name };
}

/** Tách màu vật liệu (DiffuseColor, SpecularColor...) và texture nhúng kèm (nếu file
 *  .fbx có nhúng — nhiều file .fbx chỉ ghi đường dẫn ngoài máy, không nhúng) thành
 *  asset riêng, có thể sửa (xem syncFbxAssets để biết việc gộp lại thành 1 file .fbx mới). */
function augmentFbx(ctx: ParseCtx, asset: Asset): void {
  const model = parseFbx(asset.original.bytes);
  if (!model) return;
  const colorDefs = listColorProps(model);
  const textureDefs = listEmbeddedTextures(model);
  if (!colorDefs.length && !textureDefs.length) return;

  const colors: Asset[] = [];
  for (const c of colorDefs) {
    const [r, g, b] = c.components.map((p) => p.numberValue ?? 0);
    const bytes = encodeFbxColor(r, g, b);
    const b64 = bytesToBase64(bytes);
    const id = ctx.nextId++;
    const child: Asset = {
      id,
      name: `${c.materialName} · ${c.propName}`,
      kind: 'color',
      mime: FBX_COLOR_MIME,
      size: bytes.length,
      location: `${asset.location} › ${asset.name}`,
      original: { bytes, mime: FBX_COLOR_MIME },
      originalB64: b64,
      // KHÔNG gộp theo nội dung (dupKeyOf) ở đây: 2 property màu khác nhau (vd. material
      // A và B) có thể trùng giá trị RGB một cách ngẫu nhiên — gộp theo nội dung sẽ khiến
      // sửa 1 màu vô tình áp dụng luôn cho material khác chỉ vì tình cờ cùng màu gốc.
      // Mỗi property màu luôn là 1 nhóm riêng, dupKey gắn theo id để vẫn duy nhất.
      dupKey: `fbxcolor:${id}`,
      ref: { type: 'virtual' },
      fbxColorRef: { components: c.components },
    };
    colors.push(child);
    ctx.assets.push(child);
  }

  const textures: Asset[] = [];
  for (const t of textureDefs) {
    const bytes = t.content.rawBytes!;
    const b64 = bytesToBase64(bytes);
    const size = readImageSize(bytes.subarray(0, 65536));
    const child: Asset = {
      id: ctx.nextId++,
      name: t.label,
      kind: 'image',
      mime: t.mime,
      size: bytes.length,
      location: `${asset.location} › ${asset.name}`,
      original: { bytes, mime: t.mime },
      originalB64: b64,
      width: size?.width,
      height: size?.height,
      dupKey: dupKeyOf(b64),
      ref: { type: 'virtual' },
      fbxContentRef: { content: t.content },
    };
    textures.push(child);
    ctx.assets.push(child);
  }

  asset.fbx = { model, originalBytes: asset.original.bytes, colors, textures };
}

/** Gọi sau khi thay/hoàn tác màu hoặc texture nhúng của model .fbx: ghi giá trị mới
 *  (hoặc undefined nếu hoàn tác) vào đúng property trong cây đã phân tích, rồi dựng
 *  lại toàn bộ file .fbx nếu còn chỗ nào khác gốc — gán làm .replacement của model cha. */
export function syncFbxAssets(assets: Asset[]): void {
  for (const a of assets) {
    if (!a.fbx) continue;
    for (const c of a.fbx.colors) {
      const comps = c.fbxColorRef!.components;
      if (c.replacement) {
        const [r, g, b] = decodeFbxColor(c.replacement.bytes);
        comps[0].newNumber = r;
        comps[1].newNumber = g;
        comps[2].newNumber = b;
      } else {
        comps[0].newNumber = undefined;
        comps[1].newNumber = undefined;
        comps[2].newNumber = undefined;
      }
    }
    for (const t of a.fbx.textures) {
      t.fbxContentRef!.content.newBytes = t.replacement ? t.replacement.bytes : undefined;
    }
    a.replacement = hasFbxEdits(a.fbx.model)
      ? { bytes: buildFbx(a.fbx.model, a.fbx.originalBytes), mime: a.mime, fileName: a.name }
      : undefined;
  }
}

async function scanText(tc: TextContainer, ctx: ParseCtx): Promise<void> {
  const text = tc.text;
  const counters: Record<string, number> = {};
  const autoName = (mime: string) => {
    const k = kindOfMime(mime);
    counters[k] = (counters[k] || 0) + 1;
    return `${k}_${String(counters[k]).padStart(3, '0')}.${extFromMime(mime)}`;
  };

  const taken: Array<[number, number]> = [];

  // 1) data URI
  for (const m of text.matchAll(DATA_URI_RE)) {
    const start = m.index!;
    const raw = m[0];
    const end = start + raw.length;
    const escapedSlash = raw.includes('\\/');
    const u = escapedSlash ? raw.replace(/\\\//g, '/') : raw;
    let parsed = u.match(STRICT_URI_RE);
    let obf = false;
    if (ctx.obfKey != null && u.length > ctx.obfKey && (!parsed || parsed[3].length % 4 !== 0)) {
      const u2 = u.slice(0, ctx.obfKey) + u.slice(ctx.obfKey + 1);
      const p2 = u2.match(STRICT_URI_RE);
      if (p2 && p2[3].length % 4 === 0) {
        parsed = p2;
        obf = true;
      }
    }
    if (!parsed) continue;
    const b64 = parsed[3];
    const sniffed = sniffMime(peekBase64(b64, 32));
    const mime = sniffed || parsed[1].toLowerCase();
    if (mime === 'application/zip') {
      const nested = await loadNestedZip(b64, `${tc.label} › ${guessName(text, start) ?? 'zip'}`, ctx);
      if (nested) {
        tc.zips.push({ start, end, form: 'datauri', escapedSlash, obf, mime: parsed[1], zip: nested });
        taken.push([start, end]);
      }
      continue;
    }
    if (!isMediaMime(mime)) continue;
    const ref: TextRef = { type: 'text', container: tc, start, end, form: 'datauri', escapedSlash, obf };
    tc.assets.push(ref);
    taken.push([start, end]);
    const name = guessName(text, start) ?? autoName(mime);
    ctx.assets.push(makeAsset(ctx, name, mime, b64, null, tc.label, ref));
  }

  // 2) base64 trần trong chuỗi
  for (const m of text.matchAll(RAW_B64_RE)) {
    const start = m.index! + 1;
    const end = start + m[2].length;
    if (taken.some(([a, b]) => start < b && end > a)) continue;
    const escapedSlash = m[2].includes('\\/');
    const b64 = escapedSlash ? m[2].replace(/\\\//g, '/') : m[2];
    if (b64.length % 4 !== 0) continue;
    const mime = sniffMime(peekBase64(b64, 32));
    if (!mime) continue;
    if (mime === 'application/zip') {
      const nested = await loadNestedZip(b64, `${tc.label} › ${guessName(text, start) ?? 'zip'}`, ctx);
      if (nested) tc.zips.push({ start, end, form: 'raw', escapedSlash, obf: false, mime, zip: nested });
      continue;
    }
    if (!isMediaMime(mime)) continue;
    const ref: TextRef = { type: 'text', container: tc, start, end, form: 'raw', escapedSlash, obf: false };
    tc.assets.push(ref);
    const name = guessName(text, start) ?? autoName(mime);
    ctx.assets.push(makeAsset(ctx, name, mime, b64, null, tc.label, ref));
  }

  // 3) Luna Labs assets (<img data-src122="..."> và window.sounds)
  if (isLunaHtml(text)) {
    scanLunaAssets(tc, ctx, makeAsset);
  }
}

async function loadNestedZip(b64: string, label: string, ctx: ParseCtx): Promise<ZipContainer | null> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(b64, { base64: true });
  } catch {
    return null;
  }
  const zc = new ZipContainer(zip, b64, label);
  const entries = Object.values(zip.files).filter((f) => !f.dir);
  for (const f of entries) {
    const bytes = await f.async('uint8array');
    const sniffed = sniffMime(bytes.subarray(0, 32));
    const mime = sniffed || mimeFromName(f.name);
    if (isMediaMime(mime) && mime !== 'image/svg+xml') {
      zc.assetPaths.add(f.name);
      const fileB64 = bytesToBase64(bytes);
      const ref: ZipFileRef = { type: 'zipfile', container: zc, path: f.name };
      ctx.assets.push(makeAsset(ctx, f.name, mime, fileB64, bytes, label, ref));
      continue;
    }
    if (TEXT_EXT.has(extOf(f.name)) || !sniffed) {
      const text = new TextDecoder().decode(bytes);
      const child = new TextContainer(text, `${label} › ${f.name}`);
      await scanText(child, ctx);
      if (child.assets.length || child.zips.length) zc.texts.set(f.name, child);
    }
  }
  return zc;
}

async function streamThrough(bytes: Uint8Array, t: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const s = new Blob([bytes as BlobPart]).stream().pipeThrough(t as unknown as TransformStream<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(s).arrayBuffer());
}
/** zlib (RFC 1950) — cùng định dạng pako.deflate/inflate mặc định */
export const zlibInflate = (b: Uint8Array) => streamThrough(b, new DecompressionStream('deflate'));
export const zlibDeflate = (b: Uint8Array) => streamThrough(b, new CompressionStream('deflate'));

const ADAPTER_PART_RE = /window\.__adapter_zip__\s*\+?=\s*(["'])([A-Za-z0-9+/=_-]*)\1/g;

async function scanAdapterZip(tc: TextContainer, ctx: ParseCtx): Promise<void> {
  const parts: Array<[number, number]> = [];
  let b64 = '';
  for (const m of tc.text.matchAll(ADAPTER_PART_RE)) {
    const start = m.index! + m[0].length - 1 - m[2].length;
    parts.push([start, start + m[2].length]);
    b64 += m[2];
  }
  if (!parts.length) return;
  let json: string;
  try {
    json = new TextDecoder().decode(await zlibInflate(base64ToBytes(b64.replace(/-/g, '+').replace(/_/g, '/'))));
    JSON.parse(json);
  } catch (e) {
    console.warn('[playable-editor] không giải nén được __adapter_zip__', e);
    return;
  }
  const child = new TextContainer(json, `${tc.label} › __adapter_zip__`);
  await scanText(child, ctx);
  tc.adapters.push({ parts, child });
}

function detectEngine(html: string): string {
  if (/cocos-js\/cc\.js|cc\.game|CocosEngine|System\.register|_CCSettings/.test(html)) return 'Cocos Creator';
  if (/createUnityInstance|UnityLoader|unityFramework|Luna\.Unity|\$environment|data-src122|window\.LUCID/i.test(html)) return 'Unity / Luna';
  if (/PIXI\./.test(html)) return 'PixiJS';
  if (/Phaser\./.test(html)) return 'Phaser';
  if (/THREE\./.test(html)) return 'Three.js';
  if (/BABYLON\./.test(html)) return 'Babylon.js';
  if (/pc\.Application|playcanvas/i.test(html)) return 'PlayCanvas';
  if (/laya\./i.test(html)) return 'LayaAir';
  if (/egret\./.test(html)) return 'Egret';
  return 'Không rõ';
}

export async function parsePlayable(html: string, fileName: string): Promise<Project> {
  const obfKey = detectObfKey(html);
  const ctx: ParseCtx = { obfKey, assets: [], nextId: 1 };
  const root = new TextContainer(html, 'HTML');
  await scanAdapterZip(root, ctx);
  await scanText(root, ctx);
  const ch = html.match(/window\.super_html_channel\s*=\s*["']([\w-]+)["']/);
  const info: ProjectInfo = {
    superHtmlChannel: ch ? ch[1] : null,
    hasSuperHtmlCommon: /function super_load\s*\(/.test(html) || /window\[[^\]]+\]=function\(c\)\{[^}]*super-html/.test(html),
    hasResJson: /window\.__res\s*=\s*\{/.test(html),
    hasResZip: /window\.__zip\s*=\s*["']/.test(html),
    hasAdapterZip: root.adapters.length > 0,
    obfKey,
    engine: detectEngine(html),
  };
  return { fileName, originalHtml: html, root, assets: ctx.assets, info };
}

/** Đọc input: .html hoặc .zip (bản build network: index.html + res.js...) */
export async function readInputFile(file: File): Promise<{ html: string; fileName: string; extras: Record<string, Uint8Array> }> {
  const name = file.name;
  if (/\.zip$/i.test(name)) {
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const htmlEntry = zip.file('index.html') ?? zip.file(/\.html?$/i)[0];
    if (!htmlEntry) throw new Error('Zip không có file .html');
    let html = await htmlEntry.async('string');
    const extras: Record<string, Uint8Array> = {};
    // gộp các <script src="xxx.js"> nội bộ (vd. res.js khi tách tài nguyên)
    const scriptTags = [...html.matchAll(/<script[^>]*\ssrc=["']([^"':]+\.js)["'][^>]*>\s*<\/script>/gi)];
    for (const st of scriptTags) {
      const f = zip.file(st[1]);
      if (!f) continue;
      const js = await f.async('string');
      html = html.replace(st[0], () => `<script type="text/javascript">\n${js}\n</script>`);
    }
    for (const f of Object.values(zip.files)) {
      if (f.dir || f === htmlEntry || /\.js$/i.test(f.name)) continue;
      extras[f.name] = await f.async('uint8array');
    }
    return { html, fileName: name.replace(/\.zip$/i, '.html'), extras };
  }
  return { html: await file.text(), fileName: name, extras: {} };
}

// ---------------- Ghi lại ----------------

function isDirtyText(tc: TextContainer, replaced: Set<TextRef | ZipFileRef>): boolean {
  return (
    tc.assets.some((r) => replaced.has(r)) ||
    tc.zips.some((z) => isDirtyZip(z.zip, replaced)) ||
    tc.adapters.some((a) => isDirtyText(a.child, replaced))
  );
}

function isDirtyZip(zc: ZipContainer, replaced: Set<TextRef | ZipFileRef>): boolean {
  for (const r of replaced) if (r.type === 'zipfile' && r.container === zc) return true;
  for (const t of zc.texts.values()) if (isDirtyText(t, replaced)) return true;
  return false;
}

function encodeTextPayload(
  b64: string, mime: string, form: 'datauri' | 'raw' | 'luna122' | 'luna-sound', escapedSlash: boolean, obf: boolean, obfKey: number | null,
): string {
  let s = form === 'datauri' ? `data:${mime};base64,${b64}` : b64;
  if (obf && obfKey != null && s.length > obfKey) s = s.slice(0, obfKey) + '5' + s.slice(obfKey);
  if (escapedSlash) s = s.replace(/\//g, '\\/');
  return s;
}

async function serializeText(
  tc: TextContainer, byRef: Map<TextRef | ZipFileRef, Asset>, replaced: Set<TextRef | ZipFileRef>, obfKey: number | null,
): Promise<string> {
  if (!isDirtyText(tc, replaced)) return tc.text;
  const edits: Array<{ start: number; end: number; text: string }> = [];
  for (const r of tc.assets) {
    if (!replaced.has(r)) continue;
    const a = byRef.get(r)!;
    const rep = a.replacement!;
    if (r.form === 'luna122') {
      const src122 = escapeHtmlAttr(encodeBase122(rep.bytes));
      edits.push({ start: r.start, end: r.end, text: src122 });
      if (r.lunaImg && rep.mime) {
        edits.push({ start: r.lunaImg.mimeStart, end: r.lunaImg.mimeEnd, text: rep.mime });
      }
      continue;
    }
    if (r.form === 'luna-sound' && r.lunaSound) {
      const b64 = bytesToBase64(rep.bytes);
      const overrideCode = `Promise.resolve().then(function(){ window.sounds["${r.lunaSound.soundPath}"] = _base64ToArrayBuffer("${b64}"); })`;
      edits.push({ start: r.start, end: r.end, text: overrideCode });
      continue;
    }
    edits.push({ start: r.start, end: r.end, text: encodeTextPayload(bytesToBase64(rep.bytes), rep.mime, r.form, r.escapedSlash, r.obf, obfKey) });
  }
  for (const z of tc.zips) {
    if (!isDirtyZip(z.zip, replaced)) continue;
    const b64 = await serializeZip(z.zip, byRef, replaced, obfKey);
    edits.push({ start: z.start, end: z.end, text: encodeTextPayload(b64, z.mime, z.form, z.escapedSlash, z.obf, obfKey) });
  }
  for (const ad of tc.adapters) {
    if (!isDirtyText(ad.child, replaced)) continue;
    const json = await serializeText(ad.child, byRef, replaced, obfKey);
    const b64 = bytesToBase64(await zlibDeflate(new TextEncoder().encode(json)));
    // chia lại đúng số khúc như file gốc
    const n = ad.parts.length;
    const size = Math.ceil(b64.length / n);
    ad.parts.forEach(([start, end], i) => edits.push({ start, end, text: b64.slice(i * size, (i + 1) * size) }));
  }
  edits.sort((a, b) => b.start - a.start);
  let out = tc.text;
  for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}

async function serializeZip(
  zc: ZipContainer, byRef: Map<TextRef | ZipFileRef, Asset>, replaced: Set<TextRef | ZipFileRef>, obfKey: number | null,
): Promise<string> {
  for (const r of replaced) {
    if (r.type !== 'zipfile' || r.container !== zc) continue;
    zc.zip.file(r.path, byRef.get(r)!.replacement!.bytes);
  }
  for (const [path, t] of zc.texts) {
    if (isDirtyText(t, replaced)) zc.zip.file(path, await serializeText(t, byRef, replaced, obfKey));
  }
  const b64 = await zc.zip.generateAsync({ type: 'base64', compression: 'DEFLATE', compressionOptions: { level: 9 } });
  // khôi phục nội dung gốc để lần serialize sau không bị "dính" thay đổi cũ
  for (const r of replaced) {
    if (r.type !== 'zipfile' || r.container !== zc) continue;
    zc.zip.file(r.path, byRef.get(r)!.original.bytes);
  }
  for (const [path, t] of zc.texts) zc.zip.file(path, t.text);
  return b64;
}

/** Tạo HTML mới từ project + các tài nguyên đã thay */
export async function serializeProject(p: Project): Promise<string> {
  const byRef = new Map<TextRef | ZipFileRef, Asset>();
  const replaced = new Set<TextRef | ZipFileRef>();
  for (const a of p.assets) {
    // ảnh vật liệu trong model .glb không có vị trí riêng trong HTML/zip — việc
    // thay chúng đã được gộp thành .replacement của chính asset model (ref thật)
    if (a.ref.type === 'virtual') continue;
    byRef.set(a.ref, a);
    if (a.replacement) replaced.add(a.ref);
  }
  return serializeText(p.root, byRef, replaced, p.info.obfKey);
}

export function assetDataUrl(a: Asset, useReplacement = true): string {
  if (useReplacement && a.replacement) return `data:${a.replacement.mime};base64,${bytesToBase64(a.replacement.bytes)}`;
  return `data:${a.mime};base64,${a.originalB64}`;
}

export function assetBlobUrl(a: Asset, useReplacement = true): string {
  const d = useReplacement && a.replacement ? a.replacement : a.original;
  return URL.createObjectURL(new Blob([d.bytes], { type: d.mime }));
}

export function estimateAssetBytes(a: Asset): number {
  return a.replacement ? a.replacement.bytes.length : base64DecodedSize(a.originalB64);
}
