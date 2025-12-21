const Parser = require('web-tree-sitter');

let parser;

async function initParser(wasmPath) {
    await Parser.init();
    parser = new Parser();
    const Lang = await Parser.Language.load(wasmPath);
    parser.setLanguage(Lang);
}

function generateMermaidCode(code) {
    if (!parser) return 'graph TD\nError["Parser not initialized"]';

    try {
        // פיצול הקוד לשורות כדי שנוכל לשלוף הערות מותאמות אישית
        const sourceLines = code.split('\n');
        
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
        graph += 'classDef activeNode fill:#ffff00,stroke:#000000,stroke-width:3px;\n'; // עיצוב ללחיצה
        graph += 'GlobalStart((Start)):::startEnd --> setup_Start\n';

        // רשימה לאגירת אירועי לחיצה (כדי להוסיף אותם בסוף הגרף)
        let clickEvents = [];

        // --- פונקציית עזר לחילוץ תווית (Custom Label) ---
        function getLabel(node, fallbackType) {
            const lineIndex = node.startPosition.row;
            const originalLine = sourceLines[lineIndex] || "";
            
            // 1. בדיקה אם יש הערת קסם //\\
            const magicCommentMatch = originalLine.match(/\/\/\\\s*(.+)$/);
            if (magicCommentMatch) {
                // ניקוי תווים שיכולים לשבור את Mermaid
                return sanitize(magicCommentMatch[1].trim());
            }

            // 2. אם אין, לוקחים את הקוד הרגיל
            let rawText = node.text.split('\n')[0].trim().replace(/;/g, '');
            let label = sanitize(rawText.substring(0, 40));
            
            // 3. אם הקוד קצר מדי או לא ברור
            if (!label || label.length < 2) label = fallbackType || node.type;
            
            return label;
        }

        // --- פונקציית רישום לחיצה ---
        function registerClick(id, line) {
            // Mermaid syntax: click NodeID call jumpToLine(lineNumber)
            // שים לב: אנחנו מוסיפים 1 לשורה כי VS Code מתחיל מ-1 בממשק, אבל הקוד מצפה ל-0 לרוב. 
            // נשלח 0-based ונתקן בצד השני אם צריך. נשלח כאן את השורה המדויקת.
            clickEvents.push(`click ${id} call jumpToLine(${line})`);
        }

        // --- מנוע רקורסיבי ---
        function processBlock(node, incomingIds, edgeLabel = null) {
            if (!node) return incomingIds;

            if (node.type === 'ERROR') {
                const id = `N${node.id}`;
                graph += `${id}["Syntax Error"]\n`;
                registerClick(id, node.startPosition.row);
                
                incomingIds.forEach(prev => {
                    if (edgeLabel) graph += `${prev} -->|${edgeLabel}| ${id}\n`;
                    else graph += `${prev} --> ${id}\n`;
                });
                return [id];
            }

            if (node.type === 'compound_statement') {
                let currentIds = incomingIds;
                let isFirstChild = true;
                for (let i = 0; i < node.childCount; i++) {
                    const child = node.child(i);
                    const label = isFirstChild ? edgeLabel : null;
                    const nextIds = processBlock(child, currentIds, label);
                    if (nextIds.length > 0 && nextIds[0] !== currentIds[0]) {
                        currentIds = nextIds;
                        isFirstChild = false;
                    }
                }
                return currentIds;
            }

            if (['{', '}', ';', 'comment'].includes(node.type)) return incomingIds;

            const id = `N${node.id}`;
            const line = node.startPosition.row;

            // --- For Loop ---
            if (node.type === 'for_statement') {
                const initNode = node.childForFieldName('initializer');
                const condNode = node.childForFieldName('condition');
                const updateNode = node.childForFieldName('update');
                const bodyNode = node.childForFieldName('body');

                let currentIds = incomingIds;

                if (initNode) {
                    currentIds = processBlock(initNode, currentIds, edgeLabel);
                    edgeLabel = null;
                }

                const condId = condNode ? `N${condNode.id}` : `N${node.id}_COND`;
                // שימוש ב-getLabel כדי לתמוך ב-//\\ גם בלולאות
                const customLabel = getLabel(node, "Loop"); 
                // אם המשתמש שם תווית על ה-For, נציג אותה במעוין. אחרת נציג את התנאי.
                const displayLabel = customLabel !== "Loop" && !customLabel.startsWith("for") ? customLabel : (condNode ? sanitize(condNode.text) : "Loop");

                graph += `${condId}{"${displayLabel}?"}\n`;
                registerClick(condId, line);
                
                currentIds.forEach(prev => graph += `${prev} --> ${condId}\n`);

                const bodyEnds = processBlock(bodyNode, [condId], "True");

                let updateEnds = bodyEnds;
                if (updateNode) {
                    const upId = `N${updateNode.id}`;
                    graph += `${upId}["${sanitize(updateNode.text)}"]\n`;
                    // אין צורך בקליק על ה-Update בנפרד בדרך כלל, אבל אפשר
                    
                    bodyEnds.forEach(prev => graph += `${prev} --> ${upId}\n`);
                    updateEnds = [upId];
                }

                updateEnds.forEach(prev => graph += `${prev} --> ${condId}\n`);
                return [condId];
            }

            // --- While / If ---
            // לוגיקה דומה: משתמשים ב-getLabel כדי לבדוק אם יש הערה מיוחדת
            if (node.type === 'while_statement') {
                const condNode = node.child(1);
                const bodyNode = node.child(2);
                
                const condId = `N${condNode.id}`;
                const rawLabel = getLabel(node); // בדיקה בשורת ה-while
                // אם המשתמש לא נתן הערה, נשתמש בתנאי
                const label = rawLabel.includes("while") ? sanitize(condNode.text) : rawLabel;

                graph += `${condId}{"${label}?"}\n`;
                registerClick(condId, line);
                
                incomingIds.forEach(prev => {
                    if (edgeLabel) graph += `${prev} -->|${edgeLabel}| ${condId}\n`;
                    else graph += `${prev} --> ${condId}\n`;
                });
                edgeLabel = null;

                const bodyEnds = processBlock(bodyNode, [condId], "True");
                bodyEnds.forEach(end => graph += `${end} --> ${condId}\n`);
                return [condId]; 
            }

            if (node.type === 'if_statement') {
                const condNode = node.child(1);
                const thenNode = node.child(2);
                const elseNode = node.childCount > 3 ? node.child(3).child(1) : null;

                const ifId = `N${condNode.id}`;
                const rawLabel = getLabel(node);
                const label = rawLabel.includes("if") ? sanitize(condNode.text) : rawLabel;

                graph += `${ifId}{"${label}?"}\n`;
                registerClick(ifId, line);
                
                incomingIds.forEach(prev => {
                    if (edgeLabel) graph += `${prev} -->|${edgeLabel}| ${ifId}\n`;
                    else graph += `${prev} --> ${ifId}\n`;
                });
                edgeLabel = null;

                const thenEnds = processBlock(thenNode, [ifId], "Yes");
                const elseEnds = elseNode ? processBlock(elseNode, [ifId], "No") : [ifId];
                
                return [...thenEnds, ...elseEnds];
            }

            // --- Normal Statement ---
            let label = getLabel(node);
            
            let shapeL = '[', shapeR = ']';
            // אם זו קריאה לפונקציה
            if (node.type === 'expression_statement' && node.child(0).type === 'call_expression') {
                const funcName = node.child(0).child(0).text;
                if (!['digitalWrite', 'analogWrite', 'delay', 'Serial.println', 'random'].includes(funcName)) {
                    shapeL = '[['; shapeR = ']]'; 
                }
            }

            graph += `${id}${shapeL}"${label}"${shapeR}\n`;
            registerClick(id, line);

            incomingIds.forEach(prev => {
                if (prev !== id) {
                    if (edgeLabel) graph += `${prev} -->|${edgeLabel}| ${id}\n`;
                    else graph += `${prev} --> ${id}\n`;
                }
            });

            return [id];
        }

        // --- Build Graph ---
        functions.forEach(func => {
            const funcName = func.name;
            graph += `subgraph ${funcName}_Scope [${funcName}]\n`;
            
            const startNode = `${funcName}_Start`;
            graph += `${startNode}((${funcName})):::startEnd\n`;
            registerClick(startNode, func.body.startPosition.row);
            
            const ends = processBlock(func.body, [startNode]);
            
            const endNode = `${funcName}_End`;
            graph += `${endNode}(((End))):::startEnd\n`;
            
            ends.forEach(e => graph += `${e} --> ${endNode}\n`);
            graph += `end\n`;
        });

        if (functions.find(f => f.name === 'setup') && functions.find(f => f.name === 'loop')) {
            graph += `setup_End --> loop_Start\n`;
            graph += `loop_End --> loop_Start\n`;
        }

        // --- הוספת האירועים בסוף הגרף ---
        graph += '\n' + clickEvents.join('\n');

        return graph;

    } catch (e) {
        return `graph TD\nError["Error: ${e.message}"]`;
    }
}

function sanitize(text) {
    if (!text) return "";
    return text.replace(/"/g, "'").replace(/\n/g, ' ');
}

module.exports = { initParser, generateMermaidCode };