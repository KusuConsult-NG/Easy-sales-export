const fs = require('fs');
const data = JSON.parse(fs.readFileSync('firestore.indexes.json', 'utf8'));

// Check if index already exists
const exists = data.indexes.some(idx => 
    idx.collectionGroup === 'exportWindows' && 
    idx.fields.length === 2 &&
    idx.fields[0].fieldPath === 'userId' &&
    idx.fields[1].fieldPath === 'status'
);

if (!exists) {
    data.indexes.push({
        "collectionGroup": "exportWindows",
        "queryScope": "COLLECTION",
        "fields": [
            { "fieldPath": "userId", "order": "ASCENDING" },
            { "fieldPath": "status", "order": "ASCENDING" }
        ]
    });
    fs.writeFileSync('firestore.indexes.json', JSON.stringify(data, null, 2));
    console.log("Added exportWindows index");
} else {
    console.log("Index already exists");
}
