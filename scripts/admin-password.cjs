#!/usr/bin/env node
require("dotenv").config();
const { rotateAdminPassword, AdminConfigurationError } = require("../lib/admin-bootstrap");

async function main() {
  if (process.argv.length !== 2) {
    throw new AdminConfigurationError("Use environment variables ADMIN_ROTATE_USERNAME and ADMIN_ROTATE_PASSWORD; command arguments are not accepted.");
  }
  const username = process.env.ADMIN_ROTATE_USERNAME;
  const password = process.env.ADMIN_ROTATE_PASSWORD;
  if (!username || !password) {
    throw new AdminConfigurationError("ADMIN_ROTATE_USERNAME and ADMIN_ROTATE_PASSWORD are required.");
  }
  if (!process.env.MONGODB_URI) throw new AdminConfigurationError("MONGODB_URI is required.");
  const { MongoClient } = require("mongodb");
  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  try {
    await client.connect();
    const dbName = String(process.env.MONGODB_DB_NAME || "school_app").trim();
    const namespace = String(process.env.DATA_NAMESPACE || "").trim().replace(/[^a-zA-Z0-9_-]/g, "");
    const users = client.db(dbName).collection(namespace ? `${namespace}_users` : "users");
    await rotateAdminPassword(users, { username, password });
    console.log("Administrator password rotated. Previous account sessions are revoked.");
  } finally {
    await client.close();
  }
}

main().catch(error => {
  // Database driver errors can contain connection strings; never print them.
  console.error(error instanceof AdminConfigurationError ? error.message : "Administrator password rotation failed. Check database connectivity and configuration.");
  process.exitCode = 1;
});
