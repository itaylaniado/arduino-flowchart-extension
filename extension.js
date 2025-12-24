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

    const debouncedUpdate = debounce((event) => {
        if (currentPanel && event.document === vscode.window.activeTextEditor?.document) {
            updateGraph();
        }
    }, 600); 

    vscode.workspace.onDidChangeTextDocument(debouncedUpdate, null, context.subscriptions);

    // זיהוי שינוי Theme
    vscode.window.onDidChangeActiveColorTheme(() => {
        if (currentPanel) {
            currentPanel.webview.html = getWebviewContent();
            updateGraph();
        }
    });

    vscode.workspace.onDidSaveTextDocument(document => {
        if (document.languageId === 'cpp' || document.languageId === 'arduino' || document.languageId === 'c') {
            saveFlowchartHtml(document);
        }
    });

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

function debounce(func, wait) {
    let timeout;
    return function(...args) {
        const context = this;
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(context, args), wait);
    };
}

function saveFlowchartHtml(document) {
    const code = document.getText();
    const result = generateMermaidCode(code);
    const mapping = JSON.stringify(result.mapping);
    const escapedCode = code.replace(/&/g, '&amp;');
    
    // ב-HTML המיוצא, נשתמש ב-Light Theme כברירת מחדל (או ניטרלי)
    // הערה: ניתן לשנות את הצבעים כאן אם תרצה שהקובץ המיוצא יהיה כהה
    
    const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>TXP_Flowchart: ${path.basename(document.fileName)}</title>
    
    <script src="https://cdn.jsdelivr.net/npm/svg-pan-zoom@3.6.1/dist/svg-pan-zoom.min.js"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/atom-one-dark.min.css">
    <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>

    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            font-family: 'Consolas', 'Monaco', monospace; 
            background: #1e1e1e; 
            color: #d4d4d4;
            overflow: hidden;
        }
        #container { display: grid; grid-template-columns: 1fr 1fr; height: 100vh; gap: 0; }
        #codePanel { background: #1e1e1e; overflow-y: auto; border-right: 2px solid #333; position: relative; }
        #codeHeader { position: sticky; top: 0; background: #252526; padding: 12px 15px; border-bottom: 1px solid #333; font-weight: bold; color: #cccccc; z-index: 10; }
        #codeContent { padding: 0; counter-reset: line; }
        .code-line { padding: 0 15px 0 60px; position: relative; cursor: pointer; transition: background 0.15s; white-space: pre; font-size: 13px; line-height: 20px; display: flex; align-items: center; }
        .code-line:hover { background: #2a2d2e; }
        .code-line::before { counter-increment: line; content: counter(line); position: absolute; left: 15px; width: 35px; text-align: right; color: #858585; user-select: none; }
        .code-line.highlight { background: #264f78 !important; border-left: 3px solid #0667b6; }
        .code-line code { flex: 1; }
        
        #flowchartPanel { background: #fff; display: flex; flex-direction: column; border-left: 1px solid #ccc; }
        #chartHeader { background: #eee; padding: 12px 15px; border-bottom: 1px solid #ccc; font-weight: bold; color: #333; display: flex; gap: 10px; align-items: center; }
        button { background: #0e639c; color: white; border: none; padding: 6px 12px; cursor: pointer; border-radius: 2px; font-size: 12px; transition: background 0.2s; }
        button:hover { background: #1177bb; }
        #graphDiv { flex: 1; overflow: hidden; background: #fff; cursor: grab; position: relative; }
        #graphDiv:active { cursor: grabbing; }
        #mermaidSvg .cluster rect {rx: 20px !important; ry: 20px !important; fill:#f9f9f9 !important;}
        
        .node { cursor: pointer !important; }
        
        /* Highlighting for exported file */
        .highlight-node rect, .highlight-node circle, .highlight-node polygon, .highlight-node path {
            stroke: #008184 !important;
            stroke-width: 2px !important;
            filter: drop-shadow(0 0 4px #008184b8);
        }
        
        ::-webkit-scrollbar { width: 10px; }
        ::-webkit-scrollbar-track { background: #1e1e1e; }
        ::-webkit-scrollbar-thumb { background: #424242; }
        ::-webkit-scrollbar-thumb:hover { background: #4e4e4e; }
        .hljs { background: transparent; padding: 0; }
        
        @media print { 
            #codePanel { display: none; } 
            #container { grid-template-columns: 1fr; } 
            #chartHeader { display: none; } 
            body { background: white; color: black; } 
            #graphDiv { background: white; } 
        }
    </style>
</head>
<body>
    <div id="container">
        <div id="codePanel">
            <div id="codeHeader">Source Code - ${path.basename(document.fileName)}</div>
            <div id="codeContent"></div>
        </div>
        <div id="flowchartPanel">
            <div id="chartHeader">
                <span>TXP_Flowchart</span>
                <button onclick="resetZoom()">Reset Zoom</button>
                <button onclick="window.print()">Print Flowchart</button>
            </div>
            <div id="graphDiv" class="mermaid">${result.graph}</div>
        </div>
    </div>

    <script type="module">
        import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11.12.2/dist/mermaid.esm.min.mjs';
        import elkLayouts from 'https://cdn.jsdelivr.net/npm/@mermaid-js/layout-elk@0.1.4/dist/mermaid-layout-elk.esm.min.mjs';

        mermaid.registerLayoutLoaders(elkLayouts);
        
        // הגדרת Theme קבועה (Light) לקובץ המיוצא - תואם לבקשה
        mermaid.initialize({ 
            startOnLoad: true, 
            theme: 'base',
            themeVariables: {
                primaryColor: '#fefefe',
                primaryTextColor: '#2b2b2f',
                primaryBorderColor: '#000',
                lineColor: '#2b2b2f',
                secondaryColor: '#fff',
                tertiaryColor: '#fff'
            }
        });

        const sourceCode = ${JSON.stringify(escapedCode)};
        const lineMapping = ${mapping};
        let panZoom = null;
        
        const codeContent = document.getElementById('codeContent');
        const lines = sourceCode.split('\\n');
        lines.forEach((line, index) => {
            const lineDiv = document.createElement('div');
            lineDiv.className = 'code-line';
            lineDiv.dataset.lineNumber = index;
            const codeEl = document.createElement('code');
            codeEl.className = 'language-cpp hljs';
            codeEl.textContent = line || ' ';
            lineDiv.appendChild(codeEl);
            lineDiv.addEventListener('click', () => highlightNodeFromLine(index));
            codeContent.appendChild(lineDiv);
        });
        
        document.querySelectorAll('code.language-cpp').forEach(el => { hljs.highlightElement(el); });
        
        const checkRender = setInterval(() => {
            const svg = document.querySelector('#graphDiv svg');
            if (svg && svg.getBBox().width > 0) {
                clearInterval(checkRender);
                initPanZoom(svg);
                setupInteractions(svg);
            }
        }, 500);

        function initPanZoom(svgElement) {
            svgElement.style.height = "100%";
            svgElement.style.width = "100%";
            panZoom = svgPanZoom(svgElement, { 
                zoomEnabled: true, controlIconsEnabled: false, fit: true, center: true, minZoom: 0.1, maxZoom: 10 
            });
        }

        function setupInteractions(svgElement) {
            const nodes = svgElement.querySelectorAll('.node');
            nodes.forEach(node => {
                node.style.cursor = 'pointer';
                node.addEventListener('click', (e) => {
                    e.stopPropagation();
                    highlightLineFromNode(node);
                });
            });
        }

        window.highlightNodeFromLine = function(lineNumber) {
            const nodeId = lineMapping[lineNumber];
            if (!nodeId) return;
            document.querySelectorAll('.code-line.highlight').forEach(el => el.classList.remove('highlight'));
            document.querySelectorAll('.highlight-node').forEach(el => el.classList.remove('highlight-node'));
            const lineEl = document.querySelector(\`.code-line[data-line-number="\${lineNumber}"]\`);
            if (lineEl) {
                lineEl.classList.add('highlight');
                lineEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
            const svg = document.querySelector('#graphDiv svg');
            if (svg) {
                let nodeEl = svg.querySelector(\`[id^="flowchart-\${nodeId}-"]\`);
                if (!nodeEl) nodeEl = svg.querySelector(\`[id="\${nodeId}"]\`);
                if (!nodeEl) {
                    const allNodes = Array.from(svg.querySelectorAll('.node'));
                    nodeEl = allNodes.find(el => el.id.includes(\`-\${nodeId}-\`) || el.id.endsWith(\`-\${nodeId}\`));
                }
                if (nodeEl) {
                    const gNode = nodeEl.closest('.node') || nodeEl;
                    gNode.classList.add('highlight-node');
                    focusOnElement(gNode);
                }
            }
        };

        window.highlightLineFromNode = function(node) {
            const id = node.id || node.closest('.node')?.id || '';
            const match = id.match(/flowchart-(.+?)-(\\d+)/) || id.match(/(.+?)-(\\d+)/);
            const nodeId = match ? match[1] : id.replace('flowchart-', '').split('-')[0];
            
            if (!nodeId) return;
            let lineNumber = null;
            for (const [line, id] of Object.entries(lineMapping)) {
                if (id === nodeId) { lineNumber = parseInt(line); break; }
            }
            if (lineNumber === null) return;
            window.highlightNodeFromLine(lineNumber);
        };

            function focusOnElement(node) {
                if (!panZoom) return;
                const nodeRect = node.getBoundingClientRect();
                const containerRect = document.getElementById('graphDiv').getBoundingClientRect();
                const safeZoneH = containerRect.height * 0.3; 
                const safeZoneW = containerRect.width * 0.3;  
                const centerX = containerRect.left + containerRect.width / 2;
                const centerY = containerRect.top + containerRect.height / 2;
                const nodeCenterX = nodeRect.left + nodeRect.width / 2;
                const nodeCenterY = nodeRect.top + nodeRect.height / 2;

                if (Math.abs(nodeCenterX - centerX) < safeZoneW && Math.abs(nodeCenterY - centerY) < safeZoneH) {
                    savedPan = panZoom.getPan(); isUserPanning = true; return; 
                }
                const diffX = centerX - nodeCenterX;
                const diffY = centerY - nodeCenterY;
                const currentPan = panZoom.getPan();
                const targetPan = { x: currentPan.x + diffX, y: currentPan.y + diffY };
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
    </script>
</body>
</html>`;
    
    const dir = path.dirname(document.fileName);
    const htmlPath = path.join(dir, 'flowchart.html');
    
    fs.writeFile(htmlPath, htmlContent, err => {
        if (err) console.error('Error saving flowchart.html:', err);
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
        <script src="https://cdn.jsdelivr.net/npm/svg-pan-zoom@3.6.1/dist/svg-pan-zoom.min.js"></script>
        
        <style>
            /* שימוש ב-vars של VS Code */
            body { 
                margin: 0; padding: 0; overflow: hidden; 
                background-color: var(--vscode-editor-background); 
                color: var(--vscode-editor-foreground);
                font-family: 'Heboo', sans-serif; 
            }
            #container { width: 100vw; height: 100vh; display: flex; flex-direction: column; }
            
            #controls { 
                padding: 3px; 
                background: var(--vscode-editor-background); 
                display: flex; gap: 10px; 
                border-bottom: 1px dotted var(--vscode-editorGroup-border); 
                align-items: center;
                position: relative;
                z-index: 10;
            }
            
            button { 
                background: var(--vscode-button-background); 
                color: var(--vscode-button-foreground); 
                border: none; padding: 6px 12px; 
                cursor: pointer; border-radius: 2px; font-size: 12px; font-weight: bold; 
                transition: background 0.2s;
            }
            button:hover { background: var(--vscode-button-hoverBackground); }
            
            #graphDiv { 
                flex: 1; overflow: hidden; 
                background-color: var(--vscode-editor-background); 
                position: relative; 
                cursor: grab;
                touch-action: none;
            }
            #graphDiv:active { cursor: grabbing; }
            
            #statusIndicator {
                position: absolute; bottom: 10px; right: 10px;
                background: var(--vscode-inputValidation-errorBackground, rgba(255, 0, 0, 0.8));
                color: white; padding: 5px 10px; border-radius: 4px; font-size: 12px;
                display: none; pointer-events: none; z-index: 100;
            }

            .node { cursor: pointer !important; }
            #mermaidSvg .cluster rect {rx: 20px !important; ry: 20px !important; stroke:#fff !important;}
            
            /* Highlighting */
            .highlight-node rect, .highlight-node circle, .highlight-node polygon, .highlight-node path {
                stroke: var(--vscode-textLink-foreground) !important;
                stroke-width: 2px !important;
                filter: drop-shadow(0 0 4px var(--vscode-textLink-activeForeground));
                transition: all 0.3s ease-out;
            }
        </style>
    </head>
    <body>
        <div id="container">
            <div id="controls">
                <button onclick="exportSVG()">Save SVG</button>
                <button onclick="resetZoom()">Recenter</button>
                <div class="hint" style="margin-left: auto; font-size: 11px; opacity: 0.7;">Click graph to Jump | Click code to Focus</div>
            </div>
            <div id="graphDiv" class="mermaid"></div>
            <div id="statusIndicator">Syncing...</div>
        </div>

        <script type="module">
            import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11.12.2/dist/mermaid.esm.min.mjs';
            import elkLayouts from 'https://cdn.jsdelivr.net/npm/@mermaid-js/layout-elk@0.1.4/dist/mermaid-layout-elk.esm.min.mjs';

            mermaid.registerLayoutLoaders(elkLayouts);

            const vscode = acquireVsCodeApi();

            let savedZoom = null;
            let savedPan = null;
            let panZoom = null;
            let isUserPanning = false;

            // זיהוי Theme
            const isDark = document.body.classList.contains('vscode-dark');
            
            // הגדרת משתני Theme לפי הבקשה הספציפית ל-Light
            const themeVars = {
                // אם ב-Dark Mode - נשתמש בצבעים כהים
                // אם ב-Light Mode - נשתמש בצבעים מ-code_chart.md
                
                primaryColor: isDark ? '#252526' : '#fefefe',
                primaryTextColor: isDark ? '#ffffff' : '#2b2b2f',
                primaryBorderColor: isDark ? '#ffffff' : '#000000',
                lineColor: isDark ? '#cccccc' : '#2b2b2f',
                secondaryColor: isDark ? '#1e1e1e' : '#ffffff',
                tertiaryColor: isDark ? '#1e1e1e' : '#ffffff'
            };

            mermaid.initialize({ 
                startOnLoad: false, 
                theme: 'base',
                securityLevel: 'loose',
                themeVariables: themeVars
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

            window.renderGraph = async function(syntax) {
                const element = document.getElementById('graphDiv');
                const statusEl = document.getElementById('statusIndicator');
                
                try {
                    const { svg, bindFunctions } = await mermaid.render('mermaidSvg', syntax);
                    
                    let oldZoom = null;
                    let oldPan = null;
                    if (panZoom) {
                        try {
                            oldZoom = panZoom.getZoom();
                            oldPan = panZoom.getPan();
                            panZoom.destroy();
                        } catch(e) {}
                        panZoom = null;
                    }

                    element.innerHTML = svg;
                    statusEl.style.display = 'none';

                    if (bindFunctions) {
                        bindFunctions(element);
                    }

                    const svgElement = element.querySelector('svg');
                    if (svgElement) {
                        svgElement.style.height = "100%";
                        svgElement.style.width = "100%";
                        svgElement.style.maxWidth = "none";
                        
                        const bbox = svgElement.getBBox();
                        if (bbox.width > 0 && bbox.height > 0) {
                            panZoom = svgPanZoom(svgElement, { 
                                zoomEnabled: true, controlIconsEnabled: false, fit: true, center: true, minZoom: 0.1, maxZoom: 10,
                                onPan: function() { isUserPanning = true; }
                            });

                            if (oldZoom !== null && oldPan !== null) {
                                panZoom.zoom(oldZoom);
                                panZoom.pan(oldPan);
                            }
                        }
                    }
                } catch(e) { 
                     console.warn('Render skipped:', e.message);
                     statusEl.textContent = "Updating...";
                     statusEl.style.display = 'block';
                }
            };
            
            window.exportSVG = function() {
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
            
            window.resetZoom = function() {
                if(panZoom) { panZoom.resetZoom(); panZoom.center(); isUserPanning = false; }
            }

            function focusOnElement(node) {
                if (!panZoom) return;
                const nodeRect = node.getBoundingClientRect();
                const containerRect = document.getElementById('graphDiv').getBoundingClientRect();
                const safeZoneH = containerRect.height * 0.3; 
                const safeZoneW = containerRect.width * 0.3;  
                const centerX = containerRect.left + containerRect.width / 2;
                const centerY = containerRect.top + containerRect.height / 2;
                const nodeCenterX = nodeRect.left + nodeRect.width / 2;
                const nodeCenterY = nodeRect.top + nodeRect.height / 2;

                if (Math.abs(nodeCenterX - centerX) < safeZoneW && Math.abs(nodeCenterY - centerY) < safeZoneH) {
                    savedPan = panZoom.getPan(); isUserPanning = true; return; 
                }
                const diffX = centerX - nodeCenterX;
                const diffY = centerY - nodeCenterY;
                const currentPan = panZoom.getPan();
                const targetPan = { x: currentPan.x + diffX, y: currentPan.y + diffY };
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
        </script>
    </body>
    </html>`;
}

function deactivate() {}

module.exports = { activate, deactivate };