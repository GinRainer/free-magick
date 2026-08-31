// Модификаторы v0.20 — три независимых уровня освоения на каждом предмете (Базовое/Освоение/
// Мастерство), каждый со своими Жетонами/Сложностью/Эффектом (см. ModifierDataModel ниже), плюс
// ОБЩИЕ (мировые) модификаторы, настраиваемые ГМом в GM Settings и автоматически подмешиваемые
// в Круг каждого персонажа.
//
// Тип предмета (free-magic.modifier, см. v0.19) не поменялся — просто выросла схема данных.
// Одна и та же DataModel/лист используются и для ЛИЧНЫХ модификаторов (embedded Item на акторе,
// actor.createEmbeddedDocuments) и для ОБЩИХ (мировой Item, Item.createDocuments — Foundry
// хранит его в game.items, без родителя-актора). Это разделение "личный vs общий" целиком
// определяется тем, есть ли у предмета actor-родитель — отдельного флага не потребовалось.
//
// ВАЖНО: этот тип не относится к штатным типам предметов Daggerheart (feature/domain/etc) —
// обычный лист персонажа (и Sleek UI) не знает о нём. Личные — управляются в секции
// «Модификаторы» панели «Пути Магии» на листе персонажа (см. sheet-panel.js). Общие —
// в отдельной вкладке «Модификаторы» окна Настройки ГМа (см. resource-config-app.js).

export const MODULE_ID = "free-magic";
export const MODIFIER_TYPE = `${MODULE_ID}.modifier`;

export const TIER_LABELS = ["Базовое", "Освоение", "Мастерство"];
export const TIER_KEYS = ["tier1", "tier2", "tier3"];

/**
 * Схема данных Item-типа "Модификатор". Регистрируется в free-magic.js (Hooks.once("init"))
 * через CONFIG.Item.dataModels[MODIFIER_TYPE] = ModifierDataModel — стандартный механизм
 * module-defined document sub-types Foundry (v11+).
 *
 * currentTier (1..3) — какой уровень фактически освоен персонажем СЕЙЧАС; именно данные этого
 * уровня (tier1/tier2/tier3) используются в реальном расчёте Круга (см. getModifierSummary).
 * hideLockedTiers — если включено ГМом, эффект/стоимость уровней ВЫШЕ currentTier не видны
 * игроку при открытии листа предмета (см. modifier-sheet.js) — по умолчанию выключено (видно всё).
 */
export class ModifierDataModel extends foundry.abstract.TypeDataModel {
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
      tier1: tierSchema(),
      tier2: tierSchema(),
      tier3: tierSchema()
    };
  }
}

/** HTML нескольких звёзд FontAwesome — заполненные до currentTier включительно, дальше пустые. */
export function renderTierStars(currentTier, { className = "" } = {}) {
  const stars = [1, 2, 3]
    .map((t) => `<i class="${t <= currentTier ? "fa-solid" : "fa-regular"} fa-star"></i>`)
    .join("");
  const title = TIER_LABELS[Math.max(1, Math.min(3, currentTier)) - 1] ?? "";
  return `<span class="fm-tier-stars ${className}" title="${title}">${stars}</span>`;
}

/** Данные текущего (освоенного) уровня конкретного предмета-модификатора. */
function currentTierData(item) {
  const currentTier = Math.max(1, Math.min(3, Number(item.system?.currentTier) || 1));
  const key = TIER_KEYS[currentTier - 1];
  const data = item.system?.[key] ?? { tokenCost: 0, difficultyDelta: 0 };
  return { currentTier, tokenCost: Number(data.tokenCost) || 0, difficultyDelta: Number(data.difficultyDelta) || 0 };
}

function toSummary(item, extra = {}) {
  const tier = currentTierData(item);
  return {
    key: item.id,
    label: item.name,
    icon: item.img,
    currentTier: tier.currentTier,
    tokenCost: tier.tokenCost,
    difficultyDelta: tier.difficultyDelta,
    ...extra
  };
}

// --- Личные модификаторы (Item, embedded на акторе) -----------------------------------------

/** Создаёт новый личный предмет-модификатор на акторе и возвращает его (для открытия листа). */
export async function createModifierItem(actor, name = "Новый модификатор") {
  const [item] = await actor.createEmbeddedDocuments("Item", [{ name, type: MODIFIER_TYPE }]);
  return item;
}

// Сами предметы-модификаторы этого актора (полные документы Item) — для панели листа персонажа.
export function getModifierItems(actor) {
  if (!actor) return [];
  return actor.items.filter((i) => i.type === MODIFIER_TYPE);
}

/** Личные модификаторы актора в виде {key, label, icon, currentTier, tokenCost, difficultyDelta}. */
export function getActorModifiers(actor) {
  return getModifierItems(actor).map((i) => toSummary(i, { isGlobal: false }));
}

// --- Общие (мировые) модификаторы — настраивает ГМ, см. resource-config-app.js -------------

/** Создаёт новый ОБЩИЙ (мировой) предмет-модификатор — без актора-владельца. */
export async function createGlobalModifierItem(name = "Новый общий модификатор") {
  const [item] = await Item.createDocuments([{ name, type: MODIFIER_TYPE }]);
  return item;
}

export function getGlobalModifierItems() {
  return (game.items?.contents ?? []).filter((i) => i.type === MODIFIER_TYPE);
}

export function getGlobalModifiers() {
  return getGlobalModifierItems().map((i) => toSummary(i, { isGlobal: true }));
}

/**
 * Модификаторы, реально доступные в Круге этого актора: личные + общие, ЗА ВЫЧЕТОМ общих,
 * название которых (без учёта регистра/пробелов) совпадает с каким-то личным — по просьбе,
 * "если у игрока Вербальность в 2 звезды, общая Вербальность не должна дублироваться". Личный
 * модификатор с тем же именем полностью заменяет собой общий, а не складывается с ним.
 */
export function getEffectiveModifiers(actor) {
  const personal = getActorModifiers(actor);
  const personalLabels = new Set(personal.map((m) => m.label.trim().toLowerCase()));
  const global = getGlobalModifiers().filter((m) => !personalLabels.has(m.label.trim().toLowerCase()));
  return [...personal, ...global];
}
