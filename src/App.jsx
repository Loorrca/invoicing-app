import React, { useCallback, useEffect, useState } from "react";
import AppLock from "./components/AppLock.jsx";
import Settings from "./pages/Settings.jsx";
import NewInvoice from "./pages/NewInvoice.jsx";
import InvoicesList from "./pages/InvoicesList.jsx";
import NewBonLivraison from "./pages/NewBonLivraison.jsx";
import BonsLivraison from "./pages/BonsLivraison.jsx";
import Productions from "./pages/Productions.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Paiements from "./pages/Paiements.jsx";
import Sauvegarde from "./pages/Sauvegarde.jsx";
import Clients from "./pages/Clients.jsx";
import Stock from "./pages/Stock.jsx";
import Achats from "./pages/Achats.jsx";

const TABS = [
  { id: "settings", label: "Entreprise" },
  { id: "dashboard", label: "Tableau de bord" },
  { id: "invoice", label: "Nouvelle facture" },
  { id: "clients", label: "Clients" },
  { id: "invoices", label: "Factures" },
  { id: "bonLivraison", label: "Nouveau bon de livraison" },
  { id: "bonsLivraison", label: "Bons de livraison" },
  { id: "stock", label: "Stock" },
  { id: "achats", label: "Achats" },
  { id: "productions", label: "Productions" },
  { id: "paiements", label: "Paiements" },
  { id: "sauvegarde", label: "Sauvegarde" },
];

const ADD_COMPANY = "__add__";

export default function App() {
  const [tab, setTab] = useState("settings");
  const [companies, setCompanies] = useState([]);
  const [activeCompany, setActiveCompanyState] = useState(null);
  const [editingInvoiceId, setEditingInvoiceId] = useState(null);
  const [editingBonLivraisonId, setEditingBonLivraisonId] = useState(null);
  // Brouillon de facture propose depuis l'onglet Bons de livraison
  // ("Creer la facture", voir BonsLivraison.jsx) : client + lignes fusionnees
  // + ids des bons d'origine (pour les marquer factures une fois la facture
  // generee, voir NewInvoice.jsx). Consomme une seule fois par NewInvoice
  // (onDraftConsumed le remet a null), pour qu'un onglet "Nouvelle facture"
  // ouvert normalement ensuite reparte bien d'un formulaire vide.
  const [invoiceDraft, setInvoiceDraft] = useState(null);
  // null = statut pas encore connu (ecran vide le temps de demander a
  // l'IPC) ; false = verrouille, en attente de la bonne saisie (voir
  // AppLock.jsx) ; true = deverrouille (ou aucun mot de passe configure sur
  // ce poste) - le reste de l'appli ne se monte qu'a ce moment-la, pour
  // qu'aucune donnee ne soit chargee avant.
  const [unlocked, setUnlocked] = useState(null);

  useEffect(() => {
    window.api.getLockStatus().then(({ hasPassword }) => setUnlocked(!hasPassword));
  }, []);

  const refresh = useCallback(async () => {
    const [list, active] = await Promise.all([
      window.api.listCompanies(),
      window.api.getActiveCompany(),
    ]);
    setCompanies(list);
    setActiveCompanyState(active);
  }, []);

  useEffect(() => {
    if (unlocked) refresh();
  }, [unlocked, refresh]);

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

  if (unlocked === null) return null;
  if (!unlocked) return <AppLock onUnlocked={() => setUnlocked(true)} />;

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
                  if (t.id === "invoice") {
                    setEditingInvoiceId(null);
                    setInvoiceDraft(null);
                  }
                  if (t.id === "bonLivraison") setEditingBonLivraisonId(null);
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
            initialDraft={invoiceDraft}
            onDraftConsumed={() => setInvoiceDraft(null)}
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
        {tab === "bonLivraison" && (
          <NewBonLivraison
            key={`${activeCompany?.id}-${editingBonLivraisonId || "new"}`}
            editingId={editingBonLivraisonId}
            activeCompanyId={activeCompany?.id}
            onCancelEdit={() => {
              setEditingBonLivraisonId(null);
              setTab("bonsLivraison");
            }}
            onSaved={() => {
              if (editingBonLivraisonId) {
                setEditingBonLivraisonId(null);
                setTab("bonsLivraison");
              }
            }}
          />
        )}
        {tab === "bonsLivraison" && (
          <BonsLivraison
            key={activeCompany?.id}
            onEdit={(id) => {
              setEditingBonLivraisonId(id);
              setTab("bonLivraison");
            }}
            onCreerFacture={(draft) => {
              setInvoiceDraft(draft);
              setEditingInvoiceId(null);
              setTab("invoice");
            }}
          />
        )}
        {tab === "clients" && <Clients />}
        {tab === "stock" && <Stock />}
        {tab === "achats" && <Achats />}
        {tab === "productions" && <Productions key={activeCompany?.id} />}
        {tab === "paiements" && <Paiements key={activeCompany?.id} />}
        {tab === "sauvegarde" && <Sauvegarde />}
        {tab === "dashboard" && (
          <Dashboard
            key={activeCompany?.id}
            onGoToInvoices={() => setTab("invoices")}
            onGoToPaiements={() => setTab("paiements")}
            onGoToSauvegarde={() => setTab("sauvegarde")}
          />
        )}
      </main>
    </div>
  );
}
