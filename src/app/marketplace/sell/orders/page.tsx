import { redirect } from 'next/navigation';

export default function DeprecatedSellOrdersPage() {
    redirect('/marketplace/seller/orders');
}
