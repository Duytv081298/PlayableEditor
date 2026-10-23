// Tiện ích nhị phân: base64 <-> bytes, nhận diện định dạng qua magic bytes

export type AssetKind = 'image' | 'audio' | 'video' | 'font' | 'model' | 'color' | 'other';

export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/\s+/g, '');
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH) as unknown as number[]);
  }
  return btoa(s);
}

/** Giải mã vài byte đầu của base64 (không cần decode toàn bộ chuỗi lớn) */
export function peekBase64(b64: string, nBytes = 16): Uint8Array {
  const need = Math.ceil(nBytes / 3) * 4;
  try {
    return base64ToBytes(b64.slice(0, need));
  } catch {
    return new Uint8Array();
  }
}

const ascii = (b: Uint8Array, start: number, len: number) =>
  String.fromCharCode(...b.subarray(start, start + len));

/** Nhận diện mime từ magic bytes. Trả về '' nếu không rõ. */
export function sniffMime(b: Uint8Array): string {
  if (b.length < 4) return '';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (ascii(b, 0, 4) === 'GIF8') return 'image/gif';
  if (ascii(b, 0, 4) === 'RIFF' && b.length >= 12) {
    const t = ascii(b, 8, 4);
    if (t === 'WEBP') return 'image/webp';
    if (t === 'WAVE') return 'audio/wav';
    if (t === 'AVI ') return 'video/x-msvideo';
  }
  if (ascii(b, 0, 3) === 'ID3') return 'audio/mpeg';
  if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0 && (b[1] & 0x06) !== 0) {
    // khung MPEG audio (mp3) hoặc ADTS AAC
    if ((b[1] & 0x06) === 0x00) return 'audio/aac';
    return 'audio/mpeg';
  }
  if (b[0] === 0xff && (b[1] & 0xf6) === 0xf0) return 'audio/aac';
  if (ascii(b, 0, 4) === 'OggS') return 'audio/ogg';
  if (ascii(b, 0, 4) === 'fLaC') return 'audio/flac';
  if (b.length >= 12 && ascii(b, 4, 4) === 'ftyp') {
    const brand = ascii(b, 8, 4);
    if (brand.startsWith('M4A') || brand.startsWith('M4B')) return 'audio/mp4';
    if (brand === 'qt  ') return 'video/quicktime';
    return 'video/mp4';
  }
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'video/webm';
  if (ascii(b, 0, 4) === 'wOFF') return 'font/woff';
  if (ascii(b, 0, 4) === 'wOF2') return 'font/woff2';
  if (b[0] === 0x00 && b[1] === 0x01 && b[2] === 0x00 && b[3] === 0x00) return 'font/ttf';
  if (ascii(b, 0, 4) === 'OTTO') return 'font/otf';
  if (b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04) return 'application/zip';
  if (ascii(b, 0, 4) === '<svg' || ascii(b, 0, 5) === '<?xml') return 'image/svg+xml';
  if (ascii(b, 0, 4) === 'KTX ' || (b[0] === 0xab && ascii(b, 1, 3) === 'KTX')) return 'image/ktx';
  if (ascii(b, 0, 4) === 'PVR\x03' || ascii(b, 0, 4) === '\x03RVP') return 'image/pvr';
  if (ascii(b, 0, 4) === 'ASTC' || (b[0] === 0x13 && b[1] === 0xab && b[2] === 0xa1 && b[3] === 0x5c)) return 'image/astc';
  // glTF nhị phân (.glb): "glTF" + uint32 version + uint32 length
  if (ascii(b, 0, 4) === 'glTF' && b.length >= 12) return 'model/gltf-binary';
  // FBX nhị phân: "Kaydara FBX Binary"
  if (ascii(b, 0, 18) === 'Kaydara FBX Binary') return 'application/fbx';
  return '';
}

const EXT_MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  svg: 'image/svg+xml', bmp: 'image/bmp', ico: 'image/x-icon',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
  ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2',
  glb: 'model/gltf-binary', gltf: 'model/gltf+json', fbx: 'application/fbx', obj: 'model/obj',
  json: 'application/json', js: 'text/javascript', css: 'text/css', html: 'text/html', txt: 'text/plain',
  atlas: 'text/plain', plist: 'text/xml', xml: 'text/xml', fnt: 'text/plain', bin: 'application/octet-stream',
};

export function extOf(name: string): string {
  const m = name.toLowerCase().match(/\.([a-z0-9]+)(?:$|\?)/);
  return m ? m[1] : '';
}

export function mimeFromName(name: string): string {
  return EXT_MIME[extOf(name)] || '';
}

export function extFromMime(mime: string): string {
  const found = Object.entries(EXT_MIME).find(([, m]) => m === mime);
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'audio/mpeg') return 'mp3';
  if (mime === 'application/fbx') return 'fbx';
  return found ? found[0] : 'bin';
}

export function kindOfMime(mime: string): AssetKind {
  if (mime === 'application/x-fbx-color') return 'color';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('font/') || mime.includes('font')) return 'font';
  if (mime.startsWith('model/') || mime === 'application/fbx') return 'model';
  return 'other';
}

export function isMediaMime(mime: string): boolean {
  const k = kindOfMime(mime);
  return k !== 'other';
}

export function formatBytes(n: number): string {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(2) + ' MB';
}

/** Kích thước byte của chuỗi khi lưu dạng UTF-8 */
export function utf8Size(s: string): number {
  return new TextEncoder().encode(s).length;
}

export function base64DecodedSize(b64: string): number {
  const len = b64.length;
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.floor((len * 3) / 4) - pad;
}

/** PNG/JPEG/GIF/WEBP: đọc kích thước ảnh từ header, không cần decode */
export function readImageSize(b: Uint8Array): { width: number; height: number } | null {
  const mime = sniffMime(b);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  try {
    if (mime === 'image/png' && b.length >= 24) return { width: dv.getUint32(16), height: dv.getUint32(20) };
    if (mime === 'image/gif' && b.length >= 10) return { width: dv.getUint16(6, true), height: dv.getUint16(8, true) };
    if (mime === 'image/webp' && b.length >= 30) {
      const fmt = ascii(b, 12, 4);
      if (fmt === 'VP8 ') return { width: dv.getUint16(26, true) & 0x3fff, height: dv.getUint16(28, true) & 0x3fff };
      if (fmt === 'VP8L') {
        const bits = dv.getUint32(21, true);
        return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
      }
      if (fmt === 'VP8X') {
        const w = 1 + (b[24] | (b[25] << 8) | (b[26] << 16));
        const h = 1 + (b[27] | (b[28] << 8) | (b[29] << 16));
        return { width: w, height: h };
      }
    }
    if (mime === 'image/jpeg') {
      let i = 2;
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) { i++; continue; }
        const marker = b[i + 1];
        const len = dv.getUint16(i + 2);
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { width: dv.getUint16(i + 7), height: dv.getUint16(i + 5) };
        }
        i += 2 + len;
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}
