# SIP Health Monitor

Real-time SIP endpoint monitoring with alerting via Email, Slack, and Webhook.

## Project Structure

```
sip-monitor/
├── backend/          # Node.js Express API + SIP pinger + alert engine
│   ├── server.js
│   ├── sip-pinger.js
│   ├── alert-manager.js
│   ├── package.json
│   └── .env.example
├── frontend/         # React dashboard
│   ├── src/App.js
│   ├── public/index.html
│   └── package.json
├── render.yaml       # Render deployment config
└── .gitignore
```

---

## Local Development

### 1. Clone and install
```bash
git clone https://github.com/YOUR_USERNAME/sip-monitor.git
cd sip-monitor
cd backend && npm install
cd ../frontend && npm install
```

### 2. Configure backend
```bash
cd backend
cp .env.example .env
# Edit .env with your SIP endpoints and alert settings
```

Example `.env`:
```
SIP_ENDPOINTS=Primary SIP|sip.yourprovider.com|5060,Backup SIP|sip.backup.com|5060
CHECK_INTERVAL=30
ALERT_EMAIL_ENABLED=true
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=you@gmail.com
SMTP_PASS=your_gmail_app_password
ALERT_EMAIL_TO=alerts@yourcompany.com
ALERT_SLACK_ENABLED=false
SLACK_WEBHOOK_URL=
```

> **Gmail App Password**: Go to Google Account → Security → 2-Step Verification → App Passwords → Generate one for "Mail"

### 3. Run locally
Terminal 1 (backend):
```bash
cd backend && npm run dev
# Runs on http://localhost:4000
```

Terminal 2 (frontend):
```bash
cd frontend && REACT_APP_API_URL=http://localhost:4000 npm start
# Runs on http://localhost:3000
```

---

## Deploy to GitHub + Render

### Step 1: Push to GitHub
```bash
cd sip-monitor
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/sip-monitor.git
git push -u origin main
```

### Step 2: Deploy Backend on Render
1. Go to [render.com](https://render.com) → New → Web Service
2. Connect your GitHub repo
3. Set **Root Directory** → `backend`
4. Set **Build Command** → `npm install`
5. Set **Start Command** → `npm start`
6. Go to **Environment** tab and add these variables:
   ```
   SIP_ENDPOINTS=Primary SIP|sip.yourprovider.com|5060
   CHECK_INTERVAL=30
   ALERT_EMAIL_ENABLED=true
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_USER=you@gmail.com
   SMTP_PASS=your_app_password
   ALERT_EMAIL_TO=alerts@yourcompany.com
   ```
7. Deploy → copy the backend URL (e.g. `https://sip-monitor-backend.onrender.com`)

### Step 3: Deploy Frontend on Render
1. Go to Render → New → Static Site
2. Connect the same GitHub repo
3. Set **Root Directory** → `frontend`
4. Set **Build Command** → `npm install && npm run build`
5. Set **Publish Directory** → `build`
6. Add environment variable:
   ```
   REACT_APP_API_URL=https://sip-monitor-backend.onrender.com
   ```
7. Deploy → your dashboard is live!

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/status` | All endpoints + current status |
| GET | `/api/history/:id` | Check history for one endpoint |
| GET | `/api/alerts` | Recent alert log |
| POST | `/api/check` | Trigger check on all endpoints |
| POST | `/api/check/:id` | Trigger check on one endpoint |
| GET | `/api/health` | Server health check |

---

## How SIP OPTIONS Ping Works

The monitor sends a UDP `SIP OPTIONS` message to each endpoint:
- `200 OK` → **UP** ✅
- `4xx` response → **DEGRADED** 🟡  
- No response / `5xx` → **DOWN** 🔴

Alerts fire when status is not UP, with a **5-minute cooldown** per endpoint to avoid spam.

---

## Alert Channels

| Channel | Config Key | Notes |
|---------|-----------|-------|
| Email | `ALERT_EMAIL_ENABLED=true` | Uses SMTP (Gmail supported) |
| Slack | `ALERT_SLACK_ENABLED=true` | Requires Incoming Webhook URL |
| Webhook | `ALERT_WEBHOOK_ENABLED=true` | POST to any HTTP endpoint |

Multiple channels can be active simultaneously.
