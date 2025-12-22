# Arduino Flowchart Visualizer 🚀

**Visualize your Arduino logic in real-time.**

This extension for **Arduino IDE 2.x** (and VS Code) automatically generates dynamic, interactive flowcharts from your C++ / Arduino sketch code. It helps beginners understand code flow and allows advanced users to document their projects effortlessly.

*![][image1]*

# Arduino Flowchart Visualizer 🚀

**Visualize your Arduino logic in real-time.**

This extension for **Arduino IDE 2.x** (and VS Code) automatically generates dynamic, interactive flowcharts from your C++ / Arduino sketch code. It helps beginners understand code flow and allows advanced users to document their projects effortlessly.


---

## ✨ Key Features

### 1\. Real-Time Visualization

* **Live Updates:** The flowchart updates automatically as you type or modify your code.  
* **Smart Parsing:** Uses **Tree-sitter** to accurately understand C++ syntax, separating `setup()`, `loop()`, and custom functions.  
* **Visual Distinctness:**  
* 🔷 **Diamonds:** `if` / `else` conditions.  
* 🛑 **Hexagons:** `for` and `while` loops (visually contained in subgraphs).  
* ⚪ **Circles:** Start / End points.

### 2\. Bi-Directional Navigation ↔️

Navigate complex codebases with ease:

* **Graph ➡ Code:** Click any block in the flowchart to jump immediately to the corresponding line in your code.  
* **Code ➡ Graph:** Click any line in your source code, and the flowchart will automatically pan, zoom, and highlight the relevant block.  
* *Includes a "Smart Focus" system with smooth animation and a dead-zone to prevent motion sickness if the node is already visible.*

### 3\. Custom Documentation (Magic Comments)

Rename complex code lines into human-readable labels in the flowchart using the `//\\` syntax.

**Example:**

digitalWrite(13, HIGH); //\\\\ Turn on Red LED

*In the code:* You see the actual command. *In the flowchart:* The box says **"Turn on Red LED"**.

### 4\. Export & Saving

* **SVG Export:** Save high-quality, scalable vector graphics of your flowchart for papers, presentations, or documentation.  
* **Auto-Markdown Generation:** Every time you save your sketch (`Ctrl+S`), the extension automatically updates a `flowchart.md` file in your project folder containing the Mermaid.js syntax.

---

## 📥 Installation

Since Arduino IDE 2.0 does not yet support a direct "Extension Marketplace" for third-party plugins, installation must be done manually.

### Prerequisites

* Arduino IDE 2.x installed.

### Steps

1. **Download** the latest `.vsix` release file from the \[suspicious link removed\].  
2. **Close** the Arduino IDE.  
3. **Navigate** to your Arduino IDE plugins folder:  
* **Windows:** `C:\Users\<YourUsername>\.arduinoIDE\plugins`  
* **Mac/Linux:** `~/.arduinoIDE/plugins`  
4. **Create a folder** named `arduino-flowchart`.  
5. **Extract the VSIX:**  
* *Note:* A `.vsix` file is technically a ZIP file. Rename `extension.vsix` to `extension.zip`.  
* Extract the contents.  
* Move the `extension` folder (found inside the zip) into your new `arduino-flowchart` folder.  
* **Crucial:** Ensure the file `tree-sitter-cpp.wasm` is present in the extension root alongside `extension.js`.  
6. **Open Arduino IDE**.

---

## 🎮 Usage

1. Open an Arduino Sketch (`.ino` or `.cpp`).  
2. Open the Command Palette:  
* **Windows/Linux:** `Ctrl + Shift + P`  
* **Mac:** `Cmd + Shift + P`  
3. Type **"Flowchart"** and select **"Arduino Flowchart: Show"**.  
4. The flowchart panel will appear on the side.

### Controls

* **Pan:** Click and drag the background.  
* **Zoom:** Use the mouse wheel.  
* **Reset:** Click the **"Recenter"** button to reset the view.  
* **Save:** Click **"Save SVG"** to export the current view.

---

## 🛠️ Development

If you want to modify or build this extension from source:

1. Clone the repository.  
2. Install dependencies:

npm install

3. Package the extension:

npx @vscode/vsce package

*Note: This project uses a custom `.vscodeignore` to ensure the WASM parser is included in the build.*

---

## 📄 License

This project is licensed under the MIT License \- see the [LICENSE](https://www.google.com/search?q=LICENSE) file for details.

---

**Enjoy coding with clarity\!** 🚀  


[image1]: ./img/extension.jpg