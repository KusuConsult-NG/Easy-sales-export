import LoginForm from "@/components/auth/LoginForm";

export const metadata = {
    title: "Admin Login | Easy Sales Export",
    description: "Secure login portal for platform administrators.",
};

export default function AdminLoginPage() {
    return (
        <main className="min-h-screen flex items-center justify-center bg-slate-900 border-t border-slate-800">
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute -top-1/2 -right-1/4 w-[1000px] h-[1000px] bg-emerald-600/10 rounded-full blur-3xl opacity-50" />
                <div className="absolute -bottom-1/2 -left-1/4 w-[800px] h-[800px] bg-blue-600/10 rounded-full blur-3xl opacity-50" />
            </div>
            
            <div className="w-full max-w-md p-6 relative z-10">
                <div className="text-center mb-8">
                    <div className="mx-auto w-16 h-16 bg-linear-to-br from-emerald-400 to-green-600 rounded-2xl flex items-center justify-center shadow-lg mb-6">
                        <span className="text-white font-black text-2xl">ES</span>
                    </div>
                    <h1 className="text-3xl font-bold text-white mb-2">Admin Portal</h1>
                    <p className="text-slate-400">Sign in with your administrator account</p>
                </div>

                <div className="bg-slate-800/80 backdrop-blur-xl border border-slate-700/50 rounded-2xl p-6 shadow-xl">
                    {/* Render the universal login form. It perfectly handles smart redirects! */}
                    <LoginForm />
                </div>
            </div>
        </main>
    );
}
