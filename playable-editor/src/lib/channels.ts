// Danh sách network + biến thể, theo đúng bảng inject_channel_adapter của super-html 5.2.3
import data from '../data/superHtml.json';

export interface ChannelFiles {
  meta?: string;
  script?: string;
  head?: string;
  config?: string;
}

export const SUPER_HTML = data as {
  source: string;
  channels: Record<string, ChannelFiles>;
  common: string;
  jszip: string[];
};

export type SimKind =
  | 'none' | 'mraid' | 'facebook' | 'google' | 'mintegral' | 'pangle' | 'vungle'
  | 'dapi' | 'snapchat' | 'kwai' | 'bigo' | 'gdt' | 'yandex';

export interface Variant {
  /** id duy nhất, cũng là tên file đầu ra (không đuôi) */
  id: string;
  /** s_name của super-html: giá trị window.super_html_channel */
  name: string;
  /** thư mục channel/<configName> chứa meta/script/config */
  configName: string;
  label: string;
  group: string;
  /** mã thư mục network riêng của dj (AL, BG, CM…) — khi có, "Tải tất cả" đóng gói kết quả
   *  của biến thể này vào đúng thư mục con cùng tên bên trong file .zip xuất ra, để giải
   *  nén đè lên đúng bộ thư mục network đã tạo sẵn trên máy. */
  folder?: string;
  out: 'html' | 'zip';
  /** super-html nén tài nguyên (JSZip) cho biến thể này */
  htmlCompression: boolean;
  /** tách tài nguyên ra res.js trong zip */
  splitRes?: boolean;
  /** giới hạn dung lượng tham khảo (MB) */
  limitMB: number;
  /** API CTA network dùng */
  cta: string;
  sim: SimKind;
  note?: string;
}

const MRAID_NAMES = new Set(['applovin', 'chartboost', 'unity', 'liftoff', 'nefta', 'inmobi', 'ironsource2025']);
export const isMraidNetwork = (name: string) => MRAID_NAMES.has(name);

export const VARIANTS: Variant[] = [
  { id: 'common', name: 'common', configName: 'common', label: 'Common (không SDK)', group: 'Chung', folder: 'CM', out: 'html', htmlCompression: false, limitMB: 5, cta: 'window.open(store_url)', sim: 'none', note: 'Bản thường, dùng để test hoặc network không có trong danh sách.' },
  { id: 'common_min', name: 'common', configName: 'common', label: 'Common (nén tài nguyên)', group: 'Chung', folder: 'CMM', out: 'html', htmlCompression: true, limitMB: 5, cta: 'window.open(store_url)', sim: 'none', note: 'Giống Common nhưng nén tài nguyên lại (file nhẹ hơn), dùng khi cần giảm dung lượng.' },
  { id: 'applovin', name: 'applovin', configName: 'applovin', label: 'AppLovin', group: 'MRAID', folder: 'AL', out: 'html', htmlCompression: true, limitMB: 5, cta: 'mraid.open(url)', sim: 'mraid', note: 'Đợi mraid ready + viewable rồi mới boot game.' },
  { id: 'ironsource2025', name: 'ironsource2025', configName: 'ironsource2025', label: 'ironSource / LevelPlay', group: 'MRAID', folder: 'IR', out: 'html', htmlCompression: true, limitMB: 5, cta: 'mraid.open(url)', sim: 'mraid', note: 'Có <script src="mraid.js">, theo dõi audioVolumeChange.' },
  { id: 'unity', name: 'unity', configName: 'unity', label: 'Unity Ads', group: 'MRAID', folder: 'UN', out: 'html', htmlCompression: true, limitMB: 5, cta: 'mraid.open(url)', sim: 'mraid' },
  { id: 'chartboost', name: 'chartboost', configName: 'chartboost', label: 'Chartboost', group: 'MRAID', out: 'html', htmlCompression: true, limitMB: 5, cta: 'mraid.open(url)', sim: 'mraid' },
  { id: 'liftoff', name: 'liftoff', configName: 'liftoff', label: 'Liftoff', group: 'MRAID', folder: 'LO', out: 'zip', htmlCompression: false, limitMB: 5, cta: 'mraid.open(url)', sim: 'mraid' },
  { id: 'nefta', name: 'nefta', configName: 'nefta', label: 'Nefta (html)', group: 'MRAID', out: 'html', htmlCompression: true, limitMB: 5, cta: 'mraid.open(url)', sim: 'mraid' },
  { id: 'nefta_zip', name: 'nefta', configName: 'nefta', label: 'Nefta (zip)', group: 'MRAID', out: 'zip', htmlCompression: false, limitMB: 5, cta: 'mraid.open(url)', sim: 'mraid' },
  { id: 'inmobi', name: 'inmobi', configName: 'inmobi', label: 'InMobi', group: 'MRAID', out: 'html', htmlCompression: true, limitMB: 5, cta: 'mraid.open(url)', sim: 'mraid' },
  { id: 'mintegral', name: 'mintegral', configName: 'mintegral', label: 'Mintegral', group: 'Khác', folder: 'MG', out: 'zip', htmlCompression: false, limitMB: 5, cta: 'window.install()', sim: 'mintegral', note: 'Gọi window.gameReady(), network gọi lại gameStart().' },
  { id: 'google', name: 'google', configName: 'google', label: 'Google Ads', group: 'Google', folder: 'GG', out: 'zip', htmlCompression: true, limitMB: 5, cta: 'ExitApi.exit()', sim: 'google', note: 'meta ad.orientation=portrait,landscape' },
  { id: 'google_portrait', name: 'google', configName: 'google_portrait', label: 'Google Ads – dọc 320×480', group: 'Google', folder: 'GG', out: 'zip', htmlCompression: true, limitMB: 5, cta: 'ExitApi.exit()', sim: 'google' },
  { id: 'google_landscape', name: 'google', configName: 'google_landscape', label: 'Google Ads – ngang 480×320', group: 'Google', folder: 'GG', out: 'zip', htmlCompression: true, limitMB: 5, cta: 'ExitApi.exit()', sim: 'google' },
  { id: 'facebook', name: 'facebook', configName: 'facebook', label: 'Meta / Facebook (html)', group: 'Meta', folder: 'FB', out: 'html', htmlCompression: true, limitMB: 2, cta: 'FbPlayableAd.onCTAClick()', sim: 'facebook', note: 'Single HTML ≤ 2MB.' },
  { id: 'facebook_zip', name: 'facebook', configName: 'facebook', label: 'Meta / Facebook (zip + res.js)', group: 'Meta', folder: 'FB', out: 'zip', htmlCompression: true, splitRes: true, limitMB: 5, cta: 'FbPlayableAd.onCTAClick()', sim: 'facebook', note: 'Tài nguyên tách ra res.js.' },
  { id: 'pangle', name: 'pangle', configName: 'pangle', label: 'Pangle', group: 'ByteDance', folder: 'PG', out: 'zip', htmlCompression: false, limitMB: 5, cta: 'window.openAppStore()', sim: 'pangle', note: 'config.json playable_orientation = 0 (tự do)' },
  { id: 'pangle_portrait', name: 'pangle', configName: 'pangle_portrait', label: 'Pangle – dọc', group: 'ByteDance', folder: 'PG', out: 'zip', htmlCompression: false, limitMB: 5, cta: 'window.openAppStore()', sim: 'pangle' },
  { id: 'pangle_landscape', name: 'pangle', configName: 'pangle_landscape', label: 'Pangle – ngang', group: 'ByteDance', folder: 'PG', out: 'zip', htmlCompression: false, limitMB: 5, cta: 'window.openAppStore()', sim: 'pangle' },
  { id: 'tiktok', name: 'tiktok', configName: 'tiktok', label: 'TikTok', group: 'ByteDance', folder: 'TT', out: 'zip', htmlCompression: false, limitMB: 5, cta: 'window.openAppStore()', sim: 'pangle' },
  { id: 'moloco', name: 'moloco', configName: 'moloco', label: 'Moloco', group: 'Khác', folder: 'MO', out: 'html', htmlCompression: true, limitMB: 5, cta: 'window.open(store_url)', sim: 'none', note: 'Cần điền link store.' },
  { id: 'vungle', name: 'vungle', configName: 'vungle', label: 'Vungle / Liftoff Monetize', group: 'Khác', folder: 'VG', out: 'zip', htmlCompression: false, limitMB: 5, cta: 'parent.postMessage("download")', sim: 'vungle' },
  { id: 'bigo', name: 'bigo', configName: 'bigo', label: 'Bigo Ads', group: 'Khác', folder: 'BG', out: 'zip', htmlCompression: false, limitMB: 5, cta: 'BGY_MRAID.open()', sim: 'bigo' },
  { id: 'kwai', name: 'kwai', configName: 'kwai', label: 'Kwai', group: 'Khác', folder: 'KW', out: 'zip', htmlCompression: false, limitMB: 5, cta: 'ks_playable_openAppStore()', sim: 'kwai', note: 'Cần ảnh thumbnail_cover.jpg trong zip.' },
  { id: 'snapchat', name: 'snapchat', configName: 'snapchat', label: 'Snapchat', group: 'Khác', out: 'zip', htmlCompression: true, limitMB: 5, cta: 'ScPlayableAd.onCTAClick()', sim: 'snapchat', note: 'config.json orientation = 1' },
  { id: 'gdt', name: 'gdt', configName: 'gdt', label: 'GDT (Tencent)', group: 'Tencent', out: 'zip', htmlCompression: true, limitMB: 5, cta: '_gdtUnSdk.playAble.onClick()', sim: 'gdt' },
  { id: 'gdt_portrait', name: 'gdt', configName: 'gdt_portrait', label: 'GDT – dọc', group: 'Tencent', out: 'zip', htmlCompression: true, limitMB: 5, cta: '_gdtUnSdk.playAble.onClick()', sim: 'gdt' },
  { id: 'gdt_landscape', name: 'gdt', configName: 'gdt_landscape', label: 'GDT – ngang', group: 'Tencent', out: 'zip', htmlCompression: true, limitMB: 5, cta: '_gdtUnSdk.playAble.onClick()', sim: 'gdt' },
  { id: 'news_break', name: 'news_break', configName: 'news_break', label: 'NewsBreak', group: 'Khác', out: 'html', htmlCompression: true, limitMB: 5, cta: 'window.open(store_url)', sim: 'none' },
  { id: 'yandex', name: 'yandex', configName: 'yandex', label: 'Yandex', group: 'Khác', out: 'zip', htmlCompression: true, splitRes: true, limitMB: 3, cta: 'yandexHTML5BannerApi.getClickURLNum(1)', sim: 'yandex', note: 'meta ad.size 300×250, tài nguyên tách ra res.js.' },
];

export function channelFiles(configName: string): ChannelFiles {
  return SUPER_HTML.channels[configName] ?? {};
}

/** Các domain SDK hợp lệ (xuất hiện trong meta.html của các network) */
export const SDK_DOMAINS: string[] = Array.from(
  new Set(
    Object.values(SUPER_HTML.channels)
      .flatMap((c) => [c.meta ?? '', c.head ?? ''])
      .flatMap((s) => [...s.matchAll(/https?:\/\/([^/"']+)/g)].map((m) => m[1])),
  ),
);

export function simForChannelName(name: string): SimKind {
  return VARIANTS.find((v) => v.name === name)?.sim ?? 'none';
}

export const SIM_OPTIONS: Array<{ id: SimKind; label: string }> = [
  { id: 'none', label: 'Không giả lập (window.open)' },
  { id: 'mraid', label: 'MRAID (AppLovin, Unity, ironSource…)' },
  { id: 'facebook', label: 'Meta FbPlayableAd' },
  { id: 'google', label: 'Google ExitApi' },
  { id: 'mintegral', label: 'Mintegral' },
  { id: 'pangle', label: 'Pangle / TikTok' },
  { id: 'vungle', label: 'Vungle' },
  { id: 'dapi', label: 'ironSource DAPI (cũ)' },
  { id: 'snapchat', label: 'Snapchat' },
  { id: 'kwai', label: 'Kwai' },
  { id: 'bigo', label: 'Bigo' },
  { id: 'gdt', label: 'GDT Tencent' },
  { id: 'yandex', label: 'Yandex' },
];

/** Đoán network đang dùng trong HTML để chọn giả lập mặc định */
export function guessSim(html: string, superHtmlChannel: string | null): SimKind {
  if (superHtmlChannel) return simForChannelName(superHtmlChannel);
  if (/\bmraid\b/.test(html)) return 'mraid';
  if (/FbPlayableAd/.test(html)) return 'facebook';
  if (/ExitApi/.test(html)) return 'google';
  if (/\bdapi\b/.test(html)) return 'dapi';
  if (/openAppStore/.test(html)) return 'pangle';
  if (/window\.install|gameReady/.test(html)) return 'mintegral';
  return 'none';
}
