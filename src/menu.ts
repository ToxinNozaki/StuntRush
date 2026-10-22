import { MAPS } from "./maps";
import { CARS, DEFAULT_CAR_ID } from "./cars";

/** Plain DOM menu overlay: pick a map and car, hit Play. No game content exists until Play is clicked. */
export class MenuUI {
  private readonly menuEl: HTMLElement;
  private readonly listEl: HTMLElement;
  private readonly carListEl: HTMLElement;
  private readonly playButton: HTMLButtonElement;
  private selectedMapId: string | null = null;
  private selectedCarId: string = DEFAULT_CAR_ID;

  onCarChanged: ((carId: string) => void) | null = null;

  constructor(onPlay: (mapId: string, carId: string) => void) {
    this.menuEl = document.getElementById("menu")!;
    this.listEl = document.getElementById("mapList")!;
    this.carListEl = document.getElementById("carList")!;
    this.playButton = document.getElementById("playButton") as HTMLButtonElement;

    for (const map of MAPS) {
      const li = document.createElement("li");
      const button = document.createElement("button");
      button.textContent = map.name;
      button.addEventListener("click", () => this.selectMap(map.id));
      li.appendChild(button);
      this.listEl.appendChild(li);
    }

    for (const car of CARS) {
      const button = document.createElement("button");
      button.textContent = car.name;
      button.dataset.carId = car.id;
      button.addEventListener("click", () => this.selectCar(car.id));
      this.carListEl.appendChild(button);
    }
    this.selectCar(this.selectedCarId);

    this.playButton.addEventListener("click", () => {
      if (this.selectedMapId) onPlay(this.selectedMapId, this.selectedCarId);
    });
  }

  setCar(carId: string) {
    this.selectCar(carId, true);
  }

  private selectMap(mapId: string) {
    this.selectedMapId = mapId;
    this.playButton.disabled = false;
    for (const li of Array.from(this.listEl.children)) {
      const button = li.querySelector("button")!;
      button.classList.toggle("selected", button.textContent === MAPS.find((m) => m.id === mapId)?.name);
    }
  }

  private selectCar(carId: string, silent = false) {
    this.selectedCarId = carId;
    for (const button of Array.from(this.carListEl.children) as HTMLButtonElement[]) {
      button.classList.toggle("selected", button.dataset.carId === carId);
    }
    if (!silent) this.onCarChanged?.(carId);
  }

  show() {
    this.menuEl.classList.remove("hidden");
  }

  hide() {
    this.menuEl.classList.add("hidden");
  }
}
