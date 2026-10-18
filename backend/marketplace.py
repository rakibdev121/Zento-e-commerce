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
import json
import html
import hashlib
import secrets
import logging
import threading
import urllib.request
import datetime
from contextlib import contextmanager
from decimal import Decimal, ROUND_HALF_UP
from functools import wraps

import psycopg2
import psycopg2.extras
from flask import Blueprint, request, send_from_directory, abort, redirect
from werkzeug.security import generate_password_hash, check_password_hash

log = logging.getLogger("zento.marketplace")
bp = Blueprint("marketplace", __name__)             # customer site + admin panel
seller_bp = Blueprint("seller_portal", __name__)    # seller panel + seller APK routes (/api/seller/*), kept apart from the customer code
_H = {}  # helpers injected from app.py

DEFAULT_SETTINGS = {
    "commission_percent": "10",
    "min_withdrawal": "500",
    "reviews_require_purchase": "true",
    "return_days": "7",
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
ALTER TABLE products ADD COLUMN IF NOT EXISTS cost_price NUMERIC(12,2);
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS cost_price NUMERIC(12,2);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancel_reason TEXT DEFAULT '';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS refund_status TEXT NOT NULL DEFAULT 'none';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS refund_amount NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS refund_done_at TIMESTAMPTZ;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS courier TEXT DEFAULT '';
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS tracking_no TEXT DEFAULT '';
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS shipped_at TIMESTAMPTZ;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS fulfil_status TEXT NOT NULL DEFAULT 'placed';
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS seller_approved_at TIMESTAMPTZ;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS sent_to_warehouse_at TIMESTAMPTZ;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS warehouse_received_at TIMESTAMPTZ;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS to_wh_courier TEXT DEFAULT '';
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS to_wh_tracking TEXT DEFAULT '';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;
-- orders that were already moving before this flow existed keep working
UPDATE order_items oi SET fulfil_status = CASE
        WHEN o.status IN ('shipped','out_for_delivery','delivered') THEN 'with_courier'
        WHEN o.status = 'processing' THEN 'at_warehouse'
        ELSE 'seller_approved' END
FROM orders o WHERE o.id = oi.order_id AND oi.fulfil_status = 'placed'
  AND o.status IN ('approved','processing','shipped','out_for_delivery','delivered');
UPDATE orders SET delivered_at = COALESCE(updated_at, created_at) WHERE status='delivered' AND delivered_at IS NULL;

CREATE TABLE IF NOT EXISTS return_requests (
    id BIGSERIAL PRIMARY KEY,
    order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'requested',
    admin_note TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS return_requests_order_idx ON return_requests (order_id);
CREATE INDEX IF NOT EXISTS return_requests_status_idx ON return_requests (status, id);

CREATE TABLE IF NOT EXISTS complaints (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    order_id BIGINT REFERENCES orders(id) ON DELETE SET NULL,
    seller_id BIGINT NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
    subject TEXT NOT NULL DEFAULT '',
    message TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    admin_note TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS complaints_seller_idx ON complaints (seller_id, id);
CREATE INDEX IF NOT EXISTS complaints_status_idx ON complaints (status, id);

CREATE TABLE IF NOT EXISTS password_resets (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS password_resets_hash_idx ON password_resets (token_hash);

CREATE TABLE IF NOT EXISTS audit_log (
    id BIGSERIAL PRIMARY KEY,
    admin_id BIGINT,
    admin_email TEXT DEFAULT '',
    action TEXT NOT NULL,
    target_type TEXT DEFAULT '',
    target_id TEXT DEFAULT '',
    detail TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS audit_log_idx ON audit_log (id DESC);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS pool_credited_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS platform_transactions (
    id BIGSERIAL PRIMARY KEY,
    wallet TEXT NOT NULL,
    type TEXT NOT NULL,
    amount NUMERIC(12,2) NOT NULL,
    order_id BIGINT,
    order_item_id BIGINT,
    withdrawal_id BIGINT,
    note TEXT DEFAULT '',
    created_by BIGINT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS platform_tx_idx ON platform_transactions (wallet, id);
CREATE UNIQUE INDEX IF NOT EXISTS platform_tx_once_item ON platform_transactions (type, order_item_id) WHERE order_item_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS platform_tx_once_order ON platform_transactions (order_id) WHERE type IN ('customer_payment','customer_refund');
CREATE UNIQUE INDEX IF NOT EXISTS platform_tx_once_wd ON platform_transactions (withdrawal_id) WHERE withdrawal_id IS NOT NULL;
"""


BACKFILL_SQL = """
INSERT INTO platform_transactions (wallet, type, amount, order_id, order_item_id, note, created_at)
SELECT 'commission', 'commission', commission_amount, order_id, id,
       'Commission on order #' || order_id, credited_at
FROM order_items WHERE credited_at IS NOT NULL AND refunded_at IS NULL AND commission_amount > 0
ON CONFLICT DO NOTHING;

INSERT INTO platform_transactions (wallet, type, amount, order_id, order_item_id, note, created_at)
SELECT 'commission', 'coupon_cost', -discount_amount, order_id, id,
       'Zento coupon discount paid on order #' || order_id, credited_at
FROM order_items WHERE credited_at IS NOT NULL AND refunded_at IS NULL
  AND COALESCE(discount_by,'') = 'platform' AND discount_amount > 0
ON CONFLICT DO NOTHING;

INSERT INTO platform_transactions (wallet, type, amount, order_id, note, created_at)
SELECT 'pool', 'customer_payment', total, id, 'Customer payment, order #' || id, COALESCE(updated_at, created_at)
FROM orders WHERE status = 'delivered' AND pool_credited_at IS NULL AND total > 0
ON CONFLICT DO NOTHING;

UPDATE orders SET pool_credited_at = NOW() WHERE status = 'delivered' AND pool_credited_at IS NULL;

INSERT INTO platform_transactions (wallet, type, amount, withdrawal_id, note, created_at)
SELECT 'pool', 'seller_payout', -amount, id, 'Seller payout #' || id, COALESCE(processed_at, created_at)
FROM withdrawals WHERE status = 'approved'
ON CONFLICT DO NOTHING;

INSERT INTO marketplace_settings (key, value) VALUES ('platform_wallet_backfilled', '1')
ON CONFLICT DO NOTHING;
"""


def ensure_tables():
    global READY
    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    try:
        cur = conn.cursor()
        cur.execute(SCHEMA_SQL)
        conn.commit()
        cur.execute("SELECT 1 FROM marketplace_settings WHERE key='platform_wallet_backfilled'")
        if not cur.fetchone():       # one time: bring earlier delivered orders and payouts into the wallet
            cur.execute(BACKFILL_SQL)
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
    cur.execute("UPDATE orders SET delivered_at = COALESCE(delivered_at, NOW()) WHERE id=%s", (order_id,))
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
        # Admin wallet: your commission, minus the discount you paid with a Zento coupon
        if commission > 0:
            cur.execute("""
                INSERT INTO platform_transactions (wallet, type, amount, order_id, order_item_id, note)
                VALUES ('commission', 'commission', %s, %s, %s, %s) ON CONFLICT DO NOTHING
            """, (commission, order_id, item_id, f"Commission on order #{order_id} ({rate}% of {base})"))
        if funded_by != "seller" and discount > 0:
            cur.execute("""
                INSERT INTO platform_transactions (wallet, type, amount, order_id, order_item_id, note)
                VALUES ('commission', 'coupon_cost', %s, %s, %s, %s) ON CONFLICT DO NOTHING
            """, (-discount, order_id, item_id, f"Zento coupon discount paid on order #{order_id}"))

    # Admin wallet: everything the customer paid goes into the common pool, once per order
    cur.execute("UPDATE orders SET pool_credited_at=NOW() WHERE id=%s AND pool_credited_at IS NULL RETURNING total",
                (order_id,))
    paid = cur.fetchone()
    if paid and paid[0] and Decimal(paid[0]) > 0:
        cur.execute("""
            INSERT INTO platform_transactions (wallet, type, amount, order_id, note)
            VALUES ('pool', 'customer_payment', %s, %s, %s) ON CONFLICT DO NOTHING
        """, (paid[0], order_id, f"Customer payment, order #{order_id}"))


def wallet_summary(cur, seller_id):
    rate = commission_rate(cur)
    cur.execute("SELECT COALESCE(SUM(amount),0) AS v FROM seller_transactions WHERE seller_id=%s", (seller_id,))
    available = cur.fetchone()["v"]
    cur.execute("SELECT COALESCE(SUM(amount),0) AS v FROM seller_transactions WHERE seller_id=%s AND type IN ('sale','sale_refund')", (seller_id,))
    total_earned = cur.fetchone()["v"]
    cur.execute("SELECT COALESCE(SUM(commission_amount),0) AS v FROM order_items WHERE seller_id=%s AND credited_at IS NOT NULL AND refunded_at IS NULL", (seller_id,))
    commission_paid = cur.fetchone()["v"]
    cur.execute("""SELECT COALESCE(SUM(subtotal),0) AS v FROM order_items
                   WHERE seller_id=%s AND credited_at IS NULL
                     AND order_id NOT IN (SELECT id FROM orders WHERE status IN ('cancelled','returned'))""", (seller_id,))
    pending_gross = cur.fetchone()["v"]
    pending_earnings = q2(Decimal(pending_gross) * (100 - rate) / 100)
    cur.execute("SELECT COALESCE(SUM(-amount),0) AS v FROM seller_transactions WHERE seller_id=%s AND type='return_charge'", (seller_id,))
    returns_charged = cur.fetchone()["v"]
    cur.execute("SELECT status, COALESCE(SUM(amount),0) AS v FROM withdrawals WHERE seller_id=%s GROUP BY status", (seller_id,))
    w = {r["status"]: r["v"] for r in cur.fetchall()}
    return {
        "returns_charged": returns_charged,
        "available": available, "pending_earnings": pending_earnings,
        "total_earned": total_earned, "commission_paid": commission_paid,
        "withdrawn": w.get("approved", 0), "pending_withdrawal": w.get("pending", 0),
        "commission_percent": rate,
    }


# ---------------------------------------------------------------------
# SELLER: apply, profile
# ---------------------------------------------------------------------
@seller_bp.route("/api/seller/apply", methods=["POST"])
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


@seller_bp.route("/api/seller/me", methods=["GET"])
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
        data = {"seller": out, "login_id": u.get("email", ""),
                "store_base_url": (os.environ.get("STORE_PUBLIC_URL", "").rstrip("/") or request.host_url.rstrip("/"))}
        if s["status"] == "approved":
            data["wallet"] = wallet_summary(cur, s["id"])
            cur.execute("SELECT COUNT(*) AS n FROM products WHERE seller_id=%s", (s["id"],))
            data["product_count"] = cur.fetchone()["n"]
            cur.execute("""SELECT COUNT(DISTINCT order_id) AS n, COALESCE(SUM(quantity),0) AS units
                           FROM order_items WHERE seller_id=%s AND refunded_at IS NULL
                             AND order_id NOT IN (SELECT id FROM orders WHERE status IN ('cancelled','returned'))""", (s["id"],))
            r = cur.fetchone()
            data["order_count"], data["units_sold"] = r["n"], r["units"]
            cur.execute("""SELECT COALESCE(AVG(r.rating),0)::numeric(3,2) AS avg, COUNT(r.id) AS cnt
                           FROM reviews r JOIN products p ON p.id=r.product_id WHERE p.seller_id=%s""", (s["id"],))
            r = cur.fetchone()
            data["rating_avg"], data["rating_count"] = r["avg"], r["cnt"]
            cur.execute("""SELECT COALESCE(SUM(seller_earning - cost_price * quantity), 0) AS profit,
                                  COUNT(*) FILTER (WHERE cost_price IS NULL) AS no_cost
                           FROM order_items WHERE seller_id=%s AND credited_at IS NOT NULL AND refunded_at IS NULL""", (s["id"],))
            r = cur.fetchone()
            data["profit_total"], data["profit_missing_cost_items"] = r["profit"], r["no_cost"]
            cur.execute("SELECT COUNT(*) AS n FROM products WHERE seller_id=%s AND cost_price IS NULL", (s["id"],))
            data["products_missing_cost"] = cur.fetchone()["n"]
            cur.execute("SELECT value FROM marketplace_settings WHERE key='min_withdrawal'")
            m = cur.fetchone()
            data["min_withdrawal"] = Decimal(m["value"]) if m else Decimal(DEFAULT_SETTINGS["min_withdrawal"])
        return ok(**data)


@seller_bp.route("/api/seller/me", methods=["PUT"])
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
def unit_profit(price, cost, rate):
    """Seller profit on one unit at full price: price - Zento commission - cost. None if cost unknown."""
    if cost is None:
        return None
    price, cost = Decimal(str(price)), Decimal(str(cost))
    return price - q2(price * Decimal(str(rate)) / 100) - cost


def item_profit(row, rate):
    """
    Profit for one order line. Uses the real wallet credit once delivered,
    otherwise an estimate. Returns (profit or None, is_estimate).
    """
    cost = row.get("cost_price")
    if cost is None:
        return None, False
    cost_total = Decimal(str(cost)) * int(row["quantity"])
    if row.get("credited_at"):
        return Decimal(str(row["seller_earning"])) - cost_total, False
    gross = Decimal(str(row["subtotal"]))
    disc = Decimal(str(row.get("discount_amount") or 0))
    base = gross - disc if row.get("discount_by") == "seller" else gross
    earning = base - q2(base * Decimal(str(rate)) / 100)
    return earning - cost_total, True


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
    if d.get("cost_price") in (None, ""):
        raise ApiError("Enter the cost price (the price you pay to buy or make this product)")
    try:
        cost = q2(d.get("cost_price"))
    except Exception:
        raise ApiError("Cost price must be a number")
    if cost < 0:
        raise ApiError("Cost price cannot be negative")
    return (name, text(d.get("description"), 3000), price, safe_url(d.get("image_url")),
            text(d.get("category"), 80), stock, cost)


# cost_price is private to the seller. Never add it to the public product queries.
PRODUCT_COLS = "id, name, description, price, image_url, category, stock, created_at, seller_id, cost_price"


@seller_bp.route("/api/seller/products", methods=["GET"])
@api
def seller_products():
    current_user()
    with db() as (conn, cur):
        u, s = seller_required(cur)
        cur.execute(f"""
            SELECT p.id, p.name, p.description, p.price, p.image_url, p.category, p.stock, p.created_at, p.cost_price,
                   COALESCE(r.avg,0) AS rating_avg, COALESCE(r.cnt,0) AS rating_count
            FROM products p
            LEFT JOIN (SELECT product_id, AVG(rating)::numeric(3,2) AS avg, COUNT(*) AS cnt
                       FROM reviews GROUP BY product_id) r ON r.product_id = p.id
            WHERE p.seller_id=%s ORDER BY p.id DESC
        """, (s["id"],))
        rate = commission_rate(cur)
        rows = cur.fetchall()
        for r in rows:
            r["profit_per_unit"] = unit_profit(r["price"], r["cost_price"], rate)
        return ok(products=rows)


@seller_bp.route("/api/seller/products", methods=["POST"])
@api
def seller_create_product():
    payload = product_payload(request.get_json(silent=True) or {})
    current_user()
    with db() as (conn, cur):
        u, s = seller_required(cur)
        cur.execute(f"""
            INSERT INTO products (name, description, price, image_url, category, stock, cost_price, seller_id)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s) RETURNING {PRODUCT_COLS}
        """, payload + (s["id"],))
        return ok(message="Product added", product=cur.fetchone()), 201


@seller_bp.route("/api/seller/products/<int:pid>", methods=["PUT"])
@api
def seller_update_product(pid):
    payload = product_payload(request.get_json(silent=True) or {})
    current_user()
    with db() as (conn, cur):
        u, s = seller_required(cur)
        cur.execute(f"""
            UPDATE products SET name=%s, description=%s, price=%s, image_url=%s, category=%s, stock=%s, cost_price=%s
            WHERE id=%s AND seller_id=%s RETURNING {PRODUCT_COLS}
        """, payload + (pid, s["id"]))
        row = cur.fetchone()
        if not row:
            raise ApiError("Product not found", 404)
        return ok(message="Product updated", product=row)


@seller_bp.route("/api/seller/products/<int:pid>", methods=["DELETE"])
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
@seller_bp.route("/api/seller/orders", methods=["GET"])
@api
def seller_orders():
    current_user()
    with db() as (conn, cur):
        u, s = seller_required(cur)
        cur.execute("""
            SELECT oi.id, oi.order_id, oi.product_id, oi.product_name, oi.quantity, oi.price, oi.subtotal,
                   oi.commission_amount, oi.seller_earning, oi.credited_at, oi.cost_price,
                   oi.discount_amount, oi.discount_by, oi.courier, oi.tracking_no, oi.shipped_at,
                   oi.fulfil_status, oi.seller_approved_at, oi.sent_to_warehouse_at, oi.warehouse_received_at,
                   oi.to_wh_courier, oi.to_wh_tracking, o.delivered_at,
                   (SELECT rr.status FROM return_requests rr WHERE rr.order_id=o.id ORDER BY rr.id DESC LIMIT 1) AS return_status,
                   o.status, o.customer_name, o.phone, o.address, o.city, o.payment_method, o.created_at
            FROM order_items oi JOIN orders o ON o.id = oi.order_id
            WHERE oi.seller_id=%s ORDER BY oi.id DESC LIMIT 300
        """, (s["id"],))
        rate = commission_rate(cur)
        rows = cur.fetchall()
        for r in rows:
            r["profit"], r["profit_is_estimate"] = item_profit(r, rate)
            r["cost_total"] = None if r["cost_price"] is None else Decimal(str(r["cost_price"])) * int(r["quantity"])
            r.pop("discount_by", None)
        return ok(orders=rows)


@seller_bp.route("/api/seller/wallet", methods=["GET"])
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


@seller_bp.route("/api/seller/withdrawals", methods=["POST"])
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
    admin = admin_required()
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
        audit(cur, admin, "seller_status", "seller", sid, f"{status} {text(d.get('note'), 150)}")
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
        if approve:      # the money leaves the common pool
            cur.execute("SELECT store_name FROM sellers WHERE id=%s", (w["seller_id"],))
            srow = cur.fetchone()
            cur.execute("""INSERT INTO platform_transactions (wallet, type, amount, withdrawal_id, note, created_by)
                           VALUES ('pool', 'seller_payout', %s, %s, %s, %s) ON CONFLICT DO NOTHING""",
                        (-w["amount"], wid, f"Paid to seller {srow['store_name'] if srow else ''} (withdrawal #{wid})",
                         admin["user_id"]))
        if not approve:  # give the held money back to the seller wallet
            cur.execute("""INSERT INTO seller_transactions (seller_id, type, amount, withdrawal_id, note)
                           VALUES (%s,'withdrawal_refund',%s,%s,%s)""",
                        (w["seller_id"], w["amount"], wid, f"Withdrawal #{wid} rejected, amount returned"))
        audit(cur, admin, "withdrawal_approved" if approve else "withdrawal_rejected", "withdrawal", wid, f"{w['amount']} {note}")
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
        cur.execute("SELECT COALESCE(SUM(commission_amount),0) AS v, COALESCE(SUM(subtotal),0) AS gross FROM order_items WHERE credited_at IS NOT NULL AND refunded_at IS NULL")
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
    admin = admin_required()
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
    if "return_days" in d:
        try:
            v = int(d["return_days"])
        except Exception:
            raise ApiError("Return days must be a whole number")
        if v < 0 or v > 60:
            raise ApiError("Return days must be between 0 and 60")
        updates["return_days"] = str(v)
    if "reviews_require_purchase" in d:
        updates["reviews_require_purchase"] = "true" if d["reviews_require_purchase"] in (True, "true", "1", 1) else "false"
    with db() as (conn, cur):
        for k, v in updates.items():
            cur.execute("""INSERT INTO marketplace_settings (key, value) VALUES (%s,%s)
                           ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value""", (k, v))
        audit(cur, admin, "marketplace_settings", "settings", "", json.dumps(updates)[:280])
    return ok(message="Settings saved (new commission applies to future deliveries)")


@bp.route("/api/admin/reviews/<int:rid>", methods=["DELETE"])
@api
def admin_delete_review(rid):
    admin = admin_required()
    with db() as (conn, cur):
        cur.execute("DELETE FROM reviews WHERE id=%s RETURNING id", (rid,))
        if not cur.fetchone():
            raise ApiError("Review not found", 404)
        audit(cur, admin, "review_removed", "review", rid, "")
    return ok(message="Review removed")


# ---------------------------------------------------------------------
# PUBLIC SELLER APPLICATION (no customer account needed) + admin approval
# ---------------------------------------------------------------------
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def make_password():
    alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "".join(secrets.choice(alphabet) for _ in range(10))


@seller_bp.route("/api/seller/apply-public", methods=["POST"])
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


@seller_bp.route("/api/seller/change-password", methods=["POST"])
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
    admin = admin_required()
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
        audit(cur, admin, "seller_application_approved", "application", aid, f"{a['store_name']} ({a['email']})")
    emailed = notify_seller_credentials(a["email"], a["owner_name"], a["store_name"], password)
    return ok(message="Approved. Send these login details to the seller." if not emailed
              else "Approved. The login details were also sent to the seller's email.",
              login_id=a["email"], password=password, store_name=a["store_name"], phone=a["phone"], emailed=emailed,
              login_url=seller_url() + "/")


@bp.route("/api/admin/seller-applications/<int:aid>/reject", methods=["POST"])
@api
def admin_seller_application_reject(aid):
    admin = admin_required()
    d = request.get_json(silent=True) or {}
    with db() as (conn, cur):
        cur.execute("""UPDATE seller_applications SET status='rejected', admin_note=%s, reviewed_at=NOW()
                       WHERE id=%s AND status='pending' RETURNING id""", (text(d.get("note"), 300), aid))
        if not cur.fetchone():
            raise ApiError("Pending application not found", 404)
        audit(cur, admin, "seller_application_rejected", "application", aid, text(d.get("note"), 200))
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


@seller_bp.route("/api/seller/coupons", methods=["GET"])
@api
def seller_coupons():
    current_user()
    with db() as (conn, cur):
        u, s = seller_required(cur)
        cur.execute(f"""SELECT {COUPON_COLS},
                        COALESCE((SELECT SUM(discount_amount) FROM order_items oi WHERE oi.coupon_id=coupons.id),0) AS discount_given
                        FROM coupons WHERE seller_id=%s ORDER BY id DESC""", (s["id"],))
        return ok(coupons=cur.fetchall())


@seller_bp.route("/api/seller/coupons", methods=["POST"])
@api
def seller_coupon_create():
    d = request.get_json(silent=True) or {}
    current_user()
    with db() as (conn, cur):
        u, s = seller_required(cur)
        _create_coupon(cur, s["id"], d)
    return ok(message="Coupon created. Customers can use it on your products.")


@seller_bp.route("/api/seller/coupons/<int:cid>", methods=["PUT"])
@api
def seller_coupon_update(cid):
    d = request.get_json(silent=True) or {}
    current_user()
    with db() as (conn, cur):
        u, s = seller_required(cur)
        _update_coupon(cur, cid, s["id"], d)
    return ok(message="Coupon saved")


@seller_bp.route("/api/seller/coupons/<int:cid>", methods=["DELETE"])
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
    admin = admin_required()
    d = request.get_json(silent=True) or {}
    with db() as (conn, cur):
        cid = _create_coupon(cur, None, d)
        audit(cur, admin, "coupon_created", "coupon", cid, text(d.get("code"), 40).upper())
    return ok(message="Coupon created. Zento pays this discount; sellers still get their full price.")


@bp.route("/api/admin/coupons/<int:cid>", methods=["PUT"])
@api
def admin_coupon_update(cid):
    admin = admin_required()
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
        audit(cur, admin, "coupon_updated", "coupon", cid, json.dumps({k: d[k] for k in d if k in ("active", "code", "value")})[:200])
    return ok(message="Coupon saved")


@bp.route("/api/admin/coupons/<int:cid>", methods=["DELETE"])
@api
def admin_coupon_delete(cid):
    admin = admin_required()
    with db() as (conn, cur):
        cur.execute("SELECT seller_id FROM coupons WHERE id=%s", (cid,))
        row = cur.fetchone()
        if not row:
            raise ApiError("Coupon not found", 404)
        msg = _delete_coupon(cur, cid, row["seller_id"])
        audit(cur, admin, "coupon_deleted", "coupon", cid, msg)
    return ok(message=msg)


# ---------------------------------------------------------------------
# ADMIN WALLET: your commission + the common pool of customer money
# ---------------------------------------------------------------------
def platform_balances(cur):
    cur.execute("SELECT wallet, COALESCE(SUM(amount),0) AS v FROM platform_transactions GROUP BY wallet")
    bal = {r["wallet"]: r["v"] for r in cur.fetchall()}
    pool, commission = bal.get("pool", Decimal("0")), bal.get("commission", Decimal("0"))
    cur.execute("SELECT COALESCE(SUM(amount),0) AS v FROM seller_transactions")
    seller_available = cur.fetchone()["v"]
    cur.execute("SELECT COALESCE(SUM(amount),0) AS v FROM withdrawals WHERE status='pending'")
    pending = cur.fetchone()["v"]
    cur.execute("SELECT type, COALESCE(SUM(amount),0) AS v FROM platform_transactions GROUP BY type")
    t = {r["type"]: r["v"] for r in cur.fetchall()}
    owed = seller_available + pending            # part of the pool that belongs to sellers
    other = pool - owed - commission

    # delivery charges of delivered orders, split by area (Dhaka division / outside)
    cur.execute("""
        SELECT CASE WHEN delivery_zone='dhaka' OR (COALESCE(delivery_zone,'')='' AND delivery_fee=70)
                    THEN 'dhaka' ELSE 'outside' END AS zone,
               COUNT(*) AS n, COALESCE(SUM(delivery_fee),0) AS fees
        FROM orders WHERE status='delivered' AND pool_credited_at IS NOT NULL
        GROUP BY 1""")
    zones = {r["zone"]: r for r in cur.fetchall()}
    dz, oz = zones.get("dhaka", {}), zones.get("outside", {})
    delivery_total = Decimal(dz.get("fees", 0) or 0) + Decimal(oz.get("fees", 0) or 0)

    cur.execute("SELECT COALESCE(SUM(-amount),0) AS v FROM seller_transactions WHERE type='return_charge'")
    return_recovered = cur.fetchone()["v"]
    cur.execute("SELECT COALESCE(SUM(refund_amount),0) AS v FROM orders WHERE refund_status='due'")
    refunds_due = cur.fetchone()["v"]
    cur.execute("SELECT COALESCE(SUM(refund_amount),0) AS v FROM orders WHERE refund_status='due' AND pool_credited_at IS NOT NULL")
    refunds_due_in_pool = cur.fetchone()["v"]
    cur.execute("""SELECT COALESCE(SUM(-bal),0) AS v FROM
                   (SELECT SUM(amount) AS bal FROM seller_transactions GROUP BY seller_id HAVING SUM(amount) < 0) x""")
    sellers_owe_us = cur.fetchone()["v"]
    cur.execute("SELECT COUNT(*) AS n FROM orders WHERE status='returned'")
    returned_orders = cur.fetchone()["n"]

    return {
        "delivery_total": delivery_total,
        "delivery_dhaka_orders": dz.get("n", 0), "delivery_dhaka_fees": dz.get("fees", 0),
        "delivery_outside_orders": oz.get("n", 0), "delivery_outside_fees": oz.get("fees", 0),
        "return_recovered": return_recovered, "refunds_due": refunds_due,
        "sellers_owe_us": sellers_owe_us, "returned_orders": returned_orders,
        "own_sales": other - delivery_total - return_recovered - refunds_due_in_pool,

        "pool": pool, "commission": commission,
        "seller_owed": owed, "seller_available": seller_available, "pending_withdrawals": pending,
        "other": other,                          # delivery fees, return charges and sales of your own products
        "collected_total": t.get("customer_payment", 0),
        "paid_to_sellers": -t.get("seller_payout", 0),
        "refunded_to_customers": -t.get("customer_refund", 0),
        "commission_earned": t.get("commission", 0) + t.get("commission_refund", 0),
        "coupon_cost": -(t.get("coupon_cost", 0) + t.get("coupon_cost_refund", 0)),
        "taken_out": -t.get("owner_withdrawal", 0) / 2,   # recorded in both wallets
    }


@bp.route("/api/admin/wallet", methods=["GET"])
@api
def admin_wallet():
    admin_required()
    which = request.args.get("wallet", "").strip().lower()
    with db() as (conn, cur):
        data = platform_balances(cur)
        where, params = "", []
        if which in ("pool", "commission"):
            where, params = "WHERE wallet=%s", [which]
        cur.execute(f"""SELECT id, wallet, type, amount, order_id, withdrawal_id, note, created_at
                        FROM platform_transactions {where} ORDER BY id DESC LIMIT 200""", params)
        return ok(balances=data, transactions=cur.fetchall())


@bp.route("/api/admin/wallet/commission-withdraw", methods=["POST"])
@api
def admin_wallet_commission_withdraw():
    admin = admin_required()
    d = request.get_json(silent=True) or {}
    try:
        amount = q2(d.get("amount"))
    except Exception:
        raise ApiError("Enter the amount")
    if amount <= 0:
        raise ApiError("Amount must be more than 0")
    note = text(d.get("note"), 200) or "Commission taken out by admin"
    with db() as (conn, cur):
        cur.execute("SELECT pg_advisory_xact_lock(7771002)")
        bal = platform_balances(cur)
        if amount > bal["commission"]:
            raise ApiError(f"Your commission wallet only has \u09f3{bal['commission']:.2f}")
        for wallet in ("commission", "pool"):     # the money leaves your wallet and the pool
            cur.execute("""INSERT INTO platform_transactions (wallet, type, amount, note, created_by)
                           VALUES (%s,'owner_withdrawal',%s,%s,%s)""", (wallet, -amount, note, admin["user_id"]))
        audit(cur, admin, "commission_taken", "wallet", None, f"{amount} {note}")
    return ok(message=f"\u09f3{amount:.2f} taken out of your commission wallet")


# ---------------------------------------------------------------------
# GO LIVE: clear TEST data (sales history) before real production
# ---------------------------------------------------------------------
RESET_CONFIRM_WORD = "DELETE TEST DATA"
# order matters (children first). Products, customers, sellers, coupons and admin accounts are NOT touched.
RESET_TABLES = [
    ("platform_transactions", "Admin wallet history"),
    ("seller_transactions", "Seller wallet history"),
    ("withdrawals", "Withdrawal requests"),
    ("reviews", "Product reviews"),
    ("return_requests", "Return requests"),
    ("complaints", "Complaints"),
    ("order_items", "Order items"),
    ("orders", "Orders"),
    ("chat_messages", "Customer chat messages"),
    ("audit_log", "Activity log"),
]


def _reset_counts(cur):
    out = []
    for table, label in RESET_TABLES:
        cur.execute("SELECT to_regclass(%s) AS t", (f"public.{table}",))
        if not cur.fetchone()["t"]:
            continue
        cur.execute(f"SELECT COUNT(*) AS n FROM {table}")
        out.append({"table": table, "label": label, "count": cur.fetchone()["n"]})
    return out


@bp.route("/api/admin/reset-data", methods=["GET"])
@api
def admin_reset_preview():
    admin_required()
    with db() as (conn, cur):
        return ok(tables=_reset_counts(cur), confirm_word=RESET_CONFIRM_WORD,
                  kept=["Products", "Customer accounts", "Sellers and seller applications", "Coupons (usage counts reset to 0)", "Admin accounts", "Settings"])


@bp.route("/api/admin/reset-data", methods=["POST"])
@api
def admin_reset_data():
    admin = admin_required()
    d = request.get_json(silent=True) or {}
    if str(d.get("confirm", "")).strip() != RESET_CONFIRM_WORD:
        raise ApiError(f'Type "{RESET_CONFIRM_WORD}" to confirm')
    with db() as (conn, cur):
        cur.execute("SELECT pg_advisory_xact_lock(7771003)")
        before = _reset_counts(cur)
        for table, _ in RESET_TABLES:
            cur.execute("SELECT to_regclass(%s) AS t", (f"public.{table}",))
            if cur.fetchone()["t"]:
                cur.execute(f"DELETE FROM {table}")
                cur.execute("SELECT pg_get_serial_sequence(%s, 'id') AS seq", (table,))
                seq = cur.fetchone()["seq"]
                if seq:
                    cur.execute("SELECT setval(%s, 1, false)", (seq,))   # next order is #1 again
        cur.execute("UPDATE coupons SET used_count = 0")
        cleared = sum(int(t["count"]) for t in before)
        audit(cur, admin, "test_data_cleared", "system", None, f"{cleared} rows removed before going live")
    return ok(message=f"Test data cleared ({cleared} rows). Your store is ready for real orders.", cleared=cleared)


# ---------------------------------------------------------------------
# AUDIT LOG
# ---------------------------------------------------------------------
def audit(cur, admin, action, target_type="", target_id=None, detail=""):
    """Record who did what in the admin panel. Works with any cursor and never blocks the action."""
    try:
        cur.execute("""INSERT INTO audit_log (admin_id, admin_email, action, target_type, target_id, detail)
                       VALUES (%s,%s,%s,%s,%s,%s)""",
                    (admin.get("user_id"), str(admin.get("email", ""))[:120], action, target_type,
                     "" if target_id is None else str(target_id), text(detail, 300)))
    except Exception:
        log.exception("audit log write failed")


@bp.route("/api/admin/audit", methods=["GET"])
@api
def admin_audit():
    admin_required()
    try:
        limit = max(1, min(int(request.args.get("limit", 200)), 500))
    except Exception:
        limit = 200
    with db() as (conn, cur):
        cur.execute("""SELECT id, admin_email, action, target_type, target_id, detail, created_at
                       FROM audit_log ORDER BY id DESC LIMIT %s""", (limit,))
        return ok(entries=cur.fetchall())


# ---------------------------------------------------------------------
# EMAIL (same Resend account the signup codes already use)
# ---------------------------------------------------------------------
def email_enabled():
    return bool(os.environ.get("RESEND_API_KEY"))


def send_email(to, subject, body_html):
    """Send in the background. Never raises, so an email problem cannot break an order."""
    key = os.environ.get("RESEND_API_KEY", "")
    if not key or not to:
        return False
    sender = os.environ.get("RESEND_FROM_EMAIL", "onboarding@resend.dev")
    page = f"""<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:24px">
      <h2 style="margin:0 0 12px">{html.escape(subject)}</h2>{body_html}
      <p style="color:#888;font-size:12px;margin-top:28px">Zento</p></div>"""

    def run():
        try:
            req = urllib.request.Request(
                "https://api.resend.com/emails",
                data=json.dumps({"from": sender, "to": [to], "subject": subject, "html": page}).encode("utf-8"),
                headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json", "User-Agent": "Zento/1.0"},
                method="POST")
            urllib.request.urlopen(req, timeout=20).read()
        except Exception as e:
            log.warning("email to %s failed: %s", to, e)
    threading.Thread(target=run, daemon=True).start()
    return True


def base_url():
    url = os.environ.get("PUBLIC_BASE_URL", "").rstrip("/")
    if url:
        return url
    url = request.host_url.rstrip("/")
    if url.startswith("http://") and "localhost" not in url and "127.0.0.1" not in url:
        url = "https://" + url[len("http://"):]
    return url


def seller_url():
    """Address of the seller panel (same server, /seller/). SELLER_APP_URL can override it."""
    return (os.environ.get("SELLER_APP_URL", "").rstrip("/") or f"{base_url()}/seller")


def notify_seller_credentials(email, owner, store, password):
    return send_email(email, "Your Zento seller account is ready", f"""
      <p>Hello {html.escape(owner)}, your store <b>{html.escape(store)}</b> was approved.</p>
      <p><b>Login ID:</b> {html.escape(email)}<br><b>Temporary password:</b> {html.escape(password)}</p>
      <p>Log in at <a href="{html.escape(seller_url())}/">{html.escape(seller_url())}/</a>.
      You will be asked to choose your own password the first time.</p>""")


def notify_order_status(order_id, status):
    """Email the customer about important order changes. Safe to call after the order transaction."""
    titles = {"approved": "The seller approved your order", "processing": "Your order reached the Zento warehouse",
              "shipped": "Your order has been shipped",
              "out_for_delivery": "Your order is out for delivery", "delivered": "Your order was delivered",
              "cancelled": "Your order was cancelled", "returned": "Your return was accepted"}
    if status not in titles or not email_enabled():
        return

    def run():
        try:
            with db() as (conn, cur):
                cur.execute("""SELECT o.id, o.total, o.refund_status, o.refund_amount, u.email, u.name
                               FROM orders o JOIN users u ON u.id=o.user_id WHERE o.id=%s""", (order_id,))
                o = cur.fetchone()
                if not o:
                    return
                cur.execute("""SELECT product_name, courier, tracking_no FROM order_items
                               WHERE order_id=%s ORDER BY id""", (order_id,))
                items = cur.fetchall()
            lines = "".join(
                f"<li>{html.escape(str(i['product_name']))}"
                + (f" - {html.escape(i['courier'])} tracking <b>{html.escape(i['tracking_no'])}</b>" if status == "shipped" and i["tracking_no"] else "")
                + "</li>" for i in items)
            extra = ""
            if o["refund_status"] == "due" and Decimal(o["refund_amount"]) > 0:
                extra = f"<p>We will refund <b>৳{Decimal(o['refund_amount']):.2f}</b> to you. We will email you when it is sent.</p>"
            send_email(o["email"], titles[status], f"""<p>Hello {html.escape(str(o['name']))}, order <b>#{o['id']}</b>:</p>
              <ul>{lines}</ul>{extra}<p>Total: ৳{Decimal(o['total']):.2f}</p>""")
        except Exception:
            log.exception("order status email failed")
    threading.Thread(target=run, daemon=True).start()


def notify_new_order(order_id):
    """Tell each seller about the items they must prepare."""
    if not email_enabled():
        return

    def run():
        try:
            with db() as (conn, cur):
                cur.execute("""SELECT s.id AS sid, s.store_name, u.email, oi.product_name, oi.quantity
                               FROM order_items oi JOIN sellers s ON s.id=oi.seller_id JOIN users u ON u.id=s.user_id
                               WHERE oi.order_id=%s ORDER BY s.id, oi.id""", (order_id,))
                rows = cur.fetchall()
            per = {}
            for r in rows:
                per.setdefault((r["sid"], r["email"], r["store_name"]), []).append(r)
            for (sid, email, store), items in per.items():
                lines = "".join(f"<li>{html.escape(str(i['product_name']))} × {i['quantity']}</li>" for i in items)
                send_email(email, f"New order #{order_id} for {store}", f"""<p>You received a new order.</p><ul>{lines}</ul>
                  <p>Zento will approve it first. After that, open your Seller Center and mark it shipped with the tracking number.</p>""")
        except Exception:
            log.exception("new order email failed")
    threading.Thread(target=run, daemon=True).start()


# ---------------------------------------------------------------------
# ORDER CANCEL / RETURN / REFUND
# ---------------------------------------------------------------------
def mp_reverse_order(cur, order_id, final_status, reason=""):
    """
    Cancel (before delivery) or return (after delivery) an order inside the caller's transaction:
    puts stock back, gives the coupon use back, takes any seller credit back and records
    how much the customer must be refunded. Raises ApiError when the change is not allowed.
    """
    c = cur.connection.cursor()
    c.execute("""SELECT status, total, payment_method, coupon_id FROM orders WHERE id=%s FOR UPDATE""", (order_id,))
    o = c.fetchone()
    if not o:
        raise ApiError("Order not found", 404)
    old, total, method, coupon_id = o
    if old in ("cancelled", "returned"):
        raise ApiError(f"This order is already {old}", 409)
    if final_status == "cancelled" and old == "delivered":
        raise ApiError("A delivered order cannot be cancelled. Mark it as returned instead.", 409)
    if final_status == "returned" and old != "delivered":
        raise ApiError("Only a delivered order can be returned.", 409)

    c.execute("SELECT product_id, quantity FROM order_items WHERE order_id=%s", (order_id,))
    for pid, qty in c.fetchall():
        c.execute("UPDATE products SET stock = COALESCE(stock,0) + %s WHERE id=%s", (qty, pid))
    if coupon_id:
        c.execute("UPDATE coupons SET used_count = GREATEST(used_count-1,0) WHERE id=%s", (coupon_id,))

    # Delivery fee of this order, so a RETURN can be charged to the seller(s) (never to the admin)
    c.execute("SELECT COALESCE(delivery_fee,0) FROM orders WHERE id=%s", (order_id,))
    order_delivery = Decimal(c.fetchone()[0] or 0)
    c.execute("SELECT COALESCE(SUM(subtotal),0) FROM order_items WHERE order_id=%s", (order_id,))
    order_items_total = Decimal(c.fetchone()[0] or 0)

    c.execute("""SELECT id, seller_id, seller_earning, COALESCE(commission_amount,0),
                        COALESCE(discount_amount,0), COALESCE(discount_by,''), subtotal
                 FROM order_items
                 WHERE order_id=%s AND credited_at IS NOT NULL AND refunded_at IS NULL FOR UPDATE""", (order_id,))
    for item_id, seller_id, earning, comm, disc, disc_by, item_subtotal in c.fetchall():
        # Admin wallet: the commission (and the Zento coupon cost) of this sale is reversed
        if comm and Decimal(comm) > 0:
            c.execute("""INSERT INTO platform_transactions (wallet, type, amount, order_id, order_item_id, note)
                         VALUES ('commission','commission_refund',%s,%s,%s,%s) ON CONFLICT DO NOTHING""",
                      (-comm, order_id, item_id, f"Order #{order_id} was {final_status}: commission taken back"))
        if disc_by == "platform" and disc and Decimal(disc) > 0:
            c.execute("""INSERT INTO platform_transactions (wallet, type, amount, order_id, order_item_id, note)
                         VALUES ('commission','coupon_cost_refund',%s,%s,%s,%s) ON CONFLICT DO NOTHING""",
                      (disc, order_id, item_id, f"Order #{order_id} was {final_status}: Zento coupon cost given back"))
        c.execute("""INSERT INTO seller_transactions (seller_id, type, amount, order_id, order_item_id, note)
                     VALUES (%s,'sale_refund',%s,%s,%s,%s)""",
                  (seller_id, -earning, order_id, item_id, f"Order #{order_id} was {final_status}: sale taken back"))
        # RETURN = the seller's responsibility. On top of taking the sale back, the delivery money the
        # customer gets refunded is charged to the seller, so the admin never carries the cost of a return.
        if final_status == "returned" and order_delivery > 0 and order_items_total > 0:
            share = q2(order_delivery * Decimal(item_subtotal or 0) / order_items_total)
            if share > 0:
                c.execute("""INSERT INTO seller_transactions (seller_id, type, amount, order_id, order_item_id, note)
                             VALUES (%s,'return_charge',%s,%s,%s,%s)""",
                          (seller_id, -share, order_id, item_id,
                           f"Order #{order_id} was returned: delivery charge {share} is charged to the seller"))
        c.execute("UPDATE order_items SET refunded_at=NOW() WHERE id=%s", (item_id,))

    # the customer needs money back if they already paid (online) or the goods were delivered and returned
    refund = Decimal(total or 0) if (final_status == "returned" or method in ("bkash", "nagad")) else Decimal("0")
    c.execute("""UPDATE orders SET status=%s, cancelled_at=NOW(), cancel_reason=%s, updated_at=NOW(),
                        refund_status=%s, refund_amount=%s WHERE id=%s""",
              (final_status, text(reason, 200), "due" if refund > 0 else "none", refund, order_id))


@bp.route("/api/orders/<int:oid>/cancel", methods=["POST"])
@api
def customer_cancel_order(oid):
    u = current_user()
    d = request.get_json(silent=True) or {}
    with db() as (conn, cur):
        cur.execute("SELECT status, user_id FROM orders WHERE id=%s", (oid,))
        o = cur.fetchone()
        if not o or o["user_id"] != u["user_id"]:
            raise ApiError("Order not found", 404)
        if o["status"] not in ("pending", "approved"):
            raise ApiError("This order is already being prepared. Please contact support to cancel it.", 409)
        cur.execute("SELECT 1 FROM order_items WHERE order_id=%s AND fulfil_status IN ('sent_to_warehouse','at_warehouse','with_courier') LIMIT 1", (oid,))
        if cur.fetchone():
            raise ApiError("The seller already sent your product to the Zento warehouse. Please contact support to cancel it.", 409)
        mp_reverse_order(cur, oid, "cancelled", text(d.get("reason"), 200) or "Cancelled by customer")
    notify_order_status(oid, "cancelled")
    return ok(message="Order cancelled")


@bp.route("/api/admin/orders/<int:oid>/refund-done", methods=["POST"])
@api
def admin_refund_done(oid):
    admin = admin_required()
    d = request.get_json(silent=True) or {}
    with db() as (conn, cur):
        cur.execute("""UPDATE orders SET refund_status='refunded', refund_done_at=NOW(), updated_at=NOW()
                       WHERE id=%s AND refund_status='due' RETURNING id, refund_amount""", (oid,))
        row = cur.fetchone()
        if not row:
            raise ApiError("No refund is due for this order", 404)
        cur.execute("SELECT pool_credited_at FROM orders WHERE id=%s", (oid,))
        if (cur.fetchone() or {}).get("pool_credited_at"):
            cur.execute("""INSERT INTO platform_transactions (wallet, type, amount, order_id, note, created_by)
                           VALUES ('pool','customer_refund',%s,%s,%s,%s) ON CONFLICT DO NOTHING""",
                        (-row["refund_amount"], oid, f"Refund sent to customer, order #{oid}", admin["user_id"]))
        audit(cur, admin, "refund_sent", "order", oid, f"{row['refund_amount']} {text(d.get('note'), 150)}")
    if email_enabled():
        def run():
            try:
                with db() as (conn, cur):
                    cur.execute("SELECT u.email, u.name FROM orders o JOIN users u ON u.id=o.user_id WHERE o.id=%s", (oid,))
                    r = cur.fetchone()
                if r:
                    send_email(r["email"], "Your refund was sent", f"<p>Hello {html.escape(str(r['name']))}, we sent your refund of <b>৳{Decimal(row['refund_amount']):.2f}</b> for order #{oid}.</p>")
            except Exception:
                log.exception("refund email failed")
        threading.Thread(target=run, daemon=True).start()
    return ok(message="Marked as refunded")


# ---------------------------------------------------------------------
# SELLER SHIPPING
# ---------------------------------------------------------------------
COURIERS = ("Pathao", "Steadfast", "RedX", "Paperfly", "eCourier", "Sundarban", "SA Paribahan", "Own delivery", "Other")


# ---------------------------------------------------------------------
# SELLER PASSWORD RESET (emailed link that works once for 30 minutes)
# ---------------------------------------------------------------------
_reset_sent = {}


@seller_bp.route("/api/seller/forgot-password", methods=["POST"])
@api
def seller_forgot_password():
    d = request.get_json(silent=True) or {}
    email = text(d.get("email"), 120).lower()
    generic = ok(message="If this email belongs to a seller account, a reset link has been sent.")
    if not EMAIL_RE.match(email):
        return generic
    import time
    now = time.time()
    if now - _reset_sent.get(email, 0) < 120:      # at most one email every 2 minutes per address
        return generic
    _reset_sent[email] = now
    token = secrets.token_urlsafe(32)
    with db() as (conn, cur):
        cur.execute("""SELECT u.id, u.name FROM users u JOIN sellers s ON s.user_id=u.id WHERE u.email=%s""", (email,))
        u = cur.fetchone()
        if not u:
            return generic
        cur.execute("UPDATE password_resets SET used_at=NOW() WHERE user_id=%s AND used_at IS NULL", (u["id"],))
        cur.execute("""INSERT INTO password_resets (user_id, token_hash, expires_at)
                       VALUES (%s,%s,NOW() + INTERVAL '30 minutes')""", (u["id"], hashlib.sha256(token.encode()).hexdigest()))
    link = f"{seller_url()}/?reset={token}"
    send_email(email, "Reset your Zento seller password", f"""<p>Hello {html.escape(str(u['name']))},</p>
      <p>Open this link to choose a new password. It works once and expires in 30 minutes.</p>
      <p><a href="{html.escape(link)}">{html.escape(link)}</a></p>
      <p>If you did not ask for this, ignore this email. Your password stays the same.</p>""")
    return generic


@seller_bp.route("/api/seller/reset-password", methods=["POST"])
@api
def seller_reset_password():
    d = request.get_json(silent=True) or {}
    token, new = str(d.get("token") or ""), d.get("new_password") or ""
    if len(new) < 8:
        raise ApiError("Password must be at least 8 characters")
    with db() as (conn, cur):
        cur.execute("""SELECT id, user_id FROM password_resets
                       WHERE token_hash=%s AND used_at IS NULL AND expires_at > NOW() FOR UPDATE""",
                    (hashlib.sha256(token.encode()).hexdigest(),))
        r = cur.fetchone()
        if not r:
            raise ApiError("This reset link is invalid or has expired. Ask for a new one.", 400)
        cur.execute("UPDATE users SET password_hash=%s WHERE id=%s", (generate_password_hash(new), r["user_id"]))
        cur.execute("UPDATE password_resets SET used_at=NOW() WHERE id=%s", (r["id"],))
        cur.execute("UPDATE sellers SET must_change_password=FALSE WHERE user_id=%s", (r["user_id"],))
    return ok(message="Password changed. You can log in now.")


# ---------------------------------------------------------------------
# PAGES  (the Seller Center page now lives in seller_app/, a separate service)
# ---------------------------------------------------------------------
@seller_bp.route("/seller")
def seller_redirect():
    return redirect("/seller/", code=302)


def _no_cache(resp):
    # the seller panel changes often and runs inside an app WebView: never serve a stale copy
    resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    resp.headers["Pragma"] = "no-cache"
    return resp


@seller_bp.route("/seller/")
def seller_page():
    return _no_cache(send_from_directory(os.path.join(_H["base_dir"], "seller"), "index.html"))


@seller_bp.route("/seller/<path:filename>")
def seller_files(filename):
    return _no_cache(send_from_directory(os.path.join(_H["base_dir"], "seller"), filename))


@bp.route("/store/<slug>")
def store_page(slug):
    path = os.path.join(_H["base_dir"], "store.html")
    if not os.path.isfile(path):
        abort(404)
    return send_from_directory(_H["base_dir"], "store.html")


# ---------------------------------------------------------------------
# ---------------------------------------------------------------------
# ORDER FLOW: seller approves -> seller sends to Zento warehouse -> Zento receives
#             -> Zento hands to courier -> delivered (money reaches the admin wallet)
# ---------------------------------------------------------------------
FULFIL_RANK = {"placed": 0, "seller_approved": 1, "sent_to_warehouse": 2, "at_warehouse": 3, "with_courier": 4}
OPEN_ORDER = ("pending", "approved", "processing")


def _item_rank(seller_id, status):
    r = FULFIL_RANK.get(status or "placed", 0)
    return max(r, 3) if seller_id is None else r        # Zento's own products are already in the warehouse


def advance_order(cur, order_id):
    """Moves the customer-facing order status forward when every item has reached the next stage.
    Returns the new status (so the caller can email the customer) or None."""
    c = cur.connection.cursor()
    c.execute("SELECT status FROM orders WHERE id=%s FOR UPDATE", (order_id,))
    row = c.fetchone()
    if not row or row[0] not in ("pending", "approved", "processing"):
        return None
    c.execute("SELECT seller_id, fulfil_status FROM order_items WHERE order_id=%s", (order_id,))
    ranks = [_item_rank(sid, st) for sid, st in c.fetchall()]
    if not ranks:
        return None
    low = min(ranks)
    target = "shipped" if low >= 4 else "processing" if low >= 3 else "approved" if low >= 1 else "pending"
    order = ["pending", "approved", "processing", "shipped"]
    if order.index(target) > order.index(row[0]):
        c.execute("""UPDATE orders SET status=%s, approved_at=COALESCE(approved_at, NOW()), updated_at=NOW()
                     WHERE id=%s""", (target, order_id))
        return target
    return None


def mp_check_flow(cur, order_id, new_status):
    """Called by the admin status buttons: the admin cannot skip the seller / warehouse steps."""
    need = {"approved": 1, "processing": 3, "shipped": 3, "out_for_delivery": 3, "delivered": 3}.get(new_status)
    if need is None:
        return
    c = cur.connection.cursor()
    c.execute("SELECT seller_id, fulfil_status FROM order_items WHERE order_id=%s", (order_id,))
    for sid, st in c.fetchall():
        if _item_rank(sid, st) < need:
            raise ApiError("The seller has not approved this order yet." if need == 1 else
                           "The products have not reached the Zento warehouse yet. Receive them in Warehouse first.", 409)
    if new_status in ("shipped", "out_for_delivery", "delivered"):
        c.execute("""UPDATE order_items SET fulfil_status='with_courier', shipped_at=COALESCE(shipped_at, NOW())
                     WHERE order_id=%s""", (order_id,))


# ---- seller side -------------------------------------------------------
def _seller_item(cur, s, item_id):
    cur.execute("""SELECT oi.id, oi.order_id, oi.fulfil_status, o.status
                   FROM order_items oi JOIN orders o ON o.id=oi.order_id
                   WHERE oi.id=%s AND oi.seller_id=%s FOR UPDATE OF oi""", (item_id, s["id"]))
    row = cur.fetchone()
    if not row:
        raise ApiError("Order item not found", 404)
    if row["status"] not in OPEN_ORDER:
        raise ApiError(f"This order is {row['status']}, nothing more to do", 409)
    return row


@seller_bp.route("/api/seller/orders/<int:item_id>/approve", methods=["POST"])
@api
def seller_approve_item(item_id):
    current_user()
    advanced = None
    with db() as (conn, cur):
        u, s = seller_required(cur)
        row = _seller_item(cur, s, item_id)
        if row["fulfil_status"] != "placed":
            raise ApiError("You already approved this order", 409)
        cur.execute("UPDATE order_items SET fulfil_status='seller_approved', seller_approved_at=NOW() WHERE id=%s", (item_id,))
        advanced = advance_order(cur, row["order_id"])
        oid = row["order_id"]
    if advanced:
        notify_order_status(oid, advanced)
    return ok(message="Order approved. Now pack it and send it to the Zento warehouse.")


def _send_to_warehouse(item_id, courier, tracking):
    current_user()
    with db() as (conn, cur):
        u, s = seller_required(cur)
        row = _seller_item(cur, s, item_id)
        if row["fulfil_status"] == "placed":
            raise ApiError("Approve the order first", 409)
        if FULFIL_RANK.get(row["fulfil_status"], 0) >= 3:
            raise ApiError("Zento already received this product", 409)
        cur.execute("""UPDATE order_items SET fulfil_status='sent_to_warehouse',
                              sent_to_warehouse_at=COALESCE(sent_to_warehouse_at, NOW()),
                              to_wh_courier=%s, to_wh_tracking=%s WHERE id=%s""", (courier, tracking, item_id))
    return ok(message="Marked as sent. Zento will confirm when the product arrives at the warehouse.")


@seller_bp.route("/api/seller/orders/<int:item_id>/send-warehouse", methods=["POST"])
@api
def seller_send_warehouse(item_id):
    d = request.get_json(silent=True) or {}
    return _send_to_warehouse(item_id, text(d.get("courier"), 40), text(d.get("tracking_no"), 60))


@seller_bp.route("/api/seller/orders/<int:item_id>/ship", methods=["POST"])
@api
def seller_ship_item(item_id):
    # kept so older app versions still work: "ship" now means "send to the Zento warehouse"
    d = request.get_json(silent=True) or {}
    return _send_to_warehouse(item_id, text(d.get("courier"), 40), text(d.get("tracking_no"), 60))


@seller_bp.route("/api/seller/complaints", methods=["GET"])
@api
def seller_complaints():
    current_user()
    with db() as (conn, cur):
        u, s = seller_required(cur)
        cur.execute("""SELECT c.id, c.order_id, c.subject, c.message, c.status, c.admin_note, c.created_at, us.name AS customer
                       FROM complaints c JOIN users us ON us.id=c.user_id
                       WHERE c.seller_id=%s ORDER BY c.id DESC LIMIT 100""", (s["id"],))
        return ok(complaints=cur.fetchall())


# ---- admin: warehouse --------------------------------------------------
@bp.route("/api/admin/warehouse", methods=["GET"])
@api
def admin_warehouse():
    admin_required()
    with db() as (conn, cur):
        cur.execute("""
            SELECT o.id, o.customer_name, o.phone, o.address, o.city, o.payment_method, o.total, o.status,
                   COALESCE(o.payment_trx_id,'') AS payment_trx_id, o.created_at
            FROM orders o
            WHERE o.status IN ('pending','approved','processing')
              AND EXISTS (SELECT 1 FROM order_items x WHERE x.order_id=o.id AND x.seller_id IS NOT NULL
                          AND x.fulfil_status IN ('seller_approved','sent_to_warehouse','at_warehouse'))
            ORDER BY o.id DESC LIMIT 200""")
        orders = cur.fetchall()
        ids = [o["id"] for o in orders]
        items = {}
        if ids:
            cur.execute("""SELECT oi.id, oi.order_id, oi.product_name, oi.quantity, oi.seller_id, oi.fulfil_status,
                                  oi.sent_to_warehouse_at, oi.warehouse_received_at, oi.to_wh_courier, oi.to_wh_tracking,
                                  COALESCE(s.store_name,'Zento') AS store_name
                           FROM order_items oi LEFT JOIN sellers s ON s.id=oi.seller_id
                           WHERE oi.order_id = ANY(%s) ORDER BY oi.id""", (ids,))
            for it in cur.fetchall():
                items.setdefault(it["order_id"], []).append(it)
        for o in orders:
            o["items"] = items.get(o["id"], [])
            o["ready"] = all(_item_rank(i["seller_id"], i["fulfil_status"]) >= 3 for i in o["items"])
        return ok(orders=orders, couriers=COURIERS)


@bp.route("/api/admin/order-items/<int:item_id>/receive", methods=["POST"])
@api
def admin_receive_item(item_id):
    admin = admin_required()
    advanced = oid = None
    with db() as (conn, cur):
        cur.execute("""SELECT oi.id, oi.order_id, oi.fulfil_status, oi.product_name, o.status
                       FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE oi.id=%s FOR UPDATE OF oi""", (item_id,))
        row = cur.fetchone()
        if not row:
            raise ApiError("Item not found", 404)
        if row["status"] not in OPEN_ORDER:
            raise ApiError(f"This order is {row['status']}", 409)
        if row["fulfil_status"] not in ("seller_approved", "sent_to_warehouse"):
            raise ApiError("The seller has not approved this item yet" if row["fulfil_status"] == "placed"
                           else "This item is already in the warehouse", 409)
        cur.execute("UPDATE order_items SET fulfil_status='at_warehouse', warehouse_received_at=NOW() WHERE id=%s", (item_id,))
        advanced = advance_order(cur, row["order_id"])
        oid = row["order_id"]
        audit(cur, admin, "warehouse_received", "order", oid, row["product_name"])
    if advanced:
        notify_order_status(oid, advanced)
    return ok(message="Received at the warehouse")


@bp.route("/api/admin/orders/<int:oid>/handover", methods=["POST"])
@api
def admin_handover_order(oid):
    admin = admin_required()
    d = request.get_json(silent=True) or {}
    courier = text(d.get("courier"), 40)
    tracking = text(d.get("tracking_no"), 60)
    if courier not in COURIERS:
        raise ApiError("Choose a courier")
    if len(tracking) < 3:
        raise ApiError("Enter the courier tracking number")
    with db() as (conn, cur):
        cur.execute("SELECT status FROM orders WHERE id=%s FOR UPDATE", (oid,))
        o = cur.fetchone()
        if not o:
            raise ApiError("Order not found", 404)
        if o["status"] not in OPEN_ORDER:
            raise ApiError(f"This order is {o['status']}", 409)
        cur.execute("SELECT seller_id, fulfil_status FROM order_items WHERE order_id=%s", (oid,))
        rows = cur.fetchall()
        if any(_item_rank(r["seller_id"], r["fulfil_status"]) < 3 for r in rows):
            raise ApiError("Some products have not reached the warehouse yet", 409)
        cur.execute("""UPDATE order_items SET fulfil_status='with_courier', courier=%s, tracking_no=%s,
                              shipped_at=COALESCE(shipped_at, NOW()),
                              warehouse_received_at=COALESCE(warehouse_received_at, NOW())
                       WHERE order_id=%s""", (courier, tracking, oid))
        cur.execute("UPDATE orders SET status='shipped', approved_at=COALESCE(approved_at, NOW()), updated_at=NOW() WHERE id=%s", (oid,))
        audit(cur, admin, "handed_to_courier", "order", oid, f"{courier} {tracking}")
    notify_order_status(oid, "shipped")
    return ok(message=f"Order #{oid} handed to {courier}")


# ---- customer: return request + complaint ------------------------------
def _return_days(cur):
    try:
        return max(0, int(get_settings(cur).get("return_days", "7")))
    except Exception:
        return 7


@bp.route("/api/orders/<int:oid>/return-request", methods=["POST"])
@api
def customer_return_request(oid):
    u = current_user()
    d = request.get_json(silent=True) or {}
    reason = text(d.get("reason"), 500)
    if len(reason) < 5:
        raise ApiError("Please tell us why you want to return it")
    with db() as (conn, cur):
        cur.execute("""SELECT status, user_id, COALESCE(delivered_at, updated_at) AS delivered
                       FROM orders WHERE id=%s FOR UPDATE""", (oid,))
        o = cur.fetchone()
        if not o or o["user_id"] != u["user_id"]:
            raise ApiError("Order not found", 404)
        if o["status"] != "delivered":
            raise ApiError("Only a delivered order can be returned", 409)
        days = _return_days(cur)
        cur.execute("SELECT NOW() - %s::timestamptz > make_interval(days => %s) AS late", (o["delivered"], days))
        if cur.fetchone()["late"]:
            raise ApiError(f"The {days}-day return period is over for this order", 409)
        cur.execute("SELECT 1 FROM return_requests WHERE order_id=%s", (oid,))
        if cur.fetchone():
            raise ApiError("You already sent a return request for this order", 409)
        cur.execute("INSERT INTO return_requests (order_id, user_id, reason) VALUES (%s,%s,%s)", (oid, u["user_id"], reason))
    return ok(message="Return request sent. Our team will contact you soon.")


@bp.route("/api/orders/<int:oid>/complaints", methods=["POST"])
@api
def customer_complaint(oid):
    u = current_user()
    d = request.get_json(silent=True) or {}
    message = text(d.get("message"), 1500)
    subject = text(d.get("subject"), 100)
    try:
        seller_id = int(d.get("seller_id"))
    except Exception:
        raise ApiError("Choose the seller")
    if len(message) < 10:
        raise ApiError("Please describe the problem (at least 10 letters)")
    with db() as (conn, cur):
        cur.execute("SELECT user_id FROM orders WHERE id=%s", (oid,))
        o = cur.fetchone()
        if not o or o["user_id"] != u["user_id"]:
            raise ApiError("Order not found", 404)
        cur.execute("SELECT 1 FROM order_items WHERE order_id=%s AND seller_id=%s LIMIT 1", (oid, seller_id))
        if not cur.fetchone():
            raise ApiError("This seller is not part of this order", 400)
        cur.execute("SELECT COUNT(*) AS n FROM complaints WHERE user_id=%s AND order_id=%s AND seller_id=%s AND status='open'",
                    (u["user_id"], oid, seller_id))
        if cur.fetchone()["n"] >= 3:
            raise ApiError("You already have open complaints about this seller for this order. Please wait for our reply.", 429)
        cur.execute("INSERT INTO complaints (user_id, order_id, seller_id, subject, message) VALUES (%s,%s,%s,%s,%s)",
                    (u["user_id"], oid, seller_id, subject or "Problem with seller", message))
    return ok(message="Complaint sent. Zento will look into it and reply.")


def customer_order_extras(user_id, orders):
    """Adds seller names, rating state, return and complaint info to the customer's order list."""
    ids = [o["id"] for o in orders]
    if not ids:
        return
    with db() as (conn, cur):
        days = _return_days(cur)
        cur.execute("""SELECT oi.order_id, oi.seller_id, oi.fulfil_status, s.store_name, s.slug
                       FROM order_items oi LEFT JOIN sellers s ON s.id=oi.seller_id
                       WHERE oi.order_id = ANY(%s) ORDER BY oi.id ASC""", (ids,))
        by_order = {}
        for r in cur.fetchall():
            by_order.setdefault(r["order_id"], []).append(r)
        cur.execute("SELECT DISTINCT product_id FROM reviews WHERE user_id=%s", (user_id,))
        reviewed = {r["product_id"] for r in cur.fetchall()}
        cur.execute("""SELECT DISTINCT ON (order_id) order_id, status, reason, admin_note
                       FROM return_requests WHERE order_id = ANY(%s) ORDER BY order_id, id DESC""", (ids,))
        returns = {r["order_id"]: r for r in cur.fetchall()}
        cur.execute("SELECT order_id, seller_id, status FROM complaints WHERE user_id=%s AND order_id = ANY(%s)", (user_id, ids))
        complaints = {}
        for r in cur.fetchall():
            complaints.setdefault(r["order_id"], []).append({"seller_id": r["seller_id"], "status": r["status"]})
        cur.execute("""SELECT id, (NOW() - COALESCE(delivered_at, updated_at) <= make_interval(days => %s)) AS in_window
                       FROM orders WHERE id = ANY(%s)""", (days, ids))
        window = {r["id"]: r["in_window"] for r in cur.fetchall()}
    for o in orders:
        rows = by_order.get(o["id"], [])
        for i, it in enumerate(o.get("items", [])):
            r = rows[i] if i < len(rows) else {}
            it["seller_id"] = r.get("seller_id")
            it["seller_name"] = r.get("store_name") or ""
            it["seller_slug"] = r.get("slug") or ""
            it["fulfil_status"] = r.get("fulfil_status") or "placed"
            it["reviewed"] = it.get("product_id") in reviewed
        o["return_request"] = returns.get(o["id"])
        o["return_days"] = days
        o["can_return"] = o["status"] == "delivered" and o["id"] not in returns and bool(window.get(o["id"]))
        o["complaints"] = complaints.get(o["id"], [])


# ---- admin: returns + complaints ---------------------------------------
@bp.route("/api/admin/returns", methods=["GET"])
@api
def admin_returns():
    admin_required()
    status = request.args.get("status", "")
    with db() as (conn, cur):
        cur.execute("""
            SELECT rr.id, rr.order_id, rr.reason, rr.status, rr.admin_note, rr.created_at, rr.resolved_at,
                   o.customer_name, o.phone, o.total, o.delivery_fee, o.payment_method, u.email,
                   (SELECT string_agg(DISTINCT COALESCE(s.store_name,'Zento'), ', ')
                      FROM order_items oi LEFT JOIN sellers s ON s.id=oi.seller_id WHERE oi.order_id=o.id) AS sellers,
                   (SELECT string_agg(oi.product_name || ' x' || oi.quantity, ', ')
                      FROM order_items oi WHERE oi.order_id=o.id) AS items
            FROM return_requests rr JOIN orders o ON o.id=rr.order_id JOIN users u ON u.id=rr.user_id
            WHERE (%s = '' OR rr.status = %s) ORDER BY rr.id DESC LIMIT 200""", (status, status))
        return ok(returns=cur.fetchall())


@bp.route("/api/admin/returns/<int:rid>/<action>", methods=["POST"])
@api
def admin_return_action(rid, action):
    admin = admin_required()
    d = request.get_json(silent=True) or {}
    note = text(d.get("note"), 300)
    if action not in ("approve", "reject"):
        raise ApiError("Unknown action", 404)
    if action == "reject" and len(note) < 3:
        raise ApiError("Write the reason so the customer understands")
    order_id = None
    with db() as (conn, cur):
        cur.execute("SELECT id, order_id, status, reason FROM return_requests WHERE id=%s FOR UPDATE", (rid,))
        r = cur.fetchone()
        if not r:
            raise ApiError("Request not found", 404)
        if r["status"] != "requested":
            raise ApiError("This request was already handled", 409)
        order_id = r["order_id"]
        if action == "approve":
            # the sale is taken back from the SELLER(s); the delivery charge is charged to them too
            mp_reverse_order(cur, order_id, "returned", "Customer return: " + r["reason"])
        cur.execute("""UPDATE return_requests SET status=%s, admin_note=%s, resolved_at=NOW() WHERE id=%s""",
                    ("approved" if action == "approve" else "rejected", note, rid))
        audit(cur, admin, "return_" + action, "order", order_id, note)
    if action == "approve":
        notify_order_status(order_id, "returned")
    return ok(message="Return accepted. The seller was charged and the refund is now due." if action == "approve"
              else "Return request rejected")


@bp.route("/api/admin/complaints", methods=["GET"])
@api
def admin_complaints():
    admin_required()
    status = request.args.get("status", "")
    with db() as (conn, cur):
        cur.execute("""
            SELECT c.id, c.order_id, c.subject, c.message, c.status, c.admin_note, c.created_at,
                   s.id AS seller_id, s.store_name, us.name AS customer, us.email, o.phone,
                   (SELECT COUNT(*) FROM complaints x WHERE x.seller_id=c.seller_id) AS seller_total
            FROM complaints c JOIN sellers s ON s.id=c.seller_id JOIN users us ON us.id=c.user_id
            LEFT JOIN orders o ON o.id=c.order_id
            WHERE (%s = '' OR c.status = %s) ORDER BY c.id DESC LIMIT 200""", (status, status))
        return ok(complaints=cur.fetchall())


@bp.route("/api/admin/complaints/<int:cid>/resolve", methods=["POST"])
@api
def admin_complaint_resolve(cid):
    admin = admin_required()
    d = request.get_json(silent=True) or {}
    status = d.get("status") if d.get("status") in ("resolved", "dismissed") else "resolved"
    note = text(d.get("note"), 300)
    with db() as (conn, cur):
        cur.execute("""UPDATE complaints SET status=%s, admin_note=%s, resolved_at=NOW()
                       WHERE id=%s AND status='open' RETURNING id""", (status, note, cid))
        if not cur.fetchone():
            raise ApiError("Complaint not found or already closed", 404)
        audit(cur, admin, "complaint_" + status, "complaint", cid, note)
    return ok(message="Complaint closed")




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
    app.register_blueprint(seller_bp)
