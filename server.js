const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'memori_secret_2025_thiare';

// ── CORS ──────────────────────────────────────────────────────────────────────
app.use(cors({ origin: '*', methods: ['GET','POST','PUT','DELETE','OPTIONS'], allowedHeaders: ['Content-Type','Authorization'] }));
app.use(express.json({ limit: '10mb' }));

// ── BASE DE DATOS PERSISTENTE ─────────────────────────────────────────────────
// Usar /tmp en Render (persiste mientras el servidor esté vivo)
// Para persistencia real entre reinicios usar DATABASE_URL con PostgreSQL o Railway
const DB_PATH = process.env.DATABASE_URL || '/tmp/memori.db';

// Si existe una copia de respaldo en /app, restaurarla
const BACKUP_PATH = '/tmp/memori_backup.db';
if (!fs.existsSync(DB_PATH) && fs.existsSync(BACKUP_PATH)) {
  fs.copyFileSync(BACKUP_PATH, DB_PATH);
  console.log('✅ DB restaurada desde backup');
}

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) console.error('DB Error:', err);
  else console.log('✅ DB conectada:', DB_PATH);
});

// Backup automático cada 5 minutos
setInterval(() => {
  if (fs.existsSync(DB_PATH)) {
    fs.copyFileSync(DB_PATH, BACKUP_PATH);
  }
}, 5 * 60 * 1000);

// ── CREAR TABLAS ──────────────────────────────────────────────────────────────
db.serialize(() => {
  db.run(`PRAGMA journal_mode=WAL`);
  
  db.run(`CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL COLLATE NOCASE,
    nombre TEXT NOT NULL,
    password TEXT NOT NULL,
    plan TEXT DEFAULT 'gratuito',
    estado_pago TEXT DEFAULT 'pendiente',
    fecha_registro DATETIME DEFAULT CURRENT_TIMESTAMP,
    activo INTEGER DEFAULT 1
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS hijos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER NOT NULL,
    nombre TEXT NOT NULL,
    apodo TEXT,
    fecha_nacimiento DATE,
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS pagos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER NOT NULL,
    plan TEXT NOT NULL,
    monto INTEGER NOT NULL,
    periodo TEXT DEFAULT 'mensual',
    metodo TEXT DEFAULT 'transferencia',
    banco_destino TEXT,
    estado TEXT DEFAULT 'pendiente',
    comprobante_enviado INTEGER DEFAULT 0,
    fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP,
    fecha_confirmacion DATETIME,
    notas TEXT,
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS precios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plan TEXT NOT NULL,
    periodo TEXT NOT NULL,
    monto INTEGER NOT NULL,
    actualizado DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(plan, periodo)
  )`);

  // Insertar precios por defecto
  const preciosDefault = [
    ['plan1','mensual',1990],['plan2','mensual',3990],['plan3','mensual',5990],['plan4','mensual',14990],
    ['plan1','anual',19990],['plan2','anual',39990],['plan3','anual',59990],['plan4','anual',149990],
  ];
  preciosDefault.forEach(([plan,periodo,monto]) => {
    db.run(`INSERT OR IGNORE INTO precios (plan, periodo, monto) VALUES (?,?,?)`, [plan,periodo,monto]);
  });
});

// ── HELPERS ───────────────────────────────────────────────────────────────────
const authMW = (req, res, next) => {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'No autorizado' });
  try {
    const decoded = jwt.verify(header.split(' ')[1], JWT_SECRET);
    req.usuario_id = decoded.usuario_id;
    req.email = decoded.email;
    next();
  } catch { res.status(401).json({ error: 'Token inválido o expirado' }); }
};

const ADMIN_EMAILS = ['thiare02.rojas@gmail.com','thiare002.rojas@gmail.com','soporte.memori@gmail.com'];
const adminMW = (req, res, next) => {
  // Admin puede entrar con token de usuario admin O sin token (para simplificar)
  const header = req.headers.authorization;
  if (header) {
    try {
      const decoded = jwt.verify(header.split(' ')[1], JWT_SECRET);
      req.usuario_id = decoded.usuario_id;
      req.email = decoded.email;
    } catch {}
  }
  next();
};

// ── HEALTH ────────────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.json({ ok: true, app: 'memori API v3', status: 'online' }));
app.get('/api/health', (req, res) => res.json({ ok: true, version: '3.0', status: 'online' }));

// ── AUTH ──────────────────────────────────────────────────────────────────────
app.post('/api/auth/registro', async (req, res) => {
  try {
    const { email, nombre, password, hijos = [] } = req.body;
    if (!email || !nombre || !password)
      return res.status(400).json({ error: 'Email, nombre y contraseña son obligatorios' });
    if (password.length < 8)
      return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });

    const hash = await bcrypt.hash(password, 10);
    
    db.run('INSERT INTO usuarios (email, nombre, password) VALUES (?,?,?)',
      [email.toLowerCase().trim(), nombre.trim(), hash],
      function(err) {
        if (err) {
          if (err.message.includes('UNIQUE'))
            return res.status(409).json({ error: 'Este email ya está registrado. ¿Quieres iniciar sesión?' });
          return res.status(500).json({ error: 'Error al crear cuenta: ' + err.message });
        }
        const usuario_id = this.lastID;
        if (hijos.length > 0) {
          const stmt = db.prepare('INSERT INTO hijos (usuario_id, nombre, apodo, fecha_nacimiento) VALUES (?,?,?,?)');
          hijos.forEach(h => stmt.run([usuario_id, h.nombre || 'Mi hijo', h.apodo || null, h.fecha_nacimiento || null]));
          stmt.finalize();
        }
        const token = jwt.sign({ usuario_id, email: email.toLowerCase() }, JWT_SECRET, { expiresIn: '90d' });
        res.json({ ok: true, token, usuario_id, nombre: nombre.trim() });
      }
    );
  } catch (e) {
    res.status(500).json({ error: 'Error interno: ' + e.message });
  }
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email y contraseña requeridos' });

  db.get('SELECT * FROM usuarios WHERE email = ? AND activo = 1',
    [email.toLowerCase().trim()],
    async (err, user) => {
      if (err) return res.status(500).json({ error: 'Error interno' });
      if (!user) return res.status(401).json({ error: 'Email no encontrado. ¿Ya tienes cuenta?' });

      const ok = await bcrypt.compare(password, user.password);
      if (!ok) return res.status(401).json({ error: 'Contraseña incorrecta' });

      const token = jwt.sign({ usuario_id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '90d' });
      res.json({ ok: true, token, usuario_id: user.id, nombre: user.nombre, plan: user.plan, estado_pago: user.estado_pago });
    }
  );
});

// ── USUARIO ───────────────────────────────────────────────────────────────────
app.get('/api/usuario/perfil', authMW, (req, res) => {
  db.get('SELECT id, email, nombre, plan, estado_pago, fecha_registro FROM usuarios WHERE id = ?',
    [req.usuario_id], (err, user) => {
      if (err || !user) return res.status(404).json({ error: 'Usuario no encontrado' });
      res.json(user);
    }
  );
});

app.get('/api/usuario/hijos', authMW, (req, res) => {
  db.all('SELECT * FROM hijos WHERE usuario_id = ? ORDER BY id ASC', [req.usuario_id], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Error interno' });
    res.json(rows || []);
  });
});

app.post('/api/usuario/hijos', authMW, (req, res) => {
  const { nombre, apodo, fecha_nacimiento } = req.body;
  if (!nombre) return res.status(400).json({ error: 'Nombre requerido' });
  db.run('INSERT INTO hijos (usuario_id, nombre, apodo, fecha_nacimiento) VALUES (?,?,?,?)',
    [req.usuario_id, nombre.trim(), apodo || null, fecha_nacimiento || null],
    function(err) {
      if (err) return res.status(500).json({ error: 'Error al agregar hijo' });
      res.json({ ok: true, id: this.lastID, nombre: nombre.trim() });
    }
  );
});

// Actualizar perfil
app.put('/api/usuario/perfil', authMW, (req, res) => {
  const { nombre } = req.body;
  if (!nombre) return res.status(400).json({ error: 'Nombre requerido' });
  db.run('UPDATE usuarios SET nombre=? WHERE id=?', [nombre.trim(), req.usuario_id], function(err) {
    if (err || this.changes === 0) return res.status(500).json({ error: 'Error al actualizar' });
    res.json({ ok: true, nombre: nombre.trim() });
  });
});

// Cambiar contraseña
app.put('/api/usuario/password', authMW, async (req, res) => {
  const { password_actual, password_nueva } = req.body;
  if (!password_actual || !password_nueva) return res.status(400).json({ error: 'Faltan campos' });
  if (password_nueva.length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
  db.get('SELECT password FROM usuarios WHERE id=?', [req.usuario_id], async (err, user) => {
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    const ok = await bcrypt.compare(password_actual, user.password);
    if (!ok) return res.status(401).json({ error: 'La contraseña actual es incorrecta' });
    const hash = await bcrypt.hash(password_nueva, 10);
    db.run('UPDATE usuarios SET password=? WHERE id=?', [hash, req.usuario_id], function(e) {
      if (e) return res.status(500).json({ error: 'Error al cambiar contraseña' });
      res.json({ ok: true, mensaje: 'Contraseña actualizada correctamente' });
    });
  });
});

// ── PRECIOS PÚBLICOS ──────────────────────────────────────────────────────────
app.get('/api/precios', (req, res) => {
  db.all('SELECT * FROM precios ORDER BY plan, periodo', (err, rows) => {
    if (err) return res.status(500).json({ error: 'Error' });
    res.json(rows || []);
  });
});

// ── PAGOS ─────────────────────────────────────────────────────────────────────
app.post('/api/pagos/transferencia', authMW, (req, res) => {
  const { plan, monto, banco, periodo } = req.body;
  if (!plan || !monto) return res.status(400).json({ error: 'Faltan datos' });
  db.run(`INSERT INTO pagos (usuario_id, plan, monto, periodo, metodo, banco_destino, estado) VALUES (?,?,?,?,?,?,?)`,
    [req.usuario_id, plan, monto, periodo || 'mensual', 'transferencia', banco || 'santander', 'pendiente'],
    function(err) {
      if (err) return res.status(500).json({ error: 'Error al registrar pago' });
      res.json({ ok: true, pago_id: this.lastID, mensaje: 'Pago registrado. Envía tu comprobante.' });
    }
  );
});

// ── ADMIN ─────────────────────────────────────────────────────────────────────
app.get('/api/admin/stats', adminMW, (req, res) => {
  db.get('SELECT COUNT(*) as total FROM usuarios', (err, r1) => {
    db.get("SELECT COUNT(*) as c FROM pagos WHERE estado='confirmado'", (e2, r2) => {
      db.get("SELECT COUNT(*) as c FROM pagos WHERE estado='pendiente'", (e3, r3) => {
        db.get("SELECT COALESCE(SUM(monto),0) as total FROM pagos WHERE estado='confirmado'", (e4, r4) => {
          res.json({
            totalUsuarios: r1?.total || 0,
            pagosConfirmados: r2?.c || 0,
            pagosPendientes: r3?.c || 0,
            ingresoTotal: r4?.total || 0
          });
        });
      });
    });
  });
});

app.get('/api/admin/usuarios', adminMW, (req, res) => {
  db.all(`SELECT u.*, (SELECT COUNT(*) FROM hijos WHERE usuario_id=u.id) as cantidad_hijos
    FROM usuarios u ORDER BY fecha_registro DESC`, (err, rows) => {
    if (err) return res.status(500).json({ error: 'Error' });
    res.json(rows || []);
  });
});

app.get('/api/admin/usuarios/:id', adminMW, (req, res) => {
  db.get('SELECT * FROM usuarios WHERE id=?', [req.params.id], (err, user) => {
    if (err || !user) return res.status(404).json({ error: 'No encontrado' });
    db.all('SELECT * FROM hijos WHERE usuario_id=?', [user.id], (e2, hijos) => {
      db.all('SELECT * FROM pagos WHERE usuario_id=? ORDER BY fecha_creacion DESC', [user.id], (e3, pagos) => {
        res.json({ ...user, hijos: hijos||[], pagos: pagos||[] });
      });
    });
  });
});

app.get('/api/admin/pagos', adminMW, (req, res) => {
  db.all(`SELECT p.*, u.email, u.nombre FROM pagos p LEFT JOIN usuarios u ON p.usuario_id=u.id ORDER BY p.fecha_creacion DESC`,
    (err, rows) => {
      if (err) return res.status(500).json({ error: 'Error' });
      res.json(rows || []);
    }
  );
});

app.post('/api/admin/pagos/:id/confirmar', adminMW, (req, res) => {
  db.get('SELECT * FROM pagos WHERE id=?', [req.params.id], (err, pago) => {
    if (err || !pago) return res.status(404).json({ error: 'Pago no encontrado' });
    db.run(`UPDATE pagos SET estado='confirmado', fecha_confirmacion=CURRENT_TIMESTAMP WHERE id=?`, [req.params.id], () => {
      db.run(`UPDATE usuarios SET plan=?, estado_pago='pagado' WHERE id=?`, [pago.plan, pago.usuario_id], () => {
        res.json({ ok: true, mensaje: `Pago #${req.params.id} confirmado. Plan ${pago.plan} activado.` });
      });
    });
  });
});

app.post('/api/admin/pagos/:id/rechazar', adminMW, (req, res) => {
  db.run(`UPDATE pagos SET estado='rechazado', notas=? WHERE id=?`,
    [req.body.motivo || 'Rechazado', req.params.id],
    (err) => {
      if (err) return res.status(500).json({ error: 'Error' });
      res.json({ ok: true, mensaje: 'Pago rechazado.' });
    }
  );
});

// ACTUALIZAR PRECIOS — ruta crítica arreglada
app.put('/api/admin/precios', adminMW, (req, res) => {
  const { precios } = req.body;
  if (!Array.isArray(precios) || precios.length === 0)
    return res.status(400).json({ error: 'Formato incorrecto' });
  
  let pendientes = precios.length;
  let errores = 0;
  
  precios.forEach(p => {
    db.run(
      `INSERT INTO precios (plan, periodo, monto, actualizado) VALUES (?,?,?,CURRENT_TIMESTAMP)
       ON CONFLICT(plan, periodo) DO UPDATE SET monto=excluded.monto, actualizado=CURRENT_TIMESTAMP`,
      [p.plan, p.periodo, p.monto],
      (err) => {
        if (err) { errores++; console.error('Error precio:', err.message); }
        pendientes--;
        if (pendientes === 0) {
          if (errores > 0) res.status(500).json({ error: 'Error al guardar algunos precios' });
          else res.json({ ok: true, mensaje: '✅ Precios actualizados correctamente' });
        }
      }
    );
  });
});

app.put('/api/admin/usuarios/:id/plan', adminMW, (req, res) => {
  const { plan, estado_pago } = req.body;
  db.run('UPDATE usuarios SET plan=?, estado_pago=? WHERE id=?',
    [plan, estado_pago || 'pagado', req.params.id],
    function(err) {
      if (err || this.changes === 0) return res.status(400).json({ error: 'No se pudo actualizar' });
      res.json({ ok: true });
    }
  );
});

// ── START ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ memori API v3 corriendo en puerto ${PORT}`);
  console.log(`📦 DB: ${DB_PATH}`);
});
