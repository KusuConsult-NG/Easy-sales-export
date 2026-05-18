import { db } from "../src/lib/firebase-admin";

async function fetchPaystackTransactions() {
    const secretKey = process.env.PAYSTACK_SECRET_KEY;
    if (!secretKey) {
        throw new Error("PAYSTACK_SECRET_KEY is missing from environment");
    }

    let allPaystackTransactions: any[] = [];
    let page = 1;
    let hasMore = true;

    console.log("Fetching transactions from Paystack...");
    while (hasMore) {
        const response = await fetch(`https://api.paystack.co/transaction?perPage=100&page=${page}&status=success`, {
            headers: {
                Authorization: `Bearer ${secretKey}`
            }
        });
        
        if (!response.ok) {
            console.error("Failed to fetch from Paystack", await response.text());
            break;
        }

        const data = await response.json();
        allPaystackTransactions = allPaystackTransactions.concat(data.data);

        console.log(`Fetched page ${page}, total so far: ${allPaystackTransactions.length}. Total on Paystack: ${data.meta.total}`);

        if (page < data.meta.pageCount) {
            page++;
        } else {
            hasMore = false;
        }
    }

    console.log(`Total Paystack transactions (success): ${allPaystackTransactions.length}`);

    // Fetch from Firebase
    const payments = await db.collection("processedPayments").where("status", "==", "completed").get();
    const dbReferences = new Set();
    payments.docs.forEach(doc => {
        dbReferences.add(doc.data().reference);
    });

    console.log(`Total Firebase processedPayments (completed): ${dbReferences.size}`);

    // Find missing
    const missingInFirebase = [];
    let academyAmounts = 0;
    let cooperativeAmounts = 0;

    for (const pt of allPaystackTransactions) {
        if (!dbReferences.has(pt.reference)) {
            missingInFirebase.push({
                reference: pt.reference,
                amount: pt.amount / 100, // Paystack is in kobo
                email: pt.customer?.email,
                date: pt.paid_at,
                channel: pt.channel
            });

            if (pt.amount / 100 === 10000 || pt.amount / 100 === 5000) {
                cooperativeAmounts++;
            } else if (pt.amount / 100 === 25000 || pt.amount / 100 === 50000 || pt.amount / 100 === 100000) {
                academyAmounts++;
            }
        }
    }

    console.log(`Missing in Firebase: ${missingInFirebase.length}`);
    console.log(`Missing Cooperative (10k/5k): ${cooperativeAmounts}`);
    console.log(`Missing Academy (25k/50k/100k): ${academyAmounts}`);

    if (missingInFirebase.length > 0) {
        const fs = require('fs');
        fs.writeFileSync('missing_paystack_transactions.json', JSON.stringify(missingInFirebase, null, 2));
        console.log("Saved missing transactions to missing_paystack_transactions.json");
    }
}

fetchPaystackTransactions().catch(console.error);
