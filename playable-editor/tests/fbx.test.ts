import { describe, it, expect } from 'vitest';
import { buildFbx, hasFbxEdits, listColorProps, listEmbeddedTextures, parseFbx } from '../src/lib/fbx';

// ---- bộ dựng FBX nhị phân tối giản (độc lập với fbx.ts) dùng làm "dữ liệu thật" cho test ----

const VERSION = 7400;

function encL(v: number): Uint8Array {
  const out = new Uint8Array(9);
  out[0] = 'L'.charCodeAt(0);
  new DataView(out.buffer).setBigInt64(1, BigInt(v), true);
  return out;
}
function encS(s: string): Uint8Array {
  const body = new TextEncoder().encode(s);
  const out = new Uint8Array(5 + body.length);
  out[0] = 'S'.charCodeAt(0);
  new DataView(out.buffer).setUint32(1, body.length, true);
  out.set(body, 5);
  return out;
}
function encD(v: number): Uint8Array {
  const out = new Uint8Array(9);
  out[0] = 'D'.charCodeAt(0);
  new DataView(out.buffer).setFloat64(1, v, true);
  return out;
}
function encR(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(5 + bytes.length);
  out[0] = 'R'.charCodeAt(0);
  new DataView(out.buffer).setUint32(1, bytes.length, true);
  out.set(bytes, 5);
  return out;
}

interface NodeSpec { name: string; props: Uint8Array[]; children: NodeSpec[]; forceNullRecord?: boolean; }
const node = (name: string, props: Uint8Array[] = [], children: NodeSpec[] = [], forceNullRecord?: boolean): NodeSpec => ({ name, props, children, forceNullRecord });

function buildNode(n: NodeSpec, version: number, nodeStart: number): Uint8Array {
  const nullLen = version >= 7500 ? 25 : 13;
  const nameBytes = new TextEncoder().encode(n.name);
  const headerLen = 12 + 1 + nameBytes.length;
  const propListLen = n.props.reduce((s, p) => s + p.length, 0);
  let childPos = nodeStart + headerLen + propListLen;
  const childBytesArr: Uint8Array[] = [];
  for (const c of n.children) {
    const cb = buildNode(c, version, childPos);
    childBytesArr.push(cb);
    childPos += cb.length;
  }
  // mô phỏng đúng kiểu file thật (Blender xuất): có node 0 con nhưng vẫn có null-record rỗng
  // (vd. node "References" trong house.fbx thật) — dùng forceNullRecord để test trường hợp đó.
  const needsNull = n.children.length > 0 || n.forceNullRecord;
  const childrenLen = childBytesArr.reduce((s, b) => s + b.length, 0) + (needsNull ? nullLen : 0);
  const total = headerLen + propListLen + childrenLen;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, nodeStart + total, true);
  dv.setUint32(4, n.props.length, true);
  dv.setUint32(8, propListLen, true);
  out[12] = nameBytes.length;
  out.set(nameBytes, 13);
  let o = headerLen;
  for (const p of n.props) { out.set(p, o); o += p.length; }
  for (const cb of childBytesArr) { out.set(cb, o); o += cb.length; }
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

const PNG_1PX = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='),
  (c) => c.charCodeAt(0),
);

/** Dựng 1 file .fbx nhị phân tối giản: 1 Material có màu DiffuseColor + 1 Video có texture nhúng. */
function makeFbx(): Uint8Array {
  const material = node('Material', [encL(0), encS('Mat1\x00\x01Material'), encS('')], [
    node('Properties70', [], [
      node('P', [encS('DiffuseColor'), encS('ColorRGB'), encS('Color'), encS(''), encD(0.2), encD(0.4), encD(0.6)]),
    ]),
  ]);
  const video = node('Video', [encL(0), encS('Tex1\x00\x01Video'), encS('')], [
    node('Content', [encR(PNG_1PX)]),
    node('RelativeFilename', [encS('tex1.png')]),
  ]);
  const objects = node('Objects', [], [material, video]);
  const unrelated = node('CreationTime', [encS('2024-01-01')]);
  // node 0 property, 0 con, nhưng CÓ null-record rỗng trong file gốc (như "References" trong
  // house.fbx thật) — nếu buildFbx quên null-record này thì sẽ mất đúng 13 byte khi dựng lại.
  const emptyWithNull = node('References', [], [], true);

  const headerLen = 27;
  const top = [objects, unrelated, emptyWithNull];
  let pos = headerLen;
  const bodies: Uint8Array[] = [];
  for (const n of top) {
    const b = buildNode(n, VERSION, pos);
    bodies.push(b);
    pos += b.length;
  }
  const topNullLen = 13;
  const body = concat([...bodies, new Uint8Array(topNullLen)]);

  const header = new Uint8Array(headerLen);
  header.set(new TextEncoder().encode('Kaydara FBX Binary  \x00'), 0);
  new DataView(header.buffer).setUint32(23, VERSION, true);

  const footer = new Uint8Array(16).fill(0xfa); // phần đuôi file bất kỳ, không theo cấu trúc node
  return concat([header, body, footer]);
}

describe('fbx', () => {
  it('đọc đúng màu vật liệu + texture nhúng', () => {
    const bytes = makeFbx();
    const model = parseFbx(bytes);
    expect(model).not.toBeNull();
    expect(model!.version).toBe(VERSION);

    const colors = listColorProps(model!);
    expect(colors).toHaveLength(1);
    expect(colors[0].materialName).toBe('Mat1');
    expect(colors[0].propName).toBe('DiffuseColor');
    const [r, g, b] = colors[0].components.map((p) => p.numberValue);
    expect([r, g, b]).toEqual([0.2, 0.4, 0.6]);

    const textures = listEmbeddedTextures(model!);
    expect(textures).toHaveLength(1);
    expect(textures[0].videoName).toBe('Tex1');
    expect(textures[0].content.rawBytes).toEqual(PNG_1PX);
  });

  it('không sửa gì thì dựng lại ra đúng file gốc (idempotent)', () => {
    const bytes = makeFbx();
    const model = parseFbx(bytes)!;
    expect(hasFbxEdits(model)).toBe(false);
    const out = buildFbx(model, bytes);
    expect(out).toEqual(bytes);
  });

  it('đổi màu DiffuseColor rồi dựng lại: màu mới đúng, texture + node khác giữ nguyên', () => {
    const bytes = makeFbx();
    const model = parseFbx(bytes)!;
    const [r, g, bch] = listColorProps(model).find((c) => c.propName === 'DiffuseColor')!.components;
    r.newNumber = 0.9;
    g.newNumber = 0.1;
    bch.newNumber = 0.05;
    expect(hasFbxEdits(model)).toBe(true);

    const out = buildFbx(model, bytes);
    const reparsed = parseFbx(out)!;
    const newColor = listColorProps(reparsed)[0];
    const vals = newColor.components.map((p) => p.numberValue);
    expect(vals[0]).toBeCloseTo(0.9);
    expect(vals[1]).toBeCloseTo(0.1);
    expect(vals[2]).toBeCloseTo(0.05);

    // texture nhúng không liên quan vẫn còn đúng y nguyên
    const tex = listEmbeddedTextures(reparsed)[0];
    expect(tex.content.rawBytes).toEqual(PNG_1PX);
  });

  it('đổi texture nhúng (khác độ dài) rồi dựng lại: ảnh mới đúng, màu vật liệu giữ nguyên', () => {
    const bytes = makeFbx();
    const model = parseFbx(bytes)!;
    const bigger = new Uint8Array(500).fill(0x42);
    listEmbeddedTextures(model)[0].content.newBytes = bigger;

    const out = buildFbx(model, bytes);
    const reparsed = parseFbx(out)!;
    expect(listEmbeddedTextures(reparsed)[0].content.rawBytes).toEqual(bigger);
    const vals = listColorProps(reparsed)[0].components.map((p) => p.numberValue);
    expect(vals).toEqual([0.2, 0.4, 0.6]);
  });
});
