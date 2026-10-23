// Đọc/ghi FBX nhị phân (Autodesk FBX Binary) để sửa vật liệu (material) của model:
// - màu (DiffuseColor, SpecularColor, AmbientColor, EmissiveColor...) khai báo trực
//   tiếp trong material, không cần ảnh.
// - texture nhúng kèm theo file (node Video có property "Content" chứa ảnh thật) —
//   nhiều file FBX export không nhúng (chỉ ghi đường dẫn ngoài máy người làm), khi đó
//   không có dữ liệu ảnh nào trong chính file FBX để lấy ra.
//
// Cấu trúc: header 27 byte ("Kaydara FBX Binary  \0" + 2 byte + version uint32) rồi
// tới danh sách "node record" lồng nhau tới khi gặp 1 node rỗng (13 hoặc 25 byte 0,
// tuỳ version <7500 hay >=7500 — offset trong file này đều 4 byte vì version 7400).
// Mỗi node: EndOffset, NumProperties, PropertyListLen, NameLen, Name, rồi tới danh
// sách property (mỗi property có 1 byte mã kiểu rồi tới dữ liệu), rồi tới các node con.
//
// Chiến lược ghi lại an toàn: với mỗi node, nếu bản thân nó và toàn bộ node con đều
// KHÔNG đổi gì, ghi lại nguyên byte gốc (raw slice) — không re-encode, không rủi ro.
// Chỉ node nào có thay đổi (hoặc có con cháu thay đổi) mới dựng lại từ đầu, tự tính
// lại EndOffset — các anh em (sibling) không đổi vẫn giữ nguyên byte như cũ.

export type FbxPropType = 'Y' | 'C' | 'I' | 'L' | 'F' | 'D' | 'f' | 'd' | 'l' | 'i' | 'c' | 'b' | 'S' | 'R';

export interface FbxProp {
  type: FbxPropType;
  /** đúng byte đã mã hoá trong file gốc, TÍNH CẢ 1 byte mã kiểu ở đầu */
  raw: Uint8Array;
  /** chỉ có khi type==='D': giá trị double đã giải mã, để hiển thị/so sánh */
  numberValue?: number;
  /** chỉ có khi type==='S': chuỗi đã giải mã (giữ byte gốc latin1, Cocos/FBX hay nối "Tên\0\x01Lớp") */
  stringValue?: string;
  /** chỉ có khi type==='R': byte thô (ảnh nhúng, nếu có) */
  rawBytes?: Uint8Array;
  /** được set khi sửa: giá trị double mới (ghi đè numberValue lúc dựng lại) */
  newNumber?: number;
  /** được set khi sửa: byte mới cho property R (ảnh nhúng mới, có thể khác độ dài) */
  newBytes?: Uint8Array;
}

export interface FbxNode {
  name: string;
  props: FbxProp[];
  children: FbxNode[];
  /** File gốc có null-record (13/25 byte 0) đóng node này không. QUAN TRỌNG: 1 node có thể
   *  CÓ null-record dù children.length===0 (gặp thực tế ở node "References" trong house.fbx
   *  — có vùng null-record nhưng không chứa node con nào). Dùng field này khi ghi lại thay vì
   *  suy ra từ children.length, nếu không sẽ mất đúng 13/25 byte đó mỗi lần dựng lại. */
  nullTerminated: boolean;
}

export interface FbxModel {
  version: number;
  nodes: FbxNode[];
}

const MAGIC = 'Kaydara FBX Binary  \x00';
const FIXED_SIZE: Record<string, number> = { Y: 2, C: 1, I: 4, L: 8, F: 4, D: 8 };
const ARRAY_TYPES = new Set(['f', 'd', 'l', 'i', 'c', 'b']);

class Reader {
  pos = 0;
  constructor(public data: Uint8Array, public dv: DataView) {}
  u32() { const v = this.dv.getUint32(this.pos, true); this.pos += 4; return v; }
  u8() { return this.data[this.pos++]; }
}

function readProperty(r: Reader): FbxProp {
  const start = r.pos;
  const type = String.fromCharCode(r.u8()) as FbxPropType;
  if (FIXED_SIZE[type] != null) {
    const size = FIXED_SIZE[type];
    let numberValue: number | undefined;
    if (type === 'D') numberValue = r.dv.getFloat64(r.pos, true);
    r.pos += size;
    const raw = r.data.subarray(start, r.pos);
    return { type, raw, numberValue };
  }
  if (ARRAY_TYPES.has(type)) {
    const arrLen = r.dv.getUint32(r.pos, true);
    const encoding = r.dv.getUint32(r.pos + 4, true);
    const compLen = r.dv.getUint32(r.pos + 8, true);
    void arrLen; void encoding;
    r.pos += 12 + compLen;
    const raw = r.data.subarray(start, r.pos);
    return { type, raw };
  }
  if (type === 'S' || type === 'R') {
    const len = r.dv.getUint32(r.pos, true);
    r.pos += 4;
    const bytes = r.data.subarray(r.pos, r.pos + len);
    r.pos += len;
    const raw = r.data.subarray(start, r.pos);
    if (type === 'S') return { type, raw, stringValue: new TextDecoder('latin1').decode(bytes) };
    return { type, raw, rawBytes: bytes };
  }
  throw new Error(`FBX: không nhận ra mã kiểu property '${type}' ở byte ${start}`);
}

/** 13 byte 0 (version<7500) hoặc 25 byte 0 (version>=7500) đánh dấu hết danh sách node con */
function nullRecordLen(version: number): number {
  return version >= 7500 ? 25 : 13;
}

function isNullRecord(data: Uint8Array, pos: number, len: number): boolean {
  if (pos + len > data.length) return false;
  for (let i = 0; i < len; i++) if (data[pos + i] !== 0) return false;
  return true;
}

function readNode(r: Reader, version: number): FbxNode | null {
  const nullLen = nullRecordLen(version);
  if (isNullRecord(r.data, r.pos, nullLen)) {
    r.pos += nullLen;
    return null;
  }
  const endOffset = r.u32();
  const numProps = r.u32();
  const propListLen = r.u32();
  const nameLen = r.u8();
  const name = new TextDecoder('latin1').decode(r.data.subarray(r.pos, r.pos + nameLen));
  r.pos += nameLen;
  const propStart = r.pos;
  const props: FbxProp[] = [];
  for (let i = 0; i < numProps; i++) props.push(readProperty(r));
  if (r.pos !== propStart + propListLen) {
    throw new Error(`FBX: lệch vị trí sau khi đọc property của node "${name}" (mong ${propStart + propListLen}, thực ${r.pos})`);
  }
  const children: FbxNode[] = [];
  // Vùng này tồn tại (và luôn kết thúc bằng 1 null-record) bất kể có đọc được node con nào
  // không — 1 node có thể "rỗng" (0 con) nhưng vẫn có null-record do file gốc ghi vậy.
  const nullTerminated = endOffset > r.pos;
  if (nullTerminated) {
    while (r.pos < endOffset) {
      const child = readNode(r, version);
      if (child === null) break;
      children.push(child);
    }
  }
  return { name, props, children, nullTerminated };
}

export function parseFbx(bytes: Uint8Array): FbxModel | null {
  if (bytes.length < 27) return null;
  const magic = new TextDecoder('latin1').decode(bytes.subarray(0, 21));
  if (magic !== MAGIC) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = dv.getUint32(23, true);
  const r = new Reader(bytes, dv);
  r.pos = 27;
  const nodes: FbxNode[] = [];
  try {
    while (r.pos < bytes.length) {
      // sau node top-level cuối, phần đuôi file (footer) không theo cấu trúc node — dừng
      // khi không còn đọc được 1 node hợp lệ ở mức ngoài cùng.
      const before = r.pos;
      let node: FbxNode | null;
      try {
        node = readNode(r, version);
      } catch {
        break;
      }
      if (node === null) {
        void before;
        break; // gặp null-record ở mức ngoài cùng = hết danh sách node, phần còn lại là footer
      }
      nodes.push(node);
    }
  } catch {
    if (!nodes.length) return null;
  }
  if (!nodes.length) return null;
  return { version, nodes };
}

// ---------------- Vật liệu: màu ----------------

export interface FbxColorProp {
  /** node Material cha */
  materialName: string;
  /** tên property: DiffuseColor, SpecularColor, AmbientColor, EmissiveColor... */
  propName: string;
  /** 3 property con kiểu D giữ giá trị R,G,B (0..1) trong node "P" */
  components: [FbxProp, FbxProp, FbxProp];
}

const COLOR_PROP_NAMES = ['DiffuseColor', 'SpecularColor', 'AmbientColor', 'EmissiveColor', 'ReflectionColor'];

/** Tên hiển thị của 1 node Material/Texture/Video: FBX ghép "Tên\0\x01Lớp" vào property[1] */
function objectDisplayName(node: FbxNode): string {
  const p1 = node.props[1]?.stringValue ?? '';
  const i = p1.indexOf('\x00\x01');
  return i >= 0 ? p1.slice(0, i) : p1 || node.name;
}

export function listColorProps(model: FbxModel): FbxColorProp[] {
  const out: FbxColorProp[] = [];
  for (const top of model.nodes) {
    if (top.name !== 'Objects') continue;
    for (const obj of top.children) {
      if (obj.name !== 'Material') continue;
      const materialName = objectDisplayName(obj);
      const props70 = obj.children.find((c) => c.name === 'Properties70');
      if (!props70) continue;
      for (const p of props70.children) {
        if (p.name !== 'P') continue;
        const propName = p.props[0]?.stringValue;
        if (!propName || !COLOR_PROP_NAMES.includes(propName)) continue;
        // bố cục chuẩn: [Name S, Type S, Label S, Flags S, R D, G D, B D]
        const comps = p.props.slice(4).filter((x) => x.type === 'D');
        if (comps.length >= 3) out.push({ materialName, propName, components: [comps[0], comps[1], comps[2]] });
      }
    }
  }
  return out;
}

// ---------------- Vật liệu: texture nhúng kèm (Video > Content) ----------------

export interface FbxEmbeddedTexture {
  videoName: string;
  /** tên texture + material đang dùng video này, nếu nối được qua Connections */
  label: string;
  node: FbxNode;
  /** property R giữ ảnh nhúng */
  content: FbxProp;
  mime: string;
  relativeFilename: string;
}

function guessImageMime(bytes: Uint8Array): string {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  return 'application/octet-stream';
}

/** Connections: node "C"/"OO" nối objectId texture -> objectId material (không dùng tới objectId
 *  ở đây vì FBX do Blender/Maya xuất thường không gán objectId tường minh cho Video/Texture khi
 *  export tối giản — ta chỉ dùng tên Video/Texture để gợi ý nhãn, không bắt buộc phải khớp. */
export function listEmbeddedTextures(model: FbxModel): FbxEmbeddedTexture[] {
  const out: FbxEmbeddedTexture[] = [];
  for (const top of model.nodes) {
    if (top.name !== 'Objects') continue;
    for (const obj of top.children) {
      if (obj.name !== 'Video') continue;
      const content = obj.children.find((c) => c.name === 'Content' && c.props[0]?.type === 'R');
      const contentProp = content?.props[0];
      if (!contentProp || !contentProp.rawBytes || contentProp.rawBytes.length === 0) continue;
      const videoName = objectDisplayName(obj);
      const relNode = obj.children.find((c) => c.name === 'RelativeFilename' || c.name === 'Filename');
      const relativeFilename = relNode?.props[0]?.stringValue ?? videoName;
      out.push({
        videoName,
        label: videoName,
        node: obj,
        content: contentProp,
        mime: guessImageMime(contentProp.rawBytes),
        relativeFilename,
      });
    }
  }
  return out;
}

// ---------------- Ghi lại ----------------

function isDirtyProp(p: FbxProp): boolean {
  return p.newNumber !== undefined || p.newBytes !== undefined;
}

function isDirtyNode(n: FbxNode): boolean {
  return n.props.some(isDirtyProp) || n.children.some(isDirtyNode);
}

function encodeProp(p: FbxProp): Uint8Array {
  if (p.newNumber !== undefined) {
    const out = new Uint8Array(9);
    out[0] = 'D'.charCodeAt(0);
    new DataView(out.buffer).setFloat64(1, p.newNumber, true);
    return out;
  }
  if (p.newBytes !== undefined) {
    const out = new Uint8Array(5 + p.newBytes.length);
    out[0] = 'R'.charCodeAt(0);
    new DataView(out.buffer).setUint32(1, p.newBytes.length, true);
    out.set(p.newBytes, 5);
    return out;
  }
  return p.raw;
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** Ghi lại 1 node; trả về byte đã mã hoá đầy đủ (header+property+con+null-record).
 *  Node con dù có đổi hay không đều được mã hoá lại từ dữ liệu đã phân tích (property
 *  không đổi thì encodeProp trả đúng `raw` gốc) — đơn giản, đúng tuyệt đối, đổi lại
 *  "EndOffset" tương đối sẽ được fixAbsoluteOffsets tính thành vị trí tuyệt đối sau. */
function encodeNode(n: FbxNode, version: number): Uint8Array {
  const nullLen = nullRecordLen(version);
  const propsBytes = n.props.map(encodeProp);
  const propListLen = propsBytes.reduce((s, b) => s + b.length, 0);
  const childrenBytes = n.children.map((c) => encodeNode(c, version));
  const childrenLen = childrenBytes.reduce((s, b) => s + b.length, 0) + (n.nullTerminated ? nullLen : 0);
  const nameBytes = new TextEncoder().encode(n.name);
  const headerLen = 12 + 1 + nameBytes.length;
  const total = headerLen + propListLen + childrenLen;

  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, total, true); // EndOffset tính TƯƠNG ĐỐI sẽ được cộng dồn absolute ở bước nối cây
  dv.setUint32(4, n.props.length, true);
  dv.setUint32(8, propListLen, true);
  out[12] = nameBytes.length;
  out.set(nameBytes, 13);
  let o = headerLen;
  for (const b of propsBytes) { out.set(b, o); o += b.length; }
  for (const b of childrenBytes) { out.set(b, o); o += b.length; }
  if (n.nullTerminated) o += nullLen; // vùng null-record để 0 sẵn (Uint8Array khởi tạo = 0)
  return out;
}

/** EndOffset trong FBX là vị trí TUYỆT ĐỐI trong toàn file — encodeNode ở trên tạm ghi độ dài
 *  tương đối; hàm này duyệt lại và cộng dồn offset tuyệt đối đúng chuẩn trước khi trả về file
 *  cuối cùng. Làm ở cấp "toàn file" thay vì truyền offset xuống từng lời gọi đệ quy cho dễ theo dõi. */
function fixAbsoluteOffsets(bytes: Uint8Array, baseOffset: number, version: number): void {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const nullLen = nullRecordLen(version);
  let pos = 0;
  while (pos < bytes.length) {
    if (isNullRecord(bytes, pos, nullLen)) { pos += nullLen; continue; }
    const relEnd = dv.getUint32(pos, true);
    const numProps = dv.getUint32(pos + 4, true);
    const propListLen = dv.getUint32(pos + 8, true);
    const nameLen = bytes[pos + 12];
    const headerLen = 12 + 1 + nameLen;
    const absEnd = baseOffset + pos + relEnd;
    dv.setUint32(pos, absEnd, true);
    void numProps;
    const childStart = pos + headerLen + propListLen;
    if (relEnd > headerLen + propListLen) {
      fixAbsoluteOffsets(bytes.subarray(childStart, pos + relEnd), baseOffset + childStart, version);
    }
    pos += relEnd;
  }
}

/** Có property/node nào bị sửa chưa — dùng để biết có cần dựng lại file hay giữ nguyên byte gốc. */
export function hasFbxEdits(model: FbxModel): boolean {
  return model.nodes.some(isDirtyNode);
}

export function buildFbx(model: FbxModel, originalBytes: Uint8Array): Uint8Array {
  const headerLen = 27;
  const bodies = model.nodes.map((n) => encodeNode(n, model.version));
  const nullLen = nullRecordLen(model.version);
  const nullPad = new Uint8Array(nullLen);
  const body = concatBytes([...bodies, nullPad]);
  fixAbsoluteOffsets(body, headerLen, model.version);
  const head = originalBytes.subarray(0, headerLen);
  const tail = originalBytes.subarray(findOriginalBodyEnd(originalBytes, model.version));
  return concatBytes([head, body, tail]);
}

/** Tìm điểm cuối vùng "node tree" trong file gốc (trước phần footer FBX, vốn không parse được
 *  như node) để giữ nguyên phần đuôi file (footer id, magic, padding...) khi ghi lại. */
function findOriginalBodyEnd(bytes: Uint8Array, version: number): number {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const nullLen = nullRecordLen(version);
  let pos = 27;
  let lastGoodEnd = pos;
  while (pos < bytes.length) {
    // null-record đánh dấu HẾT danh sách node top-level — sau nó là footer, dừng luôn,
    // không đọc tiếp (byte footer không theo cấu trúc node, đọc nhầm sẽ ra rác).
    if (isNullRecord(bytes, pos, nullLen)) { lastGoodEnd = pos + nullLen; break; }
    if (pos + 13 > bytes.length) break;
    const endOffset = dv.getUint32(pos, true);
    if (endOffset <= pos || endOffset > bytes.length) break;
    pos = endOffset;
    lastGoodEnd = pos;
  }
  return lastGoodEnd;
}
