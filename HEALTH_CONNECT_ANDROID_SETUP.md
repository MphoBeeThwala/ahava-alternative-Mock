# Google Health Connect — Android Setup Guide

Free wearable integration for Ahava Healthcare.
No per-user fees. Supports Fitbit, Samsung, Garmin, Xiaomi, Withings, Whoop.

---

## Prerequisites

- Android Studio installed
- Java 17+
- Node.js 20+ / pnpm 9+

---

## Step 1 — Build the web app

```powershell
pnpm build
```
Output goes to `dist/client/` (referenced in `capacitor.config.ts`).

---

## Step 2 — Add the Android platform (run once)

```powershell
npx cap add android
```
This creates the `android/` folder at the project root.

---

## Step 3 — Sync web assets into Android

Run this every time you change the web app:

```powershell
npx cap sync android
```

---

## Step 4 — Add Health Connect permissions to AndroidManifest.xml

Open `android/app/src/main/AndroidManifest.xml` and add inside `<manifest>`:

```xml
<!-- Health Connect permissions -->
<uses-permission android:name="android.permission.health.READ_HEART_RATE" />
<uses-permission android:name="android.permission.health.READ_STEPS" />
<uses-permission android:name="android.permission.health.READ_ACTIVE_CALORIES_BURNED" />
<uses-permission android:name="android.permission.health.READ_TOTAL_CALORIES_BURNED" />
<uses-permission android:name="android.permission.health.READ_DISTANCE" />
<uses-permission android:name="android.permission.health.READ_EXERCISE" />
<uses-permission android:name="android.permission.health.READ_SLEEP" />
```

And add inside `<application>`:

```xml
<!-- Required: Privacy Policy activity for Health Connect -->
<activity
    android:name=".HealthConnectPrivacyPolicyActivity"
    android:exported="true">
    <intent-filter>
        <action android:name="androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE" />
    </intent-filter>
</activity>

<!-- Required: declare Health Connect usage -->
<queries>
    <package android:name="com.google.android.apps.healthdata" />
</queries>
```

---

## Step 5 — Create the Privacy Policy activity

Google requires an in-app privacy policy screen before Health Connect permissions are granted.

Create `android/app/src/main/java/co/za/ahavahealthcare/app/HealthConnectPrivacyPolicyActivity.kt`:

```kotlin
package co.za.ahavahealthcare.app

import android.app.Activity
import android.os.Bundle
import android.webkit.WebView

class HealthConnectPrivacyPolicyActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val webView = WebView(this)
        // Point to your privacy policy URL
        webView.loadUrl("https://your-frontend.up.railway.app/privacy")
        setContentView(webView)
    }
}
```

> **Note:** Replace the URL with your actual privacy policy page.

---

## Step 6 — Set minimum SDK version

Open `android/variables.gradle` and ensure:

```gradle
minSdkVersion = 26    // Android 8 minimum for Health Connect
compileSdkVersion = 35
targetSdkVersion = 35
```

---

## Step 7 — Open in Android Studio and run

```powershell
npx cap open android
```

Then in Android Studio:
- **Run → Run 'app'** on an emulator or physical device
- The emulator must have Google Play Services (use "Pixel 6 API 35" or similar)

---

## Step 8 — Test Health Connect permissions

On the device/emulator:
1. Install the Health Connect app from Play Store (Android 9–13 only; built-in on Android 14+)
2. Open Ahava app → Patient Dashboard
3. Tap **Grant Permissions** on the WearableConnectCard
4. Grant all requested permissions
5. Tap **Sync Now**

---

## Data available via this integration

| Metric | Source | Notes |
|---|---|---|
| Heart rate | `queryWorkouts` with `includeHeartRate: true` | From workout sessions |
| Steps | `queryAggregated` | Daily total |
| Active calories | `queryAggregated` | Daily total |
| Workout summaries | `queryWorkouts` | Type, duration, distance |

> SpO2, HRV, respiratory rate and temperature require a Terra API subscription
> or direct device SDK integration when you scale beyond the free tier.

---

## Build for release (Play Store)

```powershell
# 1. Build web
pnpm build

# 2. Sync to Android
npx cap sync android

# 3. Open Android Studio
npx cap open android

# 4. In Android Studio: Build → Generate Signed Bundle/APK
```

---

## Environment variable

Add to your backend `.env` (already used by the health-connect route):

```
ML_SERVICE_URL=https://your-ml-service.up.railway.app
```

No new secrets required — Health Connect is entirely free and on-device.
