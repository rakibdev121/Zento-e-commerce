import os
import psycopg2
from flask import Flask
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)

@app.route("/")
def home():
    return {
        "status": "success",
        "message": "Zento E-commerce Backend is running"
    }

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
