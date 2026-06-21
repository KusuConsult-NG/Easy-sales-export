import * as fs from "fs";
import * as path from "path";

async function main() {
    const csvPath = path.join(process.cwd(), "cooperative_member_reconciliation.csv");
    if (!fs.existsSync(csvPath)) {
        console.error("CSV file not found at:", csvPath);
        return;
    }
    const csvContent = fs.readFileSync(csvPath, "utf8");
    const csvLines = csvContent.split("\n");
    console.log(`Total lines in CSV: ${csvLines.length}`);

    let activeCount = 0;
    let paidCount = 0;
    let activeAndPaidCount = 0;
    let activeAndPaidWithRef = 0;
    let activeAndPaidWithoutRef = 0;

    for (let i = 1; i < csvLines.length; i++) {
        const line = csvLines[i].trim();
        if (!line) continue;
        const parts = line.split(",").map(p => p.replace(/"/g, "").trim());
        if (parts.length >= 8) {
            const status = parts[7];
            const hasPaid = parts[6];
            const ref = parts[8] || "";

            const isActive = status === "active";
            const isPaid = hasPaid === "Yes";

            if (isActive) activeCount++;
            if (isPaid) paidCount++;
            if (isActive && isPaid) {
                activeAndPaidCount++;
                if (ref) {
                    activeAndPaidWithRef++;
                } else {
                    activeAndPaidWithoutRef++;
                }
            }
        }
    }

    console.log(`Active rows in CSV: ${activeCount}`);
    console.log(`Paid rows in CSV: ${paidCount}`);
    console.log(`Active & Paid rows in CSV: ${activeAndPaidCount}`);
    console.log(`- Active & Paid with reference: ${activeAndPaidWithRef}`);
    console.log(`- Active & Paid WITHOUT reference: ${activeAndPaidWithoutRef}`);
}

main();
