const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

let mainWindow = null;
let server = null;
let io = null;

// Создание Express сервера
function createServer() {
  const expressApp = express();
  expressApp.use(cors());
  expressApp.use(express.static(path.join(__dirname, 'public')));

  server = http.createServer(expressApp);
  io = socketIo(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  // Хранилище комнат и пользователей
  const rooms = new Map();

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

  const PORT = 3000;
  // Слушаем на всех интерфейсах (0.0.0.0) чтобы принимать подключения из сети
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Сервер запущен на порту ${PORT}`);
    console.log(`Доступен по адресу: http://localhost:${PORT}`);
    
    // Получаем локальный IP адрес для подключения из сети
    const os = require('os');
    const networkInterfaces = os.networkInterfaces();
    let localIP = null;
    
    for (const interfaceName in networkInterfaces) {
      const interfaces = networkInterfaces[interfaceName];
      for (const iface of interfaces) {
        // Пропускаем внутренние и не-IPv4 адреса
        if (iface.family === 'IPv4' && !iface.internal) {
          localIP = iface.address;
          break;
        }
      }
      if (localIP) break;
    }
    
    if (localIP) {
      console.log(`Для подключения из сети используйте: http://${localIP}:${PORT}`);
    }
  });
}

// Создание окна приложения
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, 'assets', 'icon.png'),
    titleBarStyle: 'default',
    show: false
  });

  // Загружаем HTML файл
  mainWindow.loadFile('public/index.html');

  // Показываем окно когда готово
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    
    // Всегда открываем DevTools для отладки
    mainWindow.webContents.openDevTools();
  });

  // Обработка ошибок загрузки
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('Ошибка загрузки:', errorCode, errorDescription);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Инициализация приложения
app.whenReady().then(() => {
  // Сначала создаем сервер, потом окно
  createServer();
  
  // Небольшая задержка, чтобы сервер успел запуститься
  setTimeout(() => {
    createWindow();
  }, 500);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (server) {
    server.close();
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (server) {
    server.close();
  }
});


