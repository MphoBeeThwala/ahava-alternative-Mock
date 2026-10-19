# Phone health sync: Health Connect (Android) and Apple Health (iPhone)

Ahava can read a patient's watch data straight from the phone's health app. No Terra or Rook account, no per-user fee.

```
Watch  ->  watch maker's app  ->  Health Connect / Apple Health  ->  Ahava app  ->  Ahava backend  ->  early-warning
```

The code is done: the app card is on the **Wearable** page (`PhoneHealthCard`), the reading logic is `workspace/src/lib/phoneHealth.ts`, the backend endpoint is `POST /api/v1/biometrics/health-connect`. What is left is the one-time store and device setup below, which needs your accounts and a real phone.

## What gets read

Heart rate, resting heart rate, HRV, blood oxygen, breathing rate, body temperature, sleep, steps, active calories, blood pressure. Only the types the patient allows. Ahava never writes to the health app.

Values the watch did not report stay empty. Nothing is estimated, because a made-up number in a baseline can hide a real problem.

Apple Health reports HRV as SDNN and Android reports RMSSD. They are different measures, so Apple's value is stored but kept out of the early-warning baseline.

## Which watches work

A watch works if its own app writes to the phone's health store.

| Watch | Android (Health Connect) | iPhone (Apple Health) |
|---|---|---|
| Apple Watch | no | yes, automatic |
| Samsung Galaxy Watch | yes: Samsung Health > Settings > Health Connect > allow write | no |
| Pixel Watch / Fitbit | yes: Fitbit app > Settings > Health Connect | yes: Fitbit app > Apple Health |
| Garmin | yes: Garmin Connect > Settings > Connected apps > Health Connect | yes: Garmin Connect > Settings > Apple Health |
| Xiaomi / Huawei / Oura / Whoop / Withings / Polar | most have a Health Connect or Apple Health switch in their own app; check the maker's app | same |

The patient turns that switch on once. After that the data flows without them.

## Before you start (both platforms)

1. Deploy the backend and the web app from this branch first. The phone app loads the live website (`capacitor.config.ts` `server.url`), so the new screen and API must be live.
2. Install and sync from the repo root: `pnpm install`, then in `workspace/` run `npx cap sync android` and `npx cap sync ios`. This is already done in the repo; re-run it after any plugin change.
3. A **new app build** is required, because the native health plugin changed (`@capgo/capacitor-health` replaced `capacitor-health`). Updating the website alone does not add it to phones that already installed the old app.

## Android: Health Connect

**Needs:** Android Studio, a Google Play Console account (one-time US$25), an Android 9+ phone (Android 14+ has Health Connect built in; older phones install the Health Connect app from Play).

1. **Open the project:** `cd workspace && npx cap open android`.
2. **Check the manifest** (`android/app/src/main/AndroidManifest.xml`). The health permissions and the privacy-policy screen are already declared. Do not remove them: Health Connect hides apps that lack the privacy-policy screen.
3. **Run on a real phone** (USB debugging on). In the emulator, install the Health Connect app and add test data by hand (Health Connect > Data and access > add data) if you have no watch.
4. **Test it:**
   1. Make sure the watch's app is writing to Health Connect (table above).
   2. Open Ahava > Wearable > **Connect Health Connect**.
   3. Allow the data types on the Health Connect screen.
   4. Tap again to sync. You should see "Synced", and a new reading in the patient's history with source "wearable".
5. **Release build:** Android Studio > Build > Generate Signed Bundle (AAB). Keep the signing key safe; losing it means you can never update the app. Raise `versionCode` in `android/app/build.gradle` for every upload.
6. **Google Play requirements for health apps** (Play Console > Policy and programs > App content):
   - **Health apps declaration:** declare it is a health app and what it does.
   - **Health Connect permissions declaration:** for each permission, explain why it is needed (see the table above). Google reviews this and can take days; asking for fewer types is faster.
   - **Privacy policy URL:** `https://app.ahavaon88.co.za/legal/privacy-policy` (already updated to name Health Connect and Apple Health).
   - **Data safety form:** health info and fitness info collected, encrypted in transit, can be deleted on request.
7. **Until Google approves** the declaration, release builds cannot read Health Connect. Debug builds on your own phone work, so you can test everything first.

## iPhone: Apple Health (HealthKit)

**Needs:** a Mac with Xcode (Apple does not allow iOS builds from Windows), an Apple Developer Program membership (US$99/year), an iPhone running iOS 15+. HealthKit does not work on the Simulator with a real watch; use a real iPhone, or add sample data in the Simulator's Health app.

1. **Open the project:** on the Mac, `cd workspace && npx cap open ios`.
2. **Set your team and bundle ID:** Xcode > App target > Signing & Capabilities > pick your Team. The bundle ID in the project is `co.za.ahavaon88.app`, while Android and `capacitor.config.ts` use `co.za.ahavahealthcare.app`. They do not have to match, but decide which is correct before the first App Store upload, because it cannot change afterwards.
3. **Add the HealthKit capability** (this cannot be done from the command line): Signing & Capabilities > **+ Capability** > **HealthKit**. Leave "Clinical Health Records" and "Background Delivery" off.
4. **Check Info.plist:** `NSHealthShareUsageDescription` is already set. Apple rejects apps whose wording is vague, so keep it specific about what is read and why.
5. **Run on your iPhone** (Product > Run). On first launch iOS will ask to trust the developer: Settings > General > VPN & Device Management.
6. **Test it:**
   1. Make sure the watch writes to Apple Health (an Apple Watch does by itself).
   2. Open Ahava > Wearable > **Connect Apple Health**.
   3. The Health permission sheet lists each type. Turn them on and tap Allow.
   4. Tap again to sync. You should see "Synced".
   - iOS never tells an app which types were denied, only returns no data for them, so a missing field after syncing usually means that switch is off: Settings > Health > Data Access & Devices > Ahava.
7. **App Store review:** in App Store Connect fill in the App Privacy section (health and fitness data, linked to the user, not used for tracking) and the privacy policy URL above. Apple's guideline 5.1.3 forbids using health data for advertising or selling it, and the policy now says so.

## How often it syncs

When the patient opens the **Wearable** page and taps the button. There is no automatic background sync yet: it needs extra native work (Android's background-read permission, iOS HealthKit background delivery) and extra store review. If you want hands-free syncing, that is the next piece to build.

## Checking it from the server

After a sync, in the database (or admin tools) the patient's newest `biometric_readings` row should show `source = wearable`, a `deviceType` with the watch name, and only the fields the watch measured; the others are NULL. A row full of identical round numbers (70, 97, 15) would mean something is padding values again.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Card says "Health Connect is not installed" | Install or update Health Connect from Google Play. |
| Card only shows the "open in the phone app" text | You are in a normal browser; use the installed Ahava app. |
| "No health data was shared" | The patient declined in the permission sheet. Android only asks a few times, then it must be changed in Health Connect > App permissions. |
| "no recent readings" | The watch has not synced to its own app yet, or its Health Connect / Apple Health switch is off. |
| Synced but no early-warning baseline change | Baseline needs a full set (resting HR, HRV in RMSSD, blood oxygen, breathing rate) in one sync. A partial sync is still checked against safe limits. iPhone syncs never include RMSSD, so they use the safe-limit checks only. |
