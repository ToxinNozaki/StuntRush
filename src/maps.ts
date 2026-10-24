export interface MapDef {
  id: string;
  name: string;
  /** Baked static render for the map-select screen (see scripts/bake-thumbnails.mjs). */
  thumbnailUrl?: string;
  flavorText?: string;
}

/** The map list the menu shows. Only "test-track" exists right now. */
export const MAPS: MapDef[] = [
  {
    id: "test-track",
    name: "Test Track",
    thumbnailUrl: `${import.meta.env.BASE_URL}thumbnails/maps/test-track.webp`,
    flavorText: "Loops, ramps, a half-pipe, and open road to mess around on.",
  },
];
