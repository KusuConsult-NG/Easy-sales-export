import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { qoreIdService } from '../src/lib/qoreid';

async function testVerification() {
    console.log('Testing QoreID Service Authentication and Endpoints...\n');

    const dummyBvn = '11111111111';
    const dummyNin = '11111111111';
    const firstName = 'Test';
    const lastName = 'User';

    console.log('--- Testing BVN ---');
    try {
        const bvnResult = await qoreIdService.verifyBVN(dummyBvn, firstName, lastName);
        console.log('BVN Result:', JSON.stringify(bvnResult, null, 2));
    } catch (e: any) {
        console.error('BVN Test Failed:', e.message);
    }

    console.log('\n--- Testing NIN ---');
    try {
        const ninResult = await qoreIdService.verifyNIN(dummyNin, firstName, lastName);
        console.log('NIN Result:', JSON.stringify(ninResult, null, 2));
    } catch (e: any) {
        console.error('NIN Test Failed:', e.message);
    }
}

testVerification().then(() => {
    console.log('\nTests completed.');
    process.exit(0);
}).catch(e => {
    console.error('Test Execution Error', e);
    process.exit(1);
});
