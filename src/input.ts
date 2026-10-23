import { DEFAULT_KEY_BINDINGS, type KeyBindings } from "./settings";

/**
 * Human-readable label for a KeyboardEvent.code, for the rebind UI. Covers every
 * code reachable via DEFAULT_KEY_BINDINGS plus the common ones a player might
 * press while rebinding; falls back to the raw code for anything unlisted.
 */
export function describeKeyCode(code: string): string {
  const named: Record<string, string> = {
    Space: "Space",
    ShiftLeft: "L Shift",
    ShiftRight: "R Shift",
    ControlLeft: "L Ctrl",
    ControlRight: "R Ctrl",
    AltLeft: "L Alt",
    AltRight: "R Alt",
    ArrowUp: "↑",
    ArrowDown: "↓",
    ArrowLeft: "←",
    ArrowRight: "→",
  };
  if (named[code]) return named[code];
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  return code;
}

/** Tracks raw keyboard + mouse input. Mouse deltas are consumed (read-and-cleared) once per frame. */
export class InputManager {
  private keys = new Set<string>();
  private justPressed = new Set<string>();
  private mouseDX = 0;
  private mouseDY = 0;
  private bindings: KeyBindings = { ...DEFAULT_KEY_BINDINGS };

  constructor() {
    window.addEventListener("keydown", (e) => {
      this.keys.add(e.code);
      if (!e.repeat) this.justPressed.add(e.code);
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("mousemove", (e) => {
      this.mouseDX += e.movementX ?? 0;
      this.mouseDY += e.movementY ?? 0;
    });
    // Losing focus (alt-tab, clicking outside the canvas) must not leave keys "stuck" down.
    window.addEventListener("blur", () => this.keys.clear());
  }

  setBindings(bindings: KeyBindings) {
    this.bindings = bindings;
  }

  isDown(code: string): boolean {
    return this.keys.has(code);
  }

  /** -1..1 forward/back from the rebindable forward/back keys or Up/Down arrows. */
  get throttle(): number {
    const fwd = this.isDown(this.bindings.forward) || this.isDown("ArrowUp") ? 1 : 0;
    const back = this.isDown(this.bindings.back) || this.isDown("ArrowDown") ? 1 : 0;
    return fwd - back;
  }

  /** -1..1 left/right from the rebindable left/right keys or Left/Right arrows. */
  get steer(): number {
    const right = this.isDown(this.bindings.right) || this.isDown("ArrowRight") ? 1 : 0;
    const left = this.isDown(this.bindings.left) || this.isDown("ArrowLeft") ? 1 : 0;
    return right - left;
  }

  get airControlHeld(): boolean {
    return this.isDown(this.bindings.airControl);
  }

  get resetPressed(): boolean {
    return this.isDown(this.bindings.reset);
  }

  /** Once-per-press headlight toggle, using the rebindable headlights key. */
  get headlightsPressed(): boolean {
    return this.consumeKeyPress(this.bindings.headlights);
  }

  /**
   * Pitch input while airborne. Always Up/Down arrows, regardless of forward/back
   * rebinding — this is the dedicated GTA-style air-control scheme, not the drive keys.
   */
  get airPitch(): number {
    const up = this.isDown("ArrowUp") ? 1 : 0;
    const down = this.isDown("ArrowDown") ? 1 : 0;
    return up - down;
  }

  get airRoll(): number {
    const right = this.isDown("ArrowRight") ? 1 : 0;
    const left = this.isDown("ArrowLeft") ? 1 : 0;
    return right - left;
  }

  /** Consumes and clears accumulated mouse movement since the last call. */
  consumeMouseDelta(): { dx: number; dy: number } {
    const d = { dx: this.mouseDX, dy: this.mouseDY };
    this.mouseDX = 0;
    this.mouseDY = 0;
    return d;
  }

  /** True once per actual key press (not held-repeat), then clears itself. */
  consumeKeyPress(code: string): boolean {
    if (this.justPressed.has(code)) {
      this.justPressed.delete(code);
      return true;
    }
    return false;
  }
}
