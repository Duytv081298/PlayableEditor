// Build HTML playable ra từng network, mô phỏng pipeline của super-html:
//   meta.html  -> chèn đầu <head> (SDK, meta, chuỗi CTA dạng comment cho bộ kiểm duyệt)
//   head.js    -> chèn cuối <head>
//   script.js  -> định nghĩa window.super_html.download/game_ready cho network
//   config.json, res.js (tách tài nguyên), thumbnail -> đóng gói zip
//
// Hai chế độ:
//   - "super-html": input đã build bằng super-html v5 (có window.super_html_channel)
//      -> thay adapter cũ bằng adapter mới tại đúng vị trí.
//   - "bridge": HTML bất kỳ -> chèn bộ "cầu nối" gồm common tối giản + adapter network,
//      chuyển window.open / mraid.open / FbPlayableAd... về CTA của network đích.

import JSZip from 'jszip';
import { SDK_DOMAINS, SUPER_HTML, Variant, channelFiles, isMraidNetwork } from './channels';
import type { ProjectInfo } from './project';
import { utf8Size } from './binary';
import { detectStoreUrlsSync } from './storeUrls';

export interface BuildOptions {
  title: string;
  googlePlayUrl: string;
  appStoreUrl: string;
  /** bridge: tự gọi super_html.game_ready() khi window load */
  autoGameReady: boolean;
  /** bridge: chuyển window.open thành CTA của network */
  routeWindowOpen: boolean;
  /** bridge: tạo hàm giả cho API của network khác (FbPlayableAd, ExitApi, mraid...) */
  crossShims: boolean;
  kwaiThumbnail?: { bytes: Uint8Array; name: string };
  /** file phụ đi kèm input zip (vd. thumbnail) */
  extras?: Record<string, Uint8Array>;
}

export interface BuildResult {
  variant: Variant;
  fileName: string;
  blob: Blob;
  size: number;
  htmlSize: number;
  mode: 'super-html' | 'bridge';
  warnings: string[];
  files: string[];
}

const BEGIN = '<!--PLAYABLE-EDITOR:BEGIN-->';
const END = '<!--PLAYABLE-EDITOR:END-->';
const SH_BEGIN = '/*PLAYABLE-EDITOR:SH:BEGIN*/';
const SH_END = '/*PLAYABLE-EDITOR:SH:END*/';

const LEGACY_METAS = [
  '<!-- window.install(); -->',
];

const LEGACY_SCRIPTS = [
  'function onSdkReady(){super_log("onSdkReady"),mraid.addEventListener("viewableChange",viewableChangeHandler),mraid.isViewable()&&viewable_start_ads()}function viewableChangeHandler(e){super_log("viewableChangeHandler:"+e),e&&viewable_start_ads()}function viewable_start_ads(){b_start_ads||(super_boot_engine(),b_start_ads=!0)}window.b_start_ads=!1,window.super_html={download:function(e){super_log("game download "),window.mraid?(super_log("url "+e),e?mraid.open(e):mraid.open()):super_open(e)},game_ready:function(){super_log("game ready",window.mraid),super_check_channel(window.mraid)?"loading"===mraid.getState()?mraid.addEventListener("ready",onSdkReady):onSdkReady():(super_log("skip mraid"),viewable_start_ads())}};',
  'window.super_html={download:function(e){super_log("game download "),window.mraid?(super_log("url "+e),e?mraid.open(e):mraid.open()):super_open(e)},game_ready:function(){super_log("game ready"),super_check_channel(window.mraid),super_boot_engine()}};',
  'function gameStart(){super_log("game start"),super_boot_engine()}function gameClose(){}window.super_html={download:function(e){super_log("game download "),window.install?window.install():super_open(e)},game_ready:function(){super_log("game ready"),super_check_channel(window.gameReady)?window.gameReady&&window.gameReady():(super_log("skip mraid"),gameStart())},game_end:function(){super_log("game end"),window.gameEnd&&window.gameEnd()}};',
  'window.super_html={download:function(o){super_log("game download "),(o=super_get_url(o))||console.error("[super-html] not set google_play_url or appstore_url"),window.open(o||"about:black","_blank")},game_ready:function(){super_log("game ready"),super_boot_engine()}};',
  'window.super_html={download:function(e){super_log("game download "),window.openAppStore?window.openAppStore():super_open(e)},game_ready:function(){super_log("game ready"),super_check_channel(window.openAppStore),super_boot_engine()}};',
];

const removeAll = (s: string, part: string) => (part ? s.split(part).join('') : s);

function removeSnippet(html: string, snippet: string): string {
  if (!snippet) return html;
  let out = html;
  const variants = new Set([snippet, snippet.replace(/\r\n/g, '\n'), snippet.replace(/\r?\n/g, '\r\n')]);
  for (const v of variants) {
    out = removeAll(out, v + '\r\n');
    out = removeAll(out, v + '\n');
    out = removeAll(out, v);
  }
  return out;
}

function wrapHead(js: string): string {
  return js.trim().startsWith('<') ? js : `<script type="text/javascript">\n${js}\n</script>`;
}

/** Gỡ mọi dấu vết adapter network cũ (meta, head.js, bridge của tool, store hook) */
export function stripChannelArtifacts(html: string): string {
  let out = html.replace(new RegExp(`${BEGIN}[\\s\\S]*?${END}\\r?\\n?`, 'g'), '');
  out = out.replace(/\/\*PLAYABLE-EDITOR:SH:BEGIN\*\/[\s\S]*?\/\*PLAYABLE-EDITOR:SH:END\*\/;?/g, '');
  out = out.replace(/<!--PLAYABLE-EDITOR:STORE-->[\s\S]*?<!--PLAYABLE-EDITOR:STORE:END-->\r?\n?/g, '');
  for (const c of Object.values(SUPER_HTML.channels)) {
    if (c.meta) out = removeSnippet(out, c.meta);
    if (c.head) out = removeSnippet(out, wrapHead(c.head));
  }
  for (const m of LEGACY_METAS) {
    out = removeSnippet(out, m);
  }
  out = out.replace(/<script src='res\.js'><\/script>\r?\n?/g, '');
  return out;
}

function insertHeadStart(html: string, snippet: string): string {
  const head = html.match(/<head[^>]*>/i);
  if (!head) return snippet + '\n' + html;
  const headEnd = head.index! + head[0].length;
  const charset = html.slice(headEnd, headEnd + 2048).match(/<meta[^>]*charset[^>]*>/i);
  const at = charset ? headEnd + charset.index! + charset[0].length : headEnd;
  return html.slice(0, at) + '\n' + snippet + '\n' + html.slice(at);
}

function insertHeadEnd(html: string, snippet: string): string {
  const i = html.search(/<\/head>/i);
  return i < 0 ? snippet + '\n' + html : html.slice(0, i) + snippet + '\n' + html.slice(i);
}

const js = (v: unknown) => JSON.stringify(v);

/** Dò link Google Play / App Store đã có sẵn trong file */
export function guessStoreUrls(html: string): { googlePlayUrl: string; appStoreUrl: string } {
  return detectStoreUrlsSync(html).urls;
}

function runtimePreScript(v: Variant, o: BuildOptions, includeChannelVar: boolean): string {
  return (
    '(function(){' +
    `var STORE={android:${js(o.googlePlayUrl)},ios:${js(o.appStoreUrl)}};` +
    'window.__PLAYABLE_STORE_URLS__={googlePlay:STORE.android,appStore:STORE.ios};' +
    (includeChannelVar ? `window.super_html_channel=${js(v.name)};` : '') +
    'if(!window.__pe_native_open)window.__pe_native_open=window.open;' +
    'if(!window.super_log)window.super_log=function(m){console.log("[super-html] "+m)};' +
    'window.super_get_url=function(u){' +
    'var sh=window.super_html||{};' +
    'var ua=navigator.userAgent||navigator.vendor||"";' +
    'var isA=/android/i.test(ua);' +
    'var cfg=isA?(STORE.android||sh.google_play_url||STORE.ios||sh.appstore_url):(STORE.ios||sh.appstore_url||STORE.android||sh.google_play_url);' +
    'var res=cfg||u||"";' +
    'window.super_log("url "+res);' +
    'return res;' +
    '};' +
    'window.super_open=function(u){' +
    'u=window.super_get_url(u)||u||"";' +
    'if(/iPhone|iPad|iPod/i.test(navigator.userAgent||""))location.href=u;' +
    'else if(window.__pe_native_open)window.__pe_native_open.call(window,u,"_blank");' +
    '};' +
    'if(!window.super_check_channel)window.super_check_channel=function(o){if(!o)console.warn("[playable] SDK network chưa có: "+(window.super_html_channel||' + js(v.name) + '));return!!o};' +
    'if(!window.super_boot_engine)window.super_boot_engine=function(){};' +
    'if(window.fetch&&!window.fetch.__pe){var _f=window.fetch,wf=function(u){if(typeof u==="string"&&/^https?:\\/\\//i.test(u)&&(!location.host||u.indexOf(location.host)===-1))return Promise.resolve(typeof Response!=="undefined"?new Response("{}",{status:200}):{ok:!0,status:200,json:function(){return Promise.resolve({})},text:function(){return Promise.resolve("")}});return _f.apply(this,arguments)};wf.__pe=!0;window.fetch=wf}' +
    '})();' +
    'var super_log=window.super_log,super_get_url=window.super_get_url,super_open=window.super_open,super_check_channel=window.super_check_channel,super_boot_engine=window.super_boot_engine;'
  );
}

function runtimePostScript(v: Variant, o: BuildOptions, mode: 'super-html' | 'bridge'): string {
  const name = v.name;
  const shims: string[] = [];
  if (o.crossShims) {
    if (name !== 'facebook' && name !== 'moloco') shims.push('if(!window.FbPlayableAd)window.FbPlayableAd={onCTAClick:function(){cta()}};');
    if (name !== 'google') shims.push('if(!window.ExitApi)window.ExitApi={exit:function(){cta()}};');
    if (name !== 'mintegral') shims.push('if(typeof window.install!=="function")window.install=function(){cta()};');
    if (name !== 'pangle' && name !== 'tiktok') {
      shims.push('if(typeof window.openAppStore!=="function")window.openAppStore=function(){cta()};');
      shims.push('if(!window.playableSDK)window.playableSDK={openAppStore:function(){cta()}};');
    }
    if (name !== 'snapchat') shims.push('if(!window.ScPlayableAd)window.ScPlayableAd={onCTAClick:function(){cta()}};');
    if (name !== 'bigo') shims.push('if(!window.BGY_MRAID)window.BGY_MRAID={open:function(){cta()},gameReady:function(){},gameEnd:function(){gameEnd()}};');
    if (name !== 'kwai') shims.push('if(typeof window.ks_playable_openAppStore!=="function")window.ks_playable_openAppStore=function(){cta()};');
    if (name !== 'ironsource') {
      shims.push(
        'if(!window.dapi){var DL={};window.dapi={isReady:function(){return!0},addEventListener:function(e,f){DL[e]=f;if(e==="ready"||e==="viewableChange")setTimeout(function(){f({isViewable:!0})})},' +
          'removeEventListener:function(e){delete DL[e]},getScreenSize:function(){return{width:innerWidth,height:innerHeight}},getAudioVolume:function(){return 100},isViewable:function(){return!0},openStoreUrl:function(u){cta(u)}}}',
      );
    }
    if (!isMraidNetwork(name)) {
      shims.push(
        'if(!window.mraid){var L={},_mOpen=function(u){cta(u)};_mOpen.__pe=!0;window.mraid={getState:function(){return"default"},isViewable:function(){return!0},' +
          'addEventListener:function(e,f){(L[e]=L[e]||[]).push(f);if(e==="ready"||e==="viewableChange")setTimeout(function(){f(!0)})},' +
          'removeEventListener:function(e,f){if(L[e])L[e]=L[e].filter(function(x){return x!==f})},open:_mOpen,close:function(){},expand:function(){},useCustomClose:function(){},' +
          'getVersion:function(){return"3.0"},getPlacementType:function(){return"interstitial"},getAudioVolume:function(){return 100},' +
          'supports:function(){return!1},getScreenSize:function(){return{width:innerWidth,height:innerHeight}},getMaxSize:function(){return{width:innerWidth,height:innerHeight}}}}',
      );
    }
  }
  return (
    '(function(){' +
    `var STORE={android:${js(o.googlePlayUrl)},ios:${js(o.appStoreUrl)}};` +
    'var sh=window.super_html=window.super_html||{};' +
    'var _gp=STORE.android||sh.google_play_url||"",_as=STORE.ios||sh.appstore_url||"";' +
    'try{' +
    'Object.defineProperty(sh,"google_play_url",{configurable:!0,enumerable:!0,get:function(){return STORE.android||_gp},set:function(v){if(v)_gp=v}});' +
    'Object.defineProperty(sh,"appstore_url",{configurable:!0,enumerable:!0,get:function(){return STORE.ios||_as},set:function(v){if(v)_as=v}});' +
    '}catch(e){if(STORE.android)sh.google_play_url=STORE.android;if(STORE.ios)sh.appstore_url=STORE.ios;}' +
    'var _ended=!1,busy=!1,_origEnd=sh.game_end;' +
    'sh.game_end=function(){if(_ended)return;_ended=!0;if(_origEnd)return _origEnd.apply(sh,arguments);window.super_log("game end");if(typeof window.gameEnd==="function")window.gameEnd()};' +
    'var _origDl=sh.download;' +
    'sh.download=function(u){u=window.super_get_url?window.super_get_url(u):u;if(!_ended){try{sh.game_end()}catch(e){console.error(e)}}var prev=busy;busy=!0;try{if(_origDl)return _origDl.call(sh,u);if(window.super_open)return window.super_open(u)}finally{busy=prev}};' +
    'var _origReady=sh.game_ready;' +
    'function wrapMraid(){if(window.mraid&&typeof window.mraid.open==="function"&&!window.mraid.open.__pe){var mo=window.mraid.open,w=function(u){if(!_ended){try{sh.game_end()}catch(e){}}var fu=window.super_get_url?window.super_get_url(u):u;return fu?mo.call(window.mraid,fu):mo.call(window.mraid)};w.__pe=!0;window.mraid.open=w}}' +
    'wrapMraid();' +
    'sh.game_ready=function(){wrapMraid();if(_origReady)return _origReady.apply(sh,arguments);window.super_log("game ready");if(window.super_boot_engine)window.super_boot_engine()};' +
    'if(!sh.is_hide_download)sh.is_hide_download=function(){return!1};' +
    'var cta=function(u){try{sh.download(u)}catch(e){console.error(e)}};' +
    'var gameEnd=function(){try{sh.game_end()}catch(e){console.error(e)}};' +
    'window.playable_cta=cta;window.playable_game_end=gameEnd;' +
    'window.addEventListener("luna:ended",function(){gameEnd()});' +
    (name !== 'mintegral' ? 'if(typeof window.gameEnd!=="function")window.gameEnd=function(){gameEnd()};' : '') +
    (name === 'mintegral'
      ? 'if(typeof window.gameReady==="function"&&!window.gameReady.__pe){var _gr=window.gameReady,_grDone=!1,wgr=function(){if(_grDone)return;_grDone=!0;return _gr.apply(this,arguments)};wgr.__pe=!0;window.gameReady=wgr}'
      : '') +
    (o.routeWindowOpen
      ? 'var o=window.open;window.open=function(u){if(busy)return o?o.apply(window,arguments):null;busy=!0;try{cta(u)}finally{busy=!1}return null};' +
        'if(typeof HTMLAnchorElement!=="undefined"&&HTMLAnchorElement.prototype&&HTMLAnchorElement.prototype.click){var _ac=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){var h=(this.getAttribute&&this.getAttribute("href"))||this.href||"";if(!busy&&/^https?:\\/\\//i.test(h)){busy=!0;try{cta(h)}finally{busy=!1}return}return _ac.apply(this,arguments)}}'
      : '') +
    shims.join('') +
    (mode === 'bridge' && o.autoGameReady
      ? 'var go=function(){sh.game_ready&&sh.game_ready()};if(document.readyState==="complete")setTimeout(go);else window.addEventListener("load",go);'
      : '') +
    '})();'
  );
}

/** Cầu nối cho HTML không build bằng super-html */
function bridgeScript(v: Variant, o: BuildOptions): string {
  const ch = channelFiles(v.configName);
  const pre = runtimePreScript(v, o, true);
  const post = runtimePostScript(v, o, 'bridge');
  return `<script type="text/javascript">\n${pre}\n${ch.script ?? ''}\n${post}\n</script>`;
}

/** Tìm khối `window.__res={...};` (JSON) bằng cách đếm ngoặc */
function findResJsonSpan(html: string): [number, number] | null {
  const m = /window\.__res\s*=\s*\{/.exec(html);
  if (!m) return null;
  let i = m.index + m[0].length - 1;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (; i < html.length; i++) {
    const c = html[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        let end = i + 1;
        if (html[end] === ';') end++;
        return [m.index, end];
      }
    }
  }
  return null;
}

/** Tách tài nguyên ra res.js. Trả về null nếu không tìm thấy khối tài nguyên. */
function splitResources(html: string): { html: string; resJs: string } | null {
  const zipStmt = /window\.__zip\s*=\s*"[A-Za-z0-9+/=]*";?/.exec(html);
  if (zipStmt) {
    let out = html.slice(0, zipStmt.index) + html.slice(zipStmt.index + zipStmt[0].length);
    let resJs = zipStmt[0];
    for (const lib of SUPER_HTML.jszip) {
      const at = out.indexOf(lib);
      if (at >= 0) {
        out = out.slice(0, at) + out.slice(at + lib.length);
        resJs += '\n' + lib;
        break;
      }
    }
    return { html: insertHeadStart(out, "<script src='res.js'></script>"), resJs };
  }
  // playable-ads-adapter: các thẻ <script data-id="adapter-zip-N">window.__adapter_zip__(+)=...</script>
  const adTags = [...html.matchAll(/<script[^>]*>\s*(window\.__adapter_zip__\s*\+?=\s*"[A-Za-z0-9+/=_-]*";?)\s*<\/script>/g)];
  if (adTags.length) {
    let out = html;
    for (const t of [...adTags].reverse()) out = out.slice(0, t.index!) + out.slice(t.index! + t[0].length);
    const resJs = adTags.map((t) => t[1].replace(/;?$/, ';')).join('\n');
    return { html: insertHeadStart(out, "<script src='res.js'></script>"), resJs };
  }
  const span = findResJsonSpan(html);
  if (span) {
    const resJs = html.slice(span[0], span[1]);
    const out = html.slice(0, span[0]) + html.slice(span[1]);
    return { html: insertHeadStart(out, "<script src='res.js'></script>"), resJs };
  }
  return null;
}

function externalDomains(html: string): string[] {
  const found = new Set<string>();
  for (const m of html.matchAll(/(?:src|href)\s*=\s*["'](https?:)?\/\/([^/"']+)/gi)) found.add(m[2]);
  for (const m of html.matchAll(/(?:fetch\s*\(|\.src\s*=|XMLHttpRequest[\s\S]{0,80}?\.open\s*\(\s*["']GET["']\s*,)\s*["']https?:\/\/([^/"']+)/gi)) found.add(m[1]);
  return [...found].filter((d) => !SDK_DOMAINS.includes(d));
}

function outName(v: Variant, o: BuildOptions, ext: string): string {
  const base = v.id.replace(/_zip$/, '');
  const rawTitle = o.title.trim();
  const t = v.name === 'mintegral'
    ? rawTitle.replace(/[^a-zA-Z0-9_]+/g, '_').replace(/^_+|_+$/g, '')
    : rawTitle.replace(/[\\/:*?"<>|\s]+/g, '_');
  return `${t ? t + '_' : ''}${base}.${ext}`;
}

/** Làm sạch các request telemetry ngoài (Luna stats/errors) và thẻ đóng thừa cuối file */
function sanitizePlayableHtml(html: string): string {
  let out = html.replace(/https?:\/\/collector\.lunalabs\.io\/[^\s"'<>\\)]*/gi, '');
  out = out.replace(/<\/html>\s*(?:<\/head>\s*|<\/body>\s*|<\/html>\s*)+$/i, '</html>');
  return out;
}

/** Áp adapter network vào HTML (chưa đóng gói) */
export function applyChannel(html: string, info: ProjectInfo, v: Variant, o: BuildOptions): { html: string; mode: 'super-html' | 'bridge'; warnings: string[] } {
  const warnings: string[] = [];
  const ch = channelFiles(v.configName);
  let out = sanitizePlayableHtml(stripChannelArtifacts(html));
  let mode: 'super-html' | 'bridge' = 'bridge';

  const chVar = /window\.super_html_channel\s*=\s*"([\w-]+)";?/.exec(out);
  if (chVar && info.superHtmlChannel) {
    mode = 'super-html';
    // gỡ script.js của network cũ (đứng trước window.super_html_channel)
    const candidateScripts = [
      ...Object.values(SUPER_HTML.channels).map((c) => c.script).filter((s): s is string => !!s),
      ...LEGACY_SCRIPTS,
    ];
    let best: { at: number; len: number } | null = null;
    for (const scriptStr of candidateScripts) {
      const at = out.lastIndexOf(scriptStr, chVar.index);
      if (at >= 0 && (!best || at > best.at)) best = { at, len: scriptStr.length };
    }
    if (best) {
      let end = best.at + best.len;
      if (out[end] === ';') end++;
      out = out.slice(0, best.at) + out.slice(end);
    }
    const varAt = out.search(/window\.super_html_channel\s*=\s*"[\w-]+";?/);
    const shRuntime = `${SH_BEGIN}${runtimePreScript(v, o, false)}${ch.script ?? ''}${runtimePostScript(v, o, 'super-html')}${SH_END}`;
    const inject = [shRuntime, `window.super_html_channel = "${v.name}";`].join(';');
    out = out.slice(0, varAt) + inject + out.slice(varAt).replace(/^window\.super_html_channel\s*=\s*"[\w-]+";?/, '');
    if (!info.hasResZip && v.htmlCompression) {
      warnings.push('super-html nén tài nguyên cho network này; file gốc chưa nén nên giữ nguyên.');
    }
  } else {
    const bridge = `${BEGIN}\n${bridgeScript(v, o)}\n${END}`;
    out = insertHeadStart(out, bridge);
  }

  if (v.name !== 'applovin') {
    out = out.replace(/window\.__PLAYABLE_APLOVIN_BUILD__\s*=\s*true/g, 'window.__PLAYABLE_APLOVIN_BUILD__=false');
  }

  if (ch.meta) out = insertHeadStart(out, ch.meta);
  if (ch.head) out = insertHeadEnd(out, wrapHead(ch.head));
  if (v.name === 'unity' && !/mraid\.open/.test(out)) out = insertHeadStart(out, '<!-- mraid.open(url) -->');

  const needsUrl = (ch.script ?? '').includes('super_get_url') || v.sim === 'none';
  if (needsUrl && !o.googlePlayUrl && !o.appStoreUrl) {
    warnings.push('Chưa điền link Google Play / App Store — CTA có thể mở URL rỗng.');
  }
  return { html: out, mode, warnings };
}

export async function buildVariant(html: string, info: ProjectInfo, v: Variant, o: BuildOptions): Promise<BuildResult> {
  const applied = applyChannel(html, info, v, o);
  const warnings = [...applied.warnings];
  let out = applied.html;
  const files: string[] = [];
  let blob: Blob;
  let fileName: string;
  let htmlSize: number;

  if (v.out === 'html') {
    blob = new Blob([out], { type: 'text/html' });
    htmlSize = blob.size;
    fileName = outName(v, o, 'html');
    files.push(fileName);
  } else {
    const zip = new JSZip();
    if (v.splitRes) {
      const sp = splitResources(out);
      if (sp) {
        out = sp.html;
        zip.file('res.js', sp.resJs);
        files.push('res.js');
      } else {
        warnings.push('Không tìm thấy khối tài nguyên (window.__zip / window.__res / window.__adapter_zip__) để tách ra res.js — giữ nguyên trong index.html.');
      }
    }
    zip.file('index.html', out);
    files.unshift('index.html');
    htmlSize = utf8Size(out);
    const ch = channelFiles(v.configName);
    if (ch.config) {
      zip.file('config.json', ch.config);
      files.push('config.json');
      try {
        const thumb = JSON.parse(ch.config).thumbnailName as string | undefined;
        if (thumb) {
          const t = o.kwaiThumbnail?.bytes ?? o.extras?.[thumb];
          if (t) {
            zip.file(thumb, t);
            files.push(thumb);
          } else warnings.push(`Thiếu ảnh ${thumb} (chọn ở phần Cài đặt build).`);
        }
      } catch {
        /* config không phải JSON chuẩn */
      }
    }
    blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 9 } });
    fileName = outName(v, o, 'zip');
  }

  const limit = v.limitMB * 1024 * 1024;
  if (blob.size > limit) warnings.push(`Vượt giới hạn ${v.limitMB}MB (${(blob.size / 1048576).toFixed(2)}MB).`);
  const ext = externalDomains(out);
  if (ext.length) warnings.push('Có tham chiếu ra ngoài: ' + ext.slice(0, 5).join(', ') + ' — nhiều network sẽ từ chối.');

  return { variant: v, fileName, blob, size: blob.size, htmlSize, mode: applied.mode, warnings, files };
}

/** Lấy HTML chạy được từ kết quả build (gộp res.js nếu có) để chơi thử */
export async function resultToHtml(r: BuildResult): Promise<string> {
  if (r.variant.out === 'html') return r.blob.text();
  const zip = await JSZip.loadAsync(await r.blob.arrayBuffer());
  let html = await zip.file('index.html')!.async('string');
  const res = zip.file('res.js');
  if (res) {
    const code = await res.async('string');
    html = html.replace("<script src='res.js'></script>", () => `<script type="text/javascript">\n${code}\n</script>`);
  }
  return html;
}

/** Đóng gói mọi kết quả build vào 1 zip. Biến thể nào có `folder` (mã thư mục network của dj,
 *  vd. AL/BG/CM…) thì file nằm trong đúng thư mục con đó — giải nén đè lên bộ thư mục network
 *  đã tạo sẵn trên máy là xong, không cần kéo thả thủ công từng file. */
export async function zipAll(results: BuildResult[]): Promise<Blob> {
  const zip = new JSZip();
  for (const r of results) {
    const path = r.variant.folder ? `${r.variant.folder}/${r.fileName}` : r.fileName;
    zip.file(path, r.blob);
  }
  return zip.generateAsync({ type: 'blob', compression: 'STORE' });
}
