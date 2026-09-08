// Модификаторы v0.23 — три независимых уровня освоения на каждом предмете (Базовое/Освоение/
// Мастерство), каждый со своими Жетонами/Сложностью/Эффектом (см. ModifierDataModel ниже), плюс
// ОБЩИЕ (мировые) модификаторы, настраиваемые ГМом в GM Settings и автоматически подмешиваемые
// в Круг каждого персонажа, плюс отдельная библиотека «Реакция ГМа» (негативные модификаторы,
// применяются вручную к конкретной сборке — см. resource-config-app.js/gm-viewer-app.js).
//
// v0.21: добавлены два TOP-LEVEL поля (общие для предмета целиком, а не per-tier):
//  - category — произвольный текст, который группирует модификаторы во вкладки в панели Круга
//    (см. circle-app.js, _renderModifiers). Библиотека предметов теперь может расти сколь угодно
//    большой — категории и постраничный вывод внутри них держат панель управляемой.
//  - requirement — опциональный текст условия применения (например «доступно только с Путём
//    Осознание III+»). Модуль НЕ проверяет это условие автоматически — чисто информационная
//    подсказка для игрока/ГМа, ровно как уже принято для похожих полей в проекте (см. Ритуал).
//
// v0.24 — переопределение уровня Общего модификатора на конкретном персонаже: раньше currentTier
// был только на самом предмете (общий для ВСЕХ, кто его использует — открыть лист может только
// тот, у кого есть права на мировой Item, обычно только ГМ). Теперь звёзды на карточке Общего
// модификатора в Круге кликабельны и пишут переопределение во ФЛАГ АКТОРА (не трогая сам предмет),
// см. getGlobalTierOverride/setGlobalTierOverride — у каждого персонажа может быть свой уровень
// освоения одного и того же Общего модификатора, не расходуя отдельный предмет на каждого.
//
// Тип предмета (free-magic.modifier, см. v0.19) не поменялся — просто выросла схема данных.
// Одна и та же DataModel/лист используются и для ЛИЧНЫХ модификаторов (embedded Item на акторе,
// actor.createEmbeddedDocuments) и для ОБЩИХ (мировой Item, Item.createDocuments — Foundry
// хранит его в game.items, без родителя-актора). Это разделение "личный vs общий" целиком
// определяется тем, есть ли у предмета actor-родитель — отдельного флага не потребовалось.
// Именно это уже даёт вам "библиотеку предметов": Общие/Личные Модификаторы — обычные предметы
// Foundry, которые можно держать в компендиуме/папке Items и перетаскивать куда нужно — апдейт
// модуля их не тронет, модуль лишь знает, как читать их схему.
//
// ВАЖНО: этот тип не относится к штатным типам предметов Daggerheart (feature/domain/etc) —
// обычный лист персонажа (и Sleek UI) не знает о нём. Личные — управляются в секции
// «Модификаторы» панели «Пути Магии» на листе персонажа (см. sheet-panel.js). Общие —
// в отдельной вкладке «Модификаторы» окна Настройки ГМа (см. resource-config-app.js).

export const MODULE_ID = "free-magic";
export const MODIFIER_TYPE = `${MODULE_ID}.modifier`;

export const TIER_LABELS = ["Базовое", "Освоение", "Мастерство"];
export const TIER_KEYS = ["tier1", "tier2", "tier3"];

export const DEFAULT_MODIFIER_CATEGORY = "Общие";

/**
 * Схема данных Item-типа "Модификатор". Регистрируется в free-magic.js (Hooks.once("init"))
 * через CONFIG.Item.dataModels[MODIFIER_TYPE] = ModifierDataModel — стандартный механизм
 * module-defined document sub-types Foundry (v11+).
 *
 * currentTier (1..3) — БАЗОВЫЙ уровень предмета (что видно на его собственном листе); реальный
 * эффективный уровень для конкретного персонажа может быть переопределён его личным флагом
 * (см. getGlobalTierOverride) — тогда используются данные tier1/tier2/tier3 всё того же
 * предмета, просто с другим номером уровня.
 * hideLockedTiers — если включено ГМом, эффект/стоимость уровней ВЫШЕ currentTier не видны
 * игроку при открытии листа предмета (см. modifier-sheet.js) — по умолчанию выключено (видно всё).
 * category/requirement — см. пояснение в шапке файла (v0.21).
 */
export class ModifierDataModel extends foundry.abstract.TypeDataModel {
  static DEFAULT_ICON = "icons/svg/dice.svg";

  static defineSchema() {
    const fields = foundry.data.fields;
    const tierSchema = () =>
      new fields.SchemaField({
        effect: new fields.HTMLField({ required: false, blank: true, initial: "" }),
        tokenCost: new fields.NumberField({ required: true, integer: true, initial: 0 }),
        difficultyDelta: new fields.NumberField({ required: true, integer: true, initial: 0 })
      });

    return {
      description: new fields.HTMLField({ required: false, blank: true, initial: "" }),
      currentTier: new fields.NumberField({ required: true, integer: true, initial: 1, min: 1, max: 3 }),
      hideLockedTiers: new fields.BooleanField({ required: true, initial: false }),
      category: new fields.StringField({ required: false, blank: true, initial: DEFAULT_MODIFIER_CATEGORY }),
      requirement: new fields.StringField({ required: false, blank: true, initial: "" }),
      tier1: tierSchema(),
      tier2: tierSchema(),
      tier3: tierSchema()
    };
  }

  /**
   * Фикс совместимости с системой Daggerheart (v0.24): при удалении embedded-предмета Daggerheart
   * безусловно вызывает `item.system.getLinkedItems()` на КАЖДОМ удаляемом предмете, независимо
   * от его типа, чтобы подчистить взаимные ссылки между своими собственными типами предметов
   * (например, при удалении домена-фичи). Наш тип (free-magic.modifier) для системы Daggerheart
   * посторонний и этот метод не реализует — без него `actor.deleteEmbeddedDocuments("Item", [...])`
   * падал с `TypeError: ...system.getLinkedItems is not a function`, и удаление личного
   * Модификатора с листа персонажа не срабатывало вовсе. Связанных предметов в этом смысле у нас
   * нет, поэтому корректный ответ — просто пустой список.
   */
  getLinkedItems() {
    return [];
  }
}

/** HTML нескольких звёзд FontAwesome — заполненные до currentTier включительно, дальше пустые. */
export function renderTierStars(currentTier, { className = "" } = {}) {
  const stars = [1, 2, 3]
    .map((t) => `<i class="${t <= currentTier ? "fa-solid" : "fa-regular"} fa-star" data-tier="${t}"></i>`)
    .join("");
  const title = TIER_LABELS[Math.max(1, Math.min(3, currentTier)) - 1] ?? "";
  return `<span class="fm-tier-stars ${className}" title="${title}">${stars}</span>`;
}

/** Данные конкретного уровня (1..3) предмета-модификатора — без привязки к тому, что записано
 * в system.currentTier (нужно и для базового значения, и для переопределений per-actor). */
function tierDataAt(item, tier) {
  const clamped = Math.max(1, Math.min(3, Number(tier) || 1));
  const key = TIER_KEYS[clamped - 1];
  const data = item.system?.[key] ?? { tokenCost: 0, difficultyDelta: 0 };
  return { tokenCost: Number(data.tokenCost) || 0, difficultyDelta: Number(data.difficultyDelta) || 0 };
}

/**
 * @param {Item} item
 * @param {object} [extra] — дополнительные поля результата (isGlobal/isGmReaction/...)
 * @param {number|null} [tierOverride] — если задан, используется ВМЕСТО item.system.currentTier
 *   (переопределение per-actor для Общих модификаторов, см. getGlobalTierOverride)
 */
function toSummary(item, extra = {}, tierOverride = null) {
  const baseTier = Math.max(1, Math.min(3, Number(item.system?.currentTier) || 1));
  const currentTier = tierOverride ? Math.max(1, Math.min(3, tierOverride)) : baseTier;
  const tier = tierDataAt(item, currentTier);
  return {
    key: item.id,
    label: item.name,
    icon: item.img,
    currentTier,
    baseTier,
    isTierOverridden: Boolean(tierOverride) && tierOverride !== baseTier,
    tokenCost: tier.tokenCost,
    difficultyDelta: tier.difficultyDelta,
    category: (item.system?.category || "").trim() || DEFAULT_MODIFIER_CATEGORY,
    requirement: (item.system?.requirement || "").trim(),
    description: item.system?.description ?? "",
    ...extra
  };
}

// --- Личные модификаторы (Item, embedded на акторе) -----------------------------------------

/** Создаёт новый личный предмет-модификатор на акторе и возвращает его (для открытия листа). */
export async function createModifierItem(actor, name = "Новый модификатор") {
  const [item] = await actor.createEmbeddedDocuments("Item", [{ name, type: MODIFIER_TYPE, img: ModifierDataModel.DEFAULT_ICON }]);
  return item;
}

// Сами предметы-модификаторы этого актора (полные документы Item) — для панели листа персонажа.
export function getModifierItems(actor) {
  if (!actor) return [];
  return actor.items.filter((i) => i.type === MODIFIER_TYPE);
}

/** Личные модификаторы актора в виде {key, label, icon, currentTier, tokenCost, difficultyDelta, category, requirement}. */
export function getActorModifiers(actor) {
  return getModifierItems(actor).map((i) => toSummary(i, { isGlobal: false }));
}

// --- Общие (мировые) модификаторы — настраивает ГМ, см. resource-config-app.js -------------

/** Создаёт новый ОБЩИЙ (мировой) предмет-модификатор — без актора-владельца. */
export async function createGlobalModifierItem(name = "Новый общий модификатор") {
  const [item] = await Item.createDocuments([{ name, type: MODIFIER_TYPE, img: ModifierDataModel.DEFAULT_ICON }]);
  return item;
}

export function getGlobalModifierItems() {
  return (game.items?.contents ?? []).filter((i) => i.type === MODIFIER_TYPE && !isGmReactionItem(i));
}

/** Базовый список Общих модификаторов, БЕЗ учёта чьих-либо персональных переопределений уровня —
 * то, что показывается в самой библиотеке (GM Settings → «Модификаторы»). Для эффективного
 * списка конкретного персонажа используйте getEffectiveModifiers(actor). */
export function getGlobalModifiers() {
  return getGlobalModifierItems().map((i) => toSummary(i, { isGlobal: true }));
}

// --- v0.24: Переопределение уровня освоения Общего модификатора для конкретного персонажа ---
//
// Хранится ФЛАГОМ АКТОРА (не предмета!) — { [itemId]: tier }. Так каждый персонаж может держать
// свой уровень освоения одного и того же Общего модификатора, не заводя себе отдельную копию
// предмета и не трогая настройки, общие для всех остальных, у кого этот же модификатор.
// Редактируется кликом по звёздам прямо на карточке в Круге (см. circle-app.js) — открывать
// лист самого предмета (доступный обычно только ГМу) для этого больше не нужно.

const GLOBAL_TIER_OVERRIDE_FLAG = "globalTierOverrides";

export function getGlobalTierOverride(actor, itemId) {
  const overrides = actor?.getFlag(MODULE_ID, GLOBAL_TIER_OVERRIDE_FLAG) ?? {};
  const value = overrides[itemId];
  return Number.isFinite(value) ? value : null;
}

/** tier === null снимает переопределение (персонаж возвращается к базовому уровню предмета). */
export async function setGlobalTierOverride(actor, itemId, tier) {
  if (!actor) return null;
  const overrides = foundry.utils.deepClone(actor.getFlag(MODULE_ID, GLOBAL_TIER_OVERRIDE_FLAG) ?? {});
  if (tier === null || tier === undefined) {
    delete overrides[itemId];
  } else {
    overrides[itemId] = Math.max(1, Math.min(3, Number(tier) || 1));
  }
  await actor.setFlag(MODULE_ID, GLOBAL_TIER_OVERRIDE_FLAG, overrides);
  return overrides[itemId] ?? null;
}

// --- v0.23: Реакция ГМа — отдельная библиотека предметов-Модификаторов ---------------------
//
// Технически те же предметы типа free-magic.modifier (тот же лист, та же схема Жетоны/Сложность/
// Требования/Категория) — но помеченные флагом flags.free-magic.isGmReaction = true. Это делает
// их НЕВИДИМЫМИ для обычного getGlobalModifierItems()/getEffectiveModifiers() (см. фильтр выше) —
// они никогда не подмешиваются автоматически в Круг персонажа. Вместо этого ГМ применяет их
// вручную к КОНКРЕТНОЙ активной сборке из окна наблюдения (см. gm-viewer-app.js, "Реакция ГМа"),
// откуда они уходят игроку по сокету и показываются у него в Круге красным (см. circle-app.js).
//
// Библиотека наполняется тем же самым перетаскиванием предметов, что и вкладка «Модификаторы»
// в GM Settings (resource-config-app.js) — просто с другим целевым флагом при копировании.

const GM_REACTION_FLAG = "isGmReaction";

export function isGmReactionItem(item) {
  return Boolean(item?.getFlag?.(MODULE_ID, GM_REACTION_FLAG));
}

/** Создаёт новый предмет-Реакцию ГМа — мировой Item, помеченный флагом isGmReaction. */
export async function createGmReactionItem(name = "Новая реакция ГМа") {
  const [item] = await Item.createDocuments([
    { name, type: MODIFIER_TYPE, img: ModifierDataModel.DEFAULT_ICON, flags: { [MODULE_ID]: { [GM_REACTION_FLAG]: true } } }
  ]);
  return item;
}

/** Все предметы библиотеки «Реакция ГМа» (мировые Items, помеченные флагом). */
export function getGmReactionItems() {
  return (game.items?.contents ?? []).filter((i) => i.type === MODIFIER_TYPE && isGmReactionItem(i));
}

/** То же самое в виде summary-объектов ({key,label,icon,tokenCost,difficultyDelta,...}) —
 * для рендера в окне наблюдения ГМа и в Круге игрока (см. circle-app.js). */
export function getGmReactionModifiers() {
  return getGmReactionItems().map((i) => toSummary(i, { isGmReaction: true }));
}

/**
 * Модификаторы, реально доступные в Круге этого актора: личные + общие, ЗА ВЫЧЕТОМ общих,
 * название которых (без учёта регистра/пробелов) совпадает с каким-то личным — по просьбе,
 * "если у игрока Вербальность в 2 звезды, общая Вербальность не должна дублироваться". Личный
 * модификатор с тем же именем полностью заменяет собой общий, а не складывается с ним.
 *
 * v0.24: для Общих модификаторов здесь же подмешивается персональное переопределение уровня
 * (см. getGlobalTierOverride) — именно эта функция определяет, какой уровень реально "виден"
 * и считается в Круге конкретного персонажа.
 */
export function getEffectiveModifiers(actor) {
  const personal = getActorModifiers(actor);
  const personalLabels = new Set(personal.map((m) => m.label.trim().toLowerCase()));
  const overrides = actor?.getFlag(MODULE_ID, GLOBAL_TIER_OVERRIDE_FLAG) ?? {};

  const global = getGlobalModifierItems()
    .filter((i) => !personalLabels.has(i.name.trim().toLowerCase()))
    .map((i) => toSummary(i, { isGlobal: true }, overrides[i.id] ?? null));

  return [...personal, ...global];
}
