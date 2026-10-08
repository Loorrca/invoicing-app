"use strict";

const fs = require("node:fs");
const { JWT } = require("google-auth-library");

// Transport brut pour la synchronisation entre postes : un seul dossier
// Google Drive partage, un compte de service (aucun navigateur/ecran de
// consentement a passer sur chaque poste, voir la discussion avec
// l'utilisateur — chaque poste porte juste une copie du meme fichier de
// cles), et un fichier JSON par collection (clients.json, articles.json,
// invoices.json, companies.json) qui represente a chaque instant la
// DERNIERE version fusionnee connue sur Drive.
//
// Le cycle de synchronisation (orchestrateur a ecrire une fois ce transport
// verifie avec de vraies cles) est toujours : telecharger -> fusionner avec
// la copie locale (voir syncMerge.js) -> ecrire la version fusionnee
// localement ET la renvoyer sur Drive. Ce module ne s'occupe que du
// telechargement/envoi bruts, jamais de la fusion elle-meme.
//
// ATTENTION : le fichier de cles (JSON telecharge depuis Google Cloud
// Console) ne doit JAMAIS faire partie du depot git ni du build de l'app
// (voir "files" dans package.json) — le depot et les Releases GitHub sont
// publics. Chaque poste porte sa propre copie du fichier, placee a la main
// une fois (voir keyFilePath), jamais embarquee dans l'installeur.

let jwtClient = null;
let dossierId = null;

function initDriveSync({ keyFilePath, folderId }) {
  const key = JSON.parse(fs.readFileSync(keyFilePath, "utf-8"));
  // IMPORTANT : "drive.file" (le scope restreint) ne suffit PAS ici — il ne
  // donne acces qu'aux fichiers que ce compte de service a lui-meme crees ou
  // ouverts, pas aux fichiers qu'un humain lui a simplement partages via la
  // boite de dialogue "Partager" normale de Drive (constate en test : le
  // dossier etait bien partage en Editeur avec le bon compte de service, le
  // fichier bien a l'interieur, et pourtant introuvable par l'API — la
  // recherche remontait vide, et l'envoi retombait donc sur la creation, qui
  // echoue avec 403 "Service Accounts do not have storage quota" puisqu'un
  // compte de service n'a pas d'espace de stockage propre). Le scope complet
  // "drive" respecte en revanche les partages normaux, ce qui correspond a
  // notre usage (un dossier Drive partage en Editeur avec le compte de
  // service, pas de fichiers crees par l'API elle-meme au prealable).
  jwtClient = new JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: ["https://www.googleapis.com/auth/drive"],
  });
  dossierId = folderId;
}

function estConfigure() {
  return !!jwtClient && !!dossierId;
}

async function authFetch(url, options = {}) {
  if (!jwtClient) throw new Error("driveSync non initialise (initDriveSync n'a pas ete appele)");
  const { token } = await jwtClient.getAccessToken();
  const headers = { ...(options.headers || {}), Authorization: `Bearer ${token}` };
  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    const corps = await res.text().catch(() => "");
    throw new Error(`Drive API ${res.status} ${res.statusText} : ${corps.slice(0, 300)}`);
  }
  return res;
}

// Trouve l'id du fichier Drive portant ce nom dans le dossier configure (ou
// null s'il n'existe pas encore : premiere synchro depuis aucun poste).
async function trouverFichier(nomFichier) {
  const q = encodeURIComponent(`name = '${nomFichier}' and '${dossierId}' in parents and trashed = false`);
  const res = await authFetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`);
  const data = await res.json();
  return data.files && data.files[0] ? data.files[0].id : null;
}

// Telecharge et parse un fichier JSON du dossier partage. Renvoie null s'il
// n'existe pas encore sur Drive (tout premier sync depuis n'importe quel
// poste : rien a fusionner, la copie locale fait foi).
async function telechargerJson(nomFichier) {
  const id = await trouverFichier(nomFichier);
  if (!id) return null;
  const res = await authFetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`);
  const texte = await res.text();
  return JSON.parse(texte);
}

// Cree ou remplace un fichier JSON dans le dossier partage (upload simple :
// les fichiers de sync (quelques Mo au plus, factures/clients/articles en
// JSON) restent largement sous la limite de 5 Mo au-dela de laquelle Drive
// impose un upload "resumable" en plusieurs morceaux).
async function envoyerJson(nomFichier, donnees) {
  const contenu = JSON.stringify(donnees);
  const id = await trouverFichier(nomFichier);
  if (id) {
    await authFetch(`https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: contenu,
    });
    return id;
  }
  const metadata = { name: nomFichier, parents: [dossierId] };
  const boundary = "facturationSync" + Date.now();
  const corps =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: application/json\r\n\r\n` +
    `${contenu}\r\n` +
    `--${boundary}--`;
  const res = await authFetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", {
    method: "POST",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body: corps,
  });
  const data = await res.json();
  return data.id;
}

module.exports = { initDriveSync, estConfigure, telechargerJson, envoyerJson };
