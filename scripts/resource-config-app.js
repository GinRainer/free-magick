// v0.15 — Окно настройки ГМа v2 (раздел 11.3 / 13 дизайн-документа).
// Три вкладки в одном окне:
//  - «Каталог»  — мировой список Элементов/Аспектов (редко трогать)
//  - «Эта сцена» — максимум Фона, какие Элементы активны и их стартовые значения
//  - «Игроки»   — Элемент / Объём Сосуда (Максимум Цены) / Заклинательный Лимит на персонажа,
//                 всё в одном месте (раньше Максимум Цены редактировался из окна Круга — убрано)

import {
  getCatalog,
  upsertElement,
  removeElement,
  upsertAspect,
  removeAspect,
  getSceneResourceData,
  getBackgroundStatus,
  setBackgroundValue,
  setBackgroundMax,
  resetBackgroundInstability,
  setResourceActive,
  setResourceValue,
  setResourceMax,
  getActorElements,
  setActorElements
} from "./scene-resource.js";
import { getPriceMax, setPriceMax, PRICE_MAX_CEILING } from "./paths.js";
import { getAutoSpellcastLimit, getSpellcastLimitOverride, setSpellcastLimitOverride } from "./spellcast-limit.js";

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
    position: { width: 640, height: 640 }
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
          <input type="text" class="fmrc-el-icon" value="${element.icon ?? ""}" placeholder="fa-solid fa-fire" title="Класс иконки FontAwesome" />
          <i class="${element.icon ?? ""}"></i>
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
        <input type="text" class="fmrc-as-icon" value="${aspect.icon ?? ""}" placeholder="fa-solid fa-..." />
        <i class="${aspect.icon ?? ""}"></i>
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
      });
      row.querySelector(".fmrc-el-tooltip").addEventListener("change", async (ev) => {
        await upsertElement(elementId, { tooltip: ev.currentTarget.value });
      });
      row.querySelector(".fmrc-el-remove").addEventListener("click", async () => {
        await removeElement(elementId);
        this._renderCatalogTab(root);
        this._renderSceneTab(root);
        this._renderPlayersTab(root); // список Элементов в выпадающем списке игроков тоже меняется
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
        });
        aspectRow.querySelector(".fmrc-as-tooltip").addEventListener("change", async (ev) => {
          await upsertAspect(elementId, aspectId, { tooltip: ev.currentTarget.value });
        });
        aspectRow.querySelector(".fmrc-as-remove").addEventListener("click", async () => {
          await removeAspect(elementId, aspectId);
          this._renderCatalogTab(root);
          this._renderSceneTab(root);
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
  // Вкладка «Игроки» — Элемент / Объём Сосуда / Заклинательный Лимит, всё в одном месте
  // (раздел 13) — раньше Объём Сосуда (Максимум Цены) редактировался из окна Круга, убрано
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
      const priceMaxPromise = getPriceMax(actor);
      const autoLimit = getAutoSpellcastLimit(actor);
      const override = getSpellcastLimitOverride(actor);
      return { actor, currentElement, priceMaxPromise, autoLimit, override };
    });

    const priceMaxValues = await Promise.all(rows.map((r) => r.priceMaxPromise));

    panel.innerHTML = `
      <div class="fmrc-players-header">
        <span>Персонаж</span>
        <span>Элемент</span>
        <span>Объём Сосуда</span>
        <span>Заклинательный Лимит</span>
      </div>
      <div class="fmrc-players-list">
        ${rows
          .map(
            (r, i) => `
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
            <input type="number" class="fmrc-player-price" min="0" max="${PRICE_MAX_CEILING}" value="${priceMaxValues[i]}" />
            <input type="number" class="fmrc-player-limit" min="0"
                   placeholder="${r.autoLimit ?? "нет @cast"}"
                   value="${r.override ?? ""}"
                   title="Пусто = берётся автоматически из @cast (сейчас: ${r.autoLimit ?? "нет"}). Введи число, чтобы переопределить вручную." />
          </div>
        `
          )
          .join("")}
      </div>
      <p class="fmrc-hint">Заклинательный Лимит по умолчанию подтягивается из подкласса персонажа (<code>@cast</code>) — поле оставь пустым, чтобы использовать это значение. Впиши число, только если нужно переопределить его вручную для конкретного персонажа.</p>
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
      });

      row.querySelector(".fmrc-player-price").addEventListener("change", async (ev) => {
        const clamped = await setPriceMax(actor, ev.currentTarget.value);
        ev.currentTarget.value = clamped;
      });

      row.querySelector(".fmrc-player-limit").addEventListener("change", async (ev) => {
        const result = await setSpellcastLimitOverride(actor, ev.currentTarget.value);
        ev.currentTarget.value = result ?? "";
      });
    });
  }
}
