# 后端备份与容灾

后端（`app.huaci.app`、`admin.huaci.app`）与 PostgreSQL 18 同机运行，源站在 Cloudflare 代理后面。本文说明备份怎么做、出事时怎么恢复，以及从 AWS（EC2 + RDS）迁到 VPS 的切换步骤。脚本都在 [`apps/backend/deploy/`](../../apps/backend/deploy/)，由 `setup-server.sh` 装到服务器。

## 目标

| 指标 | 目标 | 依据 |
| --- | --- | --- |
| 最多丢失的数据（RPO） | 15 分钟 | `huaci-backup.timer` 每 15 分钟一次 |
| 整机故障恢复（RTO） | 30–60 分钟 | `restore-server.sh` 在任意 Debian 13 上重建；Cloudflare 代理的 DNS 改动立即生效 |
| 误删误改恢复 | 15 分钟 | `huaci-restore` 从 R2 取出事前最近的一份 |

15 分钟内丢失的 Creem 付款事件可以在 Creem 后台重发 Webhook 补回，事件处理是幂等的。

## 备份

### 存放位置

备份只存在 Cloudflare R2（免费额度 10 GB，下载流量免费），bucket `huaci-backup`：

- 内容：每 15 分钟、每天、每月的数据库，以及配置包。
- 防删除：Bucket Lock 规则让全部对象 30 天内不能删除或覆盖。

对象布局：

```text
db/15m/2026-11-26/huaci-20261126T081500Z.dump.age
db/daily/huaci-2026-11-26.dump.age        每个 UTC 日第一次备份
db/monthly/huaci-2026-11.dump.age         每个 UTC 月第一次备份
config/huaci-config-20261126T081500Z.tar.gz.age
```

脚本只上传、不删除。在 R2 控制台为 bucket 设置生命周期规则来删除过期对象：

| 前缀 | 删除时间 |
| --- | --- |
| `db/15m/` | 30 天（锁定期内删不掉，不能更短） |
| `db/daily/` | 90 天 |
| `config/` | 90 天 |
| `db/monthly/` | 400 天 |

数据库导出约 1–2 MB。按上表，R2 存约 3000 份 15 分钟备份，合计远低于 10 GB；数据库超过 30 MB 时重新估算。

### 加密

- 每份备份上传前用 [age](https://age-encryption.org/) 加密，接收方有两个：
  - **离线钥匙**：运维者在自己电脑上生成，私钥只存在密码管理器里，公钥填进 `backup.env` 的 `AGE_RECIPIENTS`。整机重建要用它。
  - **演练钥匙**：`/etc/huaci/backup-drill.key`，由 `setup-server.sh` 生成，只留在服务器上，供每周演练与日常恢复解密。
- 对象存储令牌泄露时，别人拿到的只是密文。服务器被入侵时，攻击者本来就能读线上库；锁定规则保证已有备份 30 天内删不掉、改不了。
- 配置包里有 `/etc/huaci`（含全部密钥）、`/etc/caddy`（含证书）、部署公钥与当前代码（不含 `node_modules`），每天一份，发布新版本后的下一次备份再补一份。

生成离线钥匙（运维者电脑）：

```sh
brew install age
age-keygen -o huaci-backup.key   # 屏幕上的 Public key 填进 AGE_RECIPIENTS
# 把 huaci-backup.key 的全部内容存进密码管理器，然后删除这个文件
```

### 监控

| 检查 | 方式 | 告警 |
| --- | --- | --- |
| 备份在跑 | 每次成功请求 `HC_BACKUP_URL`（healthchecks.io，周期 15 分钟、宽限 15 分钟） | 30 分钟没收到 |
| 备份能恢复 | 每周演练成功请求 `HC_DRILL_URL`（周期 7 天、宽限 1 天） | 8 天没收到 |
| 服务在线 | UptimeRobot 每 5 分钟请求 `https://app.huaci.app/healthz` | 连续失败 |

每周演练（`huaci-restore-drill`）从 R2 取最新的 15 分钟备份与最新的每日备份，分别解密并恢复到临时库 `huaci_drill`，检查迁移版本与线上一致、用户数正常、R2 最新备份不超过 1 小时，然后删除临时库。

手动演练用 `sudo huaci-restore-drill`；只演练某一份用 `sudo huaci-restore-drill r2:latest`。启用备份当天的第一份每日备份如果早于导入数据，会被判为空库而演练失败，第二天自动恢复正常。

每季度在自己电脑上用离线钥匙解密一份 R2 的备份（`age -d -i <私钥> …`），确认离线钥匙还能用。

### 只用一家存储的风险

域名、代理与备份都在同一个 Cloudflare 账号里。账号被盗或被停用时，备份也会一起拿不到。缓解措施：

- Cloudflare 账号开启两步验证；R2 令牌只限这个 bucket 的对象读写，不能改 bucket 设置。
- 服务器上另有 `release.sh` 的迁移前备份（`/srv/huaci/backups/`，5 份）。
- 可选：每月把 `db/monthly/` 的最新一份下载到自己电脑（已加密，可以直接存放）。

### 首次启用

1. 在 Cloudflare 开通 R2，建 bucket `huaci-backup`，添加 30 天的 Bucket Lock 规则与上表的生命周期规则。
2. 建 R2 API 令牌：权限选 Object Read & Write，只限这个 bucket；记下 Access Key ID、Secret Access Key 与 S3 Endpoint。
3. 在 healthchecks.io 建「备份」「演练」两个检查。
4. 在服务器上编辑 `/etc/huaci/backup.env`（模板 [`backup.env.example`](../../apps/backend/deploy/backup.env.example)），然后：

```sh
sudo huaci-backup                      # 手动跑一次，确认 R2 有文件、心跳到达
sudo huaci-restore r2:latest           # 恢复到临时库 huaci_restore，看摘要
sudo -u postgres dropdb huaci_restore
sudo systemctl enable --now huaci-backup.timer huaci-restore-drill.timer
```

## 恢复

### 发布出问题

`release.sh` 在迁移前把数据库导出到 `/srv/huaci/backups/pre-<版本>-<时间>.dump`。新版本出问题时：

```sh
sudo huaci-restore --target huaci --force /srv/huaci/backups/pre-<版本>-<时间>.dump
sudo -u huaci ln -sfn /srv/huaci/releases/<上一版本> /srv/huaci/current
sudo systemctl restart huaci-backend
```

迁移只改了表结构、没有不兼容时，只切回代码即可，不必恢复数据库。

### 误删误改数据

```sh
sudo huaci-restore --list db/15m/2026-11-26/         # 列出当天的 15 分钟备份
sudo huaci-restore r2:db/15m/2026-11-26/huaci-20261126T081500Z.dump.age   # 先恢复到临时库 huaci_restore 核对
sudo huaci-restore --target huaci --force r2:db/15m/2026-11-26/huaci-20261126T081500Z.dump.age
```

只需要找回少量数据时，从临时库 `huaci_restore` 查出来再写回线上库，不必整库覆盖。

### 整机故障或服务商不可用

1. 开一台 Debian 13（任意服务商）。
2. 从密码管理器取出离线私钥与 `backup.env` 内容，各写成一个 600 文件，连同仓库的 `apps/backend/deploy/` 目录传到新机。
3. 运行：

```sh
sudo bash deploy/restore-server.sh --identity /root/huaci-backup.key --backup-env /root/backup.env
```

4. 按脚本最后的提示：启用防火墙；在 Cloudflare 把 `app`、`admin` 的 A 记录改到新机；更新 GitHub 的 `DEPLOY_HOST`、`DEPLOY_PORT`、`DEPLOY_KNOWN_HOSTS`；删除两个临时文件。
5. 如果配置包里的代码比数据库的迁移版本旧，`/healthz` 会不通：在 GitHub Actions 手动运行一次 Deploy backend。

## 从 AWS 迁到 VPS

旧环境：EC2 新加坡 + RDS（PostgreSQL 18）。新环境：东京 VPS，SSH 端口 59594，同机还有 hysteria（UDP 443）和演示站点（TCP 18080）。

### 准备（用户无感）

1. 旧机安装 `postgresql-client-18`（PGDG 源）。旧机自带的 `pg_dump` 是 17，导不出 18 的 RDS，`release.sh` 的迁移前备份也会失败；**在推送包含本次部署改动的提交之前完成**。
2. 新机运行 `setup-server.sh`，部署公钥沿用旧机 `huaci` 用户 `authorized_keys` 里的那把。
3. `/etc/huaci/firewall.env` 写 `EXTRA_TCP=18080`、`EXTRA_UDP=443`，运行 `huaci-firewall apply`，另开 SSH 确认能登录后 `huaci-firewall confirm`。
4. 把旧机的 `/etc/huaci/backend.env` 拷到新机，`DATABASE_URL` 改成 `postgres://huaci@/huaci?host=/var/run/postgresql`，`NODE_EXTRA_CA_CERTS` 留空。
5. 按上文「首次启用」配好备份。
6. 演练：旧机 `pg_dump --format=custom` 导出 RDS，经运维者电脑传到新机，`huaci-restore --target huaci --force`；把当前版本的代码放到 `/srv/huaci/releases/<sha>` 并运行 `release.sh`；用 `curl --resolve app.huaci.app:443:185.220.197.197 https://app.huaci.app/healthz`（Let's Encrypt 证书还没签下来时加 `-k`）检查。两边各跑一次 `db-summary.sql` 对比。

### 切换（停服约 10 分钟）

1. 旧机 `sudo systemctl stop huaci-backend`。
2. 旧机导出 RDS → 传到新机 → `huaci-restore --target huaci --force <文件>`；两边的 `db-summary.sql` 必须逐行一致。
3. 新机 `systemctl start huaci-backend`，`/healthz` 正常。
4. Cloudflare：`app`、`admin` 的 A 记录改为 `185.220.197.197`（保持橙色云）。
5. 验证网页登录、扩展登录、Google 登录、文字与图片托管翻译、管理端二步验证；在 Creem 后台重发一个测试 Webhook。
6. GitHub Secrets：`DEPLOY_HOST`、`DEPLOY_PORT=59594`、`DEPLOY_KNOWN_HOSTS`（`ssh-keyscan -t ed25519 -p 59594 185.220.197.197`）。
7. 新机手动运行一次 `huaci-backup`，确认心跳到达。

回退（切换后 1 小时内）：A 记录改回旧 IP，旧机 `systemctl start huaci-backend`。回退前先在新机导出切换后产生的数据，之后补回 RDS。

### 收尾

- 切换后第 7 天：第一次自动演练通过后，对 RDS 做最终导出，加密后永久存到 R2 的 `archive/`（不设生命周期），再删除 RDS。
- 切换后第 14 天：终止旧 EC2。
