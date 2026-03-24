import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function testToken() {
    const clientId = process.env.QOREID_CLIENT_ID;
    const secretKey = process.env.QOREID_SECRET_KEY;
    console.log("clientId present:", !!clientId);
    console.log("secretKey present:", !!secretKey);

    try {
        const response = await fetch('https://api.qoreid.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId, secret: secretKey }),
        });

        const data = await response.json();
        console.log("Token Response Status:", response.status);
        console.log("Token Response Data:", data);
        
        if (data.accessToken) {
            console.log("Trying a dummy BVN lookup...");
            const bvnResp = await fetch('https://api.qoreid.com/v1/ng/identities/bvn-basic/11111111111', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${data.accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ firstname: 'Test', lastname: 'User' })
            });
            const bvnData = await bvnResp.json();
            console.log("BVN Response Status:", bvnResp.status);
            console.log("BVN Response:", JSON.stringify(bvnData, null, 2));
        }

    } catch (e) {
        console.error("Fetch failed:", e);
    }
}

testToken().catch(console.error);
