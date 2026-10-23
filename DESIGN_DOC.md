# Stunt Driving Web Game — Design Doc

> **This file is a local mirror of the live Claude Doc at:**
> https://claude.ai/artifact/Fw1jqpotpCYQkbynrPSUwP
>
> It's kept in sync with that doc on every session that updates project status —
> if you're an AI picking up this project cold (new chat, context reset, etc.),
> **read this file first.** It has the full design, current build status, and
> what's left. The live doc is the collaborative/comment-capable version; this
> file is the durable, always-on-disk copy that survives a chat's context
> filling up.
>
> Last synced: 2026-10-23 (doc rev 32)
>
> **Game name: "Go-Goated Racing"** — that's the in-game branding (menu logo, page
> title). The repo name (`StuntRush`), the npm package name (`stuntrush`), and this
> doc's own title below are the project's internal/working name and haven't been
> renamed to match; don't assume they're out of sync by mistake if you see both names
> side by side. Renaming the repo would change the live GitHub Pages URL
> (`https://toxinnozaki.github.io/StuntRush/`), so that's a call for the user to make
> explicitly, not something to do as a side effect of a branding pass.

---

## Project Overview & Vision

A browser-based free-roam stunt driving game, built directly off the Madalin Stunt Cars 2 (MSC2) template: an open test-track world of loops, ramps, jumps, and long runways, driven with forgiving arcade car physics and rendered with modern PBR lighting so it reads as genuinely photoreal rather than "game-y" — matching the reference screenshot's look exactly, not a stylized or cartoon take on it.

This build serves two audiences at once:

- **A public stunt driving game** — open a browser tab, no install, no account, drive immediately.
- **A piece hosted on the school's website** — a playable project that has to survive a school's network, content filtering, and device reality (locked-down Chromebooks, no admin install rights) while still looking legitimately good to a teacher or visitor who clicks it cold.

Scope is deliberately a sandbox, not a competitive racer: no lap times, no AI traffic, no damage model for v1. The point is the same thing MSC2 nails — a satisfying car, a loop, a ramp, and a world that invites messing around. Multiplayer here means **shared local presence** (seeing classmates driving the same world at the same time), not global matchmaking or ranked play.

## Platform & Hosting Constraints

Single-player has to work with zero backend: everything — rendering, physics, car logic — runs client-side in one static bundle (HTML/JS/WASM). That bundle gets dropped onto the school site either as a direct page or an iframe embed, and it also needs to run as a standalone link anywhere else (itch.io-style hosting, GitHub Pages, etc.).

Multiplayer is the one feature that genuinely needs something off the page, because browsers can't do raw LAN discovery (no mDNS, no UDP broadcast from JS). "Same wifi" play in practice means: browsers exchange connection info through a small **signaling server**, then the actual car-position traffic flows peer-to-peer over WebRTC — it never has to touch that server again once two players are connected. Two ways to run that signaling piece, both compatible with the same game code:

1. **Self-hosted on a classroom device** (a Raspberry Pi, a teacher's laptop running a one-file Node script) — true LAN-only, works with no internet at all, but someone has to keep that device running.
2. **A tiny free-tier cloud relay** (Cloudflare Workers/Durable Objects, Fly.io, Render free tier) — simpler, nothing to babysit, and still feels exactly like "join your friend next to you" even though the handshake technically goes out to the internet first.

Device reality: assume school Chromebooks — WebGL2 is safe to target, WebGPU is not (inconsistent support). Keyboard input has to be the primary control scheme (arrow keys/WASD), since school machines rarely have gamepads; touch controls are a nice-to-have, not a requirement. No account system, no server-side saves — `localStorage` only, for trivial preferences like car color.

## Core Gameplay Features

**v1 must-haves:**

- Free-roam world with loops, ramps, jumps, runways, and at least one stunt set-piece (half-pipe or corkscrew)
- Arcade car handling: forgiving traction, plus active player-driven air control (see Physics & Vehicle Feel) for deliberate mid-air flips
- Instant reset-to-track button — no fail state, no loading screen, back in seconds
- Chase camera with speed-based FOV kick for a sense of speed
- Full keyboard + mouse control scheme, **rebindable**, tuned equally for laptop play (trackpad-friendly, no gamepad assumed) and desktop play (mouse + keyboard)
- Minimal HUD: speedometer, reset prompt
- 2–3 selectable cars (can reuse one chassis/physics rig with different paint and stats to start)
- Shared multiplayer presence: see other connected players' cars driving the same world in real time

**Explicitly out of scope for v1** (to prevent scope creep):

- Lap timers / leaderboards
- AI traffic or NPCs
- Damage/deformation model
- Deep car customization (tuning, liveries editor)
- Competitive PvP mechanics

These can come later once the core sandbox feels right — MSC2 itself shipped without most of them.

## Visual & Art Direction

The reference screenshot's "retro hyper-realism" comes from PBR shading on simple geometry, not complex models — that's the budget-friendly part of this target look:

- **Car paint**: metallic/roughness PBR material with a clearcoat layer, so body panels pick up real specular highlights and reflect the environment like the reference image
- **Asphalt**: albedo + normal + roughness texture set showing real cracks and wear, tiled across runway/track pieces
- **Lighting**: HDRI environment map driving image-based lighting — this is what makes the car's reflections and the overall light feel "real" rather than flat; matched to that washed-out, overcast-sky look in the reference
- **Shadows**: soft shadow mapping (PCF or cascaded shadow maps) from a single directional light
- **Post-processing stack**: subtle bloom, light color grading, slight vignette — enough to feel finished, not overdone
- **Track geometry**: deliberately simple, modular pieces (the loop, ramps, barriers) — geometry stays cheap so the budget goes into materials and lighting, not polycount

## Physics & Vehicle Feel

Havok's raycast vehicle component: four wheel raycasts with spring/damper suspension, tuned arcade-style rather than simulation-accurate. Specific tuning targets, matching MSC2's forgiving feel:

- Generous tire grip — no realistic slip-angle/traction-loss modeling; sliding is a choice, not an accident
- Soft, forgiving suspension that absorbs hard landings instead of launching the car
- Active, player-driven air control — hold a modifier key (Space or Shift) and use arrow keys or mouse movement to apply angular torque while airborne, letting players deliberately flip, barrel-roll, or spin before landing. This is a direct fix for MSC2's well-known problem: in MSC2, a car's rotation locks the instant it leaves a surface, so once airborne you're a passenger with zero control until you land. GTA V's mid-air vehicle rotation (hold a button, steer with input) is the reference feel here, not MSC2's
- Speed-sensitive steering (tighter at low speed, smoothed out at high speed) to prevent snap spins
- Soft collision response on walls/barriers — glancing hits shouldn't violently flip or stick the car

Dedicated tuning time is budgeted before any art or track content gets built (see Build Phases) — getting this "feel" right first is the single highest-risk, highest-value part of the whole project.

## World & Track Design

One large open test-world (MSC2's "island" approach), built from a small library of reusable modular pieces: straight runway, ramp up, ramp down, full loop, banked turn, half-pipe. Reusing pieces keeps both art effort and draw calls down — the same ramp mesh gets instanced dozens of times across the map instead of hand-built once each.

Practical requirements:

- A boundary/kill-plane so driving off the map edge resets the car instead of free-falling forever
- Collision meshes kept simple (often simpler than the visual mesh) to keep physics cheap
- GPU instancing for every repeated track piece — this is the main lever for keeping frame rate stable on Chromebook-class GPUs
- Layout designed so stunts chain into each other (land off a ramp into a loop, etc.) — the thing that makes MSC2-style free roam actually fun to mess around in

## Multiplayer Architecture

Signaling handshake, then direct peer-to-peer: once two clients exchange connection info through the signaling server, all car-position traffic flows directly between them — the server is never in the data path, which is what keeps this cheap and fast. Authority is client-side: each client trusts the transforms it receives with no server-side validation, which is acceptable because the trust boundary here is "people in the same room," not the open internet. That tradeoff is explicit, not an oversight.

## Tech Stack Summary

| Layer | Choice | Why |
|---|---|---|
| Rendering | Babylon.js (WebGL2) | Best standalone PBR/clearcoat support, Chromebook-safe target |
| Physics | Havok (via Babylon, WASM) | Production-grade raycast vehicle physics, first-party Babylon support |
| Language | TypeScript | Type safety for a project with many moving systems (physics, networking, rendering) |
| Build tool | Vite | Fast dev iteration, simple static production bundle |
| Networking | WebRTC DataChannels + small Node/WebSocket signaling relay | Peer-to-peer car sync after a lightweight handshake; no persistent game server needed |
| Game bundle hosting | Static files (iframe-embeddable, or any static host) | Matches school site reality — no server-side app to maintain |
| Signaling relay hosting | Classroom device (self-hosted) or free-tier cloud (Cloudflare Workers/Durable Objects, Fly.io, Render) | Only piece of infrastructure the project needs at all |
| Asset format | glTF/.glb | Standard, efficient, well-supported by Babylon's loader |
| Version control | Git | Standard |

## Risks, Failure Modes & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| School network blocks the signaling relay's domain/ports | Multiplayer silently fails | Build multiplayer as an optional layer on top of a fully-working single-player game; test from inside the actual school wifi early, not just at home |
| Chromebook-class GPUs can't hold frame rate | Stutter, bad first impression | Aggressive polycount/LOD budget, test on the lowest-spec real device from Phase 0 onward, not at the end |
| Havok WASM blocked by strict CSP or an old ChromeOS version | Physics fails to load entirely | Confirm WASM/SIMD support on the actual target devices early; keep Ammo.js as a documented fallback physics plugin |
| Scope creep toward full racing-sim features | Timeline blowout, nothing ships | Strict phased roadmap; the Core Gameplay Features section is the v1 feature freeze |
| Car physics ends up floaty or too sim-like, missing the MSC2 feel | Core experience falls flat even if everything else works | Dedicated car-feel tuning phase before any art or track content is built (Phase 1) |
| No persistent backend on school static hosting | Can't save progress or leaderboards | Not required for v1 — sandbox game, no accounts; `localStorage` only for trivial prefs |
| School content/privacy review concerns | Deployment blocked or delayed | No chat text input, no accounts, no data collection, no user-generated content — nothing for an IT or privacy review to flag |
| No art team / asset budget | Visuals fall short of the reference look | Lean on PBR materials and lighting (cheap, high-impact) over polycount; small set of free/CC0 or self-modeled low-poly assets |
| School content filter (Lightspeed, etc.) flags or blocks the game's own link | Players can't reach the game from the school network | Filters block by domain/URL, not by association — a block on the game's link can't propagate to or block the school's own site, since they're separate domains. Prefer a direct link over an iframe embed (one URL is easy for IT to allowlist); test the live link from inside school wifi early, same as the signaling relay check |

## Build Phases / Roadmap

Five phases, each gated before the next begins:

| Phase | Name | Focus |
|---|---|---|
| 0 | Prototype | Car feel only |
| — | *gate: feels like MSC2* | |
| 1 | Vertical slice | Loop + PBR look |
| 2 | Full world | Free-roam map |
| 3 | Multiplayer | WebRTC sync |
| — | *gate: runs well on HW* | |
| 4 | Deployment | Test + polish |

Each phase is a gate, not just a step: Phase 0 is pure tech validation on a real target device before a single hour goes into art. Phase 1 exists specifically to answer "does this feel like MSC2 yet?" before any track content gets built around it. Multiplayer is deliberately phase 4 on paper — added on top of a complete single-player game rather than built in from day one — but in practice multiplayer and deployment shipped early (see Status below); that deviation worked out fine because multiplayer was built as a genuinely optional layer, per its own risk mitigation above.

## Open Questions

All six earlier open questions are settled (multiplayer signaling as a settings toggle, GitHub Pages hosting, Chromebook-class target devices confirmed, 4-player session cap, no formal school approval process, Nissan 300ZX as the car model) and folded into the sections above. New ones below, as of the large new asset drop and Phase 2 wrapping up:

- [ ] A large new asset library just landed (pedestrian/character models, a rigged hand, extra car packs, world-building/road/building kits, HDRIs, fonts, car sound packs) at `C:\Users\hu4da\Downloads\Stunt Rush`. How much of this targets v2/backlog versus anything that should go in before v1 ships?
- [ ] Ideas.txt dropped a batch of new feature ideas (flying planes, lightweight traffic AI, a car + map select screen with baked angled-icon renders, a switchable in-game camera — 3rd person / first-person / cinematic, a couple of just-for-fun special cars). Rough priority order for these once v1 ships?
- [ ] A "REA" MCP meant to let Claude reference GTA's files for driving-feel inspiration isn't showing up as connected or available this session — installed under a different name, or should that research path be skipped for now?
- [ ] The new asset folder (several GB of 4K Blender/texture source files) is meant to move into the repo under a new `game assets` folder for organization. Since this repo is public and deployed via GitHub Pages, do you want the raw source files actually committed to git (even if `.gitignore`d from the build), or kept organized locally outside the repo and just referenced from there?

---

## Status — 2026-10-22

Build order deviated from the phased roadmap above: multiplayer and deployment shipped early, ahead of the full free-roam world. Where things stand:

- **Vertical slice (Phase 1): done** — PBR car with clearcoat paint, working brake-reactive head/taillights, one loop, day/night + weather (clear/cloudy/snow) affecting grip
- **Multiplayer (Phase 3): done** — WebRTC full-mesh P2P, up to 4 players, signaling relay deployed on Cloudflare Workers/Durable Objects
- **Deployment (Phase 4): done** — public repo, GitHub Actions auto-builds and redeploys to GitHub Pages on every push
- **Full world (Phase 2): done** — a second ramp-into-loop-into-runway chain, a half-pipe, a kicker jump + landing pad for distance/airtime stunts distinct from the loop ramps, a banked turn closing the main line into an actual circuit instead of a dead-end straight, and a visible boundary wall ring around the whole play area (the kill-plane is now the fallback, not the only edge signal). Could always use more variety later, but it satisfies the doc's checklist item now.
- **Car selection: done, reworked** — 3 performance profiles on the one chassis/physics rig (Stock / Sport / GT — renamed from the original color-coded names), each with a real power-vs-grip stat trade-off. Paint color is **fully decoupled** from the performance pick: a rainbow hue slider (0-359°) on the menu picks any color via HSL (fixed saturation/lightness tuned for glossy paint — see `hueToHex()` in `src/cars.ts`), applied live to the menu preview and carried into gameplay via `settings.bodyColorHue`. Body paint material is `Material.001`, confirmed by raycasting the live rendered body panel with `scene.pick()` rather than guessing from the raw glTF JSON (its baseColor values don't reliably indicate which material is which — `Material.004` looked like a plausible body-paint candidate by color but turned out to be the wheels). Satisfies the v1 checklist's "2-3 selectable cars" item. License plate text customization (`numberplate.001`) is still unbuilt.
- **UI polish**: branded logo (black outline + drop shadow from the original art, with an animated gradient shimmer masked to just the white fill using a second, effects-free export), a boot loading screen, scene fade transitions on Play/return-to-menu, hover/press feedback on every button, Settings panel fades + scales in.
- **Robustness fix**: Havok was stepping physics with the raw variable frame delta, so a multi-second stall (tab backgrounded, a stutter) made it take one gigantic step and could launch the car into orbit. Switched to Havok's fixed internal timestep. Also added a kill-plane for any off-map fall as a second line of defense.
- **New asset dump (not yet integrated)**: a large external asset library landed at `C:\Users\hu4da\Downloads\Stunt Rush` — pedestrian/character models + a rigged hand, several more car packs (incl. a Hellcat and Porsche 911 Turbo with matching sound sets), world-building kits (roads, buildings, bridges, electrical props), PBR ground/wall material sets, HDRIs, and game fonts/logos. Queued for a later pass: move it into the repo under a new `game assets` folder. See Open Questions for scope/organization calls on this.

### v1 status: feature-complete

- **Rebindable controls — done.** A Controls group in Settings lets the player rebind Forward/Back/Left/Right/Air control/Reset/Headlights to any key (click the button, press a key; Escape cancels). Rebinding to a key already in use swaps it with whatever the target action had, so two actions never silently share one key. Persisted in `settings.keyBindings` (`src/settings.ts`), applied live via `InputManager.setBindings()` (`src/input.ts`), with a "Reset to defaults" button. `ArrowUp/Down/Left/Right` are intentionally **not** rebindable — they stay reserved as the fixed GTA-style air-control keys (pitch/roll while airborne) no matter how the drive keys are remapped, and also still work as a secondary drive input per the original "full keyboard scheme" ask. The in-game control hint updates live to reflect the current bindings.

This was the last item on the v1 must-have checklist. Everything is now built: free-roam world, arcade handling + air control, instant reset, chase camera with FOV kick, full world (Phase 2), minimal HUD, car selection, shared multiplayer presence, and rebindable controls.

## Backlog — Future Features (post-v1)

- **Multiplayer text chat** (multiplayer-only — not planned for single-player). Note: the Risks table's privacy mitigation row currently reads "No chat text input... nothing for an IT or privacy review to flag" — adding chat reopens that specific mitigation and needs its own pass (no persistence, basic filtering) before it ships, not just a feature flag.
- **From Ideas.txt (2026-10-22)**: flying planes in the sky; lightweight traffic AI cars; a car + map select screen before Play, with baked angled-icon car renders (angled light source, CAD-render style); a couple of just-for-fun special cars (a PS1-style car, Lightning McQueen) pulled from the new asset dump. (The switchable in-game camera from this list shipped — see below.)

### Shipped post-v1 (2026-10-23)

- **License plate text customization — done.** A "Plate" text field on the menu (up to 8 characters, sanitized/capped in `applyPlateText()` in `src/carModel.ts`) drives a freshly-drawn `DynamicTexture` swapped onto the plate material, live on the menu preview car and carried into gameplay. Turns out the model's front and rear plates share one material instance, so the one texture swap covers both — found by giving the material a bright emissive color and screenshotting the rendered car (same verification method as the body-paint material), not by trusting the glTF material name alone.
- **Switchable camera — done**, from Ideas.txt. Press `C` in gameplay to cycle **Chase** (the original camera) → **Cockpit** (first-person, rigidly mounted — tracks the full chassis orientation including pitch/roll, so it rolls and pitches with every flip, by design) → **Cinematic** (a lower, wider, slower-trailing shot) → back to Chase. The current mode shows in the HUD; resets to Chase on every fresh Play. Lives in `Game.cycleCamera()` / `Game.onCameraModeChanged` (`src/game.ts`), wired to the `KeyC` keydown in `main.ts` — intentionally not part of the Settings → Controls rebind list (that only covers the v1 must-have actions).
- **README.md added** to the repo root: the game, live link, features, controls, tech stack, local dev setup, and a note on asset provenance for anyone who forks it.

## Key implementation facts worth knowing (not in the original doc, learned during the build)

- **The car model's glTF material names are not semantically stable or guessable.** `Material.001` is the body paint, `Material.004` is the wheels — neither can be inferred from the raw glTF JSON's baseColor values reliably. If you need to find a specific surface's material again, raycast the live rendered mesh with `scene.pick(x, y)` and read back `pickResult.pickedMesh.material.name` — don't guess from material names or baseColor alone.
- **Paint color and car choice are two independent settings, not one.** `settings.carId` picks the performance profile (`src/cars.ts` `CARS`); `settings.bodyColorHue` (0-359) picks the color via `hueToHex()`, applied through `VehicleController.setBodyColor()` / `MenuScene.setBodyColor()` — both take a hex string, not a car id. Don't reintroduce a per-car fixed color; the slider is the only color input now.
- **Havok plugin is constructed with `useDeltaForWorldStep: false`** (`src/main.ts`) — fixed internal timestep, not the raw frame delta. Don't change this back without re-adding some other safeguard against frame-hitch physics explosions.
- **Never rotate a physics-enabled mesh via `.rotation.axis = value` in `src/world.ts` — always use `rotationQuaternion` directly (see the `setEulerRotation()` helper).** `createInstance()` inherits whatever `rotationQuaternion` the base mesh had baked in from its own `PhysicsAggregate` creation (Babylon auto-converts a mesh's Euler `.rotation` to a quaternion the first time a physics aggregate is created for it). Any instance created *after* that conversion starts with that same quaternion, and later setting `.rotation.axis` on it does nothing — `rotationQuaternion` wins once it's non-null, silently. This was live and broken in the half-pipe's right wall for a while (leaning the same direction as the left wall) before it got caught by actually reading back world-matrix transforms in the running scene, not by eyeballing a screenshot. If you add a new rotated, physics-enabled piece, use `setEulerRotation()` (or set `rotationQuaternion` directly) — never `.rotation.x/y/z`.
- **GitHub Pages deploy**: public repo required (private repos need a paid plan for Pages). `vite.config.ts` sets `base: "/StuntRush/"` for the subpath; any new asset reference in `index.html` must use `%BASE_URL%` (not a bare `/`) or it'll resolve to the wrong domain root on Pages.
- **The license plate material (`numberplate.001` / mesh `Object_18`) is shared between the front and rear plate geometry** — swapping its `albedoTexture` once (`applyPlateText()` in `src/carModel.ts`) updates both plates, even though only one mesh matches that material name in a `scene.meshes` filter. Don't assume a second plate mesh needs its own texture swap if you ever add one.
- **Keybindings are stored separately from the rest of Settings' flat fields**: `settings.keyBindings` is its own nested object (`src/settings.ts`), merged key-by-key on load (`{ ...DEFAULT_KEY_BINDINGS, ...parsed.keyBindings }`) rather than via the top-level shallow spread — otherwise an old save missing a newly-added action would silently lose every other binding instead of just filling in the gap. If you add a new rebindable action, add it to `KeyBindings` and `DEFAULT_KEY_BINDINGS`, not just the UI.
- Live link: **https://toxinnozaki.github.io/StuntRush/** — auto-updates on every push to `master` via `.github/workflows/deploy.yml`.
