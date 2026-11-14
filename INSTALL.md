# Installing Paste to Upload

Paste to Upload lets you upload a screenshot or copied image to any website by pressing **Ctrl+V**, instead of saving it to a file first.

These steps take about two minutes. They're for **Brave**, but the same steps work in Chrome, Edge, Vivaldi and other Chromium-based browsers.

## 1. Download

Go to the [latest release](https://github.com/Edgarcillo2k/chromium-upload-clipboard-resource/releases/latest) and download **`paste-to-upload-v….zip`** (under *Assets*).

## 2. Unzip it into a folder you'll keep

Extract the zip, for example into `Documents/paste-to-upload`.

> **Don't delete or move this folder afterwards.** The browser loads the extension from it; if the folder goes away, the extension stops working.

Check that the folder you'll pick in the next step directly contains a file called `manifest.json`.

## 3. Add it to Brave

1. In the address bar, go to **`brave://extensions`**.
2. Turn on **Developer mode** (switch in the top-right corner).
3. Click **Load unpacked**.
4. Select the folder from step 2 (the one containing `manifest.json`).

"Paste to Upload" now shows up in the list. Optionally, pin it: click the puzzle-piece icon in the toolbar, then the pin next to Paste to Upload.

**Reload any tabs that were already open**: the extension only works on pages opened after it was installed.

## 4. Use it

1. Copy something: take a screenshot to the clipboard (Windows: <kbd>Win</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd>, Mac: <kbd>Cmd</kbd>+<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>4</kbd>, Linux: usually <kbd>Print Screen</kbd>), or right-click an image → *Copy image*.
2. On any website, click its upload / attach / "Choose file" button.
3. A small box appears. Press **<kbd>Ctrl</kbd>+<kbd>V</kbd>** (<kbd>Cmd</kbd>+<kbd>V</kbd> on Mac). Done: the image is uploaded.

- Want the normal file window instead? Click **Browse files…** in the box, or hold <kbd>Shift</kbd> while clicking the upload button.
- Clicking **Paste from clipboard** instead of pressing Ctrl+V also works; the first time on each site, Brave asks for permission to read the clipboard.
- Close the box with <kbd>Esc</kbd> or by clicking elsewhere.
- Settings (turn it off on certain sites, change the skip key): click the extension's icon in the toolbar.

## Updating to a new version

1. Download the new zip and unzip it **over the same folder** (replace the files).
2. Go to `brave://extensions` and click the **↻** (reload) button on the Paste to Upload card.
3. Reload your open tabs.

## Removing it

`brave://extensions` → Paste to Upload → **Remove**. Then you can delete the folder.
