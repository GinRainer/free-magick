import { browseForIconFile } from "./icon-utils.js";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;

/**
 * Лист предмета для Item-типа "Модификатор" (free-magic.modifier, см. modifiers.js).
 * Собран по тому же принципу, что и остальные окна модуля (HandlebarsApplicationMixin +
 * прямые DOM-слушатели на change/click вместо автоматического form-binding ApplicationV2) —
 * так поведение предсказуемо и совпадает со стилем остального кода.
 *
 * РИСК (см. также CHANGELOG-v0.19.md): это первый ЛИСТ ДОКУМЕНТА в модуле — раньше все окна
 * были самостоятельными приложениями, а не листами Item/Actor. Точный жизненный цикл и набор
 * гарантий ItemSheetV2 не был живо проверен в вашей связке Foundry/Daggerheart/Sleek UI.
 * Если после создания Модификатора лист откроется пустым, без полей, или title будет не тем —
 * смотрите в первую очередь сюда и присылайте, что в консоли (F12).
 */
export class FreeMagicModifierSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["free-magic-modifier-sheet"],
    position: { width: 480, height: 620 },
    window: { icon: "fa-solid fa-sliders", resizable: true }
  };

  static PARTS = {
    body: { template: "modules/free-magic/templates/modifier-sheet.hbs" }
  };

  // Явный алиас на case, если базовый ItemSheetV2 почему-то не предоставляет .item сам —
  // весь остальной код листа полагается именно на this.item, а не на this.document напрямую.
  get item() {
    return this.document;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.item = this.item;
    context.system = this.item.system;
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
    root.querySelector('[name="system.effect"]').addEventListener("change", (ev) => {
      this.item.update({ "system.effect": ev.currentTarget.value });
    });
    root.querySelector('[name="system.tokenCost"]').addEventListener("change", (ev) => {
      this.item.update({ "system.tokenCost": Math.floor(Number(ev.currentTarget.value)) || 0 });
    });
    root.querySelector('[name="system.difficultyDelta"]').addEventListener("change", (ev) => {
      this.item.update({ "system.difficultyDelta": Math.floor(Number(ev.currentTarget.value)) || 0 });
    });
  }
}
