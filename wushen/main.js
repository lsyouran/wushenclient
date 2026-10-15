﻿"use strict";

globalThis['__PATH'] = {
    BASE: "./os/",
    WORLD: "./world/",
    COMMAND: "./world/cmd/",
    SKILL: "./world/skill/",
    MAP: "./world/map/",
    NPC: "./world/npc/",
    OBJ: "./world/obj/",
    TASK: "./world/task/",
    AREA: "./world/area/",
    FAMILY: "./world/family/",
    EXTENDS: "./world/extends/",
    DATA: "./data/",
    DEF_DATA: "./data/def/"
};

require('dotenv').config();

const fs = require("fs");
function readdir(path) {
    var files = fs.readdirSync(path);
    for (var i = 0; i < files.length; i++) {
        var sub_path = path + files[i];
        var stat = fs.statSync(sub_path);
        if (stat.isDirectory()) {
            readdir(sub_path + "/");
        } else {
            require(sub_path);
        }
    }
}

globalThis['__CONFIG'] = require('./config');

async function require_os() {
    const path = require('path');
    for (var item in __PATH) {
        __PATH[item] = path.join(__dirname, __PATH[item]);
    }
    readdir(__PATH.BASE);
    await __CONFIG.init();
}

// ============================================================
// GM HTTP 服务（在游戏进程内运行）
// ============================================================
function startGMServer() {
    try {
        const express = require('express');
        const app = express();
        const GM_PORT = 8090;
        
        app.use(express.json());
        
        // ★★★ CORS 支持 ★★★
        app.use((req, res, next) => {
            res.header('Access-Control-Allow-Origin', '*');
            res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
            res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, gm-token');
            if (req.method === 'OPTIONS') {
                return res.sendStatus(200);
            }
            next();
        });
        
        // ★★★ 请求日志 ★★★
        app.use((req, res, next) => {
            console.log(`[GM] ${req.method} ${req.url}`);
            return next();
        });
        
        // ========== GM API ==========
        
        // 1. 状态检查
        app.get('/gm/status', (req, res) => {
            res.json({
                status: 'ok',
                world: !!global.WORLD,
                online: WORLD?.USERS?.filter(u => u.socket).length || 0,
                total: WORLD?.USERS?.length || 0,
                rooms: Object.keys(WORLD?.ROOMS || {}).length,
                uptime: process.uptime()
            });
        });
        
        // 2. 获取在线玩家
        app.get('/gm/online', (req, res) => {
            const users = WORLD?.USERS || [];
            const result = users
                .filter(u => u.socket && u.id)
                .map(u => ({
                    id: u.id,
                    name: u.name,
                    level: u.level || 0,
                    user_level: u.user_level || 0,
                    room: u.environment?.path || '未知',
                    room_name: u.environment?.name || '未知',
                    hp: u.hp,
                    max_hp: u.max_hp
                }));
            res.json({ success: true, data: result });
        });
        
        // 3. 获取所有角色
        app.get('/gm/users', async (req, res) => {
            try {
                const db = require('./data/sql');
                const roles = await db.getUsers();
                const onlineIds = new Set();
                (WORLD?.USERS || []).forEach(u => {
                    if (u.id) onlineIds.add(u.id);
                });
                const result = (roles || []).map(r => ({
                    id: r.id,
                    name: r.name,
                    level: r.level || 0,
                    user_level: r.user_level || 0,
                    online: onlineIds.has(r.id.toString())
                }));
                res.json({ success: true, data: result });
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });
        
        // 4. 执行GM命令
        app.post('/gm/command', (req, res) => {
            const { userId, command } = req.body;
            if (!userId) return res.status(400).json({ error: '缺少目标角色ID' });
            if (!command) return res.status(400).json({ error: '缺少命令' });
            
            const target = WORLD?.getUser?.(userId);
            if (!target) return res.status(404).json({ error: '目标玩家不在线' });
            
            try {
                const hadGm = target.user_level >= 9;
                if (!hadGm) target.user_level = 9;
                const result = target.do_gm_command(command);
                if (!hadGm) target.user_level = 0;
                res.json({ success: true, result: result || '命令执行成功' });
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });
        
        // 5. 创建角色
        app.post('/gm/user/create', async (req, res) => {
            const { name, level = 1, user_level = 9 } = req.body;
            if (!name) return res.status(400).json({ error: '缺少角色名' });
            
            try {
                const db = require('./data/sql');
                const existing = await db.exitsRoleName(name);
                if (existing) return res.status(400).json({ error: '角色名已存在' });
                
                const roleId = 'gm_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 4);
                const role = {
                    id: roleId,
                    name: name,
                    userid: 1,
                    title: 'GM角色',
                    level: level,
                    server: WORLD?.SERVERID || 100,
                    data: JSON.stringify({
                        prop: [20, 20, 20, 20, 1, 100, 0, 0, 0, 50, 50, 100, 100, 20, 0, Date.now(), 20, 0, 0, 0],
                        quit_room: 'yz/wumiao',
                        items: [],
                        stores: [],
                        eq: [],
                        skills: {},
                        temp: { gm_created: Date.now() },
                        settings: {}
                    })
                };
                
                await db.addRole(role);
                res.json({ success: true, message: `角色 ${name} 创建成功` });
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });
        
        // 6. 删除角色
        app.delete('/gm/user/:id', async (req, res) => {
            const userId = req.params.id;
            if (!userId) return res.status(400).json({ error: '缺少角色ID' });
            
            try {
                const db = require('./data/sql');
                const onlineUser = WORLD?.getUser?.(userId);
                if (onlineUser) {
                    onlineUser.send('<RED>你的角色被GM删除了</RED>');
                    setTimeout(() => onlineUser.quit(), 1000);
                }
                await db.deleteRole(1, userId);
                res.json({ success: true, message: '角色已删除' });
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });
        
        // 7. 踢出玩家
        app.post('/gm/kick', (req, res) => {
            const { userId, reason = 'GM操作' } = req.body;
            if (!userId) return res.status(400).json({ error: '缺少目标角色ID' });
            
            const target = WORLD?.getUser?.(userId);
            if (!target) return res.status(404).json({ error: '目标玩家不在线' });
            
            target.send(`<RED>你被GM踢出游戏，原因：${reason}</RED>`);
            setTimeout(() => target.quit(), 1000);
            res.json({ success: true, message: '玩家已被踢出' });
        });
        
        // 8. 传送玩家
        app.post('/gm/teleport', (req, res) => {
            const { userId, roomPath } = req.body;
            if (!userId || !roomPath) return res.status(400).json({ error: '缺少参数' });
            
            const target = WORLD?.getUser?.(userId);
            if (!target) return res.status(404).json({ error: '目标玩家不在线' });
            
            const room = ROOM?.Get?.(roomPath);
            if (!room) return res.status(400).json({ error: '房间不存在' });
            
            target.moveto && target.moveto(room);
            res.json({ success: true, message: `已传送到 ${room.name}` });
        });
        
        // 9. 发放物品
        app.post('/gm/give', (req, res) => {
            const { userId, itemPath, count = 1 } = req.body;
            if (!userId || !itemPath) return res.status(400).json({ error: '缺少参数' });
            
            const target = WORLD?.getUser?.(userId);
            if (!target) return res.status(404).json({ error: '目标玩家不在线' });
            
            let item = null;
            try { item = OBJ?.CREATE?.(itemPath); } catch(e) {}
            if (!item) return res.status(400).json({ error: `找不到物品: ${itemPath}` });
            
            item.count = parseInt(count) || 1;
            target.add_obj && target.add_obj(item);
            res.json({ success: true, message: `已发放 ${item.name || itemPath} x${item.count}` });
        });
        
        // 10. 服务器统计
        app.get('/gm/stats', (req, res) => {
            res.json({
                success: true,
                data: {
                    online: (WORLD?.USERS || []).filter(u => u.socket).length,
                    total: WORLD?.USERS?.length || 0,
                    rooms: Object.keys(WORLD?.ROOMS || {}).length,
                    npcs: WORLD?.NPC_STROE?.size || 0,
                    commands: Object.keys(WORLD?.COMMANDS || {}).length,
                    skills: Object.keys(WORLD?.SKILLS || {}).length,
                    uptime: process.uptime(),
                    memory: process.memoryUsage()
                }
            });
        });
        
        // 11. 广播
        app.post('/gm/broadcast', (req, res) => {
            const { message } = req.body;
            if (!message) return res.status(400).json({ error: '缺少消息' });
            
            let count = 0;
            (WORLD?.USERS || []).forEach(u => {
                if (u.socket) {
                    u.send(`<YELLOW>【广播】${message}</YELLOW>`);
                    count++;
                }
            });
            res.json({ success: true, count: count });
        });
        
        // 12. 获取房间列表
        app.get('/gm/rooms', (req, res) => {
            const rooms = [];
            for (let key in WORLD?.ROOMS || {}) {
                const room = WORLD.ROOMS[key];
                if (room && room.name) {
                    rooms.push({
                        path: key,
                        name: room.name,
                        area: room.area || '无'
                    });
                }
            }
            res.json({ success: true, data: rooms });
        });
        
        // 13. 获取物品列表
        app.get('/gm/items', (req, res) => {
            const items = [];
            if (WORLD?.OBJ_STROE) {
                for (let [key, value] of WORLD.OBJ_STROE) {
                    if (value && value.name) {
                        items.push({
                            path: key,
                            name: value.name,
                            type: value.type || '普通',
                            grade: value.grade || 0
                        });
                    }
                }
            }
            res.json({ success: true, data: items });
        });
        
        // 14. GM日志
        app.get('/gm/logs', (req, res) => {
            const limit = parseInt(req.query.limit) || 100;
            const logs = WORLD?.gmLogs?.slice(-limit).reverse() || [];
            res.json({ success: true, data: logs });
        });

        // ============================================================
        // ★★★ 新增：获取玩家完整属性 ★★★
        // ============================================================
        app.get('/gm/player/:id/full', (req, res) => {
            const userId = req.params.id;
            if (!userId) {
                return res.status(400).json({ success: false, error: '缺少角色ID' });
            }

            // 从 WORLD 获取玩家
            const target = WORLD?.getUser?.(userId);
            if (!target) {
                return res.status(404).json({ success: false, error: '目标玩家不在线' });
            }

            try {
                // 构建玩家属性数据
                const data = {
                    id: target.id,
                    name: target.name,
                    level: target.level || 0,
                    user_level: target.user_level || 0,
                    hp: target.hp || 0,
                    max_hp: target.max_hp || 0,
                    mp: target.mp || 0,
                    max_mp: target.max_mp || 0,
                    limit_mp: target.limit_mp || 0,
                    str: target.str || 0,
                    con: target.con || 0,
                    dex: target.dex || 0,
                    int: target.int || 0,
                    per: target.per || 0,
                    kar: target.kar || 0,
                    gender: target.gender || 1,
                    exp: target.exp || 0,
                    pot: target.pot || 0,
                    money: target.money || 0,
                    cash_money: target.cash_money || 0,
                    score: target.score || 0,
                    family: target.family?.name || '无',
                    room: target.environment?.path || '未知',
                    room_name: target.environment?.name || '未知',
                    attack: target.attack || 0,
                    defense: target.defense || 0,
                    speed: target.speed || 0,
                    // 后天属性 (prop系统)
                    prop: {
                        str: target.query_prop?.('str') || 0,
                        con: target.query_prop?.('con') || 0,
                        dex: target.query_prop?.('dex') || 0,
                        int: target.query_prop?.('int') || 0,
                        per: target.query_prop?.('per') || 0,
                        kar: target.query_prop?.('kar') || 0,
                        gj: target.query_prop?.('gj') || 0,
                        fy: target.query_prop?.('fy') || 0,
                        mz: target.query_prop?.('mz') || 0,
                        ds: target.query_prop?.('ds') || 0,
                        zj: target.query_prop?.('zj') || 0,
                        bj: target.query_prop?.('bj') || 0,
                        gjsd: target.query_prop?.('gjsd') || 0,
                        add_sh_per: target.query_prop?.('add_sh_per') || 0,
                        diff_fy_per: target.query_prop?.('diff_fy_per') || 0,
                        add_bjsh_per: target.query_prop?.('add_bjsh_per') || 0,
                        diff_sh_per: target.query_prop?.('diff_sh_per') || 0,
                        diff_bj: target.query_prop?.('diff_bj') || 0,
                        releasetime: target.query_prop?.('releasetime') || 0,
                        busy: target.query_prop?.('busy') || 0,
                        diff_busy: target.query_prop?.('diff_busy') || 0,
                        distime: target.query_prop?.('distime') || 0,
                        expend_mp: target.query_prop?.('expend_mp') || 0,
                        diff_downside_per: target.query_prop?.('diff_downside_per') || 0,
                        dazuo_per: target.query_prop?.('dazuo_per') || 0,
                        study_per: target.query_prop?.('study_per') || 0,
                        lianxi_per: target.query_prop?.('lianxi_per') || 0
                    }
                };

                // 获取 stats 文本
                let statsText = '';
                try {
                    const result = target.do_gm_command?.('stats');
                    if (result) statsText = result;
                } catch(e) {}

                res.json({ 
                    success: true, 
                    data: data,
                    stats_text: statsText
                });
                
            } catch (error) {
                console.error('[GM] 获取玩家属性失败:', error);
                res.status(500).json({ 
                    success: false, 
                    error: error.message 
                });
            }
        });

        // ============================================================
        // ★★★ 新增：修改玩家属性 ★★★
        // ============================================================
        app.post('/gm/player/fullattr', (req, res) => {
            const { userId, attr, value, isProp = false } = req.body;
            if (!userId || attr === undefined || value === undefined) {
                return res.status(400).json({ success: false, error: '缺少参数' });
            }

            const target = WORLD?.getUser?.(userId);
            if (!target) {
                return res.status(404).json({ success: false, error: '目标玩家不在线' });
            }

            try {
                let command;
                if (isProp) {
                    command = `setprop ${attr} ${value}`;
                } else {
                    command = `set ${attr} ${value}`;
                }
                
                const result = target.do_gm_command?.(command);
                res.json({
                    success: true,
                    message: result || '修改成功',
                    attr: attr,
                    value: value,
                    isProp: isProp
                });
            } catch (error) {
                res.status(500).json({ success: false, error: error.message });
            }
        });

        // ============================================================
        // ★★★ 新增：账号管理 API ★★★
        // ============================================================

        // 15. 获取所有账号
        app.get('/gm/accounts', async (req, res) => {
            try {
                const db = require('./data/sql');
                const accounts = await db.getUsers();
                
                // 获取每个账号的角色数量
                const result = [];
                for (let acc of accounts) {
                    const roles = await db.getRoles(acc.id, WORLD?.SERVERID || 100);
                    result.push({
                        id: acc.id,
                        name: acc.name,
                        level: acc.level || 0,
                        phone: acc.phone || '',
                        state: acc.state || 0,
                        role_count: roles ? roles.length : 0,
                        create_time: acc.create_time
                    });
                }
                res.json({ success: true, data: result });
            } catch (error) {
                console.error('[GM] 获取账号列表失败:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // 16. 创建账号
        app.post('/gm/account/create', async (req, res) => {
            const { name, pwd, phone, level = 0 } = req.body;
            if (!name || !pwd) {
                return res.status(400).json({ error: '用户名和密码不能为空' });
            }
            if (!/^[a-z0-9]{5,15}$/.test(name)) {
                return res.status(400).json({ error: '用户名需要5-15位字母或数字' });
            }
            if (pwd.length < 6) {
                return res.status(400).json({ error: '密码至少6位' });
            }
            
            try {
                const db = require('./data/sql');
                const existing = await db.checkUserName(name);
                if (existing) {
                    return res.status(400).json({ error: '用户名已存在' });
                }
                
                const user = {
                    name: name,
                    pwd: pwd,
                    phone: phone || '',
                    level: level || 0
                };
                await db.createUser(user);
                res.json({ success: true, message: '账号创建成功' });
            } catch (error) {
                console.error('[GM] 创建账号失败:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // 17. 更新账号
        app.put('/gm/account/update', async (req, res) => {
            const { id, pwd, level } = req.body;
            if (!id) {
                return res.status(400).json({ error: '缺少账号ID' });
            }
            
            try {
                const db = require('./data/sql');
                const account = await db.getUserByID(id);
                if (!account) {
                    return res.status(404).json({ error: '账号不存在' });
                }
                
                if (pwd) account.pwd = pwd;
                if (level !== undefined) account.level = parseInt(level);
                
                await db.updateUser(account);
                res.json({ success: true, message: '账号已更新' });
            } catch (error) {
                console.error('[GM] 更新账号失败:', error);
                res.status(500).json({ error: error.message });
            }
        });

        // 18. 删除账号
        app.delete('/gm/account/:id', async (req, res) => {
            const id = req.params.id;
            if (!id) {
                return res.status(400).json({ error: '缺少账号ID' });
            }
            
            try {
                const db = require('./data/sql');
                
                // 先删除该账号下的所有角色
                const roles = await db.getRoles(id, WORLD?.SERVERID || 100);
                for (let role of roles) {
                    await db.deleteRole(id, role.id);
                }
                
                // 删除账号 - 使用 sql.js 中新增的 deleteUser 方法
                await db.deleteUser(id);
                res.json({ success: true, message: '账号已删除' });
            } catch (error) {
                console.error('[GM] 删除账号失败:', error);
                res.status(500).json({ error: error.message });
            }
        });
        
        // 启动GM HTTP服务
        app.listen(GM_PORT, () => {
            console.log('========================================');
            console.log('🎮 GM后台服务已启动');
            console.log(`📍 http://localhost:${GM_PORT}/gm/status`);
            console.log('========================================');
        });
        
    } catch (error) {
        console.log('⚠️ GM后台启动失败:', error.message);
        console.log('请确保已安装 express: npm install express');
    }
}

// ============================================================
// 启动
// ============================================================
require_os().then(() => {
    WORLD.startup(process.argv[2]);
    startGMServer();
});

// 优雅关闭
async function gracefulShutdown(signal) {
    console.log('收到%s信号，正在保存数据...', signal);
    try {
        await WORLD.save();
        console.log('数据保存完成，服务器关闭');
    } catch (e) {
        console.error('保存数据失败:', e.message);
    }
    process.exit(0);
}
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

process.on('uncaughtException', (error) => {
    console.error('未捕获的异常:', error);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('未处理的Promise拒绝:', reason);
});