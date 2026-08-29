// v0.14 — Ресурс Сцены: модель данных.
//
// Два уровня хранения (см. дизайн-документ, раздел 11.1):
//  - Мировой КАТАЛОГ (game.settings, scope "world"): что вообще существует — id/label/иконка/
//    тултип на каждый Элемент и вложенный список его Аспектов. Редактируется редко (вкладка
//    «Каталог» в GM Settings, v0.15) — источник истины по тому, ЧТО есть.
//  - Флаг СЦЕНЫ (scene.flags.free-magic.resource): что из каталога активно ИМЕННО на этой сцене
//    и текущие числа. Источник истины по тому, СКОЛЬКО сейчас.
//
// То же расщепление ответственности, что уже работает между Items и флагами для Путей (раздел 2.4)
// и между мировыми настройками и флагом Сцены для старого Банка (bank.js, раздел 6).

export const MODULE_ID = "free-magic";

// --- Мировой каталог Элементов/Аспектов ---------------------------------------------------

// 11 доменов мира по умолчанию — список фиксированный по замыслу (см. раздел 11), но иконки/
// тултипы/сами Аспекты ГМ донастраивает через GM Settings (v0.15). aspects — объект, не массив,
// чтобы у Аспекта был свой стабильный id (используется как ключ в scene.flags наравне с id Элемента).
function defaultCatalog() {
  const base = [
    ["fire", "Огонь", "fa-solid fa-fire"],
    ["water", "Вода", "fa-solid fa-droplet"],
    ["earth", "Земля", "fa-solid fa-mountain"],
    ["air", "Воздух", "fa-solid fa-wind"],
    ["light", "Свет", "fa-solid fa-sun"],
    ["dark", "Тьма", "fa-solid fa-moon"],
    ["spirit", "Дух", "fa-solid fa-ghost"],
    ["life", "Жизнь", "fa-solid fa-seedling"],
    ["time", "Время", "fa-solid fa-hourglass-half"],
    ["space", "Пространство", "fa-solid fa-cubes"],
    ["cosmos", "Космос", "fa-solid fa-star"]
  ];
  return Object.fromEntries(
    base.map(([id, label, icon]) => [id, { id, label, icon, tooltip: "", aspects: {} }])
  );
}

export function registerSceneResourceSettings() {
  // Сам каталог — единая настройка-объект, а не по полю на Элемент, иначе перезапись одного
  // Элемента в GM Settings рисковала бы гонкой данных с другим полем. CRUD-хелперы ниже всегда
  // читают/пишут каталог целиком.
  game.settings.register(MODULE_ID, "resourceCatalog", {
    scope: "world",
    config: false,
    type: Object,
    default: defaultCatalog()
  });

  // Глобальный Фон — тот же смысл, что backgroundBankValue/Max в bank.js, но с добавленным
  // счётчиком instability (перманентная Нестабильность, раздел 11.2). Служит запасным
  // вариантом, если для текущей Сцены ничего не настроено — сценарий 1-в-1 со старым Банком.
  game.settings.register(MODULE_ID, "resourceBackgroundValue", {
    scope: "world",
    config: false,
    type: Number,
    default: 0
  });
  game.settings.register(MODULE_ID, "resourceBackgroundMax", {
    scope: "world",
    config: false,
    type: Number,
    default: 50
  });
  game.settings.register(MODULE_ID, "resourceBackgroundInstability", {
    scope: "world",
    config: false,
    type: Number,
    default: 0
  });
}

export function getCatalog() {
  return game.settings.get(MODULE_ID, "resourceCatalog");
}

export async function setCatalog(catalog) {
  await game.settings.set(MODULE_ID, "resourceCatalog", catalog);
}

/** Создаёт/обновляет Элемент в мировом каталоге (частичные patch-поля, id всегда сохраняется). */
export async function upsertElement(elementId, patch) {
  const catalog = foundry.utils.deepClone(getCatalog());
  const existing = catalog[elementId] ?? { id: elementId, label: elementId, icon: "", tooltip: "", aspects: {} };
  catalog[elementId] = { ...existing, ...patch, id: elementId, aspects: existing.aspects ?? {} };
  await setCatalog(catalog);
  return catalog[elementId];
}

export async function removeElement(elementId) {
  const catalog = foundry.utils.deepClone(getCatalog());
  delete catalog[elementId];
  await setCatalog(catalog);
}

/** Аспект живёт "внутри" родительского Элемента каталога, но как отдельная сущность со своим id. */
export async function upsertAspect(elementId, aspectId, patch) {
  const catalog = foundry.utils.deepClone(getCatalog());
  const element = catalog[elementId];
  if (!element) throw new Error(`Free Magic | upsertAspect: неизвестный Элемент "${elementId}"`);
  const existing = element.aspects[aspectId] ?? { id: aspectId, label: aspectId, icon: "", tooltip: "" };
  element.aspects[aspectId] = { ...existing, ...patch, id: aspectId };
  await setCatalog(catalog);
  return element.aspects[aspectId];
}

export async function removeAspect(elementId, aspectId) {
  const catalog = foundry.utils.deepClone(getCatalog());
  if (!catalog[elementId]) return;
  delete catalog[elementId].aspects[aspectId];
  await setCatalog(catalog);
}

/** Находит запись каталога (Элемент или Аспект) по её ключу — не важно, к какому уровню она относится. */
export function findCatalogEntry(key) {
  const catalog = getCatalog();
  if (catalog[key]) return { entry: catalog[key], parentId: null };
  for (const element of Object.values(catalog)) {
    if (element.aspects?.[key]) return { entry: element.aspects[key], parentId: element.id };
  }
  return null;
}

// --- Флаг Сцены: активные Элементы/Аспекты этой сцены и Фон --------------------------------
//
// sceneId === null/undefined → глобальный запасной вариант (мировые настройки выше).
// sceneId === "<id>" → данные этой конкретной Сцены (флаг на документе Scene). Как и в bank.js,
// если у Сцены ещё нет собственных данных — стартуем от текущих глобальных, а не от нуля.

function getGlobalResourceData() {
  return {
    background: {
      value: game.settings.get(MODULE_ID, "resourceBackgroundValue"),
      max: game.settings.get(MODULE_ID, "resourceBackgroundMax"),
      instability: game.settings.get(MODULE_ID, "resourceBackgroundInstability")
    },
    active: {}
  };
}

async function setGlobalResourceData(data) {
  await game.settings.set(MODULE_ID, "resourceBackgroundValue", data.background.value);
  await game.settings.set(MODULE_ID, "resourceBackgroundMax", data.background.max);
  await game.settings.set(MODULE_ID, "resourceBackgroundInstability", data.background.instability);
  // active намеренно не льём в глобальные настройки — какие Элементы "присутствуют" осмысленно
  // только в привязке к конкретной Сцене (см. раздел 11), у глобального фолбэка своих не бывает.
}

export function getSceneResourceData(sceneId) {
  if (!sceneId) return getGlobalResourceData();
  const scene = game.scenes?.get(sceneId);
  const saved = scene?.getFlag(MODULE_ID, "resource");
  return saved ?? getGlobalResourceData();
}

export async function setSceneResourceData(sceneId, data) {
  if (!sceneId) {
    await setGlobalResourceData(data);
    return;
  }
  const scene = game.scenes?.get(sceneId);
  if (!scene) {
    await setGlobalResourceData(data);
    return;
  }
  await scene.setFlag(MODULE_ID, "resource", data);
}

// --- Магический Фон v2 — перманентная Нестабильность (раздел 11.2) -------------------------
//
// Отличие от старого "замка" в bank.js: instability — счётчик, а не булев флаг. Обнуление Фона
// не просто фиксирует статус "Нестабилен" до пополнения — оно ЗАПОМИНАЕТ, сколько раз это уже
// случилось, и статус остаётся наихудшим независимо от текущего процента, пока ГМ не снимет
// вручную (см. resetBackgroundInstability ниже).

export function computeBackgroundStateKey(value, max, instability) {
  if (instability > 0) return "unstable"; // перманентно, независимо от текущего %
  const pct = max > 0 ? value / max : 0;
  if (pct >= 0.7) return "stable";
  if (pct >= 0.3) return "risk";
  if (value > 0) return "edge";
  return "unstable"; // value === 0 и instability ещё 0 — тот самый момент, когда он ставится
}

export const BACKGROUND_STATE_LABELS = {
  stable: "Фон Стабилен",
  risk: "Риск Аномальности",
  edge: "На Грани",
  unstable: "Фон Нестабилен"
};

/**
 * Единая точка изменения Фона. Клампит в [0, max]; если результат опустился до 0 — тут же
 * "лопается" обратно до максимума, а instability растёт на 1 (см. раздел 11.2 — это не баг,
 * а сама механика: полный сброс числа при одновременном необратимом ухудшении статуса).
 */
export async function setBackgroundValue(newValue, sceneId = null) {
  const current = getSceneResourceData(sceneId);
  const { max } = current.background;
  let value = Math.max(0, Math.min(max, Math.round(newValue)));
  let instability = current.background.instability;

  if (value <= 0) {
    value = max;
    instability += 1;
  }

  await setSceneResourceData(sceneId, { ...current, background: { value, max, instability } });
  return { value, max, instability };
}

export async function setBackgroundMax(newMax, sceneId = null) {
  const current = getSceneResourceData(sceneId);
  const max = Math.max(1, Math.floor(Number(newMax)) || 1);
  const value = Math.min(current.background.value, max);
  await setSceneResourceData(sceneId, {
    ...current,
    background: { value, max, instability: current.background.instability }
  });
  return { value, max };
}

/** Ручной сброс Нестабильности ГМом (кнопка в GM Settings, v0.15) — единственный способ снять её. */
export async function resetBackgroundInstability(sceneId = null) {
  const current = getSceneResourceData(sceneId);
  await setSceneResourceData(sceneId, {
    ...current,
    background: { ...current.background, instability: 0 }
  });
}

export function getBackgroundStatus(sceneId = null) {
  const { value, max, instability } = getSceneResourceData(sceneId).background;
  const stateKey = computeBackgroundStateKey(value, max, instability);
  return { value, max, instability, stateKey, stateLabel: BACKGROUND_STATE_LABELS[stateKey] };
}

// --- Активные Элементы/Аспекты этой Сцены ---------------------------------------------------

/** Включает/выключает Элемент или Аспект на текущей Сцене (чекбокс в GM Settings, вкладка «Эта сцена»). */
export async function setResourceActive(key, isActive, sceneId = null, { initialValue = 0, initialMax = 10 } = {}) {
  const current = getSceneResourceData(sceneId);
  const active = { ...current.active };

  if (isActive) {
    active[key] = active[key] ?? { value: initialValue, max: initialMax };
  } else {
    delete active[key];
  }

  await setSceneResourceData(sceneId, { ...current, active });
}

/** Меняет текущее значение активного Элемента/Аспекта (клик +/- в виджете, раздел 11.3). */
export async function setResourceValue(key, newValue, sceneId = null) {
  const current = getSceneResourceData(sceneId);
  const entry = current.active[key];
  if (!entry) return null; // не активен на этой сцене — менять нечего

  const value = Math.max(0, Math.min(entry.max, Math.round(newValue)));
  const active = { ...current.active, [key]: { ...entry, value } };
  await setSceneResourceData(sceneId, { ...current, active });
  return value;
}

export async function setResourceMax(key, newMax, sceneId = null) {
  const current = getSceneResourceData(sceneId);
  const entry = current.active[key];
  if (!entry) return null;

  const max = Math.max(1, Math.floor(Number(newMax)) || 1);
  const value = Math.min(entry.value, max);
  const active = { ...current.active, [key]: { value, max } };
  await setSceneResourceData(sceneId, { ...current, active });
  return { value, max };
}

// --- Привязка Элемента к персонажу (флаг актора, раздел 11.4 / 13) -------------------------
//
// Массив, а не одно значение — задел на то, что персонаж однажды сможет быть привязан и к
// Аспекту в дополнение к родительскому Элементу (см. раздел 11.4). Пока вкладка «Игроки»
// (раздел 13) редактирует только первый элемент массива через простой выпадающий список.

export function getActorElements(actor) {
  return actor?.getFlag(MODULE_ID, "elements") ?? [];
}

export async function setActorElements(actor, elementIds) {
  const clean = (Array.isArray(elementIds) ? elementIds : [elementIds]).filter(Boolean);
  await actor.setFlag(MODULE_ID, "elements", clean);
  return clean;
}

export function getActiveResourceList(sceneId = null) {
  const catalog = getCatalog();
  const { active } = getSceneResourceData(sceneId);

  const elements = [];
  for (const element of Object.values(catalog)) {
    const own = active[element.id];
    const aspects = Object.values(element.aspects ?? {})
      .filter((aspect) => active[aspect.id])
      .map((aspect) => ({ ...aspect, ...active[aspect.id] }));

    if (!own && aspects.length === 0) continue; // ни сам Элемент, ни его Аспекты не активны — пропускаем
    elements.push({
      ...element,
      ...(own ?? { value: null, max: null }), // Элемент может быть неактивен сам по себе, только с активными Аспектами
      active: Boolean(own),
      aspects
    });
  }
  // --- v0.17: Кто видит точный Фон (раздел 11.4) ---------------------------------------------
//
// Не завязано на конкретный Элемент/Аспект и не механизм на флагах Item (как бонусы Путей) —
// это отдельное разрешение ГМа per-персонаж, редактируется чекбоксом в GM Settings → «Игроки»
// (см. resource-config-app.js). И, по замыслу, действует ГЛОБАЛЬНО: если персонажу открыт Фон,
// игрок видит точные цифры независимо от того, на какой Сцене он сейчас находится — сама
// величина Фона по-прежнему берётся для актуальной для клиента Сцены (см. resource-widget.js),
// меняется только то, разрешено ли ему увидеть число вместо статусной строки.

const REVEALS_BACKGROUND_FLAG = "revealsBackground";

export function getActorRevealsBackground(actor) {
  return Boolean(actor?.getFlag(MODULE_ID, REVEALS_BACKGROUND_FLAG));
}

export async function setActorRevealsBackground(actor, value) {
  const flag = Boolean(value);
  await actor.setFlag(MODULE_ID, REVEALS_BACKGROUND_FLAG, flag);
  return flag;
}
  return elements;
}
