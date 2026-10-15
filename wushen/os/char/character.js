require("../item");
/*global CHARACTER ROOM ITEM*/
CHARACTER = function () {
    this.name = "生物";
    this.hp = this.max_hp = 100;
    this.mp = this.max_mp = 100;
    this.str = this.con = this.dex = this.int = 20;
    this.money = 0;
}
CHARACTER.inherits(ITEM);
CHARACTER.prototype.send = function () {

}
CHARACTER.prototype.notify = function () {

}
CHARACTER.prototype.send_commands = function () {

}
CHARACTER.prototype.notify_fail = function () {
    return false;
}
CHARACTER.prototype.is_living = function () {
    return this.hp > 0;
}
CHARACTER.prototype.is_in = function (path) {
    if (!this.environment) return false;
    return this.environment.path === path;
}
CHARACTER.prototype.is_here = function (obj) {
    if (!this.environment || !obj.environment) return false;
    return this.environment === obj.environment;
}

CHARACTER.prototype.find_obj = function (oid, parent) {
    var items = this.items;
    if (parent) items = parent.items;
    return this.find_obj_byid(items, oid);
}
CHARACTER.prototype.send_message = function (msg, include_me) {
    if (!msg || !this.environment) return;
    var list = this.environment.items;
    for (var i = 0; i < list.length; i++) {
        if (list[i].is_player) {
            if (list[i] === this && !include_me) continue;
            if (!list[i].no_message)
                list[i].notify(msg);
        }
    }
}
CHARACTER.prototype.send_combat = function (text, target) {
    if (!this.environment || !text) return;
    var list = this.environment.items;
    var th_vision, item;
    for (var i = 0; i < list.length; i++) {
        item = list[i];
        if (item.is_player) {
            if (item === this) {
                if (!item.query_setting("no_mcmsg"))
                    item.notify(splitmessage(this, text, 1, target));
            } else if (item === target) {
                if (!item.query_setting("no_mcmsg"))
                    item.notify(splitmessage(this, text, 2, target));
            } else if (!item.no_message && !item.query_setting("no_combatmsg")) {
                if (!th_vision) th_vision = splitmessage(this, text, 3, target);
                item.notify(th_vision);
            }
        }
    }
}
CHARACTER.prototype.send_room = function (text, target, excludeself) {
    if (!this.environment || !text) return;
    var list = this.environment.items;
    var th_vision;
    for (var i = 0; i < list.length; i++) {
        if (list[i].is_player) {
            if (list[i] === this) {
                !excludeself && list[i].notify(splitmessage(this, text, 1, target));
            } else if (list[i] === target) {
                list[i].notify(splitmessage(this, text, 2, target));
            } else if (!list[i].no_message) {
                if (!th_vision) th_vision = splitmessage(this, text, 3, target);
                list[i].notify(th_vision);
            }
        }
    }
}
CHARACTER.prototype.query_setting = function (name) {
    return false;
}
function splitmessage(me, text, type, target) {
    if (text.length < 3) return text;
    var str = [];
    var start = 0;
    for (var i = 0; i < text.length; i++) {
        if (text[i] === "$") {
            start < i && str.push(text.substring(start, i));
            var ch = text[++i];
            start = i + 1;
            //type 1本人视角 2目标视角 3第三人称视角
            switch (ch) {
                case "N"://本人
                    str.push(type === 1 ? "你" : me.name);
                    break;
                case "n"://目标
                    str.push(type === 2 ? "你" : target.name);
                    break;
                case "P":
                    str.push(type === 1 ? "你" : me.call3());
                    break;
                case "p":
                    str.push(type === 2 ? "你" : target.call3());
                    break;
                case "l":
                    str.push(me.attack_part ? me.attack_part.name : "");
                    break;
                case "W":
                case "w":
                    str.push(me.weapon_name() || "手");
                    break;
                case "i":
                    str.push(target.weapon_name() || "手");
                    break;
                case "T":
                    str.push(me.throwing_name());
                    break;

            }
        }
    }
    start < i && str.push(text.substring(start, i));
    return str.join("");
}

//执行一串命令
CHARACTER.prototype.command = function (req) {

    if (this.wait_input) { //如果用户等待输入
        this.wait_input.apply(this, [this, req]);
        return;
    }
    var cmd = null, pars = null, start = 0, i = 0;
    for (; i < req.length; i++) {
        if (req[i] === ' ') {
            if (start < i) {
                cmd = req.substring(start, i);
                pars = req.substring(i + 1);
                break;
            }
            start = i;
        }
    }
    if (!cmd) cmd = req;
    this.do_command(cmd, pars);
}
CHARACTER.prototype.do_command = function (cmdName, str) {

    var cmd = WORLD.COMMANDS[cmdName];
    var pars;
    if (cmd && cmd.regex && str) {
        pars = cmd.regex.exec(str);
        pars ? pars[0] = this : pars = [this, str];
    } else {
        pars = [this, str];
    }
    if (this.do_item_action(this.environment, cmdName, pars)) {
        //如果环境触发这个命令就返回
        return;
    }
    cmd = cmd || WORLD.DEFAULT_COMMAND;
    if (cmd) {
        if (!this.check_command(cmd))
            return;//不允许执行
        if (cmd.enter.apply(cmd, pars) !== false) {

            return;//命令执行完成。
        }

    }
    if (str) {
        //如果有参数，尝试找下这个物件
        if (this.do_item_action(this.find_obj(str, this.environment), cmdName, pars)) {
            //如果物件触发这个命令就返回
            return;
        }
    }
    this.send("什么？");
}
CHARACTER.prototype.do_item_action = function (item, cmd, pars) {
    if (!item || !item.actions) return;
    var cmdItem = item.actions[cmd];
    if (!cmdItem || !cmdItem.action) return;
    if (!this.check_command(cmdItem))
        return true;//返回true 不允许执行
    if (cmdItem.action.apply(item, pars) !== false)
        return true; //返回true表示不继续执行该命令
}
CHARACTER.prototype.check_command = function (cmd) {
    if (cmd.allow_level > this.user_level) {
        this.send("什么？");
        return false;
    }
    if (this.hp <= 0 && !cmd.allow_die) {
        //死亡状态,除了一些特殊指令都不能做
        return this.notify_fail("你现在是灵魂状态，不能那么做。");
    }
    if (!cmd.allow_faint && this.is_faint) {
        this.send("你正在昏迷中！");
        return false;
    }
    if (!cmd.allow_state && this.state) {
        return this.notify_fail("你正在" + this.state.title + "，没时间这么做。");
    }
    if (!cmd.allow_fight && this.fight_type > 0) {
        return this.notify_fail("你正在战斗，待会再说。");
    }
    if (!cmd.allow_busy && this.is_busy) {
        return this.notify_fail("你现在正忙。");
    }

    return true;
}
CHARACTER.prototype.create = function (path, par) {
    //模板被创建，实际上没真正用
    if (par) this.path = path + par;
    this.on_create && this.on_create(path, par);

    WORLD.NPC_STROE.set(this.path, this);
}
CHARACTER.prototype.update = function (path, par) {
    this.create(path, par);
}

//真正被复制到房间
CHARACTER.prototype.clone = function () {
    if (this.temp) this.temp = Object.create(this.temp);
    if (this.prop) this.prop = Object.create(this.prop);
    if (this.equipment) {
        let eqs = [];
        for (let i = 0; i < this.equipment.length; i++) {
            let item = this.equipment[i];
            if (item) {
                eqs[i] = OBJ.CREATE(item.path);
            }
        }
        this.equipment = eqs;
    }
    //装备和道具只保留引用应该没事，2个相同NPC的装备和背包是同一个道具
    //好像随从不行
    if (this.items) {
        let items = [];
        for (let i = 0; i < this.items.length; i++) {
            items[i] = OBJ.CREATE(this.items[i].path);
        }
        this.items = items;
    }
    this.create_id();
    this.init();

    this.recount();
    this.hp = this.max_hp;
    this.mp = this.max_mp;
    this.on_clone && this.on_clone();
}


CHARACTER.prototype.init = function () {
    if (this.equipment) {
        let groups = {};
        for (let i = 0; i < this.equipment.length; i++) {
            let item = this.equipment[i];
            if (item) {
                item.change_prop(this, true);
                item.on_eq && item.on_eq(this);
                if (item && item.group_name) {
                    groups[item.group_name] = (groups[item.group_name] || 0) + 1;
                    var prop = item.group_prop(groups[item.group_name]);
                    if (prop) {
                        this.change_prop(prop, true);
                    }
                }
            }
        }
    }
    if (this.is_player) this.score = 0;
    if (this.skills) {
        for (let item in this.skills) {
            var base_skill = SKILL.get(item);
            if (!base_skill) {
                delete this.skills[item];
                continue;
            }
            base_skill.attach_prop(this, this.query_skill(item));
            if (this.is_player) {
                this.score += base_skill.query_score(this.skills[item].level, this);
            }

        }
    }

    this.init_skill();
}
CHARACTER.EXP_LIMIT = [300000, 3000000, 20000000];
CHARACTER.prototype.add_exp = function (exp, pot, money) {
    if (exp) {
        exp += this.query_temp("exp_up", 0);

    }
    if (pot) {
        pot += this.query_temp("pot_up", 0);

    }
    var str = ["<hig>你获得了"];
    if (exp) {
        this.exp += exp;
        str.push(exp);
        str.push("点经验");
    }
    if (pot) {
        this.pot += pot;
        if (exp) str.push("，");
        str.push(pot);
        str.push("点潜能");
    }
    if (money) {

        this.money += money;
        if (exp || pot) str.push("，");
        str.push(UTIL.moneyToStr(money));
    }
    if (str.length === 1) return;
    str.push("。</hig>");
    this.send(str.join(""));
}
CHARACTER.prototype.add_money = function (val) {
    this.money += val;

}
CHARACTER.prototype.check_groupeq = function () {
    var eqs = {};
    for (var i = 0; i < this.equipment.length; i++) {
        var item = this.equipment[i];
        if (item && item.group_name) {
            eqs[item.group_name] = (eqs[item.group_name] || 0) + 1;
            var prop = item.group_prop(eqs[item.group_name]);
            if (prop) {
                this.change_prop(prop, true);
            }
        }
    }
}
// ============ GM命令系统 ============

/**
 * GM命令执行入口
 * @param {string} command - 完整命令字符串
 * @returns {string} 执行结果
 */
CHARACTER.prototype.do_gm_command = function(command) {
    // 检查GM权限
    if (this.user_level < 9) {
        return '❌ 你没有GM权限 (需要 user_level >= 9)';
    }
    
    // 记录日志
    WORLD.logGM && WORLD.logGM(this, command);
    
    // 解析命令
    const parts = command.trim().split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1);
    
    // 创建命令执行上下文
    const context = {
        character: this,
        args: args,
        cmd: cmd,
        WORLD: WORLD,
        ROOM: ROOM,
        OBJ: OBJ,
        SKILL: SKILL
    };
    
    // 查找命令处理器
    let handler = this.gmCommandHandlers[cmd];
    if (!handler) {
        // 尝试查找动态注册的命令
        handler = WORLD.gmCommands && WORLD.gmCommands[cmd];
    }
    
    if (!handler) {
        return this.getGMHelp(cmd);
    }
    
    try {
        const result = handler.call(context);
        if (result && this.send) {
            this.send(typeof result === 'string' ? result : JSON.stringify(result, null, 2));
        }
        return result || '✅ 命令执行成功';
    } catch (error) {
        const msg = `❌ 执行错误: ${error.message}`;
        this.send && this.send(`<RED>${msg}</RED>`);
        return msg;
    }
};

/**
 * GM命令处理器映射
 */
CHARACTER.prototype.gmCommandHandlers = {
    // ========== 基础命令 ==========
    
    help: function() {
        return `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎮 【GM命令列表】

📊 信息查看:
  stats              - 查看自身属性
  who                - 查看在线玩家
  room               - 查看当前房间信息
  inv                - 查看背包
  skills             - 查看技能列表
  
⚡ 属性修改:
  set <属性> <值>    - 设置属性 (hp/mp/str/con/dex/int/level/exp/pot/money/user_level/attack/defense/speed)
  setall <属性1> <值1> <属性2> <值2> ... - 批量设置
  setprop <属性> <值> - 设置后天属性 (最终伤害/忽视防御/暴击伤害等)
  showprop           - 查看所有后天属性
  hpct <0-100>       - 设置血量百分比
  mpct <0-100>       - 设置魔法百分比
  heal               - 恢复满状态

💰 奖励系统:
  exp [数量]         - 获得经验 (默认10000)
  pot [数量]         - 获得潜能 (默认5000)
  money [数量]       - 获得金钱 (默认10000)
  give <路径> [数量] - 获得物品

🚀 传送/移动:
  go <房间路径>      - 传送到指定房间
  goto <玩家名>      - 传送到玩家所在位置
  summon <玩家名>    - 把玩家召唤到自己身边

👥 玩家管理:
  kick <玩家名>      - 踢出玩家
  ban <玩家名>       - 封禁玩家
  unban <玩家名>     - 解封玩家
  copy <玩家名>      - 复制玩家属性
  clone <玩家名>     - 复制玩家

🔄 热更新:
  hotload <类型> <名称> - 热加载文件 (cmd/skill/obj/room/npc)
  hotdir <目录> <类型>  - 批量热加载目录
  watch <目录> <类型>   - 监听目录自动更新
  unwatch              - 停止监听
  reloadcmd <名称>     - 重新加载命令
  reloadskill <名称>   - 重新加载技能

🛠️ 服务器管理:
  broadcast <消息>   - 广播消息给所有玩家
  save               - 保存所有玩家数据
  shutdown           - 关闭服务器
  restart            - 重启服务器 (需要实现)
  status             - 查看服务器状态
  log [数量]         - 查看GM日志

🏠 房间管理:
  addroom <路径> <名称> - 创建新房间
  delroom <路径>       - 删除房间
  clearmob            - 清除当前房间怪物

🎯 其他:
  sync               - 同步客户端
  refresh            - 刷新自身状态
  kill               - 自杀(测试死亡)
  time               - 查看服务器时间

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
    },

    // ========== 信息查看 ==========
    
    stats: function() {
        const me = this.character;
        return `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 【角色信息】
  名称: ${me.name} (${me.id})
  等级: ${me.level} | 权限: ${me.user_level}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
❤️ 生命: ${me.hp}/${me.max_hp} (${Math.round(me.hp/me.max_hp*100)}%)
💙 魔法: ${me.mp}/${me.max_mp} (${Math.round(me.mp/me.max_mp*100)}%)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💪 力量: ${me.str} | 🛡️ 体质: ${me.con}
🏃 敏捷: ${me.dex} | 🧠 智力: ${me.int}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⭐ 经验: ${me.exp || 0} | 🔮 潜能: ${me.pot || 0}
💰 金钱: ${me.money || 0}
📍 位置: ${me.environment?.name || '未知'} (${me.environment?.path || '无'})
🗺️ 区域: ${me.environment?.area || '无'}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📦 背包: ${me.items ? me.items.length : 0} 件
⚔️ 装备: ${me.equipment ? me.equipment.filter(e => e).length : 0} 件
🎯 技能: ${me.skills ? Object.keys(me.skills).length : 0} 个
👥 追随者: ${me.follower ? me.follower.length : 0} 个
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
    },

    who: function() {
        const users = WORLD.USERS || [];
        const online = users.filter(u => u.socket);
        const result = [
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
            `👥 【在线玩家】 (${online.length}/${users.length})`,
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
        ];
        online.forEach((u, i) => {
            const room = u.environment?.name || '未知';
            const ip = u.ip ? u.ip() : 'unknown';
            result.push(`  ${i+1}. ${u.name} (Lv.${u.level}) ${u.user_level>=9?'👑':''} @ ${room} [${ip}]`);
        });
        if (online.length === 0) {
            result.push('  (暂无在线玩家)');
        }
        result.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        return result.join('\n');
    },

    room: function() {
        const me = this.character;
        const room = me.environment;
        if (!room) return '❌ 没有房间信息';
        
        const items = room.items || [];
        const players = items.filter(i => i.is_player);
        const npcs = items.filter(i => i.is_npc);
        const objs = items.filter(i => !i.is_player && !i.is_npc);
        
        return `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🏠 【房间信息】
  名称: ${room.name || '未知'}
  路径: ${room.path || '无'}
  区域: ${room.area || '无'}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🚪 出口: ${room.exits ? Object.keys(room.exits).join(', ') : '无'}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
👥 玩家: ${players.length} 人
  ${players.map(p => p.name).join(', ') || '无'}
👾 NPC: ${npcs.length} 个
  ${npcs.map(n => n.name).join(', ') || '无'}
📦 物品: ${objs.length} 件
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
    },

    inv: function() {
        const me = this.character;
        const items = me.items || [];
        if (items.length === 0) return '📦 背包为空';
        
        const result = ['━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', '📦 【背包物品】', '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'];
        items.forEach((item, i) => {
            const count = item.count || 1;
            const grade = '⭐'.repeat(Math.min(item.grade || 0, 5)) || '无';
            result.push(`  ${i+1}. ${item.name || '未知'} x${count} [${grade}]`);
        });
        result.push(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        result.push(`总计: ${items.length} 件物品`);
        return result.join('\n');
    },

    skills: function() {
        const me = this.character;
        const skills = me.skills || {};
        const keys = Object.keys(skills);
        if (keys.length === 0) return '🎯 没有技能';
        
        const result = ['━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', '🎯 【技能列表】', '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'];
        keys.forEach((name, i) => {
            const skill = skills[name];
            const level = skill.level || 0;
            const exp = skill.exp || 0;
            result.push(`  ${i+1}. ${name} Lv.${level} (经验: ${exp})`);
        });
        result.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        return result.join('\n');
    },

    // ========== 属性修改 ==========
    
    set: function() {
        const me = this.character;
        const attr = this.args[0];
        const value = parseInt(this.args[1]);
        if (!attr || isNaN(value)) return '❌ 用法: set <属性名> <数值>';
        
        const validAttrs = [
            'level', 'hp', 'max_hp', 'mp', 'max_mp',
            'str', 'con', 'dex', 'int', 'exp', 'pot', 'money',
            'user_level', 'attack', 'defense', 'speed',
            'limit_mp', 'per', 'kar', 'gender', 'score', 'cash_money',
            'max_item_count', 'max_store_count'
        ];
        
        if (!validAttrs.includes(attr)) {
            return `❌ 无效属性: ${attr}\n可用: ${validAttrs.join(', ')}`;
        }
        
        const oldValue = me[attr];
        me[attr] = value;
        
        // 重新计算属性
        if (['level', 'str', 'con', 'dex', 'int', 'max_hp', 'max_mp', 'limit_mp'].includes(attr)) {
            me.recount && me.recount();
        }
        
        // 更新客户端
        if (['hp', 'mp', 'max_hp', 'max_mp'].includes(attr)) {
            me.notify_hp && me.notify_hp();
        }
        
        return `✅ ${attr}: ${oldValue} → ${value} (已生效)`;
    },

    setall: function() {
        const me = this.character;
        const args = this.args;
        if (args.length < 2 || args.length % 2 !== 0) {
            return '❌ 用法: setall <属性1> <值1> <属性2> <值2> ...';
        }
        
        const validAttrs = [
            'level', 'hp', 'max_hp', 'mp', 'max_mp', 'limit_mp',
            'str', 'con', 'dex', 'int', 'per', 'kar',
            'exp', 'pot', 'money', 'user_level',
            'attack', 'defense', 'speed'
        ];
        
        const results = [];
        for (let i = 0; i < args.length; i += 2) {
            const attr = args[i];
            const value = parseInt(args[i + 1]);
            if (isNaN(value)) {
                results.push(`  ${attr}: 无效数值`);
                continue;
            }
            if (!validAttrs.includes(attr)) {
                results.push(`  ${attr}: 不支持`);
                continue;
            }
            const oldValue = me[attr];
            me[attr] = value;
            results.push(`  ${attr}: ${oldValue} → ${value}`);
        }
        
        me.recount && me.recount();
        me.notify_hp && me.notify_hp();
        return `✅ 批量修改完成:\n${results.join('\n')}`;
    },

    hpct: function() {
        const me = this.character;
        const pct = parseInt(this.args[0]);
        if (isNaN(pct) || pct < 0 || pct > 100) {
            return '❌ 用法: hpct <0-100> (百分比)';
        }
        me.hp = Math.floor(me.max_hp * pct / 100);
        me.notify_hp && me.notify_hp();
        return `✅ 血量设置为 ${pct}% (${me.hp}/${me.max_hp})`;
    },

    mpct: function() {
        const me = this.character;
        const pct = parseInt(this.args[0]);
        if (isNaN(pct) || pct < 0 || pct > 100) {
            return '❌ 用法: mpct <0-100> (百分比)';
        }
        me.mp = Math.floor(me.max_mp * pct / 100);
        me.notify_hp && me.notify_hp();
        return `✅ 魔法设置为 ${pct}% (${me.mp}/${me.max_mp})`;
    },

    heal: function() {
        const me = this.character;
        me.hp = me.max_hp;
        me.mp = me.max_mp;
        me.notify_hp && me.notify_hp();
        return '✅ 已恢复全部生命和魔法';
    },

    // ========== 奖励系统 ==========
    
    exp: function() {
        const me = this.character;
        const exp = parseInt(this.args[0]) || 10000;
        me.add_exp && me.add_exp(exp, 0, 0);
        return `✅ 获得 ${exp} 点经验`;
    },

    pot: function() {
        const me = this.character;
        const pot = parseInt(this.args[0]) || 5000;
        me.pot = (me.pot || 0) + pot;
        return `✅ 获得 ${pot} 点潜能`;
    },

    money: function() {
        const me = this.character;
        const money = parseInt(this.args[0]) || 10000;
        me.add_money && me.add_money(money);
        return `✅ 获得 ${money} 金币`;
    },

    give: function() {
        const me = this.character;
        const itemPath = this.args[0];
        const count = parseInt(this.args[1]) || 1;
        if (!itemPath) return '❌ 用法: give <物品路径> [数量]';
        
        let item = null;
        try {
            item = OBJ.CREATE(itemPath);
        } catch(e) {}
        
        if (!item) {
            // 在存储中查找
            const store = WORLD.OBJ_STROE || new Map();
            for (let [key, val] of store) {
                if (key.includes(itemPath) || itemPath.includes(key)) {
                    try {
                        item = OBJ.CREATE(key);
                        if (item) break;
                    } catch(e) {}
                }
            }
        }
        
        if (!item) return `❌ 找不到物品: ${itemPath}`;
        
        item.count = count;
        me.add_obj && me.add_obj(item);
        return `✅ 获得 ${item.name || itemPath} x${count}`;
    },

    // ========== 传送/移动 ==========
    
    go: function() {
        const me = this.character;
        const roomPath = this.args[0];
        if (!roomPath) return '❌ 用法: go <房间路径>';
        
        let room = ROOM.Get(roomPath);
        if (!room) {
            // 在已知房间中查找
            const rooms = WORLD.ROOMS || {};
            for (let key in rooms) {
                if (key.includes(roomPath) || roomPath.includes(key)) {
                    room = rooms[key];
                    break;
                }
            }
        }
        
        if (!room) return `❌ 找不到房间: ${roomPath}`;
        
        me.moveto && me.moveto(room);
        return `✅ 已传送到 ${room.name || roomPath}`;
    },

    goto: function() {
        const me = this.character;
        const targetName = this.args[0];
        if (!targetName) return '❌ 用法: goto <玩家名>';
        
        const target = WORLD.find_user(targetName);
        if (!target) return `❌ 找不到玩家: ${targetName}`;
        if (!target.environment) return `❌ 玩家不在任何房间`;
        
        me.moveto && me.moveto(target.environment);
        return `✅ 已传送到 ${target.name} 所在位置 (${target.environment.name})`;
    },

    summon: function() {
        const me = this.character;
        const targetName = this.args[0];
        if (!targetName) return '❌ 用法: summon <玩家名>';
        
        const target = WORLD.find_user(targetName);
        if (!target) return `❌ 找不到玩家: ${targetName}`;
        if (!me.environment) return '❌ 你不在任何房间';
        
        target.moveto && target.moveto(me.environment);
        target.send(`<YELLOW>你被GM ${me.name} 召唤到 ${me.environment.name}</YELLOW>`);
        return `✅ 已将 ${target.name} 召唤到当前位置`;
    },

    // ========== 玩家管理 ==========
    
    kick: function() {
        const targetName = this.args[0];
        if (!targetName) return '❌ 用法: kick <玩家名>';
        
        const target = WORLD.find_user(targetName);
        if (!target) return `❌ 找不到玩家: ${targetName}`;
        if (target === this.character) return '❌ 不能踢出自己';
        
        target.send('<RED>你被GM踢出游戏</RED>');
        setTimeout(() => target.quit(), 1000);
        return `✅ 已踢出 ${target.name}`;
    },

    ban: function() {
        const targetName = this.args[0];
        if (!targetName) return '❌ 用法: ban <玩家名>';
        
        // TODO: 实现封禁逻辑
        return `⏳ 封禁功能待实现: ${targetName}`;
    },

    unban: function() {
        const targetName = this.args[0];
        if (!targetName) return '❌ 用法: unban <玩家名>';
        
        // TODO: 实现解封逻辑
        return `⏳ 解封功能待实现: ${targetName}`;
    },

    copy: function() {
        const me = this.character;
        const targetName = this.args[0];
        if (!targetName) return '❌ 用法: copy <玩家名>';
        
        const target = WORLD.find_user(targetName);
        if (!target) return `❌ 找不到玩家: ${targetName}`;
        if (target === me) return '❌ 不能复制自己';
        
        const attrs = ['level', 'hp', 'max_hp', 'mp', 'max_mp', 'str', 'con', 'dex', 'int', 'exp', 'pot', 'money'];
        const results = ['✅ 已复制属性:'];
        attrs.forEach(attr => {
            const oldVal = me[attr];
            me[attr] = target[attr];
            results.push(`  ${attr}: ${oldVal} → ${target[attr]}`);
        });
        me.recount && me.recount();
        me.notify_hp && me.notify_hp();
        return results.join('\n');
    },

    clone: function() {
        const me = this.character;
        const targetName = this.args[0];
        if (!targetName) return '❌ 用法: clone <玩家名>';
        
        const target = WORLD.find_user(targetName);
        if (!target) return `❌ 找不到玩家: ${targetName}`;
        if (target === me) return '❌ 不能克隆自己';
        
        // 创建克隆NPC
        try {
            const clone = new CHARACTER();
            clone.name = target.name + '的克隆';
            clone.level = target.level;
            clone.str = target.str;
            clone.con = target.con;
            clone.dex = target.dex;
            clone.int = target.int;
            clone.hp = target.hp;
            clone.max_hp = target.max_hp;
            clone.mp = target.mp;
            clone.max_mp = target.max_mp;
            clone.is_npc = true;
            clone.is_clone = true;
            
            if (me.environment) {
                me.environment.add_item(clone);
                clone.environment = me.environment;
            }
            
            return `✅ 已克隆 ${target.name} 到当前房间`;
        } catch(e) {
            return `❌ 克隆失败: ${e.message}`;
        }
    },

    // ========== 热更新 ==========
    
    hotload: function() {
        const type = this.args[0];
        const name = this.args[1];
        if (!type || !name) return '❌ 用法: hotload <类型> <名称>\n类型: cmd/skill/obj/room/npc/area/family/task';
        
        const hotload = require('../util/hotload');
        const basePath = __PATH[type.toUpperCase()];
        if (!basePath) return `❌ 不支持的类型: ${type}`;
        
        const fullPath = basePath + name;
        const result = hotload.hotload(fullPath, type);
        
        if (result.success) {
            return `✅ ${result.message}`;
        } else {
            return `❌ ${result.error}`;
        }
    },

    hotdir: function() {
        const dir = this.args[0];
        const type = this.args[1];
        if (!dir || !type) return '❌ 用法: hotdir <目录名> <类型>';
        
        const hotload = require('../util/hotload');
        const basePath = __PATH[type.toUpperCase()];
        if (!basePath) return `❌ 不支持的类型: ${type}`;
        
        const fullPath = basePath + dir;
        const results = hotload.hotloadDirectory(fullPath, type);
        
        const success = results.filter(r => r.success);
        const failed = results.filter(r => !r.success);
        return `✅ 热加载完成: ${success.length} 成功, ${failed.length} 失败\n${success.map(r => `  ✅ ${r.message}`).join('\n')}`;
    },

    watch: function() {
        const dir = this.args[0];
        const type = this.args[1];
        if (!dir || !type) return '❌ 用法: watch <目录> <类型>';
        
        const hotload = require('../util/hotload');
        const basePath = __PATH[type.toUpperCase()];
        if (!basePath) return `❌ 不支持的类型: ${type}`;
        
        const fullPath = basePath + dir;
        hotload.startWatching(fullPath, type);
        return `✅ 已开始监听: ${fullPath}`;
    },

    unwatch: function() {
        const hotload = require('../util/hotload');
        hotload.stopWatching();
        return '✅ 已停止所有文件监听';
    },

    reloadcmd: function() {
        const name = this.args[0];
        if (!name) return '❌ 用法: reloadcmd <命令名>';
        return this.gmCommandHandlers.hotload.call(this, 'cmd', name);
    },

    reloadskill: function() {
        const name = this.args[0];
        if (!name) return '❌ 用法: reloadskill <技能名>';
        return this.gmCommandHandlers.hotload.call(this, 'skill', name);
    },

    // ========== 服务器管理 ==========
    
    broadcast: function() {
        const message = this.args.join(' ');
        if (!message) return '❌ 用法: broadcast <消息>';
        
        const count = WORLD.broadcast && WORLD.broadcast(`<YELLOW>【广播】${message}</YELLOW>`);
        return `✅ 已广播消息给 ${count || 0} 个玩家`;
    },

    save: function() {
        const result = WORLD.saveAllPlayers && WORLD.saveAllPlayers();
        if (result) {
            return `✅ 已保存 ${result.saved}/${result.total} 个玩家`;
        }
        return '✅ 玩家数据已保存';
    },

    shutdown: function() {
        const me = this.character;
        me.send('<RED>⚠️ 服务器正在关闭...</RED>');
        setTimeout(() => {
            process.exit(0);
        }, 2000);
        return '⏳ 服务器正在关闭...';
    },

    restart: function() {
        const me = this.character;
        me.send('<YELLOW>🔄 服务器正在重启...</YELLOW>');
        // TODO: 实现重启逻辑
        return '⏳ 重启功能需要额外实现';
    },

    status: function() {
        const status = WORLD.getServerStatus && WORLD.getServerStatus();
        if (!status) return '❌ 无法获取服务器状态';
        
        return `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🖥️ 【服务器状态】
  服务器: ${status.serverName} (ID: ${status.serverId})
  运行时间: ${Math.floor(status.uptime / 3600)} 小时
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
👥 玩家: ${status.online}/${status.users} 在线
🏠 房间: ${status.rooms} 个
👾 NPC: ${status.npcs} 个
📋 命令: ${status.commands} 个
🎯 技能: ${status.skills} 个
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💾 内存: ${Math.round(status.memory.rss / 1024 / 1024)} MB
🟢 Node: ${status.nodeVersion}
🖥️ 系统: ${status.platform}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
    },

    log: function() {
        const limit = parseInt(this.args[0]) || 20;
        const logs = WORLD.getGMLogs && WORLD.getGMLogs(limit);
        if (!logs || logs.length === 0) return '📜 暂无GM日志';
        
        const result = ['━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', '📜 【GM操作日志】', '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'];
        logs.forEach((log, i) => {
            const time = new Date(log.time).toLocaleString();
            result.push(`  ${i+1}. [${time}] ${log.userName}: ${log.command}`);
        });
        result.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        return result.join('\n');
    },

    // ========== 房间管理 ==========
    
    addroom: function() {
        const path = this.args[0];
        const name = this.args.slice(1).join(' ');
        if (!path || !name) return '❌ 用法: addroom <路径> <房间名>';
        
        // 创建新房间
        const room = new ROOM();
        room.path = path;
        room.name = name;
        room.area = 'GM创建';
        room.exits = {};
        room.items = [];
        WORLD.ROOMS[path] = room;
        
        return `✅ 已创建房间: ${name} (${path})`;
    },

    delroom: function() {
        const path = this.args[0];
        if (!path) return '❌ 用法: delroom <房间路径>';
        
        const room = WORLD.ROOMS[path];
        if (!room) return `❌ 找不到房间: ${path}`;
        
        // 检查是否有玩家在房间
        if (room.items) {
            const players = room.items.filter(i => i.is_player);
            if (players.length > 0) {
                return `❌ 房间中有 ${players.length} 个玩家，不能删除`;
            }
        }
        
        delete WORLD.ROOMS[path];
        return `✅ 已删除房间: ${path}`;
    },

    clearmob: function() {
        const me = this.character;
        const room = me.environment;
        if (!room) return '❌ 你不在任何房间';
        
        const items = room.items || [];
        const npcs = items.filter(i => i.is_npc);
        let count = 0;
        for (let npc of npcs) {
            room.remove_item(npc);
            count++;
        }
        return `✅ 已清除 ${count} 个怪物/NPC`;
    },

    // ========== ========== ========== ========== ==========
    // ★★★ 新增：setprop 命令 - 修改后天属性 ★★★
    // ========== ========== ========== ========== ==========
    
    setprop: function() {
        const me = this.character;
        const propName = this.args[0];
        const value = parseInt(this.args[1]);
        if (!propName || isNaN(value)) return '❌ 用法: setprop <属性名> <数值>';
        
        // 所有支持的后天属性（来自 const.js 的 PROPERTIES）
        const validProps = [
            // ---- 基础属性加成 ----
            'str', 'con', 'dex', 'int', 'per', 'kar',
            
            // ---- 战斗属性 ----
            'gj', 'fy', 'mz', 'ds', 'zj', 'bj', 'gjsd',
            
            // ---- 百分比属性 ----
            'gj_per', 'fy_per', 'mz_per', 'ds_per', 'zj_per', 'bj_per',
            'hp_per', 'mp_per', 'gjsd_per',
            
            // ---- 高级战斗属性 ----
            'add_sh_per',      // 最终伤害
            'diff_fy_per',     // 忽视防御
            'add_bjsh_per',    // 暴击伤害
            'diff_sh_per',     // 伤害减免
            'diff_sh_per2',    // 伤害减免2
            'diff_bj',         // 暴击抵抗
            
            // ---- 时间属性 ----
            'releasetime',     // 释放时间
            'releasetime_per', // 释放时间百分比
            'distime',         // 冷却时间
            'distime_per',     // 冷却时间百分比
            'busy',            // 忙乱时间
            'busy_per',        // 忙乱时间百分比
            'diff_busy',       // 忽视忙乱
            'diff_busy_per',   // 忽视忙乱百分比
            
            // ---- 消耗属性 ----
            'expend_mp',       // 内力消耗
            'expend_mp_per',   // 内力消耗百分比
            
            // ---- 效率属性 ----
            'dazuo_per',       // 打坐效率
            'study_per',       // 学习效率
            'lianxi_per',      // 练习效率
            
            // ---- 抵抗属性 ----
            'diff_downside',     // 负面抵抗
            'diff_downside_per', // 负面抵抗百分比
            
            // ---- 其他 ----
            'recover_per',     // 疗伤效果
            'fenjie',          // 分解加成
            'dazuo',           // 打坐效率（旧版）
            'add_sh',          // 伤害增加
            'diff_fy_per2',    // 忽视防御2
            'no_fy',           // 无法防御
            'no_pfm'           // 禁止绝招
        ];
        
        if (!validProps.includes(propName)) {
            return `❌ 无效属性: ${propName}\n可用: ${validProps.join(', ')}`;
        }
        
        const oldValue = me.query_prop(propName);
        const change = value - oldValue;
        me.add_prop(propName, change);
        const newValue = me.query_prop(propName);
        
        // 重新计算属性
        me.recount && me.recount();
        me.notify_hp && me.notify_hp();
        
        // 如果是战斗属性，通知客户端更新
        if (['gj', 'fy', 'mz', 'ds', 'zj', 'bj', 'gjsd'].includes(propName)) {
            me.notify_hp && me.notify_hp();
        }
        
        // 如果是效率属性，刷新技能面板
        if (['study_per', 'lianxi_per', 'dazuo_per'].includes(propName)) {
            me.on_skillchanged && me.on_skillchanged();
        }
        
        return `✅ ${propName}: ${oldValue} → ${newValue} (变化: ${change})`;
    },

    // ========== showprop 命令 - 查看所有后天属性 ==========
    
    showprop: function() {
        const me = this.character;
        if (!me.prop || Object.keys(me.prop).length === 0) {
            return '📊 没有后天属性加成';
        }
        
        const propNames = {
            'str': '臂力加成', 'con': '根骨加成', 'dex': '身法加成', 'int': '悟性加成',
            'per': '容貌加成', 'kar': '福缘加成',
            'gj': '攻击', 'fy': '防御', 'mz': '命中', 'ds': '躲闪', 'zj': '招架', 'bj': '暴击', 'gjsd': '攻速',
            'add_sh_per': '最终伤害', 'diff_fy_per': '忽视防御', 'add_bjsh_per': '暴击伤害',
            'diff_sh_per': '伤害减免', 'diff_bj': '暴击抵抗',
            'releasetime': '释放时间减少', 'busy': '忙乱时间', 'diff_busy': '忽视忙乱',
            'distime': '冷却减少', 'expend_mp': '内力消耗减少',
            'diff_downside_per': '负面抵抗',
            'dazuo_per': '打坐效率', 'study_per': '学习效率', 'lianxi_per': '练习效率'
        };
        
        const result = ['━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', '📊 【后天属性加成】', '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'];
        for (let key in me.prop) {
            if (key === 'desc') continue;
            const name = propNames[key] || key;
            result.push(`  ${name}: ${me.prop[key]}`);
        }
        result.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        return result.join('\n');
    },

    // ========== 原有命令继续 ==========
    
    sync: function() {
        const me = this.character;
        me.syncClient && me.syncClient();
        return '✅ 已同步客户端';
    },

    refresh: function() {
        const me = this.character;
        me.recount && me.recount();
        me.notify_hp && me.notify_hp();
        me.long_name && (me.color_name = null);
        if (me.environment) {
            me.environment.item_changed && me.environment.item_changed(me, true);
        }
        return '✅ 状态已刷新';
    },

    kill: function() {
        const me = this.character;
        me.hp = 0;
        me.die && me.die(null);
        return '💀 你死了... (测试死亡)';
    },

    time: function() {
        const now = new Date();
        return `🕐 服务器时间: ${now.toLocaleString()}\n⏰ 时间戳: ${now.getTime()}`;
    }
};

/**
 * 获取GM命令帮助
 */
CHARACTER.prototype.getGMHelp = function(cmd) {
    if (cmd) {
        return `❌ 未知GM命令: ${cmd}\n输入 help 查看所有可用命令`;
    }
    return this.gmCommandHandlers.help.call({ character: this, args: [], WORLD: WORLD });
};

/**
 * 同步客户端（强制刷新）
 */
CHARACTER.prototype.syncClient = function() {
    if (!this.socket) return;
    
    // 同步血量/魔法
    this.notify_hp && this.notify_hp();
    
    // 同步位置
    if (this.environment) {
        this.environment.send_exits && this.environment.send_exits(this);
    }
    
    // 同步背包
    if (this.items) {
        for (let item of this.items) {
            this.items_changed && this.items_changed(item);
        }
    }
    
    // 同步技能
    this.on_skillchanged && this.on_skillchanged();
    
    // 同步称号
    this.long_name && (this.color_name = null);
    if (this.environment) {
        this.environment.item_changed && this.environment.item_changed(this, true);
    }
};