const express = require("express");
const SibApiV3Sdk = require("sib-api-v3-sdk");
const fs = require("fs");
const path = require("path");
const nodemailer = require("nodemailer");
const cron = require("node-cron");
require("dotenv").config();
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const app = express();
app.use(express.json());
const ENABLE_EMAIL = process.env.ENABLE_EMAIL === "true";
// === Servir archivos estáticos (HTML en carpeta public) ===
const PUBLIC_DIR = path.join(__dirname, "public");
app.use(express.static(PUBLIC_DIR));

// === Carpeta donde se guardan los CSV ===
const DATA_DIR = path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR);
  console.log("Carpeta 'data' creada.");
}

// === Funciones helper para archivos diarios ===
function getDailyFileName() {
  const today = new Date().toISOString().split("T")[0];
  return `logs_${today}.csv`;
}

function getDailyFilePath() {
  return path.join(DATA_DIR, getDailyFileName());
}

/* ========================================================
   1) ENDPOINT PARA RECIBIR LOGS DESDE EL BOT
   ======================================================== */
app.post("/score-log", (req, res) => {
  const { dni, score, registro } = req.body;

  if (!dni || !score || !registro) {
    return res.status(400).json({ error: "faltan datos (dni, score, registro)" });
  }

  const filePath = getDailyFilePath();
  const header = "dni,score,registro\n";

  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, header, "utf8");
    console.log("Nuevo archivo creado:", filePath);
  }

  const line = `${dni},${score},${registro}\n`;
  fs.appendFileSync(filePath, line, "utf8");

  console.log("Registro agregado:", line.trim());
  res.json({ ok: true });
});

/* ========================================================
   2) ENDPOINT PARA LEER LOS LOGS DE HOY (JSON)
   ======================================================== */
app.get("/logs/today", (req, res) => {
  const filePath = getDailyFilePath();

  if (!fs.existsSync(filePath)) {
    return res.json({ file: path.basename(filePath), registros: [] });
  }

  const csv = fs.readFileSync(filePath, "utf8");
  const lines = csv.trim().split(/\r?\n/);

  const rows = lines.slice(1).map((line) => line.split(","));

  const registros = rows.map((cols) => ({
    dni: cols[0],
    score: cols[1],
    registro: cols[2]
  }));

  res.json({
    file: path.basename(filePath),
    registros
  });
});

/* ========================================================
   3) SERVIR EL DASHBOARD HTML BONITO
   ======================================================== */
app.get("/dashboard", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "dashboard.html"));
});

/* ========================================================
   4) EMAILS AUTOMÁTICOS
   ======================================================== */
const MAIL_USER = process.env.MAIL_USER;
const MAIL_PASS = process.env.MAIL_PASS;
const MAIL_TO = process.env.MAIL_TO;
const MAIL_FROM = process.env.MAIL_FROM;
let apiInstance = null;

if (ENABLE_EMAIL) {
  if (!BREVO_API_KEY) {
    console.error("Falta BREVO_API_KEY en el .env");
  } else {
    const defaultClient = SibApiV3Sdk.ApiClient.instance;
    defaultClient.authentications["api-key"].apiKey = BREVO_API_KEY;

    apiInstance = new SibApiV3Sdk.TransactionalEmailsApi();
    console.log("Brevo (TransactionalEmailsApi) inicializado ✔");
  }
}
function getAttachmentData(filePath) {
  if (fs.existsSync(filePath)) {
    return [{
      content: fs.readFileSync(filePath).toString("base64"),
      name: path.basename(filePath)
    }];
  }
  return [];
}
// === Envío diario 22:00 ===
cron.schedule("0 22 * * *", async () => {
  console.log("Ejecutando tarea diaria (cron 22:00)...");

  if (!ENABLE_EMAIL) return console.log("ENABLE_EMAIL=false → no se envía mail.");
  if (!apiInstance) return console.log("Brevo no inicializado (apiInstance null).");

  const filePath = getDailyFilePath();
  if (!fs.existsSync(filePath)) return console.log("No hay archivo para enviar.");

  try {
    const attachmentsAPI = getAttachmentData(filePath);

    const sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();
    sendSmtpEmail.sender = { email: MAIL_FROM, name: "Registros Score" };
    sendSmtpEmail.to = [{ email: MAIL_TO }];
    sendSmtpEmail.subject = "📊 Reporte diario de Score 📍";
    sendSmtpEmail.textContent = "Adjunto CSV con registros de hoy.";
    if (attachmentsAPI.length > 0) {
      sendSmtpEmail.attachment = attachmentsAPI;
    }
    await apiInstance.sendTransacEmail(sendSmtpEmail);
    console.log("MAIL DIARIO ENVIADO (Brevo) ✔");
  } catch (err) {
    console.error("Error enviando mail:", err?.response?.text || err.message);
  }
});


// === Test de mail ===
app.get("/test-email", async (req, res) => {
  if (!ENABLE_EMAIL) {
    return res.json({ ok: true, message: "Emails desactivados (ENABLE_EMAIL=false)" });
  }
  if (!apiInstance) {
    return res.status(500).json({ ok: false, error: "Brevo no inicializado. Revisar BREVO_API_KEY" });
  }

  const filePath = getDailyFilePath();
  const attachmentsAPI = getAttachmentData(filePath);

  try {
    const attachmentsAPI = getAttachmentData(filePath);

    const sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();
    sendSmtpEmail.sender = { email: MAIL_FROM, name: "Registros Score" };
    sendSmtpEmail.to = [{ email: MAIL_TO }];
    sendSmtpEmail.subject = "📊 Test API Registros Score (Brevo)";
    sendSmtpEmail.textContent = attachmentsAPI.length
      ? "Correo de prueba con CSV adjunto."
      : "Correo de prueba sin adjunto.";

    if (attachmentsAPI.length > 0) {
      sendSmtpEmail.attachment = attachmentsAPI;
    }

    await apiInstance.sendTransacEmail(sendSmtpEmail);


    res.json({ ok: true, message: "Mail enviado correctamente (Brevo)" });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.response?.text || err.message });
  }
});

// descargar csv manualmente desde la pagina 
app.get('/download/today', (req, res) => {
    // Aquí usamos la lógica que ya tienes para obtener el nombre del archivo del día
    const fileName = `logs_${new Date().toISOString().slice(0, 10)}.csv`;
    const filePath = path.join(__dirname, 'data', fileName);

    res.download(filePath, fileName, (err) => {
        if (err) {
            res.status(404).send("El archivo de hoy aún no ha sido creado.");
        }
    });
});
/* ========================================================
   5) Crear archivo nuevo a las 22:00 si no existe
   ======================================================== */
cron.schedule("0 22 * * *", () => {
  const filePath = getDailyFilePath();
  const header = "dni,score,registro\n";

  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, header, "utf8");
    console.log("Nuevo archivo diario iniciado.");
  }
});

/* ========================================================
   6) RUTA PRINCIPAL (HOME VISUAL)
   ======================================================== */
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});
app.get("/status", (req, res) => {
  const filePath = getDailyFilePath();

  let total = 0;
  let lastUpdate = null;

  if (fs.existsSync(filePath)) {
    const lines = fs.readFileSync(filePath, "utf8").trim().split(/\r?\n/);
    total = Math.max(lines.length - 1, 0);

    if (total > 0) {
      const mtime = fs.statSync(filePath).mtime;
      lastUpdate = new Date(mtime).toLocaleTimeString("es-AR", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        // ✅ Especificar la zona horaria de Buenos Aires (UTC-3)
        timeZone: "America/Argentina/Buenos_Aires"
      });
    }
  }

  res.json({
    api: "OK",
    registrosHoy: total,
    ultimaActualizacion: lastUpdate
  });
});

/* ========================================================
   7) INICIAR SERVIDOR
   ======================================================== */
const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`API corriendo en puerto ${PORT}`);
});
