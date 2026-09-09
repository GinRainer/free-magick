import { MODULE_ID } from "./modifiers.js";
import { renderIconHtml } from "./icon-utils.js";

// Тэги — предмет типа Feature (свойство), отмеченный чекбоксом «Является тэгом».
// Тэги выносятся в боковую панель на листе персонажа и в боковую панель при Броске Дуальности.
// Хранение — флаг flags.free-magic.isTag на самом предмете, без изменения схемы системы.

export function isTagItem(item) {
  return Boolean(item?.getFlag?.(MODULE_ID, "isTag"));
}

export async function setTagItem(item, isTag) {
  if (!item) return;
  await item.setFlag(MODULE_ID, "isTag", Boolean(isTag));
}

export function getTagItems(actor) {
  if (!actor) return [];
  return actor.items.filter((i) => i.type === "feature" && isTagItem(i));
}

export function getTagSummaries(actor) {
  return getTagItems(actor).map((i) => ({
    key: i.id,
    label: i.name,
    icon: i.img,
    description: i.system?.description?.value ?? i.system?.description ?? i.system?.summary?.value ?? ""
  }));
}

function stripHtml(html) {
  if (!html) return "";
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  return (tmp.textContent || tmp.innerText || "").trim();
}

// --- Чекбокс «Является тэгом» на листе предмета типа Feature ---

const OWN_APP_IDS = new Set([
  "free-magic-circle",
  "free-magic-bank-config",
  "free-magic-gm-viewer",
  "free-magic-resource-config"
]);

function injectTagCheckbox(app, htmlEl) {
  if (OWN_APP_IDS.has(app.id)) return;

  const item = app.document ?? app.object;
  if (!item || item.documentName !== "Item" || item.type !== "feature") return;

  const root = app.element;
  if (!root?.classList?.contains("application")) return;

  root.querySelectorAll(".fm-tag-checkbox-row").forEach((el) => el.remove());

  const isTag = isTagItem(item);

  // Размещаем чекбокс в шапке окна (window-header), слева от кнопки закрытия —
  // тот же приём, что уже надёжно работает для кнопок «Свободная Магия» и «Пути Магии»
  // (см. free-magic.js / sheet-panel.js). Раньше чекбокс вставлялся в начало .window-content,
  // где его перекрывали собственные элементы шапки листа Daggerheart (свойства, иконка),
  // и клик по нему не проходил.
  const header =
    root.querySelector(":scope > .window-header") ??
    root.querySelector(":scope > header") ??
    root.querySelector(".window-header") ??
    root.querySelector(".sheet-header") ??
    root.querySelector("header");

  if (!header) return;

  const row = document.createElement("div");
  row.classList.add("fm-tag-checkbox-row");
  row.innerHTML = `
    <label class="fm-tag-checkbox-label">
      <input type="checkbox" class="fm-tag-checkbox" ${isTag ? "checked" : ""} />
      <i class="fa-solid fa-tag"></i>
      <span>Является тэгом</span>
    </label>
  `;

  const closeBtn =
    header.querySelector('[data-action="close"]') ??
    header.querySelector(".header-control.close") ??
    header.querySelector("a.close, button.close, .close");

  if (closeBtn) {
    header.insertBefore(row, closeBtn);
  } else {
    header.appendChild(row);
  }

  row.querySelector(".fm-tag-checkbox").addEventListener("change", async (ev) => {
    ev.stopPropagation();
    await setTagItem(item, ev.currentTarget.checked);
  });
}

export function registerTagCheckbox() {
  const hooks = ["renderItemSheet", "renderItemSheetV2", "renderApplicationV2", "renderApplication"];
  for (const hookName of hooks) {
    Hooks.on(hookName, (app, htmlEl) => {
      try {
        injectTagCheckbox(app, htmlEl);
      } catch (err) {
        console.error(`Free Magic | Ошибка инъекции чекбокса тэга (хук "${hookName}")`, err);
      }
    });
  }
}

// --- Отдельный контейнер для тэгов на листе персонажа (Sleek UI) ---
// Sleek UI группирует свойства в category-wrapper с data-category-id="heritage|class|..."
// Мы добавляем свой контейнер data-category-id="fm-tags" и перемещаем туда карточки тэгов.

function isTagCard(el) {
  // В Sleek UI карточки предметов несут data-item-uuid; проверяем по нему
  const uuid = el.getAttribute("data-item-uuid");
  if (!uuid) return false;
  const item = fromUuidSync ? fromUuidSync(uuid) : null;
  if (!item) return false;
  return item.type === "feature" && isTagItem(item);
}

function rearrangeTagsOnSheet(app, htmlEl) {
  const root = app.element ?? (htmlEl?.jquery ? htmlEl[0] : htmlEl);
  if (!root) return;

  const featuresTab = root.querySelector(".features-tab");
  if (!featuresTab) return; // не Sleek UI — пропускаем

  // Удаляем старый контейнер, если он уже есть (перерендер)
  featuresTab.querySelectorAll('.category-wrapper[data-category-id="fm-tags"]').forEach((el) => el.remove());

  // Находим все карточки, которые являются тэгами
  const allCards = featuresTab.querySelectorAll("[data-item-uuid]");
  const tagCards = [];
  for (const card of allCards) {
    try {
      if (isTagCard(card)) tagCards.push(card);
    } catch { /* ignore */ }
  }

  if (!tagCards.length) return;

  // Создаём новый category-wrapper по образцу Sleek UI
  const tagWrapper = document.createElement("div");
  tagWrapper.classList.add("category-wrapper");
  tagWrapper.setAttribute("data-category-id", "fm-tags");
  tagWrapper.innerHTML = `
    <div class="category-header" data-action="toggleCategory">
      <h2>Тэги</h2>
      <span class="line"></span>
      <i class="fa-solid fa-chevron-down"></i>
    </div>
    <div class="category-content fm-tags-content"></div>
  `;

  // Вставляем перед extrafeatures (или в конец, если нет)
  const extraFeatures = featuresTab.querySelector('.category-wrapper[data-category-id="extrafeatures"]');
  if (extraFeatures) {
    extraFeatures.before(tagWrapper);
  } else {
    featuresTab.appendChild(tagWrapper);
  }

  // Перемещаем карточки тэгов в новый контейнер
  const content = tagWrapper.querySelector(".fm-tags-content");
  for (const card of tagCards) {
    // Клонируем, чтобы не сломать внутреннюю логику Sleek UI, потом удаляем оригинал
    content.appendChild(card);
  }
}

export function registerTagsOnSheet() {
  for (const hookName of ["renderActorSheet", "renderActorSheetV2", "renderApplicationV2", "renderApplication"]) {
    Hooks.on(hookName, (app, htmlEl) => {
      try {
        rearrangeTagsOnSheet(app, htmlEl);
      } catch (err) {
        console.error(`Free Magic | Ошибка перемещения тэгов на листе (хук "${hookName}")`, err);
      }
    });
  }
}

// --- Боковая панель тэгов в окне Броска Дуальности ---
// D20RollDialog — это ApplicationV2 с классами ["daggerheart","dialog","dh-style","views","roll-selection"].
// Хукаем renderApplicationV2, проверяем классы, и вставляем панель тэгов внутрь диалога.

function isDualityRollDialog(app) {
  const root = app.element;
  if (!root) return false;
  if (!root.classList?.contains("roll-selection")) return false;
  if (!root.classList?.contains("daggerheart")) return false;
  return true;
}

function getActorFromDialog(app) {
  // D20RollDialog хранит config.data.parent — это актор
  return (
    app.config?.data?.parent ??
    app.actor ??
    app.document ??
    null
  );
}

function buildDialogTagsHtml(tags) {
  if (!tags.length) return "";
  const items = tags
    .map((t) => {
      const tooltip = stripHtml(t.description).substring(0, 300);
      const iconHtml = renderIconHtml(t.icon, { className: "fm-dialog-tag-icon" });
      return `<div class="fm-dialog-tag-item" title="${tooltip.replace(/"/g, "&quot;")}">
        ${iconHtml}
        <span class="fm-dialog-tag-name">${t.label}</span>
      </div>`;
    })
    .join("");
  return `
    <div class="fm-dialog-tags-sidebar">
      <div class="fm-dialog-tags-title"><i class="fa-solid fa-tags"></i> Тэги</div>
      <div class="fm-dialog-tags-list">${items}</div>
    </div>
  `;
}

function injectDialogTags(app, htmlEl) {
  if (!isDualityRollDialog(app)) return;
  const actor = getActorFromDialog(app);
  if (!actor) return;
  const tags = getTagSummaries(actor);
  if (!tags.length) return;

  const root = app.element;

  // Удаляем старую панель (перерендер)
  root.querySelectorAll(".fm-dialog-tags-sidebar").forEach((s) => s.remove());

  const wrapper = document.createElement("div");
  wrapper.innerHTML = buildDialogTagsHtml(tags);
  root.appendChild(wrapper.firstElementChild);
}

export function registerDialogTags() {
  for (const hookName of ["renderApplicationV2", "renderApplication"]) {
    Hooks.on(hookName, (app, htmlEl) => {
      try {
        injectDialogTags(app, htmlEl);
      } catch (err) {
        console.error(`Free Magic | Ошибка инъекции тэгов в диалог броска (хук "${hookName}")`, err);
      }
    });
  }
}

// --- Боковая панель тэгов в сообщении чата при Броске Дуальности ---

function isDualityRollMessage(message, htmlEl) {
  const el = htmlEl?.jquery ? htmlEl[0] : htmlEl;
  if (!el) return false;
  if (
    el.querySelector(
      "[data-duality], .duality-roll, .duality-dice, .duality, [data-hope], [data-fear], .hope-fear"
    )
  )
    return true;
  const flags = message?.flags ?? {};
  if (flags.daggerheart?.isDualityRoll || flags.daggerheart?.dualityRoll) return true;
  return false;
}

function getActorFromMessage(message) {
  const speaker = message?.speaker ?? {};
  return (
    game.actors.get(speaker.actor) ??
    canvas.tokens.get(speaker.token)?.actor ??
    message?.actor ??
    null
  );
}

function buildChatTagsHtml(tags) {
  if (!tags.length) return "";
  const items = tags
    .map((t) => {
      const tooltip = stripHtml(t.description).substring(0, 300);
      const iconHtml = renderIconHtml(t.icon, { className: "fm-chat-tag-icon" });
      return `<div class="fm-chat-tag-item" title="${tooltip.replace(/"/g, "&quot;")}">
        ${iconHtml}
        <span class="fm-chat-tag-name">${t.label}</span>
      </div>`;
    })
    .join("");
  return `
    <div class="fm-chat-tags-sidebar">
      <div class="fm-chat-tags-title"><i class="fa-solid fa-tags"></i> Тэги</div>
      <div class="fm-chat-tags-list">${items}</div>
    </div>
  `;
}

function injectChatTags(message, htmlEl) {
  if (!isDualityRollMessage(message, htmlEl)) return;
  const actor = getActorFromMessage(message);
  if (!actor) return;
  const tags = getTagSummaries(actor);
  if (!tags.length) return;

  const el = htmlEl?.jquery ? htmlEl[0] : htmlEl;
  if (!el) return;

  el.querySelectorAll(".fm-chat-tags-sidebar").forEach((s) => s.remove());

  const wrapper = document.createElement("div");
  wrapper.innerHTML = buildChatTagsHtml(tags);
  el.appendChild(wrapper.firstElementChild);
}

export function registerChatTags() {
  const hooks = ["renderChatMessage", "renderChatMessageHTML"];
  for (const hookName of hooks) {
    Hooks.on(hookName, (message, htmlEl) => {
      try {
        injectChatTags(message, htmlEl);
      } catch (err) {
        console.error(`Free Magic | Ошибка инъекции тэгов в сообщение чата (хук "${hookName}")`, err);
      }
    });
  }
}
