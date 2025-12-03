let localStream = null;
let peers = new Map();
let currentRoomId = null;
let username = null;
let isMuted = false;

// Элементы DOM
let loginScreen, chatScreen, usernameInput, roomIdInput, serverIpInput, joinBtn, createRoomBtn;
let leaveBtn, muteBtn, leaveAudioBtn, usersList, userCount, currentRoomIdSpan, connectionStatus;

// Инициализация после загрузки DOM
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM загружен, инициализация...');
    
    // Получаем элементы DOM
    loginScreen = document.getElementById('login-screen');
    chatScreen = document.getElementById('chat-screen');
    usernameInput = document.getElementById('username');
    roomIdInput = document.getElementById('room-id');
    serverIpInput = document.getElementById('server-ip');
    const serverIpGroup = document.getElementById('server-ip-group');
    joinBtn = document.getElementById('join-btn');
    createRoomBtn = document.getElementById('create-room-btn');
    leaveBtn = document.getElementById('leave-btn');
    muteBtn = document.getElementById('mute-btn');
    leaveAudioBtn = document.getElementById('leave-audio-btn');
    usersList = document.getElementById('users-list');
    userCount = document.getElementById('user-count');
    currentRoomIdSpan = document.getElementById('current-room-id');
    connectionStatus = document.getElementById('connection-status');

    // Скрываем поле IP по умолчанию (можно показать для локального использования)
    // Чтобы показать поле IP, закомментируйте следующую строку:
    if (serverIpGroup) serverIpGroup.style.display = 'none';

    // Проверяем, что все элементы найдены
    if (!loginScreen || !chatScreen || !usernameInput || !roomIdInput || !joinBtn || !createRoomBtn) {
        console.error('Не найдены необходимые элементы DOM!');
        alert('Ошибка загрузки интерфейса. Проверьте консоль.');
        return;
    }

    console.log('Все элементы DOM найдены');
    initializeApp();
});

// Подключение к локальному серверу
let socket;
function initializeApp() {
    console.log('Инициализация приложения...');
    
    // Проверяем наличие Socket.io
    if (typeof io === 'undefined') {
        console.error('Socket.io не загружен!');
        showNotification('Ошибка: Socket.io не загружен. Проверьте интернет-соединение.', 'error');
        // Пробуем подождать и перезагрузить
        setTimeout(() => {
            if (typeof io !== 'undefined') {
                initializeSocket();
            } else {
                console.error('Socket.io всё ещё не загружен после ожидания');
            }
        }, 1000);
        return;
    }

    // Инициализируем подключение при загрузке
    initializeSocket();
}

function initializeSocket() {
    // Если socket уже существует, отключаем его
    if (socket && socket.connected) {
        socket.disconnect();
    }
    
    console.log('Инициализация Socket.io...');
    
    // Адрес облачного сервера (если настроен)
    // Чтобы использовать облачный сервер, раскомментируйте и укажите адрес:
    const CLOUD_SERVER = 'voice-chat-app-production-deba.up.railway.app';
    
    // Получаем IP адрес сервера из поля ввода или используем localhost/облачный сервер
    let defaultServer = 'localhost';
    // Если настроен облачный сервер, раскомментируйте:
    defaultServer = CLOUD_SERVER;
    
    const serverIP = serverIpInput ? (serverIpInput.value.trim() || defaultServer) : defaultServer;
    
    // Определяем протокол и порт
    let serverUrl;
    if (serverIP.includes('localhost') || serverIP.match(/^\d+\.\d+\.\d+\.\d+$/)) {
        // Локальный сервер или IP адрес - используем http и порт 3000
        serverUrl = `http://${serverIP}:3000`;
    } else {
        // Облачный сервер - используем https (Railway, Render и т.д. используют HTTPS)
        serverUrl = `https://${serverIP}`;
    }
    
    console.log('Подключение к серверу:', serverUrl);
    socket = io(serverUrl, {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionAttempts: 5,
        upgrade: true,
        rememberUpgrade: true,
        timeout: 20000
    });

    // Обработка подключения
    socket.on('connect', () => {
        console.log('Подключено к серверу:', socket.id);
        if (connectionStatus) {
            connectionStatus.textContent = 'Готово к подключению';
        }
    });

    socket.on('connect_error', (error) => {
        console.error('Ошибка подключения к серверу:', error);
        console.error('Детали ошибки:', {
            message: error.message,
            type: error.type,
            description: error.description,
            serverUrl: serverUrl
        });
        showNotification(`Не удалось подключиться: ${error.message || 'Проверьте адрес сервера'}`, 'error');
        if (connectionStatus) {
            connectionStatus.textContent = 'Ошибка подключения';
            connectionStatus.className = 'status-indicator';
        }
    });

    socket.on('disconnect', () => {
        console.log('Отключено от сервера');
        if (connectionStatus) {
            connectionStatus.textContent = 'Отключено';
            connectionStatus.className = 'status-indicator';
        }
    });

    // Настраиваем обработчики событий Socket.io для WebRTC
    setupSocketEventListeners();
    
    // Настраиваем обработчики UI
    setupEventListeners();
}

function setupSocketEventListeners() {
    console.log('Настройка обработчиков Socket.io для WebRTC...');
    
    // Обработка нового пользователя
    socket.on('user-joined', async (data) => {
        const { socketId, username: newUsername } = data;
        console.log('Новый пользователь присоединился:', newUsername, socketId);
        
        // Создаем предложение
        const peerConnection = createPeerConnection(socketId);
        peers.set(socketId, peerConnection);

        try {
            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);
            
            socket.emit('offer', {
                target: socketId,
                offer: offer
            });
        } catch (error) {
            console.error('Ошибка создания предложения:', error);
        }
    });

    // Обработка предложения
    socket.on('offer', async (data) => {
        const { offer, sender, username: senderUsername } = data;
        console.log('Получено предложение от:', senderUsername, sender);
        
        const peerConnection = createPeerConnection(sender);
        peers.set(sender, peerConnection);

        try {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            
            socket.emit('answer', {
                target: sender,
                answer: answer
            });
        } catch (error) {
            console.error('Ошибка обработки предложения:', error);
        }
    });

    // Обработка ответа
    socket.on('answer', async (data) => {
        const { answer, sender } = data;
        console.log('Получен ответ от:', sender);
        const peerConnection = peers.get(sender);
        
        if (peerConnection) {
            try {
                await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
            } catch (error) {
                console.error('Ошибка обработки ответа:', error);
            }
        }
    });

    // Обработка ICE кандидатов
    socket.on('ice-candidate', async (data) => {
        const { candidate, sender } = data;
        const peerConnection = peers.get(sender);
        
        if (peerConnection) {
            try {
                await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (error) {
                console.error('Ошибка добавления ICE кандидата:', error);
            }
        }
    });

    // Обновление списка пользователей
    socket.on('room-users', async (users) => {
        console.log('Получен список пользователей:', users);
        updateUsersList(users);
        
        // Создаем peer connections для всех существующих пользователей
        // (кроме себя)
        for (const user of users) {
            if (user.socketId !== socket.id && !peers.has(user.socketId)) {
                console.log('Создание peer connection для существующего пользователя:', user.username, user.socketId);
                
                const peerConnection = createPeerConnection(user.socketId);
                peers.set(user.socketId, peerConnection);
                
                try {
                    const offer = await peerConnection.createOffer();
                    await peerConnection.setLocalDescription(offer);
                    
                    socket.emit('offer', {
                        target: user.socketId,
                        offer: offer
                    });
                } catch (error) {
                    console.error('Ошибка создания предложения для существующего пользователя:', error);
                }
            }
        }
    });

    socket.on('user-left', (socketId) => {
        console.log('Пользователь покинул комнату:', socketId);
        const peerConnection = peers.get(socketId);
        if (peerConnection) {
            peerConnection.close();
            peers.delete(socketId);
        }
        updateUsersList();
    });
    
    console.log('Обработчики Socket.io настроены');
}

function setupEventListeners() {
    console.log('Настройка обработчиков событий...');

    // Создание новой комнаты
    createRoomBtn.addEventListener('click', () => {
        console.log('Создание новой комнаты...');
        const roomId = Math.random().toString(36).substring(2, 10);
        roomIdInput.value = roomId;
        showNotification(`ID комнаты: ${roomId}. Поделитесь этим ID с друзьями!`);
        console.log('ID комнаты создан:', roomId);
        
        // Если имя уже введено, автоматически присоединяемся
        const name = usernameInput.value.trim();
        if (name) {
            console.log('Имя уже введено, автоматическое присоединение...');
            // Небольшая задержка для показа уведомления
            setTimeout(() => {
                joinBtn.click();
            }, 500);
        } else {
            // Фокусируемся на поле имени, чтобы пользователь мог ввести его
            usernameInput.focus();
        }
    });

    // Присоединение к комнате
    joinBtn.addEventListener('click', async () => {
    const name = usernameInput.value.trim();
    const roomId = roomIdInput.value.trim();

    console.log('Попытка присоединения:', { name, roomId, socketConnected: socket ? socket.connected : false });

    if (!name || !roomId) {
        showNotification('Пожалуйста, введите имя и ID комнаты', 'error');
        return;
    }

    // Переподключаемся если IP изменился или нет подключения
    if (!socket || !socket.connected) {
        console.log('Переподключение к серверу...');
        initializeSocket();
        // Ждем подключения
        await new Promise((resolve) => {
            if (socket.connected) {
                resolve();
            } else {
                socket.once('connect', resolve);
                socket.once('connect_error', () => {
                    showNotification('Не удалось подключиться к серверу. Проверьте IP адрес.', 'error');
                    resolve();
                });
                setTimeout(resolve, 3000); // Таймаут 3 секунды
            }
        });
    }

    if (!socket.connected) {
        showNotification('Нет подключения к серверу. Проверьте IP адрес.', 'error');
        return;
    }

    username = name;
    currentRoomId = roomId;

    // Показываем статус загрузки
    joinBtn.disabled = true;
    joinBtn.textContent = 'Подключение...';
    if (connectionStatus) {
        connectionStatus.textContent = 'Запрос доступа к микрофону...';
    }

    try {
        // Получаем доступ к микрофону
        console.log('Запрос доступа к микрофону...');
        localStream = await navigator.mediaDevices.getUserMedia({ 
            audio: true, 
            video: false 
        });
        console.log('Доступ к микрофону получен');

        // Присоединяемся к комнате
        console.log('Присоединение к комнате:', roomId);
        socket.emit('join-room', roomId, username);
        
        loginScreen.classList.remove('active');
        chatScreen.classList.add('active');
        currentRoomIdSpan.textContent = roomId;
        if (connectionStatus) {
            connectionStatus.textContent = 'Подключено';
            connectionStatus.className = 'status-indicator connected';
        }

        showNotification('Вы успешно присоединились к комнате!');
    } catch (error) {
        console.error('Ошибка доступа к микрофону:', error);
        let errorMessage = 'Не удалось получить доступ к микрофону. ';
        if (error.name === 'NotAllowedError') {
            errorMessage += 'Разрешите доступ к микрофону в настройках.';
        } else if (error.name === 'NotFoundError') {
            errorMessage += 'Микрофон не найден.';
        } else {
            errorMessage += 'Проверьте разрешения.';
        }
        showNotification(errorMessage, 'error');
        if (connectionStatus) {
            connectionStatus.textContent = 'Ошибка';
            connectionStatus.className = 'status-indicator';
        }
    } finally {
        joinBtn.disabled = false;
        joinBtn.textContent = 'Присоединиться';
    }
    });

    // Покинуть комнату
    leaveBtn.addEventListener('click', () => {
        leaveRoom();
    });

    // Отключиться от аудио
    leaveAudioBtn.addEventListener('click', () => {
        leaveRoom();
    });

    // Включить/выключить микрофон
    muteBtn.addEventListener('click', () => {
        if (localStream) {
            isMuted = !isMuted;
            localStream.getAudioTracks().forEach(track => {
                track.enabled = !isMuted;
            });
            
            muteBtn.innerHTML = isMuted 
                ? '<span class="icon">🔇</span><span>Включить микрофон</span>'
                : '<span class="icon">🔊</span><span>Выключить микрофон</span>';
            muteBtn.classList.toggle('muted', isMuted);
        }
    });

    // Обработка Enter в полях ввода
    usernameInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') roomIdInput.focus();
    });

    roomIdInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') joinBtn.click();
    });

    console.log('Все обработчики событий настроены');
}

// Покинуть комнату
function leaveRoom() {
    // Останавливаем все соединения
    peers.forEach(peer => {
        peer.close();
    });
    peers.clear();

    // Останавливаем локальный поток
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }

    // Отключаемся от сокета
    if (currentRoomId) {
        socket.emit('leave-room', currentRoomId);
    }

    // Возвращаемся на экран входа
    loginScreen.classList.add('active');
    chatScreen.classList.remove('active');
    currentRoomId = null;
    username = null;
    usersList.innerHTML = '';
    isMuted = false;
}

// Создание WebRTC соединения
function createPeerConnection(targetSocketId) {
    const peerConnection = new RTCPeerConnection({
        iceServers: [
            // STUN серверы (для определения публичного IP)
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
            { urls: 'stun:stun3.l.google.com:19302' },
            { urls: 'stun:stun4.l.google.com:19302' },
            // Публичные TURN серверы (для обхода NAT и файрволов)
            // Используем бесплатные публичные серверы
            {
                urls: 'turn:openrelay.metered.ca:80',
                username: 'openrelayproject',
                credential: 'openrelayproject'
            },
            {
                urls: 'turn:openrelay.metered.ca:443',
                username: 'openrelayproject',
                credential: 'openrelayproject'
            },
            {
                urls: 'turn:openrelay.metered.ca:443?transport=tcp',
                username: 'openrelayproject',
                credential: 'openrelayproject'
            }
        ],
        iceCandidatePoolSize: 10
    });

    // Добавляем локальный поток
    if (localStream) {
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });
    }

    // Обработка входящего аудио
    peerConnection.ontrack = (event) => {
        console.log('Получен аудио поток от:', targetSocketId);
        const [remoteStream] = event.streams;
        // Создаем audio элемент для воспроизведения
        const audio = new Audio();
        audio.srcObject = remoteStream;
        audio.autoplay = true;
        audio.play().catch(err => {
            console.error('Ошибка воспроизведения аудио:', err);
        });
    };

    // Обработка ICE кандидатов
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice-candidate', {
                target: targetSocketId,
                candidate: event.candidate
            });
        }
    };

    return peerConnection;
}

// Обработчики Socket.io теперь в setupSocketEventListeners()

function updateUsersList(users = null) {
    if (users) {
        usersList.innerHTML = '';
        users.forEach(user => {
            const li = document.createElement('li');
            li.textContent = user.username;
            if (user.socketId === socket.id) {
                li.classList.add('current-user');
            }
            usersList.appendChild(li);
        });
        userCount.textContent = users.length;
    }
}

// Уведомления
function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    document.body.appendChild(notification);

    setTimeout(() => {
        notification.classList.add('show');
    }, 10);

    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => {
            document.body.removeChild(notification);
        }, 300);
    }, 3000);
}

