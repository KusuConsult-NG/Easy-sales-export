const fs = require('fs');
const path = require('path');

const actionDir = path.join(__dirname, '../src/app/actions');

function fixRoleChecks(dir) {
    const files = fs.readdirSync(dir);
    let patchedFiles = 0;

    files.forEach(file => {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
            patchedFiles += fixRoleChecks(fullPath);
        } else if (fullPath.endsWith('.ts')) {
            let content = fs.readFileSync(fullPath, 'utf8');

            // Match cases like: !userDoc.data()?.roles?.includes("admin")
            //    or   !session.user.roles?.includes("admin")
            // We want to avoid replacing if it already has "super_admin" right after it.

            let originalContent = content;

            // Regex to find `.includes("admin")` that is NOT immediately followed by `|| .*includes("super_admin")`
            // Simplest approach: do a pass replacing standard known bad strings.

            content = content.replace(/!userDoc\.data\(\)\?\.roles\?\.includes\("admin"\)(?!.*super_admin)/g,
                "(!userDoc.data()?.roles?.includes(\"admin\") && !userDoc.data()?.roles?.includes(\"super_admin\"))");

            content = content.replace(/!session\.user\.roles\?\.includes\("admin"\)(?!.*super_admin)/g,
                "(!session.user.roles?.includes(\"admin\") && !session.user.roles?.includes(\"super_admin\"))");

            content = content.replace(/!session\?\.user\?\.roles\?\.includes\("admin"\)(?!.*super_admin)/g,
                "(!session?.user?.roles?.includes(\"admin\") && !session?.user?.roles?.includes(\"super_admin\"))");

            if (content !== originalContent) {
                fs.writeFileSync(fullPath, content);
                patchedFiles++;
                console.log(`Patched role enforcement in: ${file}`);
            }
        }
    });

    return patchedFiles;
}

const totalPatched = fixRoleChecks(actionDir);
console.log(`Total files patched for super_admin parity: ${totalPatched}`);
