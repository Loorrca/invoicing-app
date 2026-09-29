"use strict";

const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");

// Historique des factures generees, par entreprise. Stocke dans un simple
// fichier JSON (comme companies.json et articles.json) : chaque facture
// garde un instantane de l'entreprise au moment ou elle a ete emise, pour
// rester fidele meme si le profil de l'entreprise change ensuite.

let filePath = null;
let invoices = null; // [{ id, companyId, numero, date, client, ..., company, totaux, createdAt }]

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    if (Array.isArray(raw)) return raw;
  } catch {
    // pas de fichier, ou fichier invalide : on repart d'une liste vide
  }
  return [];
}

function persist() {
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(invoices, null, 2), "utf-8");
  fs.renameSync(tmp, filePath);
}

function initInvoices(userDataDir) {
  fs.mkdirSync(userDataDir, { recursive: true });
  filePath = path.join(userDataDir, "invoices.json");
  invoices = load();
  persist();
}

function listInvoices(companyId) {
  return invoices
    .filter((f) => f.companyId === companyId)
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
}

function getInvoice(id) {
  return invoices.find((f) => f.id === id) || null;
}

// Propose le prochain numero en incrementant la partie numerique du dernier
// numero utilise pour cette entreprise, en conservant les zeros de tete
// (ex. "0080" -> "0081"). Si aucun numero exploitable n'est trouve (premiere
// facture, ou numero sans chiffres), on laisse la saisie vide.
function nextNumero(companyId) {
  const forCompany = invoices.filter((f) => f.companyId === companyId);
  if (forCompany.length === 0) return "";
  const last = [...forCompany].sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || "")).pop();
  const match = /^(.*?)(\d+)(\D*)$/.exec(last.numero || "");
  if (!match) return "";
  const [, prefix, digits, suffix] = match;
  const next = String(Number(digits) + 1).padStart(digits.length, "0");
  return `${prefix}${next}${suffix}`;
}

function addInvoice(fields = {}) {
  const invoice = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    ...fields,
  };
  invoices.push(invoice);
  persist();
  return invoice;
}

function updateInvoice(id, fields = {}) {
  const idx = invoices.findIndex((f) => f.id === id);
  if (idx === -1) return null;
  invoices[idx] = { ...invoices[idx], ...fields, id, updatedAt: new Date().toISOString() };
  persist();
  return invoices[idx];
}

function deleteInvoice(id) {
  invoices = invoices.filter((f) => f.id !== id);
  persist();
}

module.exports = {
  initInvoices,
  listInvoices,
  getInvoice,
  nextNumero,
  addInvoice,
  updateInvoice,
  deleteInvoice,
};
