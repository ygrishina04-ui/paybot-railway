const express = require("express");
const axios = require("axios");
const { GoogleSpreadsheet } = require("google-spreadsheet");
const { JWT } = require("google-auth-library");

const TOKEN = process.env.BOT_TOKEN;
const TELEGRAM_URL = `https://api.telegram.org/bot${TOKEN}`;
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

const app = express();
app.use(express.json());

let sheetConditions;
let sheetRates;
let sheetHistory;

function parseNumber(v) {
  if (!v) return 0;
  return parseFloat(v.toString().replace(",", "."));
}

async function initSheets() {

  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);

  const auth = new JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });

  const doc = new GoogleSpreadsheet(SPREADSHEET_ID, auth);

  await doc.loadInfo();

  sheetConditions = doc.sheetsByTitle["УСЛОВИЯ"];
  sheetRates = doc.sheetsByTitle["КУРСЫ ЦБ"];
  sheetHistory = doc.sheetsByTitle["ИСТОРИЯ"];

}

async function sendMessage(chatId, text, keyboard = null) {

  const payload = {
    chat_id: chatId,
    text: text
  };

  if (keyboard) payload.reply_markup = keyboard;

  await axios.post(`${TELEGRAM_URL}/sendMessage`, payload);

}

function currencyButtons(amount) {

  return {
    inline_keyboard: [
      [
        { text: "USD", callback_data: `calc|${amount}|USD` },
        { text: "EUR", callback_data: `calc|${amount}|EUR` }
      ],
      [
        { text: "CNY", callback_data: `calc|${amount}|CNY` },
        { text: "JPY", callback_data: `calc|${amount}|JPY` }
      ]
    ]
  };

}

async function calculate(amount, currency) {

  const condRows = await sheetConditions.getRows();
  const rateRows = await sheetRates.getRows();

  const cond = condRows.find(r => r.валюта === currency);
  const rate = rateRows.find(r => r.валюта === currency);

  if (!cond || !rate) return null;

  const markup = parseNumber(cond.наценка);
  const commission = parseNumber(cond.комиссия);
  const swift = parseNumber(cond.swift);
  const baseRate = parseNumber(rate.курс);

  const finalRate = baseRate + markup;

  const rub = (amount + swift) * finalRate;

  const total = rub + (rub * commission / 100);

  return {
    finalRate,
    swift,
    commission,
    total
  };

}

async function saveHistory(userId, username, currency, amount, rate, commission, total) {

  await sheetHistory.addRow({
    дата: new Date(),
    userid: userId,
    username: username,
    валюта: currency,
    сумма: amount,
    курс: rate,
    комиссия: commission,
    итого: Math.round(total)
  });

}

app.post(`/webhook/${TOKEN}`, async (req, res) => {

  const update = req.body;

  try {

    if (update.message) {

      const chatId = update.message.chat.id;
      const text = (update.message.text || "").trim();
      const userId = update.message.from.id;
      const username = update.message.from.username || "";

      if (text === "/start") {

        await sendMessage(chatId,
`Отправь сумму для расчета

Например:
12500
или
12500 usd`);

      }

      else if (/^\d+$/g.test(text)) {

        const amount = parseFloat(text);

        await sendMessage(chatId, "Выберите валюту", currencyButtons(amount));

      }

      else if (/^\d+\s[a-zA-Z]{3}$/g.test(text)) {

        const parts = text.split(" ");

        const amount = parseFloat(parts[0]);
        const currency = parts[1].toUpperCase();

        const calc = await calculate(amount, currency);

        if (!calc) {
          await sendMessage(chatId, "Курс или условия не найдены");
          return;
        }

        const msg =
`Сумма поставщику: ${amount} ${currency}
Курс: ${calc.finalRate.toFixed(4)}
SWIFT: ${calc.swift} ${currency}
Комиссия: ${calc.commission}%
Итого к оплате: ${Math.round(calc.total)} RUB`;

        await sendMessage(chatId, msg);

        await saveHistory(userId, username, currency, amount, calc.finalRate, calc.commission, calc.total);

      }

    }

    if (update.callback_query) {

      const data = update.callback_query.data;

      const chatId = update.callback_query.message.chat.id;
      const userId = update.callback_query.from.id;
      const username = update.callback_query.from.username || "";

      const parts = data.split("|");

      const amount = parseFloat(parts[1]);
      const currency = parts[2];

      const calc = await calculate(amount, currency);

      if (!calc) {
        await sendMessage(chatId, "Курс не найден");
        return;
      }

      const msg =
`Сумма поставщику: ${amount} ${currency}
Курс: ${calc.finalRate.toFixed(4)}
SWIFT: ${calc.swift} ${currency}
Комиссия: ${calc.commission}%
Итого к оплате: ${Math.round(calc.total)} RUB`;

      await sendMessage(chatId, msg);

      await saveHistory(userId, username, currency, amount, calc.finalRate, calc.commission, calc.total);

    }

  } catch (e) {

    console.log("BOT ERROR", e);

  }

  res.sendStatus(200);

});

app.get("/", (req, res) => {

  res.send("PayBot Railway running");

});

const PORT = process.env.PORT || 8080;

initSheets().then(() => {

  app.listen(PORT, () => {

    console.log("Server running on", PORT);

  });

});
