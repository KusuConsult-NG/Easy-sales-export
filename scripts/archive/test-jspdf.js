import('jspdf').then(m => console.log("jsPDF export:", !!m.jsPDF, "default:", !!m.default)).catch(console.error);
import('html2canvas').then(m => console.log("html2canvas default:", !!m.default)).catch(console.error);
