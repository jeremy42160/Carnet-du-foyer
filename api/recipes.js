// Fonction serverless Vercel — reçoit une photo (frigo, aliments), l'envoie à
// l'API Gemini (Google) pour qu'elle identifie les ingrédients visibles et
// propose 3 recettes réalisables à partir de ceux-ci, à des niveaux de
// préparation croissants (rapide, moyen, élaboré).
//
// Appel : POST /api/recipes  { "image": "data:image/jpeg;base64,...." }
//
// ⚠️ Nécessite la variable d'environnement GEMINI_API_KEY sur Vercel
// (Project Settings → Environment Variables, clé prise sur aistudio.google.com).
// Sans elle, la fonction répond clairement par une erreur plutôt que d'inventer
// des recettes.
const MAX_BASE64_LENGTH = 6_000_000; // ~4.5 Mo d'image, marge sous la limite de payload Vercel
const GEMINI_MODEL = "gemini-3.8-flash";

// L'analyse d'image + génération de recettes peut dépasser les 10s par défaut.
export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Méthode non autorisée" });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "Analyse non configurée sur le serveur (GEMINI_API_KEY manquante)." });
    return;
  }

  const image = req.body?.image;
  if (!image || typeof image !== "string") {
    res.status(400).json({ error: "Photo manquante." });
    return;
  }
  const match = image.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
  if (!match) {
    res.status(400).json({ error: "Format d'image invalide (jpeg, png ou webp attendu)." });
    return;
  }
  const [, mediaType, base64Data] = match;
  if (base64Data.length > MAX_BASE64_LENGTH) {
    res.status(413).json({ error: "Photo trop volumineuse." });
    return;
  }

  const prompt = `Tu regardes une photo d'un frigo ou d'aliments. Identifie les ingrédients
alimentaires visibles, puis propose exactement 3 recettes réalisables avec ces ingrédients
(en complétant si besoin avec des produits de base courants : sel, poivre, huile, eau, farine) :
une "rapide" (15 minutes maximum, peu d'étapes), une "moyen" (30 à 40 minutes), une "elabore"
(plus technique ou plus longue, présentation soignée). Réponds UNIQUEMENT avec un objet JSON
valide, sans texte autour, sans balises markdown, exactement dans cette forme :
{"ingredients": ["..."], "recipes": [
  {"niveau": "rapide", "titre": "...", "duree": "...", "ingredients": ["..."], "etapes": ["...", "..."]},
  {"niveau": "moyen", "titre": "...", "duree": "...", "ingredients": ["..."], "etapes": ["...", "..."]},
  {"niveau": "elabore", "titre": "...", "duree": "...", "ingredients": ["..."], "etapes": ["...", "..."]}
]}`;

  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { inline_data: { mime_type: mediaType, data: base64Data } },
                { text: prompt },
              ],
            },
          ],
          generationConfig: { responseMimeType: "application/json" },
        }),
      }
    );

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error("Erreur API Gemini :", geminiRes.status, errText);
      res.status(502).json({ error: "Analyse indisponible pour le moment." });
      return;
    }

    const data = await geminiRes.json();
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("Réponse inattendue de Gemini :", JSON.stringify(data).slice(0, 500));
      res.status(502).json({ error: "Réponse inattendue de l'analyse." });
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      res.status(502).json({ error: "Réponse inattendue de l'analyse." });
      return;
    }

    res.status(200).json({
      ingredients: Array.isArray(parsed.ingredients) ? parsed.ingredients : [],
      recipes: Array.isArray(parsed.recipes) ? parsed.recipes : [],
    });
  } catch (e) {
    console.error("Erreur recipes :", e);
    res.status(500).json({ error: "Erreur lors de l'analyse de la photo." });
  }
}
