import { listFiles } from 'better-gdrive';

// Делаем функцию доступной глобально, чтобы вызывать из HTML
window.scanGoogleDrive = async function(link) {
  try {
    console.log('🔍 Сканируем папку:', link);
    
    // Используем better-gdrive для получения списка файлов
    const files = await listFiles(link);
    
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
    
    return mp3Files;
  } catch (error) {
    console.error('❌ Ошибка при сканировании:', error);
    throw error;
  }
};

// Экспортируем для использования в других файлах
export { listFiles };