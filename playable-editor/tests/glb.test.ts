import { describe, it, expect } from 'vitest';
import { parseGlb, buildGlb, materialLabelFor } from '../src/lib/glb';

// PNG 1x1 đỏ hợp lệ (magic bytes đúng, đủ để sniffMime/parseGlb nhận ra)
const PNG_1PX = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  ),
  (c) => c.charCodeAt(0),
);
// JPEG 1x1 hợp lệ tối thiểu, dùng để test thay ảnh khác định dạng (png -> jpeg)
const JPEG_1PX = Uint8Array.from(
  atob(
    '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=',
  ),
  (c) => c.charCodeAt(0),
);

function pad4(n: number) { return (4 - (n % 4)) % 4; }

/** Dựng 1 file .glb tối giản: 1 tam giác (geometry) + 1 ảnh PNG dùng làm baseColor của 1 material. */
function makeGlb(): Uint8Array {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const geoBytes = new Uint8Array(positions.buffer);
  const geoPad = new Uint8Array(pad4(geoBytes.length));
  const imgOffset = geoBytes.length + geoPad.length;

  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
    materials: [{ name: 'Mat', pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
    textures: [{ source: 0 }],
    images: [{ mimeType: 'image/png', bufferView: 1 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: geoBytes.length, target: 34962 },
      { buffer: 0, byteOffset: imgOffset, byteLength: PNG_1PX.length },
    ],
    buffers: [{ byteLength: imgOffset + PNG_1PX.length }],
  };

  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonPad = new Uint8Array(pad4(jsonBytes.length)).fill(0x20);
  const bin = new Uint8Array(imgOffset + PNG_1PX.length + pad4(imgOffset + PNG_1PX.length));
  bin.set(geoBytes, 0);
  bin.set(PNG_1PX, imgOffset);

  const total = 12 + 8 + jsonBytes.length + jsonPad.length + 8 + bin.length;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  let o = 12;
  dv.setUint32(o, jsonBytes.length + jsonPad.length, true); o += 4;
  dv.setUint32(o, 0x4e4f534a, true); o += 4;
  out.set(jsonBytes, o); o += jsonBytes.length;
  out.set(jsonPad, o); o += jsonPad.length;
  dv.setUint32(o, bin.length, true); o += 4;
  dv.setUint32(o, 0x004e4942, true); o += 4;
  out.set(bin, o);
  return out;
}

describe('glb', () => {
  it('đọc đúng ảnh vật liệu + tên material', () => {
    const glb = makeGlb();
    const model = parseGlb(glb);
    expect(model).not.toBeNull();
    expect(model!.images).toHaveLength(1);
    expect(model!.images[0].mime).toBe('image/png');
    expect(materialLabelFor(model!.json, 0)).toBe('Mat · baseColor');
  });

  it('thay ảnh (đổi kích thước + đổi định dạng png->jpeg) rồi đóng gói lại vẫn đọc được, hình học giữ nguyên', () => {
    const glb = makeGlb();
    const model = parseGlb(glb)!;
    const out = buildGlb(model, new Map([[0, { bytes: JPEG_1PX, mime: 'image/jpeg' }]]));

    const reparsed = parseGlb(out)!;
    expect(reparsed).not.toBeNull();
    expect(reparsed.images[0].mime).toBe('image/jpeg');
    const bv = reparsed.json.bufferViews[reparsed.images[0].bufferViewIndex];
    const imgBytes = reparsed.bin.subarray(bv.byteOffset, bv.byteOffset + bv.byteLength);
    expect(imgBytes).toEqual(JPEG_1PX);

    // hình học (bufferView 0, 3 đỉnh float32) vẫn nguyên y dữ liệu gốc
    const geoBv = reparsed.json.bufferViews[0];
    const geo = new Float32Array(reparsed.bin.buffer, reparsed.bin.byteOffset + geoBv.byteOffset, 9);
    expect(Array.from(geo)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);

    // đóng gói lại lần nữa không đổi gì (idempotent) vẫn phải ra đúng ảnh jpeg đó
    const out2 = buildGlb(reparsed, new Map());
    const reparsed2 = parseGlb(out2)!;
    expect(reparsed2.images[0].mime).toBe('image/jpeg');
    const bv2 = reparsed2.json.bufferViews[reparsed2.images[0].bufferViewIndex];
    expect(reparsed2.bin.subarray(bv2.byteOffset, bv2.byteOffset + bv2.byteLength)).toEqual(JPEG_1PX);
  });

  it('không thay gì thì đóng gói lại cho đúng ảnh gốc', () => {
    const glb = makeGlb();
    const model = parseGlb(glb)!;
    const out = buildGlb(model, new Map());
    const reparsed = parseGlb(out)!;
    const bv = reparsed.json.bufferViews[reparsed.images[0].bufferViewIndex];
    const imgBytes = reparsed.bin.subarray(bv.byteOffset, bv.byteOffset + bv.byteLength);
    expect(imgBytes).toEqual(PNG_1PX);
  });
});
