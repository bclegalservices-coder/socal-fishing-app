# Channel Nav — tester setup on a Mac (about 1 hour, once)

You'll run the app in Apple's iPhone simulator on your Mac, find bugs, and send them to Christopher.
Everything here is free. Do one step at a time.

## 1. Accept the GitHub invite
Christopher adds you to the private project. Open the email from GitHub and click **Accept invitation**.
(No GitHub account? Make a free one at https://github.com/signup first and send him your username.)

## 2. Install the tools
1. **Xcode** — App Store → search "Xcode" → Get (large download; let it finish), then open it once and accept.
2. Open **Terminal** (Spotlight: ⌘ Space, type Terminal).
3. Install Homebrew (the Mac's free tool installer), Node and CocoaPods — paste one line at a time:
   ```
   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
   brew install node cocoapods gh
   gh auth login
   ```
   For `gh auth login` choose GitHub.com → HTTPS → Login with a web browser.

## 3. Get the project
```
mkdir -p ~/Developer && cd ~/Developer
gh repo clone bclegalservices-coder/socal-fishing-app
cd socal-fishing-app/mobile && npm install
```
(Keep the project in ~/Developer — not in iCloud Documents, which breaks iPhone builds.)

## 4. Settings file
Christopher sends you a file called `.env` (public keys only — no passwords). Put it in
`~/Developer/socal-fishing-app/mobile/`.

## 5. Build and run (first time 10–20 minutes)
```
cd ~/Developer/socal-fishing-app/mobile
npx expo run:ios
```
The simulator opens with Channel Nav. Next time it's just:
```
cd ~/Developer/socal-fishing-app/mobile && npx expo start --dev-client
```
then press **i**.

## 6. Get the latest version
```
cd ~/Developer/socal-fishing-app && git pull && cd mobile && npx expo start --dev-client --clear
```
If it says a native module is missing, run `npx expo run:ios` again.

## Reporting a bug
Send Christopher: what you tapped, what you expected, what happened, and a screenshot
(simulator: ⌘ S saves one to the Desktop). If the app closed, also send the "Problem Report" text (Show Details → copy).

Tip: the simulator has no GPS. Set a fake location with **Features → Location → Custom Location**
(for example 33.7095, -118.2840), or **Freeway Drive** to test speed and course.
