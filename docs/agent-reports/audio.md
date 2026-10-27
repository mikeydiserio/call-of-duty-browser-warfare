# AUDIO agent report

**Sounds (86 keys, 234 buffers, mostly 3 variations each):** eight distinct gunshots, each with a close/own stereo version and a distant version: an N-wave blast pulse, a crack and sizzle, a gritty body, a short punch, action and brass foley, and slap echoes. Also suppressed shots and dry fire. Reload stages, weapon switch, ADS, knife. Impacts on sand, concrete, metal, ricochet, wood, glass and flesh, plus whizz and hitmarker ticks. Hurt, heartbeat and breathing, footsteps on five surfaces, landings, jump. Grenade throw, bounce and explosions, shellshock tinnitus. Killstreak, UAV and radio chirps. Wind, distant battle, creaks. Menu score (3 stems) and match stingers. Seven UI sounds.

**Architecture:** one AudioContext. Game buses → damage/death/shellshock muffle → pause duck → master → limiter → soft clip (0.95 ceiling) → output, with an analyser for metering. UI and music bypass the duck. The slap-back and hall convolvers are built at the context's sample rate. Spatial sounds use HRTF, inverse distance and a distance low-pass, and shots switch to the distant variant beyond 35 m. Voice cap is 48, stealing by priority. Synthesis runs in up to 4 Web Workers pulling from a priority queue, with a main-thread fallback. `playUi` unlocks the context lazily.

**Measured (headless Chromium, contended 4-core container):** the full bank renders in 1.5–1.9 s (1.59 s in a production build), and UI sounds are ready in about 0.1–0.2 s. Stress peak is 0.956 at about −7 dB limiting. Pause takes the game mix from 0.76 to 0.001. The cap held at 48 with 100 simultaneous shots. No DC offset, no end clicks, no console errors. Spectrograms are in `audio/*.png`; `audio/harness.html` is the test page.

**Fixed from the previous run:** the convolver rate mismatch meant nothing played. Gunshots were a saturated 50 Hz drone. Generators clicked at cutoff. Voice stealing overran the cap.

**Limitations:** no occlusion or indoor reverb, no Doppler, no speech. Verified only structurally, never listened to.

**CORE REQUESTS:**
1. `src/ui/ui.ts` imports a missing `./ui.css`, so the game doesn't boot on this branch (UI agent).
2. Optional: an `occluded` flag on `weapon:fire` and `actor:footstep` events.
