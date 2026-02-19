import { getBriefingRegistrationsAction } from "@/app/actions/briefing-admin";
import ResponsiveTable, { Column } from "@/components/ui/ResponsiveTable";
import { format } from "date-fns";
import { ArrowLeft, Download, Users } from "lucide-react";
import Link from "next/link";
import { BriefingRegistration } from "@/app/actions/briefing-admin";

export default async function BriefingRegistrationsPage() {
    const { data, success, error } = await getBriefingRegistrationsAction();

    if (!success) {
        return (
            <div className="p-8">
                <div className="bg-red-50 text-red-600 p-4 rounded-xl border border-red-100">
                    Error loading registrations: {error}
                </div>
            </div>
        );
    }

    const columns: Column<BriefingRegistration>[] = [
        {
            header: "Name",
            accessor: "fullName",
            className: "font-medium text-slate-900"
        },
        {
            header: "Email",
            accessor: "email",
            className: "text-slate-500"
        },
        {
            header: "Phone",
            accessor: "phoneNumber",
            hideOnMobile: true
        },
        {
            header: "State",
            accessor: "state",
            hideOnMobile: true
        },
        {
            header: "Role",
            accessor: (item: BriefingRegistration) => (
                <span className="capitalize bg-slate-100 px-2 py-1 rounded-md text-slate-600 text-xs font-semibold">
                    {item.role}
                </span>
            )
        },
        {
            header: "Status",
            accessor: (item: BriefingRegistration) => (
                <span className={`px-2 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${item.status === 'attended' ? 'bg-green-100 text-green-700' :
                        item.status === 'cancelled' ? 'bg-red-100 text-red-700' :
                            'bg-blue-100 text-blue-700'
                    }`}>
                    {item.status}
                </span>
            )
        },
        {
            header: "Date",
            accessor: (item: BriefingRegistration) => format(item.createdAt, "MMM d, yyyy"),
            hideOnMobile: true,
            className: "text-slate-500"
        },
    ];

    return (
        <div className="p-4 md:p-8 max-w-7xl mx-auto">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
                <div>
                    <Link
                        href="/admin/wave"
                        className="inline-flex items-center gap-2 text-slate-500 hover:text-slate-900 transition-colors mb-2 text-sm font-medium"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Back to WAVE Dashboard
                    </Link>
                    <h1 className="text-2xl md:text-3xl font-bold text-slate-900">
                        Briefing Registrations
                    </h1>
                    <p className="text-slate-600 mt-1">
                        Manage guest list for the National Awareness Briefing
                    </p>
                </div>

                <div className="flex items-center gap-3">
                    <div className="bg-white border border-slate-200 px-4 py-2 rounded-xl shadow-sm">
                        <span className="text-slate-500 block text-xs uppercase font-bold tracking-wider mb-0.5">Total Registrants</span>
                        <span className="text-xl font-black text-slate-900">{data?.length || 0}</span>
                    </div>
                </div>
            </div>

            {/* Content */}
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                <ResponsiveTable
                    data={data || []}
                    columns={columns}
                    getRowKey={(item) => item.id}
                    emptyState={
                        <div className="p-12 text-center">
                            <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4">
                                <Users className="w-8 h-8 text-slate-300" />
                            </div>
                            <h3 className="text-lg font-bold text-slate-900 mb-1">No registrations yet</h3>
                            <p className="text-slate-500">Wait for users to sign up via the landing page.</p>
                        </div>
                    }
                />
            </div>
        </div>
    );
}
