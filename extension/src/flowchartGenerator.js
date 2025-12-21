const Parser = require('web-tree-sitter');

let parser;

async function initParser(wasmPath) {
    await Parser.init();
    parser = new Parser();
    const Lang = await Parser.Language.load(wasmPath);
    parser.setLanguage(Lang);
}

function generateMermaidCode(code) {
    if (!parser) return { graph: 'graph TD\nError["Parser not initialized"]', mapping: {} };

    try {
        const sourceLines = code.split(/\r?\n/);
        const cleanCode = code.replace(/\u00A0/g, ' ');
        const tree = parser.parse(cleanCode);
        const root = tree.rootNode;

        let functions = [];
        for (let i = 0; i < root.childCount; i++) {
            const child = root.child(i);
            if (child.type === 'function_definition') {
                const nameNode = child.child(1).child(0);
                const bodyNode = child.child(2);
                if (nameNode && bodyNode) {
                    functions.push({ name: nameNode.text, body: bodyNode });
                }
            }
        }

        let graph = 'graph TD\n';
        graph += 'classDef startEnd fill:#252526,stroke:#fff,stroke-width:2px,color:#fff;\n';
        graph += 'classDef activeNode fill:#ffff00,stroke:#000000,stroke-width:3px;\n';
        graph += 'classDef loopHex fill:#e1f5fe,stroke:#01579b,stroke-width:2px,color:#000;\n';
        
        graph += 'GlobalStart((Start)):::startEnd --> setup_Start\n';

        let clickEvents = [];
        let lineMapping = {}; 

        function registerMapping(id, startLine, endLine) {
            clickEvents.push(`click ${id} call jumpToLine(${startLine + 1})`);
            const end = endLine !== undefined ? endLine : startLine;
            for (let i = startLine; i <= end; i++) {
                lineMapping[i] = id;
            }
        }

        function getLabel(node, fallbackType) {
            const lineIndex = node.startPosition.row;
            const originalLine = sourceLines[lineIndex] || "";
            const magicMatch = originalLine.match(/\/\/\\\s*(.*)$/);
            if (magicMatch && magicMatch[1]) {
                return sanitize(magicMatch[1].trim());
            }
            let rawText = node.text.split('\n')[0].trim().replace(/;/g, '');
            let label = sanitize(rawText.substring(0, 40));
            if (!label || label.length < 2) label = fallbackType || node.type;
            return label;
        }

        function processBlock(node, incomingIds, edgeLabel = null) {
            if (!node) return incomingIds;

            const startLine = node.startPosition.row;
            const endLine = node.endPosition.row;

            if (node.type === 'ERROR') {
                const id = `N${node.id}`;
                graph += `${id}["Syntax Error"]\n`;
                registerMapping(id, startLine, endLine);
                incomingIds.forEach(prev => {
                    if (edgeLabel) graph += `${prev} -->|${edgeLabel}| ${id}\n`;
                    else graph += `${prev} --> ${id}\n`;
                });
                return [id];
            }

            if (node.type === 'compound_statement') {
                let currentIds = incomingIds;
                let nextEdgeLabel = edgeLabel;

                for (let i = 0; i < node.childCount; i++) {
                    const child = node.child(i);
                    if (['{', '}', ';', 'comment'].includes(child.type)) continue;

                    const nextIds = processBlock(child, currentIds, nextEdgeLabel);
                    
                    if (nextIds.length > 0) {
                        currentIds = nextIds;
                        if (['for_statement', 'while_statement'].includes(child.type)) {
                            nextEdgeLabel = "False";
                        } else {
                            nextEdgeLabel = null;
                        }
                    }
                }
                return currentIds;
            }

            if (['{', '}', ';', 'comment'].includes(node.type)) return incomingIds;

            const id = `N${node.id}`;

            // --- For Loop ---
            if (node.type === 'for_statement') {
                const initNode = node.childForFieldName('initializer');
                const condNode = node.childForFieldName('condition');
                const updateNode = node.childForFieldName('update');
                const bodyNode = node.childForFieldName('body');

                // 1. חישוב נקודת הכניסה ללולאה
                let entryId;
                if (initNode) entryId = `N${initNode.id}`;
                else if (condNode) entryId = `N${condNode.id}`;
                else entryId = `N${node.id}_COND`;

                // 2. פתיחת ה-Subgraph
                const loopScopeId = `LoopScope_${node.id}`;
                const customLabel = getLabel(node, "Loop");
                const scopeTitle = customLabel !== "Loop" && !customLabel.startsWith("for") ? customLabel : "For Loop";
                
                graph += `subgraph ${loopScopeId} [${scopeTitle}]\n`;

                // 3. הגדרת צומת הכניסה וחיבור החצים הנכנסים *בתוך* ה-Subgraph
                // זה התיקון הקריטי למניעת קריסת Mermaid
                if (initNode) {
                    const initLabel = sanitize(initNode.text.replace(/;/g, ''));
                    graph += `${entryId}["${initLabel}"]\n`; 
                    registerMapping(entryId, initNode.startPosition.row, initNode.endPosition.row);
                } else {
                    // אם אין אתחול, הכניסה היא התנאי - נגדיר אותו מיד בהמשך, החיבור ייעשה אליו
                }

                // כעת בטוח לחבר את החצים מבחוץ פנימה
                incomingIds.forEach(prev => {
                    if (edgeLabel) graph += `${prev} -->|${edgeLabel}| ${entryId}\n`;
                    else graph += `${prev} --> ${entryId}\n`;
                });

                // 4. תנאי
                const condId = condNode ? `N${condNode.id}` : `N${node.id}_COND`;
                const condText = condNode ? sanitize(condNode.text) : "true";
                
                graph += `${condId}{{"${condText}?"}}:::loopHex\n`;
                registerMapping(condId, startLine); // מיפוי רק לשורת הכותרת
                
                if (initNode) {
                    graph += `${entryId} --> ${condId}\n`;
                }
                
                // 5. גוף הלולאה
                const bodyEnds = processBlock(bodyNode, [condId], "True");

                // 6. עדכון
                let updateEnds = bodyEnds;
                if (updateNode) {
                    const upId = `N${updateNode.id}`;
                    graph += `${upId}["${sanitize(updateNode.text)}"]\n`;
                    registerMapping(upId, updateNode.startPosition.row, updateNode.endPosition.row);
                    bodyEnds.forEach(prev => graph += `${prev} --> ${upId}\n`);
                    updateEnds = [upId];
                }

                // 7. חזרה לתנאי
                updateEnds.forEach(prev => graph += `${prev} --> ${condId}\n`);

                graph += `end\n`; // סיום Subgraph

                return [condId];
            }

            // --- While Loop ---
            if (node.type === 'while_statement') {
                const condNode = node.child(1);
                const bodyNode = node.child(2);
                const condId = `N${condNode.id}`;
                const customLabel = getLabel(node, "");
                const label = (customLabel && !customLabel.includes("while")) ? customLabel : sanitize(condNode.text);

                graph += `${condId}{{"${label}?"}}:::loopHex\n`;
                registerMapping(condId, startLine);
                
                incomingIds.forEach(prev => {
                    if (edgeLabel) graph += `${prev} -->|${edgeLabel}| ${condId}\n`;
                    else graph += `${prev} --> ${condId}\n`;
                });
                
                const bodyEnds = processBlock(bodyNode, [condId], "True");
                bodyEnds.forEach(end => graph += `${end} --> ${condId}\n`);
                
                return [condId]; 
            }

            // --- If Statement ---
            if (node.type === 'if_statement') {
                const condNode = node.child(1);
                const thenNode = node.child(2);
                const elseNode = node.childCount > 3 ? node.child(3).child(1) : null;
                const ifId = `N${condNode.id}`;
                const customLabel = getLabel(node, "");
                const label = (customLabel && !customLabel.includes("if")) ? customLabel : sanitize(condNode.text);

                graph += `${ifId}{"${label}?"}\n`;
                registerMapping(ifId, startLine);
                
                incomingIds.forEach(prev => {
                    if (edgeLabel) graph += `${prev} -->|${edgeLabel}| ${ifId}\n`;
                    else graph += `${prev} --> ${ifId}\n`;
                });
                
                const thenEnds = processBlock(thenNode, [ifId], "Yes");
                const elseEnds = elseNode ? processBlock(elseNode, [ifId], "No") : [ifId];
                
                return [...thenEnds, ...elseEnds];
            }

            let label = getLabel(node);
            let shapeL = '[', shapeR = ']';
            if (node.type === 'expression_statement' && node.child(0).type === 'call_expression') {
                const funcName = node.child(0).child(0).text;
                if (!['digitalWrite', 'analogWrite', 'delay', 'Serial.println', 'random'].includes(funcName)) {
                    shapeL = '[['; shapeR = ']]'; 
                }
            }

            graph += `${id}${shapeL}"${label}"${shapeR}\n`;
            registerMapping(id, startLine, endLine);

            incomingIds.forEach(prev => {
                if (prev !== id) {
                    if (edgeLabel) graph += `${prev} -->|${edgeLabel}| ${id}\n`;
                    else graph += `${prev} --> ${id}\n`;
                }
            });
            return [id];
        }

        functions.forEach(func => {
            const funcName = func.name;
            graph += `subgraph ${funcName}_Scope [${funcName}]\n`;
            const startNode = `${funcName}_Start`;
            graph += `${startNode}((${funcName})):::startEnd\n`;
            registerMapping(startNode, func.body.startPosition.row);
            
            const ends = processBlock(func.body, [startNode]);
            
            let endEdgeLabel = null;
            const lastChild = func.body.lastNamedChild;
            if (lastChild && ['for_statement', 'while_statement'].includes(lastChild.type)) {
                endEdgeLabel = "False";
            }

            const endNode = `${funcName}_End`;
            graph += `${endNode}(((End))):::startEnd\n`;
            
            ends.forEach(e => {
                if (endEdgeLabel) graph += `${e} -->|${endEdgeLabel}| ${endNode}\n`;
                else graph += `${e} --> ${endNode}\n`;
            });
            
            graph += `end\n`;
        });

        if (functions.find(f => f.name === 'setup') && functions.find(f => f.name === 'loop')) {
            graph += `setup_End --> loop_Start\n`;
            graph += `loop_End --> loop_Start\n`;
        }

        graph += '\n' + clickEvents.join('\n');
        return { graph, mapping: lineMapping };

    } catch (e) {
        return { graph: `graph TD\nError["Error: ${e.message}"]`, mapping: {} };
    }
}

function sanitize(text) {
    if (!text) return "";
    return text.replace(/"/g, "'").replace(/[\r\n]+/g, ' ');
}

module.exports = { initParser, generateMermaidCode };