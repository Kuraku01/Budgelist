# Budgelist

![Version](https://img.shields.io/badge/version-0.2.1--beta-purple.svg)
![Platform](https://img.shields.io/badge/platform-Android-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)
![Offline Support](https://img.shields.io/badge/offline-100%25%20supported-brightgreen.svg)

**Budgelist** is a privacy-focused personal expense tracker, two-tier budgeting application, and financial forecasting tool. It combines local-first offline performance with real-time cloud synchronization across devices.

The application allows users to manage an overall **Budget Pool**, allocate optional monthly spending caps, log daily expenses across multiple view modes, track recurring bills, convert between global currencies using live exchange rates, and view multi-factor trend-line forecasts predicting end-of-month budget adherence.

---

## What's New in v0.2.1-beta

- **Redesigned Two-Tier Overview & Spent Progress Bar**: Clear visual separation between your **Budget Pool** reserve at the top and **Monthly Spending** below (with `Monthly Cap` vs. `Uses Pool` mode pill and `Pool Limit` / `Month Budget` stat clarity), plus an upgraded **Spent** progress bar featuring `$0` and limit end labels, a vertical current-spent marker, and a live floating spent callout.
- **Interactive Help Tooltips (`?`)**: Tap or hover `?` badges across Overview, Analytics & Forecast, By Category, Recurring Bills, Expenses, Budget sheets, and Settings for plain-language explanations of every calculation and mode.
- **Multi-View Expenses & Recurring Bills + Day Navigation**: Switch Expenses (`Grouped by day` with collapsible day headers, `Compact`, `Grid` + category filter chips) and Recurring Bills (`Detailed list`, `Compact`, `Grid` + fixed monthly total & `Due today` / `In Xd` / `Logged` status badges), and step day-by-day (`‹` `›`) alongside month-by-month (`«` `»`) in the top bar.
- **Relocated Currency Controls & Logout Confirmation**: Currency symbol & live exchange-rate conversion controls now live in a dedicated **Settings &rarr; Currency** section and inside the **Budget Pool** sheet, paired with a confirmation dialog before logging out (including unsynced-change warnings).
- **Multi-Layer Android Back Navigation**: Native `OnBackPressedCallback` closes active tooltips, dropdowns, date popovers, modals, bottom sheets, and in-progress update downloads layer by layer before requiring a double-back press to exit.
- **Integrated Update Center & Instant Slow-Network Feedback**: Separate **Android App**, **Stable Update**, and **Testing Build** tracks in **Settings &rarr; About &rarr; Check for updates** with instant 0ms popup response, live slow-network status & one-tap cancellation, distinct base APK vs. live update version tracking, rate-limit-free CDN manifest discovery, and **Reset to Original App Version**.

---

## Key Capabilities

### Two-Tier Budgeting & Past-Month Settlement

- **Budget Pool & Addition History**: Maintain an overall unallocated **Budget Pool** with a persistent **Budget History** ledger (with optional descriptions, individual entry deletion, and **Clear Log Only** vs. **Reset Budget ($0) & Clear** options).
- **Flexible Monthly Allocations**: Allocate a fixed monthly spending cap (`Monthly Cap`) from your Budget Pool via synchronized numeric input, smooth animated slider (with spent-floor indicators), and percentage chips (`25%`, `50%`, `75%`, `ALL`), or leave months unrestricted (`Uses Pool`) to draw directly from your Budget Pool.
- **Automatic Past-Month Settlement & Historical Lock**: When a month concludes, unspent monthly budget automatically returns once to your Budget Pool, and past months lock by default to preserve historical records (with optional unlock for historical edits without affecting your current Budget Pool).

### Local-First Architecture & Offline Performance

- **Zero-Delay Startup**: Launches instantly from local storage without blocking on network requests or server availability.
- **Offline Data Persistence**: Add, edit, or delete expenses, recurring bills, and budget allocations offline. All mutations persist locally and automatically synchronize when a network connection is established.
- **Guest Access**: Full application functionality is available offline without requiring account registration.
- **Automatic Schema Migrations**: Safe, versioned schema migrations maintain local database integrity when data formats change across application versions.

### Multi-View Expenses, Recurring Bills & Interactive Calendar

- **Flexible Layout Modes**: Switch **Expenses** between **Grouped by day** (collapsible daily cards with subtotals), **Compact** ledger rows, and **2-Column Grid** cards with instant category filter chips; switch **Recurring Bills** between **Detailed**, **Compact**, and **Grid** views with logged vs. upcoming summary totals.
- **Day & Month Navigation**: Step day-by-day using single-arrow buttons (`‹` `›`) or month-by-month using double-arrow buttons (`«` `»`), or open the interactive calendar popover (`1970` to `+50` years) to jump to any date.

### In-App Live Updates & Update Center

- **Dual-Channel Live Update Engine (`dist.zip` & `dist-unstable.zip`)**: Supports independent **Stable Update** (`dist.zip`) and **Testing Build** (`dist-unstable.zip`) web asset channels delivering live HTML, CSS, and JS updates without requiring a full APK reinstall, while tracking base **Android App** version separately from live update bundles.
- **Non-Blocking Startup Confirmation**: Checks for newer Android App releases and Stable Updates in the background after startup without blocking app boot, prompting with **Confirm Update** or **Later**.
- **Integrated Update Center**: Manage **Android App**, **Stable Update**, and **Testing Build** channels directly from **Settings &rarr; About &rarr; Check for updates**, with instant slow-network visual feedback, request cancellation, and one-tap **Reset to Original App Version**.
- **Rate-Limit-Free CDN Update Discovery**: Queries CDN-hosted `ota-manifest.json` and GitHub web endpoints in parallel with a 10-minute startup cooldown, eliminating GitHub REST API rate limits.

### Multi-Currency Management & Live Exchange Rates

- **Global Currency Support**: Native support for major global currencies including USD ($), EUR (€), GBP (£), JPY (¥), PHP (₱), AUD (A$), CAD (C$), INR (₹), BRL (R$), and CHF (Fr).
- **Automated Rate Conversion**: Fetches live exchange rates and converts all existing expenses, recurring bills, and budget pools to any selected target currency via **Settings &rarr; Currency** or the **Budget Pool** sheet.
- **Atomic Database Sync**: Currency conversions are committed to the database using atomic batch operations to ensure data integrity across devices.

### Financial Forecasting & Analytics

- **Visual Category Distribution**: Provides inline vector charts (Pie and Bar views) for spending category breakdowns.
- **Multi-Factor Forecast**: Combines historical variable velocity, current month pace, and scheduled unpaid recurring bills to project end-of-month totals against monthly or pool budget limits, complete with Safe Daily Spend Targets, interactive help tooltips, and 3-tier budget risk warnings.

### Privacy, Security & Code Quality

- **Isolated User Storage & Strict Ownership Rules**: Data access and username mappings are restricted to authenticated account owners via server-enforced Firestore security rules with enumeration protection.
- **Content Security Policy & Origin Allowlisting**: Enforces strict CSP directives, validates GitHub Release download origins before fetching or opening external links (`noopener,noreferrer`), and pre-validates live bundles with atomic rollback on storage failure.
- **XSS, CSV Formula & Path Traversal Protection**: Eliminates unsanitized `innerHTML` sinks in dynamic rendering, neutralizes spreadsheet formula injection in exported CSV cells, prevents raw password persistence in local storage, and validates native CSV export filenames against path traversal.

### Native Android Features

- **Multi-Layer Back Navigation & Exit Guard**: Native `OnBackPressedCallback` closes open tooltips, dropdowns, date popovers, modals, and bottom sheets layer by layer before prompting a double-back press to exit on the root screen.
- **Automatic Native APK Cache Invalidation**: Detects native APK installation/update timestamps (`PackageInfo.lastUpdateTime`) and automatically clears outdated cached live bundles upon upgrading the APK.
- **CSV Data Export**: Export monthly expense records directly to the device's Downloads directory in standard CSV format.
- **Theme & Color Palette Integration**: Supports Light and Dark modes paired with 6 customizable color themes (**Violet**, **Emerald**, **Ocean**, **Rose**, **Sunset**, and **Slate**).

---

## Installation & Setup

### Installing the Android Application

1. Navigate to the [Releases](https://github.com/Kuraku01/Budgelist/releases) page of this repository.
2. Download the latest `Budgelist_0.2.1-beta.apk` asset.
3. Open the downloaded file on your Android device to complete installation.

### Developer Setup & Building From Source

To build and run Budgelist locally:

1. **Clone Repository & Install Dependencies**:
   ```bash
   git clone https://github.com/Kuraku01/Budgelist.git
   cd Budgelist
   npm install
   ```

2. **Firebase Setup & Web Build**:
   - Create a Firebase project in the [Firebase Console](https://console.firebase.google.com/).
   - Enable **Authentication** (Email/Password provider).
   - Enable **Cloud Firestore** and deploy the rules defined in `firestore.rules`.
   - Copy `www/firebase-config.example.js` to `www/firebase-config.js` and populate your Web API credentials.
   - Place your Android `google-services.json` inside `android/app/google-services.json` (see `android/app/google-services.json.example`).
   - Run `npm run build` to bundle the modular source files in `src/` (`src/js/`, `src/css/`, `src/index.html`) into `www/` and synchronize `android/app/src/main/assets/public/`.

3. **Build Android App**:
   - Open the `android` directory in **Android Studio**.
   - Sync Gradle dependencies and run `./gradlew assembleDebug` or build directly from Android Studio.

---

## User Guide

### 1. Account Setup and Guest Mode

- **Guest Mode**: Select **Continue as Guest** to use the app locally without registering.
- **Account Registration**: Create an account with a unique username and email to synchronize data across multiple devices.
- **Password Reset**: Select **Forgot password?** on the login card to send a password reset verification link to your registered email address (works with email or username input).

### 2. Expense, Calendar, and Recurring Bill Management

- **Log Expense**: Select the floating add button (`+`) to enter the transaction amount, date (using the interactive dropdown calendar), category, and optional notes.
- **Day & Month Navigation**: Use single-arrow buttons (`‹` `›`) to step day-by-day, double-arrow buttons (`«` `»`) to step month-by-month, or tap the month/date header to open the calendar popover (`1970`–`+50` years) and filter by a specific day.
- **View Modes & Category Filtering**: Switch **Expenses** (`Grouped`, `Compact`, `Grid`) or **Recurring Bills** (`Detailed`, `Compact`, `Grid`) using the header view icons, and tap category chips above Expenses to filter transactions.

### 3. Two-Tier Budget Management & Help Tooltips

- **Budget Pool & History**: Tap **+ Add / History** on the **Budget Pool** bar at the top of Overview to add funds to your overall unallocated pool with optional descriptions, review or delete past additions, or clear/reset your budget history.
- **Month Budget Allocation**: Tap **Set month budget** (or **Edit month budget**) in the **Monthly Spending** section of Overview to allocate a fixed monthly cap from your Budget Pool using the numeric input, smooth slider, or percentage chips (`25%`, `50%`, `75%`, `ALL`), or leave it at `0` (`Uses Pool`) to draw directly from your Budget Pool.
- **Past-Month Settlement & Lock**: When a month ends, any unspent monthly cap automatically returns once to your Budget Pool and the past month locks to protect historical records (tap **Locked / Unlock** if you need to edit historical expenses).
- **Contextual Help (`?`)**: Tap any `?` badge next to a budget metric, chart, or setting to view an instant explanation of how that value works.

### 4. Currency Symbol & Exchange Rate Conversion

- Open **Settings &rarr; Currency** (or tap the currency pill inside the **Budget Pool** sheet) to:
  - **Change Symbol**: Update the displayed currency symbol without modifying numerical amounts.
  - **Convert**: Convert all expenses, recurring bills, and budget pools to a target currency using live exchange rates.

### 5. Appearance, Updates & Data Export

- **Themes & Appearance**: Open **Settings &rarr; Appearance** (or tap the sun/moon icon in the top bar) to switch between Light and Dark modes and choose from 6 color themes.
- **Update Center**: Open **Settings &rarr; About &rarr; Check for updates** to view or install **Android App**, **Stable Update**, or **Testing Build** packages, or select **Reset to Original App Version** to return to the built-in app bundle.
- **CSV Export**: Open **Settings &rarr; Export** and select **Export as CSV** to save a spreadsheet of the current month's transactions to your device's Downloads folder.

---

## License

Budgelist is distributed under the MIT License. Developed by Kuraku01.
