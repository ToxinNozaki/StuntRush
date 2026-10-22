/** Tracks raw keyboard + mouse input. Mouse deltas are consumed (read-and-cleared) once per frame. */
export class InputManager {
  private keys = new Set<string>();
  private justPressed = new Set<string>();
  private mouseDX = 0;
  private mouseDY = 0;

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

  isDown(code: string): boolean {
    return this.keys.has(code);
  }

  /** -1..1 forward/back from W/S or Up/Down. */
  get throttle(): number {
    const fwd = this.isDown("KeyW") || this.isDown("ArrowUp") ? 1 : 0;
    const back = this.isDown("KeyS") || this.isDown("ArrowDown") ? 1 : 0;
    return fwd - back;
  }

  /** -1..1 left/right from A/D or Left/Right. */
  get steer(): number {
    const right = this.isDown("KeyD") || this.isDown("ArrowRight") ? 1 : 0;
    const left = this.isDown("KeyA") || this.isDown("ArrowLeft") ? 1 : 0;
    return right - left;
  }

  get airControlHeld(): boolean {
    return this.isDown("Space");
  }

  get resetPressed(): boolean {
    return this.isDown("KeyR");
  }

  /** Pitch input while airborne: Up/Down (W/S reserved for throttle, so arrows only). */
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
