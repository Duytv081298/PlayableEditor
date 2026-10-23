import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import { decodeBase122, encodeBase122, escapeHtmlAttr, isLunaHtml, unescapeHtmlAttr } from '../src/lib/luna';
import { parsePlayable, serializeProject } from '../src/lib/project';
import { detectStoreUrls } from '../src/lib/storeUrls';

describe('Luna Labs Playable support', () => {
  it('correctly encodes and decodes Base122 with entity escaping', () => {
    const original = new Uint8Array([0, 10, 34, 92, 128, 255, 65, 66, 67, 13, 38, 60, 62]);
    const encoded = encodeBase122(original);
    const escaped = escapeHtmlAttr(encoded);
    const unescaped = unescapeHtmlAttr(escaped);
    const decoded = decodeBase122(unescaped);
    expect(Array.from(decoded)).toEqual(Array.from(original));

    // decodeBase122 should also directly handle strings containing HTML entities
    const directDecoded = decodeBase122(escaped);
    expect(Array.from(directDecoded)).toEqual(Array.from(original));
  });

  it('detects and parses Luna HTML snippet', async () => {
    const imgBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
    const src122 = encodeBase122(imgBytes);
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <script>window.LUCID = "TEST"; window.$environment = { packageConfig: { androidLink: "https://play.google.com/store/apps/details?id=com.test.luna", iosLink: "https://apps.apple.com/app/id12345" } };</script>
        </head>
        <body>
          <img id="assets/bundles/-1/hero.png" data-src122="${src122}" data-mime="image/png" style="display:none">
        </body>
      </html>
    `;

    expect(isLunaHtml(html)).toBe(true);

    const project = await parsePlayable(html, 'test_luna.html');
    expect(project.info.engine).toBe('Unity / Luna');
    expect(project.assets.length).toBe(1);
    expect(project.assets[0].name).toBe('hero.png');
    expect(project.assets[0].kind).toBe('image');
    expect(project.assets[0].mime).toBe('image/png');

    // Test store URL detection
    const store = await detectStoreUrls(html);
    expect(store.urls.googlePlayUrl).toBe('https://play.google.com/store/apps/details?id=com.test.luna');
    expect(store.urls.appStoreUrl).toBe('https://apps.apple.com/app/id12345');

    // Test replacing the asset
    const newBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
    project.assets[0].replacement = {
      bytes: newBytes,
      mime: 'image/png',
      fileName: 'new_hero.png',
    };

    const serialized = await serializeProject(project);
    expect(serialized).not.toContain(src122);
    const reProject = await parsePlayable(serialized, 'test_luna.html');
    expect(Array.from(reProject.assets[0].original.bytes)).toEqual(Array.from(newBytes));
  });

  // Test with the actual user file if it exists
  const realFile = 'c:/Users/duytv/Downloads/Help_Them_V1_260724_Applovin.html';
  if (fs.existsSync(realFile)) {
    it('parses real Help_Them_V1_260724_Applovin.html correctly', async () => {
      const realHtml = fs.readFileSync(realFile, 'utf8');
      const project = await parsePlayable(realHtml, 'Help_Them_V1_260724_Applovin.html');

      expect(project.info.engine).toBe('Unity / Luna');
      const images = project.assets.filter((a) => a.kind === 'image');
      const audios = project.assets.filter((a) => a.kind === 'audio');

      console.log(`Parsed real Luna file: ${images.length} images, ${audios.length} audios`);
      expect(images.length).toBe(45);
      expect(audios.length).toBe(2);

      // Verify all PNG images are completely valid with IEND chunk
      for (const img of images) {
        if (img.mime === 'image/png') {
          const b = img.original.bytes;
          const isPng = b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
          expect(isPng).toBe(true);
          const tail = b.subarray(b.length - 12);
          const iend = String.fromCharCode(tail[4], tail[5], tail[6], tail[7]);
          expect(iend).toBe('IEND');
        }
      }

      const store = await detectStoreUrls(realHtml);
      expect(store.urls.googlePlayUrl).toBe('https://play.google.com/store/apps/details?id=com.tricky.brainking.puzzle&gl=us');
      expect(store.urls.appStoreUrl).toContain('apps.apple.com');
    });
  }

  const soFile = 'c:/Users/duytv/Downloads/SO_V5_Trung_20241031.html';
  if (fs.existsSync(soFile)) {
    it('parses real SO_V5_Trung_20241031.html correctly with valid images', async () => {
      const soHtml = fs.readFileSync(soFile, 'utf8');
      const project = await parsePlayable(soHtml, 'SO_V5_Trung_20241031.html');

      expect(project.info.engine).toBe('Unity / Luna');
      const images = project.assets.filter((a) => a.kind === 'image');
      const audios = project.assets.filter((a) => a.kind === 'audio');

      expect(images.length).toBe(177);
      expect(audios.length).toBe(9);

      // Verify each image decodes to a valid image format
      for (const img of images) {
        const b = img.original.bytes;
        expect(b.length).toBeGreaterThan(0);
        if (img.mime === 'image/png') {
          const isPng = b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
          expect(isPng).toBe(true);
          const tail = b.subarray(b.length - 12);
          const iend = String.fromCharCode(tail[4], tail[5], tail[6], tail[7]);
          expect(iend).toBe('IEND');
        } else if (img.mime === 'image/jpeg') {
          const isJpg = b[0] === 0xff && b[1] === 0xd8;
          expect(isJpg).toBe(true);
        }
      }

      // Test replacing one image and serializing
      const targetImg = images.find((a) => a.name === '-707138.png')!;
      expect(targetImg).toBeDefined();
      const dummyPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0x1f, 0x15, 0xc4, 0x89, 0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
      targetImg.replacement = {
        bytes: dummyPng,
        mime: 'image/png',
        fileName: 'replacement.png',
      };

      const serialized = await serializeProject(project);
      const reProject = await parsePlayable(serialized, 'SO_V5_Trung_20241031.html');
      const reImg = reProject.assets.find((a) => a.name === '-707138.png')!;
      expect(Array.from(reImg.original.bytes)).toEqual(Array.from(dummyPng));
    });
  }
});
