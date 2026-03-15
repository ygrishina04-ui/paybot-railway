const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;
const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN is missing");
}

const TELEGRAM_URL = `https://api.telegram.org/bot${BOT_TOKEN}`;

async function sendMessage(chatId, text) {
  await axios.post(`${TELEGRAM_URL}/sendMessage`, {
    chat_id: chatId,
    text
  });
}

app.get("/", (req, res) => {
  res.status(200).send("Pay bot is running");
});

app.post(`/webhook/${BOT_TOKEN}`, async (req, res) => {
  try {
    const update = req.body;

    if (update.message?.text) {
      const chatId = update.message.chat.id;
      const text = update.message.text;

      if (text === "/start") {
        await sendMessage(chatId, "Привет! Pay-бот на Railway работает ✅");
      } else {
        await sendMessage(chatId, `Получила: ${text}`);
      }
    }

    res.sendStatus(200);
  } catch (e) {
    console.error(e.response?.data || e.message);
    res.sendStatus(200);
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server started on port ${PORT}`);
});
