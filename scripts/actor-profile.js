// v0.20 — Профиль персонажа в разделе "Пути Магии" (верхняя строка панели, см. sheet-panel.js):
// Элемент (только чтение здесь, назначается в GM Settings → «Игроки», см. scene-resource.js) +
// три новых, редактируемых ТОЛЬКО ГМом поля: Круг, Тип. Заклинательный Лимит уже существовал
// (spellcast-limit.js) — здесь просто отображается/редактируется на самом листе.

export const MODULE_ID = "free-magic";

export const MAGIC_TYPES = [
  { key: "none", label: "Нет Типа" },
  { key: "gifted", label: "Одарённый" },
  { key: "mage", label: "Маг" },
  { key: "conduit", label: "Проводник" }
];

const DEFAULT_MAGIC_CIRCLE = 3;
const DEFAULT_MAGIC_TYPE = "none";

/** Круг — эквивалент уровня для целей Свободной Магии. По умолчанию 3 у всех персонажей. */
export function getMagicCircle(actor) {
  const saved = actor?.getFlag(MODULE_ID, "magicCircle");
  return Number.isFinite(saved) ? saved : DEFAULT_MAGIC_CIRCLE;
}

export async function setMagicCircle(actor, value) {
  const clamped = Math.max(1, Math.floor(Number(value)) || DEFAULT_MAGIC_CIRCLE);
  await actor.setFlag(MODULE_ID, "magicCircle", clamped);
  return clamped;
}

/** Тип — один из четырёх ярлыков (см. MAGIC_TYPES). Пока чисто описательное поле, без
 * автоматического влияния на расчёты Круга — задел на будущие механики, завязанные на тип. */
export function getMagicType(actor) {
  const saved = actor?.getFlag(MODULE_ID, "magicType");
  return MAGIC_TYPES.some((t) => t.key === saved) ? saved : DEFAULT_MAGIC_TYPE;
}

export async function setMagicType(actor, key) {
  const valid = MAGIC_TYPES.some((t) => t.key === key) ? key : DEFAULT_MAGIC_TYPE;
  await actor.setFlag(MODULE_ID, "magicType", valid);
  return valid;
}

export function getMagicTypeLabel(key) {
  return MAGIC_TYPES.find((t) => t.key === key)?.label ?? MAGIC_TYPES[0].label;
}
