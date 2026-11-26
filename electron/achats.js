"use strict";

const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");

// Journal des achats de matieres premieres (factures fournisseurs), demande
// explicite de l'utilisateur : une simple photo prise au telephone (voir
// mobile/, page statique separee, aucun rapport avec l'app Electron) est
// deposee dans un sous-dossier du Drive partage ("achats-photos"), puis
// analysee ICI, sur le poste de bureau (OCR via tesseract.js, voir
// analyserPhotoAchat dans main.js) pour deviner le montant total avant
// confirmation manuelle par l'utilisateur.
//
// Volontairement MINIMAL (amount + photo + date uniquement, choix explicite
// de l'utilisateur) : pas de fournisseur, pas de designation d'articles, pas
// de rattachement a une entreprise (TEXBANNER/MASTERFLAG) ni au stock — un
// simple historique financier des depenses en matieres premieres, commun
// aux deux entreprises. Meme principe de stockage a plat que
// bonsLivraison.js/invoices.js (voir ces fichiers), avec tombstones pour la
// synchronisation entre postes (voir electron/lib/syncOrchestrator.js).

let filePath = null;
let achats = null; // [{ id, date, montant, photoFileId, photoNom, createdAt, updatedAt, deletedAt }]

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
  fs.writeFileSync(tmp, JSON.stringify(achats, null, 2), "utf-8");
  fs.renameSync(tmp, filePath);
}

function initAchats(userDataDir) {
  fs.mkdirSync(userDataDir, { recursive: true });
  filePath = path.join(userDataDir, "achats.json");
  achats = load();
  persist();
}

function listAchats() {
  return achats
    .filter((a) => !a.deletedAt)
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
}

// Version non filtree (tombstones inclus), reservee a la synchronisation
// entre postes (voir electron/lib/syncOrchestrator.js).
function listAllForSync() {
  return achats;
}

// Pour eviter de reproposer au traitement une photo deja transformee en
// achat (voir achats:listPhotosEnAttente dans main.js) : l'ensemble des
// photoFileId deja utilises, tombstones compris (un achat supprime ne doit
// pas faire reapparaitre sa photo comme "nouvelle").
function photoFileIdsDejaTraites() {
  return new Set(achats.filter((a) => a.photoFileId).map((a) => a.photoFileId));
}

function addAchat({ date, montant, photoFileId, photoNom } = {}) {
  const maintenant = new Date().toISOString();
  const a = {
    id: crypto.randomUUID(),
    date: date || maintenant.slice(0, 10),
    montant: Number(montant) || 0,
    photoFileId: photoFileId || "",
    photoNom: photoNom || "",
    createdAt: maintenant,
    updatedAt: maintenant,
  };
  achats.push(a);
  persist();
  return a;
}

// Suppression "douce" (tombstone), meme principe que bonsLivraison.js.
function deleteAchat(id) {
  const idx = achats.findIndex((a) => a.id === id);
  if (idx === -1) return;
  const maintenant = new Date().toISOString();
  achats[idx] = { ...achats[idx], deletedAt: maintenant, updatedAt: maintenant };
  persist();
}

// Remplace tout l'historique par une liste deja fusionnee avec le distant
// (voir syncOrchestrator.js).
function remplacerTousLesAchats(nouveaux) {
  achats = nouveaux;
  persist();
}

module.exports = {
  initAchats,
  listAchats,
  listAllForSync,
  photoFileIdsDejaTraites,
  addAchat,
  deleteAchat,
  remplacerTousLesAchats,
};
