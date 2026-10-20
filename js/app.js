// ============================================
// ===== ГЛОБАЛЬНЫЕ ДАННЫЕ =====
// ============================================
const APP = {
    user: { name: '' },
    library: [],
    results: [],
    notes: {},
    favorites: [],
    settings: { theme: 'light' }
};

const Q = {
    quizId: null, level: 'easy', questions: [], currentIndex: 0,
    correctCount: 0, hintCount: 3, totalQuestions: 0, answered: false,
    timer: null, timeLeft: 90, wrongTitles: [], isFinished: false,
    timeLimit: 90, fromStart: true
};

// ============================================
// ===== УТИЛИТЫ =====
// ============================================
function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

function debounce(fn, ms) {
    let t;
    return function (...args) {
        clearTimeout(t);
        t = setTimeout(() => fn.apply(this, args), ms);
    };
}

// ============================================
// ===== SUPABASE =====
// ============================================
const SUPABASE_URL = 'https://xleqzgqiwayloeeewagv.supabase.co';
const SUPABASE_KEY = 'sb_publishable_ptX6EsSAH92n9XFcP-v9dA_EAOIF7kG';
let db = null;

if (typeof supabase !== 'undefined') {
    try {
        db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
        console.log('✅ Supabase клиент создан');
    } catch (e) {
        console.warn('⚠️ Не удалось создать Supabase клиент:', e);
        db = null;
    }
} else {
    console.warn('⚠️ supabase-js не загружен — работаем локально');
}

// ============================================
// ===== GOOGLE DRIVE API + OAUTH =====
// ============================================
const GOOGLE_API_KEY = 'AIzaSyCM_2vu-v0bkN_EAm5lQpK-fYnI_SXzGik';
const GOOGLE_CLIENT_ID = '544647807725-kdems4gglcv3p9gfnj780lo7rlulohl5.apps.googleusercontent.com'; // ← ЗАМЕНИТЕ
const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';

let tokenClient = null;
let accessToken = null;
let tokenExpiresAt = 0;

/**
 * Инициализация клиента OAuth (Google Identity Services).
 * Вызывается один раз при загрузке страницы.
 */
function initGoogleAuth() {
    if (typeof google === 'undefined' || !google.accounts || !google.accounts.oauth2) {
        console.warn('⚠️ Google Identity Services не загружен. Подключите <script src="https://accounts.google.com/gsi/client" async defer></script>');
        return;
    }

    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: GOOGLE_SCOPE,
        callback: (resp) => {
            if (resp && resp.access_token) {
                accessToken = resp.access_token;
                // expires_in в секундах; вычитаем 60 сек на запас
                tokenExpiresAt = Date.now() + (resp.expires_in ? (resp.expires_in - 60) * 1000 : 55 * 60 * 1000);
                console.log('✅ Access token получен, действует до', new Date(tokenExpiresAt).toLocaleTimeString());
                updateGoogleAuthUI();
            } else {
                console.error('Ошибка OAuth:', resp);
                alert('Не удалось получить доступ к Google Drive. Попробуйте снова.');
            }
        },
    });
    updateGoogleAuthUI();
}

/**
 * Запрос токена. Должен вызываться по клику пользователя.
 * Если токен ещё жив — не перезапрашиваем.
 */
function authorizeGoogle() {
    if (accessToken && Date.now() < tokenExpiresAt) {
        alert('✅ Вы уже авторизованы в Google.');
        return;
    }
    if (!tokenClient) {
        alert('Google OAuth не инициализирован. Проверьте, что подключён скрипт gsi/client и указан Client ID.');
        return;
    }
    tokenClient.requestAccessToken();
}

/**
 * Проверка: есть ли действующий токен.
 */
function hasValidToken() {
    return !!accessToken && Date.now() < tokenExpiresAt;
}

/**
 * Обновляет визуальное состояние кнопки авторизации (если она есть в HTML).
 */
function updateGoogleAuthUI() {
    const btn = document.getElementById('googleAuthBtn');
    const status = document.getElementById('googleAuthStatus');
    const ok = hasValidToken();
    if (btn) {
        btn.textContent = ok ? '✅ Google подключён' : '🔑 Войти через Google';
        btn.classList.toggle('btn-secondary', !ok);
        btn.classList.toggle('btn-primary', ok);
    }
    if (status) {
        status.textContent = ok
            ? `Доступ к Drive активен`
            : 'Для скачивания с Google Drive нужна авторизация';
        status.style.color = ok ? 'green' : 'var(--text-secondary)';
    }
}

/**
 * Сканирование папки Google Drive (метаданные).
 * Использует API-ключ — этого достаточно для публичных файлов.
 * Если папка приватная — нужен токен; на этот случай тоже поддерживаем.
 */
async function scanGoogleDrive(folderLink) {
    const matches = folderLink.match(/\/(?:folders|d)\/([a-zA-Z0-9_-]+)/g);
    if (!matches || matches.length === 0) throw new Error('Не удалось найти ID папки');

    const folderIds = matches.map(m => m.replace(/\/(?:folders|d)\//, ''));
    let allFiles = [];

    for (const folderId of folderIds) {
        const url = new URL('https://www.googleapis.com/drive/v3/files');
        url.searchParams.append('q', `'${folderId}' in parents and trashed = false`);
        url.searchParams.append('fields', 'files(id,name,mimeType)');
        url.searchParams.append('supportsAllDrives', 'true');
        url.searchParams.append('includeItemsFromAllDrives', 'true');
        // ключ — для публичных файлов; если есть токен — используем его
        if (!hasValidToken()) url.searchParams.append('key', GOOGLE_API_KEY);

        const headers = {};
        if (hasValidToken()) headers['Authorization'] = `Bearer ${accessToken}`;

        const response = await fetch(url.toString(), { headers });
        if (!response.ok) {
            if (response.status === 401) {
                throw new Error('Google-токен истёк. Войдите через Google заново.');
            }
            if (response.status === 403) {
                throw new Error('Доступ к папке запрещён. Проверьте, что папка доступна по ссылке, или войдите через Google.');
            }
            throw new Error(`Drive API: ${response.status} ${response.statusText}`);
        }
        const data = await response.json();
        if (data.files && data.files.length > 0) {
            allFiles = data.files;
            break;
        }
    }

    const mp3Files = allFiles.filter(f => f.name.toLowerCase().endsWith('.mp3'));
    return mp3Files.map(f => ({
        id: f.id,
        title: f.name.replace(/\.mp3$/i, '')
    }));
}

/**
 * Скачивание файла с Google Drive через официальный API (alt=media).
 * Требует access_token. Возвращает Blob.
 */
async function downloadFromDrive(fileId, title) {
    if (!hasValidToken()) {
        throw new Error('Нет действующего Google-токена. Нажмите «Войти через Google» и попробуйте снова.');
    }

    const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;

    const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    if (!response.ok) {
        if (response.status === 401) {
            accessToken = null;
            tokenExpiresAt = 0;
            updateGoogleAuthUI();
            throw new Error('Google-токен истёк. Войдите через Google заново.');
        }
        if (response.status === 403) {
            throw new Error(`Доступ к «${title}» запрещён. Убедитесь, что файл доступен вашей учётной записи.`);
        }
        if (response.status === 404) {
            throw new Error(`Файл «${title}» не найден на Google Drive.`);
        }
        throw new Error(`Drive API: ${response.status} ${response.statusText} (файл «${title}»)`);
    }

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/html')) {
        throw new Error(`Google вернул HTML вместо файла «${title}». Скорее всего, файл приватный или превышен лимит скачивания.`);
    }

    const blob = await response.blob();
    if (blob.size === 0) throw new Error(`Пустой файл «${title}»`);
    return blob;
}

// ============================================
// ===== ЗАГРУЗКА И СОХРАНЕНИЕ =====
// ============================================
function saveAppData() {
    try { localStorage.setItem('muqwiz_data', JSON.stringify(APP)); } catch (e) {}
    if (window.MuqwizCloud && typeof window.MuqwizCloud.scheduleSync === 'function') window.MuqwizCloud.scheduleSync(APP);
}

function loadAppData() {
    try {
        const raw = localStorage.getItem('muqwiz_data');
        if (raw) {
            const parsed = JSON.parse(raw);
            Object.assign(APP, parsed);
            APP.user = APP.user || { name: '' };
            APP.library = Array.isArray(APP.library) ? APP.library : [];
            APP.results = Array.isArray(APP.results) ? APP.results : [];
            APP.notes = APP.notes || {};
            APP.favorites = Array.isArray(APP.favorites) ? APP.favorites : [];
            APP.settings = APP.settings || { theme: 'light' };
        }
    } catch (e) {}
}

// ============================================
// ===== ОПРОСНИК =====
// ============================================
function checkOnboarding() {
    const onboardingEl = document.getElementById('onboarding');
    const appEl = document.getElementById('app');
    if (!onboardingEl || !appEl) return;

    if (APP.user.name) {
        onboardingEl.classList.add('hidden');
        appEl.classList.remove('hidden');
        applyTheme();
    } else {
        onboardingEl.classList.remove('hidden');
        appEl.classList.add('hidden');
    }
}

// ============================================
// ===== ТЕМА =====
// ============================================
function applyTheme() {
    const theme = APP.settings.theme || 'light';
    document.body.classList.toggle('dark', theme === 'dark');
}

// ============================================
// ===== БИБЛИОТЕКА =====
// ============================================
let currentTab = 'my';

function renderLibrary() {
    const container = document.getElementById('libraryContent');
    const sharedTab = document.getElementById('sharedTabContent');
    const addForm = document.getElementById('addForm');
    const showAddBtn = document.getElementById('showAddForm');
    if (!container) return;

    if (currentTab === 'shared') {
        container.classList.add('hidden');
        if (sharedTab) sharedTab.classList.remove('hidden');
        if (addForm) addForm.classList.add('hidden');
        if (showAddBtn) showAddBtn.classList.add('hidden');
        return;
    }

    container.classList.remove('hidden');
    if (sharedTab) sharedTab.classList.add('hidden');

    if (showAddBtn) {
        showAddBtn.classList.remove('hidden');
        showAddBtn.textContent = (addForm && !addForm.classList.contains('hidden'))
            ? '✖ Закрыть'
            : '➕ Добавить викторину';
    }

    let filtered = (currentTab === 'favorites')
        ? APP.library.filter(q => APP.favorites.includes(q.id))
        : APP.library;

    if (filtered.length === 0) {
        container.innerHTML = `<div class="card" style="text-align:center;padding:30px;color:var(--text-secondary);">📭 Здесь пока пусто</div>`;
        return;
    }

    container.innerHTML = filtered.map(q => `
        <div class="quiz-card" onclick="showQuizDetail('${esc(q.id)}')">
            <div class="top">
                <div>
                    <div class="name">${esc(q.name)}</div>
                    <div class="count">${q.tracks.length} произведений</div>
                </div>
                <div style="display:flex;align-items:center;">
                    <button class="btn btn-sm btn-secondary" onclick="event.stopPropagation(); refreshSingleQuiz('${esc(q.id)}', this)" style="width:auto; padding:4px 8px; margin-right:4px;">🔄</button>
                    <button class="heart ${APP.favorites.includes(q.id) ? 'liked' : ''}" onclick="event.stopPropagation(); toggleFavorite('${esc(q.id)}')">
                        ${APP.favorites.includes(q.id) ? '❤️' : '🤍'}
                    </button>
                </div>
            </div>
        </div>
    `).join('');
}

function toggleFavorite(id) {
    const idx = APP.favorites.indexOf(id);
    if (idx > -1) APP.favorites.splice(idx, 1);
    else APP.favorites.push(id);
    saveAppData();
    renderLibrary();
}

async function refreshSingleQuiz(quizId, btn) {
    if (!db) { alert('Облако недоступно'); return; }
    if (!quizId.startsWith('cloud_')) { alert('Эта викторина не в облаке'); return; }

    const cleanId = quizId.replace('cloud_', '');
    const oldText = btn ? btn.textContent : '';
    if (btn) { btn.textContent = '⏳'; btn.disabled = true; }

    try {
        const { data, error } = await db.from('quizzes').select('*').eq('id', cleanId).single();
        if (error) {
            if (error.code === 'PGRST116') {
                if (confirm('Удалить с устройства? (Викторины нет в облаке)')) {
                    APP.library = APP.library.filter(q => q.id !== quizId);
                    saveAppData(); renderLibrary();
                }
                return;
            }
            throw error;
        }
        const localQuiz = APP.library.find(q => q.id === quizId);
        if (localQuiz) {
            localQuiz.name = data.name;
            localQuiz.tracks = data.tracks || [];
            saveAppData();
            renderLibrary();
            alert('✅ Викторина обновлена!');
        }
    } catch (e) {
        alert('Ошибка: ' + e.message);
    } finally {
        if (btn) { btn.textContent = oldText || '🔄'; btn.disabled = false; }
    }
}

function showQuizDetail(quizId) {
    const quiz = APP.library.find(q => q.id === quizId);
    if (!quiz) return;

    const container = document.getElementById('libraryContent');
    const isFav = APP.favorites.includes(quizId);
    const showAddBtn = document.getElementById('showAddForm');
    if (showAddBtn) showAddBtn.classList.add('hidden');

    container.innerHTML = `
        <div class="quiz-detail">
            <div class="name">${esc(quiz.name)}</div>
            <div class="meta">${quiz.tracks.length} произведений</div>
            <div class="actions">
                <button class="btn btn-sm btn-gold" onclick="toggleFavorite('${esc(quizId)}'); showQuizDetail('${esc(quizId)}')">${isFav ? '❤️' : '🤍'} Избранное</button>
                <button class="btn btn-sm btn-primary" onclick="window.location.href='quiz.html?id=${encodeURIComponent(quizId)}'">🎯 Викторина</button>
                <button class="btn btn-sm btn-secondary" onclick="shareQuiz('${esc(quizId)}')">🔗 Поделиться</button>
                <button class="btn btn-sm btn-secondary" onclick="editQuizName('${esc(quizId)}')">✏️ Редактировать</button>
                <button class="btn btn-sm btn-danger" onclick="deleteQuiz('${esc(quizId)}')">🗑️ Удалить</button>
            </div>
            <div class="track-list">
                ${quiz.tracks.map((t, i) => `<div class="track-item"><span>${i + 1}. ${esc(t.title)}</span></div>`).join('')}
            </div>
            <button class="btn btn-secondary" onclick="renderLibrary()" style="margin-top:12px;">← Назад</button>
        </div>
    `;
}

window.shareQuiz = function (quizId) {
    const cleanId = quizId.startsWith('cloud_') ? quizId.replace('cloud_', '') : quizId;
    const url = window.location.origin + window.location.pathname + '?quiz=' + encodeURIComponent(cleanId);
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url)
            .then(() => alert('✅ Ссылка скопирована:\n' + url))
            .catch(() => prompt('Скопируйте ссылку:', url));
    } else {
        prompt('Скопируйте ссылку:', url);
    }
};

window.editQuizName = function (quizId) {
    const quiz = APP.library.find(q => q.id === quizId);
    if (!quiz) return;

    const container = document.getElementById('libraryContent');
    const showAddBtn = document.getElementById('showAddForm');
    if (showAddBtn) showAddBtn.classList.add('hidden');

    container.innerHTML = `
        <div class="quiz-detail">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
                <span style="font-size:20px;font-weight:700;">✏️ Редактировать викторину</span>
                <button class="btn btn-sm btn-secondary" onclick="showQuizDetail('${esc(quizId)}')">✖ Закрыть</button>
            </div>

            <div class="form-group">
                <label>Название викторины</label>
                <input type="text" class="input-field" id="editorQuizName" value="${esc(quiz.name)}">
            </div>

            <div style="margin:12px 0;font-weight:600;">Треки (${quiz.tracks.length})</div>
            <div id="editorTrackList">
                ${quiz.tracks.map((t, i) => `
                    <div class="edit-track-item" style="display:flex; gap:10px; margin-bottom:8px;">
                        <input type="text" class="input-field track-title-edit" data-index="${i}" value="${esc(t.title)}" style="flex:1; padding:8px 12px;">
                        <button class="btn btn-sm btn-danger remove-track-btn" data-index="${i}">✖</button>
                    </div>
                `).join('')}
            </div>

            <div class="form-group" style="margin-top:16px;">
                <label for="editorMp3Files">Добавить MP3 в эту викторину</label>
                <input type="file" id="editorMp3Files" accept=".mp3,audio/mpeg" multiple class="input-field" style="padding:10px;">
                <small style="display:block;margin-top:6px;color:var(--text-secondary);">Новые треки добавятся к существующим. Уже добавленные треки останутся на месте.</small>
            </div>
            <div style="margin-top:16px;">
                <button class="btn btn-primary" id="editorSaveBtn">💾 Сохранить</button>
                <button class="btn btn-secondary" onclick="showQuizDetail('${esc(quizId)}')" style="margin-top:8px;">Отмена</button>
            </div>
        </div>
    `;

    container.querySelectorAll('.remove-track-btn').forEach(btn => {
        btn.addEventListener('click', function () {
            const idx = parseInt(this.dataset.index, 10);
            if (confirm(`Удалить трек "${quiz.tracks[idx].title}"?`)) {
                quiz.tracks.splice(idx, 1);
                saveAppData();
                window.editQuizName(quizId);
            }
        });
    });

    document.getElementById('editorSaveBtn').addEventListener('click', async function () {
        const newName = document.getElementById('editorQuizName').value.trim();
        if (!newName) { alert('Введите название викторины'); return; }

        container.querySelectorAll('.track-title-edit').forEach(inp => {
            const idx = parseInt(inp.dataset.index, 10);
            if (quiz.tracks[idx]) {
                quiz.tracks[idx].title = inp.value.trim() || 'Без названия';
            }
        });

        quiz.name = newName;
        const mp3Input = document.getElementById('editorMp3Files');
        const addedFiles = mp3Input ? Array.from(mp3Input.files || []) : [];
        if (addedFiles.length) {
            if (!db) { alert('Для загрузки MP3 нужно подключение к облаку. Остальные изменения не потеряны.'); return; }
            const invalid = addedFiles.find(file => !(file.name.toLowerCase().endsWith('.mp3') || file.type === 'audio/mpeg'));
            if (invalid) { alert('Можно добавлять только MP3-файлы.'); return; }
            const saveButton = document.getElementById('editorSaveBtn');
            saveButton.disabled = true; saveButton.textContent = '⏳ Загружаем MP3…';
            try {
                for (let i = 0; i < addedFiles.length; i++) {
                    const file = addedFiles[i];
                    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
                    const fileName = `editor_${Date.now()}_${i}_${safeName}`;
                    const { error: uploadError } = await db.storage.from('music').upload(fileName, file, { contentType: 'audio/mpeg', upsert: false });
                    if (uploadError) throw uploadError;
                    const { data: urlData } = db.storage.from('music').getPublicUrl(fileName);
                    if (!urlData?.publicUrl) throw new Error('Не удалось получить ссылку на MP3: ' + file.name);
                    quiz.tracks.push({ title: file.name.replace(/\.mp3$/i, ''), file: urlData.publicUrl });
                }
            } catch (uploadError) {
                saveButton.disabled = false; saveButton.textContent = '💾 Сохранить';
                alert('Не удалось загрузить MP3: ' + uploadError.message + '\nУже загруженные файлы могут остаться в хранилище; повтори сохранение.');
                return;
            }
            saveButton.disabled = false; saveButton.textContent = '💾 Сохранить';
        }
        saveAppData();

        if (db && quizId.startsWith('cloud_')) {
            const cleanId = quizId.replace('cloud_', '');
            try {
                const { error } = await db.from('quizzes').update({
                    name: quiz.name,
                    tracks: quiz.tracks
                }).eq('id', cleanId);

                if (error) throw error;
                alert('✅ Изменения сохранены в облаке!');
            } catch (err) {
                console.error('Ошибка обновления:', err);
                alert('❌ Не удалось обновить в облаке: ' + err.message);
            }
        } else {
            alert('✅ Изменения сохранены локально!');
        }

        showQuizDetail(quizId);
    });
};

window.deleteQuiz = function (quizId) {
    if (!confirm('Удалить викторину?')) return;

    APP.library = APP.library.filter(q => q.id !== quizId);
    APP.favorites = APP.favorites.filter(id => id !== quizId);
    saveAppData();
    renderLibrary();
    const showAddBtn = document.getElementById('showAddForm');
    if (showAddBtn) {
        showAddBtn.classList.remove('hidden');
        showAddBtn.textContent = '➕ Добавить викторину';
    }
};

// ============================================
// ===== ФОРМА ДОБАВЛЕНИЯ =====
// ============================================
function initAddForm() {
    const showAddBtn = document.getElementById('showAddForm');
    const addForm = document.getElementById('addForm');
    const cancelAddBtn = document.getElementById('cancelAddBtn');
    if (!showAddBtn || !addForm) return;

    showAddBtn.addEventListener('click', () => {
        addForm.classList.toggle('hidden');
        showAddBtn.textContent = addForm.classList.contains('hidden')
            ? '➕ Добавить викторину'
            : '✖ Закрыть';
        // при открытии формы обновляем состояние OAuth
        if (!addForm.classList.contains('hidden')) updateGoogleAuthUI();
    });

    if (cancelAddBtn) {
        cancelAddBtn.addEventListener('click', () => {
            addForm.classList.add('hidden');
            showAddBtn.textContent = '➕ Добавить викторину';
        });
    }

    const addMethodSelect = document.getElementById('addMethod');
    const fileDiv = document.getElementById('addMethodFiles');
    const gdriveDiv = document.getElementById('addMethodGdrive');
    const manualDiv = document.getElementById('addMethodManual');

    if (addMethodSelect && fileDiv && gdriveDiv && manualDiv) {
        addMethodSelect.addEventListener('change', function () {
            fileDiv.classList.add('hidden');
            gdriveDiv.classList.add('hidden');
            manualDiv.classList.add('hidden');
            if (this.value === 'files') fileDiv.classList.remove('hidden');
            if (this.value === 'gdrive') {
                gdriveDiv.classList.remove('hidden');
                updateGoogleAuthUI();
            }
            if (this.value === 'manual') manualDiv.classList.remove('hidden');
        });
    }

    // Кнопка «Войти через Google»
    const googleAuthBtn = document.getElementById('googleAuthBtn');
    if (googleAuthBtn) {
        googleAuthBtn.addEventListener('click', (e) => {
            e.preventDefault();
            authorizeGoogle();
        });
    }

    // Сканирование Google Диска
    const scanBtn = document.getElementById('scanGdriveBtn');
    if (scanBtn) {
        scanBtn.addEventListener('click', async function () {
            const linkEl = document.getElementById('gdriveLink');
            const progressEl = document.getElementById('gdriveProgress');
            const resultEl = document.getElementById('gdriveResult');
            const link = linkEl ? linkEl.value.trim() : '';
            if (!link) { alert('Введите ссылку'); return; }

            if (progressEl) progressEl.classList.remove('hidden');
            this.disabled = true;
            try {
                const tracks = await scanGoogleDrive(link);
                if (resultEl) {
                    resultEl.innerHTML = `<span style="color:green;">✅ Найдено ${tracks.length} MP3!</span>`;
                    resultEl.classList.remove('hidden');
                }
                window.scannedGdriveTracks = tracks;
            } catch (err) {
                if (resultEl) {
                    resultEl.innerHTML = `<span style="color:red;">❌ Ошибка: ${esc(err.message)}</span>`;
                    resultEl.classList.remove('hidden');
                }
            } finally {
                if (progressEl) progressEl.classList.add('hidden');
                this.disabled = false;
            }
        });
    }

    // Сохранение викторины
    const saveQuizBtn = document.getElementById('saveQuizBtn');
    if (!saveQuizBtn) return;

    saveQuizBtn.addEventListener('click', async () => {
        const nameEl = document.getElementById('newQuizName');
        const methodEl = document.getElementById('addMethod');
        const name = nameEl ? nameEl.value.trim() : '';
        const method = methodEl ? methodEl.value : 'files';
        if (!name) { alert('Введите название'); return; }

        let tracks = [];
        const saveBtn = saveQuizBtn;
        saveBtn.textContent = '⏳ Обработка...';
        saveBtn.disabled = true;

        try {
            if (method === 'files') {
                const fileInput = document.getElementById('fileInput');
                const files = fileInput ? fileInput.files : null;
                if (!files || files.length === 0) {
                    alert('Выберите файлы');
                    return;
                }
                if (!db) {
                    alert('Облако недоступно — загрузка файлов невозможна.');
                    return;
                }
                for (let i = 0; i < files.length; i++) {
                    const file = files[i];
                    const fileExt = (file.name.split('.').pop() || 'mp3').toLowerCase();
                    const fileName = `${Date.now()}_${i}.${fileExt}`;
                    const { error } = await db.storage.from('music').upload(fileName, file);
                    if (error) throw error;
                    const { data: urlData } = db.storage.from('music').getPublicUrl(fileName);
                    if (!urlData || !urlData.publicUrl) {
                        throw new Error('Не удалось получить ссылку на файл. Проверьте Storage.');
                    }
                    tracks.push({
                        title: file.name.replace(/\.mp3$/i, ''),
                        file: urlData.publicUrl
                    });
                }
            } else if (method === 'gdrive') {
                if (!window.scannedGdriveTracks || window.scannedGdriveTracks.length === 0) {
                    alert('Сначала сканируйте папку');
                    return;
                }
                if (!db) {
                    alert('Облако недоступно — загрузка с Google Drive невозможна (нужен Supabase Storage).');
                    return;
                }
                if (!hasValidToken()) {
                    alert('Сначала войдите через Google (кнопка «Войти через Google»).');
                    return;
                }

                saveBtn.textContent = '⏳ Скачиваем с Google Диска...';

                for (let i = 0; i < window.scannedGdriveTracks.length; i++) {
                    const gFile = window.scannedGdriveTracks[i];
                    saveBtn.textContent = `⏳ Скачиваем ${i + 1}/${window.scannedGdriveTracks.length}...`;

                    const blob = await downloadFromDrive(gFile.id, gFile.title);
                    const fileName = `gdrive_${Date.now()}_${i}.mp3`;
                    const { error: uploadError } = await db.storage.from('music').upload(fileName, blob, {
                        contentType: 'audio/mpeg',
                        upsert: false
                    });
                    if (uploadError) throw uploadError;

                    const { data: urlData } = db.storage.from('music').getPublicUrl(fileName);
                    if (!urlData || !urlData.publicUrl) {
                        throw new Error(`Не удалось получить ссылку на «${gFile.title}»`);
                    }

                    tracks.push({
                        title: gFile.title,
                        file: urlData.publicUrl
                    });
                }
            }

            const newQuiz = { id: 'local_' + Date.now(), name: name, tracks: tracks };
            APP.library.push(newQuiz);
            saveAppData();

            if (db) {
                try {
                    const { data, error } = await db.from('quizzes').insert([{ name: name, tracks: tracks }]).select();
                    if (error) throw error;
                    if (data && data[0]) {
                        newQuiz.id = 'cloud_' + data[0].id;
                        saveAppData();
                    }
                    alert(`✅ Викторина "${name}" сохранена в облаке!`);
                } catch (err) {
                    alert(`✅ Викторина "${name}" сохранена локально (${err.message})`);
                }
            } else {
                alert('✅ Викторина сохранена локально');
            }

            // Очистка формы
            addForm.classList.add('hidden');
            showAddBtn.textContent = '➕ Добавить викторину';
            if (nameEl) nameEl.value = '';
            const gdriveLinkEl = document.getElementById('gdriveLink');
            if (gdriveLinkEl) gdriveLinkEl.value = '';
            const gdriveResultEl = document.getElementById('gdriveResult');
            if (gdriveResultEl) gdriveResultEl.classList.add('hidden');
            const fileInputEl = document.getElementById('fileInput');
            if (fileInputEl) fileInputEl.value = '';
            window.scannedGdriveTracks = null;

            renderLibrary();
        } catch (err) {
            alert('❌ Ошибка: ' + err.message);
        } finally {
            saveBtn.textContent = '💾 Сохранить';
            saveBtn.disabled = false;
        }
    });
}

// ============================================
// ===== ЗАГРУЗКА ИЗ ОБЛАКА =====
// ============================================
function initSharedLoader() {
    const loadSharedBtn = document.getElementById('loadSharedBtn');
    if (!loadSharedBtn) return;

    loadSharedBtn.addEventListener('click', async function () {
        if (!db) { alert('Облако недоступно'); return; }

        const linkEl = document.getElementById('sharedLink');
        const progressEl = document.getElementById('sharedProgress');
        const resultEl = document.getElementById('sharedResult');
        const link = linkEl ? linkEl.value.trim() : '';
        if (!link) { alert('Вставьте ссылку'); return; }

        let quizId = null;
        try { quizId = new URL(link).searchParams.get('quiz'); } catch (e) { quizId = link; }
        if (!quizId) { alert('Не найден ID'); return; }

        const cleanId = quizId.startsWith('cloud_') ? quizId.replace('cloud_', '') : quizId;

        if (progressEl) progressEl.classList.remove('hidden');
        this.disabled = true;
        try {
            const { data, error } = await db.from('quizzes').select('*').eq('id', cleanId).single();
            if (error) throw error;

            if (data) {
                const newQuiz = { id: 'cloud_' + data.id, name: data.name, tracks: data.tracks || [] };
                if (!APP.library.some(q => q.id === newQuiz.id)) {
                    APP.library.push(newQuiz);
                    saveAppData();
                }
                if (resultEl) {
                    resultEl.innerHTML = `<span style="color:green;">✅ Викторина "${esc(newQuiz.name)}" загружена!</span>`;
                    resultEl.classList.remove('hidden');
                }
                setTimeout(() => {
                    const myTab = document.querySelector('#libraryTabs button[data-tab="my"]');
                    if (myTab) myTab.click();
                }, 1000);
            }
        } catch (err) {
            if (resultEl) {
                resultEl.innerHTML = `<span style="color:red;">❌ Ошибка: ${esc(err.message)}</span>`;
                resultEl.classList.remove('hidden');
            }
        } finally {
            if (progressEl) progressEl.classList.add('hidden');
            this.disabled = false;
        }
    });
}

// ============================================
// ===== ПОДГОТОВКА =====
// ============================================
let prepareQuizId = null;
let prepareTrackIndex = 0;
let prepareShuffle = false;

function renderPrepareSelect() {
    const select = document.getElementById('prepareSelect');
    if (!select) return;
    select.innerHTML = '<option value="">— выбери викторину —</option>';
    APP.library.forEach(q => {
        select.innerHTML += `<option value="${esc(q.id)}">${esc(q.name)} (${q.tracks.length})</option>`;
    });
}

function renderPrepareTracks(quiz) {
    const container = document.getElementById('trackListPrepare');
    if (!container) return;
    if (!quiz.tracks || quiz.tracks.length === 0) {
        container.innerHTML = '<div style="text-align:center;color:var(--text-secondary);padding:20px;">Нет треков</div>';
        return;
    }

    container.innerHTML = quiz.tracks.map((t, i) => {
        const noteKey = quiz.id + '_' + i;
        const savedNote = APP.notes[noteKey] || '';
        return `
            <div class="item" style="padding:10px 0; border-bottom:1px solid var(--border); ${i === prepareTrackIndex ? 'background:var(--border); border-radius:8px;' : ''}">
                <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
                    <span style="flex:1; font-weight:500;">${i + 1}. ${esc(t.title)}</span>
                    <input type="text" class="note-input" data-key="${esc(noteKey)}" placeholder="Заметка..." value="${esc(savedNote)}" style="width:120px; padding:4px 8px; border-radius:20px; border:1px solid var(--border);">
                    <button class="btn btn-sm btn-secondary" onclick="playPrepareTrackById('${esc(quiz.id)}', ${i})">▶</button>
                </div>
            </div>
        `;
    }).join('');

    const saveNote = debounce(function (key, value) {
        APP.notes[key] = value;
        saveAppData();
    }, 300);

    container.querySelectorAll('.note-input').forEach(inp => {
        inp.addEventListener('input', function () {
            saveNote(this.dataset.key, this.value);
        });
        inp.addEventListener('blur', function () {
            APP.notes[this.dataset.key] = this.value;
            saveAppData();
        });
    });
}

function playPrepareTrack(quiz, index) {
    if (!quiz || !quiz.tracks || quiz.tracks.length === 0) return;

    const container = document.getElementById('trackListPrepare');
    if (container) {
        container.querySelectorAll('.note-input').forEach(inp => {
            APP.notes[inp.dataset.key] = inp.value;
        });
        saveAppData();
    }

    if (prepareShuffle) {
        prepareTrackIndex = Math.floor(Math.random() * quiz.tracks.length);
    } else {
        prepareTrackIndex = ((index % quiz.tracks.length) + quiz.tracks.length) % quiz.tracks.length;
    }

    const track = quiz.tracks[prepareTrackIndex];
    const audio = document.getElementById('playerAudio');
    if (audio) {
        audio.src = track.file;
        audio.load();
        audio.play().catch(() => {});
    }
    renderPrepareTracks(quiz);
}

window.playPrepareTrackById = function (quizId, index) {
    const quiz = APP.library.find(q => q.id === quizId);
    if (quiz) playPrepareTrack(quiz, index);
};

function initPreparePage() {
    const prepSelect = document.getElementById('prepareSelect');
    if (prepSelect) {
        prepSelect.addEventListener('change', function () {
            const quizId = this.value;
            if (!quizId) return;
            prepareQuizId = quizId;
            prepareTrackIndex = 0;
            prepareShuffle = false;
            const quiz = APP.library.find(q => q.id === quizId);
            if (!quiz) return;

            renderPrepareTracks(quiz);
            playPrepareTrack(quiz, 0);

            const gotoBtn = document.getElementById('gotoQuizBtn');
            if (gotoBtn) {
                gotoBtn.style.display = 'block';
                gotoBtn.dataset.quizId = quizId;
            }
        });
    }

    const playPrev = document.getElementById('playPrev');
    if (playPrev) {
        playPrev.addEventListener('click', () => {
            const quiz = APP.library.find(q => q.id === prepareQuizId);
            if (quiz) playPrepareTrack(quiz, prepareTrackIndex - 1);
        });
    }

    const playNext = document.getElementById('playNext');
    if (playNext) {
        playNext.addEventListener('click', () => {
            const quiz = APP.library.find(q => q.id === prepareQuizId);
            if (quiz) playPrepareTrack(quiz, prepareTrackIndex + 1);
        });
    }

    const playShuffleBtn = document.getElementById('playShuffle');
    if (playShuffleBtn) {
        playShuffleBtn.addEventListener('click', function () {
            prepareShuffle = !prepareShuffle;
            this.textContent = prepareShuffle ? '🔀 Вкл' : '🔀 Перемешать';
            const quiz = APP.library.find(q => q.id === prepareQuizId);
            if (quiz) playPrepareTrack(quiz, 0);
        });
    }

    const gotoQuizBtn = document.getElementById('gotoQuizBtn');
    if (gotoQuizBtn) {
        gotoQuizBtn.addEventListener('click', function () {
            if (this.dataset.quizId) {
                window.location.href = 'quiz.html?id=' + encodeURIComponent(this.dataset.quizId);
            }
        });
    }
}

// ============================================
// ===== ВИКТОРИНА =====
// ============================================
function renderQuizSelect() {
    const select = document.getElementById('quizSelect');
    if (!select) return;
    select.innerHTML = '<option value="">— выбери викторину —</option>';
    APP.library.forEach(q => {
        select.innerHTML += `<option value="${esc(q.id)}">${esc(q.name)} (${q.tracks.length})</option>`;
    });
    const urlParams = new URLSearchParams(window.location.search);
    const urlId = urlParams.get('id');
    if (urlId && APP.library.some(q => q.id === urlId)) select.value = urlId;
}

function showNextButton() {
    let nextBtn = document.getElementById('nextBtn');
    const feedback = document.getElementById('gameFeedback');
    if (!nextBtn) {
        nextBtn = document.createElement('button');
        nextBtn.id = 'nextBtn';
        nextBtn.className = 'btn btn-primary';
        nextBtn.style.marginTop = '10px';
        nextBtn.textContent = '⏭ Далее';
        nextBtn.onclick = function () { Q.currentIndex++; showQuestion(); };
        if (feedback && feedback.parentNode) {
            feedback.parentNode.insertBefore(nextBtn, feedback.nextSibling);
        } else {
            document.body.appendChild(nextBtn);
        }
    }
    nextBtn.classList.remove('hidden');
}

function initQuizPage() {
    document.querySelectorAll('.level-btn').forEach(btn => {
        btn.addEventListener('click', function () {
            document.querySelectorAll('.level-btn').forEach(b => b.classList.remove('selected'));
            this.classList.add('selected');
        });
    });

    const startQuizBtn = document.getElementById('startQuizBtn');
    if (startQuizBtn) {
        startQuizBtn.addEventListener('click', function () {
            const quizSelect = document.getElementById('quizSelect');
            const quizId = quizSelect ? quizSelect.value : '';
            if (!quizId) { alert('Выберите викторину'); return; }
            const quiz = APP.library.find(q => q.id === quizId);
            if (!quiz || !quiz.tracks || quiz.tracks.length === 0) { alert('Нет треков'); return; }

            const selectedBtn = document.querySelector('.level-btn.selected');
            const level = selectedBtn ? selectedBtn.dataset.level : 'easy';
            const countEl = document.getElementById('quizCount');
            const count = parseInt(countEl ? countEl.value : '10', 10) || 10;

            let timeLimit = 90, hintLimit = 3, fromStart = true;
            if (level === 'medium') { timeLimit = 60; hintLimit = 3; fromStart = true; }
            if (level === 'hard') { timeLimit = 45; hintLimit = 1; fromStart = false; }

            const tracks = [...quiz.tracks].sort(() => Math.random() - 0.5);
            const total = Math.min(count, tracks.length);

            Q.quizId = quizId;
            Q.level = level;
            Q.questions = tracks.slice(0, total);
            Q.currentIndex = 0;
            Q.correctCount = 0;
            Q.hintCount = hintLimit;
            Q.totalQuestions = total;
            Q.timeLimit = timeLimit;
            Q.fromStart = fromStart;
            Q.isFinished = false;
            Q.answered = false;
            Q.timeLeft = timeLimit;
            Q.wrongTitles = [];

            document.getElementById('quizSetup').classList.add('hidden');
            document.getElementById('gameScreen').classList.remove('hidden');
            document.getElementById('finalScreen').classList.add('hidden');
            showQuestion();
        });
    }

    const submitBtn = document.getElementById('submitBtn');
    if (submitBtn) {
        submitBtn.addEventListener('click', function () {
            if (Q.answered) return;
            const input = document.getElementById('answerInput');
            if (!input) return;
            const userAnswer = input.value.trim();
            if (!userAnswer) { alert('Введите ответ'); return; }
            const correct = Q.questions[Q.currentIndex].title;
            const normalize = s => s.toLowerCase().replace(/\s+/g, ' ').trim();
            const isCorrect = normalize(userAnswer) === normalize(correct);
            handleAnswer(isCorrect);
        });
    }

    const hintBtn = document.getElementById('hintBtn');
    if (hintBtn) {
        hintBtn.addEventListener('click', function () {
            if (Q.hintCount <= 0 || Q.answered) return;
            Q.hintCount--;
            this.textContent = `💡 Подсказка (${Q.hintCount})`;
            if (Q.hintCount <= 0) this.disabled = true;

            const q = Q.questions[Q.currentIndex];
            let hint = '';
            if (Q.level === 'easy') {
                const container = document.getElementById('optionsContainer');
                const buttons = container ? container.querySelectorAll('.option-btn') : [];
                const correct = q.title;
                const wrongs = [];
                buttons.forEach(b => { if (b.dataset.value !== correct) wrongs.push(b); });
                for (let i = wrongs.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [wrongs[i], wrongs[j]] = [wrongs[j], wrongs[i]];
                }
                const toRemove = wrongs.slice(0, Math.min(2, wrongs.length));
                toRemove.forEach(b => { b.style.opacity = '0.3'; b.style.pointerEvents = 'none'; });
                hint = '🔍 Убраны два неправильных варианта';
            } else {
                const words = q.title.split(' ');
                hint = words.length > 0
                    ? `📝 Первое слово: "${words[0]}"`
                    : `📝 Первая буква: "${q.title.charAt(0)}"`;
            }
            document.getElementById('gameFeedback').innerHTML =
                `<div class="game-feedback hint">💡 ${esc(hint)}</div>`;
        });
    }
}

function showQuestion() {
    if (Q.currentIndex >= Q.totalQuestions) { finishQuiz(); return; }
    Q.answered = false;
    const q = Q.questions[Q.currentIndex];

    const questionNumEl = document.getElementById('questionNum');
    if (questionNumEl) questionNumEl.textContent = `Вопрос ${Q.currentIndex + 1} из ${Q.totalQuestions}`;

    const hintBtn = document.getElementById('hintBtn');
    if (hintBtn) {
        hintBtn.textContent = `💡 Подсказка (${Q.hintCount})`;
        hintBtn.disabled = Q.hintCount <= 0;
    }

    Q.timeLeft = Q.timeLimit;
    updateTimerDisplay();
    if (Q.timer) clearInterval(Q.timer);
    Q.timer = setInterval(timerTick, 1000);

    const audio = document.getElementById('gameAudio');
    if (audio) {
        audio.src = q.file;
        audio.load();

        audio.oncanplay = null;
        let seekDone = false;

        audio.oncanplay = function () {
            if (seekDone) { audio.play().catch(() => {}); return; }
            if (!Q.fromStart && audio.duration > 10) {
                seekDone = true;
                audio.currentTime = audio.duration * (0.3 + Math.random() * 0.4);
            }
            audio.play().catch(() => {});
        };
        audio.onerror = () => console.warn('Ошибка загрузки аудио:', q.file);
    }

    const container = document.getElementById('gameQuestion');
    if (container) {
        if (Q.level === 'easy') {
            renderEasyQuestion(container, q);
        } else {
            renderInputQuestion(container);
        }
    }

    const feedback = document.getElementById('gameFeedback');
    if (feedback) feedback.innerHTML = '';

    const submitBtn = document.getElementById('submitBtn');
    if (submitBtn) {
        if (Q.level === 'easy') submitBtn.classList.add('hidden');
        else { submitBtn.classList.remove('hidden'); submitBtn.disabled = false; }
    }

    const nextBtn = document.getElementById('nextBtn');
    if (nextBtn) nextBtn.classList.add('hidden');
}

function renderEasyQuestion(container, q) {
    const allTitles = [...new Set(Q.questions.map(item => item.title))];
    const correct = q.title;
    let wrongs = allTitles.filter(t => t !== correct);
    for (let i = wrongs.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [wrongs[i], wrongs[j]] = [wrongs[j], wrongs[i]];
    }
    wrongs = wrongs.slice(0, 3);
    while (wrongs.length < 3) wrongs.push('Другой вариант ' + (wrongs.length + 1));

    const options = [correct, ...wrongs].sort(() => Math.random() - 0.5);

    container.innerHTML = `
        <p style="font-weight:600;margin-bottom:10px;">Выбери правильное название:</p>
        <div class="game-options" id="optionsContainer">
            ${options.map(opt => `<button class="option-btn" data-value="${esc(opt)}">${esc(opt)}</button>`).join('')}
        </div>
    `;

    container.querySelectorAll('.option-btn').forEach(btn => {
        btn.addEventListener('click', function () {
            if (Q.answered) return;
            const selected = this.dataset.value;
            const correct = Q.questions[Q.currentIndex].title;
            const isCorrect = selected === correct;

            container.querySelectorAll('.option-btn').forEach(b => {
                b.classList.add('disabled');
                if (b.dataset.value === correct) b.classList.add('correct');
                if (b === this && !isCorrect) b.classList.add('wrong');
            });

            handleAnswer(isCorrect);
        });
    });
}

function renderInputQuestion(container) {
    container.innerHTML = `
        <p style="font-weight:600;margin-bottom:10px;">Введите название произведения:</p>
        <input type="text" class="game-input" id="answerInput" placeholder="Введите ответ...">
    `;
    const input = document.getElementById('answerInput');
    if (input) {
        input.value = '';
        input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                const submitBtn = document.getElementById('submitBtn');
                if (submitBtn) submitBtn.click();
            }
        });
        input.focus();
    }
}

function handleAnswer(isCorrect) {
    if (Q.answered) return;
    Q.answered = true;
    if (Q.timer) { clearInterval(Q.timer); Q.timer = null; }

    const q = Q.questions[Q.currentIndex];
    const feedback = document.getElementById('gameFeedback');

    if (isCorrect) {
        Q.correctCount++;
        if (feedback) feedback.innerHTML = `<div class="game-feedback correct">✅ Правильно! Это "${esc(q.title)}"</div>`;
    } else {
        Q.wrongTitles.push(q.title);
        if (feedback) feedback.innerHTML = `<div class="game-feedback wrong">❌ Неправильно! Правильный ответ: «${esc(q.title)}»</div>`;
    }

    showNextButton();
    const submitBtn = document.getElementById('submitBtn');
    if (submitBtn) submitBtn.disabled = true;
}

function timerTick() {
    Q.timeLeft--;
    updateTimerDisplay();
    if (Q.timeLeft <= 0) {
        clearInterval(Q.timer);
        Q.timer = null;
        if (!Q.answered) {
            const q = Q.questions[Q.currentIndex];
            Q.wrongTitles.push(q.title);
            Q.answered = true;
            const feedback = document.getElementById('gameFeedback');
            if (feedback) {
                feedback.innerHTML = `<div class="game-feedback wrong">⏰ Время вышло! Правильный ответ: «${esc(q.title)}»</div>`;
            }
            const submitBtn = document.getElementById('submitBtn');
            if (submitBtn) submitBtn.disabled = true;
            showNextButton();
        }
    }
}

function updateTimerDisplay() {
    const display = document.getElementById('timerDisplay');
    if (!display) return;
    const mins = Math.floor(Q.timeLeft / 60);
    const secs = Q.timeLeft % 60;
    display.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
    display.classList.toggle('warning', Q.timeLeft <= 10);
}

function finishQuiz() {
    if (Q.isFinished) return;
    Q.isFinished = true;
    if (Q.timer) { clearInterval(Q.timer); Q.timer = null; }

    document.getElementById('gameScreen').classList.add('hidden');

    const total = Q.totalQuestions;
    const correct = Q.correctCount;
    const percent = total > 0 ? Math.round((correct / total) * 100) : 0;
    const quiz = APP.library.find(q => q.id === Q.quizId);

    APP.results.push({
        date: new Date().toLocaleDateString('ru-RU'),
        quizName: quiz ? quiz.name : 'Неизвестно',
        level: Q.level === 'easy' ? 'Лёгкий' : Q.level === 'medium' ? 'Средний' : 'Сложный',
        correct: correct, total: total, percent: percent
    });
    saveAppData();

    let medal = '💪', title = 'Попробуй ещё раз!';
    if (percent >= 90) { medal = '🏆'; title = 'Маэстро!'; }
    else if (percent >= 70) { medal = '🎵'; title = 'Хороший результат!'; }
    else if (percent >= 50) { medal = '📖'; title = 'Нужно ещё позаниматься'; }

    const finalContent = document.getElementById('finalContent');
    if (finalContent) {
        finalContent.innerHTML = `
            <div class="card" style="text-align:center;">
                <span style="font-size:64px;display:block;">${medal}</span>
                <div style="font-size:32px;font-weight:700;">${title}</div>
                <div style="font-size:48px;font-weight:700;color:var(--accent);">${percent}%</div>
                <div style="font-size:18px;color:var(--text-secondary);">${correct} из ${total} правильных</div>
                ${Q.wrongTitles.length > 0 ? `<div style="margin-top:12px;text-align:left;font-size:14px;">📌 Повтори: ${esc(Q.wrongTitles.join(', '))}</div>` : ''}
            </div>
            <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:12px;">
                <button class="btn btn-primary" onclick="location.href='quiz.html'">🔄 Пройти ещё раз</button>
                <button class="btn btn-secondary" onclick="location.href='results.html'">🏠 Результаты</button>
            </div>
        `;
    }
    document.getElementById('finalScreen').classList.remove('hidden');
}

// ============================================
// ===== РЕЗУЛЬТАТЫ =====
// ============================================
function renderResults() {
    const container = document.getElementById('resultsList');
    const summary = document.getElementById('statsSummary');
    if (!container) return;

    if (!APP.results || APP.results.length === 0) {
        container.innerHTML = `<div class="card" style="text-align:center;padding:40px;color:var(--text-secondary);">📭 Здесь будут твои результаты</div>`;
        if (summary) summary.classList.add('hidden');
        return;
    }

    const sorted = [...APP.results].reverse();
    const avg = Math.round(sorted.reduce((sum, r) => sum + r.percent, 0) / sorted.length);
    const best = Math.max(...sorted.map(r => r.percent));

    if (summary) {
        summary.classList.remove('hidden');
        summary.innerHTML = `
            <span>📈 Средний: <strong>${avg}%</strong></span>
            <span>🏆 Лучший: <strong>${best}%</strong></span>
            <span>📊 Викторин: <strong>${sorted.length}</strong></span>
        `;
    }

    container.innerHTML = sorted.map(r => `
        <div class="result-card ${r.percent >= 90 ? 'high' : ''}">
            <div class="date">📅 ${esc(r.date)} — ${esc(r.quizName)} (${esc(r.level)})</div>
            <div class="info">
                <span class="score">${r.correct} из ${r.total}</span>
                <span class="percent">${r.percent}%</span>
            </div>
        </div>
    `).join('');
}

function initResultsPage() {
    const clearResultsBtn = document.getElementById('clearResultsBtn');
    if (clearResultsBtn) {
        clearResultsBtn.addEventListener('click', function () {
            if (confirm('Удалить всю историю результатов?')) {
                APP.results = [];
                saveAppData();
                renderResults();
                alert('✅ История очищена');
            }
        });
    }
}

// ============================================
// ===== НАСТРОЙКИ =====
// ============================================
function renderSettings() {
    const nameEl = document.getElementById('settingsName');
    if (nameEl) nameEl.textContent = APP.user.name || '—';
    const themeSelect = document.getElementById('themeSelect');
    if (themeSelect) themeSelect.value = APP.settings.theme || 'light';
}

function initSettingsPage() {
    const editProfileBtn = document.getElementById('editProfileBtn');
    if (editProfileBtn) {
        editProfileBtn.addEventListener('click', function () {
            const newName = prompt('Введите ваше имя:', APP.user.name);
            if (newName && newName.trim()) {
                APP.user.name = newName.trim();
                saveAppData();
                renderSettings();
                alert('✅ Имя обновлено!');
            }
        });
    }

    const themeSelect = document.getElementById('themeSelect');
    if (themeSelect) {
        themeSelect.addEventListener('change', function () {
            APP.settings.theme = this.value;
            saveAppData();
            document.body.classList.toggle('dark', this.value === 'dark');
        });
    }

    const clearCacheBtn = document.getElementById('clearCacheBtn');
    if (clearCacheBtn) {
        clearCacheBtn.addEventListener('click', function () {
            if (confirm('Очистить кэш?')) {
                if ('caches' in window) {
                    caches.keys().then(keys => keys.forEach(key => caches.delete(key)));
                }
                alert('✅ Кэш очищен');
            }
        });
    }
}

// ============================================
// ===== ONBOARDING =====
// ============================================
function initOnboarding() {
    const onboardingBtn = document.getElementById('onboardingFinish');
    if (!onboardingBtn) return;

    onboardingBtn.addEventListener('click', () => {
        const nameInput = document.getElementById('userName');
        const name = nameInput ? nameInput.value.trim() : '';
        if (!name) { alert('Введите имя'); return; }

        APP.user.name = name;
        saveAppData();

        // После ввода имени сначала предлагаем вход/регистрацию.
        // Если пользователь ранее выбрал гостевой режим, сразу открываем приложение.
        if (localStorage.getItem('muqwiz_guest_mode') !== '1') {
            location.href = 'account.html';
            return;
        }

        const onboardingEl = document.getElementById('onboarding');
        const appEl = document.getElementById('app');
        if (onboardingEl) onboardingEl.classList.add('hidden');
        if (appEl) appEl.classList.remove('hidden');

        applyTheme();
        renderLibrary();
    });
}

// ============================================
// ===== ВКЛАДКИ БИБЛИОТЕКИ =====
// ============================================
function initLibraryTabs() {
    document.querySelectorAll('#libraryTabs button').forEach(btn => {
        btn.addEventListener('click', function () {
            document.querySelectorAll('#libraryTabs button').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            currentTab = this.dataset.tab;
            renderLibrary();
        });
    });
}

// ============================================
// ===== ТАЙМЕР ПРИ УХОДЕ =====
// ============================================
window.addEventListener('beforeunload', () => {
    if (Q.timer) clearInterval(Q.timer);
});

// ============================================
// ===== ЗАПУСК =====
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    loadAppData();
    applyTheme();

    initGoogleAuth();
    initOnboarding();
    initLibraryTabs();
    initAddForm();
    initSharedLoader();

    if (document.getElementById('page-library')) {
        // First-time users who entered a name but haven't chosen guest mode should see auth.
        if (APP.user.name && localStorage.getItem('muqwiz_guest_mode') !== '1') {
            location.replace('account.html');
            return;
        }
        checkOnboarding();
        if (APP.user.name) renderLibrary();
    }
    if (document.getElementById('page-prepare')) {
        renderPrepareSelect();
        initPreparePage();
    }
    if (document.getElementById('page-quiz')) {
        renderQuizSelect();
        initQuizPage();
    }
    if (document.getElementById('page-results')) {
        renderResults();
        initResultsPage();
    }
    if (document.getElementById('page-settings')) {
        renderSettings();
        initSettingsPage();
    }
});

console.log('🎵 MuQwiz загружен!');
