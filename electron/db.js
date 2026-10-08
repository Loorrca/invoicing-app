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
  tel_fax: "",
  phone: "",
  email: "",
  rib: "",
  siege: "",
  logo_data_url: "",
  qr_data_url: "",
  // Gabarit de facture ("classic" ou "lignes" — voir invoiceTemplate.js) :
  // "classic" par defaut pour toute nouvelle entreprise.
  invoice_template: "classic",
};

let filePath = null;
let legacyFilePath = null; // ancien fichier "settings.json" (une seule entreprise)
let store = null; // { companies: [...], active_company_id: string }

// placeholderAuto : marque une entreprise creee automatiquement en
// secours (poste tout juste installe/reinitialise, companies.json absent
// ou vide), PAS une entreprise ajoutee volontairement par l'utilisateur
// (voir addCompany) ni une recuperee depuis l'ancien format (elle contient
// deja de vraies donnees). Ce marqueur permet a syncOrchestrator.js de la
// reconnaitre et de l'ecarter une fois que la vraie entreprise arrive par
// la synchronisation, au lieu de la garder comme un deuxieme profil
// fantome "(Sans nom)" a cote de la bonne (voir retirerPlaceholdersVides).
// Il est retire des la premiere sauvegarde reelle sur cette entreprise
// (voir saveActiveCompany) : passe ce point, ce n'est plus un brouillon
// jetable mais une saisie de l'utilisateur, a conserver meme en cas de
// doublon.
function newCompany(fields = {}, { placeholderAuto = false } = {}) {
  const maintenant = new Date().toISOString();
  const company = { id: crypto.randomUUID(), ...COMPANY_DEFAULTS, createdAt: maintenant, updatedAt: maintenant, ...fields };
  if (placeholderAuto) company.estPlaceholderAuto = true;
  return company;
}

// Migration ponctuelle (demande explicite de l'utilisateur) : MASTERFLAG
// doit avoir un gabarit de facture different de TEXBANNER, sans que ce
// dernier ne change. Les entreprises deja enregistrees n'ont pas encore le
// champ `invoice_template` (ajoute apres coup) ; on l'assigne une seule
// fois ici, par nom (insensible a la casse/espaces), sans toucher aux
// entreprises deja migrees ni a celles qui ne s'appellent pas MASTERFLAG
// (qui restent "classic" par defaut, via l'affichage cote invoiceTemplate.js).
function migrateInvoiceTemplates(companies) {
  return companies.map((c) => {
    if (c.invoice_template) return c;
    if ((c.company_name || "").trim().toUpperCase() === "MASTERFLAG") {
      return { ...c, invoice_template: "lignes" };
    }
    return c;
  });
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
    const company = newCompany({}, { placeholderAuto: true });
    return { companies: [company], active_company_id: company.id };
  }

  // Migration : les tout premiers profils (une seule entreprise) etaient
  // stockes a plat, sans tableau "companies". On les convertit une fois.
  if (!Array.isArray(raw.companies)) {
    const migrated = newCompany(raw);
    return { companies: [migrated], active_company_id: migrated.id };
  }

  if (raw.companies.length === 0) {
    const company = newCompany({}, { placeholderAuto: true });
    return { companies: [company], active_company_id: company.id };
  }

  const activeExists = raw.companies.some((c) => c.id === raw.active_company_id);
  return {
    companies: migrateInvoiceTemplates(raw.companies),
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

function getCompanyById(id) {
  return store.companies.find((c) => c.id === id) || null;
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
  // Une fois sauvegardee par l'utilisateur, ce n'est plus un brouillon
  // jetable (voir newCompany) meme si elle a ete creee automatiquement :
  // on retire le marqueur pour qu'elle ne soit plus jamais ecartee par
  // retirerPlaceholdersVides (syncOrchestrator.js).
  const { estPlaceholderAuto, ...sansMarqueur } = store.companies[idx];
  store.companies[idx] = {
    ...sansMarqueur,
    ...fields,
    id: store.companies[idx].id,
    updatedAt: new Date().toISOString(),
  };
  persist();
  return store.companies[idx];
}

// Version brute (toutes les entreprises) : reservee a la synchronisation
// entre postes (voir electron/lib/syncOrchestrator.js). Pas de suppression
// douce ici contrairement aux autres collections : l'app n'offre aucune
// fonctionnalite de suppression d'entreprise, donc pas de tombstone a
// propager.
function listAllForSync() {
  return store.companies;
}

// Remplace l'ensemble des profils entreprise par une liste deja fusionnee
// avec le distant (voir syncOrchestrator.js). L'entreprise active reste
// celle deja selectionnee sur ce poste si elle existe toujours dans la liste
// fusionnee, sinon on retombe sur la premiere (meme logique que load() au
// tout premier demarrage de l'app).
function remplacerCompanies(nouvelles) {
  store.companies = nouvelles;
  const activeExists = store.companies.some((c) => c.id === store.active_company_id);
  if (!activeExists) store.active_company_id = store.companies[0] ? store.companies[0].id : null;
  persist();
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
  listAllForSync,
  getActiveCompany,
  getCompanyById,
  setActiveCompany,
  saveActiveCompany,
  addCompany,
  remplacerCompanies,
};
