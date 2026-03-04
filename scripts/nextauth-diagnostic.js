const https = require('https');

async function runDiagnostic() {
    const targetUrl = "https://www.easysalesexport.com";
    console.log(`[STEP 1] Fetching CSRF Token from ${targetUrl}...`);
    
    const csrfReq = https.get(`${targetUrl}/api/auth/csrf`, { headers: { "Accept": "application/json" } }, (csrfRes) => {
        let csrfDataStr = '';
        csrfRes.on('data', d => csrfDataStr += d);
        csrfRes.on('end', () => {
            const csrfData = JSON.parse(csrfDataStr);
            const csrfToken = csrfData.csrfToken;
            const cookies = csrfRes.headers['set-cookie'] || [];
            
            console.log(`✅ CSRF Token Acquired: ${csrfToken ? csrfToken.substring(0, 10) : 'MISSING'}...`);
            
            const payload = new URLSearchParams({
                email: "test@example.com",
                password: "password123",
                redirect: "false",
                callbackUrl: `${targetUrl}/dashboard`,
                csrfToken: csrfToken
            }).toString();

            console.log(`\n[STEP 2] Simulating LoginForm.tsx POST request...`);
            const urlObj = new URL(`${targetUrl}/api/auth/callback/credentials`);

            const options = {
                hostname: urlObj.hostname,
                port: urlObj.port,
                path: urlObj.pathname + urlObj.search,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Content-Length': Buffer.byteLength(payload),
                    'Cookie': cookies,
                    'User-Agent': 'NextAuth-Diagnostic-Script/1.0',
                    'Origin': targetUrl,
                    'Referer': `${targetUrl}/auth/login`
                }
            };

            const req = https.request(options, (res) => {
                console.log(`\n[STEP 3] Response Received! Status: ${res.statusCode}`);
                console.log(`Location: ${res.headers.location || 'None'}`);
                let data = '';
                res.on('data', (c) => data += c);
                res.on('end', () => console.log(`Body: ${data.substring(0, 200)}`));
            });
            req.write(payload);
            req.end();
        });
    });
}
runDiagnostic();
