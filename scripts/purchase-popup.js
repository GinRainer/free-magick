const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

// Лёгкая обёртка-попап: вся логика и состояние (grantTiers, wildTokens и т.д.) остаются
// на родительском FreeMagicCircle — это окно просто рендерит тот же _renderPurchaseView()
// в свой собственный контейнер, чтобы не дублировать код.
export class FreeMagicPurchasePopup extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "free-magic-purchase-popup",
    tag: "form",
    window: {
      title: "Докупить жетоны",
      icon: "fa-solid fa-coins",
      resizable: true
    },
    position: { width: 380, height: 560 }
  };

  static PARTS = {
    body: { template: "modules/free-magic/templates/purchase-popup.hbs" }
  };

  constructor(options = {}) {
    super(options);
    this.circle = options.circle; // ссылка на родительское окно Круга
  }

  get title() {
    return `Докупить жетоны — ${this.circle?.actor?.name ?? ""}`;
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    const container = this.element.querySelector(".fm-purchase-view");
    this.circle?._renderPurchaseView(container);
  }
}
