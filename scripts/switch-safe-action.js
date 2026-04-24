const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../src/app/actions/admin.ts');
let content = fs.readFileSync(filePath, 'utf8');

// Replace the import
content = content.replace('import { withSafeAction } from "@/lib/safe-action";', 'import { withFlexibleSafeAction } from "@/lib/safe-action";');

// Replace the usage
content = content.replace(/withSafeAction\(/g, 'withFlexibleSafeAction(');

fs.writeFileSync(filePath, content, 'utf8');
console.log("Switched to withFlexibleSafeAction in admin.ts");
