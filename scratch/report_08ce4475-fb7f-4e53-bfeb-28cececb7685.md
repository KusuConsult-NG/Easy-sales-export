Created At: 2026-05-20T07:50:45Z
Completed At: 2026-05-20T07:50:45Z
File Path: `file:///Users/mac/Easy%20sales%20Export/easy-sales-export-nextjs/src/app/vendor/settings/page.tsx`
Total Lines: 500
Total Bytes: 26303
Showing lines 1 to 500
The following code has been modified to include a line number before every line, in the format: <line_number>: <original_line>. Please note that any changes targeting the original code should remove the line number, colon, and leading space.
1: "use client";
2: 
3: import { useState, useEffect } from "react";
4: import { Store, CreditCard, Bell, Truck, Save, Loader2 } from "lucide-react";
5: import {
6:     getVendorSettingsAction,
7:     updateVendorProfileAction,
8:     updateVendorPaymentConfigAction,
9:     updateVendorNotificationPrefsAction,
10:     updateVendorShippingConfigAction,
11: } from "@/app/actions/vendor-settings";
12: 
13: import { GlobalResilienceBoundary } from "@/components/shared/GlobalResilienceBoundary";
14: 
15: type Tab = "profile" | "payment" | "notifications" | "shipping";
16: 
17: export default function VendorSettingsPage() {
18:     return (
19:         <GlobalResilienceBoundary moduleName="Vendor Settings" dashboardUrl="/vendor/dashboard">
20:             <VendorSettingsContent />
21:         </GlobalResilienceBoundary>
22:     );
23: }
24: 
25: function VendorSettingsContent() {
26:     const [activeTab, setActiveTab] = useState<Tab>("profile");
27:     const [isLoading, setIsLoading] = useState(true);
28:     const [isSaving, setIsSaving] = useState(false);
29:     const [settings, setSettings] = useState<any>(null);
30:     const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
31: 
32:     // Profile form state
33:     const [profileForm, setProfileForm] = useState({
34:         storeName: "",
35:         description: "",
36:         category: "",
37:         contactEmail: "",
38:         phone: "",
39:     });
40: 
41: 
42:     // Payment form state
43:     const [paymentForm, setPaymentForm] = useSta
<truncated 25162 bytes>
                    />
468:                                     <p className="text-sm text-slate-500 mt-1">Number of days to process orders before shipping</p>
469:                                 </div>
470: 
471:                                 <div>
472:                                     <label className="block text-sm font-medium text-slate-900 mb-2">
473:                                         Return Policy
474:                                     </label>
475:                                     <textarea
476:                                         value={shippingForm.returnPolicy}
477:                                         onChange={(e) => setShippingForm({ ...shippingForm, returnPolicy: e.target.value })}
478:                                         rows={4}
479:                                         className="w-full px-4 py-3 rounded-xl border border-slate-300 bg-white text-slate-900"
480:                                         placeholder="Describe your return and refund policy..."
481:                                     />
482:                                 </div>
483: 
484:                                 <button
485:                                     onClick={handleSaveShipping}
486:                                     disabled={isSaving}
487:                                     className="flex items-center gap-2 px-6 py-3 bg-primary text-white rounded-xl hover:bg-primary/90 transition disabled:opacity-50"
488:                                 >
489:                                     {isSaving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
490:                                     {isSaving ? "Saving..." : "Save Shipping Config"}
491:                                 </button>
492:                             </div>
493:                         )}
494:                     </div>
495:                 </div>
496:             </div>
497:         </div>
498:     );
499: }
500: 
The above content shows the entire, complete file contents of the requested file.
