// Клиентский код для работы с медиа-сервером (mediasoup)
let localStream = null;
let socket = null;
let sendTransport = null;
let recvTransport = null;
let producers = new Map();
let consumers = new Map();
let audioElements = new Map();
let currentRoomId = null;
let username = null;
let isMuted = false;
let device = null;

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

    if (serverIpGroup) serverIpGroup.style.display = 'none';

    if (!loginScreen || !chatScreen || !usernameInput || !roomIdInput || !joinBtn || !createRoomBtn) {
        console.error('Не найдены необходимые элементы DOM!');
        return;
    }

    console.log('Все элементы DOM найдены');
    initializeApp();
});

function initializeApp() {
    console.log('Инициализация приложения...');
    
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
    setupEventListeners();
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
        reconnectionAttempts: 5,
    });

    socket.on('connect', () => {
        console.log('Подключено к серверу:', socket.id);
        if (connectionStatus) {
            connectionStatus.textContent = 'Готово к подключению';
        }
    });

    socket.on('connect_error', (error) => {
        console.error('Ошибка подключения:', error);
        if (connectionStatus) {
            connectionStatus.textContent = 'Ошибка подключения';
        }
    });

    socket.on('disconnect', () => {
        console.log('Отключено от сервера');
        if (connectionStatus) {
            connectionStatus.textContent = 'Отключено';
        }
    });

    // Обработчики медиа-сервера
    socket.on('transport-created', async (data) => {
        console.log('✅ Транспорты созданы на сервере');
        await setupTransports(data);
    });

    socket.on('new-producer', async (data) => {
        console.log('📢 Новый producer:', data);
        await createConsumerForProducer(data);
    });

    socket.on('room-users', (users) => {
        console.log('Получен список пользователей:', users);
        updateUsersList(users);
    });

    socket.on('user-joined', (data) => {
        console.log('Новый пользователь присоединился:', data);
        // Обновим список позже через room-users
    });

    socket.on('user-left', (socketId) => {
        console.log('Пользователь покинул комнату:', socketId);
        removeUser(socketId);
    });

    socket.on('request-rtp-capabilities', async (data) => {
        console.log('Запрос RTP capabilities для producer:', data);
        await handleRequestRtpCapabilities(data);
    });
}

async function setupTransports(data) {
    try {
        const { sendTransport: sendData, recvTransport: recvData } = data;

        // Создаем send transport
        sendTransport = new RTCPeerConnection({
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' }
            ]
        });

        // Создаем recv transport
        recvTransport = new RTCPeerConnection({
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' }
            ]
        });

        // Подключаем send transport
        await sendTransport.setRemoteDescription(new RTCSessionDescription({
            type: 'offer',
            sdp: sendData.iceParameters
        }));

        const sendAnswer = await sendTransport.createAnswer();
        await sendTransport.setLocalDescription(sendAnswer);

        socket.emit('connect-send-transport', {
            dtlsParameters: sendTransport.localDescription
        }, (response) => {
            if (response.success) {
                console.log('✅ Send transport подключен');
            }
        });

        // Подключаем recv transport
        await recvTransport.setRemoteDescription(new RTCSessionDescription({
            type: 'offer',
            sdp: recvData.iceParameters
        }));

        const recvAnswer = await recvTransport.createAnswer();
        await recvTransport.setLocalDescription(recvAnswer);

        socket.emit('connect-recv-transport', {
            dtlsParameters: recvTransport.localDescription
        }, (response) => {
            if (response.success) {
                console.log('✅ Recv transport подключен');
            }
        });

        // Добавляем обработчики ICE кандидатов
        sendTransport.onicecandidate = (event) => {
            if (event.candidate) {
                // Отправляем кандидат на сервер
            }
        };

        recvTransport.onicecandidate = (event) => {
            if (event.candidate) {
                // Отправляем кандидат на сервер
            }
        };

    } catch (error) {
        console.error('Ошибка настройки транспортов:', error);
    }
}

async function produceAudio() {
    if (!localStream || !sendTransport) {
        console.error('Нет локального потока или транспорта');
        return;
    }

    try {
        const audioTrack = localStream.getAudioTracks()[0];
        if (!audioTrack) {
            console.error('Нет аудио трека');
            return;
        }

        const producer = await sendTransport.addTrack(audioTrack, localStream);
        producers.set(producer.id, producer);

        // Получаем RTP параметры
        const rtpParameters = producer.getParameters();

        socket.emit('produce', {
            kind: 'audio',
            rtpParameters: rtpParameters
        }, (response) => {
            if (response.id) {
                console.log('✅ Producer создан:', response.id);
            }
        });

    } catch (error) {
        console.error('Ошибка создания producer:', error);
    }
}

async function createConsumerForProducer(data) {
    try {
        // Запрашиваем RTP capabilities у сервера
        socket.emit('consume', {
            producerId: data.producerId,
            rtpCapabilities: device.rtpCapabilities
        }, async (response) => {
            if (response.error) {
                console.error('Ошибка создания consumer:', response.error);
                return;
            }

            const { id, producerId, kind, rtpParameters } = response;

            // Создаем consumer на recv transport
            const consumer = await recvTransport.addTrack(
                new MediaStreamTrack({ kind, id: rtpParameters.mid }),
                new MediaStream(),
                rtpParameters
            );

            consumers.set(id, consumer);

            // Воспроизводим аудио
            const audio = new Audio();
            audio.srcObject = consumer.track;
            audio.autoplay = true;
            audio.volume = 1.0;
            audioElements.set(data.socketId, audio);

            console.log('✅ Consumer создан и воспроизводится:', id);
        });

    } catch (error) {
        console.error('Ошибка создания consumer:', error);
    }
}

async function handleRequestRtpCapabilities(data) {
    try {
        if (!device) {
            // Инициализируем device с RTP capabilities
            // Это нужно сделать один раз при подключении
        }

        socket.emit('consume', {
            producerId: data.producerId,
            rtpCapabilities: device.rtpCapabilities
        }, async (response) => {
            if (response.error) {
                console.error('Ошибка создания consumer:', response.error);
                return;
            }

            await createConsumerFromResponse(response, data.producerSocketId);
        });

    } catch (error) {
        console.error('Ошибка обработки запроса RTP capabilities:', error);
    }
}

async function createConsumerFromResponse(response, socketId) {
    try {
        const { id, producerId, kind, rtpParameters } = response;

        // Создаем MediaStreamTrack из RTP параметров
        // Это упрощенная версия - в реальности нужна более сложная логика

        const audio = new Audio();
        // Здесь нужно правильно обработать RTP поток
        audioElements.set(socketId, audio);

        console.log('✅ Consumer создан для:', socketId);
    } catch (error) {
        console.error('Ошибка создания consumer из ответа:', error);
    }
}

function setupEventListeners() {
    createRoomBtn.addEventListener('click', () => {
        const roomId = Math.random().toString(36).substring(2, 10);
        roomIdInput.value = roomId;
    });

    joinBtn.addEventListener('click', async () => {
        await joinRoom();
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
}

async function joinRoom() {
    const name = usernameInput.value.trim();
    const room = roomIdInput.value.trim();

    if (!name || !room) {
        alert('Введите имя и ID комнаты');
        return;
    }

    username = name;
    currentRoomId = room;

    try {
        // Запрашиваем доступ к микрофону
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        console.log('✅ Доступ к микрофону получен');

        // Присоединяемся к комнате
        socket.emit('join-room', room, name);

        // Показываем экран чата
        loginScreen.style.display = 'none';
        chatScreen.style.display = 'block';
        if (currentRoomIdSpan) {
            currentRoomIdSpan.textContent = room;
        }

    } catch (error) {
        console.error('Ошибка присоединения:', error);
        alert('Не удалось получить доступ к микрофону');
    }
}

function leaveRoom() {
    // Закрываем все producers и consumers
    producers.forEach(producer => producer.close());
    consumers.forEach(consumer => consumer.close());
    
    // Закрываем транспорты
    if (sendTransport) {
        sendTransport.close();
        sendTransport = null;
    }
    if (recvTransport) {
        recvTransport.close();
        recvTransport = null;
    }

    // Останавливаем локальный поток
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }

    // Очищаем аудио элементы
    audioElements.forEach(audio => {
        audio.pause();
        audio.srcObject = null;
    });
    audioElements.clear();

    // Отключаемся от комнаты
    if (socket && currentRoomId) {
        socket.emit('leave-room', currentRoomId);
    }

    // Показываем экран входа
    loginScreen.style.display = 'block';
    chatScreen.style.display = 'none';

    producers.clear();
    consumers.clear();
    currentRoomId = null;
    username = null;
}

function updateUsersList(users) {
    if (!usersList) return;

    usersList.innerHTML = '';
    users.forEach(user => {
        const li = document.createElement('li');
        li.textContent = user.username;
        usersList.appendChild(li);
    });

    if (userCount) {
        userCount.textContent = users.length;
    }
}

function removeUser(socketId) {
    const audio = audioElements.get(socketId);
    if (audio) {
        audio.pause();
        audio.srcObject = null;
        audioElements.delete(socketId);
    }
    // Обновим список пользователей через room-users
}

