"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  listCompanies: () => ipcRenderer.invoke("companies:list"),
  getActiveCompany: () => ipcRenderer.invoke("companies:getActive"),
  setActiveCompany: (id) => ipcRenderer.invoke("companies:setActive", id),
  saveActiveCompany: (fields) => ipcRenderer.invoke("companies:saveActive", fields),
  addCompany: (fields) => ipcRenderer.invoke("companies:add", fields),
  exportLogoTemplate: (logoDataUrl) => ipcRenderer.invoke("company:exportLogoTemplate", logoDataUrl),
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
  deleteInvoiceRecord: (id) => ipcRenderer.invoke("invoices:delete", id),
  generateInvoicePdf: (invoice) => ipcRenderer.invoke("invoice:generatePdf", invoice),
  updateAndSaveInvoice: (id, invoice) => ipcRenderer.invoke("invoice:updateAndSave", { id, invoice }),
  openInvoicePdf: (id) => ipcRenderer.invoke("invoice:openPdf", id),
  renderInvoiceHtml: (invoice) => ipcRenderer.invoke("invoice:renderHtml", invoice),
  printInvoice: (id) => ipcRenderer.invoke("invoice:print", id),
  scanPayments: () => ipcRenderer.invoke("payments:scan"),
  verifyPayment: (invoiceId, operationKey, confirmer) =>
    ipcRenderer.invoke("payments:verify", { invoiceId, operationKey, confirmer }),
  manualMatchPayment: (invoiceId, operationKey, lier) =>
    ipcRenderer.invoke("payments:manualMatch", { invoiceId, operationKey, lier }),
  getPaymentsFolderPath: () => ipcRenderer.invoke("payments:getFolderPath"),
  openPaymentsFolder: () => ipcRenderer.invoke("payments:openFolder"),
  importPaymentsActivity: () => ipcRenderer.invoke("payments:importActivity"),
  exportBackup: () => ipcRenderer.invoke("backup:export"),
  importBackup: () => ipcRenderer.invoke("backup:import"),
  getLastBackupInfo: () => ipcRenderer.invoke("backup:getLastInfo"),
});
