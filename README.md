# DiffPixel

DiffPixel is a Chrome extension for comparing a live page with reference images directly on the page. It opens a floating panel from the extension icon, so the page stays visible while you tune layers.

## Features

- Upload one or more local reference images as overlay layers.
- Adjust opacity, position, scale, blend mode, invert, and lock per layer.
- Fine scale control with decimal input and keyboard arrow adjustment.
- Toggle a page-level pixel grid and adjust the grid size.
- Save layer state per site in Chrome local storage.
- Runs locally without sending images or settings to any server.

## Local QA

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Choose **Load unpacked** and select this project folder.
4. Open a normal web page, click the DiffPixel icon, and confirm the floating panel appears.
5. Upload an image, toggle the grid, move and scale the layer, then reload the page to confirm saved state.

For local files, enable **Allow access to file URLs** for DiffPixel in Chrome's extension details page.

## Release Package

Use the ZIP generated in `dist/` for Chrome Web Store upload. The ZIP must contain `manifest.json` at the archive root and should not include `.git`, screenshots, or development-only files.

## Privacy

DiffPixel does not collect, transmit, sell, or share user data. Uploaded reference images and settings are stored locally in Chrome storage on the user's device. See `PRIVACY.md` for the store-facing privacy text.
