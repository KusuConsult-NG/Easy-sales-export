export function filterDocs(searchQuery: string) {
    let docs = [
        { data: () => ({ name: "John Doe", email: "john@example.com" }) },
        { data: () => ({ name: "Alice", email: "alice@example.com" }) }
    ];
    const searchLower = searchQuery.toLowerCase().trim();
    return docs.filter(doc => {
        const data = doc.data() as any;
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
}
