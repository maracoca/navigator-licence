# Walk Planner app

Expo (SDK 58) app for the walking-itinerary project. It runs in **Expo Go** on an iPhone. It uses no custom native code, only `react-native-maps` (Apple Maps on iOS, no API key), `expo-location` and `react-native-safe-area-context`.

The flow:
1. Enter the origin, destination, an optional time budget and a sentence. The app calls `POST /api/understand`.
2. Review the cards. You can change required/optional, pace and stay, remove items, and switch street preferences between prefer and require. The app then calls `POST /api/plan`.
3. See the result on a map with a summary.

The API contract is in `../docs/api.md`. Types are in `src/api/types.ts` and the client is in `src/api/client.ts`.

## Configuration

Create `app/.env.local` (git ignores it):

```
EXPO_PUBLIC_API_URL=http://192.168.1.20:3000
```

- Use your **computer's LAN IP**, not `localhost`. On the phone, `localhost` means the phone itself. To find the IP on Windows, run `ipconfig` and look for the "IPv4 Address" of your Wi-Fi adapter.
- The phone and the computer must be on the **same Wi-Fi**. Allow Node through the Windows Firewall on private networks. You can check the server by opening `http://<ip>:3000/api/health` in Safari on the phone.
- `npx expo start --tunnel` only tunnels the JS bundle. It does **not** tunnel the API, so the API URL still has to be reachable from the phone.
- `EXPO_PUBLIC_*` values are built into the bundle at start time. After you change them, restart with `npx expo start -c`.

### Mock mode

With mock mode you can click through the whole flow without the server:

```
EXPO_PUBLIC_MOCK=1
```

The sample data is a Cluj-Napoca walk from the station to Parcul Central: a museum, a cafe, an optional bench that gets skipped, and a lit-streets preference. The understand step always returns the same cards, whatever sentence you type. The plan step responds to your edits: removed items, stay minutes, required flags, the budget (stays shrink to fit) and street preferences.

## Running on the iPhone

1. Install **Expo Go** from the App Store.
2. On the computer:
   ```
   cd app
   npm install
   npx expo start
   ```
3. Scan the QR code with the iPhone Camera app. It opens the app in Expo Go.
   - If the phone cannot load the bundle (some networks isolate clients), use `npx expo start --tunnel`. The API still needs the LAN IP, see above.

## Checks

```
npx tsc --noEmit
npx expo export --platform ios   # bundles the JS; delete dist/ afterwards
```
