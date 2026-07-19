#!/usr/bin/env bash
# Auto-finish clipflowing.com wiring once Railway verifies the domain.
set -e
cd "C:/Users/abiea/Downloads/clipflow"
NEWURL="https://clipflowing.com"
SK=$(grep '^STRIPE_SECRET_KEY=' .env | cut -d= -f2-)
WE=we_1Tuy8JH3ugapbPhbOWENgyIX

echo "[finish] setting BASE_URL=$NEWURL on Railway"
railway variables --set "BASE_URL=$NEWURL" --skip-deploys >/dev/null 2>&1
node -e 'const fs=require("fs");let e=fs.readFileSync(".env","utf8").replace(/^BASE_URL=.*$/m,"BASE_URL=https://clipflowing.com");fs.writeFileSync(".env",e)'

echo "[finish] pointing Stripe webhook at $NEWURL/webhooks/stripe"
curl -s "https://api.stripe.com/v1/webhook_endpoints/$WE" -u "$SK:" \
  -d "url=$NEWURL/webhooks/stripe" >/dev/null

echo "[finish] redeploying"
railway up --detach >/dev/null 2>&1
echo "[finish] done — BASE_URL, Stripe webhook, redeploy all pointed at clipflowing.com"
