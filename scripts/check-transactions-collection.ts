import { db } from "../src/lib/firebase-admin";

async function checkTransactions() {
    const ts = await db.collection("transactions").where("status", "==", "completed").get();
    const typeCount: Record<string, number> = {};
    const amountCount: Record<number, number> = {};
    
    let academyTransactionCount = 0;

    ts.docs.forEach(doc => {
        const p = doc.data();
        const type = p.type || p.purpose || "unknown";
        typeCount[type] = (typeCount[type] || 0) + 1;
        amountCount[p.amount] = (amountCount[p.amount] || 0) + 1;
        
        if (type.includes("academy") || p.amount === 25000 || p.amount === 50000 || p.amount === 100000) {
            academyTransactionCount++;
        }
    });

    console.log("Transactions Types:");
    console.table(typeCount);
    console.log("Transactions Amounts:");
    console.table(amountCount);
    console.log(`Transactions with academy type or amount: ${academyTransactionCount}`);
}

checkTransactions().catch(console.error);
