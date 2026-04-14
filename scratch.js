const fs = require('fs');
const path = require('path');

function walkDir(dir, filter, callback) {
    fs.readdirSync(dir).forEach(f => {
        let dirPath = path.join(dir, f);
        let isDirectory = fs.statSync(dirPath).isDirectory();
        isDirectory ? 
            walkDir(dirPath, filter, callback) : 
            (filter(dirPath) && callback(dirPath));
    });
}

const suspiciousPatterns = [
    /set[A-Z]\w+\(\s*await \w+Action\(/, // setState(await somethingAction())
    /const (\w+) = await \w+Action\(.*?\);[\s\S]{0,100}set[A-Z]\w+\(\1\)/g, // const res = await somethingAction(); setState(res)
    /if\s*\(\s*(\w+)(?:\.success)?\s*\)\s*\{\s*set[A-Z]\w+\(\1\)/g, // if (res.success) { setState(res) }
];

walkDir('src/app', filePath => filePath.endsWith('.tsx') || filePath.endsWith('.ts'), filePath => {
    const code = fs.readFileSync(filePath, 'utf8');
    let matched = false;
    for (const pattern of suspiciousPatterns) {
        if (pattern.test(code)) {
            console.log(`Potential issue in: ${filePath}`);
            matched = true;
            break;
        }
    }
});
