"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  listCompanies: () => ipcRenderer.invoke("companies:list"),
  getActiveCompany: () => ipcRenderer.invoke("companies:getActive"),
  setActiveCompany: (id) => ipcRenderer.invoke("companies:setActive", id),
  saveActiveCompany: (fields) => ipcRenderer.invoke("companies:saveActive", fields),
  addCompany: (fields) => ipcRenderer.invoke("companies:add", fields),
  listArticles: () => ipcRenderer.invoke("articles:list"),
  addArticle: (fields) => ipcRenderer.invoke("articles:add", fields),
  listInvoices: () => ipcRenderer.invoke("invoices:list"),
  getInvoiceRecord: (id) => ipcRenderer.invoke("invoices:get", id),
  getNextNumero: () => ipcRenderer.invoke("invoices:nextNumero"),
  deleteInvoiceRecord: (id) => ipcRenderer.invoke("invoices:delete", id),
  generateInvoicePdf: (invoice) => ipcRenderer.invoke("invoice:generatePdf", invoice),
  updateAndSaveInvoice: (id, invoice) => ipcRenderer.invoke("invoice:updateAndSave", { id, invoice }),
  openInvoicePdf: (id) => ipcRenderer.invoke("invoice:openPdf", id),
  renderInvoiceHtml: (invoice) => ipcRenderer.invoke("invoice:renderHtml", invoice),
});
