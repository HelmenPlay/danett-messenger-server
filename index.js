const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || 'http://localhost:3000',
    credentials: true
  }
});

app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:3000',
  credentials: true
}));
app.use(express.json());

// ==================== MongoDB ====================
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB error:', err));

// ==================== Схемы ====================
const UserSchema = new mongoose.Schema({
  name: { type: String, required: true },
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  avatar: { type: String, default: '' },
  isVerified: { type: Boolean, default: false },
  verificationCode: String,
  online: { type: Boolean, default: false },
  lastSeen: Date,
  privacy: {
    showLastSeen: { type: Boolean, default: true },
    showOnline: { type: Boolean, default: true }
  },
  contacts: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
}, { timestamps: true });

const MessageSchema = new mongoose.Schema({
  from: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  to: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  text: String,
  read: { type: Boolean, default: false },
  attachments: [String]
}, { timestamps: true });

const GroupSchema = new mongoose.Schema({
  name: String,
  avatar: String,
  members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  admin: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

const GroupMessageSchema = new mongoose.Schema({
  group: { type: mongoose.Schema.Types.ObjectId, ref: 'Group' },
  from: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  text: String,
  attachments: [String]
}, { timestamps: true });

const CallSchema = new mongoose.Schema({
  from: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  to: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  type: { type: String, enum: ['audio', 'video', 'group'] },
  duration: Number,
  status: { type: String, enum: ['missed', 'answered', 'outgoing'] },
  participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
}, { timestamps: true });

const User = mongoose.model('User', UserSchema);
const Message = mongoose.model('Message', MessageSchema);
const Group = mongoose.model('Group', GroupSchema);
const GroupMessage = mongoose.model('GroupMessage', GroupMessageSchema);
const Call = mongoose.model('Call', CallSchema);

// ==================== Email ====================
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// ==================== API ====================

// Регистрация
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, username, email, password } = req.body;
    
    const existing = await User.findOne({ $or: [{ email }, { username }] });
    if (existing) {
      return res.status(400).json({ error: 'Email или username уже занят' });
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
    
    const user = await User.create({
      name,
      username: username.startsWith('@') ? username : `@${username}`,
      email,
      password: hashedPassword,
      verificationCode
    });
    
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'Код подтверждения - Danett',
      html: `<h2>Ваш код: <b>${verificationCode}</b></h2><p>Введите его в приложении</p>`
    });
    
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET);
    
    res.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        username: user.username,
        email: user.email,
        isVerified: false
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Подтверждение email
app.post('/api/auth/verify', async (req, res) => {
  try {
    const { email, code } = req.body;
    const user = await User.findOne({ email });
    
    if (!user || user.verificationCode !== code) {
      return res.status(400).json({ error: 'Неверный код' });
    }
    
    user.isVerified = true;
    user.verificationCode = undefined;
    await user.save();
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Вход
app.post('/api/auth/login', async (req, res) => {
  try {
    const { login, password } = req.body;
    const user = await User.findOne({
      $or: [{ email: login }, { username: login }]
    });
    
    if (!user || !await bcrypt.compare(password, user.password)) {
      return res.status(401).json({ error: 'Неверные данные' });
    }
    
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET);
    
    res.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        username: user.username,
        email: user.email,
        avatar: user.avatar,
        isVerified: user.isVerified,
        privacy: user.privacy
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Поиск пользователей
app.get('/api/users/search/:query', async (req, res) => {
  try {
    const query = req.params.query;
    const users = await User.find({
      username: { $regex: query, $options: 'i' }
    }).select('name username avatar online').limit(20);
    
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Добавить в контакты
app.post('/api/users/contact/:id', async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user.contacts.includes(req.params.id)) {
      user.contacts.push(req.params.id);
      await user.save();
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Мои контакты
app.get('/api/users/contacts', async (req, res) => {
  try {
    const user = await User.findById(req.userId).populate('contacts', 'name username avatar online');
    res.json(user.contacts);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// История звонков
app.get('/api/calls', async (req, res) => {
  try {
    const calls = await Call.find({
      $or: [{ from: req.userId }, { to: req.userId }]
    })
    .populate('from', 'name username avatar')
    .populate('to', 'name username avatar')
    .sort('-createdAt')
    .limit(50);
    
    res.json(calls);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== WebSocket ====================
const users = new Map(); // userId -> socketId
const rooms = new Map(); // groupId -> Set of userIds

io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.userId = decoded.id;
    next();
  } catch {
    next(new Error('unauthorized'));
  }
}).on('connection', (socket) => {
  console.log('🔌 User connected:', socket.userId);
  users.set(socket.userId.toString(), socket.id);
  
  // Обновляем статус онлайн
  User.findByIdAndUpdate(socket.userId, { online: true });
  
  // Отправляем список онлайн контактов
  socket.on('get-online', async () => {
    const user = await User.findById(socket.userId).populate('contacts');
    const onlineContacts = user.contacts
      .filter(c => users.has(c._id.toString()))
      .map(c => c._id.toString());
    
    socket.emit('online-users', onlineContacts);
  });
  
  // Приватное сообщение
  socket.on('private-message', async (data) => {
    const message = await Message.create({
      from: socket.userId,
      to: data.to,
      text: data.text
    });
    
    const toSocket = users.get(data.to);
    if (toSocket) {
      io.to(toSocket).emit('private-message', {
        ...message.toObject(),
        from: socket.userId
      });
    }
  });
  
  // Создание группы
  socket.on('create-group', async (data) => {
    const group = await Group.create({
      name: data.name,
      members: [socket.userId, ...data.members],
      admin: socket.userId
    });
    
    group.members.forEach(memberId => {
      const memberSocket = users.get(memberId.toString());
      if (memberSocket) {
        io.to(memberSocket).emit('group-created', group);
      }
    });
  });
  
  // Групповое сообщение
  socket.on('group-message', async (data) => {
    const message = await GroupMessage.create({
      group: data.groupId,
      from: socket.userId,
      text: data.text
    });
    
    const group = await Group.findById(data.groupId);
    group.members.forEach(memberId => {
      if (memberId.toString() !== socket.userId) {
        const memberSocket = users.get(memberId.toString());
        if (memberSocket) {
          io.to(memberSocket).emit('group-message', {
            ...message.toObject(),
            from: socket.userId,
            group: data.groupId
          });
        }
      }
    });
  });
  
  // Звонок
  socket.on('call-user', (data) => {
    const toSocket = users.get(data.to);
    if (toSocket) {
      io.to(toSocket).emit('incoming-call', {
        from: socket.userId,
        fromUsername: data.fromUsername,
        offer: data.offer,
        callId: data.callId
      });
    }
  });
  
  // Групповой звонок
  socket.on('group-call', (data) => {
    const room = `call_${data.groupId}`;
    socket.join(room);
    
    data.members.forEach(memberId => {
      if (memberId !== socket.userId) {
        const memberSocket = users.get(memberId);
        if (memberSocket) {
          io.to(memberSocket).emit('group-call-invite', {
            groupId: data.groupId,
            from: socket.userId,
            fromUsername: data.fromUsername,
            members: data.members
          });
        }
      }
    });
  });
  
  socket.on('join-call', (data) => {
    const room = `call_${data.groupId}`;
    socket.join(room);
    socket.to(room).emit('user-joined-call', {
      userId: socket.userId,
      username: data.username
    });
  });
  
  // ICE кандидаты
  socket.on('ice-candidate', (data) => {
    const toSocket = users.get(data.to);
    if (toSocket) {
      io.to(toSocket).emit('ice-candidate', {
        from: socket.userId,
        candidate: data.candidate,
        callId: data.callId
      });
    }
  });
  
  socket.on('group-ice-candidate', (data) => {
    const room = `call_${data.groupId}`;
    socket.to(room).emit('group-ice-candidate', {
      from: socket.userId,
      candidate: data.candidate
    });
  });
  
  // Завершение звонка
  socket.on('end-call', async (data) => {
    const toSocket = users.get(data.to);
    if (toSocket) {
      io.to(toSocket).emit('call-ended', {
        from: socket.userId,
        callId: data.callId
      });
    }
    
    // Сохраняем в историю
    if (data.duration) {
      await Call.create({
        from: socket.userId,
        to: data.to,
        type: 'video',
        duration: data.duration,
        status: data.status
      });
    }
  });
  
  socket.on('end-group-call', (data) => {
    const room = `call_${data.groupId}`;
    io.to(room).emit('group-call-ended');
    socket.leave(room);
  });
  
  // Отключение
  socket.on('disconnect', () => {
    console.log('🔌 User disconnected:', socket.userId);
    users.delete(socket.userId.toString());
    User.findByIdAndUpdate(socket.userId, { 
      online: false,
      lastSeen: new Date()
    });
  });
});

// ==================== Запуск ====================
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
