export const escapeHTML = value => String(value).replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
const paragraph = text => `<p style="margin:0 0 15px;font-size:15px;line-height:1.65;">${escapeHTML(text)}</p>`;
function productDetails(item,visual) {
  const style='margin:6px 0 0;font-size:12px;line-height:1.6;color:#53616d;';
  const facts=item.details??(item.warranty?[{label:'Gwarancja',value:item.warranty}]:[]);
  let html=facts.length?`<p style="${style}">${facts.map(f=>`${escapeHTML(f.label)}: ${escapeHTML(f.value)}`).join(' · ')}</p>`:'';
  if(item.energy){
    html+=`<p style="${style}">Klasa energetyczna: ${escapeHTML(item.energy.value)}</p>`;
    if(visual)html+=`<p style="margin:4px 0 0;"><img src="${escapeHTML(item.energy.image)}" alt="Klasa energetyczna ${escapeHTML(item.energy.value)} w skali A–G" width="72" style="width:72px;max-width:100%;height:auto;display:block;border:0;"></p>`;
  }
  if(item.price)html+=`<p data-product-price="true" style="margin:8px 0 0;font-size:14px;line-height:1.5;color:#17344b;font-weight:bold;">${escapeHTML(item.price.label)}: ${escapeHTML(item.price.value)}</p>`;
  return html;
}

export function renderEmail(template, mode = 'text') {
  template={...template,items:template.items.filter(item=>item.price?.available)};
  let html = paragraph('Dzień dobry,') + template.intro.map(paragraph).join('');
  if (template.items.length) {
    if (mode === 'visual') {
      html += '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;border-collapse:collapse;">';
      for (const item of template.items) {
        html += `<tr data-offer-product="${escapeHTML(item.selectionId||item.id||item.sku)}"><td style="padding:15px 0;border-top:1px solid #e5e9ed;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;border-collapse:collapse;"><tr>`;
        if (item.image) html += `<td width="106" valign="middle" style="width:106px;padding:0 16px 0 0;"><a href="${escapeHTML(item.url)}" target="_blank" rel="noopener noreferrer"><img src="${escapeHTML(item.image)}" alt="${escapeHTML(item.name)}" width="90" style="width:90px;max-width:100%;height:auto;display:block;border:0;"></a></td>`;
        html += `<td valign="top"><p style="margin:0 0 5px;font-size:15px;line-height:1.5;"><a href="${escapeHTML(item.url)}" target="_blank" rel="noopener noreferrer" style="color:#17344b;font-weight:bold;text-decoration:underline;">${escapeHTML(item.name)}</a></p>`;
        if (item.technical) html += `<p style="margin:0 0 5px;font-size:12px;line-height:1.5;color:#53616d;">${escapeHTML(item.technical)}</p>`;
        html += `<p style="margin:0;font-size:14px;line-height:1.6;">${escapeHTML(item.description)}</p>`;
        html += productDetails(item,true);
        html += '</td></tr></table></td></tr>';
      }
      html += '</table><p style="margin:0 0 14px;"></p>';
    } else {
      html += '<ul style="padding:0 0 0 21px;margin:0 0 19px;">';
      for (const item of template.items) {
        html += `<li data-offer-product="${escapeHTML(item.selectionId||item.id||item.sku)}" style="margin:0 0 11px;font-size:15px;line-height:1.6;"><a href="${escapeHTML(item.url)}" target="_blank" rel="noopener noreferrer" style="color:#17344b;font-weight:bold;text-decoration:underline;">${escapeHTML(item.name)}</a> — ${escapeHTML(item.description)}`;
        if (item.technical) html += `<br><span style="font-size:12px;color:#53616d;">${escapeHTML(item.technical)}</span>`;
        html += productDetails(item,false);
        html += '</li>';
      }
      html += '</ul>';
    }
  }
  const priceDates=[...new Set(template.items.map(item=>item.price?.updatedAt).filter(value=>value&&Number.isFinite(Date.parse(value))).map(value=>new Date(value).toLocaleDateString('pl-PL')))];
  if(priceDates.length)html+=`<p style="margin:0 0 15px;font-size:12px;line-height:1.6;color:#53616d;">Ceny według cennika z ${priceDates.map(escapeHTML).join(', ')}.</p>`;
  html += template.closing.map(paragraph).join('');
  if (template.links?.length) html += '<p style="margin:0 0 15px;font-size:14px;line-height:1.7;">' + template.links.map(link => `<a href="${escapeHTML(link.url)}" target="_blank" rel="noopener noreferrer" style="color:#a34911;text-decoration:underline;">${escapeHTML(link.label)}</a>`).join('<br>') + '</p>';
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.65;color:#273744;width:100%;max-width:620px;">${html}</div>`;
}

const safeTags = new Set(['P','A','STRONG','EM','B','I','U','UL','OL','LI','BR','TABLE','TBODY','THEAD','TR','TD','TH','IMG','SPAN','DIV','HR']);
const safeStyles = new Set(['font-family','font-size','font-weight','font-style','line-height','color','background-color','text-decoration','text-align','vertical-align','margin','margin-top','margin-bottom','margin-left','margin-right','padding','padding-top','padding-bottom','padding-left','padding-right','border','border-top','border-bottom','border-collapse','border-radius','width','max-width','height','display','letter-spacing']);
export function cleanEmail(source) {
  const parsed = new DOMParser().parseFromString(source, 'text/html');
  for (const node of [...parsed.body.querySelectorAll('*')]) {
    if (['SCRIPT','STYLE','IFRAME','OBJECT','EMBED','FORM','INPUT','BUTTON','SVG','MATH','LINK','META'].includes(node.tagName)) { node.remove(); continue; }
    if (!safeTags.has(node.tagName)) { node.replaceWith(...node.childNodes); continue; }
    for (const attribute of [...node.attributes]) {
      const { name, value } = attribute;
      if (name === 'style') {
        for (const property of [...node.style]) {
          if (!safeStyles.has(property) || /url\s*\(|expression|javascript|var\s*\(/i.test(node.style.getPropertyValue(property))) node.style.removeProperty(property);
        }
      } else if ((name === 'href' && node.tagName === 'A') || (name === 'src' && node.tagName === 'IMG')) {
        try { const u = new URL(value); if (!(name === 'src' ? ['https:', ...(globalThis.location?.hostname === '127.0.0.1' && u.hostname === '127.0.0.1' ? ['http:'] : [])] : ['https:','http:','mailto:','tel:']).includes(u.protocol)) node.removeAttribute(name); }
        catch { node.removeAttribute(name); }
      } else if (name === 'alt' && node.tagName === 'IMG') {
        // Plain text attribute; leave unchanged.
      } else if (name==='data-offer-product'&&['LI','TR'].includes(node.tagName)&&value.length<=300) {
      } else if (name==='data-product-price'&&node.tagName==='P'&&value==='true') {
      } else if (['width','height','cellspacing','cellpadding','border'].includes(name) && /^\d+%?$/.test(value)) {
        // Email layout dimensions only.
      } else if (name === 'valign' && ['top','middle','bottom'].includes(value)) {
      } else if (name === 'role' && value === 'presentation') {
      } else node.removeAttribute(name);
    }
    if (node.tagName === 'A') { node.setAttribute('target','_blank'); node.setAttribute('rel','noopener noreferrer'); }
  }
  return parsed.body.innerHTML;
}

export function emailHasPrices(html,items){
  const doc=new DOMParser().parseFromString(html,'text/html'),rows=[...doc.querySelectorAll('[data-offer-product]')];
  if(rows.length!==items.length)return false;
  const normalize=value=>String(value).replace(/\s+/g,' ').trim();
  return items.every(item=>{
    const matching=rows.filter(row=>row.dataset.offerProduct===(item.selectionId||item.id||item.sku));
    return item.price?.available&&matching.length===1&&normalize(matching[0].querySelector('[data-product-price]')?.textContent)===normalize(`${item.price.label}: ${item.price.value}`);
  });
}

export function emailText(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const walk = node => {
    if (node.nodeType === 3) return node.nodeValue;
    if (node.nodeType !== 1 || ['IMG','SCRIPT','STYLE'].includes(node.tagName)) return '';
    if (node.tagName === 'BR') return '\n';
    let value = [...node.childNodes].map(walk).join('');
    if (node.tagName === 'A' && node.getAttribute('href') && value.trim() && value.trim() !== node.getAttribute('href')) value += ` (${node.getAttribute('href')})`;
    if (node.tagName === 'LI') value = '• ' + value + '\n';
    if (['P','UL','OL','TABLE'].includes(node.tagName)) value += '\n\n';
    if (['TR','DIV'].includes(node.tagName)) value += '\n';
    return value;
  };
  return walk(doc.body).replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
}

export function htmlDocument(subject, fragment) {
  return `<!doctype html>\n<html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHTML(subject)}</title></head><body style="margin:0;padding:16px;background:#fff;">${cleanEmail(fragment)}</body></html>`;
}
