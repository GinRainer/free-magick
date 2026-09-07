import { MODULE_ID, getBankStatus, setBankValue } from "./bank.js";
import { FreeMagicBankConfig } from "./bank-config-app.js";
import { FreeMagicTokensPanel } from "./tokens-panel-app.js";
import { PATHS, getItemBonusByPath, getPriceMax } from "./paths.js";
import { getEffectiveModifiers, getGmReactionModifiers, renderTierStars, getGlobalTierOverride, setGlobalTierOverride, MODIFIER_TYPE } from "./modifiers.js";
import { getSpellcastLimit } from "./spellcast-limit.js";
import { getBackgroundIcon } from "./scene-resource.js";
import { renderIconHtml } from "./icon-utils.js";
import { handleGmWatchMessage } from "./gm-watch.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

// Жёсткий лимит на разовое взятие из Банка за одну сборку заклинания через СТАРЫЙ путь
// (кнопка «Взять 1 из Банка» в скрытом сейчас виджете «Получить Токены Маны»). Новый, основной
// путь получения Нестабильных Токенов — кнопка Магического Круга рядом с самим Кругом (см.
// _onDrawInstability) — использует другой предел, Заклинательный Лимит персонажа.
const PLAYER_BANK_DRAW_CAP = 3;

// Сколько карточек Модификаторов показывать на одной "странице" внутри вкладки-категории —
// см. _renderModifiers (v0.21). Карточки теперь компактные (только иконка+звёзды, v0.24),
// поэтому на страницу помещается заметно больше, чем раньше.
const MODS_PER_PAGE = 15;

// Таблица «Предварительная таблица сложности исполнения» из дизайн-документа: сумма двух наивысших
// тиров среди СЕКТОРОВ ТРАТЫ (не Докупки) → ориентировочная категория/Сложность/Откат.
// Это только ориентир для игрока — финальное слово всегда за ГМом (нарративный вес, особые условия).
const DIFFICULTY_TABLE = [
  { min: 0, max: 1, label: "Незначительная или Малая", dc: "без броска / 5", rollback: "отсутствует / минимальный" },
  { min: 2, max: 3, label: "Малая", dc: "10", rollback: "≈1 Стресс" },
  { min: 4, max: 5, label: "Средняя", dc: "15", rollback: "≈2 Стресса" },
  { min: 6, max: 7, label: "Сложная", dc: "20", rollback: "≈3 Стресса" },
  { min: 8, max: 8, label: "Невероятно сложная", dc: "25", rollback: "≈4 Стресса" }
];

// Секторы стороны Траты (Круг) и параметры страницы «Докупить жетоны» (см. дизайн-документ, разделы 2 и 6)
const SPEND_SECTORS = [
  { key: "urn", label: "Урон" },
  { key: "distance", label: "Дистанция" },
  { key: "area", label: "Область" },
  { key: "target", label: "Целеуказание" },
  { key: "duration", label: "Продолжительность" }
];

// GRANT_SECTORS: у каждого свой предел тира (maxTier) — раньше все считались 0–4, но у Скорости
// теперь 0–5. configurableMaxFlag — если задан, maxTier для этого сектора не константа, а
// настраиваемый ГМом максимум конкретного актора (флаг), который может быть и БОЛЬШЕ базового
// значения ниже (это именно то, что нужно: не ограничение в рамках 0–4, а сам верхний предел).
const GRANT_SECTORS = [
  { key: "speed", label: "Скорость", maxTier: 5 },
  { key: "price", label: "Цена", maxTier: 4, configurableMaxFlag: "priceMax" },
  { key: "sacrifice", label: "Жертва", maxTier: 4 },
  { key: "resource", label: "Ресурс", maxTier: 4 }
];

// Тексты для тиров Цены выше базовых 4 не заданы документом (максимум теперь настраивается ГМом
// и может быть больше) — генерируем по тому же образцу "N Стресс(а/ов)" с правильным русским
// склонением, раз сама механика Цены линейна (тир = столько-то Стресса).
function pluralizeStress(n) {
  if (n === 0) return "Не тратите";
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} Стресс`;
  if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) return `${n} Стресса`;
  return `${n} Стрессов`;
}

// Два обобщённых источника токенов (не персистентны между открытиями окна — см. README)
const MANA_SOURCE = { key: "mana", label: "Токены Маны", color: "#8A8A8A", letter: "M", icon: "fa-solid fa-droplet" };
// v0.23: переименовано из "Дикие Токены" (wild) в "Нестабильные Токены" (unstable) — ключ
// тоже сменился, это чисто эфемерное состояние сессии (нигде не персистится), так что миграция
// сохранённых данных не нужна.
const UNSTABLE_SOURCE = {
  key: "unstable",
  label: "Нестабильные Токены",
  color: "#A63D3D",
  letter: "U",
  icon: "fa-solid fa-triangle-exclamation"
};
const ALL_SOURCES = [...PATHS, MANA_SOURCE, UNSTABLE_SOURCE];

const TIER_ROMAN = ["0", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

// Тексты подсказок по тирам — взяты дословно из таблиц дизайн-документа
const TIER_INFO = {
  urn: ["Не наносит Ран", "1 Рана", "2 Раны", "3 Раны", "4 Раны"],
  distance: ["Вплотную", "Близко", "Средне", "Далеко", "Сцена"],
  area: ["Не по области", "Вплотную", "Близко", "Средне", "Далеко"],
  target: [
    "1 Цель",
    "Закл. Характеристика Целей",
    "Союзники/Противники",
    "Комбинирование предыдущих пунктов",
    "Не ограничено"
  ],
  duration: [
    "Мгновенное окончание",
    "До конца следующей Активации",
    "До конца Сцены",
    "До следующего Отдыха",
    "До следующего Долгого Отдыха"
  ],
  speed: [
    "Заклинание применяется как обычно",
    "Цель должна пройти Бросок Реакции, равный сложности вашего Броска Свободной Магии",
    "Цель получает Активацию",
    "Для применения заклинания необходимо завершить Отсчёт (до 6), продвигаемый каждую Активацию вашей Стороны",
    "Для применения заклинания необходимо завершить Отсчёт (от 6 до 12), продвигаемый каждую вашу Активацию",
    "Для применения заклинания необходимо завершить Долгий Отсчёт"
  ],
  price: ["Не тратите", "1 Стресс", "2 Стресса", "3 Стресса", "4 Стресса"],
  sacrifice: [
    "Ничем не жертвуете",
    "Жертвуете опытом",
    "Отдаёте 2 Карты",
    "Уменьшаете характеристики на 1",
    "Уменьшаете Руку/Надежду/Стресс/Раны на 1"
  ],
  resource: [
    "Не тратите Ресурс",
    "1 Ресурс",
    "Ресурс = низшему Ключевому Рангу",
    "Ресурс = сумме двух Ключевых Рангов",
    "Ресурс = удвоенной сумме Ключевых Рангов"
  ]
};

const N_RINGS = 4;
const R_HUB = 42;
const R_RING = 33;
// Центр и viewBox увеличены относительно радиуса самого Круга (радиус колец не менялся) —
// раньше метки секторов ближе к горизонтальным краям (Дистанция, Целеуказание) имели всего
// ~6 юнитов запаса до границы SVG и обрезались; теперь запас ~66 юнитов.
const CX = 230;
const CY = 230;

// Реестр окон Круга, открытых на ЭТОМ клиенте (actorId -> инстанс). Нужен, чтобы при получении
// сокет-сообщения "gmSetModifier" от ГМа понять, есть ли у ЭТОГО конкретного клиента открытое
// окно нужного актора — вещание идёт всем, а откликается только тот, у кого оно реально открыто.
const liveInstances = new Map();

Hooks.once("ready", () => {
  game.socket.on(`module.${MODULE_ID}`, (data) => {
    if (data?.action === "gmSetModifier") {
      const instance = liveInstances.get(data.actorId);
      if (!instance) return; // у этого клиента нет открытого Круга этого актора
      instance._applyRemoteModifierChange(data.modKey, data.value);
    } else if (data?.action === "gmSetReaction") {
      const instance = liveInstances.get(data.actorId);
      if (!instance) return;
      instance._applyRemoteReactionChange(data.modKey, data.value);
    }
  });
});

export class FreeMagicCircle extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "free-magic-circle",
    tag: "form",
    window: {
      title: "Круг Свободной Магии",
      icon: "fa-solid fa-circle-nodes",
      resizable: true
    },
    position: { width: 920, height: 640 }
  };

  static PARTS = {
    body: { template: "modules/free-magic/templates/circle.hbs" }
  };

  constructor(options = {}) {
    super(options);
    this.actor = options.actor ?? null;
    console.log("%c[FM DIAGNOSTIC] Конструктор FreeMagicCircle выполнен", "background:#cda85f;color:#221a0d;padding:2px 6px;border-radius:3px;", {
      actor: this.actor?.name,
      actorId: this.actor?.id,
      isGM: game.user?.isGM
    });

    // Временный запас по Путям — до готовности Item type «Путь Магии» (v0.5).
    // Персистентно (флаг актора, см. _loadPathPools). Значение по умолчанию — до загрузки сохранённого.
    this.pathPools = Object.fromEntries(PATHS.map((p) => [p.key, 0]));
    this.activePath = PATHS[0].key;

    // Нестабильные Токены (v0.23, ранее «Дикие Токены») — накапливаются в рамках ЭТОЙ сессии
    // сборки заклинания (см. README о персистентности). Два независимых источника пополнения:
    // старая кнопка «Взять 1 из Банка» (сейчас скрыта, предел PLAYER_BANK_DRAW_CAP=3) и новая
    // кнопка Магического Круга рядом с самим Кругом (предел — Заклинательный Лимит персонажа,
    // см. _onDrawInstability). Оба пути пишут в один и тот же счётчик.
    this.unstableTokens = 0;

    // Максимум Цены (сколько Стресса максимум можно вложить) — настраивает ГМ для конкретного
    // персонажа, персистентно (флаг актора). По умолчанию — базовое значение из GRANT_SECTORS,
    // но ГМ может поднять его выше (или опустить ниже) без верхнего предела с нашей стороны.
    this.priceMax = GRANT_SECTORS.find((s) => s.key === "price")?.maxTier ?? 4;

    // Свёрнуты по умолчанию — открываются кликом по заголовку (см. _toggleWidget).
    // Предпросмотр Чар — исключение, он раскрыт сразу, чтобы live-обратная связь была видна.
    // v0.25: «Мои Токены Маны» больше не виджет в левой колонке — вынесен в отдельное боковое
    // окно (см. tokens-panel-app.js), поэтому pathsExpanded/fm-paths-widget здесь больше нет.
    this.purchaseExpanded = false;
    this.previewExpanded = true;

    // Боковое окно «Мои Токены Маны» — создаётся вместе с Кругом (см. _onFirstRender) и живёт
    // ровно столько же (закрывается вместе с Кругом, см. _onClose). Ссылка нужна, чтобы все
    // существующие места, что раньше обновляли список токенов у себя внутри, теперь обновляли
    // список именно в этом отдельном окне — см. _refreshTokensPanel().
    this.tokensPanel = null;

    // Корректировка ГМа — храним как поле, а не читаем из DOM по требованию: это нужно
    // и для подсчёта итогов, и для подмешивания бонуса в пул Токенов Маны (см. _generatedBySource).
    this.gmAdjust = 0;

    // Распределение по секторам Круга: массив ключей источника (Путь / "mana" / "wild"), длина = тир сектора.
    this.spendAllocations = Object.fromEntries(SPEND_SECTORS.map((s) => [s.key, []]));
    // Параметры страницы «Докупить жетоны» — простые числа 0–4.
    this.grantTiers = Object.fromEntries(GRANT_SECTORS.map((s) => [s.key, 0]));

    // Модификаторы (v0.19) — теперь Item sub-type free-magic.modifier на акторе (см. modifiers.js),
    // конструктору, поэтому modsOn стартует пустым. Отсутствие ключа == "выключен" везде ниже
    // (`this.modsOn[m.key]`), так что пустой объект — корректное начальное состояние для
    // любого набора модификаторов, какой бы у актора ни оказался.
    this.modsOn = {};

    // v0.21 — панель Модификаторов теперь карточная, с вкладками-категориями и постраничным
    // листанием (модификаторов может быть сколько угодно — это библиотека предметов, не
    // захардкоженный список). Текущая вкладка/страница держится на инстансе окна.
    this.modCategory = null;
    this.modPage = 0;

    // v0.23 — Реакция ГМа: негативные модификаторы, которые ГМ применяет удалённо к ИМЕННО этой
    // активной сборке (см. gm-viewer-app.js). Игрок сам их не переключает — только видит красным
    // в Примерной Сложности и Предпросмотре Чар (см. _renderGmReactions). Ключ = id предмета-
    // Реакции, как и modsOn.
    this.gmReactionsOn = {};

    this._listenersBound = false;
    this._preFullscreenPosition = null;
  }

  get title() {
    return `Круг Свободной Магии — ${this.actor?.name ?? ""}`;
  }

  // Фиксируем стартовый размер окна ~в половину экрана (а не статичные 920×640 для всех
  // разрешений) — иначе на больших мониторах Круг открывался заметно меньше, чем мог бы,
  // и секторам вроде "Целеуказание"/"Дистанция" не хватало места. Срабатывает только на
  // самом первом рендере — дальнейшие ресайзы/перемещения окна пользователем не трогает.
  async _onFirstRender(context, options) {
    console.log("%c[FM DIAGNOSTIC] _onFirstRender вызван", "background:#cda85f;color:#221a0d;padding:2px 6px;border-radius:3px;", { actor: this.actor?.name });
    await super._onFirstRender?.(context, options);

    // v0.25: уведомление ГМа — самое важное, что должно произойти при открытии Круга, поэтому
    // делаем это ПЕРВЫМ делом, до любых побочных вещей вроде позиционирования окна или бокового
    // окна токенов — ошибка там не должна иметь шанса помешать этому.
    console.log("[FM DIAGNOSTIC] this.actor перед отправкой buildOpened:", this.actor);
    if (this.actor) {
      liveInstances.set(this.actor.id, this);
      const buildOpenedData = {
        action: "buildOpened",
        actorId: this.actor.id,
        actorName: this.actor.name,
        userId: game.user.id
      };
      console.log("%c[FM DIAGNOSTIC] Отправляю game.socket.emit(buildOpened)", "background:#cda85f;color:#221a0d;padding:2px 6px;border-radius:3px;", buildOpenedData, "канал:", `module.${MODULE_ID}`);
      game.socket.emit(`module.${MODULE_ID}`, buildOpenedData);
      // Сокет не доставляет отправителю его же сообщение — если Круг открывает сам ГМ
      // (тестирует лично или ведёт NPC), без этого прямого вызова виджет наблюдения у него
      // никогда бы не появился (см. подробный комментарий в gm-watch.js).
      if (game.user.isGM) handleGmWatchMessage(buildOpenedData);
    } else {
      console.warn("[FM DIAGNOSTIC] this.actor пуст — уведомление ГМу отправлено НЕ будет. Окно открыто без актора?");
    }

    const width = Math.max(1150, Math.round(window.innerWidth * 0.65));
    const height = Math.max(760, Math.round(window.innerHeight * 0.75));
    await this.setPosition({
      width,
      height,
      left: Math.round((window.innerWidth - width) / 2),
      top: Math.round((window.innerHeight - height) / 2)
    });

    // v0.25 — боковое окно «Мои Токены Маны» (см. tokens-panel-app.js), пристыкованное слева от
    // самого Круга. Обёрнуто в try/catch намеренно: сбой здесь не должен мешать основному окну
    // Круга нормально открыться и работать.
    try {
      this.tokensPanel = new FreeMagicTokensPanel({ circle: this });
      await this.tokensPanel.render(true);
      const pos = this.position;
      await this.tokensPanel.setPosition({
        left: Math.max(0, pos.left - 240),
        top: pos.top,
        width: 220,
        height: pos.height
      });
    } catch (err) {
      console.warn("Free Magic | Не удалось открыть боковое окно «Мои Токены Маны»", err);
    }

    // Если ГМ поменяет запас Путей/Максимум Цены (флаги актора) прямо из своего окна
    // наблюдения — эта же панель у игрока должна обновиться сама, без перезапуска окна.
    this._updateActorHookId = Hooks.on("updateActor", (actor) => {
      if (actor.id !== this.actor?.id) return;
      this._loadPathPools().then(() => this._refreshTokensPanel());
      this._loadPriceMax().then(() => this._renderPurchaseView(this.element.querySelector(".fm-purchase-view")));
      this._recalculate(this.element);
    });

    // Модификаторы — Items на акторе (личные) ИЛИ мировые Items без владельца (общие, v0.20,
    // настраиваются в GM Settings → «Модификаторы») — если что-то из этого поменялось прямо
    // во время открытого Круга, список должен обновиться сам, без перезакрытия окна.
    const onModifierItemChange = (item) => {
      const isOwnActorItem = item.parent?.id === this.actor?.id;
      const isGlobalModifier = !item.parent && item.type === MODIFIER_TYPE;
      if (!isOwnActorItem && !isGlobalModifier) return;
      if (!this.element) return;
      this._renderModifiers(this.element);
      this._refreshTokensPanel(); // пул Маны мог измениться
      this._recalculate(this.element);
    };
    this._itemHooks = [
      { name: "createItem", id: Hooks.on("createItem", onModifierItemChange) },
      { name: "updateItem", id: Hooks.on("updateItem", onModifierItemChange) },
      { name: "deleteItem", id: Hooks.on("deleteItem", onModifierItemChange) }
    ];
  }

  // При закрытии окна — снимаем себя с учёта и сообщаем ГМу, что сборка завершена
  // (виджет наблюдения у него уберёт эту строку).
  async _onClose(options) {
    await super._onClose?.(options);
    if (this._updateActorHookId) Hooks.off("updateActor", this._updateActorHookId);
    this._itemHooks?.forEach(({ name, id }) => Hooks.off(name, id));
    this._modTooltipEl?.remove(); // всплывающий предпросмотр Модификатора (v0.24) — не оставляем висеть в DOM
    this.tokensPanel?.close(); // боковое окно «Мои Токены Маны» (v0.25) закрывается вместе с Кругом
    if (this.actor) {
      liveInstances.delete(this.actor.id);
      const buildClosedData = { action: "buildClosed", actorId: this.actor.id };
      game.socket.emit(`module.${MODULE_ID}`, buildClosedData);
      if (game.user.isGM) handleGmWatchMessage(buildClosedData);
    }
  }

  // Применяет к своему состоянию модификатор, включённый/выключенный ГМом удалённо
  // (см. socket-обработчик "gmSetModifier" выше), и обновляет собственный интерфейс.
  _applyRemoteModifierChange(modKey, value) {
    const modifiers = getEffectiveModifiers(this.actor);
    const mod = modifiers.find((m) => m.key === modKey);
    if (!mod) return; // модификатор с таким id больше не существует у этого актора (удалён/переименован)
    this.modsOn[modKey] = Boolean(value);
    const root = this.element;
    if (!root) return;
    this._renderModifiers(root);
    this._refreshTokensPanel();
    this._recalculate(root);
    ui.notifications?.info(`ГМ изменил модификатор «${mod.label}»`);
  }

  // --- v0.23: Реакция ГМа — ГМ применил/снял негативный модификатор из отдельной библиотеки
  // именно к ЭТОЙ сборке (см. socket-обработчик "gmSetReaction" выше, gm-viewer-app.js). В
  // отличие от обычных Модификаторов, это состояние игрок не переключает сам — только видит
  // красным в Примерной Сложности и Предпросмотре Чар (см. _renderGmReactions), а числа реакции
  // всё равно участвуют в расчёте (_recalculate).
  _applyRemoteReactionChange(modKey, value) {
    const reaction = getGmReactionModifiers().find((m) => m.key === modKey);
    if (!reaction) return; // предмет-реакция удалён из библиотеки — ничего применять не к чему
    this.gmReactionsOn[modKey] = Boolean(value);
    const root = this.element;
    if (!root) return;
    this._refreshTokensPanel();
    this._recalculate(root);
    if (value) ui.notifications?.warn(`ГМ применил реакцию «${reaction.label}» к вашей сборке!`);
  }

  // --- Полноэкранный режим (кнопка внутри содержимого окна — надёжнее, чем API шапки, который не сработал) ---
  async _toggleFullscreen(root) {
    const el = this.element;
    if (this._preFullscreenPosition) {
      el.classList.remove("fm-fullscreen");
      await this.setPosition(this._preFullscreenPosition);
      this._preFullscreenPosition = null;
      root.querySelector(".fm-fullscreen-toggle i").className = "fa-solid fa-expand";
    } else {
      this._preFullscreenPosition = { ...this.position };
      el.classList.add("fm-fullscreen"); // CSS с !important — подстраховка, если setPosition чем-то ограничен
      await this.setPosition({
        left: 0,
        top: 0,
        width: window.innerWidth,
        height: window.innerHeight
      });
      root.querySelector(".fm-fullscreen-toggle i").className = "fa-solid fa-compress";
    }
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    const root = this.element;

    await this._loadPathPools();
    await this._loadPriceMax();

    if (!this._listenersBound) {
      root.querySelector(".fm-gm-value").addEventListener("input", (ev) => {
        this.gmAdjust = Number(ev.currentTarget.value) || 0;
        this._refreshTokensPanel(); // пул Маны мог измениться (отрицательная корректировка = бонус в Ману)
        this._recalculate(root);
      });
      root.querySelector(".fm-cast").addEventListener("click", () => this._onCast(root));
      root.querySelector(".fm-fullscreen-toggle").addEventListener("click", () => this._toggleFullscreen(root));
      root.querySelector(".fm-circle-instability-btn")?.addEventListener("click", () => this._onDrawInstability(root));

      root.querySelectorAll(".fm-widget-toggle").forEach((btn) => {
        btn.addEventListener("click", () => this._toggleWidget(root, btn.dataset.widget));
      });

      this._listenersBound = true;
    }

    this._renderModifiers(root);
    this._refreshTokensPanel();
    this._renderPurchaseView(root.querySelector(".fm-purchase-view"));
    this._renderCircle(root);
    this._renderInstabilityButton(root);
    this._recalculate(root);
    this._syncWidgetState(root);
  }

  _toggleWidget(root, widgetKey) {
    if (widgetKey === "purchase") this.purchaseExpanded = !this.purchaseExpanded;
    if (widgetKey === "preview") this.previewExpanded = !this.previewExpanded;
    this._syncWidgetState(root);
  }

  _syncWidgetState(root) {
    const purchaseWidget = root.querySelector(".fm-purchase-widget");
    purchaseWidget?.classList.toggle("fm-expanded", this.purchaseExpanded);
    const previewWidget = root.querySelector(".fm-preview-widget");
    previewWidget.classList.toggle("fm-expanded", this.previewExpanded);
  }

  /** Обновляет список «Мои Токены Маны» в боковом окне (см. tokens-panel-app.js), если оно
   * сейчас открыто и отрисовано. Раньше этот список жил прямо в circle.hbs и обновлялся через
   * _renderPathsPanel(this.element) — теперь _renderPathsPanel() всё та же функция, просто
   * нацеленная на DOM бокового окна вместо DOM самого Круга (у которого этого списка больше нет). */
  _refreshTokensPanel() {
    if (this.tokensPanel?.rendered && this.tokensPanel.element) {
      this._renderPathsPanel(this.tokensPanel.element);
    }
  }

  // --- Максимум Цены (флаг актора, теперь редактируется только в GM Settings → «Игроки»,
  // раздел 13 дизайн-документа; здесь только читаем текущее значение) ---

  async _loadPriceMax() {
    if (!this.actor) return;
    try {
      this.priceMax = await getPriceMax(this.actor);
    } catch (err) {
      console.warn("Free Magic | Не удалось загрузить максимум Цены", err);
    }
  }

  // --- Персистентность запаса Путей (на акторе — переживает закрытие/открытие окна) ---

  async _loadPathPools() {
    if (!this.actor) return;
    try {
      const saved = await this.actor.getFlag(MODULE_ID, "pathPools");
      if (saved) this.pathPools = { ...this.pathPools, ...saved };
    } catch (err) {
      console.warn("Free Magic | Не удалось загрузить сохранённый запас Путей", err);
    }
  }

  async _savePathPools() {
    if (!this.actor) return;
    try {
      await this.actor.setFlag(MODULE_ID, "pathPools", this.pathPools);
    } catch (err) {
      console.warn("Free Magic | Не удалось сохранить запас Путей", err);
    }
  }

  // --- Учёт источников токенов (Пути + Мана + Дикие) ---

  // Сколько уже размещено на Круге из данного источника
  _spentBySource(key) {
    let count = 0;
    for (const arr of Object.values(this.spendAllocations)) {
      count += arr.filter((k) => k === key).length;
    }
    return count;
  }

  // Сколько данный источник произвёл всего (для Путей — ручной пул; для Маны/Диких — по факту событий)
  _generatedBySource(key) {
    if (key === MANA_SOURCE.key) {
      const modifiers = getEffectiveModifiers(this.actor);
      const modsGrant = modifiers.filter((m) => this.modsOn[m.key] && m.tokenCost < 0).reduce(
        (a, m) => a + Math.abs(m.tokenCost),
        0
      );
      const purchaseGrant = Object.values(this.grantTiers).reduce((a, b) => a + b, 0);
      const gmGrant = Math.max(0, -this.gmAdjust); // отрицательная корректировка ГМа = бонус, уходит в Ману
      return modsGrant + purchaseGrant + gmGrant;
    }
    if (key === UNSTABLE_SOURCE.key) return this.unstableTokens;
    // Именной Путь: ручная база (флаг актора, панель на листе) + сумма бонусов от Items
    // (бонус-предметы, добавленные вручную, или предметы от Skill Tree — см. paths.js).
    return (this.pathPools[key] ?? 0) + getItemBonusByPath(this.actor, key);
  }

  _availableBySource(key) {
    return Math.max(0, this._generatedBySource(key) - this._spentBySource(key));
  }

  // --- Панель «Мои жетоны» (шесть Путей + Мана + Дикие) ---

  _renderPathsPanel(root) {
    const list = root.querySelector(".fm-paths-list");
    list.innerHTML = "";
    for (const src of ALL_SOURCES) {
      const isNamedPath = PATHS.some((p) => p.key === src.key);
      const spent = this._spentBySource(src.key);
      const generated = this._generatedBySource(src.key);

      // Токены Маны и Нестабильные Токены показываются в списке, только когда их уже не 0 —
      // до этого момента им просто нечего показывать (см. правку).
      if (!isNamedPath && generated <= 0) continue;

      const row = document.createElement("div");
      row.classList.add("fm-path-row");
      if (!isNamedPath) row.classList.add("fm-source-generic");
      if (src.key === this.activePath) row.classList.add("fm-path-active");
      row.style.setProperty("--fm-path-color", src.color);
      row.setAttribute("draggable", "true");

      let countHtml;
      if (isNamedPath) {
        // Важно: в поле редактируется только РУЧНАЯ база (флаг актора), а не итог с учётом
        // бонусов от Items — иначе бонус задвоился бы при следующем сохранении.
        // Полное управление базой + бонус-предметами — в постоянной панели на листе персонажа.
        const manualBase = this.pathPools[src.key] ?? 0;
        const itemBonus = getItemBonusByPath(this.actor, src.key);
        const bonusBadge = itemBonus > 0 ? `<span class="fm-path-item-bonus" title="Бонус от предметов (редактируется в панели на листе персонажа)">+${itemBonus}</span>` : "";
        countHtml = `${spent} / <input type="number" class="fm-path-pool" min="0" value="${manualBase}" />${bonusBadge} = ${generated}`;
      } else {
        countHtml = `${spent} / ${generated}`;
      }

      row.innerHTML = `
        <span class="fm-token" title="Путь: ${src.label}"><i class="${src.icon}"></i></span>
        <span class="fm-path-name">${src.label}</span>
        <span class="fm-path-count">${countHtml}</span>
      `;

      row.addEventListener("dragstart", (ev) => {
        ev.dataTransfer.setData("text/plain", src.key);
        ev.dataTransfer.effectAllowed = "copy";
      });

      row.addEventListener("click", (ev) => {
        if (ev.target.classList.contains("fm-path-pool")) return; // не перехватываем клик по полю ввода
        this.activePath = src.key;
        this._refreshTokensPanel();
      });

      if (isNamedPath) {
        row.querySelector(".fm-path-pool").addEventListener("change", async (ev) => {
          this.pathPools[src.key] = Number(ev.currentTarget.value) || 0;
          await this._savePathPools();
          this._refreshTokensPanel();
        });
      }

      list.appendChild(row);
    }
  }

  // --- Модификаторы: карточная панель с вкладками-категориями и постраничным листанием (v0.21) ---
  //
  // Модификаторы приходят из предметов (см. modifiers.js) — их может быть сколько угодно
  // (ГМ строит библиотеку и раскидывает её по персонажам), поэтому панель с самого начала
  // рассчитана на масштаб: категория (m.category, поле предмета) определяет вкладку, внутри
  // категории карточки листаются страницами по MODS_PER_PAGE.
  //
  // v0.24 — карточка теперь МИНИМАЛЬНАЯ: только иконка и три звезды дугой над ней (полукругом).
  // Всё остальное (название, бейджи стоимости/сложности, категория, требования, метка
  // Общий/Личный) переехало во всплывающий предпросмотр при наведении — см. _showModTooltip.
  // Для ОБЩИХ модификаторов звёзды кликабельны: это пишет персональное переопределение уровня
  // именно для этого персонажа (флаг актора, см. modifiers.js — getGlobalTierOverride), не
  // трогая сам предмет и не требуя открывать его лист (обычно доступный только ГМу).

  _modifierCardHtml(mod) {
    const active = Boolean(this.modsOn[mod.key]);
    const starsHtml = [1, 2, 3]
      .map((t) => `<i class="${t <= mod.currentTier ? "fa-solid" : "fa-regular"} fa-star" data-tier="${t}"></i>`)
      .join("");

    return `
      <div class="fm-mod-card ${active ? "fm-mod-card-active" : ""} ${mod.isTierOverridden ? "fm-mod-card-overridden" : ""}" data-key="${mod.key}">
        <div class="fm-mod-card-stars fm-tier-stars ${mod.isGlobal ? "fm-mod-card-stars-editable" : ""}" data-key="${mod.key}" title="${mod.isGlobal ? "Клик по звезде — свой уровень освоения для этого персонажа" : ""}">
          ${starsHtml}
        </div>
        <label class="fm-mod-card-icon-wrap">
          <input type="checkbox" data-key="${mod.key}" ${active ? "checked" : ""} hidden />
          <img class="fm-mod-icon" src="${mod.icon}" alt="" />
        </label>
      </div>
    `;
  }

  // --- Всплывающий предпросмотр карточки Модификатора при наведении мышью — единственный
  // DOM-элемент на инстанс окна, переиспользуется между карточками (создаётся лениво,
  // удаляется при закрытии окна — см. _onClose). ---

  _ensureModTooltipEl() {
    if (this._modTooltipEl && document.body.contains(this._modTooltipEl)) return this._modTooltipEl;
    const el = document.createElement("div");
    el.className = "fm-mod-tooltip";
    el.hidden = true;
    document.body.appendChild(el);
    this._modTooltipEl = el;
    return el;
  }

  _showModTooltip(cardEl, mod) {
    const tooltip = this._ensureModTooltipEl();

    const tokenBadge =
      mod.tokenCost < 0 ? `+${Math.abs(mod.tokenCost)} → Мана` : mod.tokenCost > 0 ? `-${mod.tokenCost} жетонов` : "";
    const difficultyBadge =
      mod.difficultyDelta !== 0 ? `${mod.difficultyDelta > 0 ? "+" : ""}${mod.difficultyDelta} к Сложности` : "";
    const sourceTag = mod.isGlobal
      ? `<span class="fm-mod-source fm-mod-source-global">Общий${mod.isTierOverridden ? " · свой уровень" : ""}</span>`
      : `<span class="fm-mod-source fm-mod-source-personal">Личный</span>`;

    tooltip.innerHTML = `
      <div class="fm-mod-tooltip-header">
        <img src="${mod.icon}" alt="" />
        <div class="fm-mod-tooltip-title">
          <strong>${mod.label}</strong>
          ${renderTierStars(mod.currentTier, { className: "fm-mod-tooltip-stars" })}
        </div>
      </div>
      <div class="fm-mod-tooltip-badges">
        ${tokenBadge ? `<span class="fm-mod-badge">${tokenBadge}</span>` : ""}
        ${difficultyBadge ? `<span class="fm-mod-badge fm-mod-badge-difficulty">${difficultyBadge}</span>` : ""}
        <span class="fm-mod-badge fm-mod-badge-category">${mod.category}</span>
        ${sourceTag}
      </div>
      ${mod.requirement ? `<p class="fm-mod-tooltip-requirement"><i class="fa-solid fa-lock"></i> ${mod.requirement}</p>` : ""}
      ${mod.isGlobal ? `<p class="fm-mod-tooltip-hint">Клик по звезде — свой уровень освоения для этого персонажа</p>` : ""}
    `;
    tooltip.hidden = false;

    const rect = cardEl.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    let left = rect.left + rect.width / 2 - tooltipRect.width / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - tooltipRect.width - 8));
    let top = rect.top - tooltipRect.height - 8;
    if (top < 8) top = rect.bottom + 8; // недостаточно места сверху — показываем снизу карточки
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }

  _hideModTooltip() {
    if (this._modTooltipEl) this._modTooltipEl.hidden = true;
  }

  _renderModifiers(root) {
    const tabsEl = root.querySelector(".fm-mods-tabs");
    const listEl = root.querySelector(".fm-mods-list");
    const pagerEl = root.querySelector(".fm-mods-pager");
    const emptyEl = root.querySelector(".fm-mods-empty");
    const modifiers = getEffectiveModifiers(this.actor);

    if (modifiers.length === 0) {
      tabsEl.innerHTML = "";
      listEl.innerHTML = "";
      pagerEl.hidden = true;
      pagerEl.innerHTML = "";
      emptyEl.hidden = false;
      emptyEl.textContent =
        "У персонажа нет доступных модификаторов — добавьте личные в панели «Пути Магии» на листе персонажа, либо попросите ГМа настроить общие.";
      return;
    }
    emptyEl.hidden = true;

    // Категории — в порядке первого появления (стабильный, предсказуемый порядок вкладок)
    const categories = [];
    for (const m of modifiers) {
      if (!categories.includes(m.category)) categories.push(m.category);
    }
    if (!this.modCategory || !categories.includes(this.modCategory)) this.modCategory = categories[0];

    tabsEl.innerHTML = categories
      .map(
        (cat) =>
          `<button type="button" class="fm-mods-tab ${cat === this.modCategory ? "fm-mods-tab-active" : ""}" data-cat="${cat}">${cat}</button>`
      )
      .join("");
    tabsEl.querySelectorAll(".fm-mods-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.modCategory = btn.dataset.cat;
        this.modPage = 0;
        this._renderModifiers(root);
      });
    });

    const modsInCategory = modifiers.filter((m) => m.category === this.modCategory);
    const totalPages = Math.max(1, Math.ceil(modsInCategory.length / MODS_PER_PAGE));
    this.modPage = Math.min(Math.max(0, this.modPage), totalPages - 1);
    const pageItems = modsInCategory.slice(this.modPage * MODS_PER_PAGE, (this.modPage + 1) * MODS_PER_PAGE);
    const modsByKey = new Map(pageItems.map((m) => [m.key, m]));

    listEl.innerHTML = pageItems.map((mod) => this._modifierCardHtml(mod)).join("");
    this._hideModTooltip();

    listEl.querySelectorAll(".fm-mod-card").forEach((card) => {
      const key = card.dataset.key;
      const mod = modsByKey.get(key);
      if (!mod) return;

      card.querySelector("input[type=checkbox]").addEventListener("change", (ev) => {
        this.modsOn[key] = ev.currentTarget.checked;
        this._refreshTokensPanel(); // пул Маны мог измениться
        this._recalculate(root);
        this._renderModifiers(root); // перерисовать подсветку активной карточки
      });

      card.addEventListener("mouseenter", () => this._showModTooltip(card, mod));
      card.addEventListener("mouseleave", () => this._hideModTooltip());

      if (mod.isGlobal) {
        card.querySelectorAll(".fm-mod-card-stars i").forEach((star) => {
          star.addEventListener("click", async (ev) => {
            ev.stopPropagation();
            ev.preventDefault();
            const tier = Number(star.dataset.tier);
            const hasOverride = getGlobalTierOverride(this.actor, mod.key) !== null;
            const nextTier = tier === mod.currentTier && hasOverride ? null : tier;
            await setGlobalTierOverride(this.actor, mod.key, nextTier);
            this._hideModTooltip();
            this._renderModifiers(root);
            this._recalculate(root);
          });
        });
      }
    });

    if (totalPages > 1) {
      pagerEl.hidden = false;
      pagerEl.innerHTML = `
        <button type="button" class="fm-mods-prev" ${this.modPage === 0 ? "disabled" : ""}><i class="fa-solid fa-chevron-left"></i></button>
        <span class="fm-mods-page-label">${this.modPage + 1} / ${totalPages}</span>
        <button type="button" class="fm-mods-next" ${this.modPage === totalPages - 1 ? "disabled" : ""}><i class="fa-solid fa-chevron-right"></i></button>
      `;
      pagerEl.querySelector(".fm-mods-prev").addEventListener("click", () => {
        this.modPage -= 1;
        this._renderModifiers(root);
      });
      pagerEl.querySelector(".fm-mods-next").addEventListener("click", () => {
        this.modPage += 1;
        this._renderModifiers(root);
      });
    } else {
      pagerEl.hidden = true;
      pagerEl.innerHTML = "";
    }
  }

  // --- Геометрия Круга ---

  _polar(r, deg) {
    const rad = ((deg - 90) * Math.PI) / 180;
    return { x: CX + r * Math.cos(rad), y: CY + r * Math.sin(rad) };
  }

  _annulus(rIn, rOut, a0, a1) {
    const p1 = this._polar(rOut, a0);
    const p2 = this._polar(rOut, a1);
    const p3 = this._polar(rIn, a1);
    const p4 = this._polar(rIn, a0);
    return `M ${p1.x} ${p1.y} A ${rOut} ${rOut} 0 0 1 ${p2.x} ${p2.y} L ${p3.x} ${p3.y} A ${rIn} ${rIn} 0 0 0 ${p4.x} ${p4.y} Z`;
  }

  // --- Рендер самого Круга ---

  _renderCircle(root) {
    const svg = root.querySelector(".fm-svg");
    const step = 360 / SPEND_SECTORS.length;

    let html = `
      <defs>
        <pattern id="fm-neutral-hatch" width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
          <rect width="6" height="6" class="fm-hatch-bg"></rect>
          <line x1="0" y1="0" x2="0" y2="6" class="fm-hatch-line"></line>
        </pattern>
      </defs>
    `;

    SPEND_SECTORS.forEach((sector, si) => {
      const a0 = si * step;
      const a1 = (si + 1) * step;
      const mid = (a0 + a1) / 2;
      const allocation = this.spendAllocations[sector.key];
      const tier = allocation.length;
      const tierTexts = TIER_INFO[sector.key] ?? [];

      html += `<path class="fm-hub" data-key="${sector.key}" data-tier="0" d="${this._annulus(0, R_HUB, a0, a1)}"><title>${sector.label} — тир 0 (нейтрально): ${tierTexts[0] ?? ""}</title></path>`;

      for (let t = 1; t <= N_RINGS; t++) {
        const rIn = R_HUB + (t - 1) * R_RING;
        const rOut = R_HUB + t * R_RING;
        const filled = tier >= t;
        let cls = "fm-wedge fm-empty";
        let style = "";
        let tokenIcon = "";

        if (filled) {
          const srcKey = allocation[t - 1];
          const srcDef = ALL_SOURCES.find((s) => s.key === srcKey);
          cls = "fm-wedge fm-filled-path";
          style = srcDef ? ` style="fill:${srcDef.color}"` : "";
          tokenIcon = srcDef?.icon ?? "";
        }

        const tooltip = `${sector.label} — тир ${TIER_ROMAN[t]}: ${tierTexts[t] ?? ""}`;
        html += `<path class="${cls}" data-key="${sector.key}" data-tier="${t}" d="${this._annulus(rIn, rOut, a0, a1)}"${style}><title>${tooltip}</title></path>`;

        if (tokenIcon) {
          const rMid = (rIn + rOut) / 2;
          const tp = this._polar(rMid, mid);
          const size = 18;
          html += `<foreignObject x="${tp.x - size / 2}" y="${tp.y - size / 2}" width="${size}" height="${size}" class="fm-ring-icon-box" style="pointer-events:none;">
            <div xmlns="http://www.w3.org/1999/xhtml" class="fm-ring-icon-wrap"><i class="${tokenIcon}"></i></div>
          </foreignObject>`;
        }
      }

      const lp = this._polar(R_HUB + N_RINGS * R_RING + 16, mid);
      html += `<text class="fm-label" x="${lp.x}" y="${lp.y}" text-anchor="middle" dominant-baseline="central">${sector.label} (${TIER_ROMAN[tier]})</text>`;

      const hubLabelPos = this._polar(R_HUB * 0.55, mid);
      html += `<text class="fm-hub-label" x="${hubLabelPos.x}" y="${hubLabelPos.y}" text-anchor="middle" dominant-baseline="central">0</text>`;
    });

    svg.innerHTML = html;

    svg.querySelectorAll("[data-tier]").forEach((el) => {
      el.addEventListener("click", () => this._onRingClick(root, el.dataset.key, Number(el.dataset.tier)));
      el.addEventListener("dragover", (ev) => {
        ev.preventDefault(); // обязательно — иначе drop не сработает
        ev.dataTransfer.dropEffect = "copy";
      });
      el.addEventListener("drop", (ev) => {
        ev.preventDefault();
        const sourceKey = ev.dataTransfer.getData("text/plain");
        if (sourceKey) this._onRingDrop(root, el.dataset.key, sourceKey);
      });
    });
  }

  // Клик по кольцу — выставляет тир целиком (см. _onRingClick).
  // Перетаскивание токена на сектор — добавляет ровно один жетон этого источника сверху стопки,
  // независимо от того, на какое именно кольцо внутри сектора он был отпущен.
  _onRingDrop(root, sectorKey, sourceKey) {
    const arr = this.spendAllocations[sectorKey];
    if (arr.length >= N_RINGS) {
      ui.notifications?.warn(`Сектор «${SPEND_SECTORS.find((s) => s.key === sectorKey)?.label ?? sectorKey}» уже заполнен до предела (IV)`);
      return;
    }
    const available = this._availableBySource(sourceKey);
    if (available < 1) {
      const label = ALL_SOURCES.find((s) => s.key === sourceKey)?.label ?? sourceKey;
      ui.notifications?.warn(`Недостаточно жетонов «${label}»`);
      return;
    }
    arr.push(sourceKey);
    this._renderCircle(root);
    this._refreshTokensPanel();
    this._recalculate(root);
  }

  _onRingClick(root, key, tier) {
    const arr = this.spendAllocations[key];
    if (tier <= arr.length) {
      // Уменьшаем тир — обрезаем массив сверху, освобождая жетоны
      arr.length = tier;
    } else {
      // Увеличиваем тир — добавляем новые сегменты активным источником, проверяя запас
      const needed = tier - arr.length;
      const available = this._availableBySource(this.activePath);
      if (needed > available) {
        const label = ALL_SOURCES.find((s) => s.key === this.activePath)?.label ?? this.activePath;
        ui.notifications?.warn(`Недостаточно жетонов «${label}» (доступно ${available})`);
        return;
      }
      for (let i = 0; i < needed; i++) arr.push(this.activePath);
    }

    this._renderCircle(root);
    this._refreshTokensPanel();
    this._recalculate(root);
  }

  // --- Виджет «Получить Токены Маны» ---
  // v0.21: временно скрыт в circle.hbs (по просьбе — нужна доработка), но метод и данные
  // (grantTiers, Банк) оставлены нетронутыми, чтобы функциональность можно было вернуть
  // одной правкой шаблона обратно.

  _renderPurchaseView(container) {
    container.innerHTML = "";

    const intro = document.createElement("p");
    intro.classList.add("fm-purchase-intro");
    intro.textContent = "Выберите уровень по каждому параметру — полученные жетоны появятся выше как «Токены Маны».";
    container.appendChild(intro);

    for (const sector of GRANT_SECTORS) {
      const tierTexts = TIER_INFO[sector.key] ?? [];
      const hasConfigurableMax = Boolean(sector.configurableMaxFlag);

      const row = document.createElement("div");
      row.classList.add("fm-purchase-row");

      // Максимум теперь редактируется только в GM Settings → вкладка «Игроки» (раздел 13
      // дизайн-документа) — здесь только читаем значение для расчёта эффективного максимума
      // и, для ГМа, показываем его как справочную информацию (без возможности править отсюда).
      const limitControl =
        hasConfigurableMax && game.user.isGM
          ? `<div class="fm-purchase-limit">
               <span>Максимум (настраивается в GM Settings → «Игроки»): <strong>${this.priceMax}</strong></span>
             </div>`
          : "";

      row.innerHTML = `
        <div class="fm-purchase-label">${sector.label}</div>
        ${limitControl}
        <div class="fm-purchase-tiers"></div>
        <div class="fm-purchase-desc"></div>
      `;

      const tiersEl = row.querySelector(".fm-purchase-tiers");
      const descEl = row.querySelector(".fm-purchase-desc");

      // Тексты для тиров сверх заданных в документе (актуально только для Цены, если ГМ
      // поднимет максимум выше 4) — генерируем по образцу "N Стресс(а/ов)".
      const getTierText = (t) => tierTexts[t] ?? (sector.key === "price" ? pluralizeStress(t) : "");
      const getTierLabel = (t) => TIER_ROMAN[t] ?? String(t);

      // Кнопки тира и их количество — отдельная функция, чтобы можно было перерисовать
      // ТОЛЬКО их при смене максимума, не трогая поле ввода (иначе оно теряло бы фокус).
      const renderTiers = () => {
        const effectiveMax = hasConfigurableMax ? this.priceMax : sector.maxTier;
        const current = this.grantTiers[sector.key];
        tiersEl.innerHTML = Array.from({ length: effectiveMax + 1 }, (_, t) => t)
          .map(
            (t) =>
              `<button type="button" class="fm-tier-btn ${t === current ? "fm-tier-active" : ""}" data-tier="${t}" title="${getTierText(t)}">${getTierLabel(t)}</button>`
          )
          .join("");
        tiersEl.querySelectorAll(".fm-tier-btn").forEach((btn) => {
          btn.addEventListener("click", () => {
            this.grantTiers[sector.key] = Number(btn.dataset.tier);
            renderTiers();
            this._refreshTokensPanel();
            this._recalculate(this.element);
          });
        });
        descEl.textContent = getTierText(current);
      };

      renderTiers();

      container.appendChild(row);
    }

    // Банк Магического Фона — для той Сцены, которую сейчас видит клиент (canvas.scene),
    // либо глобальный Фон, если у Сцены нет своих настроенных данных (см. bank.js).
    const sceneId = this._currentSceneId();
    const sceneName = sceneId ? (game.scenes?.get(sceneId)?.name ?? "текущая Сцена") : null;
    const status = getBankStatus(sceneId);
    const capReached = this.unstableTokens >= PLAYER_BANK_DRAW_CAP;

    const bankBox = document.createElement("div");
    bankBox.classList.add("fm-bank-box");
    bankBox.innerHTML = `
      <div class="fm-purchase-label">Банк Магического Фона</div>
      <div class="fm-bank-location">Локация: <strong>${sceneName ?? "глобально (Сцена не выбрана)"}</strong></div>
      <div class="fm-bank-status">
        Состояние: <strong>${status.stateLabel}</strong> ·
        Уровень: <strong>${status.level.label}</strong>${game.user.isGM ? ` (${status.value}/${status.max} шт., видно только ГМ)` : ""}
      </div>
      <div class="fm-bank-cap">Ваш лимит за эту сборку: ${this.unstableTokens} / ${PLAYER_BANK_DRAW_CAP}</div>
      <div class="fm-bank-actions">
        <button type="button" class="fm-bank-draw" ${capReached ? "disabled" : ""}>Взять 1 из Банка</button>
        ${game.user.isGM ? `<button type="button" class="fm-bank-configure"><i class="fa-solid fa-gear"></i> Настроить</button>` : ""}
      </div>
      <p class="fm-bank-hint">Полученный жетон появится выше как «Нестабильные Токены».</p>
    `;
    bankBox.querySelector(".fm-bank-draw").addEventListener("click", () => this._onDrawBank(container));
    bankBox.querySelector(".fm-bank-configure")?.addEventListener("click", () => new FreeMagicBankConfig().render(true));
    container.appendChild(bankBox);
  }

  // Сцена, к которой сейчас привязан Банк для этого клиента — та, что видна на канвасе.
  // Если игрок ни на какой сцене (или canvas ещё не готов) — считаем это глобальным Фоном.
  _currentSceneId() {
    return canvas?.scene?.id ?? null;
  }

  /**
   * Единая точка получения одного Нестабильного Токена: уменьшает мировой пул Магического Фона
   * на 1 (напрямую, если ГМ; через сокет-запрос ГМу, если игрок — см. README про то, почему это
   * оптимистичное обновление без подтверждения) и увеличивает личный счётчик unstableTokens.
   * Используется ДВУМЯ независимыми путями — старой кнопкой «Взять 1 из Банка» (сейчас скрыта,
   * см. _onDrawBank, предел PLAYER_BANK_DRAW_CAP) и новой кнопкой Магического Круга рядом с
   * самим Кругом (см. _onDrawInstability, предел — Заклинательный Лимит персонажа). Проверка
   * предела делается ДО вызова этого метода, он сам ничего не ограничивает.
   */
  async _drawInstabilityToken() {
    const sceneId = this._currentSceneId();
    const current = getBankStatus(sceneId).value;
    if (current <= 0) {
      ui.notifications?.warn("Магический Фон пуст.");
      return false;
    }

    if (game.user.isGM) {
      await setBankValue(current - 1, sceneId);
    } else {
      game.socket.emit(`module.${MODULE_ID}`, { action: "drawBank", amount: 1, sceneId });
    }

    this.unstableTokens += 1;
    return true;
  }

  async _onDrawBank(container) {
    if (this.unstableTokens >= PLAYER_BANK_DRAW_CAP) {
      ui.notifications?.warn(`Лимит взятия из Банка за эту сборку исчерпан (${PLAYER_BANK_DRAW_CAP})`);
      return;
    }

    const ok = await this._drawInstabilityToken();
    if (!ok) return;

    this._renderPurchaseView(container);
    this._refreshTokensPanel();
    this._recalculate(this.element);
  }

  // --- v0.23: Кнопка Магического Круга рядом с самой SVG-схемой Круга — прямая, всегда видимая
  // альтернатива скрытой сейчас кнопке «Взять 1 из Банка» выше. Клик даёт Нестабильный Токен на
  // эту сборку, но предел здесь — не фиксированная тройка, а Заклинательный Лимит персонажа
  // (см. spellcast-limit.js). Иконка истощается визуально по мере приближения к пределу —
  // см. _renderInstabilityButton.

  async _onDrawInstability(root) {
    const limit = getSpellcastLimit(this.actor);
    if (!Number.isFinite(limit) || limit <= 0) {
      ui.notifications?.warn(
        "Заклинательный Лимит не задан для этого персонажа — попросите ГМа настроить его в GM Settings → «Игроки»."
      );
      return;
    }
    if (this.unstableTokens >= limit) {
      ui.notifications?.warn(`Заклинательный Лимит исчерпан (${limit}) — через Круг больше не взять за эту сборку.`);
      return;
    }

    const ok = await this._drawInstabilityToken();
    if (!ok) return;

    this._refreshTokensPanel();
    this._recalculate(root); // сама и вызовет _renderInstabilityButton через _renderPreview-цепочку ниже
  }

  /** Обновляет саму кнопку Круга: иконка (настраиваемая ГМом, см. scene-resource.js), степень
   * "истощения" (визуально по мере приближения unstableTokens к Заклинательному Лимиту), и
   * состояние disabled, когда лимит достигнут или не задан вовсе. */
  _renderInstabilityButton(root) {
    const btn = root.querySelector(".fm-circle-instability-btn");
    if (!btn) return;

    try {
      const limit = getSpellcastLimit(this.actor);
      const hasLimit = Number.isFinite(limit) && limit > 0;
      const ratio = hasLimit ? Math.min(1, this.unstableTokens / limit) : 0;
      const remainingPct = Math.round((1 - ratio) * 100);
      const depleted = !hasLimit || this.unstableTokens >= limit;

      btn.innerHTML = renderIconHtml(getBackgroundIcon(), { className: "fm-circle-instability-icon" });
      btn.style.setProperty("--fm-instability-remaining", String(remainingPct));
      btn.classList.toggle("fm-depleted", depleted);
      btn.title = hasLimit
        ? `Получить Нестабильный Токен (${this.unstableTokens}/${limit} от Заклинательного Лимита за эту сборку)`
        : "Заклинательный Лимит не задан — обратитесь к ГМу";
    } catch (err) {
      // Защита от неожиданных данных (например, отсутствующего @cast у конкретного актора) —
      // не должно ронять весь рендер окна и уж тем более мешать открытию/уведомлению ГМа.
      console.warn("Free Magic | Не удалось обновить кнопку Нестабильности", err);
    }
  }

  // --- Примерная Сложность (см. дизайн-документ: «Определение сложности броска») ---
  // Только ориентир для игрока — окончательную категорию всегда определяет ГМ с учётом
  // нарративного веса и особых условий, которые конструктор не может оценить сам.

  _computeDifficulty() {
    const used = SPEND_SECTORS.map((s) => ({ sector: s, tier: this.spendAllocations[s.key].length }))
      .filter((e) => e.tier > 0)
      .sort((a, b) => b.tier - a.tier);

    const top2 = used.slice(0, 2);
    const sum = top2.reduce((a, e) => a + e.tier, 0);
    const category = DIFFICULTY_TABLE.find((c) => sum >= c.min && sum <= c.max) ?? DIFFICULTY_TABLE[0];

    return { top2, sum, category };
  }

  _describeSectorSources(sectorKey) {
    const arr = this.spendAllocations[sectorKey];
    const counts = {};
    for (const k of arr) counts[k] = (counts[k] ?? 0) + 1;
    return Object.entries(counts)
      .map(([k, n]) => `${ALL_SOURCES.find((p) => p.key === k)?.label ?? k} ×${n}`)
      .join(", ");
  }

  _renderDifficulty(root) {
    const { top2, sum, category } = this._computeDifficulty();

    root.querySelector(".fm-difficulty-category-value").textContent = category.label;
    root.querySelector(".fm-difficulty-dc-value").textContent = `≈ ${category.dc}`;
    root.querySelector(".fm-difficulty-rollback-value").textContent = `≈ ${category.rollback}`;

    const keysRow = root.querySelector(".fm-difficulty-keys-row");
    const keysEl = root.querySelector(".fm-difficulty-keys");
    const resourceRow = root.querySelector(".fm-difficulty-resource-row");
    const resourceText = root.querySelector(".fm-difficulty-resource-text");

    if (top2.length === 0) {
      keysRow.hidden = true;
      resourceRow.hidden = true;
    } else if (top2.length === 1) {
      const only = top2[0];
      keysEl.textContent = `${only.sector.label} ${TIER_ROMAN[only.tier]}`;
      keysRow.hidden = false;
      resourceText.textContent = `Требует ${only.tier} Ресурса для применения`;
      resourceRow.hidden = false;
    } else {
      const [a, b] = top2;
      keysEl.textContent = `${a.sector.label} ${TIER_ROMAN[a.tier]} и ${b.sector.label} ${TIER_ROMAN[b.tier]}`;
      keysRow.hidden = false;
      // top2 отсортирован по убыванию тира (см. _computeDifficulty) — a.tier всегда самый большой
      resourceText.textContent = `Требует ${a.tier} Ресурса для применения`;
      resourceRow.hidden = false;
    }

    void sum; // сумма не показывается напрямую в этом виджете, только категория/сложность/откат
  }

  // --- Независимая поправка к Сложности от модификаторов (v0.19, см. modifiers.js) ---
  // Не входит в табличный расчёт выше — отдельная строка вида "+5 к Сложности (Название)"
  // на каждый активный модификатор с ненулевым difficultyDelta.

  _renderDifficultyModifiers(root, activeDifficultyMods) {
    const row = root.querySelector(".fm-difficulty-mods-row");
    const list = row.querySelector(".fm-difficulty-mods-list");

    if (activeDifficultyMods.length === 0) {
      row.hidden = true;
      list.innerHTML = "";
      return;
    }

    row.hidden = false;
    list.innerHTML = activeDifficultyMods
      .map((m) => `<li>${m.difficultyDelta > 0 ? "+" : ""}${m.difficultyDelta} к Сложности (${m.label})</li>`)
      .join("");
  }

  // --- v0.23: Реакция ГМа — отдельный, КРАСНЫЙ блок в «Примерной Сложности», не смешивается
  // с обычными (золотыми) Модификаторами Сложности выше — игрок должен сразу видеть, что это
  // применил ГМ, а не его собственный выбор. См. _applyRemoteReactionChange/_recalculate.

  _renderGmReactions(root, activeReactions, activeReactionDifficultyMods) {
    const row = root.querySelector(".fm-difficulty-reactions-row");
    if (!row) return;
    const list = row.querySelector(".fm-difficulty-reactions-list");

    if (activeReactions.length === 0) {
      row.hidden = true;
      list.innerHTML = "";
      return;
    }

    row.hidden = false;
    list.innerHTML = activeReactions
      .map((m) => {
        const parts = [];
        if (m.tokenCost !== 0) parts.push(`${m.tokenCost > 0 ? "+" : ""}${m.tokenCost} жетонов`);
        if (m.difficultyDelta !== 0) parts.push(`${m.difficultyDelta > 0 ? "+" : ""}${m.difficultyDelta} Слож.`);
        const desc = parts.length ? ` (${parts.join(", ")})` : "";
        return `<li>${m.label}${desc}</li>`;
      })
      .join("");

    void activeReactionDifficultyMods; // уже включены в общий список выше — отдельно не выводим
  }

  // --- Предпросмотр Чар: живое нарративное описание собираемого заклинания ---
  // Урон и Продолжительность — по одному сектору каждый. "Действует на..." объединяет сразу
  // три сектора (Целеуказание/Дистанция/Область) в одну фразу, как и было в примере запроса.
  // Формулировки для тиров выше нуля — не полноценная генерация естественного языка (это дало
  // бы неоднозначные русские склонения на стыке фраз), а просто явное "Ярлык: значение" —
  // остаётся понятным при любой комбинации тиров, но менее "литературно", чем нулевой пример.

  _renderPreview(root, activeReactions = []) {
    const dmgTier = this.spendAllocations.urn.length;
    const durTier = this.spendAllocations.duration.length;
    const targetTier = this.spendAllocations.target.length;
    const distTier = this.spendAllocations.distance.length;
    const areaTier = this.spendAllocations.area.length;

    const dmgEl = root.querySelector(".fm-preview-damage");
    const durEl = root.querySelector(".fm-preview-duration");
    const reachEl = root.querySelector(".fm-preview-reach");

    dmgEl.textContent =
      dmgTier === 0 ? "Ваше заклинание не наносит урона" : `Ваше заклинание наносит: ${TIER_INFO.urn[dmgTier]}`;

    durEl.textContent =
      durTier === 0
        ? "Ваше заклинание мгновенно развеивается после применения"
        : `Длительность: ${TIER_INFO.duration[durTier]}`;

    reachEl.textContent =
      targetTier === 0 && distTier === 0 && areaTier === 0
        ? "Ваше заклинание действует на 1 цель вплотную, не по области"
        : `Действует на: ${TIER_INFO.target[targetTier]}, ${TIER_INFO.distance[distTier]}, ${TIER_INFO.area[areaTier]}`;

    // Золотая подсветка тех строк, что относятся к Ключевым Направлениям (двум наивысшим тирам)
    const { top2 } = this._computeDifficulty();
    const keyKeys = new Set(top2.map((e) => e.sector.key));
    dmgEl.classList.toggle("fm-preview-key", keyKeys.has("urn"));
    durEl.classList.toggle("fm-preview-key", keyKeys.has("duration"));
    reachEl.classList.toggle(
      "fm-preview-key",
      keyKeys.has("target") || keyKeys.has("distance") || keyKeys.has("area")
    );

    // v0.23 — строка про Нестабильность: показывается, как только за эту сборку взят хотя бы
    // один Нестабильный Токен (через кнопку Круга или старую кнопку Банка) — намеренно БЕЗ
    // уточнения, станет ли Фон реально Нестабильным (это зависит от текущего запаса Фона,
    // игрок этого не знает и не должен).
    const instabilityEl = root.querySelector(".fm-preview-instability");
    if (instabilityEl) instabilityEl.hidden = this.unstableTokens <= 0;

    // v0.23 — Реакция ГМа красным прямо в Предпросмотре Чар, отдельно от обычного текста заклинания.
    const reactionsEl = root.querySelector(".fm-preview-reactions");
    if (reactionsEl) {
      if (activeReactions.length === 0) {
        reactionsEl.hidden = true;
        reactionsEl.innerHTML = "";
      } else {
        reactionsEl.hidden = false;
        reactionsEl.innerHTML = activeReactions
          .map((m) => `<p class="fm-preview-reaction-item">⚡ ГМ применил реакцию: ${m.label}</p>`)
          .join("");
      }
    }
  }

  // --- Итоги ---

  _recalculate(root) {
    const spendSum = Object.values(this.spendAllocations).reduce((a, arr) => a + arr.length, 0);
    const totalAvailable = ALL_SOURCES.reduce((a, s) => a + this._generatedBySource(s.key), 0);
    const modifiers = getEffectiveModifiers(this.actor);
    const modsCost = modifiers.reduce((a, m) => a + (this.modsOn[m.key] && m.tokenCost > 0 ? m.tokenCost : 0), 0);

    // v0.23 — Реакция ГМа: активные негативные модификаторы, применённые ГМом именно к этой
    // сборке (см. _applyRemoteReactionChange). Их стоимость/сложность считается наравне с
    // обычными Модификаторами, но показывается отдельно и КРАСНЫМ (см. _renderGmReactions) —
    // игрок должен сразу видеть, что это вмешательство ГМа, а не его собственный выбор.
    const activeReactions = getGmReactionModifiers().filter((m) => this.gmReactionsOn[m.key]);
    const reactionsCost = activeReactions.reduce((a, m) => a + m.tokenCost, 0);

    // Положительная часть Корректировки ГМа — доп. стоимость, входит в требуемую сумму напрямую.
    // Отрицательная часть уже учтена через пул Токенов Маны (см. _generatedBySource) — второй раз не считаем,
    // иначе бонус задвоится.
    const gmAdjustCost = Math.max(0, this.gmAdjust);
    const totalRequired = spendSum + modsCost + gmAdjustCost + reactionsCost;
    const remainder = totalAvailable - totalRequired;

    root.querySelector(".fm-total-available").textContent = totalAvailable;
    root.querySelector(".fm-spend-sum").textContent = spendSum;
    root.querySelector(".fm-mods-sum").textContent = modsCost;
    root.querySelector(".fm-gm-sum").textContent = this.gmAdjust > 0 ? `+${this.gmAdjust}` : `${this.gmAdjust}`;
    root.querySelector(".fm-required-sum").textContent = totalRequired;
    root.querySelector(".fm-remainder-sum").textContent = remainder;

    const reactionSumRow = root.querySelector(".fm-reaction-sum-row");
    if (reactionSumRow) {
      reactionSumRow.hidden = activeReactions.length === 0;
      const reactionSumEl = root.querySelector(".fm-reaction-sum");
      if (reactionSumEl) reactionSumEl.textContent = reactionsCost > 0 ? `+${reactionsCost}` : `${reactionsCost}`;
    }

    const warning = root.querySelector(".fm-overspend-warning");
    if (remainder < 0) {
      warning.hidden = false;
      warning.textContent = `⚠ Не хватает ${Math.abs(remainder)} жетон(ов) для этого заклинания`;
    } else {
      warning.hidden = true;
    }

    // v0.19 — независимая от табличного расчёта поправка к Сложности от активных модификаторов
    // (difficultyDelta, см. modifiers.js) — своя отдельная строка, не смешивается с DC из таблицы.
    const activeDifficultyMods = modifiers.filter((m) => this.modsOn[m.key] && m.difficultyDelta !== 0);
    const difficultyDeltaSum = activeDifficultyMods.reduce((a, m) => a + m.difficultyDelta, 0);
    const activeReactionDifficultyMods = activeReactions.filter((m) => m.difficultyDelta !== 0);

    this._renderDifficulty(root);
    this._renderDifficultyModifiers(root, activeDifficultyMods);
    this._renderGmReactions(root, activeReactions, activeReactionDifficultyMods);
    this._renderInstabilityButton(root);
    this._renderPreview(root, activeReactions);
    this._broadcastStateThrottled();

    return {
      spendSum,
      modsCost,
      gmAdjust: this.gmAdjust,
      reactionsCost,
      totalRequired,
      totalAvailable,
      remainder,
      difficultyDeltaSum,
      activeDifficultyMods,
      activeReactions,
      activeReactionDifficultyMods
    };
  }

  // --- Трансляция состояния для окна наблюдения ГМа (см. gm-watch.js/gm-viewer-app.js) ---
  // Троттлинг — чтобы не заваливать сокет при быстром вводе (например, поле Корректировки ГМа
  // использует событие "input", которое стреляет на каждое нажатие клавиши).

  _broadcastStateThrottled() {
    if (this._broadcastTimer) clearTimeout(this._broadcastTimer);
    this._broadcastTimer = setTimeout(() => this._broadcastState(), 200);
  }

  _broadcastState() {
    if (!this.actor) return;
    const state = {
      spendAllocations: this.spendAllocations,
      grantTiers: this.grantTiers,
      modsOn: this.modsOn,
      gmAdjust: this.gmAdjust,
      unstableTokens: this.unstableTokens,
      gmReactionsOn: this.gmReactionsOn,
      intent: this.element?.querySelector(".fm-intent-text")?.value ?? ""
    };
    const buildStateUpdateData = {
      action: "buildStateUpdate",
      actorId: this.actor.id,
      actorName: this.actor.name,
      userId: game.user.id,
      state
    };
    game.socket.emit(`module.${MODULE_ID}`, buildStateUpdateData);
    if (game.user.isGM) handleGmWatchMessage(buildStateUpdateData);
  }

  async _onCast(root) {
    const totals = this._recalculate(root);

    if (totals.remainder < 0) {
      ui.notifications?.warn(
        `Внимание: не хватает ${Math.abs(totals.remainder)} жетон(ов). Карточка всё равно будет отправлена — решение за ГМ.`
      );
    }

    const intent = root.querySelector(".fm-intent-text").value.trim();
    const gmNote = root.querySelector(".fm-gm-note").value.trim();

    const spendRows = SPEND_SECTORS.filter((s) => this.spendAllocations[s.key].length > 0)
      .map((s) => {
        const arr = this.spendAllocations[s.key];
        const counts = {};
        for (const k of arr) counts[k] = (counts[k] ?? 0) + 1;
        const breakdown = Object.entries(counts)
          .map(([k, n]) => `${ALL_SOURCES.find((p) => p.key === k)?.label ?? k} ×${n}`)
          .join(", ");
        return `<li>${s.label}: тир ${TIER_ROMAN[arr.length]} (${breakdown})</li>`;
      })
      .join("");

    const modRows = getEffectiveModifiers(this.actor)
      .filter((m) => this.modsOn[m.key])
      .map((m) => {
        const parts = [];
        if (m.tokenCost < 0) parts.push(`даёт +${Math.abs(m.tokenCost)} в Токены Маны`);
        else if (m.tokenCost > 0) parts.push(`доп. стоимость ${m.tokenCost}`);
        if (m.difficultyDelta !== 0) parts.push(`${m.difficultyDelta > 0 ? "+" : ""}${m.difficultyDelta} к Сложности`);
        const desc = parts.length ? parts.join("; ") : "без влияния на стоимость/сложность";
        return `<li>${m.label} (${desc})</li>`;
      })
      .join("");

    const difficultyModsDesc = totals.activeDifficultyMods.length
      ? totals.activeDifficultyMods
          .map((m) => `${m.difficultyDelta > 0 ? "+" : ""}${m.difficultyDelta} (${m.label})`)
          .join(", ")
      : null;

    const gmAdjustDesc =
      totals.gmAdjust > 0
        ? `+${totals.gmAdjust} (доп. стоимость)`
        : totals.gmAdjust < 0
          ? `${totals.gmAdjust} (уже учтено в Токенах Маны)`
          : "0";

    const { top2, sum, category } = this._computeDifficulty();
    const keyDirectionsDesc =
      top2.length === 2
        ? `${top2[0].sector.label} ${TIER_ROMAN[top2[0].tier]} + ${top2[1].sector.label} ${TIER_ROMAN[top2[1].tier]} = ${sum}`
        : top2.length === 1
          ? `${top2[0].sector.label} ${TIER_ROMAN[top2[0].tier]}`
          : "не выбрано";

    const reactionRows = totals.activeReactions
      .map((m) => {
        const parts = [];
        if (m.tokenCost !== 0) parts.push(`${m.tokenCost > 0 ? "+" : ""}${m.tokenCost} жетонов`);
        if (m.difficultyDelta !== 0) parts.push(`${m.difficultyDelta > 0 ? "+" : ""}${m.difficultyDelta} к Сложности`);
        const desc = parts.length ? ` (${parts.join(", ")})` : "";
        return `<li>${m.label}${desc}</li>`;
      })
      .join("");

    const content = `
      <div class="free-magic-card">
        <h3>Свободная Магия — ${this.actor?.name ?? "Неизвестный маг"}</h3>
        ${intent ? `<p><em>${intent}</em></p>` : ""}
        ${spendRows ? `<p><strong>Секторы Круга:</strong></p><ul>${spendRows}</ul>` : ""}
        ${modRows ? `<p><strong>Модификаторы:</strong></p><ul>${modRows}</ul>` : ""}
        ${reactionRows ? `<p><strong style="color:#e5536b">⚡ Реакция ГМа:</strong></p><ul style="color:#e5536b">${reactionRows}</ul>` : ""}
        <p><strong>Модификаторы (доп. стоимость):</strong> ${totals.modsCost}</p>
        <p><strong>Корректировка ГМа:</strong> ${gmAdjustDesc}${gmNote ? ` — ${gmNote}` : ""}</p>
        <p><strong>Итого требуется:</strong> ${totals.totalRequired} жетон(ов)</p>
        <p><strong>Остаток:</strong> ${totals.remainder}${totals.remainder < 0 ? " (перерасход!)" : ""}</p>
        <p><strong>Два Ключевых Направления:</strong> ${keyDirectionsDesc}</p>
        ${difficultyModsDesc ? `<p><strong>Модификаторы Сложности:</strong> ${difficultyModsDesc}</p>` : ""}
        ${this.unstableTokens > 0 ? `<p><em>Действия персонажа повысят Нестабильность Магического Фона.</em></p>` : ""}
        <p class="fm-difficulty-placeholder"><em>Ориентировочная категория — ${category.label} (Сложность ≈ ${category.dc}, Откат ≈ ${category.rollback}). Финальное слово за ГМ — с учётом нарративного веса и особых условий.</em></p>
      </div>
    `;

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      content
    });

    this.close();
  }
}
