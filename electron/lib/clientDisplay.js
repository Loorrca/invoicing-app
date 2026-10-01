"use strict";

// Les factures generees avant l'ajout du catalogue clients stockent
// `invoice.client` comme une simple chaine (le nom). Depuis le catalogue,
// `invoice.client` est un instantane { id, nom, code, adresse }. Ces
// fonctions lisent l'un ou l'autre sans que le code appelant ait a s'en
// soucier.

function nomClient(client) {
  if (!client) return "";
  if (typeof client === "string") return client;
  return client.nom || "";
}

function codeClient(client) {
  if (!client || typeof client === "string") return "";
  return client.code || "";
}

function adresseClient(client) {
  if (!client || typeof client === "string") return "";
  return client.adresse || "";
}

module.exports = { nomClient, codeClient, adresseClient };
