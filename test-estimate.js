const filters = { audience: "csv_upload", csvEmails: ["test@example.com"] };
fetch("http://localhost:3000/api/admin/broadcast/estimate", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(filters)
}).then(r => r.json()).then(console.log);
