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

    if (!folderId) throw new Error('Не удалось извлечь ID папки из ссылки');

    const url = `https://www.googleapis.com/drive/v3/files?q='${folderId}'+in+parents+and+trashed=false&key=${GOOGLE_API_KEY}&fields=files(id,name,mimeType)&supportsAllDrives=true&includeItemsFromAllDrives=true`;

    const response = await fetch(url);
    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Ошибка API Google: ${errorData.error?.message || response.status}`);
    }

    const data = await response.json();
    const files = data.files || [];

    const mp3Files = files.filter(f =>
        f.name.toLowerCase().endsWith('.mp3') || f.mimeType === 'audio/mpeg'
    );

    return mp3Files.map(f => ({
        title: f.name.replace(/\.mp3$/i, '').replace(/[_-]/g, ' '),
        file: `https://drive.google.com/uc?export=download&id=${f.id}`
    }));
}

// ============================================
// ===== ЗАГРУЗКА И СОХРАНЕНИЕ =====
// ============================================
function saveAppData() {
    try {
        localStorage.setItem('muqwiz_data', JSON.stringify(APP));
    } catch(e) { console.warn('Ошибка сохранения', e); }
}

function loadAppData() {
    try {
        const raw = localStorage.getItem('muqwiz_data');
        if (raw) {
            const data = JSON.parse(raw);
            Object.assign(APP, data);
        }
    } catch(e) { console.warn('Ошибка загрузки', e); }
}

// ============================================
// ===== ПРОВЕРКА ОПРОСНИКА =====
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
        try {
            const name = document.getElementById('userName').value.trim();
            if (!name) { alert('Введите имя'); return; }
            APP.user.name = name;
            saveAppData();
            
            document.getElementById('onboarding').classList.add('hidden');
            document.getElementById('app').classList.remove('hidden');
            
            applyTheme();
            renderLibrary(); 
        } catch (err) {
            console.error("Ошибка при входе:", err);
        }
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

    let filtered = [];
    if (currentTab === 'favorites') {
        filtered = APP.library.filter(q => APP.favorites.includes(q.id));
    } else {
        filtered = APP.library;
    }

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
                <button class="heart ${APP.favorites.includes(q.id) ? 'liked' : ''}" 
                        onclick="event.stopPropagation(); toggleFavorite('${q.id}')">
                    ${APP.favorites.includes(q.id) ? '❤️' : '🤍'}
                </button>
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
// ===== ДЕТАЛЬНАЯ КАРТОЧКА =====
// ============================================
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
                <button class="btn btn-sm btn-gold" id="detailFavorite">${isFav ? '❤️' : '🤍'} Избранное</button>
                <button class="btn btn-sm btn-primary" id="detailQuiz">🎯 Викторина</button>
                <button class="btn btn-sm btn-secondary" id="detailShare">🔗 Поделиться</button>
                <button class="btn btn-sm btn-secondary" id="detailEdit">✏️ Редактировать</button>
                <button class="btn btn-sm btn-danger" id="detailDelete">🗑️ Удалить</button>
            </div>

            <div class="track-list">
                ${quiz.tracks.map((t, i) => `
                    <div class="track-item">
                        <span class="title">${i+1}. ${t.title}</span>
                        <span>${t.file ? '🎵' : ''}</span>
                    </div>
                `).join('')}
            </div>

            <button class="btn btn-secondary" id="detailBack" style="margin-top:12px;">← Назад</button>
        </div>
    `;

    document.getElementById('detailBack').addEventListener('click', () => {
        if (showAddBtn) showAddBtn.classList.remove('hidden');
        renderLibrary();
    });

    document.getElementById('detailFavorite').addEventListener('click', () => {
        const idx = APP.favorites.indexOf(quizId);
        if (idx > -1) APP.favorites.splice(idx, 1);
        else APP.favorites.push(quizId);
        saveAppData();
        showQuizDetail(quizId);
    });

    document.getElementById('detailQuiz').addEventListener('click', () => {
        window.location.href = 'quiz.html?id=' + quizId;
    });

    // Безопасная кнопка "Поделиться"
    document.getElementById('detailShare').addEventListener('click', () => {
        const cleanId = quizId.startsWith('cloud_') ? quizId.replace('cloud_', '') : quizId;
        const url = window.location.origin + window.location.pathname + '?quiz=' + cleanId;

        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(url).then(() => {
                alert('✅ Ссылка скопирована! Можешь отправить её другу:\n' + url);
            }).catch(() => {
                prompt('Скопируй ссылку вручную:', url);
            });
        } else {
            prompt('Скопируй ссылку вручную:', url);
        }
    });

    document.getElementById('detailEdit').addEventListener('click', () => {
        const newName = prompt('Введите новое название викторины:', quiz.name);
        if (newName && newName.trim()) {
            quiz.name = newName.trim();
            saveAppData();
            showQuizDetail(quizId);
        }
    });

    document.getElementById('detailDelete').addEventListener('click', () => {
        if (confirm(`Удалить викторину "${quiz.name}"?`)) {
            APP.library = APP.library.filter(q => q.id !== quizId);
            APP.favorites = APP.favorites.filter(id => id !== quizId);
            saveAppData();
            renderLibrary();
            if (showAddBtn) showAddBtn.classList.remove('hidden');
        }
    });
}

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
        document.getElementById('newQuizName').value = '';
        document.getElementById('trackFiles').value = '';
        document.getElementById('gdriveLink').value = '';
        document.getElementById('gdriveResult').classList.add('hidden');
        document.getElementById('fileInput').value = '';
    });

    // Переключение полей
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
            if (!link) { alert('Введите ссылку на папку Google Диска'); return; }

            document.getElementById('gdriveProgress').classList.remove('hidden');
            document.getElementById('gdriveResult').classList.add('hidden');
            this.disabled = true;

            try {
                const tracks = await scanGoogleDrive(link);
                document.getElementById('gdriveResult').innerHTML = `<span style="color:green;">✅ Найдено ${tracks.length} MP3 файлов!</span>`;
                document.getElementById('gdriveResult').classList.remove('hidden');
                window.scannedGdriveTracks = tracks;
            } catch (err) {
                console.error(err);
                document.getElementById('gdriveResult').innerHTML = `<span style="color:red;">❌ Ошибка: ${err.message}</span>`;
                document.getElementById('gdriveResult').classList.remove('hidden');
            } finally {
                document.getElementById('gdriveProgress').classList.add('hidden');
                this.disabled = false;
            }
        });
    }

    // СОХРАНЕНИЕ (с загрузкой в Storage)
    document.getElementById('saveQuizBtn').addEventListener('click', async () => {
        const name = document.getElementById('newQuizName').value.trim();
        const method = document.getElementById('addMethod').value;

        if (!name) { alert('Введите название викторины'); return; }

        let tracks = [];
        const saveBtn = document.getElementById('saveQuizBtn');
        const originalText = saveBtn.textContent;
        saveBtn.textContent = '⏳ Обработка...';
        saveBtn.disabled = true;

        try {
            if (method === 'files') {
                const fileInput = document.getElementById('fileInput');
                const files = fileInput.files;

                if (!files || files.length === 0) {
                    alert('Выберите MP3 файлы');
                    saveBtn.textContent = originalText;
                    saveBtn.disabled = false;
                    return;
                }

                // Загружаем каждый файл в Supabase Storage
                for (let i = 0; i < files.length; i++) {
                    const file = files[i];
                    const fileExt = file.name.split('.').pop();
                    const fileName = `${Date.now()}_${i}.${fileExt}`;
                    const filePath = `${fileName}`;

                    const { data, error } = await db.storage
                        .from('music')
                        .upload(filePath, file, { cacheControl: '3600', upsert: false });

                    if (error) throw error;

                    const { data: urlData } = db.storage
                        .from('music')
                        .getPublicUrl(filePath);

                    tracks.push({
                        title: file.name.replace(/\.mp3$/i, ''),
                        file: urlData.publicUrl
                    });
                }

            } else if (method === 'gdrive') {
                if (!window.scannedGdriveTracks || window.scannedGdriveTracks.length === 0) {
                    alert('Сначала отсканируйте папку Google Диска');
                    saveBtn.textContent = originalText;
                    saveBtn.disabled = false;
                    return;
                }
                tracks = window.scannedGdriveTracks;

            } else {
                const filesText = document.getElementById('trackFiles').value.trim();
                if (!filesText) { alert('Введите ссылки на MP3'); saveBtn.textContent = originalText; saveBtn.disabled = false; return; }
                
                const fileUrls = filesText.split('\n').map(s => s.trim()).filter(s => s);
                if (fileUrls.length === 0) { alert('Введите хотя бы одну ссылку'); saveBtn.textContent = originalText; saveBtn.disabled = false; return; }
                
                tracks = fileUrls.map((url, i) => ({
                    title: `Трек ${i + 1}`,
                    file: url
                }));
            }

            const newQuiz = {
                id: 'local_' + Date.now(),
                name: name,
                section: 'my',
                tracks: tracks
            };
            APP.library.push(newQuiz);
            saveAppData();

            if (db) {
                try {
                    const { data, error } = await db.from('quizzes').insert([
                        { name: name, tracks: tracks }
                    ]).select();

                    if (error) throw error;

                    if (data && data[0]) {
                        newQuiz.id = 'cloud_' + data[0].id;
                        saveAppData();
                    }
                    alert(`✅ Викторина "${name}" сохранена в облаке!`);
                } catch (err) {
                    console.warn('⚠️ Не удалось сохранить в облако:', err.message);
                    alert(`✅ Викторина "${name}" сохранена локально`);
                }
            } else {
                alert(`✅ Викторина "${name}" сохранена локально`);
            }

            // Сброс формы
            addForm.classList.add('hidden');
            showAddBtn.textContent = '➕ Добавить викторину';
            document.getElementById('newQuizName').value = '';
            document.getElementById('trackFiles').value = '';
            document.getElementById('gdriveLink').value = '';
            document.getElementById('gdriveResult').classList.add('hidden');
            document.getElementById('fileInput').value = '';
            window.scannedGdriveTracks = null;

            renderLibrary();

        } catch (err) {
            console.error(err);
            alert('❌ Ошибка при загрузке файлов: ' + err.message);
        } finally {
            saveBtn.textContent = originalText;
            saveBtn.disabled = false;
        }
    });
}

// ============================================
// ===== ЗАГРУЗКА ИЗ ОБЛАКА (вкладка "Загруженное") =====
// ============================================
const loadSharedBtn = document.getElementById('loadSharedBtn');
if (loadSharedBtn) {
    loadSharedBtn.addEventListener('click', async function() {
        const link = document.getElementById('sharedLink').value.trim();
        if (!link) { alert('Вставьте ссылку'); return; }

        let quizId = null;
        try {
            const url = new URL(link);
            quizId = url.searchParams.get('quiz');
        } catch (e) {
            quizId = link; 
        }

        if (!quizId) { alert('Не удалось найти ID викторины в ссылке'); return; }

        const cleanId = quizId.startsWith('cloud_') ? quizId.replace('cloud_', '') : quizId;

        document.getElementById('sharedProgress').classList.remove('hidden');
        document.getElementById('sharedResult').classList.add('hidden');
        this.disabled = true;

        try {
            const existsLocal = APP.library.some(q => q.id === 'cloud_' + cleanId);
            if (existsLocal) {
                document.getElementById('sharedResult').innerHTML = '<span style="color:orange;">⚠️ Эта викторина уже есть в вашей библиотеке.</span>';
                document.getElementById('sharedResult').classList.remove('hidden');
                document.getElementById('sharedProgress').classList.add('hidden');
                this.disabled = false;
                return;
            }

            if (!db) throw new Error('Нет подключения к базе данных');

            const { data, error } = await db
                .from('quizzes')
                .select('*')
                .eq('id', cleanId)
                .single();

            if (error) throw error;

            if (data) {
                const newQuiz = {
                    id: 'cloud_' + data.id,
                    name: data.name,
                    section: 'my',
                    tracks: data.tracks || []
                };

                APP.library.push(newQuiz);
                saveAppData();
                
                document.getElementById('sharedResult').innerHTML = `<span style="color:green;">✅ Викторина "${newQuiz.name}" загружена!</span>`;
                document.getElementById('sharedResult').classList.remove('hidden');
                
                setTimeout(() => {
                    document.querySelector('#libraryTabs button[data-tab="my"]').click();
                }, 1000);
            } else {
                throw new Error('Викторина не найдена');
            }
        } catch (err) {
            console.error(err);
            document.getElementById('sharedResult').innerHTML = `<span style="color:red;">❌ Ошибка: ${err.message}</span>`;
            document.getElementById('sharedResult').classList.remove('hidden');
        } finally {
            document.getElementById('sharedProgress').classList.add('hidden');
            this.disabled = false;
        }
    });
}

// ============================================
// ===== ЗАПУСК =====
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    loadAppData();
    applyTheme();

    if (document.getElementById('page-library')) {
        checkOnboarding();
        if (APP.user.name) renderLibrary();
    }
});

console.log('🎵 MuQwiz загружен!');
