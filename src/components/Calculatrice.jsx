import React, { useMemo, useState } from "react";

// Calculatrice P.H.T <-> P.T.T.C independante du formulaire de facture :
// un outil de saisie rapide ("je connais l'un des deux montants, je veux
// l'autre"), qui ne touche a aucun champ ni ligne de la facture en cours.
// Reprend exactement la meme formule que le reste de l'application
// (FODEC 1% optionnel puis T.V.A 19%), pour donner le meme resultat qu'une
// vraie facture.
function calculer(valeurConnue, sens, avecFodec) {
  const v = Number(valeurConnue);
  if (!Number.isFinite(v) || v < 0) return null;

  const facteurFodec = avecFodec ? 1.01 : 1;

  let ht;
  if (sens === "ht") {
    ht = v;
  } else {
    // v = ht * facteurFodec * 1.19  =>  ht = v / (facteurFodec * 1.19)
    ht = v / (facteurFodec * 1.19);
  }
  const fodec = avecFodec ? ht * 0.01 : 0;
  const tva = (ht + fodec) * 0.19;
  const ttc = ht + fodec + tva;
  return { ht, fodec, tva, ttc };
}

function fmt(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toLocaleString("fr-FR", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

export default function Calculatrice({ avecFodecParDefaut, onClose }) {
  const [sens, setSens] = useState("ht"); // "ht" : je saisis le P.H.T -> "ttc" : je saisis le P.T.T.C
  const [avecFodec, setAvecFodec] = useState(avecFodecParDefaut !== false);
  const [valeur, setValeur] = useState("");

  const resultat = useMemo(() => calculer(valeur, sens, avecFodec), [valeur, sens, avecFodec]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal calc-modal" onClick={(e) => e.stopPropagation()}>
        <h2 className="section-title">Calculatrice P.H.T / P.T.T.C</h2>
        <p className="subtitle calc-subtitle">
          Un outil de saisie rapide, séparé de la facture en cours : rien ici n'est enregistré ni ajouté à la
          facture.
        </p>

        <div className="calc-radio-group">
          <label className="checkbox-row">
            <input type="radio" name="calc-sens" checked={sens === "ht"} onChange={() => setSens("ht")} />
            Je connais le P.H.T, je veux le P.T.T.C
          </label>
          <label className="checkbox-row">
            <input type="radio" name="calc-sens" checked={sens === "ttc"} onChange={() => setSens("ttc")} />
            Je connais le P.T.T.C, je veux le P.H.T
          </label>
        </div>

        <div className="calc-radio-group">
          <label className="checkbox-row">
            <input
              type="radio"
              name="calc-fodec"
              checked={avecFodec}
              onChange={() => setAvecFodec(true)}
            />
            Avec FODEC (1%)
          </label>
          <label className="checkbox-row">
            <input
              type="radio"
              name="calc-fodec"
              checked={!avecFodec}
              onChange={() => setAvecFodec(false)}
            />
            Sans FODEC
          </label>
        </div>

        <label>
          {sens === "ht" ? "P.H.T (DT)" : "P.T.T.C (DT)"}
          <input
            type="number"
            min="0"
            step="any"
            autoFocus
            value={valeur}
            onChange={(e) => setValeur(e.target.value)}
            placeholder="0.000"
          />
        </label>

        <div className="totaux-preview calc-result">
          <div className={sens === "ttc" ? "calc-reponse" : ""}>
            <span>P.T.H.T</span>
            <span>{fmt(resultat?.ht)} DT</span>
          </div>
          {avecFodec && (
            <div>
              <span>FODEC 1%</span>
              <span>{fmt(resultat?.fodec)} DT</span>
            </div>
          )}
          <div>
            <span>T.V.A 19%</span>
            <span>{fmt(resultat?.tva)} DT</span>
          </div>
          <div className={`ttc ${sens === "ht" ? "calc-reponse" : ""}`}>
            <span>TOTAL T.T.C</span>
            <span>{fmt(resultat?.ttc)} DT</span>
          </div>
        </div>

        <div className="actions">
          <button type="button" className="btn secondary" onClick={onClose}>
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}
