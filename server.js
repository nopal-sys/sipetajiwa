const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- "Database" sederhana (file JSON) ----------
const FILE = path.join(__dirname, 'data.json');
const hash = (pw, salt = crypto.randomBytes(8).toString('hex')) =>
  salt + ':' + crypto.scryptSync(pw, salt, 32).toString('hex');
const check = (pw, h) => hash(pw, h.split(':')[0]) === h;
const uid = () => crypto.randomBytes(6).toString('hex');

let db = fs.existsSync(FILE)
  ? JSON.parse(fs.readFileSync(FILE, 'utf8'))
  : { users: [{ username: 'admin', pass: hash('admin123'), role: 'admin' }], carts: [] };
const save = () => fs.writeFileSync(FILE, JSON.stringify(db, null, 2));
save();

// ---------- Auth ----------
const sessions = {}; // token -> { username, role, cartId }
function auth(req, res, next) {
  const u = sessions[(req.headers.authorization || '').replace('Bearer ', '')];
  if (!u) return res.status(401).json({ error: 'Belum login' });
  req.user = u;
  next();
}
const onlyAdmin = (req, res, next) =>
  req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Khusus admin' });
// admin boleh semua gerobak, abang hanya gerobaknya sendiri
function canCart(req, res, next) {
  const c = db.carts.find(x => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: 'Gerobak tidak ditemukan' });
  if (req.user.role !== 'admin' && req.user.cartId !== c.id)
    return res.status(403).json({ error: 'Bukan gerobak kamu' });
  req.cart = c;
  next();
}

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const u = db.users.find(x => x.username === username);
  if (!u || !check(String(password || ''), u.pass))
    return res.status(401).json({ error: 'Username atau password salah' });
  const token = uid() + uid();
  sessions[token] = { username: u.username, role: u.role, cartId: u.cartId };
  res.json({ token, ...sessions[token] });
});
app.get('/api/me', auth, (req, res) => res.json(req.user));

// ---------- Gerobak ----------
app.get('/api/carts', (req, res) => res.json(db.carts)); // publik (customer)

app.post('/api/carts', auth, onlyAdmin, (req, res) => {
  const { name, username, password } = req.body || {};
  if (!name || !username || !password) return res.status(400).json({ error: 'Nama, username, password wajib diisi' });
  if (db.users.some(u => u.username === username)) return res.status(400).json({ error: 'Username sudah dipakai' });
  const cart = { id: uid(), name, abang: username, lat: -6.2088, lng: 106.8456,
                 online: false, updated: Date.now(), menu: [] };
  db.carts.push(cart);
  db.users.push({ username, pass: hash(password), role: 'abang', cartId: cart.id });
  save();
  res.json(cart);
});

app.delete('/api/carts/:id', auth, onlyAdmin, (req, res) => {
  db.carts = db.carts.filter(c => c.id !== req.params.id);
  db.users = db.users.filter(u => u.cartId !== req.params.id);
  save();
  res.json({ ok: true });
});

app.put('/api/carts/:id/location', auth, canCart, (req, res) => {
  const lat = Number(req.body.lat), lng = Number(req.body.lng);
  if (!isFinite(lat) || !isFinite(lng)) return res.status(400).json({ error: 'Koordinat tidak valid' });
  Object.assign(req.cart, { lat, lng, updated: Date.now() });
  save();
  res.json(req.cart);
});

app.put('/api/carts/:id/online', auth, canCart, (req, res) => {
  req.cart.online = !!req.body.online;
  req.cart.updated = Date.now();
  save();
  res.json(req.cart);
});

// ---------- Menu ----------
app.post('/api/carts/:id/menu', auth, canCart, (req, res) => {
  const { name, price } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Nama menu wajib diisi' });
  req.cart.menu.push({ id: uid(), name: String(name), price: Number(price) || 0, available: true });
  save();
  res.json(req.cart);
});
app.patch('/api/carts/:id/menu/:itemId', auth, canCart, (req, res) => {
  const item = req.cart.menu.find(m => m.id === req.params.itemId);
  if (!item) return res.status(404).json({ error: 'Menu tidak ditemukan' });
  item.available = !!req.body.available;
  save();
  res.json(req.cart);
});
app.delete('/api/carts/:id/menu/:itemId', auth, canCart, (req, res) => {
  req.cart.menu = req.cart.menu.filter(m => m.id !== req.params.itemId);
  save();
  res.json(req.cart);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Jalan di http://localhost:' + PORT));