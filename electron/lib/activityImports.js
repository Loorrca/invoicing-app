"use strict";

const fs = require("node:fs");
const path = require("node:path");

/**
 * Stocke, par entreprise, les operations d'activite BIATNET deja importees
 * (fichier "Détails Transactions" CSV), indexees par leur cle de
 * deduplication (voir biatActivity.js).
 *
 * Le fichier telecharge depuis BIATNET couvre toujours "depuis le debut"
 * jusqu'a un an en arriere : chaque nouvel import va donc en grande partie
 * recouvrir le precedent. On fusionne les operations lues dans ce stock
 * plutot que de les remplacer, pour que reimporter un export plus recent (ou
 * simplement retelecharger le meme) n'ajoute jamais une operation deux fois
 * et ne perde jamais une confirmation manuelle deja faite dessus.
 */

let filePath = null;
let store = null; // { [companyId]: { operations: { [cle]: {...} }, dernierImport: {...} | null } }

function charger() {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    if (raw && typeof raw === "object") return raw;
  } catch {
    // pas de fichier, ou fichier invalide : on repart d'un objet vide
  }
  return {};
}

function persister() {
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), "utf-8");
  fs.renameSync(tmp, filePath);
}

function initActivityImports(userDataDir) {
  filePath = path.join(userDataDir, "activity-imports.json");
  store = charger();
}

function aDesOperationsImportees(companyId) {
  const entree = store[companyId];
  return !!entree && Object.keys(entree.operations || {}).length > 0;
}

function operationsImportees(companyId) {
  const entree = store[companyId];
  return entree ? Object.values(entree.operations || {}) : [];
}

function dernierImport(companyId) {
  return store[companyId]?.dernierImport || null;
}

/**
 * Fusionne les operations nouvellement lues dans le stock de l'entreprise.
 * Idempotent : reimporter un fichier deja connu (en tout ou en partie)
 * n'ajoute rien en double, la cle de deduplication ne dependant pas de la
 * position de la ligne dans le fichier.
 */
function fusionnerImport(companyId, nomFichier, operationsLues) {
  if (!store[companyId]) store[companyId] = { operations: {}, dernierImport: null };
  const entree = store[companyId];
  let nouvelles = 0;
  for (const op of operationsLues) {
    if (!entree.operations[op.cle]) nouvelles++;
    entree.operations[op.cle] = op;
  }
  entree.dernierImport = {
    nomFichier,
    date: new Date().toISOString(),
    total: operationsLues.length,
    nouvelles,
  };
  persister();
  return { nouvelles, dejaConnues: operationsLues.length - nouvelles, total: operationsLues.length };
}

module.exports = {
  initActivityImports,
  aDesOperationsImportees,
  operationsImportees,
  dernierImport,
  fusionnerImport,
};
