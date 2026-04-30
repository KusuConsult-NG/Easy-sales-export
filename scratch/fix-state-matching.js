const fs = require('fs');

const files = [
    'src/app/actions/broadcast.ts',
    'src/app/actions/sms-broadcast.ts',
    'src/app/actions/in-app-broadcast.ts'
];

const helper = `
function isStateMatch(dbState: any, filterState: string | undefined): boolean {
    if (!filterState) return true;
    if (!dbState || typeof dbState !== 'string') return false;
    return dbState.toLowerCase().includes(filterState.toLowerCase());
}
`;

files.forEach(file => {
    let content = fs.readFileSync(file, 'utf8');
    
    if (!content.includes('function isStateMatch')) {
        content = content.replace(/(import .*;\n)+/, match => match + helper);
    }
    
    // if (filters.state && userState !== filters.state) continue;
    content = content.replace(/if\s*\(\s*filters\.state\s*&&\s*([a-zA-Z0-9_.]+)\s*!==\s*filters\.state\s*\)\s*continue;/g, 'if (filters.state && !isStateMatch($1, filters.state)) continue;');
    
    // if (filters.state && a.state !== filters.state && a.residentialState !== filters.state) continue;
    content = content.replace(/if\s*\(\s*filters\.state\s*&&\s*([a-zA-Z0-9_.]+)\s*!==\s*filters\.state\s*&&\s*([a-zA-Z0-9_.]+)\s*!==\s*filters\.state\s*\)\s*continue;/g, 'if (filters.state && !isStateMatch($1, filters.state) && !isStateMatch($2, filters.state)) continue;');
    
    // if (filters.state && a.state !== filters.state && a.stateOfResidence !== filters.state && a.residentialState !== filters.state) continue;
    content = content.replace(/if\s*\(\s*filters\.state\s*&&\s*([a-zA-Z0-9_.]+)\s*!==\s*filters\.state\s*&&\s*([a-zA-Z0-9_.]+)\s*!==\s*filters\.state\s*&&\s*([a-zA-Z0-9_.]+)\s*!==\s*filters\.state\s*\)\s*continue;/g, 'if (filters.state && !isStateMatch($1, filters.state) && !isStateMatch($2, filters.state) && !isStateMatch($3, filters.state)) continue;');
    
    // if (filters.state && v.address && v.address.state !== filters.state) continue;
    content = content.replace(/if\s*\(\s*filters\.state\s*&&\s*([a-zA-Z0-9_.]+)\s*&&\s*([a-zA-Z0-9_.]+)\s*!==\s*filters\.state\s*\)\s*continue;/g, 'if (filters.state && (!($1) || !isStateMatch($2, filters.state))) continue;');

    // if (filters.state && v.address?.state !== filters.state) continue;
    content = content.replace(/if\s*\(\s*filters\.state\s*&&\s*([a-zA-Z0-9_.]+\?\.state)\s*!==\s*filters\.state\s*\)\s*continue;/g, 'if (filters.state && !isStateMatch($1, filters.state)) continue;');

    // if (!f.userId || !u || userState !== filters.state) continue;
    content = content.replace(/if\s*\(\s*!f\.userId\s*\|\|\s*!u\s*\|\|\s*userState\s*!==\s*filters\.state\s*\)\s*continue;/g, 'if (!f.userId || !u || !isStateMatch(userState, filters.state)) continue;');

    // if (!u || userState !== filters.state) continue;
    content = content.replace(/if\s*\(\s*!u\s*\|\|\s*userState\s*!==\s*filters\.state\s*\)\s*continue;/g, 'if (!u || !isStateMatch(userState, filters.state)) continue;');

    fs.writeFileSync(file, content, 'utf8');
});

console.log("Replacements complete.");
