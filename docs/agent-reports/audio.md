# AUDIO agent report

**Sounds (86 keys, 234 buffers, 3 variations for most):** eight distinct gunshots, each with a close/own stereo version and a distant version: an N-wave blast pulse, a band-shaped crack and sizzle, a gritty gas-expansion body, a short pitch-dropping punch, the action and brass foley, a decorrelated tail and side slap echoes. Also a suppressed shot and a dry-fire click. Reload stages (mag out/in, bolt, pump, shell), weapon switch, ADS rustle, knife swish and hit. Impacts: sand, concrete, metal, ricochet zip, wood, glass, flesh. Bullet whizz, three hitmarker ticks, hurt thuds, heartbeat and breathing loops, body fall. Footsteps for sand, concrete, metal, grate and wood, plus landings and jump gear. Grenade throw and bounce, near and far explosions, shellshock tinnitus. Killstreak, UAV and radio chirps. Wind loop, distant battle, creaks and clanks. A 40 s menu score (3 stems), intro, go, victory, defeat and draw stingers. Seven UI sounds.

**Architecture:** one AudioContext. Weapons, sfx and ambience buses → muffle low-pass (damage, death, shellshock) → pause duck → master → limiter → soft clip (0.95 ceiling) → output, with an analyser for metering. The inner, UI and music buses bypass parts of that chain. The outdoor slap-back convolver and the music hall convolver are built at the context's sample rate. Spatial sounds use an HRTF panner, inverse distance and a distance low-pass. Distant shots switch variant beyond 35 m. Voice cap is 48, stealing by priority minus distance. Synthesis runs in a pool of up to 4 Web Workers pulling from a priority queue, with a time-sliced main-thread fallback. `playUi` creates or resumes the context lazily.

**Measured (headless Chromium, contended 4-core container):** full bank in 1.5–1.9 s wall (1.59 s in a production build), UI sounds ready in about 0.1–0.2 s. Stress peak 0.956 at about −7 dB gain reduction. Pause duck takes the game mix from 0.76 to 0.001. Voice cap held at 48 with 100 simultaneous shots. No DC offset (<1e-4), no end clicks, no console errors. Spectrograms are in `audio/*.png`, and `audio/harness.html` is a standalone test page.

**Fixed from the previous run:** the convolver sample-rate mismatch threw while building the graph, so nothing played. Gunshots were a saturated 50 Hz drone. Generators clicked at cutoff. Voice stealing could go over the cap.

**Known limitations:** no occlusion or indoor reverb zones. No Doppler. No speech for announcements. Verified only structurally: no human has listened.

**CORE REQUESTS:**
1. `src/ui/ui.ts` imports a missing `./ui.css`, so the game doesn't boot on this branch (UI agent).
2. Optional: an `occluded` flag on `weapon:fire` / `actor:footstep`, so through-wall sounds can be muffled.
