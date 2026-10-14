// ============================================================================
// Arduboy Remote — wire protocol (single source of truth for web + firmware)
//
// All packets are framed by a sync byte (0xAA). The next byte is the type.
// A CRC-8 (polynomial 0x31, init 0x00, MSB-first, no reflection) covers
// every byte of the packet EXCEPT the crc byte itself. Both ends implement
// the identical algorithm — the check value for "123456789" is 0xA2.
//
// Device -> Host (stream, ~30fps):
//   0xAA 0x01 <seq> <chunkIndex> <chunkCount> <64B payload> <crc>
//       The 1024-byte framebuffer is sent as 16 chunks of 64 bytes.
//       chunkCount is constant (=16); the parser accepts any count so the
//       firmware can later switch to 32x32B chunks without a web update.
//   0xAA 0x02 <buttons> <crc>                       button state (sent once per frame)
//   0xAA 0x20 <protoMajor> <chunkCount> <chunkSize> <maxRate> <crc>
//       device info reply (answer to 0x12)
//
// Host -> Device (commands, low rate):
//   0xAA 0x10 <buttons> <crc>     button event (page sends press + release)
//   0xAA 0x11 <rate>     <crc>    set target frame rate (0 = adaptive, 1..60)
//   0xAA 0x12                     request device info (2 bytes, no crc — tiny)
//
// Button bits (Arduboy2 order — match your board's wiring if different):
//   bit0 = UP, bit1 = RIGHT, bit2 = LEFT, bit3 = DOWN, bit4 = A, bit5 = B
// ============================================================================

export const SYNC = 0xaa;

export const T_FRAME_CHUNK = 0x01; // dev -> host: 64-byte framebuffer chunk
export const T_BTN_STATE = 0x02; // dev -> host: button state
export const T_BTN_EVENT = 0x10; // host -> dev: button press/release
export const T_SET_RATE = 0x11; // host -> dev: target frame rate
export const T_REQ_INFO = 0x12; // host -> dev: request device info
export const T_DEV_INFO = 0x20; // dev -> host: device info reply

export const CHUNK_SIZE = 64; // payload bytes per chunk
export const CHUNK_COUNT = 16; // 1024-byte framebuffer / 64
export const FRAME_SIZE = 1024; // Arduboy 128x64 1bpp framebuffer

export const BUTTONS = {
  UP: 0x01,
  RIGHT: 0x02,
  LEFT: 0x04,
  DOWN: 0x08,
  A: 0x10,
  B: 0x20,
};
export const ALL_BUTTONS = 0x3f;

// ---------------------------------------------------------------------------
// CRC-8: poly 0x31, init 0x00, MSB-first, no reflection. Matches the AVR
// firmware implementation byte-for-byte (check value "123456789" -> 0xA2).
// ---------------------------------------------------------------------------
const CRC8_TABLE = (() => {
  const t = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = c & 0x80 ? ((c << 1) ^ 0x31) & 0xff : (c << 1) & 0xff;
    t[i] = c;
  }
  return t;
})();

export function crc8(bytes, length = bytes.length) {
  let c = 0;
  for (let i = 0; i < length; i++) c = CRC8_TABLE[(c ^ bytes[i]) & 0xff];
  return c;
}

// ---------------------------------------------------------------------------
// Host -> device command builders
// ---------------------------------------------------------------------------
export function buildButtonEvent(buttons) {
  const p = new Uint8Array(4);
  p[0] = SYNC;
  p[1] = T_BTN_EVENT;
  p[2] = buttons & ALL_BUTTONS;
  p[3] = crc8(p, 3);
  return p;
}

export function buildSetRate(rate) {
  const p = new Uint8Array(4);
  p[0] = SYNC;
  p[1] = T_SET_RATE;
  p[2] = rate;
  p[3] = crc8(p, 3);
  return p;
}

export function buildReqInfo() {
  return new Uint8Array([SYNC, T_REQ_INFO]);
}

// ---------------------------------------------------------------------------
// Framebuffer helpers (128x64 monochrome, LSB = leftmost pixel of a byte)
// ---------------------------------------------------------------------------
export function newFrameBuffer() {
  return new Uint8Array(FRAME_SIZE);
}

export function setPixel(buf, x, y, on) {
  if (x < 0 || x >= 128 || y < 0 || y >= 64) return;
  const i = (y >> 3) * 128 + x;
  if (on) buf[i] |= 1 << (y & 7);
  else buf[i] &= ~(1 << (y & 7));
}

// ---------------------------------------------------------------------------
// Stream parser: feed it Uint8Array chunks from the serial ReadableStream
// (a chunk may contain half a packet or several packets). Emits:
//   onFrame(framebuffer: Uint8Array(1024), seq: number)
//   onButtons(buttons: number)        — remote (device-side) button state
//   onDeviceInfo(info: {proto, chunkCount, chunkSize, maxRate})
// ---------------------------------------------------------------------------
export class ProtocolParser {
  constructor({ onFrame, onButtons, onDeviceInfo } = {}) {
    this.onFrame = onFrame || (() => {});
    this.onButtons = onButtons || (() => {});
    this.onDeviceInfo = onDeviceInfo || (() => {});
    this._buf = new Uint8Array(0);
    this._frame = new Uint8Array(FRAME_SIZE);
    this._gotChunk = new Uint8Array(CHUNK_COUNT);
    this._frameSeq = -1;
    this._chunksDone = 0;
    this._chunkCount = CHUNK_COUNT;
    this._crcErrors = 0;
  }

  push(data) {
    // Append and resync. Worst case a packet is split across many serial
    // chunks; the accumulator handles that naturally.
    const merged = new Uint8Array(this._buf.length + data.length);
    merged.set(this._buf);
    merged.set(data, this._buf.length);
    this._buf = merged;

    // Find sync bytes from the last search position onward.
    let pos = 0;
    while (pos < this._buf.length) {
      if (this._buf[pos] !== SYNC) {
        pos++;
        continue;
      }
      const rest = this._buf.length - pos;
      if (rest < 2) break; // need at least type byte
      const type = this._buf[pos + 1];
      let need = 0;
      switch (type) {
        case T_FRAME_CHUNK:
          need = 6 + CHUNK_SIZE; // sync type seq idx count payload64 crc
          break;
        case T_BTN_STATE:
          need = 4; // sync type buttons crc
          break;
        case T_DEV_INFO:
          need = 7; // sync type proto chunkCount chunkSize maxRate crc
          break;
        default:
          // Unknown type — skip one byte and keep scanning (resync).
          pos++;
          continue;
      }
      if (rest < need) break; // wait for more bytes
      const packet = this._buf.subarray(pos, pos + need);
      const expected = packet[need - 1];
      const actual = crc8(packet, need - 1);
      if (expected === actual) {
        this._handle(packet);
      } else {
        this._crcErrors++;
      }
      pos += need;
    }
    this._buf = this._buf.subarray(pos);
  }

  _handle(p) {
    switch (p[1]) {
      case T_FRAME_CHUNK: {
        const seq = p[2];
        const idx = p[3];
        const count = p[4];
        if (count !== this._chunkCount) {
          this._chunkCount = count;
          this._gotChunk = new Uint8Array(count);
          this._frameSeq = -1;
          this._chunksDone = 0;
        }
        if (seq !== this._frameSeq) {
          // New frame — discard whatever was half-assembled.
          this._frameSeq = seq;
          this._gotChunk.fill(0);
          this._chunksDone = 0;
        }
        if (idx < count && !this._gotChunk[idx]) {
          this._frame.set(p.subarray(5, 5 + CHUNK_SIZE), idx * CHUNK_SIZE);
          this._gotChunk[idx] = 1;
          this._chunksDone++;
          if (this._chunksDone === count) {
            this.onFrame(this._frame, seq);
          }
        }
        break;
      }
      case T_BTN_STATE:
        this.onButtons(p[2]);
        break;
      case T_DEV_INFO:
        this.onDeviceInfo({
          proto: p[2],
          chunkCount: p[3],
          chunkSize: p[4],
          maxRate: p[5],
        });
        break;
    }
  }
}
