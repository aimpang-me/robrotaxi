# Vendored three.js

These files are copied unchanged from the npm package `three@0.128.0` (MIT, see
[three-LICENSE.txt](three-LICENSE.txt)), so the 3D page no longer needs a CDN:

- `three.min.js` — `build/three.min.js`
- `OrbitControls.js` — `examples/js/controls/OrbitControls.js` (classic global script, no modules)
- `GLTFLoader.js` — `examples/js/loaders/GLTFLoader.js` (classic global script, no modules)

Keep the r128 versions together: the page uses the pre-module `THREE.*` API and the
`examples/js` addons. Bump all three files and `vendor/three-LICENSE.txt` together.
