import { MODULE_ID } from "./bank.js";
import { getEffectiveModifiers, getGmReactionModifiers, renderTierStars } from "./modifiers.js";
import { PATHS, getManualPathPools, setManualPathPool, getItemBonusByPath, getPriceMax, setPriceMax, PRICE_MAX_CEILING } from "./paths.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

// Те же подписи секторов, что и в circle-app.js — если понадобится вынести в общий модуль
// при дальнейшем росте, сделаем это отдельным шагом (сейчас не хотим лишний раз трогать
// уже работающий circle-app.js ради небольшого дублирования подписей).
const SPEND_LABELS = {
  urn: "Урон",
  distance: "Дистанция",
  area: "Область",
  target: "Целеуказание",
  duration: "Продолжительность"
};
const GRANT_LABELS = { speed: "Скорость", price: "Цена", sacrifice: "Жертва", resource: "Ресурс" };
const TIER_ROMAN = ["0", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

export class FreeMagicGmViewer extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "free-magic-gm-viewer",
    tag: "form",
    window: {
      title: "Наблюдение за сборкой",
      icon: "fa-solid fa-eye",
      resizable: true
    },
    position: { width: 460, height: 640 }
  };

  static PARTS = {
    body: { template: "modules/free-magic/templates/gm-viewer.hbs" }
  };

  constructor(options = {}) {
    super(options);
    this.actorId = options.actorId;
    this.actorName = options.actorName ?? "";
    this.buildState = options.initialState ?? null;
    this.sessionClosed = false;
  }

  get title() {
    return `Наблюдение — ${this.actorName}`;
  }

  get actor() {
    return game.actors?.get(this.actorId) ?? null;
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    await this._renderAll();
  }

  // Вызывается извне (см. gm-watch.js) при получении нового "buildStateUpdate" для этого актора
  refreshFromState(state) {
    this.buildState = state;
    if (this.rendered) this._renderAll();
  }

  markClosed() {
    this.sessionClosed = true;
    if (this.rendered) this._renderAll();
  }

  async _renderAll() {
    const root = this.element;
    if (!root) return;

    root.querySelector(".fm-gmv-closed-banner").hidden = !this.sessionClosed;

    await this._renderTokens(root);
    this._renderSectors(root);
    this._renderModifiers(root);
    this._renderReactions(root);
    root.querySelector(".fm-gmv-intent").textContent = this.buildState?.intent?.trim() || "—";
  }

  // --- Токены (Пути + лимит Цены) — читаем/пишем напрямую через флаги актора, как и в самом
  // Круге. Игрок увидит изменение сам (см. хук updateActor в circle-app.js). ---

  async _renderTokens(root) {
    const actor = this.actor;
    const list = root.querySelector(".fm-gmv-tokens-list");
    if (!actor) {
      list.innerHTML = `<p class="fm-gmv-hint">Актор не найден.</p>`;
      return;
    }

    const manualPools = await getManualPathPools(actor);
    const priceMax = await getPriceMax(actor);

    const pathRows = PATHS.map((p) => {
      const manual = manualPools[p.key] ?? 0;
      const bonus = getItemBonusByPath(actor, p.key);
      return `
        <div class="fm-gmv-token-row" data-path-key="${p.key}">
          <span class="fm-gmv-token-name"><i class="${p.icon}"></i> ${p.label}</span>
          <input type="number" class="fm-gmv-token-input" min="0" value="${manual}" />
          <span class="fm-gmv-token-bonus">+${bonus}</span>
        </div>
      `;
    }).join("");

    list.innerHTML = `
      ${pathRows}
      <div class="fm-gmv-token-row fm-gmv-price-row">
        <span class="fm-gmv-token-name"><i class="fa-solid fa-coins"></i> Максимум Цены</span>
        <input type="number" class="fm-gmv-price-input" min="0" max="${PRICE_MAX_CEILING}" value="${priceMax}" />
        <span class="fm-gmv-token-bonus">из ${PRICE_MAX_CEILING}</span>
      </div>
    `;

    list.querySelectorAll(".fm-gmv-token-input").forEach((input) => {
      input.addEventListener("change", async (ev) => {
        const key = ev.currentTarget.closest(".fm-gmv-token-row").dataset.pathKey;
        await setManualPathPool(actor, key, ev.currentTarget.value);
      });
    });
    list.querySelector(".fm-gmv-price-input").addEventListener("change", async (ev) => {
      const clamped = await setPriceMax(actor, ev.currentTarget.value);
      ev.currentTarget.value = clamped;
    });
  }

  // --- Секторы Круга и Докупки (только чтение — что игрок реально выбрал сейчас) ---

  _renderSectors(root) {
    const spendEl = root.querySelector(".fm-gmv-spend-list");
    const grantEl = root.querySelector(".fm-gmv-grant-list");

    const spend = this.buildState?.spendAllocations;
    const grant = this.buildState?.grantTiers;

    if (!spend) {
      spendEl.innerHTML = `<p class="fm-gmv-hint">Пока нет данных — ждём первое изменение в Круге у игрока.</p>`;
    } else {
      const rows = Object.entries(SPEND_LABELS)
        .map(([key, label]) => {
          const tier = spend[key]?.length ?? 0;
          return `<div class="fm-gmv-sector-row"><span>${label}</span><strong>${TIER_ROMAN[tier] ?? tier}</strong></div>`;
        })
        .join("");
      spendEl.innerHTML = rows;
    }

    if (!grant) {
      grantEl.innerHTML = "";
    } else {
      const rows = Object.entries(GRANT_LABELS)
        .map(([key, label]) => {
          const tier = grant[key] ?? 0;
          return `<div class="fm-gmv-sector-row"><span>${label}</span><strong>${TIER_ROMAN[tier] ?? tier}</strong></div>`;
        })
        .join("");
      grantEl.innerHTML = rows;
    }
  }

  // --- Модификаторы (v0.20 — личные + общие, 3 уровня освоения, см. modifiers.js) — можно
  // включать/выключать удалённо, применяется на клиенте игрока через сокет-сообщение
  // "gmSetModifier" (см. circle-app.js, _applyRemoteModifierChange). v0.21: подсказка строки
  // теперь показывает и Требования модификатора (если заданы), информационно для ГМа. ---

  _renderModifiers(root) {
    const list = root.querySelector(".fm-gmv-mods-list");
    const modsOn = this.buildState?.modsOn ?? {};
    const modifiers = getEffectiveModifiers(this.actor);

    if (modifiers.length === 0) {
      list.innerHTML = `<p class="fm-gmv-hint">У персонажа нет доступных модификаторов.</p>`;
      return;
    }

    list.innerHTML = modifiers.map((m) => {
      const checked = Boolean(modsOn[m.key]);
      const tokenBadge = m.tokenCost > 0 ? `-${m.tokenCost}` : m.tokenCost < 0 ? `+${Math.abs(m.tokenCost)}` : "";
      const difficultyBadge = m.difficultyDelta !== 0 ? `${m.difficultyDelta > 0 ? "+" : ""}${m.difficultyDelta} Слож.` : "";
      const globalTag = m.isGlobal ? `<span class="fm-gmv-mod-global-tag">Общий</span>` : "";
      const titleAttr = m.requirement ? ` title="Требования: ${m.requirement}"` : "";
      return `
        <label class="fm-gmv-mod-row fm-gmv-mod-row-tier-${m.currentTier}"${titleAttr}>
          <span>
            <input type="checkbox" data-mod-key="${m.key}" ${checked ? "checked" : ""} />
            <img class="fm-gmv-mod-icon" src="${m.icon}" alt="" />
            ${m.label}${globalTag}
            ${renderTierStars(m.currentTier, { className: "fm-gmv-mod-stars" })}
          </span>
          <span class="fm-gmv-mod-badges">
            ${tokenBadge ? `<span class="fm-gmv-mod-badge">${tokenBadge}</span>` : ""}
            ${difficultyBadge ? `<span class="fm-gmv-mod-badge fm-gmv-mod-badge-difficulty">${difficultyBadge}</span>` : ""}
          </span>
        </label>
      `;
    }).join("");

    list.querySelectorAll("input[type=checkbox]").forEach((input) => {
      input.addEventListener("change", (ev) => {
        const modKey = ev.currentTarget.dataset.modKey;
        const value = ev.currentTarget.checked;
        // Оптимистично обновляем локально показанное состояние, не дожидаясь ответного
        // broadcast от игрока — тот всё равно придёт следом и подтвердит.
        if (this.buildState) this.buildState.modsOn = { ...(this.buildState.modsOn ?? {}), [modKey]: value };
        game.socket.emit(`module.${MODULE_ID}`, {
          action: "gmSetModifier",
          actorId: this.actorId,
          modKey,
          value
        });
      });
    });
  }

  // --- v0.23: Реакция ГМа — применение негативных модификаторов из отдельной библиотеки
  // (см. modifiers.js, getGmReactionModifiers / resource-config-app.js, вкладка «Реакция ГМа»)
  // к КОНКРЕТНОЙ активной сборке этого актора. В отличие от обычных Модификаторов (которые
  // игрок включает сам), эти чекбоксы редактирует ТОЛЬКО ГМ — применяется через отдельное
  // сокет-действие "gmSetReaction", у игрока в Круге появляется КРАСНЫМ в Примерной Сложности
  // и в Предпросмотре Чар (см. circle-app.js, _applyRemoteReactionChange). ---

  _renderReactions(root) {
    const list = root.querySelector(".fm-gmv-reactions-list");
    if (!list) return; // старый шаблон gm-viewer.hbs без секции — не ломаемся

    const reactionsOn = this.buildState?.gmReactionsOn ?? {};
    const reactions = getGmReactionModifiers();

    if (reactions.length === 0) {
      list.innerHTML = `<p class="fm-gmv-hint">Библиотека Реакции ГМа пуста — добавьте предметы в GM Settings → «Реакция ГМа».</p>`;
      return;
    }

    list.innerHTML = reactions.map((m) => {
      const checked = Boolean(reactionsOn[m.key]);
      const tokenBadge = m.tokenCost > 0 ? `-${m.tokenCost}` : m.tokenCost < 0 ? `+${Math.abs(m.tokenCost)}` : "";
      const difficultyBadge = m.difficultyDelta !== 0 ? `${m.difficultyDelta > 0 ? "+" : ""}${m.difficultyDelta} Слож.` : "";
      const titleAttr = m.requirement ? ` title="Требования: ${m.requirement}"` : "";
      return `
        <label class="fm-gmv-reaction-row"${titleAttr}>
          <span>
            <input type="checkbox" data-reaction-key="${m.key}" ${checked ? "checked" : ""} />
            <img class="fm-gmv-mod-icon" src="${m.icon}" alt="" />
            ${m.label}
          </span>
          <span class="fm-gmv-mod-badges">
            ${tokenBadge ? `<span class="fm-gmv-mod-badge">${tokenBadge}</span>` : ""}
            ${difficultyBadge ? `<span class="fm-gmv-mod-badge fm-gmv-mod-badge-difficulty">${difficultyBadge}</span>` : ""}
          </span>
        </label>
      `;
    }).join("");

    list.querySelectorAll("input[type=checkbox]").forEach((input) => {
      input.addEventListener("change", (ev) => {
        const modKey = ev.currentTarget.dataset.reactionKey;
        const value = ev.currentTarget.checked;
        if (this.buildState) this.buildState.gmReactionsOn = { ...(this.buildState.gmReactionsOn ?? {}), [modKey]: value };
        game.socket.emit(`module.${MODULE_ID}`, {
          action: "gmSetReaction",
          actorId: this.actorId,
          modKey,
          value
        });
      });
    });
  }
}
