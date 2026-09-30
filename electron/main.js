"use strict";

const { app, BrowserWindow, ipcMain, dialog, protocol, net, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");
const {
  initDb,
  listCompanies,
  getActiveCompany,
  setActiveCompany,
  saveActiveCompany,
  addCompany,
} = require("./db");
const { initArticles, listArticles, addArticle } = require("./articles");
const {
  initInvoices,
  listInvoices,
  getInvoice,
  nextNumero,
  addInvoice,
  updateInvoice,
  deleteInvoice,
} = require("./invoices");
const { renderInvoiceHtml, calculerTotaux } = require("./lib/invoiceTemplate");
const { initPayments, releveDirFor, scanPayments, verifyPayment, importActivityFile } = require("./payments");
const { initBackup, exportBackup, importBackup } = require("./backup");

const isDev = !app.isPackaged;

let mainWindow = null;

// Le build de production (Vite) charge des modules ES ("type=module"), que
// Chromium refuse d'executer depuis une URL file:// (erreur CORS). On sert
// donc le dossier dist/ via un protocole prive "app://", qui se comporte
// comme http:// et n'a pas cette restriction.
const DIST_DIR = path.join(__dirname, "..", "dist");

protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

function registerAppProtocol() {
  protocol.handle("app", (request) => {
    const url = new URL(request.url);
    let filePath = path.join(DIST_DIR, decodeURIComponent(url.pathname));
    if (url.pathname === "/" || url.pathname === "") {
      filePath = path.join(DIST_DIR, "index.html");
    }
    return net.fetch(pathToFileURL(filePath).toString());
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 900,
    minHeight: 640,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (isDev) {
    mainWindow.loadURL("http://localhost:5173");
    // Outils de developpement disponibles a la demande (Ctrl+Shift+I), plus
    // ouverts automatiquement a chaque lancement.
  } else {
    mainWindow.loadURL("app://bundle/index.html");
  }
}

app.whenReady().then(() => {
  registerAppProtocol();
  initDb(app.getPath("userData"));
  initArticles(app.getPath("userData"));
  initInvoices(app.getPath("userData"));
  initPayments(app.getPath("userData"), app.getPath("documents"));
  initBackup(app.getPath("userData"), app.getPath("documents"));
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// --------------------------------------------------------------------------
// IPC : entreprises (profil + selecteur actif)
// --------------------------------------------------------------------------

ipcMain.handle("companies:list", () => listCompanies());

ipcMain.handle("companies:getActive", () => getActiveCompany());

ipcMain.handle("companies:setActive", (_event, id) => setActiveCompany(id));

ipcMain.handle("companies:saveActive", (_event, fields) => saveActiveCompany(fields));

ipcMain.handle("companies:add", (_event, fields) => addCompany(fields));

// --------------------------------------------------------------------------
// IPC : catalogue d'articles
// --------------------------------------------------------------------------

ipcMain.handle("articles:list", () => listArticles());

ipcMain.handle("articles:add", (_event, fields) => addArticle(fields));

// --------------------------------------------------------------------------
// IPC : historique des factures
// --------------------------------------------------------------------------

ipcMain.handle("invoices:list", () => listInvoices(getActiveCompany().id));

ipcMain.handle("invoices:get", (_event, id) => getInvoice(id));

ipcMain.handle("invoices:nextNumero", () => nextNumero(getActiveCompany().id));

ipcMain.handle("invoices:delete", (_event, id) => {
  const record = getInvoice(id);
  if (record?.filePath) {
    try {
      fs.unlinkSync(record.filePath);
    } catch {
      // fichier deja absent ou deplace : on retire quand meme l'entree
    }
  }
  deleteInvoice(id);
  return true;
});

// --------------------------------------------------------------------------
// IPC : generation de facture PDF
// --------------------------------------------------------------------------

// Les factures sont rangees automatiquement dans Documents/Facturation/Factures/
// <Entreprise>/, un sous-dossier par entreprise (pas de boite de dialogue
// "Enregistrer sous" a chaque fois : le nom de fichier suit le numero).
function sanitizeForPath(name) {
  return (
    String(name || "")
      .trim()
      .replace(/[\\/:*?"<>|]+/g, "_")
      .slice(0, 80) || "Sans-nom"
  );
}

function invoicesDirFor(company) {
  const dir = path.join(app.getPath("documents"), "Facturation", "Factures", sanitizeForPath(company.company_name));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function invoiceFilePath(company, numero) {
  return path.join(invoicesDirFor(company), `facture-${sanitizeForPath(numero || "brouillon")}.pdf`);
}

// Largeur de la zone imprimable en px CSS (A4 210mm - marges gauche/droite
// 12mm+12mm = 186mm, a 96px/pouce). On donne cette largeur a la fenetre hors
// ecran pour que la mise en page mesurée avant impression corresponde a celle
// de la page finale (memes retours a la ligne dans les designations).
const LARGEUR_ZONE_IMPRIMABLE_PX = Math.round((210 - 12 - 12) * (96 / 25.4));

// Ajoute des lignes vides en bas du tableau jusqu'a occuper (presque) toute la
// hauteur imprimable de la page, quel que soit le nombre de lignes reelles de
// la facture, pour ne pas laisser un grand vide en bas d'une facture courte.
// S'arrete des qu'ajouter une ligne de plus depasserait la hauteur disponible
// (avec une marge de securite), donc ne provoque jamais de 2e page.
async function remplirEspaceRestant(win) {
  try {
    await win.webContents.executeJavaScript(`
      (function () {
        var MM_EN_PX = 96 / 25.4;
        var hauteurImprimablePx = (297 - 14 - 14) * MM_EN_PX; // A4 - marges haut/bas
        var margeSecuritePx = 12;
        var tbody = document.querySelector("table.lignes tbody");
        if (!tbody) return { ajoutees: 0 };
        var ligneVideHtml =
          '<tr><td class="num">&nbsp;</td><td class="designation">&nbsp;</td>' +
          '<td class="num">&nbsp;</td><td class="num">&nbsp;</td></tr>';
        var ajoutees = 0;
        for (var i = 0; i < 60; i++) {
          tbody.insertAdjacentHTML("beforeend", ligneVideHtml);
          if (document.body.scrollHeight > hauteurImprimablePx - margeSecuritePx) {
            tbody.removeChild(tbody.lastElementChild);
            break;
          }
          ajoutees++;
        }
        return { ajoutees: ajoutees };
      })();
    `);
  } catch {
    // Au pire, la facture garde son remplissage par defaut (voir invoiceTemplate.js)
  }
}

async function writePdfToFile(html, filePath) {
  const pdfWindow = new BrowserWindow({
    show: false,
    width: LARGEUR_ZONE_IMPRIMABLE_PX,
    height: 1200,
    webPreferences: { offscreen: true },
  });
  try {
    await pdfWindow.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
    await remplirEspaceRestant(pdfWindow);
    const pdfBuffer = await pdfWindow.webContents.printToPDF({
      printBackground: true,
      pageSize: "A4",
      margins: { marginType: "none" },
    });
    fs.writeFileSync(filePath, pdfBuffer);
  } finally {
    pdfWindow.destroy();
  }
}

ipcMain.handle("invoice:generatePdf", async (_event, invoice) => {
  const company = getActiveCompany();
  const numero = String(invoice.numero || "").trim();

  // Evite d'ecraser silencieusement le fichier d'une autre facture si le
  // numero saisi existe deja pour cette entreprise (on redirige plutot vers
  // la modification de cette facture-la, depuis l'onglet Factures).
  const duplicate = listInvoices(company.id).find((f) => (f.numero || "").trim() === numero);
  if (duplicate) {
    return {
      canceled: true,
      error: `Le numero ${numero || "(vide)"} existe deja pour cette entreprise. Modifiez cette facture depuis l'onglet Factures, ou choisissez un autre numero.`,
    };
  }

  const html = renderInvoiceHtml(company, invoice);
  const filePath = invoiceFilePath(company, invoice.numero);
  await writePdfToFile(html, filePath);

  const totaux = calculerTotaux(invoice.lignes || [], invoice.avecFodec !== false);
  const record = addInvoice({
    companyId: company.id,
    numero: invoice.numero,
    date: invoice.date,
    client: invoice.client,
    bonCommande: invoice.bonCommande,
    bonLivraison: invoice.bonLivraison,
    avecFodec: invoice.avecFodec,
    lignes: invoice.lignes,
    totaux,
    company,
    filePath,
  });

  return { canceled: false, filePath, id: record.id };
});

// Modifie une facture existante : regenere son PDF (avec le profil actuel de
// l'entreprise) et remplace l'ancien fichier par le nouveau.
ipcMain.handle("invoice:updateAndSave", async (_event, { id, invoice }) => {
  const existing = getInvoice(id);
  if (!existing) return { canceled: true, error: "Facture introuvable" };

  const company = getActiveCompany();
  const numero = String(invoice.numero || "").trim();

  const duplicate = listInvoices(company.id).find((f) => f.id !== id && (f.numero || "").trim() === numero);
  if (duplicate) {
    return { canceled: true, error: `Le numero ${numero || "(vide)"} est deja utilise par une autre facture.` };
  }

  const html = renderInvoiceHtml(company, invoice);
  const newFilePath = invoiceFilePath(company, invoice.numero);
  await writePdfToFile(html, newFilePath);

  // Le numero (donc le nom de fichier) a pu changer : on retire l'ancien
  // fichier s'il ne correspond plus au nouveau chemin.
  if (existing.filePath && existing.filePath !== newFilePath) {
    try {
      fs.unlinkSync(existing.filePath);
    } catch {
      // ancien fichier deja absent : rien a faire
    }
  }

  const totaux = calculerTotaux(invoice.lignes || [], invoice.avecFodec !== false);
  const record = updateInvoice(id, {
    companyId: company.id,
    numero: invoice.numero,
    date: invoice.date,
    client: invoice.client,
    bonCommande: invoice.bonCommande,
    bonLivraison: invoice.bonLivraison,
    avecFodec: invoice.avecFodec,
    lignes: invoice.lignes,
    totaux,
    company,
    filePath: newFilePath,
  });

  return { canceled: false, filePath: newFilePath, id: record.id };
});

// Ouvre le PDF deja enregistre d'une facture avec la visionneuse par defaut
// du systeme (au lieu de le regenerer).
ipcMain.handle("invoice:openPdf", async (_event, id) => {
  const record = getInvoice(id);
  if (!record?.filePath || !fs.existsSync(record.filePath)) {
    return { opened: false, error: "Le fichier PDF est introuvable (deplace ou supprime)." };
  }
  const result = await shell.openPath(record.filePath);
  if (result) return { opened: false, error: result };
  return { opened: true };
});

// Apercu HTML (pour l'affichage dans l'app avant export, si besoin plus tard)
ipcMain.handle("invoice:renderHtml", (_event, invoice) => {
  const company = getActiveCompany();
  return renderInvoiceHtml(company, invoice);
});

// --------------------------------------------------------------------------
// IPC : suivi des reglements (rapprochement bancaire BIAT)
// --------------------------------------------------------------------------

// Chaque entreprise a son propre dossier de relevés, cree a la demande, sur
// le meme modele que Documents/Facturation/Factures/<Entreprise>/.
ipcMain.handle("payments:scan", async () => {
  const company = getActiveCompany();
  const invoices = listInvoices(company.id);
  try {
    return { ok: true, ...(await scanPayments(company, invoices)) };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
});

ipcMain.handle("payments:verify", (_event, { invoiceId, operationKey, confirmer }) => {
  const company = getActiveCompany();
  verifyPayment(company.id, invoiceId, operationKey, confirmer);
  return true;
});

ipcMain.handle("payments:getFolderPath", () => releveDirFor(getActiveCompany()));

// Import d'un fichier d'activite BIATNET (CSV) : une fois qu'une entreprise
// a importe au moins un fichier, scanPayments() n'utilise plus que cette
// source pour elle (voir payments.js) — plus besoin de deposer de releves
// dans son dossier.
ipcMain.handle("payments:importActivity", async () => {
  const company = getActiveCompany();
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Importer un relevé d'activité BIATNET (CSV)",
    filters: [{ name: "Fichier CSV", extensions: ["csv"] }],
    properties: ["openFile"],
  });
  if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true };
  try {
    const resume = importActivityFile(company.id, result.filePaths[0]);
    return { ok: true, ...resume };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
});

ipcMain.handle("payments:openFolder", async () => {
  const dir = releveDirFor(getActiveCompany());
  const result = await shell.openPath(dir);
  if (result) return { opened: false, error: result };
  return { opened: true };
});

// --------------------------------------------------------------------------
// IPC : sauvegarde et restauration complete (toutes entreprises)
// --------------------------------------------------------------------------

ipcMain.handle("backup:export", async () => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: "Exporter une sauvegarde",
    defaultPath: `facturation-sauvegarde-${new Date().toISOString().slice(0, 10)}.zip`,
    filters: [{ name: "Archive ZIP", extensions: ["zip"] }],
  });
  if (result.canceled || !result.filePath) return { ok: false, canceled: true };
  try {
    const resume = exportBackup(result.filePath);
    return { ok: true, ...resume };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
});

// Restaurer ecrase toutes les donnees actuelles (toutes entreprises) par
// celles de l'archive : confirmation native bloquante avant de proceder, une
// copie de securite des fichiers actuels est prise avant ecrasement, puis
// l'application redemarre completement pour relire tout son etat depuis les
// fichiers restaures (listes en memoire, overrides de paiement, etc.).
ipcMain.handle("backup:import", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Restaurer une sauvegarde",
    filters: [{ name: "Archive ZIP", extensions: ["zip"] }],
    properties: ["openFile"],
  });
  if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true };

  const confirm = await dialog.showMessageBox(mainWindow, {
    type: "warning",
    buttons: ["Annuler", "Restaurer et redemarrer"],
    defaultId: 0,
    cancelId: 0,
    title: "Restaurer une sauvegarde",
    message:
      "Cette operation va remplacer toutes les donnees actuelles (entreprises, factures, catalogue, suivi des paiements) par celles de la sauvegarde.",
    detail:
      "Les donnees actuelles seront d'abord copiees de cote par securite (dossier \"avant-restauration-...\" dans les données de l'app), au cas ou ce ne serait pas le bon fichier. L'application redemarrera ensuite automatiquement.",
  });
  if (confirm.response !== 1) return { ok: false, canceled: true };

  try {
    const resume = importBackup(result.filePaths[0]);
    app.relaunch();
    app.exit(0);
    return { ok: true, ...resume };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
});
