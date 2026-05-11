# Google Sheets import

Google tabulka vola aplikaciu cez Apps Script v subore `pohoda-apps-script.js`.

## Premenne v aplikacii

V deploy prostredi nastav:

```env
GOOGLE_SHEETS_IMPORT_TOKEN=dlhy-tajny-token
GOOGLE_SHEETS_IMPORT_ACTOR_USER_ID=volitelne-user-id-admina-alebo-personalistu
```

`GOOGLE_SHEETS_IMPORT_TOKEN` musi byt rovnaky ako `POHODA_TOKEN` v Apps Scripte.

## Stlpce v Google Sheets

Vstupne stlpce:

```text
meno
priezvisko
email
telefon
strava
skupina
od
do
obed
vecera
registracia_qr
```

Vystupne stlpce doplni Apps Script automaticky:

```text
stav
sprava
user_id
qr_kod
skupiny_app
narok_dni
obedy
vecere
aktualizovane
```

Viac skupin v jednom riadku zapisuj v stlpci `skupina` cez znak `|`, napr. `Bar|Stage`.

## Menu v tabulke

Po vlozeni Apps Scriptu a obnoveni tabulky pribudne menu `POHODA`:

- `1. Nastavit vyberove zoznamy`
- `2. Importovat oznacene nove riadky`
- `3. Importovat READY riadky`
- `4. Ulozit oznacene zmeny`
- `5. Ulozit vsetky neulozene zmeny`
- `Nacitat oznacene riadky z aplikacie`
- `Nacitat vsetky riadky s user_id`

Polozka `1. Nastavit vyberove zoznamy` doplni dropdowny pre `strava`, `skupina`, `obed`, `vecera`, `registracia_qr` a `stav`.
Skupiny sa nacitaju z aktualnych skupin v aplikacii. Pri stlpci `skupina` je stale povolene rucne zadanie, aby bolo mozne zadat viac skupin cez znak `|`.

Po importe riadku s `user_id` Apps Script sleduje upravy vo vstupnych bunkach. Zmenene neulozene bunky oznaci oranzovo a nastavi `stav` na `UNSAVED`.
Ulozit ich vies cez menu `4. Ulozit oznacene zmeny` alebo `5. Ulozit vsetky neulozene zmeny`.

Stlpec `registracia_qr` sluzi iba pri importe noveho cloveka. Aktualny QR z aplikacie sa zapisuje do `qr_kod`.
QR sa cez Google Sheets nemeni.

Stlpec `email` sa pri existujucom cloveku meni len vtedy, ak osoba v aplikacii este e-mail nema a novy e-mail nie je pouzity pri inom pouzivatelovi.
Existujuci e-mail uctu sa cez Sheets nemeni.
