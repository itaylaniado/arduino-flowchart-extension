const Parser = require('web-tree-sitter');

let parser;

async function initParser(wasmPath) {
    await Parser.init();
    parser = new Parser();
    const Lang = await Parser.Language.load(wasmPath);
    parser.setLanguage(Lang);
}

function generateMermaidCode(code) {
    if (!parser) return { graph: 'flowchart TD\nError["Parser not initialized"]', mapping: {} };

    try {
        const sourceLines = code.split(/\r?\n/);
        const cleanCode = code.replace(/\u00A0/g, ' ');
        const tree = parser.parse(cleanCode);
        const root = tree.rootNode;

        let definedFunctions = new Set();
        let functions = [];
        
        for (let i = 0; i < root.childCount; i++) {
            const child = root.child(i);
            if (child.type === 'function_definition') {
                const nameNode = child.child(1).child(0);
                const bodyNode = child.child(2);
                if (nameNode && bodyNode) {
                    functions.push({ name: nameNode.text, body: bodyNode });
                    definedFunctions.add(nameNode.text);
                }
            }
        }

        // הגדרת ELK Layout
        let graph = '---\nconfig:\n  fontFamily: Heebo\n  layout: elk\n  elk:\n    mergeEdges:true\n    cycleBreakingStrategy:DEPTH_FIRST\n    mergeEdges:true\n    nodePlacementStrategy:NETWORK_SIMPLEX\n---\nflowchart TD\n';
        
        graph += 'classDef startEnd stroke-width:2px;\n';
        graph += 'classDef activeNode stroke-width:2px;\n';
        graph += 'classDef loopHex stroke-width:1.5px;\n';
        
        if (definedFunctions.has('setup')) {
            graph += 'GlobalStart((Start)):::startEnd --> setup_Start\n';
        }

        let clickEvents = [];
        let lineMapping = {}; 
        let crossFunctionEdges = [];

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
            
            // בדיקת הערות קסם //\\
            const magicMatch = originalLine.match(/\/\/\\\s*(.*)$/);
            if (magicMatch && magicMatch[1]) {
                // TIKUN: החלפת פסיקים בירידת שורה (<br/>) רק בתוך הטקסט המותאם
                let customText = sanitize(magicMatch[1].trim());
                return customText.replace(/,/g, '<br/>');
            }
            
            let rawText = node.text.split('\n')[0].trim().replace(/;/g, '');
            let label = sanitize(rawText.substring(0, 40));
            if (!label || label.length < 2) label = fallbackType || node.type;
            return label;
        }

        // פונקציית עזר לבדיקה אם יש הערת קסם בשורה
        function hasMagicComment(lineIndex) {
            const line = sourceLines[lineIndex] || "";
            return line.includes('//\\');
        }

        function processBlock(node, incomingIds, edgeLabel = null, context = {}) {
            if (!node) return incomingIds;
            if (incomingIds.length === 0) return [];

            const startLine = node.startPosition.row;
            const endLine = node.endPosition.row;

            // בדיקת הסתרה (Magic Comment //*)
            const originalLine = sourceLines[startLine] || "";
            if (originalLine.trim().endsWith('//*')) {
                return incomingIds; 
            }

            // --- Compound Block ---
            if (node.type === 'compound_statement') {
                let currentIds = incomingIds;
                let nextEdgeLabel = edgeLabel;

                for (let i = 0; i < node.childCount; i++) {
                    const child = node.child(i);
                    if (['{', '}', ';', 'comment'].includes(child.type)) continue;

                    if (currentIds.length === 0) break;

                    const nextIds = processBlock(child, currentIds, nextEdgeLabel, context);
                    currentIds = nextIds;
                    
                    if (['for_statement', 'while_statement'].includes(child.type)) {
                        nextEdgeLabel = "False";
                    } else {
                        nextEdgeLabel = null;
                    }
                }
                return currentIds;
            }

            // --- Return Statement ---
            if (node.type === 'return_statement') {
                const id = `N${node.id}`;
                let label = "";

                if (hasMagicComment(startLine)) {
                    label = getLabel(node);
                } else {
                    label = "return";
                    if (node.childCount > 1) { 
                        const retValNode = node.child(1);
                        if (retValNode && retValNode.text !== ';') {
                            label += " " + sanitize(retValNode.text);
                        }
                    }
                }
                
                graph += `${id}["${label}"]\n`;
                registerMapping(id, startLine, endLine);
                
                incomingIds.forEach(prev => {
                    const edge = edgeLabel ? `|${edgeLabel}|` : '';
                    graph += `${prev} -->${edge} ${id}\n`;
                });

                if (context.currentFuncName) {
                    graph += `${id} --> ${context.currentFuncName}_End\n`;
                }

                return []; 
            }

            // --- Break Statement ---
            if (node.type === 'break_statement') {
                const id = `N${node.id}`;
                let label = "break";

                if (hasMagicComment(startLine)) {
                    label = getLabel(node);
                }

                graph += `${id}["${label}"]\n`;
                registerMapping(id, startLine, endLine);

                incomingIds.forEach(prev => {
                    const edge = edgeLabel ? `|${edgeLabel}|` : '';
                    graph += `${prev} -->${edge} ${id}\n`;
                });

                if (context.breaks) {
                    context.breaks.push(id);
                }

                return []; 
            }

            if (['{', '}', ';', 'comment'].includes(node.type)) return incomingIds;

            const id = `N${node.id}`;

            // --- For Loop (שוחזר) ---
            if (node.type === 'for_statement') {
                const initNode = node.childForFieldName('initializer');
                const condNode = node.childForFieldName('condition');
                const updateNode = node.childForFieldName('update');
                const bodyNode = node.childForFieldName('body');

                let entryId;
                if (initNode) entryId = `N${initNode.id}`;
                else if (condNode) entryId = `N${condNode.id}`;
                else entryId = `N${node.id}_COND`;

                const loopScopeId = `LoopScope_${node.id}`;
                const customLabel = getLabel(node, "Loop");
                const scopeTitle = customLabel !== "Loop" && !customLabel.startsWith("for") ? customLabel : "For Loop";
                
                graph += `subgraph ${loopScopeId} [${scopeTitle}]\n`;

                if (initNode) {
                    const initLabel = sanitize(initNode.text.replace(/;/g, ''));
                    graph += `${entryId}["${initLabel}"]\n`; 
                    registerMapping(entryId, initNode.startPosition.row, initNode.endPosition.row);
                }

                incomingIds.forEach(prev => {
                    const edge = edgeLabel ? `|${edgeLabel}|` : '';
                    graph += `${prev} -->${edge} ${entryId}\n`;
                });

                const condId = condNode ? `N${condNode.id}` : `N${node.id}_COND`;
                const condText = condNode ? sanitize(condNode.text) : "true";
                
                graph += `${condId}{{"${condText}?"}}:::loopHex\n`;
                registerMapping(condId, startLine); 
                
                if (initNode) {
                    graph += `${entryId} --> ${condId}\n`;
                }
                
                const loopContext = { ...context, breaks: [] };
                const bodyEnds = processBlock(bodyNode, [condId], "True", loopContext);

                let updateEnds = bodyEnds;
                if (bodyEnds.length > 0) {
                    if (updateNode) {
                        const upId = `N${updateNode.id}`;
                        graph += `${upId}["${sanitize(updateNode.text)}"]\n`;
                        registerMapping(upId, updateNode.startPosition.row, updateNode.endPosition.row);
                        bodyEnds.forEach(prev => graph += `${prev} --> ${upId}\n`);
                        updateEnds = [upId];
                    }
                    updateEnds.forEach(prev => graph += `${prev} --> ${condId}\n`);
                }

                graph += `end\n`; 

                return [condId, ...loopContext.breaks];
            }

            // --- While Loop (שוחזר) ---
            if (node.type === 'while_statement') {
                const condNode = node.child(1);
                const bodyNode = node.child(2);
                const condId = `N${condNode.id}`;
                const customLabel = getLabel(node, "");
                const label = (customLabel && !customLabel.includes("while")) ? customLabel : sanitize(condNode.text);

                graph += `${condId}{{"${label}?"}}:::loopHex\n`;
                registerMapping(condId, startLine);
                
                incomingIds.forEach(prev => {
                    const edge = edgeLabel ? `|${edgeLabel}|` : '';
                    graph += `${prev} -->${edge} ${condId}\n`;
                });
                
                const loopContext = { ...context, breaks: [] };
                const bodyEnds = processBlock(bodyNode, [condId], "True", loopContext);
                
                if (bodyEnds.length > 0) {
                    bodyEnds.forEach(end => graph += `${end} --> ${condId}\n`);
                }
                
                return [condId, ...loopContext.breaks]; 
            }

            // --- If Statement (שוחזר) ---
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
                    const edge = edgeLabel ? `|${edgeLabel}|` : '';
                    graph += `${prev} -->${edge} ${ifId}\n`;
                });
                
                const thenEnds = processBlock(thenNode, [ifId], "Yes", context);
                const elseEnds = elseNode ? processBlock(elseNode, [ifId], "No", context) : [ifId];
                
                return [...thenEnds, ...elseEnds];
            }

            // --- Switch Statement ---
            if (node.type === 'switch_statement') {
                const condNode = node.child(1);
                const bodyNode = node.child(2);
                const switchId = `N${condNode.id}`;
                const customLabel = getLabel(node, "");
                const label = (customLabel && !customLabel.includes("switch")) ? customLabel : sanitize(condNode.text);

                graph += `${switchId}{"${label}?"}\n`;
                registerMapping(switchId, startLine);

                incomingIds.forEach(prev => {
                    const edge = edgeLabel ? `|${edgeLabel}|` : '';
                    graph += `${prev} -->${edge} ${switchId}\n`;
                });

                let switchEnds = [];
                let hasDefault = false;
                let previousCaseEnds = [];
                
                const switchContext = { ...context, breaks: [] };

                if (bodyNode.type === 'compound_statement') {
                    for (let i = 0; i < bodyNode.childCount; i++) {
                        const child = bodyNode.child(i);
                        
                        if (child.type === 'case_statement') {
                            let caseLabel = "case";
                            if (child.childCount > 1) {
                                const valNode = child.child(1);
                                if (valNode.type !== ':') {
                                     caseLabel = sanitize(valNode.text);
                                }
                            }
                            
                            const caseId = `N${child.id}`;
                            const caseText = `case ${caseLabel}`;
                            graph += `${caseId}["${caseText}"]\n`;
                            registerMapping(caseId, child.startPosition.row);
                            
                            graph += `${switchId} --> ${caseId}\n`;
                            
                            previousCaseEnds.forEach(prev => {
                                graph += `${prev} --> ${caseId}\n`;
                            });
                            
                            const caseEnds = processBlock(child, [caseId], null, switchContext);
                            previousCaseEnds = caseEnds;
                            
                        } else if (child.type === 'default_statement') {
                            hasDefault = true;
                            const defaultId = `N${child.id}`;
                            graph += `${defaultId}["default"]\n`;
                            registerMapping(defaultId, child.startPosition.row);
                            
                            graph += `${switchId} --> ${defaultId}\n`;
                            previousCaseEnds.forEach(prev => graph += `${prev} --> ${defaultId}\n`);
                            
                            const defaultEnds = processBlock(child, [defaultId], null, switchContext);
                            previousCaseEnds = defaultEnds;
                        }
                    }
                }
                
                switchEnds.push(...previousCaseEnds);
                
                if (!hasDefault) {
                    switchEnds.push(switchId); 
                }
                
                switchEnds.push(...switchContext.breaks);

                return switchEnds;
            }

            // --- Case / Default Statement ---
            if (node.type === 'case_statement' || node.type === 'default_statement') {
                let currentIds = incomingIds;
                let nextEdgeLabel = edgeLabel;
                let startProcessing = false;

                for (let i = 0; i < node.childCount; i++) {
                    const child = node.child(i);
                    if (child.type === ':') {
                        startProcessing = true;
                        continue;
                    }
                    if (!startProcessing) continue;
                    
                    if (['{', '}', ';', 'comment'].includes(child.type)) continue;
                    
                    if (currentIds.length === 0) break;

                    const nextIds = processBlock(child, currentIds, nextEdgeLabel, context);
                    currentIds = nextIds;
                    nextEdgeLabel = null; 
                }
                return currentIds;
            }

            // --- Generic Statement / Function Call ---
            let label = getLabel(node);
            let shapeL = '(', shapeR = ')';
            let isCall = false;
            let targetFunc = null;

            if (node.type === 'expression_statement' && node.child(0).type === 'call_expression') {
                const funcName = node.child(0).child(0).text;
                if (definedFunctions.has(funcName)) {
                    isCall = true;
                    targetFunc = funcName;
                    shapeL = '(['; shapeR = '])'; 
                } else if (!['digitalWrite', 'analogWrite', 'delay', 'Serial.println', 'random'].includes(funcName)) {
                    shapeL = '(['; shapeR = '])'; 
                }
            }

            graph += `${id}${shapeL}"${label}"${shapeR}\n`;
            registerMapping(id, startLine, endLine);

            if (isCall && targetFunc) {
                crossFunctionEdges.push(`${id} -.-> ${targetFunc}_Start`);
            }

            incomingIds.forEach(prev => {
                const edge = edgeLabel ? `|${edgeLabel}|` : '';
                graph += `${prev} -->${edge} ${id}\n`;
            });
            return [id];
        }

        // --- Process Functions ---
        functions.forEach(func => {
            const funcName = func.name;
            graph += `subgraph ${funcName}_Scope [${funcName}]\n`;
            const startNode = `${funcName}_Start`;
            graph += `${startNode}([${funcName}]):::startEnd\n`;
            registerMapping(startNode, func.body.startPosition.row);
            
            const ends = processBlock(func.body, [startNode], null, { currentFuncName: funcName });
            
            const endNode = `${funcName}_End`;
            graph += `${endNode}(((End))):::startEnd\n`;
            
            ends.forEach(e => {
                 graph += `${e} --> ${endNode}\n`;
            });
            
            graph += `end\n`;
        });

        if (functions.find(f => f.name === 'setup') && functions.find(f => f.name === 'loop')) {
            graph += `setup_End --> loop_Start\n`;
        }

        if (crossFunctionEdges.length > 0) {
            graph += crossFunctionEdges.join('\n') + '\n';
        }

        graph += '\n' + clickEvents.join('\n');
        return { graph, mapping: lineMapping };

    } catch (e) {
        return { graph: `flowchart TD\nError["Error: ${e.message}"]`, mapping: {} };
    }
}

function sanitize(text) {
    if (!text) return "";
    return text
        .replace(/\\/g, '\\\\') 
        .replace(/"/g, "'")     
        .replace(/[\r\n]+/g, ' ') 
        .trim();
}

module.exports = { initParser, generateMermaidCode };