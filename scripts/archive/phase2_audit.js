const fs = require('fs');
const path = require('path');

const inventoryPath = path.join(process.cwd(), 'route_inventory.md');
if (!fs.existsSync(inventoryPath)) {
    console.error("No inventory found.");
    process.exit(1);
}

const lines = fs.readFileSync(inventoryPath, 'utf8').split('\n');
const pages = [];

// Parse inventory table
for (const line of lines) {
    if (line.trim().startsWith('|') && !line.includes('---|') && !line.includes('Route Path')) {
        const parts = line.split('|').map(p => p.trim());
        if (parts.length >= 7) {
            const filePath = parts[2].replace(/`/g, '');
            const type = parts[3];
            if ((type.includes('Page') || type.includes('Layout')) && !type.includes('DEAD')) {
                pages.push(filePath);
            }
        }
    }
}

let report = `# Phase 2: Route Certification Loop\n\n`;
report += `| File | Issues Found |\n|---|---|\n`;

let totalIssues = 0;

pages.forEach(file => {
    const fullPath = path.join(process.cwd(), file);
    if (!fs.existsSync(fullPath)) return;

    const content = fs.readFileSync(fullPath, 'utf8');
    const issues = [];

    // A. Rendering Safety
    if (/\w!\./.test(content) || /\w!\s/.test(content)) issues.push('Unsafe non-null assertion (!)');
    if (content.includes('as any')) issues.push('Usage of `as any`');

    // Check if async data fetch exists without try/catch (heuristic)
    if (content.includes('async function') || content.includes('async (')) {
        if ((content.includes('fetch(') || content.includes('db.collection')) && !content.includes('try {')) {
            issues.push('Async data fetch without try/catch');
        }
    }

    // D. UI Completion
    if (content.includes('console.log')) issues.push('Leftover console.log');
    if (content.includes('TODO:') || content.includes('TODO ')) issues.push('TODO comments found');
    if (content.includes('Mock') || content.includes('Dummy') || content.includes('placeholder')) {
        issues.push('Potential mock data/placeholder strings found');
    }

    if (issues.length > 0) {
        report += `| \`${file}\` | ${issues.join(', ')} |\n`;
        totalIssues += issues.length;
    }
});

if (totalIssues === 0) {
    report += `| All Pages | No static issues detected. |\n`;
}

fs.writeFileSync('phase2_audit.md', report);
console.log(`Phase 2 completed. ${totalIssues} issues found. Saved to phase2_audit.md`);
