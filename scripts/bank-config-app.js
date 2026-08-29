import { MODULE_ID, getBankStatus, setBankValue, setBankMax, setBankUnstableLock } from "./bank.js";
import { getPriceMax, setPriceMax, PRICE_MAX_CEILING } from "./paths.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class FreeMagicBankConfig extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "free-magic-bank-config",
    tag: "form",
    window: {
      title: "Настройка ГМа — Свободная Магия",
      icon: "fa-solid fa-hurricane",
      resizable: true
    },
    position: { width: 420, height: "auto" }
  };

  static PARTS = {
    body: { template: "modules/free-magic/templates/bank-config.hbs" }
  };

  constructor(options = {}) {
    super(options);
    // По умолчанию — Сцена, которую ГМ сейчас видит на канвасе (удобная отправная точка),
    // но можно переключиться на любую другую или на "глобально".
    this.selectedSceneId = canvas?.scene?.id ?? "";
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    const root = this.element;

    this._renderSceneOptions(root);

    root.querySelector(".fmb-scene-select").addEventListener("change", (ev) => {
      this.selectedSceneId = ev.currentTarget.value;
      this._syncBankUI(root);
    });

    root.querySelector(".fmb-value").addEventListener("change", (ev) => this._onValueChange(root, ev));
    root.querySelector(".fmb-max").addEventListener("change", (ev) => this._onMaxChange(root, ev));
    root.querySelector(".fmb-fill").addEventListener("click", () => this._onFill(root));
    root.querySelector(".fmb-unlock").addEventListener("click", () => this._onUnlock(root));

    this._syncBankUI(root);
    this._renderPriceList(root);
  }

  _renderSceneOptions(root) {
    const select = root.querySelector(".fmb-scene-select");
    const scenes = game.scenes?.contents ?? [];
    select.innerHTML = `
      <option value="">Глобально (без привязки к Сцене)</option>
      ${scenes.map((s) => `<option value="${s.id}">${s.name}</option>`).join("")}
    `;
    select.value = this.selectedSceneId;
  }

  // --- Магический Фон (для выбранной Сцены или глобально) ---

  _sceneId() {
    return this.selectedSceneId || null;
  }

  _syncBankUI(root) {
    const status = getBankStatus(this._sceneId());

    root.querySelector(".fmb-value").value = status.value;
    root.querySelector(".fmb-max").value = status.max;
    root.querySelector(".fmb-level").textContent = status.level.label;
    root.querySelector(".fmb-state").textContent = status.stateLabel;
    root.querySelector(".fmb-pct").textContent =
      status.max > 0 ? `${Math.round((status.value / status.max) * 100)}%` : "—";

    const lockRow = root.querySelector(".fmb-lock-row");
    lockRow.hidden = !status.lock;
  }

  async _onValueChange(root, ev) {
    await setBankValue(Number(ev.currentTarget.value) || 0, this._sceneId());
    this._syncBankUI(root);
  }

  async _onMaxChange(root, ev) {
    await setBankMax(Number(ev.currentTarget.value) || 1, this._sceneId());
    this._syncBankUI(root);
  }

  async _onFill(root) {
    const status = getBankStatus(this._sceneId());
    await setBankValue(status.max, this._sceneId());
    this._syncBankUI(root);
  }

  async _onUnlock(root) {
    await setBankUnstableLock(false, this._sceneId());
    this._syncBankUI(root);
  }

  // --- Быстрая настройка Цены по всем персонажам игроков ---

  _playerCharacters() {
    return (game.actors?.contents ?? [])
      .filter((a) => a.type === "character")
      .filter((a) => a.hasPlayerOwner)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async _renderPriceList(root) {
    const list = root.querySelector(".fmb-price-list");
    const actors = this._playerCharacters();

    if (actors.length === 0) {
      list.innerHTML = `<p class="fmb-hint">Персонажей игроков не найдено (актор должен принадлежать игроку).</p>`;
      return;
    }

    const rows = await Promise.all(
      actors.map(async (actor) => {
        const value = await getPriceMax(actor);
        return `
          <div class="fmb-price-row" data-actor-id="${actor.id}">
            <span class="fmb-price-name">${actor.name}</span>
            <input type="number" class="fmb-price-input" min="0" max="${PRICE_MAX_CEILING}" value="${value}" />
          </div>
        `;
      })
    );

    list.innerHTML = rows.join("");

    list.querySelectorAll(".fmb-price-input").forEach((input) => {
      input.addEventListener("change", async (ev) => {
        const actorId = ev.currentTarget.closest(".fmb-price-row").dataset.actorId;
        const actor = game.actors.get(actorId);
        if (!actor) return;
        const clamped = await setPriceMax(actor, ev.currentTarget.value);
        ev.currentTarget.value = clamped;
      });
    });
  }
}
