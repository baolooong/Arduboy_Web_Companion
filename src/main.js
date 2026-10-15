// App glue: state machine (off / live / sim), transport routing, stats.
import {
  ProtocolParser,
  buildButtonEvent,
} from './protocol.js';
import {
  serialSupported,
  serialConnect,
  serialDisconnect,
  serialSend,
  serialIsConnected,
} from './serial.js';
import {
  simulatorStart,
  simulatorStop,
  simulatorSend,
  simulatorIsRunning,
} from './simulator.js';
import { screenRender, screenClear, screenCanvas } from './screen.js';
import { initButtons, setRemoteButtons, buttonsClearHeld } from './buttons.js';
import {
  initViewer,
  viewerSetScreenSource,
  viewerSetButtonState,
  viewerSetSize,
} from './viewer3d.js';

// ---- DOM ---------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const statusDot = $('statusDot');
const statusText = $('statusText');
const btnConnect = $('btnConnect');
const btnDisconnect = $('btnDisconnect');
const btnSimulate = $('btnSimulate');
const btnToggle3d = $('btnToggle3d');
const panel3d = $('panel3d');
const fpsEl = $('fps');
const dropsEl = $('drops');
const viewerFallback = $('viewerFallback');

// ---- shared frame/button handlers (used by BOTH transports) ------------
let fpsCount = 0;
let fpsWindowStart = performance.now();
let lastSeq = -1;
let dropCount = 0;

function handleFrame(buf, seq) {
  screenRender(buf, seq);
  // frame rate + dropped-frame detection (seq skips)
  if (lastSeq >= 0 && seq !== (lastSeq + 1) & 0xff) dropCount++;
  lastSeq = seq;
  fpsCount++;
  const now = performance.now();
  if (now - fpsWindowStart >= 1000) {
    fpsEl.textContent = `${fpsCount} fps`;
    if (dropCount > 0) {
      dropsEl.textContent = `丢帧 ${dropCount}`;
      dropsEl.classList.remove('hidden');
    } else {
      dropsEl.classList.add('hidden');
    }
    fpsCount = 0;
    dropCount = 0;
    fpsWindowStart = now;
  }
}

function handleButtons(buttons) {
  setRemoteButtons(buttons);
  viewerSetButtonState(buttons);
}

function handleDeviceInfo(info) {
  if (info) {
    statusText.textContent =
      `已连接 · 协议 v${info.proto} · ${info.chunkSize}B×${info.chunkCount} 块`;
  }
}

// live mode: raw serial bytes flow through the protocol parser
const parser = new ProtocolParser({
  onFrame: handleFrame,
  onButtons: handleButtons,
  onDeviceInfo: handleDeviceInfo,
});

// sim mode: simulator events call the same handlers directly
function handleSimEvent(ev) {
  if (!ev) return;
  if (ev.type === 'frame') handleFrame(ev.buf, ev.seq);
  else if (ev.type === 'buttons') handleButtons(ev.buttons);
  else if (ev.type === 'info') handleDeviceInfo(ev.info);
}

// ---- transport routing ---------------------------------------------------
let mode = 'off'; // 'off' | 'live' | 'sim'
let held = 0; // buttons currently held by the user

function transportSend(data) {
  if (mode === 'live') serialSend(data);
  else if (mode === 'sim') simulatorSend(data);
}

function sendHeldButtons() {
  transportSend(buildButtonEvent(held));
}

// ---- state transitions ----------------------------------------------------
function setMode(next) {
  mode = next;
  btnConnect.disabled = next !== 'off';
  btnDisconnect.disabled = next === 'off';
  btnSimulate.disabled = next !== 'off';
  statusDot.className = 'dot ' + (next === 'live' ? 'on' : next === 'sim' ? 'sim' : 'off');
  fpsEl.textContent = '-- fps';
  lastSeq = -1;
  dropCount = 0;
  if (next === 'off') {
    statusText.textContent = '未连接';
    screenClear();
    buttonsClearHeld();
  }
}

async function doConnect() {
  if (!serialSupported()) {
    statusText.textContent = '此浏览器不支持 Web Serial(请用 Chrome/Edge)';
    return;
  }
  setMode('live');
  statusText.textContent = '请在弹窗中选择设备(Arduboy COM 口)…';
  try {
    await serialConnect((bytes) => {
      if (bytes === null) {
        // device unplugged / port closed
        if (mode === 'live') {
          serialDisconnect();
          setMode('off');
          statusText.textContent = '连接断开';
        }
        return;
      }
      parser.push(bytes);
    });
    statusText.textContent = '已连接';
  } catch (err) {
    setMode('off');
    statusText.textContent = err && err.name === 'NotFoundError'
      ? '未选择设备'
      : `连接失败:${err && err.message ? err.message : err}`;
  }
}

function doDisconnect() {
  if (mode === 'live') serialDisconnect();
  else if (mode === 'sim') simulatorStop();
  held = 0;
  setMode('off');
}

function doSimulate() {
  setMode('sim');
  statusText.textContent = '模拟模式(无硬件)';
  simulatorStart(handleSimEvent);
}

// ---- init ------------------------------------------------------------------
btnConnect.addEventListener('click', doConnect);
btnDisconnect.addEventListener('click', doDisconnect);
btnSimulate.addEventListener('click', doSimulate);

initButtons({
  onPress: (bit) => {
    held |= bit;
    sendHeldButtons();
  },
  onRelease: (bit) => {
    held &= ~bit;
    sendHeldButtons();
  },
});

// 3D viewer: lazy-init behind the toggle, default OFF (no model.glb yet).
let viewerInited = false;

function toggle3d() {
  const on = panel3d.classList.toggle('hidden') === false;
  btnToggle3d.classList.toggle('active', on);
  if (!on) return;
  if (!viewerInited) {
    viewerInited = true;
    initViewer(panel3d, (status) => {
      if (status === 'model-missing') viewerFallback.classList.remove('hidden');
      else viewerFallback.classList.add('hidden');
    });
    viewerSetScreenSource(screenCanvas());
  }
  viewerSetSize();
}

btnToggle3d.addEventListener('click', toggle3d);
window.addEventListener('resize', viewerSetSize);

// If the browser already granted a port earlier, surface it — user still
// clicks Connect to start (a gesture is required to open a port anyway).
if (serialSupported()) statusText.textContent = '未连接 — 点击“连接设备”';
else statusText.textContent = '此浏览器不支持 Web Serial(请用 Chrome/Edge)';
