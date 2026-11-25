"use strict";

const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");

// Historique des bons de livraison, par entreprise. Meme principe de
// stockage que invoices.js (fichier JSON a plat, instantane du client/de
// l'entreprise au moment de l'emission) — volontairement un fichier et une
// numerotation SEPARES de invoices.json : un bon de livraison n'est pas une
// facture (pas de prix, pas de TVA/FODEC/timbre), juste une preuve de
// livraison qui peut ensuite donner lieu a une ou plusieurs factures (voir
// `factureId`/`factureNumero` ci-dessous, et NewInvoice.jsx cote React pour
// le fil "creer la facture a partir de bons de livraison").

let filePath = null;
let bonsLivraison = null; // [{ id, companyId, numero, date, client, bonCommande, lignes, company, factureId, factureNumero, createdAt, updatedAt, deletedAt }]

// Memes champs lourds (logo/QR, plusieurs dizaines de Ko en base64 chacun)
// que invoices.js : jamais dupliques dans chaque instantane, voir le
// commentaire equivalent la-bas pour le detail. `logo_bw_data_url` (variante
// noir et blanc, voir Settings.jsx) est logee a la meme enseigne.
const CHAMPS_MEDIAS = ["logo_data_url", "qr_data_url", "logo_bw_data_url"];

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

function sansLogoBonLivraison(bl) {
  if (!bl.company) return bl;
  const allege = sansLogo(bl.company);
  if (allege === bl.company) return bl;
  return { ...bl, company: allege };
}

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    if (Array.isArray(raw)) return raw.map(sansLogoBonLivraison);
  } catch {
    // pas de fichier, ou fichier invalide : on repart d'une liste vide
  }
  return [];
}

function persist() {
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(bonsLivraison, null, 2), "utf-8");
  fs.renameSync(tmp, filePath);
}

function initBonsLivraison(userDataDir) {
  fs.mkdirSync(userDataDir, { recursive: true });
  filePath = path.join(userDataDir, "bonsLivraison.json");
  bonsLivraison = load();
  persist();
}

function listBonsLivraison(companyId) {
  return bonsLivraison
    .filter((b) => b.companyId === companyId && !b.deletedAt)
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
}

// Version non filtree (tombstones inclus), reservee a la synchronisation
// entre postes (voir electron/lib/syncOrchestrator.js).
function listAllForSync() {
  return bonsLivraison;
}

function getBonLivraison(id) {
  return bonsLivraison.find((b) => b.id === id) || null;
}

// Numerotation volontairement differente de celle des factures (voir
// invoices.js) : pas d'annee dans le numero lui-meme, juste un nombre a 4
// chiffres (0000-9999) qui reprend a 0001 chaque mois de janvier. Le
// "cette annee-la" est determine par la date du bon (champ `date`), jamais
// par le numero affiche, puisque celui-ci ne contient plus l'annee.
// Toujours base sur le plus grand rang deja attribue cette annee-la (jamais
// un simple compte), pour qu'un bon de livraison supprime garde son numero
// reserve et ne soit jamais reattribue a un autre. Compteur totalement
// independant de celui des factures : un bon de livraison et une facture
// peuvent tres bien porter le "meme" numero sans que ca ne pose probleme, ce
// sont deux documents/sequences distincts.
function rangDepuisNumero(numero) {
  if (!numero) return null;
  const s = String(numero).trim();
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  return null;
}

function nextNumero(companyId) {
  const annee = String(new Date().getFullYear());
  let dernierRang = 0;
  for (const b of bonsLivraison) {
    if (b.companyId !== companyId) continue;
    if ((b.date || "").slice(0, 4) !== annee) continue;
    const rang = rangDepuisNumero(b.numero);
    if (rang !== null && rang > dernierRang) dernierRang = rang;
  }
  return String(dernierRang + 1).padStart(4, "0");
}

function addBonLivraison(fields = {}) {
  const maintenant = new Date().toISOString();
  const bl = {
    id: crypto.randomUUID(),
    createdAt: maintenant,
    ...fields,
    company: sansLogo(fields.company),
    updatedAt: maintenant,
  };
  bonsLivraison.push(bl);
  persist();
  return bl;
}

function updateBonLivraison(id, fields = {}) {
  const idx = bonsLivraison.findIndex((b) => b.id === id);
  if (idx === -1) return null;
  const champs = fields.company ? { ...fields, company: sansLogo(fields.company) } : fields;
  bonsLivraison[idx] = { ...bonsLivraison[idx], ...champs, id, updatedAt: new Date().toISOString() };
  persist();
  return bonsLivraison[idx];
}

// Suppression "douce" (tombstone), meme principe que invoices.js.
function deleteBonLivraison(id) {
  const idx = bonsLivraison.findIndex((b) => b.id === id);
  if (idx === -1) return;
  const maintenant = new Date().toISOString();
  bonsLivraison[idx] = { ...bonsLivraison[idx], deletedAt: maintenant, updatedAt: maintenant };
  persist();
}

// Marque un ou plusieurs bons de livraison comme factures (voir
// NewInvoice.jsx : "creer la facture" a partir de bons de livraison
// selectionnes). Volontairement separe de updateBonLivraison : une action
// groupee, sur plusieurs ids a la fois, qui ne stamp que ces deux champs.
function marquerFactures(ids, factureId, factureNumero) {
  const maintenant = new Date().toISOString();
  const idsSet = new Set(ids || []);
  let count = 0;
  bonsLivraison = bonsLivraison.map((b) => {
    if (!idsSet.has(b.id)) return b;
    count += 1;
    return { ...b, factureId, factureNumero, updatedAt: maintenant };
  });
  if (count > 0) persist();
  return count;
}

// Retire le rattachement a une facture (factureId/factureNumero remis a
// vide) pour tous les bons de livraison qui y etaient relies — appele
// quand cette facture est supprimee (voir invoices:delete dans main.js),
// pour que ces bons de livraison redeviennent selectionnables depuis
// l'onglet Bons de livraison et puissent servir a creer une nouvelle
// facture. Un bon de livraison n'est jamais rattache qu'a UNE SEULE
// facture a la fois (champ `factureId` simple, pas une liste), mais une
// facture peut tres bien avoir ete creee a partir de PLUSIEURS bons de
// livraison (voir marquerFactures ci-dessus, appele avec plusieurs ids a
// la fois) — on les delie donc tous ici, pas seulement le premier trouve.
function delierFacture(factureId) {
  if (!factureId) return 0;
  const maintenant = new Date().toISOString();
  let count = 0;
  bonsLivraison = bonsLivraison.map((b) => {
    if (b.factureId !== factureId) return b;
    count += 1;
    return { ...b, factureId: undefined, factureNumero: undefined, updatedAt: maintenant };
  });
  if (count > 0) persist();
  return count;
}

// Remplace tout l'historique par une liste deja fusionnee avec le distant
// (voir syncOrchestrator.js). Meme remarque que remplacerToutesLesFactures
// dans invoices.js : aucun horodatage touche ici.
function remplacerTousLesBonsLivraison(nouveaux) {
  bonsLivraison = nouveaux;
  persist();
}

module.exports = {
  initBonsLivraison,
  listBonsLivraison,
  listAllForSync,
  getBonLivraison,
  nextNumero,
  addBonLivraison,
  updateBonLivraison,
  deleteBonLivraison,
  marquerFactures,
  delierFacture,
  remplacerTousLesBonsLivraison,
};
