const express = require("express");
const axios = require("axios");
const { GoogleSpreadsheet } = require("google-spreadsheet");
const { JWT } = require("google-auth-library");

const TOKEN = process.env.BOT_TOKEN;
const TELEGRAM_URL = `https://api.telegram.org/bot${TOKEN}`;
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

const app = express();
app.use(express.json());

console.log("=== PAYBOT EXIMA BUILD ===");

let sheetConditions;
let sheetRates;
let sheetHistory;

function normalize(value) {
  return String(value || "").trim().toUpperCase();
}

function parseNumber(v) {
  if (v === null || v === undefined || v === "") return 0;
  return parseFloat(String(v).replace(/\s/g, "").replace(",", "."));
}

function formatAmount(value) {
  return Number(value).toLocaleString("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function formatRate(value) {
  return Number(value).toLocaleString("ru-RU", {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4
  });
}

function formatPercent(value) {
  return Number(value).toLocaleString("ru-RU", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 2
  });
}

function formatRub(value) {
  return Number(value).toLocaleString("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
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

  console.log("Sheets loaded");

}

async function sendMessage(chatId, text, keyboard = null) {

  const payload = {
    chat_id: chatId,
    text
  };

  if (keyboard) {
    payload.reply_markup = keyboard;
  }

  await axios.post(`${TELEGRAM_URL}/sendMessage`, payload);

}

function currencyButtons(amount) {

  return {
    inline_keyboard: [
      [
        { text: "USD", callback_data: `calc|${amount}|USD` },
        { text: "CNY", callback_data: `calc|${amount}|CNY` }
      ],
      [
        { text: "JPY", callback_data: `calc|${amount}|JPY` }
      ]
    ]
  };

}

async function calculate(amount, currency) {

  const condRows = await sheetConditions.getRows();
  const rateRows = await sheetRates.getRows();

  const target = normalize(currency);

  let cond = null;
  let rate = null;

  for (const r of condRows) {

    const rowCurrency = normalize(r._rawData[0]);

    if (rowCurrency === target) {
      cond = r;
      break;
    }

  }

  for (const r of rateRows) {

    const rowCurrency = normalize(r._rawData[0]);

    if (rowCurrency === target) {
      rate = r;
      break;
    }

  }

  if (!cond || !rate) return null;

  const markup = parseNumber(cond._rawData[1]);
  const commission = parseNumber(cond._rawData[2]);
  const swift = parseNumber(cond._rawData[3]);
  const baseRate = parseNumber(rate._rawData[1]);

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

  await sheetHistory.addRow([
    new Date().toISOString(),
    userId,
    username,
    currency,
    amount,
    rate,
    commission,
    total
  ]);

}

function buildResultMessage(amount, currency, calc) {

  return `💳 Расчет платежа

Сумма поставщику: ${formatAmount(amount)} ${currency}
Курс: ${formatRate(calc.finalRate)}
SWIFT: ${formatAmount(calc.swift)} ${currency}
Комиссия: ${formatPercent(calc.commission)} %

——————————
Итого к оплате: ${formatRub(calc.total)} RUB`;

}

async function buildRatesMessage() {

  const rateRows = await sheetRates.getRows();

  const rates = [];

  for (const r of rateRows) {

    const currency = normalize(r._rawData[0]);
    const rate = parseNumber(r._rawData[1]);

    if (currency && rate) {
      rates.push(`${currency} — ${formatRate(rate)}`);
    }

  }

  if (!rates.length) {
    return "Курсы не найдены";
  }

  return `📊 Курсы ЦБ

${rates.join("\n")}`;

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

        await sendMessage(
          chatId,
          `💳 PayBot Exima

Отправь сумму для расчета.

Например:
12500
или
12500 usd

Команда:
/курсы`
        );

      }

      else if (text === "/kurs") {

        const ratesMessage = await buildRatesMessage();
        await sendMessage(chatId, ratesMessage);

      }

      else if (/^\d+([.,]\d+)?$/g.test(text)) {

        const amount = parseNumber(text);

        await sendMessage(
          chatId,
          "Выберите валюту:",
          currencyButtons(amount)
        );

      }

      else if (/^\d+([.,]\d+)?\s+[a-zA-Z]{3}$/g.test(text)) {

        const parts = text.split(/\s+/);

        const amount = parseNumber(parts[0]);
        const currency = normalize(parts[1]);

        const calc = await calculate(amount, currency);

        if (!calc) {

          await sendMessage(
            chatId,
            `Курс или условия не найдены для валюты ${currency}`
          );

          return res.sendStatus(200);

        }

        const msg = buildResultMessage(amount, currency, calc);

        await sendMessage(chatId, msg);

        await saveHistory(
          userId,
          username,
          currency,
          amount,
          calc.finalRate,
          calc.commission,
          calc.total
        );

      }

      else {

        await sendMessage(
          chatId,
          `Формат запроса:
12500
или
12500 usd

Команда:
/курсы`
        );

      }

    }

    if (update.callback_query) {

      const data = update.callback_query.data;

      const chatId = update.callback_query.message.chat.id;
      const userId = update.callback_query.from.id;
      const username = update.callback_query.from.username || "";

      const parts = data.split("|");

      if (parts.length === 3 && parts[0] === "calc") {

        const amount = parseNumber(parts[1]);
        const currency = normalize(parts[2]);

        const calc = await calculate(amount, currency);

        if (!calc) {

          await sendMessage(
            chatId,
            `Курс или условия не найдены для валюты ${currency}`
          );

        } else {

          const msg = buildResultMessage(amount, currency, calc);

          await sendMessage(chatId, msg);

          await saveHistory(
            userId,
            username,
            currency,
            amount,
            calc.finalRate,
            calc.commission,
            calc.total
          );

        }

        await axios.post(`${TELEGRAM_URL}/answerCallbackQuery`, {
          callback_query_id: update.callback_query.id
        });

      }

    }

  }

  catch (e) {

    console.log(
      "BOT ERROR:",
      e.response ? e.response.data : e.message
    );

  }

  res.sendStatus(200);

});

app.get("/", (req, res) => {

  res.send("PayBot Railway running");

});

const PORT = process.env.PORT || 8080;

initSheets()
  .then(() => {

    app.listen(PORT, "0.0.0.0", () => {
      console.log("Server running on", PORT);
    });

  })
  .catch((e) => {

    console.log("INIT ERROR:", e.message);

  });
