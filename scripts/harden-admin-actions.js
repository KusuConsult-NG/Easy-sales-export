const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../src/app/actions/admin.ts');
let content = fs.readFileSync(filePath, 'utf8');

// Find all matches of `export async function someName(`
const regex = /^export\s+async\s+function\s+([a-zA-Z0-9_]+)\s*\(/gm;

let match;
const functionsToWrap = [];

while ((match = regex.exec(content)) !== null) {
    const funcName = match[1];
    functionsToWrap.push(funcName);
}

if (functionsToWrap.length === 0) {
    console.log("No functions found to wrap.");
    process.exit(0);
}

// Ensure withSafeAction is imported
if (!content.includes('withSafeAction')) {
    content = content.replace('"use server";', '"use server";\n\nimport { withSafeAction } from "@/lib/safe-action";');
}

// Replace exports with internal names
let newContent = content;
for (const funcName of functionsToWrap) {
    const exportRegex = new RegExp(`^export\\s+async\\s+function\\s+${funcName}\\s*\\(`, 'm');
    newContent = newContent.replace(exportRegex, `async function _${funcName}(`);
}

// Append exports at the bottom
newContent += "\n\n// --- SAFE ACTION WRAPPERS ---\n";
for (const funcName of functionsToWrap) {
    newContent += `export const ${funcName} = withSafeAction("${funcName}", _${funcName});\n`;
}

fs.writeFileSync(filePath, newContent, 'utf8');
console.log(`Wrapped ${functionsToWrap.length} actions in withSafeAction.`);
