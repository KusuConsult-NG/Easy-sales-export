const fs = require('fs');
const content = fs.readFileSync('phase5_audit.md', 'utf8');

const matches = content.split('### Match at line');
let missingTimestamps = [];

for (let i = 1; i < matches.length; i++) {
    const block = matches[i];
    const fileMatch = content.substring(0, content.indexOf(block)).match(/## File: `([^`]+)`[^`]*$/);
    const fileName = fileMatch ? fileMatch[1] : 'Unknown';
    const lineNumMatch = block.match(/^ (\d+):/);
    const lineNum = lineNumMatch ? lineNumMatch[1] : '?';

    // Check if it's an add/set or update
    const isCreate = block.includes('.add({') || block.includes('.set({');
    const isUpdate = block.includes('.update({');

    let missingFields = [];
    if (isCreate) {
        if (!block.includes('createdAt') && !block.includes('appliedAt') && !block.includes('enrollmentDate') && !block.includes('orderDate') && !block.includes('memberSince')) {
            missingFields.push('createdAt');
        }
    }

    if (isCreate || isUpdate) {
        if (!block.includes('updatedAt') && !block.includes('FieldValue.serverTimestamp()') && !block.includes('new Date()') && !block.includes('timestamp')) {
            // Somtimes other fields acts as updatedAt, but let's be strict
            // Actually, if it has serverTimestamp or new Date(), it's probably setting some time.
            if (!block.includes('updatedAt')) {
                missingFields.push('updatedAt');
            }
        }
    }

    if (missingFields.length > 0) {
        missingTimestamps.push(`${fileName}:${lineNum} - missing ${missingFields.join(', ')}`);
    }
}

console.log(`Found ${missingTimestamps.length} writes missing standard timestamps.`);
missingTimestamps.forEach(m => console.log(m));
