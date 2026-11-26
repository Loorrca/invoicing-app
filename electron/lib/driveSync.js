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
//
// Depuis l'ajout des achats de matieres premieres (voir electron/achats.js),
// ce module lit aussi des FICHIERS BINAIRES (photos) dans un sous-dossier du
// dossier partage, deposees par la page mobile (voir mobile/, qui ecrit
// directement sur Drive avec le compte Google personnel de l'utilisateur,
// jamais avec ce compte de service) — voir listerFichiersDossier et
// telechargerFichierBinaire ci-dessous.

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

// Trouve l'id du SOUS-DOSSIER portant ce nom, directement sous le dossier
// partage configure (ou null s'il n'existe pas encore). Utilise pour
// "achats-photos" (voir electron/achats.js) : ce sous-dossier est cree a la
// main par l'utilisateur, une seule fois, avec son compte Google personnel
// (meme precaution que pour les fichiers JSON eux-memes — voir le
// commentaire sur le scope "drive" plus haut, un compte de service ne peut
// rien creer de lui-meme, dossier compris).
async function trouverSousDossier(nomDossier) {
  const q = encodeURIComponent(
    `name = '${nomDossier}' and '${dossierId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`
  );
  const res = await authFetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`);
  const data = await res.json();
  return data.files && data.files[0] ? data.files[0].id : null;
}

// Liste les fichiers (photos deposees depuis le telephone) d'un sous-dossier
// du dossier partage, les plus recents en premier. Renvoie une liste vide
// (jamais une erreur) si le sous-dossier n'existe pas encore — etat normal
// avant que l'utilisateur ne l'ait cree/partage avec son compte Google.
async function listerFichiersDossier(nomSousDossier) {
  const idDossier = await trouverSousDossier(nomSousDossier);
  if (!idDossier) return [];
  const q = encodeURIComponent(`'${idDossier}' in parents and trashed = false`);
  const res = await authFetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,createdTime)&orderBy=createdTime desc&pageSize=200`
  );
  const data = await res.json();
  return data.files || [];
}

// Telecharge le contenu brut (binaire) d'un fichier Drive par son id — pour
// les photos, par opposition a telechargerJson ci-dessus. Renvoie un Buffer
// Node.
async function telechargerFichierBinaire(fileId) {
  const res = await authFetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// Renomme un fichier Drive existant (ex. une photo d'achat en attente — voir
// achats:renommerPhoto dans main.js) : une simple mise a jour de metadonnee,
// autorisee pour le compte de service des qu'il a un acces Editeur sur le
// fichier (contrairement a la CREATION d'un fichier, voir le commentaire sur
// le scope "drive" plus haut, ceci ne touche a aucun quota).
async function renommerFichier(fileId, nouveauNom) {
  await authFetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: nouveauNom }),
  });
}

// Met un fichier Drive a la corbeille (jamais une suppression definitive :
// le compte de service n'est pas proprietaire du fichier - cree par le
// compte Google personnel de l'utilisateur depuis la page mobile - seule la
// mise a la corbeille lui est autorisee, pas la suppression irreversible).
async function supprimerFichier(fileId) {
  await authFetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ trashed: true }),
  });
}

module.exports = {
  initDriveSync,
  estConfigure,
  telechargerJson,
  envoyerJson,
  listerFichiersDossier,
  telechargerFichierBinaire,
  renommerFichier,
  supprimerFichier,
};
