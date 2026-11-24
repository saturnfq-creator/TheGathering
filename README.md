# The Gathering 0.12 Beta — gesture stabilization

Changes:
- Return from vertical deck to playing cover without re-decoding or replacing the displayed image.
- Blend title and image brightness continuously with deck depth; when arriving at zero the normal player is already visible before exiting browse mode.
- Remove full-card CSS blur/brightness filters and image masks from horizontally moving covers; replace with lightweight overlay shading.
- Don't clone the entire album-cover stack on adjacent track changes across albums.
- Palette changes only after the horizontal slide; travelling rim wakes after the slide.
- Keep the approved 0.11 visual design, album library, native Media3 playback and queue behavior.

Limitations: this is a source project, not a compiled APK. Browser regressions are provided; Android device performance must still be tested on actual hardware.

# The Gathering 0.10.0 Beta

Исходный Android-проект музыкального плеера **The Gathering**. **Это не APK**: ZIP предназначен для загрузки в GitHub и автоматической сборки APK через Actions. База проекта: версия 0.9.

## Изменения версии 0.10

1. **Вернули заметное свечение играющей обложки как в версии 0.8.** В 0.9 подсветка стала слабее, потому что режим `contain: paint` обрезал тени за границей обложки. Для передней карточки убрано обрезание свечения. Свет по-прежнему движется вместе с обложкой во время горизонтального свайпа и мягко гаснет/загорается при переключении. Сам дизайн свечения не изменён.
2. **Фоновый цвет зависит только от играющей песни.** Вертикальное листание глубины стопки больше не инициирует обновление цвета, а обработчик запоздалых ответов Android по-прежнему не применяет палитру чужого трека. Если музыка переключилась автоматически во время просмотра глубины, цвет обновляется именно на новую *играющую* песню.
3. **Очередь: убрана кнопка «Добавить MP3».** Импорт файлов сохранён: компактная кнопка `＋` расположена в верхней части библиотеки, а автоматическое чтение MediaStore не затронуто.
4. **Shuffle — переключатель с понятными состояниями.** Выключен: приглушённая кнопка. Включен: яркий тёплый стеклянный акцент, `aria-pressed=true`. Включение физически перемешивает будущие треки и синхронизирует Media3; выключение возвращает исходный порядок (с учётом текущего трека, без остановки музыки). При запуске нового альбома и при полной загрузке библиотеки режим сбрасывается. Кнопка остаётся внутри очереди.
5. **Подсветка окна очереди и библиотеки.** Используются приглушённые статичные радиальные градиенты, цвета которых рассчитываются из актуальной играющей обложки. Ни дополнительного blur/FFT, ни новой покадровой анимации нет. Очередь осталась частично раскрываемой и полноэкранной, без принудительного перехода в полноэкранный режим.
6. **«Профиль» переименован в «Настройки».** Иконка заменена на шестерёнку. Раздел пока не открывается, появляется нейтральное сообщение о будущей реализации.

Логотип внутри приложения и иконка Android из 0.9 **не менялись**. Сохранены текущие обложки, библиотека, поиск, альбомы, свайпы и музыкальный движок Media3.

## Что было протестировано

```bash
node --check app/src/main/assets/app.js
node tests/logic-smoke-test.cjs
python tests/browser-integration.py
python tests/v08-regressions.py
python tests/v09-regressions.py
python tests/v010-regressions.py
```

Проверены в Chromium: яркость и перемещение контура обложки; фиксирование цветовой палитры во время просмотра стопки; цветовые переменные очереди и библиотеки; включение и выключение Shuffle с перестановкой порядка и вызовами Android Bridge; импорт MP3 в библиотеке; надпись «Настройки»; прежние сценарии очереди, альбомов, выбора музыки и системной навигации в веб-интерфейсе.

**Ограничения:** APK в этой среде не собирался и на реальном телефоне не проверялся. Браузерные тесты не гарантируют идентичную работу WebView и Media3. При реальных сбоях нужен Android logcat.

## Как получить APK через GitHub

1. Распакуй этот ZIP. Загрузить надо **содержимое папки** в корень репозитория `saturnfq-creator/TheGathering`, включая `.github`.
2. Для загрузки: https://github.com/saturnfq-creator/TheGathering/upload/main . Существующие файлы с совпадающими именами перезапишутся в новом коммите.
3. Нажми **Commit changes**. Вкладка **Actions** автоматически начнёт сборку.
4. После зелёной галочки открой последний запуск и в блоке **Artifacts** скачай `TheGathering-v0.10-beta1-APK`. Внутри архива — `app-debug.apk`.
5. Установи APK на Android. Если подпись отличается от старой версии, может потребоваться удалить прежнюю тестовую сборку.

При красном крестике в Actions пришли последние строки шага **Build APK**.
