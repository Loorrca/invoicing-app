import React, { useCallback, useEffect, useState } from "react";

function fmtMoney(n) {
  if (n === null || n === undefined) return "—";
  return `${Number(n).toLocaleString("fr-FR", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} DT`;
}

function fmtDate(d) {
  if (!d) return "";
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return d;
  return date.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function badgeClass(statut) {
  if (statut === "Payée") return "badge badge-payee";
  if (statut === "Non payée") return "badge badge-nonpayee";
  return "badge badge-probable"; // Probable / Partiel ?
}

export default function Paiements() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [confirmingId, setConfirmingId] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [showDetails, setShowDetails] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    const res = await window.api.scanPayments();
    setData(res);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleVerify(row) {
    setBusyId(row.invoiceId);
    try {
      await window.api.verifyPayment(row.invoiceId, row.operationKey, true);
      await refresh();
    } finally {
      setBusyId(null);
      setConfirmingId(null);
    }
  }

  async function handleOpenFolder() {
    await window.api.openPaymentsFolder();
  }

  if (loading && !data) return <div className="page">Chargement...</div>;
  if (!data?.ok) {
    return (
      <div className="page">
        <h1>Paiements</h1>
        <p className="status error">Impossible de lire les relevés : {data?.error || "erreur inconnue"}</p>
      </div>
    );
  }

  const { rows, recap, avertissements, controles, dossier, operationsNonAffectees, nbReleves } = data;

  return (
    <div className="page page-wide">
      <h1>Paiements</h1>
      <p className="subtitle">
        Rapprochement des factures avec les relevés BIAT deposes dans le dossier des relevés de l'entreprise active.
      </p>

      <div className="card payments-folder-card">
        <div>
          <div className="payments-folder-label">Dossier des relevés</div>
          <div className="payments-folder-path">{dossier}</div>
          <div className="payments-folder-hint">
            Deposez-y les relevés BIAT mensuels (CSV, XLSX ou PDF) telechargés depuis BIATNET, puis actualisez.
            {nbReleves > 0 ? ` ${nbReleves} fichier(s) lu(s).` : " Aucun fichier trouve pour le moment."}
          </div>
        </div>
        <div className="payments-folder-actions">
          <button type="button" className="btn secondary" onClick={handleOpenFolder}>
            Ouvrir le dossier
          </button>
          <button type="button" className="btn" onClick={refresh} disabled={loading}>
            {loading ? "Actualisation..." : "Actualiser"}
          </button>
        </div>
      </div>

      <div className="kpi-row">
        <div className="stat-tile">
          <div className="stat-label">Total encaissé</div>
          <div className="stat-value">{fmtMoney(recap.totalEncaisse)}</div>
        </div>
        <div className="stat-tile">
          <div className="stat-label">Reste à encaisser</div>
          <div className="stat-value">{fmtMoney(recap.resteAEncaisser)}</div>
        </div>
        <div className="stat-tile">
          <div className="stat-label">Factures à vérifier</div>
          <div className="stat-value">{recap.nbAVerifier}</div>
        </div>
      </div>

      {(avertissements.length > 0 || controles.length > 0) && (
        <div className="card">
          <button type="button" className="btn secondary" onClick={() => setShowDetails((v) => !v)}>
            {showDetails ? "Masquer" : "Afficher"} les details de lecture des relevés ({avertissements.length} avertissement(s))
          </button>
          {showDetails && (
            <div className="payments-details">
              {controles.map((c, i) => (
                <p key={`c${i}`} className="status ok">
                  {c}
                </p>
              ))}
              {avertissements.map((a, i) => (
                <p key={`a${i}`} className="status error">
                  {a}
                </p>
              ))}
              {operationsNonAffectees?.length > 0 && (
                <>
                  <p className="payments-subheading">
                    Encaissements non rattachés à une facture ({operationsNonAffectees.length}) :
                  </p>
                  <ul className="payments-unassigned">
                    {operationsNonAffectees.map((o, i) => (
                      <li key={i}>
                        {fmtDate(o.date)} — {fmtMoney(o.montant)} — {o.libelle}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {rows.length === 0 ? (
        <p className="subtitle">Aucune facture enregistrée pour le moment pour cette entreprise.</p>
      ) : (
        <div className="table-scroll">
        <table className="invoices-table">
          <thead>
            <tr>
              <th>N&deg;</th>
              <th>Date</th>
              <th>Client</th>
              <th className="num">Total T.T.C</th>
              <th>Statut</th>
              <th className="num">Montant reçu</th>
              <th>Retenue appliquée</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.invoiceId}>
                <td>{r.numero}</td>
                <td>{fmtDate(r.date)}</td>
                <td>{r.client}</td>
                <td className="num">{fmtMoney(r.montantTtc)}</td>
                <td>
                  <span className={badgeClass(r.statut)}>{r.statut}</span>
                  {r.groupe && <span className="payments-tag">règlement groupé</span>}
                </td>
                <td className="num">{fmtMoney(r.montantRecu)}</td>
                <td className="payments-retenue" title={r.libelleBancaire || ""}>
                  {r.confirmeManuellement ? "Confirmé manuellement" : r.retenueAppliquee || "—"}
                </td>
                <td className="invoices-actions">
                  {r.peutVerifier &&
                    (confirmingId === r.invoiceId ? (
                      <>
                        <button
                          type="button"
                          className="btn primary"
                          onClick={() => handleVerify(r)}
                          disabled={busyId === r.invoiceId}
                        >
                          {busyId === r.invoiceId ? "..." : "Confirmer"}
                        </button>
                        <button type="button" className="btn secondary" onClick={() => setConfirmingId(null)}>
                          Annuler
                        </button>
                      </>
                    ) : (
                      <button type="button" className="btn secondary" onClick={() => setConfirmingId(r.invoiceId)}>
                        Vérifier
                      </button>
                    ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </div>
  );
}
