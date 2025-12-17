// =================== CONFIG ===================
const BOT_TOKEN = "8300130610:AAGoEKwlsjZQJn6a0BF8wlF1fcQztZ7PjeI";
const API_URL = `https://api.telegram.org/bot${BOT_TOKEN}`;

// =================== WORKER ENTRY ===================
export default {
  async fetch(request, env) {
    if (request.method === "POST") {
      try {
        const update = await request.json();
        await handleUpdate(update, env);
      } catch (e) {
        console.error("Worker Error:", e);
      }
    }
    return new Response("OK");
  }
};

// =================== HANDLE UPDATE ===================
async function handleUpdate(update, env) {
  const DB = env.DB; // KV Namespace
  const msg = update.message || update.callback_query?.message;
  if (!msg) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;

  // =================== START COMMAND ===================
  if (update.message && update.message.text === "/start") {
    return sendMessage(chatId,
      "👋 Welcome to File Share Bot! You can upload files with password protection.",
      {
        inline_keyboard: [
          [{ text: "📤 Upload File", callback_data: "upload_file" }],
          [{ text: "📂 My Files", callback_data: "my_files" }],
          [{ text: "🔑 Recover Password", callback_data: "recover_password" }]
        ]
      }
    );
  }

  // =================== CALLBACK BUTTONS ===================
  if (update.callback_query) {
    const data = update.callback_query.data;

    if (data === "upload_file") {
      await DB.put(`awaiting_file:${userId}`, "true");
      return sendMessage(chatId, "📤 Please upload your file (photo, video, document)!");
    }

    if (data === "my_files") {
      const files = await DB.list({ prefix: `file:${userId}:` });
      if (files.keys.length === 0) return answerCallback(update.callback_query.id, "📂 You have no files yet!");

      for (let f of files.keys) {
        const fileData = JSON.parse(await DB.get(f.name));
        await sendMessage(chatId, `📄 File: ${fileData.name}\n🔑 Password protected\n🔗 Share link: https://t.me/YourBotUsername?start=${fileData.id}`);
      }
      return answerCallback(update.callback_query.id, "📂 Your files listed!");
    }

    if (data === "recover_password") {
      await DB.put(`awaiting_recover:${userId}`, "true");
      return sendMessage(chatId, "🔑 Send the User ID to recover passwords:");
    }
  }

  // =================== FILE UPLOAD ===================
  if (update.message && (update.message.document || update.message.video || update.message.photo)) {
    const awaitingFile = await DB.get(`awaiting_file:${userId}`);
    if (!awaitingFile) return;

    const file = update.message.document || update.message.video || update.message.photo;
    await DB.put(`temp_file:${userId}`, JSON.stringify({
      id: file.file_id,
      name: file.file_name || (file.file_id + ".jpg"),
      type: file.type || "document"
    }));

    await DB.delete(`awaiting_file:${userId}`);
    return sendMessage(chatId, "🔑 Please send a password to protect this file.");
  }

  // =================== PASSWORD RECEIVED ===================
  if (update.message && update.message.text) {
    // Check if user is uploading password for file
    const tempFile = await DB.get(`temp_file:${userId}`);
    if (tempFile) {
      const fileData = JSON.parse(tempFile);
      const password = update.message.text;

      await DB.put(`file:${userId}:${fileData.id}`, JSON.stringify({
        ...fileData,
        password
      }));

      await DB.delete(`temp_file:${userId}`);
      return sendMessage(chatId, `✅ File uploaded successfully!\n📄 File: ${fileData.name}\n🔑 Password protected\n🔗 Share link: https://t.me/YourBotUsername?start=${fileData.id}`);
    }

    // Check if user is recovering passwords
    const awaitingRecover = await DB.get(`awaiting_recover:${userId}`);
    if (awaitingRecover) {
      const targetUserId = update.message.text.trim();
      const files = await DB.list({ prefix: `file:${targetUserId}:` });
      if (files.keys.length === 0) {
        await DB.delete(`awaiting_recover:${userId}`);
        return sendMessage(chatId, `❌ No files found for User ID: ${targetUserId}`);
      }

      for (let f of files.keys) {
        const fileData = JSON.parse(await DB.get(f.name));
        await sendMessage(chatId, `📄 File: ${fileData.name}\n🔑 Password: ${fileData.password}`);
      }

      await DB.delete(`awaiting_recover:${userId}`);
      return sendMessage(chatId, "✅ Password recovery completed!");
    }
  }
}

// =================== HELPER FUNCTIONS ===================
async function sendMessage(chatId, text, replyMarkup = null) {
  const body = { chat_id: chatId, text, parse_mode: "HTML" };
  if (replyMarkup) body.reply_markup = replyMarkup;

  return fetch(`${API_URL}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

async function answerCallback(queryId, text, showAlert = false) {
  return fetch(`${API_URL}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: queryId, text, show_alert: showAlert })
  });
}
