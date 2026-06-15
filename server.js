import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import sqlite3 from 'sqlite3';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'tu-secreto-super-seguro-cambiar-en-produccion';

// Middleware
app.use(cors());
app.use(express.json());

// ═══════════════════════════════════════════════════════════
// INICIALIZAR BASE DE DATOS
// ═══════════════════════════════════════════════════════════

const db = new sqlite3.Database('./memori.db', (err) => {
  if (err) console.error('Error conectando DB:', err);
  else console.log('✅ Base de datos SQLite conectada');
});

// Crear tablas si no existen
db.serialize(() => {
  // Tabla de usuarios (papás)
  db.run(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      nombre TEXT NOT NULL,
      password TEXT NOT NULL,
      plan TEXT DEFAULT 'gratuito',
      estado_pago TEXT DEFAULT 'pendiente',
      mercado_pago_id TEXT,
      fecha_registro DATETIME DEFAULT CURRENT_TIMESTAMP,
      fecha_expiracion DATETIME,
      activo INTEGER DEFAULT 1
    )
  `);

  // Tabla de hijos
  db.run(`
    CREATE TABLE IF NOT EXISTS hijos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER NOT NULL,
      nombre TEXT NOT NULL,
      edad INTEGER,
      fecha_nacimiento DATE,
      fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
    )
  `);

  // Tabla de pagos
  db.run(`
    CREATE TABLE IF NOT EXISTS pagos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER NOT NULL,
      plan TEXT NOT NULL,
      monto REAL NOT NULL,
      moneda TEXT DEFAULT 'CLP',
      mercado_pago_id TEXT UNIQUE,
      estado TEXT DEFAULT 'pendiente',
      fecha_pago DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
    )
  `);

  console.log('✅ Tablas creadas/verificadas');
});

// ═══════════════════════════════════════════════════════════
// FUNCIONES HELPER
// ═══════════════════════════════════════════════════════════

const generarToken = (usuarioId) => {
  return jwt.sign({ id: usuarioId }, JWT_SECRET, { expiresIn: '30d' });
};

const verificarToken = (token) => {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return null;
  }
};

const hashPassword = async (password) => {
  return await bcrypt.hash(password, 10);
};

const compararPassword = async (password, hash) => {
  return await bcrypt.compare(password, hash);
};

// Middleware para verificar autenticación
const autenticar = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'Token no proporcionado' });
  }

  const decoded = verificarToken(token);
  if (!decoded) {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }

  req.usuarioId = decoded.id;
  next();
};

// ═══════════════════════════════════════════════════════════
// RUTAS DE AUTENTICACIÓN
// ═══════════════════════════════════════════════════════════

// REGISTRO
app.post('/api/auth/registro', async (req, res) => {
  try {
    const { email, nombre, password, plan } = req.body;

    if (!email || !nombre || !password) {
      return res.status(400).json({ error: 'Faltan datos requeridos' });
    }

    // Verificar si el email ya existe
    db.get('SELECT id FROM usuarios WHERE email = ?', [email], async (err, usuario) => {
      if (usuario) {
        return res.status(400).json({ error: 'Este email ya está registrado' });
      }

      // Hashear password
      const passwordHash = await hashPassword(password);

      // Insertar usuario
      db.run(
        `INSERT INTO usuarios (email, nombre, password, plan) VALUES (?, ?, ?, ?)`,
        [email, nombre, passwordHash, plan || 'gratuito'],
        function (err) {
          if (err) {
            return res.status(500).json({ error: 'Error al registrar usuario' });
          }

          const token = generarToken(this.lastID);
          res.json({
            mensaje: 'Usuario registrado exitosamente',
            usuarioId: this.lastID,
            token,
            plan: plan || 'gratuito'
          });
        }
      );
    });
  } catch (error) {
    res.status(500).json({ error: 'Error en servidor' });
  }
});

// LOGIN
app.post('/api/auth/login', (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email y contraseña requeridos' });
    }

    db.get('SELECT * FROM usuarios WHERE email = ?', [email], async (err, usuario) => {
      if (!usuario) {
        return res.status(401).json({ error: 'Email o contraseña incorrectos' });
      }

      const passwordValida = await compararPassword(password, usuario.password);
      if (!passwordValida) {
        return res.status(401).json({ error: 'Email o contraseña incorrectos' });
      }

      const token = generarToken(usuario.id);
      res.json({
        mensaje: 'Login exitoso',
        usuarioId: usuario.id,
        token,
        nombre: usuario.nombre,
        email: usuario.email,
        plan: usuario.plan
      });
    });
  } catch (error) {
    res.status(500).json({ error: 'Error en servidor' });
  }
});

// VERIFICAR TOKEN
app.post('/api/auth/verificar', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ valido: false });
  }

  const decoded = verificarToken(token);
  if (!decoded) {
    return res.status(401).json({ valido: false });
  }

  res.json({ valido: true, usuarioId: decoded.id });
});

// ═══════════════════════════════════════════════════════════
// RUTAS DE USUARIO
// ═══════════════════════════════════════════════════════════

// GET perfil del usuario
app.get('/api/usuario/perfil', autenticar, (req, res) => {
  db.get('SELECT id, email, nombre, plan, estado_pago FROM usuarios WHERE id = ?', [req.usuarioId], (err, usuario) => {
    if (!usuario) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    res.json(usuario);
  });
});

// GET hijos del usuario
app.get('/api/usuario/hijos', autenticar, (req, res) => {
  db.all('SELECT * FROM hijos WHERE usuario_id = ? ORDER BY fecha_creacion DESC', [req.usuarioId], (err, hijos) => {
    if (err) {
      return res.status(500).json({ error: 'Error al obtener hijos' });
    }
    res.json(hijos || []);
  });
});

// POST crear nuevo hijo
app.post('/api/usuario/hijos', autenticar, (req, res) => {
  try {
    const { nombre, edad, fecha_nacimiento } = req.body;

    if (!nombre) {
      return res.status(400).json({ error: 'Nombre del hijo requerido' });
    }

    db.run(
      `INSERT INTO hijos (usuario_id, nombre, edad, fecha_nacimiento) VALUES (?, ?, ?, ?)`,
      [req.usuarioId, nombre, edad, fecha_nacimiento],
      function (err) {
        if (err) {
          return res.status(500).json({ error: 'Error al crear hijo' });
        }
        res.json({
          id: this.lastID,
          nombre,
          edad,
          fecha_nacimiento
        });
      }
    );
  } catch (error) {
    res.status(500).json({ error: 'Error en servidor' });
  }
});

// ═══════════════════════════════════════════════════════════
// RUTAS DE PAGOS (Mercado Pago)
// ═══════════════════════════════════════════════════════════

// Simular confirmación de pago (Mercado Pago webhook)
app.post('/api/pagos/confirmar', (req, res) => {
  try {
    const { email, plan, mercado_pago_id } = req.body;

    if (!email || !plan || !mercado_pago_id) {
      return res.status(400).json({ error: 'Datos incompletos' });
    }

    // Buscar usuario por email
    db.get('SELECT id FROM usuarios WHERE email = ?', [email], (err, usuario) => {
      if (!usuario) {
        return res.status(404).json({ error: 'Usuario no encontrado' });
      }

      // Guardar pago
      db.run(
        `INSERT INTO pagos (usuario_id, plan, monto, mercado_pago_id, estado) 
         VALUES (?, ?, ?, ?, 'confirmado')`,
        [usuario.id, plan, 0, mercado_pago_id],
        function (err) {
          if (err) {
            return res.status(500).json({ error: 'Error al guardar pago' });
          }

          // Actualizar plan del usuario
          db.run(
            `UPDATE usuarios SET plan = ?, estado_pago = 'confirmado' WHERE id = ?`,
            [plan, usuario.id],
            (err) => {
              if (err) {
                return res.status(500).json({ error: 'Error al actualizar plan' });
              }

              res.json({
                mensaje: 'Pago confirmado',
                usuarioId: usuario.id,
                plan: plan,
                acceso: true
              });
            }
          );
        }
      );
    });
  } catch (error) {
    res.status(500).json({ error: 'Error en servidor' });
  }
});

// GET historial de pagos
app.get('/api/pagos/historial', autenticar, (req, res) => {
  db.all('SELECT * FROM pagos WHERE usuario_id = ? ORDER BY fecha_pago DESC', [req.usuarioId], (err, pagos) => {
    if (err) {
      return res.status(500).json({ error: 'Error al obtener pagos' });
    }
    res.json(pagos || []);
  });
});

// ═══════════════════════════════════════════════════════════
// RUTA DE SALUD (verificar que el servidor está vivo)
// ═══════════════════════════════════════════════════════════

app.get('/api/health', (req, res) => {
  res.json({ status: 'Backend de memori funcionando ✅' });
});

// ═══════════════════════════════════════════════════════════
// INICIAR SERVIDOR
// ═══════════════════════════════════════════════════════════

app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════╗
║  🌿 MEMORI BACKEND FUNCIONANDO ✅      ║
║  Puerto: ${PORT}                          ║
║  URL: http://localhost:${PORT}          ║
╚════════════════════════════════════════╝
  `);
});
