#!/usr/bin/env bash
cd "C:/Users/abiea/Downloads/clipflow"
DID=2bf66f4b-bebf-4064-bba0-f0e727cd6c84
NEWURL="https://clipflowing.com"
SK=$(grep '^STRIPE_SECRET_KEY=' .env | cut -d= -f2-)
WE=we_1Tuy8JH3ugapbPhbOWENgyIX
for i in $(seq 1 60); do
  OUT=$(railway domain status $DID 2>&1)
  if echo "$OUT" | grep -qiE "Verified: *yes|ISSUED"; then
    echo "[$i] VERIFIED + cert issued"
    break
  fi
  [ $((i % 5)) -eq 0 ] && echo "[$i] still validating…"
  sleep 20
done
echo "=== finishing: BASE_URL, Stripe webhook, redeploy ==="
railway variables --set "BASE_URL=$NEWURL" --skip-deploys >/dev/null 2>&1 && echo "BASE_URL set"
node -e 'const fs=require("fs");fs.writeFileSync(".env",fs.readFileSync(".env","utf8").replace(/^BASE_URL=.*$/m,"BASE_URL=https://clipflowing.com"))'
curl -s "https://api.stripe.com/v1/webhook_endpoints/$WE" -u "$SK:" -d "url=$NEWURL/webhooks/stripe" >/dev/null && echo "Stripe webhook repointed"
railway up --detach >/dev/null 2>&1 && echo "redeploy triggered"
echo "=== DONE ==="
