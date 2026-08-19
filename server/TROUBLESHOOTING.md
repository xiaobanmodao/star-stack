# StarStack 后端故障排查

生产部署和更新流程请先查看项目根目录的 [`DEPLOYMENT.md`](../DEPLOYMENT.md)。本文件只记录后端常见故障的快速检查方法。

## 1. 后端离线或页面 API 失败

```bash
cd /opt/star-stack
pm2 status
pm2 logs star-stack-api --lines 100 --nostream
curl -i http://127.0.0.1:5174/api/health
```

如果服务离线：

```bash
pm2 restart star-stack-api
pm2 status
```

如果本机健康检查正常、域名访问失败：

```bash
nginx -t
systemctl status nginx --no-pager
systemctl reload nginx
curl -i https://xingzhan.cc/api/health
```

## 2. 数据库表或字段缺失

不要删除数据库文件。先停止后端并备份，再运行幂等迁移：

```bash
cd /opt/star-stack
pm2 stop star-stack-api
./backup.sh
node server/migrate.js
node server/diagnose.js
pm2 restart star-stack-api
```

`migrate.js` 会补齐缺失的表、字段和索引，并保留现有用户数据。只有在迁移工具本身报错时，才进一步查看日志和数据库文件权限。

## 3. 判题失败

确认运行环境和后端日志：

```bash
g++ --version
python3 --version
java -version
pm2 logs star-stack-api --lines 100 --nostream
```

临时编译文件默认位于 Linux 的 `/tmp/starstack-oj`。不要在生产环境开放编译器相关目录的静态访问。

## 4. 数据库文件检查

```bash
cd /opt/star-stack
ls -lh server/data/starstack.sqlite
ls -lh server/data/starstack.sqlite-wal server/data/starstack.sqlite-shm 2>/dev/null || true
node server/diagnose.js
```

数据库文件路径固定为 `server/data/starstack.sqlite`。不要使用旧文档中的 `oj.sqlite`、`db.json` 或删除数据库重建的方式处理结构问题。

## 5. PM2 配置问题

项目使用 ES Module，PM2 配置文件是 `ecosystem.config.cjs`：

```bash
cd /opt/star-stack
pm2 start ecosystem.config.cjs
pm2 save
```
