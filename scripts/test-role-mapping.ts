import { getPrimaryApp } from "../src/lib/role-app-mapping";

const adminRoles: any[] = ["general_user", "admin"];
const superAdminRoles: any[] = ["general_user", "super_admin"];
const buyerRoles: any[] = ["general_user", "buyer"];

console.log("Admin Primary App:", getPrimaryApp(adminRoles));
console.log("Super Admin Primary App:", getPrimaryApp(superAdminRoles));
console.log("Buyer Primary App:", getPrimaryApp(buyerRoles));
