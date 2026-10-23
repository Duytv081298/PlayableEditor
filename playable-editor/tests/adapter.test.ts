import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { parsePlayable, serializeProject, zlibInflate } from '../src/lib/project';
import { base64ToBytes } from '../src/lib/binary';
import { buildVariant, resultToHtml } from '../src/lib/builder';
import { VARIANTS } from '../src/lib/channels';

const SAMPLE = process.env.ADAPTER_HTML || '';

async function decodeAdapter(html: string): Promise<Record<string, string>> {
  const b64 = [...html.matchAll(/window\.__adapter_zip__\s*\+?=\s*"([^"]*)"/g)].map((m) => m[1]).join('');
  return JSON.parse(new TextDecoder().decode(await zlibInflate(base64ToBytes(b64))));
}

describe('playable-ads-adapter (__adapter_zip__)', () => {
  it.skipIf(!SAMPLE || !fs.existsSync(SAMPLE))('đọc ảnh/âm thanh, round-trip và thay thế', async () => {
    const html = fs.readFileSync(SAMPLE, 'utf8');
    const p = await parsePlayable(html, 'tm.html');
    expect(p.info.hasAdapterZip).toBe(true);
    const inner = p.assets.filter((a) => a.location.includes('__adapter_zip__'));
    const imgs = inner.filter((a) => a.kind === 'image');
    const auds = inner.filter((a) => a.kind === 'audio');
    console.log('assets', p.assets.length, 'inner img', imgs.length, 'audio', auds.length);
    expect(imgs.length).toBeGreaterThanOrEqual(30);
    expect(auds.length).toBe(3);
    expect(await serializeProject(p)).toBe(html);

    // thay ảnh đầu tiên bằng ảnh của chính asset khác, thay mp3 đầu bằng mp3 thứ hai
    const img = imgs[1];
    img.replacement = { ...imgs[0].original, fileName: 'a.png' };
    const aud = auds[0];
    aud.replacement = { ...auds[1].original, fileName: 'b.mp3' };
    const out = await serializeProject(p);
    expect(out).not.toBe(html);
    expect([...out.matchAll(/window\.__adapter_zip__\s*\+?=/g)].length).toBe(3);
    const res = await decodeAdapter(out);
    expect(res[img.name]).toBe(`data:${imgs[0].mime};base64,${imgs[0].originalB64}`);
    expect(res[aud.name]).toBe(`data:${auds[1].mime};base64,${auds[1].originalB64}`);
    const orig = await decodeAdapter(html);
    expect(Object.keys(res)).toEqual(Object.keys(orig));

    // build network có tách res.js (vd. biến thể zip) và gộp lại phải ra cùng tài nguyên
    const v = VARIANTS.find((x) => x.splitRes);
    if (v) {
      const r = await buildVariant(out, p.info, v, { title: 't', googlePlayUrl: 'g', appStoreUrl: 'a', autoGameReady: false, routeWindowOpen: false, crossShims: false });
      expect(r.files).toContain('res.js');
      const back = await resultToHtml(r);
      expect(Object.keys(await decodeAdapter(back)).length).toBe(Object.keys(orig).length);
    }
  }, 60000);
});
