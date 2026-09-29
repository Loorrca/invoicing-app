"use strict";

const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");

// Catalogue d'articles, partage entre toutes les entreprises. Stocke dans un
// simple fichier JSON (pas de base de donnees : peu d'articles, pas besoin).

let filePath = null;
let articles = null; // [{ id, designation, prixUnitaire }]

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
  fs.writeFileSync(tmp, JSON.stringify(articles, null, 2), "utf-8");
  fs.renameSync(tmp, filePath);
}

function initArticles(userDataDir) {
  fs.mkdirSync(userDataDir, { recursive: true });
  filePath = path.join(userDataDir, "articles.json");
  articles = load();
  persist();
}

function listArticles() {
  return [...articles].sort((a, b) => a.designation.localeCompare(b.designation, "fr"));
}

function addArticle(fields = {}) {
  const designation = String(fields.designation || "").trim();
  const prixUnitaire = Number(fields.prixUnitaire) || 0;
  if (!designation) throw new Error("Designation requise");

  // Si un article du meme nom existe deja (insensible a la casse), on met a
  // jour son prix par defaut plutot que de creer un doublon.
  const existing = articles.find(
    (a) => a.designation.toLowerCase() === designation.toLowerCase()
  );
  if (existing) {
    existing.prixUnitaire = prixUnitaire;
    persist();
    return existing;
  }

  const article = { id: crypto.randomUUID(), designation, prixUnitaire };
  articles.push(article);
  persist();
  return article;
}

module.exports = { initArticles, listArticles, addArticle };
