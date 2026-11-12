# Browser dependencies

Vendored assets are served locally. Updating them does not require a frontend build.

- Fabric.js: [cdnjs 5.3.1 distribution](https://cdnjs.cloudflare.com/ajax/libs/fabric.js/5.3.1/fabric.min.js).
  The embedded `fabric.version` identifies this distribution as 5.3.0.
  License: `fabric.LICENSE` (MIT).

After updating Fabric.js, run the browser tests, especially sticky-note JSON
round trips, text editing, viewport navigation, and grouped undo/redo.
