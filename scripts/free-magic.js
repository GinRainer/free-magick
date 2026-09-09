import { FreeMagicCircle } from "./circle-app.js";
import { FreeMagicBankConfig } from "./bank-config-app.js";
import { FreeMagicGmViewer } from "./gm-viewer-app.js";
import { FreeMagicResourceConfig } from "./resource-config-app.js";
import { MODULE_ID, setBankValue, getBankStatus } from "./bank.js";
import { registerSheetPanel } from "./sheet-panel.js";
import { registerGmWatch } from "./gm-watch.js";
import { registerResourceWidget } from "./resource-widget.js";
import * as SceneResource from "./scene-resource.js";
import { ModifierDataModel, MODIFIER_TYPE } from "./modifiers.js";
import * as Modifiers from "./modifiers.js";
import { FreeMagicModifierSheet } from "./modifier-sheet.js";
import { registerTagCheckbox, registerTagsOnSheet, registerDialogTags, registerChatTags } from "./tags.js";

// v0.25.2 — ДИАГНОСТИКА: этот лог выполняется на ВЕРХНЕМ УРОВНЕ модуля, в момент, когда браузер
// просто ЗАГРУЖАЕТ и парсит файл — без каких-либо хуков Foundry, без проверок роли пользователя,
// без открытия окон. Если этой строки нет в консоли конкретного клиента вообще — это железное
// доказательство, что клиент работает со СТАРОЙ версией файла (не обновилось на сервере, кэш
// браузера, или смотрит не в ту папку модуля) — и никакой код внутри модуля вообще не имеет
// значения, пока это не решено. Если строка ЕСТЬ — файл точно свежий, и проблему нужно искать
// дальше по журналу (см. другие [FM DIAGNOSTIC] строки ниже).
console.log("%c[FM DIAGNOSTIC] free-magic.js загружен, версия модуля 0.25.4", "background:#9166ea;color:#fff;padding:2px 6px;border-radius:3px;");

Hooks.once("init", () => {
  console.log("Free Magic | Инициализация модуля");

  CONFIG.Item.dataModels[MODIFIER_TYPE] = ModifierDataModel;
  foundry.applications.apps.DocumentSheetConfig.registerSheet(Item, MODULE_ID, FreeMagicModifierSheet, {
    types: [MODIFIER_TYPE],
    makeDefault: true,
    label: "Модификатор Магии"
  });

  registerSheetPanel();
  registerTagCheckbox();
  registerTagsOnSheet();
  registerDialogTags();
  registerChatTags();
  registerGmWatch();
  registerResourceWidget(); // v0.16 — Базовое отображение Ресурса Сцены, виден всем клиентам
  SceneResource.registerSceneResourceSettings(); // v0.14 — модель данных Ресурса Сцены (раздел 11), UI ещё впереди (v0.15+)

  // Кнопка в стандартной вкладке Settings (Настройки игры → «Свободная Магия») — постоянный,
  // не зависящий от хотбара способ открыть окно GM Settings v2. Виден только ГМу (restricted).
  // Хотбар-макрос (см. ensureGmConfigMacro ниже) остаётся как более быстрый способ открыть
  // то же самое одним кликом прямо со сцены — оба пути ведут в одно и то же окно.
  game.settings.registerMenu(MODULE_ID, "resourceConfigMenu", {
    name: "Настройка ГМа",
    label: "Открыть окно настройки",
    hint: "Каталог Элементов/Аспектов, активный Ресурс на текущей Сцене, параметры игроков (Элемент / Аспект / Объём Сосуда / Заклинательный Лимит), Модификаторы, Реакция ГМа.",
    icon: "fa-solid fa-hurricane",
    type: FreeMagicResourceConfig,
    restricted: true
  });

  // Мировой счётчик банка Магического Фона (видит и правит только ГМ)
  game.settings.register(MODULE_ID, "backgroundBankValue", {
    scope: "world",
    config: false,
    type: Number,
    default: 0
  });

  // Максимум Банка — от него считается и Состояние (% от максимума), и порог "полного восстановления"
  game.settings.register(MODULE_ID, "backgroundBankMax", {
    scope: "world",
    config: false,
    type: Number,
    default: 50
  });

  // "Замок нестабильности": выставляется автоматически, когда Банк доходит до 0,
  // и держит Состояние на "Нестабилен" даже после пополнения — пока не наполнится до максимума
  // или пока ГМ не снимет замок вручную (см. scripts/bank.js — computeBankStateKey/setBankValue).
  game.settings.register(MODULE_ID, "backgroundBankUnstableLock", {
    scope: "world",
    config: false,
    type: Boolean,
    default: false
  });
});

Hooks.once("ready", () => {
  console.log("%c[FM DIAGNOSTIC] Hooks.ready сработал. Я:", "background:#9166ea;color:#fff;padding:2px 6px;border-radius:3px;", {
    userName: game.user?.name,
    userId: game.user?.id,
    isGM: game.user?.isGM,
    character: game.user?.character?.name ?? "(нет назначенного персонажа)"
  });

  if (game.user.isGM) ensureGmConfigMacro();

  // Игроки обычно не могут менять мировые настройки/флаги Сцены напрямую — их запрос на
  // взятие из Банка Магического Фона приходит сюда, и любой ГМ-клиент его обрабатывает.
  game.socket.on(`module.${MODULE_ID}`, async (data) => {
    if (!game.user.isGM) return;
    if (data?.action !== "drawBank") return;

    const amount = Number(data.amount) || 1;
    const sceneId = data.sceneId ?? null;
    const current = getBankStatus(sceneId).value;
    const next = await setBankValue(current - amount, sceneId);
    console.log(
      `Free Magic | Обработан запрос на взятие ${amount} из Банка${sceneId ? ` (Сцена ${sceneId})` : " (глобально)"} (${current} → ${next})`
    );
  });
});

// Создаёт макрос «Свободная Магия — Настройка ГМа» на хотбаре у ГМа при первом запуске
// (если он уже есть — только обновляет команду, если она устарела с прошлой версии модуля;
// помечаем свой макрос флагом, чтобы найти его снова между перезапусками).
const GM_CONFIG_MACRO_COMMAND = `new FreeMagic.FreeMagicResourceConfig().render(true);`;

async function ensureGmConfigMacro() {
  try {
    const existing = game.macros.find((m) => m.getFlag(MODULE_ID, "isGmConfigMacro"));
    if (existing) {
      if (existing.command !== GM_CONFIG_MACRO_COMMAND) {
        await existing.update({ command: GM_CONFIG_MACRO_COMMAND });
        console.log("Free Magic | Команда макроса настройки ГМа обновлена под текущую версию");
      }
      return;
    }

    const macro = await Macro.create({
      name: "Свободная Магия — Настройка ГМа",
      type: "script",
      img: "icons/svg/hazard.svg",
      command: GM_CONFIG_MACRO_COMMAND,
      flags: { [MODULE_ID]: { isGmConfigMacro: true } }
    });

    const occupied = new Set(Object.values(game.user.hotbar ?? {}));
    let slot = null;
    for (let i = 1; i <= 50; i++) {
      if (!occupied.has(i)) {
        slot = i;
        break;
      }
    }
    if (slot) await game.user.assignHotbarMacro(macro, slot);

    console.log("Free Magic | Создан макрос настройки ГМа", macro, "слот хотбара:", slot);
  } catch (err) {
    console.warn("Free Magic | Не удалось создать макрос настройки ГМа автоматически", err);
  }
}

// Кнопка на листе персонажа, открывающая Круг Свободной Магии.
// Подписываемся сразу на несколько возможных имён хуков, т.к. неизвестно заранее,
// построен ли лист Foundryborne на старом ActorSheet (V1) или на ApplicationV2.
const CANDIDATE_HOOKS = [
  "renderActorSheet",
  "renderActorSheetV2",
  "renderApplicationV2",
  "renderApplication"
];

// Собственные окна модуля тоже проходят через renderApplicationV2 (это универсальный хук,
// срабатывающий на ЛЮБое приложение) — и у FreeMagicCircle/FreeMagicBankConfig тоже есть
// свойство .actor, так что их легко спутать с самим листом персонажа. Явно исключаем по ID.
const OWN_APP_IDS = new Set([
  "free-magic-circle",
  "free-magic-tokens-panel",
  "free-magic-bank-config",
  "free-magic-gm-viewer",
  "free-magic-resource-config"
]);

function tryInjectButton(app, htmlEl, hookName) {
  if (OWN_APP_IDS.has(app.id)) return; // это наше собственное окно, не лист персонажа

  const actor = app.document ?? app.object;
  if (!actor || actor.documentName !== "Actor" || actor.type !== "character") return;

  console.log(`Free Magic | Хук "${hookName}" сработал для актора`, actor.name, app);

  const root = app.element;
  if (!root) {
    console.warn("Free Magic | Не удалось получить корневой DOM-элемент листа (app.element пуст)");
    return;
  }

  if (!root.classList?.contains("application")) {
    console.log(`Free Magic | Пропускаю "${hookName}" — это не окно приложения (root без класса .application)`, root);
    return;
  }

  const header =
    root.querySelector(":scope > .window-header") ??
    root.querySelector(":scope > header") ??
    root.querySelector(".window-header") ??
    root.querySelector(".sheet-header") ??
    root.querySelector("header");

  if (!header) {
    console.warn("Free Magic | Не найдена шапка листа — пропускаю, чтобы не добавить кнопку в неподходящее место");
    return;
  }

  document.querySelectorAll(`.free-magic-open-btn[data-actor-id="${actor.id}"]`).forEach((el) => el.remove());

  const btn = document.createElement("a");
  btn.classList.add("free-magic-open-btn");
  btn.dataset.actorId = actor.id;
  btn.innerHTML = `<i class="fa-solid fa-circle-nodes"></i> Свободная Магия`;
  btn.style.cursor = "pointer";
  btn.addEventListener("click", (ev) => {
    ev.preventDefault();
    console.log("%c[FM DIAGNOSTIC] Клик по кнопке «Свободная Магия»", "background:#9166ea;color:#fff;padding:2px 6px;border-radius:3px;", {
      actorName: actor.name,
      actorId: actor.id,
      isGM: game.user?.isGM
    });
    try {
      const circle = new FreeMagicCircle({ actor });
      circle.render(true);
      console.log("[FM DIAGNOSTIC] FreeMagicCircle создан и render(true) вызван без исключений");
    } catch (err) {
      console.error("[FM DIAGNOSTIC] Исключение при создании/рендере FreeMagicCircle", err);
    }
  });

  const closeBtn =
    header.querySelector('[data-action="close"]') ??
    header.querySelector(".header-control.close") ??
    header.querySelector("a.close, button.close, .close");
  if (closeBtn) {
    header.insertBefore(btn, closeBtn);
  } else {
    header.appendChild(btn);
  }
  console.log("Free Magic | Кнопка добавлена на лист", actor.name);
}

for (const hookName of CANDIDATE_HOOKS) {
  Hooks.on(hookName, (app, htmlEl) => {
    try {
      tryInjectButton(app, htmlEl, hookName);
    } catch (err) {
      console.error(`Free Magic | Ошибка в обработчике хука "${hookName}"`, err);
    }
  });
}

window.FreeMagic = {
  FreeMagicCircle,
  FreeMagicBankConfig,
  FreeMagicGmViewer,
  FreeMagicResourceConfig,
  SceneResource,
  Modifiers
};
