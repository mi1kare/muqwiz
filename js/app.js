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
    const addForm = document.getElementById('addForm');
    const showAddBtn = document.getElementById('showAddForm');
    if (!container) return;

    if (currentTab === 'shared') {
        container.classList.add('hidden');
        sharedTab.classList.remove('hidden');
        if (addForm) addForm.classList.add('hidden');
        if (showAddBtn) showAddBtn.classList.add('hidden');
        return;
    } else {
        container.classList.remove('hidden');
        sharedTab.classList.add('hidden');
        if (showAddBtn) showAddBtn.classList.remove('hidden');
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

function showQuizDetail(quizId) {
    const quiz = APP.library.find(q => q.id === quizId);
    if (!quiz) return;

    const container = document.getElementById('libraryContent');
    const isFav = APP.favorites.includes(quizId);
    const showAddBtn = document.getElementById('showAddForm');
    if (showAddBtn) showAddBtn.classList.add('hidden');

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

    const container = document.getElementById('libraryContent');
    
    // Отрисовываем интерфейс редактора
    container.innerHTML = `
        <div class="quiz-detail">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
                <span style="font-size:20px;font-weight:700;">✏️ Редактировать викторину</span>
                <button class="btn btn-sm btn-secondary" onclick="showQuizDetail('${quizId}')">✖ Закрыть</button>
            </div>

            <div class="form-group">
                <label>Название викторины</label>
                <input type="text" class="input-field" id="editorQuizName" value="${quiz.name}">
            </div>

            <div style="margin:12px 0;font-weight:600;">Треки (${quiz.tracks.length})</div>
            <div id="editorTrackList">
                ${quiz.tracks.map((t, i) => `
                    <div class="edit-track-item" style="display:flex; gap:10px; margin-bottom:8px;">
                        <input type="text" class="input-field track-title-edit" data-index="${i}" value="${t.title}" style="flex:1; padding:8px 12px;">
                        <button class="btn btn-sm btn-danger remove-track-btn" data-index="${i}">✖</button>
                    </div>
                `).join('')}
            </div>

            <div style="margin-top:16px;">
                <button class="btn btn-primary" id="editorSaveBtn">💾 Сохранить</button>
                <button class="btn btn-secondary" onclick="showQuizDetail('${quizId}')" style="margin-top:8px;">Отмена</button>
            </div>
        </div>
    `;

    // Обработчик удаления трека
    container.querySelectorAll('.remove-track-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const idx = parseInt(this.dataset.index);
            if (confirm(`Удалить трек "${quiz.tracks[idx].title}"?`)) {
                quiz.tracks.splice(idx, 1);
                saveAppData();
                window.editQuizName(quizId); // Перерисовываем редактор
            }
        });
    });

    // Обработчик сохранения изменений
    document.getElementById('editorSaveBtn').addEventListener('click', async function() {
        const newName = document.getElementById('editorQuizName').value.trim();
        if (!newName) { alert('Введите название викторины'); return; }

        // Собираем новые названия треков из полей
        const titleInputs = container.querySelectorAll('.track-title-edit');
        titleInputs.forEach(inp => {
            const idx = parseInt(inp.dataset.index);
            if (quiz.tracks[idx]) {
                quiz.tracks[idx].title = inp.value.trim() || 'Без названия';
            }
        });

        quiz.name = newName;
        saveAppData();

        // Если викторина в облаке — обновляем её в базе
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

        showQuizDetail(quizId); // Возвращаемся к деталям
    });
};

window.deleteQuiz = function(quizId) {
    if (confirm('Удалить викторину?')) {
        APP.library = APP.library.filter(q => q.id !== quizId);
        APP.favorites = APP.favorites.filter(id => id !== quizId);
        saveAppData();
        renderLibrary();
        document.getElementById('showAddForm').classList.remove('hidden');
    }
};

// Обработчики вкладок
document.querySelectorAll('#libraryTabs button').forEach(btn => {
    btn.addEventListener('click', function() {
        document.querySelectorAll('#libraryTabs button').forEach(b => b.classList.remove('active'));
        this.classList.add('active');
        currentTab = this.dataset.tab;
        renderLibrary();
    });
});

// ============================================
// ===== ФОРМА ДОБАВЛЕНИЯ (с загрузкой файлов и Google Диском) =====
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

    // Переключение способов
    const addMethodSelect = document.getElementById('addMethod');
    const fileDiv = document.getElementById('addMethodFiles');
    const gdriveDiv = document.getElementById('addMethodGdrive');
    const manualDiv = document.getElementById('addMethodManual');

    if (addMethodSelect) {
        addMethodSelect.addEventListener('change', function() {
            fileDiv.classList.add('hidden');
            gdriveDiv.classList.add('hidden');
            manualDiv.classList.add('hidden');
            if (this.value === 'files') fileDiv.classList.remove('hidden');
            if (this.value === 'gdrive') gdriveDiv.classList.remove('hidden');
            if (this.value === 'manual') manualDiv.classList.remove('hidden');
        });
    }

    // Сканирование Google Диска
    const scanBtn = document.getElementById('scanGdriveBtn');
    if (scanBtn) {
        scanBtn.addEventListener('click', async function() {
            const link = document.getElementById('gdriveLink').value.trim();
            if (!link) { alert('Введите ссылку'); return; }
            document.getElementById('gdriveProgress').classList.remove('hidden');
            this.disabled = true;
            try {
                const tracks = await scanGoogleDrive(link);
                document.getElementById('gdriveResult').innerHTML = `<span style="color:green;">✅ Найдено ${tracks.length} MP3!</span>`;
                document.getElementById('gdriveResult').classList.remove('hidden');
                window.scannedGdriveTracks = tracks;
            } catch (err) {
                document.getElementById('gdriveResult').innerHTML = `<span style="color:red;">❌ Ошибка: ${err.message}</span>`;
                document.getElementById('gdriveResult').classList.remove('hidden');
            } finally {
                document.getElementById('gdriveProgress').classList.add('hidden');
                this.disabled = false;
            }
        });
    }

    // Сохранение викторины
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
                const files = document.getElementById('fileInput').files;
                if (!files || files.length === 0) { alert('Выберите файлы'); saveBtn.textContent = '💾 Сохранить'; saveBtn.disabled = false; return; }
                for (let i = 0; i < files.length; i++) {
                    const file = files[i];
                    const fileExt = file.name.split('.').pop();
                    const fileName = `${Date.now()}_${i}.${fileExt}`;
                    const { error } = await db.storage.from('music').upload(fileName, file);
                    if (error) throw error;
                    const { data: urlData } = db.storage.from('music').getPublicUrl(fileName);
if (!urlData || !urlData.publicUrl) {
    throw new Error('Не удалось получить ссылку на файл. Проверьте Storage.');
}
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
// ===== ЗАГРУЗКА ИЗ ОБЛАКА (Загруженное) =====
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
let prepareQuizId = null;
let prepareTrackIndex = 0;
let prepareShuffle = false;

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

function renderPrepareTracks(quiz) {
    const container = document.getElementById('trackListPrepare');
    if (!container) return;
    if (!quiz.tracks || quiz.tracks.length === 0) {
        container.innerHTML = '<div style="text-align:center;color:var(--text-secondary);padding:20px;">Нет треков</div>';
        return;
    }

    // Отрисовываем треки с полями для заметок
    container.innerHTML = quiz.tracks.map((t, i) => {
        const noteKey = quiz.id + '_' + i;
        const savedNote = APP.notes[noteKey] || '';
        
        return `
            <div class="item" style="padding:10px 0; border-bottom:1px solid var(--border); ${i === prepareTrackIndex ? 'background:var(--border); border-radius:8px;' : ''}">
                <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
                    <span style="flex:1; font-weight:500;">${i+1}. ${t.title}</span>
                    <input type="text" class="note-input" data-key="${noteKey}" placeholder="Заметка..." value="${savedNote}" style="width:120px; padding:4px 8px; border-radius:20px; border:1px solid var(--border);">
                    <button class="btn btn-sm btn-secondary" onclick="playPrepareTrackById('${quiz.id}', ${i})">▶</button>
                </div>
            </div>
        `;
    }).join('');

    // Сохраняем заметки при изменении
    container.querySelectorAll('.note-input').forEach(inp => {
        inp.addEventListener('change', function() {
            APP.notes[this.dataset.key] = this.value;
            saveAppData();
        });
    });
}

function playPrepareTrack(quiz, index) {
    if (!quiz || !quiz.tracks || quiz.tracks.length === 0) return;
    
    if (prepareShuffle) {
        prepareTrackIndex = Math.floor(Math.random() * quiz.tracks.length);
    } else {
        prepareTrackIndex = index % quiz.tracks.length;
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

window.playPrepareTrackById = function(quizId, index) {
    const quiz = APP.library.find(q => q.id === quizId);
    if (quiz) playPrepareTrack(quiz, index);
};

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

const playShuffle = document.getElementById('playShuffle');
if (playShuffle) {
    playShuffle.addEventListener('click', function() {
        prepareShuffle = !prepareShuffle;
        this.textContent = prepareShuffle ? '🔀 Вкл' : '🔀 Перемешать';
        const quiz = APP.library.find(q => q.id === prepareQuizId);
        if (quiz) playPrepareTrack(quiz, 0);
    });
}

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

document.querySelectorAll('.level-btn').forEach(btn => {
    btn.addEventListener('click', function() {
        document.querySelectorAll('.level-btn').forEach(b => b.classList.remove('selected'));
        this.classList.add('selected');
    });
});

const startQuizBtn = document.getElementById('startQuizBtn');
if (startQuizBtn) {
    startQuizBtn.addEventListener('click', function() {
        const quizId = document.getElementById('quizSelect').value;
        if (!quizId) { alert('Выберите викторину'); return; }
        const quiz = APP.library.find(q => q.id === quizId);
        if (!quiz || !quiz.tracks || quiz.tracks.length === 0) { alert('Нет треков'); return; }

        const selectedBtn = document.querySelector('.level-btn.selected');
        const level = selectedBtn ? selectedBtn.dataset.level : 'easy';
        const count = parseInt(document.getElementById('quizCount').value) || 10;

        let timeLimit = 90, hintLimit = 3, fromStart = true;
        if (level === 'medium') { timeLimit = 60; hintLimit = 3; fromStart = true; }
        if (level === 'hard') { timeLimit = 45; hintLimit = 1; fromStart = false; }

        let tracks = [...quiz.tracks].sort(() => Math.random() - 0.5);
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

function showQuestion() {
    if (Q.currentIndex >= Q.totalQuestions) { finishQuiz(); return; }
    Q.answered = false;
    const q = Q.questions[Q.currentIndex];
    document.getElementById('questionNum').textContent = `Вопрос ${Q.currentIndex + 1} из ${Q.totalQuestions}`;
    document.getElementById('hintBtn').textContent = `💡 Подсказка (${Q.hintCount})`;
    document.getElementById('hintBtn').disabled = Q.hintCount <= 0;

    Q.timeLeft = Q.timeLimit;
    updateTimerDisplay();
    if (Q.timer) clearInterval(Q.timer);
    Q.timer = setInterval(timerTick, 1000);

    const audio = document.getElementById('gameAudio');
    audio.src = q.file;
    audio.load();
    audio.oncanplay = function() {
        if (!Q.fromStart && audio.duration > 10) {
            audio.currentTime = audio.duration * (0.3 + Math.random() * 0.4);
        }
        audio.play().catch(() => {});
    };

    const container = document.getElementById('gameQuestion');
    if (Q.level === 'easy') {
        renderEasyQuestion(container, q);
    } else {
        renderInputQuestion(container);
    }
    document.getElementById('gameFeedback').innerHTML = '';
    document.getElementById('submitBtn').disabled = false;
    document.getElementById('nextBtn')?.classList.add('hidden');
}

function renderEasyQuestion(container, q) {
    const allTitles = Q.questions.map(item => item.title);
    const correct = q.title;
    let wrongs = allTitles.filter(t => t !== correct);
    for (let i = wrongs.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [wrongs[i], wrongs[j]] = [wrongs[j], wrongs[i]];
    }
    wrongs = wrongs.slice(0, 3);
    while (wrongs.length < 3) wrongs.push('Другой вариант');
    const options = [correct, ...wrongs].sort(() => Math.random() - 0.5);
    container.innerHTML = `
        <p style="font-weight:600;margin-bottom:10px;">Выбери правильное название:</p>
        <div class="game-options" id="optionsContainer">
            ${options.map(opt => `<button class="option-btn" data-value="${opt}">${opt}</button>`).join('')}
        </div>
    `;
    container.querySelectorAll('.option-btn').forEach(btn => {
        btn.addEventListener('click', function() {
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
    document.getElementById('submitBtn').classList.add('hidden');
}

function renderInputQuestion(container) {
    container.innerHTML = `
        <p style="font-weight:600;margin-bottom:10px;">Введите название произведения:</p>
        <input type="text" class="game-input" id="answerInput" placeholder="Введите ответ...">
    `;
    document.getElementById('submitBtn').classList.remove('hidden');
    document.getElementById('submitBtn').disabled = false;
    const input = document.getElementById('answerInput');
    if (input) {
        input.value = '';
        input.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') document.getElementById('submitBtn').click();
        });
    }
}

document.getElementById('submitBtn')?.addEventListener('click', function() {
    if (Q.answered) return;
    const input = document.getElementById('answerInput');
    if (!input) return;
    const userAnswer = input.value.trim();
    if (!userAnswer) { alert('Введите ответ'); return; }
    const correct = Q.questions[Q.currentIndex].title;
    const isCorrect = userAnswer.toLowerCase().replace(/\s+/g, ' ') === correct.toLowerCase().replace(/\s+/g, ' ');
    handleAnswer(isCorrect);
});

function handleAnswer(isCorrect) {
    if (Q.answered) return;
    Q.answered = true;
    if (Q.timer) { clearInterval(Q.timer); Q.timer = null; }
    const q = Q.questions[Q.currentIndex];
    const feedback = document.getElementById('gameFeedback');
    if (isCorrect) {
        Q.correctCount++;
        feedback.innerHTML = `<div class="game-feedback correct">✅ Правильно! Это "${q.title}"</div>`;
    } else {
        Q.wrongTitles.push(q.title);
        feedback.innerHTML = `<div class="game-feedback wrong">❌ Неправильно! Правильный ответ: «${q.title}»</div>`;
    }
    let nextBtn = document.getElementById('nextBtn');
    if (!nextBtn) {
        nextBtn = document.createElement('button');
        nextBtn.id = 'nextBtn';
        nextBtn.className = 'btn btn-primary';
        nextBtn.style.marginTop = '10px';
        nextBtn.textContent = '⏭ Далее';
        nextBtn.onclick = function() { Q.currentIndex++; showQuestion(); };
        feedback.after(nextBtn);
    }
    nextBtn.classList.remove('hidden');
    document.getElementById('submitBtn').disabled = true;
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
            document.getElementById('gameFeedback').innerHTML = 
                `<div class="game-feedback wrong">⏰ Время вышло! Правильный ответ: «${q.title}»</div>`;
            document.getElementById('submitBtn').disabled = true;
            let nextBtn = document.getElementById('nextBtn');
            if (!nextBtn) {
                nextBtn = document.createElement('button');
                nextBtn.id = 'nextBtn';
                nextBtn.className = 'btn btn-primary';
                nextBtn.style.marginTop = '10px';
                nextBtn.textContent = '⏭ Далее';
                nextBtn.onclick = function() { Q.currentIndex++; showQuestion(); };
                document.getElementById('gameFeedback').after(nextBtn);
            }
            nextBtn.classList.remove('hidden');
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

document.getElementById('hintBtn')?.addEventListener('click', function() {
    if (Q.hintCount <= 0 || Q.answered) return;
    Q.hintCount--;
    this.textContent = `💡 Подсказка (${Q.hintCount})`;
    if (Q.hintCount <= 0) this.disabled = true;
    const q = Q.questions[Q.currentIndex];
    let hint = '';
    if (Q.level === 'easy') {
        const container = document.getElementById('optionsContainer');
        const buttons = container.querySelectorAll('.option-btn');
        const correct = q.title;
        let wrongs = [];
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
        hint = words.length > 0 ? `📝 Первое слово: "${words[0]}"` : `📝 Первая буква: "${q.title.charAt(0)}"`;
    }
    document.getElementById('gameFeedback').innerHTML = `<div class="game-feedback hint">💡 ${hint}</div>`;
});

function finishQuiz() {
    if (Q.isFinished) return;
    Q.isFinished = true;
    if (Q.timer) clearInterval(Q.timer);
    document.getElementById('gameScreen').classList.add('hidden');
    const total = Q.totalQuestions;
    const correct = Q.correctCount;
    const percent = total > 0 ? Math.round((correct / total) * 100) : 0;
    const quiz = APP.library.find(q => q.id === Q.quizId);

    APP.results = APP.results || [];
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

    document.getElementById('finalContent').innerHTML = `
        <div class="card" style="text-align:center;">
            <span style="font-size:64px;display:block;">${medal}</span>
            <div style="font-size:32px;font-weight:700;">${title}</div>
            <div style="font-size:48px;font-weight:700;color:var(--accent);">${percent}%</div>
            <div style="font-size:18px;color:var(--text-secondary);">${correct} из ${total} правильных</div>
            ${Q.wrongTitles.length > 0 ? `<div style="margin-top:12px;text-align:left;font-size:14px;">📌 Повтори: ${Q.wrongTitles.join(', ')}</div>` : ''}
        </div>
        <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:12px;">
            <button class="btn btn-primary" onclick="location.href='quiz.html'">🔄 Пройти ещё раз</button>
            <button class="btn btn-secondary" onclick="location.href='results.html'">🏠 Результаты</button>
        </div>
    `;
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
            <div class="date">📅 ${r.date} — ${r.quizName} (${r.level})</div>
            <div class="info">
                <span class="score">${r.correct} из ${r.total}</span>
                <span class="percent">${r.percent}%</span>
            </div>
        </div>
    `).join('');
}

const clearResultsBtn = document.getElementById('clearResultsBtn');
if (clearResultsBtn) {
    clearResultsBtn.addEventListener('click', function() {
        if (confirm('Удалить всю историю результатов?')) {
            APP.results = [];
            saveAppData();
            renderResults();
            alert('✅ История очищена');
        }
    });
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

const editProfileBtn = document.getElementById('editProfileBtn');
if (editProfileBtn) {
    editProfileBtn.addEventListener('click', function() {
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
    themeSelect.addEventListener('change', function() {
        APP.settings.theme = this.value;
        saveAppData();
        document.body.classList.toggle('dark', this.value === 'dark');
    });
}

const clearCacheBtn = document.getElementById('clearCacheBtn');
if (clearCacheBtn) {
    clearCacheBtn.addEventListener('click', function() {
        if (confirm('Очистить кэш?')) {
            if ('caches' in window) {
                caches.keys().then(keys => keys.forEach(key => caches.delete(key)));
            }
            alert('✅ Кэш очищен');
        }
    });
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
