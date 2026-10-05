import React, { useEffect, useMemo, useState } from "react";
import { nomClient } from "../utils/clientDisplay.js";

const BAR_COLOR = "#2a78d6";
const BAR_COLOR_HOVER = "#1c5cab";

function fmtMoney(n) {
  return `${(Number(n) || 0).toLocaleString("fr-FR", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} DT`;
}

function fmtQty(n) {
  return (Number(n) || 0).toLocaleString("fr-FR", { maximumFractionDigits: 3 });
}

function fmtDate(d) {
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return d || "";
  return date.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

// Tous les calculs de mois se font en index entier (annee*12 + mois-0-indexe),
// jamais via toISOString() : le champ "date" des factures est une date locale
// sans heure ("2026-08-05"), et melanger ca avec un Date UTC serialise decale
// silencieusement le mois d'un cran des qu'on est dans un fuseau horaire
// autre que UTC (ex. Africa/Tunis, UTC+1).
function ymIndex(dateStr) {
  const m = /^(\d{4})-(\d{2})/.exec(dateStr || "");
  return m ? Number(m[1]) * 12 + (Number(m[2]) - 1) : null;
}

function ymLabel(idx) {
  const year = Math.floor(idx / 12);
  const month = idx % 12;
  const label = new Date(year, month, 1).toLocaleDateString("fr-FR", { month: "short", year: "2-digit" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

// Trace un rectangle arrondi seulement en haut (le mark "grandit" depuis la
// ligne de base, qui reste bien droite).
function roundedTopBarPath(x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, Math.max(height, 0));
  if (height <= 0) return "";
  if (r <= 0) return `M${x},${y + height} L${x},${y} L${x + width},${y} L${x + width},${y + height} Z`;
  return `M${x},${y + height} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + width - r},${y} Q${x + width},${y} ${x + width},${y + r} L${x + width},${y + height} Z`;
}

function EvolutionChart({ months }) {
  const [hover, setHover] = useState(null);
  const max = Math.max(1, ...months.map((m) => m.value));
  const plotHeight = 140;
  const topPad = 22;
  const bottomPad = 24;
  const barMaxWidth = 24;
  const slot = Math.max(46, Math.min(72, 640 / Math.max(months.length, 1)));
  const chartWidth = Math.max(320, months.length * slot);
  const barWidth = Math.min(barMaxWidth, slot - 10);
  const height = plotHeight + topPad + bottomPad;

  return (
    <div className="chart-scroll">
      <svg width={chartWidth} height={height} role="img" aria-label="Chiffre d'affaires par mois">
        <line
          x1={0}
          y1={topPad + plotHeight}
          x2={chartWidth}
          y2={topPad + plotHeight}
          stroke="#c3c2b7"
          strokeWidth="1"
        />
        {months.map((m, i) => {
          const barH = max > 0 ? (m.value / max) * (plotHeight - 6) : 0;
          const x = i * slot + (slot - barWidth) / 2;
          const y = topPad + plotHeight - barH;
          const isHover = hover === i;
          return (
            <g key={`${m.label}-${i}`}>
              <rect
                x={x - 8}
                y={topPad - 18}
                width={barWidth + 16}
                height={plotHeight + 18}
                fill="transparent"
                tabIndex={0}
                onPointerEnter={() => setHover(i)}
                onPointerLeave={() => setHover((h) => (h === i ? null : h))}
                onFocus={() => setHover(i)}
                onBlur={() => setHover((h) => (h === i ? null : h))}
              >
                <title>{`${m.label} : ${fmtMoney(m.value)}`}</title>
              </rect>
              <path d={roundedTopBarPath(x, y, barWidth, barH, 4)} fill={isHover ? BAR_COLOR_HOVER : BAR_COLOR} />
              {m.value > 0 && (
                <text x={x + barWidth / 2} y={y - 6} textAnchor="middle" fontSize="10" fill="#52514e">
                  {fmtQty(m.value)}
                </text>
              )}
              <text x={x + barWidth / 2} y={topPad + plotHeight + 16} textAnchor="middle" fontSize="10.5" fill="#898781">
                {m.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function HorizontalBars({ data, formatValue }) {
  const [hover, setHover] = useState(null);
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="hbar-chart">
      {data.map((d, i) => {
        const pct = max > 0 && d.value > 0 ? Math.max((d.value / max) * 100, 3) : 0;
        return (
          <div
            key={d.label}
            className="hbar-row"
            tabIndex={0}
            title={`${d.label} : ${formatValue(d.value)}`}
            onPointerEnter={() => setHover(i)}
            onPointerLeave={() => setHover((h) => (h === i ? null : h))}
            onFocus={() => setHover(i)}
            onBlur={() => setHover((h) => (h === i ? null : h))}
          >
            <span className="hbar-label">{d.label}</span>
            <div className="hbar-track">
              <div
                className="hbar-fill"
                style={{ width: `${pct}%`, background: hover === i ? BAR_COLOR_HOVER : BAR_COLOR }}
              />
            </div>
            <span className="hbar-value">{formatValue(d.value)}</span>
          </div>
        );
      })}
    </div>
  );
}

// Rappel de sauvegarde (toutes entreprises confondues — voir Sauvegarde.jsx) :
// un simple export ZIP manuel est facile à oublier, donc un petit rappel
// visible dès l'ouverture du tableau de bord, qui se colore à mesure que ça
// date (mêmes seuils que les relances de paiement : ≤14j vert, 15-30j
// orange, au-delà ou jamais fait rouge).
function BackupReminderCard({ backupInfo, onExport, exporting, onGoToSauvegarde, backupMsg }) {
  const lastAt = backupInfo?.lastExportAt || null;
  const daysSince = lastAt ? Math.floor((Date.now() - new Date(lastAt).getTime()) / 86400000) : null;
  let cls;
  let message;
  if (daysSince === null) {
    cls = "aging-severe";
    message = "Aucune sauvegarde n'a encore été faite sur ce poste.";
  } else if (daysSince <= 14) {
    cls = "aging-low";
    message = `Dernière sauvegarde il y a ${daysSince} jour${daysSince > 1 ? "s" : ""}.`;
  } else if (daysSince <= 30) {
    cls = "aging-medium";
    message = `Dernière sauvegarde il y a ${daysSince} jours — ça commence à dater.`;
  } else {
    cls = "aging-severe";
    message = `Dernière sauvegarde il y a ${daysSince} jours — pensez à en refaire une.`;
  }
  return (
    <div className="card backup-reminder-card">
      <div className="dashboard-card-header">
        <div className="backup-reminder-info">
          <span className={`badge ${cls}`}>Sauvegarde</span>
          <span className="backup-reminder-text">{message}</span>
        </div>
        <div className="payments-folder-actions">
          <button type="button" className="btn primary" onClick={onExport} disabled={exporting}>
            {exporting ? "Export..." : "Sauvegarder maintenant"}
          </button>
          <button type="button" className="btn secondary" onClick={onGoToSauvegarde}>
            Gérer
          </button>
        </div>
      </div>
      {backupMsg && (
        <p className={`status ${backupMsg.kind === "error" ? "error" : "ok"}`}>{backupMsg.text}</p>
      )}
    </div>
  );
}

function StatTile({ label, value, subValue, delta }) {
  return (
    <div className="stat-tile">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {subValue && <div className="stat-subvalue">{subValue}</div>}
      {delta !== null && delta !== undefined && (
        <div className={`stat-delta ${delta >= 0 ? "up" : "down"}`}>
          {delta >= 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(1)}% vs mois precedent
        </div>
      )}
    </div>
  );
}

export default function Dashboard({ onGoToInvoices, onGoToPaiements, onGoToSauvegarde }) {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [paiements, setPaiements] = useState(null);
  const [backupInfo, setBackupInfo] = useState(null);
  const [backupExporting, setBackupExporting] = useState(false);
  const [backupMsg, setBackupMsg] = useState(null);
  const [selectedYear, setSelectedYear] = useState(() => new Date().getFullYear());

  // Annees proposees dans le selecteur : celles qui ont au moins une
  // facture, plus l'annee civile en cours (meme vide, ex. le 1er janvier,
  // pour qu'on puisse quand meme la voir/la selectionner).
  const availableYears = useMemo(() => {
    const years = new Set(
      invoices
        .map((f) => Number((f.date || "").slice(0, 4)))
        .filter((y) => Number.isFinite(y) && y > 0)
    );
    years.add(new Date().getFullYear());
    return [...years].sort((a, b) => b - a);
  }, [invoices]);

  const yearInvoices = useMemo(
    () => invoices.filter((f) => Number((f.date || "").slice(0, 4)) === selectedYear),
    [invoices, selectedYear]
  );

  useEffect(() => {
    window.api
      .listInvoices()
      .then((list) => {
        setInvoices(list);
        setLoading(false);
      })
      .catch(() => setLoading(false));
    window.api
      .scanPayments()
      .then((res) => setPaiements(res?.ok ? res : null))
      .catch(() => setPaiements(null));
    window.api
      .getLastBackupInfo()
      .then(setBackupInfo)
      .catch(() => setBackupInfo(null));
  }, []);

  // Sauvegarde complète (toutes entreprises) en un clic depuis le tableau de
  // bord — même action que l'onglet Sauvegarde (voir Sauvegarde.jsx).
  async function handleQuickExport() {
    setBackupExporting(true);
    setBackupMsg(null);
    try {
      const res = await window.api.exportBackup();
      if (res.canceled) return;
      if (!res.ok) {
        setBackupMsg({ kind: "error", text: `Échec de l'export : ${res.error}` });
        return;
      }
      setBackupMsg({ kind: "ok", text: `Sauvegarde créée : ${res.path}` });
      window.api.getLastBackupInfo().then(setBackupInfo).catch(() => {});
    } finally {
      setBackupExporting(false);
    }
  }

  const stats = useMemo(() => {
    const monthTotals = new Map();
    const monthTotalsTva = new Map();
    const monthTotalsTtc = new Map();
    let totalHT = 0;
    let totalTTC = 0;
    let totalTVA = 0;
    const clientTotals = new Map();
    const productTotals = new Map();

    // Tout ce qui suit est scope a l'annee choisie dans le selecteur
    // (yearInvoices), pas a l'historique complet : CA/TVA de l'annee,
    // graphique mensuel de janvier a decembre de cette annee-la, top
    // clients/articles de cette annee-la.
    for (const f of yearInvoices) {
      const ht = f.totaux?.ht || 0;
      const tva = f.totaux?.tva || 0;
      const ttc = f.totaux?.ttc || 0;
      totalHT += ht;
      totalTTC += ttc;
      totalTVA += tva;

      const idx = ymIndex(f.date);
      if (idx !== null) {
        monthTotals.set(idx, (monthTotals.get(idx) || 0) + ht);
        monthTotalsTva.set(idx, (monthTotalsTva.get(idx) || 0) + tva);
        monthTotalsTtc.set(idx, (monthTotalsTtc.get(idx) || 0) + ttc);
      }

      const client = nomClient(f.client).trim();
      if (client) clientTotals.set(client, (clientTotals.get(client) || 0) + ht);

      for (const l of f.lignes || []) {
        const designation = (l.designation || "").trim();
        if (!designation) continue;
        productTotals.set(designation, (productTotals.get(designation) || 0) + (Number(l.quantite) || 0));
      }
    }

    // Les 12 mois de l'annee choisie, janvier a decembre, toujours complets
    // (barres a zero pour un mois sans facture) : colle au calendrier de
    // l'annee selectionnee plutot qu'a une fenetre glissante de 12 mois.
    const yearStartIdx = selectedYear * 12;
    const months = [];
    const moisTva = [];
    for (let idx = yearStartIdx; idx < yearStartIdx + 12; idx++) {
      months.push({ label: ymLabel(idx), value: monthTotals.get(idx) || 0 });
      moisTva.push({
        idx,
        label: ymLabel(idx),
        ht: monthTotals.get(idx) || 0,
        tva: monthTotalsTva.get(idx) || 0,
        ttc: monthTotalsTtc.get(idx) || 0,
      });
    }

    // "Ce mois-ci" / "mois precedent" n'ont de sens que pour l'annee civile
    // en cours. On les recalcule a partir de TOUTES les factures (pas
    // seulement yearInvoices) pour que janvier compare correctement au
    // decembre de l'annee precedente, sans faux zero du a la coupure
    // d'annee.
    const now = new Date();
    const nowIdx = now.getFullYear() * 12 + now.getMonth();
    const estAnneeEnCours = selectedYear === now.getFullYear();

    let thisMonthHT = null;
    let prevMonthHT = null;
    let thisMonthTVA = null;
    let delta = null;
    if (estAnneeEnCours) {
      thisMonthHT = 0;
      prevMonthHT = 0;
      thisMonthTVA = 0;
      for (const f of invoices) {
        const idx = ymIndex(f.date);
        if (idx === nowIdx) {
          thisMonthHT += f.totaux?.ht || 0;
          thisMonthTVA += f.totaux?.tva || 0;
        } else if (idx === nowIdx - 1) {
          prevMonthHT += f.totaux?.ht || 0;
        }
      }
      delta = prevMonthHT > 0 ? ((thisMonthHT - prevMonthHT) / prevMonthHT) * 100 : null;
    }

    const topClients = [...clientTotals.entries()]
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);

    const topProducts = [...productTotals.entries()]
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);

    return {
      totalHT,
      totalTTC,
      totalTVA,
      thisMonthTVA,
      months,
      moisTva,
      thisMonthHT,
      prevMonthHT,
      delta,
      topClients,
      topProducts,
      estAnneeEnCours,
    };
  }, [invoices, yearInvoices, selectedYear]);

  // "Suivi des paiements" du tableau de bord, scope a l'annee choisie : on
  // reutilise les lignes deja rapprochees par scanPayments() (meme appel,
  // non filtre) et on ne refait que la somme, sur les factures EMISES
  // cette annee-la (base facturation : une facture de decembre payee en
  // janvier compte dans l'annee de la facture, pas celle de l'encaissement
  // — coherent avec "Reste a encaisser", qui n'a de date que celle de la
  // facture). L'onglet Paiements, lui, reste cumulatif et n'a pas ce
  // filtre.
  const paiementsAnnee = useMemo(() => {
    if (!paiements) return null;
    const rows = paiements.rows.filter((r) => Number((r.date || "").slice(0, 4)) === selectedYear);
    const totalEncaisse = rows.reduce((s, r) => s + (typeof r.montantRecu === "number" ? r.montantRecu : 0), 0);
    const resteAEncaisser = rows
      .filter((r) => r.statut === "Non payée")
      .reduce((s, r) => s + (r.montantTtc || 0), 0);
    const nbAVerifier = rows.filter((r) => r.peutVerifier).length;
    return {
      totalEncaisse: Math.round(totalEncaisse * 1000) / 1000,
      resteAEncaisser: Math.round(resteAEncaisser * 1000) / 1000,
      nbAVerifier,
    };
  }, [paiements, selectedYear]);

  if (loading) return <div className="page">Chargement...</div>;

  if (invoices.length === 0) {
    return (
      <div className="page">
        <h1>Tableau de bord</h1>
        <p className="subtitle">Aucune facture enregistree pour le moment pour cette entreprise.</p>
        <BackupReminderCard
          backupInfo={backupInfo}
          onExport={handleQuickExport}
          exporting={backupExporting}
          onGoToSauvegarde={onGoToSauvegarde}
          backupMsg={backupMsg}
        />
      </div>
    );
  }

  const recent = yearInvoices.slice(0, 6);

  return (
    <div className="page page-wide">
      <div className="page-header-row">
        <div>
          <h1>Tableau de bord</h1>
          <p className="subtitle">Vue d'ensemble de l'entreprise active.</p>
        </div>
        <label className="dashboard-year-select">
          Année
          <select value={selectedYear} onChange={(e) => setSelectedYear(Number(e.target.value))}>
            {availableYears.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
      </div>

      {yearInvoices.length === 0 ? (
        <p className="subtitle">Aucune facture pour l'année {selectedYear}.</p>
      ) : (
        <>
          <div className="kpi-row">
            <StatTile
              label={`Chiffre d'affaires ${selectedYear} (HT)`}
              value={fmtMoney(stats.totalHT)}
              subValue={`TTC : ${fmtMoney(stats.totalTTC)}`}
            />
            {stats.estAnneeEnCours && (
              <>
                <StatTile label="Ce mois-ci (HT)" value={fmtMoney(stats.thisMonthHT)} delta={stats.delta} />
                <StatTile label="Mois precedent (HT)" value={fmtMoney(stats.prevMonthHT)} />
              </>
            )}
          </div>

          <div className="card">
            <h2 className="section-title">Evolution du chiffre d'affaires (HT) — {selectedYear}</h2>
            <EvolutionChart months={stats.months} />
          </div>

          <div className="card">
            <h2 className="section-title">TVA collectée — {selectedYear}</h2>
            <div className="kpi-row" style={{ marginBottom: 14 }}>
              <StatTile label={`TVA collectée ${selectedYear}`} value={fmtMoney(stats.totalTVA)} />
              {stats.estAnneeEnCours && (
                <StatTile label="TVA collectée (ce mois-ci)" value={fmtMoney(stats.thisMonthTVA)} />
              )}
            </div>
            <div className="table-scroll">
              <table className="invoices-table">
                <thead>
                  <tr>
                    <th>Mois</th>
                    <th className="num">Chiffre d'affaires HT</th>
                    <th className="num">TVA collectée</th>
                    <th className="num">Total TTC</th>
                  </tr>
                </thead>
                <tbody>
                  {[...stats.moisTva].reverse().map((m) => (
                    <tr key={m.idx}>
                      <td>{m.label}</td>
                      <td className="num">{fmtMoney(m.ht)}</td>
                      <td className="num">{fmtMoney(m.tva)}</td>
                      <td className="num">{fmtMoney(m.ttc)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="payments-folder-hint">
              Pense-bête pour la déclaration mensuelle de TVA : la TVA collectée sur les factures émises ce
              mois-ci, avant déduction de la TVA payée sur vos propres achats.
            </p>
          </div>

          {paiementsAnnee && (
            <div className="card">
              <div className="dashboard-card-header">
                <h2 className="section-title">Suivi des paiements (rapprochement BIAT) — {selectedYear}</h2>
                <button type="button" className="btn secondary" onClick={() => onGoToPaiements?.()}>
                  Voir les paiements
                </button>
              </div>
              <div className="kpi-row" style={{ marginBottom: 0 }}>
                <StatTile label="Total encaissé" value={fmtMoney(paiementsAnnee.totalEncaisse)} />
                <StatTile label="Reste à encaisser" value={fmtMoney(paiementsAnnee.resteAEncaisser)} />
                <StatTile label="Factures à vérifier" value={fmtQty(paiementsAnnee.nbAVerifier)} />
              </div>
            </div>
          )}

          <div className="grid-2 dashboard-grid">
            <div className="card">
              <h2 className="section-title">Top clients (HT) — {selectedYear}</h2>
              {stats.topClients.length ? (
                <HorizontalBars data={stats.topClients} formatValue={fmtMoney} />
              ) : (
                <p className="subtitle">Aucune donnee.</p>
              )}
            </div>
            <div className="card">
              <h2 className="section-title">Top 5 articles (quantite) — {selectedYear}</h2>
              {stats.topProducts.length ? (
                <HorizontalBars data={stats.topProducts} formatValue={fmtQty} />
              ) : (
                <p className="subtitle">Aucune donnee.</p>
              )}
            </div>
          </div>

          <div className="card">
            <div className="dashboard-card-header">
              <h2 className="section-title">Dernieres factures ({selectedYear})</h2>
              <button type="button" className="btn secondary" onClick={() => onGoToInvoices?.()}>
                Voir toutes les factures
              </button>
            </div>
            <table className="invoices-table">
              <thead>
                <tr>
                  <th>N&deg;</th>
                  <th>Date</th>
                  <th>Client</th>
                  <th className="num">Total T.T.C</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((f) => (
                  <tr key={f.id}>
                    <td>{f.numero}</td>
                    <td>{fmtDate(f.date)}</td>
                    <td>{nomClient(f.client)}</td>
                    <td className="num">{fmtMoney(f.totaux?.ttc)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <BackupReminderCard
        backupInfo={backupInfo}
        onExport={handleQuickExport}
        exporting={backupExporting}
        onGoToSauvegarde={onGoToSauvegarde}
        backupMsg={backupMsg}
      />
    </div>
  );
}
