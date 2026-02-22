const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');

// Просто импортируем модель
const Message = require('./models/Message');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "http://localhost:3000" }
});

app.use(cors());
app.use(express.json());

// Подключение к MongoDB
mongoose.connect('mongodb://localhost:27017/messenger')
  .then(() => {
    console.log('✅ MongoDB подключена');
    server.listen(5000, () => {
      console.log('🚀 Сервер запущен на http://localhost:5000');
    });
  })
  .catch(err => console.log('❌ Ошибка MongoDB:', err));

// Хранилище онлайн пользователей
const onlineUsers = {};

io.on('connection', (socket) => {
  console.log('🔌 Новый пользователь:', socket.id);

  socket.on('user-connect', (userId) => {
    console.log(`👤 ${userId} подключился`);
    onlineUsers[userId] = socket.id;
    socket.userId = userId;
    io.emit('user-status', { userId, status: 'online' });
  });

  socket.on('private-message', async ({ to, from, message }) => {
    console.log(`📨 Сообщение от ${from} к ${to}: ${message}`);
    
    try {
      // СОЗДАЕМ НОВОЕ СООБЩЕНИЕ
      const messageData = {
        from: from,
        to: to,
        message: message,
        timestamp: new Date()
      };
      
      // Сохраняем в БД
      const newMessage = new Message(messageData);
      await newMessage.save();
      console.log('✅ Сообщение сохранено в БД');
      
      // Отправляем получателю, если он онлайн
      if (onlineUsers[to]) {
        io.to(onlineUsers[to]).emit('private-message', messageData);
        console.log('✅ Сообщение отправлено получателю');
      }
    } catch (error) {
      console.log('❌ Ошибка:', error.message);
    }
  });

  socket.on('disconnect', () => {
    if (socket.userId) {
      console.log(`👋 ${socket.userId} отключился`);
      delete onlineUsers[socket.userId];
      io.emit('user-status', { userId: socket.userId, status: 'offline' });
    }
  });
});