import { getStandardAcademyApplicationsAction } from "./src/app/actions/academy-admin";

async function run() {
    const result = await getStandardAcademyApplicationsAction({ limit: 5000 });
    console.log("Returned count:", result.data?.length);
    console.log("Total matched (meta):", result.meta?.total);
}
run();
