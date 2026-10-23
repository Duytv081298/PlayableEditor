import { describe, it, expect } from 'vitest';
import { parsePlayable, serializeProject, syncGlbAssets } from '../src/lib/project';
import { parseGlb } from '../src/lib/glb';
import { bytesToBase64 } from '../src/lib/binary';

const PNG_1PX = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='),
  (c) => c.charCodeAt(0),
);
const PNG_2PX = Uint8Array.from(
  // PNG 2x2 xanh (file khác kích thước ảnh gốc, vẫn là ảnh png hợp lệ)
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFUlEQVR4nGP8z8DwnwEJMBER' +
      'FAAAhIIBAZyiEzAAAAAASUVORK5CYII=',
  ),
  (c) => c.charCodeAt(0),
);

function pad4(n: number) { return (4 - (n % 4)) % 4; }

function makeGlb(): Uint8Array {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const geoBytes = new Uint8Array(positions.buffer);
  const imgOffset = geoBytes.length + pad4(geoBytes.length);
  const json = {
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
    materials: [{ name: 'Skin', pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
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
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
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

describe('model 3D trong 1 file playable (UI 2D + âm thanh + vật liệu của model)', () => {
  it('tách được ảnh UI, âm thanh và vật liệu model; thay vật liệu rồi ghi lại HTML vẫn là glb hợp lệ', async () => {
    const glb = makeGlb();
    const uiPng = PNG_1PX; // dùng lại ảnh UI 2D độc lập, khác vị trí trong HTML với ảnh trong glb
    const sfxMp3 = Uint8Array.from(atob('SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjYxLjcuMTAwAAAAAAAAAAAAAAD/80DEAAAAA0gAAAAATEFN'), (c) => c.charCodeAt(0));

    const html = `<!doctype html><html><body>
      <img id="ui_button" src="data:image/png;base64,${bytesToBase64(uiPng)}">
      <audio id="sfx" src="data:audio/mpeg;base64,${bytesToBase64(sfxMp3)}"></audio>
      <script>var modelData = "data:model/gltf-binary;base64,${bytesToBase64(glb)}";</script>
    </body></html>`;

    const p = await parsePlayable(html, 'scene3d.html');
    expect(p.info.engine).toBe('Không rõ'); // không có dấu hiệu engine cụ thể trong HTML tối giản này

    const uiAssets = p.assets.filter((a) => a.kind === 'image' && !a.glbParent);
    const audioAssets = p.assets.filter((a) => a.kind === 'audio');
    const modelAssets = p.assets.filter((a) => a.kind === 'model');
    const materialAssets = p.assets.filter((a) => !!a.glbParent);

    expect(uiAssets).toHaveLength(1);
    expect(audioAssets).toHaveLength(1);
    expect(modelAssets).toHaveLength(1);
    expect(materialAssets).toHaveLength(1);
    expect(materialAssets[0].name).toBe('Skin · baseColor');

    // round-trip không đổi gì phải cho lại đúng HTML gốc
    expect(await serializeProject(p)).toBe(html);

    // thay UI, âm thanh, và vật liệu của model cùng lúc
    uiAssets[0].replacement = { bytes: PNG_2PX, mime: 'image/png', fileName: 'ui2.png' };
    audioAssets[0].replacement = { bytes: sfxMp3, mime: 'audio/mpeg', fileName: 'sfx2.mp3' };
    materialAssets[0].replacement = { bytes: PNG_2PX, mime: 'image/png', fileName: 'skin2.png' };
    syncGlbAssets(p.assets);
    expect(modelAssets[0].replacement).toBeTruthy(); // được tự dựng lại từ vật liệu đã thay

    const out = await serializeProject(p);
    expect(out).not.toBe(html);
    expect(out).toContain(`data:image/png;base64,${bytesToBase64(PNG_2PX)}`); // ảnh UI đã đổi

    // lấy lại chuỗi base64 của model trong HTML mới, giải mã, kiểm tra vật liệu đã đổi và hình học còn nguyên
    const m = out.match(/data:model\/gltf-binary;base64,([A-Za-z0-9+/=]+)/);
    expect(m).not.toBeNull();
    const rebuiltGlb = Uint8Array.from(atob(m![1]), (c) => c.charCodeAt(0));
    const reparsed = parseGlb(rebuiltGlb)!;
    expect(reparsed).not.toBeNull();
    const bv = reparsed.json.bufferViews[reparsed.images[0].bufferViewIndex];
    expect(reparsed.bin.subarray(bv.byteOffset, bv.byteOffset + bv.byteLength)).toEqual(PNG_2PX);
    const geoBv = reparsed.json.bufferViews[0];
    const geo = new Float32Array(reparsed.bin.buffer, reparsed.bin.byteOffset + geoBv.byteOffset, 9);
    expect(Array.from(geo)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]); // hình học không bị hỏng

    // hoàn tác vật liệu -> model trở lại giống hệt file gốc
    materialAssets[0].replacement = undefined;
    syncGlbAssets(p.assets);
    expect(modelAssets[0].replacement).toBeUndefined();
  });
});
