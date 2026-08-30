// v0.16 — Базовое отображение виджета Ресурса Сцены (раздел 11.3 дизайн-документа).
//
// В отличие от gm-watch.js (виден только ГМу, синхронизируется вручную через сокет, потому что
// хранит эфемерное состояние сборки) — этот виджет виден ВСЕМ подключённым клиентам и хранит
// только настоящие документы (флаг Сцены + мировая настройка-каталог). Поэтому синхронизация
// не нужна руками вообще: Foundry сам рассылает всем клиентам обновления Scene и Setting
// документов, достаточно подписаться на штатные хуки `updateScene`/`updateSetting`.

import {
  MODULE_ID,
  getActiveResourceList,
  getBackgroundStatus,
  setResourceValue,
  getActorElements,
  getActorRevealsBackground
} from "./scene-resource.js";
import { renderIconHtml } from "./icon-utils.js";

let widgetEl = null;
let currentSceneId = null;

export function registerResourceWidget() {
  // scope: "client" — у каждого игрока своя позиция виджета на экране, не общая на весь мир.
  game.settings.register(MODULE_ID, "resourceWidgetPosition", {
    scope: "client",
    config: false,
    type: Object,
    default: null
  });

  Hooks.once("ready", () => {
    ensureWidget();
    currentSceneId = canvas?.scene?.id ?? null;
    renderWidget();
  });

  // Сменилась Сцена, которую видит этот клиент — виджет должен переключиться на её данные
  Hooks.on("canvasReady", () => {
    currentSceneId = canvas?.scene?.id ?? null;
    renderWidget();
  });

  // ГМ поменял что-то в разделе "Эта сцена" GM Settings (или из консоли) — у флага сцены
  // штатная синхронизация Foundry, никакого сокета от нас не требуется.
  Hooks.on("updateScene", (scene, changes) => {
    if (scene.id !== currentSceneId) return;
    if (!foundry.utils.hasProperty(changes, `flags.${MODULE_ID}.resource`)) return;
    renderWidget();
  });

  // ГМ поменял что-то в Каталоге (иконка/название/добавил-удалил Элемент/Аспект) — тоже штатный
  // документ (Setting), тоже рассылается автоматически всем клиентам.
  Hooks.on("updateSetting", (setting) => {
    if (setting.key?.startsWith(`${MODULE_ID}.resource`)) renderWidget();
  });

  // Если у актора, за которого играет этот пользователь, поменялся привязанный Элемент, ИЛИ
  // право видеть точный Фон (v0.17, флаг revealsBackground) — то, что этому клиенту разрешено
  // видеть/трогать в виджете, могло измениться.
  Hooks.on("updateActor", (actor, changes) => {
    if (actor.id !== game.user.character?.id) return;
    const relevant =
      foundry.utils.hasProperty(changes, `flags.${MODULE_ID}.elements`) ||
      foundry.utils.hasProperty(changes, `flags.${MODULE_ID}.revealsBackground`);
    if (relevant) renderWidget();
  });
}

function ensureWidget() {
  if (widgetEl && document.body.contains(widgetEl)) return;
  widgetEl = document.createElement("div");
  widgetEl.id = "free-magic-resource-widget";
  document.body.appendChild(widgetEl);
  applyWidgetPosition(widgetEl);
  attachDragHandlers(widgetEl);
}

/**
 * По умолчанию (пока игрок ни разу не таскал виджет) — центр верхней части экрана, задаётся
 * чисто CSS-классом (раздел .fmrw-default-position), чтобы центрирование само пересчитывалось
 * при изменении ширины виджета (список активных Элементов может расти/сжиматься). Как только
 * виджет один раз перетащили — переходим на явные px из клиентской настройки и больше не
 * пересчитываем центр, ровно так, как обычно ведут себя перетаскиваемые окна в Foundry.
 */
function applyWidgetPosition(el) {
  const saved = game.settings.get(MODULE_ID, "resourceWidgetPosition");
  if (saved && Number.isFinite(saved.left) && Number.isFinite(saved.top)) {
    el.classList.remove("fmrw-default-position");
    el.style.left = `${saved.left}px`;
    el.style.top = `${saved.top}px`;
    el.style.transform = "none";
  } else {
    el.classList.add("fmrw-default-position");
    el.style.left = "";
    el.style.top = "";
    el.style.transform = "";
  }
}

/**
 * Весь виджет можно таскать как единое целое — кроме кнопок +/- (проверяем через closest,
 * чтобы клик по ним не запускал перетаскивание). Слушатели вешаются один раз на сам widgetEl
 * (он не пересоздаётся между renderWidget() — меняется только innerHTML), поэтому переживают
 * любое количество перерисовок списка Элементов.
 */
function attachDragHandlers(el) {
  let dragging = false;
  let offsetX = 0;
  let offsetY = 0;

  el.addEventListener("pointerdown", (ev) => {
    if (ev.target.closest(".fmrw-btn")) return; // не мешаем клику по +/-
    dragging = true;
    el.setPointerCapture(ev.pointerId);
    const rect = el.getBoundingClientRect();
    offsetX = ev.clientX - rect.left;
    offsetY = ev.clientY - rect.top;
    el.classList.remove("fmrw-default-position");
    el.style.transform = "none";
    el.classList.add("fmrw-dragging");
  });

  el.addEventListener("pointermove", (ev) => {
    if (!dragging) return;
    el.style.left = `${ev.clientX - offsetX}px`;
    el.style.top = `${ev.clientY - offsetY}px`;
  });

  const endDrag = async (ev) => {
    if (!dragging) return;
    dragging = false;
    el.classList.remove("fmrw-dragging");
    try {
      el.releasePointerCapture(ev.pointerId);
    } catch {
      /* курсор мог уйти за пределы окна — не критично */
    }
    const rect = el.getBoundingClientRect();
    await game.settings.set(MODULE_ID, "resourceWidgetPosition", { left: rect.left, top: rect.top });
  };
  el.addEventListener("pointerup", endDrag);
  el.addEventListener("pointercancel", endDrag);
}

/**
 * null → видит и может править всё (ГМ). Иначе — набор ключей (Элементы/Аспекты), привязанных
 * к персонажу этого игрока (раздел 11.4) — сверяется с `game.user.character`, тем же способом,
 * которым в разделе 13 ГМ назначает Элемент персонажу.
 */
function viewerElementKeys() {
  if (game.user.isGM) return null;
  const actor = game.user.character;
  return new Set(actor ? getActorElements(actor) : []);
}

/**
 * Может ли этот клиент видеть точное число Фона (value/max + Нестабильность) вместо статусной
 * строки: ГМ — всегда; игрок — если персонажу, за которого он играет, ГМ выставил чекбокс
 * "Видит Фон" (GM Settings → «Игроки», v0.17). Действует глобально — не зависит от того,
 * какую Сцену этот клиент видит прямо сейчас (сама величина Фона всё равно берётся для
 * актуальной Сцены, см. renderWidget ниже — меняется только разрешение её увидеть).
 */
function viewerRevealsBackground() {
  if (game.user.isGM) return true;
  const actor = game.user.character;
  return actor ? getActorRevealsBackground(actor) : false;
}

function canTouch(key, viewerKeys, isGM) {
  return isGM || (viewerKeys && viewerKeys.has(key));
}

export function renderWidget() {
  if (!widgetEl) return;

  const sceneId = currentSceneId;
  const status = getBackgroundStatus(sceneId);
  const elements = getActiveResourceList(sceneId);
  const isGM = game.user.isGM;
  const canSeeExactBackground = viewerRevealsBackground();
  const viewerKeys = viewerElementKeys();

  // Точное число Фона по умолчанию видит только ГМ, либо игрок, которому ГМ явно открыл эту
  // способность через чекбокс "Видит Фон" (см. viewerRevealsBackground, v0.17). Остальным —
  // только статусная строка (Стабилен/Риск/На Грани/Нестабилен).
  const bgText = canSeeExactBackground
    ? `${status.value}/${status.max}${status.instability > 0 ? ` · Нестабильность ${status.instability}` : ""}`
    : status.stateLabel;

  const elementsHtml = elements.map((el) => renderElementBlock(el, viewerKeys, isGM)).join("");

  widgetEl.innerHTML = `
    <div class="fmrw-row fmrw-background fmrw-state-${status.stateKey}">
      <i class="fa-solid fa-hurricane"></i>
      <span>${bgText}</span>
    </div>
    <div class="fmrw-elements">
      ${elementsHtml || (isGM ? `<p class="fmrw-empty-hint">Элементы не активны на этой Сцене — настрой в GM Settings → «Эта сцена».</p>` : "")}
    </div>
  `;

  wireRows(sceneId, viewerKeys, isGM);
}

function renderElementBlock(element, viewerKeys, isGM) {
  const ownRow = element.active ? renderRow(element, viewerKeys, isGM, "fmrw-element") : "";
  const aspectRows = element.aspects.map((aspect) => renderRow(aspect, viewerKeys, isGM, "fmrw-aspect")).join("");
  return ownRow + aspectRows;
}

function renderRow(entry, viewerKeys, isGM, cssClass) {
  const editable = canTouch(entry.id, viewerKeys, isGM);
  const iconHtml = renderIconHtml(entry.icon, { title: entry.tooltip ?? "" });
  return `
    <div class="fmrw-row ${cssClass}" data-key="${entry.id}">
      ${iconHtml}
      <span class="fmrw-label">${entry.label}</span>
      ${
        editable
          ? `<button type="button" class="fmrw-btn fmrw-minus" data-key="${entry.id}">−</button>
             <span class="fmrw-value">${entry.value}/${entry.max}</span>
             <button type="button" class="fmrw-btn fmrw-plus" data-key="${entry.id}">+</button>`
          : ""
      }
    </div>
  `;
}

function wireRows(sceneId, viewerKeys, isGM) {
  widgetEl.querySelectorAll(".fmrw-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const key = btn.dataset.key;
      if (!canTouch(key, viewerKeys, isGM)) return; // страховка — кнопки и так не рендерятся без прав

      const current = findEntryByKey(getActiveResourceList(sceneId), key);
      if (!current) return;

      const delta = btn.classList.contains("fmrw-plus") ? 1 : -1;
      await setResourceValue(key, current.value + delta, sceneId);
      // renderWidget() вызовется сам через хук updateScene у ВСЕХ клиентов, включая этого —
      // повторный локальный вызов здесь не нужен и был бы просто безвредным дублем.
    });
  });
}

function findEntryByKey(list, key) {
  for (const element of list) {
    if (element.id === key) return element;
    const aspect = element.aspects.find((a) => a.id === key);
    if (aspect) return aspect;
  }
  return null;
}
