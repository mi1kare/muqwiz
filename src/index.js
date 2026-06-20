// Код для работы с Google Drive API через API-ключ
window.scanGoogleDrive = async function(link) {
  try {
    console.log('🔍 Сканируем папку:', link);
    
    // Извлекаем ID папки из ссылки
    let folderId = null;
    const match = link.match(/\/folders\/([a-zA-Z0-9_-]+)/);
    if (match) {
      folderId = match[1];
    } else {
      const match2 = link.match(/id=([a-zA-Z0-9_-]+)/);
      if (match2) {
        folderId = match2[1];
      }
    }

    if (!folderId) {
      throw new Error('Не удалось извлечь ID папки из ссылки');
    }

    console.log('📁 ID папки:', folderId);

    // ВСТАВЬ СВОЙ API-КЛЮЧ ВМЕСТО "ТВОЙ_КЛЮЧ_ЗДЕСЬ"!
    const apiKey = "AIzaSyAKtOvwvOQOBsGy4vFi_HmSN6U33WcWcbE";
    const url = `https://www.googleapis.com/drive/v3/files?q='${folderId}'+in+parents&key=${apiKey}&fields=files(id,name,mimeType)&corpora=user`;

    console.log('📡 Отправляем запрос к Google API...');
    const response = await fetch(url);

    if (!response.ok) {
      const errorData = await response.json();
      console.error('❌ Ошибка API:', errorData);
      throw new Error(`Ошибка API: ${response.status} - ${errorData.error?.message || 'Неизвестная ошибка'}`);
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

    // Добавляем информацию о файлах для отладки
    mp3Files.forEach(f => {
      console.log('  -', f.name, '(ID:', f.id, ')');
    });

    // Формируем результат с прямыми ссылками для скачивания
    return mp3Files.map(f => ({
      id: f.id,
      name: f.name,
      title: f.name.replace(/\.mp3$/i, '').replace(/[_-]/g, ' '),
      file: `https://drive.google.com/uc?export=download&id=${f.id}`
    }));

  } catch (error) {
    console.error('❌ Ошибка при сканировании:', error);
    throw error;
  }
};
