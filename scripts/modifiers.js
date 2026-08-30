// Модификаторы v0.18 — раньше жёстко захардкожены (v0.1), теперь читаются из Items на акторе,
// тем же единым механизмом на флагах, что уже работает для бонусов Путей (см. paths.js,
// getItemBonusByPath): любой предмет с флагами free-magic.isModifier=true и
// free-magic.modifierCost=N считается модификатором, независимо от того, кто и как его создал —
// кнопка "+ Модификатор" в панели листа персонажа (см. sheet-panel.js) — самый удобный способ,
// но не единственный: сработает и вручную выставленный на любом Item флаг, и предмет, пришедший
// от Skill Tree при разблокировке скилла, помеченного теми же флагами.
//
// cost < 0 — модификатор ДАЁТ жетоны (уходят в пул «Токены Маны»).
// cost > 0 — модификатор требует ДОПОЛНИТЕЛЬНУЮ абстрактную стоимость (не привязана к
// конкретному источнику).
//
// icon (v0.18) — необязательный флаг free-magic.modifierIcon: класс FontAwesome ИЛИ путь к
// файлу-изображению из мира (см. icon-utils.js, renderIconHtml сам разберёт, что перед ним).
//
// Ключ (key) каждого модификатора — id самого Item (стабилен, пока предмет не удалён). Раньше
// это была жёстко заданная строка вроде "verbal"/"ritual" — теперь генерируется автоматически,
// поэтому окно Круга и окно живого наблюдения ГМа (gm-viewer-app.js) читают этот модуль
// одинаково, как и раньше — единый источник правды, просто теперь per-актор, а не глобальный.

export const MODULE_ID = "free-magic";

/** Модификаторы конкретного актора в виде {key, label, cost, icon} — то, что рендерят окна. */
export function getActorModifiers(actor) {
  if (!actor) return [];
  return actor.items
    .filter((i) => i.getFlag(MODULE_ID, "isModifier"))
    .map((i) => ({
      key: i.id,
      label: i.name,
      cost: Number(i.getFlag(MODULE_ID, "modifierCost")) || 0,
      icon: i.getFlag(MODULE_ID, "modifierIcon") ?? ""
    }));
}

// Сами предметы-модификаторы (не преобразованные в {key,label,cost,icon}) — нужны для
// отображения списка в панели листа персонажа и их удаления/редактирования (см. sheet-panel.js).
export function getModifierItems(actor) {
  if (!actor) return [];
  return actor.items.filter((i) => i.getFlag(MODULE_ID, "isModifier"));
}
