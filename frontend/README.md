<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1ataWCPPTcJwIFIhoIL8recfQ9SE3WD36

## Run Locally

**Prerequisites:** Node.js

1. Install dependencies: `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key.
3. **Backend:** From the project root run `npm run dev`. The API runs on port **4002** (override with `PORT` in root `.env`).
4. **Frontend:** From this folder run `npm run dev`. The app runs on port **4001** and proxies `/api` and `/socket.io` to the backend at 4002.
5. Open http://localhost:4001 and log in. The **Painel** (QR WhatsApp) is at `/painel` (admin/gestor only).
