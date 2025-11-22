// server/server.js
require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const { pool } = require('./db/index.js');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 3000;
// Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        "https://cdn.tailwindcss.com", // Tailwind CDN
        "https://cdn.jsdelivr.net" // Chart.js CDN
      ],
      styleSrc: [
        "'self'",
        "'unsafe-inline'",
        "https://rsms.me/" // Font Inter CSS
      ],
      fontSrc: [
        "'self'",
        "https://rsms.me/" // Jeśli fonty są ładowane bezpośrednio
      ],
      connectSrc: [
        "'self'",
        "https://cdn.jsdelivr.net" // Allow source maps
      ]
    }
  }
}));
app.use(cors({ origin: '*' }));
app.use(express.json());
// Serwuj frontend
app.use(express.static(path.join(__dirname, '../client')));
// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
});
app.use('/api/', limiter);
// JWT
const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey';
// Autoryzacja
const authenticate = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Brak tokenu' });
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Nieprawidłowy token' });
    req.user = user;
    next();
  });
};
// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/weather', authenticate, require('./routes/weather'));
// NOWY ENDPOINT: Weryfikacja tokenu
app.get('/api/auth/me', authenticate, (req, res) => {
  res.json({ username: req.user.username });
});
// Catch-all dla frontendu
app.get(/.*/, (req, res) => {
  res.sendFile(path.join(__dirname, '../client/index.html'));
});
app.listen(PORT, () => {
  console.log(`Serwer działa na http://localhost:${PORT}`);
});