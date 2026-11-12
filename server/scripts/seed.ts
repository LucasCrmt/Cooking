// Fills a development database with a handful of recipes.
//   npm run seed    → user "demo" (set DEV_LOGIN_USER=demo to sign in as it locally) and its cookbook.

import { migrate, sql } from "../src/db.ts";

const USER = "demo";

const recipes = [
  {
    title: "Quiche aux poireaux et au chèvre",
    description: "Une quiche fondante, douce grâce aux poireaux et relevée par le chèvre frais.",
    category: "Plat principal",
    cuisine: "Française",
    tags: ["végétarien", "tarte", "automne"],
    servings: 6,
    servingsLabel: "personnes",
    prepMinutes: 20,
    cookMinutes: 40,
    ingredients: [
      "1 pâte brisée",
      "3 poireaux",
      "150 g de chèvre frais",
      "3 œufs",
      "20 cl de crème fraîche",
      "10 cl de lait",
      "1 noix de beurre",
      "1 pincée de muscade",
      "sel, poivre",
    ],
    steps: [
      "Préchauffer le four à 180 °C. Foncer un moule à tarte avec la pâte et la piquer à la fourchette.",
      "Émincer les poireaux et les faire fondre 15 minutes au beurre, à feu doux, avec une pincée de sel.",
      "Battre les œufs avec la crème, le lait et la muscade. Saler et poivrer.",
      "Répartir les poireaux sur la pâte, émietter le chèvre par-dessus et verser l'appareil.",
      "Enfourner 35 à 40 minutes, jusqu'à ce que la quiche soit dorée et prise au centre.",
    ],
    notes: "Encore meilleure tiède, avec une salade verte.",
    sources: [{ url: null, name: "Le carnet de mamie", kind: "other" }],
  },
  {
    title: "Poulet rôti au citron et au thym",
    description: "Le poulet du dimanche, peau croustillante et jus parfumé.",
    category: "Plat principal",
    cuisine: "Française",
    tags: ["four", "dimanche"],
    servings: 4,
    servingsLabel: "personnes",
    prepMinutes: 15,
    cookMinutes: 75,
    ingredients: [
      "1 poulet fermier de 1,6 kg",
      "2 citrons",
      "1 tête d'ail",
      "6 branches de thym",
      "40 g de beurre mou",
      "800 g de pommes de terre grenaille",
      "2 c. à soupe d'huile d'olive",
      "sel, poivre",
    ],
    steps: [
      "Sortir le poulet du réfrigérateur 30 minutes avant. Préchauffer le four à 210 °C.",
      "# Le poulet",
      "Glisser du beurre mélangé au thym sous la peau des blancs. Saler et poivrer généreusement.",
      "Placer un citron coupé en quatre et quelques gousses d'ail dans la cavité.",
      "# La cuisson",
      "Disposer le poulet dans un plat avec les pommes de terre, l'ail restant et l'huile d'olive.",
      "Enfourner 1 h 15 en arrosant toutes les 20 minutes. Le jus doit être clair en piquant la cuisse.",
      "Laisser reposer 10 minutes sous une feuille d'aluminium avant de découper. Arroser du jus du second citron.",
    ],
    notes: "",
  },
  {
    title: "Mousse au chocolat",
    description: "Trois ingrédients, une nuit au frais, et c'est tout.",
    category: "Dessert",
    cuisine: "Française",
    tags: ["chocolat", "sans cuisson", "rapide"],
    servings: 6,
    servingsLabel: "ramequins",
    prepMinutes: 20,
    cookMinutes: 0,
    ingredients: ["200 g de chocolat noir à 70 %", "6 œufs", "1 pincée de sel", "30 g de sucre"],
    steps: [
      "Faire fondre le chocolat au bain-marie, puis le laisser tiédir.",
      "Séparer les blancs des jaunes. Incorporer les jaunes un à un au chocolat.",
      "Monter les blancs en neige avec le sel ; quand ils moussent, ajouter le sucre et serrer.",
      "Incorporer un tiers des blancs vigoureusement, puis le reste délicatement, à la maryse.",
      "Répartir en ramequins et laisser prendre au moins 4 heures au réfrigérateur.",
    ],
    notes: "",
  },
  {
    title: "Velouté de potimarron",
    description: "Doux, orange et réconfortant, prêt en une demi-heure.",
    category: "Entrée",
    cuisine: "Française",
    tags: ["soupe", "végétarien", "automne"],
    servings: 4,
    servingsLabel: "bols",
    prepMinutes: 10,
    cookMinutes: 25,
    ingredients: ["1 potimarron (environ 1 kg)", "1 oignon", "2 pommes de terre", "1 l de bouillon de légumes", "10 cl de crème liquide", "1 c. à soupe d'huile d'olive", "sel, poivre"],
    steps: [
      "Laver le potimarron (inutile de l'éplucher), l'épépiner et le couper en cubes.",
      "Faire revenir l'oignon émincé dans l'huile, ajouter le potimarron et les pommes de terre en dés.",
      "Couvrir de bouillon et cuire 25 minutes à frémissement.",
      "Mixer finement avec la crème. Rectifier l'assaisonnement.",
    ],
    notes: "Quelques graines de courge torréfiées et un filet d'huile de noisette au service.",
  },
  {
    title: "Pâtes au pesto de roquette",
    description: "Un pesto plus poivré que le classique, pour un dîner en 15 minutes.",
    category: "Plat principal",
    cuisine: "Italienne",
    tags: ["rapide", "végétarien", "pâtes"],
    servings: 2,
    servingsLabel: "personnes",
    prepMinutes: 5,
    cookMinutes: 10,
    ingredients: ["200 g de spaghetti", "60 g de roquette", "30 g de parmesan", "30 g de pignons de pin", "1 gousse d'ail", "8 cl d'huile d'olive", "½ citron"],
    steps: [
      "Cuire les pâtes dans une grande casserole d'eau bouillante salée.",
      "Torréfier les pignons à sec. Mixer avec la roquette, l'ail, le parmesan, l'huile et le jus de citron.",
      "Égoutter les pâtes en gardant une louche d'eau de cuisson ; mélanger avec le pesto en détendant avec l'eau.",
    ],
    notes: "",
  },
  {
    title: "Crêpes",
    description: "La pâte de base, sans repos obligatoire.",
    category: "Dessert",
    cuisine: "Bretonne",
    tags: ["goûter", "chandeleur"],
    servings: 15,
    servingsLabel: "crêpes",
    prepMinutes: 10,
    cookMinutes: 30,
    ingredients: ["250 g de farine", "4 œufs", "50 cl de lait", "1 pincée de sel", "2 c. à soupe de sucre", "50 g de beurre fondu"],
    steps: [
      "Mettre la farine, le sel et le sucre dans un saladier ; creuser un puits.",
      "Ajouter les œufs puis le lait petit à petit en fouettant pour éviter les grumeaux.",
      "Incorporer le beurre fondu.",
      "Cuire dans une poêle chaude légèrement beurrée, environ 1 minute de chaque côté.",
    ],
    notes: "Une heure de repos rend les crêpes plus souples, si on a le temps.",
    sources: [
      { url: null, name: "Le carnet de mamie", kind: "other" },
      { url: "https://www.youtube.com/watch?v=example", name: "YouTube", kind: "youtube" },
    ],
  },
  {
    title: "Shakshuka",
    description: "Des œufs pochés dans une sauce tomate aux poivrons et au cumin.",
    category: "Plat principal",
    cuisine: "Moyen-Orient",
    tags: ["œufs", "végétarien", "brunch"],
    servings: 2,
    servingsLabel: "personnes",
    prepMinutes: 10,
    cookMinutes: 25,
    ingredients: ["4 œufs", "1 poivron rouge", "1 oignon", "2 gousses d'ail", "400 g de tomates concassées", "1 c. à café de cumin", "1 c. à café de paprika", "coriandre fraîche", "sel, poivre"],
    steps: [
      "Faire revenir l'oignon et le poivron émincés dans une poêle huilée, 8 minutes.",
      "Ajouter l'ail et les épices, puis les tomates. Laisser compoter 10 minutes.",
      "Creuser quatre puits, y casser les œufs, couvrir et cuire 6 à 8 minutes : les blancs doivent être pris.",
      "Parsemer de coriandre et servir avec du pain.",
    ],
    notes: "",
  },
  {
    title: "Cookies aux pépites de chocolat",
    description: "Croustillants autour, moelleux au cœur.",
    category: "Dessert",
    cuisine: "Américaine",
    tags: ["chocolat", "goûter", "biscuits"],
    servings: 16,
    servingsLabel: "cookies",
    prepMinutes: 15,
    cookMinutes: 12,
    ingredients: ["125 g de beurre mou", "100 g de sucre roux", "50 g de sucre blanc", "1 œuf", "220 g de farine", "½ sachet de levure chimique", "1 pincée de sel", "150 g de pépites de chocolat"],
    steps: [
      "Préchauffer le four à 180 °C.",
      "Crémer le beurre avec les sucres, puis ajouter l'œuf.",
      "Incorporer la farine, la levure et le sel, puis les pépites.",
      "Former des boules, les espacer sur une plaque et cuire 10 à 12 minutes : le centre doit rester mou.",
    ],
    notes: "",
  },
];

await migrate();
const [existing] = await sql`SELECT 1 FROM users WHERE id = ${USER}`;
if (!existing) await sql`INSERT INTO users (id, name, email, is_admin) VALUES (${USER}, 'Demo', 'demo@example.com', true)`;
await sql`DELETE FROM recipes WHERE user_id = ${USER}`;

for (const [i, r] of recipes.entries()) {
  const { prepMinutes, cookMinutes } = r;
  const [{ id }] = await sql<{ id: string }[]>`
    INSERT INTO recipes ${sql({
      ...r,
      sources: sql.json(("sources" in r ? r.sources : []) as never),
      totalMinutes: prepMinutes + cookMinutes,
      userId: USER,
      createdAt: new Date(Date.now() - (recipes.length - i) * 3 * 86_400_000),
    })} RETURNING id`;
  if (i % 3 === 0) await sql`INSERT INTO favorites (user_id, recipe_id) VALUES (${USER}, ${id})`;
  if (i % 2 === 0) await sql`INSERT INTO ratings (user_id, recipe_id, stars) VALUES (${USER}, ${id}, ${4 + (i % 4 === 0 ? 1 : 0)})`;
  if (i < 4) await sql`INSERT INTO cooked (user_id, recipe_id, cooked_at) VALUES (${USER}, ${id}, ${new Date(Date.now() - i * 5 * 86_400_000)})`;
}

console.log(`Seeded ${recipes.length} recipes for "${USER}". Sign in locally with DEV_LOGIN_USER=${USER}.`);
await sql.end();
