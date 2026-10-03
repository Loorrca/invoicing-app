import React, { useRef, useState } from "react";
import { correspondTranslitteration, correspondSigle } from "../utils/translitteration.js";

// Champ de recherche avec liste filtrée en temps réel (remplace un <select>
// natif) : on tape une partie du nom/désignation OU du code, la liste des
// correspondances se met à jour à chaque frappe, et on choisit au clavier
// (flèches + Entrée) ou à la souris.
//
// `items`     : tableau de données brutes (clients ou articles).
// `getId`/`getLabel`/`getCode` : accesseurs pour extraire id/libellé/code
//              de chaque élément de `items`.
// `value`     : id actuellement sélectionné (ou "").
// `onSelect(id)` : appelé avec l'id choisi, ou `extraOption.value` si
//              l'option fixe est cliquée/validée.
// `extraOption` : { value, label } pour l'option fixe "+ Nouveau..." /
//              "+ Nouvel..." toujours affichée en bas de la liste, même
//              filtrée (comme la dernière <option> du <select> d'origine).
// `placeholder` : texte affiché dans le champ quand il est vide ; si un
//              élément est sélectionné, son libellé (et code) sert de
//              placeholder tant qu'on ne retape pas une recherche.
export default function SearchableSelect({
  items,
  getId = (i) => i.id,
  getLabel,
  getCode = () => "",
  value,
  onSelect,
  extraOption,
  placeholder = "Rechercher...",
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef(null);
  const closeTimer = useRef(null);

  const selected = value ? items.find((i) => getId(i) === value) : null;

  function labelOf(item) {
    const code = getCode(item);
    return code ? `${getLabel(item)} (${code})` : getLabel(item);
  }

  const q = query.trim().toLowerCase();
  const filtered = q
    ? items.filter((i) => {
        const label = (getLabel(i) || "").toLowerCase();
        const code = (getCode(i) || "").toLowerCase();
        // La recherche translitteree permet de retrouver un client/article en
        // tapant une transcription latine d'un nom arabe (ou l'inverse) ; la
        // variante "sigle" retrouve "O.N.P.F.T" en tapant "onpft".
        return (
          label.includes(q) ||
          code.includes(q) ||
          correspondTranslitteration(getLabel(i), query) ||
          correspondSigle(getLabel(i), query) ||
          correspondSigle(code, query)
        );
      })
    : items;

  const options = extraOption ? [...filtered, { __extra: true, ...extraOption }] : filtered;
  const effectiveHighlight = Math.min(highlight, Math.max(options.length - 1, 0));

  function openList() {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setOpen(true);
  }

  function closeList() {
    setOpen(false);
    setQuery("");
  }

  function choose(opt) {
    if (!opt) return;
    onSelect(opt.__extra ? opt.value : getId(opt));
    closeList();
  }

  function handleKeyDown(e) {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter") {
        e.preventDefault();
        openList();
        setHighlight(0);
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, options.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(options[effectiveHighlight]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeList();
    }
  }

  const placeholderText = selected ? labelOf(selected) : placeholder;

  return (
    <div className="searchable-select" ref={rootRef}>
      <input
        type="text"
        value={query}
        placeholder={placeholderText}
        onChange={(e) => {
          setQuery(e.target.value);
          setHighlight(0);
          openList();
        }}
        onFocus={openList}
        onBlur={() => {
          // Petit délai pour laisser le clic sur une option (onMouseDown)
          // s'exécuter avant que la liste ne se referme.
          closeTimer.current = setTimeout(closeList, 120);
        }}
        onKeyDown={handleKeyDown}
        autoComplete="off"
      />
      {open && (
        <ul className="searchable-select-list">
          {options.length === 0 && <li className="searchable-select-empty">Aucun résultat</li>}
          {options.map((opt, idx) => (
            <li
              key={opt.__extra ? "__extra__" : getId(opt)}
              className={
                "searchable-select-option" +
                (idx === effectiveHighlight ? " highlight" : "") +
                (opt.__extra ? " extra" : "")
              }
              onMouseDown={(e) => {
                e.preventDefault();
                choose(opt);
              }}
              onMouseEnter={() => setHighlight(idx)}
            >
              {opt.__extra ? opt.label : labelOf(opt)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
