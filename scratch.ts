import { getMarketplaceUsersAction } from './src/app/actions/admin';
(async () => {
  const result = await getMarketplaceUsersAction({ limit: 50, search: "a" });
  console.log("Success:", result.success);
  console.log("Found:", result.data?.length);
})();
