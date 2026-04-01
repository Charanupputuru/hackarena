const mongoose = require('mongoose');

const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/foodbridge');
        console.log('✅ MongoDB Connected...');
    } catch (err) {
        console.error('❌ MongoDB Connection Error:', err.message);
        process.exit(1);
    }
};

const DonationSchema = new mongoose.Schema({
    id: { type: String, unique: true },
    donorName: String,
    foodDesc: String,
    qty: Number,
    unit: { type: String, default: 'kg' },
    location: String,
    lat: Number,
    lng: Number,
    expiresAt: Date,
    status: { type: String, default: 'pending' },
    assignedNGO: String,
    assignedDriver: String,
    createdAt: { type: Date, default: Date.now }
});

const NGOSchema = new mongoose.Schema({
    id: { type: String, unique: true },
    name: String,
    area: String,
    lat: Number,
    lng: Number,
    capacity: Number,
    verified: { type: Boolean, default: false },
    contact: String,
    mealsToday: { type: Number, default: 0 }
});

const DriverSchema = new mongoose.Schema({
    id: { type: String, unique: true },
    name: String,
    vehicle: String,
    lat: Number,
    lng: Number,
    status: { type: String, default: 'standby' },
    rating: { type: Number, default: 5 },
    currentTaskId: String,
    totalDeliveries: { type: Number, default: 0 }
});

const StatsSchema = new mongoose.Schema({
    mealsSaved: { type: Number, default: 0 },
    activePickups: { type: Number, default: 0 },
    ngoPartners: { type: Number, default: 0 },
    foodRescued: { type: Number, default: 0 }
});

const Donation = mongoose.model('Donation', DonationSchema);
const NGO = mongoose.model('NGO', NGOSchema);
const Driver = mongoose.model('Driver', DriverSchema);
const Stats = mongoose.model('Stats', StatsSchema);

module.exports = { connectDB, Donation, NGO, Driver, Stats };
