import { MAPS } from "./maps";

/** Plain DOM menu overlay: pick a map, hit Play. No game content exists until Play is clicked. */
export class MenuUI {
  private readonly menuEl: HTMLElement;
  private readonly listEl: HTMLElement;
  private readonly playButton: HTMLButtonElement;
  private selectedMapId: string | null = null;

  constructor(onPlay: (mapId: string) => void) {
    this.menuEl = document.getElementById("menu")!;
    this.listEl = document.getElementById("mapList")!;
    this.playButton = document.getElementById("playButton") as HTMLButtonElement;

    for (const map of MAPS) {
      const li = document.createElement("li");
      const button = document.createElement("button");
      button.textContent = map.name;
      button.addEventListener("click", () => this.select(map.id));
      li.appendChild(button);
      this.listEl.appendChild(li);
    }

    this.playButton.addEventListener("click", () => {
      if (this.selectedMapId) onPlay(this.selectedMapId);
    });
  }

  private select(mapId: string) {
    this.selectedMapId = mapId;
    this.playButton.disabled = false;
    for (const li of Array.from(this.listEl.children)) {
      const button = li.querySelector("button")!;
      button.classList.toggle("selected", button.textContent === MAPS.find((m) => m.id === mapId)?.name);
    }
  }

  show() {
    this.menuEl.classList.remove("hidden");
  }

  hide() {
    this.menuEl.classList.add("hidden");
  }
}
