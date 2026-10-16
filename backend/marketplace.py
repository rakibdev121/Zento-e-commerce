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

-- COUPONS (seller coupons are paid by the seller, admin coupons by the platform)
CREATE TABLE IF NOT EXISTS coupons (
    id BIGSERIAL PRIMARY KEY,
    code TEXT NOT NULL,
    seller_id BIGINT REFERENCES sellers(id) ON DELETE CASCADE,
    discount_type TEXT NOT NULL DEFAULT 'percent',
    discount_value NUMERIC(10,2) NOT NULL,
    max_discount NUMERIC(10,2),
    min_order NUMERIC(10,2) NOT NULL DEFAULT 0,
    usage_limit INTEGER,
    per_user_limit INTEGER NOT NULL DEFAULT 1,
    used_count INTEGER NOT NULL DEFAULT 0,
    starts_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS coupons_code_uidx ON coupons (UPPER(code));
CREATE INDEX IF NOT EXISTS coupons_seller_idx ON coupons (seller_id);

CREATE TABLE IF NOT EXISTS coupon_redemptions (
    id BIGSERIAL PRIMARY KEY,
    coupon_id BIGINT NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL,
    order_id BIGINT NOT NULL,
    amount NUMERIC(12,2) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS coupon_red_idx ON coupon_redemptions (coupon_id, user_id);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS coupon_id BIGINT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS coupon_code TEXT DEFAULT '';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS coupon_by TEXT DEFAULT '';
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS coupon_discount NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS coupon_by TEXT DEFAULT '';

-- ADMIN WALLET (ledger). bucket 'commission' = Zento's own money,
-- bucket 'seller_funds' = all sellers' money held together until withdrawals are paid.
CREATE TABLE IF NOT EXISTS admin_wallet_tx (
    id BIGSERIAL PRIMARY KEY,
    bucket TEXT NOT NULL,
    type TEXT NOT NULL,
    amount NUMERIC(12,2) NOT NULL,
    seller_id BIGINT,
    order_id BIGINT,
    order_item_id BIGINT,
    withdrawal_id BIGINT,
    note TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS admin_wallet_idx ON admin_wallet_tx (bucket, id);
"""


def _backfill_admin_wallet(cur):
    """One time: copy money that was already credited/paid before the admin wallet existed."""
    cur.execute("SELECT 1 FROM marketplace_settings WHERE key='admin_wallet_backfilled'")
    if cur.fetchone():
        return
    cur.execute("""
        INSERT INTO admin_wallet_tx (bucket, type, amount, seller_id, order_id, order_item_id, note, created_at)
        SELECT 'commission', 'commission', commission_amount, seller_id, order_id, id,
               'Commission (earlier order)', credited_at
        FROM order_items WHERE credited_at IS NOT NULL AND commission_amount > 0
    """)
    cur.execute("""
        INSERT INTO admin_wallet_tx (bucket, type, amount, seller_id, order_id, order_item_id, note, created_at)
        SELECT 'seller_funds', 'seller_funds', seller_earning, seller_id, order_id, id,
               'Seller money (earlier order)', credited_at
        FROM order_items WHERE credited_at IS NOT NULL AND seller_earning > 0
    """)
    cur.execute("""
        INSERT INTO admin_wallet_tx (bucket, type, amount, seller_id, withdrawal_id, note, created_at)
        SELECT 'seller_funds', 'withdrawal', -amount, seller_id, id,
               'Withdrawal paid (earlier)', COALESCE(processed_at, created_at)
        FROM withdrawals WHERE status='approved'
    """)
    cur.execute("INSERT INTO marketplace_settings (key, value) VALUES ('admin_wallet_backfilled','1') ON CONFLICT (key) DO NOTHING")


def ensure_tables():
    global READY
    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    try:
        cur = conn.cursor()
        cur.execute(SCHEMA_SQL)
        _backfill_admin_wallet(cur)
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
        SELECT id, seller_id, subtotal, COALESCE(coupon_discount, 0), COALESCE(coupon_by, '')
        FROM order_items
        WHERE order_id=%s AND seller_id IS NOT NULL AND credited_at IS NULL
        FOR UPDATE
    """, (order_id,))
    for item_id, seller_id, subtotal, coupon_disc, coupon_by in cur.fetchall():
        gross = Decimal(subtotal)
        # Commission is ALWAYS taken on the original (pre-coupon) price.
        commission = q2(gross * rate / 100)
        # Seller coupon  -> the seller pays the discount out of their own share.
        # Admin coupon   -> the platform pays it; the seller still gets the full share.
        seller_discount = Decimal(coupon_disc) if coupon_by == "seller" else Decimal(0)
        earning = gross - commission - seller_discount
        if earning < 0:
            earning = Decimal(0)
        cur.execute("""
            UPDATE order_items
            SET commission_rate=%s, commission_amount=%s, seller_earning=%s, credited_at=NOW()
            WHERE id=%s
        """, (rate, commission, earning, item_id))
        note = f"Order #{order_id}: sale {gross} minus {rate}% commission ({commission})"
        if seller_discount > 0:
            note += f" minus your coupon discount ({seller_discount})"
        elif coupon_by == "platform" and Decimal(coupon_disc) > 0:
            note += f" (Zento coupon of {Decimal(coupon_disc)} was paid by Zento)"
        cur.execute("""
            INSERT INTO seller_transactions (seller_id, type, amount, order_id, order_item_id, note)
            VALUES (%s, 'sale', %s, %s, %s, %s)
        """, (seller_id, earning, order_id, item_id, note))
        # ---- admin wallet: commission is Zento's own money, seller money is held together ----
        wallet_rows = [("commission", "commission", commission, f"Order #{order_id}: {rate}% commission"),
                       ("seller_funds", "seller_funds", earning, f"Order #{order_id}: seller money held")]
        if coupon_by == "platform" and Decimal(coupon_disc) > 0:
            # Zento coupon: Zento pays it from its own pocket (commission wallet)
            wallet_rows.append(("commission", "coupon_cost", -Decimal(coupon_disc),
                                f"Order #{order_id}: Zento coupon paid for the customer"))
        for bucket, typ, amt, wnote in wallet_rows:
            if amt != 0:
                cur.execute("""
                    INSERT INTO admin_wallet_tx (bucket, type, amount, seller_id, order_id, order_item_id, note)
                    VALUES (%s,%s,%s,%s,%s,%s,%s)
                """, (bucket, typ, amt, seller_id, order_id, item_id, wnote))


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
                   oi.coupon_discount, oi.coupon_by, o.coupon_code,
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
        if approve:  # the paid amount leaves the "all sellers' money" bucket of the admin wallet
            cur.execute("""INSERT INTO admin_wallet_tx (bucket, type, amount, seller_id, withdrawal_id, note)
                           VALUES ('seller_funds','withdrawal',%s,%s,%s,%s)""",
                        (-w["amount"], w["seller_id"], wid, f"Withdrawal #{wid} paid to seller"))
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
        reviews = cur.fetchall()
        cur.execute("SELECT COALESCE(SUM(discount_amount),0) AS v FROM orders WHERE coupon_by='platform'")
        platform_coupon_cost = cur.fetchone()["v"]
        return ok(settings=settings, seller_counts=seller_counts, commission_earned=c["v"],
                  seller_sales=c["gross"], withdrawals=w, reviews=reviews,
                  platform_coupon_cost=platform_coupon_cost)


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
# ---------------------------------------------------------------------
# COUPONS
#   * Seller coupon : only for that seller's products. The seller pays the discount
#                     (commission is still taken on the original price).
#   * Admin coupon  : works on the whole cart. Zento pays the discount, sellers still
#                     receive their normal earning.
# ---------------------------------------------------------------------
COUPON_TYPES = ("percent", "fixed")
BD_TZ = datetime.timezone(datetime.timedelta(hours=6))


def delivery_fee_for(subtotal):
    """Same rule as app.py create_order (free delivery from 100)."""
    return Decimal(0) if Decimal(subtotal) >= 100 else Decimal(5)


def coupon_quote(cur, code, user_id, lines, lock=False):
    """
    Validate a coupon for a cart and work out the discount.
    cur   : RealDictCursor
    lines : [{"product_id", "seller_id", "subtotal"(Decimal)}]
    Returns dict(coupon_id, code, funded_by, discount, shares[aligned with lines]).
    Raises ApiError with a customer friendly message.
    """
    code = re.sub(r"[^A-Za-z0-9_-]", "", text(code, 40)).upper()
    if not code:
        raise ApiError("Enter a coupon code")
    cur.execute("SELECT * FROM coupons WHERE UPPER(code)=%s" + (" FOR UPDATE" if lock else ""), (code,))
    c = cur.fetchone()
    if not c or not c["is_active"]:
        raise ApiError("This coupon code is not valid")
    now = datetime.datetime.now(datetime.timezone.utc)
    if c["starts_at"] and c["starts_at"] > now:
        raise ApiError("This coupon is not active yet")
    if c["expires_at"] and c["expires_at"] < now:
        raise ApiError("This coupon has expired")
    if c["usage_limit"] is not None and c["used_count"] >= c["usage_limit"]:
        raise ApiError("This coupon has reached its usage limit")
    cur.execute("SELECT COUNT(*) AS n FROM coupon_redemptions WHERE coupon_id=%s AND user_id=%s", (c["id"], user_id))
    if cur.fetchone()["n"] >= c["per_user_limit"]:
        raise ApiError("You have already used this coupon")

    if c["seller_id"]:
        cur.execute("SELECT status, store_name FROM sellers WHERE id=%s", (c["seller_id"],))
        sel = cur.fetchone()
        if not sel or sel["status"] != "approved":
            raise ApiError("This coupon code is not valid")
        eligible_idx = [i for i, l in enumerate(lines) if l.get("seller_id") == c["seller_id"]]
        if not eligible_idx:
            raise ApiError(f"This coupon works only on products from {sel['store_name']}")
        funded_by = "seller"
    else:
        eligible_idx = list(range(len(lines)))
        funded_by = "platform"

    base = sum((Decimal(lines[i]["subtotal"]) for i in eligible_idx), Decimal(0))
    min_order = Decimal(c["min_order"] or 0)
    if base < min_order:
        where = " from this store" if funded_by == "seller" else ""
        raise ApiError(f"Spend at least \u09f3{min_order:.2f}{where} to use this coupon")

    value = Decimal(c["discount_value"])
    if c["discount_type"] == "percent":
        disc = q2(base * value / 100)
        if c["max_discount"] is not None:
            disc = min(disc, Decimal(c["max_discount"]))
    else:
        disc = value
    disc = min(disc, base)
    if funded_by == "seller":
        # the seller can never be charged more than their share after commission
        disc = min(disc, q2(base * (100 - commission_rate(cur)) / 100))
    disc = q2(disc)
    if disc <= 0:
        raise ApiError("This coupon gives no discount on your cart")

    shares = [Decimal(0)] * len(lines)
    remaining = disc
    for n, i in enumerate(eligible_idx):
        if n == len(eligible_idx) - 1:
            share = remaining
        else:
            share = min(q2(disc * Decimal(lines[i]["subtotal"]) / base), remaining)
        shares[i] = share
        remaining -= share
    return {"coupon_id": c["id"], "code": c["code"], "funded_by": funded_by,
            "discount": disc, "shares": shares}


def coupon_redeem(cur, quote, user_id, order_id):
    """Count the use of a coupon (cur = RealDictCursor in the same transaction as the order)."""
    cur.execute("INSERT INTO coupon_redemptions (coupon_id, user_id, order_id, amount) VALUES (%s,%s,%s,%s)",
                (quote["coupon_id"], user_id, order_id, quote["discount"]))
    cur.execute("UPDATE coupons SET used_count = used_count + 1 WHERE id=%s", (quote["coupon_id"],))


def _cart_lines(cur, items):
    """Price a cart from the database (never trust prices sent by the browser)."""
    lines = []
    for it in items or []:
        try:
            qty = int(it.get("quantity", 0))
        except Exception:
            continue
        if qty < 1:
            continue
        cur.execute("SELECT id, price, seller_id FROM products WHERE id=%s", (it.get("id"),))
        p = cur.fetchone() if it.get("id") is not None else None
        name = text(it.get("name"), 200)
        if not p and name:
            cur.execute("SELECT id, price, seller_id FROM products WHERE LOWER(TRIM(name))=LOWER(TRIM(%s)) ORDER BY id LIMIT 1", (name,))
            p = cur.fetchone()
        if not p:
            continue
        lines.append({"product_id": p["id"], "seller_id": p["seller_id"], "subtotal": q2(Decimal(p["price"]) * qty)})
    return lines


@bp.route("/api/coupons/validate", methods=["POST"])
@api
def coupon_validate():
    d = request.get_json(silent=True) or {}
    u = current_user()
    with db() as (conn, cur):
        lines = _cart_lines(cur, d.get("items"))
        if not lines:
            raise ApiError("Your cart is empty")
        quote = coupon_quote(cur, d.get("code"), u["user_id"], lines)
        subtotal = sum((l["subtotal"] for l in lines), Decimal(0))
        delivery = delivery_fee_for(subtotal)
        total = subtotal + delivery - quote["discount"]
        label = "Store coupon" if quote["funded_by"] == "seller" else "Zento coupon"
        return ok(code=quote["code"], discount=quote["discount"], subtotal=subtotal,
                  delivery_fee=delivery, total=total, funded_by=quote["funded_by"],
                  message=f"{label} {quote['code']} applied: you save \u09f3{quote['discount']:.2f}")


def _parse_day(value, end_of_day=False):
    value = text(value, 40)
    if not value:
        return None
    try:
        day = datetime.date.fromisoformat(value[:10])
    except ValueError:
        raise ApiError("Enter a valid date")
    t = datetime.time(23, 59, 59) if end_of_day else datetime.time(0, 0, 0)
    return datetime.datetime.combine(day, t, tzinfo=BD_TZ)


def _coupon_fields(d, is_seller):
    code = re.sub(r"[^A-Za-z0-9_-]", "", text(d.get("code"), 30)).upper()
    if len(code) < 3:
        raise ApiError("Coupon code must be 3 to 30 letters or numbers")
    dtype = text(d.get("discount_type"), 10).lower()
    if dtype not in COUPON_TYPES:
        raise ApiError("Choose percent or fixed amount")
    try:
        value = q2(d.get("discount_value"))
    except Exception:
        raise ApiError("Enter the discount value")
    if value <= 0:
        raise ApiError("Discount must be more than 0")
    if dtype == "percent" and value > (90 if is_seller else 100):
        raise ApiError("Percent discount cannot be more than " + ("90" if is_seller else "100"))

    def opt_money(key, label):
        raw = d.get(key)
        if raw in (None, ""):
            return None
        try:
            v = q2(raw)
        except Exception:
            raise ApiError(f"{label} must be a number")
        if v < 0:
            raise ApiError(f"{label} cannot be negative")
        return v

    def opt_int(key, label, default=None):
        raw = d.get(key)
        if raw in (None, ""):
            return default
        try:
            v = int(raw)
        except Exception:
            raise ApiError(f"{label} must be a whole number")
        if v < 1:
            raise ApiError(f"{label} must be at least 1")
        return v

    starts, expires = _parse_day(d.get("starts_at")), _parse_day(d.get("expires_at"), True)
    if starts and expires and expires < starts:
        raise ApiError("Expiry date must be after the start date")
    return {
        "code": code, "discount_type": dtype, "discount_value": value,
        "max_discount": opt_money("max_discount", "Max discount") if dtype == "percent" else None,
        "min_order": opt_money("min_order", "Minimum order") or Decimal(0),
        "usage_limit": opt_int("usage_limit", "Total usage limit"),
        "per_user_limit": opt_int("per_user_limit", "Per customer limit", 1),
        "starts_at": starts, "expires_at": expires,
    }


def _insert_coupon(cur, seller_id, f):
    cur.execute("SELECT 1 FROM coupons WHERE UPPER(code)=%s", (f["code"],))
    if cur.fetchone():
        raise ApiError("This coupon code already exists. Choose another code.", 409)
    cur.execute("""
        INSERT INTO coupons (code, seller_id, discount_type, discount_value, max_discount, min_order,
                             usage_limit, per_user_limit, starts_at, expires_at)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id
    """, (f["code"], seller_id, f["discount_type"], f["discount_value"], f["max_discount"], f["min_order"],
          f["usage_limit"], f["per_user_limit"], f["starts_at"], f["expires_at"]))
    return cur.fetchone()["id"]


COUPON_LIST_SQL = """
    SELECT c.*, s.store_name,
           COALESCE((SELECT SUM(r.amount) FROM coupon_redemptions r WHERE r.coupon_id=c.id), 0) AS total_discount
    FROM coupons c LEFT JOIN sellers s ON s.id = c.seller_id
    {where} ORDER BY c.id DESC LIMIT 300
"""


@bp.route("/api/seller/coupons", methods=["GET"])
@api
def seller_coupons():
    current_user()
    with db() as (conn, cur):
        u, s = seller_required(cur)
        cur.execute(COUPON_LIST_SQL.format(where="WHERE c.seller_id=%s"), (s["id"],))
        return ok(coupons=cur.fetchall())


@bp.route("/api/seller/coupons", methods=["POST"])
@api
def seller_create_coupon():
    d = request.get_json(silent=True) or {}
    current_user()
    with db() as (conn, cur):
        u, s = seller_required(cur)
        cid = _insert_coupon(cur, s["id"], _coupon_fields(d, True))
    return ok(message="Coupon created. The discount is paid from your sale amount.", coupon_id=cid), 201


@bp.route("/api/seller/coupons/<int:cid>", methods=["PUT"])
@api
def seller_toggle_coupon(cid):
    d = request.get_json(silent=True) or {}
    current_user()
    with db() as (conn, cur):
        u, s = seller_required(cur)
        cur.execute("UPDATE coupons SET is_active=%s WHERE id=%s AND seller_id=%s RETURNING id",
                    (bool(d.get("is_active")), cid, s["id"]))
        if not cur.fetchone():
            raise ApiError("Coupon not found", 404)
    return ok(message="Coupon updated")


@bp.route("/api/seller/coupons/<int:cid>", methods=["DELETE"])
@api
def seller_delete_coupon(cid):
    current_user()
    with db() as (conn, cur):
        u, s = seller_required(cur)
        cur.execute("DELETE FROM coupons WHERE id=%s AND seller_id=%s RETURNING id", (cid, s["id"]))
        if not cur.fetchone():
            raise ApiError("Coupon not found", 404)
    return ok(message="Coupon deleted")


@bp.route("/api/admin/coupons", methods=["GET"])
@api
def admin_coupons():
    admin_required()
    with db() as (conn, cur):
        cur.execute(COUPON_LIST_SQL.format(where=""))
        return ok(coupons=cur.fetchall())


@bp.route("/api/admin/coupons", methods=["POST"])
@api
def admin_create_coupon():
    admin_required()
    d = request.get_json(silent=True) or {}
    with db() as (conn, cur):
        cid = _insert_coupon(cur, None, _coupon_fields(d, False))
    return ok(message="Coupon created. Zento pays the discount; sellers still get their full share.", coupon_id=cid), 201


@bp.route("/api/admin/coupons/<int:cid>", methods=["PUT"])
@api
def admin_toggle_coupon(cid):
    admin_required()
    d = request.get_json(silent=True) or {}
    with db() as (conn, cur):
        cur.execute("UPDATE coupons SET is_active=%s WHERE id=%s RETURNING id", (bool(d.get("is_active")), cid))
        if not cur.fetchone():
            raise ApiError("Coupon not found", 404)
    return ok(message="Coupon updated")


@bp.route("/api/admin/coupons/<int:cid>", methods=["DELETE"])
@api
def admin_delete_coupon(cid):
    admin_required()
    with db() as (conn, cur):
        cur.execute("DELETE FROM coupons WHERE id=%s RETURNING id", (cid,))
        if not cur.fetchone():
            raise ApiError("Coupon not found", 404)
    return ok(message="Coupon deleted")


# ---------------------------------------------------------------------
# ADMIN WALLET
# ---------------------------------------------------------------------
WALLET_BUCKETS = ("commission", "seller_funds")


@bp.route("/api/admin/wallet", methods=["GET"])
@api
def admin_wallet():
    admin_required()
    bucket = text(request.args.get("bucket"), 20)
    with db() as (conn, cur):
        cur.execute("SELECT bucket, COALESCE(SUM(amount),0) AS v FROM admin_wallet_tx GROUP BY bucket")
        bal = {r["bucket"]: r["v"] for r in cur.fetchall()}
        cur.execute("SELECT COALESCE(SUM(amount),0) AS v FROM admin_wallet_tx WHERE type='commission'")
        commission_total = cur.fetchone()["v"]
        cur.execute("SELECT COALESCE(-SUM(amount),0) AS v FROM admin_wallet_tx WHERE type='coupon_cost'")
        coupon_cost = cur.fetchone()["v"]
        cur.execute("SELECT COALESCE(-SUM(amount),0) AS v FROM admin_wallet_tx WHERE type='withdrawal'")
        paid_out = cur.fetchone()["v"]
        cur.execute("SELECT COALESCE(SUM(amount),0) AS v FROM seller_transactions")
        sellers_wallets = cur.fetchone()["v"]
        cur.execute("SELECT COALESCE(SUM(amount),0) AS v FROM withdrawals WHERE status='pending'")
        pending = cur.fetchone()["v"]
        where, args = ("WHERE t.bucket=%s", (bucket,)) if bucket in WALLET_BUCKETS else ("", ())
        cur.execute(f"""
            SELECT t.*, s.store_name FROM admin_wallet_tx t LEFT JOIN sellers s ON s.id = t.seller_id
            {where} ORDER BY t.id DESC LIMIT 200
        """, args)
        tx = cur.fetchall()
        commission, funds = bal.get("commission", Decimal(0)), bal.get("seller_funds", Decimal(0))
        return ok(commission_balance=commission, seller_funds_balance=funds, total_balance=commission + funds,
                  commission_earned=commission_total, coupon_cost=coupon_cost, total_paid_out=paid_out,
                  sellers_wallets_total=sellers_wallets, withdrawals_pending=pending, transactions=tx)


@bp.route("/api/admin/wallet/entry", methods=["POST"])
@api
def admin_wallet_entry():
    """Manual correction, e.g. when the owner takes his own commission out."""
    admin_required()
    d = request.get_json(silent=True) or {}
    bucket = text(d.get("bucket"), 20)
    if bucket not in WALLET_BUCKETS:
        raise ApiError("Choose a wallet")
    try:
        amount = q2(d.get("amount"))
    except Exception:
        raise ApiError("Enter a valid amount")
    if amount <= 0:
        raise ApiError("Amount must be more than 0")
    if text(d.get("direction"), 10) == "remove":
        amount = -amount
    note = text(d.get("note"), 200) or ("Manual deposit" if amount > 0 else "Manual withdrawal")
    with db() as (conn, cur):
        cur.execute("INSERT INTO admin_wallet_tx (bucket, type, amount, note) VALUES (%s,'manual',%s,%s)", (bucket, amount, note))
    return ok(message="Wallet updated"), 201


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
