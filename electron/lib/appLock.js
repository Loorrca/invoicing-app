"use strict";

const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");

// --------------------------------------------------------------------------
// Verrouillage de l'application par mot de passe (voir Settings.jsx, section
// "Verrouillage de l'application", et Lock.jsx pour l'ecran de saisie) :
// bloque l'acces a toute donnee au demarrage si un mot de passe a ete
// configure sur CE poste.
//
// Volontairement PAS synchronise entre postes (contrairement a
// companies.json/clients.json/invoices.json/articles.json, voir
// syncOrchestrator.js) : chaque poste garde son propre mot de passe dans ce
// fichier local, a cote de drive-sync-key.json. Le mot de passe n'est jamais
// stocke en clair, seul son hash (PBKDF2 + sel aleatoire propre a ce poste)
// est ecrit sur disque.
// --------------------------------------------------------------------------

const ITERATIONS = 100000;
const KEYLEN = 64;
const DIGEST = "sha512";

function hashPassword(password, saltHex) {
  return crypto.pbkdf2Sync(password, saltHex, ITERATIONS, KEYLEN, DIGEST).toString("hex");
}

// Code de secours : connu seulement de Hamma, deverrouille l'appli quel que
// soit le mot de passe configure sur le poste - utile si le mot de passe
// choisi par l'utilisateur est oublie. Seul son HASH est ecrit ici en dur
// (jamais le code en clair) : lire le code source ne suffit pas a le
// retrouver.
const CODE_SECOURS_SEL = "f3c1a9d7e5b2406a8c91d3f6b7a0e2c4";
const CODE_SECOURS_HASH =
  "693c72752e218295de3ce4713f1285d6ca8b250cafe441e13c536f3a16c3c00939c08bbc520d5bb3b889b65a76550a297fe7438a10ec743d8a59f8eb04352a0d";

function estCodeSecours(saisie) {
  if (!saisie) return false;
  // Comparaison a temps constant : evite de fuiter, via le temps de reponse,
  // la position du premier caractere incorrect.
  const essai = Buffer.from(hashPassword(saisie, CODE_SECOURS_SEL), "hex");
  const attendu = Buffer.from(CODE_SECOURS_HASH, "hex");
  return essai.length === attendu.length && crypto.timingSafeEqual(essai, attendu);
}

let filePath = null;
let state = null; // { saltHex, hash } si un mot de passe est configure, sinon null

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    if (raw && typeof raw.saltHex === "string" && typeof raw.hash === "string") return raw;
  } catch {
    // Pas de fichier (ou illisible) : aucun mot de passe configure sur ce poste.
  }
  return null;
}

function persist() {
  if (state === null) {
    try {
      fs.unlinkSync(filePath);
    } catch {
      // Deja absent : rien a faire.
    }
    return;
  }
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state), "utf-8");
  fs.renameSync(tmp, filePath);
}

function initLock(userDataDir) {
  filePath = path.join(userDataDir, "lock.json");
  state = load();
}

function hasPassword() {
  return state !== null;
}

// Verifie une saisie : le code de secours fonctionne toujours ; sinon, si
// aucun mot de passe n'est configure sur ce poste, tout deverrouille (rien a
// proteger) ; sinon, comparaison avec le mot de passe choisi.
function verifyPassword(saisie) {
  if (estCodeSecours(saisie)) return true;
  if (state === null) return true;
  if (!saisie) return false;
  const saltHex = state.saltHex;
  const essai = Buffer.from(hashPassword(saisie, saltHex), "hex");
  const attendu = Buffer.from(state.hash, "hex");
  return essai.length === attendu.length && crypto.timingSafeEqual(essai, attendu);
}

// Definit ou change le mot de passe de ce poste. Une saisie vide retire la
// protection (plus aucun mot de passe configure).
function setPassword(nouveauMotDePasse) {
  const mdp = (nouveauMotDePasse || "").trim();
  if (!mdp) {
    state = null;
    persist();
    return { hasPassword: false };
  }
  const saltHex = crypto.randomBytes(16).toString("hex");
  state = { saltHex, hash: hashPassword(mdp, saltHex) };
  persist();
  return { hasPassword: true };
}

module.exports = { initLock, hasPassword, verifyPassword, setPassword };
