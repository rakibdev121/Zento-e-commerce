import os
import psycopg2
from flask_cors import CORS
from flask import Flask, send_from_directory, redirect
from dotenv import load_dotenv

load_dotenv()

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

app = Flask(__name__)
CORS(app)

@app.route("/")
def home():
    return send_from_directory(BASE_DIR, "index.html")

@app.route("/admin")
def admin_redirect():
    return redirect("/admin/")

@app.route("/admin/")
def admin_home():
    return send_from_directory(os.path.join(BASE_DIR, "admin"), "index.html")

@app.route("/admin/<path:filename>")
def admin_files(filename):
    return send_from_directory(os.path.join(BASE_DIR, "admin"), filename)

@app.route("/<path:filename>")
def frontend_files(filename):
    if filename.startswith("api/"):
        return {"status": "error", "message": "Not found"}, 404

    file_path = os.path.join(BASE_DIR, filename)

    if os.path.isfile(file_path):
        return send_from_directory(BASE_DIR, filename)

    return send_from_directory(BASE_DIR, "index.html")

@app.route("/api/db-test")
def db_test():
    try:
        conn = psycopg2.connect(os.environ["DATABASE_URL"])
        cursor = conn.cursor()
        cursor.execute("SELECT NOW()")
        result = cursor.fetchone()
        cursor.close()
        conn.close()

        return {
            "status": "success",
            "database": "connected",
            "time": str(result[0])
        }

    except Exception as e:
        return {
            "status": "error",
            "message": str(e)
        }, 500

@app.route("/api/setup-products")
def setup_products():
    try:
        conn = psycopg2.connect(os.environ["DATABASE_URL"])
        cursor = conn.cursor()

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS products (
                id BIGSERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT,
                price NUMERIC(10,2) NOT NULL,
                image_url TEXT,
                category TEXT,
                stock INTEGER DEFAULT 0,
                created_at TIMESTAMPTZ DEFAULT NOW()
            )
        """)

        conn.commit()
        cursor.close()
        conn.close()

        return {
            "status": "success",
            "message": "Products table created successfully"
        }

    except Exception as e:
        return {
            "status": "error",
            "message": str(e)
        }, 500


@app.route("/api/products", methods=["GET"])
def get_products():
    try:
        conn = psycopg2.connect(os.environ["DATABASE_URL"])
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, name, description, price, image_url, category, stock, created_at
            FROM products
            ORDER BY id DESC
        """)
        rows = cursor.fetchall()
        cursor.close()
        conn.close()

        products = [
            {
                "id": row[0],
                "name": row[1],
                "description": row[2],
                "price": float(row[3]),
                "image_url": row[4],
                "category": row[5],
                "stock": row[6],
                "created_at": str(row[7])
            }
            for row in rows
        ]

        return {"status": "success", "products": products}

    except Exception as e:
        return {"status": "error", "message": str(e)}, 500


@app.route("/api/products", methods=["POST"])
def create_product():
    try:
        data = request.get_json() or {}

        name = data.get("name")
        description = data.get("description")
        price = data.get("price")
        image_url = data.get("image_url")
        category = data.get("category")
        stock = data.get("stock", 0)

        if not name or price is None:
            return {
                "status": "error",
                "message": "Name and price are required"
            }, 400

        conn = psycopg2.connect(os.environ["DATABASE_URL"])
        cursor = conn.cursor()

        cursor.execute("""
            INSERT INTO products
            (name, description, price, image_url, category, stock)
            VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING id, name, description, price, image_url, category, stock, created_at
        """, (name, description, price, image_url, category, stock))

        row = cursor.fetchone()
        conn.commit()
        cursor.close()
        conn.close()

        return {
            "status": "success",
            "message": "Product created successfully",
            "product": {
                "id": row[0],
                "name": row[1],
                "description": row[2],
                "price": float(row[3]),
                "image_url": row[4],
                "category": row[5],
                "stock": row[6],
                "created_at": str(row[7])
            }
        }, 201

    except Exception as e:
        return {"status": "error", "message": str(e)}, 500


@app.route("/api/products/<int:product_id>", methods=["PUT"])
def update_product(product_id):
    try:
        data = request.get_json() or {}

        name = data.get("name")
        description = data.get("description")
        price = data.get("price")
        image_url = data.get("image_url")
        category = data.get("category")
        stock = data.get("stock", 0)

        if not name or price is None:
            return {
                "status": "error",
                "message": "Name and price are required"
            }, 400

        conn = psycopg2.connect(os.environ["DATABASE_URL"])
        cursor = conn.cursor()

        cursor.execute("""
            UPDATE products
            SET name = %s,
                description = %s,
                price = %s,
                image_url = %s,
                category = %s,
                stock = %s
            WHERE id = %s
            RETURNING id, name, description, price, image_url, category, stock, created_at
        """, (name, description, price, image_url, category, stock, product_id))

        row = cursor.fetchone()

        if not row:
            conn.rollback()
            cursor.close()
            conn.close()
            return {
                "status": "error",
                "message": "Product not found"
            }, 404

        conn.commit()
        cursor.close()
        conn.close()

        return {
            "status": "success",
            "message": "Product updated successfully",
            "product": {
                "id": row[0],
                "name": row[1],
                "description": row[2],
                "price": float(row[3]),
                "image_url": row[4],
                "category": row[5],
                "stock": row[6],
                "created_at": str(row[7])
            }
        }

    except Exception as e:
        return {"status": "error", "message": str(e)}, 500


@app.route("/api/products/<int:product_id>", methods=["DELETE"])
def delete_product(product_id):
    try:
        conn = psycopg2.connect(os.environ["DATABASE_URL"])
        cursor = conn.cursor()

        cursor.execute(
            "DELETE FROM products WHERE id = %s RETURNING id",
            (product_id,)
        )

        deleted = cursor.fetchone()

        if not deleted:
            conn.rollback()
            cursor.close()
            conn.close()
            return {
                "status": "error",
                "message": "Product not found"
            }, 404

        conn.commit()
        cursor.close()
        conn.close()

        return {
            "status": "success",
            "message": "Product deleted successfully"
        }

    except Exception as e:
        return {"status": "error", "message": str(e)}, 500


@app.route("/api/setup-users")
def setup_users():
    try:
        conn = psycopg2.connect(os.environ["DATABASE_URL"])
        cursor = conn.cursor()

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id BIGSERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'user',
                created_at TIMESTAMPTZ DEFAULT NOW()
            )
        """)

        conn.commit()
        cursor.close()
        conn.close()

        return {
            "status": "success",
            "message": "Users table created successfully"
        }

    except Exception as e:
        return {
            "status": "error",
            "message": str(e)
        }, 500

import jwt
from datetime import datetime, timedelta, timezone
from werkzeug.security import generate_password_hash, check_password_hash
from flask import request

JWT_SECRET = os.environ.get("JWT_SECRET", "change-this-secret-in-render")

@app.route("/api/signup", methods=["POST"])
def signup():
    try:
        data = request.get_json() or {}

        name = data.get("name")
        email = data.get("email")
        password = data.get("password")

        if not name or not email or not password:
            return {
                "status": "error",
                "message": "Name, email and password are required"
            }, 400

        if len(password) < 8:
            return {
                "status": "error",
                "message": "Password must be at least 8 characters"
            }, 400

        password_hash = generate_password_hash(password)

        conn = psycopg2.connect(os.environ["DATABASE_URL"])
        cursor = conn.cursor()

        cursor.execute(
            """
            INSERT INTO users (name, email, password_hash)
            VALUES (%s, %s, %s)
            RETURNING id, name, email, role
            """,
            (name, email.lower().strip(), password_hash)
        )

        user = cursor.fetchone()
        conn.commit()

        cursor.close()
        conn.close()

        return {
            "status": "success",
            "message": "Account created successfully",
            "user": {
                "id": user[0],
                "name": user[1],
                "email": user[2],
                "role": user[3]
            }
        }, 201

    except psycopg2.errors.UniqueViolation:
        return {
            "status": "error",
            "message": "Email already exists"
        }, 409

    except Exception as e:
        return {
            "status": "error",
            "message": str(e)
        }, 500


@app.route("/api/login", methods=["POST"])
def login():
    try:
        data = request.get_json() or {}

        email = data.get("email")
        password = data.get("password")

        if not email or not password:
            return {
                "status": "error",
                "message": "Email and password are required"
            }, 400

        conn = psycopg2.connect(os.environ["DATABASE_URL"])
        cursor = conn.cursor()

        cursor.execute(
            """
            SELECT id, name, email, password_hash, role
            FROM users
            WHERE email = %s
            """,
            (email.lower().strip(),)
        )

        user = cursor.fetchone()

        cursor.close()
        conn.close()

        if not user or not check_password_hash(user[3], password):
            return {
                "status": "error",
                "message": "Invalid email or password"
            }, 401

        payload = {
            "user_id": user[0],
            "email": user[2],
            "role": user[4],
            "exp": datetime.now(timezone.utc) + timedelta(days=7)
        }

        token = jwt.encode(payload, JWT_SECRET, algorithm="HS256")

        return {
            "status": "success",
            "message": "Login successful",
            "token": token,
            "user": {
                "id": user[0],
                "name": user[1],
                "email": user[2],
                "role": user[4]
            }
        }

    except Exception as e:
        return {
            "status": "error",
            "message": str(e)
        }, 500

@app.route("/api/create-admin", methods=["POST"])
def create_admin():
    try:
        data = request.get_json() or {}

        name = data.get("name")
        email = data.get("email")
        password = data.get("password")

        if not name or not email or not password:
            return {
                "status": "error",
                "message": "Name, email and password are required"
            }, 400

        if len(password) < 8:
            return {
                "status": "error",
                "message": "Password must be at least 8 characters"
            }, 400

        password_hash = generate_password_hash(password)

        conn = psycopg2.connect(os.environ["DATABASE_URL"])
        cursor = conn.cursor()

        cursor.execute(
            """
            INSERT INTO users (name, email, password_hash, role)
            VALUES (%s, %s, %s, 'admin')
            RETURNING id, name, email, role
            """,
            (name, email.lower().strip(), password_hash)
        )

        admin = cursor.fetchone()
        conn.commit()

        cursor.close()
        conn.close()

        return {
            "status": "success",
            "message": "Admin account created successfully",
            "admin": {
                "id": admin[0],
                "name": admin[1],
                "email": admin[2],
                "role": admin[3]
            }
        }, 201

    except psycopg2.errors.UniqueViolation:
        return {
            "status": "error",
            "message": "Email already exists"
        }, 409

    except Exception as e:
        return {
            "status": "error",
            "message": str(e)
        }, 500

@app.route("/api/delete-admin/<int:user_id>", methods=["DELETE"])
def delete_admin(user_id):
    try:
        conn = psycopg2.connect(os.environ["DATABASE_URL"])
        cursor = conn.cursor()

        cursor.execute(
            "DELETE FROM users WHERE id = %s AND role = 'admin' RETURNING id",
            (user_id,)
        )

        deleted = cursor.fetchone()
        conn.commit()

        cursor.close()
        conn.close()

        if not deleted:
            return {
                "status": "error",
                "message": "Admin not found"
            }, 404

        return {
            "status": "success",
            "message": "Admin deleted successfully"
        }

    except Exception as e:
        return {
            "status": "error",
            "message": str(e)
        }, 500


# =========================================================
# ZENTO_PROFILE_CHECKOUT_V1
# Profile + Checkout + Orders
# =========================================================

def ensure_order_tables():
    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    cursor = conn.cursor()

    cursor.execute("""
        ALTER TABLE users
        ADD COLUMN IF NOT EXISTS phone TEXT DEFAULT '',
        ADD COLUMN IF NOT EXISTS address TEXT DEFAULT '',
        ADD COLUMN IF NOT EXISTS city TEXT DEFAULT ''
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS orders (
            id BIGSERIAL PRIMARY KEY,
            user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            customer_name TEXT NOT NULL,
            phone TEXT NOT NULL,
            address TEXT NOT NULL,
            city TEXT NOT NULL,
            subtotal NUMERIC(10,2) NOT NULL,
            delivery_fee NUMERIC(10,2) NOT NULL DEFAULT 0,
            total NUMERIC(10,2) NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS order_items (
            id BIGSERIAL PRIMARY KEY,
            order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
            product_id BIGINT,
            product_name TEXT NOT NULL,
            price NUMERIC(10,2) NOT NULL,
            quantity INTEGER NOT NULL,
            subtotal NUMERIC(10,2) NOT NULL
        )
    """)

    conn.commit()
    cursor.close()
    conn.close()


def get_authenticated_user():
    auth = request.headers.get("Authorization", "")

    if not auth.startswith("Bearer "):
        return None

    token = auth[7:].strip()

    try:
        payload = jwt.decode(
            token,
            JWT_SECRET,
            algorithms=["HS256"]
        )
        return payload
    except Exception:
        return None


@app.route("/api/setup-ecommerce", methods=["GET"])
def setup_ecommerce():
    try:
        ensure_order_tables()
        return {
            "status": "success",
            "message": "Profile and order tables are ready"
        }
    except Exception as e:
        return {
            "status": "error",
            "message": str(e)
        }, 500


@app.route("/api/profile", methods=["GET"])
def get_profile():
    user = get_authenticated_user()

    if not user:
        return {
            "status": "error",
            "message": "Authentication required"
        }, 401

    try:
        ensure_order_tables()

        conn = psycopg2.connect(os.environ["DATABASE_URL"])
        cursor = conn.cursor()

        cursor.execute("""
            SELECT id, name, email, phone, address, city, role, created_at
            FROM users
            WHERE id = %s
        """, (user["user_id"],))

        row = cursor.fetchone()

        cursor.close()
        conn.close()

        if not row:
            return {
                "status": "error",
                "message": "User not found"
            }, 404

        return {
            "status": "success",
            "user": {
                "id": row[0],
                "name": row[1],
                "email": row[2],
                "phone": row[3] or "",
                "address": row[4] or "",
                "city": row[5] or "",
                "role": row[6],
                "created_at": str(row[7])
            }
        }

    except Exception as e:
        return {
            "status": "error",
            "message": str(e)
        }, 500


@app.route("/api/profile", methods=["PUT"])
def update_profile():
    user = get_authenticated_user()

    if not user:
        return {
            "status": "error",
            "message": "Authentication required"
        }, 401

    try:
        data = request.get_json() or {}

        name = str(data.get("name", "")).strip()
        phone = str(data.get("phone", "")).strip()
        address = str(data.get("address", "")).strip()
        city = str(data.get("city", "")).strip()

        if not name:
            return {
                "status": "error",
                "message": "Name is required"
            }, 400

        if not phone:
            return {
                "status": "error",
                "message": "Phone is required"
            }, 400

        if not address:
            return {
                "status": "error",
                "message": "Address is required"
            }, 400

        ensure_order_tables()

        conn = psycopg2.connect(os.environ["DATABASE_URL"])
        cursor = conn.cursor()

        cursor.execute("""
            UPDATE users
            SET name = %s,
                phone = %s,
                address = %s,
                city = %s
            WHERE id = %s
            RETURNING id, name, email, phone, address, city, role, created_at
        """, (
            name,
            phone,
            address,
            city,
            user["user_id"]
        ))

        row = cursor.fetchone()
        conn.commit()

        cursor.close()
        conn.close()

        return {
            "status": "success",
            "message": "Profile updated successfully",
            "user": {
                "id": row[0],
                "name": row[1],
                "email": row[2],
                "phone": row[3] or "",
                "address": row[4] or "",
                "city": row[5] or "",
                "role": row[6],
                "created_at": str(row[7])
            }
        }

    except Exception as e:
        return {
            "status": "error",
            "message": str(e)
        }, 500


@app.route("/api/orders", methods=["POST"])
def create_order():
    user = get_authenticated_user()

    if not user:
        return {
            "status": "error",
            "message": "Authentication required"
        }, 401

    try:
        data = request.get_json() or {}

        items = data.get("items") or []
        customer_name = str(data.get("customer_name", "")).strip()
        phone = str(data.get("phone", "")).strip()
        address = str(data.get("address", "")).strip()
        city = str(data.get("city", "")).strip()

        if not items:
            return {
                "status": "error",
                "message": "Your cart is empty"
            }, 400

        if not customer_name or not phone or not address:
            return {
                "status": "error",
                "message": "Name, phone and address are required"
            }, 400

        ensure_order_tables()

        conn = psycopg2.connect(os.environ["DATABASE_URL"])
        cursor = conn.cursor()

        subtotal = 0
        clean_items = []

        for item in items:
            product_id = item.get("id")
            name = str(item.get("name", "")).strip()
            quantity = int(item.get("quantity", 0))

            if not name or quantity < 1:
                continue

            cursor.execute("""
                SELECT id, name, price, stock
                FROM products
                WHERE id = %s
            """, (product_id,))

            product = cursor.fetchone()

            if not product:
                conn.rollback()
                cursor.close()
                conn.close()
                return {
                    "status": "error",
                    "message": f"Product not found: {name}"
                }, 400

            real_id, real_name, real_price, stock = product

            if stock is not None and quantity > stock:
                conn.rollback()
                cursor.close()
                conn.close()
                return {
                    "status": "error",
                    "message": f"Not enough stock for {real_name}"
                }, 400

            line_total = float(real_price) * quantity
            subtotal += line_total

            clean_items.append({
                "id": real_id,
                "name": real_name,
                "price": float(real_price),
                "quantity": quantity,
                "subtotal": line_total
            })

        if not clean_items:
            conn.rollback()
            cursor.close()
            conn.close()
            return {
                "status": "error",
                "message": "No valid products in cart"
            }, 400

        delivery_fee = 0 if subtotal >= 100 else 5
        total = subtotal + delivery_fee

        cursor.execute("""
            INSERT INTO orders (
                user_id,
                customer_name,
                phone,
                address,
                city,
                subtotal,
                delivery_fee,
                total,
                status
            )
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,'pending')
            RETURNING id, created_at
        """, (
            user["user_id"],
            customer_name,
            phone,
            address,
            city,
            subtotal,
            delivery_fee,
            total
        ))

        order_id, created_at = cursor.fetchone()

        for item in clean_items:
            cursor.execute("""
                INSERT INTO order_items (
                    order_id,
                    product_id,
                    product_name,
                    price,
                    quantity,
                    subtotal
                )
                VALUES (%s,%s,%s,%s,%s,%s)
            """, (
                order_id,
                item["id"],
                item["name"],
                item["price"],
                item["quantity"],
                item["subtotal"]
            ))

            cursor.execute("""
                UPDATE products
                SET stock = GREATEST(COALESCE(stock, 0) - %s, 0)
                WHERE id = %s
            """, (
                item["quantity"],
                item["id"]
            ))

        conn.commit()
        cursor.close()
        conn.close()

        return {
            "status": "success",
            "message": "Order placed successfully",
            "order": {
                "id": order_id,
                "subtotal": subtotal,
                "delivery_fee": delivery_fee,
                "total": total,
                "status": "pending",
                "created_at": str(created_at)
            }
        }, 201

    except Exception as e:
        try:
            conn.rollback()
            cursor.close()
            conn.close()
        except Exception:
            pass

        return {
            "status": "error",
            "message": str(e)
        }, 500


@app.route("/api/orders", methods=["GET"])
def get_orders():
    user = get_authenticated_user()

    if not user:
        return {
            "status": "error",
            "message": "Authentication required"
        }, 401

    try:
        ensure_order_tables()

        conn = psycopg2.connect(os.environ["DATABASE_URL"])
        cursor = conn.cursor()

        cursor.execute("""
            SELECT
                id,
                customer_name,
                phone,
                address,
                city,
                subtotal,
                delivery_fee,
                total,
                status,
                created_at
            FROM orders
            WHERE user_id = %s
            ORDER BY id DESC
        """, (user["user_id"],))

        rows = cursor.fetchall()

        orders = []

        for row in rows:
            cursor.execute("""
                SELECT
                    product_id,
                    product_name,
                    price,
                    quantity,
                    subtotal
                FROM order_items
                WHERE order_id = %s
                ORDER BY id ASC
            """, (row[0],))

            items = [
                {
                    "product_id": item[0],
                    "name": item[1],
                    "price": float(item[2]),
                    "quantity": item[3],
                    "subtotal": float(item[4])
                }
                for item in cursor.fetchall()
            ]

            orders.append({
                "id": row[0],
                "customer_name": row[1],
                "phone": row[2],
                "address": row[3],
                "city": row[4],
                "subtotal": float(row[5]),
                "delivery_fee": float(row[6]),
                "total": float(row[7]),
                "status": row[8],
                "created_at": str(row[9]),
                "items": items
            })

        cursor.close()
        conn.close()

        return {
            "status": "success",
            "orders": orders
        }

    except Exception as e:
        return {
            "status": "error",
            "message": str(e)
        }, 500

