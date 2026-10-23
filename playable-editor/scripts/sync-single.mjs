import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(__dirname, '../dist-single/index.html');
const dest = path.resolve(__dirname, '../../PlayableEditor.html');

if (fs.existsSync(src)) {
  fs.copyFileSync(src, dest);
  console.log('Synced dist-single/index.html -> ../PlayableEditor.html');
}
