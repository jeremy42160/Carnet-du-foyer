// Fonction serverless Vercel — proxy en lecture seule pour le widget Sport,
// nécessaire pour contourner le CORS du navigateur (ni TheSportsDB ni
// API-Football n'envoient d'en-tête Access-Control-Allow-Origin, un fetch
// direct depuis le widget échouerait côté client — même principe que
// api/news.js pour le flux RSS Google News).
//
// Appel : GET /api/sports?name=Marseille&country=France&sport=Football
// Renvoie { found: false } si aucun club ne correspond, ou
// { found: true, results: [...5 derniers résultats ou null], rank: number|null }.
//
// Le football utilise l'API-Football du compte de l'utilisateur (plus fiable,
// classement + résultats officiels) quand la variable d'environnement Vercel
// API_FOOTBALL_KEY est configurée ; sinon (ou pour les autres sports :
// basketball, rugby, handball, volleyball...) on retombe sur TheSportsDB,
// moins complet mais gratuit sans compte.
const SEASON_YEAR = 2026; // saison 2026-2027 : API-Football désigne une saison par son année de début

// Les surnoms affichés dans l'app ("OM", "Stade Rennais"...) ne correspondent
// pas toujours au nom attendu par ces API — cet alias ne sert qu'à la
// recherche, jamais à l'affichage (voir SportContentBlock côté client).
const TEAM_SEARCH_ALIASES = {
  "Paris SG": "Paris Saint Germain",
  "OM": "Marseille",
  "OL": "Lyon",
  "AS Monaco": "Monaco",
  "LOSC": "Lille OSC",
  "Stade Rennais": "Rennes",
  "OGC Nice": "Nice",
  "RC Lens": "Lens",
  "RC Strasbourg": "Strasbourg",
  "Stade Brestois": "Brest",
  "Toulouse FC": "Toulouse",
  "FC Lorient": "Lorient",
  "Le Havre AC": "Le Havre",
  "AJ Auxerre": "Auxerre",
  "Angers SCO": "Angers",
  "ESTAC Troyes": "Troyes",
  "Le Mans FC": "Le Mans",
  "FC Annecy": "Annecy",
  "US Boulogne": "Boulogne",
  "Dijon FCO": "Dijon",
  "USL Dunkerque": "Dunkerque",
  "Grenoble Foot 38": "Grenoble",
  "EA Guingamp": "Guingamp",
  "Stade Lavallois": "Laval",
  "FC Metz": "Metz",
  "Montpellier HSC": "Montpellier",
  "AS Nancy Lorraine": "Nancy",
  "FC Nantes": "Nantes",
  "Red Star FC": "Red Star",
  "Stade de Reims": "Reims",
  "Rodez AF": "Rodez",
  "AS Saint-Étienne": "Saint-Etienne",
  "FC Sochaux-Montbéliard": "Sochaux",
  "PSG Handball": "Paris Saint-Germain Handball",
};
const COUNTRY_API_NAMES = { France: "France", Angleterre: "England", Espagne: "Spain", Italie: "Italy", "États-Unis": "USA" };

async function apiFootball(path, apiKey) {
  const res = await fetch(`https://v3.football.api-sports.io${path}`, {
    headers: { "x-apisports-key": apiKey },
  });
  if (!res.ok) throw new Error(`API-Football ${res.status}`);
  return res.json();
}

async function fetchFromApiFootball(name, country, apiKey) {
  const searchName = TEAM_SEARCH_ALIASES[name] || name;
  const searchJson = await apiFootball(`/teams?search=${encodeURIComponent(searchName)}`, apiKey);
  const teams = searchJson.response || [];
  if (!teams.length) return { found: false };
  const wanted = COUNTRY_API_NAMES[country];
  const match = (wanted && teams.find((t) => t.team?.country === wanted)) || teams[0];
  const teamId = match.team?.id;
  if (!teamId) return { found: false };

  const [standingsJson, fixturesJson] = await Promise.all([
    apiFootball(`/standings?team=${teamId}&season=${SEASON_YEAR}`, apiKey).catch(() => null),
    apiFootball(`/fixtures?team=${teamId}&last=5`, apiKey).catch(() => null),
  ]);

  let rank = null;
  const groups = standingsJson?.response?.[0]?.league?.standings || [];
  for (const group of groups) {
    const row = group.find((r) => r.team?.id === teamId);
    if (row) { rank = row.rank; break; }
  }

  const events = fixturesJson?.response || [];
  const results = events.length
    ? events.map((e) => {
        const isHome = e.teams?.home?.id === teamId;
        return {
          opponent: (isHome ? e.teams?.away?.name : e.teams?.home?.name) || "?",
          scoreFor: (isHome ? e.goals?.home : e.goals?.away) ?? 0,
          scoreAgainst: (isHome ? e.goals?.away : e.goals?.home) ?? 0,
          date: e.fixture?.date,
        };
      })
    : null;

  return { found: true, results, rank };
}

async function fetchFromTheSportsDb(name, country) {
  const searchName = TEAM_SEARCH_ALIASES[name] || name;
  const searchRes = await fetch(`https://www.thesportsdb.com/api/v1/json/3/searchteams.php?t=${encodeURIComponent(searchName)}`);
  const searchJson = await searchRes.json();
  const teams = searchJson.teams || [];
  if (!teams.length) return { found: false };
  const wanted = COUNTRY_API_NAMES[country];
  const team = (wanted && teams.find((t) => t.strCountry === wanted)) || teams[0];

  const [lastRes, tableRes] = await Promise.all([
    fetch(`https://www.thesportsdb.com/api/v1/json/3/eventslast.php?id=${team.idTeam}`),
    team.idLeague
      ? fetch(`https://www.thesportsdb.com/api/v1/json/3/lookuptable.php?l=${team.idLeague}&s=2026-2027`)
      : Promise.resolve(null),
  ]);
  const lastJson = await lastRes.json();
  const events = lastJson.results || [];
  const results = events.length
    ? events.map((e) => {
        const isHome = e.idHomeTeam === team.idTeam;
        return {
          opponent: isHome ? e.strAwayTeam : e.strHomeTeam,
          scoreFor: Number(isHome ? e.intHomeScore : e.intAwayScore),
          scoreAgainst: Number(isHome ? e.intAwayScore : e.intHomeScore),
          date: e.dateEvent,
        };
      })
    : null;

  let rank = null;
  if (tableRes) {
    const tableJson = await tableRes.json();
    const row = (tableJson.table || []).find((r) => r.idTeam === team.idTeam);
    rank = row ? Number(row.intRank) : null;
  }
  return { found: true, results, rank };
}

export default async function handler(req, res) {
  const name = String(req.query.name || "").slice(0, 80);
  const country = String(req.query.country || "");
  const sport = String(req.query.sport || "");
  if (!name) {
    res.status(400).json({ error: "Paramètre name manquant" });
    return;
  }

  const apiFootballKey = process.env.API_FOOTBALL_KEY;

  try {
    let data;
    if (sport === "Football" && apiFootballKey) {
      try {
        data = await fetchFromApiFootball(name, country, apiFootballKey);
      } catch (e) {
        console.error("Erreur API-Football, repli sur TheSportsDB :", e);
        data = await fetchFromTheSportsDb(name, country);
      }
    } else {
      data = await fetchFromTheSportsDb(name, country);
    }

    res.setHeader("Cache-Control", "s-maxage=1800, stale-while-revalidate");
    res.status(200).json(data);
  } catch (e) {
    console.error("Erreur sports :", e);
    res.status(502).json({ error: "Données sportives indisponibles." });
  }
}
