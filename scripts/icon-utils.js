// v0.18 — Единая точка отрисовки "иконки" где угодно в модуле.
//
// Раньше поле "иконка" (у Элементов/Аспектов каталога, а теперь и у Модификаторов) всегда
// значило голую строку класса FontAwesome — "fa-solid fa-fire". Теперь то же поле может
// содержать путь к файлу-изображению, загруженному в мир Foundry (webp/png/svg/jpg — через
// штатный FilePicker, тот же диалог выбора файла, что у поля "Image" на листе актора).
//
// Различаем формат простой эвристикой: класс FontAwesome у Foundryborne/FA5-6 всегда начинается
// с "fa-" (fa-solid, fa-regular, fa-brands, fa-fw и т.д.); путь к файлу — нет (он либо
// относительный "icons/...", либо абсолютный "worlds/.../file.webp"). Ложных срабатываний не
// предполагается: имя файла, начинающееся с "fa-", было бы крайне маловероятным совпадением.

export function isFileIcon(icon) {
  if (!icon) return false;
  return !icon.trim().startsWith("fa-");
}

/** Возвращает готовый HTML одного тега — <i> для класса FA, <img> для файла. */
export function renderIconHtml(icon, { className = "", title = "" } = {}) {
  if (!icon) return "";
  const titleAttr = title ? ` title="${title}"` : "";
  const classAttr = className ? ` ${className}` : "";
  if (isFileIcon(icon)) {
    return `<img src="${icon}" class="fm-icon-img${classAttr}"${titleAttr} alt="" />`;
  }
  return `<i class="${icon}${classAttr}"${titleAttr}></i>`;
}

/**
 * Открывает штатный FilePicker Foundry в режиме выбора изображения. onPick получает путь
 * относительно Data/ — ровно то, что нужно записать в поле "иконка" вместо класса FA.
 * Реализация FilePicker переехала в разных версиях Foundry (v12+ иногда только через
 * foundry.applications.apps.FilePicker.implementation) — пробуем оба варианта на случай
 * разных версий ядра у Влада (минимум v13, проверено на v14).
 */
export function browseForIconFile(currentPath, onPick) {
  const FilePickerImpl = foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
  if (!FilePickerImpl) {
    ui.notifications?.error("FilePicker недоступен в этой версии Foundry — впишите путь к файлу вручную.");
    return;
  }
  const picker = new FilePickerImpl({
    type: "image",
    current: currentPath || "",
    callback: (path) => onPick(path)
  });
  picker.render(true);
}
