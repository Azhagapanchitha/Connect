# JothidaConnect

Two mobile apps plus the backend they share:

| Folder | What it is |
| --- | --- |
| `customer-app/` | **JothidaConnect** – customers browse astrologers, read their daily horoscope, top up a wallet and pay per minute for live chat consultations. |
| `astrologer-app/` | **JothidaConnect Partner** – astrologers set up a public profile, go online/offline, get chat requests as live pop-ups, chat with the client's birth details on screen, and track earnings and withdrawals. |
| `backend/` | Node.js (Express + Socket.IO) API server. It handles login, profiles, the wallet, per-minute billing, real-time chat and reviews. |

Both apps are built with **React Native + Expo** (JavaScript), so they run on iOS and Android from one codebase.

## How it works

```
Customer app ──REST + WebSocket──┐
                                 ├── backend (port 4000) ── data.json
Astrologer app ─REST + WebSocket─┘
```

1. The customer signs in with their phone and an OTP, then fills in their birth details and zodiac sign.
2. The customer picks an online astrologer and taps **Chat**. They need enough wallet balance (or package minutes) for 5 minutes at that astrologer's rate.
3. The astrologer gets a pop-up and accepts or declines. Requests nobody answers expire after 60 seconds.
4. Once the chat starts, the customer is billed each minute (the first minute is charged up front). The astrologer earns **70%** of each minute. If the wallet runs out, the chat ends automatically.
5. Either side can end the chat. The customer can then rate the astrologer and leave a review.

## Run it locally

You need Node.js 20+ and the **Expo Go** app on your phone (or an iOS Simulator or Android emulator).

```bash
# 1. Backend
cd backend
npm install
npm start               # http://localhost:4000. Seeds demo data on first run.

# 2. Customer app (new terminal)
cd customer-app
npm install
npx expo start          # scan the QR code with Expo Go

# 3. Astrologer app (another terminal)
cd astrologer-app
npm install
npx expo start --port 8082
```

The apps find the backend automatically on the same machine that serves the Expo bundle (the same LAN IP, port 4000). Your phone and computer must be on the same Wi-Fi. To point the apps at a different server, set it explicitly:

```bash
EXPO_PUBLIC_API_URL=https://api.example.com npx expo start
```

### Demo accounts

The OTP is always **1234** in development.

| App | Phone | Notes |
| --- | --- | --- |
| Customer | `9999999999` | Demo customer with ₹500 in the wallet |
| Astrologer | `9000000001` … `9000000006` | Seeded astrologers. The first three start online. |

Any other number creates a new account and goes through onboarding.

**Try a full consultation:** sign in as astrologer `9000000001` (Acharya Vikram Sharma) and stay on the dashboard. In the customer app, sign in as `9999999999`, open Acharya Vikram Sharma and tap **Chat**. Accept the request in the astrologer app and start chatting.

To bill every 10 seconds instead of every minute while testing: `BILLING_INTERVAL_MS=10000 npm start`.
To reset all data: `npm run seed` in `backend/`.

## Features

**Customer app**
- Phone + OTP login, then onboarding with birth details and zodiac sign
- Home: daily horoscope, search, filter by expertise, and live online/busy/offline badges
- Astrologer profile: bio, experience, languages, rate, rating and reviews
- Live chat with a typing indicator, running timer and live wallet balance
- A waiting screen while the astrologer decides, which can be cancelled
- Rating and review after the chat
- Wallet top-up and transaction history
- Chat history

**Astrologer app**
- Phone + OTP login, then setup of the public profile (expertise, languages, experience, ₹/min rate)
- Dashboard with an online/offline switch, today's earnings, minutes, chats and rating
- Chat request pop-ups (with vibration) on any screen, plus a pending list on the dashboard
- Chat screen with the client's birth details (name, gender, sign, birth date, time and place)
- Earnings: available balance, per-chat credits and withdrawals
- Consultation history

## API overview

| Method | Path | Who | Purpose |
| --- | --- | --- | --- |
| POST | `/auth/request-otp` | all | Send an OTP (in development it returns `devOtp`) |
| POST | `/auth/verify` | all | `{phone, otp, role}` → `{token, user}` |
| GET/PATCH | `/me` | all | Read or update your own profile |
| GET | `/horoscope/:sign` | all | Daily horoscope |
| GET | `/astrologers`, `/astrologers/:id` | customer | Browse astrologers. Supports `q`, `skill`, `language` and `online` filters. |
| GET | `/wallet` | all | Balance + transactions |
| POST | `/wallet/recharge` | customer | Add money (demo: credited instantly) |
| POST | `/astrologer/status` | astrologer | `{online: true/false}` |
| GET | `/astrologer/dashboard` | astrologer | Stats, pending and active chats |
| POST | `/astrologer/payouts` | astrologer | Withdraw earnings |
| GET/POST | `/sessions` | all / customer | List chats / request a chat |
| POST | `/sessions/:id/accept`, `/reject` | astrologer | Respond to a request |
| POST | `/sessions/:id/end` | all | End or cancel |
| GET/POST | `/sessions/:id/messages` | all | Chat messages |
| POST | `/sessions/:id/review` | customer | Rate 1–5 + comment |

Socket.IO events (the client connects with `auth: { token }`):
- Server → client: `session:request`, `session:update`, `message:new`, `typing`, `wallet:update`, `earnings:update`, `astrologer:update`
- Client → server: `message:send` (with ack), `typing`

## Before going to production

This is a working MVP. These parts are stubbed on purpose and need real implementations:

- **OTP**: replace the fixed `1234` with an SMS provider (Twilio, MSG91, Firebase Auth) and rate-limit the endpoint.
- **Payments**: `/wallet/recharge` credits instantly. Use Razorpay or Stripe orders, and credit the wallet only from a verified webhook.
- **Payouts**: connect RazorpayX or Stripe Connect, and add KYC/bank-account onboarding for astrologers.
- **Database**: `data.json` is a single-file store. Move to Postgres or MongoDB, and run billing timers on a durable job queue so chats survive restarts.
- **Astrologer vetting**: add an admin approval step before new astrologers appear in the customer app.
- **Push notifications**: use `expo-notifications` so astrologers get requests while the app is in the background.
- **Voice/video calls**: add Agora, Twilio or LiveKit if you want call consultations alongside chat.
- **Store builds**: `npx eas build -p android|ios` in each app folder. Set unique `bundleIdentifier` / `package` values in each `app.json`.
