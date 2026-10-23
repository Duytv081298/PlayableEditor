import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import JSZip from 'jszip';
import { Asset, Project, buildFbxColorReplacement, parsePlayable, readInputFile, serializeProject, syncFbxAssets, syncGlbAssets } from './lib/project';
import { SimKind, guessSim, SIM_OPTIONS } from './lib/channels';
import { PREVIEW_MSG } from './lib/preview';
import { FitMode, baseName, downloadBlob, prepareReplacement } from './lib/media';
import { extFromMime, formatBytes, utf8Size } from './lib/binary';
import AssetPanel from './components/AssetPanel';
import PreviewPanel, { LogEntry } from './components/PreviewPanel';
import BuildPanel from './components/BuildPanel';
import StoreModal from './components/StoreModal';
import { detectStoreUrls, applyStoreUrlsToHtml, StoreUrls } from './lib/storeUrls';
import demoHtml from '../samples/demo_playable.html?raw';

type Tab = 'image' | 'audio' | 'model' | 'other' | 'build';

// asset con tách ra từ 1 model (ảnh vật liệu .glb, màu/texture .fbx) — luôn gộp vào tab "Mô hình 3D"
const isModelChild = (a: Asset) => !!a.glbParent || !!a.fbxColorRef || !!a.fbxContentRef;

function syncModelAssets(assets: Asset[]): void {
  syncGlbAssets(assets);
  syncFbxAssets(assets);
}

export interface PreviewOverride {
  html: string;
  sim: SimKind;
  label: string;
}

export default function App() {
  const [project, setProject] = useState<Project | null>(null);
  const [extras, setExtras] = useState<Record<string, Uint8Array>>({});
  const [rev, setRev] = useState(0);
  const [html, setHtml] = useState('');
  const [tab, setTab] = useState<Tab>('image');
  const [sim, setSim] = useState<SimKind>('none');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [ctaFlash, setCtaFlash] = useState(0);
  const [fit, setFit] = useState<FitMode>('contain');
  const [override, setOverride] = useState<PreviewOverride | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [storeModalOpen, setStoreModalOpen] = useState(false);
  const [storeUrls, setStoreUrls] = useState<StoreUrls>(() => {
    try {
      return { googlePlayUrl: '', appStoreUrl: '', ...JSON.parse(localStorage.getItem('pe.storeUrls') || '{}') };
    } catch {
      return { googlePlayUrl: '', appStoreUrl: '' };
    }
  });
  const [originalStoreUrls, setOriginalStoreUrls] = useState<StoreUrls>({ googlePlayUrl: '', appStoreUrl: '' });
  const fileInput = useRef<HTMLInputElement>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  // Gom log đến dồn dập thành 1 lần setState duy nhất, chạy ở macrotask tiếp theo
  // (setTimeout 0) — đảm bảo React commit xong trước khi cập nhật state.
  const logQueue = useRef<LogEntry[]>([]);
  const ctaQueue = useRef(0);
  const flushing = useRef(false);
  const pushLog = useCallback((type: LogEntry['type'], msg: string) => {
    logQueue.current.push({ id: Date.now() + Math.random(), type, msg, time: new Date() });
    if (type === 'cta') ctaQueue.current++;
    if (flushing.current) return;
    flushing.current = true;
    setTimeout(() => {
      const batch = logQueue.current;
      const ctas = ctaQueue.current;
      logQueue.current = [];
      ctaQueue.current = 0;
      flushing.current = false;
      setLogs((l) => [...l, ...batch].slice(-300));
      if (ctas) setCtaFlash((n) => n + ctas);
    }, 0);
  }, []);

  useEffect(() => {
    // Chỉ nhận message từ iframe đang hiển thị: iframe cũ (bản chơi thử trước, bị gỡ khỏi DOM
    // nhưng game loop bên trong có thể vẫn chạy thêm một nhịp) không được phép ghi đè log hiện tại.
    const onMsg = (e: MessageEvent) => {
      if (e.source !== iframeRef.current?.contentWindow) return;
      const d = e.data;
      if (d && typeof d === 'object' && d[PREVIEW_MSG]) pushLog(d.type, String(d.msg));
      else if (d === 'download') pushLog('cta', 'parent.postMessage("download") (Vungle)');
      else if (d === 'complete') pushLog('sim', 'parent.postMessage("complete") (Vungle)');
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [pushLog]);

  // ghi lại HTML mỗi khi có thay đổi (kèm áp dụng link store mới)
  useEffect(() => {
    if (!project) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      let out = await serializeProject(project);
      if (storeUrls.googlePlayUrl || storeUrls.appStoreUrl) {
        out = await applyStoreUrlsToHtml(out, storeUrls, originalStoreUrls);
      }
      if (!cancelled) setHtml(out);
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [project, rev, storeUrls, originalStoreUrls]);

  const handleSaveStoreUrls = (urls: StoreUrls) => {
    setStoreUrls(urls);
    try {
      localStorage.setItem('pe.storeUrls', JSON.stringify(urls));
    } catch {
      /* ignore */
    }
    setNotice('Đã cập nhật link store vào file.');
  };

  const openFile = async (file: File) => {
    setError('');
    setBusy('Đang phân tích ' + file.name + '…');
    try {
      const input = await readInputFile(file);
      const p = await parsePlayable(input.html, input.fileName);

      // Tự động dò tìm link Store có sẵn trong file (kể cả bên trong window.__zip)
      const detected = await detectStoreUrls(input.html);
      setOriginalStoreUrls(detected.urls);

      let initialUrls = detected.urls;
      if (!initialUrls.googlePlayUrl && !initialUrls.appStoreUrl) {
        try {
          const saved = JSON.parse(localStorage.getItem('pe.storeUrls') || '{}');
          if (saved.googlePlayUrl || saved.appStoreUrl) {
            initialUrls = {
              googlePlayUrl: saved.googlePlayUrl || '',
              appStoreUrl: saved.appStoreUrl || '',
            };
          }
        } catch {
          /* ignore */
        }
      }
      setStoreUrls(initialUrls);

      setProject(p);
      setExtras(input.extras);
      setHtml(input.html);
      setSim(guessSim(input.html, p.info.superHtmlChannel));
      setOverride(null);
      setLogs([]);
      setTab(
        p.assets.some((a) => a.kind === 'image' && !isModelChild(a)) ? 'image'
        : p.assets.some((a) => a.kind === 'audio') ? 'audio'
        : p.assets.some((a) => a.kind === 'model') ? 'model'
        : 'build',
      );
      setRev((r) => r + 1);
    } catch (e) {
      setError(`Không đọc được ${file.name}: ${(e as Error).message}`);
    } finally {
      setBusy('');
    }
  };

  const replaceAsset = async (asset: Asset, file: File) => {
    if (!project) return;
    try {
      const { rep, note } = await prepareReplacement(asset, file, fit);
      const group = project.assets.filter((a) => a.dupKey === asset.dupKey);
      group.forEach((a) => (a.replacement = rep));
      syncModelAssets(project.assets);
      setRev((r) => r + 1);
      setOverride(null);
      const dup = group.length > 1 ? ` (áp dụng cho ${group.length} bản trùng)` : '';
      setNotice(`Đã thay ${baseName(asset.name)}${dup}.${note ? ' ' + note : ''}`);
    } catch (e) {
      setError(`Không thay được ${baseName(asset.name)}: ${(e as Error).message}`);
    }
  };

  const replaceColor = (asset: Asset, hex: string) => {
    if (!project) return;
    const rep = buildFbxColorReplacement(asset, hex);
    project.assets.filter((a) => a.dupKey === asset.dupKey).forEach((a) => (a.replacement = rep));
    syncModelAssets(project.assets);
    setRev((r) => r + 1);
    setOverride(null);
    setNotice(`Đã đổi màu ${baseName(asset.name)} → ${hex}.`);
  };

  const revertAsset = (asset: Asset) => {
    if (!project) return;
    project.assets.filter((a) => a.dupKey === asset.dupKey).forEach((a) => (a.replacement = undefined));
    syncModelAssets(project.assets);
    setRev((r) => r + 1);
    setOverride(null);
  };

  const revertAll = () => {
    project?.assets.forEach((a) => (a.replacement = undefined));
    if (project) syncModelAssets(project.assets);
    setRev((r) => r + 1);
    setOverride(null);
  };

  const replaceByName = async (files: File[]) => {
    if (!project) return;
    const stem = (s: string) => baseName(s).replace(/\.[^.]+$/, '').toLowerCase();
    let hit = 0;
    const miss: string[] = [];
    for (const f of files) {
      const target = project.assets.find((a) => stem(a.name) === stem(f.name));
      if (target) {
        const { rep } = await prepareReplacement(target, f, fit);
        project.assets.filter((a) => a.dupKey === target.dupKey).forEach((a) => (a.replacement = rep));
        hit++;
      } else miss.push(f.name);
    }
    syncModelAssets(project.assets);
    setRev((r) => r + 1);
    setOverride(null);
    setNotice(`Đã thay ${hit}/${files.length} file theo tên.${miss.length ? ' Không khớp: ' + miss.slice(0, 6).join(', ') : ''}`);
  };

  const exportAssets = async () => {
    if (!project) return;
    const zip = new JSZip();
    const used = new Set<string>();
    for (const a of project.assets) {
      const d = a.replacement ?? a.original;
      let name = a.name.replace(/^[/\\]+/, '').replace(/[:*?"<>|]/g, '_');
      if (!/\.[a-z0-9]{2,5}$/i.test(name)) name += '.' + extFromMime(d.mime);
      while (used.has(name)) name = name.replace(/(\.[^.]+)$/, '_' + a.id + '$1');
      used.add(name);
      zip.file(name, d.bytes);
    }
    downloadBlob(await zip.generateAsync({ type: 'blob' }), project.fileName.replace(/\.html?$/i, '') + '_assets.zip');
  };

  const downloadHtml = async () => {
    if (!project) return;
    const out = await serializeProject(project);
    downloadBlob(new Blob([out], { type: 'text/html' }), project.fileName.replace(/\.html?$/i, '') + '_edited.html');
  };

  const counts = useMemo(() => {
    const c = { image: 0, audio: 0, model: 0, other: 0, changed: 0 };
    project?.assets.forEach((a) => {
      // ảnh vật liệu tách từ model: tính trong "Mô hình 3D", không gộp vào "Hình ảnh"
      if (isModelChild(a)) {
        if (a.replacement) c.changed++;
        return;
      }
      if (a.kind === 'image') c.image++;
      else if (a.kind === 'audio') c.audio++;
      else if (a.kind === 'model') c.model++;
      else c.other++;
      if (a.replacement) c.changed++;
    });
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, rev]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(''), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  const loadDemo = () => openFile(new File([demoHtml], 'demo_playable.html', { type: 'text/html' }));

  useEffect(() => {
    if (import.meta.env.VITE_AUTODEMO === '1') loadDemo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onDropRoot = (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f && /\.(html?|zip)$/i.test(f.name)) openFile(f);
  };

  if (!project) {
    return (
      <div className="empty" onDragOver={(e) => e.preventDefault()} onDrop={onDropRoot}>
        <div className="empty-card">
          <h1>Playable Editor</h1>
          <p>Mở một file playable <b>.html</b> (hoặc gói <b>.zip</b> đã build) để xem và thay hình ảnh, âm thanh, chơi thử ngay, rồi build ra từng network.</p>
          <button className="btn primary big" onClick={() => fileInput.current?.click()} disabled={!!busy}>
            {busy || 'Chọn file playable'}
          </button>
          <p className="hint">hoặc kéo thả file vào đây</p>
          <button className="btn" onClick={loadDemo} disabled={!!busy}>Thử với game mẫu</button>
          {error && <p className="err">{error}</p>}
          <input ref={fileInput} type="file" accept=".html,.htm,.zip" hidden onChange={(e) => e.target.files?.[0] && openFile(e.target.files[0])} />
        </div>
      </div>
    );
  }

  const info = project.info;
  const hasGp = !!storeUrls.googlePlayUrl.trim();
  const hasAs = !!storeUrls.appStoreUrl.trim();
  const storeBadgeText =
    hasGp && hasAs ? 'Link Store: Android + iOS'
    : hasGp ? 'Link Store: Android'
    : hasAs ? 'Link Store: iOS'
    : 'Chưa có Link Store';

  return (
    <div className="app" onDragOver={(e) => e.preventDefault()} onDrop={(e) => e.target === e.currentTarget && onDropRoot(e)}>
      <header className="top">
        <div className="file">
          <strong title={project.fileName}>{project.fileName}</strong>
          <span className="facts">
            <span>{formatBytes(utf8Size(html || project.originalHtml))}</span>
            <span>{info.engine === 'Không rõ' ? 'Engine không rõ' : info.engine}</span>
            <span>{info.superHtmlChannel ? `super-html: ${info.superHtmlChannel}` : 'HTML thường'}</span>
            {info.hasResZip && <span>tài nguyên nén</span>}
            {info.hasAdapterZip && <span>playable-adapter (pako)</span>}
            {counts.changed > 0 && <span className="changed">{counts.changed} đã thay</span>}
            <span
              className={`facts-store ${hasGp || hasAs ? 'active' : ''}`}
              onClick={() => setStoreModalOpen(true)}
              title="Bấm để xem và sửa link store"
            >
              🔗 {storeBadgeText}
            </span>
          </span>
        </div>
        <div className="actions">
          <button className="btn" onClick={() => fileInput.current?.click()}>Mở file khác</button>
          <button className="btn" onClick={() => setStoreModalOpen(true)} title="Chỉnh sửa link Google Play & App Store">
            🔗 Sửa link Store
          </button>
          {project.fileName !== 'demo_playable.html' || <span className="muted demo-tag">Đang dùng game mẫu</span>}
          {counts.changed > 0 && (
            <button className="btn" onClick={revertAll} title="Bỏ hết mọi thứ đã thay, trả cả file về đúng tài nguyên gốc ban đầu">
              Reset tất cả về gốc ({counts.changed})
            </button>
          )}
          <button className="btn primary" onClick={downloadHtml}>Tải HTML đã sửa</button>
          <input ref={fileInput} type="file" accept=".html,.htm,.zip" hidden onChange={(e) => e.target.files?.[0] && openFile(e.target.files[0])} />
        </div>
      </header>

      <main className="main">
        <section className="left">
          <nav className="tabs" role="tablist">
            {([
              ['image', `Hình ảnh`, counts.image],
              ['audio', `Âm thanh`, counts.audio],
              ['model', `Mô hình 3D`, counts.model],
              ['other', `Khác`, counts.other],
              ['build', `Build network`, null],
            ] as Array<[Tab, string, number | null]>).map(([id, label, n]) => (
              <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'tab on' : 'tab'} onClick={() => setTab(id)}>
                {label}
                {n != null && <span className="count">{n}</span>}
              </button>
            ))}
          </nav>
          {(notice || error) && (
            <div className={error ? 'banner err' : 'banner'} onClick={() => { setNotice(''); setError(''); }}>
              {error || notice}
            </div>
          )}
          {tab === 'build' ? (
            <BuildPanel
              project={project}
              html={html}
              extras={extras}
              storeUrls={storeUrls}
              onStoreUrlsChange={handleSaveStoreUrls}
              onPlay={(o) => { setOverride(o); setLogs([]); }}
            />
          ) : (
            <AssetPanel
              key={tab}
              kind={tab}
              assets={project.assets.filter((a) => {
                if (tab === 'model') return a.kind === 'model' || isModelChild(a);
                if (tab === 'other') return a.kind !== 'image' && a.kind !== 'audio' && a.kind !== 'model' && !isModelChild(a);
                return a.kind === tab && !isModelChild(a);
              })}
              allAssets={project.assets}
              rev={rev}
              fit={fit}
              onFit={setFit}
              onReplace={replaceAsset}
              onReplaceColor={replaceColor}
              onRevert={revertAsset}
              onReplaceByName={replaceByName}
              onExport={exportAssets}
            />
          )}
        </section>

        <PreviewPanel
          html={override?.html ?? html}
          sim={override?.sim ?? sim}
          simLabel={override ? override.label : SIM_OPTIONS.find((s) => s.id === sim)!.label}
          onSim={(s) => { setSim(s); setOverride(null); }}
          override={override?.label ?? null}
          onExitOverride={() => setOverride(null)}
          logs={logs}
          onClearLogs={() => setLogs([])}
          ctaFlash={ctaFlash}
          iframeRef={iframeRef}
        />
      </main>

      <StoreModal
        open={storeModalOpen}
        storeUrls={storeUrls}
        originalUrls={originalStoreUrls}
        onSave={handleSaveStoreUrls}
        onClose={() => setStoreModalOpen(false)}
      />
    </div>
  );
}
