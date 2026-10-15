#include "RemoteArduboy.h"

#include <avr/pgmspace.h>

// ---- protocol constants (keep in sync with web/src/protocol.js) -----------
#define R_SYNC      0xAA
#define R_FRAME     0x01   // dev -> host: framebuffer chunk
#define R_BTNSTATE  0x02   // dev -> host: button state
#define R_BTNEVENT  0x10   // host -> dev: button event
#define R_SETRATE   0x11   // host -> dev: target fps
#define R_REQINFO   0x12   // host -> dev: request info
#define R_DEVINFO   0x20   // dev -> host: info reply

#define R_CHUNK     64     // payload per chunk: exactly one 64-byte USB packet
#define R_CHUNKS    16     // 1024-byte framebuffer / 64
#define R_PROTO_VER 1

// Button bits are Arduboy2's native values (Arduboy2Core.h), NOT our own:
//   UP=0x80 RIGHT=0x40 LEFT=0x20 DOWN=0x10 A=0x08 B=0x04  (bits 7..2)
// We pass the byte straight through on both directions and let Arduboy2's
// own *_BUTTON constants (and the web's BUTTONS map) do the interpretation.

uint8_t  RemoteArduboy::remote_    = 0;
uint8_t  RemoteArduboy::frameRate_ = 30;
uint8_t  RemoteArduboy::buttonTx_  = 0;
uint32_t RemoteArduboy::lastFrame_ = 0;
uint8_t  RemoteArduboy::seq_       = 0;
uint8_t  RemoteArduboy::inState_   = 0;
uint8_t  RemoteArduboy::inType_    = 0;
uint8_t  RemoteArduboy::inButtons_ = 0;

// CRC-8: poly 0x31, init 0x00, MSB-first, no reflection. Identical to the
// web parser (check value "123456789" -> 0xA2). We use a 16-entry nibble
// table (two 4-bit lookups per byte) instead of the classic 256-entry table:
// the result is byte-for-byte identical, but the table costs 16 bytes of
// flash instead of 256. The 32U4 has only ~28KB of flash and big games like
// Catacombs of the Damned sit right at the limit, so every byte counts.
static const uint8_t crc8Table[] PROGMEM = {
  0x00, 0x31, 0x62, 0x53, 0xc4, 0xf5, 0xa6, 0x97,
  0xb9, 0x88, 0xdb, 0xea, 0x7d, 0x4c, 0x1f, 0x2e
};

// Advance the CRC by 4 data bits (one nibble).
static uint8_t crc8Step(uint8_t crc, uint8_t nibble) {
  return (uint8_t)(((crc << 4) & 0xff) ^ pgm_read_byte(&crc8Table[((crc >> 4) ^ nibble) & 0x0f]));
}

// Advance the CRC by a full byte (high nibble, then low nibble).
static uint8_t crc8Update(uint8_t crc, uint8_t b) {
  crc = crc8Step(crc, b >> 4);
  crc = crc8Step(crc, b & 0x0f);
  return crc;
}

static uint8_t crc8(const uint8_t *p, uint8_t n) {
  uint8_t c = 0;
  while (n--) c = crc8Update(c, *p++);
  return c;
}

void RemoteArduboy::begin() {
  Serial.begin(115200);   // baud is nominal for native USB CDC; real speed is
                          // set by the USB bus and by host-side reads.
  // NOTE: we deliberately do NOT wait for the host here — the device must
  // keep working standalone when the web page is not open. sendFrame()
  // guards with `if (!Serial)` and is a no-op until the host connects.
}

void RemoteArduboy::update() {
  while (Serial.available()) parseByte((uint8_t)Serial.read());
}

// Host commands are tiny fixed-size packets, parsed with a 4-state machine.
// State 0=idle, 1=got sync, 2=got type, 3=got payload (waiting crc).
void RemoteArduboy::parseByte(uint8_t b) {
  switch (inState_) {
    case 0:
      if (b == R_SYNC) inState_ = 1;
      break;
    case 1:
      inType_ = b;
      if (b == R_REQINFO) { sendInfo(); inState_ = 0; }   // 2-byte packet
      else if (b == R_BTNEVENT || b == R_SETRATE) inState_ = 2;
      else inState_ = 0;                                  // unknown type
      break;
    case 2:
      inButtons_ = b;
      inState_ = 3;
      break;
    case 3: {
      const uint8_t packet[3] = { R_SYNC, inType_, inButtons_ };
      if (b == crc8(packet, 3)) {
        if (inType_ == R_BTNEVENT) {
          remote_ = inButtons_;
          // Publish into the core so buttonsState() (which pressed()/anyPressed()
          // read directly) sees the remote overlay. See the Arduboy2Core patch.
          Arduboy2Core::remoteButtonsState = inButtons_;
        }
        else if (inType_ == R_SETRATE) frameRate_ = inButtons_; // 0 = unthrottled
      }
      inState_ = 0;
      break;
    }
  }
}

void RemoteArduboy::pollButtons(Arduboy2 &arduboy) {
  // The remote overlay lives in Arduboy2Core::remoteButtonsState, which
  // buttonsState() ORs into the physical pin state. Because pressed(),
  // anyPressed(), notPressed() AND pollButtons() all read through
  // buttonsState(), one pollButtons() call below makes currentButtonState
  // come out already merged (physical | remote). That merged value is what
  // justPressed()/justReleased() then use for edge detection, and what we
  // echo back to the host for the on-screen pad.
  arduboy.pollButtons();
  buttonTx_ = arduboy.currentButtonState;
}

void RemoteArduboy::sendFrame() {
  if (!Serial) return;                    // host closed the port
  uint32_t now = millis();
  if (frameRate_ && now - lastFrame_ < 1000UL / frameRate_) return; // throttle
  lastFrame_ = now;

  const uint8_t *fb = Arduboy2::sBuffer;

  // Chunked send. Each chunk carries its own sequence/count so the host can
  // reassemble and detect frame boundaries. sendChunk never blocks: if the
  // USB endpoint buffer can't take a full chunk right now the rest of this
  // frame is dropped — a busy host can never stall the game.
  for (uint8_t i = 0; i < R_CHUNKS; i++) {
    if (!sendChunk(seq_, i, R_CHUNKS, fb + i * R_CHUNK)) return;
  }
  seq_++;

  // Button state rides along once per frame (4-byte packet).
  const uint8_t st[3] = { R_SYNC, R_BTNSTATE, buttonTx_ };
  Serial.write(st, 3);
  Serial.write(crc8(st, 3));
}

bool RemoteArduboy::sendChunk(uint8_t seq, uint8_t idx, uint8_t count, const uint8_t *p) {
  // 5-byte header + 64-byte payload + crc = 70 bytes contiguous on the wire.
  // The 32U4 CDC TX is a 64-byte FIFO flushed every 1ms by the SOF interrupt
  // (USB_Flush in ISR(USB_GEN_vect), USBCore.cpp). A full 64-byte payload
  // self-releases; the trailing 6 bytes flush on the next SOF. Serial.write()
  // therefore paces at ~64 bytes/ms — ~1ms per chunk, 16ms per frame, no
  // explicit pacing needed. If the FIFO is already full (host not reading)
  // we drop the frame instead of letting write() busy-wait and stall the game.
  if (Serial.availableForWrite() == 0) return false;

  const uint8_t head[5] = { R_SYNC, R_FRAME, seq, idx, count };
  uint8_t c = crc8(head, 5);
  for (uint8_t i = 0; i < R_CHUNK; i++) c = crc8Update(c, p[i]);
  Serial.write(head, 5);
  Serial.write(p, R_CHUNK);
  Serial.write(c);
  return true;
}

void RemoteArduboy::sendInfo() {
  const uint8_t pkt[6] = { R_SYNC, R_DEVINFO, R_PROTO_VER, R_CHUNKS, R_CHUNK, 60 };
  Serial.write(pkt, 6);
  Serial.write(crc8(pkt, 6));
}
