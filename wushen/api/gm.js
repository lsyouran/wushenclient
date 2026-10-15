/**
 * GM后台API - 完整版
 * 支持所有属性修改
 */
const Apibase = require('./base');

class GMAPI extends Apibase {
    constructor(req, res) {
        super(req, res);
    }

    checkGM() {
        const user = this.getUser();
        if (!user) {
            this.error(401, '未登录');
            return false;
        }
        if (user.level < 9) {
            this.error(403, '需要GM权限');
            return false;
        }
        return user;
    }

    success(data) {
        this.res.json({ success: true, data: data });
    }

    error(code, message) {
        this.res.status(code).json({ success: false, error: message });
    }
}

// ============================================================
// 导出的GM方法
// ============================================================
module.exports = {
    // ========== 状态检查 ==========
    async status(req, res) {
        res.json({
            status: 'ok',
            timestamp: Date.now(),
            gm: 'enabled',
            environment: process.env.NODE_ENV || 'development',
            web_port: process.env.WEB_PORT || 8088,
            ws_port: process.env.WS_PORT || 31300,
            world: !!global.WORLD,
            users: global.WORLD?.USERS?.length || 0
        });
    },

    // ========== 服务器统计 ==========
    async getStats(req, res) {
        const api = new GMAPI(req, res);
        const user = api.checkGM();
        if (!user) return;

        try {
            const db = require('../data/sql');
            const users = await db.getUsers();
            const online = (global.WORLD?.USERS || []).filter(u => u.socket && u.id).length;

            api.res.json({
                success: true,
                data: {
                    total_users: users ? users.length : 0,
                    online_users: online,
                    uptime: process.uptime(),
                    memory: process.memoryUsage(),
                    rooms: Object.keys(global.WORLD?.ROOMS || {}).length,
                    npcs: global.WORLD?.NPC_STROE ? global.WORLD.NPC_STROE.size : 0,
                    commands: Object.keys(global.WORLD?.COMMANDS || {}).length,
                    skills: Object.keys(global.WORLD?.SKILLS || {}).length,
                    server_id: global.WORLD?.SERVERID || 0,
                    server_name: global.WORLD?.SERVER?.name || '未知'
                }
            });
        } catch (error) {
            api.res.status(500).json({ success: false, error: error.message });
        }
    },

    // ========== 在线玩家 ==========
    async getOnlineUsers(req, res) {
        const api = new GMAPI(req, res);
        const user = api.checkGM();
        if (!user) return;

        const users = global.WORLD?.USERS || [];
        const result = users
            .filter(u => u.socket && u.id)
            .map(u => ({
                id: u.id,
                name: u.name,
                level: u.level || 0,
                user_level: u.user_level || 0,
                family: u.family?.name || '无',
                room: u.environment?.path || '未知',
                room_name: u.environment?.name || '未知',
                hp: u.hp || 0,
                max_hp: u.max_hp || 0,
                mp: u.mp || 0,
                max_mp: u.max_mp || 0,
                limit_mp: u.limit_mp || 0,
                exp: u.exp || 0,
                pot: u.pot || 0,
                money: u.money || 0,
                cash_money: u.cash_money || 0,
                score: u.score || 0,
                ip: u.ip ? u.ip() : 'unknown'
            }));

        api.res.json({ success: true, data: result, total: result.length });
    },

    // ========== 所有角色 ==========
    async getUsers(req, res) {
        const api = new GMAPI(req, res);
        const user = api.checkGM();
        if (!user) return;

        try {
            const db = require('../data/sql');
            const roles = await db.getUsers();

            const onlineIds = new Set();
            (global.WORLD?.USERS || []).forEach(u => {
                if (u.id) onlineIds.add(u.id);
            });

            const result = (roles || []).map(r => ({
                id: r.id,
                name: r.name,
                level: r.level || 0,
                user_level: r.user_level || 0,
                online: onlineIds.has(r.id.toString()),
                phone: r.phone || '-',
                create_time: r.create_time
            }));

            api.res.json({ success: true, data: result, total: result.length });
        } catch (error) {
            api.res.status(500).json({ success: false, error: error.message });
        }
    },

    // ========== 获取单个角色详情 ==========
    async getUserDetail(req, res) {
        const api = new GMAPI(req, res);
        const user = api.checkGM();
        if (!user) return;

        const userId = req.params.id;
        if (!userId) {
            return api.res.status(400).json({ success: false, error: '缺少角色ID' });
        }

        try {
            const db = require('../data/sql');
            const role = await db.getData(userId);
            if (!role) {
                return api.res.status(404).json({ success: false, error: '角色不存在' });
            }

            const online = global.WORLD?.getUser?.(userId);

            api.res.json({
                success: true,
                data: {
                    ...role,
                    online: !!online,
                    online_user: online ? {
                        room: online.environment?.path,
                        room_name: online.environment?.name,
                        hp: online.hp,
                        max_hp: online.max_hp,
                        mp: online.mp,
                        max_mp: online.max_mp,
                        family: online.family?.name || '无'
                    } : null
                }
            });
        } catch (error) {
            api.res.status(500).json({ success: false, error: error.message });
        }
    },

    // ========== 创建角色 ==========
    async createUser(req, res) {
        const api = new GMAPI(req, res);
        const user = api.checkGM();
        if (!user) return;

        const { name, level = 1, user_level = 9 } = req.body;
        if (!name) {
            return api.res.status(400).json({ success: false, error: '缺少角色名' });
        }

        try {
            const db = require('../data/sql');
            const existing = await db.exitsRoleName(name);
            if (existing) {
                return api.res.status(400).json({ success: false, error: '角色名已存在' });
            }

            const roleId = 'gm_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 4);
            const role = {
                id: roleId,
                name: name,
                userid: user.id,
                title: '测试GM',
                level: level,
                server: global.WORLD?.SERVERID || 100,
                data: JSON.stringify({
                    prop: [20, 20, 20, 20, 1, 100, 0, 0, 0, 50, 50, 100, 100, 20, 0, Date.now(), 20, 0, 0, 0],
                    quit_room: 'yz/wumiao',
                    items: [],
                    stores: [],
                    eq: [],
                    skills: {},
                    temp: { gm_test: 1, gm_created: Date.now() },
                    settings: {}
                })
            };

            await db.addRole(role);
            api.res.json({ success: true, message: `角色 ${name} 创建成功`, data: role });
        } catch (error) {
            api.res.status(500).json({ success: false, error: error.message });
        }
    },

    // ========== 删除角色 ==========
    async deleteUser(req, res) {
        const api = new GMAPI(req, res);
        const user = api.checkGM();
        if (!user) return;

        const userId = req.params.id;
        if (!userId) {
            return api.res.status(400).json({ success: false, error: '缺少角色ID' });
        }

        try {
            const db = require('../data/sql');
            const onlineUser = global.WORLD?.getUser?.(userId);
            if (onlineUser) {
                onlineUser.send('<RED>你的角色被GM删除了</RED>');
                setTimeout(() => onlineUser.quit(), 1000);
            }

            const result = await db.deleteRole(user.id, userId);
            if (!result) {
                return api.res.status(404).json({ success: false, error: '角色不存在' });
            }

            api.res.json({ success: true, message: '角色已删除' });
        } catch (error) {
            api.res.status(500).json({ success: false, error: error.message });
        }
    },

    // ========== 执行GM命令 ==========
    async executeCommand(req, res) {
        const api = new GMAPI(req, res);
        const user = api.checkGM();
        if (!user) return;

        const { userId, command } = req.body;
        if (!userId) {
            return api.res.status(400).json({ success: false, error: '缺少目标角色ID' });
        }
        if (!command) {
            return api.res.status(400).json({ success: false, error: '缺少命令' });
        }

        const targetUser = global.WORLD?.getUser?.(userId);
        if (!targetUser) {
            return api.res.status(404).json({ success: false, error: '目标玩家不在线' });
        }

        try {
            const hadGm = targetUser.user_level >= 9;
            if (!hadGm) targetUser.user_level = 9;

            const result = targetUser.do_gm_command(command);

            if (!hadGm) targetUser.user_level = 0;

            api.res.json({ success: true, result: result || '命令执行成功' });
        } catch (error) {
            api.res.status(500).json({ success: false, error: error.message });
        }
    },

    // ========== 踢出玩家 ==========
    async kickUser(req, res) {
        const api = new GMAPI(req, res);
        const user = api.checkGM();
        if (!user) return;

        const { userId, reason = 'GM操作' } = req.body;
        if (!userId) {
            return api.res.status(400).json({ success: false, error: '缺少目标角色ID' });
        }

        const target = global.WORLD?.getUser?.(userId);
        if (!target) {
            return api.res.status(404).json({ success: false, error: '目标玩家不在线' });
        }

        target.send(`<RED>你被GM踢出游戏，原因：${reason}</RED>`);
        setTimeout(() => target.quit(), 1000);

        api.res.json({ success: true, message: '玩家已被踢出' });
    },

    // ========== 传送玩家 ==========
    async teleportUser(req, res) {
        const api = new GMAPI(req, res);
        const user = api.checkGM();
        if (!user) return;

        const { userId, roomPath } = req.body;
        if (!userId) {
            return api.res.status(400).json({ success: false, error: '缺少目标角色ID' });
        }
        if (!roomPath) {
            return api.res.status(400).json({ success: false, error: '缺少目标房间' });
        }

        const target = global.WORLD?.getUser?.(userId);
        if (!target) {
            return api.res.status(404).json({ success: false, error: '目标玩家不在线' });
        }

        const room = global.ROOM?.Get?.(roomPath);
        if (!room) {
            return api.res.status(400).json({ success: false, error: '房间不存在' });
        }

        target.moveto && target.moveto(room);
        api.res.json({ success: true, message: `已传送到 ${room.name || roomPath}` });
    },

    // ========== 发放物品 ==========
    async giveItem(req, res) {
        const api = new GMAPI(req, res);
        const user = api.checkGM();
        if (!user) return;

        const { userId, itemPath, count = 1 } = req.body;
        if (!userId) {
            return api.res.status(400).json({ success: false, error: '缺少目标角色ID' });
        }
        if (!itemPath) {
            return api.res.status(400).json({ success: false, error: '缺少物品路径' });
        }

        const target = global.WORLD?.getUser?.(userId);
        if (!target) {
            return api.res.status(404).json({ success: false, error: '目标玩家不在线' });
        }

        let item = null;
        try {
            item = global.OBJ?.CREATE?.(itemPath);
        } catch (e) { }

        if (!item) {
            return api.res.status(400).json({ success: false, error: `找不到物品: ${itemPath}` });
        }

        item.count = parseInt(count) || 1;
        target.add_obj && target.add_obj(item);

        api.res.json({ success: true, message: `已发放 ${item.name || itemPath} x${item.count}` });
    },

    // ========== 物品列表 ==========
    async getItems(req, res) {
        const api = new GMAPI(req, res);
        const user = api.checkGM();
        if (!user) return;

        const page = parseInt(req.query.page) || 1;
        const limit = Math.min(parseInt(req.query.limit) || 100, 500);
        const search = req.query.search || '';

        let items = global.WORLD?.getAllItemTemplates?.() || [];

        if (search) {
            const keyword = search.toLowerCase();
            items = items.filter(i =>
                i.name.toLowerCase().includes(keyword) ||
                i.path.toLowerCase().includes(keyword)
            );
        }

        const total = items.length;
        const start = (page - 1) * limit;
        const data = items.slice(start, start + limit);

        api.res.json({
            success: true,
            data: data,
            total: total,
            page: page,
            limit: limit,
            total_pages: Math.ceil(total / limit)
        });
    },

    // ========== 房间列表 ==========
    async getRooms(req, res) {
        const api = new GMAPI(req, res);
        const user = api.checkGM();
        if (!user) return;

        const page = parseInt(req.query.page) || 1;
        const limit = Math.min(parseInt(req.query.limit) || 100, 500);
        const search = req.query.search || '';
        const area = req.query.area || '';

        let rooms = global.WORLD?.getRoomList?.() || [];

        if (search) {
            const keyword = search.toLowerCase();
            rooms = rooms.filter(r =>
                r.name.toLowerCase().includes(keyword) ||
                r.path.toLowerCase().includes(keyword)
            );
        }

        if (area && area !== 'all') {
            rooms = rooms.filter(r => r.area === area);
        }

        const total = rooms.length;
        const start = (page - 1) * limit;
        const data = rooms.slice(start, start + limit);

        const areas = [...new Set(rooms.map(r => r.area).filter(a => a && a !== '无'))];

        api.res.json({
            success: true,
            data: data,
            total: total,
            page: page,
            limit: limit,
            total_pages: Math.ceil(total / limit),
            areas: areas
        });
    },

    // ========== GM日志 ==========
    async getLogs(req, res) {
        const api = new GMAPI(req, res);
        const user = api.checkGM();
        if (!user) return;

        const limit = Math.min(parseInt(req.query.limit) || 100, 500);
        const logs = global.WORLD?.getGMLogs?.(limit) || [];

        api.res.json({ success: true, data: logs, total: logs.length });
    },

    // ========== 广播消息 ==========
    async broadcast(req, res) {
        const api = new GMAPI(req, res);
        const user = api.checkGM();
        if (!user) return;

        const { message, level = 0 } = req.body;
        if (!message) {
            return api.res.status(400).json({ success: false, error: '缺少消息内容' });
        }

        const count = global.WORLD?.broadcast?.(`<YELLOW>【广播】${message}</YELLOW>`, level) || 0;
        api.res.json({ success: true, count: count, message: `已广播给 ${count} 个玩家` });
    },

    // ========== 热更新 ==========
    async hotload(req, res) {
        const api = new GMAPI(req, res);
        const user = api.checkGM();
        if (!user) return;

        const { type, name } = req.body;
        if (!type || !name) {
            return api.res.status(400).json({ success: false, error: '缺少类型或名称' });
        }

        try {
            const hotload = require('../os/util/hotload');
            const basePath = global.__PATH?.[type.toUpperCase()];
            if (!basePath) {
                return api.res.status(400).json({ success: false, error: `不支持的类型: ${type}` });
            }

            const fullPath = basePath + name;
            const result = hotload.hotload(fullPath, type);

            if (result.success) {
                api.res.json({ success: true, result: result });
            } else {
                api.res.status(500).json({ success: false, error: result.error });
            }
        } catch (error) {
            api.res.status(500).json({ success: false, error: error.message });
        }
    },

    // ========== 保存所有玩家 ==========
    async saveAll(req, res) {
        const api = new GMAPI(req, res);
        const user = api.checkGM();
        if (!user) return;

        const result = global.WORLD?.saveAllPlayers?.() || { success: false, message: '功能不可用' };
        api.res.json(result);
    },

    // ========== ★ 获取玩家完整属性（包含prop）- 开发环境免认证 ==========
    async getPlayerFullAttrs(req, res) {
        const api = new GMAPI(req, res);
        
        // 🔥 开发环境：绕过GM认证
        if (process.env.NODE_ENV === 'development') {
            const userId = req.params.id;
            if (!userId) {
                return res.status(400).json({ success: false, error: '缺少角色ID' });
            }

            const target = global.WORLD?.getUser?.(userId);
            if (!target) {
                return res.status(404).json({ success: false, error: '目标玩家不在线' });
            }

            // 获取stats文本
            let statsText = '';
            try {
                const result = target.do_gm_command('stats');
                if (result) statsText = result;
            } catch(e) {}

            return res.json({
                success: true,
                data: {
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
                    },
                    stats_text: statsText
                }
            });
        }
        
        // 生产环境：正常认证
        const user = api.checkGM();
        if (!user) return;

        const userId = req.params.id;
        if (!userId) {
            return api.res.status(400).json({ success: false, error: '缺少角色ID' });
        }

        const target = global.WORLD?.getUser?.(userId);
        if (!target) {
            return api.res.status(404).json({ success: false, error: '目标玩家不在线' });
        }

        // 获取stats文本
        let statsText = '';
        try {
            const result = target.do_gm_command('stats');
            if (result) statsText = result;
        } catch(e) {}

        api.res.json({
            success: true,
            data: {
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
                },
                stats_text: statsText
            }
        });
    },

    // ========== ★ 修改玩家属性（支持prop）- 开发环境免认证 ==========
    async setPlayerFullAttr(req, res) {
        const api = new GMAPI(req, res);
        
        // 🔥 开发环境：绕过GM认证
        if (process.env.NODE_ENV === 'development') {
            const { userId, attr, value, isProp = false } = req.body;
            if (!userId || attr === undefined || value === undefined) {
                return res.status(400).json({ success: false, error: '缺少参数' });
            }

            const target = global.WORLD?.getUser?.(userId);
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
                
                const result = target.do_gm_command(command);
                return res.json({
                    success: true,
                    message: result || '修改成功',
                    attr: attr,
                    value: value,
                    isProp: isProp
                });
            } catch (error) {
                return res.status(500).json({ success: false, error: error.message });
            }
        }
        
        // 生产环境：正常认证
        const user = api.checkGM();
        if (!user) return;

        const { userId, attr, value, isProp = false } = req.body;
        if (!userId || attr === undefined || value === undefined) {
            return api.res.status(400).json({ success: false, error: '缺少参数' });
        }

        const target = global.WORLD?.getUser?.(userId);
        if (!target) {
            return api.res.status(404).json({ success: false, error: '目标玩家不在线' });
        }

        try {
            let command;
            if (isProp) {
                command = `setprop ${attr} ${value}`;
            } else {
                command = `set ${attr} ${value}`;
            }
            
            const result = target.do_gm_command(command);
            api.res.json({
                success: true,
                message: result || '修改成功',
                attr: attr,
                value: value,
                isProp: isProp
            });
        } catch (error) {
            api.res.status(500).json({ success: false, error: error.message });
        }
    }
};