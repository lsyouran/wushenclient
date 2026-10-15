/**
 * 热更新引擎
 * 支持实时重载脚本，无需重启服务器
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

class HotloadEngine {
    constructor() {
        this.watchedFiles = new Map();
        this.fileTimestamps = new Map();
        this.watchers = [];
        this.isWatching = false;
    }

    /**
     * 热加载单个文件
     * @param {string} filePath - 文件路径
     * @param {string} type - 文件类型 (cmd/skill/obj/area/map/npc)
     * @returns {Object} 加载结果
     */
    hotload(filePath, type) {
        try {
            const fullPath = path.resolve(filePath);
            if (!fs.existsSync(fullPath)) {
                return { success: false, error: `文件不存在: ${fullPath}` };
            }

            // 读取文件内容
            const code = fs.readFileSync(fullPath, 'utf8');
            
            // 清除require缓存
            delete require.cache[require.resolve(fullPath)];
            
            // 创建沙盒环境
            const sandbox = {
                require: require,
                console: console,
                module: { exports: {} },
                exports: {},
                __dirname: path.dirname(fullPath),
                __filename: fullPath,
                // 注入全局对象
                WORLD: global.WORLD,
                CHARACTER: global.CHARACTER,
                USER: global.USER,
                NPC: global.NPC,
                ROOM: global.ROOM,
                ITEM: global.ITEM,
                OBJ: global.OBJ,
                SKILL: global.SKILL,
                BASE: global.BASE,
                UTIL: global.UTIL
            };

            // 执行代码
            const script = new vm.Script(code, { filename: fullPath });
            const context = vm.createContext(sandbox);
            script.runInContext(context);

            // 获取导出的对象
            const exports = sandbox.module.exports || sandbox.exports;

            // 根据类型处理
            const result = this.processHotload(type, exports, fullPath);
            
            // 更新文件时间戳
            this.fileTimestamps.set(fullPath, fs.statSync(fullPath).mtimeMs);

            return {
                success: true,
                type: type,
                path: fullPath,
                result: result,
                message: `热更新成功: ${path.basename(fullPath)}`
            };
        } catch (error) {
            console.error('[Hotload] 热更新失败:', error);
            return {
                success: false,
                error: error.message,
                stack: error.stack
            };
        }
    }

    /**
     * 根据类型处理热加载
     */
    processHotload(type, exports, fullPath) {
        const fileName = path.basename(fullPath, '.js');
        const basePath = path.dirname(fullPath);

        switch (type) {
            case 'cmd':
                return this.reloadCommand(fileName, exports);
            case 'skill':
                return this.reloadSkill(fileName, exports);
            case 'obj':
                return this.reloadObject(fileName, exports);
            case 'area':
                return this.reloadArea(fileName, exports);
            case 'map':
                return this.reloadRoom(fileName, exports);
            case 'npc':
                return this.reloadNPC(fileName, exports);
            case 'family':
                return this.reloadFamily(fileName, exports);
            case 'task':
                return this.reloadTask(fileName, exports);
            default:
                return { loaded: true, message: '已加载（未处理类型）' };
        }
    }

    /**
     * 热加载命令
     */
    reloadCommand(name, exports) {
        if (!exports) return { error: '命令导出为空' };
        
        // 如果命令有enter方法，保留原命令的引用用于备份
        const oldCmd = WORLD.COMMANDS[name];
        WORLD.COMMANDS[name] = exports;
        
        // 更新命令缓存
        if (global.WORLD && WORLD.COMMANDS) {
            console.log(`[Hotload] 命令已更新: ${name}`);
        }
        
        return {
            loaded: true,
            name: name,
            old: oldCmd ? '已备份' : '新命令',
            message: `命令 ${name} 热更新完成`
        };
    }

    /**
     * 热加载技能
     */
    reloadSkill(name, exports) {
        if (!exports) return { error: '技能导出为空' };
        
        const oldSkill = WORLD.SKILLS[name];
        WORLD.SKILLS[name] = exports;
        
        // 更新所有在线玩家的技能
        if (global.WORLD && WORLD.USERS) {
            let updatedCount = 0;
            for (let user of WORLD.USERS) {
                if (user.skills && user.skills[name]) {
                    // 重新初始化技能
                    if (user.init_skill) {
                        user.init_skill();
                        updatedCount++;
                    }
                    // 通知客户端更新
                    if (user.on_skillchanged) {
                        user.on_skillchanged();
                    }
                }
            }
            console.log(`[Hotload] 技能已更新: ${name}, 影响玩家: ${updatedCount}`);
        }
        
        return {
            loaded: true,
            name: name,
            updatedPlayers: updatedCount || 0,
            message: `技能 ${name} 热更新完成`
        };
    }

    /**
     * 热加载物品
     */
    reloadObject(name, exports) {
        if (!exports) return { error: '物品导出为空' };
        
        // 获取物品的路径
        const objPath = name;
        const oldObj = WORLD.OBJ_STORE.get(objPath);
        WORLD.OBJ_STORE.set(objPath, exports);
        
        // 更新已存在的物品实例
        let updatedCount = 0;
        if (global.WORLD && WORLD.USERS) {
            for (let user of WORLD.USERS) {
                if (user.items) {
                    for (let item of user.items) {
                        if (item.path === objPath) {
                            // 更新物品属性
                            Object.assign(item, exports);
                            updatedCount++;
                        }
                    }
                }
                if (user.equipment) {
                    for (let eq of user.equipment) {
                        if (eq && eq.path === objPath) {
                            Object.assign(eq, exports);
                            updatedCount++;
                        }
                    }
                }
            }
        }
        
        console.log(`[Hotload] 物品已更新: ${name}, 影响实例: ${updatedCount}`);
        
        return {
            loaded: true,
            name: name,
            updatedInstances: updatedCount,
            message: `物品 ${name} 热更新完成`
        };
    }

    /**
     * 热加载区域
     */
    reloadArea(name, exports) {
        if (!exports) return { error: '区域导出为空' };
        
        // 查找并更新区域
        let found = false;
        if (global.WORLD && WORLD.AREAS) {
            for (let i = 0; i < WORLD.AREAS.length; i++) {
                if (WORLD.AREAS[i].path === name || WORLD.AREAS[i].name === name) {
                    // 保留原有路径，更新其他属性
                    const oldPath = WORLD.AREAS[i].path;
                    WORLD.AREAS[i] = { ...exports, path: oldPath };
                    found = true;
                    break;
                }
            }
        }
        
        console.log(`[Hotload] 区域已更新: ${name}`);
        
        return {
            loaded: true,
            name: name,
            found: found,
            message: `区域 ${name} 热更新完成`
        };
    }

    /**
     * 热加载房间
     */
    reloadRoom(name, exports) {
        if (!exports) return { error: '房间导出为空' };
        
        const oldRoom = WORLD.ROOMS[name];
        if (oldRoom) {
            // 保留重要属性
            const preserved = {
                path: oldRoom.path,
                items: oldRoom.items || [],
                _copyData: oldRoom._copyData,
                _parent: oldRoom._parent
            };
            
            // 合并新属性
            const newRoom = { ...exports, ...preserved };
            WORLD.ROOMS[name] = newRoom;
            
            // 更新房间中的玩家
            if (oldRoom.items) {
                for (let item of oldRoom.items) {
                    if (item.is_player && item.environment === oldRoom) {
                        item.environment = newRoom;
                    }
                }
            }
            
            console.log(`[Hotload] 房间已更新: ${name}`);
            return {
                loaded: true,
                name: name,
                message: `房间 ${name} 热更新完成`
            };
        } else {
            // 新房间
            WORLD.ROOMS[name] = exports;
            console.log(`[Hotload] 新房间已加载: ${name}`);
            return {
                loaded: true,
                name: name,
                isNew: true,
                message: `新房间 ${name} 已加载`
            };
        }
    }

    /**
     * 热加载NPC
     */
    reloadNPC(name, exports) {
        if (!exports) return { error: 'NPC导出为空' };
        
        const npcPath = name;
        const oldNPC = WORLD.NPC_STORE.get(npcPath);
        WORLD.NPC_STORE.set(npcPath, exports);
        
        // 更新已存在的NPC实例
        let updatedCount = 0;
        if (global.WORLD && WORLD.USERS) {
            for (let user of WORLD.USERS) {
                if (user.follower) {
                    for (let follower of user.follower) {
                        if (follower.path === npcPath) {
                            // 更新追随者
                            updatedCount++;
                        }
                    }
                }
            }
        }
        
        console.log(`[Hotload] NPC已更新: ${name}, 影响实例: ${updatedCount}`);
        
        return {
            loaded: true,
            name: name,
            updatedInstances: updatedCount,
            message: `NPC ${name} 热更新完成`
        };
    }

    /**
     * 热加载门派
     */
    reloadFamily(name, exports) {
        if (!exports) return { error: '门派导出为空' };
        
        if (global.FAMILIES) {
            FAMILIES[name] = exports;
            console.log(`[Hotload] 门派已更新: ${name}`);
            return {
                loaded: true,
                name: name,
                message: `门派 ${name} 热更新完成`
            };
        }
        
        return { error: 'FAMILIES未定义' };
    }

    /**
     * 热加载任务
     */
    reloadTask(name, exports) {
        if (!exports) return { error: '任务导出为空' };
        
        let found = false;
        if (global.WORLD && WORLD.TASKS) {
            for (let i = 0; i < WORLD.TASKS.length; i++) {
                if (WORLD.TASKS[i].name === name || WORLD.TASKS[i].id === name) {
                    WORLD.TASKS[i] = exports;
                    found = true;
                    break;
                }
            }
            if (!found) {
                WORLD.TASKS.push(exports);
            }
        }
        
        console.log(`[Hotload] 任务已更新: ${name}`);
        
        return {
            loaded: true,
            name: name,
            found: found,
            message: `任务 ${name} 热更新完成`
        };
    }

    /**
     * 批量热加载目录
     * @param {string} dirPath - 目录路径
     * @param {string} type - 文件类型
     * @param {string} pattern - 文件匹配模式
     * @returns {Array} 加载结果列表
     */
    hotloadDirectory(dirPath, type, pattern = '.js') {
        const results = [];
        try {
            const files = fs.readdirSync(dirPath);
            for (let file of files) {
                if (file.endsWith(pattern)) {
                    const fullPath = path.join(dirPath, file);
                    const name = file.replace(pattern, '');
                    const result = this.hotload(fullPath, type);
                    results.push(result);
                }
            }
        } catch (error) {
            results.push({ success: false, error: error.message });
        }
        return results;
    }

    /**
     * 启动文件监听（自动热更新）
     * @param {string} watchDir - 监听的目录
     * @param {string} type - 文件类型
     * @param {number} debounce - 防抖延迟(ms)
     */
    startWatching(watchDir, type, debounce = 500) {
        if (this.isWatching) {
            console.log('[Hotload] 已有监听器在运行');
            return;
        }

        const watchPath = path.resolve(watchDir);
        if (!fs.existsSync(watchPath)) {
            console.error(`[Hotload] 目录不存在: ${watchPath}`);
            return;
        }

        console.log(`[Hotload] 开始监听: ${watchPath} (类型: ${type})`);

        let timer = null;
        const watcher = fs.watch(watchPath, { recursive: true }, (eventType, filename) => {
            if (!filename || filename.endsWith('.swp') || filename.startsWith('.')) return;
            
            // 防抖
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => {
                const fullPath = path.join(watchPath, filename);
                if (fs.existsSync(fullPath) && filename.endsWith('.js')) {
                    console.log(`[Hotload] 检测到文件变化: ${filename}`);
                    const name = filename.replace('.js', '');
                    const result = this.hotload(fullPath, type);
                    if (result.success) {
                        console.log(`[Hotload] ✅ ${result.message}`);
                    } else {
                        console.log(`[Hotload] ❌ ${result.error}`);
                    }
                }
            }, debounce);
        });

        this.watchers.push({
            watcher: watcher,
            path: watchPath,
            type: type
        });
        this.isWatching = true;
    }

    /**
     * 停止文件监听
     */
    stopWatching() {
        for (let w of this.watchers) {
            w.watcher.close();
        }
        this.watchers = [];
        this.isWatching = false;
        console.log('[Hotload] 已停止文件监听');
    }

    /**
     * 获取加载状态
     */
    getStatus() {
        return {
            isWatching: this.isWatching,
            watchers: this.watchers.map(w => ({
                path: w.path,
                type: w.type
            })),
            fileCount: this.fileTimestamps.size
        };
    }

    /**
     * 清理缓存
     */
    clearCache() {
        this.fileTimestamps.clear();
        console.log('[Hotload] 缓存已清理');
    }
}

// 导出单例
module.exports = new HotloadEngine();