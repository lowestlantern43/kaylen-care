import { jsPDF } from "jspdf";

// Text tables rather than screenshots: repeat headings and split long rows safely.
export function createTableReport({ childName, range, title = "Care report", sections }) {
  const pdf = new jsPDF("l", "mm", "a4");
  const margin = 10, bottom = 197, width = 277;
  let y = 10;
  const pageHeader = () => {
    pdf.setFont("helvetica", "bold"); pdf.setFontSize(13); pdf.setTextColor(25, 55, 65);
    pdf.text("FAMILYTRACK", margin, 15);
    pdf.setFontSize(9); pdf.text(`${title} - ${childName || "Care record"}`, margin, 21);
    pdf.setFont("helvetica", "normal"); pdf.setFontSize(8);
    pdf.text(String(range || "").slice(0, 160), margin, 26); y = 31;
  };
  pageHeader();
  for (const section of sections) {
    if (!section.rows.length) continue;
    const weights = section.columns.map(c => c.weight || 1);
    const total = weights.reduce((a,b) => a+b,0);
    const widths = weights.map(w => width*w/total);
    const heading = () => {
      pdf.setFont("helvetica", "bold"); pdf.setFontSize(9); pdf.setTextColor(25,55,65);
      pdf.text(section.title, margin, y+4); y+=7;
      pdf.setFontSize(7); let x=margin;
      const labels = section.columns.map((c,i)=>pdf.splitTextToSize(c.label,Math.max(5,widths[i]-4)));
      const headerHeight = Math.max(8,Math.max(...labels.map(lines=>lines.length))*3.2+4);
      section.columns.forEach((c,i)=>{pdf.setFillColor(230,238,237);pdf.rect(x,y,widths[i],headerHeight,'F');pdf.text(labels[i],x+2,y+3.5,{lineHeightFactor:1.29});x+=widths[i];}); y+=headerHeight;
    };
    if(y > bottom-25){pdf.addPage();pageHeader();} heading();
    for(const row of section.rows){
      pdf.setFont('helvetica','normal');pdf.setFontSize(7);pdf.setTextColor(40,45,50);
      const lines=section.columns.map((c,i)=>pdf.splitTextToSize(String(row[i] ?? ''),Math.max(5,widths[i]-4)));
      let offset=0;const length=Math.max(1,...lines.map(l=>l.length));
      while(offset<length){
        if(y+8>bottom){pdf.addPage();pageHeader();heading();pdf.setFont('helvetica','normal');pdf.setFontSize(7);pdf.setTextColor(40,45,50);}
        const count=Math.min(length-offset,Math.max(1,Math.floor((bottom-y-4)/3.2)));
        const height=count*3.2+4;let x=margin;
        section.columns.forEach((c,i)=>{pdf.setDrawColor(215,222,225);pdf.rect(x,y,widths[i],height);pdf.text(lines[i].slice(offset,offset+count),x+2,y+3.5,{lineHeightFactor:1.29});x+=widths[i];});
        y+=height;offset+=count;
      }
    }
    y+=6;
  }
  const pages=pdf.getNumberOfPages();
  for(let p=1;p<=pages;p++){pdf.setPage(p);pdf.setFont('helvetica','normal');pdf.setFontSize(7);pdf.setTextColor(95,105,110);pdf.text(`Generated ${new Date().toLocaleDateString('en-GB')} · Page ${p} of ${pages}`,10,204);}
  return pdf;
}
