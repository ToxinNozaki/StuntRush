export interface MapDef {
  id: string;
  name: string;
  /** Baked static render for the map-select screen (see scripts/bake-thumbnails.mjs). */
  thumbnailUrl?: string;
  flavorText?: string;
}

/** The map list the menu shows. */
export const MAPS: MapDef[] = [
  {
    id: "test-track",
    name: "Test Track",
    thumbnailUrl: `${import.meta.env.BASE_URL}thumbnails/maps/test-track.webp`,
    flavorText: "Loops, ramps, a half-pipe, and open road to mess around on.",
  },
  {
    id: "city",
    name: "Downtown",
    // No baked thumbnail yet — buildTile() in screens.ts already falls back to
    // a plain tile when thumbnailUrl is missing, exactly the case this comment
    // in that file called out as "only matters for a future map with no bake yet".
    flavorText: "A 3x3 city grid to cruise — no ramps or loops, just the streets.",
  },
];
