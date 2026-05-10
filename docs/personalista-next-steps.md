# Personalista: postup implementacie

## 1. Databaza

Najprv spustit migraciu:

`supabase/migrations/202605110001_personalista_core.sql`

Migracia pripravuje:

- manualnych pouzivatelov bez povinneho emailu,
- globalne role `ADMIN` a `PERSONALISTA`,
- audit log pre zasahy personalistu,
- pracovne obdobia,
- zdroj a audit stlpce pre naroky na stravu,
- import batch/rows pre Excel, CSV a Google Sheets,
- QR batch/token tabulky pre pridelene aj prazdne QR,
- doplnujuce stlpce pre existujuce `user_qr_codes`,
- NFC tokeny,
- konfiguracie Google Sheets synchronizacii.

## 2. Poradie aplikacnych funkcii

1. Rucne vytvorenie osoby: povinne meno a priezvisko, email nepovinny.
2. Priradenie do jednej alebo viacerych skupin.
3. Nastavenie predvolenej stravy `MASO`, `VEGE`, `DIETA`.
4. Zadanie pracovneho obdobia a narokov na obed/veceru po dnoch.
5. Generovanie alebo priradenie QR kodu.
6. Tlac QR kodov pre skupinu na A4.
7. Import Excel/CSV.
8. Google Sheets import alebo synchronizacia.
9. Vymena QR a parovanie naramku.
10. NFC tokeny pre vybranych ludi.

## 3. Google Sheets smer

Najjednoduchsi prvy krok je import CSV exportu z Google Sheets. Priama synchronizacia potom moze ist cez Apps Script webhook alebo cez ulozene `google_sheet_id` a serverovu integraciu.

Import musi zapisovat kazdy riadok do `personnel_import_rows`, aby personalista videl chyby pred potvrdenim importu.
