import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import JSZip from 'jszip';
import { parsePlayable } from '../src/lib/project';
import { VARIANTS, SUPER_HTML } from '../src/lib/channels';
import { buildVariant, guessStoreUrls, resultToHtml, zipAll } from '../src/lib/builder';

import path from 'node:path';
const SAMPLE = process.env.SAMPLE_HTML || path.resolve(__dirname, '../../super-html/static/index.html');
const opts = { title: 'demo', googlePlayUrl: 'https://play.google.com/store/apps/details?id=x', appStoreUrl: 'https://apps.apple.com/app/id1', autoGameReady: true, routeWindowOpen: true, crossShims: true };

async function makeV5(channel: string) {
  const inner = new JSZip();
  inner.file('__res', JSON.stringify({ 'assets/a.png': 'data:image/png;base64,' + fs.readFileSync(SAMPLE,'utf8').match(/data:image\/png;base64,([A-Za-z0-9+/=]+)/)![1] }));
  const z = await inner.generateAsync({ type: 'base64' });
  const ch = SUPER_HTML.channels[channel];
  const body = [ch.script, `window.__zip = "${z}";`, SUPER_HTML.jszip[0], `window.super_html_channel = "${channel}";` + SUPER_HTML.common].join(';');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>t</title>\n${ch.meta}\n<style>body{}</style></head><body><canvas></canvas><script type="text/javascript">\n${body}\n</script>\n</body></html>`;
}

describe('builder', () => {
  it.skipIf(!fs.existsSync(SAMPLE))('retargets super-html v5 output', async () => {
    const html = await makeV5('applovin');
    const p = await parsePlayable(html, 'a.html');
    expect(p.info.superHtmlChannel).toBe('applovin');
    expect(p.assets.length).toBe(1);
    expect(p.assets[0].location).toContain('__res');
    for (const v of VARIANTS) {
      const r = await buildVariant(html, p.info, v, opts);
      const out = await resultToHtml(r);
      expect(r.mode).toBe('super-html');
      expect(out).toContain(`window.super_html_channel = "${v.name}"`);
      expect(out.match(/window\.super_html_channel\s*=/g)!.length).toBe(1);
      const ch = SUPER_HTML.channels[v.configName] || {};
      if (ch.script) expect(out).toContain(ch.script);
      if (ch.meta !== SUPER_HTML.channels.applovin.meta) expect(out).not.toContain(SUPER_HTML.channels.applovin.meta);
      if (ch.meta) expect(out).toContain(ch.meta);
      if (v.splitRes) { expect(r.files).toContain('res.js'); expect(out).toContain('window.__zip'); }
    }
  });
  it.skipIf(!fs.existsSync(SAMPLE))('bridges a generic html', async () => {
    const html = fs.readFileSync(SAMPLE,'utf8');
    const p = await parsePlayable(html, 'index.html');
    for (const v of VARIANTS) {
      const r = await buildVariant(html, p.info, v, opts);
      expect(r.mode).toBe('bridge');
      const out = await resultToHtml(r);
      expect(out).toContain('PLAYABLE-EDITOR:BEGIN');
      if (v.splitRes) expect(r.files).toContain('res.js');
      // rebuild from output -> must not stack
      const p2 = await parsePlayable(out, 'x.html');
      const r2 = await buildVariant(out, p2.info, VARIANTS[1], opts);
      const out2 = await resultToHtml(r2);
      expect(out2.split('PLAYABLE-EDITOR:BEGIN').length).toBe(2);
    }
  }, 120000);

  it.skipIf(!fs.existsSync(SAMPLE))('Tải tất cả: mỗi file nằm đúng thư mục network (mã folder của dj)', async () => {
    const html = fs.readFileSync(SAMPLE, 'utf8');
    const p = await parsePlayable(html, 'index.html');
    const applovin = VARIANTS.find((v) => v.id === 'applovin')!;
    const chartboost = VARIANTS.find((v) => v.id === 'chartboost')!; // không có folder -> nằm ở gốc zip
    const [r1, r2] = await Promise.all([
      buildVariant(html, p.info, applovin, opts),
      buildVariant(html, p.info, chartboost, opts),
    ]);
    const zip = await zipAll([r1, r2]);
    const loaded = await JSZip.loadAsync(await zip.arrayBuffer());
    expect(loaded.file(`AL/${r1.fileName}`)).not.toBeNull();
    expect(loaded.file(r2.fileName)).not.toBeNull(); // chartboost: không có mã thư mục -> ở gốc
  });

  it('guessStoreUrls: dò đúng link Google Play / App Store có sẵn trong file, kể cả khi slash bị escape', () => {
    const html = `<script>var a="https:\\/\\/play.google.com\\/store\\/apps\\/details?id=com.foo.bar&hl=vi",b='https://apps.apple.com/us/app/foo-bar/id123456789';</script>`;
    const r = guessStoreUrls(html);
    expect(r.googlePlayUrl).toBe('https://play.google.com/store/apps/details?id=com.foo.bar&hl=vi');
    expect(r.appStoreUrl).toBe('https://apps.apple.com/us/app/foo-bar/id123456789');
  });

  it('guessStoreUrls: không có link nào thì trả rỗng, không báo lỗi', () => {
    const r = guessStoreUrls('<html><body>không có link gì ở đây</body></html>');
    expect(r.googlePlayUrl).toBe('');
    expect(r.appStoreUrl).toBe('');
  });

  it('guessStoreUrls: cắt bỏ rác dính cuối link (dấu ngoặc, dấu phẩy JSON)', () => {
    const html = `window.open("https://play.google.com/store/apps/details?id=com.foo.bar"); var x={"url":"https://apps.apple.com/app/id987654321","other":1};`;
    const r = guessStoreUrls(html);
    expect(r.googlePlayUrl).toBe('https://play.google.com/store/apps/details?id=com.foo.bar');
    expect(r.appStoreUrl).toBe('https://apps.apple.com/app/id987654321');
  });

  it('Mintegral (bridge / Luna): tự động gọi window.gameEnd() khi luna:ended hoặc trước window.install()', async () => {
    const lunaHtml = '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><script>window.LUCID=1;</script></body></html>';
    const p = await parsePlayable(lunaHtml, 'luna.html');
    const mtg = VARIANTS.find((v) => v.id === 'mintegral')!;
    const r = await buildVariant(lunaHtml, p.info, mtg, opts);
    const out = await resultToHtml(r);

    expect(out).toContain('<!-- window.install(); window.gameReady(); window.gameEnd(); -->');

    // Trích xuất script bridge để chạy trong môi trường giả lập Mintegral
    const scriptMatches = [...out.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
    const events: string[] = [];
    const listeners: Record<string, Array<(...args: any[]) => void>> = {};
    const fakeWin: any = {
      navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 13)' },
      location: { href: '' },
      document: { readyState: 'loading', addEventListener: () => {} },
      innerWidth: 375,
      innerHeight: 667,
      console: {
        log: (...args: any[]) => {},
        warn: () => {},
        error: () => {},
      },
      addEventListener: (ev: string, fn: any) => {
        (listeners[ev] = listeners[ev] || []).push(fn);
      },
      dispatchEvent: (ev: { type: string }) => {
        (listeners[ev.type] || []).forEach((fn) => fn(ev));
      },
      open: () => {
        events.push('native_open');
      },
      gameReady: () => {
        events.push('mtg_gameReady');
      },
      gameEnd: () => {
        events.push('mtg_gameEnd');
      },
      install: () => {
        events.push('mtg_install');
      },
    };
    fakeWin.window = fakeWin;

    const runInWin = new Function('window', 'navigator', 'document', 'console', 'location', 'Event', scriptMatches.join('\n'));
    class FakeEvent {
      type: string;
      constructor(t: string) {
        this.type = t;
      }
    }
    runInWin(fakeWin, fakeWin.navigator, fakeWin.document, fakeWin.console, fakeWin.location, FakeEvent);

    expect(typeof fakeWin.gameStart).toBe('function');
    expect(typeof fakeWin.gameClose).toBe('function');

    // 1. Gọi game_ready nhiều lần -> chỉ gọi window.gameReady đúng 1 lần
    fakeWin.super_html.game_ready();
    fakeWin.gameReady();
    expect(events).toEqual(['mtg_gameReady']);

    // 2. Khi Luna phát sự kiện luna:ended -> gọi window.gameEnd()
    fakeWin.dispatchEvent(new FakeEvent('luna:ended'));
    expect(events).toEqual(['mtg_gameReady', 'mtg_gameEnd']);

    // 3. Khi user bấm CTA (qua mraid.open hoặc window.open) -> gọi window.install() mà không gọi lặp lại window.gameEnd()
    fakeWin.mraid.open('https://play.google.com/store/apps/details?id=x');
    expect(events).toEqual(['mtg_gameReady', 'mtg_gameEnd', 'mtg_install']);
  });

  it('Mintegral: nếu user bấm CTA trước khi kết thúc game thì tự gọi window.gameEnd() trước window.install()', async () => {
    const lunaHtml = '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body></body></html>';
    const p = await parsePlayable(lunaHtml, 'luna.html');
    const mtg = VARIANTS.find((v) => v.id === 'mintegral')!;
    const r = await buildVariant(lunaHtml, p.info, mtg, opts);
    const out = await resultToHtml(r);
    const scriptMatches = [...out.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);

    const events: string[] = [];
    const fakeWin: any = {
      navigator: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)' },
      location: { href: '' },
      document: { readyState: 'loading', addEventListener: () => {} },
      innerWidth: 375,
      innerHeight: 667,
      console: { log: () => {}, warn: () => {}, error: () => {} },
      addEventListener: () => {},
      dispatchEvent: () => {},
      open: () => {},
      gameReady: () => events.push('mtg_gameReady'),
      gameEnd: () => events.push('mtg_gameEnd'),
      install: () => events.push('mtg_install'),
    };
    fakeWin.window = fakeWin;
    class FakeEvent {
      type: string;
      constructor(t: string) {
        this.type = t;
      }
    }
    new Function('window', 'navigator', 'document', 'console', 'location', 'Event', scriptMatches.join('\n'))(
      fakeWin,
      fakeWin.navigator,
      fakeWin.document,
      fakeWin.console,
      fakeWin.location,
      FakeEvent,
    );

    // Gọi window.open (như Luna/P_572) khi chưa gọi game_end -> phải gọi mtg_gameEnd trước mtg_install
    fakeWin.open('https://apps.apple.com/app/id1');
    expect(events).toEqual(['mtg_gameEnd', 'mtg_install']);
  });

  it('TikTok có config.json playable_orientation và tất cả các network MRAID truyền đúng store URL', async () => {
    const html = '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body></body></html>';
    const p = await parsePlayable(html, 'test.html');

    const tiktok = VARIANTS.find((v) => v.id === 'tiktok')!;
    const rTt = await buildVariant(html, p.info, tiktok, opts);
    expect(rTt.files).toContain('config.json');

    const applovin = VARIANTS.find((v) => v.id === 'applovin')!;
    const rAl = await buildVariant(html, p.info, applovin, opts);
    const outAl = await resultToHtml(rAl);
    const scriptMatches = [...outAl.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);

    let openedUrl = '';
    const fakeWin: any = {
      navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 13)' },
      location: { href: '' },
      document: { readyState: 'loading', addEventListener: () => {} },
      innerWidth: 375,
      innerHeight: 667,
      console: { log: () => {}, warn: () => {}, error: () => {} },
      addEventListener: () => {},
      dispatchEvent: () => {},
      open: () => {},
      mraid: {
        getState: () => 'default',
        isViewable: () => true,
        addEventListener: () => {},
        open: (u: string) => {
          openedUrl = u;
        },
      },
    };
    fakeWin.window = fakeWin;
    new Function('window', 'navigator', 'document', 'console', 'location', scriptMatches.join('\n'))(
      fakeWin,
      fakeWin.navigator,
      fakeWin.document,
      fakeWin.console,
      fakeWin.location,
    );

    // Gọi mraid.open() không truyền tham số -> tự điền link Google Play đã cấu hình
    fakeWin.mraid.open();
    expect(openedUrl).toBe(opts.googlePlayUrl);
  });

  it('super-html mode (như P_491 / P_572): chống ghi đè link rỗng, hỗ trợ super_get_url và bắt console.log("game end") trên Mintegral', async () => {
    // Giả lập file super-html đời cũ không có super_get_url trong common
    const legacyHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><!-- mraid.open(url) --></head><body><script>window.b_start_ads=!1,window.super_html={download:function(e){super_log("game download "),window.mraid?(super_log("url "+e),e?mraid.open(e):mraid.open()):super_open(e)},game_ready:function(){super_log("game ready",window.mraid),super_check_channel(window.mraid)?"loading"===mraid.getState()?mraid.addEventListener("ready",onSdkReady):onSdkReady():(super_log("skip mraid"),viewable_start_ads())}};window.__zip="UEsFBgAAAAAAAAAAAAAAAAAAAAAAAA==";window.super_html_channel="applovin";</script></body></html>`;
    const p = await parsePlayable(legacyHtml, 'legacy.html');
    expect(p.info.superHtmlChannel).toBe('applovin');

    const mtg = VARIANTS.find((v) => v.id === 'mintegral')!;
    const r = await buildVariant(legacyHtml, p.info, mtg, opts);
    expect(r.mode).toBe('super-html');
    const out = await resultToHtml(r);

    // Script cũ của AppLovin phải được gỡ bỏ hoàn toàn
    expect(out).not.toContain('viewableChangeHandler');
    expect(out).toContain('<!-- window.install(); window.gameReady(); window.gameEnd(); -->');

    const scriptMatches = [...out.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
    const events: string[] = [];
    const fakeWin: any = {
      navigator: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)' },
      location: { href: '' },
      document: { readyState: 'complete', addEventListener: () => {} },
      innerWidth: 375,
      innerHeight: 667,
      console: { log: () => {}, warn: () => {}, error: () => {} },
      addEventListener: () => {},
      dispatchEvent: () => {},
      open: () => {},
      gameReady: () => events.push('mtg_gameReady'),
      gameEnd: () => events.push('mtg_gameEnd'),
      install: () => events.push('mtg_install'),
    };
    fakeWin.window = fakeWin;
    class FakeEvent {
      type: string;
      constructor(t: string) {
        this.type = t;
      }
    }
    new Function('window', 'navigator', 'document', 'console', 'location', 'Event', scriptMatches.join('\n'))(
      fakeWin,
      fakeWin.navigator,
      fakeWin.document,
      fakeWin.console,
      fakeWin.location,
      FakeEvent,
    );

    // Game cố tình gán rỗng appstore_url (như P_491) -> vẫn giữ nguyên link cấu hình của user
    fakeWin.super_html.appstore_url = '';
    expect(fakeWin.super_html.appstore_url).toBe(opts.appStoreUrl);
    expect(fakeWin.super_get_url()).toBe(opts.appStoreUrl);

    // Không ghi đè console.log (Mintegral báo lỗi "Error: Do not override console methods")
    expect(out).not.toContain('console.log=function');

    // Bấm download -> tự gọi mtg_gameEnd trước mtg_install, không gọi trùng mtg_gameEnd khi bấm tiếp
    fakeWin.super_html.download();
    fakeWin.super_html.download();
    expect(events).toEqual(['mtg_gameEnd', 'mtg_install', 'mtg_install']);
  });

  it('Mintegral: loại bỏ URL telemetry collector.lunalabs.io và thẻ đóng thừa để vượt qua kiểm duyệt File handling & Storage requirements', async () => {
    const lunaWithTelemetry = `<!DOCTYPE html><html><head><meta charset="utf-8"><script>window.pi.apply(window,["applovin",95822,3651487,"sig","https://collector.lunalabs.io/api/v1/stats/collect",null,3000,500,"https://collector.lunalabs.io/api/v1/stats/errors/collect"]||[])</script></head><body></body></html></head></html>`;
    const p = await parsePlayable(lunaWithTelemetry, 'P_277_H_v15_BG_AL.html');
    const mtg = VARIANTS.find((v) => v.id === 'mintegral')!;
    const r = await buildVariant(lunaWithTelemetry, p.info, mtg, { ...opts, title: 'P_277_H_v15_BG_AL' });
    const out = await resultToHtml(r);

    expect(out).not.toContain('collector.lunalabs.io');
    expect(out).not.toContain('</html></head></html>');
    expect(out.trim().endsWith('</html>')).toBe(true);
    expect(r.warnings).toEqual([]);
  });
});
