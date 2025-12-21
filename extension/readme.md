# Arduino Flowchart Visualizer

Auto-generate interactive Mermaid flowcharts from Arduino and C++ sketches directly inside VS Code.

## Features
- One-click command: run `Arduino: Show Flowchart` to open a live graph beside the editor.
- Watches the active Arduino/C++ file and refreshes the diagram as you type.
- Saves a `flowchart.md` with embedded Mermaid when you save the source file.
- Webview controls for zoom, pan, and printing to PDF.
- Subroutine detection to separate function calls from simple statements.

## Requirements
- VS Code 1.70.0 or newer.
- `tree-sitter-cpp.wasm` placed at the root of the extension (next to `package.json`). The extension loads it at activation.

## Usage
1. Open an Arduino (`.ino`) or C++ (`.cpp`, `.h`) file.
2. Run `Arduino: Show Flowchart` from the Command Palette or the editor title menu. A webview opens beside your code.
3. Edit your file; the diagram updates automatically.
4. Save the file to emit `flowchart.md` alongside the source. Use the webview controls to reset zoom or print to PDF.

## Commands
- `arduinoFlowchart.show` — Show Flowchart (also available from the editor title toolbar).

## Known Limitations
- Parser initialization fails if `tree-sitter-cpp.wasm` is missing or unreadable; ensure it is bundled with the extension.
- The flowchart reflects the currently active editor only.

## Contributing / Development
- Clone the repo, install dependencies with `npm install`, and press F5 to launch the Extension Development Host.
- Tests: run `npm test` (currently only the sample suite).

## Release Notes
### 0.0.1
- Initial preview with live flowcharts, Markdown export, and PDF print support.
