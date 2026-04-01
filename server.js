// =====================================================
//  FoodBridge — Surplus Food Rescue & Redistribution
//  Backend Server  |  Node.js + Express + Socket.IO + MongoDB
// =====================================================

require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
const { connectDB, Donation, NGO, Driver, Stats } = require('./db');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// ─── INITIALIZE DB & SEED DATA ───────────────────
connectDB().then(async () => {
  const statsCount = await Stats.countDocuments();
  if (statsCount === 0) {
    console.log('🌱 Seeding initial data into MongoDB...');
    await Stats.create({ mealsSaved: 12847, activePickups: 8, ngoPartners: 34, foodRescued: 2400 });
    
    await Donation.insertMany([
      { id: 'FB-0041', donorName: 'Grand Mahal Hall', foodDesc: 'Chicken Biryani', qty: 45, unit: 'kg', location: 'Keshwapur, Hubballi', lat: 15.355, lng: 75.135, expiresAt: new Date(Date.now() + 2*3600000), status: 'assigned', assignedNGO: 'Annadan Trust', assignedDriver: 'Ravi Kumar' },
      { id: 'FB-0040', donorName: 'KLE College Fest', foodDesc: 'Veg Meals', qty: 30, unit: 'kg', location: 'Vidyanagar, Hubballi', lat: 15.362, lng: 75.124, expiresAt: new Date(Date.now() + 3.5*3600000), status: 'in-transit', assignedNGO: 'Smile Foundation', assignedDriver: 'Priya Desai' },
    ]);

    await NGO.insertMany([
      { id: 'NGO001', name: 'Annadan Trust', area: 'Keshwapur', lat: 15.358, lng: 75.138, capacity: 200, verified: true, contact: '94481-XXXXX', mealsToday: 180 },
      { id: 'NGO002', name: 'Smile Foundation Hubballi', area: 'Vidyanagar', lat: 15.365, lng: 75.121, capacity: 150, verified: true, contact: '98860-XXXXX', mealsToday: 95 },
      { id: 'NGO003', name: 'Aadhar Social Trust', area: 'Deshpande Nagar', lat: 15.350, lng: 75.130, capacity: 300, verified: true, contact: '99009-XXXXX', mealsToday: 212 },
    ]);

    await Driver.insertMany([
      { id: 'DRV001', name: 'Ravi Kumar', vehicle: '2-Wheeler', lat: 15.354, lng: 75.133, status: 'on-pickup', rating: 4.9, currentTaskId: 'FB-0041', totalDeliveries: 142 },
      { id: 'DRV002', name: 'Priya Desai', vehicle: 'Mini Van', lat: 15.360, lng: 75.128, status: 'en-route', rating: 4.8, currentTaskId: 'FB-0040', totalDeliveries: 98 },
      { id: 'DRV003', name: 'Suresh Naik', vehicle: 'Car', lat: 15.363, lng: 75.122, status: 'standby', rating: 4.6, currentTaskId: null, totalDeliveries: 67 },
    ]);
    console.log('✅ Seed complete!');
  }
});

// ─── REST API ROUTES ───────────────────────────────

app.get('/api/stats', async (req, res) => {
  const stats = await Stats.findOne();
  res.json(stats);
});

app.get('/api/donations', async (req, res) => {
  const donations = await Donation.find().sort({ createdAt: -1 });
  res.json(donations);
});

app.post('/api/donations', async (req, res) => {
  const { donorName, foodDesc, qty, unit, location, lat, lng, expiresAt } = req.body;
  if (!donorName || !foodDesc || !qty || !location) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const count = await Donation.countDocuments();
  const id = `FB-${String(count + 42).padStart(4,'0')}`;
  
  const donation = new Donation({
    id, donorName, foodDesc, qty, unit: unit || 'kg',
    location, lat: lat || 15.355, lng: lng || 75.130,
    expiresAt: new Date(expiresAt)
  });

  const stats = await Stats.findOne();
  stats.activePickups += 1;
  await stats.save();

  const ngos = await NGO.find({ verified: true });
  let matchedNGO = null, minDist = Infinity;
  for (const ngo of ngos) {
    const d = Math.sqrt(Math.pow(donation.lat - ngo.lat, 2) + Math.pow(donation.lng - ngo.lng, 2));
    if (d < minDist) { minDist = d; matchedNGO = ngo; }
  }

  if (matchedNGO) {
    donation.status = 'matched';
    donation.assignedNGO = matchedNGO.name;
  }

  await donation.save();

  io.emit('new-donation', donation);
  io.emit('stats-update', stats);

  res.status(201).json({ success: true, donation, matchedNGO });
});

app.get('/api/donations/:id', async (req, res) => {
  const d = await Donation.findOne({ id: req.params.id });
  if (!d) return res.status(404).json({ error: 'Donation not found' });
  res.json(d);
});

app.patch('/api/donations/:id/status', async (req, res) => {
  const d = await Donation.findOne({ id: req.params.id });
  if (!d) return res.status(404).json({ error: 'Not found' });
  
  d.status = req.body.status;
  await d.save();

  if (req.body.status === 'delivered') {
    const meals = Math.round(d.qty * 4); // ~4 meals per kg
    const stats = await Stats.findOne();
    stats.mealsSaved += meals;
    stats.foodRescued += d.qty;
    stats.activePickups = Math.max(0, stats.activePickups - 1);
    await stats.save();
    
    io.emit('delivery-complete', { donationId: d.id, mealsAdded: meals });
    io.emit('stats-update', stats);
  }
  res.json(d);
});

app.get('/api/ngos', async (req, res) => {
  const ngos = await NGO.find();
  res.json(ngos);
});

app.post('/api/ngos', async (req, res) => {
  const count = await NGO.countDocuments();
  const ngo = new NGO({ ...req.body, id: `NGO${String(count + 10).padStart(3,'0')}` });
  await ngo.save();
  
  const stats = await Stats.findOne();
  stats.ngoPartners += 1;
  await stats.save();
  io.emit('stats-update', stats);
  
  res.status(201).json({ success: true, ngo });
});

app.get('/api/drivers', async (req, res) => {
  const drivers = await Driver.find();
  res.json(drivers);
});

app.patch('/api/drivers/:id/location', async (req, res) => {
  const d = await Driver.findOne({ id: req.params.id });
  if (!d) return res.status(404).json({ error: 'Driver not found' });
  d.lat = req.body.lat; d.lng = req.body.lng;
  await d.save();
  io.emit('driver-location-update', { driverId: d.id, lat: d.lat, lng: d.lng, name: d.name });
  res.json({ success: true });
});

app.post('/api/safety-checklist', async (req, res) => {
  const { donationId, checks, score } = req.body;
  // Currently we aren't storing safety score in schema, but we can just return success
  res.json({ success: true, approved: score >= 70 });
});

app.get('/api/impact', async (req, res) => {
  const stats = await Stats.findOne();
  res.json({
    mealsSaved: stats.mealsSaved,
    co2Saved: Math.round(stats.foodRescued * 4), 
    valueRescued: Math.round(stats.foodRescued * 150),
    beneficiaries: Math.round(stats.mealsSaved / 5.5),
    topDonors: [
      { name: 'Grand Mahal Hall', meals: 1240, kg: 310 },
      { name: 'KLE College Fest', meals: 980, kg: 245 },
      { name: 'Hotel Shivshakti', meals: 760, kg: 190 },
    ]
  });
});

// ─── SOCKET.IO — REAL-TIME EVENTS ─────────────────
io.on('connection', async (socket) => {
  console.log(`Client connected: ${socket.id}`);
  
  try {
      const dbDonations = await Donation.find().sort({ createdAt: -1 });
      const dbDrivers = await Driver.find();
      const dbStats = await Stats.findOne();
      
      socket.emit('initial-data', { 
         donations: dbDonations, 
         drivers: dbDrivers, 
         stats: dbStats || { mealsSaved: 0, activePickups: 0, ngoPartners: 0, foodRescued: 0 } 
      });
  } catch(e) { console.error('Socket init error', e); }

  socket.on('driver-update', async (data) => {
    const driver = await Driver.findOne({ id: data.driverId });
    if (driver) { 
        Object.assign(driver, data); 
        await driver.save();
    }
    io.emit('driver-location-update', data);
  });

  socket.on('request-pickup', async (data) => {
    const availableDriver = await Driver.findOne({ status: 'standby' });
    if (availableDriver) {
      availableDriver.status = 'dispatched';
      availableDriver.currentTaskId = data.donationId;
      await availableDriver.save();
      io.emit('driver-dispatched', { driver: availableDriver, donationId: data.donationId });
    }
  });

  socket.on('disconnect', () => console.log(`Client disconnected: ${socket.id}`));
});

// ─── SIMULATE REAL-TIME GPS MOVEMENT ─────────────
setInterval(async () => {
  try {
      const drivers = await Driver.find({ status: { $ne: 'standby' } });
      if (drivers.length > 0) {
          for (let d of drivers) {
              d.lat += (Math.random() - 0.5) * 0.002;
              d.lng += (Math.random() - 0.5) * 0.002;
              await d.save();
          }
      }
      // Broadcast all drivers to UI to keep pins moving
      const allDrivers = await Driver.find();
      io.emit('driver-locations', allDrivers.map(d => ({ id: d.id, lat: d.lat, lng: d.lng, status: d.status, name: d.name })));
  } catch(e) {}
}, 3000);

// Occasionally increment meals (Game loop mock)
setInterval(async () => {
  if (Math.random() > 0.7) {
    try {
        const stats = await Stats.findOne();
        if(stats) {
            stats.mealsSaved += Math.floor(Math.random() * 5) + 1;
            await stats.save();
            io.emit('stats-update', stats);
        }
    } catch(e) {}
  }
}, 5000);

// Expiry checker
setInterval(async () => {
  try {
      const now = new Date();
      const expiring = await Donation.find({ status: { $nin: ['delivered', 'expired'] } });
      for (let d of expiring) {
          const msLeft = new Date(d.expiresAt) - now;
          if (msLeft < 0) {
            d.status = 'expired';
            await d.save();
            io.emit('donation-expired', { id: d.id, foodDesc: d.foodDesc, donorName: d.donorName });
          } else if (msLeft < 60 * 60 * 1000) {
            io.emit('expiry-warning', { id: d.id, minutesLeft: Math.round(msLeft / 60000), foodDesc: d.foodDesc });
          }
      }
  } catch(e) {}
}, 60000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`\n🍱 FoodBridge Server running on http://localhost:${PORT}\n`));

module.exports = { app, server };