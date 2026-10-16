"""
ZENTO MARKETPLACE MODULE
------------------------
Multi-vendor features added on top of the existing Zento Flask app:

  * Seller applications + admin approval + "Verified" badge
  * Seller dashboard API (own products, orders, store profile)
  * Public seller store pages  (/store/<slug>)
  * Platform commission (default 10%) taken from every delivered sale
  * Seller wallet (ledger based) + withdrawal requests approved by admin
  * Product reviews with 1-5 stars

Plugged in from the bottom of backend/app.py via init_marketplace().
Tables are created automatically (CREATE TABLE IF NOT EXISTS) at boot.
Existing tables are only extended with new nullable columns.
"""

import os
import re
import secrets
import logging
import datetime
from contextlib import contextmanager
from decimal import Decimal, ROUND_HALF_UP
from functools import wraps

import psycopg2
import psycopg2.extras
from flask import Blueprint, request, send_from_directory, abort
from werkzeug.security import generate_password_hash, check_password_hash

log = logging.getLogger("zento.marketplace")
bp = Blueprint("marketplace", __name__)
_H = {}  # helpers injected from app.py

DEFAULT_SETTINGS = {
    "commission_percent": "10",
    "min_withdrawal": "500",
    "reviews_require_purchase": "true",
}
READY = False  # becomes True once tables exist
SELLER_STATUSES = ("pending", "approved", "rejected", "suspended")
PAYOUT_METHODS = ("bkash", "nagad", "rocket", "bank")


# ---------------------------------------------------------------------
# small helpers
# ---------------------------------------------------------------------
class ApiError(Exception):
    def __init__(self, message, code=400):
        super().__init__(message)
        self.message = message
        self.code = code


def api(fn):
    """Turn ApiError / unexpected errors into JSON responses."""
    @wraps(fn)
    def wrapper(*args, **kwargs):
        try:
            return ser(fn(*args, **kwargs))
        except ApiError as e:
            return {"status": "error", "message": e.message}, e.code
        except Exception:
            log.exception("marketplace error in %s", fn.__name__)
            return {"status": "error", "message": "Server error. Please try again."}, 500
    return wrapper


def ser(obj):
    """Make DB values JSON friendly (Decimal -> float, datetime -> str)."""
    if isinstance(obj, tuple) and len(obj) == 2 and isinstance(obj[1], int):
        return ser(obj[0]), obj[1]
    if isinstance(obj, dict):
        return {k: ser(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [ser(v) for v in obj]
    if isinstance(obj, Decimal):
        return float(obj)
    if isinstance(obj, (datetime.datetime, datetime.date)):
        return obj.isoformat()
    return obj


def ok(**kw):
    d = {"status": "success"}
    d.update(kw)
    return d


@contextmanager
def db():
    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        yield conn, cur
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def q2(v):
    return Decimal(str(v)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def text(value, maxlen):
    return str(value or "").strip()[:maxlen]


def safe_url(value):
    value = text(value, 600)
    if value and not re.match(r"^https?://", value, re.I):
        raise ApiError("Image link must start with http:// or https://")
    return value


def slugify(name):
    s = re.sub(r"[^a-z0-9]+", "-", str(name).lower()).strip("-")
    return s[:40] or "store"


def unique_slug(cur, name):
    base = slugify(name)
    slug, n = base, 1
    while True:
        cur.execute("SELECT 1 FROM sellers WHERE slug=%s", (slug,))
        if not cur.fetchone():
            return slug
        n += 1
        slug = f"{base}-{n}"


def current_user():
    u = _H["get_user"]()
    if not u:
        raise ApiError("Please log in first", 401)
    return u


def admin_required():
    u = _H["admin_user"]()
    if not u:
        raise ApiError("Admin authentication required", 401)
    return u


def get_settings(cur):
    cur.execute("SELECT key, value FROM marketplace_settings")
    d = dict(DEFAULT_SETTINGS)
    for r in cur.fetchall():
        d[r["key"]] = r["value"]
    return d


def commission_rate(cur):
    try:
        return Decimal(get_settings(cur)["commission_percent"])
    except Exception:
        return Decimal(DEFAULT_SETTINGS["commission_percent"])


def seller_required(cur, approved=True):
    u = current_user()
    cur.execute("SELECT * FROM sellers WHERE user_id=%s", (u["user_id"],))
    s = cur.fetchone()
    if not s:
        raise ApiError("You do not have a seller account yet", 403)
    if approved and s["status"] != "approved":
        raise ApiError(f"Your seller account is {s['status']}. Admin approval is required.", 403)
    return u, s


def public_seller(s):
    return {
        "id": s["id"], "store_name": s["store_name"], "slug": s["slug"],
        "description": s.get("description") or "", "logo_url": s.get("logo_url") or "",
        "banner_url": s.get("banner_url") or "", "city": s.get("city") or "",
        "is_verified": bool(s.get("is_verified")), "joined": s.get("approved_at") or s.get("created_at"),
    }


# ---------------------------------------------------------------------
# schema
# ---------------------------------------------------------------------
SCHEMA_SQL = """
SELECT pg_advisory_xact_lock(7771001);

CREATE TABLE IF NOT EXISTS sellers (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    store_name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    description TEXT DEFAULT '',
    logo_url TEXT DEFAULT '',
    banner_url TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    address TEXT DEFAULT '',
    city TEXT DEFAULT '',
    payout_method TEXT DEFAULT '',
    payout_account TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    is_verified BOOLEAN NOT NULL DEFAULT FALSE,
    admin_note TEXT DEFAULT '',
    approved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE products ADD COLUMN IF NOT EXISTS seller_id BIGINT REFERENCES sellers(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS products_seller_idx ON products (seller_id);

ALTER TABLE order_items ADD COLUMN IF NOT EXISTS seller_id BIGINT;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS commission_rate NUMERIC(5,2);
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS commission_amount NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS seller_earning NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS credited_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS order_items_seller_idx ON order_items (seller_id);

CREATE TABLE IF NOT EXISTS withdrawals (
    id BIGSERIAL PRIMARY KEY,
    seller_id BIGINT NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
    amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    method TEXT NOT NULL,
    account TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    admin_note TEXT DEFAULT '',
    processed_by BIGINT,
    processed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS seller_transactions (
    id BIGSERIAL PRIMARY KEY,
    seller_id BIGINT NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    amount NUMERIC(12,2) NOT NULL,
    order_id BIGINT,
    order_item_id BIGINT,
    withdrawal_id BIGINT,
    note TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS seller_tx_idx ON seller_transactions (seller_id, id);

CREATE TABLE IF NOT EXISTS reviews (
    id BIGSERIAL PRIMARY KEY,
    product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    title TEXT DEFAULT '',
    comment TEXT DEFAULT '',
    verified_purchase BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (product_id, user_id)
);

CREATE TABLE IF NOT EXISTS marketplace_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
ALTER TABLE sellers ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS seller_applications (
    id BIGSERIAL PRIMARY KEY,
    owner_name TEXT NOT NULL,
    store_name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT NOT NULL,
    city TEXT DEFAULT '',
    address TEXT DEFAULT '',
    description TEXT DEFAULT '',
    id_number TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    admin_note TEXT DEFAULT '',
    seller_id BIGINT REFERENCES sellers(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    reviewed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS seller_apps_status_idx ON seller_applications (status, id);

CREATE TABLE IF NOT EXISTS coupons (
    id BIGSERIAL PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    seller_id BIGINT REFERENCES sellers(id) ON DELETE CASCADE,
    discount_type TEXT NOT NULL DEFAULT 'percent',
    value NUMERIC(12,2) NOT NULL,
    max_discount NUMERIC(12,2),
    min_order NUMERIC(12,2) NOT NULL DEFAULT 0,
    usage_limit INTEGER,
    per_user_limit INTEGER NOT NULL DEFAULT 1,
    used_count INTEGER NOT NULL DEFAULT 0,
    starts_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS coupons_seller_idx ON coupons (seller_id);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS coupon_id BIGINT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS coupon_code TEXT DEFAULT '';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_total NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS coupon_id BIGINT;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS discount_by TEXT DEFAULT '';
"""


def ensure_tables():
    global READY
    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    try:
        cur = conn.cursor()
        cur.execute(SCHEMA_SQL)
        conn.commit()
        READY = True
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


# ---------------------------------------------------------------------
# wallet / commission (also called from app.py when an order is delivered)
# ---------------------------------------------------------------------
def mp_credit_order(cur, order_id):
    """
    Called with the app's own cursor inside the 'delivered' status update.
    Takes the platform commission and credits the seller wallet.
    Safe to call twice: items already credited are skipped.
    """
    cur.execute("SELECT value FROM marketplace_settings WHERE key='commission_percent'")
    row = cur.fetchone()
    try:
        rate = Decimal(row[0] if row else DEFAULT_SETTINGS["commission_percent"])
    except Exception:
        rate = Decimal(DEFAULT_SETTINGS["commission_percent"])

    cur.execute("""
        SELECT id, seller_id, subtotal, COALESCE(discount_amount,0), COALESCE(discount_by,'')
        FROM order_items
        WHERE order_id=%s AND seller_id IS NOT NULL AND credited_at IS NULL
        FOR UPDATE
    """, (order_id,))
    for item_id, seller_id, subtotal, discount, funded_by in cur.fetchall():
        gross = Decimal(subtotal)
        discount = Decimal(discount or 0)
        if funded_by == "seller":
            # Seller's own coupon: the seller carries the discount.
            # Commission is taken on what the customer actually paid for the item.
            base = gross - discount
            note = (f"Order #{order_id}: sale {gross} minus your coupon discount {discount}"
                    f" = {base}, minus {rate}% commission")
        else:
            # Zento's coupon (or no coupon): the seller still gets the full price.
            # Zento pays the discount from its own share.
            base = gross
            note = f"Order #{order_id}: sale {gross} minus {rate}% commission"
            if discount > 0:
                note += f" (Zento coupon discount {discount} paid by Zento, not by you)"
        commission = q2(base * rate / 100)
        earning = base - commission
        cur.execute("""
            UPDATE order_items
            SET commission_rate=%s, commission_amount=%s, seller_earning=%s, credited_at=NOW()
            WHERE id=%s
        """, (rate, commission, earning, item_id))
        cur.execute("""
            INSERT INTO seller_transactions (seller_id, type, amount, order_id, order_item_id, note)
            VALUES (%s, 'sale', %s, %s, %s, %s)
        """, (seller_id, earning, order_id, item_id, f"{note} ({commission})"))


def wallet_summary(cur, seller_id):
    rate = commission_rate(cur)
    cur.execute("SELECT COALESCE(SUM(amount),0) AS v FROM seller_transactions WHERE seller_id=%s", (seller_id,))
    available = cur.fetchone()["v"]
    cur.execute("SELECT COALESCE(SUM(amount),0) AS v FROM seller_transactions WHERE seller_id=%s AND type='sale'", (seller_id,))
    total_earned = cur.fetchone()["v"]
    cur.execute("SELECT COALESCE(SUM(commission_amount),0) AS v FROM order_items WHERE seller_id=%s AND credited_at IS NOT NULL", (seller_id,))
    commission_paid = cur.fetchone()["v"]
    cur.execute("SELECT COALESCE(SUM(subtotal),0) AS v FROM order_items WHERE seller_id=%s AND credited_at IS NULL", (seller_id,))
    pending_gross = cur.fetchone()["v"]
    pending_earnings = q2(Decimal(pending_gross) * (100 - rate) / 100)
    cur.execute("SELECT status, COALESCE(SUM(amount),0) AS v FROM withdrawals WHERE seller_id=%s GROUP BY status", (seller_id,))
    w = {r["status"]: r["v"] for r in cur.fetchall()}
    return {
        "available": available, "pending_earnings": pending_earnings,
        "total_earned": total_earned, "commission_paid": commission_paid,
        "withdrawn": w.get("approved", 0), "pending_withdrawal": w.get("pending", 0),
        "commission_percent": rate,
    }


# ---------------------------------------------------------------------
# SELLER: apply, profile
# ---------------------------------------------------------------------
@bp.route("/api/seller/apply", methods=["POST"])
@api
def seller_apply():
    u = current_user()
    d = request.get_json(silent=True) or {}
    store_name = text(d.get("store_name"), 60)
    phone = text(d.get("phone"), 30)
    if len(store_name) < 3:
        raise ApiError("Store name must be at least 3 characters")
    if len("".join(c for c in phone if c.isdigit())) < 10:
        raise ApiError("Enter a valid phone number")
    with db() as (conn, cur):
        cur.execute("SELECT id, status FROM sellers WHERE user_id=%s", (u["user_id"],))
        existing = cur.fetchone()
        fields = (store_name, text(d.get("description"), 800), phone,
                  text(d.get("address"), 300), text(d.get("city"), 80))
        if existing:
            if existing["status"] != "rejected":
                raise ApiError(f"You already applied (status: {existing['status']})", 409)
            cur.execute("""
                UPDATE sellers SET store_name=%s, description=%s, phone=%s, address=%s, city=%s,
                       status='pending', admin_note='', updated_at=NOW()
                WHERE id=%s RETURNING id
            """, fields + (existing["id"],))
        else:
            slug = unique_slug(cur, store_name)
            cur.execute("""
                INSERT INTO sellers (user_id, store_name, description, phone, address, city, slug)
                VALUES (%s,%s,%s,%s,%s,%s,%s) RETURNING id
            """, (u["user_id"],) + fields + (slug,))
    return ok(message="Application submitted. Admin will review it soon.", seller_status="pending")


@bp.route("/api/seller/me", methods=["GET"])
@api
def seller_me():
    current_user()
    with db() as (conn, cur):
        u = current_user()
        cur.execute("SELECT * FROM sellers WHERE user_id=%s", (u["user_id"],))
        s = cur.fetchone()
        if not s:
            return ok(seller=None)
        out = dict(s)
        out.pop("user_id", None)
        data = {"seller": out, "login_id": u.get("email", "")}
        if s["status"] == "approved":
            data["wallet"] = wallet_summary(cur, s["id"])
            cur.execute("SELECT COUNT(*) AS n FROM products WHERE seller_id=%s", (s["id"],))
            data["product_count"] = cur.fetchone()["n"]
            cur.execute("""SELECT COUNT(DISTINCT order_id) AS n, COALESCE(SUM(quantity),0) AS units
                           FROM order_items WHERE seller_id=%s""", (s["id"],))
            r = cur.fetchone()
            data["order_count"], data["units_sold"] = r["n"], r["units"]
            cur.execute("""SELECT COALESCE(AVG(r.rating),0)::numeric(3,2) AS avg, COUNT(r.id) AS cnt
                           FROM reviews r JOIN products p ON p.id=r.product_id WHERE p.seller_id=%s""", (s["id"],))
            r = cur.fetchone()
            data["rating_avg"], data["rating_count"] = r["avg"], r["cnt"]
            cur.execute("SELECT value FROM marketplace_settings WHERE key='min_withdrawal'")
            m = cur.fetchone()
            data["min_withdrawal"] = Decimal(m["value"]) if m else Decimal(DEFAULT_SETTINGS["min_withdrawal"])
        return ok(**data)


@bp.route("/api/seller/me", methods=["PUT"])
@api
def seller_update_me():
    d = request.get_json(silent=True) or {}
    current_user()
    with db() as (conn, cur):
        u, s = seller_required(cur, approved=False)
        method = text(d.get("payout_method"), 20).lower()
        if method and method not in PAYOUT_METHODS:
            raise ApiError("Payout method must be bkash, nagad, rocket or bank")
        store_name = text(d.get("store_name"), 60) or s["store_name"]
        if len(store_name) < 3:
            raise ApiError("Store name must be at least 3 characters")
        cur.execute("""
            UPDATE sellers SET store_name=%s, description=%s, logo_url=%s, banner_url=%s,
                   phone=%s, address=%s, city=%s, payout_method=%s, payout_account=%s, updated_at=NOW()
            WHERE id=%s
        """, (store_name, text(d.get("description"), 800), safe_url(d.get("logo_url")),
              safe_url(d.get("banner_url")), text(d.get("phone"), 30), text(d.get("address"), 300),
              text(d.get("city"), 80), method, text(d.get("payout_account"), 60), s["id"]))
    return ok(message="Store profile saved")


# ---------------------------------------------------------------------
# SELLER: products
# ---------------------------------------------------------------------
def product_payload(d):
    name = text(d.get("name"), 200)
    if not name:
        raise ApiError("Product name is required")
    try:
        price = q2(d.get("price"))
        stock = int(d.get("stock", 0))
    except Exception:
        raise ApiError("Price and stock must be numbers")
    if price < 0 or stock < 0:
        raise ApiError("Price and stock cannot be negative")
    return (name, text(d.get("description"), 3000), price, safe_url(d.get("image_url")),
            text(d.get("category"), 80), stock)


PRODUCT_COLS = "id, name, description, price, image_url, category, stock, created_at, seller_id"


@bp.route("/api/seller/products", methods=["GET"])
@api
def seller_products():
    current_user()
    with db() as (conn, cur):
        u, s = seller_required(cur)
        cur.execute(f"""
            SELECT p.id, p.name, p.description, p.price, p.image_url, p.category, p.stock, p.created_at,
                   COALESCE(r.avg,0) AS rating_avg, COALESCE(r.cnt,0) AS rating_count
            FROM products p
            LEFT JOIN (SELECT product_id, AVG(rating)::numeric(3,2) AS avg, COUNT(*) AS cnt
                       FROM reviews GROUP BY product_id) r ON r.product_id = p.id
            WHERE p.seller_id=%s ORDER BY p.id DESC
        """, (s["id"],))
        return ok(products=cur.fetchall())


@bp.route("/api/seller/products", methods=["POST"])
@api
def seller_create_product():
    payload = product_payload(request.get_json(silent=True) or {})
    current_user()
    with db() as (conn, cur):
        u, s = seller_required(cur)
        cur.execute(f"""
            INSERT INTO products (name, description, price, image_url, category, stock, seller_id)
            VALUES (%s,%s,%s,%s,%s,%s,%s) RETURNING {PRODUCT_COLS}
        """, payload + (s["id"],))
        return ok(message="Product added", product=cur.fetchone()), 201


@bp.route("/api/seller/products/<int:pid>", methods=["PUT"])
@api
def seller_update_product(pid):
    payload = product_payload(request.get_json(silent=True) or {})
    current_user()
    with db() as (conn, cur):
        u, s = seller_required(cur)
        cur.execute(f"""
            UPDATE products SET name=%s, description=%s, price=%s, image_url=%s, category=%s, stock=%s
            WHERE id=%s AND seller_id=%s RETURNING {PRODUCT_COLS}
        """, payload + (pid, s["id"]))
        row = cur.fetchone()
        if not row:
            raise ApiError("Product not found", 404)
        return ok(message="Product updated", product=row)


@bp.route("/api/seller/products/<int:pid>", methods=["DELETE"])
@api
def seller_delete_product(pid):
    current_user()
    with db() as (conn, cur):
        u, s = seller_required(cur)
        cur.execute("DELETE FROM products WHERE id=%s AND seller_id=%s RETURNING id", (pid, s["id"]))
        if not cur.fetchone():
            raise ApiError("Product not found", 404)
    return ok(message="Product deleted")


# ---------------------------------------------------------------------
# SELLER: orders + wallet + withdrawals
# ---------------------------------------------------------------------
@bp.route("/api/seller/orders", methods=["GET"])
@api
def seller_orders():
    current_user()
    with db() as (conn, cur):
        u, s = seller_required(cur)
        cur.execute("""
            SELECT oi.id, oi.order_id, oi.product_id, oi.product_name, oi.quantity, oi.price, oi.subtotal,
                   oi.commission_amount, oi.seller_earning, oi.credited_at,
                   o.status, o.customer_name, o.phone, o.address, o.city, o.payment_method, o.created_at
            FROM order_items oi JOIN orders o ON o.id = oi.order_id
            WHERE oi.seller_id=%s ORDER BY oi.id DESC LIMIT 300
        """, (s["id"],))
        return ok(orders=cur.fetchall())


@bp.route("/api/seller/wallet", methods=["GET"])
@api
def seller_wallet():
    current_user()
    with db() as (conn, cur):
        u, s = seller_required(cur)
        summary = wallet_summary(cur, s["id"])
        cur.execute("SELECT * FROM seller_transactions WHERE seller_id=%s ORDER BY id DESC LIMIT 100", (s["id"],))
        tx = cur.fetchall()
        cur.execute("SELECT * FROM withdrawals WHERE seller_id=%s ORDER BY id DESC LIMIT 100", (s["id"],))
        wd = cur.fetchall()
        return ok(wallet=summary, transactions=tx, withdrawals=wd)


@bp.route("/api/seller/withdrawals", methods=["POST"])
@api
def seller_request_withdrawal():
    d = request.get_json(silent=True) or {}
    try:
        amount = q2(d.get("amount"))
    except Exception:
        raise ApiError("Enter a valid amount")
    current_user()
    with db() as (conn, cur):
        u, s = seller_required(cur)
        # lock the seller row so two requests cannot both spend the same balance
        cur.execute("SELECT id, payout_method, payout_account FROM sellers WHERE id=%s FOR UPDATE", (s["id"],))
        s = cur.fetchone()
        if not s["payout_method"] or not s["payout_account"]:
            raise ApiError("Set your payout method and account number in Store Profile first")
        settings = get_settings(cur)
        minimum = Decimal(settings["min_withdrawal"])
        if amount < minimum:
            raise ApiError(f"Minimum withdrawal is {minimum}")
        cur.execute("SELECT COALESCE(SUM(amount),0) AS v FROM seller_transactions WHERE seller_id=%s", (s["id"],))
        available = cur.fetchone()["v"]
        if amount > available:
            raise ApiError(f"Not enough balance. Available: {available}")
        cur.execute("""
            INSERT INTO withdrawals (seller_id, amount, method, account)
            VALUES (%s,%s,%s,%s) RETURNING id
        """, (s["id"], amount, s["payout_method"], s["payout_account"]))
        wid = cur.fetchone()["id"]
        cur.execute("""
            INSERT INTO seller_transactions (seller_id, type, amount, withdrawal_id, note)
            VALUES (%s,'withdrawal_hold',%s,%s,%s)
        """, (s["id"], -amount, wid, f"Withdrawal request #{wid}"))
    return ok(message="Withdrawal request sent. Admin will review it.", withdrawal_id=wid), 201


# ---------------------------------------------------------------------
# PUBLIC: seller stores
# ---------------------------------------------------------------------
RATING_JOIN = """
    LEFT JOIN (SELECT product_id, AVG(rating)::numeric(3,2) AS avg, COUNT(*) AS cnt
               FROM reviews GROUP BY product_id) r ON r.product_id = p.id
"""


@bp.route("/api/stores", methods=["GET"])
@api
def list_stores():
    with db() as (conn, cur):
        cur.execute("""
            SELECT s.id, s.store_name, s.slug, s.description, s.logo_url, s.banner_url, s.city,
                   s.is_verified, s.approved_at, s.created_at,
                   (SELECT COUNT(*) FROM products p WHERE p.seller_id = s.id) AS product_count
            FROM sellers s WHERE s.status='approved' ORDER BY s.is_verified DESC, s.id DESC LIMIT 100
        """)
        return ok(stores=cur.fetchall())


@bp.route("/api/stores/<slug>", methods=["GET"])
@api
def get_store(slug):
    with db() as (conn, cur):
        cur.execute("SELECT * FROM sellers WHERE slug=%s AND status='approved'", (slug.lower(),))
        s = cur.fetchone()
        if not s:
            raise ApiError("Store not found", 404)
        cur.execute(f"""
            SELECT p.id, p.name, p.description, p.price, p.image_url, p.category, p.stock, p.created_at,
                   COALESCE(r.avg,0) AS rating_avg, COALESCE(r.cnt,0) AS rating_count
            FROM products p {RATING_JOIN}
            WHERE p.seller_id=%s ORDER BY p.id DESC
        """, (s["id"],))
        products = cur.fetchall()
        cur.execute("""SELECT COALESCE(AVG(r.rating),0)::numeric(3,2) AS avg, COUNT(r.id) AS cnt
                       FROM reviews r JOIN products p ON p.id=r.product_id WHERE p.seller_id=%s""", (s["id"],))
        rr = cur.fetchone()
        store = public_seller(s)
        store.update(rating_avg=rr["avg"], rating_count=rr["cnt"], product_count=len(products))
        return ok(store=store, products=products)


# ---------------------------------------------------------------------
# REVIEWS
# ---------------------------------------------------------------------
def mask_name(name):
    parts = str(name or "Customer").split()
    if not parts:
        return "Customer"
    return parts[0] + (f" {parts[1][0]}." if len(parts) > 1 else "")


def has_delivered_purchase(cur, user_id, product_id):
    cur.execute("""
        SELECT 1 FROM order_items oi JOIN orders o ON o.id = oi.order_id
        WHERE o.user_id=%s AND oi.product_id=%s AND o.status='delivered' LIMIT 1
    """, (user_id, product_id))
    return bool(cur.fetchone())


@bp.route("/api/products/<int:pid>/reviews", methods=["GET"])
@api
def get_reviews(pid):
    user = _H["get_user"]()  # optional
    with db() as (conn, cur):
        cur.execute("SELECT id, seller_id FROM products WHERE id=%s", (pid,))
        prod = cur.fetchone()
        if not prod:
            raise ApiError("Product not found", 404)
        cur.execute("SELECT rating, COUNT(*) AS n FROM reviews WHERE product_id=%s GROUP BY rating", (pid,))
        counts = {r["rating"]: r["n"] for r in cur.fetchall()}
        total = sum(counts.values())
        avg = round(sum(k * v for k, v in counts.items()) / total, 2) if total else 0
        cur.execute("""
            SELECT r.id, r.rating, r.title, r.comment, r.verified_purchase, r.created_at, u.name AS user_name, r.user_id
            FROM reviews r JOIN users u ON u.id = r.user_id
            WHERE r.product_id=%s ORDER BY r.id DESC LIMIT 50
        """, (pid,))
        rows = cur.fetchall()
        mine = None
        reviews = []
        for r in rows:
            item = {k: r[k] for k in ("id", "rating", "title", "comment", "verified_purchase", "created_at")}
            item["user_name"] = mask_name(r["user_name"])
            if user and r["user_id"] == user["user_id"]:
                mine = item
            reviews.append(item)
        can_review, reason = False, "Log in to write a review"
        if user:
            settings = get_settings(cur)
            owner = None
            if prod["seller_id"]:
                cur.execute("SELECT user_id FROM sellers WHERE id=%s", (prod["seller_id"],))
                owner = cur.fetchone()
            if owner and owner["user_id"] == user["user_id"]:
                reason = "You cannot review your own product"
            elif settings["reviews_require_purchase"] == "true" and not has_delivered_purchase(cur, user["user_id"], pid):
                reason = "Only customers who received this product can review it"
            else:
                can_review, reason = True, ""
        return ok(summary={"average": avg, "count": total, "breakdown": {str(i): counts.get(i, 0) for i in range(1, 6)}},
                  reviews=reviews, my_review=mine, can_review=can_review, reason=reason)


@bp.route("/api/products/<int:pid>/reviews", methods=["POST"])
@api
def post_review(pid):
    u = current_user()
    d = request.get_json(silent=True) or {}
    try:
        rating = int(d.get("rating"))
    except Exception:
        raise ApiError("Choose a rating from 1 to 5 stars")
    if rating < 1 or rating > 5:
        raise ApiError("Choose a rating from 1 to 5 stars")
    title, comment = text(d.get("title"), 100), text(d.get("comment"), 1500)
    with db() as (conn, cur):
        cur.execute("SELECT id, seller_id FROM products WHERE id=%s", (pid,))
        prod = cur.fetchone()
        if not prod:
            raise ApiError("Product not found", 404)
        if prod["seller_id"]:
            cur.execute("SELECT user_id FROM sellers WHERE id=%s", (prod["seller_id"],))
            owner = cur.fetchone()
            if owner and owner["user_id"] == u["user_id"]:
                raise ApiError("You cannot review your own product", 403)
        verified = has_delivered_purchase(cur, u["user_id"], pid)
        if get_settings(cur)["reviews_require_purchase"] == "true" and not verified:
            raise ApiError("Only customers who received this product can review it", 403)
        cur.execute("""
            INSERT INTO reviews (product_id, user_id, rating, title, comment, verified_purchase)
            VALUES (%s,%s,%s,%s,%s,%s)
            ON CONFLICT (product_id, user_id) DO UPDATE
            SET rating=EXCLUDED.rating, title=EXCLUDED.title, comment=EXCLUDED.comment,
                verified_purchase=EXCLUDED.verified_purchase, updated_at=NOW()
        """, (pid, u["user_id"], rating, title, comment, verified))
    return ok(message="Thanks for your review!")


@bp.route("/api/products/<int:pid>/reviews", methods=["DELETE"])
@api
def delete_my_review(pid):
    u = current_user()
    with db() as (conn, cur):
        cur.execute("DELETE FROM reviews WHERE product_id=%s AND user_id=%s", (pid, u["user_id"]))
    return ok(message="Review deleted")


# ---------------------------------------------------------------------
# ADMIN
# ---------------------------------------------------------------------
@bp.route("/api/admin/sellers", methods=["GET"])
@api
def admin_sellers():
    admin_required()
    status = request.args.get("status", "").strip().lower()
    with db() as (conn, cur):
        where, params = "", []
        if status in SELLER_STATUSES:
            where, params = "WHERE s.status=%s", [status]
        cur.execute(f"""
            SELECT s.id, s.store_name, s.slug, s.description, s.phone, s.address, s.city, s.status,
                   s.is_verified, s.admin_note, s.payout_method, s.payout_account, s.created_at, s.approved_at,
                   u.name AS owner_name, u.email AS owner_email,
                   (SELECT COUNT(*) FROM products p WHERE p.seller_id = s.id) AS product_count,
                   COALESCE((SELECT SUM(amount) FROM seller_transactions t WHERE t.seller_id = s.id),0) AS balance
            FROM sellers s JOIN users u ON u.id = s.user_id {where}
            ORDER BY (s.status='pending') DESC, s.id DESC
        """, params)
        return ok(sellers=cur.fetchall())


@bp.route("/api/admin/sellers/<int:sid>/status", methods=["PUT"])
@api
def admin_seller_status(sid):
    admin_required()
    d = request.get_json(silent=True) or {}
    status = text(d.get("status"), 20).lower()
    if status not in SELLER_STATUSES:
        raise ApiError("Invalid status")
    with db() as (conn, cur):
        cur.execute("""
            UPDATE sellers SET status=%s, admin_note=%s, updated_at=NOW(),
                   approved_at = CASE WHEN %s='approved' THEN COALESCE(approved_at, NOW()) ELSE approved_at END
            WHERE id=%s RETURNING id, status
        """, (status, text(d.get("note"), 300), status, sid))
        row = cur.fetchone()
        if not row:
            raise ApiError("Seller not found", 404)
    return ok(message=f"Seller marked as {status}", seller=row)


@bp.route("/api/admin/sellers/<int:sid>/verify", methods=["PUT"])
@api
def admin_seller_verify(sid):
    admin_required()
    d = request.get_json(silent=True) or {}
    with db() as (conn, cur):
        cur.execute("UPDATE sellers SET is_verified=%s, updated_at=NOW() WHERE id=%s RETURNING id, is_verified",
                    (bool(d.get("verified")), sid))
        row = cur.fetchone()
        if not row:
            raise ApiError("Seller not found", 404)
    return ok(message="Verified badge updated", seller=row)


@bp.route("/api/admin/withdrawals", methods=["GET"])
@api
def admin_withdrawals():
    admin_required()
    status = request.args.get("status", "").strip().lower()
    with db() as (conn, cur):
        where, params = "", []
        if status in ("pending", "approved", "rejected"):
            where, params = "WHERE w.status=%s", [status]
        cur.execute(f"""
            SELECT w.*, s.store_name, s.slug, u.email AS owner_email
            FROM withdrawals w JOIN sellers s ON s.id = w.seller_id JOIN users u ON u.id = s.user_id
            {where} ORDER BY (w.status='pending') DESC, w.id DESC LIMIT 300
        """, params)
        return ok(withdrawals=cur.fetchall())


def _process_withdrawal(wid, approve):
    admin = admin_required()
    d = request.get_json(silent=True) or {}
    note = text(d.get("note"), 300)
    with db() as (conn, cur):
        cur.execute("SELECT id, seller_id, amount, status FROM withdrawals WHERE id=%s FOR UPDATE", (wid,))
        w = cur.fetchone()
        if not w:
            raise ApiError("Withdrawal not found", 404)
        if w["status"] != "pending":
            raise ApiError(f"This request is already {w['status']}", 409)
        cur.execute("""UPDATE withdrawals SET status=%s, admin_note=%s, processed_by=%s, processed_at=NOW()
                       WHERE id=%s""", ("approved" if approve else "rejected", note, admin["user_id"], wid))
        if not approve:  # give the held money back to the seller wallet
            cur.execute("""INSERT INTO seller_transactions (seller_id, type, amount, withdrawal_id, note)
                           VALUES (%s,'withdrawal_refund',%s,%s,%s)""",
                        (w["seller_id"], w["amount"], wid, f"Withdrawal #{wid} rejected, amount returned"))
    return ok(message="Withdrawal approved (mark as paid)" if approve else "Withdrawal rejected, amount returned to seller")


@bp.route("/api/admin/withdrawals/<int:wid>/approve", methods=["POST"])
@api
def admin_withdrawal_approve(wid):
    return _process_withdrawal(wid, True)


@bp.route("/api/admin/withdrawals/<int:wid>/reject", methods=["POST"])
@api
def admin_withdrawal_reject(wid):
    return _process_withdrawal(wid, False)


@bp.route("/api/admin/marketplace", methods=["GET"])
@api
def admin_marketplace():
    admin_required()
    with db() as (conn, cur):
        settings = get_settings(cur)
        cur.execute("SELECT status, COUNT(*) AS n FROM sellers GROUP BY status")
        seller_counts = {r["status"]: r["n"] for r in cur.fetchall()}
        cur.execute("SELECT COALESCE(SUM(commission_amount),0) AS v, COALESCE(SUM(subtotal),0) AS gross FROM order_items WHERE credited_at IS NOT NULL")
        c = cur.fetchone()
        cur.execute("SELECT status, COUNT(*) AS n, COALESCE(SUM(amount),0) AS v FROM withdrawals GROUP BY status")
        w = {r["status"]: {"count": r["n"], "amount": r["v"]} for r in cur.fetchall()}
        cur.execute("""
            SELECT r.id, r.rating, r.title, r.comment, r.verified_purchase, r.created_at,
                   p.name AS product_name, u.name AS user_name
            FROM reviews r JOIN products p ON p.id=r.product_id JOIN users u ON u.id=r.user_id
            ORDER BY r.id DESC LIMIT 100
        """)
        return ok(settings=settings, seller_counts=seller_counts, commission_earned=c["v"],
                  seller_sales=c["gross"], withdrawals=w, reviews=cur.fetchall())


@bp.route("/api/admin/marketplace/settings", methods=["PUT"])
@api
def admin_marketplace_settings():
    admin_required()
    d = request.get_json(silent=True) or {}
    updates = {}
    if "commission_percent" in d:
        try:
            v = Decimal(str(d["commission_percent"]))
        except Exception:
            raise ApiError("Commission must be a number")
        if v < 0 or v > 90:
            raise ApiError("Commission must be between 0 and 90")
        updates["commission_percent"] = str(v.normalize() if v != v.to_integral() else int(v))
    if "min_withdrawal" in d:
        try:
            v = Decimal(str(d["min_withdrawal"]))
        except Exception:
            raise ApiError("Minimum withdrawal must be a number")
        if v < 0:
            raise ApiError("Minimum withdrawal cannot be negative")
        updates["min_withdrawal"] = str(int(v) if v == v.to_integral() else v)
    if "reviews_require_purchase" in d:
        updates["reviews_require_purchase"] = "true" if d["reviews_require_purchase"] in (True, "true", "1", 1) else "false"
    with db() as (conn, cur):
        for k, v in updates.items():
            cur.execute("""INSERT INTO marketplace_settings (key, value) VALUES (%s,%s)
                           ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value""", (k, v))
    return ok(message="Settings saved (new commission applies to future deliveries)")


@bp.route("/api/admin/reviews/<int:rid>", methods=["DELETE"])
@api
def admin_delete_review(rid):
    admin_required()
    with db() as (conn, cur):
        cur.execute("DELETE FROM reviews WHERE id=%s RETURNING id", (rid,))
        if not cur.fetchone():
            raise ApiError("Review not found", 404)
    return ok(message="Review removed")


# ---------------------------------------------------------------------
# PUBLIC SELLER APPLICATION (no customer account needed) + admin approval
# ---------------------------------------------------------------------
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def make_password():
    alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "".join(secrets.choice(alphabet) for _ in range(10))


@bp.route("/api/seller/apply-public", methods=["POST"])
@api
def seller_apply_public():
    d = request.get_json(silent=True) or {}
    owner = text(d.get("owner_name"), 80)
    store_name = text(d.get("store_name"), 60)
    email = text(d.get("email"), 120).lower()
    phone = text(d.get("phone"), 30)
    if len(owner) < 2:
        raise ApiError("Enter your full name")
    if len(store_name) < 3:
        raise ApiError("Store name must be at least 3 characters")
    if not EMAIL_RE.match(email):
        raise ApiError("Enter a valid email address")
    if len("".join(c for c in phone if c.isdigit())) < 10:
        raise ApiError("Enter a valid phone number")
    with db() as (conn, cur):
        cur.execute("SELECT 1 FROM users WHERE email=%s", (email,))
        if cur.fetchone():
            raise ApiError("This email already has an account. Use a different email for your seller account.", 409)
        cur.execute("SELECT 1 FROM seller_applications WHERE email=%s AND status='pending'", (email,))
        if cur.fetchone():
            raise ApiError("An application with this email is already waiting for review.", 409)
        cur.execute("""
            INSERT INTO seller_applications
                (owner_name, store_name, email, phone, city, address, description, id_number)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id
        """, (owner, store_name, email, phone, text(d.get("city"), 80), text(d.get("address"), 300),
              text(d.get("description"), 800), text(d.get("id_number"), 40)))
        app_id = cur.fetchone()["id"]
    return ok(message="Application submitted. Our team will review it and send you your login ID and password.",
              application_id=app_id)


@bp.route("/api/seller/change-password", methods=["POST"])
@api
def seller_change_password():
    d = request.get_json(silent=True) or {}
    u = current_user()
    old, new = d.get("current_password") or "", d.get("new_password") or ""
    if len(new) < 8:
        raise ApiError("New password must be at least 8 characters")
    if new == old:
        raise ApiError("New password must be different from the temporary one")
    with db() as (conn, cur):
        cur.execute("SELECT password_hash FROM users WHERE id=%s", (u["user_id"],))
        row = cur.fetchone()
        if not row or not check_password_hash(row["password_hash"], old):
            raise ApiError("Current password is wrong", 403)
        cur.execute("UPDATE users SET password_hash=%s WHERE id=%s", (generate_password_hash(new), u["user_id"]))
        cur.execute("UPDATE sellers SET must_change_password=FALSE, updated_at=NOW() WHERE user_id=%s", (u["user_id"],))
    return ok(message="Password changed")


@bp.route("/api/admin/seller-applications", methods=["GET"])
@api
def admin_seller_applications():
    admin_required()
    status = request.args.get("status", "").strip().lower()
    with db() as (conn, cur):
        where, params = "", []
        if status in ("pending", "approved", "rejected"):
            where, params = "WHERE status=%s", [status]
        cur.execute(f"""
            SELECT id, owner_name, store_name, email, phone, city, address, description, id_number,
                   status, admin_note, seller_id, created_at, reviewed_at
            FROM seller_applications {where}
            ORDER BY (status='pending') DESC, id DESC LIMIT 300
        """, params)
        return ok(applications=cur.fetchall())


@bp.route("/api/admin/seller-applications/<int:aid>/approve", methods=["POST"])
@api
def admin_seller_application_approve(aid):
    admin_required()
    d = request.get_json(silent=True) or {}
    password = text(d.get("password"), 60) or make_password()
    if len(password) < 8:
        raise ApiError("Password must be at least 8 characters")
    with db() as (conn, cur):
        cur.execute("SELECT * FROM seller_applications WHERE id=%s FOR UPDATE", (aid,))
        a = cur.fetchone()
        if not a:
            raise ApiError("Application not found", 404)
        if a["status"] == "approved":
            raise ApiError("This application is already approved", 409)
        cur.execute("SELECT 1 FROM users WHERE email=%s", (a["email"],))
        if cur.fetchone():
            raise ApiError("This email already has an account. Reject it and ask the applicant to use another email.", 409)
        cur.execute("""
            INSERT INTO users (name, email, password_hash, email_verified)
            VALUES (%s,%s,%s,TRUE) RETURNING id
        """, (a["owner_name"], a["email"], generate_password_hash(password)))
        user_id = cur.fetchone()["id"]
        slug = unique_slug(cur, a["store_name"])
        cur.execute("""
            INSERT INTO sellers (user_id, store_name, description, phone, address, city, slug,
                                 status, approved_at, must_change_password)
            VALUES (%s,%s,%s,%s,%s,%s,%s,'approved',NOW(),TRUE) RETURNING id
        """, (user_id, a["store_name"], a["description"], a["phone"], a["address"], a["city"], slug))
        seller_id = cur.fetchone()["id"]
        cur.execute("""UPDATE seller_applications
                       SET status='approved', seller_id=%s, reviewed_at=NOW(), admin_note='' WHERE id=%s""",
                    (seller_id, aid))
    return ok(message="Approved. Send these login details to the seller.",
              login_id=a["email"], password=password, store_name=a["store_name"], phone=a["phone"])


@bp.route("/api/admin/seller-applications/<int:aid>/reject", methods=["POST"])
@api
def admin_seller_application_reject(aid):
    admin_required()
    d = request.get_json(silent=True) or {}
    with db() as (conn, cur):
        cur.execute("""UPDATE seller_applications SET status='rejected', admin_note=%s, reviewed_at=NOW()
                       WHERE id=%s AND status='pending' RETURNING id""", (text(d.get("note"), 300), aid))
        if not cur.fetchone():
            raise ApiError("Pending application not found", 404)
    return ok(message="Application rejected")


# ---------------------------------------------------------------------
# COUPONS (seller coupons are paid by the seller, admin coupons by Zento)
# ---------------------------------------------------------------------
def _split_discount(total, amounts):
    """Share `total` across `amounts` in proportion; the last one absorbs rounding."""
    base = sum(amounts)
    parts, used = [], Decimal("0")
    for i, a in enumerate(amounts):
        if i == len(amounts) - 1:
            share = total - used
        else:
            share = q2(total * a / base) if base else Decimal("0")
        parts.append(share)
        used += share
    return parts


def apply_coupon(cur, code, user_id, lines, consume=False):
    """
    lines: [{"id": product_id, "subtotal": number}, ...]
    Returns {"coupon": {...}, "discount_total": Decimal, "discounts": [Decimal per line]}.
    consume=True locks the coupon and counts one use (call inside the order transaction).
    """
    code = text(code, 40).upper()
    if not code:
        raise ApiError("Enter a coupon code")
    d = cur.connection.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    d.execute("SELECT c.*, s.store_name, s.status AS seller_status FROM coupons c "
              "LEFT JOIN sellers s ON s.id=c.seller_id WHERE c.code=%s" + (" FOR UPDATE OF c" if consume else ""), (code,))
    c = d.fetchone()
    if not c or not c["active"]:
        raise ApiError("This coupon code is not valid")
    if c["seller_id"] and c["seller_status"] != "approved":
        raise ApiError("This coupon code is not valid")
    now = datetime.datetime.now(datetime.timezone.utc)
    if c["starts_at"] and c["starts_at"] > now:
        raise ApiError("This coupon is not active yet")
    if c["expires_at"] and c["expires_at"] < now:
        raise ApiError("This coupon has expired")
    if c["usage_limit"] is not None and c["used_count"] >= c["usage_limit"]:
        raise ApiError("This coupon has been fully used")
    if c["per_user_limit"]:
        d.execute("SELECT COUNT(*) AS n FROM orders WHERE user_id=%s AND coupon_id=%s", (user_id, c["id"]))
        if d.fetchone()["n"] >= c["per_user_limit"]:
            raise ApiError("You have already used this coupon")

    rows = []
    for l in lines:
        d.execute("SELECT seller_id FROM products WHERE id=%s", (l["id"],))
        r = d.fetchone()
        rows.append((Decimal(str(l["subtotal"])), r["seller_id"] if r else None))
    if c["seller_id"]:
        idx = [i for i, (_, sid) in enumerate(rows) if sid == c["seller_id"]]
        if not idx:
            raise ApiError(f"This coupon only works on products from {c['store_name']}")
    else:
        idx = list(range(len(rows)))
    amounts = [rows[i][0] for i in idx]
    base = sum(amounts)
    if base < Decimal(c["min_order"] or 0):
        raise ApiError(f"Minimum order for this coupon is ৳{Decimal(c['min_order']):.0f}"
                       + (f" (on {c['store_name']} products)" if c["seller_id"] else ""))

    if c["discount_type"] == "percent":
        total = q2(base * Decimal(c["value"]) / 100)
        if c["max_discount"] is not None:
            total = min(total, Decimal(c["max_discount"]))
    else:
        total = Decimal(c["value"])
    total = min(q2(total), base)

    discounts = [Decimal("0")] * len(rows)
    for i, share in zip(idx, _split_discount(total, amounts)):
        discounts[i] = share

    if consume:
        d.execute("UPDATE coupons SET used_count=used_count+1 WHERE id=%s", (c["id"],))
    funded_by = "seller" if c["seller_id"] else "platform"
    return {"coupon": {"id": c["id"], "code": c["code"], "funded_by": funded_by,
                       "store_name": c.get("store_name") or ""},
            "discount_total": total, "discounts": discounts}


@bp.route("/api/coupons/validate", methods=["POST"])
@api
def coupon_validate():
    u = current_user()
    d = request.get_json(silent=True) or {}
    items = d.get("items") or []
    with db() as (conn, cur):
        lines, subtotal = [], Decimal("0")
        for it in items:
            try:
                qty = int(it.get("quantity", 0))
            except Exception:
                continue
            if qty < 1:
                continue
            cur.execute("SELECT id, price FROM products WHERE id=%s", (it.get("id"),))
            p = cur.fetchone()
            if not p and it.get("name"):
                cur.execute("SELECT id, price FROM products WHERE LOWER(TRIM(name))=LOWER(TRIM(%s)) ORDER BY id LIMIT 1",
                            (str(it.get("name")),))
                p = cur.fetchone()
            if not p:
                continue
            line = Decimal(p["price"]) * qty
            lines.append({"id": p["id"], "subtotal": line})
            subtotal += line
        if not lines:
            raise ApiError("Your cart is empty")
        r = apply_coupon(cur, d.get("code"), u["user_id"], lines, consume=False)
    return ok(message=f"Coupon {r['coupon']['code']} applied", code=r["coupon"]["code"],
              funded_by=r["coupon"]["funded_by"], discount=r["discount_total"], subtotal=subtotal)


def coupon_payload(d):
    code = re.sub(r"[^A-Za-z0-9_-]", "", text(d.get("code"), 40)).upper()
    if len(code) < 3:
        raise ApiError("Coupon code must be at least 3 letters or numbers (no spaces)")
    dtype = text(d.get("discount_type"), 10).lower()
    if dtype not in ("percent", "fixed"):
        raise ApiError("Discount type must be percent or fixed")
    try:
        value = q2(d.get("value"))
    except Exception:
        raise ApiError("Enter the discount value")
    if value <= 0 or (dtype == "percent" and value > 100):
        raise ApiError("Percent must be between 1 and 100" if dtype == "percent" else "Discount amount must be more than 0")

    def opt_money(key):
        v = d.get(key)
        if v in (None, ""):
            return None
        try:
            v = q2(v)
        except Exception:
            raise ApiError(f"Invalid {key.replace('_', ' ')}")
        if v < 0:
            raise ApiError(f"Invalid {key.replace('_', ' ')}")
        return v

    def opt_int(key, default):
        v = d.get(key)
        if v in (None, ""):
            return default
        try:
            v = int(v)
        except Exception:
            raise ApiError(f"Invalid {key.replace('_', ' ')}")
        if v < 0:
            raise ApiError(f"Invalid {key.replace('_', ' ')}")
        return v or default

    def opt_date(key, tail):
        v = text(d.get(key), 10)
        if not v:
            return None
        try:
            datetime.date.fromisoformat(v)
        except Exception:
            raise ApiError("Dates must look like 2026-12-31")
        return f"{v} {tail}+06"   # Bangladesh time

    starts, expires = opt_date("starts_at", "00:00:00"), opt_date("expires_at", "23:59:59")
    return {
        "code": code, "discount_type": dtype, "value": value,
        "max_discount": opt_money("max_discount") if dtype == "percent" else None,
        "min_order": opt_money("min_order") or Decimal("0"),
        "usage_limit": opt_int("usage_limit", None),
        "per_user_limit": opt_int("per_user_limit", 1),
        "starts_at": starts, "expires_at": expires,
        "active": bool(d.get("active", True)),
    }


COUPON_COLS = ("id, code, seller_id, discount_type, value, max_discount, min_order, usage_limit, per_user_limit, "
               "used_count, starts_at, expires_at, active, created_at")


def _create_coupon(cur, seller_id, d):
    c = coupon_payload(d)
    cur.execute("SELECT 1 FROM coupons WHERE code=%s", (c["code"],))
    if cur.fetchone():
        raise ApiError("This coupon code already exists. Choose another code.", 409)
    cur.execute("""
        INSERT INTO coupons (code, seller_id, discount_type, value, max_discount, min_order, usage_limit,
                             per_user_limit, starts_at, expires_at, active)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id
    """, (c["code"], seller_id, c["discount_type"], c["value"], c["max_discount"], c["min_order"],
          c["usage_limit"], c["per_user_limit"], c["starts_at"], c["expires_at"], c["active"]))
    return cur.fetchone()["id"]


def _update_coupon(cur, cid, seller_id, d):
    cur.execute("SELECT id, seller_id FROM coupons WHERE id=%s", (cid,))
    row = cur.fetchone()
    if not row or row["seller_id"] != seller_id:
        raise ApiError("Coupon not found", 404)
    if set(d.keys()) <= {"active"}:
        cur.execute("UPDATE coupons SET active=%s WHERE id=%s", (bool(d.get("active")), cid))
        return
    c = coupon_payload(d)
    cur.execute("SELECT 1 FROM coupons WHERE code=%s AND id<>%s", (c["code"], cid))
    if cur.fetchone():
        raise ApiError("This coupon code already exists. Choose another code.", 409)
    cur.execute("""
        UPDATE coupons SET code=%s, discount_type=%s, value=%s, max_discount=%s, min_order=%s, usage_limit=%s,
               per_user_limit=%s, starts_at=%s, expires_at=%s, active=%s WHERE id=%s
    """, (c["code"], c["discount_type"], c["value"], c["max_discount"], c["min_order"], c["usage_limit"],
          c["per_user_limit"], c["starts_at"], c["expires_at"], c["active"], cid))


def _delete_coupon(cur, cid, seller_id):
    cur.execute("SELECT id, seller_id, used_count FROM coupons WHERE id=%s", (cid,))
    row = cur.fetchone()
    if not row or row["seller_id"] != seller_id:
        raise ApiError("Coupon not found", 404)
    if row["used_count"] > 0:
        cur.execute("UPDATE coupons SET active=FALSE WHERE id=%s", (cid,))
        return "This coupon was already used, so it was switched off instead of deleted."
    cur.execute("DELETE FROM coupons WHERE id=%s", (cid,))
    return "Coupon deleted"


@bp.route("/api/seller/coupons", methods=["GET"])
@api
def seller_coupons():
    current_user()
    with db() as (conn, cur):
        u, s = seller_required(cur)
        cur.execute(f"""SELECT {COUPON_COLS},
                        COALESCE((SELECT SUM(discount_amount) FROM order_items oi WHERE oi.coupon_id=coupons.id),0) AS discount_given
                        FROM coupons WHERE seller_id=%s ORDER BY id DESC""", (s["id"],))
        return ok(coupons=cur.fetchall())


@bp.route("/api/seller/coupons", methods=["POST"])
@api
def seller_coupon_create():
    d = request.get_json(silent=True) or {}
    current_user()
    with db() as (conn, cur):
        u, s = seller_required(cur)
        _create_coupon(cur, s["id"], d)
    return ok(message="Coupon created. Customers can use it on your products.")


@bp.route("/api/seller/coupons/<int:cid>", methods=["PUT"])
@api
def seller_coupon_update(cid):
    d = request.get_json(silent=True) or {}
    current_user()
    with db() as (conn, cur):
        u, s = seller_required(cur)
        _update_coupon(cur, cid, s["id"], d)
    return ok(message="Coupon saved")


@bp.route("/api/seller/coupons/<int:cid>", methods=["DELETE"])
@api
def seller_coupon_delete(cid):
    current_user()
    with db() as (conn, cur):
        u, s = seller_required(cur)
        msg = _delete_coupon(cur, cid, s["id"])
    return ok(message=msg)


@bp.route("/api/admin/coupons", methods=["GET"])
@api
def admin_coupons():
    admin_required()
    with db() as (conn, cur):
        cur.execute(f"""SELECT {COUPON_COLS}, (SELECT store_name FROM sellers s WHERE s.id=coupons.seller_id) AS store_name,
                        COALESCE((SELECT SUM(discount_amount) FROM order_items oi WHERE oi.coupon_id=coupons.id),0) AS discount_given
                        FROM coupons ORDER BY (seller_id IS NULL) DESC, id DESC""")
        return ok(coupons=cur.fetchall())


@bp.route("/api/admin/coupons", methods=["POST"])
@api
def admin_coupon_create():
    admin_required()
    d = request.get_json(silent=True) or {}
    with db() as (conn, cur):
        _create_coupon(cur, None, d)
    return ok(message="Coupon created. Zento pays this discount; sellers still get their full price.")


@bp.route("/api/admin/coupons/<int:cid>", methods=["PUT"])
@api
def admin_coupon_update(cid):
    admin_required()
    d = request.get_json(silent=True) or {}
    with db() as (conn, cur):
        cur.execute("SELECT seller_id FROM coupons WHERE id=%s", (cid,))
        row = cur.fetchone()
        if not row:
            raise ApiError("Coupon not found", 404)
        if row["seller_id"] is not None:       # admin may only switch seller coupons on/off
            if not set(d.keys()) <= {"active"}:
                raise ApiError("Only the seller can edit a seller coupon. You can switch it off.", 403)
            cur.execute("UPDATE coupons SET active=%s WHERE id=%s", (bool(d.get("active")), cid))
        else:
            _update_coupon(cur, cid, None, d)
    return ok(message="Coupon saved")


@bp.route("/api/admin/coupons/<int:cid>", methods=["DELETE"])
@api
def admin_coupon_delete(cid):
    admin_required()
    with db() as (conn, cur):
        cur.execute("SELECT seller_id FROM coupons WHERE id=%s", (cid,))
        row = cur.fetchone()
        if not row:
            raise ApiError("Coupon not found", 404)
        msg = _delete_coupon(cur, cid, row["seller_id"])
    return ok(message=msg)


# ---------------------------------------------------------------------
# PAGES
# ---------------------------------------------------------------------
@bp.route("/seller")
@bp.route("/seller/")
def seller_portal():
    return send_from_directory(os.path.join(_H["base_dir"], "seller"), "index.html")


@bp.route("/seller/<path:filename>")
def seller_files(filename):
    return send_from_directory(os.path.join(_H["base_dir"], "seller"), filename)


@bp.route("/store/<slug>")
def store_page(slug):
    path = os.path.join(_H["base_dir"], "store.html")
    if not os.path.isfile(path):
        abort(404)
    return send_from_directory(_H["base_dir"], "store.html")


# ---------------------------------------------------------------------
def init_marketplace(app, get_user, admin_user, base_dir, ensure_base=None):
    _H.update(get_user=get_user, admin_user=admin_user, base_dir=base_dir)
    try:
        if ensure_base:
            ensure_base()  # makes sure users / orders / order_items exist first
        ensure_tables()
        log.info("Marketplace tables ready")
    except Exception:
        log.exception("Marketplace table setup failed (will retry on next boot)")
    app.register_blueprint(bp)
