// Button pad + keyboard. Sends press/release callbacks to main.js, and
// reflects the DEVICE-side button state back onto the pad (highlight).
import { BUTTONS } from './protocol.js';

const BTNS = document.querySelectorAll('.padBtn');

// data-button attr -> protocol bit, and keycode -> bit maps
const BIT_BY_NAME = {
  up: BUTTONS.UP,
  down: BUTTONS.DOWN,
  left: BUTTONS.LEFT,
  right: BUTTONS.RIGHT,
  a: BUTTONS.A,
  b: BUTTONS.B,
};
const BIT_BY_KEY = {
  KeyW: BUTTONS.UP,
  ArrowUp: BUTTONS.UP,
  KeyS: BUTTONS.DOWN,
  ArrowDown: BUTTONS.DOWN,
  KeyA: BUTTONS.LEFT,
  ArrowLeft: BUTTONS.LEFT,
  KeyD: BUTTONS.RIGHT,
  ArrowRight: BUTTONS.RIGHT,
  KeyJ: BUTTONS.A,
  KeyK: BUTTONS.B,
};

let onPress = () => {};
let onRelease = () => {};

function setHeld(bit, held) {
  BTNS.forEach((el) => {
    if (BIT_BY_NAME[el.dataset.button] === bit) el.classList.toggle('held', held);
  });
}

function press(bit) {
  setHeld(bit, true);
  onPress(bit);
}
function release(bit) {
  setHeld(bit, false);
  onRelease(bit);
}

export function initButtons({ onPress: p, onRelease: r } = {}) {
  onPress = p || onPress;
  onRelease = r || onRelease;

  BTNS.forEach((el) => {
    const bit = BIT_BY_NAME[el.dataset.button];
    if (!bit) return;
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      press(bit);
    });
    el.addEventListener('pointerup', () => release(bit));
    el.addEventListener('pointercancel', () => release(bit));
    // touch: prevent context menu long-press
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  });

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    const bit = BIT_BY_KEY[e.code];
    if (bit) {
      e.preventDefault();
      press(bit);
    }
  });
  window.addEventListener('keyup', (e) => {
    const bit = BIT_BY_KEY[e.code];
    if (bit) release(bit);
  });
}

// Reflect the state reported BY the device (what its buttons physically are).
export function setRemoteButtons(buttons) {
  BTNS.forEach((el) => {
    const bit = BIT_BY_NAME[el.dataset.button];
    el.classList.toggle('held', !!(bit && buttons & bit));
  });
}

export function buttonsClearHeld() {
  BTNS.forEach((el) => el.classList.remove('held'));
}
