import { MODULE_ID, PATHS, getItemBonusByPath, getPathBonusItems, getManualPathPools, setManualPathPool, getTotalPathPool } from "./paths.js";
import { getModifierItems, createModifierItem } from "./modifiers.js";

// Открытые/закрытые панели держим в памяти клиента (не персистентно — просто чтобы при
// каждом перерендере листа персонажа (а Foundry делает это часто, на любое изменение актора)
// панель не схлопывалась обратно сама по себе, если пользователь её открыл.
const openState = new Map(); // actorId -> boolean

// Тот же приём, что и для кнопки в шапке листа (see free-magic.js): подписываемся на несколько
// вероятных имён хуков, т.к. неизвестно заранее, какой из них выстрелит для конкретного листа.
const CANDIDATE_HOOKS = ["renderActorSheet", "renderActorSheetV2", "renderApplicationV2", "renderApplication"];

// Шаблон предзагружается один раз при готовности игры, чтобы сама функция инъекции ниже
// была полностью СИНХРОННОЙ. Раньше она была async и ждала renderTemplate — если на один
// и тот же рендер листа срабатывало сразу несколько хуков-кандидатов почти одновременно,
// оба успевали проверить "панели ещё нет" ДО того, как первый вызов дописывал её в DOM,
// и кнопка/панель задваивались (классическая гонка). Без await между проверкой и вставкой
// в DOM гонка невозможна — второй вызов увидит уже добавленную панель.
let cachedPanelHtml = null;

export function registerSheetPanel() {
  Hooks.once("ready", async () => {
    try {
      cachedPanelHtml = await foundry.applications.handlebars.renderTemplate(
        "modules/free-magic/templates/sheet-panel.hbs",
        {}
      );
    } catch (err) {
      console.error("Free Magic | Не удалось предзагрузить шаблон панели листа", err);
    }
  });

  for (const hookName of CANDIDATE_HOOKS) {
    Hooks.on(hookName, (app, htmlEl) => {
      try {
        injectPanel(app, htmlEl);
      } catch (err) {
        console.error(`Free Magic | Ошибка инъекции панели листа (хук "${hookName}")`, err);
      }
    });
  }
}

// Собственные окна модуля (Круг, настройка Банка) тоже проходят через renderApplicationV2
// и тоже имеют свойство .actor — см. подробный комментарий в free-magic.js.
const OWN_APP_IDS = new Set(["free-magic-circle", "free-magic-bank-config", "free-magic-gm-viewer"]);

function injectPanel(app, htmlEl) {
  if (OWN_APP_IDS.has(app.id)) return; // это наше собственное окно, не лист персонажа

  // ВАЖНО: app.document, а не app.actor — см. подробный комментарий в free-magic.js
  // (tryInjectButton) про то, почему app.actor ловил посторонние приложения (листы
  // предметов, сателлитные компоненты сторонних модулей и даже наши собственные окна).
  const actor = app.document ?? app.object;
  if (!actor || actor.documentName !== "Actor" || actor.type !== "character") return;

  // ВАЖНО: app.element, а не htmlEl — см. подробный комментарий в free-magic.js
  // (tryInjectButton) про то, почему это было причиной задвоения кнопки/панели.
  const root = app.element;
  if (!root) return;

  // Настоящее окно приложения Foundry всегда имеет класс "application" на корневом элементе.
  // Мелкие сателлитные компоненты некоторых модулей (например, плавающая панель вкладок
  // Daggerheart Sleek UI) этот класс не несут — не трогаем их вообще.
  if (!root.classList?.contains("application")) return;

  if (!cachedPanelHtml) {
    // Хук сработал раньше, чем успел отработать ready — крайне маловероятно, но на всякий случай
    console.warn("Free Magic | Шаблон панели листа ещё не загружен, попробуем на следующем рендере");
    return;
  }

  // Кнопка-переключатель — в шапке листа, тем же приёмом поиска шапки, что уже надёжно
  // работает для кнопки открытия Круга (см. подробный комментарий в free-magic.js про
  // приоритет прямого потомка корня — важно для листов вроде Daggerheart Sleek UI).
  const header =
    root.querySelector(":scope > .window-header") ??
    root.querySelector(":scope > header") ??
    root.querySelector(".window-header") ??
    root.querySelector(".sheet-header") ??
    root.querySelector("header");

  if (!header) {
    console.warn("Free Magic | Не найдена шапка листа — пропускаю панель, чтобы не добавить её в неподходящее место");
    return;
  }

  // У некоторых модулей-рескинов листа (например, Daggerheart Sleek UI) старая копия панели
  // или кнопки может оказаться в СОВСЕМ ДРУГОМ поддереве DOM — не внутри текущего root, а
  // где-то ещё в документе (полупрозрачная "призрачная" копия). Поэтому чистим не только
  // root, а ВЕСЬ документ — но только копии с тем же ID актора, чтобы не задеть другие листы.
  const previousOpen =
    document.querySelector(`.free-magic-sheet-panel.fm-open[data-actor-id="${actor.id}"]`) !== null;
  document.querySelectorAll(`.free-magic-sheet-panel[data-actor-id="${actor.id}"]`).forEach((el) => el.remove());
  document
    .querySelectorAll(`.free-magic-sheet-toggle-btn[data-actor-id="${actor.id}"]`)
    .forEach((el) => el.remove());

  const panel = document.createElement("div");
  panel.classList.add("free-magic-sheet-panel");
  panel.dataset.actorId = actor.id;
  panel.innerHTML = cachedPanelHtml;
  root.appendChild(panel);

  // Панель выезжает ЗА пределы листа (влево от него), поэтому принудительно снимаем
  // overflow:hidden с корня листа и его вероятного внутреннего контейнера контента —
  // иначе Foundry может обрезать всё, что выходит за собственные границы окна.
  root.style.overflow = "visible";
  const contentEl = root.querySelector(".window-content");
  if (contentEl) contentEl.style.overflow = "visible";

  const toggleBtn = document.createElement("a");
  toggleBtn.classList.add("free-magic-sheet-toggle-btn");
  toggleBtn.dataset.actorId = actor.id;
  toggleBtn.innerHTML = `<i class="fa-solid fa-layer-group"></i> Пути Магии`;
  toggleBtn.style.cursor = "pointer";

  // Вставляем СЛЕВА от кнопки закрытия (крестика), а не в конец шапки
  const closeBtn =
    header.querySelector('[data-action="close"]') ??
    header.querySelector(".header-control.close") ??
    header.querySelector("a.close, button.close, .close");
  if (closeBtn) {
    header.insertBefore(toggleBtn, closeBtn);
  } else {
    header.appendChild(toggleBtn);
  }

  // Состояние открыто/закрыто берём из карты по actor.id (переживает перестройку DOM),
  // а previousOpen — просто подстраховка на случай, если карта почему-то этого actor не знает.
  const isOpen = openState.get(actor.id) ?? previousOpen;
  panel.classList.toggle("fm-open", isOpen);
  toggleBtn.classList.toggle("fm-active", isOpen);

  toggleBtn.addEventListener("click", (ev) => {
    ev.preventDefault();
    const nowOpen = !panel.classList.contains("fm-open");
    openState.set(actor.id, nowOpen);
    panel.classList.toggle("fm-open", nowOpen);
    toggleBtn.classList.toggle("fm-active", nowOpen);
  });

  panel.querySelector(".fm-sheet-close").addEventListener("click", () => {
    openState.set(actor.id, false);
    panel.classList.remove("fm-open");
    toggleBtn.classList.remove("fm-active");
  });

  renderPathsList(panel.querySelector(".fm-sheet-paths-list"), actor);
  renderModifiersList(panel.querySelector(".fm-sheet-modifiers-list"), actor);
}

async function renderPathsList(container, actor) {
  if (!container) return;
  const manualPools = await getManualPathPools(actor);

  container.innerHTML = "";

  for (const path of PATHS) {
    const manual = manualPools[path.key];
    const itemBonus = getItemBonusByPath(actor, path.key);
    const total = getTotalPathPool(manual, itemBonus);
    const bonusItems = getPathBonusItems(actor, path.key);

    const row = document.createElement("div");
    row.classList.add("fm-sheet-path-row");
    row.style.setProperty("--fm-path-color", path.color);

    row.innerHTML = `
      <div class="fm-sheet-path-head">
        <span class="fm-sheet-token"><i class="${path.icon}"></i></span>
        <span class="fm-sheet-path-name">${path.label}</span>
        <span class="fm-sheet-path-total" title="Итого — то, что видит окно Круга">${total}</span>
      </div>
      <div class="fm-sheet-path-detail">
        <label class="fm-sheet-detail-field">
          <span>База</span>
          <input type="number" class="fm-sheet-manual" min="0" value="${manual}" />
        </label>
        <div class="fm-sheet-detail-field">
          <span>Бонус от предметов</span>
          <span class="fm-sheet-bonus-value">+${itemBonus}</span>
        </div>
        <button type="button" class="fm-sheet-add-bonus" title="Добавить предмет-бонус этого Пути">
          <i class="fa-solid fa-plus"></i> Бонус-предмет
        </button>
        ${
          bonusItems.length
            ? `<ul class="fm-sheet-bonus-list">${bonusItems
                .map(
                  (i) =>
                    `<li><span>${i.name} (+${i.getFlag(MODULE_ID, "rank") ?? 0})</span><button type="button" class="fm-sheet-bonus-remove" data-item-id="${i.id}" title="Удалить предмет"><i class="fa-solid fa-xmark"></i></button></li>`
                )
                .join("")}</ul>`
            : ""
        }
      </div>
    `;

    row.querySelector(".fm-sheet-manual").addEventListener("change", async (ev) => {
      await setManualPathPool(actor, path.key, ev.currentTarget.value);
      renderPathsList(container, actor);
    });

    row.querySelector(".fm-sheet-add-bonus").addEventListener("click", () => {
      openAddBonusDialog(actor, path);
    });

    row.querySelectorAll(".fm-sheet-bonus-remove").forEach((btn) => {
      btn.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        const itemId = btn.dataset.itemId;
        await actor.deleteEmbeddedDocuments("Item", [itemId]);
        renderPathsList(container, actor);
      });
    });

    container.appendChild(row);
  }
}

// Простой диалог создания бонус-предмета — не открываем полноценный лист предмета,
// чтобы не отвлекать от панели. Сам предмет после создания можно донастроить как обычно.
function openAddBonusDialog(actor, path) {
  const content = `
    <form class="fm-bonus-dialog">
      <div class="form-group">
        <label>Название предмета</label>
        <input type="text" name="name" value="Бонус: ${path.label}" />
      </div>
      <div class="form-group">
        <label>Величина бонуса</label>
        <input type="number" name="rank" min="1" value="1" />
      </div>
    </form>
  `;

  new foundry.applications.api.DialogV2({
    window: { title: `Новый бонус-предмет — ${path.label}` },
    content,
    buttons: [
      {
        action: "create",
        label: "Создать",
        default: true,
        callback: async (event, button) => {
          const form = button.form;
          const name = form.elements.name.value || `Бонус: ${path.label}`;
          const rank = Math.max(1, Number(form.elements.rank.value) || 1);

          // Тип Item в разных версиях/сборках системы может называться иначе, поэтому не
          // угадываем строку жёстко, а пробуем несколько способов узнать реальный список типов
          // у активной системы, предпочитая "feature", если он там есть.
          const validTypes =
            game.documentTypes?.Item ??
            Object.keys(CONFIG.Item?.dataModels ?? {}) ??
            Object.keys(CONFIG.Item?.typeLabels ?? {}) ??
            [];
          const itemType = validTypes.includes("feature") ? "feature" : validTypes[0];

          if (!itemType) {
            ui.notifications?.error("Не удалось определить тип предмета в этой системе. Сообщите об ошибке разработчику модуля.");
            return;
          }

          try {
            await actor.createEmbeddedDocuments("Item", [
              {
                name,
                type: itemType,
                flags: {
                  [MODULE_ID]: { direction: path.key, rank }
                }
              }
            ]);
          } catch (err) {
            console.error("Free Magic | Не удалось создать бонус-предмет", err);
            ui.notifications?.error(`Не удалось создать предмет (тип "${itemType}"). Подробности в консоли (F12).`);
          }
        }
      },
      { action: "cancel", label: "Отмена" }
    ]
  }).render(true);
}

// --- Модификаторы (v0.19) — настоящий Item sub-type free-magic.modifier (см. modifiers.js),
// а не флаги поверх generic Item, как было в v0.18. Хранятся в инвентаре актора, но видны
// только здесь — обычный лист персонажа/Sleek UI не знает об этом типе (как и договорились,
// "хранить в разделе Пути Магии" — это и есть тот самый раздел).

function renderModifiersList(container, actor) {
  if (!container) return;
  const items = getModifierItems(actor);

  container.innerHTML = `
    <button type="button" class="fm-sheet-add-bonus fm-sheet-add-modifier" title="Создать новый предмет-модификатор">
      <i class="fa-solid fa-plus"></i> Модификатор
    </button>
    ${
      items.length
        ? `<ul class="fm-sheet-bonus-list fm-sheet-modifier-list">${items
            .map((i) => {
              const tokenCost = Number(i.system?.tokenCost) || 0;
              const difficultyDelta = Number(i.system?.difficultyDelta) || 0;
              const badges = [];
              if (tokenCost < 0) badges.push(`+${Math.abs(tokenCost)} Мана`);
              else if (tokenCost > 0) badges.push(`-${tokenCost} жет.`);
              if (difficultyDelta !== 0) badges.push(`${difficultyDelta > 0 ? "+" : ""}${difficultyDelta} Слож.`);
              const badgeText = badges.length ? ` (${badges.join(", ")})` : "";
              return `
                <li data-item-id="${i.id}">
                  <span class="fm-sheet-modifier-name" data-item-id="${i.id}" title="Открыть лист предмета">
                    <img class="fm-sheet-modifier-icon" src="${i.img}" alt="" />
                    ${i.name}${badgeText}
                  </span>
                  <button type="button" class="fm-sheet-bonus-remove" data-item-id="${i.id}" title="Удалить предмет"><i class="fa-solid fa-xmark"></i></button>
                </li>
              `;
            })
            .join("")}</ul>`
        : `<p class="fm-sheet-hint">Модификаторов пока нет — добавьте кнопкой выше.</p>`
    }
  `;

  container.querySelector(".fm-sheet-add-modifier").addEventListener("click", async () => {
    const item = await createModifierItem(actor);
    item?.sheet?.render(true);
    // Foundry сам перерисовывает лист персонажа при создании embedded-документа — это заново
    // вызовет injectPanel() и обновит список, повторный ручной вызов здесь не нужен.
  });

  container.querySelectorAll(".fm-sheet-modifier-name").forEach((el) => {
    el.addEventListener("click", () => {
      const itemId = el.dataset.itemId;
      actor.items.get(itemId)?.sheet?.render(true);
    });
  });

  container.querySelectorAll(".fm-sheet-bonus-remove").forEach((btn) => {
    btn.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      const itemId = btn.dataset.itemId;
      await actor.deleteEmbeddedDocuments("Item", [itemId]);
      renderModifiersList(container, actor);
    });
  });
}
