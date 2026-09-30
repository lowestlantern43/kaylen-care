export const escapeEmail = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const e=escapeEmail;
const cell='padding:12px 10px;border-bottom:1px solid #e2e8f0;text-align:left;vertical-align:top;font-size:13px;line-height:1.5;overflow-wrap:anywhere;word-break:break-word';
function table(headers,rows,empty){
  if(!rows.length)return `<p style="color:#64748b;font-size:14px">${e(empty)}</p>`;
  return `<table role="table" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;table-layout:fixed"><thead><tr>${headers.map(h=>`<th scope="col" style="${cell};background:#f1f5f9;color:#475569">${e(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(value=>`<td style="${cell}">${e(value)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}
export function adminDigestHtml({subject,period,traffic,newUsers,users,emails,trials,attention}){
  const cards=[['Measured visitors',traffic.visitors],['Page views',traffic.views],['New accounts',newUsers],['Trials ending soon',trials]];
  const section=(title,content)=>`<tr><td style="padding:8px 24px 20px"><h2 style="font-size:18px;margin:12px 0;color:#243047">${e(title)}</h2>${content}</td></tr>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(subject)}</title></head><body style="margin:0;background:#eef2f7;color:#243047;font-family:Arial,Helvetica,sans-serif">
  <div style="display:none;max-height:0;overflow:hidden">Your daily FamilyTrack traffic, new users, trials and email activity.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 8px"><table role="presentation" width="640" cellpadding="0" cellspacing="0" style="width:100%;max-width:640px;background:#fff;border-radius:18px;overflow:hidden">
  <tr><td style="padding:28px 24px;background:#334b68;color:white"><p style="margin:0;font-size:12px;letter-spacing:2px">FAMILYTRACK</p><h1 style="margin:10px 0;font-size:25px">Admin update</h1><p style="margin:0;font-size:13px;line-height:1.6">${e(period)}</p></td></tr>
  <tr><td style="padding:20px 18px"><table role="presentation" width="100%" cellpadding="6" cellspacing="0">${[0,2].map(i=>`<tr>${cards.slice(i,i+2).map(([label,value])=>`<td width="50%" style="background:#f1f5f9;padding:16px;border:6px solid white;border-radius:14px"><strong style="font-size:27px;color:#334b68">${e(value)}</strong><div style="margin-top:5px;font-size:12px;color:#52657b">${e(label)}</div></td>`).join('')}</tr>`).join('')}</table><p style="margin:10px 6px;font-size:12px;line-height:1.6;color:#64748b">${e(traffic.interest)} signup clicks. Traffic measures browsers that opted in; it excludes app activity. New accounts include all registration sources. Trials ending soon means within three days.</p></td></tr>
  ${section('Worth your attention',table(['Item','Count / status'],attention,'No attention data available.'))}
  ${section('New users',table(['Email','Registered (UK time)'],users,'No new users in this period.'))}
  ${section('Email activity',table(['Recipient','Email / time (UK)','Status'],emails,'No email activity recorded in this period.'))}
  <tr><td style="padding:8px 24px 28px"><p style="font-size:12px;color:#64748b;line-height:1.6">Email status “sent” means accepted by the email provider. Up to 100 new users and 200 email events are listed. Billing figures count recorded events, not necessarily distinct customers. Support figures show currently unresolved issues. No care records are included.</p><a href="https://familytrack.care/" style="display:inline-block;background:#334b68;border-radius:9px;color:#fff;text-decoration:none;padding:14px 20px;font-size:14px;font-weight:bold">Open FamilyTrack admin</a></td></tr>
  <tr><td style="padding:18px 24px;background:#f8fafc;font-size:12px;line-height:1.6;color:#64748b">Sent nightly at 22:30 UK time. Manage the recipient or pause updates in Owner platform → Overview → Website traffic.</td></tr>
  </table></td></tr></table></body></html>`;
}
