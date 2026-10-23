// Quản lý và xử lý link Store (Google Play & App Store) cho playable HTML
import JSZip from 'jszip';
import { base64ToBytes } from './binary';
import { zlibInflate } from './project';

export interface StoreUrls {
  googlePlayUrl: string;
  appStoreUrl: string;
}

const TRAILING_JUNK_RE = /[)\].,;!'"]+$/;

function trimUrl(u: string): string {
  return u.replace(TRAILING_JUNK_RE, '');
}

/** Quét chuỗi văn bản thuần (đồng bộ) để tìm link Google Play & App Store */
export function detectStoreUrlsSync(text: string): { urls: StoreUrls; count: { googlePlay: number; appStore: number } } {
  // Gỡ "\/" (slash bị escape trong chuỗi JS/JSON) để regex khớp được link
  const flat = text.replace(/\\\//g, '/');

  // 1. Dò theo gán super_html, STORE object hoặc Luna packageConfig (androidLink/iosLink)
  const shGp = flat.match(/super_html\.google_play_url\s*=\s*["']([^"']+)["']/i) ||
               flat.match(/google_play_url\s*:\s*["']([^"']+)["']/i) ||
               flat.match(/androidLink\s*:\s*["']([^"']+)["']/i) ||
               flat.match(/STORE\s*=\s*\{[^}]*android\s*:\s*["']([^"']+)["']/i) ||
               flat.match(/__PLAYABLE_STORE_URLS__\s*=\s*\{[^}]*googlePlay\s*:\s*["']([^"']+)["']/i);

  const shAs = flat.match(/super_html\.appstore_url\s*=\s*["']([^"']+)["']/i) ||
               flat.match(/appstore_url\s*:\s*["']([^"']+)["']/i) ||
               flat.match(/iosLink\s*:\s*["']([^"']+)["']/i) ||
               flat.match(/STORE\s*=\s*\{[^}]*ios\s*:\s*["']([^"']+)["']/i) ||
               flat.match(/__PLAYABLE_STORE_URLS__\s*=\s*\{[^}]*appStore\s*:\s*["']([^"']+)["']/i);

  // 2. Dò theo regex URL chuẩn của Google Play và App Store
  const gpMatches = [...flat.matchAll(/https?:\/\/play\.google\.com\/store\/apps\/details\?id=[\w.%-]+(?:&[^\s"'<>]*)?/gi)];
  const asMatches = [
    ...flat.matchAll(/https?:\/\/apps\.apple\.com\/[a-z]{0,8}\/?app\/[^\s"'<>]*?id\d{6,}[^\s"'<>]*/gi),
    ...flat.matchAll(/https?:\/\/itunes\.apple\.com\/[^\s"'<>]*?id\d{6,}[^\s"'<>]*/gi),
  ];

  let googlePlayUrl = '';
  if (shGp && shGp[1]?.trim()) {
    googlePlayUrl = trimUrl(shGp[1].trim());
  } else if (gpMatches.length > 0) {
    googlePlayUrl = trimUrl(gpMatches[0][0]);
  }

  let appStoreUrl = '';
  if (shAs && shAs[1]?.trim()) {
    appStoreUrl = trimUrl(shAs[1].trim());
  } else if (asMatches.length > 0) {
    appStoreUrl = trimUrl(asMatches[0][0]);
  }

  return {
    urls: { googlePlayUrl, appStoreUrl },
    count: {
      googlePlay: gpMatches.length + (shGp ? 1 : 0),
      appStore: asMatches.length + (shAs ? 1 : 0),
    },
  };
}

/** Tự dò các link Google Play / App Store có sẵn trong file (quét cả HTML ngoài lẫn bên trong window.__zip và adapter) */
export async function detectStoreUrls(html: string): Promise<{ urls: StoreUrls; count: { googlePlay: number; appStore: number } }> {
  // 1. Quét HTML ngoài trước
  const res = detectStoreUrlsSync(html);
  if (res.urls.googlePlayUrl && res.urls.appStoreUrl) {
    return res;
  }

  // 2. Quét bên trong window.__zip (thường gặp ở bản build Cocos qua super-html như AppLovin, FB...)
  const zipMatch = html.match(/window\.__zip\s*=\s*["']([A-Za-z0-9+/=]+)["']/);
  if (zipMatch) {
    try {
      const zip = await JSZip.loadAsync(zipMatch[1], { base64: true });
      for (const [name, file] of Object.entries(zip.files)) {
        if (!file.dir && (name.endsWith('.js') || name.endsWith('.json') || name.endsWith('.html'))) {
          const text = await file.async('string');
          const inZip = detectStoreUrlsSync(text);
          if (!res.urls.googlePlayUrl && inZip.urls.googlePlayUrl) {
            res.urls.googlePlayUrl = inZip.urls.googlePlayUrl;
          }
          if (!res.urls.appStoreUrl && inZip.urls.appStoreUrl) {
            res.urls.appStoreUrl = inZip.urls.appStoreUrl;
          }
          res.count.googlePlay += inZip.count.googlePlay;
          res.count.appStore += inZip.count.appStore;
          if (res.urls.googlePlayUrl && res.urls.appStoreUrl) break;
        }
      }
    } catch {
      /* ignore zip parse errors */
    }
  }

  // 3. Quét playable-ads-adapter nếu có
  if (!res.urls.googlePlayUrl || !res.urls.appStoreUrl) {
    const adTags = [...html.matchAll(/window\.__adapter_zip__\s*\+?=\s*["']([A-Za-z0-9+/=_-]*)["']/g)];
    if (adTags.length) {
      try {
        const fullB64 = adTags.map((t) => t[1]).join('');
        const rawBytes = base64ToBytes(fullB64.replace(/-/g, '+').replace(/_/g, '/'));
        const inflated = await zlibInflate(rawBytes);
        const jsonText = new TextDecoder().decode(inflated);
        const inAd = detectStoreUrlsSync(jsonText);
        if (!res.urls.googlePlayUrl && inAd.urls.googlePlayUrl) res.urls.googlePlayUrl = inAd.urls.googlePlayUrl;
        if (!res.urls.appStoreUrl && inAd.urls.appStoreUrl) res.urls.appStoreUrl = inAd.urls.appStoreUrl;
        res.count.googlePlay += inAd.count.googlePlay;
        res.count.appStore += inAd.count.appStore;
      } catch {
        /* ignore adapter inflate errors */
      }
    }
  }

  return res;
}

const STORE_BLOCK_BEGIN = '<!--PLAYABLE-EDITOR:STORE-->';
const STORE_BLOCK_END = '<!--PLAYABLE-EDITOR:STORE:END-->';

function replaceUrlAll(text: string, oldUrl: string, newUrl: string): string {
  if (!oldUrl || !newUrl || oldUrl === newUrl) return text;
  // Thay thế bản unescaped
  let res = text.split(oldUrl).join(newUrl);
  // Thay thế bản escaped "\/"
  const escOld = oldUrl.replace(/\//g, '\\/');
  const escNew = newUrl.replace(/\//g, '\\/');
  if (escOld !== oldUrl) {
    res = res.split(escOld).join(escNew);
  }
  return res;
}

/** Áp dụng link store mới vào file HTML:
 * 1. Thay thế trực tiếp URL cũ trong các file text bên trong window.__zip (nếu có)
 * 2. Thay thế trực tiếp URL cũ trong HTML ngoài
 * 3. Cập nhật / chèn khối hook Playable Editor để đảm bảo window.super_html và preview nhận đúng URL
 */
export async function applyStoreUrlsToHtml(
  html: string,
  newUrls: StoreUrls,
  originalUrls?: StoreUrls,
): Promise<string> {
  let out = html;

  // 1. Gỡ khối store cũ của Playable Editor nếu đã chèn trước đó
  const storeBlockRe = new RegExp(`${STORE_BLOCK_BEGIN}[\\s\\S]*?${STORE_BLOCK_END}\\n?`, 'g');
  out = out.replace(storeBlockRe, '');

  // 2. Thay thế bên trong window.__zip nếu file có gói nén nội bộ
  const zipMatch = out.match(/window\.__zip\s*=\s*["']([A-Za-z0-9+/=]+)["']/);
  if (zipMatch) {
    try {
      const zip = await JSZip.loadAsync(zipMatch[1], { base64: true });
      let modified = false;
      for (const [name, file] of Object.entries(zip.files)) {
        if (!file.dir && (name.endsWith('.js') || name.endsWith('.json') || name.endsWith('.html'))) {
          const text = await file.async('string');
          let nextText = text;
          if (originalUrls?.googlePlayUrl && newUrls.googlePlayUrl && originalUrls.googlePlayUrl !== newUrls.googlePlayUrl) {
            nextText = replaceUrlAll(nextText, originalUrls.googlePlayUrl, newUrls.googlePlayUrl);
          }
          if (originalUrls?.appStoreUrl && newUrls.appStoreUrl && originalUrls.appStoreUrl !== newUrls.appStoreUrl) {
            nextText = replaceUrlAll(nextText, originalUrls.appStoreUrl, newUrls.appStoreUrl);
          }
          if (nextText !== text) {
            zip.file(name, nextText);
            modified = true;
          }
        }
      }
      if (modified) {
        const newB64 = await zip.generateAsync({ type: 'base64', compression: 'DEFLATE', compressionOptions: { level: 9 } });
        out = out.replace(zipMatch[0], `window.__zip = "${newB64}"`);
      }
    } catch {
      /* ignore zip error */
    }
  }

  // 3. Thay thế toàn diện chuỗi URL cũ trong HTML ngoài
  if (originalUrls?.googlePlayUrl && newUrls.googlePlayUrl && originalUrls.googlePlayUrl !== newUrls.googlePlayUrl) {
    out = replaceUrlAll(out, originalUrls.googlePlayUrl, newUrls.googlePlayUrl);
  }
  if (originalUrls?.appStoreUrl && newUrls.appStoreUrl && originalUrls.appStoreUrl !== newUrls.appStoreUrl) {
    out = replaceUrlAll(out, originalUrls.appStoreUrl, newUrls.appStoreUrl);
  }

  // 4. Cập nhật các biến gán link trong code (super_html, Luna packageConfig)
  if (newUrls.googlePlayUrl) {
    out = out.replace(/(super_html\.google_play_url\s*=\s*["'])[^"']*(["'])/g, `$1${newUrls.googlePlayUrl}$2`);
    out = out.replace(/(androidLink\s*:\s*["'])[^"']*(["'])/g, `$1${newUrls.googlePlayUrl}$2`);
  }
  if (newUrls.appStoreUrl) {
    out = out.replace(/(super_html\.appstore_url\s*=\s*["'])[^"']*(["'])/g, `$1${newUrls.appStoreUrl}$2`);
    out = out.replace(/(iosLink\s*:\s*["'])[^"']*(["'])/g, `$1${newUrls.appStoreUrl}$2`);
  }

  // 5. Nếu có ít nhất 1 link, chèn script hook chuẩn vào đầu <head>
  if (newUrls.googlePlayUrl || newUrls.appStoreUrl) {
    const gpJson = JSON.stringify(newUrls.googlePlayUrl || '');
    const asJson = JSON.stringify(newUrls.appStoreUrl || '');

    const hookScript =
`${STORE_BLOCK_BEGIN}
<script type="text/javascript">
(function(){
  var gp = ${gpJson};
  var as = ${asJson};
  window.__PLAYABLE_STORE_URLS__ = { googlePlay: gp, appStore: as };
  if (typeof window.super_html === "object" && window.super_html) {
    if (gp) window.super_html.google_play_url = gp;
    if (as) window.super_html.appstore_url = as;
  }
  try {
    if (window.super_html) {
      if (gp) Object.defineProperty(window.super_html, 'google_play_url', { get: function(){ return gp; }, set: function(){}, configurable: true });
      if (as) Object.defineProperty(window.super_html, 'appstore_url', { get: function(){ return as; }, set: function(){}, configurable: true });
    }
    if (window.$environment && window.$environment.packageConfig) {
      if (gp) window.$environment.packageConfig.androidLink = gp;
      if (as) window.$environment.packageConfig.iosLink = as;
    }
  } catch(e){}
  if (typeof STORE === "object" && STORE) {
    if (gp) STORE.android = gp;
    if (as) STORE.ios = as;
  }
})();
</script>
${STORE_BLOCK_END}`;

    const headMatch = out.match(/<head[^>]*>/i);
    if (headMatch) {
      const at = headMatch.index! + headMatch[0].length;
      out = out.slice(0, at) + '\n' + hookScript + '\n' + out.slice(at);
    } else {
      out = hookScript + '\n' + out;
    }
  }

  return out;
}
