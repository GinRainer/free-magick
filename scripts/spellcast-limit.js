// Заклинательный Лимит (раздел 12.3 / 13 дизайн-документа): за одну Активацию нельзя потратить
// Ресурса Элементов больше значения Заклинательной Характеристики персонажа.
//
// По умолчанию читаем автоматически из ролл-данных актора (@cast — подтягивается системой из
// подкласса, см. решение в дизайн-документе). Но, по тому же прецеденту, что уже был с
// Максимумом Цены (v0.10.2 — ГМ получил возможность сам задавать верхний предел вместо жёсткого
// расчёта), ГМ может переопределить конкретному персонажу число вручную — на случай отсутствия
// @cast (NPC/адверсари) или любого другого гомбрю-исключения. Переопределение побеждает авто-значение.

const MODULE_ID = "free-magic";
const OVERRIDE_FLAG = "spellcastLimitOverride";

/** Сырое значение @cast из ролл-данных актора, без учёта переопределения ГМом. Может быть null. */
export function getAutoSpellcastLimit(actor) {
  if (!actor) return null;
  const rollData = actor.getRollData?.();
  const value = foundry.utils.getProperty(rollData ?? {}, "cast");
  return Number.isFinite(value) ? value : null;
}

/** Значение переопределения ГМом (или null, если не задано — тогда используется авто-значение). */
export function getSpellcastLimitOverride(actor) {
  const value = actor?.getFlag(MODULE_ID, OVERRIDE_FLAG);
  return Number.isFinite(value) ? value : null;
}

export async function setSpellcastLimitOverride(actor, value) {
  if (value === null || value === "" || value === undefined) {
    await actor.unsetFlag(MODULE_ID, OVERRIDE_FLAG);
    return null;
  }
  const clamped = Math.max(0, Math.floor(Number(value)) || 0);
  await actor.setFlag(MODULE_ID, OVERRIDE_FLAG, clamped);
  return clamped;
}

/**
 * Итоговый Лимит для отображения/проверки: переопределение ГМа, если задано, иначе @cast,
 * иначе null (у актора нет ни того, ни другого — например, NPC без подкласса с @cast).
 */
export function getSpellcastLimit(actor) {
  const override = getSpellcastLimitOverride(actor);
  if (override !== null) return override;
  return getAutoSpellcastLimit(actor);
}
