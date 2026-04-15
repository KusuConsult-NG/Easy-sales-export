import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import Module from 'module';
const originalRequire = Module.prototype.require;

// Mock requireSession and server-only
Module.prototype.require = function(request) {
  if (request === 'server-only') {
    return {};
  }
  if (request.includes('session-guard')) {
    return {
      requireSession: async () => ({ session: { user: { id: 'admin', roles: ['super_admin'] } }, error: null })
    };
  }
  return originalRequire.apply(this, arguments as any);
};

import { getUsersAction } from './src/app/actions/admin';
import { getCooperativeStatsAction } from './src/app/actions/cooperative-admin';

async function main() {
  const usersResult = await getUsersAction({});
  console.log('API Total Users Count (getUsersAction):', usersResult.totalCount);
  console.log('API Returned Users Length:', usersResult.users?.length);
  
  const statsResult = await getCooperativeStatsAction();
  console.log('API Total Coop Members Count (getCooperativeStatsAction):', statsResult.data?.stats?.totalMembers);
  process.exit(0);
}

main().catch(console.error);
