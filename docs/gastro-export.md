# GASTRO_2026 Google Sheets export

## Environment variables

Set these on the Next.js/Vercel side:

- `GASTRO_EXPORT_TOKEN` - standalone bearer token for the Google Apps Script export call.
- `NEXT_PUBLIC_SUPABASE_URL` - existing Supabase URL.
- `SUPABASE_SERVICE_ROLE_KEY` - existing server-side Supabase key. Never put this into Google Apps Script.

Set these in Google Apps Script `Project Settings -> Script Properties`:

- `GASTRO_EXPORT_TOKEN` - same standalone token as on Vercel.
- `GASTRO_EXPORT_URL` - optional. Default: `https://www.pohodapass.sk/api/gastro-export?year=2026`.
- `GASTRO_SHEET_NAME` - optional. Default: `GASTRO_2026`.

## API

Endpoint:

```text
GET /api/gastro-export?year=2026
Authorization: Bearer <GASTRO_EXPORT_TOKEN>
```

The API returns only aggregate counts:

- active registration groups from `registration_groups`
- food entitlements from `user_food_entitlements`
- registration group membership valid for the entitlement date from `user_registration_group_periods`
- fallback group from `users.registration_group_id` when no period exists

No names, emails, phones or QR codes are returned.

## Google Apps Script setup

1. Open the Google Sheet.
2. Go to `Extensions -> Apps Script`.
3. Paste the contents of `google-apps-script/gastro-refresh.gs`.
4. Open `Project Settings -> Script Properties`.
5. Add `GASTRO_EXPORT_TOKEN`.
6. Optionally add `GASTRO_EXPORT_URL` and `GASTRO_SHEET_NAME`.
7. Reload the spreadsheet.
8. Use `POHODA -> Refresh GASTRO_2026`.

## Test procedure

Local endpoint:

```powershell
$env:GASTRO_EXPORT_TOKEN='test-token'
npm run dev
```

Then call:

```powershell
Invoke-RestMethod `
  -Uri 'http://localhost:3000/api/gastro-export?year=2026' `
  -Headers @{ Authorization = 'Bearer test-token' }
```

Production check:

1. Set `GASTRO_EXPORT_TOKEN` in Vercel.
2. Deploy.
3. Call `https://www.pohodapass.sk/api/gastro-export?year=2026` with bearer token.
4. Verify JSON has `groups` and aggregate `items`.
5. In Google Sheets, set Script Properties.
6. Click `POHODA -> Refresh GASTRO_2026`.
7. Verify:
   - columns A:C stay unchanged
   - registration groups are recreated as columns
   - `SPOLU` remains the last column
   - `SPOLU` formulas sum all group columns
   - no personal data appears in the sheet
