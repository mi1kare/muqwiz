/* MuQwiz account + offline-first cloud sync. Requires Supabase JS v2 and js/app.js. */
(() => {
  const URL = 'https://xleqzgqiwayloeeewagv.supabase.co';
  const KEY = 'sb_publishable_ptX6EsSAH92n9XFcP-v9dA_EAOIF7kG';
  const client = window.supabase?.createClient(URL, KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  if (!client) { console.warn('MuQwiz accounts: Supabase client unavailable'); return; }
  const EDGE = `${URL}/functions/v1/username-auth`;
  let userId = null, syncing = false, syncTimer = null, lastCloudJson = null;
  const $ = (id) => document.getElementById(id);
  const say = (msg) => { const el = $('mq-auth-message'); if (el) el.textContent = msg; };
  const localSnapshot = () => { try { return JSON.parse(localStorage.getItem('muqwiz_data') || '{}'); } catch { return {}; } };
  const normalize = (x) => ({ user: x.user || {name:''}, library: Array.isArray(x.library)?x.library:[], results: Array.isArray(x.results)?x.results:[], notes: x.notes && typeof x.notes==='object'?x.notes:{}, favorites:Array.isArray(x.favorites)?x.favorites:[], settings: x.settings || {theme:'light'} });
  function showPanel() {
    if ($('mq-account-panel')) return;
    const panel = document.createElement('section'); panel.id='mq-account-panel'; panel.className='card'; panel.style.cssText='margin:12px 0;padding:16px';
    panel.innerHTML = `<div style="font-weight:700;margin-bottom:8px">☁️ Аккаунт MuQwiz</div><div id="mq-account-status" style="font-size:13px;margin-bottom:10px;color:var(--text-secondary)">Локальный режим — войди, чтобы синхронизировать устройства.</div><div id="mq-auth-form"><input id="mq-username" class="input-field" autocomplete="username" placeholder="Логин" maxlength="24" style="margin-bottom:8px"><input id="mq-email" class="input-field" type="email" autocomplete="email" placeholder="Email для восстановления" style="margin-bottom:8px"><input id="mq-password" class="input-field" type="password" autocomplete="current-password" placeholder="Пароль (минимум 10 символов)" style="margin-bottom:8px"><div style="display:flex;gap:8px;flex-wrap:wrap"><button id="mq-login" class="btn btn-primary btn-sm">Войти</button><button id="mq-register" class="btn btn-secondary btn-sm">Регистрация</button><button id="mq-reset" class="btn btn-secondary btn-sm">Сбросить пароль</button></div></div><div id="mq-auth-message" role="status" style="font-size:13px;margin-top:8px"></div><button id="mq-logout" class="btn btn-secondary btn-sm hidden" style="margin-top:8px">Выйти из аккаунта</button><button id="mq-sync-now" class="btn btn-secondary btn-sm hidden" style="margin:8px 0 0 8px">Синхронизировать</button>`;
    const onboardingCard = document.querySelector('#onboarding .card');
    const onboardingVisible = document.querySelector('#onboarding') && !document.querySelector('#onboarding').classList.contains('hidden');
    const target = (onboardingVisible && onboardingCard) || document.querySelector('.app-container') || document.body;
    target.prepend(panel);
    $('mq-login').onclick=()=>auth('login'); $('mq-register').onclick=()=>auth('register'); $('mq-reset').onclick=resetPassword;
    $('mq-logout').onclick=async()=>{ await client.auth.signOut(); userId=null; $('mq-auth-form').classList.remove('hidden'); $('mq-logout').classList.add('hidden'); $('mq-sync-now').classList.add('hidden'); say('Вышли. Данные останутся на этом устройстве.'); status('Локальный режим'); };
    $('mq-sync-now').onclick=()=>syncNow(true);
  }
  function status(s) { if ($('mq-account-status')) $('mq-account-status').textContent=s; }
  async function auth(action) {
    const username=$('mq-username').value.trim(), password=$('mq-password').value, email=$('mq-email').value.trim();
    if (!/^[a-zA-Z0-9_]{3,24}$/.test(username)) return say('Логин: 3–24 символа, латиница, цифры или _.');
    if (password.length < 10) return say('Пароль должен содержать минимум 10 символов.');
    if (action==='register' && !email) return say('Укажи email для подтверждения и восстановления пароля.');
    say('Подключаемся…');
    try {
      const response=await fetch(EDGE,{method:'POST',headers:{'Content-Type':'application/json','apikey':KEY},body:JSON.stringify({action,username,password,email})});
      const body=await response.json(); if(!response.ok) throw new Error(body.error||'Ошибка авторизации');
      if(action==='register') { say(body.message||'Проверь почту для подтверждения.'); return; }
      const {error}=await client.auth.setSession({access_token:body.session.access_token,refresh_token:body.session.refresh_token});
      if(error) throw error;
      userId=body.user.id; $('mq-auth-form').classList.add('hidden'); $('mq-logout').classList.remove('hidden'); $('mq-sync-now').classList.remove('hidden');
      await loadCloud();
    } catch(e) { say(e.message || 'Не удалось подключиться. Локальные данные не изменены.'); }
  }
  async function resetPassword() {
    const username=$('mq-username').value.trim(); if(!username) return say('Сначала введи логин.');
    try { const r=await fetch(EDGE,{method:'POST',headers:{'Content-Type':'application/json','apikey':KEY},body:JSON.stringify({action:'reset',username})}); const b=await r.json(); if(!r.ok) throw new Error(b.error||'Не удалось отправить письмо'); say(b.message||'Если аккаунт существует, письмо отправлено.'); }
    catch(e){say(e.message||'Ошибка отправки письма.');}
  }
  async function loadCloud() {
    if(!userId) return;
    const {data,error}=await client.from('user_data').select('payload,revision').eq('user_id',userId).maybeSingle();
    if(error) { status('Вход выполнен, но облачная база не настроена.'); say('Примени SQL-миграцию и разверни Edge Function.'); return; }
    const local=normalize(localSnapshot());
    if(!data) {
      const {error:insertError}=await client.from('user_data').insert({user_id:userId,payload:local});
      if(insertError) { say('Не удалось перенести локальные данные: '+insertError.message); return; }
      lastCloudJson=JSON.stringify(local); status('Локальные данные перенесены в облако.'); say('Первая синхронизация завершена.');
    } else {
      const cloud=normalize(data.payload||{}); lastCloudJson=JSON.stringify(cloud);
      const hasLocal=local.library.length||local.results.length||local.favorites.length||Object.keys(local.notes).length;
      const hasCloud=cloud.library.length||cloud.results.length||cloud.favorites.length||Object.keys(cloud.notes).length;
      if(hasLocal && hasCloud && JSON.stringify(local)!==JSON.stringify(cloud)) {
        if(confirm('На устройстве и в облаке есть разные данные. ОК — объединить, Отмена — загрузить облачную версию (локальная копия сохранится в браузере).')) {
          const merged=merge(local,cloud); apply(merged); await push(merged);
        } else { localStorage.setItem('muqwiz_pre_cloud_backup',JSON.stringify(local)); apply(cloud); localStorage.setItem('muqwiz_data',JSON.stringify(cloud)); }
      } else if(hasCloud) { apply(cloud); localStorage.setItem('muqwiz_data',JSON.stringify(cloud)); }
      else { await push(local); }
      status('Аккаунт подключён · синхронизация включена'); say('Данные загружены.');
    }
    document.dispatchEvent(new CustomEvent('muqwiz:cloud-loaded'));
  }
  function merge(a,b) {
    const byId=(arr)=>new Map(arr.filter(x=>x&&x.id!=null).map(x=>[String(x.id),x]));
    const map=byId(b.library); a.library.forEach(x=>map.set(String(x.id??`${x.name||x.title}-${x.createdAt||''}`),x));
    const results=new Map(); [...b.results,...a.results].forEach((x,i)=>results.set(String(x.id??`${x.date||''}-${x.quizId||''}-${x.score??i}`),x));
    return normalize({...b,...a,library:[...map.values()],results:[...results.values()],favorites:[...new Set([...(b.favorites||[]),...(a.favorites||[])])],notes:{...(b.notes||{}),...(a.notes||{})},settings:{...(b.settings||{}),...(a.settings||{})}});
  }
  function apply(data) { if(typeof APP!=='undefined') Object.assign(APP,normalize(data)); try { if(typeof applyTheme==='function') applyTheme(); if(typeof renderLibrary==='function') renderLibrary(); if(typeof renderResults==='function') renderResults(); if(typeof renderSettings==='function') renderSettings(); } catch(e){console.warn('Refresh after sync:',e);} }
  async function push(snapshot) {
    if(!userId||syncing) return; syncing=true;
    try {
      const payload=normalize(snapshot); const {error}=await client.from('user_data').upsert({user_id:userId,payload,updated_at:new Date().toISOString()},{onConflict:'user_id'});
      if(error) throw error; lastCloudJson=JSON.stringify(payload); status('Синхронизировано · '+new Date().toLocaleTimeString());
    } catch(e) { status('Нет связи с облаком — изменения сохранены локально и будут отправлены позже.'); console.warn('MuQwiz cloud sync:',e); }
    finally { syncing=false; }
  }
  async function syncNow(force=false) { if(!userId) return; if(!navigator.onLine) return status('Нет интернета — данные сохранены локально.'); await push(typeof APP!=='undefined'?APP:localSnapshot()); if(force) say('Синхронизация проверена.'); }
  function schedule(snapshot) { clearTimeout(syncTimer); syncTimer=setTimeout(()=>{ if(navigator.onLine && userId) push(snapshot); },900); }
  window.MuqwizCloud={scheduleSync:schedule, syncNow, get userId(){return userId;}};
  window.addEventListener('online',()=>syncNow());
  window.addEventListener('offline',()=>status('Офлайн · изменения останутся на устройстве до подключения.'));
  document.addEventListener('DOMContentLoaded',async()=>{
    showPanel();
    const {data}=await client.auth.getSession();
    if(data.session){userId=data.session.user.id;$('mq-auth-form').classList.add('hidden');$('mq-logout').classList.remove('hidden');$('mq-sync-now').classList.remove('hidden');await loadCloud();}
    else status('Локальный режим · войди, чтобы включить синхронизацию.');
  });
})();
