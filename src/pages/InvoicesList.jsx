import React, { useEffect, useMemo, useState } from "react";

function fmt(n) {
  return Number(n || 0).toLocaleString("fr-FR", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

function formatDate(d) {
  if (!d) return "";
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return d;
  return date.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

const EMPTY_FILTERS = { du: "", au: "", montantMin: "", montantMax: "" };

export default function InvoicesList({ onEdit }) {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const [status, setStatus] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  async function refresh() {
    setLoading(true);
    const list = await window.api.listInvoices();
    setInvoices(list);
    setLoading(false);
  }

  useEffect(() => {
    refresh();
  }, []);

  function updateFilter(field, value) {
    setFilters((f) => ({ ...f, [field]: value }));
  }

  const activeFilterCount = Object.values(filters).filter((v) => v !== "").length;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const min = filters.montantMin !== "" ? Number(filters.montantMin) : null;
    const max = filters.montantMax !== "" ? Number(filters.montantMax) : null;

    return invoices.filter((f) => {
      if (q && !(f.numero || "").toLowerCase().includes(q) && !(f.client || "").toLowerCase().includes(q)) {
        return false;
      }
      if (filters.du && (f.date || "") < filters.du) return false;
      if (filters.au && (f.date || "") > filters.au) return false;
      const ttc = f.totaux?.ttc ?? null;
      if (min !== null && !Number.isNaN(min) && (ttc === null || ttc < min)) return false;
      if (max !== null && !Number.isNaN(max) && (ttc === null || ttc > max)) return false;
      return true;
    });
  }, [invoices, query, filters]);

  async function handleOpenPdf(id) {
    setStatus(null);
    try {
      const result = await window.api.openInvoicePdf(id);
      if (!result.opened) {
        setStatus({ kind: "error", text: result.error || "Impossible d'ouvrir le PDF." });
      }
    } catch (err) {
      setStatus({ kind: "error", text: String(err?.message || err) });
    }
  }

  async function handleDelete(id) {
    await window.api.deleteInvoiceRecord(id);
    setConfirmDeleteId(null);
    await refresh();
  }

  if (loading) return <div className="page">Chargement...</div>;

  return (
    <div className="page">
      <h1>Factures</h1>
      <p className="subtitle">Historique des factures generees pour l'entreprise active.</p>

      <div className="invoices-search-row">
        <input
          type="text"
          className="invoices-search"
          placeholder="Rechercher par client ou numero..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="button" className="btn secondary" onClick={() => setShowFilters((v) => !v)}>
          Filtres{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
        </button>
      </div>

      {showFilters && (
        <div className="card invoices-filters">
          <label>
            Du
            <input type="date" value={filters.du} onChange={(e) => updateFilter("du", e.target.value)} />
          </label>
          <label>
            Au
            <input type="date" value={filters.au} onChange={(e) => updateFilter("au", e.target.value)} />
          </label>
          <label>
            Montant min (TTC)
            <input
              type="number"
              step="0.001"
              min="0"
              placeholder="0.000"
              value={filters.montantMin}
              onChange={(e) => updateFilter("montantMin", e.target.value)}
            />
          </label>
          <label>
            Montant max (TTC)
            <input
              type="number"
              step="0.001"
              min="0"
              placeholder="—"
              value={filters.montantMax}
              onChange={(e) => updateFilter("montantMax", e.target.value)}
            />
          </label>
          {activeFilterCount > 0 && (
            <button type="button" className="btn link" onClick={() => setFilters(EMPTY_FILTERS)}>
              Réinitialiser les filtres
            </button>
          )}
        </div>
      )}

      {status && (
        <p className={`status ${status.kind === "ok" ? "ok" : status.kind === "error" ? "error" : ""}`}>
          {status.text}
        </p>
      )}

      {filtered.length === 0 ? (
        <p className="subtitle">
          {query || activeFilterCount > 0
            ? "Aucune facture ne correspond a cette recherche/ces filtres."
            : "Aucune facture pour le moment."}
        </p>
      ) : (
        <table className="invoices-table">
          <thead>
            <tr>
              <th>N&deg;</th>
              <th>Date</th>
              <th>Client</th>
              <th className="num">Total T.T.C</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((f) => (
              <tr key={f.id}>
                <td>{f.numero}</td>
                <td>{formatDate(f.date)}</td>
                <td>{f.client}</td>
                <td className="num">{fmt(f.totaux?.ttc)} DT</td>
                <td className="invoices-actions">
                  <button type="button" className="btn secondary" onClick={() => handleOpenPdf(f.id)}>
                    Revoir le PDF
                  </button>
                  <button type="button" className="btn secondary" onClick={() => onEdit?.(f.id)}>
                    Modifier
                  </button>
                  {confirmDeleteId === f.id ? (
                    <>
                      <button type="button" className="btn link" onClick={() => handleDelete(f.id)}>
                        Confirmer
                      </button>
                      <button type="button" className="btn secondary" onClick={() => setConfirmDeleteId(null)}>
                        Annuler
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="btn icon"
                      onClick={() => setConfirmDeleteId(f.id)}
                      aria-label="Supprimer cette facture"
                    >
                      &times;
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
