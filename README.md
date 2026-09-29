# Facturation — application de facturation (bureau)

Application de bureau (Electron + React) pour generer des factures PDF, avec
un tableau de bord a venir. Les donnees (profil de l'entreprise, puis clients
et factures) sont stockees localement dans une base SQLite, sur la machine
qui fait tourner l'application.

## Etat actuel (fonctionnalite 1)

- **Profil de l'entreprise** : nom, adresse, RNE, matricule fiscal,
  telephone, email, RIB, logo. Enregistre en local.
- **Nouvelle facture -> PDF** : formulaire (client, date, lignes, TVA/FODEC)
  qui genere un PDF avec l'en-tete de l'entreprise, dans le meme format que
  les factures existantes (P.T.H.T / FODEC / T.V.A / TOTAL T.T.C + montant en
  toutes lettres). Cette facture n'est pas encore enregistree dans une liste
  — ca arrive avec la prochaine fonctionnalite (creation/suivi des factures,
  puis le tableau de bord, puis l'integration avec le suivi des reglements).

## Installation

Necessite [Node.js](https://nodejs.org/) (version 20 ou plus recente).

```bash
npm install
```

Cette commande installe aussi Electron et recompile `better-sqlite3` (base
de donnees) pour la version d'Electron utilisee — c'est fait automatiquement
par le script `postinstall`, rien a faire de plus.

## Lancer en developpement

```bash
npm run dev
```

Ouvre la fenetre de l'application avec rechargement a chaud sur les
modifications de l'interface.

## Construire l'application (executable)

```bash
npm run dist
```

Produit un installeur dans `release/` :
- `win` -> `.exe` (NSIS) — a lancer **sur une machine Windows** (ou une
  machine Windows via `npm run dist` directement dessus ; la compilation
  croisee depuis Linux vers Windows n'est pas garantie ici a cause du module
  natif `better-sqlite3`, qui doit etre compile pour la plateforme cible).
- `linux` -> `.AppImage`
- `mac` -> `.dmg`

**En pratique** : pour livrer la version Windows destinee au PC de
l'entreprise, le plus simple est d'installer Node.js sur ce PC Windows, d'y
copier ce dossier de code (sans `node_modules/`), et d'y lancer
`npm install` puis `npm run dist`. C'est ce qui garantit que le module de
base de donnees natif correspond bien a Windows.

## Organisation

```
electron/
  main.js              processus principal (fenetre, IPC, base de donnees, PDF)
  preload.js           pont securise entre l'interface et le processus principal
  db.js                SQLite (better-sqlite3) : profil de l'entreprise
  lib/
    invoiceTemplate.js  gabarit HTML de la facture (identique au format existant)
    numberToWords.js    montant en toutes lettres (francais, dinars/millimes)
src/
  App.jsx              navigation (barre laterale)
  pages/
    Settings.jsx        profil de l'entreprise (logo, adresse, RNE, ...)
    NewInvoice.jsx       formulaire de facture -> generation PDF
vite.config.js          build de l'interface (React)
```

## A venir (prochaines fonctionnalites, une a la fois)

1. Creation/suivi des factures (liste, statut, modification) au lieu du
   formulaire "a usage unique" actuel.
2. Tableau de bord (chiffre d'affaires, factures en attente, ...).
3. Integration avec le projet `invoice-tracker` existant (rapprochement
   bancaire BIAT, retenue a la source) directement dans cette application.
