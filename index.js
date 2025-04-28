const admin = require("firebase-admin");
const express = require("express");
const { google } = require("googleapis");
const { JWT } = require("google-auth-library");
const { v4: uuidv4 } = require("uuid");
const app = express();
app.use(express.json());

// Enable CORS for frontend requests
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

// Load from environment variables
const SHEET_ID = process.env.SHEET_ID;
const client = new JWT({
  email: process.env.SERVICE_EMAIL,
  key: process.env.SERVICE_KEY.replace(/\\n/g, "\n"),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

// Initialize Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    }),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
  });
}
const db = admin.database();

// ----------------------------
// TEMPORARY In-Memory Store
// ----------------------------
const tempOrders = {};

async function decrementInventory(pen, trinkets) {
  // Decrement Pen
  const penRef = db.ref(`pens/${pen}`);
  await penRef.transaction((current) => {
    return (current || 0) - 1;
  });

  // Decrement Trinkets
  for (const trinket of trinkets) {
    const ref = db.ref(`trinkets/${trinket.id}/quantity`);
    await ref.transaction((current) => {
      return (current || 0) - 1;
    });
  }
}

// Helper function to log order to Google Sheet
async function logOrderToSheet(pen, trinkets) {
  const sheets = google.sheets({ version: "v4", auth: client });
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: "InventoryLog!A1",
    valueInputOption: "RAW",
    requestBody: {
      values: [[new Date().toISOString(), pen, trinkets.map(t => t.name).join(", ")]],
    },
  });
}

// ----------------------------
// Routes
// ----------------------------

// TEMP-SAVE Route (Save customization temporarily)
app.post("/temp-save", (req, res) => {
  try {
    const customization = req.body;

    if (!customization.pen || !customization.trinkets) {
      return res.status(400).json({ error: "Missing pen or trinkets in customization." });
    }

    const tempOrderId = uuidv4();
    tempOrders[tempOrderId] = customization;

    console.log(`Saved customization for tempOrderId: ${tempOrderId}`);

    res.json({ tempOrderId: tempOrderId });
  } catch (error) {
    console.error("Error saving customization:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// TEMP-ORDER Route (Retrieve saved customization)
app.get("/temp-order/:tempOrderId", (req, res) => {
  const tempOrderId = req.params.tempOrderId;
  const customization = tempOrders[tempOrderId];

  if (!customization) {
    return res.status(404).json({ error: "Temp order not found" });
  }

  res.json(customization);
});

// LOG Route (Log finalized order to Google Sheet)
app.post("/log", async (req, res) => {
  try {
    const { pen, trinkets } = req.body;

    await logOrderToSheet(pen, trinkets);

    res.status(200).send("Logged");
  } catch (err) {
    console.error("Error logging to sheet:", err);
    res.status(500).send("Error: " + err.message);
  }
});

// PAYMENT Webhook Route (Full Version)
app.post("/payment-webhook", async (req, res) => {
  try {
    const { tempOrderId, paymentStatus } = req.body;

    console.log("Webhook received:", { tempOrderId, paymentStatus });

    if (paymentStatus !== "success") {
      return res.status(400).send({ message: "Payment not successful." });
    }

    const customization = tempOrders[tempOrderId];

    if (!customization) {
      return res.status(404).json({ error: "Temp order not found." });
    }

    const { pen, trinkets } = customization;

    // 1. Decrement inventory
    await decrementInventory(pen, trinkets);

    // 2. Log order to Google Sheet
    await logOrderToSheet(pen, trinkets);

    // 3. Clean up tempOrder
    delete tempOrders[tempOrderId];

    res.status(200).send({ message: "Inventory updated and order logged." });
  } catch (error) {
    console.error("Error processing webhook:", error);
    res.status(500).send({ error: "Internal server error" });
  }
});

// Health Check Route
app.get("/", (req, res) => {
  res.send("Pen inventory backend is live.");
});

// Server Listen
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
