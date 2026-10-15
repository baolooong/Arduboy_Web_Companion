// ============================================================================
// Arduboy Remote — simulator
//
// A fake device that mimics the firmware (RemoteArduboy.cpp) so the UI can be
// developed without hardware. It renders an animated 128x64 1bpp framebuffer
// at 30fps, parses host commands with the same state machine the firmware
// uses, and reports a matching device-info packet.
//
// Events sent to the callback (mirrors ProtocolParser's on* callbacks):
//   { type: 'frame', buf: Uint8Array(1024), seq }   once per tick
//   { type: 'buttons', buttons }                    once per tick
//   { type: 'info', info: { proto, chunkCount, chunkSize, maxRate } }
// ============================================================================

import {
  SYNC, T_BTN_EVENT, T_SET_RATE, T_REQ_INFO,
  CHUNK_COUNT, CHUNK_SIZE, FRAME_SIZE, ALL_BUTTONS, BUTTONS, crc8,
} from './protocol.js';

let cb = null;     // event callback given to simulatorStart
let timer = null;  // setInterval handle
let seq = 0;       // frame sequence number (uint8 rollover, like the firmware)
let tickN = 0;     // monotonic tick counter for animation positions
let buttons = 0;   // simulated device button state (set by host commands)
let rate = 0;      // requested fps (0 = default 30)

// Host-command parser state — mirrors RemoteArduboy::parseByte:
// 0 idle, 1 got sync, 2 got type, 3 got payload (waiting for crc).
let inState = 0, inType = 0, inPayload = 0;

export function simulatorStart(callback) {
  simulatorStop();
  cb = callback;
  seq = 0;
  tickN = 0;
  emitInfo();                    // answer REQ_INFO up front, like the firmware
  timer = setInterval(tick, 33); // 30fps
}

export function simulatorStop() {
  if (timer) clearInterval(timer);
  timer = null;
  cb = null;
}

export function simulatorIsRunning() {
  return !!timer;
}

// Host command bytes — parse exactly like the firmware would.
export function simulatorSend(data) {
  for (const b of data) parseByte(b);
}

function parseByte(b) {
  switch (inState) {
    case 0:
      if (b === SYNC) inState = 1;
      break;
    case 1:
      inType = b;
      if (b === T_REQ_INFO) { emitInfo(); inState = 0; }   // 2-byte packet
      else if (b === T_BTN_EVENT || b === T_SET_RATE) inState = 2;
      else inState = 0;                                    // unknown type
      break;
    case 2:
      inPayload = b;
      inState = 3;
      break;
    case 3: {
      const packet = new Uint8Array([SYNC, inType, inPayload]);
      if (b === crc8(packet)) { // crc covers the first 3 bytes
        if (inType === T_BTN_EVENT) buttons = inPayload & ALL_BUTTONS;
        else if (inType === T_SET_RATE) setRate(inPayload);
      }
      inState = 0;
      break;
    }
  }
}

// 0 = keep the default 30fps (the firmware treats 0 as unthrottled, which a
// setInterval-based simulator can't honour), 1..60 = that many fps.
function setRate(r) {
  rate = r;
  if (!timer) return; // stored; applied on next start
  clearInterval(timer);
  const ms = r ? Math.round(1000 / Math.min(Math.max(r, 1), 60)) : 33;
  timer = setInterval(tick, ms);
}

function emitInfo() {
  if (!cb) return; // T_REQ_INFO arrived before simulatorStart
  cb({
    type: 'info',
    info: { proto: 1, chunkCount: CHUNK_COUNT, chunkSize: CHUNK_SIZE, maxRate: 60 },
  });
}

function tick() {
  const buf = renderFrame(tickN);
  cb({ type: 'frame', buf, seq });
  cb({ type: 'buttons', buttons });
  seq = (seq + 1) & 0xff;
  tickN++;
}

// ---------------------------------------------------------------------------
// Framebuffer drawing (128x64 1bpp, LSB = leftmost pixel of a byte — same
// layout as protocol.js setPixel)
// ---------------------------------------------------------------------------
function setPixel(buf, x, y, on) {
  if (x < 0 || x >= 128 || y < 0 || y >= 64) return;
  const i = (y >> 3) * 128 + x;
  if (on) buf[i] |= 1 << (y & 7);
  else buf[i] &= ~(1 << (y & 7));
}

function fillRect(buf, x, y, w, h) {
  for (let dy = 0; dy < h; dy++)
    for (let dx = 0; dx < w; dx++)
      setPixel(buf, x + dx, y + dy, 1);
}

// 3x5 mini-font for the banner (5 rows of 3 bits, LSB = leftmost column)
const FONT = {
  A: ['111', '101', '111', '101', '101'],
  R: ['110', '101', '110', '101', '101'],
  D: ['110', '101', '101', '101', '110'],
  U: ['101', '101', '101', '101', '111'],
  B: ['110', '101', '110', '101', '110'],
  O: ['111', '101', '101', '101', '111'],
  Y: ['101', '101', '111', '010', '010'],
  S: ['011', '100', '010', '001', '110'],
  I: ['111', '010', '010', '010', '111'],
  M: ['101', '111', '101', '101', '101'],
  ' ': ['000', '000', '000', '000', '000'],
};
const MSG = 'ARDUBOY SIM ';

function renderFrame(t) {
  const buf = new Uint8Array(FRAME_SIZE);

  // Bouncing 4x4 filled square (triangle-wave position).
  const spanX = 128 - 4, spanY = 64 - 4;
  fillRect(buf, Math.abs((t * 2) % (2 * spanX) - spanX),
                 Math.abs((t * 3) % (2 * spanY) - spanY), 4, 4);

  // Scrolling text banner, 1px per tick, wraps around the screen.
  const w = MSG.length * 4; // 3px glyph + 1px spacing
  const x0 = 128 - (t % (128 + w));
  for (let i = 0; i < MSG.length; i++) {
    const g = FONT[MSG[i]];
    for (let row = 0; row < 5; row++)
      for (let col = 0; col < 3; col++)
        if (g[row][col] === '1') setPixel(buf, x0 + i * 4 + col, 2 + row, 1);
  }

  // Live button-state indicator: 6 squares (UP RIGHT LEFT DOWN A B), filled
  // when the bit is set, outlined otherwise. Uses the real Arduboy2 bit values.
  const ORDER = [BUTTONS.UP, BUTTONS.RIGHT, BUTTONS.LEFT, BUTTONS.DOWN, BUTTONS.A, BUTTONS.B];
  for (let i = 0; i < ORDER.length; i++) {
    const on = (buttons & ORDER[i]) !== 0;
    const x = 2 + i * 7, y = 58;
    for (let dy = 0; dy < 4; dy++)
      for (let dx = 0; dx < 4; dx++)
        setPixel(buf, x + dx, y + dy, on || !dx || dx === 3 || !dy || dy === 3);
  }
  return buf;
}
