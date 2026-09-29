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

export default function InvoicesList({ onEdit }) {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return invoices;
    return invoices.filter(
      (f) => (f.numero || "").toLowerCase().includes(q) || (f.client || "").toLowerCase().includes(q)
    );
  }, [invoices, query]);

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

      <input
        type="text"
        className="invoices-search"
        placeholder="Rechercher par client ou numero..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {status && (
        <p className={`status ${status.kind === "ok" ? "ok" : status.kind === "error" ? "error" : ""}`}>
          {status.text}
        </p>
      )}

      {filtered.length === 0 ? (
        <p className="subtitle">
          {query ? "Aucune facture ne correspond a cette recherche." : "Aucune facture pour le moment."}
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
