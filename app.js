// Basic interactions for the static scaffold
document.addEventListener('DOMContentLoaded', ()=>{
  // add small focus effect for cards
  document.querySelectorAll('.card').forEach(c=>{
    c.addEventListener('keydown', e=>{ if(e.key === 'Enter') c.click(); });
  });
  initAuth().catch(()=>{});
});

// Supabase sync (shared data across devices)
const SUPABASE_URL = 'https://htouztosuozgjzlzvbua.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh0b3V6dG9zdW96Z2p6bHp2YnVhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE0OTQzOTksImV4cCI6MjA4NzA3MDM5OX0.e9sNNd0yDMVn33bXGsF2SY5X4b7TAb_9FRx7l9OR-3Q';
const SUPABASE_TABLE = 'rds_kv';
const AUTH_SESSION_KEY = 'rds_auth_session_v1';
let __supabaseSyncGuard = false;

function getAuthSession(){
  try{ return JSON.parse(localStorage.getItem(AUTH_SESSION_KEY) || 'null'); }
  catch(e){ return null; }
}

function setAuthSession(session){
  try{ localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(session)); }catch(e){}
}

function clearAuthSession(){
  try{ localStorage.removeItem(AUTH_SESSION_KEY); }catch(e){}
}

function isLoginPage(){
  return /\/pages\/login\.html$/.test(location.pathname || '');
}

function getLoginUrl(){
  const inPages = (location.pathname || '').includes('/pages/');
  return `${inPages ? '../' : './'}pages/login.html`;
}

function redirectToLogin(){
  if(isLoginPage()) return;
  location.href = getLoginUrl();
}

function isAuthExpired(session){
  if(!session || !session.expires_at) return true;
  const now = Math.floor(Date.now() / 1000);
  return now >= (session.expires_at - 60);
}

async function refreshAuthSession(session){
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ refresh_token: session.refresh_token })
  });
  const data = await res.json().catch(()=> ({}));
  if(!res.ok){
    throw new Error(data?.error_description || data?.msg || 'Error al refrescar sesión');
  }
  const next = {
    access_token: data.access_token,
    refresh_token: data.refresh_token || session.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
    user: data.user || session.user
  };
  setAuthSession(next);
  return next;
}

async function loginWithEmail(email, password){
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ email, password })
  });
  const data = await res.json().catch(()=> ({}));
  if(!res.ok){
    throw new Error(data?.error_description || data?.msg || 'Credenciales inválidas');
  }
  const session = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
    user: data.user
  };
  setAuthSession(session);
  return session;
}

async function logout(){
  try{
    const session = getAuthSession();
    if(session?.access_token){
      await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${session.access_token}`
        }
      });
    }
  }catch(e){ /* ignore */ }
  clearAuthSession();
  redirectToLogin();
}

function injectAuthBar(session){
  if(document.querySelector('.auth-bar')) return;
  const bar = document.createElement('div');
  bar.className = 'auth-bar';
  const email = session?.user?.email || 'Usuario';
  bar.innerHTML = `
    <div class="auth-user">👤 ${email}</div>
    <button class="btn btn-secondary auth-logout" type="button">Cerrar sesión</button>
  `;
  document.body.prepend(bar);
  const btn = bar.querySelector('.auth-logout');
  if(btn) btn.addEventListener('click', ()=> logout());
}

function initLoginPage(){
  const form = document.querySelector('#login-form');
  const errorBox = document.querySelector('#login-error');
  if(!form) return;
  form.addEventListener('submit', async (e)=>{
    e.preventDefault();
    if(errorBox) errorBox.textContent = '';
    const email = document.querySelector('#login-email')?.value?.trim();
    const password = document.querySelector('#login-password')?.value;
    if(!email || !password){
      if(errorBox) errorBox.textContent = 'Ingresa tu correo y contraseña.';
      return;
    }
    try{
      await loginWithEmail(email, password);
      location.href = '../index.html';
    }catch(err){
      if(errorBox) errorBox.textContent = err?.message || 'No se pudo iniciar sesión.';
    }
  });
}

async function initAuth(){
  if(isLoginPage()){
    initLoginPage();
    return;
  }
  let session = getAuthSession();
  if(!session){
    redirectToLogin();
    return;
  }
  if(isAuthExpired(session)){
    try{
      session = await refreshAuthSession(session);
    }catch(e){
      clearAuthSession();
      redirectToLogin();
      return;
    }
  }
  injectAuthBar(session);
  try{ await supabaseLoadAll(); }catch(e){}
}

async function supabaseRequest(path, options = {}){
  const session = getAuthSession();
  const token = session?.access_token || SUPABASE_ANON_KEY;
  const headers = {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    ...options.headers
  };
  const res = await fetch(`${SUPABASE_URL}${path}`, { ...options, headers });
  if(!res.ok){
    const text = await res.text().catch(()=> '');
    throw new Error(text || `Supabase error ${res.status}`);
  }
  if(res.status === 204) return null;
  return res.json();
}

async function supabaseLoadAll(){
  try{
    const rows = await supabaseRequest(`/rest/v1/${SUPABASE_TABLE}?select=key,value`);
    if(!Array.isArray(rows)) return;
    __supabaseSyncGuard = true;
    rows.forEach(r=>{
      if(!r || !r.key) return;
      localStorage.setItem(r.key, JSON.stringify(r.value));
    });
  }catch(e){
    console.warn('Supabase load failed:', e.message || e);
  }finally{
    __supabaseSyncGuard = false;
  }
}

async function supabaseUpsert(key, value){
  try{
    await supabaseRequest(`/rest/v1/${SUPABASE_TABLE}`, {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify([{ key, value }])
    });
  }catch(e){
    console.warn('Supabase upsert failed:', e.message || e);
  }
}

async function supabaseDelete(key){
  try{
    await supabaseRequest(`/rest/v1/${SUPABASE_TABLE}?key=eq.${encodeURIComponent(key)}` , {
      method: 'DELETE'
    });
  }catch(e){
    console.warn('Supabase delete failed:', e.message || e);
  }
}

// Utility to download CSV (used later by export page)
function downloadCSV(filename, rows){
  const csv = rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], {type: 'text/csv;charset=utf-8;'});
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

window.downloadCSV = downloadCSV;

function downloadXLSX(filename, rows, sheetName){
  if(!window.XLSX){
    downloadCSV(filename.replace(/\.xlsx$/i, '.csv'), rows);
    return;
  }
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, sheetName || 'Hoja1');
  XLSX.writeFile(wb, filename);
}

function downloadXLSXWorkbook(filename, sheets){
  if(!window.XLSX){
    const first = sheets && sheets[0] ? sheets[0].rows : [];
    downloadCSV(filename.replace(/\.xlsx$/i, '.csv'), first);
    return;
  }
  const wb = XLSX.utils.book_new();
  (sheets||[]).forEach(s=>{
    const ws = XLSX.utils.aoa_to_sheet(s.rows || []);
    XLSX.utils.book_append_sheet(wb, ws, s.name || 'Hoja');
  });
  XLSX.writeFile(wb, filename);
}

/* ========================================
   Global Audit Logger (tracks all rds_* changes)
   ======================================== */
const AUDIT_KEY = 'rds_audit_log_v1';
const __originalSetItem = localStorage.setItem.bind(localStorage);
const __originalRemoveItem = localStorage.removeItem.bind(localStorage);
let __auditWriteGuard = false;

function __safeParseJSON(val){
  if(val === null || val === undefined) return null;
  try { return JSON.parse(val); } catch(e){ return val; }
}

function loadAuditLog(){
  try{
    const raw = localStorage.getItem(AUDIT_KEY);
    return raw ? JSON.parse(raw) : [];
  }catch(e){ return []; }
}

function __logAudit(event){
  try{
    if(__auditWriteGuard) return;
    __auditWriteGuard = true;
    const arr = loadAuditLog();
    arr.push(event);
    if(arr.length > 5000){
      arr.splice(0, arr.length - 5000);
    }
    __originalSetItem(AUDIT_KEY, JSON.stringify(arr));
  }catch(e){
    // swallow
  } finally {
    __auditWriteGuard = false;
  }
}

localStorage.setItem = function(key, value){
  try{
    if(!__auditWriteGuard && key && key.startsWith('rds_') && key !== AUDIT_KEY && key !== AUTH_SESSION_KEY){
      const prevRaw = localStorage.getItem(key);
      const prev = __safeParseJSON(prevRaw);
      const next = __safeParseJSON(value);
      const op = prevRaw === null ? 'create' : 'update';
      __logAudit({
        ts: new Date().toISOString(),
        op,
        key,
        prev,
        next,
        page: (typeof location !== 'undefined' ? location.pathname : ''),
      });
    }
    if(!__supabaseSyncGuard && key && key.startsWith('rds_') && key !== AUTH_SESSION_KEY){
      const parsed = __safeParseJSON(value);
      supabaseUpsert(key, parsed);
    }
  }catch(e){ /* ignore */ }
  return __originalSetItem(key, value);
};

localStorage.removeItem = function(key){
  try{
    if(!__auditWriteGuard && key && key.startsWith('rds_') && key !== AUDIT_KEY && key !== AUTH_SESSION_KEY){
      const prev = __safeParseJSON(localStorage.getItem(key));
      __logAudit({
        ts: new Date().toISOString(),
        op: 'delete',
        key,
        prev,
        next: null,
        page: (typeof location !== 'undefined' ? location.pathname : ''),
      });
    }
    if(!__supabaseSyncGuard && key && key.startsWith('rds_') && key !== AUTH_SESSION_KEY){
      supabaseDelete(key);
    }
  }catch(e){ /* ignore */ }
  return __originalRemoveItem(key);
};

// expose loader globally for reuse
window.loadAuditLog = loadAuditLog;

/* ---------- Students localStorage management (Replay Dance Studio) ---------- */
const STORAGE_KEY = 'rds_students_v1';

/* Deleted records archive */
const ARCHIVE_KEY = 'rds_deleted_archive_v1';
function loadArchive(){
  try{
    const raw = localStorage.getItem(ARCHIVE_KEY);
    return raw ? JSON.parse(raw) : [];
  }catch(e){
    return [];
  }
}
function saveArchive(arr){
  try{ localStorage.setItem(ARCHIVE_KEY, JSON.stringify(arr)); }catch(e){}
}
function addArchiveEntry(type, label, data){
  const arr = loadArchive();
  arr.unshift({
    id: `arch-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
    type,
    label: label || '',
    data,
    deletedAt: new Date().toISOString()
  });
  if(arr.length > 2000) arr.length = 2000;
  saveArchive(arr);
}

/* Notes storage for alumnas page */
const NOTES_KEY = 'rds_alumnas_notes_v1';

function loadAlumnasNotes(){ return localStorage.getItem(NOTES_KEY) || ''; }
function saveAlumnasNotes(txt){ localStorage.setItem(NOTES_KEY, String(txt||'')); }
function getAlumnasNotesKey(monthKey){ return `${NOTES_KEY}_${monthKey}`; }
function loadAlumnasNotesForMonth(monthKey){
  if(!monthKey) return '';
  try{ return localStorage.getItem(getAlumnasNotesKey(monthKey)) || ''; }catch(e){ return ''; }
}
function saveAlumnasNotesForMonth(monthKey, txt){
  if(!monthKey) return;
  try{ localStorage.setItem(getAlumnasNotesKey(monthKey), String(txt||'')); }catch(e){}
}

/* Rental management storage keys */
const RENTAL_SCHEDULES_KEY = 'rds_rental_schedules_v1';
const RENTAL_PEOPLE_KEY = 'rds_rental_people_v1';
const RENTAL_NOTES_KEY = 'rds_rental_notes_v1';
const RENTAL_CLIP_KEY = 'rds_rental_clipboard_v1';
const RENTAL_WEEKLY_SCHEDULE_KEY = 'rds_rental_weekly_schedule_v1'; // Same format as calendario

/* Montajes / XV Años storage keys */
const XV_KEY = 'rds_xv_v1';
const XV_CAL_KEY = 'rds_xv_calendar_v1';
const XV_NOTES_KEY = 'rds_xv_notes_v1';
const CHOREO_KEY = 'rds_choreo_v1';
const CHOREO_CAL_KEY = 'rds_choreo_calendar_v1';
const CHOREO_NOTES_KEY = 'rds_choreo_notes_v1';
const PACKAGES_KEY = 'rds_packages_v1';

function loadRentalSchedules(){ try{ const raw = localStorage.getItem(RENTAL_SCHEDULES_KEY); return raw ? JSON.parse(raw) : {}; }catch(e){ return {}; } }
function saveRentalSchedules(obj){ try{ localStorage.setItem(RENTAL_SCHEDULES_KEY, JSON.stringify(obj)); }catch(e){} }

function loadRentalPeople(){ try{ const raw = localStorage.getItem(RENTAL_PEOPLE_KEY); return raw ? JSON.parse(raw) : []; }catch(e){ return []; } }
function saveRentalPeople(arr){ try{ localStorage.setItem(RENTAL_PEOPLE_KEY, JSON.stringify(arr)); }catch(e){} }


function getRentalNotesKey(monthKey){ return `${RENTAL_NOTES_KEY}_${monthKey}`; }
function loadRentalNotesForMonth(monthKey){
  if(!monthKey) return '';
  try{ return localStorage.getItem(getRentalNotesKey(monthKey)) || ''; }catch(e){ return ''; }
}
function saveRentalNotesForMonth(monthKey, txt){
  if(!monthKey) return;
  try{ localStorage.setItem(getRentalNotesKey(monthKey), String(txt||'')); }catch(e){}
}

function loadRentalWeeklySchedule(){ try{ const raw = localStorage.getItem(RENTAL_WEEKLY_SCHEDULE_KEY); return raw ? JSON.parse(raw) : {}; }catch(e){ return {}; } }
function saveRentalWeeklySchedule(obj){ try{ localStorage.setItem(RENTAL_WEEKLY_SCHEDULE_KEY, JSON.stringify(obj)); }catch(e){} }

function monthYearKey(date){ const d = new Date(date); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; }

function addRentalScheduleEntry(monthYearStr, weekNumber, day, time, groups, amount, attendance, personId){
  const schedules = loadRentalSchedules();
  if(!schedules[monthYearStr]) schedules[monthYearStr] = {};
  if(!schedules[monthYearStr][weekNumber]) schedules[monthYearStr][weekNumber] = [];
  const id = `${monthYearStr}-w${weekNumber}-${Date.now()}`;
  const entry = { id, day, time, groups, amount, attendance: attendance || 'pending' };
  if(personId) entry.personId = personId;
  schedules[monthYearStr][weekNumber].push(entry);
  saveRentalSchedules(schedules);
  try{ syncSimpleScheduleForRentals(); }catch(e){}
  return id;
}

function deleteRentalScheduleEntry(monthYearStr, weekNumber, entryId){
  const schedules = loadRentalSchedules();
  if(schedules[monthYearStr] && schedules[monthYearStr][weekNumber]){
    const entry = schedules[monthYearStr][weekNumber].find(e => e.id === entryId);
    if(entry){
      addArchiveEntry('Renta-Horario', `${entry.groups||''} ${entry.day||''} ${entry.time||''}`.trim(), {monthYear: monthYearStr, weekNumber, ...entry});
    }
    schedules[monthYearStr][weekNumber] = schedules[monthYearStr][weekNumber].filter(e => e.id !== entryId);
  }
  saveRentalSchedules(schedules);
  try{ syncSimpleScheduleForRentals(); }catch(e){}
}

function updateRentalScheduleEntry(monthYearStr, weekNumber, entryId, updates){
  const schedules = loadRentalSchedules();
  if(schedules[monthYearStr] && schedules[monthYearStr][weekNumber]){
    const entry = schedules[monthYearStr][weekNumber].find(e => e.id === entryId);
    if(entry) Object.assign(entry, updates);
    saveRentalSchedules(schedules);
    try{ syncSimpleScheduleForRentals(); }catch(e){}
  }
}

function addRentalPerson(name, group, phone, monthYear){
  const people = loadRentalPeople();
  const id = `person-${Date.now()}`;
  people.push({ id, name, group, phone, schedules: [], amount: 0, monthYear, payments: [], notes: '', notesUpdatedAt: '' });
  saveRentalPeople(people);
  return id;
}

function openAddRentalPersonModal(monthYear){
  const existing = document.querySelector('.modal-backdrop');
  if(existing) existing.remove();
  
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.style.maxWidth = '500px';
  
  modal.innerHTML = `
    <h3>✨ Agregar Nueva Persona</h3>
    <form id="add-rental-person-form" style="margin-top:16px">
      <div style="margin-bottom:12px">
        <label style="display:block;margin-bottom:4px;font-weight:600">Nombre *</label>
        <input id="rp-nombre" class="input" placeholder="Nombre completo" required />
      </div>
      
      <div style="margin-bottom:12px">
        <label style="display:block;margin-bottom:4px;font-weight:600">Grupo/Escuela</label>
        <input id="rp-grupo" class="input" placeholder="Ej: Ballet Folklórico" />
      </div>
      
      <div style="margin-bottom:12px">
        <label style="display:block;margin-bottom:4px;font-weight:600">Teléfono</label>
        <input id="rp-telefono" class="input" type="tel" placeholder="Ej: 123-456-7890" />
      </div>
      
      <div style="text-align:right;margin-top:20px">
        <button type="button" id="rp-cancel" class="btn btn-secondary">Cancelar</button>
        <button type="submit" class="btn" style="margin-left:8px">Guardar</button>
      </div>
    </form>
  `;
  
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);
  
  document.getElementById('rp-cancel').addEventListener('click', ()=>backdrop.remove());
  document.getElementById('add-rental-person-form').addEventListener('submit', (e)=>{
    e.preventDefault();
    const nombre = document.getElementById('rp-nombre').value.trim();
    if(!nombre){ alert('El nombre es requerido'); return; }
    
    const grupo = document.getElementById('rp-grupo').value.trim();
    const telefono = document.getElementById('rp-telefono').value.trim();
    
    const id = addRentalPerson(nombre, grupo, telefono, monthYear);
    backdrop.remove();
    renderRentalPeople(monthYear);
    
    // Open edit modal to add schedules
    const person = loadRentalPeople().find(p => p.id === id);
    if(person) openPersonEditModal(person, monthYear);
  });
  
  // Focus on first input
  setTimeout(()=> document.getElementById('rp-nombre').focus(), 100);
}

function deleteRentalPerson(personId){
  const all = loadRentalPeople();
  const toDelete = all.find(p => p.id === personId);
  if(toDelete){ addArchiveEntry('Renta-Persona', toDelete.name || '', toDelete); }
  const people = all.filter(p => p.id !== personId);
  saveRentalPeople(people);
  try{ syncSimpleScheduleForRentals(); }catch(e){}
}

function updateRentalPerson(personId, updates){
  const people = loadRentalPeople();
  const person = people.find(p => p.id === personId);
  if(person) Object.assign(person, updates);
  saveRentalPeople(people);
}

function addPersonSchedule(personId, day, time, monthYear){
  const people = loadRentalPeople();
  const person = people.find(p => p.id === personId);
  if(person){
    if(!person.schedules) person.schedules = [];
    person.schedules.push({ day, time });
    saveRentalPeople(people);
  }
}

function syncPersonToSchedule(personId, monthYearStr, weekNumber){
  const people = loadRentalPeople();
  const person = people.find(p => p.id === personId);
  if(person && person.schedules){
    // remove existing entries for this person in that week to avoid duplicates
    try{ removeScheduleEntriesByPerson(monthYearStr, weekNumber, personId); }catch(e){}
    person.schedules.forEach(sch => {
      addRentalScheduleEntry(monthYearStr, weekNumber, sch.day, sch.time, person.name, person.amount || 0, 'pending', personId);
    });
  }
}

function removeScheduleEntriesByPerson(monthYearStr, weekNumber, personId){
  if(!personId) return;
  const schedules = loadRentalSchedules();
  if(schedules[monthYearStr] && schedules[monthYearStr][weekNumber]){
    schedules[monthYearStr][weekNumber] = schedules[monthYearStr][weekNumber].filter(e => e.personId !== personId);
    saveRentalSchedules(schedules);
  }
}

// Clipboard helpers: copy a person's schedules into localStorage, and paste into a target month/week
function copyPersonSchedulesToClipboard(personId){
  const people = loadRentalPeople();
  const p = people.find(x => x.id === personId);
  if(!p){ alert('Persona no encontrada para copiar'); return; }
  const clip = { personId: p.id, name: p.name, group: p.group||'', amount: p.amount||0, schedules: p.schedules || [] };
  try{ localStorage.setItem(RENTAL_CLIP_KEY, JSON.stringify(clip)); alert('Horarios copiados al portapapeles'); }catch(e){ alert('Error al copiar horarios'); }
}

function pasteSchedulesFromClipboard(targetMonthYear, targetWeekNumber, options){
  const raw = localStorage.getItem(RENTAL_CLIP_KEY);
  if(!raw){ alert('Portapapeles vacío'); return; }
  try{
    const clip = JSON.parse(raw);
    if(!clip.schedules || clip.schedules.length === 0){ alert('No hay horarios en el portapapeles'); return; }
    // remove existing entries for this person in target week to prevent duplicates
    if(clip.personId){
      try{ removeScheduleEntriesByPerson(targetMonthYear, targetWeekNumber, clip.personId); }catch(e){}
    }
    // append schedules into target week
    clip.schedules.forEach(sch => {
      addRentalScheduleEntry(targetMonthYear, targetWeekNumber, sch.day, sch.time, clip.name, clip.amount || 0, 'pending', clip.personId);
    });
    // re-render
    try{ renderAllSchedules(targetMonthYear); }catch(e){}
    try{ syncSimpleScheduleForRentals(); }catch(e){}
    alert('Horarios pegados en semana '+targetWeekNumber+' de '+targetMonthYear);
  }catch(e){ alert('Formato inválido en portapapeles'); }
}


/* Disciplines storage */
const DISC_KEY = 'rds_disciplines_v1';
const DELETED_DISC_KEY = 'rds_deleted_disciplines_v1'; // store deleted disciplines with student history

function loadDisciplines(){
  try{ const raw = localStorage.getItem(DISC_KEY); return raw? JSON.parse(raw): ['Ballet Kids','Gimnasia Kids','Baile Moderno','K-pop I','K-pop II','Jazz','Gimnasia','Ballet','Heels']; }catch(e){ return ['Ballet Kids','Gimnasia Kids','Baile Moderno','K-pop I','K-pop II','Jazz','Gimnasia','Ballet','Heels']; }
}

/* Debts (adeudos) storage */
const DEBT_KEY = 'rds_adeudos_v1';
function loadDebts(){ try{ const raw = localStorage.getItem(DEBT_KEY); return raw? JSON.parse(raw): []; }catch(e){ return []; } }
function saveDebts(arr){ localStorage.setItem(DEBT_KEY, JSON.stringify(arr)); }
let currentAlumnasMonthKey = '';

function getAlumnasMonthKey(){
  if(currentAlumnasMonthKey) return currentAlumnasMonthKey;
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
}

function setAlumnasMonthKey(monthKey){
  currentAlumnasMonthKey = monthKey || getAlumnasMonthKey();
  const label = document.getElementById('debt-month-label');
  if(label) label.textContent = formatDebtMonthLabel(currentAlumnasMonthKey);
  const remindersTextarea = document.getElementById('reminders-textarea');
  if(remindersTextarea){
    remindersTextarea.value = loadAlumnasNotesForMonth(currentAlumnasMonthKey);
  }
  renderDebtsTable();
  renderMonthlyPaymentsList();
}

function formatDebtMonthLabel(monthKey){
  if(!monthKey) return '';
  const [year, month] = monthKey.split('-').map(Number);
  if(!year || !month) return monthKey;
  const months = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  return `${months[month-1]} ${year}`;
}

function renderDebtsTable(){
  const tbody = document.getElementById('debt-tbody'); if(!tbody) return;
  const allDebts = loadDebts();
  const activeMonthKey = getAlumnasMonthKey();
  const getDebtMonthKey = (d) => {
    if(d && d.createdAt){
      const dt = new Date(d.createdAt);
      if(!Number.isNaN(dt.getTime())){
        return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}`;
      }
    }
    const dateStr = d && (d.payDate || d.dueDate) ? (d.payDate || d.dueDate) : '';
    if(dateStr && /^\d{4}-\d{2}/.test(dateStr)) return dateStr.slice(0,7);
    return '';
  };
  const debts = allDebts.filter(d => getDebtMonthKey(d) === activeMonthKey);
  tbody.innerHTML = '';
  debts.forEach((d, idx)=>{
    const tr = document.createElement('tr');
    // render due date and pay date as clickable links to open calendar editor
    const dueDateHtml = d.dueDate ? `<a href="#" class="debt-duedate" data-date="${escapeHtml(d.dueDate)}">${escapeHtml(d.dueDate)}</a>` : '';
    const payDateHtml = d.payDate ? `<a href="#" class="debt-paydate" data-date="${escapeHtml(d.payDate)}">${escapeHtml(d.payDate)}</a>` : '';
    tr.innerHTML = `
      <td>${escapeHtml(d.studentName||'')}</td>
      <td>${escapeHtml(d.amount||'')}</td>
      <td>${escapeHtml(d.recargo||'')}</td>
      <td>${escapeHtml(d.concept||'')}</td>
      <td>${dueDateHtml}</td>
      <td>${d.paid? 'Sí':'No'}</td>
      <td>${payDateHtml}</td>
      <td class="actions">
        <div style="display:flex;gap:8px;align-items:center;justify-content:flex-end">
          <button class="btn btn-secondary debt-edit" data-idx="${idx}" title="Editar">✏️</button>
          <button class="btn debt-delete" data-idx="${idx}" title="Eliminar">🗑️</button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
    // add native tooltips (title) for truncated cells so user can read full content
    try{
      const tds = tr.querySelectorAll('td');
      if(tds && tds.length){
        if(tds[0]) tds[0].title = d.studentName || '';
        if(tds[1]) tds[1].title = d.amount || '';
        if(tds[2]) tds[2].title = d.recargo || '';
        if(tds[3]) tds[3].title = d.concept || '';
        if(tds[4]) tds[4].title = d.dueDate || '';
        if(tds[6]) tds[6].title = d.payDate || '';
      }
    }catch(e){}
  });
  // attach handlers
  // attach handlers for edit/delete (visible buttons)

  tbody.querySelectorAll('.debt-delete').forEach(b=> b.addEventListener('click', ()=>{
    const idx = Number(b.dataset.idx); const arr = loadDebts(); arr.splice(idx,1); saveDebts(arr); renderDebtsTable();
  }));
  // (mark-paid action removed from menu — only Edit/Delete available in actions menu)
  tbody.querySelectorAll('.debt-edit').forEach(b=> b.addEventListener('click', ()=>{
    const idx = Number(b.dataset.idx); const arr = loadDebts(); const d = arr[idx]; if(!d) return; // populate form
    document.getElementById('debt-student').value = d.studentId || '';
    document.getElementById('debt-amount').value = d.amount || '';
    document.getElementById('debt-recargo').value = d.recargo || '';
    document.getElementById('debt-concept').value = d.concept || '';
    document.getElementById('debt-paid').checked = !!d.paid;
    // payment date is always visible; populate it if present
    const paydate = document.getElementById('debt-paydate'); if(paydate){ paydate.value = d.payDate || ''; }
    const duedate = document.getElementById('debt-duedate'); if(duedate) duedate.value = d.dueDate || '';
    // attach a temp attribute to the add button for editing
    const addBtn = document.getElementById('add-debt-btn'); addBtn.dataset.editIdx = idx; addBtn.textContent = 'Guardar cambios';
  }));
  // attach handlers for pay date links to open calendar editor
  tbody.querySelectorAll('.debt-paydate').forEach(a=> a.addEventListener('click', e=>{
    e.preventDefault();
    const date = a.dataset.date; if(!date) return;
    const m = date.match(/(\d{4})-(\d{2})-(\d{2})/);
    if(!m) return;
    const monthKey = `${m[1]}-${m[2]}`;
    const day = String(parseInt(m[3],10));
    const store = loadCalendar();
    const note = (store[monthKey] && store[monthKey].days && store[monthKey].days[day]) || '';
    // if the mini-calendar currently shows the same month and the cell exists, highlight it briefly
    const cell = document.querySelector(`#mini-calendar .calendar-cell[data-day="${day}"]`);
    if(cell){
      cell.classList.add('highlight');
      cell.classList.add('pulse');
      try{ cell.scrollIntoView({behavior:'smooth', block:'center'}); }catch(e){}
      setTimeout(()=>{ cell.classList.remove('pulse'); setTimeout(()=>cell.classList.remove('highlight'), 300); }, 1600);
    }
    openCalNoteEditor(monthKey, day, note, ()=>{ initMiniCalendar(); });
  }));
  // due date links
  tbody.querySelectorAll('.debt-duedate').forEach(a=> a.addEventListener('click', e=>{
    e.preventDefault();
    const date = a.dataset.date; if(!date) return;
    const m = date.match(/(\d{4})-(\d{2})-(\d{2})/);
    if(!m) return;
    const monthKey = `${m[1]}-${m[2]}`;
    const day = String(parseInt(m[3],10));
    const store = loadCalendar();
    const note = (store[monthKey] && store[monthKey].days && store[monthKey].days[day]) || '';
    const cell = document.querySelector(`#mini-calendar .calendar-cell[data-day="${day}"]`);
    if(cell){ cell.classList.add('highlight'); cell.classList.add('pulse'); try{ cell.scrollIntoView({behavior:'smooth', block:'center'}); }catch(e){} setTimeout(()=>{ cell.classList.remove('pulse'); setTimeout(()=>cell.classList.remove('highlight'), 300); }, 1600); }
    openCalNoteEditor(monthKey, day, note, ()=>{ initMiniCalendar(); });
  }));

}

function renderMonthlyPaymentsList(){
  const tbody = document.getElementById('payments-month-tbody');
  const label = document.getElementById('payments-month-label');
  if(!tbody || !label) return;
  const monthKey = getAlumnasMonthKey();
  label.textContent = formatDebtMonthLabel(monthKey);
  const students = loadStudents();
  const rows = [];
  students.forEach(s => {
    const payments = (s.personal && Array.isArray(s.personal.payments)) ? s.personal.payments : [];
    payments.forEach(p => {
      if(!p.date || !/^\d{4}-\d{2}/.test(p.date)) return;
      if(p.date.slice(0,7) !== monthKey) return;
      const disciplines = Array.isArray(s.disciplines)
        ? s.disciplines.map(d => d.name).filter(Boolean).join('<br>')
        : '';
      rows.push({
        date: p.date,
        name: s.name || '',
        disciplines,
        amount: p.amount || 0,
        paid: !!p.paid
      });
    });
  });
  rows.sort((a,b)=> (b.date||'').localeCompare(a.date||''));
  tbody.innerHTML = '';
  if(rows.length === 0){
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 5;
    td.style.textAlign = 'center';
    td.style.padding = '1rem';
    td.style.color = '#666';
    td.textContent = 'No hay pagos registrados en este mes.';
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }
  rows.forEach(r => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(r.date)}</td>
      <td>${escapeHtml(r.name)}</td>
      <td>${r.disciplines || ''}</td>
      <td>${escapeHtml(String(r.amount))}</td>
      <td>${r.paid ? 'Sí' : 'No'}</td>
    `;
    tbody.appendChild(tr);
  });
}

// Floating scroll controls for debts table
function initDebtFloatingScroll(){
  try{
    const wrap = document.querySelector('#debts-block .table-wrap');
    const left = document.getElementById('debt-scroll-left-f');
    const right = document.getElementById('debt-scroll-right-f');
    if(!wrap || !left || !right) return;
    const update = ()=>{
      const max = Math.max(0, wrap.scrollWidth - wrap.clientWidth);
      left.disabled = wrap.scrollLeft <= 0;
      right.disabled = wrap.scrollLeft >= max - 1;
    };
    left.addEventListener('click', ()=>{ wrap.scrollBy({left: -320, behavior:'smooth'}); setTimeout(update, 220); });
    right.addEventListener('click', ()=>{ wrap.scrollBy({left: 320, behavior:'smooth'}); setTimeout(update, 220); });
    wrap.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    setTimeout(update, 80);
  }catch(e){}
}



function addOrSaveDebtFromForm(){
  const studentId = document.getElementById('debt-student').value;
  const studentName = document.getElementById('debt-student').selectedOptions[0]?.text || '';
  const amount = document.getElementById('debt-amount').value.trim();
  const recargo = document.getElementById('debt-recargo').value.trim();
  const concept = document.getElementById('debt-concept').value.trim();
  const paid = document.getElementById('debt-paid').checked;
  const payDate = document.getElementById('debt-paydate') ? document.getElementById('debt-paydate').value || '' : '';
  const dueDate = document.getElementById('debt-duedate') ? document.getElementById('debt-duedate').value || '' : '';
  if(!studentId){ alert('Selecciona una alumna'); return; }
  const arr = loadDebts();
  const addBtn = document.getElementById('add-debt-btn');
  const editIdx = addBtn.dataset.editIdx;
  const existing = (editIdx !== undefined && editIdx !== null && editIdx !== '') ? arr[Number(editIdx)] : null;
  const monthKey = getAlumnasMonthKey();
  const createdAt = existing && existing.createdAt ? existing.createdAt : (()=>{
    const now = new Date();
    const parts = monthKey.split('-').map(Number);
    if(parts.length === 2){
      now.setFullYear(parts[0], parts[1]-1, 1);
    }
    return now.toISOString();
  })();
  const entry = { studentId, studentName, amount, recargo, concept, dueDate, paid, payDate, createdAt };
  if(editIdx !== undefined && editIdx !== null && editIdx !== ''){
    arr[Number(editIdx)] = entry; delete addBtn.dataset.editIdx; addBtn.textContent = 'Agregar adeudo';
  } else {
    arr.push(entry);
  }
  saveDebts(arr); renderDebtsTable(); // clear form
  document.getElementById('debt-form').reset();
  // keep paydate box always visible
  try{
    const payInput = document.getElementById('debt-paydate');
    if(payInput) payInput.style.display = 'inline-block';
  }catch(e){}
  // if marked paid and has a date, add calendar event
  if(entry.paid && entry.payDate){
    try{ addCalendarEvent(entry.payDate, `Pago: ${entry.studentName} — $${entry.amount} — ${entry.concept}`); }catch(e){}
  }
  // if due date set, add a calendar reminder for due date
  if(entry.dueDate){
    try{ addCalendarEvent(entry.dueDate, `Vencimiento adeudo: ${entry.studentName} — $${entry.amount} — ${entry.concept}`); }catch(e){}
  }
}

function refreshDebtStudentOptions(){
  try{
    const sel = document.getElementById('debt-student'); if(!sel) return;
    const cur = sel.value;
    const students = loadStudents().sort(sortStudents);
    sel.innerHTML = '<option value="">-- Selecciona alumna --</option>';
    students.forEach(s=>{ const opt = document.createElement('option'); opt.value = s.id; opt.textContent = s.name; sel.appendChild(opt); });
    // try to restore previous selection when possible
    if(cur){ sel.value = cur; if(!sel.value) sel.value = ''; }
  }catch(e){}
}

function loadDeletedDisciplines(){
  try{ const raw = localStorage.getItem(DELETED_DISC_KEY); return raw? JSON.parse(raw): {}; }catch(e){ return {}; }
}

function saveDisciplines(arr){ localStorage.setItem(DISC_KEY, JSON.stringify(arr)); updateDisciplineDatalist(); }

function saveDeletedDisciplineRecord(disciplineName, affectedStudents){
  const record = loadDeletedDisciplines();
  record[disciplineName] = { deletedAt: new Date().toISOString(), students: affectedStudents };
  localStorage.setItem(DELETED_DISC_KEY, JSON.stringify(record));
}

function updateDisciplineDatalist(){
  const dl = document.getElementById('disciplines-datalist');
  if(!dl) return;
  const list = loadDisciplines(); dl.innerHTML = '';
  list.forEach(d=>{ const opt = document.createElement('option'); opt.value = d; dl.appendChild(opt); });
}

function openManageDisciplines(){
  const existing = document.querySelector('.modal-backdrop'); if(existing) existing.remove();
  const backdrop = document.createElement('div'); backdrop.className='modal-backdrop';
  const modal = document.createElement('div'); modal.className='modal';
  const discs = loadDisciplines();
  modal.innerHTML = `
    <h3>Configurar disciplinas</h3>
    <div style="margin-top:8px">
      <input id="new-disc-input" class="input" placeholder="Nueva disciplina" />
      <button id="new-disc-add" class="btn btn-secondary" style="margin-left:8px">Agregar</button>
    </div>
    <div style="margin-top:10px;display:flex;justify-content:space-between;align-items:center">
      <div style="font-size:13px;color:var(--muted)">Lista actual de disciplinas</div>
      <div>
        <button id="show-deleted-btn" class="btn btn-secondary">Ver registros eliminados</button>
      </div>
    </div>
    <div id="disc-list" class="disc-manage-list" style="margin-top:12px"></div>
    <div id="deleted-records" style="margin-top:12px;display:none;max-height:220px;overflow:auto;border-top:1px dashed rgba(0,0,0,0.06);padding-top:8px"></div>
    <div style="text-align:right;margin-top:12px">
      <button id="disc-close" class="btn btn-secondary">Cerrar</button>
    </div>
  `;
  backdrop.appendChild(modal); document.body.appendChild(backdrop);

  const listEl = document.getElementById('disc-list');
  function renderList(){
    listEl.innerHTML = '';
    loadDisciplines().forEach((d,idx)=>{
      const item = document.createElement('div'); item.className='disc-item';
      item.innerHTML = `<div style="display:flex;gap:10px;align-items:center"><div class="name">${escapeHtml(d)}</div></div><div class="disc-actions"><button class="btn btn-secondary" data-idx="${idx}" data-action="rename">Renombrar</button><button class="btn" data-idx="${idx}" data-action="delete">Eliminar</button></div>`;
      listEl.appendChild(item);
    });
    // attach actions
    listEl.querySelectorAll('button').forEach(b=> b.addEventListener('click', e=>{
      const idx = Number(b.dataset.idx);
      const action = b.dataset.action;
      if(action==='rename'){
        const newName = prompt('Nuevo nombre para la disciplina', loadDisciplines()[idx]);
        if(newName && newName.trim()){
          const arr = loadDisciplines(); const old = arr[idx]; arr[idx] = newName.trim(); saveDisciplines(arr);
          // propagate rename to students
          const students = loadStudents().map(s=>{ s.disciplines = s.disciplines.map(d=> d.name===old ? {...d, name:newName.trim()} : d); return s; }); saveStudents(students); renderStudentsTable(); renderList();
        }
      } else if(action==='delete'){
        if(!confirm('Eliminar disciplina y eliminarla de todas las alumnas?')) return;
        const arr = loadDisciplines();
        const removed = arr.splice(idx,1)[0];
        // record affected students (snapshot) before removal
        const students = loadStudents();
        const affectedStudents = students
          .filter(s=> s.disciplines.some(d=> d.name === removed))
          .map(s=> ({ id: s.id, name: s.name, disciplines: s.disciplines.map(d=> ({ name: d.name, schedule: d.schedule, amount: d.amount })) }));
        saveDeletedDisciplineRecord(removed, affectedStudents);
        // remove the discipline from students and save
        const updatedStudents = students.map(s=>{ s.disciplines = s.disciplines.filter(d=> d.name !== removed); return s; });
        saveStudents(updatedStudents);
        saveDisciplines(arr);
        renderStudentsTable();
        renderList();
      }
    }));
  }

  document.getElementById('new-disc-add').addEventListener('click', ()=>{
    const v = document.getElementById('new-disc-input').value.trim(); if(!v) return; const arr = loadDisciplines(); arr.push(v); saveDisciplines(arr); document.getElementById('new-disc-input').value=''; renderList();
  });

  const showDeletedBtn = document.getElementById('show-deleted-btn');
  const deletedRecordsEl = document.getElementById('deleted-records');
  if(showDeletedBtn){
    showDeletedBtn.addEventListener('click', ()=>{
      if(!deletedRecordsEl) return;
      if(deletedRecordsEl.style.display === 'none' || deletedRecordsEl.style.display === ''){
        const records = loadDeletedDisciplines();
        deletedRecordsEl.innerHTML = '';
        if(Object.keys(records).length === 0){
          deletedRecordsEl.innerHTML = '<div style="color:var(--muted)">No hay registros eliminados.</div>';
        } else {
          Object.keys(records).forEach(name=>{
            const r = records[name];
            const block = document.createElement('div');
            block.style.padding = '8px';
            block.style.borderBottom = '1px solid rgba(0,0,0,0.03)';
            const when = new Date(r.deletedAt).toLocaleString();
            block.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center"><div><div style="font-weight:700;color:var(--pink)">${escapeHtml(name)}</div><div style="font-size:12px;color:var(--muted)">Eliminado: ${when} — ${r.students.length} alumnas afectadas</div></div><div><button class="btn btn-secondary restore-disc-btn" data-name="${escapeHtml(name)}">Restaurar</button></div></div>`;
            const list = document.createElement('div');
            list.style.marginTop = '6px';
            r.students.forEach(s=>{ const si = document.createElement('div'); si.style.fontSize='13px'; si.textContent = `${s.name} (id: ${s.id})`; list.appendChild(si); });
            block.appendChild(list);
            deletedRecordsEl.appendChild(block);
          });
          // attach restore handlers
          deletedRecordsEl.querySelectorAll('.restore-disc-btn').forEach(btn=> btn.addEventListener('click', e=>{
            const dname = btn.dataset.name;
            if(!dname) return;
            if(!confirm(`Restaurar la disciplina "${dname}" y reasignarla a las alumnas registradas?`)) return;
            const recordsNow = loadDeletedDisciplines();
            const record = recordsNow[dname];
            if(!record) { alert('Registro no encontrado'); return; }
            // restore discipline to list if missing
            const discs = loadDisciplines();
            if(!discs.includes(dname)){
              discs.push(dname);
              saveDisciplines(discs);
            }
            // restore discipline entries to students using snapshot
            const students = loadStudents();
            const updated = students.map(s=>{
              const snap = record.students.find(x=> x.id === s.id);
              if(snap){
                // add discipline back if not already present
                if(!s.disciplines.some(dd=> dd.name === dname)){
                  // find discipline object in snapshot to preserve schedule/amount
                  const snapDisc = snap.disciplines ? snap.disciplines.find(dd=> dd.name === dname) : null;
                  const toAdd = snapDisc ? { name: dname, schedule: snapDisc.schedule, amount: snapDisc.amount } : { name: dname, schedule: '', amount: 0 };
                  s.disciplines.push(toAdd);
                }
              }
              return s;
            });
            saveStudents(updated);
            // remove record after restore
            delete recordsNow[dname];
            localStorage.setItem(DELETED_DISC_KEY, JSON.stringify(recordsNow));
            alert('Disciplina restaurada');
            renderStudentsTable();
            // refresh deleted records view
            showDeletedBtn.click();
            showDeletedBtn.click();
          }));
        }
        deletedRecordsEl.style.display = 'block';
        showDeletedBtn.textContent = 'Ocultar registros';
      } else {
        deletedRecordsEl.style.display = 'none';
        showDeletedBtn.textContent = 'Ver registros eliminados';
      }
    });
  }

  document.getElementById('disc-close').addEventListener('click', ()=>backdrop.remove());
  renderList();
}


function loadStudents(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  }catch(e){ console.error('Load students error', e); return []; }
}

function saveStudents(arr){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
}

function sortStudents(a,b){
  return a.name.localeCompare(b.name, 'es', {sensitivity:'base'});
}

function renderStudentsTable(filterType='', filterDiscipline=''){
  const tbody = document.querySelector('#alumnas-tbody');
  if(!tbody) return;
  let students = loadStudents().sort(sortStudents);
  
  // filter by type
  if(filterType) { students = students.filter(s=> s.type === filterType); }
  
  // filter by discipline: if a discipline is selected, show only students with that discipline
  if(filterDiscipline){
    students = students.filter(s=> s.disciplines.some(d=> d.name === filterDiscipline));
  }
  
  tbody.innerHTML = '';
  students.forEach(s=>{
    const tr = document.createElement('tr');
    let schedText = '', amountText = '';
    
    // if filterDiscipline is set, show only that discipline's hours and amount
    if(filterDiscipline){
      const disc = s.disciplines.find(d=> d.name === filterDiscipline);
      if(disc){ schedText = disc.schedule || ''; amountText = formatAmount(disc.amount||0); }
    } else {
      // show all disciplines' hours and amounts
      schedText = s.disciplines.map(d=>d.schedule).filter(Boolean).join(' • ');
      amountText = formatAmount(totalAmount(s));
    }
    
    tr.innerHTML = `
      <td>${s.type}</td>
      <td><a href="#" class="student-link" data-id="${s.id}">${escapeHtml(s.name)}</a></td>
      <td>${escapeHtml(s.disciplines.map(d=>d.name).join(', '))}</td>
      <td>${escapeHtml(schedText)}</td>
      <td>${amountText}</td>
      <td><input type="checkbox" data-id="${s.id}" class="paid-checkbox" ${s.paid? 'checked':''}></td>
      <td><button class="btn btn-secondary delete-btn" data-id="${s.id}">🗑️</button></td>
    `;
    tbody.appendChild(tr);
  });

  // attach handlers
  document.querySelectorAll('.student-link').forEach(el=>el.addEventListener('click', e=>{
    e.preventDefault(); openStudentModal(el.dataset.id);
  }));
  document.querySelectorAll('.paid-checkbox').forEach(cb=>cb.addEventListener('change', e=>{
    const id = cb.dataset.id; togglePaid(id, cb.checked);
  }));
  document.querySelectorAll('.delete-btn').forEach(b=>b.addEventListener('click', e=>{
    if(confirm('Eliminar registro?')){ deleteStudent(b.dataset.id); }
  }));
}

function totalAmount(s){
  return s.disciplines.reduce((sum,d)=>sum + (Number(d.amount)||0),0);
}

function formatAmount(n){
  return n ? `$${n}` : '$0';
}

function escapeHtml(txt){
  return String(txt||'').replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;" }[c]));
}

function addStudentFromForm(ev){
  ev && ev.preventDefault();
  const type = document.querySelector('#input-type').value;
  const name = document.querySelector('#input-name').value.trim();
  if(!name) { alert('Nombre es requerido'); return; }
  const disciplines = [];
  document.querySelectorAll('.discipline-row').forEach(row=>{
    const d = row.querySelector('.disc-name')?.value.trim();
    const dayChecks = row.querySelectorAll('.disc-day-check:checked');
    const timeVal = row.querySelector('.disc-time')?.value.trim() || '';
    const selectedDays = Array.from(dayChecks||[]).map(o=>o.value.trim()).filter(Boolean);
    const amt = Number(row.querySelector('.disc-amt')?.value) || 0;
    if(d){
      const sched = selectedDays.length ? (selectedDays.join('/') + (timeVal? ' ' + timeVal : '')) : timeVal;
      disciplines.push({name:d,schedule:sched,amount:amt});
    }
  });

  const paid = document.querySelector('#input-paid').checked;
  const students = loadStudents();
  students.push({id:Date.now().toString(),type,name,disciplines,paid,personal:{}});
  saveStudents(students);
  
  // close modal if exists
  const backdrop = document.querySelector('.modal-backdrop');
  if(backdrop) backdrop.remove();
  
  renderStudentsTable();
  // refresh debt student select so new student is available immediately
  try{ if(typeof refreshDebtStudentOptions === 'function') refreshDebtStudentOptions(); }catch(e){}
  // refresh attendance lists if present
  try{ if(typeof refreshAttendanceStudentList === 'function') refreshAttendanceStudentList(); }catch(e){}
}

function openAddStudentModal(){
  const existing = document.querySelector('.modal-backdrop');
  if(existing) existing.remove();
  
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.style.maxWidth = '700px';
  
  // Get available disciplines for datalist
  const allDisciplines = loadDisciplines();
  let datalistOptions = '';
  allDisciplines.forEach(d => {
    datalistOptions += `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`;
  });
  
  modal.innerHTML = `
    <h3>✨ Agregar Alumna</h3>
    <form id="form-add" style="margin-top:16px">
      <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px">
        <div style="flex:1;min-width:180px">
          <label style="display:block;margin-bottom:4px;font-weight:600">Tipo *</label>
          <select id="input-type" class="input" required>
            <option>Inscrito</option>
            <option>Clase Muestra</option>
            <option>Clase Suelta</option>
          </select>
        </div>
        <div style="flex:2;min-width:220px">
          <label style="display:block;margin-bottom:4px;font-weight:600">Nombre *</label>
          <input id="input-name" class="input" placeholder="Nombre completo" required />
        </div>
        <div style="flex:1;min-width:120px">
          <label style="display:block;margin-bottom:4px;font-weight:600">Pagó</label>
          <div style="margin-top:6px"><input id="input-paid" type="checkbox" /></div>
        </div>
      </div>

      <div style="margin-bottom:12px">
        <label style="display:block;margin-bottom:8px;font-weight:600">Disciplinas / Horario / Monto</label>
        <div style="display:flex;gap:10px;align-items:flex-start">
          <div style="flex:1">
            <div id="disciplines-holder" class="discipline-list"></div>
            <datalist id="disciplines-datalist">${datalistOptions}</datalist>
          </div>
          <div style="width:220px;display:flex;flex-direction:column;gap:8px">
            <button type="button" id="add-disc-btn" class="btn btn-secondary">+ Agregar disciplina</button>
            <button type="button" id="manage-disciplines" class="btn">Configurar disciplinas</button>
          </div>
        </div>
      </div>

      <div style="text-align:right;margin-top:20px">
        <button type="button" id="student-cancel" class="btn btn-secondary">Cancelar</button>
        <button type="submit" class="btn" style="margin-left:8px">Guardar</button>
      </div>
    </form>
  `;
  
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);
  
  // Add discipline button
  document.getElementById('add-disc-btn').addEventListener('click', ()=>{
    const holder = document.getElementById('disciplines-holder');
    const row = document.createElement('div');
    row.className = 'discipline-row';
    row.style.display = 'flex';
    row.style.gap = '8px';
    row.style.alignItems = 'center';
    row.style.marginBottom = '8px';
    const dayOptions = ['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo']
      .map(d=>`<label style="display:flex;align-items:center;gap:6px;font-size:12px"><input type="checkbox" class="disc-day-check" value="${d}"> ${d}</label>`).join('');
    row.innerHTML = `
      <input class="disc-name input" list="disciplines-datalist" placeholder="Disciplina" style="flex:2" />
      <div class="disc-days" style="flex:1;min-width:160px;display:flex;flex-wrap:wrap;gap:6px;padding:6px;border:1px solid rgba(0,0,0,0.06);border-radius:8px">${dayOptions}</div>
      <input class="disc-time input" placeholder="Hora (Ej: 6:00 PM)" style="flex:1" />
      <input class="disc-amt input" type="number" placeholder="Monto" style="flex:0.8" />
      <button type="button" class="btn btn-secondary remove-disc" style="padding:6px 10px">✕</button>
    `;
    holder.appendChild(row);
    row.querySelector('.remove-disc').addEventListener('click', ()=> row.remove());
  });
  
  // Manage disciplines button
  document.getElementById('manage-disciplines').addEventListener('click', ()=>{
    openDisciplineManager();
  });
  
  // Cancel button
  document.getElementById('student-cancel').addEventListener('click', ()=>backdrop.remove());
  
  // Submit form
  document.getElementById('form-add').addEventListener('submit', addStudentFromForm);
  
  // Focus on first input
  setTimeout(()=> document.getElementById('input-name').focus(), 100);
}

function deleteStudent(id){
  const all = loadStudents();
  const toDelete = all.find(s=> s.id === id);
  if(toDelete){ addArchiveEntry('Alumna', toDelete.name || '', toDelete); }
  const arr = all.filter(s=>s.id !== id);
  saveStudents(arr); renderStudentsTable();
  try{ if(typeof refreshDebtStudentOptions === 'function') refreshDebtStudentOptions(); }catch(e){}
  try{ if(typeof refreshAttendanceStudentList === 'function') refreshAttendanceStudentList(); }catch(e){}
}

function togglePaid(id, checked){
  const arr = loadStudents().map(s=> s.id===id? {...s, paid:checked}: s);
  saveStudents(arr);
}

/* Modal: open and edit student personal info */
function openStudentModal(id){
  const students = loadStudents();
  const s = students.find(x=>x.id===id);
  if(!s) return alert('Registro no encontrado');
  const STUDENT_UI_KEY = 'rds_student_ui_state_v1';
  const loadStudentUIState = () => {
    try{
      const raw = localStorage.getItem(STUDENT_UI_KEY);
      const obj = raw ? JSON.parse(raw) : {};
      return obj && obj[s.id] ? obj[s.id] : {};
    }catch(e){
      return {};
    }
  };
  const saveStudentUIState = (updates) => {
    try{
      const raw = localStorage.getItem(STUDENT_UI_KEY);
      const obj = raw ? JSON.parse(raw) : {};
      obj[s.id] = { ...(obj[s.id]||{}), ...updates };
      localStorage.setItem(STUDENT_UI_KEY, JSON.stringify(obj));
    }catch(e){}
  };
  const uiState = loadStudentUIState();
  // build modal
  const existing = document.querySelector('.modal-backdrop'); if(existing) existing.remove();
  const backdrop = document.createElement('div'); backdrop.className='modal-backdrop';
  const modal = document.createElement('div'); modal.className='modal';
  modal.innerHTML = `
    <h3>Información Personal — ${escapeHtml(s.name)}</h3>
    <section>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div>
        <label>Fecha de nacimiento</label>
        <input class="input" id="m-dob" value="${escapeHtml(s.personal.dob||'')}" />
      </div>
      <div>
        <label>Edad</label>
        <input class="input" id="m-age" value="${escapeHtml(s.personal.age||'')}" />
      </div>
      <div>
        <label>Género</label>
        <input class="input" id="m-gender" value="${escapeHtml(s.personal.gender||'')}" />
      </div>
      <div>
        <label>Teléfono</label>
        <input class="input" id="m-phone" value="${escapeHtml(s.personal.phone||'')}" />
      </div>
      <div style="grid-column:1/3">
        <label>Dirección</label>
        <input class="input" id="m-address" value="${escapeHtml(s.personal.address||'')}" />
      </div>
    </div>
    </section>
    <hr />
    <section>
    <h4 style="margin:8px 0">Información del Padre/Tutor</h4>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div><label>Nombre del Tutor</label><input class="input" id="m-tutor-name" value="${escapeHtml(s.personal.tutorName||'')}" /></div>
      <div><label>Parentesco</label><input class="input" id="m-tutor-rel" value="${escapeHtml(s.personal.tutorRel||'')}" /></div>
      <div><label>Teléfono del tutor</label><input class="input" id="m-tutor-phone" value="${escapeHtml(s.personal.tutorPhone||'')}" /></div>
      <div><label>Teléfono de casa</label><input class="input" id="m-home-phone" value="${escapeHtml(s.personal.homePhone||'')}" /></div>
      <div style="grid-column:1/3"><label>Persona autorizada para recoger</label><input class="input" id="m-authorized" value="${escapeHtml(s.personal.authorized||'')}" /></div>
    </div>
    </section>
    <hr />
    <section>
    <h4 style="margin:8px 0">Información adicional</h4>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div>
        <label>Ocupación</label>
        <input class="input" id="m-occupation" value="${escapeHtml(s.personal.occupation||'')}" />
      </div>
      <div>
        <label>Redes Sociales (Instagram, TikTok, etc.)</label>
        <input class="input" id="m-social" value="${escapeHtml(s.personal.social||'')}" />
      </div>
      <div>
        <label>Teléfono de Casa</label>
        <input class="input" id="m-home-phone2" value="${escapeHtml(s.personal.homePhone2||'')}" />
      </div>
    </div>
    </section>
    <hr />
    <section>
    <h4 style="margin:8px 0">Alergias</h4>
    <div style="display:flex;align-items:center;gap:10px;margin-top:8px">
      <label style="display:flex;align-items:center;gap:8px">
        <input type="checkbox" id="m-allergy-check" ${s.personal.hasAllergy? 'checked':''} />
        <span>¿Alérgico a algún medicamento?</span>
      </label>
    </div>
    <div id="m-allergy-details" style="margin-top:8px;display:${s.personal.hasAllergy? 'block':'none'}">
      <textarea id="m-allergy-text" class="input" placeholder="Descripción de alergias" style="min-height:80px">${escapeHtml(s.personal.allergyDetails||'')}</textarea>
    </div>
    </section>
    <hr />
    <section>
    <h4 style="margin:8px 0">En caso de emergencia llamar a:</h4>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div>
        <label>Nombre</label>
        <input class="input" id="m-emergency-name" value="${escapeHtml(s.personal.emergencyName||'')}" />
      </div>
      <div>
        <label>Teléfono</label>
        <input class="input" id="m-emergency-phone" value="${escapeHtml(s.personal.emergencyPhone||'')}" />
      </div>
      <div>
        <label>Parentesco</label>
        <input class="input" id="m-emergency-rel" value="${escapeHtml(s.personal.emergencyRel||'')}" />
      </div>
      <div>
        <label>Dirección</label>
        <input class="input" id="m-emergency-address" value="${escapeHtml(s.personal.emergencyAddress||'')}" />
      </div>
    </div>
    </section>
    <hr />
    <section>
    <h4 style="margin:8px 0">Fechas importantes</h4>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div>
        <label>Fecha de inscripción</label>
        <input type="date" class="input" id="m-inscription" value="${escapeHtml(s.personal.inscriptionDate||'')}" />
      </div>
      <div>
        <label>Ensayos (una por línea: YYYY-MM-DD | Disciplina | Nota)</label>
        <textarea id="m-ensayos" class="input" style="min-height:80px">${escapeHtml((s.personal.ensayos||[]).map(e=>`${e.date} | ${e.disc||''} | ${e.note||''}`).join('\n'))}</textarea>
      </div>
    </div>
    </section>

    <hr />
    <section>
    <h4 style="margin:8px 0">Disciplinas Inscritas</h4>
    <div id="m-disciplines-holder" style="display:flex;flex-direction:column;gap:8px;margin-top:8px;max-height:200px;overflow-y:auto"></div>
    <div style="margin-top:6px"><button id="add-discipline-row" class="btn btn-secondary">+ Agregar disciplina</button></div>
    </section>

    <div class="payments-highlight" style="margin-top:12px">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
        <label style="font-weight:700;color:var(--pink)">Pagos</label>
        <button id="payments-toggle-btn" class="btn btn-secondary" type="button">Mostrar pagos</button>
      </div>
      <div id="payments-section" style="margin-top:8px;display:none">
        <div id="payments-holder" style="display:flex;flex-direction:column;gap:8px"></div>
        <div style="margin-top:6px"><button id="add-payment-row" class="btn btn-secondary" type="button">+ Agregar pago</button></div>
      </div>
    </div>

    <hr />
    <section class="history-section">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">
      <h4 style="margin:8px 0">Historial por Alumna</h4>
      <button id="student-history-toggle" class="btn btn-secondary" type="button">Mostrar historial</button>
    </div>
    <div id="student-history-filters" style="display:none;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px">
      <label style="font-weight:700;color:var(--muted)">Mes</label>
      <input type="month" id="student-history-month" class="input" style="max-width:180px" />
      <label style="font-weight:700;color:var(--muted)">Tipo</label>
      <select id="student-history-type" class="input" style="max-width:200px">
        <option value="all">Todos</option>
        <option value="payment">Pagos</option>
        <option value="attendance">Asistencia</option>
        <option value="note">Notas/Ensayos</option>
        <option value="inscription">Inscripción</option>
      </select>
    </div>
    <div id="student-history-timeline" style="display:none;flex-direction:column;gap:8px;max-height:220px;overflow:auto"></div>
    </section>

    <div style="text-align:right;margin-top:12px">
      <button id="m-save" class="btn">Guardar</button>
      <button id="m-close" class="btn btn-secondary">Cerrar</button>
    </div>
  `;
  backdrop.appendChild(modal); document.body.appendChild(backdrop);

  document.getElementById('m-close').addEventListener('click', ()=>backdrop.remove());
  
  // toggle allergy details textarea visibility
  const allergyCheck = document.getElementById('m-allergy-check');
  const allergyDetails = document.getElementById('m-allergy-details');
  allergyCheck.addEventListener('change', ()=>{
    allergyDetails.style.display = allergyCheck.checked? 'block':'none';
  });

  // disciplines editor
  const disciplinesHolder = document.getElementById('m-disciplines-holder');
  function renderDisciplinesEditor(){
    disciplinesHolder.innerHTML = '';
    s.disciplines.forEach((disc, idx)=>{
      const row = document.createElement('div');
      row.className = 'discipline-row discipline-item';
      row.style.display = 'flex';
      row.style.gap = '8px';
      row.style.alignItems = 'center';
      const discs = loadDisciplines();
      const opts = discs.map(d=>`<option ${d===disc.name? 'selected':''} value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('');
      let presetDays = [], presetTime='';
      if(disc.schedule){
        const parts = disc.schedule.split(/\s+/);
        if(parts.length){
          const daysPart = parts[0];
          const rest = parts.slice(1).join(' ');
          presetDays = daysPart.includes('/') ? daysPart.split('/') : [daysPart];
          presetTime = rest;
        }
      }
      row.innerHTML = `
        <select class="m-disc-name input" style="flex:1"><option value="">-- Seleccionar --</option>${opts}</select>
        <input class="m-disc-sched input" placeholder="Horario (ej: Lunes 6:00 pm)" value="${escapeHtml(disc.schedule||'')}" style="flex:1" />
        <input class="m-disc-amt input" placeholder="Monto" value="${escapeHtml(disc.amount||0)}" style="flex:0.6" />
        <button class="btn btn-secondary remove-disc-modal" data-idx="${idx}" style="padding:6px 8px">Eliminar</button>
      `;
      disciplinesHolder.appendChild(row);
    });
    // attach delete handlers
    disciplinesHolder.querySelectorAll('.remove-disc-modal').forEach(btn=> btn.addEventListener('click', e=>{
      const idx = Number(btn.dataset.idx);
      s.disciplines.splice(idx, 1);
      renderDisciplinesEditor();
    }));
  }
  renderDisciplinesEditor();
  
  const addDiscBtn = document.getElementById('add-discipline-row');
  if(addDiscBtn){
    addDiscBtn.addEventListener('click', ()=>{
      s.disciplines.push({name:'', schedule:'', amount:0});
      renderDisciplinesEditor();
    });
  }

  const saveBtn = document.getElementById('m-save');
  if(saveBtn){
  saveBtn.addEventListener('click', ()=>{
    // update disciplines from the editor (legacy single schedule input)
    const newDisciplines = [];
    document.querySelectorAll('.m-disc-name').forEach((sel)=>{
      const name = sel.value;
      const schedInput = sel.parentElement.querySelector('.m-disc-sched');
      const sched = schedInput ? (schedInput.value || '') : '';
      const amt = Number(sel.parentElement.querySelector('.m-disc-amt')?.value) || 0;
      if(name) newDisciplines.push({name, schedule: sched, amount: amt});
    });
    s.disciplines = newDisciplines;
    s.personal = {
      dob: document.getElementById('m-dob').value,
      age: document.getElementById('m-age').value,
      gender: document.getElementById('m-gender').value,
      phone: document.getElementById('m-phone').value,
      address: document.getElementById('m-address').value,
      tutorName: document.getElementById('m-tutor-name').value,
      tutorRel: document.getElementById('m-tutor-rel').value,
      tutorPhone: document.getElementById('m-tutor-phone').value,
      homePhone: document.getElementById('m-home-phone').value,
      authorized: document.getElementById('m-authorized').value,
      occupation: document.getElementById('m-occupation').value,
      social: document.getElementById('m-social').value,
      homePhone2: document.getElementById('m-home-phone2').value,
      hasAllergy: document.getElementById('m-allergy-check').checked,
      allergyDetails: document.getElementById('m-allergy-text').value,
      emergencyName: document.getElementById('m-emergency-name').value,
      emergencyPhone: document.getElementById('m-emergency-phone').value,
      emergencyRel: document.getElementById('m-emergency-rel').value,
      emergencyAddress: document.getElementById('m-emergency-address').value,
      inscriptionDate: document.getElementById('m-inscription').value,
      ensayos: []
    };
    // parse ensayos textarea
    const ensTxt = document.getElementById('m-ensayos').value.trim();
    if(ensTxt){
      const lines = ensTxt.split('\n').map(l=>l.trim()).filter(Boolean);
      s.personal.ensayos = lines.map(l=>{
        const parts = l.split('|').map(p=>p.trim());
        return {date:parts[0]||'', disc:parts[1]||'', note:parts[2]||''};
      });
    }
    // payments
    const payments = [];
    document.querySelectorAll('.payment-row').forEach(r=>{
      const date = r.querySelector('.pay-date').value;
      const amt = Number(r.querySelector('.pay-amt').value) || 0;
      const paid = r.querySelector('.pay-paid').checked;
      if(date) payments.push({date,amount:amt,paid});
    });
    s.personal.payments = payments;
    const arr = loadStudents().map(x=> x.id===s.id ? s : x);
    saveStudents(arr);
    // synchronize with calendar: inscription, payments, ensayos
    if(s.personal.inscriptionDate){ addCalendarEvent(s.personal.inscriptionDate, `Inscripción - ${s.name}`); }
    (s.personal.payments||[]).forEach(p=>{
      if(p.date) addCalendarEvent(p.date, `Pago - ${s.name} - $${p.amount} ${p.paid? '(OK)':''}`);
    });
    (s.personal.ensayos||[]).forEach(e=>{ if(e.date) addCalendarEvent(e.date, `Ensayo - ${s.name} ${e.disc? ' - '+e.disc:''} ${e.note? ' - '+e.note:''}`); });

    backdrop.remove(); renderStudentsTable(); renderMonthlyPaymentsList();
  });
  }

  // populate payments UI
  const paymentsHolder = document.getElementById('payments-holder');
  function renderPayments(){
    paymentsHolder.innerHTML = '';
    (s.personal.payments||[]).forEach(p=>{
      const row = document.createElement('div'); row.className='payment-row';
      row.style.display='flex'; row.style.gap='8px'; row.style.flexWrap='wrap';
      row.innerHTML = `
        <input type="date" class="pay-date input" value="${escapeHtml(p.date||'')}">
        <input class="pay-amt input" placeholder="Monto" value="${escapeHtml(p.amount||'')}">
        <label style="display:flex;align-items:center;gap:6px"><input type="checkbox" class="pay-paid" ${p.paid? 'checked':''}>Pagó</label>
        <button class="btn btn-secondary remove-pay">Eliminar</button>
      `;
      paymentsHolder.appendChild(row);
      row.querySelector('.remove-pay').addEventListener('click', ()=>{ row.remove(); });
    });
  }
  renderPayments();

  function getDateMonthKey(dateStr){
    if(!dateStr || typeof dateStr !== 'string') return '';
    if(/^\d{4}-\d{2}/.test(dateStr)) return dateStr.slice(0,7);
    return '';
  }

  function renderStudentHistoryTimeline(){
    const container = document.getElementById('student-history-timeline');
    if(!container) return;
    const monthFilter = document.getElementById('student-history-month')?.value || '';
    const typeFilter = document.getElementById('student-history-type')?.value || 'all';
    const entries = [];
    const addEntry = (dateStr, title, detail, kind) => {
      if(!dateStr) return;
      entries.push({date: dateStr, title, detail, kind});
    };

    // Inscripción
    if(s.personal?.inscriptionDate){
      addEntry(s.personal.inscriptionDate, 'Inscripción', s.personal.inscriptionDate, 'inscription');
    }

    // Pagos
    (s.personal?.payments||[]).forEach(p=>{
      if(!p.date) return;
      addEntry(p.date, 'Pago', `$${p.amount||0}${p.paid? ' (OK)':''}`, 'payment');
    });

    // Ensayos / notas
    (s.personal?.ensayos||[]).forEach(e=>{
      if(!e.date) return;
      const detail = `${e.disc||''}${e.note? ' — '+e.note:''}`.trim();
      addEntry(e.date, 'Ensayo / Nota', detail || 'Ensayo', 'note');
    });

    // Asistencia
    try{
      const store = loadAttendance();
      Object.keys(store||{}).forEach(dateKey=>{
        const byDisc = store[dateKey]||{};
        Object.keys(byDisc).forEach(disc=>{
          const rec = byDisc[disc] && byDisc[disc][s.id];
          if(rec){
            addEntry(dateKey, `Asistencia (${disc})`, rec.present ? 'Presente' : 'Ausente', 'attendance');
          }
        });
      });
    }catch(e){}

    let filtered = entries;
    if(monthFilter){
      filtered = filtered.filter(e=> getDateMonthKey(e.date) === monthFilter);
    }
    if(typeFilter && typeFilter !== 'all'){
      filtered = filtered.filter(e=> e.kind === typeFilter);
    }

    filtered.sort((a,b)=>{
      const da = new Date(a.date); const db = new Date(b.date);
      return db - da;
    });

    if(filtered.length === 0){
      container.innerHTML = '<div style="color:var(--muted)">Sin registros aún.</div>';
      return;
    }

    container.innerHTML = '';
    filtered.forEach(item=>{
      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.justifyContent = 'space-between';
      row.style.gap = '10px';
      row.style.padding = '8px 10px';
      row.style.border = '1px solid rgba(0,0,0,0.06)';
      row.style.borderRadius = '8px';
      row.innerHTML = `
        <div>
          <div style="font-weight:700;color:var(--pink)">${escapeHtml(item.title)}</div>
          <div style="font-size:12px;color:var(--muted)">${escapeHtml(item.detail||'')}</div>
        </div>
        <div style="font-weight:700;color:var(--black);white-space:nowrap">${escapeHtml(item.date)}</div>
      `;
      container.appendChild(row);
    });
  }

  renderStudentHistoryTimeline();

  const historyMonthInput = document.getElementById('student-history-month');
  if(historyMonthInput && !historyMonthInput.value){
    const d = new Date();
    historyMonthInput.value = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  }
  if(historyMonthInput){
    historyMonthInput.addEventListener('change', renderStudentHistoryTimeline);
  }
  const historyTypeSelect = document.getElementById('student-history-type');
  if(historyTypeSelect){
    historyTypeSelect.addEventListener('change', renderStudentHistoryTimeline);
  }

  const historyToggleBtn = document.getElementById('student-history-toggle');
  if(historyToggleBtn){
    const timeline = document.getElementById('student-history-timeline');
    const filters = document.getElementById('student-history-filters');
    if(uiState.historyOpen && timeline){
      timeline.style.display = 'flex';
      if(filters) filters.style.display = 'flex';
      historyToggleBtn.textContent = 'Ocultar historial';
    }
    historyToggleBtn.addEventListener('click', ()=>{
      const timeline = document.getElementById('student-history-timeline');
      const filters = document.getElementById('student-history-filters');
      if(!timeline) return;
      const isHidden = timeline.style.display === 'none';
      timeline.style.display = isHidden ? 'flex' : 'none';
      if(filters) filters.style.display = isHidden ? 'flex' : 'none';
      historyToggleBtn.textContent = isHidden ? 'Ocultar historial' : 'Mostrar historial';
      saveStudentUIState({historyOpen: isHidden});
    });
  }
  document.getElementById('add-payment-row').addEventListener('click', ()=>{
    const row = document.createElement('div'); row.className='payment-row'; row.style.display='flex'; row.style.gap='8px'; row.style.flexWrap='wrap';
    row.innerHTML = `
      <input type="date" class="pay-date input">
      <input class="pay-amt input" placeholder="Monto">
      <label style="display:flex;align-items:center;gap:6px"><input type="checkbox" class="pay-paid">Pagó</label>
      <button class="btn btn-secondary remove-pay">Eliminar</button>
    `;
    paymentsHolder.appendChild(row);
    row.querySelector('.remove-pay').addEventListener('click', ()=>row.remove());
  });

  const paymentsToggleBtn = document.getElementById('payments-toggle-btn');
  const paymentsSection = document.getElementById('payments-section');
  if(paymentsToggleBtn && paymentsSection){
    if(uiState.paymentsOpen){
      paymentsSection.style.display = 'block';
      paymentsToggleBtn.textContent = 'Ocultar pagos';
    }
    paymentsToggleBtn.addEventListener('click', ()=>{
      const isHidden = paymentsSection.style.display === 'none';
      paymentsSection.style.display = isHidden ? 'block' : 'none';
      paymentsToggleBtn.textContent = isHidden ? 'Ocultar pagos' : 'Mostrar pagos';
      saveStudentUIState({paymentsOpen: isHidden});
    });
  }
}

/* UI helpers for add-discipline rows */
function addDisciplineRow(name='',sched='',amt=''){
  const holder = document.querySelector('#disciplines-holder');
  const row = document.createElement('div'); row.className='discipline-row discipline-item';
  const discs = loadDisciplines();
  const opts = discs.map(d=>`<option ${d===name? 'selected':''} value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('');
  let presetDays = [], presetTime = '';
  if(sched){
    const parts = sched.split(/\s+/);
    if(parts.length){
      const daysPart = parts[0];
      const rest = parts.slice(1).join(' ');
      presetDays = daysPart.includes('/') ? daysPart.split('/') : [daysPart];
      presetTime = rest;
    }
  }
  const dayOptions = ['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo']
    .map(d=>`<option ${presetDays.includes(d)?'selected':''}>${d}</option>`).join('');
  row.innerHTML = `
    <select class="disc-name input" style="width:20%"><option value="">-- Seleccionar --</option>${opts}</select>
    <select multiple class="disc-days input" style="width:30%;min-height:60px" title="Días">${dayOptions}</select>
    <input class="disc-time input" placeholder="Hora (Ej: 6:00 PM)" value="${escapeHtml(presetTime)}" style="width:24%" />
    <input class="disc-amt input" placeholder="Monto" value="${escapeHtml(amt)}" style="width:16%" />
    <button class="btn btn-secondary remove-disc" style="width:10%">Eliminar</button>
  `;
  holder.appendChild(row);
  row.querySelector('.remove-disc').addEventListener('click', ()=>row.remove());
}

/* Init form UI events on alumnas page */
function initAlumnasPage(){
  const addStudentBtn = document.getElementById('add-student-btn');
  if(addStudentBtn){
    addStudentBtn.addEventListener('click', ()=> openAddStudentModal());
    renderStudentsTable();
    // render mini calendar
    initMiniCalendar();
    // disciplines datalist and manager
    updateDisciplineDatalist();
    const editBtn = document.getElementById('edit-disciplines-btn'); if(editBtn) editBtn.addEventListener('click', openManageDisciplines);
    
    // Type tabs filtering
    let currentTypeFilter = '';
    let currentDisciplineFilter = '';
    let currentSearchFilter = '';
    
    document.querySelectorAll('#type-tabs .tab').forEach(tab=>{
      tab.addEventListener('click', ()=>{
        document.querySelectorAll('#type-tabs .tab').forEach(t=> t.classList.remove('active'));
        tab.classList.add('active');
        currentTypeFilter = tab.dataset.type;
        applyFilters();
      });
    });
    
    // Discipline filter dropdown
    const discSelect = document.getElementById('discipline-filter');
    if(discSelect){
      // populate options from disciplines
      const discs = loadDisciplines();
      discs.forEach(d=>{
        const opt = document.createElement('option');
        opt.value = d;
        opt.textContent = d;
        discSelect.appendChild(opt);
      });
      
      discSelect.addEventListener('change', ()=>{
        currentDisciplineFilter = discSelect.value;
        applyFilters();
      });
    }
    
    // Search input
    const searchInput = document.getElementById('search-input');
    if(searchInput){
      searchInput.addEventListener('input', ()=>{
        currentSearchFilter = searchInput.value.toLowerCase().trim();
        applyFilters();
      });
    }
    
    function applyFilters(){
      const tbody = document.querySelector('#alumnas-tbody');
      if(!tbody) return;
      let students = loadStudents().sort(sortStudents);
      
      // filter by type
      if(currentTypeFilter) { students = students.filter(s=> s.type === currentTypeFilter); }
      
      // filter by discipline
      if(currentDisciplineFilter){
        students = students.filter(s=> s.disciplines.some(d=> d.name === currentDisciplineFilter));
      }
      
      // filter by name search
      if(currentSearchFilter){
        students = students.filter(s=> s.name.toLowerCase().includes(currentSearchFilter));
      }
      
      tbody.innerHTML = '';
      students.forEach(s=>{
        const tr = document.createElement('tr');
        let disciplinesText = '', schedText = '', amountText = '';
        
        if(currentDisciplineFilter){
          const disc = s.disciplines.find(d=> d.name === currentDisciplineFilter);
          if(disc){ 
            disciplinesText = disc.name;
            schedText = disc.schedule || ''; 
            amountText = formatAmount(disc.amount||0); 
          }
        } else {
          // Show each discipline with its schedule on the same line
          disciplinesText = s.disciplines.map(d=> `${d.name}${d.schedule ? ': ' + d.schedule : ''}`).join('<br>');
          schedText = '—'; // Not showing schedules separately when showing all disciplines
          amountText = formatAmount(totalAmount(s));
        }
        
        tr.innerHTML = `
          <td>${s.type}</td>
          <td><a href="#" class="student-link" data-id="${s.id}">${escapeHtml(s.name)}</a></td>
          <td>${disciplinesText}</td>
          <td>${schedText}</td>
          <td>${amountText}</td>
          <td><input type="checkbox" data-id="${s.id}" class="paid-checkbox" ${s.paid? 'checked':''}></td>
          <td><button class="btn btn-secondary delete-btn" data-id="${s.id}">🗑️</button></td>
        `;
        tbody.appendChild(tr);
      });

      // attach handlers
      document.querySelectorAll('.student-link').forEach(el=>el.addEventListener('click', e=>{
        e.preventDefault(); openStudentModal(el.dataset.id);
      }));
      document.querySelectorAll('.paid-checkbox').forEach(cb=>cb.addEventListener('change', e=>{
        const id = cb.dataset.id; togglePaid(id, cb.checked);
      }));
      document.querySelectorAll('.delete-btn').forEach(b=>b.addEventListener('click', e=>{
        if(confirm('Eliminar registro?')){ deleteStudent(b.dataset.id); }
      }));
    }
    // Notes area load/save (kept for backward-compat if present)
    const notesTextarea = document.getElementById('notes-textarea');
    const saveNotesBtn = document.getElementById('save-notes-btn');
    if(notesTextarea){
      notesTextarea.value = loadAlumnasNotes();
      if(saveNotesBtn){
        saveNotesBtn.addEventListener('click', ()=>{
          saveAlumnasNotes(notesTextarea.value);
          alert('Notas guardadas');
        });
      }
    }

    // Reminders / notes block (new)
    const remindersTextarea = document.getElementById('reminders-textarea');
    const saveRemBtn = document.getElementById('save-reminders-btn');
    if(remindersTextarea){
      const activeMonth = getAlumnasMonthKey();
      remindersTextarea.value = loadAlumnasNotesForMonth(activeMonth);
      if(saveRemBtn){
        saveRemBtn.addEventListener('click', ()=>{
          saveAlumnasNotesForMonth(getAlumnasMonthKey(), remindersTextarea.value);
          alert('Notas guardadas');
        });
      }
    }

    // Initialize debts UI
    const debtStudentSelect = document.getElementById('debt-student');
    if(debtStudentSelect){
      // populate student options
      const students = loadStudents().sort(sortStudents);
      debtStudentSelect.innerHTML = '<option value="">-- Selecciona alumna --</option>';
      students.forEach(s=>{ const opt = document.createElement('option'); opt.value = s.id; opt.textContent = s.name; debtStudentSelect.appendChild(opt); });
      // paid checkbox and paydate are always visible
      const paidCheckbox = document.getElementById('debt-paid');
      const payDateInput = document.getElementById('debt-paydate');
      if(payDateInput) payDateInput.style.display = 'inline-block';
      
      // add debt button
      const addDebtBtn = document.getElementById('add-debt-btn');
      if(addDebtBtn){ addDebtBtn.addEventListener('click', addOrSaveDebtFromForm); }
      setAlumnasMonthKey(getAlumnasMonthKey());
      renderDebtsTable();
      renderMonthlyPaymentsList();
        // ensure student options are refreshed
        try{ if(typeof refreshDebtStudentOptions === 'function') refreshDebtStudentOptions(); }catch(e){}
      // initialize floating scroll buttons for debts table
      initDebtFloatingScroll();
    }

    // debts block toggle button
    const debtsBlock = document.getElementById('debts-block');
    const toggleDebtsBtn = document.getElementById('toggle-debts-btn');
    const DEBTS_STATE_KEY = 'rds_debts_expanded_v1';
    if(toggleDebtsBtn && debtsBlock){
      // load saved state
      try{ const saved = localStorage.getItem(DEBTS_STATE_KEY); if(saved === '1'){ debtsBlock.classList.add('expanded'); toggleDebtsBtn.classList.add('expanded'); } }catch(e){}
      toggleDebtsBtn.addEventListener('click', ()=>{
        const isExpanded = debtsBlock.classList.toggle('expanded');
        toggleDebtsBtn.classList.toggle('expanded');
        try{ localStorage.setItem(DEBTS_STATE_KEY, isExpanded? '1':'0'); }catch(e){}
        // set aria-expanded for accessibility
        try{ toggleDebtsBtn.setAttribute('aria-expanded', isExpanded ? 'true' : 'false'); }catch(e){}
        if(isExpanded){
          // wait a bit for expansion animation then bring block into view
          setTimeout(()=>{
            try{ debtsBlock.scrollIntoView({behavior:'smooth', block:'center'}); }catch(e){}
          }, 220);
        }
      });
    }
    
    // Adaptive table wrapper height: compute available viewport space and set maxHeight
    function adjustTableWrapHeight(){
      const wraps = document.querySelectorAll('.table-wrap');
      wraps.forEach(wrap=>{
        try{
          const rect = wrap.getBoundingClientRect();
          // leave 120px at bottom for controls/footer; compute available height
          const available = Math.max(180, window.innerHeight - rect.top - 120);
          wrap.style.maxHeight = available + 'px';
        }catch(e){}
      });
    }
    // run on init and on resize
    adjustTableWrapHeight();
    window.addEventListener('resize', adjustTableWrapHeight);
  }
}

/* ---------------- Mini-calendar ---------------- */
const CAL_KEY = 'rds_calendar_v1';

// Normalize note entry to structured object {text, color, type}
function normalizeNoteEntry(val){
  if(!val) return {text:'', color:'#ED468F', type:'', time:''};
  if(typeof val === 'object' && val.text !== undefined){
    return {
      text: String(val.text || ''),
      color: val.color || '#ED468F',
      type: val.type || '',
      time: val.time || ''
    };
  }
  // legacy string
  return {text: String(val), color:'#ED468F', type:'', time:''};
}

// Normalize any value into an array of notes
function normalizeNotesArray(val){
  if(!val) return [];
  if(Array.isArray(val)){
    return val.map(normalizeNoteEntry).filter(n=> n.text && n.text.trim());
  }
  const single = normalizeNoteEntry(val);
  return single.text ? [single] : [];
}

function buildNotesPreview(notes){
  const arr = normalizeNotesArray(notes);
  if(!arr.length) return {text:'', color:'#ED468F', count:0};
  const color = arr[0].color || '#ED468F';
  const text = arr.map(n=> {
    const timePrefix = n.time ? `[${n.time}] ` : '';
    return timePrefix + n.text;
  }).filter(Boolean).join(' | ');
  return {text, color, count: arr.length};
}

function colorForType(type){
  const map = {
    'Pago':'#5FE9E7',
    'Inscripción':'#ED468F',
    'Ensayo':'#7C6BFF',
    'Evento':'#FFA94D',
    'Renta':'#00BFA6'
  };
  return map[type] || '#ED468F';
}

function loadCalendar(){
  try{ const raw = localStorage.getItem(CAL_KEY); return raw? JSON.parse(raw): {}; }catch(e){return {} }
}

function saveCalendar(obj){ localStorage.setItem(CAL_KEY, JSON.stringify(obj)); try{ syncMonthlyCalendarFromAllSourcesIfNeeded(); }catch(e){} }

function initMiniCalendar(){
  const calWrap = document.getElementById('mini-calendar');
  if(!calWrap) return;
  const displayLabel = document.getElementById('cal-display-month');
  const deleteBtn = document.getElementById('cal-delete');
  const prevBtn = document.getElementById('cal-prev');
  const nextBtn = document.getElementById('cal-next');

  // current shown month (Date at first day)
  let currentDate = new Date(); currentDate.setDate(1);

  function monthKeyFromDate(d){
    const y = d.getFullYear(); const m = String(d.getMonth()+1).padStart(2,'0'); return `${y}-${m}`;
  }

  function updateDisplayLabel(){
    displayLabel.textContent = currentDate.toLocaleString('es-ES',{month:'long', year:'numeric'});
  }
  updateDisplayLabel();

  function render(){
    calWrap.innerHTML = '';
    const days = new Date(currentDate.getFullYear(), currentDate.getMonth()+1, 0).getDate();
    const start = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1).getDay();
    const dayNames = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
    dayNames.forEach(name=>{
      const h = document.createElement('div');
      h.className = 'weekday';
      h.textContent = name;
      calWrap.appendChild(h);
    });
    const leading = start;
    for(let i=0;i<leading;i++){ const cell = document.createElement('div'); cell.className='calendar-cell empty'; calWrap.appendChild(cell); }
    for(let d=1; d<=days; d++){
      const cell = document.createElement('div'); cell.className='calendar-cell';
      cell.dataset.day = d;
      const num = document.createElement('div'); num.className='day-num'; num.textContent = d;
      const noteP = document.createElement('div'); noteP.className='note-preview';
      const monthKey = monthKeyFromDate(currentDate);
      const stored = loadCalendar();
      const noteRaw = (stored[monthKey] && stored[monthKey].days && stored[monthKey].days[d]) || '';
      const preview = buildNotesPreview(noteRaw);
      if(preview.text) {
        cell.classList.add('has-note');
        noteP.textContent = preview.text.length>80? preview.text.slice(0,80)+'…':preview.text;
        const bg = preview.color || '#ED468F';
        cell.style.background = `linear-gradient(135deg, ${bg}1f, #fff)`;
        cell.style.border = `1px solid ${bg}55`;
        if(preview.count>1){
          const badge = document.createElement('span');
          badge.className = 'note-count-badge';
          badge.textContent = `+${preview.count-1}`;
          cell.appendChild(badge);
        }
      }
      cell.appendChild(num); cell.appendChild(noteP);
      cell.addEventListener('click', ()=> openCalNoteEditor(monthKey,d, noteRaw, render));
      calWrap.appendChild(cell);
    }
  }

  if(deleteBtn){
    deleteBtn.addEventListener('click', ()=>{
      if(!confirm('¿Eliminar todas las notas de este mes?')) return;
      const key = monthKeyFromDate(currentDate);
      const store = loadCalendar();
      if(store[key]){
        store[key].days = {}; // clear all days
        saveCalendar(store);
        render();
        alert('Notas del mes eliminadas');
      }
    });
  }

  // Copy/Paste buttons for mini calendar
  const copyBtn = document.getElementById('cal-copy');
  if(copyBtn){
    copyBtn.addEventListener('click', ()=>{
      const key = monthKeyFromDate(currentDate);
      const store = loadCalendar();
      if(!store[key] || !store[key].days || Object.keys(store[key].days).length === 0){
        alert('No hay notas para copiar');
        return;
      }
      try{
        localStorage.setItem('rds_calendar_clipboard', JSON.stringify(store[key].days));
        alert('📋 Calendario copiado');
      }catch(e){
        alert('Error al copiar');
      }
    });
  }

  const pasteBtn = document.getElementById('cal-paste');
  if(pasteBtn){
    pasteBtn.addEventListener('click', ()=>{
      try{
        const clip = localStorage.getItem('rds_calendar_clipboard');
        if(!clip){
          alert('No hay datos en portapapeles');
          return;
        }
        const data = JSON.parse(clip);
        const key = monthKeyFromDate(currentDate);
        const store = loadCalendar();
        store[key] = store[key] || {meta:{},days:{}};
        Object.keys(data).forEach(day=>{
          store[key].days[day] = data[day];
        });
        saveCalendar(store);
        render();
        alert('📥 Datos pegados');
      }catch(e){
        alert('Error al pegar');
      }
    });
  }

  const saveBtn = document.getElementById('cal-save');
  if(saveBtn){
    saveBtn.addEventListener('click', ()=>{
      const store = loadCalendar();
      saveCalendar(store);
      alert('💾 Guardado');
    });
  }

  prevBtn.addEventListener('click', ()=>{
    const remindersTextarea = document.getElementById('reminders-textarea');
    if(remindersTextarea){
      saveAlumnasNotesForMonth(getAlumnasMonthKey(), remindersTextarea.value);
    }
    currentDate.setMonth(currentDate.getMonth()-1);
    updateDisplayLabel();
    setAlumnasMonthKey(monthKeyFromDate(currentDate));
    render();
  });

  nextBtn.addEventListener('click', ()=>{
    const remindersTextarea = document.getElementById('reminders-textarea');
    if(remindersTextarea){
      saveAlumnasNotesForMonth(getAlumnasMonthKey(), remindersTextarea.value);
    }
    currentDate.setMonth(currentDate.getMonth()+1);
    updateDisplayLabel();
    setAlumnasMonthKey(monthKeyFromDate(currentDate));
    render();
  });

  setAlumnasMonthKey(monthKeyFromDate(currentDate));
  render();
}

// Clipboard functions for weekly schedules
function copyWeeklyToClipboard(){
  const items = (typeof loadWeeklySchedules === 'function') ? loadWeeklySchedules() : [];
  try{
    localStorage.setItem(WEEKLY_CLIP_KEY, JSON.stringify({when: Date.now(), items}));
    alert('Horario semanal copiado');
  }catch(e){
    alert('Error al copiar horario');
  }
}

function pasteWeeklyFromClipboard(){
  try{
    const raw = localStorage.getItem(WEEKLY_CLIP_KEY);
    if(!raw){ alert('No hay horario copiado'); return; }
    const clip = JSON.parse(raw);
    const items = Array.isArray(clip.items)? clip.items : [];
    if(items.length === 0){ alert('Clipboard vacío'); return; }
    const current = (typeof loadWeeklySchedules === 'function') ? loadWeeklySchedules() : [];
    const merged = [...current];
    items.forEach(it=>{
      const id = `manual-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      merged.push({
        id,
        day: it.day,
        hour: it.hour,
        activity: it.activity,
        type: it.type,
        contact: it.contact,
        typeClass: it.typeClass || 'type-manual',
        auto: false
      });
    });
    if(typeof saveWeeklySchedules === 'function') saveWeeklySchedules(merged);
    if(typeof renderWeeklySchedule === 'function') renderWeeklySchedule();
    alert('Horario semanal pegado');
  }catch(e){
    alert('Error al pegar horario');
  }
}

function openCalNoteEditor(monthKey, day, currentNote, onClose){
  const notes = normalizeNotesArray(currentNote);
  const existing = document.querySelector('.modal-backdrop'); if(existing) existing.remove();
  const backdrop = document.createElement('div'); backdrop.className='modal-backdrop';
  const modal = document.createElement('div'); modal.className='modal';
  modal.innerHTML = `
    <h3>Editar notas - Día ${day}</h3>
    <div id="cal-note-list" style="display:flex;flex-direction:column;gap:8px;margin-bottom:12px"></div>
    <button id="cal-note-add" class="btn btn-secondary" style="margin-bottom:8px">+ Agregar nota</button>
    
    <div style="border-top:1px solid #eee;padding-top:12px;margin-top:12px">
      <label style="font-weight:700;color:var(--pink);display:block;margin-bottom:8px">🔄 Duplicar notas seleccionadas a otros días:</label>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <input type="text" id="cal-duplicate-days" class="input" placeholder="Ej: 10,15,20" style="flex:1;min-width:150px" />
        <button id="cal-btn-duplicate" class="btn btn-secondary" style="font-size:12px">Duplicar</button>
      </div>
      <div style="font-size:11px;color:var(--muted);margin-top:4px">Ingresa los números de días separados por comas</div>
    </div>
    
    <div style="text-align:right;margin-top:10px;display:flex;gap:8px;justify-content:flex-end">
      <button id="cal-note-save" class="btn">Guardar</button>
      <button id="cal-note-del" class="btn btn-secondary">Eliminar</button>
      <button id="cal-note-close" class="btn btn-secondary">Cerrar</button>
    </div>
  `;
  backdrop.appendChild(modal); document.body.appendChild(backdrop);

  const list = document.getElementById('cal-note-list');

  function addRow(note){
    const n = normalizeNoteEntry(note || {text:'', color:'#ED468F', type:'', time:''});
    const row = document.createElement('div');
    row.className = 'note-row';
    row.innerHTML = `
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <label style="display:flex;align-items:center;gap:4px">
          <input type="checkbox" class="note-select" checked />
          <span style="font-size:12px;color:var(--muted)">Duplicar</span>
        </label>
        <label style="font-weight:700;color:var(--pink)">Tipo
          <select class="note-type input" style="margin-top:4px">
            <option value="">General</option>
            <option value="Pago" ${n.type==='Pago'?'selected':''}>Pago</option>
            <option value="Inscripción" ${n.type==='Inscripción'?'selected':''}>Inscripción</option>
            <option value="Ensayo" ${n.type==='Ensayo'?'selected':''}>Ensayo</option>
            <option value="Evento" ${n.type==='Evento'?'selected':''}>Evento</option>
            <option value="Renta" ${n.type==='Renta'?'selected':''}>Renta</option>
          </select>
        </label>
        <label style="font-weight:700;color:var(--pink)">Color
          <input type="color" class="note-color input" value="${n.color||'#ED468F'}" style="margin-top:4px;width:70px;height:38px;padding:0;border:none" />
        </label>
        <label style="font-weight:700;color:var(--pink)">Hora
          <input type="time" class="note-time input" value="${n.time||''}" style="margin-top:4px;width:100px" />
        </label>
        <button class="btn btn-secondary note-remove" type="button" style="margin-left:auto">🗑️</button>
      </div>
      <textarea class="note-text" style="width:100%;min-height:90px;padding:10px;border-radius:8px;border:1px solid #eee;margin-top:6px">${escapeHtml(n.text||'')}</textarea>
    `;
    row.querySelector('.note-remove').addEventListener('click', ()=> row.remove());
    list.appendChild(row);
  }

  if(notes.length){ notes.forEach(n=> addRow(n)); }
  else { addRow({text:'', color:'#ED468F', type:'', time:''}); }

  document.getElementById('cal-note-add').addEventListener('click', ()=> addRow({text:'', color:'#ED468F', type:'', time:''}));

  document.getElementById('cal-note-close').addEventListener('click', ()=>backdrop.remove());
  document.getElementById('cal-note-del').addEventListener('click', ()=>{
    const store = loadCalendar(); store[monthKey] = store[monthKey] || {meta:{},days:{}}; delete store[monthKey].days[day]; saveCalendar(store); backdrop.remove(); onClose && onClose();
  });
  document.getElementById('cal-btn-duplicate').addEventListener('click', () => {
    const daysInput = document.getElementById('cal-duplicate-days').value.trim();
    if(!daysInput){
      alert('Por favor ingresa los días a duplicar');
      return;
    }
    const targetDays = daysInput.split(',').map(d=> parseInt(d.trim())).filter(d=> !isNaN(d) && d > 0);
    if(targetDays.length === 0){
      alert('No se encontraron días válidos');
      return;
    }
    
    const rows = Array.from(list.querySelectorAll('.note-row'));
    const selectedNotes = rows.map(r=>{
      const isSelected = r.querySelector('.note-select')?.checked;
      if(!isSelected) return null;
      const text = (r.querySelector('.note-text')?.value || '').trim();
      if(!text) return null;
      const type = r.querySelector('.note-type')?.value || '';
      const color = (r.querySelector('.note-color')?.value) || colorForType(type) || '#ED468F';
      const time = r.querySelector('.note-time')?.value || '';
      return {text, color, type, time};
    }).filter(Boolean);
    
    if(selectedNotes.length === 0){
      alert('No hay notas seleccionadas para duplicar');
      return;
    }
    
    const store = loadCalendar();
    store[monthKey] = store[monthKey] || {meta:{},days:{}};
    
    targetDays.forEach(targetDay => {
      if(!store[monthKey].days[targetDay]){
        store[monthKey].days[targetDay] = [];
      }
      const existingNotes = normalizeNotesArray(store[monthKey].days[targetDay]);
      selectedNotes.forEach(note => {
        if(!existingNotes.find(e=> e.text === note.text && e.type === note.type)){
          existingNotes.push({...note});
        }
      });
      store[monthKey].days[targetDay] = existingNotes;
    });
    
    saveCalendar(store);
    onClose && onClose();
    alert(`✅ ${selectedNotes.length} nota(s) duplicadas a ${targetDays.length} día(s): ${targetDays.join(', ')}`);
  });

  document.getElementById('cal-note-save').addEventListener('click', ()=>{
    const rows = Array.from(list.querySelectorAll('.note-row'));
    const newNotes = rows.map(r=>{
      const text = (r.querySelector('.note-text')?.value || '').trim();
      if(!text) return null;
      const type = r.querySelector('.note-type')?.value || '';
      const color = (r.querySelector('.note-color')?.value) || colorForType(type) || '#ED468F';
      const time = r.querySelector('.note-time')?.value || '';
      return {text, color, type, time};
    }).filter(Boolean);
    const store = loadCalendar(); store[monthKey] = store[monthKey] || {meta:{},days:{}}; 
    if(newNotes.length){
      store[monthKey].days[day] = newNotes;
    } else {
      delete store[monthKey].days[day];
    }
    saveCalendar(store); backdrop.remove(); onClose && onClose();
  });
}

function addCalendarEvent(dateString, text){
  // dateString expected YYYY-MM-DD
  if(!dateString) return;
  const m = dateString.match(/(\d{4})-(\d{2})-(\d{2})/);
  if(!m) return;
  const yyyy = m[1], mm = m[2], dd = String(parseInt(m[3],10));
  const key = `${yyyy}-${mm}`;
  const store = loadCalendar();
  store[key] = store[key] || {meta:{name:'',days:0,start:0}, days:{}};
  const prev = store[key].days[dd];
  const arr = normalizeNotesArray(prev);
  arr.push({text, color:'#ED468F', type:''});
  store[key].days[dd] = arr;
  saveCalendar(store);
  // if current mini calendar is showing the same month, re-render
  const mini = document.getElementById('mini-calendar'); if(mini){ initMiniCalendar(); }
}


// run on pages that include alumnas form
// and initialize attendance page when present
const ATT_KEY = 'rds_attendance_v1';

function loadAttendance(){ try{ const raw = localStorage.getItem(ATT_KEY); return raw? JSON.parse(raw): {}; }catch(e){ return {}; } }
function saveAttendance(obj){ try{ localStorage.setItem(ATT_KEY, JSON.stringify(obj)); }catch(e){}
}

function renderDisciplineTabs(container){
  const tabs = [
    'Todos los alumnos','Ballet Kids','Gimnasia Kids','Baile Moderno','Kpop I','Kpop II','Jazz','Gimnasia','Ballet','Heels'
  ];
  container.innerHTML = '';
  tabs.forEach((t,idx)=>{
    const d = document.createElement('button'); d.className = 'tab'; d.textContent = t; d.dataset.disc = t; if(idx===0) d.classList.add('active');
    container.appendChild(d);
  });
}

function getSelectedDiscipline(){
  const container = document.getElementById('discipline-tabs');
  if(!container) return 'Todos los alumnos';
  const active = container.querySelector('.tab.active');
  return active ? active.dataset.disc : 'Todos los alumnos';
}

function updateAttendanceRecord(dateStr, discipline, studentId, present, note){
  if(!dateStr) return;
  const store = loadAttendance();
  store[dateStr] = store[dateStr] || {};
  store[dateStr][discipline] = store[dateStr][discipline] || {};
  store[dateStr][discipline][studentId] = { present: !!present, note: note || '' };
  saveAttendance(store);
}

function renderAttendanceTable(){
  const tbody = document.getElementById('attendance-tbody'); if(!tbody) return;
  const dateInput = document.getElementById('attendance-date'); const dateStr = dateInput ? dateInput.value : '';
  const discipline = getSelectedDiscipline();
  const q = (document.getElementById('attendance-search')?.value || '').toLowerCase().trim();
  const students = loadStudents().sort(sortStudents);
  const store = loadAttendance();
  tbody.innerHTML = '';
  students.forEach(s=>{
    // decide whether to include this student for the currently selected discipline
    if(discipline !== 'Todos los alumnos'){
      if(!s.disciplines.some(d=> d.name === discipline)) return; // skip students not in this discipline
    }
    if(q && !s.name.toLowerCase().includes(q)) return;
    const tr = document.createElement('tr');
    const rec = (store[dateStr] && store[dateStr][discipline] && store[dateStr][discipline][s.id]) || null;
    const checked = rec && rec.present ? 'checked' : '';
    const noteVal = rec && rec.note ? rec.note : '';
    tr.innerHTML = `
      <td><a href="#" class="student-link" data-id="${s.id}">${escapeHtml(s.name)}</a></td>
      <td>${escapeHtml(s.disciplines.map(d=>d.name).join(', '))}</td>
      <td style="width:130px;text-align:center"><label style="display:flex;align-items:center;gap:8px;justify-content:center"><input type=checkbox class="att-checkbox" data-id="${s.id}" ${checked}> Presente</label></td>
      <td><input class="input att-note" data-id="${s.id}" placeholder="Nota (opcional)" value="${escapeHtml(noteVal)}" /></td>
    `;
    tbody.appendChild(tr);
  });
  // attach handlers
  document.querySelectorAll('.att-checkbox').forEach(cb=> cb.addEventListener('change', e=>{
    const id = cb.dataset.id; const is = cb.checked;
    const note = (document.querySelector(`.att-note[data-id="${id}"]`)?.value) || '';
    const dateVal = document.getElementById('attendance-date').value;
    updateAttendanceRecord(dateVal, getSelectedDiscipline(), id, is, note);
  }));
  document.querySelectorAll('.att-note').forEach(inp=> inp.addEventListener('blur', e=>{
    const id = inp.dataset.id; const note = inp.value;
    const dateVal = document.getElementById('attendance-date').value;
    const cb = document.querySelector(`.att-checkbox[data-id="${id}"]`);
    const present = cb ? cb.checked : false;
    updateAttendanceRecord(dateVal, getSelectedDiscipline(), id, present, note);
  }));
  // student links open modal if implemented
  document.querySelectorAll('.student-link').forEach(el=> el.addEventListener('click', e=>{ e.preventDefault(); openStudentModal(el.dataset.id); }));
}

function refreshAttendanceStudentList(){
  // re-render table if attendance page present
  try{ renderAttendanceTable(); }catch(e){}
}

function initAsistenciaPage(){
  const tabsWrap = document.getElementById('discipline-tabs');
  if(!tabsWrap) return;
  renderDisciplineTabs(tabsWrap);
  // back button behavior for attendance page
  const backBtn = document.getElementById('asistencia-back'); if(backBtn){ backBtn.addEventListener('click', ()=>{ try{ history.back(); }catch(e){ location.href = '../index.html'; } }); }
  
  // month and date inputs
  const dateInput = document.getElementById('attendance-date');
  const dayLabel = document.getElementById('attendance-day-label');
  const prevDayBtn = document.getElementById('attendance-prev-day');
  const nextDayBtn = document.getElementById('attendance-next-day');
  let currentDateStr = '';
  const formatDayLabel = (dateStr) => {
    if(!dateStr) return '';
    const parts = dateStr.split('-').map(Number);
    if(parts.length !== 3) return dateStr;
    const [y, m, d] = parts;
    const months = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    const weekdays = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
    if(!y || !m || !d) return dateStr;
    const dt = new Date(y, m-1, d);
    const weekday = weekdays[dt.getDay()] || '';
    return `${weekday} ${String(d).padStart(2,'0')} ${months[m-1]} ${y}`;
  };

  const setDayLabelFromInput = () => {
    if(dayLabel) dayLabel.textContent = formatDayLabel(dateInput?.value || '');
  };
  
  // initialize month/date to today
  const d = new Date();
  if(dateInput && !dateInput.value){
    dateInput.value = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  currentDateStr = dateInput ? dateInput.value : '';
  setDayLabelFromInput();

  const changeDay = (delta) => {
    if(!dateInput || !dateInput.value) return;
    const parts = dateInput.value.split('-').map(Number);
    if(parts.length !== 3) return;
    const dt = new Date(parts[0], parts[1]-1, parts[2]);
    dt.setDate(dt.getDate() + delta);
    const newDate = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
    dateInput.value = newDate;
    currentDateStr = newDate;
    if(dayLabel) dayLabel.textContent = formatDayLabel(currentDateStr);
    if(dateInput) dateInput.value = newDate;
    setDayLabelFromInput();
    renderAttendanceTable();
  };
  if(prevDayBtn) prevDayBtn.addEventListener('click', ()=> changeDay(-1));
  if(nextDayBtn) nextDayBtn.addEventListener('click', ()=> changeDay(1));
  
  // bind tab clicks with highlight
  tabsWrap.querySelectorAll('.tab').forEach(t=> t.addEventListener('click', ()=>{
    tabsWrap.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
    t.classList.add('active');
    renderAttendanceTable();
  }));
  
  // date change
  if(dateInput) dateInput.addEventListener('change', ()=> {
    if(dateInput.value){
      currentDateStr = dateInput.value;
      setDayLabelFromInput();
    }
    renderAttendanceTable();
  });
  
  // search
  const searchEl = document.getElementById('attendance-search');
  if(searchEl) searchEl.addEventListener('input', ()=> renderAttendanceTable());
  
  // save button (already saving on changes, but keep for explicit save)
  const saveBtn = document.getElementById('attendance-save');
  if(saveBtn) saveBtn.addEventListener('click', ()=> { alert('Asistencias guardadas'); });
  
  // history button — show month view
  const histBtn = document.getElementById('attendance-history');
  if(histBtn) histBtn.addEventListener('click', ()=>{
    const store = loadAttendance();
    const discipline = getSelectedDiscipline();
    const monthStr = dateInput && dateInput.value ? dateInput.value.substring(0,7) : new Date().toISOString().substring(0,7);
    
    // filter records by month
    const monthRecords = {};
    Object.keys(store).forEach(dateKey=>{
      if(dateKey.startsWith(monthStr)){
        monthRecords[dateKey] = store[dateKey];
      }
    });
    
    // create modal
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.style.display = 'block';
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.maxWidth = '600px';
    modal.style.margin = 'auto';
    modal.style.position = 'relative';
    modal.style.top = '50%';
    modal.style.transform = 'translateY(-50%)';
    
    let out = '<h3>Historial — '+escapeHtml(discipline)+' — '+escapeHtml(monthStr)+'</h3><div style="max-height:400px;overflow:auto">';
    const sortedDates = Object.keys(monthRecords).sort().reverse();
    if(sortedDates.length === 0){
      out += '<div style="color:var(--muted);padding:20px;text-align:center">No hay registros para este mes</div>';
    } else {
      sortedDates.forEach(dateKey=>{
        const dayRec = monthRecords[dateKey] && monthRecords[dateKey][discipline];
        if(!dayRec) return;
        out += `<div style="padding:10px;border-bottom:1px solid rgba(0,0,0,0.04)"><div style="font-weight:700;color:var(--pink)">${dateKey}</div>`;
        Object.keys(dayRec).forEach(sid=>{
          const r = dayRec[sid];
          const student = loadStudents().find(x=>x.id===sid);
          out += `<div style="font-size:13px;margin-top:4px">${escapeHtml(student?.name||'(desconocido)')} — ${r.present? '✅ Presente':'❌ Ausente'} ${r.note? ' — '+escapeHtml(r.note):''}</div>`;
        });
        out += '</div>';
      });
    }
    out += '</div><div style="text-align:right;margin-top:10px"><button id="hist-close" class="btn btn-secondary">Cerrar</button></div>';
    
    modal.innerHTML = out;
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
    
    document.getElementById('hist-close').addEventListener('click', ()=>{ backdrop.remove(); });
  });
  
  // initial render
  renderAttendanceTable();
}


// listen to storage changes for students/disciplines so attendance updates in real time
window.addEventListener('storage', (e)=>{
  try{
    if(!e) return;
    if(e.key === STORAGE_KEY || e.key === DISC_KEY || e.key === DELETED_DISC_KEY){
      refreshAttendanceStudentList();
      try{ if(typeof refreshDebtStudentOptions === 'function') refreshDebtStudentOptions(); }catch(e){}
      try{ renderDebtsTable(); }catch(e){}
    }
    if(e.key === ATT_KEY){
      // if attendance updated elsewhere, re-render
      renderAttendanceTable();
    }
  }catch(err){}
});

/* -------- Rental Management Page (Página 3) -------- */

function sortScheduleEntries(entries){
  const dayOrder = {'Lunes':0,'Martes':1,'Miércoles':2,'Jueves':3,'Viernes':4,'Sábado':5,'Domingo':6};
  return [...entries].sort((a,b)=>{
    // normalize day strings (trim spaces and match case-insensitive)
    const dayA = (a.day || '').trim();
    const dayB = (b.day || '').trim();
    const dayIndexA = dayOrder[dayA] !== undefined ? dayOrder[dayA] : 99;
    const dayIndexB = dayOrder[dayB] !== undefined ? dayOrder[dayB] : 99;
    const dayDiff = dayIndexA - dayIndexB;
    if(dayDiff !== 0) return dayDiff;
    
    // within same day, sort by actual time
    const timeA = (a.time || '').trim();
    const timeB = (b.time || '').trim();
    
    // parse time assuming 12-hour format, prioritize PM detection
    const parseTime = (t) => {
      if(!t) return 9999;
      const match = t.match(/(\d{1,2}):(\d{2})/);
      if(!match) return 9999;
      let hours = parseInt(match[1], 10);
      const minutes = parseInt(match[2], 10);
      const lower = t.toLowerCase();
      
      // if explicitly PM and not 12, add 12
      if(lower.includes('pm')){
        if(hours !== 12) hours += 12;
      } 
      // if explicitly AM and is 12, make it 0
      else if(lower.includes('am')){
        if(hours === 12) hours = 0;
      }
      // no AM/PM: assume hours 1-11 are AM, 12 is noon
      else {
        // default: keep as entered
      }
      
      return hours * 60 + minutes;
    };
    
    const timeValueA = parseTime(timeA);
    const timeValueB = parseTime(timeB);
    return timeValueA - timeValueB;
  });
}

function renderRentalSchedule(monthYearStr, weekNumber){
  const container = document.getElementById('schedule-list');
  if(!container) return;
  const schedules = loadRentalSchedules();
  const weekSchedules = (schedules[monthYearStr] && schedules[monthYearStr][weekNumber]) || [];
  if(weekSchedules.length === 0) return;
  
  const sorted = sortScheduleEntries(weekSchedules);
  const card = document.createElement('div');
  card.className = 'schedule-card';
  card.style.padding = '12px';
  card.style.border = '1px solid rgba(0,0,0,0.04)';
  card.style.borderRadius = '10px';
  card.style.background = 'linear-gradient(135deg, rgba(237,70,143,0.02), rgba(95,233,231,0.02))';
  card.innerHTML = `<h4 style="color:var(--pink);margin-top:0">Horario - Semana ${weekNumber}</h4>`;
  
  const table = document.createElement('table');
  table.className = 'table';
  table.style.marginTop = '8px';
  table.innerHTML = `<thead><tr><th>Día</th><th>Horario</th><th>Grupos/Personas</th><th>Monto</th><th>Asistencia</th><th style="width:80px">Acciones</th></tr></thead>`;
  
  const tbody = document.createElement('tbody');
  sorted.forEach(entry=>{
    const tr = document.createElement('tr');
    const attIcon = entry.attendance === 'present' ? '✅' : entry.attendance === 'absent' ? '❌' : '⏰';
    tr.innerHTML = `
      <td>${escapeHtml(entry.day)}</td>
      <td>${escapeHtml(entry.time)}</td>
      <td>${escapeHtml(entry.groups)}</td>
      <td>$${escapeHtml(entry.amount)}</td>
      <td style="text-align:center">${attIcon}</td>
      <td style="white-space:nowrap">
        <button class="btn btn-secondary edit-schedule" data-id="${entry.id}" style="padding:4px 6px;font-size:12px">Editar</button>
        <button class="btn delete-schedule" data-id="${entry.id}" style="padding:4px 6px;font-size:12px">Eliminar</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  card.appendChild(table);
  container.appendChild(card);
  
  // attach handlers
  card.querySelectorAll('.edit-schedule').forEach(btn=> btn.addEventListener('click', e=>{
    const entryId = btn.dataset.id;
    const entry = weekSchedules.find(x => x.id === entryId);
    if(!entry) return;
    openScheduleEditModal(monthYearStr, weekNumber, entry);
  }));
  card.querySelectorAll('.delete-schedule').forEach(btn=> btn.addEventListener('click', e=>{
    const entryId = btn.dataset.id;
    if(confirm('Eliminar este horario?')){
      deleteRentalScheduleEntry(monthYearStr, weekNumber, entryId);
      renderAllSchedules(monthYearStr);
    }
  }));
}

function renderAllSchedules(monthYearStr){
  const container = document.getElementById('schedule-list');
  if(!container) return;
  container.innerHTML = '';
  const schedules = loadRentalSchedules();
  const monthSchedules = schedules[monthYearStr] || {};
  const weeks = Object.keys(monthSchedules).sort((a,b)=>Number(a)-Number(b));
  if(weeks.length === 0){
    container.innerHTML = '<div style="color:var(--muted);padding:20px;text-align:center">No hay horarios para este mes</div>';
  } else {
    weeks.forEach(week => renderRentalSchedule(monthYearStr, Number(week)));
  }
}

function renderRentalPeople(monthYear){
  const tbody = document.getElementById('rental-people-tbody');
  if(!tbody) return;
  const searchInput = document.getElementById('rental-people-search');
  const searchQuery = searchInput ? searchInput.value.toLowerCase().trim() : '';
  let people = loadRentalPeople().filter(p => p.monthYear === monthYear);
  // filter by search
  if(searchQuery){
    people = people.filter(p => p.name.toLowerCase().includes(searchQuery));
  }
  // sort alphabetically by name
  people.sort((a,b) => a.name.localeCompare(b.name, 'es', {sensitivity:'base'}));
  tbody.innerHTML = '';
  people.forEach(person=>{
    const tr = document.createElement('tr');
    
    // Sort schedules by day and time (mañana, tarde, noche)
    const dayOrder = {'Lunes':1,'Martes':2,'Miércoles':3,'Jueves':4,'Viernes':5,'Sábado':6,'Domingo':7};
    const sortedSchedules = (person.schedules || []).sort((a,b)=>{
      const dayA = dayOrder[a.day] || 999;
      const dayB = dayOrder[b.day] || 999;
      if(dayA !== dayB) return dayA - dayB;
      // Within same day, sort by time (mañana < tarde < noche)
      const timeA = parseTimeToMinutes(a.time || '');
      const timeB = parseTimeToMinutes(b.time || '');
      return timeA - timeB;
    });
    
    // Group schedules by day
    const schedulesByDay = {};
    sortedSchedules.forEach(s=>{
      if(!schedulesByDay[s.day]) schedulesByDay[s.day] = [];
      schedulesByDay[s.day].push(s.time);
    });
    
    // Format: "Lunes: 9:00 AM, 11:00 AM | Martes: 3:00 PM"
    const scheduleStr = Object.keys(schedulesByDay)
      .sort((a,b)=> (dayOrder[a]||999) - (dayOrder[b]||999))
      .map(day => `<strong>${day}:</strong> ${schedulesByDay[day].join(', ')}`)
      .join(' | ') || '—';
    
    tr.innerHTML = `
      <td><a href="#" class="rental-person-link" data-id="${person.id}">${escapeHtml(person.name)}</a></td>
      <td>${escapeHtml(person.group||'')}</td>
      <td>${escapeHtml(person.phone||'')}</td>
      <td>${scheduleStr}</td>
      <td>$${escapeHtml(person.amount||0)}</td>
      <td style="white-space:nowrap">
        <button class="btn btn-secondary edit-person" data-id="${person.id}" style="padding:4px 6px;font-size:12px">Editar</button>
        <button class="btn delete-person" data-id="${person.id}" style="padding:4px 6px;font-size:12px">Eliminar</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
  
  // attach handlers
  document.querySelectorAll('.rental-person-link').forEach(link=> link.addEventListener('click', e=>{
    e.preventDefault();
    const personId = link.dataset.id;
    const person = loadRentalPeople().find(x => x.id === personId);
    if(person) openPersonEditModal(person, monthYear);
  }));
  document.querySelectorAll('.edit-person').forEach(btn=> btn.addEventListener('click', e=>{
    const personId = btn.dataset.id;
    const person = loadRentalPeople().find(x => x.id === personId);
    if(person) openPersonEditModal(person, monthYear);
  }));
  document.querySelectorAll('.delete-person').forEach(btn=> btn.addEventListener('click', e=>{
    if(confirm('Eliminar a esta persona?')){
      deleteRentalPerson(btn.dataset.id);
      renderRentalPeople(monthYear);
    }
  }));
}

// Helper function to parse time strings to minutes for sorting
function parseTimeToMinutes(timeStr){
  if(!timeStr) return 0;
  const lower = timeStr.toLowerCase().trim();
  // Extract hour and check for AM/PM
  const match = lower.match(/(\d+):?(\d*)\s*(am|pm|a\.m\.|p\.m\.)?/);
  if(!match) return 0;
  let hour = parseInt(match[1]) || 0;
  const min = parseInt(match[2]) || 0;
  const period = match[3] || '';
  
  // Convert to 24-hour format
  if(period.includes('pm') || period.includes('p.m.')){
    if(hour !== 12) hour += 12;
  } else if(period.includes('am') || period.includes('a.m.')){
    if(hour === 12) hour = 0;
  } else {
    // No AM/PM specified, guess based on hour
    // 6-11 could be morning or night, 12-23 stay as is, 1-5 likely PM
    if(hour >= 1 && hour <= 5) hour += 12; // assume afternoon
  }
  
  return hour * 60 + min;
}

function buildRentalTimeOptions(selectedValue){
  const options = [];
  for(let h = 6; h <= 22; h++){
    for(let m = 0; m < 60; m += 15){
      if(h === 22 && m > 45) break;
      const hour = h.toString().padStart(2, '0');
      const min = m.toString().padStart(2, '0');
      const value = `${hour}:${min}`;
      const period = h >= 12 ? 'PM' : 'AM';
      const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
      const display = `${h12}:${min} ${period}`;
      options.push({ value, display });
    }
  }
  let html = options.map(o=>`<option value="${o.value}" ${o.value===selectedValue?'selected':''}>${o.display}</option>`).join('');
  if(selectedValue && !options.find(o=> o.value === selectedValue)){
    html = `<option value="${escapeHtml(selectedValue)}" selected>${escapeHtml(selectedValue)}</option>` + html;
  }
  return html;
}

function getDefaultEndTime(start){
  if(!start || typeof start !== 'string' || !start.includes(':')) return '';
  const [hStr, mStr] = start.split(':');
  const h = Number(hStr);
  const m = Number(mStr);
  if(Number.isNaN(h) || Number.isNaN(m)) return '';
  let endH = h + 1;
  let endM = m;
  if(endH > 23) endH = 23;
  return `${String(endH).padStart(2,'0')}:${String(endM).padStart(2,'0')}`;
}

function openScheduleEditModal(monthYearStr, weekNumber, entry){
  const existing = document.querySelector('.modal-backdrop'); if(existing) existing.remove();
  const backdrop = document.createElement('div'); backdrop.className='modal-backdrop';
  const modal = document.createElement('div'); modal.className='modal';
  const days = ['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'];
  const dayOpts = days.map(d=>`<option ${d===entry.day? 'selected':''}>${escapeHtml(d)}</option>`).join('');
  const attOpts = '<option value="pending" '+  (entry.attendance==='pending'?'selected':'') +'>⏰ Pendiente</option><option value="present" ' + (entry.attendance==='present'?'selected':'') + '>✅ Asistió</option><option value="absent" ' + (entry.attendance==='absent'?'selected':'') + '>❌ No Asistió</option>';
  modal.innerHTML = `
    <h3>Editar Horario</h3>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div><label>Día</label><select id="m-sch-day" class="input">${dayOpts}</select></div>
      <div><label>Horario</label><input id="m-sch-time" class="input" value="${escapeHtml(entry.time)}" /></div>
      <div><label>Grupos/Personas</label><input id="m-sch-groups" class="input" value="${escapeHtml(entry.groups)}" /></div>
      <div><label>Monto</label><input id="m-sch-amount" type="number" class="input" value="${escapeHtml(entry.amount)}" /></div>
      <div style="grid-column:1/3"><label>Asistencia</label><select id="m-sch-att" class="input">${attOpts}</select></div>
    </div>
    <div style="text-align:right;margin-top:12px">
      <button id="m-sch-save" class="btn">Guardar</button>
      <button id="m-sch-close" class="btn btn-secondary">Cerrar</button>
    </div>
  `;
  backdrop.appendChild(modal); document.body.appendChild(backdrop);
  document.getElementById('m-sch-close').addEventListener('click', ()=>backdrop.remove());
  document.getElementById('m-sch-save').addEventListener('click', ()=>{
    updateRentalScheduleEntry(monthYearStr, weekNumber, entry.id, {
      day: document.getElementById('m-sch-day').value,
      time: document.getElementById('m-sch-time').value,
      groups: document.getElementById('m-sch-groups').value,
      amount: Number(document.getElementById('m-sch-amount').value) || 0,
      attendance: document.getElementById('m-sch-att').value
    });
    backdrop.remove();
    renderAllSchedules(monthYearStr);
    try{ syncSimpleScheduleForRentals(); }catch(e){}
  });
}

function openPersonEditModal(person, monthYear){
  const existing = document.querySelector('.modal-backdrop'); if(existing) existing.remove();
  const backdrop = document.createElement('div'); backdrop.className='modal-backdrop';
  const modal = document.createElement('div'); modal.className='modal';
  // build schedule rows HTML
  const days = ['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'];
  const dayOpts = days.map(d=>`<option>${escapeHtml(d)}</option>`).join('');
  const schedulesHtml = (person.schedules||[]).map(s=>{
    const endTime = s.timeEnd || getDefaultEndTime(s.time||'');
    return `<div class="person-sched-row" style="display:flex;gap:8px;align-items:center;margin-top:8px"><select class="m-per-sch-day input" style="width:30%">${days.map(d=>`<option ${d===s.day? 'selected':''}>${escapeHtml(d)}</option>`).join('')}</select><select class="m-per-sch-time input" style="flex:1">${buildRentalTimeOptions(s.time||'')}</select><select class="m-per-sch-time-end input" style="flex:1">${buildRentalTimeOptions(endTime)}</select><button class="btn btn-secondary remove-per-sched" type="button">Eliminar</button></div>`;
  }).join('');
  modal.innerHTML = `
    <h3>Editar Persona</h3>
    <div class="payments-highlight" style="margin-top:12px">
      <label style="font-weight:700;color:var(--pink);display:block;margin-bottom:8px">Información</label>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div style="grid-column:1/3"><label>Nombre</label><input id="m-per-name" class="input" value="${escapeHtml(person.name)}" /></div>
        <div><label>Grupo/Academia</label><input id="m-per-group" class="input" value="${escapeHtml(person.group||'')}" /></div>
        <div><label>Teléfono</label><input id="m-per-phone" class="input" value="${escapeHtml(person.phone||'')}" /></div>
        <div><label>Monto</label><input id="m-per-amount" type="number" class="input" value="${escapeHtml(person.amount||0)}" /></div>
        <div><label>Notas</label><textarea id="m-per-notes" class="input" style="min-height:70px">${escapeHtml(person.notes||'')}</textarea></div>
      </div>
    </div>
    <hr />
    <div class="payments-highlight" style="margin-top:12px">
      <label style="font-weight:700;color:var(--pink);display:block;margin-bottom:8px">Horarios</label>
      <div id="m-per-schedules-holder">
        ${schedulesHtml}
      </div>
      <div style="margin-top:8px"><button id="m-add-sched" class="btn btn-secondary" type="button">+ Agregar horario</button></div>
    </div>

    <div class="payments-highlight" style="margin-top:12px">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
        <label style="font-weight:700;color:var(--pink)">Pagos</label>
        <button id="rental-payments-toggle" class="btn btn-secondary" type="button">Mostrar pagos</button>
      </div>
      <div id="rental-payments-section" style="margin-top:8px;display:none">
        <div id="rental-payments-holder" style="display:flex;flex-direction:column;gap:8px"></div>
        <div style="margin-top:6px"><button id="add-rental-payment-row" class="btn btn-secondary" type="button">+ Agregar pago</button></div>
      </div>
    </div>

    <hr />
    <section class="history-section">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">
        <h4 style="margin:8px 0">Historial de la Persona</h4>
        <button id="rental-history-toggle" class="btn btn-secondary" type="button">Mostrar historial</button>
      </div>
      <div id="rental-history-filters" style="display:none;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px">
        <label style="font-weight:700;color:var(--muted)">Mes</label>
        <input type="month" id="rental-history-month" class="input" style="max-width:180px" />
        <label style="font-weight:700;color:var(--muted)">Tipo</label>
        <select id="rental-history-type" class="input" style="max-width:200px">
          <option value="all">Todos</option>
          <option value="payment">Pagos</option>
          <option value="schedule">Horarios</option>
          <option value="note">Notas</option>
        </select>
      </div>
      <div id="rental-history-timeline" style="display:none;flex-direction:column;gap:8px;max-height:220px;overflow:auto"></div>
    </section>
    <div style="text-align:right;margin-top:12px">
      <button id="m-per-save" class="btn">Guardar</button>
      <button id="m-per-close" class="btn btn-secondary">Cerrar</button>
    </div>
  `;
  backdrop.appendChild(modal); document.body.appendChild(backdrop);

  // handlers
  document.getElementById('m-per-close').addEventListener('click', ()=>backdrop.remove());

  function attachRemoveHandlers(){
    modal.querySelectorAll('.remove-per-sched').forEach(btn=> btn.addEventListener('click', ()=>{ btn.parentElement.remove(); }));
  }
  attachRemoveHandlers();

  function attachAutoEndHandlers(){
    modal.querySelectorAll('.person-sched-row').forEach(row=>{
      const startSel = row.querySelector('.m-per-sch-time');
      const endSel = row.querySelector('.m-per-sch-time-end');
      if(!startSel || !endSel) return;
      startSel.addEventListener('change', ()=>{
        const defEnd = getDefaultEndTime(startSel.value);
        if(defEnd && (!endSel.value || endSel.value === '')){
          endSel.value = defEnd;
        }
      });
    });
  }
  attachAutoEndHandlers();

  document.getElementById('m-add-sched').addEventListener('click', ()=>{
    const holder = document.getElementById('m-per-schedules-holder');
    const row = document.createElement('div');
    row.className = 'person-sched-row';
    row.style.display = 'flex'; row.style.gap='8px'; row.style.alignItems='center'; row.style.marginTop='8px';
    row.innerHTML = `<select class="m-per-sch-day input" style="width:30%">${dayOpts}</select><select class="m-per-sch-time input" style="flex:1">${buildRentalTimeOptions('')}</select><select class="m-per-sch-time-end input" style="flex:1">${buildRentalTimeOptions('')}</select><button class="btn btn-secondary remove-per-sched" type="button">Eliminar</button>`;
    holder.appendChild(row);
    attachRemoveHandlers();
    attachAutoEndHandlers();
  });

  function renderRentalPayments(){
    const holder = document.getElementById('rental-payments-holder');
    if(!holder) return;
    const payments = Array.isArray(person.payments) ? person.payments : [];
    holder.innerHTML = '';
    if(payments.length === 0){
      holder.innerHTML = '<div style="color:var(--muted);font-size:13px">No hay pagos registrados.</div>';
      return;
    }
    payments.forEach((p, idx)=>{
      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.gap = '8px';
      row.style.alignItems = 'center';
      row.innerHTML = `
        <input class="rental-pay-date input" data-idx="${idx}" type="date" value="${escapeHtml(p.date||'')}" style="width:150px" />
        <input class="rental-pay-amount input" data-idx="${idx}" type="number" value="${escapeHtml(p.amount||0)}" placeholder="Monto" style="width:120px" />
        <label style="display:flex;align-items:center;gap:4px"><input type="checkbox" class="rental-pay-paid" data-idx="${idx}" ${p.paid?'checked':''} /> Pagó</label>
        <input class="rental-pay-note input" data-idx="${idx}" placeholder="Nota" value="${escapeHtml(p.note||'')}" style="flex:1" />
        <button class="btn btn-secondary rental-pay-remove" data-idx="${idx}">Eliminar</button>
      `;
      holder.appendChild(row);
    });
    holder.querySelectorAll('.rental-pay-remove').forEach(btn=> btn.addEventListener('click', ()=>{
      const idx = Number(btn.dataset.idx);
      person.payments.splice(idx,1);
      renderRentalPayments();
    }));
  }

  const paymentsToggle = document.getElementById('rental-payments-toggle');
  const paymentsSection = document.getElementById('rental-payments-section');
  if(paymentsToggle && paymentsSection){
    paymentsToggle.addEventListener('click', ()=>{
      const hidden = paymentsSection.style.display === 'none';
      paymentsSection.style.display = hidden ? 'block' : 'none';
      paymentsToggle.textContent = hidden ? 'Ocultar pagos' : 'Mostrar pagos';
    });
  }
  const addPaymentBtn = document.getElementById('add-rental-payment-row');
  if(addPaymentBtn){
    addPaymentBtn.addEventListener('click', ()=>{
      if(!Array.isArray(person.payments)) person.payments = [];
      person.payments.push({date:'', amount:0, paid:false, note:''});
      renderRentalPayments();
    });
  }
  renderRentalPayments();

  function buildRentalHistoryItems(){
    const items = [];
    (person.payments||[]).forEach(p=>{
      if(!p.date) return;
      items.push({
        type: 'payment',
        date: p.date,
        title: `Pago $${p.amount||0} ${p.paid? '(pagó)':'(pendiente)'}`,
        detail: p.note || ''
      });
    });
    (person.schedules||[]).forEach(s=>{
      items.push({
        type: 'schedule',
        date: monthYear || person.monthYear || '',
        title: `Horario ${s.day||''} ${s.time||''}`,
        detail: ''
      });
    });
    if(person.notes){
      items.push({
        type: 'note',
        date: person.notesUpdatedAt || (monthYear || person.monthYear || ''),
        title: 'Nota',
        detail: person.notes
      });
    }
    return items.sort((a,b)=> String(b.date||'').localeCompare(String(a.date||'')));
  }

  function renderRentalHistory(){
    const wrap = document.getElementById('rental-history-timeline');
    if(!wrap) return;
    const monthFilter = document.getElementById('rental-history-month')?.value || '';
    const typeFilter = document.getElementById('rental-history-type')?.value || 'all';
    let items = buildRentalHistoryItems();
    if(typeFilter !== 'all') items = items.filter(i=> i.type === typeFilter);
    if(monthFilter) items = items.filter(i=> (i.date||'').startsWith(monthFilter));
    wrap.innerHTML = '';
    if(items.length === 0){
      wrap.innerHTML = '<div style="color:var(--muted);font-size:13px">No hay registros.</div>';
      return;
    }
    items.forEach(i=>{
      const row = document.createElement('div');
      row.style.border = '1px solid rgba(0,0,0,0.06)';
      row.style.borderRadius = '10px';
      row.style.padding = '10px';
      row.style.background = 'var(--card)';
      row.innerHTML = `
        <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap">
          <div style="font-weight:700;color:var(--pink)">${escapeHtml(i.title||'')}
            <div style="color:var(--muted);font-size:12px;margin-top:4px">${escapeHtml(i.detail||'')}</div>
          </div>
          <div style="font-weight:700;color:var(--black)">${escapeHtml(i.date||'')}</div>
        </div>
      `;
      wrap.appendChild(row);
    });
  }

  const historyToggle = document.getElementById('rental-history-toggle');
  if(historyToggle){
    historyToggle.addEventListener('click', ()=>{
      const filters = document.getElementById('rental-history-filters');
      const timeline = document.getElementById('rental-history-timeline');
      const hidden = timeline.style.display === 'none';
      timeline.style.display = hidden ? 'flex' : 'none';
      filters.style.display = hidden ? 'flex' : 'none';
      historyToggle.textContent = hidden ? 'Ocultar historial' : 'Mostrar historial';
      if(hidden) renderRentalHistory();
    });
  }
  const historyMonth = document.getElementById('rental-history-month');
  const historyType = document.getElementById('rental-history-type');
  if(historyMonth) historyMonth.addEventListener('change', renderRentalHistory);
  if(historyType) historyType.addEventListener('change', renderRentalHistory);

  document.getElementById('m-per-save').addEventListener('click', ()=>{
    const updated = {
      name: document.getElementById('m-per-name').value,
      group: document.getElementById('m-per-group').value,
      phone: document.getElementById('m-per-phone').value,
      amount: Number(document.getElementById('m-per-amount').value) || 0,
      notes: document.getElementById('m-per-notes').value
    };
    // collect schedules
    const schedules = [];
    modal.querySelectorAll('.person-sched-row').forEach(r=>{
      const day = r.querySelector('.m-per-sch-day')?.value || '';
      const time = r.querySelector('.m-per-sch-time')?.value || '';
      const timeEnd = r.querySelector('.m-per-sch-time-end')?.value || '';
      if(day && time) schedules.push({ day, time, timeEnd: timeEnd || null });
    });
    updated.schedules = schedules;
    // payments
    const paymentRows = Array.from(modal.querySelectorAll('#rental-payments-holder > div'));
    const payments = paymentRows.map(r=>{
      const date = r.querySelector('.rental-pay-date')?.value || '';
      const amount = Number(r.querySelector('.rental-pay-amount')?.value) || 0;
      const paid = r.querySelector('.rental-pay-paid')?.checked || false;
      const note = r.querySelector('.rental-pay-note')?.value || '';
      if(!date && !amount && !note) return null;
      return {date, amount, paid, note};
    }).filter(Boolean);
    updated.payments = payments;
    updated.notesUpdatedAt = updated.notes ? new Date().toISOString().slice(0,10) : '';
    updateRentalPerson(person.id, updated);
    // sync schedules to weekly rentas calendar for current month
    try{
      const monthYearVal = monthYear || document.getElementById('rental-month')?.value;
      if(monthYearVal){
        const allSchedules = loadRentalWeeklySchedule();
        const monthSchedules = allSchedules[monthYearVal] || [];
        const filtered = monthSchedules.filter(s => s.personId !== person.id && s.person !== updated.name);
        const newEntries = schedules.map(sch => ({
          id: `rental-sch-${Date.now()}-${Math.random().toString(16).slice(2,6)}`,
          type: 'Renta',
          title: 'Renta',
          person: updated.name,
          personId: person.id,
          day: sch.day,
          time: sch.time,
          timeEnd: sch.timeEnd || null,
          color: '#FF69B4'
        }));
        allSchedules[monthYearVal] = filtered.concat(newEntries);
        saveRentalWeeklySchedule(allSchedules);
        renderRentalSchedule();
      }
    }catch(e){}
    backdrop.remove();
    renderRentalPeople(monthYear);
    renderAllSchedules(monthYear);
    renderRentalPaymentsList(monthYear);
    try{ syncSimpleScheduleForRentals(); }catch(e){}
  });
}

function initRentasPage(){
  const backBtn = document.getElementById('rentas-back');
  const monthInput = document.getElementById('rental-month');
  const prevMonthBtn = document.getElementById('rental-prev-month');
  const nextMonthBtn = document.getElementById('rental-next-month');
  const addPersonBtn = document.getElementById('add-rental-person-btn');
  const notesTA = document.getElementById('rental-notes');
  const saveNotesBtn = document.getElementById('save-notes-btn');
  const scheduleTable = document.getElementById('rental-schedule-tbody');
  const addScheduleBtn = document.getElementById('add-rental-schedule-btn');
  const clearExpensesBtn = document.getElementById('rental-clear-expenses-btn');
  const selectedRentalIds = new Set(); // track selected schedule items
  
  if(!scheduleTable || !monthInput) return;

  // Set default month to today
  if(!monthInput.value){
    const d = new Date();
    monthInput.value = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  }
  
  function loadNotesForCurrentMonth(){
    if(notesTA){
      notesTA.value = loadRentalNotesForMonth(getCurrentMonthKey());
    }
  }
  if(saveNotesBtn){
    saveNotesBtn.addEventListener('click', ()=>{
      saveRentalNotesForMonth(getCurrentMonthKey(), notesTA.value);
      alert('Notas guardadas');
    });
  }
  if(clearExpensesBtn){
    clearExpensesBtn.addEventListener('click', ()=>{
      if(!confirm('Esto eliminará los datos antiguos de gastos. ¿Continuar?')) return;
      localStorage.removeItem('rds_rental_expenses_v1');
      alert('Datos antiguos de gastos eliminados');
    });
  }
  
  // back button
  if(backBtn) backBtn.addEventListener('click', ()=>{ try{ history.back(); }catch(e){ location.href = '../index.html'; } });
  
  // Helper functions (same as calendario)
  function generateTimeOptions() {
    const options = [];
    for (let h = 6; h <= 22; h++) {
      for (let m = 0; m < 60; m += 15) {
        if (h === 22 && m > 45) break;
        const hour = h.toString().padStart(2, '0');
        const min = m.toString().padStart(2, '0');
        const time24 = `${hour}:${min}`;
        const period = h >= 12 ? 'PM' : 'AM';
        const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
        const display = `${h12}:${min} ${period}`;
        options.push({ value: time24, display });
      }
    }
    return options;
  }

  const timeOptions = generateTimeOptions();

  function formatTimeDisplay(time24) {
    if(!time24 || typeof time24 !== 'string') return '';
    const parts = time24.split(':');
    if(parts.length < 2) return time24;
    const h = Number(parts[0]);
    const m = Number(parts[1]);
    if(Number.isNaN(h) || Number.isNaN(m)) return time24;
    const period = h >= 12 ? 'PM' : 'AM';
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${h12}:${m.toString().padStart(2, '0')} ${period}`;
  }

  function getUsedTimes(schedules) {
    const times = new Set();
    schedules.forEach(s => times.add(s.time));
    return Array.from(times).sort();
  }

  function getCurrentMonthKey(){
    const value = monthInput.value;
    if(!value){
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    }
    return value;
  }

  function renderRentalSchedule(){
    const monthKey = getCurrentMonthKey();
    const allSchedules = loadRentalWeeklySchedule();
    const schedules = allSchedules[monthKey] || [];
    scheduleTable.innerHTML = '';

    const days = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
    const usedTimes = getUsedTimes(schedules);

    if (usedTimes.length === 0) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 8;
      td.style.textAlign = 'center';
      td.style.padding = '2rem';
      td.style.color = '#666';
      td.textContent = 'No hay horarios de rentas. Haz clic en "+ Agregar Horario" para comenzar.';
      tr.appendChild(td);
      scheduleTable.appendChild(tr);
      return;
    }

    usedTimes.forEach(time => {
      const tr = document.createElement('tr');

      // Hora con rango
      const schedulesAtTime = schedules.filter(s => s.time === time);
      const maxEnd = schedulesAtTime.reduce((max, s) => {
        if(!s.timeEnd) return max;
        return !max || s.timeEnd > max ? s.timeEnd : max;
      }, null);
      
      const hourCell = document.createElement('td');
      hourCell.className = 'hour-cell';
      if(maxEnd){
        hourCell.textContent = `${formatTimeDisplay(time)} - ${formatTimeDisplay(maxEnd)}`;
      } else {
        hourCell.textContent = formatTimeDisplay(time);
      }
      tr.appendChild(hourCell);

      // Celdas de días
      days.forEach(day => {
        const td = document.createElement('td');
        const daySchedules = schedules.filter(s => s.day === day && s.time === time);

        daySchedules.forEach(sch => {
          const box = document.createElement('div');
          box.className = 'schedule-item-box';
          if(selectedRentalIds.has(sch.id)) box.classList.add('selected');
          const bgColor = sch.color || '#FF69B4';
          box.style.backgroundColor = bgColor;
          box.style.borderLeftColor = bgColor;
          box.style.color = '#fff';

          const title = document.createElement('div');
          title.className = 'title';
          title.style.color = '#fff';
          title.textContent = sch.title || 'Renta';
          box.appendChild(title);

          if(sch.person){
            const person = document.createElement('div');
            person.className = 'person';
            person.textContent = sch.person;
            box.appendChild(person);
          }

          if(sch.timeEnd){
            const timeRange = document.createElement('div');
            timeRange.className = 'time';
            timeRange.textContent = `${formatTimeDisplay(sch.time)} - ${formatTimeDisplay(sch.timeEnd)}`;
            box.appendChild(timeRange);
          }
          box.addEventListener('click', (e) => {
            if(e.metaKey || e.ctrlKey){
              if(selectedRentalIds.has(sch.id)) selectedRentalIds.delete(sch.id); else selectedRentalIds.add(sch.id);
              box.classList.toggle('selected');
              return;
            }
            openEditRentalScheduleModal(sch);
          });
          td.appendChild(box);
        });

        tr.appendChild(td);
      });

      scheduleTable.appendChild(tr);
    });
  }

  function openAddRentalScheduleModal(){
    const existing = document.querySelector('.modal-backdrop');
    if(existing) existing.remove();

    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.maxWidth = '500px';

    const timeOptionsHTML = timeOptions.map(t => 
      `<option value="${t.value}">${t.display}</option>`
    ).join('');

    const timeEndOptionsHTML = `<option value="">Sin hora de fin</option>` + timeOptionsHTML;

    modal.innerHTML = `
      <h3>Agregar Horario de Renta</h3>
      <div class="form-group">
        <label>Título (como aparece):</label>
        <input type="text" id="rental-schedule-title" class="input" placeholder="Ej: Renta - Ballet">
      </div>
      <div class="form-group">
        <label>Nombre de Persona/Grupo (opcional):</label>
        <input type="text" id="rental-schedule-person" class="input" placeholder="Ej: María García">
      </div>
      <div class="form-group">
        <label>Día:</label>
        <select id="rental-schedule-day" class="input">
          <option value="Lunes">Lunes</option>
          <option value="Martes">Martes</option>
          <option value="Miércoles">Miércoles</option>
          <option value="Jueves">Jueves</option>
          <option value="Viernes">Viernes</option>
          <option value="Sábado">Sábado</option>
          <option value="Domingo">Domingo</option>
        </select>
      </div>
      <div class="form-group">
        <label>Hora de inicio:</label>
        <select id="rental-schedule-time" class="input">${timeOptionsHTML}</select>
      </div>
      <div class="form-group">
        <label>Hora de fin (opcional):</label>
        <select id="rental-schedule-time-end" class="input">${timeEndOptionsHTML}</select>
      </div>
      <div class="form-group">
        <label>Color:</label>
        <input type="color" id="rental-schedule-color" class="input" value="#FF69B4">
      </div>
      <div style="display: flex; gap: 1rem; margin-top: 1.5rem;">
        <button class="btn-cancel" onclick="this.closest('.modal-backdrop').remove()">Cancelar</button>
        <button class="btn-primary" id="save-rental-schedule-btn">Guardar</button>
      </div>
    `;

    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);

    document.getElementById('save-rental-schedule-btn').onclick = () => {
      const title = document.getElementById('rental-schedule-title').value.trim();
      const person = document.getElementById('rental-schedule-person').value.trim();
      const day = document.getElementById('rental-schedule-day').value;
      const time = document.getElementById('rental-schedule-time').value;
      const timeEnd = document.getElementById('rental-schedule-time-end').value;
      const color = document.getElementById('rental-schedule-color').value;

      if(!title){
        alert('Por favor ingresa un título');
        return;
      }

      const monthKey = getCurrentMonthKey();
      const allSchedules = loadRentalWeeklySchedule();
      if(!allSchedules[monthKey]) allSchedules[monthKey] = [];
      
      const newSchedule = {
        id: 'rental-sch-' + Date.now(),
        type: 'Renta',
        title,
        person,
        day,
        time,
        timeEnd: timeEnd || null,
        color
      };

      allSchedules[monthKey].push(newSchedule);
      saveRentalWeeklySchedule(allSchedules);
      
      // Sincronizar con el calendario principal
      try{
        const calSchedules = loadSimpleSchedule(monthKey);
        calSchedules.push({
          ...newSchedule,
          source: 'renta'
        });
        saveSimpleSchedule(monthKey, calSchedules);
      }catch(e){}
      
      renderRentalSchedule();
      backdrop.remove();
    };
  }

  function openEditRentalScheduleModal(schedule){
    const existing = document.querySelector('.modal-backdrop');
    if(existing) existing.remove();

    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.maxWidth = '500px';

    const timeOptionsHTML = timeOptions.map(t => {
      const selectedStart = t.value === schedule.time ? 'selected' : '';
      return `<option value="${t.value}" ${selectedStart}>${t.display}</option>`;
    }).join('');

    const timeEndOptionsHTML = `<option value="">Sin hora de fin</option>` + timeOptions.map(t => {
      const selected = t.value === schedule.timeEnd ? 'selected' : '';
      return `<option value="${t.value}" ${selected}>${t.display}</option>`;
    }).join('');

    modal.innerHTML = `
      <h3>Editar Horario de Renta</h3>
      <div class="form-group">
        <label>Título (como aparece):</label>
        <input type="text" id="edit-rental-schedule-title" class="input" value="${escapeHtml(schedule.title)}">
      </div>
      <div class="form-group">
        <label>Nombre de Persona/Grupo (opcional):</label>
        <input type="text" id="edit-rental-schedule-person" class="input" value="${escapeHtml(schedule.person || '')}">
      </div>
      <div class="form-group">
        <label>Día:</label>
        <select id="edit-rental-schedule-day" class="input">
          <option value="Lunes" ${schedule.day === 'Lunes' ? 'selected' : ''}>Lunes</option>
          <option value="Martes" ${schedule.day === 'Martes' ? 'selected' : ''}>Martes</option>
          <option value="Miércoles" ${schedule.day === 'Miércoles' ? 'selected' : ''}>Miércoles</option>
          <option value="Jueves" ${schedule.day === 'Jueves' ? 'selected' : ''}>Jueves</option>
          <option value="Viernes" ${schedule.day === 'Viernes' ? 'selected' : ''}>Viernes</option>
          <option value="Sábado" ${schedule.day === 'Sábado' ? 'selected' : ''}>Sábado</option>
          <option value="Domingo" ${schedule.day === 'Domingo' ? 'selected' : ''}>Domingo</option>
        </select>
      </div>
      <div class="form-group">
        <label>Hora de inicio:</label>
        <select id="edit-rental-schedule-time" class="input">${timeOptionsHTML}</select>
      </div>
      <div class="form-group">
        <label>Hora de fin (opcional):</label>
        <select id="edit-rental-schedule-time-end" class="input">${timeEndOptionsHTML}</select>
      </div>
      <div class="form-group">
        <label>Color:</label>
        <input type="color" id="edit-rental-schedule-color" class="input" value="${schedule.color || '#FF69B4'}">
      </div>
      <div style="display: flex; gap: 1rem; margin-top: 1.5rem; justify-content: space-between;">
        <button class="btn" style="background-color:#dc3545;color:white" id="delete-rental-schedule-btn">Eliminar</button>
        <div style="display:flex;gap:1rem">
          <button class="btn-cancel" onclick="this.closest('.modal-backdrop').remove()">Cancelar</button>
          <button class="btn-primary" id="update-rental-schedule-btn">Actualizar</button>
        </div>
      </div>
    `;

    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);

    document.getElementById('delete-rental-schedule-btn').onclick = () => {
      if(!confirm('¿Eliminar este horario?')) return;
      const monthKey = getCurrentMonthKey();
      const allSchedules = loadRentalWeeklySchedule();
      if(allSchedules[monthKey]){
        allSchedules[monthKey] = allSchedules[monthKey].filter(s => s.id !== schedule.id);
      }
      saveRentalWeeklySchedule(allSchedules);
      
      // Sincronizar con el calendario principal
      try{
        const calSchedules = loadSimpleSchedule(monthKey);
        const calFiltered = calSchedules.filter(s => s.id !== schedule.id);
        saveSimpleSchedule(monthKey, calFiltered);
      }catch(e){}
      selectedRentalIds.delete(schedule.id);
      
      renderRentalSchedule();
      backdrop.remove();
    };

    document.getElementById('update-rental-schedule-btn').onclick = () => {
      const title = document.getElementById('edit-rental-schedule-title').value.trim();
      const person = document.getElementById('edit-rental-schedule-person').value.trim();
      const day = document.getElementById('edit-rental-schedule-day').value;
      const time = document.getElementById('edit-rental-schedule-time').value;
      const timeEnd = document.getElementById('edit-rental-schedule-time-end').value;
      const color = document.getElementById('edit-rental-schedule-color').value;

      if(!title){
        alert('Por favor ingresa un título');
        return;
      }

      const monthKey = getCurrentMonthKey();
      const allSchedules = loadRentalWeeklySchedule();
      if(!allSchedules[monthKey]) allSchedules[monthKey] = [];
      
      const index = allSchedules[monthKey].findIndex(s => s.id === schedule.id);
      if(index !== -1){
        allSchedules[monthKey][index] = {
          ...allSchedules[monthKey][index],
          title,
          person,
          day,
          time,
          timeEnd: timeEnd || null,
          color
        };
        saveRentalWeeklySchedule(allSchedules);
        
        // Sincronizar con el calendario principal
        try{
          const calSchedules = loadSimpleSchedule(monthKey);
          const calIndex = calSchedules.findIndex(s => s.id === schedule.id);
          if(calIndex !== -1){
            calSchedules[calIndex] = {
              ...allSchedules[monthKey][index],
              source: 'renta'
            };
            saveSimpleSchedule(monthKey, calSchedules);
          }
        }catch(e){}
        
        renderRentalSchedule();
      }

      backdrop.remove();
    };
  }

  // Copiar horario
  const copyScheduleBtn = document.getElementById('rental-schedule-copy');
  if(copyScheduleBtn){
    copyScheduleBtn.addEventListener('click', () => {
      const monthKey = getCurrentMonthKey();
      const allSchedules = loadRentalWeeklySchedule();
      const allMonthSchedules = allSchedules[monthKey] || [];
      const schedules = selectedRentalIds.size
        ? allMonthSchedules.filter(s => selectedRentalIds.has(s.id))
        : allMonthSchedules;
      if(schedules.length === 0){
        alert('No hay horarios para copiar en este mes');
        return;
      }
      try{
        localStorage.setItem('rds_rental_schedule_clipboard', JSON.stringify(schedules));
        alert(`📋 ${schedules.length} horarios copiados al portapapeles`);
      }catch(e){
        alert('Error al copiar horarios');
      }
    });
  }

  // Pegar horario
  const pasteScheduleBtn = document.getElementById('rental-schedule-paste');
  if(pasteScheduleBtn){
    pasteScheduleBtn.addEventListener('click', () => {
      const clipData = localStorage.getItem('rds_rental_schedule_clipboard');
      if(!clipData){
        alert('No hay horarios en el portapapeles');
        return;
      }
      try{
        const clipSchedules = JSON.parse(clipData);
        if(!confirm(`¿Pegar ${clipSchedules.length} horarios? Esto se agregará a los horarios existentes.`)) return;
        const monthKey = getCurrentMonthKey();
        const allSchedules = loadRentalWeeklySchedule();
        if(!allSchedules[monthKey]) allSchedules[monthKey] = [];
        const merged = allSchedules[monthKey].concat(clipSchedules.map((s, idx) => ({
          ...s,
          id: 'rental-sch-paste-' + Date.now() + '-' + idx
        })));
        allSchedules[monthKey] = merged;
        saveRentalWeeklySchedule(allSchedules);
        renderRentalSchedule();
        alert(`📥 ${clipSchedules.length} horarios pegados correctamente`);
      }catch(e){
        alert('Error al pegar horarios: formato inválido');
      }
    });
  }

  // Guardar horario
  const saveScheduleBtn = document.getElementById('rental-schedule-save');
  if(saveScheduleBtn){
    saveScheduleBtn.addEventListener('click', () => {
      const monthKey = getCurrentMonthKey();
      const allSchedules = loadRentalWeeklySchedule();
      const monthSchedules = allSchedules[monthKey] || [];
      saveRentalWeeklySchedule(allSchedules);
      alert(`💾 ${monthSchedules.length} horarios guardados correctamente`);
    });
  }

  // Month navigation
  if(prevMonthBtn){
    prevMonthBtn.addEventListener('click', ()=>{
      const [y, m] = monthInput.value.split('-');
      const d = new Date(y, Number(m)-2, 1);
      monthInput.value = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      monthInput.dispatchEvent(new Event('change'));
    });
  }
  if(nextMonthBtn){
    nextMonthBtn.addEventListener('click', ()=>{
      const [y, m] = monthInput.value.split('-');
      const d = new Date(y, Number(m), 1);
      monthInput.value = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      monthInput.dispatchEvent(new Event('change'));
    });
  }

  // On month change, reload schedule
  if(monthInput){
    monthInput.addEventListener('change', ()=>{
      const monthKey = getCurrentMonthKey();
      renderRentalSchedule();
      renderRentalPeople(monthKey);
      renderRentalPaymentsList(monthKey);
      loadNotesForCurrentMonth();
    });
  }

  // Add schedule button
  if(addScheduleBtn){
    addScheduleBtn.addEventListener('click', openAddRentalScheduleModal);
  }
  
  // add person
  if(addPersonBtn){
    addPersonBtn.addEventListener('click', ()=>{
      openAddRentalPersonModal(getCurrentMonthKey());
    });
  }

  // Search for rental people
  const peopleSearchInput = document.getElementById('rental-people-search');
  if(peopleSearchInput){
    peopleSearchInput.addEventListener('input', ()=>{
      renderRentalPeople(getCurrentMonthKey());
    });
  }
  
  // Copy / Paste people schedules UI
  const copyBtn = document.getElementById('copy-schedules-btn');
  const pasteBtn = document.getElementById('paste-schedules-btn');
  if(copyBtn){
    copyBtn.addEventListener('click', ()=>{
      const people = loadRentalPeople().filter(p => p.monthYear === getCurrentMonthKey());
      if(people.length === 0){ alert('No hay personas registradas'); return; }
      const existing = document.querySelector('.modal-backdrop'); if(existing) existing.remove();
      const backdrop = document.createElement('div'); backdrop.className='modal-backdrop';
      const modal = document.createElement('div'); modal.className='modal';
      let opts = '<option value="">-- Seleccionar persona --</option>';
      people.forEach(p => { opts += `<option value="${p.id}">${escapeHtml(p.name)} — ${escapeHtml((p.schedules||[]).map(s=>`${s.day} ${s.time}`).join(', '))}</option>`; });
      modal.innerHTML = `<h3>Copiar horarios de una persona</h3><div><select id="copy-person-select" class="input" style="width:100%">${opts}</select></div><div style="text-align:right;margin-top:10px"><button id="copy-person-ok" class="btn">Copiar</button><button id="copy-person-cancel" class="btn btn-secondary">Cancelar</button></div>`;
      backdrop.appendChild(modal); document.body.appendChild(backdrop);
      document.getElementById('copy-person-cancel').addEventListener('click', ()=>backdrop.remove());
      document.getElementById('copy-person-ok').addEventListener('click', ()=>{
        const sel = document.getElementById('copy-person-select'); if(!sel) return;
        const pid = sel.value; if(!pid){ alert('Selecciona una persona'); return; }
        copyPersonSchedulesToClipboard(pid);
        backdrop.remove();
      });
    });
  }
  if(pasteBtn){
    pasteBtn.addEventListener('click', ()=>{
      const raw = localStorage.getItem(RENTAL_CLIP_KEY);
      if(!raw){ alert('No hay horarios copiados en el portapapeles'); return; }
      let clip;
      try{ clip = JSON.parse(raw); }catch(e){ alert('Portapapeles inválido'); return; }
      const existing = document.querySelector('.modal-backdrop'); if(existing) existing.remove();
      const backdrop = document.createElement('div'); backdrop.className='modal-backdrop';
      const modal = document.createElement('div'); modal.className='modal';
      let html = `<h3>Pegar horarios</h3><div style="margin-bottom:8px">Persona: <strong>${escapeHtml(clip.name)}</strong></div>`;
      html += `<div style="margin-bottom:8px">Horarios a pegar:<div style="font-size:13px;margin-top:6px">${escapeHtml((clip.schedules||[]).map(s=>`${s.day} ${s.time}`).join(' • '))}</div></div>`;
      html += `<div style="text-align:right;margin-top:10px"><button id="paste-confirm" class="btn">Pegar</button><button id="paste-cancel" class="btn btn-secondary">Cancelar</button></div>`;
      modal.innerHTML = html; backdrop.appendChild(modal); document.body.appendChild(backdrop);
      document.getElementById('paste-cancel').addEventListener('click', ()=>backdrop.remove());
      document.getElementById('paste-confirm').addEventListener('click', ()=>{
        pasteSchedulesFromClipboard(getCurrentMonthKey(), 1);
        backdrop.remove();
        renderRentalPeople(getCurrentMonthKey());
      });
    });
  }
  
  // initial render
  renderRentalSchedule();
  renderRentalPeople(getCurrentMonthKey());
  renderRentalPaymentsList(getCurrentMonthKey());
  loadNotesForCurrentMonth();
}

// run on pages that include alumnas form
document.addEventListener('DOMContentLoaded', ()=>{
  initAlumnasPage();
  // if the attendance page is present, initialize it
  try{ initAsistenciaPage(); }catch(e){}
  // if the rental page is present, initialize it
  try{ initRentasPage(); }catch(e){}
  // if the montajes page is present, initialize it
  try{ initMontajesPage(); }catch(e){}
  // if the export page is present, initialize it
  try{ initExportPage(); }catch(e){}
});

/* ========================================
  PÁGINA 8: EXPORTAR A EXCEL
  ======================================== */

function csvSafe(val){
  if(val === null || val === undefined) return '';
  const s = String(val);
  return s.replace(/\r|\n/g,' ').trim();
}

function buildStudentsRows(){
  const students = loadStudents();
  const debts = loadDebts();
  const header = ['Tipo','Nombre','Disciplinas','Horarios','Monto Total','Pagó','Teléfono','Tutor','Teléfono Tutor','Dirección','Redes','Inscripción','Ensayos','Pagos','Adeudos','Notas'];
  const rows = [header];
  students.forEach(s=>{
    const discNames = (s.disciplines||[]).map(d=>d.name).join(', ');
    const scheds = (s.disciplines||[]).map(d=>d.schedule).filter(Boolean).join(' | ');
    const totalMonto = (s.disciplines||[]).reduce((sum,d)=>sum+(Number(d.amount)||0),0);
    const pagos = (s.personal?.payments||[]).map(p=>`${p.date||''}:${p.amount||0}${p.paid?'(OK)':''}`).join(' | ');
    const ensayos = (s.personal?.ensayos||[]).map(e=>`${e.date||''}${e.disc? ' '+e.disc:''}${e.note? ' '+e.note:''}`).join(' | ');
    const adeudosArr = debts.filter(d=> d.studentId===s.id || d.studentName===s.name);
    const adeudosTxt = adeudosArr.map(d=>`${d.amount||0}${d.recargo? '+rec:'+d.recargo:''}${d.concept? ' '+d.concept:''}${d.dueDate? ' vence:'+d.dueDate:''}${d.paid? ' (pagado)':''}`).join(' | ');
    const row = [
      csvSafe(s.type||''),
      csvSafe(s.name||''),
      csvSafe(discNames),
      csvSafe(scheds),
      String(totalMonto),
      s.paid? 'Sí':'No',
      csvSafe(s.personal?.phone||''),
      csvSafe(s.personal?.tutorName||''),
      csvSafe(s.personal?.tutorPhone||''),
      csvSafe(s.personal?.address||''),
      csvSafe(s.personal?.social||''),
      csvSafe(s.personal?.inscriptionDate||''),
      csvSafe(ensayos),
      csvSafe(pagos),
      csvSafe(adeudosTxt),
      csvSafe(s.personal?.allergyDetails||'')
    ];
    rows.push(row);
  });
  return rows;
}

function exportStudentsXLSX(){
  const rows = buildStudentsRows();
  downloadXLSX('replay-alumnas.xlsx', rows, 'Alumnas');
}

function buildAttendanceRows(){
  const store = loadAttendance();
  const students = loadStudents();
  const studentMap = {}; students.forEach(s=> studentMap[s.id]=s.name);
  const header = ['Fecha','Disciplina','ID Alumna','Nombre','Presente','Nota'];
  const rows = [header];
  Object.keys(store).sort().forEach(date=>{
    const byDisc = store[date]||{};
    Object.keys(byDisc).forEach(disc=>{
      const recs = byDisc[disc]||{};
      Object.keys(recs).forEach(sid=>{
        const r = recs[sid];
        rows.push([
          csvSafe(date),
          csvSafe(disc),
          csvSafe(sid),
          csvSafe(studentMap[sid]||''),
          r.present? 'Sí':'No',
          csvSafe(r.note||'')
        ]);
      });
    });
  });
  return rows;
}

function exportAttendanceXLSX(){
  const rows = buildAttendanceRows();
  downloadXLSX('replay-asistencia.xlsx', rows, 'Asistencia');
}

function buildStudentsRowsFiltered(year, month, discipline){
  const students = loadStudents();
  const debts = loadDebts();
  const header = ['Tipo','Nombre','Disciplinas','Horarios','Monto Total','Pagó','Teléfono','Tutor','Teléfono Tutor','Dirección','Redes','Inscripción','Ensayos','Pagos','Adeudos','Notas'];
  const rows = [header];
  const hasYear = !!year && year !== 'all';
  const hasMonth = !!month && month !== 'all';
  const matchesDate = (dateStr)=>{
    if(!dateStr) return false;
    if(hasYear && hasMonth) return dateStr.startsWith(`${year}-${month}`);
    if(hasYear && !hasMonth) return dateStr.startsWith(`${year}-`);
    if(!hasYear && hasMonth) return dateStr.slice(5,7) === month;
    return true;
  };
  students.forEach(s=>{
    if(discipline && !(s.disciplines||[]).some(d=> d.name === discipline)) return;
    if(hasYear || hasMonth){
      const hasPayment = (s.personal?.payments||[]).some(p=> matchesDate(p.date||''));
      const isInscribed = matchesDate(s.personal?.inscriptionDate||'');
      if(!hasPayment && !isInscribed) return;
    }
    const discNames = (s.disciplines||[]).map(d=>d.name).join(', ');
    const scheds = (s.disciplines||[]).map(d=>d.schedule).filter(Boolean).join(' | ');
    const totalMonto = (s.disciplines||[]).reduce((sum,d)=>sum+(Number(d.amount)||0),0);
    const pagos = (s.personal?.payments||[])
      .filter(p=> !(hasYear || hasMonth) || matchesDate(p.date||''))
      .map(p=>`${p.date||''}:${p.amount||0}${p.paid?'(OK)':''}`).join(' | ');
    const ensayos = (s.personal?.ensayos||[])
      .filter(e=> !(hasYear || hasMonth) || matchesDate(e.date||''))
      .map(e=>`${e.date||''}${e.disc? ' '+e.disc:''}${e.note? ' '+e.note:''}`).join(' | ');
    const adeudosArr = debts.filter(d=> d.studentId===s.id || d.studentName===s.name);
    const adeudosTxt = adeudosArr.map(d=>`${d.amount||0}${d.recargo? '+rec:'+d.recargo:''}${d.concept? ' '+d.concept:''}${d.dueDate? ' vence:'+d.dueDate:''}${d.paid? ' (pagado)':''}`).join(' | ');
    rows.push([
      csvSafe(s.type||''),
      csvSafe(s.name||''),
      csvSafe(discNames),
      csvSafe(scheds),
      String(totalMonto),
      s.paid? 'Sí':'No',
      csvSafe(s.personal?.phone||''),
      csvSafe(s.personal?.tutorName||''),
      csvSafe(s.personal?.tutorPhone||''),
      csvSafe(s.personal?.address||''),
      csvSafe(s.personal?.social||''),
      csvSafe(s.personal?.inscriptionDate||''),
      csvSafe(ensayos),
      csvSafe(pagos),
      csvSafe(adeudosTxt),
      csvSafe(s.personal?.allergyDetails||'')
    ]);
  });
  return rows;
}

function buildAttendanceRowsFiltered(year, month, discipline){
  const store = loadAttendance();
  const students = loadStudents();
  const studentMap = {}; students.forEach(s=> studentMap[s.id]=s.name);
  const header = ['Fecha','Disciplina','ID Alumna','Nombre','Presente','Nota'];
  const rows = [header];
  const hasYear = !!year && year !== 'all';
  const hasMonth = !!month && month !== 'all';
  const matchesDate = (dateStr)=>{
    if(!dateStr) return false;
    if(hasYear && hasMonth) return dateStr.startsWith(`${year}-${month}`);
    if(hasYear && !hasMonth) return dateStr.startsWith(`${year}-`);
    if(!hasYear && hasMonth) return dateStr.slice(5,7) === month;
    return true;
  };
  Object.keys(store).sort().forEach(date=>{
    if((hasYear || hasMonth) && !matchesDate(date)) return;
    const byDisc = store[date]||{};
    Object.keys(byDisc).forEach(disc=>{
      if(discipline && discipline !== 'Todas' && disc !== discipline) return;
      const recs = byDisc[disc]||{};
      Object.keys(recs).forEach(sid=>{
        const r = recs[sid];
        rows.push([
          csvSafe(date),
          csvSafe(disc),
          csvSafe(sid),
          csvSafe(studentMap[sid]||''),
          r.present? 'Sí':'No',
          csvSafe(r.note||'')
        ]);
      });
    });
  });
  return rows;
}

function loadAllRentalNotesByMonth(){
  const notes = {};
  try{
    for(let i=0;i<localStorage.length;i++){
      const key = localStorage.key(i);
      if(key && key.startsWith(`${RENTAL_NOTES_KEY}_`)){
        const month = key.replace(`${RENTAL_NOTES_KEY}_`, '');
        notes[month] = localStorage.getItem(key) || '';
      }
    }
  }catch(e){}
  return notes;
}

function buildRentalsRows(){
  const people = loadRentalPeople();
  const schedules = loadRentalSchedules();
  const notesByMonth = loadAllRentalNotesByMonth();
  const header = ['Sección','Mes','Semana','Nombre/Grupo','Campo','Valor'];
  const rows = [header];
  // People
  people.forEach(p=>{
    rows.push(['Persona', csvSafe(p.monthYear||''), '', csvSafe(p.name||''), 'Teléfono', csvSafe(p.phone||'')]);
    rows.push(['Persona', csvSafe(p.monthYear||''), '', csvSafe(p.name||''), 'Grupo', csvSafe(p.group||'')]);
    rows.push(['Persona', csvSafe(p.monthYear||''), '', csvSafe(p.name||''), 'Monto', String(p.amount||0)]);
    if(p.notes){
      rows.push(['Persona', csvSafe(p.monthYear||''), '', csvSafe(p.name||''), 'Notas', csvSafe(p.notes||'')]);
    }
    (p.payments||[]).forEach(pay=>{
      rows.push(['Pago', csvSafe(p.monthYear||''), '', csvSafe(p.name||''), `${pay.date||''}`, `Monto:${pay.amount||0} | Pagó:${pay.paid? 'Sí':'No'} | Nota:${pay.note||''}`]);
    });
    (p.schedules||[]).forEach(s=>{
      rows.push(['Horario', csvSafe(p.monthYear||''), '', csvSafe(p.name||''), `${s.day||''}`, csvSafe(s.time||'')]);
    });
  });
  // Weekly schedules
  Object.keys(schedules).forEach(month=>{
    const weeks = schedules[month]||{};
    Object.keys(weeks).forEach(week=>{
      weeks[week].forEach(e=>{
        rows.push(['Semanal', csvSafe(month), String(week), csvSafe(e.groups||''), `${e.day||''} ${e.time||''}`, `Monto:${e.amount||0} | Asistencia:${e.attendance||''}`]);
      });
    });
  });
  // Notes
  Object.keys(notesByMonth).forEach(month=>{
    const note = notesByMonth[month];
    if(note) rows.push(['Notas', csvSafe(month), '', '', 'Notas de Rentas', csvSafe(note)]);
  });
  return rows;
}

function renderRentalPaymentsList(monthKey){
  const tbody = document.getElementById('rental-payments-tbody');
  const label = document.getElementById('rental-payments-month-label');
  if(!tbody) return;
  if(label) label.textContent = monthKey || '—';
  const people = loadRentalPeople().filter(p=> !monthKey || p.monthYear === monthKey);
  const rows = [];
  people.forEach(p=>{
    (p.payments||[]).forEach(pay=>{
      if(monthKey && pay.date && !pay.date.startsWith(monthKey)) return;
      rows.push({
        date: pay.date || '',
        name: p.name || '',
        amount: pay.amount || 0,
        paid: !!pay.paid,
        note: pay.note || ''
      });
    });
  });
  tbody.innerHTML = '';
  if(rows.length === 0){
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 5;
    td.style.textAlign = 'center';
    td.style.color = 'var(--muted)';
    td.style.padding = '12px';
    td.textContent = 'No hay pagos registrados en este mes.';
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }
  rows.sort((a,b)=> String(b.date||'').localeCompare(String(a.date||'')));
  rows.forEach(r=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(r.date)}</td>
      <td>${escapeHtml(r.name)}</td>
      <td>$${escapeHtml(r.amount)}</td>
      <td>${r.paid? 'Sí':'No'}</td>
      <td>${escapeHtml(r.note)}</td>
    `;
    tbody.appendChild(tr);
  });
}

function exportRentalsXLSX(){
  const rows = buildRentalsRows();
  downloadXLSX('replay-rentas.xlsx', rows, 'Rentas');
}

function buildMontajesRows(){
  const xvs = loadXVQuinceaneras();
  const choreos = loadChoreographies();
  const header = ['Tipo','Nombre','Grupo/Paquete','Teléfono','Campo','Valor'];
  const rows = [header];
  // XV Años
  xvs.forEach(x=>{
    rows.push(['XV', csvSafe(x.nombre||''), csvSafe(x.paquete||''), csvSafe(x.telefono||''), 'Monto', String(x.monto||0)]);
    (x.montajes||[]).forEach(m=> rows.push(['XV', csvSafe(x.nombre||''), csvSafe(x.paquete||''), '', 'Montaje', csvSafe(m||'')]));
    (x.chambelanes||[]).forEach(ch=> rows.push(['XV', csvSafe(x.nombre||''), csvSafe(x.paquete||''), '', 'Chambelán', csvSafe(`${ch.nombre||''} ${ch.telefono? '('+ch.telefono+')':''}`)]));
    (x.pagos||[]).forEach(p=> rows.push(['XV', csvSafe(x.nombre||''), csvSafe(x.paquete||''), '', 'Pago', csvSafe(`${p.fecha||''} $${p.monto||0} ${p.porcentaje? p.porcentaje+'%':''} ${p.paid?'(OK)':''}`)]));
    (x.horarios||[]).forEach(h=> rows.push(['XV', csvSafe(x.nombre||''), csvSafe(x.paquete||''), '', 'Ensayo', csvSafe(`${h.fecha||''} ${h.hora||''} ${h.nota||''}`)]));
    if(x.notasExtras) rows.push(['XV', csvSafe(x.nombre||''), csvSafe(x.paquete||''), '', 'Notas', csvSafe(x.notasExtras)]);
  });
  // Coreografías
  choreos.forEach(c=>{
    rows.push(['Coreografía', csvSafe(c.nombre||''), csvSafe(c.grupo||''), csvSafe(c.telefono||''), 'Monto', String(c.monto||0)]);
    (c.coreografias||[]).forEach(co=> rows.push(['Coreografía', csvSafe(c.nombre||''), csvSafe(c.grupo||''), '', 'Número', csvSafe(`${co.nombre||''} | ${co.song||''} | ${co.minutes||''}`)]));
    (c.pagos||[]).forEach(p=> rows.push(['Coreografía', csvSafe(c.nombre||''), csvSafe(c.grupo||''), '', 'Pago', csvSafe(`${p.fecha||''} $${p.monto||0} ${p.porcentaje? p.porcentaje+'%':''} ${p.paid?'(OK)':''}`)]));
    (c.horarios||[]).forEach(h=> rows.push(['Coreografía', csvSafe(c.nombre||''), csvSafe(c.grupo||''), '', 'Ensayo', csvSafe(`${h.fecha||''} ${h.hora||''} ${h.nota||''}`)]));
    if(c.notasExtras) rows.push(['Coreografía', csvSafe(c.nombre||''), csvSafe(c.grupo||''), '', 'Notas', csvSafe(c.notasExtras)]);
  });
  return rows;
}

function exportMontajesXLSX(){
  const rows = buildMontajesRows();
  downloadXLSX('replay-montajes.xlsx', rows, 'Montajes');
}

function buildCalendarsRows(){
  const mini = loadCalendar();
  const main = loadMainCalendar();
  const xvCal = loadXVCalendar();
  const choreoCal = loadChoreoCalendar();
  const header = ['Calendario','Mes','Día','Nota'];
  const rows = [header];
  function pushCal(tag, cal){
    Object.keys(cal||{}).forEach(month=>{
      const days = (cal[month]&&cal[month].days)||{};
      Object.keys(days).forEach(day=>{
        rows.push([tag, csvSafe(month), csvSafe(day), csvSafe(days[day]||'')]);
      });
    });
  }
  pushCal('Mini', mini);
  pushCal('Principal', main);
  pushCal('XV', xvCal);
  pushCal('Coreografías', choreoCal);
  return rows;
}

function exportCalendarsXLSX(){
  const rows = buildCalendarsRows();
  downloadXLSX('replay-calendarios.xlsx', rows, 'Calendarios');
}

function buildHistoryRows(){
  const records = loadHistory();
  const header = ['ID','Mes','Año','Alumnas','Rentas','Montajes','Total Pagos','Gastos','Notas Extra','Notas Adicionales','Maestros'];
  const rows = [header];
  records.forEach(r=>{
    const maestros = (r.teachers||[]).map(t=>`${t.name||''} (${t.disciplines||''}) $${t.payment||''}${t.debt? ' adeudo:'+t.debt:''}${t.paymentDay? ' día:'+t.paymentDay:''}`).join(' | ');
    rows.push([
      csvSafe(r.id||''), csvSafe(r.month||''), csvSafe(r.year||''), csvSafe(r.students||''), csvSafe(r.rentals||''), csvSafe(r.montajes||''), csvSafe(r.totalPayments||''), csvSafe(r.expenses||''), csvSafe(r.notesExtra||''), csvSafe(r.notesAdditional||''), csvSafe(maestros)
    ]);
  });
  return rows;
}

function exportHistoryXLSX(){
  const rows = buildHistoryRows();
  downloadXLSX('replay-historial.xlsx', rows, 'Historial');
}

function exportEverythingXLSX(){
  const sheets = [
    {name:'Alumnas', rows: buildStudentsRows()},
    {name:'Asistencia', rows: buildAttendanceRows()},
    {name:'Rentas', rows: buildRentalsRows()},
    {name:'Montajes', rows: buildMontajesRows()},
    {name:'Calendarios', rows: buildCalendarsRows()},
    {name:'Historial', rows: buildHistoryRows()},
  ];
  downloadXLSXWorkbook('replay-todo.xlsx', sheets);
}

function initExportPage(){
  const monthSel = document.getElementById('export-month');
  const yearSel = document.getElementById('export-year');
  const discSel = document.getElementById('export-discipline');

  const months = [
    ['all','Todos los meses'],
    ['01','Enero'],['02','Febrero'],['03','Marzo'],['04','Abril'],['05','Mayo'],['06','Junio'],
    ['07','Julio'],['08','Agosto'],['09','Septiembre'],['10','Octubre'],['11','Noviembre'],['12','Diciembre']
  ];
  if(monthSel){ monthSel.innerHTML = months.map(m=>`<option value="${m[0]}">${m[1]}</option>`).join(''); }
  if(yearSel){
    const now = new Date();
    const years = [];
    for(let y=now.getFullYear()-3; y<=now.getFullYear()+3; y++) years.push(y);
    yearSel.innerHTML = ['<option value="all">Todos los años</option>']
      .concat(years.map(y=>`<option value="${y}">${y}</option>`))
      .join('');
    yearSel.value = String(now.getFullYear());
  }
  if(monthSel){ monthSel.value = String(new Date().getMonth()+1).padStart(2,'0'); }
  if(discSel){
    const discs = loadDisciplines();
    discSel.innerHTML = ['<option value="">Todas</option>']
      .concat(discs.map(d=>`<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`))
      .join('');
  }

  const filteredStudentsBtn = document.getElementById('btn-export-students-filtered');
  if(filteredStudentsBtn){
    filteredStudentsBtn.addEventListener('click', ()=>{
      const yearVal = yearSel ? yearSel.value : '';
      const monthVal = monthSel ? monthSel.value : '';
      const discipline = discSel ? discSel.value : '';
      const rows = buildStudentsRowsFiltered(yearVal, monthVal, discipline);
      downloadXLSX('replay-alumnas-filtrado.xlsx', rows, 'Alumnas');
    });
  }
  const filteredAttendanceBtn = document.getElementById('btn-export-attendance-filtered');
  if(filteredAttendanceBtn){
    filteredAttendanceBtn.addEventListener('click', ()=>{
      const yearVal = yearSel ? yearSel.value : '';
      const monthVal = monthSel ? monthSel.value : '';
      const discipline = discSel ? discSel.value : '';
      const rows = buildAttendanceRowsFiltered(yearVal, monthVal, discipline);
      downloadXLSX('replay-asistencia-filtrado.xlsx', rows, 'Asistencia');
    });
  }

  const map = [
    ['btn-export-students', exportStudentsXLSX],
    ['btn-export-attendance', exportAttendanceXLSX],
    ['btn-export-rentals', exportRentalsXLSX],
    ['btn-export-montajes', exportMontajesXLSX],
    ['btn-export-calendars', exportCalendarsXLSX],
    ['btn-export-history', exportHistoryXLSX],
    ['btn-export-all', exportEverythingXLSX],
  ];
  map.forEach(([id,fn])=>{ const el = document.getElementById(id); if(el) el.addEventListener('click', fn); });
}

/* -------- Montajes / XV Años Page (Página 4) -------- */

// Load/Save XV Años
function loadXVQuinceaneras(){ try{ const raw = localStorage.getItem(XV_KEY); return raw ? JSON.parse(raw) : []; }catch(e){ return []; } }
function saveXVQuinceaneras(arr){ try{ localStorage.setItem(XV_KEY, JSON.stringify(arr)); }catch(e){} }

// Load/Save XV Calendar
function loadXVCalendar(){ try{ const raw = localStorage.getItem(XV_CAL_KEY); return raw ? JSON.parse(raw) : {}; }catch(e){ return {}; } }
function saveXVCalendar(obj){ try{ localStorage.setItem(XV_CAL_KEY, JSON.stringify(obj)); syncMonthlyCalendarFromAllSourcesIfNeeded(); }catch(e){} }

// Load/Save XV Notes (month-scoped)
function getXVNotesKey(monthKey){ return `${XV_NOTES_KEY}_${monthKey}`; }
function loadXVNotesForMonth(monthKey){
  if(!monthKey) return '';
  try{ return localStorage.getItem(getXVNotesKey(monthKey)) || ''; }catch(e){ return ''; }
}
function saveXVNotesForMonth(monthKey, txt){
  if(!monthKey) return;
  try{ localStorage.setItem(getXVNotesKey(monthKey), String(txt||'')); }catch(e){} }


// Load/Save Choreographies
function loadChoreographies(){ try{ const raw = localStorage.getItem(CHOREO_KEY); return raw ? JSON.parse(raw) : []; }catch(e){ return []; } }
function saveChoreographies(arr){ try{ localStorage.setItem(CHOREO_KEY, JSON.stringify(arr)); }catch(e){} }

// Load/Save Choreo Calendar
function loadChoreoCalendar(){ try{ const raw = localStorage.getItem(CHOREO_CAL_KEY); return raw ? JSON.parse(raw) : {}; }catch(e){ return {}; } }
function saveChoreoCalendar(obj){ try{ localStorage.setItem(CHOREO_CAL_KEY, JSON.stringify(obj)); syncMonthlyCalendarFromAllSourcesIfNeeded(); }catch(e){} }

// Load/Save Choreo Notes (month-scoped)
function getChoreoNotesKey(monthKey){ return `${CHOREO_NOTES_KEY}_${monthKey}`; }
function loadChoreoNotesForMonth(monthKey){
  if(!monthKey) return '';
  try{ return localStorage.getItem(getChoreoNotesKey(monthKey)) || ''; }catch(e){ return ''; }
}
function saveChoreoNotesForMonth(monthKey, txt){
  if(!monthKey) return;
  try{ localStorage.setItem(getChoreoNotesKey(monthKey), String(txt||'')); }catch(e){} }


// Load/Save Packages (objects with details)
function normalizePackages(arr){
  if(!Array.isArray(arr)) return [];
  return arr.map(p=>{
    if(typeof p === 'string') return {name:p, cost:'', includes:''};
    if(p && typeof p === 'object'){
      return {name:p.name || '', cost:p.cost || '', includes:p.includes || ''};
    }
    return {name:'', cost:'', includes:''};
  }).filter(p=>p.name);
}
function loadPackages(){
  try{
    const raw = localStorage.getItem(PACKAGES_KEY);
    const data = raw ? JSON.parse(raw) : ['Básico','Medio','Plus','Premium','Deluxe','Luxury'];
    return normalizePackages(data);
  }catch(e){
    return normalizePackages(['Básico','Medio','Plus','Premium','Deluxe','Luxury']);
  }
}
function savePackages(arr){
  try{ localStorage.setItem(PACKAGES_KEY, JSON.stringify(normalizePackages(arr))); }catch(e){}
}

// XV Quinceañera management
let currentXVMonthKey = '';
let currentChoreoMonthKey = '';

function getMonthKeyFromDate(date){
  const d = date instanceof Date ? date : new Date(date);
  if(Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}

function getCurrentXVMonthKey(){
  if(currentXVMonthKey) return currentXVMonthKey;
  return getMonthKeyFromDate(new Date());
}
function getCurrentChoreoMonthKey(){
  if(currentChoreoMonthKey) return currentChoreoMonthKey;
  return getMonthKeyFromDate(new Date());
}

function addXVQuinceanera(paquete, nombre, telefono, monto, monthYear){
  const xvs = loadXVQuinceaneras();
  const id = `xv-${Date.now()}`;
  xvs.push({
    id,
    paquete,
    nombre,
    telefono,
    monto,
    monthYear: monthYear || getCurrentXVMonthKey(),
    montajes: [],
    personal: {},
    chambelanes: [],
    pagos: [],
    horarios: [],
    notasExtras: ''
  });
  saveXVQuinceaneras(xvs);
  return id;
}

function openAddXVModal(){
  const existing = document.querySelector('.modal-backdrop');
  if(existing) existing.remove();
  
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.style.maxWidth = '500px';
  
  const packages = loadPackages();
  let packageOptions = '';
  packages.forEach(p => {
    packageOptions += `<option value="${escapeHtml(p.name)}">${escapeHtml(p.name)}</option>`;
  });
  
  modal.innerHTML = `
    <h3>✨ Agregar XV Años</h3>
    <form id="add-xv-form" style="margin-top:16px">
      <div style="margin-bottom:12px">
        <label style="display:block;margin-bottom:4px;font-weight:600">Paquete *</label>
        <select id="xv-paquete" class="input" required>
          ${packageOptions}
        </select>
      </div>
      
      <div style="margin-bottom:12px">
        <label style="display:block;margin-bottom:4px;font-weight:600">Nombre de la Quinceañera *</label>
        <input id="xv-nombre" class="input" placeholder="Nombre completo" required />
      </div>
      
      <div style="margin-bottom:12px">
        <label style="display:block;margin-bottom:4px;font-weight:600">Teléfono</label>
        <input id="xv-telefono" class="input" type="tel" placeholder="Ej: 123-456-7890" />
      </div>
      
      <div style="margin-bottom:12px">
        <label style="display:block;margin-bottom:4px;font-weight:600">Monto</label>
        <input id="xv-monto" class="input" type="number" placeholder="0" min="0" step="0.01" />
      </div>
      
      <div style="text-align:right;margin-top:20px">
        <button type="button" id="xv-cancel" class="btn btn-secondary">Cancelar</button>
        <button type="submit" class="btn" style="margin-left:8px">Guardar</button>
      </div>
    </form>
  `;
  
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);
  
  document.getElementById('xv-cancel').addEventListener('click', ()=>backdrop.remove());
  document.getElementById('add-xv-form').addEventListener('submit', (e)=>{
    e.preventDefault();
    const paquete = document.getElementById('xv-paquete').value;
    const nombre = document.getElementById('xv-nombre').value.trim();
    if(!nombre){ alert('El nombre es requerido'); return; }
    
    const telefono = document.getElementById('xv-telefono').value.trim();
    const monto = Number(document.getElementById('xv-monto').value) || 0;
    
    addXVQuinceanera(paquete, nombre, telefono, monto, getCurrentXVMonthKey());
    backdrop.remove();
    renderXVTable();
    refreshXVDebtOptions();
  });
  
  // Focus on first input
  setTimeout(()=> document.getElementById('xv-nombre').focus(), 100);
}

function deleteXVQuinceanera(id){
  const all = loadXVQuinceaneras();
  const toDelete = all.find(x => x.id === id);
  if(toDelete){ addArchiveEntry('XV', toDelete.nombre || '', toDelete); }
  const xvs = all.filter(x => x.id !== id);
  saveXVQuinceaneras(xvs);
}

function updateXVQuinceanera(id, updates){
  const xvs = loadXVQuinceaneras();
  const xv = xvs.find(x => x.id === id);
  if(xv) Object.assign(xv, updates);
  saveXVQuinceaneras(xvs);
}

// Sort XV by package order, then alphabetically
function sortXVQuinceaneras(xvs, sortBy = 'package'){
  if(sortBy === 'name'){
    return [...xvs].sort((a,b)=> a.nombre.localeCompare(b.nombre, 'es', {sensitivity:'base'}));
  }
  // sort by package
  const packages = loadPackages();
  const paqueteOrder = {};
  packages.forEach((p, idx)=> paqueteOrder[p.name] = idx);
  return [...xvs].sort((a,b)=>{
    const aPaq = paqueteOrder[a.paquete] !== undefined ? paqueteOrder[a.paquete] : 99;
    const bPaq = paqueteOrder[b.paquete] !== undefined ? paqueteOrder[b.paquete] : 99;
    if(aPaq !== bPaq) return aPaq - bPaq;
    return a.nombre.localeCompare(b.nombre, 'es', {sensitivity:'base'});
  });
}

// Render XV table
function renderXVTable(){
  const tbody = document.getElementById('xv-tbody');
  if(!tbody) return;
  const searchInput = document.getElementById('xv-search');
  const sortBySelect = document.getElementById('xv-sort-by');
  const searchQuery = searchInput ? searchInput.value.toLowerCase().trim() : '';
  const sortBy = sortBySelect ? sortBySelect.value : 'package';
  let xvs = loadXVQuinceaneras();
  const monthKey = getCurrentXVMonthKey();
  let changed = false;
  xvs.forEach(x=>{
    if(!x.monthYear){ x.monthYear = monthKey; changed = true; }
  });
  if(changed) saveXVQuinceaneras(xvs);
  xvs = xvs.filter(x=> x.monthYear === monthKey);
  
  // filter by search
  if(searchQuery){
    xvs = xvs.filter(x => x.nombre.toLowerCase().includes(searchQuery));
  }
  
  // sort
  xvs = sortXVQuinceaneras(xvs, sortBy);
  
  tbody.innerHTML = '';
  xvs.forEach(xv=>{
    const tr = document.createElement('tr');
    const montajesCount = (xv.montajes || []).length;
    tr.innerHTML = `
      <td>${escapeHtml(xv.paquete)}</td>
      <td><a href="#" class="xv-link" data-id="${xv.id}">${escapeHtml(xv.nombre)}</a></td>
      <td>${montajesCount}</td>
      <td>${escapeHtml(xv.telefono||'')}</td>
      <td>$${escapeHtml(xv.monto||0)}</td>
      <td style="white-space:nowrap">
        <button class="btn btn-secondary edit-xv" data-id="${xv.id}" style="padding:4px 6px;font-size:12px">Editar</button>
        <button class="btn delete-xv" data-id="${xv.id}" style="padding:4px 6px;font-size:12px">Eliminar</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
  
  // attach handlers
  document.querySelectorAll('.xv-link').forEach(el=> el.addEventListener('click', e=>{
    e.preventDefault();
    openXVDetailModal(el.dataset.id);
  }));
  
  document.querySelectorAll('.edit-xv').forEach(btn=> btn.addEventListener('click', e=>{
    const id = btn.dataset.id;
    const xv = loadXVQuinceaneras().find(x => x.id === id);
    if(xv) openXVEditModal(xv);
  }));
  
  document.querySelectorAll('.delete-xv').forEach(btn=> btn.addEventListener('click', e=>{
    if(confirm('Eliminar esta quinceañera?')){
      deleteXVQuinceanera(btn.dataset.id);
      renderXVTable();
    }
  }));
}

// Open XV Detail Modal (Información Personal y Coreografías)
function openXVDetailModal(id){
  const xv = loadXVQuinceaneras().find(x => x.id === id);
  if(!xv) return alert('Quinceañera no encontrada');
  
  const existing = document.querySelector('.modal-backdrop');
  if(existing) existing.remove();
  
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.style.maxWidth = '800px';
  
  const paquetes = ['Básico','Medio','Plus','Premium','Deluxe','Luxury'];
  const montajesTypes = ['Entrada','Principal','Muñeca','Copas','Baile Sorpresa 1','Baile Sorpresa 2'];
  
  modal.innerHTML = `
    <h3>${escapeHtml(xv.nombre)} — Detalles</h3>
    
    <div class="tabs-fixed" style="margin:12px 0">
      <button class="tab active" data-tab="personal">📋 Info Personal</button>
      <button class="tab" data-tab="montajes">💃 Coreografías</button>
      <button class="tab" data-tab="chambelanes">👔 Chambelanes</button>
      <button class="tab" data-tab="pagos">💰 Pagos</button>
      <button class="tab" data-tab="horarios">📅 Horarios</button>
      <button class="tab" data-tab="notas">📝 Notas</button>
    </div>
    
    <div id="detail-personal" class="tab-content">
      <h4>Información Personal</h4>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div><label>Redes Sociales</label><input id="xv-d-social" class="input" value="${escapeHtml(xv.personal.social||'')}" /></div>
        <div><label>Tutor</label><input id="xv-d-tutor" class="input" value="${escapeHtml(xv.personal.tutor||'')}" /></div>
        <div><label>Teléfono Tutor</label><input id="xv-d-tutor-phone" class="input" value="${escapeHtml(xv.personal.tutorPhone||'')}" /></div>
        <div><label>Parentesco</label><input id="xv-d-parentesco" class="input" value="${escapeHtml(xv.personal.parentesco||'')}" /></div>
        <div><label>Redes Tutor</label><input id="xv-d-tutor-social" class="input" value="${escapeHtml(xv.personal.tutorSocial||'')}" /></div>
        <div><label>Contrato a nombre de:</label><input id="xv-d-contrato" class="input" value="${escapeHtml(xv.personal.contrato||'')}" /></div>
      </div>
    </div>
    
    <div id="detail-montajes" class="tab-content" style="display:none">
      <h4>Información de Coreografías</h4>
      <div id="montajes-holder"></div>
      <button id="add-montaje-row" class="btn btn-secondary" style="margin-top:8px">+ Agregar Montaje</button>
    </div>
    
    <div id="detail-chambelanes" class="tab-content" style="display:none">
      <h4>Chambelanes</h4>
      <div class="table-wrap" style="max-height:300px">
        <table class="table" id="chambelanes-table">
          <thead><tr><th>Nombre</th><th>Teléfono</th><th>Redes</th><th>Traje</th><th>Monto</th><th>Notas</th><th>Acciones</th></tr></thead>
          <tbody id="chambelanes-tbody"></tbody>
        </table>
      </div>
      <button id="add-chambelan-btn" class="btn btn-secondary" style="margin-top:8px">+ Agregar Chambelán</button>
    </div>
    
    <div id="detail-pagos" class="tab-content" style="display:none">
      <h4>Pagos</h4>
      <div id="pagos-holder"></div>
      <button id="add-pago-row" class="btn btn-secondary" style="margin-top:8px">+ Agregar Pago</button>
    </div>
    
    <div id="detail-horarios" class="tab-content" style="display:none">
      <h4>Horarios de Ensayo</h4>
      <div id="horarios-holder"></div>
      <button id="add-horario-row" class="btn btn-secondary" style="margin-top:8px">+ Agregar Horario</button>
    </div>
    
    <div id="detail-notas" class="tab-content" style="display:none">
      <h4>Notas Extras</h4>
      <textarea id="xv-d-notas" class="input" style="min-height:120px;width:100%">${escapeHtml(xv.notasExtras||'')}</textarea>
    </div>
    
    <div style="text-align:right;margin-top:12px">
      <button id="xv-d-save" class="btn">Guardar Todo</button>
      <button id="xv-d-close" class="btn btn-secondary">Cerrar</button>
    </div>
  `;
  
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);
  
  // Tab switching
  modal.querySelectorAll('.tab').forEach(tab=> tab.addEventListener('click', ()=>{
    modal.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
    tab.classList.add('active');
    modal.querySelectorAll('.tab-content').forEach(c=>c.style.display='none');
    const target = tab.dataset.tab;
    const content = modal.querySelector(`#detail-${target}`);
    if(content) content.style.display = 'block';
  }));
  
  // Render montajes
  function renderMontajes(){
    const holder = document.getElementById('montajes-holder');
    holder.innerHTML = '';
    (xv.montajes || []).forEach((m, idx)=>{
      const row = document.createElement('div');
      row.style.marginBottom = '10px';
      row.style.padding = '10px';
      row.style.border = '1px solid rgba(0,0,0,0.06)';
      row.style.borderRadius = '6px';
      row.innerHTML = `
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
          <select class="montaje-type input" style="flex:1">${montajesTypes.map(t=>`<option ${t===m.type?'selected':''}>${escapeHtml(t)}</option>`).join('')}</select>
          <button class="btn remove-montaje" data-idx="${idx}">Eliminar</button>
        </div>
        <label>Canción:</label>
        <input class="montaje-song input" value="${escapeHtml(m.song||'')}" placeholder="Nombre de la canción" style="width:100%;margin-bottom:4px" />
        <label>Minutos:</label>
        <input class="montaje-minutes input" value="${escapeHtml(m.minutes||'')}" placeholder="Ej: 3:45" style="width:100%" />
      `;
      holder.appendChild(row);
    });
    
    holder.querySelectorAll('.remove-montaje').forEach(btn=> btn.addEventListener('click', ()=>{
      const idx = Number(btn.dataset.idx);
      xv.montajes.splice(idx, 1);
      renderMontajes();
    }));
  }
  renderMontajes();
  
  document.getElementById('add-montaje-row').addEventListener('click', ()=>{
    if(!xv.montajes) xv.montajes = [];
    xv.montajes.push({type:'Entrada', song:'', minutes:''});
    renderMontajes();
  });
  
  // Render chambelanes
  function renderChambelanes(){
    const tbody = document.getElementById('chambelanes-tbody');
    tbody.innerHTML = '';
    (xv.chambelanes || []).forEach((c, idx)=>{
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><input class="ch-nombre input" data-idx="${idx}" value="${escapeHtml(c.nombre||'')}" /></td>
        <td><input class="ch-telefono input" data-idx="${idx}" value="${escapeHtml(c.telefono||'')}" /></td>
        <td><input class="ch-redes input" data-idx="${idx}" value="${escapeHtml(c.redes||'')}" /></td>
        <td><input class="ch-traje input" data-idx="${idx}" value="${escapeHtml(c.traje||'')}" /></td>
        <td><input class="ch-monto input" data-idx="${idx}" type="number" value="${escapeHtml(c.monto||0)}" /></td>
        <td><input class="ch-notas input" data-idx="${idx}" value="${escapeHtml(c.notas||'')}" placeholder="Notas..." /></td>
        <td><button class="btn remove-ch" data-idx="${idx}">Eliminar</button></td>
      `;
      tbody.appendChild(tr);
    });
    
    tbody.querySelectorAll('.remove-ch').forEach(btn=> btn.addEventListener('click', ()=>{
      const idx = Number(btn.dataset.idx);
      xv.chambelanes.splice(idx, 1);
      renderChambelanes();
    }));
  }
  renderChambelanes();
  
  document.getElementById('add-chambelan-btn').addEventListener('click', ()=>{
    if(!xv.chambelanes) xv.chambelanes = [];
    xv.chambelanes.push({nombre:'', telefono:'', redes:'', traje:'', monto:0, notas:''});
    renderChambelanes();
  });
  
  // Render pagos
  function renderPagos(){
    const holder = document.getElementById('pagos-holder');
    holder.innerHTML = '';
    (xv.pagos || []).forEach((p, idx)=>{
      const row = document.createElement('div');
      row.style.marginBottom = '8px';
      row.style.display = 'flex';
      row.style.gap = '8px';
      row.style.alignItems = 'center';
      row.innerHTML = `
        <input class="pago-monto input" data-idx="${idx}" type="number" placeholder="Monto" value="${escapeHtml(p.monto||0)}" style="width:110px" />
        <input class="pago-porcentaje input" data-idx="${idx}" placeholder="%" value="${escapeHtml(p.porcentaje||'')}" style="width:80px" />
        <input class="pago-fecha input" data-idx="${idx}" type="date" value="${escapeHtml(p.fecha||'')}" style="width:150px" />
        <label style="display:flex;align-items:center;gap:4px"><input type="checkbox" class="pago-paid" data-idx="${idx}" ${p.paid?'checked':''} /> Pagó</label>
        <button class="btn remove-pago" data-idx="${idx}">Eliminar</button>
      `;
      holder.appendChild(row);
    });
    
    holder.querySelectorAll('.remove-pago').forEach(btn=> btn.addEventListener('click', ()=>{
      const idx = Number(btn.dataset.idx);
      xv.pagos.splice(idx, 1);
      renderPagos();
    }));
  }
  renderPagos();
  
  document.getElementById('add-pago-row').addEventListener('click', ()=>{
    if(!xv.pagos) xv.pagos = [];
    xv.pagos.push({monto:0, porcentaje:'', fecha:'', paid:false});
    renderPagos();
  });
  
  // Render horarios
  function renderHorarios(){
    const holder = document.getElementById('horarios-holder');
    holder.innerHTML = '';
    (xv.horarios || []).forEach((h, idx)=>{
      const row = document.createElement('div');
      row.style.marginBottom = '8px';
      row.style.display = 'flex';
      row.style.gap = '8px';
      row.style.alignItems = 'center';
      row.innerHTML = `
        <input class="horario-fecha input" data-idx="${idx}" type="date" value="${escapeHtml(h.fecha||'')}" style="width:150px" />
        <input class="horario-hora input" data-idx="${idx}" placeholder="Hora (Ej: 3:00 PM)" value="${escapeHtml(h.hora||'')}" style="flex:1" />
        <input class="horario-nota input" data-idx="${idx}" placeholder="Nota" value="${escapeHtml(h.nota||'')}" style="flex:1" />
        <button class="btn remove-horario" data-idx="${idx}">Eliminar</button>
      `;
      holder.appendChild(row);
    });
    
    holder.querySelectorAll('.remove-horario').forEach(btn=> btn.addEventListener('click', ()=>{
      const idx = Number(btn.dataset.idx);
      xv.horarios.splice(idx, 1);
      renderHorarios();
    }));
  }
  renderHorarios();
  
  document.getElementById('add-horario-row').addEventListener('click', ()=>{
    if(!xv.horarios) xv.horarios = [];
    xv.horarios.push({fecha:'', hora:'', nota:''});
    renderHorarios();
  });
  
  // Save all
  document.getElementById('xv-d-save').addEventListener('click', ()=>{
    // personal info
    xv.personal = {
      social: document.getElementById('xv-d-social').value,
      tutor: document.getElementById('xv-d-tutor').value,
      tutorPhone: document.getElementById('xv-d-tutor-phone').value,
      parentesco: document.getElementById('xv-d-parentesco').value,
      tutorSocial: document.getElementById('xv-d-tutor-social').value,
      contrato: document.getElementById('xv-d-contrato').value
    };
    
    // montajes
    const montajesRows = document.querySelectorAll('#montajes-holder > div');
    xv.montajes = [];
    montajesRows.forEach(row=>{
      const type = row.querySelector('.montaje-type')?.value || 'Entrada';
      const song = row.querySelector('.montaje-song')?.value || '';
      const minutes = row.querySelector('.montaje-minutes')?.value || '';
      xv.montajes.push({type, song, minutes});
    });
    
    // chambelanes
    xv.chambelanes = [];
    document.querySelectorAll('.ch-nombre').forEach(inp=>{
      const idx = Number(inp.dataset.idx);
      const nombre = inp.value;
      const telefono = document.querySelector(`.ch-telefono[data-idx="${idx}"]`)?.value || '';
      const redes = document.querySelector(`.ch-redes[data-idx="${idx}"]`)?.value || '';
      const traje = document.querySelector(`.ch-traje[data-idx="${idx}"]`)?.value || '';
      const monto = Number(document.querySelector(`.ch-monto[data-idx="${idx}"]`)?.value) || 0;
      const notas = document.querySelector(`.ch-notas[data-idx="${idx}"]`)?.value || '';
      xv.chambelanes.push({nombre, telefono, redes, traje, monto, notas});
    });
    
    // pagos
    xv.pagos = [];
    document.querySelectorAll('.pago-porcentaje').forEach(inp=>{
      const idx = Number(inp.dataset.idx);
      const porcentaje = inp.value;
      const monto = Number(document.querySelector(`.pago-monto[data-idx="${idx}"]`)?.value) || 0;
      const fecha = document.querySelector(`.pago-fecha[data-idx="${idx}"]`)?.value || '';
      const paid = document.querySelector(`.pago-paid[data-idx="${idx}"]`)?.checked || false;
      xv.pagos.push({monto, porcentaje, fecha, paid});
    });
    
    // horarios
    xv.horarios = [];
    document.querySelectorAll('.horario-fecha').forEach(inp=>{
      const idx = Number(inp.dataset.idx);
      const fecha = inp.value;
      const hora = document.querySelector(`.horario-hora[data-idx="${idx}"]`)?.value || '';
      const nota = document.querySelector(`.horario-nota[data-idx="${idx}"]`)?.value || '';
      if(fecha) xv.horarios.push({fecha, hora, nota});
    });
    
    // sync horarios to XV calendar
    xv.horarios.forEach(h=>{
      if(h.fecha){
        try{ addXVCalendarEvent(h.fecha, `XV Años - ${xv.nombre} — ${h.hora} ${h.nota}`); }catch(e){}
      }
    });
    // sync pagos to XV calendar
    xv.pagos.forEach(p=>{
      if(p.fecha){
        const pct = p.porcentaje ? ` ${p.porcentaje}%` : '';
        try{ addXVCalendarEvent(p.fecha, `Pago XV - ${xv.nombre} - $${p.monto||0}${pct}`); }catch(e){}
      }
    });
    
    // notas
    xv.notasExtras = document.getElementById('xv-d-notas').value;

    xv.monthYear = getCurrentXVMonthKey();
    
    updateXVQuinceanera(xv.id, xv);
    try{ syncSimpleScheduleForXV(); }catch(e){}
    alert('Información guardada');
    backdrop.remove();
    renderXVTable();
    renderXVPaymentsList(getCurrentXVMonthKey());
  });
  
  document.getElementById('xv-d-close').addEventListener('click', ()=>backdrop.remove());
}

// Open XV Edit Modal (basic info)
function openXVEditModal(xv){
  const existing = document.querySelector('.modal-backdrop');
  if(existing) existing.remove();
  
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  const modal = document.createElement('div');
  modal.className = 'modal';
  
  const paquetes = loadPackages();
  const paqueteOpts = paquetes.map(p=>`<option ${p.name===xv.paquete?'selected':''}>${escapeHtml(p.name)}</option>`).join('');
  
  modal.innerHTML = `
    <h3>Editar XV Años</h3>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div><label>Paquete</label><select id="xv-e-paquete" class="input">${paqueteOpts}</select></div>
      <div><label>Quinceañera</label><input id="xv-e-nombre" class="input" value="${escapeHtml(xv.nombre)}" /></div>
      <div><label>Teléfono</label><input id="xv-e-telefono" class="input" value="${escapeHtml(xv.telefono||'')}" /></div>
      <div><label>Monto</label><input id="xv-e-monto" type="number" class="input" value="${escapeHtml(xv.monto||0)}" /></div>
    </div>
    <div style="text-align:right;margin-top:12px">
      <button id="xv-e-save" class="btn">Guardar</button>
      <button id="xv-e-close" class="btn btn-secondary">Cerrar</button>
    </div>
  `;
  
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);
  
  document.getElementById('xv-e-close').addEventListener('click', ()=>backdrop.remove());
  document.getElementById('xv-e-save').addEventListener('click', ()=>{
    updateXVQuinceanera(xv.id, {
      paquete: document.getElementById('xv-e-paquete').value,
      nombre: document.getElementById('xv-e-nombre').value,
      telefono: document.getElementById('xv-e-telefono').value,
      monto: Number(document.getElementById('xv-e-monto').value) || 0,
      monthYear: getCurrentXVMonthKey()
    });
    backdrop.remove();
    renderXVTable();
  });
}

// XV Calendar helpers
function addXVCalendarEvent(dateString, text){
  if(!dateString) return;
  const m = dateString.match(/(\d{4})-(\d{2})-(\d{2})/);
  if(!m) return;
  const yyyy = m[1], mm = m[2], dd = String(parseInt(m[3],10));
  const key = `${yyyy}-${mm}`;
  const store = loadXVCalendar();
  store[key] = store[key] || {meta:{name:'',days:0,start:0}, days:{}};
  const prev = store[key].days[dd];
  const arr = normalizeNotesArray(prev);
  arr.push({text, color:'#ED468F', type:''});
  store[key].days[dd] = arr;
  saveXVCalendar(store);
}

// Init XV Calendar
function initXVCalendar(){
  const calWrap = document.getElementById('xv-mini-calendar');
  if(!calWrap) return;
  const displayLabel = document.getElementById('xv-cal-display-month');
  const deleteBtn = document.getElementById('xv-cal-delete');
  const prevBtn = document.getElementById('xv-cal-prev');
  const nextBtn = document.getElementById('xv-cal-next');
  
  let currentDate = new Date(); currentDate.setDate(1);
  
  function monthKeyFromDate(d){
    const y = d.getFullYear(); const m = String(d.getMonth()+1).padStart(2,'0'); return `${y}-${m}`;
  }
  
  function updateDisplayLabel(){
    displayLabel.textContent = currentDate.toLocaleString('es-ES',{month:'long', year:'numeric'});
  }
  updateDisplayLabel();

  function syncMonthContext(){
    const key = monthKeyFromDate(currentDate);
    currentXVMonthKey = key;
    const notesTA = document.getElementById('xv-notes');
    if(notesTA) notesTA.value = loadXVNotesForMonth(key);
    renderXVTable();
    renderXVPaymentsList(key);
  }
  
  function render(){
    calWrap.innerHTML = '';
    const days = new Date(currentDate.getFullYear(), currentDate.getMonth()+1, 0).getDate();
    const start = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1).getDay();
    const dayNames = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
    dayNames.forEach(name=>{
      const h = document.createElement('div'); h.className='weekday'; h.textContent = name; calWrap.appendChild(h);
    });
    const leading = start;
    for(let i=0;i<leading;i++){ const cell = document.createElement('div'); cell.className='calendar-cell empty'; calWrap.appendChild(cell); }
    for(let d=1; d<=days; d++){
      const cell = document.createElement('div'); 
      cell.className='calendar-cell';
      cell.dataset.day = d;
      const num = document.createElement('div'); 
      num.className='day-num'; 
      num.textContent = d;
      const noteP = document.createElement('div'); 
      noteP.className='note-preview';
      const monthKey = monthKeyFromDate(currentDate);
      const stored = loadXVCalendar();
      const noteRaw = (stored[monthKey] && stored[monthKey].days && stored[monthKey].days[d]) || '';
      const preview = buildNotesPreview(noteRaw);
      if(preview.text) { 
        cell.classList.add('has-note'); 
        noteP.textContent = preview.text.length>80? preview.text.slice(0,80)+'…':preview.text; 
        const bg = preview.color || '#ED468F';
        cell.style.background = `linear-gradient(135deg, ${bg}1f, #fff)`;
        cell.style.border = `1px solid ${bg}55`;
        if(preview.count>1){
          const badge = document.createElement('span');
          badge.className='note-count-badge';
          badge.textContent = `+${preview.count-1}`;
          cell.appendChild(badge);
        }
      }
      cell.appendChild(num); 
      cell.appendChild(noteP);
      cell.addEventListener('click', ()=> openXVCalNoteEditor(monthKey,d, noteRaw, render));
      calWrap.appendChild(cell);
    }
  }
  
  if(deleteBtn){
    deleteBtn.addEventListener('click', ()=>{
      if(!confirm('¿Eliminar todas las notas de este mes?')) return;
      const key = monthKeyFromDate(currentDate);
      const store = loadXVCalendar();
      if(store[key]){
        store[key].days = {};
        saveXVCalendar(store);
        render();
        alert('Notas del mes eliminadas');
      }
    });
  }

  // Copy/Paste buttons for XV calendar
  const copyBtn = document.getElementById('xv-cal-copy');
  if(copyBtn){
    copyBtn.addEventListener('click', ()=>{
      const key = monthKeyFromDate(currentDate);
      const store = loadXVCalendar();
      if(!store[key] || !store[key].days || Object.keys(store[key].days).length === 0){
        alert('No hay notas para copiar');
        return;
      }
      try{
        localStorage.setItem('rds_xv_calendar_clipboard', JSON.stringify(store[key].days));
        alert('📋 XV Calendario copiado');
      }catch(e){
        alert('Error al copiar');
      }
    });
  }

  const pasteBtn = document.getElementById('xv-cal-paste');
  if(pasteBtn){
    pasteBtn.addEventListener('click', ()=>{
      try{
        const clip = localStorage.getItem('rds_xv_calendar_clipboard');
        if(!clip){
          alert('No hay datos en portapapeles');
          return;
        }
        const data = JSON.parse(clip);
        const key = monthKeyFromDate(currentDate);
        const store = loadXVCalendar();
        store[key] = store[key] || {meta:{},days:{}};
        Object.keys(data).forEach(day=>{
          store[key].days[day] = data[day];
        });
        saveXVCalendar(store);
        render();
        alert('📥 Datos pegados');
      }catch(e){
        alert('Error al pegar');
      }
    });
  }

  const saveBtn = document.getElementById('xv-cal-save');
  if(saveBtn){
    saveBtn.addEventListener('click', ()=>{
      const store = loadXVCalendar();
      saveXVCalendar(store);
      alert('💾 Guardado');
    });
  }
  
  prevBtn.addEventListener('click', ()=>{
    currentDate.setMonth(currentDate.getMonth()-1);
    updateDisplayLabel(); 
    render();
    syncMonthContext();
  });
  
  nextBtn.addEventListener('click', ()=>{
    currentDate.setMonth(currentDate.getMonth()+1);
    updateDisplayLabel(); 
    render();
    syncMonthContext();
  });
  
  render();
  syncMonthContext();
}

function openXVCalNoteEditor(monthKey, day, currentNote, onClose){
  const notes = normalizeNotesArray(currentNote);
  const existing = document.querySelector('.modal-backdrop'); 
  if(existing) existing.remove();
  const backdrop = document.createElement('div'); 
  backdrop.className='modal-backdrop';
  const modal = document.createElement('div'); 
  modal.className='modal';
  modal.innerHTML = `
    <h3>Editar notas - Día ${day}</h3>
    <div id="xv-cal-note-list" style="display:flex;flex-direction:column;gap:8px;margin-bottom:12px"></div>
    <button id="xv-cal-note-add" class="btn btn-secondary" style="margin-bottom:8px">+ Agregar nota</button>
    
    <div style="border-top:1px solid #eee;padding-top:12px;margin-top:12px">
      <label style="font-weight:700;color:var(--pink);display:block;margin-bottom:8px">🔄 Duplicar notas seleccionadas a otros días:</label>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <input type="text" id="xv-cal-duplicate-days" class="input" placeholder="Ej: 10,15,20" style="flex:1;min-width:150px" />
        <button id="xv-cal-btn-duplicate" class="btn btn-secondary" style="font-size:12px">Duplicar</button>
      </div>
      <div style="font-size:11px;color:var(--muted);margin-top:4px">Ingresa los números de días separados por comas</div>
    </div>
    <div style="text-align:right;margin-top:10px">
      <button id="xv-cal-note-save" class="btn">Guardar</button>
      <button id="xv-cal-note-del" class="btn btn-secondary">Eliminar</button>
      <button id="xv-cal-note-close" class="btn btn-secondary">Cerrar</button>
    </div>
  `;
  backdrop.appendChild(modal); 
  document.body.appendChild(backdrop);
  
  const list = document.getElementById('xv-cal-note-list');

  function addRow(note){
    const n = normalizeNoteEntry(note || {text:'', color:'#ED468F', type:'', time:''});
    const row = document.createElement('div');
    row.className = 'note-row';
    row.innerHTML = `
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <label style="display:flex;align-items:center;gap:4px">
          <input type="checkbox" class="note-select" checked />
          <span style="font-size:12px;color:var(--muted)">Duplicar</span>
        </label>
        <label style="font-weight:700;color:var(--pink)">Tipo
          <select class="note-type input" style="margin-top:4px">
            <option value="">General</option>
            <option value="Pago" ${n.type==='Pago'?'selected':''}>Pago</option>
            <option value="Inscripción" ${n.type==='Inscripción'?'selected':''}>Inscripción</option>
            <option value="Ensayo" ${n.type==='Ensayo'?'selected':''}>Ensayo</option>
            <option value="Evento" ${n.type==='Evento'?'selected':''}>Evento</option>
            <option value="Renta" ${n.type==='Renta'?'selected':''}>Renta</option>
          </select>
        </label>
        <label style="font-weight:700;color:var(--pink)">Color
          <input type="color" class="note-color input" value="${n.color||'#ED468F'}" style="margin-top:4px;width:70px;height:38px;padding:0;border:none" />
        </label>
        <label style="font-weight:700;color:var(--pink)">Hora
          <input type="time" class="note-time input" value="${n.time||''}" style="margin-top:4px;width:100px" />
        </label>
        <button class="btn btn-secondary note-remove" type="button" style="margin-left:auto">🗑️</button>
      </div>
      <textarea class="note-text" style="width:100%;min-height:90px;padding:10px;border-radius:8px;border:1px solid #eee;margin-top:6px">${escapeHtml(n.text||'')}</textarea>
    `;
    row.querySelector('.note-remove').addEventListener('click', ()=> row.remove());
    list.appendChild(row);
  }

  if(notes.length){ notes.forEach(n=> addRow(n)); }
  else { addRow({text:'', color:'#ED468F', type:'', time:''}); }

  document.getElementById('xv-cal-note-add').addEventListener('click', ()=> addRow({text:'', color:'#ED468F', type:'', time:''}));
  
  document.getElementById('xv-cal-note-close').addEventListener('click', ()=>backdrop.remove());
  document.getElementById('xv-cal-note-del').addEventListener('click', ()=>{
    const store = loadXVCalendar(); 
    store[monthKey] = store[monthKey] || {meta:{},days:{}}; 
    delete store[monthKey].days[day]; 
    saveXVCalendar(store); 
    backdrop.remove(); 
    onClose && onClose();
  });
  document.getElementById('xv-cal-btn-duplicate').addEventListener('click', () => {
    const daysInput = document.getElementById('xv-cal-duplicate-days').value.trim();
    if(!daysInput){
      alert('Por favor ingresa los días a duplicar');
      return;
    }
    const targetDays = daysInput.split(',').map(d=> parseInt(d.trim())).filter(d=> !isNaN(d) && d > 0);
    if(targetDays.length === 0){
      alert('No se encontraron días válidos');
      return;
    }
    
    const rows = Array.from(list.querySelectorAll('.note-row'));
    const selectedNotes = rows.map(r=>{
      const isSelected = r.querySelector('.note-select')?.checked;
      if(!isSelected) return null;
      const text = (r.querySelector('.note-text')?.value || '').trim();
      if(!text) return null;
      const type = r.querySelector('.note-type')?.value || '';
      const color = (r.querySelector('.note-color')?.value) || colorForType(type) || '#ED468F';
      const time = r.querySelector('.note-time')?.value || '';
      return {text, color, type, time};
    }).filter(Boolean);
    
    if(selectedNotes.length === 0){
      alert('No hay notas seleccionadas para duplicar');
      return;
    }
    
    const store = loadXVCalendar();
    store[monthKey] = store[monthKey] || {meta:{},days:{}};
    
    targetDays.forEach(targetDay => {
      if(!store[monthKey].days[targetDay]){
        store[monthKey].days[targetDay] = [];
      }
      const existingNotes = normalizeNotesArray(store[monthKey].days[targetDay]);
      selectedNotes.forEach(note => {
        if(!existingNotes.find(e=> e.text === note.text && e.type === note.type && e.time === note.time)){
          existingNotes.push({...note});
        }
      });
      store[monthKey].days[targetDay] = existingNotes;
    });
    
    saveXVCalendar(store);
    onClose && onClose();
    alert(`✅ ${selectedNotes.length} nota(s) duplicadas a ${targetDays.length} día(s): ${targetDays.join(', ')}`);
  });
  document.getElementById('xv-cal-note-save').addEventListener('click', ()=>{
    const rows = Array.from(list.querySelectorAll('.note-row'));
    const newNotes = rows.map(r=>{
      const text = (r.querySelector('.note-text')?.value || '').trim();
      if(!text) return null;
      const type = r.querySelector('.note-type')?.value || '';
      const color = (r.querySelector('.note-color')?.value) || colorForType(type) || '#ED468F';
      const time = r.querySelector('.note-time')?.value || '';
      return {text, color, type, time};
    }).filter(Boolean);
    const store = loadXVCalendar(); 
    store[monthKey] = store[monthKey] || {meta:{},days:{}}; 
    if(newNotes.length){
      store[monthKey].days[day] = newNotes; 
    } else {
      delete store[monthKey].days[day];
    }
    saveXVCalendar(store); 
    backdrop.remove(); 
    onClose && onClose();
  });
}

// XV Debts
// Choreographies - complete implementation
function addChoreography(nombre, grupo, telefono, monto){
  const choreos = loadChoreographies();
  const id = `choreo-${Date.now()}`;
  choreos.push({
    id,
    nombre,
    grupo,
    telefono,
    monto,
    monthYear: getCurrentChoreoMonthKey(),
    coreografias: [],
    pagos: [],
    horarios: [],
    notasExtras: ''
  });
  saveChoreographies(choreos);
  return id;
}

function openAddChoreoModal(){
  const existing = document.querySelector('.modal-backdrop');
  if(existing) existing.remove();
  
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.style.maxWidth = '500px';
  
  modal.innerHTML = `
    <h3>✨ Agregar Coreografía</h3>
    <form id="add-choreo-form" style="margin-top:16px">
      <div style="margin-bottom:12px">
        <label style="display:block;margin-bottom:4px;font-weight:600">Nombre *</label>
        <input id="choreo-nombre" class="input" placeholder="Nombre del contacto" required />
      </div>
      
      <div style="margin-bottom:12px">
        <label style="display:block;margin-bottom:4px;font-weight:600">Grupo/Escuela</label>
        <input id="choreo-grupo" class="input" placeholder="Ej: Ballet Folklórico" />
      </div>
      
      <div style="margin-bottom:12px">
        <label style="display:block;margin-bottom:4px;font-weight:600">Teléfono</label>
        <input id="choreo-telefono" class="input" type="tel" placeholder="Ej: 123-456-7890" />
      </div>
      
      <div style="margin-bottom:12px">
        <label style="display:block;margin-bottom:4px;font-weight:600">Monto</label>
        <input id="choreo-monto" class="input" type="number" placeholder="0" min="0" step="0.01" />
      </div>
      
      <div style="text-align:right;margin-top:20px">
        <button type="button" id="choreo-cancel" class="btn btn-secondary">Cancelar</button>
        <button type="submit" class="btn" style="margin-left:8px">Guardar</button>
      </div>
    </form>
  `;
  
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);
  
  document.getElementById('choreo-cancel').addEventListener('click', ()=>backdrop.remove());
  document.getElementById('add-choreo-form').addEventListener('submit', (e)=>{
    e.preventDefault();
    const nombre = document.getElementById('choreo-nombre').value.trim();
    if(!nombre){ alert('El nombre es requerido'); return; }
    
    const grupo = document.getElementById('choreo-grupo').value.trim();
    const telefono = document.getElementById('choreo-telefono').value.trim();
    const monto = Number(document.getElementById('choreo-monto').value) || 0;
    
    addChoreography(nombre, grupo, telefono, monto);
    backdrop.remove();
    renderChoreographies();
  });
  
  // Focus on first input
  setTimeout(()=> document.getElementById('choreo-nombre').focus(), 100);
}

function deleteChoreography(id){
  const all = loadChoreographies();
  const toDelete = all.find(c => c.id === id);
  if(toDelete){ addArchiveEntry('Coreografía', toDelete.nombre || '', toDelete); }
  const choreos = all.filter(c => c.id !== id);
  saveChoreographies(choreos);
}

function updateChoreography(id, updates){
  const choreos = loadChoreographies();
  const choreo = choreos.find(c => c.id === id);
  if(choreo) Object.assign(choreo, updates);
  saveChoreographies(choreos);
}

function renderChoreographies(){
  const tbody = document.getElementById('choreo-tbody');
  if(!tbody) return;
  const searchInput = document.getElementById('choreo-search');
  const searchQuery = searchInput ? searchInput.value.toLowerCase().trim() : '';
  let choreos = loadChoreographies();
  const monthKey = getCurrentChoreoMonthKey();
  let changed = false;
  choreos.forEach(c=>{
    if(!c.monthYear){ c.monthYear = monthKey; changed = true; }
  });
  if(changed) saveChoreographies(choreos);
  choreos = choreos.filter(c=> c.monthYear === monthKey);
  
  // filter by search
  if(searchQuery){
    choreos = choreos.filter(c => c.nombre.toLowerCase().includes(searchQuery));
  }
  
  // sort alphabetically
  choreos.sort((a,b)=> a.nombre.localeCompare(b.nombre, 'es', {sensitivity:'base'}));
  
  tbody.innerHTML = '';
  choreos.forEach(c=>{
    const tr = document.createElement('tr');
    const coreografiasCount = (c.coreografias || []).length;
    tr.innerHTML = `
      <td><a href="#" class="choreo-link" data-id="${c.id}">${escapeHtml(c.nombre)}</a></td>
      <td>${escapeHtml(c.grupo||'')}</td>
      <td>${escapeHtml(c.telefono||'')}</td>
      <td>${coreografiasCount}</td>
      <td>$${escapeHtml(c.monto||0)}</td>
      <td style="white-space:nowrap">
        <button class="btn btn-secondary edit-choreo" data-id="${c.id}" style="padding:4px 6px;font-size:12px">Editar</button>
        <button class="btn delete-choreo" data-id="${c.id}" style="padding:4px 6px;font-size:12px">Eliminar</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
  
  // attach handlers
  document.querySelectorAll('.choreo-link').forEach(el=> el.addEventListener('click', e=>{
    e.preventDefault();
    openChoreoDetailModal(el.dataset.id);
  }));
  
  document.querySelectorAll('.edit-choreo').forEach(btn=> btn.addEventListener('click', e=>{
    const id = btn.dataset.id;
    const choreo = loadChoreographies().find(c => c.id === id);
    if(choreo) openChoreoEditModal(choreo);
  }));
  
  document.querySelectorAll('.delete-choreo').forEach(btn=> btn.addEventListener('click', e=>{
    if(confirm('Eliminar esta coreografía?')){
      deleteChoreography(btn.dataset.id);
      renderChoreographies();
    }
  }));
}

// Open Choreo Detail Modal
function openChoreoDetailModal(id){
  const choreo = loadChoreographies().find(c => c.id === id);
  if(!choreo) return alert('Coreografía no encontrada');
  
  const existing = document.querySelector('.modal-backdrop');
  if(existing) existing.remove();
  
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.style.maxWidth = '800px';
  
  modal.innerHTML = `
    <h3>${escapeHtml(choreo.nombre)} — Detalles</h3>
    
    <div class="tabs-fixed" style="margin:12px 0">
      <button class="tab active" data-tab="coreografias">💃 Coreografías</button>
      <button class="tab" data-tab="pagos">💰 Pagos</button>
      <button class="tab" data-tab="horarios">📅 Horarios</button>
      <button class="tab" data-tab="notas">📝 Notas</button>
    </div>
    
    <div id="choreo-detail-coreografias" class="tab-content">
      <h4>Coreografías</h4>
      <div id="coreografias-holder"></div>
      <button id="add-coreografia-row" class="btn btn-secondary" style="margin-top:8px">+ Agregar Coreografía</button>
    </div>
    
    <div id="choreo-detail-pagos" class="tab-content" style="display:none">
      <h4>Pagos</h4>
      <div id="choreo-pagos-holder"></div>
      <button id="add-choreo-pago-row" class="btn btn-secondary" style="margin-top:8px">+ Agregar Pago</button>
    </div>
    
    <div id="choreo-detail-horarios" class="tab-content" style="display:none">
      <h4>Horarios de Ensayo</h4>
      <div id="choreo-horarios-holder"></div>
      <button id="add-choreo-horario-row" class="btn btn-secondary" style="margin-top:8px">+ Agregar Horario</button>
    </div>
    
    <div id="choreo-detail-notas" class="tab-content" style="display:none">
      <h4>Notas Extras</h4>
      <textarea id="choreo-d-notas" class="input" style="min-height:120px;width:100%">${escapeHtml(choreo.notasExtras||'')}</textarea>
    </div>
    
    <div style="text-align:right;margin-top:12px">
      <button id="choreo-d-save" class="btn">Guardar Todo</button>
      <button id="choreo-d-close" class="btn btn-secondary">Cerrar</button>
    </div>
  `;
  
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);
  
  // Tab switching
  modal.querySelectorAll('.tab').forEach(tab=> tab.addEventListener('click', ()=>{
    modal.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
    tab.classList.add('active');
    modal.querySelectorAll('.tab-content').forEach(c=>c.style.display='none');
    const target = tab.dataset.tab;
    const content = modal.querySelector(`#choreo-detail-${target}`);
    if(content) content.style.display = 'block';
  }));
  
  // Render coreografias
  function renderCoreografias(){
    const holder = document.getElementById('coreografias-holder');
    holder.innerHTML = '';
    (choreo.coreografias || []).forEach((cor, idx)=>{
      const row = document.createElement('div');
      row.style.marginBottom = '10px';
      row.style.padding = '10px';
      row.style.border = '1px solid rgba(0,0,0,0.06)';
      row.style.borderRadius = '6px';
      row.innerHTML = `
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
          <input class="coreografia-nombre input" data-idx="${idx}" value="${escapeHtml(cor.nombre||'')}" placeholder="Coreografía 01" style="flex:1" />
          <button class="btn remove-coreografia" data-idx="${idx}">Eliminar</button>
        </div>
        <label>Canción:</label>
        <input class="coreografia-song input" data-idx="${idx}" value="${escapeHtml(cor.song||'')}" placeholder="Nombre de la canción" style="width:100%;margin-bottom:4px" />
        <label>Minutos:</label>
        <input class="coreografia-minutes input" data-idx="${idx}" value="${escapeHtml(cor.minutes||'')}" placeholder="Ej: 3:45" style="width:100%" />
      `;
      holder.appendChild(row);
    });
    
    holder.querySelectorAll('.remove-coreografia').forEach(btn=> btn.addEventListener('click', ()=>{
      const idx = Number(btn.dataset.idx);
      choreo.coreografias.splice(idx, 1);
      renderCoreografias();
    }));
  }
  renderCoreografias();
  
  document.getElementById('add-coreografia-row').addEventListener('click', ()=>{
    if(!choreo.coreografias) choreo.coreografias = [];
    choreo.coreografias.push({nombre:'', song:'', minutes:''});
    renderCoreografias();
  });
  
  // Render pagos
  function renderChoreoPagos(){
    const holder = document.getElementById('choreo-pagos-holder');
    holder.innerHTML = '';
    (choreo.pagos || []).forEach((p, idx)=>{
      const row = document.createElement('div');
      row.style.marginBottom = '8px';
      row.style.display = 'flex';
      row.style.gap = '8px';
      row.style.alignItems = 'center';
      row.innerHTML = `
        <input class="choreo-pago-monto input" data-idx="${idx}" type="number" placeholder="Monto" value="${escapeHtml(p.monto||0)}" style="width:110px" />
        <input class="choreo-pago-porcentaje input" data-idx="${idx}" placeholder="%" value="${escapeHtml(p.porcentaje||'')}" style="width:80px" />
        <input class="choreo-pago-fecha input" data-idx="${idx}" type="date" value="${escapeHtml(p.fecha||'')}" style="width:150px" />
        <label style="display:flex;align-items:center;gap:4px"><input type="checkbox" class="choreo-pago-paid" data-idx="${idx}" ${p.paid?'checked':''} /> Pagó</label>
        <button class="btn remove-choreo-pago" data-idx="${idx}">Eliminar</button>
      `;
      holder.appendChild(row);
    });
    
    holder.querySelectorAll('.remove-choreo-pago').forEach(btn=> btn.addEventListener('click', ()=>{
      const idx = Number(btn.dataset.idx);
      choreo.pagos.splice(idx, 1);
      renderChoreoPagos();
    }));
  }
  renderChoreoPagos();
  
  document.getElementById('add-choreo-pago-row').addEventListener('click', ()=>{
    if(!choreo.pagos) choreo.pagos = [];
    choreo.pagos.push({monto:0, porcentaje:'', fecha:'', paid:false});
    renderChoreoPagos();
  });
  
  // Render horarios
  function renderChoreoHorarios(){
    const holder = document.getElementById('choreo-horarios-holder');
    holder.innerHTML = '';
    (choreo.horarios || []).forEach((h, idx)=>{
      const row = document.createElement('div');
      row.style.marginBottom = '8px';
      row.style.display = 'flex';
      row.style.gap = '8px';
      row.style.alignItems = 'center';
      row.innerHTML = `
        <input class="choreo-horario-fecha input" data-idx="${idx}" type="date" value="${escapeHtml(h.fecha||'')}" style="width:150px" />
        <input class="choreo-horario-hora input" data-idx="${idx}" placeholder="Hora (Ej: 3:00 PM)" value="${escapeHtml(h.hora||'')}" style="flex:1" />
        <input class="choreo-horario-nota input" data-idx="${idx}" placeholder="Nota" value="${escapeHtml(h.nota||'')}" style="flex:1" />
        <button class="btn remove-choreo-horario" data-idx="${idx}">Eliminar</button>
      `;
      holder.appendChild(row);
    });
    
    holder.querySelectorAll('.remove-choreo-horario').forEach(btn=> btn.addEventListener('click', ()=>{
      const idx = Number(btn.dataset.idx);
      choreo.horarios.splice(idx, 1);
      renderChoreoHorarios();
    }));
  }
  renderChoreoHorarios();
  
  document.getElementById('add-choreo-horario-row').addEventListener('click', ()=>{
    if(!choreo.horarios) choreo.horarios = [];
    choreo.horarios.push({fecha:'', hora:'', nota:''});
    renderChoreoHorarios();
  });
  
  // Save all
  document.getElementById('choreo-d-save').addEventListener('click', ()=>{
    // coreografias
    choreo.coreografias = [];
    document.querySelectorAll('.coreografia-nombre').forEach(inp=>{
      const idx = Number(inp.dataset.idx);
      const nombre = inp.value;
      const song = document.querySelector(`.coreografia-song[data-idx="${idx}"]`)?.value || '';
      const minutes = document.querySelector(`.coreografia-minutes[data-idx="${idx}"]`)?.value || '';
      choreo.coreografias.push({nombre, song, minutes});
    });
    
    // pagos
    choreo.pagos = [];
    document.querySelectorAll('.choreo-pago-porcentaje').forEach(inp=>{
      const idx = Number(inp.dataset.idx);
      const porcentaje = inp.value;
      const monto = Number(document.querySelector(`.choreo-pago-monto[data-idx="${idx}"]`)?.value) || 0;
      const fecha = document.querySelector(`.choreo-pago-fecha[data-idx="${idx}"]`)?.value || '';
      const paid = document.querySelector(`.choreo-pago-paid[data-idx="${idx}"]`)?.checked || false;
      choreo.pagos.push({monto, porcentaje, fecha, paid});
    });
    
    // horarios
    choreo.horarios = [];
    document.querySelectorAll('.choreo-horario-fecha').forEach(inp=>{
      const idx = Number(inp.dataset.idx);
      const fecha = inp.value;
      const hora = document.querySelector(`.choreo-horario-hora[data-idx="${idx}"]`)?.value || '';
      const nota = document.querySelector(`.choreo-horario-nota[data-idx="${idx}"]`)?.value || '';
      if(fecha) choreo.horarios.push({fecha, hora, nota});
    });
    
    // sync horarios to Choreo calendar
    choreo.horarios.forEach(h=>{
      if(h.fecha){
        try{ addChoreoCalendarEvent(h.fecha, `Coreografía - ${choreo.nombre} (${choreo.grupo||''}) — ${h.hora} ${h.nota}`); }catch(e){}
      }
    });
    // sync pagos to Choreo calendar
    choreo.pagos.forEach(p=>{
      if(p.fecha){
        const pct = p.porcentaje ? ` ${p.porcentaje}%` : '';
        try{ addChoreoCalendarEvent(p.fecha, `Pago Coreografía - ${choreo.nombre} - $${p.monto||0}${pct}`); }catch(e){}
      }
    });
    
    // notas
    choreo.notasExtras = document.getElementById('choreo-d-notas').value;

    choreo.monthYear = getCurrentChoreoMonthKey();
    
    updateChoreography(choreo.id, choreo);
    try{ syncSimpleScheduleForChoreos(); }catch(e){}
    alert('Información guardada');
    backdrop.remove();
    renderChoreographies();
    renderChoreoPaymentsList(getCurrentChoreoMonthKey());
  });
  
  document.getElementById('choreo-d-close').addEventListener('click', ()=>backdrop.remove());
}

// Open Choreo Edit Modal (basic info)
function openChoreoEditModal(choreo){
  const existing = document.querySelector('.modal-backdrop');
  if(existing) existing.remove();
  
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  const modal = document.createElement('div');
  modal.className = 'modal';
  
  modal.innerHTML = `
    <h3>Editar Coreografía</h3>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div><label>Nombre</label><input id="choreo-e-nombre" class="input" value="${escapeHtml(choreo.nombre)}" /></div>
      <div><label>Grupo/Escuela</label><input id="choreo-e-grupo" class="input" value="${escapeHtml(choreo.grupo||'')}" /></div>
      <div><label>Teléfono</label><input id="choreo-e-telefono" class="input" value="${escapeHtml(choreo.telefono||'')}" /></div>
      <div><label>Monto</label><input id="choreo-e-monto" type="number" class="input" value="${escapeHtml(choreo.monto||0)}" /></div>
    </div>
    <div style="text-align:right;margin-top:12px">
      <button id="choreo-e-save" class="btn">Guardar</button>
      <button id="choreo-e-close" class="btn btn-secondary">Cerrar</button>
    </div>
  `;
  
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);
  
  document.getElementById('choreo-e-close').addEventListener('click', ()=>backdrop.remove());
  document.getElementById('choreo-e-save').addEventListener('click', ()=>{
    updateChoreography(choreo.id, {
      nombre: document.getElementById('choreo-e-nombre').value,
      grupo: document.getElementById('choreo-e-grupo').value,
      telefono: document.getElementById('choreo-e-telefono').value,
      monto: Number(document.getElementById('choreo-e-monto').value) || 0,
      monthYear: getCurrentChoreoMonthKey()
    });
    backdrop.remove();
    renderChoreographies();
  });
}

// Choreo Calendar helpers
function addChoreoCalendarEvent(dateString, text){
  if(!dateString) return;
  const m = dateString.match(/(\d{4})-(\d{2})-(\d{2})/);
  if(!m) return;
  const yyyy = m[1], mm = m[2], dd = String(parseInt(m[3],10));
  const key = `${yyyy}-${mm}`;
  const store = loadChoreoCalendar();
  store[key] = store[key] || {meta:{name:'',days:0,start:0}, days:{}};
  const prev = store[key].days[dd];
  const arr = normalizeNotesArray(prev);
  arr.push({text, color:'#ED468F', type:''});
  store[key].days[dd] = arr;
  saveChoreoCalendar(store);
}

// Init Choreo Calendar
function initChoreoCalendar(){
  const calWrap = document.getElementById('choreo-mini-calendar');
  if(!calWrap) return;
  const displayLabel = document.getElementById('choreo-cal-display-month');
  const deleteBtn = document.getElementById('choreo-cal-delete');
  const prevBtn = document.getElementById('choreo-cal-prev');
  const nextBtn = document.getElementById('choreo-cal-next');
  
  let currentDate = new Date(); currentDate.setDate(1);
  
  function monthKeyFromDate(d){
    const y = d.getFullYear(); const m = String(d.getMonth()+1).padStart(2,'0'); return `${y}-${m}`;
  }
  
  function updateDisplayLabel(){
    displayLabel.textContent = currentDate.toLocaleString('es-ES',{month:'long', year:'numeric'});
  }
  updateDisplayLabel();

  function syncMonthContext(){
    const key = monthKeyFromDate(currentDate);
    currentChoreoMonthKey = key;
    const notesTA = document.getElementById('choreo-notes');
    if(notesTA) notesTA.value = loadChoreoNotesForMonth(key);
    renderChoreographies();
    renderChoreoPaymentsList(key);
  }
  
  function render(){
    calWrap.innerHTML = '';
    const days = new Date(currentDate.getFullYear(), currentDate.getMonth()+1, 0).getDate();
    const start = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1).getDay();
    const dayNames = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
    dayNames.forEach(name=>{
      const h = document.createElement('div');
      h.className='weekday';
      h.textContent = name;
      calWrap.appendChild(h);
    });
    const leading = start;
    for(let i=0;i<leading;i++){
      const cell = document.createElement('div');
      cell.className='calendar-cell empty';
      calWrap.appendChild(cell);
    }
    for(let d=1; d<=days; d++){
      const cell = document.createElement('div'); 
      cell.className='calendar-cell';
      cell.dataset.day = d;
      const num = document.createElement('div'); 
      num.className='day-num'; 
      num.textContent = d;
      const noteP = document.createElement('div'); 
      noteP.className='note-preview';
      const monthKey = monthKeyFromDate(currentDate);
      const stored = loadChoreoCalendar();
      const noteRaw = (stored[monthKey] && stored[monthKey].days && stored[monthKey].days[d]) || '';
      const preview = buildNotesPreview(noteRaw);
      if(preview.text) { 
        cell.classList.add('has-note'); 
        noteP.textContent = preview.text.length>80? preview.text.slice(0,80)+'…':preview.text; 
        const bg = preview.color || '#ED468F';
        cell.style.background = `linear-gradient(135deg, ${bg}1f, #fff)`;
        cell.style.border = `1px solid ${bg}55`;
        if(preview.count>1){
          const badge = document.createElement('span');
          badge.className='note-count-badge';
          badge.textContent = `+${preview.count-1}`;
          cell.appendChild(badge);
        }
      }
      cell.appendChild(num); 
      cell.appendChild(noteP);
      cell.addEventListener('click', ()=> openChoreoCalNoteEditor(monthKey,d, noteRaw, render));
      calWrap.appendChild(cell);
    }
  }
  
  if(deleteBtn){
    deleteBtn.addEventListener('click', ()=>{
      if(!confirm('¿Eliminar todas las notas de este mes?')) return;
      const key = monthKeyFromDate(currentDate);
      const store = loadChoreoCalendar();
      if(store[key]){
        store[key].days = {};
        saveChoreoCalendar(store);
        render();
        alert('Notas del mes eliminadas');
      }
    });
  }

  // Copy/Paste buttons for Choreo calendar
  const copyBtn = document.getElementById('choreo-cal-copy');
  if(copyBtn){
    copyBtn.addEventListener('click', ()=>{
      const key = monthKeyFromDate(currentDate);
      const store = loadChoreoCalendar();
      if(!store[key] || !store[key].days || Object.keys(store[key].days).length === 0){
        alert('No hay notas para copiar');
        return;
      }
      try{
        localStorage.setItem('rds_choreo_calendar_clipboard', JSON.stringify(store[key].days));
        alert('📋 Choreo Calendario copiado');
      }catch(e){
        alert('Error al copiar');
      }
    });
  }

  const pasteBtn = document.getElementById('choreo-cal-paste');
  if(pasteBtn){
    pasteBtn.addEventListener('click', ()=>{
      try{
        const clip = localStorage.getItem('rds_choreo_calendar_clipboard');
        if(!clip){
          alert('No hay datos en portapapeles');
          return;
        }
        const data = JSON.parse(clip);
        const key = monthKeyFromDate(currentDate);
        const store = loadChoreoCalendar();
        store[key] = store[key] || {meta:{},days:{}};
        Object.keys(data).forEach(day=>{
          store[key].days[day] = data[day];
        });
        saveChoreoCalendar(store);
        render();
        alert('📥 Datos pegados');
      }catch(e){
        alert('Error al pegar');
      }
    });
  }

  const saveBtn = document.getElementById('choreo-cal-save');
  if(saveBtn){
    saveBtn.addEventListener('click', ()=>{
      const store = loadChoreoCalendar();
      saveChoreoCalendar(store);
      alert('💾 Guardado');
    });
  }
  
  prevBtn.addEventListener('click', ()=>{
    currentDate.setMonth(currentDate.getMonth()-1);
    updateDisplayLabel(); 
    render();
    syncMonthContext();
  });
  
  nextBtn.addEventListener('click', ()=>{
    currentDate.setMonth(currentDate.getMonth()+1);
    updateDisplayLabel(); 
    render();
    syncMonthContext();
  });
  
  render();
  syncMonthContext();
}

function renderXVPaymentsList(monthKey){
  const tbody = document.getElementById('xv-payments-tbody');
  const label = document.getElementById('xv-payments-month-label');
  if(!tbody) return;
  if(label) label.textContent = monthKey || '—';
  const xvs = loadXVQuinceaneras().filter(x=> !monthKey || x.monthYear === monthKey);
  const rows = [];
  xvs.forEach(x=>{
    (x.pagos||[]).forEach(p=>{
      if(monthKey && p.fecha && !p.fecha.startsWith(monthKey)) return;
      rows.push({
        date: p.fecha || '',
        name: x.nombre || '',
        amount: p.monto || 0,
        percent: p.porcentaje || '',
        paid: !!p.paid
      });
    });
  });
  tbody.innerHTML = '';
  if(rows.length === 0){
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 5;
    td.style.textAlign = 'center';
    td.style.color = 'var(--muted)';
    td.style.padding = '12px';
    td.textContent = 'No hay pagos registrados en este mes.';
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }
  rows.sort((a,b)=> String(b.date||'').localeCompare(String(a.date||'')));
  rows.forEach(r=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(r.date)}</td>
      <td>${escapeHtml(r.name)}</td>
      <td>$${escapeHtml(r.amount)}</td>
      <td>${escapeHtml(r.percent)}</td>
      <td>${r.paid? 'Sí':'No'}</td>
    `;
    tbody.appendChild(tr);
  });
}

function renderChoreoPaymentsList(monthKey){
  const tbody = document.getElementById('choreo-payments-tbody');
  const label = document.getElementById('choreo-payments-month-label');
  if(!tbody) return;
  if(label) label.textContent = monthKey || '—';
  const choreos = loadChoreographies().filter(c=> !monthKey || c.monthYear === monthKey);
  const rows = [];
  choreos.forEach(c=>{
    (c.pagos||[]).forEach(p=>{
      if(monthKey && p.fecha && !p.fecha.startsWith(monthKey)) return;
      rows.push({
        date: p.fecha || '',
        name: c.nombre || '',
        amount: p.monto || 0,
        percent: p.porcentaje || '',
        paid: !!p.paid
      });
    });
  });
  tbody.innerHTML = '';
  if(rows.length === 0){
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 5;
    td.style.textAlign = 'center';
    td.style.color = 'var(--muted)';
    td.style.padding = '12px';
    td.textContent = 'No hay pagos registrados en este mes.';
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }
  rows.sort((a,b)=> String(b.date||'').localeCompare(String(a.date||'')));
  rows.forEach(r=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(r.date)}</td>
      <td>${escapeHtml(r.name)}</td>
      <td>$${escapeHtml(r.amount)}</td>
      <td>${escapeHtml(r.percent)}</td>
      <td>${r.paid? 'Sí':'No'}</td>
    `;
    tbody.appendChild(tr);
  });
}

function openChoreoCalNoteEditor(monthKey, day, currentNote, onClose){
  const notes = normalizeNotesArray(currentNote);
  const existing = document.querySelector('.modal-backdrop'); 
  if(existing) existing.remove();
  const backdrop = document.createElement('div'); 
  backdrop.className='modal-backdrop';
  const modal = document.createElement('div'); 
  modal.className='modal';
  modal.innerHTML = `
    <h3>Editar notas - Día ${day}</h3>
    <div id="choreo-cal-note-list" style="display:flex;flex-direction:column;gap:8px;margin-bottom:12px"></div>
    <button id="choreo-cal-note-add" class="btn btn-secondary" style="margin-bottom:8px">+ Agregar nota</button>
    
    <div style="border-top:1px solid #eee;padding-top:12px;margin-top:12px">
      <label style="font-weight:700;color:var(--pink);display:block;margin-bottom:8px">🔄 Duplicar notas seleccionadas a otros días:</label>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <input type="text" id="choreo-cal-duplicate-days" class="input" placeholder="Ej: 10,15,20" style="flex:1;min-width:150px" />
        <button id="choreo-cal-btn-duplicate" class="btn btn-secondary" style="font-size:12px">Duplicar</button>
      </div>
      <div style="font-size:11px;color:var(--muted);margin-top:4px">Ingresa los números de días separados por comas</div>
    </div>
    <div style="text-align:right;margin-top:10px">
      <button id="choreo-cal-note-save" class="btn">Guardar</button>
      <button id="choreo-cal-note-del" class="btn btn-secondary">Eliminar</button>
      <button id="choreo-cal-note-close" class="btn btn-secondary">Cerrar</button>
    </div>
  `;
  backdrop.appendChild(modal); 
  document.body.appendChild(backdrop);
  
  const list = document.getElementById('choreo-cal-note-list');

  function addRow(note){
    const n = normalizeNoteEntry(note || {text:'', color:'#ED468F', type:'', time:''});
    const row = document.createElement('div');
    row.className = 'note-row';
    row.innerHTML = `
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <label style="display:flex;align-items:center;gap:4px">
          <input type="checkbox" class="note-select" checked />
          <span style="font-size:12px;color:var(--muted)">Duplicar</span>
        </label>
        <label style="font-weight:700;color:var(--pink)">Tipo
          <select class="note-type input" style="margin-top:4px">
            <option value="">General</option>
            <option value="Pago" ${n.type==='Pago'?'selected':''}>Pago</option>
            <option value="Inscripción" ${n.type==='Inscripción'?'selected':''}>Inscripción</option>
            <option value="Ensayo" ${n.type==='Ensayo'?'selected':''}>Ensayo</option>
            <option value="Evento" ${n.type==='Evento'?'selected':''}>Evento</option>
            <option value="Renta" ${n.type==='Renta'?'selected':''}>Renta</option>
          </select>
        </label>
        <label style="font-weight:700;color:var(--pink)">Color
          <input type="color" class="note-color input" value="${n.color||'#ED468F'}" style="margin-top:4px;width:70px;height:38px;padding:0;border:none" />
        </label>
        <label style="font-weight:700;color:var(--pink)">Hora
          <input type="time" class="note-time input" value="${n.time||''}" style="margin-top:4px;width:100px" />
        </label>
        <button class="btn btn-secondary note-remove" type="button" style="margin-left:auto">🗑️</button>
      </div>
      <textarea class="note-text" style="width:100%;min-height:90px;padding:10px;border-radius:8px;border:1px solid #eee;margin-top:6px">${escapeHtml(n.text||'')}</textarea>
    `;
    row.querySelector('.note-remove').addEventListener('click', ()=> row.remove());
    list.appendChild(row);
  }

  if(notes.length){ notes.forEach(n=> addRow(n)); }
  else { addRow({text:'', color:'#ED468F', type:'', time:''}); }

  document.getElementById('choreo-cal-note-add').addEventListener('click', ()=> addRow({text:'', color:'#ED468F', type:'', time:''}));
  
  document.getElementById('choreo-cal-note-close').addEventListener('click', ()=>backdrop.remove());
  document.getElementById('choreo-cal-note-del').addEventListener('click', ()=>{
    const store = loadChoreoCalendar(); 
    store[monthKey] = store[monthKey] || {meta:{},days:{}}; 
    delete store[monthKey].days[day]; 
    saveChoreoCalendar(store); 
    backdrop.remove(); 
    onClose && onClose();
  });
  document.getElementById('choreo-cal-btn-duplicate').addEventListener('click', () => {
    const daysInput = document.getElementById('choreo-cal-duplicate-days').value.trim();
    if(!daysInput){
      alert('Por favor ingresa los días a duplicar');
      return;
    }
    const targetDays = daysInput.split(',').map(d=> parseInt(d.trim())).filter(d=> !isNaN(d) && d > 0);
    if(targetDays.length === 0){
      alert('No se encontraron días válidos');
      return;
    }
    
    const rows = Array.from(list.querySelectorAll('.note-row'));
    const selectedNotes = rows.map(r=>{
      const isSelected = r.querySelector('.note-select')?.checked;
      if(!isSelected) return null;
      const text = (r.querySelector('.note-text')?.value || '').trim();
      if(!text) return null;
      const type = r.querySelector('.note-type')?.value || '';
      const color = (r.querySelector('.note-color')?.value) || colorForType(type) || '#ED468F';
      const time = r.querySelector('.note-time')?.value || '';
      return {text, color, type, time};
    }).filter(Boolean);
    
    if(selectedNotes.length === 0){
      alert('No hay notas seleccionadas para duplicar');
      return;
    }
    
    const store = loadChoreoCalendar();
    store[monthKey] = store[monthKey] || {meta:{},days:{}};
    
    targetDays.forEach(targetDay => {
      if(!store[monthKey].days[targetDay]){
        store[monthKey].days[targetDay] = [];
      }
      const existingNotes = normalizeNotesArray(store[monthKey].days[targetDay]);
      selectedNotes.forEach(note => {
        if(!existingNotes.find(e=> e.text === note.text && e.type === note.type && e.time === note.time)){
          existingNotes.push({...note});
        }
      });
      store[monthKey].days[targetDay] = existingNotes;
    });
    
    saveChoreoCalendar(store);
    onClose && onClose();
    alert(`✅ ${selectedNotes.length} nota(s) duplicadas a ${targetDays.length} día(s): ${targetDays.join(', ')}`);
  });
  document.getElementById('choreo-cal-note-save').addEventListener('click', ()=>{
    const rows = Array.from(list.querySelectorAll('.note-row'));
    const newNotes = rows.map(r=>{
      const text = (r.querySelector('.note-text')?.value || '').trim();
      if(!text) return null;
      const type = r.querySelector('.note-type')?.value || '';
      const color = (r.querySelector('.note-color')?.value) || colorForType(type) || '#ED468F';
      const time = r.querySelector('.note-time')?.value || '';
      return {text, color, type, time};
    }).filter(Boolean);
    const store = loadChoreoCalendar(); 
    store[monthKey] = store[monthKey] || {meta:{},days:{}}; 
    if(newNotes.length){
      store[monthKey].days[day] = newNotes; 
    } else {
      delete store[monthKey].days[day];
    }
    saveChoreoCalendar(store); 
    backdrop.remove(); 
    onClose && onClose();
  });
}

// Choreo Debts
// Package Manager
function openPackageManager(){
  const existing = document.querySelector('.modal-backdrop');
  if(existing) existing.remove();
  
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  const modal = document.createElement('div');
  modal.className = 'modal';
  
  modal.innerHTML = `
    <h3>Gestionar Paquetes</h3>
    <div style="margin-top:8px">
      <input id="new-package-input" class="input" placeholder="Nuevo paquete" />
      <button id="new-package-add" class="btn btn-secondary" style="margin-left:8px">Agregar</button>
    </div>
    <div style="margin-top:12px;font-size:13px;color:var(--muted)">Lista de paquetes (se ordena de arriba hacia abajo)</div>
    <div id="package-list" style="margin-top:12px;max-height:300px;overflow:auto"></div>
    <div style="text-align:right;margin-top:12px">
      <button id="package-close" class="btn btn-secondary">Cerrar</button>
    </div>
  `;
  
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);
  
  const listEl = document.getElementById('package-list');
  function renderList(){
    listEl.innerHTML = '';
    const packages = loadPackages();
    packages.forEach((p, idx)=>{
      const item = document.createElement('div');
      item.style.display = 'flex';
      item.style.justifyContent = 'space-between';
      item.style.alignItems = 'center';
      item.style.padding = '8px';
      item.style.borderBottom = '1px solid rgba(0,0,0,0.04)';
      item.innerHTML = `
        <div>
          <button class="btn btn-secondary pkg-name" data-idx="${idx}" style="padding:6px 10px;font-size:12px">${escapeHtml(p.name)}</button>
          <div style="font-size:12px;color:var(--muted);margin-top:4px">
            ${p.cost ? `Costo: $${escapeHtml(p.cost)}` : 'Costo: —'}
          </div>
          <div class="pkg-details" data-idx="${idx}" style="display:none;margin-top:8px">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
              <div>
                <label>Nombre</label>
                <input class="input pkg-edit-name" value="${escapeHtml(p.name)}" />
              </div>
              <div>
                <label>Costo</label>
                <input type="number" class="input pkg-edit-cost" placeholder="0" value="${escapeHtml(p.cost||'')}" />
              </div>
            </div>
            <div style="margin-top:8px">
              <label>Incluye</label>
              <textarea class="input pkg-edit-includes" style="min-height:90px" placeholder="Escribe lo que incluye el paquete...">${escapeHtml(p.includes||'')}</textarea>
            </div>
            <div style="text-align:right;margin-top:8px">
              <button class="btn pkg-save-details" data-idx="${idx}">Guardar detalles</button>
            </div>
          </div>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-secondary" data-idx="${idx}" data-action="rename">Renombrar</button>
          <button class="btn" data-idx="${idx}" data-action="delete">Eliminar</button>
        </div>
      `;
      listEl.appendChild(item);
    });
    
    // attach actions
    listEl.querySelectorAll('button').forEach(b=> b.addEventListener('click', e=>{
      if(b.classList.contains('pkg-name')){
        const details = listEl.querySelector(`.pkg-details[data-idx="${b.dataset.idx}"]`);
        if(details) details.style.display = details.style.display === 'none' ? 'block' : 'none';
        return;
      }
      if(b.classList.contains('pkg-save-details')){
        const idx = Number(b.dataset.idx);
        const wrap = listEl.querySelector(`.pkg-details[data-idx="${idx}"]`);
        if(!wrap) return;
        const name = wrap.querySelector('.pkg-edit-name')?.value.trim() || '';
        if(!name){ alert('El nombre es requerido'); return; }
        const cost = wrap.querySelector('.pkg-edit-cost')?.value.trim() || '';
        const includes = wrap.querySelector('.pkg-edit-includes')?.value.trim() || '';
        const packages = loadPackages();
        packages[idx] = {name, cost, includes};
        savePackages(packages);
        renderList();
        return;
      }
      const idx = Number(b.dataset.idx);
      const action = b.dataset.action;
      if(action==='rename'){
        const newName = prompt('Nuevo nombre para el paquete', packages[idx]?.name || '');
        if(newName && newName.trim()){
          packages[idx].name = newName.trim();
          savePackages(packages);
          renderList();
        }
      } else if(action==='delete'){
        if(!confirm('Eliminar paquete?')) return;
        packages.splice(idx,1);
        savePackages(packages);
        renderList();
      }
    }));
  }
  
  document.getElementById('new-package-add').addEventListener('click', ()=>{
    const v = document.getElementById('new-package-input').value.trim();
    if(!v) return;
    const packages = loadPackages();
    packages.push({name:v, cost:'', includes:''});
    savePackages(packages);
    document.getElementById('new-package-input').value='';
    renderList();
  });
  
  document.getElementById('package-close').addEventListener('click', ()=>backdrop.remove());
  
  renderList();
}

// Main init for Montajes page
function initMontajesPage(){
  const backBtn = document.getElementById('montajes-back');
  if(!backBtn) return; // not on montajes page
  
  backBtn.addEventListener('click', ()=>{ 
    try{ history.back(); }catch(e){ location.href = '../index.html'; } 
  });
  
  // tabs
  const tabs = document.querySelectorAll('#montajes-tabs .tab');
  const xvSection = document.getElementById('xv-section');
  const choreoSection = document.getElementById('choreo-section');
  
  tabs.forEach(tab=> tab.addEventListener('click', ()=>{
    tabs.forEach(t=>t.classList.remove('active'));
    tab.classList.add('active');
    const type = tab.dataset.type;
    if(type === 'xv'){
      xvSection.style.display = 'block';
      choreoSection.style.display = 'none';
    } else {
      xvSection.style.display = 'none';
      choreoSection.style.display = 'block';
    }
  }));
  
  // ======== XV SECTION ========
  
  // Package Manager
  const managePkgBtn = document.getElementById('manage-packages-btn');
  if(managePkgBtn){
    managePkgBtn.addEventListener('click', ()=>{
      openPackageManager();
    });
  }
  
  // XV Sort
  const sortBySelect = document.getElementById('xv-sort-by');
  if(sortBySelect){
    sortBySelect.addEventListener('change', ()=> renderXVTable());
  }
  
  // XV search
  const searchInput = document.getElementById('xv-search');
  if(searchInput){
    searchInput.addEventListener('input', ()=> renderXVTable());
  }
  
  // Add XV button
  const addXVBtn = document.getElementById('add-xv-btn');
  if(addXVBtn){
    addXVBtn.addEventListener('click', ()=>{
      openAddXVModal();
    });
  }
  
  // Init XV calendar
  initXVCalendar();
  
  // XV Notes
  const notesTA = document.getElementById('xv-notes');
  const saveNotesBtn = document.getElementById('save-xv-notes-btn');
  if(saveNotesBtn){
    saveNotesBtn.addEventListener('click', ()=>{
      saveXVNotesForMonth(getCurrentXVMonthKey(), notesTA.value);
      alert('Notas guardadas');
    });
  }
  
  // XV Debts
  renderXVTable();
  renderXVPaymentsList(getCurrentXVMonthKey());
  
  // ======== CHOREOGRAPHIES SECTION ========
  
  // Choreo search
  const choreoSearchInput = document.getElementById('choreo-search');
  if(choreoSearchInput){
    choreoSearchInput.addEventListener('input', ()=> renderChoreographies());
  }
  
  // Add Choreo button
  const addChoreoBtn = document.getElementById('add-choreo-btn');
  if(addChoreoBtn){
    addChoreoBtn.addEventListener('click', ()=>{
      openAddChoreoModal();
    });
  }
  
  // Init Choreo Calendar
  initChoreoCalendar();
  
  // Choreo Notes
  const choreoNotesTA = document.getElementById('choreo-notes');
  const saveChoreoNotesBtn = document.getElementById('save-choreo-notes-btn');
  if(saveChoreoNotesBtn){
    saveChoreoNotesBtn.addEventListener('click', ()=>{
      saveChoreoNotesForMonth(getCurrentChoreoMonthKey(), choreoNotesTA.value);
      alert('Notas guardadas');
    });
  }
  
  // Choreo Debts
  renderChoreographies();
  renderChoreoPaymentsList(getCurrentChoreoMonthKey());
}

/* ========================================
   PÁGINA 5: CALENDARIO GENERAL
   ======================================== */

// Main calendar storage
const MAIN_CAL_KEY = 'rds_main_calendar_v1';
const WEEKLY_CLIP_KEY = 'rds_weekly_clipboard_v1';

// Global function to refresh weekly schedule from any page
window.refreshWeeklySchedule = function(){
  if(typeof renderWeeklySchedule === 'function'){
    renderWeeklySchedule();
  }
};

// Global function to sync schedules to main calendar
window.syncSchedulesToCalendar = function(){
  try {
    const store = loadMainCalendar();
    const currentMonth = new Date();
    const key = `${currentMonth.getFullYear()}_${currentMonth.getMonth()}`;
    
    if(!store[key]){
      store[key] = {
        name: `${['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'][currentMonth.getMonth()]} ${currentMonth.getFullYear()}`,
        days: new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0).getDate(),
        startDay: new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1).getDay(),
        dayNotes: {}
      };
    }
    
    // Get all schedules and add to calendar notes
    const students = loadStudents();
    const rentals = loadRentals();
    const xvList = loadXV();
    const choreoList = loadChoreographies();
    
    // Clear auto-generated notes (keep manual notes)
    // We'll prefix auto-notes with markers to identify them
    
    saveMainCalendar(store);
  } catch(e) {
    console.error('Error syncing to calendar:', e);
  }
};

// Weekly schedules storage (global, used by calendario page)
const WEEKLY_SCHEDULES_KEY = 'rds_weekly_schedules_v1';

function loadWeeklySchedules(){
  try {
    const raw = localStorage.getItem(WEEKLY_SCHEDULES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch(e) {
    console.error('Error loading weekly schedules:', e);
    return [];
  }
}

function saveWeeklySchedules(schedules){
  try {
    localStorage.setItem(WEEKLY_SCHEDULES_KEY, JSON.stringify(schedules));
  } catch(e) {
    console.error('Error saving weekly schedules:', e);
  }
}

function loadMainCalendar(){
  const raw = localStorage.getItem(MAIN_CAL_KEY);
  return raw ? JSON.parse(raw) : {};
}

function saveMainCalendar(store){
  localStorage.setItem(MAIN_CAL_KEY, JSON.stringify(store));
}

function mainMonthKeyFromDate(d){
  return `${d.getFullYear()}_${d.getMonth()}`;
}

function initCalendarioPage(){
  let currentDate = new Date();
  
  const displayMonth = document.getElementById('main-cal-display-month');
  const daysInput = document.getElementById('main-cal-days');
  const startSelect = document.getElementById('main-cal-start');
  const prevBtn = document.getElementById('main-cal-prev');
  const nextBtn = document.getElementById('main-cal-next');
  const updateBtn = document.getElementById('main-cal-update');
  const deleteBtn = document.getElementById('main-cal-delete');
  const grid = document.getElementById('main-calendar-grid');
  
  if(!grid) return;
  
  function render(){
    const key = mainMonthKeyFromDate(currentDate);
    const store = loadMainCalendar();
    const monthData = store[key] || {
      name: `${['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'][currentDate.getMonth()]} ${currentDate.getFullYear()}`,
      days: 30,
      startDay: 0,
      dayNotes: {}
    };
    
    if(displayMonth) displayMonth.textContent = monthData.name;
    if(daysInput) daysInput.value = monthData.days;
    if(startSelect) startSelect.value = monthData.startDay;
    
    // Render calendar grid
    grid.innerHTML = '';
    const totalDays = parseInt(monthData.days || 30);
    const startDay = parseInt(monthData.startDay || 0);
    
    // Empty cells before first day
    for(let i=0; i<startDay; i++){
      const emptyCell = document.createElement('div');
      emptyCell.className = 'calendar-cell';
      grid.appendChild(emptyCell);
    }
    
    // Day cells
    for(let d=1; d<=totalDays; d++){
      const cell = document.createElement('div');
      cell.className = 'calendar-cell';
      
      const dayNum = document.createElement('div');
      dayNum.className = 'day-num';
      dayNum.textContent = d;
      cell.appendChild(dayNum);
      
      // Get notes array from main calendar (now supports multiple notes)
      const dayNotes = monthData.dayNotes[d] || [];
      const notesArray = Array.isArray(dayNotes) ? dayNotes : (dayNotes ? [dayNotes] : []);
      
      if(notesArray.length > 0){
        cell.classList.add('has-note');
        notesArray.forEach((note, idx) => {
          if(note && note.trim()){
            const preview = document.createElement('div');
            preview.className = 'note-preview';
            preview.textContent = note;
            preview.style.marginBottom = '4px';
            cell.appendChild(preview);
          }
        });
      }
      
      // Click to edit - open modal with multiple notes
      cell.addEventListener('click', ()=>{
        openCalendarDayModal(d, key, monthData);
      });
      
      grid.appendChild(cell);
    }
  }
  
  // Navigation
  if(prevBtn){
    prevBtn.addEventListener('click', ()=>{
      currentDate.setMonth(currentDate.getMonth() - 1);
      render();
    });
  }
  if(nextBtn){
    nextBtn.addEventListener('click', ()=>{
      currentDate.setMonth(currentDate.getMonth() + 1);
      render();
    });
  }
  
  // Update button - only updates config, not notes
  if(updateBtn){
    updateBtn.addEventListener('click', ()=>{
      const key = mainMonthKeyFromDate(currentDate);
      const store = loadMainCalendar();
      const existing = store[key] || {};
      store[key] = {
        ...existing,
        name: `${['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'][currentDate.getMonth()]} ${currentDate.getFullYear()}`,
        days: parseInt(daysInput.value || 30),
        startDay: parseInt(startSelect.value || 0)
      };
      saveMainCalendar(store);
      render();
      alert('Calendario actualizado');
    });
  }
  
  // Delete button - clears all notes for month
  if(deleteBtn){
    deleteBtn.addEventListener('click', ()=>{
      if(!confirm('¿Eliminar todas las notas de este mes?')) return;
      const key = mainMonthKeyFromDate(currentDate);
      const store = loadMainCalendar();
      if(store[key]){
        store[key].dayNotes = {};
        saveMainCalendar(store);
        render();
        renderWeeklySchedule();
        alert('Notas del mes eliminadas');
      }
    });
  }
  
  // Weekly Schedule Grid
  function renderWeeklySchedule(){
    console.log('=== INICIO renderWeeklySchedule ===');
    try {
      const tbody = document.getElementById('weekly-schedule-grid-tbody');
      console.log('tbody encontrado:', tbody ? 'SÍ' : 'NO');
      if(!tbody) {
        console.error('ERROR: No se encontró el tbody con id "weekly-schedule-grid-tbody"');
        return;
      }
    
    // Generate time slots (6 AM to 10 PM)
    const timeSlots = [];
    for(let h = 6; h <= 22; h++){
      const hour12 = h > 12 ? h - 12 : h;
      const ampm = h >= 12 ? 'pm' : 'am';
      timeSlots.push({
        hour24: h,
        display: `${hour12}:00 ${ampm}`,
        key: `${h}:00`
      });
    }
    
    // Collect all schedules from different sources
    const allSchedules = [];
    
    // Manual schedules
    const manualSchedules = loadWeeklySchedules();
    console.log('Horarios manuales cargados:', manualSchedules);
    allSchedules.push(...manualSchedules);
    
    // Get alumnas schedules
    const students = loadStudents();
    students.forEach(s => {
      if(s.disciplines && s.disciplines.length > 0){
        s.disciplines.forEach(d => {
          if(d.schedule && d.schedule.trim()){
            const day = extractDay(d.schedule);
            const time = extractTime(d.schedule);
            const hour = extractHour24(time);
            if(day && hour !== null){
              allSchedules.push({
                id: `auto-student-${s.id}-${d.name}`,
                day: day,
                hour: hour,
                activity: d.name,
                type: 'Alumnas',
                contact: s.name,
                typeClass: 'type-alumnas',
                auto: true
              });
            }
          }
        });
      }
    });
    
    // Get rentas schedules
    const rentals = loadRentals();
    rentals.forEach(r => {
      if(r.schedules && r.schedules.length > 0){
        r.schedules.forEach(sch => {
          const parts = sch.split(' - ');
          const day = parts[0] || '';
          const time = parts[1] || '';
          const hour = extractHour24(time);
          if(day && hour !== null){
            allSchedules.push({
              id: `auto-rental-${r.id}-${sch}`,
              day: day,
              hour: hour,
              activity: 'Renta de Sala',
              type: 'Rentas',
              contact: r.name,
              typeClass: 'type-rentas',
              auto: true
            });
          }
        });
      }
    });
    
    // Get XV schedules
    const xvList = loadXV();
    xvList.forEach(xv => {
      if(xv.horarios && xv.horarios.length > 0){
        xv.horarios.forEach(h => {
          if(typeof h === 'string'){
            const day = extractDay(h);
            const time = extractTime(h);
            const hour = extractHour24(time);
            if(day && hour !== null){
              allSchedules.push({
                id: `auto-xv-${xv.id}-${day}-${hour}`,
                day: day,
                hour: hour,
                activity: 'XV Años',
                type: 'XV Años',
                contact: xv.nombre || xv.name,
                typeClass: 'type-xv',
                auto: true
              });
            }
          } else if(h && typeof h === 'object') {
            const fecha = h.fecha || h.date;
            const horaTxt = h.hora || h.time || '';
            if(fecha && horaTxt){
              const dt = new Date(fecha);
              if(!isNaN(dt.getTime())){
                const weekday = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'][dt.getDay()];
                const hour = extractHour24(horaTxt);
                if(weekday && hour !== null){
                  allSchedules.push({
                    id: `auto-xv-${xv.id}-${weekday}-${hour}`,
                    day: weekday,
                    hour: hour,
                    activity: 'XV Años',
                    type: 'XV Años',
                    contact: xv.nombre || xv.name,
                    typeClass: 'type-xv',
                    auto: true
                  });
                }
              }
            }
          }
        });
      }
    });
    
    // Get Choreo schedules
    const choreoList = loadChoreographies();
    choreoList.forEach(c => {
      if(c.horarios && c.horarios.length > 0){
        c.horarios.forEach(h => {
          if(typeof h === 'string'){
            const day = extractDay(h);
            const time = extractTime(h);
            const hour = extractHour24(time);
            if(day && hour !== null){
              allSchedules.push({
                id: `auto-choreo-${c.id}-${day}-${hour}`,
                day: day,
                hour: hour,
                activity: 'Coreografía',
                type: 'Coreografía',
                contact: c.nombre || c.name,
                typeClass: 'type-choreo',
                auto: true
              });
            }
          } else if(h && typeof h === 'object') {
            const fecha = h.fecha || h.date;
            const horaTxt = h.hora || h.time || '';
            if(fecha && horaTxt){
              const dt = new Date(fecha);
              if(!isNaN(dt.getTime())){
                const weekday = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'][dt.getDay()];
                const hour = extractHour24(horaTxt);
                if(weekday && hour !== null){
                  allSchedules.push({
                    id: `auto-choreo-${c.id}-${weekday}-${hour}`,
                    day: weekday,
                    hour: hour,
                    activity: 'Coreografía',
                    type: 'Coreografía',
                    contact: c.nombre || c.name,
                    typeClass: 'type-choreo',
                    auto: true
                  });
                }
              }
            }
          }
        });
      }
    });
    
    // Render grid
    tbody.innerHTML = '';
    console.log('Renderizando tabla con', allSchedules.length, 'horarios totales');
    
    timeSlots.forEach(slot => {
      const tr = document.createElement('tr');
      const hourCell = document.createElement('td');
      hourCell.textContent = slot.display;
      tr.appendChild(hourCell);
      
      // Create cells for each day
      const days = ['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'];
      days.forEach(day => {
        const td = document.createElement('td');
        
        // Find schedules for this day and hour
        const daySchedules = allSchedules.filter(s => 
          s.day.toLowerCase() === day.toLowerCase() && s.hour === slot.hour24
        );
        
        if(daySchedules.length > 0){
          console.log(`${day} ${slot.display}:`, daySchedules.length, 'horarios');
        }
        
        daySchedules.forEach(sch => {
          const item = document.createElement('div');
          item.className = `schedule-item ${sch.typeClass}`;
          item.innerHTML = `
            <div class="schedule-item-title">${sch.activity}</div>
            <div class="schedule-item-contact">${sch.contact}</div>
            ${!sch.auto ? `<button class="schedule-item-delete" data-id="${sch.id}">×</button>` : ''}
          `;
          
          // Click to edit (only manual schedules)
          if(!sch.auto){
            item.addEventListener('click', (e) => {
              if(e.target.classList.contains('schedule-item-delete')) return;
              openEditScheduleModal(sch);
            });
          }
          
          td.appendChild(item);
        });
        
        tr.appendChild(td);
      });
      
      tbody.appendChild(tr);
    });
    
    console.log('=== Tabla renderizada exitosamente ===');
    console.log('Total filas creadas:', timeSlots.length);
    
    } catch(err){
      console.error('=== ERROR EN renderWeeklySchedule ===');
      console.error('Mensaje:', err.message);
      console.error('Stack:', err.stack);
      alert('Error al renderizar horario: ' + err.message);
    }
    
    // Delete buttons - fuera del try/catch para evitar problemas
    setTimeout(() => {
      document.querySelectorAll('.schedule-item-delete').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          if(!confirm('¿Eliminar este horario?')) return;
          const id = btn.dataset.id;
          const schedules = loadWeeklySchedules();
          const filtered = schedules.filter(s => s.id !== id);
          saveWeeklySchedules(filtered);
          renderWeeklySchedule();
        });
      });
    }, 50);
  }
  
  // Helper to extract day from schedule string
  function extractDay(scheduleStr){
    const lower = scheduleStr.toLowerCase();
    if(lower.includes('lun')) return 'Lunes';
    if(lower.includes('mar')) return 'Martes';
    if(lower.includes('mié') || lower.includes('mie')) return 'Miércoles';
    if(lower.includes('jue')) return 'Jueves';
    if(lower.includes('vie')) return 'Viernes';
    if(lower.includes('sáb') || lower.includes('sab')) return 'Sábado';
    if(lower.includes('dom')) return 'Domingo';
    return scheduleStr.split(' ')[0] || '';
  }
  
  // Helper to extract time from schedule string
  function extractTime(scheduleStr){
    const match = scheduleStr.match(/\d{1,2}:\d{2}(?:\s*(?:am|pm))?/i);
    return match ? match[0] : '';
  }
  
  // Helper to convert time string to 24-hour format
  function extractHour24(timeStr){
    if(!timeStr) return null;
    const match = timeStr.match(/(\d{1,2}):?(\d{2})?\s*(am|pm)?/i);
    if(!match) return null;
    
    let hour = parseInt(match[1]);
    const ampm = match[3] ? match[3].toLowerCase() : null;
    
    if(ampm === 'pm' && hour !== 12) hour += 12;
    if(ampm === 'am' && hour === 12) hour = 0;
    
    return hour;
  }
  
  // Generate hour options for select dropdown
  function generateHourOptions(selectedHour = 9){
    let html = '';
    for(let h = 6; h <= 22; h++){
      const hour12 = h > 12 ? h - 12 : h;
      const ampm = h >= 12 ? 'pm' : 'am';
      const display = `${hour12}:00 ${ampm}`;
      html += `<option value="${h}" ${h===selectedHour?'selected':''}>${display}</option>`;
    }
    return html;
  }
  
  // Add Schedule Modal
  function openAddScheduleModal(){
    const existing = document.querySelector('.modal-backdrop');
    if(existing) existing.remove();
    
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.maxWidth = '500px';
    
    modal.innerHTML = `
      <h3>Agregar Horario</h3>
      <div style="margin-bottom:12px">
        <label style="display:block;margin-bottom:4px;font-weight:600">Día:</label>
        <select id="schedule-day" class="input" style="width:100%">
          <option value="Lunes">Lunes</option>
          <option value="Martes">Martes</option>
          <option value="Miércoles">Miércoles</option>
          <option value="Jueves">Jueves</option>
          <option value="Viernes">Viernes</option>
          <option value="Sábado">Sábado</option>
          <option value="Domingo">Domingo</option>
        </select>
      </div>
      <div style="margin-bottom:12px">
        <label style="display:block;margin-bottom:4px;font-weight:600">Hora:</label>
        <select id="schedule-hour" class="input" style="width:100%">
          ${generateHourOptions()}
        </select>
      </div>
      <div style="margin-bottom:12px">
        <label style="display:block;margin-bottom:4px;font-weight:600">Actividad:</label>
        <input id="schedule-activity" type="text" class="input" style="width:100%" placeholder="Ej: Ballet Infantil" />
      </div>
      <div style="margin-bottom:12px">
        <label style="display:block;margin-bottom:4px;font-weight:600">Tipo:</label>
        <select id="schedule-type" class="input" style="width:100%">
          <option value="Manual">Manual</option>
          <option value="Alumnas">Alumnas</option>
          <option value="Rentas">Rentas</option>
          <option value="XV Años">XV Años</option>
          <option value="Coreografía">Coreografía</option>
        </select>
      </div>
      <div style="margin-bottom:12px">
        <label style="display:block;margin-bottom:4px;font-weight:600">Contacto/Nombre:</label>
        <input id="schedule-contact" type="text" class="input" style="width:100%" placeholder="Ej: María González" />
      </div>
      <div style="text-align:right;margin-top:16px">
        <button id="save-schedule" class="btn">Guardar</button>
        <button id="cancel-schedule" class="btn btn-secondary">Cancelar</button>
      </div>
    `;
    
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
    
    document.getElementById('cancel-schedule').addEventListener('click', () => backdrop.remove());
    document.getElementById('save-schedule').addEventListener('click', () => {
      try {
        const day = document.getElementById('schedule-day').value;
        const hour = parseInt(document.getElementById('schedule-hour').value);
        const activity = document.getElementById('schedule-activity').value.trim();
        const type = document.getElementById('schedule-type').value;
        const contact = document.getElementById('schedule-contact').value.trim();
        
        if(!activity || !contact){
          alert('Por favor completa todos los campos');
          return;
        }
        
        const typeClassMap = {
          'Manual': 'type-alumnas',
          'Alumnas': 'type-alumnas',
          'Rentas': 'type-rentas',
          'XV Años': 'type-xv',
          'Coreografía': 'type-choreo'
        };
        
        const schedules = loadWeeklySchedules();
        const newSchedule = {
          id: `manual-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          day: day,
          hour: hour,
          activity: activity,
          type: type,
          contact: contact,
          typeClass: typeClassMap[type] || 'type-alumnas',
          auto: false
        };
        schedules.push(newSchedule);
        console.log('Guardando nuevo horario:', newSchedule);
        console.log('Total horarios:', schedules.length);
        
        saveWeeklySchedules(schedules);
        backdrop.remove();
        
        // Force immediate re-render
        setTimeout(() => {
          renderWeeklySchedule();
          alert('Horario agregado correctamente');
        }, 100);
      } catch(e) {
        console.error('Error al guardar horario:', e);
        alert('Error al guardar el horario: ' + e.message);
      }
    });
  }
  
  // Edit Schedule Modal
  function openEditScheduleModal(schedule){
    const existing = document.querySelector('.modal-backdrop');
    if(existing) existing.remove();
    
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.maxWidth = '500px';
    
    modal.innerHTML = `
      <h3>Editar Horario</h3>
      <div style="margin-bottom:12px">
        <label style="display:block;margin-bottom:4px;font-weight:600">Día:</label>
        <select id="schedule-day" class="input" style="width:100%">
          <option value="Lunes" ${schedule.day==='Lunes'?'selected':''}>Lunes</option>
          <option value="Martes" ${schedule.day==='Martes'?'selected':''}>Martes</option>
          <option value="Miércoles" ${schedule.day==='Miércoles'?'selected':''}>Miércoles</option>
          <option value="Jueves" ${schedule.day==='Jueves'?'selected':''}>Jueves</option>
          <option value="Viernes" ${schedule.day==='Viernes'?'selected':''}>Viernes</option>
          <option value="Sábado" ${schedule.day==='Sábado'?'selected':''}>Sábado</option>
          <option value="Domingo" ${schedule.day==='Domingo'?'selected':''}>Domingo</option>
        </select>
      </div>
      <div style="margin-bottom:12px">
        <label style="display:block;margin-bottom:4px;font-weight:600">Hora:</label>
        <select id="schedule-hour" class="input" style="width:100%">
          ${generateHourOptions(schedule.hour)}
        </select>
      </div>
      <div style="margin-bottom:12px">
        <label style="display:block;margin-bottom:4px;font-weight:600">Actividad:</label>
        <input id="schedule-activity" type="text" class="input" style="width:100%" value="${escapeHtml(schedule.activity)}" />
      </div>
      <div style="margin-bottom:12px">
        <label style="display:block;margin-bottom:4px;font-weight:600">Tipo:</label>
        <select id="schedule-type" class="input" style="width:100%">
          <option value="Disciplina" ${schedule.type==='Disciplina'?'selected':''}>Disciplina (Alumnas)</option>
          <option value="Alumnas" ${schedule.type==='Alumnas'?'selected':''}>Alumnas</option>
          <option value="Rentas" ${schedule.type==='Rentas'?'selected':''}>Rentas</option>
          <option value="XV Años" ${schedule.type==='XV Años'?'selected':''}>XV Años</option>
          <option value="Coreografía" ${schedule.type==='Coreografía'?'selected':''}>Coreografía</option>
        </select>
      </div>
      <div style="margin-bottom:12px">
        <label style="display:block;margin-bottom:4px;font-weight:600">Contacto/Nombre:</label>
        <input id="schedule-contact" type="text" class="input" style="width:100%" value="${escapeHtml(schedule.contact)}" />
      </div>
      <div style="text-align:right;margin-top:16px">
        <button id="save-schedule" class="btn">Guardar</button>
        <button id="cancel-schedule" class="btn btn-secondary">Cancelar</button>
      </div>
    `;
    
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
    
    document.getElementById('cancel-schedule').addEventListener('click', () => backdrop.remove());
    document.getElementById('save-schedule').addEventListener('click', () => {
      try {
        const day = document.getElementById('schedule-day').value;
        const hour = parseInt(document.getElementById('schedule-hour').value);
        const activity = document.getElementById('schedule-activity').value.trim();
        const type = document.getElementById('schedule-type').value;
        const contact = document.getElementById('schedule-contact').value.trim();
        
        if(!activity || !contact){
          alert('Por favor completa todos los campos');
          return;
        }
        
        const typeClassMap = {
          'Disciplina': 'type-alumnas',
          'Alumnas': 'type-alumnas',
          'Rentas': 'type-rentas',
          'XV Años': 'type-xv',
          'Coreografía': 'type-choreo'
        };
        
        const schedules = loadWeeklySchedules();
        const index = schedules.findIndex(s => s.id === schedule.id);
        if(index !== -1){
          schedules[index] = {
            ...schedules[index],
            day: day,
            hour: hour,
            activity: activity,
            type: type,
            contact: contact,
            typeClass: typeClassMap[type] || 'type-alumnas'
          };
          saveWeeklySchedules(schedules);
          renderWeeklySchedule();
        }
        backdrop.remove();
        alert('Horario actualizado correctamente');
      } catch(e) {
        console.error('Error al actualizar horario:', e);
        alert('Error al actualizar el horario: ' + e.message);
      }
    });
  }
  
  // Modal for calendar day notes (multiple notes support)
  function openCalendarDayModal(day, monthKey, monthData){
    const existing = document.querySelector('.modal-backdrop');
    if(existing) existing.remove();
    
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.maxWidth = '600px';
    
    const currentNotes = monthData.dayNotes[day] || [];
    const notesArray = Array.isArray(currentNotes) ? currentNotes : (currentNotes ? [currentNotes] : []);
    
    modal.innerHTML = `
      <h3>Notas para el día ${day}</h3>
      <div id="notes-list" style="margin-bottom:16px">
        <!-- Notes will be rendered here -->
      </div>
      <button id="add-note-btn" class="btn" style="margin-bottom:16px">+ Agregar Nota</button>
      <div style="text-align:right">
        <button id="save-notes-btn" class="btn">Guardar</button>
        <button id="cancel-notes-btn" class="btn btn-secondary">Cancelar</button>
      </div>
    `;
    
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
    
    let notes = [...notesArray];
    
    function renderNotes(){
      const notesList = document.getElementById('notes-list');
      notesList.innerHTML = '';
      
      if(notes.length === 0){
        notesList.innerHTML = '<p style="color:var(--muted);text-align:center">No hay notas para este día</p>';
        return;
      }
      
      notes.forEach((note, idx) => {
        const noteRow = document.createElement('div');
        noteRow.style.display = 'flex';
        noteRow.style.gap = '8px';
        noteRow.style.marginBottom = '8px';
        noteRow.style.alignItems = 'center';
        
        const input = document.createElement('textarea');
        input.className = 'input';
        input.value = note;
        input.style.flex = '1';
        input.style.minHeight = '60px';
        input.dataset.idx = idx;
        
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'btn btn-secondary';
        deleteBtn.textContent = '×';
        deleteBtn.style.padding = '8px 12px';
        deleteBtn.addEventListener('click', () => {
          notes.splice(idx, 1);
          renderNotes();
        });
        
        noteRow.appendChild(input);
        noteRow.appendChild(deleteBtn);
        notesList.appendChild(noteRow);
      });
    }
    
    renderNotes();
    
    document.getElementById('add-note-btn').addEventListener('click', () => {
      notes.push('');
      renderNotes();
      const inputs = document.querySelectorAll('#notes-list textarea');
      if(inputs.length > 0) inputs[inputs.length - 1].focus();
    });
    
    document.getElementById('cancel-notes-btn').addEventListener('click', () => backdrop.remove());
    
    document.getElementById('save-notes-btn').addEventListener('click', () => {
      const inputs = document.querySelectorAll('#notes-list textarea');
      const updatedNotes = Array.from(inputs).map(inp => inp.value.trim()).filter(Boolean);
      
      const s = loadMainCalendar();
      if(!s[monthKey]) s[monthKey] = {...monthData};
      s[monthKey].dayNotes = s[monthKey].dayNotes || {};
      s[monthKey].dayNotes[day] = updatedNotes;
      saveMainCalendar(s);
      backdrop.remove();
      render();
      alert('Notas guardadas');
    });
  }
  
  // Helper functions defined within scope
  function printSchedule(){
    window.print();
  }
  
  function copySchedule(){
    const table = document.getElementById('weekly-schedule-grid');
    if(!table) return;
    
    let text = 'HORARIO SEMANAL - REPLAY DANCE STUDIO\n\n';
    const rows = table.querySelectorAll('tr');
    
    rows.forEach(row => {
      const cells = row.querySelectorAll('th, td');
      const rowText = Array.from(cells).map(cell => cell.textContent.trim()).join('\t');
      text += rowText + '\n';
    });
    
    navigator.clipboard.writeText(text).then(() => {
      alert('Horario copiado al portapapeles');
    }).catch(() => {
      alert('No se pudo copiar el horario');
    });
  }
  
  // Connect all schedule buttons
  const addScheduleBtn = document.getElementById('add-schedule-btn');
  if(addScheduleBtn){
    addScheduleBtn.addEventListener('click', () => {
      openAddScheduleModal();
    });
  }
  
  const printScheduleBtn = document.getElementById('print-schedule-btn');
  if(printScheduleBtn){
    printScheduleBtn.addEventListener('click', () => {
      printSchedule();
    });
  }
  
  const copyScheduleBtn = document.getElementById('copy-schedule-btn');
  if(copyScheduleBtn){
    copyScheduleBtn.addEventListener('click', () => {
      copyWeeklyToClipboard();
    });
  }
  
  const pasteScheduleBtn = document.getElementById('paste-schedule-btn');
  if(pasteScheduleBtn){
    pasteScheduleBtn.addEventListener('click', () => {
      pasteWeeklyFromClipboard();
    });
  }
  
  const refreshScheduleBtn = document.getElementById('refresh-weekly-btn');
  if(refreshScheduleBtn){
    refreshScheduleBtn.addEventListener('click', () => {
      renderWeeklySchedule();
    });
  }
  
  // Make renderWeeklySchedule available globally for updates from other pages
  window.renderWeeklySchedule = renderWeeklySchedule;
  
  // Debug function to test adding schedule directly
  window.testAddSchedule = function(){
    const testSchedule = {
      id: `manual-test-${Date.now()}`,
      day: 'Lunes',
      hour: 10,
      activity: 'TEST - Ballet',
      type: 'Manual',
      contact: 'Prueba Sistema',
      typeClass: 'type-alumnas',
      auto: false
    };
    const schedules = loadWeeklySchedules();
    schedules.push(testSchedule);
    saveWeeklySchedules(schedules);
    console.log('Horario de prueba agregado:', testSchedule);
    renderWeeklySchedule();
    alert('Horario de prueba agregado. Revisa Lunes 10:00 am');
  };
  
  render();
  renderWeeklySchedule();
  
  // Auto-refresh every 2 seconds to catch updates from other pages
  setInterval(() => {
    renderWeeklySchedule();
    render(); // Also update calendar to show new schedules
  }, 2000);
}

/* ========================================
   PÁGINA 5b: CALENDARIO SIMPLE (HORARIO)
   ======================================== */

const SIMPLE_SCHEDULE_KEY = 'rds_simple_schedule_v2';
const SIMPLE_SCHEDULE_EXTRA_KEY = 'rds_simple_schedule_extra_v1';

// Load schedules by month key (same format as loadRentalWeeklySchedule)
function loadSimpleSchedule(monthKey){
  try {
    const raw = localStorage.getItem(SIMPLE_SCHEDULE_KEY);
    const allSchedules = raw ? JSON.parse(raw) : {};
    if(monthKey){
      return allSchedules[monthKey] || [];
    }
    return allSchedules;
  } catch(e) {
    console.error('Error loading simple schedule:', e);
    return monthKey ? [] : {};
  }
}

// Save schedules by month key
function saveSimpleSchedule(monthKey, schedules){
  try {
    const allSchedules = loadSimpleSchedule();
    allSchedules[monthKey] = schedules;
    localStorage.setItem(SIMPLE_SCHEDULE_KEY, JSON.stringify(allSchedules));
  } catch(e) {
    console.error('Error saving simple schedule:', e);
  }
}

// Load extra schedules by month key
function loadExtraSchedule(monthKey){
  try {
    const raw = localStorage.getItem(SIMPLE_SCHEDULE_EXTRA_KEY);
    const allSchedules = raw ? JSON.parse(raw) : {};
    if(monthKey){
      return allSchedules[monthKey] || [];
    }
    return allSchedules;
  } catch(e) {
    console.error('Error loading extra schedule:', e);
    return monthKey ? [] : {};
  }
}

// Save extra schedules by month key
function saveExtraSchedule(monthKey, schedules){
  try {
    const allSchedules = loadExtraSchedule();
    allSchedules[monthKey] = schedules;
    localStorage.setItem(SIMPLE_SCHEDULE_EXTRA_KEY, JSON.stringify(allSchedules));
  } catch(e) {
    console.error('Error saving extra schedule:', e);
  }
}

// Helper to get current month key
function getMonthKeyForDate(date){
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`;
}

// ---- Helpers: parse tiempos y sincronizar con el horario simple ----
function __parseSingleTimeTo24(str, fallbackPeriod){
  if(!str) return { value: null, period: fallbackPeriod || '' };
  const match = String(str).trim().toLowerCase().match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?/);
  if(!match) return { value: null, period: fallbackPeriod || '' };
  let hour = Math.max(0, Math.min(23, parseInt(match[1], 10) || 0));
  const minute = Math.max(0, Math.min(59, match[2] ? parseInt(match[2], 10) : 0));
  let period = match[3] ? match[3].replace(/\./g,'') : (fallbackPeriod || '');
  const hasPeriod = !!match[3];

  if(period.includes('p')){
    if(hour !== 12) hour += 12;
  } else if(period.includes('a')){
    if(hour === 12) hour = 0;
  } else {
    // Sin AM/PM: dejar tal cual (preferimos no adivinar)
  }

  const hh = String(hour).padStart(2,'0');
  const mm = String(minute).padStart(2,'0');
  return { value: `${hh}:${mm}`, period: hasPeriod ? period : (fallbackPeriod || '') };
}

function parseTimeRangeTo24(raw){
  if(!raw) return { start: null, end: null };
  const norm = String(raw).replace(/\s+/g,' ').trim();
  const parts = norm.split('-');
  const startRaw = parts[0] ? parts[0].trim() : '';
  const endRaw = parts[1] ? parts[1].trim() : '';
  const start = __parseSingleTimeTo24(startRaw, '');
  const end = __parseSingleTimeTo24(endRaw, start.period);
  return { start: start.value, end: end.value };
}

function dayNameFromDate(dateStr){
  if(!dateStr) return null;
  const d = new Date(`${dateStr}T00:00:00`);
  if(Number.isNaN(d.getTime())) return null;
  const days = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
  return days[d.getDay()] || null;
}

function upsertSimpleScheduleSource(sourceKey, entries){
  const current = loadSimpleSchedule();
  const filtered = current.filter(item => item.source !== sourceKey);
  const clean = (entries || []).filter(e => e && e.day && e.time).map((e, idx) => ({
    id: e.id || `${sourceKey}-${Date.now()}-${idx}`,
    source: sourceKey,
    type: e.type || 'Evento',
    title: e.title || 'Sin título',
    person: e.person || '',
    day: e.day,
    time: e.time,
    timeEnd: e.timeEnd || null,
    color: e.color || '#ED468F'
  }));
  saveSimpleSchedule(filtered.concat(clean));
}

function syncSimpleScheduleForRentals(){
  try{
    const people = loadRentalPeople();
    const peopleMap = {};
    people.forEach(p => { peopleMap[p.id] = p; });

    const aggregated = [];

    // Schedules capturados por persona
    people.forEach(p => {
      (p.schedules || []).forEach(s => {
        const parsed = parseTimeRangeTo24(s.time || '');
        if(!parsed.start || !s.day) return;
        aggregated.push({
          type: 'Renta',
          title: p.name || 'Renta',
          person: p.group || '',
          day: s.day,
          time: parsed.start,
          timeEnd: parsed.end,
          color: '#9C27B0'
        });
      });
    });

    // Schedules del calendario semanal de rentas
    const schedMap = loadRentalSchedules();
    Object.values(schedMap).forEach(weekObj => {
      Object.values(weekObj || {}).forEach(list => {
        (list || []).forEach(entry => {
          const parsed = parseTimeRangeTo24(entry.time || '');
          if(!parsed.start || !entry.day) return;
          const personName = entry.personId && peopleMap[entry.personId] ? (peopleMap[entry.personId].name || entry.groups || 'Renta') : (entry.groups || 'Renta');
          const personGroup = entry.personId && peopleMap[entry.personId] ? (peopleMap[entry.personId].group || '') : '';
          aggregated.push({
            type: 'Renta',
            title: personName,
            person: personGroup,
            day: entry.day,
            time: parsed.start,
            timeEnd: parsed.end,
            color: '#9C27B0'
          });
        });
      });
    });

    const seen = new Set();
    const unique = aggregated.filter(e => {
      const key = `${e.day}|${e.time}|${e.timeEnd || ''}|${e.title}`;
      if(seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    upsertSimpleScheduleSource('renta', unique);
  }catch(err){ console.error('No se pudo sincronizar horario simple (rentas)', err); }
}

function syncSimpleScheduleForChoreos(){
  try{
    const choreos = loadChoreographies();
    const aggregated = [];
    choreos.forEach(ch => {
      (ch.horarios || []).forEach(h => {
        const day = dayNameFromDate(h.fecha);
        const parsed = parseTimeRangeTo24(h.hora || '');
        if(!day || !parsed.start) return;
        aggregated.push({
          type: 'Coreografía',
          title: ch.nombre || 'Coreografía',
          person: h.nota || ch.grupo || '',
          day,
          time: parsed.start,
          timeEnd: parsed.end,
          color: '#03A9F4'
        });
      });
    });

    const seen = new Set();
    const unique = aggregated.filter(e => {
      const key = `${e.day}|${e.time}|${e.timeEnd || ''}|${e.title}`;
      if(seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    upsertSimpleScheduleSource('coreografia', unique);
  }catch(err){ console.error('No se pudo sincronizar horario simple (coreografías)', err); }
}

function syncSimpleScheduleForXV(){
  try{
    const xvList = loadXVQuinceaneras();
    const aggregated = [];
    xvList.forEach(xv => {
      (xv.horarios || []).forEach(h => {
        const day = dayNameFromDate(h.fecha);
        const parsed = parseTimeRangeTo24(h.hora || '');
        if(!day || !parsed.start) return;
        aggregated.push({
          type: 'XV Años',
          title: xv.nombre || 'XV',
          person: h.nota || '',
          day,
          time: parsed.start,
          timeEnd: parsed.end,
          color: '#FF9800'
        });
      });
    });

    const seen = new Set();
    const unique = aggregated.filter(e => {
      const key = `${e.day}|${e.time}|${e.timeEnd || ''}|${e.title}`;
      if(seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    upsertSimpleScheduleSource('xv', unique);
  }catch(err){ console.error('No se pudo sincronizar horario simple (XV)', err); }
}

function initSimpleCalendarioPage(){
  const tbody = document.getElementById('schedule-tbody');
  if(!tbody) return;

  // Traer datos recientes de rentas, coreografías y XV al horario simple
  try{ syncSimpleScheduleForRentals(); }catch(e){}
  try{ syncSimpleScheduleForChoreos(); }catch(e){}
  try{ syncSimpleScheduleForXV(); }catch(e){}

  // Generar opciones de tiempo (6:00 AM - 10:45 PM en intervalos de 15 min)
  function generateTimeOptions() {
    const options = [];
    for (let h = 6; h <= 22; h++) {
      for (let m = 0; m < 60; m += 15) {
        if (h === 22 && m > 45) break;
        const hour = h.toString().padStart(2, '0');
        const min = m.toString().padStart(2, '0');
        const time24 = `${hour}:${min}`;
        
        const period = h >= 12 ? 'PM' : 'AM';
        const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
        const display = `${h12}:${min} ${period}`;
        
        options.push({ value: time24, display });
      }
    }
    return options;
  }

  const timeOptions = generateTimeOptions();

  // Obtener todas las horas únicas usadas en los horarios, ordenadas
  function getUsedTimes(schedules) {
    const times = new Set();
    schedules.forEach(s => times.add(s.time));
    return Array.from(times).sort();
  }

  // Convertir tiempo 24h a formato display
  function formatTimeDisplay(time24) {
    if(!time24 || typeof time24 !== 'string') return '';
    const parts = time24.split(':');
    if(parts.length < 2) return time24;
    const h = Number(parts[0]);
    const m = Number(parts[1]);
    if(Number.isNaN(h) || Number.isNaN(m)) return time24;
    const period = h >= 12 ? 'PM' : 'AM';
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${h12}:${m.toString().padStart(2, '0')} ${period}`;
  }

  function renderSchedule(){
    const schedules = loadSimpleSchedule();
    tbody.innerHTML = '';

    const days = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
    
    // Obtener todas las horas usadas, ordenadas
    const usedTimes = getUsedTimes(schedules);
    
    // Si no hay horarios, mostrar mensaje
    if (usedTimes.length === 0) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 8;
      td.style.textAlign = 'center';
      td.style.padding = '2rem';
      td.style.color = '#666';
      td.textContent = 'No hay horarios agregados. Haz clic en "+ Agregar Horario" para comenzar.';
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    // Generar filas solo para las horas que tienen horarios
    usedTimes.forEach(time => {
      const tr = document.createElement('tr');
      
      // Celda de hora
      const hourCell = document.createElement('td');
      hourCell.className = 'hour-cell';
      hourCell.textContent = formatTimeDisplay(time);
      tr.appendChild(hourCell);

      // Celdas de días
      days.forEach(day => {
        const td = document.createElement('td');
        
        // Filtrar horarios para este día y hora
        const daySchedules = schedules.filter(s => 
          s.day === day && s.time === time
        );

        daySchedules.forEach(sch => {
          const box = document.createElement('div');
          box.className = 'schedule-item-box';
          box.style.backgroundColor = sch.color || '#f0f0f0';
          box.style.borderLeftColor = sch.color || '#ccc';
          
          const title = document.createElement('div');
          title.className = 'title';
          title.style.color = '#fff';
          title.textContent = sch.title;
          box.appendChild(title);

          if(sch.person){
            const person = document.createElement('div');
            person.className = 'person';
            person.textContent = sch.person;
            box.appendChild(person);
          }

          const timeRange = document.createElement('div');
          timeRange.className = 'time-range';
          if(sch.timeEnd){
            timeRange.textContent = `${formatTimeDisplay(sch.time)} - ${formatTimeDisplay(sch.timeEnd)}`;
          } else if(sch.time){
            timeRange.textContent = formatTimeDisplay(sch.time);
          }
          if(timeRange.textContent) box.appendChild(timeRange);

          const deleteBtn = document.createElement('button');
          deleteBtn.className = 'delete-btn';
          deleteBtn.textContent = '×';
          deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if(!confirm('¿Eliminar este horario?')) return;
            const filtered = schedules.filter(s => s.id !== sch.id);
            saveSimpleSchedule(filtered);
            renderSchedule();
          });
          box.appendChild(deleteBtn);

          // Click para editar
          box.addEventListener('click', () => {
            openEditScheduleModal(sch);
          });

          td.appendChild(box);
        });

        tr.appendChild(td);
      });

      tbody.appendChild(tr);
    });
  }

  function openAddScheduleModal(){
    const existing = document.querySelector('.modal-backdrop');
    if(existing) existing.remove();

    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.maxWidth = '500px';

    modal.innerHTML = `
      <h3>Agregar Horario</h3>
      
      <div style="margin-bottom:12px">
        <label style="display:block;margin-bottom:4px;font-weight:600">Tipo:</label>
        <select id="sch-type" class="input" style="width:100%">
          <option value="Disciplina">Disciplina</option>
          <option value="Renta">Renta</option>
          <option value="XV Años">XV Años</option>
          <option value="Coreografía">Coreografía</option>
        </select>
      </div>

      <div style="margin-bottom:12px">
        <label style="display:block;margin-bottom:4px;font-weight:600">Título (cómo aparecerá):</label>
        <input id="sch-title" type="text" class="input" style="width:100%" placeholder="Ej: Ballet Infantil" />
      </div>

      <div style="margin-bottom:12px">
        <label style="display:block;margin-bottom:4px;font-weight:600">Nombre de la persona (opcional):</label>
        <input id="sch-person" type="text" class="input" style="width:100%" placeholder="Ej: María González" />
      </div>

      <div style="margin-bottom:12px">
        <label style="display:block;margin-bottom:4px;font-weight:600">Día:</label>
        <select id="sch-day" class="input" style="width:100%">
          <option value="Lunes">Lunes</option>
          <option value="Martes">Martes</option>
          <option value="Miércoles">Miércoles</option>
          <option value="Jueves">Jueves</option>
          <option value="Viernes">Viernes</option>
          <option value="Sábado">Sábado</option>
          <option value="Domingo">Domingo</option>
        </select>
      </div>

      <div style="margin-bottom:12px">
        <label style="display:block;margin-bottom:4px;font-weight:600">Hora de inicio:</label>
        <select id="sch-hour" class="input" style="width:100%">
          ${timeOptions.map(t => `<option value="${t.value}">${t.display}</option>`).join('')}
        </select>
      </div>

      <div style="margin-bottom:12px">
        <label style="display:block;margin-bottom:4px;font-weight:600">Hora de fin (opcional):</label>
        <select id="sch-hour-end" class="input" style="width:100%">
          <option value="">Sin hora de fin</option>
          ${timeOptions.map(t => `<option value="${t.value}">${t.display}</option>`).join('')}
        </select>
      </div>

      <div style="margin-bottom:12px">
        <label style="display:block;margin-bottom:4px;font-weight:600">Color:</label>
        <input id="sch-color" type="color" class="input" value="#FFD6E8" style="width:100%;height:40px" />
      </div>

      <div style="text-align:right;margin-top:16px">
        <button id="save-sch-btn" class="btn">Guardar</button>
        <button id="cancel-sch-btn" class="btn btn-secondary">Cancelar</button>
      </div>
    `;

    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);

    document.getElementById('cancel-sch-btn').addEventListener('click', () => backdrop.remove());
    
    document.getElementById('save-sch-btn').addEventListener('click', () => {
      const type = document.getElementById('sch-type').value;
      const title = document.getElementById('sch-title').value.trim();
      const person = document.getElementById('sch-person').value.trim();
      const day = document.getElementById('sch-day').value;
      const time = document.getElementById('sch-hour').value;
      const timeEnd = document.getElementById('sch-hour-end').value;
      const color = document.getElementById('sch-color').value;

      if(!title){
        alert('Por favor ingresa un título');
        return;
      }

      const schedules = loadSimpleSchedule(currentMonthKey);
      schedules.push({
        id: `sch-${Date.now()}`,
        type,
        title,
        person,
        day,
        time,
        timeEnd: timeEnd || null,
        color
      });

      saveSimpleSchedule(currentMonthKey, schedules);
      renderSchedule();
      backdrop.remove();
      alert('Horario agregado correctamente');
    });
  }

  function openEditScheduleModal(schedule){
    const existing = document.querySelector('.modal-backdrop');
    if(existing) existing.remove();

    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.maxWidth = '500px';

    modal.innerHTML = `
      <h3>Editar Horario</h3>
      
      <div style="margin-bottom:12px">
        <label style="display:block;margin-bottom:4px;font-weight:600">Tipo:</label>
        <select id="sch-type" class="input" style="width:100%">
          <option value="Disciplina" ${schedule.type==='Disciplina'?'selected':''}>Disciplina</option>
          <option value="Renta" ${schedule.type==='Renta'?'selected':''}>Renta</option>
          <option value="XV Años" ${schedule.type==='XV Años'?'selected':''}>XV Años</option>
          <option value="Coreografía" ${schedule.type==='Coreografía'?'selected':''}>Coreografía</option>
        </select>
      </div>

      <div style="margin-bottom:12px">
        <label style="display:block;margin-bottom:4px;font-weight:600">Título:</label>
        <input id="sch-title" type="text" class="input" style="width:100%" value="${escapeHtml(schedule.title)}" />
      </div>

      <div style="margin-bottom:12px">
        <label style="display:block;margin-bottom:4px;font-weight:600">Nombre de la persona (opcional):</label>
        <input id="sch-person" type="text" class="input" style="width:100%" value="${escapeHtml(schedule.person||'')}" />
      </div>

      <div style="margin-bottom:12px">
        <label style="display:block;margin-bottom:4px;font-weight:600">Día:</label>
        <select id="sch-day" class="input" style="width:100%">
          <option value="Lunes" ${schedule.day==='Lunes'?'selected':''}>Lunes</option>
          <option value="Martes" ${schedule.day==='Martes'?'selected':''}>Martes</option>
          <option value="Miércoles" ${schedule.day==='Miércoles'?'selected':''}>Miércoles</option>
          <option value="Jueves" ${schedule.day==='Jueves'?'selected':''}>Jueves</option>
          <option value="Viernes" ${schedule.day==='Viernes'?'selected':''}>Viernes</option>
          <option value="Sábado" ${schedule.day==='Sábado'?'selected':''}>Sábado</option>
          <option value="Domingo" ${schedule.day==='Domingo'?'selected':''}>Domingo</option>
        </select>
      </div>

      <div style="margin-bottom:12px">
        <label style="display:block;margin-bottom:4px;font-weight:600">Hora de inicio:</label>
        <select id="sch-hour" class="input" style="width:100%">
          ${timeOptions.map(t => `<option value="${t.value}" ${t.value===schedule.time?'selected':''}>${t.display}</option>`).join('')}
        </select>
      </div>

      <div style="margin-bottom:12px">
        <label style="display:block;margin-bottom:4px;font-weight:600">Hora de fin (opcional):</label>
        <select id="sch-hour-end" class="input" style="width:100%">
          <option value="">Sin hora de fin</option>
          ${timeOptions.map(t => `<option value="${t.value}" ${t.value===(schedule.timeEnd||'')?'selected':''}>${t.display}</option>`).join('')}
        </select>
      </div>

      <div style="margin-bottom:12px">
        <label style="display:block;margin-bottom:4px;font-weight:600">Color:</label>
        <input id="sch-color" type="color" class="input" value="${schedule.color||'#FFD6E8'}" style="width:100%;height:40px" />
      </div>

      <div style="text-align:right;margin-top:16px">
        <button id="save-sch-btn" class="btn">Guardar</button>
        <button id="cancel-sch-btn" class="btn btn-secondary">Cancelar</button>
      </div>
    `;

    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);

    document.getElementById('cancel-sch-btn').addEventListener('click', () => backdrop.remove());
    
    document.getElementById('save-sch-btn').addEventListener('click', () => {
      const type = document.getElementById('sch-type').value;
      const title = document.getElementById('sch-title').value.trim();
      const person = document.getElementById('sch-person').value.trim();
      const day = document.getElementById('sch-day').value;
      const time = document.getElementById('sch-hour').value;
      const timeEnd = document.getElementById('sch-hour-end').value;
      const color = document.getElementById('sch-color').value;

      if(!title){
        alert('Por favor ingresa un título');
        return;
      }

      const schedules = loadSimpleSchedule(currentMonthKey);
      const index = schedules.findIndex(s => s.id === schedule.id);
      if(index !== -1){
        schedules[index] = {
          ...schedules[index],
          type,
          title,
          person,
          day,
          time,
          timeEnd: timeEnd || null,
          color
        };
        saveSimpleSchedule(currentMonthKey, schedules);
        renderSchedule();
      }

      backdrop.remove();
      alert('Horario actualizado correctamente');
    });
  }

  // Conectar botón
  const addBtn = document.getElementById('add-schedule-btn');
  if(addBtn){
    addBtn.addEventListener('click', openAddScheduleModal);
  }


  renderSchedule();
}

/* ========================================
   PÁGINA 5.9: CALENDARIO COMPLETO + HORARIO
   ======================================== */

const MONTHLY_CALENDAR_KEY = 'rds_monthly_calendar_v2';

function loadMonthlyCalendar(){
  try{
    const raw = localStorage.getItem(MONTHLY_CALENDAR_KEY);
    return raw ? JSON.parse(raw) : {};
  }catch(e){
    return {};
  }
}

function saveMonthlyCalendar(data){
  try{
    localStorage.setItem(MONTHLY_CALENDAR_KEY, JSON.stringify(data));
  }catch(e){}
}

function getContrastColor(bgColor){
  if(!bgColor || bgColor === 'transparent') return '#000';
  let color = bgColor;
  if(color.startsWith('#')){
    color = color.substring(1);
  }
  if(color.length === 3){
    color = color[0]+color[0]+color[1]+color[1]+color[2]+color[2];
  }
  const r = parseInt(color.substr(0,2), 16);
  const g = parseInt(color.substr(2,2), 16);
  const b = parseInt(color.substr(4,2), 16);
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  return brightness > 155 ? '#000' : '#fff';
}

function initFullCalendarioPage(){
  const calendarGrid = document.getElementById('calendar-grid');
  const scheduleTable = document.getElementById('schedule-tbody');
  if(!calendarGrid || !scheduleTable) return;
  const selectedCalendarIds = new Set();

  // Sincronizar datos de todas las fuentes
  try{ syncSimpleScheduleForRentals(); }catch(e){}
  try{ syncSimpleScheduleForChoreos(); }catch(e){}
  try{ syncSimpleScheduleForXV(); }catch(e){}
  try{ syncMonthlyCalendarFromAllSources(); }catch(e){}

  function getCurrentMonthKey(){
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  }

  let currentMonthKey = getCurrentMonthKey();

  function renderCalendar(){
    const allCals = loadMonthlyCalendar();
    const monthData = allCals[currentMonthKey] || {
      name: getMonthName(currentMonthKey),
      days: getDaysInMonth(currentMonthKey),
      startDay: getStartDayOfMonth(currentMonthKey),
      notes: {}
    };

    // Actualizar título
    document.getElementById('cal-month-title').textContent = monthData.name || currentMonthKey;

    // Limpiar grid
    calendarGrid.innerHTML = '';

    // Headers de días
    const dayNames = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    dayNames.forEach(name => {
      const header = document.createElement('div');
      header.className = 'weekday';
      header.textContent = name;
      calendarGrid.appendChild(header);
    });

    // Celdas vacías antes del primer día
    const startDay = parseInt(monthData.startDay) || 0;
    for(let i = 0; i < startDay; i++){
      const empty = document.createElement('div');
      empty.className = 'calendar-cell empty';
      calendarGrid.appendChild(empty);
    }

    // Celdas de días
    const totalDays = parseInt(monthData.days) || 31;
    for(let day = 1; day <= totalDays; day++){
      const cell = document.createElement('div');
      cell.className = 'calendar-cell';
      cell.dataset.day = day;

      const notesRaw = monthData.notes[day] || [];
      const preview = buildNotesPreview(notesRaw);
      if(preview.text){
        cell.classList.add('has-note');
        const bg = preview.color || '#ED468F';
        cell.style.background = `linear-gradient(135deg, ${bg}1f, #fff)`;
        cell.style.border = `1px solid ${bg}55`;
      }

      const num = document.createElement('div');
      num.className = 'day-num';
      num.textContent = day;
      const noteP = document.createElement('div');
      noteP.className = 'note-preview';
      noteP.textContent = preview.text.length > 80 ? preview.text.slice(0,80)+'…' : preview.text;
      cell.appendChild(num);
      cell.appendChild(noteP);
      if(preview.count > 1){
        const badge = document.createElement('span');
        badge.className = 'note-count-badge';
        badge.textContent = `+${preview.count-1}`;
        cell.appendChild(badge);
      }

      cell.addEventListener('click', () => {
        openDayModal(day, notesRaw);
      });
      calendarGrid.appendChild(cell);
    }
  }

  function openDayModal(day, currentNotes){
    const notesArr = normalizeNotesArray(currentNotes);
    const existing = document.querySelector('.modal-backdrop');
    if(existing) existing.remove();

    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.maxWidth = '600px';

    modal.innerHTML = `
      <h3>📝 Día ${day}</h3>
      <div id="day-note-list" style="display:flex;flex-direction:column;gap:8px;margin-bottom:12px"></div>
      <button id="day-note-add" class="btn btn-secondary" style="margin-bottom:8px">+ Agregar nota</button>
      
      <div style="border-top:1px solid #eee;padding-top:12px;margin-top:12px">
        <label style="font-weight:700;color:var(--pink);display:block;margin-bottom:8px">🔄 Duplicar notas a otros días:</label>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <input type="text" id="duplicate-days" class="input" placeholder="Ej: 10,15,20" style="flex:1;min-width:150px" />
          <button id="btn-duplicate" class="btn btn-secondary" style="font-size:12px">Duplicar</button>
        </div>
        <div style="font-size:11px;color:var(--muted);margin-top:4px">Ingresa los números de días separados por comas</div>
      </div>
      
      <div style="text-align:right;margin-top:16px;display:flex;gap:8px;justify-content:flex-end">
        <button id="save-day-notes" class="btn">Guardar</button>
        <button id="delete-day-notes" class="btn btn-secondary">Eliminar</button>
        <button id="close-day-modal" class="btn btn-secondary">Cerrar</button>
      </div>
    `;

    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);

    const list = document.getElementById('day-note-list');

    function addRow(note){
      const n = normalizeNoteEntry(note || {text:'', color:'#ED468F', type:'', time:''});
      const row = document.createElement('div');
      row.className = 'note-row';
      row.innerHTML = `
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <label style="display:flex;align-items:center;gap:4px">
            <input type="checkbox" class="note-select" checked />
            <span style="font-size:12px;color:var(--muted)">Duplicar</span>
          </label>
          <label style="font-weight:700;color:var(--pink)">Tipo
            <select class="note-type input" style="margin-top:4px;flex:1;min-width:120px">
              <option value="">General</option>
              <option value="Pago" ${n.type==='Pago'?'selected':''}>Pago</option>
              <option value="Inscripción" ${n.type==='Inscripción'?'selected':''}>Inscripción</option>
              <option value="Ensayo" ${n.type==='Ensayo'?'selected':''}>Ensayo</option>
              <option value="Evento" ${n.type==='Evento'?'selected':''}>Evento</option>
              <option value="Renta" ${n.type==='Renta'?'selected':''}>Renta</option>
            </select>
          </label>
          <label style="font-weight:700;color:var(--pink)">Color
            <input type="color" class="note-color input" value="${n.color||'#ED468F'}" style="margin-top:4px;width:70px;height:38px;padding:0;border:none" />
          </label>
          <label style="font-weight:700;color:var(--pink)">Hora
            <input type="time" class="note-time input" value="${n.time||''}" style="margin-top:4px;width:100px" />
          </label>
          <button class="btn btn-secondary note-remove" type="button" style="margin-left:auto">🗑️</button>
        </div>
        <textarea class="note-text" style="width:100%;min-height:80px;padding:10px;border-radius:8px;border:1px solid #eee;margin-top:6px">${escapeHtml(n.text||'')}</textarea>
      `;
      row.querySelector('.note-remove').addEventListener('click', ()=> row.remove());
      list.appendChild(row);
    }

    if(notesArr.length){ notesArr.forEach(n=> addRow(n)); }
    else { addRow({text:'', color:'#ED468F', type:'', time:''}); }

    document.getElementById('day-note-add').addEventListener('click', ()=> addRow({text:'', color:'#ED468F', type:'', time:''}));

    document.getElementById('btn-duplicate').addEventListener('click', () => {
      const daysInput = document.getElementById('duplicate-days').value.trim();
      if(!daysInput){
        alert('Por favor ingresa los días a duplicar');
        return;
      }
      const targetDays = daysInput.split(',').map(d=> parseInt(d.trim())).filter(d=> !isNaN(d) && d > 0);
      if(targetDays.length === 0){
        alert('No se encontraron días válidos');
        return;
      }
      
      const rows = Array.from(list.querySelectorAll('.note-row'));
      const currentNotes = rows.map(r=>{
        const isSelected = r.querySelector('.note-select')?.checked;
        if(!isSelected) return null;
        const text = (r.querySelector('.note-text')?.value || '').trim();
        if(!text) return null;
        const type = r.querySelector('.note-type')?.value || '';
        const color = (r.querySelector('.note-color')?.value) || colorForType(type) || '#ED468F';
        const time = r.querySelector('.note-time')?.value || '';
        return {text, color, type, time};
      }).filter(Boolean);
      
      if(currentNotes.length === 0){
        alert('No hay notas seleccionadas para duplicar');
        return;
      }
      
      const allCals = loadMonthlyCalendar();
      if(!allCals[currentMonthKey]){
        allCals[currentMonthKey] = {
          name: getMonthName(currentMonthKey),
          days: getDaysInMonth(currentMonthKey),
          startDay: getStartDayOfMonth(currentMonthKey),
          notes: {}
        };
      }
      
      targetDays.forEach(targetDay => {
        if(!allCals[currentMonthKey].notes[targetDay]){
          allCals[currentMonthKey].notes[targetDay] = [];
        }
        currentNotes.forEach(note => {
          const existingNotes = allCals[currentMonthKey].notes[targetDay];
          if(!existingNotes.find(e=> e.text === note.text && e.type === note.type)){
            existingNotes.push({...note});
          }
        });
      });
      
      saveMonthlyCalendar(allCals);
      renderCalendar();
      alert(`✅ ${currentNotes.length} nota(s) duplicadas a ${targetDays.length} día(s): ${targetDays.join(', ')}`);
    });

    document.getElementById('close-day-modal').addEventListener('click', () => backdrop.remove());
    document.getElementById('delete-day-notes').addEventListener('click', () => {
      const allCals = loadMonthlyCalendar();
      if(!allCals[currentMonthKey]){
        allCals[currentMonthKey] = {
          name: getMonthName(currentMonthKey),
          days: getDaysInMonth(currentMonthKey),
          startDay: getStartDayOfMonth(currentMonthKey),
          notes: {}
        };
      }
      delete allCals[currentMonthKey].notes[day];
      saveMonthlyCalendar(allCals);
      renderCalendar();
      backdrop.remove();
    });
    document.getElementById('save-day-notes').addEventListener('click', () => {
      const rows = Array.from(list.querySelectorAll('.note-row'));
      const newNotes = rows.map(r=>{
        const text = (r.querySelector('.note-text')?.value || '').trim();
        if(!text) return null;
        const type = r.querySelector('.note-type')?.value || '';
        const color = (r.querySelector('.note-color')?.value) || colorForType(type) || '#ED468F';
        const time = r.querySelector('.note-time')?.value || '';
        return {text, color, type, time};
      }).filter(Boolean);
      
      const allCals = loadMonthlyCalendar();
      if(!allCals[currentMonthKey]){
        allCals[currentMonthKey] = {
          name: getMonthName(currentMonthKey),
          days: getDaysInMonth(currentMonthKey),
          startDay: getStartDayOfMonth(currentMonthKey),
          notes: []
        };
      }
      allCals[currentMonthKey].notes[day] = newNotes;
      saveMonthlyCalendar(allCals);
      renderCalendar();
      backdrop.remove();
    });

    setTimeout(() => {
      const firstText = list.querySelector('.note-text');
      if(firstText) firstText.focus();
    }, 100);
  }

  function getMonthName(key){
    const [year, month] = key.split('-');
    const months = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    return `${months[parseInt(month)-1]} ${year}`;
  }

  function getDaysInMonth(key){
    const [year, month] = key.split('-').map(Number);
    return new Date(year, month, 0).getDate();
  }

  function getStartDayOfMonth(key){
    const [year, month] = key.split('-').map(Number);
    return new Date(year, month-1, 1).getDay();
  }

  // Navegación
  function navigatePreviousMonth(){
    const [year, month] = currentMonthKey.split('-').map(Number);
    let newMonth = month - 1;
    let newYear = year;
    if(newMonth < 1){
      newMonth = 12;
      newYear--;
    }
    currentMonthKey = `${newYear}-${String(newMonth).padStart(2,'0')}`;
    renderCalendar();
    renderSchedule();
    loadRemindersForMonth();
  }

  function navigateNextMonth(){
    const [year, month] = currentMonthKey.split('-').map(Number);
    let newMonth = month + 1;
    let newYear = year;
    if(newMonth > 12){
      newMonth = 1;
      newYear++;
    }
    currentMonthKey = `${newYear}-${String(newMonth).padStart(2,'0')}`;
    renderCalendar();
    renderSchedule();
    loadRemindersForMonth();
  }

  document.getElementById('cal-prev-month').addEventListener('click', () => {
    const remindersTextarea = document.getElementById('reminders-text');
    if(remindersTextarea){
      localStorage.setItem(`rds_reminders_${currentMonthKey}`, remindersTextarea.value);
    }
    navigatePreviousMonth();
  });

  document.getElementById('cal-next-month').addEventListener('click', () => {
    const remindersTextarea = document.getElementById('reminders-text');
    if(remindersTextarea){
      localStorage.setItem(`rds_reminders_${currentMonthKey}`, remindersTextarea.value);
    }
    navigateNextMonth();
  });


  // Copiar calendario (mes actual)
  const calCopyBtn = document.getElementById('cal-copy');
  if(calCopyBtn){
    calCopyBtn.addEventListener('click', () => {
      const allCals = loadMonthlyCalendar();
      const monthData = allCals[currentMonthKey];
      if(!monthData || !monthData.notes || Object.keys(monthData.notes).length === 0){
        alert('No hay notas para copiar en este mes');
        return;
      }
      try{
        localStorage.setItem('rds_calendar_clipboard', JSON.stringify(monthData.notes));
        alert('📋 Calendario copiado');
      }catch(e){
        alert('Error al copiar calendario');
      }
    });
  }

  // Pegar calendario (mes actual)
  const calPasteBtn = document.getElementById('cal-paste');
  if(calPasteBtn){
    calPasteBtn.addEventListener('click', () => {
      const clipData = localStorage.getItem('rds_calendar_clipboard');
      if(!clipData){
        alert('No hay notas en el portapapeles');
        return;
      }
      try{
        const pastedNotes = JSON.parse(clipData);
        const allCals = loadMonthlyCalendar();
        if(!allCals[currentMonthKey]){
          allCals[currentMonthKey] = {
            name: getMonthName(currentMonthKey),
            days: getDaysInMonth(currentMonthKey),
            startDay: getStartDayOfMonth(currentMonthKey),
            notes: {}
          };
        }
        const targetNotes = allCals[currentMonthKey].notes;
        Object.keys(pastedNotes || {}).forEach(dayKey => {
          const incoming = normalizeNotesArray(pastedNotes[dayKey]);
          if(!targetNotes[dayKey]) targetNotes[dayKey] = [];
          const existing = normalizeNotesArray(targetNotes[dayKey]);
          incoming.forEach(n => {
            if(!existing.find(e => e.text === n.text && e.type === n.type && e.time === n.time)){
              existing.push(n);
            }
          });
          targetNotes[dayKey] = existing;
        });
        saveMonthlyCalendar(allCals);
        renderCalendar();
        alert('📥 Calendario pegado correctamente');
      }catch(e){
        alert('Error al pegar calendario: formato inválido');
      }
    });
  }



  // Guardar calendario
  document.getElementById('cal-save').addEventListener('click', () => {
    const allCals = loadMonthlyCalendar();
    saveMonthlyCalendar(allCals);
    alert('💾 Calendario guardado correctamente');
  });

  // Limpiar calendario del mes
  document.getElementById('cal-clear').addEventListener('click', () => {
    if(!confirm('¿Limpiar todas las notas de este mes?')) return;
    const allCals = loadMonthlyCalendar();
    if(allCals[currentMonthKey]){
      allCals[currentMonthKey].notes = {};
    }
    saveMonthlyCalendar(allCals);
    renderCalendar();
    alert('🗑️ Mes limpiado');
  });

  // HORARIO SEMANAL (con columna de hora fin)
  function generateTimeOptions() {
    const options = [];
    for (let h = 6; h <= 22; h++) {
      for (let m = 0; m < 60; m += 15) {
        if (h === 22 && m > 45) break;
        const hour = h.toString().padStart(2, '0');
        const min = m.toString().padStart(2, '0');
        const time24 = `${hour}:${min}`;
        const period = h >= 12 ? 'PM' : 'AM';
        const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
        const display = `${h12}:${min} ${period}`;
        options.push({ value: time24, display });
      }
    }
    return options;
  }

  const timeOptions = generateTimeOptions();

  function formatTimeDisplay(time24) {
    if(!time24 || typeof time24 !== 'string') return '';
    const parts = time24.split(':');
    if(parts.length < 2) return time24;
    const h = Number(parts[0]);
    const m = Number(parts[1]);
    if(Number.isNaN(h) || Number.isNaN(m)) return time24;
    const period = h >= 12 ? 'PM' : 'AM';
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${h12}:${m.toString().padStart(2, '0')} ${period}`;
  }

  function getUsedTimes(schedules) {
    const times = new Set();
    schedules.forEach(s => times.add(s.time));
    return Array.from(times).sort();
  }

  function renderSchedule(){
    // Load schedules for current month (using simple schedule storage)
    const allSchedules = loadSimpleSchedule(currentMonthKey);
    
    scheduleTable.innerHTML = '';

    const days = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
    const usedTimes = getUsedTimes(allSchedules);

    if (usedTimes.length === 0) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 8;
      td.style.textAlign = 'center';
      td.style.padding = '2rem';
      td.style.color = '#666';
      td.textContent = 'No hay horarios agregados. Haz clic en "+ Agregar Horario" para comenzar.';
      tr.appendChild(td);
      scheduleTable.appendChild(tr);
      return;
    }

    usedTimes.forEach(time => {
      const tr = document.createElement('tr');

      // Hora con rango
      const schedulesAtTime = allSchedules.filter(s => s.time === time);
      const maxEnd = schedulesAtTime.reduce((max, s) => {
        if(!s.timeEnd) return max;
        return !max || s.timeEnd > max ? s.timeEnd : max;
      }, null);
      
      const hourCell = document.createElement('td');
      hourCell.className = 'hour-cell';
      if(maxEnd){
        hourCell.textContent = `${formatTimeDisplay(time)} - ${formatTimeDisplay(maxEnd)}`;
      } else {
        hourCell.textContent = formatTimeDisplay(time);
      }
      tr.appendChild(hourCell);

      // Celdas de días
      days.forEach(day => {
        const td = document.createElement('td');
        const daySchedules = allSchedules.filter(s => s.day === day && s.time === time);

        daySchedules.forEach(sch => {
          const box = document.createElement('div');
          box.className = 'schedule-item-box';
          if(selectedCalendarIds.has(sch.id)) box.classList.add('selected');
          const bgColor = sch.color || '#f0f0f0';
          box.style.backgroundColor = bgColor;
          box.style.borderLeftColor = bgColor;
          box.style.color = '#fff';

          const title = document.createElement('div');
          title.className = 'title';
          title.style.color = '#fff';
          title.textContent = sch.title;
          box.appendChild(title);

          if(sch.person){
            const person = document.createElement('div');
            person.className = 'person';
            person.textContent = sch.person;
            box.appendChild(person);
          }

          const timeRange = document.createElement('div');
          timeRange.className = 'time-range';
          if(sch.timeEnd){
            timeRange.textContent = `${formatTimeDisplay(sch.time)} - ${formatTimeDisplay(sch.timeEnd)}`;
          } else if(sch.time){
            timeRange.textContent = formatTimeDisplay(sch.time);
          }
          if(timeRange.textContent) box.appendChild(timeRange);

          const deleteBtn = document.createElement('button');
          deleteBtn.className = 'delete-btn';
          deleteBtn.textContent = '×';
          deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if(!confirm('¿Eliminar este horario?')) return;
            // Delete from simple schedule storage
            const schedules = loadSimpleSchedule(currentMonthKey);
            const filtered = schedules.filter(s => s.id !== sch.id);
            saveSimpleSchedule(currentMonthKey, filtered);
            selectedCalendarIds.delete(sch.id);
            renderSchedule();
          });
          box.appendChild(deleteBtn);

          box.addEventListener('click', (e) => {
            if(e.metaKey || e.ctrlKey){
              if(selectedCalendarIds.has(sch.id)) selectedCalendarIds.delete(sch.id); else selectedCalendarIds.add(sch.id);
              box.classList.toggle('selected');
              return;
            }
            openEditScheduleModal(sch);
          });
          td.appendChild(box);
        });

        tr.appendChild(td);
      });

      scheduleTable.appendChild(tr);
    });
  }

  function openAddScheduleModal(){
    const existing = document.querySelector('.modal-backdrop');
    if(existing) existing.remove();

    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.maxWidth = '500px';

    const timeOptionsHTML = timeOptions.map(t => 
      `<option value="${t.value}">${t.display}</option>`
    ).join('');

    modal.innerHTML = `
      <h3>Agregar Horario</h3>
      <div class="form-group">
        <label>Tipo:</label>
        <select id="schedule-type">
          <option value="Disciplina">Disciplina</option>
          <option value="Renta">Renta</option>
          <option value="XV Años">XV Años</option>
          <option value="Coreografía">Coreografía</option>
        </select>
      </div>
      <div class="form-group">
        <label>Título (como aparece):</label>
        <input type="text" id="schedule-title" placeholder="Ej: Ballet Infantil">
      </div>
      <div class="form-group">
        <label>Nombre de Persona (opcional):</label>
        <input type="text" id="schedule-person" placeholder="Ej: María García">
      </div>
      <div class="form-group">
        <label>Día:</label>
        <select id="schedule-day">
          <option value="Lunes">Lunes</option>
          <option value="Martes">Martes</option>
          <option value="Miércoles">Miércoles</option>
          <option value="Jueves">Jueves</option>
          <option value="Viernes">Viernes</option>
          <option value="Sábado">Sábado</option>
          <option value="Domingo">Domingo</option>
        </select>
      </div>
      <div class="form-group">
        <label>Hora de inicio:</label>
        <select id="schedule-time">${timeOptionsHTML}</select>
      </div>
      <div class="form-group">
        <label>Hora de fin (opcional):</label>
        <select id="schedule-time-end">
          <option value="">Sin hora de fin</option>
          ${timeOptionsHTML}
        </select>
      </div>
      <div class="form-group">
        <label>Color:</label>
        <input type="color" id="schedule-color" value="#FF69B4">
      </div>
      <div style="display: flex; gap: 1rem; margin-top: 1.5rem;">
        <button class="btn-cancel" onclick="this.closest('.modal-backdrop').remove()">Cancelar</button>
        <button class="btn-primary" id="save-schedule-btn">Guardar</button>
      </div>
    `;

    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);

    document.getElementById('save-schedule-btn').onclick = () => {
      const type = document.getElementById('schedule-type').value;
      const title = document.getElementById('schedule-title').value.trim();
      const person = document.getElementById('schedule-person').value.trim();
      const day = document.getElementById('schedule-day').value;
      const time = document.getElementById('schedule-time').value;
      const timeEnd = document.getElementById('schedule-time-end').value;
      const color = document.getElementById('schedule-color').value;

      if(!title){
        alert('Por favor ingresa un título');
        return;
      }

      const schedules = loadSimpleSchedule(currentMonthKey);
      
      const newSchedule = {
        id: 'sch-' + Date.now(),
        type,
        title,
        person,
        day,
        time,
        timeEnd: timeEnd || null,
        color
      };

      schedules.push(newSchedule);
      saveSimpleSchedule(currentMonthKey, schedules);
      renderSchedule();
      backdrop.remove();
    };
  }

  function openEditScheduleModal(schedule){
    const existing = document.querySelector('.modal-backdrop');
    if(existing) existing.remove();

    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.maxWidth = '500px';

    const timeOptionsHTML = timeOptions.map(t => {
      const selectedStart = t.value === schedule.time ? 'selected' : '';
      const selectedEnd = t.value === schedule.timeEnd ? 'selected' : '';
      return `<option value="${t.value}" ${selectedStart}>${t.display}</option>`;
    }).join('');

    const timeEndOptionsHTML = `<option value="">Sin hora de fin</option>` + timeOptions.map(t => {
      const selected = t.value === schedule.timeEnd ? 'selected' : '';
      return `<option value="${t.value}" ${selected}>${t.display}</option>`;
    }).join('');

    modal.innerHTML = `
      <h3>Editar Horario</h3>
      <div class="form-group">
        <label>Tipo:</label>
        <select id="edit-schedule-type">
          <option value="Disciplina" ${schedule.type === 'Disciplina' ? 'selected' : ''}>Disciplina</option>
          <option value="Renta" ${schedule.type === 'Renta' ? 'selected' : ''}>Renta</option>
          <option value="XV Años" ${schedule.type === 'XV Años' ? 'selected' : ''}>XV Años</option>
          <option value="Coreografía" ${schedule.type === 'Coreografía' ? 'selected' : ''}>Coreografía</option>
        </select>
      </div>
      <div class="form-group">
        <label>Título (como aparece):</label>
        <input type="text" id="edit-schedule-title" value="${escapeHtml(schedule.title)}">
      </div>
      <div class="form-group">
        <label>Nombre de Persona (opcional):</label>
        <input type="text" id="edit-schedule-person" value="${escapeHtml(schedule.person || '')}">
      </div>
      <div class="form-group">
        <label>Día:</label>
        <select id="edit-schedule-day">
          <option value="Lunes" ${schedule.day === 'Lunes' ? 'selected' : ''}>Lunes</option>
          <option value="Martes" ${schedule.day === 'Martes' ? 'selected' : ''}>Martes</option>
          <option value="Miércoles" ${schedule.day === 'Miércoles' ? 'selected' : ''}>Miércoles</option>
          <option value="Jueves" ${schedule.day === 'Jueves' ? 'selected' : ''}>Jueves</option>
          <option value="Viernes" ${schedule.day === 'Viernes' ? 'selected' : ''}>Viernes</option>
          <option value="Sábado" ${schedule.day === 'Sábado' ? 'selected' : ''}>Sábado</option>
          <option value="Domingo" ${schedule.day === 'Domingo' ? 'selected' : ''}>Domingo</option>
        </select>
      </div>
      <div class="form-group">
        <label>Hora de inicio:</label>
        <select id="edit-schedule-time">${timeOptionsHTML}</select>
      </div>
      <div class="form-group">
        <label>Hora de fin (opcional):</label>
        <select id="edit-schedule-time-end">${timeEndOptionsHTML}</select>
      </div>
      <div class="form-group">
        <label>Color:</label>
        <input type="color" id="edit-schedule-color" value="${schedule.color || '#FF69B4'}">
      </div>
      <div style="display: flex; gap: 1rem; margin-top: 1.5rem;">
        <button class="btn-cancel" onclick="this.closest('.modal-backdrop').remove()">Cancelar</button>
        <button class="btn-primary" id="update-schedule-btn">Actualizar</button>
      </div>
    `;

    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);

    document.getElementById('update-schedule-btn').onclick = () => {
      const type = document.getElementById('edit-schedule-type').value;
      const title = document.getElementById('edit-schedule-title').value.trim();
      const person = document.getElementById('edit-schedule-person').value.trim();
      const day = document.getElementById('edit-schedule-day').value;
      const time = document.getElementById('edit-schedule-time').value;
      const timeEnd = document.getElementById('edit-schedule-time-end').value;
      const color = document.getElementById('edit-schedule-color').value;

      if(!title){
        alert('Por favor ingresa un título');
        return;
      }

      const schedules = loadSimpleSchedule(currentMonthKey);
      const index = schedules.findIndex(s => s.id === schedule.id);
      if(index !== -1){
        schedules[index] = {
          ...schedules[index],
          type,
          title,
          person,
          day,
          time,
          timeEnd: timeEnd || null,
          color
        };
        saveSimpleSchedule(currentMonthKey, schedules);
        renderSchedule();
      }

      backdrop.remove();
    };
  }

  // Conectar botón
  const addBtn = document.getElementById('add-schedule-btn');
  if(addBtn){
    addBtn.addEventListener('click', openAddScheduleModal);
  }

  // Copiar horario (mes actual)
  const copyScheduleBtn = document.getElementById('schedule-copy');
  if(copyScheduleBtn){
    copyScheduleBtn.addEventListener('click', () => {
      const allSchedules = loadSimpleSchedule(currentMonthKey);
      const monthSchedules = selectedCalendarIds.size
        ? allSchedules.filter(s => selectedCalendarIds.has(s.id))
        : allSchedules;
      if(monthSchedules.length === 0){
        alert('No hay horarios para copiar');
        return;
      }
      try{
        localStorage.setItem('rds_simple_schedule_clipboard', JSON.stringify(monthSchedules));
        alert(`📋 ${monthSchedules.length} horarios copiados al portapapeles`);
      }catch(e){
        alert('Error al copiar horarios');
      }
    });
  }

  // Pegar horario (mes actual)
  const pasteScheduleBtn = document.getElementById('schedule-paste');
  if(pasteScheduleBtn){
    pasteScheduleBtn.addEventListener('click', () => {
      const clipData = localStorage.getItem('rds_simple_schedule_clipboard');
      if(!clipData){
        alert('No hay horarios en el portapapeles');
        return;
      }
      try{
        const clipSchedules = JSON.parse(clipData);
        if(!confirm(`¿Pegar ${clipSchedules.length} horarios? Esto se agregará a los horarios existentes.`)) return;
        const monthSchedules = loadSimpleSchedule(currentMonthKey);
        const merged = monthSchedules.concat(clipSchedules.map((s, idx) => ({
          ...s,
          id: 'sch-paste-' + Date.now() + '-' + idx
        })));
        saveSimpleSchedule(currentMonthKey, merged);
        renderSchedule();
        alert(`📥 ${clipSchedules.length} horarios pegados correctamente`);
      }catch(e){
        alert('Error al pegar horarios: formato inválido');
      }
    });
  }



  // Guardar horario
  const saveScheduleBtn = document.getElementById('schedule-save');
  if(saveScheduleBtn){
    saveScheduleBtn.addEventListener('click', () => {
      const allSchedules = loadRentalWeeklySchedule();
      const monthSchedules = allSchedules[currentMonthKey] || [];
      saveRentalWeeklySchedule(allSchedules);
      alert(`💾 ${monthSchedules.length} horarios guardados correctamente`);
    });
  }

  // REMINDERS & NOTES CARD
  const remindersTextarea = document.getElementById('reminders-text');
  const remindersSaveBtn = document.getElementById('reminders-save');
  const remindersClearBtn = document.getElementById('reminders-clear');

  function getRemindersKey(){
    return `rds_reminders_${currentMonthKey}`;
  }

  function loadRemindersForMonth(){
    if(!remindersTextarea) return;
    const savedReminders = localStorage.getItem(getRemindersKey());
    remindersTextarea.value = savedReminders || '';
  }

  if(remindersTextarea && remindersSaveBtn && remindersClearBtn){
    // Load reminders for current month on init
    loadRemindersForMonth();

    remindersSaveBtn.addEventListener('click', () => {
      localStorage.setItem(getRemindersKey(), remindersTextarea.value);
      alert('💾 Recordatorios guardados');
    });

    remindersClearBtn.addEventListener('click', () => {
      if(!confirm('¿Limpiar todos los recordatorios de este mes?')) return;
      remindersTextarea.value = '';
      localStorage.removeItem(getRemindersKey());
      alert('🗑️ Recordatorios eliminados');
    });
  }

  renderCalendar();
  renderSchedule();
}

function syncMonthlyCalendarFromAllSources(){
  try{
    const allCals = loadMonthlyCalendar();
    
    // Mini calendar (alumnas)
    const miniCal = loadCalendar();
    Object.keys(miniCal).forEach(monthKey => {
      const monthData = miniCal[monthKey];
      if(monthData && monthData.days){
        if(!allCals[monthKey]){
          allCals[monthKey] = {
            name: getMonthNameFromKey(monthKey),
            days: getDaysInMonth(monthKey),
            startDay: getStartDayOfMonth(monthKey),
            notes: []
          };
        }
        if(!Array.isArray(allCals[monthKey].notes)) allCals[monthKey].notes = [];
        Object.keys(monthData.days).forEach(day => {
          if(!allCals[monthKey].notes[day]) allCals[monthKey].notes[day] = [];
          const existing = allCals[monthKey].notes[day];
          const newNote = monthData.days[day];
          const notesArr = normalizeNotesArray(newNote);
          notesArr.forEach(n=>{
            if(!existing.find(e=> e.text === n.text && e.type === n.type)){
              existing.push(n);
            }
          });
        });
      }
    });

    // XV calendar
    const xvCal = loadXVCalendar();
    Object.keys(xvCal).forEach(monthKey => {
      const monthData = xvCal[monthKey];
      if(monthData && monthData.days){
        if(!allCals[monthKey]){
          allCals[monthKey] = {
            name: getMonthNameFromKey(monthKey),
            days: getDaysInMonth(monthKey),
            startDay: getStartDayOfMonth(monthKey),
            notes: []
          };
        }
        if(!Array.isArray(allCals[monthKey].notes)) allCals[monthKey].notes = [];
        Object.keys(monthData.days).forEach(day => {
          if(!allCals[monthKey].notes[day]) allCals[monthKey].notes[day] = [];
          const existing = allCals[monthKey].notes[day];
          const newNote = monthData.days[day];
          const notesArr = normalizeNotesArray(newNote);
          notesArr.forEach(n=>{
            if(!existing.find(e=> e.text === n.text && e.type === n.type)){
              existing.push(n);
            }
          });
        });
      }
    });

    // Choreo calendar
    const choreoCal = loadChoreoCalendar();
    Object.keys(choreoCal).forEach(monthKey => {
      const monthData = choreoCal[monthKey];
      if(monthData && monthData.days){
        if(!allCals[monthKey]){
          allCals[monthKey] = {
            name: getMonthNameFromKey(monthKey),
            days: getDaysInMonth(monthKey),
            startDay: getStartDayOfMonth(monthKey),
            notes: []
          };
        }
        if(!Array.isArray(allCals[monthKey].notes)) allCals[monthKey].notes = [];
        Object.keys(monthData.days).forEach(day => {
          if(!allCals[monthKey].notes[day]) allCals[monthKey].notes[day] = [];
          const existing = allCals[monthKey].notes[day];
          const newNote = monthData.days[day];
          const notesArr = normalizeNotesArray(newNote);
          notesArr.forEach(n=>{
            if(!existing.find(e=> e.text === n.text && e.type === n.type)){
              existing.push(n);
            }
          });
        });
      }
    });

    saveMonthlyCalendar(allCals);
    
    // Re-render calendario page if it's currently open
    if(typeof renderCalendar === 'function'){
      renderCalendar();
    }
  }catch(err){
    console.error('Error sincronizando calendario mensual:', err);
  }
}

function syncMonthlyCalendarFromAllSourcesIfNeeded(){
  // Solo sincronizar si se está en la página del calendario o si existe el storage del calendario principal
  // Esto evita sincronizar cada vez que se guarde un mini calendario si no es necesario
  try{
    const hasCalendarPage = document.getElementById('schedule-tbody') !== null;
    if(!hasCalendarPage){
      // Si no estamos en la página del calendario, simplemente sincronizar en background
      syncMonthlyCalendarFromAllSources();
    }
  }catch(e){}
}

function getMonthNameFromKey(key){
  const [year, month] = key.split('-');
  const months = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  return `${months[parseInt(month)-1]} ${year}`;
}

function getDaysInMonth(key){
  const [year, month] = key.split('-').map(Number);
  return new Date(year, month, 0).getDate();
}

function getStartDayOfMonth(key){
  const [year, month] = key.split('-').map(Number);
  return new Date(year, month-1, 1).getDay();
}

/* ========================================
   PÁGINA 6: HISTORIAL MENSUAL
   ======================================== */

const HISTORY_KEY = 'rds_monthly_history_v1';
const TEACHERS_KEY = 'rds_teachers_v1';

function loadHistory(){
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch(e) {
    console.error('Error loading history:', e);
    return [];
  }
}

function saveHistory(records){
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(records));
  } catch(e) {
    console.error('Error saving history:', e);
  }
}

function loadTeachers(){
  try {
    const raw = localStorage.getItem(TEACHERS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch(e) {
    console.error('Error loading teachers:', e);
    return [];
  }
}

function saveTeachers(teachers){
  try {
    localStorage.setItem(TEACHERS_KEY, JSON.stringify(teachers));
  } catch(e) {
    console.error('Error saving teachers:', e);
  }
}

function initHistoryPage(){
  let currentEditingId = null;
  let currentTeachers = loadTeachers();

  function getMonthKeyFromName(monthName, year){
    const map = {
      'enero':'01','febrero':'02','marzo':'03','abril':'04','mayo':'05','junio':'06',
      'julio':'07','agosto':'08','septiembre':'09','octubre':'10','noviembre':'11','diciembre':'12'
    };
    const mm = map[(monthName||'').toLowerCase()] || '';
    if(!mm || !year) return '';
    return `${year}-${mm}`;
  }

  function formatCurrency(n){
    const val = Number(n) || 0;
    return `$${val.toLocaleString('es-MX')}`;
  }

  function generateMonthlyReport(){
    const monthName = document.getElementById('history-month').value.trim();
    const year = document.getElementById('history-year').value.trim();
    if(!monthName || !year){
      alert('Por favor completa mes y año');
      return;
    }
    const monthKey = getMonthKeyFromName(monthName, year);
    if(!monthKey){
      alert('Mes inválido. Usa nombres como "Enero", "Febrero", etc.');
      return;
    }

    const students = loadStudents();
    const rentals = loadRentalPeople();
    const xvList = loadXVQuinceaneras();
    const choreoList = loadChoreographies();
    const attendance = loadAttendance();

    const studentsInMonth = students.filter(s=> (s.personal?.inscriptionDate||'').startsWith(monthKey));
    const rentalsInMonth = rentals.filter(r=> r.monthYear === monthKey);
    const xvInMonth = xvList.filter(x=> x.monthYear === monthKey);
    const choreoInMonth = choreoList.filter(c=> c.monthYear === monthKey);

    let totalPayments = 0;
    students.forEach(s=>{
      (s.personal?.payments||[]).forEach(p=>{
        if(p.date && p.date.startsWith(monthKey)) totalPayments += Number(p.amount)||0;
      });
    });

    let attendanceCount = 0;
    Object.keys(attendance||{}).forEach(dateKey=>{
      if(!dateKey.startsWith(monthKey)) return;
      const byDisc = attendance[dateKey]||{};
      Object.keys(byDisc).forEach(disc=>{
        const recs = byDisc[disc]||{};
        Object.keys(recs).forEach(id=>{ if(recs[id]?.present) attendanceCount += 1; });
      });
    });

    const rentalsTotal = rentalsInMonth.reduce((s,r)=>s+(Number(r.amount)||0),0);
    totalPayments += rentalsTotal;

    const studentsText = `${studentsInMonth.length} alumnas inscritas. Asistencias registradas: ${attendanceCount}.`;
    const rentalsText = `${rentalsInMonth.length} personas rentando en el mes. Total estimado: ${formatCurrency(rentalsTotal)}.`;
    const montajesText = `${xvInMonth.length} XV Años y ${choreoInMonth.length} coreografías registradas en el mes.`;

    const notesExtraText = `Resumen automático generado el ${new Date().toLocaleDateString('es-MX')}.`;

    document.getElementById('history-students').value = studentsText;
    document.getElementById('history-rentals').value = rentalsText;
    document.getElementById('history-montajes').value = montajesText;
    document.getElementById('history-total-payments').value = formatCurrency(totalPayments);
    document.getElementById('history-notes-extra').value = notesExtraText;
  }
  
  function renderTeachersTable(){
    const tbody = document.getElementById('teachers-tbody');
    if(!tbody) return;
    
    tbody.innerHTML = '';
    if(currentTeachers.length === 0){
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:20px">No hay maestros registrados</td></tr>';
      return;
    }
    
    currentTeachers.forEach(teacher => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(teacher.name)}</td>
        <td>${escapeHtml(teacher.phone)}</td>
        <td>${escapeHtml(teacher.disciplines)}</td>
        <td>${escapeHtml(teacher.payment)}</td>
        <td>${escapeHtml(teacher.debt)}</td>
        <td>${escapeHtml(teacher.paymentDay)}</td>
        <td>
          <button class="btn btn-secondary" onclick="editTeacher('${teacher.id}')">Editar</button>
          <button class="btn" style="background:#ff4444" onclick="deleteTeacher('${teacher.id}')">Eliminar</button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }
  
  function openAddTeacherModal(){
    const existing = document.querySelector('.modal-backdrop');
    if(existing) existing.remove();
    
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.maxWidth = '600px';
    
    modal.innerHTML = `
      <h3>Agregar Maestro</h3>
      <div style="margin-bottom:12px">
        <label style="display:block;margin-bottom:4px;font-weight:600">Nombre *</label>
        <input id="teacher-name" type="text" class="input" style="width:100%" placeholder="Ej: Juan Pérez" />
      </div>
      <div style="margin-bottom:12px">
        <label style="display:block;margin-bottom:4px;font-weight:600">Número</label>
        <input id="teacher-phone" type="text" class="input" style="width:100%" placeholder="Ej: 555-1234" />
      </div>
      <div style="margin-bottom:12px">
        <label style="display:block;margin-bottom:4px;font-weight:600">Disciplinas</label>
        <input id="teacher-disciplines" type="text" class="input" style="width:100%" placeholder="Ej: Ballet, Jazz" />
      </div>
      <div style="margin-bottom:12px">
        <label style="display:block;margin-bottom:4px;font-weight:600">Pago</label>
        <input id="teacher-payment" type="text" class="input" style="width:100%" placeholder="Ej: $5,000" />
      </div>
      <div style="margin-bottom:12px">
        <label style="display:block;margin-bottom:4px;font-weight:600">A Deber</label>
        <input id="teacher-debt" type="text" class="input" style="width:100%" placeholder="Ej: $1,000" />
      </div>
      <div style="margin-bottom:12px">
        <label style="display:block;margin-bottom:4px;font-weight:600">Día de Pago</label>
        <input id="teacher-payment-day" type="text" class="input" style="width:100%" placeholder="Ej: Viernes 15" />
      </div>
      <div style="text-align:right;margin-top:16px">
        <button id="save-teacher" class="btn">Guardar</button>
        <button id="cancel-teacher" class="btn btn-secondary">Cancelar</button>
      </div>
    `;
    
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
    
    document.getElementById('cancel-teacher').addEventListener('click', () => backdrop.remove());
    document.getElementById('save-teacher').addEventListener('click', () => {
      const name = document.getElementById('teacher-name').value.trim();
      const phone = document.getElementById('teacher-phone').value.trim();
      const disciplines = document.getElementById('teacher-disciplines').value.trim();
      const payment = document.getElementById('teacher-payment').value.trim();
      const debt = document.getElementById('teacher-debt').value.trim();
      const paymentDay = document.getElementById('teacher-payment-day').value.trim();
      
      if(!name){
        alert('Por favor ingresa el nombre del maestro');
        return;
      }
      
      const newTeacher = {
        id: `teacher-${Date.now()}`,
        name,
        phone,
        disciplines,
        payment,
        debt,
        paymentDay
      };
      
      currentTeachers.push(newTeacher);
      saveTeachers(currentTeachers);
      renderTeachersTable();
      backdrop.remove();
    });
  }
  
  window.editTeacher = function(id){
    const teacher = currentTeachers.find(t => t.id === id);
    if(!teacher) return;
    
    const existing = document.querySelector('.modal-backdrop');
    if(existing) existing.remove();
    
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.maxWidth = '600px';
    
    modal.innerHTML = `
      <h3>Editar Maestro</h3>
      <div style="margin-bottom:12px">
        <label style="display:block;margin-bottom:4px;font-weight:600">Nombre *</label>
        <input id="teacher-name" type="text" class="input" style="width:100%" value="${escapeHtml(teacher.name)}" />
      </div>
      <div style="margin-bottom:12px">
        <label style="display:block;margin-bottom:4px;font-weight:600">Número</label>
        <input id="teacher-phone" type="text" class="input" style="width:100%" value="${escapeHtml(teacher.phone)}" />
      </div>
      <div style="margin-bottom:12px">
        <label style="display:block;margin-bottom:4px;font-weight:600">Disciplinas</label>
        <input id="teacher-disciplines" type="text" class="input" style="width:100%" value="${escapeHtml(teacher.disciplines)}" />
      </div>
      <div style="margin-bottom:12px">
        <label style="display:block;margin-bottom:4px;font-weight:600">Pago</label>
        <input id="teacher-payment" type="text" class="input" style="width:100%" value="${escapeHtml(teacher.payment)}" />
      </div>
      <div style="margin-bottom:12px">
        <label style="display:block;margin-bottom:4px;font-weight:600">A Deber</label>
        <input id="teacher-debt" type="text" class="input" style="width:100%" value="${escapeHtml(teacher.debt)}" />
      </div>
      <div style="margin-bottom:12px">
        <label style="display:block;margin-bottom:4px;font-weight:600">Día de Pago</label>
        <input id="teacher-payment-day" type="text" class="input" style="width:100%" value="${escapeHtml(teacher.paymentDay)}" />
      </div>
      <div style="text-align:right;margin-top:16px">
        <button id="save-teacher" class="btn">Guardar</button>
        <button id="cancel-teacher" class="btn btn-secondary">Cancelar</button>
      </div>
    `;
    
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
    
    document.getElementById('cancel-teacher').addEventListener('click', () => backdrop.remove());
    document.getElementById('save-teacher').addEventListener('click', () => {
      const name = document.getElementById('teacher-name').value.trim();
      const phone = document.getElementById('teacher-phone').value.trim();
      const disciplines = document.getElementById('teacher-disciplines').value.trim();
      const payment = document.getElementById('teacher-payment').value.trim();
      const debt = document.getElementById('teacher-debt').value.trim();
      const paymentDay = document.getElementById('teacher-payment-day').value.trim();
      
      if(!name){
        alert('Por favor ingresa el nombre del maestro');
        return;
      }
      
      const index = currentTeachers.findIndex(t => t.id === id);
      if(index !== -1){
        currentTeachers[index] = {
          ...currentTeachers[index],
          name,
          phone,
          disciplines,
          payment,
          debt,
          paymentDay
        };
        saveTeachers(currentTeachers);
        renderTeachersTable();
      }
      backdrop.remove();
    });
  };
  
  window.deleteTeacher = function(id){
    if(!confirm('¿Eliminar este maestro? Se mantendrá en registros anteriores pero no aparecerá en nuevos registros.')) return;
    
    currentTeachers = currentTeachers.filter(t => t.id !== id);
    saveTeachers(currentTeachers);
    renderTeachersTable();
  };
  
  function renderHistoryList(){
    const list = document.getElementById('history-list');
    if(!list) return;
    
    const records = loadHistory();
    
    if(records.length === 0){
      list.innerHTML = '<p style="text-align:center;color:var(--muted);padding:40px">No hay registros mensuales guardados</p>';
      return;
    }
    
    list.innerHTML = '';
    records.sort((a,b) => new Date(b.year, getMonthNumber(b.month)) - new Date(a.year, getMonthNumber(a.month)));
    
    records.forEach(record => {
      const item = document.createElement('div');
      item.className = 'history-record-item';
      item.innerHTML = `
        <div>
          <div class="history-record-title">${escapeHtml(record.month)} ${escapeHtml(record.year)}</div>
          <div class="history-record-date">Total: ${escapeHtml(record.totalPayments)}</div>
        </div>
        <div class="history-record-actions">
          <button class="btn btn-secondary" onclick="viewHistoryRecord('${record.id}')">Ver</button>
          <button class="btn" style="background:#ff4444" onclick="deleteHistoryRecord('${record.id}')">Eliminar</button>
        </div>
      `;
      list.appendChild(item);
    });
  }
  
  function getMonthNumber(monthName){
    const months = {
      'enero':0,'febrero':1,'marzo':2,'abril':3,'mayo':4,'junio':5,
      'julio':6,'agosto':7,'septiembre':8,'octubre':9,'noviembre':10,'diciembre':11
    };
    return months[monthName.toLowerCase()] || 0;
  }
  
  window.viewHistoryRecord = function(id){
    const records = loadHistory();
    const record = records.find(r => r.id === id);
    if(!record) return;
    
    currentEditingId = id;
    document.getElementById('history-month').value = record.month;
    document.getElementById('history-year').value = record.year;
    document.getElementById('history-students').value = record.students;
    document.getElementById('history-rentals').value = record.rentals;
    document.getElementById('history-montajes').value = record.montajes;
    document.getElementById('history-total-payments').value = record.totalPayments;
    document.getElementById('history-expenses').value = record.expenses;
    document.getElementById('history-notes-extra').value = record.notesExtra;
    document.getElementById('history-notes-additional').value = record.notesAdditional;
    
    currentTeachers = record.teachers || loadTeachers();
    renderTeachersTable();
    
    window.scrollTo(0, 0);
  };
  
  window.deleteHistoryRecord = function(id){
    if(!confirm('¿Eliminar este registro mensual?')) return;
    
    let records = loadHistory();
    const rec = records.find(r => r.id === id);
    if(rec){ addArchiveEntry('Historial', `${rec.month||''} ${rec.year||''}`.trim(), rec); }
    records = records.filter(r => r.id !== id);
    saveHistory(records);
    renderHistoryList();
  };
  
  function clearForm(){
    document.getElementById('history-month').value = '';
    document.getElementById('history-year').value = '';
    document.getElementById('history-students').value = '';
    document.getElementById('history-rentals').value = '';
    document.getElementById('history-montajes').value = '';
    document.getElementById('history-total-payments').value = '';
    document.getElementById('history-expenses').value = '';
    document.getElementById('history-notes-extra').value = '';
    document.getElementById('history-notes-additional').value = '';
    currentTeachers = loadTeachers();
    renderTeachersTable();
    currentEditingId = null;
  }
  
  // Event Listeners
  const addTeacherBtn = document.getElementById('add-teacher-btn');
  if(addTeacherBtn){
    addTeacherBtn.addEventListener('click', openAddTeacherModal);
  }
  
  const saveHistoryBtn = document.getElementById('save-history-btn');
  if(saveHistoryBtn){
    saveHistoryBtn.addEventListener('click', () => {
      const month = document.getElementById('history-month').value.trim();
      const year = document.getElementById('history-year').value.trim();
      const students = document.getElementById('history-students').value.trim();
      const rentals = document.getElementById('history-rentals').value.trim();
      const montajes = document.getElementById('history-montajes').value.trim();
      const totalPayments = document.getElementById('history-total-payments').value.trim();
      const expenses = document.getElementById('history-expenses').value.trim();
      const notesExtra = document.getElementById('history-notes-extra').value.trim();
      const notesAdditional = document.getElementById('history-notes-additional').value.trim();
      
      if(!month || !year){
        alert('Por favor completa al menos el mes y el año');
        return;
      }
      
      const records = loadHistory();
      
      if(currentEditingId){
        // Update existing record
        const index = records.findIndex(r => r.id === currentEditingId);
        if(index !== -1){
          records[index] = {
            ...records[index],
            month,
            year,
            students,
            rentals,
            montajes,
            totalPayments,
            expenses,
            notesExtra,
            notesAdditional,
            teachers: [...currentTeachers]
          };
        }
      } else {
        // Create new record
        const newRecord = {
          id: `history-${Date.now()}`,
          month,
          year,
          students,
          rentals,
          montajes,
          totalPayments,
          expenses,
          notesExtra,
          notesAdditional,
          teachers: [...currentTeachers],
          createdAt: new Date().toISOString()
        };
        records.push(newRecord);
      }
      
      saveHistory(records);
      renderHistoryList();
      clearForm();
      alert('Registro guardado correctamente');
    });
  }

  const generateHistoryBtn = document.getElementById('generate-history-btn');
  if(generateHistoryBtn){
    generateHistoryBtn.addEventListener('click', generateMonthlyReport);
  }
  
  renderTeachersTable();
  renderHistoryList();
}

/* ========================================
   PÁGINA 7: RESPALDO DE DATOS
   ======================================== */

function initBackupPage(){
  function getSelectedStatsMonthKey(){
    const monthSel = document.getElementById('stats-month');
    const yearSel = document.getElementById('stats-year');
    const month = monthSel?.value || '';
    const year = yearSel?.value || '';
    if(month && year) return `${year}-${month}`;
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  }

  function getMonthKeyFromDateString(dateStr){
    if(!dateStr || typeof dateStr !== 'string') return '';
    if(/^\d{4}-\d{2}/.test(dateStr)) return dateStr.slice(0,7);
    return '';
  }

  function getMonthNumberFromName(monthName){
    const months = {
      'enero':1,'febrero':2,'marzo':3,'abril':4,'mayo':5,'junio':6,
      'julio':7,'agosto':8,'septiembre':9,'octubre':10,'noviembre':11,'diciembre':12
    };
    return months[(monthName||'').toLowerCase()] || 0;
  }

  function calculateStats(){
    const selectedMonth = getSelectedStatsMonthKey();
    const students = loadStudents();
    const rentals = loadRentalPeople();
    const xvList = loadXVQuinceaneras();
    const choreoList = loadChoreographies();
    const history = loadHistory();

    const studentsInMonth = students.filter(s=> getMonthKeyFromDateString(s?.personal?.inscriptionDate) === selectedMonth);
    const rentalsInMonth = rentals.filter(r=> r.monthYear === selectedMonth);
    const xvInMonth = xvList.filter(x=> x.monthYear === selectedMonth);
    const choreoInMonth = choreoList.filter(c=> c.monthYear === selectedMonth);

    const totalRecords = studentsInMonth.length + rentalsInMonth.length + xvInMonth.length + choreoInMonth.length;
    const totalStudents = studentsInMonth.length;
    const totalMontajes = xvInMonth.length + choreoInMonth.length;
    const totalRentals = rentalsInMonth.length;

    let totalRevenue = 0;
    history.forEach(record => {
      const monthNum = getMonthNumberFromName(record.month);
      const recordKey = monthNum ? `${record.year}-${String(monthNum).padStart(2,'0')}` : '';
      if(recordKey !== selectedMonth) return;
      const payment = record.totalPayments || '';
      const amount = parseFloat(String(payment).replace(/[$,]/g, ''));
      if(!isNaN(amount)) totalRevenue += amount;
    });

    return {
      totalRecords,
      totalStudents,
      totalMontajes,
      totalRentals,
      totalRevenue
    };
  }
  
  function renderStats(){
    const stats = calculateStats();
    
    document.getElementById('stat-total').textContent = stats.totalRecords;
    document.getElementById('stat-students').textContent = stats.totalStudents;
    document.getElementById('stat-montajes').textContent = stats.totalMontajes;
    document.getElementById('stat-rentals').textContent = stats.totalRentals;
    document.getElementById('stat-revenue').textContent = `$${stats.totalRevenue.toLocaleString('es-MX')}`;
  }
  
  function renderArchiveList(){
    const list = document.getElementById('archive-list');
    if(!list) return;
    const typeFilter = document.getElementById('archive-type')?.value || 'all';
    const monthVal = document.getElementById('archive-month')?.value || '';
    const yearVal = document.getElementById('archive-year')?.value || '';
    const monthFilter = monthVal && yearVal ? `${yearVal}-${monthVal}` : '';
    const searchFilter = (document.getElementById('archive-search')?.value || '').toLowerCase().trim();
    let items = loadArchive();
    if(typeFilter !== 'all'){
      items = items.filter(i=> i.type === typeFilter);
    }
    if(monthFilter){
      items = items.filter(i=> (i.deletedAt||'').startsWith(monthFilter));
    }
    if(searchFilter){
      items = items.filter(i=>{
        const label = (i.label||'').toLowerCase();
        const dataStr = JSON.stringify(i.data||{}).toLowerCase();
        return label.includes(searchFilter) || dataStr.includes(searchFilter);
      });
    }
    if(items.length === 0){
      list.innerHTML = '<div style="color:var(--muted);padding:12px">No hay eliminados registrados.</div>';
      return;
    }
    list.innerHTML = '';
    items.forEach(item=>{
      const row = document.createElement('div');
      row.style.border = '1px solid rgba(0,0,0,0.06)';
      row.style.borderRadius = '10px';
      row.style.padding = '12px';
      row.style.background = 'var(--card)';
      row.innerHTML = `
        <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap">
          <div>
            <div style="font-weight:700;color:var(--pink)">${escapeHtml(item.type||'')}</div>
            <div style="color:var(--muted);font-size:13px">${escapeHtml(item.label||'')}</div>
          </div>
          <div style="font-weight:700;color:var(--black)">${escapeHtml((item.deletedAt||'').replace('T',' ').slice(0,16))}</div>
        </div>
        <pre style="margin:10px 0 0 0;background:rgba(0,0,0,0.03);padding:10px;border-radius:8px;overflow:auto;max-height:200px">${escapeHtml(JSON.stringify(item.data||{}, null, 2))}</pre>
      `;
      list.appendChild(row);
    });
  }
  
  function populateMonthYearSelects(monthEl, yearEl){
    if(!monthEl || !yearEl) return;
    const months = [
      ['01','Enero'],['02','Febrero'],['03','Marzo'],['04','Abril'],['05','Mayo'],['06','Junio'],
      ['07','Julio'],['08','Agosto'],['09','Septiembre'],['10','Octubre'],['11','Noviembre'],['12','Diciembre']
    ];
    monthEl.innerHTML = months.map(m=>`<option value="${m[0]}">${m[1]}</option>`).join('');
    const now = new Date();
    const currentYear = now.getFullYear();
    const years = [];
    for(let y=currentYear-3; y<=currentYear+3; y++) years.push(y);
    yearEl.innerHTML = years.map(y=>`<option value="${y}">${y}</option>`).join('');
    monthEl.value = String(now.getMonth()+1).padStart(2,'0');
    yearEl.value = String(currentYear);
  }

  const statsMonthSel = document.getElementById('stats-month');
  const statsYearSel = document.getElementById('stats-year');
  populateMonthYearSelects(statsMonthSel, statsYearSel);
  if(statsMonthSel) statsMonthSel.addEventListener('change', renderStats);
  if(statsYearSel) statsYearSel.addEventListener('change', renderStats);

  const archiveType = document.getElementById('archive-type');
  if(archiveType){
    archiveType.addEventListener('change', renderArchiveList);
  }
  const archiveMonth = document.getElementById('archive-month');
  const archiveYear = document.getElementById('archive-year');
  populateMonthYearSelects(archiveMonth, archiveYear);
  if(archiveMonth){
    archiveMonth.addEventListener('change', renderArchiveList);
  }
  if(archiveYear){
    archiveYear.addEventListener('change', renderArchiveList);
  }
  const archiveSearch = document.getElementById('archive-search');
  if(archiveSearch){
    archiveSearch.addEventListener('input', renderArchiveList);
  }

  const archiveToggle = document.getElementById('archive-toggle');
  if(archiveToggle){
    archiveToggle.addEventListener('click', ()=>{
      const list = document.getElementById('archive-list');
      if(!list) return;
      const isHidden = list.style.display === 'none';
      list.style.display = isHidden ? 'flex' : 'none';
      archiveToggle.textContent = isHidden ? 'Ocultar archivo' : 'Mostrar archivo';
    });
  }

  const backupExportBtn = document.getElementById('backup-export-btn');
  const backupImportBtn = document.getElementById('backup-import-btn');
  const backupImportFile = document.getElementById('backup-import-file');

  if(backupExportBtn){
    backupExportBtn.addEventListener('click', ()=>{
      const data = {
        meta: { name: 'ReplayDanceStudio Backup', version: 1, exportedAt: new Date().toISOString() },
        storage: {}
      };
      for(let i=0; i<localStorage.length; i++){
        const key = localStorage.key(i);
        if(key) data.storage[key] = localStorage.getItem(key);
      }
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `replay-backup-${new Date().toISOString().slice(0,10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    });
  }

  if(backupImportBtn && backupImportFile){
    backupImportBtn.addEventListener('click', ()=> backupImportFile.click());
    backupImportFile.addEventListener('change', (e)=>{
      const file = e.target.files && e.target.files[0];
      if(!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(String(reader.result||'{}'));
          if(!data || !data.storage || typeof data.storage !== 'object'){
            alert('Archivo de respaldo inválido.');
            return;
          }
          if(!confirm('Esto reemplazará la información actual. ¿Deseas continuar?')) return;
          localStorage.clear();
          Object.keys(data.storage).forEach(key=>{
            localStorage.setItem(key, data.storage[key]);
          });
          alert('Respaldo importado correctamente. Recarga la página para ver los cambios.');
        } catch (err){
          console.error(err);
          alert('No se pudo leer el respaldo.');
        } finally {
          backupImportFile.value = '';
        }
      };
      reader.readAsText(file);
    });
  }

  renderStats();
  renderArchiveList();
  // Auto-refresh stats and logs every 2s
  setInterval(()=>{
    renderStats();
    renderArchiveList();
  }, 2000);
}
