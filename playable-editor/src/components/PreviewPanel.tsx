import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { SIM_OPTIONS, SimKind } from '../lib/channels';
import { makePreviewHtml } from '../lib/preview';

export interface LogEntry {
  id: number;
  type: 'log' | 'info' | 'warn' | 'error' | 'debug' | 'cta' | 'sim';
  msg: string;
  time: Date;
}

// Kích thước CSS px (không phải pixel vật lý) — đúng cái mà playable "thấy" khi chạy
// trong webview quảng cáo. Giữ nguyên id cũ (iphone14, iphonese, pixel7, ipad, g320,
// y300) để lựa chọn đã lưu trong localStorage của lần dùng trước vẫn khớp.
const DEVICE_GROUPS = [
  {
    group: 'iPhone',
    items: [
      { id: 'ip16pm', label: 'iPhone 16 Pro Max — 440×956', w: 440, h: 956 },
      { id: 'ip16p', label: 'iPhone 16 Pro / 15 Pro — 402×874', w: 402, h: 874 },
      { id: 'ip15', label: 'iPhone 15 / 14 Pro — 393×852', w: 393, h: 852 },
      { id: 'iphone14', label: 'iPhone 14 / 13 / 12 — 390×844', w: 390, h: 844 },
      { id: 'ip13mini', label: 'iPhone 13 mini — 375×812', w: 375, h: 812 },
      { id: 'iphonese', label: 'iPhone SE / 8 — 375×667', w: 375, h: 667 },
    ],
  },
  {
    group: 'Android',
    items: [
      { id: 'pixel8p', label: 'Pixel 8 Pro — 448×998', w: 448, h: 998 },
      { id: 'pixel7', label: 'Pixel 7 / 8 — 412×915', w: 412, h: 915 },
      { id: 'redmi', label: 'Xiaomi / Redmi — 393×873', w: 393, h: 873 },
      { id: 's24u', label: 'Galaxy S24 Ultra — 384×824', w: 384, h: 824 },
      { id: 's24', label: 'Galaxy S24 / S23 — 360×780', w: 360, h: 780 },
      { id: 'a54', label: 'Galaxy A / Oppo / Vivo — 360×800', w: 360, h: 800 },
      { id: 'a360640', label: 'Android phổ thông — 360×640', w: 360, h: 640 },
    ],
  },
  {
    group: 'Máy tính bảng',
    items: [
      { id: 'ipad', label: 'iPad mini — 768×1024', w: 768, h: 1024 },
      { id: 'ipad109', label: 'iPad 10.9" — 820×1180', w: 820, h: 1180 },
      { id: 'ipadpro11', label: 'iPad Pro 11" — 834×1194', w: 834, h: 1194 },
      { id: 'ipadpro129', label: 'iPad Pro 12.9" — 1024×1366', w: 1024, h: 1366 },
      { id: 'tabandroid', label: 'Tablet Android — 800×1280', w: 800, h: 1280 },
    ],
  },
  {
    group: 'Tỉ lệ chuẩn',
    items: [
      { id: 'r920', label: '9:20 (máy mới, dài) — 360×800', w: 360, h: 800 },
      { id: 'r9195', label: '9:19.5 (phổ biến nhất) — 360×780', w: 360, h: 780 },
      { id: 'r916', label: '9:16 (máy cũ) — 360×640', w: 360, h: 640 },
      { id: 'r34', label: '3:4 — 480×640', w: 480, h: 640 },
      { id: 'r11', label: '1:1 (vuông) — 480×480', w: 480, h: 480 },
      { id: 'g320', label: 'Google 320×480', w: 320, h: 480 },
      { id: 'y300', label: 'Banner 300×250', w: 300, h: 250 },
    ],
  },
];
const DEVICES = DEVICE_GROUPS.flatMap((g) => g.items);

const CUSTOM_ID = 'custom';
const SIDE_MIN = 120;
const SIDE_MAX = 2560;
/** Chuỗi người dùng gõ -> số px hợp lệ; gõ dở / rỗng / sai thì dùng giá trị dự phòng. */
function clampSide(v: string | number, fallback: number): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(SIDE_MAX, Math.max(SIDE_MIN, n));
}

const ZOOMS = [
  { id: 'fit', label: 'Vừa khung' },
  { id: '1', label: '100%' },
  { id: '1.25', label: '125%' },
  { id: '1.5', label: '150%' },
  { id: '2', label: '200%' },
];

interface Props {
  html: string;
  sim: SimKind;
  simLabel: string;
  onSim: (s: SimKind) => void;
  override: string | null;
  onExitOverride: () => void;
  logs: LogEntry[];
  onClearLogs: () => void;
  ctaFlash: number;
  iframeRef: MutableRefObject<HTMLIFrameElement | null>;
}

function load<T>(k: string, d: T): T {
  try {
    const v = localStorage.getItem('pe.' + k);
    return v ? (JSON.parse(v) as T) : d;
  } catch {
    return d;
  }
}
function save(k: string, v: unknown) {
  try {
    localStorage.setItem('pe.' + k, JSON.stringify(v));
  } catch {
    /* ignore */
  }
}

export default function PreviewPanel(p: Props) {
  const [device, setDevice] = useState<string>(() => load('device', 'iphone14'));
  const [landscape, setLandscape] = useState<boolean>(() => load('landscape', false));
  const [auto, setAuto] = useState<boolean>(() => load('auto', true));
  const [zoom, setZoom] = useState<string>(() => load('zoom', 'fit'));
  const [logOpen, setLogOpen] = useState<boolean>(() => load('logOpen', true));
  // Kích thước tự nhập: giữ dạng chuỗi để gõ dở ("36") không bị nhảy về số cũ,
  // chỉ quy ra số khi đủ hợp lệ.
  const [customW, setCustomW] = useState<string>(() => String(load('customW', 360)));
  const [customH, setCustomH] = useState<string>(() => String(load('customH', 640)));
  const [muted, setMuted] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [src, setSrc] = useState('');
  const [frameKey, setFrameKey] = useState(0);
  const [filter, setFilter] = useState<'all' | 'cta' | 'error'>('all');
  const stage = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 400, h: 600 });
  const [flash, setFlash] = useState(false);
  const logEnd = useRef<HTMLDivElement>(null);

  // Dùng ngoặc nhọn: effect KHÔNG được trả về giá trị của hàm bên trong.
  // React coi giá trị trả về là hàm cleanup; nếu nó khác undefined và không phải
  // function thì lần cleanup sau sẽ ném "n is not a function".
  useEffect(() => {
    save('device', device);
  }, [device]);
  useEffect(() => {
    save('landscape', landscape);
  }, [landscape]);
  useEffect(() => {
    save('auto', auto);
  }, [auto]);
  useEffect(() => {
    save('zoom', zoom);
  }, [zoom]);
  useEffect(() => {
    save('logOpen', logOpen);
  }, [logOpen]);
  useEffect(() => {
    save('customW', clampSide(customW, 360));
  }, [customW]);
  useEffect(() => {
    save('customH', clampSide(customH, 640));
  }, [customH]);

  const isCustom = device === CUSTOM_ID;
  const dev = DEVICES.find((d) => d.id === device) ?? DEVICES[0];
  const baseW = isCustom ? clampSide(customW, 360) : dev.w;
  const baseH = isCustom ? clampSide(customH, 640) : dev.h;
  const w = landscape ? baseH : baseW;
  const h = landscape ? baseW : baseH;
  // Rút gọn tỉ lệ để hiện cho dễ đọc: 360×800 -> 9:20.
  const ratio = useMemo(() => {
    const g = (a: number, b: number): number => (b ? g(b, a % b) : a);
    const d = g(Math.round(w), Math.round(h)) || 1;
    let [rw, rh] = [Math.round(w) / d, Math.round(h) / d];
    if (rw > 40 || rh > 40) {
      // tỉ lệ lẻ (vd. 393×873) thì quy về dạng x:1 theo cạnh ngắn cho gọn
      const k = Math.min(rw, rh);
      [rw, rh] = [Math.round((rw / k) * 10) / 10, Math.round((rh / k) * 10) / 10];
    }
    return `${rw}:${rh}`;
  }, [w, h]);

  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth - 24, h: el.clientHeight - 24 }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // "Vừa khung": lấp đầy chỗ trống đang có, phóng to được quá 100% (máy nhỏ như 320×480
  // trên màn hình rộng trước đây bị kẹt ở 100%, để trống rất nhiều chỗ), chặn ở 3× cho khỏi vỡ.
  const fitScale = Math.min(3, box.w / w, box.h / h);
  const scale = zoom === 'fit' ? fitScale : Number(zoom);

  // tạo blob URL cho iframe
  const prev = useRef({ html: '', sim: '', key: -1, muted: false });
  useEffect(() => {
    if (!p.html) return;
    const onlyHtmlChanged = prev.current.sim === p.sim && prev.current.key === reloadKey && prev.current.muted === muted;
    if (!auto && src && onlyHtmlChanged) return;
    prev.current = { html: p.html, sim: p.sim, key: reloadKey, muted };
    let muteCode = '';
    if (muted) muteCode = '<script>(function(){var A=window.AudioContext||window.webkitAudioContext;if(A){var o=A.prototype.resume;A.prototype.resume=function(){return Promise.resolve()};var C=function(){var c=new A();c.suspend();return c};C.prototype=A.prototype;window.AudioContext=window.webkitAudioContext=C}HTMLMediaElement.prototype.play=function(){return Promise.resolve()}})();</script>';
    const prepared = makePreviewHtml(p.html, p.sim, p.simLabel).replace(/<head[^>]*>/i, (m) => m + muteCode);
    setSrc(prepared);
    setFrameKey((k) => k + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.html, p.sim, reloadKey, muted]);

  useEffect(() => {
    if (!p.ctaFlash) return;
    setFlash(true);
    const t = setTimeout(() => setFlash(false), 900);
    return () => clearTimeout(t);
  }, [p.ctaFlash]);

  useEffect(() => {
    logEnd.current?.scrollIntoView({ block: 'nearest' });
  }, [p.logs.length]);

  const shown = useMemo(
    () => p.logs.filter((l) => filter === 'all' || (filter === 'cta' ? l.type === 'cta' : l.type === 'error')),
    [p.logs, filter],
  );
  const ctaCount = p.logs.filter((l) => l.type === 'cta').length;
  const errCount = p.logs.filter((l) => l.type === 'error').length;

  return (
    <section className="right">
      <div className="pv-bar">
        <select value={device} onChange={(e) => setDevice(e.target.value)} aria-label="Thiết bị">
          {DEVICE_GROUPS.map((g) => (
            <optgroup key={g.group} label={g.group}>
              {g.items.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
            </optgroup>
          ))}
          <optgroup label="Tự nhập">
            <option value={CUSTOM_ID}>Tự nhập kích thước / tỉ lệ…</option>
          </optgroup>
        </select>
        {isCustom && (
          <span className="custom-size" title={`Nhập kích thước (px) hoặc tỉ lệ bất kỳ, vd. 9 × 19.5. Giới hạn ${SIDE_MIN}–${SIDE_MAX}px.`}>
            <input
              type="number"
              value={customW}
              min={SIDE_MIN}
              max={SIDE_MAX}
              onChange={(e) => setCustomW(e.target.value)}
              aria-label="Chiều rộng"
            />
            <b>×</b>
            <input
              type="number"
              value={customH}
              min={SIDE_MIN}
              max={SIDE_MAX}
              onChange={(e) => setCustomH(e.target.value)}
              aria-label="Chiều cao"
            />
            <button
              className="btn small dark"
              title="Đổi chỗ 2 số cho nhau"
              onClick={() => {
                setCustomW(customH);
                setCustomH(customW);
              }}
            >
              ⇄
            </button>
          </span>
        )}
        <button className="btn small dark" onClick={() => setLandscape((v) => !v)} title="Xoay màn hình">{landscape ? 'Ngang' : 'Dọc'}</button>
        <select value={zoom} onChange={(e) => setZoom(e.target.value)} aria-label="Phóng to khung xem" title="Mức phóng khung chơi thử">
          {ZOOMS.map((z) => <option key={z.id} value={z.id}>{z.label}</option>)}
        </select>
        <select value={p.sim} onChange={(e) => p.onSim(e.target.value as SimKind)} disabled={!!p.override} aria-label="Giả lập network">
          {SIM_OPTIONS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <span className="spacer" />
        <label className="check dark"><input type="checkbox" checked={muted} onChange={(e) => setMuted(e.target.checked)} /> Tắt tiếng</label>
        <label className="check dark" title="Tự tải lại khi thay tài nguyên"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Tự tải lại</label>
        <button className="btn small primary" onClick={() => setReloadKey((k) => k + 1)}>Chơi lại</button>
      </div>

      {p.override && (
        <div className="pv-override">
          Đang chơi thử bản build <b>{p.override}</b>
          <button className="btn small dark" onClick={p.onExitOverride}>Quay lại bản đang sửa</button>
        </div>
      )}

      <div className={`stage ${flash ? 'flash' : ''}`} ref={stage}>
        <div className="device" style={{ width: w * scale, height: h * scale }}>
          {src && (
            <iframe
              key={frameKey}
              ref={p.iframeRef}
              title="preview"
              srcDoc={src}
              style={{ width: w, height: h, transform: `scale(${scale})` }}
              allow="autoplay; fullscreen"
            />
          )}
        </div>
        <div className="dims">
          {w}×{h} ({ratio})
          {scale < 0.995 ? `, thu nhỏ ${Math.round(scale * 100)}%` : scale > 1.005 ? `, phóng to ${Math.round(scale * 100)}%` : ''}
        </div>
        {flash && <div className="cta-pop">CTA</div>}
      </div>

      <div className={`console ${logOpen ? '' : 'closed'}`}>
        <div className="console-bar">
          <button className={filter === 'all' ? 'seg on' : 'seg'} onClick={() => setFilter('all')}>Tất cả</button>
          <button className={filter === 'cta' ? 'seg on' : 'seg'} onClick={() => setFilter('cta')}>CTA {ctaCount > 0 && <b>{ctaCount}</b>}</button>
          <button className={filter === 'error' ? 'seg on' : 'seg'} onClick={() => setFilter('error')}>Lỗi {errCount > 0 && <b className="e">{errCount}</b>}</button>
          <span className="spacer" />
          <button
            className="btn small dark"
            onClick={() => setLogOpen((v) => !v)}
            title={logOpen ? 'Thu gọn khung log để khung chơi thử cao hơn' : 'Mở lại khung log'}
          >
            {logOpen ? 'Thu gọn log' : 'Mở log'}
          </button>
          <button className="btn small dark" onClick={p.onClearLogs}>Xoá log</button>
        </div>
        <div className="console-body">
          {shown.length === 0 && <div className="log empty-log">Bấm nút tải / cài đặt trong game để kiểm tra CTA của network.</div>}
          {shown.map((l) => (
            <div key={l.id} className={`log ${l.type}`}>
              <time>{l.time.toLocaleTimeString('vi-VN', { hour12: false })}</time>
              <span>{l.type === 'cta' ? 'CTA: ' + l.msg : l.msg}</span>
            </div>
          ))}
          <div ref={logEnd} />
        </div>
      </div>
    </section>
  );
}
