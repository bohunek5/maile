import { unlockLibrary } from './crypto.js';
import { renderEmail, cleanEmail, emailText, htmlDocument, escapeHTML } from './email.js';
import { createZip } from './zip.js';

const $ = id => document.getElementById(id);
let library = null, current = null, mode = 'text', unlockPending = false, session = 0, toastTimer;
const drafts = new Map(), subjects = new Map();
const normal = value => value.toLocaleLowerCase('pl').normalize('NFD').replace(/\p{Diacritic}/gu,'').replace(/ł/g,'l');

function toast(message) {
  clearTimeout(toastTimer); $('toast').textContent = message; $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3500);
}
function save() {
  if (!current) return;
  drafts.set(`${current.id}:${mode}`, cleanEmail($('email-editor').innerHTML));
  subjects.set(current.id, $('subject-input').value);
}
function fragment(template, format = mode) { return drafts.get(`${template.id}:${format}`) ?? renderEmail(template, format); }
function subject(template) { return subjects.get(template.id) ?? template.subject; }

function renderList() {
  if (!library) return;
  const query = normal($('search-input').value), group = $('group-filter').value;
  const visible = library.templates.filter(t => (group === 'all' || t.group === group) && normal([t.title,t.subject,t.purpose,...t.tags,...t.items.map(p => `${p.name} ${p.sku ?? ''}`)].join(' ')).includes(query));
  $('template-list').replaceChildren();
  for (const template of visible) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'template-item'; button.dataset.id = template.id;
    button.classList.toggle('active', current?.id === template.id); button.setAttribute('aria-current', String(current?.id === template.id));
    const number = document.createElement('span'); number.className = 'item-number'; number.textContent = String(library.templates.indexOf(template)+1).padStart(2,'0');
    const text = document.createElement('span'); text.className = 'item-text';
    const title = document.createElement('strong'); title.textContent = template.title;
    const subtitle = document.createElement('small'); subtitle.textContent = template.short;
    text.append(title,subtitle); button.append(number,text); button.addEventListener('click', () => select(template.id)); $('template-list').append(button);
  }
  $('result-count').textContent = `${visible.length} z ${library.templates.length} szablonów`;
  $('empty-state').hidden = visible.length !== 0;
}
function select(id, keepFocus = false, saveCurrent = true) {
  if (saveCurrent) save(); current = library.templates.find(t => t.id === id); if (!current) return;
  $('template-title').textContent = current.title; $('template-purpose').textContent = current.purpose;
  $('template-tags').replaceChildren(...current.tags.map(tag => { const span = document.createElement('span'); span.className = 'tag'; span.textContent = tag; return span; }));
  $('subject-input').value = subject(current); $('email-editor').innerHTML = fragment(current);
  $('template-note').textContent = current.note ?? ''; $('template-note').hidden = !current.note;
  $('format-text').setAttribute('aria-pressed', String(mode === 'text')); $('format-visual').setAttribute('aria-pressed', String(mode === 'visual'));
  renderList();
  if (!keepFocus && window.matchMedia('(max-width: 760px)').matches) $('template-title').scrollIntoView({behavior:'smooth',block:'start'});
}
function setMode(next) { if (!current || next === mode) return; save(); mode = next; select(current.id,true,false); }

$('unlock-form').addEventListener('submit', async event => {
  event.preventDefault(); if (unlockPending) return;
  if (!crypto.subtle) { $('login-error').textContent = 'Otwórz bibliotekę przez bezpieczny adres HTTPS.'; return; }
  const password = $('password').value; if (!password) { $('login-error').textContent = 'Wpisz hasło.'; $('password').focus(); return; }
  unlockPending = true; $('unlock-button').disabled = true; $('unlock-button').textContent = 'Otwieranie…'; $('login-error').textContent = '';
  try {
    let payload;
    try { const response = await fetch('./library.enc.json', {cache:'no-store'}); if (!response.ok) throw new Error(); payload = await response.json(); }
    catch { $('login-error').textContent = 'Nie udało się pobrać biblioteki. Sprawdź połączenie i spróbuj ponownie.'; return; }
    try { library = await unlockLibrary(password,payload); }
    catch { $('login-error').textContent = 'Nieprawidłowe hasło. Spróbuj ponownie.'; $('password').select(); return; }
    $('password').value = ''; $('password').type = 'password'; $('toggle-password').textContent = 'Pokaż'; $('toggle-password').setAttribute('aria-label','Pokaż hasło'); $('toggle-password').setAttribute('aria-pressed','false');
    $('lock-screen').hidden = true; $('workspace').hidden = false; select(library.templates[0].id,true); $('search-input').focus(); session++;
  } finally { unlockPending = false; $('unlock-button').disabled = false; $('unlock-button').textContent = 'Otwórz bibliotekę'; }
});
$('toggle-password').addEventListener('click', () => { const show = $('password').type === 'password'; $('password').type = show ? 'text':'password'; $('toggle-password').textContent = show ? 'Ukryj':'Pokaż'; $('toggle-password').setAttribute('aria-label',show ? 'Ukryj hasło':'Pokaż hasło'); $('toggle-password').setAttribute('aria-pressed',String(show)); });
function lock() {
  session++; library = null; current = null; mode = 'text'; drafts.clear(); subjects.clear();
  $('workspace').hidden = true; $('lock-screen').hidden = false;
  for (const id of ['email-editor','template-list','template-title','template-purpose','template-tags','template-note']) $(id).replaceChildren();
  for (const id of ['password','subject-input','search-input','copy-fallback-text']) $(id).value = '';
  $('group-filter').value = 'all'; $('login-error').textContent = ''; $('toast').hidden = true; $('copy-fallback').close(); $('password').focus();
}
$('lock-button').addEventListener('click',lock);
window.addEventListener('pagehide', () => { if (library) lock(); });
$('search-input').addEventListener('input',renderList); $('group-filter').addEventListener('change',renderList);
$('format-text').addEventListener('click', () => setMode('text')); $('format-visual').addEventListener('click', () => setMode('visual'));
$('subject-input').addEventListener('input',save); $('email-editor').addEventListener('input',save);
$('email-editor').addEventListener('paste', event => { event.preventDefault(); const plain = event.clipboardData.getData('text/plain'); document.execCommand('insertText',false,plain); save(); });
$('email-editor').addEventListener('drop', event => event.preventDefault());
$('email-editor').addEventListener('click', event => { const link = event.target.closest('a'); if (link && (event.ctrlKey || event.metaKey)) window.open(link.href,'_blank','noopener,noreferrer'); });
$('reset-template').addEventListener('click', () => { if (!current) return; drafts.delete(`${current.id}:text`); drafts.delete(`${current.id}:visual`); subjects.delete(current.id); $('subject-input').value = current.subject; $('email-editor').innerHTML = renderEmail(current,mode); toast('Przywrócono oryginalny temat i treść.'); });

function legacyCopy(html, plain) {
  const holder = document.createElement('div'); holder.contentEditable = 'true'; holder.style.cssText='position:fixed;left:-10000px;top:0;'; holder.innerHTML = html || escapeHTML(plain).replace(/\n/g,'<br>');
  document.body.append(holder); const selection = getSelection(); const saved = selection.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
  const range = document.createRange(); range.selectNodeContents(holder); selection.removeAllRanges(); selection.addRange(range);
  const handler = event => { if (event.clipboardData) { event.clipboardData.setData('text/plain',plain); if (html) event.clipboardData.setData('text/html',html); event.preventDefault(); } };
  document.addEventListener('copy',handler); let success = false;
  try { success = document.execCommand('copy'); } catch { }
  document.removeEventListener('copy',handler); holder.remove(); selection.removeAllRanges(); if (saved) selection.addRange(saved); return success;
}
async function copy({html,plain,message}) {
  const activeSession = session;
  try {
    if (html && navigator.clipboard?.write && window.ClipboardItem) await navigator.clipboard.write([new ClipboardItem({'text/html':new Blob([html],{type:'text/html'}),'text/plain':new Blob([plain],{type:'text/plain'})})]);
    else if (!html && navigator.clipboard?.writeText) await navigator.clipboard.writeText(plain);
    else if (!legacyCopy(html,plain)) throw new Error();
    if (session === activeSession) toast(message);
  } catch {
    if (session !== activeSession) return;
    if (legacyCopy(html,plain)) toast(message);
    else { $('copy-fallback-text').value = plain; $('copy-fallback').showModal(); $('copy-fallback-text').select(); }
  }
}
$('copy-subject').addEventListener('click', () => copy({plain:$('subject-input').value,message:'Temat skopiowany.'}));
$('copy-email').addEventListener('click', () => { save(); const html = fragment(current); copy({html,plain:emailText(html),message:'Mail skopiowany. Wklej go nad swoją stopką.'}); });
$('copy-plain').addEventListener('click', () => { save(); copy({plain:emailText(fragment(current)),message:'Zwykły tekst z linkami skopiowany.'}); });
$('close-copy-fallback').addEventListener('click', () => $('copy-fallback').close());

function download(name, blob) {
  const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = name; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url),3000);
}
$('download-html').addEventListener('click', () => { save(); download(`prescot-${current.id}${mode === 'visual' ? '-zdjecia':''}.html`,new Blob([htmlDocument(subject(current),fragment(current))],{type:'text/html;charset=utf-8'})); toast('Pobrano HTML bez podpisu i stopki.'); });
$('download-txt').addEventListener('click', () => { save(); download(`prescot-${current.id}.txt`,new Blob([`Temat: ${subject(current)}\n\n${emailText(fragment(current))}\n`],{type:'text/plain;charset=utf-8'})); });
$('download-all').addEventListener('click', () => {
  if (!library) return; save(); const files = [];
  for (const t of library.templates) {
    const prefix = `${String(library.templates.indexOf(t)+1).padStart(2,'0')}-${t.id}/`;
    files.push({name:prefix+'mail.html',content:htmlDocument(subject(t),fragment(t,'text'))});
    files.push({name:prefix+'mail-ze-zdjeciami.html',content:htmlDocument(subject(t),fragment(t,'visual'))});
    files.push({name:prefix+'mail.txt',content:`Temat: ${subject(t)}\n\n${emailText(fragment(t,'text'))}\n`});
  }
  download('PRESCOT-10-maili.zip',createZip(files)); toast('Pobrano 10 maili: HTML, wersje ze zdjęciami i TXT.');
});
