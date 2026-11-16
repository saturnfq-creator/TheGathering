# The Gathering — Android starter (0.1.0)

This is the first native Android project shell around the approved HTML player UI.

## Included
- WebView-hosted responsive UI with the bottom navigation restored.
- Android MediaStore scan for on-device audio (permission requested at launch).
- Embedded ID3 reading remains available in the web prototype for manually imported files.
- Media3 ExoPlayer + MediaSessionService playback service scaffold.
- Native bridge from the HTML UI to MediaStore scan and Media3 playback.

## Build
1. Open this folder in Android Studio (JDK 17).
2. Allow Gradle sync and download dependencies.
3. Run on an Android device (API 26+).
4. Grant the audio permission when prompted.

The project is source code, not a prebuilt APK. It has not been compiled in this environment because Android SDK/Gradle are not installed here.

## Current MVP boundaries
- Device library scan is implemented through MediaStore.
- Selecting a scanned track sends its content URI to the Media3 playback service.
- The current UI is still the HTML prototype; Home/Profile are placeholders and the library/search panels are early scaffolding.
- Queue persistence, album-art fallback handling, robust service/controller binding, headset/system notification validation, and full app-wide shared navigation are next hardening tasks.

## Build an APK without Android Studio (GitHub Actions)
1. Create a new GitHub repository (private is fine).
2. Upload the *contents* of this project folder to the repository root, including the hidden `.github` directory.
3. Open the repository's **Actions** tab.
4. Select **Build The Gathering APK** and choose **Run workflow**.
5. After the build succeeds, open the run and download **TheGathering-debug-apk** from Artifacts.
6. Unzip the artifact and install `app-debug.apk` on your Android phone.

This is a debug APK, signed with the automatically generated debug key. Android may ask for permission to install apps from your browser/files app. Do not disable general device security protections.

**Important:** This build has not been run or tested here. The current project is an early MVP: it may require fixes after the first cloud build and runtime testing.
