// Fonction serverless Vercel — proxy en lecture seule vers le flux RSS Google News
// (public, gratuit, sans clé). Nécessaire uniquement pour contourner le CORS du
// navigateur : Google News RSS n'envoie pas d'en-tête Access-Control-Allow-Origin,
// donc un fetch direct depuis le widget Actualités échouerait côté client.
//
// Appel : GET /api/news?category=sport
//         GET /api/news?category=local&q=Lyon   (catégorie "Local", ville détectée côté client)
//
// `category` doit être une des clés de CATEGORY_QUERIES ci-dessous ; `q` n'est utilisé
// que pour la catégorie "local" et est nettoyé (lettres/chiffres/espaces uniquement,
// 80 caractères max) avant d'être inséré dans l'URL Google News, qui reste toujours
// le seul hôte interrogé — pas de risque de SSRF via une URL arbitraire.
const CATEGORY_QUERIES = {
  une: null,
  france: "France",
  monde: "monde",
  sport: "sport",
  eco: "économie",
  tech: "technologie",
};

function decodeXml(s) {
  return s
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .trim();
}

export default async function handler(req, res) {
  const category = String(req.query.category || "une");
  const rawQ = String(req.query.q || "").slice(0, 80).replace(/[^\p{L}0-9 '-]/gu, "");
  const q = category === "local" ? rawQ : CATEGORY_QUERIES[category];

  if (category !== "local" && !(category in CATEGORY_QUERIES)) {
    res.status(400).json({ error: "Catégorie inconnue" });
    return;
  }
  if (category === "local" && !rawQ) {
    res.status(400).json({ error: "Paramètre q manquant pour la catégorie locale" });
    return;
  }

  const url = q
    ? `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=fr&gl=FR&ceid=FR:fr`
    : `https://news.google.com/rss?hl=fr&gl=FR&ceid=FR:fr`;

  try {
    const rssRes = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    const xml = await rssRes.text();
    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)]
      .slice(0, 12)
      .map((m) => {
        const block = m[1];
        const pick = (tag) => block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`))?.[1] || "";
        return { title: decodeXml(pick("title")), source: decodeXml(pick("source")), link: decodeXml(pick("link")) };
      })
      .filter((item) => item.title && item.link);

    res.setHeader("Cache-Control", "s-maxage=600, stale-while-revalidate");
    res.status(200).json({ items });
  } catch (e) {
    console.error("Erreur news :", e);
    res.status(502).json({ error: "Flux d'actualités indisponible." });
  }
}
