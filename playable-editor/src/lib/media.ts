// Xử lý file thay thế trên trình duyệt: đo kích thước, co ảnh về kích thước gốc, đo thời lượng audio
import type { Asset, Replacement } from './project';
import { kindOfMime, mimeFromName, readImageSize, sniffMime } from './binary';

export type FitMode = 'contain' | 'cover' | 'stretch' | 'none';

export const FIT_LABELS: Record<FitMode, string> = {
  contain: 'Giữ kích thước gốc – co vừa',
  cover: 'Giữ kích thước gốc – phủ kín (cắt)',
  stretch: 'Giữ kích thước gốc – kéo giãn',
  none: 'Dùng nguyên file mới',
};

async function encodeCanvas(canvas: HTMLCanvasElement, mime: string, quality: number): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, mime, quality));
  if (!blob) throw new Error('Không mã hoá được ảnh');
  return new Uint8Array(await blob.arrayBuffer());
}

export async function prepareReplacement(asset: Asset, file: File, fit: FitMode, quality = 0.9): Promise<{ rep: Replacement; note?: string }> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = sniffMime(bytes.subarray(0, 32)) || file.type || mimeFromName(file.name);
  const kind = kindOfMime(mime);
  let note: string | undefined;
  if (kind !== asset.kind) note = `File mới là ${kind}, tài nguyên gốc là ${asset.kind}.`;

  if (asset.kind === 'image' && kind === 'image') {
    const size = readImageSize(bytes);
    const W = asset.width;
    const H = asset.height;
    const sameSize = size && W && H && size.width === W && size.height === H;
    const sameMime = mime === asset.mime;
    if (fit === 'none' || !W || !H || (sameSize && sameMime) || mime === 'image/svg+xml') {
      if (!sameMime) note = `Định dạng đổi ${asset.mime} → ${mime}.`;
      return { rep: { bytes, mime, fileName: file.name, width: size?.width, height: size?.height }, note };
    }
    const bmp = await createImageBitmap(new Blob([bytes], { type: mime }));
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const g = canvas.getContext('2d')!;
    const outMime = ['image/png', 'image/jpeg', 'image/webp'].includes(asset.mime) ? asset.mime : 'image/png';
    if (outMime === 'image/jpeg') {
      g.fillStyle = '#fff';
      g.fillRect(0, 0, W, H);
    }
    let dw = W, dh = H;
    if (fit !== 'stretch') {
      const s = fit === 'contain' ? Math.min(W / bmp.width, H / bmp.height) : Math.max(W / bmp.width, H / bmp.height);
      dw = bmp.width * s;
      dh = bmp.height * s;
    }
    g.imageSmoothingQuality = 'high';
    g.drawImage(bmp, (W - dw) / 2, (H - dh) / 2, dw, dh);
    const out = await encodeCanvas(canvas, outMime, quality);
    if (size && !sameSize) note = `Ảnh ${size.width}×${size.height} → ${W}×${H} (${FIT_LABELS[fit].split('– ')[1]}).`;
    return { rep: { bytes: out, mime: outMime, fileName: file.name, width: W, height: H }, note };
  }

  if (asset.kind === 'audio' && kind === 'audio' && mime !== asset.mime) {
    note = `Audio đổi ${asset.mime} → ${mime}. Nên dùng cùng định dạng (iOS không phát được ogg).`;
  }
  return { rep: { bytes, mime, fileName: file.name }, note };
}

const durCache = new WeakMap<Uint8Array, number>();
export function audioDuration(bytes: Uint8Array, mime: string): Promise<number> {
  const c = durCache.get(bytes);
  if (c != null) return Promise.resolve(c);
  return new Promise((resolve) => {
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    const a = new Audio();
    a.preload = 'metadata';
    a.onloadedmetadata = () => {
      durCache.set(bytes, a.duration);
      URL.revokeObjectURL(url);
      resolve(a.duration);
    };
    a.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(NaN);
    };
    a.src = url;
  });
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function baseName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}
