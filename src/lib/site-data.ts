export const featuredPosts = [
  {
    title: "První DX večer jarní sezóny",
    slug: "prvni-dx-vecer-jarni-sezony",
    category: "Provoz",
    publishedAt: "2026-04-12T19:30:00.000Z",
    excerpt:
      "Krátký zápis z večerního provozu na 20 m, ladění antény a podmínek, které nakonec přinesly čisté a překvapivě dlouhé spojení.",
    content: `Večerní provoz na 20 metrech začal spíš opatrně. Podmínky nevypadaly nijak výjimečně a první minuty spíš připomínaly běžné ladění stanice než něco, z čeho by mohl být zajímavý DX večer.

Postupně se ale ukázalo, že pásmo je živější, než to zpočátku vypadalo. Po menším doladění antény a trpělivém poslouchání se začaly objevovat čistší a stabilnější signály, které už stály za pokus.

Právě tyhle chvíle mě na radioamatérství baví nejvíc. Někdy rozhoduje drobnost, malé zlepšení v nastavení nebo ochota chvíli počkat, než se pásmo opravdu otevře.`,
  },
  {
    title: "Portable provoz nad městem",
    slug: "portable-provoz-nad-mestem",
    category: "Terén",
    publishedAt: "2026-04-05T10:15:00.000Z",
    excerpt:
      "Co fungovalo v terénu, co zpomalovalo setup a proč se vyplatí mít připravený lehký workflow pro zápis QSO.",
    content: `Portable provoz má svoje kouzlo právě v tom, že tě donutí přemýšlet jinak než doma. Najednou řešíš každý kabel, každou minutu přípravy i to, jak rychle zvládneš zapsat navázané spojení.

Největší rozdíl dělá jednoduchost. Když je vybavení lehké, přehledné a připravené dopředu, zůstane víc času i energie na samotný provoz.

Právě z těchto výjezdů si odnáším nejvíc praktických poznatků, které se pak hodí i zpátky u domácí stanice.`,
  },
  {
    title: "Jak číst locator data z ADIF",
    slug: "jak-cist-locator-data-z-adif",
    category: "Technika",
    publishedAt: "2026-03-29T14:00:00.000Z",
    excerpt:
      "Poznámky k tomu, jak z callsignů, locatorů a pásem postavit přehlednou veřejnou mapu i soukromý logbook.",
    content: `ADIF je skvělý formát právě tím, že v sobě nese víc než jen základní údaje o spojení. Pokud jsou v záznamu správně vyplněné lokátory, dá se z nich postavit nejen tabulka, ale i užitečná mapa provozu.

V praxi je potřeba počítat s tím, že některé exporty mají údaje neúplné nebo zapsané trochu jinak. O to důležitější je mít parser, který si poradí s běžnými variantami polí a umí z nich dostat rozumný výsledek.

Jakmile jsou data dobře připravená, propojení mapy a logbooku začne dávat smysl i pro běžný každodenní provoz.`,
  },
] as const;
