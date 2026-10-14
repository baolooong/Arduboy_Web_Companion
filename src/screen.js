// 128x64 framebuffer -> canvas renderer. The canvas is also the texture
// source for the 3D viewer, so screenCanvas() is exported for that.
import { FRAME_SIZE } from './protocol.js';

const W = 128;
const H = 64;

const canvas = document.getElementById('screen');
const ctx = canvas.getContext('2d', { willReadFrequently: false });
const img = ctx.createImageData(W, H);
const px = img.data;

// Pre-fill alpha; RGB is rewritten per frame.
for (let i = 3; i < px.length; i += 4) px[i] = 255;

export function screenCanvas() {
  return canvas;
}

export function screenRender(buf, seq) {
  if (!buf || buf.length < FRAME_SIZE) return;
  for (let i = 0; i < FRAME_SIZE; i++) {
    const byte = buf[i];
    const x = i % W;
    const yBase = ((i / W) | 0) * 8;
    for (let b = 0; b < 8; b++) {
      const v = byte & (1 << b) ? 255 : 0;
      const o = ((yBase + b) * W + x) * 4;
      px[o] = v;
      px[o + 1] = v;
      px[o + 2] = v;
    }
  }
  ctx.putImageData(img, 0, 0);
}

export function screenClear() {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
}
