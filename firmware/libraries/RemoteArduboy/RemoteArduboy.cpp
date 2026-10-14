#include "RemoteArduboy.h"

// ---- protocol constants (keep in sync with web/src/protocol.js) -----------
#define R_SYNC      0xAA
#define R_FRAME     0x01   // dev -> host: framebuffer chunk
#define R_BTNSTATE  0x02   // dev -> host: button state
#define R_BTNEVENT  0x10   // host -> dev: button event
#define R_SETRATE   0x11   // host -> dev: target fps
#define R_REQINFO   0x12   // host -> dev: request info
#define R_DEVINFO   0x20   // dev -> host: info reply

#define R_CHUNK     64     // payload bytes per chunk (one 64B USB packet)
#define R_CHUNKS    16     // 1024-byte framebuffer / 64
#define R_PROTO_VER 1

// button bits: match the web side (Arduboy2 order)
#define B_UP    0x01
#define B_RIGHT 0x02
#define B_LEFT  0x04
#define B_DOWN  0x08
#define B_A     0x10
#define B_B     0x20

uint8_t  RemoteArduboy::remote_    = 0;
uint8_t  RemoteArduboy::frameRate_ = 30;
uint8_t  RemoteArduboy::buttonTx_  = 0;
uint32_t RemoteArduboy::lastFrame_ = 0;
uint8_t  RemoteArduboy::seq_       = 0;
uint8_t  RemoteArduboy::inState_   = 0;
uint8_t  RemoteArduboy::inType_    = 0;
uint8_t  RemoteArduboy::inButtons_ = 0;

// CRC-8: poly 0x31, init 0x00, MSB-first, no reflection. Identical to the
// web parser (check value "123456789" -> 0xA2).
static uint8_t crc8Table[256];
static void crcInit() {
  for (uint16_t i = 0; i < 256; i++) {
    uint8_t c = (uint8_t)i;
    for (uint8_t j = 0; j < 8; j++)
      c = (c & 0x80) ? (uint8_t)((c << 1) ^ 0x31) : (uint8_t)(c << 1);
    crc8Table[i] = c;
  }
}
static uint8_t crc8(const uint8_t *p, uint8_t n) {
  uint8_t c = 0;
  while (n--) c = crc8Table[c ^ *p++];
  return c;
}

void RemoteArduboy::begin() {
  crcInit();
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
        if (inType_ == R_BTNEVENT) remote_ = inButtons_;
        else if (inType_ == R_SETRATE) frameRate_ = inButtons_; // 0 = unthrottled
      }
      inState_ = 0;
      break;
    }
  }
}

void RemoteArduboy::pollButtons(Arduboy2 &arduboy) {
  // 1. Physical buttons first (Arduboy2 reads pins + debounce internally).
  arduboy.pollButtons();

  // 2. Merge remote state: physical OR remote, then tell the library about
  //    it. Requires the one-line Arduboy2 patch (see README).
  uint8_t merged = arduboy.buttonsState() | remote_;
#if defined(ARDUBOY2_BUTTON_STATE_ACCESSIBLE)
  arduboy.setButtonState(merged);
#endif
  buttonTx_ = merged;   // sent with the next frame
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
  // 5-byte header + 64-byte payload + crc must fit in the CDC TX buffer,
  // otherwise the write would busy-wait and freeze the game.
  if ((size_t)Serial.availableForWrite() < R_CHUNK + 6) return false;

  const uint8_t head[5] = { R_SYNC, R_FRAME, seq, idx, count };
  uint8_t crc = crc8(head, 5);
  for (uint8_t i = 0; i < R_CHUNK; i++) crc = crc8Table[crc ^ p[i]];
  Serial.write(head, 5);
  Serial.write(p, R_CHUNK);
  Serial.write(crc);
  return true;
}

void RemoteArduboy::sendInfo() {
  const uint8_t pkt[6] = { R_SYNC, R_DEVINFO, R_PROTO_VER, R_CHUNKS, R_CHUNK, 60 };
  Serial.write(pkt, 6);
  Serial.write(crc8(pkt, 6));
}
