Created At: 2026-05-20T07:09:53Z
Completed At: 2026-05-20T07:09:54Z
File Path: `file:///Users/mac/Easy%20sales%20Export/easy-sales-export-nextjs/src/app/dashboard/page.tsx`
Total Lines: 436
Total Bytes: 21655
Showing lines 1 to 436
The following code has been modified to include a line number before every line, in the format: <line_number>: <original_line>. Please note that any changes targeting the original code should remove the line number, colon, and leading space.
1: "use client";
2: 
3: import { useEffect, useState, Suspense } from "react";
4: import { useSession } from "next-auth/react";
5: import Link from "next/link";
6: import {
7:     Wallet, Package, MessageCircle, Bell, Award, IdCard,
8:     AlertTriangle, Star, Sparkles, ChevronRight, Loader2,
9:     TrendingUp, Users, BookOpen, Landmark, ExternalLink,
10: } from "lucide-react";
11: import { db } from "@/lib/firebase";
12: import { collection, doc, query, where, onSnapshot, orderBy, limit } from "firebase/firestore";
13: import { COLLECTIONS } from "@/lib/types/firestore";
14: import type { UserRole } from "@/lib/types/roles";
15: 
16: const fmt = (n: number = 0) =>
17:     new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", minimumFractionDigits: 0 }).format(n || 0);
18: 
19: interface StatsState {
20:     walletBalance: number;
21:     activeOrders: number;
22:     unreadNotifications: number;
23:     unreadMessages: number;
24:     loading: boolean;
25: }
26: 
27: interface RecentNotification {
28:     id: string;
29:     title: string;
30:     message: string;
31:     type: string;
32:     read: boolean;
33:     createdAt: any;
34: }
35: 
36: /** Returns all platform modules with their dynamic application status */
37: function getPlatformModules(serviceRegistrations: Record<string, any>, roles: UserRole[]) {
38:     const modulesDef = [
39:         {
40:             id: "academy",
41:             label: "Academy",
42:             description: "Agricultural education and training",
43:             icon: BookOpen,
44:            
<truncated 20188 bytes>
hite rounded-2xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
400:                             {recentNotifications.map((notif) => (
401:                                 <div
402:                                     key={notif.id}
403:                                     className={`flex items-start gap-4 px-5 py-4 hover:bg-slate-50 transition-colors ${!notif.read ? "border-l-2 border-l-emerald-500" : ""}`}
404:                                 >
405:                                     <span className="text-xl shrink-0 mt-0.5">{getNotifIcon(notif.type)}</span>
406:                                     <div className="flex-1 min-w-0">
407:                                         <p className={`text-sm font-semibold truncate ${!notif.read ? "text-slate-900" : "text-slate-600"}`}>
408:                                             {notif.title}
409:                                         </p>
410:                                         <p className="text-xs text-slate-500 truncate mt-0.5">{notif.message}</p>
411:                                     </div>
412:                                     {!notif.read && (
413:                                         <div className="w-2 h-2 rounded-full bg-emerald-500 shrink-0 mt-1.5" />
414:                                     )}
415:                                 </div>
416:                             ))}
417:                         </div>
418:                     </section>
419:                 )}
420:             </div>
421:         </div>
422:     );
423: }
424: 
425: export default function DashboardHome() {
426:     return (
427:         <Suspense fallback={
428:             <div className="min-h-screen flex items-center justify-center bg-slate-50">
429:                 <Loader2 className="w-10 h-10 animate-spin text-emerald-600" />
430:             </div>
431:         }>
432:             <DashboardHomeContent />
433:         </Suspense>
434:     );
435: }
436: 
The above content shows the entire, complete file contents of the requested file.
