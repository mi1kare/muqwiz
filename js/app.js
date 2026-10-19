// ============================================
// ===== ГЛОБАЛЬНЫЕ ДАННЫЕ =====
// ============================================
const APP = {
    user: { name: '' },
    library: [],
    results: [],
    notes: {},
    timecodes: {},
    favorites: [],
    settings: { theme: 'light', sound: true, volume: 0.8 }
};

const Q = {
    quizId: null, level: 'easy', questions: [], currentIndex: 0,
    correctCount: 0, hintCount: 3, totalQuestions: 0, autoNext: true,
    showAnswer: true, answered: false, timer: null, timeLeft: 90,
    wrongTitles: [], isFinished: false, timeLimit: 90, fromStart: true,
    audioReady: false, waitingForAudio: false
};

// ============================================
// ===== SUPABASE =====
// ============================================
const SUPABASE_URL = 'https://xleqzgqiwayloeeewagv.supabase.co';
const SUPABASE_KEY = 'sb_publishable_ptX6EsSAH92n9XFcP-v9dA_EAOIF7kG';
let db = null;

if (typeof supabase !== 'undefined') {
    db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    console.log('✅ Supabase клиент создан');
}

// ============================================
// ===== GOOGLE DRIVE API =====
// ============================================
const GOOGLE_API_KEY = 'AIzaSyAKtOvwvOQ0BsGy4vFi_HmSN6U33WcWcbE';

async function scanGoogleDrive(folderLink) {
    let folderId = null;
    const match = folderLink.match(/\/folders\/([a-zA-Z0-9_-]+)/);
    if (match) folderId = match[1];
    else {
        const match2 = folderLink.match(/id=([a-zA-Z0-9_-]+)/);
        if (match2) folderId = match2[1];
    }
    if (!folderId) throw new Error('Не удалось извлечь ID папки');

    const url = `https://www.googleapis.com/drive/v3/files?q='${folderId}'+in+parents+and+trashed=false&key=${GOOGLE_API_KEY}&fields=files(id,name,mimeType)&supportsAllDrives=true&includeItemsFromAllDrives=true`;
    const response = await fetch(url);
    if (!response.ok) throw new Error('Ошибка API Google');

    const data = await response.json();
    const files = data.files || [];
    return files.filter(f => f.name.toLowerCase().endsWith('.mp3')).map(f => ({
        title: f.name.replace(/\.mp3$/i, ''),
        file: `https://drive.google.com/uc?export=download&id=${f.id}`
    }));
}

// ============================================
// ===== ЗАГРУЗКА И СОХРАНЕНИЕ =====
// ============================================
function saveAppData() {
    try { localStorage.setItem('muqwiz_data', JSON.stringify(APP)); } catch(e) {}
}

function loadAppData() {
    try {
        const raw = localStorage.getItem('muqwiz_data');
        if (raw) Object.assign(APP, JSON.parse(raw));
    } catch(e) {}
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

const onboardingBtn = document.getElementById('onboardingFinish');
if (onboardingBtn) {
    onboardingBtn.addEventListener('click', () => {
        const name = document.getElementById('userName').value.trim();
        if (!name) { alert('Введите имя'); return; }
        APP.user.name = name;
        saveAppData();
        document.getElementById('onboarding').classList.add('hidden');
        document.getElementById('app').classList.remove('hidden');
        applyTheme();
        renderLibrary(); 
    });
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
    if (!container) return;

    if (currentTab === 'shared') {
        container.classList.add('hidden');
        sharedTab.classList.remove('hidden');
        return;
    } else {
        container.classList.remove('hidden');
        sharedTab.classList.add('hidden');
    }

    let filtered = (currentTab === 'favorites') 
        ? APP.library.filter(q => APP.favorites.includes(q.id)) 
        : APP.library;

    if (filtered.length === 0) {
        container.innerHTML = `<div class="card" style="text-align:center;padding:30px;color:var(--text-secondary);">📭 Здесь пока пусто</div>`;
        return;
    }

    container.innerHTML = filtered.map(q => `
        <div class="quiz-card" onclick="showQuizDetail('${q.id}')">
            <div class="top">
                <div>
                    <div class="name">${q.name}</div>
                    <div class="count">${q.tracks.length} произведений</div>
                </div>
                <div style="display:flex;align-items:center;">
                    <button class="btn btn-sm btn-secondary" onclick="event.stopPropagation(); refreshSingleQuiz('${q.id}')" style="width:auto; padding:4px 8px; margin-right:4px;">🔄</button>
                    <button class="heart ${APP.favorites.includes(q.id) ? 'liked' : ''}" onclick="event.stopPropagation(); toggleFavorite('${q.id}')">
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

// ============================================
// ===== ОБНОВЛЕНИЕ ОДНОЙ ВИКТОРИНЫ =====
// ============================================
async function refreshSingleQuiz(quizId) {
    if (!db || !quizId.startsWith('cloud_')) { alert('Эта викторина не в облаке'); return; }
    const cleanId = quizId.replace('cloud_', '');
    const btn = event.target;
    btn.textContent = '⏳';
    btn.disabled = true;

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
    } catch(e) { alert('Ошибка: ' + e.message); }
    finally { btn.textContent = '🔄'; btn.disabled = false; }
}

// ============================================
// ===== ДЕТАЛЬНАЯ КАРТОЧКА =====
// ============================================
function showQuizDetail(quizId) {
    const quiz = APP.library.find(q => q.id === quizId);
    if (!quiz) return;

    const container = document.getElementById('libraryContent');
    const isFav = APP.favorites.includes(quizId);
    const showAddBtn = document.getElementById('showAddForm');
    if (showAddBtn) showAddBtn.classList.add('hidden');

    const secretKey = localStorage.getItem('owner_' + quiz.name);

    container.innerHTML = `
        <div class="quiz-detail">
            <div class="name">${quiz.name}</div>
            <div class="meta">${quiz.tracks.length} произведений</div>
            <div class="actions">
                <button class="btn btn-sm btn-gold" onclick="toggleFavorite('${quizId}'); showQuizDetail('${quizId}')">${isFav ? '❤️' : '🤍'} Избранное</button>
                <button class="btn btn-sm btn-primary" onclick="window.location.href='quiz.html?id=${quizId}'">🎯 Викторина</button>
                <button class="btn btn-sm btn-secondary" onclick="shareQuiz('${quizId}')">🔗 Поделиться</button>
                <button class="btn btn-sm btn-secondary" onclick="editQuizName('${quizId}')">✏️ Редактировать</button>
                <button class="btn btn-sm btn-danger" onclick="deleteQuiz('${quizId}')">🗑️ Удалить</button>
            </div>
            <div class="track-list">
                ${quiz.tracks.map((t, i) => `<div class="track-item"><span>${i+1}. ${t.title}</span></div>`).join('')}
            </div>
            <button class="btn btn-secondary" onclick="renderLibrary(); document.getElementById('showAddForm').classList.remove('hidden');" style="margin-top:12px;">← Назад</button>
        </div>
    `;
}

window.shareQuiz = function(quizId) {
    const cleanId = quizId.startsWith('cloud_') ? quizId.replace('cloud_', '') : quizId;
    const url = window.location.origin + window.location.pathname + '?quiz=' + cleanId;
    if (navigator.clipboard) {
        navigator.clipboard.writeText(url).then(() => alert('✅ Ссылка скопирована:\n' + url));
    } else {
        prompt('Скопируйте ссылку:', url);
    }
};

window.editQuizName = function(quizId) {
    const quiz = APP.library.find(q => q.id === quizId);
    if (!quiz) return;
    const secretKey = localStorage.getItem('owner_' + quiz.name);
    if (!secretKey && quizId.startsWith('cloud_')) {
        alert('Вы не можете редактировать эту викторину (создана не вами).');
        return;
    }
    const newName = prompt('Новое название:', quiz.name);
    if (newName && newName.trim()) {
        quiz.name = newName.trim();
        saveAppData();
        if (db && quizId.startsWith('cloud_')) {
            db.from('quizzes').update({ name: quiz.name }).eq('id', quizId.replace('cloud_', '')).eq('secret_key', secretKey).then();
        }
        showQuizDetail(quizId);
    }
};

window.deleteQuiz = function(quizId) {
    const quiz = APP.library.find(q => q.id === quizId);
    if (!quiz) return;
    const secretKey = localStorage.getItem('owner_' + quiz.name);
    
    if (secretKey && quizId.startsWith('cloud_')) {
        if (confirm('Удалить и из облака?')) {
            db.from('quizzes').delete().eq('id', quizId.replace('cloud_', '')).eq('secret_key', secretKey).then();
        }
    } else {
        if (!confirm('Удалить с устройства? (Из облака не удалится)')) return;
    }
    
    APP.library = APP.library.filter(q => q.id !== quizId);
    APP.favorites = APP.favorites.filter(id => id !== quizId);
    saveAppData();
    renderLibrary();
    document.getElementById('showAddForm').classList.remove('hidden');
};

// ============================================
// ===== ОБРАБОТЧИКИ ВКЛАДОК =====
// ============================================
document.querySelectorAll('#libraryTabs button').forEach(btn => {
    btn.addEventListener('click', function() {
        document.querySelectorAll('#libraryTabs button').forEach(b => b.classList.remove('active'));
        this.classList.add('active');
        currentTab = this.dataset.tab;
        renderLibrary();
    });
});

// ============================================
// ===== ФОРМА ДОБАВЛЕНИЯ =====
// ============================================
const showAddBtn = document.getElementById('showAddForm');
const addForm = document.getElementById('addForm');
const cancelAddBtn = document.getElementById('cancelAddBtn');

if (showAddBtn && addForm) {
    showAddBtn.addEventListener('click', () => {
        addForm.classList.toggle('hidden');
        showAddBtn.textContent = addForm.classList.contains('hidden') ? '➕ Добавить викторину' : '✖ Закрыть';
    });

    cancelAddBtn.addEventListener('click', () => {
        addForm.classList.add('hidden');
        showAddBtn.textContent = '➕ Добавить викторину';
    });

    document.getElementById('saveQuizBtn').addEventListener('click', async () => {
        const name = document.getElementById('newQuizName').value.trim();
        const method = document.getElementById('addMethod').value;
        if (!name) { alert('Введите название'); return; }

        let tracks = [];
        const saveBtn = document.getElementById('saveQuizBtn');
        saveBtn.textContent = '⏳ Обработка...';
        saveBtn.disabled = true;

        try {
            if (method === 'files') {
                const fileInput = document.getElementById('fileInput');
                const files = fileInput.files;
                if (!files || files.length === 0) { alert('Выберите файлы'); saveBtn.textContent = '💾 Сохранить'; saveBtn.disabled = false; return; }

                for (let i = 0; i < files.length; i++) {
                    const file = files[i];
                    const fileExt = file.name.split('.').pop();
                    const fileName = `${Date.now()}_${i}.${fileExt}`;
                    const { error } = await db.storage.from('music').upload(fileName, file);
                    if (error) throw error;
                    const { data: urlData } = db.storage.from('music').getPublicUrl(fileName);
                    tracks.push({ title: file.name.replace(/\.mp3$/i, ''), file: urlData.publicUrl });
                }
            } else if (method === 'gdrive') {
                if (!window.scannedGdriveTracks || window.scannedGdriveTracks.length === 0) { alert('Сначала сканируйте папку'); saveBtn.textContent = '💾 Сохранить'; saveBtn.disabled = false; return; }
                tracks = window.scannedGdriveTracks;
            } else {
                const filesText = document.getElementById('trackFiles').value.trim();
                if (!filesText) { alert('Введите ссылки'); saveBtn.textContent = '💾 Сохранить'; saveBtn.disabled = false; return; }
                tracks = filesText.split('\n').map((url, i) => ({ title: `Трек ${i + 1}`, file: url.trim() }));
            }

            const secretKey = 'key_' + Math.random().toString(36).substr(2, 9);
            localStorage.setItem('owner_' + name, secretKey);

            const newQuiz = { id: 'local_' + Date.now(), name: name, tracks: tracks };
            APP.library.push(newQuiz);
            saveAppData();

            if (db) {
                try {
                    const { data, error } = await db.from('quizzes').insert([{ name: name, tracks: tracks, secret_key: secretKey }]).select();
                    if (error) throw error;
                    if (data && data[0]) {
                        newQuiz.id = 'cloud_' + data[0].id;
                        saveAppData();
                    }
                    alert(`✅ Викторина "${name}" сохранена!\nКодовое слово: ${secretKey}`);
                } catch (err) { alert(`✅ Викторина сохранена локально (${err.message})`); }
            } else { alert('✅ Викторина сохранена локально'); }

            addForm.classList.add('hidden');
            showAddBtn.textContent = '➕ Добавить викторину';
            document.getElementById('newQuizName').value = '';
            document.getElementById('trackFiles').value = '';
            document.getElementById('gdriveLink').value = '';
            document.getElementById('gdriveResult').classList.add('hidden');
            document.getElementById('fileInput').value = '';
            window.scannedGdriveTracks = null;
            renderLibrary();
        } catch (err) { alert('❌ Ошибка: ' + err.message); }
        finally { saveBtn.textContent = '💾 Сохранить'; saveBtn.disabled = false; }
    });
}

// ============================================
// ===== ЗАГРУЗКА ИЗ ОБЛАКА =====
// ============================================
const loadSharedBtn = document.getElementById('loadSharedBtn');
if (loadSharedBtn) {
    loadSharedBtn.addEventListener('click', async function() {
        const link = document.getElementById('sharedLink').value.trim();
        if (!link) { alert('Вставьте ссылку'); return; }
        let quizId = null;
        try { quizId = new URL(link).searchParams.get('quiz'); } catch(e) { quizId = link; }
        if (!quizId) { alert('Не найден ID'); return; }
        const cleanId = quizId.startsWith('cloud_') ? quizId.replace('cloud_', '') : quizId;

        document.getElementById('sharedProgress').classList.remove('hidden');
        document.getElementById('sharedResult').classList.add('hidden');
        this.disabled = true;

        try {
            const { data, error } = await db.from('quizzes').select('*').eq('id', cleanId).single();
            if (error) throw error;
            if (data) {
                const newQuiz = { id: 'cloud_' + data.id, name: data.name, tracks: data.tracks || [] };
                APP.library.push(newQuiz);
                saveAppData();
                document.getElementById('sharedResult').innerHTML = `<span style="color:green;">✅ Викторина "${newQuiz.name}" загружена!</span>`;
                document.getElementById('sharedResult').classList.remove('hidden');
                setTimeout(() => { document.querySelector('#libraryTabs button[data-tab="my"]').click(); }, 1000);
            }
        } catch (err) {
            document.getElementById('sharedResult').innerHTML = `<span style="color:red;">❌ Ошибка: ${err.message}</span>`;
            document.getElementById('sharedResult').classList.remove('hidden');
        } finally {
            document.getElementById('sharedProgress').classList.add('hidden');
            this.disabled = false;
        }
    });
}

// ============================================
// ===== ПОДГОТОВКА =====
// ============================================
function renderPrepareSelect() {
    const select = document.getElementById('prepareSelect');
    if (!select) return;
    select.innerHTML = '<option value="">— выбери викторину —</option>';
    APP.library.forEach(q => {
        select.innerHTML += `<option value="${q.id}">${q.name} (${q.tracks.length})</option>`;
    });
}

const prepSelect = document.getElementById('prepareSelect');
if (prepSelect) {
    prepSelect.addEventListener('change', function() {
        const quizId = this.value;
        const quiz = APP.library.find(q => q.id === quizId);
        if (!quiz) return;

        const container = document.getElementById('trackListPrepare');
        container.innerHTML = quiz.tracks.map((t, i) => `
            <div class="item" style="padding:10px 0; border-bottom:1px solid var(--border);">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <span>${i+1}. ${t.title}</span>
                    <button class="btn btn-sm btn-secondary" onclick="playPrep('${t.file}')">▶</button>
                </div>
            </div>
        `).join('');

        const gotoBtn = document.getElementById('gotoQuizBtn');
        gotoBtn.style.display = 'block';
        gotoBtn.dataset.quizId = quizId;
    });
}

window.playPrep = function(url) {
    const audio = document.getElementById('playerAudio');
    if (audio) { audio.src = url; audio.play().catch(()=>{}); }
};

const gotoQuizBtn = document.getElementById('gotoQuizBtn');
if (gotoQuizBtn) {
    gotoQuizBtn.addEventListener('click', function() {
        if (this.dataset.quizId) window.location.href = 'quiz.html?id=' + this.dataset.quizId;
    });
}

// ============================================
// ===== ВИКТОРИНА =====
// ============================================
function renderQuizSelect() {
    const select = document.getElementById('quizSelect');
    if (!select) return;
    select.innerHTML = '<option value="">— выбери викторину —</option>';
    APP.library.forEach(q => {
        select.innerHTML += `<option value="${q.id}">${q.name} (${q.tracks.length})</option>`;
    });

    const urlParams = new URLSearchParams(window.location.search);
    const urlId = urlParams.get('id');
    if (urlId && APP.library.some(q => q.id === urlId)) select.value = urlId;
}

const startBtn = document.getElementById('startQuizBtn');
if (startBtn) {
    startBtn.addEventListener('click', function() {
        const quizId = document.getElementById('quizSelect').value;
        if (!quizId) { alert('Выберите викторину'); return; }
        const quiz = APP.library.find(q => q.id === quizId);
        if (!quiz) return;

        Q.quizId = quizId;
        Q.questions = [...quiz.tracks].sort(() => Math.random() - 0.5);
        Q.currentIndex = 0;
        Q.correctCount = 0;
        Q.totalQuestions = Q.questions.length;

        document.getElementById('quizSetup').classList.add('hidden');
        document.getElementById('gameScreen').classList.remove('hidden');
        showQuestion();
    });
}

function showQuestion() {
    if (Q.currentIndex >= Q.totalQuestions) { finishQuiz(); return; }
    const q = Q.questions[Q.currentIndex];
    document.getElementById('questionNum').textContent = `Вопрос ${Q.currentIndex + 1} из ${Q.totalQuestions}`;
    
    const audio = document.getElementById('gameAudio');
    audio.src = q.file;
    audio.play().catch(()=>{});

    document.getElementById('gameQuestion').innerHTML = `
        <div class="card">
            <p style="margin-bottom:10px; font-weight:600;">Введите название:</p>
            <input type="text" id="answerInput" class="input-field" placeholder="Ответ...">
        </div>
    `;
    document.getElementById('submitBtn').onclick = function() {
        const userAnswer = document.getElementById('answerInput').value.trim().toLowerCase();
        const correct = q.title.toLowerCase();
        if (userAnswer === correct) { Q.correctCount++; alert('✅ Правильно!'); }
        else { alert('❌ Неправильно! Ответ: ' + q.title); }
        Q.currentIndex++;
        showQuestion();
    };
}

function finishQuiz() {
    document.getElementById('gameScreen').classList.add('hidden');
    document.getElementById('finalScreen').classList.remove('hidden');
    const percent = Math.round((Q.correctCount / Q.totalQuestions) * 100);
    document.getElementById('finalContent').innerHTML = `
        <div class="card" style="text-align:center;">
            <h2>Результат: ${percent}%</h2>
            <p>${Q.correctCount} из ${Q.totalQuestions}</p>
            <button class="btn btn-primary" onclick="location.reload()">Ещё раз</button>
        </div>
    `;
}

// ============================================
// ===== РЕЗУЛЬТАТЫ =====
// ============================================
function renderResults() {
    const container = document.getElementById('resultsList');
    if (!container) return;
    if (APP.results.length === 0) {
        container.innerHTML = `<div class="card" style="text-align:center;padding:20px;">📭 Нет результатов</div>`;
        return;
    }
    container.innerHTML = APP.results.map(r => `<div class="card">${r.quizName}: ${r.percent}%</div>`).join('');
}

// ============================================
// ===== НАСТРОЙКИ =====
// ============================================
function renderSettings() {
    const nameEl = document.getElementById('settingsName');
    if (nameEl) nameEl.textContent = APP.user.name || '—';
    const themeSelect = document.getElementById('themeSelect');
    if (themeSelect) themeSelect.value = APP.settings.theme;
}

// ============================================
// ===== ЗАПУСК =====
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    loadAppData();
    applyTheme();

    if (document.getElementById('page-library')) { checkOnboarding(); if (APP.user.name) renderLibrary(); }
    if (document.getElementById('page-prepare')) { renderPrepareSelect(); }
    if (document.getElementById('page-quiz')) { renderQuizSelect(); }
    if (document.getElementById('page-results')) { renderResults(); }
    if (document.getElementById('page-settings')) { renderSettings(); }
});

console.log('🎵 MuQwiz загружен!');
