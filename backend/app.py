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

