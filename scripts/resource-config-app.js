// v0.15 — Окно настройки ГМа v2 (раздел 11.3 / 13 дизайн-документа).
// Пять вкладок в одном окне:
//  - «Каталог»  — мировой список Элементов/Аспектов (редко трогать)
//  - «Эта сцена» — максимум Фона, иконка Фона (v0.23), какие Элементы активны и их стартовые значения
//  - «Игроки»   — Элемент / Аспект (v0.21) / Объём Сосуда (Максимум Цены) / Заклинательный
//                 Лимит / Видит Фон на персонажа, всё в одном месте (раньше Максимум Цены
//                 редактировался из окна Круга — убрано)
//  - «Модификаторы» (v0.20) — ОБЩИЕ модификаторы, доступные сразу всем персонажам
//  - «Реакция ГМа» (v0.23) — отдельная библиотека НЕГАТИВНЫХ модификаторов, которые ГМ применяет
//                 вручную к конкретной активной сборке (см. gm-viewer-app.js) — никогда не
//                 подмешиваются автоматически, в отличие от вкладки «Модификаторы»

import {
  getCatalog,
  upsertElement,
  removeElement,
  upsertAspect,
  removeAspect,
  getSceneResourceData,
  getBackgroundStatus,
  getBackgroundIcon,
  setBackgroundIcon,
  setBackgroundValue,
  setBackgroundMax,
  resetBackgroundInstability,
  setResourceActive,
  setResourceValue,
  setResourceMax,
  getActorElements,
  setActorElements,
  getActorAspect,
  setActorAspect,
  getActorRevealsBackground,
  setActorRevealsBackground
} from "./scene-resource.js";
import { getPriceMax, setPriceMax, PRICE_MAX_CEILING } from "./paths.js";
import { getAutoSpellcastLimit, getSpellcastLimitOverride, setSpellcastLimitOverride } from "./spellcast-limit.js";
import { renderIconHtml, browseForIconFile } from "./icon-utils.js";
import { getGlobalModifierItems, createGlobalModifierItem, renderTierStars, MODIFIER_TYPE, MODULE_ID, getGmReactionItems, createGmReactionItem, isGmReactionItem } from "./modifiers.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class FreeMagicResourceConfig extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "free-magic-resource-config",
    tag: "form",
    window: {
      title: "Настройка ГМа — Свободная Магия",
      icon: "fa-solid fa-hurricane",
      resizable: true
    },
    position: { width: 700, height: 640 }
  };

  static PARTS = {
    body: { template: "modules/free-magic/templates/resource-config.hbs" }
  };

  constructor(options = {}) {
    super(options);
    this.activeTab = "catalog";
    this.selectedSceneId = canvas?.scene?.id ?? "";
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    const root = this.element;

    root.querySelectorAll(".fmrc-tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => this._switchTab(root, btn.dataset.tab));
    });
    this._switchTab(root, this.activeTab);

    this._renderCatalogTab(root);
    this._renderSceneTab(root);
    await this._renderPlayersTab(root);
    this._renderModifiersTab(root);
    this._renderReactionsTab(root);
  }

  _switchTab(root, tab) {
    this.activeTab = tab;
    root.querySelectorAll(".fmrc-tab-btn").forEach((btn) => {
      btn.classList.toggle("fmrc-tab-active", btn.dataset.tab === tab);
    });
    root.querySelectorAll(".fmrc-panel").forEach((panel) => {
      panel.hidden = panel.dataset.tabPanel !== tab;
    });
  }

  _sceneId() {
    return this.selectedSceneId || null;
  }

  // =====================================================================================
  // Вкладка «Каталог» — мировой список Элементов/Аспектов
  // =====================================================================================

  _renderCatalogTab(root) {
    const panel = root.querySelector('[data-tab-panel="catalog"]');
    const catalog = getCatalog();
    const elements = Object.values(catalog);

    panel.innerHTML = `
      <p class="fmrc-hint">Мировой список — редко меняется, задаёт иконку/тултип для каждого Элемента и его Аспектов. То, активен ли Элемент прямо сейчас, настраивается на вкладке «Эта сцена».</p>
      <div class="fmrc-catalog-list">
        ${elements.map((el) => this._catalogElementRow(el)).join("")}
      </div>
      <div class="fmrc-add-row">
        <input type="text" class="fmrc-new-element-id" placeholder="id (например: void)" />
        <input type="text" class="fmrc-new-element-label" placeholder="Название" />
        <button type="button" class="fmrc-add-element"><i class="fa-solid fa-plus"></i> Добавить Элемент</button>
      </div>
    `;

    this._wireCatalogTab(root, panel);
  }

  _catalogElementRow(element) {
    const aspects = Object.values(element.aspects ?? {});
    return `
      <div class="fmrc-catalog-element" data-element-id="${element.id}">
        <div class="fmrc-catalog-row">
          <input type="text" class="fmrc-el-icon" value="${element.icon ?? ""}" placeholder="fa-solid fa-fire или путь к файлу" title="Класс FontAwesome или путь к файлу-изображению из мира" />
          <button type="button" class="fmrc-icon-browse" title="Выбрать файл из мира Foundry"><i class="fa-solid fa-folder-open"></i></button>
          <span class="fmrc-icon-preview">${renderIconHtml(element.icon)}</span>
          <input type="text" class="fmrc-el-label" value="${element.label ?? ""}" placeholder="Название" />
          <button type="button" class="fmrc-el-remove" title="Удалить Элемент"><i class="fa-solid fa-trash"></i></button>
        </div>
        <input type="text" class="fmrc-el-tooltip" value="${element.tooltip ?? ""}" placeholder="Тултип" />
        <div class="fmrc-aspect-list">
          ${aspects.map((a) => this._catalogAspectRow(element.id, a)).join("")}
        </div>
        <div class="fmrc-add-row fmrc-add-aspect-row">
          <input type="text" class="fmrc-new-aspect-id" placeholder="id аспекта" />
          <input type="text" class="fmrc-new-aspect-label" placeholder="Название аспекта" />
          <button type="button" class="fmrc-add-aspect"><i class="fa-solid fa-plus"></i> Аспект</button>
        </div>
      </div>
    `;
  }

  _catalogAspectRow(elementId, aspect) {
    return `
      <div class="fmrc-catalog-aspect" data-element-id="${elementId}" data-aspect-id="${aspect.id}">
        <input type="text" class="fmrc-as-icon" value="${aspect.icon ?? ""}" placeholder="fa-solid fa-... или файл" />
        <button type="button" class="fmrc-icon-browse" title="Выбрать файл из мира Foundry"><i class="fa-solid fa-folder-open"></i></button>
        <span class="fmrc-icon-preview">${renderIconHtml(aspect.icon)}</span>
        <input type="text" class="fmrc-as-label" value="${aspect.label ?? ""}" placeholder="Название" />
        <input type="text" class="fmrc-as-tooltip" value="${aspect.tooltip ?? ""}" placeholder="Тултип" />
        <button type="button" class="fmrc-as-remove" title="Удалить Аспект"><i class="fa-solid fa-trash"></i></button>
      </div>
    `;
  }

  _wireCatalogTab(root, panel) {
    panel.querySelectorAll(".fmrc-catalog-element").forEach((row) => {
      const elementId = row.dataset.elementId;

      row.querySelector(".fmrc-el-icon").addEventListener("change", async (ev) => {
        await upsertElement(elementId, { icon: ev.currentTarget.value });
        this._renderCatalogTab(root);
        this._renderSceneTab(root); // иконки используются и там
      });
      row.querySelector(".fmrc-el-label").addEventListener("change", async (ev) => {
        await upsertElement(elementId, { label: ev.currentTarget.value });
        this._renderCatalogTab(root);
        this._renderSceneTab(root);
        this._renderPlayersTab(root); // название Элемента используется в выпадающем списке игроков
      });
      row.querySelector(".fmrc-el-tooltip").addEventListener("change", async (ev) => {
        await upsertElement(elementId, { tooltip: ev.currentTarget.value });
      });
      row.querySelector(":scope > .fmrc-catalog-row > .fmrc-icon-browse").addEventListener("click", () => {
        const iconInput = row.querySelector(":scope > .fmrc-catalog-row > .fmrc-el-icon");
        browseForIconFile(iconInput.value, async (path) => {
          await upsertElement(elementId, { icon: path });
          this._renderCatalogTab(root);
          this._renderSceneTab(root);
        });
      });
      row.querySelector(".fmrc-el-remove").addEventListener("click", async () => {
        await removeElement(elementId);
        this._renderCatalogTab(root);
        this._renderSceneTab(root);
        this._renderPlayersTab(root); // список Элементов/Аспектов в выпадающем списке игроков тоже меняется
      });

      row.querySelectorAll(".fmrc-catalog-aspect").forEach((aspectRow) => {
        const aspectId = aspectRow.dataset.aspectId;

        aspectRow.querySelector(".fmrc-as-icon").addEventListener("change", async (ev) => {
          await upsertAspect(elementId, aspectId, { icon: ev.currentTarget.value });
          this._renderCatalogTab(root);
          this._renderSceneTab(root);
        });
        aspectRow.querySelector(".fmrc-as-label").addEventListener("change", async (ev) => {
          await upsertAspect(elementId, aspectId, { label: ev.currentTarget.value });
          this._renderCatalogTab(root);
          this._renderSceneTab(root);
          this._renderPlayersTab(root); // название Аспекта используется в выпадающем списке игроков
        });
        aspectRow.querySelector(".fmrc-as-tooltip").addEventListener("change", async (ev) => {
          await upsertAspect(elementId, aspectId, { tooltip: ev.currentTarget.value });
        });
        aspectRow.querySelector(".fmrc-icon-browse").addEventListener("click", () => {
          const iconInput = aspectRow.querySelector(".fmrc-as-icon");
          browseForIconFile(iconInput.value, async (path) => {
            await upsertAspect(elementId, aspectId, { icon: path });
            this._renderCatalogTab(root);
            this._renderSceneTab(root);
          });
        });
        aspectRow.querySelector(".fmrc-as-remove").addEventListener("click", async () => {
          await removeAspect(elementId, aspectId);
          this._renderCatalogTab(root);
          this._renderSceneTab(root);
          this._renderPlayersTab(root); // если у кого-то был выбран именно этот Аспект — список обновится
        });
      });

      row.querySelector(".fmrc-add-aspect").addEventListener("click", async () => {
        const idInput = row.querySelector(".fmrc-new-aspect-id");
        const labelInput = row.querySelector(".fmrc-new-aspect-label");
        const id = idInput.value.trim();
        if (!id) return;
        await upsertAspect(elementId, id, { label: labelInput.value.trim() || id, icon: "", tooltip: "" });
        this._renderCatalogTab(root);
        this._renderSceneTab(root);
        this._renderPlayersTab(root);
      });
    });

    panel.querySelector(".fmrc-add-element").addEventListener("click", async () => {
      const idInput = panel.querySelector(".fmrc-new-element-id");
      const labelInput = panel.querySelector(".fmrc-new-element-label");
      const id = idInput.value.trim();
      if (!id) return;
      await upsertElement(id, { label: labelInput.value.trim() || id, icon: "", tooltip: "" });
      this._renderCatalogTab(root);
      this._renderSceneTab(root);
      this._renderPlayersTab(root);
    });
  }

  // =====================================================================================
  // Вкладка «Эта сцена» — Фон v2 + активные Элементы/Аспекты
  // =====================================================================================

  _renderSceneTab(root) {
    const panel = root.querySelector('[data-tab-panel="scene"]');
    const scenes = game.scenes?.contents ?? [];
    const status = getBackgroundStatus(this._sceneId());
    const catalog = getCatalog();
    const { active } = getSceneResourceData(this._sceneId());

    panel.innerHTML = `
      <div class="fmrc-scene-select-row">
        <label>Сцена:</label>
        <select class="fmrc-scene-select">
          <option value="">Глобально (без привязки к Сцене)</option>
          ${scenes.map((s) => `<option value="${s.id}" ${s.id === this.selectedSceneId ? "selected" : ""}>${s.name}</option>`).join("")}
        </select>
      </div>

      <fieldset class="fmrc-background-block">
        <legend>Магический Фон</legend>
        <div class="fmrc-bg-icon-row">
          <label>Иконка</label>
          <input type="text" class="fmrc-bg-icon" value="${getBackgroundIcon()}" placeholder="fa-solid fa-hurricane или путь к файлу" title="Класс FontAwesome или путь к файлу-изображению из мира" />
          <button type="button" class="fmrc-icon-browse fmrc-bg-icon-browse" title="Выбрать файл из мира Foundry"><i class="fa-solid fa-folder-open"></i></button>
          <span class="fmrc-icon-preview">${renderIconHtml(getBackgroundIcon())}</span>
        </div>
        <p class="fmrc-hint">Эта иконка используется везде, где показан Магический Фон — виджет Ресурса Сцены и кнопка Нестабильности рядом с Кругом в окне Сборки.</p>
        <div class="fmrc-bg-row">
          <label>Значение</label>
          <input type="number" class="fmrc-bg-value" min="0" max="${status.max}" value="${status.value}" />
          <label>Максимум</label>
          <input type="number" class="fmrc-bg-max" min="1" value="${status.max}" />
        </div>
        <div class="fmrc-bg-status">
          Статус: <strong>${status.stateLabel}</strong>
          ${status.instability > 0 ? `<span class="fmrc-bg-instability"> (Нестабильность: ${status.instability})</span>` : ""}
        </div>
        ${status.instability > 0 ? `<button type="button" class="fmrc-bg-reset-instability">Сбросить Нестабильность</button>` : ""}
      </fieldset>

      <fieldset class="fmrc-active-block">
        <legend>Элементы и Аспекты на этой Сцене</legend>
        <div class="fmrc-active-list">
          ${Object.values(catalog).map((el) => this._sceneElementRow(el, active)).join("")}
        </div>
      </fieldset>
    `;

    this._wireSceneTab(root, panel);
  }

  _sceneElementRow(element, active) {
    const own = active[element.id];
    const aspects = Object.values(element.aspects ?? {});
    return `
      <div class="fmrc-active-element">
        <div class="fmrc-active-row" data-key="${element.id}">
          <label>
            <input type="checkbox" class="fmrc-active-toggle" ${own ? "checked" : ""} />
            <i class="${element.icon ?? ""}"></i> ${element.label}
          </label>
          ${
            own
              ? `<input type="number" class="fmrc-active-value" min="0" max="${own.max}" value="${own.value}" />
                 <span>/</span>
                 <input type="number" class="fmrc-active-max" min="1" value="${own.max}" />`
              : ""
          }
        </div>
        ${aspects
          .map((aspect) => {
            const ownAspect = active[aspect.id];
            return `
              <div class="fmrc-active-row fmrc-active-aspect-row" data-key="${aspect.id}">
                <label>
                  <input type="checkbox" class="fmrc-active-toggle" ${ownAspect ? "checked" : ""} />
                  <i class="${aspect.icon ?? ""}"></i> ${aspect.label}
                </label>
                ${
                  ownAspect
                    ? `<input type="number" class="fmrc-active-value" min="0" max="${ownAspect.max}" value="${ownAspect.value}" />
                       <span>/</span>
                       <input type="number" class="fmrc-active-max" min="1" value="${ownAspect.max}" />`
                    : ""
                }
              </div>
            `;
          })
          .join("")}
      </div>
    `;
  }

  _wireSceneTab(root, panel) {
    panel.querySelector(".fmrc-scene-select").addEventListener("change", (ev) => {
      this.selectedSceneId = ev.currentTarget.value;
      this._renderSceneTab(root);
    });

    panel.querySelector(".fmrc-bg-value").addEventListener("change", async (ev) => {
      await setBackgroundValue(Number(ev.currentTarget.value) || 0, this._sceneId());
      this._renderSceneTab(root);
    });
    panel.querySelector(".fmrc-bg-max").addEventListener("change", async (ev) => {
      await setBackgroundMax(Number(ev.currentTarget.value) || 1, this._sceneId());
      this._renderSceneTab(root);
    });
    panel.querySelector(".fmrc-bg-reset-instability")?.addEventListener("click", async () => {
      await resetBackgroundInstability(this._sceneId());
      this._renderSceneTab(root);
    });

    // v0.23 — Иконка Магического Фона (мировая настройка, не по Сцене — см. scene-resource.js)
    panel.querySelector(".fmrc-bg-icon").addEventListener("change", async (ev) => {
      await setBackgroundIcon(ev.currentTarget.value);
      this._renderSceneTab(root);
    });
    panel.querySelector(".fmrc-bg-icon-browse").addEventListener("click", () => {
      const iconInput = panel.querySelector(".fmrc-bg-icon");
      browseForIconFile(iconInput.value, async (path) => {
        await setBackgroundIcon(path);
        this._renderSceneTab(root);
      });
    });

    panel.querySelectorAll(".fmrc-active-row").forEach((row) => {
      const key = row.dataset.key;

      row.querySelector(".fmrc-active-toggle").addEventListener("change", async (ev) => {
        await setResourceActive(key, ev.currentTarget.checked, this._sceneId());
        this._renderSceneTab(root);
      });
      row.querySelector(".fmrc-active-value")?.addEventListener("change", async (ev) => {
        await setResourceValue(key, Number(ev.currentTarget.value) || 0, this._sceneId());
        this._renderSceneTab(root);
      });
      row.querySelector(".fmrc-active-max")?.addEventListener("change", async (ev) => {
        await setResourceMax(key, Number(ev.currentTarget.value) || 1, this._sceneId());
        this._renderSceneTab(root);
      });
    });
  }

  // =====================================================================================
  // Вкладка «Игроки» — Элемент / Аспект (v0.21) / Объём Сосуда / Заклинательный Лимит /
  // Видит Фон (v0.17), всё в одном месте (раздел 13) — раньше Объём Сосуда (Максимум Цены)
  // редактировался из окна Круга, убрано
  // =====================================================================================

  _playerCharacters() {
    return (game.actors?.contents ?? [])
      .filter((a) => a.type === "character")
      .filter((a) => a.hasPlayerOwner)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async _renderPlayersTab(root) {
    const panel = root.querySelector('[data-tab-panel="players"]');
    const actors = this._playerCharacters();
    const catalog = getCatalog();
    const elementOptions = Object.values(catalog);

    if (actors.length === 0) {
      panel.innerHTML = `<p class="fmrc-hint">Персонажей игроков не найдено (актор должен принадлежать игроку).</p>`;
      return;
    }

    const rows = actors.map((actor) => {
      const currentElement = getActorElements(actor)[0] ?? "";
      const currentAspect = getActorAspect(actor) ?? "";
      const priceMaxPromise = getPriceMax(actor);
      const autoLimit = getAutoSpellcastLimit(actor);
      const override = getSpellcastLimitOverride(actor);
      const revealsBackground = getActorRevealsBackground(actor);
      return { actor, currentElement, currentAspect, priceMaxPromise, autoLimit, override, revealsBackground };
    });

    const priceMaxValues = await Promise.all(rows.map((r) => r.priceMaxPromise));

    panel.innerHTML = `
      <div class="fmrc-players-header">
        <span>Персонаж</span>
        <span>Элемент</span>
        <span>Аспект</span>
        <span>Объём Сосуда</span>
        <span>Закл. Лимит</span>
        <span>Видит Фон</span>
      </div>
      <div class="fmrc-players-list">
        ${rows
          .map((r, i) => {
            // v0.21: список Аспектов зависит от ВЫБРАННОГО у этого персонажа Элемента — если
            // Элемент не выбран, или у него нет Аспектов вовсе, поле недоступно (не пусто
            // "на всякий случай", а честно disabled — нечего выбирать).
            const elementAspects = elementOptions.find((el) => el.id === r.currentElement)?.aspects ?? {};
            const aspectList = Object.values(elementAspects);
            const hasAspects = aspectList.length > 0;

            return `
          <div class="fmrc-player-row" data-actor-id="${r.actor.id}">
            <span class="fmrc-player-name">${r.actor.name}</span>
            <select class="fmrc-player-element">
              <option value="">—</option>
              ${elementOptions
                .map(
                  (el) =>
                    `<option value="${el.id}" ${el.id === r.currentElement ? "selected" : ""}>${el.label}</option>`
                )
                .join("")}
            </select>
            <select class="fmrc-player-aspect" ${hasAspects ? "" : "disabled"} title="${hasAspects ? "" : "У выбранного Элемента нет Аспектов (или Элемент не выбран)"}">
              <option value="">—</option>
              ${aspectList
                .map((a) => `<option value="${a.id}" ${a.id === r.currentAspect ? "selected" : ""}>${a.label}</option>`)
                .join("")}
            </select>
            <input type="number" class="fmrc-player-price" min="0" max="${PRICE_MAX_CEILING}" value="${priceMaxValues[i]}" />
            <input type="number" class="fmrc-player-limit" min="0"
                   placeholder="${r.autoLimit ?? "нет @cast"}"
                   value="${r.override ?? ""}"
                   title="Пусто = берётся автоматически из @cast (сейчас: ${r.autoLimit ?? "нет"}). Введи число, чтобы переопределить вручную." />
            <input type="checkbox" class="fmrc-player-reveals-bg" ${r.revealsBackground ? "checked" : ""}
                   title="Персонаж видит точное число Фона (value/max + Нестабильность) на любой Сцене вместо статусной строки." />
          </div>
        `;
          })
          .join("")}
      </div>
      <p class="fmrc-hint">Заклинательный Лимит по умолчанию подтягивается из подкласса персонажа (<code>@cast</code>) — поле оставь пустым, чтобы использовать это значение. Впиши число, только если нужно переопределить его вручную для конкретного персонажа. «Видит Фон» — отдельное разрешение (v0.17): открывает персонажу точные цифры Магического Фона на любой Сцене, не только статус.</p>
      <p class="fmrc-hint">Аспект (v0.21) — опционален и зависит от выбранного Элемента (например «Элемент: Жизнь, Аспект: Плоть»). Если у Элемента нет Аспектов или он не выбран — поле недоступно. Смена Элемента сбрасывает ранее выбранный Аспект (он мог относиться к другому Элементу).</p>
    `;

    this._wirePlayersTab(root, panel);
  }

  _wirePlayersTab(root, panel) {
    panel.querySelectorAll(".fmrc-player-row").forEach((row) => {
      const actorId = row.dataset.actorId;
      const actor = game.actors.get(actorId);
      if (!actor) return;

      row.querySelector(".fmrc-player-element").addEventListener("change", async (ev) => {
        await setActorElements(actor, ev.currentTarget.value ? [ev.currentTarget.value] : []);
        // Смена Элемента могла сделать прежний Аспект бессмысленным (он относился к другому
        // Элементу) — сбрасываем и перерисовываем строку, чтобы список Аспектов обновился.
        await setActorAspect(actor, null);
        await this._renderPlayersTab(root);
      });

      row.querySelector(".fmrc-player-aspect").addEventListener("change", async (ev) => {
        await setActorAspect(actor, ev.currentTarget.value || null);
      });

      row.querySelector(".fmrc-player-price").addEventListener("change", async (ev) => {
        const clamped = await setPriceMax(actor, ev.currentTarget.value);
        ev.currentTarget.value = clamped;
      });

      row.querySelector(".fmrc-player-limit").addEventListener("change", async (ev) => {
        const result = await setSpellcastLimitOverride(actor, ev.currentTarget.value);
        ev.currentTarget.value = result ?? "";
      });

      row.querySelector(".fmrc-player-reveals-bg").addEventListener("change", async (ev) => {
        await setActorRevealsBackground(actor, ev.currentTarget.checked);
      });
    });
  }

  // =====================================================================================
  // Вкладка «Модификаторы» (v0.20) — ОБЩИЕ модификаторы: мировые Items (без актора-владельца,
  // см. modifiers.js: createGlobalModifierItem/getGlobalModifierItems), автоматически
  // подмешиваются в Круг КАЖДОГО персонажа (getEffectiveModifiers), кроме тех, у кого уже
  // есть личный модификатор с тем же названием (личный побеждает — см. modifiers.js).
  // =====================================================================================

  _renderModifiersTab(root) {
    const panel = root.querySelector('[data-tab-panel="modifiers"]');
    const items = getGlobalModifierItems();

    panel.innerHTML = `
      <p class="fmrc-hint">Общие модификаторы доступны в Круге у ВСЕХ персонажей сразу — не нужно добавлять их каждому вручную. Если у игрока уже есть личный модификатор с тем же названием, здесь показанный — общий — в его Круге не появится (личный полностью его заменяет). Категория (поле на листе предмета) определяет вкладку, в которой модификатор появится в панели Круга.</p>

      <div class="fmrc-modifier-dropzone">
        <i class="fa-solid fa-hand-pointer"></i>
        Перетащите сюда предмет типа «Модификатор Свободной Магии» — из компендиума, из мирового
        списка Items или прямо с листа персонажа — чтобы добавить его (копией) в общую библиотеку.
      </div>

      <div class="fmrc-modifiers-list">
        ${
          items.length
            ? items.map((i) => this._globalModifierRow(i)).join("")
            : `<p class="fmrc-hint">Общих модификаторов пока нет — добавьте кнопкой ниже или перетащите предмет в зону выше.</p>`
        }
      </div>
      <div class="fmrc-add-row">
        <button type="button" class="fmrc-add-global-modifier"><i class="fa-solid fa-plus"></i> Добавить общий модификатор</button>
      </div>
    `;

    this._wireModifiersTab(root, panel);
  }

  _globalModifierRow(item) {
    const currentTier = Math.max(1, Math.min(3, Number(item.system?.currentTier) || 1));
    const tierData = item.system?.[`tier${currentTier}`] ?? { tokenCost: 0, difficultyDelta: 0 };
    const tokenCost = Number(tierData.tokenCost) || 0;
    const difficultyDelta = Number(tierData.difficultyDelta) || 0;
    const category = (item.system?.category || "").trim() || "Общие";
    const badges = [];
    if (tokenCost < 0) badges.push(`+${Math.abs(tokenCost)} Мана`);
    else if (tokenCost > 0) badges.push(`-${tokenCost} жет.`);
    if (difficultyDelta !== 0) badges.push(`${difficultyDelta > 0 ? "+" : ""}${difficultyDelta} Слож.`);

    return `
      <div class="fmrc-modifier-row" data-item-id="${item.id}" title="Открыть лист предмета">
        <img class="fmrc-modifier-icon" src="${item.img}" alt="" />
        <span class="fmrc-modifier-name">${item.name}</span>
        <span class="fmrc-modifier-category" title="Категория (вкладка в панели Круга)">${category}</span>
        ${renderTierStars(currentTier, { className: "fmrc-modifier-stars" })}
        <span class="fmrc-modifier-badges">${badges.join(", ")}</span>
        <button type="button" class="fmrc-modifier-remove" data-item-id="${item.id}" title="Удалить"><i class="fa-solid fa-trash"></i></button>
      </div>
    `;
  }

  _wireModifiersTab(root, panel) {
    panel.querySelector(".fmrc-add-global-modifier").addEventListener("click", async () => {
      const item = await createGlobalModifierItem();
      item?.sheet?.render(true);
      this._renderModifiersTab(root);
    });

    panel.querySelectorAll(".fmrc-modifier-row[data-item-id]").forEach((row) => {
      row.addEventListener("click", (ev) => {
        if (ev.target.closest(".fmrc-modifier-remove")) return;
        game.items.get(row.dataset.itemId)?.sheet?.render(true);
      });
    });

    panel.querySelectorAll(".fmrc-modifier-remove").forEach((btn) => {
      btn.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        await game.items.get(btn.dataset.itemId)?.delete();
        this._renderModifiersTab(root);
      });
    });

    // v0.22 — Drag & Drop предмета-Модификатора в библиотеку Общих модификаторов. Работает со
    // стандартным перетаскиванием документов Foundry (компендиум, мировой список Items, лист
    // актора) — везде, где Foundry сам кладёт в dataTransfer JSON вида {type:"Item", uuid:"..."}.
    // Вся площадь вкладки — валидная зона сброса, но подсветку (визуальную обратную связь)
    // показываем только на выделенном блоке .fmrc-modifier-dropzone, чтобы не выглядело, будто
    // можно уронить куда угодно на экран.
    const dropzone = panel.querySelector(".fmrc-modifier-dropzone");

    panel.addEventListener("dragover", (ev) => {
      ev.preventDefault();
      ev.dataTransfer.dropEffect = "copy";
      dropzone?.classList.add("fmrc-dropzone-active");
    });
    panel.addEventListener("dragleave", (ev) => {
      // Уходим только когда курсор реально покинул панель, а не просто перескочил на дочерний
      // элемент внутри неё (иначе подсветка мигала бы при движении мыши по списку).
      if (!panel.contains(ev.relatedTarget)) dropzone?.classList.remove("fmrc-dropzone-active");
    });
    panel.addEventListener("drop", async (ev) => {
      ev.preventDefault();
      dropzone?.classList.remove("fmrc-dropzone-active");
      await this._onModifierItemDrop(ev, () => this._renderModifiersTab(root));
    });
  }

  /**
   * Обрабатывает перетаскивание предмета в одну из библиотек Модификаторов (Общие или Реакция
   * ГМа — см. _wireModifiersTab/_wireReactionsTab). Источник может быть любым: компендиум, лист
   * персонажа (Личный модификатор), даже другой мировой Item — в любом случае в мировой список
   * Items кладётся КОПИЯ (новый документ), а не перемещённый оригинал: компендиум остаётся
   * нетронутой библиотекой-первоисточником, а личный модификатор персонажа продолжает жить у
   * него как был (Общий/Реакция — это отдельная, независимая запись).
   *
   * @param {DragEvent} ev
   * @param {Function} renderFn — какую вкладку перерисовать после успешного добавления
   * @param {object} [opts]
   * @param {boolean} [opts.asReaction] — если true, копия помечается флагом isGmReaction (уходит
   *   в библиотеку «Реакция ГМа», никогда не подмешивается автоматически в Круг персонажа)
   */
  async _onModifierItemDrop(ev, renderFn, { asReaction = false } = {}) {
    let data;
    try {
      data = JSON.parse(ev.dataTransfer.getData("text/plain"));
    } catch (err) {
      return; // это не перетаскивание документа Foundry (например, файл с диска) — просто игнорируем
    }
    if (data?.type !== "Item" || !data.uuid) return;

    const item = await fromUuid(data.uuid);
    if (!item) {
      ui.notifications?.warn("Не удалось найти перетащенный предмет (возможно, он был удалён).");
      return;
    }
    if (item.type !== MODIFIER_TYPE) {
      ui.notifications?.warn(`«${item.name}» — не тип «Модификатор Свободной Магии», пропущено.`);
      return;
    }

    const alreadyThere = asReaction ? isGmReactionItem(item) : !item.parent && !item.pack && !isGmReactionItem(item);
    if (alreadyThere) {
      ui.notifications?.info(`«${item.name}» уже в этой библиотеке.`);
      return;
    }

    const source = foundry.utils.deepClone(item.toObject());
    delete source._id; // пусть Foundry выдаст новый id — не пытаемся переиспользовать чужой
    delete source.folder; // папка компендиума/актора не имеет смысла в мировом списке Items
    foundry.utils.setProperty(source, `flags.${MODULE_ID}.isGmReaction`, asReaction);

    const [created] = await Item.createDocuments([source]);
    ui.notifications?.info(
      asReaction
        ? `«${created.name}» добавлен в библиотеку Реакции ГМа.`
        : `«${created.name}» добавлен в общую библиотеку Модификаторов.`
    );
    renderFn();
  }

  // =====================================================================================
  // Вкладка «Реакция ГМа» (v0.23) — библиотека НЕГАТИВНЫХ модификаторов. Технически те же
  // предметы free-magic.modifier, что и на вкладке «Модификаторы», но помеченные флагом
  // isGmReaction — из-за этого getGlobalModifierItems()/getEffectiveModifiers() их полностью
  // игнорируют (см. modifiers.js), они НИКОГДА не появляются в Круге персонажа сами по себе.
  // Применяются ГМом вручную к конкретной активной сборке из окна наблюдения (gm-viewer-app.js).
  // =====================================================================================

  _renderReactionsTab(root) {
    const panel = root.querySelector('[data-tab-panel="reactions"]');
    const items = getGmReactionItems();

    panel.innerHTML = `
      <p class="fmrc-hint">Библиотека негативных модификаторов — они НЕ применяются автоматически ни к кому. ГМ выбирает нужный вручную в окне наблюдения за конкретной сборкой («Наблюдение — Имя» → «Реакция ГМа»), и он тут же появляется у игрока в Круге красным — в «Примерной Сложности» и в «Предпросмотре Чар».</p>

      <div class="fmrc-modifier-dropzone fmrc-reaction-dropzone">
        <i class="fa-solid fa-hand-pointer"></i>
        Перетащите сюда предмет типа «Модификатор Свободной Магии», чтобы добавить его (копией)
        в библиотеку Реакции ГМа.
      </div>

      <div class="fmrc-modifiers-list fmrc-reactions-list">
        ${
          items.length
            ? items.map((i) => this._reactionRow(i)).join("")
            : `<p class="fmrc-hint">Реакций пока нет — добавьте кнопкой ниже или перетащите предмет в зону выше.</p>`
        }
      </div>
      <div class="fmrc-add-row">
        <button type="button" class="fmrc-add-reaction"><i class="fa-solid fa-plus"></i> Добавить реакцию</button>
      </div>
    `;

    this._wireReactionsTab(root, panel);
  }

  _reactionRow(item) {
    const currentTier = Math.max(1, Math.min(3, Number(item.system?.currentTier) || 1));
    const tierData = item.system?.[`tier${currentTier}`] ?? { tokenCost: 0, difficultyDelta: 0 };
    const tokenCost = Number(tierData.tokenCost) || 0;
    const difficultyDelta = Number(tierData.difficultyDelta) || 0;
    const badges = [];
    if (tokenCost < 0) badges.push(`+${Math.abs(tokenCost)} Мана`);
    else if (tokenCost > 0) badges.push(`-${tokenCost} жет.`);
    if (difficultyDelta !== 0) badges.push(`${difficultyDelta > 0 ? "+" : ""}${difficultyDelta} Слож.`);

    return `
      <div class="fmrc-modifier-row fmrc-reaction-row" data-item-id="${item.id}" title="Открыть лист предмета">
        <img class="fmrc-modifier-icon" src="${item.img}" alt="" />
        <span class="fmrc-modifier-name">${item.name}</span>
        ${renderTierStars(currentTier, { className: "fmrc-modifier-stars" })}
        <span class="fmrc-modifier-badges">${badges.join(", ")}</span>
        <button type="button" class="fmrc-modifier-remove" data-item-id="${item.id}" title="Удалить"><i class="fa-solid fa-trash"></i></button>
      </div>
    `;
  }

  _wireReactionsTab(root, panel) {
    panel.querySelector(".fmrc-add-reaction").addEventListener("click", async () => {
      const item = await createGmReactionItem();
      item?.sheet?.render(true);
      this._renderReactionsTab(root);
    });

    panel.querySelectorAll(".fmrc-reaction-row[data-item-id]").forEach((row) => {
      row.addEventListener("click", (ev) => {
        if (ev.target.closest(".fmrc-modifier-remove")) return;
        game.items.get(row.dataset.itemId)?.sheet?.render(true);
      });
    });

    panel.querySelectorAll(".fmrc-reaction-row .fmrc-modifier-remove").forEach((btn) => {
      btn.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        await game.items.get(btn.dataset.itemId)?.delete();
        this._renderReactionsTab(root);
      });
    });

    const dropzone = panel.querySelector(".fmrc-reaction-dropzone");

    panel.addEventListener("dragover", (ev) => {
      ev.preventDefault();
      ev.dataTransfer.dropEffect = "copy";
      dropzone?.classList.add("fmrc-dropzone-active");
    });
    panel.addEventListener("dragleave", (ev) => {
      if (!panel.contains(ev.relatedTarget)) dropzone?.classList.remove("fmrc-dropzone-active");
    });
    panel.addEventListener("drop", async (ev) => {
      ev.preventDefault();
      dropzone?.classList.remove("fmrc-dropzone-active");
      await this._onModifierItemDrop(ev, () => this._renderReactionsTab(root), { asReaction: true });
    });
  }
}
