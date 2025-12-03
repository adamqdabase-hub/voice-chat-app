let localStream = null;
let peers = new Map();
let audioElements = new Map(); // Хранилище audio элементов для воспроизведения
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
        
        // Проверяем, что это не мы сами
        if (socketId === socket.id) {
            console.log('Игнорируем событие user-joined для себя');
            return;
        }
        
        // Обновляем список пользователей - добавляем нового пользователя
        if (usersList) {
            const existingUsers = Array.from(usersList.querySelectorAll('li')).map(li => li.textContent);
            if (!existingUsers.some(name => name.includes(newUsername))) {
                const li = document.createElement('li');
                li.textContent = newUsername;
                usersList.appendChild(li);
                if (userCount) {
                    const currentCount = parseInt(userCount.textContent) || 1;
                    userCount.textContent = currentCount + 1;
                }
                console.log('Добавлен новый пользователь в список:', newUsername);
            }
        }
        
        // Проверяем, что соединение еще не создано
        if (peers.has(socketId)) {
            console.log('Peer connection уже существует для:', socketId);
            return;
        }
        
        // Определяем, кто создает offer (пользователь с меньшим socket.id)
        // Это предотвращает одновременное создание offer обоими пользователями
        if (socket.id < socketId) {
            console.log('Мы создаем offer для:', socketId, '(наш ID меньше)');
            // Создаем предложение
            const peerConnection = createPeerConnection(socketId);
            peers.set(socketId, peerConnection);

            try {
                const offer = await peerConnection.createOffer();
                await peerConnection.setLocalDescription(offer);
                
                console.log('📤 Отправка предложения (offer) для:', socketId);
                console.log('📤 Offer данные:', offer);
                console.log('📤 Socket connected:', socket.connected);
                console.log('📤 Socket id:', socket.id);
                
                if (!socket.connected) {
                    console.error('❌ Socket не подключен! Не могу отправить offer');
                    return;
                }
                
                socket.emit('offer', {
                    target: socketId,
                    offer: offer
                });
                console.log('✅ Offer отправлен для:', socketId);
            } catch (error) {
                console.error('Ошибка создания предложения:', error);
            }
        } else {
            console.log('Ждем offer от:', socketId, '(их ID меньше)');
            // Создаем peer connection, но ждем offer от другого пользователя
            const peerConnection = createPeerConnection(socketId);
            peers.set(socketId, peerConnection);
        }
    });

    // Обработка предложения
    socket.on('offer', async (data) => {
        const { offer, sender, username: senderUsername } = data;
        console.log('📥 ===== ПОЛУЧЕНО ПРЕДЛОЖЕНИЕ (OFFER) =====');
        console.log('📥 Получено предложение от:', senderUsername, sender);
        console.log('📥 Offer данные:', offer);
        
        // Проверяем, что соединение еще не создано или в неправильном состоянии
        if (peers.has(sender)) {
            console.log('Peer connection уже существует для предложения от:', sender);
            const existingPeer = peers.get(sender);
            const state = existingPeer.signalingState;
            console.log('Текущее состояние соединения:', state);
            
            // Если соединение уже установлено (stable), проверяем remote description
            if (state === 'stable') {
                const remoteDesc = existingPeer.remoteDescription;
                if (remoteDesc) {
                    console.log('Соединение уже установлено (stable) для:', sender, '- игнорируем новое предложение');
                    return;
                } else {
                    console.warn('⚠️ Соединение stable, но remote description null! Пересоздаем соединение для:', sender);
                    existingPeer.close();
                    peers.delete(sender);
                    // Также удаляем audio элемент
                    if (audioElements && audioElements.has(sender)) {
                        const audio = audioElements.get(sender);
                        audio.pause();
                        audio.srcObject = null;
                        audioElements.delete(sender);
                    }
                    // Продолжаем обработку offer ниже - создаем новое соединение
                }
            } else if (state === 'have-local-offer') {
                // Если в процессе установки с локальным offer, пересоздаем
                console.log('Пересоздаем соединение из-за неправильного состояния:', state);
                existingPeer.close();
                peers.delete(sender);
                // Также удаляем audio элемент
                if (audioElements && audioElements.has(sender)) {
                    const audio = audioElements.get(sender);
                    audio.pause();
                    audio.srcObject = null;
                    audioElements.delete(sender);
                }
                // Продолжаем обработку offer ниже - создаем новое соединение
            } else if (state === 'have-remote-offer') {
                // Если уже есть remote offer, значит мы уже обрабатываем предложение
                console.log('Игнорируем предложение, уже обрабатываем remote offer');
                return;
            } else {
                console.log('Игнорируем предложение, соединение уже в процессе установки, состояние:', state);
                return;
            }
        }
        
        const peerConnection = createPeerConnection(sender);
        peers.set(sender, peerConnection);

        try {
            console.log('📤 Установка remote description (offer) от:', sender);
            await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
            console.log('✅ Remote description установлен, состояние:', peerConnection.signalingState);
            
            // Добавляем сохраненные ICE кандидаты, если есть
            if (peerConnection.pendingIceCandidates && peerConnection.pendingIceCandidates.length > 0) {
                console.log('💾 Добавляем сохраненные ICE кандидаты:', peerConnection.pendingIceCandidates.length);
                for (const candidate of peerConnection.pendingIceCandidates) {
                    try {
                        await peerConnection.addIceCandidate(candidate);
                        console.log('✅ Сохраненный ICE кандидат добавлен');
                    } catch (error) {
                        console.error('❌ Ошибка добавления сохраненного ICE кандидата:', error);
                    }
                }
                peerConnection.pendingIceCandidates = [];
            }
            
            console.log('📤 Создание answer для:', sender);
            const answer = await peerConnection.createAnswer();
            console.log('✅ Answer создан:', answer);
            
            console.log('📤 Установка local description (answer) для:', sender);
            await peerConnection.setLocalDescription(answer);
            console.log('✅ Local description установлен, состояние:', peerConnection.signalingState);
            
            console.log('📤 Отправка ответа (answer) для:', sender);
            console.log('📤 Socket connected:', socket.connected);
            console.log('📤 Socket id:', socket.id);
            
            if (!socket.connected) {
                console.error('❌ Socket не подключен! Не могу отправить answer');
                return;
            }
            
            socket.emit('answer', {
                target: sender,
                answer: answer
            });
            console.log('✅ Answer отправлен для:', sender);
        } catch (error) {
            console.error('❌ Ошибка обработки предложения:', error);
            console.error('❌ Детали ошибки:', error.message, error.stack);
            // Очищаем соединение при ошибке
            peerConnection.close();
            peers.delete(sender);
        }
    });

    // Обработка ответа
    socket.on('answer', async (data) => {
        const { answer, sender } = data;
        console.log('📥 Получен ответ (answer) от:', sender);
        console.log('📥 Данные answer:', answer);
        const peerConnection = peers.get(sender);
        
        if (peerConnection) {
            console.log('📥 Текущее состояние peer connection:', peerConnection.signalingState);
            try {
                // Проверяем состояние перед установкой
                if (peerConnection.signalingState === 'have-local-offer') {
                    await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
                    console.log('✅ Ответ успешно установлен для:', sender);
                    console.log('✅ Новое состояние после установки answer:', peerConnection.signalingState);
                } else {
                    console.warn('⚠️ Неправильное состояние peer connection для ответа:', peerConnection.signalingState, 'от', sender);
                    console.warn('⚠️ Ожидалось: have-local-offer, получено:', peerConnection.signalingState);
                }
            } catch (error) {
                console.error('❌ Ошибка обработки ответа:', error);
                console.error('❌ Детали ошибки:', error.message, error.stack);
                // Пробуем пересоздать соединение
                console.log('🔄 Попытка пересоздания соединения для:', sender);
                if (peers.has(sender)) {
                    peers.get(sender).close();
                    peers.delete(sender);
                }
            }
        } else {
            console.error('❌ Peer connection не найдена для ответа от:', sender);
            console.error('❌ Доступные peer connections:', Array.from(peers.keys()));
        }
    });

    // Обработка ICE кандидатов
    socket.on('ice-candidate', async (data) => {
        const { candidate, sender } = data;
        console.log('🧊 Получен ICE кандидат от:', sender);
        console.log('🧊 ICE кандидат:', candidate);
        const peerConnection = peers.get(sender);
        
        if (peerConnection) {
            console.log('🧊 Текущее состояние peer connection:', peerConnection.signalingState);
            console.log('🧊 Текущее состояние ICE:', peerConnection.iceConnectionState);
            console.log('🧊 Remote description:', peerConnection.remoteDescription ? 'установлен' : 'null');
            
            // Проверяем, установлен ли remote description
            if (!peerConnection.remoteDescription) {
                console.warn('⚠️ Remote description не установлен! Сохраняем кандидат для добавления позже');
                // Сохраняем кандидат для добавления после установки remote description
                if (!peerConnection.pendingIceCandidates) {
                    peerConnection.pendingIceCandidates = [];
                }
                peerConnection.pendingIceCandidates.push(new RTCIceCandidate(candidate));
                console.log('💾 ICE кандидат сохранен, будет добавлен после установки remote description');
                return;
            }
            
            try {
                await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
                console.log('✅ ICE кандидат успешно добавлен от:', sender);
            } catch (error) {
                console.error('❌ Ошибка добавления ICE кандидата:', error);
                console.error('❌ Детали ошибки:', error.message);
            }
        } else {
            console.warn('⚠️ Peer connection не найдена для ICE кандидата от:', sender);
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
                
                // Небольшая задержка, чтобы убедиться, что localStream готов
                await new Promise(resolve => setTimeout(resolve, 100));
                
                // Определяем, кто создает offer (пользователь с меньшим socket.id)
                if (socket.id < user.socketId) {
                    console.log('Мы создаем offer для существующего пользователя:', user.socketId);
                    const peerConnection = createPeerConnection(user.socketId);
                    peers.set(user.socketId, peerConnection);
                    
                    try {
                        const offer = await peerConnection.createOffer();
                        await peerConnection.setLocalDescription(offer);
                        
                        console.log('Отправка предложения для существующего пользователя:', user.socketId);
                        socket.emit('offer', {
                            target: user.socketId,
                            offer: offer
                        });
                    } catch (error) {
                        console.error('Ошибка создания предложения для существующего пользователя:', error);
                    }
                } else {
                    console.log('Ждем offer от существующего пользователя:', user.socketId);
                    // Создаем peer connection, но ждем offer от другого пользователя
                    const peerConnection = createPeerConnection(user.socketId);
                    peers.set(user.socketId, peerConnection);
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
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }, 
            video: false 
        });
        console.log('Доступ к микрофону получен');
        
        // Проверяем, что микрофон работает
        const audioTracks = localStream.getAudioTracks();
        if (audioTracks.length > 0) {
            const track = audioTracks[0];
            console.log('Микрофон активен:', track.label);
            console.log('Микрофон включен:', track.enabled);
            console.log('Микрофон muted:', track.muted);
            console.log('Микрофон readyState:', track.readyState);
            
            // Убеждаемся, что микрофон не muted
            if (track.muted) {
                console.warn('Микрофон muted! Пытаемся размутить...');
                track.enabled = true;
            }
            
            // Слушаем изменения состояния
            track.onmute = () => {
                console.warn('Микрофон был заглушен!');
            };
            
            track.onunmute = () => {
                console.log('Микрофон размучен');
            };
        } else {
            console.warn('Микрофон не найден!');
        }

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

    // Останавливаем все audio элементы
    audioElements.forEach(audio => {
        audio.pause();
        audio.srcObject = null;
    });
    audioElements.clear();

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
            },
            {
                urls: 'turn:openrelay.metered.ca:80?transport=tcp',
                username: 'openrelayproject',
                credential: 'openrelayproject'
            },
            // Дополнительные TURN серверы
            {
                urls: 'turn:relay.metered.ca:80',
                username: 'openrelayproject',
                credential: 'openrelayproject'
            },
            {
                urls: 'turn:relay.metered.ca:443',
                username: 'openrelayproject',
                credential: 'openrelayproject'
            },
            {
                urls: 'turn:relay.metered.ca:80?transport=tcp',
                username: 'openrelayproject',
                credential: 'openrelayproject'
            },
            {
                urls: 'turn:relay.metered.ca:443?transport=tcp',
                username: 'openrelayproject',
                credential: 'openrelayproject'
            }
        ],
        iceCandidatePoolSize: 10,
        iceTransportPolicy: 'all' // Используем и STUN и TURN
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
        
        // Проверяем, что поток содержит аудио треки
        const audioTracks = remoteStream.getAudioTracks();
        console.log('Получено аудио треков:', audioTracks.length);
        if (audioTracks.length === 0) {
            console.warn('Поток не содержит аудио треков!');
            return;
        }
        
        // Логируем состояние треков и размучиваем если нужно
        audioTracks.forEach(track => {
            console.log('🎵 Аудио трек:', track.label, 'включен:', track.enabled, 'muted:', track.muted, 'readyState:', track.readyState);
            
            // Отслеживаем изменения состояния трека
            track.onmute = () => {
                console.warn('⚠️ Трек был заглушен (muted) для:', targetSocketId);
                console.warn('Текущее состояние - muted:', track.muted, 'enabled:', track.enabled);
            };
            
            track.onunmute = () => {
                console.log('✅ Трек размучен (unmuted) для:', targetSocketId);
                console.log('Текущее состояние - muted:', track.muted, 'enabled:', track.enabled);
            };
            
            // Отслеживаем изменения enabled
            track.onended = () => {
                console.warn('⚠️ Трек завершен для:', targetSocketId);
            };
            
            // Периодически проверяем состояние трека (каждые 5 секунд)
            const checkInterval = setInterval(() => {
                if (track.readyState === 'ended') {
                    clearInterval(checkInterval);
                    return;
                }
                console.log('🔄 Проверка трека:', track.label, 'muted:', track.muted, 'enabled:', track.enabled, 'readyState:', track.readyState);
            }, 5000);
            
            // Если трек muted, пытаемся размутить
            if (track.muted) {
                console.warn('⚠️ Аудио трек muted! Пытаемся размутить...');
                // Пытаемся размутить через изменение enabled
                track.enabled = true;
                // Также пробуем через setEnabled если доступно
                if (typeof track.setEnabled === 'function') {
                    track.setEnabled(true);
                }
                
                // Пробуем принудительно размутить через изменение muted (если возможно)
                try {
                    // Это может не сработать, но попробуем
                    Object.defineProperty(track, 'muted', {
                        writable: true,
                        value: false
                    });
                } catch (e) {
                    // Игнорируем ошибку
                }
                
                // Проверяем через небольшую задержку
                setTimeout(() => {
                    if (track.muted) {
                        console.error('❌ Трек все еще muted после попытки размутить');
                        console.error('⚠️ ВАЖНО: Микрофон друга заглушен в системе или браузере!');
                        console.error('Попросите друга:');
                        console.error('1. Проверить настройки микрофона в Windows');
                        console.error('2. Проверить разрешения браузера для микрофона');
                        console.error('3. Убедиться, что микрофон не отключен физически');
                        console.error('💡 Состояние трека будет отслеживаться - если друг размутит микрофон, вы увидите сообщение');
                    } else {
                        console.log('✅ Трек успешно размучен');
                    }
                }, 300);
            } else {
                console.log('✅ Аудио трек не muted - готов к воспроизведению');
            }
        });
        
        // Удаляем старый audio элемент, если есть
        if (audioElements.has(targetSocketId)) {
            const oldAudio = audioElements.get(targetSocketId);
            oldAudio.pause();
            oldAudio.srcObject = null;
            audioElements.delete(targetSocketId);
        }
        
        // Создаем новый audio элемент для воспроизведения
        const audio = new Audio();
        audio.srcObject = remoteStream;
        audio.autoplay = true;
        audio.volume = 1.0;
        
        // Обработчики для отладки
        audio.onloadedmetadata = () => {
            console.log('Метаданные аудио загружены для:', targetSocketId, 'длительность:', audio.duration);
        };
        
        audio.oncanplay = () => {
            console.log('Аудио готово к воспроизведению для:', targetSocketId);
        };
        
        audio.onplay = () => {
            console.log('Аудио начато воспроизведение для:', targetSocketId);
        };
        
        audio.onerror = (e) => {
            console.error('Ошибка audio элемента для:', targetSocketId, e);
        };
        
        // Сохраняем для последующего управления
        audioElements.set(targetSocketId, audio);
        
        // Воспроизводим
        audio.play().then(() => {
            console.log('Аудио успешно воспроизводится от:', targetSocketId);
            console.log('Громкость:', audio.volume, 'Воспроизведение:', !audio.paused, 'muted:', audio.muted);
        }).catch(err => {
            console.error('Ошибка воспроизведения аудио:', err);
            // Пробуем еще раз после взаимодействия пользователя
            const playOnClick = () => {
                audio.play().then(() => {
                    console.log('Аудио воспроизведено после клика');
                }).catch(e => console.error('Повторная ошибка воспроизведения:', e));
            };
            document.addEventListener('click', playOnClick, { once: true });
            document.addEventListener('touchstart', playOnClick, { once: true });
        });
    };

    // Обработка ICE кандидатов
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            console.log('🧊 Локальный ICE кандидат создан для:', targetSocketId);
            console.log('🧊 ICE кандидат:', event.candidate);
            console.log('🧊 Socket connected:', socket.connected);
            
            if (!socket.connected) {
                console.error('❌ Socket не подключен! Не могу отправить ICE candidate');
                return;
            }
            
            socket.emit('ice-candidate', {
                target: targetSocketId,
                candidate: event.candidate
            });
            console.log('✅ ICE кандидат отправлен для:', targetSocketId);
        } else {
            console.log('🧊 Все ICE кандидаты собраны для:', targetSocketId);
        }
    };
    
    // Отслеживание состояния ICE соединения
    peerConnection.oniceconnectionstatechange = () => {
        console.log('🧊 Изменение состояния ICE соединения для:', targetSocketId);
        console.log('🧊 Новое состояние ICE:', peerConnection.iceConnectionState);
        console.log('🧊 Состояние signaling:', peerConnection.signalingState);
        console.log('🧊 Текущие ICE кандидаты:', peerConnection.localDescription?.sdp?.split('a=candidate').length - 1 || 0);
        
        if (peerConnection.iceConnectionState === 'failed') {
            console.error('❌ ICE соединение не удалось для:', targetSocketId);
            console.error('❌ Проблема с NAT/firewall - пытаемся переподключиться...');
            
            // Пытаемся восстановить соединение через restart ICE
            try {
                console.log('🔄 Пытаемся перезапустить ICE...');
                peerConnection.restartIce();
                console.log('✅ ICE перезапущен');
            } catch (error) {
                console.error('❌ Ошибка перезапуска ICE:', error);
            }
        } else if (peerConnection.iceConnectionState === 'connected') {
            console.log('✅ ICE соединение установлено для:', targetSocketId);
        } else if (peerConnection.iceConnectionState === 'disconnected') {
            console.warn('⚠️ ICE соединение разорвано для:', targetSocketId);
            console.warn('⚠️ Пытаемся восстановить соединение...');
        } else if (peerConnection.iceConnectionState === 'checking') {
            console.log('🔄 ICE соединение проверяется для:', targetSocketId);
        }
    };
    
    // Отслеживание состояния соединения
    peerConnection.onconnectionstatechange = () => {
        console.log('🔗 Изменение состояния соединения для:', targetSocketId);
        console.log('🔗 Новое состояние:', peerConnection.connectionState);
        
        if (peerConnection.connectionState === 'failed') {
            console.error('❌ Соединение не удалось для:', targetSocketId);
        } else if (peerConnection.connectionState === 'connected') {
            console.log('✅ Соединение установлено для:', targetSocketId);
        }
    };

    return peerConnection;
}

// Обработчики Socket.io теперь в setupSocketEventListeners()

function updateUsersList(users = null) {
    console.log('Обновление списка пользователей:', users);
    if (users) {
        usersList.innerHTML = '';
        users.forEach(user => {
            const li = document.createElement('li');
            li.textContent = user.username;
            if (user.socketId === socket.id) {
                li.classList.add('current-user');
                li.textContent += ' (Вы)';
            }
            usersList.appendChild(li);
        });
        userCount.textContent = users.length;
        console.log('Список пользователей обновлен, всего:', users.length);
    } else {
        // Если users не передан, обновляем из текущего состояния peers
        const currentUsers = Array.from(peers.keys()).map(socketId => ({ socketId }));
        if (currentUsers.length > 0) {
            usersList.innerHTML = '';
            currentUsers.forEach(user => {
                const li = document.createElement('li');
                li.textContent = `Пользователь ${user.socketId.substring(0, 8)}...`;
                usersList.appendChild(li);
            });
            userCount.textContent = currentUsers.length + 1; // +1 для себя
        }
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

