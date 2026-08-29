export const MODULE_ID = "free-magic";

// Уровень — считается автоматически от точного числа Диких Токенов в Банке (абсолютные пороги)
export function getBankLevel(value) {
  if (value >= 25) return { key: "high", label: "Высокий" };
  if (value >= 10) return { key: "normal", label: "Обычный" };
  return { key: "low", label: "Низкий" };
}

export const BANK_STATES = [
  { key: "stable", label: "Стабильно" },
  { key: "risk", label: "Риск" },
  { key: "edge", label: "На грани" },
  { key: "unstable", label: "Нестабилен" }
];

export function getBankStateLabel(key) {
  return BANK_STATES.find((s) => s.key === key)?.label ?? key;
}

// Состояние теперь полностью автоматическое — от процента текущего значения к максимуму:
// 70%+ Стабильно, 30–70% Риск, <30% На грани, 0 (или активный "замок нестабильности") — Нестабилен.
//
// Замок нестабильности: как только Банк доходит до 0, состояние навсегда фиксируется на "Нестабилен",
// даже если Банк потом пополнят — до тех пор, пока он не наполнится обратно ДО максимума (тогда замок
// снимается сам) или пока ГМ не снимет его вручную в окне настройки.
export function computeBankStateKey(value, max, unstableLock) {
  if (unstableLock || value <= 0) return "unstable";
  const pct = max > 0 ? value / max : 0;
  if (pct >= 0.7) return "stable";
  if (pct >= 0.3) return "risk";
  return "edge";
}

// --- Хранилище: глобально (мировые настройки) или во флагах конкретной Сцены ---
//
// sceneId === null/undefined → глобальный Фон (мировые настройки, как было раньше).
// sceneId === "<id>" → Фон этой конкретной Сцены (флаг на самом документе Scene). Если у Сцены
// ещё нет своих данных — используются текущие глобальные как отправная точка (а не нули),
// чтобы новая Сцена не стартовала "из ниоткуда".
//
// Так ГМ может либо держать один Фон на весь мир, либо развести Фон по локациям — окна Круга
// у игроков сами определяют актуальную для них Сцену (см. circle-app.js, canvas.scene).

function getGlobalBankData() {
  return {
    value: game.settings.get(MODULE_ID, "backgroundBankValue"),
    max: game.settings.get(MODULE_ID, "backgroundBankMax"),
    lock: game.settings.get(MODULE_ID, "backgroundBankUnstableLock")
  };
}

async function setGlobalBankData(data) {
  await game.settings.set(MODULE_ID, "backgroundBankValue", data.value);
  await game.settings.set(MODULE_ID, "backgroundBankMax", data.max);
  await game.settings.set(MODULE_ID, "backgroundBankUnstableLock", data.lock);
}

export function getSceneBankData(sceneId) {
  if (!sceneId) return getGlobalBankData();
  const scene = game.scenes?.get(sceneId);
  const saved = scene?.getFlag(MODULE_ID, "bank");
  return saved ?? getGlobalBankData();
}

export async function setSceneBankData(sceneId, data) {
  if (!sceneId) {
    await setGlobalBankData(data);
    return;
  }
  const scene = game.scenes?.get(sceneId);
  if (!scene) {
    await setGlobalBankData(data);
    return;
  }
  await scene.setFlag(MODULE_ID, "bank", data);
}

// Единая точка изменения значения Банка — откуда бы её ни вызывали (взятие игроком, правка ГМом),
// замок нестабильности всегда выставляется/снимается консистентно. sceneId=null — глобальный Фон.
export async function setBankValue(newValue, sceneId = null) {
  const current = getSceneBankData(sceneId);
  const max = current.max;
  const clamped = Math.max(0, Math.min(max, Math.round(newValue)));

  let lock = current.lock;
  if (clamped <= 0) lock = true;
  else if (clamped >= max) lock = false;

  await setSceneBankData(sceneId, { value: clamped, max, lock });
  return clamped;
}

export async function setBankMax(newMax, sceneId = null) {
  const current = getSceneBankData(sceneId);
  const max = Math.max(1, Math.floor(Number(newMax)) || 1);
  const value = Math.min(current.value, max);
  await setSceneBankData(sceneId, { value, max, lock: current.lock });
  return { value, max };
}

export async function setBankUnstableLock(locked, sceneId = null) {
  const current = getSceneBankData(sceneId);
  await setSceneBankData(sceneId, { ...current, lock: Boolean(locked) });
}

export function getBankStatus(sceneId = null) {
  const { value, max, lock } = getSceneBankData(sceneId);
  const stateKey = computeBankStateKey(value, max, lock);
  return {
    value,
    max,
    lock,
    stateKey,
    stateLabel: getBankStateLabel(stateKey),
    level: getBankLevel(value)
  };
}
