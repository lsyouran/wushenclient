const express = require('express');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const path = require('path');
const session = require('express-session');
const pinoHttp = require('pino-http');
const http = require('http');
require('dotenv').config();

// ========== 定义全局路径 ==========
global.__PATH = {
    COMMAND: './world/cmd/',
    SKILL: './world/skill/',
    OBJ: './world/obj/',
    AREA: './world/area/',
    MAP: './world/map/',
    NPC: './world/npc/',
    FAMILY: './world/family/',
    TASK: './world/task/',
    EXTENDS: './world/extends/',
    DATA: './data/'
};

globalThis['__CONFIG'] = require('./config');
__CONFIG.init();

const app = express();
const PORT = __CONFIG.WEB_PORT || 3000;

// ========== CORS 中间件（允许所有端口访问） ==========
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    res.header('Access-Control-Allow-Credentials', 'true');
    
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// ========== 中间件配置 ==========
app.use(express.static(path.join(__dirname, 'www')));
app.disable('x-powered-by');
app.use(cookieParser());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.use(session({
    secret: __CONFIG.SESSION_SECRET || 'default_secret',
    resave: false,
    saveUninitialized: true,
    cookie: {
        secure: false,
        httpOnly: false,
        maxAge: 1000 * 60 * 30,
    }
}));

app.use(pinoHttp({
    level: 'info',
    transport: {
        target: 'pino-roll',
        options: {
            file: './log/access.log',
            frequency: 'daily',
            mkdir: true,
            history: '7d',
        },
    },
}));

// ========== API路由加载 ==========
const API_PATHS = ['./api/user', './api/game'];
const APIS = {};

for (let api of API_PATHS) {
    APIS[api.replace('./api/', "")] = require(api);
}

// ============================================================
// ★★★ GM 代理（使用原生 http 模块转发到 8090） ★★★
// ============================================================

// 代理所有 /gm 开头的请求到 8090 端口（除了 /gm 页面本身）
app.use('/gm', (req, res, next) => {
    // 如果是请求 GM 页面本身，不代理
    if (req.path === '' || req.path === '/' || req.path === '/gm') {
        return next();
    }
    
    // 构建目标 URL
    const targetUrl = `http://localhost:8090${req.url}`;
    console.log(`[Proxy] → ${req.method} ${req.url} -> ${targetUrl}`);
    
    // 准备转发选项
    const options = {
        hostname: 'localhost',
        port: 8090,
        path: req.url,
        method: req.method,
        headers: {
            ...req.headers,
            host: 'localhost:8090',
            'Content-Type': req.headers['content-type'] || 'application/json'
        }
    };
    
    // 如果是 POST/PUT 请求，需要发送 body
    const proxyReq = http.request(options, (proxyRes) => {
        console.log(`[Proxy] ← ${proxyRes.statusCode} ${req.url}`);
        
        // 转发响应头
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        
        // 转发响应体
        proxyRes.pipe(res);
    });
    
    // 错误处理
    proxyReq.on('error', (err) => {
        console.error('[Proxy] ❌ 代理错误:', err.message);
        
        // 返回友好的错误信息
        res.status(503).json({
            success: false,
            error: 'GM服务暂时不可用，请确保游戏服务器正在运行 (端口 8090)',
            details: err.message,
            tip: '请检查 main.js 是否已启动'
        });
    });
    
    // 如果是 POST/PUT 请求，发送 body
    if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
        const body = JSON.stringify(req.body);
        proxyReq.setHeader('Content-Length', Buffer.byteLength(body));
        proxyReq.write(body);
    }
    
    proxyReq.end();
});

// 代理 /api/gm 开头的请求到 8090 端口
app.use('/api/gm', (req, res) => {
    const targetUrl = `http://localhost:8090${req.url}`;
    console.log(`[Proxy] → ${req.method} ${req.url} -> ${targetUrl}`);
    
    const options = {
        hostname: 'localhost',
        port: 8090,
        path: req.url,
        method: req.method,
        headers: {
            ...req.headers,
            host: 'localhost:8090',
            'Content-Type': req.headers['content-type'] || 'application/json'
        }
    };
    
    const proxyReq = http.request(options, (proxyRes) => {
        console.log(`[Proxy] ← ${proxyRes.statusCode} ${req.url}`);
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res);
    });
    
    proxyReq.on('error', (err) => {
        console.error('[Proxy] ❌ 代理错误:', err.message);
        res.status(503).json({
            success: false,
            error: 'GM服务暂时不可用，请确保游戏服务器正在运行 (端口 8090)',
            details: err.message
        });
    });
    
    if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
        const body = JSON.stringify(req.body);
        proxyReq.setHeader('Content-Length', Buffer.byteLength(body));
        proxyReq.write(body);
    }
    
    proxyReq.end();
});

// ============================================================
// ★★★ 本地 GM 路由（降级方案，当 8090 不可用时使用） ★★★
// ============================================================
try {
    const gmAPI = require('./api/gm');
    
    // 使用 -local 后缀避免冲突
    app.get('/api/gm/status-local', gmAPI.status);
    app.get('/api/gm/stats-local', gmAPI.getStats);
    app.get('/api/gm/online-local', gmAPI.getOnlineUsers);
    app.get('/api/gm/users-local', gmAPI.getUsers);
    app.get('/api/gm/user-local/:id', gmAPI.getUserDetail);
    app.post('/api/gm/user-local/create', gmAPI.createUser);
    app.delete('/api/gm/user-local/:id', gmAPI.deleteUser);
    app.get('/api/gm/player-local/:id/full', gmAPI.getPlayerFullAttrs);
    app.post('/api/gm/player-local/fullattr', gmAPI.setPlayerFullAttr);
    app.post('/api/gm/command-local', gmAPI.executeCommand);
    app.post('/api/gm/command-local/batch', gmAPI.executeBatchCommand);
    app.post('/api/gm/kick-local', gmAPI.kickUser);
    app.post('/api/gm/ban-local', gmAPI.banUser);
    app.post('/api/gm/unban-local', gmAPI.unbanUser);
    app.post('/api/gm/teleport-local', gmAPI.teleportUser);
    app.post('/api/gm/give-local', gmAPI.giveItem);
    app.get('/api/gm/items-local', gmAPI.getItems);
    app.get('/api/gm/rooms-local', gmAPI.getRooms);
    app.get('/api/gm/logs-local', gmAPI.getLogs);
    app.post('/api/gm/broadcast-local', gmAPI.broadcast);
    app.post('/api/gm/save-local', gmAPI.saveAll);
    app.post('/api/gm/hotload-local', gmAPI.hotload);
    
    console.log('[GM] ✅ 本地GM API已加载 (降级备用)');
    
} catch (error) {
    console.warn('[GM] ⚠️ 本地GM模块加载失败:', error.message);
}

// ============================================================
// ★★★ GM 页面（直接服务） ★★★
// ============================================================
const fs = require('fs');
const gmHtmlPath = path.join(__dirname, 'www/gm/gm-web.html');

app.get('/gm', (req, res) => {
    if (fs.existsSync(gmHtmlPath)) {
        res.sendFile(gmHtmlPath);
    } else {
        res.send(`
            <html>
            <head><title>GM后台</title>
            <style>
                body{background:#0d1117;color:#c9d1d9;font-family:sans-serif;padding:40px;text-align:center;}
                h1{color:#f0883e;}
                code{background:#161b22;padding:2px 10px;border-radius:4px;}
                a{color:#58a6ff;}
            </style>
            </head>
            <body>
                <h1>🎮 GM后台</h1>
                <p>GM后台页面: <code>www/gm/gm-web.html</code></p>
                <p><a href="/gm/status">查看GM状态</a></p>
            </body>
            </html>
        `);
    }
});

// ============================================================
// ★★★ 动态路由 ★★★
// ============================================================
app.all('/api/:className/:methodName', async (req, res) => {
    const { className, methodName } = req.params;
    try {
        const ClassModule = APIS[className];
        if (!ClassModule)
            return res.status(404).json({ error: 'Method not found' });
        const instance = new ClassModule(req, res);
        if (typeof instance[methodName] !== 'function') {
            return res.status(404).json({ error: 'Method not found' });
        }
        const params = { ...req.query, ...req.body };
        const result = await instance[methodName](params);
        res.json(result);
    } catch (error) {
        console.error('API Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.all('/sse/:className/:methodName', async (req, res) => {
    const { className, methodName } = req.params;
    try {
        const ClassModule = APIS[className];
        if (!ClassModule)
            return res.status(404).json({ error: 'Method not found' });
        const instance = new ClassModule(req, res);
        if (typeof instance[methodName] !== 'function') {
            return res.status(404).json({ error: 'Method not found' });
        }
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();
        const handler = await instance[methodName]({ ...req.query, ...req.body });
        if (!res.writableEnded) {
            if (handler && handler.end) {
                const closeHandler = () => {
                    handler.end();
                };
                res.on('close', closeHandler);
            } else {
                res.end();
            }
        }
    } catch (error) {
        console.error('API Error:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Internal server error' });
        }
    }
});

// ========== API热重载 ==========
function reload_api(req, res) {
    try {
        for (let modulePath of API_PATHS) {
            const resolvedPath = require.resolve(modulePath);
            if (require.cache[resolvedPath]) {
                delete require.cache[resolvedPath];
            }
            APIS[modulePath.replace('./api/', "")] = require(resolvedPath);
        }
        res.json({ msg: 'api reload' });
    } catch (error) {
        console.log(error);
        res.status(500).json({ error: 'Internal server error' });
    }
}
app.use("/reload", reload_api);

// ========== 健康检查 ==========
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: Date.now(),
        port: PORT,
        gmProxy: 'http://localhost:8090'
    });
});

// ========== 创建服务器 ==========
const server = http.createServer(app);

server.listen(PORT, '0.0.0.0', () => {
    console.log('========================================');
    console.log('🖥️  Web服务器: http://localhost:' + PORT);
    console.log('🖥️  外部访问: http://0.0.0.0:' + PORT);
    console.log('🎮 GM后台:   http://localhost:' + PORT + '/gm');
    console.log('📡 游戏服务器端口: ' + (__CONFIG.def_server?.port || 31300));
    console.log('🌐 CORS已启用 - 允许所有来源访问');
    console.log('🔄 GM代理: http://localhost:8090 (使用原生http)');
    console.log('========================================');
});

// ========== 错误处理 ==========
process.on('uncaughtException', (error) => {
    console.error('❌ 未捕获的异常:', error);
    console.error(error.stack);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ 未处理的Promise拒绝:', reason);
});