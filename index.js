// Запуск сервера
console.log('🚀 Запуск сервера...');

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this';

// МОДЕЛИ
const Message = require('./models/Message');
const Group = require('./models/Group');
const GroupMessage = require('./models/GroupMessage');
const User = require('./models/User');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { 
    origin: ["http://localhost:3000", "https://glistening-cendol-f83f4a.netlify.app"],
    methods: ["GET", "POST"],
    credentials: true
  }
});

app.use(cors({
  origin: ["http://localhost:3000", "https://glistening-cendol-f83f4a.netlify.app"],
  credentials: true
}));
app.use(express.json());

app.get('/', (req, res) => {
  res.send('Мессенджер API работает!');
});

// ==================== НАСТРОЙКА ПОЧТЫ ====================
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  },
  tls: {
    rejectUnauthorized: false
  }
});

// ==================== API ДЛЯ ПОДТВЕРЖДЕНИЯ ПОЧТЫ ====================

app.post('/api/auth/send-verification', async (req, res) => {
  try {
    const { email } = req.body;
    console.log('📧 Отправка кода на:', email);
    
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
    
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
    
    user.verificationToken = verificationCode;
    await user.save();
    
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'Подтверждение email - Danett Messenger',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #667eea;">Добро пожаловать в Danett Messenger! 🎉</h1>
          <p>Ваш код подтверждения:</p>
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
                      color: white; 
                      padding: 20px; 
                      border-radius: 10px; 
                      font-size: 32px; 
                      text-align: center;
                      letter-spacing: 5px;
                      margin: 20px 0;">
            <strong>${verificationCode}</strong>
          </div>
          <p>Введите этот код в приложении, чтобы подтвердить свой email.</p>
          <p>Код действителен в течение 10 минут.</p>
          <hr style="border: 1px solid #e0e0e0; margin: 20px 0;">
          <p style="color: #999; font-size: 12px;">
            Если вы не регистрировались, просто проигнорируйте это письмо.
          </p>
        </div>
      `
    };
    
    await transporter.sendMail(mailOptions);
    console.log('✅ Код отправлен на почту');
    
    res.json({ 
      success: true, 
      message: 'Код отправлен на почту',
      expiresIn: 600
    });
    
  } catch (error) {
    console.error('❌ Ошибка отправки кода:', error);
    res.status(500).json({ error: 'Ошибка отправки письма' });
  }
});

app.post('/api/auth/verify-email', async (req, res) => {
  try {
    const { email, code } = req.body;
    
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
    
    if (user.verificationToken !== code) {
      return res.status(400).json({ error: 'Неверный код' });
    }
    
    user.isVerified = true;
    user.verificationToken = undefined;
    await user.save();
    
    res.json({ success: true, message: 'Email подтверждён' });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== API для авторизации ====================

app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, email, phone, password } = req.body;
    
    const existingUser = await User.findOne({ 
      $or: [{ email }, { phone }, { username }] 
    });
    
    if (existingUser) {
      if (existingUser.email === email) return res.status(400).json({ error: 'Email уже зарегистрирован' });
      if (existingUser.phone === phone) return res.status(400).json({ error: 'Телефон уже зарегистрирован' });
      if (existingUser.username === username) return res.status(400).json({ error: 'Имя пользователя уже занято' });
    }
    
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    
    const user = new User({ 
      username, 
      email, 
      phone, 
      password: hashedPassword,
      isVerified: false 
    });
    await user.save();
    
    const token = jwt.sign(
      { id: user._id, username: user.username, email: user.email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    
    res.json({
      success: true,
      token,
      user: { 
        id: user._id, 
        username: user.username, 
        email: user.email, 
        phone: user.phone,
        isVerified: false 
      }
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { login, password } = req.body;
    
    const user = await User.findOne({
      $or: [{ email: login }, { phone: login }, { username: login }]
    });
    
    if (!user) return res.status(401).json({ error: 'Неверный логин или пароль' });
    
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ error: 'Неверный логин или пароль' });
    
    const token = jwt.sign(
      { id: user._id, username: user.username, email: user.email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    
    res.json({
      success: true,
      token,
      user: { 
        id: user._id, 
        username: user.username, 
        email: user.email, 
        phone: user.phone,
        isVerified: user.isVerified 
      }
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/auth/me', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Не авторизован' });
    
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.id).select('-password');
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
    
    res.json(user);
  } catch (error) {
    res.status(401).json({ error: 'Недействительный токен' });
  }
});

// ==================== API для пользователя ====================

app.get('/api/auth/user-by-email/:email', async (req, res) => {
  try {
    const email = decodeURIComponent(req.params.email);
    const user = await User.findOne({ email }).select('username email');
    
    if (!user) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
    
    res.json({ username: user.username, email: user.email });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== API для сообщений ====================

app.get('/api/messages/:user1/:user2', async (req, res) => {
  try {
    const user1 = decodeURIComponent(req.params.user1);
    const user2 = decodeURIComponent(req.params.user2);
    
    const messages = await Message.find({
      $or: [
        { from: user1, to: user2 },
        { from: user2, to: user1 }
      ]
    }).sort({ timestamp: 1 });
    
    res.json(messages);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/contacts/:email', async (req, res) => {
  try {
    const email = decodeURIComponent(req.params.email);
    
    const sentMessages = await Message.find({ from: email }).distinct('to');
    const receivedMessages = await Message.find({ to: email }).distinct('from');
    const contacts = [...new Set([...sentMessages, ...receivedMessages])];
    
    res.json(contacts);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== API для групп ====================

app.post('/api/groups', async (req, res) => {
  try {
    const { name, members, admin } = req.body;
    if (!members.includes(admin)) members.push(admin);
    
    const group = new Group({ name, members, admin });
    await group.save();
    res.json(group);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/groups/:email', async (req, res) => {
  try {
    const email = decodeURIComponent(req.params.email);
    const groups = await Group.find({ members: email });
    res.json(groups);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/groups/:groupId', async (req, res) => {
  try {
    const { groupId } = req.params;
    const { email } = req.query;
    
    const group = await Group.findById(groupId);
    if (!group) return res.status(404).json({ error: 'Группа не найдена' });
    if (group.admin !== email) return res.status(403).json({ error: 'Нет прав' });
    
    await GroupMessage.deleteMany({ groupId });
    await Group.findByIdAndDelete(groupId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/group-messages/:groupId', async (req, res) => {
  try {
    const messages = await GroupMessage.find({ groupId: req.params.groupId }).sort({ timestamp: 1 });
    res.json(messages);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== ПОДКЛЮЧЕНИЕ К MONGODB ====================

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://Danett:MzSKDWwFbJTU7ogo@cluster0.bjj0zzy.mongodb.net/messenger?retryWrites=true&w=majority';

mongoose.connect(MONGODB_URI)
  .then(() => {
    console.log('✅ MongoDB подключена');
    const PORT = process.env.PORT || 5000;
    server.listen(PORT, () => {
      console.log(`🚀 Сервер запущен на порту ${PORT}`);
    });
  })
  .catch(err => console.log('❌ Ошибка MongoDB:', err.message));

// ==================== ОНЛАЙН ПОЛЬЗОВАТЕЛИ ====================

const onlineUsers = {};
// Для синхронизации статусов
const userSockets = {}; // email -> socket.id

// Периодическая синхронизация статусов (каждые 30 секунд)
setInterval(async () => {
  try {
    // Обновляем статусы в базе
    const onlineEmails = Object.keys(onlineUsers);
    
    // Устанавливаем online: true для всех в onlineUsers
    await User.updateMany(
      { email: { $in: onlineEmails } },
      { online: true, lastSeen: new Date() }
    );
    
    // Устанавливаем online: false для всех остальных
    await User.updateMany(
      { email: { $nin: onlineEmails } },
      { online: false }
    );
    
    // Отправляем всем актуальный список онлайн
    io.emit('online-users-update', onlineEmails);
  } catch (error) {
    console.error('Ошибка синхронизации статусов:', error);
  }
}, 30000);

io.on('connection', (socket) => {
  console.log('🔌 Новый пользователь подключился:', socket.id);

  socket.on('user-connect', async (userEmail) => {
    console.log(`👤 ${userEmail} подключился`);
    
    // Если пользователь уже был онлайн с другим сокетом - удаляем старый
    if (userSockets[userEmail] && userSockets[userEmail] !== socket.id) {
      const oldSocketId = userSockets[userEmail];
      delete onlineUsers[oldSocketId];
      io.to(oldSocketId).emit('force-disconnect', 'Новое подключение с другого устройства');
    }
    
    onlineUsers[userEmail] = socket.id;
    userSockets[userEmail] = socket.id;
    socket.userEmail = userEmail;

    try {
      await User.findOneAndUpdate(
        { email: userEmail },
        { online: true, lastSeen: new Date() }
      );
    } catch (error) {
      console.error('Ошибка обновления пользователя:', error);
    }

    // Отправляем всем обновление статуса
    io.emit('user-status', { userEmail, status: 'online' });
    
    // Отправляем текущему пользователю список всех онлайн
    socket.emit('current-users', Object.keys(onlineUsers));
  });

  socket.on('private-message', async ({ to, from, message }) => {
    try {
      const newMessage = new Message({ from, to, message, timestamp: new Date() });
      await newMessage.save();
      
      const targetSocketId = onlineUsers[to];
      if (targetSocketId) {
        io.to(targetSocketId).emit('private-message', { 
          from, 
          message, 
          timestamp: new Date(),
          id: newMessage._id
        });
      }
      
      // Подтверждение отправителю
      socket.emit('message-sent', { id: newMessage._id, to, timestamp: newMessage.timestamp });
      
    } catch (error) {
      console.log('❌ Ошибка:', error.message);
      socket.emit('message-error', { to, message: 'Ошибка отправки сообщения' });
    }
  });

  socket.on('typing', ({ to, from, isTyping }) => {
    const targetSocketId = onlineUsers[to];
    if (targetSocketId) {
      io.to(targetSocketId).emit('typing-status', { from, isTyping });
    }
  });

  socket.on('group-message', async ({ groupId, from, message }) => {
    try {
      const newMessage = new GroupMessage({ groupId, from, message, timestamp: new Date() });
      await newMessage.save();
      
      const group = await Group.findById(groupId);
      if (group) {
        group.members.forEach(member => {
          const memberSocketId = onlineUsers[member];
          if (memberSocketId && member !== from) {
            io.to(memberSocketId).emit('group-message', { 
              groupId, 
              from, 
              message, 
              timestamp: new Date(),
              id: newMessage._id
            });
          }
        });
      }
    } catch (error) {
      console.log('❌ Ошибка:', error.message);
    }
  });

  // ==================== ВИДЕОЗВОНКИ (ИСПРАВЛЕНО) ====================

socket.on('call-user', (data) => {
  console.log('📞 Звонок от', data.from, 'для', data.to, 'ID:', data.callId);
  
  const targetSocketId = onlineUsers[data.to];
  
  if (targetSocketId) {
    // Отправляем звонок получателю
    io.to(targetSocketId).emit('incoming-call', {
      from: data.from,
      fromUsername: data.fromUsername,
      offer: data.offer,
      callId: data.callId
    });
    
    // Подтверждение отправителю
    socket.emit('call-ringing', { to: data.to, callId: data.callId });
    console.log('✅ Звонок доставлен получателю');
  } else {
    console.log('❌ Получатель не в сети');
    socket.emit('call-error', { message: 'Пользователь не в сети' });
  }
});

socket.on('accept-call', (data) => {
  console.log('✅ Звонок принят от', data.from, 'для', data.to);
  
  const targetSocketId = onlineUsers[data.to];
  
  if (targetSocketId) {
    io.to(targetSocketId).emit('call-accepted', {
      from: data.from,
      fromUsername: data.fromUsername,
      answer: data.answer,
      callId: data.callId
    });
  }
});

socket.on('reject-call', (data) => {
  console.log('❌ Звонок отклонен от', data.from);
  const targetSocketId = onlineUsers[data.to];
  if (targetSocketId) {
    io.to(targetSocketId).emit('call-rejected', {
      from: data.from,
      fromUsername: data.fromUsername,
      callId: data.callId
    });
  }
});

// ВАЖНО: передача ICE-кандидатов
socket.on('ice-candidate', (data) => {
  console.log('🧊 ICE кандидат от', data.from, 'для', data.to);
  const targetSocketId = onlineUsers[data.to];
  if (targetSocketId) {
    io.to(targetSocketId).emit('ice-candidate', {
      from: data.from,
      candidate: data.candidate,
      callId: data.callId
    });
  }
});

socket.on('end-call', (data) => {
  console.log('📴 Звонок завершен от', data.from);
  const targetSocketId = onlineUsers[data.to];
  if (targetSocketId) {
    io.to(targetSocketId).emit('call-ended', {
      from: data.from,
      fromUsername: data.fromUsername,
      callId: data.callId
    });
  }
});

// НОВОЕ: пользователь занят (уже в звонке)
socket.on('call-busy', (data) => {
  const targetSocketId = onlineUsers[data.to];
  if (targetSocketId) {
    io.to(targetSocketId).emit('call-busy', {
      from: data.from,
      fromUsername: data.fromUsername,
      callId: data.callId
    });
  }
});

// НОВОЕ: отключение микрофона/камеры во время звонка
socket.on('call-toggle-audio', (data) => {
  const targetSocketId = onlineUsers[data.to];
  if (targetSocketId) {
    io.to(targetSocketId).emit('call-audio-toggled', {
      from: data.from,
      muted: data.muted,
      callId: data.callId
    });
  }
});

socket.on('call-toggle-video', (data) => {
  const targetSocketId = onlineUsers[data.to];
  if (targetSocketId) {
    io.to(targetSocketId).emit('call-video-toggled', {
      from: data.from,
      off: data.off,
      callId: data.callId
    });
  }
});
  // НОВОЕ: завершение звонка
  socket.on('end-call', (data) => {
    const targetSocketId = onlineUsers[data.to];
    if (targetSocketId) {
      io.to(targetSocketId).emit('call-ended', {
        from: data.from,
        fromUsername: data.fromUsername,
        callId: data.callId
      });
    }
  });

  // НОВОЕ: отключение микрофона/камеры во время звонка
  socket.on('call-toggle-audio', (data) => {
    const targetSocketId = onlineUsers[data.to];
    if (targetSocketId) {
      io.to(targetSocketId).emit('call-audio-toggled', {
        from: data.from,
        muted: data.muted
      });
    }
  });

  socket.on('call-toggle-video', (data) => {
    const targetSocketId = onlineUsers[data.to];
    if (targetSocketId) {
      io.to(targetSocketId).emit('call-video-toggled', {
        from: data.from,
        off: data.off
      });
    }
  });

  socket.on('disconnect', async () => {
    if (socket.userEmail) {
      console.log(`👋 ${socket.userEmail} отключился`);
      
      // Удаляем из онлайн
      delete onlineUsers[socket.userEmail];
      delete userSockets[socket.userEmail];

      try {
        await User.findOneAndUpdate(
          { email: socket.userEmail },
          { online: false, lastSeen: new Date() }
        );
      } catch (error) {
        console.error('Ошибка обновления статуса:', error);
      }

      // Оповещаем всех
      io.emit('user-status', { userEmail: socket.userEmail, status: 'offline' });
    }
  });
});
