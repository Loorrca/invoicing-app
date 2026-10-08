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

// Le logo (et, depuis l'ajout du QR code, l'image du QR) de l'entreprise ne
// changent quasiment jamais, et ne sont jamais relus depuis cet instantane a
// l'affichage d'une facture deja generee : le PDF original, lui, est fige
// independamment de ce JSON (invoice:generatePdf l'ecrit une fois pour
// toutes avec les images du moment). Seule la reimpression (voir
// invoice:print dans main.js) relit l'instantane — logo et QR retombent
// alors tous les deux sur la version actuelle de l'entreprise, et restent
// bien visibles a l'impression. Les dupliquer sur chaque facture n'apportait
// donc rien et representait, a lui seul, 99 % du poids de ce fichier (13,7
// Mo sur 13,8 Mo mesures rien que pour le logo) : on les retire des
// instantanes, a l'ecriture comme au chargement (migration des factures
// deja enregistrees).
const CHAMPS_MEDIAS = ["logo_data_url", "qr_data_url"];

function sansLogo(company) {
  if (!company) return company;
  let reste = company;
  for (const champ of CHAMPS_MEDIAS) {
    if (reste[champ]) {
      const { [champ]: _ignore, ...r } = reste;
      reste = r;
    }
  }
  return reste;
}

function sansLogoFacture(invoice) {
  if (!invoice.company) return invoice;
  const allege = sansLogo(invoice.company);
  if (allege === invoice.company) return invoice;
  return { ...invoice, company: allege };
}

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    if (Array.isArray(raw)) return raw.map(sansLogoFacture);
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
    .filter((f) => f.companyId === companyId && !f.deletedAt)
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
}

// Version non filtree (tombstones de suppression inclus), reservee a la
// synchronisation entre postes (voir electron/lib/syncMerge.js) : une fusion
// doit voir les suppressions pour pouvoir les propager, jamais la liste deja
// filtree que l'app affiche.
function listAllForSync() {
  return invoices;
}

function getInvoice(id) {
  return invoices.find((f) => f.id === id) || null;
}

// Propose le prochain numero au format "AAAANNN" : l'annee en cours suivie
// du rang de la facture dans cette annee pour cette entreprise (ex. 3e
// facture de TEXBANNER en 2026 -> "2026003"). Le rang continue le compte des
// factures deja emises cette annee-la (y compris celles au format precedent,
// ex. "0081"), il ne repart jamais a 1 au moment du changement de format.
// Le champ reste modifiable a la main si besoin (cas particulier, correction).
// Une facture supprimee (tombstone) ne compte pas, comme avant l'ajout de la
// suppression "douce" (son emplacement redevient disponible).
function nextNumero(companyId) {
  const annee = String(new Date().getFullYear());
  const dejaCetteAnnee = invoices.filter(
    (f) => f.companyId === companyId && !f.deletedAt && (f.date || "").slice(0, 4) === annee
  ).length;
  const rang = String(dejaCetteAnnee + 1).padStart(3, "0");
  return `${annee}${rang}`;
}

function addInvoice(fields = {}) {
  const maintenant = new Date().toISOString();
  const invoice = {
    id: crypto.randomUUID(),
    createdAt: maintenant,
    ...fields,
    company: sansLogo(fields.company),
    updatedAt: maintenant,
  };
  invoices.push(invoice);
  persist();
  return invoice;
}

function updateInvoice(id, fields = {}) {
  const idx = invoices.findIndex((f) => f.id === id);
  if (idx === -1) return null;
  const champs = fields.company ? { ...fields, company: sansLogo(fields.company) } : fields;
  invoices[idx] = { ...invoices[idx], ...champs, id, updatedAt: new Date().toISOString() };
  persist();
  return invoices[idx];
}

// Suppression "douce" (tombstone) : garde l'enregistrement avec un champ
// deletedAt plutot que de le retirer du tableau, pour qu'une synchronisation
// avec un autre poste sache qu'il a ete supprime (et ne le fasse pas
// reapparaitre) au lieu de simplement ne plus le voir passer. Invisible pour
// le reste de l'app : listInvoices()/nextNumero() l'ignorent deja.
function deleteInvoice(id) {
  const idx = invoices.findIndex((f) => f.id === id);
  if (idx === -1) return;
  const maintenant = new Date().toISOString();
  invoices[idx] = { ...invoices[idx], deletedAt: maintenant, updatedAt: maintenant };
  persist();
}

// Remplace tout l'historique par une liste deja fusionnee avec le distant
// (voir electron/lib/syncOrchestrator.js). Contrairement a addInvoice /
// updateInvoice, ne stamp rien : les enregistrements arrivent deja avec leur
// propre updatedAt, fixe par le poste qui les a vraiment crees/modifies.
function remplacerToutesLesFactures(nouvelles) {
  invoices = nouvelles;
  persist();
}

module.exports = {
  initInvoices,
  listInvoices,
  listAllForSync,
  getInvoice,
  nextNumero,
  addInvoice,
  updateInvoice,
  deleteInvoice,
  remplacerToutesLesFactures,
};
