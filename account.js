/* MuQwiz account + offline-first sync. */
(() => {
  const URL='https://xleqzgqiwayloeeewagv.supabase.co';
  const KEY='sb_publishable_ptX6EsSAH92n9XFcP-v9dA_EAOIF7kG';
  const client=window.supabase?.createClient(URL,KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
  if(!client){console.warn('MuQwiz: Supabase client unavailable');return;}
  const EDGE=`${URL}/functions/v1/username-auth`;
  let userId=null, sessionUser=null, syncTimer=null, syncing=false, pending=false, lastCloudJson=null, lastLocalJson=null;
  const $=id=>document.getElementById(id);
  const say=msg=>{const el=$('mq-auth-message')||$('mq-account-message');if(el)el.textContent=msg;};
  const status=msg=>{document.querySelectorAll('#mq-account-status').forEach(el=>el.textContent=msg);};
  const stable=x=>Array.isArray(x)?x.map(stable):(x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,stable(x[k])])):x);
  const normalize=x=>({user:x?.user||{name:''},library:Array.isArray(x?.library)?x.library:[],results:Array.isArray(x?.results)?x.results:[],notes:x?.notes&&typeof x.notes==='object'?x.notes:{},favorites:Array.isArray(x?.favorites)?x.favorites:[],settings:x?.settings||{theme:'light'}});
  const json=x=>JSON.stringify(stable(normalize(x)));
  const localSnapshot=()=>{try{return normalize(JSON.parse(localStorage.getItem('muqwiz_data')||'{}'));}catch{return normalize({});}};
  function saveLocal(data){localStorage.setItem('muqwiz_data',JSON.stringify(normalize(data)));}
  function apply(data){const n=normalize(data);if(typeof APP!=='undefined')Object.assign(APP,n);saveLocal(n);try{if(n.user?.name){const onboarding=document.getElementById('onboarding'),app=document.getElementById('app');if(onboarding)onboarding.classList.add('hidden');if(app)app.classList.remove('hidden');}if(typeof applyTheme==='function')applyTheme();if(typeof renderLibrary==='function')renderLibrary();if(typeof renderResults==='function')renderResults();if(typeof renderSettings==='function')renderSettings();if(typeof renderPrepareSelect==='function')renderPrepareSelect();}catch(e){console.warn('Refresh after cloud sync',e);}}
  function merge(local,cloud){
    const out=normalize(cloud), l=normalize(local);
    const keyed=(arr)=>new Map(arr.map((x,i)=>[String(x?.id??`${x?.name||x?.title||'item'}_${i}`),x]));
    const lib=keyed(cloud.library); for(const [id,item] of keyed(local.library)) {const old=lib.get(id); if(!old)lib.set(id,item); else if(JSON.stringify(stable(item))!==JSON.stringify(stable(old))){const a=Date.parse(item.updatedAt||item.updated_at||item.modifiedAt||'');const b=Date.parse(old.updatedAt||old.updated_at||old.modifiedAt||'');lib.set(id,a&&b?(a>=b?item:old):{...old,...item,_conflictBackup:old});}}
    const res=keyed([...cloud.results,...local.results]);
    return normalize({...out,...l,library:[...lib.values()],results:[...res.values()],favorites:[...new Set([...cloud.favorites,...local.favorites])],notes:{...cloud.notes,...local.notes},settings:{...cloud.settings,...local.settings}});
  }
  function conflictDialog(local,cloud){return new Promise(resolve=>{
    const old=$('mq-conflict-overlay');if(old)old.remove();
    const overlay=document.createElement('div');overlay.id='mq-conflict-overlay';overlay.style.cssText='position:fixed;inset:0;z-index:20000;background:#000b;display:flex;align-items:center;justify-content:center;padding:16px';
    const card=document.createElement('section');card.style.cssText='width:min(100%,500px);max-height:90vh;overflow:auto;background:var(--card-bg,#202124);color:var(--text-primary,#fff);border:1px solid var(--border-color,#555);border-radius:18px;padding:22px';
    card.innerHTML='<h2 style="margin:0 0 10px">☁️ Разные данные</h2><p>На этом устройстве и в облаке есть изменения. Выбери, как их сохранить. Перед заменой MuQwiz сделает резервную копию.</p><div style="display:grid;gap:9px;margin-top:16px"><button class="btn btn-primary" data-choice="merge">🔀 Объединить данные</button><button class="btn btn-secondary" data-choice="cloud">⬇️ Загрузить облачную версию</button><button class="btn btn-secondary" data-choice="local">⬆️ Загрузить локальную версию в облако</button></div><p style="font-size:12px;opacity:.75;margin-top:12px">Если версии заметки конфликтуют, сохранится резервная копия конфликтующей записи там, где это возможно.</p>';
    overlay.appendChild(card);document.body.appendChild(overlay);card.querySelectorAll('button').forEach(b=>b.onclick=()=>{overlay.remove();resolve(b.dataset.choice);});
  });}
  async function callEdge(payload){const r=await fetch(EDGE,{method:'POST',headers:{'Content-Type':'application/json','apikey':KEY},body:JSON.stringify(payload)});let b={};try{b=await r.json();}catch{}if(!r.ok)throw new Error(b.error||b.message||'Ошибка авторизации');return b;}
  async function auth(action){
    const username=$('mq-username')?.value.trim()||'',password=$('mq-password')?.value||'',email=$('mq-email')?.value.trim()||'',repeat=$('mq-password-repeat')?.value||'';
    if(!/^[a-zA-Z0-9_]{3,24}$/.test(username))return say('Логин: 3–24 символа, латиница, цифры или _.');
    if(password.length<10)return say('Пароль должен содержать минимум 10 символов.');
    if(action==='register'&&password!==repeat)return say('Пароли не совпадают.');
    if(action==='register'&&!email)return say('Укажи email для восстановления пароля.');
    say('Подключаемся…');
    try{
      const b=await callEdge({action,username,password,email});
      if(action==='register'){
        // Registration endpoint may return an immediate session, otherwise try standard password sign-in.
        if(b.session?.access_token&&b.session?.refresh_token){const {error}=await client.auth.setSession({access_token:b.session.access_token,refresh_token:b.session.refresh_token});if(error)throw error;}
        else {const sign=await client.auth.signInWithPassword({email,password});if(sign.error){say((b.message||'Аккаунт создан.')+' Если требуется подтверждение почты, подтверди её и войди.');return;}}
        await finishLogin();return;
      }
      if(action==='login'){
        if(b.session?.access_token&&b.session?.refresh_token){const {error}=await client.auth.setSession({access_token:b.session.access_token,refresh_token:b.session.refresh_token});if(error)throw error;}
        else {const sign=await client.auth.signInWithPassword({email:b.email||email,password});if(sign.error)throw sign.error;}
        await finishLogin();
      }
    }catch(e){say(e.message||'Не удалось подключиться. Локальные данные не изменены.');}
  }
  async function finishLogin(){const {data,error}=await client.auth.getSession();if(error)throw error;if(!data.session)throw new Error('Сессия не создана. Проверь подтверждение почты.');userId=data.session.user.id;sessionUser=data.session.user;localStorage.removeItem('muqwiz_guest_mode');localStorage.setItem('muqwiz_authenticated','1');await loadCloud();if(location.pathname.endsWith('/account.html')||location.pathname.endsWith('account.html'))location.href='index.html';renderAccountSettings();say('Вход выполнен.');}
  async function resetPassword(){const username=$('mq-username')?.value.trim()||'';if(!username)return say('Введи логин, чтобы найти аккаунт.');try{const b=await callEdge({action:'reset',username});say(b.message||'Если аккаунт существует, письмо для сброса пароля отправлено.');}catch(e){say(e.message||'Не удалось отправить письмо.');}}
  async function loadCloud(){
    if(!userId)return;
    status('Загружаем облачные данные…');
    const {data,error}=await client.from('user_data').select('payload,revision,updated_at').eq('user_id',userId).maybeSingle();
    if(error){status('Ошибка чтения облака: '+error.message);say('Данные остались на устройстве. Повтори синхронизацию позже.');return;}
    const local=localSnapshot(), localHas=hasData(local);
    if(!data){
      // First sync for this account: preserve existing local/guest data in the cloud.
      const {data:inserted,error:insertError}=await client.from('user_data').insert({user_id:userId,payload:local,updated_at:new Date().toISOString()}).select('updated_at').single();
      if(insertError)throw insertError;
      lastCloudJson=json(local);lastLocalJson=json(local);status('Синхронизировано');
    } else {
      const cloud=normalize(data.payload||{}), cloudHas=hasData(cloud);
      if(cloudHas){
        // Cloud is authoritative. Keep a timestamped local backup before replacing anything.
        if(localHas&&!sameData(local,cloud)){
          const backup={savedAt:new Date().toISOString(),userId,source:'before-cloud-load',data:local};
          localStorage.setItem('muqwiz_backup_local_'+userId,JSON.stringify(backup));
          localStorage.setItem('muqwiz_backup_local_latest',JSON.stringify(backup));
        }
        apply(cloud);
        lastCloudJson=json(cloud);lastLocalJson=json(cloud);
        status('Облачные данные загружены · синхронизировано');
      } else if(localHas){
        // Empty cloud, useful local data: upload local data rather than erase it.
        const {error:upsertError}=await client.from('user_data').upsert({user_id:userId,payload:local,updated_at:new Date().toISOString()},{onConflict:'user_id'}).select('updated_at').single();
        if(upsertError)throw upsertError;
        lastCloudJson=json(local);lastLocalJson=json(local);status('Локальные данные сохранены в облако');
      } else {
        apply(cloud);lastCloudJson=json(cloud);lastLocalJson=json(cloud);status('Синхронизировано');
      }
    }
    document.dispatchEvent(new CustomEvent('muqwiz:cloud-loaded'));
    renderAccountSettings();
  }
  function hasData(d){return !!(d.library.length||d.results.length||d.favorites.length||Object.keys(d.notes).length||d.user?.name);}
  function sameData(a,b){return json(a)===json(b);}
  async function push(snapshot,force=false){
    if(!userId)return false;
    if(syncing){pending=true;return false;}
    if(!navigator.onLine){status('Офлайн · изменения сохранены на устройстве, ждут отправки.');return false;}
    syncing=true;status('Синхронизация…');
    try{
      const payload=normalize(snapshot||localSnapshot());
      const {data:remote,error:readError}=await client.from('user_data').select('payload,updated_at').eq('user_id',userId).maybeSingle();
      if(readError)throw readError;
      if(remote){
        const cloud=normalize(remote.payload||{});
        // If another device changed cloud since our last confirmed sync, retain a backup silently.
        if(lastCloudJson && json(cloud)!==lastCloudJson && json(payload)!==json(cloud)){
          const backup={savedAt:new Date().toISOString(),userId,source:'cloud-changed-before-push',data:cloud};
          localStorage.setItem('muqwiz_backup_cloud_'+userId,JSON.stringify(backup));
          localStorage.setItem('muqwiz_backup_cloud_latest',JSON.stringify(backup));
        }
      }
      const {data,error}=await client.from('user_data').upsert({user_id:userId,payload,updated_at:new Date().toISOString()},{onConflict:'user_id'}).select('updated_at').single();
      if(error)throw error;
      if(!data)throw new Error('Сервер не подтвердил сохранение');
      lastCloudJson=json(payload);lastLocalJson=json(payload);status('Синхронизировано · '+new Date().toLocaleTimeString());return true;
    }catch(e){status('Ошибка синхронизации · данные сохранены локально');console.warn('MuQwiz sync:',e);return false;}
    finally{syncing=false;if(pending){pending=false;scheduleSync();}}
  }
  async function scheduleSync(){clearTimeout(syncTimer);syncTimer=setTimeout(()=>{if(userId)push(typeof APP!=='undefined'?APP:localSnapshot());},1000);}
  async function syncNow(){if(!userId){status('Войди в аккаунт, чтобы синхронизировать данные.');return;}await push(typeof APP!=='undefined'?APP:localSnapshot(),true);}
  async function logout(){await client.auth.signOut();userId=null;sessionUser=null;localStorage.removeItem('muqwiz_authenticated');localStorage.setItem('muqwiz_guest_mode','1');status('Гостевой режим · данные сохранены на устройстве.');renderAccountSettings();}
  function renderAccountSettings(){const host=$('mq-account-settings');if(!host)return;host.innerHTML='';const signed=!!userId;host.innerHTML=signed?`<div class="settings-row"><span class="label">Логин</span><b id="mq-settings-username">—</b></div><div class="settings-row"><span class="label">Почта</span><span id="mq-settings-email">—</span></div><div class="settings-row"><span class="label">Подтверждение почты</span><span>${sessionUser?.email_confirmed_at?'Подтверждена':'Не подтверждена'}</span></div><div id="mq-account-status" class="settings-row">Подключено</div><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px"><button class="btn btn-secondary btn-sm" id="mq-change-email">Изменить почту</button><button class="btn btn-secondary btn-sm" id="mq-change-password">Изменить пароль</button><button class="btn btn-secondary btn-sm" id="mq-sync-now">Синхронизировать</button><button class="btn btn-danger btn-sm" id="mq-logout">Выйти</button></div><p id="mq-account-message" role="status"></p>`:`<p>Гостевой режим: данные хранятся на этом устройстве.</p><a class="btn btn-primary btn-sm" href="account.html">Войти или создать аккаунт</a><div id="mq-account-status">Локальный режим</div>`;
    if(signed){$('mq-settings-email').textContent=sessionUser?.email||'—';$('mq-settings-username').textContent=sessionUser?.user_metadata?.username||sessionUser?.email?.split('@')[0]||'—';$('mq-sync-now').onclick=syncNow;$('mq-logout').onclick=logout;$('mq-change-email').onclick=async()=>{const email=prompt('Новая почта:',sessionUser?.email||'');if(!email)return;const {error}=await client.auth.updateUser({email});say(error?error.message:'Запрос на смену почты отправлен. Подтверди его по письму.');};$('mq-change-password').onclick=async()=>{const password=prompt('Новый пароль (минимум 10 символов):');if(!password)return;if(password.length<10)return say('Пароль должен содержать минимум 10 символов.');const {error}=await client.auth.updateUser({password});say(error?error.message:'Пароль изменён.');};}
  }
  function initAccountPage(){
    if(!$('mq-account-page'))return;
    const registerBtn=$('mq-show-register'), loginSwitch=$('mq-show-login');
    const showRegister=()=>{
      $('mq-email-row').classList.remove('hidden');$('mq-repeat-row').classList.remove('hidden');
      $('mq-login-btn').classList.add('hidden');$('mq-register-btn').classList.remove('hidden');
      registerBtn.classList.add('hidden');loginSwitch.classList.remove('hidden');
      $('mq-mode-label').textContent='Создать аккаунт';
    };
    const showLogin=()=>{
      $('mq-email-row').classList.add('hidden');$('mq-repeat-row').classList.add('hidden');
      $('mq-register-btn').classList.add('hidden');$('mq-login-btn').classList.remove('hidden');
      loginSwitch.classList.add('hidden');registerBtn.classList.remove('hidden');
      $('mq-mode-label').textContent='Вход';
    };
    registerBtn.onclick=showRegister;loginSwitch.onclick=showLogin;
    $('mq-login-btn').onclick=()=>auth('login');$('mq-register-btn').onclick=()=>auth('register');
    $('mq-reset').onclick=resetPassword;$('mq-guest').onclick=()=>{localStorage.removeItem('muqwiz_authenticated');localStorage.setItem('muqwiz_guest_mode','1');location.href='index.html';};
    showLogin();
  }
  window.MuqwizCloud={scheduleSync,syncNow,get userId(){return userId;}};
  window.addEventListener('online',()=>{if(userId)syncNow();});window.addEventListener('offline',()=>status('Офлайн · изменения останутся на устройстве до подключения.'));
  document.addEventListener('DOMContentLoaded',async()=>{initAccountPage();const {data}=await client.auth.getSession();if(data.session){userId=data.session.user.id;sessionUser=data.session.user;localStorage.setItem('muqwiz_authenticated','1');localStorage.removeItem('muqwiz_guest_mode');if($('mq-account-page')){await loadCloud();location.href='index.html';}else{renderAccountSettings();loadCloud();}}else renderAccountSettings();});
})();
