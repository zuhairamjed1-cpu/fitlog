# FitLog

Your personal AI-powered fitness journal — track sleep, diet, workouts, and sports, and get personalized coaching from an AI that learns your data.

## What's inside

- ✦ AI Coach — chat with an AI that knows your data, plus full 14-day analysis
- ◐ Sleep tracking with quality + duration
- ◉ Diet logging via text description or photo (AI nutrition analysis)
- ◆ Workout logging — paste straight from the Strong app
- ◇ Sports tracking with AI calorie estimation
- ⊙ Goals & macro targets with auto-calculation per goal

---

## Deploy to Vercel (recommended — free)

### Step 1: Get an Anthropic API key

1. Go to **[console.anthropic.com](https://console.anthropic.com)** → sign up / log in
2. Click **API Keys** → **Create Key**
3. Copy the key (looks like `sk-ant-...`)
4. Add **$5–10 of credits** at console.anthropic.com → Billing (you'll burn through this *very* slowly)

### Step 2: Push to GitHub

```bash
cd fitlog
git init
git add .
git commit -m "Initial commit"
```

Create a new GitHub repo, then:

```bash
git remote add origin https://github.com/YOUR_USERNAME/fitlog.git
git branch -M main
git push -u origin main
```

### Step 3: Deploy on Vercel

1. Go to **[vercel.com](https://vercel.com)** → sign in with GitHub
2. Click **Add New… → Project** → import your `fitlog` repo
3. Before clicking **Deploy**, expand **Environment Variables** and add:
   - **Name**: `ANTHROPIC_API_KEY`
   - **Value**: paste your `sk-ant-...` key
4. Click **Deploy**

Two minutes later you'll have a URL like `fitlog-yourname.vercel.app` 🎉

### Step 4: Add to your phone's home screen

- **iPhone**: open the URL in Safari → Share button → **Add to Home Screen**
- **Android**: open in Chrome → menu (⋮) → **Add to Home Screen**

It'll launch full-screen with no browser bar — feels native.

---

## Run locally for development

```bash
npm install
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env.local
npm run dev
```

Open http://localhost:5173

> Note: API routes (`/api/chat`) only work when deployed to Vercel or run via `vercel dev`. To test locally with full functionality, install Vercel CLI:
> ```bash
> npm i -g vercel
> vercel dev
> ```

---

## Data & privacy

- All your fitness data lives in your browser's `localStorage` — never sent anywhere except to Claude when you ask the coach a question.
- The API key stays secret on Vercel's servers; it's never exposed to the browser.
- Clear your browser data and your logs are gone (no cloud backup yet).

## Cost

Every AI feature (food analysis, sport calorie estimate, coach chat, full analysis) calls Claude. Light personal use ≈ a few cents/day. Anthropic gives you usage-based billing — you only pay for what you use.

## Want a custom domain?

In Vercel → your project → **Settings → Domains** → add `fitlog.yourname.com` (or buy a domain through Vercel).
