// Deploy with: supabase functions deploy username-auth
// Set SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY as function secrets.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json' };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: cors });
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });
  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  try {
    const { action, username, password, email } = await req.json();
    if (typeof username !== 'string' || !/^[a-zA-Z0-9_]{3,24}$/.test(username) || typeof password !== 'string' || password.length < 10 || password.length > 128) return json(400, { error: 'Логин: 3–24 символа (латиница, цифры, _); пароль: 10–128 символов.' });
    if (action === 'register') {
      if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(400, { error: 'Укажите корректный email для восстановления пароля.' });
      const { data: exists } = await admin.from('profiles').select('id').ilike('username', username).maybeSingle();
      if (exists) return json(409, { error: 'Этот логин уже занят.' });
      const publicClient = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
      const { data, error } = await publicClient.auth.signUp({ email, password, options: { data: { username } } });
      if (error || !data.user) return json(400, { error: error?.message || 'Не удалось создать аккаунт.' });
      // With email confirmation enabled, create the profile after the user confirms and logs in.
      // If confirmation is disabled in the Supabase project, this inserts it immediately.
      if (data.session) {
        const { error: profileError } = await admin.from('profiles').insert({ id: data.user.id, username, recovery_email: email });
        if (profileError) { await admin.auth.admin.deleteUser(data.user.id); return json(400, { error: profileError.message }); }
      } else {
        // Pending username reservation avoids two registrations claiming the same name.
        const { error: reserveError } = await admin.from('username_reservations').insert({ username: username.toLowerCase(), user_id: data.user.id, recovery_email: email });
        if (reserveError) { await admin.auth.admin.deleteUser(data.user.id); return json(409, { error: 'Логин занят или регистрация не удалась.' }); }
      }
      return json(200, { ok: true, message: data.session ? 'Аккаунт создан.' : 'Проверь почту и подтверди регистрацию, затем войди.' });
    }
    if (action === 'reset') {
      if (typeof username !== 'string' || !/^[a-zA-Z0-9_]{3,24}$/.test(username)) return json(200, { message: 'Если аккаунт существует, письмо для восстановления отправлено.' });
      let { data: profile } = await admin.from('profiles').select('recovery_email').ilike('username', username).maybeSingle();
      if (!profile) { const { data: reservation } = await admin.from('username_reservations').select('recovery_email').eq('username', username.toLowerCase()).maybeSingle(); if (reservation) profile = reservation; }
      if (profile?.recovery_email) {
        const auth = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
        await auth.auth.resetPasswordForEmail(profile.recovery_email, { redirectTo: `${req.headers.get('origin') || 'http://localhost:8080'}/reset-password.html` });
      }
      return json(200, { message: 'Если аккаунт существует, письмо для восстановления отправлено.' });
    }
    if (action === 'login') {
      let { data: profile } = await admin.from('profiles').select('recovery_email').ilike('username', username).maybeSingle();
      if (!profile) {
        const { data: reservation } = await admin.from('username_reservations').select('user_id,recovery_email').eq('username', username.toLowerCase()).maybeSingle();
        if (reservation) profile = { recovery_email: reservation.recovery_email };
      }
      if (!profile?.recovery_email) return json(401, { error: 'Неверный логин или пароль.' });
      const auth = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
      const { data, error } = await auth.auth.signInWithPassword({ email: profile.recovery_email, password });
      if (error || !data.session) return json(401, { error: 'Неверный логин или пароль.' });
      const { data: existingProfile } = await admin.from('profiles').select('id').eq('id', data.user.id).maybeSingle();
      if (!existingProfile) {
        const { data: reservation } = await admin.from('username_reservations').select('username,recovery_email').eq('user_id', data.user.id).maybeSingle();
        if (reservation) {
          await admin.from('profiles').insert({ id: data.user.id, username: reservation.username, recovery_email: reservation.recovery_email });
          await admin.from('username_reservations').delete().eq('user_id', data.user.id);
        }
      }
      return json(200, { session: data.session, user: data.user });
    }
    return json(400, { error: 'Неизвестное действие.' });
  } catch { return json(400, { error: 'Некорректный запрос.' }); }
});
