// ─── GLYCEMIC INDEX REFERENCE DATABASE ──────────────────────────────────────
// Representative published GI values (glucose = 100) for common foods, drawn
// from the international GI tables (Atkinson/Foster-Powell/Brand-Miller). These
// are population-average lab values — real foods vary by ripeness, processing,
// and the person — so they feed an ESTIMATE, never a measured blood-glucose claim.
//
// Ordered SPECIFIC → GENERIC. The matcher consumes matched text as it goes, so
// "brown rice" is scored before the generic "rice" can catch the leftovers, and
// "sweet potato" before "potato".

export const GI_DB = [
  // ── rice (specific first) ──
  { re: /sweet potato fr/, gi: 63 },
  { re: /fried rice/, gi: 75 },
  { re: /brown rice/, gi: 68 },
  { re: /basmati/, gi: 58 },
  { re: /jasmine rice/, gi: 89 },
  { re: /(sticky|glutinous) rice/, gi: 86 },
  { re: /wild rice/, gi: 57 },
  { re: /rice noodle/, gi: 53 },
  { re: /rice cake/, gi: 82 },
  { re: /rice krispies/, gi: 82 },
  // ── bread ──
  { re: /(whole ?wheat|wholemeal|whole ?grain|multigrain) bread/, gi: 74 },
  { re: /white bread/, gi: 75 },
  { re: /sourdough/, gi: 54 },
  { re: /rye bread|pumpernickel/, gi: 56 },
  { re: /garlic bread/, gi: 70 },
  { re: /\bnaan\b/, gi: 71 },
  { re: /\bpita\b/, gi: 57 },
  { re: /baguette|french bread/, gi: 95 },
  { re: /\bbagel/, gi: 69 },
  { re: /corn tortilla/, gi: 46 },
  { re: /tortilla|wrap\b/, gi: 30 },
  // ── breakfast cereals / oats ──
  { re: /steel ?cut oat/, gi: 52 },
  { re: /instant oat|quick oat/, gi: 79 },
  { re: /(rolled )?oat|oatmeal|porridge|overnight oat/, gi: 55 },
  { re: /corn ?flakes/, gi: 81 },
  { re: /bran flakes|all.?bran/, gi: 74 },
  { re: /weetabix/, gi: 74 },
  { re: /muesli/, gi: 57 },
  { re: /granola/, gi: 55 },
  { re: /\bcereal/, gi: 74 },
  // ── pasta / noodles ──
  { re: /(whole ?wheat|wholemeal) pasta/, gi: 42 },
  { re: /spaghetti|pasta|penne|macaroni|fusilli|linguine/, gi: 49 },
  { re: /lasagna|lasagne/, gi: 50 },
  { re: /instant noodle|ramen/, gi: 47 },
  { re: /udon|noodle/, gi: 55 },
  // ── potato ──
  { re: /sweet potato|yam\b/, gi: 63 },
  { re: /mashed potato/, gi: 87 },
  { re: /baked potato|jacket potato/, gi: 85 },
  { re: /(french )?fries|chips\b/, gi: 75 },
  { re: /potato (chip|crisp)|crisps/, gi: 56 },
  { re: /\bpotato/, gi: 78 },
  // ── grains ──
  { re: /quinoa/, gi: 53 },
  { re: /barley/, gi: 28 },
  { re: /bulgur/, gi: 48 },
  { re: /couscous/, gi: 65 },
  { re: /millet/, gi: 71 },
  { re: /buckwheat/, gi: 45 },
  { re: /polenta|cornmeal/, gi: 68 },
  { re: /popcorn/, gi: 65 },
  { re: /sweet ?corn|\bcorn\b/, gi: 52 },
  // ── legumes ──
  { re: /baked beans/, gi: 40 },
  { re: /kidney bean/, gi: 24 },
  { re: /black bean/, gi: 30 },
  { re: /pinto bean/, gi: 39 },
  { re: /chick ?pea|garbanzo/, gi: 28 },
  { re: /hummus/, gi: 6 },
  { re: /lentil|dal\b|daal/, gi: 32 },
  { re: /soy ?bean|soya|edamame/, gi: 18 },
  { re: /\bbean/, gi: 30 },
  { re: /\bpeas\b/, gi: 51 },
  // ── fruit ──
  { re: /watermelon/, gi: 76 },
  { re: /pineapple/, gi: 59 },
  { re: /\bmango/, gi: 51 },
  { re: /banana/, gi: 51 },
  { re: /\bapple\b/, gi: 36 },
  { re: /\borange\b/, gi: 43 },
  { re: /grapefruit/, gi: 25 },
  { re: /grape/, gi: 46 },
  { re: /strawberr/, gi: 41 },
  { re: /blueberr/, gi: 53 },
  { re: /raspberr|blackberr/, gi: 32 },
  { re: /cherr/, gi: 20 },
  { re: /peach|nectarine/, gi: 42 },
  { re: /\bpear\b/, gi: 38 },
  { re: /\bplum/, gi: 24 },
  { re: /kiwi/, gi: 50 },
  { re: /melon|cantaloupe/, gi: 65 },
  { re: /dried apricot/, gi: 30 },
  { re: /apricot/, gi: 34 },
  { re: /raisin/, gi: 64 },
  { re: /\bdate\b|dates|medjool/, gi: 55 },
  // ── dairy ──
  { re: /greek yog/, gi: 11 },
  { re: /yog(h)?urt/, gi: 36 },
  { re: /chocolate milk/, gi: 42 },
  { re: /(skim|skimmed|low.?fat) milk/, gi: 32 },
  { re: /\bmilk\b/, gi: 31 },
  { re: /ice ?cream/, gi: 51 },
  // ── sweets / drinks ──
  { re: /dark chocolate/, gi: 23 },
  { re: /chocolate|nutella/, gi: 40 },
  { re: /\bhoney\b/, gi: 58 },
  { re: /maple syrup/, gi: 54 },
  { re: /agave/, gi: 15 },
  { re: /\bsugar\b/, gi: 65 },
  { re: /\bjam\b|jelly|marmalade/, gi: 50 },
  { re: /cola|soda|soft drink|pepsi|coke\b|sprite|fanta/, gi: 63 },
  { re: /gatorade|powerade|sports drink/, gi: 78 },
  { re: /energy drink|red bull|monster/, gi: 70 },
  { re: /(orange|apple|grape|cranberry) juice/, gi: 46 },
  { re: /\bjuice\b/, gi: 50 },
  { re: /smoothie/, gi: 55 },
  // ── baked goods / snacks ──
  { re: /croissant/, gi: 67 },
  { re: /donut|doughnut/, gi: 76 },
  { re: /muffin/, gi: 60 },
  { re: /pancake|waffle/, gi: 67 },
  { re: /pretzel/, gi: 83 },
  { re: /cracker|crispbread/, gi: 70 },
  { re: /cookie|biscuit/, gi: 55 },
  { re: /\bcake\b/, gi: 60 },
  { re: /pastry|croissant|danish/, gi: 59 },
  { re: /\bpizza/, gi: 36 },
  // ── veg with notable carbs ──
  { re: /pumpkin|squash/, gi: 75 },
  { re: /beet(root)?/, gi: 64 },
  { re: /parsnip/, gi: 52 },
  { re: /\bcarrot/, gi: 39 },
  // ── low-carb proteins/fats (rarely contribute, but anchor "low") ──
  { re: /peanut|almond|cashew|walnut|pistachio|\bnuts?\b/, gi: 15 },
  { re: /\btofu\b|tempeh/, gi: 15 },
  // ── generic grains last ──
  { re: /\brice\b/, gi: 73 },
  { re: /\bbread\b|toast/, gi: 73 },
];

// Look up a GI for a free-text food name. Returns null if nothing matches.
// Consumes matched substrings so generic patterns don't double-count specifics.
export function lookupGI(rawName) {
  let s = " " + String(rawName || "").toLowerCase() + " ";
  const hits = [];
  for (const e of GI_DB) {
    if (e.re.test(s)) {
      hits.push(e.gi);
      s = s.replace(e.re, " ");
    }
  }
  if (!hits.length) return null;
  const gi = Math.round(hits.reduce((a, b) => a + b, 0) / hits.length);
  return { gi, matches: hits.length };
}
