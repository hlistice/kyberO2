# Detektiv obrazů: Skutečnost, nebo AI?

Vzdělávací hra pro žáky 2. stupně ZŠ. Na černém důkazním stole zkoumají obrázek, v chatu obhajují svůj tip a od AI vyšetřovatele dostávají krátkou zpětnou vazbu ke konkrétním vizuálním detailům.

## Spuštění

Potřebuješ **Node.js 22.9 nebo novější** a API klíč k účtu s dostupným vision modelem. Žádné balíčky není potřeba instalovat.

```sh
git clone https://github.com/hlistice/kyberO2.git
cd kyberO2
cp .env.example .env
```

Do `.env` vlož svůj `OPENAI_API_KEY`. Potom spusť:

```sh
npm start
```

Otevři **http://127.0.0.1:3000**. Klíč patří pouze na server, nikdy do `index.html`, `app.js` nebo veřejného repozitáře. `.env` je v `.gitignore`. Pro vývoj s automatickým restartem slouží `npm run dev`.

Bez klíče funguje rozhraní, nahrávání a zkoumání obrázku; vyhodnocení je vypnuté a aplikace to oznámí. Nezobrazuje předstírané AI výsledky. Po doplnění klíče restartuj server a klikni na stav připojení nahoře.

## Jak hrát

1. Nahraj jeden JPG, PNG nebo WEBP do 10 MB pomocí tlačítka nebo přetažení.
2. Prohlédni si obrázek; tlačítkem **Zvětšit detail** zobrazíš dvojnásobné zvětšení s posouváním.
3. Napiš tip i konkrétní důvod. Tlačítka **Skutečná fotka / Vytvořeno AI** jsou volitelná: model umí přečíst tip i ze zprávy. Enter odešle, Shift + Enter vloží nový řádek.
4. Až po odeslání odejde obrázek spolu s odpovědí na AI API. Při samotném nahrávání se původ nevyhodnocuje a neprozrazuje.
5. Vyšetřovatel odpoví nejvýše ve třech krátkých odstavcích. Skóre se aktualizuje a vyzve k dalšímu obrázku.

Skóre i chat platí pro právě otevřenou hru. Obnovení stránky nebo **Nové vyšetřování** je vymaže. Každý případ se v rozhraní oboduje jednou; neúspěšné spojení body nepřiděluje a ponechá odpověď pro opakování.

## Ověřený původ a férové bodování

Vision model **nedokáže ze samotných pixelů spolehlivě potvrdit skutečný původ libovolného obrázku**. Zrnitost, správný počet prstů či podivný stín nejsou jistý důkaz. Proto hra nabízí dvě možnosti:

| Příprava obrázku | Bod za tip | Bod za argument |
| --- | --- | --- |
| Učitel zadal ověřený původ a zdroj | 1 při shodě s ověřeným původem | 1 za konkrétní a smysluplný postřeh |
| Původ není známý | Nepřiděluje se; závěr AI je výslovně odhad | 1 za konkrétní a smysluplný postřeh |

Při přípravě na společném zařízení otevři pod důkazním stolem **Příprava případu pro učitele**, vyber původ a uveď zdroj (např. vlastní fotografie nebo konkrétní použitý generátor). Pak nahraj příslušný obrázek. Karta se zavře, nastavení pro další případ se vyčistí a původ se v chatu odhalí až při hodnocení.

Tato karta není přihlášením ani ochranou před podváděním. Je určená pro společnou výuku nebo samostatný trénink. Učitelská tvrzení model sám neověřuje. Pro hodnocený test s odděleným účtem učitele by bylo potřeba doplnit přihlášení a databázi učitelem připravených případů.

Smysluplný argument může bod získat i při chybném tipu. Body počítá server podle pravidel, model nemůže přidělit libovolné skóre. Při nejasném tipu si hra vyžádá upřesnění.

## API a hostování

Server volá OpenAI-kompatibilní **Chat Completions API** s obrazovým vstupem a přísným JSON schématem. Výchozí model je `gpt-4.1-mini`; mění se přes `OPENAI_MODEL`. `OPENAI_BASE_URL` umožňuje jiného kompatibilního poskytovatele, který musí podporovat obrazové vstupy i `response_format: json_schema`. Pro vzdálené poskytovatele je vyžadováno HTTPS.

| Endpoint | Účel |
| --- | --- |
| `GET /api/config` | Vrací jen informaci, zda je nastavený API klíč; neověřuje účet u poskytovatele a nevrací klíč. |
| `POST /api/evaluate` | Přijme `{ caseId, image, answer, guess, origin, source }` a vrátí krátkou zpětnou vazbu a serverem vypočtené body. |

`image` je datová URL JPG/PNG/WEBP, `guess` je `real`, `ai` nebo `null`, `origin` je `real`, `ai` nebo `unknown`. Klient obrázek zmenší na nejdelší stranu 2048 px a převede na JPEG; neposílá původní název ani EXIF. Průhlednost se při převodu doplní bílou barvou. Žák i model zkoumají stejnou převedenou verzi. Zmenšení a komprese mohou ovlivnit jemné detaily, proto je rozbor vždy pomůckou, nikoliv forenzním důkazem.

Pro plnou funkčnost nasaď celý repozitář na hosting s Node.js. V hostingu nastav `OPENAI_API_KEY`, případně `OPENAI_MODEL`, a `HOST=0.0.0.0`; port může hosting předat přes `PORT`. Spouštěcí příkaz je `npm start`, žádný build ani instalace závislostí nejsou nutné. Veřejné nasazení má běžet přes HTTPS.

**GitHub Pages samotné nestačí:** obslouží statickou část, ale nespustí `server.mjs` a `/api/evaluate`. Rozhraní tam oznámí chybějící připojení. Pro AI hraní použij Node hosting; v repozitáři nejsou žádné přístupové údaje.

Server nevystavuje zdrojové soubory backendu ani `.env`, přijímá vyhodnocení jen z vlastního webového původu, omezuje velikost dat, povoluje nejvýše 4 souběžná vyhodnocení a 30 požadavků za minutu na síťovou adresu. Identické opakované požadavky sdílí jedno volání a výsledek po dobu 10 minut (nejvýše 256 případů v paměti). Neúspěšný pokus lze opravit a opakovat. Tyto limity jsou pojistka pro učební provoz, nikoliv plné zabezpečení veřejné služby. Při otevření veřejnosti přidej řízení přístupu a nastav finanční limity u poskytovatele; celá třída za jednou adresou sdílí limit.

Obrázky ani odpovědi aplikace nezapisuje na disk a neloguje jejich obsah. Během zpracování jsou v paměti, výsledek je krátce uložen v paměťové mezipaměti. Poskytovateli AI se předá aktuální obrázek, tip, argument a případný učitelem uvedený zdroj; předchozí konverzace se neposílá. Zpracování a uchování dat u poskytovatele se řídí jeho podmínkami. Pro výuku používej obrázky vhodné pro věk žáků, které lze sdílet.

## Ověření

```sh
npm run check
npm test
```

Testy ověřují bodování včetně neznámého původu, příjem obrázků, formát skutečného vision požadavku, chybové stavy API, dostupnost statických souborů, ochranu klíče, opakované odeslání a limity. Testy používají testovací odpovědi a **nevolají placené API**. Živé vyhodnocení vyžaduje vlastní funkční klíč a dostupný model.

## Soubory

- `index.html`, `styles.css`, `app.js` — responzivní české rozhraní bez externích knihoven, fontů a analytiky.
- `server.mjs` — Node.js server a stejnojmenné API na stejném původu.
- `lib/evaluate.mjs` — instrukce vyšetřovatele, vision volání, validace a pravidla bodování.
- `.env.example` — vzor serverové konfigurace bez skutečných tajných údajů.
- `test/game.test.mjs` — automatické testy v Node.js.
