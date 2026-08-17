require("dotenv").config();
const path = require("path");
const express = require("express");
const helmet = require("helmet");
const morgan = require("morgan");
const { createClient } = require("@supabase/supabase-js");
const twilio = require("twilio");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet({ contentSecurityPolicy: false }));
app.use(morgan("tiny"));
app.use(express.json({ limit: "1mb" }));

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const admin = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
  : null;

app.get("/api/config", (_req, res) => {
  res.json({
    supabaseUrl: SUPABASE_URL || "",
    supabaseAnonKey: SUPABASE_ANON_KEY || "",
    configured: Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_SERVICE_ROLE_KEY),
    messagingConfigured: Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && (process.env.TWILIO_MESSAGING_SERVICE_SID || process.env.TWILIO_FROM))
  });
});

async function requireUser(req, res, next) {
  if (!admin) return res.status(503).json({ error: "Backend sin configurar. Falta Supabase en las variables de entorno." });
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return res.status(401).json({ error: "Sesión requerida." });
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) return res.status(401).json({ error: "Sesión inválida." });
  req.user = data.user;
  next();
}

function cleanPhone(value) {
  if (!value) return null;
  const p = String(value).trim();
  return /^\+[1-9]\d{7,14}$/.test(p) ? p : null;
}

async function sendEmergencySms(alert, contacts) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const serviceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
  const from = process.env.TWILIO_FROM;
  if (!sid || !token || (!serviceSid && !from)) {
    return { configured: false, sent: [], failed: [] };
  }
  const client = twilio(sid, token);
  const map = new Map();
  const body = [
    "🚨 SHEBAND — ALERTA DE EMERGENCIA",
    `Usuario: ${alert.user_name || "Contacto SHEBAND"}`,
    `Hora: ${new Date(alert.created_at).toLocaleString("es-AR")}`,
    alert.latitude != null && alert.longitude != null
      ? `Ubicación: https://www.google.com/maps?q=${alert.latitude},${alert.longitude}`
      : "Ubicación: no disponible"
  ].join("\n");
  const sent = [], failed = [];
  for (const c of contacts) {
    const to = cleanPhone(c.phone);
    if (!to || map.has(to)) continue;
    map.set(to, true);
    try {
      const msg = await client.messages.create({
        body,
        to,
        ...(serviceSid ? { messagingServiceSid: serviceSid } : { from })
      });
      sent.push({ id: c.id, phone: to, sid: msg.sid });
    } catch (e) {
      failed.push({ id: c.id, phone: to, error: e.message });
    }
  }
  return { configured: true, sent, failed };
}

app.post("/api/emergency", requireUser, async (req, res) => {
  const { latitude, longitude, accuracy, capturedAt, deviceLabel } = req.body || {};
  const lat = Number.isFinite(Number(latitude)) ? Number(latitude) : null;
  const lng = Number.isFinite(Number(longitude)) ? Number(longitude) : null;
  const acc = Number.isFinite(Number(accuracy)) ? Number(accuracy) : null;

  const { data: profile } = await admin.from("profiles").select("display_name, private_account").eq("id", req.user.id).maybeSingle();
  const { data: contacts, error: cErr } = await admin
    .from("contacts")
    .select("id,name,phone,notify_emergency,device_label")
    .eq("owner_id", req.user.id)
    .eq("notify_emergency", true);

  if (cErr) return res.status(500).json({ error: cErr.message });

  const alert = {
    user_id: req.user.id,
    user_name: profile?.display_name || req.user.user_metadata?.name || "Usuario SHEBAND",
    latitude: lat,
    longitude: lng,
    accuracy_m: acc,
    created_at: capturedAt || new Date().toISOString(),
    device_label: deviceLabel || "Dispositivo SHEBAND",
    status: "created"
  };

  const { data: saved, error: aErr } = await admin.from("emergency_alerts").insert(alert).select().single();
  if (aErr) return res.status(500).json({ error: aErr.message });

  const result = await sendEmergencySms(saved, contacts || []);
  const status = result.sent.length ? "notified" : "created";
  await admin.from("emergency_alerts").update({ status }).eq("id", saved.id);

  res.json({
    ok: true,
    alertId: saved.id,
    time: saved.created_at,
    latitude: saved.latitude,
    longitude: saved.longitude,
    accuracy: saved.accuracy_m,
    devices: (contacts || []).map(c => ({ name: c.name, device: c.device_label || "SMS", phone: c.phone })),
    messaging: result
  });

});

app.get("/{*splat}", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.listen(PORT, () => console.log(`SHEBAND listening on ${PORT}`));
