// Упрощенный медиа-сервер для ретрансляции аудио потоков
// Вместо P2P, все потоки идут через сервер
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);

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

app.use((req, res, next) => {
  if (req.path.endsWith('.html') || req.path === '/' || req.path === '') {
    res.setHeader('Content-Security-Policy', 
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.socket.io https://*.socket.io chrome-extension://*; " +
      "connect-src 'self' ws://* wss://* http://* https://* chrome-extension://*; " +
      "style-src 'self' 'unsafe-inline' chrome-extension://*; " +
      "img-src 'self' data: https: chrome-extension://*; " +
      "font-src 'self' data: chrome-extension://*; " +
      "media-src 'self' blob: mediastream: chrome-extension://*; " +
      "default-src 'self' chrome-extension://*"
    );
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

const rooms = new Map();

app.get('/', (req, res) => {
  res.json({ 
    status: 'online', 
    message: 'Simple Media Server is running',
    rooms: rooms.size
  });
});

// Хранилище peer connections на сервере (как ретранслятор)
const serverPeerConnections = new Map(); // socketId -> { pc, localStream }

io.on('connection', (socket) => {
  console.log('Пользователь подключился:', socket.id);

  socket.on('join-room', (roomId, username) => {
    socket.join(roomId);
    socket.roomId = roomId;
    socket.username = username;

    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Map());
    }

    const room = rooms.get(roomId);
    room.set(socket.id, { username, socketId: socket.id });

    // Уведомляем других пользователей
    socket.to(roomId).emit('user-joined', {
      socketId: socket.id,
      username: username
    });

    const users = Array.from(room.values());
    socket.emit('room-users', users);

    console.log(`${username} присоединился к комнате ${roomId}`);
  });

  // WebRTC сигналинг через сервер (как ретранслятор)
  socket.on('offer', (data) => {
    console.log(`📤 [SERVER] Offer от ${socket.id} для ${data.target}`);
    if (!data.target) {
      console.error('❌ [SERVER] Offer без target!', data);
      return;
    }
    socket.to(data.target).emit('offer', {
      offer: data.offer,
      sender: socket.id,
      username: socket.username
    });
    console.log(`✅ [SERVER] Offer переслан от ${socket.id} для ${data.target}`);
  });

  socket.on('answer', (data) => {
    console.log(`📥 [SERVER] Answer от ${socket.id} для ${data.target}`);
    if (!data.target) {
      console.error('❌ [SERVER] Answer без target!', data);
      return;
    }
    socket.to(data.target).emit('answer', {
      answer: data.answer,
      sender: socket.id
    });
    console.log(`✅ [SERVER] Answer переслан от ${socket.id} для ${data.target}`);
  });

  socket.on('ice-candidate', (data) => {
    console.log(`🧊 [SERVER] ICE candidate от ${socket.id} для ${data.target}`);
    if (!data.target) {
      console.error('❌ [SERVER] ICE candidate без target!', data);
      return;
    }
    socket.to(data.target).emit('ice-candidate', {
      candidate: data.candidate,
      sender: socket.id
    });
    console.log(`✅ [SERVER] ICE candidate переслан от ${socket.id} для ${data.target}`);
  });

  socket.on('disconnect', () => {
    if (socket.roomId) {
      const room = rooms.get(socket.roomId);
      if (room) {
        room.delete(socket.id);
        socket.to(socket.roomId).emit('user-left', socket.id);
        
        if (room.size === 0) {
          rooms.delete(socket.roomId);
        }
      }
    }
    console.log('Пользователь отключился:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Сервер запущен на порту ${PORT}`);
  console.log(`Готов к подключениям!`);
  console.log(`Используется упрощенный медиа-сервер (сигналинг через сервер)`);
});

