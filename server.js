const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const mercadopago = require('mercadopago');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Configuración de Mercado Pago
mercadopago.configure({
  access_token: process.env.MERCADO_PAGO_ACCESS_TOKEN
});

// Conexión a SQLite
const db = new sqlite3.Database(process.env.DATABASE_URL || ':memory:');

// Crear tablas si no existen
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      nombre TEXT NOT NULL,
      password TEXT NOT NULL,
      plan TEXT DEFAULT 'GRATUITO',
      estado_pago TEXT DEFAULT 'no_pagado',
      fecha_registro DATETIME DEFAULT CURRENT_TIMESTAMP,
      activo BOOLEAN DEFAULT 1
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS hijos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER NOT NULL,
      nombre TEXT NOT NULL,
      apodo TEXT,
      fecha_nacimiento DATE,
      FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS pagos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER NOT NULL,
      plan TEXT NOT NULL,
      monto REAL NOT NULL,
      mercado_pago_id TEXT,
      estado TEXT DEFAULT 'pendiente',
      fecha_pago DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
    )
  `);
});

// Helper: verificar JWT
const verificarToken = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No autorizado' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'tu_super_secret_key');
    req.usuario_id = decoded.usuario_id;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Token inválido' });
  }
};

// ========== AUTENTICACIÓN ==========

// Registro
app.post('/api/auth/registro', (req, res) => {
  const { email, nombre, password, hijos } = req.body;

  if (!email || !nombre || !password) {
    return res.status(400).json({ error: 'Faltan datos' });
  }

  const hashedPassword = bcrypt.hashSync(password, 10);

  db.run(
    'INSERT INTO usuarios (email, nombre, password) VALUES (?, ?, ?)',
    [email, nombre, hashedPassword],
    function (err) {
      if (err) {
        return res.status(400).json({ error: 'Email ya registrado' });
      }

      const usuario_id = this.lastID;

      // Insertar hijos si existen
      if (hijos && Array.isArray(hijos)) {
        hijos.forEach(hijo => {
          db.run(
            'INSERT INTO hijos (usuario_id, nombre, apodo, fecha_nacimiento) VALUES (?, ?, ?, ?)',
            [usuario_id, hijo.nombre, hijo.apodo, hijo.fecha_nacimiento]
          );
        });
      }

      const token = jwt.sign(
        { usuario_id, email },
        process.env.JWT_SECRET || 'tu_super_secret_key',
        { expiresIn: '30d' }
      );

      res.status(201).json({
        mensaje: 'Usuario registrado',
        usuario_id,
        token
      });
    }
  );
});

// Login
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email y contraseña requeridos' });
  }

  db.get('SELECT * FROM usuarios WHERE email = ?', [email], (err, usuario) => {
    if (err || !usuario) {
      return res.status(401).json({ error: 'Usuario no encontrado' });
    }

    const passwordValido = bcrypt.compareSync(password, usuario.password);
    if (!passwordValido) {
      return res.status(401).json({ error: 'Contraseña incorrecta' });
    }

    const token = jwt.sign(
      { usuario_id: usuario.id, email: usuario.email },
      process.env.JWT_SECRET || 'tu_super_secret_key',
      { expiresIn: '30d' }
    );

    res.json({
      mensaje: 'Login exitoso',
      usuario_id: usuario.id,
      plan: usuario.plan,
      token
    });
  });
});

// ========== USUARIO ==========

// Obtener perfil
app.get('/api/usuario/perfil', verificarToken, (req, res) => {
  db.get(
    'SELECT id, email, nombre, plan, estado_pago, fecha_registro FROM usuarios WHERE id = ?',
    [req.usuario_id],
    (err, usuario) => {
      if (err || !usuario) {
        return res.status(404).json({ error: 'Usuario no encontrado' });
      }
      res.json(usuario);
    }
  );
});

// Obtener hijos del usuario
app.get('/api/usuario/hijos', verificarToken, (req, res) => {
  db.all(
    'SELECT * FROM hijos WHERE usuario_id = ?',
    [req.usuario_id],
    (err, hijos) => {
      if (err) {
        return res.status(500).json({ error: 'Error al obtener hijos' });
      }
      res.json(hijos);
    }
  );
});

// Crear hijo
app.post('/api/usuario/hijos', verificarToken, (req, res) => {
  const { nombre, apodo, fecha_nacimiento } = req.body;

  if (!nombre) {
    return res.status(400).json({ error: 'Nombre del hijo requerido' });
  }

  db.run(
    'INSERT INTO hijos (usuario_id, nombre, apodo, fecha_nacimiento) VALUES (?, ?, ?, ?)',
    [req.usuario_id, nombre, apodo, fecha_nacimiento],
    function (err) {
      if (err) {
        return res.status(500).json({ error: 'Error al crear hijo' });
      }
      res.status(201).json({
        mensaje: 'Hijo agregado',
        hijo_id: this.lastID
      });
    }
  );
});

// ========== MERCADO PAGO - CREAR PREFERENCIA DE PAGO ==========

app.post('/api/pagos/crear', verificarToken, (req, res) => {
  const { plan } = req.body;

  // Validar plan
  const planes = {
    'PLAN 1': 4.99,
    'PLAN 2': 9.99,
    'PLAN 3': 14.99,
    'PLAN 4': 19.99
  };

  if (!planes[plan]) {
    return res.status(400).json({ error: 'Plan inválido' });
  }

  const monto = planes[plan];

  // Crear preferencia de Mercado Pago
  const preference = {
    items: [
      {
        title: plan,
        quantity: 1,
        unit_price: monto
      }
    ],
    payer: {
      email: req.body.email || 'cliente@example.com'
    },
    back_urls: {
      success: 'https://memori.cl/?pago=exitoso',
      failure: 'https://memori.cl/?pago=fallido',
      pending: 'https://memori.cl/?pago=pendiente'
    },
    external_reference: `memori_${req.usuario_id}_${Date.now()}`,
    notification_url: 'https://memori-backend-1.onrender.com/api/pagos/webhook'
  };

  mercadopago.preferences.create(preference)
    .then(response => {
      // Guardar el pago en BD (pendiente)
      db.run(
        'INSERT INTO pagos (usuario_id, plan, monto, mercado_pago_id, estado) VALUES (?, ?, ?, ?, ?)',
        [req.usuario_id, plan, monto, response.body.id, 'pendiente'],
        (err) => {
          if (err) {
            return res.status(500).json({ error: 'Error al guardar pago' });
          }

          res.json({
            init_point: response.body.init_point, // URL para pagar
            preference_id: response.body.id
          });
        }
      );
    })
    .catch(err => {
      console.error('Error Mercado Pago:', err);
      res.status(500).json({ error: 'Error al crear pago' });
    });
});

// ========== WEBHOOK - CONFIRMACIÓN AUTOMÁTICA DE PAGO ==========

app.post('/api/pagos/webhook', (req, res) => {
  const { type, data } = req.body;

  // Solo procesar notificaciones de pago
  if (type !== 'payment') {
    return res.sendStatus(200);
  }

  // Obtener detalles del pago desde Mercado Pago
  mercadopago.payment.findById(data.id)
    .then(response => {
      const pago = response.body;
      const external_reference = pago.external_reference;

      // Validar que el pago fue aprobado
      if (pago.status !== 'approved') {
        return res.sendStatus(200);
      }

      // Parsear external_reference para obtener usuario_id
      const usuario_id = parseInt(external_reference.split('_')[1]);

      // Obtener el pago pendiente
      db.get(
        'SELECT * FROM pagos WHERE usuario_id = ? AND estado = ? ORDER BY fecha_pago DESC LIMIT 1',
        [usuario_id, 'pendiente'],
        (err, pagoPendiente) => {
          if (err || !pagoPendiente) {
            return res.sendStatus(200);
          }

          // Actualizar estado a confirmado
          db.run(
            'UPDATE pagos SET estado = ? WHERE id = ?',
            ['confirmado', pagoPendiente.id],
            () => {
              // Actualizar plan del usuario
              db.run(
                'UPDATE usuarios SET plan = ?, estado_pago = ? WHERE id = ?',
                [pagoPendiente.plan, 'pagado', usuario_id],
                () => {
                  console.log(`Pago confirmado para usuario ${usuario_id}`);
                  res.sendStatus(200);
                }
              );
            }
          );
        }
      );
    })
    .catch(err => {
      console.error('Error al procesar webhook:', err);
      res.sendStatus(500);
    });
});

// ========== ADMIN ==========

// Estadísticas
app.get('/api/admin/stats', (req, res) => {
  db.all('SELECT COUNT(*) as total FROM usuarios', (err, result) => {
    const totalUsuarios = result[0].total;

    db.all(
      "SELECT COUNT(*) as total FROM pagos WHERE estado = 'confirmado'",
      (err, result) => {
        const pagosConfirmados = result[0].total;

        db.all(
          "SELECT COUNT(*) as total FROM pagos WHERE estado = 'pendiente'",
          (err, result) => {
            const pagosPendientes = result[0].total;

            res.json({
              totalUsuarios,
              pagosConfirmados,
              pagosPendientes
            });
          }
        );
      }
    );
  });
});

// Lista de usuarios
app.get('/api/admin/usuarios', (req, res) => {
  db.all(
    `SELECT u.id, u.nombre, u.email, u.plan, u.estado_pago, u.fecha_registro, 
            COUNT(h.id) as cantidad_hijos 
     FROM usuarios u 
     LEFT JOIN hijos h ON u.id = h.usuario_id 
     GROUP BY u.id`,
    (err, usuarios) => {
      if (err) {
        return res.status(500).json({ error: 'Error al obtener usuarios' });
      }
      res.json(usuarios);
    }
  );
});

// Detalles de usuario
app.get('/api/admin/usuarios/:id', (req, res) => {
  const { id } = req.params;

  db.get('SELECT * FROM usuarios WHERE id = ?', [id], (err, usuario) => {
    if (err || !usuario) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    db.all('SELECT * FROM hijos WHERE usuario_id = ?', [id], (err, hijos) => {
      db.all('SELECT * FROM pagos WHERE usuario_id = ?', [id], (err, pagos) => {
        res.json({
          usuario,
          hijos,
          pagos
        });
      });
    });
  });
});

// ========== SALUD ==========

app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', mensaje: 'Backend funcionando' });
});

// Puerto
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
