require('tsconfig-paths/register');
import { _getMarketplaceUsersAction } from './src/app/actions/admin';
(async () => {
  try {
    const res = await _getMarketplaceUsersAction({ search: "a" });
    console.log("Success:", res.success);
    console.log("Data length:", res.data?.length);
  } catch (e) {
    console.error(e);
  }
})();
