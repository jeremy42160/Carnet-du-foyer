// Fonction serverless Vercel — proxy en lecture seule vers TheSportsDB (API
// gratuite). Nécessaire pour contourner le CORS du navigateur : TheSportsDB
// n'envoie pas d'en-tête Access-Control-Allow-Origin, donc un fetch direct
// depuis les widgets Sport échouerait côté client (voir api/news.js pour le
// même principe appliqué au flux RSS Google News).
//
// Appel : GET /api/sports?name=Marseille&country=France
// Renvoie { found: false } si aucun club ne correspond, ou
// { found: true, results: [...5 derniers résultats ou null], rank: number|null }.
//
// Les surnoms affichés dans l'app ("OM", "Stade Rennais"...) ne correspondent
// pas toujours au nom attendu par TheSportsDB (qui indexe les clubs français
// sous leur nom de ville simple) — cet alias ne sert qu'à la recherche.
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
const SEASON = "2026-2027";

export default async function handler(req, res) {
  const name = String(req.query.name || "").slice(0, 80);
  const country = String(req.query.country || "");
  if (!name) {
    res.status(400).json({ error: "Paramètre name manquant" });
    return;
  }

  try {
    const searchName = TEAM_SEARCH_ALIASES[name] || name;
    const searchRes = await fetch(`https://www.thesportsdb.com/api/v1/json/3/searchteams.php?t=${encodeURIComponent(searchName)}`);
    const searchJson = await searchRes.json();
    const teams = searchJson.teams || [];
    if (!teams.length) {
      res.status(200).json({ found: false });
      return;
    }
    const wanted = COUNTRY_API_NAMES[country];
    const team = (wanted && teams.find((t) => t.strCountry === wanted)) || teams[0];

    const [lastRes, tableRes] = await Promise.all([
      fetch(`https://www.thesportsdb.com/api/v1/json/3/eventslast.php?id=${team.idTeam}`),
      team.idLeague
        ? fetch(`https://www.thesportsdb.com/api/v1/json/3/lookuptable.php?l=${team.idLeague}&s=${SEASON}`)
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

    res.setHeader("Cache-Control", "s-maxage=1800, stale-while-revalidate");
    res.status(200).json({ found: true, results, rank });
  } catch (e) {
    console.error("Erreur sports :", e);
    res.status(502).json({ error: "Données sportives indisponibles." });
  }
}
