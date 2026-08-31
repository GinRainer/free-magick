import { MODULE_ID, PATHS, getItemBonusByPath, getPathBonusItems, getManualPathPools, setManualPathPool, getTotalPathPool } from "./paths.js";
import { getModifierItems, createModifierItem, getEffectiveModifiers, renderTierStars } from "./modifiers.js";
import { renderIconHtml } from "./icon-utils.js";
import { getActorElements, findCatalogEntry } from "./scene-resource.js";
import { getMagicCircle, setMagicCircle, getMagicType, setMagicType, getMagicTypeLabel, MAGIC_TYPES } from "./actor-profile.js";
import { getAutoSpellcastLimit, getSpellcastLimitOverride, setSpellcastLimitOverride, getSpellcastLimit } from "./spellcast-limit.js";

// Открытые/закрытые панели и активная вкладка держим в памяти клиента (не персистентно —
// просто чтобы при каждом перерендере листа персонажа (а Foundry делает это часто, на любое
// изменение актора) панель не схлопывалась и не сбрасывала вкладку сама по себе.
const openState = new Map(); // actorId -> boolean
const activeTabState = new Map(); // actorId -> "paths" | "modifiers"

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

  // v0.20: если ГМ поменял Общий модификатор (мировой Item) прямо в Настройке ГМа, вкладка
  // «Модификаторы» на уже открытых панелях листов должна обновиться сама.
  const onGlobalModifierChange = (item) => {
    if (item.parent) return; // это личный предмет актора, не мировой — его обрабатывает injectPanel
    document.querySelectorAll(".free-magic-sheet-panel[data-actor-id]").forEach((panelEl) => {
      const actor = game.actors?.get(panelEl.dataset.actorId);
      if (!actor) return;
      renderModifiersTab(panelEl.querySelector(".fm-sheet-modifiers-tab-body"), actor);
    });
  };
  Hooks.on("createItem", onGlobalModifierChange);
  Hooks.on("updateItem", onGlobalModifierChange);
  Hooks.on("deleteItem", onGlobalModifierChange);
}

// Собственные окна модуля (Круг, настройка Банка) тоже проходят через renderApplicationV2
// и тоже имеют свойство .actor — см. подробный комментарий в free-magic.js.
const OWN_APP_IDS = new Set(["free-magic-circle", "free-magic-bank-config", "free-magic-gm-viewer", "free-magic-resource-config"]);

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

  wireTabs(panel, actor);
  renderProfileRow(panel.querySelector(".fm-sheet-profile-row"), actor);
  renderPathsList(panel.querySelector(".fm-sheet-paths-list"), actor);
  renderModifiersTab(panel.querySelector(".fm-sheet-modifiers-tab-body"), actor);
}

// --- Вкладки «Пути Магии» / «Модификаторы» (v0.20) ------------------------------------------

function wireTabs(panel, actor) {
  const tabButtons = panel.querySelectorAll(".fm-sheet-tab-btn");
  const panels = panel.querySelectorAll(".fm-sheet-tab-panel");
  const activeTab = activeTabState.get(actor.id) ?? "paths";

  const applyTab = (tab) => {
    tabButtons.forEach((btn) => btn.classList.toggle("fm-sheet-tab-active", btn.dataset.tab === tab));
    panels.forEach((p) => {
      p.hidden = p.dataset.tabPanel !== tab;
    });
  };
  applyTab(activeTab);

  tabButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      activeTabState.set(actor.id, btn.dataset.tab);
      applyTab(btn.dataset.tab);
    });
  });
}

// --- Строка профиля наверху вкладки «Пути Магии» (v0.20) ------------------------------------
// Элемент — только чтение (назначается в GM Settings → «Игроки», см. scene-resource.js).
// Круг / Тип / переопределение Заклинательного Лимита — редактирует ТОЛЬКО ГМ, игрок видит
// итоговое значение без права правки (тот же принцип, что уже применён к Максимуму Цены).

function renderProfileRow(container, actor) {
  if (!container) return;
  const isGM = game.user.isGM;

  // Элемент
  const elementId = getActorElements(actor)[0];
  const elementEntry = elementId ? findCatalogEntry(elementId)?.entry : null;
  const elementValueEl = container.querySelector('[data-field="element"] .fm-sheet-profile-value');
  elementValueEl.innerHTML = elementEntry
    ? `${renderIconHtml(elementEntry.icon, { className: "fm-sheet-profile-icon" })}${elementEntry.label}`
    : `<span class="fm-sheet-profile-empty">— не назначен</span>`;

  // Круг (эквивалент уровня, по умолчанию 3)
  const circleValueEl = container.querySelector('[data-field="circle"] .fm-sheet-profile-value');
  const circle = getMagicCircle(actor);
  if (isGM) {
    circleValueEl.innerHTML = `<input type="number" class="fm-sheet-profile-input" min="1" value="${circle}" />`;
    circleValueEl.querySelector("input").addEventListener("change", async (ev) => {
      const clamped = await setMagicCircle(actor, ev.currentTarget.value);
      ev.currentTarget.value = clamped;
    });
  } else {
    circleValueEl.textContent = circle;
  }

  // Тип (Одарённый / Маг / Проводник / Нет Типа)
  const typeValueEl = container.querySelector('[data-field="type"] .fm-sheet-profile-value');
  const type = getMagicType(actor);
  if (isGM) {
    typeValueEl.innerHTML = `<select class="fm-sheet-profile-select">
      ${MAGIC_TYPES.map((t) => `<option value="${t.key}" ${t.key === type ? "selected" : ""}>${t.label}</option>`).join("")}
    </select>`;
    typeValueEl.querySelector("select").addEventListener("change", async (ev) => {
      await setMagicType(actor, ev.currentTarget.value);
    });
  } else {
    typeValueEl.textContent = getMagicTypeLabel(type);
  }

  // Заклинательный Лимит — по умолчанию из @cast, переопределение правит только ГМ
  const limitValueEl = container.querySelector('[data-field="limit"] .fm-sheet-profile-value');
  const autoLimit = getAutoSpellcastLimit(actor);
  if (isGM) {
    const override = getSpellcastLimitOverride(actor);
    limitValueEl.innerHTML = `<input type="number" class="fm-sheet-profile-input" min="0"
      placeholder="${autoLimit ?? "нет @cast"}" value="${override ?? ""}"
      title="Пусто = автоматически из @cast (сейчас: ${autoLimit ?? "нет"})" />`;
    limitValueEl.querySelector("input").addEventListener("change", async (ev) => {
      const result = await setSpellcastLimitOverride(actor, ev.currentTarget.value);
      ev.currentTarget.value = result ?? "";
    });
  } else {
    const effective = getSpellcastLimit(actor);
    limitValueEl.textContent = effective ?? "—";
  }
}

// --- Токены Путей (без изменений по сути, просто теперь внутри вкладки) --------------------

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

// --- Вкладка «Модификаторы» (v0.20) — личные (полное управление) + общие (только просмотр,
// настраиваются ГМом в отдельной вкладке окна Настройки, см. resource-config-app.js) --------

function modifierBadgesHtml(tokenCost, difficultyDelta) {
  const badges = [];
  if (tokenCost < 0) badges.push(`<span class="fm-sheet-mod-badge">+${Math.abs(tokenCost)} Мана</span>`);
  else if (tokenCost > 0) badges.push(`<span class="fm-sheet-mod-badge">-${tokenCost} жет.</span>`);
  if (difficultyDelta !== 0) {
    badges.push(
      `<span class="fm-sheet-mod-badge fm-sheet-mod-badge-difficulty">${difficultyDelta > 0 ? "+" : ""}${difficultyDelta} Слож.</span>`
    );
  }
  return badges.join("");
}

function renderPersonalModifierCard(item) {
  const currentTier = Math.max(1, Math.min(3, Number(item.system?.currentTier) || 1));
  const tierData = item.system?.[`tier${currentTier}`] ?? { tokenCost: 0, difficultyDelta: 0 };
  const badges = modifierBadgesHtml(Number(tierData.tokenCost) || 0, Number(tierData.difficultyDelta) || 0);

  return `
    <div class="fm-sheet-mod-card fm-sheet-mod-card-tier-${currentTier}" data-item-id="${item.id}" title="Открыть лист предмета">
      <img class="fm-sheet-mod-card-icon" src="${item.img}" alt="" />
      <div class="fm-sheet-mod-card-main">
        <div class="fm-sheet-mod-card-name">${item.name}</div>
        ${renderTierStars(currentTier, { className: "fm-sheet-mod-card-stars" })}
        <div class="fm-sheet-mod-card-badges">${badges}</div>
      </div>
      <button type="button" class="fm-sheet-mod-remove" data-item-id="${item.id}" title="Удалить предмет">
        <i class="fa-solid fa-xmark"></i>
      </button>
    </div>
  `;
}

function renderGlobalModifierCard(mod) {
  const badges = modifierBadgesHtml(mod.tokenCost, mod.difficultyDelta);
  return `
    <div class="fm-sheet-mod-card fm-sheet-mod-card-tier-${mod.currentTier} fm-sheet-mod-card-readonly">
      <img class="fm-sheet-mod-card-icon" src="${mod.icon}" alt="" />
      <div class="fm-sheet-mod-card-main">
        <div class="fm-sheet-mod-card-name">${mod.label} <span class="fm-mod-global-tag">Общий</span></div>
        ${renderTierStars(mod.currentTier, { className: "fm-sheet-mod-card-stars" })}
        <div class="fm-sheet-mod-card-badges">${badges}</div>
      </div>
    </div>
  `;
}

function renderModifiersTab(container, actor) {
  if (!container) return;
  const personalItems = getModifierItems(actor);
  // getEffectiveModifiers уже сама убирает Общие, у которых есть личный тёзка (см. modifiers.js)
  const globalOnly = getEffectiveModifiers(actor).filter((m) => m.isGlobal);

  container.innerHTML = `
    <div class="fm-sheet-mods-section">
      <div class="fm-sheet-mods-section-head">
        <h3>Личные модификаторы</h3>
        <button type="button" class="fm-sheet-add-modifier" title="Создать новый предмет-модификатор">
          <i class="fa-solid fa-plus"></i> Модификатор
        </button>
      </div>
      <p class="fm-sheet-hint">Клик по карточке — открыть лист предмета (там настраиваются все три уровня освоения). Личный модификатор с тем же названием, что и Общий, полностью его заменяет.</p>
      <div class="fm-sheet-mods-cards">
        ${
          personalItems.length
            ? personalItems.map((i) => renderPersonalModifierCard(i)).join("")
            : `<p class="fm-sheet-hint">Личных модификаторов пока нет — добавьте кнопкой выше.</p>`
        }
      </div>
    </div>

    <div class="fm-sheet-mods-section">
      <h3>Общие модификаторы <span class="fm-sheet-mods-hint-inline">(настроены ГМом в Настройке ГМа, доступны всем)</span></h3>
      <div class="fm-sheet-mods-cards">
        ${
          globalOnly.length
            ? globalOnly.map((m) => renderGlobalModifierCard(m)).join("")
            : `<p class="fm-sheet-hint">Общих модификаторов пока нет.</p>`
        }
      </div>
    </div>
  `;

  container.querySelector(".fm-sheet-add-modifier").addEventListener("click", async () => {
    const item = await createModifierItem(actor);
    item?.sheet?.render(true);
    // Foundry сам перерисовывает лист персонажа при создании embedded-документа — это заново
    // вызовет injectPanel() и обновит список, повторный ручной вызов здесь не нужен.
  });

  container.querySelectorAll(".fm-sheet-mod-card[data-item-id]").forEach((card) => {
    card.addEventListener("click", (ev) => {
      if (ev.target.closest(".fm-sheet-mod-remove")) return;
      const itemId = card.dataset.itemId;
      actor.items.get(itemId)?.sheet?.render(true);
    });
  });

  container.querySelectorAll(".fm-sheet-mod-remove").forEach((btn) => {
    btn.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      const itemId = btn.dataset.itemId;
      await actor.deleteEmbeddedDocuments("Item", [itemId]);
      renderModifiersTab(container, actor);
    });
  });
}
