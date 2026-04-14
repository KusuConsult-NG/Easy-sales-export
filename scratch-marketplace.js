const fs = require('fs');

const file = 'src/app/actions/marketplace.ts';
let code = fs.readFileSync(file, 'utf8');

// Instead of `{ success: true, verification }`, make it `{ success: true, data: { verification } }`
// Basically any `return { success: true, (something not data)... }`
code = code.replace(/return\s*\{\s*success:\s*true,\s*(?!data:|message:)([^}]+)\}/g, (match, p1) => {
    // If it already has data:, skip
    if (p1.includes('data:')) return match;
    // We group everything else into data
    return `return { success: true, data: { ${p1.trim()} } }`;
});

code = code.replace(/return\s*\{\s*success:\s*true\s*\}/g, 'return { success: true, data: null }');

fs.writeFileSync(file, code);
console.log('Done mapping marketplace actions.');
