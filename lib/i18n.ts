export type AppLanguage = 'SK' | 'EN'

export const APP_LANGUAGE_COOKIE = 'pohoda_language'

export function normalizeAppLanguage(value: any): AppLanguage {
  return String(value || '').trim().toUpperCase() === 'EN' ? 'EN' : 'SK'
}

export function languageFromUser(user: any): AppLanguage {
  return normalizeAppLanguage(user?.app_language || user?.language)
}

export function localeFor(language: AppLanguage) {
  return language === 'EN' ? 'en-GB' : 'sk-SK'
}

export function appText(language: AppLanguage) {
  return language === 'EN' ? enText : skText
}

const enText = {
  language: 'Language',
  slovak: 'Slovak',
  english: 'English',
  login: 'Sign in',
  welcomeBack: 'Welcome back',
  email: 'E-mail',
  accessCode: 'Access code',
  sendLogin: 'Send sign-in',
  sending: 'Sending...',
  noRegistration: 'I do not have a registration yet',
  loginIntro: 'Enter your registration e-mail. We will send you a sign-in link and a 6-digit code.',
  accessIntro: 'Use this option if you have an access code from the organizer.',
  firstName: 'First name',
  lastName: 'Last name',
  continueToApp: 'Continue to app',
  saving: 'Saving...',
  privacy: 'Personal data protection',
  privacyOpen: 'Open Privacy Policy',
  privacyConfirm: 'I confirm that I have read the personal data protection rules.',
  dashboardWelcome: 'Welcome',
  logout: 'Sign out',
  registrationGroup: 'Registration group',
  foodType: 'Food type',
  today: 'Today',
  selectedDay: 'Selected day',
  todayFood: "Today's meals",
  foodForDay: 'Meals for the day',
  entitlement: 'Entitlement',
  mySelection: 'Meal selection',
  mealSelection: 'Meal selection',
  myQr: 'My QR code',
  foodEntitlements: 'Meal entitlements',
  groupIssue: 'Group issue',
  accessDetails: 'Access details',
  meal: 'Meal',
  mealStatus: 'Meal status',
  pickedUpBy: 'Picked up by',
  overview: 'Overview',
  wristband: 'Wristband',
  food: 'Meals',
  back: 'Back',
  downloadQr: 'Download QR code',
  backToDashboard: 'Back to dashboard',
  dinerIdentification: 'Diner identification',
  qrNotAssigned: 'QR code has not been assigned yet.',
  wristbandActive: 'Wristband active',
  qrActive: 'QR code active',
  calendar: 'Calendar',
  days: 'days',
  lunch: 'lunch',
  dinner: 'dinner',
  lunchDinner: 'Lunch + dinner',
  noUpcomingEntitlements: 'You do not have any upcoming meal entitlements yet.',
  groupIssueTitle: 'Group issue',
  chooseFood: 'Meal selection'
}

const skText = {
  language: 'Jazyk',
  slovak: 'Slovenčina',
  english: 'English',
  login: 'Prihlásenie',
  welcomeBack: 'Vitaj späť',
  email: 'E-mail',
  accessCode: 'Prístupový kód',
  sendLogin: 'Poslať prihlásenie',
  sending: 'Odosielam...',
  noRegistration: 'Ešte nemám registráciu',
  loginIntro: 'Zadaj svoj registračný e-mail. Pošleme ti prihlasovací link aj 6-miestny kód.',
  accessIntro: 'Použi túto možnosť, ak máš pridelený prístupový kód od organizátora.',
  firstName: 'Meno',
  lastName: 'Priezvisko',
  continueToApp: 'Pokračovať do aplikácie',
  saving: 'Ukladám...',
  privacy: 'Ochrana osobných údajov',
  privacyOpen: 'Otvoriť Pravidlá ochrany osobných údajov',
  privacyConfirm: 'Potvrdzujem, že som sa oboznámil/a s pravidlami ochrany osobných údajov.',
  dashboardWelcome: 'Vitaj',
  logout: 'Odhlásiť',
  registrationGroup: 'Registračná skupina',
  foodType: 'Typ stravy',
  today: 'Dnes',
  selectedDay: 'Vybraný deň',
  todayFood: 'Dnešná strava',
  foodForDay: 'Strava na deň',
  entitlement: 'Nárok',
  mySelection: 'Výber stravy',
  mealSelection: 'Výber stravy',
  myQr: 'Môj QR kód',
  foodEntitlements: 'Nároky na stravu',
  groupIssue: 'Skupinový výdaj',
  accessDetails: 'Prístupové údaje',
  meal: 'Jedlo',
  mealStatus: 'Stav jedla',
  pickedUpBy: 'Prevzal',
  overview: 'Prehľad',
  wristband: 'Náramok',
  food: 'Strava',
  back: 'Späť',
  downloadQr: 'Stiahnuť QR kód',
  backToDashboard: 'Späť na dashboard',
  dinerIdentification: 'Identifikácia stravníka',
  qrNotAssigned: 'QR kód zatiaľ nie je priradený.',
  wristbandActive: 'Náramok aktívny',
  qrActive: 'QR kód aktívny',
  calendar: 'Kalendár',
  days: 'dní',
  lunch: 'obed',
  dinner: 'večera',
  lunchDinner: 'Obed + večera',
  noUpcomingEntitlements: 'Zatiaľ nemáš priradené nadchádzajúce nároky na stravu.',
  groupIssueTitle: 'Skupinový výdaj',
  chooseFood: 'Výber stravy'
}
