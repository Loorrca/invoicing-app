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

// Nombre de jours ecoules depuis la date de la facture (calcul sur des
// dates locales a minuit des deux cotes, pour ne pas depende de l'heure
// actuelle ni du fuseau horaire).
function ageEnJours(dateStr) {
  if (!dateStr) return null;
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return null;
  const debutFacture = new Date(date).setHours(0, 0, 0, 0);
  const aujourdHui = new Date().setHours(0, 0, 0, 0);
  return Math.round((aujourdHui - debutFacture) / 86400000);
}

function ancienneteClass(jours) {
  if (jours === null || jours <= 30) return "aging-low";
  if (jours <= 60) return "aging-medium";
  if (jours <= 90) return "aging-high";
  return "aging-severe";
}

function ancienneteLabel(jours) {
  if (jours === null) return "—";
  if (jours < 0) return "à venir";
  return `${jours} jour${jours > 1 ? "s" : ""}`;
}

export default function Paiements() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [confirmingId, setConfirmingId] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [showDetails, setShowDetails] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState(null);
  const [activeTab, setActiveTab] = useState("factures");
  const [expandedId, setExpandedId] = useState(null);
  const [onlyUnassigned, setOnlyUnassigned] = useState(false);
  // Association manuelle : { type: "invoice", id } pour choisir une
  // transaction depuis une facture, ou { type: "transaction", id } pour
  // choisir une facture depuis une transaction (id = operationKey). `id` ici
  // est toujours invoiceId pour "invoice" et operationKey pour "transaction".
  const [manualPickerFor, setManualPickerFor] = useState(null);
  const [manualQuery, setManualQuery] = useState("");
  const [manualBusyKey, setManualBusyKey] = useState(null);
  // Garde-fou avant une association manuelle dont le montant s'écarte
  // beaucoup de la facture (évite un lien posé par erreur de clic) :
  // { invoiceId, operationKey, ecart } en attente de confirmation explicite.
  const [manualConfirmTarget, setManualConfirmTarget] = useState(null);

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

  // Pose ou retire une association manuelle facture <-> transaction. `lier`
  // a false retire le lien existant de la facture `invoiceId` (operationKey
  // peut alors etre null, il n'est pas utilise cote backend dans ce cas).
  async function handleManualMatch(invoiceId, operationKey, lier) {
    const busyKey = `${invoiceId}::${operationKey || ""}`;
    setManualBusyKey(busyKey);
    try {
      await window.api.manualMatchPayment(invoiceId, operationKey, lier);
      setManualPickerFor(null);
      setManualQuery("");
      setManualConfirmTarget(null);
      await refresh();
    } finally {
      setManualBusyKey(null);
    }
  }

  function openManualPicker(type, id) {
    setManualPickerFor((cur) => (cur && cur.type === type && cur.id === id ? null : { type, id }));
    setManualQuery("");
    setManualConfirmTarget(null);
  }

  // Un montant tres different de la facture est souvent un clic sur la
  // mauvaise ligne plutot qu'un reglement partiel/groupé volontaire : on
  // demande alors une confirmation explicite plutot que de poser le lien
  // tout de suite. Seuil généreux (15 % de la facture, 5 DT minimum) pour ne
  // jamais gêner les écarts de retenue à la source normaux.
  function handleChoosePick(invoiceId, operationKey, invoiceTtc, transactionMontant) {
    const ecart =
      typeof invoiceTtc === "number" && typeof transactionMontant === "number"
        ? Math.abs(invoiceTtc - transactionMontant)
        : null;
    const seuil = typeof invoiceTtc === "number" ? Math.max(5, 0.15 * invoiceTtc) : null;
    if (ecart !== null && seuil !== null && ecart > seuil) {
      setManualConfirmTarget({ invoiceId, operationKey, ecart });
      return;
    }
    handleManualMatch(invoiceId, operationKey, true);
  }

  async function handleImportActivity() {
    setImporting(true);
    setImportMsg(null);
    try {
      const res = await window.api.importPaymentsActivity();
      if (res.canceled) return;
      if (!res.ok) {
        setImportMsg({ type: "error", text: `Échec de l'import : ${res.error}` });
        return;
      }
      const details = res.avertissements?.length
        ? ` (${res.avertissements.length} ligne(s) ignorée(s), voir le fichier)`
        : "";
      setImportMsg({
        type: "ok",
        text:
          `Import terminé : ${res.nouvelles} nouvelle(s) opération(s) sur ${res.total} lue(s) dans le fichier` +
          `${res.dejaConnues ? `, ${res.dejaConnues} déjà connue(s)` : ""}.${details}`,
      });
      await refresh();
    } finally {
      setImporting(false);
    }
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

  const {
    rows,
    recap,
    avertissements,
    controles,
    dossier,
    nbReleves,
    sourceActivite,
    activityMeta,
    transactions,
    recapTransactions,
  } = data;

  const transactionsAffichees = onlyUnassigned ? transactions.filter((t) => !t.affectee) : transactions;

  const manualQueryNorm = manualQuery.trim().toLowerCase();

  // Candidats proposes dans le panneau d'association manuelle, filtres par
  // la recherche tapee. Depuis une facture : toutes les transactions (une
  // deja affectee ailleurs reste choisissable, l'association manuelle est
  // toujours prioritaire et la lui retire). Depuis une transaction : toutes
  // les factures.
  const transactionCandidates =
    manualPickerFor?.type === "invoice"
      ? transactions.filter((t) => {
          if (!manualQueryNorm) return true;
          const hay = `${t.libelle || ""} ${t.reference || ""} ${t.montant || ""}`.toLowerCase();
          return hay.includes(manualQueryNorm);
        })
      : [];
  const invoiceCandidates =
    manualPickerFor?.type === "transaction"
      ? rows.filter((r) => {
          if (!manualQueryNorm) return true;
          const hay = `${r.numero || ""} ${r.client || ""}`.toLowerCase();
          return hay.includes(manualQueryNorm);
        })
      : [];

  // Factures pas encore confirmees payees, les plus anciennes d'abord — pour
  // savoir lesquelles relancer en priorite.
  const impayees = rows
    .filter((r) => r.statut !== "Payée")
    .map((r) => ({
      ...r,
      ageJours: ageEnJours(r.date),
      resteAEncaisser: (r.montantTtc || 0) - (typeof r.montantRecu === "number" ? r.montantRecu : 0),
    }))
    .sort((a, b) => (b.ageJours ?? -Infinity) - (a.ageJours ?? -Infinity));
  const nbImpayeesUrgentes = impayees.filter((r) => (r.ageJours ?? 0) > 60).length;
  const totalImpaye = impayees.reduce((s, r) => s + r.resteAEncaisser, 0);

  return (
    <div className="page page-wide">
      <h1>Paiements</h1>
      <p className="subtitle">
        Rapprochement des factures avec les opérations bancaires BIAT de l'entreprise active
        {sourceActivite ? " (fichier d'activité importé)." : " (relevés déposés dans un dossier)."}
      </p>

      <div className="card payments-folder-card">
        <div>
          <div className="payments-folder-label">Relevé d'activité BIATNET (CSV)</div>
          <div className="payments-folder-hint">
            {sourceActivite ? (
              <>
                Rapprochement basé sur le fichier d'activité importé :{" "}
                {activityMeta?.nbOperations ?? 0} opération(s)
                {activityMeta?.dernierImport
                  ? `, dernier import le ${fmtDate(activityMeta.dernierImport)}${
                      activityMeta.nomFichier ? ` (${activityMeta.nomFichier})` : ""
                    }`
                  : ""}
                .
              </>
            ) : (
              <>
                Téléchargez depuis BIATNET l'export « Détails Transactions » au format CSV, puis importez-le
                ici. Réimporter un fichier plus récent (même en partie déjà couvert) est sans risque : une
                opération déjà connue n'est jamais comptée deux fois.
              </>
            )}
          </div>
          {importMsg && <p className={`status ${importMsg.type === "error" ? "error" : "ok"}`}>{importMsg.text}</p>}
        </div>
        <div className="payments-folder-actions">
          <button type="button" className="btn primary" onClick={handleImportActivity} disabled={importing}>
            {importing ? "Import..." : sourceActivite ? "Réimporter un fichier CSV" : "Importer un fichier CSV"}
          </button>
          <button type="button" className="btn" onClick={refresh} disabled={loading}>
            {loading ? "Actualisation..." : "Actualiser"}
          </button>
        </div>
      </div>

      {!sourceActivite && (
        <div className="card payments-folder-card">
          <div>
            <div className="payments-folder-label">Dossier des relevés (ancien mode)</div>
            <div className="payments-folder-path">{dossier}</div>
            <div className="payments-folder-hint">
              Vous pouvez aussi deposer des relevés BIAT mensuels (CSV, XLSX ou PDF) dans ce dossier — tant
              qu'aucun fichier d'activité n'a été importé ci-dessus (l'import, une fois fait, prend
              definitivement le relais pour cette entreprise).
              {nbReleves > 0 ? ` ${nbReleves} fichier(s) lu(s).` : " Aucun fichier trouve pour le moment."}
            </div>
          </div>
          <div className="payments-folder-actions">
            <button type="button" className="btn secondary" onClick={handleOpenFolder}>
              Ouvrir le dossier
            </button>
          </div>
        </div>
      )}

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
        <div className="stat-tile">
          <div className="stat-label">Transactions non affectées</div>
          <div className="stat-value">{recapTransactions.nbTransactionsNonAffectees}</div>
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
            </div>
          )}
        </div>
      )}

      <div className="subtabs">
        <button
          type="button"
          className={`subtab-btn ${activeTab === "factures" ? "active" : ""}`}
          onClick={() => setActiveTab("factures")}
        >
          Factures ({rows.length})
        </button>
        <button
          type="button"
          className={`subtab-btn ${activeTab === "transactions" ? "active" : ""}`}
          onClick={() => setActiveTab("transactions")}
        >
          Transactions ({recapTransactions.nbTransactions})
        </button>
        <button
          type="button"
          className={`subtab-btn ${activeTab === "relances" ? "active" : ""}`}
          onClick={() => setActiveTab("relances")}
        >
          Relances ({impayees.length})
        </button>
      </div>

      {activeTab === "factures" &&
        (rows.length === 0 ? (
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
                  <React.Fragment key={r.invoiceId}>
                    <tr>
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
                        {r.associationManuelle
                          ? "Association manuelle"
                          : r.confirmeManuellement
                            ? "Confirmé manuellement"
                            : r.retenueAppliquee || "—"}
                      </td>
                      <td className="invoices-actions">
                        {r.operationKey && (
                          <button
                            type="button"
                            className="btn secondary"
                            onClick={() => setExpandedId(expandedId === r.invoiceId ? null : r.invoiceId)}
                          >
                            {expandedId === r.invoiceId ? "Masquer" : "Détails"}
                          </button>
                        )}
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
                        {r.peutDissocier ? (
                          <button
                            type="button"
                            className="btn link"
                            onClick={() => handleManualMatch(r.invoiceId, null, false)}
                            disabled={manualBusyKey === `${r.invoiceId}::`}
                          >
                            Dissocier
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="btn secondary"
                            onClick={() => openManualPicker("invoice", r.invoiceId)}
                          >
                            {manualPickerFor?.type === "invoice" && manualPickerFor.id === r.invoiceId
                              ? "Fermer"
                              : "Associer..."}
                          </button>
                        )}
                      </td>
                    </tr>
                    {manualPickerFor?.type === "invoice" && manualPickerFor.id === r.invoiceId && (
                      <tr className="payments-detail-row">
                        <td colSpan={8}>
                          <div className="manual-match-panel">
                            <p className="payments-detail-label">
                              Choisir la transaction qui règle la facture N&deg; {r.numero}
                            </p>
                            <input
                              type="text"
                              className="manual-match-search"
                              placeholder="Rechercher par libellé, référence ou montant..."
                              value={manualQuery}
                              onChange={(e) => setManualQuery(e.target.value)}
                              autoFocus
                            />
                            {transactionCandidates.length === 0 ? (
                              <p className="subtitle">Aucune transaction ne correspond.</p>
                            ) : (
                              <ul className="manual-match-list">
                                {transactionCandidates.slice(0, 50).map((t) => (
                                  <li key={t.operationKey} className="manual-match-item">
                                    <div className="manual-match-item-info">
                                      <span>{fmtDate(t.date)}</span>
                                      <span className="manual-match-item-libelle" title={t.libelle || ""}>
                                        {t.libelle || "—"}
                                      </span>
                                      <span className="num">{fmtMoney(t.montant)}</span>
                                      {t.affectee && (
                                        <span className="payments-tag">
                                          déjà affectée : {t.factures.map((f) => f.numero).join(" + ")}
                                        </span>
                                      )}
                                    </div>
                                    {manualConfirmTarget?.invoiceId === r.invoiceId &&
                                    manualConfirmTarget?.operationKey === t.operationKey ? (
                                      <div className="manual-match-confirm">
                                        <span>Écart de {fmtMoney(manualConfirmTarget.ecart)} — confirmer ?</span>
                                        <button
                                          type="button"
                                          className="btn primary"
                                          onClick={() => handleManualMatch(r.invoiceId, t.operationKey, true)}
                                          disabled={manualBusyKey === `${r.invoiceId}::${t.operationKey}`}
                                        >
                                          Confirmer quand même
                                        </button>
                                        <button
                                          type="button"
                                          className="btn secondary"
                                          onClick={() => setManualConfirmTarget(null)}
                                        >
                                          Annuler
                                        </button>
                                      </div>
                                    ) : (
                                      <button
                                        type="button"
                                        className="btn secondary"
                                        onClick={() => handleChoosePick(r.invoiceId, t.operationKey, r.montantTtc, t.montant)}
                                        disabled={manualBusyKey === `${r.invoiceId}::${t.operationKey}`}
                                      >
                                        Choisir
                                      </button>
                                    )}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                    {expandedId === r.invoiceId && r.operationKey && (
                      <tr className="payments-detail-row">
                        <td colSpan={8}>
                          <div className="payments-detail-grid">
                            <div>
                              <span className="payments-detail-label">Référence bancaire</span>
                              <span>{r.referenceBancaire || "—"}</span>
                            </div>
                            <div>
                              <span className="payments-detail-label">Date d'encaissement</span>
                              <span>{fmtDate(r.dateEncaissement) || "—"}</span>
                            </div>
                            <div>
                              <span className="payments-detail-label">Méthode</span>
                              <span>{r.methode || "—"}</span>
                            </div>
                            <div>
                              <span className="payments-detail-label">Confiance</span>
                              <span>{r.confiance || "—"}</span>
                            </div>
                            <div>
                              <span className="payments-detail-label">Écart</span>
                              <span>{r.ecart !== null && r.ecart !== undefined ? fmtMoney(r.ecart) : "—"}</span>
                            </div>
                            <div className="payments-detail-wide">
                              <span className="payments-detail-label">Libellé bancaire</span>
                              <span>{r.libelleBancaire || "—"}</span>
                            </div>
                            {r.commentaire && (
                              <div className="payments-detail-wide">
                                <span className="payments-detail-label">Commentaire du rapprochement</span>
                                <span>{r.commentaire}</span>
                              </div>
                            )}
                            {r.groupe && r.facturesGroupe.length > 0 && (
                              <div className="payments-detail-wide">
                                <span className="payments-detail-label">
                                  Réglement groupé — {r.facturesGroupe.length} facture(s) réglées par ce même virement
                                </span>
                                <ul className="payments-unassigned">
                                  {r.facturesGroupe.map((f) => (
                                    <li key={f.id}>
                                      N&deg; {f.numero} — {f.client} — {fmtMoney(f.montantTtc)}
                                      {f.id === r.invoiceId ? " (cette facture)" : ""}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        ))}

      {activeTab === "transactions" && (
        <>
          <div className="card payments-tx-summary">
            <div>
              <strong>{recapTransactions.nbTransactionsAffectees}</strong> affectée(s) à une facture,{" "}
              <strong>{recapTransactions.nbTransactionsNonAffectees}</strong> non affectée(s), pour un total de{" "}
              <strong>{fmtMoney(recapTransactions.totalNonAffecte)}</strong> non rattaché à une facture.
            </div>
            <label className="payments-filter-toggle">
              <input
                type="checkbox"
                checked={onlyUnassigned}
                onChange={(e) => setOnlyUnassigned(e.target.checked)}
              />
              N'afficher que les non affectées
            </label>
          </div>

          {transactionsAffichees.length === 0 ? (
            <p className="subtitle">Aucune transaction {onlyUnassigned ? "non affectée" : "trouvée"}.</p>
          ) : (
            <div className="table-scroll">
              <table className="invoices-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Référence</th>
                    <th>Libellé</th>
                    <th className="num">Montant</th>
                    <th>Affectée à</th>
                    <th>Méthode / confiance</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {transactionsAffichees.map((t) => (
                    <React.Fragment key={t.operationKey}>
                      <tr>
                        <td>{fmtDate(t.date)}</td>
                        <td className="payments-retenue" title={t.reference || ""}>
                          {t.reference || "—"}
                        </td>
                        <td className="payments-retenue" title={t.libelle || ""}>
                          {t.libelle || "—"}
                        </td>
                        <td className="num">{fmtMoney(t.montant)}</td>
                        <td>
                          {t.affectee ? (
                            <span className={badgeClass("Payée")}>
                              {t.factures.map((f) => f.numero).join(" + ")}
                            </span>
                          ) : (
                            <span className={badgeClass("Non payée")}>Non affectée</span>
                          )}
                          {t.factures.length > 1 && (
                            <div className="payments-folder-hint">
                              {t.factures.map((f) => `${f.client} (${fmtMoney(f.montantTtc)})`).join(", ")}
                            </div>
                          )}
                        </td>
                        <td className="payments-retenue">
                          {t.affectee ? `${t.methode || "—"} · ${t.confiance || "—"}` : "—"}
                        </td>
                        <td className="invoices-actions">
                          {t.associationManuelle ? (
                            <button
                              type="button"
                              className="btn link"
                              onClick={() => handleManualMatch(t.factures[0].id, null, false)}
                              disabled={manualBusyKey === `${t.factures[0].id}::`}
                            >
                              Dissocier
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="btn secondary"
                              onClick={() => openManualPicker("transaction", t.operationKey)}
                            >
                              {manualPickerFor?.type === "transaction" && manualPickerFor.id === t.operationKey
                                ? "Fermer"
                                : "Associer..."}
                            </button>
                          )}
                        </td>
                      </tr>
                      {manualPickerFor?.type === "transaction" && manualPickerFor.id === t.operationKey && (
                        <tr className="payments-detail-row">
                          <td colSpan={7}>
                            <div className="manual-match-panel">
                              <p className="payments-detail-label">
                                Choisir la facture réglée par cette transaction ({fmtMoney(t.montant)} le{" "}
                                {fmtDate(t.date)})
                              </p>
                              <input
                                type="text"
                                className="manual-match-search"
                                placeholder="Rechercher par numéro ou client..."
                                value={manualQuery}
                                onChange={(e) => setManualQuery(e.target.value)}
                                autoFocus
                              />
                              {invoiceCandidates.length === 0 ? (
                                <p className="subtitle">Aucune facture ne correspond.</p>
                              ) : (
                                <ul className="manual-match-list">
                                  {invoiceCandidates.slice(0, 50).map((r) => (
                                    <li key={r.invoiceId} className="manual-match-item">
                                      <div className="manual-match-item-info">
                                        <span>N&deg; {r.numero}</span>
                                        <span className="manual-match-item-libelle" title={r.client || ""}>
                                          {r.client}
                                        </span>
                                        <span className="num">{fmtMoney(r.montantTtc)}</span>
                                        <span className={badgeClass(r.statut)}>{r.statut}</span>
                                      </div>
                                      {manualConfirmTarget?.invoiceId === r.invoiceId &&
                                      manualConfirmTarget?.operationKey === t.operationKey ? (
                                        <div className="manual-match-confirm">
                                          <span>Écart de {fmtMoney(manualConfirmTarget.ecart)} — confirmer ?</span>
                                          <button
                                            type="button"
                                            className="btn primary"
                                            onClick={() => handleManualMatch(r.invoiceId, t.operationKey, true)}
                                            disabled={manualBusyKey === `${r.invoiceId}::${t.operationKey}`}
                                          >
                                            Confirmer quand même
                                          </button>
                                          <button
                                            type="button"
                                            className="btn secondary"
                                            onClick={() => setManualConfirmTarget(null)}
                                          >
                                            Annuler
                                          </button>
                                        </div>
                                      ) : (
                                        <button
                                          type="button"
                                          className="btn secondary"
                                          onClick={() => handleChoosePick(r.invoiceId, t.operationKey, r.montantTtc, t.montant)}
                                          disabled={manualBusyKey === `${r.invoiceId}::${t.operationKey}`}
                                        >
                                          Choisir
                                        </button>
                                      )}
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {activeTab === "relances" && (
        <>
          <div className="card payments-tx-summary">
            <div>
              <strong>{impayees.length}</strong> facture(s) pas encore confirmée(s) payée(s), pour{" "}
              <strong>{fmtMoney(totalImpaye)}</strong> restant à encaisser
              {nbImpayeesUrgentes > 0 && (
                <>
                  {" "}
                  — dont <strong className="aging-severe-text">{nbImpayeesUrgentes}</strong> depuis plus de 60
                  jours.
                </>
              )}
            </div>
          </div>

          {impayees.length === 0 ? (
            <p className="subtitle">Aucune facture en attente de paiement — tout est à jour.</p>
          ) : (
            <div className="table-scroll">
              <table className="invoices-table">
                <thead>
                  <tr>
                    <th>N&deg;</th>
                    <th>Date</th>
                    <th>Client</th>
                    <th className="num">Total T.T.C</th>
                    <th className="num">Reste à encaisser</th>
                    <th>Statut</th>
                    <th>Ancienneté</th>
                  </tr>
                </thead>
                <tbody>
                  {impayees.map((r) => (
                    <tr key={r.invoiceId}>
                      <td>{r.numero}</td>
                      <td>{fmtDate(r.date)}</td>
                      <td>{r.client}</td>
                      <td className="num">{fmtMoney(r.montantTtc)}</td>
                      <td className="num">{fmtMoney(r.resteAEncaisser)}</td>
                      <td>
                        <span className={badgeClass(r.statut)}>{r.statut}</span>
                      </td>
                      <td>
                        <span className={`badge ${ancienneteClass(r.ageJours)}`}>
                          {ancienneteLabel(r.ageJours)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
