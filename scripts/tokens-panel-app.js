// v0.25 — Боковое окно «Мои Токены Маны», отдельное от самого окна Круга.
//
// Раньше это был сворачиваемый виджет прямо в левой колонке circle.hbs — но список источников
// (шесть Путей + Токены Маны + Нестабильные Токены) вместе с виджетом «Предпросмотр Чар» не
// помещались в фиксированную высоту колонки, и прокрутка визуально не была заметна (тонкая
// полоса терялась). Вынесено в собственное окно — то же самое пространство, что раньше делили
// на двоих, целиком достаётся Предпросмотру, а Токены не зависят от его высоты вовсе.
//
// Технически это НЕ дублирование логики: _renderPathsPanel(root) в circle-app.js как была, так
// и осталась общей функцией, просто теперь её вызывают с DOM ЭТОГО окна вместо DOM самого Круга
// (см. circle-app.js, _refreshTokensPanel). Здесь только рендер профиля (Элемент/Аспект/Тип) —
// целиком read-only, редактирование остаётся в панели на листе персонажа и в GM Settings.

import { getActorElements, getActorAspect, findCatalogEntry } from "./scene-resource.js";
import { getMagicType, getMagicTypeLabel } from "./actor-profile.js";
import { renderIconHtml } from "./icon-utils.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class FreeMagicTokensPanel extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "free-magic-tokens-panel",
    window: {
      title: "Мои Токены Маны",
      icon: "fa-solid fa-droplet",
      resizable: true,
      minimizable: false
    },
    position: { width: 220, height: 460 }
  };

  static PARTS = {
    body: { template: "modules/free-magic/templates/tokens-panel.hbs" }
  };

  constructor(options = {}) {
    super(options);
    this.circle = options.circle ?? null; // родительское окно Круга — источник данных и логики
  }

  get actor() {
    return this.circle?.actor ?? null;
  }

  get title() {
    return `Токены — ${this.actor?.name ?? ""}`;
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    this._renderProfile(this.element.querySelector(".fmtp-profile"));
    this.circle?._renderPathsPanel(this.element);
  }

  // Профиль персонажа — то же самое, что уже показывается на листе персонажа (см. sheet-panel.js,
  // renderProfileRow), но здесь целиком для чтения: редактирование Элемента/Аспекта — в GM
  // Settings → «Игроки», Типа — в панели «Пути Магии» на листе персонажа.
  _renderProfile(container) {
    if (!container || !this.actor) return;
    const actor = this.actor;

    const elementId = getActorElements(actor)[0];
    const elementEntry = elementId ? findCatalogEntry(elementId)?.entry : null;
    const aspectId = getActorAspect(actor);
    const aspectEntry = aspectId ? findCatalogEntry(aspectId)?.entry : null;
    const type = getMagicType(actor);

    const rows = [];
    if (elementEntry) {
      rows.push(
        `<div class="fmtp-profile-row"><span class="fmtp-profile-label">Элемент</span><span class="fmtp-profile-value">${renderIconHtml(elementEntry.icon, { className: "fmtp-profile-icon" })}${elementEntry.label}</span></div>`
      );
    }
    // Аспект — опционален, показываем только если реально назначен (см. дизайн-решение v0.21:
    // отсутствие Аспекта — нормальное состояние, ничего не показываем взамен).
    if (aspectEntry) {
      rows.push(
        `<div class="fmtp-profile-row"><span class="fmtp-profile-label">Аспект</span><span class="fmtp-profile-value">${renderIconHtml(aspectEntry.icon, { className: "fmtp-profile-icon" })}${aspectEntry.label}</span></div>`
      );
    }
    rows.push(
      `<div class="fmtp-profile-row"><span class="fmtp-profile-label">Тип</span><span class="fmtp-profile-value">${getMagicTypeLabel(type)}</span></div>`
    );

    container.innerHTML = rows.join("");
  }
}
