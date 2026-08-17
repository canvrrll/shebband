require("dotenv").config();

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const helmet = require("helmet");
const morgan = require("morgan");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET = process.env.JWT_SECRET || "sheband-development-secret";

const DATA_DIR = path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "users.json");

fs.mkdirSync(DATA_DIR, { recursive: true });

if (!fs.existsSync(DB_FILE)) {
  fs.writeFileSync(
    DB_FILE,
    JSON.stringify(
      {
        users: [],
        contacts: [],
        posts: [],
        messages: [],
        emergencyAlerts: []
      },
      null,
      2
    )
  );
}

function readDB() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  } catch {
    return {
      users: [],
      contacts: [],
      posts: [],
      messages: [],
      emergencyAlerts: []
    };
  }
}

function writeDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

app.use(helmet({ contentSecurityPolicy: false }));
app.use(morgan("tiny"));
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());

function createToken(user) {
  return jwt.sign(
    {
      id: user.id,
      username: user.username
    },
    SECRET,
    {
      expiresIn: "30d"
    }
  );
}

function setSession(res, user) {
  res.cookie("sheband_session", createToken(user), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 30 * 24 * 60 * 60 * 1000
  });
}

function auth(req, res, next) {
  try {
    const token = req.cookies.sheband_session;

    if (!token) {
      return res.status(401).json({
        error: "Sesión requerida."
      });
    }

    req.user = jwt.verify(token, SECRET);
    next();
  } catch {
    res.status(401).json({
      error: "Sesión inválida."
    });
  }
}

function validUsername(username) {
  return /^[A-Za-z0-9_]{3,24}$/.test(username);
}

/* HEALTH */

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "SHEBAND"
  });
});

/* AUTH */

app.post("/api/register", async (req, res) => {
  try {
    const username = String(req.body?.username || "").trim();
    const password = String(req.body?.password || "");

    if (!validUsername(username)) {
      return res.status(400).json({
        error:
          "El usuario debe tener entre 3 y 24 caracteres y solo puede usar letras, números o _."
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        error: "La contraseña debe tener al menos 6 caracteres."
      });
    }

    const db = readDB();

    const exists = db.users.some(
      user => user.username.toLowerCase() === username.toLowerCase()
    );

    if (exists) {
      return res.status(409).json({
        error: "Ese nombre de usuario ya está ocupado."
      });
    }

    const user = {
      id: crypto.randomUUID(),
      username,
      passwordHash: await bcrypt.hash(password, 12),
      privateAccount: true,
      bio: "",
      avatarUrl: "",
      createdAt: new Date().toISOString()
    };

    db.users.push(user);
    writeDB(db);

    setSession(res, user);

    res.json({
      ok: true,
      user: {
        id: user.id,
        username: user.username,
        privateAccount: user.privateAccount,
        bio: user.bio,
        avatarUrl: user.avatarUrl
      }
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "No se pudo crear la cuenta."
    });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const username = String(req.body?.username || "").trim();
    const password = String(req.body?.password || "");

    const db = readDB();

    const user = db.users.find(
      item => item.username.toLowerCase() === username.toLowerCase()
    );

    if (!user) {
      return res.status(401).json({
        error: "Usuario o contraseña incorrectos."
      });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);

    if (!valid) {
      return res.status(401).json({
        error: "Usuario o contraseña incorrectos."
      });
    }

    setSession(res, user);

    res.json({
      ok: true,
      user: {
        id: user.id,
        username: user.username,
        privateAccount: user.privateAccount,
        bio: user.bio,
        avatarUrl: user.avatarUrl
      }
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "No se pudo iniciar sesión."
    });
  }
});

app.get("/api/me", auth, (req, res) => {
  const db = readDB();

  const user = db.users.find(item => item.id === req.user.id);

  if (!user) {
    return res.status(404).json({
      error: "Usuario no encontrado."
    });
  }

  res.json({
    authenticated: true,
    user: {
      id: user.id,
      username: user.username,
      privateAccount: user.privateAccount,
      bio: user.bio,
      avatarUrl: user.avatarUrl
    }
  });
});

app.post("/api/logout", (_req, res) => {
  res.clearCookie("sheband_session");

  res.json({
    ok: true
  });
});

/* PROFILE */

app.patch("/api/profile", auth, (req, res) => {
  const db = readDB();

  const user = db.users.find(item => item.id === req.user.id);

  if (!user) {
    return res.status(404).json({
      error: "Usuario no encontrado."
    });
  }

  if (typeof req.body?.bio === "string") {
    user.bio = req.body.bio.slice(0, 500);
  }

  if (typeof req.body?.privateAccount === "boolean") {
    user.privateAccount = req.body.privateAccount;
  }

  if (typeof req.body?.avatarUrl === "string") {
    user.avatarUrl = req.body.avatarUrl;
  }

  writeDB(db);

  res.json({
    ok: true,
    user: {
      id: user.id,
      username: user.username,
      privateAccount: user.privateAccount,
      bio: user.bio,
      avatarUrl: user.avatarUrl
    }
  });
});

/* CONTACTS */

app.get("/api/contacts", auth, (req, res) => {
  const db = readDB();

  const contacts = db.contacts.filter(
    contact => contact.ownerId === req.user.id
  );

  res.json(contacts);
});

app.post("/api/contacts", auth, (req, res) => {
  const name = String(req.body?.name || "").trim();
  const phone = String(req.body?.phone || "").trim();
  const deviceLabel =
    String(req.body?.deviceLabel || "").trim() || "SMS";

  if (!name) {
    return res.status(400).json({
      error: "El nombre es obligatorio."
    });
  }

  const db = readDB();

  const contact = {
    id: crypto.randomUUID(),
    ownerId: req.user.id,
    name,
    phone,
    deviceLabel,
    notifyEmergency: true,
    createdAt: new Date().toISOString()
  };

  db.contacts.push(contact);
  writeDB(db);

  res.json({
    ok: true,
    contact
  });
});

app.delete("/api/contacts/:id", auth, (req, res) => {
  const db = readDB();

  db.contacts = db.contacts.filter(
    contact =>
      !(
        contact.id === req.params.id &&
        contact.ownerId === req.user.id
      )
  );

  writeDB(db);

  res.json({
    ok: true
  });
});

/* POSTS */

app.get("/api/posts", auth, (req, res) => {
  const db = readDB();

  const posts = db.posts
    .filter(post => {
      if (post.userId === req.user.id) return true;

      const owner = db.users.find(user => user.id === post.userId);

      return owner && owner.privateAccount === false;
    })
    .sort(
      (a, b) =>
        new Date(b.createdAt) - new Date(a.createdAt)
    );

  res.json(posts);
});

app.post("/api/posts", auth, (req, res) => {
  const caption = String(req.body?.caption || "").trim();
  const imageUrl = String(req.body?.imageUrl || "").trim();

  if (!caption && !imageUrl) {
    return res.status(400).json({
      error: "La publicación está vacía."
    });
  }

  const db = readDB();

  const post = {
    id: crypto.randomUUID(),
    userId: req.user.id,
    username: req.user.username,
    caption,
    imageUrl,
    createdAt: new Date().toISOString()
  };

  db.posts.push(post);
  writeDB(db);

  res.json({
    ok: true,
    post
  });
});

/* MESSAGES */

app.get("/api/messages", auth, (req, res) => {
  const db = readDB();

  const messages = db.messages.filter(
    message => message.userId === req.user.id
  );

  res.json(messages);
});

app.post("/api/messages", auth, (req, res) => {
  const body = String(req.body?.body || "").trim();

  if (!body) {
    return res.status(400).json({
      error: "El mensaje está vacío."
    });
  }

  const db = readDB();

  const message = {
    id: crypto.randomUUID(),
    userId: req.user.id,
    username: req.user.username,
    body: body.slice(0, 2000),
    createdAt: new Date().toISOString()
  };

  db.messages.push(message);
  writeDB(db);

  res.json({
    ok: true,
    message
  });
});

/* EMERGENCY */

app.post("/api/emergency", auth, (req, res) => {
  const latitude =
    Number.isFinite(Number(req.body?.latitude))
      ? Number(req.body.latitude)
      : null;

  const longitude =
    Number.isFinite(Number(req.body?.longitude))
      ? Number(req.body.longitude)
      : null;

  const accuracy =
    Number.isFinite(Number(req.body?.accuracy))
      ? Number(req.body.accuracy)
      : null;

  const db = readDB();

  const contacts = db.contacts.filter(
    contact =>
      contact.ownerId === req.user.id &&
      contact.notifyEmergency
  );

  const alert = {
    id: crypto.randomUUID(),
    userId: req.user.id,
    username: req.user.username,
    latitude,
    longitude,
    accuracy,
    contacts: contacts.map(contact => ({
      name: contact.name,
      phone: contact.phone,
      deviceLabel: contact.deviceLabel
    })),
    createdAt: new Date().toISOString(),
    status: "created"
  };

  db.emergencyAlerts.push(alert);
  writeDB(db);

  res.json({
    ok: true,
    alertId: alert.id,
    time: alert.createdAt,
    latitude,
    longitude,
    accuracy,
    contacts: alert.contacts
  });
});

/* STATIC SITE */

app.use(express.static(__dirname));

app.get("/{*splat}", (_req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});



app.listen(PORT, () => {
  console.log(`SHEBAND funcionando en puerto ${PORT}`);
});
