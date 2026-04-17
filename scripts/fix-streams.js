const fs = require('fs');

const files = [
    'src/app/actions/broadcast.ts',
    'src/app/actions/in-app-broadcast.ts',
    'src/app/actions/sms-broadcast.ts',
    'src/app/actions/admin-communications.ts',
    'src/app/actions/cooperative-admin.ts'
];

for (const filepath of files) {
    if (!fs.existsSync(filepath)) continue;
    let content = fs.readFileSync(filepath, 'utf8');
    
    // Pattern 1:
    // const stream = ...stream();
    // changes to
    // const stream = await ...get();
    content = content.replace(/(const (\w+) =)\s+(.*?)\.stream\(\);/g, (match, prefix, varName, query) => {
        // Only insert await if it doesn't already have one
        if (query.trim().startsWith('await ')) {
           return `${prefix} ${query}.get();`;
        }
        return `${prefix} await ${query}.get();`;
    });

    // Patterns like:
    // let stream = query.where(...).stream();
    content = content.replace(/(let (\w+)[^=]*=)\s+(.*?)\.stream\(\);/g, (match, prefix, varName, query) => {
        if (query.trim().startsWith('await ')) {
           return `${prefix} ${query}.get();`;
        }
        return `${prefix} await ${query}.get();`;
    });
    
    // Also handle assignments:
    // stream = query.where(...).stream();
    content = content.replace(/^(\s*)(\w+)\s*=\s*(.*?)\.stream\(\);/gm, (match, indent, varName, query) => {
        if (query.trim().startsWith('await ')) {
           return `${indent}${varName} = ${query}.get();`;
        }
        return `${indent}${varName} = await ${query}.get();`;
    });

    // Pattern 2:
    // for await (const d of stream as any) {
    // changes to
    // for (const d of stream.docs) {
    content = content.replace(/for await\s*\(\s*const\s+(\w+)\s+of\s+(\w+)\s*(?:as any)?\s*\)\s*\{/g, (match, docName, streamVar) => {
        return `for (const ${docName} of ${streamVar}.docs) {`;
    });
    
    fs.writeFileSync(filepath, content);
}
console.log("Done");
