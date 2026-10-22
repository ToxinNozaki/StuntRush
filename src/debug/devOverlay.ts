import * as BABYLON from "@babylonjs/core";
import { errorLogger } from "./errorLogger";

export interface VehicleTelemetry {
  speedKph: number;
  isAirborne: boolean;
  position: BABYLON.Vector3;
}

/**
 * Press ` (backquote) during dev to pull this up: a quick-glance readout of the
 * whole scene (mesh/body counts, vehicle state) plus the last few log lines, and
 * a button into Babylon's full Inspector for the real deep dive — scene graph,
 * every transform, every physics body, click any object to see its exact position.
 * Not meant for players; nothing here is reachable from the normal game UI.
 */
export class DevOverlay {
  private readonly panel: HTMLDivElement;
  private readonly logEl: HTMLDivElement;
  private readonly statsEl: HTMLDivElement;
  private visible = false;
  private inspectorLoaded = false;

  constructor(
    private readonly engine: BABYLON.Engine,
    private readonly scene: BABYLON.Scene,
    private readonly getVehicleTelemetry: () => VehicleTelemetry | null
  ) {
    this.panel = document.createElement("div");
    this.panel.id = "devOverlay";
    this.panel.style.cssText = `
      position: fixed; bottom: 12px; left: 12px; width: 340px; max-height: 70vh;
      background: rgba(10,10,12,0.92); color: #ddd; font: 11px/1.4 monospace;
      border: 1px solid #444; padding: 10px; z-index: 9999; overflow-y: auto;
      display: none; white-space: pre-wrap;
    `;
    document.body.appendChild(this.panel);

    const title = document.createElement("div");
    title.textContent = "DEV — ` to toggle";
    title.style.cssText = "opacity:0.6; margin-bottom:6px;";
    this.panel.appendChild(title);

    this.statsEl = document.createElement("div");
    this.statsEl.style.marginBottom = "8px";
    this.panel.appendChild(this.statsEl);

    const buttonRow = document.createElement("div");
    buttonRow.style.cssText = "display:flex; gap:6px; margin-bottom:8px;";
    buttonRow.appendChild(this.makeButton("Full Inspector", () => this.openInspector()));
    buttonRow.appendChild(this.makeButton("Copy Log", () => this.copyLog()));
    buttonRow.appendChild(this.makeButton("Clear Log", () => errorLogger.clear()));
    this.panel.appendChild(buttonRow);

    const logTitle = document.createElement("div");
    logTitle.textContent = "recent log:";
    logTitle.style.cssText = "opacity:0.6; margin-bottom:4px;";
    this.panel.appendChild(logTitle);

    this.logEl = document.createElement("div");
    this.panel.appendChild(this.logEl);

    window.addEventListener("keydown", (e) => {
      if (e.code === "Backquote") this.toggle();
    });

    errorLogger.onEntry(() => {
      if (this.visible) this.renderLog();
    });

    scene.onBeforeRenderObservable.add(() => {
      if (this.visible) this.renderStats();
    });
  }

  private makeButton(label: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.textContent = label;
    btn.style.cssText = "flex:1; padding:4px; font:11px monospace; background:#222; color:#ccc; border:1px solid #555; cursor:pointer;";
    btn.addEventListener("click", onClick);
    return btn;
  }

  private toggle() {
    this.visible = !this.visible;
    this.panel.style.display = this.visible ? "block" : "none";
    if (this.visible) {
      this.renderStats();
      this.renderLog();
    }
  }

  private renderStats() {
    const telemetry = this.getVehicleTelemetry();
    const bodyCount = this.scene.meshes.filter((m) => (m as BABYLON.Mesh).physicsBody).length;
    const lines = [
      `FPS: ${this.engine.getFps().toFixed(0)}`,
      `meshes: ${this.scene.meshes.length}  physics bodies: ${bodyCount}`,
      `lights: ${this.scene.lights.length}  materials: ${this.scene.materials.length}`,
    ];
    if (telemetry) {
      const p = telemetry.position;
      lines.push(
        `car: ${telemetry.speedKph.toFixed(1)} kph  ${telemetry.isAirborne ? "airborne" : "grounded"}`,
        `pos: (${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)})`
      );
    } else {
      lines.push("car: not loaded");
    }
    this.statsEl.textContent = lines.join("\n");
  }

  private renderLog() {
    const entries = errorLogger.getAll().slice(-6);
    this.logEl.innerHTML = "";
    for (const entry of entries) {
      const line = document.createElement("div");
      const color = entry.level === "error" ? "#f66" : entry.level === "warn" ? "#fc6" : "#9c9";
      const time = new Date(entry.time).toLocaleTimeString();
      line.style.color = color;
      line.style.marginBottom = "3px";
      line.textContent = `[${time}] ${entry.message.slice(0, 200)}`;
      this.logEl.appendChild(line);
    }
    if (entries.length === 0) {
      this.logEl.textContent = "(nothing logged yet)";
    }
  }

  private async openInspector() {
    if (!this.inspectorLoaded) {
      await import("@babylonjs/inspector");
      this.inspectorLoaded = true;
    }
    if (this.scene.debugLayer.isVisible()) {
      this.scene.debugLayer.hide();
    } else {
      void this.scene.debugLayer.show({ embedMode: true, overlay: true });
    }
  }

  private async copyLog() {
    try {
      await navigator.clipboard.writeText(errorLogger.exportAsText());
    } catch {
      // Clipboard permission denied: nothing to do here, the log is still on screen.
    }
  }
}
