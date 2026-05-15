const docs = [
  { data: () => ({ name: "Alice", email: "alice@example.com", phone: "123" }) },
  { data: () => ({ name: "Bob", email: "bob@example.com", phone: "456" }) }
];
const search = "alice";
const searchLower = search.toLowerCase().trim();
const filteredDocs = docs.filter(doc => {
    const data = doc.data();
    const searchString = [
        data.name,
        data.fullName,
        data.firstName,
        data.lastName,
        data.email,
        data.phone,
        data.phoneNumber,
        data.businessName
    ].filter(Boolean).map(String).join(" ").toLowerCase();
    return searchString.includes(searchLower);
});
console.log(filteredDocs.map(d => d.data().name));
