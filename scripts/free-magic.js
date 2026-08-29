import { FreeMagicCircle } from "./circle-app.js";
import { FreeMagicBankConfig } from "./bank-config-app.js";
import { FreeMagicGmViewer } from "./gm-viewer-app.js";
import { FreeMagicResourceConfig } from "./resource-config-app.js";
import { MODULE_ID, setBankValue, getBankStatus } from "./bank.js";
import { registerSheetPanel } from "./sheet-panel.js";
import { registerGmWatch } from "./gm-watch.js";
import { registerResourceWidget } from "./resource-widget.js";
import * as SceneResource from "./scene-resource.js";

Hooks.once("init", () => {
  console.log("Free Magic | Инициализация модуля");

  registerSheetPanel();
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
    hint: "Каталог Элементов/Аспектов, активный Ресурс на текущей Сцене, параметры игроков (Элемент / Объём Сосуда / Заклинательный Лимит).",
    icon: "fa-solid fa-hurricane",
    type: FreeMagicResourceConfig,
    restricted: true
  });

  // Мировой счётчик банка Магического Фона (видит и правит только ГМ)
  // TODO(v0.15+): этот блок (backgroundBank*) станет избыточным, когда Базовое/Упрощённое
  // отображение виджета переедет на scene-resource.js — Фон переезжает туда полностью
  // (см. дизайн-документ, раздел 11.2, "⟳ Пересмотрено"). Пока не трогаем, чтобы не сломать
  // рабочий v0.13 раньше времени.
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
  console.log("Free Magic | Модуль готов");

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
      // v0.15: старые макросы указывали на FreeMagicBankConfig — подтягиваем команду
      // на новое окно настройки, чтобы не пришлось пересоздавать макрос руками на каждую версию.
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

    // Ищем первый свободный слот на хотбаре (1..50) и кладём макрос туда
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
const OWN_APP_IDS = new Set(["free-magic-circle", "free-magic-bank-config", "free-magic-gm-viewer"]);

function tryInjectButton(app, htmlEl, hookName) {
  if (OWN_APP_IDS.has(app.id)) return; // это наше собственное окно, не лист персонажа

  // ВАЖНО: используем app.document, а НЕ app.actor. У app.actor есть много посторонних
  // приложений — например, лист ПРЕДМЕТА, вложенного в актора, тоже имеет удобное свойство
  // .actor, указывающее на владельца, но сам лист при этом относится к Item, а не к Actor.
  // app.document — это именно тот документ, который редактирует ЭТО приложение; для листа
  // персонажа он будет Actor, для листа предмета — Item, и т.д. Это отличает настоящий
  // лист персонажа от чего угодно другого, что просто "знает" об этом персонаже.
  const actor = app.document ?? app.object;
  if (!actor || actor.documentName !== "Actor" || actor.type !== "character") return;

  console.log(`Free Magic | Хук "${hookName}" сработал для актора`, actor.name, app);

  const root = app.element;
  if (!root) {
    console.warn("Free Magic | Не удалось получить корневой DOM-элемент листа (app.element пуст)");
    return;
  }

  // Дополнительная защита: некоторые модули (например, Daggerheart Sleek UI) рендерят
  // мелкие сателлитные компоненты (плавающая панель вкладок и т.п.), которые тоже проходят
  // через рендер-хуки. Настоящее окно приложения Foundry всегда имеет класс "application"
  // на корневом элементе — если его нет, это не лист персонажа, и мы вообще ничего не трогаем
  // (в том числе не удаляем уже существующую кнопку — раньше баг был именно в этом: такие
  // "чужие" срабатывания стирали настоящую кнопку и не создавали её заново).
  if (!root.classList?.contains("application")) {
    console.log(`Free Magic | Пропускаю "${hookName}" — это не окно приложения (root без класса .application)`, root);
    return;
  }

  // Прежде всего ищем ПРЯМОГО потомка корня — это всегда настоящая шапка окна Foundry
  // (её рендерит сам движок при отрисовке окна, а не система/модуль листа). Только если
  // такого нет — расширяем поиск вглубь DOM.
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

  // ВАЖНО: у некоторых модулей-рескинов листа (например, Daggerheart Sleek UI) старая копия
  // нашей кнопки может оказаться в СОВСЕМ ДРУГОМ поддереве DOM — не внутри текущего root,
  // а где-то ещё в документе (полупрозрачная "призрачная" копия на скриншотах). Поэтому чистим
  // не только root, а ВЕСЬ документ — но только копии, помеченные тем же ID актора, чтобы не
  // трогать кнопки на листах других персонажей.
  document.querySelectorAll(`.free-magic-open-btn[data-actor-id="${actor.id}"]`).forEach((el) => el.remove());

  const btn = document.createElement("a");
  btn.classList.add("free-magic-open-btn");
  btn.dataset.actorId = actor.id;
  btn.innerHTML = `<i class="fa-solid fa-circle-nodes"></i> Свободная Магия`;
  btn.style.cursor = "pointer";
  btn.addEventListener("click", (ev) => {
    ev.preventDefault();
    new FreeMagicCircle({ actor }).render(true);
  });

  // Вставляем СЛЕВА от кнопки закрытия (крестика), а не в конец шапки
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

// Глобальный доступ для макросов: открыть Круг вручную, либо (для ГМа) окна настройки Банка/наблюдения.
// SceneResource — весь модуль v0.14 целиком, чтобы можно было проверить модель данных из консоли
// (например, SceneResource.setResourceActive("fire", true, canvas.scene.id)) ещё до того, как
// появится собственный UI поверх неё (v0.15+).
window.FreeMagic = { FreeMagicCircle, FreeMagicBankConfig, FreeMagicGmViewer, FreeMagicResourceConfig, SceneResource };
