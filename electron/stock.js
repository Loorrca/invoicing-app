"use strict";

const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");

// Suivi de stock, COMMUN aux deux entreprises (TEXBANNER/MASTERFLAG) : la
// meme reference physique peut tres bien etre vendue par les deux, et
// l'utilisateur veut un seul et meme niveau de stock qui baisse quel que
// soit le bon de livraison ou la facture qui l'a consomme, des deux cotes.
// Volontairement PAS indexe par companyId (contrairement a articles.js).
//
// Un meme article physique porte souvent un code DIFFERENT dans chacun des
// deux catalogues (TEXBANNER/MASTERFLAG) : un article suivi ici garde donc
// une LISTE de codes equivalents (`codes`), pas un seul - n'importe lequel
// de ces codes, vu sur une ligne de facture ou de bon de livraison des DEUX
// entreprises, deduit le meme stock partage.
//
// Deux fichiers, deux philosophies de stockage differentes :
//
// - stockArticles.json : la LISTE des groupes d'articles suivis (on ne suit
//   pas forcement tous les articles du catalogue, seulement ceux que
//   l'utilisateur a explicitement ajoutes ici) - un petit fichier mutable,
//   meme principe de suppression douce (deletedAt) que le reste de l'appli.
//
// - stockMouvements.json : un JOURNAL de mouvements, jamais modifie en place
//   (append-only) - chaque deduction, reaccreditation ou ajustement manuel y
//   ajoute une ligne avec sa propre quantite signee, jamais ecrasee ensuite,
//   toujours associee au code TEL QU'IL APPARAISSAIT sur la ligne d'origine
//   (pas a l'id du groupe). La quantite actuelle d'un article suivi est la
//   SOMME des mouvements de TOUS ses codes equivalents - resolue a la
//   demande (voir quantiteActuelle ci-dessous), jamais figee sur le
//   mouvement lui-meme : associer un second code a un article deja suivi
//   fait donc immediatement remonter son historique dans le meme total,
//   sans avoir besoin de reecrire un seul mouvement passe.
//   Delibere : contrairement a un simple champ "quantite" mis a jour en
//   place, un journal append-only se fusionne (voir syncOrchestrator.js,
//   fusionnerParId) sans AUCUN risque de "dernier ecrit gagne" qui ferait
//   disparaitre une deduction faite en parallele sur l'autre poste pendant
//   une coupure reseau : chaque mouvement a son propre id, jamais partage,
//   jamais en conflit avec un autre.

let filePathArticles = null;
let articlesSuivis = null; // [{ id, codes: [string], designation, createdAt, updatedAt, deletedAt }]

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
  articlesSuivis = loadJson(filePathArticles).map(migrerArticle);
  mouvements = loadJson(filePathMouvements);
  persistArticles();
  persistMouvements();
}

// Migration silencieuse d'un article suivi au tout premier format (un seul
// champ `code`, avant l'ajout des codes equivalents) vers le format actuel
// (`codes`, liste) - rejoue a chaque chargement, ne touche jamais le fichier
// tant que rien d'autre ne force une ecriture.
function migrerArticle(a) {
  if (Array.isArray(a.codes)) return a;
  const { code, ...reste } = a;
  return { ...reste, codes: code ? [code] : [] };
}

function listArticlesSuivis() {
  return articlesSuivis
    .filter((a) => !a.deletedAt)
    .sort((a, b) => (a.codes?.[0] || "").localeCompare(b.codes?.[0] || "", "fr", { numeric: true }));
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
  return articlesSuivis.some((a) => !a.deletedAt && a.codes.includes(code));
}

// L'article suivi (groupe de codes equivalents) qui contient ce code, ou
// null si ce code n'est rattache a aucun suivi.
function trouverArticleParCode(code) {
  return articlesSuivis.find((a) => !a.deletedAt && a.codes.includes(code)) || null;
}

// Tous les codes deja rattaches a un suivi existant (tous groupes confondus)
// - sert a la fois a exclure du selecteur "Ajouter"/"Lier" un code deja pris,
// et a empecher qu'un meme code se retrouve rattache a deux groupes a la
// fois (ce qui rendrait la deduction ambigue).
function codesDejaSuivis() {
  const set = new Set();
  for (const a of articlesSuivis) {
    if (a.deletedAt) continue;
    for (const c of a.codes) set.add(c);
  }
  return set;
}

// Quantite actuelle d'un article suivi (identifie par son id) : somme des
// mouvements de TOUS ses codes equivalents (deductions negatives,
// reaccreditations/ajustements positifs ou negatifs). Peut tres bien etre
// negative (vente/livraison au-dela du stock reellement disponible) - choix
// assume de l'utilisateur, l'appli ne bloque jamais sur un stock
// insuffisant, elle se contente de laisser le compteur aller dans le rouge
// pour signaler la situation.
function quantiteActuelle(articleId) {
  const article = articlesSuivis.find((a) => a.id === articleId);
  if (!article) return 0;
  return mouvements
    .filter((m) => article.codes.includes(m.code))
    .reduce((somme, m) => somme + (Number(m.quantite) || 0), 0);
}

// Id d'article suivi -> quantite actuelle, pour tous les articles suivis
// (pratique pour un seul passage sur listArticlesSuivis() plutot qu'un appel
// a quantiteActuelle() par ligne).
function toutesLesQuantites() {
  const map = new Map();
  for (const article of listArticlesSuivis()) {
    map.set(article.id, quantiteActuelle(article.id));
  }
  return map;
}

// Demarre le suivi d'un nouvel article, avec un ou plusieurs codes
// equivalents choisis d'emblee (ex. le code cote TEXBANNER ET celui cote
// MASTERFLAG pour la meme reference physique) - les codes deja rattaches a
// un autre suivi sont silencieusement ecartes (jamais rattaches a deux
// groupes a la fois). Renvoie null si aucun code valide/disponible n'a
// finalement ete fourni.
function suivreArticle({ codes, designation } = {}) {
  const dejaSuivis = codesDejaSuivis();
  const liste = [...new Set((codes || []).map((c) => String(c || "").trim()).filter(Boolean))].filter(
    (c) => !dejaSuivis.has(c)
  );
  if (liste.length === 0) return null;
  const maintenant = new Date().toISOString();
  const a = {
    id: crypto.randomUUID(),
    codes: liste,
    designation: designation || "",
    createdAt: maintenant,
    updatedAt: maintenant,
  };
  articlesSuivis.push(a);
  persistArticles();
  return a;
}

// Rattache un code equivalent supplementaire a un article deja suivi (ex. on
// decouvre apres coup que l'autre entreprise utilise un code different pour
// la meme reference). Ignore silencieusement un code deja suivi ailleurs (ou
// deja present dans ce meme groupe). L'historique des mouvements deja
// enregistres sous ce code (s'il en existe, cote de cette autre entreprise)
// rejoint immediatement le total de l'article - voir quantiteActuelle.
function lierCode(articleId, code) {
  const c = String(code || "").trim();
  if (!c) return null;
  const article = articlesSuivis.find((a) => a.id === articleId && !a.deletedAt);
  if (!article) return null;
  if (codesDejaSuivis().has(c)) return article;
  article.codes.push(c);
  article.updatedAt = new Date().toISOString();
  persistArticles();
  return article;
}

// Retire un code equivalent d'un groupe (erreur de rattachement) - refuse de
// vider le dernier code d'un groupe : utiliser retirerSuivi() pour arreter
// completement le suivi de cet article a la place.
function delierCode(articleId, code) {
  const article = articlesSuivis.find((a) => a.id === articleId && !a.deletedAt);
  if (!article) return null;
  if (article.codes.length <= 1) return article;
  const idx = article.codes.indexOf(code);
  if (idx === -1) return article;
  article.codes.splice(idx, 1);
  article.updatedAt = new Date().toISOString();
  persistArticles();
  return article;
}

// Suppression "douce" (tombstone), par id de groupe : arrete le suivi (tous
// ses codes equivalents a la fois) sans effacer l'historique des mouvements
// deja enregistres (qui restent consultables/resynchronisables tels quels).
function retirerSuivi(articleId) {
  const a = articlesSuivis.find((a) => a.id === articleId && !a.deletedAt);
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
// Le mouvement est enregistre sous le premier code du groupe (peu importe
// lequel : quantiteActuelle le resomme de toute facon sur tous les codes
// equivalents de l'article).
function ajusterManuellement(articleId, nouvelleQuantite) {
  const article = articlesSuivis.find((a) => a.id === articleId && !a.deletedAt);
  if (!article || article.codes.length === 0) return null;
  const actuelle = quantiteActuelle(articleId);
  const cible = Number(nouvelleQuantite);
  if (Number.isNaN(cible)) return null;
  const delta = cible - actuelle;
  if (!delta) return null;
  return enregistrerMouvement({ code: article.codes[0], quantite: delta, type: "ajustement", source: "manuel" });
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
  trouverArticleParCode,
  codesDejaSuivis,
  quantiteActuelle,
  toutesLesQuantites,
  suivreArticle,
  lierCode,
  delierCode,
  retirerSuivi,
  ajusterManuellement,
  appliquerMouvementsPourLignes,
  annulerMouvementsPourSource,
  remplacerTousLesArticlesSuivis,
  remplacerTousLesMouvements,
};
