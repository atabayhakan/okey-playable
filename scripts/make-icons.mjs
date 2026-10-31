// Makes the app icons of the web build from the store icon: src/pwa/icon-512.png is a copy of
// store/okey-icon-512.png, and src/pwa/icon-192.png is that picture drawn at 192 px by the browser.
//
//   node scripts/make-icons.mjs        (needs Chrome or Edge, and dist-web/ for the little web server)
//
// Run it again only when the store icon changes; the two PNGs are kept in the repository. The icon has the
// felt all the way to the edge and the tiles in the middle 68%, so it can serve as a maskable icon too (a
// launcher that cuts it to a circle or a rounded square leaves the tiles whole).
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, root } from './lib/browser.mjs';

const source = join(root, 'store', 'okey-icon-512.png');
const dir = join(root, 'src', 'pwa');
copyFileSync(source, join(dir, 'icon-512.png'));

const { evaluate, close, finish } = await launch('build:web');
const dataUrl = `data:image/png;base64,${readFileSync(source).toString('base64')}`;
const made = await evaluate(`(async () => {
  const image = new Image();
  image.src = ${JSON.stringify(dataUrl)};
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 192;
  const context = canvas.getContext('2d');
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, 192, 192);
  return canvas.toDataURL('image/png').split(',')[1];
})()`);
writeFileSync(join(dir, 'icon-192.png'), Buffer.from(made, 'base64'));
console.log('src/pwa/icon-192.png and icon-512.png written');
close();
finish(0);
