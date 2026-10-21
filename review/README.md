# Headless sim harness (simulation review, 2026-10-21)

node build4.js ../index.html > harness_sim_v4.js     # extracts the sim, stubs the DOM, mimics the renderer's position updates
SIMFILE=harness_sim_v4.js N=200 MIN=180 CFGS=shipped,aa,aaFix,fixed node exp4.js > out.json && node show.js ./out.json

Configs: shipped = as the demo runs; aa = no agent in either city (should be ~0 gap); *Fix / fixed = shadow car positions updated too.
build4.js patches by exact string match and fails loudly if the sim code changes. build.js/exp.js are the first-pass versions (no position updates; superseded).
