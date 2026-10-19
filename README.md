# Budgelist

Log spending, catch recurring bills, and see a trend-line forecast of
where you'll land this month against your budget.

Plain HTML/CSS/JS, Firebase (Auth + Firestore) for cross-device sync,
Chart.js for the forecast chart. Built to be wrapped as a native app with
Capacitor.

## Features

- Email/password login, synced across devices via Firestore
- Add, edit, and delete expenses
- Swipe or tap through past months (chart and totals update per month)
- Recurring bills — set a day of the month and an expense is logged
  automatically once that day arrives
- Forecast chart (least-squares trend line) with a budget warning banner
- Light/dark mode toggle
- Export the current month as CSV (shares via the native share sheet on
  phones, downloads directly on desktop)

## 1. Create a Firebase project (free tier is enough)

1. Go to https://console.firebase.google.com → **Add project**.
2. **Build → Authentication → Get started** → enable **Email/Password**.
3. **Build → Firestore Database → Create database** → start in
   **production mode** (the included `firestore.rules` locks it down).
4. **Project settings → General → Your apps → Web (</>)**, register an
   app, and copy the `firebaseConfig` object it gives you.
5. Paste those values into `www/firebase-config.js`.
6. **Firestore → Rules** → paste in `firestore.rules` → **Publish**.

## 2. Run it in a browser first

No build step — it's static files. Serve them locally (opening
`index.html` directly won't work because of ES modules):

```bash
npx serve www
# or: cd www && python3 -m http.server 8080
```

Create an account, add a few expenses across different days, add a
recurring bill, and try the month arrows and the theme toggle.

## 3. Wrap it with Capacitor

Capacitor needs the web files in their own folder (that's the `www/`
folder here) — `--web-dir=.` is rejected as invalid. Run these from the
project root (the folder containing `www/`):

```bash
npm init -y
npm install @capacitor/core @capacitor/cli
npx cap init "Budgelist" "com.yourname.budgelist" --web-dir=www

npm install @capacitor/android      # and/or: npm install @capacitor/ios
npx cap add android                 # and/or: npx cap add ios
npx cap sync
npx cap open android                # opens Android Studio (or `ios` for Xcode)
```

After any change to files in `www/`, run `npx cap sync` again to copy
them into the native project.

Run it from Android Studio / Xcode onto an emulator or device. The app
talks to Firebase over HTTPS, so no extra Capacitor plugin is required —
just make sure the device has internet access. The CSV export uses the
Web Share API, which Capacitor's WebView supports on both platforms; it
falls back to a plain download if sharing isn't available.

## How the forecast works

For the month being viewed, daily spending is summed into a running
cumulative total. A least-squares line (the same idea as a spreadsheet
trendline) is fit through those points. For the current month, that
line is extended to the last day to project a month-end total; for a
past month, the line is informational only since the data is final.
Crossing the set budget triggers the warning banner.

## How recurring bills work

Each recurring bill is a template (`amount`, `category`, `note`,
`dayOfMonth`). On load, Budgelist checks whether today's date has
passed each template's day for the current month and, if no matching
expense exists yet, creates one automatically and tags it with the
template's ID — so it won't be generated twice.

## Project structure

```
www/
  index.html          UI structure (auth, main screen, add/edit/recurring/budget sheets)
  style.css           Budgelist visual identity, light + dark themes
  app.js              Auth, Firestore sync, month nav, forecast, export, rendering
  firebase-config.js  Your Firebase project keys (fill this in)
firestore.rules       Security rules — each user can only read/write their own data
```
