"""
ZENTO SELLER CENTER  -  separate service
========================================
This is a different website from the Zento store. It has its own address, its own
login, and its own web pages. The customer store and the admin panel do NOT contain
any seller page or seller API any more.

It shares only two things with the store (on purpose):
  * the same DATABASE_URL  (products, orders and the seller wallet live in one place)
  * the same JWT_SECRET    (login tokens)

Run locally :  python seller_app/server.py
Deploy      :  gunicorn --chdir seller_app server:app
Needs env   :  DATABASE_URL, JWT_SECRET
Optional    :  STORE_PUBLIC_URL (link to the public store page),
               SELLER_APP_URL   (used in emails to sellers), RESEND_API_KEY, RESEND_FROM_EMAIL
"""
import os
import time
import importlib.util
from datetime import datetime, timedelta, timezone

import jwt
import psycopg2
from dotenv import load_dotenv
from flask import Flask, request, send_from_directory
from flask_cors import CORS
from werkzeug.security import check_password_hash

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
WEB = os.path.join(HERE, "web")

load_dotenv(os.path.join(ROOT, ".env"))
load_dotenv()

JWT_SECRET = os.environ.get("JWT_SECRET", "change-this-secret-in-render")

# shared marketplace logic (wallet, commission, products, coupons, ...)
_spec = importlib.util.spec_from_file_location("zento_marketplace", os.path.join(ROOT, "backend", "marketplace.py"))
mp = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mp)

app = Flask(__name__)
CORS(app)


def get_authenticated_user():
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return None
    try:
        return jwt.decode(auth[7:].strip(), JWT_SECRET, algorithms=["HS256"])
    except Exception:
        return None


def no_admin():
    return None  # admin actions are not available in the Seller Center


# ---- seller login (only users that own a seller account can sign in here) ----
_fails = {}


def _wait(key):
    n, until = _fails.get(key, (0, 0))
    return max(0, int(until - time.time())) if n >= 5 else 0


@app.route("/api/seller/login", methods=["POST"])
def seller_login():
    d = request.get_json(silent=True) or {}
    email = str(d.get("email", "")).strip().lower()
    password = str(d.get("password", ""))
    if not email or not password:
        return {"status": "error", "message": "Email and password are required"}, 400
    wait = _wait(email)
    if wait:
        return {"status": "error", "message": f"Too many failed attempts. Try again in {max(1, wait // 60)} minute(s)."}, 429

    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    try:
        cur = conn.cursor()
        cur.execute("""SELECT u.id, u.name, u.email, u.password_hash, s.id
                       FROM users u JOIN sellers s ON s.user_id = u.id WHERE u.email = %s""", (email,))
        row = cur.fetchone()
    finally:
        conn.close()

    if not row or not check_password_hash(row[3], password):
        n, _ = _fails.get(email, (0, 0))
        _fails[email] = (n + 1, time.time() + 900)
        return {"status": "error", "message": "Invalid email or password"}, 401
    _fails.pop(email, None)

    token = jwt.encode({"user_id": row[0], "email": row[2], "role": "seller",
                        "exp": datetime.now(timezone.utc) + timedelta(days=7)}, JWT_SECRET, algorithm="HS256")
    return {"status": "success", "token": token,
            "user": {"id": row[0], "name": row[1], "email": row[2], "role": "seller"}}


def _ensure_base():
    # the store creates users/orders/order_items; make sure they exist before seller tables
    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    try:
        cur = conn.cursor()
        cur.execute("SELECT to_regclass('public.users'), to_regclass('public.orders'), to_regclass('public.order_items'), to_regclass('public.products')")
        if not all(cur.fetchone()):
            raise RuntimeError("Run the Zento store once first: users/orders/products tables are missing")
    finally:
        conn.close()


mp.init_marketplace(app, get_user=get_authenticated_user, admin_user=no_admin,
                    base_dir=ROOT, ensure_base=_ensure_base, mode="seller")


@app.route("/health")
def health():
    return {"status": "ok", "service": "zento-seller-center"}


@app.route("/")
def home():
    return send_from_directory(WEB, "index.html")


@app.route("/<path:filename>")
def files(filename):
    if filename.startswith("api/"):
        return {"status": "error", "message": "Not found"}, 404
    path = os.path.join(WEB, filename)
    if os.path.isfile(path):
        return send_from_directory(WEB, filename)
    return send_from_directory(WEB, "index.html")


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5001)), debug=False)
