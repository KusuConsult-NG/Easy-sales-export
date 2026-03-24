import { config } from 'dotenv';
import * as fs from 'fs';

config({ path: '.env.local' });

async function fetchPaystackAbandoned() {
    const secretKey = process.env.PAYSTACK_SECRET_KEY;
    if (!secretKey) {
        throw new Error("Missing PAYSTACK_SECRET_KEY");
    }

    console.log("Querying Paystack API for abandoned transactions...");

    // We are looking for cooperative membership registrations
    // Note: Paystack pagination might be needed if there are more than 50
    const allAbandoned: any[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore && page <= 15) {
        console.log(`Fetching page ${page}...`);
        const response = await fetch(`https://api.paystack.co/transaction?perPage=50&page=${page}&status=abandoned`, {
            headers: {
                Authorization: `Bearer ${secretKey}`
            }
        });

        if (!response.ok) {
            hasMore = false;
            console.error("Paystack API error:", await response.text());
            break;
        }

        const data = await response.json();
        const txs = data.data;

        if (!txs || txs.length === 0) {
            hasMore = false;
            break;
        }

        for (const tx of txs) {
            // Filter out transactions that aren't cooperative membership 
            // Typically metadata contains the purpose
            const purpose = tx.metadata?.purpose;
            if (purpose === 'cooperative_membership_registration') {
                allAbandoned.push({
                    email: tx.customer?.email,
                    amount: tx.amount,
                    createdAt: tx.createdAt
                });
            } else if (!purpose && (tx.amount === 1000000 || tx.amount === 2000000)) {
                // Heuristic backup: 10k or 20k NGN in kobo
                allAbandoned.push({
                    email: tx.customer?.email,
                    amount: tx.amount,
                    createdAt: tx.createdAt,
                    heuristic: true
                });
            }
        }

        if (data.meta && data.meta.pageCount && page >= data.meta.pageCount) {
            hasMore = false;
        }
        page++;
    }

    console.log(`\nFound ${allAbandoned.length} total abandoned cooperative checkouts.`);

    // De-duplicate by email
    const uniqueEmails = new Map();
    for (const item of allAbandoned) {
        if (!uniqueEmails.has(item.email) || item.createdAt > uniqueEmails.get(item.email).createdAt) {
            uniqueEmails.set(item.email, item);
        }
    }

    const finalTargets = Array.from(uniqueEmails.values());
    console.log(`Unique targets to email: ${finalTargets.length}`);

    if (finalTargets.length > 0) {
        // Output to JSON for the next step
        fs.writeFileSync('paystack-abandoned-targets.json', JSON.stringify(finalTargets, null, 2));
        console.log("✅ Wrote targets to 'paystack-abandoned-targets.json'");
    }
}

fetchPaystackAbandoned().then(() => process.exit(0)).catch(e => {
    console.error(e);
    process.exit(1);
});
