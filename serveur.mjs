#!/usr/bin/env node
// Canal MCP de RankFabrik.
//
// Ce serveur ne refait rien : il expose les façades REST déjà vendues comme des
// outils MCP. L'agent (Claude, ChatGPT, Cursor…) appelle un outil, le serveur
// traduit en un GET vers l'API de production, et rend la réponse telle quelle.
//
// Pourquoi mince plutôt qu'un moteur réimporté : l'API REST porte déjà les clés,
// les quotas, le comptage et la facturation. En passant par elle, chaque appel
// MCP est facturé nativement par le registre existant. La clé de l'utilisateur
// est fournie dans sa configuration MCP (variable d'environnement), jamais ici.
//
// Un seul canal, les quatre produits : Captions (transcription YouTube),
// Places (établissements), Jobs (emplois) et Verify (vérification d'e-mails).
// Chaque produit a sa propre façade REST (un sous-domaine) et, aujourd'hui, sa
// propre clé. Le serveur accepte UNE clé fédérée (RANKFABRIK_API_KEY) valable
// pour tout, avec la possibilité de surcharger la clé produit par produit. Si la
// clé ne couvre pas encore un produit, l'API répond 401/403 et l'outil rend un
// message actionnable (« prenez une clé d'essai sur … ») plutôt qu'une erreur
// brute : dégradation propre, jamais un mur.
//
// Deux transports, un seul code :
//   · stdio (défaut)      — tourne chez l'utilisateur, config = clé en env.
//   · http  (MCP_TRANSPORT=http) — Streamable HTTP, pour l'hébergement distant.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import http from "node:http";

// --------------------------------------------------------------- configuration
//
// Une clé fédérée (RANKFABRIK_API_KEY) sert de valeur par défaut pour les quatre
// produits ; chaque produit peut la surcharger par sa propre variable. Chaque
// produit a un sous-domaine de prod, lui aussi surchargeable (utile en test).
// RANKFABRIK_BASE_URL reste accepté comme alias historique de la cible Captions.

const CLE = process.env.RANKFABRIK_API_KEY || "";
const EN_TETE_CLE = process.env.RANKFABRIK_EN_TETE_CLE || "x-cle-api";
// Où l'utilisateur obtient/active une clé. Repris tel quel dans les messages
// d'erreur pour rendre l'onboarding inline (« prenez une clé sur … »).
const URL_CLE = process.env.RANKFABRIK_URL_CLE || "https://rankfabrik.com/tarifs";

const sansSlash = (u) => u.replace(/\/+$/, "");

const PRODUITS = {
  captions: {
    nom: "Captions",
    base: sansSlash(
      process.env.RANKFABRIK_CAPTIONS_URL || process.env.RANKFABRIK_BASE_URL || "https://captions.rankfabrik.com",
    ),
    cle: process.env.RANKFABRIK_CAPTIONS_KEY || CLE,
    envCle: "RANKFABRIK_CAPTIONS_KEY",
  },
  places: {
    nom: "Places",
    base: sansSlash(process.env.RANKFABRIK_PLACES_URL || "https://places.rankfabrik.com"),
    cle: process.env.RANKFABRIK_PLACES_KEY || CLE,
    envCle: "RANKFABRIK_PLACES_KEY",
  },
  jobs: {
    nom: "Jobs",
    base: sansSlash(process.env.RANKFABRIK_JOBS_URL || "https://jobs.rankfabrik.com"),
    cle: process.env.RANKFABRIK_JOBS_KEY || CLE,
    envCle: "RANKFABRIK_JOBS_KEY",
  },
  verify: {
    nom: "Verify",
    base: sansSlash(process.env.RANKFABRIK_VERIFY_URL || "https://verify.rankfabrik.com"),
    cle: process.env.RANKFABRIK_VERIFY_KEY || CLE,
    envCle: "RANKFABRIK_VERIFY_KEY",
  },
};

// --------------------------------------------------------------- appel du REST
//
// Un seul chemin d'appel : choisir la façade du produit, présenter sa clé, lire
// le JSON. L'API rend {error} avec un code ≥400 sur rejet, {…, mesures} sur
// succès. On remonte l'un ou l'autre sans le déformer : l'agent voit exactement
// ce que voit un client REST, y compris `mesures.unitesFacturees`.
//
// Cas particulier 401/403 : la clé est présente mais ne couvre pas ce produit
// (clés par-produit tant que la clé fédérée n'est pas généralisée côté moteur).
// On rend alors un message d'onboarding actionnable au lieu de l'erreur brute.

async function appeler(produit, route, parametres) {
  const p = PRODUITS[produit];
  if (!p) throw new Error(`produit inconnu : ${produit}`);
  if (!p.cle) {
    throw new Error(
      `clé absente pour ${p.nom} — renseignez ${p.envCle} (ou la clé fédérée RANKFABRIK_API_KEY) ` +
        `dans la configuration du serveur MCP (en-tête ${EN_TETE_CLE}). ` +
        `Une clé d'essai gratuite s'obtient sur ${URL_CLE}.`,
    );
  }
  const url = new URL(`${p.base}${route}`);
  for (const [k, v] of Object.entries(parametres)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }
  let reponse;
  try {
    reponse = await fetch(url, { headers: { [EN_TETE_CLE]: p.cle, accept: "application/json" } });
  } catch (e) {
    throw new Error(`API ${p.nom} injoignable (${p.base}) : ${e.message}`);
  }
  let corps;
  try {
    corps = await reponse.json();
  } catch {
    throw new Error(`réponse illisible de ${p.nom} (${reponse.status})`);
  }
  if (!reponse.ok) {
    if (reponse.status === 401 || reponse.status === 403) {
      throw new Error(
        `clé non activée pour ${p.nom} (${reponse.status}) — votre clé ne couvre pas encore ce produit. ` +
          `Activez-le ou prenez une clé d'essai gratuite (500 unités/mois, sans carte) sur ${URL_CLE}.`,
      );
    }
    throw new Error(corps?.error ? String(corps.error) : `${p.nom} a répondu ${reponse.status}`);
  }
  return corps;
}

// Un outil = un appel. Le handler renvoie le JSON de l'API en texte ; en cas
// d'erreur, le message sûr de l'API est remonté comme résultat d'outil (isError)
// plutôt que comme exception, pour que l'agent puisse le lire et se corriger.
function outil(fabrique) {
  return async (args) => {
    try {
      const donnees = await fabrique(args);
      return { content: [{ type: "text", text: JSON.stringify(donnees, null, 2) }] };
    } catch (e) {
      return { content: [{ type: "text", text: `Erreur : ${e.message}` }], isError: true };
    }
  };
}

// ------------------------------------------------------------------- le serveur

function construire() {
  const serveur = new McpServer({ name: "rankfabrik", version: "2.0.0" });

  // ---------------------------------------------------------------- Captions
  // Transcription YouTube. Produit historique du canal MCP ; noms d'outils
  // conservés (youtube_*) pour ne pas casser les configurations déjà publiées.

  serveur.registerTool(
    "youtube_inspect",
    {
      title: "Inspect a YouTube video",
      description:
        "Return a YouTube video's metadata and the list of available subtitle tracks WITHOUT downloading the transcript. Free, no billing. Use this first to check a video has captions (and in which languages) before calling youtube_transcribe. Accepts a full YouTube URL (any format) or a bare 11-character video id.",
      inputSchema: {
        video: z.string().describe("YouTube video URL (watch, youtu.be, embed, shorts, live) or 11-char id"),
      },
    },
    outil(({ video }) => appeler("captions", "/inspecter", { video })),
  );

  serveur.registerTool(
    "youtube_transcribe",
    {
      title: "Transcribe a YouTube video",
      description:
        "Get the full transcript of a YouTube video: complete text, timestamped segments, and optionally chapter-by-chapter text, SRT/VTT subtitle files, and salient verbatims with deep-links. Works on auto-generated captions (the majority of videos). Accepts a URL or bare id. Set segments=false for a lighter response. This is the billable product (1 unit when text is returned).",
      inputSchema: {
        video: z.string().describe("YouTube video URL or 11-char id"),
        langues: z
          .string()
          .optional()
          .describe("Preferred language order, comma-separated, e.g. 'fr,en'. Default 'fr,en'."),
        segments: z.boolean().optional().describe("Include timestamped segments. Default true."),
        chapitres: z.boolean().optional().describe("Include chapter-by-chapter text and deep-links. Default false."),
        formats: z
          .string()
          .optional()
          .describe("Subtitle export formats, comma-separated: 'srt', 'vtt', or 'srt,vtt'."),
        verbatims: z
          .number()
          .int()
          .optional()
          .describe("Number of salient verbatim passages to extract (each with a ?t= deep-link)."),
      },
    },
    outil(({ video, langues, segments, chapitres, formats, verbatims }) =>
      appeler("captions", "/transcrire", {
        video,
        langues,
        // La façade lit segments=0/false pour alléger ; par défaut on garde.
        segments: segments === false ? "0" : undefined,
        chapitres: chapitres ? "1" : undefined,
        formats,
        verbatims: verbatims && verbatims > 0 ? verbatims : undefined,
      }),
    ),
  );

  serveur.registerTool(
    "youtube_search",
    {
      title: "Search YouTube videos",
      description:
        "Search YouTube by a term and return matching video ids. Use this when you don't have a video id yet — feed the results into youtube_transcribe, or use youtube_harvest to search and transcribe in one call. Billed per returned id.",
      inputSchema: {
        terme: z.string().describe("Search term / query"),
        combien: z.number().int().optional().describe("How many video ids to return. Default 20."),
      },
    },
    outil(({ terme, combien }) => appeler("captions", "/chercher", { terme, combien })),
  );

  serveur.registerTool(
    "youtube_harvest",
    {
      title: "Harvest transcripts by topic",
      description:
        "Search YouTube for a topic and transcribe the matching videos in one call — the fast path for a themed corpus. Returns per-video transcripts plus completeness stats (how many carried human vs auto captions). Up to 30 videos. Billed per video actually transcribed.",
      inputSchema: {
        terme: z.string().describe("Topic / search term"),
        combien: z.number().int().optional().describe("How many videos to harvest (max 30). Default 10."),
        langues: z.string().optional().describe("Preferred language order, e.g. 'fr,en'. Default 'fr,en'."),
        chapitres: z.boolean().optional().describe("Include chapters per video. Default false."),
      },
    },
    outil(({ terme, combien, langues, chapitres }) =>
      appeler("captions", "/moisson", { terme, combien, langues, chapitres: chapitres ? "1" : undefined }),
    ),
  );

  serveur.registerTool(
    "youtube_transcribe_batch",
    {
      title: "Transcribe many YouTube videos",
      description:
        "Transcribe up to 50 YouTube videos in parallel from a list of ids or URLs. Returns per-video transcripts plus completeness stats. Use when you already have the ids; use youtube_harvest when you only have a topic. Billed per video actually transcribed.",
      inputSchema: {
        videos: z.array(z.string()).describe("List of YouTube URLs or 11-char ids (max 50)"),
        langues: z.string().optional().describe("Preferred language order, e.g. 'fr,en'. Default 'fr,en'."),
        segments: z.boolean().optional().describe("Include timestamped segments per video. Default false."),
        chapitres: z.boolean().optional().describe("Include chapters per video. Default false."),
      },
    },
    outil(({ videos, langues, segments, chapitres }) =>
      appeler("captions", "/lot", {
        videos: (videos || []).join(","),
        langues,
        segments: segments ? "1" : undefined,
        chapitres: chapitres ? "1" : undefined,
      }),
    ),
  );

  // ------------------------------------------------------------------ Places
  // Établissements (annuaire local géolocalisé). Localisation par ville connue
  // OU par latitude+longitude.

  serveur.registerTool(
    "places_search",
    {
      title: "Search local businesses (Places)",
      description:
        "Find local businesses / points of interest matching a term around a location. Location is given EITHER by a known city name OR by latitude+longitude (provide one or the other). Optionally enrich with public contact e-mails, opening hours / distribution and photos. Returns up to 20 places. Billed per returned place.",
      inputSchema: {
        terme: z.string().describe("What to look for, e.g. 'plombier', 'coffee shop', 'notaire'"),
        ville: z.string().optional().describe("Known city name (use this OR latitude+longitude)"),
        latitude: z.number().optional().describe("Latitude (with longitude, as an alternative to ville)"),
        longitude: z.number().optional().describe("Longitude (with latitude, as an alternative to ville)"),
        combien: z.number().int().optional().describe("How many places to return (max 20)."),
        emails: z.boolean().optional().describe("Enrich each place with public contact e-mails. Default false."),
        distribution: z.boolean().optional().describe("Include opening hours / distribution data. Default false."),
        photos: z.boolean().optional().describe("Include photos. Default false."),
      },
    },
    outil(({ terme, ville, latitude, longitude, combien, emails, distribution, photos }) =>
      appeler("places", "/rechercher", {
        terme,
        ville,
        latitude,
        longitude,
        combien,
        emails: emails ? "1" : undefined,
        distribution: distribution ? "1" : undefined,
        photos: photos ? "1" : undefined,
      }),
    ),
  );

  serveur.registerTool(
    "places_scan",
    {
      title: "Scan an area for local businesses (Places)",
      description:
        "Sweep a wider area for businesses matching a term by walking a grid of points around a location (city OR latitude+longitude). Deeper coverage than places_search. Billed per returned place.",
      inputSchema: {
        terme: z.string().describe("What to look for, e.g. 'restaurant', 'garage'"),
        ville: z.string().optional().describe("Known city name (use this OR latitude+longitude)"),
        latitude: z.number().optional().describe("Latitude (with longitude)"),
        longitude: z.number().optional().describe("Longitude (with latitude)"),
        pages: z.number().int().optional().describe("Depth per point, 1-20. Default 1."),
        rayonKm: z.number().optional().describe("Grid radius in km. Default 4."),
        pas: z.number().int().optional().describe("Grid step, 2-6. Default 3."),
      },
    },
    outil(({ terme, ville, latitude, longitude, pages, rayonKm, pas }) =>
      appeler("places", "/balayer", { terme, ville, latitude, longitude, pages, rayonKm, pas }),
    ),
  );

  serveur.registerTool(
    "places_cities",
    {
      title: "List known cities (Places)",
      description:
        "List the city names Places recognises for the `ville` parameter of places_search / places_scan. Free, no billing. Use this to pick a valid city, or fall back to latitude+longitude for anywhere else.",
      inputSchema: {},
    },
    outil(() => appeler("places", "/villes", {})),
  );

  // -------------------------------------------------------------------- Jobs
  // Offres d'emploi (agrégateur). Recherche par métier, éventuellement par lieu.

  serveur.registerTool(
    "jobs_search",
    {
      title: "Search job offers (Jobs)",
      description:
        "Search job offers by trade / role, optionally filtered by place. Returns matching offers (title, company, location, link). Billed per returned offer.",
      inputSchema: {
        metier: z.string().describe("Trade / role to search, e.g. 'développeur', 'infirmier', 'chef de projet'"),
        lieu: z.string().optional().describe("Place filter, e.g. a city or region. Default: all of France."),
        combien: z.number().int().optional().describe("How many offers to return."),
      },
    },
    outil(({ metier, lieu, combien }) => appeler("jobs", "/offres", { metier, lieu, combien })),
  );

  serveur.registerTool(
    "jobs_full",
    {
      title: "Search job offers with full detail (Jobs)",
      description:
        "Search job offers and return the full detail of each (complete description and, optionally, the hiring company's profile). Heavier than jobs_search. Billed per returned offer.",
      inputSchema: {
        metier: z.string().describe("Trade / role to search"),
        lieu: z.string().optional().describe("Place filter. Default: all of France."),
        combien: z.number().int().optional().describe("How many offers to return. Default 20."),
        avecSociete: z.boolean().optional().describe("Also resolve the hiring company's profile. Default false."),
      },
    },
    outil(({ metier, lieu, combien, avecSociete }) =>
      appeler("jobs", "/completes", { metier, lieu, voulu: combien, avecSociete: avecSociete ? "1" : undefined }),
    ),
  );

  serveur.registerTool(
    "jobs_company",
    {
      title: "Get a company's hiring profile (Jobs)",
      description:
        "Resolve a single company's public hiring profile by name or slug. Billed per returned company.",
      inputSchema: {
        societe: z.string().describe("Company name or slug, e.g. 'Decathlon'"),
      },
    },
    outil(({ societe }) => appeler("jobs", "/societe", { societe })),
  );

  // ------------------------------------------------------------------ Verify
  // Vérification d'adresses e-mail (syntaxe, domaine, MX, sondage SMTP).

  serveur.registerTool(
    "verify_email",
    {
      title: "Verify one e-mail address (Verify)",
      description:
        "Check whether a single e-mail address is deliverable: syntax, domain, MX records, and (by default) an SMTP probe. Returns a verdict and the signals behind it. Billed 1 unit per address.",
      inputSchema: {
        email: z.string().describe("The e-mail address to verify"),
        sonder: z.boolean().optional().describe("Perform the SMTP probe. Default true; set false for a lighter check."),
      },
    },
    outil(({ email, sonder }) =>
      appeler("verify", "/verifier", { email, sonder: sonder === false ? "0" : undefined }),
    ),
  );

  serveur.registerTool(
    "verify_emails",
    {
      title: "Verify many e-mail addresses (Verify)",
      description:
        "Verify a list of e-mail addresses at once (syntax, domain, MX, SMTP probe). Returns a verdict per address. Billed per address actually checked.",
      inputSchema: {
        emails: z.array(z.string()).describe("List of e-mail addresses to verify"),
        sonder: z.boolean().optional().describe("Perform the SMTP probe. Default true."),
      },
    },
    outil(({ emails, sonder }) =>
      appeler("verify", "/verifier-lot", {
        emails: (emails || []).join(","),
        sonder: sonder === false ? "0" : undefined,
      }),
    ),
  );

  return serveur;
}

// ---------------------------------------------------------------- démarrage

// Résumé lisible de la config des clés, pour la ligne de journal au démarrage.
function etatCles() {
  return Object.values(PRODUITS)
    .map((p) => `${p.nom}:${p.cle ? "✓" : "⚠"}`)
    .join(" ");
}

async function principal() {
  const transport = (process.env.MCP_TRANSPORT || "stdio").toLowerCase();

  if (transport === "http") {
    // Streamable HTTP sans état : un transport neuf par requête, le plus simple
    // à héberger et à mettre derrière un proxy TLS. Chaque POST /mcp est autonome.
    const port = Number(process.env.PORT) || 8090;
    const serveurHttp = http.createServer(async (requete, reponse) => {
      if (requete.url?.replace(/\/+$/, "") !== "/mcp") {
        reponse.writeHead(404).end();
        return;
      }
      const mcp = construire();
      const t = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      reponse.on("close", () => {
        t.close();
        mcp.close();
      });
      await mcp.connect(t);
      let corps;
      try {
        corps = await lireCorpsJson(requete);
      } catch {
        corps = undefined;
      }
      await t.handleRequest(requete, reponse, corps);
    });
    serveurHttp.listen(port, () => {
      console.error(`rankfabrik-mcp — Streamable HTTP sur http://localhost:${port}/mcp`);
      console.error(`  clés ${etatCles()}`);
    });
    return;
  }

  // stdio : le transport par défaut, celui des directories et des clients locaux.
  const mcp = construire();
  const t = new StdioServerTransport();
  await mcp.connect(t);
  console.error(`rankfabrik-mcp — stdio · 4 produits · clés ${etatCles()}`);
}

function lireCorpsJson(requete, maxOctets = 4_194_304) {
  return new Promise((resoudre, rejeter) => {
    let brut = "";
    let taille = 0;
    requete.on("data", (m) => {
      taille += m.length;
      if (taille > maxOctets) {
        requete.destroy();
        rejeter(new Error("corps trop volumineux"));
      } else brut += m;
    });
    requete.on("end", () => {
      if (!brut) return resoudre(undefined);
      try {
        resoudre(JSON.parse(brut));
      } catch {
        rejeter(new Error("corps JSON illisible"));
      }
    });
    requete.on("error", rejeter);
  });
}

principal().catch((e) => {
  console.error(`rankfabrik-mcp — arrêt : ${e.stack ?? e}`);
  process.exit(1);
});
