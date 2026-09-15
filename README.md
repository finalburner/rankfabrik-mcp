# RankFabrik — canal MCP

Les 4 APIs de données publiques de RankFabrik, exposées comme **outils MCP** pour
les agents (Claude, ChatGPT, Cursor…). Serveur mince : il ne collecte rien
lui-même, il appelle les façades REST déjà en production et rend la réponse telle
quelle — clés, quotas, comptage et facturation restent ceux de l'API existante.

> **Une clé, quatre produits.** Prenez une clé d'essai gratuite (500 unités/mois,
> sans carte bancaire) sur **[rankfabrik.com/tarifs](https://rankfabrik.com/tarifs)**,
> puis renseignez-la dans `RANKFABRIK_API_KEY`. Si votre clé ne couvre pas encore
> un produit, l'outil concerné vous rend un message d'activation — jamais une
> erreur brute.

## Installer en un clic

[![Ajouter à Cursor](https://cursor.com/deeplink/mcp-install-dark.png)](cursor://anysphere.cursor-deeplink/mcp/install?name=rankfabrik&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsInJhbmtmYWJyaWstbWNwIl0sImVudiI6eyJSQU5LRkFCUklLX0FQSV9LRVkiOiIifX0=)

Via **Smithery** (installe et configure le serveur dans le client de votre choix) :

```bash
npx -y @smithery/cli install rankfabrik-mcp --client claude
```

`--client` accepte aussi `cursor`, `cline`, `windsurf`… Réglage manuel par client
plus bas dans **[Installer dans un client](#installer-dans-un-client)**.

## Outils

### Captions — transcription YouTube

| Outil | Ce qu'il rend | Facturation |
|---|---|---|
| `youtube_inspect` | Métadonnées + pistes de sous-titres disponibles, sans télécharger le texte | gratuit |
| `youtube_transcribe` | Transcription complète : texte, segments minutés, chapitres, SRT/VTT, verbatims | 1 unité |
| `youtube_search` | Identifiants de vidéos pour un terme | par identifiant |
| `youtube_harvest` | Cherche **et** transcrit un thème en un appel (≤ 30 vidéos) | par vidéo transcrite |
| `youtube_transcribe_batch` | Transcrit une liste d'identifiants/URL (≤ 50) en parallèle | par vidéo transcrite |

`video` accepte une URL YouTube sous ses quatre écritures (watch, youtu.be,
embed/shorts/live) ou un identifiant brut à onze caractères.

### Places — établissements

| Outil | Ce qu'il rend | Facturation |
|---|---|---|
| `places_search` | Établissements pour un terme autour d'un lieu (ville **ou** lat+lon), enrichissables (e-mails, horaires, photos) — ≤ 20 | par établissement |
| `places_scan` | Balayage plus large d'une zone (grille de points) | par établissement |
| `places_cities` | Liste des villes reconnues pour le paramètre `ville` | gratuit |

Localisation : soit `ville` (nom de ville connue, voir `places_cities`), soit
`latitude` + `longitude` pour n'importe où ailleurs.

### Jobs — emplois

| Outil | Ce qu'il rend | Facturation |
|---|---|---|
| `jobs_search` | Offres d'emploi pour un métier, éventuellement filtrées par lieu | par offre |
| `jobs_full` | Idem avec le détail complet de chaque offre (+ profil société optionnel) | par offre |
| `jobs_company` | Profil public de recrutement d'une société (nom ou slug) | par société |

### Verify — vérification d'e-mails

| Outil | Ce qu'il rend | Facturation |
|---|---|---|
| `verify_email` | Vérdict de délivrabilité d'une adresse (syntaxe, domaine, MX, sondage SMTP) | 1 unité |
| `verify_emails` | Idem pour une liste d'adresses | par adresse vérifiée |

## Configuration

Une seule variable est obligatoire : la clé fédérée.

| Variable | Rôle | Défaut |
|---|---|---|
| `RANKFABRIK_API_KEY` | Clé `rf_…` présentée aux 4 API (fédérée) | — (obligatoire) |
| `RANKFABRIK_EN_TETE_CLE` | En-tête portant la clé | `x-cle-api` |
| `RANKFABRIK_URL_CLE` | URL affichée pour obtenir/activer une clé | `https://rankfabrik.com/tarifs` |
| `MCP_TRANSPORT` | `stdio` ou `http` | `stdio` |
| `PORT` | Port en transport `http` | `8090` |

**Surcharges avancées (optionnelles).** Chaque produit vise son sous-domaine par
défaut — `captions` / `places` / `jobs` / `verify`.`rankfabrik.com`. On peut
surcharger cible et clé produit par produit : `RANKFABRIK_<PRODUIT>_URL` et
`RANKFABRIK_<PRODUIT>_KEY` (ex. `RANKFABRIK_PLACES_KEY`). `RANKFABRIK_BASE_URL`
reste accepté comme alias historique de la cible Captions.

## Installer dans un client

Tous les clients de bureau lancent le serveur en **stdio** via `npx` — aucun clone
nécessaire. Remplacez `rf_xxx` par votre clé.

### Claude Desktop

Fichier `claude_desktop_config.json` (menu **Réglages → Développeur → Éditer la
configuration**) :

```json
{
  "mcpServers": {
    "rankfabrik": {
      "command": "npx",
      "args": ["-y", "rankfabrik-mcp"],
      "env": { "RANKFABRIK_API_KEY": "rf_xxx" }
    }
  }
}
```

### Cursor

Bouton **[Ajouter à Cursor](cursor://anysphere.cursor-deeplink/mcp/install?name=rankfabrik&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsInJhbmtmYWJyaWstbWNwIl0sImVudiI6eyJSQU5LRkFCUklLX0FQSV9LRVkiOiIifX0=)**
ci-dessus, ou fichier `.cursor/mcp.json` (projet) / `~/.cursor/mcp.json` (global) :

```json
{
  "mcpServers": {
    "rankfabrik": {
      "command": "npx",
      "args": ["-y", "rankfabrik-mcp"],
      "env": { "RANKFABRIK_API_KEY": "rf_xxx" }
    }
  }
}
```

### Cline

Via l'UI **MCP Servers → Configure** (édite `cline_mcp_settings.json`) :

```json
{
  "mcpServers": {
    "rankfabrik": {
      "command": "npx",
      "args": ["-y", "rankfabrik-mcp"],
      "env": { "RANKFABRIK_API_KEY": "rf_xxx" },
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

### Continue

MCP fonctionne en **mode agent**. Fichier `.continue/mcpServers/rankfabrik.yaml`
(workspace) ou sous `~/.continue/` (global) :

```yaml
name: RankFabrik
version: 0.0.1
schema: v1
mcpServers:
  - name: RankFabrik
    command: npx
    args:
      - "-y"
      - "rankfabrik-mcp"
    env:
      RANKFABRIK_API_KEY: ${{ secrets.RANKFABRIK_API_KEY }}
```

## Démarrer (dev / auto-hébergé)

Depuis un clone, en stdio :

```bash
RANKFABRIK_API_KEY=rf_xxx node serveur.mjs
```

### À distance (Streamable HTTP)

```bash
MCP_TRANSPORT=http PORT=8090 RANKFABRIK_API_KEY=rf_xxx node serveur.mjs
# point d'entrée : POST http://localhost:8090/mcp
```

## Conception

- **Un outil = un appel REST.** Aucune logique de collecte dupliquée.
- **Dégradation propre.** Une clé qui ne couvre pas encore un produit (401/403)
  rend un message actionnable (« prenez une clé d'essai sur … ») plutôt qu'une
  erreur brute — le canal reste utilisable produit par produit.
- **Erreurs lisibles.** Un rejet de l'API (paramètre manquant, quota épuisé,
  clé absente) revient comme résultat d'outil `isError`, que l'agent peut lire
  et corriger, jamais comme une exception qui coupe la session.
- **Dépendances isolées.** Ce dossier porte le SDK MCP et zod ; le produit REST
  garde sa règle « zéro dépendance sauf undici ».
- **Facturation native.** Chaque appel passe par l'API de production : le
  registre existant compte et facture, la clé de l'utilisateur circule dans sa
  propre configuration MCP et n'est jamais stockée ici.

## Dépôt

Ce paquet est publié depuis le dépôt public **[finalburner/rankfabrik-mcp](https://github.com/finalburner/rankfabrik-mcp)**
(canal MCP uniquement). Le moteur REST reste dans un dépôt privé séparé.
