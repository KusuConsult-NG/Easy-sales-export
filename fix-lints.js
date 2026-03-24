const fs = require('fs');
const path = require('path');
const execSync = require('child_process').execSync;

function processFile(filePath) {
    let content = fs.readFileSync(filePath, 'utf8');
    let dirty = false;

    // 1. Replace @ts-ignore with @ts-expect-error
    if (content.includes('@ts-ignore')) {
        content = content.replace(/@ts-ignore/g, '@ts-expect-error');
        dirty = true;
    }

    // 2. Fix 'Cannot access ... before initialization' by disabling react-hooks/exhaustive-deps or pure reactivity
    // Wait, the better way is to move the useEffect down, or just move the function up.
    // For now, let's just insert a comment to disable the specific rules if they are on the line
    
    // Instead of complex AST parsing, let's just use regex to wrap simple state setters in setTimeout(..., 0)
    // Actually, setting state in effect is flagged by `react-compiler`. 
    // We can just add `// eslint-disable-next-line` to the lines? No, it's a compiler error, not just eslint.
    // Actually, it IS an eslint error: `react-compiler/react-compiler` or similar. The log says: `error  Error: Calling setState synchronously`.
    
    // Let's manually do the exact replacements for the files we saw.
    
    if (dirty) {
        fs.writeFileSync(filePath, content);
    }
}

function walkSync(dir, callback) {
    const files = fs.readdirSync(dir);
    files.forEach((file) => {
        const filepath = path.join(dir, file);
        const stats = fs.statSync(filepath);
        if (stats.isDirectory() && !filepath.includes('node_modules') && !filepath.includes('.git')) {
            walkSync(filepath, callback);
        } else if (stats.isFile() && (filepath.endsWith('.tsx') || filepath.endsWith('.ts'))) {
            callback(filepath);
        }
    });
}

walkSync(path.join(process.cwd(), 'src'), processFile);
walkSync(path.join(process.cwd(), 'scripts'), processFile);

console.log('Automated replacements done.');
