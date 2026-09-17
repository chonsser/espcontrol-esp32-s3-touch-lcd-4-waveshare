import { resetSession, type ResetMode } from "../api/reset_session";
import { i18n, i18nDynamic } from "../i18n";

function confirmCompleteReset(warning: string): Promise<boolean> {
  return new Promise(resolve => {
    const dialog = document.createElement("dialog");
    dialog.className = "sp-reset-dialog";
    dialog.setAttribute("aria-labelledby", "sp-reset-confirm-title");
    dialog.setAttribute("aria-describedby", "sp-reset-confirm-message");
    const heading = document.createElement("h2");
    heading.id = "sp-reset-confirm-title";
    heading.textContent = i18n("Complete reset?");
    const message = document.createElement("p");
    message.id = "sp-reset-confirm-message";
    message.textContent = warning;
    const actions = document.createElement("div");
    actions.className = "sp-btn-row sp-btn-row--save";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "sp-action-btn sp-cancel-btn";
    cancel.textContent = i18n("Cancel");
    cancel.autofocus = true;
    cancel.onclick = () => dialog.close("cancel");
    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.className = "sp-action-btn sp-save-btn";
    confirm.textContent = i18n("Complete reset");
    confirm.onclick = () => dialog.close("confirm");
    dialog.addEventListener("close", () => {
      dialog.remove();
      resolve(dialog.returnValue === "confirm");
    }, { once: true });
    actions.append(cancel, confirm);
    dialog.append(heading, message, actions);
    document.body.append(dialog);
    dialog.showModal();
  });
}

export function buildResetSettings(exportBackup: () => void, makeCard: (title: string, body: HTMLElement, collapsed: boolean) => HTMLElement, infoPanel: (id: string, text: string) => HTMLElement): HTMLElement {
  const body = document.createElement("div");
  const card = makeCard(i18n("Factory Reset"), body, true);
  card.hidden = true;
  const banner = infoPanel("sp-reset-backup-info", i18n("Backup your device before resetting"));
  banner.classList.add("sp-reset-backup-info");
  const note = banner.lastElementChild as HTMLElement;
  const backup = document.createElement("button");
  backup.type = "button";
  backup.className = "sp-action-btn sp-save-btn";
  backup.textContent = i18n("Save backup");
  backup.onclick = exportBackup;
  banner.append(backup);
  body.append(banner);
  const options = document.createElement("div");
  options.className = "sp-reset-options";
  body.append(options);
  const session = resetSession();
  function addAction(mode: ResetMode, label: string, description: string): void {
    const panel = document.createElement("section");
    panel.className = "sp-panel sp-reset-option";
    const title = document.createElement("h4");
    title.id = "sp-reset-option-" + mode;
    title.textContent = label;
    panel.setAttribute("aria-labelledby", title.id);
    const text = document.createElement("p");
    text.textContent = description;
    const button = document.createElement("button");
    button.type = "button";
    button.className = mode === "factory" ? "sp-backup-btn sp-reset-danger" : "sp-backup-btn";
    button.textContent = label;
    button.onclick = async () => {
      const warning = description + (description.endsWith(".") ? " " : ". ") + i18n("Settings cannot be recovered without a backup.");
      if (mode === "factory" ? !await confirmCompleteReset(warning) : !window.confirm(warning)) return;
      const dialog = document.createElement("dialog");
      dialog.className = "sp-reset-dialog";
      dialog.setAttribute("aria-labelledby", "sp-reset-status-title");
      dialog.setAttribute("aria-describedby", "sp-reset-status-message");
      dialog.addEventListener("cancel", event => event.preventDefault());
      const heading = document.createElement("h2");
      heading.id = "sp-reset-status-title";
      heading.textContent = i18n("Requesting reset…");
      const message = document.createElement("p");
      message.id = "sp-reset-status-message";
      message.setAttribute("role", "status");
      message.textContent = i18n("Waiting for the display to accept the reset.");
      dialog.append(heading, message);
      document.body.append(dialog);
      dialog.showModal();
      try {
        await session.reset(mode);
        heading.textContent = i18n("Restarting…");
        if (mode === "factory") {
          message.textContent = i18n("Follow the display's Wifi setup instructions to reconnect. You may need to set up its Home Assistant connection again.");
        } else {
          message.textContent = i18n("Your Wifi and Home Assistant connection will be retained. This page will reload when the display is ready.");
          const started = Date.now();
          const poll = async () => {
            try { if (await session.restarted()) { window.location.reload(); return; } } catch (_) { /* Restart disconnects HTTP. */ }
            if (Date.now() - started < 120000) window.setTimeout(poll, 2000);
            else {
              heading.textContent = i18n("Waiting for the display");
              message.textContent = i18n("The display has not reconnected yet. Check its screen and reload this page when it is ready. Do not restore a backup until reset has completed.");
            }
          };
          window.setTimeout(poll, 2000);
        }
      } catch (error) {
        heading.textContent = i18n("Check the display");
        message.textContent = i18nDynamic(String((error as Error).message)) + " " + i18n("Check the display: the reset may already be restarting it. Reload this page before making further changes.");
      }
    };
    panel.append(title, text, button);
    options.append(panel);
  }
  void session.discover().then(status => {
    if (!status) return;
    card.hidden = false;
    if (status.pending) {
      note.textContent = i18n("A reset is pending. Wait for the display to restart before making changes.");
      backup.disabled = true;
      return;
    }
    if (status.modes.includes("customization")) addAction("customization", i18n("Partial reset"), i18n("Reset cards and preferences. Retains your configuration for Wifi and Home Assistant"));
    if (status.modes.includes("factory")) addAction("factory", i18n("Complete reset"), i18n("Remove all existing configuration and reset back to first time setup."));
  }).catch(() => { /* Leave unavailable actions hidden; write transport fails closed. */ });
  return card;
}
