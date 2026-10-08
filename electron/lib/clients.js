"use strict";

const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");

// Catalogue de clients, partage entre toutes les entreprises (comme le
// catalogue d'articles) : nom catalogue, code client, adresse. Chaque
// facture garde ensuite un instantane du client choisi au moment de sa
// creation (meme principe que pour l'entreprise), pour rester fidele si la
// fiche client change plus tard.

let filePath = null;
let clients = null; // [{ id, nom, code, adresse }]

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
  fs.writeFileSync(tmp, JSON.stringify(clients, null, 2), "utf-8");
  fs.renameSync(tmp, filePath);
}

function initClients(userDataDir) {
  fs.mkdirSync(userDataDir, { recursive: true });
  filePath = path.join(userDataDir, "clients.json");
  clients = load();
  persist();
}

function listClients() {
  return clients
    .filter((c) => !c.deletedAt)
    .sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
}

// Version non filtree (tombstones de suppression inclus), reservee a la
// synchronisation entre postes (voir electron/lib/syncMerge.js).
function listAllForSync() {
  return clients;
}

// Code client auto-genere : toujours 3 chiffres ("001", "002", ...), le
// premier numero de la plage 001-999 qui n'est pas deja utilise par un
// client existant (un client supprime libere son code, comme avant l'ajout
// de la suppression "douce"). Evite les doublons sans demander a
// l'utilisateur de s'en occuper lui-meme a la creation.
function genererCodeClient() {
  const utilises = new Set(clients.filter((c) => !c.deletedAt).map((c) => c.code));
  for (let n = 1; n <= 999; n++) {
    const code = String(n).padStart(3, "0");
    if (!utilises.has(code)) return code;
  }
  throw new Error("Plus de code client disponible (001 a 999 tous utilises)");
}

function addClient(fields = {}) {
  const nom = String(fields.nom || "").trim();
  const adresse = String(fields.adresse || "").trim();
  if (!nom) throw new Error("Nom du client requis");

  const maintenant = new Date().toISOString();
  const code = genererCodeClient();
  const client = { id: crypto.randomUUID(), nom, code, adresse, createdAt: maintenant, updatedAt: maintenant };
  clients.push(client);
  persist();
  return client;
}

function updateClient(id, fields = {}) {
  const client = clients.find((c) => c.id === id);
  if (!client) throw new Error("Client introuvable");

  if (fields.nom !== undefined) {
    const nom = String(fields.nom).trim();
    if (!nom) throw new Error("Nom du client requis");
    client.nom = nom;
  }
  if (fields.code !== undefined) {
    client.code = String(fields.code || "").trim();
  }
  if (fields.adresse !== undefined) {
    client.adresse = String(fields.adresse || "").trim();
  }
  client.updatedAt = new Date().toISOString();
  persist();
  return client;
}

// Suppression "douce" (tombstone) : voir le commentaire equivalent dans
// invoices.js. Invisible pour le reste de l'app : listClients() et
// genererCodeClient() l'ignorent deja.
function deleteClient(id) {
  const client = clients.find((c) => c.id === id);
  if (!client) return;
  const maintenant = new Date().toISOString();
  client.deletedAt = maintenant;
  client.updatedAt = maintenant;
  persist();
}

// Remplace tout le catalogue par une liste deja fusionnee avec le distant
// (voir syncOrchestrator.js). Memes remarques que remplacerToutesLesFactures
// dans invoices.js : aucun horodatage touche ici, deja present sur chaque
// enregistrement.
function remplacerTousLesClients(nouveaux) {
  clients = nouveaux;
  persist();
}

module.exports = {
  initClients,
  listClients,
  listAllForSync,
  addClient,
  updateClient,
  deleteClient,
  remplacerTousLesClients,
};
