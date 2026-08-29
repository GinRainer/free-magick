export const MODULE_ID = "free-magic";

// Шесть Путей Магии — единый источник для окна Круга И панели на листе персонажа,
// чтобы визуальный язык (цвета/иконки) не расходился между двумя интерфейсами.
export const PATHS = [
  { key: "usilenie", label: "Усиление", color: "#7F77DD", icon: "fa-solid fa-bolt" },
  { key: "osoznanie", label: "Осознание", color: "#1D9E75", icon: "fa-solid fa-eye" },
  { key: "kontrol", label: "Контроль", color: "#D85A30", icon: "fa-solid fa-hand" },
  { key: "voplochenie", label: "Воплощение", color: "#D4537E", icon: "fa-solid fa-wand-magic-sparkles" },
  { key: "izmenenie", label: "Изменение", color: "#BA7517", icon: "fa-solid fa-arrows-rotate" },
  { key: "dar", label: "Дар", color: "#378ADD", icon: "fa-solid fa-gift" }
];

const DEFAULT_MANUAL_BASE = 0;

/**
 * Бонус к Пути от Items на акторе. Считает ЛЮБОЙ предмет в инвентаре, у которого выставлены
 * флаги free-magic.direction (= ключ Пути) и free-magic.rank (= число). Это единый механизм
 * для трёх разных источников, о которых просил Влад:
 *  - бонус-предметы, созданные вручную через кнопку в панели (см. sheet-panel.js);
 *  - любой другой Item, если на нём вручную выставить те же флаги;
 *  - предметы, приходящие от Skill Tree при разблокировке скилла — если соответствующий
 *    скилл в дереве помечен теми же флагами, он подхватывается автоматически,
 *    без отдельного кода интеграции.
 */
export function getItemBonusByPath(actor, pathKey) {
  if (!actor) return 0;
  return actor.items
    .filter((i) => i.getFlag(MODULE_ID, "direction") === pathKey)
    .reduce((sum, i) => sum + (Number(i.getFlag(MODULE_ID, "rank")) || 0), 0);
}

// Все предметы-бонусы для Пути (нужно для отображения списка в панели и их удаления)
export function getPathBonusItems(actor, pathKey) {
  if (!actor) return [];
  return actor.items.filter((i) => i.getFlag(MODULE_ID, "direction") === pathKey);
}

export async function getManualPathPools(actor) {
  const base = Object.fromEntries(PATHS.map((p) => [p.key, DEFAULT_MANUAL_BASE]));
  if (!actor) return base;
  const saved = await actor.getFlag(MODULE_ID, "pathPools");
  return saved ? { ...base, ...saved } : base;
}

export async function setManualPathPool(actor, pathKey, value) {
  const pools = await getManualPathPools(actor);
  pools[pathKey] = Math.max(0, Math.floor(Number(value)) || 0);
  await actor.setFlag(MODULE_ID, "pathPools", pools);
  return pools;
}

export function getTotalPathPool(manualValue, itemBonus) {
  return (Number(manualValue) || 0) + (Number(itemBonus) || 0);
}

// --- Максимум Цены персонажа (сколько Стресса максимум можно вложить в заклинание) ---
// Настраивает ГМ — либо прямо в окне Круга (см. circle-app.js), либо быстрым списком в
// окне настройки ГМа (см. bank-config-app.js). Оба места используют эти же функции —
// единый источник правды для ограничения "максимум 10" и формата хранения.
export const PRICE_MAX_BASELINE = 4;
export const PRICE_MAX_CEILING = 10; // "римскими цифрами, до 10 максимум"

export async function getPriceMax(actor) {
  if (!actor) return PRICE_MAX_BASELINE;
  const saved = await actor.getFlag(MODULE_ID, "priceMax");
  return saved !== undefined ? Math.max(0, Math.min(PRICE_MAX_CEILING, Number(saved))) : PRICE_MAX_BASELINE;
}

export async function setPriceMax(actor, value) {
  const clamped = Math.max(0, Math.min(PRICE_MAX_CEILING, Math.floor(Number(value)) || 0));
  await actor.setFlag(MODULE_ID, "priceMax", clamped);
  return clamped;
}
