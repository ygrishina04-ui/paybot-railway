const express = require("express");
const axios = require("axios");
const { google } = require("googleapis");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;
const BOT_TOKEN = process.env.BOT_TOKEN;
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const SHEET_NAME = process.env.SHEET_NAME || "Data";
const SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

const TELEGRAM_URL = `https://api.telegram.org/bot${BOT_TOKEN}`;

function getGoogleAuth() {
  const credentials = JSON.parse(SERVICE_ACCOUNT_JSON);

  return new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });
}

async function getSheetsClient() {
  const auth = getGoogleAuth();
  return google.sheets({ version: "v4", auth });
}

async function appendRow(values) {
  const sheets = await getSheetsClient();

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A:D`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [values]
    }
  });
}

async function sendMessage(chatId, text) {
  await axios.post(`${TELEGRAM_URL}/sendMessage`, {
    chat_id: chatId,
    text
  });
}

app.get("/", (req, res) => {
  res.send("Pay bot is running");
});

app.post(`/webhook/${BOT_TOKEN}`, async (req, res) => {
  try {
    const update = req.body;

    if (update.message?.text) {
      const chatId = update.message.chat.id;
      const username = update.message.from?.username || "";
      const text = update.message.text;

      if (text === "/start") {
        await sendMessage(chatId, "Привет! Бот работает через Railway 🚀");
      } else {

        await appendRow([
          new Date().toISOString(),
          chatId,
          username,
          text
        ]);

        await sendMessage(chatId, "Сообщение записано в таблицу ✅");
      }
    }

    res.sendStatus(200);

  } catch (e) {
    console.error(e);
    res.sendStatus(200);
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on ${PORT}`);
});
