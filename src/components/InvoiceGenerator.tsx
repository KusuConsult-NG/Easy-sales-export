"use client";

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { FileText, Download } from 'lucide-react';
import { useState } from 'react';

interface InvoiceItem {
    description: string;
    quantity: number;
    unitPrice: number;
    total: number;
}

interface Invoice {
    id: string;
    date: string;
    dueDate?: string;
    customerName: string;
    customerEmail?: string;
    customerAddress?: string;
    items: InvoiceItem[];
    subtotal: number;
    tax?: number;
    taxRate?: number;
    shipping?: number;
    total: number;
    notes?: string;
    paymentTerms?: string;
}

interface InvoiceGeneratorProps {
    invoice: Invoice;
    buttonText?: string;
    buttonVariant?: 'primary' | 'secondary';
}

export default function InvoiceGenerator({
    invoice,
    buttonText = 'Download Invoice',
    buttonVariant = 'primary'
}: InvoiceGeneratorProps) {
    const [isGenerating, setIsGenerating] = useState(false);

    const generatePDF = () => {
        setIsGenerating(true);
        try {
            const doc = new jsPDF();

            // Colors
            const primaryColor: [number, number, number] = [16, 185, 129]; // #10b981
            const darkColor: [number, number, number] = [15, 23, 42]; // #0f172a
            const grayColor: [number, number, number] = [100, 116, 139]; // #64748b

            // Header with logo area
            doc.setFillColor(...primaryColor);
            doc.rect(0, 0, 210, 40, 'F');

            doc.setTextColor(255, 255, 255);
            doc.setFontSize(28);
            doc.setFont('helvetica', 'bold');
            doc.text('INVOICE', 20, 25);

            // Company info
            doc.setFontSize(10);
            doc.setFont('helvetica', 'normal');
            doc.text('Easy Sales Export', 20, 32);

            // Invoice details box
            doc.setTextColor(...darkColor);
            doc.setFontSize(10);
            doc.setFont('helvetica', 'bold');
            doc.text('Invoice Details', 140, 50);

            doc.setFont('helvetica', 'normal');
            doc.setFontSize(9);
            doc.text(`Invoice #: ${invoice.id}`, 140, 57);
            doc.text(`Date: ${invoice.date}`, 140, 62);
            if (invoice.dueDate) {
                doc.text(`Due Date: ${invoice.dueDate}`, 140, 67);
            }

            // Bill to section
            doc.setFontSize(10);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(...darkColor);
            doc.text('Bill To:', 20, 50);

            doc.setFont('helvetica', 'normal');
            doc.setFontSize(9);
            doc.setTextColor(...grayColor);
            doc.text(invoice.customerName, 20, 57);
            if (invoice.customerEmail) {
                doc.text(invoice.customerEmail, 20, 62);
            }
            if (invoice.customerAddress) {
                const addressLines = doc.splitTextToSize(invoice.customerAddress, 80);
                doc.text(addressLines, 20, invoice.customerEmail ? 67 : 62);
            }

            // Items table
            const tableStartY = invoice.customerAddress ? 90 : 80;

            autoTable(doc, {
                startY: tableStartY,
                head: [['Description', 'Qty', 'Unit Price (₦)', 'Total (₦)']],
                body: invoice.items.map(item => [
                    item.description,
                    item.quantity.toString(),
                    item.unitPrice.toLocaleString(),
                    item.total.toLocaleString()
                ]),
                theme: 'grid',
                headStyles: {
                    fillColor: primaryColor,
                    fontSize: 10,
                    fontStyle: 'bold',
                    halign: 'left'
                },
                styles: {
                    fontSize: 9,
                    cellPadding: 5,
                },
                columnStyles: {
                    0: { cellWidth: 90 },
                    1: { cellWidth: 20, halign: 'center' },
                    2: { cellWidth: 40, halign: 'right' },
                    3: { cellWidth: 40, halign: 'right' }
                }
            });

            // Calculate final Y position after table
            const finalY = (doc as any).lastAutoTable.finalY + 10;

            // Totals section
            const totalsX = 130;
            let currentY = finalY;

            doc.setFontSize(9);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(...grayColor);

            // Subtotal
            doc.text('Subtotal:', totalsX, currentY);
            doc.text(`₦${invoice.subtotal.toLocaleString()}`, 190, currentY, { align: 'right' });
            currentY += 6;

            // Tax if applicable
            if (invoice.tax && invoice.tax > 0) {
                doc.text(`Tax (${invoice.taxRate || 0}%):`, totalsX, currentY);
                doc.text(`₦${invoice.tax.toLocaleString()}`, 190, currentY, { align: 'right' });
                currentY += 6;
            }

            // Shipping if applicable
            if (invoice.shipping && invoice.shipping > 0) {
                doc.text('Shipping:', totalsX, currentY);
                doc.text(`₦${invoice.shipping.toLocaleString()}`, 190, currentY, { align: 'right' });
                currentY += 6;
            }

            // Total
            doc.setFontSize(12);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(...darkColor);
            doc.text('Total:', totalsX, currentY + 3);
            doc.text(`₦${invoice.total.toLocaleString()}`, 190, currentY + 3, { align: 'right' });

            // Notes section
            if (invoice.notes) {
                doc.setFontSize(9);
                doc.setFont('helvetica', 'bold');
                doc.setTextColor(...darkColor);
                doc.text('Notes:', 20, currentY + 15);

                doc.setFont('helvetica', 'normal');
                doc.setTextColor(...grayColor);
                const notesLines = doc.splitTextToSize(invoice.notes, 170);
                doc.text(notesLines, 20, currentY + 22);
            }

            // Footer
            doc.setFillColor(248, 250, 252);
            doc.rect(0, 270, 210, 27, 'F');

            doc.setFontSize(8);
            doc.setTextColor(...grayColor);
            doc.setFont('helvetica', 'normal');
            doc.text('Thank you for your business!', 105, 280, { align: 'center' });
            doc.text('Easy Sales Export • easysalesexport.com', 105, 286, { align: 'center' });

            if (invoice.paymentTerms) {
                doc.text(`Payment Terms: ${invoice.paymentTerms}`, 105, 292, { align: 'center' });
            }

            // Save
            doc.save(`invoice-${invoice.id}.pdf`);
        } catch (error) {
            console.error('Failed to generate invoice:', error);
            alert('Failed to generate invoice. Please try again.');
        } finally {
            setIsGenerating(false);
        }
    };

    const buttonClass = buttonVariant === 'primary'
        ? 'bg-primary hover:bg-primary/90 text-white'
        : 'bg-white hover:bg-slate-50 text-slate-700 border border-slate-200';

    return (
        <button
            onClick={generatePDF}
            disabled={isGenerating}
            className={`flex items-center gap-2 px-6 py-3 rounded-lg transition-all shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed font-semibold ${buttonClass}`}
        >
            <FileText className="w-5 h-5" />
            {isGenerating ? 'Generating...' : buttonText}
        </button>
    );
}
