import { playUiClick } from "./audio";

/** The very first screen: logo + Play (into Map Select) + Settings. Map/car picking,
 *  paint/plate customization, and environment toggles live on their own screens now
 *  (see src/screens.ts) — this class only owns the entry panel itself. */
export class EntryScreen {
  private readonly panel: HTMLElement;
  private readonly playButton: HTMLButtonElement;
  private readonly settingsButton: HTMLButtonElement;

  constructor(onPlay: () => void, onSettings: () => void) {
    this.panel = document.getElementById("entryScreen")!;
    this.playButton = document.getElementById("entryPlayButton") as HTMLButtonElement;
    this.settingsButton = document.getElementById("settingsButton") as HTMLButtonElement;

    this.playButton.addEventListener("click", () => {
      void playUiClick();
      onPlay();
    });
    this.settingsButton.addEventListener("click", () => {
      void playUiClick();
      onSettings();
    });
  }

  show() {
    this.panel.classList.remove("hidden");
  }

  hide() {
    this.panel.classList.add("hidden");
  }
}
