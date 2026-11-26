# Agenda voor leefgroep en jongeren

Een eenvoudige agenda voor begeleid wonen. Jongeren zetten hun afspraken erin
(dokter, school, werk, …), en die zijn standaard zichtbaar voor hun begeleiders,
zodat zij kunnen ondersteunen. Is iets echt persoonlijk, dan zet de jongere het
op **privé**: dan ziet niemand anders het, ook de begeleiders niet.

| Wie ziet dit?             | Jongere zelf | Andere jongeren | Begeleiders |
| ------------------------- | :----------: | :-------------: | :---------: |
| Ik en de begeleiding      |      ✓       |                 |      ✓      |
| Alleen ik (privé)         |      ✓       |                 |             |
| Gedeeld (bv. bewonersverg.)|     ✓       |        ✓        |      ✓      |
| Leefgroep (begeleiders)   |              |                 |      ✓      |

Een begeleider kan ook iets plannen "voor Jo": dan zien Jo en de begeleiders het.

## Hoe het beveiligd is

- **De website bevat geen gegevens.** Op GitHub Pages staat alleen de code. Die is
  openbaar, en dat mag: er zit niets van Sporen in.
- **Afspraken worden op het toestel versleuteld** (AES-256), vóór ze vertrekken.
  De opslag (Supabase, Frankfurt) ziet alleen onleesbare tekens. Ook wie de
  database zou bemachtigen, kan de afspraken niet lezen.
- **Elke persoon heeft een eigen sleutel**, die opengaat met het eigen
  wachtwoord. Per agenda is er één sleutel, die alleen doorgegeven wordt aan wie
  erbij hoort. Een privé-agenda kan technisch niet gedeeld worden.
- **Een tweede slot in de database** (Row Level Security): wie geen toegang heeft
  tot een agenda, krijgt zelfs de versleutelde rijen niet.
- **Alleen initialen**, geen namen, geen e-mailadressen (de login is een
  gebruikersnaam).
- **Bewaartermijn**: afspraken worden automatisch verwijderd 6 maanden na de
  maand waarin ze vallen. Ongebruikte uitnodigingscodes vervallen na 14 dagen.
- **Keerzijde**: wie zijn wachtwoord vergeet, verliest zijn privé-afspraken.
  Niemand kan ze terughalen, ook de beheerder niet. Dat is de prijs van echte
  versleuteling.

## Demo

Zonder Supabase-instellingen start de app in **demo-modus**: een verzonnen
leefgroep, alles blijft in de browser. Handig om te tonen.

```bash
pnpm install
pnpm dev
```

## Supabase instellen (eenmalig)

1. Maak op supabase.com een project aan, regio **Frankfurt (eu-central-1)**.
2. **Authentication → Sign In / Providers → Email**: zet **Confirm email** uit
   (er zijn geen echte e-mailadressen).
3. **Database → Extensions**: zet **pg_cron** aan (voor de bewaartermijn).
4. **SQL Editor**: plak `supabase/schema.sql` en klik **Run**.
5. Maak een startcode voor de eerste begeleider, in de SQL Editor:
   `insert into private.startcodes (code) values ('een-lange-geheime-code');`
6. **Project Settings → API**: noteer de **Project URL** en de **anon public key**.
   De anon key is bedoeld om openbaar te zijn. De **service_role key** nooit
   delen en nergens in de code zetten.

## GitHub Pages instellen (eenmalig)

1. Repo → **Settings → Pages → Source: GitHub Actions**.
2. Repo → **Settings → Secrets and variables → Actions → Variables**: voeg
   `VITE_SUPABASE_URL` en `VITE_SUPABASE_ANON_KEY` toe.
   Zonder die twee publiceert GitHub de demo-versie.
3. Elke push naar `main` test, bouwt en publiceert de app.

## Eerste gebruik

1. De eerste begeleider kiest **Nieuwe leefgroep** en vult de startcode in.
2. Bij **Leefgroep beheren** maakt die een uitnodigingscode per persoon (rol +
   initialen) en geeft die persoonlijk door.
3. De nieuwe persoon kiest **Ik heb een code** en maakt een eigen wachtwoord.
4. De begeleider ziet daarna **Wacht op toegang** en klikt **Toegang geven**.
   Dan kan de nieuwe persoon ook de gedeelde agenda lezen.

## Open punten voor IT

- Externe opslag (Supabase, EU): akkoord van IT/DPO? Een verwerkersovereenkomst
  (DPA) van Supabase is beschikbaar.
- Initialen in een kleine leefgroep zijn **pseudoniem, niet anoniem**: de AVG
  blijft gelden, ook al is alles versleuteld.
- Bewaartermijn van 6 maanden: is dat goed?
- Wachtwoord vergeten: hoe vangen we dat op (nieuw account, privé-afspraken weg)?
- Later: overstap naar een server van Sporen zelf kan, de opslaglaag is los te
  vervangen.
