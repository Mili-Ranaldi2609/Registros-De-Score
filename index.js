const express = require("express");
const fs = require("fs");
const path = require("path");
const nodemailer = require("nodemailer");
const cron = require("node-cron");
require("dotenv").config();
const app = express();
app.use(express.json());

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
const MAIL_TO   = process.env.MAIL_TO;

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: MAIL_USER,
    pass: MAIL_PASS
  }
});

// === Envío diario 22:00 ===
cron.schedule("0 22 * * *", async () => {
  console.log("Enviando mail diario...");

  const filePath = getDailyFilePath();

  if (!fs.existsSync(filePath)) {
    console.log("No hay archivo para enviar.");
    return;
  }

  try {
    await transporter.sendMail({
      from: MAIL_USER,
      to: MAIL_TO,
      subject: "Reporte diario de Score",
      text: "Adjunto CSV con registros de hoy.",
      attachments: [
        { filename: path.basename(filePath), path: filePath }
      ]
    });

    console.log("MAIL DIARIO ENVIADO ✔");
  } catch (err) {
    console.error("Error enviando mail:", err.message);
  }
});

// === Test de mail ===
app.get("/test-email", async (req, res) => {
  const filePath = getDailyFilePath();
  const attachments = fs.existsSync(filePath)
    ? [{ filename: path.basename(filePath), path: filePath }]
    : [];

  try {
    await transporter.sendMail({
      from: MAIL_USER,
      to: MAIL_TO,
      subject: "📊 Test API Registros Score",
      text: attachments.length
        ? "Este es un correo de prueba con el CSV de hoy."
        : "Correo de prueba: hoy aún no hay archivo.",
      attachments
    });

    res.json({ ok: true, message: "Mail enviado correctamente" });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* ========================================================
   5) Crear archivo nuevo a las 23:00 si no existe
   ======================================================== */
cron.schedule("0 23 * * *", () => {
  const filePath = getDailyFilePath();
  const header = "dni,score,registro\n";

  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, header, "utf8");
    console.log("Nuevo archivo diario iniciado.");
  }
});

/* ========================================================
   6) RUTA PRINCIPAL
   ======================================================== */
app.get("/", (req, res) => {
  res.send(`
    <h1>API Registros Score ✔️</h1>
    <p>Accesos útiles:</p>
    <ul>
      <li><a href="/dashboard">Dashboard</a></li>
      <li><a href="/logs/today">Ver JSON de hoy</a></li>
    </ul>
  `);
});

/* ========================================================
   7) INICIAR SERVIDOR
   ======================================================== */
const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`API corriendo en puerto ${PORT}`);
});
