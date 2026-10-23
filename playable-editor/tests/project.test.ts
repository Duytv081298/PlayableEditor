import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { parsePlayable, serializeProject } from '../src/lib/project';

import path from 'node:path';
const SAMPLE = process.env.SAMPLE_HTML || path.resolve(__dirname, '../../super-html/static/index.html');

describe('parsePlayable', () => {
  it.skipIf(!fs.existsSync(SAMPLE))('finds assets in super-html sample and round-trips', async () => {
    const html = fs.readFileSync(SAMPLE, 'utf8');
    const p = await parsePlayable(html, 'index.html');
    expect(p.assets.length).toBeGreaterThan(0);
    expect(await serializeProject(p)).toBe(html);
    // replace first image
    const a = p.assets[0];
    a.replacement = { bytes: a.original.bytes, mime: 'image/png', fileName: 'x.png' };
    const out = await serializeProject(p);
    expect(out.length).toBe(html.length);
  });
});
