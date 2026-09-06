import { InlineKeyboard, Keyboard } from "grammy";
import { config } from "../config.js";

export const BTN = {
  generate: "🆕 Generate New Wallet",
  deposit: "💳 Deposit",
  transfer: "💸 Transfer",
  importWallet: "📥 Import a Wallet",
  exportKey: "🔑 Export Private Key",
  activate: "🚀 Activate Bot",
  portfolio: "📊 Portfolio",
  deploy: "🚀 Deploy Agent",
  claimBonus: "💰 Claim New User Bonus",
} as const;

export function mainWalletKeyboard() {
  return new Keyboard()
    .text(BTN.transfer)
    .text(BTN.deposit)
    .row()
    .text(BTN.importWallet)
    .text(BTN.exportKey)
    .row()
    .text(BTN.generate)
    .resized()
    .persistent();
}

export function startKeyboard(funded: boolean) {
  const kb = new Keyboard().text(BTN.deploy).row().text(BTN.claimBonus);
  if (funded) {
    kb.row().text(BTN.activate);
  }
  kb.row().text(BTN.portfolio).text(BTN.generate);
  return kb.resized().persistent();
}

export function linksLine(): string {
  const parts = [
    `[Website](${config.websiteUrl})`,
    `[Docs](${config.docsUrl})`,
  ];
  if (config.channelUrl) {
    parts.push(`[Channel](${config.channelUrl})`);
  }
  return parts.join(" | ");
}

export function confirmExportKeyboard() {
  return new InlineKeyboard()
    .text("Yes, show keys", "export_confirm")
    .text("Cancel", "export_cancel");
}
