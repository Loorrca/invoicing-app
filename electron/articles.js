"use strict";

const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");

// Catalogue d'articles, desormais propre a chaque entreprise (TEXBANNER et
// MASTERFLAG n'ont pas les memes produits/codes) : chaque article porte un
// companyId, comme les factures. Stocke dans un simple fichier JSON (pas de
// base de donnees : peu d'articles, pas besoin).
//
// Avant cette evolution, le catalogue etait partage entre toutes les
// entreprises. A la migration (premier chargement apres la mise a jour),
// les articles existants (sans companyId) sont dupliques vers chaque
// entreprise connue a ce moment-la, pour ne rien perdre : chacune repart
// avec une copie independante de ce qui existait deja, puis elles divergent
// au fil des modifications.

let filePath = null;
let articles = null; // [{ id, companyId, designation, prixUnitaire, code }]

function load(companyIds) {
  let raw;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    raw = Array.isArray(parsed) ? parsed : [];
  } catch {
    // pas de fichier, ou fichier invalide : on repart d'une liste vide
    raw = [];
  }

  const orphelins = raw.filter((a) => !a.companyId);
  if (orphelins.length === 0) return raw;

  const migres = companyIds.length
    ? companyIds.flatMap((companyId) =>
        orphelins.map((a) => ({ ...a, id: crypto.randomUUID(), companyId }))
      )
    : orphelins; // aucune entreprise connue (ne devrait jamais arriver) : on les garde tels quels plutot que de les perdre

  return raw.filter((a) => a.companyId).concat(migres);
}

function persist() {
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(articles, null, 2), "utf-8");
  fs.renameSync(tmp, filePath);
}

function initArticles(userDataDir, companyIds = []) {
  fs.mkdirSync(userDataDir, { recursive: true });
  filePath = path.join(userDataDir, "articles.json");
  articles = load(companyIds);
  persist();
}

function listArticles(companyId) {
  return articles
    .filter((a) => a.companyId === companyId)
    .sort((a, b) => a.designation.localeCompare(b.designation, "fr"));
}

function addArticle(companyId, fields = {}) {
  const designation = String(fields.designation || "").trim();
  const prixUnitaire = Number(fields.prixUnitaire) || 0;
  const code = String(fields.code || "").trim();
  if (!designation) throw new Error("Designation requise");

  // Si un article du meme nom existe deja pour cette entreprise (insensible
  // a la casse), on met a jour son prix (et son code) par defaut plutot que
  // de creer un doublon. Deux entreprises differentes peuvent en revanche
  // avoir chacune un article du meme nom, independamment.
  const existing = articles.find(
    (a) => a.companyId === companyId && a.designation.toLowerCase() === designation.toLowerCase()
  );
  if (existing) {
    existing.prixUnitaire = prixUnitaire;
    existing.code = code;
    persist();
    return existing;
  }

  const article = { id: crypto.randomUUID(), companyId, designation, prixUnitaire, code };
  articles.push(article);
  persist();
  return article;
}

// Modifie un article existant (designation, prix et/ou code). Permet de
// corriger un article saisi autrefois sans code, ou de corriger son nom/prix.
// Pas besoin de companyId ici : l'id identifie deja l'article de facon
// unique, et le catalogue affiche cote renderer ne contient jamais que les
// articles de l'entreprise active.
function updateArticle(id, fields = {}) {
  const article = articles.find((a) => a.id === id);
  if (!article) throw new Error("Article introuvable");

  if (fields.designation !== undefined) {
    const designation = String(fields.designation).trim();
    if (!designation) throw new Error("Designation requise");
    article.designation = designation;
  }
  if (fields.prixUnitaire !== undefined) {
    article.prixUnitaire = Number(fields.prixUnitaire) || 0;
  }
  if (fields.code !== undefined) {
    article.code = String(fields.code || "").trim();
  }
  persist();
  return article;
}

function deleteArticle(id) {
  articles = articles.filter((a) => a.id !== id);
  persist();
}

module.exports = { initArticles, listArticles, addArticle, updateArticle, deleteArticle };
