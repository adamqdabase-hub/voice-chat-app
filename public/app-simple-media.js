// Клиент для простого медиа-сервера
// Использует улучшенную логику WebRTC с лучшей обработкой TURN серверов

let localStream = null;
let peers = new Map();
let audioElements = new Map();
let currentRoomId = null;
let username = null;
let isMuted = false;

// Элементы DOM
let loginScreen, chatScreen, usernameInput, roomIdInput, serverIpInput, joinBtn, createRoomBtn;
let leaveBtn, muteBtn, leaveAudioBtn, usersList, userCount, currentRoomIdSpan, connectionStatus;

// Инициализация после загрузки DOM
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM загружен, инициализация простого медиа-клиента...');
    
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

    if (serverIpGroup) serverIpGroup.style.display = 'none';

    if (!loginScreen || !chatScreen || !usernameInput || !roomIdInput || !joinBtn || !createRoomBtn) {
        console.error('Не найдены необходимые элементы DOM!');
        alert('Ошибка загрузки интерфейса. Проверьте консоль.');
        return;
    }

    console.log('Все элементы DOM найдены');
    initializeApp();
});

let socket;

function initializeApp() {
    console.log('Инициализация приложения...');
    
    if (typeof io === 'undefined') {
        console.error('Socket.io не загружен!');
        showNotification('Ошибка: Socket.io не загружен. Проверьте интернет-соединение.', 'error');
        setTimeout(() => {
            if (typeof io !== 'undefined') {
                initializeSocket();
            } else {
                console.error('Socket.io всё ещё не загружен после ожидания');
            }
        }, 1000);
        return;
    }

    initializeSocket();
}

function initializeSocket() {
    if (socket && socket.connected) {
        socket.disconnect();
    }
    
    console.log('Инициализация Socket.io...');
    
    const CLOUD_SERVER = 'voice-chat-app-production-deba.up.railway.app';
    let defaultServer = 'localhost';
    defaultServer = CLOUD_SERVER;
    
    const serverIP = serverIpInput ? (serverIpInput.value.trim() || defaultServer) : defaultServer;
    
    let serverUrl;
    if (serverIP.includes('localhost') || serverIP.match(/^\d+\.\d+\.\d+\.\d+$/)) {
        serverUrl = `http://${serverIP}:3000`;
    } else {
        serverUrl = `https://${serverIP}`;
    }
    
    console.log('Подключение к серверу:', serverUrl);
    
    socket = io(serverUrl, {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionAttempts: 5
    });

    setupSocketEventListeners();
    setupEventListeners();
}

function setupSocketEventListeners() {
    socket.on('connect', () => {
        console.log('✅ Подключено к серверу:', socket.id);
        if (connectionStatus) {
            connectionStatus.textContent = 'Подключено';
            connectionStatus.className = 'status-indicator connected';
        }
    });

    socket.on('disconnect', () => {
        console.log('❌ Отключено от сервера');
        if (connectionStatus) {
            connectionStatus.textContent = 'Отключено';
            connectionStatus.className = 'status-indicator error';
        }
    });

    socket.on('connect_error', (error) => {
        console.error('❌ Ошибка подключения:', error);
        showNotification('Не удалось подключиться к серверу. Проверьте адрес сервера.', 'error');
        if (connectionStatus) {
            connectionStatus.textContent = 'Ошибка подключения';
            connectionStatus.className = 'status-indicator error';
        }
    });

    socket.on('user-joined', async (data) => {
        console.log('👤 Пользователь присоединился:', data);
        const { socketId, username: newUsername } = data;
        
        if (socketId === socket.id) {
            return;
        }

        if (peers.has(socketId)) {
            console.log('Peer connection уже существует для:', socketId);
            return;
        }

        // Небольшая задержка перед созданием соединения
        setTimeout(async () => {
            console.log('Создаем peer connection для нового пользователя:', socketId);
            const peerConnection = createPeerConnection(socketId);
            peers.set(socketId, peerConnection);

            try {
                const offer = await peerConnection.createOffer({
                    offerToReceiveAudio: true,
                    offerToReceiveVideo: false
                });
                await peerConnection.setLocalDescription(offer);
                
                console.log('Отправка offer для:', socketId);
                socket.emit('offer', {
                    offer: offer,
                    target: socketId
                });
            } catch (error) {
                console.error('Ошибка создания offer:', error);
            }
        }, 500);
    });

    socket.on('offer', async (data) => {
        const { offer, sender } = data;
        
        if (sender === socket.id) {
            return;
        }

        let peerConnection = peers.get(sender);
        
        if (!peerConnection) {
            console.log('Создаем peer connection для offer от:', sender);
            peerConnection = createPeerConnection(sender);
            peers.set(sender, peerConnection);
        }

        try {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            
            console.log('Отправка answer для:', sender);
            socket.emit('answer', {
                answer: answer,
                target: sender
            });
        } catch (error) {
            console.error('Ошибка обработки offer:', error);
        }
    });

    socket.on('answer', async (data) => {
        const { answer, sender } = data;
        const peerConnection = peers.get(sender);
        
        if (!peerConnection) {
            console.error('Нет peer connection для answer от:', sender);
            return;
        }

        try {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
            console.log('✅ Answer установлен для:', sender);
        } catch (error) {
            console.error('Ошибка установки answer:', error);
        }
    });

    socket.on('ice-candidate', async (data) => {
        const { candidate, sender } = data;
        const peerConnection = peers.get(sender);
        
        if (!peerConnection) {
            console.error('Нет peer connection для ICE candidate от:', sender);
            return;
        }

        try {
            if (candidate) {
                await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
                console.log('✅ ICE candidate добавлен от:', sender);
            }
        } catch (error) {
            console.error('Ошибка добавления ICE candidate:', error);
        }
    });

    socket.on('room-users', (users) => {
        console.log('Пользователи в комнате:', users);
        updateUsersList(users);
        
        users.forEach(user => {
            if (user.socketId !== socket.id && !peers.has(user.socketId)) {
                console.log('Создаем peer connection для существующего пользователя:', user.socketId);
                const peerConnection = createPeerConnection(user.socketId);
                peers.set(user.socketId, peerConnection);

                peerConnection.createOffer({
                    offerToReceiveAudio: true,
                    offerToReceiveVideo: false
                }).then(offer => {
                    return peerConnection.setLocalDescription(offer);
                }).then(() => {
                    console.log('Отправка offer для существующего пользователя:', user.socketId);
                    socket.emit('offer', {
                        offer: peerConnection.localDescription,
                        target: user.socketId
                    });
                }).catch(error => {
                    console.error('Ошибка создания offer для существующего пользователя:', error);
                });
            }
        });
    });

    socket.on('user-left', (socketId) => {
        console.log('Пользователь покинул комнату:', socketId);
        if (peers.has(socketId)) {
            peers.get(socketId).close();
            peers.delete(socketId);
        }
        if (audioElements.has(socketId)) {
            audioElements.get(socketId).pause();
            audioElements.delete(socketId);
        }
        // Запрашиваем обновленный список пользователей
        if (currentRoomId) {
            socket.emit('get-room-users', currentRoomId);
        }
    });
    
}

function setupEventListeners() {
    createRoomBtn.addEventListener('click', async () => {
        const randomId = Math.random().toString(36).substring(2, 8);
        roomIdInput.value = randomId;
        
        // Показываем уведомление об успешном создании комнаты
        showNotification(`Создана комната: ${randomId}`, 'success');
        
        // Автоматически заполняем имя, если пусто
        if (!usernameInput.value.trim()) {
            usernameInput.value = 'Пользователь' + Math.floor(Math.random() * 1000);
        }
        
        // Небольшая задержка перед автоматическим присоединением, чтобы пользователь увидел уведомление
        setTimeout(() => {
            joinBtn.click();
        }, 300);
    });

    joinBtn.addEventListener('click', async () => {
        const name = usernameInput.value.trim();
        const roomId = roomIdInput.value.trim();

        if (!name || !roomId) {
            showNotification('Пожалуйста, введите имя и ID комнаты', 'error');
            return;
        }

        if (!socket || !socket.connected) {
            console.log('Переподключение к серверу...');
            initializeSocket();
            await new Promise((resolve) => {
                if (socket.connected) {
                    resolve();
                } else {
                    socket.once('connect', resolve);
                    socket.once('connect_error', () => {
                        showNotification('Не удалось подключиться к серверу. Проверьте IP адрес.', 'error');
                        resolve();
                    });
                    setTimeout(resolve, 3000);
                }
            });
        }

        if (!socket.connected) {
            showNotification('Нет подключения к серверу. Проверьте IP адрес.', 'error');
            return;
        }

        username = name;
        currentRoomId = roomId;

        joinBtn.disabled = true;
        joinBtn.textContent = 'Подключение...';
        if (connectionStatus) {
            connectionStatus.textContent = 'Запрос доступа к микрофону...';
        }

        try {
            console.log('Запрос доступа к микрофону...');
            localStream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            });

            console.log('✅ Доступ к микрофону получен');
            
            localStream.getAudioTracks().forEach(track => {
                track.enabled = true;
                console.log('🎤 Локальный трек - enabled:', track.enabled, 'muted:', track.muted);
            });

            socket.emit('join-room', roomId, name);

            loginScreen.classList.remove('active');
            chatScreen.classList.add('active');
            if (currentRoomIdSpan) {
                currentRoomIdSpan.textContent = roomId;
            }
            
            // Список пользователей придет через событие 'room-users'

            if (connectionStatus) {
                connectionStatus.textContent = 'Подключено';
                connectionStatus.className = 'status-indicator connected';
            }
        } catch (error) {
            console.error('Ошибка доступа к микрофону:', error);
            showNotification('Не удалось получить доступ к микрофону. Проверьте разрешения.', 'error');
            if (connectionStatus) {
                connectionStatus.textContent = 'Ошибка';
                connectionStatus.className = 'status-indicator error';
            }
        } finally {
            joinBtn.disabled = false;
            joinBtn.textContent = 'Присоединиться';
        }
    });

    leaveBtn.addEventListener('click', () => {
        leaveRoom();
    });

    leaveAudioBtn.addEventListener('click', () => {
        leaveRoom();
    });

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

    usernameInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') roomIdInput.focus();
    });

    roomIdInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') joinBtn.click();
    });
}

function leaveRoom() {
    peers.forEach(peer => {
        peer.close();
    });
    peers.clear();

    audioElements.forEach(audio => {
        audio.pause();
        audio.srcObject = null;
    });
    audioElements.clear();

    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }

    if (currentRoomId) {
        socket.emit('leave-room', currentRoomId);
    }

    loginScreen.classList.add('active');
    chatScreen.classList.remove('active');
    currentRoomId = null;
    username = null;
}

function createPeerConnection(targetSocketId) {
    const peerConnection = new RTCPeerConnection({
        iceServers: [
            {
                urls: 'stun:stun.l.google.com:19302'
            },
            {
                urls: 'stun:stun1.l.google.com:19302'
            },
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
            }
        ],
        iceCandidatePoolSize: 10
    });

    if (localStream) {
        localStream.getAudioTracks().forEach(track => {
            if (track.enabled && !track.muted) {
                peerConnection.addTrack(track, localStream);
                console.log('✅ Локальный трек добавлен');
            }
        });
    }

    peerConnection.ontrack = (event) => {
        console.log('🎵 Получен аудио поток от:', targetSocketId);
        const [remoteStream] = event.streams;
        
        const audioTracks = remoteStream.getAudioTracks();
        if (audioTracks.length === 0) {
            console.warn('Поток не содержит аудио треков!');
            return;
        }
        
        audioTracks.forEach(track => {
            console.log('🎵 Аудио трек:', track.label, 'enabled:', track.enabled, 'muted:', track.muted);
            
            if (track.muted) {
                console.warn('⚠️ Трек muted! Пытаемся размутить...');
                track.enabled = true;
            }
        });
        
        if (audioElements.has(targetSocketId)) {
            const oldAudio = audioElements.get(targetSocketId);
            oldAudio.pause();
            oldAudio.srcObject = null;
        }
        
        const audio = new Audio();
        audio.srcObject = remoteStream;
        audio.autoplay = true;
        audio.volume = 1.0;
        audio.muted = false;
        
        audio.play().then(() => {
            console.log('✅ Аудио воспроизводится от:', targetSocketId);
        }).catch(err => {
            console.error('❌ Ошибка воспроизведения:', err);
        });
        
        audioElements.set(targetSocketId, audio);
    };

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            console.log('🧊 ICE candidate для:', targetSocketId, 'тип:', event.candidate.type);
            if (event.candidate.type === 'relay') {
                console.log('✅ ✅ ✅ ИСПОЛЬЗУЕТСЯ TURN!');
            }
            socket.emit('ice-candidate', {
                candidate: event.candidate,
                target: targetSocketId
            });
        }
    };

    peerConnection.oniceconnectionstatechange = () => {
        console.log('🧊 ICE состояние для', targetSocketId, ':', peerConnection.iceConnectionState);
        if (peerConnection.iceConnectionState === 'failed') {
            console.error('❌ ICE соединение не удалось, перезапуск...');
            peerConnection.restartIce();
        }
    };

    return peerConnection;
}

function updateUsersList(users = null) {
    if (!usersList) return;
    
    usersList.innerHTML = '';
    
    if (users && Array.isArray(users)) {
        users.forEach(user => {
            const li = document.createElement('li');
            li.textContent = user.username || 'Без имени';
            if (user.socketId === socket.id) {
                li.classList.add('current-user');
                li.textContent += ' (Вы)';
            }
            usersList.appendChild(li);
        });
        if (userCount) {
            userCount.textContent = users.length;
        }
    } else {
        // Если список не передан, показываем только текущего пользователя
        if (username) {
            const li = document.createElement('li');
            li.textContent = username + ' (Вы)';
            li.classList.add('current-user');
            usersList.appendChild(li);
        }
        if (userCount) {
            userCount.textContent = '1';
        }
    }
}

function showNotification(message, type = 'info') {
    console.log(`[${type.toUpperCase()}] ${message}`);
}

