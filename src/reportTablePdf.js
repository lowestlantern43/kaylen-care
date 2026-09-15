import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";

export function createTableReport({ childName, dateRange, rows, grouped = true }) {
  const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  pdf.setProperties({ title: `FamilyTrack - ${childName} care report`, author: "FamilyTrack" });
  const groups = new Map();
  for (const row of rows) {
    const key = grouped ? row.category : "Timeline";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const body = [];
  for (const [category, entries] of groups) {
    if (grouped) body.push([{ content: `${category} (${entries.length})`, colSpan: 5,
      styles: { fillColor: [225, 238, 245], textColor: [25, 55, 75], fontStyle: "bold" } }]);
    for (const row of entries) body.push([row.date, row.time || "-", row.category, row.details || "-", row.notes || "-"]);
  }
  autoTable(pdf, {
    head: [["Date", "Time", "Category", "Details", "Notes"]],
    body: body.length ? body : [[{ content: "No entries in the selected date range.", colSpan: 5 }]],
    startY: 30, margin: { top: 30, bottom: 14, left: 10, right: 10 },
    theme: "grid", showHead: "everyPage", rowPageBreak: "avoid",
    styles: { fontSize: 8, cellPadding: 2, overflow: "linebreak", valign: "top", lineColor: [220, 227, 233], lineWidth: 0.15 },
    headStyles: { fillColor: [28, 65, 86], fontSize: 8, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [247, 250, 252] },
    columnStyles: { 0: { cellWidth: 25 }, 1: { cellWidth: 17 }, 2: { cellWidth: 30 }, 3: { cellWidth: 95 }, 4: { cellWidth: 110 } },
    didDrawPage: () => {
      pdf.setFont("helvetica", "bold"); pdf.setFontSize(15); pdf.setTextColor(28, 65, 86);
      pdf.text("FamilyTrack | Care report", 10, 12);
      pdf.setFontSize(10); pdf.text(childName || "Child", 10, 19);
      pdf.setFont("helvetica", "normal"); pdf.setFontSize(8);
      pdf.text(`${dateRange} | ${grouped ? "Grouped by category" : "Chronological timeline"} | ${rows.length} entries`, 10, 25);
    },
  });
  const pages = pdf.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    pdf.setPage(page); pdf.setFontSize(7); pdf.setTextColor(90);
    pdf.text("FamilyTrack - confidential care record", 10, 203);
    pdf.text(`Page ${page} of ${pages}`, 287, 203, { align: "right" });
  }
  return pdf;
}
