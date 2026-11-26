"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  listCompanies: () => ipcRenderer.invoke("companies:list"),
  getActiveCompany: () => ipcRenderer.invoke("companies:getActive"),
  setActiveCompany: (id) => ipcRenderer.invoke("companies:setActive", id),
  saveActiveCompany: (fields) => ipcRenderer.invoke("companies:saveActive", fields),
  addCompany: (fields) => ipcRenderer.invoke("companies:add", fields),
  getLockStatus: () => ipcRenderer.invoke("lock:status"),
  unlockApp: (password) => ipcRenderer.invoke("lock:unlock", password),
  setLockPassword: (password) => ipcRenderer.invoke("lock:setPassword", password),
  listArticles: () => ipcRenderer.invoke("articles:list"),
  addArticle: (fields) => ipcRenderer.invoke("articles:add", fields),
  updateArticle: (id, fields) => ipcRenderer.invoke("articles:update", { id, fields }),
  deleteArticle: (id) => ipcRenderer.invoke("articles:delete", id),
  listClients: () => ipcRenderer.invoke("clients:list"),
  addClient: (fields) => ipcRenderer.invoke("clients:add", fields),
  updateClient: (id, fields) => ipcRenderer.invoke("clients:update", { id, fields }),
  deleteClient: (id) => ipcRenderer.invoke("clients:delete", id),
  listInvoices: () => ipcRenderer.invoke("invoices:list"),
  getInvoiceRecord: (id) => ipcRenderer.invoke("invoices:get", id),
  getNextNumero: () => ipcRenderer.invoke("invoices:nextNumero"),
  // Variante instantanee (donnees locales uniquement, pas de synchronisation
  // Drive avant de repondre) : voir le commentaire sur invoices:nextNumeroLocal
  // dans main.js pour pourquoi les deux existent.
  getNextNumeroLocal: () => ipcRenderer.invoke("invoices:nextNumeroLocal"),
  deleteInvoiceRecord: (id) => ipcRenderer.invoke("invoices:delete", id),
  generateInvoicePdf: (invoice) => ipcRenderer.invoke("invoice:generatePdf", invoice),
  updateAndSaveInvoice: (id, invoice) => ipcRenderer.invoke("invoice:updateAndSave", { id, invoice }),
  openInvoicePdf: (id) => ipcRenderer.invoke("invoice:openPdf", id),
  renderInvoiceHtml: (invoice) => ipcRenderer.invoke("invoice:renderHtml", invoice),
  printInvoice: (id) => ipcRenderer.invoke("invoice:print", id),
  listBonsLivraison: () => ipcRenderer.invoke("bonsLivraison:list"),
  getBonLivraisonRecord: (id) => ipcRenderer.invoke("bonsLivraison:get", id),
  getNextNumeroBonLivraison: () => ipcRenderer.invoke("bonsLivraison:nextNumero"),
  getNextNumeroBonLivraisonLocal: () => ipcRenderer.invoke("bonsLivraison:nextNumeroLocal"),
  deleteBonLivraisonRecord: (id) => ipcRenderer.invoke("bonsLivraison:delete", id),
  marquerBonsLivraisonFactures: (ids, factureId, factureNumero) =>
    ipcRenderer.invoke("bonsLivraison:marquerFactures", { ids, factureId, factureNumero }),
  generateBonLivraisonPdf: (bonLivraison) => ipcRenderer.invoke("bonLivraison:generatePdf", bonLivraison),
  updateAndSaveBonLivraison: (id, bonLivraison) =>
    ipcRenderer.invoke("bonLivraison:updateAndSave", { id, bonLivraison }),
  openBonLivraisonPdf: (id) => ipcRenderer.invoke("bonLivraison:openPdf", id),
  printBonLivraison: (id) => ipcRenderer.invoke("bonLivraison:print", id),
  listStock: () => ipcRenderer.invoke("stock:list"),
  getCatalogueArticlesStock: () => ipcRenderer.invoke("stock:catalogueArticles"),
  suivreArticleStock: (fields) => ipcRenderer.invoke("stock:suivreArticle", fields),
  lierCodeStock: (articleId, code) => ipcRenderer.invoke("stock:lierCode", { articleId, code }),
  delierCodeStock: (articleId, code) => ipcRenderer.invoke("stock:delierCode", { articleId, code }),
  retirerSuiviStock: (articleId) => ipcRenderer.invoke("stock:retirerSuivi", articleId),
  ajusterQuantiteStock: (articleId, nouvelleQuantite) =>
    ipcRenderer.invoke("stock:ajusterManuellement", { articleId, nouvelleQuantite }),
  scanPayments: () => ipcRenderer.invoke("payments:scan"),
  verifyPayment: (invoiceId, operationKey, confirmer) =>
    ipcRenderer.invoke("payments:verify", { invoiceId, operationKey, confirmer }),
  manualMatchPayment: (invoiceId, operationKey, lier) =>
    ipcRenderer.invoke("payments:manualMatch", { invoiceId, operationKey, lier }),
  getPaymentsFolderPath: () => ipcRenderer.invoke("payments:getFolderPath"),
  openPaymentsFolder: () => ipcRenderer.invoke("payments:openFolder"),
  importPaymentsActivity: () => ipcRenderer.invoke("payments:importActivity"),
  listAchats: () => ipcRenderer.invoke("achats:list"),
  listPhotosAchatsEnAttente: () => ipcRenderer.invoke("achats:listPhotosEnAttente"),
  analyserPhotoAchat: (fileId, nom) => ipcRenderer.invoke("achats:analyserPhoto", { fileId, nom }),
  ouvrirPhotoAchat: (fileId, nom) => ipcRenderer.invoke("achats:ouvrirPhoto", { fileId, nom }),
  enregistrerAchat: (fields) => ipcRenderer.invoke("achats:enregistrer", fields),
  supprimerAchat: (id) => ipcRenderer.invoke("achats:supprimer", id),
  renommerPhotoAchat: (fileId, nouveauNom) => ipcRenderer.invoke("achats:renommerPhoto", { fileId, nouveauNom }),
  supprimerPhotoAchat: (fileId) => ipcRenderer.invoke("achats:supprimerPhoto", fileId),
  exportBackup: () => ipcRenderer.invoke("backup:export"),
  importBackup: () => ipcRenderer.invoke("backup:import"),
  getLastBackupInfo: () => ipcRenderer.invoke("backup:getLastInfo"),
});
