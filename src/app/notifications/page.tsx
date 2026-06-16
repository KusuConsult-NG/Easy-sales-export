import { redirect } from "next/navigation";

export default function NotificationsRedirectPage() {
    redirect("/dashboard/notifications");
}
