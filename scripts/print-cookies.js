const https = require('https');
https.get("https://www.easysalesexport.com/api/auth/csrf", { headers: { "Accept": "application/json" } }, (res) => {
    console.log("Raw Set-Cookie header from Vercel:");
    console.log(res.headers['set-cookie']);
});
