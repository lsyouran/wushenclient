// world/cmd/add_prop.js
this.inherits(COMMAND);
this.command = "add_prop";
this.allow_level = 9;
this.allow_die = true;
this.allow_faint = true;
this.allow_state = true;
this.allow_busy = true;

this.enter = function(me, propName, value) {
    if (!propName || value === undefined) {
        return me.send('用法: add_prop <属性名> <数值> (正数增加，负数减少)');
    }
    
    const val = parseInt(value);
    if (isNaN(val)) return me.send('数值必须是数字');
    
    const validProps = [
        'str', 'con', 'dex', 'int', 'per', 'kar',
        'gj', 'fy', 'mz', 'ds', 'zj', 'bj', 'gjsd',
        'gj_per', 'fy_per', 'mz_per', 'ds_per', 'zj_per', 'bj_per',
        'hp_per', 'mp_per', 'gjsd_per',
        'add_sh_per', 'diff_fy_per', 'add_bjsh_per', 'diff_sh_per', 'diff_sh_per2',
        'diff_bj', 'releasetime', 'releasetime_per', 'distime', 'distime_per',
        'busy', 'busy_per', 'diff_busy', 'diff_busy_per',
        'expend_mp', 'expend_mp_per',
        'dazuo_per', 'study_per', 'lianxi_per',
        'diff_downside', 'diff_downside_per',
        'recover_per', 'fenjie', 'dazuo', 'add_sh',
        'diff_fy_per2', 'no_fy', 'no_pfm'
    ];
    
    if (!validProps.includes(propName)) {
        return me.send(`不支持的属性: ${propName}\n可用: ${validProps.join(', ')}`);
    }
    
    const oldValue = me.query_prop(propName);
    me.add_prop(propName, val);
    const newValue = me.query_prop(propName);
    me.recount();
    me.notify_hp();
    
    return me.send(`✅ ${propName}: ${oldValue} → ${newValue} (变化: ${val})`);
};