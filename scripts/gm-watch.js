import { MODULE_ID } from "./bank.js";
import { FreeMagicGmViewer } from "./gm-viewer-app.js";

// actorId -> { actorName, userId, state, updatedAt }
const openBuilds = new Map();
// actorId -> FreeMagicGmViewer instance, чтобы проталкивать live-обновления в уже открытое окно
const openViewers = new Map();

let widgetEl = null;

export function registerGmWatch() {
  Hooks.once("ready", () => {
    // v0.25 — ВАЖНО: слушатель сокета регистрируется теперь БЕЗУСЛОВНО, для любого пользователя,
    // а не только "если game.user.isGM в момент ready" как было раньше. Причина: единственное
    // прежде видимое подтверждение работы этого файла — виджет у ГМа на его СОБСТВЕННОЙ сборке —
    // на самом деле НЕ проходит через сокет вообще (см. circle-app.js: если открывающий Круг сам
    // ГМ, handleGmWatchMessage вызывается напрямую, в обход game.socket). То есть тот факт, что
    // виджет появлялся у ГМа на его же сборке, ничего не говорил о том, реально ли отработала
    // строка `game.socket.on(...)` ниже — а если внешняя проверка `if (!game.user.isGM) return;`
    // по каким-то причинам не прошла именно в момент срабатывания хука "ready", слушатель мог не
    // зарегистрироваться вовсе, и тогда сообщения от ДРУГИХ клиентов (игроков) просто некому было
    // бы принимать. Актуальная проверка роли по-прежнему есть — но теперь ВНУТРИ
    // handleGmWatchMessage, на каждое конкретное сообщение, а не один раз при запуске клиента.
    console.log("Free Magic | gm-watch: регистрирую слушателя сокета", `module.${MODULE_ID}`);
    game.socket.on(`module.${MODULE_ID}`, (data) => {
      console.log("Free Magic | gm-watch: получено сокет-сообщение", data);
      handleGmWatchMessage(data);
    });

    if (game.user.isGM) {
      ensureWidget();
      console.log("Free Magic | gm-watch: я ГМ, виджет наблюдения готов");
    }
  });
}

/**
 * Общая точка обработки сообщений виджета наблюдения ГМа. Вызывается двумя путями:
 *  1) из сокет-слушателя выше — когда сборку открыл/поменял ДРУГОЙ клиент (обычный игрок);
 *  2) напрямую из circle-app.js — когда сборку открывает сам ГМ на СВОЁМ клиенте.
 *
 * Пункт 2 — не паранойя, а причина бага "виджет вообще не появляется": Foundry (как и любой
 * socket.io) не доставляет клиенту его же собственные сообщения, отправленные через
 * game.socket.emit(). Если ГМ тестирует модуль сам на себе (или просто играет одним из
 * персонажей помимо ведения игры), event долетает до сервера и рассылается ВСЕМ ОСТАЛЬНЫМ —
 * то есть в комнате из одного человека не долетает никому. circle-app.js поэтому зовёт эту
 * функцию напрямую сразу после game.socket.emit(), если отправитель сам ГМ — тем самым
 * симулируя "получение своего же сообщения" без правки поведения сокета.
 */
export function handleGmWatchMessage(data) {
  if (!data) return;
  if (!game.user.isGM) {
    console.log("Free Magic | gm-watch: сообщение проигнорировано — этот клиент не ГМ", data?.action);
    return; // страховка — обрабатывать имеет смысл только на клиенте ГМа
  }

  console.log("Free Magic | gm-watch: обрабатываю сообщение", data.action, data);
  ensureWidget(); // на случай, если функция вызвана раньше, чем отработал ready-хук выше

  if (data.action === "buildOpened") {
    openBuilds.set(data.actorId, {
      actorName: data.actorName,
      userId: data.userId,
      state: openBuilds.get(data.actorId)?.state ?? null,
      updatedAt: Date.now()
    });
    renderWidget();
  } else if (data.action === "buildClosed") {
    openBuilds.delete(data.actorId);
    renderWidget();
    openViewers.get(data.actorId)?.markClosed?.();
  } else if (data.action === "buildStateUpdate") {
    const entry = openBuilds.get(data.actorId) ?? { actorName: data.actorName, userId: data.userId };
    entry.state = data.state;
    entry.updatedAt = Date.now();
    openBuilds.set(data.actorId, entry);
    renderWidget();
    openViewers.get(data.actorId)?.refreshFromState?.(data.state);
  }
}

function ensureWidget() {
  if (widgetEl && document.body.contains(widgetEl)) return;
  widgetEl = document.createElement("div");
  widgetEl.id = "free-magic-gm-watch";
  document.body.appendChild(widgetEl);
  renderWidget();
}

function renderWidget() {
  if (!widgetEl) return;

  if (openBuilds.size === 0) {
    widgetEl.hidden = true;
    widgetEl.innerHTML = "";
    return;
  }

  widgetEl.hidden = false;
  widgetEl.innerHTML = `
    <div class="fm-watch-header"><i class="fa-solid fa-circle-nodes"></i> Сборка заклинаний</div>
    <div class="fm-watch-list">
      ${[...openBuilds.entries()]
        .map(
          ([actorId, entry]) => `
            <button type="button" class="fm-watch-row" data-actor-id="${actorId}">
              <span class="fm-watch-name">${entry.actorName}</span>
              <i class="fa-solid fa-chevron-right"></i>
            </button>
          `
        )
        .join("")}
    </div>
  `;

  widgetEl.querySelectorAll(".fm-watch-row").forEach((btn) => {
    btn.addEventListener("click", () => openViewer(btn.dataset.actorId));
  });
}

function openViewer(actorId) {
  const existing = openViewers.get(actorId);
  if (existing?.rendered) {
    existing.bringToFront();
    return;
  }

  const entry = openBuilds.get(actorId);
  const viewer = new FreeMagicGmViewer({
    actorId,
    actorName: entry?.actorName ?? "Неизвестный персонаж",
    initialState: entry?.state ?? null
  });
  openViewers.set(actorId, viewer);
  viewer.render(true);
}
