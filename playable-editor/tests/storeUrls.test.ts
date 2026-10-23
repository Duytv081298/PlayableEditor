import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { detectStoreUrls, detectStoreUrlsSync, applyStoreUrlsToHtml } from '../src/lib/storeUrls';

describe('storeUrls', () => {
  it('detects google play and app store urls synchronously', () => {
    const html = `
      <html>
        <head>
          <script>
            var android = "https://play.google.com/store/apps/details?id=com.awesome.game&hl=en";
            var ios = "https://apps.apple.com/us/app/awesome-game/id123456789";
          </script>
        </head>
      </html>
    `;
    const res = detectStoreUrlsSync(html);
    expect(res.urls.googlePlayUrl).toBe('https://play.google.com/store/apps/details?id=com.awesome.game&hl=en');
    expect(res.urls.appStoreUrl).toBe('https://apps.apple.com/us/app/awesome-game/id123456789');
    expect(res.count.googlePlay).toBe(1);
    expect(res.count.appStore).toBe(1);
  });

  it('detects escaped urls', async () => {
    const html = `window.__data = "https:\\/\\/play.google.com\\/store\\/apps\\/details?id=com.test.pkg";`;
    const res = await detectStoreUrls(html);
    expect(res.urls.googlePlayUrl).toBe('https://play.google.com/store/apps/details?id=com.test.pkg');
  });

  it('detects super_html assignments', async () => {
    const html = `window.super_html={google_play_url: "https://custom.link/android", appstore_url: "https://custom.link/ios"};`;
    const res = await detectStoreUrls(html);
    expect(res.urls.googlePlayUrl).toBe('https://custom.link/android');
    expect(res.urls.appStoreUrl).toBe('https://custom.link/ios');
  });

  it('detects store URLs hidden inside window.__zip (like AppLovin / super-html builds)', async () => {
    const zip = new JSZip();
    zip.file(
      'assets/main/index.js',
      'var gp = "https://play.google.com/store/apps/details?id=com.puzzle.wool.away&gl=us";\n' +
      'var as = "https://apps.apple.com/us/app/knit-away/id6746331323";\n' +
      'super_html["google_play_url"] = gp;\nsuper_html["appstore_url"] = as;',
    );
    const zipB64 = await zip.generateAsync({ type: 'base64' });
    const html = `
      <html>
        <head><script>window.super_html_channel="applovin";window.__zip="${zipB64}";</script></head>
        <body>Playable</body>
      </html>
    `;

    const res = await detectStoreUrls(html);
    expect(res.urls.googlePlayUrl).toBe('https://play.google.com/store/apps/details?id=com.puzzle.wool.away&gl=us');
    expect(res.urls.appStoreUrl).toBe('https://apps.apple.com/us/app/knit-away/id6746331323');
  });

  it('replaces original URLs in both zip and outer HTML and injects store hook script', async () => {
    const zip = new JSZip();
    zip.file(
      'assets/main/index.js',
      'var gp = "https://play.google.com/store/apps/details?id=com.old.app";\n' +
      'super_html["google_play_url"] = gp;',
    );
    const zipB64 = await zip.generateAsync({ type: 'base64' });

    const oldHtml = `
      <html>
        <head><title>Test</title><script>window.__zip="${zipB64}";</script></head>
        <body>
          <a href="https://play.google.com/store/apps/details?id=com.old.app">Download</a>
        </body>
      </html>
    `;
    const originalUrls = {
      googlePlayUrl: 'https://play.google.com/store/apps/details?id=com.old.app',
      appStoreUrl: '',
    };
    const newUrls = {
      googlePlayUrl: 'https://play.google.com/store/apps/details?id=com.new.app',
      appStoreUrl: 'https://apps.apple.com/app/id999999',
    };

    const updated = await applyStoreUrlsToHtml(oldHtml, newUrls, originalUrls);

    // Old URL was replaced in outer HTML
    expect(updated).not.toContain('com.old.app');
    expect(updated).toContain('com.new.app');

    // Hook script was injected
    expect(updated).toContain('__PLAYABLE_STORE_URLS__');
    expect(updated).toContain('https://apps.apple.com/app/id999999');

    // Detect on updated html finds new URLs (both from outer and zip)
    const reDetected = await detectStoreUrls(updated);
    expect(reDetected.urls.googlePlayUrl).toBe('https://play.google.com/store/apps/details?id=com.new.app');
    expect(reDetected.urls.appStoreUrl).toBe('https://apps.apple.com/app/id999999');

    // And verify the zip inside updated HTML also contains the new URL
    const updatedZipMatch = updated.match(/window\.__zip\s*=\s*["']([A-Za-z0-9+/=]+)["']/);
    expect(updatedZipMatch).toBeTruthy();
    const updatedZip = await JSZip.loadAsync(updatedZipMatch![1], { base64: true });
    const updatedIndexJs = await updatedZip.file('assets/main/index.js')!.async('string');
    expect(updatedIndexJs).toContain('com.new.app');
    expect(updatedIndexJs).not.toContain('com.old.app');
  });
});
