# Google Sheets import

Google tabuľka volá aplikáciu cez Apps Script v súbore `pohoda-apps-script.js`.

## Premenné v aplikácii

V deploy prostredí nastav:

```env
GOOGLE_SHEETS_IMPORT_TOKEN=dlhy-tajny-token
GOOGLE_SHEETS_IMPORT_ACTOR_USER_ID=volitelne-user-id-admina-alebo-personalistu
```

`GOOGLE_SHEETS_IMPORT_TOKEN` musí byť rovnaký ako `POHODA_TOKEN` v Apps Scripte.

## Stĺpce v Google Sheets

Vstupné stĺpce:

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
qr
```

Výstupné stĺpce doplní Apps Script automaticky:

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

Viac skupín v jednom riadku zapisuj v stĺpci `skupina` cez znak `|`, napr. `Bar|Stage`.

## Menu v tabuľke

Po vložení Apps Scriptu a obnovení tabuľky pribudne menu `POHODA`:

- `Importovať označené riadky`
- `Importovať READY riadky`
- `Aktualizovať označené riadky`
- `Aktualizovať všetky riadky s user_id`
