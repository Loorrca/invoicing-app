"use strict";

const fs = require("node:fs");
const path = require("node:path");
const AdmZip = require("adm-zip");

/**
 * Sauvegarde et restauration complete des donnees de l'application, en une
 * seule archive ZIP : les fichiers JSON de l'app (entreprises, factures,
 * catalogue d'articles, suivi des paiements) ET les fichiers du dossier
 * Documents/Facturation (PDF de factures, releves BIAT deposes). Pense pour
 * le pire cas : poste perdu/casse — reinstaller l'application ailleurs, puis
 * "Restaurer une sauvegarde" avec ce fichier ZIP remet tout en etat, sans
 * rien reconfigurer a la main.
 */

let userDataDir = null;
let documentsDir = null;
let metaFilePath = null;

// Tous les fichiers JSON connus a la racine du dossier de donnees de l'app.
// Une entree qui n'existe pas encore (ex. activity-imports.json avant le
// premier import CSV) est simplement ignoree.
const APP_DATA_FILES = [
  "companies.json",
  "settings.json", // tout premier format, avant le multi-entreprises — repris s'il existe encore
  "invoices.json",
  "articles.json",
  "clients.json",
  "payments-overrides.json",
  "activity-imports.json",
];

const MANIFEST_VERSION = 1;

function initBackup(userDataDirArg, documentsDirArg) {
  userDataDir = userDataDirArg;
  documentsDir = documentsDirArg;
  metaFilePath = path.join(userDataDir, "backup-meta.json");
}

function facturationDir() {
  return path.join(documentsDir, "Facturation");
}

// Petit fichier local (jamais inclus dans l'archive elle-meme) qui retient
// juste la date du dernier export reussi sur ce poste, pour pouvoir rappeler
// a l'utilisateur de sauvegarder quand ca commence a dater (voir
// backup:getLastInfo / la carte sur le tableau de bord).
function loadMeta() {
  try {
    const raw = JSON.parse(fs.readFileSync(metaFilePath, "utf-8"));
    if (raw && typeof raw === "object") return raw;
  } catch {
    // pas de fichier, ou fichier invalide : on repart d'un objet vide
  }
  return {};
}

function persistMeta(meta) {
  const tmp = `${metaFilePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(meta, null, 2), "utf-8");
  fs.renameSync(tmp, metaFilePath);
}

function getLastBackupInfo() {
  const meta = loadMeta();
  return { lastExportAt: meta.lastExportAt || null };
}

/**
 * Cree l'archive ZIP de sauvegarde a l'emplacement demande.
 * @returns {{ path: string, nbFichiersApp: number, nbFichiersDocuments: number }}
 */
function exportBackup(destPath) {
  const zip = new AdmZip();

  let nbFichiersApp = 0;
  for (const name of APP_DATA_FILES) {
    const p = path.join(userDataDir, name);
    if (fs.existsSync(p) && fs.statSync(p).isFile()) {
      zip.addLocalFile(p, "app-data");
      nbFichiersApp++;
    }
  }

  let nbFichiersDocuments = 0;
  const facDir = facturationDir();
  if (fs.existsSync(facDir)) {
    zip.addLocalFolder(facDir, "documents/Facturation");
    nbFichiersDocuments = zip
      .getEntries()
      .filter((e) => e.entryName.startsWith("documents/Facturation/") && !e.isDirectory).length;
  }

  const manifest = {
    app: "invoicing-app",
    version: MANIFEST_VERSION,
    exportedAt: new Date().toISOString(),
  };
  zip.addFile("manifest.json", Buffer.from(JSON.stringify(manifest, null, 2), "utf-8"));

  zip.writeZip(destPath);
  persistMeta({ ...loadMeta(), lastExportAt: manifest.exportedAt });
  return { path: destPath, nbFichiersApp, nbFichiersDocuments };
}

/** Verifie qu'un fichier ZIP a bien la forme attendue avant d'ecraser quoi que ce soit. */
function inspectBackup(zipPath) {
  let zip;
  try {
    zip = new AdmZip(zipPath);
  } catch (err) {
    return { valid: false, error: `fichier ZIP illisible : ${err.message || err}` };
  }
  const entries = zip.getEntries().map((e) => e.entryName);
  const hasManifest = entries.includes("manifest.json");
  const hasAppData = entries.some((e) => e.startsWith("app-data/"));
  if (!hasManifest || !hasAppData) {
    return { valid: false, error: "ce fichier ne ressemble pas à une sauvegarde valide de l'application" };
  }
  return { valid: true, entries: entries.length };
}

/**
 * Restaure une archive ZIP de sauvegarde : copie d'abord les donnees
 * actuelles de cote par securite (au cas ou le mauvais fichier a ete
 * choisi), puis ecrase les fichiers JSON de l'app et le dossier
 * Documents/Facturation avec le contenu de l'archive.
 *
 * N'affecte pas l'etat deja charge en memoire (listes d'entreprises,
 * factures, etc. chargees au demarrage) : l'appelant doit redemarrer
 * l'application juste apres pour que tout soit relu depuis les fichiers
 * restaures.
 */
function importBackup(zipPath) {
  const check = inspectBackup(zipPath);
  if (!check.valid) throw new Error(check.error);

  const zip = new AdmZip(zipPath);

  fs.mkdirSync(userDataDir, { recursive: true });
  const safetyDir = path.join(userDataDir, `avant-restauration-${Date.now()}`);
  fs.mkdirSync(safetyDir, { recursive: true });
  for (const name of APP_DATA_FILES) {
    const p = path.join(userDataDir, name);
    if (fs.existsSync(p) && fs.statSync(p).isFile()) {
      fs.copyFileSync(p, path.join(safetyDir, name));
    }
  }

  let nbFichiersApp = 0;
  let nbFichiersDocuments = 0;

  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;

    if (entry.entryName.startsWith("app-data/")) {
      const rel = entry.entryName.slice("app-data/".length);
      if (!rel) continue;
      const dest = path.join(userDataDir, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, entry.getData());
      nbFichiersApp++;
    } else if (entry.entryName.startsWith("documents/Facturation/")) {
      const rel = entry.entryName.slice("documents/Facturation/".length);
      if (!rel) continue;
      const dest = path.join(facturationDir(), rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, entry.getData());
      nbFichiersDocuments++;
    }
  }

  return { safetyDir, nbFichiersApp, nbFichiersDocuments };
}

module.exports = { initBackup, exportBackup, importBackup, inspectBackup, getLastBackupInfo };
