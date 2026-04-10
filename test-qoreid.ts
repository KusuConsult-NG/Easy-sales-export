import { qoreIdService } from './src/lib/qoreid';
import { loadEnvConfig } from '@next/env';

loadEnvConfig(process.cwd());

async function run() {
    try {
        console.log("Testing NIN...");
        const result = await qoreIdService.verifyNIN('55555555555', 'Test', 'User');
        console.log("NIN Result:", JSON.stringify(result, null, 2));

        console.log("Testing BVN...");
        const result2 = await qoreIdService.verifyBVN('22222222222', 'Test', 'User');
        console.log("BVN Result:", JSON.stringify(result2, null, 2));
    } catch (e) {
        console.error(e);
    }
}
run();
