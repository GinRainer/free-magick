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

  const row = document.createElement("div");
  row.classList.add("fm-tag-checkbox-row");
  row.innerHTML = `
    <label class="fm-tag-checkbox-label">
      <input type="checkbox" class="fm-tag-checkbox" ${isTag ? "checked" : ""} />
      <i class="fa-solid fa-tag"></i>
      <span>Является тэгом</span>
    </label>
  `;

  const header =
    root.querySelector(":scope > .window-header") ??
    root.querySelector(":scope > header") ??
    root.querySelector(".sheet-header") ??
    root.querySelector(".item-header");

  const content =
    root.querySelector(".window-content") ??
    root.querySelector(".sheet-body") ??
    root.querySelector(".item-body");

  if (header && content) {
    content.prepend(row);
  } else if (content) {
    content.prepend(row);
  } else if (header) {
    header.after(row);
  } else {
    root.prepend(row);
  }

  row.querySelector(".fm-tag-checkbox").addEventListener("change", async (ev) => {
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

// --- Боковая панель тэгов при Броске Дуальности ---

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

function buildDualityTagsHtml(tags) {
  if (!tags.length) return "";
  const items = tags
    .map((t) => {
      const tooltip = stripHtml(t.description).substring(0, 300);
      const iconHtml = renderIconHtml(t.icon, { className: "fm-duality-tag-icon" });
      return `<div class="fm-duality-tag-item" title="${tooltip.replace(/"/g, "&quot;")}">
        ${iconHtml}
        <span class="fm-duality-tag-name">${t.label}</span>
      </div>`;
    })
    .join("");
  return `
    <div class="fm-duality-tags-sidebar">
      <div class="fm-duality-tags-title"><i class="fa-solid fa-tags"></i> Тэги</div>
      <div class="fm-duality-tags-list">${items}</div>
    </div>
  `;
}

function injectDualityTags(message, htmlEl) {
  if (!isDualityRollMessage(message, htmlEl)) return;
  const actor = getActorFromMessage(message);
  if (!actor) return;
  const tags = getTagSummaries(actor);
  if (!tags.length) return;

  const el = htmlEl?.jquery ? htmlEl[0] : htmlEl;
  if (!el) return;

  el.querySelectorAll(".fm-duality-tags-sidebar").forEach((s) => s.remove());

  const wrapper = document.createElement("div");
  wrapper.innerHTML = buildDualityTagsHtml(tags);
  el.appendChild(wrapper.firstElementChild);
}

export function registerDualityTagSidebar() {
  const hooks = ["renderChatMessage", "renderChatMessageHTML"];
  for (const hookName of hooks) {
    Hooks.on(hookName, (message, htmlEl) => {
      try {
        injectDualityTags(message, htmlEl);
      } catch (err) {
        console.error(`Free Magic | Ошибка инъекции тэгов в бросок (хук "${hookName}")`, err);
      }
    });
  }
}
