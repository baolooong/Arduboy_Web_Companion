// ============================================================================
// Arduboy Remote — Web Serial transport
//
// Thin wrapper over the Web Serial API: raw device bytes are pushed through
// onBytes (the caller feeds them to ProtocolParser) and commands are sent
// fire-and-forget. No protocol parsing happens here.
//
// onBytes conventions:
//   onBytes(Uint8Array)  the device sent a chunk of bytes
//   onBytes(null)        the read stream ended while connected (device
//                        unplugged / port lost) — treat as a disconnect
// ============================================================================

import { ProtocolParser, buildButtonEvent, buildSetRate, buildReqInfo } from './protocol.js';

let port = null;   // active SerialPort (null = disconnected)
let reader = null; // reader for the active connection's ReadableStream

export function serialSupported() {
  return !!navigator.serial;
}

// First port the user granted earlier, or null — handy for auto-reconnect.
export function serialGetGrantedPort() {
  if (!serialSupported()) return null;
  const ports = navigator.serial.getPorts();
  return ports.length ? ports[0] : null;
}

export function serialIsConnected() {
  return !!port;
}

export async function serialConnect(onBytes) {
  if (!serialSupported()) {
    throw new Error('Web Serial is not supported in this browser');
  }
  serialDisconnect(); // drop any previous connection first

  let p;
  try {
    p = await navigator.serial.requestPort();
  } catch {
    throw new Error('No device selected (port picker cancelled)');
  }

  try {
    await p.open({ baudRate: 115200 });
  } catch (e) {
    throw new Error(`Could not open the Arduboy port: ${e.message}`);
  }

  port = p;
  try {
    reader = port.readable.getReader();
  } catch (e) {
    port = null;
    throw new Error(`Could not start reading the port: ${e.message}`);
  }
  readLoop(onBytes);          // standalone; ends with onBytes(null) on unplug
  serialSend(buildReqInfo()); // ask the device for its info packet once
}

// Standalone read loop for the current connection. The port and reader are
// pinned so serialDisconnect() can null the module state without breaking an
// in-flight read. When the loop ends while this is still the active
// connection, the device left on its own — report it as a disconnect.
async function readLoop(cb) {
  const p = port;
  const r = reader;
  try {
    while (p.readable) {
      const { value, done } = await r.read();
      if (done) break; // stream closed cleanly
      cb(value);
    }
  } catch {
    // read() rejects on reader.cancel() (user disconnect) and on device
    // unplug; both end the loop, only the latter is reported below.
  }
  if (port === p) cb(null);
}

export function serialDisconnect() {
  if (!port) return; // no-op when not connected
  const p = port;
  port = null;       // first: the read loop's exit check must see the change
  try { reader.cancel(); } catch { /* already closed */ }
  try { reader.releaseLock(); } catch { /* already released */ }
  reader = null;
  try { p.close(); } catch { /* device already gone */ }
}

// Send raw bytes to the device. No-op when disconnected. A one-shot writer
// is used per send; getWriter() throws while another writer holds the lock
// (the writer.locked guard), and the lock is released synchronously so the
// queued chunk still flushes. Errors are swallowed silently — the read
// loop's onBytes(null) is the real error channel.
export function serialSend(data) {
  if (!port || !port.writable) return; // no-op when disconnected
  try {
    const w = port.writable.getWriter(); // throws while the stream is locked
    try {
      w.write(data).catch(() => {}); // unplugged mid-write: silent
    } finally {
      w.releaseLock();
    }
  } catch {
    // stream locked by someone else or already errored — silent no-op
  }
}
