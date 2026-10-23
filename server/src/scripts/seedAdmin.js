import bcrypt from "bcryptjs";
import { pool } from "../db.js";

const email = (process.env.ADMIN_EMAIL || "admin@example.com").toLowerCase();

const password = process.env.ADMIN_PASSWORD || "ChangeMe123!";

const [rows] = await pool.query("SELECT id FROM admins WHERE email = ?", [
  email,
]);

if (rows.length) {
  console.log(`Admin ${email} already exists.`);
} else {
  await pool.query("INSERT INTO admins (email, password_hash) VALUES (?, ?)", [
    email,
    await bcrypt.hash(password, 10),
  ]);

  console.log(`Admin created: ${email}`);
}

await pool.end();
