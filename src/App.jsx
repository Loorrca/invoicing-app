import React, { useCallback, useEffect, useState } from "react";
import Settings from "./pages/Settings.jsx";
import NewInvoice from "./pages/NewInvoice.jsx";
import InvoicesList from "./pages/InvoicesList.jsx";
import Productions from "./pages/Productions.jsx";
import Dashboard from "./pages/Dashboard.jsx";

const TABS = [
  { id: "settings", label: "Entreprise" },
  { id: "dashboard", label: "Tableau de bord" },
  { id: "invoice", label: "Nouvelle facture" },
  { id: "invoices", label: "Factures" },
  { id: "productions", label: "Productions" },
];

const ADD_COMPANY = "__add__";

export default function App() {
  const [tab, setTab] = useState("settings");
  const [companies, setCompanies] = useState([]);
  const [activeCompany, setActiveCompanyState] = useState(null);
  const [editingInvoiceId, setEditingInvoiceId] = useState(null);

  const refresh = useCallback(async () => {
    const [list, active] = await Promise.all([
      window.api.listCompanies(),
      window.api.getActiveCompany(),
    ]);
    setCompanies(list);
    setActiveCompanyState(active);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleSwitch(e) {
    const value = e.target.value;
    if (value === ADD_COMPANY) {
      await window.api.addCompany({});
      await refresh();
      setTab("settings");
      return;
    }
    await window.api.setActiveCompany(value);
    await refresh();
  }

  return (
    <div className="app">
      <nav className="sidebar">
        <div className="brand">Facturation</div>

        <div className="company-switcher">
          <label>Entreprise active</label>
          <select value={activeCompany?.id || ""} onChange={handleSwitch}>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.company_name?.trim() || "(Sans nom)"}
              </option>
            ))}
            <option value={ADD_COMPANY}>+ Ajouter une entreprise</option>
          </select>
        </div>

        <ul>
          {TABS.map((t) => (
            <li key={t.id}>
              <button
                className={t.id === tab ? "nav-item active" : "nav-item"}
                onClick={() => {
                  if (t.id === "invoice") setEditingInvoiceId(null);
                  setTab(t.id);
                }}
              >
                {t.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <main className="content">
        {tab === "settings" && <Settings activeCompany={activeCompany} onSaved={refresh} />}
        {tab === "invoice" && (
          <NewInvoice
            key={`${activeCompany?.id}-${editingInvoiceId || "new"}`}
            editingId={editingInvoiceId}
            activeCompanyId={activeCompany?.id}
            onCancelEdit={() => {
              setEditingInvoiceId(null);
              setTab("invoices");
            }}
            onSaved={() => {
              if (editingInvoiceId) {
                setEditingInvoiceId(null);
                setTab("invoices");
              }
            }}
          />
        )}
        {tab === "invoices" && (
          <InvoicesList
            key={activeCompany?.id}
            onEdit={(id) => {
              setEditingInvoiceId(id);
              setTab("invoice");
            }}
          />
        )}
        {tab === "productions" && <Productions key={activeCompany?.id} />}
        {tab === "dashboard" && (
          <Dashboard key={activeCompany?.id} onGoToInvoices={() => setTab("invoices")} />
        )}
      </main>
    </div>
  );
}
