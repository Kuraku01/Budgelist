# Budgelist

![Version](https://img.shields.io/badge/version-0.2.1--beta-purple.svg)
![Platform](https://img.shields.io/badge/platform-Android-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)
![Offline Support](https://img.shields.io/badge/offline-100%25%20supported-brightgreen.svg)

**Budgelist** is a privacy-focused personal expense tracker, two-tier budgeting application, and financial forecasting tool. It combines local-first offline performance with real-time cloud synchronization across devices.

The application allows users to manage an overall Budget pool, allocate monthly budgets, log daily expenses, track recurring bills, convert between global currencies using live exchange rates, and view multi-factor trend-line forecasts predicting end-of-month budget adherence.

---

## What's New in v0.2.1-beta

- **Multi-Layer Android Back Navigation**: Native `OnBackPressedCallback` captures back gestures and physical back buttons, closing open UI elements sequentially (custom dropdowns &rarr; date/calendar popovers &rarr; modals &rarr; secondary sheets &rarr; base sheets &rarr; auth sub-views) with double-back confirmation to exit on the root screen.
- **Dual-Channel Live OTA Engine (`dist.zip` vs. `dist-unstable.zip`)**: Explicit Stable and Testing/Unstable OTA channels, non-blocking startup checks with Confirm/Later prompt, and an integrated **Update Center** in Settings &rarr; About with individual track statuses and a **Revert to Built-in Native Package** option.
- **Rate-Limit-Free CDN Update Manifest**: Release discovery directly queries CDN-hosted `ota-manifest.json` and GitHub web endpoints, completely bypassing GitHub's 60 req/hr unauthenticated REST API limit, backed by a 10-minute cooldown on background startup checks.
- **Automatic Native APK Cache Invalidation**: Native APK timestamp tracking (`PackageInfo.lastUpdateTime`) automatically purges stale cached web bundles when a new or rebuilt APK is installed.

---

## Key Capabilities

### Two-Tier Budgeting & Past-Month Settlement

- **Global Budget Pool & Addition History**: Maintain an overall unallocated Budget pool with a persistent **Budget History** ledger (with optional descriptions, individual entry deletion, and **Clear Log Only** vs. **Reset Budget ($0) & Clear** options).
- **Flexible Monthly Allocations**: Allocate monthly budgets from your Global Budget via synchronized numeric input, smooth animated slider (with spent-floor indicators), and percentage chips (`25%`, `50%`, `75%`, `ALL`), or leave months **Unrestricted** to draw directly from your Global Budget.
- **Automatic Past-Month Settlement & Historical Lock**: When a month concludes, unspent monthly budget automatically returns once to your Global Budget, and past months lock by default to preserve historical records (with optional unlock for historical edits without affecting current Budget).

### Local-First Architecture & Offline Performance

- **Zero-Delay Startup**: Launches instantly from local storage without blocking on network requests or server availability.
- **Offline Data Persistence**: Add, edit, or delete expenses, recurring bills, and budget allocations offline. All mutations persist locally and automatically synchronize when a network connection is established.
- **Guest Access**: Full application functionality is available offline without requiring account registration.
- **Automatic Schema Migrations**: Safe, versioned schema migrations maintain local database integrity when data formats change across application versions.

### Over-The-Air (OTA) Live Updates & Update Management

- **Dual-Channel Live OTA Engine (`dist.zip` & `dist-unstable.zip`)**: Supports independent **Stable** (`dist.zip`) and **Testing / Unstable** (`dist-unstable.zip`) web asset channels delivering live HTML, CSS, and JS updates without requiring a full APK reinstall.
- **Non-Blocking Startup Confirmation**: Checks for newer Native APK releases and Stable OTA bundles in the background after startup without blocking app boot, prompting with **Confirm Update** or **Later**.
- **Integrated Update Center**: Manage **Native App (APK)**, **Stable Package**, and **Unstable Package** channels directly from **Settings &rarr; About &rarr; Check for updates**, with one-tap **Revert to Built-in Native Package** support.
- **Rate-Limit-Free CDN Update Discovery**: Queries CDN-hosted `ota-manifest.json` and GitHub web endpoints with a 10-minute startup cooldown, eliminating GitHub REST API rate limits.

### Multi-Currency Management & Live Exchange Rates

- **Global Currency Support**: Native support for major global currencies including USD ($), EUR (€), GBP (£), JPY (¥), PHP (₱), AUD (A$), CAD (C$), INR (₹), BRL (R$), and CHF (Fr).
- **Automated Rate Conversion**: Fetches live exchange rates and converts all existing expenses, recurring bills, and budget targets to any selected target currency.
- **Atomic Database Sync**: Currency conversions are committed to the database using atomic batch operations to ensure data integrity across devices.

### Financial Forecasting & Analytics

- **Visual Category Distribution**: Provides inline vector charts (Pie and Bar views) for spending category breakdowns.
- **Multi-Factor Forecast**: Combines historical variable velocity, current month pace, and scheduled unpaid recurring bills to project end-of-month totals against monthly or global budget limits, complete with Safe Daily Spend Targets and 3-tier budget risk warnings.

### Privacy, Security & Code Quality

- **Isolated User Storage**: Data access is restricted to authenticated account owners via server-enforced security policies.
- **Content Security Policy (CSP)**: Enforces strict resource origin controls for Firebase Auth, Google APIs, WebSocket streams, and GitHub Releases endpoints.
- **XSS & Credential Protection**: Eliminates unsanitized `innerHTML` sinks in dynamic list rendering, prevents raw password persistence in local storage, and validates native CSV export filenames against path traversal.

### Native Android Features

- **Multi-Layer Back Navigation & Exit Guard**: Native `OnBackPressedCallback` closes open dropdowns, date popovers, modals, and bottom sheets layer by layer before prompting a double-back press to exit on the root screen.
- **Automatic Native APK Cache Invalidation**: Detects native APK installation/update timestamps (`PackageInfo.lastUpdateTime`) and automatically clears outdated cached OTA bundles upon upgrading the APK.
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

2. **Firebase Setup**:
   - Create a Firebase project in the [Firebase Console](https://console.firebase.google.com/).
   - Enable **Authentication** (Email/Password provider).
   - Enable **Cloud Firestore** and deploy the rules defined in `firestore.rules`.
   - Copy `www/firebase-config.example.js` to `www/firebase-config.js` and populate your Web API credentials.
   - Place your Android `google-services.json` inside `android/app/google-services.json` (see `android/app/google-services.json.example`).
   - Run `npx cap sync android` to synchronize web assets into `android/app/src/main/assets/public/`.

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
- **Interactive Calendar & Day Filter**: Tap the month header (e.g., **November 2026**) to open the calendar popover, jump to any month/year between 1970 and 50 years ahead, or tap a specific date to filter expenses for that day.
- **Recurring Bills**: Define fixed monthly commitments (such as rent or subscriptions) under the **Recurring bills** panel (`+ Add`) to automatically apply them to monthly calculations and forecasts.

### 3. Two-Tier Budget Management

- **Global Budget & History**: Tap **+ Add / History** on the **Budget** bar inside the Overview card to add funds to your overall unallocated Budget pool with optional descriptions, review or delete past additions, or clear/reset your budget history.
- **Month Budget Allocation**: Tap **Set month budget** (or **Edit month budget**) in the Overview card header to allocate funds from your Global Budget to the active month using the numeric input, smooth slider, or percentage chips (`25%`, `50%`, `75%`, `ALL`), or leave the month **Unrestricted** to draw directly from your Global Budget.
- **Past-Month Settlement & Lock**: When a month ends, any unspent monthly budget automatically returns once to your Global Budget and the past month locks to protect historical records (tap **Locked / Unlock** if you need to edit historical expenses).

### 4. Currency Conversion

- Select the **Currency Options** button (`⇄`) in the top-right header of the **Overview** card to:
  - **Change Symbol**: Update the displayed currency symbol without modifying numerical amounts.
  - **Convert Values**: Convert all expenses, recurring bills, and budget pools to a target currency using live exchange rates.

### 5. Appearance, Updates & Data Export

- **Themes & Appearance**: Open **Settings &rarr; Appearance** (or tap the sun/moon icon in the top bar) to switch between Light and Dark modes and choose from 6 color themes.
- **Update Center**: Open **Settings &rarr; About &rarr; Check for updates** to view or install **Native App (APK)**, **Stable Package**, or **Unstable Package** updates, or revert to the built-in native package.
- **CSV Export**: Open **Settings &rarr; Export** and select **Export as CSV** to save a spreadsheet of the current month's transactions to your device's Downloads folder.

---

## License

Budgelist is distributed under the MIT License. Developed by Kuraku01.
