"use strict";

const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");

// Stockage simple en JSON (pas de module natif a compiler). Une entreprise =
// un profil complet ; l'application travaille toujours "dans" l'entreprise
// active, que l'on change depuis le selecteur en haut de la barre laterale.

const COMPANY_DEFAULTS = {
  company_name: "",
  address: "",
  rne: "",
  tax_id: "",
  phone: "",
  email: "",
  rib: "",
  logo_data_url: "",
};

let filePath = null;
let legacyFilePath = null; // ancien fichier "settings.json" (une seule entreprise)
let store = null; // { companies: [...], active_company_id: string }

function newCompany(fields = {}) {
  return { id: crypto.randomUUID(), ...COMPANY_DEFAULTS, ...fields };
}

function load() {
  let raw = null;
  try {
    raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    raw = null;
  }

  // Reprise du tout premier format (un seul profil, fichier "settings.json")
  // si companies.json n'existe pas encore : on ne perd pas ce qui a deja ete
  // saisi avant l'ajout du multi-entreprises.
  if (!raw && legacyFilePath) {
    try {
      const legacy = JSON.parse(fs.readFileSync(legacyFilePath, "utf-8"));
      if (legacy && legacy.company_name !== undefined) raw = legacy;
    } catch {
      // pas de fichier legacy, rien a reprendre
    }
  }

  if (!raw) {
    const company = newCompany();
    return { companies: [company], active_company_id: company.id };
  }

  // Migration : les tout premiers profils (une seule entreprise) etaient
  // stockes a plat, sans tableau "companies". On les convertit une fois.
  if (!Array.isArray(raw.companies)) {
    const migrated = newCompany(raw);
    return { companies: [migrated], active_company_id: migrated.id };
  }

  if (raw.companies.length === 0) {
    const company = newCompany();
    return { companies: [company], active_company_id: company.id };
  }

  const activeExists = raw.companies.some((c) => c.id === raw.active_company_id);
  return {
    companies: raw.companies,
    active_company_id: activeExists ? raw.active_company_id : raw.companies[0].id,
  };
}

function persist() {
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), "utf-8");
  fs.renameSync(tmp, filePath);
}

function initDb(userDataDir) {
  fs.mkdirSync(userDataDir, { recursive: true });
  filePath = path.join(userDataDir, "companies.json");
  legacyFilePath = path.join(userDataDir, "settings.json");
  store = load();
  persist();
}

function listCompanies() {
  return store.companies.map(({ id, company_name, logo_data_url }) => ({ id, company_name, logo_data_url }));
}

function getActiveCompany() {
  return store.companies.find((c) => c.id === store.active_company_id) || store.companies[0];
}

function setActiveCompany(id) {
  if (store.companies.some((c) => c.id === id)) {
    store.active_company_id = id;
    persist();
  }
  return getActiveCompany();
}

function saveActiveCompany(fields) {
  const idx = store.companies.findIndex((c) => c.id === store.active_company_id);
  if (idx === -1) return getActiveCompany();
  store.companies[idx] = { ...store.companies[idx], ...fields, id: store.companies[idx].id };
  persist();
  return store.companies[idx];
}

function addCompany(fields = {}) {
  const company = newCompany(fields);
  store.companies.push(company);
  store.active_company_id = company.id;
  persist();
  return company;
}

module.exports = {
  initDb,
  listCompanies,
  getActiveCompany,
  setActiveCompany,
  saveActiveCompany,
  addCompany,
};
