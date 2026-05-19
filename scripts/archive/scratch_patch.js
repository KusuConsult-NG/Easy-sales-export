const fs = require('fs');
let code = fs.readFileSync('src/app/admin/wave/applications/page.tsx', 'utf8');

// 1. Imports
code = code.replace(
    /import { collection, query, where, orderBy, onSnapshot, Unsubscribe } from "firebase\/firestore";/,
    `import { StandardPendingForm } from "@/lib/types/admin";\nimport { getStandardWaveApplicationsAction } from "@/app/actions/wave-admin";`
);

code = code.replace(
    /import { FileText, CheckCircle, XCircle, Loader2, AlertCircle, Filter, Download, Pencil, X, Save } from "lucide-react";/,
    `import { FileText, CheckCircle, XCircle, Loader2, AlertCircle, Filter, Download, Pencil, X, Save, RefreshCw } from "lucide-react";`
);

// 2. Types
code = code.replace(
    /const \[applications, setApplications\] = useState<WaveApplication\[\]>\(\[\]\);/,
    `const [applications, setApplications] = useState<StandardPendingForm<WaveApplication>[]>([]);`
);

// 3. fetch logic
code = code.replace(
    /useEffect\(\(\) => \{[\s\S]*?\}, \[statusFilter\]\);/,
    `
    const fetchData = async () => {
        setIsLoading(true);
        setError(null);
        try {
            const res = await getStandardWaveApplicationsAction(statusFilter !== "all" ? statusFilter : "all");
            if (res.success) {
                setApplications(res.data || []);
            } else {
                setError(res.error || "Failed to load applications");
            }
        } catch (err) {
            setError("Error fetching applications");
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, [statusFilter]);
    `
);

// 4. Action refresh
code = code.replace(
    /\/\/ No need to manually update state — onSnapshot will fire automatically/g,
    `await fetchData();`
);
code = code.replace(
    /showToast\("Application rejected successfully", "success"\);/g,
    `showToast("Application rejected successfully", "success");\n        await fetchData();`
);

// 5. Mappers in render
code = code.replace(/\{getDisplayName\(app\)\}/g, `{app.user.name}`);
code = code.replace(/app\.email \|\| app\.userEmail/g, `app.user.email`);
code = code.replace(
    /app\.status/g,
    `app.status` // Wait, app.status is already correct for top-level, BUT I need to fix app.createdAt! It should be app.data.createdAt, app.data.phone
);

// Change app. properties to app.data.
code = code.replace(/app\.phone/g, `app.data.phone`);
code = code.replace(/app\.stateOfResidence/g, `app.data.stateOfResidence`);
code = code.replace(/app\.lgaOfResidence/g, `app.data.lgaOfResidence`);
code = code.replace(/app\.nin/g, `app.data.nin`);
code = code.replace(/app\.votersCardNumber/g, `app.data.votersCardNumber`);
code = code.replace(/app\.bvn/g, `app.data.bvn`);
code = code.replace(/app\.bankName/g, `app.data.bankName`);
code = code.replace(/app\.accountNumber/g, `app.data.accountNumber`);
code = code.replace(/app\.createdAt/g, `app.data.createdAt`);
code = code.replace(/app\.id/g, `app.id`); // This stays app.id
code = code.replace(/handleOpenEdit\(app\)/g, `handleOpenEdit(app.data as WaveApplication)`);

fs.writeFileSync('src/app/admin/wave/applications/page.tsx', code);
