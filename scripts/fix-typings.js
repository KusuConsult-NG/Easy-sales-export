const fs = require('fs');
const files = [
    'src/app/actions/broadcast.ts',
    'src/app/actions/in-app-broadcast.ts',
    'src/app/actions/sms-broadcast.ts',
    'src/app/actions/admin-communications.ts',
    'src/app/actions/cooperative-admin.ts'
];
for(const f of files) {
    if(!fs.existsSync(f)) continue;
    let content = fs.readFileSync(f, 'utf8');
    content = content.replace(/let stream:\s*NodeJS\.ReadableStream;/g, 'let stream: any;');
    fs.writeFileSync(f, content);
}
console.log('done');
