const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { initParser, generateMermaidCode } = require('./src/flowchartGenerator');

let currentPanel = undefined;

async function activate(context) {
    const wasmPath = path.join(__dirname, 'tree-sitter-cpp.wasm');
    await initParser(wasmPath);

    let disposable = vscode.commands.registerCommand('arduinoFlowchart.show', () => {
        const column = vscode.window.activeTextEditor
            ? vscode.ViewColumn.Beside
            : vscode.ViewColumn.One;

        if (currentPanel) {
            currentPanel.reveal(column);
        } else {
            currentPanel = vscode.window.createWebviewPanel(
                'arduinoFlowchart',
                'Flowchart',
                column,
                {
                    enableScripts: true,
                    localResourceRoots: [vscode.Uri.file(path.join(context.extensionPath, 'media'))]
                }
            );

            currentPanel.webview.html = getWebviewContent();

            // --- טיפול בהודעות מה-Webview ---
            currentPanel.webview.onDidReceiveMessage(
                async message => {
                    switch (message.command) {
                        case 'saveSVG':
                            await saveSvgToDisk(message.text);
                            break;
                        
                        // --- הפיצ'ר החדש: קפיצה לשורה ---
                        case 'jump':
                            jumpToEditorLine(message.line);
                            break;
                    }
                },
                null,
                context.subscriptions
            );

            currentPanel.onDidDispose(() => { currentPanel = undefined; }, null, context.subscriptions);
        }

        updateGraph();
    });

    context.subscriptions.push(disposable);

    vscode.workspace.onDidChangeTextDocument(event => {
        if (currentPanel && event.document === vscode.window.activeTextEditor?.document) {
            updateGraph();
        }
    }, null, context.subscriptions);
}

// פונקציה שמזיזה את הסמן ב-IDE
function jumpToEditorLine(line) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    // VS Code משתמש באינדקס 0, tree-sitter גם משתמש ב-0. הכל טוב.
    const position = new vscode.Position(line, 0);
    const range = new vscode.Range(position, position);

    // 1. הזזת הסמן
    editor.selection = new vscode.Selection(position, position);
    
    // 2. גלילה כך שהשורה תהיה באמצע המסך
    editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
}

async function saveSvgToDisk(svgContent) {
    const uri = await vscode.window.showSaveDialog({
        saveLabel: 'Export Flowchart',
        filters: { 'SVG Images': ['svg'] }
    });

    if (uri) {
        const fullContent = `<?xml version="1.0" encoding="UTF-8"?>\n` + svgContent;
        fs.writeFile(uri.fsPath, fullContent, err => {
            if (err) vscode.window.showErrorMessage('Failed: ' + err.message);
        });
    }
}

function updateGraph() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const code = editor.document.getText();
    const mermaidSyntax = generateMermaidCode(code);
    if (currentPanel) {
        currentPanel.webview.postMessage({ command: 'update', content: mermaidSyntax });
    }
}

function getWebviewContent() {
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
        <script src="https://cdn.jsdelivr.net/npm/svg-pan-zoom@3.6.1/dist/svg-pan-zoom.min.js"></script>
        <style>
            body { margin: 0; padding: 0; overflow: hidden; background-color: #1e1e1e; font-family: sans-serif; }
            #container { width: 100vw; height: 100vh; display: flex; flex-direction: column; }
            #controls { padding: 10px; background: #252526; display: flex; gap: 10px; border-bottom: 1px solid #333; }
            button { background: #0e639c; color: white; border: none; padding: 6px 12px; cursor: pointer; border-radius: 2px; font-size: 12px; font-weight: bold;}
            button:hover { background: #1177bb; }
            #graphDiv { flex: 1; overflow: hidden; background-color: white; position: relative; }
            
            /* סמן עכבר מצביע על לינקים */
            .node { cursor: pointer; }
        </style>
    </head>
    <body>
        <div id="container">
            <div id="controls">
                <button onclick="exportSVG()">💾 Save as SVG</button>
                <button onclick="resetZoom()">🔍 Reset Zoom</button>
            </div>
            <div id="graphDiv" class="mermaid">
                graph TD; Init;
            </div>
        </div>

        <script>
            const vscode = acquireVsCodeApi();

            mermaid.initialize({ 
                startOnLoad: true, 
                theme: 'base',
                securityLevel: 'loose', // חובה כדי לאפשר אירועי click
                themeVariables: {
                    primaryColor: '#ffffff',
                    primaryTextColor: '#000000',
                    primaryBorderColor: '#000000',
                    lineColor: '#000000',
                    secondaryColor: '#ffffff',
                    tertiaryColor: '#ffffff'
                }
            });

            let panZoom = null;

            // הפונקציה שנקראת ע"י Mermaid כשלוחצים על צומת
            // הפונקציה מוגדרת בחלון הגלובלי (window) כדי ש-Mermaid ימצא אותה
            window.jumpToLine = function(line) {
                vscode.postMessage({
                    command: 'jump',
                    line: line
                });
            };

            window.addEventListener('message', event => {
                const message = event.data;
                if (message.command === 'update') {
                    renderGraph(message.content);
                }
            });

            async function renderGraph(syntax) {
                const element = document.getElementById('graphDiv');
                if(panZoom) { panZoom.destroy(); panZoom = null; }
                
                try {
                    const { svg, bindFunctions } = await mermaid.render('mermaidSvg', syntax);
                    element.innerHTML = svg;
                    
                    // חיבור הפונקציות (חובה עבור קליקים בגרסאות חדשות של mermaid)
                    if(bindFunctions) {
                        bindFunctions(element);
                    }

                    const svgElement = element.querySelector('svg');
                    if(svgElement) {
                        svgElement.style.height = "100%";
                        svgElement.style.width = "100%";
                        panZoom = svgPanZoom(svgElement, { 
                            zoomEnabled: true, controlIconsEnabled: false, fit: true, center: true, minZoom: 0.1, maxZoom: 10
                        });
                    }
                } catch(e) {
                    element.innerHTML = '<div style="color:red; padding:20px;">Syntax Error: ' + e.message + '</div>';
                }
            }

            function exportSVG() {
                const svgEl = document.querySelector('#graphDiv svg');
                if (!svgEl) return;
                let contentG = svgEl.querySelector('.svg-pan-zoom_viewport');
                if (!contentG) contentG = svgEl.querySelector('g'); 
                const bbox = contentG.getBBox();
                const clone = svgEl.cloneNode(true);
                clone.removeAttribute('style');
                clone.removeAttribute('width');
                clone.removeAttribute('height');
                const padding = 20;
                const viewBox = \`\${bbox.x - padding} \${bbox.y - padding} \${bbox.width + (padding*2)} \${bbox.height + (padding*2)}\`;
                clone.setAttribute('viewBox', viewBox);
                const cloneViewport = clone.querySelector('.svg-pan-zoom_viewport');
                if (cloneViewport) {
                    cloneViewport.removeAttribute('transform');
                    cloneViewport.removeAttribute('style');
                }
                vscode.postMessage({ command: 'saveSVG', text: clone.outerHTML });
            }
            
            function resetZoom() {
                if(panZoom) { panZoom.resetZoom(); panZoom.center(); }
            }
        </script>
    </body>
    </html>`;
}

function deactivate() {}

module.exports = { activate, deactivate };