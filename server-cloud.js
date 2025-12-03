// Облачная версия сервера для хостинга (Railway, Render, Heroku и т.д.)
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);

// Настройка CORS для Socket.io
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true
  },
  allowEIO3: true,
  transports: ['websocket', 'polling']
});

app.use(cors());
app.use(express.json());

// Хранилище комнат и пользователей (должно быть объявлено до использования)
const rooms = new Map();

// Статические файлы (если нужно)
app.use(express.static(path.join(__dirname, 'public')));

// Простой endpoint для проверки работы
app.get('/', (req, res) => {
  res.json({ 
    status: 'online', 
    message: 'Voice Chat Server is running',
    rooms: rooms.size
  });
});

io.on('connection', (socket) => {
  console.log('Пользователь подключился:', socket.id);

  // Присоединение к комнате
  socket.on('join-room', (roomId, username) => {
    socket.join(roomId);
    socket.roomId = roomId;
    socket.username = username;

    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Map());
    }

    const room = rooms.get(roomId);
    room.set(socket.id, { username, socketId: socket.id });

    // Уведомляем других пользователей в комнате
    socket.to(roomId).emit('user-joined', {
      socketId: socket.id,
      username: username
    });

    // Отправляем список пользователей новому участнику
    const users = Array.from(room.values());
    socket.emit('room-users', users);

    console.log(`${username} присоединился к комнате ${roomId}`);
  });

  // WebRTC сигналинг - предложение
  socket.on('offer', (data) => {
    socket.to(data.target).emit('offer', {
      offer: data.offer,
      sender: socket.id,
      username: socket.username
    });
  });

  // WebRTC сигналинг - ответ
  socket.on('answer', (data) => {
    socket.to(data.target).emit('answer', {
      answer: data.answer,
      sender: socket.id
    });
  });

  // WebRTC сигналинг - ICE кандидаты
  socket.on('ice-candidate', (data) => {
    socket.to(data.target).emit('ice-candidate', {
      candidate: data.candidate,
      sender: socket.id
    });
  });

  // Отключение
  socket.on('disconnect', () => {
    if (socket.roomId) {
      const room = rooms.get(socket.roomId);
      if (room) {
        room.delete(socket.id);
        socket.to(socket.roomId).emit('user-left', socket.id);
        
        // Удаляем комнату, если она пуста
        if (room.size === 0) {
          rooms.delete(socket.roomId);
        }
      }
    }
    console.log('Пользователь отключился:', socket.id);
  });
});

// Порт берется из переменной окружения или используется 3000
const PORT = process.env.PORT || 3000;

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Сервер запущен на порту ${PORT}`);
  console.log(`Готов к подключениям!`);
});

