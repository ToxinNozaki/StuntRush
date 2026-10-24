import { MAPS, type MapDef } from "./maps";
import { CARS, DEFAULT_CAR_ID, type CarSpec } from "./cars";
import { playUiClick } from "./audio";

/** One tile per map/car, each a baked thumbnail image (falls back to a plain colored
 *  tile if thumbnailUrl is missing — only matters for a future map with no bake yet)
 *  in a horizontal filmstrip rather than a generic centered card grid, per the racing-
 *  game UI research this project did before building these screens (Forza/GT-style
 *  car-select carousels read less "default template" than an evenly-gapped grid). */
function buildTile(imgUrl: string | undefined, extraClass: string): HTMLDivElement {
  const tile = document.createElement("div");
  tile.className = `thumbTile ${extraClass}`;
  const img = document.createElement("img");
  img.src = imgUrl ?? "";
  img.alt = "";
  tile.appendChild(img);
  return tile;
}

/** Map Select: a filmstrip of track tiles (just one today — Test Track — built to
 *  support more without rework) plus the time-of-day/weather/multiplayer toggles that
 *  used to live in the single all-in-one menu panel. */
export class MapSelectScreen {
  private readonly panel: HTMLElement;
  private readonly listEl: HTMLElement;
  private readonly flavorEl: HTMLElement;
  private readonly nextButton: HTMLButtonElement;
  private readonly backButton: HTMLButtonElement;
  private selectedMapId: string | null = null;

  onNext: ((mapId: string) => void) | null = null;
  onBack: (() => void) | null = null;

  constructor() {
    this.panel = document.getElementById("mapSelect")!;
    this.listEl = document.getElementById("mapList")!;
    this.flavorEl = document.getElementById("mapFlavorText")!;
    this.nextButton = document.getElementById("mapSelectNext") as HTMLButtonElement;
    this.backButton = document.getElementById("mapSelectBack") as HTMLButtonElement;

    for (const map of MAPS) {
      const tile = buildTile(map.thumbnailUrl, "mapTile");
      const label = document.createElement("div");
      label.className = "thumbLabel";
      label.innerHTML = `<span>${map.name}</span>`;
      tile.appendChild(label);
      tile.addEventListener("click", () => {
        void playUiClick();
        this.select(map);
      });
      this.listEl.appendChild(tile);
    }
    if (MAPS.length > 0) this.select(MAPS[0]);

    this.nextButton.addEventListener("click", () => {
      void playUiClick();
      if (this.selectedMapId) this.onNext?.(this.selectedMapId);
    });
    this.backButton.addEventListener("click", () => {
      void playUiClick();
      this.onBack?.();
    });
  }

  private select(map: MapDef) {
    this.selectedMapId = map.id;
    this.flavorEl.textContent = map.flavorText ?? "";
    this.nextButton.disabled = false;
    for (const tile of Array.from(this.listEl.children) as HTMLElement[]) {
      const name = tile.querySelector(".thumbLabel span")?.textContent;
      tile.classList.toggle("selected", name === map.name);
    }
  }

  show(direction: "forward" | "back") {
    this.panel.classList.remove("hidden");
    this.panel.classList.remove("entering-forward", "entering-back");
    void this.panel.offsetWidth; // restart the animation
    this.panel.classList.add(direction === "forward" ? "entering-forward" : "entering-back");
  }

  hide() {
    this.panel.classList.add("hidden");
  }
}

/** Car Select: a filmstrip of car tiles, each showing an animated power/grip stat-bar
 *  reveal when selected (filled bars, not a static number — same "feels like a choice"
 *  reasoning as the map select flavor text) plus the paint/plate customization that
 *  used to live in the single all-in-one menu panel. The live MenuScene turntable
 *  (shown behind every screen) still does the actual "watch it move" job — this
 *  filmstrip is the lightweight selector, not six simultaneous live previews. */
export class CarSelectScreen {
  private readonly panel: HTMLElement;
  private readonly listEl: HTMLElement;
  private readonly backButton: HTMLButtonElement;
  private selectedCarId: string = DEFAULT_CAR_ID;

  onCarChanged: ((carId: string) => void) | null = null;
  onBack: (() => void) | null = null;

  constructor() {
    this.panel = document.getElementById("carSelect")!;
    this.listEl = document.getElementById("carList")!;
    this.backButton = document.getElementById("carSelectBack") as HTMLButtonElement;

    const maxPower = Math.max(...CARS.map((c) => c.enginePowerMultiplier));
    const maxGrip = Math.max(...CARS.map((c) => c.gripMultiplier));

    for (const car of CARS) {
      const tile = buildTile(car.thumbnailUrl, "carTile");
      tile.dataset.carId = car.id;
      const label = document.createElement("div");
      label.className = "thumbLabel";
      label.innerHTML = `<span>${car.name}</span>`;
      tile.appendChild(label);
      tile.appendChild(this.buildStatBars(car, maxPower, maxGrip));
      tile.addEventListener("click", () => {
        void playUiClick();
        this.select(car.id);
      });
      this.listEl.appendChild(tile);
    }
    this.select(this.selectedCarId, true);

    this.backButton.addEventListener("click", () => {
      void playUiClick();
      this.onBack?.();
    });
  }

  private buildStatBars(car: CarSpec, maxPower: number, maxGrip: number): HTMLDivElement {
    const wrap = document.createElement("div");
    wrap.className = "statBars";
    const rows: [string, number][] = [
      ["PWR", car.enginePowerMultiplier / maxPower],
      ["GRIP", car.gripMultiplier / maxGrip],
    ];
    for (const [name, frac] of rows) {
      const row = document.createElement("div");
      row.className = "statBarRow";
      const nameEl = document.createElement("span");
      nameEl.className = "statName";
      nameEl.textContent = name;
      const track = document.createElement("div");
      track.className = "statBarTrack";
      const fill = document.createElement("div");
      fill.className = "statBarFill";
      track.appendChild(fill);
      row.append(nameEl, track);
      wrap.appendChild(row);
      // The target width lives in a data attribute, not read back from .style.width —
      // select() below needs it before this element's own first rAF has necessarily
      // run (it's selected synchronously, in the same task, as soon as the car list
      // finishes building), so reading the live style here would race and often see
      // the pre-animation empty string instead of the real value.
      fill.dataset.targetWidth = `${frac * 100}%`;
    }
    return wrap;
  }

  /** Called every time this tile becomes the selected one, including the initial
   *  default selection — re-triggers the stat-bar fill animation each time. */
  private select(carId: string, silent = false) {
    this.selectedCarId = carId;
    for (const tile of Array.from(this.listEl.children) as HTMLElement[]) {
      const isSelected = tile.dataset.carId === carId;
      tile.classList.toggle("selected", isSelected);
      if (isSelected) {
        for (const fill of Array.from(tile.querySelectorAll<HTMLElement>(".statBarFill"))) {
          const width = fill.dataset.targetWidth ?? "0%";
          fill.style.width = "0%";
          requestAnimationFrame(() => requestAnimationFrame(() => (fill.style.width = width)));
        }
      }
    }
    if (!silent) this.onCarChanged?.(carId);
  }

  setCar(carId: string) {
    this.select(carId, true);
  }

  getSelectedCarId(): string {
    return this.selectedCarId;
  }

  show(direction: "forward" | "back") {
    this.panel.classList.remove("hidden");
    this.panel.classList.remove("entering-forward", "entering-back");
    void this.panel.offsetWidth;
    this.panel.classList.add(direction === "forward" ? "entering-forward" : "entering-back");
  }

  hide() {
    this.panel.classList.add("hidden");
  }
}
