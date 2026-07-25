
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
  seedVersion: 9,
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
    sheetCharts: [], // [{key, title, items:[{n,v}]}] — un gráfico por hoja del Excel
    hidden: {},      // {sheetKey:true} para ocultar gráficos puntuales
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
    // Migración v9: Canepa deja el servicio — quitarlo del staff y de sus registros
    if((merged.seedVersion||1) < 9){
      merged.staff = (merged.staff||[]).filter(s=>s.id!=='s_canepa' && (s.name||'').toLowerCase()!=='canepa');
      merged.shifts = (merged.shifts||[]).filter(s=>s.staffId!=='s_canepa');
      merged.exchanges = (merged.exchanges||[]).filter(e=>e.staffId!=='s_canepa');
      merged.vacations = (merged.vacations||[]).filter(v=>v.staffId!=='s_canepa');
      merged.seedVersion = 9;
    }
    return merged;
  }catch(e){return JSON.parse(JSON.stringify(DEFAULT_STATE));}
}
function save(){
  // Protegido: si el estado excede la cuota de localStorage (p. ej. un PDF
  // grande en Base64), NO lanzamos excepción —que rompía el guardado y la
  // sincronización—; avisamos y seguimos para no perder el resto del estado.
  try{
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  }catch(e){
    try{ toast('⚠️ No se pudo guardar local (¿archivo muy grande?). Para protocolos permanentes usa GitHub.'); }catch(_){}
  }
  // Marca el "timestamp de cambio local" para que bootSync sepa si lo nuestro
  // es MÁS NUEVO que el remoto. Sin esto, una recarga rápida (antes de que
  // el debounce de 1.5s dispare el push) sobreescribía los cambios locales
  // con el estado remoto desactualizado y se perdían (protocolos, eventos,
  // puntajes editados, etc.).
  if(!_isApplyingRemote){
    try{ localStorage.setItem(LS_KEY + '_localTs', new Date().toISOString()); }catch(e){}
    _pendingPush = true;
  }
  try{ updateHomeBadges(); }catch(e){}
  try{ updateAgendAdminNotice(); }catch(e){}
  scheduleSyncPush();
}
// Igual que save() pero NO marca "dirty" ni timestamp local. Sirve para
// persistir lo que vino del remoto/migraciones durante el boot, sin
// hacer creer al próximo bootSync que el local es más nuevo.
function saveRaw(){
  try{ localStorage.setItem(LS_KEY, JSON.stringify(state)); }catch(e){}
}

// ============================================================
// SYNC con backend (Cloudflare Worker + KV)
// ============================================================
const BACKEND_TOKEN_LS_KEY = 'appnesthesia_backend_token';
// Campos que NO se sincronizan (son personales/por-dispositivo).
// IMPORTANTE: adminPinHash SÍ se sincroniza → una vez que el admin configura
// su clave, queda guardada en la nube y ningún otro dispositivo puede
// volver a configurar el modo administrador.
const LOCAL_ONLY_KEYS = new Set(['isAdmin','currentUserId','notifShown']);
let _syncTimer = null;
let _syncStatus = 'idle';
// Caché de PINs vistos en la nube (para nunca borrarlos en pushes sin fetch previo)
const _remotePinCache = { staff: {}, admin: null };
// ¿Tiene este miembro un REINICIO de PIN (del admin) más nuevo que su último
// PIN registrado? Si es así, NO hay que re-inyectarle el pinHash viejo desde
// ningún caché: la persona debe crear un PIN nuevo en su próximo ingreso.
function _pinResetActive(s){
  return !!(s && (s.pinResetAt||0) > (s.pinSetAt||0));
}
function _updateRemotePinCache(remote){
  if(!remote || remote._empty) return;
  (remote.staff||[]).forEach(s=>{ if(s && s.id && s.pinHash) _remotePinCache.staff[s.id] = s.pinHash; });
  if(remote.adminPinHash) _remotePinCache.admin = remote.adminPinHash;
}
function _mergePinsFromCache(payload){
  if(Array.isArray(payload.staff)){
    payload.staff = payload.staff.map(s=>
      (s && s.id && !s.pinHash && !_pinResetActive(s) && _remotePinCache.staff[s.id]) ? {...s, pinHash: _remotePinCache.staff[s.id]} : s);
  }
  if(!payload.adminPinHash && _remotePinCache.admin) payload.adminPinHash = _remotePinCache.admin;
  return payload;
}
let _lastRemoteUpdatedAt = null;
let _isApplyingRemote = false;
let _pendingPush = false;       // hay cambios locales no enviados aún
let _flushHandlersBound = false; // para no enganchar 2 veces

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
function getBackendToken(){
  // 1) Token guardado en este dispositivo (lo ingresa el admin manualmente)
  const local = localStorage.getItem(BACKEND_TOKEN_LS_KEY);
  if(local) return local;
  // 2) Token publicado en configs/andes.json → así TODOS los usuarios
  //    (no solo el admin) pueden guardar sus solicitudes en la nube.
  if(INSTITUTION && INSTITUTION.backendToken) return String(INSTITUTION.backendToken);
  return '';
}
function setBackendToken(t){
  if(t) localStorage.setItem(BACKEND_TOKEN_LS_KEY, t);
  else localStorage.removeItem(BACKEND_TOKEN_LS_KEY);
}
// Opciones para los GET de estado: mandan el token (admin o usuario) para que
// el backend pueda exigir autenticación de lectura (flag REQUIRE_READ_AUTH).
// Inofensivo si el backend aún tiene el GET abierto.
function _stateGetOpts(){
  const opts = { cache:'no-store' };
  try{ const t = getBackendToken(); if(t) opts.headers = { 'Authorization':'Bearer '+t }; }catch(e){}
  return opts;
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
  // SOLO el administrador ve el indicador de sincronización y la config del token.
  // A los usuarios normales NUNCA se les muestra (es una herramienta técnica).
  const isAdmin = state && state.isAdmin;
  if(!isAdmin || !label){ el.style.display = 'none'; return; }
  el.style.display = '';
  el.innerHTML = `<span class="sync-dot ${extra}" style="background:${color}"></span><span class="sync-lbl">${label}</span>`;
}
function _setSyncStatus(s){ _syncStatus = s; _renderSyncIndicator(); try{ _renderPendingBadge(); }catch(e){} }

// Campos PRIVADOS por dispositivo de cada staff que NUNCA suben a la nube
// (preferences/activityLog = privados por dispositivo)
// NOTA: pinHash YA NO está aquí — se sincroniza en la nube para que la clave
// configurada en un dispositivo sea requerida en todos los demás.
const STAFF_DEVICE_PRIVATE_KEYS = ['preferences', 'activityLog'];

function _stripDevicePrivateStaff(staffArr){
  if(!Array.isArray(staffArr)) return staffArr;
  return staffArr.map(s=>{
    if(!s || typeof s !== 'object') return s;
    const copy = {...s};
    STAFF_DEVICE_PRIVATE_KEYS.forEach(k => { delete copy[k]; });
    return copy;
  });
}

// Toma un array remoto de staff (sin datos privados) y, para cada uno,
// pega encima las preferences/activityLog que estén GUARDADOS LOCAL
// para ese mismo id. Así las preferencias del dispositivo no se pierden.
// pinHash: si el remoto ya tiene PIN, se respeta (nube gana).
// Si el remoto no tiene PIN pero el local sí, se mantiene el local
// para que suba al siguiente sync (primer dispositivo en configurarlo).
function _mergeStaffPreservingDeviceLocal(remoteStaff, localStaff){
  const localById = {};
  (localStaff||[]).forEach(s=>{ if(s && s.id) localById[s.id] = s; });
  return (remoteStaff||[]).map(rs=>{
    if(!rs || !rs.id) return rs;
    const ls = localById[rs.id];
    if(!ls) return rs;
    const merged = {...rs};
    STAFF_DEVICE_PRIVATE_KEYS.forEach(k => {
      if(ls[k] !== undefined) merged[k] = ls[k];
    });
    // pinHash: si el remoto no tiene PIN pero el local sí, preservamos el local
    // para que el próximo push lo suba a la nube… SALVO que el remoto traiga
    // un REINICIO del admin más nuevo que el PIN local: en ese caso el PIN
    // local también se borra (la persona creará uno nuevo al entrar).
    if(!merged.pinHash && ls && ls.pinHash){
      if((rs.pinResetAt||0) > (ls.pinSetAt||0)){
        merged.pinHash = null; // reinicio del admin: gana sobre el PIN local
      } else {
        merged.pinHash = ls.pinHash;
        if(ls.pinSetAt) merged.pinSetAt = ls.pinSetAt;
      }
    }
    return merged;
  });
}

function _extractSharedState(){
  const out = {};
  Object.keys(state).forEach(k=>{ if(!LOCAL_ONLY_KEYS.has(k)) out[k] = state[k]; });
  // Quitar SIEMPRE los campos privados por dispositivo del staff
  if(Array.isArray(out.staff)) out.staff = _stripDevicePrivateStaff(out.staff);
  // El adminUser también tiene preferences/activityLog locales — strippeamos
  if(out.adminUser && typeof out.adminUser === 'object'){
    const a = {...out.adminUser};
    STAFF_DEVICE_PRIVATE_KEYS.forEach(k => { delete a[k]; });
    out.adminUser = a;
  }
  return out;
}
function _applyRemoteState(remote){
  if(!remote || remote._empty) return false;
  _isApplyingRemote = true;
  try{
    Object.keys(remote).forEach(k=>{
      if(LOCAL_ONLY_KEYS.has(k)) return;
      if(k.startsWith('_')) return;
      // Caso especial: para 'staff' fusionamos preservando pinHash/preferences/activityLog locales
      if(k === 'staff' && Array.isArray(remote[k])){
        // No reintroducir staff dado de baja si un dispositivo desactualizado lo empuja
        const remoteStaff = remote[k].filter(s=>s && s.id!=='s_canepa' && (s.name||'').toLowerCase()!=='canepa');
        state[k] = _mergeStaffPreservingDeviceLocal(remoteStaff, state[k]||[]);
        return;
      }
      // Caso especial: adminUser tiene preferences/activityLog que son del dispositivo
      if(k === 'adminUser' && remote[k] && typeof remote[k] === 'object'){
        const local = state.adminUser || {};
        const merged = {...remote[k]};
        STAFF_DEVICE_PRIVATE_KEYS.forEach(kk => {
          if(local[kk] !== undefined) merged[kk] = local[kk];
        });
        state[k] = merged;
        return;
      }
      state[k] = remote[k];
    });
    if(remote._updatedAt) _lastRemoteUpdatedAt = remote._updatedAt;
    localStorage.setItem(LS_KEY, JSON.stringify(state));
    try{ updateHomeBadges(); }catch(e){}
  try{ updateAgendAdminNotice(); }catch(e){}
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
    // Timeout de 8 s: si el Worker está lento, la app sigue con lo local en
    // vez de quedarse colgada esperando (el sync periódico reintenta después).
    const opts = _stateGetOpts();
    try{ if(typeof AbortSignal!=='undefined' && AbortSignal.timeout) opts.signal = AbortSignal.timeout(8000); }catch(e){}
    const r = await fetch(base + '/api/state/' + encodeURIComponent(INSTITUTION.id), opts);
    if(!r.ok){ _setSyncStatus('error'); return null; }
    const data = await r.json();
    _updateRemotePinCache(data);
    _setSyncStatus('synced');
    return data;
  }catch(e){
    console.warn('fetchRemoteState', e);
    _setSyncStatus('offline');
    return null;
  }
}

// Fusiona dos listas de objetos por su id. Gana la versión con updatedAt
// (o createdAt) más reciente. Así dos personas pueden agregar/editar
// solicitudes "al mismo tiempo" sin pisarse entre ellas.
function _mergeById(remoteArr, localArr){
  const map = {};
  (remoteArr||[]).forEach(it=>{ if(it && it.id) map[it.id] = it; });
  (localArr||[]).forEach(it=>{
    if(!it || !it.id) return;
    const ex = map[it.id];
    if(!ex){ map[it.id] = it; return; }
    const tLocal  = it.updatedAt || it.createdAt || '';
    const tRemote = ex.updatedAt || ex.createdAt || '';
    if(tLocal >= tRemote) map[it.id] = it;
  });
  return Object.values(map);
}

async function pushRemoteState(){
  if(_isApplyingRemote) return false;
  const base = getBackendURL();
  if(!base || !INSTITUTION) return false;
  const token = getBackendToken();
  if(!token){
    // Sin token: marcamos el estado de sync (indicador silencioso, solo admin),
    // pero NO abrimos el modal automáticamente. El admin puede configurarlo a
    // mano desde el menú (Ayuda → Configuración de conexión) si hiciera falta.
    _setSyncStatus('unauthorized');
    return false;
  }
  try{
    _setSyncStatus('syncing');

    // 1) Traer el estado remoto más reciente para no pisar cambios de otros.
    let remote = null;
    try{
      const rr = await fetch(base + '/api/state/' + encodeURIComponent(INSTITUTION.id), _stateGetOpts());
      if(rr.ok) remote = await rr.json();
    }catch(e){ /* sin conexión: se maneja abajo */ }

    // SEGURIDAD CRÍTICA (anti-pérdida de datos): si NO pudimos leer el estado
    // remoto, NO escribimos. Un POST es "reemplazo completo": sobrescribir a
    // ciegas con lo local borraría las solicitudes que otros enviaron y que
    // este dispositivo todavía no tiene. Mejor reintentar más tarde.
    // (Aplica a admin y a usuarios por igual.)
    if(!remote){
      _pendingPush = true;
      _setSyncStatus('offline');
      return false;
    }

    // 2) Armar el payload a enviar.
    let payload;
    const isAdmin = state && state.isAdmin;
    if(isAdmin){
      // El admin es la autoridad: manda todo el estado, pero igual fusiona
      // las colecciones para no perder solicitudes que otros cargaron mientras.
      payload = _extractSharedState();
      if(remote && !remote._empty){
        payload.vacations = _mergeById(remote.vacations, payload.vacations);
        payload.exchanges = _mergeById(remote.exchanges, payload.exchanges);
      }
    } else {
      // Usuario normal: NO debe pisar datos del admin (staff, índices, etc.).
      if(!remote){
        // No se pudo leer el estado remoto → no arriesgamos. Reintenta luego.
        _setSyncStatus('offline');
        return false;
      }
      if(remote._empty){
        payload = _extractSharedState();
      } else {
        payload = {};
        Object.keys(remote).forEach(k=>{ if(!k.startsWith('_')) payload[k] = remote[k]; });
      }
      // Solo superpone SUS colecciones: vacaciones e intercambios.
      payload.vacations = _mergeById(remote.vacations, state.vacations);
      payload.exchanges = _mergeById(remote.exchanges, state.exchanges);
    }

    // PINs: NUNCA borrar un pinHash que ya está guardado en la nube.
    // (El push del admin manda su staff local; si su dispositivo aún no
    // recibió el PIN que otro usuario subió, lo borraría sin esto.)
    if(remote) _updateRemotePinCache(remote);
    if(remote && !remote._empty){
      if(Array.isArray(payload.staff) && Array.isArray(remote.staff)){
        const remotePinById = {};
        remote.staff.forEach(s=>{ if(s && s.id && s.pinHash) remotePinById[s.id] = s.pinHash; });
        payload.staff = payload.staff.map(s=>
          (s && s.id && !s.pinHash && !_pinResetActive(s) && remotePinById[s.id]) ? {...s, pinHash: remotePinById[s.id]} : s);
      }
      if(!payload.adminPinHash && remote.adminPinHash) payload.adminPinHash = remote.adminPinHash;
    }
    _mergePinsFromCache(payload);

    // Defensa extra: asegurar que NUNCA se suben campos privados por dispositivo
    // del staff (preferences, activityLog) — quedan solo en cada teléfono.
    if(Array.isArray(payload.staff)) payload.staff = _stripDevicePrivateStaff(payload.staff);
    if(payload.adminUser && typeof payload.adminUser === 'object'){
      const a = {...payload.adminUser};
      STAFF_DEVICE_PRIVATE_KEYS.forEach(k => { delete a[k]; });
      payload.adminUser = a;
    }

    // 3) Guardar en la nube.
    const r = await fetch(base + '/api/state/' + encodeURIComponent(INSTITUTION.id), {
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},
      body: JSON.stringify(payload)
    });
    if(r.status === 401){
      // Token rechazado por la nube: indicador silencioso, sin modal automático.
      _setSyncStatus('unauthorized');
      return false;
    }
    if(!r.ok){ _setSyncStatus('error'); return false; }
    const data = await r.json().catch(()=>({}));
    if(data && data._updatedAt){
      _lastRemoteUpdatedAt = data._updatedAt;
      // Alinea el "timestamp local" al que devolvió el servidor: ya
      // estamos sincronizados, así que en el próximo boot NO se debe
      // considerar que lo local es más nuevo que lo remoto.
      try{ localStorage.setItem(LS_KEY + '_localTs', data._updatedAt); }catch(e){}
    }
    _pendingPush = false; // push exitoso → ya no hay cambios pendientes

    // 4) Reflejar las colecciones fusionadas en la copia local + pantalla.
    _isApplyingRemote = true;
    try{
      if(payload.vacations) state.vacations = payload.vacations;
      if(payload.exchanges) state.exchanges = payload.exchanges;
      localStorage.setItem(LS_KEY, JSON.stringify(state));
    } finally { _isApplyingRemote = false; }
    try{
      const active = document.querySelector('.view.active');
      if(active && active.id === 'view-vacaciones') renderVacations();
      if(active && active.id === 'view-intercambios') renderExchanges();
    }catch(e){}

    _setSyncStatus('synced');
    return true;
  }catch(e){
    console.warn('pushRemoteState', e);
    _setSyncStatus('offline');
    return false;
  }
}

// Flush sincrónico de cambios pendientes. Lo llamamos cuando la página se
// va a cerrar / pasa a background, así no perdemos ediciones hechas dentro
// del debounce de 1.5s. Usa fetch keepalive (equivalente moderno de
// sendBeacon, pero permite Authorization header).
function _flushSyncNow(){
  if(!_pendingPush) return;
  if(_isApplyingRemote) return;
  const base = getBackendURL();
  if(!base || !INSTITUTION) return;
  const token = getBackendToken();
  if(!token) return;
  // Cancelar el timer pendiente: lo estamos forzando ahora.
  if(_syncTimer){ clearTimeout(_syncTimer); _syncTimer = null; }
  try{
    const isAdmin = state && state.isAdmin;
    let payload;
    if(isAdmin){
      // Admin: manda el estado completo. Es seguro porque solo el admin
      // puede tocar protocolos/eventos/staff desde la UI.
      payload = _extractSharedState();
    } else {
      // Usuario normal: nada que flushear por esta vía (ver abajo).
      payload = {};
    }
    // ANTI-PISADO: en el flush de cierre NO leemos el estado remoto, así que
    // mandar las colecciones de usuario las haría REEMPLAZAR lo guardado y
    // podría borrar envíos de otros. Por eso NO se mandan aquí: vacaciones e
    // intercambios se suben con confirmación en su propio guardado
    // (saveVacation / intercambios) y se reintegran con merge en el próximo
    // push regular al reabrir. El flush solo sirve para el resto del estado
    // del admin (staff, eventos, etc.).
    delete payload.vacations;
    delete payload.exchanges;
    if(!payload || Object.keys(payload).length === 0){ _pendingPush = false; return; }
    // Nunca borrar PINs ya registrados en la nube (caché de la última lectura)
    _mergePinsFromCache(payload);
    if(Array.isArray(payload.staff)) payload.staff = _stripDevicePrivateStaff(payload.staff);
    if(payload.adminUser && typeof payload.adminUser === 'object'){
      const a = {...payload.adminUser};
      STAFF_DEVICE_PRIVATE_KEYS.forEach(k => { delete a[k]; });
      payload.adminUser = a;
    }
    // keepalive: permite que la request siga viva aunque la página se cierre.
    // IMPORTANTE: usamos /patch (merge superficial en el backend) en lugar del
    // replace completo. Un usuario normal solo manda {vacations, exchanges}; con
    // un POST replace eso BORRARÍA el resto del estado en la nube (roster,
    // protocolos, eventos, PINs). Con /patch solo se fusionan esos campos y el
    // resto del estado guardado queda intacto.
    fetch(base + '/api/state/' + encodeURIComponent(INSTITUTION.id) + '/patch', {
      method: 'POST',
      keepalive: true,
      headers: {'Content-Type':'application/json', 'Authorization':'Bearer '+token},
      body: JSON.stringify(payload)
    }).catch(()=>{ /* mejor esfuerzo */ });
    // Optimista: marcamos como flusheado (si falla, lo retomamos al reabrir).
    _pendingPush = false;
  }catch(e){ /* mejor esfuerzo */ }
}

// Sube SOLO el pinHash de un staff al estado remoto, sin tocar nada más.
// Resuelve el problema de que los usuarios no-admin solo pueden subir
// vacaciones/intercambios en el push normal, pero necesitan subir su PIN.
// Hace un read-modify-write quirúrgico: lee el estado remoto, actualiza
// solo ese campo, y vuelve a subir — sin pisar datos del admin.
async function _pushMyPinHash(staffId, pinHash) {
  const base = getBackendURL();
  if(!base || !INSTITUTION) return;
  const token = getBackendToken();
  if(!token) return;
  try {
    const rr = await fetch(base + '/api/state/' + encodeURIComponent(INSTITUTION.id), {cache:'no-store', headers:{'Authorization':'Bearer '+token}});
    if(!rr.ok) return;
    const remote = await rr.json();
    if(!remote || remote._empty) return;
    const staffArr = Array.isArray(remote.staff)
      ? remote.staff.map(s => s.id === staffId ? {...s, pinHash, pinSetAt: Date.now()} : s)
      : [];
    const payload = {...remote, staff: staffArr};
    delete payload._updatedAt;
    delete payload._empty;
    await fetch(base + '/api/state/' + encodeURIComponent(INSTITUTION.id), {
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},
      body: JSON.stringify(payload)
    });
  } catch(e) { /* mejor esfuerzo — PIN queda guardado localmente */ }
}

function _bindFlushHandlers(){
  if(_flushHandlersBound) return;
  _flushHandlersBound = true;
  try{
    window.addEventListener('pagehide', _flushSyncNow);
    window.addEventListener('beforeunload', _flushSyncNow);
    document.addEventListener('visibilitychange', ()=>{
      if(document.visibilityState === 'hidden') _flushSyncNow();
    });
  }catch(e){}
  _startSyncRetry();
}

// ===== Reintento activo de sincronización + aviso "sin sincronizar" =====
// Si un envío del estado principal (vacaciones, intercambios, decisiones del
// admin) no llegó a la nube, se reintenta solo: cada 45 s, al recuperar
// conexión, y al volver a primer plano. Además se muestra un aviso tocable.
let _syncRetryTimer = null;
function _startSyncRetry(){
  if(_syncRetryTimer) return;
  _syncRetryTimer = setInterval(_retryPendingSync, 45000);
  try{ window.addEventListener('online', _retryPendingSync); }catch(e){}
  try{
    document.addEventListener('visibilitychange', ()=>{
      if(document.visibilityState === 'visible') _retryPendingSync();
    });
  }catch(e){}
}
function _retryPendingSync(){
  try{
    if(_pendingPush && getBackendURL() && navigator.onLine !== false && !_isApplyingRemote){
      pushRemoteState().then(()=>{ try{ _renderPendingBadge(); }catch(e){} }).catch(()=>{});
    }
  }catch(e){}
  try{ _renderPendingBadge(); }catch(e){}
}
function _renderPendingBadge(){
  // Solo se muestra si hay cambios pendientes Y el último intento de sync tuvo
  // problema (sin conexión / error / token). Durante un sync normal y exitoso
  // NO aparece, para no molestar.
  const problema = (_syncStatus === 'offline' || _syncStatus === 'error' || _syncStatus === 'unauthorized' || _syncStatus === 'disabled');
  const show = !!_pendingPush && !!getBackendURL() && problema;
  let b = document.getElementById('pendingSyncBadge');
  if(!b){
    if(!show) return;
    b = document.createElement('div');
    b.id = 'pendingSyncBadge';
    b.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:max(14px,env(safe-area-inset-bottom));z-index:99999;background:#f59e0b;color:#fff;font:600 12.5px/1.2 -apple-system,system-ui,sans-serif;padding:9px 15px;border-radius:999px;box-shadow:0 4px 16px rgba(0,0,0,.2);display:flex;align-items:center;gap:7px;cursor:pointer;max-width:92vw;text-align:center';
    b.textContent = '⏳ Cambios sin sincronizar — toca para reintentar';
    b.onclick = ()=>{ b.textContent = '⏳ Reintentando…'; _retryPendingSync(); };
    document.body.appendChild(b);
  }
  if(show){ b.style.display = 'flex'; if(b.textContent.indexOf('Reintentando')<0) b.textContent='⏳ Cambios sin sincronizar — toca para reintentar'; }
  else { b.style.display = 'none'; }
}

function scheduleSyncPush(){
  if(_isApplyingRemote) return;
  if(_syncTimer) clearTimeout(_syncTimer);
  _syncTimer = setTimeout(()=>{ _syncTimer = null; pushRemoteState(); }, 1500);
}

// ===== Parche anti-concurrencia: VERIFICAR tras enviar + REINTENTAR =====
// El almacenamiento (KV) no es atómico: si dos personas envían en el mismo
// instante, una escritura puede pisar a la otra aunque ambas respondan 200.
// Para que NADA se pierda: tras empujar, releemos la nube y confirmamos que
// nuestro dato quedó; si no, reintentamos (con espera aleatoria para no volver
// a chocar). No es perfecto como Durable Objects, pero reduce la pérdida casi a
// cero en la práctica.
function _sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }
async function _getMainCloud(){
  try{
    const base = getBackendURL(); if(!base || !INSTITUTION) return null;
    const r = await fetch(base + '/api/state/' + encodeURIComponent(INSTITUTION.id) + '?cb=' + Date.now(), _stateGetOpts());
    if(!r.ok) return null;
    return await r.json();
  }catch(e){ return null; }
}
// predicate(cloudState) → true si nuestro dato quedó bien guardado en la nube.
async function _pushMainVerified(predicate, tries){
  tries = tries || 6;
  let confirmed = false;
  for(let i=0; i<tries; i++){
    let ok = false;
    try{ ok = await pushRemoteState(); }catch(e){ ok = false; }
    if(ok){
      const cloud = await _getMainCloud();
      try{ if(cloud && predicate(cloud)){ confirmed = true; } }catch(e){}
    }
    // Aunque ya esté confirmado, hacemos un par de pasadas más: si una escritura
    // concurrente lo pisó DESPUÉS de confirmar, lo detectamos y reponemos.
    if(confirmed && i >= 2){
      const c2 = await _getMainCloud();
      try{ if(c2 && predicate(c2)) return true; }catch(e){}
    }
    await _sleep(300 + Math.floor(Math.random()*900)); // jitter anti-colisión
  }
  const c = await _getMainCloud();
  try{ return !!(c && predicate(c)); }catch(e){ return false; }
}
// Igual, para el agendamiento (estado envuelto en {data:{sala:{fecha:[...]}}}).
async function _agendSyncVerified(salaId, dateStr, reqId, tries){
  tries = tries || 4;
  for(let i=0; i<tries; i++){
    let ok = false;
    try{ ok = await agendSyncNow(); }catch(e){ ok = false; }
    if(ok){
      try{
        const base = getBackendURL(); const id = _agendRemoteId();
        const r = await fetch(base + '/api/state/' + encodeURIComponent(id) + '?cb=' + Date.now(), _stateGetOpts());
        if(r.ok){
          const j = await r.json(); const d = (j && j.data) || {};
          const arr = (d[salaId] && d[salaId][dateStr]) || [];
          if(arr.some(x => x && x.id === reqId)) return true;
        }
      }catch(e){}
    }
    await _sleep(250 + Math.floor(Math.random()*600));
  }
  return false;
}

async function bootSync(){
  const base = getBackendURL();
  if(!base){ _setSyncStatus('disabled'); return; }
  const remote = await fetchRemoteState();
  if(remote && !remote._empty){
    // ¿Lo local es más nuevo que lo remoto? Esto ocurre cuando el usuario
    // editó algo y cerró la app antes de que el debounce de 1.5s pudiera
    // empujar al backend. En ese caso, NO pisamos lo local con lo remoto.
    // Pusheamos lo local primero (que es la versión "buena") y dejamos el
    // estado local intacto.
    let localTs = '';
    try{ localTs = localStorage.getItem(LS_KEY + '_localTs') || ''; }catch(e){}
    const remoteTs = remote._updatedAt || '';
    const localIsNewer = localTs && (!remoteTs || localTs > remoteTs);
    if(localIsNewer){
      console.log('[bootSync] local('+localTs+') > remote('+remoteTs+') → pusheando local primero');
      _pendingPush = true;
      // pushRemoteState fusiona vacations/exchanges con remote internamente
      // y, para admin, envía el estado local completo.
      try{ await pushRemoteState(); }catch(e){ console.warn('bootSync push falló', e); }
    } else {
      _applyRemoteState(remote);
    }
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
  // Herramienta exclusiva del administrador. Un usuario normal nunca debe ver
  // ni el token ni la URL del backend.
  if(!(state && state.isAdmin)) return;
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
        : `<b>⚠️ No hay backend configurado.</b> Sin esto, los cambios solo viven en este dispositivo. Configura la URL del Worker abajo.`}
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
    const r = await fetch(url + '/api/state/' + encodeURIComponent(INSTITUTION.id), _stateGetOpts());
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
  // Actualizar badges de notificación en la home (vacaciones / intercambios)
  try{ updateHomeBadges(); }catch(e){}
  try{ updateAgendAdminNotice(); }catch(e){}
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
  if(name==='coagulacion'){ renderCoagulacion(); try{ renderASRANeuraxial('coag'); }catch(e){} }
  if(name==='regional'){ _regSel=null; renderRegional(); try{ renderASRANeuraxial('reg'); }catch(e){} }
  if(name==='intercambios') renderExchanges();
  if(name==='vacaciones') renderVacations();
  if(name==='estadisticas') renderStats();
  if(name==='equipo') renderTeam();
  if(name==='protocolos') renderProtocols();
  if(name==='mipanel') renderMiPanel();
  if(name==='eventos') renderEventos();
  if(name==='home'){ updateEventBadge(); try{ updateAgendAdminNotice(); }catch(e){} try{ updatePushBtn(); }catch(e){} }
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
  // Activar admin: requiere PIN (revisando primero si ya existe uno en la nube)
  if(adminSetupNeeded()){
    try{ await _syncAdminPinFromCloud(); }catch(e){}
  }
  if(adminSetupNeeded()){
    const ok = await promptSetAdminPin();
    if(!ok) return;
  }
  const ok = await promptVerifyAdminPin();
  if(!ok) return;
  state.isAdmin = true;
  save(); updateAdminUI();
  toast && toast('Modo admin activado');
  try{ checkAgendNewForAdmin(); startAgendAdminPolling(); }catch(e){}
  try{ icCheckNewForAdmin(); startIcAdminPolling(); }catch(e){}
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
  try{ updatePushBtn(); }catch(e){}
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
      <div class="help">Si lo desmarcas, los turnos nuevos se agregan a los existentes.</div>
    </div>
    <div class="btn-row">
      <button class="btn accent" onclick="saveSource()">Guardar y sincronizar</button>
      ${cur.url?`<button class="btn warn" onclick="disconnectSource()">Desconectar</button>`:''}
      <button class="btn secondary" onclick="closeModal()">Cancelar</button>
    </div>
    <div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border);font-size:12px;color:var(--muted)">
      <b>¿Cómo obtengo el enlace?</b><br>
      <b>Google Sheets:</b> abre tu hoja → Archivo → Compartir → Publicar en la web → Hoja específica → CSV → copiar enlace.<br>
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
        // Conservar PIN y datos personales del usuario al restaurar el listado
        pinHash: o.pinHash || null,
        preferences: o.preferences, activityLog: o.activityLog,
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
    chips.push(`<span class="chip gray">Cumpl. ${cumplimientoLabel(s.cumplimientoJornadas)}</span>`);
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
    chips.push(`<span class="chip gray">Residencia: ${residenciaLabel(s.residenciaAnios)}</span>`);
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
async function saveExch(){
  const _now = new Date().toISOString();
  const e = {
    id:'e'+Date.now(),
    kind:document.getElementById('ex_kind').value,
    staffId:document.getElementById('ex_staff').value,
    offeredBy:'self',
    date:document.getElementById('ex_date').value,
    type:document.getElementById('ex_type').value,
    note:document.getElementById('ex_note').value,
    status:'open',
    createdAt:_now,
    updatedAt:_now
  };
  if(!e.date){toast('Falta la fecha');return;}
  // Auto-vincular al usuario logueado
  const cu = getCurrentUser ? getCurrentUser() : null;
  if(cu){ e.staffId = cu.id; e.offeredBy = cu.id; }
  state.exchanges.unshift(e);
  if(typeof logActivity==='function') logActivity('exchange_offered', 'Publicaste '+(e.kind==='swap'?'cambio':'cesión')+' · '+e.type+' · '+formatDate(e.date));
  save(); closeModal(); renderExchanges();
  await _confirmSharedPush('Oferta publicada', 'la oferta', c => (c.exchanges||[]).some(x => x && x.id === e.id));
}
async function takeExch(id){
  const cu = getCurrentUser ? getCurrentUser() : null;
  const taker = cu ? cu.name : prompt('Tu nombre:');
  if(!taker) return;
  const e = state.exchanges.find(x=>x.id===id);
  if(!e) return;
  e.status='taken'; e.takenByName=taker; e.takenAt=new Date().toISOString();
  e.updatedAt=new Date().toISOString();
  if(cu) e.takenById = cu.id;
  if(typeof logActivity==='function') logActivity('exchange_taken', 'Tomaste un turno · '+e.type+' · '+formatDate(e.date));
  save(); renderExchanges();
  await _confirmSharedPush('Turno tomado. Avisa al colega.', 'el cambio', c => { const x=(c.exchanges||[]).find(y=>y&&y.id===id); return !!x && x.status==='taken'; });
}
// Empuja el estado compartido y CONFIRMA: avisa "ok" solo si llegó a la nube;
// si no, deja claro que quedó local y se reintentará. (Para intercambios.)
async function _confirmSharedPush(okMsg, queCosa, verifyPredicate){
  const base = getBackendURL();
  if(!base){ toast(okMsg + ' (solo en este dispositivo)'); return; }
  toast('Sincronizando…');
  if(typeof _syncTimer !== 'undefined' && _syncTimer){ clearTimeout(_syncTimer); _syncTimer = null; }
  let ok = false;
  // Si se da un verificador, empuja Y confirma en la nube (reintentando ante
  // colisión); si no, push simple.
  try{ ok = verifyPredicate ? await _pushMainVerified(verifyPredicate) : await pushRemoteState(); }catch(e){ ok = false; }
  toast(ok ? ('✅ ' + okMsg) : ('⚠️ Guardado en este equipo, pero NO se pudo enviar ' + queCosa + ' a la nube. Se reintentará al reabrir.'));
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
  let items = (state.vacations || []).filter(v=>!v.deleted);
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
        ${v.coberturaPedCv?`<span class="chip ${v.coberturaPedCv==='si'?'green':(v.coberturaPedCv==='no'?'red':'gray')}">Ped/CV: ${ {si:'Sí',no:'No',na:'No aplica'}[v.coberturaPedCv] }</span>`:''}
      </div>
      ${v.notes?`<div class="what" style="font-style:italic;color:var(--muted)">"${v.notes}"</div>`:''}
      ${v.adminNote?`<div class="what" style="font-size:12px;background:var(--tint1);padding:6px 8px;border-radius:6px;margin-top:4px"><b>Nota del admin:</b> ${v.adminNote}</div>`:''}
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
  v = v || {id:'v'+Date.now(), staffId:state.staff[0]?.id||'', from:'', to:'', resolved:[], pending:[], notes:'', coberturaPedCv:'', status:'pending', adminNote:'', createdAt:new Date().toISOString(), updatedAt:new Date().toISOString()};
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
    <div class="field" style="background:var(--tint1);border:1px solid var(--green-pale);border-radius:10px;padding:10px 12px">
      <label style="margin-bottom:6px">🏥 ¿Cobertura Pediatría/Cardiovascular resuelta?</label>
      <select id="v_cobpedcv">
        <option value="" ${!v.coberturaPedCv?'selected':''}>— Seleccionar —</option>
        <option value="si" ${v.coberturaPedCv==='si'?'selected':''}>Sí</option>
        <option value="no" ${v.coberturaPedCv==='no'?'selected':''}>No</option>
        <option value="na" ${v.coberturaPedCv==='na'?'selected':''}>No aplica</option>
      </select>
      <p class="help" style="margin-top:4px">Queda anotado en la solicitud para que la jefatura lo tenga en cuenta.</p>
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
  const cp = document.getElementById('v_cobpedcv'); if(cp) window._vacEditing.coberturaPedCv = cp.value;
}
async function saveVacation(id, isNew){
  syncVacFormDraft();
  const v = window._vacEditing;
  if(!v.staffId){toast('Falta el anestesiólogo');return;}
  if(!v.from||!v.to){toast('Faltan fechas');return;}
  if(v.from>v.to){toast('La fecha de inicio es posterior a la de fin');return;}
  v.id = id; v.status = v.status || 'pending';
  v.updatedAt = new Date().toISOString();
  if(!v.createdAt) v.createdAt = v.updatedAt;
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
  save(); closeModal(); renderVacations();
  window._vacEditing = null;
  // Confirmación REAL de sincronización: guardamos local y SOLO decimos
  // "enviada" cuando de verdad llegó al backend en la nube. Si falla, avisamos
  // claramente para que nadie crea que subió algo que no llegó.
  const base = getBackendURL();
  if(!base){ toast(isNew?'Guardada en este equipo':'Actualizada (solo local)'); return; }
  toast(isNew?'Guardada · sincronizando…':'Actualizando…');
  if(_syncTimer){ clearTimeout(_syncTimer); _syncTimer = null; } // forzamos el push ahora
  let ok = false;
  // Empuja Y verifica que la solicitud quedó en la nube (reintenta si una
  // escritura concurrente la pisó).
  try{ ok = await _pushMainVerified(c => (c.vacations||[]).some(x => x && x.id === v.id)); }catch(e){ ok = false; }
  if(ok){
    toast(isNew ? '✅ Solicitud enviada' : '✅ Cambios sincronizados');
    // Aviso push al admin solo si la solicitud realmente llegó a la nube.
    if(isNew && v.status === 'pending'){ try{ notifyAdminsPush('vacaciones'); }catch(e){} }
  } else {
    toast('⚠️ Guardada en este equipo, pero NO se pudo enviar a la nube. Se reintentará al reabrir la app.');
  }
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
      <b>¿Cobertura Pediatría/Cardiovascular resuelta?</b> ${v.coberturaPedCv?{si:'Sí',no:'No',na:'No aplica'}[v.coberturaPedCv]:'<i>sin responder</i>'}<br>
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
async function decideVacation(id, decision){
  const note = prompt(decision==='approved'
    ? 'Comentario para la aprobación (opcional):'
    : 'Motivo del rechazo (opcional):') || '';
  const v = state.vacations.find(x=>x.id===id); if(!v) return;
  v.status = decision;
  v.adminNote = note;
  v.decidedAt = new Date().toISOString();
  v.updatedAt = new Date().toISOString();
  save(); closeModal(); renderVacations();
  // Confirmar que la decisión llegó a la nube (para que la unidad la vea).
  await _confirmSharedPush(decision==='approved'?'Solicitud aprobada':'Solicitud rechazada', 'la decisión', c => { const x=(c.vacations||[]).find(y=>y&&y.id===id); return !!x && x.status===decision; });
}
async function deleteVacation(id){
  if(!confirm('¿Eliminar esta solicitud?')) return;
  // Borrado lógico (soft-delete): se marca como eliminada en vez de quitarla.
  // Así la eliminación se propaga a todos los dispositivos por la nube.
  const v = state.vacations.find(x=>x.id===id);
  if(v){
    v.deleted = true;
    v.updatedAt = new Date().toISOString();
  } else {
    state.vacations = state.vacations.filter(x=>x.id!==id);
  }
  save(); renderVacations();
  await _confirmSharedPush('Eliminada', 'la eliminación', c => { const x=(c.vacations||[]).find(y=>y&&y.id===id); return !!x && x.deleted===true; });
}

// ============================================================
// ESTADÍSTICAS
// ============================================================
let charts = {};

// Detecta el "listado" que está debajo de cada tabla: filas con un nombre en
// la columna A, un número en la columna B y el resto de columnas vacías.
function _findSheetListing(rows){
  const items = [];
  for(const row of (rows||[])){
    if(!row || row.length < 2) continue;
    const name = String(row[0]==null ? '' : row[0]).trim();
    if(!name) continue;
    if(/^(nombre|name|total|real|ideal|mes|% ?ideal)$/i.test(name)) continue;
    const raw = row[1];
    let num = null;
    if(typeof raw === 'number') num = raw;
    else if(raw !== '' && raw != null && !isNaN(parseFloat(raw))) num = parseFloat(raw);
    if(num === null) continue;
    // La columna C en adelante debe estar vacía (si no, es una fila de la tabla)
    const rest = row.slice(2);
    const restEmpty = rest.every(c => c === '' || c == null || (typeof c === 'string' && c.trim() === ''));
    if(!restEmpty) continue;
    items.push({ n: name, v: num });
  }
  return items;
}

// Hojas que la app busca en el Excel, con su título amigable.
const STATS_SHEETS = [
  { key:'hrsdia', title:'HRS DIA',  match:['hrsdia','horasdia'] },
  { key:'ll1',    title:'LL1',      match:['ll1','llamada1','primerallamada'] },
  { key:'ll2',    title:'LL2',      match:['ll2','llamada2','segundallamada'] },
  { key:'sabado', title:'Sábados',  match:['sabado','sabados'] }
];
function _normSheetName(s){
  return String(s||'').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^a-z0-9]/g,'');
}

function renderStats(){
  if(!state.stats.hidden) state.stats.hidden = {};
  const sheets = state.stats.sheetCharts || [];

  // Cajas de resumen: total acumulado de cada hoja
  const totalOf = (key)=>{
    const sh = sheets.find(s=>s.key===key);
    if(!sh) return 0;
    return sh.items.reduce((a,b)=>a + (Number(b.v)||0), 0);
  };
  const setTxt = (id,val)=>{ const el=document.getElementById(id); if(el) el.textContent = val; };
  setTxt('statHrsDia', totalOf('hrsdia'));
  setTxt('statLL1', totalOf('ll1'));
  setTxt('statLL2', totalOf('ll2'));
  setTxt('statSabado', totalOf('sabado'));

  // Info de última importación
  const info = document.getElementById('statsImportInfo');
  if(info){
    const li = state.stats.lastImport;
    info.textContent = li
      ? `Última importación: ${li.filename} — ${new Date(li.at).toLocaleString()}`
      : 'Aún no se ha importado un Excel.';
  }

  // Destruir gráficos previos
  Object.keys(charts).forEach(k=>{ try{ charts[k].destroy(); }catch(e){} delete charts[k]; });

  const wrap = document.getElementById('sheetChartsWrap');
  if(!wrap) return;

  if(!sheets.length){
    wrap.innerHTML = `<div class="section"><div class="empty-chart">Aún no hay datos. ${
      state.isAdmin
        ? 'Importá tu Excel desde "Administración de datos", más arriba.'
        : 'El administrador todavía no ha cargado el Excel de estadísticas.'
    }</div></div>`;
    return;
  }

  const visible = sheets.filter(sh=>!state.stats.hidden[sh.key]);
  if(!visible.length){
    wrap.innerHTML = `<div class="section"><div class="empty-chart">Todos los gráficos están ocultos.${
      state.isAdmin ? ' Usá "Mostrar todos los gráficos" para volver a verlos.' : ''
    }</div></div>`;
    return;
  }

  wrap.innerHTML = visible.map(sh=>{
    const h = Math.max(240, sh.items.length * 24 + 60);
    const delBtn = state.isAdmin
      ? `<button class="chart-del" onclick="hideChart('${sh.key}')" title="Ocultar este gráfico">✕</button>`
      : '';
    return `<div class="section">
      <h3>${sh.title} ${delBtn}</h3>
      <div style="position:relative;height:${h}px">
        <canvas id="chart_${sh.key}"></canvas>
      </div>
    </div>`;
  }).join('');

  visible.forEach(sh=>{
    const cv = document.getElementById('chart_'+sh.key);
    if(!cv) return;
    charts[sh.key] = new Chart(cv, {
      type:'bar',
      data:{
        labels: sh.items.map(x=>x.n),
        datasets:[{
          label: sh.title,
          data: sh.items.map(x=>Number(x.v)||0),
          backgroundColor:'#2e8b6b'
        }]
      },
      options:{
        indexAxis:'y',
        responsive:true,
        maintainAspectRatio:false,
        plugins:{ legend:{display:false} },
        scales:{
          x:{ beginAtZero:true },
          y:{ ticks:{ font:{ size:11 }, autoSkip:false } }
        }
      }
    });
  });
}

function hideChart(key){
  if(!state.isAdmin){ toast('Solo admin'); return; }
  if(!confirm('¿Ocultar este gráfico? Puedes restaurarlo con "Mostrar todos los gráficos".')) return;
  if(!state.stats.hidden) state.stats.hidden = {};
  state.stats.hidden[key] = true;
  save();
  renderStats();
  toast('Gráfico ocultado');
}
function resetHiddenCharts(){
  if(!state.isAdmin){ toast('Solo admin'); return; }
  state.stats.hidden = {};
  save();
  renderStats();
  toast('Todos los gráficos visibles');
}

// --- IMPORTACIÓN DE EXCEL ---
function openImportStatsModal(){
  if(!state.isAdmin){ toast('Solo admin'); return; }
  modal(`
    <h3>📂 Importar Excel de estadísticas</h3>
    <p class="help" style="margin-bottom:10px">Sube tu archivo <b>.xlsx</b>. La app lee las hojas
      <b>HRS DIA</b>, <b>LL1</b>, <b>LL2</b> y <b>SABADO</b>, y de cada una toma el listado de
      totales que está debajo de la tabla para armar un gráfico de barras.</p>
    <div class="field">
      <label>Archivo Excel</label>
      <input type="file" id="statsFile" accept=".xlsx,.xls" />
    </div>
    <div class="btn-row">
      <button class="btn accent" onclick="importStatsXLSX()">Importar</button>
      <button class="btn secondary" onclick="closeModal()">Cancelar</button>
    </div>
  `);
}

function importStatsXLSX(){
  const inp = document.getElementById('statsFile');
  if(!inp || !inp.files || !inp.files[0]){ toast('Selecciona un archivo'); return; }
  const file = inp.files[0];
  if(typeof XLSX === 'undefined'){ toast('Librería XLSX no disponible'); return; }
  const reader = new FileReader();
  reader.onload = function(e){
    try{
      const wb = XLSX.read(e.target.result, {type:'array'});
      const sheetCharts = [];
      const found = [];
      STATS_SHEETS.forEach(def=>{
        // Buscar la hoja por nombre aproximado
        let sheetName = null;
        for(const name of wb.SheetNames){
          const norm = _normSheetName(name);
          if(def.match.some(m => norm === m || norm.indexOf(m) === 0)){ sheetName = name; break; }
        }
        if(!sheetName) return;
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {header:1, defval:''});
        const items = _findSheetListing(rows);
        if(items.length){
          sheetCharts.push({ key:def.key, title:def.title, items });
          found.push(def.title + ' (' + items.length + ')');
        }
      });
      if(!sheetCharts.length){
        toast('No se encontraron las hojas HRS DIA, LL1, LL2 ni SABADO con un listado válido.');
        return;
      }
      state.stats.sheetCharts = sheetCharts;
      state.stats.hidden = {};
      state.stats.lastImport = { at:new Date().toISOString(), filename:file.name, sheets:wb.SheetNames };
      save();
      closeModal();
      renderStats();
      toast('Importado: ' + found.join(', '));
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
    if(!m){ toast('Cumpleaños inválido: usa MM-DD (ej: 03-21)'); return; }
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
// --- Protocolos institucionales (configs/protocolos.json en GitHub) ---
// Permanentes y de solo lectura: viven en el repo, NO en el estado sincronizado,
// por lo que no pueden "caerse". ARIA los lee como contexto (campo "texto").
let _protocolosInst = null;
async function loadProtocolosInst(){
  if(_protocolosInst !== null) return _protocolosInst;
  try{
    const r = await fetch('configs/protocolos.json', {cache:'no-cache'});
    if(r.ok){
      const data = await r.json();
      _protocolosInst = Array.isArray(data.protocolos) ? data.protocolos.filter(p=>p && !p.deleted) : [];
    } else { _protocolosInst = []; }
  }catch(e){ _protocolosInst = []; }
  return _protocolosInst;
}

function _protoFileBlock(p){
  const hasFile = p.fileUrl && p.fileUrl.length>0;
  return hasFile
    ? `<div class="btn-row" style="margin-top:8px">
         <a class="btn sm accent" href="${p.fileUrl}" target="_blank" rel="noopener">📄 Abrir PDF${p.fileName?' · '+p.fileName.replace(/</g,'&lt;'):''}</a>
         <a class="btn sm secondary" href="${p.fileUrl}" download>⬇ Descargar</a>
       </div>`
    : '';
}

function renderProtocols(){
  const list = document.getElementById('protoList');
  if(!list) return;
  // Carga diferida de los institucionales; re-render cuando lleguen.
  if(_protocolosInst === null){
    loadProtocolosInst().then(()=>{ try{ renderProtocols(); }catch(e){} });
  }
  const inst = _protocolosInst || [];
  const instIds = new Set(inst.map(p=>p.id));

  // 1) Institucionales (GitHub) — solo lectura, con distintivo.
  const instHtml = inst.map(p=>{
    const titulo = (p.titulo||p.title||'').replace(/</g,'&lt;');
    const cuerpo = (p.resumen||p.body||p.texto||'');
    const fuente = p.fuente ? `<div style="font-size:11.5px;color:var(--muted);margin-top:6px">Fuente: ${String(p.fuente).replace(/</g,'&lt;')}${p.vigencia?' · '+String(p.vigencia).replace(/</g,'&lt;'):''}</div>` : '';
    return `<div class="detail-card" style="border-left:4px solid var(--green-forest)">
      <div class="head">${titulo} <span style="font-size:10.5px;font-weight:700;color:var(--green-deep);background:#dcfce7;border-radius:6px;padding:1px 7px;margin-left:4px;vertical-align:middle">📌 INSTITUCIONAL</span></div>
      <div style="font-size:13px;color:var(--text);white-space:pre-wrap">${cuerpo}</div>
      ${_protoFileBlock(p)}
      ${fuente}
    </div>`;
  }).join('');

  // 2) Protocolos del estado (subidos por la app), excluyendo los que ya
  //    existen como institucionales (dedupe por id).
  const stateHtml = (state.protocols||[]).filter(p=>!p.deleted && !instIds.has(p.id)).map(p=>{
    return `<div class="detail-card">
      <div class="head">${p.title}</div>
      <div style="font-size:13px;color:var(--text);white-space:pre-wrap">${p.body||''}</div>
      ${_protoFileBlock(p)}
      ${state.isAdmin?`<div class="btn-row"><button class="btn sm secondary" onclick="editProto('${p.id}')">Editar</button><button class="btn sm danger" onclick="deleteProto('${p.id}')">Eliminar</button></div>`:''}
    </div>`;
  }).join('');

  list.innerHTML = instHtml + stateHtml;
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
      <div class="help">Adjuntá un PDF y se guardará en la App (vía Base64 en este navegador). ⚠️ Para protocolos institucionales PERMANENTES, mejor súbelos por GitHub (no se pierden ni dependen de este navegador); los PDF grandes aquí pueden no persistir.</div>
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
  const now = new Date().toISOString();
  const data = {
    id,
    title: document.getElementById('pr_title').value,
    body: document.getElementById('pr_body').value,
    fileUrl: document.getElementById('pr_file_url').value,
    fileName: document.getElementById('pr_file_name').value,
    updatedAt: now,
  };
  if(!data.title){toast('Falta el título');return;}
  state.protocols = state.protocols || [];
  if(isNew){ data.createdAt = now; state.protocols.push(data); }
  else {
    const prev = state.protocols.find(p=>p.id===id) || {};
    data.createdAt = prev.createdAt || now;
    state.protocols = state.protocols.map(p=>p.id===id?data:p);
  }
  save(); closeModal(); renderProtocols(); toast('Guardado');
}
function deleteProto(id){
  if(!confirm('¿Eliminar este protocolo?')) return;
  // Tombstone (no quitar del arreglo): así el borrado se sincroniza a la nube
  // y no reaparece al fusionar con otros dispositivos.
  const now = new Date().toISOString();
  state.protocols = (state.protocols||[]).map(p=> p.id===id ? {...p, deleted:true, updatedAt:now} : p);
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
      1. Abre tu Excel en OneDrive (Excel para web).<br>
      2. Menú <b>Archivo → Compartir → Insertar</b> (o "Embed").<br>
      3. Configura qué hoja/rango se muestra (puedes mostrar la del mes actual).<br>
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
    return '<div class="calc-empty">Ingresa el peso para calcular dosis</div>';
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
    return '<div class="calc-empty">Ingresa el peso para calcular dosis</div>';
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
  let totalMatches = 0;
  let seccionesConMatch = 0;
  COAGULACION_DATA.forEach((sec, idx)=>{
    const drugs = sec.drugs.filter(d=>!q || d.name.toLowerCase().includes(q) || d.pre.toLowerCase().includes(q) || d.post.toLowerCase().includes(q) || (d.cat_full||'').toLowerCase().includes(q));
    if(drugs.length===0) return;
    totalMatches += drugs.length;
    seccionesConMatch++;
    // Con búsqueda activa los grupos se abren solos; sin búsqueda quedan plegados
    const open = q ? ' open' : '';
    let tabla = `<div class="med-table-wrap"><table class="med-table"><thead><tr><th>Fármaco</th><th>Suspender ANTES</th><th>Reiniciar DESPUÉS</th></tr></thead><tbody>`;
    drugs.forEach(d=>{
      tabla += `<tr><td class="drug">${d.name}<div class="note">${d.cat_full||''}</div></td><td class="dose">${d.pre}</td><td class="dose">${d.post}</td></tr>`;
    });
    tabla += '</tbody></table></div>';
    html += `
      <div class="coag-acc${open}" id="coagAcc${idx}">
        <button type="button" class="coag-acc-head" onclick="toggleCoagAcc(${idx})">
          <span class="coag-acc-ico">🩸</span>
          <span class="coag-acc-title">${sec.cat}</span>
          <span class="coag-acc-meta">${drugs.length} fármaco${drugs.length!==1?'s':''}</span>
          <span class="coag-acc-chev">›</span>
        </button>
        <div class="coag-acc-body">${tabla}</div>
      </div>`;
  });
  if(q && totalMatches === 0){
    html += `<div class="coag-empty">😕 Sin resultados para "<b>${q.replace(/</g,'&lt;')}</b>".<br><span style="font-size:12px;color:var(--muted)">Prueba con el nombre genérico (ej: enoxaparina, dabigatrán, clopidogrel…)</span></div>`;
  } else if(q){
    html = `<div class="coag-result-count">${totalMatches} fármaco${totalMatches!==1?'s':''} en ${seccionesConMatch} grupo${seccionesConMatch!==1?'s':''}</div>` + html;
  }
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
function toggleCoagAcc(idx){
  const el = document.getElementById('coagAcc'+idx);
  if(el) el.classList.toggle('open');
}

// ============================================================
// ASRA 2025 (5ª edición) — Anticoagulación y ANESTESIA NEUROAXIAL
// Tiempos para: punción neuroaxial / bloqueo profundo, retiro de catéter,
// reinicio de la anticoagulación y mantención de catéter.
// Fuente: ASRA Pain Medicine, Regional Anesthesia in the Patient Receiving
// Antithrombotic or Thrombolytic Therapy, 5ª ed (Reg Anesth Pain Med 2025).
// Asume función renal/hepática normal — ajustar individualmente.
// REFERENCIA DE APOYO: la decisión final es del anestesiólogo a cargo.
// ============================================================
const ASRA_NEURAXIAL_2025 = [
  { grupo:'Heparina no fraccionada (HNF)', drugs:[
    { name:'HNF subcutánea — dosis baja (≤5000 U c/8–12 h)',
      aliases:['hnf','heparina no fraccionada','heparina sc','heparina subcutanea','heparina profilactica','5000'],
      puncion:'Sin contraindicación si ≤5000 U cada 12 h. Si es cada 8 h o dosis total >10.000 U/día: esperar 4–6 h y aPTT normal.',
      cateter:'Retirar idealmente en la hora valle (justo antes de la siguiente dosis), 4–6 h tras la última si es dosis alta.',
      reinicio:'1 h después de la punción o del retiro del catéter.',
      mantencion:'El catéter puede mantenerse con dosis baja BID.',
      monitoreo:'Recuento plaquetario si >4 días de heparina (riesgo de TIH).',
      fuente:'ASRA 2025 (5ª ed) — HNF SC dosis baja' },
    { name:'HNF intravenosa — terapéutica',
      aliases:['hnf iv','heparina iv','heparina intravenosa','heparina terapeutica','bomba de heparina'],
      puncion:'Suspender 4–6 h antes y confirmar aPTT normal (o anti-Xa normal).',
      cateter:'Retirar 4–6 h tras la última dosis con aPTT normal.',
      reinicio:'≥1 h después de la punción o del retiro del catéter. Reanudar infusión sin bolo si es posible.',
      mantencion:'Evitar mantener catéter con infusión activa; si se mantiene, vigilancia neurológica estricta.',
      monitoreo:'aPTT / anti-Xa. Plaquetas si >4 días (TIH).',
      fuente:'ASRA 2025 (5ª ed) — HNF IV terapéutica' }
  ]},
  { grupo:'Heparina de bajo peso molecular (HBPM)', drugs:[
    { name:'HBPM dosis BAJA / profiláctica (enoxaparina 40 mg/d; dalteparina 5000 U; tinzaparina 4500 U)',
      aliases:['hbpm','enoxaparina','clexane','dalteparina','tinzaparina','nadroparina','fragmin','heparina bajo peso','profilactica','low dose'],
      puncion:'12 h tras la última dosis.',
      cateter:'Retirar ≥12 h tras la última dosis y ≥4 h antes de la siguiente. Con dosis 1×/día el catéter puede mantenerse; con dosis 2×/día retirar el catéter ANTES de iniciar la HBPM.',
      reinicio:'≥4 h tras la punción o el retiro del catéter (algunos centros 6–8 h si punción traumática).',
      mantencion:'Mantenible solo con esquema de dosis única diaria.',
      monitoreo:'Anti-Xa no rutinario; útil en ERC, obesidad o embarazo.',
      fuente:'ASRA 2025 (5ª ed) — HBPM "dosis baja"' },
    { name:'HBPM dosis ALTA / terapéutica (enoxaparina 1 mg/kg c/12 h o 1,5 mg/kg/d)',
      aliases:['hbpm terapeutica','enoxaparina terapeutica','enoxaparina 1 mg','high dose','dosis alta'],
      puncion:'24 h tras la última dosis.',
      cateter:'NO mantener catéter con dosis terapéutica. Retirar el catéter antes de iniciar el esquema terapéutico.',
      reinicio:'≥4 h tras el retiro del catéter; la primera dosis terapéutica ≥24 h tras la punción si fue atraumática.',
      mantencion:'No.',
      monitoreo:'Anti-Xa según contexto (ERC/obesidad).',
      fuente:'ASRA 2025 (5ª ed) — HBPM "dosis alta"' }
  ]},
  { grupo:'Anticoagulantes orales (warfarina)', drugs:[
    { name:'Warfarina / Acenocumarol (AVK)',
      aliases:['warfarina','coumadin','acenocumarol','neosintron','neosintrón','avk','cumarinico','inr'],
      puncion:'Suspender ~5 días antes (acenocumarol 3 días) y confirmar INR ≤1.4 (normalizado).',
      cateter:'Retirar solo con INR <1.5. Vigilar si el INR está subiendo durante el reinicio.',
      reinicio:'Puede reiniciarse la misma noche del procedimiento; controlar INR si hay catéter.',
      mantencion:'Catéter solo mientras el INR sea <1.5; vigilancia neurológica.',
      monitoreo:'INR.',
      fuente:'ASRA 2025 (5ª ed) — AVK' }
  ]},
  { grupo:'Anticoagulantes orales directos (DOAC)', drugs:[
    { name:'Rivaroxabán (Xarelto)',
      aliases:['rivaroxaban','xarelto','doac','noac','anti xa','anti-xa'],
      puncion:'72 h. Alternativa individualizada: 22–26 h si se documenta nivel residual <30 ng/mL o anti-Xa ≤0,1 UI/mL.',
      cateter:'Suspender 72 h antes del retiro (o nivel residual aceptable). No mantener catéter con DOAC activo.',
      reinicio:'6 h tras la punción o el retiro del catéter, si fue atraumática.',
      mantencion:'No.',
      monitoreo:'Nivel residual / anti-Xa calibrado (novedad 2025): <30 ng/mL o anti-Xa ≤0,1 UI/mL aceptable.',
      fuente:'ASRA 2025 (5ª ed) — DOAC anti-Xa' },
    { name:'Apixabán (Eliquis)',
      aliases:['apixaban','eliquis','doac','noac','anti xa'],
      puncion:'72 h. Alternativa: nivel residual <30 ng/mL o anti-Xa ≤0,1 UI/mL.',
      cateter:'Suspender 72 h antes del retiro. No mantener catéter con DOAC activo.',
      reinicio:'6 h tras la punción o el retiro del catéter.',
      mantencion:'No.',
      monitoreo:'Anti-Xa calibrado para apixabán; reducir dosis en <60 kg o ERC.',
      fuente:'ASRA 2025 (5ª ed) — DOAC anti-Xa' },
    { name:'Edoxabán (Lixiana)',
      aliases:['edoxaban','lixiana','doac','noac'],
      puncion:'72 h (o nivel residual aceptable).',
      cateter:'Suspender 72 h antes del retiro.',
      reinicio:'6 h tras la punción o el retiro del catéter.',
      mantencion:'No.',
      monitoreo:'Anti-Xa calibrado.',
      fuente:'ASRA 2025 (5ª ed) — DOAC anti-Xa' },
    { name:'Dabigatrán (Pradaxa)',
      aliases:['dabigatran','pradaxa','doac','noac','inhibidor trombina'],
      puncion:'72 h si ClCr ≥80. Prolongar en ERC: ClCr 50–80 → ~96 h; 30–50 → ~120 h. O nivel residual <30 ng/mL.',
      cateter:'Si por error queda catéter in situ: suspender ≥48 h o nivel <30 ng/mL antes de retirarlo.',
      reinicio:'6 h tras la punción o el retiro del catéter.',
      mantencion:'No.',
      monitoreo:'Tiempo de trombina diluido / ecarina. Reversor: idarucizumab (Praxbind).',
      fuente:'ASRA 2025 (5ª ed) — dabigatrán (ajuste por ClCr)' }
  ]},
  { grupo:'Antiagregantes plaquetarios', drugs:[
    { name:'AAS / Aspirina (monoterapia)',
      aliases:['aas','aspirina','acido acetilsalicilico','ácido acetilsalicílico','antiagregante'],
      puncion:'Sin contraindicación para neuroaxial en monoterapia (a cualquier dosis).',
      cateter:'Sin restricción específica.',
      reinicio:'Sin restricción.',
      mantencion:'Catéter mantenible.',
      monitoreo:'Cautela si se combina con otros antitrombóticos.',
      fuente:'ASRA 2025 (5ª ed) — AINE/AAS' },
    { name:'AINEs (ibuprofeno, ketorolaco, etc.)',
      aliases:['aine','aines','ibuprofeno','ketorolaco','naproxeno','diclofenaco','antiinflamatorio'],
      puncion:'Sin contraindicación en monoterapia.',
      cateter:'Sin restricción específica.',
      reinicio:'Sin restricción.',
      mantencion:'Catéter mantenible.',
      monitoreo:'Riesgo aumenta al combinar con otros antitrombóticos.',
      fuente:'ASRA 2025 (5ª ed) — AINE' },
    { name:'Clopidogrel (Plavix)',
      aliases:['clopidogrel','plavix','tienopiridina','antiagregante'],
      puncion:'5–7 días.',
      cateter:'Catéter mantenible 1–2 días SOLO si no se administró dosis de carga; idealmente retirar antes.',
      reinicio:'24 h postprocedimiento si hemostasia adecuada.',
      mantencion:'Limitada (1–2 días sin dosis de carga).',
      monitoreo:'—',
      fuente:'ASRA 2025 (5ª ed) — tienopiridinas' },
    { name:'Prasugrel (Effient)',
      aliases:['prasugrel','effient','tienopiridina'],
      puncion:'7–10 días.',
      cateter:'NO mantener catéter (inicio de acción rápido).',
      reinicio:'24 h postprocedimiento.',
      mantencion:'No.',
      monitoreo:'—',
      fuente:'ASRA 2025 (5ª ed) — tienopiridinas' },
    { name:'Ticagrelor (Brilinta)',
      aliases:['ticagrelor','brilinta','antiagregante'],
      puncion:'5 días.',
      cateter:'NO mantener catéter (inicio de acción rápido).',
      reinicio:'24 h postprocedimiento.',
      mantencion:'No.',
      monitoreo:'—',
      fuente:'ASRA 2025 (5ª ed)' },
    { name:'Ticlopidina',
      aliases:['ticlopidina','tienopiridina'],
      puncion:'10 días.',
      cateter:'No mantener.',
      reinicio:'24 h postprocedimiento.',
      mantencion:'No.',
      monitoreo:'—',
      fuente:'ASRA 2025 (5ª ed) — tienopiridinas' },
    { name:'Cangrelor (IV)',
      aliases:['cangrelor','antiagregante iv'],
      puncion:'3 h.',
      cateter:'Suspender 3 h antes del retiro.',
      reinicio:'Tras hemostasia.',
      mantencion:'No.',
      monitoreo:'Vida media muy corta (~3–6 min).',
      fuente:'ASRA 2025 (5ª ed)' },
    { name:'Inhibidores GP IIb/IIIa (abciximab, eptifibatida, tirofibán)',
      aliases:['abciximab','eptifibatida','tirofiban','gp iib','iib iiia','inhibidor glicoproteina'],
      puncion:'Abciximab 24–48 h; eptifibatida/tirofibán 4–8 h (hasta normalizar función plaquetaria).',
      cateter:'No realizar neuroaxial hasta recuperar función plaquetaria.',
      reinicio:'Según contexto, con hemostasia.',
      mantencion:'No.',
      monitoreo:'Contraindicado en las primeras 4 semanas postcirugía.',
      fuente:'ASRA 2025 (5ª ed)' },
    { name:'Dipiridamol / Cilostazol',
      aliases:['dipiridamol','aggrenox','cilostazol','pletal'],
      puncion:'Dipiridamol de liberación prolongada: 24 h. Cilostazol: 2 días (~42 h).',
      cateter:'Retirar antes de reiniciar.',
      reinicio:'Tras hemostasia; cilostazol 24 h.',
      mantencion:'Precaución.',
      monitoreo:'—',
      fuente:'ASRA 2025 (5ª ed)' }
  ]},
  { grupo:'Pentasacáridos y trombolíticos', drugs:[
    { name:'Fondaparinux (Arixtra) — dosis baja 2,5 mg/d',
      aliases:['fondaparinux','arixtra','pentasacarido','pentasacárido'],
      puncion:'36 h (jóvenes) a 42 h (ancianos) con función renal normal. Punción única atraumática.',
      cateter:'Evitar técnicas con catéter; preferir punción única.',
      reinicio:'6–12 h postprocedimiento.',
      mantencion:'No se recomienda catéter.',
      monitoreo:'Anti-Xa específico; prolongar en ERC.',
      fuente:'ASRA 2025 (5ª ed) — fondaparinux' },
    { name:'Trombolíticos (alteplasa, tenecteplasa, estreptoquinasa)',
      aliases:['tromboliticos','trombolíticos','alteplasa','tenecteplasa','estreptoquinasa','fibrinolitico','fibrinolítico','tpa'],
      puncion:'CONTRAINDICADO. Evitar neuroaxial ≥10 días tras su uso; idealmente no realizar.',
      cateter:'No realizar/retirar bajo efecto trombolítico; si ocurrió exposición inadvertida, vigilancia neurológica y medir fibrinógeno.',
      reinicio:'Individualizar con el equipo tratante.',
      mantencion:'No.',
      monitoreo:'Fibrinógeno; vigilancia neurológica frecuente (cada 2 h).',
      fuente:'ASRA 2025 (5ª ed) — trombolíticos' }
  ]},
  { grupo:'Herbáceos y suplementos', drugs:[
    { name:'Ajo · Ginkgo · Ginseng ("las 3 G")',
      aliases:['ajo','ginkgo','ginseng','herbaceos','herbáceos','suplementos','hierbas'],
      puncion:'Sin restricción para neuroaxial en monoterapia (no requieren suspensión obligatoria).',
      cateter:'Sin restricción específica.',
      reinicio:'Sin restricción.',
      mantencion:'Catéter mantenible.',
      monitoreo:'Cautela si se combinan con antitrombóticos.',
      fuente:'ASRA 2025 (5ª ed) — herbáceos' }
  ]}
];

// Render reutilizable del buscador neuroaxial ASRA 2025.
// prefix = identificador único de la instancia (ej. 'coag' o 'reg') para no
// chocar IDs cuando se muestra en dos vistas distintas.
function renderASRANeuraxial(prefix){
  const input = document.getElementById('asra_'+prefix+'_search');
  const cont  = document.getElementById('asra_'+prefix+'_list');
  if(!cont) return;
  const q = _gpNorm(input ? input.value : '');
  let html = '';
  let total = 0, grupos = 0;
  ASRA_NEURAXIAL_2025.forEach((sec, si)=>{
    const drugs = sec.drugs.filter(d=>{
      if(!q) return true;
      const hay = _gpNorm(d.name + ' ' + sec.grupo + ' ' + (d.aliases||[]).join(' '));
      return hay.includes(q);
    });
    if(drugs.length === 0) return;
    total += drugs.length; grupos++;
    const open = q ? ' open' : '';
    let inner = '';
    drugs.forEach(d=>{
      inner += `
        <div class="asra-card">
          <div class="asra-card-name">${d.name}</div>
          <div class="asra-rows">
            <div class="asra-row"><div class="asra-k">🩸 Punción neuroaxial / bloqueo profundo</div><div class="asra-v">${d.puncion||'—'}</div></div>
            <div class="asra-row"><div class="asra-k">🧵 Retiro de catéter</div><div class="asra-v">${d.cateter||'—'}</div></div>
            <div class="asra-row"><div class="asra-k">🔁 Reiniciar anticoagulación</div><div class="asra-v">${d.reinicio||'—'}</div></div>
            ${d.mantencion?`<div class="asra-row"><div class="asra-k">📌 Mantención de catéter</div><div class="asra-v">${d.mantencion}</div></div>`:''}
            ${d.monitoreo?`<div class="asra-row"><div class="asra-k">🔬 Monitoreo / nota</div><div class="asra-v">${d.monitoreo}</div></div>`:''}
          </div>
          <div class="asra-src">${d.fuente||'ASRA 2025 (5ª ed)'}</div>
        </div>`;
    });
    html += `
      <div class="asra-acc${open}" id="asra_${prefix}_acc${si}">
        <button type="button" class="asra-acc-head" onclick="toggleAsraAcc('${prefix}',${si})">
          <span class="asra-acc-ico">💉</span>
          <span class="asra-acc-title">${sec.grupo}</span>
          <span class="asra-acc-meta">${drugs.length}</span>
          <span class="asra-acc-chev">›</span>
        </button>
        <div class="asra-acc-body">${inner}</div>
      </div>`;
  });
  if(q && total === 0){
    html = `<div class="asra-empty">Sin resultados para "<b>${(input?input.value:'').replace(/</g,'&lt;')}</b>".<br><span style="font-size:12px;color:var(--muted)">Prueba: enoxaparina, rivaroxabán, clopidogrel, warfarina, fondaparinux…</span></div>`;
  } else if(q){
    html = `<div class="asra-count">${total} fármaco${total!==1?'s':''} en ${grupos} grupo${grupos!==1?'s':''}</div>` + html;
  }
  cont.innerHTML = html;
}
function toggleAsraAcc(prefix, idx){
  const el = document.getElementById('asra_'+prefix+'_acc'+idx);
  if(el) el.classList.toggle('open');
}

// ============================================================
// ANESTESIA REGIONAL — Bloqueos en traumatología (enlaces NYSORA)
// Todo el contenido técnico/video es de NYSORA® (acceso público).
// La app solo enlaza; no aloja ni reproduce su material.
// ============================================================
const REGIONAL_DATA = [
  {
    region: 'Extremidad superior (plexo braquial)',
    ico: '💪',
    blocks: [
      { name:'Bloqueo interescalénico', cirugias:'Hombro · húmero proximal · clavícula (con plexo cervical)', perlas:'De elección en cirugía de hombro. Riesgo de parálisis frénica (evitar en patología respiratoria severa). Volúmenes bajos (5–10 mL) reducen efectos adversos.', url:'https://www.nysora.com/techniques/upper-extremity/intescalene/ultrasound-guided-interscalene-brachial-plexus-block/', video:'https://www.nysora.com/techniques/ultrasound-guided-interscalene-brachial-plexus-block-video/' },
      { name:'Bloqueo supraclavicular', cirugias:'Brazo · codo · antebrazo · mano', perlas:'La "espinal del brazo": bloqueo denso y rápido de todo el miembro bajo el hombro. Vigilar el ápex pleural (riesgo de neumotórax). Aguja en plano, ver el local rodeando el plexo.', url:'https://www.nysora.com/topics/regional-anesthesia-for-specific-surgical-procedures/upper-extremity-regional-anesthesia-for-specific-surgical-procedures/anesthesia-and-analgesia-for-elbow-and-forearm-procedures/ultrasound-guided-supraclavicular-brachial-plexus-block/', video:'https://www.nysora.com/techniques/upper-extremity/ultrasound-guided-supraclavicular-brachial-plexus-block-video/' },
      { name:'Bloqueo infraclavicular', cirugias:'Codo · antebrazo · mano', perlas:'Buena opción para catéter continuo. Menos riesgo de frénico que el interescalénico. Cordones alrededor de la arteria axilar (lateral, posterior, medial).', url:'https://www.nysora.com/topics/regional-anesthesia-for-specific-surgical-procedures/upper-extremity-regional-anesthesia-for-specific-surgical-procedures/ultrasound-guided-infraclavicular-brachial-plexus-block/', video:'' },
      { name:'Bloqueo axilar', cirugias:'Antebrazo · muñeca · mano', perlas:'Superficial y seguro (sin riesgo de neumotórax ni frénico). Bloquear por separado mediano, ulnar, radial y musculocutáneo. Ideal para cirugía distal de antebrazo/mano.', url:'https://www.nysora.com/techniques/upper-extremity/axillary/ultrasound-guided-axillary-brachial-plexus-block/', video:'https://www.nysora.com/topics/educational-tools/videos/ultrasound-guided-axillary-brachial-plexus-block-2/' }
    ]
  },
  {
    region: 'Cadera y fémur',
    ico: '🦴',
    blocks: [
      { name:'Bloqueo PENG (pericapsular)', cirugias:'Fractura de cadera · cirugía de cadera', perlas:'Analgesia de la cápsula anterior de la cadera conservando la fuerza del cuádriceps (motor-sparing). En fractura de cadera da mejor analgesia dinámica que la fascia ilíaca según ECA recientes.', url:'https://www.nysora.com/education-news/peng-block-or-sificb-rct-compares-dynamic-pain-relief-in-hip-fracture-patients/', video:'' },
      { name:'Bloqueo de la fascia ilíaca', cirugias:'Fractura de cadera · fémur · analgesia prehospitalaria', perlas:'Una sola inyección cubre femoral + cutáneo femoral lateral (y a veces obturador). Muy útil como analgesia precoz en urgencias para fractura de cadera/fémur. Produce bloqueo motor del cuádriceps.', url:'https://www.nysora.com/topics/regional-anesthesia-for-specific-surgical-procedures/lower-extremity-regional-anesthesia-for-specific-surgical-procedures/ultrasound-guided-fascia-iliaca-block/', video:'' },
      { name:'Bloqueo femoral', cirugias:'Fémur · rótula · rodilla (cara anterior)', perlas:'Analgesia potente para fractura de fémur y cirugía de rodilla. Produce debilidad del cuádriceps → cuidado con caídas. Buen sitio para catéter.', url:'https://www.nysora.com/techniques/lower-extremity/ultrasound-guided-femoral-nerve-block/', video:'' },
      { name:'Bloqueo cutáneo femoral lateral', cirugias:'Injertos de piel del muslo · complemento de cadera', perlas:'Puramente sensitivo (sin componente motor). Útil como complemento o para la cara lateral del muslo.', url:'https://www.nysora.com/topics/regional-anesthesia-for-specific-surgical-procedures/lower-extremity-regional-anesthesia-for-specific-surgical-procedures/anesthesia-and-analgesia-for-hip-procedures/ultrasound-guided-lateral-femoral-cutaneous-nerve-block/', video:'' }
    ]
  },
  {
    region: 'Rodilla, pierna, tobillo y pie',
    ico: '🦵',
    blocks: [
      { name:'Bloqueo del canal aductor (safeno)', cirugias:'Rodilla · cara medial de pierna y tobillo', perlas:'Analgesia de rodilla conservando la fuerza del cuádriceps (motor-sparing) → favorece movilización precoz y rehabilitación. Inyectar a nivel medio del muslo.', url:'https://www.nysora.com/topics/regional-anesthesia-for-specific-surgical-procedures/lower-extremity-regional-anesthesia-for-specific-surgical-procedures/foot-and-anckle/ultrasound-guided-saphenous-subsartorius-adductor-canal-nerve-block/', video:'' },
      { name:'Bloqueo ciático poplíteo', cirugias:'Tobillo · pie · tibia/peroné distal', perlas:'Clave en cirugía de tobillo y pie. Combinar con safeno/aductor para cobertura completa del tobillo. Buscar la división en tibial y peroneo común; inyección subparaneural.', url:'https://www.nysora.com/topics/regional-anesthesia-for-specific-surgical-procedures/lower-extremity-regional-anesthesia-for-specific-surgical-procedures/foot-and-anckle/ultrasound-guided-popliteal-sciatic-block/', video:'https://www.nysora.com/topics/educational-tools/videos/ultrasound-guided-popliteal-block/' },
      { name:'Bloqueo ciático (proximal/subglúteo)', cirugias:'Pierna · tobillo · pie (con componente posterior)', perlas:'Elegir el nivel según el sitio quirúrgico y la necesidad de cubrir el cutáneo femoral posterior. Más proximal = bloqueo motor más extenso.', url:'https://www.nysora.com/topics/regional-anesthesia-for-specific-surgical-procedures/lower-extremity-regional-anesthesia-for-specific-surgical-procedures/foot-and-anckle/ultrasound-guided-sciatic-nerve-block-2/', video:'' }
    ]
  },
  {
    region: 'Tronco y pared torácica',
    ico: '🎯',
    blocks: [
      { name:'Bloqueo del erector espinal (ESP)', cirugias:'Fracturas costales · trauma de pared torácica · columna', perlas:'Muy útil en analgesia de fracturas costales múltiples (reduce opioides y mejora la mecánica ventilatoria). Inyección 20–30 mL en el plano del erector sobre la apófisis transversa. Técnica segura y de fácil aprendizaje.', url:'https://www.nysora.com/erector-spinae-plane-block/', video:'' }
    ]
  }
];

const REGIONAL_TRAUMA_LINK = 'https://www.nysora.com/topics/sub-specialties/trauma/regional-anesthesia-patients-trauma/';

let _regSel = null; // región seleccionada (índice) o null = grilla de zonas

// Ilustración SVG de la zona del cuerpo, con la región resaltada.
function _regBodySVG(idx){
  const base = '#d3d1de', hi = '#6b5fa0';
  const c = on => on ? hi : base;
  const arms = idx===0, thigh = idx===1, lower = idx===2, torso = idx===3;
  return `<svg viewBox="0 0 48 96" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <circle cx="24" cy="10" r="6.5" fill="${base}"/>
    <line x1="24" y1="18" x2="24" y2="46" stroke="${c(torso)}" stroke-width="15" stroke-linecap="round"/>
    <line x1="23" y1="24" x2="9"  y2="45" stroke="${c(arms)}"  stroke-width="6"  stroke-linecap="round"/>
    <line x1="25" y1="24" x2="39" y2="45" stroke="${c(arms)}"  stroke-width="6"  stroke-linecap="round"/>
    <line x1="22" y1="46" x2="18" y2="66" stroke="${c(thigh)}" stroke-width="7.5" stroke-linecap="round"/>
    <line x1="26" y1="46" x2="30" y2="66" stroke="${c(thigh)}" stroke-width="7.5" stroke-linecap="round"/>
    <line x1="18" y1="66" x2="17" y2="88" stroke="${c(lower)}" stroke-width="6"  stroke-linecap="round"/>
    <line x1="30" y1="66" x2="31" y2="88" stroke="${c(lower)}" stroke-width="6"  stroke-linecap="round"/>
  </svg>`;
}

function _regBlockCardHTML(b){
  const videoBtn = b.video
    ? `<a class="reg-link reg-link-video" href="${b.video}" target="_blank" rel="noopener">▶ Ver video (NYSORA)</a>`
    : '';
  return `
    <div class="reg-block">
      <div class="reg-block-name">${b.name}</div>
      <div class="reg-block-cir"><span class="reg-block-tag">Indicación</span> ${b.cirugias}</div>
      <div class="reg-block-perlas">${b.perlas}</div>
      <div class="reg-links">
        <a class="reg-link" href="${b.url}" target="_blank" rel="noopener">📖 Técnica (NYSORA)</a>
        ${videoBtn}
      </div>
    </div>`;
}

function renderRegional(){
  const q = _gpNorm(document.getElementById('regSearch')?.value || '');
  const cont = document.getElementById('regList');
  if(!cont) return;
  let html = '';

  // 1) BÚSQUEDA activa → lista plana de coincidencias (todas las zonas)
  if(q){
    let total = 0;
    REGIONAL_DATA.forEach(sec=>{
      const blocks = sec.blocks.filter(b => _gpNorm(b.name+' '+b.cirugias+' '+b.perlas).includes(q));
      if(!blocks.length) return;
      total += blocks.length;
      html += `<div class="reg-zona-titulo">${sec.ico} ${sec.region}</div>` + blocks.map(_regBlockCardHTML).join('');
    });
    if(total === 0){
      html = `<div class="reg-empty">Sin resultados.<br><span style="font-size:12px;color:var(--muted)">Prueba: hombro, codo, mano, cadera, fémur, rodilla, tobillo, costillas, PENG…</span></div>`;
    }
    cont.innerHTML = html + `<a class="reg-trauma-link" href="${REGIONAL_TRAUMA_LINK}" target="_blank" rel="noopener">🩹 Guía NYSORA: trauma ›</a>`;
    return;
  }

  // 2) REGIÓN seleccionada → detalle con botón Volver
  if(_regSel !== null && REGIONAL_DATA[_regSel]){
    const sec = REGIONAL_DATA[_regSel];
    html += `<button type="button" class="reg-back" onclick="regBackToGrid()">‹ Volver a las zonas</button>`;
    html += `<div class="reg-detalle-head"><div class="reg-detalle-fig">${_regBodySVG(_regSel)}</div><div class="reg-detalle-tit">${sec.region}</div></div>`;
    html += sec.blocks.map(_regBlockCardHTML).join('');
    html += `<a class="reg-trauma-link" href="${REGIONAL_TRAUMA_LINK}" target="_blank" rel="noopener">🩹 Guía NYSORA: trauma ›</a>`;
    cont.innerHTML = html;
    return;
  }

  // 3) GRILLA de zonas (botones con imagen del cuerpo)
  html += `<div class="reg-zona-grid">`;
  REGIONAL_DATA.forEach((sec, si)=>{
    html += `
      <button type="button" class="reg-zona-card" onclick="regSelectRegion(${si})">
        <div class="reg-zona-fig">${_regBodySVG(si)}</div>
        <div class="reg-zona-name">${sec.region}</div>
        <div class="reg-zona-count">${sec.blocks.length} bloqueo${sec.blocks.length!==1?'s':''}</div>
      </button>`;
  });
  html += `</div>`;
  html += `<a class="reg-trauma-link" href="${REGIONAL_TRAUMA_LINK}" target="_blank" rel="noopener">🩹 Guía NYSORA: Anestesia Regional en el paciente con trauma ›</a>`;
  cont.innerHTML = html;
}
function regSelectRegion(idx){
  _regSel = idx;
  renderRegional();
  try{ document.getElementById('view-regional').scrollIntoView({behavior:'smooth', block:'start'}); }catch(e){}
}
function regBackToGrid(){
  _regSel = null;
  renderRegional();
}
function toggleRegAcc(idx){ /* compat */ }

// ============================================================
// ASISTENTE DE IA (Cloudflare Workers AI vía Worker propio)
// La URL viene de configs/<inst>.json → "aiURL". Si no está
// configurada, los botones de IA se ocultan solos.
// ============================================================
let _aiMessages = [];   // historial del chat de esta sesión
let _aiBusy = false;

function getAiURL(){
  if(INSTITUTION && INSTITUTION.aiURL) return String(INSTITUTION.aiURL).replace(/\/$/,'');
  const local = localStorage.getItem('appnesthesia_ai_url');
  if(local) return String(local).replace(/\/$/,'');
  return null;
}
function aiAvailable(){ return !!getAiURL(); }

// ============================================================
// NOTIFICACIONES PUSH REALES (Web Push vía Worker appnesthesia-push)
// pushURL y vapidPublicKey vienen de configs/<inst>.json.
// Si no están configuradas, todo queda inactivo sin romper nada.
// ============================================================
function getPushURL(){
  if(INSTITUTION && INSTITUTION.pushURL) return String(INSTITUTION.pushURL).replace(/\/$/,'');
  return null;
}
function getVapidPublic(){
  return (INSTITUTION && INSTITUTION.vapidPublicKey) || '';
}
function pushAvailable(){
  return !!(getPushURL() && getVapidPublic() && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window);
}
function _urlB64ToUint8(base64){
  const pad = '='.repeat((4 - base64.length % 4) % 4);
  const b64 = (base64 + pad).replace(/-/g,'+').replace(/_/g,'/');
  const raw = atob(b64);
  const arr = new Uint8Array(raw.length);
  for(let i=0;i<raw.length;i++) arr[i] = raw.charCodeAt(i);
  return arr;
}
// Suscribe ESTE dispositivo para recibir avisos de agendamiento (lo usa el admin).
async function enablePushNotifications(interactive){
  if(!pushAvailable()){
    if(interactive) alert('Las notificaciones push aún no están configuradas en la app.');
    return false;
  }
  try{
    const perm = await Notification.requestPermission();
    if(perm !== 'granted'){
      if(interactive) alert('Para recibir avisos, permite las notificaciones.\n\nEn iPhone: primero agrega la app a la pantalla de inicio (Compartir → Agregar a inicio) y ábrela desde ahí.');
      return false;
    }
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if(!sub){
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: _urlB64ToUint8(getVapidPublic())
      });
    }
    const headers = {'Content-Type':'application/json'};
    try{ const t = getBackendToken(); if(t) headers['Authorization'] = 'Bearer ' + t; }catch(e){}
    const r = await fetch(getPushURL() + '/api/subscribe', { method:'POST', headers, body: JSON.stringify(sub) });
    const data = await r.json().catch(()=>null);
    if(r.ok && data && data.ok){
      try{ localStorage.setItem('appnesthesia_push_on','1'); }catch(e){}
      if(interactive) alert('✅ Listo. Recibirás un aviso en este dispositivo cuando llegue una nueva solicitud de agendamiento.');
      updatePushBtn();
      return true;
    }
    if(interactive) alert('No se pudo activar el aviso: ' + ((data&&data.error)||('HTTP '+r.status)));
    return false;
  }catch(e){
    if(interactive) alert('No se pudo activar el aviso: ' + (e.message||e));
    return false;
  }
}
async function disablePushNotifications(){
  try{
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if(sub){
      const headers = {'Content-Type':'application/json'};
      try{ const t = getBackendToken(); if(t) headers['Authorization'] = 'Bearer ' + t; }catch(e){}
      try{ await fetch(getPushURL() + '/api/unsubscribe', { method:'POST', headers, body: JSON.stringify(sub) }); }catch(e){}
      await sub.unsubscribe();
    }
  }catch(e){}
  try{ localStorage.removeItem('appnesthesia_push_on'); }catch(e){}
  updatePushBtn();
}
// Dispara el envío de la push a los admin suscritos (al crear una solicitud).
// Envía una notificación push a los dispositivos suscritos (admin).
// El mensaje es genérico (no viaja info sensible); sirve para agendamiento,
// vacaciones y permisos por igual. El admin abre la app y ve qué hay pendiente.
function notifyAdminsPush(tipo, id){
  const base = getPushURL();
  if(!base) return;
  const headers = {'Content-Type':'application/json'};
  try{ const t = getBackendToken(); if(t) headers['Authorization'] = 'Bearer ' + t; }catch(e){}
  try{
    // Solo viaja tipo + id (NO datos de paciente). El id permite el deep-link.
    fetch(base + '/api/notify', { method:'POST', headers, body: JSON.stringify({ tipo: tipo || 'solicitud', id: id || '' }) }).catch(()=>{});
  }catch(e){}
}
// Alias para el agendamiento (mantiene compatibilidad).
function notifyAdminsOfNewRequest(reqId){ notifyAdminsPush('agendamiento', reqId); }

// ============================================================
// DEEP-LINK desde notificaciones push (?ic=<id> / ?agend=<id>)
// La notificación abre la solicitud EXACTA: si la app ya está abierta, el
// service worker manda un mensaje; si arranca en frío, se lee de la URL y se
// aplica al entrar a la institución (INSTITUTION disponible).
// ============================================================
let _appxPendingDeepLink = null;
function _appxParseDeepLink(urlStr){
  try{
    const qi = String(urlStr||'').indexOf('?');
    if(qi < 0) return null;
    const p = new URLSearchParams(String(urlStr).slice(qi+1));
    if(p.get('ic')) return { kind:'ic', id:p.get('ic') };
    if(p.get('agend')) return { kind:'agend', id:p.get('agend') };
    if(p.get('vev')) return { kind:'vev', id:p.get('vev') };
  }catch(e){}
  return null;
}
function _appxHandleDeepLink(urlStr){
  const dl = _appxParseDeepLink(urlStr);
  if(!dl) return;
  if(typeof INSTITUTION === 'undefined' || !INSTITUTION){ _appxPendingDeepLink = dl; return; }
  _appxApplyDeepLink(dl);
}
function _appxFlushPendingDeepLink(){
  if(_appxPendingDeepLink && typeof INSTITUTION !== 'undefined' && INSTITUTION){
    const dl = _appxPendingDeepLink; _appxPendingDeepLink = null;
    setTimeout(()=>{ try{ _appxApplyDeepLink(dl); }catch(e){} }, 150);
  }
}
function _appxApplyDeepLink(dl){
  if(!dl) return;
  if(dl.kind === 'ic'){ try{ icOpenRequestById(dl.id); }catch(e){} }
  else if(dl.kind === 'agend'){ try{ agendOpenRequestById(dl.id); }catch(e){} }
  else if(dl.kind === 'vev'){ try{ vascOpenEvalById(dl.id); }catch(e){} }
}
// Abre el módulo Interconsultas directo en el detalle de la solicitud dada.
function icOpenRequestById(id){
  const mod=document.getElementById('modulesScreen'); if(mod) mod.classList.add('hidden');
  const g=document.getElementById('guiasScreen'); if(g) g.classList.add('hidden');
  const s=document.getElementById('icScreen'); if(s) s.classList.remove('hidden');
  IC_UI.admin=false; IC_UI.view='seguimiento'; IC_UI.detailReturn='seguimiento';
  const t=new Date(); IC_UI.calYear=t.getFullYear(); IC_UI.calMonth=t.getMonth(); IC_UI.selectedDate=null;
  renderIcModule();
  const show=()=>{
    const scr=document.getElementById('icScreen'); if(!scr || scr.classList.contains('hidden')) return;
    const r=icLoadData().find(x=>x&&x.id===id && !x.deleted);
    if(r){ IC_UI.detailReturn='seguimiento'; IC_UI.detailId=id; IC_UI.view='detail'; }
    else { IC_UI.view='seguimiento'; }
    renderIcModule(); try{ updateIcBadges(); }catch(e){}
  };
  try{ icMarkSeen(); }catch(e){}
  try{ icSyncNow().then(show).catch(show); }catch(e){ show(); }
}
// Abre el módulo Agendamiento directo en el detalle de la solicitud dada.
function agendOpenRequestById(id){
  try{ openAgendamientoModule(); }catch(e){}
  const show=()=>{
    const scr=document.getElementById('agendScreen'); if(!scr || scr.classList.contains('hidden')) return;
    try{ if(_agendFindRequest(id)) agendOpenDetalle(id); }catch(e){}
  };
  try{ agendSyncNow().then(show).catch(show); }catch(e){ show(); }
}
// Muestra/actualiza el botón de activar avisos (solo admin)
function updatePushBtn(){
  const btn = document.getElementById('pushToggleBtn');
  if(!btn) return;
  const isAdmin = state && state.isAdmin;
  if(!isAdmin || !pushAvailable()){ btn.style.display = 'none'; return; }
  btn.style.display = '';
  let on = false;
  try{ on = localStorage.getItem('appnesthesia_push_on')==='1'; }catch(e){}
  btn.textContent = on ? '🔔 Avisos activados en este dispositivo' : '🔕 Activar avisos de agendamiento';
  btn.classList.toggle('on', on);
  // Botón "Probar push": solo para admin con avisos activados en este dispositivo.
  const test = document.getElementById('pushTestBtn');
  if(test) test.style.display = (on ? '' : 'none');
}
// Dispara una notificación de prueba a TODOS los dispositivos suscritos.
// Sirve para confirmar de extremo a extremo que el push funciona (token del
// worker correcto, suscripciones vivas, VAPID OK). Muestra el resultado real.
async function testPushFromBtn(){
  const base = getPushURL();
  if(!base){ alert('Push no configurado en la app.'); return; }
  if(!confirm('Se enviará un aviso de PRUEBA a todos los dispositivos suscritos (sonará/vibrará). ¿Continuar?')) return;
  const headers = {'Content-Type':'application/json'};
  try{ const t = getBackendToken(); if(t) headers['Authorization'] = 'Bearer ' + t; }catch(e){}
  try{
    const r = await fetch(base + '/api/notify', { method:'POST', headers, body: JSON.stringify({ tipo:'prueba' }) });
    const d = await r.json().catch(()=>null);
    if(r.status === 401){ alert('❌ El worker de push rechazó el token (401).\n\nRevisa que el secret APP_TOKEN del worker de push sea igual al token de la app.'); return; }
    if(r.ok && d && d.ok){
      alert('✅ Resultado de la prueba:\n\n'
        + '• Enviadas: '+(d.enviadas??'?')+'\n'
        + '• Con payload (deep-link): '+(d.conPayload??'?')+'\n'
        + '• Sin payload (genérico): '+(d.sinPayload??'?')+'\n'
        + '• Expiradas/eliminadas: '+(d.eliminadas??'?')+'\n'
        + '• Suscritos en total: '+(d.total??'?')+'\n'
        + '• Versión worker: '+(d.v||'—')+'\n\n'
        + 'Si "Con payload" es 0, las suscripciones no traen claves o el worker no es la versión nueva.');
      return;
    }
    alert('No se pudo enviar la prueba: ' + ((d&&d.error) || ('HTTP '+r.status)));
  }catch(e){ alert('No se pudo enviar la prueba: ' + (e.message||e)); }
}
function togglePushFromBtn(){
  let on = false;
  try{ on = localStorage.getItem('appnesthesia_push_on')==='1'; }catch(e){}
  if(on) disablePushNotifications();
  else enablePushNotifications(true);
}

// --- Base de conocimiento de ARIA (configs/aria-conocimiento.json) ---
// Guías y resúmenes que el equipo agrega; ARIA los usa como contexto.
let _ariaKB = null;
async function loadAriaKB(){
  if(_ariaKB !== null) return _ariaKB;
  try{
    const r = await fetch('configs/aria-conocimiento.json', {cache:'no-cache'});
    if(r.ok){
      const data = await r.json();
      _ariaKB = Array.isArray(data.entradas) ? data.entradas : [];
    } else { _ariaKB = []; }
  }catch(e){ _ariaKB = []; }
  return _ariaKB;
}

// --- RAG ligero: arma contexto con las filas de las tablas de la app
// que coinciden con la pregunta (coagulación, anticoagulantes, exámenes) ---
// Palabras demasiado comunes para usarse como gatillo (generan falsos positivos)
const _AI_STOPWORDS = new Set(['para','pero','como','cuando','cuanto','donde','porque','tiene','tienen','antes','despues','sobre','este','esta','estos','estas','paciente','pacientes','cirugia','cirugias','cirugía','dosis','manejo','hacer','hace','puedo','debo','seria','seguir','mejor','riesgo','caso','tipo','poco','mucho','algun','alguna','tener','quiero','saber','favor','ayuda','tabla','tablas','guia','guias','guía','guías']);

// Sinónimos / frases coloquiales → términos que usan las guías.
// Si la pregunta contiene un disparador, se agregan los términos canónicos
// para que el buscador encuentre la guía aunque no se use la palabra exacta.
const _AI_SINONIMOS = [
  { t:['marcapaso','mcp','dai','desfibrilador','resincronizador'], add:'marcapasos mcp dai dispositivo cardiaco' },
  { t:['anticonceptiv','estrogeno','pastilla anticonceptiva','terapia hormonal','aco '], add:'estrogenos anticonceptivos tromboprofilaxis' },
  { t:['embaraz','gestante','obstetric','cesarea','cesárea','trabajo de parto','parturienta'], add:'embarazo obstetrica cesarea parto preeclampsia' },
  { t:['preeclampsia','eclampsia','presion alta en el embarazo'], add:'preeclampsia eclampsia sulfato magnesio' },
  { t:['niñ','pediatric','pediátric','lactante','recien nacido','escolar'], add:'pediatrico pediatria niño' },
  { t:['presion alta','hipertens'], add:'hipertension hta' },
  { t:['azucar','azúcar','diabet','glicemia','glucosa','insulin'], add:'glicemia diabetes manejo glicemico' },
  { t:['sangrado','hemorrag','transfus','sangra mucho'], add:'transfusion masiva hemorragia sangrado' },
  { t:['alergi','reaccion alergica','shock anafilac','anafilax'], add:'anafilaxia alergia' },
  { t:['relajante muscular','rocuronio','vecuronio','sugammadex','neostigmina','tof','bloqueo neuromuscular','curar'], add:'bloqueo neuromuscular reversion sugammadex neostigmina monitoreo' },
  { t:['dolor postoperatorio','dolor post','analges','manejo del dolor'], add:'dolor agudo analgesia multimodal opioides' },
  { t:['nausea','náusea','vomito','vómito','ponv'], add:'nvpo nausea vomito postoperatorio' },
  { t:['coagulo','coágulo','trombosis','trombo','tep','tvp','embolia'], add:'tromboprofilaxis trombosis venosa' },
  { t:['antibiotic','antibiótic','profilaxis quirurgica'], add:'profilaxis antibiotica quirurgica cefazolina' },
  { t:['corticoid','cortisona','prednisona','suprarrenal','addison','hidrocortisona estres'], add:'corticoides suprarrenal estres perioperatorio' },
  { t:['tiroid','hipertiroid','bocio'], add:'tiroidea tormenta tiroides' },
  { t:['frio','frío','temperatura','hipotermia','tirita'], add:'hipotermia temperatura normotermia' },
  { t:['testigo de jehova','jehova','rechaza transfusion','no acepta sangre'], add:'testigo jehova sangre patient blood management' },
  { t:['cefalea','dolor de cabeza','pospuncion','pospunción','post puncion','parche hematico'], add:'cppd cefalea pospuncion dural' },
  { t:['feocromocitoma','catecolamina'], add:'feocromocitoma fenoxibenzamina' },
  { t:['aspiracion','aspiración','broncoaspir','estomago lleno','mendelson'], add:'aspiracion pulmonar neumonitis estomago lleno' },
  { t:['hiperkalemia','hipercalemia','potasio alto','hiperpotasemia'], add:'hiperkalemia potasio' },
  { t:['hipertension pulmonar','pulmonary hypertension','hap'], add:'hipertension pulmonar' },
  { t:['fibrilacion auricular','fibrilación','arritmia','aco fa'], add:'fibrilacion auricular periop arritmia' },
  { t:['sepsis','septico','shock septico'], add:'sepsis perioperatoria' },
  { t:['ventilacion','ventilación protectora','volumen tidal','sdra','distrés'], add:'ventilacion protectora intraoperatoria sdra' },
  { t:['despierto','despertar intraop','awareness','consciente en pabellon'], add:'awareness despertar intraoperatorio' },
];

function _aiBuildContext(question){
  let q = _gpNorm(question);
  // Expandir con sinónimos: si la pregunta dispara un término, lo agregamos
  try{
    _AI_SINONIMOS.forEach(s=>{
      if(s.t.some(trig => q.includes(_gpNorm(trig)))) q += ' ' + _gpNorm(s.add);
    });
  }catch(e){}
  const words = q.split(/\s+/).filter(w => w.length >= 4 && !_AI_STOPWORDS.has(w));
  if(words.length === 0) return '';
  const matches = [];

  // 1) Tablas de coagulación neuroaxial (ASRA/ESAIC/SACH)
  try{
    COAGULACION_DATA.forEach(sec=>{
      sec.drugs.forEach(d=>{
        const hay = _gpNorm(d.name + ' ' + (d.cat_full||''));
        if(words.some(w => hay.includes(w))){
          matches.push(`[Coagulación·${sec.cat} — FUENTE: ${d.cat_full||'ASRA 2018 / ESAIC 2022 / SACH'}] ${d.name} → Suspender: ${d.pre} | Reiniciar: ${d.post}`);
        }
      });
    });
  }catch(e){}

  // 1b) Tabla NEUROAXIAL ASRA 2025 (punción / catéter / reinicio)
  try{
    ASRA_NEURAXIAL_2025.forEach(sec=>{
      sec.drugs.forEach(d=>{
        const hay = _gpNorm(d.name + ' ' + sec.grupo + ' ' + (d.aliases||[]).join(' '));
        if(words.some(w => hay.includes(w))){
          matches.push(`[Neuroaxial·${sec.grupo} — FUENTE: ${d.fuente||'ASRA 2025 (5ª ed)'}] ${d.name} → Punción/bloqueo: ${d.puncion} | Retiro de catéter: ${d.cateter} | Reinicio: ${d.reinicio}${d.mantencion?' | Mantención catéter: '+d.mantencion:''}`);
        }
      });
    });
  }catch(e){}

  // 2) Tabla de anticoagulantes perioperatorios (Portal Preanestésico)
  try{
    ANTICOAG_TABLE.forEach(r=>{
      const hay = _gpNorm(r.farmaco + ' ' + r.grupo);
      if(words.some(w => hay.includes(w))){
        matches.push(`[Periop·${r.grupo} — FUENTE: ACC/AHA Periprocedural Antithrombotic; ESC 2022] ${r.farmaco} → Suspender: ${r.suspender} | Reiniciar: ${r.reiniciar}`);
      }
    });
  }catch(e){}

  // 3) Exámenes específicos por comorbilidad
  try{
    EXAM_PREOP_ESPECIFICOS.forEach(r=>{
      const hay = _gpNorm(r.cond + ' ' + r.pedir);
      if(words.some(w => hay.includes(w))){
        matches.push(`[Exámenes preop — FUENTE: AHA/ACC 2024; ESC 2022; eval. preop. CUA] ${r.cond} → ${r.pedir}. ${r.nota||''}`);
      }
    });
  }catch(e){}

  // 4) Base de conocimiento ARIA (guías) — con puntaje de relevancia.
  // Cuenta coincidencias por keyword (exacta o parcial) y por título; las
  // guías más relevantes quedan primero.
  try{
    const scored = [];
    (_ariaKB||[]).forEach(e=>{
      if(!e || !e.contenido) return;
      const kws = (e.keywords||[]).map(_gpNorm);
      const hayTitulo = _gpNorm(e.titulo||'');
      let score = 0;
      kws.forEach(kw=>{
        if(!kw) return;
        if(q.includes(kw)) score += 2;                                  // keyword completa en la pregunta
        else if(words.some(w => kw.includes(w) || w.includes(kw))) score += 1; // parcial
      });
      words.forEach(w=>{ if(hayTitulo.includes(w)) score += 1; });
      if(score > 0) scored.push({ score, e });
    });
    scored.sort((a,b)=> b.score - a.score);
    scored.forEach(({e})=> matches.push('[Guía: ' + (e.titulo||e.id) + (e.fuente ? ' — FUENTE: ' + e.fuente : '') + '] ' + e.contenido));
  }catch(e){}

  // 4b) PROTOCOLOS INSTITUCIONALES (configs/protocolos.json) — prioridad alta.
  // Se anteponen para que ARIA cruce la respuesta con el protocolo local.
  try{
    const inst = (_protocolosInst||[]).filter(p=>p && (p.texto||p.resumen||p.body));
    const scoredP = [];
    inst.forEach(p=>{
      const texto = p.texto || p.resumen || p.body || '';
      const kws = (p.keywords||[]).map(_gpNorm);
      const hayTitulo = _gpNorm((p.titulo||p.title||'') + ' ' + texto);
      let score = 0;
      kws.forEach(kw=>{ if(!kw) return; if(q.includes(kw)) score += 2; else if(words.some(w=> kw.includes(w) || w.includes(kw))) score += 1; });
      words.forEach(w=>{ if(hayTitulo.includes(w)) score += 1; });
      if(score > 0) scoredP.push({ score, p, texto });
    });
    scoredP.sort((a,b)=> b.score - a.score);
    scoredP.forEach(({p, texto})=> matches.unshift('[PROTOCOLO INSTITUCIONAL — ' + ((INSTITUTION&&INSTITUTION.shortName)||'Clínica Universidad de los Andes') + ' · ' + (p.titulo||p.title||p.id) + (p.fuente?' — '+p.fuente:'') + '] ' + texto));
  }catch(e){}

  // 6) PABELLÓN DE URGENCIA (bloques postergables) — si la pregunta lo toca,
  // se antepone el contexto con las designaciones vigentes (hoy + 2 semanas).
  try{ const pu = _aiPabUrgContext(q); if(pu) matches.unshift(pu); }catch(e){}

  // 5) Si pregunta por riesgo/METs/RCRI, incluir referencia corta
  if(/riesgo|mets?|rcri|cardiolog|isquemia|esfuerzo|dobutamina/.test(q)){
    try{
      matches.push('[RCRI] Factores: ' + RCRI_FACTORES.join(' · '));
      matches.push('[RCRI riesgo] ' + RCRI_RIESGO.map(r=>r.n+': '+r.riesgo).join(' · '));
      matches.push('[Umbral — FUENTE: AHA/ACC 2024; ESC 2022; Lee RCRI 1999] 4 METs = subir 1 piso de escalera / caminar 6 km/h sin síntomas. CF<4 METs + riesgo elevado → eval cardiológica; test de isquemia solo si cambia conducta.');
    }catch(e){}
  }
  return matches.slice(0, 25).join('\n');
}

// --- Turnstile (anti-bots) — opcional, gatillado por INSTITUTION.turnstileSiteKey ---
function _turnstileSiteKey(){
  return (INSTITUTION && INSTITUTION.turnstileSiteKey) || '';
}
let _tsScriptLoading = null;
function _loadTurnstileScript(){
  if(window.turnstile) return Promise.resolve();
  if(_tsScriptLoading) return _tsScriptLoading;
  _tsScriptLoading = new Promise((resolve, reject)=>{
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true; s.defer = true;
    s.onload = ()=>resolve();
    s.onerror = ()=>reject(new Error('No se pudo cargar Turnstile'));
    document.head.appendChild(s);
  });
  return _tsScriptLoading;
}
let _tsWidgetId = null;
// Obtiene un token fresco de Turnstile (un solo uso). Devuelve '' si no está configurado.
async function _getTurnstileToken(){
  const siteKey = _turnstileSiteKey();
  if(!siteKey) return '';
  try{
    await _loadTurnstileScript();
    // Contenedor oculto reutilizable
    let cont = document.getElementById('tsContainer');
    if(!cont){
      cont = document.createElement('div');
      cont.id = 'tsContainer';
      cont.style.cssText = 'position:fixed;bottom:0;left:0;width:0;height:0;overflow:hidden;opacity:0;pointer-events:none';
      document.body.appendChild(cont);
    }
    return await new Promise((resolve)=>{
      let done = false;
      const finish = (tok)=>{ if(!done){ done = true; resolve(tok||''); } };
      const opts = {
        sitekey: siteKey,
        appearance: 'interaction-only',
        callback: (token)=>finish(token),
        'error-callback': ()=>finish(''),
        'timeout-callback': ()=>finish('')
      };
      try{
        if(_tsWidgetId !== null){
          window.turnstile.reset(_tsWidgetId);
          window.turnstile.execute(_tsWidgetId, opts);
        } else {
          _tsWidgetId = window.turnstile.render('#tsContainer', opts);
          window.turnstile.execute(_tsWidgetId, opts);
        }
      }catch(e){ finish(''); }
      // Salvaguarda: no bloquear más de 8 s
      setTimeout(()=>finish(''), 8000);
    });
  }catch(e){ return ''; }
}

async function _aiCall(payload){
  const base = getAiURL();
  if(!base) throw new Error('IA no configurada');
  const headers = {'Content-Type':'application/json'};
  try{ const t = getBackendToken(); if(t) headers['Authorization'] = 'Bearer ' + t; }catch(e){}
  // Adjuntar token de Turnstile si la institución lo tiene configurado
  try{
    const ts = await _getTurnstileToken();
    if(ts) payload = {...payload, turnstileToken: ts};
  }catch(e){}
  const r = await fetch(base + '/api/ai', { method:'POST', headers, body: JSON.stringify(payload) });
  const data = await r.json().catch(()=>null);
  if(!r.ok || !data || !data.ok) throw new Error((data && data.error) || ('HTTP ' + r.status));
  return data.answer;
}

// --- UI del chat ---
function openAiChat(){
  if(!aiAvailable()){ alert('El asistente de IA aún no está configurado.\n\nDespliega el Worker de la carpeta worker-ia y agrega "aiURL" en configs/andes.json.'); return; }
  try{ loadAriaKB(); }catch(e){}
  try{ loadProtocolosInst(); }catch(e){}
  document.getElementById('aiChatOverlay').classList.remove('hidden');
  _aiRenderMessages();
  setTimeout(()=>{ try{ document.getElementById('aiChatInput').focus(); }catch(e){} }, 150);
}
function closeAiChat(){
  document.getElementById('aiChatOverlay').classList.add('hidden');
}
function _aiEsc(s){ return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function _aiRenderMessages(){
  const box = document.getElementById('aiChatMsgs');
  if(!box) return;
  let html = `
    <div class="ai-msg ai-msg-bot">
      <div class="ai-msg-bubble">👋 Hola, soy <b>ARIA</b> — <b>A</b>sistente de <b>R</b>eferencia e <b>I</b>nformación <b>A</b>nestésica de Appnesthesia. Pregúntame sobre suspensión de anticoagulantes, exámenes preoperatorios, riesgo cardiovascular, profilaxis ATB y TVP, el <b>Pabellón de Urgencia</b> (¿qué bloque es postergable hoy?), y más. Respondo usando las tablas y guías de la app (AHA/ACC, ESC, ASRA, ASA…) y <b>cito siempre la fuente</b>.<br><span class="ai-disclaimer">⚠️ Apoyo clínico — la decisión final es siempre del anestesiólogo. No incluyas nombres ni RUT de pacientes.</span></div>
    </div>`;
  _aiMessages.forEach(m=>{
    const cls = m.role === 'user' ? 'ai-msg-user' : 'ai-msg-bot';
    html += `<div class="ai-msg ${cls}"><div class="ai-msg-bubble">${_aiEsc(m.content).replace(/\n/g,'<br>')}</div></div>`;
  });
  if(_aiBusy){
    html += `<div class="ai-msg ai-msg-bot"><div class="ai-msg-bubble ai-typing"><span></span><span></span><span></span></div></div>`;
  }
  box.innerHTML = html;
  box.scrollTop = box.scrollHeight;
}
async function aiSendMessage(){
  if(_aiBusy) return;
  try{ await loadAriaKB(); }catch(e){}
  const input = document.getElementById('aiChatInput');
  const text = (input.value||'').trim();
  if(!text) return;
  input.value = '';
  _aiMessages.push({role:'user', content:text});
  _aiBusy = true;
  _aiRenderMessages();
  try{
    const context = _aiBuildContext(text);
    const answer = await _aiCall({ mode:'asistente', messages:_aiMessages, context });
    _aiMessages.push({role:'assistant', content:answer});
  }catch(e){
    _aiMessages.push({role:'assistant', content:'❌ No pude responder: ' + (e.message||e) + '\nRevisa la conexión o que el Worker de IA esté desplegado.'});
  }finally{
    _aiBusy = false;
    // Limitar historial para no crecer infinito
    if(_aiMessages.length > 20) _aiMessages = _aiMessages.slice(-20);
    _aiRenderMessages();
  }
}
function aiChatKeydown(ev){
  if(ev.key === 'Enter' && !ev.shiftKey){ ev.preventDefault(); aiSendMessage(); }
}
function aiClearChat(){
  _aiMessages = [];
  _aiRenderMessages();
}
// Mostrar/ocultar los botones de IA según configuración
function updateAiButtons(){
  const on = aiAvailable();
  document.querySelectorAll('.ai-entry-btn').forEach(el=>{ el.style.display = on ? '' : 'none'; });
}

// --- Análisis IA de una solicitud de agendamiento (modo admin) ---
async function aiAnalizarSolicitud(reqId){
  if(!aiAvailable()){ alert('El asistente de IA aún no está configurado.'); return; }
  const found = _agendFindRequest(reqId);
  if(!found) return;
  const r = found.req;
  const sala = _agendGetSala(found.salaId);
  const unidad = _agendGetUnidad(r.unidadCode);
  // IMPORTANTE: NO enviar datos identificables (nombre, RUT, solicitante, teléfono, email)
  const solicitud = {
    sala: sala ? sala.name : found.salaId,
    fecha: found.dateStr,
    bloque_u_horario: (r.block ? ('Bloque ' + r.block) : ((typeof r.startMin==='number') ? (_agendMinToHHMM(r.startMin) + '–' + _agendMinToHHMM(r.endMin)) : '—')),
    estado: r.estado,
    es_extra: !!r.isExtra,
    edad_paciente: r.edad || null,
    peso_kg: r.peso || undefined,
    asa: r.asa || undefined,
    ayuno: r.ayuno ? _agendAyunoLabel(r.ayuno) : undefined,
    tipo_anestesia_solicitada: r.tipoAnestesia ? _agendTipoAnestLabel(r.tipoAnestesia) : undefined,
    alergias: r.alergias || undefined,
    anticoagulantes: r.anticoag || undefined,
    procedimiento: r.procedimiento || '',
    prioridad: r.prioridad || 'electiva',
    antecedentes: r.notas || '',
    unidad_solicitante: unidad ? unidad.name : (r.unidadCode||''),
    accesos_lado: r.accesosLado || undefined,
    accesos_urgencia: r.accesosUrgencia || undefined,
    accesos_hallazgos: r.accesosHallazgos || undefined,
    accesos_coagulacion: r.accesosCoagulacion || undefined,
    accesos_tratamiento: r.accesosTratamiento || undefined,
    accesos_tipo_infusion: r.accesosInfusion || undefined,
    accesos_duracion_tratamiento: r.accesosDuracion || undefined,
    accesos_diva_acceso_dificil: r.accesosDiva ? (r.accesosDiva === 'si' ? 'SÍ — acceso venoso difícil' : 'no') : undefined
  };
  const cont = document.getElementById('aiVisadoResult');
  if(cont){
    cont.style.display = '';
    cont.innerHTML = '<div class="ai-visado-loading">🤖 ARIA está analizando la solicitud…</div>';
  }
  try{
    const answer = await _aiCall({ mode:'visado', solicitud });
    if(cont) cont.innerHTML = '<div class="ai-visado-card"><div class="ai-visado-title">🤖 Análisis de ARIA</div><div class="ai-visado-body">' + _aiEsc(answer).replace(/\n/g,'<br>') + '</div></div>';
  }catch(e){
    if(cont) cont.innerHTML = '<div class="ai-visado-card error">❌ No se pudo analizar: ' + _aiEsc(e.message||String(e)) + '</div>';
  }
}

// ============================================================
// BUSCADOR GLOBAL · AYUDA · TAMAÑO DE LETRA
// ============================================================
// Cierra cualquier pantalla/overlay para luego navegar limpio.
function _searchCloseAll(){
  ['guiasScreen','agendScreen','calcOverlay','aiChatOverlay','modulesScreen','searchOverlay','helpOverlay'].forEach(id=>{
    const e=document.getElementById(id); if(e) e.classList.add('hidden');
  });
  try{ closeModal(); }catch(e){}
}
function _goView(v){ _searchCloseAll(); try{ showView(v); }catch(e){} }
function _goPortal(sec){ _searchCloseAll(); try{ openGuiasModule(); if(sec) setTimeout(()=>{ try{ openGuiasSection(sec); }catch(e){} }, 60); }catch(e){} }

// Índice de destinos buscables (secciones y herramientas)
const SEARCH_INDEX = [
  { ico:'🏠', label:'Inicio', hint:'Pantalla principal', kw:'inicio home principal', go:()=>_goView('home') },
  { ico:'📅', label:'Calendario de turnos', hint:'Turnos del servicio', kw:'calendario turnos rol', go:()=>_goView('calendario') },
  { ico:'📊', label:'Horario en línea', hint:'Excel del rol', kw:'horario excel onedrive rol', go:()=>_goView('horario') },
  { ico:'🏆', label:'Índice de permanencia', hint:'Ranking y puntaje', kw:'indice permanencia ranking puntaje', go:()=>_goView('indice') },
  { ico:'🛡️', label:'Cobertura de emergencia', hint:'Listado de cobertura', kw:'cobertura emergencia urgencia', go:()=>_goView('cobertura') },
  { ico:'🔄', label:'Intercambio de turnos', hint:'Ofrecer o tomar turnos', kw:'intercambio turnos cambio permuta llamada', go:()=>_goView('intercambios') },
  { ico:'🌴', label:'Vacaciones', hint:'Solicitudes y aprobaciones', kw:'vacaciones permiso solicitud feriado', go:()=>_goView('vacaciones') },
  { ico:'📈', label:'Estadísticas del servicio', hint:'Indicadores', kw:'estadisticas indicadores produccion', go:()=>_goView('estadisticas') },
  { ico:'👤', label:'Mi Panel', hint:'Perfil y preferencias', kw:'mi panel perfil preferencias cuenta', go:()=>_goView('mipanel') },
  { ico:'🎉', label:'Calendario de Eventos', hint:'Reuniones y cumpleaños', kw:'eventos reuniones cumpleaños conmemorativo', go:()=>_goView('eventos') },
  { ico:'📄', label:'Protocolos', hint:'Guías del servicio', kw:'protocolos guias eras', go:()=>_goView('protocolos') },
  { ico:'🧒', label:'Pediatría', hint:'Dosis por kg', kw:'pediatria pediatrico dosis niño kg', go:()=>_goView('pediatria') },
  { ico:'🩸', label:'Coagulación · ASRA neuroaxial', hint:'Suspensión de anticoagulantes', kw:'coagulacion asra anticoagulantes neuroaxial heparina enoxaparina espinal', go:()=>_goView('coagulacion') },
  { ico:'💉', label:'Anestesia Regional', hint:'Bloqueos por zona', kw:'regional bloqueo nervio nysora hombro cadera rodilla peng', go:()=>_goView('regional') },
  { ico:'🧮', label:'Calculadoras Perioperatorias', hint:'AL, pesos, vasoactivos, VFG, MABL', kw:'calculadora calculo anestesico local peso ideal vasoactivo infusion renal vfg perdida sanguinea mabl', go:()=>{ _searchCloseAll(); try{ openCalculadoras(); }catch(e){} } },
  { ico:'🤖', label:'ARIA · Asistente IA', hint:'Pregunta en lenguaje natural', kw:'aria ia asistente inteligencia pregunta', go:()=>{ _searchCloseAll(); try{ openAiChat(); }catch(e){} } },
  { ico:'🗓️', label:'Agendamiento de procedimientos', hint:'Solicitar / visar', kw:'agendamiento agenda procedimiento solicitud sala resonancia picc', go:()=>{ _searchCloseAll(); try{ showModulesScreen(); setTimeout(()=>{ try{ openAgendamientoModule(); }catch(e){} },60); }catch(e){} } },
  { ico:'🩺', label:'Portal Preanestésico', hint:'Preparación del paciente', kw:'portal preanestesico preanestesia preparacion', go:()=>_goPortal(null) },
  { ico:'✉️', label:'Interconsultas a Anestesiología', hint:'Módulo · Solicitar / Administrar', kw:'interconsulta interconsultas dolor evaluacion preanestesica procedimiento solicitud unidad pieza derivacion', go:()=>{ _searchCloseAll(); try{ openIcModule(); }catch(e){} } },
  { ico:'🚨', label:'Pabellón de Urgencia', hint:'Bloques postergables · rotación 2026', kw:'pabellon urgencia urgencias bloques postergables postergable rotacion equitativa emergencia quirurgica', go:()=>{ _searchCloseAll(); try{ openPabUrgModule(); }catch(e){} } },
  { ico:'🍽️', label:'Ayuno Preoperatorio', hint:'Portal Preanestésico', kw:'ayuno preoperatorio glp ozempic', go:()=>_goPortal('gpAyuno') },
  { ico:'💊', label:'Fármacos a Suspender', hint:'Portal Preanestésico', kw:'farmacos suspender medicamentos preop', go:()=>_goPortal('gpSusp') },
  { ico:'🧪', label:'Exámenes Preoperatorios', hint:'Portal Preanestésico', kw:'examenes preoperatorios laboratorio asa', go:()=>_goPortal('gpExam') },
  { ico:'❤️', label:'Riesgo Cardiovascular (RCRI/METs)', hint:'Portal Preanestésico', kw:'riesgo cardiovascular rcri mets cardiologia', go:()=>_goPortal('gpRiesgoCv') },
  { ico:'🦵', label:'Riesgo TVP/TEP (Caprini)', hint:'Portal Preanestésico', kw:'caprini tev tromboembolismo trombosis venosa profunda tromboembolismo pulmonar tromboprofilaxis profilaxis tvp tep', go:()=>_goPortal('gpRiesgoTev') },
  { ico:'🤢', label:'Riesgo de NVPO (Apfel)', hint:'Calculadoras Perioperatorias', kw:'apfel nvpo nauseas vomitos ponv antiemetico', go:()=>{ _searchCloseAll(); try{ openCalculadoras(); setTimeout(()=>{ try{ calcSelect('apfel'); }catch(e){} },60); }catch(e){} } },
  { ico:'🫁', label:'Riesgo pulmonar (ARISCAT)', hint:'Calculadoras Perioperatorias', kw:'ariscat complicaciones pulmonares riesgo respiratorio atelectasia neumonia', go:()=>{ _searchCloseAll(); try{ openCalculadoras(); setTimeout(()=>{ try{ calcSelect('ariscat'); }catch(e){} },60); }catch(e){} } },
];

// Menú compacto del encabezado (agrupa buscar, ayuda/ajustes y config admin)
function openAppMenu(){
  const isAdmin = state && state.isAdmin;
  modal(`
    <h3 style="margin:0 0 12px">Menú</h3>
    <button type="button" class="help-card-btn" onclick="closeModal();openGlobalSearch();"><span class="hi">🔎</span><span style="flex:1"><b>Buscar en la app</b><span>Salta a cualquier sección o herramienta</span></span></button>
    <button type="button" class="help-card-btn" onclick="closeModal();openHelp();"><span class="hi">🔧</span><span style="flex:1"><b>Ayuda y ajustes</b><span>Tema, tamaño de letra, tutorial</span></span></button>
    <button type="button" class="help-card-btn" onclick="closeModal();openAiChat();"><span class="hi">🤖</span><span style="flex:1"><b>Preguntar a ARIA</b><span>Asistente clínico</span></span></button>
    ${isAdmin?`<button type="button" class="help-card-btn" onclick="closeModal();promptBackendToken();"><span class="hi">🔌</span><span style="flex:1"><b>Configuración de conexión</b><span>Backend / token (administrador)</span></span></button>`:''}
    <div style="text-align:right;margin-top:6px"><button class="btn" onclick="closeModal()">Cerrar</button></div>
  `);
}

function openGlobalSearch(){
  document.getElementById('searchOverlay').classList.remove('hidden');
  const inp = document.getElementById('globalSearchInput');
  if(inp){ inp.value=''; setTimeout(()=>inp.focus(), 60); }
  renderGlobalSearch();
}
function closeGlobalSearch(){ document.getElementById('searchOverlay').classList.add('hidden'); }
function renderGlobalSearch(){
  const q = _gpNorm(document.getElementById('globalSearchInput')?.value || '');
  const cont = document.getElementById('globalSearchResults');
  if(!cont) return;
  let items = SEARCH_INDEX;
  if(q){
    const words = q.split(/\s+/).filter(Boolean);
    items = SEARCH_INDEX.filter(it=>{
      const hay = _gpNorm(it.label + ' ' + it.hint + ' ' + it.kw);
      return words.every(w => hay.includes(w));
    });
  }
  if(items.length === 0){
    cont.innerHTML = `<div class="search-empty">Sin resultados para "${(document.getElementById('globalSearchInput').value||'').replace(/</g,'&lt;')}"</div>`;
    return;
  }
  const head = q ? '' : '<div class="search-hint">Todas las secciones y herramientas:</div>';
  cont.innerHTML = head + items.map((it,i)=>
    `<button type="button" class="search-item" data-i="${SEARCH_INDEX.indexOf(it)}" onclick="_searchPick(${SEARCH_INDEX.indexOf(it)})"><span class="si">${it.ico}</span><span style="flex:1;min-width:0"><b>${it.label}</b><span>${it.hint}</span></span></button>`
  ).join('');
}
function _searchPick(i){
  const it = SEARCH_INDEX[i];
  closeGlobalSearch();
  if(it && typeof it.go === 'function') it.go();
}

// --- Tema claro / oscuro ---
function applyTheme(){
  let t = 'light';
  try{ t = localStorage.getItem('appnesthesia_theme') || 'dark'; }catch(e){}
  if(t === 'dark') document.documentElement.setAttribute('data-theme','dark');
  else document.documentElement.removeAttribute('data-theme');
  // Color de la barra del navegador acorde al tema
  try{ const m=document.querySelector('meta[name="theme-color"]'); if(m) m.setAttribute('content', t==='dark'?'#0e1714':'#0f4435'); }catch(e){}
  return t;
}
function setTheme(mode){
  try{ localStorage.setItem('appnesthesia_theme', mode); }catch(e){}
  applyTheme();
  try{ openHelp(); }catch(e){}
}

// --- Ayuda y ajustes (incluye tamaño de letra) ---
const _FS_LEVELS = [1, 1.15, 1.30];
function applyFontScale(){
  let lvl = 0;
  try{ lvl = parseInt(localStorage.getItem('appnesthesia_fontscale')||'0',10) || 0; }catch(e){}
  if(lvl<0||lvl>2) lvl=0;
  try{ document.documentElement.style.zoom = _FS_LEVELS[lvl]; }catch(e){}
  return lvl;
}
function setFontScale(lvl){
  try{ localStorage.setItem('appnesthesia_fontscale', String(lvl)); }catch(e){}
  applyFontScale();
  try{ openHelp(); }catch(e){} // re-render para marcar el botón activo
}
function openHelp(){
  let lvl = 0;
  try{ lvl = parseInt(localStorage.getItem('appnesthesia_fontscale')||'0',10) || 0; }catch(e){}
  let tema = 'light';
  try{ tema = localStorage.getItem('appnesthesia_theme') || 'dark'; }catch(e){}
  modal(`
    <h3 style="margin:0 0 4px">Ayuda y ajustes</h3>
    <p style="font-size:12.5px;color:var(--muted);margin:0 0 14px">Encuentra ayuda y personaliza la app.</p>

    <div style="font-size:12px;font-weight:800;color:var(--primary-dark);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Tema</div>
    <div class="help-fs-row">
      <button type="button" class="help-fs-btn ${tema!=='dark'?'on':''}" onclick="setTheme('light')">☀️ Claro</button>
      <button type="button" class="help-fs-btn ${tema==='dark'?'on':''}" onclick="setTheme('dark')">🌙 Oscuro</button>
    </div>
    <p style="font-size:11px;color:var(--muted);margin:2px 0 16px">Cambia entre tema claro y oscuro. Se recuerda en este dispositivo.</p>

    <div style="font-size:12px;font-weight:800;color:var(--primary-dark);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Tamaño de letra</div>
    <div class="help-fs-row">
      <button type="button" class="help-fs-btn ${lvl===0?'on':''}" style="font-size:13px" onclick="setFontScale(0)">A</button>
      <button type="button" class="help-fs-btn ${lvl===1?'on':''}" style="font-size:16px" onclick="setFontScale(1)">A+</button>
      <button type="button" class="help-fs-btn ${lvl===2?'on':''}" style="font-size:19px" onclick="setFontScale(2)">A++</button>
    </div>
    <p style="font-size:11px;color:var(--muted);margin:2px 0 16px">Agranda todo el contenido de la app. Se recuerda en este dispositivo.</p>

    <div style="font-size:12px;font-weight:800;color:var(--primary-dark);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">Ayuda</div>
    <a class="help-card-btn" href="tutorial.html" target="_blank" rel="noopener"><span class="hi">🎬</span><span style="flex:1"><b>Ver tutorial de agendamiento</b><span>Cómo solicitar una hora, paso a paso</span></span></a>
    <button type="button" class="help-card-btn" onclick="closeModal();openAiChat();"><span class="hi">🤖</span><span style="flex:1"><b>Preguntar a ARIA</b><span>Asistente clínico en lenguaje natural</span></span></button>
    <button type="button" class="help-card-btn" onclick="closeModal();openGlobalSearch();"><span class="hi">🔎</span><span style="flex:1"><b>Buscar en la app</b><span>Salta a cualquier sección o herramienta</span></span></button>

    <div style="text-align:right;margin-top:8px"><button class="btn" onclick="closeModal()">Cerrar</button></div>
  `);
}

// ============================================================
// CALCULADORAS CLÍNICAS PERIOPERATORIAS
// Panel reutilizable abierto desde Portal Preanestésico y Staff.
// Todas son REFERENCIA — la decisión es del anestesiólogo a cargo.
// ============================================================
const CALC_LIST = [
  { key:'al',   ico:'💉', name:'Anestésico local', desc:'Dosis máxima (mg y mL)' },
  { key:'peso', ico:'⚖️', name:'Pesos para dosificar', desc:'Ideal · ajustado · magro' },
  { key:'vaso', ico:'💧', name:'Drogas vasoactivas', desc:'µg/kg/min ↔ mL/h' },
  { key:'vfg',  ico:'🫘', name:'Función renal (VFG)', desc:'Cockcroft-Gault · CKD-EPI' },
  { key:'mabl', ico:'🩸', name:'Pérdida sanguínea', desc:'Volemia y MABL permitida' },
  { key:'apfel', ico:'🤢', name:'Riesgo de NVPO (Apfel)', desc:'Náuseas/vómitos · profilaxis' },
  { key:'ariscat', ico:'🫁', name:'Riesgo pulmonar (ARISCAT)', desc:'Complicaciones pulmonares postop' },
  { key:'caprini', ico:'🦵', name:'Riesgo TVP/TEP (Caprini)', desc:'Tromboembolismo venoso · profilaxis' },
];
let _calcSel = null;

function openCalculadoras(){
  _calcSel = null;
  document.getElementById('calcOverlay').classList.remove('hidden');
  calcRenderHome();
}
function closeCalculadoras(){ document.getElementById('calcOverlay').classList.add('hidden'); }
function calcBack(){
  // Contextual: dentro de una calculadora vuelve al menú; en el menú cierra el módulo.
  if(_calcSel){ _calcSel = null; calcRenderHome(); }
  else { closeCalculadoras(); }
}

function calcRenderHome(){
  document.getElementById('calcTitle').textContent = 'Calculadoras Perioperatorias';
  document.getElementById('calcBackBtn').style.display = ''; // siempre visible (en el menú = cerrar)
  const cards = CALC_LIST.map(c =>
    `<button type="button" class="calc-card" onclick="calcSelect('${c.key}')"><div class="ci">${c.ico}</div><b>${c.name}</b><span>${c.desc}</span></button>`
  ).join('');
  document.getElementById('calcBody').innerHTML = `
    <div class="calc-grid">${cards}</div>
    <div class="calc-xref">
      <b>¿Buscas otra cosa?</b><br>
      • <b>Riesgo cardiovascular</b> (RCRI, METs): ve al botón <a onclick="closeCalculadoras();openGuiasModule&&openGuiasModule();">Portal Preanestésico → Riesgo Cardiovascular</a>.<br>
      • <b>Exámenes preoperatorios</b>: Portal Preanestésico → Exámenes.<br>
      • <b>Dosis de fármacos pediátricos por kg</b>: Staff → <a onclick="closeCalculadoras();showView('pediatria');">Pediatría</a>.<br>
      • <b>Coagulación / ASRA neuroaxial</b>: Staff → <a onclick="closeCalculadoras();showView('coagulacion');">Coagulación</a>.
    </div>
    <div class="calc-disc">⚠️ Todas las calculadoras son una referencia de apoyo. Verifica el resultado y la decisión final es del anestesiólogo a cargo del paciente.</div>`;
}
function calcSelect(key){
  _calcSel = key;
  const c = CALC_LIST.find(x=>x.key===key);
  document.getElementById('calcTitle').textContent = c ? c.name : 'Calculadora';
  document.getElementById('calcBackBtn').style.display = '';
  const r = { al:_calcAL, peso:_calcPeso, vaso:_calcVaso, vfg:_calcVFG, mabl:_calcMABL, apfel:_calcApfel, ariscat:_calcAriscat, caprini:_renderCapriniCalcCard }[key];
  document.getElementById('calcBody').innerHTML = r ? r() : '';
}
function _cNum(id){ const el=document.getElementById(id); const v=parseFloat((el&&el.value||'').replace(',','.')); return isNaN(v)?null:v; }
function _cVal(id){ const el=document.getElementById(id); return el?el.value:''; }
function _cFmt(n,d){ if(n===null||n===undefined||isNaN(n)) return '—'; return Number(n).toLocaleString('es-CL',{maximumFractionDigits:d===undefined?1:d}); }
function _cResult(html){ const o=document.getElementById('calcOut'); if(o) o.innerHTML='<div class="gp-calc-result">'+html+'</div>'; }

// 1) Anestésico local --------------------------------------------------------
const _AL_MAX = {
  lidocaina:{sin:4.5,con:7,aSin:300,aCon:500,n:'Lidocaína'},
  mepivacaina:{sin:4.5,con:7,aSin:400,aCon:550,n:'Mepivacaína'},
  bupivacaina:{sin:2,con:3,aSin:175,aCon:225,n:'Bupivacaína'},
  levobupivacaina:{sin:2,con:3,aSin:150,aCon:200,n:'Levobupivacaína'},
  ropivacaina:{sin:3,con:3.5,aSin:225,aCon:250,n:'Ropivacaína'},
  prilocaina:{sin:6,con:8,aSin:400,aCon:600,n:'Prilocaína'},
};
function _calcAL(){
  return `
   <p class="calc-detail-sub">Calcula la dosis máxima de anestésico local para evitar toxicidad sistémica (LAST).</p>
   <form class="gp-calc-form" onsubmit="event.preventDefault();window._doAL();return false;">
     <div class="gp-calc-grid">
       <label class="gp-calc-field"><span>Peso (kg)</span><input type="number" id="alPeso" inputmode="decimal" placeholder="70"></label>
       <label class="gp-calc-field"><span>Fármaco</span><select id="alDrug">
         <option value="lidocaina">Lidocaína</option><option value="bupivacaina">Bupivacaína</option>
         <option value="levobupivacaina">Levobupivacaína</option><option value="ropivacaina">Ropivacaína</option>
         <option value="mepivacaina">Mepivacaína</option><option value="prilocaina">Prilocaína</option></select></label>
       <label class="gp-calc-field"><span>¿Con epinefrina?</span><select id="alEpi"><option value="sin">Sin epinefrina</option><option value="con">Con epinefrina</option></select></label>
       <label class="gp-calc-field"><span>Concentración (%)</span><input type="number" id="alConc" inputmode="decimal" placeholder="0.5"></label>
     </div>
     <div class="gp-calc-actions"><button type="submit" class="gp-calc-btn primary">🧮 Calcular</button></div>
   </form>
   <div id="calcOut"></div>`;
}
window._doAL = function(){
  const peso=_cNum('alPeso'), conc=_cNum('alConc'); const d=_AL_MAX[_cVal('alDrug')]; const epi=_cVal('alEpi');
  if(!peso||!d){ _cResult('Ingresa el peso.'); return; }
  const mgkg = epi==='con'?d.con:d.sin; const absMax=epi==='con'?d.aCon:d.aSin;
  const porPeso = mgkg*peso; const maxMg=Math.min(porPeso, absMax);
  const capInfo = porPeso>absMax ? ` <em>(limitado por la dosis máxima absoluta de ${absMax} mg)</em>` : '';
  const vol = conc ? maxMg/(conc*10) : null;
  _cResult(`
    <div class="gp-calc-block pedir"><strong>Dosis máxima de ${d.n} (${epi==='con'?'con':'sin'} epinefrina)</strong>
      <div style="font-size:20px;font-weight:800;color:var(--primary-dark);margin:4px 0">${_cFmt(maxMg,0)} mg${capInfo}</div>
      <div style="font-size:12.5px">Límite: ${mgkg} mg/kg × ${_cFmt(peso,0)} kg</div>
    </div>
    ${conc?`<div class="gp-calc-block"><strong>Volumen máximo a esa concentración (${_cFmt(conc,2)} %)</strong>
      <div style="font-size:18px;font-weight:800;color:var(--primary-dark);margin:3px 0">${_cFmt(vol,1)} mL</div>
      <div style="font-size:11.5px;color:var(--muted)">1 % = 10 mg/mL → ${_cFmt(conc*10,0)} mg/mL</div></div>`:''}
    <div class="gp-calc-block nota">Valores de referencia para infiltración/bloqueo en adulto sano. Reducir en ancianos, hepatopatía, embarazo o bajo peso. Ante toxicidad: emulsión lipídica (ASRA).</div>`);
};

// 2) Pesos para dosificar ----------------------------------------------------
function _calcPeso(){
  return `
   <p class="calc-detail-sub">Peso ideal, ajustado y magro — para dosificar correctamente, sobre todo en obesidad.</p>
   <form class="gp-calc-form" onsubmit="event.preventDefault();window._doPeso();return false;">
     <div class="gp-calc-grid">
       <label class="gp-calc-field"><span>Sexo</span><select id="pSexo"><option value="m">Hombre</option><option value="f">Mujer</option></select></label>
       <label class="gp-calc-field"><span>Talla (cm)</span><input type="number" id="pTalla" inputmode="decimal" placeholder="170"></label>
       <label class="gp-calc-field"><span>Peso real (kg)</span><input type="number" id="pPeso" inputmode="decimal" placeholder="95"></label>
     </div>
     <div class="gp-calc-actions"><button type="submit" class="gp-calc-btn primary">🧮 Calcular</button></div>
   </form>
   <div id="calcOut"></div>`;
}
window._doPeso = function(){
  const sexo=_cVal('pSexo'), cm=_cNum('pTalla'), real=_cNum('pPeso');
  if(!cm||!real){ _cResult('Ingresa talla y peso.'); return; }
  const inch=cm/2.54; const m=cm/100; const bmi=real/(m*m);
  let ibw=(sexo==='f'?45.5:50)+2.3*(inch-60); if(ibw<35) ibw=35;
  const adj=ibw+0.4*(real-ibw);
  const lbw = sexo==='f' ? (9270*real)/(8780+244*bmi) : (9270*real)/(6680+216*bmi);
  _cResult(`
    <div class="gp-calc-block pedir"><strong>Resultados</strong>
      <div style="font-size:12.5px;line-height:2">
        IMC: <b>${_cFmt(bmi,1)} kg/m²</b><br>
        Peso ideal (IBW): <b>${_cFmt(ibw,1)} kg</b><br>
        Peso ajustado (AdjBW): <b>${_cFmt(adj,1)} kg</b><br>
        Peso magro (LBW): <b>${_cFmt(lbw,1)} kg</b>
      </div>
    </div>
    <div class="gp-calc-block nota"><strong>Qué peso usar (referencia):</strong> propofol inducción y remifentanilo → magro (LBW); succinilcolina → peso real; rocuronio/vecuronio → ideal (IBW); mantención propofol → ajustado. Verifica según ficha del fármaco.</div>`);
};

// 3) Drogas vasoactivas ------------------------------------------------------
// Nómina de drogas vasoactivas e infusiones.
// unidad: 'ugkgmin' (µg/kg/min) · 'ugkgh' (µg/kg/h) · 'umin' (U/min, fija, no por peso)
// dil: {mg, ml}  →  concentración µg/mL = mg*1000/ml.  Para 'umin' dil:{u, ml} (U/mL).
const VASO_DRUGS = [
  { name:'Noradrenalina', clase:'Vasopresor', unidad:'ugkgmin', inicio:0.05, rango:'0,01–0,5', dil:{mg:4, ml:100}, nota:'Vía central. Vasopresor de 1ª línea en shock distributivo.' },
  { name:'Adrenalina', clase:'Vasopresor / inótropo', unidad:'ugkgmin', inicio:0.03, rango:'0,01–0,5', dil:{mg:4, ml:100}, nota:'Inótropo y vasopresor. Vigilar taquicardia, lactato, hiperglicemia.' },
  { name:'Dobutamina', clase:'Inótropo', unidad:'ugkgmin', inicio:5, rango:'2–20', dil:{mg:250, ml:250}, nota:'Inótropo β1. Puede bajar la PA (vasodilatación) y dar taquicardia.' },
  { name:'Dopamina', clase:'Inótropo / vasopresor', unidad:'ugkgmin', inicio:5, rango:'2–20', dil:{mg:400, ml:250}, nota:'Efecto dosis-dependiente. Más arritmias que noradrenalina.' },
  { name:'Milrinona', clase:'Inodilatador', unidad:'ugkgmin', inicio:0.375, rango:'0,25–0,75', dil:{mg:20, ml:100}, nota:'Carga opcional 50 µg/kg en 10 min. Ajustar en falla renal. Vigilar hipotensión.' },
  { name:'Fenilefrina', clase:'Vasopresor (α puro)', unidad:'ugkgmin', inicio:0.3, rango:'0,1–1,5', dil:{mg:10, ml:100}, nota:'α1 puro. Útil con taquicardia; puede dar bradicardia refleja.' },
  { name:'Nitroglicerina', clase:'Vasodilatador', unidad:'ugkgmin', inicio:0.5, rango:'0,25–5', dil:{mg:50, ml:250}, nota:'Venodilatador. Tolerancia con uso prolongado. Cuidado con hipovolemia.' },
  { name:'Nitroprusiato de sodio', clase:'Vasodilatador', unidad:'ugkgmin', inicio:0.3, rango:'0,3–8 (máx 10)', dil:{mg:50, ml:250}, nota:'Proteger de la luz. Riesgo de toxicidad por cianuro a dosis altas/prolongadas.' },
  { name:'Esmolol', clase:'Betabloqueo', unidad:'ugkgmin', inicio:50, rango:'50–300', dil:{mg:2500, ml:250}, nota:'Carga opcional 500 µg/kg en 1 min. Vida media muy corta.' },
  { name:'Levosimendán', clase:'Inodilatador', unidad:'ugkgmin', inicio:0.1, rango:'0,05–0,2', dil:{mg:12.5, ml:250}, nota:'Sensibilizador del calcio. Carga opcional; vigilar hipotensión.' },
  { name:'Isoproterenol', clase:'Cronótropo (β)', unidad:'ugkgmin', inicio:0.02, rango:'0,01–0,1', dil:{mg:1, ml:250}, nota:'Para bradicardia/BAV. Aumenta consumo de O₂ miocárdico.' },
  { name:'Dexmedetomidina', clase:'Sedante simpaticolítico', unidad:'ugkgh', inicio:0.4, rango:'0,2–0,7', dil:{mg:0.2, ml:50}, nota:'Carga opcional 1 µg/kg en 10 min (puede dar hipo/hipertensión y bradicardia).' },
  { name:'Vasopresina', clase:'Vasopresor (no por peso)', unidad:'umin', inicio:0.03, rango:'0,01–0,04', dil:{u:20, ml:100}, nota:'Dosis FIJA en U/min (no se ajusta por peso). Coadyuvante en shock vasodilatado.' },
];

function _vasoConcUgMl(d){ return (d.dil.mg*1000)/d.dil.ml; }
function _vasoMlh(d, peso){
  if(d.unidad==='umin'){ const concU=d.dil.u/d.dil.ml; return d.inicio*60/concU; }
  const conc=_vasoConcUgMl(d);
  if(d.unidad==='ugkgh'){ return (d.inicio*peso)/conc; }
  return (d.inicio*peso*60)/conc; // ugkgmin
}
function _vasoDilTxt(d){
  if(d.unidad==='umin') return `${d.dil.u} U / ${d.dil.ml} mL (${_cFmt(d.dil.u/d.dil.ml,2)} U/mL)`;
  return `${_cFmt(d.dil.mg,0)} mg / ${d.dil.ml} mL (${_cFmt(_vasoConcUgMl(d),0)} µg/mL)`;
}
function _vasoUnidadTxt(u){ return u==='ugkgh'?'µg/kg/h' : u==='umin'?'U/min' : 'µg/kg/min'; }

function _calcVaso(){
  return `
   <p class="calc-detail-sub">Ingresa el peso y obtén la <b>dosis inicial</b> y la <b>velocidad de infusión (mL/h)</b> de cada droga, con su dilución estándar.</p>
   <form class="gp-calc-form" onsubmit="event.preventDefault();window._doVasoNomina();return false;">
     <div class="gp-calc-grid">
       <label class="gp-calc-field"><span>Peso del paciente (kg)</span><input type="number" id="vNomPeso" inputmode="decimal" placeholder="70" oninput="window._doVasoNomina()"></label>
     </div>
   </form>
   <div id="vasoNomina"></div>
   <details class="asra-legacy" style="margin-top:14px">
     <summary>🧮 Cálculo manual (otra dilución / otra dosis)</summary>
     <form class="gp-calc-form" style="margin-top:10px" onsubmit="event.preventDefault();window._doVaso();return false;">
       <div class="gp-calc-grid">
         <label class="gp-calc-field"><span>Peso (kg)</span><input type="number" id="vPeso" inputmode="decimal" placeholder="70"></label>
         <label class="gp-calc-field"><span>Dosis objetivo</span><input type="number" id="vDosis" inputmode="decimal" placeholder="0.1"></label>
         <label class="gp-calc-field"><span>Unidad de dosis</span><select id="vUnidad"><option value="kgmin">µg/kg/min</option><option value="kgh">µg/kg/h</option><option value="min">µg/min</option></select></label>
         <label class="gp-calc-field"><span>Droga (mg)</span><input type="number" id="vMg" inputmode="decimal" placeholder="4"></label>
         <label class="gp-calc-field"><span>Diluida en (mL)</span><input type="number" id="vMl" inputmode="decimal" placeholder="100"></label>
       </div>
       <div class="gp-calc-actions"><button type="submit" class="gp-calc-btn primary">Calcular mL/h</button></div>
     </form>
     <div id="calcOut"></div>
   </details>`;
}
window._doVasoNomina = function(){
  const peso = _cNum('vNomPeso');
  const cont = document.getElementById('vasoNomina');
  if(!cont) return;
  if(!peso){ cont.innerHTML = '<div class="gp-calc-block nota">Ingresa el peso para ver la nómina con las velocidades de infusión.</div>'; return; }
  const rows = VASO_DRUGS.map(d=>{
    const mlh = _vasoMlh(d, peso);
    const dosisTxt = d.unidad==='umin'
      ? `${_cFmt(d.inicio,2)} U/min`
      : `${_cFmt(d.inicio,3)} ${_vasoUnidadTxt(d.unidad)}`;
    return `<tr>
      <td><b>${d.name}</b><div class="vaso-sub">${d.clase}</div></td>
      <td class="vaso-dose">${dosisTxt}<div class="vaso-sub">rango ${d.rango}</div></td>
      <td class="vaso-mlh">${_cFmt(mlh,1)}<span> mL/h</span></td>
    </tr>
    <tr class="vaso-detail"><td colspan="3"><span class="vaso-dil">Dilución: ${_vasoDilTxt(d)}</span> · ${d.nota}</td></tr>`;
  }).join('');
  cont.innerHTML = `
    <div class="vaso-head">Velocidad de infusión <b>inicial</b> para <b>${_cFmt(peso,0)} kg</b></div>
    <div class="vaso-table-wrap"><table class="vaso-table">
      <thead><tr><th>Droga</th><th>Dosis inicial</th><th>Inicio</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <div class="gp-calc-block nota">Las diluciones mostradas son <b>estándar de referencia</b>; verifica la concentración real de tu preparación/bomba. Dosis iniciales orientativas — titular según respuesta clínica. Vasopresina es dosis fija (no por peso).</div>`;
};
window._doVaso = function(){
  const peso=_cNum('vPeso'), dosis=_cNum('vDosis'), mg=_cNum('vMg'), ml=_cNum('vMl'), unidad=_cVal('vUnidad');
  if(!dosis||!mg||!ml||((unidad==='kgmin'||unidad==='kgh')&&!peso)){ _cResult('Completa los campos.'); return; }
  const concUgMl=(mg*1000)/ml;
  let mlh, ugMinTxt;
  if(unidad==='kgh'){ const ugH=dosis*peso; mlh=ugH/concUgMl; ugMinTxt=`${_cFmt(ugH,1)} µg/h (${_cFmt(dosis,3)} µg/kg/h)`; }
  else { const ugMin = unidad==='kgmin' ? dosis*peso : dosis; mlh=ugMin*60/concUgMl; ugMinTxt=`${_cFmt(ugMin,2)} µg/min${unidad==='kgmin'?` (${_cFmt(dosis,3)} µg/kg/min)`:''}`; }
  _cResult(`
    <div class="gp-calc-block pedir"><strong>Velocidad de infusión</strong>
      <div style="font-size:22px;font-weight:800;color:var(--primary-dark);margin:4px 0">${_cFmt(mlh,1)} mL/h</div>
      <div style="font-size:12px">Concentración: <b>${_cFmt(concUgMl,0)} µg/mL</b> · Dosis: ${ugMinTxt}</div>
    </div>`);
};

// 4) Función renal -----------------------------------------------------------
function _calcVFG(){
  return `
   <p class="calc-detail-sub">Estima la función renal para ajustar fármacos (Cockcroft-Gault y CKD-EPI 2021).</p>
   <form class="gp-calc-form" onsubmit="event.preventDefault();window._doVFG();return false;">
     <div class="gp-calc-grid">
       <label class="gp-calc-field"><span>Edad (años)</span><input type="number" id="rEdad" inputmode="decimal" placeholder="68"></label>
       <label class="gp-calc-field"><span>Sexo</span><select id="rSexo"><option value="m">Hombre</option><option value="f">Mujer</option></select></label>
       <label class="gp-calc-field"><span>Peso (kg)</span><input type="number" id="rPeso" inputmode="decimal" placeholder="75"></label>
       <label class="gp-calc-field"><span>Creatinina (mg/dL)</span><input type="number" id="rCrea" inputmode="decimal" placeholder="1.1"></label>
     </div>
     <div class="gp-calc-actions"><button type="submit" class="gp-calc-btn primary">🧮 Calcular</button></div>
   </form>
   <div id="calcOut"></div>`;
}
window._doVFG = function(){
  const edad=_cNum('rEdad'), sexo=_cVal('rSexo'), peso=_cNum('rPeso'), crea=_cNum('rCrea');
  if(!edad||!crea){ _cResult('Ingresa edad y creatinina.'); return; }
  const f = sexo==='f';
  const cg = peso ? ((140-edad)*peso*(f?0.85:1))/(72*crea) : null;
  const k=f?0.7:0.9, a=f?-0.241:-0.302;
  const egfr=142*Math.pow(Math.min(crea/k,1),a)*Math.pow(Math.max(crea/k,1),-1.200)*Math.pow(0.9938,edad)*(f?1.012:1);
  _cResult(`
    <div class="gp-calc-block pedir"><strong>Clearance de creatinina (Cockcroft-Gault)</strong>
      <div style="font-size:20px;font-weight:800;color:var(--primary-dark);margin:3px 0">${cg!==null?_cFmt(cg,0)+' mL/min':'— (falta peso)'}</div>
      <div style="font-size:11.5px;color:var(--muted)">Es el método preferido para ajuste de dosis de fármacos.</div>
    </div>
    <div class="gp-calc-block"><strong>VFG estimada (CKD-EPI 2021)</strong>
      <div style="font-size:18px;font-weight:800;color:var(--primary-dark);margin:3px 0">${_cFmt(egfr,0)} mL/min/1.73m²</div>
    </div>
    <div class="gp-calc-block nota">Valores en falla renal aguda pueden estar sobreestimados. Ajustar anticoagulantes, antibióticos y relajantes según función renal.</div>`);
};

// 5) Pérdida sanguínea permitida (MABL) --------------------------------------
function _calcMABL(){
  return `
   <p class="calc-detail-sub">Volumen sanguíneo estimado y pérdida sanguínea máxima permitida antes de transfundir.</p>
   <form class="gp-calc-form" onsubmit="event.preventDefault();window._doMABL();return false;">
     <div class="gp-calc-grid">
       <label class="gp-calc-field"><span>Peso (kg)</span><input type="number" id="mPeso" inputmode="decimal" placeholder="70"></label>
       <label class="gp-calc-field"><span>Categoría (volemia)</span><select id="mCat">
         <option value="75">Adulto hombre (75 mL/kg)</option><option value="65">Adulto mujer (65 mL/kg)</option>
         <option value="70">Niño (70 mL/kg)</option><option value="80">Lactante (80 mL/kg)</option>
         <option value="85">Neonato (85 mL/kg)</option><option value="95">Prematuro (95 mL/kg)</option></select></label>
       <label class="gp-calc-field"><span>Hematocrito inicial (%)</span><input type="number" id="mHi" inputmode="decimal" placeholder="40"></label>
       <label class="gp-calc-field"><span>Hematocrito mínimo aceptable (%)</span><input type="number" id="mHf" inputmode="decimal" placeholder="25"></label>
     </div>
     <div class="gp-calc-actions"><button type="submit" class="gp-calc-btn primary">🧮 Calcular</button></div>
   </form>
   <div id="calcOut"></div>`;
}
window._doMABL = function(){
  const peso=_cNum('mPeso'), factor=parseFloat(_cVal('mCat')), hi=_cNum('mHi'), hf=_cNum('mHf');
  if(!peso||!hi||!hf){ _cResult('Completa los campos.'); return; }
  if(hf>=hi){ _cResult('El hematocrito mínimo debe ser menor al inicial.'); return; }
  const ebv=peso*factor;
  const mabl=ebv*(hi-hf)/hi;
  _cResult(`
    <div class="gp-calc-block"><strong>Volumen sanguíneo estimado</strong>
      <div style="font-size:18px;font-weight:800;color:var(--primary-dark);margin:3px 0">${_cFmt(ebv,0)} mL</div>
      <div style="font-size:11.5px;color:var(--muted)">${_cFmt(peso,0)} kg × ${factor} mL/kg</div>
    </div>
    <div class="gp-calc-block pedir"><strong>Pérdida sanguínea permitida (MABL)</strong>
      <div style="font-size:22px;font-weight:800;color:var(--primary-dark);margin:4px 0">≈ ${_cFmt(mabl,0)} mL</div>
      <div style="font-size:12px">Hasta caer de Hto ${_cFmt(hi,0)} % a ${_cFmt(hf,0)} %</div>
    </div>
    <div class="gp-calc-block nota">Estimación; el umbral transfusional se individualiza (comorbilidad, sangrado activo, signos de hipoperfusión). Considerar ácido tranexámico y recuperador celular.</div>`);
};

// 6) Riesgo de NVPO — Score de Apfel ----------------------------------------
function _calcApfel(){
  return `
   <p class="calc-detail-sub">Estima el riesgo de náuseas y vómitos postoperatorios (NVPO) en el adulto con 4 factores (Apfel).</p>
   <form class="gp-calc-form" onsubmit="event.preventDefault();window._doApfel();return false;">
     <div class="gp-calc-grid">
       <label class="gp-calc-field"><span>Sexo femenino</span><select id="apSexo"><option value="0">No</option><option value="1">Sí</option></select></label>
       <label class="gp-calc-field"><span>No fumador</span><select id="apNoFuma"><option value="0">No (fuma)</option><option value="1">Sí (no fuma)</option></select></label>
       <label class="gp-calc-field"><span>Antecedente de NVPO o cinetosis</span><select id="apHist"><option value="0">No</option><option value="1">Sí</option></select></label>
       <label class="gp-calc-field"><span>Uso de opioides postoperatorios</span><select id="apOpio"><option value="1">Sí (esperado)</option><option value="0">No</option></select></label>
     </div>
     <div class="gp-calc-actions"><button type="submit" class="gp-calc-btn primary">🧮 Calcular</button></div>
   </form>
   <div id="calcOut"></div>`;
}
window._doApfel = function(){
  const f = ['apSexo','apNoFuma','apHist','apOpio'].reduce((a,id)=>a + (parseInt(_cVal(id),10)||0), 0);
  const pct = {0:'~10 %',1:'~20 %',2:'~40 %',3:'~60 %',4:'~80 %'}[f];
  const cat = f>=3 ? 'Alto' : (f===2 ? 'Moderado' : 'Bajo');
  let conducta;
  if(f<=1) conducta='Riesgo bajo. Medidas basales (minimizar opioides, hidratación). Considerar 1 antiemético si hay factores quirúrgicos.';
  else if(f===2) conducta='Riesgo moderado. Profilaxis con 2 fármacos de clases distintas (p. ej. dexametasona 4-8 mg al inicio + ondansetrón 4 mg al final).';
  else conducta='Riesgo alto. Estrategia multimodal: reducir riesgo basal (TIVA con propofol, evitar volátiles/N₂O, analgesia multimodal ahorradora de opioides) + 2-3 antieméticos de clases distintas (dexametasona + ondansetrón + droperidol/haloperidol; considerar aprepitant o escopolamina).';
  _cResult(`
    <div class="gp-calc-block pedir"><strong>Score de Apfel</strong>
      <div style="font-size:22px;font-weight:800;color:var(--primary-dark);margin:3px 0">${f} / 4 · ${pct}</div>
      <div style="font-size:12px;color:var(--muted)">Riesgo ${cat} de NVPO</div>
    </div>
    <div class="gp-calc-block"><strong>Conducta sugerida</strong><div style="font-size:12.5px;line-height:1.5;margin-top:3px">${conducta}</div></div>
    <div class="gp-calc-block nota">Rescate: usar una clase distinta a la usada en profilaxis. Referencia: Apfel 1999 / Consenso NVPO 2020. La decisión es del anestesiólogo a cargo.</div>`);
};

// 7) Riesgo pulmonar postoperatorio — ARISCAT -------------------------------
function _calcAriscat(){
  return `
   <p class="calc-detail-sub">Estima el riesgo de complicaciones pulmonares postoperatorias (ARISCAT).</p>
   <form class="gp-calc-form" onsubmit="event.preventDefault();window._doAriscat();return false;">
     <div class="gp-calc-grid">
       <label class="gp-calc-field"><span>Edad</span><select id="arEdad"><option value="0">≤ 50 años</option><option value="3">51-80 años</option><option value="16">&gt; 80 años</option></select></label>
       <label class="gp-calc-field"><span>SpO₂ preoperatoria</span><select id="arSpo2"><option value="0">≥ 96 %</option><option value="8">91-95 %</option><option value="24">≤ 90 %</option></select></label>
       <label class="gp-calc-field"><span>Infección respiratoria (último mes)</span><select id="arInf"><option value="0">No</option><option value="17">Sí</option></select></label>
       <label class="gp-calc-field"><span>Anemia preop (Hb ≤ 10 g/dL)</span><select id="arAnemia"><option value="0">No</option><option value="11">Sí</option></select></label>
       <label class="gp-calc-field"><span>Incisión quirúrgica</span><select id="arInc"><option value="0">Periférica</option><option value="15">Abdominal alta</option><option value="24">Intratorácica</option></select></label>
       <label class="gp-calc-field"><span>Duración de la cirugía</span><select id="arDur"><option value="0">&lt; 2 h</option><option value="16">2-3 h</option><option value="23">&gt; 3 h</option></select></label>
       <label class="gp-calc-field"><span>Cirugía de urgencia</span><select id="arUrg"><option value="0">No</option><option value="8">Sí</option></select></label>
     </div>
     <div class="gp-calc-actions"><button type="submit" class="gp-calc-btn primary">🧮 Calcular</button></div>
   </form>
   <div id="calcOut"></div>`;
}
window._doAriscat = function(){
  const s = ['arEdad','arSpo2','arInf','arAnemia','arInc','arDur','arUrg'].reduce((a,id)=>a + (parseInt(_cVal(id),10)||0), 0);
  let cat, pct, conducta;
  if(s < 26){ cat='Bajo'; pct='~ 1,6 %';
    conducta='Cuidados estándar. Movilización precoz y fisioterapia respiratoria según necesidad.'; }
  else if(s <= 44){ cat='Intermedio'; pct='~ 13 %';
    conducta='Optimizar: cesación tabáquica, tratar anemia/infección, fisioterapia respiratoria e incentivómetro. Ventilación protectora intraop (Vt 6-8 mL/kg peso ideal, PEEP). Evitar bloqueo neuromuscular residual (revertir + TOF). Analgesia regional ahorradora de opioides.'; }
  else { cat='Alto'; pct='~ 42 %';
    conducta='Todas las medidas previas + considerar manejo postop monitorizado (intermedio/UCI), CPAP/VNI precoz, y planificación multidisciplinaria. Optimización preoperatoria intensiva.'; }
  _cResult(`
    <div class="gp-calc-block pedir"><strong>Puntaje ARISCAT</strong>
      <div style="font-size:22px;font-weight:800;color:var(--primary-dark);margin:3px 0">${s} pts · ${pct}</div>
      <div style="font-size:12px;color:var(--muted)">Riesgo ${cat} de complicaciones pulmonares</div>
    </div>
    <div class="gp-calc-block"><strong>Conducta sugerida</strong><div style="font-size:12.5px;line-height:1.5;margin-top:3px">${conducta}</div></div>
    <div class="gp-calc-block nota">Estratos: &lt;26 bajo · 26-44 intermedio · ≥45 alto. Referencia: Canet, Anesthesiology 2010. La decisión es del anestesiólogo a cargo.</div>`);
};

// ============================================================
// SERVICE WORKER (PWA)
// ============================================================
// Muestra un aviso flotante cuando hay una versión nueva publicada, para que
// quien tenga la app abierta pueda actualizar con un toque (recarga).
let _swWaiting = null;
function showUpdateBanner(){
  if(document.getElementById('updateBanner')) return;
  const b = document.createElement('div');
  b.id = 'updateBanner';
  b.innerHTML = '🔄 Nueva versión disponible — toca para actualizar';
  b.onclick = function(){
    b.textContent = 'Actualizando…';
    try{ if(_swWaiting) _swWaiting.postMessage('SKIP_WAITING'); }catch(e){}
    setTimeout(()=>{ location.reload(); }, 250);
  };
  document.body.appendChild(b);
}

// Aplicar tema y tamaño de letra guardados lo antes posible
try{ applyTheme(); }catch(e){}
try{ applyFontScale(); }catch(e){}
window.addEventListener('load', ()=>{ try{ applyTheme(); }catch(e){} try{ applyFontScale(); }catch(e){} });

if('serviceWorker' in navigator){
  window.addEventListener('load', ()=>{
    // ¿Ya había un SW controlando? (si no, es la primera visita y el
    // controllerchange inicial NO debe recargar)
    const _hadController = !!navigator.serviceWorker.controller;
    let _swAutoReloaded = false;
    // AUTO-ACTUALIZACIÓN (jul 2026): cuando el SW nuevo toma control
    // (skipWaiting es automático en sw.js), recargamos una vez para que el
    // código nuevo quede activo de inmediato, sin depender de que la persona
    // toque el banner. Si está a mitad de algo (modal o PIN abiertos), solo
    // mostramos el aviso.
    try{
      navigator.serviceWorker.addEventListener('controllerchange', ()=>{
        if(!_hadController || _swAutoReloaded) return;
        _swAutoReloaded = true;
        const modalOpen = document.querySelector('#modal.open');
        const pinEl = document.getElementById('pinOverlay');
        const pinOpen = pinEl && !pinEl.classList.contains('hidden');
        if(modalOpen || pinOpen){ showUpdateBanner(); return; }
        location.reload();
      });
    }catch(e){}
    navigator.serviceWorker.register('sw.js').then(reg=>{
      if(!reg) return;
      // Detectar una actualización del service worker (= versión nueva)
      reg.addEventListener('updatefound', ()=>{
        const nw = reg.installing;
        if(!nw) return;
        nw.addEventListener('statechange', ()=>{
          // Solo si YA había una versión controlando (no en la primera carga)
          if((nw.state === 'installed' || nw.state === 'activated') && navigator.serviceWorker.controller){
            _swWaiting = reg.waiting || nw;
            showUpdateBanner();
          }
        });
      });
      // Revisar si hay versión nueva: al volver a la pestaña y cada 30 min
      const checkUpdate = ()=>{ try{ reg.update(); }catch(e){} };
      document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState === 'visible') checkUpdate(); });
      setInterval(checkUpdate, 30*60*1000);
    }).catch(()=>{});
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
  'andes': JSON.parse('{"id":"andes","name":"Clínica Universidad de los Andes","shortName":"Clínica Universidad de los Andes","country":"Chile","city":"Santiago","welcome":"Servicio de Anestesiología","horarioEmbedURL":"https://onedrive.live.com/edit?id=BED7497A3E8C32FC!2204&resid=BED7497A3E8C32FC!2204&ithint=file%2Cxlsx&authkey=!AOBslmFUGIX9rW8&wdo=2&cid=bed7497a3e8c32fc","staff":[{"id":"s_arriagada","name":"Arriagada","role":"Staff","cumplimientoJornadas":"75-85","jornadasBorradas":0,"equipoTMT":false,"equipoCardio":false,"equipoPediatria":false,"rolCoordinacion":false,"noFondoComun":false,"residenciaAnios":"1-5","esResidente":false,"llamadaPediatrica":false,"llamadaCardio":false,"primeraLlamadaFija":false,"segundaLlamadaFija":false,"coberturaTurnoUrg":false,"coberturaLlamada1":false,"coberturaLlamada2":false,"exentoCobertura":false},{"id":"s_molina","name":"Molina","role":"Staff","cumplimientoJornadas":"75-85","jornadasBorradas":0,"equipoTMT":false,"equipoCardio":false,"equipoPediatria":false,"rolCoordinacion":false,"noFondoComun":false,"residenciaAnios":"1-5","esResidente":false,"llamadaPediatrica":false,"llamadaCardio":false,"primeraLlamadaFija":false,"segundaLlamadaFija":false,"coberturaTurnoUrg":false,"coberturaLlamada1":false,"coberturaLlamada2":false,"exentoCobertura":false},{"id":"s_martinez","name":"Martinez","role":"Staff","cumplimientoJornadas":"75-85","jornadasBorradas":0,"equipoTMT":false,"equipoCardio":false,"equipoPediatria":false,"rolCoordinacion":false,"noFondoComun":false,"residenciaAnios":"1-5","esResidente":false,"llamadaPediatrica":false,"llamadaCardio":false,"primeraLlamadaFija":false,"segundaLlamadaFija":false,"coberturaTurnoUrg":false,"coberturaLlamada1":false,"coberturaLlamada2":false,"exentoCobertura":false},{"id":"s_rodriguez","name":"Rodriguez","role":"Staff","cumplimientoJornadas":"75-85","jornadasBorradas":0,"equipoTMT":false,"equipoCardio":false,"equipoPediatria":false,"rolCoordinacion":false,"noFondoComun":false,"residenciaAnios":"1-5","esResidente":false,"llamadaPediatrica":false,"llamadaCardio":false,"primeraLlamadaFija":false,"segundaLlamadaFija":false,"coberturaTurnoUrg":false,"coberturaLlamada1":false,"coberturaLlamada2":false,"exentoCobertura":false},{"id":"s_guerrero","name":"Guerrero","role":"Staff","cumplimientoJornadas":"75-85","jornadasBorradas":0,"equipoTMT":false,"equipoCardio":false,"equipoPediatria":false,"rolCoordinacion":false,"noFondoComun":false,"residenciaAnios":"1-5","esResidente":false,"llamadaPediatrica":false,"llamadaCardio":false,"primeraLlamadaFija":false,"segundaLlamadaFija":false,"coberturaTurnoUrg":false,"coberturaLlamada1":false,"coberturaLlamada2":false,"exentoCobertura":true},{"id":"s_vozmediano","name":"Vozmediano","role":"Staff","cumplimientoJornadas":"75-85","jornadasBorradas":0,"equipoTMT":false,"equipoCardio":false,"equipoPediatria":false,"rolCoordinacion":false,"noFondoComun":false,"residenciaAnios":"1-5","esResidente":false,"llamadaPediatrica":false,"llamadaCardio":false,"primeraLlamadaFija":false,"segundaLlamadaFija":false,"coberturaTurnoUrg":false,"coberturaLlamada1":false,"coberturaLlamada2":false,"exentoCobertura":false},{"id":"s_fierro","name":"Fierro","role":"Staff","cumplimientoJornadas":"75-85","jornadasBorradas":0,"equipoTMT":false,"equipoCardio":false,"equipoPediatria":false,"rolCoordinacion":false,"noFondoComun":false,"residenciaAnios":"1-5","esResidente":false,"llamadaPediatrica":false,"llamadaCardio":false,"primeraLlamadaFija":false,"segundaLlamadaFija":false,"coberturaTurnoUrg":false,"coberturaLlamada1":false,"coberturaLlamada2":false,"exentoCobertura":false},{"id":"s_rojas","name":"Rojas","role":"Staff","cumplimientoJornadas":"75-85","jornadasBorradas":0,"equipoTMT":false,"equipoCardio":false,"equipoPediatria":false,"rolCoordinacion":false,"noFondoComun":false,"residenciaAnios":"1-5","esResidente":false,"llamadaPediatrica":false,"llamadaCardio":false,"primeraLlamadaFija":false,"segundaLlamadaFija":false,"coberturaTurnoUrg":false,"coberturaLlamada1":false,"coberturaLlamada2":false,"exentoCobertura":false},{"id":"s_duran","name":"Duran","role":"Staff","cumplimientoJornadas":"75-85","jornadasBorradas":0,"equipoTMT":false,"equipoCardio":false,"equipoPediatria":false,"rolCoordinacion":false,"noFondoComun":false,"residenciaAnios":"1-5","esResidente":false,"llamadaPediatrica":false,"llamadaCardio":false,"primeraLlamadaFija":false,"segundaLlamadaFija":false,"coberturaTurnoUrg":false,"coberturaLlamada1":false,"coberturaLlamada2":false,"exentoCobertura":false},{"id":"s_cardemil","name":"Cardemil","role":"Staff","cumplimientoJornadas":"75-85","jornadasBorradas":0,"equipoTMT":false,"equipoCardio":false,"equipoPediatria":false,"rolCoordinacion":false,"noFondoComun":false,"residenciaAnios":"1-5","esResidente":false,"llamadaPediatrica":false,"llamadaCardio":false,"primeraLlamadaFija":false,"segundaLlamadaFija":false,"coberturaTurnoUrg":false,"coberturaLlamada1":false,"coberturaLlamada2":false,"exentoCobertura":false},{"id":"s_juliov","name":"Julio V.","role":"Staff","cumplimientoJornadas":"75-85","jornadasBorradas":0,"equipoTMT":false,"equipoCardio":false,"equipoPediatria":false,"rolCoordinacion":false,"noFondoComun":false,"residenciaAnios":"1-5","esResidente":false,"llamadaPediatrica":false,"llamadaCardio":false,"primeraLlamadaFija":false,"segundaLlamadaFija":false,"coberturaTurnoUrg":false,"coberturaLlamada1":false,"coberturaLlamada2":false,"exentoCobertura":true},{"id":"s_gonzalez","name":"Gonzalez","role":"Staff","cumplimientoJornadas":"75-85","jornadasBorradas":0,"equipoTMT":false,"equipoCardio":false,"equipoPediatria":false,"rolCoordinacion":false,"noFondoComun":false,"residenciaAnios":"1-5","esResidente":false,"llamadaPediatrica":false,"llamadaCardio":false,"primeraLlamadaFija":false,"segundaLlamadaFija":false,"coberturaTurnoUrg":false,"coberturaLlamada1":false,"coberturaLlamada2":false,"exentoCobertura":false},{"id":"s_larraguibel","name":"Larraguibel","role":"Staff","cumplimientoJornadas":"75-85","jornadasBorradas":0,"equipoTMT":false,"equipoCardio":false,"equipoPediatria":false,"rolCoordinacion":false,"noFondoComun":false,"residenciaAnios":"1-5","esResidente":false,"llamadaPediatrica":false,"llamadaCardio":false,"primeraLlamadaFija":false,"segundaLlamadaFija":false,"coberturaTurnoUrg":false,"coberturaLlamada1":false,"coberturaLlamada2":false,"exentoCobertura":false},{"id":"s_barra","name":"Barra","role":"Staff","cumplimientoJornadas":"75-85","jornadasBorradas":0,"equipoTMT":false,"equipoCardio":false,"equipoPediatria":false,"rolCoordinacion":false,"noFondoComun":false,"residenciaAnios":"1-5","esResidente":false,"llamadaPediatrica":false,"llamadaCardio":false,"primeraLlamadaFija":false,"segundaLlamadaFija":false,"coberturaTurnoUrg":false,"coberturaLlamada1":false,"coberturaLlamada2":false,"exentoCobertura":false},{"id":"s_biancardi","name":"Biancardi","role":"Staff","cumplimientoJornadas":"75-85","jornadasBorradas":0,"equipoTMT":false,"equipoCardio":false,"equipoPediatria":false,"rolCoordinacion":false,"noFondoComun":false,"residenciaAnios":"1-5","esResidente":false,"llamadaPediatrica":false,"llamadaCardio":false,"primeraLlamadaFija":false,"segundaLlamadaFija":false,"coberturaTurnoUrg":false,"coberturaLlamada1":false,"coberturaLlamada2":false,"exentoCobertura":false},{"id":"s_coloma","name":"Coloma","role":"Staff","cumplimientoJornadas":"75-85","jornadasBorradas":0,"equipoTMT":false,"equipoCardio":false,"equipoPediatria":false,"rolCoordinacion":false,"noFondoComun":false,"residenciaAnios":"1-5","esResidente":false,"llamadaPediatrica":false,"llamadaCardio":false,"primeraLlamadaFija":false,"segundaLlamadaFija":false,"coberturaTurnoUrg":false,"coberturaLlamada1":false,"coberturaLlamada2":false,"exentoCobertura":false},{"id":"s_larosa","name":"La Rosa","role":"Staff","cumplimientoJornadas":"75-85","jornadasBorradas":0,"equipoTMT":false,"equipoCardio":false,"equipoPediatria":false,"rolCoordinacion":false,"noFondoComun":false,"residenciaAnios":"1-5","esResidente":false,"llamadaPediatrica":false,"llamadaCardio":false,"primeraLlamadaFija":false,"segundaLlamadaFija":false,"coberturaTurnoUrg":false,"coberturaLlamada1":false,"coberturaLlamada2":false,"exentoCobertura":false},{"id":"s_silva","name":"Silva","role":"Staff","cumplimientoJornadas":"75-85","jornadasBorradas":0,"equipoTMT":false,"equipoCardio":false,"equipoPediatria":false,"rolCoordinacion":false,"noFondoComun":false,"residenciaAnios":"1-5","esResidente":false,"llamadaPediatrica":false,"llamadaCardio":false,"primeraLlamadaFija":false,"segundaLlamadaFija":false,"coberturaTurnoUrg":false,"coberturaLlamada1":false,"coberturaLlamada2":false,"exentoCobertura":false},{"id":"s_jara","name":"Jara","role":"Staff","cumplimientoJornadas":"75-85","jornadasBorradas":0,"equipoTMT":false,"equipoCardio":false,"equipoPediatria":false,"rolCoordinacion":false,"noFondoComun":false,"residenciaAnios":"1-5","esResidente":false,"llamadaPediatrica":false,"llamadaCardio":false,"primeraLlamadaFija":false,"segundaLlamadaFija":false,"coberturaTurnoUrg":false,"coberturaLlamada1":false,"coberturaLlamada2":false,"exentoCobertura":false},{"id":"s_gallardo","name":"Gallardo","role":"Staff","cumplimientoJornadas":"75-85","jornadasBorradas":0,"equipoTMT":false,"equipoCardio":false,"equipoPediatria":false,"rolCoordinacion":false,"noFondoComun":false,"residenciaAnios":"1-5","esResidente":false,"llamadaPediatrica":false,"llamadaCardio":false,"primeraLlamadaFija":false,"segundaLlamadaFija":false,"coberturaTurnoUrg":false,"coberturaLlamada1":false,"coberturaLlamada2":false,"exentoCobertura":false},{"id":"s_hugov","name":"Hugo V.","role":"Staff","cumplimientoJornadas":"75-85","jornadasBorradas":0,"equipoTMT":false,"equipoCardio":false,"equipoPediatria":false,"rolCoordinacion":false,"noFondoComun":false,"residenciaAnios":"1-5","esResidente":false,"llamadaPediatrica":false,"llamadaCardio":false,"primeraLlamadaFija":false,"segundaLlamadaFija":false,"coberturaTurnoUrg":false,"coberturaLlamada1":false,"coberturaLlamada2":false,"exentoCobertura":false},{"id":"s_camilar","name":"Camila R.","role":"Staff","cumplimientoJornadas":"75-85","jornadasBorradas":0,"equipoTMT":false,"equipoCardio":false,"equipoPediatria":false,"rolCoordinacion":false,"noFondoComun":false,"residenciaAnios":"1-5","esResidente":false,"llamadaPediatrica":false,"llamadaCardio":false,"primeraLlamadaFija":false,"segundaLlamadaFija":false,"coberturaTurnoUrg":false,"coberturaLlamada1":false,"coberturaLlamada2":false,"exentoCobertura":false},{"id":"s_stamaria","name":"Sta. María","role":"Staff","cumplimientoJornadas":"75-85","jornadasBorradas":0,"equipoTMT":false,"equipoCardio":false,"equipoPediatria":false,"rolCoordinacion":false,"noFondoComun":false,"residenciaAnios":"1-5","esResidente":false,"llamadaPediatrica":false,"llamadaCardio":false,"primeraLlamadaFija":false,"segundaLlamadaFija":false,"coberturaTurnoUrg":false,"coberturaLlamada1":false,"coberturaLlamada2":false,"exentoCobertura":false},{"id":"s_leisewitz","name":"Leisewitz","role":"Staff","cumplimientoJornadas":"75-85","jornadasBorradas":0,"equipoTMT":false,"equipoCardio":false,"equipoPediatria":false,"rolCoordinacion":false,"noFondoComun":false,"residenciaAnios":"1-5","esResidente":false,"llamadaPediatrica":false,"llamadaCardio":false,"primeraLlamadaFija":false,"segundaLlamadaFija":false,"coberturaTurnoUrg":false,"coberturaLlamada1":false,"coberturaLlamada2":false,"exentoCobertura":false},{"id":"s_chuen","name":"Chuen","role":"Staff","cumplimientoJornadas":"75-85","jornadasBorradas":0,"equipoTMT":false,"equipoCardio":false,"equipoPediatria":false,"rolCoordinacion":false,"noFondoComun":false,"residenciaAnios":"1-5","esResidente":false,"llamadaPediatrica":false,"llamadaCardio":false,"primeraLlamadaFija":false,"segundaLlamadaFija":false,"coberturaTurnoUrg":false,"coberturaLlamada1":false,"coberturaLlamada2":false,"exentoCobertura":false},{"id":"s_miranda","name":"Miranda","role":"Staff","cumplimientoJornadas":"75-85","jornadasBorradas":0,"equipoTMT":false,"equipoCardio":false,"equipoPediatria":false,"rolCoordinacion":false,"noFondoComun":false,"residenciaAnios":"1-5","esResidente":false,"llamadaPediatrica":false,"llamadaCardio":false,"primeraLlamadaFija":false,"segundaLlamadaFija":false,"coberturaTurnoUrg":false,"coberturaLlamada1":false,"coberturaLlamada2":false,"exentoCobertura":false},{"id":"s_salazar","name":"Salazar","role":"Staff","cumplimientoJornadas":"75-85","jornadasBorradas":0,"equipoTMT":false,"equipoCardio":false,"equipoPediatria":false,"rolCoordinacion":false,"noFondoComun":false,"residenciaAnios":"1-5","esResidente":false,"llamadaPediatrica":false,"llamadaCardio":false,"primeraLlamadaFija":false,"segundaLlamadaFija":false,"coberturaTurnoUrg":false,"coberturaLlamada1":false,"coberturaLlamada2":false,"exentoCobertura":false},{"id":"s_ricke","name":"Ricke","role":"Staff","cumplimientoJornadas":"75-85","jornadasBorradas":0,"equipoTMT":false,"equipoCardio":false,"equipoPediatria":false,"rolCoordinacion":false,"noFondoComun":false,"residenciaAnios":"1-5","esResidente":false,"llamadaPediatrica":false,"llamadaCardio":false,"primeraLlamadaFija":false,"segundaLlamadaFija":false,"coberturaTurnoUrg":false,"coberturaLlamada1":false,"coberturaLlamada2":false,"exentoCobertura":true},{"id":"s_veliz","name":"Veliz","role":"Staff","cumplimientoJornadas":"75-85","jornadasBorradas":0,"equipoTMT":false,"equipoCardio":false,"equipoPediatria":false,"rolCoordinacion":false,"noFondoComun":false,"residenciaAnios":"1-5","esResidente":false,"llamadaPediatrica":false,"llamadaCardio":false,"primeraLlamadaFija":false,"segundaLlamadaFija":false,"coberturaTurnoUrg":false,"coberturaLlamada1":false,"coberturaLlamada2":false,"exentoCobertura":true},{"id":"s_astorga","name":"Astorga","role":"Staff","cumplimientoJornadas":"75-85","jornadasBorradas":0,"equipoTMT":false,"equipoCardio":false,"equipoPediatria":false,"rolCoordinacion":false,"noFondoComun":false,"residenciaAnios":"1-5","esResidente":false,"llamadaPediatrica":false,"llamadaCardio":false,"primeraLlamadaFija":false,"segundaLlamadaFija":false,"coberturaTurnoUrg":false,"coberturaLlamada1":false,"coberturaLlamada2":false,"exentoCobertura":false}]}')
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
  try{ updateAiButtons(); }catch(e){}
  try{ updateHomeBadges(); }catch(e){}
  try{ updateAgendAdminNotice(); }catch(e){}
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
    return `<button class="inst-item" data-inst-id="${i.id}" onclick="selectInstitution('${i.id}')">
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
  // Feedback INMEDIATO al clic: lo que sigue son 2 viajes de red (config de
  // la institución + estado compartido en Cloudflare, que puede tener "cold
  // start") y en un teléfono puede tomar 1-3 s. Sin este spinner, el selector
  // parecía "pegado". La animación de entrada NO es la causa: es CSS puro y
  // recién corre cuando todo ya cargó.
  try{
    const list = document.getElementById('institutionList');
    if(list){
      list.querySelectorAll('.inst-item').forEach(b=>{
        b.disabled = true;
        if(b.getAttribute('data-inst-id') === id){
          b.classList.add('inst-item-loading');
          const arr = b.querySelector('.inst-item-arrow'); if(arr) arr.innerHTML = '<span class="inst-spinner"></span>';
          const loc = b.querySelector('.inst-item-loc'); if(loc) loc.textContent = 'Conectando…';
        } else {
          b.style.opacity = '.4';
        }
      });
    }
  }catch(e){}
  try{
    const cfg = await loadInstitutionConfig(id);
    localStorage.setItem(INSTITUTION_LS_KEY, id);
    migrateLegacyStateIfNeeded(id);
    applyInstitutionConfig(cfg);
    state = load();
    ensureAllUserDefaults();
    // Traer estado compartido del backend antes de seguir
    await bootSync();
    // saveRaw() en vez de save() para no falsear el timestamp local (ver boot())
    saveRaw();
    _bindFlushHandlers();
    document.getElementById('institutionPicker').classList.add('hidden');
    updateInstitutionUI();
    updateAdminUI();
    // Si ya hay sesión activa para esta institución → restaurar su inicio;
    // si no, mostrar el selector de los 3 módulos.
    if(state.currentUserId){
      const u = (state.currentUserId === ADMIN_USER_ID) ? getAdminVirtualUser() : state.staff.find(s=>s.id===state.currentUserId);
      if(u){
        updateWelcomeName();
        showHome();
        try{ updateEventBadge(); }catch(e){}
        try{ checkReminders(); }catch(e){}
        // FIX jul 2026: al restaurar una sesión de ADMIN también hay que
        // retomar el polling de solicitudes; antes solo arrancaba en el login
        // admin o al alternar el modo, y los badges de Agendamiento e
        // Interconsultas quedaban en cero hasta re-entrar al modo admin.
        if(state.isAdmin){
          try{ checkAgendNewForAdmin(); startAgendAdminPolling(); }catch(e){}
          try{ icCheckNewForAdmin(); startIcAdminPolling(); }catch(e){}
        }
        try{ _appxFlushPendingDeepLink(); }catch(e){}
        return;
      } else {
        state.currentUserId = null;
      }
    }
    showModulesScreen({animate:true});
    try{ _appxFlushPendingDeepLink(); }catch(e){}
  }catch(e){
    console.error(e);
    alert('No se pudo cargar la configuración de la institución: '+e.message);
    // Restaurar el selector para poder reintentar
    try{ renderInstitutionPicker(INSTITUTIONS_CACHE||[]); }catch(_){}
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
// PANTALLA INTERMEDIA: SELECTOR DE MÓDULO (Staff / Agendamiento / Guías)
// ============================================================
// Cache de la lista de instituciones para no re-fetchear al volver atrás.
let INSTITUTIONS_CACHE = null;

// Muestra el selector de institución (usado desde logout y desde "Cambiar institución" si hiciera falta).
async function showInstitutionPicker(){
  if(!INSTITUTIONS_CACHE){
    try{
      const idx = await loadInstitutionsIndex();
      INSTITUTIONS_CACHE = idx.institutions || [];
    }catch(e){
      INSTITUTIONS_CACHE = (INLINE_INSTITUTIONS_INDEX && INLINE_INSTITUTIONS_INDEX.institutions) || [];
    }
  }
  // Ocultar otras pantallas de boot
  const mods = document.getElementById('modulesScreen');
  if(mods) mods.classList.add('hidden');
  const usr = document.getElementById('userPicker');
  if(usr) usr.classList.add('hidden');
  // Renderizar y mostrar
  try{ renderInstitutionPicker(INSTITUTIONS_CACHE); }catch(e){}
  const ip = document.getElementById('institutionPicker');
  if(ip) ip.classList.remove('hidden');
}

// Muestra la pantalla con los 3 botones (Staff / Agendamiento / Guías).
function showModulesScreen(opts){
  // Ocultar otras pantallas de boot
  const ip = document.getElementById('institutionPicker');
  if(ip) ip.classList.add('hidden');
  const usr = document.getElementById('userPicker');
  if(usr) usr.classList.add('hidden');
  // Actualizar el nombre de la institución
  const el = document.getElementById('modulesInstName');
  if(el && typeof INSTITUTION !== 'undefined' && INSTITUTION){
    el.textContent = INSTITUTION.shortName || INSTITUTION.name || '';
  }
  // Mostrar
  const mods = document.getElementById('modulesScreen');
  if(mods){
    mods.classList.remove('hidden');
    // Animación de entrada (solo al llegar desde el selector de institución):
    // tarjeta + logo con destello. Se retira la clase al terminar para que
    // pueda re-dispararse en un próximo ingreso.
    if(opts && opts.animate){
      mods.classList.remove('mod-enter');
      void mods.offsetWidth; // reflow: reinicia las animaciones CSS
      mods.classList.add('mod-enter');
      setTimeout(()=>{ try{ mods.classList.remove('mod-enter'); }catch(e){} }, 1600);
    }
  }
  // Refrescar el badge de Interconsultas (cuántas nuevas sin ver) con la nube.
  try{ updateIcBadges(); icSyncNow().then(()=>{ updateIcBadges(); }).catch(()=>{}); }catch(e){}
}

// Botón de "Volver al inicio" (el logo de Appnesthesia arriba a la izquierda en
// cada cabecera). Desde CUALQUIER módulo —Staff, Portal, Agendamiento,
// Interconsultas— y desde cualquiera de sus sub-opciones, vuelve al selector de
// módulos ("¿A dónde quieres entrar?"), que es el inicio de la app.
function goToInicio(){
  // Cerrar cualquier panel flotante (calculadoras, etc.)
  try{ closeCalculadoras && closeCalculadoras(); }catch(e){}
  // Ocultar los overlays de módulo si estuvieran abiertos
  try{ const g  = document.getElementById('guiasScreen');  if(g)  g.classList.add('hidden'); }catch(e){}
  try{ const ic = document.getElementById('icScreen');     if(ic) ic.classList.add('hidden'); }catch(e){}
  try{ const ag = document.getElementById('agendScreen');  if(ag) ag.classList.add('hidden'); }catch(e){}
  try{ const vs = document.getElementById('vascScreen');   if(vs) vs.classList.add('hidden'); }catch(e){}
  try{ const pu = document.getElementById('pabUrgScreen'); if(pu) pu.classList.add('hidden'); }catch(e){}
  try{ const sc = document.getElementById('solChooser');   if(sc) sc.classList.add('hidden'); }catch(e){}
  try{ const pc = document.getElementById('portalChooser'); if(pc) pc.classList.add('hidden'); }catch(e){}
  // Ir siempre al selector de módulos (el inicio).
  try{ showModulesScreen(); }catch(e){}
}

// Botón "Staff" del selector de módulo → abre el picker de usuarios existente.
function openStaffModule(){
  const mods = document.getElementById('modulesScreen');
  if(mods) mods.classList.add('hidden');
  showUserPicker();
}

// "Volver" desde el userPicker → vuelve al selector de módulo (no reinicia).
function backToModulesFromPicker(){
  const usr = document.getElementById('userPicker');
  if(usr) usr.classList.add('hidden');
  showModulesScreen();
}

// "Cambiar institución" desde el selector de módulo → reinicia para elegir otra institución.
function cambiarInstitucionFromModules(){
  const ok = confirm('¿Volver a elegir institución? La app se reiniciará. Tus datos locales quedan guardados por institución.');
  if(!ok) return;
  localStorage.removeItem(INSTITUTION_LS_KEY);
  location.reload();
}

// ============================================================
// MÓDULO: GUÍAS PERIOPERATORIAS
// Buscador de fármacos + tablas (Ayuno + Suspensión perioperatoria)
// ============================================================

// Catálogo de fármacos con recomendaciones perioperatorias.
// action: 'suspender' | 'mantener' | 'individualizar'
const GUIA_DRUGS = [
  // --- Cardiovasculares ---
  { name:'IECA (Enalapril, Captopril, Lisinopril, Ramipril)', category:'Cardiovascular',
    aliases:['enalapril','captopril','lisinopril','ramipril','perindopril','quinapril','iecas','ieca','renitec','capoten'],
    action:'suspender', when:'24 h antes de la cirugía',
    summary:'Suspender el día previo si se usan para HTA. Mantener si la indicación es insuficiencia cardíaca con disfunción sistólica.',
    notes:['Riesgo de hipotensión refractaria intraoperatoria.','Reiniciar al recuperar volemia y función renal estables.'],
    source:'Guía de Suspensión de Fármacos Perioperatorios' },

  { name:'ARA-II (Losartán, Valsartán, Candesartán, Telmisartán)', category:'Cardiovascular',
    aliases:['losartan','valsartan','candesartan','telmisartan','irbesartan','olmesartan','ara2','ara-ii','araii','cozaar','diovan'],
    action:'suspender', when:'24 h antes de la cirugía',
    summary:'Mismo manejo que IECA: suspender 24 h antes si se usan para HTA.',
    notes:['Mantener si están indicados por IC con disfunción sistólica.','Reiniciar postoperatorio con volemia y función renal recuperadas.'],
    source:'Guía de Suspensión de Fármacos Perioperatorios' },

  { name:'Betabloqueadores (Atenolol, Bisoprolol, Carvedilol, Propranolol, Metoprolol, Nebivolol)', category:'Cardiovascular',
    aliases:['atenolol','bisoprolol','carvedilol','propranolol','metoprolol','nebivolol','labetalol','betabloqueador','betabloqueadores','bb'],
    action:'mantener', when:'Incluido el día de la cirugía',
    summary:'No suspender. Administrar la dosis habitual la mañana de la cirugía.',
    notes:['La suspensión brusca aumenta el riesgo de isquemia, arritmias e hipertensión de rebote.'],
    source:'Guía de Suspensión de Fármacos Perioperatorios' },

  { name:'Diuréticos (Furosemida, Hidroclorotiazida, Espironolactona)', category:'Cardiovascular',
    aliases:['furosemida','hidroclorotiazida','hctz','espironolactona','clortalidona','indapamida','torasemida','diuretico','diureticos','lasix','aldactone'],
    action:'suspender', when:'La mañana de la cirugía',
    summary:'Omitir la dosis matinal del día de la cirugía.',
    notes:['Riesgo de hipovolemia e hipokalemia perioperatoria.','Mantener si la indicación es IC descompensada (evaluar caso a caso).'],
    source:'Guía de Suspensión de Fármacos Perioperatorios' },

  { name:'Estatinas (Atorvastatina, Simvastatina, Rosuvastatina, Pravastatina)', category:'Cardiovascular',
    aliases:['atorvastatina','simvastatina','rosuvastatina','pravastatina','lovastatina','estatina','estatinas','lipitor','crestor'],
    action:'mantener', when:'Incluido el día de la cirugía',
    summary:'No suspender. Continuar el régimen habitual.',
    notes:['Efecto pleiotrópico cardioprotector perioperatorio.'],
    source:'Guía de Suspensión de Fármacos Perioperatorios' },

  { name:'Antiarrítmicos (Amiodarona, Digoxina, Flecainida)', category:'Cardiovascular',
    aliases:['amiodarona','digoxina','flecainida','propafenona','sotalol','antiarritmico','antiarritmicos','cordarone'],
    action:'mantener', when:'Incluido el día de la cirugía',
    summary:'No suspender. Mantener el esquema habitual.',
    notes:['Vigilar QT, función tiroidea (amiodarona) y niveles plasmáticos cuando aplique.'],
    source:'Guía de Suspensión de Fármacos Perioperatorios' },

  // --- Antiagregantes ---
  { name:'Aspirina (AAS)', category:'Antiagregante',
    aliases:['aspirina','aas','acido acetilsalicilico','ácido acetilsalicílico','cardioaspirina','ecotrin'],
    action:'individualizar', when:'Según riesgo trombótico vs hemorrágico',
    summary:'Mantener en prevención secundaria de alto riesgo (stent reciente, ACV, IAM). Suspender 5–7 días antes en prevención primaria o cirugías de alto riesgo hemorrágico (neurocirugía, columna, ocular cámara posterior).',
    notes:['Coordinar con cardiología en stents <12 meses.','En cirugía mayor habitual: la mayoría se mantiene.'],
    source:'Guía de Suspensión de Fármacos Perioperatorios' },

  { name:'Clopidogrel (Plavix)', category:'Antiagregante',
    aliases:['clopidogrel','plavix','iscover'],
    action:'suspender', when:'5–7 días antes de la cirugía',
    summary:'Suspender al menos 5 días antes (idealmente 7).',
    notes:['Evaluar puente con AAS en stent reciente.','Reiniciar 24 h postoperatorio si hemostasia adecuada.'],
    source:'Guía de Suspensión de Fármacos Perioperatorios' },

  { name:'Ticagrelor (Brilinta)', category:'Antiagregante',
    aliases:['ticagrelor','brilinta','brilique'],
    action:'suspender', when:'5 días antes de la cirugía',
    summary:'Suspender 5 días antes.',
    notes:['Coordinar con cardiología en SCA reciente o stent <12 meses.'],
    source:'Guía de Suspensión de Fármacos Perioperatorios' },

  { name:'Prasugrel (Effient)', category:'Antiagregante',
    aliases:['prasugrel','effient'],
    action:'suspender', when:'7 días antes de la cirugía',
    summary:'Suspender 7 días antes.',
    notes:['Mayor riesgo hemorrágico que clopidogrel.','Coordinar con cardiología.'],
    source:'Guía de Suspensión de Fármacos Perioperatorios' },

  // --- Anticoagulantes ---
  { name:'Warfarina / Acenocumarol', category:'Anticoagulante',
    aliases:['warfarina','acenocumarol','coumadin','sintrom','neosintrom','tao','aco'],
    action:'suspender', when:'5 días antes (warfarina) / 3 días antes (acenocumarol)',
    summary:'Suspender warfarina 5 días antes y acenocumarol 3 días antes. Control INR el día previo (objetivo <1.5).',
    notes:['Evaluar terapia puente con HBPM en alto riesgo trombótico (FA con CHA₂DS₂-VASc alto, prótesis mecánica mitral, TVP/TEP reciente).','Reiniciar 12–24 h postoperatorio con hemostasia adecuada.'],
    source:'Guía de Suspensión de Fármacos Perioperatorios' },

  { name:'DOACs — Rivaroxabán, Apixabán, Edoxabán', category:'Anticoagulante',
    aliases:['rivaroxaban','rivaroxabán','xarelto','apixaban','apixabán','eliquis','edoxaban','edoxabán','lixiana','daiichi','doac','noac','aod'],
    action:'suspender', when:'24–48 h antes según riesgo hemorrágico y función renal',
    summary:'Bajo riesgo hemorrágico: suspender 24 h antes. Alto riesgo hemorrágico: suspender 48 h antes.',
    notes:['Función renal normal (ClCr ≥50 mL/min): manejo estándar.','ClCr 30–49 mL/min: prolongar suspensión 48–72 h.','ClCr <30 mL/min: revisar caso a caso y considerar suspensión más prolongada.','Reiniciar a las 24–48 h postoperatorio según riesgo de sangrado.','No requieren terapia puente con HBPM.'],
    source:'Guía de Suspensión de Fármacos Perioperatorios' },

  { name:'Dabigatrán (Pradaxa)', category:'Anticoagulante',
    aliases:['dabigatran','dabigatrán','pradaxa'],
    action:'suspender', when:'Según función renal',
    summary:'ClCr ≥50 mL/min: suspender 48 h antes (bajo riesgo) o 72 h antes (alto riesgo). ClCr 30–49 mL/min: suspender 72 h antes (bajo riesgo) o 96 h antes (alto riesgo).',
    notes:['Más dependiente de función renal que el resto de los DOACs.','Antídoto específico: idarucizumab.','Reiniciar a las 24–48 h postoperatorio con hemostasia.'],
    source:'Guía de Suspensión de Fármacos Perioperatorios' },

  { name:'Enoxaparina (Clexane, Lovenox)', category:'Anticoagulante',
    aliases:['enoxaparina','clexane','lovenox','hbpm','heparina bajo peso','heparina de bajo peso molecular','enoxa'],
    action:'suspender', when:'Dosis profiláctica: 12 h antes. Dosis terapéutica: 24 h antes',
    summary:'Dosis profiláctica (40 mg/día o 20 mg/día): suspender última dosis al menos 12 h antes de la cirugía o de un bloqueo neuroaxial. Dosis terapéutica (1 mg/kg cada 12 h o 1,5 mg/kg/día): suspender al menos 24 h antes.',
    notes:['ClCr <30 mL/min: prolongar suspensión (24 h profilaxis, 48 h terapéutica) por acumulación.','Bloqueo neuroaxial / catéter epidural: respetar estrictamente intervalos ASRA (12 h profilaxis, 24 h terapéutica) para evitar hematoma espinal.','Reiniciar profilaxis: 6–12 h postoperatorio con hemostasia. Dosis terapéutica: 24 h post si bajo riesgo de sangrado, 48–72 h si alto riesgo.','Útil como terapia puente en pacientes con warfarina y alto riesgo trombótico (prótesis mecánica mitral, FA con CHA₂DS₂-VASc ≥7, TVP/TEP <3 meses).','Retirar catéter epidural ≥12 h después de última dosis profiláctica y ≥24 h de terapéutica; siguiente dosis ≥4 h después del retiro.'],
    source:'ASRA 2018 · ACCP CHEST 2022 · ESA 2018' },

  { name:'Dalteparina (Fragmin)', category:'Anticoagulante',
    aliases:['dalteparina','fragmin','hbpm','heparina bajo peso'],
    action:'suspender', when:'Dosis profiláctica: 12 h antes. Dosis terapéutica: 24 h antes',
    summary:'Dosis profiláctica (2500–5000 UI/día): suspender 12 h antes. Dosis terapéutica (200 UI/kg/día o 100 UI/kg cada 12 h): suspender al menos 24 h antes.',
    notes:['Mismas precauciones que enoxaparina para bloqueo neuroaxial (12 h profilaxis, 24 h terapéutica).','Ajustar en falla renal moderada-severa.','Útil como puente en alto riesgo trombótico con anticoagulación oral.'],
    source:'ASRA 2018 · ACCP CHEST 2022' },

  { name:'Nadroparina (Fraxiparina)', category:'Anticoagulante',
    aliases:['nadroparina','fraxiparina','fraxiparine','hbpm'],
    action:'suspender', when:'Dosis profiláctica: 12 h antes. Dosis terapéutica: 24 h antes',
    summary:'Profilaxis (2850–5700 UI/día): suspender 12 h antes. Terapéutica (85,5 UI/kg cada 12 h): suspender 24 h antes.',
    notes:['Mismas precauciones neuroaxiales que enoxaparina/dalteparina (intervalos ASRA).','Ajuste de dosis si ClCr <30 mL/min.'],
    source:'ASRA 2018 · ACCP CHEST 2022' },

  { name:'Tinzaparina (Innohep)', category:'Anticoagulante',
    aliases:['tinzaparina','innohep','hbpm'],
    action:'suspender', when:'Dosis profiláctica: 12 h antes. Dosis terapéutica: 24 h antes',
    summary:'Profilaxis (3500–4500 UI/día): suspender 12 h antes. Terapéutica (175 UI/kg/día): suspender al menos 24 h antes.',
    notes:['Mejor perfil en insuficiencia renal leve-moderada que otras HBPM (menor acumulación).','Mismas precauciones neuroaxiales que el resto de HBPM.'],
    source:'ASRA 2018 · ACCP CHEST 2022' },

  { name:'Heparina no fraccionada (HNF) SC / IV', category:'Anticoagulante',
    aliases:['heparina','hnf','heparina no fraccionada','heparina sodica','heparina sódica','liquemine','heparin'],
    action:'suspender', when:'SC profiláctica: 4–6 h antes. IV terapéutica: 4 h antes (control TTPa)',
    summary:'HNF subcutánea profiláctica (5000 UI cada 8–12 h): suspender 4–6 h antes. HNF IV en infusión terapéutica: suspender 4 h antes y verificar TTPa <40 s antes del bloqueo o cirugía.',
    notes:['Vida media corta (1–2 h IV) la hace útil como puente cuando se requiere reversión rápida.','Reiniciar 1 h postoperatorio (profilaxis SC) o 6–12 h postoperatorio sin bolo (IV) según riesgo de sangrado.','Útil como puente con HNF IV en pacientes con prótesis valvular mecánica que toleren hospitalización prolongada.','Vigilar plaquetas (riesgo de HIT) si uso >5 días.'],
    source:'ASRA 2018 · ACCP CHEST 2022' },

  { name:'Fondaparinux (Arixtra)', category:'Anticoagulante',
    aliases:['fondaparinux','arixtra'],
    action:'suspender', when:'Dosis profiláctica (2,5 mg): 36–42 h antes. Terapéutica: 4 días antes',
    summary:'Pentasacárido sintético anti-Xa. Profilaxis (2,5 mg/día): suspender 36–42 h antes. Dosis terapéutica (5–10 mg/día según peso): suspender al menos 4 días antes.',
    notes:['Vida media larga (17–21 h) → mayor latencia para revertir.','Sin antídoto específico (no neutralizado por protamina).','Bloqueo neuroaxial: ASRA contraindica anestesia neuroaxial si paciente recibe fondaparinux profiláctico salvo punción atraumática única.','Reiniciar 6–8 h postoperatorio (profilaxis) con hemostasia confirmada.','Ajustar/contraindicar si ClCr <30 mL/min.'],
    source:'ASRA 2018 · ACCP CHEST 2022' },

  { name:'Terapia puente con HBPM (bridging)', category:'Anticoagulante',
    aliases:['puente','bridging','bridge','terapia puente','heparinizacion puente','heparinización puente'],
    action:'individualizar', when:'Solo en alto riesgo trombótico',
    summary:'Indicado solo en alto riesgo trombótico al suspender anticoagulación oral (warfarina): prótesis valvular mecánica mitral, válvula aórtica con factores de riesgo, FA con CHA₂DS₂-VASc ≥7 o ACV/AIT <3 meses, TVP/TEP <3 meses, trombofilia severa.',
    notes:['Esquema típico: HBPM terapéutica (enoxaparina 1 mg/kg cada 12 h) iniciada el día -3, última dosis terapéutica completa 24 h antes de la cirugía (luego solo media dosis o suspender).','BRIDGE trial (NEJM 2015): en FA SIN alto riesgo, el puente con HBPM aumenta sangrado sin reducir tromboembolismo. NO usar puente en FA de bajo-moderado riesgo.','Reiniciar HBPM 24 h postoperatorio si bajo riesgo de sangrado, 48–72 h si alto riesgo.','Reiniciar warfarina en cuanto se tolere VO; mantener HBPM hasta INR terapéutico (≥2,0 en dos controles).','DOACs NO requieren terapia puente.'],
    source:'ACCP CHEST 2022 · BRIDGE trial NEJM 2015 · ESA 2018' },

  // --- Hipoglicemiantes ---
  { name:'Metformina', category:'Hipoglicemiante',
    aliases:['metformina','glucophage','glafornil','dimefor'],
    action:'suspender', when:'La mañana de la cirugía (o 24–48 h antes si insuficiencia renal)',
    summary:'Suspender la mañana de la cirugía. Si VFG <30 mL/min o cirugía con uso de contraste yodado: suspender 24–48 h antes.',
    notes:['Riesgo de acidosis láctica en hipoperfusión o falla renal aguda.','Reiniciar 48 h postoperatorio confirmando función renal estable.'],
    source:'Guía de Suspensión de Fármacos Perioperatorios' },

  { name:'iSGLT-2 (Empagliflozina, Dapagliflozina, Canagliflozina)', category:'Hipoglicemiante',
    aliases:['empagliflozina','dapagliflozina','canagliflozina','ertugliflozina','isglt2','sglt2','jardiance','forxiga','invokana','flozinas','flozina'],
    action:'suspender', when:'3–4 días antes de la cirugía',
    summary:'Suspender al menos 3 días antes (idealmente 4 días) por riesgo de cetoacidosis euglicémica perioperatoria.',
    notes:['Riesgo aumentado con ayuno prolongado, sepsis o estrés quirúrgico.','Reiniciar al recuperar ingesta oral normal y estabilidad hemodinámica.'],
    source:'Guía de Suspensión de Fármacos Perioperatorios' },

  { name:'Insulina basal (Glargina, Detemir, Degludec, NPH)', category:'Hipoglicemiante',
    aliases:['insulina','glargina','lantus','toujeo','detemir','levemir','degludec','tresiba','nph','insulatard','basal'],
    action:'individualizar', when:'Ajuste de dosis la mañana de la cirugía',
    summary:'Reducir la dosis matinal de insulina basal al 50–80% (según tipo y control glicémico). Suspender insulinas de acción rápida con el ayuno.',
    notes:['Control de HGT cada 1–2 h en intraoperatorio.','Objetivo: 140–180 mg/dL.','Reiniciar régimen habitual con tolerancia oral.'],
    source:'Guía de Suspensión de Fármacos Perioperatorios' },

  // --- Análogos GLP-1 ---
  { name:'Semaglutida oral (Rybelsus)', category:'GLP-1 (oral)',
    aliases:['semaglutida oral','rybelsus','semaglutida vo'],
    action:'suspender', when:'El día previo a la cirugía',
    summary:'Suspender el día previo (formulación oral diaria).',
    notes:['Riesgo de retraso del vaciamiento gástrico y aspiración.','Ayuno estricto según protocolo.'],
    source:'Ayuno Perioperatorio y Suspensión de GLP-1' },

  { name:'Liraglutida (Victoza, Saxenda)', category:'GLP-1 (diario SC)',
    aliases:['liraglutida','victoza','saxenda'],
    action:'suspender', when:'El día previo a la cirugía',
    summary:'Suspender el día previo (inyección diaria subcutánea).',
    notes:['Retraso del vaciamiento gástrico — riesgo de aspiración.','Reiniciar al tolerar dieta oral.'],
    source:'Ayuno Perioperatorio y Suspensión de GLP-1' },

  { name:'Semaglutida semanal (Ozempic, Wegovy)', category:'GLP-1 (semanal SC)',
    aliases:['semaglutida','ozempic','wegovy','semaglutida sc','semaglutida semanal'],
    action:'suspender', when:'1 semana antes de la cirugía',
    summary:'Suspender la dosis semanal al menos 7 días antes del procedimiento.',
    notes:['Retraso significativo del vaciamiento gástrico (efecto residual prolongado).','Considerar imagen gástrica (eco) si dudas sobre contenido residual.','Reiniciar al tolerar dieta oral postoperatoria.'],
    source:'Ayuno Perioperatorio y Suspensión de GLP-1' },

  { name:'Dulaglutida (Trulicity)', category:'GLP-1 (semanal SC)',
    aliases:['dulaglutida','trulicity'],
    action:'suspender', when:'1 semana antes de la cirugía',
    summary:'Suspender 7 días antes (administración semanal).',
    notes:['Retraso del vaciamiento gástrico — riesgo de aspiración.','Reiniciar al tolerar dieta oral.'],
    source:'Ayuno Perioperatorio y Suspensión de GLP-1' },

  { name:'Tirzepatida (Mounjaro)', category:'GLP-1/GIP (semanal SC)',
    aliases:['tirzepatida','mounjaro','zepbound'],
    action:'suspender', when:'1 semana antes de la cirugía',
    summary:'Suspender 7 días antes (administración semanal, agonista dual GLP-1/GIP).',
    notes:['Efecto sobre vaciamiento gástrico potencialmente mayor que GLP-1 puros.','Reiniciar al tolerar dieta oral postoperatoria.'],
    source:'Ayuno Perioperatorio y Suspensión de GLP-1' },

  // --- Neurología / Psiquiatría ---
  { name:'Antiparkinsonianos (Levodopa/Carbidopa, Pramipexol)', category:'Neurología',
    aliases:['levodopa','carbidopa','sinemet','madopar','pramipexol','ropinirol','rasagilina','selegilina','parkinson'],
    action:'mantener', when:'Incluido el día de la cirugía',
    summary:'No suspender. Administrar la dosis matinal con un sorbo de agua y reanudar lo antes posible postoperatorio.',
    notes:['La suspensión causa rigidez, disfagia y riesgo de síndrome neuroléptico maligno.','Evitar antieméticos antagonistas dopaminérgicos (metoclopramida, droperidol).'],
    source:'Guía de Suspensión de Fármacos Perioperatorios' },

  { name:'Antiepilépticos (Ácido valproico, Carbamazepina, Lamotrigina, Levetiracetam)', category:'Neurología',
    aliases:['acido valproico','ácido valproico','valproato','depakine','carbamazepina','tegretol','lamotrigina','lamictal','levetiracetam','keppra','fenitoina','fenitoína','antiepileptico','antiepilepticos','anticonvulsivante'],
    action:'mantener', when:'Incluido el día de la cirugía',
    summary:'No suspender. Mantener el esquema habitual para evitar crisis epilépticas perioperatorias.',
    notes:['Reanudar vía oral lo antes posible.','Vigilar interacciones (inducción enzimática) con anestésicos.'],
    source:'Guía de Suspensión de Fármacos Perioperatorios' },

  { name:'Antidepresivos tricíclicos (Amitriptilina, Imipramina, Nortriptilina)', category:'Psiquiatría',
    aliases:['amitriptilina','imipramina','nortriptilina','clomipramina','tricíclico','triciclico','tricíclicos','tca'],
    action:'individualizar', when:'Evaluar según riesgo cardiovascular',
    summary:'Habitualmente se mantienen. Considerar suspensión solo en pacientes con arritmias o QT prolongado.',
    notes:['Vigilar interacciones con vasopresores (efecto exagerado).','Evitar simpaticomiméticos indirectos (efedrina) — preferir fenilefrina/noradrenalina.'],
    source:'Guía de Suspensión de Fármacos Perioperatorios' },

  { name:'IMAO (Tranilcipromina, Fenelzina, Selegilina)', category:'Psiquiatría',
    aliases:['imao','tranilcipromina','fenelzina','selegilina','isocarboxazida','moclobemida'],
    action:'individualizar', when:'Idealmente suspender 2 semanas antes (coordinar con psiquiatría)',
    summary:'Riesgo de crisis hipertensiva y síndrome serotoninérgico con anestesia. Suspender 2 semanas antes si es posible. Si no es posible: técnica anestésica "IMAO-safe".',
    notes:['Evitar petidina (meperidina), dextrometorfano, tramadol.','Evitar simpaticomiméticos indirectos (efedrina).','Coordinar suspensión con psiquiatra tratante.'],
    source:'Guía de Suspensión de Fármacos Perioperatorios' }
];

// Tabla de Ayuno Perioperatorio + GLP-1
const AYUNO_TABLE_DATA = {
  rows: [
    { ingesta:'Líquidos claros (agua, té, café sin leche, jugos sin pulpa, bebidas isotónicas)', tiempo:'2 horas' },
    { ingesta:'Leche materna', tiempo:'4 horas' },
    { ingesta:'Fórmula láctea infantil', tiempo:'6 horas' },
    { ingesta:'Leche no humana / lácteos', tiempo:'6 horas' },
    { ingesta:'Sólidos en general — norma general (comida estándar, comida ligera, tostada, etc.)', tiempo:'6 horas', nota:'Norma general según guías europeas ESA 2023' },
    { ingesta:'Comida copiosa Y con alto contenido graso y/o proteico (frituras, carnes rojas, lácteos enteros, comida abundante) — AMBAS condiciones deben cumplirse', tiempo:'8 horas', nota:'Solo aplica 8h cuando sea copiosa + grasa/proteica. Si hay duda: criterio del anestesiólogo ± ecografía gástrica' }
  ],
  glp1Rows: [
    { farmaco:'Semaglutida oral (Rybelsus)', suspension:'El día previo' },
    { farmaco:'Liraglutida (Victoza, Saxenda) — diario SC', suspension:'El día previo' },
    { farmaco:'Semaglutida semanal (Ozempic, Wegovy)', suspension:'1 semana antes' },
    { farmaco:'Dulaglutida (Trulicity)', suspension:'1 semana antes' },
    { farmaco:'Tirzepatida (Mounjaro)', suspension:'1 semana antes' }
  ]
};

// Tabla resumen de suspensión perioperatoria
const SUSP_TABLE_DATA = [
  { grupo:'Cardiovascular', farmaco:'IECA', accion:'Suspender', tiempo:'24 h antes (si HTA). Mantener si IC.' },
  { grupo:'Cardiovascular', farmaco:'ARA-II', accion:'Suspender', tiempo:'24 h antes (si HTA). Mantener si IC.' },
  { grupo:'Cardiovascular', farmaco:'Betabloqueadores', accion:'Mantener', tiempo:'Incluido el día de cirugía' },
  { grupo:'Cardiovascular', farmaco:'Diuréticos', accion:'Suspender', tiempo:'Omitir dosis matinal' },
  { grupo:'Cardiovascular', farmaco:'Estatinas', accion:'Mantener', tiempo:'Sin cambios' },
  { grupo:'Cardiovascular', farmaco:'Antiarrítmicos (amiodarona, digoxina)', accion:'Mantener', tiempo:'Sin cambios' },
  { grupo:'Antiagregantes', farmaco:'Aspirina', accion:'Individualizar', tiempo:'Mantener en alto riesgo trombótico; suspender 5–7 d en alto riesgo hemorrágico' },
  { grupo:'Antiagregantes', farmaco:'Clopidogrel', accion:'Suspender', tiempo:'5–7 días antes' },
  { grupo:'Antiagregantes', farmaco:'Ticagrelor', accion:'Suspender', tiempo:'5 días antes' },
  { grupo:'Antiagregantes', farmaco:'Prasugrel', accion:'Suspender', tiempo:'7 días antes' },
  { grupo:'Anticoagulantes', farmaco:'Warfarina', accion:'Suspender', tiempo:'5 días antes (INR <1.5)' },
  { grupo:'Anticoagulantes', farmaco:'Acenocumarol', accion:'Suspender', tiempo:'3 días antes (INR <1.5)' },
  { grupo:'Anticoagulantes', farmaco:'DOACs (rivaroxabán, apixabán, edoxabán)', accion:'Suspender', tiempo:'24–48 h antes según función renal y riesgo' },
  { grupo:'Anticoagulantes', farmaco:'Dabigatrán', accion:'Suspender', tiempo:'48–96 h antes según ClCr' },
  { grupo:'Hipoglicemiantes', farmaco:'Metformina', accion:'Suspender', tiempo:'Día de cirugía (24–48 h si VFG <30)' },
  { grupo:'Hipoglicemiantes', farmaco:'iSGLT-2 (flozinas)', accion:'Suspender', tiempo:'3–4 días antes' },
  { grupo:'Hipoglicemiantes', farmaco:'Insulina basal', accion:'Individualizar', tiempo:'50–80% de dosis habitual' },
  { grupo:'Neurología', farmaco:'Antiparkinsonianos', accion:'Mantener', tiempo:'Dosis matinal con sorbo de agua' },
  { grupo:'Neurología', farmaco:'Antiepilépticos', accion:'Mantener', tiempo:'Sin cambios' },
  { grupo:'Psiquiatría', farmaco:'IMAO', accion:'Individualizar', tiempo:'2 semanas antes (coordinar con psiquiatría)' }
];

// --- Consulta Preanestésica: agenda + sobrecupo ---
const CONSULTA_PREANESTESICA = {
  agenda: [
    { dia:'Martes',    bloque:'AM', medico:'Dr. Rodríguez',     iniciales:'JR' },
    { dia:'Miércoles', bloque:'AM', medico:'Dra. Santa María',  iniciales:'SM' },
    { dia:'Viernes',   bloque:'AM', medico:'Dr. Fierro',        iniciales:'DF' }
  ],
  sobrecupoEmail: 'jprodriguez@clinicauandes.cl',
  sobrecupoCC: '',
  contacto: 'Coordinación Servicio de Anestesia'
};

// --- Exámenes Preoperatorios: matrices por riesgo quirúrgico × ASA ---
// Fuente: Actualizaciones en evaluación preoperatoria · Dr. F. Rojas (CUA, 2026)
const EXAM_PREOP_MATRIX = {
  bajo: {
    titulo: 'Cirugía de bajo riesgo (<1%)',
    desc: 'Ej.: cirugía menor ambulatoria, oftalmológica, dermatológica, endoscopía diagnóstica.',
    rows: [
      { test:'Hemograma',                  asa1:'No de rutina', asa2:'No de rutina', asa34:'No de rutina' },
      { test:'Pruebas de coagulación',     asa1:'No de rutina', asa2:'No de rutina', asa34:'No de rutina' },
      { test:'Función renal (BUN/Crea/ELP)', asa1:'No de rutina', asa2:'No de rutina', asa34:'Considerar si existe riesgo de AKI' },
      { test:'Electrocardiograma',         asa1:'No de rutina', asa2:'No de rutina', asa34:'Considerar si no hay ECG de los últimos 12 meses' },
      { test:'PFP / Gases arteriales',     asa1:'No de rutina', asa2:'No de rutina', asa34:'No de rutina' }
    ]
  },
  intermedio: {
    titulo: 'Cirugía de riesgo intermedio (1–5%)',
    desc: 'Ej.: cirugía abdominal, ginecológica, urológica, otorrinolaringológica electiva.',
    rows: [
      { test:'Hemograma',                  asa1:'No de rutina', asa2:'No de rutina', asa34:'Considerar en pacientes con enfermedad CV o renal con cambios clínicos recientes' },
      { test:'Pruebas de coagulación',     asa1:'No de rutina', asa2:'No de rutina', asa34:'Considerar en DHC · Considerar en TACO' },
      { test:'Función renal (BUN/Crea/ELP)', asa1:'No de rutina', asa2:'Considerar si riesgo de AKI', asa34:'Indicado' },
      { test:'Electrocardiograma',         asa1:'No de rutina', asa2:'Considerar en pacientes con FRCV', asa34:'Indicado' },
      { test:'PFP / Gases arteriales',     asa1:'No de rutina', asa2:'No de rutina', asa34:'Considerar enviar a consulta de evaluación preoperatoria' }
    ]
  },
  alto: {
    titulo: 'Cirugía de alto riesgo (>5%)',
    desc: 'Ej.: cirugía vascular mayor (aorta), torácica mayor, neurocirugía, transplante.',
    rows: [
      { test:'Hemograma',                  asa1:'Sí',  asa2:'Sí',  asa34:'Sí' },
      { test:'Pruebas de coagulación',     asa1:'No de rutina', asa2:'No de rutina', asa34:'Considerar en DHC · Considerar en TACO' },
      { test:'Función renal (BUN/Crea/ELP)', asa1:'Considerar si riesgo de AKI', asa2:'Sí', asa34:'Sí' },
      { test:'Electrocardiograma',         asa1:'Considerar si no hay ECG de los últimos 12 meses', asa2:'Sí', asa34:'Sí' },
      { test:'PFP / Gases arteriales',     asa1:'No de rutina', asa2:'No de rutina', asa34:'Considerar enviar a consulta de evaluación preoperatoria' }
    ]
  }
};

// Exámenes específicos según comorbilidad / situación clínica
const EXAM_PREOP_ESPECIFICOS = [
  { cond:'Diabetes mellitus',                     pedir:'HbA1c (vigente <3 meses) · HGT mismo día de la cirugía', nota:'Mantener glicemia perioperatoria <180 mg/dL. HbA1c no de rutina en no diabéticos.' },
  { cond:'Mujer en edad fértil',                  pedir:'Anamnesis dirigida. β-HCG si existe duda razonable (con consentimiento)', nota:'Informar y documentar riesgos quirúrgicos/anestésicos en caso de embarazo.' },
  { cond:'Síntomas urinarios o cirugía que afecte vía urinaria', pedir:'Orina completa · urocultivo', nota:'No solicitar de rutina en asintomáticos.' },
  { cond:'Sospecha de IC sintomática / cardiopatía no estudiada', pedir:'Ecocardiograma + optimización por especialista (1B)', nota:'No repetir si ecocardiograma <12 meses sin cambios clínicos.' },
  { cond:'Cirugía alto riesgo (>5%) con CF <4 METs o desconocida', pedir:'Considerar Angio-TAC coronario (2B)', nota:'Sin beneficio en pacientes con buena capacidad funcional o cirugía de bajo riesgo.' },
  { cond:'≥65 a · o ≥45 a con enfermedad CV — en cirugía de riesgo intermedio/alto', pedir:'NT-proBNP/BNP para estratificación (ESC 2022, IIa) · troponinas postop si está elevado', nota:'NO indicado en cirugía de bajo riesgo. Si está elevado, vigilar troponinas días 1–2 (MINS).' },
  { cond:'Marcapasos (MCP) / Desfibrilador (DAI)', pedir:'Planificación previa si habrá interferencia electromagnética (1B). Reprogramación o imán intraop. en cirugía supraumbilical (1B)', nota:'Coordinar con cardiología/electrofisiología.' },
  { cond:'TACO / NOAC',                           pedir:'INR día previo (TACO) · función renal y revisar tabla de suspensión (NOAC)', nota:'TTPa/TP/INR normales NO excluyen efecto residual de NOACs.' },
  { cond:'EPOC severo o sospecha de hipoxemia',    pedir:'GSA · espirometría reciente', nota:'PFP/GSA no de rutina, solo dirigidos.' }
];

// Tiempos de espera obligatorios tras eventos CV (slides 39-40 del PPT)
const EXAM_PREOP_DIFERIR = [
  { evento:'ACV o AIT reciente',                                tiempo:'Diferir cirugía electiva ≥ 3 meses (2B)' },
  { evento:'Angioplastia sin stent',                            tiempo:'Diferir ≥ 14 días' },
  { evento:'Angioplastia c/stent en SCA',                       tiempo:'Diferir ≥ 12 meses idealmente' },
  { evento:'Angioplastia c/stent (cardiopatía coronaria estable)', tiempo:'Diferir ≥ 6 meses' },
  { evento:'Angioplastia c/stent + cirugía tiempo-sensible',    tiempo:'Diferir ≥ 3 meses (evitar siempre < 30 días)' }
];

// Recomendaciones generales (slide 41)
const EXAM_PREOP_RECOMENDACIONES = [
  'Exámenes siempre guiados por anamnesis y examen físico.',
  'Considerar el ASA y riesgo inherente al procedimiento.',
  'En pacientes estables, exámenes <6 meses siguen siendo válidos si no hay cambios clínicos.',
  'Tanto laboratorio como imágenes tienen alta prevalencia de falsos positivos → pueden llevar a decisiones erróneas.'
];

// --- Anticoagulantes / Antiagregantes: manejo periop ---
const ANTICOAG_TABLE = [
  { grupo:'Antiagregantes', farmaco:'AAS 75–100 mg', suspender:'Mantener en general. Suspender 7 d en neuroQx, prostatectomía radical, catarata intraocular o sangrado activo.', reiniciar:'12–24 h postop si hemostasia ok.' },
  { grupo:'Antiagregantes', farmaco:'AAS ≥ 300 mg', suspender:'Suspender 7 días', reiniciar:'24 h postop' },
  { grupo:'Antiagregantes', farmaco:'Clopidogrel (Plavix)', suspender:'Suspender 5–7 días', reiniciar:'24 h postop si hemostasia ok' },
  { grupo:'Antiagregantes', farmaco:'Prasugrel (Effient)', suspender:'Suspender 7 días', reiniciar:'24 h postop' },
  { grupo:'Antiagregantes', farmaco:'Ticagrelor (Brilinta)', suspender:'Suspender 5 días', reiniciar:'24 h postop' },
  { grupo:'AVK (cumarínicos)', farmaco:'Warfarina (Coumadin)', suspender:'Suspender 5 d antes. Controlar INR día previo (objetivo <1.5). Considerar bridging con HBPM en alto riesgo trombótico.', reiniciar:'12–24 h postop si hemostasia ok. INR objetivo 2–3 (3–4 si válvula mecánica mitral).' },
  { grupo:'AVK (cumarínicos)', farmaco:'Acenocumarol (Neosintrón)', suspender:'Suspender 3 d antes. Controlar INR día previo.', reiniciar:'12–24 h postop si hemostasia ok' },
  { grupo:'NOAC / DOAC', farmaco:'Apixabán (Eliquis)', suspender:'ClCr ≥50: 24 h (bajo riesgo Hg), 48 h (alto). ClCr <50: 48–72 h.', reiniciar:'24 h postop bajo riesgo, 48–72 h alto riesgo' },
  { grupo:'NOAC / DOAC', farmaco:'Rivaroxabán (Xarelto)', suspender:'Igual a apixabán', reiniciar:'24 h bajo riesgo, 48–72 h alto riesgo' },
  { grupo:'NOAC / DOAC', farmaco:'Edoxabán (Lixiana)', suspender:'24–48 h según ClCr', reiniciar:'24 h postop' },
  { grupo:'NOAC / DOAC', farmaco:'Dabigatrán (Pradaxa)', suspender:'ClCr ≥80: 24 h · 50–80: 36 h · 30–50: 48 h · <30: 72–96 h', reiniciar:'24 h bajo riesgo, 48–72 h alto. Antídoto: idarucizumab.' },
  { grupo:'Heparinas', farmaco:'HBPM dosis profiláctica (enoxaparina 40 mg/d)', suspender:'12 h antes', reiniciar:'6–12 h postop si hemostasia' },
  { grupo:'Heparinas', farmaco:'HBPM dosis terapéutica (1 mg/kg c/12 h)', suspender:'24 h antes', reiniciar:'24 h postop' },
  { grupo:'Heparinas', farmaco:'HNF EV', suspender:'Suspender 4–6 h antes (controlar TTPa)', reiniciar:'4 h postop sin bolo' }
];

// --- Riesgo CV: METs y RCRI ---
const METS_TABLE = [
  { mets:'1 MET',       actividad:'Comer · vestirse · usar el baño · caminar dentro de la casa' },
  { mets:'4 METs',      actividad:'Subir 1 piso de escalera · caminar rápido en plano (6 km/h) · trabajos livianos del hogar' },
  { mets:'4–10 METs',   actividad:'Trotar suave · ejercicio recreativo · ciclismo recreativo · golf · baile' },
  { mets:'> 10 METs',   actividad:'Deportes vigorosos: natación intensa · tenis competitivo · fútbol · esquí' }
];
const RCRI_FACTORES = [
  'Cirugía de alto riesgo (intraperitoneal, intratorácica, vascular suprainguinal)',
  'Cardiopatía isquémica (IAM previo, angina, prueba de esfuerzo +, uso de nitratos, Q patológicas en ECG)',
  'Insuficiencia cardíaca congestiva',
  'ACV o AIT previo',
  'Diabetes mellitus en tratamiento con insulina',
  'Creatinina sérica > 2 mg/dL'
];
const RCRI_RIESGO = [
  { n:'0 factores', riesgo:'0,4 % de evento cardíaco mayor' },
  { n:'1 factor',   riesgo:'0,9 %' },
  { n:'2 factores', riesgo:'6,6 %' },
  { n:'≥ 3 factores', riesgo:'≥ 11 %' }
];

// Normalización (lowercase + sin acentos) para búsqueda tolerante.
function _gpNorm(s){
  return String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();
}

// Escape HTML
function _gpEsc(s){
  return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// Clase modificadora del badge — el CSS define .gp-badge.suspender/.mantener/.individualizar
function _gpActionClass(action){
  const a = String(action||'').toLowerCase();
  if(a === 'suspender') return 'suspender';
  if(a === 'mantener') return 'mantener';
  return 'individualizar';
}
// Clase del card para borde lateral coloreado (.gp-card.action-suspender etc.)
function _gpCardClass(action){
  const a = String(action||'').toLowerCase();
  if(a === 'suspender') return 'action-suspender';
  if(a === 'mantener') return 'action-mantener';
  return 'action-individualizar';
}
function _gpActionLabel(action){
  const a = String(action||'').toLowerCase();
  if(a === 'suspender') return 'SUSPENDER';
  if(a === 'mantener') return 'MANTENER';
  return 'INDIVIDUALIZAR';
}

// Abre el módulo Guías Perioperatorias (overlay fullscreen, sin login).
function openGuiasModule(){
  const mod = document.getElementById('modulesScreen');
  if(mod) mod.classList.add('hidden');
  const g = document.getElementById('guiasScreen');
  if(g) g.classList.remove('hidden');
  try{ updateAiButtons(); }catch(e){}
  // Estado inicial: buscador limpio, bloque por defecto visible, home grid visible, sub-vistas cerradas.
  const inp = document.getElementById('gpSearchInput');
  if(inp){ inp.value=''; setTimeout(() => inp.focus(), 50); }
  const def = document.getElementById('gpDefaultBlock');
  if(def) def.classList.remove('hidden');
  const res = document.getElementById('gpSearchResults');
  if(res) res.innerHTML = '';
  // Volver al home grid: oculta sub-vistas y muestra el grid.
  document.querySelectorAll('#guiasScreen .gp-section-view').forEach(s => s.classList.remove('active'));
  const home = document.getElementById('gpPortalHome');
  if(home) home.style.display = '';
  // Oculta FAB
  const fab = document.getElementById('gpFab');
  if(fab) fab.classList.add('hidden');
  if(typeof _GP_ACTIVE_CALC !== 'undefined'){ _GP_ACTIVE_CALC = null; }
  // Scroll del body al tope
  const body = document.querySelector('#guiasScreen .guias-body');
  if(body) body.scrollTop = 0;
}

// Volver desde Guías al selector de módulos.
function backToModulesFromGuias(){
  const g = document.getElementById('guiasScreen');
  if(g) g.classList.add('hidden');
  showModulesScreen();
}

// Búsqueda en vivo.
function onGuiasSearchInput(){
  const inp = document.getElementById('gpSearchInput');
  const q = inp ? inp.value : '';
  const def = document.getElementById('gpDefaultBlock');
  if(_gpNorm(q).length === 0){
    if(def) def.classList.remove('hidden');
    const res = document.getElementById('gpSearchResults');
    if(res) res.innerHTML = '';
    return;
  }
  if(def) def.classList.add('hidden');
  renderGuiasSearchResults(q);
}

// Botón "X" → limpia búsqueda y vuelve al estado inicial.
function clearGuiasSearch(){
  const inp = document.getElementById('gpSearchInput');
  if(inp){ inp.value=''; inp.focus(); }
  onGuiasSearchInput();
}

// Renderiza tarjetas de fármacos que matchean la query.
function renderGuiasSearchResults(query){
  const res = document.getElementById('gpSearchResults');
  if(!res) return;
  const q = _gpNorm(query);
  const matches = GUIA_DRUGS.filter(d => {
    if(_gpNorm(d.name).includes(q)) return true;
    if(_gpNorm(d.category).includes(q)) return true;
    if((d.aliases||[]).some(a => _gpNorm(a).includes(q))) return true;
    return false;
  });

  if(matches.length === 0){
    res.innerHTML = `
      <div class="gp-results-header">Resultados para «<strong>${_gpEsc(query)}</strong>» (0)</div>
      <div class="gp-no-results">
        <strong>Sin resultados</strong> para "${_gpEsc(query)}".<br>
        Prueba con el principio activo (ej: "rivaroxabán") o nombre comercial (ej: "Xarelto").
      </div>`;
    return;
  }

  let cards = '';
  for(const d of matches){
    const badgeCls = _gpActionClass(d.action);
    const cardCls = _gpCardClass(d.action);
    const lbl = _gpActionLabel(d.action);
    let notesHtml = '';
    if(d.notes && d.notes.length){
      notesHtml = `
        <div class="gp-row">
          <div class="gp-row-k">Notas adicionales</div>
          <div class="gp-row-v"><ul class="gp-notes-list">${d.notes.map(n => `<li>${_gpEsc(n)}</li>`).join('')}</ul></div>
        </div>`;
    }
    let aliasesHtml = '';
    if(d.aliases && d.aliases.length){
      const visible = d.aliases.slice(0, 8);
      aliasesHtml = `<div class="gp-aliases">También: ${visible.map(a => _gpEsc(a)).join(' · ')}${d.aliases.length>8?' …':''}</div>`;
    }
    cards += `
      <div class="gp-card ${cardCls}">
        <div class="gp-card-head">
          <div class="gp-card-name">${_gpEsc(d.name)}</div>
          <span class="gp-badge ${badgeCls}">${lbl}</span>
        </div>
        <div class="gp-row">
          <div class="gp-row-k">Categoría</div>
          <div class="gp-row-v">${_gpEsc(d.category)}</div>
        </div>
        <div class="gp-row">
          <div class="gp-row-k">Cuándo</div>
          <div class="gp-row-v when">${_gpEsc(d.when)}</div>
        </div>
        <div class="gp-row">
          <div class="gp-row-k">Recomendación</div>
          <div class="gp-row-v">${_gpEsc(d.summary)}</div>
        </div>
        ${notesHtml}
        ${aliasesHtml}
        <div class="gp-source">
          <span>${_gpEsc(d.source)}</span>
          <span class="gp-source-tag">Andes</span>
        </div>
      </div>`;
  }

  res.innerHTML = `
    <div class="gp-results-header">Resultados para «<strong>${_gpEsc(query)}</strong>» · ${matches.length} ${matches.length===1?'fármaco':'fármacos'}</div>
    <div class="gp-results">${cards}</div>`;
}

// ============================================================
// Portal Preanestésico · Navegación grid → sub-vista
// ============================================================
// Cada sección define: bodyId, render, hero (label + chips), y opcional calc {label, render}.
const _GP_SECTIONS_META = {
  gpConsulta: {
    bodyId: 'gpConsultaBody',
    render: () => renderGuiasConsultaPreanestesica(),
    hero: {
      label: 'Resumen rápido',
      chips: ['Mar, Mié y Vie · 08:00–14:00 hrs', 'Solicite sobrecupo con el botón de abajo']
    }
  },
  gpAyuno: {
    bodyId: 'gpAyunoBody',
    render: () => renderGuiasAyunoTable(),
    hero: {
      label: 'Tiempos de ayuno',
      chips: ['6 h sólidos (norma general)', '8 h si copiosa + grasa/prot.', '2 h líquidos claros', 'GLP-1 ≥ 7 d']
    }
  },
  gpSusp: {
    bodyId: 'gpSuspBody',
    render: () => renderGuiasSuspTable(),
    hero: {
      label: 'Reglas clave',
      chips: ['AAS: continuar', 'Clopidogrel: 5–7 d', 'Warfarina: 5 d', 'NOACs: ver tabla']
    }
  },
  gpExam: {
    bodyId: 'gpExamBody',
    render: () => renderGuiasExamenes(),
    hero: {
      label: 'Criterio general',
      chips: ['ASA I–II bajo: nada', 'Pedir dirigido', 'Vigentes ≤ 6 meses']
    },
    calc: {
      label: 'Abrir calculadora',
      title: 'Calculadora de exámenes preoperatorios',
      ico: '🧪',
      render: () => _renderExamCalcCard()
    }
  },
  gpAnticoag: {
    bodyId: 'gpAnticoagBody',
    render: () => renderGuiasAnticoag(),
    hero: {
      label: 'Decisiones clave',
      chips: ['Riesgo tromb. vs hemorr.', 'Bridge según riesgo', 'Reversión urgente disponible']
    }
  },
  gpRiesgoCv: {
    bodyId: 'gpRiesgoCvBody',
    render: () => renderGuiasRiesgoCv(),
    hero: {
      label: 'RCRI · referencia',
      chips: ['0 factores → 0,4 %', '1 → 0,9 %', '2 → 6,6 %', '≥ 3 → ≥ 11 %', 'Umbral 4 METs']
    },
    calc: {
      label: 'Abrir calculadora RCRI',
      title: 'Calculadora RCRI · Lee Revised Cardiac Risk Index',
      ico: '❤️',
      render: () => _renderRcriCalcCard()
    }
  },
  gpRiesgoTev: {
    bodyId: 'gpRiesgoTevBody',
    render: () => renderGuiasRiesgoTev(),
    hero: {
      label: 'Caprini 2005 · referencia',
      chips: ['0 → muy bajo', '1-2 → bajo', '3-4 → moderado', '≥5 → alto', 'Coordinar ASRA']
    },
    calc: {
      label: 'Abrir calculadora Caprini',
      title: 'Calculadora de riesgo de TVP/TEP · Caprini 2005',
      ico: '🦵',
      render: () => _renderCapriniCalcCard()
    }
  }
};
const _GP_SECTIONS = Object.keys(_GP_SECTIONS_META);
let _GP_ACTIVE_CALC = null;

function _renderGpHero(hero){
  if(!hero || !hero.chips || !hero.chips.length) return '';
  const chips = hero.chips.map(c => `<span class="gp-hero-chip">${_gpEsc(c)}</span>`).join('');
  return `
    <div class="gp-hero">
      <div class="gp-hero-label"><span class="gp-hero-label-dot"></span>${_gpEsc(hero.label || 'Resumen')}</div>
      <div class="gp-hero-chips">${chips}</div>
    </div>`;
}

function openGuiasSection(id){
  const meta = _GP_SECTIONS_META[id];
  if(!meta) return;
  // Oculta home
  const home = document.getElementById('gpPortalHome');
  if(home) home.style.display = 'none';
  // Oculta todas las sub-vistas
  _GP_SECTIONS.forEach(k => {
    const e = document.getElementById(k);
    if(e) e.classList.remove('active');
  });
  // Muestra la sub-vista solicitada
  const el = document.getElementById(id);
  if(el) el.classList.add('active');
  // Render contenido
  try{ if(typeof meta.render === 'function') meta.render(); }catch(e){ console.error('Render error', id, e); }
  // Prepend hero al body si corresponde
  const body = document.getElementById(meta.bodyId);
  if(body && meta.hero){
    body.insertAdjacentHTML('afterbegin', _renderGpHero(meta.hero));
  }
  // FAB calculadora
  const fab = document.getElementById('gpFab');
  if(fab){
    if(meta.calc){
      fab.classList.remove('hidden');
      const lbl = document.getElementById('gpFabLabel');
      if(lbl) lbl.textContent = meta.calc.label;
      _GP_ACTIVE_CALC = meta.calc;
    } else {
      fab.classList.add('hidden');
      _GP_ACTIVE_CALC = null;
    }
  }
  // Scroll arriba
  const wrap = document.querySelector('#guiasScreen .guias-body');
  if(wrap){ try{ wrap.scrollTo({top:0, behavior:'instant'}); }catch(e){ wrap.scrollTop = 0; } }
}

function closeGuiasSection(){
  // Oculta todas las sub-vistas
  _GP_SECTIONS.forEach(k => {
    const e = document.getElementById(k);
    if(e) e.classList.remove('active');
  });
  // Muestra home
  const home = document.getElementById('gpPortalHome');
  if(home) home.style.display = '';
  // Oculta FAB
  const fab = document.getElementById('gpFab');
  if(fab) fab.classList.add('hidden');
  _GP_ACTIVE_CALC = null;
  // Scroll arriba
  const wrap = document.querySelector('#guiasScreen .guias-body');
  if(wrap){ try{ wrap.scrollTo({top:0, behavior:'instant'}); }catch(e){ wrap.scrollTop = 0; } }
}

// Volver context-aware del header del Portal:
//   - Si hay una sub-vista abierta → vuelve al grid de cards
//   - Si está en el grid → vuelve al selector de módulos
function guiasBack(){
  const anySubViewOpen = _GP_SECTIONS.some(k => {
    const e = document.getElementById(k);
    return e && e.classList.contains('active');
  });
  if(anySubViewOpen){
    closeGuiasSection();
  } else {
    backToModulesFromGuias();
  }
}

// Helper para construir un accordion (bloque desplegable).
// items: [{ ico, title, meta, html, open }]
function _renderGpAcc(items){
  if(!Array.isArray(items)) return '';
  let out = '';
  for(const it of items){
    if(!it) continue;
    const openCls = it.open ? ' open' : '';
    const ico = it.ico ? `<span class="gp-acc-ico">${_gpEsc(it.ico)}</span>` : '';
    const meta = it.meta ? `<span class="gp-acc-meta">${_gpEsc(it.meta)}</span>` : '';
    out += `
      <div class="gp-acc${openCls}">
        <button type="button" class="gp-acc-head" onclick="toggleGpAcc(this)">
          ${ico}
          <span class="gp-acc-title">${_gpEsc(it.title || '')}</span>
          ${meta}
          <span class="gp-acc-chev">›</span>
        </button>
        <div class="gp-acc-body">${it.html || ''}</div>
      </div>`;
  }
  return out;
}

function toggleGpAcc(btn){
  if(!btn) return;
  const acc = btn.closest('.gp-acc');
  if(acc) acc.classList.toggle('open');
}

function openCalcModal(){
  if(!_GP_ACTIVE_CALC) return;
  const c = _GP_ACTIVE_CALC;
  const inner = (typeof c.render === 'function') ? c.render() : '';
  const html = `
    <div class="gp-calc-modal-head">
      <div class="gp-calc-modal-ico">${_gpEsc(c.ico || '🧮')}</div>
      <div class="gp-calc-modal-title">${_gpEsc(c.title || 'Calculadora')}</div>
      <button type="button" class="gp-calc-modal-close" onclick="closeCalcModal()" aria-label="Cerrar">×</button>
    </div>
    <div class="gp-calc-modal-body">${inner}</div>`;
  const modalEl = document.getElementById('modal');
  if(modalEl) modalEl.classList.add('gp-calc-modal');
  modal(html);
}
function closeCalcModal(){
  const modalEl = document.getElementById('modal');
  if(modalEl) modalEl.classList.remove('gp-calc-modal');
  closeModal();
}

// Compatibilidad: si algún call-site antiguo usa toggleGuiasSection, redirige al nuevo flujo.
function toggleGuiasSection(id){ openGuiasSection(id); }

// Render tabla Ayuno + GLP-1
function renderGuiasAyunoTable(){
  const cont = document.getElementById('gpAyunoBody');
  if(!cont) return;
  // Tabla tiempos de ayuno
  let tablaAyuno = '<table class="gp-table"><thead><tr><th>Tipo de ingesta</th><th class="col-time">Tiempo mínimo</th></tr></thead><tbody>';
  for(const r of AYUNO_TABLE_DATA.rows){
    const notaHtml = r.nota ? `<div style="font-size:11px;color:var(--muted);margin-top:3px;line-height:1.4">${_gpEsc(r.nota)}</div>` : '';
    tablaAyuno += `<tr><td>${_gpEsc(r.ingesta)}${notaHtml}</td><td class="col-time" style="white-space:nowrap"><strong>${_gpEsc(r.tiempo)}</strong></td></tr>`;
  }
  tablaAyuno += '</tbody></table>';
  tablaAyuno += `
    <div class="gp-callout warning" style="margin-top:12px">
      <strong>⚠ Regla clave:</strong> La norma general para sólidos es <strong>6 horas</strong> (guías europeas ESA 2023). Las <strong>8 horas</strong> aplican <em>únicamente</em> cuando la comida es <strong>copiosa Y además rica en grasas y/o proteínas</strong> (ambas condiciones). En caso de duda o cuando la comida fue copiosa + grasa/proteica, la decisión queda a <strong>criterio del anestesiólogo</strong> según evaluación personalizada y eventual <strong>ecografía gástrica</strong>.
    </div>`;
  // Tabla GLP-1
  let tablaGlp1 = '<table class="gp-table"><thead><tr><th>Fármaco</th><th class="col-time">Suspensión</th></tr></thead><tbody>';
  for(const r of AYUNO_TABLE_DATA.glp1Rows){
    tablaGlp1 += `<tr><td>${_gpEsc(r.farmaco)}</td><td class="col-time">${_gpEsc(r.suspension)}</td></tr>`;
  }
  tablaGlp1 += '</tbody></table>';

  const html = _renderGpAcc([
    { ico:'⏱️', title:'Tiempos de ayuno por tipo de ingesta', meta:`${AYUNO_TABLE_DATA.rows.length} ítems`, html: tablaAyuno, open: true },
    { ico:'💉', title:'Suspensión de análogos GLP-1', meta:`${AYUNO_TABLE_DATA.glp1Rows.length} fármacos`, html: tablaGlp1, open: false }
  ]) + '<p class="gp-foot-note">Referencia: Guía de Ayuno Perioperatorio y Suspensión de GLP-1 — Clínica Universidad de los Andes.</p>';
  cont.innerHTML = html;
}

// Render tabla Suspensión de Fármacos — agrupado por grupo en accordions.
function renderGuiasSuspTable(){
  const cont = document.getElementById('gpSuspBody');
  if(!cont) return;
  // Agrupar por r.grupo preservando orden de aparición
  const grupos = [];
  const porGrupo = {};
  for(const r of SUSP_TABLE_DATA){
    if(!Object.prototype.hasOwnProperty.call(porGrupo, r.grupo)){
      grupos.push(r.grupo);
      porGrupo[r.grupo] = [];
    }
    porGrupo[r.grupo].push(r);
  }
  // Icono por grupo (fallback a 💊)
  const grupoIco = {
    'Cardiovascular':'❤️',
    'Diabetes':'🩺','Diabéticos':'🩺','Antidiabéticos':'🩺',
    'Anticoagulantes':'🩸','Antiagregantes':'🩸',
    'Psiquiátricos':'🧠','Neurológicos':'🧠',
    'Hormonales':'⚖️','Anticonceptivos':'⚖️',
    'Respiratorios':'🌬️',
    'Inmunosupresores':'🛡️',
    'Suplementos':'🌿','Herbales':'🌿'
  };
  const items = grupos.map((g, i) => {
    let body = '<table class="gp-table"><thead><tr><th>Fármaco</th><th>Acción</th><th>Tiempo / Observación</th></tr></thead><tbody>';
    for(const r of porGrupo[g]){
      const accionCls = _gpActionClass(r.accion);
      body += `<tr><td>${_gpEsc(r.farmaco)}</td><td><span class="gp-badge ${accionCls}">${_gpEsc(r.accion.toUpperCase())}</span></td><td>${_gpEsc(r.tiempo)}</td></tr>`;
    }
    body += '</tbody></table>';
    return { ico: grupoIco[g] || '💊', title: g, meta: `${porGrupo[g].length}`, html: body, open: i === 0 };
  });
  cont.innerHTML = _renderGpAcc(items) + '<p class="gp-foot-note">Referencia: Guía de Suspensión de Fármacos Perioperatorios — Clínica Universidad de los Andes. Las recomendaciones son orientativas; cada paciente debe evaluarse individualmente.</p>';
}

// ============================================================
// SECCIÓN: Consulta Preanestésica (agenda fija + mailto sobrecupo)
// ============================================================
function renderGuiasConsultaPreanestesica(){
  const cont = document.getElementById('gpConsultaBody');
  if(!cont) return;
  const agenda = CONSULTA_PREANESTESICA.agenda;
  let cards = '';
  for(const a of agenda){
    cards += `
      <div class="gp-agenda-card">
        <div class="gp-agenda-avatar">${_gpEsc(a.iniciales)}</div>
        <div class="gp-agenda-body">
          <div class="gp-agenda-medico">${_gpEsc(a.medico)}</div>
          <div class="gp-agenda-horario">${_gpEsc(a.dia)} · ${_gpEsc(a.bloque)}</div>
        </div>
        <div class="gp-agenda-pill">${_gpEsc(a.bloque)}</div>
      </div>`;
  }
  const calloutHtml = `
    <div class="gp-callout">
      <strong>📅 Consulta Preanestésica programada.</strong> Estos son los horarios disponibles para evaluación preanestésica con cada profesional. Contáctese directamente con el Servicio de Anestesia para coordinar la hora.
    </div>`;
  const agendaHtml = `<div class="gp-agenda-list">${cards}</div>`;
  const sobrecupoHtml = `
    <div class="gp-sobrecupo-block" style="margin-top:0">
      <div class="gp-sobrecupo-title">¿No hay hora disponible?</div>
      <div class="gp-sobrecupo-desc">Solicita un <strong>sobrecupo</strong> o evaluación preanestésica adicional escribiendo directamente a ${_gpEsc(CONSULTA_PREANESTESICA.contacto)}.</div>
      <button type="button" class="gp-sobrecupo-btn" onclick="abrirMailtoSobrecupo()">
        ✉️ Solicitar sobrecupo por correo
      </button>
      <div class="gp-sobrecupo-foot">Se abrirá tu correo con el mensaje pre-llenado. Solo completa los datos y envía.</div>
    </div>`;
  const html = _renderGpAcc([
    { ico:'ℹ️',  title:'¿Qué es la Consulta Preanestésica?', html: calloutHtml, open: true },
    { ico:'👤', title:'Agenda de profesionales y horarios', meta:`${agenda.length}`, html: agendaHtml, open: true },
    { ico:'✉️', title:'Solicitar sobrecupo', html: sobrecupoHtml, open: false }
  ]) + '<p class="gp-foot-note">La consulta preanestésica busca evaluar comorbilidades, riesgo perioperatorio, ajustar fármacos, indicar ayuno, y planificar la técnica anestésica con el paciente.</p>';
  cont.innerHTML = html;
}

// Abre el cliente de correo con el mensaje de sobrecupo pre-llenado.
function abrirMailtoSobrecupo(){
  const to = CONSULTA_PREANESTESICA.sobrecupoEmail;
  const cc = CONSULTA_PREANESTESICA.sobrecupoCC || '';
  const hoy = new Date();
  const fechaHoy = `${String(hoy.getDate()).padStart(2,'0')}/${String(hoy.getMonth()+1).padStart(2,'0')}/${hoy.getFullYear()}`;
  const subject = `Solicitud de sobrecupo · Consulta Preanestésica`;
  const lineas = [
    'Estimado/a:',
    '',
    'Te escribo para solicitar un sobrecupo o evaluación preanestésica adicional para el siguiente paciente:',
    '',
    '• Nombre del paciente: ',
    '• Edad: ',
    '• RUT: ',
    '• Diagnóstico / Motivo de cirugía: ',
    '• Cirugía programada: ',
    '• Fecha tentativa de pabellón: ',
    '• Urgencia (electiva / preferente / urgente): ',
    '• Comorbilidades relevantes: ',
    '• Fármacos actuales (con énfasis en anticoagulantes / antiagregantes / GLP-1): ',
    '• Última evaluación cardiológica (si aplica): ',
    '',
    'Médico tratante: ',
    'Especialidad: ',
    'Teléfono / contacto: ',
    `Fecha de solicitud: ${fechaHoy}`,
    '',
    'Agradezco coordinar disponibilidad.',
    '',
    'Saludos cordiales.'
  ];
  const body = lineas.join('\n');
  let url = `mailto:${encodeURIComponent(to)}`;
  const params = [];
  if(cc) params.push(`cc=${encodeURIComponent(cc)}`);
  params.push(`subject=${encodeURIComponent(subject)}`);
  params.push(`body=${encodeURIComponent(body)}`);
  url += '?' + params.join('&');
  try { window.location.href = url; }
  catch(e){ try { window.open(url, '_self'); } catch(e2){} }
}

// ============================================================
// HELPER: Copiar al portapapeles (con fallback)
// ============================================================
function _gpCopyToClipboard(text, btnEl){
  function feedback(ok){
    if(!btnEl) return;
    const orig = btnEl.dataset.origText || btnEl.textContent;
    btnEl.dataset.origText = orig;
    btnEl.textContent = ok ? '✓ Copiado al portapapeles' : '✗ No se pudo copiar';
    btnEl.classList.add(ok ? 'gp-copy-ok' : 'gp-copy-fail');
    setTimeout(()=>{
      btnEl.textContent = orig;
      btnEl.classList.remove('gp-copy-ok','gp-copy-fail');
    }, 1800);
  }
  try {
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(text).then(()=>feedback(true)).catch(()=>feedback(false));
      return;
    }
  } catch(e){}
  // Fallback
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position='fixed'; ta.style.opacity='0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    feedback(ok);
  } catch(e){ feedback(false); }
}

// ============================================================
// CALCULADORA RCRI (Lee · Revised Cardiac Risk Index)
// ============================================================
const RCRI_LABELS = [
  'Cirugía de alto riesgo (intraperitoneal, intratorácica, vascular suprainguinal)',
  'Cardiopatía isquémica (IAM previo, angina, prueba de esfuerzo +, Q patológicas en ECG)',
  'Insuficiencia cardíaca congestiva',
  'ACV o AIT previo',
  'Diabetes mellitus en tratamiento con insulina',
  'Creatinina sérica > 2 mg/dL'
];

function calcRCRI(flags, cf){
  // flags: array de 6 booleanos · cf: '>=4METs' | '<4METs' | 'desconocida'
  const items = RCRI_LABELS.map((l,i)=>({ label:l, checked: !!flags[i] }));
  const score = items.filter(x=>x.checked).length;
  const cfBaja = (cf === '<4METs' || cf === 'desconocida');
  let riesgoPct, categoria, badgeClass;
  if(score===0){ riesgoPct='0,4 %'; categoria='Muy bajo';   badgeClass='ok'; }
  else if(score===1){ riesgoPct='0,9 %'; categoria='Bajo';     badgeClass='ok'; }
  else if(score===2){ riesgoPct='6,6 %'; categoria='Elevado';  badgeClass='warn'; }
  else              { riesgoPct='≥ 11 %'; categoria='Alto';     badgeClass='danger'; }

  const recs = {};
  if(score <= 1){
    recs.conducta    = 'Proceder con la cirugía. Optimización médica estándar y monitorización perioperatoria habitual.';
    recs.biomarc     = 'NT-proBNP / troponinas NO de rutina si no hay otros factores. Reservar para pacientes con síntomas o ≥65 años con enfermedad CV.';
    recs.betaBloqueo = 'Mantener si ya está en tratamiento crónico. NO iniciar si tiempo pre-op < 7 días (riesgo de ACV y mortalidad).';
    recs.estatinas   = 'Mantener si ya está en tratamiento. Considerar iniciar en pacientes con vasculopatía o cardiopatía isquémica conocida.';
    recs.interconsulta = 'No requiere interconsulta cardiológica de rutina.';
  } else if(score === 2){
    recs.conducta    = 'Riesgo elevado. Evaluar capacidad funcional (METs). Si ≥ 4 METs y asintomático → proceder. Si < 4 METs o desconocida → considerar test no invasivo SOLO si el resultado va a modificar la conducta.';
    recs.biomarc     = 'Considerar NT-proBNP pre-op (2B) + troponinas a las 24, 48 y 72 h post-op (vigilancia activa de MINS — Myocardial Injury after Non-cardiac Surgery).';
    recs.betaBloqueo = 'Mantener si ya está en tratamiento. Iniciar solo con titulación lenta y si hay > 7 días disponibles antes de la cirugía.';
    recs.estatinas   = 'Mantener si ya está en tratamiento. Considerar inicio en vasculopatía / cardiopatía isquémica.';
    recs.interconsulta = 'Considerar interconsulta a Cardiología si capacidad funcional < 4 METs, o si cirugía vascular / torácica mayor.';
  } else {
    recs.conducta    = 'Riesgo alto. Diferir cirugía electiva hasta optimización cardiológica. Discutir balance riesgo-beneficio con paciente y equipo quirúrgico.';
    recs.biomarc     = 'NT-proBNP pre-op + troponinas seriadas (basal, 24, 48 y 72 h post-op). Considerar monitorización en intermedio/UCI post-op.';
    recs.betaBloqueo = 'Mantener si ya está en tratamiento. Considerar inicio cardio-selectivo (bisoprolol/metoprolol) con titulación lenta si tiempo disponible > 7 días.';
    recs.estatinas   = 'Iniciar/optimizar estatina perioperatoria si no hay contraindicación.';
    recs.interconsulta = 'Interconsulta a Cardiología obligatoria antes de cirugía electiva. Coordinar manejo post-op en intermedio/UCI según contexto.';
  }

  // Ajuste por capacidad funcional (AHA/ACC 2024 · ESC 2022)
  if(cf === '>=4METs'){
    recs.cf = 'CF ≥ 4 METs sin síntomas → proceder sin estudios de isquemia adicionales (independiente del puntaje, salvo condición cardíaca activa).';
  } else if(cfBaja && score >= 2){
    recs.cf = 'CF < 4 METs (o no evaluable) + RCRI ≥ 2 → derivar a EVALUACIÓN CARDIOLÓGICA preoperatoria. Considerar test de isquemia (eco estrés con dobutamina · test de esfuerzo · perfusión miocárdica) SOLO si el resultado cambiará la conducta (revascularización, cambio de técnica o suspensión).';
    recs.interconsulta = 'Interconsulta a Cardiología recomendada: CF < 4 METs con RCRI ≥ 2. ' + recs.interconsulta;
  } else if(cfBaja && score === 1){
    recs.cf = 'CF < 4 METs con 1 factor RCRI → primera línea: ECG + NT-proBNP. Test de isquemia solo si síntomas, biomarcadores alterados o cirugía de alto riesgo (ESC 2022). Considerar cuestionario DASI para objetivar la CF (AHA/ACC 2024).';
  } else if(cfBaja){
    recs.cf = 'CF < 4 METs sin factores RCRI → no requiere estudios de isquemia de rutina. Considerar DASI / NT-proBNP según edad y tipo de cirugía.';
  }
  return { score, items, riesgoPct, categoria, badgeClass, recs, cf };
}

function _gpRcriResumenTexto(r){
  const checkedList = r.items.filter(x=>x.checked).map((x,i)=>'  • '+x.label).join('\n');
  return [
    'RCRI (Revised Cardiac Risk Index — Lee 1999)',
    `Puntaje: ${r.score} / 6 · Riesgo: ${r.riesgoPct} (${r.categoria})`,
    '',
    'Factores presentes:',
    (checkedList || '  (ninguno)'),
    '',
    (r.recs.cf ? `Capacidad funcional: ${r.recs.cf}` : null),
    `Conducta: ${r.recs.conducta}`,
    `Biomarcadores: ${r.recs.biomarc}`,
    `Beta-bloqueo: ${r.recs.betaBloqueo}`,
    `Estatinas: ${r.recs.estatinas}`,
    `Interconsulta: ${r.recs.interconsulta}`,
    '',
    'Generado por Appnesthesia · Portal Preanestésico'
  ].filter(x=>x!==null).join('\n');
}

window.calcularRCRI = function(){
  const flags = RCRI_LABELS.map((_,i)=>{
    const el = document.getElementById('rcriChk'+i);
    return el ? !!el.checked : false;
  });
  const cfEl = document.getElementById('rcriCf');
  const r = calcRCRI(flags, cfEl ? cfEl.value : 'desconocida');
  const out = document.getElementById('rcriResultado');
  if(!out) return;
  const flagsList = r.items.filter(x=>x.checked).map(x=>`<li>${_gpEsc(x.label)}</li>`).join('') || '<li><em>Ningún factor seleccionado</em></li>';
  out.innerHTML = `
    <div class="gp-calc-result gp-calc-${r.badgeClass}">
      <div class="gp-calc-score-row">
        <div class="gp-calc-score-big">${r.score}<span>/6</span></div>
        <div class="gp-calc-score-meta">
          <div class="gp-calc-pct">${_gpEsc(r.riesgoPct)}</div>
          <div class="gp-calc-cat">Riesgo ${_gpEsc(r.categoria)}</div>
        </div>
      </div>
      <div class="gp-calc-flags">
        <strong>Factores presentes:</strong>
        <ul>${flagsList}</ul>
      </div>
      <div class="gp-calc-recs">
        ${r.recs.cf ? `<div class="gp-calc-rec gp-calc-rec-cf"><strong>Capacidad funcional:</strong> ${_gpEsc(r.recs.cf)}</div>` : ''}
        <div class="gp-calc-rec"><strong>Conducta:</strong> ${_gpEsc(r.recs.conducta)}</div>
        <div class="gp-calc-rec"><strong>Biomarcadores:</strong> ${_gpEsc(r.recs.biomarc)}</div>
        <div class="gp-calc-rec"><strong>Beta-bloqueo:</strong> ${_gpEsc(r.recs.betaBloqueo)}</div>
        <div class="gp-calc-rec"><strong>Estatinas:</strong> ${_gpEsc(r.recs.estatinas)}</div>
        <div class="gp-calc-rec"><strong>Interconsulta:</strong> ${_gpEsc(r.recs.interconsulta)}</div>
      </div>
      <button type="button" class="gp-copy-btn" onclick="_gpCopyToClipboard(window._lastRcriText, this)">📋 Copiar resumen al portapapeles</button>
    </div>
  `;
  window._lastRcriText = _gpRcriResumenTexto(r);
};

window.resetRCRI = function(){
  for(let i=0;i<RCRI_LABELS.length;i++){
    const el = document.getElementById('rcriChk'+i);
    if(el) el.checked = false;
  }
  const cfEl = document.getElementById('rcriCf');
  if(cfEl) cfEl.selectedIndex = 0;
  const out = document.getElementById('rcriResultado');
  if(out) out.innerHTML = '';
};

// ============================================================
// RIESGO DE TEV — SCORE DE CAPRINI (2005) + PROFILAXIS (ACCP)
// ============================================================
// Referencia: Caprini 2005 RAM · estratificación y conducta ACCP
// (Gould, Chest 2012). REFERENCIA — la decisión es del anestesiólogo.
const CAPRINI_FACTORS = [
  // pts 1
  { p:1, g:'1 punto', label:'Edad 41-60 años' },
  { p:1, g:'1 punto', label:'Cirugía menor programada' },
  { p:1, g:'1 punto', label:'IMC > 25 kg/m²' },
  { p:1, g:'1 punto', label:'Piernas edematosas (actual)' },
  { p:1, g:'1 punto', label:'Várices' },
  { p:1, g:'1 punto', label:'Sepsis (< 1 mes)' },
  { p:1, g:'1 punto', label:'Enfermedad pulmonar grave / neumonía (< 1 mes)' },
  { p:1, g:'1 punto', label:'Función pulmonar anormal / EPOC' },
  { p:1, g:'1 punto', label:'IAM agudo' },
  { p:1, g:'1 punto', label:'Insuficiencia cardíaca congestiva (< 1 mes)' },
  { p:1, g:'1 punto', label:'Enfermedad inflamatoria intestinal' },
  { p:1, g:'1 punto', label:'Paciente médico en reposo en cama' },
  { p:1, g:'1 punto', label:'Anticonceptivos orales o terapia hormonal' },
  { p:1, g:'1 punto', label:'Embarazo o postparto (< 1 mes)' },
  { p:1, g:'1 punto', label:'Aborto recurrente o inexplicado' },
  // pts 2
  { p:2, g:'2 puntos', label:'Edad 61-74 años' },
  { p:2, g:'2 puntos', label:'Cirugía artroscópica' },
  { p:2, g:'2 puntos', label:'Cirugía mayor abierta (> 45 min)' },
  { p:2, g:'2 puntos', label:'Cirugía laparoscópica (> 45 min)' },
  { p:2, g:'2 puntos', label:'Neoplasia maligna (presente o previa)' },
  { p:2, g:'2 puntos', label:'Reposo en cama > 72 h' },
  { p:2, g:'2 puntos', label:'Yeso inmovilizador (< 1 mes)' },
  { p:2, g:'2 puntos', label:'Acceso venoso central' },
  // pts 3
  { p:3, g:'3 puntos', label:'Edad ≥ 75 años' },
  { p:3, g:'3 puntos', label:'TEV previo (TVP/TEP)' },
  { p:3, g:'3 puntos', label:'Historia familiar de TEV' },
  { p:3, g:'3 puntos', label:'Factor V Leiden' },
  { p:3, g:'3 puntos', label:'Mutación protrombina 20210A' },
  { p:3, g:'3 puntos', label:'Anticoagulante lúpico' },
  { p:3, g:'3 puntos', label:'Anticuerpos anticardiolipina' },
  { p:3, g:'3 puntos', label:'Homocisteína sérica elevada' },
  { p:3, g:'3 puntos', label:'Trombocitopenia inducida por heparina (TIH)' },
  { p:3, g:'3 puntos', label:'Otra trombofilia congénita o adquirida' },
  // pts 5
  { p:5, g:'5 puntos', label:'ACV (< 1 mes)' },
  { p:5, g:'5 puntos', label:'Artroplastía electiva mayor de extremidad inferior' },
  { p:5, g:'5 puntos', label:'Fractura de cadera, pelvis o pierna (< 1 mes)' },
  { p:5, g:'5 puntos', label:'Lesión medular aguda con paresia (< 1 mes)' },
  { p:5, g:'5 puntos', label:'Politraumatismo (< 1 mes)' },
];

function calcCaprini(flags){
  const items = CAPRINI_FACTORS.map((f,i)=>({ ...f, checked: !!flags[i] }));
  const score = items.filter(x=>x.checked).reduce((a,x)=>a+x.p, 0);
  let riesgoPct, categoria, badgeClass, prof;
  if(score === 0){
    riesgoPct='< 0,5 %'; categoria='Muy bajo'; badgeClass='ok';
    prof='Deambulación precoz y frecuente. No requiere profilaxis farmacológica ni mecánica específica.';
  } else if(score <= 2){
    riesgoPct='~ 1,5 %'; categoria='Bajo'; badgeClass='ok';
    prof='Profilaxis MECÁNICA: compresión neumática intermitente (CNI) preferida ± medias de compresión graduada, mientras dure la hospitalización / inmovilidad.';
  } else if(score <= 4){
    riesgoPct='~ 3 %'; categoria='Moderado'; badgeClass='warn';
    prof='Profilaxis FARMACOLÓGICA (HBPM o HNF a dosis baja) o, si hay alto riesgo de sangrado, profilaxis MECÁNICA (CNI) hasta que sea seguro iniciar la farmacológica.';
  } else {
    riesgoPct='~ 6 % o más'; categoria='Alto'; badgeClass='danger';
    prof='Profilaxis FARMACOLÓGICA (HBPM o HNF) + MECÁNICA (CNI) combinadas. En cáncer abdominopélvico mayor y artroplastía/fractura de cadera considerar profilaxis EXTENDIDA (~4 semanas).';
  }
  const recs = {
    profilaxis: prof,
    sangrado: 'Si el riesgo hemorrágico es alto, priorizar profilaxis mecánica (CNI) y diferir la farmacológica hasta lograr hemostasia adecuada.',
    neuroaxial: 'Coordinar el timing de HBPM/HNF con bloqueos neuroaxiales y retiro de catéteres según ASRA (ver sección Coagulación de la app).',
    duracion: (score>=5 ? 'Considerar profilaxis extendida (hasta ~4 semanas) en cirugía oncológica abdominopélvica mayor y artroplastía/fractura de cadera.' : 'Mantener profilaxis mientras persista el riesgo (hospitalización / inmovilidad).')
  };
  return { score, items, riesgoPct, categoria, badgeClass, recs };
}

function _renderCapriniCalcCard(){
  let html = `
    <p class="gp-calc-sub" style="margin-top:0">Marca los factores de riesgo presentes. El Caprini RAM (2005) estima el riesgo de tromboembolismo venoso y orienta la profilaxis (estratos ACCP).</p>
    <form id="capriniForm" class="gp-calc-form" onsubmit="event.preventDefault();window.calcularCaprini();return false;">`;
  let lastG = null;
  html += '<div class="gp-calc-chips gp-rcri-chips">';
  CAPRINI_FACTORS.forEach((f, i) => {
    if(f.g !== lastG){
      html += `</div><div class="gp-calc-section-title">${_gpEsc(f.g + (f.p===1?' cada uno':' cada uno'))}</div><div class="gp-calc-chips gp-rcri-chips">`;
      lastG = f.g;
    }
    html += `<label class="gp-chk gp-chk-rcri"><input type="checkbox" id="capChk${i}"><span>${_gpEsc(f.label)}</span></label>`;
  });
  html += `</div>
      <div class="gp-calc-actions">
        <button type="submit" class="gp-calc-btn primary">🧮 Calcular puntaje y profilaxis</button>
        <button type="button" class="gp-calc-btn secondary" onclick="window.resetCaprini()">↺ Limpiar</button>
      </div>
    </form>
    <div id="capriniResultado"></div>`;
  return html;
}

function _gpCapriniResumenTexto(r){
  const checkedList = r.items.filter(x=>x.checked).map(x=>'  • '+x.label+' ('+x.p+')').join('\n');
  return [
    'Score de Caprini (2005) — Riesgo de TVP/TEP',
    `Puntaje: ${r.score} · Riesgo: ${r.riesgoPct} (${r.categoria})`,
    '',
    'Factores presentes:',
    (checkedList || '  (ninguno)'),
    '',
    `Profilaxis sugerida: ${r.recs.profilaxis}`,
    `Riesgo de sangrado: ${r.recs.sangrado}`,
    `Neuroaxial/ASRA: ${r.recs.neuroaxial}`,
    `Duración: ${r.recs.duracion}`,
    '',
    'REFERENCIA (ACCP). La decisión final es del anestesiólogo a cargo.',
    'Generado por Appnesthesia · Portal Preanestésico'
  ].join('\n');
}

window.calcularCaprini = function(){
  const flags = CAPRINI_FACTORS.map((_,i)=>{
    const el = document.getElementById('capChk'+i);
    return el ? !!el.checked : false;
  });
  const r = calcCaprini(flags);
  const out = document.getElementById('capriniResultado');
  if(!out) return;
  const flagsList = r.items.filter(x=>x.checked).map(x=>`<li>${_gpEsc(x.label)} <em>(${x.p})</em></li>`).join('') || '<li><em>Ningún factor seleccionado</em></li>';
  out.innerHTML = `
    <div class="gp-calc-result gp-calc-${r.badgeClass}">
      <div class="gp-calc-score-row">
        <div class="gp-calc-score-big">${r.score}<span> pts</span></div>
        <div class="gp-calc-score-meta">
          <div class="gp-calc-pct">${_gpEsc(r.riesgoPct)}</div>
          <div class="gp-calc-cat">Riesgo ${_gpEsc(r.categoria)}</div>
        </div>
      </div>
      <div class="gp-calc-flags">
        <strong>Factores presentes:</strong>
        <ul>${flagsList}</ul>
      </div>
      <div class="gp-calc-recs">
        <div class="gp-calc-rec"><strong>Profilaxis sugerida:</strong> ${_gpEsc(r.recs.profilaxis)}</div>
        <div class="gp-calc-rec"><strong>Riesgo de sangrado:</strong> ${_gpEsc(r.recs.sangrado)}</div>
        <div class="gp-calc-rec"><strong>Neuroaxial / ASRA:</strong> ${_gpEsc(r.recs.neuroaxial)}</div>
        <div class="gp-calc-rec"><strong>Duración:</strong> ${_gpEsc(r.recs.duracion)}</div>
      </div>
      <button type="button" class="gp-copy-btn" onclick="_gpCopyToClipboard(window._lastCapriniText, this)">📋 Copiar resumen al portapapeles</button>
    </div>`;
  window._lastCapriniText = _gpCapriniResumenTexto(r);
};

window.resetCaprini = function(){
  for(let i=0;i<CAPRINI_FACTORS.length;i++){
    const el = document.getElementById('capChk'+i);
    if(el) el.checked = false;
  }
  const out = document.getElementById('capriniResultado');
  if(out) out.innerHTML = '';
};

function renderGuiasRiesgoTev(){
  const cont = document.getElementById('gpRiesgoTevBody');
  if(!cont) return;
  const intro = `
    <div class="gp-callout" style="margin-bottom:14px">
      <strong>🩸 Objetivo:</strong> estimar el riesgo de <strong>trombosis venosa profunda (TVP) y tromboembolismo pulmonar (TEP)</strong> —en conjunto, tromboembolismo venoso (TEV)— en el paciente quirúrgico con el <em>Score de Caprini (2005)</em> y orientar la <strong>tromboprofilaxis</strong> según los estratos <em>ACCP</em>.
    </div>
    <div class="gp-callout info" style="margin-bottom:14px">
      <strong>🧮 Calculadora Caprini disponible.</strong> Usa el botón <strong>«Abrir calculadora Caprini»</strong> (abajo a la derecha) para sumar los factores y ver la profilaxis sugerida.
    </div>`;
  let tabla = '<table class="gp-table"><thead><tr><th>Puntaje</th><th>Riesgo</th><th>Profilaxis sugerida</th></tr></thead><tbody>';
  tabla += '<tr><td><strong>0</strong></td><td>Muy bajo (&lt; 0,5 %)</td><td>Deambulación precoz</td></tr>';
  tabla += '<tr><td><strong>1-2</strong></td><td>Bajo (~ 1,5 %)</td><td>Mecánica (compresión neumática intermitente)</td></tr>';
  tabla += '<tr><td><strong>3-4</strong></td><td>Moderado (~ 3 %)</td><td>Farmacológica (HBPM/HNF) o mecánica si alto riesgo de sangrado</td></tr>';
  tabla += '<tr><td><strong>≥ 5</strong></td><td>Alto (~ 6 % o más)</td><td>Farmacológica + mecánica; considerar profilaxis extendida</td></tr>';
  tabla += '</tbody></table>';
  const notas = `
    <div class="gp-callout warning" style="margin-top:12px">
      <strong>⚠ Coordinar con ASRA:</strong> ajustar el <strong>timing de HBPM/HNF</strong> con los bloqueos neuroaxiales y el retiro de catéteres (ver sección <strong>Coagulación</strong>). Si el riesgo de sangrado es alto, priorizar la profilaxis mecánica hasta lograr hemostasia.
    </div>
    <div class="gp-callout" style="margin-top:10px;font-size:12px;color:var(--muted)">
      Fuente: Caprini 2005 RAM · estratificación y conducta ACCP (Gould, Chest 2012). Referencia de apoyo — la decisión final es del anestesiólogo a cargo.
    </div>`;
  cont.innerHTML = intro + tabla + notas;
}

// ============================================================
// CALCULADORA DE EXÁMENES PREOPERATORIOS
// ============================================================
// Devuelve: { pedir:[], evitar:[], diferir:[], interconsultas:[], notas:[] }
function calcExamenesPreop(input){
  const out = { pedir:[], evitar:[], diferir:[], interconsultas:[], notas:[] };
  const {
    edad = 0,
    edadFertil = false,
    asa = 1,
    riesgoQx = 'bajo',     // 'bajo'|'intermedio'|'alto'
    cf = 'desconocida',     // '>=4METs'|'<4METs'|'desconocida'
    comorbs = [],           // ['DM','HTA','IRC','ICC','CardioIsq','EPOC','Hepatopatia','TACO','MCP_DAI','ACV_previo']
    ecgReciente = false,    // ECG <12 m sin cambios
    ecoReciente = false,    // Eco <12 m sin cambios
    examenesRecientes = false, // labs <6 m, estable
    eventosRecientes = []   // ver mapa abajo
  } = input;

  const has = c => comorbs.includes(c);
  const matriz = EXAM_PREOP_MATRIX[riesgoQx];
  if(!matriz){ out.notas.push('Riesgo quirúrgico no reconocido.'); return out; }

  function cellFor(testKeyword){
    const r = matriz.rows.find(x => x.test.toLowerCase().includes(testKeyword));
    if(!r) return '';
    if(asa <= 1) return r.asa1;
    if(asa === 2) return r.asa2;
    return r.asa34;
  }
  function classify(testLabel, cell){
    if(!cell) return;
    const c = String(cell).trim();
    const cLower = c.toLowerCase();
    // "Sí" o "Si" exacto, o que empiece con "indicado"
    if(cLower === 'sí' || cLower === 'si' || /^indicado/i.test(c)){
      out.pedir.push(testLabel);
    } else if(/considerar/i.test(c)){
      out.pedir.push(testLabel + ' (considerar · ' + c.replace(/^Considerar\s*/i,'').trim().toLowerCase() + ')');
    } else {
      out.evitar.push(testLabel + ' (no de rutina en este escenario)');
    }
  }

  classify('Hemograma',          cellFor('hemograma'));
  classify('Pruebas de coagulación', cellFor('coagulación'));
  classify('Función renal (BUN/Crea/ELP)', cellFor('renal'));

  // ECG: si ya hay reciente, omitir
  const ecgCell = cellFor('electrocard');
  if(ecgReciente){
    out.notas.push('ECG previo < 12 meses sin cambios clínicos → no repetir.');
  } else {
    classify('Electrocardiograma', ecgCell);
  }

  // PFP/GSA por matriz
  classify('PFP / Gases arteriales', cellFor('pfp'));

  // === Específicos según comorbilidad ===
  if(has('DM')){
    out.pedir.push('HbA1c (si no hay examen < 3 meses) · HGT día de la cirugía');
    out.notas.push('Mantener glicemia perioperatoria < 180 mg/dL.');
  }
  if(has('Hepatopatia')){
    out.pedir.push('Perfil hepático · INR · albúmina · plaquetas · clasificación Child-Pugh');
  }
  if(has('TACO')){
    out.pedir.push('INR día previo (TACO) · función renal (NOAC) · revisar tabla de suspensión');
    out.notas.push('TTPa/TP/INR normales NO descartan efecto residual de NOACs.');
  }
  if(has('IRC')){
    out.pedir.push('BUN · Creatinina · ELP · VFG estimada (si aún no incluido)');
  }
  if((has('ICC') || has('CardioIsq')) && !ecoReciente){
    out.pedir.push('Ecocardiograma (1B si IC sintomática o no estudiada)');
  } else if(ecoReciente){
    out.notas.push('Ecocardiograma < 12 meses sin cambios clínicos → no repetir.');
  }
  if(has('EPOC')){
    out.pedir.push('GSA · espirometría reciente si insuficiencia respiratoria sintomática');
  }
  if(has('MCP_DAI')){
    out.interconsultas.push('Coordinar con Cardiología/Electrofisiología (planificación MCP/DAI ante interferencia electromagnética)');
  }

  // Embarazo
  if(edadFertil){
    out.pedir.push('β-HCG si duda razonable (anamnesis dirigida + consentimiento; documentar)');
  }

  // === Evaluación cardiovascular ===
  // (AHA/ACC 2024 Perioperative Guideline · ESC 2022 Non-cardiac Surgery)
  const cfBaja = (cf === '<4METs' || cf === 'desconocida');
  const antecedentesCV = has('CardioIsq') || has('ICC') || has('ACV_previo');
  const factoresCV = ['CardioIsq','ICC','ACV_previo','DM','IRC'].filter(has).length;
  const riesgoQxElevado = (riesgoQx === 'intermedio' || riesgoQx === 'alto');

  // NT-proBNP / BNP: SOLO en cirugía de riesgo intermedio/alto, en ≥65 a o
  // ≥45 a con enfermedad CV (ESC 2022, IIa). NO en cirugía de bajo riesgo
  // ni en sano sin factores → así se evita la sobreindicación.
  if(riesgoQxElevado && (edad >= 65 || (edad >= 45 && antecedentesCV))){
    out.pedir.push('NT-proBNP/BNP preoperatorio para estratificación (ESC 2022 · ≥65 a, o ≥45 a con enfermedad CV, en cirugía de riesgo ' + (riesgoQx==='alto'?'alto':'intermedio') + ')');
    out.notas.push('Si NT-proBNP/BNP está elevado → medir troponinas en el postoperatorio (días 1–2) para detectar daño miocárdico (MINS).');
  }

  // CF dudosa/desconocida + factores de riesgo en cirugía elevada → evaluación
  // cardiológica + test de isquemia (esfuerzo si puede ejercitarse; eco
  // dobutamina o perfusión miocárdica si no puede), siempre que cambie conducta.
  if(cfBaja && riesgoQxElevado){
    if(antecedentesCV || factoresCV >= 1 || asa >= 3){
      out.interconsultas.push('Evaluación cardiológica preoperatoria (CF < 4 METs o desconocida + factores de riesgo CV, en cirugía de riesgo ' + (riesgoQx==='alto'?'alto':'intermedio') + ')');
      out.pedir.push('Test de isquemia inducible: test de esfuerzo si el paciente puede ejercitarse; eco estrés con dobutamina o perfusión miocárdica si no puede (solo si el resultado cambiará la conducta)');
      out.notas.push('AHA/ACC 2024 y ESC 2022: con CF < 4 METs y riesgo elevado, el estudio de isquemia se justifica solo si modificará el manejo (revascularización, optimización médica, cambio de técnica anestésico-quirúrgica o suspensión).');
    } else {
      out.notas.push('CF < 4 METs/desconocida sin factores de riesgo CV: primero objetivar la CF (cuestionario DASI) y considerar ECG; el test de isquemia no está indicado de rutina (ESC 2022).');
    }
  }
  if(cf === 'desconocida'){
    out.notas.push('Capacidad funcional desconocida: objetivar con cuestionario DASI (>34 puntos ≈ CF adecuada) antes de solicitar estudios (AHA/ACC 2024).');
  }
  if(cf === '>=4METs'){
    out.notas.push('CF ≥ 4 METs sin síntomas → no se requieren estudios de isquemia adicionales, independiente del riesgo quirúrgico (salvo condición cardíaca activa).');
  }

  // Angio-TAC coronario: alto riesgo + CF baja (2B)
  if(riesgoQx === 'alto' && cfBaja){
    out.pedir.push('Considerar Angio-TAC coronario (2B)');
  }

  // Eventos CV recientes → diferir
  const eventMap = {
    'ACV_3m':       'ACV o AIT < 3 meses → diferir cirugía electiva (mín. 3 meses · 2B)',
    'STENT_SCA':    'Stent en SCA < 12 meses → diferir idealmente 12 meses',
    'STENT_CCE_6m': 'Stent (cardiopatía coronaria estable) < 6 meses → diferir',
    'STENT_TS_3m':  'Stent + cirugía tiempo-sensible < 3 meses → diferir (evitar < 30 días)',
    'ANGIO_SS_14d': 'Angioplastia sin stent < 14 días → diferir'
  };
  for(const e of eventosRecientes){
    if(eventMap[e]) out.diferir.push(eventMap[e]);
  }

  // Validez de exámenes recientes
  if(examenesRecientes){
    out.notas.push('Exámenes previos < 6 meses con condición clínica estable → válidos, no repetir.');
  }

  // De-duplicar
  function uniq(arr){ const s=new Set(); const r=[]; for(const x of arr){ if(!s.has(x)){ s.add(x); r.push(x); } } return r; }
  out.pedir = uniq(out.pedir);
  out.evitar = uniq(out.evitar);
  out.diferir = uniq(out.diferir);
  out.interconsultas = uniq(out.interconsultas);
  out.notas = uniq(out.notas);
  return out;
}

function _gpExamResumenTexto(input, res){
  const lines = [
    'Exámenes preoperatorios sugeridos · Appnesthesia',
    `Edad: ${input.edad || '—'} · ASA: ${input.asa} · Cirugía: ${input.riesgoQx} riesgo · CF: ${input.cf}`,
    (input.comorbs && input.comorbs.length) ? `Comorbilidades: ${input.comorbs.join(', ')}` : null,
    ''
  ].filter(Boolean);
  if(res.pedir.length){ lines.push('Solicitar:'); res.pedir.forEach(x=>lines.push('  • '+x)); lines.push(''); }
  if(res.diferir.length){ lines.push('Diferir cirugía:'); res.diferir.forEach(x=>lines.push('  ⛔ '+x)); lines.push(''); }
  if(res.interconsultas.length){ lines.push('Interconsultas:'); res.interconsultas.forEach(x=>lines.push('  → '+x)); lines.push(''); }
  if(res.evitar.length){ lines.push('Evitar / no de rutina:'); res.evitar.forEach(x=>lines.push('  – '+x)); lines.push(''); }
  if(res.notas.length){ lines.push('Notas:'); res.notas.forEach(x=>lines.push('  • '+x)); }
  return lines.join('\n').trim();
}

window.calcularExamenes = function(){
  function val(id){ const el=document.getElementById(id); return el ? el.value : ''; }
  function chk(id){ const el=document.getElementById(id); return el ? !!el.checked : false; }
  const comorbsList = ['DM','HTA','IRC','ICC','CardioIsq','EPOC','Hepatopatia','TACO','MCP_DAI','ACV_previo'];
  const comorbs = comorbsList.filter(c => chk('exComorb_'+c));
  const eventosList = ['ACV_3m','STENT_SCA','STENT_CCE_6m','STENT_TS_3m','ANGIO_SS_14d'];
  const eventosRecientes = eventosList.filter(e => chk('exEvt_'+e));

  const input = {
    edad: parseInt(val('exEdad'),10) || 0,
    edadFertil: chk('exEdadFertil'),
    asa: parseInt(val('exAsa'),10) || 1,
    riesgoQx: val('exRiesgoQx') || 'bajo',
    cf: val('exCf') || 'desconocida',
    comorbs,
    ecgReciente: chk('exEcgReciente'),
    ecoReciente: chk('exEcoReciente'),
    examenesRecientes: chk('exLabsRecientes'),
    eventosRecientes
  };
  const res = calcExamenesPreop(input);
  const out = document.getElementById('examResultado');
  if(!out) return;

  function renderList(title, arr, cls){
    if(!arr.length) return '';
    return `<div class="gp-calc-block ${cls}"><strong>${_gpEsc(title)}</strong><ul>${arr.map(x=>`<li>${_gpEsc(x)}</li>`).join('')}</ul></div>`;
  }

  const totalReco = res.pedir.length + res.diferir.length + res.interconsultas.length;
  const sumario = totalReco === 0
    ? '<div class="gp-calc-block ok"><strong>✓ Sin exámenes adicionales sugeridos.</strong> El escenario clínico no requiere estudios de rutina más allá de la evaluación clínica.</div>'
    : `<div class="gp-calc-sum">📋 <strong>${res.pedir.length}</strong> examen(es) sugerido(s) · <strong>${res.diferir.length}</strong> alerta(s) de diferir · <strong>${res.interconsultas.length}</strong> interconsulta(s)</div>`;

  out.innerHTML = `
    <div class="gp-calc-result">
      ${sumario}
      ${renderList('🔴 Diferir cirugía', res.diferir, 'danger')}
      ${renderList('📋 Solicitar', res.pedir, 'pedir')}
      ${renderList('→ Interconsultas', res.interconsultas, 'info')}
      ${renderList('⚪ Evitar / no de rutina', res.evitar, 'evitar')}
      ${renderList('💡 Notas clínicas', res.notas, 'nota')}
      <button type="button" class="gp-copy-btn" onclick="_gpCopyToClipboard(window._lastExamText, this)">📋 Copiar resumen al portapapeles</button>
    </div>
  `;
  window._lastExamText = _gpExamResumenTexto(input, res);
};

window.resetExamenes = function(){
  ['exEdad'].forEach(id=>{ const el=document.getElementById(id); if(el) el.value=''; });
  ['exAsa','exRiesgoQx','exCf'].forEach(id=>{ const el=document.getElementById(id); if(el) el.selectedIndex=0; });
  document.querySelectorAll('#examCalcForm input[type=checkbox]').forEach(el=>el.checked=false);
  const out = document.getElementById('examResultado');
  if(out) out.innerHTML = '';
};

// ============================================================
// SECCIÓN: Exámenes Preoperatorios
// ============================================================
// Calc card de exámenes (se renderiza en el modal cuando el usuario presiona el FAB).
function _renderExamCalcCard(){
  return `
    <p class="gp-calc-sub" style="margin-top:0">Ingresa datos del paciente y procedimiento → te decimos qué exámenes pedir, qué evitar y cuándo derivar/diferir.</p>
    <form id="examCalcForm" class="gp-calc-form" onsubmit="event.preventDefault();window.calcularExamenes();return false;">
      <div class="gp-calc-grid">
        <label class="gp-calc-field">
          <span>Edad (años)</span>
          <input type="number" id="exEdad" min="0" max="120" placeholder="Ej: 67" inputmode="numeric">
        </label>
        <label class="gp-calc-field">
          <span>ASA</span>
          <select id="exAsa">
            <option value="1">ASA I — sano</option>
            <option value="2">ASA II — enf. sistémica leve</option>
            <option value="3">ASA III — enf. sistémica severa</option>
            <option value="4">ASA IV — amenaza vital</option>
          </select>
        </label>
        <label class="gp-calc-field">
          <span>Riesgo quirúrgico</span>
          <select id="exRiesgoQx">
            <option value="bajo">Bajo (&lt;1%)</option>
            <option value="intermedio">Intermedio (1–5%)</option>
            <option value="alto">Alto (&gt;5%)</option>
          </select>
        </label>
        <label class="gp-calc-field">
          <span>Capacidad funcional</span>
          <select id="exCf">
            <option value="desconocida">Desconocida</option>
            <option value=">=4METs">≥ 4 METs (sube 1 piso sin síntomas)</option>
            <option value="<4METs">&lt; 4 METs (limitado)</option>
          </select>
        </label>
      </div>

      <div class="gp-calc-section-title">Comorbilidades</div>
      <div class="gp-calc-chips">
        <label class="gp-chk"><input type="checkbox" id="exComorb_DM"><span>Diabetes mellitus</span></label>
        <label class="gp-chk"><input type="checkbox" id="exComorb_HTA"><span>HTA</span></label>
        <label class="gp-chk"><input type="checkbox" id="exComorb_IRC"><span>ERC / Riesgo AKI</span></label>
        <label class="gp-chk"><input type="checkbox" id="exComorb_ICC"><span>ICC</span></label>
        <label class="gp-chk"><input type="checkbox" id="exComorb_CardioIsq"><span>Cardiopatía isquémica</span></label>
        <label class="gp-chk"><input type="checkbox" id="exComorb_EPOC"><span>EPOC / Asma severo</span></label>
        <label class="gp-chk"><input type="checkbox" id="exComorb_Hepatopatia"><span>Hepatopatía / DHC</span></label>
        <label class="gp-chk"><input type="checkbox" id="exComorb_TACO"><span>TACO / NOAC</span></label>
        <label class="gp-chk"><input type="checkbox" id="exComorb_MCP_DAI"><span>MCP / DAI</span></label>
        <label class="gp-chk"><input type="checkbox" id="exComorb_ACV_previo"><span>ACV / AIT previo</span></label>
        <label class="gp-chk"><input type="checkbox" id="exEdadFertil"><span>Mujer en edad fértil</span></label>
      </div>

      <div class="gp-calc-section-title">Exámenes previos (válidos)</div>
      <div class="gp-calc-chips">
        <label class="gp-chk"><input type="checkbox" id="exEcgReciente"><span>ECG &lt; 12 meses sin cambios</span></label>
        <label class="gp-chk"><input type="checkbox" id="exEcoReciente"><span>Ecocardio &lt; 12 meses sin cambios</span></label>
        <label class="gp-chk"><input type="checkbox" id="exLabsRecientes"><span>Labs &lt; 6 meses, estable</span></label>
      </div>

      <div class="gp-calc-section-title">Eventos cardiovasculares recientes</div>
      <div class="gp-calc-chips">
        <label class="gp-chk"><input type="checkbox" id="exEvt_ACV_3m"><span>ACV/AIT &lt; 3 meses</span></label>
        <label class="gp-chk"><input type="checkbox" id="exEvt_STENT_SCA"><span>Stent en SCA &lt; 12 m</span></label>
        <label class="gp-chk"><input type="checkbox" id="exEvt_STENT_CCE_6m"><span>Stent (cor. estable) &lt; 6 m</span></label>
        <label class="gp-chk"><input type="checkbox" id="exEvt_STENT_TS_3m"><span>Stent + cirugía tiempo-sensible &lt; 3 m</span></label>
        <label class="gp-chk"><input type="checkbox" id="exEvt_ANGIO_SS_14d"><span>Angioplastia s/stent &lt; 14 d</span></label>
      </div>

      <div class="gp-calc-actions">
        <button type="submit" class="gp-calc-btn primary">🧮 Calcular exámenes</button>
        <button type="button" class="gp-calc-btn secondary" onclick="window.resetExamenes()">↺ Limpiar</button>
      </div>
    </form>
    <div id="examResultado"></div>`;
}

function renderGuiasExamenes(){
  const cont = document.getElementById('gpExamBody');
  if(!cont) return;

  // Intro siempre visible
  const intro = `
    <div class="gp-callout" style="margin-bottom:8px">
      <strong>🧪 Criterio general:</strong> los exámenes preoperatorios deben pedirse <em>dirigidos</em> según ASA y magnitud del procedimiento. Los exámenes indiscriminados tienen alta prevalencia de falsos positivos y pueden llevar a mala toma de decisiones, suspensiones innecesarias y aumento de costos.
    </div>
    <div class="gp-callout info" style="margin-bottom:12px">
      <strong>🧮 Calculadora disponible.</strong> Usa el botón <strong>«Abrir calculadora»</strong> (abajo a la derecha) para obtener una recomendación personalizada según edad, ASA, comorbilidades y riesgo quirúrgico.
    </div>`;

  // Tablas por riesgo × ASA (3 subtablas en un único accordion)
  let tablasRiesgo = '';
  for(const key of ['bajo','intermedio','alto']){
    const m = EXAM_PREOP_MATRIX[key];
    tablasRiesgo += `<div class="gp-subgroup"><div class="gp-subgroup-title">${_gpEsc(m.titulo)}</div><div class="gp-subgroup-desc">${_gpEsc(m.desc)}</div>`;
    tablasRiesgo += '<div class="gp-table-scroll"><table class="gp-table"><thead><tr><th>Examen</th><th>ASA I</th><th>ASA II</th><th>ASA III y IV</th></tr></thead><tbody>';
    for(const r of m.rows){
      tablasRiesgo += `<tr><td><strong>${_gpEsc(r.test)}</strong></td><td>${_gpEsc(r.asa1)}</td><td>${_gpEsc(r.asa2)}</td><td>${_gpEsc(r.asa34)}</td></tr>`;
    }
    tablasRiesgo += '</tbody></table></div></div>';
  }

  // Específicos por comorbilidad
  let especificos = '<div class="gp-table-scroll"><table class="gp-table"><thead><tr><th>Condición</th><th>Exámenes</th><th>Nota</th></tr></thead><tbody>';
  for(const r of EXAM_PREOP_ESPECIFICOS){
    especificos += `<tr><td><strong>${_gpEsc(r.cond)}</strong></td><td>${_gpEsc(r.pedir)}</td><td><em>${_gpEsc(r.nota||'')}</em></td></tr>`;
  }
  especificos += '</tbody></table></div>';

  // Diferir cirugía
  let diferir = '<div class="gp-table-scroll"><table class="gp-table"><thead><tr><th>Evento / antecedente</th><th>Tiempo recomendado</th></tr></thead><tbody>';
  for(const r of EXAM_PREOP_DIFERIR){
    diferir += `<tr><td><strong>${_gpEsc(r.evento)}</strong></td><td>${_gpEsc(r.tiempo)}</td></tr>`;
  }
  diferir += '</tbody></table></div>';

  // Recomendaciones generales + vigencia
  let recoms = '<ul class="gp-bullets">';
  for(const r of EXAM_PREOP_RECOMENDACIONES){
    recoms += `<li>${_gpEsc(r)}</li>`;
  }
  recoms += '</ul>';
  recoms += `
    <div class="gp-callout" style="margin-top:14px">
      <strong>💡 Vigencia:</strong> en pacientes estables, los exámenes previos siguen vigentes hasta <strong>6 meses</strong>. En condiciones dinámicas (DM mal controlada, ERC progresiva, ICC, hepatopatía) → considerar vigencia &lt; 1 mes o solicitar nuevos.
    </div>`;

  const html = intro + _renderGpAcc([
    { ico:'📊', title:'Tablas por riesgo quirúrgico × ASA', meta:'3 tablas', html: tablasRiesgo, open: true },
    { ico:'🩺', title:'Específicos por comorbilidad / situación', meta:`${EXAM_PREOP_ESPECIFICOS.length}`, html: especificos, open: false },
    { ico:'⏳', title:'Tiempos de espera tras eventos CV', meta:`${EXAM_PREOP_DIFERIR.length}`, html: diferir, open: false },
    { ico:'📝', title:'Recomendaciones generales', html: recoms, open: false }
  ]) + `<p class="gp-foot-note">Referencia: Actualizaciones en evaluación preoperatoria · Dr. Fernando Rojas, CUA (2026) · Thompson A et al. <em>2024 AHA/ACC Guideline on Perioperative Cardiovascular Management for Noncardiac Surgery</em>. Circulation 2024 · Halvorsen S et al. <em>2022 ESC Guidelines on cardiovascular assessment and management of patients undergoing non-cardiac surgery</em>. Eur Heart J 2022 · ESAIC Guidelines.</p>`;
  cont.innerHTML = html;
}

// ============================================================
// SECCIÓN: Anticoagulantes y Antiagregantes
// ============================================================
function renderGuiasAnticoag(){
  const cont = document.getElementById('gpAnticoagBody');
  if(!cont) return;

  const intro = `
    <div class="gp-callout" style="margin-bottom:14px">
      <strong>🩸 Antes de suspender:</strong> evalúa siempre <em>riesgo trombótico vs. hemorrágico</em>. En stents coronarios recientes, válvulas mecánicas o ETV reciente, la suspensión sin coordinación con cardiología/hematología puede ser de alto riesgo.
    </div>
  `;

  // Tabla principal
  let tablaPrincipal = '<div class="gp-table-scroll"><table class="gp-table"><thead><tr><th>Grupo</th><th>Fármaco</th><th>Suspender antes de cirugía</th><th>Reiniciar postop</th></tr></thead><tbody>';
  let lastGrupo = '';
  for(const r of ANTICOAG_TABLE){
    const grupoCell = (r.grupo !== lastGrupo) ? `<td class="group-cell"><strong>${_gpEsc(r.grupo)}</strong></td>` : '<td></td>';
    lastGrupo = r.grupo;
    tablaPrincipal += `<tr>${grupoCell}<td>${_gpEsc(r.farmaco)}</td><td>${_gpEsc(r.suspender)}</td><td>${_gpEsc(r.reiniciar)}</td></tr>`;
  }
  tablaPrincipal += '</tbody></table></div>';

  const stent = `
    <div class="gp-callout danger" style="margin:0">
      <strong>⛔ Stent coronario reciente:</strong> NO suspender la doble antiagregación (DAPT) si stent farmacoactivo (DES) &lt;6 meses o stent metálico (BMS) &lt;30 días, salvo cirugía emergente. Coordinar con cardiología siempre.
    </div>
  `;

  const bridging = `
    <div class="gp-callout warning" style="margin:0">
      <strong>⚠ Alto riesgo trombótico → considerar bridging con HBPM:</strong>
      <ul style="margin:6px 0 0 18px;padding:0">
        <li>FA con CHA₂DS₂-VASc ≥ 4 o ACV/AIT reciente</li>
        <li>Válvula mecánica mitral o aórtica antigua (jaula de bolas/disco)</li>
        <li>ETV o TEP &lt; 3 meses</li>
        <li>Trombofilia conocida con ETV recurrente</li>
      </ul>
    </div>
  `;

  const reversion = `
    <div class="gp-callout" style="margin:0">
      <strong>🚨 Reversión urgente:</strong>
      <ul style="margin:6px 0 0 18px;padding:0">
        <li><strong>TACO</strong> → CCP de 4 factores (Beriplex / Octaplex) + Vit K EV</li>
        <li><strong>Dabigatrán</strong> → idarucizumab (Praxbind)</li>
        <li><strong>Anti-Xa (apix/rivaro/edoxa)</strong> → andexanet alfa (si disponible) o CCP de 4 factores</li>
        <li><strong>HBPM</strong> → protamina (reversión parcial ~60-70%)</li>
      </ul>
    </div>
  `;

  const html = intro + _renderGpAcc([
    { ico:'💊', title:'Tabla principal: TACO / NOAC / Antiagregantes / HBPM', meta:`${ANTICOAG_TABLE.length} fármacos`, html: tablaPrincipal, open: true },
    { ico:'⛔', title:'Stent coronario reciente — cuándo NO suspender', html: stent, open: false },
    { ico:'⚠️', title:'Bridging con HBPM en alto riesgo trombótico', html: bridging, open: false },
    { ico:'🚨', title:'Reversión urgente de anticoagulantes', html: reversion, open: false }
  ]) + `<p class="gp-foot-note">Referencia: ACC/AHA Periprocedural Management of Antithrombotic Therapy · ESC Guidelines 2022 · Protocolo institucional Clínica Universidad de los Andes.</p>`;

  cont.innerHTML = html;
}

// ============================================================
// SECCIÓN: Riesgo Cardiovascular y Derivación a Cardiología
// ============================================================
// Calc card de RCRI (se renderiza en el modal cuando el usuario presiona el FAB).
function _renderRcriCalcCard(){
  let html = '';
  html += `
    <p class="gp-calc-sub" style="margin-top:0">Marca los factores presentes en tu paciente. El RCRI estima el riesgo de evento cardíaco mayor (IAM, paro, BAV completo) en cirugía no cardíaca.</p>
    <form id="rcriForm" class="gp-calc-form" onsubmit="event.preventDefault();window.calcularRCRI();return false;">
      <div class="gp-calc-chips gp-rcri-chips">
  `;
  RCRI_LABELS.forEach((label, i) => {
    html += `<label class="gp-chk gp-chk-rcri"><input type="checkbox" id="rcriChk${i}"><span><span class="gp-rcri-num">${i+1}</span> ${_gpEsc(label)}</span></label>`;
  });
  html += `
      </div>
      <div class="gp-calc-section-title">Capacidad funcional (METs)</div>
      <label class="gp-calc-field" style="display:block">
        <select id="rcriCf" style="width:100%">
          <option value="desconocida">Desconocida / no evaluable</option>
          <option value="<4METs">&lt; 4 METs (no sube 1 piso de escalera sin síntomas)</option>
          <option value=">=4METs">≥ 4 METs (sube 1 piso de escalera / camina 6 km/h sin síntomas)</option>
        </select>
      </label>
      <div class="gp-calc-actions">
        <button type="submit" class="gp-calc-btn primary">🧮 Calcular puntaje y conducta</button>
        <button type="button" class="gp-calc-btn secondary" onclick="window.resetRCRI()">↺ Limpiar</button>
      </div>
    </form>
    <div id="rcriResultado"></div>`;
  return html;
}

function renderGuiasRiesgoCv(){
  const cont = document.getElementById('gpRiesgoCvBody');
  if(!cont) return;

  const intro = `
    <div class="gp-callout" style="margin-bottom:14px">
      <strong>❤️ Objetivo:</strong> identificar pacientes que requieren <strong>optimización médica</strong> o <strong>evaluación cardiológica</strong> antes de cirugía no cardíaca. Basado en <em>2024 AHA/ACC Guideline on Perioperative Cardiovascular Management for Noncardiac Surgery</em> y <em>2022 ESC Guidelines on Non-cardiac Surgery</em>.
    </div>
    <div class="gp-callout info" style="margin-bottom:14px">
      <strong>🧮 Calculadora RCRI disponible.</strong> Usa el botón <strong>«Abrir calculadora RCRI»</strong> (abajo a la derecha) para calcular el puntaje y la conducta sugerida.
    </div>
  `;

  // Algoritmo
  const algoritmo = `
    <ol class="gp-algoritmo" style="margin:0">
      <li><strong>¿Cirugía emergente?</strong> → ir a pabellón, manejar el riesgo en el perioperatorio. <em>Sin evaluación adicional</em>.</li>
      <li><strong>¿Condición cardíaca activa?</strong> (SCA, ICC descompensada, arritmia significativa, valvulopatía severa sintomática) → <strong>diferir y derivar a Cardiología</strong>.</li>
      <li><strong>¿Cirugía de bajo riesgo cardiovascular (&lt;1%)?</strong> → seguir con la cirugía. <em>Sin más estudios</em>.</li>
      <li><strong>Si riesgo CV elevado (≥1%) → evalúa la capacidad funcional</strong>:
        <ul>
          <li><strong>≥ 4 METs sin síntomas</strong> → seguir.</li>
          <li><strong>&lt; 4 METs o no evaluable</strong> → considerar test no invasivo (ecocardiograma estrés, perfusión miocárdica) <em>solo si el resultado va a cambiar la conducta</em>.</li>
        </ul>
      </li>
    </ol>
  `;

  // METs
  let mets = '<table class="gp-table"><thead><tr><th>Carga</th><th>Equivalencia funcional</th></tr></thead><tbody>';
  for(const r of METS_TABLE){
    mets += `<tr><td><strong>${_gpEsc(r.mets)}</strong></td><td>${_gpEsc(r.actividad)}</td></tr>`;
  }
  mets += '</tbody></table>';
  mets += `<div class="gp-callout" style="margin-top:8px"><strong>👉 Umbral clave: 4 METs.</strong> El paciente debe ser capaz de subir un piso de escalera o caminar 6 km/h en plano sin síntomas. Si no puede o no se sabe, sube el rendimiento del test no invasivo.</div>`;

  // Tabla de referencia RCRI
  let rcriRef = '<table class="gp-table"><thead><tr><th>Score</th><th>Riesgo de evento CV mayor (IAM, paro, BAV completo)</th></tr></thead><tbody>';
  for(const r of RCRI_RIESGO){
    rcriRef += `<tr><td><strong>${_gpEsc(r.n)}</strong></td><td>${_gpEsc(r.riesgo)}</td></tr>`;
  }
  rcriRef += '</tbody></table>';

  // Derivación a Cardiología
  const derivar = `
    <div class="gp-callout warning" style="margin:0">
      <ul style="margin:0;padding-left:18px">
        <li>Riesgo CV elevado <strong>+</strong> capacidad funcional &lt; 4 METs o no evaluable.</li>
        <li>Síndrome coronario agudo, angina inestable o IAM reciente (&lt; 60 días).</li>
        <li>ICC nueva, descompensada o con FE &lt; 30%.</li>
        <li>Arritmias sintomáticas, BAV de alto grado, taquiarritmias no controladas.</li>
        <li>Valvulopatía severa sintomática (estenosis aórtica severa, IM/IA severa con síntomas).</li>
        <li>Marcapasos / DAI — coordinar manejo periop (modo asincrónico, desactivación de DAI).</li>
        <li>Stent coronario reciente: DES &lt; 6 meses, BMS &lt; 30 días.</li>
        <li>Hipertensión pulmonar moderada-severa.</li>
        <li>Cardiopatía congénita adulta compleja.</li>
      </ul>
    </div>
  `;

  const html = intro + _renderGpAcc([
    { ico:'🧭', title:'Algoritmo simplificado AHA/ACC', meta:'4 pasos', html: algoritmo, open: true },
    { ico:'🏃', title:'Capacidad funcional — escala METs', meta:`${METS_TABLE.length}`, html: mets, open: false },
    { ico:'📊', title:'Tabla de referencia · RCRI', meta:`${RCRI_RIESGO.length}`, html: rcriRef, open: false },
    { ico:'❤️', title:'¿Cuándo derivar a Cardiología?', html: derivar, open: false }
  ]) + `<p class="gp-foot-note">Referencia: Thompson A et al. <em>2024 AHA/ACC Guideline on Perioperative Cardiovascular Management for Noncardiac Surgery</em>. Circulation 2024;150:e351-e442 · Halvorsen S et al. <em>2022 ESC Guidelines on non-cardiac surgery</em>. Eur Heart J 2022;43:3826-3924 · Lee TH et al. <em>Revised Cardiac Risk Index</em>. Circulation 1999;100:1043-9.</p>`;

  cont.innerHTML = html;
}

// ============================================================
// MÓDULO: AGENDAMIENTO DE PROCEDIMIENTOS
// Salas (Endoscopía / Imagenología / Otros) + Calendario mensual + Slots
// Unidades solicitantes ↔ Panel admin (Anestesia) para visar
// Persistencia: localStorage por ahora (TODO: backend Cloudflare KV/D1)
// ============================================================

// --- Catálogos ---
// salaId: sala a la que entra DIRECTO la unidad tras identificarse.
// Si es null (Pediatría / Otra unidad), se muestra el listado completo de salas.
const AGEND_UNIDADES = [
  { code:'endo_dig',  name:'Endoscopía Paralela', ico:'🔬', salaId:'endoscopia' },
  { code:'radio',     name:'Imagenología',         ico:'🩻', salaId:'imagenologia' },
  { code:'accesos',   name:'Accesos Vasculares',   ico:'💉', salaId:'accesos_vasculares' },
  { code:'odonto',    name:'Odontología',          ico:'🦷', salaId:'dental' },
  { code:'neuro',     name:'Neurología',           ico:'🧠', salaId:'neurologia' },
  { code:'onco',      name:'Oncología / Hemato',   ico:'🎗️', salaId:'oncohemato' },
  { code:'pedia',     name:'Pediatría',            ico:'🧒', salaId:null },
  { code:'otra',      name:'Otra unidad',          ico:'➕', salaId:null }
];
const AGEND_DEFAULT_PIN = '1234';

// AGEND_SALAS — cada sala tiene su propia agenda regular por día de la semana
// (0=domingo, 1=lunes, ..., 6=sábado). Si un día no aparece en `schedule`,
// está cerrado en la agenda regular (puede pedirse "Agendamiento Extra"
// si `allowsExtra=true`).
//
// blockedByOtherSalas: ids de salas cuyos pedidos activos (pendiente/aprobada)
// bloquean horarios para ESTA sala (sus turnos reservan la disponibilidad
// del anestesiólogo). Ej.: Neuro y Onco no pueden topar con Endo ni Imagen.
//
// allowsExtra: muestra el botón "Agendamiento Extra" en el calendario.
// allowsParallelExtra: cuando un Extra se agenda, se permiten paralelos
//   en el mismo horario (solo Endoscopía).
//
// usesAmPmOnly: la sala no usa horarios precisos sino bloques AM/PM.
//   En este modo el formulario muestra un selector AM/PM, no selectores de
//   hora; en el storage el slot se guarda con startMin/endMin que cubren
//   el bloque completo (AM = 08:00–14:00, PM = 14:00–20:00). Estas salas
//   NO bloquean a otras (no toman al anestesiólogo en un horario preciso)
//   y NO son bloqueadas por cross-blocks (su disponibilidad es flexible).
//
// procedimientosCatalogo: lista de procedimientos que puede seleccionar la
//   unidad solicitante al pedir hora (reemplaza el campo libre).
const AGEND_SALAS = [
  {
    id:'endoscopia', name:'Endoscopía Paralela', ico:'🔬', color:'#0EA5E9',
    desc:'Procedimientos endoscópicos en paralelo (la endoscopía regular tiene su propia vía de solicitud)',
    schedule: {
      1:{start:'08:00', end:'20:00'}, 2:{start:'08:00', end:'20:00'},
      3:{start:'08:00', end:'20:00'}, 4:{start:'08:00', end:'20:00'},
      5:{start:'08:00', end:'20:00'}, 6:{start:'08:00', end:'14:00'}
    },
    blockedByOtherSalas: ['accesos_vasculares','imagenologia','neurologia','oncohemato','dental','fuera_sala'],
    allowsExtra: true,
    allowsParallelExtra: true
  },
  {
    id:'imagenologia', name:'Imagenología', ico:'🩻', color:'#A855F7',
    desc:'TAC, RM con sedación, intervencionismo radiológico',
    schedule: {
      3:{start:'08:00', end:'14:00'}, 6:{start:'08:00', end:'14:00'}
    },
    // Comparten un solo anestesiólogo → se bloquean entre sí (cola)
    blockedByOtherSalas: ['endoscopia','accesos_vasculares','neurologia','oncohemato','dental','fuera_sala'],
    allowsExtra: true,
    allowsParallelExtra: false
  },
  {
    id:'accesos_vasculares', name:'Accesos Vasculares', ico:'💉', color:'#0D9488',
    desc:'PICC, MidLine, CVC, catéter de diálisis transitorio, vía venosa periférica',
    vascular: true, // vive en el Portal Vascular; se oculta de la lista general de Agendamiento
    leadTimeHabilesH: 0, // sin anticipación mínima: se puede agendar el mismo día
    schedule: {
      1:{start:'08:00', end:'20:00'}, 2:{start:'08:00', end:'20:00'},
      3:{start:'08:00', end:'20:00'}, 4:{start:'08:00', end:'20:00'},
      5:{start:'08:00', end:'20:00'}, 6:{start:'08:00', end:'14:00'}
    },
    blockedByOtherSalas: ['endoscopia','imagenologia','neurologia','oncohemato','dental','fuera_sala'],
    allowsExtra: false,
    allowsParallelExtra: false,
    procedimientosCatalogo: [
      'Vía Venosa Periférica',
      'PICC Line',
      'MidLine',
      'Catéter Venoso Central (CVC)',
      'Catéter de Diálisis Transitorio',
      'Port-a-cath',
      'Retiro de catéter',
      'Recambio de catéter',
      'Otro acceso vascular'
    ]
  },
  {
    id:'dental', name:'Dental', ico:'🦷', color:'#F59E0B',
    desc:'Sedación dental',
    schedule: { 6:{start:'08:00', end:'14:00'} },
    blockedByOtherSalas: ['endoscopia','accesos_vasculares','imagenologia','neurologia','oncohemato','fuera_sala'],
    allowsExtra: false,
    allowsParallelExtra: false
  },
  {
    id:'neurologia', name:'Neurología', ico:'🧠', color:'#7C3AED',
    desc:'Procedimientos neurológicos electivos',
    schedule: {
      1:{start:'08:00', end:'20:00'}, 2:{start:'08:00', end:'20:00'},
      3:{start:'08:00', end:'20:00'}, 4:{start:'08:00', end:'20:00'},
      5:{start:'08:00', end:'20:00'}, 6:{start:'08:00', end:'14:00'}
    },
    blockedByOtherSalas: ['endoscopia','accesos_vasculares','imagenologia','oncohemato','dental','fuera_sala'],
    allowsExtra: false,
    allowsParallelExtra: false
  },
  {
    id:'oncohemato', name:'Oncología / Hematología', ico:'🎗️', color:'#DB2777',
    desc:'QMT intratecal, médula ósea',
    schedule: {
      1:{start:'08:00', end:'20:00'}, 2:{start:'08:00', end:'20:00'},
      3:{start:'08:00', end:'20:00'}, 4:{start:'08:00', end:'20:00'},
      5:{start:'08:00', end:'20:00'}, 6:{start:'08:00', end:'14:00'}
    },
    blockedByOtherSalas: ['endoscopia','accesos_vasculares','imagenologia','neurologia','dental','fuera_sala'],
    allowsExtra: false,
    allowsParallelExtra: false
  },
  {
    id:'fuera_sala', name:'Fuera de Sala', ico:'📍', color:'#64748B',
    desc:'Procedimientos fuera de pabellón / otras unidades — indica fecha y horario preferible',
    schedule: {
      1:{start:'08:00', end:'20:00'}, 2:{start:'08:00', end:'20:00'},
      3:{start:'08:00', end:'20:00'}, 4:{start:'08:00', end:'20:00'},
      5:{start:'08:00', end:'20:00'}, 6:{start:'08:00', end:'14:00'}
    },
    blockedByOtherSalas: ['endoscopia','accesos_vasculares','imagenologia','neurologia','oncohemato','dental'],
    allowsExtra: true,
    allowsParallelExtra: false
  },
  {
    id:'medcomp', name:'Medición Compartimental', ico:'📏', color:'#0891B2',
    desc:'Medición de presión compartimental — jueves AM',
    schedule: { 4:{start:'09:00', end:'11:00'} },
    blockedByOtherSalas: ['endoscopia'],
    allowsExtra: false,
    allowsParallelExtra: false
  }
];

// --- Bloques AM / PM (para salas con usesAmPmOnly) ---
const AGEND_AM_START_MIN = 8 * 60;   // 08:00
const AGEND_AM_END_MIN   = 14 * 60;  // 14:00
const AGEND_PM_START_MIN = 14 * 60;  // 14:00
const AGEND_PM_END_MIN   = 20 * 60;  // 20:00

function _agendIsAmPmSala(salaId){
  const s = _agendGetSala(salaId);
  return !!(s && s.usesAmPmOnly);
}
function _agendBlockRange(block){
  // block: 'AM' | 'PM'
  if(block === 'PM') return { startMin: AGEND_PM_START_MIN, endMin: AGEND_PM_END_MIN };
  return { startMin: AGEND_AM_START_MIN, endMin: AGEND_AM_END_MIN };
}
function _agendBlockOfSlot(slot){
  if(!slot) return null;
  if(slot.block === 'AM' || slot.block === 'PM') return slot.block;
  // heurística: si el inicio está antes de las 14:00 → AM, si no PM
  if(typeof slot.startMin === 'number') return slot.startMin < AGEND_PM_START_MIN ? 'AM' : 'PM';
  return null;
}
function _agendBlockLabel(block){
  if(block === 'PM') return 'PM (14:00–20:00)';
  return 'AM (08:00–14:00)';
}

const AGEND_SLOT_HOURS = [8,9,10,11,12,13,14,15,16,17,18,19]; // legacy
const AGEND_SLOT_GRANULARITY_MIN = 30;   // granularidad para selectores de horario (30 min)
const AGEND_DAY_START_MIN = 8 * 60;      // 08:00 — límite global mínimo absoluto
const AGEND_DAY_END_MIN   = 20 * 60;     // 20:00 — límite global máximo absoluto
const AGEND_DATA_LS_KEY    = 'appx_agend_data_v1';
const AGEND_SESSION_LS_KEY = 'appx_agend_sess_v1';
const AGEND_CFG_LS_KEY     = 'appx_agend_cfg_v1';   // config sincronizada (días cerrados manuales)

// Anticipación mínima para agendamiento REGULAR (horas hábiles: no cuentan
// domingos ni feriados/cierres). Bajo este umbral solo queda la vía de
// Agendamiento Extra (que requiere visado del administrador).
// jul 2026: se bajó de 24 → 12 h. Cada sala puede sobreescribirlo con
// "leadTimeHabilesH" en AGEND_SALAS (Accesos Vasculares = 0, sin límite).
const AGEND_LEAD_TIME_HABILES_H = 12;

// Feriados irrenunciables de Chile (mes-día). Se repiten todos los años, por
// lo que no requieren mantención anual. Las elecciones u otros feriados se
// agregan como "día cerrado manual" desde el panel admin.
const AGEND_FERIADOS_IRRENUNCIABLES = ['01-01','05-01','09-18','09-19','12-25'];

// --- Estado en memoria ---
const AGEND_STATE = {
  mode: null,            // 'unidad' | 'admin'
  unidadCode: null,
  solicitanteNombre: '',
  solicitanteTel: '',
  staffNombre: '',
  salaId: null,
  calYear: 0, calMonth: 0,
  selectedDate: null,    // 'YYYY-MM-DD'
  formHour: null,        // legacy (compat)
  formStartMin: null,    // minutos desde 00:00 (nuevo rango flexible)
  formEndMin: null,
  detalleId: null,
  overviewTab: 'pendiente',
  navStack: [],
  vascOnly: false   // true cuando se entra desde el Portal Vascular (solo salas vasculares)
};

// --- Persistencia ---
// Convierte un nombre a iniciales con puntos. "Juan Pérez" → "J. P."
// Si ya parece iniciales (corto, con puntos/mayúsculas), lo deja casi igual.
function _agendIniciales(texto){
  const t = String(texto||'').trim();
  if(!t) return '';
  // Tomar la primera letra de cada palabra (máx 3), en mayúscula, con puntos.
  const parts = t.split(/[\s.]+/).filter(Boolean).slice(0,3);
  const ini = parts.map(p => (p[0]||'').toUpperCase()).filter(Boolean);
  if(ini.length === 0) return '';
  return ini.join('. ') + '.';
}

// Saneador de privacidad: garantiza que ninguna solicitud guarde nombre
// completo ni RUT. Convierte 'paciente' a iniciales y elimina 'rut'.
// Idempotente: si ya está minimizado no cambia nada.
function _agendSanitizeReq(r){
  if(!r || typeof r !== 'object' || r.deleted) return r;
  let changed = false;
  // RUT: nunca debe persistir
  if(r.rut){ delete r.rut; changed = true; }
  // paciente: si tiene espacios o más de 8 caracteres, parece nombre → iniciales
  if(typeof r.paciente === 'string' && /\s/.test(r.paciente.trim()) && r.paciente.trim().length > 4){
    const ini = _agendIniciales(r.paciente);
    if(ini && ini !== r.paciente){ r.paciente = ini; changed = true; }
  } else if(typeof r.paciente === 'string' && r.paciente.trim().length > 8){
    r.paciente = r.paciente.trim().slice(0,8); changed = true;
  }
  if(changed) r.updatedAt = Date.now();
  return r;
}
// Recorre toda la estructura {sala:{fecha:[req]}} y sanea cada solicitud.
function _agendSanitizeAll(data){
  if(!data || typeof data !== 'object') return data;
  Object.keys(data).forEach(salaId=>{
    const dias = data[salaId]; if(!dias || typeof dias !== 'object') return;
    Object.keys(dias).forEach(d=>{
      if(Array.isArray(dias[d])) dias[d].forEach(_agendSanitizeReq);
    });
  });
  return data;
}

function agendLoadData(){
  try{
    const data = JSON.parse(localStorage.getItem(AGEND_DATA_LS_KEY) || '{}');
    return _agendSanitizeAll(data); // limpia identificadores antiguos al leer
  }
  catch(e){ return {}; }
}
function agendSaveData(data){
  try{ localStorage.setItem(AGEND_DATA_LS_KEY, JSON.stringify(data)); }
  catch(e){ console.error('No se pudo guardar agendamiento', e); }
}
function agendLoadSession(){
  try{ return JSON.parse(localStorage.getItem(AGEND_SESSION_LS_KEY) || 'null'); }
  catch(e){ return null; }
}
function agendSaveSession(sess){
  if(sess) localStorage.setItem(AGEND_SESSION_LS_KEY, JSON.stringify(sess));
  else localStorage.removeItem(AGEND_SESSION_LS_KEY);
}

// ============================================================
// DÍAS CERRADOS: feriados irrenunciables (automáticos) + cierres manuales
// (sincronizados a todos los dispositivos por un canal de config aparte).
// ============================================================
function _agendIsFeriadoIrrenunciable(dateStr){
  return AGEND_FERIADOS_IRRENUNCIABLES.includes(String(dateStr||'').slice(5)); // 'MM-DD'
}
function agendLoadCfg(){
  try{
    const c = JSON.parse(localStorage.getItem(AGEND_CFG_LS_KEY) || '{}');
    if(!c.closures || typeof c.closures !== 'object') c.closures = {};
    return c;
  }catch(e){ return { closures: {} }; }
}
function agendSaveCfg(cfg){
  try{ localStorage.setItem(AGEND_CFG_LS_KEY, JSON.stringify(cfg)); }
  catch(e){ console.error('No se pudo guardar config de agendamiento', e); }
}
// Cierre manual vigente (ignora tombstones de cierres eliminados).
function _agendManualClosure(dateStr){
  const c = agendLoadCfg();
  const x = c.closures && c.closures[dateStr];
  return (x && !x.deleted) ? x : null;
}
function _agendIsClosedDate(dateStr){
  return _agendIsFeriadoIrrenunciable(dateStr) || !!_agendManualClosure(dateStr);
}
function _agendClosureLabel(dateStr){
  if(_agendIsFeriadoIrrenunciable(dateStr)) return 'Feriado irrenunciable';
  const m = _agendManualClosure(dateStr);
  return m ? (m.reason || 'Día cerrado') : '';
}

// --- Lead-time (anticipación mínima en horas hábiles) ---
function _agendSlotDatetime(dateStr, startMin){
  const dt = _agendParseDateStr(dateStr);
  dt.setHours(Math.floor((startMin||0)/60), (startMin||0)%60, 0, 0);
  return dt;
}
// Horas hábiles de anticipación mínima para una sala. Cada sala puede
// definir "leadTimeHabilesH" (Accesos Vasculares = 0 → sin límite);
// si no lo define, rige el general AGEND_LEAD_TIME_HABILES_H.
function _agendLeadTimeHours(salaId){
  const sala = _agendGetSala(salaId);
  if(sala && typeof sala.leadTimeHabilesH === 'number') return sala.leadTimeHabilesH;
  return AGEND_LEAD_TIME_HABILES_H;
}
// Primer instante permitido para agenda regular: ahora + N horas, descontando
// domingos y feriados/cierres (no cuentan como horas hábiles).
function _agendLeadTimeDeadline(salaId){
  let remaining = _agendLeadTimeHours(salaId);
  let cursor = new Date();
  if(remaining <= 0) return cursor; // sin anticipación mínima
  let guard = 0;
  while(remaining > 0 && guard < 24*90){
    cursor = new Date(cursor.getTime() + 3600*1000); // +1 hora
    const ds = _agendDateStr(cursor.getFullYear(), cursor.getMonth(), cursor.getDate());
    const habil = (cursor.getDay() !== 0) && !_agendIsClosedDate(ds); // domingo / feriado no cuentan
    if(habil) remaining--;
    guard++;
  }
  return cursor;
}
function _agendMeetsLeadTime(dateStr, startMin, salaId){
  return _agendSlotDatetime(dateStr, startMin).getTime() >= _agendLeadTimeDeadline(salaId).getTime();
}

// --- Sync del canal de config (cierres manuales) ---
let _agendCfgSyncing = false;
let _agendCfgTimer = null;
function _agendCfgRemoteId(){ return INSTITUTION ? (INSTITUTION.id + '-agendcfg') : null; }
function _agendMergeCfg(remote, local){
  const out = { closures: {} };
  const r = (remote && remote.closures) || {};
  const l = (local && local.closures) || {};
  const keys = new Set([...Object.keys(r), ...Object.keys(l)]);
  keys.forEach(d => {
    const a = r[d], b = l[d];
    const pick = !a ? b : (!b ? a : (((a.at||0) >= (b.at||0)) ? a : b)); // gana el más reciente
    if(pick) out.closures[d] = pick;
  });
  // Purgar tombstones de cierres eliminados hace más de 90 días
  const cutoff = Date.now() - 90*24*3600*1000;
  Object.keys(out.closures).forEach(d => {
    const x = out.closures[d];
    if(x && x.deleted && (x.at||0) < cutoff) delete out.closures[d];
  });
  return out;
}
async function agendCfgSyncNow(){
  const base = getBackendURL();
  const id = _agendCfgRemoteId();
  if(!base || !id || _agendCfgSyncing) return false;
  _agendCfgSyncing = true;
  try{
    let remote = { closures: {} };
    try{
      const r = await fetch(base + '/api/state/' + encodeURIComponent(id), _stateGetOpts());
      if(r.ok){
        const j = await r.json();
        if(j && !j._empty && j.data) remote = j.data;
      }
    }catch(e){ return false; }
    const merged = _agendMergeCfg(remote, agendLoadCfg());
    agendSaveCfg(merged);
    const token = getBackendToken();
    if(token){
      await fetch(base + '/api/state/' + encodeURIComponent(id), {
        method:'POST',
        headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},
        body: JSON.stringify({ data: merged })
      }).catch(()=>{});
    }
    return true;
  }catch(e){ console.warn('agendCfgSyncNow', e); return false; }
  finally{ _agendCfgSyncing = false; }
}
function agendScheduleCfgSync(){
  if(_agendCfgTimer) clearTimeout(_agendCfgTimer);
  _agendCfgTimer = setTimeout(()=>{ _agendCfgTimer = null; agendCfgSyncNow(); }, 800);
}

// Admin: agregar o quitar un día cerrado manual.
function agendGestionarCierre(){
  if(AGEND_STATE.mode !== 'admin'){ alert('Solo el administrador puede gestionar días cerrados.'); return; }
  const fechaIn = prompt('Día a cerrar/reabrir (AAAA-MM-DD):', AGEND_STATE.selectedDate || _agendTodayStr());
  if(fechaIn === null) return;
  const ds = String(fechaIn).trim();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(ds) || isNaN(_agendParseDateStr(ds).getTime())){
    alert('Fecha inválida. Usa el formato AAAA-MM-DD.'); return;
  }
  if(_agendIsFeriadoIrrenunciable(ds)){
    alert('Ese día ya es feriado irrenunciable (cerrado automáticamente). No es necesario agregarlo.'); return;
  }
  const cfg = agendLoadCfg();
  const ya = _agendManualClosure(ds);
  if(ya){
    if(confirm(`El ${ds} está cerrado ("${ya.reason||'Día cerrado'}").\n\n¿Reabrirlo?`)){
      cfg.closures[ds] = { deleted: true, at: Date.now() }; // tombstone para propagar la reapertura
      agendSaveCfg(cfg); agendScheduleCfgSync();
      toast && toast('Día reabierto');
      try{ agendRenderCalendario(); }catch(e){}
    }
    return;
  }
  const reason = (prompt('Motivo del cierre (ej: Capacitación del servicio):') || 'Día cerrado').trim();
  cfg.closures[ds] = { reason, by: (AGEND_STATE.staffNombre || 'Admin'), at: Date.now() };
  agendSaveCfg(cfg); agendScheduleCfgSync();
  toast && toast('Día marcado como cerrado');
  try{ agendRenderCalendario(); }catch(e){}
}

// ============================================================
// SYNC DE AGENDAMIENTO CON LA NUBE
// Usa el mismo Worker/KV del backend, pero con un id de estado aparte
// ('<institucion>-agend') para no mezclarse con el estado principal.
// Así las solicitudes creadas en cualquier dispositivo llegan a todos.
// ============================================================
let _agendSyncTimer = null;
let _agendSyncing = false;

function _agendRemoteId(){ return INSTITUTION ? (INSTITUTION.id + '-agend') : null; }
function _agendReqTs(r){ return r ? (r.updatedAt || r.visadoAt || r.createdAt || 0) : 0; }

// Fusiona dos estructuras {salaId:{dateStr:[solicitudes]}} por id de solicitud.
// Gana la versión con timestamp más reciente. Las eliminaciones se propagan
// mediante "tombstones" ({id, deleted:true}) que se purgan a los 90 días.
function _agendMergeData(remoteData, localData){
  const out = {};
  const cutoff = Date.now() - 90*24*3600*1000;
  const salas = new Set([...Object.keys(remoteData||{}), ...Object.keys(localData||{})]);
  salas.forEach(salaId=>{
    const rD = (remoteData||{})[salaId] || {};
    const lD = (localData||{})[salaId] || {};
    const fechas = new Set([...Object.keys(rD), ...Object.keys(lD)]);
    const dias = {};
    fechas.forEach(d=>{
      const map = {};
      const put = raw => {
        const arr = Array.isArray(raw) ? raw : _agendMigrateDayEntry(raw);
        (arr||[]).forEach(r=>{
          if(!r || !r.id) return;
          const ex = map[r.id];
          if(!ex || _agendReqTs(r) >= _agendReqTs(ex)) map[r.id] = r;
        });
      };
      put(rD[d]); put(lD[d]);
      const arr = Object.values(map).filter(r => !(r.deleted && (r.deletedAt||0) < cutoff));
      if(arr.length) dias[d] = arr.sort((a,b)=>(a.startMin||0)-(b.startMin||0));
    });
    if(Object.keys(dias).length) out[salaId] = dias;
  });
  return out;
}

// Lee la nube, fusiona con lo local, guarda local y sube el resultado.
async function agendSyncNow(){
  const base = getBackendURL();
  const id = _agendRemoteId();
  if(!base || !id || _agendSyncing) return false;
  _agendSyncing = true;
  try{
    let remoteData = {};
    // 1) LEER el estado remoto. Si la lectura falla, NO escribimos a ciegas
    //    (igual que el estado principal) y devolvemos false.
    try{
      const r = await fetch(base + '/api/state/' + encodeURIComponent(id), _stateGetOpts());
      if(!r.ok) return false;
      const remote = await r.json();
      if(remote && !remote._empty && remote.data) remoteData = remote.data;
    }catch(e){ return false; }
    // Sanear lo que viene de la nube (puede traer nombres/RUT antiguos) antes de fusionar
    _agendSanitizeAll(remoteData);
    const merged = _agendSanitizeAll(_agendMergeData(remoteData, agendLoadData()));
    agendSaveData(merged);
    const token = getBackendToken();
    if(!token) return false;
    // 2) ESCRIBIR y CONFIRMAR de verdad: el resultado de agendSyncNow refleja si
    //    el POST llegó (antes se tragaba el error y devolvía true igual).
    try{
      const pr = await fetch(base + '/api/state/' + encodeURIComponent(id), {
        method:'POST',
        headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},
        body: JSON.stringify({ data: merged })
      });
      return pr.ok;
    }catch(e){ return false; }
  }catch(e){ console.warn('agendSyncNow', e); return false; }
  finally{ _agendSyncing = false; }
}

// Push con debounce tras una mutación local (crear/visar/eliminar).
function agendScheduleSync(onDone){
  if(_agendSyncTimer) clearTimeout(_agendSyncTimer);
  _agendSyncTimer = setTimeout(()=>{
    _agendSyncTimer = null;
    agendSyncNow().then(()=>{ if(typeof onDone === 'function') onDone(); });
  }, 800);
}

// ============================================================
// NOTIFICACIONES DE NUEVAS SOLICITUDES (solo administrador)
// ============================================================
const AGEND_ADMIN_SEEN_LS_KEY = 'appx_agend_admin_seen_v1';
function _agendAdminSeenTs(){
  try{ return parseInt(localStorage.getItem(AGEND_ADMIN_SEEN_LS_KEY)||'0',10) || 0; }
  catch(e){ return 0; }
}
function agendMarkAdminSeen(){
  try{ localStorage.setItem(AGEND_ADMIN_SEEN_LS_KEY, String(Date.now())); }catch(e){}
  updateAgendAdminNotice();
}
// Solicitudes pendientes creadas después de la última revisión del admin
function _agendNewForAdmin(){
  const seen = _agendAdminSeenTs();
  return _agendAllRequests().filter(r => r.estado === 'pendiente' && !r.deleted && (r.createdAt||0) > seen);
}
// Pinta el aviso en el home (solo admin) + badge en el selector de módulos
function updateAgendAdminNotice(){
  const isAdmin = state && state.isAdmin;
  const nuevas = isAdmin ? _agendNewForAdmin() : [];
  const pendientes = isAdmin ? _agendAllRequests().filter(r => r.estado === 'pendiente' && !r.deleted) : [];
  // Banner arriba del home
  const banner = document.getElementById('agendAdminNotice');
  if(banner){
    if(isAdmin && nuevas.length > 0){
      banner.style.display = 'flex';
      document.getElementById('agendAdminNoticeText').textContent =
        nuevas.length === 1
          ? 'Hay 1 nueva solicitud de agendamiento por visar'
          : 'Hay ' + nuevas.length + ' nuevas solicitudes de agendamiento por visar';
    } else {
      banner.style.display = 'none';
    }
  }
  // Badge en el botón del módulo Agendamiento
  const b = document.getElementById('agendModBadge');
  if(b){
    if(isAdmin && pendientes.length > 0){
      b.textContent = pendientes.length;
      b.style.display = 'inline-block';
    } else {
      b.style.display = 'none';
    }
  }
  try{ _updateSolBadge(); }catch(e){}
  // Piggyback: refresca también los badges de Interconsultas (mismo ciclo de vida).
  try{ updateIcBadges(); }catch(e){}
}
// Chequeo periódico: baja las solicitudes de la nube y avisa si hay nuevas.
// Se llama al iniciar sesión admin y cada 3 minutos mientras la app esté abierta.
let _agendAdminPollTimer = null;
async function checkAgendNewForAdmin(){
  if(!state || !state.isAdmin) return;
  await agendSyncNow();
  const nuevas = _agendNewForAdmin();
  updateAgendAdminNotice();
  if(nuevas.length > 0){
    // Notificación del sistema (si la app está abierta y hay permiso)
    const tag = 'agend-new-' + nuevas.length;
    if(!window._agendLastNotifTag || window._agendLastNotifTag !== tag){
      window._agendLastNotifTag = tag;
      notify('📋 Solicitudes de agendamiento',
        nuevas.length === 1 ? 'Hay 1 nueva solicitud por visar' : 'Hay ' + nuevas.length + ' nuevas solicitudes por visar',
        'agend-new');
    }
  }
}
function startAgendAdminPolling(){
  if(_agendAdminPollTimer) clearInterval(_agendAdminPollTimer);
  _agendAdminPollTimer = setInterval(()=>{ try{ checkAgendNewForAdmin(); }catch(e){} }, 3*60*1000);
}

// --- Helpers de fecha ---
function _agendPad(n){ return String(n).padStart(2,'0'); }
function _agendDateStr(year, month0, day){
  return `${year}-${_agendPad(month0+1)}-${_agendPad(day)}`;
}
function _agendTodayStr(){
  const d = new Date();
  return _agendDateStr(d.getFullYear(), d.getMonth(), d.getDate());
}
function _agendParseDateStr(s){
  const [y,m,d] = s.split('-').map(Number);
  return new Date(y, m-1, d);
}
const _agendMesesES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const _agendDiasES = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];

// --- Helpers de slots ---
function _agendGetSala(salaId){ return AGEND_SALAS.find(s => s.id === salaId); }
function _agendGetUnidad(code){ return AGEND_UNIDADES.find(u => u.code === code); }
function _agendGenId(){ return 'r_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,7); }

// --- Helpers de tiempo (minutos desde 00:00) ---
function _agendMinToHHMM(min){
  const h = Math.floor(min/60), m = min%60;
  return `${_agendPad(h)}:${_agendPad(m)}`;
}
function _agendHHMMToMin(hhmm){
  if(typeof hhmm !== 'string') return null;
  const m = hhmm.match(/^(\d{1,2}):(\d{2})$/);
  if(!m) return null;
  return parseInt(m[1],10)*60 + parseInt(m[2],10);
}
function _agendTimeOptions(){
  // Devuelve [{value:'08:00',label:'08:00'}, ... '20:00'] cada 30 min
  const out = [];
  for(let t = AGEND_DAY_START_MIN; t <= AGEND_DAY_END_MIN; t += AGEND_SLOT_GRANULARITY_MIN){
    const s = _agendMinToHHMM(t);
    out.push({ value: s, label: s });
  }
  return out;
}
function _agendFmtRange(startMin, endMin){
  return `${_agendMinToHHMM(startMin)}–${_agendMinToHHMM(endMin)}`;
}

// --- Migración: convierte estructura antigua data[sala][date][hourKey]=req
//                 a la nueva data[sala][date]=[req,...] con startMin/endMin.
//     Es idempotente: si ya es array, no hace nada.
function _agendMigrateDayEntry(entry){
  if(Array.isArray(entry)) return entry;
  if(!entry || typeof entry !== 'object') return [];
  const out = [];
  Object.keys(entry).forEach(hourKey => {
    const r = entry[hourKey];
    if(!r) return;
    if(typeof r.startMin === 'number' && typeof r.endMin === 'number'){
      out.push(r);
      return;
    }
    const h = parseInt(hourKey,10);
    if(isNaN(h)) return;
    out.push({
      ...r,
      startMin: h*60,
      endMin:   (h+1)*60
    });
  });
  out.sort((a,b) => (a.startMin - b.startMin) || (a.endMin - b.endMin));
  return out;
}
function _agendEnsureMigratedAndSave(){
  const data = agendLoadData();
  let dirty = false;
  Object.keys(data).forEach(salaId => {
    const bySala = data[salaId] || {};
    Object.keys(bySala).forEach(dateStr => {
      const entry = bySala[dateStr];
      if(!Array.isArray(entry)){
        bySala[dateStr] = _agendMigrateDayEntry(entry);
        dirty = true;
      }
    });
  });
  if(dirty) agendSaveData(data);
  return data;
}

// Devuelve siempre un array de solicitudes (ordenado) para ese día/sala
function _agendGetDaySlots(salaId, dateStr){
  const data = agendLoadData();
  const raw = ((data[salaId]||{})[dateStr]);
  const arr = Array.isArray(raw) ? raw.slice() : _agendMigrateDayEntry(raw);
  // Excluir tombstones (solicitudes eliminadas que se conservan solo para sync)
  return (arr||[]).filter(r => r && !r.deleted).sort((a,b) => a.startMin - b.startMin);
}
function _agendCountDay(salaId, dateStr){
  const slots = _agendGetDaySlots(salaId, dateStr);
  let pend=0, aprob=0, rech=0;
  slots.forEach(r => {
    if(r.estado === 'pendiente' || r.estado === 'propuesta') pend++;
    else if(r.estado === 'aprobada' || r.estado === 'realizada') aprob++;
    else if(r.estado === 'rechazada') rech++;
  });
  return {pend, aprob, rech, total: pend+aprob+rech};
}
function _agendAllRequests(){
  const out = [];
  const data = agendLoadData();
  Object.keys(data).forEach(salaId => {
    Object.keys(data[salaId]||{}).forEach(dateStr => {
      const arr = Array.isArray(data[salaId][dateStr])
        ? data[salaId][dateStr]
        : _agendMigrateDayEntry(data[salaId][dateStr]);
      arr.forEach(r => {
        if(r && r.deleted) return; // tombstone de solicitud eliminada
        out.push({ salaId, dateStr, ...r });
      });
    });
  });
  return out;
}
function _agendFindRequest(reqId){
  const data = agendLoadData();
  for(const salaId of Object.keys(data)){
    for(const dateStr of Object.keys(data[salaId]||{})){
      const arr = Array.isArray(data[salaId][dateStr])
        ? data[salaId][dateStr]
        : _agendMigrateDayEntry(data[salaId][dateStr]);
      for(let i=0; i<arr.length; i++){
        if(arr[i] && arr[i].id === reqId && !arr[i].deleted){
          return { salaId, dateStr, index: i, req: arr[i] };
        }
      }
    }
  }
  return null;
}
// Devuelve la solicitud que solapa con el rango (excluye reqIdExcluir opcional).
// Rechazadas no bloquean. Solapamiento estricto: a.start < b.end && a.end > b.start.
// SI la sala permite "paralelo en Extra" (Endoscopía) Y el pedido nuevo Y el
// existente son ambos extras, NO se bloquean entre sí (paralelo permitido).
function _agendFindOverlap(salaId, dateStr, startMin, endMin, reqIdExcluir, isExtraNuevo){
  const sala = _agendGetSala(salaId);
  const permiteParalelo = !!(sala && sala.allowsParallelExtra) && !!isExtraNuevo;
  const slots = _agendGetDaySlots(salaId, dateStr);
  for(const r of slots){
    if(reqIdExcluir && r.id === reqIdExcluir) continue;
    if(r.estado === 'rechazada') continue;
    if(startMin < r.endMin && endMin > r.startMin){
      // Paralelo permitido sólo cuando ambos (nuevo + existente) son Extra y la sala lo permite
      if(permiteParalelo && r.isExtra) continue;
      return r;
    }
  }
  return null;
}

// --- Schedule por sala / día -------------------------------------------------
// Devuelve la entrada de schedule para una sala+fecha, o null si está cerrada.
function _agendSalaHoursForDate(salaId, dateStr){
  const sala = _agendGetSala(salaId);
  if(!sala || !sala.schedule) return null;
  const dt = _agendParseDateStr(dateStr);
  const dow = dt.getDay(); // 0..6
  const sched = sala.schedule[dow];
  if(!sched) return null;
  return {
    startMin: _agendHHMMToMin(sched.start),
    endMin:   _agendHHMMToMin(sched.end)
  };
}
// Booleano: ¿la sala tiene agenda regular abierta ese día?
function _agendIsDayOpenForSala(salaId, dateStr){
  return _agendSalaHoursForDate(salaId, dateStr) !== null;
}
// Etiqueta humana de horario regular de la sala (multi-día agrupado para el calendario)
function _agendSalaScheduleSummary(salaId){
  const sala = _agendGetSala(salaId);
  if(!sala || !sala.schedule) return '';
  const dias = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
  const diasOpen = Object.keys(sala.schedule).map(Number).sort();
  if(!diasOpen.length) return '';
  if(sala.usesAmPmOnly){
    // Para salas AM/PM: lista los días abiertos sin horarios precisos
    const lista = diasOpen.map(d => dias[d]).join('·');
    return `${lista} · AM y PM`;
  }
  const parts = [];
  diasOpen.forEach(d => {
    const s = sala.schedule[d];
    parts.push(`${dias[d]} ${s.start}–${s.end}`);
  });
  return parts.join(' · ');
}
// Devuelve TODOS los pedidos activos de OTRAS salas que reservan tiempo
// (según blockedByOtherSalas), para ese día. Cada item: {salaId, sala, ...req}.
function _agendCrossBlocksForDay(salaId, dateStr){
  const sala = _agendGetSala(salaId);
  if(!sala || !sala.blockedByOtherSalas || !sala.blockedByOtherSalas.length) return [];
  const out = [];
  sala.blockedByOtherSalas.forEach(otherId => {
    const otra = _agendGetSala(otherId);
    if(!otra) return;
    const slots = _agendGetDaySlots(otherId, dateStr);
    slots.forEach(r => {
      if(r.estado === 'rechazada') return;
      out.push({ salaId: otherId, sala: otra, ...r });
    });
  });
  out.sort((a,b) => (a.startMin||0) - (b.startMin||0));
  return out;
}
// Busca solapamiento contra cross-blocks (otras salas que bloquean a esta).
function _agendFindCrossBlock(salaId, dateStr, startMin, endMin){
  const crossBlocks = _agendCrossBlocksForDay(salaId, dateStr);
  for(const r of crossBlocks){
    if(startMin < r.endMin && endMin > r.startMin) return r;
  }
  return null;
}

// --- Navegación / vistas ---
function _agendShowView(name, pushToStack){
  if(pushToStack && AGEND_STATE.view && AGEND_STATE.view !== name){
    AGEND_STATE.navStack.push(AGEND_STATE.view);
  }
  AGEND_STATE.view = name;
  document.querySelectorAll('#agendScreen .agend-view').forEach(v => {
    v.classList.toggle('active', v.getAttribute('data-view') === name);
  });
  document.querySelector('#agendScreen .agend-body').scrollTop = 0;
  // El chip de Admin se refresca en cada cambio de vista (siempre visible si mode='admin')
  if(typeof _agendRefreshAdminChip === 'function') _agendRefreshAdminChip();
}
function _agendSetTitle(title, sub){
  document.getElementById('agendTitle').textContent = title || 'Agendamiento';
  document.getElementById('agendSub').textContent = sub || '';
}
function _agendSetHeadAction(label, onclick){
  const btn = document.getElementById('agendHeadAction');
  if(!btn) return;
  if(label){
    btn.textContent = label;
    btn.classList.remove('hidden');
    btn._agendCb = onclick;
  } else {
    btn.classList.add('hidden');
    btn._agendCb = null;
  }
}
function agendHeadActionClick(){
  const btn = document.getElementById('agendHeadAction');
  if(btn && typeof btn._agendCb === 'function') btn._agendCb();
}
function agendBack(){
  if(AGEND_STATE.navStack.length){
    const prev = AGEND_STATE.navStack.pop();
    _agendShowView(prev, false);
    _agendRefreshChromeForView(prev);
    return;
  }
  // Sin stack → cerrar overlay
  agendCloseModule();
}
function agendCloseModule(){
  document.getElementById('agendScreen').classList.add('hidden');
  AGEND_STATE.view = null;
  AGEND_STATE.navStack = [];
  // Limpiar modo Admin al cerrar el módulo (no se persiste entre aperturas)
  if(AGEND_STATE.mode === 'admin'){
    AGEND_STATE.mode = null;
    AGEND_STATE.staffNombre = '';
  }
  showModulesScreen();
}
function _agendRefreshChromeForView(view){
  // Mostrar/ocultar chip de Admin en TODAS las vistas si la sesión está activa
  _agendRefreshAdminChip();
  // Mostrar/ocultar banner de Admin en la vista landing
  _agendRefreshLandingForAdmin();
  if(view === 'landing') {
    if(AGEND_STATE.mode === 'admin'){
      _agendSetTitle('Modo Administrador', AGEND_STATE.staffNombre || '');
    } else {
      _agendSetTitle('Agendamiento de procedimientos','');
    }
    _agendSetHeadAction(null);
  } else if(view === 'unidadLogin'){
    _agendSetTitle('Identificación de unidad','');
    _agendSetHeadAction(null);
  } else if(view === 'salas'){
    if(AGEND_STATE.mode === 'admin'){
      _agendSetTitle('Panel Anestesia · Salas', AGEND_STATE.staffNombre ? AGEND_STATE.staffNombre : '');
      _agendSetHeadAction('Solicitudes', () => agendShowOverview('pendiente'));
    } else {
      const u = _agendGetUnidad(AGEND_STATE.unidadCode);
      _agendSetTitle('Salas disponibles', u ? u.name : '');
      _agendSetHeadAction('Salir', () => agendLogoutUnidad());
    }
  } else if(view === 'overview'){
    _agendSetTitle('Bandeja de solicitudes', AGEND_STATE.mode === 'admin' ? (AGEND_STATE.staffNombre || 'Admin') : '');
    _agendSetHeadAction('Salas', () => agendShowSalasView());
  } else if(view === 'seguimiento'){
    _agendSetTitle('Seguimiento de solicitudes','Estado de las solicitudes enviadas');
    _agendSetHeadAction(null);
  }
}

function _agendRefreshAdminChip(){
  const chip = document.getElementById('agendAdminChip');
  const chipName = document.getElementById('agendAdminChipName');
  if(!chip) return;
  if(AGEND_STATE.mode === 'admin'){
    chip.classList.remove('hidden');
    if(chipName) chipName.textContent = AGEND_STATE.staffNombre || 'Admin';
  } else {
    chip.classList.add('hidden');
  }
}

function _agendRefreshLandingForAdmin(){
  const banner = document.getElementById('agendLandingAdminBanner');
  const bannerName = document.getElementById('agendAdminBannerName');
  const ctas = document.getElementById('agendLandingCtas');
  if(!banner) return;
  if(AGEND_STATE.mode === 'admin'){
    banner.style.display = 'block';
    if(bannerName) bannerName.textContent = AGEND_STATE.staffNombre || 'Anestesia';
    // Ocultar las CTAs originales (solicitar / visar) — el banner ya tiene las acciones de Admin
    if(ctas) ctas.style.display = 'none';
    const title = document.getElementById('agendLandingTitle');
    const sub = document.getElementById('agendLandingSub');
    if(title) title.style.display = 'none';
    if(sub) sub.style.display = 'none';
  } else {
    banner.style.display = 'none';
    if(ctas) ctas.style.display = '';
    const title = document.getElementById('agendLandingTitle');
    const sub = document.getElementById('agendLandingSub');
    if(title) title.style.display = '';
    if(sub) sub.style.display = '';
  }
}

function agendSalirAdminConfirm(){
  if(!confirm('¿Salir del modo Administrador?\n\nVas a volver al inicio del módulo Agendamiento. Tu sesión de Staff principal seguirá activa.')) return;
  AGEND_STATE.mode = null;
  AGEND_STATE.staffNombre = '';
  AGEND_STATE.navStack = [];
  _agendShowView('landing', false);
  _agendRefreshChromeForView('landing');
}

// --- Apertura / cierre del módulo ---
function openAgendamientoModule(opts){
  // opts.vasc = true → contexto Portal Vascular (solo salas vasculares).
  AGEND_STATE.vascOnly = !!(opts && opts.vasc);
  const mod = document.getElementById('modulesScreen');
  if(mod) mod.classList.add('hidden');
  const ov = document.getElementById('agendScreen');
  if(ov) ov.classList.remove('hidden');
  // Migrar al vuelo cualquier data en formato antiguo (hora-keyed) a la nueva
  // estructura de array con startMin/endMin. Idempotente.
  try { _agendEnsureMigratedAndSave(); } catch(e){ console.warn('migración v38 falló', e); }
  // Bajar las solicitudes de la nube y refrescar la vista activa al terminar
  try {
    agendSyncNow().then(()=>{
      const v = AGEND_STATE.view;
      try{
        if(v === 'calendario') agendRenderCalendario();
        else if(v === 'dia' && AGEND_STATE.selectedDate) agendOpenDia(AGEND_STATE.selectedDate);
        else if(v === 'overview') agendOverviewTab(AGEND_STATE.overviewTab);
      }catch(e){}
    });
  } catch(e){}
  AGEND_STATE.navStack = [];
  AGEND_STATE.mode = null;
  AGEND_STATE.unidadCode = null;
  AGEND_STATE.solicitanteNombre = '';
  AGEND_STATE.solicitanteTel = '';
  AGEND_STATE.solicitanteEmail = '';
  // Restaurar sesión si existe
  const sess = agendLoadSession();
  if(sess && sess.tipo === 'unidad' && sess.unidadCode){
    AGEND_STATE.mode = 'unidad';
    AGEND_STATE.unidadCode = sess.unidadCode;
    AGEND_STATE.solicitanteNombre = sess.nombre || '';
    AGEND_STATE.solicitanteTel = sess.tel || '';
    AGEND_STATE.solicitanteEmail = sess.email || '';
    agendEntrarASalaDeUnidad();
    return;
  }
  // Sin sesión → landing
  _agendShowView('landing', false);
  _agendRefreshChromeForView('landing');
}

// --- Landing → unidadLogin ---
function agendGoToUnidadLogin(){
  _agendShowView('unidadLogin', true);
  _agendRefreshChromeForView('unidadLogin');
  _agendRenderUnidadGrid();
  // Reset selection
  document.getElementById('agendUnidadFormBlock').classList.add('hidden');
  document.getElementById('agendUnidadPin').value = '';
  document.getElementById('agendUnidadNombre').value = '';
  document.getElementById('agendUnidadTel').value = '';
  AGEND_STATE._tempUnidadCode = null;
}
function _agendRenderUnidadGrid(){
  const cont = document.getElementById('agendUnidadGrid');
  if(!cont) return;
  cont.innerHTML = AGEND_UNIDADES.map(u => `
    <button type="button" class="agend-unidad-card" data-code="${u.code}" onclick="agendSelectUnidad('${u.code}')">
      <span class="agend-unidad-ico">${u.ico}</span>
      <div class="agend-unidad-name">${u.name}</div>
    </button>`).join('');
}
function agendSelectUnidad(code){
  AGEND_STATE._tempUnidadCode = code;
  document.querySelectorAll('#agendUnidadGrid .agend-unidad-card').forEach(c => {
    c.classList.toggle('selected', c.getAttribute('data-code') === code);
  });
  document.getElementById('agendUnidadFormBlock').classList.remove('hidden');
  setTimeout(() => document.getElementById('agendUnidadPin').focus(), 80);
}
function agendUnidadDoLogin(){
  const code = AGEND_STATE._tempUnidadCode;
  if(!code){ alert('Selecciona una unidad primero.'); return; }
  const pin = document.getElementById('agendUnidadPin').value.trim();
  const nom = document.getElementById('agendUnidadNombre').value.trim();
  const tel = document.getElementById('agendUnidadTel').value.trim();
  const emailEl = document.getElementById('agendUnidadEmail');
  const email = emailEl ? emailEl.value.trim() : '';
  if(pin !== AGEND_DEFAULT_PIN){ alert('PIN incorrecto. (PIN inicial: 1234)'); return; }
  if(!nom){ alert('Ingresa el nombre del solicitante.'); return; }
  if(!email){ alert('Ingresa un correo de contacto. Es necesario para recibir la confirmación del agendamiento.'); return; }
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
    alert('El correo de contacto no tiene un formato válido.'); return;
  }
  AGEND_STATE.mode = 'unidad';
  AGEND_STATE.unidadCode = code;
  AGEND_STATE.solicitanteNombre = nom;
  AGEND_STATE.solicitanteTel = tel;
  AGEND_STATE.solicitanteEmail = email;
  agendSaveSession({ tipo:'unidad', unidadCode:code, nombre:nom, tel, email });
  // Limpiar navStack porque venimos de un login
  AGEND_STATE.navStack = [];
  agendEntrarASalaDeUnidad();
}

// Tras identificarse, la unidad entra DIRECTO a su sala asociada (si tiene una).
// "Volver" desde el calendario lleva al listado de salas por si necesita otra.
function agendEntrarASalaDeUnidad(){
  // Portal Vascular: entra directo a la (única) sala vascular.
  if(AGEND_STATE.vascOnly){
    const vs = AGEND_SALAS.filter(s => s.vascular);
    agendShowSalasView();
    if(vs.length === 1) agendOpenSala(vs[0].id);
    return;
  }
  const u = _agendGetUnidad(AGEND_STATE.unidadCode);
  // Si la sala asociada es vascular, NO auto-entrar en el agendamiento general
  // (esa sala vive en el Portal Vascular). Muestra la lista general.
  const uSala = u && u.salaId ? _agendGetSala(u.salaId) : null;
  if(AGEND_STATE.mode === 'unidad' && uSala && !uSala.vascular){
    agendShowSalasView();        // queda como base del stack para "Volver"
    agendOpenSala(u.salaId);     // y entra directo al calendario de SU sala
  } else {
    agendShowSalasView();
  }
}
function agendLogoutUnidad(){
  if(!confirm('¿Cerrar la sesión de tu unidad?')) return;
  agendSaveSession(null);
  AGEND_STATE.mode = null;
  AGEND_STATE.unidadCode = null;
  AGEND_STATE.solicitanteNombre = '';
  AGEND_STATE.solicitanteTel = '';
  AGEND_STATE.solicitanteEmail = '';
  AGEND_STATE.navStack = [];
  _agendShowView('landing', false);
  _agendRefreshChromeForView('landing');
}

// --- Acceso modo Admin ---
async function agendGoToAdmin(){
  // Helper interno: entra a modo admin con el nombre indicado
  const _entrar = (nombre) => {
    AGEND_STATE.mode = 'admin';
    AGEND_STATE.staffNombre = nombre || 'Administrador';
    AGEND_STATE.navStack = [];
    agendShowSalasView();
  };

  // 1) Si la sesión actual en la app principal YA es Administrador → entrar directo
  const u = (typeof getCurrentUser === 'function') ? getCurrentUser() : null;
  if(u && state && state.currentUserId === ADMIN_USER_ID){
    _entrar(u.displayName || u.name || 'Administrador');
    return;
  }

  // 2) Si NO hay PIN de admin configurado todavía → revisar primero la nube
  if(typeof adminSetupNeeded === 'function' && adminSetupNeeded()){
    try{ await _syncAdminPinFromCloud(); }catch(e){}
  }
  if(typeof adminSetupNeeded === 'function' && adminSetupNeeded()){
    alert('Aún no hay un PIN de Administrador configurado.\n\nEntra a la pantalla principal → Staff → Administrador para crearlo (4 dígitos). Después puedes volver a "Visar Solicitudes" y desbloquearlo desde aquí.');
    return;
  }

  // 3) Pedir el PIN de Admin in-place, sin salir del módulo Agendamiento
  let ok = false;
  try {
    ok = await promptVerifyAdminPin();
  } catch(e){
    console.warn('promptVerifyAdminPin falló', e);
    ok = false;
  }
  if(!ok) return; // canceló o pulsó Atrás

  // 4) Conceder modo admin. Si hay un staff logueado, usar su nombre para auditoría.
  //    Si no, usar "Administrador".
  let nombre = 'Administrador';
  if(u){
    nombre = u.displayName || u.name || nombre;
  }
  _entrar(nombre);
}

// --- Vista: Salas ---
function agendShowSalasView(){
  const prev = AGEND_STATE.view;
  // Si el admin viene desde landing u overview, empujar al stack para que 'Volver' lo lleve ahí.
  // En modo unidad, salas es el "home" → no empujar.
  const shouldPush = AGEND_STATE.mode === 'admin'
                     && prev && prev !== 'salas'
                     && (prev === 'landing' || prev === 'overview');
  _agendShowView('salas', shouldPush);
  _agendRefreshChromeForView('salas');
  const cont = document.getElementById('agendSalaList');
  if(!cont) return;
  // Portal Vascular: solo salas vasculares. Agendamiento general: solo NO vasculares.
  const salas = AGEND_SALAS.filter(s => AGEND_STATE.vascOnly ? !!s.vascular : !s.vascular);
  cont.innerHTML = salas.map(s => `
    <button type="button" class="agend-sala-card" onclick="agendOpenSala('${s.id}')">
      <div class="agend-sala-ico" style="background:${s.color}">${s.ico}</div>
      <div class="agend-sala-body">
        <div class="agend-sala-name">${s.name}</div>
        <div class="agend-sala-desc">${s.desc}</div>
      </div>
      <div class="agend-sala-arrow">›</div>
    </button>`).join('');
}

// --- Vista: Calendario ---
function agendOpenSala(salaId){
  AGEND_STATE.salaId = salaId;
  const d = new Date();
  AGEND_STATE.calYear = d.getFullYear();
  AGEND_STATE.calMonth = d.getMonth();
  _agendShowView('calendario', true);
  const s = _agendGetSala(salaId);
  _agendSetTitle(s ? s.name : 'Calendario', AGEND_STATE.mode === 'admin' ? 'Modo Admin' : (_agendGetUnidad(AGEND_STATE.unidadCode)||{}).name || '');
  if(AGEND_STATE.mode === 'admin'){
    _agendSetHeadAction('🚫 Cierres', () => agendGestionarCierre());
  } else {
    _agendSetHeadAction(null);
  }
  // Traer cierres manuales desde la nube y repintar cuando lleguen
  try{ agendCfgSyncNow().then(ok => { if(ok && AGEND_STATE.view === 'calendario') agendRenderCalendario(); }); }catch(e){}
  // Pintar resumen de horario de la sala arriba del grid (si existe el contenedor)
  const sumEl = document.getElementById('agendCalScheduleSummary');
  if(sumEl){
    const resumen = _agendSalaScheduleSummary(salaId);
    sumEl.innerHTML = resumen
      ? `<span class="agend-cal-sched-label">Horario habitual</span> <span class="agend-cal-sched-value">${resumen}</span>`
      : '';
    sumEl.style.display = resumen ? '' : 'none';
  }
  agendRenderCalendario();
}
function agendNavMonth(delta){
  let m = AGEND_STATE.calMonth + delta;
  let y = AGEND_STATE.calYear;
  if(m < 0){ m = 11; y--; }
  if(m > 11){ m = 0; y++; }
  AGEND_STATE.calMonth = m;
  AGEND_STATE.calYear = y;
  agendRenderCalendario();
}
function agendRenderCalendario(){
  const y = AGEND_STATE.calYear, m = AGEND_STATE.calMonth;
  const title = document.getElementById('agendCalTitle');
  if(title) title.textContent = `${_agendMesesES[m]} ${y}`;
  const grid = document.getElementById('agendCalGrid');
  if(!grid) return;
  const firstDow = new Date(y, m, 1).getDay(); // 0=domingo
  const offset = (firstDow + 6) % 7; // L=0, M=1, ... D=6
  const daysInMonth = new Date(y, m+1, 0).getDate();
  const todayStr = _agendTodayStr();
  const sala = _agendGetSala(AGEND_STATE.salaId);
  const allowsExtra = !!(sala && sala.allowsExtra);
  // Primer día agendable por agenda regular (lead-time): los días anteriores
  // quedan "muy pronto" para la unidad (solo Extra).
  const _dl = _agendLeadTimeDeadline(AGEND_STATE.salaId);
  const deadlineDs = _agendDateStr(_dl.getFullYear(), _dl.getMonth(), _dl.getDate());
  let html = '';
  for(let i=0; i<offset; i++) html += `<div class="agend-cal-day empty"></div>`;
  for(let d=1; d<=daysInMonth; d++){
    const ds = _agendDateStr(y, m, d);
    const counts = _agendCountDay(AGEND_STATE.salaId, ds);
    const isPast = (ds < todayStr);
    const isToday = (ds === todayStr);
    const isOpen = _agendIsDayOpenForSala(AGEND_STATE.salaId, ds);
    const isClosed = _agendIsClosedDate(ds);
    const isTooSoon = (ds < deadlineDs); // todo el día cae dentro del lead-time
    let badge = '';
    if(counts.total > 0){
      let cls = 'bd-pend', txt = `${counts.total}`;
      if(counts.pend === 0 && counts.aprob > 0) cls = 'bd-aprob';
      else if(counts.pend > 0 && counts.aprob > 0) cls = 'bd-mix';
      badge = `<div class="agend-cal-badge ${cls}">${txt}</div>`;
    }
    const cls = ['agend-cal-day'];
    if(isToday) cls.push('today');
    if(isPast) cls.push('past');
    if(!isOpen || isClosed) cls.push('closed');
    if(isTooSoon && !isPast && !isClosed && isOpen) cls.push('toosoon');
    // Lógica de click:
    //   pasado → sin handler
    //   unidad + día cerrado → solo Extra (si la sala lo permite)
    //   "muy pronto" queda clicable: el envío bloquea solo las electivas
    //     (las urgentes <24h pueden agendarse igual)
    //   abierto → agendOpenDia normal
    //   admin → puede entrar a revisar/visar (incl. feriados en día hábil)
    const blockRegularUnit = (AGEND_STATE.mode === 'unidad') && isClosed;
    let handler = '';
    if(!isPast){
      if(blockRegularUnit){
        if(allowsExtra){
          handler = `onclick="agendOfrecerExtraDesdeCal('${ds}')"`;
          cls.push('extra-allowed');
        }
        // sin Extra → día no agendable para la unidad (sin handler)
      } else if(isOpen){
        handler = `onclick="agendOpenDia('${ds}')"`;
      } else if(allowsExtra && AGEND_STATE.mode === 'unidad'){
        handler = `onclick="agendOfrecerExtraDesdeCal('${ds}')"`;
        cls.push('extra-allowed');
      } else if(AGEND_STATE.mode === 'admin' && (allowsExtra || isClosed)){
        // Admin puede igual entrar al día para revisar
        handler = `onclick="agendOpenDia('${ds}')"`;
      }
    }
    const titleAttr = isClosed ? ` title="${_gpEsc(_agendClosureLabel(ds))}"` : '';
    html += `<button type="button" class="${cls.join(' ')}"${titleAttr} ${handler}><div class="agend-cal-d">${d}</div>${badge}</button>`;
  }
  grid.innerHTML = html;
}

// Cuando una unidad hace click en un día cerrado de una sala que permite Extra
function agendOfrecerExtraDesdeCal(dateStr){
  const sala = _agendGetSala(AGEND_STATE.salaId);
  if(!sala) return;
  const dt = _agendParseDateStr(dateStr);
  const dayName = _agendDiasES[dt.getDay()];
  const fmt = `${dayName.charAt(0).toUpperCase()+dayName.slice(1)} ${dt.getDate()} de ${_agendMesesES[dt.getMonth()]}`;
  let motivo;
  if(_agendIsClosedDate(dateStr)){
    motivo = `El ${fmt} está cerrado (${_agendClosureLabel(dateStr)}).`;
  } else if(_agendSlotDatetime(dateStr, AGEND_DAY_END_MIN).getTime() < _agendLeadTimeDeadline(AGEND_STATE.salaId).getTime()){
    motivo = `El ${fmt} está dentro de las ${_agendLeadTimeHours(AGEND_STATE.salaId)} h hábiles de anticipación mínima para agenda regular.`;
  } else {
    motivo = `${sala.name} no tiene agenda regular el ${fmt}.`;
  }
  const ok = confirm(
    `${motivo}\n\n`+
    `Puedes solicitar un Agendamiento EXTRA para ese día. `+
    `Requerirá visado del administrador.\n\n`+
    `¿Continuar con Agendamiento Extra?`
  );
  if(!ok) return;
  AGEND_STATE.selectedDate = dateStr;
  agendOpenFormExtra(dateStr);
}

// --- Vista: Día (slots) ---
function agendOpenDia(dateStr){
  AGEND_STATE.selectedDate = dateStr;
  _agendShowView('dia', true);
  const sala = _agendGetSala(AGEND_STATE.salaId);
  const dt = _agendParseDateStr(dateStr);
  const dayName = _agendDiasES[dt.getDay()];
  const fmt = `${dayName.charAt(0).toUpperCase()+dayName.slice(1)} ${dt.getDate()} de ${_agendMesesES[dt.getMonth()]} ${dt.getFullYear()}`;
  _agendSetTitle(fmt, sala ? sala.name : '');
  _agendSetHeadAction(null);
  // Horario per-sala para este día (null si está cerrada y no es admin)
  const salaHrs = _agendSalaHoursForDate(AGEND_STATE.salaId, dateStr);
  const isAmPmSala = !!(sala && sala.usesAmPmOnly);
  let horarioTxt;
  if(isAmPmSala){
    horarioTxt = salaHrs ? 'Bloques AM / PM' : 'Sala cerrada este día';
  } else if(salaHrs){
    horarioTxt = `Horario ${_agendFmtRange(salaHrs.startMin, salaHrs.endMin)}`;
  } else {
    horarioTxt = `Sala cerrada este día`;
    if(sala && sala.allowsExtra) horarioTxt += ' · solo Agendamiento Extra';
  }
  // Render header
  const head = document.getElementById('agendDayHead');
  if(head){
    head.innerHTML = `
      <div class="agend-day-head-ico" style="background:${sala?sala.color:'#16a34a'}">${sala?sala.ico:'📅'}</div>
      <div class="agend-day-head-body">
        <div class="agend-day-head-date">${fmt}</div>
        <div class="agend-day-head-sala">${sala?sala.name:''} · ${horarioTxt}</div>
      </div>`;
  }
  agendRenderSlots();
}
function agendRenderSlots(){
  const cont = document.getElementById('agendSlots');
  if(!cont) return;
  const salaId = AGEND_STATE.salaId;
  const dateStr = AGEND_STATE.selectedDate;
  const sala = _agendGetSala(salaId);

  // SALAS AM/PM: render alternativo (lista por bloque AM y PM)
  if(sala && sala.usesAmPmOnly){
    return _agendRenderSlotsAmPm(cont, sala, salaId, dateStr);
  }

  // Horas hábiles per-sala para este día. Si está cerrado:
  //   - admin: usamos jornada por defecto (08-20) para poder visar Extras
  //   - unidad: solo se llega acá si es Extra (caso especial), o no debería
  const salaHrs = _agendSalaHoursForDate(salaId, dateStr);
  const dayStart = salaHrs ? salaHrs.startMin : AGEND_DAY_START_MIN;
  const dayEnd   = salaHrs ? salaHrs.endMin   : AGEND_DAY_END_MIN;

  // Solicitudes propias de la sala
  const todas = _agendGetDaySlots(salaId, dateStr);
  const activas   = todas.filter(r => r.estado !== 'rechazada')
                         .sort((a,b) => a.startMin - b.startMin);
  const rechazadas = todas.filter(r => r.estado === 'rechazada')
                         .sort((a,b) => a.startMin - b.startMin);

  // Cross-blocks: pedidos activos de otras salas que reservan estos minutos
  // (ej: Endo/Imagenología reservan a Neurología/Oncología/MedComp)
  const crossBlocks = _agendCrossBlocksForDay(salaId, dateStr);

  let html = '';

  // Aviso de cierre + ofrecer Extra
  if(!salaHrs){
    if(sala && sala.allowsExtra){
      html += `
        <div class="agend-day-section">Sala cerrada este día</div>
        <div class="agend-day-closed-note">
          ${sala.name} no tiene agenda regular este día. Puedes solicitar un
          <b>Agendamiento Extra</b> (requiere visado del administrador).
        </div>
        <button type="button" class="agend-slot extra-cta" onclick="agendOpenFormExtra('${dateStr}')">
          <div class="agend-slot-body">
            <div class="agend-slot-name">+ Agendamiento Extra</div>
            <div class="agend-slot-proc">Elige hora y duración libremente</div>
          </div>
        </button>`;
    } else {
      html += `
        <div class="agend-day-section">Sala cerrada este día</div>
        <div class="agend-day-closed-note">
          ${sala?sala.name:'Esta sala'} no atiende este día. Elige otro día del calendario.
        </div>`;
    }
    cont.innerHTML = html;
    return;
  }

  // Render entrelazado: hueco libre, ocupado/bloqueado, hueco libre, ...
  // Fusionamos pedidos propios + cross-blocks en una sola lista ordenada por start.
  const allowsParallelExtra = !!(sala && sala.allowsParallelExtra);
  const ocupados = [];
  for(const r of activas){
    ocupados.push({
      kind: 'own',
      startMin: r.startMin,
      endMin: r.endMin,
      req: r
    });
  }
  for(const cb of crossBlocks){
    ocupados.push({
      kind: 'cross',
      startMin: cb.startMin,
      endMin: cb.endMin,
      cross: cb
    });
  }
  ocupados.sort((a,b) => (a.startMin||0) - (b.startMin||0));

  const renderLibre = (startMin, endMin) => {
    if(endMin <= startMin) return '';
    const dur = endMin - startMin;
    const horas = Math.floor(dur/60), mins = dur%60;
    const durStr = horas>0
      ? (mins>0 ? `${horas} h ${mins} min` : `${horas} h`)
      : `${mins} min`;
    return `
      <button type="button" class="agend-slot libre" onclick="agendOpenFormForRange('${_agendMinToHHMM(startMin)}','${_agendMinToHHMM(endMin)}')">
        <div class="agend-slot-hour">${_agendMinToHHMM(startMin)}</div>
        <div class="agend-slot-body">
          <span class="agend-slot-libre-text">Libre · ${_agendFmtRange(startMin,endMin)} <span style="color:#9ca3af">(${durStr})</span></span>
        </div>
        <div class="agend-slot-libre-cta">+ Solicitar</div>
      </button>`;
  };
  const renderOcup = (r) => {
    const est = r.estado || 'pendiente';
    const unidad = _agendGetUnidad(r.unidadCode);
    const extraBadge = r.isExtra ? `<span class="agend-extra-pill">EXTRA</span>` : '';
    return `
      <button type="button" class="agend-slot ${est}" onclick="agendOpenDetalle('${r.id}')">
        <div class="agend-slot-hour">${_agendMinToHHMM(r.startMin)}</div>
        <div class="agend-slot-body">
          <div class="agend-slot-name">${_gpEsc(r.paciente)}${r.edad?` · ${_gpEsc(String(r.edad))} a.`:''} ${extraBadge}</div>
          <div class="agend-slot-proc">${_gpEsc(r.procedimiento)}</div>
          <div class="agend-slot-meta">⏱ ${_agendFmtRange(r.startMin, r.endMin)} · ${unidad?unidad.ico+' '+_gpEsc(unidad.name):''} · ${_gpEsc(r.solicitanteNombre||'')}</div>
        </div>
        <div class="agend-slot-status ${est}">${est}</div>
      </button>`;
  };
  const renderCross = (cb) => {
    const otraSala = cb.sala;
    return `
      <div class="agend-slot crossblock">
        <div class="agend-slot-hour">${_agendMinToHHMM(cb.startMin)}</div>
        <div class="agend-slot-body">
          <div class="agend-slot-name">⛔ Reservado por ${otraSala?otraSala.name:'otra sala'}</div>
          <div class="agend-slot-proc">${_gpEsc(cb.procedimiento||'')}</div>
          <div class="agend-slot-meta">⏱ ${_agendFmtRange(cb.startMin, cb.endMin)} · Bloquea esta sala</div>
        </div>
        <div class="agend-slot-status crossblock">bloqueado</div>
      </div>`;
  };

  let cursor = dayStart;
  for(const o of ocupados){
    const start = Math.max(o.startMin, dayStart);
    const end   = Math.min(o.endMin,   dayEnd);
    if(start > cursor){
      html += renderLibre(cursor, start);
    }
    if(o.kind === 'own'){
      html += renderOcup(o.req);
    } else {
      html += renderCross(o.cross);
    }
    if(end > cursor) cursor = end;
  }
  if(cursor < dayEnd){
    html += renderLibre(cursor, dayEnd);
  }

  // Botón de Agendamiento Extra para esta sala (si lo permite y modo unidad)
  if(sala && sala.allowsExtra && AGEND_STATE.mode === 'unidad'){
    const hint = allowsParallelExtra
      ? 'Agendar en paralelo a otros pedidos (requiere visado)'
      : 'Agendar fuera del horario o sumando capacidad (requiere visado)';
    html += `
      <div class="agend-day-section">Agendamiento Extra</div>
      <button type="button" class="agend-slot extra-cta" onclick="agendOpenFormExtra('${dateStr}')">
        <div class="agend-slot-body">
          <div class="agend-slot-name">+ Solicitar Agendamiento Extra</div>
          <div class="agend-slot-proc">${hint}</div>
        </div>
      </button>`;
  }

  // Rechazadas al final (informativas, no bloquean)
  if(rechazadas.length){
    html += `<div class="agend-day-section">Solicitudes rechazadas</div>`;
    for(const r of rechazadas) html += renderOcup(r);
  }

  cont.innerHTML = html;
}

// Render alternativo para salas AM/PM (Accesos Vasculares)
function _agendRenderSlotsAmPm(cont, sala, salaId, dateStr){
  const isOpen = _agendIsDayOpenForSala(salaId, dateStr);
  const todas = _agendGetDaySlots(salaId, dateStr);
  const activas    = todas.filter(r => r.estado !== 'rechazada');
  const rechazadas = todas.filter(r => r.estado === 'rechazada');
  const ofAM = activas.filter(r => _agendBlockOfSlot(r) === 'AM').sort((a,b) => (a.createdAt||0)-(b.createdAt||0));
  const ofPM = activas.filter(r => _agendBlockOfSlot(r) === 'PM').sort((a,b) => (a.createdAt||0)-(b.createdAt||0));

  const renderReq = (r) => {
    const est = r.estado || 'pendiente';
    const unidad = _agendGetUnidad(r.unidadCode);
    return `
      <button type="button" class="agend-slot ${est}" onclick="agendOpenDetalle('${r.id}')">
        <div class="agend-slot-body">
          <div class="agend-slot-name">${_gpEsc(r.paciente)}${r.edad?` · ${_gpEsc(String(r.edad))} a.`:''}</div>
          <div class="agend-slot-proc">${_gpEsc(r.procedimiento)}</div>
          <div class="agend-slot-meta">${unidad?unidad.ico+' '+_gpEsc(unidad.name):''} · ${_gpEsc(r.solicitanteNombre||'')}</div>
        </div>
        <div class="agend-slot-status ${est}">${est}</div>
      </button>`;
  };

  let html = '';
  if(!isOpen){
    html += `
      <div class="agend-day-section">Sala cerrada este día</div>
      <div class="agend-day-closed-note">
        ${sala.name} no recibe solicitudes este día. Elige otro día del calendario.
      </div>`;
    cont.innerHTML = html;
    return;
  }
  const showCtaAM = AGEND_STATE.mode === 'unidad';
  const showCtaPM = AGEND_STATE.mode === 'unidad';
  // Bloque AM
  html += `<div class="agend-day-section">Bloque AM <span class="agend-ampm-pill">08:00–14:00</span></div>`;
  if(ofAM.length) ofAM.forEach(r => html += renderReq(r));
  else html += `<div class="agend-day-closed-note" style="opacity:.75">Sin solicitudes en el bloque AM.</div>`;
  if(showCtaAM){
    html += `
      <button type="button" class="agend-slot libre" onclick="_agendOpenFormBlock('${dateStr}','AM')">
        <div class="agend-slot-body">
          <span class="agend-slot-libre-text">+ Solicitar acceso vascular en bloque AM</span>
        </div>
        <div class="agend-slot-libre-cta">+ Solicitar</div>
      </button>`;
  }
  // Bloque PM
  html += `<div class="agend-day-section">Bloque PM <span class="agend-ampm-pill">14:00–20:00</span></div>`;
  if(ofPM.length) ofPM.forEach(r => html += renderReq(r));
  else html += `<div class="agend-day-closed-note" style="opacity:.75">Sin solicitudes en el bloque PM.</div>`;
  if(showCtaPM){
    html += `
      <button type="button" class="agend-slot libre" onclick="_agendOpenFormBlock('${dateStr}','PM')">
        <div class="agend-slot-body">
          <span class="agend-slot-libre-text">+ Solicitar acceso vascular en bloque PM</span>
        </div>
        <div class="agend-slot-libre-cta">+ Solicitar</div>
      </button>`;
  }
  // Rechazadas al final
  if(rechazadas.length){
    html += `<div class="agend-day-section">Solicitudes rechazadas</div>`;
    for(const r of rechazadas) html += renderReq(r);
  }
  cont.innerHTML = html;
}

// Abrir formulario en sala AM/PM con bloque preseleccionado
function _agendOpenFormBlock(dateStr, block){
  if(AGEND_STATE.mode !== 'unidad'){
    alert('Para solicitar entra como Unidad solicitante.');
    return;
  }
  AGEND_STATE.selectedDate = dateStr;
  AGEND_STATE.formBlock = (block === 'PM') ? 'PM' : 'AM';
  // Pasamos cualquier HHMM — agendOpenFormForRange detecta AM/PM por la sala
  agendOpenFormForRange('08:00','09:00');
  // Forzar bloque elegido (override del default)
  if(typeof _agendSelectBlock === 'function') _agendSelectBlock(AGEND_STATE.formBlock);
}

// --- Vista: Form solicitud ---
// Helper interno: rellena ambos selectores y elige defaults razonables.
// Si es Extra (rangeMin/rangeMax dados) → usa rango completo 08:00–20:00 con paso de 30 min.
// Si es regular → usa el horario per-sala para el día seleccionado.
function _agendFillTimeSelects(defaultStartMin, defaultEndMin, opts){
  opts = opts || {};
  const selStart = document.getElementById('afHoraInicio');
  const selEnd   = document.getElementById('afHoraFin');
  if(!selStart || !selEnd) return;
  let rangeStart = AGEND_DAY_START_MIN, rangeEnd = AGEND_DAY_END_MIN;
  if(opts.useFullDay){
    // Extra: rango completo 08:00–20:00
    rangeStart = AGEND_DAY_START_MIN;
    rangeEnd   = AGEND_DAY_END_MIN;
  } else {
    // Regular: tomar horas de la sala para esta fecha
    const hrs = _agendSalaHoursForDate(AGEND_STATE.salaId, AGEND_STATE.selectedDate);
    if(hrs){ rangeStart = hrs.startMin; rangeEnd = hrs.endMin; }
  }
  const all = _agendTimeOptions(); // 08:00–20:00 paso 30
  const opcs = all.filter(o => {
    const m = _agendHHMMToMin(o.value);
    return m >= rangeStart && m <= rangeEnd;
  });
  if(opcs.length < 2){
    // Fallback: usar todo el día si por error el rango quedó muy chico
    selStart.innerHTML = all.slice(0, -1).map(o => `<option value="${o.value}">${o.label}</option>`).join('');
    selEnd.innerHTML   = all.slice(1).map(o => `<option value="${o.value}">${o.label}</option>`).join('');
  } else {
    selStart.innerHTML = opcs.slice(0, -1).map(o => `<option value="${o.value}">${o.label}</option>`).join('');
    selEnd.innerHTML   = opcs.slice(1).map(o => `<option value="${o.value}">${o.label}</option>`).join('');
  }
  // Clamp defaults al rango disponible
  let ds = Math.max(defaultStartMin, rangeStart);
  let de = Math.min(defaultEndMin, rangeEnd);
  if(de <= ds) de = Math.min(ds + AGEND_SLOT_GRANULARITY_MIN, rangeEnd);
  selStart.value = _agendMinToHHMM(ds);
  selEnd.value   = _agendMinToHHMM(de);
}

// Llamado al hacer click en un hueco libre del día (con rango sugerido)
function agendOpenFormForRange(startHHMM, endHHMM){
  if(AGEND_STATE.mode !== 'unidad'){
    alert('Para solicitar un agendamiento entra como Unidad solicitante.\nVuelve al inicio del módulo Agendamiento → "Solicitar agendamiento".');
    return;
  }
  const sala = _agendGetSala(AGEND_STATE.salaId);
  const isAmPm = !!(sala && sala.usesAmPmOnly);

  let startMin, endMin;
  if(isAmPm){
    // Para salas AM/PM, ignoramos el HHMM y elegimos AM por defecto
    const rng = _agendBlockRange('AM');
    startMin = rng.startMin;
    endMin = rng.endMin;
    AGEND_STATE.formBlock = 'AM';
  } else {
    startMin = _agendHHMMToMin(startHHMM) ?? AGEND_DAY_START_MIN;
    const endMinHueco = _agendHHMMToMin(endHHMM) ?? AGEND_DAY_END_MIN;
    // Default: 1 hora desde el inicio (o el hueco entero si es menor)
    endMin = Math.min(startMin + 60, endMinHueco);
    if(endMin <= startMin) endMin = Math.min(startMin + AGEND_SLOT_GRANULARITY_MIN, AGEND_DAY_END_MIN);
    AGEND_STATE.formBlock = null;
  }
  AGEND_STATE.formStartMin = startMin;
  AGEND_STATE.formEndMin   = endMin;
  AGEND_STATE.formIsExtra  = false;
  _agendShowView('form', true);
  const dt = _agendParseDateStr(AGEND_STATE.selectedDate);
  const horarioTxt = isAmPm ? _agendBlockLabel('AM') : _agendFmtRange(startMin, endMin);
  const fmt = `${dt.getDate()} de ${_agendMesesES[dt.getMonth()]} · ${horarioTxt}`;
  _agendSetTitle('Nueva solicitud', fmt);
  _agendSetHeadAction(null);
  const head = document.getElementById('agendFormHead');
  if(head){
    head.innerHTML = `
      <div class="agend-day-head-ico" style="background:${sala?sala.color:'#16a34a'}">${sala?sala.ico:'📅'}</div>
      <div class="agend-day-head-body">
        <div class="agend-day-head-date">${fmt}</div>
        <div class="agend-day-head-sala">${sala?sala.name:''}</div>
      </div>`;
  }
  // Reset form
  document.getElementById('afPaciente').value = '';
  document.getElementById('afEdad').value = '';
  document.getElementById('afRut').value = '';
  document.getElementById('afNotas').value = '';
  { const _p=document.getElementById('afPieza'); if(_p) _p.value=''; const _u=document.getElementById('afUnidadHosp'); if(_u) _u.value=''; }
  document.getElementById('afPrioridad').value = 'electiva';
  _agendResetTriageFields();
  // Toggle modo horario y procedimiento según la sala
  _agendApplyFormModeForSala(sala);
  if(isAmPm){
    _agendSelectBlock('AM');
  } else {
    _agendFillTimeSelects(startMin, endMin);
  }
  _agendUpdateRangoHint();
  setTimeout(() => document.getElementById('afPaciente').focus(), 80);
}

// Aplica el modo del formulario según la sala (AM/PM vs horario preciso,
// catálogo vs input libre, campos extras de accesos vasculares)
function _agendApplyFormModeForSala(sala){
  const isAmPm = !!(sala && sala.usesAmPmOnly);
  const tieneCatalogo = !!(sala && Array.isArray(sala.procedimientosCatalogo) && sala.procedimientosCatalogo.length);
  const esAccesos = !!(sala && sala.id === 'accesos_vasculares');
  // Horario
  const blkPreciso = document.getElementById('afHorarioPrecisoBlock');
  const blkAmPm    = document.getElementById('afHorarioAmPmBlock');
  if(blkPreciso) blkPreciso.style.display = isAmPm ? 'none' : '';
  if(blkAmPm)    blkAmPm.style.display    = isAmPm ? '' : 'none';
  // Procedimiento
  const blkProcLibre = document.getElementById('afProcLibreBlock');
  const blkProcCat   = document.getElementById('afProcCatalogoBlock');
  if(blkProcLibre) blkProcLibre.style.display = tieneCatalogo ? 'none' : '';
  if(blkProcCat)   blkProcCat.style.display   = tieneCatalogo ? '' : 'none';
  // Habilitar/deshabilitar el `required` para evitar bloquear submit
  const inpLibre = document.getElementById('afProc');
  const selCat   = document.getElementById('afProcSelect');
  if(inpLibre){
    if(tieneCatalogo){ inpLibre.removeAttribute('required'); inpLibre.value=''; }
    else { inpLibre.setAttribute('required',''); }
  }
  if(selCat){
    if(tieneCatalogo){
      // Rellenar opciones del catálogo
      selCat.innerHTML = sala.procedimientosCatalogo.map(p =>
        `<option value="${_gpEsc(p)}">${_gpEsc(p)}</option>`
      ).join('');
      selCat.setAttribute('required','');
      selCat.onchange = _agendOnProcSelectChange;
      _agendOnProcSelectChange();
    } else {
      selCat.removeAttribute('required');
    }
  }
  // Campos extras de Accesos Vasculares
  const blkExtras = document.getElementById('afAccesosExtraBlock');
  if(blkExtras){
    blkExtras.style.display = esAccesos ? '' : 'none';
    if(esAccesos){
      const el1 = document.getElementById('afAccesosLado'); if(el1) el1.value = '';
      const el2 = document.getElementById('afAccesosUrg');  if(el2) el2.value = 'programado';
      const el3 = document.getElementById('afAccesosVasc'); if(el3){ el3.value = ''; el3.onchange = _agendOnAccesosVascChange; }
      const el3b = document.getElementById('afAccesosVascOtro'); if(el3b){ el3b.value = ''; el3b.style.display = 'none'; }
      const el4 = document.getElementById('afAccesosCoag'); if(el4) el4.value = '';
      const el5 = document.getElementById('afAccesosTrat'); if(el5){ el5.value = ''; el5.onchange = _agendOnAccesosTratChange; }
      const el6 = document.getElementById('afAccesosTratOtro'); if(el6){ el6.value = ''; el6.style.display = 'none'; }
      const el7 = document.getElementById('afAccesosInfusion'); if(el7) el7.value = '';
      const el8 = document.getElementById('afAccesosDuracion'); if(el8) el8.value = '';
      const el9 = document.getElementById('afAccesosDiva'); if(el9) el9.value = '';
    }
  }
}

// Si en "Hallazgos vasculares" se eligió "Otro" se muestra un input libre
function _agendOnAccesosVascChange(){
  const sel = document.getElementById('afAccesosVasc');
  const otro = document.getElementById('afAccesosVascOtro');
  if(!sel || !otro) return;
  const esOtro = (sel.value === 'otro');
  otro.style.display = esOtro ? '' : 'none';
  if(!esOtro) otro.value = '';
}

// Si en "Tratamiento que se solicita" se eligió "Otro" se muestra un input libre
function _agendOnAccesosTratChange(){
  const sel = document.getElementById('afAccesosTrat');
  const otro = document.getElementById('afAccesosTratOtro');
  if(!sel || !otro) return;
  const esOtro = (sel.value === 'otro');
  otro.style.display = esOtro ? '' : 'none';
  if(!esOtro) otro.value = '';
}

// Si en el catálogo se eligió "Otro acceso vascular" se muestra un input libre
function _agendOnProcSelectChange(){
  const sel = document.getElementById('afProcSelect');
  const otro = document.getElementById('afProcOtro');
  if(!sel || !otro) return;
  const v = (sel.value || '').toLowerCase();
  const esOtro = v.startsWith('otro');
  otro.style.display = esOtro ? '' : 'none';
  if(!esOtro) otro.value = '';
}

// Selector AM/PM (salas con usesAmPmOnly)
function _agendSelectBlock(block){
  if(block !== 'AM' && block !== 'PM') return;
  AGEND_STATE.formBlock = block;
  const rng = _agendBlockRange(block);
  AGEND_STATE.formStartMin = rng.startMin;
  AGEND_STATE.formEndMin   = rng.endMin;
  const bAM = document.getElementById('afBlockAM');
  const bPM = document.getElementById('afBlockPM');
  if(bAM) bAM.classList.toggle('active', block === 'AM');
  if(bPM) bPM.classList.toggle('active', block === 'PM');
  _agendUpdateRangoHint();
}

// Compatibilidad: si en algún lugar legado se llama a la antigua firma agendOpenFormForHour(h)
function agendOpenFormForHour(h){
  const start = _agendMinToHHMM(h*60);
  const end   = _agendMinToHHMM(Math.min((h+1)*60, AGEND_DAY_END_MIN));
  agendOpenFormForRange(start, end);
}

// Cuando el usuario cambia el horario de inicio/fin: validación + hint visual
function _agendOnTimeChange(which){
  const selStart = document.getElementById('afHoraInicio');
  const selEnd   = document.getElementById('afHoraFin');
  if(!selStart || !selEnd) return;
  let startMin = _agendHHMMToMin(selStart.value);
  let endMin   = _agendHHMMToMin(selEnd.value);
  // Si cambian inicio y el fin queda <= inicio, llevar fin a inicio + 30 min
  if(which === 'start' && endMin <= startMin){
    endMin = Math.min(startMin + AGEND_SLOT_GRANULARITY_MIN, AGEND_DAY_END_MIN);
    selEnd.value = _agendMinToHHMM(endMin);
  }
  // Si cambian fin y queda <= inicio, llevar inicio a fin - 30 min
  if(which === 'end' && endMin <= startMin){
    startMin = Math.max(endMin - AGEND_SLOT_GRANULARITY_MIN, AGEND_DAY_START_MIN);
    selStart.value = _agendMinToHHMM(startMin);
  }
  _agendUpdateRangoHint();
}

function _agendUpdateRangoHint(){
  const hint = document.getElementById('afRangoHint');
  if(!hint) return;
  const sala = _agendGetSala(AGEND_STATE.salaId);
  const isAmPm = !!(sala && sala.usesAmPmOnly);
  // Modo AM/PM: solo informar y validar día abierto
  if(isAmPm){
    const block = (AGEND_STATE.formBlock === 'PM') ? 'PM' : 'AM';
    const isOpen = AGEND_STATE.selectedDate ? _agendIsDayOpenForSala(AGEND_STATE.salaId, AGEND_STATE.selectedDate) : true;
    if(!isOpen){
      hint.innerHTML = `<span style="color:#dc2626">⚠ Esta sala no recibe solicitudes ese día.</span>`;
      return;
    }
    hint.innerHTML = `<span style="color:#0f766e">✓ Bloque <b>${block}</b> (${_agendBlockLabel(block).replace(/^.. /,'')}) · Confirmamos un horario aproximado al visar.</span>`;
    return;
  }
  const selStart = document.getElementById('afHoraInicio');
  const selEnd   = document.getElementById('afHoraFin');
  if(!selStart || !selEnd){ hint.innerHTML = ''; return; }
  const startMin = _agendHHMMToMin(selStart.value);
  const endMin   = _agendHHMMToMin(selEnd.value);
  if(startMin == null || endMin == null || endMin <= startMin){
    hint.innerHTML = `<span style="color:#dc2626">⚠ El horario de término debe ser mayor que el de inicio.</span>`;
    return;
  }
  const dur = endMin - startMin;
  const horas = Math.floor(dur/60), mins = dur%60;
  const durStr = horas>0 ? (mins>0 ? `${horas} h ${mins} min` : `${horas} h`) : `${mins} min`;
  const isExtra = !!AGEND_STATE.formIsExtra;
  // 1) Solapamiento contra propias de la sala (respetando paralelo-extra)
  const overlap = _agendFindOverlap(AGEND_STATE.salaId, AGEND_STATE.selectedDate, startMin, endMin, null, isExtra);
  if(overlap){
    hint.innerHTML = `<span style="color:#dc2626">⚠ Choca con otra solicitud: ${_agendFmtRange(overlap.startMin, overlap.endMin)} · ${_gpEsc(overlap.paciente||'')} (${overlap.estado}).</span>`;
    return;
  }
  // 2) Cross-block: otras salas reservan estos minutos
  const cross = _agendFindCrossBlock(AGEND_STATE.salaId, AGEND_STATE.selectedDate, startMin, endMin);
  if(cross){
    const otra = cross.sala ? cross.sala.name : 'otra sala';
    hint.innerHTML = `<span style="color:#dc2626">⚠ ${otra} tiene reservado ${_agendFmtRange(cross.startMin, cross.endMin)} — esa franja queda bloqueada.</span>`;
    return;
  }
  // 3) Si es Extra y no choca → aviso especial
  if(isExtra){
    hint.innerHTML = `<span style="color:#b45309">⚠ Agendamiento EXTRA · Duración ${durStr} · Requiere visado del administrador.</span>`;
    return;
  }
  hint.innerHTML = `<span style="color:#16a34a">✓ Horario disponible · Duración ${durStr}</span>`;
}

// --- Triage clínico: lectura, reset y etiquetas legibles ---
function _agendReadTriageFields(){
  const v = id => { const el = document.getElementById(id); return el ? String(el.value||'').trim() : ''; };
  return {
    peso: v('afPeso'), asa: v('afAsa'), ayuno: v('afAyuno'),
    tipoAnestesia: v('afTipoAnestesia'), alergias: v('afAlergias'), anticoag: v('afAnticoag')
  };
}
function _agendResetTriageFields(){
  ['afPeso','afAsa','afAyuno','afTipoAnestesia','afAlergias','afAnticoag'].forEach(id=>{
    const el = document.getElementById(id); if(el) el.value = '';
  });
}
const _AGEND_AYUNO_LABEL    = { si6:'Sí, ≥ 6 h', si_menos:'Sí, < 6 h', no:'No / por confirmar' };
const _AGEND_TIPOANEST_LABEL = { sedacion:'Sedación', general:'Anestesia general', regional:'Anestesia regional', local_mac:'Local / MAC' };
function _agendAyunoLabel(v){ return _AGEND_AYUNO_LABEL[v] || v || ''; }
function _agendTipoAnestLabel(v){ return _AGEND_TIPOANEST_LABEL[v] || v || ''; }
// Pares [etiqueta, valor] de triage presentes en la solicitud (para detalle/mailto).
function _agendTriagePairs(req){
  const out = [];
  if(req.peso)          out.push(['Peso', req.peso + ' kg']);
  if(req.asa)           out.push(['ASA', 'ASA ' + req.asa]);
  if(req.ayuno)         out.push(['Ayuno', _agendAyunoLabel(req.ayuno)]);
  if(req.tipoAnestesia) out.push(['Anestesia solicitada', _agendTipoAnestLabel(req.tipoAnestesia)]);
  if(req.alergias)      out.push(['Alergias', req.alergias]);
  if(req.anticoag)      out.push(['Anticoagulantes', req.anticoag]);
  return out;
}

async function agendSubmitSolicitud(ev){
  if(ev) ev.preventDefault();
  const salaId = AGEND_STATE.salaId;
  const dateStr = AGEND_STATE.selectedDate;
  const isExtra = !!AGEND_STATE.formIsExtra;
  const sala = _agendGetSala(salaId);
  const isAmPm = !!(sala && sala.usesAmPmOnly);
  const tieneCatalogo = !!(sala && Array.isArray(sala.procedimientosCatalogo) && sala.procedimientosCatalogo.length);

  // Minimización de datos: por más que escriban un nombre, solo se guardan
  // iniciales. El RUT no se almacena ni se transmite (privacidad / Ley 19.628).
  const paciente = _agendIniciales(document.getElementById('afPaciente').value.trim());
  const edad = document.getElementById('afEdad').value.trim();
  const rut = '';
  const piezaEl = document.getElementById('afPieza');
  const unidadHospEl = document.getElementById('afUnidadHosp');
  const pieza = piezaEl ? piezaEl.value.trim() : '';
  const unidadHosp = unidadHospEl ? unidadHospEl.value.trim() : '';
  const notas = document.getElementById('afNotas').value.trim();
  const prio = document.getElementById('afPrioridad').value;
  // Triage clínico (todos opcionales)
  const triage = _agendReadTriageFields();

  // Procedimiento (catálogo o libre)
  let proc;
  if(tieneCatalogo){
    const sel = document.getElementById('afProcSelect');
    const otro = document.getElementById('afProcOtro');
    const baseV = sel ? (sel.value || '').trim() : '';
    if(!baseV){ alert('Selecciona un procedimiento.'); return; }
    if(baseV.toLowerCase().startsWith('otro')){
      const otroV = otro ? otro.value.trim() : '';
      if(!otroV){ alert('Especifica el otro acceso vascular.'); return; }
      proc = otroV;
    } else {
      proc = baseV;
    }
  } else {
    proc = document.getElementById('afProc').value.trim();
    if(!proc){ alert('Falta el procedimiento.'); return; }
  }
  if(!paciente){ alert('Falta el nombre del paciente.'); return; }

  // Horario
  let startMin, endMin, block = null;
  if(isAmPm){
    block = (AGEND_STATE.formBlock === 'PM') ? 'PM' : 'AM';
    const rng = _agendBlockRange(block);
    startMin = rng.startMin;
    endMin   = rng.endMin;
  } else {
    const startHHMM = document.getElementById('afHoraInicio').value;
    const endHHMM   = document.getElementById('afHoraFin').value;
    startMin = _agendHHMMToMin(startHHMM);
    endMin   = _agendHHMMToMin(endHHMM);
    if(startMin == null || endMin == null){ alert('Horario inválido.'); return; }
    if(endMin <= startMin){ alert('El horario de término debe ser mayor que el de inicio.'); return; }
    if(startMin < AGEND_DAY_START_MIN || endMin > AGEND_DAY_END_MIN){
      alert(`Horario fuera del rango permitido (${_agendMinToHHMM(AGEND_DAY_START_MIN)}–${_agendMinToHHMM(AGEND_DAY_END_MIN)}).`); return;
    }
  }

  // Blindaje universal: ninguna vía (regular, AM/PM ni Extra) acepta fechas pasadas.
  if(dateStr < _agendTodayStr()){
    alert('No se puede agendar en una fecha pasada. Elige una fecha de hoy en adelante.');
    return;
  }

  // Validación de anticipación y días cerrados (solo agenda regular; el
  // Agendamiento Extra es la vía de escape y omite estas reglas).
  if(!isExtra){
    if(_agendIsClosedDate(dateStr)){
      alert(`Ese día está cerrado (${_agendClosureLabel(dateStr)}). No se puede agendar en agenda regular.` +
        (sala && sala.allowsExtra ? '\n\nSi es imprescindible, usa "Agendamiento Extra" (requiere visado del administrador).' : '\n\nElige otra fecha.'));
      return;
    }
    if(prio !== 'urgente' && !_agendMeetsLeadTime(dateStr, startMin, salaId)){
      const dl = _agendLeadTimeDeadline(salaId);
      const _lh = _agendLeadTimeHours(salaId);
      alert(`Las solicitudes electivas requieren al menos ${_lh} horas hábiles de anticipación ` +
        `(sin contar domingos ni feriados).\n\nEl primer horario disponible es a partir del ${dl.toLocaleString('es-CL')}.` +
        `\n\nSi el caso es de menos de ${_lh} h, marca la prioridad como "Urgente"` +
        (sala && sala.allowsExtra ? ', o solicita un "Agendamiento Extra" (requiere visado).' : '.'));
      return;
    }
  }

  // Validación: si NO es Extra Y NO es modo AM/PM, debe respetar el horario regular de la sala
  if(!isExtra && !isAmPm){
    const hrs = _agendSalaHoursForDate(salaId, dateStr);
    if(!hrs){
      alert(`${sala?sala.name:'Esta sala'} no tiene agenda regular este día.\nUsa "Agendamiento Extra" si necesitas atender igualmente (requiere visado).`);
      return;
    }
    if(startMin < hrs.startMin || endMin > hrs.endMin){
      alert(`Horario fuera del rango habitual de ${sala?sala.name:'la sala'} (${_agendFmtRange(hrs.startMin, hrs.endMin)}).`);
      return;
    }
  }
  // En modo AM/PM, verificar que la sala esté abierta ese día
  if(isAmPm){
    if(!_agendIsDayOpenForSala(salaId, dateStr)){
      alert(`${sala?sala.name:'Esta sala'} no recibe solicitudes este día.`);
      return;
    }
  }

  // Salas AM/PM no participan en overlap ni cross-block:
  // su agenda es flexible (acepta paralelos sin tomar al anestesiólogo en un horario preciso)
  if(!isAmPm){
    // 1) Solapamiento contra propias de la sala (paralelo permitido solo si Extra y sala lo permite)
    const overlap = _agendFindOverlap(salaId, dateStr, startMin, endMin, null, isExtra);
    if(overlap){
      alert(`Ese horario choca con otra solicitud: ${_agendFmtRange(overlap.startMin, overlap.endMin)} (${overlap.estado}).\nElige otro horario.`);
      _agendUpdateRangoHint();
      return;
    }
    // 2) Cross-block contra otras salas
    const cross = _agendFindCrossBlock(salaId, dateStr, startMin, endMin);
    if(cross){
      const otra = cross.sala ? cross.sala.name : 'otra sala';
      alert(`${otra} tiene reservado ${_agendFmtRange(cross.startMin, cross.endMin)}. Esa franja queda bloqueada para ${sala?sala.name:'esta sala'}.\nElige otro horario.`);
      _agendUpdateRangoHint();
      return;
    }
  }

  const data = agendLoadData();
  data[salaId] = data[salaId] || {};
  if(!Array.isArray(data[salaId][dateStr])){
    data[salaId][dateStr] = _agendMigrateDayEntry(data[salaId][dateStr]);
  }
  const req = {
    id: _agendGenId(),
    paciente, edad, rut, pieza, unidadHosp, procedimiento: proc, notas, prioridad: prio,
    peso: triage.peso, asa: triage.asa, ayuno: triage.ayuno,
    tipoAnestesia: triage.tipoAnestesia, alergias: triage.alergias, anticoag: triage.anticoag,
    startMin, endMin,
    isExtra: isExtra,
    unidadCode: AGEND_STATE.unidadCode,
    solicitanteNombre: AGEND_STATE.solicitanteNombre,
    solicitanteTel: AGEND_STATE.solicitanteTel,
    solicitanteEmail: AGEND_STATE.solicitanteEmail || '',
    estado: 'pendiente',
    createdAt: Date.now(),
    visadoBy: null, visadoAt: null, comentarioVisado: ''
  };
  if(block) req.block = block;
  // Campos extras para Accesos Vasculares
  if(sala && sala.id === 'accesos_vasculares'){
    const lado = document.getElementById('afAccesosLado'); if(lado) req.accesosLado = lado.value;
    const urg  = document.getElementById('afAccesosUrg');  if(urg)  req.accesosUrgencia = urg.value;
    // Hallazgos vasculares: ahora es un select obligatorio (jul 2026)
    const vasc = document.getElementById('afAccesosVasc');
    const vascOtro = document.getElementById('afAccesosVascOtro');
    let vascVal = vasc ? vasc.value : '';
    if(vascVal === 'otro') vascVal = (vascOtro && vascOtro.value.trim()) ? ('Otro: ' + vascOtro.value.trim()) : '';
    if(!vascVal){ alert('Indica los HALLAZGOS VASCULARES del paciente (si no tiene, selecciona "Sin hallazgos relevantes").'); return; }
    req.accesosHallazgos = vascVal;
    const coag = document.getElementById('afAccesosCoag'); if(coag) req.accesosCoagulacion = coag.value.trim();
    // Tratamiento / infusión / duración / DIVA (jul 2026) — obligatorios,
    // orientan la elección del dispositivo (PICC vs MidLine vs CVC vs VVP)
    const trat = document.getElementById('afAccesosTrat');
    const tratOtro = document.getElementById('afAccesosTratOtro');
    const inf  = document.getElementById('afAccesosInfusion');
    const dur  = document.getElementById('afAccesosDuracion');
    const diva = document.getElementById('afAccesosDiva');
    let tratVal = trat ? trat.value : '';
    if(tratVal === 'otro') tratVal = (tratOtro && tratOtro.value.trim()) ? ('Otro: ' + tratOtro.value.trim()) : '';
    if(!tratVal){ alert('Indica el TRATAMIENTO que se solicita (antibiótico, quimioterapia, nutrición parenteral...).'); return; }
    if(inf && !inf.value){ alert('Indica el TIPO DE INFUSIÓN (central o periférica).'); return; }
    if(dur && !dur.value){ alert('Indica la DURACIÓN estimada del tratamiento.'); return; }
    req.accesosTratamiento = tratVal;
    req.accesosInfusion = inf ? inf.value : '';
    req.accesosDuracion = dur ? dur.value : '';
    req.accesosDiva = diva ? diva.value : '';
  }
  req.updatedAt = Date.now();
  data[salaId][dateStr].push(req);
  data[salaId][dateStr].sort((a,b) => a.startMin - b.startMin);
  agendSaveData(data);
  AGEND_STATE.formIsExtra = false;
  // CONFIRMACIÓN REAL: solo decimos "enviada" cuando de verdad llegó a la nube.
  // Si falla, avisamos claramente (queda guardada local y se reintenta), para
  // que NADIE crea que envió algo que no llegó al administrador.
  const _base = getBackendURL();
  if(!_base){
    alert('Solicitud guardada en este dispositivo.\n\n(No hay conexión a la nube configurada — avisa directamente al Servicio de Anestesia.)');
    agendOpenDia(dateStr);
    return;
  }
  let _ok = false;
  // Empuja Y verifica que la solicitud quedó en la nube (reintenta ante colisión).
  try{ _ok = await _agendSyncVerified(salaId, dateStr, req.id); }catch(e){ _ok = false; }
  if(_ok){
    try{ notifyAdminsOfNewRequest(req.id); }catch(e){}
    alert(isExtra
      ? '✅ Solicitud EXTRA enviada y registrada en la nube. Requiere visado del administrador.'
      : '✅ Solicitud enviada y registrada en la nube. El Servicio de Anestesia será notificado.');
  } else {
    alert('⚠️ La solicitud quedó guardada en este dispositivo, pero NO se pudo registrar en la nube (revisa tu conexión).\n\nSe reintentará al reabrir. Si es urgente, avisa directamente al Servicio de Anestesia.');
  }
  agendOpenDia(dateStr);
}

// Vista: Form solicitud EXTRA (libre, fuera de horario o paralelo)
function agendOpenFormExtra(dateStr){
  if(AGEND_STATE.mode !== 'unidad'){
    alert('Para solicitar un Agendamiento Extra entra como Unidad solicitante.');
    return;
  }
  const sala = _agendGetSala(AGEND_STATE.salaId);
  if(!sala || !sala.allowsExtra){
    alert('Esta sala no permite Agendamiento Extra.');
    return;
  }
  AGEND_STATE.selectedDate = dateStr;
  AGEND_STATE.formIsExtra = true;
  // Default: 09:00–10:00 (o el rango regular si lo hay)
  let startMin = 9*60, endMin = 10*60;
  const hrs = _agendSalaHoursForDate(AGEND_STATE.salaId, dateStr);
  if(hrs){
    startMin = hrs.startMin;
    endMin = Math.min(hrs.startMin + 60, hrs.endMin);
  }
  AGEND_STATE.formStartMin = startMin;
  AGEND_STATE.formEndMin   = endMin;
  _agendShowView('form', true);
  const dt = _agendParseDateStr(dateStr);
  const fmt = `EXTRA · ${dt.getDate()} de ${_agendMesesES[dt.getMonth()]} · ${_agendFmtRange(startMin, endMin)}`;
  _agendSetTitle('Nueva solicitud EXTRA', fmt);
  _agendSetHeadAction(null);
  const head = document.getElementById('agendFormHead');
  if(head){
    head.innerHTML = `
      <div class="agend-day-head-ico" style="background:#b45309">⚡</div>
      <div class="agend-day-head-body">
        <div class="agend-day-head-date">Agendamiento EXTRA</div>
        <div class="agend-day-head-sala">${sala.name} · ${dt.getDate()} de ${_agendMesesES[dt.getMonth()]} · Requiere visado</div>
      </div>`;
  }
  // Reset campos
  document.getElementById('afPaciente').value = '';
  document.getElementById('afEdad').value = '';
  document.getElementById('afRut').value = '';
  const procInp = document.getElementById('afProc'); if(procInp) procInp.value = '';
  document.getElementById('afNotas').value = '';
  { const _p=document.getElementById('afPieza'); if(_p) _p.value=''; const _u=document.getElementById('afUnidadHosp'); if(_u) _u.value=''; }
  document.getElementById('afPrioridad').value = 'electiva';
  _agendResetTriageFields();
  // Aplica modo de form (catálogo/AM-PM si corresponde — defensivo, las salas con Extra son horario libre)
  _agendApplyFormModeForSala(sala);
  // En Extra: usar rango completo 08–20 (jornada amplia)
  _agendFillTimeSelects(startMin, endMin, { useFullDay: true });
  _agendUpdateRangoHint();
  setTimeout(() => document.getElementById('afPaciente').focus(), 80);
}

// --- Vista: Detalle solicitud ---
function agendOpenDetalle(reqId){
  AGEND_STATE.detalleId = reqId;
  const found = _agendFindRequest(reqId);
  if(!found){ alert('No se encontró la solicitud.'); return; }
  _agendShowView('detalle', true);
  const {salaId, dateStr, req} = found;
  const sala = _agendGetSala(salaId);
  const unidad = _agendGetUnidad(req.unidadCode);
  const dt = _agendParseDateStr(dateStr);
  const isAmPmReq = !!(sala && sala.usesAmPmOnly);
  const reqBlock = _agendBlockOfSlot(req);
  const rangoTxt = isAmPmReq
    ? (reqBlock ? `Bloque ${reqBlock}` : 'Bloque AM/PM')
    : ((typeof req.startMin === 'number' && typeof req.endMin === 'number')
        ? _agendFmtRange(req.startMin, req.endMin)
        : '—');
  const fmt = `${dt.getDate()}/${_agendPad(dt.getMonth()+1)}/${dt.getFullYear()} · ${rangoTxt}`;
  _agendSetTitle('Detalle de solicitud', fmt);
  _agendSetHeadAction(null);
  const head = document.getElementById('agendDetalleHead');
  if(head){
    head.innerHTML = `
      <div class="agend-day-head-ico" style="background:${sala?sala.color:'#16a34a'}">${sala?sala.ico:'📅'}</div>
      <div class="agend-day-head-body">
        <div class="agend-day-head-date">${fmt}</div>
        <div class="agend-day-head-sala">${sala?sala.name:''}</div>
      </div>`;
  }
  // Detalle body
  const body = document.getElementById('agendDetalleBody');
  const visadoTxt = req.visadoBy
    ? `${req.visadoBy} · ${new Date(req.visadoAt).toLocaleString('es-CL')}${req.comentarioVisado?`<br><em>"${_gpEsc(req.comentarioVisado)}"</em>`:''}`
    : '—';
  let actionsHtml = '';
  const btnEliminar = `<button type="button" class="agend-action-btn" onclick="agendEliminarSolicitud('${req.id}')" style="background:var(--card);color:#dc2626;border:1.5px solid #fca5a5">🗑 Eliminar</button>`;
  const btnIA = (typeof aiAvailable === 'function' && aiAvailable())
    ? `<div class="agend-detalle-actions" style="margin-top:8px"><button type="button" class="agend-btn-secondary ai-entry-btn" onclick="aiAnalizarSolicitud('${req.id}')" style="background:var(--tintv);border:1.5px solid #8579ad;color:var(--primary-dark);font-weight:700">🤖 Analizar con ARIA</button></div><div id="aiVisadoResult" style="display:none"></div>`
    : '';
  if(AGEND_STATE.mode === 'admin' && req.estado === 'pendiente'){
    actionsHtml = `
      <div class="agend-detalle-actions">
        <button type="button" class="agend-action-btn aprobar" onclick="agendVisarSolicitud('${req.id}','aprobada')">✓ Aprobar</button>
        <button type="button" class="agend-action-btn rechazar" onclick="agendVisarSolicitud('${req.id}','rechazada')">✗ Rechazar</button>
      </div>
      <div class="agend-detalle-actions" style="margin-top:8px">
        <button type="button" class="agend-btn-secondary" onclick="agendProponerHorario('${req.id}')" style="background:#eef2ff;border:1.5px solid #c7d2fe;color:#3730a3;font-weight:700">🔁 Proponer otro horario</button>
        ${btnEliminar}
      </div>
      ${btnIA}`;
  } else if(AGEND_STATE.mode === 'admin' && req.estado === 'propuesta'){
    actionsHtml = `
      <div class="agend-detalle-actions">
        <button type="button" class="agend-btn-secondary" onclick="agendProponerHorario('${req.id}')" style="background:#eef2ff;border:1.5px solid #c7d2fe;color:#3730a3;font-weight:700">🔁 Cambiar la propuesta</button>
        <button type="button" class="agend-btn-secondary" onclick="agendVisarSolicitud('${req.id}','pendiente')" style="background:var(--card);color:var(--muted)">Cancelar propuesta</button>
      </div>
      <div class="agend-detalle-actions" style="margin-top:8px">${btnEliminar}</div>
      ${btnIA}`;
  } else if(AGEND_STATE.mode === 'admin' && req.estado === 'aprobada'){
    actionsHtml = `
      <div class="agend-detalle-actions">
        <button type="button" class="agend-action-btn aprobar" onclick="agendVisarSolicitud('${req.id}','realizada')">✅ Marcar realizada</button>
        <button type="button" class="agend-btn-secondary" onclick="agendVisarSolicitud('${req.id}','pendiente')" style="background:var(--card);color:var(--muted)">Revertir a pendiente</button>
      </div>
      <div class="agend-detalle-actions" style="margin-top:8px">${btnEliminar}</div>
      ${btnIA}`;
  } else if(AGEND_STATE.mode === 'admin' && req.estado === 'realizada'){
    actionsHtml = `
      <div class="agend-detalle-actions">
        <button type="button" class="agend-btn-secondary" onclick="agendVisarSolicitud('${req.id}','aprobada')" style="background:var(--card);color:var(--muted)">↩ Volver a aprobada</button>
        ${btnEliminar}
      </div>
      ${btnIA}`;
  } else if(AGEND_STATE.mode === 'admin' && req.estado !== 'pendiente'){
    actionsHtml = `
      <div class="agend-detalle-actions">
        <button type="button" class="agend-btn-secondary" onclick="agendVisarSolicitud('${req.id}','pendiente')" style="background:var(--card);color:var(--muted)">Revertir a pendiente</button>
        ${btnEliminar}
      </div>
      ${btnIA}`;
  } else if(AGEND_STATE.mode === 'unidad' && req.estado === 'propuesta'){
    actionsHtml = `
      <div class="agend-detalle-actions">
        <button type="button" class="agend-action-btn aprobar" onclick="agendAceptarPropuesta('${req.id}')">✓ Aceptar nuevo horario</button>
        <button type="button" class="agend-action-btn rechazar" onclick="agendRechazarPropuesta('${req.id}')">✗ No me sirve</button>
      </div>`;
  }
  // Bloque visual de la contrapropuesta (si existe)
  let propuestaRow = '';
  if(req.propuesta){
    const p = req.propuesta;
    const pdt = _agendParseDateStr(p.date || dateStr);
    const pFecha = `${_agendDiasES[pdt.getDay()]} ${pdt.getDate()}/${_agendPad(pdt.getMonth()+1)}/${pdt.getFullYear()}`;
    const pHora = (p.block === 'AM' || p.block === 'PM')
      ? `${p.block} ${p.block==='PM'?'(14:00–20:00)':'(08:00–14:00)'}`
      : ((typeof p.startMin==='number'&&typeof p.endMin==='number') ? _agendFmtRange(p.startMin,p.endMin) : '—');
    propuestaRow = `
      <div class="agend-propuesta-box">
        <div class="agend-propuesta-title">🔁 Horario propuesto por Anestesia</div>
        <div class="agend-propuesta-line"><b>${pFecha}</b> · ${pHora}</div>
        ${p.comentario ? `<div class="agend-propuesta-note">"${_gpEsc(p.comentario)}"</div>` : ''}
        ${AGEND_STATE.mode === 'unidad' ? `<div class="agend-propuesta-hint">Acepta para confirmar, o indica que no te sirve para que el servicio proponga otra opción.</div>` : `<div class="agend-propuesta-hint">A la espera de que la unidad acepte o rechace.</div>`}
      </div>`;
  }
  const extraBadge = req.isExtra ? ` <span class="agend-extra-pill">EXTRA</span>` : '';
  const horarioRow = isAmPmReq
    ? `<div class="agend-detalle-row"><div class="agend-detalle-k">Bloque</div><div class="agend-detalle-v">${reqBlock||'—'} <span class="agend-ampm-pill">${reqBlock==='PM'?'14:00–20:00':'08:00–14:00'}</span></div></div>`
    : `<div class="agend-detalle-row"><div class="agend-detalle-k">Horario</div><div class="agend-detalle-v">${(typeof req.startMin==='number'&&typeof req.endMin==='number')?_agendFmtRange(req.startMin,req.endMin):'—'}</div></div>`;
  // Bloque opcional con campos extras de Accesos Vasculares
  const accesosRows = (sala && sala.id === 'accesos_vasculares')
    ? `
      ${req.accesosTratamiento ? `<div class="agend-detalle-row"><div class="agend-detalle-k">Tratamiento</div><div class="agend-detalle-v">${_gpEsc(req.accesosTratamiento)}</div></div>` : ''}
      ${req.accesosInfusion ? `<div class="agend-detalle-row"><div class="agend-detalle-k">Infusión</div><div class="agend-detalle-v">${_gpEsc(req.accesosInfusion)}</div></div>` : ''}
      ${req.accesosDuracion ? `<div class="agend-detalle-row"><div class="agend-detalle-k">Duración tto.</div><div class="agend-detalle-v">${_gpEsc(req.accesosDuracion)}</div></div>` : ''}
      ${req.accesosDiva ? `<div class="agend-detalle-row"><div class="agend-detalle-k">DIVA</div><div class="agend-detalle-v">${req.accesosDiva==='si' ? '<b style="color:#dc2626">⚠ Sí — acceso venoso difícil</b>' : 'No'}</div></div>` : ''}
      ${req.accesosLado ? `<div class="agend-detalle-row"><div class="agend-detalle-k">Lado</div><div class="agend-detalle-v">${_gpEsc(req.accesosLado)}</div></div>` : ''}
      ${req.accesosUrgencia ? `<div class="agend-detalle-row"><div class="agend-detalle-k">Urgencia</div><div class="agend-detalle-v">${_gpEsc(req.accesosUrgencia)}</div></div>` : ''}
      ${req.accesosHallazgos ? `<div class="agend-detalle-row"><div class="agend-detalle-k">Hallazgos vasculares</div><div class="agend-detalle-v">${_gpEsc(req.accesosHallazgos)}</div></div>` : ''}
      ${req.accesosCoagulacion ? `<div class="agend-detalle-row"><div class="agend-detalle-k">Coagulación</div><div class="agend-detalle-v">${_gpEsc(req.accesosCoagulacion)}</div></div>` : ''}
    `
    : '';
  // Filas de triage clínico (solo las presentes)
  const triageRows = _agendTriagePairs(req)
    .map(([k,v]) => `<div class="agend-detalle-row"><div class="agend-detalle-k">${k}</div><div class="agend-detalle-v">${_gpEsc(String(v))}</div></div>`)
    .join('');
  body.innerHTML = `
    <div class="agend-detalle-card">
      <div class="agend-detalle-row"><div class="agend-detalle-k">Estado</div><div class="agend-detalle-v"><span class="agend-slot-status ${req.estado}">${req.estado}</span>${extraBadge}</div></div>
      ${propuestaRow}
      ${horarioRow}
      <div class="agend-detalle-row"><div class="agend-detalle-k">Paciente</div><div class="agend-detalle-v">${_gpEsc(req.paciente)}${req.edad?` · ${_gpEsc(String(req.edad))} años`:''}${req.rut?` · ${_gpEsc(req.rut)}`:''}</div></div>
      ${(req.pieza||req.unidadHosp)?`<div class="agend-detalle-row"><div class="agend-detalle-k">Ubicación</div><div class="agend-detalle-v">${[req.pieza?('🛏 '+_gpEsc(req.pieza)):'', req.unidadHosp?_gpEsc(req.unidadHosp):''].filter(Boolean).join(' · ')}</div></div>`:''}
      <div class="agend-detalle-row"><div class="agend-detalle-k">Procedimiento</div><div class="agend-detalle-v">${_gpEsc(req.procedimiento)}</div></div>
      <div class="agend-detalle-row"><div class="agend-detalle-k">Prioridad</div><div class="agend-detalle-v">${_gpEsc(req.prioridad||'electiva')}</div></div>
      ${triageRows}
      ${accesosRows}
      <div class="agend-detalle-row"><div class="agend-detalle-k">Antecedentes</div><div class="agend-detalle-v">${req.notas?_gpEsc(req.notas):'<em style="color:#9ca3af">Sin antecedentes adicionales</em>'}</div></div>
      <div class="agend-detalle-row"><div class="agend-detalle-k">Unidad</div><div class="agend-detalle-v">${unidad?unidad.ico+' '+_gpEsc(unidad.name):'—'}</div></div>
      <div class="agend-detalle-row"><div class="agend-detalle-k">Solicitante</div><div class="agend-detalle-v">${_gpEsc(req.solicitanteNombre||'—')}${req.solicitanteTel?`<br><span style="color:var(--muted);font-size:12px">📞 ${_gpEsc(req.solicitanteTel)}</span>`:''}${req.solicitanteEmail?`<br><span style="color:var(--muted);font-size:12px">✉️ ${_gpEsc(req.solicitanteEmail)}</span>`:''}</div></div>
      <div class="agend-detalle-row"><div class="agend-detalle-k">Creada</div><div class="agend-detalle-v">${new Date(req.createdAt).toLocaleString('es-CL')}</div></div>
      <div class="agend-detalle-row"><div class="agend-detalle-k">Visado</div><div class="agend-detalle-v">${visadoTxt}</div></div>
      ${req.realizadaAt ? `<div class="agend-detalle-row"><div class="agend-detalle-k">Realizada</div><div class="agend-detalle-v">✅ ${_gpEsc(req.realizadaBy||'Anestesia')} · ${new Date(req.realizadaAt).toLocaleString('es-CL')}</div></div>` : ''}
      ${actionsHtml}
    </div>`;
}

async function agendVisarSolicitud(reqId, nuevoEstado){
  const found = _agendFindRequest(reqId);
  if(!found) return;
  let comentario = '';
  if(nuevoEstado === 'rechazada'){
    comentario = prompt('Motivo del rechazo (opcional, queda registrado):') || '';
  } else if(nuevoEstado === 'aprobada'){
    comentario = prompt('Comentario para el solicitante (opcional):') || '';
  }
  const data = agendLoadData();
  if(!Array.isArray(data[found.salaId][found.dateStr])){
    data[found.salaId][found.dateStr] = _agendMigrateDayEntry(data[found.salaId][found.dateStr]);
  }
  const arr = data[found.salaId][found.dateStr];
  const idx = arr.findIndex(r => r && r.id === reqId);
  if(idx < 0) return;
  const slot = arr[idx];
  // Si vamos a revertir a pendiente o aprobar y antes estaba rechazada, validar overlap + cross-block
  // ("realizada" no valida: el procedimiento ya ocurrió, el horario no cambia)
  if(nuevoEstado !== 'rechazada' && nuevoEstado !== 'realizada'){
    const overlap = _agendFindOverlap(found.salaId, found.dateStr, slot.startMin, slot.endMin, reqId, !!slot.isExtra);
    if(overlap){
      alert(`No se puede ${nuevoEstado === 'aprobada' ? 'aprobar' : 'revertir'}: choca con otra solicitud activa (${_agendFmtRange(overlap.startMin, overlap.endMin)}).`);
      return;
    }
    const cross = _agendFindCrossBlock(found.salaId, found.dateStr, slot.startMin, slot.endMin);
    if(cross){
      const otra = cross.sala ? cross.sala.name : 'otra sala';
      const ok = confirm(`Atención: ${otra} tiene reservado ${_agendFmtRange(cross.startMin, cross.endMin)}, lo que normalmente bloquea esta sala.\n\n¿Quieres ${nuevoEstado === 'aprobada' ? 'aprobar' : 'revertir'} de todas formas?`);
      if(!ok) return;
    }
  }
  slot.estado = nuevoEstado;
  if(nuevoEstado === 'realizada'){
    // Marcar realizada NO pisa los datos del visado (quién aprobó y su comentario)
    slot.realizadaBy = AGEND_STATE.staffNombre || 'Anestesia';
    slot.realizadaAt = Date.now();
    slot.updatedAt = Date.now();
  } else {
    slot.visadoBy = AGEND_STATE.staffNombre || 'Anestesia';
    slot.visadoAt = Date.now();
    slot.updatedAt = Date.now();
    slot.comentarioVisado = comentario;
    // Si se revierte/reaprueba, ya no está "realizada"
    delete slot.realizadaBy; delete slot.realizadaAt;
  }
  // Cualquier visado directo (aprobar/rechazar/revertir) descarta una
  // contrapropuesta vigente para no dejar un recuadro de propuesta huérfano.
  if(slot.propuesta) delete slot.propuesta;
  agendSaveData(data);
  // Confirmar que el visado llegó a la nube ANTES de avisar al solicitante.
  const _vb = getBackendURL();
  if(_vb){
    let _vok = false;
    try{ _vok = await agendSyncNow(); }catch(e){ _vok = false; }
    if(!_vok){
      alert('⚠️ El visado quedó guardado en este dispositivo, pero NO se pudo registrar en la nube (revisa tu conexión). Se reintentará al reabrir el módulo de Agendamiento.');
    }
  }
  // Al aprobar: abrir correo de confirmación al solicitante con copia a las
  // secretarías de pabellón (todas las salas, incluida Endoscopía Paralela).
  if(nuevoEstado === 'aprobada'){
    _agendOfrecerMailtoConfirmacion(slot, found.salaId, found.dateStr);
  }
  // Al rechazar: cerrar el loop avisando al solicitante (motivo + cómo reagendar).
  if(nuevoEstado === 'rechazada'){
    _agendOfrecerMailtoRechazo(slot, found.salaId, found.dateStr);
  }
  agendOpenDetalle(reqId);
}

// Elimina definitivamente una solicitud (solo modo Admin).
// Deja un tombstone para que la eliminación se propague a otros dispositivos.
function agendEliminarSolicitud(reqId){
  if(AGEND_STATE.mode !== 'admin'){ alert('Solo el modo Administrador puede eliminar solicitudes.'); return; }
  const found = _agendFindRequest(reqId);
  if(!found) return;
  const r = found.req;
  if(!confirm('¿Eliminar definitivamente esta solicitud?\n\nPaciente: ' + (r.paciente||'—') + '\nEstado: ' + (r.estado||'—') + '\n\nEsta acción no se puede deshacer.')) return;
  const data = agendLoadData();
  if(!Array.isArray(data[found.salaId][found.dateStr])){
    data[found.salaId][found.dateStr] = _agendMigrateDayEntry(data[found.salaId][found.dateStr]);
  }
  const arr = data[found.salaId][found.dateStr];
  const idx = arr.findIndex(x => x && x.id === reqId);
  if(idx < 0) return;
  arr[idx] = { id: reqId, deleted: true, deletedAt: Date.now(), updatedAt: Date.now() };
  agendSaveData(data);
  agendScheduleSync();
  toast && toast('Solicitud eliminada');
  // Volver a la vista anterior y refrescarla
  agendBack();
  const v = AGEND_STATE.view;
  try{
    if(v === 'overview') agendOverviewTab(AGEND_STATE.overviewTab);
    else if(v === 'dia' && AGEND_STATE.selectedDate) agendOpenDia(AGEND_STATE.selectedDate);
    else if(v === 'calendario') agendRenderCalendario();
  }catch(e){}
}

// Abre el cliente de correo del navegador con un mensaje pre-llenado para
// notificar al solicitante que la solicitud fue aprobada.
// (Salas EXCEPTO Endoscopía — ver agendVisarSolicitud)
function _agendOfrecerMailtoConfirmacion(req, salaId, dateStr){
  if(!req || !req.solicitanteEmail){
    // Sin email del solicitante → solo aviso visual y skip
    toast && toast('Aprobada (sin email del solicitante registrado)');
    return;
  }
  const sala = _agendGetSala(salaId);
  const unidad = _agendGetUnidad(req.unidadCode);
  const dt = _agendParseDateStr(dateStr);
  const fechaTxt = `${_agendDiasES[dt.getDay()]} ${dt.getDate()} de ${_agendMesesES[dt.getMonth()]} de ${dt.getFullYear()}`;
  const isAmPm = !!(sala && sala.usesAmPmOnly);
  const block = _agendBlockOfSlot(req);
  const horarioTxt = isAmPm
    ? (block === 'PM' ? 'Bloque PM (aprox. 14:00–20:00)' : 'Bloque AM (aprox. 08:00–14:00)')
    : ((typeof req.startMin === 'number' && typeof req.endMin === 'number')
        ? `Horario ${_agendFmtRange(req.startMin, req.endMin)}`
        : 'Horario por confirmar');
  const visadoTxt = req.visadoBy ? `${req.visadoBy}` : 'Servicio de Anestesia';
  const subject = `Agendamiento APROBADO · ${sala?sala.name:'Procedimiento'} · ${dt.getDate()}/${_agendPad(dt.getMonth()+1)}/${dt.getFullYear()}`;
  const lineas = [];
  lineas.push(`Estimado(a) ${req.solicitanteNombre || ''}:`);
  lineas.push('');
  lineas.push(`Te confirmamos que la siguiente solicitud de agendamiento fue APROBADA por el Servicio de Anestesia.`);
  lineas.push('');
  lineas.push(`• Sala: ${sala ? sala.name : '—'}`);
  lineas.push(`• Unidad solicitante: ${unidad ? unidad.name : '—'}`);
  lineas.push(`• Fecha: ${fechaTxt}`);
  lineas.push(`• ${horarioTxt}`);
  lineas.push(`• Paciente: ${req.paciente || '—'}${req.edad?` · ${req.edad} años`:''}${req.rut?` · RUT ${req.rut}`:''}`);
  lineas.push(`• Procedimiento: ${req.procedimiento || '—'}`);
  lineas.push(`• Prioridad: ${req.prioridad || 'electiva'}`);
  _agendTriagePairs(req).forEach(([k,v]) => lineas.push(`• ${k}: ${v}`));
  if(req.notas) lineas.push(`• Antecedentes: ${req.notas}`);
  // Extras Accesos Vasculares
  if(salaId === 'accesos_vasculares'){
    if(req.accesosTratamiento) lineas.push(`• Tratamiento solicitado: ${req.accesosTratamiento}`);
    if(req.accesosInfusion)    lineas.push(`• Tipo de infusión: ${req.accesosInfusion}`);
    if(req.accesosDuracion)    lineas.push(`• Duración del tratamiento: ${req.accesosDuracion}`);
    if(req.accesosDiva)        lineas.push(`• DIVA (acceso venoso difícil): ${req.accesosDiva === 'si' ? 'SÍ' : 'No'}`);
    if(req.accesosLado)        lineas.push(`• Lado preferente: ${req.accesosLado}`);
    if(req.accesosUrgencia)    lineas.push(`• Urgencia: ${req.accesosUrgencia}`);
    if(req.accesosHallazgos)   lineas.push(`• Hallazgos vasculares: ${req.accesosHallazgos}`);
    if(req.accesosCoagulacion) lineas.push(`• Coagulación: ${req.accesosCoagulacion}`);
  }
  if(req.isExtra) lineas.push(`• Tipo: AGENDAMIENTO EXTRA`);
  lineas.push('');
  if(req.comentarioVisado){
    lineas.push(`Comentario del Servicio de Anestesia:`);
    lineas.push(`"${req.comentarioVisado}"`);
    lineas.push('');
  }
  lineas.push(`Aprobado por: ${visadoTxt}`);
  lineas.push(`Fecha de visado: ${new Date(req.visadoAt || Date.now()).toLocaleString('es-CL')}`);
  lineas.push('');
  lineas.push('Por favor confirma la recepción de este correo.');
  lineas.push('');
  lineas.push('— Servicio de Anestesia');
  const body = lineas.join('\n');
  // Secretarías de pabellón en copia (CC). Configurable en andes.json
  // ("agendCcEmails": ["...","..."]). Si no está, usa estos por defecto.
  const ccList = (INSTITUTION && Array.isArray(INSTITUTION.agendCcEmails) && INSTITUTION.agendCcEmails.length)
    ? INSTITUTION.agendCcEmails.slice()
    : ['ahernandez@clinicauandes.cl','oacosta@clinicauandes.cl','cpvasquezz@clinicauandes.cl'];
  // SOLO Accesos Vasculares: copia adicional (configurable en andes.json con
  // "agendCcAccesosEmails"). Por defecto: enfermera coordinadora de accesos.
  if(salaId === 'accesos_vasculares'){
    const extraCc = (INSTITUTION && Array.isArray(INSTITUTION.agendCcAccesosEmails) && INSTITUTION.agendCcAccesosEmails.length)
      ? INSTITUTION.agendCcAccesosEmails
      : ['cbrante@clinicauandes.cl'];
    extraCc.forEach(e => { if(e && !ccList.includes(e)) ccList.push(e); });
  }
  const cc = ccList.join(',');
  const url = `mailto:${encodeURIComponent(req.solicitanteEmail)}?cc=${encodeURIComponent(cc)}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  // Confirmación rápida y luego abrir el cliente de correo
  const ok = confirm(`Solicitud APROBADA. ¿Abrir tu cliente de correo para notificar a ${req.solicitanteEmail}?\n\nSe enviará con copia a las secretarías de pabellón (${cc}).\n\nSi cancelas, la aprobación queda registrada igualmente.`);
  if(!ok) return;
  try{
    window.location.href = url;
  }catch(e){
    try{ window.open(url, '_self'); }catch(e2){}
  }
}

// Abre el cliente de correo pre-llenado para avisar al solicitante que su
// solicitud fue RECHAZADA, con el motivo registrado e indicación de reagendar.
// Cierra el loop: hoy el rechazo quedaba sin notificación a la unidad.
function _agendOfrecerMailtoRechazo(req, salaId, dateStr){
  if(!req || !req.solicitanteEmail){
    toast && toast('Rechazada (sin email del solicitante registrado)');
    return;
  }
  const sala = _agendGetSala(salaId);
  const unidad = _agendGetUnidad(req.unidadCode);
  const dt = _agendParseDateStr(dateStr);
  const fechaTxt = `${_agendDiasES[dt.getDay()]} ${dt.getDate()} de ${_agendMesesES[dt.getMonth()]} de ${dt.getFullYear()}`;
  const isAmPm = !!(sala && sala.usesAmPmOnly);
  const block = _agendBlockOfSlot(req);
  const horarioTxt = isAmPm
    ? (block === 'PM' ? 'Bloque PM (aprox. 14:00–20:00)' : 'Bloque AM (aprox. 08:00–14:00)')
    : ((typeof req.startMin === 'number' && typeof req.endMin === 'number')
        ? `Horario ${_agendFmtRange(req.startMin, req.endMin)}`
        : 'Horario solicitado');
  const visadoTxt = req.visadoBy ? `${req.visadoBy}` : 'Servicio de Anestesia';
  const subject = `Agendamiento NO disponible · ${sala?sala.name:'Procedimiento'} · ${dt.getDate()}/${_agendPad(dt.getMonth()+1)}/${dt.getFullYear()}`;
  const lineas = [];
  lineas.push(`Estimado(a) ${req.solicitanteNombre || ''}:`);
  lineas.push('');
  lineas.push(`Lamentablemente la siguiente solicitud de agendamiento NO pudo ser confirmada por el Servicio de Anestesia para la fecha y horario pedidos.`);
  lineas.push('');
  lineas.push(`• Sala: ${sala ? sala.name : '—'}`);
  lineas.push(`• Unidad solicitante: ${unidad ? unidad.name : '—'}`);
  lineas.push(`• Fecha solicitada: ${fechaTxt}`);
  lineas.push(`• ${horarioTxt}`);
  lineas.push(`• Paciente: ${req.paciente || '—'}${req.edad?` · ${req.edad} años`:''}`);
  lineas.push(`• Procedimiento: ${req.procedimiento || '—'}`);
  _agendTriagePairs(req).forEach(([k,v]) => lineas.push(`• ${k}: ${v}`));
  lineas.push('');
  if(req.comentarioVisado){
    lineas.push(`Motivo / observación del Servicio de Anestesia:`);
    lineas.push(`"${req.comentarioVisado}"`);
    lineas.push('');
  }
  lineas.push(`Te pedimos reenviar una nueva solicitud proponiendo otra fecha u horario a través de la aplicación de Agendamiento. Si necesitas coordinar directamente, responde este correo.`);
  lineas.push('');
  lineas.push(`Gestionado por: ${visadoTxt}`);
  lineas.push(`Fecha: ${new Date(req.visadoAt || Date.now()).toLocaleString('es-CL')}`);
  lineas.push('');
  lineas.push('— Servicio de Anestesia');
  const body = lineas.join('\n');
  const url = `mailto:${encodeURIComponent(req.solicitanteEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  const ok = confirm(`Solicitud RECHAZADA. ¿Abrir tu cliente de correo para avisar a ${req.solicitanteEmail}?\n\nSi cancelas, el rechazo queda registrado igualmente.`);
  if(!ok) return;
  try{
    window.location.href = url;
  }catch(e){
    try{ window.open(url, '_self'); }catch(e2){}
  }
}

// ============================================================
// CONTRAPROPUESTA — el admin ofrece un horario alternativo en vez de
// rechazar. La solicitud pasa a estado 'propuesta' (sigue reservando su
// horario original hasta que la unidad acepte o rechace). Al aceptar, se
// confirma en el horario propuesto (moviéndola de día si corresponde).
// ============================================================

// Parsea "HH:MM" a minutos desde medianoche. Devuelve null si es inválido.
function _agendParseHHMM(txt){
  const m = String(txt||'').trim().match(/^(\d{1,2}):(\d{2})$/);
  if(!m) return null;
  const h = parseInt(m[1],10), mi = parseInt(m[2],10);
  if(isNaN(h) || isNaN(mi) || h<0 || h>23 || mi<0 || mi>59) return null;
  return h*60 + mi;
}

// Admin: proponer una fecha/horario alternativo para una solicitud.
function agendProponerHorario(reqId){
  if(AGEND_STATE.mode !== 'admin'){ alert('Solo el modo Administrador puede proponer horarios.'); return; }
  const found = _agendFindRequest(reqId);
  if(!found) return;
  const salaId = found.salaId;
  const sala = _agendGetSala(salaId);
  const isAmPm = !!(sala && sala.usesAmPmOnly);

  // 1) Fecha propuesta
  const fechaIn = prompt('Fecha propuesta (AAAA-MM-DD):', found.dateStr);
  if(fechaIn === null) return;
  const newDate = String(fechaIn).trim();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(newDate) || isNaN(_agendParseDateStr(newDate).getTime())){
    alert('Fecha inválida. Usa el formato AAAA-MM-DD.');
    return;
  }
  if(newDate < _agendTodayStr()){
    alert('La fecha propuesta no puede ser en el pasado.');
    return;
  }

  // 2) Horario propuesto
  let startMin, endMin, block = null;
  if(isAmPm){
    const bIn = prompt('Bloque propuesto (escribe AM o PM):', _agendBlockOfSlot(found.req) || 'AM');
    if(bIn === null) return;
    block = String(bIn).trim().toUpperCase() === 'PM' ? 'PM' : 'AM';
    const rng = _agendBlockRange(block);
    startMin = rng.startMin; endMin = rng.endMin;
  } else {
    const iniIn = prompt('Hora de inicio propuesta (HH:MM):', (typeof found.req.startMin==='number') ? _agendMinToHHMM(found.req.startMin) : '08:00');
    if(iniIn === null) return;
    const finIn = prompt('Hora de término propuesta (HH:MM):', (typeof found.req.endMin==='number') ? _agendMinToHHMM(found.req.endMin) : '09:00');
    if(finIn === null) return;
    startMin = _agendParseHHMM(iniIn);
    endMin   = _agendParseHHMM(finIn);
    if(startMin === null || endMin === null){ alert('Horario inválido. Usa el formato HH:MM.'); return; }
    if(endMin <= startMin){ alert('La hora de término debe ser posterior al inicio.'); return; }
    if(startMin < AGEND_DAY_START_MIN || endMin > AGEND_DAY_END_MIN){
      alert('El horario debe estar entre las 08:00 y las 20:00.'); return;
    }
  }

  // 3) Validar que el horario propuesto no choque con otra solicitud activa
  if(!isAmPm){
    const overlap = _agendFindOverlap(salaId, newDate, startMin, endMin, reqId, !!found.req.isExtra);
    if(overlap){
      alert(`El horario propuesto choca con otra solicitud activa (${_agendFmtRange(overlap.startMin, overlap.endMin)}). Elige otro horario.`);
      return;
    }
    const cross = _agendFindCrossBlock(salaId, newDate, startMin, endMin);
    if(cross){
      const otra = cross.sala ? cross.sala.name : 'otra sala';
      if(!confirm(`Atención: ${otra} tiene reservado ${_agendFmtRange(cross.startMin, cross.endMin)}, lo que normalmente bloquea esta sala.\n\n¿Proponer de todas formas?`)) return;
    }
  }

  // 4) Comentario para la unidad
  const comentario = prompt('Comentario para la unidad (opcional):') || '';

  // 5) Guardar
  const data = agendLoadData();
  if(!Array.isArray(data[found.salaId][found.dateStr])){
    data[found.salaId][found.dateStr] = _agendMigrateDayEntry(data[found.salaId][found.dateStr]);
  }
  const arr = data[found.salaId][found.dateStr];
  const idx = arr.findIndex(r => r && r.id === reqId);
  if(idx < 0) return;
  const slot = arr[idx];
  slot.propuesta = { date: newDate, startMin, endMin, comentario, by: (AGEND_STATE.staffNombre || 'Anestesia'), at: Date.now() };
  if(block) slot.propuesta.block = block;
  slot.estado = 'propuesta';
  slot.visadoBy = AGEND_STATE.staffNombre || 'Anestesia';
  slot.visadoAt = Date.now();
  slot.updatedAt = Date.now();
  agendSaveData(data);
  agendScheduleSync();
  _agendOfrecerMailtoPropuesta(slot, found.salaId, found.dateStr);
  agendOpenDetalle(reqId);
}

// Unidad: aceptar el horario propuesto → confirma la solicitud (la mueve de
// día si la propuesta es para otra fecha).
function agendAceptarPropuesta(reqId){
  const found = _agendFindRequest(reqId);
  if(!found || !found.req.propuesta){ alert('Esta solicitud ya no tiene una propuesta vigente.'); return; }
  const salaId = found.salaId;
  const p = found.req.propuesta;
  const newDate = p.date || found.dateStr;
  const isAmPm = (p.block === 'AM' || p.block === 'PM');

  // Revalidar disponibilidad del horario propuesto (pudo ocuparse mientras tanto)
  if(!isAmPm){
    const overlap = _agendFindOverlap(salaId, newDate, p.startMin, p.endMin, reqId, !!found.req.isExtra);
    if(overlap){
      alert(`El horario propuesto ya no está disponible (${_agendFmtRange(overlap.startMin, overlap.endMin)} fue tomado).\n\nEl servicio te propondrá otra opción.`);
      return;
    }
    const cross = _agendFindCrossBlock(salaId, newDate, p.startMin, p.endMin);
    if(cross){
      const otra = cross.sala ? cross.sala.name : 'otra sala';
      if(!confirm(`Nota: ${otra} tiene reservado ${_agendFmtRange(cross.startMin, cross.endMin)} ese día.\n\n¿Confirmar de todas formas?`)) return;
    }
  }

  const data = agendLoadData();
  if(!Array.isArray(data[found.salaId][found.dateStr])){
    data[found.salaId][found.dateStr] = _agendMigrateDayEntry(data[found.salaId][found.dateStr]);
  }
  const arr = data[found.salaId][found.dateStr];
  const idx = arr.findIndex(r => r && r.id === reqId);
  if(idx < 0) return;
  const original = arr[idx];

  let targetReq;
  if(newDate === found.dateStr){
    // Misma fecha → solo actualizar horario/estado
    original.startMin = p.startMin;
    original.endMin   = p.endMin;
    if(p.block) original.block = p.block; else delete original.block;
    original.estado = 'aprobada';
    original.comentarioVisado = p.comentario || original.comentarioVisado || '';
    original.visadoAt = Date.now();
    original.updatedAt = Date.now();
    delete original.propuesta;
    targetReq = original;
  } else {
    // Otra fecha → mover: tombstone en el bucket original, nueva en el destino
    targetReq = Object.assign({}, original, {
      startMin: p.startMin,
      endMin: p.endMin,
      estado: 'aprobada',
      comentarioVisado: p.comentario || original.comentarioVisado || '',
      visadoAt: Date.now(),
      updatedAt: Date.now()
    });
    if(p.block) targetReq.block = p.block; else delete targetReq.block;
    delete targetReq.propuesta;
    arr[idx] = { id: reqId, deleted: true, deletedAt: Date.now(), updatedAt: Date.now() };
    if(!Array.isArray(data[salaId][newDate])){
      data[salaId][newDate] = _agendMigrateDayEntry(data[salaId][newDate]);
    }
    data[salaId][newDate].push(targetReq);
    data[salaId][newDate].sort((a,b) => a.startMin - b.startMin);
  }
  agendSaveData(data);
  agendScheduleSync();
  try{ notifyAdminsOfNewRequest(); }catch(e){}
  toast && toast('✅ Nuevo horario aceptado');
  // Confirmación formal al solicitante + copia a secretarías de pabellón
  _agendOfrecerMailtoConfirmacion(targetReq, salaId, newDate);
  agendOpenDetalle(reqId);
}

// Unidad: rechazar la propuesta → la solicitud queda rechazada (libera el
// horario original) y el servicio queda avisado.
function agendRechazarPropuesta(reqId){
  const found = _agendFindRequest(reqId);
  if(!found){ return; }
  const motivo = prompt('¿Por qué no te sirve el horario propuesto? (opcional)') || '';
  const data = agendLoadData();
  if(!Array.isArray(data[found.salaId][found.dateStr])){
    data[found.salaId][found.dateStr] = _agendMigrateDayEntry(data[found.salaId][found.dateStr]);
  }
  const arr = data[found.salaId][found.dateStr];
  const idx = arr.findIndex(r => r && r.id === reqId);
  if(idx < 0) return;
  const slot = arr[idx];
  slot.estado = 'rechazada';
  slot.comentarioVisado = 'La unidad no aceptó la contrapropuesta' + (motivo ? ': ' + motivo : '');
  slot.updatedAt = Date.now();
  agendSaveData(data);
  agendScheduleSync();
  try{ notifyAdminsOfNewRequest(); }catch(e){}
  toast && toast('Propuesta rechazada. El servicio fue avisado.');
  agendOpenDetalle(reqId);
}

// Correo al solicitante avisando de la contrapropuesta de horario.
function _agendOfrecerMailtoPropuesta(req, salaId, dateStr){
  if(!req || !req.solicitanteEmail){
    toast && toast('Propuesta enviada (sin email del solicitante registrado)');
    return;
  }
  const sala = _agendGetSala(salaId);
  const unidad = _agendGetUnidad(req.unidadCode);
  const p = req.propuesta || {};
  const dtOrig = _agendParseDateStr(dateStr);
  const dtProp = _agendParseDateStr(p.date || dateStr);
  const fechaOrig = `${_agendDiasES[dtOrig.getDay()]} ${dtOrig.getDate()} de ${_agendMesesES[dtOrig.getMonth()]} de ${dtOrig.getFullYear()}`;
  const fechaProp = `${_agendDiasES[dtProp.getDay()]} ${dtProp.getDate()} de ${_agendMesesES[dtProp.getMonth()]} de ${dtProp.getFullYear()}`;
  const horaOrig = (typeof req.startMin==='number'&&typeof req.endMin==='number') ? _agendFmtRange(req.startMin, req.endMin) : '—';
  const horaProp = (p.block === 'AM' || p.block === 'PM')
    ? `Bloque ${p.block} ${p.block==='PM'?'(14:00–20:00)':'(08:00–14:00)'}`
    : ((typeof p.startMin==='number'&&typeof p.endMin==='number') ? _agendFmtRange(p.startMin, p.endMin) : '—');
  const subject = `Propuesta de nuevo horario · ${sala?sala.name:'Procedimiento'} · ${dtProp.getDate()}/${_agendPad(dtProp.getMonth()+1)}/${dtProp.getFullYear()}`;
  const lineas = [];
  lineas.push(`Estimado(a) ${req.solicitanteNombre || ''}:`);
  lineas.push('');
  lineas.push(`El Servicio de Anestesia no puede atender tu solicitud en el horario pedido, pero te propone una alternativa:`);
  lineas.push('');
  lineas.push(`• Sala: ${sala ? sala.name : '—'}`);
  lineas.push(`• Unidad solicitante: ${unidad ? unidad.name : '—'}`);
  lineas.push(`• Paciente: ${req.paciente || '—'}${req.edad?` · ${req.edad} años`:''}`);
  lineas.push(`• Procedimiento: ${req.procedimiento || '—'}`);
  _agendTriagePairs(req).forEach(([k,v]) => lineas.push(`• ${k}: ${v}`));
  lineas.push('');
  lineas.push(`Horario solicitado originalmente: ${fechaOrig} · ${horaOrig}`);
  lineas.push(`HORARIO PROPUESTO: ${fechaProp} · ${horaProp}`);
  if(p.comentario){
    lineas.push('');
    lineas.push(`Comentario del Servicio de Anestesia:`);
    lineas.push(`"${p.comentario}"`);
  }
  lineas.push('');
  lineas.push(`Por favor ingresa a la aplicación de Agendamiento para ACEPTAR o RECHAZAR esta propuesta, o responde este correo.`);
  lineas.push('');
  lineas.push('— Servicio de Anestesia');
  const body = lineas.join('\n');
  const url = `mailto:${encodeURIComponent(req.solicitanteEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  const ok = confirm(`Propuesta registrada. ¿Abrir tu cliente de correo para avisar a ${req.solicitanteEmail}?\n\nSi cancelas, la propuesta queda registrada igualmente.`);
  if(!ok) return;
  try{
    window.location.href = url;
  }catch(e){
    try{ window.open(url, '_self'); }catch(e2){}
  }
}

// --- Vista: Overview admin (pendientes / aprobadas / rechazadas) ---
function agendShowOverview(tab){
  AGEND_STATE.overviewTab = tab || 'pendiente';
  _agendShowView('overview', true);
  _agendRefreshChromeForView('overview');
  agendOverviewTab(AGEND_STATE.overviewTab);
  // El admin ya revisó la bandeja → resetear contador de "nuevas"
  try{ agendMarkAdminSeen(); }catch(e){}
  // Refrescar desde la nube por si llegaron solicitudes nuevas
  try{ agendSyncNow().then(()=>{ if(AGEND_STATE.view==='overview') agendOverviewTab(AGEND_STATE.overviewTab); }); }catch(e){}
}
// ============================================================
// SEGUIMIENTO DE SOLICITUDES (vista pública de solo lectura, sin PIN)
// Igual que el Seguimiento de Interconsultas: cualquiera puede ver el
// estado de las solicitudes. Pacientes anonimizados con iniciales.
// ============================================================
// Mismas etiquetas e íconos que el Seguimiento de Interconsultas:
// 🎫 Recibida → 🔁 Propuesta → 🔵 Aprobada → ✅ Realizada · ❌ Rechazada
const AGEND_SEG_META = {
  pendiente: { ico:'🎫', label:'Recibida' },
  propuesta: { ico:'🔁', label:'Propuesta' },
  aprobada:  { ico:'🔵', label:'Aprobada' },
  realizada: { ico:'✅', label:'Realizada' },
  rechazada: { ico:'❌', label:'Rechazada' }
};
function agendEnterSeguimiento(){
  _agendShowView('seguimiento', true);
  _agendRefreshChromeForView('seguimiento');
  _agendRenderSeguimiento();
  // Refrescar desde la nube por si hubo cambios de estado
  try{ agendSyncNow().then(()=>{ if(AGEND_STATE.view==='seguimiento') _agendRenderSeguimiento(); }); }catch(e){}
}
function _agendInicialesPaciente(nombre){
  const parts = String(nombre||'').trim().split(/\s+/).filter(Boolean);
  if(!parts.length) return '—';
  return parts.map(p => (p[0]||'').toUpperCase() + '.').join(' ');
}
function _agendRenderSeguimiento(){
  const cont = document.getElementById('agendSegList');
  const cCont = document.getElementById('agendSegCounts');
  if(!cont) return;
  const all = _agendAllRequests();
  const counts = { pendiente:0, propuesta:0, aprobada:0, realizada:0, rechazada:0 };
  all.forEach(r => { if(counts[r.estado] !== undefined) counts[r.estado]++; });
  if(cCont){
    cCont.innerHTML = Object.keys(AGEND_SEG_META).map(k =>
      `<span class="agend-seg-chip ${k}">${AGEND_SEG_META[k].ico} ${AGEND_SEG_META[k].label}s · ${counts[k]}</span>`
    ).join('');
  }
  if(all.length === 0){
    cont.innerHTML = '<div class="agend-empty">Aún no hay solicitudes para seguir.</div>';
    return;
  }
  // Activas primero (pendiente → propuesta), luego aprobadas y rechazadas;
  // dentro de cada grupo por fecha del procedimiento.
  const orden = { pendiente:0, propuesta:1, aprobada:2, realizada:3, rechazada:4 };
  const list = all.slice().sort((a,b)=>{
    const o = (orden[a.estado] ?? 9) - (orden[b.estado] ?? 9);
    if(o !== 0) return o;
    const c = String(a.dateStr).localeCompare(String(b.dateStr));
    if(c !== 0) return c;
    return (a.startMin||0) - (b.startMin||0);
  });
  cont.innerHTML = list.map(r => {
    const sala = _agendGetSala(r.salaId);
    const unidad = _agendGetUnidad(r.unidadCode);
    const dt = _agendParseDateStr(r.dateStr);
    const m = AGEND_SEG_META[r.estado] || AGEND_SEG_META.pendiente;
    const hor = r.block
      ? ('Bloque ' + r.block)
      : ((typeof r.startMin==='number' && typeof r.endMin==='number') ? _agendFmtRange(r.startMin, r.endMin) : '—');
    const coment = r.comentarioVisado ? `<div class="agend-seg-coment">💬 ${_gpEsc(r.comentarioVisado)}</div>` : '';
    return `
      <div class="agend-slot ${r.estado}" style="cursor:default">
        <div class="agend-slot-body">
          <div class="agend-slot-name">${_gpEsc(_agendInicialesPaciente(r.paciente))} · ${_gpEsc(r.procedimiento||'—')}</div>
          <div class="agend-slot-meta">${sala ? sala.ico+' '+sala.name : ''} · ${dt.getDate()}/${_agendPad(dt.getMonth()+1)}/${dt.getFullYear()} · ${hor}${unidad ? ' · '+unidad.name : ''}${r.solicitanteNombre ? ' · '+_gpEsc(r.solicitanteNombre) : ''}</div>
          ${coment}
        </div>
        <div class="agend-seg-chip ${r.estado}" style="flex-shrink:0;align-self:center">${m.ico} ${m.label}</div>
      </div>`;
  }).join('');
}

function agendOverviewTab(tab){
  AGEND_STATE.overviewTab = tab;
  document.querySelectorAll('#agendScreen .agend-overview-tab').forEach(b => {
    b.classList.toggle('active', b.getAttribute('data-tab') === tab);
  });
  // Separación vascular: en contexto Portal Vascular solo se ven las vasculares;
  // en el agendamiento general se excluyen (viven en el Portal Vascular).
  const _isVasc = r => { const s = _agendGetSala(r.salaId); return !!(s && s.vascular); };
  const all = _agendAllRequests().filter(r => AGEND_STATE.vascOnly ? _isVasc(r) : !_isVasc(r));
  const counts = { pendiente:0, propuesta:0, aprobada:0, realizada:0, rechazada:0 };
  all.forEach(r => { if(counts[r.estado]!==undefined) counts[r.estado]++; });
  document.getElementById('ovCountPend').textContent = counts.pendiente;
  const elProp = document.getElementById('ovCountProp'); if(elProp) elProp.textContent = counts.propuesta;
  document.getElementById('ovCountAprob').textContent = counts.aprobada;
  const elReal = document.getElementById('ovCountReal'); if(elReal) elReal.textContent = counts.realizada;
  document.getElementById('ovCountRech').textContent = counts.rechazada;
  // Filtrar y ordenar por fecha+inicio ascendente
  const list = all
    .filter(r => r.estado === tab)
    .sort((a,b) => {
      const cmp = a.dateStr.localeCompare(b.dateStr);
      if(cmp !== 0) return cmp;
      return (a.startMin||0) - (b.startMin||0);
    });
  const cont = document.getElementById('agendOverviewList');
  if(list.length === 0){
    cont.innerHTML = `<div class="agend-empty">Sin solicitudes <strong>${tab}s</strong>.</div>`;
    return;
  }
  cont.innerHTML = list.map(r => {
    const sala = _agendGetSala(r.salaId);
    const unidad = _agendGetUnidad(r.unidadCode);
    const dt = _agendParseDateStr(r.dateStr);
    const rangoTxt = (typeof r.startMin === 'number' && typeof r.endMin === 'number')
      ? _agendFmtRange(r.startMin, r.endMin)
      : '—';
    const horaCorta = (typeof r.startMin === 'number') ? _agendMinToHHMM(r.startMin) : '—';
    return `
      <button type="button" class="agend-slot ${r.estado}" onclick="agendOpenDetalle('${r.id}')">
        <div class="agend-slot-hour">${horaCorta}</div>
        <div class="agend-slot-body">
          <div class="agend-slot-name">${_gpEsc(r.paciente)} · ${_gpEsc(r.procedimiento)}</div>
          <div class="agend-slot-meta">${sala?sala.ico+' '+sala.name:''} · ${dt.getDate()}/${_agendPad(dt.getMonth()+1)}/${dt.getFullYear()} · ${rangoTxt} · ${unidad?unidad.name:''}</div>
        </div>
        <div class="agend-slot-status ${r.estado}">${r.estado}</div>
      </button>`;
  }).join('');
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
  (state.events||[]).filter(e=>!e.deleted).forEach(e=>{
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

// ── Estado del calendario de eventos ──────────────────────────────────────
let _evtCalYear  = null;
let _evtCalMonth = null; // 0-indexed (0=Enero)
let _evtSelectedDay = null;

function renderEventos(){
  updateNotifPermBtn();
  // Inicializar al mes actual si no está configurado
  if(_evtCalYear === null || _evtCalMonth === null){
    const now = new Date();
    _evtCalYear  = now.getFullYear();
    _evtCalMonth = now.getMonth();
  }
  _renderEvtCalGrid();
  _renderEvtDayDetail();
  // Actualizar visibilidad del botón admin-only dentro de la sección
  const adminBtns = document.querySelectorAll('#view-eventos .admin-only');
  adminBtns.forEach(b=>{ b.style.display = (state && state.isAdmin) ? '' : 'none'; });
}

function evtCalNav(delta){
  let d = new Date(_evtCalYear, _evtCalMonth + delta, 1);
  _evtCalYear  = d.getFullYear();
  _evtCalMonth = d.getMonth();
  _evtSelectedDay = null;
  _renderEvtCalGrid();
  _renderEvtDayDetail();
}

function selectEvtDay(dateStr){
  _evtSelectedDay = (_evtSelectedDay === dateStr) ? null : dateStr;
  _renderEvtCalGrid();
  _renderEvtDayDetail();
}

function _renderEvtCalGrid(){
  const container = document.getElementById('evtCalContainer');
  if(!container) return;

  const monthNames = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                      'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const dayNames = ['Lu','Ma','Mi','Ju','Vi','Sá','Do'];

  const year  = _evtCalYear;
  const month = _evtCalMonth;
  const today = todayISO();

  // Primer día del mes y total de días
  const firstDay   = new Date(year, month, 1);
  const daysInMonth = new Date(year, month+1, 0).getDate();

  // Desplazamiento inicial: Lunes=0 … Domingo=6
  let startDow = (firstDay.getDay() + 6) % 7;

  // Construir mapa de eventos por día { dayNumber: [events] }
  const allEvts = expandedEvents();
  const byDay = {};
  allEvts.forEach(e=>{
    if(!e.date) return;
    const [ey, em, ed] = e.date.split('-').map(Number);
    if(ey === year && (em-1) === month){
      (byDay[ed] = byDay[ed]||[]).push(e);
    }
  });

  // Construir celdas
  let cells = '';
  let idx = 0;
  for(let i=0; i<startDow; i++){ cells += '<div class="evt-cal-cell empty"></div>'; idx++; }

  for(let d=1; d<=daysInMonth; d++){
    const ds  = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const isT = ds === today;
    const isS = ds === _evtSelectedDay;
    const evts = byDay[d] || [];

    // Hasta 3 puntos de colores distintos
    const colors = [...new Set(evts.slice(0,4).map(e=>{
      if(e.kind==='birthday') return '#ec4899';
      const m = eventTypeMeta(e.type); return m ? m.color : '#6366f1';
    }))].slice(0,3);
    const dots = colors.map(c=>`<span class="evt-cal-dot" style="background:${c}"></span>`).join('');

    cells += `<div class="evt-cal-cell${isT?' today':''}${isS?' selected':''}${evts.length?' has-events':''}" onclick="selectEvtDay('${ds}')"><span class="evt-cal-num">${d}</span>${dots?`<div class="evt-cal-dots">${dots}</div>`:''}</div>`;
    idx++;
  }
  // Completar última fila
  while(idx % 7 !== 0){ cells += '<div class="evt-cal-cell empty"></div>'; idx++; }

  // Leyenda de tipos de eventos presentes en el mes
  const typesInMonth = [...new Set(
    Object.values(byDay).flat().filter(e=>e.kind!=='birthday').map(e=>e.type)
  )];
  let legendHtml = '';
  if(typesInMonth.length){
    const items = typesInMonth.map(t=>{
      const m = eventTypeMeta(t);
      return m ? `<span class="evt-cal-legend-item"><span class="evt-cal-legend-dot" style="background:${m.color}"></span>${m.label}</span>` : '';
    }).join('');
    const hasBday = Object.values(byDay).flat().some(e=>e.kind==='birthday');
    const bdayItem = hasBday ? `<span class="evt-cal-legend-item"><span class="evt-cal-legend-dot" style="background:#ec4899"></span>Cumpleaños</span>` : '';
    legendHtml = `<div class="evt-cal-legend">${items}${bdayItem}</div>`;
  }

  container.innerHTML = `
    <div class="evt-cal-wrap">
      <div class="evt-cal-header">
        <button class="evt-cal-nav" onclick="evtCalNav(-1)">&#8249;</button>
        <span class="evt-cal-title">${monthNames[month]} ${year}</span>
        <button class="evt-cal-nav" onclick="evtCalNav(1)">&#8250;</button>
      </div>
      <div class="evt-cal-grid">
        ${dayNames.map(n=>`<div class="evt-cal-dow">${n}</div>`).join('')}
        ${cells}
      </div>
      ${legendHtml}
    </div>`;
}

function _renderEvtDayDetail(){
  const box = document.getElementById('evtDayDetail');
  if(!box) return;

  if(!_evtSelectedDay){
    // Sin día seleccionado: lista desplegable colapsada por defecto
    const prox = eventsInNextDays(30);
    const count = prox.length;
    const inner = count === 0
      ? '<div style="padding:12px 14px;font-size:12.5px;color:var(--muted);text-align:center">Sin eventos en los próximos 30 días</div>'
      : prox.map(renderEventCard).join('');
    box.innerHTML = `
      <details class="evt-prox-details">
        <summary class="evt-prox-summary">
          <span>📋 Próximos eventos</span>
          <span class="evt-prox-badge">${count}</span>
          <span class="evt-prox-arrow">›</span>
        </summary>
        <div class="evt-prox-body">${inner}</div>
      </details>`;
    return;
  }

  const dayEvts = expandedEvents().filter(e=>e.date===_evtSelectedDay);
  const fecha   = formatDateLong(_evtSelectedDay);
  const canEdit = state && state.isAdmin;
  if(dayEvts.length === 0){
    const addBtn = canEdit
      ? `<button class="btn sm accent" style="margin-top:10px" onclick="openEventModal(null)">+ Agregar en esta fecha</button>` : '';
    box.innerHTML = `<div class="empty" style="padding:18px;text-align:center"><span style="font-size:24px">📅</span><br><strong style="font-size:13px">${fecha}</strong><br><span style="font-size:12px;color:var(--muted)">Sin eventos este día</span>${addBtn}</div>`;
  } else {
    box.innerHTML = `<h4 style="font-size:13px;font-weight:700;color:var(--primary-dark);margin:0 0 8px">📅 ${fecha}</h4>` + dayEvts.map(renderEventCard).join('');
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
    updatedAt: new Date().toISOString()
  };
  state.events = state.events||[];
  if(isNew==='true' || isNew===true){
    ev.createdAt = ev.updatedAt;
    state.events.unshift(ev);
  } else {
    const prev = state.events.find(x=>x.id===id) || {};
    ev.createdAt = prev.createdAt || ev.updatedAt;
    if(!ev.createdBy) ev.createdBy = prev.createdBy || null;
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
  // Tombstone (no quitar del arreglo): el borrado se sincroniza y no reaparece.
  const now = new Date().toISOString();
  state.events = (state.events||[]).map(e=> e.id===id ? {...e, deleted:true, updatedAt:now} : e);
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

// Badges de notificación en las tarjetas del home:
//  - Vacaciones: solicitudes pendientes de aprobar
//  - Intercambios: ofertas de turno disponibles (sin tomar)
function _setNotif(id, n){
  const el = document.getElementById(id);
  if(!el) return;
  if(n > 0){ el.textContent = n > 99 ? '99+' : n; el.style.display = 'flex'; }
  else { el.style.display = 'none'; }
}
function updateHomeBadges(){
  if(!state) return;
  const pendingVacs = (state.vacations||[]).filter(v=>v.status==='pending' && !v.deleted).length;
  const openExch    = (state.exchanges||[]).filter(e=>e.status==='open' && !e.deleted).length;
  _setNotif('vacNotif', pendingVacs);
  _setNotif('exchNotif', openExch);
  // Mantener también el badge antiguo del título de Vacaciones
  const hb = document.getElementById('vacBadgeHome');
  if(hb){ hb.textContent = pendingVacs>0?pendingVacs:''; hb.style.display = pendingVacs>0?'inline-block':'none'; }
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
const PIN_SALT = 'appnesthesia_v1_salt'; // LEGADO: solo para verificar PINs creados antes del endurecimiento
const ADMIN_USER_ID = '__admin__';
const PIN_ITERATIONS = 200000; // PBKDF2: encarece cada intento de adivinanza

// --- Hash legado (v1): SHA-256 de salt:scope:pin (un solo paso, rápido de romper).
//     Se conserva SOLO para validar PINs antiguos y migrarlos de forma transparente.
async function hashPINLegacy(pin, scope){
  const data = new TextEncoder().encode(PIN_SALT + ':' + scope + ':' + pin);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

function _bytesToHex(bytes){
  return Array.from(bytes).map(b=>b.toString(16).padStart(2,'0')).join('');
}
function _hexToBytes(hex){
  const out = new Uint8Array(hex.length/2);
  for(let i=0;i<out.length;i++) out[i] = parseInt(hex.substr(i*2,2),16);
  return out;
}
// Comparación en tiempo constante (no filtra info por el tiempo que tarda).
function _pinEqual(a, b){
  if(typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for(let i=0;i<a.length;i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Si el navegador no expone Web Crypto (típico fuera de un contexto seguro
// https), NO se puede verificar el PIN. Devuelve un mensaje claro o null.
function _pinCryptoUnavailableMsg(){
  return (typeof crypto === 'undefined' || !crypto.subtle)
    ? 'Este navegador no puede verificar el PIN de forma segura (contexto no seguro). Abre la app desde el enlace https oficial e inténtalo de nuevo.'
    : null;
}

// --- Hash fuerte (v2): PBKDF2-SHA256 con sal aleatoria por usuario.
async function _derivePIN(pin, scope, saltBytes, iterations){
  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(scope + ':' + pin), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name:'PBKDF2', salt:saltBytes, iterations:iterations, hash:'SHA-256' },
    keyMaterial, 256
  );
  return _bytesToHex(new Uint8Array(bits));
}

// Crea un hash NUEVO (v2) con sal aleatoria. Formato: "pbkdf2$<iter>$<saltHex>$<hashHex>".
async function makePINHash(pin, scope){
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await _derivePIN(pin, scope, salt, PIN_ITERATIONS);
  return 'pbkdf2$' + PIN_ITERATIONS + '$' + _bytesToHex(salt) + '$' + hash;
}

// Verifica un PIN contra un hash almacenado (v2 PBKDF2 o v1 legado).
// Devuelve { ok, upgrade }. Si era v1 y coincide, "upgrade" trae el hash v2
// para re-guardarlo (migración transparente: el usuario no nota nada).
async function verifyPINHash(pin, scope, stored){
  if(!stored) return { ok:false, upgrade:null };
  if(typeof stored === 'string' && stored.indexOf('pbkdf2$') === 0){
    const parts = stored.split('$'); // ['pbkdf2', iter, saltHex, hashHex]
    const iter = parseInt(parts[1], 10) || PIN_ITERATIONS;
    const salt = _hexToBytes(parts[2]);
    const h = await _derivePIN(pin, scope, salt, iter);
    return { ok: _pinEqual(h, parts[3]), upgrade:null };
  }
  // Legado v1: validar con el método viejo y, si coincide, devolver el hash fuerte.
  const h = await hashPINLegacy(pin, scope);
  if(_pinEqual(h, stored)){
    const upgrade = await makePINHash(pin, scope);
    return { ok:true, upgrade };
  }
  return { ok:false, upgrade:null };
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
  // Defensivo: si state.adminUser vino de la nube, llega SIN activityLog ni
  // preferences (son campos privados del dispositivo que no se sincronizan).
  // Hay que reponerlos o el login revienta en 'admin.activityLog.unshift'.
  if(!Array.isArray(state.adminUser.activityLog)) state.adminUser.activityLog = [];
  if(!state.adminUser.preferences) state.adminUser.preferences = {notifications:true, hideOthers:false};
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
    // La verificación usa PBKDF2 con 200.000 iteraciones (lento A PROPÓSITO,
    // por seguridad) y puede tomar ~0.5-1.5 s en un teléfono. Avisar que se
    // está trabajando para que no parezca que la app quedó pegada.
    try{ const m = document.getElementById('pinMsg'); if(m) m.textContent = 'Verificando…'; }catch(e){}
    setTimeout(()=>{ if(_pinOnComplete) _pinOnComplete(pin); }, 80);
  }
}
function pinError(msg){
  document.getElementById('pinMsg').textContent = msg||'';
  renderPinDisplay(true);
  setTimeout(()=>{ _pinBuffer=''; renderPinDisplay(); }, 350);
}

// --- PINs en la nube ---
// Consulta el estado remoto y devuelve los PINs registrados (mejor esfuerzo).
// Se usa ANTES de ofrecer "primer ingreso": si el PIN ya existe en la nube,
// el dispositivo nuevo debe pedirlo, no permitir crear uno nuevo.
async function _fetchRemotePins(){
  const base = getBackendURL();
  if(!base || !INSTITUTION) return null;
  try{
    const r = await fetch(base + '/api/state/' + encodeURIComponent(INSTITUTION.id), _stateGetOpts());
    if(!r.ok) return null;
    const remote = await r.json();
    if(!remote || remote._empty) return null;
    const staffPins = {};
    (remote.staff||[]).forEach(s=>{ if(s && s.id && s.pinHash) staffPins[s.id] = s.pinHash; });
    return { staffPins, adminPinHash: remote.adminPinHash || null };
  }catch(e){ return null; }
}

// Si este dispositivo no tiene el PIN de admin pero la nube sí → adoptarlo.
async function _syncAdminPinFromCloud(){
  if(state && state.adminPinHash) return;
  const pins = await _fetchRemotePins();
  if(pins && pins.adminPinHash){
    state.adminPinHash = pins.adminPinHash;
    saveRaw();
  }
}

// --- Admin PIN ---
function adminSetupNeeded(){ return !state || !state.adminPinHash; }
async function promptSetAdminPin(){
  return new Promise(res=>{
    let firstPin = null;
    openPinPad({
      title:'🛡️ Configurar PIN de administrador',
      sub:'Este PIN da acceso a modo admin. Anótalo en lugar seguro.',
      maxLen:4,
      onComplete: async(pin)=>{
        const ce = _pinCryptoUnavailableMsg();
        if(ce){ pinError(ce); return; }
        if(!firstPin){
          firstPin = pin;
          openPinPad({
            title:'Confirma el PIN',
            sub:'Repite los 4 dígitos.',
            maxLen:4,
            onComplete: async(pin2)=>{
              if(pin2 !== firstPin){
                pinError('No coinciden, vuelve a empezar');
                firstPin = null;
                setTimeout(()=>res(promptSetAdminPin()), 500);
                return;
              }
              try{
                state.adminPinHash = await makePINHash(pin, '__admin__');
              }catch(e){ pinError('No se pudo guardar el PIN: ' + (e && e.message ? e.message : e)); return; }
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
      sub:'Ingresa el PIN para activar modo admin.',
      maxLen:4,
      onComplete: async(pin)=>{
        try{
          const ce = _pinCryptoUnavailableMsg();
          if(ce){ pinError(ce); return; }
          const r = await verifyPINHash(pin, '__admin__', state.adminPinHash);
          if(r.ok){
            if(r.upgrade){ state.adminPinHash = r.upgrade; save(); } // migración transparente a PBKDF2
            closePinPad(); res(true);
          } else { pinError('PIN incorrecto'); }
        }catch(e){
          pinError('No se pudo verificar el PIN: ' + (e && e.message ? e.message : e));
        }
      },
      onCancel: ()=>res(false)
    });
  });
}

// --- User Picker (lista inline con dropdown nativo + buscador, sin modal) ---
function renderUserPicker(){
  ensureAllUserDefaults();
  const inst = INSTITUTION ? (INSTITUTION.shortName||INSTITUTION.name) : '';
  var instEl = document.getElementById('userPickerInst');
  if(instEl) instEl.textContent = inst;
  var grid = document.getElementById('userGrid');
  if(!grid) return;
  var staff = (state.staff||[]).slice().sort(function(a,b){return String(a.name).localeCompare(String(b.name),'es');});

  var adminLock = state.adminPinHash ? '🔒' : '✨';
  var html = '';

  // 1) Administrador (siempre arriba)
  html += '<button type="button" class="user-item user-item-admin" onclick="selectAdmin()">'
    + '<div class="user-item-avatar" style="background:linear-gradient(135deg,#f59e0b,#d97706)">🛡️</div>'
    + '<div style="flex:1;min-width:0"><div class="user-item-name">Administrador</div><div class="user-item-role">Gestión completa del servicio</div></div>'
    + '<div class="user-item-lock">'+adminLock+'</div>'
    + '</button>';

  if(staff.length === 0){
    html += '<div style="color:var(--muted);font-size:13px;padding:12px;text-align:center">Sin staff. Ingresa como Administrador para agregar miembros.</div>';
  } else {
    // Solo buscador grande — sin lista completa ni dropdown (se ve más limpio)
    html += '<div style="margin-top:14px">'
      + '<label style="display:block;font-size:12px;color:var(--muted);margin-bottom:6px;font-weight:600">Tu nombre ('+staff.length+' anestesiólogos)</label>'
      + '<input type="text" id="userInlineSearch" placeholder="🔎 Escribe tu nombre…" autocomplete="off" oninput="renderInlineUserList()" '
      + 'style="width:100%;padding:14px 14px;font-size:15px;border:1.5px solid var(--border);border-radius:12px;font-family:inherit;margin-bottom:10px" />'
      + '<div id="userInlineList" class="staff-picker-list"></div>'
      + '</div>';
  }

  grid.innerHTML = html;
  try{ renderInlineUserList(); }catch(e){}
}

// Handler del <select> nativo
function onUserSelectChange(userId){
  if(!userId) return;
  try{ selectUser(userId); }catch(e){ console.error('selectUser error:', e); alert('Error al seleccionar usuario: '+e.message); }
}

// Lista inline con buscador (NO usa modal).
// Por defecto la lista está vacía: solo aparecen resultados al escribir.
// (Vista más limpia: no se muestra el listado completo de anestesiólogos.)
function renderInlineUserList(){
  var list = document.getElementById('userInlineList');
  if(!list) return;
  var searchEl = document.getElementById('userInlineSearch');
  var q = (searchEl && searchEl.value ? searchEl.value : '').trim();
  if(!q){
    list.innerHTML = '<div style="padding:14px;color:var(--muted);text-align:center;font-size:13px">Empieza a escribir tu nombre para buscar…</div>';
    return;
  }
  var norm = function(s){ return (s||'').toString().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,''); };
  var nq = norm(q);
  var staff = (state.staff||[]).slice().sort(function(a,b){return String(a.name).localeCompare(String(b.name),'es');});
  var filtered = staff.filter(function(s){ return norm(s.name).includes(nq) || norm(s.role||'').includes(nq); });
  if(filtered.length === 0){
    list.innerHTML = '<div style="padding:14px;color:var(--muted);text-align:center;font-size:13px">Sin resultados para "'+q.replace(/</g,'&lt;')+'"</div>';
    return;
  }
  var html = '';
  for(var i=0; i<filtered.length; i++){
    var s = filtered[i];
    var initials = (s.name||'?').split(/\s+/).slice(0,2).map(function(w){return w[0]||'';}).join('').toUpperCase();
    var hasPin = s.pinHash ? '🔒' : '✨';
    html += '<button type="button" class="staff-picker-row" onclick="selectUser(\''+s.id+'\')">'
      + '<div class="user-item-avatar">'+initials+'</div>'
      + '<div style="flex:1;min-width:0;text-align:left"><div class="user-item-name">'+s.name+'</div><div class="user-item-role">'+(s.role||'')+'</div></div>'
      + '<div class="user-item-lock">'+hasPin+'</div>'
      + '</button>';
  }
  list.innerHTML = html;
}

// Compatibilidad: si algo viejo todavía llama openStaffPicker, simplemente hace scroll a la lista
function openStaffPicker(){
  var el = document.getElementById('userInlineSearch');
  if(el){ try{ el.focus(); el.scrollIntoView({behavior:'smooth', block:'center'}); }catch(e){} }
}
function renderStaffPickerList(){ try{ renderInlineUserList(); }catch(e){} }

async function selectAdmin(){
  // Diagnóstico opcional: abrir la app con ?diag=1 muestra en pantalla cada
  // paso del login de admin (para depurar en dispositivos donde no hay consola).
  const _DIAG = (location.search.indexOf('diag') !== -1);
  const _dlog = (m)=>{ if(_DIAG){ try{ alert('[diag] ' + m); }catch(e){} } };
  try{
    _dlog('inicio · setupNeeded=' + adminSetupNeeded() + ' · secureCtx=' + window.isSecureContext + ' · cryptoSubtle=' + !!(window.crypto && window.crypto.subtle));
    // Antes de tratar como "primera vez", revisar si el PIN ya existe en la nube
    if(adminSetupNeeded()){
      try{ await _syncAdminPinFromCloud(); _dlog('syncCloud OK · setupNeeded ahora=' + adminSetupNeeded()); }
      catch(e){ _dlog('syncCloud ERROR: ' + (e && e.message ? e.message : e)); }
    }
    let ok;
    if(adminSetupNeeded()){
      _dlog('rama: CREAR PIN (no hay hash ni local ni en la nube)');
      ok = await promptSetAdminPin();
    } else {
      _dlog('rama: VERIFICAR PIN');
      ok = await promptVerifyAdminPin();
    }
    if(!ok){ _dlog('resultado: cancelado / no-ok'); return; }
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
    _dlog('login completado ✔');
    try{ updateEventBadge(); }catch(e){}
    try{ checkReminders(); }catch(e){}
    // Aviso de nuevas solicitudes de agendamiento (solo admin) + polling
    try{ checkAgendNewForAdmin(); startAgendAdminPolling(); }catch(e){}
    // Aviso de nuevas interconsultas (solo admin) + polling
    try{ icCheckNewForAdmin(); startIcAdminPolling(); }catch(e){}
    // Pedir permiso de notificaciones para los avisos de solicitudes
    try{
      if(notifSupported() && Notification.permission === 'default'){
        setTimeout(()=>{ try{ requestNotifPermission(); }catch(e){} }, 1500);
      }
    }catch(e){}
  }catch(e){
    // Nunca fallar en silencio: si algo del flujo de login revienta, avisar.
    try{ alert('No se pudo ingresar como administrador: ' + (e && e.message ? e.message : e)); }catch(_){}
  }
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
  // Antes de tratar como "primer ingreso", revisar si este usuario YA tiene
  // un PIN registrado en la nube (configurado desde otro dispositivo).
  if(!u.pinHash && !_pinResetActive(u)){
    try{
      const pins = await _fetchRemotePins();
      if(pins && pins.staffPins[u.id]){
        u.pinHash = pins.staffPins[u.id];
        saveRaw();
      }
    }catch(e){}
  }
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
  // Auto-reparación silenciosa: garantiza que el PIN de esta persona esté en la nube
  try{ _ensureMyPinInCloud(u); }catch(e){}
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
        const ce = _pinCryptoUnavailableMsg();
        if(ce){ pinError(ce); return; }
        if(!firstPin){
          firstPin = pin;
          openPinPad({
            title:'Confirma tu PIN',
            sub:'Repite los 4 dígitos.',
            maxLen:4,
            onComplete: async(pin2)=>{
              if(pin2 !== firstPin){
                pinError('No coinciden');
                firstPin = null;
                setTimeout(()=>res(promptSetupUserPin(user)), 500);
                return;
              }
              try{
                user.pinHash = await makePINHash(pin, user.id);
                user.pinSetAt = Date.now(); // marca "PIN vigente" (gana a reinicios anteriores)
              }catch(e){ pinError('No se pudo guardar el PIN: ' + (e && e.message ? e.message : e)); return; }
              save();
              // Sube el PIN a la nube de inmediato (los no-admin no hacen push del staff array)
              _pushMyPinHash(user.id, user.pinHash).catch(()=>{});
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
      sub:'Ingresa tu PIN de 4 dígitos',
      maxLen:4,
      onComplete: async(pin)=>{
        try{
          const ce = _pinCryptoUnavailableMsg();
          if(ce){ pinError(ce); return; }
          const r = await verifyPINHash(pin, user.id, user.pinHash);
          if(r.ok){
            if(r.upgrade){ // migración transparente a PBKDF2: re-guardar y subir a la nube
              user.pinHash = r.upgrade; user.pinSetAt = Date.now(); save();
              _pushMyPinHash(user.id, user.pinHash).catch(()=>{});
            }
            closePinPad(); res(true);
          } else {
            attempts++;
            pinError(attempts>=3 ? 'Pídele al admin que te resetee el PIN' : 'PIN incorrecto');
          }
        }catch(e){
          pinError('No se pudo verificar el PIN: ' + (e && e.message ? e.message : e));
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
  // Cerrar la app interna y volver a la pantalla de institución (manteniendo la institución elegida).
  try{ showInstitutionPicker(); }catch(e){ showUserPicker(); }
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
            sub:'Repite los 4 dígitos.',
            maxLen:4,
            onComplete: async(pin2)=>{
              if(pin2 !== firstPin){ pinError('No coinciden'); firstPin = null; return; }
              if(isAdmin){
                state.adminPinHash = await makePINHash(pin, '__admin__');
              } else {
                u.pinHash = await makePINHash(pin, u.id);
                u.pinSetAt = Date.now();
                // Sube el PIN a la nube de inmediato
                _pushMyPinHash(u.id, u.pinHash).catch(()=>{});
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
  const vacApproved = (state.vacations||[]).filter(v=>v.staffId===u.id && v.status==='approved' && !v.deleted).length;
  // --- Índice de Permanencia ---
  // Mismo cálculo y orden ASCENDENTE que renderRanking (menor puntaje = #1 = más prioritario)
  const rankPerm = (state.staff||[])
    .map(s => ({ id: s.id, name: s.name, score: computeScore(s) }))
    .sort((a,b) => (a.score - b.score) || a.name.localeCompare(b.name));
  const myPermIdx = rankPerm.findIndex(s => s.id === u.id);
  const myPermRank = myPermIdx >= 0 ? (myPermIdx + 1) : null;
  const myPermScore = myPermIdx >= 0 ? rankPerm[myPermIdx].score : null;
  // --- Cobertura de Urgencia ---
  // Mismo cálculo y orden ASCENDENTE que renderCobertura, excluyendo exentos
  const rankCov = (state.staff||[])
    .filter(s => !s.exentoCobertura)
    .map(s => ({ id: s.id, name: s.name, score: computeCoberturaScore(s) }))
    .sort((a,b) => (a.score - b.score) || a.name.localeCompare(b.name));
  const myCovIdx = rankCov.findIndex(s => s.id === u.id);
  const meCob = (state.staff||[]).find(s => s.id === u.id);
  const exento = !!(meCob && meCob.exentoCobertura);
  let myCovRankTxt, myCovScoreTxt;
  if(exento){
    myCovRankTxt = 'Exento';
    myCovScoreTxt = '—';
  } else if(myCovIdx >= 0){
    myCovRankTxt = '#' + (myCovIdx + 1);
    myCovScoreTxt = rankCov[myCovIdx].score + ' pts';
  } else {
    myCovRankTxt = '—';
    myCovScoreTxt = '—';
  }
  const permRankTxt = myPermRank ? ('#' + myPermRank) : '—';
  const permScoreTxt = (myPermScore !== null) ? (myPermScore + ' pts · de ' + rankPerm.length) : '—';
  const covSubTxt = exento ? 'No participa' : (myCovScoreTxt + (myCovIdx >= 0 ? (' · de ' + rankCov.length) : ''));
  document.getElementById('miStatGrid').innerHTML =
    '<div class="mi-stat"><div class="mi-stat-value">'+permRankTxt+'</div><div class="mi-stat-label">Índice permanencia</div><div class="mi-stat-sub">'+permScoreTxt+'</div></div>'
    +'<div class="mi-stat"><div class="mi-stat-value">'+myCovRankTxt+'</div><div class="mi-stat-label">Cobertura emerg.</div><div class="mi-stat-sub">'+covSubTxt+'</div></div>'
    +'<div class="mi-stat"><div class="mi-stat-value">'+exchSent+'</div><div class="mi-stat-label">Intercambios publicados</div></div>'
    +'<div class="mi-stat"><div class="mi-stat-value">'+vacApproved+'</div><div class="mi-stat-label">Vacaciones aprobadas</div></div>';

  // Solicitudes activas
  const myExch = (state.exchanges||[]).filter(e=>e.staffId===u.id && e.status==='open');
  const myVacs = (state.vacations||[]).filter(v=>v.staffId===u.id && v.status==='pending' && !v.deleted);
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

  // Facturación (admin: administrar montos · staff: ver el propio)
  try{ renderMiFacturacion(); }catch(e){}
  // PINs del equipo (solo admin: reiniciar PIN de un staff)
  try{ renderMiPins(); }catch(e){}
}

function setPref(k,v){
  const u = getCurrentUser();
  if(!u) return;
  ensureUserDefaults(u);
  u.preferences[k] = v;
  save();
  toast && toast('Preferencia guardada');
}

// ============================================================
// MÓDULO: FACTURACIÓN
// ============================================================
// Montos sensibles. NUNCA entran al estado compartido ni a localStorage:
// viven SOLO en el backend (KV con expiración automática a 5 días).
// - Admin: botón "Facturación" en Mi Panel (solo modo admin) → ingresa el
//   listado de montos y publica (requiere el token del backend ya configurado).
// - Staff: tarjeta "Monto a facturar" en su Mi Panel → confirma su PIN y la
//   app consulta al servidor, que devuelve ÚNICAMENTE su monto.
const BILLING_DAYS = 5;

function _factFmt(n){ return '$' + (Number(n)||0).toLocaleString('es-CL'); }
function _factFmtDate(iso){
  try{ return new Date(iso).toLocaleString('es-CL',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}); }catch(e){ return iso||''; }
}

// Auto-reparación: si mi PIN existe en este dispositivo pero falta (o difiere)
// en la nube —p. ej. un envío antiguo del staff lo pisó con null—, lo re-sube.
// Mejor esfuerzo: nunca bloquea ni muestra errores.
async function _ensureMyPinInCloud(user){
  try{
    if(!user || !user.pinHash || user.id === ADMIN_USER_ID) return;
    if(!getBackendURL() || !INSTITUTION) return;
    const r = await fetch(getBackendURL() + '/api/state/' + encodeURIComponent(INSTITUTION.id), _stateGetOpts());
    if(!r.ok) return;
    const remote = await r.json();
    if(!remote || remote._empty) return;
    const me = (remote.staff||[]).find(s=>s && s.id===user.id);
    if(!me || me.pinHash !== user.pinHash){
      await _pushMyPinHash(user.id, user.pinHash);
    }
  }catch(e){}
}

// "Proof" para el servidor: el hash del PIN que este dispositivo ya tiene
// guardado tras el login del usuario. No hace falta re-pedir el PIN: entrar
// al perfil ya lo exigió. El PIN en texto plano jamás viaja al servidor.
function _billingProofFromStored(user){
  const stored = user && user.pinHash;
  if(!stored || typeof stored !== 'string') return null;
  if(stored.indexOf('pbkdf2$') === 0){
    const p = stored.split('$');
    return p[3] || null;
  }
  return stored; // hash legado v1
}

// --- Sección en Mi Panel (la llama renderMiPanel) ---
function renderMiFacturacion(){
  const title = document.getElementById('miFactTitle');
  const box = document.getElementById('miFacturacion');
  if(!title || !box) return;
  const u = getCurrentUser();
  const hasBackend = !!getBackendURL();
  if(!u || !hasBackend){ title.style.display='none'; box.style.display='none'; return; }
  title.style.display = '';
  box.style.display = '';
  if(state.isAdmin){
    box.innerHTML = '<div class="mi-pref-row"><div><div class="mi-pref-label">Montos a facturar del servicio</div>'
      +'<div class="mi-pref-sub">Publica el monto de cada persona. Visible solo para su titular (con PIN) durante '+BILLING_DAYS+' días; luego se borra del servidor automáticamente.</div></div>'
      +'<button class="btn sm accent" onclick="openBillingAdmin()">Administrar</button></div>';
  } else {
    box.innerHTML = '<div class="mi-pref-row"><div><div class="mi-pref-label">Mi monto a facturar</div>'
      +'<div class="mi-pref-sub">Información confidencial: se consulta al servidor y solo tú puedes verla. Disponible '+BILLING_DAYS+' días desde su publicación.</div></div>'
      +'<button class="btn sm secondary" onclick="billingViewMine()">Ver monto</button></div>';
  }
}

// --- Reinicio de PIN por el ADMIN ---
// Sección "PINs del equipo" en Mi Panel (solo modo admin): permite reiniciar
// el PIN de cualquier staff. El reinicio pone pinHash=null + pinResetAt=ahora
// y se propaga: la nube lo respeta (gana a la protección anti-borrado) y el
// dispositivo de la persona borra su PIN local al sincronizar. En su próximo
// ingreso, la persona crea un PIN nuevo de 4 dígitos.
function renderMiPins(){
  const title = document.getElementById('miPinsTitle');
  const box = document.getElementById('miPins');
  if(!title || !box) return;
  if(!state || !state.isAdmin){ title.style.display='none'; box.style.display='none'; return; }
  title.style.display = '';
  box.style.display = '';
  box.innerHTML = '<div class="mi-pref-row"><div><div class="mi-pref-label">Reiniciar el PIN de un staff</div>'
    +'<div class="mi-pref-sub">Para quien olvidó o tiene "bloqueado" su PIN. La persona creará uno nuevo en su próximo ingreso.</div></div>'
    +'<button class="btn sm secondary" onclick="openPinAdmin()">Administrar</button></div>';
}

function openPinAdmin(){
  if(!state.isAdmin){ toast('Solo el administrador'); return; }
  const rows = (state.staff||[]).map(s=>
    '<div style="display:flex;align-items:center;gap:8px;margin:4px 0">'
    +'<div style="flex:1;min-width:0"><div style="font-size:13px">'+s.name+'</div>'
    +'<div id="pinst_'+s.id+'" style="font-size:11px;color:var(--muted)">'+(s.pinHash?'PIN registrado en este dispositivo':'Sin PIN en este dispositivo')+'</div></div>'
    +'<button class="btn sm warn" onclick="adminResetStaffPin(\''+s.id+'\')">Reiniciar</button>'
    +'</div>'
  ).join('');
  modal('<h3>🔑 PINs del equipo</h3>'
    +'<div class="alert info" style="font-size:12px">Al reiniciar, el PIN actual queda invalidado en la nube y en los dispositivos de la persona (al sincronizar). En su próximo ingreso definirá un PIN nuevo de 4 dígitos. Su perfil y datos no se tocan.</div>'
    +'<div id="pinAdminStatus" style="font-size:12px;color:var(--muted);margin:6px 0">Consultando PINs registrados en la nube…</div>'
    +'<div style="max-height:45vh;overflow-y:auto;border:1px solid var(--border);border-radius:10px;padding:8px 10px;margin:8px 0">'+rows+'</div>'
    +'<div class="btn-row"><button class="btn secondary" onclick="closeModal()">Cerrar</button></div>');
  _loadPinAdminStatus();
}

async function _loadPinAdminStatus(){
  const el = document.getElementById('pinAdminStatus');
  try{
    if(!getBackendURL() || !INSTITUTION){ if(el) el.textContent = 'Sin backend configurado: el reinicio solo aplicará en este dispositivo.'; return; }
    const r = await fetch(getBackendURL() + '/api/state/' + encodeURIComponent(INSTITUTION.id), _stateGetOpts());
    if(!r.ok){ if(el) el.textContent = 'No se pudo consultar la nube.'; return; }
    const remote = await r.json();
    if(!remote || remote._empty){ if(el) el.textContent = 'Nube vacía.'; return; }
    let n = 0;
    (remote.staff||[]).forEach(s=>{
      const span = document.getElementById('pinst_' + s.id);
      if(!span) return;
      if(s.pinHash){ n++; span.textContent = '☁️ PIN registrado en la nube'; }
      else if(_pinResetActive(s)){ span.textContent = '🔄 Reiniciado — creará PIN nuevo al entrar'; }
      else { span.textContent = 'Sin PIN en la nube (creará uno al entrar)'; }
    });
    if(el) el.textContent = n + ' de ' + (state.staff||[]).length + ' con PIN registrado en la nube.';
  }catch(e){
    if(el) el.textContent = 'Sin conexión para consultar la nube.';
  }
}

// Push del reinicio: igual que _pushMyPinHash pero dejando pinHash=null +
// pinResetAt, para que la nube y los dispositivos respeten el borrado.
async function _pushPinReset(staffId, resetAt){
  const base = getBackendURL();
  if(!base || !INSTITUTION) throw new Error('sin backend');
  const token = getBackendToken();
  if(!token) throw new Error('sin token');
  const rr = await fetch(base + '/api/state/' + encodeURIComponent(INSTITUTION.id), {cache:'no-store', headers:{'Authorization':'Bearer '+token}});
  if(!rr.ok) throw new Error('GET ' + rr.status);
  const remote = await rr.json();
  if(!remote || remote._empty) throw new Error('nube vacía');
  const staffArr = Array.isArray(remote.staff)
    ? remote.staff.map(s => s.id === staffId ? {...s, pinHash: null, pinResetAt: resetAt} : s)
    : [];
  const payload = {...remote, staff: staffArr};
  delete payload._updatedAt;
  delete payload._empty;
  const pr = await fetch(base + '/api/state/' + encodeURIComponent(INSTITUTION.id), {
    method:'POST',
    headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},
    body: JSON.stringify(payload)
  });
  if(!pr.ok) throw new Error('POST ' + pr.status);
}

async function adminResetStaffPin(staffId){
  if(!state.isAdmin){ toast('Solo el administrador'); return; }
  const s = (state.staff||[]).find(x=>x.id===staffId);
  if(!s) return;
  if(!confirm('¿Reiniciar el PIN de ' + s.name + '?\n\nSu PIN actual quedará invalidado y en su próximo ingreso deberá crear uno nuevo de 4 dígitos.')) return;
  const resetAt = Date.now();
  s.pinHash = null;
  s.pinResetAt = resetAt;
  delete _remotePinCache.staff[staffId]; // que ningún caché lo re-inyecte
  save();
  const span = document.getElementById('pinst_' + staffId);
  try{
    await _pushPinReset(staffId, resetAt);
    toast('✅ PIN de ' + s.name + ' reiniciado');
    if(span) span.textContent = '🔄 Reiniciado — creará PIN nuevo al entrar';
  }catch(e){
    toast('Reiniciado en este dispositivo; se subirá a la nube al reconectar');
    if(span) span.textContent = '🔄 Reiniciado localmente (pendiente de sincronizar)';
  }
}

// --- Vista del STAFF: consultar solo el monto propio (sin re-pedir PIN;
//     entrar al perfil ya exigió el PIN de la persona) ---
async function billingViewMine(){
  const u = getCurrentUser();
  if(!u || u.id === ADMIN_USER_ID) return;
  if(!getBackendURL()){ toast('Sin conexión al backend'); return; }
  const proof = _billingProofFromStored(u);
  if(!proof){ toast('Tu PIN aún no está registrado en este dispositivo. Cierra sesión y vuelve a entrar.'); return; }
  modal('<h3>💰 Monto a facturar</h3><div class="empty" style="padding:14px">Consultando…</div>');
  const _fetchMine = async()=>{
    const resp = await fetch(getBackendURL() + '/api/billing/' + encodeURIComponent(INSTITUTION.id) + '/mine', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ staffId: u.id, proof })
    });
    const data = await resp.json().catch(()=>({}));
    return { resp, data };
  };
  try{
    let { resp, data } = await _fetchMine();
    if(resp.status === 403 || resp.status === 401){
      // El PIN de este dispositivo no está (o difiere) en la nube — un envío
      // antiguo del staff pudo haberlo pisado. Re-subirlo y reintentar una vez.
      if(!u.pinSetAt){ u.pinSetAt = Date.now(); saveRaw && saveRaw(); }
      try{ await _pushMyPinHash(u.id, u.pinHash); }catch(e){}
      ({ resp, data } = await _fetchMine());
    }
    if(!resp.ok){
      modal('<h3>💰 Monto a facturar</h3><div class="alert warn" style="font-size:13px">'+(data.error||'No se pudo consultar')+'</div>'
        +'<div class="btn-row"><button class="btn secondary" onclick="closeModal()">Cerrar</button></div>');
      return;
    }
    if(data.empty){
      modal('<h3>💰 Monto a facturar</h3><div class="empty" style="padding:18px"><span class="big" style="font-size:26px">📭</span>Aún no hay monto disponible.</div>'
        +'<div class="btn-row"><button class="btn secondary" onclick="closeModal()">Cerrar</button></div>');
      return;
    }
    modal('<h3>💰 Monto a facturar</h3>'
      +'<div style="text-align:center;padding:16px 8px">'
      +'<div style="font-size:32px;font-weight:800;color:var(--primary)">'+_factFmt(data.amount)+'</div>'
      +(data.note?('<div style="font-size:13px;color:var(--muted);margin-top:6px">'+String(data.note).replace(/</g,'&lt;')+'</div>'):'')
      +'<div style="font-size:12px;color:var(--muted);margin-top:10px">Publicado: '+_factFmtDate(data.publishedAt)+'<br>Disponible hasta: <b>'+_factFmtDate(data.expiresAt)+'</b> (luego se borra del servidor)</div>'
      +'</div>'
      +'<div class="alert info" style="font-size:12px">Este monto es visible únicamente para ti. No queda guardado en el dispositivo.</div>'
      +'<div class="btn-row"><button class="btn secondary" onclick="closeModal()">Cerrar</button></div>');
  }catch(e){
    modal('<h3>💰 Monto a facturar</h3><div class="alert warn" style="font-size:13px">Sin conexión: no se pudo consultar.</div>'
      +'<div class="btn-row"><button class="btn secondary" onclick="closeModal()">Cerrar</button></div>');
  }
}

// --- Pantalla del ADMIN: listado de staff + monto por persona ---
function openBillingAdmin(){
  if(!state.isAdmin){ toast('Solo el administrador'); return; }
  if(!getBackendURL() || !getBackendToken()){ toast('Configura el backend y su token primero'); return; }
  const rows = (state.staff||[]).map(s=>
    '<div style="display:flex;align-items:center;gap:8px;margin:3px 0">'
    +'<label style="flex:1;margin:0;font-size:13px">'+s.name+'</label>'
    +'<input type="text" inputmode="numeric" class="fact-input" id="fact_'+s.id+'" data-staff="'+s.id+'" data-name="'+String(s.name).replace(/"/g,'&quot;')+'" placeholder="—" style="width:130px;text-align:right" />'
    +'</div>'
  ).join('');
  modal('<h3>💰 Facturación</h3>'
    +'<div class="alert info" style="font-size:12px">Ingresa el monto (CLP) de cada persona y publica. Cada uno verá <b>solo su monto</b> en su perfil, confirmando su PIN. Se borra del servidor automáticamente a los '+BILLING_DAYS+' días. Los que queden en blanco no se publican.</div>'
    +'<div id="factStatus" style="font-size:12px;color:var(--muted);margin:6px 0">Consultando publicación vigente…</div>'
    +'<div class="field"><label>Nota (opcional, la ven todos junto a su monto)</label><input type="text" id="fact_note" maxlength="300" placeholder="Ej: Facturación junio 2026" /></div>'
    +'<div style="max-height:45vh;overflow-y:auto;border:1px solid var(--border);border-radius:10px;padding:8px 10px;margin:8px 0">'+rows+'</div>'
    +'<div class="btn-row">'
    +'<button class="btn accent" onclick="publishBilling()">Publicar ('+BILLING_DAYS+' días)</button>'
    +'<button class="btn warn" onclick="clearBilling()">Borrar lo publicado</button>'
    +'<button class="btn secondary" onclick="closeModal()">Cerrar</button>'
    +'</div>');
  _loadBillingStatus();
}

async function _loadBillingStatus(){
  const el = document.getElementById('factStatus');
  if(!el) return;
  try{
    const r = await fetch(getBackendURL() + '/api/billing/' + encodeURIComponent(INSTITUTION.id) + '/status', {
      cache:'no-store', headers:{'Authorization':'Bearer ' + getBackendToken()}
    });
    const data = await r.json().catch(()=>({}));
    if(!r.ok){ el.textContent = 'No se pudo consultar lo publicado (' + (data.error||r.status) + ')'; return; }
    if(data.empty || !data.items){ el.textContent = 'No hay montos publicados actualmente.'; return; }
    const n = Object.keys(data.items).length;
    el.innerHTML = '📌 Hay una publicación vigente: <b>'+n+'</b> persona'+(n===1?'':'s')+' · publicada '+_factFmtDate(data.publishedAt)+' · expira <b>'+_factFmtDate(data.expiresAt)+'</b>.';
    // Pre-cargar los montos vigentes en los campos para poder corregir/republicar
    Object.keys(data.items).forEach(id=>{
      const inp = document.getElementById('fact_' + id);
      if(inp && !inp.value) inp.value = (data.items[id].amount||'').toLocaleString('es-CL');
    });
    const note = document.getElementById('fact_note');
    if(note && !note.value && data.note) note.value = data.note;
  }catch(e){
    el.textContent = 'Sin conexión para consultar lo publicado.';
  }
}

async function publishBilling(){
  if(!state.isAdmin) return;
  const items = [];
  document.querySelectorAll('.fact-input').forEach(inp=>{
    const amount = parseInt(String(inp.value||'').replace(/[^\d]/g,''), 10);
    if(amount > 0) items.push({ staffId: inp.dataset.staff, name: inp.dataset.name, amount });
  });
  if(items.length === 0){ toast('Ingresa al menos un monto'); return; }
  const note = (document.getElementById('fact_note')||{}).value || '';
  if(!confirm('Publicar montos de ' + items.length + ' persona(s)? Cada uno verá solo el suyo, durante ' + BILLING_DAYS + ' días.')) return;
  try{
    const r = await fetch(getBackendURL() + '/api/billing/' + encodeURIComponent(INSTITUTION.id), {
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer ' + getBackendToken()},
      body: JSON.stringify({ items, note })
    });
    const data = await r.json().catch(()=>({}));
    if(!r.ok){ toast('Error al publicar: ' + (data.error||r.status)); return; }
    toast('✅ Publicado (' + data.count + '). Expira ' + _factFmtDate(data.expiresAt));
    _loadBillingStatus();
  }catch(e){
    toast('Sin conexión: no se pudo publicar');
  }
}

async function clearBilling(){
  if(!state.isAdmin) return;
  if(!confirm('¿Borrar AHORA todos los montos publicados del servidor?')) return;
  try{
    const r = await fetch(getBackendURL() + '/api/billing/' + encodeURIComponent(INSTITUTION.id) + '/clear', {
      method:'POST',
      headers:{'Authorization':'Bearer ' + getBackendToken()}
    });
    if(!r.ok){ const d = await r.json().catch(()=>({})); toast('Error: ' + (d.error||r.status)); return; }
    toast('Montos borrados del servidor');
    _loadBillingStatus();
  }catch(e){
    toast('Sin conexión: no se pudo borrar');
  }
}

// ============================================================
// MÓDULO: INTERCONSULTAS A ANESTESIOLOGÍA
// ============================================================
// Vive dentro del Portal Preanestésico. Permite a las unidades enviar una
// solicitud de interconsulta (evaluación preanestésica, dolor, evaluación para
// procedimiento, etc.) eligiendo un DÍA en el calendario (sin tomar hora).
// Los datos del paciente van anonimizados (solo iniciales). Cada envío queda en
// la nube (canal "<inst>-ic", fusionado por id en el backend) y notifica al
// administrador (push + badge). El admin puede marcar "Realizada" (se archiva)
// o "Borrar" (tombstone, libera espacio). Mismo modelo robusto de
// verify-and-retry del agendamiento: una interconsulta NUNCA se pierde.
// ============================================================
const IC_DATA_LS_KEY = 'appx_ic_data_v1';
const IC_SEEN_LS_KEY = 'appx_ic_seen_v1';

const IC_TIPOS = [
  { v:'preanestesica', label:'Evaluación preanestésica',          ico:'🩺' },
  { v:'procedimiento', label:'Evaluación para procedimiento',     ico:'🛌' },
  { v:'dolor',         label:'Interconsulta de dolor',            ico:'💢' },
  { v:'otro',          label:'Otra (especificar)',                ico:'📋' }
];
const IC_PRIOS = [
  { v:'rutinaria',  label:'Rutinaria',  color:'#2e8b6b', bg:'#dcefe7' },
  { v:'preferente', label:'Preferente', color:'#b45309', bg:'#fef3c7' },
  { v:'urgente',    label:'Urgente',    color:'#b91c1c', bg:'#fee2e2' }
];
const IC_PRIO_RANK = { urgente:0, preferente:1, rutinaria:2 };

function _icEsc(s){ return _gpEsc(s); }
function _icRemoteId(){ return INSTITUTION ? (INSTITUTION.id + '-ic') : null; }
function _icGenId(){ return 'ic_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,7); }
function _icReqTs(r){ return r ? (r.updatedAt || r.realizadaAt || r.createdAt || 0) : 0; }
function _icTipoMeta(v){ return IC_TIPOS.find(t=>t.v===v) || IC_TIPOS[IC_TIPOS.length-1]; }
function _icPrioMeta(v){ return IC_PRIOS.find(p=>p.v===v) || IC_PRIOS[0]; }

// --- Privacidad: garantiza que NUNCA se persista nombre completo ni RUT.
//     Solo iniciales del paciente. Idempotente. ---
function _icSanitizeReq(r){
  if(!r || typeof r !== 'object' || r.deleted) return r;
  let ch = false;
  if(r.rut){ delete r.rut; ch = true; }
  if(r.nombre){ delete r.nombre; ch = true; }
  if(r.paciente){ delete r.paciente; ch = true; }
  if(typeof r.iniciales === 'string'){
    const t = r.iniciales.trim();
    if(/\s/.test(t) && t.length > 5){
      const ini = t.split(/[\s.]+/).filter(Boolean).slice(0,3).map(p=>(p[0]||'').toUpperCase()).filter(Boolean).join('.') + '.';
      if(ini && ini !== r.iniciales){ r.iniciales = ini; ch = true; }
    } else if(t.length > 6){
      r.iniciales = t.slice(0,6).toUpperCase(); ch = true;
    }
  }
  if(ch) r.updatedAt = Date.now();
  return r;
}
function _icSanitizeAll(arr){ if(Array.isArray(arr)) arr.forEach(_icSanitizeReq); return arr; }

function icLoadData(){
  try{
    const a = JSON.parse(localStorage.getItem(IC_DATA_LS_KEY) || '[]');
    return _icSanitizeAll(Array.isArray(a) ? a : []);
  }catch(e){ return []; }
}
function icSaveData(arr){
  try{ localStorage.setItem(IC_DATA_LS_KEY, JSON.stringify(Array.isArray(arr)?arr:[])); }
  catch(e){ console.error('No se pudo guardar interconsultas', e); }
}

// Fusiona dos arreglos planos de solicitudes por id (gana el más nuevo).
// Conserva tombstones (deleted:true) hasta 120 días.
function _icMergeData(remoteArr, localArr){
  const map = {};
  const cutoff = Date.now() - 120*24*3600*1000;
  (Array.isArray(remoteArr)?remoteArr:[]).forEach(r=>{ if(r && r.id) map[r.id] = r; });
  (Array.isArray(localArr)?localArr:[]).forEach(r=>{
    if(!r || !r.id) return;
    const ex = map[r.id];
    if(!ex || _icReqTs(r) >= _icReqTs(ex)) map[r.id] = r;
  });
  return Object.values(map).filter(r => !(r && r.deleted && (r.deletedAt||0) < cutoff));
}

// --- Sync: lee la nube, fusiona, guarda local y sube el resultado. ---
let _icSyncing = false, _icSyncTimer = null;
async function icSyncNow(){
  const base = getBackendURL();
  const id = _icRemoteId();
  if(!base || !id || _icSyncing) return false;
  _icSyncing = true;
  try{
    let remoteArr = [];
    try{
      const r = await fetch(base + '/api/state/' + encodeURIComponent(id), _stateGetOpts());
      if(!r.ok) return false;
      const j = await r.json();
      if(j && !j._empty && Array.isArray(j.data)) remoteArr = j.data;
    }catch(e){ return false; }
    _icSanitizeAll(remoteArr);
    const merged = _icSanitizeAll(_icMergeData(remoteArr, icLoadData()));
    icSaveData(merged);
    const token = getBackendToken();
    if(!token) return false;
    try{
      const pr = await fetch(base + '/api/state/' + encodeURIComponent(id), {
        method:'POST',
        headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},
        body: JSON.stringify({ data: merged })
      });
      return pr.ok;
    }catch(e){ return false; }
  }catch(e){ console.warn('icSyncNow', e); return false; }
  finally{ _icSyncing = false; }
}
function icScheduleSync(onDone){
  if(_icSyncTimer) clearTimeout(_icSyncTimer);
  _icSyncTimer = setTimeout(()=>{ _icSyncTimer = null; icSyncNow().then(()=>{ if(typeof onDone==='function') onDone(); }); }, 800);
}

// Empuja Y verifica que la solicitud quedó (o desapareció) en la nube.
// predicate(req|undefined) → true cuando el estado deseado está confirmado.
async function _icSyncVerified(reqId, predicate, tries){
  tries = tries || 5;
  for(let i=0;i<tries;i++){
    let ok = false;
    try{ ok = await icSyncNow(); }catch(e){ ok = false; }
    if(ok){
      try{
        const base = getBackendURL(); const id = _icRemoteId();
        const r = await fetch(base + '/api/state/' + encodeURIComponent(id) + '?cb=' + Date.now(), _stateGetOpts());
        if(r.ok){
          const j = await r.json();
          const arr = (j && Array.isArray(j.data)) ? j.data : [];
          const found = arr.find(x => x && x.id === reqId);
          if(predicate(found)) return true;
        }
      }catch(e){}
    }
    await new Promise(res=>setTimeout(res, 250 + Math.floor(Math.random()*600)));
  }
  return false;
}

// --- Consultas en memoria ---
function _icAll(){ return icLoadData().filter(r => r && !r.deleted); }
function _icPendientes(){
  return _icAll().filter(r => r.estado !== 'realizada').sort((a,b)=>
    (IC_PRIO_RANK[a.prioridad]??2) - (IC_PRIO_RANK[b.prioridad]??2)
    || String(a.fecha||'').localeCompare(String(b.fecha||''))
    || (a.createdAt||0) - (b.createdAt||0));
}
function _icRealizadas(){
  return _icAll().filter(r => r.estado === 'realizada').sort((a,b)=>(b.realizadaAt||0)-(a.realizadaAt||0));
}
// Estados de una interconsulta: pendiente (Recibida) → aceptada (Aceptada) → realizada.
function _icRecibidas(){
  return _icAll().filter(r => r.estado !== 'aceptada' && r.estado !== 'realizada')
    .sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
}
function _icAceptadas(){
  return _icAll().filter(r => r.estado === 'aceptada')
    .sort((a,b)=>(b.aceptadaAt||0)-(a.aceptadaAt||0));
}
// Metadatos visuales por estado (etiqueta, clave de estilo, ícono).
function _icStatusMeta(estado){
  if(estado === 'realizada') return { label:'Realizada', key:'realizada', ico:'✅' };
  if(estado === 'aceptada')  return { label:'Aceptada',  key:'aceptada',  ico:'🔵' };
  return { label:'Recibida', key:'recibida', ico:'🎫' };
}
function _icStatusChip(estado){ const m = _icStatusMeta(estado); return `<span class="ic-status ${m.key}">${m.ico} ${m.label}</span>`; }
function _icSeenTs(){ try{ return parseInt(localStorage.getItem(IC_SEEN_LS_KEY)||'0',10) || 0; }catch(e){ return 0; } }
function icMarkSeen(){ try{ localStorage.setItem(IC_SEEN_LS_KEY, String(Date.now())); }catch(e){} try{ updateIcBadges(); }catch(e){} }
function _icNewUnseen(){ const seen = _icSeenTs(); return _icPendientes().filter(r => (r.createdAt||0) > seen); }

// Badge numérico sobre la tarjeta del Portal (solo admin) + badge de pendientes
// dentro del módulo. "Nuevas sin ver" se limpia al abrir el módulo.
// Badge numérico (nuevas interconsultas sin ver) sobre el botón del módulo
// en el selector de pantallas. Se limpia al abrir el módulo (icMarkSeen).
function updateIcBadges(){
  const b = document.getElementById('icModBadge');
  if(!b) return;
  // Admin: muestra TODAS las pendientes (igual que el badge de Agendamiento).
  // Resto: solo las nuevas sin ver (se limpia al abrir el módulo).
  const n = (state && state.isAdmin) ? _icPendientes().length : _icNewUnseen().length;
  if(n > 0){ b.textContent = n > 99 ? '99+' : String(n); b.style.display = 'inline-block'; }
  else { b.style.display = 'none'; }
  try{ _updateSolBadge(); }catch(e){}
}

// Badge combinado del botón "Interconsultas y Agendamiento" en la pantalla
// principal: suma los badges individuales de ambos módulos (que viven dentro
// del sub-selector solChooser).
function _updateSolBadge(){
  const s = document.getElementById('solModBadge');
  if(!s) return;
  let total = 0;
  ['icModBadge','agendModBadge'].forEach(id=>{
    const el = document.getElementById(id);
    if(el && el.style.display !== 'none'){
      const v = parseInt(String(el.textContent).replace('+',''),10);
      if(!isNaN(v)) total += v;
    }
  });
  if(total > 0){ s.textContent = total > 99 ? '99+' : String(total); s.style.display = 'inline-block'; }
  else { s.style.display = 'none'; }
}

// Chequeo periódico (solo admin): baja de la nube y avisa si hay nuevas.
let _icAdminPollTimer = null;
async function icCheckNewForAdmin(){
  if(!state || !state.isAdmin) return;
  await icSyncNow();
  const nuevas = _icNewUnseen();
  updateIcBadges();
  if(nuevas.length > 0){
    const tag = 'ic-new-' + nuevas.length;
    if(window._icLastNotifTag !== tag){
      window._icLastNotifTag = tag;
      notify('🩺 Interconsultas',
        nuevas.length === 1 ? 'Hay 1 nueva interconsulta pendiente' : 'Hay ' + nuevas.length + ' nuevas interconsultas pendientes',
        'ic-new');
    }
  }
}
function startIcAdminPolling(){
  if(_icAdminPollTimer) clearInterval(_icAdminPollTimer);
  _icAdminPollTimer = setInterval(()=>{ try{ icCheckNewForAdmin(); }catch(e){} }, 3*60*1000);
}

// --- Mutaciones ---
function _icCurrentUserName(){
  try{ const u = (typeof getCurrentUser==='function') ? getCurrentUser() : null; if(u && u.name) return u.name; }catch(e){}
  return 'Anestesia';
}
function icCreateRequest(f){
  const arr = icLoadData();
  const now = Date.now();
  const req = {
    id: _icGenId(),
    fecha: f.fecha || '',
    iniciales: f.iniciales || '',
    edad: f.edad || '',
    pieza: f.pieza || '',
    unidad: f.unidad || '',
    anexo: f.anexo || '',
    solicitante: f.solicitante || '',
    solicitanteRol: f.solicitanteRol || 'medico',
    tipo: f.tipo || 'preanestesica',
    tipoOtro: f.tipoOtro || '',
    prioridad: f.prioridad || 'rutinaria',
    motivo: f.motivo || '',
    dgCirugia: f.dgCirugia || '',
    comorbilidades: f.comorbilidades || '',
    examenes: f.examenes || '',
    medicamentos: f.medicamentos || '',
    estado: 'pendiente',
    createdAt: now, updatedAt: now,
    realizadaAt: null, realizadaBy: null, notaRealizada: ''
  };
  _icSanitizeReq(req);
  arr.push(req);
  icSaveData(arr);
  return req;
}
function icMarkAceptada(id){
  const arr = icLoadData();
  const r = arr.find(x => x && x.id === id);
  if(!r) return null;
  r.estado = 'aceptada';
  r.aceptadaAt = Date.now();
  r.aceptadaBy = _icCurrentUserName();
  r.updatedAt = Date.now();
  icSaveData(arr);
  return r;
}
function icMarkRealizada(id, nota){
  const arr = icLoadData();
  const r = arr.find(x => x && x.id === id);
  if(!r) return null;
  // Si venía sin aceptar, registra la aceptación implícita en el mismo momento.
  if(!r.aceptadaAt){ r.aceptadaAt = Date.now(); r.aceptadaBy = _icCurrentUserName(); }
  r.estado = 'realizada';
  r.realizadaAt = Date.now();
  r.realizadaBy = _icCurrentUserName();
  r.notaRealizada = nota || '';
  r.updatedAt = Date.now();
  icSaveData(arr);
  return r;
}
function icReabrir(id){
  const arr = icLoadData();
  const r = arr.find(x => x && x.id === id);
  if(!r) return null;
  r.estado = 'pendiente';
  r.realizadaAt = null; r.realizadaBy = null;
  r.aceptadaAt = null; r.aceptadaBy = null;
  r.updatedAt = Date.now();
  icSaveData(arr);
  return r;
}
function icDeleteRequest(id){
  const arr = icLoadData();
  const r = arr.find(x => x && x.id === id);
  if(!r) return false;
  r.deleted = true; r.deletedAt = Date.now(); r.updatedAt = Date.now();
  icSaveData(arr);
  return true;
}

// ============================================================
// INTERCONSULTAS · UI (módulo propio, pantalla #icScreen)
// ============================================================
// admin = true solo tras desbloquear con el PIN de administrador (o si la
// sesión principal ya es el usuario Administrador). Las acciones de gestión
// (Realizada / Reabrir / Borrar) dependen de ESTE flag, no del estado global.
const IC_UI = { view:'landing', tab:'pendiente', admin:false, calYear:0, calMonth:0, selectedDate:null, detailId:null, detailReturn:'home' };

// Abre el módulo Interconsultas (overlay fullscreen, desde el selector de módulos).
function openIcModule(){
  const mod = document.getElementById('modulesScreen'); if(mod) mod.classList.add('hidden');
  const g = document.getElementById('guiasScreen'); if(g) g.classList.add('hidden');
  const s = document.getElementById('icScreen'); if(s) s.classList.remove('hidden');
  IC_UI.view = 'landing';
  IC_UI.admin = false;
  IC_UI.tab = 'pendiente';
  IC_UI.detailId = null;
  const t = new Date();
  IC_UI.calYear = t.getFullYear();
  IC_UI.calMonth = t.getMonth();
  IC_UI.selectedDate = null;
  _icUpdateHeadSub();
  renderIcModule();
  // Refresco desde la nube (no bloquea la UI)
  icSyncNow().then(()=>{
    const sc = document.getElementById('icScreen');
    if(sc && !sc.classList.contains('hidden')) renderIcModule();
    updateIcBadges();
  }).catch(()=>{});
}

// Volver desde Interconsultas al selector de módulos.
function closeIcModule(){
  const s = document.getElementById('icScreen'); if(s) s.classList.add('hidden');
  showModulesScreen();
}

// Botón "‹ Volver" del header: navegación contextual.
function icBack(){
  if(IC_UI.view === 'cal'){ IC_UI.view = 'home'; renderIcModule(); return; }
  if(IC_UI.view === 'detail'){ IC_UI.view = IC_UI.detailReturn || 'home'; renderIcModule(); return; }
  if(IC_UI.view === 'form'){ IC_UI.view = 'cal'; renderIcModule(); return; }
  if(IC_UI.view === 'home' || IC_UI.view === 'seguimiento'){ icOpenLanding(); return; }
  closeIcModule();
}

function icOpenLanding(){
  IC_UI.view = 'landing';
  IC_UI.admin = false;
  IC_UI.detailId = null;
  _icUpdateHeadSub();
  renderIcModule();
}

// Vía solicitante (igual que la entrada actual: cualquiera puede pedir).
function icEnterSolicitar(){
  IC_UI.admin = false;
  IC_UI.view = 'home';
  IC_UI.tab = 'pendiente';
  _icUpdateHeadSub();
  renderIcModule();
  icMarkSeen();
}

// Vía administrador: requiere el PIN de administrador (mismo de la app).
async function icEnterAdmin(){
  // 1) Si la sesión principal YA es el usuario Administrador → entrar directo.
  if(state && typeof ADMIN_USER_ID !== 'undefined' && state.currentUserId === ADMIN_USER_ID){
    _icGrantAdmin(); return;
  }
  // 2) Si no hay PIN configurado, intentar bajarlo de la nube; si sigue sin haber, avisar.
  if(typeof adminSetupNeeded === 'function' && adminSetupNeeded()){
    try{ await _syncAdminPinFromCloud(); }catch(e){}
  }
  if(typeof adminSetupNeeded === 'function' && adminSetupNeeded()){
    alert('Aún no hay un PIN de Administrador configurado.\n\nCréalo en la pantalla principal → Staff → Administrador (4 dígitos) y vuelve aquí.');
    return;
  }
  // 3) Pedir el PIN in-place.
  let ok = false;
  try{ ok = await promptVerifyAdminPin(); }catch(e){ ok = false; }
  if(!ok) return;
  _icGrantAdmin();
}
function _icGrantAdmin(){
  IC_UI.admin = true;
  IC_UI.view = 'home';
  IC_UI.tab = 'pendiente';
  _icUpdateHeadSub();
  renderIcModule();
  icMarkSeen();
}

function _icUpdateHeadSub(){
  const el = document.getElementById('icHeadSub');
  if(!el) return;
  if(IC_UI.view === 'landing') el.textContent = 'Servicio de Anestesiología';
  else if(IC_UI.view === 'seguimiento') el.textContent = '🔎 Seguimiento';
  else el.textContent = IC_UI.admin ? '🔒 Administrador · gestión' : '✉️ Solicitar interconsulta';
}

// Vía seguimiento: lista de solo lectura del estado de las interconsultas.
function icEnterSeguimiento(){
  IC_UI.admin = false;
  IC_UI.view = 'seguimiento';
  _icUpdateHeadSub();
  renderIcModule();
  icMarkSeen();
  icSyncNow().then(()=>{ if(IC_UI.view === 'seguimiento') renderIcModule(); updateIcBadges(); }).catch(()=>{});
}

function renderIcModule(){
  const body = document.getElementById('icModuleBody');
  if(!body) return;
  let html;
  if(IC_UI.view === 'landing') html = _icRenderLanding();
  else if(IC_UI.view === 'seguimiento') html = _icRenderSeguimiento();
  else if(IC_UI.view === 'cal') html = _icRenderCal();
  else if(IC_UI.view === 'form') html = _icRenderForm();
  else if(IC_UI.view === 'detail') html = _icRenderDetail();
  else html = _icRenderHome();
  body.innerHTML = html;
  _icUpdateHeadSub();
  const wrap = document.querySelector('#icScreen .guias-body');
  if(wrap){ try{ wrap.scrollTo({top:0, behavior:'instant'}); }catch(e){ wrap.scrollTop = 0; } }
}

function _icRenderLanding(){
  const pend = _icPendientes().length;
  const adminSub = 'Anestesiología: revisar, marcar realizada y borrar' + (pend ? ` · ${pend} pendiente${pend>1?'s':''}` : '');
  return `
    <div class="ic-wrap">
      <div class="ic-intro">Canal de interconsultas al <b>Servicio de Anestesiología</b>. Elige cómo quieres entrar.</div>
      <button type="button" class="ic-land-btn" onclick="icEnterSolicitar()">
        <div class="ic-land-ico">✉️</div>
        <div class="ic-land-tx"><b>Solicitar interconsulta</b><span>Para unidades que piden evaluación · por día, datos anonimizados</span></div>
        <span class="ic-land-arrow">›</span>
      </button>
      <button type="button" class="ic-land-btn seg" onclick="icEnterSeguimiento()">
        <div class="ic-land-ico">🔎</div>
        <div class="ic-land-tx"><b>Seguimiento</b><span>Estado de las interconsultas: 🎫 recibidas y ✅ realizadas</span></div>
        <span class="ic-land-arrow">›</span>
      </button>
      <button type="button" class="ic-land-btn admin" onclick="icEnterAdmin()">
        <div class="ic-land-ico">🔒</div>
        <div class="ic-land-tx"><b>Administrador</b><span>${_icEsc(adminSub)}</span></div>
        <span class="ic-land-arrow">›</span>
      </button>
    </div>`;
}

// --- Vista SEGUIMIENTO: listado compacto de solo lectura con tickets de estado.
//     🎫 amarillo = Recibida (en espera) · ✅ verde = Realizada (resuelta).
function _icRenderSeguimiento(){
  const recibidas = _icRecibidas();
  const aceptadas = _icAceptadas();
  const realizadas = _icRealizadas(); // ya vienen ordenadas por realizadaAt desc
  const total = recibidas.length + aceptadas.length + realizadas.length;
  const head = `
    <div class="ic-modehead">
      <button type="button" class="ic-back" onclick="icOpenLanding()">‹ Inicio</button>
      <span class="ic-mode-pill">🔎 Seguimiento</span>
    </div>
    <div class="ic-intro">Estado de cada interconsulta: <b>🎫 Recibida</b> (en espera) → <b>🔵 Aceptada</b> (la tomó Anestesia) → <b>✅ Realizada</b> (resuelta). Toca una para ver el detalle.</div>`;
  if(total === 0){
    return `<div class="ic-wrap">${head}<div class="ic-empty"><span>📭</span>Aún no hay interconsultas para seguir.</div></div>`;
  }
  const counts = `
    <div class="ic-track-counts">
      <span class="ic-track-tk recibida">🎫 Recibidas · ${recibidas.length}</span>
      <span class="ic-track-tk aceptada">🔵 Aceptadas · ${aceptadas.length}</span>
      <span class="ic-track-tk realizada">✅ Realizadas · ${realizadas.length}</span>
    </div>`;
  const rows = [
    ...recibidas.map(r => _icTrackRow(r, 'recibida')),
    ...aceptadas.map(r => _icTrackRow(r, 'aceptada')),
    ...realizadas.map(r => _icTrackRow(r, 'realizada'))
  ].join('');
  return `<div class="ic-wrap">${head}${counts}<div class="ic-track-list">${rows}</div></div>`;
}
function _icTrackRow(r, st){
  const tm = _icTipoMeta(r.tipo);
  const tipoLabel = r.tipo === 'otro' ? (r.tipoOtro || 'Otra') : tm.label;
  const lugar = [r.pieza, r.unidad].filter(Boolean).map(_icEsc).join(' · ') || '—';
  const quien = r.solicitante ? `${r.solicitanteRol === 'enfermera' ? 'Enf.' : 'Dr(a).'} ${_icEsc(r.solicitante)}` : '';
  const pill = st === 'realizada'
    ? '<span class="ic-track-tk realizada">✅ Realizada</span>'
    : (st === 'aceptada'
      ? '<span class="ic-track-tk aceptada">🔵 Aceptada</span>'
      : '<span class="ic-track-tk recibida">🎫 Recibida</span>');
  const sub = [quien, `${tm.ico} ${_icEsc(tipoLabel)}`].filter(Boolean).join(' · ');
  return `
    <div class="ic-track-row st-${st}" onclick="icOpenDetail('${r.id}')">
      <div class="ic-track-info">
        <div class="ic-track-main">🛏 ${lugar}</div>
        <div class="ic-track-sub">${sub}</div>
      </div>
      ${pill}
    </div>`;
}

function _icFmtFechaLarga(ds){
  if(!ds) return '';
  try{ const d = _agendParseDateStr(ds); return `${_agendDiasES[d.getDay()]} ${d.getDate()} de ${_agendMesesES[d.getMonth()]}`; }
  catch(e){ return ds; }
}
function _icPrioChip(v){
  const m = _icPrioMeta(v);
  return `<span class="ic-chip" style="background:${m.bg};color:${m.color}">${_icEsc(m.label)}</span>`;
}

function _icRenderHome(){
  const isAdmin = !!IC_UI.admin;
  const pend = _icPendientes();
  const real = _icRealizadas();
  const list = IC_UI.tab === 'realizada' ? real : pend;

  const modehead = `
    <div class="ic-modehead">
      <button type="button" class="ic-back" onclick="icOpenLanding()">‹ Inicio</button>
      <span class="ic-mode-pill ${isAdmin?'admin':''}">${isAdmin?'🔒 Administrador':'✉️ Solicitar'}</span>
    </div>`;

  const intro = isAdmin ? `
    <div class="ic-intro">
      Gestión de interconsultas. Marca <b>Realizada</b> para archivarlas o <b>Borrar</b>
      para liberar espacio. También puedes crear una nueva.
    </div>
    <button type="button" class="ic-newbtn" onclick="icGoNew()">+ Nueva interconsulta</button>` : `
    <div class="ic-intro">
      Envía una solicitud de interconsulta al Servicio de Anestesiología.
      Elige un <b>día</b> en el calendario (sin tomar hora). Los datos del paciente
      van <b>anonimizados</b> (solo iniciales).
    </div>
    <button type="button" class="ic-newbtn" onclick="icGoNew()">+ Nueva interconsulta</button>`;

  const tabs = `
    <div class="ic-tabs">
      <button type="button" class="ic-tab ${IC_UI.tab==='pendiente'?'active':''}" onclick="icSetTab('pendiente')">Pendientes <span class="ic-tabn">${pend.length}</span></button>
      <button type="button" class="ic-tab ${IC_UI.tab==='realizada'?'active':''}" onclick="icSetTab('realizada')">Realizadas <span class="ic-tabn">${real.length}</span></button>
    </div>`;

  let cards = '';
  if(list.length === 0){
    cards = `<div class="ic-empty"><span>${IC_UI.tab==='realizada'?'🗂️':'📭'}</span>${IC_UI.tab==='realizada'?'Aún no hay interconsultas archivadas.':'No hay interconsultas pendientes.'}</div>`;
  } else {
    cards = list.map(r => _icRenderCard(r, isAdmin)).join('');
  }

  return `<div class="ic-wrap">${modehead}${intro}${tabs}<div class="ic-list">${cards}</div></div>`;
}

function _icRenderCard(r, isAdmin){
  const tm = _icTipoMeta(r.tipo);
  const tipoLabel = r.tipo === 'otro' ? (r.tipoOtro || 'Otra') : tm.label;
  const realizada = r.estado === 'realizada';
  const lineas = [];
  lineas.push(`<b>${_icEsc(r.iniciales||'—')}</b>${r.edad?` · ${_icEsc(String(r.edad))} a`:''}${r.pieza?` · 🛏 ${_icEsc(r.pieza)}`:''}`);
  if(r.unidad) lineas.push(`🏥 ${_icEsc(r.unidad)}${r.anexo?` · ☎ ${_icEsc(r.anexo)}`:''}`);
  if(r.solicitante) lineas.push(`${r.solicitanteRol==='enfermera'?'👩‍⚕️ Enf.':'🩺 Dr(a).'} ${_icEsc(r.solicitante)}`);
  const meta = lineas.map(l=>`<div class="ic-card-line">${l}</div>`).join('');
  let actBtns;
  if(r.estado === 'realizada'){
    actBtns = `<button type="button" class="ic-mini-btn" onclick="icDoReabrir('${r.id}')">↩ Reabrir</button>`;
  } else if(r.estado === 'aceptada'){
    actBtns = `<button type="button" class="ic-mini-btn ok" onclick="icDoRealizada('${r.id}')">✅ Realizada</button>`;
  } else {
    actBtns = `<button type="button" class="ic-mini-btn acc" onclick="icDoAceptar('${r.id}')">🔵 Aceptar</button>`
            + `<button type="button" class="ic-mini-btn ok" onclick="icDoRealizada('${r.id}')">✅ Realizada</button>`;
  }
  const acts = isAdmin ? `
    <div class="ic-card-acts" onclick="event.stopPropagation()">
      ${actBtns}
      <button type="button" class="ic-mini-btn danger" onclick="icDoDelete('${r.id}')">🗑 Borrar</button>
    </div>` : '';
  return `
    <div class="ic-card ${realizada?'done':''} prio-${r.prioridad}" onclick="icOpenDetail('${r.id}')">
      <div class="ic-card-top">
        <div class="ic-card-tipo">${tm.ico} ${_icEsc(tipoLabel)}</div>
        ${_icStatusChip(r.estado)}
      </div>
      <div class="ic-card-body">${meta}</div>
      <div class="ic-card-foot">${_icPrioChip(r.prioridad)} · 📅 <b>${_icFmtFechaLarga(r.fecha)}</b></div>
      ${acts}
    </div>`;
}

function _icRenderCal(){
  const y = IC_UI.calYear, mo = IC_UI.calMonth;
  const first = new Date(y, mo, 1);
  const startOffset = (first.getDay() + 6) % 7; // lunes = 0
  const daysInMonth = new Date(y, mo+1, 0).getDate();
  const todayStr = _agendTodayStr();
  let cells = '';
  const dows = ['L','M','M','J','V','S','D'];
  let head = dows.map(d=>`<div class="ic-cal-dow">${d}</div>`).join('');
  for(let i=0;i<startOffset;i++) cells += `<div class="ic-cal-cell empty"></div>`;
  for(let d=1; d<=daysInMonth; d++){
    const ds = _agendDateStr(y, mo, d);
    const past = ds < todayStr;
    const isToday = ds === todayStr;
    cells += past
      ? `<div class="ic-cal-cell past">${d}</div>`
      : `<button type="button" class="ic-cal-cell ${isToday?'today':''}" onclick="icPickDay('${ds}')">${d}</button>`;
  }
  return `
    <div class="ic-wrap">
      <button type="button" class="ic-back" onclick="icGoHome()">‹ Volver</button>
      <div class="ic-cal-head">
        <button type="button" class="ic-cal-nav" onclick="icCalMove(-1)">‹</button>
        <div class="ic-cal-title">${_agendMesesES[mo].charAt(0).toUpperCase()+_agendMesesES[mo].slice(1)} ${y}</div>
        <button type="button" class="ic-cal-nav" onclick="icCalMove(1)">›</button>
      </div>
      <div class="ic-cal-hint">Elige el día para el que solicitas la interconsulta</div>
      <div class="ic-cal-grid">${head}${cells}</div>
    </div>`;
}

function _icRenderForm(){
  const ds = IC_UI.selectedDate;
  const tipoOpts = IC_TIPOS.map(t=>`<option value="${t.v}">${t.ico} ${t.label}</option>`).join('');
  const prioOpts = IC_PRIOS.map(p=>`<option value="${p.v}">${p.label}</option>`).join('');
  return `
    <div class="ic-wrap">
      <button type="button" class="ic-back" onclick="icGoNew()">‹ Cambiar día</button>
      <div class="ic-form-date">📅 Solicitud para el <b>${_icFmtFechaLarga(ds)}</b></div>
      <form class="ic-form" onsubmit="icSubmitForm(event)">
        <div class="ic-fsec">Datos del paciente (anonimizado)</div>
        <div class="ic-frow">
          <label class="ic-field"><span>Iniciales *</span><input id="icfIniciales" type="text" maxlength="6" placeholder="Ej: J.P.R." autocomplete="off" required></label>
          <label class="ic-field sm"><span>Edad</span><input id="icfEdad" type="text" inputmode="numeric" maxlength="3" placeholder="años"></label>
        </div>
        <label class="ic-field"><span>Pieza / Ubicación *</span><input id="icfPieza" type="text" placeholder="Ej: MQ 303 · UPC 478 · Urgencia" required></label>

        <div class="ic-fsec">Unidad solicitante</div>
        <div class="ic-frow">
          <label class="ic-field"><span>Unidad / Servicio *</span><input id="icfUnidad" type="text" placeholder="Ej: Medicina Interna" required></label>
          <label class="ic-field sm"><span>Anexo</span><input id="icfAnexo" type="text" placeholder="Ej: 2456"></label>
        </div>
        <div class="ic-frow">
          <label class="ic-field"><span>Solicitante *</span><input id="icfSolicitante" type="text" placeholder="Nombre del médico o enfermera" required></label>
          <label class="ic-field sm"><span>Rol</span><select id="icfRol"><option value="medico">Médico</option><option value="enfermera">Enfermera</option></select></label>
        </div>

        <div class="ic-fsec">Interconsulta</div>
        <div class="ic-frow">
          <label class="ic-field"><span>Tipo *</span><select id="icfTipo" onchange="icOnTipoChange()">${tipoOpts}</select></label>
          <label class="ic-field sm"><span>Prioridad</span><select id="icfPrio">${prioOpts}</select></label>
        </div>
        <label class="ic-field" id="icfOtroWrap" style="display:none"><span>Especificar tipo</span><input id="icfTipoOtro" type="text" placeholder="Describe la interconsulta"></label>
        <label class="ic-field"><span>Motivo / pregunta clínica</span><textarea id="icfMotivo" rows="2" placeholder="¿Qué se necesita evaluar o resolver?"></textarea></label>
        <label class="ic-field"><span>Diagnóstico / cirugía propuesta</span><input id="icfDg" type="text" placeholder="Ej: Colelitiasis · Colecistectomía electiva"></label>

        <div class="ic-fsec">Antecedentes</div>
        <label class="ic-field"><span>Comorbilidades</span><textarea id="icfComorb" rows="2" placeholder="Ej: HTA, DM2, EPOC…"></textarea></label>
        <label class="ic-field"><span>Exámenes relevantes</span><textarea id="icfExam" rows="2" placeholder="Ej: Hb 9.8, Crea 1.6, ECG…"></textarea></label>
        <label class="ic-field"><span>Medicamentos en uso</span><textarea id="icfMed" rows="2" placeholder="Ej: Losartán, Metformina, AAS…"></textarea></label>

        <div class="ic-form-actions">
          <button type="button" class="ic-btn-sec" onclick="icGoHome()">Cancelar</button>
          <button type="submit" id="icSubmitBtn" class="ic-btn-pri">Enviar interconsulta</button>
        </div>
      </form>
    </div>`;
}

function _icRenderDetail(){
  const r = icLoadData().find(x => x && x.id === IC_UI.detailId);
  if(!r){ return `<div class="ic-wrap"><button type="button" class="ic-back" onclick="icDetailBack()">‹ Volver</button><div class="ic-empty"><span>❓</span>Interconsulta no encontrada.</div></div>`; }
  const isAdmin = !!IC_UI.admin;
  const tm = _icTipoMeta(r.tipo);
  const tipoLabel = r.tipo === 'otro' ? (r.tipoOtro || 'Otra') : tm.label;
  const realizada = r.estado === 'realizada';
  const row = (lbl, val) => val ? `<div class="ic-d-row"><div class="ic-d-lbl">${lbl}</div><div class="ic-d-val">${_icEsc(String(val))}</div></div>` : '';
  const created = r.createdAt ? new Date(r.createdAt).toLocaleString('es-CL',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}) : '';
  const realAt = r.realizadaAt ? new Date(r.realizadaAt).toLocaleString('es-CL',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}) : '';
  const acepAt = r.aceptadaAt ? new Date(r.aceptadaAt).toLocaleString('es-CL',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}) : '';
  let actBtns;
  if(r.estado === 'realizada'){
    actBtns = `<button type="button" class="ic-btn-sec" onclick="icDoReabrir('${r.id}')">↩ Reabrir</button>`;
  } else if(r.estado === 'aceptada'){
    actBtns = `<button type="button" class="ic-btn-pri" onclick="icDoRealizada('${r.id}')">✅ Marcar realizada</button>`;
  } else {
    actBtns = `<button type="button" class="ic-btn-acc" onclick="icDoAceptar('${r.id}')">🔵 Aceptar</button>`
            + `<button type="button" class="ic-btn-pri" onclick="icDoRealizada('${r.id}')">✅ Realizada</button>`;
  }
  const acts = isAdmin ? `
    <div class="ic-d-actions">
      ${actBtns}
      <button type="button" class="ic-btn-danger" onclick="icDoDelete('${r.id}')">🗑 Borrar</button>
    </div>` : '';
  return `
    <div class="ic-wrap">
      <button type="button" class="ic-back" onclick="icDetailBack()">‹ Volver</button>
      <div class="ic-d-head">
        <div class="ic-d-tipo">${tm.ico} ${_icEsc(tipoLabel)}</div>
        ${_icStatusChip(r.estado)}
      </div>
      <div class="ic-d-card">
        ${row('Prioridad', _icPrioMeta(r.prioridad).label)}
        ${row('Día preferido', _icFmtFechaLarga(r.fecha))}
        ${row('Iniciales', r.iniciales)}
        ${row('Edad', r.edad ? r.edad+' años' : '')}
        ${row('Pieza / Ubicación', r.pieza)}
        ${row('Unidad solicitante', r.unidad)}
        ${row('Anexo', r.anexo)}
        ${row('Solicitante', (r.solicitanteRol==='enfermera'?'Enf. ':'Dr(a). ') + (r.solicitante||''))}
        ${row('Motivo / pregunta', r.motivo)}
        ${row('Dg / cirugía', r.dgCirugia)}
        ${row('Comorbilidades', r.comorbilidades)}
        ${row('Exámenes', r.examenes)}
        ${row('Medicamentos', r.medicamentos)}
        ${row('Enviada', created)}
        ${(r.aceptadaAt && !realizada) ? row('Aceptada', acepAt + (r.aceptadaBy?(' · '+r.aceptadaBy):'')) : ''}
        ${realizada ? row('Realizada', realAt + (r.realizadaBy?(' · '+r.realizadaBy):'')) : ''}
        ${realizada ? row('Nota', r.notaRealizada) : ''}
      </div>
      ${acts}
    </div>`;
}

// --- Acciones de navegación ---
function icGoHome(){ IC_UI.view='home'; renderIcModule(); }
// Volver del detalle a donde se venía (seguimiento o home).
function icDetailBack(){ IC_UI.view = IC_UI.detailReturn || 'home'; renderIcModule(); }
function icGoNew(){
  const t = new Date();
  if(!IC_UI.calYear){ IC_UI.calYear = t.getFullYear(); IC_UI.calMonth = t.getMonth(); }
  IC_UI.view='cal'; renderIcModule();
}
function icSetTab(tab){ IC_UI.tab = tab; renderIcModule(); }
function icCalMove(delta){
  let m = IC_UI.calMonth + delta, y = IC_UI.calYear;
  if(m < 0){ m = 11; y--; } else if(m > 11){ m = 0; y++; }
  IC_UI.calYear = y; IC_UI.calMonth = m; renderIcModule();
}
function icPickDay(ds){ IC_UI.selectedDate = ds; IC_UI.view='form'; renderIcModule(); setTimeout(()=>{ const e=document.getElementById('icfIniciales'); if(e) e.focus(); },60); }
function icOpenDetail(id){ IC_UI.detailReturn = (IC_UI.view === 'seguimiento') ? 'seguimiento' : 'home'; IC_UI.detailId = id; IC_UI.view='detail'; renderIcModule(); }
function icOnTipoChange(){
  const sel = document.getElementById('icfTipo');
  const w = document.getElementById('icfOtroWrap');
  if(sel && w) w.style.display = (sel.value === 'otro') ? '' : 'none';
}

// --- Envío del formulario ---
async function icSubmitForm(ev){
  if(ev && ev.preventDefault) ev.preventDefault();
  const g = id => document.getElementById(id);
  const iniciales = (g('icfIniciales').value||'').trim();
  const pieza = (g('icfPieza').value||'').trim();
  const unidad = (g('icfUnidad').value||'').trim();
  const solicitante = (g('icfSolicitante').value||'').trim();
  const tipo = g('icfTipo').value;
  const tipoOtro = (g('icfTipoOtro').value||'').trim();
  if(!iniciales){ alert('Ingresa las iniciales del paciente.'); return; }
  if(!pieza){ alert('Ingresa la pieza / ubicación del paciente.'); return; }
  if(!unidad){ alert('Ingresa la unidad solicitante.'); return; }
  if(!solicitante){ alert('Ingresa el nombre del solicitante (médico o enfermera).'); return; }
  if(tipo === 'otro' && !tipoOtro){ alert('Especifica el tipo de interconsulta.'); return; }
  if(!IC_UI.selectedDate){ alert('Elige un día en el calendario.'); return; }

  const req = icCreateRequest({
    fecha: IC_UI.selectedDate,
    iniciales,
    edad: (g('icfEdad').value||'').trim(),
    pieza, unidad,
    anexo: (g('icfAnexo').value||'').trim(),
    solicitante,
    solicitanteRol: g('icfRol').value,
    tipo, tipoOtro,
    prioridad: g('icfPrio').value,
    motivo: (g('icfMotivo').value||'').trim(),
    dgCirugia: (g('icfDg').value||'').trim(),
    comorbilidades: (g('icfComorb').value||'').trim(),
    examenes: (g('icfExam').value||'').trim(),
    medicamentos: (g('icfMed').value||'').trim()
  });

  const base = getBackendURL();
  if(!base){
    alert('Interconsulta guardada en este dispositivo.\n\n(No hay conexión a la nube configurada — avisa directamente al Servicio de Anestesia.)');
    IC_UI.view='home'; IC_UI.tab='pendiente'; renderIcModule(); updateIcBadges();
    return;
  }
  const btn = g('icSubmitBtn');
  if(btn){ btn.disabled = true; btn.textContent = 'Enviando…'; }
  let ok = false;
  try{ ok = await _icSyncVerified(req.id, r => !!r && !r.deleted); }catch(e){ ok = false; }
  if(ok){
    try{ notifyAdminsPush('interconsulta', req.id); }catch(e){}
    alert('✅ Interconsulta enviada y registrada en la nube. El Servicio de Anestesia será notificado.');
  } else {
    alert('⚠️ La interconsulta quedó guardada en este dispositivo, pero NO se pudo registrar en la nube (revisa tu conexión).\n\nSe reintentará al reabrir. Si es urgente, avisa directamente al Servicio de Anestesia.');
  }
  IC_UI.view='home'; IC_UI.tab='pendiente'; renderIcModule(); updateIcBadges();
}

// --- Acciones de administrador (requieren haber entrado por la vía Administrador) ---
async function icDoAceptar(id){
  if(!IC_UI.admin){ alert('Entra por la vía "Administrador" para aceptar interconsultas.'); return; }
  icMarkAceptada(id);
  renderIcModule(); updateIcBadges();
  try{ await _icSyncVerified(id, r => !!r && (r.estado === 'aceptada' || r.estado === 'realizada')); }catch(e){}
}
async function icDoRealizada(id){
  if(!IC_UI.admin){ alert('Entra por la vía "Administrador" para marcar interconsultas como realizadas.'); return; }
  const nota = prompt('Nota / indicación de la interconsulta (opcional):', '');
  if(nota === null) return; // canceló
  icMarkRealizada(id, (nota||'').trim());
  renderIcModule(); updateIcBadges();
  try{ await _icSyncVerified(id, r => !!r && r.estado === 'realizada'); }catch(e){}
}
async function icDoReabrir(id){
  if(!IC_UI.admin){ alert('Entra por la vía "Administrador" para reabrir.'); return; }
  icReabrir(id);
  renderIcModule(); updateIcBadges();
  try{ await _icSyncVerified(id, r => !!r && r.estado === 'pendiente'); }catch(e){}
}
async function icDoDelete(id){
  if(!IC_UI.admin){ alert('Entra por la vía "Administrador" para borrar interconsultas.'); return; }
  if(!confirm('¿Borrar esta interconsulta definitivamente?\n\nSe quita de la lista para liberar espacio. No se puede deshacer.')) return;
  icDeleteRequest(id);
  IC_UI.view='home'; renderIcModule(); updateIcBadges();
  try{ await _icSyncVerified(id, r => !r || r.deleted === true); }catch(e){}
}

// ============================================================
// PORTAL VASCULAR (módulo propio) — Fase 1
// Landing con 3 vías: Agendamiento Vascular (activo, reusa el motor de
// agendamiento en contexto vascular), Registro de Procedimientos y Evaluación
// de Acceso Vascular (Fases 2 y 3).
// ============================================================
const VASC_UI = { view:'landing', detailId:null, detailSrc:null, evalAdmin:false };
function openVascModule(){
  ['modulesScreen','solChooser','portalChooser','guiasScreen','icScreen','agendScreen'].forEach(id=>{ const e=document.getElementById(id); if(e) e.classList.add('hidden'); });
  const s=document.getElementById('vascScreen'); if(s) s.classList.remove('hidden');
  VASC_UI.view='landing';
  _vascSetHeadSub();
  renderVascModule();
}
function closeVascModule(){ const s=document.getElementById('vascScreen'); if(s) s.classList.add('hidden'); showModulesScreen(); }
function vascBack(){
  if(VASC_UI.view === 'regform' || VASC_UI.view === 'regdetail'){ VASC_UI.view='registro'; renderVascModule(); return; }
  if(VASC_UI.view === 'evalform' || VASC_UI.view === 'evaldetail'){ VASC_UI.view='eval'; renderVascModule(); return; }
  if(VASC_UI.view === 'registro' || VASC_UI.view === 'eval'){ VASC_UI.view='landing'; renderVascModule(); return; }
  closeVascModule();
}
function vascGoLanding(){ VASC_UI.view='landing'; renderVascModule(); }
function _vascSetHeadSub(){
  const el=document.getElementById('vascHeadSub'); if(!el) return;
  if(VASC_UI.view==='registro' || VASC_UI.view==='regform' || VASC_UI.view==='regdetail') el.textContent='📋 Registro de procedimientos';
  else if(VASC_UI.view==='eval' || VASC_UI.view==='evalform' || VASC_UI.view==='evaldetail') el.textContent=_vascEvalHeadSub();
  else el.textContent='Accesos vasculares';
}
function renderVascModule(){
  const body=document.getElementById('vascModuleBody'); if(!body) return;
  let html;
  if(VASC_UI.view==='registro') html=_vascRenderRegistro();
  else if(VASC_UI.view==='regform') html=_vascRenderRegForm();
  else if(VASC_UI.view==='regdetail') html=_vascRenderRegDetail();
  else if(VASC_UI.view==='eval') html=_vascRenderEval();
  else if(VASC_UI.view==='evalform') html=_vascRenderEvalForm();
  else if(VASC_UI.view==='evaldetail') html=_vascRenderEvalDetail();
  else html=_vascRenderLanding();
  body.innerHTML=html;
  _vascSetHeadSub();
  const wrap=document.querySelector('#vascScreen .guias-body');
  if(wrap){ try{ wrap.scrollTo({top:0,behavior:'instant'}); }catch(e){ wrap.scrollTop=0; } }
}
function _vascRenderLanding(){
  const n = _vascAllRecords().length;
  return `
    <div class="ic-wrap">
      <div class="ic-intro">Portal de <b>Accesos Vasculares</b> del Servicio de Anestesiología. Agenda, registra y solicita evaluaciones de accesos.</div>
      <button type="button" class="ic-land-btn" onclick="openVascAgendamiento()">
        <div class="ic-land-ico">🗓️</div>
        <div class="ic-land-tx"><b>Agendamiento Vascular</b><span>Agenda instalación de accesos: PICC, MidLine, CVC, diálisis, port-a-cath…</span></div>
        <span class="ic-land-arrow">›</span>
      </button>
      <button type="button" class="ic-land-btn" onclick="openVascRegistro()">
        <div class="ic-land-ico">📋</div>
        <div class="ic-land-tx"><b>Registro de Procedimientos</b><span>Bitácora de accesos instalados (agendados y no agendados) · últimos 120 días${n?` · ${n}`:''}</span></div>
        <span class="ic-land-arrow">›</span>
      </button>
      <button type="button" class="ic-land-btn" onclick="openVascEval()">
        <div class="ic-land-ico">🩻</div>
        <div class="ic-land-tx"><b>Evaluación de Acceso Vascular</b><span>Solicitar evaluación para instalar accesos (enfermera o anestesiólogo)</span></div>
        <span class="ic-land-arrow">›</span>
      </button>
    </div>`;
}
// Abre el motor de agendamiento en contexto vascular, ENCIMA del Portal Vascular
// (al cerrar el agendamiento se vuelve a ver el Portal Vascular).
function openVascAgendamiento(){ openAgendamientoModule({ vasc:true }); }

// ============================================================
// PORTAL VASCULAR · REGISTRO DE PROCEDIMIENTOS (Fase 2)
// Bitácora (retención 120 días) que junta: (a) agendamientos vasculares y
// (b) instalaciones NO agendadas registradas a mano. Canal en la nube "<inst>-vasc"
// (fusión por id + tombstones), mismo modelo verify-and-retry de Interconsultas.
// ============================================================
const VASC_DATA_LS_KEY = 'appx_vasc_data_v1';
const VASC_RETENTION_DAYS = 120;
const VASC_LATERALIDAD = [
  { v:'',          label:'— Sin especificar —' },
  { v:'derecho',   label:'Derecho' },
  { v:'izquierdo', label:'Izquierdo' },
  { v:'bilateral', label:'Bilateral / Indistinto' }
];
function _vascDispositivos(){
  const s = (typeof _agendGetSala==='function') ? _agendGetSala('accesos_vasculares') : null;
  const cat = (s && Array.isArray(s.procedimientosCatalogo)) ? s.procedimientosCatalogo.slice() : ['Vía Venosa Periférica','PICC Line','MidLine','Catéter Venoso Central (CVC)','Catéter de Diálisis Transitorio','Port-a-cath'];
  if(!cat.some(x=>/otro/i.test(x))) cat.push('Otro');
  return cat;
}
function _vascEsc(s){ return _gpEsc(s); }
function _vascRemoteId(){ return INSTITUTION ? (INSTITUTION.id + '-vasc') : null; }
function _vascGenId(){ return 'vx_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,7); }
function _vascReqTs(r){ return r ? (r.updatedAt || r.createdAt || 0) : 0; }
function _vascPad(n){ return String(n).padStart(2,'0'); }
function _vascTodayStr(){ const d=new Date(); return `${d.getFullYear()}-${_vascPad(d.getMonth()+1)}-${_vascPad(d.getDate())}`; }
function _vascCutoffDate(){ const d=new Date(); d.setDate(d.getDate()-VASC_RETENTION_DAYS); return `${d.getFullYear()}-${_vascPad(d.getMonth()+1)}-${_vascPad(d.getDate())}`; }

// Privacidad: solo iniciales; nunca nombre completo ni RUT.
function _vascSanitize(r){
  if(!r || typeof r!=='object' || r.deleted) return r;
  let ch=false;
  if(r.rut){ delete r.rut; ch=true; }
  if(typeof r.iniciales==='string' && /\s/.test(r.iniciales.trim()) && r.iniciales.trim().length>5){
    const ini=r.iniciales.trim().split(/[\s.]+/).filter(Boolean).slice(0,3).map(p=>(p[0]||'').toUpperCase()).join('.')+'.';
    if(ini && ini!==r.iniciales){ r.iniciales=ini; ch=true; }
  }
  if(ch) r.updatedAt=Date.now();
  return r;
}
function vascLoadData(){
  try{ let a=JSON.parse(localStorage.getItem(VASC_DATA_LS_KEY)||'[]'); if(!Array.isArray(a)) a=[]; a.forEach(_vascSanitize); return a; }
  catch(e){ return []; }
}
function vascSaveData(arr){ try{ localStorage.setItem(VASC_DATA_LS_KEY, JSON.stringify(Array.isArray(arr)?arr:[])); }catch(e){} }
function _vascMergeData(remoteArr, localArr){
  const map={}; const cutoff=Date.now()-VASC_RETENTION_DAYS*24*3600*1000;
  (Array.isArray(remoteArr)?remoteArr:[]).forEach(r=>{ if(r&&r.id) map[r.id]=r; });
  (Array.isArray(localArr)?localArr:[]).forEach(r=>{ if(!r||!r.id) return; const ex=map[r.id]; if(!ex||_vascReqTs(r)>=_vascReqTs(ex)) map[r.id]=r; });
  return Object.values(map).filter(r=>!(r&&r.deleted&&(r.deletedAt||0)<cutoff));
}
let _vascSyncing=false;
async function vascSyncNow(){
  const base=getBackendURL(); const id=_vascRemoteId();
  if(!base||!id||_vascSyncing) return false;
  _vascSyncing=true;
  try{
    let remoteArr=[];
    try{ const r=await fetch(base+'/api/state/'+encodeURIComponent(id), _stateGetOpts()); if(!r.ok) return false; const j=await r.json(); if(j&&!j._empty&&Array.isArray(j.data)) remoteArr=j.data; }catch(e){ return false; }
    const merged=_vascMergeData(remoteArr, vascLoadData()); merged.forEach(_vascSanitize);
    vascSaveData(merged);
    const token=getBackendToken(); if(!token) return false;
    try{ const pr=await fetch(base+'/api/state/'+encodeURIComponent(id), {method:'POST', headers:{'Content-Type':'application/json','Authorization':'Bearer '+token}, body:JSON.stringify({data:merged})}); return pr.ok; }catch(e){ return false; }
  }catch(e){ return false; } finally{ _vascSyncing=false; }
}
async function _vascSyncVerified(reqId, predicate, tries){
  tries=tries||5;
  for(let i=0;i<tries;i++){
    let ok=false; try{ ok=await vascSyncNow(); }catch(e){ ok=false; }
    if(ok){ try{ const base=getBackendURL(); const id=_vascRemoteId(); const r=await fetch(base+'/api/state/'+encodeURIComponent(id)+'?cb='+Date.now(), _stateGetOpts()); if(r.ok){ const j=await r.json(); const arr=(j&&Array.isArray(j.data))?j.data:[]; if(predicate(arr.find(x=>x&&x.id===reqId))) return true; } }catch(e){} }
    await new Promise(res=>setTimeout(res,250+Math.floor(Math.random()*600)));
  }
  return false;
}
// Registros MANUALES vigentes (dentro de la retención). Excluye las solicitudes
// de evaluación (tipo:'evaluacion'), que tienen su propio módulo.
function _vascManualRecords(){
  const cut=_vascCutoffDate();
  return vascLoadData().filter(r=> r && !r.deleted && r.tipo!=='evaluacion' && String(r.fecha||'') >= cut).map(r=>({ ...r, src:'manual' }));
}
// Agendamientos VASCULARES (leídos del canal de agendamiento, sala accesos_vasculares).
function _vascAgendRecords(){
  const cut=_vascCutoffDate();
  let data={}; try{ data=(typeof agendLoadData==='function')?agendLoadData():{}; }catch(e){ data={}; }
  const bySala=data['accesos_vasculares']||{};
  const out=[];
  Object.keys(bySala).forEach(dateStr=>{
    if(String(dateStr) < cut) return;
    let arr=bySala[dateStr];
    if(!Array.isArray(arr)){ try{ arr=_agendMigrateDayEntry(arr); }catch(e){ arr=[]; } }
    (arr||[]).forEach(r=>{ if(r && !r.deleted) out.push({ src:'agend', id:r.id, fecha:dateStr, iniciales:r.paciente, edad:r.edad, pieza:r.pieza, unidad:r.unidadHosp, lateralidad:r.accesosLado, dispositivo:r.procedimiento, hallazgos:r.accesosHallazgos, coagulacion:r.accesosCoagulacion, responsable:r.solicitanteNombre, estado:r.estado, urgencia:r.accesosUrgencia, createdAt:r.createdAt }); });
  });
  return out;
}
function _vascAllRecords(){
  return _vascManualRecords().concat(_vascAgendRecords())
    .sort((a,b)=> String(b.fecha||'').localeCompare(String(a.fecha||'')) || (b.createdAt||0)-(a.createdAt||0));
}
function vascCreateReg(f){
  const arr=vascLoadData(); const now=Date.now();
  const req={ id:_vascGenId(), tipo:'manual', fecha:f.fecha||'', iniciales:(f.iniciales||'').slice(0,8), edad:f.edad||'', pieza:f.pieza||'', unidad:f.unidad||'', lateralidad:f.lateralidad||'', dispositivo:f.dispositivo||'', dispositivoOtro:f.dispositivoOtro||'', hallazgos:f.hallazgos||'', coagulacion:f.coagulacion||'', responsable:f.responsable||'', responsableRol:f.responsableRol||'enfermera', notas:f.notas||'', createdAt:now, updatedAt:now };
  _vascSanitize(req);
  arr.push(req); vascSaveData(arr); return req;
}
function vascDeleteReg(id){
  const arr=vascLoadData(); const r=arr.find(x=>x&&x.id===id); if(!r) return false;
  r.deleted=true; r.deletedAt=Date.now(); r.updatedAt=Date.now(); vascSaveData(arr); return true;
}

// --- UI del Registro ---
function openVascRegistro(){
  VASC_UI.view='registro';
  _vascSetHeadSub();
  renderVascModule();
  try{ if(typeof agendSyncNow==='function') agendSyncNow().then(()=>{ if(VASC_UI.view==='registro') renderVascModule(); }); }catch(e){}
  try{ vascSyncNow().then(()=>{ if(VASC_UI.view==='registro') renderVascModule(); }); }catch(e){}
}
function _vascFmtFecha(ds){
  if(!ds) return '—';
  try{ const d=_agendParseDateStr(ds); return `${d.getDate()}/${_vascPad(d.getMonth()+1)}/${d.getFullYear()}`; }catch(e){ return ds; }
}
function _vascLatLabel(v){ const m=VASC_LATERALIDAD.find(x=>x.v===v); return m?m.label:(v||''); }
function _vascRenderRegistro(){
  const recs=_vascAllRecords();
  const head=`
    <div class="ic-modehead">
      <button type="button" class="ic-back" onclick="vascGoLanding()">‹ Portal Vascular</button>
      <span class="ic-mode-pill">📋 Últimos ${VASC_RETENTION_DAYS} días</span>
    </div>
    <div class="ic-intro">Bitácora de accesos vasculares: <b>📅 agendados</b> y <b>✍️ registrados a mano</b> (no agendados). Se guardan ${VASC_RETENTION_DAYS} días.</div>
    <button type="button" class="ic-newbtn" onclick="vascGoRegForm()">+ Registrar instalación (no agendada)</button>`;
  if(recs.length===0){
    return `<div class="ic-wrap">${head}<div class="ic-empty"><span>🗂️</span>Aún no hay procedimientos registrados.</div></div>`;
  }
  const rows=recs.map(_vascRegRow).join('');
  return `<div class="ic-wrap">${head}<div class="ic-list">${rows}</div></div>`;
}
function _vascRegRow(r){
  const src = r.src==='manual'
    ? '<span class="ic-track-tk aceptada">✍️ Registro</span>'
    : `<span class="ic-track-tk recibida">📅 Agendado${r.estado?(' · '+_vascEsc(r.estado)):''}</span>`;
  const disp = r.dispositivo==='Otro' && r.dispositivoOtro ? r.dispositivoOtro : (r.dispositivo||'—');
  const sub = [ disp, r.lateralidad?_vascLatLabel(r.lateralidad):'', r.responsable?('· '+_vascEsc(r.responsable)):'' ].filter(Boolean).join(' · ');
  const main = `${_vascEsc(r.iniciales||'—')}${r.pieza?(' · 🛏 '+_vascEsc(r.pieza)):''}`;
  return `
    <div class="ic-track-row st-${r.src==='manual'?'aceptada':'recibida'}" onclick="vascOpenRegDetail('${r.src}','${r.id}')">
      <div class="ic-track-info">
        <div class="ic-track-main">${main}</div>
        <div class="ic-track-sub">${_vascEsc(sub)}</div>
      </div>
      <div style="text-align:right;flex-shrink:0">${src}<div style="font-size:11px;color:var(--muted);margin-top:4px">${_vascFmtFecha(r.fecha)}</div></div>
    </div>`;
}
function vascOpenRegDetail(src, id){ VASC_UI.detailSrc=src; VASC_UI.detailId=id; VASC_UI.view='regdetail'; renderVascModule(); }
function _vascRenderRegDetail(){
  const recs=_vascAllRecords();
  const r=recs.find(x=>x.src===VASC_UI.detailSrc && x.id===VASC_UI.detailId);
  if(!r){ return `<div class="ic-wrap"><button type="button" class="ic-back" onclick="vascBack()">‹ Volver</button><div class="ic-empty"><span>❓</span>Registro no encontrado.</div></div>`; }
  const row=(k,v)=> v ? `<div class="ic-d-row"><div class="ic-d-lbl">${k}</div><div class="ic-d-val">${_vascEsc(String(v))}</div></div>` : '';
  const disp = r.dispositivo==='Otro' && r.dispositivoOtro ? r.dispositivoOtro : r.dispositivo;
  const esManual = r.src==='manual';
  const del = esManual ? `<div class="ic-d-actions"><button type="button" class="ic-btn-danger" onclick="vascDoDeleteReg('${r.id}')">🗑 Borrar registro</button></div>` : '';
  return `
    <div class="ic-wrap">
      <button type="button" class="ic-back" onclick="vascBack()">‹ Volver</button>
      <div class="ic-d-head">
        <div class="ic-d-tipo">💉 ${_vascEsc(disp||'Acceso vascular')}</div>
        ${esManual?'<span class="ic-track-tk aceptada">✍️ Registro</span>':`<span class="ic-track-tk recibida">📅 Agendado${r.estado?(' · '+_vascEsc(r.estado)):''}</span>`}
      </div>
      <div class="ic-d-card">
        ${row('Fecha', _vascFmtFecha(r.fecha))}
        ${row('Iniciales', r.iniciales)}
        ${row('Edad', r.edad?String(r.edad)+' años':'')}
        ${row('Pieza / Ubicación', r.pieza)}
        ${row('Unidad', r.unidad)}
        ${row('Dispositivo', disp)}
        ${row('Lateralidad', _vascLatLabel(r.lateralidad))}
        ${row('Hallazgos vasculares', r.hallazgos)}
        ${row('Coagulación', r.coagulacion)}
        ${row(esManual?'Responsable':'Solicitante', (r.responsableRol==='medico'?'Dr(a). ':(r.responsableRol==='enfermera'?'Enf. ':'')) + (r.responsable||''))}
        ${row('Notas', r.notas)}
        ${row('Urgencia', r.urgencia)}
      </div>
      ${del}
    </div>`;
}
async function vascDoDeleteReg(id){
  if(!confirm('¿Borrar este registro manual? No se puede deshacer.')) return;
  vascDeleteReg(id);
  VASC_UI.view='registro'; renderVascModule();
  try{ await _vascSyncVerified(id, r=> !r || r.deleted===true); }catch(e){}
}
function vascGoRegForm(){ VASC_UI.view='regform'; renderVascModule(); setTimeout(()=>{ const e=document.getElementById('vfIniciales'); if(e) e.focus(); },60); }
function _vascRenderRegForm(){
  const disp=_vascDispositivos().map(d=>`<option value="${_vascEsc(d)}">${_vascEsc(d)}</option>`).join('');
  const lat=VASC_LATERALIDAD.map(l=>`<option value="${l.v}">${l.label}</option>`).join('');
  return `
    <div class="ic-wrap">
      <button type="button" class="ic-back" onclick="vascBack()">‹ Volver</button>
      <div class="ic-intro">Registra una instalación de acceso vascular <b>que NO fue agendada</b>. Datos anonimizados (solo iniciales).</div>
      <form class="ic-form" onsubmit="vascSubmitReg(event)">
        <div class="ic-fsec">Paciente (anonimizado)</div>
        <div class="ic-frow">
          <label class="ic-field"><span>Iniciales *</span><input id="vfIniciales" type="text" maxlength="8" placeholder="Ej: J.P.R." autocomplete="off" required></label>
          <label class="ic-field sm"><span>Edad</span><input id="vfEdad" type="text" inputmode="numeric" maxlength="3" placeholder="años"></label>
        </div>
        <div class="ic-frow">
          <label class="ic-field"><span>Pieza / Ubicación</span><input id="vfPieza" type="text" placeholder="Ej: MQ 303, UPC 478"></label>
          <label class="ic-field"><span>Unidad</span><input id="vfUnidad" type="text" placeholder="Ej: Medicina, UPC"></label>
        </div>
        <div class="ic-fsec">Procedimiento</div>
        <div class="ic-frow">
          <label class="ic-field"><span>Dispositivo *</span><select id="vfDisp" onchange="vascOnDispChange()">${disp}</select></label>
          <label class="ic-field sm"><span>Lateralidad</span><select id="vfLat">${lat}</select></label>
        </div>
        <label class="ic-field" id="vfDispOtroWrap" style="display:none"><span>Especificar dispositivo</span><input id="vfDispOtro" type="text" placeholder="Describe el acceso instalado"></label>
        <label class="ic-field"><span>Fecha de instalación *</span><input id="vfFecha" type="date" required></label>
        <label class="ic-field"><span>Hallazgos vasculares</span><textarea id="vfHallazgos" rows="2" placeholder="Vasos, accesos previos, dificultades…"></textarea></label>
        <label class="ic-field"><span>Coagulación / plaquetas</span><input id="vfCoag" type="text" placeholder="Ej: plaquetas 120k, INR 1.1"></label>
        <div class="ic-fsec">Responsable</div>
        <div class="ic-frow">
          <label class="ic-field"><span>Quién lo instaló/solicitó *</span><input id="vfResp" type="text" placeholder="Nombre" required></label>
          <label class="ic-field sm"><span>Rol</span><select id="vfRol"><option value="enfermera">Enfermera</option><option value="medico">Médico</option></select></label>
        </div>
        <label class="ic-field"><span>Notas</span><textarea id="vfNotas" rows="2" placeholder="Observaciones adicionales"></textarea></label>
        <div class="ic-form-actions">
          <button type="button" class="ic-btn-sec" onclick="vascBack()">Cancelar</button>
          <button type="submit" id="vfSubmit" class="ic-btn-pri">Guardar registro</button>
        </div>
      </form>
    </div>`;
}
function vascOnDispChange(){
  const sel=document.getElementById('vfDisp'); const w=document.getElementById('vfDispOtroWrap');
  if(sel && w) w.style.display = /otro/i.test(sel.value) ? '' : 'none';
}
async function vascSubmitReg(ev){
  if(ev&&ev.preventDefault) ev.preventDefault();
  const g=id=>document.getElementById(id);
  const iniciales=(g('vfIniciales').value||'').trim();
  const disp=g('vfDisp').value;
  const dispOtro=(g('vfDispOtro').value||'').trim();
  const fecha=(g('vfFecha').value||'').trim();
  const resp=(g('vfResp').value||'').trim();
  if(!iniciales){ alert('Ingresa las iniciales del paciente.'); return; }
  if(/otro/i.test(disp) && !dispOtro){ alert('Especifica el dispositivo instalado.'); return; }
  if(!fecha){ alert('Ingresa la fecha de instalación.'); return; }
  if(!resp){ alert('Ingresa quién instaló o solicitó el acceso.'); return; }
  const req=vascCreateReg({ fecha, iniciales, edad:(g('vfEdad').value||'').trim(), pieza:(g('vfPieza').value||'').trim(), unidad:(g('vfUnidad').value||'').trim(), lateralidad:g('vfLat').value, dispositivo:disp, dispositivoOtro:dispOtro, hallazgos:(g('vfHallazgos').value||'').trim(), coagulacion:(g('vfCoag').value||'').trim(), responsable:resp, responsableRol:g('vfRol').value, notas:(g('vfNotas').value||'').trim() });
  const base=getBackendURL();
  const btn=g('vfSubmit'); if(btn){ btn.disabled=true; btn.textContent='Guardando…'; }
  if(!base){ alert('Registro guardado en este dispositivo (sin nube configurada).'); VASC_UI.view='registro'; renderVascModule(); return; }
  let ok=false; try{ ok=await _vascSyncVerified(req.id, r=>!!r && !r.deleted); }catch(e){ ok=false; }
  alert(ok ? '✅ Registro guardado en la nube.' : '⚠️ Guardado en este dispositivo; no se pudo registrar en la nube (se reintentará al reabrir).');
  VASC_UI.view='registro'; renderVascModule();
}

// ============================================================
// PORTAL VASCULAR · EVALUACIÓN DE ACCESO VASCULAR (Fase 3)
// Solicitud SEPARADA (canal -vasc, tipo:'evaluacion') para pedir evaluación
// de instalación de accesos. Estados Recibida→Aceptada→Realizada (reusa los
// chips de Interconsultas). Al enviar: push (deep-link ?vev=<id>) + correo
// inmediato (mailto a agendCcEmails). Gestión (aceptar/realizar/borrar) tras PIN.
// ============================================================
function _vascEvalRecords(){
  return vascLoadData().filter(r=> r && !r.deleted && r.tipo==='evaluacion')
    .sort((a,b)=>{
      const rank={pendiente:0,aceptada:1,realizada:2};
      return (rank[a.estado]??0)-(rank[b.estado]??0) || (b.createdAt||0)-(a.createdAt||0);
    });
}
function vascCreateEval(f){
  const arr=vascLoadData(); const now=Date.now();
  const req={ id:_vascGenId(), tipo:'evaluacion', fecha:f.fecha||'', iniciales:(f.iniciales||'').slice(0,8), edad:f.edad||'', pieza:f.pieza||'', unidad:f.unidad||'', solicitante:f.solicitante||'', solicitanteRol:f.solicitanteRol||'enfermera', accesos:f.accesos||'', motivo:f.motivo||'', comorbilidades:f.comorbilidades||'', coagulacion:f.coagulacion||'', prioridad:f.prioridad||'rutinaria', estado:'pendiente', createdAt:now, updatedAt:now, aceptadaAt:null, aceptadaBy:null, realizadaAt:null, realizadaBy:null, notaRealizada:'' };
  _vascSanitize(req);
  arr.push(req); vascSaveData(arr); return req;
}
function _vascEvalName(){ try{ const u=(typeof getCurrentUser==='function')?getCurrentUser():null; if(u&&u.name) return u.name; }catch(e){} return 'Anestesia'; }
function vascEvalMarkAceptada(id){ const arr=vascLoadData(); const r=arr.find(x=>x&&x.id===id); if(!r) return; r.estado='aceptada'; r.aceptadaAt=Date.now(); r.aceptadaBy=_vascEvalName(); r.updatedAt=Date.now(); vascSaveData(arr); }
function vascEvalMarkRealizada(id, nota){ const arr=vascLoadData(); const r=arr.find(x=>x&&x.id===id); if(!r) return; if(!r.aceptadaAt){ r.aceptadaAt=Date.now(); r.aceptadaBy=_vascEvalName(); } r.estado='realizada'; r.realizadaAt=Date.now(); r.realizadaBy=_vascEvalName(); r.notaRealizada=nota||''; r.updatedAt=Date.now(); vascSaveData(arr); }
function vascEvalReabrir(id){ const arr=vascLoadData(); const r=arr.find(x=>x&&x.id===id); if(!r) return; r.estado='pendiente'; r.aceptadaAt=null; r.aceptadaBy=null; r.realizadaAt=null; r.realizadaBy=null; r.updatedAt=Date.now(); vascSaveData(arr); }
function vascEvalDelete(id){ const arr=vascLoadData(); const r=arr.find(x=>x&&x.id===id); if(!r) return; r.deleted=true; r.deletedAt=Date.now(); r.updatedAt=Date.now(); vascSaveData(arr); }

// Correo inmediato (mailto) a los mismos destinatarios del agendamiento antiguo.
function _vascEvalMailto(req){
  const cc = (INSTITUTION && Array.isArray(INSTITUTION.agendCcEmails)) ? INSTITUTION.agendCcEmails.slice() : [];
  if(!cc.length) return;
  const to = cc.shift();
  const subject = `Solicitud de evaluación vascular · ${req.iniciales||''} · ${_vascFmtFecha(req.fecha)}`;
  const body = [
    'Nueva solicitud de EVALUACIÓN DE ACCESO VASCULAR:',
    '',
    'Paciente (iniciales): ' + (req.iniciales||'—') + (req.edad?(' · '+req.edad+' años'):''),
    'Ubicación: ' + ([req.pieza,req.unidad].filter(Boolean).join(' · ') || '—'),
    'Solicitante: ' + ((req.solicitanteRol==='medico'?'Dr(a). ':'Enf. ') + (req.solicitante||'—')),
    'Accesos a evaluar: ' + (req.accesos||'—'),
    'Prioridad: ' + (_icPrioMeta(req.prioridad).label),
    'Motivo / contexto: ' + (req.motivo||'—'),
    req.comorbilidades ? ('Comorbilidades: ' + req.comorbilidades) : '',
    req.coagulacion ? ('Coagulación: ' + req.coagulacion) : '',
    '',
    'Enviado desde Appnesthesia · Portal Vascular'
  ].filter(x=>x!=='').join('\n');
  const url = `mailto:${encodeURIComponent(to)}?cc=${encodeURIComponent(cc.join(','))}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  try{ const a=document.createElement('a'); a.href=url; a.style.display='none'; document.body.appendChild(a); a.click(); setTimeout(()=>{ try{ a.remove(); }catch(e){} }, 500); }catch(e){ try{ window.location.href=url; }catch(_){ } }
}

// --- Navegación / vistas de Evaluación ---
function openVascEval(){
  VASC_UI.view='eval'; VASC_UI.evalAdmin=false; VASC_UI.detailId=null;
  _vascSetHeadSub();
  renderVascModule();
  try{ vascSyncNow().then(()=>{ if(VASC_UI.view==='eval'||VASC_UI.view==='evaldetail') renderVascModule(); }); }catch(e){}
}
function _vascEvalHeadSub(){ return VASC_UI.evalAdmin ? '🔒 Evaluaciones · gestión' : '🩻 Evaluación de acceso vascular'; }
function _vascRenderEval(){
  const isAdmin=!!VASC_UI.evalAdmin;
  const recs=_vascEvalRecords();
  const head=`
    <div class="ic-modehead">
      <button type="button" class="ic-back" onclick="vascGoLanding()">‹ Portal Vascular</button>
      <span class="ic-mode-pill ${isAdmin?'admin':''}">${isAdmin?'🔒 Admin':'🩻 Evaluación'}</span>
    </div>
    <div class="ic-intro">Solicita una <b>evaluación de acceso vascular</b> (enfermera de accesos o anestesiólogo). Estado: 🎫 Recibida → 🔵 Aceptada → ✅ Realizada.</div>
    <button type="button" class="ic-newbtn" onclick="vascEvalGoForm()">+ Nueva solicitud de evaluación</button>
    ${isAdmin ? '' : '<button type="button" class="ic-land-btn admin" style="margin-top:2px" onclick="vascEvalEnterAdmin()"><div class="ic-land-ico">🔒</div><div class="ic-land-tx"><b>Administrador</b><span>Aceptar, marcar realizada o borrar</span></div><span class="ic-land-arrow">›</span></button>'}`;
  let list;
  if(recs.length===0){ list=`<div class="ic-empty"><span>📭</span>No hay solicitudes de evaluación.</div>`; }
  else { list=recs.map(r=>_vascEvalCard(r,isAdmin)).join(''); }
  return `<div class="ic-wrap">${head}<div class="ic-list">${list}</div></div>`;
}
function _vascEvalCard(r, isAdmin){
  const lineas=[];
  lineas.push(`<b>${_vascEsc(r.iniciales||'—')}</b>${r.edad?` · ${_vascEsc(String(r.edad))} a`:''}${r.pieza?` · 🛏 ${_vascEsc(r.pieza)}`:''}`);
  if(r.accesos) lineas.push(`💉 ${_vascEsc(r.accesos)}`);
  if(r.solicitante) lineas.push(`${r.solicitanteRol==='medico'?'🩺 Dr(a).':'👩‍⚕️ Enf.'} ${_vascEsc(r.solicitante)}`);
  const meta=lineas.map(l=>`<div class="ic-card-line">${l}</div>`).join('');
  let actBtns;
  if(r.estado==='realizada') actBtns=`<button type="button" class="ic-mini-btn" onclick="vascEvalDoReabrir('${r.id}')">↩ Reabrir</button>`;
  else if(r.estado==='aceptada') actBtns=`<button type="button" class="ic-mini-btn ok" onclick="vascEvalDoRealizada('${r.id}')">✅ Realizada</button>`;
  else actBtns=`<button type="button" class="ic-mini-btn acc" onclick="vascEvalDoAceptar('${r.id}')">🔵 Aceptar</button><button type="button" class="ic-mini-btn ok" onclick="vascEvalDoRealizada('${r.id}')">✅ Realizada</button>`;
  const acts=isAdmin?`<div class="ic-card-acts" onclick="event.stopPropagation()">${actBtns}<button type="button" class="ic-mini-btn danger" onclick="vascEvalDoDelete('${r.id}')">🗑 Borrar</button></div>`:'';
  return `
    <div class="ic-card prio-${r.prioridad}" onclick="vascEvalOpenDetail('${r.id}')">
      <div class="ic-card-top">
        <div class="ic-card-tipo">🩻 Evaluación vascular</div>
        ${_icStatusChip(r.estado)}
      </div>
      <div class="ic-card-body">${meta}</div>
      <div class="ic-card-foot">${_icPrioChip(r.prioridad)}${r.fecha?` · 📅 <b>${_icFmtFechaLarga(r.fecha)}</b>`:''}</div>
      ${acts}
    </div>`;
}
function vascEvalOpenDetail(id){ VASC_UI.detailId=id; VASC_UI.view='evaldetail'; renderVascModule(); }
function _vascRenderEvalDetail(){
  const r=vascLoadData().find(x=>x&&x.id===VASC_UI.detailId && x.tipo==='evaluacion');
  if(!r){ return `<div class="ic-wrap"><button type="button" class="ic-back" onclick="vascEvalBackToList()">‹ Volver</button><div class="ic-empty"><span>❓</span>Solicitud no encontrada.</div></div>`; }
  const isAdmin=!!VASC_UI.evalAdmin;
  const row=(k,v)=> v ? `<div class="ic-d-row"><div class="ic-d-lbl">${k}</div><div class="ic-d-val">${_vascEsc(String(v))}</div></div>` : '';
  const created=r.createdAt?new Date(r.createdAt).toLocaleString('es-CL',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}):'';
  const realAt=r.realizadaAt?new Date(r.realizadaAt).toLocaleString('es-CL',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}):'';
  let actBtns;
  if(r.estado==='realizada') actBtns=`<button type="button" class="ic-btn-sec" onclick="vascEvalDoReabrir('${r.id}')">↩ Reabrir</button>`;
  else if(r.estado==='aceptada') actBtns=`<button type="button" class="ic-btn-pri" onclick="vascEvalDoRealizada('${r.id}')">✅ Marcar realizada</button>`;
  else actBtns=`<button type="button" class="ic-btn-acc" onclick="vascEvalDoAceptar('${r.id}')">🔵 Aceptar</button><button type="button" class="ic-btn-pri" onclick="vascEvalDoRealizada('${r.id}')">✅ Realizada</button>`;
  const acts=isAdmin?`<div class="ic-d-actions">${actBtns}<button type="button" class="ic-btn-danger" onclick="vascEvalDoDelete('${r.id}')">🗑 Borrar</button></div>`:'';
  return `
    <div class="ic-wrap">
      <button type="button" class="ic-back" onclick="vascEvalBackToList()">‹ Volver</button>
      <div class="ic-d-head"><div class="ic-d-tipo">🩻 Evaluación de acceso vascular</div>${_icStatusChip(r.estado)}</div>
      <div class="ic-d-card">
        ${row('Prioridad', _icPrioMeta(r.prioridad).label)}
        ${row('Día preferido', _icFmtFechaLarga(r.fecha))}
        ${row('Iniciales', r.iniciales)}
        ${row('Edad', r.edad?String(r.edad)+' años':'')}
        ${row('Pieza / Ubicación', r.pieza)}
        ${row('Unidad', r.unidad)}
        ${row('Solicitante', (r.solicitanteRol==='medico'?'Dr(a). ':'Enf. ')+(r.solicitante||''))}
        ${row('Accesos a evaluar', r.accesos)}
        ${row('Motivo / contexto', r.motivo)}
        ${row('Comorbilidades', r.comorbilidades)}
        ${row('Coagulación', r.coagulacion)}
        ${row('Enviada', created)}
        ${(r.aceptadaAt&&r.estado!=='realizada')?row('Aceptada', (r.aceptadaBy||'')):''}
        ${r.estado==='realizada'?row('Realizada', realAt+(r.realizadaBy?(' · '+r.realizadaBy):'')):''}
        ${r.estado==='realizada'?row('Nota', r.notaRealizada):''}
      </div>
      ${acts}
    </div>`;
}
function vascEvalBackToList(){ VASC_UI.view='eval'; renderVascModule(); }
async function vascEvalEnterAdmin(){
  if(state && typeof ADMIN_USER_ID!=='undefined' && state.currentUserId===ADMIN_USER_ID){ VASC_UI.evalAdmin=true; renderVascModule(); return; }
  if(typeof adminSetupNeeded==='function' && adminSetupNeeded()){ try{ await _syncAdminPinFromCloud(); }catch(e){} }
  if(typeof adminSetupNeeded==='function' && adminSetupNeeded()){ alert('Aún no hay PIN de Administrador. Créalo en la pantalla principal → Staff → Administrador.'); return; }
  let ok=false; try{ ok=await promptVerifyAdminPin(); }catch(e){ ok=false; }
  if(!ok) return;
  VASC_UI.evalAdmin=true; renderVascModule();
}
function _vascEvalReqGuard(){ if(!VASC_UI.evalAdmin){ alert('Entra como "Administrador" para gestionar las evaluaciones.'); return false; } return true; }
async function vascEvalDoAceptar(id){ if(!_vascEvalReqGuard()) return; vascEvalMarkAceptada(id); renderVascModule(); try{ await _vascSyncVerified(id, r=>!!r && (r.estado==='aceptada'||r.estado==='realizada')); }catch(e){} }
async function vascEvalDoRealizada(id){ if(!_vascEvalReqGuard()) return; const nota=prompt('Nota / indicación (opcional):',''); if(nota===null) return; vascEvalMarkRealizada(id,(nota||'').trim()); renderVascModule(); try{ await _vascSyncVerified(id, r=>!!r && r.estado==='realizada'); }catch(e){} }
async function vascEvalDoReabrir(id){ if(!_vascEvalReqGuard()) return; vascEvalReabrir(id); renderVascModule(); try{ await _vascSyncVerified(id, r=>!!r && r.estado==='pendiente'); }catch(e){} }
async function vascEvalDoDelete(id){ if(!_vascEvalReqGuard()) return; if(!confirm('¿Borrar esta solicitud de evaluación? No se puede deshacer.')) return; vascEvalDelete(id); VASC_UI.view='eval'; renderVascModule(); try{ await _vascSyncVerified(id, r=>!r||r.deleted===true); }catch(e){} }

function vascEvalGoForm(){ VASC_UI.view='evalform'; renderVascModule(); setTimeout(()=>{ const e=document.getElementById('veIniciales'); if(e) e.focus(); },60); }
function _vascRenderEvalForm(){
  const prioOpts=IC_PRIOS.map(p=>`<option value="${p.v}">${p.label}</option>`).join('');
  return `
    <div class="ic-wrap">
      <button type="button" class="ic-back" onclick="vascEvalBackToList()">‹ Volver</button>
      <div class="ic-intro">Solicita una <b>evaluación de acceso vascular</b>. Datos del paciente anonimizados (solo iniciales).</div>
      <form class="ic-form" onsubmit="vascSubmitEval(event)">
        <div class="ic-fsec">Paciente (anonimizado)</div>
        <div class="ic-frow">
          <label class="ic-field"><span>Iniciales *</span><input id="veIniciales" type="text" maxlength="8" placeholder="Ej: J.P.R." autocomplete="off" required></label>
          <label class="ic-field sm"><span>Edad</span><input id="veEdad" type="text" inputmode="numeric" maxlength="3" placeholder="años"></label>
        </div>
        <div class="ic-frow">
          <label class="ic-field"><span>Pieza / Ubicación *</span><input id="vePieza" type="text" placeholder="Ej: MQ 303, UPC 478" required></label>
          <label class="ic-field"><span>Unidad</span><input id="veUnidad" type="text" placeholder="Ej: Medicina, UPC"></label>
        </div>
        <div class="ic-fsec">Solicitud</div>
        <div class="ic-frow">
          <label class="ic-field"><span>Solicitante *</span><input id="veSolic" type="text" placeholder="Nombre" required></label>
          <label class="ic-field sm"><span>Rol</span><select id="veRol"><option value="enfermera">Enf. accesos</option><option value="medico">Anestesiólogo/Médico</option></select></label>
        </div>
        <label class="ic-field"><span>Accesos a evaluar *</span><input id="veAccesos" type="text" placeholder="Ej: evaluar para PICC vs CVC; VVP difícil…" required></label>
        <div class="ic-frow">
          <label class="ic-field"><span>Día preferido</span><input id="veFecha" type="date"></label>
          <label class="ic-field sm"><span>Prioridad</span><select id="vePrio">${prioOpts}</select></label>
        </div>
        <label class="ic-field"><span>Motivo / contexto clínico</span><textarea id="veMotivo" rows="2" placeholder="¿Por qué se necesita el acceso? Terapias, duración prevista…"></textarea></label>
        <label class="ic-field"><span>Comorbilidades</span><textarea id="veComorb" rows="2" placeholder="Ej: ERC, obesidad, trombosis previas…"></textarea></label>
        <label class="ic-field"><span>Coagulación / plaquetas</span><input id="veCoag" type="text" placeholder="Ej: plaquetas 120k, TACO suspendido 48h"></label>
        <div class="ic-form-actions">
          <button type="button" class="ic-btn-sec" onclick="vascEvalBackToList()">Cancelar</button>
          <button type="submit" id="veSubmit" class="ic-btn-pri">Enviar solicitud</button>
        </div>
      </form>
    </div>`;
}
async function vascSubmitEval(ev){
  if(ev&&ev.preventDefault) ev.preventDefault();
  const g=id=>document.getElementById(id);
  const iniciales=(g('veIniciales').value||'').trim();
  const pieza=(g('vePieza').value||'').trim();
  const solic=(g('veSolic').value||'').trim();
  const accesos=(g('veAccesos').value||'').trim();
  if(!iniciales){ alert('Ingresa las iniciales del paciente.'); return; }
  if(!pieza){ alert('Ingresa la pieza / ubicación.'); return; }
  if(!solic){ alert('Ingresa el nombre del solicitante.'); return; }
  if(!accesos){ alert('Indica qué accesos hay que evaluar.'); return; }
  const req=vascCreateEval({ fecha:(g('veFecha').value||'').trim(), iniciales, edad:(g('veEdad').value||'').trim(), pieza, unidad:(g('veUnidad').value||'').trim(), solicitante:solic, solicitanteRol:g('veRol').value, accesos, motivo:(g('veMotivo').value||'').trim(), comorbilidades:(g('veComorb').value||'').trim(), coagulacion:(g('veCoag').value||'').trim(), prioridad:g('vePrio').value });
  const base=getBackendURL();
  const btn=g('veSubmit'); if(btn){ btn.disabled=true; btn.textContent='Enviando…'; }
  if(!base){
    alert('Solicitud guardada en este dispositivo (sin nube configurada). Se abrirá el correo.');
    try{ _vascEvalMailto(req); }catch(e){}
    VASC_UI.view='eval'; renderVascModule(); return;
  }
  let ok=false; try{ ok=await _vascSyncVerified(req.id, r=>!!r && !r.deleted); }catch(e){ ok=false; }
  if(ok){ try{ notifyAdminsPush('evalvasc', req.id); }catch(e){} }
  alert(ok
    ? '✅ Solicitud de evaluación enviada y registrada. Se notificará al equipo y se abrirá el correo.'
    : '⚠️ Quedó guardada en este dispositivo; no se pudo registrar en la nube (se reintentará). Igual se abrirá el correo.');
  // Correo inmediato (mailto) a los destinatarios del agendamiento — al final,
  // por si abre la app de correo (no interrumpe el guardado ni el push).
  try{ _vascEvalMailto(req); }catch(e){}
  VASC_UI.view='eval'; renderVascModule();
}
// Deep-link: abrir una evaluación vascular específica.
function vascOpenEvalById(id){
  ['modulesScreen','solChooser','portalChooser','guiasScreen','icScreen','agendScreen'].forEach(x=>{ const e=document.getElementById(x); if(e) e.classList.add('hidden'); });
  const s=document.getElementById('vascScreen'); if(s) s.classList.remove('hidden');
  VASC_UI.evalAdmin=false; VASC_UI.view='eval'; renderVascModule();
  const show=()=>{ const scr=document.getElementById('vascScreen'); if(!scr||scr.classList.contains('hidden')) return; const r=vascLoadData().find(x=>x&&x.id===id && x.tipo==='evaluacion' && !x.deleted); if(r){ VASC_UI.detailId=id; VASC_UI.view='evaldetail'; } else { VASC_UI.view='eval'; } renderVascModule(); };
  try{ vascSyncNow().then(show).catch(show); }catch(e){ show(); }
}

async function boot(){
  // 0) Deep-link desde una notificación: si la app arranca con ?ic=/?agend= se
  //    guarda para aplicarlo al entrar a la institución. Y si ya está abierta,
  //    el service worker nos avisa por mensaje para abrir el detalle exacto.
  try{ _appxHandleDeepLink(location.search || ''); }catch(e){}
  try{
    if('serviceWorker' in navigator){
      navigator.serviceWorker.addEventListener('message', ev=>{
        const d = ev && ev.data;
        if(d && d.type === 'appx-open' && d.url){ try{ _appxHandleDeepLink(d.url); }catch(e){} }
      });
    }
  }catch(e){}

  // 1) Cargar el índice de instituciones (cacheado por SW)
  const idx = await loadInstitutionsIndex();
  const institutions = idx.institutions||[];
  INSTITUTIONS_CACHE = institutions; // cache para showInstitutionPicker()

  // 2) Arranque en frío: SIEMPRE mostrar el selector de institución.
  //    Decisión de producto: con la app abierta a mucha gente, cada vez que se
  //    abre (carga en frío) debe partir en "Selecciona tu institución".
  //    Si el usuario mantiene la pestaña/app abierta, conserva su lugar en
  //    memoria (no se ejecuta boot()); solo al cerrar y reabrir vuelve aquí.
  //    La institución y los datos siguen guardados por institución, así que al
  //    tocarla se restaura todo (ver selectInstitution()).
  renderInstitutionPicker(institutions);
  document.getElementById('institutionPicker').classList.remove('hidden');
}


// ============================================================
// MÓDULO: PABELLÓN DE URGENCIA (bloques postergables)
// ============================================================
// La clínica no dispone de pabellón físico de urgencia. Cada día hábil se
// designa 1 bloque TITULAR y 1 RESPALDO por jornada (AM/PM): ante una urgencia
// quirúrgica se posterga el titular; si cumple criterios de exclusión, el
// respaldo. La rotación jul–dic 2026 se generó proporcionalmente a las horas
// de bloque semanales de cada equipo (titular=1 punto, respaldo=0.5), con
// dispersión semanal/diaria. Fuente: planilla de bloques quirúrgicos (8
// pabellones), julio 2026. Es información de planificación: la calificación
// final de postergabilidad la hace coordinación de pabellón + Anestesiología.

const PU_EQUIPOS=["NEUROCIRUGIA", "RODILLA (MATAS-CARRASCO-AMENABAR-HUN-VALENZUELA)", "CIRUGIA ROBOTICA", "EQUIPO DE MANO", "TOBILLO Y PIE", "EQUIPO DE HOMBRO", "COLOPROCTO (LOPEZ-WAINSTEIN)", "EQUIPO DE CADERA", "RODILLA (RADICE-ORIZOLA-FERRER)", "OTORRINO (KRAUSE)", "COLUMNA (LARRONDO-BEAULIEU)", "CABEZA Y CUELLO (DROPPELMANN)", "COLUMNA (POSTIGO-PANTOJA)", "CIR. PLASTICA (HASBUN)", "EQUIPO UROLOGIA", "COLOPROCTO (BARRERA-QUEZADA-ZUÑIGA)", "TRAUMATOLOGIA INFANTIL", "EQUIPO HOMBRO (EKDAHL)", "CIR. GENERAL (ESCALONA-LANZARINI)", "CIR. PLASTICA (SALISBURY)", "COLUMNA (GARRIDO)", "GINECOLOGIA", "OTORRINO (OIDO)", "OTORRINO (LANAS)", "COLUMNA (POSTIGO)", "CIR. PLASTICA (DAGNINO)", "CIR. DIGESTIVA (ESPINOZA-DEVAUD)", "OTORRINO (PACHECO)", "CIRUGIA INFANTIL", "OTORRINO (TAPIA)", "OTORRINO (CABEZON)", "OTORRINO (TOCORNAL)", "CIR. GENERAL (LEON)", "CIRUGIA INFANTIL (PINILLA)", "OTORRINO (GARCIA)", "OTORRINO (BELTRAN)", "OTORRINO (REBOLLEDO)", "CABEZA Y CUELLO (GAC)"];
const PU_NOTAS=["comparte pabellón con Otorrino Tocornal", "continúa de AM", "comparte pabellón con Robótica", "opera c/14 días", "comparte pabellón con Hombro Ekdahl"];
const PU_FERIADOS={"2026-07-16": "Virgen del Carmen", "2026-09-18": "Independencia Nacional", "2026-10-12": "Encuentro de Dos Mundos", "2026-12-08": "Inmaculada Concepción", "2026-12-25": "Navidad"};
const PU_ROT=[
["2026-07-06", 0, 0, 3, -1, 1, 4, -1],
["2026-07-06", 1, 2, 5, 0, 3, 4, -1],
["2026-07-07", 0, 4, 5, -1, 5, 2, -1],
["2026-07-07", 1, 6, 3, 1, 7, 4, 1],
["2026-07-08", 0, 8, 4, -1, 9, 3, -1],
["2026-07-08", 1, 10, 1, -1, 11, 5, 1],
["2026-07-09", 0, 12, 1, -1, 13, 7, -1],
["2026-07-09", 1, 14, 2, -1, 15, 3, -1],
["2026-07-10", 0, 16, 2, -1, 17, 5, 2],
["2026-07-10", 1, 3, 3, -1, 8, 4, 1],
["2026-07-13", 0, 18, 5, -1, 19, 7, -1],
["2026-07-13", 1, 20, 1, -1, 21, 3, -1],
["2026-07-14", 0, 22, 1, -1, 23, 7, -1],
["2026-07-14", 1, 24, 1, -1, 5, 2, 1],
["2026-07-15", 0, 25, 7, -1, 26, 2, -1],
["2026-07-15", 1, 9, 3, 1, 11, 5, 1],
["2026-07-17", 0, 27, 1, -1, 28, 3, -1],
["2026-07-17", 1, 17, 5, -1, 8, 4, 1],
["2026-07-20", 0, 29, 1, -1, 30, 2, -1],
["2026-07-20", 1, 31, 5, 2, 19, 7, 1],
["2026-07-21", 0, 32, 8, -1, 4, 5, -1],
["2026-07-21", 1, 7, 4, 1, 1, 7, -1],
["2026-07-22", 0, 33, 8, -1, 34, 6, 3],
["2026-07-22", 1, 8, 4, 1, 9, 3, 1],
["2026-07-23", 0, 35, 8, -1, 13, 7, -1],
["2026-07-23", 1, 2, 5, 1, 4, 4, 1],
["2026-07-24", 0, 36, 8, -1, 16, 2, -1],
["2026-07-24", 1, 10, 1, -1, 3, 3, -1],
["2026-07-27", 0, 37, 8, -1, 0, 3, -1],
["2026-07-27", 1, 19, 7, 1, 21, 3, -1],
["2026-07-28", 0, 5, 2, -1, 6, 3, -1],
["2026-07-28", 1, 4, 5, 1, 1, 7, -1],
["2026-07-29", 0, 18, 1, -1, 11, 5, -1],
["2026-07-29", 1, 25, 7, 1, 9, 3, 1],
["2026-07-30", 0, 6, 3, -1, 12, 1, -1],
["2026-07-30", 1, 13, 7, 1, 15, 3, -1],
["2026-07-31", 0, 28, 3, -1, 2, 5, 4],
["2026-07-31", 1, 8, 4, 1, 16, 2, 1],
["2026-08-03", 0, 30, 2, -1, 0, 3, -1],
["2026-08-03", 1, 2, 5, 0, 3, 4, -1],
["2026-08-04", 0, 23, 7, -1, 5, 2, -1],
["2026-08-04", 1, 4, 5, 1, 7, 4, 1],
["2026-08-05", 0, 26, 2, -1, 11, 5, -1],
["2026-08-05", 1, 9, 3, 1, 8, 4, 1],
["2026-08-06", 0, 12, 1, -1, 5, 2, -1],
["2026-08-06", 1, 13, 7, 1, 14, 2, -1],
["2026-08-07", 0, 16, 2, -1, 17, 5, 2],
["2026-08-07", 1, 10, 1, -1, 8, 4, 1],
["2026-08-10", 0, 1, 4, -1, 0, 3, -1],
["2026-08-10", 1, 19, 7, 1, 20, 1, -1],
["2026-08-11", 0, 6, 3, -1, 4, 5, -1],
["2026-08-11", 1, 5, 2, 1, 7, 4, 1],
["2026-08-12", 0, 18, 1, -1, 11, 5, -1],
["2026-08-12", 1, 25, 7, 1, 9, 3, 1],
["2026-08-13", 0, 35, 8, -1, 4, 4, -1],
["2026-08-13", 1, 15, 3, -1, 2, 5, 1],
["2026-08-14", 0, 27, 1, -1, 36, 8, -1],
["2026-08-14", 1, 8, 4, 1, 3, 3, -1],
["2026-08-17", 0, 29, 1, -1, 37, 8, -1],
["2026-08-17", 1, 21, 3, -1, 2, 5, 0],
["2026-08-18", 0, 22, 1, -1, 32, 8, -1],
["2026-08-18", 1, 24, 1, -1, 6, 3, 1],
["2026-08-19", 0, 33, 8, -1, 34, 6, 3],
["2026-08-19", 1, 11, 5, 1, 9, 3, 1],
["2026-08-20", 0, 4, 4, -1, 12, 1, -1],
["2026-08-20", 1, 2, 5, 1, 13, 7, 1],
["2026-08-21", 0, 17, 5, 2, 8, 4, -1],
["2026-08-21", 1, 10, 1, -1, 16, 2, 1],
["2026-08-24", 0, 0, 3, -1, 1, 4, -1],
["2026-08-24", 1, 3, 4, -1, 19, 7, 1],
["2026-08-25", 0, 7, 4, -1, 5, 2, -1],
["2026-08-25", 1, 6, 3, 1, 4, 5, 1],
["2026-08-26", 0, 9, 3, -1, 18, 1, -1],
["2026-08-26", 1, 25, 7, 1, 8, 4, 1],
["2026-08-27", 0, 5, 2, -1, 12, 1, -1],
["2026-08-27", 1, 14, 2, -1, 4, 4, 1],
["2026-08-28", 0, 28, 3, -1, 36, 8, -1],
["2026-08-28", 1, 8, 4, 1, 16, 2, 1],
["2026-08-31", 0, 1, 4, -1, 30, 2, -1],
["2026-08-31", 1, 20, 1, -1, 19, 7, 1],
["2026-09-01", 0, 23, 7, -1, 32, 8, -1],
["2026-09-01", 1, 6, 3, 1, 4, 5, 1],
["2026-09-02", 0, 26, 2, -1, 18, 1, -1],
["2026-09-02", 1, 11, 5, 1, 9, 3, 1],
["2026-09-03", 0, 12, 1, -1, 13, 7, -1],
["2026-09-03", 1, 2, 5, 1, 4, 4, 1],
["2026-09-04", 0, 8, 4, -1, 9, 7, -1],
["2026-09-04", 1, 10, 1, -1, 16, 2, 1],
["2026-09-07", 0, 37, 8, -1, 0, 3, -1],
["2026-09-07", 1, 3, 4, -1, 19, 7, 1],
["2026-09-08", 0, 7, 4, -1, 5, 2, -1],
["2026-09-08", 1, 4, 5, 1, 6, 3, 1],
["2026-09-09", 0, 18, 1, -1, 25, 7, -1],
["2026-09-09", 1, 9, 3, 1, 8, 4, 1],
["2026-09-10", 0, 5, 2, -1, 13, 7, -1],
["2026-09-10", 1, 15, 3, -1, 2, 5, 1],
["2026-09-11", 0, 17, 5, 2, 27, 1, -1],
["2026-09-11", 1, 16, 2, 1, 8, 4, 1],
["2026-09-14", 0, 0, 3, -1, 1, 4, -1],
["2026-09-14", 1, 21, 3, -1, 31, 5, 2],
["2026-09-15", 0, 22, 1, -1, 32, 8, -1],
["2026-09-15", 1, 24, 1, -1, 6, 3, 1],
["2026-09-16", 0, 33, 8, -1, 34, 6, 3],
["2026-09-16", 1, 11, 5, 1, 25, 7, 1],
["2026-09-17", 0, 35, 8, -1, 4, 4, -1],
["2026-09-17", 1, 12, 1, 1, 13, 7, 1],
["2026-09-21", 0, 29, 1, -1, 30, 2, -1],
["2026-09-21", 1, 19, 7, 1, 2, 5, 0],
["2026-09-22", 0, 7, 4, -1, 5, 2, -1],
["2026-09-22", 1, 1, 7, -1, 6, 3, 1],
["2026-09-23", 0, 8, 4, -1, 9, 3, -1],
["2026-09-23", 1, 10, 1, -1, 25, 7, 1],
["2026-09-24", 0, 4, 4, -1, 5, 2, -1],
["2026-09-24", 1, 2, 5, 1, 13, 7, 1],
["2026-09-25", 0, 36, 8, -1, 27, 1, -1],
["2026-09-25", 1, 3, 3, -1, 17, 5, -1],
["2026-09-28", 0, 0, 3, -1, 18, 5, -1],
["2026-09-28", 1, 20, 1, -1, 19, 7, 1],
["2026-09-29", 0, 6, 3, -1, 23, 7, -1],
["2026-09-29", 1, 4, 5, 1, 5, 2, 1],
["2026-09-30", 0, 26, 2, -1, 9, 3, -1],
["2026-09-30", 1, 8, 4, 1, 11, 5, 1],
["2026-10-01", 0, 12, 1, -1, 13, 7, -1],
["2026-10-01", 1, 14, 2, -1, 2, 5, 1],
["2026-10-02", 0, 28, 3, -1, 16, 2, -1],
["2026-10-02", 1, 10, 1, -1, 3, 3, -1],
["2026-10-05", 0, 30, 2, -1, 37, 8, -1],
["2026-10-05", 1, 2, 5, 0, 19, 7, 1],
["2026-10-06", 0, 32, 8, -1, 7, 4, -1],
["2026-10-06", 1, 1, 7, -1, 5, 2, 1],
["2026-10-07", 0, 18, 1, -1, 25, 7, -1],
["2026-10-07", 1, 9, 3, 1, 8, 4, 1],
["2026-10-08", 0, 6, 3, -1, 4, 4, -1],
["2026-10-08", 1, 13, 7, 1, 15, 3, -1],
["2026-10-09", 0, 16, 2, -1, 17, 5, 2],
["2026-10-09", 1, 8, 4, 1, 3, 3, -1],
["2026-10-13", 0, 4, 5, -1, 5, 2, -1],
["2026-10-13", 1, 7, 4, 1, 24, 1, -1],
["2026-10-14", 0, 11, 5, -1, 25, 7, -1],
["2026-10-14", 1, 9, 3, 1, 8, 4, 1],
["2026-10-15", 0, 35, 8, -1, 5, 2, -1],
["2026-10-15", 1, 12, 1, 1, 2, 5, 1],
["2026-10-16", 0, 27, 1, -1, 36, 8, -1],
["2026-10-16", 1, 17, 5, -1, 8, 4, 1],
["2026-10-19", 0, 0, 3, -1, 29, 1, -1],
["2026-10-19", 1, 21, 3, -1, 31, 5, 2],
["2026-10-20", 0, 22, 1, -1, 23, 7, -1],
["2026-10-20", 1, 6, 3, 1, 4, 5, 1],
["2026-10-21", 0, 33, 8, -1, 34, 6, 3],
["2026-10-21", 1, 25, 7, 1, 9, 3, 1],
["2026-10-22", 0, 5, 2, -1, 4, 4, -1],
["2026-10-22", 1, 2, 5, 1, 13, 7, 1],
["2026-10-23", 0, 16, 2, -1, 28, 3, -1],
["2026-10-23", 1, 10, 1, -1, 3, 3, -1],
["2026-10-26", 0, 37, 8, -1, 1, 4, -1],
["2026-10-26", 1, 19, 7, 1, 20, 1, -1],
["2026-10-27", 0, 4, 5, -1, 6, 3, -1],
["2026-10-27", 1, 7, 4, 1, 1, 7, -1],
["2026-10-28", 0, 18, 1, -1, 11, 5, -1],
["2026-10-28", 1, 8, 4, 1, 9, 3, 1],
["2026-10-29", 0, 5, 2, -1, 6, 3, -1],
["2026-10-29", 1, 14, 2, -1, 15, 3, -1],
["2026-10-30", 0, 36, 8, -1, 2, 5, 4],
["2026-10-30", 1, 3, 3, -1, 10, 1, -1],
["2026-11-02", 0, 0, 3, -1, 29, 1, -1],
["2026-11-02", 1, 19, 7, 1, 2, 5, 0],
["2026-11-03", 0, 23, 7, -1, 32, 8, -1],
["2026-11-03", 1, 24, 1, -1, 4, 5, 1],
["2026-11-04", 0, 26, 2, -1, 18, 1, -1],
["2026-11-04", 1, 11, 5, 1, 25, 7, 1],
["2026-11-05", 0, 12, 1, -1, 13, 7, -1],
["2026-11-05", 1, 4, 4, 1, 15, 3, -1],
["2026-11-06", 0, 9, 7, -1, 8, 4, -1],
["2026-11-06", 1, 16, 2, 1, 17, 5, -1],
["2026-11-09", 0, 30, 2, -1, 1, 4, -1],
["2026-11-09", 1, 20, 1, -1, 21, 3, -1],
["2026-11-10", 0, 6, 3, -1, 5, 2, -1],
["2026-11-10", 1, 7, 4, 1, 1, 7, -1],
["2026-11-11", 0, 8, 4, -1, 18, 1, -1],
["2026-11-11", 1, 25, 7, 1, 9, 3, 1],
["2026-11-12", 0, 13, 7, -1, 35, 8, -1],
["2026-11-12", 1, 4, 4, 1, 2, 5, 1],
["2026-11-13", 0, 27, 1, -1, 28, 3, -1],
["2026-11-13", 1, 10, 1, -1, 3, 3, -1],
["2026-11-16", 0, 0, 3, -1, 29, 1, -1],
["2026-11-16", 1, 31, 5, 2, 19, 7, 1],
["2026-11-17", 0, 22, 1, -1, 32, 8, -1],
["2026-11-17", 1, 5, 2, 1, 6, 3, 1],
["2026-11-18", 0, 33, 8, -1, 34, 6, 3],
["2026-11-18", 1, 8, 4, 1, 11, 5, 1],
["2026-11-19", 0, 12, 1, -1, 6, 3, -1],
["2026-11-19", 1, 2, 5, 1, 4, 4, 1],
["2026-11-20", 0, 9, 7, -1, 17, 5, 2],
["2026-11-20", 1, 16, 2, 1, 3, 3, -1],
["2026-11-23", 0, 37, 8, -1, 1, 4, -1],
["2026-11-23", 1, 19, 7, 1, 21, 3, -1],
["2026-11-24", 0, 4, 5, -1, 5, 2, -1],
["2026-11-24", 1, 6, 3, 1, 7, 4, 1],
["2026-11-25", 0, 18, 1, -1, 8, 4, -1],
["2026-11-25", 1, 11, 5, 1, 25, 7, 1],
["2026-11-26", 0, 13, 7, -1, 35, 8, -1],
["2026-11-26", 1, 14, 2, -1, 15, 3, -1],
["2026-11-27", 0, 28, 3, -1, 36, 8, -1],
["2026-11-27", 1, 8, 4, 1, 17, 5, -1],
["2026-11-30", 0, 0, 3, -1, 1, 4, -1],
["2026-11-30", 1, 2, 5, 0, 3, 4, -1],
["2026-12-01", 0, 23, 7, -1, 32, 8, -1],
["2026-12-01", 1, 24, 1, -1, 5, 2, 1],
["2026-12-02", 0, 26, 2, -1, 9, 3, -1],
["2026-12-02", 1, 10, 1, -1, 25, 7, 1],
["2026-12-03", 0, 4, 4, -1, 12, 1, -1],
["2026-12-03", 1, 13, 7, 1, 15, 3, -1],
["2026-12-04", 0, 9, 7, -1, 8, 4, -1],
["2026-12-04", 1, 16, 2, 1, 3, 3, -1],
["2026-12-07", 0, 29, 1, -1, 30, 2, -1],
["2026-12-07", 1, 2, 5, 0, 19, 7, 1],
["2026-12-09", 0, 18, 1, -1, 8, 4, -1],
["2026-12-09", 1, 11, 5, 1, 25, 7, 1],
["2026-12-10", 0, 5, 2, -1, 6, 3, -1],
["2026-12-10", 1, 4, 4, 1, 12, 1, 1],
["2026-12-11", 0, 17, 5, 2, 27, 1, -1],
["2026-12-11", 1, 8, 4, 1, 10, 1, -1],
["2026-12-14", 0, 1, 4, -1, 0, 3, -1],
["2026-12-14", 1, 20, 1, -1, 21, 3, -1],
["2026-12-15", 0, 7, 4, -1, 6, 3, -1],
["2026-12-15", 1, 5, 2, 1, 4, 5, 1],
["2026-12-16", 0, 33, 8, -1, 34, 6, 3],
["2026-12-16", 1, 9, 3, 1, 25, 7, 1],
["2026-12-17", 0, 35, 8, -1, 6, 3, -1],
["2026-12-17", 1, 12, 1, 1, 2, 5, 1],
["2026-12-18", 0, 36, 8, -1, 8, 4, -1],
["2026-12-18", 1, 3, 3, -1, 10, 1, -1],
["2026-12-21", 0, 30, 2, -1, 37, 8, -1],
["2026-12-21", 1, 19, 7, 1, 2, 5, 0],
["2026-12-22", 0, 22, 1, -1, 32, 8, -1],
["2026-12-22", 1, 7, 4, 1, 1, 7, -1],
["2026-12-23", 0, 18, 1, -1, 8, 4, -1],
["2026-12-23", 1, 9, 3, 1, 11, 5, 1],
["2026-12-24", 0, 6, 3, -1, 4, 4, -1],
["2026-12-24", 1, 13, 7, 1, 14, 2, -1],
["2026-12-28", 0, 0, 3, -1, 1, 4, -1],
["2026-12-28", 1, 21, 3, -1, 2, 5, 0],
["2026-12-29", 0, 4, 5, -1, 5, 2, -1],
["2026-12-29", 1, 24, 1, -1, 6, 3, 1],
["2026-12-30", 0, 25, 7, -1, 26, 2, -1],
["2026-12-30", 1, 8, 4, 1, 10, 1, -1],
["2026-12-31", 0, 5, 2, -1, 12, 1, -1],
["2026-12-31", 1, 15, 3, -1, 2, 5, 1]
];

const PU_MES_NOM = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const PU_DIA_NOM = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
const PU_MIN_MES = '2026-07', PU_MAX_MES = '2026-12';
const PU_CRITERIOS = [
  'Paciente oncológico con plazo biológico de resolución.',
  'Lactante menor de 1 año.',
  'Paciente previamente suspendido o postergado (no se posterga dos veces).',
  'Trasplante, procuramiento de órganos o injerto/insumo crítico ya activado.',
  'Condición clínica que no admite reprogramación (riesgo de progresión, dolor intratable, urgencia diferida).',
  'Paciente hospitalizado con espera quirúrgica prolongada.'
];
const PU_UI = { ym:'', openWeek:-1 };

// Índice fecha -> {AM:{...}, PM:{...}} (se construye una sola vez)
let _PU_IDX = null;
function _puIndex(){
  if(_PU_IDX) return _PU_IDX;
  _PU_IDX = {};
  PU_ROT.forEach(r=>{
    const [f,j,ti,tp,tn,ri,rp,rn] = r;
    if(!_PU_IDX[f]) _PU_IDX[f] = {};
    _PU_IDX[f][j===0?'AM':'PM'] = {
      tEq:PU_EQUIPOS[ti], tPab:tp, tNota:tn>=0?PU_NOTAS[tn]:'',
      rEq:PU_EQUIPOS[ri], rPab:rp, rNota:rn>=0?PU_NOTAS[rn]:''
    };
  });
  return _PU_IDX;
}
function _puTodayStr(){
  const t = new Date();
  return t.getFullYear()+'-'+String(t.getMonth()+1).padStart(2,'0')+'-'+String(t.getDate()).padStart(2,'0');
}
function _puClampYm(ym){ return ym < PU_MIN_MES ? PU_MIN_MES : (ym > PU_MAX_MES ? PU_MAX_MES : ym); }

function openPabUrgModule(){
  const mod = document.getElementById('modulesScreen'); if(mod) mod.classList.add('hidden');
  const sc  = document.getElementById('solChooser');    if(sc)  sc.classList.add('hidden');
  const pc  = document.getElementById('portalChooser'); if(pc)  pc.classList.add('hidden');
  const s   = document.getElementById('pabUrgScreen');  if(s)   s.classList.remove('hidden');
  PU_UI.ym = _puClampYm(_puTodayStr().slice(0,7));
  PU_UI.openWeek = -1;   // -1 = auto: se abre la semana de hoy (o la primera)
  renderPabUrg();
  try{ window.scrollTo(0,0); }catch(e){}
}
function pabUrgBack(){
  const s = document.getElementById('pabUrgScreen'); if(s) s.classList.add('hidden');
  showModulesScreen();
}
function pabUrgNav(delta){
  const [y,m] = PU_UI.ym.split('-').map(Number);
  const d = new Date(y, m-1+delta, 1);
  PU_UI.ym = _puClampYm(d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'));
  PU_UI.openWeek = -1;
  renderPabUrg();
}
// Acordeón: abre/cierra una semana (solo una abierta a la vez)
function puToggleWeek(i){
  PU_UI.openWeek = (PU_UI.openWeek === i) ? -2 : i;   // -2 = todas cerradas
  renderPabUrg();
  try{
    const el = document.getElementById('puWeek'+i);
    if(el && PU_UI.openWeek === i) el.scrollIntoView({behavior:'smooth', block:'nearest'});
  }catch(e){}
}

function renderPabUrg(){
  const body = document.getElementById('pabUrgBody');
  if(!body) return;
  const idx = _puIndex();
  const [y,m] = PU_UI.ym.split('-').map(Number);
  const hoy = _puTodayStr();
  // Agrupar los días hábiles del mes por semana (lunes como inicio)
  const weeks = [];
  let cur = null;
  const last = new Date(y, m, 0).getDate();
  for(let d=1; d<=last; d++){
    const dt = new Date(y, m-1, d);
    const wd = dt.getDay();
    if(wd===0 || wd===6) continue;
    const ds = PU_UI.ym+'-'+String(d).padStart(2,'0');
    if(wd===1 || !cur){ cur = {days:[]}; weeks.push(cur); }
    cur.days.push({ds, wd, d});
  }
  const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;');
  const cell = (tag, cls, eq, pab, nota) =>
    '<div class="pu-cell"><div class="pu-tag'+cls+'">'+tag+'</div>'+
    '<div class="pu-eq">'+esc(eq)+'</div>'+
    '<div class="pu-meta">Pabellón '+pab+(nota?' · '+esc(nota):'')+'</div></div>';
  let h = '';
  h += '<div class="pu-monthbar">'+
       '<button type="button" class="pu-navbtn" onclick="pabUrgNav(-1)"'+(PU_UI.ym<=PU_MIN_MES?' disabled':'')+'>‹</button>'+
       '<h2>'+PU_MES_NOM[m-1]+' '+y+'</h2>'+
       '<button type="button" class="pu-navbtn" onclick="pabUrgNav(1)"'+(PU_UI.ym>=PU_MAX_MES?' disabled':'')+'>›</button></div>';
  h += '<div class="pu-intro"><b>¿Cómo funciona?</b> Cada día hábil hay un bloque <b>titular</b> y un <b>respaldo</b> por jornada. '+
       'Ante una urgencia quirúrgica que requiera pabellón, se posterga el bloque titular de esa jornada; si ese día cumple '+
       'algún criterio de exclusión, se posterga el respaldo. Los equipos con más horas de pabellón son designados más veces '+
       '(rotación <b>equitativa y proporcional</b>). Revisa tu semana antes de agendar cirugías complejas.</div>';
  // Fecha de referencia: hoy; si es fin de semana, el lunes siguiente (así el
  // domingo ya se destaca y abre la semana entrante).
  const refD = new Date(hoy+'T12:00:00');
  while(refD.getDay()===0 || refD.getDay()===6) refD.setDate(refD.getDate()+1);
  const ref = refD.getFullYear()+'-'+String(refD.getMonth()+1).padStart(2,'0')+'-'+String(refD.getDate()).padStart(2,'0');
  // Semana abierta: la que contiene la fecha de referencia (si es este mes), si no la primera.
  if(PU_UI.openWeek === -1 || PU_UI.openWeek === undefined){
    let auto = 0;
    weeks.forEach((w,i)=>{ if(w.days.some(d => d.ds === ref)) auto = i; });
    PU_UI.openWeek = auto;
  }
  weeks.forEach((w,i)=>{
    const d0 = w.days[0], d1 = w.days[w.days.length-1];
    const open = PU_UI.openWeek === i;
    const nFer = w.days.filter(d => PU_FERIADOS[d.ds]).length;
    const esHoy = w.days.some(d => d.ds === ref);
    h += '<div class="pu-week'+(open?' open':'')+'" id="puWeek'+i+'">';
    h += '<button type="button" class="pu-week-hd" onclick="puToggleWeek('+i+')">'+
         '<span class="t">Semana del '+d0.d+' al '+d1.d+'</span>'+
         (esHoy?'<span class="pu-today-tag">ESTA SEMANA</span>':'')+
         (nFer?'<span class="n">'+nFer+' feriado'+(nFer>1?'s':'')+'</span>':'')+
         '<span class="chev">›</span></button>';
    h += '<div class="pu-week-body">';
    w.days.forEach(day=>{
      const fer = PU_FERIADOS[day.ds];
      const e = idx[day.ds];
      const isToday = day.ds === hoy;
      h += '<div class="pu-day'+(isToday?' pu-today':'')+'"><div class="pu-day-head">'+
           '<span class="pu-day-name">'+PU_DIA_NOM[day.wd]+' '+day.d+'</span>'+
           (isToday?'<span class="pu-today-tag">HOY</span>':'')+'</div>';
      if(fer){
        h += '<div class="pu-fer">🎌 Feriado — '+esc(fer)+' · sin designación</div>';
      } else if(e){
        ['AM','PM'].forEach(j=>{
          const x = e[j]; if(!x) return;
          h += '<div class="pu-row"><div class="pu-j'+(j==='PM'?' pm':'')+'">'+j+'</div><div class="pu-cells">'+
               cell('Postergable (titular)','',x.tEq,x.tPab,x.tNota)+
               cell('Respaldo (2ª opción)',' resp',x.rEq,x.rPab,x.rNota)+
               '</div></div>';
        });
      } else {
        h += '<div class="pu-meta">Sin designación registrada.</div>';
      }
      h += '</div>';
    });
    h += '</div></div>';
  });
  h += '<div class="pu-crit"><h3>Criterios de exclusión (el bloque titular NO se posterga si aplica alguno)</h3><ol>';
  PU_CRITERIOS.forEach(c=>{ h += '<li>'+c+'</li>'; });
  h += '</ol><div class="pu-meta" style="margin-top:8px">Si el titular no es postergable, se posterga el bloque respaldo. '+
       'La calificación final la realiza la coordinación de pabellón junto a Anestesiología el día correspondiente.</div></div>';
  h += '<div class="pu-dl"><button type="button" class="btn-primary" onclick="pabUrgDownload()">⬇ Descargar rotación anual completa (Excel/CSV)</button></div>';
  h += '<div class="pu-meta" style="margin:6px 2px 20px">Rotación vigente: 6 de julio – 31 de diciembre de 2026 · 248 jornadas designadas · proporcional a horas de bloque semanales. Generada julio 2026.</div>';
  body.innerHTML = h;
}

// Descarga la rotación anual completa como CSV (compatible con Excel es-CL).
function pabUrgDownload(){
  const idx = _puIndex();
  const fechas = Object.keys(idx).concat(Object.keys(PU_FERIADOS));
  const uniq = Array.from(new Set(fechas)).sort();
  const rows = [['Fecha','Día','Jornada','Bloque Titular (postergable)','Pabellón','Nota','Bloque Respaldo (2ª opción)','Pabellón','Nota']];
  uniq.forEach(f=>{
    const dt = new Date(f+'T12:00:00');
    const dia = PU_DIA_NOM[dt.getDay()];
    if(PU_FERIADOS[f]){
      rows.push([f, dia, 'FERIADO — '+PU_FERIADOS[f], '', '', '', '', '', '']);
      return;
    }
    ['AM','PM'].forEach(j=>{
      const x = idx[f] && idx[f][j]; if(!x) return;
      rows.push([f, dia, j, x.tEq, x.tPab, x.tNota, x.rEq, x.rPab, x.rNota]);
    });
  });
  const csv = '﻿' + rows.map(r => r.map(v => '"'+String(v).replace(/"/g,'""')+'"').join(';')).join('\r\n');
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'Rotacion_Pabellon_Urgencia_2026.csv';
  document.body.appendChild(a); a.click();
  setTimeout(()=>{ try{ URL.revokeObjectURL(a.href); a.remove(); }catch(e){} }, 800);
}

// ---- Contexto para ARIA: designaciones del Pabellón de Urgencia ----
// Se activa cuando la pregunta (ya normalizada por _gpNorm) menciona
// postergación/pabellón de urgencia. Devuelve UN solo string multilínea
// (cuenta como 1 match en _aiBuildContext, que corta en 25).
function _aiPabUrgContext(qnorm){
  const q = String(qnorm||'');
  // Disparadores AMPLIOS (jul 2026): antes solo reaccionaba a frases muy
  // exactas ("pabellon de urgencia", "bloque postergable"). Ahora también a
  // pabellón+urgencia en cualquier orden/plural ("pabellón de urgencias",
  // "pabellón urgencia"), titular/respaldo, rotación y "urgencia quirúrgica".
  const trigger = /posterga/.test(q)                                  // posterga, postergable(s), postergación
    || /respaldo|titular/.test(q)
    || (/pabellon/.test(q) && /urgencia/.test(q))
    || /rotacion (de )?(urgencia|pabellon|bloque)/.test(q)
    || /urgencia quirurgica/.test(q)
    || /bloque?s? postergable/.test(q);
  if(!trigger) return '';
  const idx = _puIndex();
  const hoyD = new Date(); hoyD.setHours(12,0,0,0);
  const fmt = d => d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  const MESN = PU_MES_NOM;
  // Fechas a incluir: hoy + próximos 14 días corridos (cubre "hoy", "mañana",
  // "esta semana" y "la próxima semana")
  const fechas = [];
  for(let i=0;i<=14;i++){
    const d = new Date(hoyD); d.setDate(d.getDate()+i); fechas.push(fmt(d));
  }
  // Fecha explícita: "14 de julio" / "3 de diciembre"
  const mExp = q.match(/(\d{1,2}) de (julio|agosto|septiembre|octubre|noviembre|diciembre)/);
  if(mExp){
    const mi = MESN.indexOf(mExp[2]);
    if(mi>=0) fechas.push('2026-'+String(mi+1).padStart(2,'0')+'-'+String(parseInt(mExp[1],10)).padStart(2,'0'));
  }
  const lines = [];
  lines.push('[PABELLON DE URGENCIA — rotación de bloques postergables, Clínica Universidad de los Andes, vigente 6-jul a 31-dic-2026] '+
    'La clínica no tiene pabellón físico de urgencia. Cada día hábil hay un bloque quirúrgico TITULAR (postergable) y un RESPALDO (2ª opción) por jornada (AM y PM). '+
    'Ante una urgencia quirúrgica se posterga el TITULAR de esa jornada; si el titular cumple un criterio de exclusión ese día, se posterga el RESPALDO. '+
    'Rotación proporcional a las horas de bloque semanales de cada equipo. La calificación final la hace coordinación de pabellón + Anestesiología. '+
    'Criterios de exclusión del titular: '+PU_CRITERIOS.join(' ')+
    ' HOY es '+PU_DIA_NOM[hoyD.getDay()]+' '+hoyD.getDate()+' de '+MESN[hoyD.getMonth()]+' de '+hoyD.getFullYear()+'.');
  const seen = {};
  fechas.forEach(f=>{
    if(seen[f]) return; seen[f]=1;
    const d = new Date(f+'T12:00:00');
    const et = PU_DIA_NOM[d.getDay()]+' '+d.getDate()+' de '+MESN[d.getMonth()];
    if(d.getDay()===0 || d.getDay()===6){ lines.push(et+': fin de semana — sin designación (la rotación cubre solo días hábiles).'); return; }
    if(PU_FERIADOS[f]){ lines.push(et+': FERIADO ('+PU_FERIADOS[f]+') — sin designación.'); return; }
    const e = idx[f];
    if(!e){
      if(f < '2026-07-06' || f > '2026-12-31') lines.push(et+': fuera de la vigencia de la rotación (6-jul a 31-dic-2026).');
      return;
    }
    const j = x => x ? x.tEq+' (Pabellón '+x.tPab+(x.tNota?', '+x.tNota:'')+') / respaldo: '+x.rEq+' (Pabellón '+x.rPab+')' : '—';
    lines.push(et+': AM titular: '+j(e.AM)+' · PM titular: '+j(e.PM));
  });
  return lines.join('\n');
}

// ============================================================
// SUB-SELECTOR: Interconsultas / Agendamiento (botón combinado)
// ============================================================
function openSolicitudesChooser(){
  const mod = document.getElementById('modulesScreen'); if(mod) mod.classList.add('hidden');
  const sc  = document.getElementById('solChooser');    if(sc)  sc.classList.remove('hidden');
  try{ updateIcBadges(); }catch(e){}
}
function closeSolicitudesChooser(goHome){
  const sc = document.getElementById('solChooser'); if(sc) sc.classList.add('hidden');
  if(goHome === true){ showModulesScreen(); }
}

// ============================================================
// SUB-SELECTOR: Portal Preanestésico / Pabellón de Urgencia
// ============================================================
function openPortalChooser(){
  const mod = document.getElementById('modulesScreen'); if(mod) mod.classList.add('hidden');
  const pc  = document.getElementById('portalChooser'); if(pc)  pc.classList.remove('hidden');
}
function closePortalChooser(goHome){
  const pc = document.getElementById('portalChooser'); if(pc) pc.classList.add('hidden');
  if(goHome === true){ showModulesScreen(); }
}


// INIT — boot async (selecciona institución y carga su config)
boot();
