// setgm.js - 设置GM权限
const Database = require('better-sqlite3');

// 查找数据库文件
const fs = require('fs');
let dbPath = null;

// 尝试常见的数据库路径
const possiblePaths = [
    './database.db',
    './data/database.db',
    './data/data.db',
    './data.db'
];

for (let path of possiblePaths) {
    if (fs.existsSync(path)) {
        dbPath = path;
        break;
    }
}

if (!dbPath) {
    console.log('❌ 找不到数据库文件！');
    console.log('请检查以下路径:');
    possiblePaths.forEach(p => console.log('  - ' + p));
    process.exit(1);
}

console.log('✅ 找到数据库:', dbPath);

// 连接数据库
const db = new Database(dbPath);

// 查看所有玩家
console.log('\n📋 当前玩家列表:');
const players = db.prepare('SELECT id, name, level, user_level FROM players').all();
players.forEach(p => {
    console.log(`  ${p.id} | ${p.name} | level:${p.level} | user_level:${p.user_level}`);
});

// 设置陆渊为GM
const result = db.prepare("UPDATE players SET level=9, user_level=9 WHERE name='陆渊'").run();

if (result.changes > 0) {
    console.log('\n✅ 陆渊已设置为GM！');
} else {
    console.log('\n❌ 未找到名为"陆渊"的玩家');
}

// 验证
const verify = db.prepare("SELECT id, name, level, user_level FROM players WHERE name='陆渊'").get();
if (verify) {
    console.log(`\n✅ 验证: ${verify.name} | level:${verify.level} | user_level:${verify.user_level}`);
}

console.log('\n请重新登录游戏！');
db.close();