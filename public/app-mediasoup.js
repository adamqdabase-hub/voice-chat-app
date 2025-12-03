// Клиент для mediasoup медиа-сервера (как Discord)
let localStream = null;
let device = null;
let sendTransport = null;
let recvTransport = null;
let producer = null;
let consumers = new Map();
let audioElements = new Map();
let currentRoomId = null;
let username = null;
let isMuted = false;

// Элементы DOM
let loginScreen, chatScreen, usernameInput, roomIdInput, serverIpInput, joinBtn, createRoomBtn;
let leaveBtn, muteBtn, leaveAudioBtn, usersList, userCount, currentRoomIdSpan, connectionStatus;

document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM загружен, инициализация mediasoup клиента...');
    
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
        return;
    }

    initializeApp();
});

let socket;

function initializeApp() {
    if (typeof io === 'undefined') {
        console.error('Socket.io не загружен!');
        setTimeout(() => {
            if (typeof io !== 'undefined') {
                initializeSocket();
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
        if (connectionStatus) {
            connectionStatus.textContent = 'Ошибка подключения';
            connectionStatus.className = 'status-indicator error';
        }
    });

    socket.on('transport-created', async ({ sendTransport: sendData, recvTransport: recvData }) => {
        console.log('✅ Транспорты созданы');
        
        try {
            // Создаем mediasoup device
            if (!device) {
                device = new mediasoupClient.Device();
            }

            // Загружаем RTP capabilities (приходят в событии transport-created)
            if (!rtpCapabilities) {
                console.error('RTP capabilities не получены');
                return;
            }

            await device.load({ routerRtpCapabilities: rtpCapabilities });
            console.log('✅ Device загружен');

            // Создаем send transport
            sendTransport = device.createSendTransport({
                id: sendData.id,
                iceParameters: sendData.iceParameters,
                iceCandidates: sendData.iceCandidates,
                dtlsParameters: sendData.dtlsParameters,
            });

            sendTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
                socket.emit('connect-send-transport', { dtlsParameters }, (response) => {
                    if (response.error) {
                        errback(new Error(response.error));
                    } else {
                        callback();
                    }
                });
            });

            sendTransport.on('produce', async ({ kind, rtpParameters }, callback, errback) => {
                try {
                    socket.emit('produce', { kind, rtpParameters }, (response) => {
                        if (response.error) {
                            errback(new Error(response.error));
                        } else {
                            callback({ id: response.id });
                        }
                    });
                } catch (error) {
                    errback(error);
                }
            });

            // Создаем recv transport
            recvTransport = device.createRecvTransport({
                id: recvData.id,
                iceParameters: recvData.iceParameters,
                iceCandidates: recvData.iceCandidates,
                dtlsParameters: recvData.dtlsParameters,
            });

            recvTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
                socket.emit('connect-recv-transport', { dtlsParameters }, (response) => {
                    if (response.error) {
                        errback(new Error(response.error));
                    } else {
                        callback();
                    }
                });
            });

            // Создаем producer (отправка аудио)
            if (localStream) {
                const track = localStream.getAudioTracks()[0];
                producer = await sendTransport.produce({ track });
                console.log('✅ Producer создан:', producer.id);
            }
        } catch (error) {
            console.error('Ошибка создания транспортов:', error);
        }
    });

    socket.on('new-producer', async ({ producerId, socketId, username: producerUsername, kind }) => {
        console.log('Новый producer:', producerId, 'от:', socketId);
        
        if (kind !== 'audio') return;
        if (!recvTransport) return;

        try {
            socket.emit('consume', {
                producerId,
                rtpCapabilities: device.rtpCapabilities
            }, async (response) => {
                if (response.error) {
                    console.error('Ошибка создания consumer:', response.error);
                    return;
                }

                const consumer = await recvTransport.consume({
                    id: response.id,
                    producerId: response.producerId,
                    kind: response.kind,
                    rtpParameters: response.rtpParameters,
                });

                consumer.appData = { socketId, producerUsername };
                consumers.set(producerId, consumer);

                // Воспроизводим аудио
                const stream = new MediaStream([consumer.track]);
                const audio = new Audio();
                audio.srcObject = stream;
                audio.autoplay = true;
                audio.volume = 1.0;
                audio.muted = false;
                
                audio.play().then(() => {
                    console.log('✅ Аудио воспроизводится от:', socketId);
                }).catch(err => {
                    console.error('❌ Ошибка воспроизведения:', err);
                });

                audioElements.set(socketId, audio);
            });
        } catch (error) {
            console.error('Ошибка создания consumer:', error);
        }
    });

    socket.on('room-users', (users) => {
        console.log('Пользователи в комнате:', users);
        updateUsersList(users);
    });

    socket.on('user-joined', (data) => {
        console.log('Пользователь присоединился:', data);
        if (currentRoomId) {
            socket.emit('get-room-users', currentRoomId);
        }
    });

    socket.on('user-left', (socketId) => {
        console.log('Пользователь покинул комнату:', socketId);
        // Находим и закрываем consumer по producerId
        for (const [producerId, consumer] of consumers) {
            if (consumer.appData && consumer.appData.socketId === socketId) {
                consumer.close();
                consumers.delete(producerId);
            }
        }
        if (audioElements.has(socketId)) {
            audioElements.get(socketId).pause();
            audioElements.delete(socketId);
        }
        if (currentRoomId) {
            socket.emit('get-room-users', currentRoomId);
        }
    });

}

function setupEventListeners() {
    createRoomBtn.addEventListener('click', async () => {
        const randomId = Math.random().toString(36).substring(2, 8);
        roomIdInput.value = randomId;
        if (!usernameInput.value.trim()) {
            usernameInput.value = 'Пользователь' + Math.floor(Math.random() * 1000);
        }
        joinBtn.click();
    });

    joinBtn.addEventListener('click', async () => {
        const name = usernameInput.value.trim();
        const roomId = roomIdInput.value.trim();

        if (!name || !roomId) {
            return;
        }

        if (!socket || !socket.connected) {
            initializeSocket();
            await new Promise((resolve) => {
                if (socket.connected) {
                    resolve();
                } else {
                    socket.once('connect', resolve);
                    setTimeout(resolve, 3000);
                }
            });
        }

        if (!socket.connected) {
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
            });

            socket.emit('join-room', roomId, name);

            loginScreen.classList.remove('active');
            chatScreen.classList.add('active');
            if (currentRoomIdSpan) {
                currentRoomIdSpan.textContent = roomId;
            }

            if (connectionStatus) {
                connectionStatus.textContent = 'Подключено';
                connectionStatus.className = 'status-indicator connected';
            }
        } catch (error) {
            console.error('Ошибка доступа к микрофону:', error);
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
    if (producer) {
        producer.close();
        producer = null;
    }
    
    consumers.forEach(consumer => {
        consumer.close();
    });
    consumers.clear();

    if (sendTransport) {
        sendTransport.close();
        sendTransport = null;
    }
    
    if (recvTransport) {
        recvTransport.close();
        recvTransport = null;
    }

    audioElements.forEach(audio => {
        audio.pause();
        audio.srcObject = null;
    });
    audioElements.clear();

    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }

    device = null;

    if (currentRoomId) {
        socket.emit('leave-room', currentRoomId);
    }

    loginScreen.classList.add('active');
    chatScreen.classList.remove('active');
    currentRoomId = null;
    username = null;
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
    }
}