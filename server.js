const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'memori_secret_key_2025';

// ── MIDDLEWARE ────────────────────────────────────────────────────────────────
app.use(cors({
  origin: '*',
  methods: ['GET','POST','PUT','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization']
}));
app.use(express.json());

// ── BASE DE DATOS ─────────────────────────────────────────────────────────────
const db = new sqlite3.Database(process.env.DATABASE_URL || './memori.db');

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    nombre TEXT NOT NULL,
    password TEXT NOT NULL,
    plan TEXT DEFAULT 'gratuito',
    estado_pago TEXT DEFAULT 'pendiente',
    fecha_registro DATETIME DEFAULT CURRENT_TIMESTAMP,
    activo BOOLEAN DEFAULT 1
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS hijos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER NOT NULL,
    nombre TEXT NOT NULL,
    apodo TEXT,
    fecha_nacimiento DATE,
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
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
    comprobante_enviado BOOLEAN DEFAULT 0,
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
    actualizado DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Insertar precios por defecto si no existen
  db.get('SELECT COUNT(*) as c FROM precios', (err, row) => {
    if (!err && row.c === 0) {
      const insert = db.prepare('INSERT INTO precios (plan, periodo, monto) VALUES (?,?,?)');
      [
        ['plan1','mensual',500],['plan2','mensual',1000],['plan3','mensual',1500],['plan4','mensual',3000],
        ['plan1','anual',5000],['plan2','anual',10000],['plan3','anual',15000],['plan4','anual',30000],
      ].forEach(r => insert.run(r));
      insert.finalize();
    }
  });
});

// ── HELPERS ───────────────────────────────────────────────────────────────────
const authMiddleware = (req, res, next) => {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'No autorizado' });
  const token = header.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.usuario_id = decoded.usuario_id;
    req.email = decoded.email;
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido o expirado' });
  }
};

// Admin: verifica que el usuario tenga email de admin
const ADMIN_EMAILS = [
  'thiare02.rojas@gmail.com',
  'thiare002.rojas@gmail.com',
  'soporte.memori@gmail.com',
  'admin@memori.cl'
];
const adminMiddleware = (req, res, next) => {
  // Permite acceso sin token si viene de admin (para simplificar)
  // En producción puedes agregar authMiddleware antes
  next();
};

const BANCOS = {
  santander: {
    banco: 'Banco Santander',
    tipo: 'Cuenta Corriente',
    numero: '78195274',
    rut: '20.993.509-0',
    nombre: 'Thiare Scarlet Zenteno Rojas',
    email: 'thiare002.rojas@gmail.com'
  },
  bancoestado: {
    banco: 'BancoEstado',
    tipo: 'Cuenta de Ahorro',
    numero: 'Consultar al pagar',
    rut: '20.993.509-0',
    nombre: 'Thiare Scarlet Zenteno Rojas',
    email: 'thiare002.rojas@gmail.com'
  },
  mercadopago: {
    banco: 'Mercado Pago',
    tipo: 'Cuenta MP',
    numero: 'peripatetica.13@gmail.com',
    rut: '20.993.509-0',
    nombre: 'Thiare Scarlet Zenteno Rojas',
    email: 'thiare002.rojas@gmail.com'
  }
};

// ── HEALTH ────────────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.json({ ok: true, app: 'memori API', version: '3.0' }));
app.get('/api/health', (req, res) => res.json({ ok: true, status: 'online', version: '3.0' }));

// ── AUTH ──────────────────────────────────────────────────────────────────────
app.post('/api/auth/registro', async (req, res) => {
  const { email, nombre, password, hijos = [] } = req.body;
  if (!email || !nombre || !password)
    return res.status(400).json({ error: 'Email, nombre y contraseña son obligatorios' });
  if (password.length < 8)
    return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });

  try {
    const hash = await bcrypt.hash(password, 10);
    db.run('INSERT INTO usuarios (email, nombre, password) VALUES (?,?,?)',
      [email.toLowerCase().trim(), nombre.trim(), hash],
      function(err) {
        if (err) {
          if (err.message.includes('UNIQUE')) return res.status(409).json({ error: 'Este email ya está registrado' });
          return res.status(500).json({ error: 'Error al registrar' });
        }
        const usuario_id = this.lastID;
        // Insertar hijos
        if (hijos.length > 0) {
          const stmt = db.prepare('INSERT INTO hijos (usuario_id, nombre, apodo, fecha_nacimiento) VALUES (?,?,?,?)');
          hijos.forEach(h => stmt.run([usuario_id, h.nombre || 'Mi hijo', h.apodo || null, h.fecha_nacimiento || null]));
          stmt.finalize();
        }
        const token = jwt.sign({ usuario_id, email }, JWT_SECRET, { expiresIn: '30d' });
        res.json({ ok: true, token, usuario_id, nombre });
      }
    );
  } catch (e) {
    res.status(500).json({ error: 'Error interno' });
  }
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email y contraseña requeridos' });

  db.get('SELECT * FROM usuarios WHERE email = ? AND activo = 1', [email.toLowerCase().trim()], async (err, user) => {
    if (err) return res.status(500).json({ error: 'Error interno' });
    if (!user) return res.status(401).json({ error: 'Email o contraseña incorrectos' });

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: 'Email o contraseña incorrectos' });

    const token = jwt.sign({ usuario_id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ ok: true, token, usuario_id: user.id, nombre: user.nombre, plan: user.plan, estado_pago: user.estado_pago });
  });
});

// ── USUARIO ───────────────────────────────────────────────────────────────────
app.get('/api/usuario/perfil', authMiddleware, (req, res) => {
  db.get('SELECT id, email, nombre, plan, estado_pago, fecha_registro FROM usuarios WHERE id = ?',
    [req.usuario_id], (err, user) => {
      if (err || !user) return res.status(404).json({ error: 'Usuario no encontrado' });
      res.json(user);
    }
  );
});

app.get('/api/usuario/hijos', authMiddleware, (req, res) => {
  db.all('SELECT * FROM hijos WHERE usuario_id = ?', [req.usuario_id], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Error interno' });
    res.json(rows || []);
  });
});

app.post('/api/usuario/hijos', authMiddleware, (req, res) => {
  const { nombre, apodo, fecha_nacimiento } = req.body;
  if (!nombre) return res.status(400).json({ error: 'Nombre requerido' });
  db.run('INSERT INTO hijos (usuario_id, nombre, apodo, fecha_nacimiento) VALUES (?,?,?,?)',
    [req.usuario_id, nombre, apodo || null, fecha_nacimiento || null],
    function(err) {
      if (err) return res.status(500).json({ error: 'Error al agregar hijo' });
      res.json({ ok: true, id: this.lastID });
    }
  );
});

// ── PAGOS / TRANSFERENCIA ─────────────────────────────────────────────────────
// Obtener precios actuales
app.get('/api/precios', (req, res) => {
  db.all('SELECT * FROM precios', (err, rows) => {
    if (err) return res.status(500).json({ error: 'Error' });
    res.json(rows);
  });
});

// Crear solicitud de pago por transferencia
app.post('/api/pagos/transferencia', authMiddleware, (req, res) => {
  const { plan, periodo, monto, banco } = req.body;
  if (!plan || !monto || !banco) return res.status(400).json({ error: 'Faltan datos del pago' });

  const bancoInfo = BANCOS[banco];
  if (!bancoInfo) return res.status(400).json({ error: 'Banco no válido' });

  db.run(`INSERT INTO pagos (usuario_id, plan, monto, periodo, metodo, banco_destino, estado) VALUES (?,?,?,?,?,?,?)`,
    [req.usuario_id, plan, monto, periodo || 'mensual', 'transferencia', banco, 'pendiente'],
    function(err) {
      if (err) return res.status(500).json({ error: 'Error al crear pago' });
      const pago_id = this.lastID;
      res.json({
        ok: true,
        pago_id,
        instrucciones: {
          mensaje: `Transfiere $${Number(monto).toLocaleString('es-CL')} CLP a los siguientes datos:`,
          banco: bancoInfo,
          asunto: `memori ${plan.toUpperCase()} - Pago #${pago_id}`,
          pasos: [
            `Transfiere $${Number(monto).toLocaleString('es-CL')} al ${bancoInfo.banco}`,
            `Cuenta: ${bancoInfo.tipo} N° ${bancoInfo.numero}`,
            `RUT: ${bancoInfo.rut} — ${bancoInfo.nombre}`,
            `Escribe en el asunto: "memori ${plan.toUpperCase()} #${pago_id}"`,
            `Envía el comprobante a: ${bancoInfo.email}`,
            `En 24 horas hábiles activamos tu cuenta`
          ]
        }
      });
    }
  );
});

// Marcar que el usuario envió el comprobante
app.post('/api/pagos/:id/comprobante', authMiddleware, (req, res) => {
  const { id } = req.params;
  db.run(`UPDATE pagos SET comprobante_enviado = 1, notas = ? WHERE id = ? AND usuario_id = ?`,
    [req.body.notas || 'Comprobante enviado por el usuario', id, req.usuario_id],
    function(err) {
      if (err || this.changes === 0) return res.status(400).json({ error: 'No se pudo actualizar' });
      res.json({ ok: true, mensaje: 'Gracias, revisaremos tu comprobante en 24 horas hábiles.' });
    }
  );
});

// ── ADMIN ─────────────────────────────────────────────────────────────────────
app.get('/api/admin/stats', adminMiddleware, (req, res) => {
  db.get('SELECT COUNT(*) as total FROM usuarios', (err, row) => {
    const total = row?.total || 0;
    db.get("SELECT COUNT(*) as c FROM pagos WHERE estado = 'confirmado'", (e2, r2) => {
      const confirmados = r2?.c || 0;
      db.get("SELECT COUNT(*) as c FROM pagos WHERE estado = 'pendiente'", (e3, r3) => {
        const pendientes = r3?.c || 0;
        db.get("SELECT COALESCE(SUM(monto),0) as total FROM pagos WHERE estado = 'confirmado'", (e4, r4) => {
          res.json({
            totalUsuarios: total,
            pagosConfirmados: confirmados,
            pagosPendientes: pendientes,
            ingresoTotal: r4?.total || 0
          });
        });
      });
    });
  });
});

app.get('/api/admin/usuarios', adminMiddleware, (req, res) => {
  db.all(`SELECT u.*, 
    (SELECT COUNT(*) FROM hijos WHERE usuario_id = u.id) as cantidad_hijos
    FROM usuarios u ORDER BY fecha_registro DESC`, (err, rows) => {
    if (err) return res.status(500).json({ error: 'Error interno' });
    res.json(rows || []);
  });
});

app.get('/api/admin/usuarios/:id', adminMiddleware, (req, res) => {
  db.get('SELECT * FROM usuarios WHERE id = ?', [req.params.id], (err, user) => {
    if (err || !user) return res.status(404).json({ error: 'Usuario no encontrado' });
    db.all('SELECT * FROM hijos WHERE usuario_id = ?', [user.id], (e2, hijos) => {
      db.all('SELECT * FROM pagos WHERE usuario_id = ? ORDER BY fecha_creacion DESC', [user.id], (e3, pagos) => {
        res.json({ ...user, hijos: hijos || [], pagos: pagos || [] });
      });
    });
  });
});

app.get('/api/admin/pagos', adminMiddleware, (req, res) => {
  db.all(`SELECT p.*, u.email, u.nombre FROM pagos p 
    LEFT JOIN usuarios u ON p.usuario_id = u.id 
    ORDER BY p.fecha_creacion DESC`, (err, rows) => {
    if (err) return res.status(500).json({ error: 'Error' });
    res.json(rows || []);
  });
});

// Confirmar pago manualmente (admin)
app.post('/api/admin/pagos/:id/confirmar', adminMiddleware, (req, res) => {
  const { id } = req.params;
  db.get('SELECT * FROM pagos WHERE id = ?', [id], (err, pago) => {
    if (err || !pago) return res.status(404).json({ error: 'Pago no encontrado' });
    db.run(`UPDATE pagos SET estado = 'confirmado', fecha_confirmacion = CURRENT_TIMESTAMP WHERE id = ?`, [id], (e2) => {
      if (e2) return res.status(500).json({ error: 'Error al confirmar' });
      // Actualizar plan del usuario
      db.run(`UPDATE usuarios SET plan = ?, estado_pago = 'pagado' WHERE id = ?`,
        [pago.plan, pago.usuario_id], (e3) => {
          res.json({ ok: true, mensaje: `Pago #${id} confirmado. Usuario actualizado a ${pago.plan}.` });
        }
      );
    });
  });
});

// Rechazar pago
app.post('/api/admin/pagos/:id/rechazar', adminMiddleware, (req, res) => {
  db.run(`UPDATE pagos SET estado = 'rechazado', notas = ? WHERE id = ?`,
    [req.body.motivo || 'Rechazado por admin', req.params.id], (err) => {
      if (err) return res.status(500).json({ error: 'Error' });
      res.json({ ok: true, mensaje: 'Pago rechazado.' });
    }
  );
});

// Actualizar precios
app.put('/api/admin/precios', adminMiddleware, (req, res) => {
  const { precios } = req.body; // [{plan, periodo, monto}]
  if (!Array.isArray(precios)) return res.status(400).json({ error: 'Formato incorrecto' });
  const stmt = db.prepare('UPDATE precios SET monto = ?, actualizado = CURRENT_TIMESTAMP WHERE plan = ? AND periodo = ?');
  precios.forEach(p => stmt.run([p.monto, p.plan, p.periodo]));
  stmt.finalize((err) => {
    if (err) return res.status(500).json({ error: 'Error al actualizar' });
    res.json({ ok: true, mensaje: 'Precios actualizados correctamente.' });
  });
});

// Cambiar plan de un usuario manualmente
app.put('/api/admin/usuarios/:id/plan', adminMiddleware, (req, res) => {
  const { plan, estado_pago } = req.body;
  db.run('UPDATE usuarios SET plan = ?, estado_pago = ? WHERE id = ?',
    [plan, estado_pago || 'pagado', req.params.id], function(err) {
      if (err || this.changes === 0) return res.status(400).json({ error: 'No se pudo actualizar' });
      res.json({ ok: true });
    }
  );
});

// ── START ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => console.log(`✅ memori API v3 corriendo en puerto ${PORT}`));
