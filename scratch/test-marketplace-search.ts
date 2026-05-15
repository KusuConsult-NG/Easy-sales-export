import { getMarketplaceUsersAction } from "./src/app/actions/admin";

async function main() {
  const result = await getMarketplaceUsersAction({ search: "a" });
  console.log("Found:", result?.data?.length);
  if (result?.data?.length) {
    console.log(result.data[0]);
  }
}
main().catch(console.error);
