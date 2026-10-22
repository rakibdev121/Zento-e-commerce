"""
ZENTO OFFERS MODULE
-------------------
Admin and sellers can run many kinds of offers. Everything a customer wins is paid out
as a PERSONAL COUPON in the existing `coupons` table, so checkout, seller wallet and
commission maths keep working with no extra code:

  * seller offer  -> coupon.seller_id = seller  (the seller pays the discount)
  * admin offer   -> coupon.seller_id = NULL     (Zento pays the discount)

Offer kinds (one table, `config` JSON holds kind specific settings)
  mystery_box   random prize box that drops on the customer's screen
  spin_wheel    same prize engine, shown as a wheel
  scratch_card  same prize engine, shown as a scratch card
  quiz          question with options; right answer wins the prize
  flash_sale    time limited sale price on chosen products (countdown)
  event         festival / campaign banner that slides at the top of the website
  coupon_drop   claim a coupon, first N customers only
  free_shipping free delivery day (claimable coupon)
  spend_save    "spend X, save Y" claimable coupon
  welcome       first order gift (only customers with no order yet)
  free_gift     claim a free product when the cart reaches a minimum
  lucky_draw    customers enter, admin draws a winner

Plugged in from the bottom of backend/app.py via init_offers().
Tables are created automatically (CREATE TABLE IF NOT EXISTS) at boot.
"""

import re
import json
import random
import secrets
import logging
import datetime
from decimal import Decimal, ROUND_HALF_UP
from functools import wraps

import psycopg2
import psycopg2.extras
from flask import Blueprint, request

import marketplace as _mpmod  # same folder, loaded by app.py before this module

log = logging.getLogger("zento.offers")
bp = Blueprint("offers", __name__)
_H = {}
READY = False

KINDS = {
    "mystery_box":   {"label": "Mystery Box",        "prizes": True,  "pop": True,  "limit": 1},
    "spin_wheel":    {"label": "Lucky Spin Wheel",   "prizes": True,  "pop": False, "limit": 1},
    "scratch_card":  {"label": "Scratch Card",       "prizes": True,  "pop": False, "limit": 1},
    "quiz":          {"label": "Quiz",               "prizes": True,  "pop": False, "limit": 1},
    "flash_sale":    {"label": "Flash Sale",         "prizes": False, "pop": False, "limit": 0},
    "event":         {"label": "Event banner",       "prizes": False, "pop": False, "limit": 0},
    "coupon_drop":   {"label": "Coupon Drop",        "prizes": True,  "pop": False, "limit": 1},
    "free_shipping": {"label": "Free Shipping Day",  "prizes": False, "pop": False, "limit": 1},
    "spend_save":    {"label": "Spend and Save",     "prizes": True,  "pop": False, "limit": 1},
    "welcome":       {"label": "Welcome Gift",       "prizes": True,  "pop": False, "limit": 1},
    "free_gift":     {"label": "Free Gift Offer",    "prizes": True,  "pop": False, "limit": 1},
    "lucky_draw":    {"label": "Lucky Draw",         "prizes": True,  "pop": False, "limit": 1},
}
SELLER_KINDS = ("mystery_box", "spin_wheel", "scratch_card", "quiz", "flash_sale", "event", "coupon_drop",
                "spend_save", "free_gift")
PRIZE_TYPES = ("percent", "fixed", "free_product", "free_shipping", "nothing")

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS offers (
    id BIGSERIAL PRIMARY KEY,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    subtitle TEXT DEFAULT '',
    description TEXT DEFAULT '',
    image_url TEXT DEFAULT '',
    color TEXT DEFAULT '#00e5c2',
    cta_label TEXT DEFAULT '',
    seller_id BIGINT REFERENCES sellers(id) ON DELETE CASCADE,
    starts_at TIMESTAMPTZ,
    ends_at TIMESTAMPTZ,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    show_banner BOOLEAN NOT NULL DEFAULT TRUE,
    per_user_limit INTEGER NOT NULL DEFAULT 1,
    total_limit INTEGER,
    claimed_count INTEGER NOT NULL DEFAULT 0,
    config JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS offers_kind_idx ON offers (kind, active);

CREATE TABLE IF NOT EXISTS offer_prizes (
    id BIGSERIAL PRIMARY KEY,
    offer_id BIGINT NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    prize_type TEXT NOT NULL DEFAULT 'percent',
    value NUMERIC(12,2) NOT NULL DEFAULT 0,
    max_discount NUMERIC(12,2),
    min_order NUMERIC(12,2) NOT NULL DEFAULT 0,
    product_id BIGINT,
    weight INTEGER NOT NULL DEFAULT 10,
    stock INTEGER,
    given_count INTEGER NOT NULL DEFAULT 0,
    valid_days INTEGER NOT NULL DEFAULT 7,
    sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS offer_prizes_offer_idx ON offer_prizes (offer_id);

CREATE TABLE IF NOT EXISTS offer_products (
    id BIGSERIAL PRIMARY KEY,
    offer_id BIGINT NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
    product_id BIGINT NOT NULL,
    discount_percent NUMERIC(5,2) NOT NULL DEFAULT 10,
    qty_limit INTEGER,
    sold INTEGER NOT NULL DEFAULT 0,
    UNIQUE (offer_id, product_id)
);
CREATE INDEX IF NOT EXISTS offer_products_product_idx ON offer_products (product_id);

CREATE TABLE IF NOT EXISTS offer_claims (
    id BIGSERIAL PRIMARY KEY,
    offer_id BIGINT NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL,
    prize_id BIGINT,
    prize_label TEXT DEFAULT '',
    coupon_code TEXT DEFAULT '',
    correct BOOLEAN,
    is_winner BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS offer_claims_user_idx ON offer_claims (user_id, offer_id);

ALTER TABLE coupons ADD COLUMN IF NOT EXISTS user_id BIGINT;
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS product_id BIGINT;
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS free_shipping BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS offer_id BIGINT;
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS label TEXT DEFAULT '';
"""


# ---------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------
ApiError = _mpmod.ApiError
ok = _mpmod.ok
db = _mpmod.db
text = _mpmod.text
q2 = _mpmod.q2


def api(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        try:
            return _mpmod.ser(fn(*args, **kwargs))
        except ApiError as e:
            return {"status": "error", "message": e.message}, e.code
        except Exception:
            log.exception("offers error in %s", fn.__name__)
            return {"status": "error", "message": "Server error. Please try again."}, 500
    return wrapper


def ensure_tables():
    global READY
    conn = psycopg2.connect(__import__("os").environ["DATABASE_URL"])
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


def _ready():
    if not READY:
        try:
            ensure_tables()
        except Exception:
            pass


def now_utc():
    return datetime.datetime.now(datetime.timezone.utc)


def parse_dt(value, end_of_day=False):
    """Accepts 2026-12-31 or 2026-12-31T18:30 (Bangladesh time, UTC+6). Empty means no limit."""
    value = text(value, 25)
    if not value:
        return None
    try:
        if "T" in value or " " in value:
            dt = datetime.datetime.fromisoformat(value.replace(" ", "T"))
        else:
            d = datetime.date.fromisoformat(value)
            dt = datetime.datetime(d.year, d.month, d.day, 23, 59, 59) if end_of_day \
                else datetime.datetime(d.year, d.month, d.day, 0, 0, 0)
    except Exception:
        raise ApiError("Dates must look like 2026-12-31 or 2026-12-31T18:30")
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=datetime.timezone(datetime.timedelta(hours=6)))
    return dt


def to_int(v, default=None, lo=None, hi=None):
    if v in (None, ""):
        return default
    try:
        n = int(float(v))
    except Exception:
        raise ApiError("Please enter a whole number")
    if lo is not None and n < lo:
        raise ApiError(f"Number must be at least {lo}")
    if hi is not None and n > hi:
        raise ApiError(f"Number must be at most {hi}")
    return n


def to_money(v, default=None):
    if v in (None, ""):
        return default
    try:
        n = q2(v)
    except Exception:
        raise ApiError("Please enter a valid amount")
    if n < 0:
        raise ApiError("Amount cannot be negative")
    return n


def color_ok(v):
    v = text(v, 9)
    return v if re.match(r"^#[0-9a-fA-F]{6}$", v or "") else "#00e5c2"


def is_live(o, now=None):
    now = now or now_utc()
    if not o["active"]:
        return False
    if o["starts_at"] and o["starts_at"] > now:
        return False
    if o["ends_at"] and o["ends_at"] < now:
        return False
    if o["total_limit"] is not None and o["claimed_count"] >= o["total_limit"]:
        return False
    return True


def optional_user():
    try:
        return _H["get_user"]()
    except Exception:
        return None


def need_user():
    u = _H["get_user"]()
    if not u:
        raise ApiError("Please log in to join this offer", 401)
    return u


def owner_scope(seller_id):
    """Who owns an offer: admin offers have seller_id NULL."""
    return seller_id if seller_id else None


# ---------------------------------------------------------------------
# flash sale pricing (used by app.py get_products / create_order)
# ---------------------------------------------------------------------
def flash_map(cur, product_ids=None):
    """
    {product_id: {"offer_id", "percent", "remaining"|None, "ends_at"}} for flash sales that are live now.
    Works with a plain or a dict cursor.
    """
    d = cur.connection.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    sql = """SELECT op.product_id, op.offer_id, op.discount_percent, op.qty_limit, op.sold, o.ends_at, o.title
             FROM offer_products op JOIN offers o ON o.id = op.offer_id
             WHERE o.kind='flash_sale' AND o.active
               AND (o.starts_at IS NULL OR o.starts_at <= NOW())
               AND (o.ends_at IS NULL OR o.ends_at >= NOW())"""
    args = []
    if product_ids:
        sql += " AND op.product_id = ANY(%s)"
        args.append(list(product_ids))
    sql += " ORDER BY op.discount_percent ASC"      # the biggest discount wins when two sales overlap
    d.execute(sql, args)
    out = {}
    for r in d.fetchall():
        remaining = None if r["qty_limit"] is None else max(0, r["qty_limit"] - r["sold"])
        if remaining == 0:
            continue
        out[r["product_id"]] = {"offer_id": r["offer_id"], "percent": float(r["discount_percent"]),
                                "remaining": remaining, "ends_at": r["ends_at"], "title": r["title"]}
    d.close()
    return out


def sale_price(base, percent):
    return float((Decimal(str(base)) * (Decimal("100") - Decimal(str(percent))) / 100).quantize(
        Decimal("0.01"), rounding=ROUND_HALF_UP))


def flash_consume(cur, offer_id, product_id, qty):
    """Count sold units against the sale's limit (call inside the order transaction)."""
    cur.execute("UPDATE offer_products SET sold = sold + %s WHERE offer_id=%s AND product_id=%s",
                (qty, offer_id, product_id))


# ---------------------------------------------------------------------
# serialising
# ---------------------------------------------------------------------
def offer_row_public(o, prizes=None, products=None, claim=None):
    cfg = o["config"] if isinstance(o["config"], dict) else json.loads(o["config"] or "{}")
    out = {
        "id": o["id"], "kind": o["kind"], "kind_label": KINDS.get(o["kind"], {}).get("label", o["kind"]),
        "title": o["title"], "subtitle": o["subtitle"], "description": o["description"],
        "image_url": o["image_url"], "color": o["color"], "cta_label": o["cta_label"],
        "starts_at": o["starts_at"], "ends_at": o["ends_at"], "show_banner": o["show_banner"],
        "store_name": o.get("store_name") or "", "seller_id": o["seller_id"],
        "left": None if o["total_limit"] is None else max(0, o["total_limit"] - o["claimed_count"]),
        "mine": claim,
    }
    if o["kind"] == "quiz":      # never leak the answer
        out["question"] = cfg.get("question", "")
        out["options"] = cfg.get("options", [])
    if o["kind"] == "spend_save":
        out["min_order"] = cfg.get("min_order")
    if o["kind"] == "mystery_box":
        out["delay_min"], out["delay_max"] = cfg.get("delay_min", 8), cfg.get("delay_max", 25)
    if o["kind"] == "free_shipping":
        out["min_order"] = cfg.get("min_order")
    if prizes is not None:
        out["prizes"] = [{"id": p["id"], "label": p["label"], "prize_type": p["prize_type"]}
                         for p in prizes]       # weights stay private
    if products is not None:
        out["products"] = products
    return out


def offer_row_admin(o, prizes=None, products=None):
    cfg = o["config"] if isinstance(o["config"], dict) else json.loads(o["config"] or "{}")
    out = dict(o)
    out["config"] = cfg
    out["kind_label"] = KINDS.get(o["kind"], {}).get("label", o["kind"])
    if prizes is not None:
        out["prizes"] = prizes
    if products is not None:
        out["products"] = products
    return out


# ---------------------------------------------------------------------
# validation shared by admin and seller routes
# ---------------------------------------------------------------------
def clean_offer(d, seller_id):
    kind = text(d.get("kind"), 20)
    allowed = SELLER_KINDS if seller_id else tuple(KINDS)
    if kind not in KINDS or kind not in allowed:
        raise ApiError("This offer type is not available")
    title = text(d.get("title"), 80)
    if len(title) < 3:
        raise ApiError("Please enter an offer title (at least 3 letters)")
    starts, ends = parse_dt(d.get("starts_at")), parse_dt(d.get("ends_at"), end_of_day=True)
    if starts and ends and ends <= starts:
        raise ApiError("The end time must be after the start time")
    image = text(d.get("image_url"), 600)
    if image and not re.match(r"^https?://", image, re.I):
        raise ApiError("Image link must start with http:// or https://")

    cfg_in = d.get("config") if isinstance(d.get("config"), dict) else {}
    cfg = {}
    if kind == "quiz":
        opts = [text(o, 120) for o in (cfg_in.get("options") or []) if text(o, 120)]
        q = text(cfg_in.get("question"), 300)
        if not q or len(opts) < 2 or len(opts) > 6:
            raise ApiError("A quiz needs a question and 2 to 6 answer options")
        ans = to_int(cfg_in.get("answer_index"), None, 0, len(opts) - 1)
        if ans is None:
            raise ApiError("Choose the correct answer")
        cfg = {"question": q, "options": opts, "answer_index": ans,
               "wrong_message": text(cfg_in.get("wrong_message"), 160) or "Not this time. Try the next quiz!"}
    elif kind in ("spend_save", "free_gift"):
        cfg = {"min_order": float(to_money(cfg_in.get("min_order"), Decimal("0")))}
    elif kind == "welcome":
        cfg = {}
    elif kind == "mystery_box":
        cfg = {"delay_min": to_int(cfg_in.get("delay_min"), 8, 3, 600),
               "delay_max": to_int(cfg_in.get("delay_max"), 25, 3, 900)}
        if cfg["delay_max"] < cfg["delay_min"]:
            cfg["delay_max"] = cfg["delay_min"]
    elif kind == "free_shipping":
        cfg = {"min_order": float(to_money(cfg_in.get("min_order"), Decimal("0"))),
               "valid_days": to_int(cfg_in.get("valid_days"), 3, 1, 90)}

    return {
        "kind": kind, "title": title, "subtitle": text(d.get("subtitle"), 120),
        "description": text(d.get("description"), 600), "image_url": image,
        "color": color_ok(d.get("color")), "cta_label": text(d.get("cta_label"), 24),
        "starts_at": starts, "ends_at": ends, "active": bool(d.get("active", True)),
        "show_banner": bool(d.get("show_banner", True)),
        "per_user_limit": to_int(d.get("per_user_limit"), 1, 1, 50) or 1,
        "total_limit": to_int(d.get("total_limit"), None, 1, 10000000),
        "config": cfg,
    }


def clean_prizes(items, seller_id, kind):
    if not KINDS[kind]["prizes"]:
        return []
    out = []
    for p in (items or [])[:30]:
        ptype = text(p.get("prize_type"), 20)
        if ptype not in PRIZE_TYPES:
            raise ApiError("Unknown prize type")
        if seller_id and ptype == "free_shipping":
            raise ApiError("Free shipping prizes are only available to Zento (admin) offers")
        label = text(p.get("label"), 60)
        value = to_money(p.get("value"), Decimal("0"))
        if ptype == "percent" and not (0 < value <= 100):
            raise ApiError("Percent prizes must be between 1 and 100")
        if ptype == "fixed" and value <= 0:
            raise ApiError("Amount prizes must be more than 0")
        pid = to_int(p.get("product_id"), None, 1)
        if ptype == "free_product" and not pid:
            raise ApiError("Pick the product for a free product prize")
        if not label:
            label = {"percent": f"{value:.0f}% OFF", "fixed": f"৳{value:.0f} OFF", "free_product": "Free product",
                     "free_shipping": "Free delivery", "nothing": "Better luck next time"}[ptype]
        out.append({
            "label": label, "prize_type": ptype, "value": value,
            "max_discount": to_money(p.get("max_discount")), "min_order": to_money(p.get("min_order"), Decimal("0")),
            "product_id": pid if ptype == "free_product" else None,
            "weight": to_int(p.get("weight"), 10, 0, 100000),
            "stock": to_int(p.get("stock"), None, 0), "valid_days": to_int(p.get("valid_days"), 7, 1, 365),
        })
    if KINDS[kind]["prizes"] and not out and kind not in ("lucky_draw",):
        raise ApiError("Add at least one prize")
    if kind in ("mystery_box", "spin_wheel", "scratch_card") and sum(p["weight"] for p in out) <= 0:
        raise ApiError("At least one prize needs a chance above 0")
    return out


def clean_sale_products(cur, items, seller_id):
    out = []
    for it in (items or [])[:200]:
        pid = to_int(it.get("product_id"), None, 1)
        if not pid:
            continue
        cur.execute("SELECT id, seller_id FROM products WHERE id=%s", (pid,))
        row = cur.fetchone()
        if not row:
            raise ApiError("One of the chosen products no longer exists")
        if (row["seller_id"] or None) != (seller_id or None):
            raise ApiError("A sale can only include your own products"
                           if seller_id else "A Zento sale can only include Zento's own products. Sellers run sales on theirs.")
        pct = to_money(it.get("discount_percent"), Decimal("10"))
        if not (0 < pct < 100):
            raise ApiError("Sale discount must be between 1 and 99 percent")
        out.append((pid, pct, to_int(it.get("qty_limit"), None, 1)))
    return out


def save_offer(cur, d, seller_id, offer_id=None):
    o = clean_offer(d, seller_id)
    prizes = clean_prizes(d.get("prizes"), seller_id, o["kind"])
    sale_items = clean_sale_products(cur, d.get("products"), seller_id) if o["kind"] == "flash_sale" else []
    if o["kind"] == "flash_sale" and not sale_items:
        raise ApiError("Pick at least one product for the flash sale")
    if o["kind"] == "free_shipping" and seller_id:
        raise ApiError("This offer type is not available")
    # free product prizes must be a product the owner is allowed to give away
    for p in prizes:
        if p["product_id"]:
            cur.execute("SELECT seller_id FROM products WHERE id=%s", (p["product_id"],))
            row = cur.fetchone()
            if not row:
                raise ApiError("A free product prize points to a product that does not exist")
            if (row["seller_id"] or None) != (seller_id or None):
                raise ApiError("You can only give away your own products" if seller_id
                               else "Zento can only give away its own products")

    cols = (o["kind"], o["title"], o["subtitle"], o["description"], o["image_url"], o["color"], o["cta_label"],
            o["starts_at"], o["ends_at"], o["active"], o["show_banner"], o["per_user_limit"],
            o["total_limit"], json.dumps(o["config"]))
    if offer_id is None:
        cur.execute("""INSERT INTO offers (kind,title,subtitle,description,image_url,color,cta_label,starts_at,ends_at,
                       active,show_banner,per_user_limit,total_limit,config,seller_id)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb,%s) RETURNING id""",
                    cols + (seller_id,))
        offer_id = cur.fetchone()["id"]
    else:
        cur.execute("""UPDATE offers SET kind=%s,title=%s,subtitle=%s,description=%s,image_url=%s,color=%s,cta_label=%s,
                       starts_at=%s,ends_at=%s,active=%s,show_banner=%s,per_user_limit=%s,total_limit=%s,config=%s::jsonb
                       WHERE id=%s""", cols + (offer_id,))
        # keep given_count of prizes that still exist (matched by id)
    if KINDS[o["kind"]]["prizes"] or o["kind"] == "flash_sale":
        keep_ids = [to_int(p.get("id"), None) for p in (d.get("prizes") or [])]
        cur.execute("DELETE FROM offer_prizes WHERE offer_id=%s AND NOT (id = ANY(%s))",
                    (offer_id, [i for i in keep_ids if i]))
        for i, p in enumerate(prizes):
            pid = to_int((d.get("prizes") or [])[i].get("id"), None)
            args = (p["label"], p["prize_type"], p["value"], p["max_discount"], p["min_order"], p["product_id"],
                    p["weight"], p["stock"], p["valid_days"], i)
            if pid:
                cur.execute("""UPDATE offer_prizes SET label=%s,prize_type=%s,value=%s,max_discount=%s,min_order=%s,
                               product_id=%s,weight=%s,stock=%s,valid_days=%s,sort_order=%s
                               WHERE id=%s AND offer_id=%s""", args + (pid, offer_id))
            else:
                cur.execute("""INSERT INTO offer_prizes (label,prize_type,value,max_discount,min_order,product_id,weight,
                               stock,valid_days,sort_order,offer_id) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                            args + (offer_id,))
    if o["kind"] == "flash_sale":
        cur.execute("DELETE FROM offer_products WHERE offer_id=%s AND NOT (product_id = ANY(%s))",
                    (offer_id, [pid for pid, _, _ in sale_items]))
        for pid, pct, lim in sale_items:
            cur.execute("""INSERT INTO offer_products (offer_id, product_id, discount_percent, qty_limit)
                           VALUES (%s,%s,%s,%s)
                           ON CONFLICT (offer_id, product_id)
                           DO UPDATE SET discount_percent=EXCLUDED.discount_percent, qty_limit=EXCLUDED.qty_limit""",
                        (offer_id, pid, pct, lim))
    return offer_id


def load_children(cur, offer_ids):
    prizes, products = {}, {}
    if not offer_ids:
        return prizes, products
    cur.execute("SELECT * FROM offer_prizes WHERE offer_id = ANY(%s) ORDER BY sort_order, id", (offer_ids,))
    for r in cur.fetchall():
        prizes.setdefault(r["offer_id"], []).append(r)
    cur.execute("""SELECT op.*, p.name, p.price, p.image_url FROM offer_products op
                   JOIN products p ON p.id = op.product_id WHERE op.offer_id = ANY(%s) ORDER BY op.id""", (offer_ids,))
    for r in cur.fetchall():
        products.setdefault(r["offer_id"], []).append(r)
    return prizes, products


# ---------------------------------------------------------------------
# prize engine: pick a prize and turn it into a personal coupon
# ---------------------------------------------------------------------
def pick_prize(prizes):
    pool = [p for p in prizes if p["weight"] > 0 and (p["stock"] is None or p["given_count"] < p["stock"])]
    if not pool:
        return None
    total = sum(p["weight"] for p in pool)
    roll = random.SystemRandom().uniform(0, total)
    run = 0
    for p in pool:
        run += p["weight"]
        if roll <= run:
            return p
    return pool[-1]


def new_code(cur, prefix="ZN"):
    for _ in range(8):
        code = f"{prefix}-{secrets.token_hex(3).upper()}"
        cur.execute("SELECT 1 FROM coupons WHERE code=%s", (code,))
        if not cur.fetchone():
            return code
    raise ApiError("Could not create your reward. Please try again.", 500)


def issue_coupon(cur, offer, prize, user_id, label=None):
    """Create the personal coupon for a prize. Returns {code, label, expires_at, ...}."""
    ptype = prize["prize_type"]
    if ptype == "nothing":
        return None
    code = new_code(cur)
    days = prize["valid_days"] or 7
    expires = now_utc() + datetime.timedelta(days=days)
    dtype, value, maxd, minorder, prod, free_ship = "percent", prize["value"], prize["max_discount"], prize["min_order"] or 0, None, False
    if ptype == "fixed":
        dtype = "fixed"
    elif ptype == "free_product":
        cur.execute("SELECT price FROM products WHERE id=%s", (prize["product_id"],))
        row = cur.fetchone()
        if not row:
            raise ApiError("This prize is no longer available")
        dtype, value, maxd, prod = "percent", Decimal("100"), q2(row["price"]), prize["product_id"]
    elif ptype == "free_shipping":
        dtype, value, free_ship = "fixed", Decimal("0.01"), True   # value only keeps the DB rule happy
    cur.execute("""INSERT INTO coupons (code, seller_id, discount_type, value, max_discount, min_order, usage_limit,
                   per_user_limit, expires_at, active, user_id, product_id, free_shipping, offer_id, label)
                   VALUES (%s,%s,%s,%s,%s,%s,1,1,%s,TRUE,%s,%s,%s,%s,%s) RETURNING id""",
                (code, offer["seller_id"], dtype, value, maxd, minorder, expires, user_id, prod, free_ship,
                 offer["id"], label or prize["label"]))
    return {"code": code, "label": label or prize["label"], "expires_at": expires,
            "prize_type": ptype, "min_order": float(minorder)}


def claim_count(cur, offer_id, user_id):
    cur.execute("SELECT COUNT(*) AS n FROM offer_claims WHERE offer_id=%s AND user_id=%s", (offer_id, user_id))
    return cur.fetchone()["n"]


def lock_live_offer(cur, offer_id, kinds=None):
    cur.execute("""SELECT o.*, s.store_name, s.status AS seller_status FROM offers o
                   LEFT JOIN sellers s ON s.id = o.seller_id WHERE o.id=%s FOR UPDATE OF o""", (offer_id,))
    o = cur.fetchone()
    if not o or (o["seller_id"] and o["seller_status"] != "approved"):
        raise ApiError("This offer is not available", 404)
    if kinds and o["kind"] not in kinds:
        raise ApiError("This offer cannot be opened this way", 400)
    if not is_live(o):
        raise ApiError("This offer has ended or is not active", 410)
    return o


def lock_prizes(cur, offer_id):
    cur.execute("SELECT * FROM offer_prizes WHERE offer_id=%s ORDER BY sort_order, id FOR UPDATE", (offer_id,))
    return cur.fetchall()


def user_has_orders(cur, user_id):
    cur.execute("SELECT 1 FROM orders WHERE user_id=%s LIMIT 1", (user_id,))
    return bool(cur.fetchone())


def do_claim(cur, offer, user_id, answer=None):
    """Core claim logic for every claimable kind. Returns the reply dict."""
    kind = offer["kind"]
    cfg = offer["config"] if isinstance(offer["config"], dict) else json.loads(offer["config"] or "{}")
    if claim_count(cur, offer["id"], user_id) >= offer["per_user_limit"]:
        raise ApiError("You have already joined this offer", 409)
    if kind == "welcome" and user_has_orders(cur, user_id):
        raise ApiError("This gift is only for customers who have not ordered yet", 403)

    prizes = lock_prizes(cur, offer["id"])
    correct = None

    if kind == "quiz":
        opts = cfg.get("options", [])
        ai = to_int(answer, None, 0, max(0, len(opts) - 1))
        if ai is None:
            raise ApiError("Choose an answer first")
        correct = ai == cfg.get("answer_index")
        if not correct:
            cur.execute("""INSERT INTO offer_claims (offer_id,user_id,correct,prize_label)
                           VALUES (%s,%s,FALSE,'Wrong answer')""", (offer["id"], user_id))
            return {"won": False, "correct": False, "message": cfg.get("wrong_message") or "Not this time!",
                    "right_answer": opts[cfg["answer_index"]] if opts else ""}

    if kind == "lucky_draw":
        cur.execute("""INSERT INTO offer_claims (offer_id,user_id,prize_label) VALUES (%s,%s,'Lucky draw entry')""",
                    (offer["id"], user_id))
        cur.execute("UPDATE offers SET claimed_count = claimed_count + 1 WHERE id=%s", (offer["id"],))
        return {"won": False, "entered": True, "message": "You are in! The winner will be announced soon."}

    if kind == "free_shipping":
        fake = {"prize_type": "free_shipping", "value": Decimal("0"), "max_discount": None,
                "min_order": Decimal(str(cfg.get("min_order") or 0)), "product_id": None,
                "valid_days": cfg.get("valid_days") or 3, "label": "Free delivery"}
        coupon = issue_coupon(cur, offer, fake, user_id)
        prize = None
    else:
        if not prizes:
            raise ApiError("This offer has no prizes yet", 409)
        if kind in ("coupon_drop", "welcome", "spend_save", "free_gift", "quiz"):
            prize = pick_prize(prizes[:1] if kind != "quiz" else prizes) or None
            if kind in ("coupon_drop", "welcome", "spend_save", "free_gift") and prize is None:
                raise ApiError("Sorry, this reward has run out", 410)
        else:
            prize = pick_prize(prizes)
        if prize is None:
            cur.execute("""INSERT INTO offer_claims (offer_id,user_id,correct,prize_label) VALUES (%s,%s,%s,'Sold out')""",
                        (offer["id"], user_id, correct))
            return {"won": False, "message": "All prizes are gone. Thanks for playing!"}
        if kind == "spend_save":
            prize = dict(prize)
            prize["min_order"] = Decimal(str(cfg.get("min_order") or prize["min_order"] or 0))
        coupon = issue_coupon(cur, offer, prize, user_id)
        cur.execute("UPDATE offer_prizes SET given_count = given_count + 1 WHERE id=%s", (prize["id"],))

    cur.execute("""INSERT INTO offer_claims (offer_id,user_id,prize_id,prize_label,coupon_code,correct,is_winner)
                   VALUES (%s,%s,%s,%s,%s,%s,%s)""",
                (offer["id"], user_id, prize["id"] if prize else None,
                 (coupon or {}).get("label") or (prize["label"] if prize else "Try again"),
                 (coupon or {}).get("code", ""), correct, bool(coupon)))
    cur.execute("UPDATE offers SET claimed_count = claimed_count + 1 WHERE id=%s", (offer["id"],))

    if coupon is None:
        return {"won": False, "correct": correct, "message": prize["label"] if prize else "Better luck next time!",
                "prize": {"label": prize["label"] if prize else "", "prize_type": "nothing"}}
    return {"won": True, "correct": correct, "prize": coupon,
            "message": f"You won {coupon['label']}!"}


# ---------------------------------------------------------------------
# PUBLIC routes
# ---------------------------------------------------------------------
@bp.route("/api/offers", methods=["GET"])
@api
def public_offers():
    _ready()
    u = optional_user()
    with db() as (conn, cur):
        cur.execute("""SELECT o.*, s.store_name FROM offers o LEFT JOIN sellers s ON s.id = o.seller_id
                       WHERE o.active AND (o.seller_id IS NULL OR s.status='approved')
                         AND (o.starts_at IS NULL OR o.starts_at <= NOW())
                         AND (o.ends_at IS NULL OR o.ends_at >= NOW())
                       ORDER BY o.id DESC LIMIT 60""")
        offers = [o for o in cur.fetchall() if is_live(o)]
        ids = [o["id"] for o in offers]
        prizes, products = load_children(cur, ids)
        mine = {}
        if u and ids:
            cur.execute("""SELECT offer_id, COUNT(*) AS n FROM offer_claims WHERE user_id=%s AND offer_id = ANY(%s)
                           GROUP BY offer_id""", (u["user_id"], ids))
            mine = {r["offer_id"]: r["n"] for r in cur.fetchall()}
        out = []
        for o in offers:
            claimed = mine.get(o["id"], 0)
            pp = prizes.get(o["id"]) if KINDS.get(o["kind"], {}).get("prizes") else None
            prod = None
            if o["kind"] == "flash_sale":
                prod = [{"product_id": r["product_id"], "name": r["name"], "price": r["price"],
                         "percent": r["discount_percent"], "sale_price": sale_price(r["price"], r["discount_percent"]),
                         "image_url": r["image_url"],
                         "left": None if r["qty_limit"] is None else max(0, r["qty_limit"] - r["sold"])}
                        for r in products.get(o["id"], [])]
            row = offer_row_public(o, pp, prod, claimed)
            row["done"] = claimed >= o["per_user_limit"] and KINDS.get(o["kind"], {}).get("limit", 0) > 0
            out.append(row)
        return ok(offers=out, now=now_utc(), logged_in=bool(u))


@bp.route("/api/offers/<int:oid>/claim", methods=["POST"])
@api
def claim_offer(oid):
    _ready()
    u = need_user()
    d = request.get_json(silent=True) or {}
    with db() as (conn, cur):
        o = lock_live_offer(cur, oid)
        if o["kind"] in ("flash_sale", "event"):
            raise ApiError("Nothing to claim here. Just shop the sale!", 400)
        result = do_claim(cur, o, u["user_id"], d.get("answer"))
        return ok(**result)


@bp.route("/api/offers/my-rewards", methods=["GET"])
@api
def my_rewards():
    _ready()
    u = need_user()
    with db() as (conn, cur):
        cur.execute("""SELECT c.code, c.label, c.discount_type, c.value, c.max_discount, c.min_order, c.expires_at,
                              c.free_shipping, c.product_id, c.used_count, c.usage_limit, c.active, c.created_at,
                              p.name AS product_name, s.store_name
                       FROM coupons c LEFT JOIN products p ON p.id = c.product_id
                       LEFT JOIN sellers s ON s.id = c.seller_id
                       WHERE c.user_id=%s AND c.active ORDER BY c.id DESC LIMIT 50""", (u["user_id"],))
        rows = []
        for r in cur.fetchall():
            used = r["usage_limit"] is not None and r["used_count"] >= r["usage_limit"]
            expired = bool(r["expires_at"] and r["expires_at"] < now_utc())
            r["status"] = "used" if used else "expired" if expired else "ready"
            rows.append(r)
        return ok(rewards=rows)


# ---------------------------------------------------------------------
# ADMIN routes (admin sees all offers, seller offers are read-only for admin except on/off and delete)
# ---------------------------------------------------------------------
def audit(cur, admin, action, detail):
    _mpmod.audit(cur, admin, action, "offer", None, detail)


def offer_stats(cur, offer_ids):
    if not offer_ids:
        return {}
    cur.execute("""SELECT offer_id, COUNT(*) AS plays, COUNT(*) FILTER (WHERE is_winner) AS wins,
                          COUNT(*) FILTER (WHERE correct IS TRUE) AS correct_n
                   FROM offer_claims WHERE offer_id = ANY(%s) GROUP BY offer_id""", (offer_ids,))
    st = {r["offer_id"]: r for r in cur.fetchall()}
    cur.execute("""SELECT c.offer_id, COUNT(*) FILTER (WHERE c.used_count > 0) AS redeemed,
                          COALESCE(SUM(oi_sum.disc), 0) AS discount_given
                   FROM coupons c
                   LEFT JOIN (SELECT coupon_id, SUM(discount_amount) AS disc FROM order_items GROUP BY coupon_id) oi_sum
                          ON oi_sum.coupon_id = c.id
                   WHERE c.offer_id = ANY(%s) GROUP BY c.offer_id""", (offer_ids,))
    for r in cur.fetchall():
        st.setdefault(r["offer_id"], {}).update(redeemed=r["redeemed"], discount_given=r["discount_given"])
    return st


@bp.route("/api/admin/offers", methods=["GET"])
@api
def admin_list_offers():
    _ready()
    _mpmod.admin_required()
    with db() as (conn, cur):
        cur.execute("""SELECT o.*, s.store_name FROM offers o LEFT JOIN sellers s ON s.id=o.seller_id
                       ORDER BY o.id DESC LIMIT 300""")
        offers = cur.fetchall()
        ids = [o["id"] for o in offers]
        prizes, products = load_children(cur, ids)
        stats = offer_stats(cur, ids)
        out = []
        for o in offers:
            row = offer_row_admin(o, prizes.get(o["id"], []), products.get(o["id"], []))
            row["stats"] = stats.get(o["id"], {})
            row["live"] = is_live(o)
            out.append(row)
        return ok(offers=out, kinds={k: v["label"] for k, v in KINDS.items()})


@bp.route("/api/admin/offers", methods=["POST"])
@api
def admin_create_offer():
    _ready()
    a = _mpmod.admin_required()
    d = request.get_json(silent=True) or {}
    with db() as (conn, cur):
        oid = save_offer(cur, d, None)
        audit(cur, a, "offer_created", f"offer #{oid} {d.get('title')}")
        return ok(message="Offer created", id=oid)


@bp.route("/api/admin/offers/<int:oid>", methods=["PUT"])
@api
def admin_update_offer(oid):
    _ready()
    a = _mpmod.admin_required()
    d = request.get_json(silent=True) or {}
    with db() as (conn, cur):
        cur.execute("SELECT id, seller_id, kind FROM offers WHERE id=%s FOR UPDATE", (oid,))
        o = cur.fetchone()
        if not o:
            raise ApiError("Offer not found", 404)
        if set(d.keys()) <= {"active"}:                # quick on / off works for every offer
            cur.execute("UPDATE offers SET active=%s WHERE id=%s", (bool(d.get("active")), oid))
            return ok(message="Offer turned on" if d.get("active") else "Offer turned off")
        if o["seller_id"]:
            raise ApiError("This offer belongs to a seller. You can turn it off or delete it.", 403)
        d["kind"] = d.get("kind") or o["kind"]
        save_offer(cur, d, None, oid)
        audit(cur, a, "offer_updated", f"offer #{oid}")
        return ok(message="Offer saved")


@bp.route("/api/admin/offers/<int:oid>", methods=["DELETE"])
@api
def admin_delete_offer(oid):
    _ready()
    a = _mpmod.admin_required()
    with db() as (conn, cur):
        cur.execute("SELECT id, claimed_count FROM offers WHERE id=%s FOR UPDATE", (oid,))
        o = cur.fetchone()
        if not o:
            raise ApiError("Offer not found", 404)
        if o["claimed_count"]:
            cur.execute("UPDATE offers SET active=FALSE WHERE id=%s", (oid,))
            return ok(message="This offer already has players, so it was switched off instead of deleted.")
        cur.execute("DELETE FROM offers WHERE id=%s", (oid,))
        audit(cur, a, "offer_deleted", f"offer #{oid}")
        return ok(message="Offer deleted")


@bp.route("/api/admin/offers/<int:oid>/entries", methods=["GET"])
@api
def admin_offer_entries(oid):
    _ready()
    _mpmod.admin_required()
    with db() as (conn, cur):
        cur.execute("""SELECT oc.id, oc.user_id, oc.prize_label, oc.coupon_code, oc.correct, oc.is_winner, oc.created_at,
                              u.name, u.email
                       FROM offer_claims oc LEFT JOIN users u ON u.id = oc.user_id
                       WHERE oc.offer_id=%s ORDER BY oc.id DESC LIMIT 200""", (oid,))
        return ok(entries=cur.fetchall())


@bp.route("/api/admin/offers/<int:oid>/draw", methods=["POST"])
@api
def admin_draw_winner(oid):
    """Lucky draw: pick a random entrant and give them the offer's first prize as a coupon."""
    _ready()
    a = _mpmod.admin_required()
    with db() as (conn, cur):
        cur.execute("""SELECT o.*, s.store_name FROM offers o LEFT JOIN sellers s ON s.id=o.seller_id
                       WHERE o.id=%s FOR UPDATE OF o""", (oid,))
        o = cur.fetchone()
        if not o or o["kind"] != "lucky_draw":
            raise ApiError("This is not a lucky draw", 400)
        cur.execute("SELECT 1 FROM offer_claims WHERE offer_id=%s AND is_winner", (oid,))
        if cur.fetchone():
            raise ApiError("A winner was already drawn for this offer", 409)
        cur.execute("""SELECT oc.id, oc.user_id, u.name, u.email FROM offer_claims oc
                       LEFT JOIN users u ON u.id=oc.user_id WHERE oc.offer_id=%s""", (oid,))
        entrants = cur.fetchall()
        if not entrants:
            raise ApiError("Nobody has entered yet", 409)
        win = random.SystemRandom().choice(entrants)
        prizes = lock_prizes(cur, oid)
        if not prizes:
            raise ApiError("Add a prize to this lucky draw first", 409)
        coupon = issue_coupon(cur, o, prizes[0], win["user_id"])
        cur.execute("UPDATE offer_claims SET is_winner=TRUE, prize_label=%s, coupon_code=%s WHERE id=%s",
                    (prizes[0]["label"], (coupon or {}).get("code", ""), win["id"]))
        cur.execute("UPDATE offer_prizes SET given_count = given_count + 1 WHERE id=%s", (prizes[0]["id"],))
        audit(cur, a, "offer_draw", f"offer #{oid} winner user {win['user_id']}")
        return ok(message=f"Winner: {win['name'] or win['email']}. Their reward is in their account.",
                  winner={"name": win["name"], "email": win["email"]})


# ---------------------------------------------------------------------
# SELLER routes (a seller only ever touches their own offers)
# ---------------------------------------------------------------------
@bp.route("/api/seller/offers", methods=["GET"])
@api
def seller_list_offers():
    _ready()
    with db() as (conn, cur):
        u, s = _mpmod.seller_required(cur)
        cur.execute("SELECT * FROM offers WHERE seller_id=%s ORDER BY id DESC", (s["id"],))
        offers = cur.fetchall()
        ids = [o["id"] for o in offers]
        prizes, products = load_children(cur, ids)
        stats = offer_stats(cur, ids)
        out = []
        for o in offers:
            row = offer_row_admin(o, prizes.get(o["id"], []), products.get(o["id"], []))
            row["stats"] = stats.get(o["id"], {})
            row["live"] = is_live(o)
            out.append(row)
        return ok(offers=out, kinds={k: KINDS[k]["label"] for k in SELLER_KINDS})


@bp.route("/api/seller/offers", methods=["POST"])
@api
def seller_create_offer():
    _ready()
    d = request.get_json(silent=True) or {}
    with db() as (conn, cur):
        u, s = _mpmod.seller_required(cur)
        oid = save_offer(cur, d, s["id"])
        return ok(message="Offer created", id=oid)


@bp.route("/api/seller/offers/<int:oid>", methods=["PUT"])
@api
def seller_update_offer(oid):
    _ready()
    d = request.get_json(silent=True) or {}
    with db() as (conn, cur):
        u, s = _mpmod.seller_required(cur)
        cur.execute("SELECT id, kind FROM offers WHERE id=%s AND seller_id=%s FOR UPDATE", (oid, s["id"]))
        o = cur.fetchone()
        if not o:
            raise ApiError("Offer not found", 404)
        if set(d.keys()) <= {"active"}:
            cur.execute("UPDATE offers SET active=%s WHERE id=%s", (bool(d.get("active")), oid))
            return ok(message="Offer turned on" if d.get("active") else "Offer turned off")
        d["kind"] = d.get("kind") or o["kind"]
        save_offer(cur, d, s["id"], oid)
        return ok(message="Offer saved")


@bp.route("/api/seller/offers/<int:oid>", methods=["DELETE"])
@api
def seller_delete_offer(oid):
    _ready()
    with db() as (conn, cur):
        u, s = _mpmod.seller_required(cur)
        cur.execute("SELECT id, claimed_count FROM offers WHERE id=%s AND seller_id=%s FOR UPDATE", (oid, s["id"]))
        o = cur.fetchone()
        if not o:
            raise ApiError("Offer not found", 404)
        if o["claimed_count"]:
            cur.execute("UPDATE offers SET active=FALSE WHERE id=%s", (oid,))
            return ok(message="This offer already has players, so it was switched off instead of deleted.")
        cur.execute("DELETE FROM offers WHERE id=%s", (oid,))
        return ok(message="Offer deleted")


# ---------------------------------------------------------------------
def init_offers(app, get_user, admin_user, ensure_base=None):
    _H.update(get_user=get_user, admin_user=admin_user)
    _mpmod.FLASH_HOOK = flash_map          # lets marketplace.py price coupons on flash sale prices
    try:
        ensure_tables()
        log.info("Offer tables ready")
    except Exception:
        log.exception("Offer table setup failed (will retry on first request)")
    app.register_blueprint(bp)
