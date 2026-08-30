// Модификаторы v0.19 — теперь настоящий Item sub-type Foundry (free-magic.modifier), а не
// предмет-обёртка на флагах поверх generic "feature" (как было в v0.18). Так модификатор можно
// вносить прямо в Skill Tree как обычный предмет системы — при разблокировке скилла можно
// сразу создавать Item именно этого типа, без дополнительной настройки флагов после.
//
// Собственная DataModel (ModifierDataModel ниже) — поэтому у предмета настоящие, декларативные
// поля системы (system.*), а не флаги: описание, эффект, стоимость в жетонах, независимое
// влияние на Сложность. Иконка — стандартное поле item.img, как у любого предмета Foundry
// (никакого отдельного флага-иконки, как было у Модификаторов в v0.18).
//
// ВАЖНО: этот тип не относится к штатным типам предметов Daggerheart (feature/domain/etc) —
// обычный лист персонажа (и Sleek UI) не знает о нём и не покажет такие предметы в инвентаре.
// Единственное штатное место управления ими — секция «Модификаторы» в панели «Пути Магии»
// на листе персонажа (см. sheet-panel.js) — как и договорились, "хранить в разделе Пути Магии".
//
// МИГРАЦИЯ С v0.18: старые предметы-модификаторы (обычные "feature" с флагами isModifier/
// modifierCost/modifierIcon) НЕ становятся автоматически новым типом — этот модуль их больше
// не видит. Если в мире уже создавались тестовые модификаторы по старой схеме, их нужно
// удалить и создать заново новой кнопкой «+ Модификатор» (она теперь создаёт предмет
// правильного типа сразу).

export const MODULE_ID = "free-magic";
export const MODIFIER_TYPE = `${MODULE_ID}.modifier`;

/**
 * Схема данных Item-типа "Модификатор". Регистрируется в free-magic.js (Hooks.once("init"))
 * через CONFIG.Item.dataModels[MODIFIER_TYPE] = ModifierDataModel — стандартный механизм
 * module-defined document sub-types Foundry (v11+).
 *
 * tokenCost и difficultyDelta — НЕЗАВИСИМЫЕ поля (могут быть заполнены оба сразу):
 *  - tokenCost < 0 — модификатор ДАЁТ жетоны (уходят в пул «Токены Маны»).
 *    tokenCost > 0 — модификатор требует ДОПОЛНИТЕЛЬНУЮ стоимость в жетонах.
 *  - difficultyDelta — независимая числовая поправка к итоговой Сложности. НЕ входит в
 *    табличный расчёт категории/DC/Отката (см. circle-app.js _computeDifficulty) — прибавляется
 *    поверх него отдельной строкой вида "+5 к Сложности (Название)" (см. _renderDifficultyModifiers).
 */
export class ModifierDataModel extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      description: new fields.HTMLField({ required: false, blank: true, initial: "" }),
      effect: new fields.HTMLField({ required: false, blank: true, initial: "" }),
      tokenCost: new fields.NumberField({ required: true, integer: true, initial: 0 }),
      difficultyDelta: new fields.NumberField({ required: true, integer: true, initial: 0 })
    };
  }
}

/** Создаёт новый предмет-модификатор на акторе и возвращает его (для немедленного открытия листа). */
export async function createModifierItem(actor, name = "Новый модификатор") {
  const [item] = await actor.createEmbeddedDocuments("Item", [{ name, type: MODIFIER_TYPE }]);
  return item;
}

/** Модификаторы конкретного актора в виде {key, label, icon, tokenCost, difficultyDelta}. */
export function getActorModifiers(actor) {
  if (!actor) return [];
  return actor.items
    .filter((i) => i.type === MODIFIER_TYPE)
    .map((i) => ({
      key: i.id,
      label: i.name,
      icon: i.img,
      tokenCost: Number(i.system?.tokenCost) || 0,
      difficultyDelta: Number(i.system?.difficultyDelta) || 0
    }));
}

// Сами предметы-модификаторы (полные документы Item, не преобразованные) — для списка
// в панели листа персонажа (см. sheet-panel.js) и открытия их собственных листов.
export function getModifierItems(actor) {
  if (!actor) return [];
  return actor.items.filter((i) => i.type === MODIFIER_TYPE);
}
