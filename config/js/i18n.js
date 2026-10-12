/*
 * Page UI language (English / Russian).
 *
 * The source strings are English and live where they are used: in
 * index.html, config.js and the widget and layout catalogs (widgets.js,
 * presets.js). A translation is looked up by the English text itself, so a
 * string without a translation simply stays English.
 *
 *   I18N.t('Blocks selected: {n}', { n: 3 })
 *
 * In index.html, data-i18n marks an element whose text is translated and
 * data-i18n-<attr> (title, placeholder, aria-label, data-inherit) an
 * attribute. The English original is kept in the marker attribute, so the
 * page can be translated again after a language switch.
 *
 * Language: ?lang=en|ru, then the choice saved by the switch, then the
 * browser language (ru, uk, be -> Russian, anything else -> English).
 * On-watch labels (Widgets.LANG) are not affected: the watch fonts are Latin only.
 */
(function (root) {
  'use strict';

  var STORAGE_KEY = 'tilestyle.lang';
  var LANGS = ['en', 'ru'];
  var ATTRS = ['title', 'placeholder', 'aria-label', 'data-inherit'];

  var DICT = {
    ru: {
      // --- page (index.html) ---
      'TileStyle — settings': 'TileStyle — настройки',
      'Cancel': 'Отмена',
      'Save': 'Сохранить',
      'Language': 'Язык',
      'Grid 4×4': 'Сетка 4×4',
      'Undo': 'Отменить',
      'Merge': 'Объединить',
      'Split': 'Разделить',
      'Even out': 'Поровну',
      'Make all columns and rows the same size': 'Сделать все столбцы и строки одинаковыми',
      'Grid': 'Сетка',
      'Tap a block to choose its widget. Drag across several cells to select and merge them. The handles on the frame change column widths and row heights.':
        'Нажмите на блок, чтобы выбрать виджет. Проведите по нескольким ячейкам, чтобы выделить и объединить их. ' +
        'Ручки на рамке меняют ширину столбцов и высоту строк.',
      'Layouts': 'Готовые раскладки',
      'My layouts': 'Мои раскладки',
      'Save current': 'Сохранить текущую',
      'Name': 'Название',
      'Theme': 'Тема',
      'Screen background': 'Фон экрана',
      'Block background': 'Фон блоков',
      'Same as screen': 'Как фон экрана',
      'Text': 'Текст',
      'Accent (icon outline)': 'Акцент (обводка иконок)',
      'Icon fill': 'Заливка иконок',
      'Same as block': 'Как фон блока',
      'Gap between blocks': 'Отступ между блоками',
      'Corner radius': 'Скругление углов',
      'Lines between blocks': 'Линии между блоками',
      'Line color': 'Цвет линий',
      'Thickness': 'Толщина',
      'Line style': 'Тип линии',
      'Solid': 'Сплошная',
      'Dashed': 'Пунктир',
      'Dotted': 'Точки',
      'General': 'Общие',
      'Time format': 'Формат времени',
      '24 h': '24 ч',
      '12 h': '12 ч',
      'Units': 'Единицы',
      '°C, km': '°C, км',
      '°F, mi': '°F, ми',
      'Vibrate on Bluetooth disconnect': 'Вибрация при потере Bluetooth',
      'Weather': 'Погода',
      'Location': 'Местоположение',
      'Manual': 'Вручную',
      'Off': 'Выкл.',
      'City': 'Город',
      'Start typing a place name…': 'Начните вводить название…',
      'Update': 'Обновлять',
      'Every 30 min': 'Раз в 30 мин',
      'Every hour': 'Раз в час',
      'Every 2 hours': 'Раз в 2 часа',
      'For developers: settings JSON': 'Для разработчика: JSON настроек',
      'Choose a widget': 'Выбор виджета',
      'Widget': 'Виджет',
      'Close': 'Закрыть',
      'Choose a color': 'Выбор цвета',
      'Color': 'Цвет',
      'Done': 'Готово',
      'Same as theme': 'Как в теме',

      // --- editor (config.js) ---
      'Column border {n}': 'Граница столбцов {n}',
      'Row border {n}': 'Граница строк {n}',
      'theme': 'тема',
      'same as block': 'как фон блока',
      'same as screen': 'как фон',
      'Block': 'Блок',
      'Select a block on the watch face.': 'Выберите блок на циферблате.',
      'Blocks selected: {n}': 'Выделено блоков: {n}',
      'Area {w}×{h}. The merged block gets the widget of the largest non-empty block.':
        'Область {w}×{h}. Объединённый блок получит виджет самого крупного непустого блока.',
      'Merge into one block': 'Объединить в один блок',
      'Pick a widget': 'Выбрать виджет',
      'Background': 'Фон',
      'Accent': 'Акцент',
      '{w}×{h} cells · {pw}×{ph} px': '{w}×{h} ячеек · {pw}×{ph} px',
      'The block is smaller than the widget needs ({min} px). Make the block bigger or change the grid proportions.':
        'Блок меньше, чем нужно виджету ({min} px). Увеличьте блок или измените пропорции сетки.',
      'Block colors': 'Цвета блока',
      'Split into cells': 'Разделить на ячейки',
      'Clear': 'Очистить',
      'Widget for a {w}×{h} px block': 'Виджет для блока {w}×{h} px',
      'Needs a block of at least {min} px': 'Нужен блок от {min} px',
      'min {min} px': 'от {min} px',
      'Coordinates: {lat}, {lon}': 'Координаты: {lat}, {lon}',
      'Nothing found': 'Ничего не найдено',
      'Couldn’t load suggestions. Check your internet connection.':
        'Не удалось получить подсказки. Проверьте подключение к интернету.',
      'Searching…': 'Ищем…',
      'Delete': 'Удалить',
      'Really delete?': 'Точно удалить?',
      'Layouts you save will appear here.': 'Здесь появятся раскладки, которые вы сохраните.',
      'Layout {n}': 'Раскладка {n}',
      'Layout': 'Раскладка',
      'Couldn’t save: the browser doesn’t allow storing data.': 'Не удалось сохранить: браузер не даёт записывать данные.',
      'Couldn’t delete: the browser doesn’t allow storing data.': 'Не удалось удалить: браузер не даёт записывать данные.',
      'The watch face has no time widget.': 'На циферблате нет виджета времени.',
      'The “{name}” widget doesn’t fit its block.': 'Виджет «{name}» не помещается в свой блок.',
      'The watch fonts can’t show “{chars}” (“{name}” widget); the watch will show ▯ instead.':
        'Символов «{chars}» нет в шрифтах часов (виджет «{name}») — на часах вместо них будет ▯.',
      'The date in this format doesn’t fit its block. Pick a shorter format or make the block wider.':
        'Дата в выбранном формате не помещается в свой блок — выберите формат короче или расширьте блок.',
      'Seconds noticeably shorten battery life.': 'Секунды заметно сокращают время работы от батареи.',
      'Weather is off in the general settings, so weather widgets will be empty.':
        'Погода выключена в общих настройках — погодные виджеты будут пустыми.',
      'Pick the weather city from the suggestions so that its coordinates are saved.':
        'Выберите город для погоды из подсказок — так сохранятся его координаты.',

      // --- widget catalog (widgets.js) ---
      'Basics': 'Основное',
      'Time': 'Время',
      'Status': 'Состояние',
      'Health': 'Здоровье',
      'Other': 'Прочее',

      'Empty': 'Пусто',
      'Font': 'Шрифт',
      'Arrangement': 'Компоновка',
      'Auto': 'Авто',
      'One line': 'В строку',
      'Hours above minutes': 'Часы над минутами',
      'Leading zero': 'Ведущий ноль',
      'Antialiasing': 'Сглаживание',
      'Date': 'Дата',
      'Format': 'Формат',
      'Calendar page': 'Листок календаря',
      'Two lines: MON / 12 OCT': 'Две строки: MON / 12 OCT',
      'Two lines: 12 / OCT': 'Две строки: 12 / OCT',
      'Two lines: MONDAY / 12 OCTOBER': 'Две строки: MONDAY / 12 OCTOBER',
      'Three lines: MON / 12 / OCT': 'Три строки: MON / 12 / OCT',
      'Custom…': 'Свой формат…',
      'Pattern': 'Шаблон',
      '%d — 05, %e — 5, %m — 10, %b — OCT, %B — OCTOBER, %a — MON, %A — MONDAY, %y — 26, %Y — 2026, %j — day of year, %V — week, | — new line':
        '%d — 05, %e — 5, %m — 10, %b — OCT, %B — OCTOBER, %a — MON, %A — MONDAY, ' +
        '%y — 26, %Y — 2026, %j — день года, %V — неделя, | — новая строка',
      'All caps': 'Все заглавные',
      'Weekday': 'День недели',
      'Full name (if it fits)': 'Полное название (если влезет)',
      'Battery': 'Батарея',
      'Style': 'Вид',
      'Icon': 'Иконка',
      'Icon + %': 'Иконка + %',
      '% only': 'Только %',
      'Show only when disconnected': 'Показывать только при потере связи',
      'Steps': 'Шаги',
      'Goal (0 — no bar)': 'Цель (0 — без полоски)',
      'Abbreviate thousands (6.3k)': 'Сокращать до тысяч (6.3k)',
      'Steps by hour': 'Шаги по часам',
      'Starting hour': 'Начиная с часа',
      'Distance': 'Дистанция',
      'As in general settings (km / miles)': 'Как в общих настройках (км / мили)',
      'Kilometers': 'Километры',
      'Meters': 'Метры',
      'Miles': 'Мили',
      'Feet': 'Футы',
      'Calories': 'Калории',
      'Heart rate': 'Пульс',
      'Sleep': 'Сон',
      'Deep sleep only': 'Только глубокий сон',
      'Current weather': 'Погода сейчас',
      'Forecast low/high': 'Прогноз мин/макс',
      'UV index': 'УФ-индекс',
      'Seconds': 'Секунды',
      'The watch will wake up every second, which noticeably drains the battery.':
        'Часы будут просыпаться каждую секунду — заметно сажает батарею.',
      'Second time zone': 'Второй часовой пояс',
      'Label': 'Подпись',
      'UTC offset, h': 'Смещение от UTC, ч',
      'Week number': 'Номер недели',
      'Custom text': 'Свой текст',
      'Hourly forecast': 'Почасовой прогноз',
      'Columns: hour, icon, temperature': 'Колонки: час, иконка, температура',
      'Temperature graph': 'График температуры',
      'Step': 'Шаг',
      '1 hour': '1 час',
      '2 hours': '2 часа',
      '3 hours': '3 часа',
      'Hours to show (0 — as many as fit)': 'Сколько часов (0 — сколько влезет)',
      'Divider': 'Разделитель',
      'Direction': 'Направление',
      'Horiz.': 'Гориз.',
      'Vert.': 'Верт.',
      'Line': 'Линия',
      'Edge inset, px': 'Отступ от краёв, px',
      'Alignment': 'Выравнивание',
      'Digit alignment': 'Выравнивание цифр',
      'Left': 'Слева',
      'Center': 'Центр',
      'Right': 'Справа',

      // --- built-in layouts (presets.js) ---
      'Centered': 'По центру',
      'Dashboard': 'Дашборд',
      'Minimal': 'Минимализм',
      'Neon': 'Неон',
      'Paper': 'Бумага',
      'Cards': 'Карточки',
      'Terminal': 'Терминал',
      'Sunset': 'Закат',
      'Sport': 'Спорт',
      'Contrast': 'Контраст',
      'World': 'Мир'
    }
  };

  function storageGet(k) {
    try { return root.localStorage.getItem(k); } catch (e) { return null; }
  }

  function storageSet(k, v) {
    try { root.localStorage.setItem(k, v); } catch (e) { /* private mode */ }
  }

  function supported(lang) {
    return LANGS.indexOf(lang) !== -1;
  }

  function queryLang() {
    var m = /[?&]lang=([^&#]*)/.exec(root.location.search);
    return m ? decodeURIComponent(m[1]).toLowerCase() : null;
  }

  function detect() {
    var q = queryLang();
    if (supported(q)) return q;
    var saved = storageGet(STORAGE_KEY);
    if (supported(saved)) return saved;
    var nav = String((root.navigator.languages && root.navigator.languages[0]) || root.navigator.language || '');
    return /^(ru|uk|be)\b/i.test(nav) ? 'ru' : 'en';
  }

  var I18N = {
    LANGS: LANGS,
    lang: detect(),

    // Translation of an English string; {name} placeholders are filled from vars
    t: function (text, vars) {
      var dict = DICT[I18N.lang];
      var s = dict && dict.hasOwnProperty(text) ? dict[text] : text;
      if (vars) {
        s = s.replace(/\{(\w+)\}/g, function (m, k) { return vars.hasOwnProperty(k) ? String(vars[k]) : m; });
      }
      return s;
    },

    // Switches the language and remembers the choice. A ?lang= in the address
    // would win on the next load, so it is updated too.
    setLang: function (lang) {
      if (!supported(lang)) return;
      I18N.lang = lang;
      storageSet(STORAGE_KEY, lang);
      if (queryLang() !== null && root.history && root.history.replaceState) {
        var search = root.location.search.replace(/([?&]lang=)[^&#]*/, '$1' + lang);
        try { root.history.replaceState(null, '', search + root.location.hash); } catch (e) { /* file:// */ }
      }
    },

    // Translates the marked elements of the page
    apply: function (doc) {
      doc = doc || root.document;
      doc.documentElement.lang = I18N.lang;
      Array.prototype.forEach.call(doc.querySelectorAll('[data-i18n]'), function (el) {
        var src = el.getAttribute('data-i18n') || el.textContent.replace(/\s+/g, ' ').trim();
        el.setAttribute('data-i18n', src);
        el.textContent = I18N.t(src);
      });
      ATTRS.forEach(function (a) {
        Array.prototype.forEach.call(doc.querySelectorAll('[data-i18n-' + a + ']'), function (el) {
          var src = el.getAttribute('data-i18n-' + a) || el.getAttribute(a) || '';
          el.setAttribute('data-i18n-' + a, src);
          el.setAttribute(a, I18N.t(src));
        });
      });
    }
  };

  root.I18N = I18N;
})(this);
