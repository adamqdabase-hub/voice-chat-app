// Медиа-сервер с mediasoup для ретрансляции аудио потоков
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
const mediasoup = require('mediasoup');

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

// Middleware для установки CSP заголовков
app.use((req, res, next) => {
  if (req.path.endsWith('.html') || req.path === '/' || req.path === '') {
    res.setHeader('Content-Security-Policy', 
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.socket.io https://*.socket.io https://cdn.jsdelivr.net chrome-extension://* edge-extension://*; " +
      "connect-src 'self' ws://* wss://* http://* https://* chrome-extension://* edge-extension://*; " +
      "style-src 'self' 'unsafe-inline' chrome-extension://* edge-extension://*; " +
      "img-src 'self' data: https: chrome-extension://* edge-extension://*; " +
      "font-src 'self' data: chrome-extension://* edge-extension://*; " +
      "media-src 'self' blob: mediastream: chrome-extension://* edge-extension://*; " +
      "default-src 'self' chrome-extension://* edge-extension://*"
    );
  }
  next();
});

// Статические файлы
app.use(express.static(path.join(__dirname, 'public')));

// Простой endpoint для проверки работы
app.get('/', (req, res) => {
  res.json({ 
    status: 'online', 
    message: 'Voice Chat Media Server is running',
    rooms: rooms.size
  });
});

// Хранилище комнат и пользователей
const rooms = new Map();

// Mediasoup Worker
let worker = null;

// Инициализация mediasoup
async function initMediasoup() {
  try {
    worker = await mediasoup.createWorker({
      logLevel: 'warn',
      rtcMinPort: 40000,
      rtcMaxPort: 40100,
    });
    
    console.log('✅ Mediasoup Worker создан');
    
    worker.on('died', () => {
      console.error('❌ Mediasoup Worker умер, перезапускаем...');
      setTimeout(() => initMediasoup(), 2000);
    });
  } catch (error) {
    console.error('❌ Ошибка создания Mediasoup Worker:', error);
    throw error;
  }
}

// Хранилище медиа-роутеров для комнат
const mediaRouters = new Map();

// Получить или создать медиа-роутер для комнаты
async function getOrCreateRouter(roomId) {
  if (mediaRouters.has(roomId)) {
    return mediaRouters.get(roomId);
  }
  
  const router = await worker.createRouter({
    mediaCodecs: [
      {
        kind: 'audio',
        mimeType: 'audio/opus',
        clockRate: 48000,
        channels: 2
      }
    ]
  });
  
  mediaRouters.set(roomId, router);
  console.log(`✅ Медиа-роутер создан для комнаты: ${roomId}`);
  
  return router;
}

// Хранилище транспортов для каждого пользователя
const userTransports = new Map(); // socketId -> { sendTransport, recvTransport, producers, consumers }

io.on('connection', async (socket) => {
  console.log('Пользователь подключился:', socket.id);

  // Присоединение к комнате
  socket.on('join-room', async (roomId, username) => {
    try {
      socket.join(roomId);
      socket.roomId = roomId;
      socket.username = username;

      if (!rooms.has(roomId)) {
        rooms.set(roomId, new Map());
      }

      const room = rooms.get(roomId);
      room.set(socket.id, { username, socketId: socket.id });

      // Получаем или создаем медиа-роутер для комнаты
      const router = await getOrCreateRouter(roomId);

      // Создаем транспорт для отправки (send)
      const sendTransport = await router.createWebRtcTransport({
        listenIps: [{ ip: '0.0.0.0', announcedIp: null }],
        enableUdp: true,
        enableTcp: true,
        preferUdp: true,
      });

      // Создаем транспорт для получения (receive)
      const recvTransport = await router.createWebRtcTransport({
        listenIps: [{ ip: '0.0.0.0', announcedIp: null }],
        enableUdp: true,
        enableTcp: true,
        preferUdp: true,
      });

      // Сохраняем транспорты
      userTransports.set(socket.id, {
        sendTransport,
        recvTransport,
        router,
        producers: new Map(),
        consumers: new Map(),
      });

      // Отправляем информацию о транспортах и RTP capabilities клиенту
      socket.emit('transport-created', {
        sendTransport: {
          id: sendTransport.id,
          iceParameters: sendTransport.iceParameters,
          iceCandidates: sendTransport.iceCandidates,
          dtlsParameters: sendTransport.dtlsParameters,
        },
        recvTransport: {
          id: recvTransport.id,
          iceParameters: recvTransport.iceParameters,
          iceCandidates: recvTransport.iceCandidates,
          dtlsParameters: recvTransport.dtlsParameters,
        },
        rtpCapabilities: router.rtpCapabilities,
      });

      // Обработка ICE кандидатов от клиента для send transport
      socket.on('connect-send-transport', async ({ dtlsParameters }, callback) => {
        try {
          const userTransport = userTransports.get(socket.id);
          if (!userTransport) {
            return callback({ error: 'Transport not found' });
          }
          await userTransport.sendTransport.connect({ dtlsParameters });
          callback({ success: true });
        } catch (error) {
          console.error('Ошибка подключения send transport:', error);
          callback({ error: error.message });
        }
      });

      // Обработка ICE кандидатов от клиента для recv transport
      socket.on('connect-recv-transport', async ({ dtlsParameters }, callback) => {
        try {
          const userTransport = userTransports.get(socket.id);
          if (!userTransport) {
            return callback({ error: 'Transport not found' });
          }
          await userTransport.recvTransport.connect({ dtlsParameters });
          callback({ success: true });
        } catch (error) {
          console.error('Ошибка подключения recv transport:', error);
          callback({ error: error.message });
        }
      });

      // Создание producer (отправка аудио)
      socket.on('produce', async ({ kind, rtpParameters }, callback) => {
        try {
          const userTransport = userTransports.get(socket.id);
          if (!userTransport) {
            return callback({ error: 'Transport not found' });
          }

          const producer = await userTransport.sendTransport.produce({
            kind,
            rtpParameters,
          });

          userTransport.producers.set(producer.id, producer);

          // Уведомляем других пользователей в комнате о новом producer
          socket.to(roomId).emit('new-producer', {
            producerId: producer.id,
            socketId: socket.id,
            username: username,
            kind: kind,
          });

          callback({ id: producer.id });

      // Уведомляем других пользователей о новом producer
      socket.to(roomId).emit('new-producer', {
        producerId: producer.id,
        socketId: socket.id,
        username: username,
        kind: kind,
      });
        } catch (error) {
          console.error('Ошибка создания producer:', error);
          callback({ error: error.message });
        }
      });

      // Создание consumer (получение аудио)
      socket.on('consume', async ({ producerId, rtpCapabilities }, callback) => {
        try {
          const userTransport = userTransports.get(socket.id);
          if (!userTransport) {
            return callback({ error: 'Transport not found' });
          }

          // Находим producer
          let producer = null;
          for (const [sid, transport] of userTransports) {
            if (transport.producers.has(producerId)) {
              producer = transport.producers.get(producerId);
              break;
            }
          }

          if (!producer) {
            return callback({ error: 'Producer not found' });
          }

          if (!userTransport.router.canConsume({ producerId, rtpCapabilities })) {
            return callback({ error: 'Cannot consume' });
          }

          const consumer = await userTransport.recvTransport.consume({
            producerId,
            rtpCapabilities,
          });

          userTransport.consumers.set(consumer.id, consumer);

          callback({
            id: consumer.id,
            producerId: consumer.producerId,
            kind: consumer.kind,
            rtpParameters: consumer.rtpParameters,
          });
        } catch (error) {
          console.error('Ошибка создания consumer:', error);
          callback({ error: error.message });
        }
      });

      // Уведомляем других пользователей в комнате
      socket.to(roomId).emit('user-joined', {
        socketId: socket.id,
        username: username
      });

      // Отправляем список пользователей новому участнику
      const users = Array.from(room.values());
      socket.emit('room-users', users);
      
      // Также отправляем обновленный список всем в комнате
      io.to(roomId).emit('room-users', users);

      console.log(`${username} присоединился к комнате ${roomId}`);
    } catch (error) {
      console.error('Ошибка присоединения к комнате:', error);
      socket.emit('error', { message: error.message });
    }
  });

  socket.on('get-room-users', (roomId) => {
    if (rooms.has(roomId)) {
      const users = Array.from(rooms.get(roomId).values());
      socket.emit('room-users', users);
    }
  });

  // Отключение
  socket.on('disconnect', () => {
    const userTransport = userTransports.get(socket.id);
    if (userTransport) {
      // Закрываем все producers и consumers
      userTransport.producers.forEach(producer => producer.close());
      userTransport.consumers.forEach(consumer => consumer.close());
      userTransport.sendTransport.close();
      userTransport.recvTransport.close();
      userTransports.delete(socket.id);
    }

    if (socket.roomId) {
      const room = rooms.get(socket.roomId);
      if (room) {
        room.delete(socket.id);
        socket.to(socket.roomId).emit('user-left', socket.id);
        
        // Удаляем комнату, если она пуста
        if (room.size === 0) {
          rooms.delete(socket.roomId);
          const router = mediaRouters.get(socket.roomId);
          if (router) {
            router.close();
            mediaRouters.delete(socket.roomId);
          }
        }
      }
    }
    console.log('Пользователь отключился:', socket.id);
  });
});


// Порт берется из переменной окружения или используется 3000
const PORT = process.env.PORT || 3000;

// Инициализация mediasoup и запуск сервера
initMediasoup().then(() => {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Сервер запущен на порту ${PORT}`);
    console.log(`Готов к подключениям!`);
    console.log(`Используется медиа-сервер (SFU) для ретрансляции аудио`);
  });
}).catch((error) => {
  console.error('❌ Ошибка инициализации сервера:', error);
  process.exit(1);
});



