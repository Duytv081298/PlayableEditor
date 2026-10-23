// Đọc/ghi glTF nhị phân (.glb): tách riêng từng ảnh dùng làm vật liệu (material) của
// model để sửa, rồi đóng gói lại đúng chuẩn mà không làm hỏng phần hình học (mesh).
//
// Cấu trúc GLB: header 12 byte (magic "glTF", version=2, tổng độ dài)
// + 1..n khối (chunk length, chunk type, dữ liệu): khối "JSON" (bắt buộc) và khối
// "BIN\0" (dữ liệu nhị phân gộp: mesh, ảnh nhúng...). Ảnh nhúng trỏ tới một vùng
// byte trong khối BIN qua `images[i].bufferView`. Khi đổi kích thước 1 ảnh, mọi
// bufferView đứng sau nó phải dịch offset — nên phải dựng lại toàn bộ khối BIN
// theo đúng thứ tự gốc, không chỉ riêng ảnh đã đổi.

const MAGIC = 0x46546c67; // "glTF"
const JSON_TYPE = 0x4e4f534a; // "JSON"
const BIN_TYPE = 0x004e4942; // "BIN\0"

export interface GlbImage {
  /** chỉ số trong json.images */
  index: number;
  bufferViewIndex: number;
  mime: string;
  name: string;
}

export interface GlbModel {
  json: Record<string, any>;
  bin: Uint8Array;
  images: GlbImage[];
}

/** Đọc GLB. Trả về null nếu không phải GLB hợp lệ, hoặc dùng cấu trúc buffer
 *  ngoài phạm vi hỗ trợ (nhiều buffer / buffer ngoài) — khi đó model vẫn được
 *  xử lý như 1 file nhị phân thay nguyên khối, chỉ là không tách được vật liệu. */
export function parseGlb(bytes: Uint8Array): GlbModel | null {
  if (bytes.length < 12) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== MAGIC || dv.getUint32(4, true) !== 2) return null;
  const total = dv.getUint32(8, true);
  let off = 12;
  let jsonChunk: Uint8Array | null = null;
  let binChunk: Uint8Array | null = null;
  while (off + 8 <= bytes.length && off < total) {
    const len = dv.getUint32(off, true);
    const type = dv.getUint32(off + 4, true);
    const data = bytes.subarray(off + 8, off + 8 + len);
    if (type === JSON_TYPE) jsonChunk = data;
    else if (type === BIN_TYPE) binChunk = data;
    off += 8 + len;
  }
  if (!jsonChunk || !binChunk) return null;
  let json: Record<string, any>;
  try {
    json = JSON.parse(new TextDecoder().decode(jsonChunk));
  } catch {
    return null;
  }
  // chỉ hỗ trợ đúng 1 buffer nhúng (trường hợp phổ biến nhất của GLB tự chứa)
  if ((json.buffers?.length ?? 0) !== 1 || json.buffers[0].uri) return null;

  const images: GlbImage[] = [];
  (json.images || []).forEach((img: any, i: number) => {
    if (img.bufferView == null) return;
    if (img.mimeType !== 'image/png' && img.mimeType !== 'image/jpeg') return;
    const bv = json.bufferViews?.[img.bufferView];
    if (!bv || (bv.buffer ?? 0) !== 0) return;
    images.push({ index: i, bufferViewIndex: img.bufferView, mime: img.mimeType, name: img.name || `image_${i}` });
  });
  return { json, bin: binChunk, images };
}

/** Tìm vật liệu (material) + vai trò (baseColor, normal...) đang dùng ảnh này, để đặt tên dễ hiểu. */
export function materialLabelFor(json: Record<string, any>, imageIndex: number): string | null {
  const texIdx = (json.textures || []).findIndex((t: any) => t.source === imageIndex);
  if (texIdx < 0) return null;
  const slotsOf = (mat: any): Array<[number | undefined, string]> => [
    [mat.pbrMetallicRoughness?.baseColorTexture?.index, 'baseColor'],
    [mat.pbrMetallicRoughness?.metallicRoughnessTexture?.index, 'metallicRoughness'],
    [mat.normalTexture?.index, 'normal'],
    [mat.occlusionTexture?.index, 'occlusion'],
    [mat.emissiveTexture?.index, 'emissive'],
  ];
  for (const mat of json.materials || []) {
    for (const [idx, slot] of slotsOf(mat)) {
      if (idx === texIdx) return `${mat.name || 'material'} · ${slot}`;
    }
  }
  return null;
}

/** Đóng gói lại GLB với ảnh đã thay (key = chỉ số trong json.images). Giữ nguyên
 *  phần hình học, chỉ dựng lại khối BIN theo đúng thứ tự offset gốc. */
export function buildGlb(model: GlbModel, replacements: Map<number, { bytes: Uint8Array; mime: string }>): Uint8Array {
  const json = JSON.parse(JSON.stringify(model.json));
  const bufferViews: any[] = json.bufferViews || [];

  const byBufferView = new Map<number, { bytes: Uint8Array; mime: string; imageIndex: number }>();
  for (const img of model.images) {
    const rep = replacements.get(img.index);
    if (rep) byBufferView.set(img.bufferViewIndex, { ...rep, imageIndex: img.index });
  }

  const order = bufferViews.map((_, i) => i).sort((a, b) => (bufferViews[a].byteOffset || 0) - (bufferViews[b].byteOffset || 0));
  const chunks: Uint8Array[] = [];
  let pos = 0;
  const pad4 = () => {
    const rem = pos % 4;
    if (rem) {
      const p = new Uint8Array(4 - rem);
      chunks.push(p);
      pos += p.length;
    }
  };
  for (const i of order) {
    const bv = bufferViews[i];
    pad4();
    const rep = byBufferView.get(i);
    let data: Uint8Array;
    if (rep) {
      data = rep.bytes;
      bv.byteLength = data.length;
      if (json.images?.[rep.imageIndex]) json.images[rep.imageIndex].mimeType = rep.mime;
    } else {
      const off = bv.byteOffset || 0;
      data = model.bin.subarray(off, off + bv.byteLength);
    }
    bv.byteOffset = pos;
    chunks.push(data);
    pos += data.length;
  }
  const contentLength = pos;
  const tailPad = (4 - (pos % 4)) % 4;
  if (tailPad) {
    chunks.push(new Uint8Array(tailPad));
    pos += tailPad;
  }
  const bin = new Uint8Array(pos);
  let w = 0;
  for (const c of chunks) {
    bin.set(c, w);
    w += c.length;
  }
  if (json.buffers?.[0]) json.buffers[0].byteLength = contentLength;

  let jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
  if (jsonPad) {
    const padded = new Uint8Array(jsonBytes.length + jsonPad);
    padded.set(jsonBytes);
    padded.fill(0x20, jsonBytes.length); // JSON chunk đệm bằng khoảng trắng theo chuẩn glTF
    jsonBytes = padded;
  }

  const total = 12 + 8 + jsonBytes.length + 8 + bin.length;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, MAGIC, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  let o = 12;
  dv.setUint32(o, jsonBytes.length, true); o += 4;
  dv.setUint32(o, JSON_TYPE, true); o += 4;
  out.set(jsonBytes, o); o += jsonBytes.length;
  dv.setUint32(o, bin.length, true); o += 4;
  dv.setUint32(o, BIN_TYPE, true); o += 4;
  out.set(bin, o);
  return out;
}
