import { useEffect, useMemo, useState } from 'react';
import type { Project } from '../lib/project';
import { VARIANTS, Variant } from '../lib/channels';
import { BuildOptions, BuildResult, buildVariant, resultToHtml, zipAll } from '../lib/builder';
import type { StoreUrls } from '../lib/storeUrls';
import { formatBytes } from '../lib/binary';
import { downloadBlob } from '../lib/media';
import type { PreviewOverride } from '../App';

interface Props {
  project: Project;
  html: string;
  extras: Record<string, Uint8Array>;
  storeUrls: StoreUrls;
  onStoreUrlsChange: (urls: StoreUrls) => void;
  onPlay: (o: PreviewOverride) => void;
}

interface Saved {
  title: string;
  autoGameReady: boolean;
  routeWindowOpen: boolean;
  crossShims: boolean;
  selected: string[];
}

const DEFAULTS: Saved = {
  title: '',
  autoGameReady: true,
  routeWindowOpen: true,
  crossShims: true,
  selected: ['applovin', 'ironsource2025', 'unity', 'mintegral', 'google', 'facebook', 'tiktok', 'vungle'],
};

function loadSaved(): Saved {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('pe.build') || '{}') };
  } catch {
    return DEFAULTS;
  }
}

export default function BuildPanel({ project, html, extras, storeUrls, onStoreUrlsChange, onPlay }: Props) {
  const [s, setS] = useState<Saved>(loadSaved);
  const [thumb, setThumb] = useState<{ bytes: Uint8Array; name: string } | undefined>();
  const [results, setResults] = useState<BuildResult[]>([]);
  const [running, setRunning] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [urlPrompt, setUrlPrompt] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem('pe.build', JSON.stringify(s));
    } catch {
      /* ignore */
    }
  }, [s]);

  useEffect(() => {
    // mở file mới: luôn lấy tên file vừa upload làm tiền tố (thay tên của file trước đó),
    // trừ khi tên là "index" (file build ra thường tên vậy, không có ý nghĩa làm tiền tố).
    if (project.fileName) {
      const guess = project.fileName.replace(/\.(html?|zip)$/i, '');
      if (!/^index$/i.test(guess)) setS((v) => ({ ...v, title: guess }));
    }
  }, [project]);

  const groups = useMemo(() => {
    const m = new Map<string, Variant[]>();
    VARIANTS.forEach((v) => m.set(v.group, [...(m.get(v.group) ?? []), v]));
    return [...m.entries()];
  }, []);

  const set = <K extends keyof Saved>(k: K, v: Saved[K]) => setS((o) => ({ ...o, [k]: v }));
  const toggle = (id: string) => set('selected', s.selected.includes(id) ? s.selected.filter((x) => x !== id) : [...s.selected, id]);

  const isSuperHtml = !!project.info.superHtmlChannel;

  const doRun = async () => {
    setErr('');
    setResults([]);
    const opts: BuildOptions = {
      ...s,
      googlePlayUrl: storeUrls.googlePlayUrl,
      appStoreUrl: storeUrls.appStoreUrl,
      kwaiThumbnail: thumb,
      extras,
    };
    const out: BuildResult[] = [];
    try {
      for (const v of VARIANTS.filter((x) => s.selected.includes(x.id))) {
        setRunning(v.label);
        out.push(await buildVariant(html, project.info, v, opts));
        setResults([...out]);
        await new Promise((r) => setTimeout(r));
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setRunning(null);
    }
  };

  // bấm Build: nếu chưa có link Google Play lẫn App Store, chặn lại và bắt nhập trước —
  // CTA của hầu hết network đều dựa vào 1 trong 2 link này để mở đúng trang store.
  const run = () => {
    if (!storeUrls.googlePlayUrl.trim() && !storeUrls.appStoreUrl.trim()) {
      setUrlPrompt(true);
      return;
    }
    doRun();
  };

  const confirmUrlPrompt = () => {
    if (!storeUrls.googlePlayUrl.trim() && !storeUrls.appStoreUrl.trim()) return;
    setUrlPrompt(false);
    doRun();
  };

  const skipUrlPrompt = () => {
    setUrlPrompt(false);
    doRun();
  };

  const play = async (r: BuildResult) => {
    onPlay({ html: await resultToHtml(r), sim: r.variant.sim, label: r.fileName });
  };

  const downloadAll = async () => {
    downloadBlob(await zipAll(results), `${s.title || 'playable'}_builds.zip`);
  };

  return (
    <div className="build">
      <div className="mode">
        {isSuperHtml ? (
          <p>File được build bằng <b>super-html</b> (network hiện tại: <b>{project.info.superHtmlChannel}</b>). Tool thay adapter network cũ bằng adapter mới đúng chỗ, giữ nguyên phần boot của game.</p>
        ) : (
          <p>File HTML thường: tool chèn <b>cầu nối network</b> vào &lt;head&gt; gồm SDK, adapter của super-html và hàm chuyển CTA. Game chỉ cần gọi <code>window.open(url)</code>, <code>mraid.open()</code>, <code>FbPlayableAd.onCTAClick()</code>… hoặc <code>window.playable_cta()</code>.</p>
        )}
      </div>

      <fieldset className="settings">
        <legend>Cài đặt</legend>
        <label>Tiền tố tên file<input value={s.title} onChange={(e) => set('title', e.target.value)} placeholder="vd. mygame_v2" /></label>
        <label>Link Google Play<input value={storeUrls.googlePlayUrl} onChange={(e) => onStoreUrlsChange({ ...storeUrls, googlePlayUrl: e.target.value })} placeholder="https://play.google.com/store/apps/details?id=…" /></label>
        <label>Link App Store<input value={storeUrls.appStoreUrl} onChange={(e) => onStoreUrlsChange({ ...storeUrls, appStoreUrl: e.target.value })} placeholder="https://apps.apple.com/app/id…" /></label>
        {!isSuperHtml && (
          <div className="toggles">
            <label className="check"><input type="checkbox" checked={s.routeWindowOpen} onChange={(e) => set('routeWindowOpen', e.target.checked)} /> Chuyển window.open thành CTA của network</label>
            <label className="check"><input type="checkbox" checked={s.crossShims} onChange={(e) => set('crossShims', e.target.checked)} /> Tạo API giả cho SDK network khác (mraid, FbPlayableAd, ExitApi…)</label>
            <label className="check"><input type="checkbox" checked={s.autoGameReady} onChange={(e) => set('autoGameReady', e.target.checked)} /> Tự báo game_ready khi tải xong (Mintegral, Bigo cần)</label>
          </div>
        )}
        <label>Ảnh thumbnail Kwai (thumbnail_cover.jpg)
          <input type="file" accept="image/jpeg,image/png" onChange={async (e) => { const f = e.target.files?.[0]; setThumb(f ? { bytes: new Uint8Array(await f.arrayBuffer()), name: f.name } : undefined); }} />
        </label>
      </fieldset>

      <fieldset className="networks">
        <legend>
          Network <span className="muted">({s.selected.length}/{VARIANTS.length})</span>
          <button className="link" onClick={() => set('selected', VARIANTS.map((v) => v.id))}>Chọn hết</button>
          <button className="link" onClick={() => set('selected', [])}>Bỏ chọn</button>
        </legend>
        {groups.map(([g, list]) => (
          <div className="net-group" key={g}>
            <h4>{g}</h4>
            {list.map((v) => (
              <label key={v.id} className={`net ${s.selected.includes(v.id) ? 'on' : ''}`} title={v.note}>
                <input type="checkbox" checked={s.selected.includes(v.id)} onChange={() => toggle(v.id)} />
                <span className="n">{v.label}</span>
                <span className="t">{v.out}{v.splitRes ? '+res.js' : ''}, ≤{v.limitMB}MB</span>
                <code>{v.cta}</code>
              </label>
            ))}
          </div>
        ))}
      </fieldset>

      <div className="build-actions">
        <button className="btn primary big" onClick={run} disabled={!!running || !s.selected.length}>
          {running ? `Đang build ${running}…` : `Build ${s.selected.length} network`}
        </button>
        {results.length > 1 && !running && <button className="btn" onClick={downloadAll}>Tải tất cả (.zip theo thư mục network)</button>}
      </div>
      {err && <p className="err">{err}</p>}

      {results.length > 0 && (
        <table className="results">
          <thead>
            <tr><th>File</th><th>Dung lượng</th><th>Cảnh báo</th><th /></tr>
          </thead>
          <tbody>
            {results.map((r) => {
              const pct = r.size / (r.variant.limitMB * 1048576);
              return (
                <tr key={r.variant.id} className={pct > 1 ? 'over' : ''}>
                  <td>
                    <div className="fn">
                      {r.variant.folder && <span className="pill" title="Thư mục network khi bấm 'Tải tất cả'">{r.variant.folder}</span>}
                      {r.fileName}
                    </div>
                    <div className="muted">{r.files.join(', ')}</div>
                  </td>
                  <td className="num">
                    {formatBytes(r.size)}
                    <div className="meter"><i style={{ width: Math.min(100, pct * 100) + '%' }} /></div>
                  </td>
                  <td className="warn">{r.warnings.length ? r.warnings.map((w, i) => <div key={i}>{w}</div>) : <span className="ok">Ổn</span>}</td>
                  <td className="acts">
                    <button className="btn small" onClick={() => play(r)}>Chơi thử</button>
                    <button className="btn small primary" onClick={() => downloadBlob(r.blob, r.fileName)}>Tải</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {urlPrompt && (
        <div className="modal-overlay" onClick={() => setUrlPrompt(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Chưa có link Google Play / App Store</h3>
            <p className="muted">Hầu hết network dùng link này để mở đúng trang store khi người chơi bấm CTA. Nhập ít nhất 1 link trước khi build.</p>
            <label>Link Google Play<input autoFocus value={storeUrls.googlePlayUrl} onChange={(e) => onStoreUrlsChange({ ...storeUrls, googlePlayUrl: e.target.value })} placeholder="https://play.google.com/store/apps/details?id=…" /></label>
            <label>Link App Store<input value={storeUrls.appStoreUrl} onChange={(e) => onStoreUrlsChange({ ...storeUrls, appStoreUrl: e.target.value })} placeholder="https://apps.apple.com/app/id…" /></label>
            <div className="modal-actions">
              <button className="btn small ghost" onClick={skipUrlPrompt}>Bỏ qua, build không cần link</button>
              <div className="spacer" />
              <button className="btn small" onClick={() => setUrlPrompt(false)}>Huỷ</button>
              <button className="btn small primary" disabled={!storeUrls.googlePlayUrl.trim() && !storeUrls.appStoreUrl.trim()} onClick={confirmUrlPrompt}>Build</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
