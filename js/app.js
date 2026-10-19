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
    // Извлекаем ID папки из ссылки
    let folderId = null;
    const match = folderLink.match(/\/folders\/([a-zA-Z0-9_-]+)/);
    if (match) {
        folderId = match[1];
    } else {
        const match2 = folderLink.match(/id=([a-zA-Z0-9_-]+)/);
        if (match2) folderId = match2[1];
    }

    if (!folderId) {
        throw new Error('Не удалось извлечь ID папки из ссылки');
    }

    console.log('🔍 Сканируем папку Google Диска:', folderId);

    // Запрос к Google Drive API для получения списка файлов в папке
    const url = `https://www.googleapis.com/drive/v3/files?q='${folderId}'+in+parents+and+trashed=false&key=${GOOGLE_API_KEY}&fields=files(id,name,mimeType)&supportsAllDrives=true&includeItemsFromAllDrives=true`;

    const response = await fetch(url);

    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Ошибка API Google: ${errorData.error?.message || response.status}`);
    }

    const data = await response.json();
    const files = data.files || [];

    console.log('📁 Найдено файлов:', files.length);

    // Фильтруем только MP3
    const mp3Files = files.filter(f =>
        f.name.toLowerCase().endsWith('.mp3') ||
        f.mimeType === 'audio/mpeg'
    );

    console.log('🎵 MP3 файлов:', mp3Files.length);

    return mp3Files.map(f => ({
        title: f.name.replace(/\.mp3$/i, '').replace(/[_-]/g, ' '),
        file: `https://drive.google.com/uc?export=download&id=${f.id}`
    }));
}

// ============================================
// ===== ЗАГРУЗКА И СОХРАНЕНИЕ =====
// ============================================
function saveAppData() {
    localStorage.setItem('muqwiz_data', JSON.stringify(APP));
}

function loadAppData() {
    const raw = localStorage.getItem('muqwiz_data');
    if (raw) {
        const data = JSON.parse(raw);
        Object.assign(APP, data);
    }
}

// ============================================
// ===== ПРОВЕРКА ОПРОСНИКА =====
// ============================================
function checkOnboarding() {
    if (APP.user.name) {
        document.getElementById('onboarding').classList.add('hidden');
        document.getElementById('app').classList.remove('hidden');
        applyTheme();
    } else {
        document.getElementById('onboarding').classList.remove('hidden');
        document.getElementById('app').classList.add('hidden');
    }
}

const onboardingBtn = document.getElementById('onboardingFinish');
if (onboardingBtn) {
    onboardingBtn.addEventListener('click', () => {
        const name = document.getElementById('userName').value.trim();
        if (!name) { alert('Введите имя'); return; }
        APP.user.name = name;
        saveAppData();
        checkOnboarding();
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
    });

    // Переключение способа добавления
    const addMethodSelect = document.getElementById('addMethod');
    const manualDiv = document.getElementById('addMethodManual');
    const gdriveDiv = document.getElementById('addMethodGdrive');

    if (addMethodSelect) {
        addMethodSelect.addEventListener('change', function() {
            if (this.value === 'gdrive') {
                manualDiv.classList.add('hidden');
                gdriveDiv.classList.remove('hidden');
            } else {
                manualDiv.classList.remove('hidden');
                gdriveDiv.classList.add('hidden');
            }
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
                
                // Сохраняем треки в глобальную переменную для сохранения
                window.scannedGdriveTracks = tracks;
                
                if (tracks.length === 0) {
                    document.getElementById('gdriveResult').innerHTML = '<span style="color:orange;">⚠️ MP3 файлы не найдены</span>';
                }
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

    // Сохранение викторины
    document.getElementById('saveQuizBtn').addEventListener('click', async () => {
        const name = document.getElementById('newQuizName').value.trim();
        const method = document.getElementById('addMethod').value;

        if (!name) { alert('Введите название викторины'); return; }

        let tracks = [];

        if (method === 'gdrive') {
            if (!window.scannedGdriveTracks || window.scannedGdriveTracks.length === 0) {
                alert('Сначала отсканируйте папку Google Диска');
                return;
            }
            tracks = window.scannedGdriveTracks;
        } else {
            const filesText = document.getElementById('trackFiles').value.trim();
            if (!filesText) { alert('Введите ссылки на MP3'); return; }
            
            const fileUrls = filesText.split('\n').map(s => s.trim()).filter(s => s);
            if (fileUrls.length === 0) { alert('Введите хотя бы одну ссылку'); return; }
            
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

        // Отправляем в Supabase
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
        window.scannedGdriveTracks = null;

        renderLibrary();
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
// ===== ПОДГОТОВКА =====
// ============================================
let prepareQuizId = null;
let prepareTrackIndex = 0;

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
        if (this.value) {
            prepareQuizId = this.value;
            loadPrepare(this.value);
        }
    });
}

function loadPrepare(quizId) {
    const quiz = APP.library.find(q => q.id === quizId);
    if (!quiz) return;

    prepareTrackIndex = 0;
    renderPrepareTracks(quiz);
    playPrepareTrack(quiz, 0);
    const gotoBtn = document.getElementById('gotoQuizBtn');
    if (gotoBtn) gotoBtn.dataset.quizId = quizId;
}

function renderPrepareTracks(quiz) {
    const container = document.getElementById('trackListPrepare');
    if (!container) return;

    if (!quiz.tracks || quiz.tracks.length === 0) {
        container.innerHTML = '<div style="text-align:center;color:var(--text-secondary);padding:20px;">Нет треков</div>';
        return;
    }

    container.innerHTML = quiz.tracks.map((t, i) => `
        <div class="item" style="${i === prepareTrackIndex ? 'background:var(--border);border-radius:8px;padding:8px 10px;' : ''}">
            <div class="track-row">
                <span class="track-name">${i+1}. ${t.title}</span>
                <div style="display:flex;gap:6px;align-items:center;">
                    <input type="text" class="note-input" data-key="${quiz.id}_${i}" placeholder="Заметка..." value="${APP.notes[quiz.id + '_' + i] || ''}" style="width:120px;">
                    <button class="btn btn-sm btn-secondary" onclick="playPrepareTrack(APP.library.find(q=>q.id==='${quiz.id}'), ${i})">▶</button>
                </div>
            </div>
        </div>
    `).join('');

    container.querySelectorAll('.note-input').forEach(inp => {
        inp.addEventListener('change', function() {
            APP.notes[this.dataset.key] = this.value;
            saveAppData();
        });
    });
}

function playPrepareTrack(quiz, index) {
    if (!quiz || !quiz.tracks || quiz.tracks.length === 0) return;
    prepareTrackIndex = index % quiz.tracks.length;
    const track = quiz.tracks[prepareTrackIndex];
    const audio = document.getElementById('playerAudio');
    if (audio) {
        audio.src = track.file;
        audio.load();
        audio.play().catch(() => {});
    }
    renderPrepareTracks(quiz);
}

const gotoQuizBtn = document.getElementById('gotoQuizBtn');
if (gotoQuizBtn) {
    gotoQuizBtn.addEventListener('click', function() {
        if (!this.dataset.quizId) { alert('Сначала выберите викторину'); return; }
        window.location.href = 'quiz.html?id=' + this.dataset.quizId;
    });
}

// ============================================
// ===== ВИКТОРИНА (Игровой процесс) =====
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
    if (urlId && APP.library.some(q => q.id === urlId)) {
        select.value = urlId;
    }
}

document.querySelectorAll('.level-btn').forEach(btn => {
    btn.addEventListener('click', function() {
        document.querySelectorAll('.level-btn').forEach(b => b.classList.remove('selected'));
        this.classList.add('selected');
    });
});

const autoToggle = document.getElementById('autoToggle');
if (autoToggle) autoToggle.addEventListener('click', function() { this.classList.toggle('active'); });

const showAnswerToggle = document.getElementById('showAnswerToggle');
if (showAnswerToggle) showAnswerToggle.addEventListener('click', function() { this.classList.toggle('active'); });

const startBtn = document.getElementById('startQuizBtn');
if (startBtn) {
    startBtn.addEventListener('click', function() {
        const quizId = document.getElementById('quizSelect').value;
        if (!quizId) { alert('Выберите викторину'); return; }

        const quiz = APP.library.find(q => q.id === quizId);
        if (!quiz) return;

        const selectedBtn = document.querySelector('.level-btn.selected');
        const level = selectedBtn ? selectedBtn.dataset.level : 'easy';
        const total = parseInt(document.getElementById('quizCount').value) || 20;

        let timeLimit = 90, hintLimit = 3, fromStart = true;
        if (level === 'medium') { timeLimit = 60; hintLimit = 3; fromStart = true; }
        if (level === 'hard') { timeLimit = 45; hintLimit = 1; fromStart = false; }

        let tracks = [...quiz.tracks];
        for (let i = tracks.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [tracks[i], tracks[j]] = [tracks[j], tracks[i]];
        }

        const count = Math.min(total, tracks.length);
        const selected = tracks.slice(0, count);

        Q.quizId = quizId;
        Q.level = level;
        Q.questions = selected.map(t => ({ ...t }));
        Q.currentIndex = 0;
        Q.correctCount = 0;
        Q.hintCount = hintLimit;
        Q.totalQuestions = selected.length;
        Q.timeLimit = timeLimit;
        Q.fromStart = fromStart;
        Q.isFinished = false;
        Q.timeLeft = timeLimit;
        Q.answered = false;
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
    Q.audioReady = false;

    const question = Q.questions[Q.currentIndex];
    document.getElementById('questionNum').textContent = `Вопрос ${Q.currentIndex + 1} из ${Q.totalQuestions}`;

    Q.timeLeft = Q.timeLimit;
    updateTimerDisplay();
    if (Q.timer) clearInterval(Q.timer);
    Q.timer = setInterval(timerTick, 1000);

    document.getElementById('hintBtn').textContent = `💡 Подсказка (${Q.hintCount})`;
    document.getElementById('hintBtn').disabled = Q.hintCount <= 0;

    const audio = document.getElementById('gameAudio');
    audio.src = question.file;
    audio.load();
    audio.oncanplay = function() {
        Q.audioReady = true;
        if (!Q.fromStart && audio.duration > 10) {
            audio.currentTime = audio.duration * (0.3 + Math.random() * 0.4);
        }
        audio.play().catch(() => {});
        enableControls();
    };

    const container = document.getElementById('gameQuestion');
    if (Q.level === 'easy') {
        renderEasyQuestion(container, question);
    } else {
        renderInputQuestion(container);
    }

    document.getElementById('gameFeedback').innerHTML = '';
    document.getElementById('submitBtn').disabled = true;
}

function enableControls() {
    if (Q.answered) return;
    document.getElementById('submitBtn').disabled = false;
    const container = document.getElementById('gameQuestion');
    container.querySelectorAll('.option-btn').forEach(b => b.classList.remove('disabled'));
    const input = document.getElementById('answerInput');
    if (input) { input.disabled = false; input.focus(); }
}

function renderEasyQuestion(container, question) {
    const allTitles = Q.questions.map(q => q.title);
    const correct = question.title;
    let wrongs = allTitles.filter(t => t !== correct);

    for (let i = wrongs.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [wrongs[i], wrongs[j]] = [wrongs[j], wrongs[i]];
    }
    wrongs = wrongs.slice(0, 3);
    while (wrongs.length < 3) wrongs.push('Другой вариант');

    const options = [correct, ...wrongs];
    for (let i = options.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [options[i], options[j]] = [options[j], options[i]];
    }

    container.innerHTML = `
        <p style="font-weight:600;margin-bottom:10px;">Выбери правильное название:</p>
        <div class="game-options" id="optionsContainer">
            ${options.map(opt => `<button class="option-btn disabled" data-value="${opt}">${opt}</button>`).join('')}
        </div>
    `;

    container.querySelectorAll('.option-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            if (Q.answered || !Q.audioReady) return;
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
        <input type="text" class="game-input" id="answerInput" placeholder="Введите ответ..." disabled>
    `;
    document.getElementById('submitBtn').classList.remove('hidden');
    document.getElementById('submitBtn').disabled = true;

    const input = document.getElementById('answerInput');
    if (input) {
        input.value = '';
        input.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') document.getElementById('submitBtn').click();
        });
    }
}

const submitBtn = document.getElementById('submitBtn');
if (submitBtn) {
    submitBtn.addEventListener('click', function() {
        if (Q.answered || !Q.audioReady) return;
        const input = document.getElementById('answerInput');
        if (!input) return;
        const userAnswer = input.value.trim();
        if (!userAnswer) { alert('Введите ответ'); return; }
        const correct = Q.questions[Q.currentIndex].title;
        const isCorrect = userAnswer.toLowerCase().replace(/\s+/g, ' ') === correct.toLowerCase().replace(/\s+/g, ' ');
        handleAnswer(isCorrect);
    });
}

function handleAnswer(isCorrect) {
    if (Q.answered) return;
    Q.answered = true;
    if (Q.timer) { clearInterval(Q.timer); Q.timer = null; }

    const question = Q.questions[Q.currentIndex];
    if (isCorrect) { Q.correctCount++; } else { Q.wrongTitles.push(question.title); }

    if (Q.showAnswer) {
        const overlay = document.createElement('div');
        overlay.className = 'answer-modal-overlay';
        let countdown = 3;
        overlay.innerHTML = `
            <div class="answer-modal">
                <span class="icon">${isCorrect ? '🎉' : '😅'}</span>
                <div class="title ${isCorrect ? 'correct' : 'wrong'}">${isCorrect ? 'Правильно!' : 'Неправильно!'}</div>
                ${!isCorrect ? `<div class="correct-answer">Правильный ответ: «${question.title}»</div>` : ''}
                <div class="sub">Следующий вопрос через</div>
                <div class="countdown" id="modalCountdown">${countdown}</div>
                <button class="btn btn-primary" id="modalNextBtn">⏭ Сейчас</button>
            </div>
        `;
        document.body.appendChild(overlay);
        
        const timer = setInterval(() => {
            countdown--;
            const el = document.getElementById('modalCountdown');
            if (el) el.textContent = countdown;
            if (countdown <= 0) {
                clearInterval(timer);
                overlay.remove();
                nextQuestion();
            }
        }, 1000);
        
        document.getElementById('modalNextBtn').addEventListener('click', () => {
            clearInterval(timer);
            overlay.remove();
            nextQuestion();
        });
    } else {
        nextQuestion();
    }
}

function nextQuestion() {
    if (Q.currentIndex + 1 >= Q.totalQuestions) { finishQuiz(); return; }
    Q.currentIndex++;
    showQuestion();
}

function timerTick() {
    Q.timeLeft--;
    updateTimerDisplay();
    if (Q.timeLeft <= 0) {
        clearInterval(Q.timer);
        Q.timer = null;
        if (!Q.answered) {
            const question = Q.questions[Q.currentIndex];
            Q.wrongTitles.push(question.title);
            Q.answered = true;
            document.getElementById('submitBtn').disabled = true;
            const container = document.getElementById('gameQuestion');
            container.querySelectorAll('.option-btn').forEach(b => b.classList.add('disabled'));
            const input = document.getElementById('answerInput');
            if (input) input.disabled = true;

            document.getElementById('gameFeedback').innerHTML = `<div class="game-feedback wrong">⏰ Время вышло! Правильный ответ: <strong>«${question.title}»</strong></div>`;
            setTimeout(nextQuestion, 2000);
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

    const question = Q.questions[Q.currentIndex];
    let hint = '';

    if (Q.level === 'easy') {
        const container = document.getElementById('optionsContainer');
        const buttons = container.querySelectorAll('.option-btn');
        const correct = question.title;
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
        const words = question.title.split(' ');
        hint = words.length > 0 ? `📝 Первое слово: "${words[0]}"` : `📝 Первая буква: "${question.title.charAt(0)}"`;
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

    APP.results.push({
        date: new Date().toLocaleDateString('ru-RU'),
        quizName: quiz ? quiz.name : 'Неизвестно',
        level: Q.level === 'easy' ? 'Лёгкий' : Q.level === 'medium' ? 'Средний' : 'Сложный',
        correct: correct,
        total: total,
        percent: percent
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
        </div>
        <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:12px;">
            <button class="btn btn-primary" id="retryQuizBtn">🔄 Пройти ещё раз</button>
            <button class="btn btn-secondary" id="backToMenuBtn">🏠 Главное меню</button>
        </div>
    `;
    document.getElementById('finalScreen').classList.remove('hidden');

    document.getElementById('retryQuizBtn')?.addEventListener('click', () => {
        document.getElementById('finalScreen').classList.add('hidden');
        document.getElementById('quizSetup').classList.remove('hidden');
        Q.isFinished = false;
    });
    document.getElementById('backToMenuBtn')?.addEventListener('click', () => {
        window.location.href = 'results.html';
    });
}

// ============================================
// ===== РЕЗУЛЬТАТЫ =====
// ============================================
function renderResults() {
    const container = document.getElementById('resultsList');
    if (!container) return;

    if (APP.results.length === 0) {
        container.innerHTML = `<div class="card" style="text-align:center;padding:40px;color:var(--text-secondary);">📭 Здесь будут твои результаты</div>`;
        return;
    }

    const sorted = [...APP.results].reverse();
    container.innerHTML = sorted.map(r => `
        <div class="result-card ${r.percent >= 90 ? 'high' : ''}">
            <div class="date">📅 ${r.date} — ${r.quizName} (${r.level})</div>
            <div class="info">
                <span class="score">${r.correct} из ${r.total}</span>
                <span class="percent">${r.percent}%</span>
            </div>
        </div>
    `).join('');

    const avg = APP.results.reduce((s, r) => s + r.percent, 0) / APP.results.length;
    const best = Math.max(...APP.results.map(r => r.percent));
    const summary = document.createElement('div');
    summary.className = 'stats-summary';
    summary.innerHTML = `
        <span>📈 Средний: <strong>${Math.round(avg)}%</strong></span>
        <span>🏆 Лучший: <strong>${best}%</strong></span>
        <span>📊 Викторин: <strong>${APP.results.length}</strong></span>
    `;
    container.prepend(summary);
}

document.getElementById('clearResultsBtn')?.addEventListener('click', function() {
    if (confirm('Удалить всю историю результатов?')) {
        APP.results = [];
        saveAppData();
        renderResults();
    }
});

// ============================================
// ===== НАСТРОЙКИ =====
// ============================================
function renderSettings() {
    const nameEl = document.getElementById('settingsName');
    if (nameEl) nameEl.textContent = APP.user.name || '—';
    
    const themeSelect = document.getElementById('themeSelect');
    if (themeSelect) themeSelect.value = APP.settings.theme;
}

document.getElementById('themeSelect')?.addEventListener('change', function() {
    APP.settings.theme = this.value;
    saveAppData();
    applyTheme();
});

document.getElementById('editProfileBtn')?.addEventListener('click', function() {
    const newName = prompt('Введите ваше имя:', APP.user.name);
    if (newName && newName.trim()) {
        APP.user.name = newName.trim();
        saveAppData();
        renderSettings();
    }
});

document.getElementById('soundToggle')?.addEventListener('click', function() {
    this.classList.toggle('active');
    APP.settings.sound = this.classList.contains('active');
    saveAppData();
});

document.getElementById('volumeSlider')?.addEventListener('input', function() {
    APP.settings.volume = parseFloat(this.value);
    saveAppData();
    document.querySelectorAll('audio').forEach(a => a.volume = APP.settings.volume);
});

document.getElementById('clearCacheBtn')?.addEventListener('click', function() {
    if (confirm('Очистить кэш?')) {
        if ('caches' in window) {
            caches.keys().then(keys => keys.forEach(key => caches.delete(key)));
        }
        alert('✅ Кэш очищен');
    }
});

// ============================================
// ===== ЗАПУСК =====
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    loadAppData();
    applyTheme();

    if (document.getElementById('page-library')) {
        checkOnboarding();
        renderLibrary();
    }
    if (document.getElementById('page-prepare')) {
        renderPrepareSelect();
        const urlParams = new URLSearchParams(window.location.search);
        const urlId = urlParams.get('id');
        if (urlId) {
            const select = document.getElementById('prepareSelect');
            if (select) {
                select.value = urlId;
                loadPrepare(urlId);
            }
        }
    }
    if (document.getElementById('page-quiz')) {
        renderQuizSelect();
    }
    if (document.getElementById('page-results')) {
        renderResults();
    }
    if (document.getElementById('page-settings')) {
        renderSettings();
    }
});

console.log('🎵 MuQwiz загружен!');
