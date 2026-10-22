# StuntRush — orientation for a fresh session

Read [DESIGN_DOC.md](DESIGN_DOC.md) first, in full, before doing anything else in
this repo. It has the complete design doc, current build status (what's done,
what's left for v1), and hard-won implementation facts (like which glTF
material is actually the body paint) that aren't obvious from the code alone.

Quick orientation:
- This is a Babylon.js + Havok physics stunt driving game (`npm run dev` / `npm run build`).
- Live deployment: https://toxinnozaki.github.io/StuntRush/ — auto-deploys on every push to `master` via GitHub Actions.
- The authoritative, continuously-updated design doc also lives at https://claude.ai/artifact/Fw1jqpotpCYQkbynrPSUwP (a Claude Docs doc); `DESIGN_DOC.md` is kept as a local mirror of it so project status survives a chat's context filling up. When you update one, update the other in the same pass.
