const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Konfigurasi Multer & Folder Gambar Katalog ----------
const uploadDir = path.join(__dirname, 'catalog', 'imagesmenu');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ storage: storage });

// Agar folder gambar bisa diakses publik oleh frontend
app.use('/catalog/imagesmenu', express.static(uploadDir));

// ---------- "Database" sederhana (file JSON) ----------
const FILE = path.join(__dirname, 'data.json');
const CATALOG_FILE = path.join(__dirname, 'catalog.json');

const hash = (pw, salt = crypto.randomBytes(8).toString('hex')) =>
  salt + ':' + crypto.scryptSync(pw, salt, 32).toString('hex');
const check = (pw, h) => hash(pw, h.split(':')[0]) === h;
const uid = () => crypto.randomBytes(6).toString('hex');

let db = fs.existsSync(FILE)
  ? JSON.parse(fs.readFileSync(FILE, 'utf8'))
  : { users: [{ username: 'admin', pass: hash('admin123'), role: 'admin' }], carts: [] };
const save = () => fs.writeFileSync(FILE, JSON.stringify(db, null, 2));
save();

// ---------- Inisialisasi Master Katalog (Admin Only) ----------
let catalog = fs.existsSync(CATALOG_FILE)
  ? JSON.parse(fs.readFileSync(CATALOG_FILE, 'utf8'))
  : { products: [] };
const saveCatalog = () => {
  fs.writeFileSync(CATALOG_FILE, JSON.stringify(catalog, null, 2));
  console.log('📁 Katalog berhasil diperbarui.');
};
saveCatalog();

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

// ---------- Master Katalog (Admin: Tambah/Hapus Produk & Upload Gambar) ----------
app.get('/api/catalog', (req, res) => {
  res.json(catalog.products);
});

app.post('/api/admin/catalog', auth, onlyAdmin, upload.single('image'), (req, res) => {
  const { name, price } = req.body || {};
  if (!name || !price) {
    return res.status(400).json({ error: 'Nama dan harga produk wajib diisi' });
  }

  const imagePath = req.file ? `/catalog/imagesmenu/${req.file.filename}` : null;

  const newProduct = {
    id: uid(),
    name: String(name),
    price: Number(price) || 0,
    image: imagePath
  };

  catalog.products.push(newProduct);
  saveCatalog();
  res.json(newProduct);
});

app.delete('/api/admin/catalog/:productId', auth, onlyAdmin, (req, res) => {
  const product = catalog.products.find(p => p.id === req.params.productId);
  if (product && product.image) {
    const absolutePath = path.join(__dirname, product.image);
    if (fs.existsSync(absolutePath)) fs.unlinkSync(absolutePath);
  }
  catalog.products = catalog.products.filter(p => p.id !== req.params.productId);
  saveCatalog();
  res.json({ ok: true });
});

// ---------- Menu Gerobak (Abang Memilih dari Katalog Master & Kelola Stok) ----------
app.post('/api/carts/:id/menu', auth, canCart, (req, res) => {
  const { productId } = req.body || {};
  if (!productId) return res.status(400).json({ error: 'ID produk katalog wajib dipilih' });

  const product = catalog.products.find(p => p.id === productId);
  if (!product) return res.status(404).json({ error: 'Produk master tidak ditemukan di katalog' });

  const alreadyExists = req.cart.menu.some(m => m.productId === productId);
  if (alreadyExists) {
    return res.status(400).json({ error: 'Menu ini sudah ada di gerobak Anda' });
  }

  // Menyalin data produk dari master katalog ke dalam menu gerobak beserta stok awal
  const cartItem = {
    id: uid(),
    productId: product.id,
    name: product.name,
    price: product.price,
    image: product.image,
    available: true,
    stock: 10 // Nilai default stok awal
  };

  req.cart.menu.push(cartItem);
  save();
  res.json(req.cart);
});

app.patch('/api/carts/:id/menu/:itemId', auth, canCart, (req, res) => {
  const item = req.cart.menu.find(m => m.id === req.params.itemId);
  if (!item) return res.status(404).json({ error: 'Menu tidak ditemukan' });
  
  if (req.body.available !== undefined) {
    item.available = !!req.body.available;
  }
  if (req.body.stock !== undefined) {
    item.stock = Number(req.body.stock) || 0;
  }

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