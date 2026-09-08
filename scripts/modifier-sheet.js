import { TIER_LABELS } from "./modifiers.js";
import { browseForIconFile } from "./icon-utils.js";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;

/**
 * Лист предмета для Item-типа "Модификатор" (free-magic.modifier, см. modifiers.js).
 *
 * v0.20: три независимых уровня освоения (Базовое/Освоение/Мастерство), каждый со своими
 * Жетонами/Сложностью/Эффектом. Звёзды в шапке кликабельны — выбирают system.currentTier.
 * Чекбокс "Скрывать неоткрытые уровни от игрока" виден только ГМу; если включён, уровни выше
 * currentTier показываются НЕ-ГМ зрителю как запертые (без текста эффекта/чисел стоимости).
 *
 * v0.21: добавлены два top-level поля — Категория (группировка во вкладки в панели Круга) и
 * Требования (опциональный информационный текст условия применения, не проверяется автоматически).
 *
 * РИСК: это лист ДОКУМЕНТА (ItemSheetV2), собственный API которого не был живо протестирован
 * в вашей связке Foundry/Daggerheart/Sleek UI — см. подробности в CHANGELOG-v0.19/v0.20.md.
 */
export class FreeMagicModifierSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["free-magic-modifier-sheet"],
    position: { width: 540, height: 760 },
    window: { icon: "fa-solid fa-sliders", resizable: true }
  };

  static PARTS = {
    body: { template: "modules/free-magic/templates/modifier-sheet.hbs" }
  };

  get item() {
    return this.document;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const isGM = game.user.isGM;
    const system = this.item.system;
    const currentTier = Math.max(1, Math.min(3, Number(system.currentTier) || 1));
    const hideLockedTiers = Boolean(system.hideLockedTiers);

    const tiers = [1, 2, 3].map((index) => {
      const data = system[`tier${index}`] ?? { effect: "", tokenCost: 0, difficultyDelta: 0 };
      const locked = hideLockedTiers && !isGM && index > currentTier;
      const starsHtml = Array.from({ length: index }, () => '<i class="fa-solid fa-star"></i>').join("");
      return {
        index,
        label: TIER_LABELS[index - 1],
        locked,
        starsHtml,
        effect: data.effect ?? "",
        tokenCost: Number(data.tokenCost) || 0,
        difficultyDelta: Number(data.difficultyDelta) || 0
      };
    });

    context.item = this.item;
    context.system = system;
    context.isGM = isGM;
    context.currentTier = currentTier;
    context.hideLockedTiers = hideLockedTiers;
    context.tiers = tiers;
    context.category = system.category ?? "";
    context.requirement = system.requirement ?? "";
    // Является ли предмет ОБЩИМ (мировым, без актора-владельца) — просто справочная строка
    // в шапке листа, чтобы не путать с личным при случайном открытии не того предмета.
    context.isGlobal = !this.item.parent;
    return context;
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    const root = this.element;

    root.querySelector('[name="name"]').addEventListener("change", (ev) => {
      const value = ev.currentTarget.value.trim();
      this.item.update({ name: value || this.item.name });
    });

    root.querySelector(".fm-modsheet-img").addEventListener("click", () => {
      browseForIconFile(this.item.img, (path) => this.item.update({ img: path }));
    });

    root.querySelector('[name="system.description"]').addEventListener("change", (ev) => {
      this.item.update({ "system.description": ev.currentTarget.value });
    });

    // v0.21 — Категория (текст, группирует во вкладки в панели Круга) и Требования
    // (опциональный информационный текст, не проверяется автоматически).
    root.querySelector('[name="system.category"]')?.addEventListener("change", (ev) => {
      const value = ev.currentTarget.value.trim();
      this.item.update({ "system.category": value || "Общие" });
    });
    root.querySelector('[name="system.requirement"]')?.addEventListener("change", (ev) => {
      this.item.update({ "system.requirement": ev.currentTarget.value });
    });

    // Звёзды текущего уровня — кликабельны, выставляют system.currentTier целиком (клик по
    // 2-й звезде = "Освоение", и т.д.), а не инкремент/декремент по одной.
    root.querySelectorAll(".fm-modsheet-star").forEach((star) => {
      star.addEventListener("click", () => {
        const tier = Number(star.dataset.tier);
        this.item.update({ "system.currentTier": tier });
      });
    });

    root.querySelector('[name="system.hideLockedTiers"]')?.addEventListener("change", (ev) => {
      this.item.update({ "system.hideLockedTiers": ev.currentTarget.checked });
    });

    for (let i = 1; i <= 3; i++) {
      root.querySelector(`[name="system.tier${i}.effect"]`)?.addEventListener("change", (ev) => {
        this.item.update({ [`system.tier${i}.effect`]: ev.currentTarget.value });
      });
      root.querySelector(`[name="system.tier${i}.tokenCost"]`)?.addEventListener("change", (ev) => {
        this.item.update({ [`system.tier${i}.tokenCost`]: Math.floor(Number(ev.currentTarget.value)) || 0 });
      });
      root.querySelector(`[name="system.tier${i}.difficultyDelta"]`)?.addEventListener("change", (ev) => {
        this.item.update({ [`system.tier${i}.difficultyDelta`]: Math.floor(Number(ev.currentTarget.value)) || 0 });
      });
    }
  }
}
