
// ============================================================
// ESTADO Y PERSISTENCIA (localStorage como prototipo)
// ============================================================
// LS_KEY y INSTITUTION se setean dentro de boot() tras cargar la config
let LS_KEY = 'anestesia_app_v1';
let INSTITUTION = null;
const DEFAULT_STATE = {
  isAdmin: false,
  adminPinHash: null,         // PIN del administrador (configurado al primer ingreso)
  currentUserId: null,        // Usuario logueado actualmente (null = nadie)
  staff: [], // se llena desde configs/<id>.json en boot()
  seedVersion: 8,
  shifts: [], // {date:'2026-05-13', staffId:'s1', type:'Mañana|Tarde|Guardia|Llamada', notes:''}
  exchanges: [],
  vacations: [], // {id, staffId, from, to, resolved:[{date,type,coveredBy}], pending:[{date,type}], notes, status:'pending|approved|rejected', adminNote, createdAt, decidedAt}
  events: [], // {id, type:'reunion-servicio|reunion-direccion|dia-conmemorativo|otro', title, date:'YYYY-MM-DD', time:'HH:MM', location, description, createdBy, createdAt}
  notifShown: [], // ids+día de cosas ya notificadas para no repetir
  protocols: [
    {id:'p_eras', title:'ERAS Colon y Bariátrica', body:'Protocolo de recuperación acelerada (ERAS) para cirugía de colon y bariátrica.', fileUrl:'protocolos/ERAS-Colon-y-Bariatrica.pdf', fileName:'ERAS Colon y Bariatrica.pdf'},
    {id:'p1', title:'Manejo de vía aérea difícil', body:'Algoritmo DAS: 1) Plan A: laringoscopía directa o VL...', fileUrl:'', fileName:''},
    {id:'p2', title:'Anafilaxia perioperatoria', body:'Adrenalina IM 0,5 mg en muslo. Suspender desencadenante...', fileUrl:'', fileName:''},
    {id:'p3', title:'Hipertermia maligna', body:'Suspender halogenados. Dantroleno 2,5 mg/kg IV...', fileUrl:'', fileName:''},
    {id:'p4', title:'Sangrado masivo', body:'Activar protocolo. Ratio 1:1:1 (GR:Plasma:Plaquetas)...', fileUrl:'', fileName:''},
  ],
  stats: {
    casesByMonth: [120,135,128,142,150,138,145,160,155,148,140,132],
    procedureTypes: {General:45, Regional:25, Sedacion:18, Combinada:12},
    customStaffLoad: null, // [{n:'Dr. X', v:12}] si se cargó desde Excel; null = calcular desde turnos
    hidden: {cases:false, type:false, staff:false},
    lastImport: null // {at:'ISO', filename:'...', sheets:[...]}
  },
  currentMonth: new Date().toISOString().slice(0,7),
  externalSource: null, // { url, type:'gsheet-csv'|'xlsx', lastSync, replace:true }
  horarioEmbedURL: '' // se llena desde configs/<id>.json en boot(),
};

let state = null; // se asigna en boot()

function load(){
  try{
    const raw = localStorage.getItem(LS_KEY);
    const def = JSON.parse(JSON.stringify(DEFAULT_STATE));
    if(!raw) return def;
    const merged = {...def, ...JSON.parse(raw)};
    if(!merged.horarioEmbedURL) merged.horarioEmbedURL = def.horarioEmbedURL;
    // Migración v2: cargar nombres reales del servicio si la instalación previa tenía el equipo de muestra
    if((merged.seedVersion||1) < 2){
      merged.staff = def.staff;
      merged.shifts = (merged.shifts||[]).filter(s=>def.staff.some(st=>st.id===s.staffId));
      merged.exchanges = (merged.exchanges||[]).filter(e=>def.staff.some(st=>st.id===e.staffId));
      merged.vacations = (merged.vacations||[]).filter(v=>def.staff.some(st=>st.id===v.staffId));
      merged.seedVersion = 2;
    }
    // Migración v3: nueva estructura de puntaje del Índice de Permanencia (preserva nombres y roles)
    if((merged.seedVersion||1) < 3){
      merged.staff = (merged.staff||[]).map(s=>({
        id: s.id,
        name: s.name,
        role: s.role || 'Staff',
        cumplimientoJornadas: s.cumplimientoJornadas || '75-85',
        jornadasBorradas: typeof s.jornadasBorradas==='number'?s.jornadasBorradas:0,
        equipoTMT: !!s.equipoTMT,
        equipoCardio: !!s.equipoCardio,
        equipoPediatria: !!s.equipoPediatria,
        rolCoordinacion: !!s.rolCoordinacion,
        noFondoComun: !!s.noFondoComun,
      }));
      delete merged.weights;
      merged.seedVersion = 3;
    }
    // Migración v4: agregar campos fileUrl/fileName a protocolos y agregar el ERAS si no existe
    if((merged.seedVersion||1) < 4){
      merged.protocols = (merged.protocols||[]).map(p=>({
        ...p,
        fileUrl: p.fileUrl || '',
        fileName: p.fileName || '',
      }));
      if(!merged.protocols.some(p=>p.id==='p_eras')){
        merged.protocols.unshift({id:'p_eras', title:'ERAS Colon y Bariátrica', body:'Protocolo de recuperación acelerada (ERAS) para cirugía de colon y bariátrica.', fileUrl:'protocolos/ERAS-Colon-y-Bariatrica.pdf', fileName:'ERAS Colon y Bariatrica.pdf'});
      }
      merged.seedVersion = 4;
    }
    // Migración v5: forzar el listado real de anestesiólogos si todavía aparecen nombres de muestra
    if((merged.seedVersion||1) < 5){
      const realNames = new Set(def.staff.map(s=>s.name.toLowerCase()));
      const currentNames = (merged.staff||[]).map(s=>(s.name||'').toLowerCase());
      const hasDemoNames = currentNames.some(n=>['garcía','garcia','lópez','lopez','pérez','perez','rodriguez','rodríguez','martín','martin','sánchez','sanchez','dr.','dra.'].some(d=>n.includes(d) && !realNames.has(n)));
      const allRealNamesPresent = def.staff.every(d=>currentNames.includes(d.name.toLowerCase()));
      if(hasDemoNames || !allRealNamesPresent){
        // Conservar puntajes que ya existieran para nombres reales
        const oldByName = {};
        (merged.staff||[]).forEach(s=>{ oldByName[(s.name||'').toLowerCase()] = s; });
        merged.staff = def.staff.map(d=>{
          const o = oldByName[d.name.toLowerCase()];
          if(o){
            return {
              ...d,
              cumplimientoJornadas: o.cumplimientoJornadas || d.cumplimientoJornadas,
              jornadasBorradas: typeof o.jornadasBorradas==='number'?o.jornadasBorradas:d.jornadasBorradas,
              equipoTMT: !!o.equipoTMT,
              equipoCardio: !!o.equipoCardio,
              equipoPediatria: !!o.equipoPediatria,
              rolCoordinacion: !!o.rolCoordinacion,
              noFondoComun: !!o.noFondoComun,
              role: o.role || d.role,
            };
          }
          return d;
        });
        const validIds = new Set(merged.staff.map(s=>s.id));
        merged.shifts = (merged.shifts||[]).filter(s=>validIds.has(s.staffId));
        merged.exchanges = (merged.exchanges||[]).filter(e=>validIds.has(e.staffId));
        merged.vacations = (merged.vacations||[]).filter(v=>validIds.has(v.staffId));
      }
      merged.seedVersion = 5;
    }
    // Migración v6: agregar campos de Cobertura Emergencia
    if((merged.seedVersion||1) < 6){
      const exemptNames = new Set(['guerrero','veliz','julio v.','julio v','ricke']);
      merged.staff = (merged.staff||[]).map(s=>({
        ...s,
        residenciaAnios: s.residenciaAnios || '1-5',
        esResidente: !!s.esResidente,
        llamadaPediatrica: !!s.llamadaPediatrica,
        llamadaCardio: !!s.llamadaCardio,
        primeraLlamadaFija: !!s.primeraLlamadaFija,
        segundaLlamadaFija: !!s.segundaLlamadaFija,
        exentoCobertura: typeof s.exentoCobertura==='boolean'
          ? s.exentoCobertura
          : exemptNames.has((s.name||'').toLowerCase()),
      }));
      merged.seedVersion = 6;
    }
    // Migración v7: campos de coberturas ya realizadas (turno urgencia / llamadas)
    if((merged.seedVersion||1) < 7){
      merged.staff = (merged.staff||[]).map(s=>({
        ...s,
        coberturaTurnoUrg: !!s.coberturaTurnoUrg,
        coberturaLlamada1: !!s.coberturaLlamada1,
        coberturaLlamada2: !!s.coberturaLlamada2,
      }));
      merged.seedVersion = 7;
    }
    return merged;
  }catch(e){return JSON.parse(JSON.stringify(DEFAULT_STATE));}
}
function save(){
  localStorage.setItem(LS_KEY, JSON.stringify(state));
  scheduleSyncPush();
}

// ============================================================
// SYNC con backend (Cloudflare Worker + KV)
// ============================================================
const BACKEND_TOKEN_LS_KEY = 'appnesthesia_backend_token';
// Campos que NO se sincronizan (son personales/por-dispositivo)
const LOCAL_ONLY_KEYS = new Set(['isAdmin','adminPinHash','currentUserId','notifShown']);
let _syncTimer = null;
let _syncStatus = 'idle';
let _lastRemoteUpdatedAt = null;
let _isApplyingRemote = false;

function getBackendURL(){
  // 1) Override por institución
  if(INSTITUTION && INSTITUTION.backendURL) return String(INSTITUTION.backendURL).replace(/\/$/,'');
  // 2) Override local
  const local = localStorage.getItem('appnesthesia_backend_url');
  if(local) return String(local).replace(/\/$/,'');
  return null;
}
function setBackendURL(url){
  if(url) localStorage.setItem('appnesthesia_backend_url', url);
  else localStorage.removeItem('appnesthesia_backend_url');
}
function getBackendToken(){ return localStorage.getItem(BACKEND_TOKEN_LS_KEY) || ''; }
function setBackendToken(t){
  if(t) localStorage.setItem(BACKEND_TOKEN_LS_KEY, t);
  else localStorage.removeItem(BACKEND_TOKEN_LS_KEY);
}

function _renderSyncIndicator(){
  const el = document.getElementById('syncStatus');
  if(!el) return;
  const map = {
    idle:    ['Listo','#94a3b8',''],
    syncing: ['Sincronizando…','#f59e0b','spin'],
    synced:  ['Sincronizado','#22c55e',''],
    offline: ['Sin conexión','#94a3b8',''],
    unauthorized:['Token requerido','#dc2626',''],
    error:   ['Error de sync','#dc2626',''],
    disabled:['Sin backend','#dc2626',''],
  };
  const [label,color,extra] = map[_syncStatus] || ['', '#94a3b8',''];
  // Mostrar SIEMPRE al admin (diagnóstico). A usuarios normales solo cuando hay actividad real.
  const isAdmin = state && state.isAdmin;
  const interesting = ['syncing','synced','unauthorized','error'].includes(_syncStatus);
  if(!label || (!isAdmin && !interesting)){ el.style.display = 'none'; return; }
  el.style.display = '';
  el.innerHTML = `<span class="sync-dot ${extra}" style="background:${color}"></span><span class="sync-lbl">${label}</span>`;
}
function _setSyncStatus(s){ _syncStatus = s; _renderSyncIndicator(); }

function _extractSharedState(){
  const out = {};
  Object.keys(state).forEach(k=>{ if(!LOCAL_ONLY_KEYS.has(k)) out[k] = state[k]; });
  return out;
}
function _applyRemoteState(remote){
  if(!remote || remote._empty) return false;
  _isApplyingRemote = true;
  try{
    Object.keys(remote).forEach(k=>{
      if(LOCAL_ONLY_KEYS.has(k)) return;
      if(k.startsWith('_')) return;
      state[k] = remote[k];
    });
    if(remote._updatedAt) _lastRemoteUpdatedAt = remote._updatedAt;
    localStorage.setItem(LS_KEY, JSON.stringify(state));
    return true;
  } finally {
    _isApplyingRemote = false;
  }
}

async function fetchRemoteState(){
  const base = getBackendURL();
  if(!base || !INSTITUTION){ _setSyncStatus('disabled'); return null; }
  try{
    _setSyncStatus('syncing');
    const r = await fetch(base + '/api/state/' + encodeURIComponent(INSTITUTION.id), {cache:'no-store'});
    if(!r.ok){ _setSyncStatus('error'); return null; }
    const data = await r.json();
    _setSyncStatus('synced');
    return data;
  }catch(e){
    console.warn('fetchRemoteState', e);
    _setSyncStatus('offline');
    return null;
  }
}

async function pushRemoteState(){
  if(_isApplyingRemote) return;
  const base = getBackendURL();
  if(!base || !INSTITUTION) return;
  if(!state || !state.isAdmin) return; // solo admin escribe
  const token = getBackendToken();
  if(!token){
    _setSyncStatus('unauthorized');
    if(!window._backendTokenPrompted){ window._backendTokenPrompted = true; promptBackendToken(); }
    return;
  }
  try{
    _setSyncStatus('syncing');
    const r = await fetch(base + '/api/state/' + encodeURIComponent(INSTITUTION.id), {
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},
      body: JSON.stringify(_extractSharedState())
    });
    if(r.status === 401){
      _setSyncStatus('unauthorized');
      if(!window._backendTokenPrompted){ window._backendTokenPrompted = true; promptBackendToken(); }
      return;
    }
    if(!r.ok){ _setSyncStatus('error'); return; }
    const data = await r.json().catch(()=>({}));
    if(data && data._updatedAt) _lastRemoteUpdatedAt = data._updatedAt;
    _setSyncStatus('synced');
  }catch(e){
    console.warn('pushRemoteState', e);
    _setSyncStatus('offline');
  }
}

function scheduleSyncPush(){
  if(_isApplyingRemote) return;
  if(_syncTimer) clearTimeout(_syncTimer);
  _syncTimer = setTimeout(()=>{ _syncTimer = null; pushRemoteState(); }, 1500);
}

async function bootSync(){
  const base = getBackendURL();
  if(!base){ _setSyncStatus('disabled'); return; }
  const remote = await fetchRemoteState();
  if(remote && !remote._empty){
    _applyRemoteState(remote);
    try{
      const active = document.querySelector('.view.active');
      if(active){
        const id = active.id.replace('view-','');
        showView(id);
      }
    }catch(e){}
  }
}

function promptBackendToken(){
  const cur = getBackendToken();
  const urlFromInst = (INSTITUTION && INSTITUTION.backendURL) || '';
  const urlFromLocal = localStorage.getItem('appnesthesia_backend_url') || '';
  const effectiveUrl = getBackendURL() || '';
  const source = urlFromInst ? 'configs/andes.json (público, todos lo ven)' :
                 urlFromLocal ? 'localStorage (solo este dispositivo)' :
                 'NINGUNO — sync deshabilitado';
  modal(`
    <h3>🔑 Configuración del backend</h3>
    <div class="alert ${effectiveUrl?'info':'warn'}" style="font-size:12px">
      ${effectiveUrl
        ? `Estado actual: <b>${_syncStatus}</b>. La URL viene de: <b>${source}</b>.`
        : `<b>⚠️ No hay backend configurado.</b> Sin esto, los cambios solo viven en este dispositivo. Configurá la URL del Worker abajo.`}
    </div>
    <div class="field">
      <label>URL del backend</label>
      <input type="url" id="bk_url" value="${effectiveUrl}" placeholder="https://anestesia-app-backend.tu-usuario.workers.dev" />
      <p class="help" style="margin-top:6px">⚠️ Si la pegás acá, solo queda guardada en <b>este dispositivo</b>. Para que TODOS los usuarios vean los cambios, hay que pegarla en <code>configs/andes.json</code> como <code>"backendURL": "..."</code> y re-subir a Cloudflare Pages.</p>
    </div>
    <div class="field">
      <label>Token de administrador</label>
      <input type="password" id="bk_token" value="${cur||''}" placeholder="Pegá tu ADMIN_TOKEN" autocomplete="off" />
      <p class="help" style="margin-top:6px">El <b>ADMIN_TOKEN</b> que pusiste con <code>wrangler secret put ADMIN_TOKEN</code>. Se guarda solo en este dispositivo. Cada admin lo ingresa una vez.</p>
    </div>
    <div class="btn-row" style="flex-wrap:wrap;gap:6px">
      <button class="btn accent" onclick="saveBackendToken()">Guardar</button>
      <button class="btn secondary" onclick="testBackendConn()">🔍 Probar conexión</button>
      ${cur?`<button class="btn warn" onclick="setBackendToken('');closeModal();toast('Token borrado')">Borrar token</button>`:''}
      <button class="btn secondary" onclick="closeModal()">Cancelar</button>
    </div>
    <div id="bk_diag" style="margin-top:10px;font-size:11.5px;color:#475569"></div>
  `);
}
async function testBackendConn(){
  const url = (document.getElementById('bk_url')?.value||'').trim().replace(/\/$/,'');
  const out = document.getElementById('bk_diag');
  if(!url){ out.innerHTML = '<span style="color:#dc2626">❌ Falta la URL</span>'; return; }
  if(!INSTITUTION){ out.innerHTML = '<span style="color:#dc2626">❌ No hay institución</span>'; return; }
  out.innerHTML = '⏳ Probando...';
  try{
    // 1) Health
    const rh = await fetch(url + '/api/health', {cache:'no-store'});
    let msg = '<div>Health → <b>HTTP ' + rh.status + '</b></div>';
    // 2) GET estado actual (NO escribe, no muta nada)
    const r = await fetch(url + '/api/state/' + encodeURIComponent(INSTITUTION.id), {cache:'no-store'});
    let bodyInfo = '';
    if(r.ok){
      const d = await r.json().catch(()=>({}));
      bodyInfo = d._empty ? ' (KV vacío todavía — normal antes del primer push)' : ' · _updatedAt=' + (d._updatedAt||'sin fecha');
    }
    msg += '<div>GET estado → <b>HTTP ' + r.status + '</b>' + bodyInfo + '</div>';
    msg += '<div style="margin-top:6px;color:#475569">El token se valida cuando guardes un cambio real (no se prueba acá para no escribir basura en KV).</div>';
    out.innerHTML = msg;
  }catch(e){
    out.innerHTML = '<span style="color:#dc2626">❌ ' + (e.message||'Error de red') + '</span><div style="margin-top:4px;color:#475569">Verificá que la URL esté bien escrita y que el Worker esté deployado.</div>';
  }
}
function saveBackendToken(){
  const t = (document.getElementById('bk_token')?.value||'').trim();
  const u = (document.getElementById('bk_url')?.value||'').trim();
  if(t) setBackendToken(t); else setBackendToken('');
  if(u) setBackendURL(u); else if(!INSTITUTION?.backendURL) setBackendURL('');
  closeModal();
  toast('Backend configurado');
  pushRemoteState();
}

// ============================================================
// NAVEGACIÓN
// ============================================================
function showView(name){
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.getElementById('view-'+name).classList.add('active');
  document.getElementById('backBtn').classList.toggle('visible', name!=='home');
  const titles = {
    home:'Appnesthesia',
    mipanel:'Mi Panel',
    calendario:'Calendario de turnos',
    eventos:'Calendario de Eventos',
    regional:'Anestesia Regional',
    indice:'Índice de Permanencia',
    cobertura:'Cobertura Emergencia',
    intercambios:'Intercambios',
    vacaciones:'Vacaciones',
    estadisticas:'Estadísticas',
    equipo:'Equipo',
    protocolos:'Protocolos',
    pediatria:'Pediatría',
    coagulacion:'Coagulación',
    reloj:'Reloj Control'
  };
  document.getElementById('hdrTitle').textContent = titles[name] || titles.home;
  // Actualizar badge de vacaciones pendientes en la home
  const pendingVacs = (state.vacations||[]).filter(v=>v.status==='pending').length;
  const hb = document.getElementById('vacBadgeHome');
  if(hb){ hb.textContent = pendingVacs>0?pendingVacs:''; hb.style.display = pendingVacs>0?'inline-block':'none'; }
  if(name==='calendario'){
    renderCalendar();
    renderSourceStatus();
    // Auto-sync si hay fuente conectada y la última fue hace más de 5 min (o nunca)
    const src = state.externalSource;
    if(src){
      const last = src.lastSync ? new Date(src.lastSync).getTime() : 0;
      if(Date.now() - last > 5*60*1000) syncExternalSource(true);
    }
  }
  if(name==='horario') renderHorario();
  if(name==='indice'){ renderRanking(); }
  if(name==='cobertura'){ renderCobertura(); }
  if(name==='pediatria'){
    renderPediatria();
    renderPediatricaCalc();
    // Asegura que todos los acordeones de cálculos (Vía aérea, etc.) estén cerrados por defecto
    document.querySelectorAll('#view-pediatria .calc-block').forEach(d => d.removeAttribute('open'));
  }
  if(name==='coagulacion'){ renderCoagulacion(); }
  if(name==='intercambios') renderExchanges();
  if(name==='vacaciones') renderVacations();
  if(name==='estadisticas') renderStats();
  if(name==='equipo') renderTeam();
  if(name==='protocolos') renderProtocols();
  if(name==='mipanel') renderMiPanel();
  if(name==='eventos') renderEventos();
  if(name==='home') updateEventBadge();
  if(name==='reloj') relojInit();
  window.scrollTo(0,0);
}
function showHome(){ showView('home'); }

// ============================================================
// ADMIN
// ============================================================
async function toggleAdmin(){
  if(state.isAdmin){
    state.isAdmin = false;
    save(); updateAdminUI();
    toast && toast('Modo usuario');
    return;
  }
  // Activar admin: requiere PIN
  if(adminSetupNeeded()){
    const ok = await promptSetAdminPin();
    if(!ok) return;
  }
  const ok = await promptVerifyAdminPin();
  if(!ok) return;
  state.isAdmin = true;
  save(); updateAdminUI();
  toast && toast('Modo admin activado');
}
function updateAdminUI(){
  const btn = document.getElementById('adminBtn');
  btn.textContent = state.isAdmin ? 'Modo admin' : 'Modo usuario';
  btn.classList.toggle('on', state.isAdmin);
  document.querySelectorAll('.admin-only').forEach(el=>{
    el.style.display = state.isAdmin ? '' : 'none';
  });
  document.querySelector('header .role')?.remove();
  // Refrescar indicador de sync (visibilidad depende de isAdmin)
  try{ _renderSyncIndicator(); }catch(e){}
}

// ============================================================
// CALENDARIO
// ============================================================
function navMonth(delta){
  const [y,m] = state.currentMonth.split('-').map(Number);
  const d = new Date(y, m-1+delta, 1);
  state.currentMonth = d.toISOString().slice(0,7);
  save(); renderCalendar();
}
function renderCalendar(){
  const [y,m] = state.currentMonth.split('-').map(Number);
  const monthNames = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  document.getElementById('calMonth').textContent = `${monthNames[m-1]} ${y}`;
  const first = new Date(y, m-1, 1);
  const startDow = (first.getDay()+6)%7; // lunes = 0
  const daysInMonth = new Date(y, m, 0).getDate();
  const grid = document.getElementById('calGrid');
  grid.innerHTML = '';
  for(let i=0;i<startDow;i++){
    const e = document.createElement('div');
    e.className='cal-day empty'; grid.appendChild(e);
  }
  const today = new Date().toISOString().slice(0,10);
  for(let d=1; d<=daysInMonth; d++){
    const dateStr = `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const cell = document.createElement('div');
    cell.className = 'cal-day'+(dateStr===today?' today':'');
    cell.onclick = ()=>showDayDetail(dateStr);
    const dayShifts = state.shifts.filter(s=>s.date===dateStr);
    cell.innerHTML = `<div class="d">${d}</div><div class="shifts">${
      dayShifts.slice(0,3).map(s=>{
        const st = state.staff.find(x=>x.id===s.staffId);
        const lname = st?st.name.split(',')[0].replace(/Dr\.|Dra\./,'').trim():'?';
        const cls = s.type==='Guardia'||s.type==='Llamada'?'guardia':(s.type==='Libre'?'libre':'');
        return `<div class="sh ${cls}">${lname}</div>`;
      }).join('')}${dayShifts.length>3?`<div class="sh">+${dayShifts.length-3}</div>`:''}</div>`;
    grid.appendChild(cell);
  }
  document.getElementById('dayDetail').innerHTML = '';
}
function showDayDetail(date){
  const shifts = state.shifts.filter(s=>s.date===date);
  let html = `<div class="detail-card"><div class="head">${formatDate(date)}</div>`;
  if(shifts.length===0){
    html += `<div style="color:var(--muted);font-size:13px">Sin turnos asignados</div>`;
  } else {
    html += `<table><thead><tr><th>Anestesiólogo</th><th>Tipo</th><th></th></tr></thead><tbody>`;
    shifts.forEach(s=>{
      const st = state.staff.find(x=>x.id===s.staffId);
      html += `<tr><td>${st?st.name:'?'}</td><td><span class="chip ${chipColor(s.type)}">${s.type}</span></td><td>${state.isAdmin?`<button class="btn sm secondary" onclick="deleteShift('${s.date}','${s.staffId}','${s.type}')">×</button>`:''}</td></tr>`;
    });
    html += `</tbody></table>`;
  }
  if(state.isAdmin){
    html += `<div class="btn-row"><button class="btn sm accent" onclick="openShiftEditor('${date}')">+ Asignar turno</button></div>`;
  }
  html += `</div>`;
  document.getElementById('dayDetail').innerHTML = html;
}
function chipColor(type){
  return {'Mañana':'blue','Tarde':'blue','Noche':'gray','Guardia':'yellow','Llamada':'yellow','Libre':'green','Vacaciones':'green'}[type] || 'gray';
}
function openShiftEditor(date){
  const today = date || state.currentMonth+'-01';
  modal(`
    <h3>Asignar turno</h3>
    <div class="field"><label>Fecha</label><input type="date" id="sh_date" value="${today}"></div>
    <div class="field"><label>Anestesiólogo</label><select id="sh_staff">${state.staff.map(s=>`<option value="${s.id}">${s.name}</option>`).join('')}</select></div>
    <div class="field"><label>Tipo</label><select id="sh_type">
      <option>Mañana</option><option>Tarde</option><option>Noche</option><option>Guardia</option><option>Llamada</option><option>Libre</option><option>Vacaciones</option>
    </select></div>
    <div class="btn-row">
      <button class="btn accent" onclick="saveShift()">Guardar</button>
      <button class="btn secondary" onclick="closeModal()">Cancelar</button>
    </div>
  `);
}
function saveShift(){
  const date = document.getElementById('sh_date').value;
  const staffId = document.getElementById('sh_staff').value;
  const type = document.getElementById('sh_type').value;
  if(!date||!staffId||!type){toast('Completá todos los campos');return;}
  state.shifts.push({date,staffId,type});
  save(); closeModal(); renderCalendar(); showDayDetail(date); toast('Turno asignado');
}
function deleteShift(date, staffId, type){
  state.shifts = state.shifts.filter(s=>!(s.date===date && s.staffId===staffId && s.type===type));
  save(); renderCalendar(); showDayDetail(date); toast('Turno eliminado');
}
function exportCalendarCSV(){
  const rows = [['Fecha','Anestesiólogo','Tipo']];
  state.shifts.forEach(s=>{
    const st = state.staff.find(x=>x.id===s.staffId);
    rows.push([s.date, st?st.name:'?', s.type]);
  });
  const csv = rows.map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv],{type:'text/csv'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href=url; a.download=`calendario_${state.currentMonth}.csv`; a.click();
  URL.revokeObjectURL(url);
  toast('CSV exportado');
}
function importCalendar(ev){
  const f = ev.target.files[0]; if(!f) return;
  const ext = f.name.split('.').pop().toLowerCase();
  if(ext==='xlsx' || ext==='xls'){
    const reader = new FileReader();
    reader.onload = e=>{
      const data = new Uint8Array(e.target.result);
      const wb = XLSX.read(data, {type:'array'});
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {defval:''});
      const added = ingestRows(rows, true);
      save(); renderCalendar(); toast(`${added} turnos importados del Excel`);
    };
    reader.readAsArrayBuffer(f);
  } else {
    const reader = new FileReader();
    reader.onload = e=>{
      const rows = parseCSV(e.target.result);
      const added = ingestRows(rows, true);
      save(); renderCalendar(); toast(`${added} turnos importados del CSV`);
    };
    reader.readAsText(f);
  }
}

// =====================================================
// FUENTE EXTERNA (Google Sheets / OneDrive / URL directa)
// =====================================================
function openSourceModal(){
  const cur = state.externalSource || {};
  modal(`
    <h3>🔗 Conectar fuente en línea</h3>
    <div class="alert info" style="font-size:12px">
      Pegá el enlace de tu Excel/Google Sheet. La App lo leerá automáticamente cada vez que se abra el Calendario.
    </div>
    <div class="field">
      <label>Tipo de fuente</label>
      <select id="src_type">
        <option value="gsheet" ${cur.kind==='gsheet'?'selected':''}>Google Sheets (recomendado)</option>
        <option value="onedrive" ${cur.kind==='onedrive'?'selected':''}>OneDrive / SharePoint (Excel)</option>
        <option value="direct" ${cur.kind==='direct'?'selected':''}>URL directa a archivo .xlsx o .csv</option>
      </select>
    </div>
    <div class="field">
      <label>URL del enlace compartido</label>
      <input type="url" id="src_url" placeholder="https://docs.google.com/spreadsheets/... o https://1drv.ms/..." value="${cur.url||''}" />
      <div class="help" id="src_help"></div>
    </div>
    <div class="field">
      <label><input type="checkbox" id="src_replace" ${cur.replace!==false?'checked':''}> Reemplazar todos los turnos al sincronizar</label>
      <div class="help">Si lo desmarcás, los turnos nuevos se agregan a los existentes.</div>
    </div>
    <div class="btn-row">
      <button class="btn accent" onclick="saveSource()">Guardar y sincronizar</button>
      ${cur.url?`<button class="btn warn" onclick="disconnectSource()">Desconectar</button>`:''}
      <button class="btn secondary" onclick="closeModal()">Cancelar</button>
    </div>
    <div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border);font-size:12px;color:var(--muted)">
      <b>¿Cómo obtengo el enlace?</b><br>
      <b>Google Sheets:</b> abrí tu hoja → Archivo → Compartir → Publicar en la web → Hoja específica → CSV → copiar enlace.<br>
      <b>OneDrive:</b> click derecho en el archivo → Compartir → "Cualquiera con el enlace" → copiar.<br>
      Tu Excel debe tener las columnas: <b>Fecha, Anestesiólogo, Tipo</b> (y opcional Horario, Quirófano, Observaciones).
    </div>
  `);
  document.getElementById('src_type').addEventListener('change', updateSourceHelp);
  updateSourceHelp();
}
function updateSourceHelp(){
  const t = document.getElementById('src_type').value;
  const help = document.getElementById('src_help');
  const tips = {
    gsheet: 'Pegá el enlace tal cual te lo dé Google al "Publicar en la web > CSV". Lo detectamos automático.',
    onedrive: 'Pegá el enlace de OneDrive ("Cualquiera con el enlace puede ver"). Lo convertimos a descarga directa.',
    direct: 'URL que apunte directo a un archivo .xlsx o .csv accesible públicamente.'
  };
  help.textContent = tips[t];
}
function saveSource(){
  const kind = document.getElementById('src_type').value;
  const url = document.getElementById('src_url').value.trim();
  const replace = document.getElementById('src_replace').checked;
  if(!url){ toast('Falta la URL'); return; }
  state.externalSource = {kind, url, replace, lastSync:null};
  save();
  closeModal();
  syncExternalSource(true);
}
function disconnectSource(){
  if(!confirm('¿Desconectar la fuente externa? Los turnos importados se mantienen.')) return;
  state.externalSource = null; save(); closeModal(); renderSourceStatus(); toast('Fuente desconectada');
}
function buildFetchURL(src){
  // Convierte el enlace pegado por el usuario en una URL que el navegador pueda descargar.
  let u = src.url.trim();
  if(src.kind==='gsheet'){
    // Si pegó un enlace de edición, intentamos derivar el export CSV
    const m = u.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if(m && !u.includes('output=csv') && !u.includes('/export')){
      // Si tiene gid, lo usamos
      const gidM = u.match(/[?&#]gid=(\d+)/);
      const gid = gidM ? gidM[1] : '0';
      return `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv&gid=${gid}`;
    }
    return u;
  }
  if(src.kind==='onedrive'){
    // OneDrive: cambiar a download=1 / convertir links 1drv.ms a versión descargable
    if(u.includes('1drv.ms') || u.includes('onedrive.live.com')){
      // Trick: añadir ?download=1 al final
      const sep = u.includes('?') ? '&' : '?';
      if(!/[?&]download=/.test(u)) u = u + sep + 'download=1';
    }
    return u;
  }
  return u;
}
async function syncExternalSource(silent){
  const src = state.externalSource;
  if(!src) return;
  const url = buildFetchURL(src);
  if(!silent) toast('Sincronizando...');
  try{
    const resp = await fetch(url, {redirect:'follow'});
    if(!resp.ok) throw new Error('HTTP '+resp.status);
    const ct = resp.headers.get('content-type')||'';
    let rows;
    if(ct.includes('text/csv') || url.endsWith('.csv') || url.includes('output=csv') || url.includes('format=csv')){
      const text = await resp.text();
      rows = parseCSV(text);
    } else {
      const buf = await resp.arrayBuffer();
      const wb = XLSX.read(new Uint8Array(buf), {type:'array'});
      rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {defval:''});
    }
    const added = ingestRows(rows, src.replace);
    state.externalSource.lastSync = new Date().toISOString();
    save();
    renderCalendar(); renderSourceStatus();
    toast(`${added} turnos sincronizados`);
  } catch(err){
    console.error(err);
    renderSourceStatus(err.message);
    if(!silent) toast('Error al sincronizar: '+err.message);
  }
}
function renderSourceStatus(errMsg){
  const el = document.getElementById('sourceStatus');
  if(!el) return;
  const src = state.externalSource;
  if(!src){ el.innerHTML = ''; return; }
  const sync = src.lastSync ? new Date(src.lastSync).toLocaleString('es-ES') : 'nunca';
  const kindLabel = {gsheet:'Google Sheets', onedrive:'OneDrive', direct:'URL directa'}[src.kind];
  el.innerHTML = `
    <div class="alert info" style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
      <div>
        <b>🔗 Conectado a ${kindLabel}</b><br>
        <span style="font-size:11px">Última sincronización: ${sync}</span>
        ${errMsg?`<br><span style="color:var(--danger);font-size:11px">Error: ${errMsg}</span>`:''}
      </div>
      <button class="btn sm accent" onclick="syncExternalSource(false)">🔄 Sincronizar ahora</button>
    </div>`;
}

// =====================================================
// PARSEO DE FILAS (CSV o Excel ya convertido a array de objetos)
// =====================================================
function parseCSV(text){
  // Parser CSV minimalista que respeta comillas
  const rows = [];
  let row = [], cur = '', inQ = false;
  for(let i=0;i<text.length;i++){
    const ch = text[i];
    if(inQ){
      if(ch==='"' && text[i+1]==='"'){ cur+='"'; i++; }
      else if(ch==='"'){ inQ=false; }
      else cur += ch;
    } else {
      if(ch==='"'){ inQ=true; }
      else if(ch===','){ row.push(cur); cur=''; }
      else if(ch==='\n'){ row.push(cur); rows.push(row); row=[]; cur=''; }
      else if(ch==='\r'){ /* skip */ }
      else cur += ch;
    }
  }
  if(cur.length || row.length){ row.push(cur); rows.push(row); }
  if(rows.length<2) return [];
  const headers = rows[0].map(h=>String(h).trim());
  return rows.slice(1).filter(r=>r.some(c=>String(c).trim())).map(r=>{
    const obj = {};
    headers.forEach((h,i)=>obj[h]=r[i]);
    return obj;
  });
}
function normalizeHeader(h){
  return String(h).toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^a-z0-9]/g,'');
}
function pickCol(row, names){
  // Busca la primera columna del row cuyo header normalizado coincida con alguno de "names"
  for(const k of Object.keys(row)){
    const n = normalizeHeader(k);
    if(names.includes(n)) return row[k];
  }
  return undefined;
}
function parseDateAny(v){
  if(v===undefined||v===null||v==='') return null;
  if(typeof v==='number'){
    // Fecha serial Excel
    const d = new Date(Math.round((v-25569)*86400*1000));
    if(isNaN(d)) return null;
    return d.toISOString().slice(0,10);
  }
  const s = String(v).trim();
  // ISO directo
  if(/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0,10);
  // dd/mm/yyyy o d-m-yyyy
  let m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if(m){
    let [_,d,mo,y] = m;
    if(y.length===2) y = '20'+y;
    return `${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  }
  // Date.parse último intento
  const dt = new Date(s);
  if(!isNaN(dt)) return dt.toISOString().slice(0,10);
  return null;
}
function ingestRows(rows, replace){
  if(replace){ state.shifts = []; }
  let added = 0;
  rows.forEach(r=>{
    const date = parseDateAny(pickCol(r, ['fecha','date','dia','día']));
    const name = pickCol(r, ['anestesiologo','anestesiologa','nombre','name','staff','medico','médico']);
    const type = pickCol(r, ['tipo','type','turno','shift']);
    if(!date || !name) return;
    let staff = state.staff.find(s=>s.name===name);
    if(!staff){
      const norm = String(name).toLowerCase().trim();
      staff = state.staff.find(s=>s.name.toLowerCase().includes(norm))
            || state.staff.find(s=>norm.includes(s.name.split(',')[0].toLowerCase().replace(/dr\.?|dra\.?/,'').trim()));
    }
    if(!staff){
      // Si no existe, lo creamos
      staff = {id:'s'+Date.now()+Math.random().toString(36).slice(2,5), name:String(name).trim(), role:'Staff', cumplimientoJornadas:'75-85', jornadasBorradas:0, equipoTMT:false, equipoCardio:false, equipoPediatria:false, rolCoordinacion:false, noFondoComun:false, residenciaAnios:'1-5', esResidente:false, llamadaPediatrica:false, llamadaCardio:false, primeraLlamadaFija:false, segundaLlamadaFija:false, coberturaTurnoUrg:false, coberturaLlamada1:false, coberturaLlamada2:false, exentoCobertura:false};
      state.staff.push(staff);
    }
    state.shifts.push({date, staffId:staff.id, type:String(type||'Mañana').trim()});
    added++;
  });
  return added;
}

// ============================================================
// ÍNDICE DE PERMANENCIA
// ============================================================
function computeScore(s){
  let score = 0;
  if(s.cumplimientoJornadas==='>90') score += 2;
  else if(s.cumplimientoJornadas==='85-90') score += 1;
  else if(s.cumplimientoJornadas==='<75') score -= 1;
  // 75-85 = 0 (rango neutro / sin dato)
  score += (s.jornadasBorradas||0) * 1;
  if(s.equipoTMT) score += 3;
  if(s.equipoCardio) score += 3;
  if(s.equipoPediatria) score += 3;
  if(s.rolCoordinacion) score += 2;
  if(s.noFondoComun) score += 3;
  return score;
}
function resetStaffList(){
  if(!state.isAdmin){ toast('Solo el administrador'); return; }
  if(!confirm('Esto restaurará el listado oficial de anestesiólogos. Se conservarán los puntajes de los nombres que coincidan, pero se eliminarán los nombres que no estén en el listado real. ¿Continuar?')) return;
  const def = JSON.parse(JSON.stringify(DEFAULT_STATE));
  const oldByName = {};
  (state.staff||[]).forEach(s=>{ oldByName[(s.name||'').toLowerCase()] = s; });
  state.staff = def.staff.map(d=>{
    const o = oldByName[d.name.toLowerCase()];
    if(o){
      return {...d,
        cumplimientoJornadas: o.cumplimientoJornadas || d.cumplimientoJornadas,
        jornadasBorradas: typeof o.jornadasBorradas==='number'?o.jornadasBorradas:d.jornadasBorradas,
        equipoTMT: !!o.equipoTMT, equipoCardio: !!o.equipoCardio, equipoPediatria: !!o.equipoPediatria,
        rolCoordinacion: !!o.rolCoordinacion, noFondoComun: !!o.noFondoComun, role: o.role || d.role,
      };
    }
    return d;
  });
  const validIds = new Set(state.staff.map(s=>s.id));
  state.shifts = (state.shifts||[]).filter(s=>validIds.has(s.staffId));
  state.exchanges = (state.exchanges||[]).filter(e=>validIds.has(e.staffId));
  state.vacations = (state.vacations||[]).filter(v=>validIds.has(v.staffId));
  save();
  renderRanking();
  toast('Listado oficial restaurado');
}

function cumplimientoLabel(v){
  if(v==='>90') return '>90%';
  if(v==='85-90') return '85–90%';
  if(v==='75-85') return '75–85%';
  if(v==='<75') return '<75%';
  return '—';
}
function renderRanking(){
  const cut = parseInt(document.getElementById('cutCount')?.value||'0',10);
  // Orden ASCENDENTE: menor puntaje primero
  const ranked = [...state.staff].map(s=>({...s, score:computeScore(s)})).sort((a,b)=>{
    if(a.score!==b.score) return a.score - b.score;
    return a.name.localeCompare(b.name);
  });
  const list = document.getElementById('rankList');
  list.innerHTML = ranked.map((s,i)=>{
    const inDanger = cut>0 && i<cut;
    const chips = [];
    chips.push(`<span class="chip" style="background:#eef2f4">Cumpl. ${cumplimientoLabel(s.cumplimientoJornadas)}</span>`);
    if((s.jornadasBorradas||0)>0) chips.push(`<span class="chip yellow">Borradas: ${s.jornadasBorradas}</span>`);
    if(s.equipoTMT) chips.push(`<span class="chip green">TMT</span>`);
    if(s.equipoCardio) chips.push(`<span class="chip green">Cardio</span>`);
    if(s.equipoPediatria) chips.push(`<span class="chip green">Pediatría</span>`);
    if(s.rolCoordinacion) chips.push(`<span class="chip green">Coord/Jef/Doc</span>`);
    if(s.noFondoComun) chips.push(`<span class="chip green">No Fondo Común</span>`);
    const editBtn = state.isAdmin ? `<button class="btn sm secondary" onclick="editStaffScore('${s.id}')" style="margin-left:8px">Editar</button>` : '';
    return `<div class="rank-row ${inDanger?'in-danger':''}">
      <div class="${inDanger?'pos bottom':'pos'}">${i+1}</div>
      <div class="info">
        <div class="name">${s.name} ${inDanger?'<span class="chip red">en riesgo</span>':''}</div>
        <div class="sub" style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px">${chips.join('')}</div>
      </div>
      <div class="score">${s.score}${editBtn}</div>
    </div>`;
  }).join('');
  document.getElementById('dangerCount').textContent = cut>0?`${cut} en riesgo`:'';
}

function editStaffScore(id){
  if(!state.isAdmin){ toast('Solo el administrador puede editar puntajes'); return; }
  const s = state.staff.find(x=>x.id===id);
  if(!s) return;
  const cumpl = s.cumplimientoJornadas || '75-85';
  const borradas = s.jornadasBorradas || 0;
  modal(`
    <h3>Editar puntaje · ${s.name}</h3>
    <div class="field">
      <label>Cumplimiento de jornadas (últimos 6 meses)</label>
      <select id="es_cumpl" onchange="previewStaffScore('${id}')">
        <option value=">90" ${cumpl==='>90'?'selected':''}>Más de 90% (+2)</option>
        <option value="85-90" ${cumpl==='85-90'?'selected':''}>85% a 90% (+1)</option>
        <option value="75-85" ${cumpl==='75-85'?'selected':''}>75% a 85% (0)</option>
        <option value="<75" ${cumpl==='<75'?'selected':''}>Menos de 75% (−1)</option>
      </select>
    </div>
    <div class="field">
      <label>Número de jornadas borradas en los últimos 6 meses</label>
      <input type="number" id="es_borradas" min="0" step="1" value="${borradas}" oninput="previewStaffScore('${id}')" />
      <div class="help">Cada jornada borrada suma 1 punto.</div>
    </div>
    <div class="field">
      <label><input type="checkbox" id="es_tmt" ${s.equipoTMT?'checked':''} onchange="previewStaffScore('${id}')" /> Equipo de Traumatología (TMT) — +3</label>
    </div>
    <div class="field">
      <label><input type="checkbox" id="es_cardio" ${s.equipoCardio?'checked':''} onchange="previewStaffScore('${id}')" /> Equipo de Cardiocirugía — +3</label>
    </div>
    <div class="field">
      <label><input type="checkbox" id="es_ped" ${s.equipoPediatria?'checked':''} onchange="previewStaffScore('${id}')" /> Equipo de Pediatría Complejo — +3</label>
    </div>
    <div class="field">
      <label><input type="checkbox" id="es_coord" ${s.rolCoordinacion?'checked':''} onchange="previewStaffScore('${id}')" /> Rol de Coordinación / Jefatura / Docente — +2</label>
    </div>
    <div class="field">
      <label><input type="checkbox" id="es_nofc" ${s.noFondoComun?'checked':''} onchange="previewStaffScore('${id}')" /> No pertenece al Fondo Común — +3</label>
    </div>
    <div class="alert info" style="margin-top:12px">
      Puntaje en vivo: <b id="es_preview" style="font-size:20px">${computeScore(s)}</b>
    </div>
    <div class="btn-row" style="margin-top:12px">
      <button class="btn accent" onclick="saveStaffScore('${id}')">Guardar</button>
      <button class="btn secondary" onclick="closeModal()">Cancelar</button>
    </div>
  `);
}

function previewStaffScore(id){
  const draft = {
    cumplimientoJornadas: document.getElementById('es_cumpl').value,
    jornadasBorradas: parseInt(document.getElementById('es_borradas').value||'0',10) || 0,
    equipoTMT: document.getElementById('es_tmt').checked,
    equipoCardio: document.getElementById('es_cardio').checked,
    equipoPediatria: document.getElementById('es_ped').checked,
    rolCoordinacion: document.getElementById('es_coord').checked,
    noFondoComun: document.getElementById('es_nofc').checked
  };
  const el = document.getElementById('es_preview');
  if(el) el.textContent = computeScore(draft);
}

function saveStaffScore(id){
  const s = state.staff.find(x=>x.id===id);
  if(!s) return;
  s.cumplimientoJornadas = document.getElementById('es_cumpl').value;
  s.jornadasBorradas = parseInt(document.getElementById('es_borradas').value||'0',10) || 0;
  s.equipoTMT = document.getElementById('es_tmt').checked;
  s.equipoCardio = document.getElementById('es_cardio').checked;
  s.equipoPediatria = document.getElementById('es_ped').checked;
  s.rolCoordinacion = document.getElementById('es_coord').checked;
  s.noFondoComun = document.getElementById('es_nofc').checked;
  save();
  closeModal();
  renderRanking();
  renderTeam();
  toast('Puntaje actualizado');
}

// ============================================================
// COBERTURA EMERGENCIA
// ============================================================
function residenciaLabel(v){
  if(v==='5+') return '5+ años';
  if(v==='1-5') return '1–5 años';
  if(v==='0') return '0 años';
  return '—';
}
function computeCoberturaScore(s){
  let score = 0;
  if(s.residenciaAnios==='5+') score += 5;
  else if(s.residenciaAnios==='1-5') score += 1;
  // 0 años = 0 puntos
  if(s.esResidente) score += 8;
  if(s.llamadaPediatrica) score += 1;
  if(s.llamadaCardio) score += 1;
  if(s.primeraLlamadaFija) score += 2;
  if(s.segundaLlamadaFija) score += 1;
  if(s.noFondoComun) score += 2;
  if(s.coberturaTurnoUrg) score += 3;
  if(s.coberturaLlamada1) score += 2;
  if(s.coberturaLlamada2) score += 1;
  return score;
}
function renderCobertura(){
  // Excluir exentos y ordenar ASCENDENTE (menor puntaje primero = más prioritario para cubrir;
  // los de mayor puntaje aparecen al final de la lista)
  const ranked = state.staff
    .filter(s=>!s.exentoCobertura)
    .map(s=>({...s, score:computeCoberturaScore(s)}))
    .sort((a,b)=>{
      if(a.score!==b.score) return a.score - b.score;
      return a.name.localeCompare(b.name);
    });
  const list = document.getElementById('covList');
  list.innerHTML = ranked.map((s,i)=>{
    const chips = [];
    chips.push(`<span class="chip" style="background:#eef2f4">Residencia: ${residenciaLabel(s.residenciaAnios)}</span>`);
    if(s.esResidente) chips.push(`<span class="chip green">Residente</span>`);
    if(s.llamadaPediatrica) chips.push(`<span class="chip green">Ll. Pediátrica</span>`);
    if(s.llamadaCardio) chips.push(`<span class="chip green">Ll. Cardio</span>`);
    if(s.primeraLlamadaFija) chips.push(`<span class="chip green">1ª Ll. Fija</span>`);
    if(s.segundaLlamadaFija) chips.push(`<span class="chip green">2ª Ll. Fija</span>`);
    if(s.noFondoComun) chips.push(`<span class="chip green">No Fondo Común</span>`);
    if(s.coberturaTurnoUrg) chips.push(`<span class="chip green">Cob. Turno Urg.</span>`);
    if(s.coberturaLlamada1) chips.push(`<span class="chip green">Cob. Llamada 1</span>`);
    if(s.coberturaLlamada2) chips.push(`<span class="chip green">Cob. Llamada 2</span>`);
    const editBtn = state.isAdmin ? `<button class="btn sm secondary" onclick="editCoberturaScore('${s.id}')" style="margin-left:8px">Editar</button>` : '';
    return `<div class="rank-row">
      <div class="pos">${i+1}</div>
      <div class="info">
        <div class="name">${s.name}</div>
        <div class="sub" style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px">${chips.join('')}</div>
      </div>
      <div class="score">${s.score}${editBtn}</div>
    </div>`;
  }).join('');
  document.getElementById('covCount').textContent = `${ranked.length} en lista`;
}

function editCoberturaScore(id){
  if(!state.isAdmin){ toast('Solo el administrador puede editar puntajes'); return; }
  const s = state.staff.find(x=>x.id===id);
  if(!s) return;
  const res = s.residenciaAnios || '1-5';
  modal(`
    <h3>Editar Cobertura · ${s.name}</h3>
    <div class="field">
      <label>Años de residencia</label>
      <select id="cv_res" onchange="previewCoberturaScore('${id}')">
        <option value="0" ${res==='0'?'selected':''}>0 años (0 puntos)</option>
        <option value="1-5" ${res==='1-5'?'selected':''}>1 a 5 años (+1)</option>
        <option value="5+" ${res==='5+'?'selected':''}>5 o más años (+5)</option>
      </select>
    </div>
    <div class="field"><label><input type="checkbox" id="cv_resi" ${s.esResidente?'checked':''} onchange="previewCoberturaScore('${id}')" /> Es residente — +8</label></div>
    <div class="field"><label><input type="checkbox" id="cv_lped" ${s.llamadaPediatrica?'checked':''} onchange="previewCoberturaScore('${id}')" /> Llamada pediátrica — +1</label></div>
    <div class="field"><label><input type="checkbox" id="cv_lcar" ${s.llamadaCardio?'checked':''} onchange="previewCoberturaScore('${id}')" /> Llamada cardiovascular — +1</label></div>
    <div class="field"><label><input type="checkbox" id="cv_l1" ${s.primeraLlamadaFija?'checked':''} onchange="previewCoberturaScore('${id}')" /> Primera Llamada fija — +2</label></div>
    <div class="field"><label><input type="checkbox" id="cv_l2" ${s.segundaLlamadaFija?'checked':''} onchange="previewCoberturaScore('${id}')" /> Segunda Llamada fija — +1</label></div>
    <div class="field"><label><input type="checkbox" id="cv_nofc" ${s.noFondoComun?'checked':''} onchange="previewCoberturaScore('${id}')" /> No pertenece al Fondo Común — +2</label></div>
    <hr style="margin:12px 0;border:0;border-top:1px solid var(--border)">
    <div class="help" style="margin-bottom:6px"><b>Coberturas ya realizadas</b> (suman puntaje y bajan en la lista de prioridad):</div>
    <div class="field"><label><input type="checkbox" id="cv_ctu" ${s.coberturaTurnoUrg?'checked':''} onchange="previewCoberturaScore('${id}')" /> Cobertura de Turno de Urgencia — +3</label></div>
    <div class="field"><label><input type="checkbox" id="cv_cl1" ${s.coberturaLlamada1?'checked':''} onchange="previewCoberturaScore('${id}')" /> Cobertura Llamada 1 — +2</label></div>
    <div class="field"><label><input type="checkbox" id="cv_cl2" ${s.coberturaLlamada2?'checked':''} onchange="previewCoberturaScore('${id}')" /> Cobertura Llamada 2 — +1</label></div>
    <hr style="margin:12px 0;border:0;border-top:1px solid var(--border)">
    <div class="field"><label><input type="checkbox" id="cv_ex" ${s.exentoCobertura?'checked':''}> Exento del listado de cobertura</label>
      <div class="help">Si está marcado, este anestesiólogo no aparecerá en el ranking.</div>
    </div>
    <div class="alert info" style="margin-top:12px">
      Puntaje en vivo: <b id="cv_preview" style="font-size:20px">${computeCoberturaScore(s)}</b>
    </div>
    <div class="btn-row" style="margin-top:12px">
      <button class="btn accent" onclick="saveCoberturaScore('${id}')">Guardar</button>
      <button class="btn secondary" onclick="closeModal()">Cancelar</button>
    </div>
  `);
}

function previewCoberturaScore(id){
  const draft = {
    residenciaAnios: document.getElementById('cv_res').value,
    esResidente: document.getElementById('cv_resi').checked,
    llamadaPediatrica: document.getElementById('cv_lped').checked,
    llamadaCardio: document.getElementById('cv_lcar').checked,
    primeraLlamadaFija: document.getElementById('cv_l1').checked,
    segundaLlamadaFija: document.getElementById('cv_l2').checked,
    noFondoComun: document.getElementById('cv_nofc').checked,
    coberturaTurnoUrg: document.getElementById('cv_ctu').checked,
    coberturaLlamada1: document.getElementById('cv_cl1').checked,
    coberturaLlamada2: document.getElementById('cv_cl2').checked,
  };
  const el = document.getElementById('cv_preview');
  if(el) el.textContent = computeCoberturaScore(draft);
}

function saveCoberturaScore(id){
  const s = state.staff.find(x=>x.id===id);
  if(!s) return;
  s.residenciaAnios = document.getElementById('cv_res').value;
  s.esResidente = document.getElementById('cv_resi').checked;
  s.llamadaPediatrica = document.getElementById('cv_lped').checked;
  s.llamadaCardio = document.getElementById('cv_lcar').checked;
  s.primeraLlamadaFija = document.getElementById('cv_l1').checked;
  s.segundaLlamadaFija = document.getElementById('cv_l2').checked;
  s.noFondoComun = document.getElementById('cv_nofc').checked;
  s.coberturaTurnoUrg = document.getElementById('cv_ctu').checked;
  s.coberturaLlamada1 = document.getElementById('cv_cl1').checked;
  s.coberturaLlamada2 = document.getElementById('cv_cl2').checked;
  s.exentoCobertura = document.getElementById('cv_ex').checked;
  save();
  closeModal();
  renderCobertura();
  toast('Puntaje de cobertura actualizado');
}

// ============================================================
// INTERCAMBIOS
// ============================================================
let exchTab = 'open';
function switchExchTab(ev, tab){
  exchTab = tab;
  ev.target.parentElement.querySelectorAll('button').forEach(b=>b.classList.remove('active'));
  ev.target.classList.add('active');
  renderExchanges();
}
function renderExchanges(){
  const list = document.getElementById('exchList');
  let items = state.exchanges;
  const me = 'self'; // en versión real sería el id de usuario logueado
  if(exchTab==='open') items = items.filter(e=>e.status==='open');
  if(exchTab==='mine') items = items.filter(e=>e.offeredBy===me);
  if(exchTab==='history') items = items.filter(e=>e.status!=='open');
  if(items.length===0){
    list.innerHTML = `<div class="empty"><span class="big">🔄</span>No hay ofertas en esta sección</div>`;
    return;
  }
  list.innerHTML = items.map(e=>{
    const staff = state.staff.find(s=>s.id===e.staffId);
    return `<div class="exchange ${e.status!=='open'?'taken':''}">
      <div class="top">
        <div>
          <div class="who">${staff?staff.name:'Alguien'}</div>
          <div class="when">${formatDate(e.date)} · ${e.type}</div>
        </div>
        <span class="chip ${e.status==='open'?'yellow':'green'}">${e.status==='open'?'Disponible':'Tomado'}</span>
      </div>
      <div class="what">${e.kind==='give'?'Ofrece este turno':'Solicita cambio'}: <b>${e.note||'sin observaciones'}</b></div>
      ${e.status==='open'?`<div class="actions">
        <button class="btn sm accent" onclick="takeExch('${e.id}')">Tomar</button>
        <button class="btn sm secondary" onclick="proposeExch('${e.id}')">Proponer cambio</button>
      </div>`:`<div class="when">Tomado por ${e.takenByName||'colega'}</div>`}
    </div>`;
  }).join('');
}
function openExchModal(){
  modal(`
    <h3>Ofrecer cambio de turno</h3>
    <div class="field"><label>Tipo de oferta</label>
      <div class="toggle-btns">
        <button type="button" class="btn-toggle active" id="ex_kind_swap" onclick="selectExchKind('swap')">🔄 Cambio</button>
        <button type="button" class="btn-toggle" id="ex_kind_give" onclick="selectExchKind('give')">➡️ Ceder</button>
      </div>
      <input type="hidden" id="ex_kind" value="swap">
      <div id="ex_kind_help" style="font-size:11.5px;color:var(--muted);margin-top:4px">Pido intercambio: cambio mi turno por otro</div>
    </div>
    <div class="field"><label>Mi nombre</label><select id="ex_staff">${state.staff.map(s=>`<option value="${s.id}">${s.name}</option>`).join('')}</select></div>
    <div class="field"><label>Fecha del turno</label><input type="date" id="ex_date"></div>
    <div class="field"><label>Tipo</label><select id="ex_type">
      <option>AM</option>
      <option>PM</option>
      <option>Turno Noche</option>
      <option>Turno Día</option>
      <option>Llamada 1</option>
      <option>Llamada 2</option>
      <option>Llamada Pediatría</option>
      <option>Llamada CV</option>
    </select></div>
    <div class="field"><label>Observaciones</label><textarea id="ex_note" rows="2" placeholder="Ej: por examen, busco cambio por viernes..."></textarea></div>
    <div class="btn-row">
      <button class="btn accent" onclick="saveExch()">Publicar</button>
      <button class="btn secondary" onclick="closeModal()">Cancelar</button>
    </div>
  `);
}
function selectExchKind(kind){
  document.getElementById('ex_kind').value = kind;
  document.getElementById('ex_kind_swap').classList.toggle('active', kind==='swap');
  document.getElementById('ex_kind_give').classList.toggle('active', kind==='give');
  const help = document.getElementById('ex_kind_help');
  if(help) help.textContent = kind==='swap'
    ? 'Pido intercambio: cambio mi turno por otro'
    : 'Cedo este turno: alguien lo toma sin devolverme nada';
}
function saveExch(){
  const e = {
    id:'e'+Date.now(),
    kind:document.getElementById('ex_kind').value,
    staffId:document.getElementById('ex_staff').value,
    offeredBy:'self',
    date:document.getElementById('ex_date').value,
    type:document.getElementById('ex_type').value,
    note:document.getElementById('ex_note').value,
    status:'open',
    createdAt:new Date().toISOString()
  };
  if(!e.date){toast('Falta la fecha');return;}
  // Auto-vincular al usuario logueado
  const cu = getCurrentUser ? getCurrentUser() : null;
  if(cu){ e.staffId = cu.id; e.offeredBy = cu.id; }
  state.exchanges.unshift(e);
  if(typeof logActivity==='function') logActivity('exchange_offered', 'Publicaste '+(e.kind==='swap'?'cambio':'cesión')+' · '+e.type+' · '+formatDate(e.date));
  save(); closeModal(); renderExchanges(); toast('Oferta publicada');
}
function takeExch(id){
  const cu = getCurrentUser ? getCurrentUser() : null;
  const taker = cu ? cu.name : prompt('Tu nombre:');
  if(!taker) return;
  const e = state.exchanges.find(x=>x.id===id);
  if(!e) return;
  e.status='taken'; e.takenByName=taker; e.takenAt=new Date().toISOString();
  if(cu) e.takenById = cu.id;
  if(typeof logActivity==='function') logActivity('exchange_taken', 'Tomaste un turno · '+e.type+' · '+formatDate(e.date));
  save(); renderExchanges(); toast('Turno tomado. Avisá al colega.');
}
function proposeExch(id){
  const note = prompt('¿Qué turno ofrecés a cambio? (ej: viernes 23/5 mañana)');
  if(!note) return;
  toast('Propuesta enviada (en versión final iría por chat/email)');
}

// ============================================================
// VACACIONES
// ============================================================
let vacTab = 'pending';
function switchVacTab(ev, tab){
  vacTab = tab;
  ev.target.parentElement.querySelectorAll('button').forEach(b=>b.classList.remove('active'));
  ev.target.classList.add('active');
  renderVacations();
}
function renderVacations(){
  const list = document.getElementById('vacList');
  let items = state.vacations || [];
  const pendingCount = items.filter(v=>v.status==='pending').length;
  const badge = document.getElementById('vacCountPending');
  badge.textContent = pendingCount>0?pendingCount:'';
  badge.style.display = pendingCount>0?'inline-block':'none';
  const homeBadge = document.getElementById('vacBadgeHome');
  if(homeBadge){
    homeBadge.textContent = pendingCount>0?pendingCount:'';
    homeBadge.style.display = pendingCount>0?'inline-block':'none';
  }
  if(vacTab!=='all') items = items.filter(v=>v.status===vacTab);
  items = items.slice().sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||''));
  if(items.length===0){
    list.innerHTML = `<div class="empty"><span class="big">🌴</span>No hay solicitudes en esta sección</div>`;
    return;
  }
  list.innerHTML = items.map(v=>{
    const staff = state.staff.find(s=>s.id===v.staffId);
    const days = daysBetween(v.from, v.to);
    const statusChip = {pending:'<span class="chip yellow">Pendiente</span>',approved:'<span class="chip green">Aprobada</span>',rejected:'<span class="chip red">Rechazada</span>'}[v.status]||'';
    const resolved = (v.resolved||[]).length;
    const pending = (v.pending||[]).length;
    return `<div class="exchange ${v.status!=='pending'?'':''}">
      <div class="top">
        <div>
          <div class="who">${staff?staff.name:'(sin nombre)'}</div>
          <div class="when">${formatDate(v.from)} → ${formatDate(v.to)} · ${days} día${days===1?'':'s'}</div>
        </div>
        ${statusChip}
      </div>
      <div class="what">
        <span class="chip green">${resolved} cobertura${resolved===1?'':'s'} resuelta${resolved===1?'':'s'}</span>
        <span class="chip ${pending>0?'red':'gray'}">${pending} pendiente${pending===1?'':'s'} para el servicio</span>
      </div>
      ${v.notes?`<div class="what" style="font-style:italic;color:var(--muted)">"${v.notes}"</div>`:''}
      ${v.adminNote?`<div class="what" style="font-size:12px;background:#f0f4f5;padding:6px 8px;border-radius:6px;margin-top:4px"><b>Nota del admin:</b> ${v.adminNote}</div>`:''}
      <div class="actions">
        <button class="btn sm secondary" onclick="viewVacation('${v.id}')">Ver detalle</button>
        ${state.isAdmin && v.status==='pending'?`
          <button class="btn sm accent" onclick="decideVacation('${v.id}','approved')">Aprobar</button>
          <button class="btn sm danger" onclick="decideVacation('${v.id}','rejected')">Rechazar</button>
        `:''}
        ${state.isAdmin?`<button class="btn sm secondary" onclick="deleteVacation('${v.id}')">Eliminar</button>`:''}
      </div>
    </div>`;
  }).join('');
}
function daysBetween(a, b){
  if(!a||!b) return 0;
  const d1 = new Date(a), d2 = new Date(b);
  return Math.max(0, Math.round((d2-d1)/86400000)+1);
}
function openVacationModal(v){
  const isNew = !v;
  v = v || {id:'v'+Date.now(), staffId:state.staff[0]?.id||'', from:'', to:'', resolved:[], pending:[], notes:'', status:'pending', adminNote:'', createdAt:new Date().toISOString()};
  const renderCovRows = (arr, key) => (arr||[]).map((c,i)=>`
    <div class="row" style="margin-bottom:6px;align-items:flex-end">
      <div class="field" style="margin:0">
        <label>Fecha</label>
        <input type="date" value="${c.date||''}" data-cov="${key}" data-idx="${i}" data-fld="date" />
      </div>
      <div class="field" style="margin:0">
        <label>Tipo</label>
        <select data-cov="${key}" data-idx="${i}" data-fld="type">
          <option ${c.type==='Llamada'?'selected':''}>Llamada</option>
          <option ${c.type==='Turno'?'selected':''}>Turno</option>
          <option ${c.type==='Diurno'?'selected':''}>Diurno</option>
        </select>
      </div>
      ${key==='resolved'?`<div class="field" style="margin:0;grid-column:1/3">
        <label>Cubre</label>
        <input type="text" value="${(c.coveredBy||'').replace(/"/g,'&quot;')}" placeholder="Nombre del colega que cubre" data-cov="${key}" data-idx="${i}" data-fld="coveredBy" />
      </div>`:''}
      <div style="grid-column:1/-1;text-align:right;margin-top:-4px">
        <button class="btn sm secondary" onclick="removeCov('${key}',${i})">× quitar</button>
      </div>
    </div>
  `).join('');
  // Guardar el estado temporal en una global mientras se edita
  window._vacEditing = JSON.parse(JSON.stringify(v));
  modal(`
    <h3>${isNew?'Nueva solicitud de vacaciones':'Editar solicitud'}</h3>
    <div class="field">
      <label>Anestesiólogo</label>
      <select id="v_staff">${state.staff.map(s=>`<option value="${s.id}" ${s.id===v.staffId?'selected':''}>${s.name}</option>`).join('')}</select>
    </div>
    <div class="row">
      <div class="field"><label>Desde</label><input type="date" id="v_from" value="${v.from||''}"></div>
      <div class="field"><label>Hasta</label><input type="date" id="v_to" value="${v.to||''}"></div>
    </div>
    <div class="field">
      <label style="margin-bottom:6px">✅ Coberturas resueltas por mí</label>
      <div id="v_resolved">${renderCovRows(v.resolved,'resolved')||'<div class="help">Ninguna agregada todavía.</div>'}</div>
      <button class="btn sm secondary" style="margin-top:6px" onclick="addCov('resolved')">+ Agregar cobertura resuelta</button>
    </div>
    <div class="field">
      <label style="margin-bottom:6px">⏳ Coberturas pendientes (las debe resolver el servicio)</label>
      <div id="v_pending">${renderCovRows(v.pending,'pending')||'<div class="help">Ninguna pendiente todavía.</div>'}</div>
      <button class="btn sm secondary" style="margin-top:6px" onclick="addCov('pending')">+ Agregar pendiente</button>
    </div>
    <div class="field">
      <label>Observaciones</label>
      <textarea id="v_notes" rows="2" placeholder="Comentario opcional para la jefatura">${(v.notes||'').replace(/</g,'&lt;')}</textarea>
    </div>
    <div class="btn-row">
      <button class="btn accent" onclick="saveVacation('${v.id}', ${isNew})">${isNew?'Enviar solicitud':'Guardar cambios'}</button>
      <button class="btn secondary" onclick="closeModal()">Cancelar</button>
    </div>
  `);
  // Listeners para inputs de coberturas (capturan cambios al draft global)
  document.querySelectorAll('[data-cov]').forEach(el=>{
    el.addEventListener('input', e=>{
      const key = e.target.dataset.cov, idx = +e.target.dataset.idx, fld = e.target.dataset.fld;
      window._vacEditing[key][idx][fld] = e.target.value;
    });
    el.addEventListener('change', e=>{
      const key = e.target.dataset.cov, idx = +e.target.dataset.idx, fld = e.target.dataset.fld;
      window._vacEditing[key][idx][fld] = e.target.value;
    });
  });
}
function addCov(key){
  if(!window._vacEditing[key]) window._vacEditing[key]=[];
  if(key==='resolved') window._vacEditing[key].push({date:'',type:'Llamada',coveredBy:''});
  else window._vacEditing[key].push({date:'',type:'Llamada'});
  // Re-render del modal preservando otros campos visibles
  syncVacFormDraft();
  openVacationModal(window._vacEditing);
}
function removeCov(key, idx){
  syncVacFormDraft();
  window._vacEditing[key].splice(idx,1);
  openVacationModal(window._vacEditing);
}
function syncVacFormDraft(){
  // Capturar campos top-level del formulario antes de re-renderizar
  const f = document.getElementById('v_from'); if(f) window._vacEditing.from = f.value;
  const t = document.getElementById('v_to'); if(t) window._vacEditing.to = t.value;
  const s = document.getElementById('v_staff'); if(s) window._vacEditing.staffId = s.value;
  const n = document.getElementById('v_notes'); if(n) window._vacEditing.notes = n.value;
}
function saveVacation(id, isNew){
  syncVacFormDraft();
  const v = window._vacEditing;
  if(!v.staffId){toast('Falta el anestesiólogo');return;}
  if(!v.from||!v.to){toast('Faltan fechas');return;}
  if(v.from>v.to){toast('La fecha de inicio es posterior a la de fin');return;}
  v.id = id; v.status = v.status || 'pending';
  if(isNew){
    state.vacations = state.vacations || [];
    state.vacations.unshift(v);
    if(typeof logActivity==='function'){
      const st = state.staff.find(s=>s.id===v.staffId);
      if(st && (state.currentUserId===v.staffId || (getCurrentUser() && state.isAdmin)))
        logActivity('vacation_requested', 'Solicitaste vacaciones · '+formatDate(v.from)+' → '+formatDate(v.to));
    }
  } else {
    state.vacations = state.vacations.map(x=>x.id===id?v:x);
  }
  save(); closeModal(); renderVacations(); toast(isNew?'Solicitud enviada':'Solicitud actualizada');
  window._vacEditing = null;
}
function viewVacation(id){
  const v = state.vacations.find(x=>x.id===id); if(!v) return;
  const staff = state.staff.find(s=>s.id===v.staffId);
  const fmtList = arr => (arr||[]).length===0 ? '<div class="help">— ninguna —</div>'
    : '<table style="margin-top:4px"><thead><tr><th>Fecha</th><th>Tipo</th><th>Cubre</th></tr></thead><tbody>'+
      arr.map(c=>`<tr><td>${c.date||'-'}</td><td>${c.type||'-'}</td><td>${c.coveredBy||'-'}</td></tr>`).join('')+
      '</tbody></table>';
  modal(`
    <h3>Solicitud de ${staff?staff.name:'?'}</h3>
    <div style="font-size:13px;line-height:1.6">
      <b>Período:</b> ${formatDate(v.from)} → ${formatDate(v.to)} (${daysBetween(v.from,v.to)} días)<br>
      <b>Estado:</b> ${v.status==='pending'?'<span class="chip yellow">Pendiente</span>':v.status==='approved'?'<span class="chip green">Aprobada</span>':'<span class="chip red">Rechazada</span>'}<br>
      ${v.notes?`<b>Observaciones:</b> ${v.notes}<br>`:''}
      ${v.adminNote?`<b>Nota del admin:</b> ${v.adminNote}<br>`:''}
      <div style="margin-top:10px"><b>✅ Coberturas resueltas:</b>${fmtList(v.resolved)}</div>
      <div style="margin-top:10px"><b>⏳ Pendientes (servicio):</b>${fmtList(v.pending)}</div>
    </div>
    <div class="btn-row" style="margin-top:14px">
      ${state.isAdmin && v.status==='pending'?`
        <button class="btn accent" onclick="decideVacation('${v.id}','approved')">Aprobar</button>
        <button class="btn danger" onclick="decideVacation('${v.id}','rejected')">Rechazar</button>
      `:''}
      <button class="btn secondary" onclick="closeModal();openVacationModal(state.vacations.find(x=>x.id==='${v.id}'))">Editar</button>
      <button class="btn secondary" onclick="closeModal()">Cerrar</button>
    </div>
  `);
}
function decideVacation(id, decision){
  const note = prompt(decision==='approved'
    ? 'Comentario para la aprobación (opcional):'
    : 'Motivo del rechazo (opcional):') || '';
  const v = state.vacations.find(x=>x.id===id); if(!v) return;
  v.status = decision;
  v.adminNote = note;
  v.decidedAt = new Date().toISOString();
  save(); closeModal(); renderVacations();
  toast(decision==='approved'?'Solicitud aprobada':'Solicitud rechazada');
}
function deleteVacation(id){
  if(!confirm('¿Eliminar esta solicitud?')) return;
  state.vacations = state.vacations.filter(v=>v.id!==id);
  save(); renderVacations(); toast('Eliminada');
}

// ============================================================
// ESTADÍSTICAS
// ============================================================
let charts = {};
function _ensureStatsHidden(){
  if(!state.stats.hidden) state.stats.hidden = {cases:false, type:false, staff:false};
  return state.stats.hidden;
}
function _renderChartSection(key, sectionId, hasData, renderFn){
  const hidden = _ensureStatsHidden();
  const section = document.getElementById(sectionId);
  if(!section) return;
  if(hidden[key]){
    section.style.display = 'none';
    if(charts[key]){ try{ charts[key].destroy(); }catch(e){} delete charts[key]; }
    return;
  }
  section.style.display = '';
  if(charts[key]){ try{ charts[key].destroy(); }catch(e){} delete charts[key]; }
  if(hasData) renderFn();
  else {
    // Reemplazar canvas por mensaje vacío temporalmente
    const canvas = section.querySelector('canvas');
    if(canvas && !section.querySelector('.empty-chart')){
      const empty = document.createElement('div');
      empty.className = 'empty-chart';
      empty.textContent = 'No hay datos. Cargá tu Excel desde la sección de Administración.';
      canvas.style.display = 'none';
      canvas.parentNode.insertBefore(empty, canvas.nextSibling);
    }
  }
}
function _restoreCanvases(){
  ['chartCases','chartType','chartStaff'].forEach(id=>{
    const cv = document.getElementById(id);
    if(cv){ cv.style.display = ''; }
    const sec = document.getElementById('section-'+id);
    if(sec){ const e = sec.querySelector('.empty-chart'); if(e) e.remove(); }
  });
}

function renderStats(){
  _ensureStatsHidden();
  _restoreCanvases();

  const cases = state.stats.casesByMonth || [];
  document.getElementById('statCases').textContent = cases[new Date().getMonth()]||0;
  document.getElementById('statHours').textContent = Math.round((cases[new Date().getMonth()]||0)*1.8);
  document.getElementById('statStaff').textContent = state.staff.length;
  document.getElementById('statOnCall').textContent = (state.shifts||[]).filter(s=>s.type==='Guardia'&&s.date.startsWith(state.currentMonth)).length;

  // Info de última importación
  const info = document.getElementById('statsImportInfo');
  if(info){
    const li = state.stats.lastImport;
    info.textContent = li ? `Última importación: ${li.filename} — ${new Date(li.at).toLocaleString()}` : 'Aún no has importado un Excel.';
  }

  // Chart 1: Casos por mes
  _renderChartSection('cases', 'section-chartCases', cases.length>0 && cases.some(v=>v>0), ()=>{
    charts.cases = new Chart(document.getElementById('chartCases'), {
      type:'bar',
      data:{labels:['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'],
        datasets:[{label:'Casos',data:cases,backgroundColor:'#5fb49c'}]},
      options:{plugins:{legend:{display:false}},scales:{y:{beginAtZero:true}}}
    });
  });

  // Chart 2: Tipo de procedimiento
  const pt = state.stats.procedureTypes || {};
  _renderChartSection('type', 'section-chartType', Object.keys(pt).length>0, ()=>{
    charts.type = new Chart(document.getElementById('chartType'), {
      type:'doughnut',
      data:{labels:Object.keys(pt),datasets:[{data:Object.values(pt),backgroundColor:['#1e6b54','#2e8b6b','#5fb49c','#88c8b3','#a8d8c5','#3d8a76']}]},
      options:{plugins:{legend:{position:'bottom',labels:{boxWidth:12,font:{size:11}}}}}
    });
  });

  // Chart 3: Carga por anestesiólogo
  let staffLoad;
  if(state.stats.customStaffLoad && state.stats.customStaffLoad.length){
    staffLoad = state.stats.customStaffLoad;
  } else {
    const shiftCount = {};
    (state.shifts||[]).forEach(sh=>{ shiftCount[sh.staffId] = (shiftCount[sh.staffId]||0)+1; });
    staffLoad = state.staff.map(s=>({n:s.name.replace(/Dr\.|Dra\./,'').split(',')[0].trim(), v:shiftCount[s.id]||0}));
  }
  _renderChartSection('staff', 'section-chartStaff', staffLoad.length>0, ()=>{
    charts.staff = new Chart(document.getElementById('chartStaff'), {
      type:'bar',
      data:{labels:staffLoad.map(x=>x.n),datasets:[{label:'Turnos / casos',data:staffLoad.map(x=>x.v),backgroundColor:'#2e8b6b'}]},
      options:{indexAxis:'y',plugins:{legend:{display:false}},scales:{x:{beginAtZero:true}}}
    });
  });
}

function hideChart(key){
  if(!state.isAdmin){ toast('Solo admin'); return; }
  if(!confirm('¿Eliminar este gráfico de la vista? Podés restaurarlos desde "Mostrar todos los gráficos".')) return;
  _ensureStatsHidden();
  state.stats.hidden[key] = true;
  save();
  renderStats();
  toast('Gráfico ocultado');
}
function resetHiddenCharts(){
  if(!state.isAdmin){ toast('Solo admin'); return; }
  _ensureStatsHidden();
  state.stats.hidden = {cases:false, type:false, staff:false};
  save();
  renderStats();
  toast('Todos los gráficos visibles');
}
function restoreSampleStats(){
  if(!state.isAdmin){ toast('Solo admin'); return; }
  if(!confirm('¿Restaurar los datos de muestra originales? Se perderán los datos importados.')) return;
  state.stats.casesByMonth = [120,135,128,142,150,138,145,160,155,148,140,132];
  state.stats.procedureTypes = {General:45, Regional:25, Sedacion:18, Combinada:12};
  state.stats.customStaffLoad = null;
  state.stats.lastImport = null;
  save();
  renderStats();
  toast('Datos de muestra restaurados');
}

// --- IMPORTACIÓN DE EXCEL ---
function openImportStatsModal(){
  if(!state.isAdmin){ toast('Solo admin'); return; }
  modal(`
    <h3>📂 Importar Excel de estadísticas</h3>
    <p class="help" style="margin-bottom:10px">Subí un archivo <b>.xlsx</b> con la siguiente estructura recomendada:</p>
    <div style="background:#f7fcf9;border:1px solid var(--green-pale);border-radius:10px;padding:12px;font-size:12px;line-height:1.6;margin-bottom:14px">
      <b>Hoja 1 — "Casos por mes":</b> columna A: mes (Ene…Dic), columna B: cantidad de casos.<br>
      <b>Hoja 2 — "Tipos":</b> columna A: tipo (General, Regional…), columna B: cantidad.<br>
      <b>Hoja 3 — "Anestesiólogos":</b> columna A: nombre, columna B: casos/turnos.<br>
      <i>Las hojas que no estén se ignoran. Los nombres se buscan también de forma aproximada.</i>
    </div>
    <div class="field">
      <label>Archivo Excel</label>
      <input type="file" id="statsFile" accept=".xlsx,.xls,.csv" />
    </div>
    <div class="btn-row">
      <button class="btn accent" onclick="importStatsXLSX()">Importar</button>
      <button class="btn secondary" onclick="closeModal()">Cancelar</button>
    </div>
  `);
}

function importStatsXLSX(){
  const inp = document.getElementById('statsFile');
  if(!inp || !inp.files || !inp.files[0]){ toast('Seleccioná un archivo'); return; }
  const file = inp.files[0];
  if(typeof XLSX === 'undefined'){ toast('Librería XLSX no disponible'); return; }
  const reader = new FileReader();
  reader.onload = function(e){
    try{
      const wb = XLSX.read(e.target.result, {type:'array'});
      const results = { casos:false, tipos:false, staff:false, sheets:[] };
      // Buscar hojas por nombre aproximado
      const findSheet = (patterns)=>{
        for(const name of wb.SheetNames){
          const lower = name.toLowerCase();
          for(const p of patterns){ if(lower.includes(p)) return name; }
        }
        return null;
      };
      const sheetCasos = findSheet(['caso','mes','mensual']);
      const sheetTipos = findSheet(['tipo','procedim','categor']);
      const sheetStaff = findSheet(['anest','staff','medic','equipo']);

      // Casos por mes (12 meses)
      if(sheetCasos){
        const data = XLSX.utils.sheet_to_json(wb.Sheets[sheetCasos], {header:1, defval:''});
        const arr = new Array(12).fill(0);
        const meses = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
        data.forEach(row=>{
          if(row.length < 2) return;
          const m = String(row[0]||'').toLowerCase().slice(0,3);
          const v = parseFloat(row[1]);
          const idx = meses.indexOf(m);
          if(idx>=0 && !isNaN(v)) arr[idx] = v;
        });
        if(arr.some(v=>v>0)){
          state.stats.casesByMonth = arr;
          results.casos = true;
        }
      }
      // Tipos
      if(sheetTipos){
        const data = XLSX.utils.sheet_to_json(wb.Sheets[sheetTipos], {header:1, defval:''});
        const obj = {};
        data.forEach(row=>{
          if(row.length < 2) return;
          const k = String(row[0]||'').trim();
          const v = parseFloat(row[1]);
          if(k && !isNaN(v) && k.toLowerCase()!=='tipo') obj[k] = v;
        });
        if(Object.keys(obj).length){
          state.stats.procedureTypes = obj;
          results.tipos = true;
        }
      }
      // Staff
      if(sheetStaff){
        const data = XLSX.utils.sheet_to_json(wb.Sheets[sheetStaff], {header:1, defval:''});
        const arr = [];
        data.forEach(row=>{
          if(row.length < 2) return;
          const n = String(row[0]||'').trim();
          const v = parseFloat(row[1]);
          if(n && !isNaN(v) && n.toLowerCase().indexOf('nombre')<0) arr.push({n, v});
        });
        if(arr.length){
          state.stats.customStaffLoad = arr;
          results.staff = true;
        }
      }
      results.sheets = wb.SheetNames;
      state.stats.lastImport = { at:new Date().toISOString(), filename:file.name, sheets:wb.SheetNames };
      save();
      closeModal();
      renderStats();

      const done = [];
      if(results.casos) done.push('Casos por mes');
      if(results.tipos) done.push('Tipos');
      if(results.staff) done.push('Anestesiólogos');
      if(done.length === 0){
        toast('No se identificaron hojas válidas. Revisá los nombres y formato.');
      } else {
        toast('Importado: ' + done.join(', '));
      }
    }catch(err){
      console.error(err);
      toast('Error al leer el Excel: ' + (err.message||err));
    }
  };
  reader.onerror = function(){ toast('No se pudo leer el archivo'); };
  reader.readAsArrayBuffer(file);
}

// Mantener compatibilidad con llamada antigua si quedó algún input viejo
function importStats(ev){ openImportStatsModal(); }

// ============================================================
// EQUIPO
// ============================================================
function renderTeam(){
  const list = document.getElementById('teamList');
  list.innerHTML = `<table><thead><tr><th>Nombre</th><th>Rol</th><th>Puntaje</th>${state.isAdmin?'<th></th>':''}</tr></thead><tbody>${
    state.staff.map(s=>{
      const score = computeScore(s);
      return `<tr>
        <td>${s.name}</td>
        <td><span class="chip ${s.role==='Jefa'||s.role==='Jefe'?'blue':(s.role==='Residente'?'yellow':'gray')}">${s.role}</span></td>
        <td><b>${score}</b></td>
        ${state.isAdmin?`<td><button class="btn sm secondary" onclick="editStaff('${s.id}')">Editar</button></td>`:''}
      </tr>`;
    }).join('')
  }</tbody></table>`;
}
function openStaffModal(s){
  const isNew = !s;
  s = s || {id:'s'+Date.now(), name:'', role:'Staff', cumplimientoJornadas:'75-85', jornadasBorradas:0, equipoTMT:false, equipoCardio:false, equipoPediatria:false, rolCoordinacion:false, noFondoComun:false, residenciaAnios:'1-5', esResidente:false, llamadaPediatrica:false, llamadaCardio:false, primeraLlamadaFija:false, segundaLlamadaFija:false, coberturaTurnoUrg:false, coberturaLlamada1:false, coberturaLlamada2:false, exentoCobertura:false};
  modal(`
    <h3>${isNew?'Agregar miembro':'Editar miembro'}</h3>
    <div class="field"><label>Nombre completo</label><input id="st_name" value="${s.name||''}"></div>
    <div class="field"><label>Rol</label><select id="st_role">
      ${['Jefe','Jefa','Staff','Residente','Rotante'].map(r=>`<option ${r===s.role?'selected':''}>${r}</option>`).join('')}
    </select></div>
    <div class="field">
      <label>Cumpleaños (opcional)</label>
      <input id="st_birthday" placeholder="MM-DD · ej: 03-21" value="${s.birthday||''}" maxlength="5">
      <p class="help" style="margin-top:4px">Formato MM-DD. Aparecerá automáticamente en el Calendario de Eventos.</p>
    </div>
    <hr style="margin:14px 0;border:0;border-top:1px solid var(--border)">
    <p class="help">Parámetros del Índice de Permanencia (solo administrador).</p>
    <div class="field">
      <label>Cumplimiento de jornadas (últimos 6 meses)</label>
      <select id="st_cumpl">
        <option value=">90" ${s.cumplimientoJornadas==='>90'?'selected':''}>Más de 90% (+2)</option>
        <option value="85-90" ${s.cumplimientoJornadas==='85-90'?'selected':''}>85% a 90% (+1)</option>
        <option value="75-85" ${(s.cumplimientoJornadas==='75-85'||!s.cumplimientoJornadas)?'selected':''}>75% a 85% (0)</option>
        <option value="<75" ${s.cumplimientoJornadas==='<75'?'selected':''}>Menos de 75% (−1)</option>
      </select>
    </div>
    <div class="field">
      <label>Jornadas borradas (últimos 6 meses)</label>
      <input type="number" min="0" step="1" id="st_borradas" value="${s.jornadasBorradas||0}">
    </div>
    <div class="field"><label><input type="checkbox" id="st_tmt" ${s.equipoTMT?'checked':''}> Equipo TMT (+3)</label></div>
    <div class="field"><label><input type="checkbox" id="st_cardio" ${s.equipoCardio?'checked':''}> Equipo Cardiocirugía (+3)</label></div>
    <div class="field"><label><input type="checkbox" id="st_ped" ${s.equipoPediatria?'checked':''}> Equipo Pediatría Complejo (+3)</label></div>
    <div class="field"><label><input type="checkbox" id="st_coord" ${s.rolCoordinacion?'checked':''}> Rol Coordinación / Jefatura / Docente (+2)</label></div>
    <div class="field"><label><input type="checkbox" id="st_nofc" ${s.noFondoComun?'checked':''}> No pertenece al Fondo Común (+3)</label></div>
    <div class="btn-row">
      <button class="btn accent" onclick="saveStaff('${s.id}', ${isNew})">Guardar</button>
      ${!isNew?`<button class="btn danger" onclick="deleteStaff('${s.id}')">Eliminar</button>`:''}
      <button class="btn secondary" onclick="closeModal()">Cancelar</button>
    </div>
  `);
}
function editStaff(id){ const s = state.staff.find(x=>x.id===id); if(s) openStaffModal(s); }
function saveStaff(id, isNew){
  // Validar cumpleaños: MM-DD o vacío
  const bdInput = (document.getElementById('st_birthday').value||'').trim();
  let birthday = '';
  if(bdInput){
    const m = bdInput.match(/^(\d{2})-(\d{2})$/);
    if(!m){ toast('Cumpleaños inválido: usá MM-DD (ej: 03-21)'); return; }
    const mm = parseInt(m[1],10), dd = parseInt(m[2],10);
    if(mm<1 || mm>12 || dd<1 || dd>31){ toast('Cumpleaños fuera de rango'); return; }
    birthday = bdInput;
  }
  // Preservar campos previos no editables aquí
  const prev = state.staff.find(s=>s.id===id) || {};
  const data = Object.assign({}, prev, {
    id,
    name: document.getElementById('st_name').value,
    role: document.getElementById('st_role').value,
    cumplimientoJornadas: document.getElementById('st_cumpl').value,
    jornadasBorradas: parseInt(document.getElementById('st_borradas').value||'0',10)||0,
    equipoTMT: document.getElementById('st_tmt').checked,
    equipoCardio: document.getElementById('st_cardio').checked,
    equipoPediatria: document.getElementById('st_ped').checked,
    rolCoordinacion: document.getElementById('st_coord').checked,
    noFondoComun: document.getElementById('st_nofc').checked,
    birthday
  });
  if(!data.name){toast('Falta el nombre');return;}
  if(isNew) state.staff.push(data);
  else state.staff = state.staff.map(s=>s.id===id?data:s);
  save(); closeModal(); renderTeam(); renderRanking(); toast('Guardado');
}
function deleteStaff(id){
  if(!confirm('¿Eliminar este miembro?')) return;
  state.staff = state.staff.filter(s=>s.id!==id);
  save(); closeModal(); renderTeam(); toast('Eliminado');
}

// ============================================================
// PROTOCOLOS
// ============================================================
function renderProtocols(){
  const list = document.getElementById('protoList');
  list.innerHTML = state.protocols.map(p=>{
    const hasFile = p.fileUrl && p.fileUrl.length>0;
    const fileBlock = hasFile
      ? `<div class="btn-row" style="margin-top:8px">
           <a class="btn sm accent" href="${p.fileUrl}" target="_blank" rel="noopener">📄 Abrir PDF${p.fileName?' · '+p.fileName.replace(/</g,'&lt;'):''}</a>
           <a class="btn sm secondary" href="${p.fileUrl}" download>⬇ Descargar</a>
         </div>`
      : '';
    return `<div class="detail-card">
      <div class="head">${p.title}</div>
      <div style="font-size:13px;color:var(--text);white-space:pre-wrap">${p.body||''}</div>
      ${fileBlock}
      ${state.isAdmin?`<div class="btn-row"><button class="btn sm secondary" onclick="editProto('${p.id}')">Editar</button><button class="btn sm danger" onclick="deleteProto('${p.id}')">Eliminar</button></div>`:''}
    </div>`;
  }).join('');
}
function openProtoModal(p){
  const isNew = !p;
  p = p || {id:'p'+Date.now(), title:'', body:'', fileUrl:'', fileName:''};
  modal(`
    <h3>${isNew?'Nuevo protocolo':'Editar protocolo'}</h3>
    <div class="field"><label>Título</label><input id="pr_title" value="${(p.title||'').replace(/"/g,'&quot;')}"></div>
    <div class="field"><label>Descripción / Contenido</label><textarea id="pr_body" rows="6">${p.body||''}</textarea></div>
    <div class="field">
      <label>Archivo PDF (opcional)</label>
      <input type="file" accept="application/pdf,.pdf" id="pr_file" onchange="loadProtoFile(event)">
      <div class="help">Adjuntá un PDF y se guardará en la App (vía Base64 en este navegador).</div>
      <div id="pr_file_info" style="margin-top:6px;font-size:13px;color:var(--text)">${p.fileUrl?`Actual: <b>${(p.fileName||'archivo.pdf').replace(/</g,'&lt;')}</b> · <a href="${p.fileUrl}" target="_blank">ver</a> · <button class="btn sm danger" onclick="clearProtoFile()" style="margin-left:6px">Quitar</button>`:'Sin archivo'}</div>
      <input type="hidden" id="pr_file_url" value="${(p.fileUrl||'').replace(/"/g,'&quot;')}">
      <input type="hidden" id="pr_file_name" value="${(p.fileName||'').replace(/"/g,'&quot;')}">
    </div>
    <div class="btn-row">
      <button class="btn accent" onclick="saveProto('${p.id}', ${isNew})">Guardar</button>
      <button class="btn secondary" onclick="closeModal()">Cancelar</button>
    </div>
  `);
}
function loadProtoFile(ev){
  const f = ev.target.files[0];
  if(!f) return;
  if(f.size > 8*1024*1024){ toast('PDF demasiado grande (máx 8 MB)'); ev.target.value=''; return; }
  const reader = new FileReader();
  reader.onload = function(){
    document.getElementById('pr_file_url').value = reader.result;
    document.getElementById('pr_file_name').value = f.name;
    document.getElementById('pr_file_info').innerHTML = `Listo: <b>${f.name.replace(/</g,'&lt;')}</b> · <button class="btn sm danger" onclick="clearProtoFile()" style="margin-left:6px">Quitar</button>`;
  };
  reader.readAsDataURL(f);
}
function clearProtoFile(){
  document.getElementById('pr_file_url').value = '';
  document.getElementById('pr_file_name').value = '';
  document.getElementById('pr_file').value = '';
  document.getElementById('pr_file_info').innerHTML = 'Sin archivo';
}
function editProto(id){ const p = state.protocols.find(x=>x.id===id); if(p) openProtoModal(p); }
function saveProto(id, isNew){
  const data = {
    id,
    title: document.getElementById('pr_title').value,
    body: document.getElementById('pr_body').value,
    fileUrl: document.getElementById('pr_file_url').value,
    fileName: document.getElementById('pr_file_name').value,
  };
  if(!data.title){toast('Falta el título');return;}
  if(isNew) state.protocols.push(data);
  else state.protocols = state.protocols.map(p=>p.id===id?data:p);
  save(); closeModal(); renderProtocols(); toast('Guardado');
}
function deleteProto(id){
  if(!confirm('¿Eliminar este protocolo?')) return;
  state.protocols = state.protocols.filter(p=>p.id!==id);
  save(); renderProtocols(); toast('Eliminado');
}

// ============================================================
// HORARIO EN LÍNEA (EMBED del Excel de OneDrive / Sheets)
// ============================================================
function renderHorario(){
  const url = state.horarioEmbedURL;
  const empty = document.getElementById('horarioEmpty');
  const cont = document.getElementById('horarioContainer');
  const badge = document.getElementById('horarioBadge');
  if(!url){
    empty.style.display = '';
    cont.style.display = 'none';
    badge.style.display = 'none';
    // Si no es admin, mostrar mensaje distinto
    if(!state.isAdmin){
      empty.innerHTML = `<span class="big">📊</span>El administrador todavía no configuró el horario en línea.`;
    } else {
      empty.innerHTML = `<span class="big">📊</span>Todavía no configuraste el horario en línea.<br><button class="btn accent" style="margin-top:14px" onclick="openHorarioModal()">Configurar enlace</button>`;
    }
    return;
  }
  empty.style.display = 'none';
  cont.style.display = '';
  badge.style.display = '';
  const embedURL = toEmbedURL(url);
  const frame = document.getElementById('horarioFrame');
  if(frame.src !== embedURL){
    showHorarioLoading();
    frame.src = embedURL;
  } else {
    // Si el iframe ya estaba cargado, igual mostramos brevemente el mensaje
    // por si tarda en aparecer al volver a la vista.
    showHorarioLoading();
    setTimeout(hideHorarioLoading, 1200);
  }
  document.getElementById('horarioOpenLink').href = url;
}
function toEmbedURL(url){
  // Si el usuario pegó el enlace de iframe completo, extraemos el src
  const srcMatch = url.match(/src=["']([^"']+)["']/i);
  if(srcMatch) return srcMatch[1];
  // OneDrive personal: convertir varios formatos a la URL de embed
  if(url.includes('onedrive.live.com')){
    // Caso 1: enlace de edición ".../edit?id=...&resid=...&authkey=..."
    if(url.includes('/edit?') || url.includes('/edit.aspx')){
      try{
        const q = new URL(url);
        const resid = q.searchParams.get('resid') || q.searchParams.get('id');
        const authkey = q.searchParams.get('authkey');
        const cid = q.searchParams.get('cid') || (resid ? resid.split('!')[0] : '');
        if(resid){
          let embed = `https://onedrive.live.com/embed?resid=${encodeURIComponent(resid)}`;
          if(authkey) embed += `&authkey=${encodeURIComponent(authkey)}`;
          if(cid) embed += `&cid=${encodeURIComponent(cid)}`;
          embed += '&em=2';
          return embed;
        }
      }catch(e){/* fallback debajo */}
    }
    // Caso 2: view.aspx / redir
    let u = url.replace('view.aspx','embed.aspx').replace('redir?','embed?');
    if(!u.includes('action=embedview') && !u.includes('/embed?')) u += (u.includes('?')?'&':'?')+'action=embedview';
    return u;
  }
  // OneDrive 1drv.ms (acortado): añadimos hint embed; el usuario debería pegar el embed completo
  if(url.includes('1drv.ms')){
    return url; // se carga tal cual; recomendamos al usuario usar el embed code
  }
  // SharePoint / Office 365 business: cambiar :x: (Excel viewer) por embed
  if(url.includes('sharepoint.com') || url.includes('-my.sharepoint.com') || url.includes('officeapps.live.com')){
    if(!url.includes('action=embedview')) return url + (url.includes('?')?'&':'?')+'action=embedview';
    return url;
  }
  // Google Sheets: convertir a versión embed
  if(url.includes('docs.google.com/spreadsheets')){
    let u = url.replace(/\/edit.*$/,'/preview');
    if(!u.endsWith('/preview') && !u.includes('/htmlview') && !u.includes('/pubhtml')) u = u.replace(/\/?$/,'/preview');
    return u;
  }
  return url;
}
function openHorarioModal(){
  const cur = state.horarioEmbedURL || '';
  modal(`
    <h3>📊 Configurar horario en línea</h3>
    <div class="alert info" style="font-size:12px">
      Pegá el enlace de tu Excel de OneDrive. La App lo mostrará embebido. Recomendado: usar el código <b>"Insertar / Embed"</b> de OneDrive (ver instrucciones abajo).
    </div>
    <div class="field">
      <label>URL del Excel o código embed</label>
      <textarea id="hor_url" rows="3" placeholder="https://onedrive.live.com/... o pegá el código &lt;iframe src=&quot;...&quot;&gt;...&lt;/iframe&gt;">${cur.replace(/</g,'&lt;')}</textarea>
      <div class="help">Acepta enlaces de OneDrive, SharePoint, Google Sheets, o el código iframe completo (se extrae el src automáticamente).</div>
    </div>
    <div class="btn-row">
      <button class="btn accent" onclick="saveHorario()">Guardar</button>
      ${cur?`<button class="btn warn" onclick="clearHorario()">Quitar</button>`:''}
      <button class="btn secondary" onclick="closeModal()">Cancelar</button>
    </div>
    <div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border);font-size:12px;color:var(--muted);line-height:1.5">
      <b>¿Cómo obtener el código embed de tu Excel en OneDrive?</b><br>
      1. Abrí tu Excel en OneDrive (Excel para web).<br>
      2. Menú <b>Archivo → Compartir → Insertar</b> (o "Embed").<br>
      3. Configurá qué hoja/rango se muestra (podés mostrar la del mes actual).<br>
      4. Copiá el código que empieza con <code>&lt;iframe src="..."&gt;</code>.<br>
      5. Pegalo entero acá arriba. Se extrae el src automático.<br><br>
      <b>Alternativa (más simple):</b> Compartir → "Cualquiera con el enlace puede ver" → copiar enlace → pegar acá.
    </div>
  `);
}
function saveHorario(){
  const val = document.getElementById('hor_url').value.trim();
  if(!val){ toast('Pegá un enlace'); return; }
  state.horarioEmbedURL = val;
  save(); closeModal(); renderHorario(); toast('Horario en línea guardado');
}
function clearHorario(){
  if(!confirm('¿Quitar el enlace del horario en línea?')) return;
  state.horarioEmbedURL = '';
  save(); closeModal(); renderHorario(); toast('Enlace quitado');
}
function showHorarioLoading(){
  const el = document.getElementById('horarioLoading');
  if(el) el.style.display = 'flex';
}
function hideHorarioLoading(){
  const el = document.getElementById('horarioLoading');
  if(!el) return;
  // Pequeño delay para que el render dentro del iframe alcance a aparecer
  setTimeout(()=>{ el.style.display = 'none'; }, 400);
}
function reloadHorario(){
  const frame = document.getElementById('horarioFrame');
  showHorarioLoading();
  frame.src = frame.src;
  toast('Recargando...');
}
function openHorarioFullscreen(){
  const wrap = document.getElementById('horarioFrameWrap');
  if(wrap.requestFullscreen) wrap.requestFullscreen();
  else if(wrap.webkitRequestFullscreen) wrap.webkitRequestFullscreen();
}

// ============================================================
// RELOJ CONTROL (cronómetro)
// ============================================================
let relojState = { running:false, startMs:0, elapsedMs:0, lapBaseMs:0, laps:[] };
let relojTickInterval = null;
let relojClockInterval = null;

function _pad(n,w=2){ return String(n).padStart(w,'0'); }
function _formatHMS(ms){
  const total = Math.floor(ms/1000);
  const h = Math.floor(total/3600);
  const m = Math.floor((total%3600)/60);
  const s = total%60;
  return `${_pad(h)}:${_pad(m)}:${_pad(s)}`;
}
function _formatMs(ms){ return '.'+_pad(Math.floor(ms%1000),3); }

function relojCurrentMs(){
  return relojState.running ? relojState.elapsedMs + (Date.now() - relojState.startMs) : relojState.elapsedMs;
}
function relojRenderDisplay(){
  const ms = relojCurrentMs();
  const d = document.getElementById('relojDisplay');
  const dms = document.getElementById('relojMs');
  if(!d) return;
  d.firstChild.nodeValue = _formatHMS(ms);
  if(dms) dms.textContent = _formatMs(ms);
}
function relojRenderClock(){
  const el = document.getElementById('relojClock');
  if(!el) return;
  const now = new Date();
  el.textContent = `${_pad(now.getHours())}:${_pad(now.getMinutes())}:${_pad(now.getSeconds())}`;
}
function relojRenderLaps(){
  const c = document.getElementById('relojLaps');
  if(!c) return;
  if(!relojState.laps.length){ c.innerHTML = ''; return; }
  c.innerHTML = relojState.laps.map((lap,i)=>{
    const delta = i===0 ? lap.totalMs : lap.totalMs - relojState.laps[i-1].totalMs;
    return `<div class="reloj-lap"><span class="lap-n">Vuelta ${i+1}</span><span class="lap-t">${_formatHMS(lap.totalMs)}${_formatMs(lap.totalMs)}</span><span class="lap-delta">+${_formatHMS(delta)}${_formatMs(delta)}</span></div>`;
  }).reverse().join('');
}
function relojToggleButtons(){
  const start = document.getElementById('relojBtnStart');
  const pause = document.getElementById('relojBtnPause');
  const resume = document.getElementById('relojBtnResume');
  if(!start || !pause || !resume) return;
  if(relojState.running){
    start.style.display='none'; pause.style.display=''; resume.style.display='none';
  } else if(relojState.elapsedMs > 0){
    start.style.display='none'; pause.style.display='none'; resume.style.display='';
  } else {
    start.style.display=''; pause.style.display='none'; resume.style.display='none';
  }
}
function relojStart(){
  if(relojState.running) return;
  relojState.running = true;
  relojState.startMs = Date.now();
  if(!relojTickInterval) relojTickInterval = setInterval(relojRenderDisplay, 50);
  relojToggleButtons();
}
function relojPause(){
  if(!relojState.running) return;
  relojState.elapsedMs += Date.now() - relojState.startMs;
  relojState.running = false;
  relojToggleButtons();
  relojRenderDisplay();
}
function relojResume(){ relojStart(); }
function relojLap(){
  const total = relojCurrentMs();
  if(total <= 0){ toast('Iniciá el cronómetro primero'); return; }
  relojState.laps.push({ totalMs: total, at: Date.now() });
  relojRenderLaps();
}
function relojReset(){
  if(relojState.running || relojState.elapsedMs > 0 || relojState.laps.length){
    if(!confirm('¿Reiniciar cronómetro? Se perderán las vueltas registradas.')) return;
  }
  relojState.running = false;
  relojState.startMs = 0;
  relojState.elapsedMs = 0;
  relojState.laps = [];
  relojRenderDisplay();
  relojRenderLaps();
  relojToggleButtons();
}
function relojInit(){
  relojRenderDisplay();
  relojRenderClock();
  relojRenderLaps();
  relojToggleButtons();
  if(!relojClockInterval) relojClockInterval = setInterval(relojRenderClock, 1000);
  if(relojState.running && !relojTickInterval){
    relojTickInterval = setInterval(relojRenderDisplay, 50);
  }
}

// ============================================================
// UTILIDADES
// ============================================================
function formatDate(d){
  const dt = new Date(d+'T12:00:00');
  return dt.toLocaleDateString('es-ES',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
}
function toast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(()=>t.classList.remove('show'),2200);
}
function modal(html){
  document.getElementById('modalBox').innerHTML = html;
  document.getElementById('modal').classList.add('open');
}
function closeModal(){ document.getElementById('modal').classList.remove('open'); }
document.getElementById('modal').addEventListener('click', e=>{ if(e.target.id==='modal') closeModal(); });

// ============================================================
// PEDIATRÍA — Dosis por kg (referencia clínica)
// ============================================================
const PEDIATRIA_DATA = [
  { cat:'Inducción intravenosa', drugs:[
    { name:'Propofol',           dose:'2,5–3,5 mg/kg IV',                                   note:'Niños >3 años requieren dosis mayores que adultos. Mantención: 5–10 mg/kg/h.' },
    { name:'Tiopental',          dose:'5–7 mg/kg IV',                                       note:'RN/lactantes: 3–4 mg/kg.' },
    { name:'Ketamina IV',        dose:'1–2 mg/kg IV',                                       note:'Útil en inestabilidad. Asociar atropina 0,02 mg/kg o glicopirrolato 0,005 mg/kg.' },
    { name:'Ketamina IM',        dose:'4–6 mg/kg IM',                                       note:'Para induc. sin acceso venoso. Inicio 3–5 min.' },
    { name:'Etomidato',          dose:'0,2–0,3 mg/kg IV',                                   note:'Estabilidad hemodinámica. Evitar uso prolongado por inhibición suprarrenal.' },
    { name:'Midazolam (coinductor)', dose:'0,05–0,2 mg/kg IV',                              note:'Reduce dosis de propofol. Cuidado en lactantes <6 meses.' },
    { name:'Dexmedetomidina bolo',dose:'1 µg/kg IV en 10 min',                              note:'Carga lenta para evitar bradicardia/hipotensión.' },
    { name:'Dexmedetomidina inf.',dose:'0,2–1 µg/kg/h',                                     note:'Mantención. No deprime ventilación.' },
  ]},
  { cat:'Premedicación', drugs:[
    { name:'Midazolam VO',       dose:'0,5 mg/kg VO (máx 20 mg)',                            note:'Inicio 15–20 min. Útil para separación de padres.' },
    { name:'Midazolam IN',       dose:'0,2–0,3 mg/kg intranasal',                            note:'Inicio rápido (5–10 min). Puede arder al instilar.' },
    { name:'Ketamina VO',        dose:'5–6 mg/kg VO',                                        note:'Útil en niños no colaboradores.' },
    { name:'Clonidina VO',       dose:'2–4 µg/kg VO',                                        note:'Sedación + analgesia + reduce delirio post-emergencia.' },
    { name:'Dexmedetomidina IN', dose:'2–4 µg/kg intranasal',                                note:'Sedación de calidad, sin depresión respiratoria. Inicio 30–45 min.' },
    { name:'Paracetamol VO premed.',dose:'20–30 mg/kg VO',                                   note:'Dosis de carga preoperatoria.' },
  ]},
  { cat:'Bloqueadores neuromusculares', drugs:[
    { name:'Succinilcolina IV',  dose:'1–2 mg/kg IV',                                        note:'Lactantes: 2 mg/kg. Considerar atropina previa. Evitar en hiperK, distrofias, quemados >24h.' },
    { name:'Succinilcolina IM',  dose:'4 mg/kg IM',                                          note:'Si no hay acceso venoso, vía aérea complicada.' },
    { name:'Rocuronio intubación', dose:'0,6 mg/kg IV',                                      note:'Duración ~30 min.' },
    { name:'Rocuronio ISR',      dose:'1,2 mg/kg IV',                                        note:'Inicio 60–90s. Revertir con sugammadex.' },
    { name:'Vecuronio',          dose:'0,1 mg/kg IV',                                        note:'Duración 30–45 min.' },
    { name:'Cisatracurio',       dose:'0,15 mg/kg IV',                                       note:'Eliminación Hofmann, útil en insuf. renal/hepática.' },
    { name:'Atracurio',          dose:'0,5 mg/kg IV',                                        note:'Puede liberar histamina (raro a esta dosis).' },
  ]},
  { cat:'Reversión bloqueo NM', drugs:[
    { name:'Sugammadex (T2)',    dose:'2 mg/kg IV',                                          note:'Bloqueo moderado, TOF 2.' },
    { name:'Sugammadex (PTC 1–2)',dose:'4 mg/kg IV',                                         note:'Bloqueo profundo.' },
    { name:'Sugammadex (reversión inmediata)',dose:'16 mg/kg IV',                            note:'Tras ISR fallida con rocuronio.' },
    { name:'Neostigmina',        dose:'0,04–0,07 mg/kg IV (máx 5 mg)',                       note:'Asociar atropina 0,02 mg/kg o glicopirrolato 0,01 mg/kg.' },
    { name:'Atropina reversión', dose:'0,02 mg/kg IV (mín 0,1 mg)',                          note:'Coadministrar con neostigmina.' },
  ]},
  { cat:'Opiáceos', drugs:[
    { name:'Fentanilo bolo',     dose:'1–3 µg/kg IV',                                        note:'Analgesia intraop. Inducción anestésica: 5–10 µg/kg.' },
    { name:'Fentanilo infusión', dose:'1–5 µg/kg/h',                                         note:'Mantención. Considerar tolerancia con uso prolongado.' },
    { name:'Remifentanilo bolo', dose:'0,5–1 µg/kg IV',                                      note:'Cuidado con tórax rígido si infusión rápida.' },
    { name:'Remifentanilo inf.', dose:'0,05–0,5 µg/kg/min',                                  note:'Despertar rápido sin acumulación.' },
    { name:'Morfina IV',         dose:'0,05–0,1 mg/kg IV',                                   note:'Repetir c/3–4h. Evitar <6 meses sin monitorización continua.' },
    { name:'Morfina infusión',   dose:'10–40 µg/kg/h',                                       note:'PCA: bolo 20 µg/kg lockout 8 min.' },
    { name:'Sufentanilo',        dose:'0,1–0,3 µg/kg IV',                                    note:'Potencia ~10x fentanilo.' },
    { name:'Tramadol',           dose:'1–2 mg/kg IV (máx 100 mg)',                           note:'No usar <1 año (FDA). Cuidado en metabolizadores ultrarrápidos CYP2D6.' },
  ]},
  { cat:'Analgésicos no opioides', drugs:[
    { name:'Paracetamol IV (>2 años)',dose:'15 mg/kg c/6h IV',                               note:'Máx 60 mg/kg/día. Hasta 75 mg/kg/día por <48h.' },
    { name:'Paracetamol IV (1–2 años)',dose:'15 mg/kg c/6h IV',                              note:'Máx 60 mg/kg/día.' },
    { name:'Paracetamol IV (RN/lactante)',dose:'10 mg/kg c/6h IV',                           note:'Máx 30 mg/kg/día prematuros, 40 mg/kg/día término.' },
    { name:'Paracetamol VO',     dose:'15–20 mg/kg c/6h VO',                                 note:'Carga única 30 mg/kg posible. Máx 90 mg/kg/día corto plazo.' },
    { name:'Ketorolaco',         dose:'0,5 mg/kg c/6h IV (máx 30 mg/dosis)',                 note:'≥6 meses. Máx 48–72h.' },
    { name:'Ibuprofeno',         dose:'10 mg/kg c/6h VO',                                    note:'≥6 meses. Máx 40 mg/kg/día.' },
    { name:'Diclofenaco',        dose:'1 mg/kg c/8h IV/VO',                                  note:'≥1 año.' },
    { name:'Dipirona / Metamizol',dose:'15–25 mg/kg c/6h IV/VO',                             note:'Dolor moderado-severo. Vigilar agranulocitosis (raro).' },
  ]},
  { cat:'Antieméticos', drugs:[
    { name:'Ondansetrón',        dose:'0,1–0,15 mg/kg IV (máx 4 mg)',                        note:'Profilaxis NVPO. Vigilar QTc.' },
    { name:'Dexametasona',       dose:'0,1–0,15 mg/kg IV (máx 8 mg)',                        note:'Profilaxis NVPO + edema vía aérea + prolonga analgesia.' },
    { name:'Droperidol',         dose:'10–50 µg/kg IV (máx 1,25 mg)',                        note:'Vigilar QT prolongado.' },
    { name:'Metoclopramida',     dose:'0,1–0,15 mg/kg IV',                                   note:'Riesgo distonía extrapiramidal en niños.' },
  ]},
  { cat:'Anestésicos locales (dosis máxima)', drugs:[
    { name:'Lidocaína sin epi',  dose:'5 mg/kg',                                             note:'Toxicidad sistémica: convulsiones, arritmia.' },
    { name:'Lidocaína con epi',  dose:'7 mg/kg',                                             note:'Vigilar inyección IV inadvertida.' },
    { name:'Bupivacaína sin epi',dose:'2 mg/kg',                                             note:'Cardiotoxicidad severa. Evitar IV.' },
    { name:'Bupivacaína con epi',dose:'2,5 mg/kg',                                           note:'Test de aspiración + dosis test.' },
    { name:'Ropivacaína',        dose:'3 mg/kg',                                             note:'Menos cardiotóxica que bupivacaína.' },
    { name:'Levobupivacaína',    dose:'2,5–3 mg/kg',                                         note:'Isómero S de bupivacaína. Menos cardiotóxica.' },
    { name:'Mepivacaína',        dose:'5–7 mg/kg',                                           note:'Duración intermedia.' },
    { name:'Cloroprocaína',      dose:'7–10 mg/kg',                                          note:'Metabolismo por colinesterasa plasmática.' },
  ]},
  { cat:'Bloqueo caudal / regional', drugs:[
    { name:'Bupivacaína 0,25% caudal', dose:'0,5–1 mL/kg',                                  note:'1 mL/kg cubre hasta T10. Volumen total máx 20 mL.' },
    { name:'Ropivacaína 0,2% caudal',  dose:'0,5–1 mL/kg',                                  note:'Menos bloqueo motor.' },
    { name:'Levobupi 0,25% caudal',    dose:'0,5–1 mL/kg',                                  note:'Equivalente a bupivacaína, menos cardiotóxica.' },
    { name:'Clonidina aditivo caudal', dose:'1–2 µg/kg',                                    note:'Prolonga analgesia 3–5h. Vigilar sedación, hipotensión.' },
    { name:'Morfina caudal',           dose:'30–50 µg/kg',                                  note:'Analgesia prolongada (>12h). Monitorizar por depresión respiratoria.' },
  ]},
  { cat:'Emergencia / RCP', drugs:[
    { name:'Adrenalina (PCR) IV/IO', dose:'10 µg/kg IV/IO c/3–5 min',                       note:'= 0,01 mg/kg. ET: 100 µg/kg.' },
    { name:'Adrenalina (anafilaxia) IM',dose:'10 µg/kg IM (1:1000)',                        note:'Máx 0,5 mg/dosis. Repetir c/5–15 min.' },
    { name:'Atropina bradicardia',dose:'0,02 mg/kg IV (mín 0,1 mg, máx 0,5 mg niño/1 mg adolescente)', note:'Repetir 1 vez si bradicardia persiste.' },
    { name:'Amiodarona (PCR)',   dose:'5 mg/kg IV/IO bolo',                                  note:'Repetir hasta máx 15 mg/kg. TV/FV refractaria.' },
    { name:'Lidocaína (PCR)',    dose:'1 mg/kg IV/IO bolo',                                  note:'Alternativa a amiodarona.' },
    { name:'Lidocaína infusión', dose:'20–50 µg/kg/min',                                     note:'Mantención tras bolo en TV.' },
    { name:'Sulfato Mg (torsade)',dose:'25–50 mg/kg IV (máx 2 g)',                           note:'Torsade de pointes, broncoespasmo refractario, eclampsia.' },
    { name:'Cloruro de calcio 10%',dose:'10–20 mg/kg IV lento',                              note:'HiperK, hipoCa sintomática, sobredosis BCC.' },
    { name:'Gluconato Ca 10%',   dose:'30–60 mg/kg IV lento',                                note:'Equivale a 10–20 mg/kg de calcio elemental.' },
    { name:'Bicarbonato Na 8,4%',dose:'1 mEq/kg IV',                                         note:'Acidosis severa, hiperK, tóxicos (tricíclicos). Diluir en RN.' },
    { name:'Naloxona',           dose:'10 µg/kg IV',                                         note:'Reversión opiáceos. Puede repetir hasta 100 µg/kg.' },
    { name:'Flumazenilo',        dose:'10 µg/kg IV (máx 200 µg/dosis)',                      note:'Reversión benzodiacepinas. Cuidado en convulsiones.' },
    { name:'Glucosa 10%',        dose:'5 mL/kg IV',                                          note:'Hipoglucemia neonatal/lactante (= 0,5 g/kg).' },
    { name:'Glucosa 25%',        dose:'2 mL/kg IV',                                          note:'Hipoglucemia >1 año (= 0,5 g/kg).' },
  ]},
  { cat:'Broncodilatadores / Anafilaxia', drugs:[
    { name:'Salbutamol nebul.',  dose:'0,15 mg/kg/dosis (mín 2,5 mg, máx 5 mg)',             note:'Repetir c/20 min en crisis.' },
    { name:'Salbutamol IV',      dose:'15 µg/kg en 10 min carga · 1–5 µg/kg/min infusión',   note:'Estatus asmático refractario.' },
    { name:'Hidrocortisona',     dose:'4–8 mg/kg IV (máx 250 mg)',                           note:'Shock séptico, anafilaxia, asma.' },
    { name:'Metilprednisolona',  dose:'1–2 mg/kg IV',                                        note:'Asma severa, edema vía aérea.' },
    { name:'Difenhidramina',     dose:'1 mg/kg IV/IM (máx 50 mg)',                           note:'Anafilaxia (2ª línea), reacción extrapiramidal.' },
    { name:'Ranitidina',         dose:'1 mg/kg IV (máx 50 mg)',                              note:'Bloqueo H2 en anafilaxia.' },
  ]},
  { cat:'Antibioticoprofilaxis quirúrgica', drugs:[
    { name:'Cefazolina',         dose:'30 mg/kg IV (máx 2 g)',                               note:'Preincisión 30–60 min. Redosificar c/4h o si sangrado >1500 mL.' },
    { name:'Cefuroxima',         dose:'50 mg/kg IV (máx 1,5 g)',                             note:'Alternativa cefalo 2ª generación.' },
    { name:'Ceftriaxona',        dose:'50–75 mg/kg IV (máx 2 g)',                            note:'Cirugía SNC, abdominal contaminada.' },
    { name:'Vancomicina',        dose:'15 mg/kg IV en 60 min (máx 1 g/dosis)',               note:'Alergia β-lactámicos / MRSA. Infundir lento (síndrome hombre rojo).' },
    { name:'Clindamicina',       dose:'10 mg/kg IV (máx 900 mg)',                            note:'Alergia β-lactámicos, contam. orofaríngea.' },
    { name:'Metronidazol',       dose:'15 mg/kg IV (máx 500 mg)',                            note:'Anaerobios, cirugía colónica.' },
    { name:'Gentamicina',        dose:'2,5 mg/kg IV (máx 120 mg)',                           note:'Gram negativos. Monoterapia o asociada.' },
    { name:'Ampicilina/Sulbactam',dose:'50 mg/kg IV (máx 3 g de ampicilina)',                note:'Cirugía abdominal, ginecológica.' },
  ]},
  { cat:'Fluidos / Hemoderivados', drugs:[
    { name:'Cristaloide bolo',   dose:'10–20 mL/kg IV',                                      note:'SF 0,9% o Ringer Lactato. Hipovolemia, sepsis.' },
    { name:'Mantención basal (4-2-1)', dose:'4 mL/kg/h (primeros 10 kg) · 2 mL/kg/h (10-20 kg) · 1 mL/kg/h (>20 kg)', note:'Holliday-Segar. Ej: 22 kg = 40+20+2 = 62 mL/h.' },
    { name:'Albúmina 5%',        dose:'10–20 mL/kg IV',                                      note:'Hipovolemia refractaria a cristaloides.' },
    { name:'Glóbulos rojos',     dose:'10–15 mL/kg IV',                                      note:'Sube Hb ~2-3 g/dL.' },
    { name:'Plasma fresco congelado',dose:'10–15 mL/kg IV',                                  note:'Coagulopatía con sangrado activo.' },
    { name:'Plaquetas',          dose:'10 mL/kg IV (1 U/10 kg)',                             note:'Sube plaquetas ~30–50 ×10⁹/L.' },
    { name:'Crioprecipitado',    dose:'5 mL/kg IV',                                          note:'Hipofibrinogenemia. Sube fibrinógeno ~70 mg/dL.' },
    { name:'Ácido tranexámico',  dose:'10 mg/kg IV carga · 5 mg/kg/h infusión',              note:'Cirugía con sangrado (escoliosis, craneofacial).' },
  ]},
  { cat:'Otros útiles', drugs:[
    { name:'Furosemida',         dose:'0,5–1 mg/kg IV',                                      note:'Sobrecarga hídrica.' },
    { name:'Manitol 20%',        dose:'0,25–1 g/kg IV en 20 min',                            note:'HIC, edema cerebral.' },
    { name:'Insulina (CAD)',     dose:'0,05–0,1 U/kg/h infusión',                            note:'No bolo en CAD pediátrica. Monitor glucemia c/1h.' },
    { name:'Heparina cirugía CV',dose:'300–400 U/kg IV',                                     note:'Anticoagulación para CEC. ACT objetivo >480s.' },
    { name:'Protamina',          dose:'1 mg por cada 100 U de heparina',                     note:'Reversión heparina. Administrar lento (riesgo hipotensión).' },
    { name:'Lipid Rescue 20%',   dose:'1,5 mL/kg bolo · 0,25 mL/kg/min infusión',            note:'Toxicidad por anestésicos locales (LAST).' },
  ]},
];

function renderPediatria(){
  const q = (document.getElementById('pedSearch')?.value||'').toLowerCase().trim();
  const w = parseFloat(document.getElementById('pedWeight')?.value||'');
  const validW = !isNaN(w) && w>0;
  const container = document.getElementById('pedList');
  let html = '';
  PEDIATRIA_DATA.forEach(sec=>{
    const drugs = sec.drugs.filter(d=>!q || d.name.toLowerCase().includes(q) || d.dose.toLowerCase().includes(q) || (d.note||'').toLowerCase().includes(q));
    if(drugs.length===0) return;
    html += `<div class="med-section"><h4>${sec.cat}</h4><div class="med-table-wrap"><table class="med-table"><thead><tr><th>Fármaco</th><th>Dosis</th>${validW?'<th>Para '+w+' kg</th>':''}<th>Notas</th></tr></thead><tbody>`;
    drugs.forEach(d=>{
      html += `<tr><td class="drug">${d.name}</td><td class="dose">${d.dose}</td>${validW?'<td class="dose">'+calcPedDose(d.dose,w)+'</td>':''}<td class="note">${d.note||''}</td></tr>`;
    });
    html += '</tbody></table></div></div>';
  });
  if(!html) html = '<div class="empty"><span class="big">🔍</span>Sin resultados para "'+q+'"</div>';
  container.innerHTML = html;
}

function calcPedDose(doseStr, weight){
  // Extrae rangos "X–Y unidad/kg[/tiempo]" y singletons "X unidad/kg[/tiempo]"
  // y calcula para el peso. Soporta /min, /h, /hr, /hora, /d, /día como sufijo.
  const results = [];
  const occupied = []; // posiciones ya consumidas por rangos
  const seen = new Set();
  const unitRe = '(mg|µg|mcg|U|mL|mEq|g)\\/kg(\\/(?:min|h|hr|hora|d|día))?';

  const rangeRe = new RegExp('(\\d+(?:[.,]\\d+)?)\\s*[–\\-a]\\s*(\\d+(?:[.,]\\d+)?)\\s*' + unitRe, 'gi');
  let m;
  while((m = rangeRe.exec(doseStr)) !== null){
    const lo = parseFloat(m[1].replace(',','.')) * weight;
    const hi = parseFloat(m[2].replace(',','.')) * weight;
    const unit = m[3];
    const tSuf = m[4] || '';
    const key = m.index + '|' + m[0];
    if(seen.has(key)) continue;
    seen.add(key);
    occupied.push([m.index, m.index + m[0].length]);
    results.push(`${fmt(lo)}–${fmt(hi)} ${unit}${tSuf}`);
  }

  const singleRe = new RegExp('(\\d+(?:[.,]\\d+)?)\\s*' + unitRe, 'gi');
  while((m = singleRe.exec(doseStr)) !== null){
    const start = m.index;
    const end = m.index + m[0].length;
    let overlaps = false;
    for(const seg of occupied){
      if(start < seg[1] && end > seg[0]){ overlaps = true; break; }
    }
    if(overlaps) continue;
    const v = parseFloat(m[1].replace(',','.')) * weight;
    const unit = m[2];
    const tSuf = m[3] || '';
    const key = start + '|' + m[0];
    if(seen.has(key)) continue;
    seen.add(key);
    results.push(`${fmt(v)} ${unit}${tSuf}`);
  }

  return results.length ? results.join(' · ') : '—';
}
function fmt(n){
  if(n>=10) return Math.round(n).toString();
  if(n>=1) return n.toFixed(1).replace(/\.0$/,'');
  return n.toFixed(2).replace(/0$/,'').replace(/\.$/,'');
}

// ============================================================
// COAGULACIÓN — Tiempos ASRA
// ============================================================
const COAGULACION_DATA = [
  { cat:'Heparinas (HNF / HBPM)', drugs:[
    { name:'HNF subcutánea profiláctica (≤5000 U c/8–12 h)',
      pre:'No requiere espera si dosis ≤5000 U BID. Si TID o ≥7500 U total/día: 4–6 h y TTPA normal.',
      post:'1 h después del procedimiento. Catéter: retirar a la hora valle (≥4–6 h tras última dosis).',
      cat_full:'ASRA 2018 / ESAIC 2022 / SACH — HNF dosis bajas SC' },
    { name:'HNF subcutánea alta dosis (>10 000 U/día)',
      pre:'12 h y TTPA normal o anti-Xa indetectable.',
      post:'1 h después. Retirar catéter 4–6 h tras última dosis.',
      cat_full:'ASRA 2018 — riesgo equivalente a HBPM terapéutica' },
    { name:'HNF intravenosa terapéutica',
      pre:'4–6 h y TTPA <1,5× control (o anti-Xa normal).',
      post:'1 h después del bloqueo o de la retirada del catéter. Reiniciar infusión IV ≥1 h después.',
      cat_full:'ASRA 2018 / ESAIC 2022 — bolo + infusión continua' },
    { name:'HBPM profiláctica (enoxaparina 40 mg/día, dalteparina 5000 U, tinzaparina 4500 U, nadroparina 2850 U)',
      pre:'12 h tras última dosis.',
      post:'4 h post-bloqueo o tras retirar catéter (algunos centros 6–8 h si trauma). No combinar catéter + dosis profiláctica en el mismo intervalo de 12 h.',
      cat_full:'ASRA 2018 / ESAIC 2022 / SACH 2017' },
    { name:'HBPM terapéutica (enoxaparina 1 mg/kg c/12 h o 1,5 mg/kg/día; dalteparina 120 U/kg c/12 h o 200 U/kg/día; tinzaparina 175 U/kg/día)',
      pre:'24 h tras última dosis.',
      post:'24 h después del bloqueo. Evitar catéter epidural permanente. Si se mantiene catéter, usar solo dosis profilácticas y retirar ≥24 h tras última terapéutica.',
      cat_full:'ASRA 2018 / ESAIC 2022 — dosis terapéutica' },
    { name:'HBPM en insuficiencia renal (CrCl <30 mL/min)',
      pre:'Profiláctica: ≥24 h. Terapéutica: ≥48 h. Considerar medir anti-Xa si disponible.',
      post:'Igual que dosis estándar, considerar prolongar 24 h.',
      cat_full:'ESAIC 2022 — riesgo de acumulación' },
  ]},
  { cat:'Anticoagulantes orales directos (DOAC / NOAC)', drugs:[
    { name:'Dabigatrán (Pradaxa) — anti-IIa directo',
      pre:'CrCl ≥80: 72 h · CrCl 50–79: 96 h · CrCl 30–49: 120 h · CrCl <30: evitar bloqueo neuroaxial (≥120 h y considerar idarucizumab).',
      post:'≥24 h después (mejor 48–72 h si alto riesgo). Catéter: retirar ≥34 h tras última dosis y reiniciar ≥6 h después de la retirada.',
      cat_full:'ASRA 2018 / ESAIC 2022 — reversor: idarucizumab (Praxbind)' },
    { name:'Rivaroxabán (Xarelto) — anti-Xa directo',
      pre:'72 h (3 días). Si CrCl <30 o medición anti-Xa disponible: extender o esperar nivel <30 ng/mL.',
      post:'6 h después de bloqueo single-shot o tras retirar catéter. Reanudar a ≥24 h si hubo sangrado.',
      cat_full:'ASRA 2018 / ESAIC 2022 / SACH — reversor: andexanet alfa (no disponible en Chile)' },
    { name:'Apixabán (Eliquis) — anti-Xa directo',
      pre:'72 h (3 días). En CrCl <30 o sangrado: prolongar y/o medir anti-Xa.',
      post:'6 h después. Catéter: retirar y reanudar dosis 6 h post-retirada.',
      cat_full:'ASRA 2018 / ESAIC 2022' },
    { name:'Edoxabán (Lixiana / Savaysa) — anti-Xa directo',
      pre:'72 h.',
      post:'6 h después.',
      cat_full:'ESAIC 2022 — anti-Xa oral' },
    { name:'Antagonistas de vitamina K (warfarina, acenocumarol)',
      pre:'4–5 días e INR ≤1,4 documentado antes del bloqueo (algunas guías 1,5).',
      post:'Reiniciar el mismo día (≥24 h post). Catéter: retirar con INR ≤1,5 y dentro de las primeras 48 h del inicio (antes de alcanzar rango).',
      cat_full:'ASRA 2018 / ESAIC 2022 — puente con HBPM según riesgo' },
  ]},
  { cat:'Antiagregantes plaquetarios', drugs:[
    { name:'AAS / Aspirina (monoterapia)',
      pre:'Sin suspensión — continuar.',
      post:'Sin restricción.',
      cat_full:'ASRA 2018 / ESAIC 2022 — inhibidor COX-1 irreversible' },
    { name:'AINEs (ibuprofeno, naproxeno, ketorolaco, etc.)',
      pre:'Sin suspensión para neuroaxial monoterápico.',
      post:'Sin restricción.',
      cat_full:'ASRA 2018 — inhibidores COX reversibles' },
    { name:'Clopidogrel (Plavix) — P2Y12 irreversible',
      pre:'5–7 días (mejor 7 días). Considerar test plaquetario si urgencia.',
      post:'Mantención: 24 h post. Dosis de carga (300–600 mg) sólo DESPUÉS de retirar el catéter.',
      cat_full:'ASRA 2018 / ESAIC 2022 / SACH' },
    { name:'Prasugrel (Effient) — P2Y12 potente',
      pre:'7–10 días.',
      post:'24 h después. Evitar catéter epidural permanente.',
      cat_full:'ASRA 2018 — mayor potencia que clopidogrel' },
    { name:'Ticagrelor (Brilinta / Brilique) — P2Y12 reversible',
      pre:'5–7 días (vida media 8 h, pero metabolito activo persiste).',
      post:'24 h después. Evitar catéter epidural permanente.',
      cat_full:'ASRA 2018 / ESAIC 2022' },
    { name:'Ticlopidina',
      pre:'10 días.',
      post:'24 h después.',
      cat_full:'ASRA 2018 — tienopiridina antigua' },
    { name:'Cilostazol (Pletal) — inhibidor PDE3',
      pre:'2 días.',
      post:'6 h después.',
      cat_full:'ASRA 2018' },
    { name:'Dipiridamol',
      pre:'2 días (forma extendida ER). Forma corta: 24 h.',
      post:'6 h después.',
      cat_full:'ASRA 2018 — combinado con AAS en Aggrenox' },
    { name:'Abciximab (ReoPro) — anti GPIIb/IIIa',
      pre:'24–48 h y recuento plaquetario normal.',
      post:'Postergar bloqueo. Catéter: contraindicado.',
      cat_full:'ASRA 2018 — vida media plaquetaria ~12 h, función ~48 h' },
    { name:'Eptifibatide / Tirofibán — anti GPIIb/IIIa',
      pre:'4–8 h y función plaquetaria recuperada.',
      post:'Postergar bloqueo.',
      cat_full:'ASRA 2018 — vida media corta' },
  ]},
  { cat:'Fondaparinux / Trombolíticos / Otros', drugs:[
    { name:'Fondaparinux profiláctico (2,5 mg/día) — anti-Xa indirecto',
      pre:'36–42 h (algunas guías: 4 vidas medias = 72 h en CrCl normal).',
      post:'6–12 h después. Evitar catéter (preferir técnica single-shot atraumática, una sola punción).',
      cat_full:'ASRA 2018 / ESAIC 2022 — pentasacárido' },
    { name:'Fondaparinux terapéutico (5 / 7,5 / 10 mg)',
      pre:'CONTRAINDICADO bloqueo neuroaxial salvo emergencia (sin alternativa).',
      post:'—',
      cat_full:'ASRA 2018 — sin reversor disponible' },
    { name:'Argatrobán — anti-IIa directo IV',
      pre:'4 h y TTPA normal.',
      post:'2 h después.',
      cat_full:'ASRA 2018 — usado en HIT' },
    { name:'Bivalirudina — anti-IIa directo IV',
      pre:'10 h y TTPA normal (ESAIC: 8–10 h).',
      post:'6 h después.',
      cat_full:'ASRA 2018 / ESAIC 2022 — usado en cardiología intervencional' },
    { name:'Trombolíticos (alteplasa, tenecteplasa, urokinasa, estreptocinasa)',
      pre:'CONTRAINDICADO bloqueo neuroaxial dentro de 10 días (idealmente 14 días).',
      post:'NO retirar catéter por 10 días. Monitorizar fibrinógeno (>100–150 mg/dL). Vigilancia neurológica estricta.',
      cat_full:'ASRA 2018 — riesgo extremo de hematoma' },
  ]},
  { cat:'Herbáceos y suplementos', drugs:[
    { name:'Ajo (Allium sativum), Ginkgo biloba, Ginseng (las "3 G")',
      pre:'Sin restricción específica para neuroaxial monoterápico.',
      post:'Sin restricción.',
      cat_full:'ASRA 2018 / SACH — considerar suspender 7 días si cirugía mayor o terapia combinada' },
    { name:'Aceite de pescado / Omega-3',
      pre:'Sin restricción.',
      post:'Sin restricción.',
      cat_full:'ASRA 2018 — efecto plaquetario mínimo' },
    { name:'Vitamina E (>400 UI/día)',
      pre:'Considerar suspender 7 días si combinado con antiagregantes/anticoagulantes.',
      post:'Sin restricción.',
      cat_full:'Consenso — efecto antiplaquetario leve' },
  ]},
  { cat:'Bloqueo del nervio periférico / planos fasciales', drugs:[
    { name:'Bloqueo de plano superficial / compresible (TAP, PECS, ESP, RA)',
      pre:'En general, mismas pausas que neuroaxial NO son obligatorias — riesgo/beneficio individual; AAS puede continuarse.',
      post:'Vigilar sangrado local.',
      cat_full:'ESAIC 2022 / ASRA 2018 — bloqueos de bajo riesgo' },
    { name:'Bloqueo profundo / no compresible (paravertebral, lumbar plexo, ciático profundo, gasserian)',
      pre:'Aplicar mismas pausas que neuroaxial.',
      post:'Igual a neuroaxial.',
      cat_full:'ASRA 2018 — mismo manejo que neuroaxial' },
  ]},
];

// ============================================================
// CALCULADORA PEDIÁTRICA — vía aérea, accesos, fluidos, drogas
// ============================================================
function onPedInputs(){
  renderPediatria();        // refresca farmacopea (necesita peso)
  renderPediatricaCalc();   // refresca cálculos
}

function _pedInputs(){
  const w = parseFloat(document.getElementById('pedWeight')?.value||'');
  const ay = parseInt(document.getElementById('pedAgeY')?.value||'0',10)||0;
  const am = parseInt(document.getElementById('pedAgeM')?.value||'0',10)||0;
  const ageMonths = ay*12 + am;
  const ageYears = ageMonths / 12;
  return { w, ay, am, ageMonths, ageYears, hasW: !isNaN(w) && w>0, hasA: ageMonths>0 };
}

// Helper de redondeo
function _r(n, d){
  if(n==null || isNaN(n)) return '—';
  const f = Math.pow(10, d||1);
  return (Math.round(n*f)/f).toString().replace('.', ',');
}
// Rango "a–b unidad"
function _range(a, b, unit, dec){
  if(a==null || b==null) return '—';
  if(a===b) return _r(a, dec) + ' ' + (unit||'');
  return _r(a, dec) + '–' + _r(b, dec) + ' ' + (unit||'');
}

function _row(label, value, formula, sub){
  let valHTML;
  if(value==null || value==='' || value==='—'){
    valHTML = '<div class="calc-val muted">Faltan datos</div>';
  } else {
    valHTML = '<div class="calc-val">'+value+'</div>';
  }
  const subHTML = sub ? '<div class="calc-sub">'+sub+'</div>' : '';
  const fxHTML  = formula ? '<details class="calc-fx"><summary>fórmula</summary><div>'+formula+'</div></details>' : '';
  return '<div class="calc-row">'
    + '<div><div class="calc-label">'+label+'</div>'+subHTML+'</div>'
    + valHTML
    + fxHTML
    + '</div>';
}

// =========== VÍA AÉREA ===========
function calcAirway(p){
  const out = [];
  const ay = p.ageYears;

  // TOT con cuff (Khine/APA)
  let totC = null;
  if(p.hasA){
    if(ay < 1) totC = 3.0;
    else if(ay < 2) totC = 3.5;
    else totC = ay/4 + 3.5;
  }
  out.push(_row(
    'TOT con cuff (Microcuff)',
    totC!=null ? _r(totC,1)+' mm DI' : null,
    'Edad &lt; 1 a: 3,0 · 1–2 a: 3,5 · ≥ 2 a: edad/4 + 3,5'
  ));

  // TOT sin cuff (Cole)
  let totU = null;
  if(p.hasA){
    if(ay < 1) totU = 3.5;
    else if(ay < 2) totU = 4.0;
    else totU = ay/4 + 4;
  }
  out.push(_row(
    'TOT sin cuff',
    totU!=null ? _r(totU,1)+' mm DI' : null,
    'Edad &lt; 1 a: 3,5 · 1–2 a: 4,0 · ≥ 2 a: edad/4 + 4 (Cole)'
  ));

  // Profundidad TOT oral (usando TOT con cuff como referencia)
  let depthO = null, depthOAlt = null;
  if(totC){ depthOAlt = totC*3; }
  if(p.hasA && ay>=2){ depthO = ay/2 + 12; }
  let depthOStr = null;
  if(depthO!=null) depthOStr = _r(depthO,1)+' cm';
  else if(depthOAlt!=null) depthOStr = _r(depthOAlt,1)+' cm';
  out.push(_row(
    'Profundidad TOT oral',
    depthOStr,
    '≥ 2 a: edad/2 + 12 cm · Alternativa: DI TOT × 3 (en cm desde labio)'
  ));

  // Profundidad TOT nasal
  let depthN = null, depthNAlt = null;
  if(totC){ depthNAlt = totC*3 + 2; }
  if(p.hasA && ay>=2){ depthN = ay/2 + 15; }
  let depthNStr = null;
  if(depthN!=null) depthNStr = _r(depthN,1)+' cm';
  else if(depthNAlt!=null) depthNStr = _r(depthNAlt,1)+' cm';
  out.push(_row(
    'Profundidad TOT nasal',
    depthNStr,
    '≥ 2 a: edad/2 + 15 cm · Alternativa: DI TOT × 3 + 2 cm',
    'El diámetro del tubo nasotraqueal suele ser igual al oral'
  ));

  // Máscara laríngea por peso
  let ml = null;
  if(p.hasW){
    const w = p.w;
    if(w<5) ml = '1';
    else if(w<10) ml = '1,5';
    else if(w<20) ml = '2';
    else if(w<30) ml = '2,5';
    else if(w<50) ml = '3';
    else if(w<70) ml = '4';
    else ml = '5';
  }
  out.push(_row(
    'Mascarilla laríngea (tamaño)',
    ml,
    '&lt;5 kg: 1 · 5–10: 1,5 · 10–20: 2 · 20–30: 2,5 · 30–50: 3 · 50–70: 4 · &gt;70: 5'
  ));

  // Hoja de laringoscopio por edad
  let blade = null;
  if(p.hasA){
    if(ay < 0.08) blade = 'Miller 0';            // <1 mes
    else if(ay < 1) blade = 'Miller 1';
    else if(ay < 2) blade = 'Miller 1 · Macintosh 2';
    else if(ay < 8) blade = 'Macintosh 2';
    else if(ay < 12) blade = 'Macintosh 2–3';
    else blade = 'Macintosh 3';
  }
  out.push(_row(
    'Hoja de laringoscopio',
    blade,
    'RN: Miller 0 · &lt;1 a: Miller 1 · 1–2 a: Miller 1 o Mac 2 · 2–8 a: Mac 2 · 8–12 a: Mac 2–3 · &gt;12 a: Mac 3'
  ));

  // Cánula Guedel
  let guedel = null;
  if(p.hasA){
    if(ay < 0.08) guedel = '000';
    else if(ay < 1) guedel = '00 – 0';
    else if(ay < 3) guedel = '0 – 1';
    else if(ay < 6) guedel = '1 – 2';
    else if(ay < 12) guedel = '2 – 3';
    else guedel = '3 – 4';
  }
  out.push(_row(
    'Cánula orofaríngea (Guedel)',
    guedel,
    'RN: 000 · &lt;1 a: 00–0 · 1–3 a: 0–1 · 3–6 a: 1–2 · 6–12 a: 2–3 · &gt;12 a: 3–4',
    'Medir comisura labial → ángulo mandíbula'
  ));

  // Sonda de aspiración: 2 × DI TOT
  let suction = null;
  if(totC){ suction = Math.round(totC*2)+' Fr'; }
  out.push(_row(
    'Sonda de aspiración endotraqueal',
    suction,
    'Fr ≈ DI TOT × 2'
  ));

  return out.join('');
}

// =========== ACCESOS VASCULARES ===========
function calcAccess(p){
  const out = [];
  // CVC tamaño
  let cvcSize = null;
  if(p.hasW){
    const w = p.w;
    if(w < 3) cvcSize = '3 Fr';
    else if(w <= 10) cvcSize = '4 Fr';
    else if(w <= 30) cvcSize = '5 Fr';
    else if(w <= 50) cvcSize = '5–7 Fr';
    else cvcSize = '7 Fr';
  }
  out.push(_row(
    'CVC — tamaño',
    cvcSize,
    '&lt;3 kg: 3 Fr · 3–10 kg: 4 Fr · 10–30 kg: 5 Fr · 30–50 kg: 5–7 Fr · &gt;50 kg: 7 Fr',
    'Doble o triple lumen según necesidad'
  ));

  // CVC profundidad yugular interna derecha (Andropoulos)
  let cvcYug = null;
  if(p.hasW){
    const w = p.w;
    let v;
    if(w < 15) v = w*0.07 + 4.5;     // aprox Andropoulos pediátrico bajo peso
    else v = w*0.05 + 5.5;
    cvcYug = _r(v,1)+' cm';
  }
  out.push(_row(
    'CVC yugular interna derecha — profundidad',
    cvcYug,
    '&lt;15 kg: peso × 0,07 + 4,5 · ≥15 kg: peso × 0,05 + 5,5 (Andropoulos)',
    'Confirmar con ECG / Rx'
  ));

  // CVC subclavia derecha
  let cvcSub = null;
  if(p.hasW){
    cvcSub = _r(p.w*0.06 + 5.5, 1)+' cm';
  }
  out.push(_row(
    'CVC subclavia derecha — profundidad',
    cvcSub,
    'Aprox: peso × 0,06 + 5,5'
  ));

  // CVC femoral
  let cvcFem = null;
  if(p.hasW){
    const w = p.w;
    cvcFem = (w<20 ? _r(w*0.5 + 5,1) : _r(w*0.3 + 9,1)) + ' cm';
  }
  out.push(_row(
    'CVC femoral — profundidad',
    cvcFem,
    '&lt;20 kg: peso × 0,5 + 5 · ≥20 kg: peso × 0,3 + 9',
    'Ajustar por talla y guiar con eco'
  ));

  // Catéter arterial radial
  let art = null;
  if(p.hasW){
    const w = p.w;
    if(w < 5) art = '24 G';
    else if(w < 15) art = '24 G';
    else if(w < 30) art = '22 G';
    else art = '20 G';
  }
  out.push(_row(
    'Catéter arterial radial',
    art,
    '&lt;5 kg: 24 G · 5–15 kg: 24 G · 15–30 kg: 22 G · &gt;30 kg: 20 G'
  ));

  // Aguja intraósea
  let io = null;
  if(p.hasW){
    const w = p.w;
    if(w < 3) io = '18 G';
    else if(w < 39) io = '15 mm (rosa)';
    else io = '25 mm (azul)';
  }
  out.push(_row(
    'Aguja intraósea (EZ-IO)',
    io,
    '&lt;3 kg: 18 G manual · 3–39 kg: 15 mm rosa · ≥39 kg: 25 mm azul',
    'Tibia proximal de elección'
  ));

  // Sonda Foley
  let foley = null;
  if(p.hasA){
    const ay = p.ageYears;
    if(ay < 1) foley = '6 Fr';
    else if(ay < 3) foley = '6–8 Fr';
    else if(ay < 8) foley = '8–10 Fr';
    else if(ay < 12) foley = '10–12 Fr';
    else foley = '12–14 Fr';
  }
  out.push(_row(
    'Sonda Foley',
    foley,
    '&lt;1 a: 6 Fr · 1–3 a: 6–8 Fr · 3–8 a: 8–10 Fr · 8–12 a: 10–12 Fr · &gt;12 a: 12–14 Fr'
  ));

  // SNG
  let sng = null;
  if(p.hasA){
    const ay = p.ageYears;
    if(ay < 1) sng = '6–8 Fr';
    else if(ay < 3) sng = '8 Fr';
    else if(ay < 8) sng = '10 Fr';
    else if(ay < 12) sng = '12 Fr';
    else sng = '14–16 Fr';
  }
  out.push(_row(
    'Sonda nasogástrica',
    sng,
    '&lt;1 a: 6–8 Fr · 1–3 a: 8 Fr · 3–8 a: 10 Fr · 8–12 a: 12 Fr · &gt;12 a: 14–16 Fr'
  ));

  return out.join('');
}

// =========== FLUIDOS ===========
function calcFluids(p){
  const out = [];
  // Mantención Holliday-Segar
  let maint = null;
  if(p.hasW){
    const w = p.w;
    let ml;
    if(w <= 10) ml = w*4;
    else if(w <= 20) ml = 40 + (w-10)*2;
    else ml = 60 + (w-20)*1;
    maint = _r(ml,0)+' mL/h';
  }
  out.push(_row(
    'Mantención (Holliday-Segar)',
    maint,
    '4-2-1: primeros 10 kg × 4 mL/kg/h · 10–20 kg + 2 · &gt;20 kg + 1'
  ));

  // Bolo cristaloide
  let bolo = null, boloMax = null;
  if(p.hasW){
    bolo = _range(p.w*10, p.w*20, 'mL', 0);
  }
  out.push(_row(
    'Bolo cristaloide',
    bolo,
    '10–20 mL/kg (repetir según respuesta clínica)'
  ));

  // Glóbulos rojos
  let gr = null;
  if(p.hasW) gr = _range(p.w*10, p.w*15, 'mL', 0);
  out.push(_row(
    'Concentrado de glóbulos rojos',
    gr,
    '10–15 mL/kg eleva Hb ~ 2–3 g/dL'
  ));

  // Plasma fresco
  let pfc = null;
  if(p.hasW) pfc = _range(p.w*10, p.w*15, 'mL', 0);
  out.push(_row(
    'Plasma fresco congelado',
    pfc,
    '10–15 mL/kg'
  ));

  // Plaquetas
  let plt = null;
  if(p.hasW) plt = _r(p.w*10,0)+' mL';
  out.push(_row(
    'Plaquetas',
    plt,
    '10 mL/kg · eleva ~ 50.000/µL'
  ));

  // Crioprecipitado
  let crio = null;
  if(p.hasW) crio = _r(p.w/5,1)+' U';
  out.push(_row(
    'Crioprecipitado',
    crio,
    '1 U / 5 kg · eleva fibrinógeno ~ 50 mg/dL'
  ));

  // Pérdida sanguínea aceptable (estimación)
  let pms = null;
  if(p.hasW){
    // Volemia ~ 70-80 mL/kg, pérdida aceptable ~ 15-20% de volemia (orientativo)
    const vol = p.w*75;
    pms = _r(vol*0.15, 0)+'–'+_r(vol*0.20, 0)+' mL';
  }
  out.push(_row(
    'Pérdida sanguínea aceptable (15–20%)',
    pms,
    'Volemia ≈ 75 mL/kg · pérdida tolerada 15–20% (ajustar Hb basal)'
  ));

  return out.join('');
}

// =========== DROGAS — INDUCCIÓN ===========
function calcDrugsInd(p){
  const out = [];
  if(!p.hasW){
    return '<div class="calc-empty">Ingresá el peso para calcular dosis</div>';
  }
  const w = p.w;
  const D = [
    ['Propofol IV',          w*2,     w*3,    'mg',  '2–3 mg/kg IV',           1],
    ['Tiopental IV',         w*4,     w*6,    'mg',  '4–6 mg/kg IV',           0],
    ['Ketamina IV',          w*1,     w*2,    'mg',  '1–2 mg/kg IV',           1],
    ['Ketamina IM',          w*4,     w*6,    'mg',  '4–6 mg/kg IM',           0],
    ['Midazolam IV',         w*0.05,  w*0.1,  'mg',  '0,05–0,1 mg/kg IV',      2],
    ['Midazolam intranasal', w*0.2,   w*0.3,  'mg',  '0,2–0,3 mg/kg IN',       1],
    ['Fentanilo IV',         w*1,     w*3,    'µg',  '1–3 µg/kg IV',           0],
    ['Remifentanilo bolo',   w*0.5,   w*1,    'µg',  '0,5–1 µg/kg IV',         1],
    ['Sufentanilo',          w*0.1,   w*0.5,  'µg',  '0,1–0,5 µg/kg IV',       2],
    ['Rocuronio IV (rsi)',   w*0.6,   w*1.2,  'mg',  '0,6–1,2 mg/kg IV',       1],
    ['Vecuronio IV',         w*0.08,  w*0.1,  'mg',  '0,08–0,1 mg/kg IV',      2],
    ['Cisatracurio IV',      w*0.1,   w*0.2,  'mg',  '0,1–0,2 mg/kg IV',       2],
    ['Succinilcolina IV',    w*1,     w*2,    'mg',  '1–2 mg/kg IV (lact: 2)', 1],
    ['Succinilcolina IM',    w*3,     w*4,    'mg',  '3–4 mg/kg IM',           0],
    ['Atropina IV',          Math.max(w*0.01, 0.1), Math.max(w*0.02, 0.1), 'mg', '0,01–0,02 mg/kg IV (mín 0,1 mg)', 2],
    ['Glicopirrolato IV',    w*0.005, w*0.01, 'mg',  '5–10 µg/kg IV',          3],
    ['Lidocaína IV',         w*1,     w*1.5,  'mg',  '1–1,5 mg/kg IV',         1],
    ['Dexmedetomidina IV bolo', w*0.5, w*1,  'µg',  '0,5–1 µg/kg en 10 min',  1],
    ['Ondansetrón IV',       w*0.1,   w*0.15, 'mg',  '0,1–0,15 mg/kg (máx 4)', 2],
    ['Dexametasona IV',      w*0.15,  w*0.5,  'mg',  '0,15–0,5 mg/kg (máx 8–16)', 2]
  ];
  D.forEach(d=>{
    out.push(_row(d[0], _range(d[1], d[2], d[3], d[5]), d[4]));
  });
  return out.join('');
}

// =========== DROGAS — RCP / EMERGENCIAS ===========
function calcDrugsRCP(p){
  const out = [];
  if(!p.hasW){
    return '<div class="calc-empty">Ingresá el peso para calcular dosis</div>';
  }
  const w = p.w;
  // Adrenalina paro IV/IO
  out.push(_row(
    'Adrenalina (paro) IV/IO',
    _r(Math.min(w*0.01, 1), 2)+' mg · '+_r(Math.min(w*0.1, 10), 1)+' mL (1:10.000)',
    '0,01 mg/kg = 10 µg/kg · máx 1 mg · 0,1 mL/kg de 1:10.000',
    'Repetir cada 3–5 min'
  ));
  // Adrenalina anafilaxia IM
  out.push(_row(
    'Adrenalina (anafilaxia) IM',
    _r(Math.min(w*0.01, 0.5), 2)+' mg (1:1.000)',
    '0,01 mg/kg IM · máx 0,3 mg niño / 0,5 mg adolescente'
  ));
  // Amiodarona
  out.push(_row(
    'Amiodarona (FV/TV sin pulso)',
    _r(w*5, 0)+' mg (máx '+_r(Math.min(w*5,300),0)+')',
    '5 mg/kg IV/IO bolo · puede repetirse hasta 15 mg/kg/día'
  ));
  // Lidocaína RCP
  out.push(_row(
    'Lidocaína (FV/TV sin pulso)',
    _r(w*1, 1)+' mg',
    '1 mg/kg IV/IO (alternativa a amiodarona)'
  ));
  // Adenosina
  out.push(_row(
    'Adenosina (TPSV) — 1ª dosis',
    _r(Math.min(w*0.1, 6),1)+' mg',
    '0,1 mg/kg IV bolo rápido · máx 6 mg'
  ));
  out.push(_row(
    'Adenosina — 2ª dosis',
    _r(Math.min(w*0.2, 12),1)+' mg',
    '0,2 mg/kg IV bolo · máx 12 mg'
  ));
  // Bicarbonato
  out.push(_row(
    'Bicarbonato de sodio 8,4 %',
    _r(w*1,1)+' mEq · '+_r(w*1,1)+' mL',
    '1 mEq/kg (= 1 mL/kg de NaHCO₃ 8,4%)',
    'Solo en paros prolongados o acidosis severa'
  ));
  // Calcio gluconato
  out.push(_row(
    'Calcio gluconato 10 %',
    _r(w*60,0)+'–'+_r(w*100,0)+' mg · '+_r(w*0.6,1)+'–'+_r(w*1,1)+' mL',
    '60–100 mg/kg = 0,6–1 mL/kg de gluconato 10%'
  ));
  // Calcio cloruro
  out.push(_row(
    'Calcio cloruro 10 %',
    _r(w*10,0)+'–'+_r(w*20,0)+' mg · '+_r(w*0.1,2)+'–'+_r(w*0.2,2)+' mL',
    '10–20 mg/kg = 0,1–0,2 mL/kg de cloruro 10%'
  ));
  // Naloxona
  out.push(_row(
    'Naloxona',
    _r(Math.min(w*0.01,0.4),2)+'–'+_r(Math.min(w*0.1,2),2)+' mg',
    '0,01–0,1 mg/kg IV/IM/SC · titular según respuesta'
  ));
  // Flumazenilo
  out.push(_row(
    'Flumazenilo',
    _r(Math.min(w*0.01,0.2),2)+' mg',
    '0,01 mg/kg IV (máx 0,2 mg/dosis)'
  ));
  // Glucosa
  out.push(_row(
    'Glucosa al 10% (hipoglucemia)',
    _r(w*5,0)+'–'+_r(w*10,0)+' mL',
    '0,5–1 g/kg = 5–10 mL/kg de glucosa al 10%'
  ));
  // Sulfato Magnesio
  out.push(_row(
    'Sulfato de magnesio',
    _r(w*25,0)+'–'+_r(w*50,0)+' mg',
    '25–50 mg/kg IV en 10–20 min (Torsades, broncoespasmo refractario)'
  ));
  // Hidrocortisona
  out.push(_row(
    'Hidrocortisona (anafilaxia / shock)',
    _r(w*2,0)+'–'+_r(w*4,0)+' mg',
    '2–4 mg/kg IV (máx 100 mg)'
  ));
  // Cardioversión / Desfibrilación
  out.push(_row(
    'Desfibrilación (FV/TV sin pulso)',
    _r(w*2,0)+' J → '+_r(w*4,0)+' J',
    '2 J/kg primera descarga · 4 J/kg siguientes (hasta 10 J/kg o adulto)'
  ));
  out.push(_row(
    'Cardioversión sincronizada',
    _r(w*0.5,1)+'–'+_r(w*1,1)+' J · luego '+_r(w*2,0)+' J',
    '0,5–1 J/kg primero · escalada a 2 J/kg'
  ));
  return out.join('');
}

function renderPediatricaCalc(){
  const p = _pedInputs();
  const a = document.getElementById('calcAirway');
  const ac = document.getElementById('calcAccess');
  const f = document.getElementById('calcFluids');
  const di = document.getElementById('calcDrugsInd');
  const dr = document.getElementById('calcDrugsRCP');
  if(a)  a.innerHTML  = calcAirway(p);
  if(ac) ac.innerHTML = calcAccess(p);
  if(f)  f.innerHTML  = calcFluids(p);
  if(di) di.innerHTML = calcDrugsInd(p);
  if(dr) dr.innerHTML = calcDrugsRCP(p);
}

function renderCoagulacion(){
  const q = (document.getElementById('coagSearch')?.value||'').toLowerCase().trim();
  const container = document.getElementById('coagList');
  let html = '';
  COAGULACION_DATA.forEach(sec=>{
    const drugs = sec.drugs.filter(d=>!q || d.name.toLowerCase().includes(q) || d.pre.toLowerCase().includes(q) || d.post.toLowerCase().includes(q) || (d.cat_full||'').toLowerCase().includes(q));
    if(drugs.length===0) return;
    html += `<div class="med-section"><h4>${sec.cat}</h4><div class="med-table-wrap"><table class="med-table"><thead><tr><th>Fármaco</th><th>Suspender ANTES</th><th>Reiniciar DESPUÉS</th></tr></thead><tbody>`;
    drugs.forEach(d=>{
      html += `<tr><td class="drug">${d.name}<div class="note">${d.cat_full||''}</div></td><td class="dose">${d.pre}</td><td class="dose">${d.post}</td></tr>`;
    });
    html += '</tbody></table></div></div>';
  });
  html += `<div class="med-bibliography" style="margin-top:14px">
    <b>Bibliografía consultada</b>
    <ul style="margin:6px 0 0 18px;padding:0;font-size:12px;line-height:1.55">
      <li><b>ASRA 2018</b> — Horlocker TT et al. Regional Anesthesia in the Patient Receiving Antithrombotic or Thrombolytic Therapy: ASRA Evidence-Based Guidelines (4.ª ed.). <i>Reg Anesth Pain Med</i> 2018;43(3):263-309.</li>
      <li><b>ESAIC 2022</b> — Kietaibl S et al. Regional anaesthesia in patients on antithrombotic drugs: Joint ESAIC/ESRA guidelines. <i>Eur J Anaesthesiol</i> 2022;39(2):100-132.</li>
      <li><b>SACH</b> — Sociedad de Anestesiología de Chile. Recomendaciones sobre manejo del paciente con antitrombóticos en anestesia regional.</li>
      <li><b>ASA 2024</b> — Practice Advisory for Perioperative Management of Patients on Anticoagulants/Antiplatelets.</li>
    </ul>
    <div style="font-size:11.5px;margin-top:8px;opacity:.85">Los tiempos asumen función renal y hepática normales. Ajustar en insuficiencia renal (especialmente DOAC, HBPM y fondaparinux), edad avanzada, peso extremo o riesgo individual de sangrado. Decisión final: anestesiólogo a cargo del caso.</div>
  </div>`;
  container.innerHTML = html;
}

// ============================================================
// SERVICE WORKER (PWA)
// ============================================================
if('serviceWorker' in navigator){
  window.addEventListener('load', ()=>{
    navigator.serviceWorker.register('sw.js').catch(()=>{});
  });
}

// ============================================================
// BOOT — Selector de institución + carga de config externa
// ============================================================
const INSTITUTION_LS_KEY = 'appnesthesia_institution_id';
const LEGACY_LS_KEY = 'anestesia_app_v1';

// Fallback inline (para apertura por file:// donde fetch está bloqueado)
const INLINE_INSTITUTIONS_INDEX = JSON.parse('{"version":1,"lastUpdated":"2026-05-16","institutions":[{"id":"andes","name":"Clínica Universidad de los Andes","shortName":"Clínica Universidad de los Andes","country":"Chile","city":"Santiago"}]}');
const INLINE_INSTITUTION_CONFIGS = {
  'andes': JSON.parse('{"id":"andes","name":"Clínica Universidad de los Andes","shortName":"Clínica Universidad de los Andes","country":"Chile","city":"Santiago","welcome":"Servicio de Anestesiología","horarioEmbedURL":"https://onedrive.live.com/edit?id=BED7497A3E8C32FC!2204&resid=BED7497A3E8C32FC!2204&ithint=file%2Cxlsx&authkey=!AOBslmFUGIX9rW8&wdo=2&cid=bed7497a3e8c32fc","staff":[{"id":"s_arriagada","name":"Arriagada","role":"Staff","cumplimientoJornadas":"75-85","jornadasBorradas":0,"equipoTMT":false,"equipoCardio":false,"equipoPediatria":false,"rolCoordinacion":false,"noFondoComun":false,"residenciaAnios":"1-5","esResidente":false,"llamadaPediatrica":false,"llamadaCardio":false,"primeraLlamadaFija":false,"segundaLlamadaFija":false,"coberturaTurnoUrg":false,"coberturaLlamada1":false,"coberturaLlamada2":false,"exentoCobertura":false},{"id":"s_molina","name":"Molina","role":"Staff","cumplimientoJornadas":"75-85","jornadasBorradas":0,"equipoTMT":false,"equipoCardio":false,"equipoPediatria":false,"rolCoordinacion":false,"noFondoComun":false,"residenciaAnios":"1-5","esResidente":false,"llamadaPediatrica":false,"llamadaCardio":false,"primeraLlamadaFija":false,"segundaLlamadaFija":false,"coberturaTurnoUrg":false,"coberturaLlamada1":false,"coberturaLlamada2":false,"exentoCobertura":false},{"id":"s_martinez","name":"Martinez","role":"Staff","cumplimientoJornadas":"75-85","jornadasBorradas":0,"equipoTMT":false,"equipoCardio":false,"equipoPediatria":false,"rolCoordinacion":false,"noFondoComun":false,"residenciaAnios":"1-5","esResidente":false,"llamadaPediatrica":false,"llamadaCardio":false,"primeraLlamadaFija":false,"segundaLlamadaFija":false,"coberturaTurnoUrg":false,"coberturaLlamada1":false,"coberturaLlamada2":false,"exentoCobertura":false},{"id":"s_rodriguez","name":"Rodriguez","role":"Staff","cumplimientoJornadas":"75-85","jornadasBorradas":0,"equipoTMT":false,"equipoCardio":false,"equipoPediatria":false,"rolCoordinacion":false,"noFondoComun":false,"residenciaAnios":"1-5","esResidente":false,"llamadaPediatrica":false,"llamadaCardio":false,"primeraLlamadaFija":false,"segundaLlamadaFija":false,"coberturaTurnoUrg":false,"coberturaLlamada1":false,"coberturaLlamada2":false,"exentoCobertura":false},{"id":"s_guerrero","name":"Guerrero","role":"Staff","cumplimientoJornadas":"75-85","jornadasBorradas":0,"equipoTMT":false,"equipoCardio":false,"equipoPediatria":false,"rolCoordinacion":false,"noFondoComun":false,"residenciaAnios":"1-5","esResidente":false,"llamadaPediatrica":false,"llamadaCardio":false,"primeraLlamadaFija":false,"segundaLlamadaFija":false,"coberturaTurnoUrg":false,"coberturaLlamada1":false,"coberturaLlamada2":false,"exentoCobertura":true},{"id":"s_vozmediano","name":"Vozmediano","role":"Staff","cumplimientoJornadas":"75-85","jornadasBorradas":0,"equipoTMT":false,"equipoCardio":false,"equipoPediatria":false,"rolCoordinacion":false,"noFondoComun":false,"residenciaAnios":"1-5","esResidente":false,"llamadaPediatrica":false,"llamadaCardio":false,"primeraLlamadaFija":false,"segundaLlamadaFija":false,"coberturaTurnoUrg":false,"coberturaLlamada1":false,"coberturaLlamada2":false,"exentoCobertura":false},{"id":"s_fierro","name":"Fierro","role":"Staff","cumplimientoJornadas":"75-85","jornadasBorradas":0,"equipoTMT":false,"equipoCardio":false,"equipoPediatria":false,"rolCoordinacion":false,"noFondoComun":false,"residenciaAnios":"1-5","esResidente":false,"llamadaPediatrica":false,"llamadaCardio":false,"primeraLlamadaFija":false,"segundaLlamadaFija":false,"coberturaTurnoUrg":false,"coberturaLlamada1":false,"coberturaLlamada2":false,"exentoCobertura":false},{"id":"s_rojas","name":"Rojas","role":"Staff","cumplimientoJornadas":"75-85","jornadasBorradas":0,"equipoTMT":false,"equipoCardio":false,"equipoPediatria":false,"rolCoordinacion":false,"noFondoComun":false,"residenciaAnios":"1-5","esResidente":false,"llamadaPediatrica":false,"llamadaCardio":false,"primeraLlamadaFija":false,"segundaLlamadaFija":false,"coberturaTurnoUrg":false,"coberturaLlamada1":false,"coberturaLlamada2":false,"exentoCobertura":false},{"id":"s_canepa","name":"Canepa","role":"Staff","cumplimientoJornadas":"75-85","jornadasBorradas":0,"equipoTMT":false,"equipoCardio":false,"equipoPediatria":false,"rolCoordinacion":false,"noFondoComun":false,"residenciaAnios":"1-5","esResidente":false,"llamadaPediatrica":false,"llamadaCardio":false,"primeraLlamadaFija":false,"segundaLlamadaFija":false,"coberturaTurnoUrg":false,"coberturaLlamada1":false,"coberturaLlamada2":false,"exentoCobertura":false},{"id":"s_duran","name":"Duran","role":"Staff","cumplimientoJornadas":"75-85","jornadasBorradas":0,"equipoTMT":false,"equipoCardio":false,"equipoPediatria":false,"rolCoordinacion":false,"noFondoComun":false,"residenciaAnios":"1-5","esResidente":false,"llamadaPediatrica":false,"llamadaCardio":false,"primeraLlamadaFija":false,"segundaLlamadaFija":false,"coberturaTurnoUrg":false,"coberturaLlamada1":false,"coberturaLlamada2":false,"exentoCobertura":false},{"id":"s_cardemil","name":"Cardemil","role":"Staff","cumplimientoJornadas":"75-85","jornadasBorradas":0,"equipoTMT":false,"equipoCardio":false,"equipoPediatria":false,"rolCoordinacion":false,"noFondoComun":false,"residenciaAnios":"1-5","esResidente":false,"llamadaPediatrica":false,"llamadaCardio":false,"primeraLlamadaFija":false,"segundaLlamadaFija":false,"coberturaTurnoUrg":false,"coberturaLlamada1":false,"coberturaLlamada2":false,"exentoCobertura":false},{"id":"s_juliov","name":"Julio V.","role":"Staff","cumplimientoJornadas":"75-85","jornadasBorradas":0,"equipoTMT":false,"equipoCardio":false,"equipoPediatria":false,"rolCoordinacion":false,"noFondoComun":false,"residenciaAnios":"1-5","esResidente":false,"llamadaPediatrica":false,"llamadaCardio":false,"primeraLlamadaFija":false,"segundaLlamadaFija":false,"coberturaTurnoUrg":false,"coberturaLlamada1":false,"coberturaLlamada2":false,"exentoCobertura":true},{"id":"s_gonzalez","name":"Gonzalez","role":"Staff","cumplimientoJornadas":"75-85","jornadasBorradas":0,"equipoTMT":false,"equipoCardio":false,"equipoPediatria":false,"rolCoordinacion":false,"noFondoComun":false,"residenciaAnios":"1-5","esResidente":false,"llamadaPediatrica":false,"llamadaCardio":false,"primeraLlamadaFija":false,"segundaLlamadaFija":false,"coberturaTurnoUrg":false,"coberturaLlamada1":false,"coberturaLlamada2":false,"exentoCobertura":false},{"id":"s_larraguibel","name":"Larraguibel","role":"Staff","cumplimientoJornadas":"75-85","jornadasBorradas":0,"equipoTMT":false,"equipoCardio":false,"equipoPediatria":false,"rolCoordinacion":false,"noFondoComun":false,"residenciaAnios":"1-5","esResidente":false,"llamadaPediatrica":false,"llamadaCardio":false,"primeraLlamadaFija":false,"segundaLlamadaFija":false,"coberturaTurnoUrg":false,"coberturaLlamada1":false,"coberturaLlamada2":false,"exentoCobertura":false},{"id":"s_barra","name":"Barra","role":"Staff","cumplimientoJornadas":"75-85","jornadasBorradas":0,"equipoTMT":false,"equipoCardio":false,"equipoPediatria":false,"rolCoordinacion":false,"noFondoComun":false,"residenciaAnios":"1-5","esResidente":false,"llamadaPediatrica":false,"llamadaCardio":false,"primeraLlamadaFija":false,"segundaLlamadaFija":false,"coberturaTurnoUrg":false,"coberturaLlamada1":false,"coberturaLlamada2":false,"exentoCobertura":false},{"id":"s_biancardi","name":"Biancardi","role":"Staff","cumplimientoJornadas":"75-85","jornadasBorradas":0,"equipoTMT":false,"equipoCardio":false,"equipoPediatria":false,"rolCoordinacion":false,"noFondoComun":false,"residenciaAnios":"1-5","esResidente":false,"llamadaPediatrica":false,"llamadaCardio":false,"primeraLlamadaFija":false,"segundaLlamadaFija":false,"coberturaTurnoUrg":false,"coberturaLlamada1":false,"coberturaLlamada2":false,"exentoCobertura":false},{"id":"s_coloma","name":"Coloma","role":"Staff","cumplimientoJornadas":"75-85","jornadasBorradas":0,"equipoTMT":false,"equipoCardio":false,"equipoPediatria":false,"rolCoordinacion":false,"noFondoComun":false,"residenciaAnios":"1-5","esResidente":false,"llamadaPediatrica":false,"llamadaCardio":false,"primeraLlamadaFija":false,"segundaLlamadaFija":false,"coberturaTurnoUrg":false,"coberturaLlamada1":false,"coberturaLlamada2":false,"exentoCobertura":false},{"id":"s_larosa","name":"La Rosa","role":"Staff","cumplimientoJornadas":"75-85","jornadasBorradas":0,"equipoTMT":false,"equipoCardio":false,"equipoPediatria":false,"rolCoordinacion":false,"noFondoComun":false,"residenciaAnios":"1-5","esResidente":false,"llamadaPediatrica":false,"llamadaCardio":false,"primeraLlamadaFija":false,"segundaLlamadaFija":false,"coberturaTurnoUrg":false,"coberturaLlamada1":false,"coberturaLlamada2":false,"exentoCobertura":false},{"id":"s_silva","name":"Silva","role":"Staff","cumplimientoJornadas":"75-85","jornadasBorradas":0,"equipoTMT":false,"equipoCardio":false,"equipoPediatria":false,"rolCoordinacion":false,"noFondoComun":false,"residenciaAnios":"1-5","esResidente":false,"llamadaPediatrica":false,"llamadaCardio":false,"primeraLlamadaFija":false,"segundaLlamadaFija":false,"coberturaTurnoUrg":false,"coberturaLlamada1":false,"coberturaLlamada2":false,"exentoCobertura":false},{"id":"s_jara","name":"Jara","role":"Staff","cumplimientoJornadas":"75-85","jornadasBorradas":0,"equipoTMT":false,"equipoCardio":false,"equipoPediatria":false,"rolCoordinacion":false,"noFondoComun":false,"residenciaAnios":"1-5","esResidente":false,"llamadaPediatrica":false,"llamadaCardio":false,"primeraLlamadaFija":false,"segundaLlamadaFija":false,"coberturaTurnoUrg":false,"coberturaLlamada1":false,"coberturaLlamada2":false,"exentoCobertura":false},{"id":"s_gallardo","name":"Gallardo","role":"Staff","cumplimientoJornadas":"75-85","jornadasBorradas":0,"equipoTMT":false,"equipoCardio":false,"equipoPediatria":false,"rolCoordinacion":false,"noFondoComun":false,"residenciaAnios":"1-5","esResidente":false,"llamadaPediatrica":false,"llamadaCardio":false,"primeraLlamadaFija":false,"segundaLlamadaFija":false,"coberturaTurnoUrg":false,"coberturaLlamada1":false,"coberturaLlamada2":false,"exentoCobertura":false},{"id":"s_hugov","name":"Hugo V.","role":"Staff","cumplimientoJornadas":"75-85","jornadasBorradas":0,"equipoTMT":false,"equipoCardio":false,"equipoPediatria":false,"rolCoordinacion":false,"noFondoComun":false,"residenciaAnios":"1-5","esResidente":false,"llamadaPediatrica":false,"llamadaCardio":false,"primeraLlamadaFija":false,"segundaLlamadaFija":false,"coberturaTurnoUrg":false,"coberturaLlamada1":false,"coberturaLlamada2":false,"exentoCobertura":false},{"id":"s_camilar","name":"Camila R.","role":"Staff","cumplimientoJornadas":"75-85","jornadasBorradas":0,"equipoTMT":false,"equipoCardio":false,"equipoPediatria":false,"rolCoordinacion":false,"noFondoComun":false,"residenciaAnios":"1-5","esResidente":false,"llamadaPediatrica":false,"llamadaCardio":false,"primeraLlamadaFija":false,"segundaLlamadaFija":false,"coberturaTurnoUrg":false,"coberturaLlamada1":false,"coberturaLlamada2":false,"exentoCobertura":false},{"id":"s_stamaria","name":"Sta. María","role":"Staff","cumplimientoJornadas":"75-85","jornadasBorradas":0,"equipoTMT":false,"equipoCardio":false,"equipoPediatria":false,"rolCoordinacion":false,"noFondoComun":false,"residenciaAnios":"1-5","esResidente":false,"llamadaPediatrica":false,"llamadaCardio":false,"primeraLlamadaFija":false,"segundaLlamadaFija":false,"coberturaTurnoUrg":false,"coberturaLlamada1":false,"coberturaLlamada2":false,"exentoCobertura":false},{"id":"s_leisewitz","name":"Leisewitz","role":"Staff","cumplimientoJornadas":"75-85","jornadasBorradas":0,"equipoTMT":false,"equipoCardio":false,"equipoPediatria":false,"rolCoordinacion":false,"noFondoComun":false,"residenciaAnios":"1-5","esResidente":false,"llamadaPediatrica":false,"llamadaCardio":false,"primeraLlamadaFija":false,"segundaLlamadaFija":false,"coberturaTurnoUrg":false,"coberturaLlamada1":false,"coberturaLlamada2":false,"exentoCobertura":false},{"id":"s_chuen","name":"Chuen","role":"Staff","cumplimientoJornadas":"75-85","jornadasBorradas":0,"equipoTMT":false,"equipoCardio":false,"equipoPediatria":false,"rolCoordinacion":false,"noFondoComun":false,"residenciaAnios":"1-5","esResidente":false,"llamadaPediatrica":false,"llamadaCardio":false,"primeraLlamadaFija":false,"segundaLlamadaFija":false,"coberturaTurnoUrg":false,"coberturaLlamada1":false,"coberturaLlamada2":false,"exentoCobertura":false},{"id":"s_miranda","name":"Miranda","role":"Staff","cumplimientoJornadas":"75-85","jornadasBorradas":0,"equipoTMT":false,"equipoCardio":false,"equipoPediatria":false,"rolCoordinacion":false,"noFondoComun":false,"residenciaAnios":"1-5","esResidente":false,"llamadaPediatrica":false,"llamadaCardio":false,"primeraLlamadaFija":false,"segundaLlamadaFija":false,"coberturaTurnoUrg":false,"coberturaLlamada1":false,"coberturaLlamada2":false,"exentoCobertura":false},{"id":"s_salazar","name":"Salazar","role":"Staff","cumplimientoJornadas":"75-85","jornadasBorradas":0,"equipoTMT":false,"equipoCardio":false,"equipoPediatria":false,"rolCoordinacion":false,"noFondoComun":false,"residenciaAnios":"1-5","esResidente":false,"llamadaPediatrica":false,"llamadaCardio":false,"primeraLlamadaFija":false,"segundaLlamadaFija":false,"coberturaTurnoUrg":false,"coberturaLlamada1":false,"coberturaLlamada2":false,"exentoCobertura":false},{"id":"s_ricke","name":"Ricke","role":"Staff","cumplimientoJornadas":"75-85","jornadasBorradas":0,"equipoTMT":false,"equipoCardio":false,"equipoPediatria":false,"rolCoordinacion":false,"noFondoComun":false,"residenciaAnios":"1-5","esResidente":false,"llamadaPediatrica":false,"llamadaCardio":false,"primeraLlamadaFija":false,"segundaLlamadaFija":false,"coberturaTurnoUrg":false,"coberturaLlamada1":false,"coberturaLlamada2":false,"exentoCobertura":true},{"id":"s_veliz","name":"Veliz","role":"Staff","cumplimientoJornadas":"75-85","jornadasBorradas":0,"equipoTMT":false,"equipoCardio":false,"equipoPediatria":false,"rolCoordinacion":false,"noFondoComun":false,"residenciaAnios":"1-5","esResidente":false,"llamadaPediatrica":false,"llamadaCardio":false,"primeraLlamadaFija":false,"segundaLlamadaFija":false,"coberturaTurnoUrg":false,"coberturaLlamada1":false,"coberturaLlamada2":false,"exentoCobertura":true},{"id":"s_astorga","name":"Astorga","role":"Staff","cumplimientoJornadas":"75-85","jornadasBorradas":0,"equipoTMT":false,"equipoCardio":false,"equipoPediatria":false,"rolCoordinacion":false,"noFondoComun":false,"residenciaAnios":"1-5","esResidente":false,"llamadaPediatrica":false,"llamadaCardio":false,"primeraLlamadaFija":false,"segundaLlamadaFija":false,"coberturaTurnoUrg":false,"coberturaLlamada1":false,"coberturaLlamada2":false,"exentoCobertura":false}]}')
};

async function fetchJSON(url){
  const r = await fetch(url, {cache:'no-cache'});
  if(!r.ok) throw new Error('HTTP '+r.status+' '+url);
  return r.json();
}

async function loadInstitutionsIndex(){
  try{
    return await fetchJSON('configs/index.json');
  }catch(e){
    console.warn('configs/index.json no disponible (fetch falló) — usando fallback inline',e);
    return INLINE_INSTITUTIONS_INDEX;
  }
}

async function loadInstitutionConfig(id){
  try{
    return await fetchJSON('configs/'+id+'.json');
  }catch(e){
    if(INLINE_INSTITUTION_CONFIGS[id]){
      console.warn('configs/'+id+'.json no disponible — usando fallback inline');
      return INLINE_INSTITUTION_CONFIGS[id];
    }
    throw e;
  }
}

function migrateLegacyStateIfNeeded(institutionId){
  const newKey = 'anestesia_app_'+institutionId;
  if(localStorage.getItem(newKey)) return; // ya migrado
  const legacy = localStorage.getItem(LEGACY_LS_KEY);
  if(legacy){
    localStorage.setItem(newKey, legacy);
    // Conservamos la copia legacy como respaldo por si hay rollback
  }
}

function applyInstitutionConfig(cfg){
  INSTITUTION = cfg;
  DEFAULT_STATE.staff = JSON.parse(JSON.stringify(cfg.staff||[]));
  DEFAULT_STATE.horarioEmbedURL = cfg.horarioEmbedURL || '';
  LS_KEY = 'anestesia_app_'+cfg.id;
}

function updateInstitutionUI(){
  if(!INSTITUTION) return;
  const nm = INSTITUTION.shortName || INSTITUTION.name;
  const elHome = document.getElementById('instNameHome');
  if(elHome) elHome.textContent = nm;
  const elEq = document.getElementById('instNameEquipo');
  if(elEq) elEq.textContent = INSTITUTION.name + (INSTITUTION.city?' · '+INSTITUTION.city:'');
}

function renderInstitutionPicker(institutions){
  const list = document.getElementById('institutionList');
  if(!institutions || institutions.length===0){
    list.innerHTML = '<div class="inst-loading" style="color:var(--danger)">No hay instituciones disponibles. Contactá al administrador.</div>';
    return;
  }
  list.innerHTML = institutions.map(i=>{
    const initials = (i.shortName||i.name).split(' ').slice(0,2).map(w=>w[0]||'').join('').toUpperCase();
    const loc = [i.city,i.country].filter(Boolean).join(', ');
    return `<button class="inst-item" onclick="selectInstitution('${i.id}')">
      <div class="inst-item-flag">${initials}</div>
      <div class="inst-item-info">
        <div class="inst-item-name">${i.name}</div>
        <div class="inst-item-loc">${loc}</div>
      </div>
      <div class="inst-item-arrow">›</div>
    </button>`;
  }).join('');
}

async function selectInstitution(id){
  try{
    const cfg = await loadInstitutionConfig(id);
    localStorage.setItem(INSTITUTION_LS_KEY, id);
    migrateLegacyStateIfNeeded(id);
    applyInstitutionConfig(cfg);
    state = load();
    // Traer estado compartido del backend antes de mostrar la home
    await bootSync();
    save();
    document.getElementById('institutionPicker').classList.add('hidden');
    updateInstitutionUI();
    updateAdminUI();
    showHome();
  }catch(e){
    console.error(e);
    alert('No se pudo cargar la configuración de la institución: '+e.message);
  }
}

function cambiarInstitucion(){
  if(!state || !state.isAdmin){ toast && toast('Solo el administrador'); return; }
  const ok = confirm('¿Cambiar de institución? Los datos locales de esta institución se mantienen guardados y volverás a verlos cuando la selecciones de nuevo. La app se reiniciará para que elijas otra institución.');
  if(!ok) return;
  localStorage.removeItem(INSTITUTION_LS_KEY);
  location.reload();
}
// Variante sin restricción admin: usada desde el user picker (todavía no hay sesión activa)
function cambiarInstitucionFromPicker(){
  const ok = confirm('¿Volver a elegir institución? La app se reiniciará. Tus datos locales quedan guardados por institución.');
  if(!ok) return;
  localStorage.removeItem(INSTITUTION_LS_KEY);
  location.reload();
}

// ============================================================
// NOTIFICACIONES (Nivel 2 — sistema operativo mientras app abierta)
// ============================================================
function notifSupported(){ return 'Notification' in window; }
function notifAllowed(){ return notifSupported() && Notification.permission === 'granted'; }
function notifDenied(){ return notifSupported() && Notification.permission === 'denied'; }

async function requestNotifPermission(){
  if(!notifSupported()) return false;
  if(Notification.permission === 'granted') return true;
  if(Notification.permission === 'denied') return false;
  try{
    const p = await Notification.requestPermission();
    return p === 'granted';
  }catch(e){ return false; }
}

async function requestNotifPermissionInteractive(){
  if(!notifSupported()){ toast && toast('Tu navegador no soporta notificaciones'); return; }
  if(Notification.permission === 'denied'){
    alert('Las notificaciones están bloqueadas en este navegador. Habilitalas desde la configuración del sitio.');
    return;
  }
  const ok = await requestNotifPermission();
  toast && toast(ok ? 'Notificaciones activadas' : 'Permiso denegado');
  updateNotifPermBtn();
}

function updateNotifPermBtn(){
  const btn = document.getElementById('notifPermBtn');
  if(!btn) return;
  if(!notifSupported() || notifAllowed()){ btn.style.display='none'; return; }
  btn.style.display='';
  btn.textContent = notifDenied() ? '🔕 Notificaciones bloqueadas' : '🔔 Activar notificaciones';
}

function notify(title, body, tag){
  if(!notifAllowed()) return null;
  try{
    return new Notification(title, {
      body: body||'',
      icon: './icon-192.png',
      badge: './icon-192.png',
      tag: tag||undefined
    });
  }catch(e){ console.warn('notify failed', e); return null; }
}

// ============================================================
// CALENDARIO DE EVENTOS (reuniones, cumpleaños, conmemorativos)
// ============================================================
const EVENT_TYPES = [
  {id:'reunion-servicio', label:'Reunión del servicio', icon:'👥', color:'#1e6b54'},
  {id:'reunion-direccion', label:'Reunión dirección médica', icon:'🏥', color:'#dc2626'},
  {id:'dia-conmemorativo', label:'Día conmemorativo', icon:'🎉', color:'#f59e0b'},
  {id:'capacitacion', label:'Capacitación / Curso', icon:'📚', color:'#2563eb'},
  {id:'otro', label:'Otro', icon:'📌', color:'#6b7280'},
];
function eventTypeMeta(typeId){
  return EVENT_TYPES.find(t=>t.id===typeId) || EVENT_TYPES[EVENT_TYPES.length-1];
}

// Fechas: helpers
function todayISO(){ return new Date().toISOString().slice(0,10); }
function daysBetween(aISO, bISO){
  const a = new Date(aISO + 'T00:00:00');
  const b = new Date(bISO + 'T00:00:00');
  return Math.round((a - b) / 86400000);
}
function formatDateLong(iso){
  try{
    return new Date(iso+'T00:00:00').toLocaleDateString('es-CL',{weekday:'short',day:'2-digit',month:'short'});
  }catch(e){ return iso; }
}

// Construye lista combinada de eventos + cumpleaños del año actual
function expandedEvents(){
  ensureAllUserDefaults();
  const out = [];
  (state.events||[]).forEach(e=>{
    out.push({
      kind:'event',
      id:e.id,
      type:e.type||'otro',
      title:e.title||'(sin título)',
      date:e.date,
      time:e.time||'',
      location:e.location||'',
      description:e.description||'',
      raw:e
    });
  });
  const thisYear = new Date().getFullYear();
  (state.staff||[]).forEach(s=>{
    if(!s.birthday) return;
    // birthday: 'MM-DD'
    const m = String(s.birthday).match(/^(\d{2})-(\d{2})$/);
    if(!m) return;
    const dateThisYear = thisYear + '-' + m[1] + '-' + m[2];
    out.push({
      kind:'birthday',
      id:'bd-'+s.id+'-'+thisYear,
      type:'cumpleanos',
      title:'Cumpleaños de '+s.name,
      date:dateThisYear,
      time:'',
      location:'',
      description:'',
      staff:s
    });
  });
  out.sort((a,b)=>String(a.date).localeCompare(String(b.date)));
  return out;
}

function eventsInNextDays(n){
  const today = todayISO();
  const all = expandedEvents();
  return all.filter(e=>{
    if(!e.date) return false;
    const d = daysBetween(e.date, today);
    return d>=0 && d<=n;
  });
}

function birthdaysThisMonth(){
  const all = expandedEvents().filter(e=>e.kind==='birthday');
  const month = new Date().toISOString().slice(5,7);
  return all.filter(e=>e.date.slice(5,7)===month);
}

function renderEventos(){
  updateNotifPermBtn();
  const prox = eventsInNextDays(7);
  const proxBox = document.getElementById('eventosProx');
  if(prox.length === 0){
    proxBox.innerHTML = '<div class="empty" style="padding:14px"><span class="big" style="font-size:24px">📅</span>Sin eventos en los próximos 7 días</div>';
  } else {
    proxBox.innerHTML = prox.map(renderEventCard).join('');
  }
  // Cumpleaños
  const bds = birthdaysThisMonth();
  const bdsBox = document.getElementById('eventosCumple');
  if(bds.length === 0){
    bdsBox.innerHTML = '<div class="empty" style="padding:12px;font-size:12px">No hay cumpleaños este mes</div>';
  } else {
    bdsBox.innerHTML = bds.map(renderEventCard).join('');
  }
  // Todos
  const all = expandedEvents().filter(e=>{
    if(!e.date) return false;
    return daysBetween(e.date, todayISO())>=-30;
  });
  const allBox = document.getElementById('eventosTodos');
  if(all.length === 0){
    allBox.innerHTML = '<div class="empty" style="padding:14px"><span class="big" style="font-size:24px">📋</span>No hay eventos cargados</div>';
  } else {
    allBox.innerHTML = all.map(renderEventCard).join('');
  }
}

function renderEventCard(e){
  let meta, icon, color;
  if(e.kind === 'birthday'){
    meta = {label:'Cumpleaños', icon:'🎂', color:'#ec4899'};
    icon = '🎂'; color = '#ec4899';
  } else {
    meta = eventTypeMeta(e.type);
    icon = meta.icon; color = meta.color;
  }
  const dayDiff = daysBetween(e.date, todayISO());
  let when = formatDateLong(e.date);
  if(dayDiff === 0) when = '🟢 Hoy · ' + when;
  else if(dayDiff === 1) when = '🟡 Mañana · ' + when;
  else if(dayDiff > 0 && dayDiff <= 7) when = 'En ' + dayDiff + ' días · ' + when;
  else if(dayDiff < 0) when = 'Pasó · ' + when;
  const timeBit = e.time ? ' · '+e.time+' h' : '';
  const locBit = e.location ? '<div style="font-size:11.5px;color:var(--muted);margin-top:4px">📍 '+e.location+'</div>' : '';
  const descBit = e.description ? '<div style="font-size:12px;color:var(--text);margin-top:6px;line-height:1.4">'+e.description+'</div>' : '';
  const canEdit = state.isAdmin && e.kind === 'event';
  const actions = canEdit ? '<div class="btn-row" style="margin-top:6px"><button class="btn sm secondary" onclick="editEvent(\''+e.id+'\')">Editar</button><button class="btn sm danger" onclick="deleteEvent(\''+e.id+'\')">Eliminar</button></div>' : '';
  return '<div class="exchange" style="border-left:4px solid '+color+'">'
    + '<div class="top">'
    +   '<div><div class="who"><span style="margin-right:6px">'+icon+'</span>'+e.title+'</div>'
    +     '<div class="when">'+when+timeBit+'</div>'
    +   '</div>'
    +   '<span class="chip" style="background:'+color+'22;color:'+color+';font-weight:600">'+meta.label+'</span>'
    + '</div>'
    + locBit
    + descBit
    + actions
    + '</div>';
}

function openEventModal(eventId){
  const editing = eventId ? (state.events||[]).find(e=>e.id===eventId) : null;
  const e = editing || {id:'e'+Date.now(), type:'reunion-servicio', title:'', date:todayISO(), time:'', location:'', description:''};
  const opts = EVENT_TYPES.map(t=>'<option value="'+t.id+'" '+(e.type===t.id?'selected':'')+'>'+t.icon+' '+t.label+'</option>').join('');
  modal(`
    <h3>${editing?'Editar':'Nuevo'} evento</h3>
    <div class="field"><label>Tipo</label><select id="evt_type">${opts}</select></div>
    <div class="field"><label>Título</label><input id="evt_title" value="${e.title.replace(/"/g,'&quot;')}" placeholder="Ej: Reunión clínica mensual"></div>
    <div class="field"><label>Fecha</label><input id="evt_date" type="date" value="${e.date}"></div>
    <div class="field"><label>Hora (opcional)</label><input id="evt_time" type="time" value="${e.time}"></div>
    <div class="field"><label>Ubicación (opcional)</label><input id="evt_location" value="${e.location.replace(/"/g,'&quot;')}" placeholder="Ej: Sala de reuniones piso 5"></div>
    <div class="field"><label>Descripción (opcional)</label><textarea id="evt_desc" rows="3">${e.description}</textarea></div>
    <div class="btn-row">
      <button class="btn accent" onclick="saveEvent('${e.id}', ${editing?'false':'true'})">${editing?'Guardar':'Crear evento'}</button>
      <button class="btn secondary" onclick="closeModal()">Cancelar</button>
    </div>
  `);
}

function saveEvent(id, isNew){
  const title = document.getElementById('evt_title').value.trim();
  const date = document.getElementById('evt_date').value;
  if(!title){ toast('Falta el título'); return; }
  if(!date){ toast('Falta la fecha'); return; }
  const ev = {
    id,
    type: document.getElementById('evt_type').value,
    title,
    date,
    time: document.getElementById('evt_time').value,
    location: document.getElementById('evt_location').value.trim(),
    description: document.getElementById('evt_desc').value.trim(),
    createdBy: state.currentUserId || null,
    createdAt: new Date().toISOString()
  };
  state.events = state.events||[];
  if(isNew==='true' || isNew===true){
    state.events.unshift(ev);
  } else {
    state.events = state.events.map(x=>x.id===id?ev:x);
  }
  save();
  closeModal();
  renderEventos();
  updateEventBadge();
  toast(isNew==='true'||isNew===true ? 'Evento creado' : 'Evento actualizado');
}

function editEvent(id){ openEventModal(id); }
function deleteEvent(id){
  if(!confirm('¿Eliminar este evento?')) return;
  state.events = (state.events||[]).filter(e=>e.id!==id);
  save();
  renderEventos();
  updateEventBadge();
  toast('Evento eliminado');
}

function updateEventBadge(){
  const today = todayISO();
  const todayCount = expandedEvents().filter(e=>e.date===today).length;
  const b = document.getElementById('evtBadgeHome');
  if(!b) return;
  if(todayCount>0){
    b.textContent = todayCount;
    b.style.display = 'inline-block';
  } else {
    b.style.display = 'none';
  }
}

// ============================================================
// RECORDATORIOS — se ejecuta al cargar y al cambiar de vista
// ============================================================
function checkReminders(){
  if(!state) return;
  state.notifShown = state.notifShown || [];
  const today = todayISO();
  const upcoming = expandedEvents();
  let saved = false;
  upcoming.forEach(e=>{
    if(!e.date) return;
    const dayDiff = daysBetween(e.date, today);
    if(dayDiff === 0){
      const tag = 'event:'+e.id+':today:'+today;
      if(!state.notifShown.includes(tag)){
        const tBit = e.time ? ' a las '+e.time+' h' : '';
        notify('📅 Hoy: '+e.title, (e.location ? e.location + ' · ' : '') + tBit);
        state.notifShown.push(tag);
        saved = true;
      }
    } else if(dayDiff === 1){
      const tag = 'event:'+e.id+':tomorrow:'+today;
      if(!state.notifShown.includes(tag)){
        const tBit = e.time ? ' '+e.time+' h' : '';
        notify('🔔 Mañana: '+e.title, 'No te olvides · '+formatDateLong(e.date)+tBit);
        state.notifShown.push(tag);
        saved = true;
      }
    }
  });
  if(state.notifShown.length>200) state.notifShown = state.notifShown.slice(-200);
  if(saved) save();
}

// ============================================================
// PERFILES DE USUARIO — PIN, login, panel personal
// ============================================================
const PIN_SALT = 'appnesthesia_v1_salt';
const ADMIN_USER_ID = '__admin__';

async function hashPIN(pin, scope){
  const data = new TextEncoder().encode(PIN_SALT + ':' + scope + ':' + pin);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

function ensureUserDefaults(s){
  if(s.pinHash === undefined) s.pinHash = null;
  if(!s.preferences) s.preferences = {notifications:true, hideOthers:false};
  if(!Array.isArray(s.activityLog)) s.activityLog = [];
  return s;
}
function ensureAllUserDefaults(){
  (state.staff||[]).forEach(ensureUserDefaults);
}

// "Usuario virtual" Administrador, persistido en state.adminUser
function getAdminVirtualUser(){
  if(!state.adminUser){
    state.adminUser = {
      id: ADMIN_USER_ID,
      name: 'Administrador',
      role: 'Admin del servicio',
      preferences: {notifications:true, hideOthers:false},
      activityLog: []
    };
  }
  return state.adminUser;
}

function getCurrentUser(){
  if(!state || !state.currentUserId) return null;
  if(state.currentUserId === ADMIN_USER_ID) return getAdminVirtualUser();
  return state.staff.find(s=>s.id===state.currentUserId) || null;
}

function logActivity(type, text, details){
  const u = getCurrentUser();
  if(!u) return;
  ensureUserDefaults(u);
  u.activityLog.unshift({type, text:text||'', details:details||{}, at:new Date().toISOString()});
  if(u.activityLog.length>50) u.activityLog = u.activityLog.slice(0,50);
}

// --- PIN Pad reutilizable ---
let _pinBuffer = '';
let _pinMaxLen = 4;
let _pinOnComplete = null;
let _pinOnCancel = null;

function openPinPad(opts){
  _pinBuffer = '';
  _pinMaxLen = opts.maxLen || 4;
  _pinOnComplete = opts.onComplete;
  _pinOnCancel = opts.onCancel || (()=>{});
  document.getElementById('pinTitle').textContent = opts.title || 'Ingresar PIN';
  document.getElementById('pinSub').textContent = opts.sub || ('Introducí los '+_pinMaxLen+' dígitos');
  document.getElementById('pinMsg').textContent = '';
  renderPinDisplay();
  renderPinPad();
  document.getElementById('pinOverlay').classList.remove('hidden');
}
function closePinPad(){
  document.getElementById('pinOverlay').classList.add('hidden');
  _pinBuffer = '';
}
function cancelPin(){
  const cb = _pinOnCancel;
  closePinPad();
  if(cb) cb();
}
function renderPinDisplay(err){
  const display = document.getElementById('pinDisplay');
  display.innerHTML = '';
  for(let i=0;i<_pinMaxLen;i++){
    const d = document.createElement('div');
    d.className = 'pin-dot' + (i<_pinBuffer.length?' filled':'') + (err?' error':'');
    display.appendChild(d);
  }
}
function renderPinPad(){
  const pad = document.getElementById('pinPad');
  pad.innerHTML = '';
  const keys = ['1','2','3','4','5','6','7','8','9','clr','0','del'];
  keys.forEach(k=>{
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pin-key' + ((k==='clr'||k==='del')?' action':'');
    b.textContent = k==='clr'?'C':k==='del'?'⌫':k;
    b.onclick = ()=>pinKey(k);
    pad.appendChild(b);
  });
}
function pinKey(k){
  if(k==='clr'){ _pinBuffer=''; renderPinDisplay(); return; }
  if(k==='del'){ _pinBuffer=_pinBuffer.slice(0,-1); renderPinDisplay(); return; }
  if(_pinBuffer.length >= _pinMaxLen) return;
  _pinBuffer += k;
  renderPinDisplay();
  if(_pinBuffer.length === _pinMaxLen){
    const pin = _pinBuffer;
    setTimeout(()=>{ if(_pinOnComplete) _pinOnComplete(pin); }, 80);
  }
}
function pinError(msg){
  document.getElementById('pinMsg').textContent = msg||'';
  renderPinDisplay(true);
  setTimeout(()=>{ _pinBuffer=''; renderPinDisplay(); }, 350);
}

// --- Admin PIN ---
function adminSetupNeeded(){ return !state || !state.adminPinHash; }
async function promptSetAdminPin(){
  return new Promise(res=>{
    let firstPin = null;
    openPinPad({
      title:'🛡️ Configurar PIN de administrador',
      sub:'Este PIN da acceso a modo admin. Anotalo en lugar seguro.',
      maxLen:4,
      onComplete: async(pin)=>{
        if(!firstPin){
          firstPin = pin;
          openPinPad({
            title:'Confirmá el PIN',
            sub:'Repetí los 4 dígitos.',
            maxLen:4,
            onComplete: async(pin2)=>{
              if(pin2 !== firstPin){
                pinError('No coinciden, volvé a empezar');
                firstPin = null;
                setTimeout(()=>res(promptSetAdminPin()), 500);
                return;
              }
              state.adminPinHash = await hashPIN(pin, '__admin__');
              save();
              closePinPad();
              toast && toast('PIN de administrador configurado');
              res(true);
            },
            onCancel: ()=>res(false)
          });
        }
      },
      onCancel: ()=>res(false)
    });
  });
}
async function promptVerifyAdminPin(){
  return new Promise(res=>{
    openPinPad({
      title:'🛡️ PIN de administrador',
      sub:'Ingresá el PIN para activar modo admin.',
      maxLen:4,
      onComplete: async(pin)=>{
        const h = await hashPIN(pin, '__admin__');
        if(h === state.adminPinHash){ closePinPad(); res(true); }
        else { pinError('PIN incorrecto'); }
      },
      onCancel: ()=>res(false)
    });
  });
}

// --- User Picker ---
function renderUserPicker(){
  ensureAllUserDefaults();
  const inst = INSTITUTION ? (INSTITUTION.shortName||INSTITUTION.name) : '';
  document.getElementById('userPickerInst').textContent = inst;
  const grid = document.getElementById('userGrid');
  const staff = (state.staff||[]).slice().sort((a,b)=>String(a.name).localeCompare(String(b.name),'es'));

  const adminLock = state.adminPinHash ? '🔒' : '✨';
  // 1) Administrador (siempre arriba, full width)
  let html = '<button class="user-item" onclick="selectAdmin()" style="background:linear-gradient(135deg,#fff8ec 0%,#fef3c7 100%);border-color:#f59e0b">'
    + '<div class="user-item-avatar" style="background:linear-gradient(135deg,#f59e0b,#d97706)">🛡️</div>'
    + '<div style="flex:1;min-width:0"><div class="user-item-name">Administrador</div><div class="user-item-role">Gestión completa del servicio</div></div>'
    + '<div class="user-item-lock">'+adminLock+'</div>'
    + '</button>';

  // 2) Botón grande que abre el listado de staff en un modal con buscador
  if(staff.length === 0){
    html += '<div style="color:var(--muted);font-size:13px;padding:12px;text-align:center">Sin staff. Ingresá como Administrador para agregar miembros.</div>';
  } else {
    html += '<button class="user-item user-pick-open" onclick="openStaffPicker()" style="background:linear-gradient(135deg,#ecfdf5 0%,#d1fae5 100%);border-color:var(--primary)">'
      + '<div class="user-item-avatar">👥</div>'
      + '<div style="flex:1;min-width:0"><div class="user-item-name">Elegir mi nombre</div><div class="user-item-role">'+staff.length+' anestesiólogos · tocá para buscar y seleccionar</div></div>'
      + '<div class="user-item-lock" style="opacity:1;font-size:18px">›</div>'
      + '</button>';
  }
  grid.innerHTML = html;
}

// Modal con buscador para elegir el nombre del staff
function openStaffPicker(){
  ensureAllUserDefaults();
  modal(`
    <h3 style="margin-top:0">Seleccioná tu nombre</h3>
    <div class="field" style="margin:6px 0 10px">
      <input type="text" id="staffPickerSearch" placeholder="🔎 Buscar por nombre…" autocomplete="off" oninput="renderStaffPickerList()" />
    </div>
    <div id="staffPickerList" class="staff-picker-list"></div>
    <div class="btn-row" style="margin-top:10px"><button class="btn secondary" onclick="closeModal()">Cancelar</button></div>
  `);
  // Focus en buscador después de que el modal se haya renderizado
  setTimeout(()=>{ try{ document.getElementById('staffPickerSearch').focus(); }catch(e){} }, 100);
  renderStaffPickerList();
}
function renderStaffPickerList(){
  const list = document.getElementById('staffPickerList');
  if(!list) return;
  const q = (document.getElementById('staffPickerSearch')?.value||'').trim().toLowerCase();
  // Quita tildes para búsqueda
  const norm = s => (s||'').toString().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  const nq = norm(q);
  const staff = (state.staff||[]).slice().sort((a,b)=>String(a.name).localeCompare(String(b.name),'es'));
  const filtered = nq ? staff.filter(s=>norm(s.name).includes(nq) || norm(s.role||'').includes(nq)) : staff;
  if(filtered.length===0){
    list.innerHTML = '<div style="padding:14px;color:var(--muted);text-align:center;font-size:13px">Sin resultados para "'+q+'"</div>';
    return;
  }
  list.innerHTML = filtered.map(s=>{
    const initials = (s.name||'?').split(/\s+/).slice(0,2).map(w=>w[0]||'').join('').toUpperCase();
    const hasPin = s.pinHash ? '🔒' : '✨';
    return '<button type="button" class="staff-picker-row" onclick="closeModal();selectUser(\''+s.id+'\')">'
      + '<div class="user-item-avatar">'+initials+'</div>'
      + '<div style="flex:1;min-width:0;text-align:left"><div class="user-item-name">'+s.name+'</div><div class="user-item-role">'+(s.role||'')+'</div></div>'
      + '<div class="user-item-lock">'+hasPin+'</div>'
      + '</button>';
  }).join('');
}

async function selectAdmin(){
  // Primera vez: configurar PIN admin
  if(adminSetupNeeded()){
    const ok = await promptSetAdminPin();
    if(!ok) return;
  } else {
    const ok = await promptVerifyAdminPin();
    if(!ok) return;
  }
  state.currentUserId = ADMIN_USER_ID;
  state.isAdmin = true;
  const admin = getAdminVirtualUser();
  admin.activityLog.unshift({type:'login', text:'Inicio de sesión como Administrador', at:new Date().toISOString()});
  if(admin.activityLog.length>50) admin.activityLog = admin.activityLog.slice(0,50);
  save();
  hideUserPicker();
  updateInstitutionUI();
  updateAdminUI();
  updateWelcomeName();
  showHome();
  try{ updateEventBadge(); }catch(e){}
  try{ checkReminders(); }catch(e){}
}
function showUserPicker(){
  renderUserPicker();
  document.getElementById('userPicker').classList.remove('hidden');
}
function hideUserPicker(){
  document.getElementById('userPicker').classList.add('hidden');
}

async function selectUser(userId){
  const u = state.staff.find(s=>s.id===userId);
  if(!u) return;
  ensureUserDefaults(u);
  let ok;
  if(!u.pinHash){
    ok = await promptSetupUserPin(u);
  } else {
    ok = await promptVerifyUserPin(u);
  }
  if(!ok) return;
  state.currentUserId = userId;
  state.isAdmin = false; // siempre arranca en modo usuario
  logActivity('login', 'Inicio de sesión');
  save();
  hideUserPicker();
  updateInstitutionUI();
  updateAdminUI();
  updateWelcomeName();
  showHome();
  try{ updateEventBadge(); }catch(e){}
  try{ checkReminders(); }catch(e){}
  // Pedir permiso de notificaciones si nunca se preguntó
  try{
    if(notifSupported() && Notification.permission === 'default'){
      setTimeout(()=>{ try{ requestNotifPermission(); }catch(e){} }, 1500);
    }
  }catch(e){}
}

async function promptSetupUserPin(user){
  return new Promise(res=>{
    let firstPin = null;
    openPinPad({
      title:'👋 Hola '+user.name,
      sub:'Es tu primer ingreso. Definí un PIN de 4 dígitos.',
      maxLen:4,
      onComplete: async(pin)=>{
        if(!firstPin){
          firstPin = pin;
          openPinPad({
            title:'Confirmá tu PIN',
            sub:'Repetí los 4 dígitos.',
            maxLen:4,
            onComplete: async(pin2)=>{
              if(pin2 !== firstPin){
                pinError('No coinciden');
                firstPin = null;
                setTimeout(()=>res(promptSetupUserPin(user)), 500);
                return;
              }
              user.pinHash = await hashPIN(pin, user.id);
              save();
              closePinPad();
              toast && toast('PIN creado');
              res(true);
            },
            onCancel: ()=>res(false)
          });
        }
      },
      onCancel: ()=>res(false)
    });
  });
}
async function promptVerifyUserPin(user){
  return new Promise(res=>{
    let attempts = 0;
    openPinPad({
      title:user.name,
      sub:'Ingresá tu PIN de 4 dígitos',
      maxLen:4,
      onComplete: async(pin)=>{
        const h = await hashPIN(pin, user.id);
        if(h === user.pinHash){ closePinPad(); res(true); }
        else {
          attempts++;
          pinError(attempts>=3 ? 'Pedile al admin que te resetee el PIN' : 'PIN incorrecto');
        }
      },
      onCancel: ()=>res(false)
    });
  });
}

function updateWelcomeName(){
  const u = getCurrentUser();
  const el = document.getElementById('welcomeName');
  if(el) el.textContent = u ? u.name : '👋';
}

function logoutUser(){
  if(state){
    logActivity('logout', 'Cierre de sesión');
    state.currentUserId = null;
    state.isAdmin = false;
    save();
  }
  showUserPicker();
}

async function changeUserPIN(){
  const u = getCurrentUser();
  if(!u){ toast && toast('No hay usuario activo'); return; }
  const isAdmin = u.id === ADMIN_USER_ID;
  const ok = isAdmin ? await promptVerifyAdminPin() : await promptVerifyUserPin(u);
  if(!ok) return;
  return new Promise(res=>{
    let firstPin = null;
    openPinPad({
      title:'Nuevo PIN',
      sub:'Definí tu nuevo PIN de 4 dígitos.',
      maxLen:4,
      onComplete: async(pin)=>{
        if(!firstPin){
          firstPin = pin;
          openPinPad({
            title:'Confirmar nuevo PIN',
            sub:'Repetí los 4 dígitos.',
            maxLen:4,
            onComplete: async(pin2)=>{
              if(pin2 !== firstPin){ pinError('No coinciden'); firstPin = null; return; }
              if(isAdmin){
                state.adminPinHash = await hashPIN(pin, '__admin__');
              } else {
                u.pinHash = await hashPIN(pin, u.id);
              }
              save();
              closePinPad();
              toast && toast('PIN actualizado');
              res(true);
            },
            onCancel: ()=>res(false)
          });
        }
      },
      onCancel: ()=>res(false)
    });
  });
}

// --- Mi Panel ---
function renderMiPanel(){
  const u = getCurrentUser();
  if(!u){ logoutUser(); return; }
  ensureUserDefaults(u);
  const initials = (u.name||'?').split(/\s+/).slice(0,2).map(w=>w[0]||'').join('').toUpperCase();
  document.getElementById('miPanelAvatar').textContent = initials;
  document.getElementById('miPanelName').textContent = u.name;
  document.getElementById('miPanelRole').textContent = u.role || '—';

  // Stats
  const exchSent = (state.exchanges||[]).filter(e=>e.staffId===u.id).length;
  const vacApproved = (state.vacations||[]).filter(v=>v.staffId===u.id && v.status==='approved').length;
  const ranking = (state.staff||[]).slice().sort((a,b)=>(b.score||0)-(a.score||0));
  const myRank = ranking.findIndex(s=>s.id===u.id)+1;
  const coberturaRank = (state.staff||[]).slice().sort((a,b)=>(b.coberturaScore||0)-(a.coberturaScore||0));
  const myCovRank = coberturaRank.findIndex(s=>s.id===u.id)+1;
  document.getElementById('miStatGrid').innerHTML =
    '<div class="mi-stat"><div class="mi-stat-value">#'+(myRank||'—')+'</div><div class="mi-stat-label">Índice permanencia</div></div>'
    +'<div class="mi-stat"><div class="mi-stat-value">#'+(myCovRank||'—')+'</div><div class="mi-stat-label">Cobertura emerg.</div></div>'
    +'<div class="mi-stat"><div class="mi-stat-value">'+exchSent+'</div><div class="mi-stat-label">Intercambios publicados</div></div>'
    +'<div class="mi-stat"><div class="mi-stat-value">'+vacApproved+'</div><div class="mi-stat-label">Vacaciones aprobadas</div></div>';

  // Solicitudes activas
  const myExch = (state.exchanges||[]).filter(e=>e.staffId===u.id && e.status==='open');
  const myVacs = (state.vacations||[]).filter(v=>v.staffId===u.id && v.status==='pending');
  const sol = document.getElementById('miSolicitudes');
  if(myExch.length===0 && myVacs.length===0){
    sol.innerHTML = '<div class="empty" style="padding:14px"><span class="big" style="font-size:24px">📭</span>Sin solicitudes activas</div>';
  } else {
    let html = '';
    myExch.forEach(e=>{
      html += '<div class="mi-activity-item"><div class="mi-activity-icon">🔄</div><div class="mi-activity-text"><b>Intercambio</b> · '+e.type+' · '+formatDate(e.date)+'<div class="mi-activity-date">'+(e.kind==='swap'?'Pido cambio':'Cedo turno')+'</div></div></div>';
    });
    myVacs.forEach(v=>{
      html += '<div class="mi-activity-item"><div class="mi-activity-icon">🏖️</div><div class="mi-activity-text"><b>Vacaciones</b> · '+formatDate(v.from)+' → '+formatDate(v.to)+'<div class="mi-activity-date">Pendiente de aprobación</div></div></div>';
    });
    sol.innerHTML = html;
  }

  // Actividad reciente
  const log = (u.activityLog||[]).slice(0,10);
  const act = document.getElementById('miActividad');
  if(log.length===0){
    act.innerHTML = '<div class="empty" style="padding:14px"><span class="big" style="font-size:24px">🕘</span>Aún no hay actividad registrada</div>';
  } else {
    const icons = {login:'🔓', logout:'🔒', exchange_offered:'🔄', exchange_taken:'➡️', vacation_requested:'🏖️', vacation_approved:'✅', cobertura_taken:'🛡️', shift_added:'📅'};
    act.innerHTML = log.map(a=>{
      const ic = icons[a.type] || '•';
      const when = a.at ? new Date(a.at).toLocaleString('es-CL',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}) : '';
      return '<div class="mi-activity-item"><div class="mi-activity-icon">'+ic+'</div><div class="mi-activity-text">'+(a.text||a.type)+'<div class="mi-activity-date">'+when+'</div></div></div>';
    }).join('');
  }

  // Preferencias
  const prefs = u.preferences || {};
  document.getElementById('miPreferencias').innerHTML =
    '<div class="mi-pref-row"><div><div class="mi-pref-label">Notificaciones de novedades</div><div class="mi-pref-sub">Aviso cuando hay vacaciones aprobadas, nuevas ofertas, etc.</div></div>'
    +'<input type="checkbox" '+(prefs.notifications?'checked':'')+' onchange="setPref(\'notifications\',this.checked)" style="width:20px;height:20px;accent-color:var(--primary)"></div>'
    +'<div class="mi-pref-row"><div><div class="mi-pref-label">Ocultar mi nombre en ofertas</div><div class="mi-pref-sub">Tu nombre aparece como "Anónimo" en ofertas abiertas.</div></div>'
    +'<input type="checkbox" '+(prefs.hideOthers?'checked':'')+' onchange="setPref(\'hideOthers\',this.checked)" style="width:20px;height:20px;accent-color:var(--primary)"></div>';
}

function setPref(k,v){
  const u = getCurrentUser();
  if(!u) return;
  ensureUserDefaults(u);
  u.preferences[k] = v;
  save();
  toast && toast('Preferencia guardada');
}

async function boot(){
  // 1) Cargar el índice de instituciones (cacheado por SW)
  const idx = await loadInstitutionsIndex();
  const institutions = idx.institutions||[];

  // 2) Ver si ya hay institución elegida
  const saved = localStorage.getItem(INSTITUTION_LS_KEY);
  let chosen = saved && institutions.find(i=>i.id===saved);

  if(chosen){
    try{
      const cfg = await loadInstitutionConfig(chosen.id);
      migrateLegacyStateIfNeeded(chosen.id);
      applyInstitutionConfig(cfg);
      state = load();
      ensureAllUserDefaults();
      // Traer estado compartido del backend (si está configurado)
      await bootSync();
      save();
      updateInstitutionUI();

      // 3) Flujo de usuario: ¿hay sesión activa?
      if(state.currentUserId){
        const u = (state.currentUserId === ADMIN_USER_ID) ? getAdminVirtualUser() : state.staff.find(s=>s.id===state.currentUserId);
        if(u){
          updateAdminUI();
          updateWelcomeName();
          showHome();
          // Recordatorios del día y badge de eventos
          try{ updateEventBadge(); }catch(e){}
          try{ checkReminders(); }catch(e){}
          // Pedir permiso de notificaciones la primera vez tras login
          try{
            if(notifSupported() && Notification.permission === 'default'){
              setTimeout(()=>{ try{ requestNotifPermission(); }catch(e){} }, 1500);
            }
          }catch(e){}
          return;
        } else {
          state.currentUserId = null;
        }
      }
      // Sin sesión → mostrar user picker
      showUserPicker();
      return;
    }catch(e){
      console.error('Config inválida, mostrando selector institución',e);
    }
  }

  // 4) Mostrar selector de institución
  renderInstitutionPicker(institutions);
  document.getElementById('institutionPicker').classList.remove('hidden');
}

// INIT — boot async (selecciona institución y carga su config)
boot();
