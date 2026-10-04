"use strict";

const { app, BrowserWindow, ipcMain, dialog, protocol, net, shell, Menu } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");
const {
  initDb,
  listCompanies,
  getActiveCompany,
  getCompanyById,
  setActiveCompany,
  saveActiveCompany,
  addCompany,
} = require("./db");
const { initArticles, listArticles, addArticle, updateArticle, deleteArticle } = require("./articles");
const { initClients, listClients, addClient, updateClient, deleteClient } = require("./lib/clients");
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
const { initPayments, releveDirFor, scanPayments, verifyPayment, importActivityFile, manualMatch } = require("./payments");
const { initBackup, exportBackup, importBackup, getLastBackupInfo } = require("./backup");

// Optionnel : si le module n'est pas installe (npm install manquant), on se
// contente de ne pas numeroter les pages plutot que de planter l'appli.
let PDFLib = null;
try {
  PDFLib = require("pdf-lib");
} catch {
  // voir ajouterNumerosDePage ci-dessous
}

const isDev = !app.isPackaged;

// Force la locale de Chromium en francais : c'est ce qui controle le format
// (jj/mm/aaaa) et la langue du selecteur natif <input type="date"> (le seul
// attribut HTML "lang" sur l'input ne suffit pas, Chromium se base sur la
// locale de l'appli). Doit etre fait avant app.whenReady().
app.commandLine.appendSwitch("lang", "fr");

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

// Barre de menu (menu natif de la fenetre : Fichier / Edition / Affichage /
// Aide). Sans ceci, Electron affiche son menu par defaut en anglais ; on le
// remplace ici pour qu'il soit dans la langue de l'app et pour y ajouter
// l'entree "A propos" (credit/copyright).
function buildMenu() {
  const isMac = process.platform === "darwin";

  const template = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" },
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ]
      : []),
    {
      label: "Fichier",
      submenu: [isMac ? { role: "close" } : { role: "quit", label: "Quitter" }],
    },
    {
      label: "Edition",
      submenu: [
        { role: "undo", label: "Annuler" },
        { role: "redo", label: "Retablir" },
        { type: "separator" },
        { role: "cut", label: "Couper" },
        { role: "copy", label: "Copier" },
        { role: "paste", label: "Coller" },
        { role: "selectAll", label: "Tout selectionner" },
      ],
    },
    {
      label: "Affichage",
      submenu: [
        { role: "reload", label: "Recharger" },
        { role: "forceReload", label: "Recharger (forcer)" },
        { role: "toggleDevTools", label: "Outils de developpement" },
        { type: "separator" },
        { role: "resetZoom", label: "Zoom normal" },
        { role: "zoomIn", label: "Zoom avant" },
        { role: "zoomOut", label: "Zoom arriere" },
        { type: "separator" },
        { role: "togglefullscreen", label: "Plein ecran" },
      ],
    },
    {
      label: "Aide",
      submenu: [
        {
          label: "A propos de Facturation",
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: "info",
              title: "A propos de Facturation",
              message: "Facturation",
              detail:
                "Application de facturation et de suivi des paiements.\n\n" +
                "© Mohamed Bouzidi 2026\nTous droits reserves.",
              buttons: ["Fermer"],
            });
          },
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
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
  initArticles(app.getPath("userData"), listCompanies().map((c) => c.id));
  initClients(app.getPath("userData"));
  initInvoices(app.getPath("userData"));
  initPayments(app.getPath("userData"), dossierFacturationBase());
  initBackup(app.getPath("userData"), dossierFacturationBase());
  buildMenu();
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

ipcMain.handle("articles:list", () => listArticles(getActiveCompany().id));

ipcMain.handle("articles:add", (_event, fields) => addArticle(getActiveCompany().id, fields));

ipcMain.handle("articles:update", (_event, { id, fields }) => updateArticle(id, fields));

ipcMain.handle("articles:delete", (_event, id) => deleteArticle(id));

// --------------------------------------------------------------------------
// IPC : catalogue de clients
// --------------------------------------------------------------------------

ipcMain.handle("clients:list", () => listClients());

ipcMain.handle("clients:add", (_event, fields) => addClient(fields));

ipcMain.handle("clients:update", (_event, { id, fields }) => updateClient(id, fields));

ipcMain.handle("clients:delete", (_event, id) => deleteClient(id));

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

// Les factures sont rangees automatiquement dans Facturation/Factures/
// <Entreprise>/, un sous-dossier par entreprise (pas de boite de dialogue
// "Enregistrer sous" a chaque fois : le nom de fichier suit le numero). Le
// dossier Facturation lui-meme vit sous le Bureau sur Windows, et sous
// Documents sur macOS/Linux (voir dossierFacturationBase ci-dessous).
function sanitizeForPath(name) {
  return (
    String(name || "")
      .trim()
      .replace(/[\\/:*?"<>|]+/g, "_")
      .slice(0, 80) || "Sans-nom"
  );
}

// Emplacement de base du dossier Facturation (PDF de factures, releves BIAT,
// sauvegardes) : Bureau sur Windows, Documents ailleurs (macOS/Linux).
function dossierFacturationBase() {
  return process.platform === "win32" ? app.getPath("desktop") : app.getPath("documents");
}

function invoicesDirFor(company) {
  const dir = path.join(dossierFacturationBase(), "Facturation", "Factures", sanitizeForPath(company.company_name));
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
        var margeBasVoulueMm = 15; // espace blanc voulu en bas de page, pas plus
        var hauteurImprimablePx = (297 - 14 - margeBasVoulueMm) * MM_EN_PX; // A4 - marge haut (14mm) - marge bas voulue
        var margeSecuritePx = 0;
        var tbody = document.querySelector("table.lignes tbody");
        if (!tbody) return { ajoutees: 0 };
        function estLigneVide(tr) {
          var desig = tr.querySelector(".designation");
          return !!desig && desig.textContent.replace(/\\u00a0/g, "").trim() === "";
        }
        // Le gabarit ajoute toujours un minimum de lignes vides (voir
        // invoiceTemplate.js), mais avec le bloc client/references, le
        // timbre, etc. ce minimum peut a lui seul deja depasser la page :
        // le bloc du bas (lettres/signature/pied de page), qui ne doit
        // jamais etre coupe, se retrouve alors rejete en bloc sur une 2e
        // page en laissant un grand vide sur la 1ere. On retire d'abord
        // les lignes vides superflues pour faire de la place.
        while (document.body.scrollHeight > hauteurImprimablePx - margeSecuritePx) {
          var lignes = tbody.querySelectorAll("tr");
          var derniereVide = null;
          for (var k = lignes.length - 1; k >= 0; k--) {
            if (estLigneVide(lignes[k])) { derniereVide = lignes[k]; break; }
          }
          if (!derniereVide) break; // plus de ligne vide a retirer : on laisse deborder sur une 2e page
          tbody.removeChild(derniereVide);
        }
        var ligneVideHtml =
          '<tr><td class="code">&nbsp;</td><td class="designation">&nbsp;</td>' +
          '<td class="num">&nbsp;</td><td class="num">&nbsp;</td><td class="num">&nbsp;</td></tr>';
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

// Ajoute "Page X/N" en bas a droite de chaque page, uniquement quand la
// facture en compte plus d'une (une facture tenant sur une page garde son
// pied de page tel quel). Chrome ne sait pas numeroter les pages a
// l'impression (pas de support des marges @page CSS), donc ca se fait apres
// coup sur le PDF deja genere, une fois qu'on connait le nombre reel de pages.
async function ajouterNumerosDePage(pdfBuffer) {
  if (!PDFLib) return pdfBuffer; // pdf-lib pas installe : on garde le PDF tel quel
  try {
    const { PDFDocument, StandardFonts, rgb } = PDFLib;
    const pdfDoc = await PDFDocument.load(pdfBuffer);
    const pages = pdfDoc.getPages();
    const total = pages.length;
    if (total <= 1) return pdfBuffer;
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const taillePolice = 8.5;
    const margeDroitePt = 34; // ~12mm, aligne avec la marge imprimable de la facture
    const margeBasPt = 22; // ~7.8mm du bas, dans la marge basse de la facture
    pages.forEach((page, index) => {
      const { width } = page.getSize();
      const texte = `Page ${index + 1}/${total}`;
      const largeurTexte = font.widthOfTextAtSize(texte, taillePolice);
      page.drawText(texte, {
        x: width - largeurTexte - margeDroitePt,
        y: margeBasPt,
        size: taillePolice,
        font,
        color: rgb(0.33, 0.33, 0.33), // meme gris que le reste du pied de page (#555)
      });
    });
    return Buffer.from(await pdfDoc.save());
  } catch (e) {
    console.error("Erreur ajout numeros de page:", e);
    return pdfBuffer; // au pire, la facture garde son PDF non numerote
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
    let pdfBuffer = await pdfWindow.webContents.printToPDF({
      printBackground: true,
      pageSize: "A4",
      margins: { marginType: "none" },
    });
    pdfBuffer = await ajouterNumerosDePage(pdfBuffer);
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

  const totaux = calculerTotaux(
    invoice.lignes || [],
    invoice.avecFodec !== false,
    !!invoice.avecTimbre,
    invoice.timbre,
    !!invoice.prixImposesTtc
  );
  const record = addInvoice({
    companyId: company.id,
    numero: invoice.numero,
    date: invoice.date,
    client: invoice.client,
    bonCommande: invoice.bonCommande,
    bonLivraison: invoice.bonLivraison,
    avecFodec: invoice.avecFodec,
    avecTimbre: invoice.avecTimbre,
    timbre: invoice.timbre,
    prixImposesTtc: invoice.prixImposesTtc,
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

  const totaux = calculerTotaux(
    invoice.lignes || [],
    invoice.avecFodec !== false,
    !!invoice.avecTimbre,
    invoice.timbre,
    !!invoice.prixImposesTtc
  );
  const record = updateInvoice(id, {
    companyId: company.id,
    numero: invoice.numero,
    date: invoice.date,
    client: invoice.client,
    bonCommande: invoice.bonCommande,
    bonLivraison: invoice.bonLivraison,
    avecFodec: invoice.avecFodec,
    avecTimbre: invoice.avecTimbre,
    timbre: invoice.timbre,
    prixImposesTtc: invoice.prixImposesTtc,
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

// Imprime une facture deja enregistree (depuis l'onglet Factures) : meme
// mise en page que le PDF, logo compris (impression couleur directe,
// l'entreprise n'utilise plus de papier a en-tete preimprime).
// On utilise l'instantane `company` garde sur la facture au moment de son
// emission (pas le profil actuel), comme pour le reste de l'affichage.
//
// Si au moins une imprimante est detectee sur la machine, on ouvre la boite
// d'impression native du systeme (l'utilisateur choisit l'imprimante/le bac
// papier et confirme). Sinon, on retombe sur une boite "Enregistrer sous"
// pour exporter le PDF a l'emplacement de son choix.
function printWindowAndWait(win, options) {
  return new Promise((resolve) => {
    win.webContents.print(options, (success, failureReason) => {
      resolve({ success, failureReason });
    });
  });
}

ipcMain.handle("invoice:print", async (_event, id) => {
  const record = getInvoice(id);
  if (!record) return { ok: false, error: "Facture introuvable." };

  // L'instantane `company` de la facture ne garde plus le logo ni le QR code
  // (voir invoices.js) : on retombe ici sur la version actuelle de
  // l'entreprise de la facture pour les deux, qui doivent tous les deux
  // rester bien visibles a l'impression.
  // Le gabarit (`invoice_template`) suit la meme logique que le logo/QR : une
  // ancienne facture (snapshot enregistre avant l'ajout de ce champ) retombe
  // sur le gabarit actuel de l'entreprise plutot que de rester figee sur
  // "classic" par defaut — c'est un choix de presentation, pas une donnee
  // metier a geler comme le nom/l'adresse/le RIB.
  //
  // Meme logique de secours pour le reste des champs d'identite de
  // l'entreprise (nom, adresse, RNE, matricule fiscal, tel/fax, mobile,
  // email, RIB, siege) :
  // une facture normalement enregistree via l'app garde son propre
  // instantane figé (voulu, pour rester fidele a ce qui etait vrai au
  // moment de l'emission). Mais une facture dont l'instantane est absent ou
  // incomplet (import de donnees sans ce champ, ou migration vers un autre
  // poste) retombe sur le profil actuel plutot que d'afficher un encart
  // entreprise vide a l'impression.
  const companyActuelle = getCompanyById(record.companyId);
  const logoActuel = companyActuelle?.logo_data_url || "";
  const qrActuel = companyActuelle?.qr_data_url || "";
  const CHAMPS_IDENTITE = ["company_name", "address", "rne", "tax_id", "tel_fax", "phone", "email", "rib", "siege"];
  const company = { ...(record.company || {}) };
  for (const champ of CHAMPS_IDENTITE) {
    if (!company[champ] && companyActuelle?.[champ]) company[champ] = companyActuelle[champ];
  }
  company.logo_data_url = record.company?.logo_data_url || logoActuel;
  company.qr_data_url = record.company?.qr_data_url || qrActuel;
  company.invoice_template = record.company?.invoice_template || companyActuelle?.invoice_template || "classic";
  const html = renderInvoiceHtml(company, record);

  const printWindow = new BrowserWindow({
    show: false,
    width: LARGEUR_ZONE_IMPRIMABLE_PX,
    height: 1200,
  });

  try {
    await printWindow.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
    await remplirEspaceRestant(printWindow);

    const printers = await printWindow.webContents.getPrintersAsync();
    if (printers.length > 0) {
      const { success, failureReason } = await printWindowAndWait(printWindow, {
        silent: false,
        printBackground: true,
        pageSize: "A4",
        margins: { marginType: "none" },
      });
      if (!success) {
        // L'utilisateur a pu simplement annuler la boite d'impression : ce
        // n'est pas une erreur a afficher en rouge.
        if (failureReason === "cancelled" || failureReason === "canceled") {
          return { ok: false, canceled: true };
        }
        return { ok: false, error: failureReason || "Echec de l'impression." };
      }
      return { ok: true, printed: true };
    }

    // Aucune imprimante detectee : on propose d'enregistrer un PDF a la place.
    const result = await dialog.showSaveDialog(mainWindow, {
      title: "Aucune imprimante detectee — enregistrer en PDF",
      defaultPath: `facture-${sanitizeForPath(record.numero || "brouillon")}.pdf`,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };

    let pdfBuffer = await printWindow.webContents.printToPDF({
      printBackground: true,
      pageSize: "A4",
      margins: { marginType: "none" },
    });
    pdfBuffer = await ajouterNumerosDePage(pdfBuffer);
    fs.writeFileSync(result.filePath, pdfBuffer);
    return { ok: true, saved: true, filePath: result.filePath };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  } finally {
    printWindow.destroy();
  }
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

// Association manuelle facture <-> transaction (voir payments.js) : permet
// de lier a la main une facture et une transaction que le rapprochement
// algorithmique n'a pas proposees (ou s'est trompe), depuis l'onglet
// Factures ou l'onglet Transactions. `lier=false` retire l'association.
ipcMain.handle("payments:manualMatch", (_event, { invoiceId, operationKey, lier }) => {
  const company = getActiveCompany();
  manualMatch(company.id, invoiceId, operationKey, lier);
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

ipcMain.handle("backup:getLastInfo", () => getLastBackupInfo());

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
