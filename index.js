const express = require("express");
const { google } = require("googleapis");
const { JWT } = require("google-auth-library");
const app = express();
app.use(express.json());

// Enable CORS for frontend requests
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
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

app.post("/log", async (req, res) => {
  try {
    const { pen, trinkets } = req.body;

    const sheets = google.sheets({ version: "v4", auth: client });
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: "InventoryLog!A1",
      valueInputOption: "RAW",
      requestBody: {
        values: [[new Date().toISOString(), pen, trinkets.join(", ")]],
      },
    });

    res.status(200).send("Logged");
  } catch (err) {
    console.error("Error logging to sheet:", err);
    res.status(500).send("Error: " + err.message);
  }
});

app.get("/", (req, res) => {
  res.send("Pen inventory backend is live.");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
