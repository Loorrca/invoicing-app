"use strict";

const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");

// Suivi de stock, COMMUN aux deux entreprises (TEXBANNER/MASTERFLAG) : la
// meme reference (code article) peut tres bien etre vendue par les deux, et
// l'utilisateur veut un seul et meme niveau de stock qui baisse quel que
// soit le bon de livraison ou la facture qui l'a consomme, des deux cotes.
// Volontairement PAS indexe par companyId (contrairement a articles.js) :
// seul le `code` fait foi, le meme systeme de dedoublonnage que celui utilise
// pour retrouver un article par code a la saisie d'une ligne.
//
// Deux fichiers, deux philosophies de stockage differentes :
//
// - stockArticles.json : la LISTE des codes suivis (on ne suit pas forcement
//   tous les articles du catalogue, seulement ceux que l'utilisateur a
//   explicitement ajoutes ici) - un petit fichier mutable, meme principe de
//   suppression douce (deletedAt) que le reste de l'appli.
//
// - stockMouvements.json : un JOURNAL de mouvements, jamais modifie en place
//   (append-only) - chaque deduction, reaccreditation ou ajustement manuel y
//   ajoute une ligne avec sa propre quantite signee, jamais ecrasee ensuite.
//   La quantite actuelle d'un code est simplement la SOMME de ses mouvements.
//   Delibere : contrairement a un simple champ "quantite" mis a jour en
//   place, un journal append-only se fusionne (voir syncOrchestrator.js,
//   fusionnerParId) sans AUCUN risque de "dernier ecrit gagne" qui ferait
//   disparaitre une deduction faite en parallele sur l'autre poste pendant
//   une coupure reseau : chaque mouvement a son propre id, jamais partage,
//   jamais en conflit avec un autre.

let filePathArticles = null;
let articlesSuivis = null; // [{ id, code, designation, createdAt, updatedAt, deletedAt }]

let filePathMouvements = null;
let mouvements = null; // [{ id, code, quantite, type, source, sourceId, sourceNumero, createdAt }]

function loadJson(filePath) {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    if (Array.isArray(raw)) return raw;
  } catch {
    // pas de fichier, ou fichier invalide : on repart d'une liste vide
  }
  return [];
}

function persistJson(filePath, data) {
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  fs.renameSync(tmp, filePath);
}

function persistArticles() {
  persistJson(filePathArticles, articlesSuivis);
}

function persistMouvements() {
  persistJson(filePathMouvements, mouvements);
}

function initStock(userDataDir) {
  fs.mkdirSync(userDataDir, { recursive: true });
  filePathArticles = path.join(userDataDir, "stockArticles.json");
  filePathMouvements = path.join(userDataDir, "stockMouvements.json");
  articlesSuivis = loadJson(filePathArticles);
  mouvements = loadJson(filePathMouvements);
  persistArticles();
  persistMouvements();
}

function listArticlesSuivis() {
  return articlesSuivis
    .filter((a) => !a.deletedAt)
    .sort((a, b) => (a.code || "").localeCompare(b.code || "", "fr", { numeric: true }));
}

// Versions non filtrees (tombstones inclus), reservees a la synchronisation
// entre postes (voir electron/lib/syncOrchestrator.js).
function listAllArticlesSuiviForSync() {
  return articlesSuivis;
}

function listAllMouvementsForSync() {
  return mouvements;
}

function estSuivi(code) {
  return articlesSuivis.some((a) => a.code === code && !a.deletedAt);
}

// Quantite actuelle d'un code : somme de tous ses mouvements (deductions
// negatives, reaccreditations/ajustements positifs ou negatifs). Peut tres
// bien etre negative (vente/livraison au-dela du stock reellement
// disponible) - choix assume de l'utilisateur, l'appli ne bloque jamais sur
// un stock insuffisant, elle se contente de laisser le compteur aller dans
// le rouge pour signaler la situation.
function quantiteActuelle(code) {
  return mouvements.filter((m) => m.code === code).reduce((somme, m) => somme + (Number(m.quantite) || 0), 0);
}

// Code -> quantite actuelle, pour tous les codes ayant au moins un mouvement
// (pratique pour un seul passage sur listArticlesSuivis() plutot qu'un appel
// a quantiteActuelle() par ligne).
function toutesLesQuantites() {
  const map = new Map();
  for (const m of mouvements) {
    map.set(m.code, (map.get(m.code) || 0) + (Number(m.quantite) || 0));
  }
  return map;
}

function suivreArticle({ code, designation } = {}) {
  const c = String(code || "").trim();
  if (!c) return null;
  const maintenant = new Date().toISOString();
  const existant = articlesSuivis.find((a) => a.code === c);
  if (existant) {
    existant.deletedAt = undefined;
    if (designation) existant.designation = designation;
    existant.updatedAt = maintenant;
    persistArticles();
    return existant;
  }
  const a = {
    id: crypto.randomUUID(),
    code: c,
    designation: designation || "",
    createdAt: maintenant,
    updatedAt: maintenant,
  };
  articlesSuivis.push(a);
  persistArticles();
  return a;
}

// Suppression "douce" (tombstone) : arrete le suivi sans effacer l'historique
// des mouvements deja enregistres pour ce code (qui restent consultables/
// resynchronisables tels quels).
function retirerSuivi(code) {
  const a = articlesSuivis.find((a) => a.code === code && !a.deletedAt);
  if (!a) return;
  const maintenant = new Date().toISOString();
  a.deletedAt = maintenant;
  a.updatedAt = maintenant;
  persistArticles();
}

function enregistrerMouvement({ code, quantite, type, source, sourceId, sourceNumero }) {
  const m = {
    id: crypto.randomUUID(),
    code,
    quantite,
    type,
    source,
    sourceId,
    sourceNumero,
    createdAt: new Date().toISOString(),
  };
  mouvements.push(m);
  persistMouvements();
  return m;
}

// Ajustement manuel depuis l'onglet Stock : l'utilisateur saisit la quantite
// qu'il veut voir affichee (ex. apres un inventaire physique), pas un delta -
// on calcule nous-memes le delta a enregistrer par rapport au solde actuel.
function ajusterManuellement(code, nouvelleQuantite) {
  const c = String(code || "").trim();
  if (!c) return null;
  const actuelle = quantiteActuelle(c);
  const cible = Number(nouvelleQuantite);
  if (Number.isNaN(cible)) return null;
  const delta = cible - actuelle;
  if (!delta) return null;
  return enregistrerMouvement({ code: c, quantite: delta, type: "ajustement", source: "manuel" });
}

// Applique un mouvement de stock pour chaque ligne (facture ou bon de
// livraison) dont le code correspond a un article actuellement suivi -
// ignore silencieusement les lignes sans code ou dont le code n'est pas
// suivi (article non stocke). `signe` : -1 pour deduire (livraison/vente),
// +1 pour reaccrediter (annulation, voir annulerMouvementsPourSource).
function appliquerMouvementsPourLignes(lignes, { source, sourceId, sourceNumero, type = "deduction", signe = -1 }) {
  for (const ligne of lignes || []) {
    const code = String(ligne?.code || "").trim();
    if (!code) continue;
    if (!estSuivi(code)) continue;
    const quantite = Number(ligne.quantite) || 0;
    if (!quantite) continue;
    enregistrerMouvement({ code, quantite: signe * quantite, type, source, sourceId, sourceNumero });
  }
}

// Annule le solde NET deja enregistre pour une source donnee (une facture ou
// un bon de livraison precis, identifie par sourceId) : utilise avant de
// reappliquer une nouvelle deduction lors d'une modification (le bon/la
// facture a change de lignes), ou seul lors d'une suppression. Se base sur le
// solde net (deduction(s) + eventuelles reversals precedentes), pas
// uniquement la toute premiere deduction, pour rester juste meme apres
// plusieurs modifications successives.
//
// Renvoie false sans rien ecrire si cette source n'a JAMAIS rien deduit
// (ex. une facture creee a partir de bons de livraison, jamais deduite
// directement - voir invoice:generatePdf dans main.js) : c'est ce qui permet
// a la suppression/modification d'une telle facture de ne jamais toucher au
// stock, sans avoir besoin de garder trace ailleurs de son origine.
function annulerMouvementsPourSource(source, sourceId) {
  if (!sourceId) return false;
  const existants = mouvements.filter((m) => m.source === source && m.sourceId === sourceId);
  if (existants.length === 0) return false;
  const parCode = new Map();
  for (const m of existants) {
    parCode.set(m.code, (parCode.get(m.code) || 0) + (Number(m.quantite) || 0));
  }
  const sourceNumero = existants[existants.length - 1]?.sourceNumero;
  for (const [code, net] of parCode) {
    if (!net) continue;
    enregistrerMouvement({ code, quantite: -net, type: "reversal", source, sourceId, sourceNumero });
  }
  return true;
}

function remplacerTousLesArticlesSuivis(nouveaux) {
  articlesSuivis = nouveaux;
  persistArticles();
}

function remplacerTousLesMouvements(nouveaux) {
  mouvements = nouveaux;
  persistMouvements();
}

module.exports = {
  initStock,
  listArticlesSuivis,
  listAllArticlesSuiviForSync,
  listAllMouvementsForSync,
  estSuivi,
  quantiteActuelle,
  toutesLesQuantites,
  suivreArticle,
  retirerSuivi,
  ajusterManuellement,
  appliquerMouvementsPourLignes,
  annulerMouvementsPourSource,
  remplacerTousLesArticlesSuivis,
  remplacerTousLesMouvements,
};
