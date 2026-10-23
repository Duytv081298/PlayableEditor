import { useEffect, useMemo, useRef, useState } from 'react';
import type { Asset } from '../lib/project';
import { decodeFbxColor, rgbToHex } from '../lib/project';
import { FIT_LABELS, FitMode, audioDuration, baseName, downloadBlob } from '../lib/media';
import { extFromMime, formatBytes } from '../lib/binary';

interface Props {
  kind: 'image' | 'audio' | 'model' | 'other';
  assets: Asset[];
  allAssets: Asset[];
  rev: number;
  fit: FitMode;
  onFit: (f: FitMode) => void;
  onReplace: (a: Asset, f: File) => void;
  onReplaceColor: (a: Asset, hex: string) => void;
  onRevert: (a: Asset) => void;
  onReplaceByName: (files: File[]) => void;
  onExport: () => void;
}

type Sort = 'order' | 'size' | 'name';

export default function AssetPanel(p: Props) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<Sort>('order');
  const [onlyChanged, setOnlyChanged] = useState(false);
  const [previewId, setPreviewId] = useState<number | null>(null);
  const multi = useRef<HTMLInputElement>(null);

  // gộp các bản trùng nội dung thành 1 thẻ
  const groups = useMemo(() => {
    const map = new Map<string, Asset[]>();
    for (const a of p.assets) {
      const g = map.get(a.dupKey);
      if (g) g.push(a);
      else map.set(a.dupKey, [a]);
    }
    let list = [...map.values()];
    const s = q.trim().toLowerCase();
    if (s) list = list.filter((g) => g.some((a) => a.name.toLowerCase().includes(s)));
    if (onlyChanged) list = list.filter((g) => g[0].replacement);
    if (sort === 'size') list.sort((a, b) => b[0].size - a[0].size);
    if (sort === 'name') list.sort((a, b) => baseName(a[0].name).localeCompare(baseName(b[0].name)));
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.assets, q, sort, onlyChanged, p.rev]);

  const imageGroups = useMemo(() => {
    return groups.filter((g) => g[0].kind === 'image');
  }, [groups]);

  const activeGroup = useMemo(() => {
    if (previewId == null) return null;
    return imageGroups.find((g) => g.some((a) => a.id === previewId)) ?? null;
  }, [imageGroups, previewId]);

  const activeIdx = activeGroup ? imageGroups.indexOf(activeGroup) : -1;
  const currentAsset = activeGroup ? (p.assets.find((a) => a.id === activeGroup[0].id) ?? activeGroup[0]) : null;

  const total = p.assets.reduce((s, a) => s + (a.replacement?.bytes.length ?? a.size), 0);
  const accept = p.kind === 'image' ? 'image/*' : p.kind === 'audio' ? 'audio/*' : p.kind === 'model' ? '.glb' : '*/*';

  return (
    <div className="assets">
      <div className="toolbar">
        <input className="search" placeholder="Tìm theo tên / đường dẫn" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sắp xếp">
          <option value="order">Theo thứ tự trong file</option>
          <option value="size">Dung lượng lớn trước</option>
          <option value="name">Theo tên</option>
        </select>
        <label className="check">
          <input type="checkbox" checked={onlyChanged} onChange={(e) => setOnlyChanged(e.target.checked)} /> Chỉ mục đã thay
        </label>
      </div>
      <div className="toolbar sub">
        {p.kind === 'image' && (
          <label className="fit">
            Ảnh khác kích thước:
            <select value={p.fit} onChange={(e) => p.onFit(e.target.value as FitMode)}>
              {Object.entries(FIT_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </label>
        )}
        <span className="spacer" />
        <span className="muted">{groups.length} mục, {formatBytes(total)}</span>
        <button className="btn small" onClick={() => multi.current?.click()} title="Chọn nhiều file, tự khớp theo tên với tài nguyên">Thay hàng loạt theo tên</button>
        <button className="btn small" onClick={p.onExport}>Tải toàn bộ tài nguyên</button>
        <input ref={multi} type="file" multiple hidden onChange={(e) => { if (e.target.files?.length) p.onReplaceByName([...e.target.files]); e.target.value = ''; }} />
      </div>

      {groups.length === 0 ? (
        <div className="none">
          {p.assets.length === 0
            ? p.kind === 'audio'
              ? 'Không tìm thấy âm thanh nhúng trong file. Có thể game tải âm thanh từ ngoài hoặc dùng định dạng nén riêng.'
              : p.kind === 'model'
                ? 'Không tìm thấy model 3D nhúng trong file (.glb). Game có thể tải model từ ngoài, dùng định dạng khác (FBX rời, Unity AssetBundle...) mà tool chưa tách được vật liệu riêng.'
                : 'Không có tài nguyên loại này trong file.'
            : 'Không có mục nào khớp bộ lọc.'}
        </div>
      ) : (
        <div className={p.kind === 'audio' ? 'list' : 'grid'}>
          {groups.map((g) => (
            <AssetCard
              key={g[0].id}
              group={g}
              accept={accept}
              rev={p.rev}
              onPreview={(a) => setPreviewId(a.id)}
              onReplace={p.onReplace}
              onReplaceColor={p.onReplaceColor}
              onRevert={p.onRevert}
            />
          ))}
        </div>
      )}

      {currentAsset && (
        <ImagePreviewModal
          asset={currentAsset}
          index={activeIdx}
          total={imageGroups.length}
          accept={accept}
          onClose={() => setPreviewId(null)}
          onPrev={() => activeIdx > 0 && setPreviewId(imageGroups[activeIdx - 1][0].id)}
          onNext={() => activeIdx < imageGroups.length - 1 && setPreviewId(imageGroups[activeIdx + 1][0].id)}
          hasPrev={activeIdx > 0}
          hasNext={activeIdx >= 0 && activeIdx < imageGroups.length - 1}
          onReplace={p.onReplace}
          onRevert={p.onRevert}
        />
      )}
    </div>
  );
}

function thumbStyle(w?: number, h?: number): React.CSSProperties | undefined {
  if (!w || !h) return undefined;
  const k = Math.min(150 / w, 120 / h);
  if (k <= 1) return undefined;
  return { width: Math.round(w * Math.min(k, 8)), height: 'auto', imageRendering: w <= 64 ? 'pixelated' : 'auto' };
}

function useObjectUrl(bytes: Uint8Array, mime: string) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const u = URL.createObjectURL(new Blob([bytes], { type: mime }));
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [bytes, mime]);
  return url;
}

function AssetCard({ group, accept, rev, onPreview, onReplace, onReplaceColor, onRevert }: {
  group: Asset[]; accept: string; rev: number;
  onPreview: (a: Asset) => void;
  onReplace: (a: Asset, f: File) => void; onReplaceColor: (a: Asset, hex: string) => void; onRevert: (a: Asset) => void;
}) {
  const a = group[0];
  const cur = a.replacement ?? a.original;
  const isColor = a.kind === 'color';
  const url = useObjectUrl(isColor ? new Uint8Array() : cur.bytes, cur.mime);
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [dur, setDur] = useState<[number, number] | null>(null);
  const hex = isColor ? rgbToHex(...decodeFbxColor(cur.bytes)) : '';

  useEffect(() => {
    if (a.kind !== 'audio') return;
    Promise.all([audioDuration(a.original.bytes, a.original.mime), a.replacement ? audioDuration(a.replacement.bytes, a.replacement.mime) : Promise.resolve(NaN)]).then((d) => setDur(d as [number, number]));
  }, [a, rev]);

  const name = baseName(a.name);
  const sizeNow = cur.bytes.length;
  const delta = a.replacement ? sizeNow - a.size : 0;
  const repDims = a.replacement?.width ? `${a.replacement.width}×${a.replacement.height}` : null;
  const origDims = a.width ? `${a.width}×${a.height}` : null;
  // ảnh vật liệu tách từ model .glb/.fbx luôn là file ảnh, không phải .glb/.fbx của panel cha
  const cardAccept = a.glbParent || a.fbxContentRef ? 'image/*' : accept;

  const drop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setOver(false);
    const f = e.dataTransfer.files[0];
    if (f) onReplace(a, f);
  };

  const download = () => {
    const ext = /\.[a-z0-9]{2,5}$/i.test(name) ? '' : '.' + extFromMime(cur.mime);
    downloadBlob(new Blob([cur.bytes], { type: cur.mime }), name + ext);
  };

  return (
    <article
      className={`card ${a.kind} ${a.replacement ? 'replaced' : ''} ${over ? 'over' : ''}`}
      onDragOver={(e) => { if (!isColor) { e.preventDefault(); setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={isColor ? undefined : drop}
    >
      {isColor ? (
        <label className="thumb" title="Bấm để chọn màu mới" style={{ background: hex }}>
          <input type="color" value={hex} onChange={(e) => onReplaceColor(a, e.target.value)} style={{ opacity: 0, width: '100%', height: '100%', cursor: 'pointer' }} />
        </label>
      ) : a.kind === 'image' ? (
        <button className="thumb" onClick={() => onPreview(a)} title="Bấm để xem trực tiếp ảnh (hoặc kéo thả file để thay)">
          {url && <img src={url} alt={name} style={thumbStyle(a.replacement?.width ?? a.width, a.replacement?.height ?? a.height)} />}
        </button>
      ) : a.kind === 'audio' ? (
        url && <audio controls src={url} preload="none" />
      ) : a.kind === 'video' ? (
        url && <video className="thumb-video" src={url} controls muted preload="metadata" />
      ) : a.kind === 'model' ? (
        <div className="thumb font">{a.glb ? `.glb — ${a.glb.images.length} vật liệu` : a.fbx ? `.fbx — ${a.fbx.colors.length} màu, ${a.fbx.textures.length} texture` : a.mime}</div>
      ) : (
        <div className="thumb font">{a.mime}</div>
      )}
      <div className="meta">
        <div className="name" title={a.name}>
          {a.glbParent && <span className="pill" title="Ảnh vật liệu nằm trong model 3D">vật liệu</span>}
          {a.fbxColorRef && <span className="pill" title="Màu vật liệu nằm trong model .fbx">màu</span>}
          {a.fbxContentRef && <span className="pill" title="Texture nhúng trong model .fbx">texture</span>}
          {name}
        </div>
        <div className="sub">
          {isColor && <span>{hex}</span>}
          {origDims && <span>{repDims && repDims !== origDims ? `${origDims} → ${repDims}` : origDims}</span>}
          {dur && !isNaN(dur[0]) && <span>{dur[0].toFixed(1)}s{!isNaN(dur[1]) ? ` → ${dur[1].toFixed(1)}s` : ''}</span>}
          {!isColor && <span>{formatBytes(sizeNow)}{delta !== 0 && <em className={delta > 0 ? 'up' : 'down'}> {delta > 0 ? '+' : '−'}{formatBytes(Math.abs(delta))}</em>}</span>}
          {!isColor && <span>{cur.mime.split('/')[1]}</span>}
          {group.length > 1 && <span title="Nội dung trùng ở nhiều chỗ, thay một lần áp dụng cho tất cả">×{group.length}</span>}
        </div>
        {a.replacement && !isColor && <div className="from" title={a.replacement.fileName}>từ {a.replacement.fileName}</div>}
        <div className="row">
          {isColor ? (
            <span className="muted" style={{ fontSize: 12 }}>Bấm vào ô màu bên trên để đổi</span>
          ) : (
            <button className="btn small primary" onClick={() => input.current?.click()}>Thay</button>
          )}
          <button
            className="btn small"
            onClick={() => onRevert(a)}
            disabled={!a.replacement}
            title={a.replacement ? 'Bỏ thứ vừa thay, trả lại đúng tài nguyên gốc ban đầu trong file' : 'Chưa thay gì — đang là bản gốc'}
          >
            Gốc
          </button>
          {!isColor && <button className="btn small ghost" onClick={download}>Tải</button>}
        </div>
      </div>
      {!isColor && (
        <input ref={input} type="file" accept={cardAccept} hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onReplace(a, f); e.target.value = ''; }} />
      )}
    </article>
  );
}

function ImagePreviewModal({
  asset,
  index,
  total,
  accept,
  onClose,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
  onReplace,
  onRevert,
}: {
  asset: Asset;
  index: number;
  total: number;
  accept: string;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
  onReplace: (a: Asset, f: File) => void;
  onRevert: (a: Asset) => void;
}) {
  const cur = asset.replacement ?? asset.original;
  const url = useObjectUrl(cur.bytes, cur.mime);
  const fileInput = useRef<HTMLInputElement>(null);
  const name = baseName(asset.name);
  const sizeNow = cur.bytes.length;
  const delta = asset.replacement ? sizeNow - asset.size : 0;
  const repDims = asset.replacement?.width ? `${asset.replacement.width}×${asset.replacement.height}` : null;
  const origDims = asset.width ? `${asset.width}×${asset.height}` : null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft' && hasPrev && onPrev) onPrev();
      else if (e.key === 'ArrowRight' && hasNext && onNext) onNext();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hasPrev, hasNext, onPrev, onNext, onClose]);

  const download = () => {
    const ext = /\.[a-z0-9]{2,5}$/i.test(name) ? '' : '.' + extFromMime(cur.mime);
    downloadBlob(new Blob([cur.bytes], { type: cur.mime }), name + ext);
  };

  const cardAccept = asset.glbParent || asset.fbxContentRef ? 'image/*' : accept;

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal image-modal" role="dialog" aria-modal="true">
        <div className="image-modal-header">
          <div className="image-modal-title" title={asset.name}>
            {asset.glbParent && <span className="pill">vật liệu</span>}
            {asset.fbxContentRef && <span className="pill">texture</span>}
            <span>{name}</span>
            {total > 1 && <span className="muted" style={{ fontSize: 12, fontWeight: 'normal' }}>({index + 1} / {total})</span>}
          </div>
          <button className="image-modal-close" onClick={onClose} title="Đóng (Esc)">✕</button>
        </div>

        <div className="image-modal-stage">
          {hasPrev && onPrev && (
            <button className="image-modal-nav prev" onClick={onPrev} title="Ảnh trước (Mũi tên trái)">‹</button>
          )}
          {url && <img src={url} alt={name} />}
          {hasNext && onNext && (
            <button className="image-modal-nav next" onClick={onNext} title="Ảnh tiếp theo (Mũi tên phải)">›</button>
          )}
        </div>

        <div className="image-modal-meta">
          {origDims && (
            <span>Kích thước: <strong>{repDims && repDims !== origDims ? `${origDims} → ${repDims}` : origDims} px</strong></span>
          )}
          <span>Dung lượng: <strong>{formatBytes(sizeNow)}</strong>{delta !== 0 && <em className={delta > 0 ? 'up' : 'down'}> ({delta > 0 ? '+' : '−'}{formatBytes(Math.abs(delta))})</em>}</span>
          <span>Định dạng: <strong>{cur.mime}</strong></span>
          {asset.replacement && (
            <span className="from">Đã thay từ: <strong>{asset.replacement.fileName}</strong></span>
          )}
        </div>

        <div className="image-modal-actions">
          <button className="btn primary" onClick={() => fileInput.current?.click()}>Thay ảnh này</button>
          <button
            className="btn"
            onClick={() => onRevert(asset)}
            disabled={!asset.replacement}
            title={asset.replacement ? 'Khôi phục ảnh gốc ban đầu' : 'Đang là ảnh gốc'}
          >
            Khôi phục gốc
          </button>
          <button className="btn ghost" onClick={download}>Tải ảnh về</button>
          <span className="spacer" />
          <button className="btn" onClick={onClose}>Đóng</button>
          <input
            ref={fileInput}
            type="file"
            accept={cardAccept}
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onReplace(asset, f);
              e.target.value = '';
            }}
          />
        </div>
      </div>
    </div>
  );
}
