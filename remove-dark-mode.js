#!/usr/bin/env node

/**
 * Script to remove all dark mode classes from the codebase
 * Usage: node remove-dark-mode.js
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('🔍 Finding files with dark mode classes...');

// Find all TypeScript and TSX files in src directory
const files = execSync('find src -type f \\( -name "*.tsx" -o -name "*.ts" \\)', {
    cwd: __dirname,
    encoding: 'utf-8'
}).trim().split('\n');

console.log(`📁 Found ${files.length} files to process`);

let totalFilesModified = 0;
let totalOccurrencesRemoved = 0;

files.forEach((file) => {
    const filePath = path.join(__dirname, file);

    try {
        let content = fs.readFileSync(filePath, 'utf-8');
        const originalContent = content;

        // Remove all dark: classes using regex
        // This matches patterns like: dark:bg-slate-900, dark:text-white, dark:hover:bg-blue-500, etc.
        content = content.replace(/\s+dark:[a-zA-Z0-9\-_:\/\[\]\.%]+/g, '');

        if (content !== originalContent) {
            fs.writeFileSync(filePath, content, 'utf-8');
            totalFilesModified++;

            // Count occurrences removed
            const occurrences = (originalContent.match(/\s+dark:[a-zA-Z0-9\-_:\/\[\]\.%]+/g) || []).length;
            totalOccurrencesRemoved += occurrences;

            console.log(`✅ ${file} (${occurrences} dark classes removed)`);
        }
    } catch (error) {
        console.error(`❌ Error processing ${file}:`, error.message);
    }
});

console.log('\n✨ Dark mode removal complete!');
console.log(`📊 Modified ${totalFilesModified} files`);
console.log(`🗑️  Removed ${totalOccurrencesRemoved} dark mode class references`);
