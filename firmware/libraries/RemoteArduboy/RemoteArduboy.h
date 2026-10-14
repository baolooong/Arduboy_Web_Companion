#ifndef REMOTE_ARDUBOY_H
#define REMOTE_ARDUBOY_H

#include <Arduino.h>
#include <Arduboy2.h>

// ============================================================================
// RemoteArduboy — stream the screen to a browser over USB CDC and inject
// button presses received from it. Designed to touch game code as little as
// possible: 3 lines per game (begin / poll / sendFrame).
//
// Requires a tiny patch to Arduboy2.h (one line) so the internal button
// state can be merged — see README.md in this library for the exact edit.
// ============================================================================

class RemoteArduboy {
  public:
    // Call once in setup() after arduboy.begin().
    // Enables the serial receiver; streams nothing until the host opens the
    // port (DTR), so a disconnected cable has zero effect on the game.
    static void begin();

    // Call from loop() where the game is running (idle logic etc.).
    // Parses any buffered host commands — call it every frame; it is O(1).
    static void update();

    // Button polling with remote merge. Use INSTEAD of arduboy.pollButtons():
    //    RemoteArduboy::pollButtons(arduboy);
    // Then arduboy.pressed(), arduboy.justPressed(), arduboy.buttonsState()
    // behave as if the remote buttons were physically pressed.
    static void pollButtons(Arduboy2 &arduboy);

    // Call right AFTER arduboy.display() once per frame.
    // Streams the framebuffer + button state to the host, non-blocking:
    // if the USB buffer is full the frame is silently dropped — a busy USB
    // can never stall the game.
    static void sendFrame();

    // Remote button state as last received from the host (pre-merge).
    static uint8_t remoteButtons() { return remote_; }

  private:
    static void parseByte(uint8_t b);
    static void sendInfo();
    static bool sendChunk(uint8_t seq, uint8_t idx, uint8_t count, const uint8_t *p);

    static uint8_t remote_;      // buttons latched from host commands
    static uint8_t frameRate_;   // target fps (0 = adaptive / unthrottled)
    static uint8_t buttonTx_;    // last merged button state (sent per frame)
    static uint32_t lastFrame_;  // millis() of last sent frame
    static uint8_t seq_;         // rolling frame sequence number
    static uint8_t inState_;     // rx command state machine
    static uint8_t inType_;      // rx: command type byte
    static uint8_t inButtons_;   // rx: latched payload byte
};

#endif
