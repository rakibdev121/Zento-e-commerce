# Zento Seller Center (separate service)

Seller Center ekhon Zento store theke **alada website**. Store ba admin panel-e kono seller page/API nai.

## Render-e alada service banan
- Repo: same repo, **Root directory**: (khali rakhun)
- Build command: `pip install -r seller_app/requirements.txt`
- Start command: `gunicorn --chdir seller_app server:app`
- Environment variables:
  - `DATABASE_URL`  (store-er shathe **same**)
  - `JWT_SECRET`    (store-er shathe **same**)
  - `STORE_PUBLIC_URL` = apnar store address (seller-er "View my store" link-er jonno)
  - optional: `RESEND_API_KEY`, `RESEND_FROM_EMAIL`

## Store (main) service-e add korun
- `SELLER_APP_URL` = seller service-er address (e.g. `https://zento-sellers.onrender.com`)
  Eta admin panel-er "seller approve" box ar email-e login link hishebe dekhay.

## Local run
```
pip install -r seller_app/requirements.txt
python seller_app/server.py      # http://localhost:5001
```
