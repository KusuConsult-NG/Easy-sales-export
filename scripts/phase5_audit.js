const fs = require('fs');
const path = require('path');

const dirsToScan = [
    path.join(__dirname, '../src/app/actions'),
    path.join(__dirname, '../src/app/api'),
];

function getAllFiles(dirPath, arrayOfFiles) {
    if (!fs.existsSync(dirPath)) return arrayOfFiles;

    const files = fs.readdirSync(dirPath);

    arrayOfFiles = arrayOfFiles || [];

    files.forEach(function (file) {
        if (fs.statSync(dirPath + "/" + file).isDirectory()) {
            arrayOfFiles = getAllFiles(dirPath + "/" + file, arrayOfFiles);
        } else {
            if (file.endsWith('.ts') || file.endsWith('.tsx')) {
                arrayOfFiles.push(path.join(dirPath, "/", file));
            }
        }
    });

    return arrayOfFiles;
}

let allFiles = [];
dirsToScan.forEach(dir => {
    allFiles = getAllFiles(dir, allFiles);
});

let report = `# Phase 5: Firestore Schema Consistency Audit\n\n`;
let totalIssues = 0;

allFiles.forEach(file => {
    const content = fs.readFileSync(file, 'utf8');
    const relativePath = path.relative(path.join(__dirname, '..'), file);

    if (!content.includes('.add({') && !content.includes('.set({') && !content.includes('.update({')) {
        return;
    }

    report += `## File: \`${relativePath}\`\n\n`;

    const lines = content.split('\n');
    let inWriteBlock = false;
    let blockContent = '';
    let braceCount = 0;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (!inWriteBlock && (line.includes('.add({') || line.includes('.set({') || line.includes('.update({'))) {
            inWriteBlock = true;
            blockContent = '';
            braceCount = 0;
            report += `### Match at line ${i + 1}:\n\`\`\`typescript\n`;
        }

        if (inWriteBlock) {
            blockContent += line + '\n';
            report += line + '\n';

            const opens = (line.match(/\{/g) || []).length;
            const closes = (line.match(/\}/g) || []).length;
            braceCount += opens - closes;

            // Wait for brace count to hit 0 and handle single-line statements
            if (braceCount <= 0 || (blockContent.split('\n').length > 40)) {
                // simple check for ending )
                if (line.includes(')') || blockContent.split('\n').length > 40) {
                    inWriteBlock = false;
                    report += `\`\`\`\n\n`;
                    totalIssues++;
                }
            }
        }
    }

    if (inWriteBlock) {
        report += `\`\`\`\n\n`;
        inWriteBlock = false;
        totalIssues++;
    }
});

fs.writeFileSync(path.join(__dirname, '../phase5_audit.md'), report);
console.log(`Phase 5 audit completed. Found ${totalIssues} DB write signatures. Saved to phase5_audit.md`);
