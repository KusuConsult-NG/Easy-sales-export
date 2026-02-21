const fs = require('fs');
const content = fs.readFileSync('src/types/index.ts', 'utf8');

const updatedContent = content
    .replace(/imageUrl\?: string;\n\}/g, "imageUrl?: string;\n    createdAt?: Date | any;\n    updatedAt?: Date | any;\n}")
    .replace(/actualReturn\?: number;\n\}/g, "actualReturn?: number;\n    createdAt?: Date | any;\n    updatedAt?: Date | any;\n}")
    .replace(/quality: "Standard" \| "Premium" \| "Organic";\n\}/g, "quality: \"Standard\" | \"Premium\" | \"Organic\";\n    createdAt?: Date | any;\n    updatedAt?: Date | any;\n}")
    .replace(/status: "active" \| "inactive" \| "suspended";\n\}/g, "status: \"active\" | \"inactive\" | \"suspended\";\n    createdAt?: Date | any;\n    updatedAt?: Date | any;\n}")
    .replace(/reference\?: string;\n\}/g, "reference?: string;\n    createdAt?: Date | any;\n    updatedAt?: Date | any;\n}")
    .replace(/reviewNotes\?: string;\n\}/g, "reviewNotes?: string;\n    createdAt?: Date | any;\n    updatedAt?: Date | any;\n}")
    .replace(/status: "upcoming" \| "open" \| "in_progress" \| "completed";\n\}/g, "status: \"upcoming\" | \"open\" | \"in_progress\" | \"completed\";\n    createdAt?: Date | any;\n    updatedAt?: Date | any;\n}")
    .replace(/certificateUrl\?: string;\n\}/g, "certificateUrl?: string;\n    createdAt?: Date | any;\n    updatedAt?: Date | any;\n}");

fs.writeFileSync('src/types/index.ts', updatedContent);
console.log("Appended createdAt and updatedAt fields successfully.");
