const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { initParser, generateMermaidCode } = require('./src/flowchartGenerator');

let currentPanel = undefined;
let currentMapping = {};

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

            currentPanel.webview.onDidReceiveMessage(
                async message => {
                    switch (message.command) {
                        case 'saveSVG': await saveSvgToDisk(message.text); break;
                        case 'jump': jumpToEditorLine(message.line); break;
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

    // עדכון הגרף בשינוי קוד (Live Preview)
    vscode.workspace.onDidChangeTextDocument(event => {
        if (currentPanel && event.document === vscode.window.activeTextEditor?.document) {
            updateGraph();
        }
    }, null, context.subscriptions);

    // פיצ'ר שמירת Markdown בעת שמירת הקובץ
    vscode.workspace.onDidSaveTextDocument(document => {
        if (document.languageId === 'cpp' || document.languageId === 'arduino' || document.languageId === 'c') {
            saveMarkdownFile(document);
        }
    });

    // סנכרון סמן: לחיצה על הקוד מדגישה את הבלוק
    vscode.window.onDidChangeTextEditorSelection(event => {
        if (!currentPanel || !currentPanel.visible) return;
        if (event.textEditor.document !== vscode.window.activeTextEditor?.document) return;

        const line = event.selections[0].active.line;
        const nodeId = currentMapping[line];
        
        if (nodeId) {
            currentPanel.webview.postMessage({ 
                command: 'focusNode', 
                nodeId: nodeId 
            });
        }
    }, null, context.subscriptions);
}

// פונקציה לשמירת קובץ Markdown
function saveMarkdownFile(document) {
    const code = document.getText();
    const result = generateMermaidCode(code); 
    
    const mdContent = `# Flowchart: ${path.basename(document.fileName)}\n\nAuto-generated flowchart based on source code.\n\n\`\`\`mermaid\n---\nconfig:\n  theme: 'base'\n  themeVariables:\n    primaryColor: '#fff'\n    primaryTextColor: '#2b2b2f'\n    primaryBorderColor: '#000'\n    lineColor: '#2b2b2f'\n    secondaryColor: '#fff'\n    tertiaryColor: '#fff'\n---\n${result.graph}\n\`\`\`\n`;
    
    const dir = path.dirname(document.fileName);
    const mdPath = path.join(dir, 'flowchart.md');
    
    fs.writeFile(mdPath, mdContent, err => {
        if (err) {
            console.error('Error saving flowchart.md:', err);
        }
    });
}

function jumpToEditorLine(line) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const position = new vscode.Position(line, 0);
    const range = new vscode.Range(position, position);
    editor.selection = new vscode.Selection(position, position);
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
    
    const result = generateMermaidCode(code);
    currentMapping = result.mapping;

    if (currentPanel) {
        currentPanel.webview.postMessage({ 
            command: 'update', 
            content: result.graph 
        });
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
            body { margin: 0; padding: 0; overflow: hidden; background-color: #f1f1f1ff; font-family: sans-serif; }
            #container { width: 100vw; height: 100vh; display: flex; flex-direction: column; }
            
            #controls { 
                padding: 3px; background: #f1f1f1ff; display: flex; gap: 10px; border-bottom: 1px dotted #000000ff; 
                align-items: center;
            }
            
            button { 
                background: #94b4ebff; color: #1d1d1dff; border: none; padding: 6px 12px; 
                cursor: pointer; border-radius: 2px; font-size: 12px; font-weight: bold; 
                transition: background 0.2s;
            }
            button:hover { background: #82d4f1ff; }
            
            #graphDiv { 
                flex: 1; overflow: hidden; background-color: white; position: relative; 
                cursor: grab;
                touch-action: none;
            }
            #graphDiv:active { cursor: grabbing; }
            
            .node { cursor: pointer !important; }
            .hint { color: #0f0f0fff; font-size: 11px; margin-left: auto; }
            
            .highlight-node rect, .highlight-node circle, .highlight-node polygon {
                fill: #f1fffdff !important;
                stroke: #0667b6ff !important;
                stroke-width: 2px !important;
                filter: drop-shadow(0 0 10px rgba(30, 140, 230, 0.32));
                transition: all 0.3s ease-out;
            }
        </style>
    </head>
    <body>
        <div id="container">
            <div id="controls">
                <button onclick="exportSVG()">Save SVG</button>
                <button onclick="resetZoom()">Recenter</button>
                <div class="hint">Click graph to Jump | Click code to Focus</div>
            </div>
            <div id="graphDiv" class="mermaid">
                graph TD; Init;
            </div>
        </div>

        <script>
            const vscode = acquireVsCodeApi();

            let savedZoom = null;
            let savedPan = null;
            let panZoom = null;
            let isUserPanning = false;

            mermaid.initialize({ 
                startOnLoad: true, 
                theme: 'base',
                securityLevel: 'loose',
                themeVariables: {
                    primaryColor: '#ffffff',
                    primaryTextColor: '#000000',
                    primaryBorderColor: '#000000',
                    lineColor: '#000000',
                    secondaryColor: '#ffffff',
                    tertiaryColor: '#ffffff'
                }
            });

            document.getElementById('graphDiv').addEventListener('click', function(e) {
                const isModifier = e.ctrlKey || e.metaKey;
                const nodeElement = e.target.closest('.node');
                if (nodeElement && isModifier) {
                    e.stopPropagation(); e.preventDefault();
                    focusOnElement(nodeElement);
                }
            }, true);

            window.jumpToLine = function(line) {
                vscode.postMessage({ command: 'jump', line: line - 1 });
            };

            window.addEventListener('message', event => {
                const message = event.data;
                
                if (message.command === 'update') {
                    renderGraph(message.content);
                }
                
                if (message.command === 'focusNode') {
                    const svg = document.querySelector('#graphDiv svg');
                    if (svg) {
                        let nodeEl = svg.querySelector(\`[id^="flowchart-\${message.nodeId}-"]\`);
                        if (!nodeEl) nodeEl = svg.querySelector(\`[id="\${message.nodeId}"]\`);
                        if (!nodeEl) {
                             const allNodes = Array.from(svg.querySelectorAll('.node'));
                             nodeEl = allNodes.find(el => el.id.includes(\`-\${message.nodeId}-\`) || el.id.endsWith(\`-\${message.nodeId}\`));
                        }

                        if (nodeEl) {
                            svg.querySelectorAll('.highlight-node').forEach(el => el.classList.remove('highlight-node'));
                            const gNode = nodeEl.closest('.node') || nodeEl;
                            gNode.classList.add('highlight-node');
                            focusOnElement(gNode);
                        }
                    }
                }
            });

            async function renderGraph(syntax) {
                const element = document.getElementById('graphDiv');
                if (panZoom) {
                    savedZoom = panZoom.getZoom();
                    savedPan = panZoom.getPan();
                    panZoom.destroy();
                    panZoom = null;
                }
                try {
                    const { svg, bindFunctions } = await mermaid.render('mermaidSvg', syntax);
                    element.innerHTML = svg;
                    if(bindFunctions) bindFunctions(element);

                    const svgElement = element.querySelector('svg');
                    if(svgElement) {
                        svgElement.style.height = "100%";
                        svgElement.style.width = "100%";
                        
                        panZoom = svgPanZoom(svgElement, { 
                            zoomEnabled: true, controlIconsEnabled: false, fit: true, center: true, minZoom: 0.1, maxZoom: 10,
                            onPan: function() { isUserPanning = true; }
                        });

                        if (savedZoom !== null && savedPan !== null) {
                            panZoom.zoom(savedZoom);
                            panZoom.pan(savedPan);
                        } else {
                            isUserPanning = false; 
                        }
                    }
                } catch(e) { console.error(e); }
            }

            function focusOnElement(node) {
                if (!panZoom) return;

                const nodeRect = node.getBoundingClientRect();
                const containerRect = document.getElementById('graphDiv').getBoundingClientRect();

                // אזור מת (Dead Zone): אם האלמנט במרכז (30% מהמסך), לא מזיזים
                const safeZoneH = containerRect.height * 0.3; 
                const safeZoneW = containerRect.width * 0.3;  
                
                const centerX = containerRect.left + containerRect.width / 2;
                const centerY = containerRect.top + containerRect.height / 2;
                
                const nodeCenterX = nodeRect.left + nodeRect.width / 2;
                const nodeCenterY = nodeRect.top + nodeRect.height / 2;

                if (Math.abs(nodeCenterX - centerX) < safeZoneW && 
                    Math.abs(nodeCenterY - centerY) < safeZoneH) {
                    savedPan = panZoom.getPan();
                    isUserPanning = true;
                    return; // אין צורך להזיז
                }

                const diffX = centerX - nodeCenterX;
                const diffY = centerY - nodeCenterY;
                const currentPan = panZoom.getPan();
                const targetPan = { x: currentPan.x + diffX, y: currentPan.y + diffY };

                // הפעלת אנימציה במקום קפיצה
                animatePan(currentPan, targetPan, 300);
            }

            function animatePan(start, end, duration) {
                const startTime = performance.now();

                function step(currentTime) {
                    const elapsed = currentTime - startTime;
                    const progress = Math.min(elapsed / duration, 1);
                    // פונקציית Ease-Out לתנועה טבעית
                    const ease = 1 - Math.pow(1 - progress, 3);

                    const newX = start.x + (end.x - start.x) * ease;
                    const newY = start.y + (end.y - start.y) * ease;

                    panZoom.pan({x: newX, y: newY});

                    if (progress < 1) {
                        requestAnimationFrame(step);
                    } else {
                        savedPan = panZoom.getPan();
                        isUserPanning = true;
                    }
                }
                
                requestAnimationFrame(step);
            }

            function exportSVG() {
                const svgEl = document.querySelector('#graphDiv svg');
                if (!svgEl) return;
                let contentG = svgEl.querySelector('.svg-pan-zoom_viewport');
                if (!contentG) contentG = svgEl.querySelector('g'); 
                const bbox = contentG.getBBox();
                const clone = svgEl.cloneNode(true);
                clone.removeAttribute('style'); clone.removeAttribute('width'); clone.removeAttribute('height');
                const padding = 20;
                const viewBox = \`\${bbox.x - padding} \${bbox.y - padding} \${bbox.width + (padding*2)} \${bbox.height + (padding*2)}\`;
                clone.setAttribute('viewBox', viewBox);
                const cloneViewport = clone.querySelector('.svg-pan-zoom_viewport');
                if (cloneViewport) { cloneViewport.removeAttribute('transform'); cloneViewport.removeAttribute('style'); }
                vscode.postMessage({ command: 'saveSVG', text: clone.outerHTML });
            }
            
            function resetZoom() {
                if(panZoom) { panZoom.resetZoom(); panZoom.center(); isUserPanning = false; }
            }
        </script>
    </body>
    </html>`;
}

function deactivate() {}

module.exports = { activate, deactivate };