# 排班系统（Scheduling System）

一个"管理员发布排班任务 + 用户凭链接和密码填写意愿 + 系统自动匹配排班"的完整系统。
**只有管理员登录入口**，普通用户不需要注册账号，凭管理员发放的专属链接与填写密码即可填写。

- 技术栈：Next.js 15（App Router） + TypeScript + Prisma + SQLite/PostgreSQL + Tailwind CSS
- 本地默认 SQLite，云服务器可通过环境变量切换到 PostgreSQL
- 提供 Dockerfile / docker-compose.yml，本地一键启动
- 提供 Nginx 反向代理、HTTPS、数据库备份与恢复说明
- 代码仓库：<https://github.com/uniniconn/SchSys>
- 发布包（含 Docker 构建上下文、源码快照）：<https://github.com/uniniconn/SchSys/releases>

---

## 一、功能一览

### 管理员端

| 页面 | 路径 | 说明 |
| --- | --- | --- |
| 管理员登录 | `/admin/login` | 唯一登录入口；无注册、无普通用户入口 |
| 任务列表 | `/admin/dashboard` | 任务状态、填写人数、名单人数、进入详情/结果 |
| 新建任务 | `/admin/tasks/new` | **快速创建**（名称+日期+模板）或 **5 步向导**：模板、日历、班次与区域、需求预览、确认；自动保存草稿 |
| 节假日日历 | `/admin/settings/calendar` | 从公共接口同步节假日/调休、缓存、自定义覆盖、CSV 导入导出 |
| 任务详情 | `/admin/tasks/[id]` | 填写链接与密码、填写情况（含工作量偏好）、名单核对、理由汇总、截止确认、自动匹配、操作日志、下一步引导 |
| 管理员账号管理 | `/admin/settings/admins` | 新增、启用/禁用、重置密码 |
| 修改密码 | `/admin/settings/password` | 管理员本人修改密码 |
| 排班结果 | `/admin/tasks/[id]/result` | 按区域展示的日历排班表、姓名排班表、缺口报告、**手动调整人员（按区域增删）**、导出（CSV/XLSX）、打印 |

### 填写端（无需账号）

| 页面 | 路径 | 说明 |
| --- | --- | --- |
| 密码校验 | `/fill/[uuid]` | 输入管理员提供的填写密码 |
| 可视化日历填写 | `/fill/[uuid]/form` | 日期 × 班次 表格，每格三选一；支持批量（整表/整行/整列/日期区间）与工作量偏好 |
| 提交成功 | `/fill/[uuid]/success` | 显示本次填写统计，确认前可再次修改 |

### 创建流程（v1.3 简化）

**快速创建（默认）**：只填「任务名称 + 日期范围 + 模板」3 项，其余用推荐值；页面实时显示“共 X 天 × Y 个班次 × Z 个区域，预计 N 人次”，一键创建。

**详细配置（5 步向导）**：基本信息 → 日历 → 班次与区域 → 需求预览（按日期微调）→ 确认创建。
每步都有说明与“用推荐值”式默认；复杂项折叠；创建前统一校验并定位；向导内容自动保存到浏览器草稿，刷新/误关可恢复。

内置模板：晚自习（多区域，3 个区域/同组兼顾）、白班值班、周末值班、空白任务。
创建成功后任务详情顶部显示“下一步”（发布 → 复制链接密码 → 等待填写 → 截止确认 → 自动匹配 → 查看结果），仪表盘提供新手引导与“一键示例任务”。

### 节假日日历

- 数据源按顺序回退：`holiday-cn`（GitHub，国务院公告整理）→ `timor.tech` → `jiejiariapi`，均无需 Key。
- 本地缓存 30 天（`calendar_cache`），抓取失败时继续用缓存并标注“缓存”；无缓存则提示手动录入，**不阻断创建**。
- 自定义覆盖（`calendar_overrides`）优先级最高，可在 `/admin/settings/calendar` 增删、CSV 导入导出。
- 创建任务时写入 `Task.calendarConfig` 快照（年份、来源、抓取时间、条目），历史任务不受后续接口变化影响。
- 相关环境变量：`CALENDAR_HTTP_TIMEOUT_MS`（默认 5000）。

### 关键业务规则

1. **三选一强校验**：任务范围内每个"日期 + 班次"都必须选择"首选 / 次选 / 无法"；选"无法"必须填理由，否则不允许提交。
2. **同名可改**：管理员"截止并确认"前，同一姓名再次进入可覆盖修改；确认后锁定，用户不可再改。
3. **绝不安排"无法"**：匹配算法只会安排"首选"或"次选"用户。
4. **同日单班**：默认同一人同一天最多一个班次；仅当管理员开启"允许同日多班"且两个班次时间完全不重叠时才可同日多班。
5. **缺口不硬凑**：首选不足用次选用，仍不足则输出缺口报告（日期、班次、需求人数、已满足人数、缺口人数、可能原因），**不输出最终排班结果**。
6. **结果可复现**：固定随机种子 + 历史排班次数少者优先 + 提交时间早者优先，可按种子"重新匹配"。
7. **匹配后可人工微调**：自动匹配完成后，管理员可在结果页逐个"日期 + 班次 + 区域"增删人员、填写调整说明；
   手动补人后缺口报告按实际结果实时重算；重新匹配会覆盖手动调整（会二次确认并记录日志）。
8. **区域化多人值班**：一个班次可拆多个区域，每个区域独立人数；同一「距离组」内一个人可兼顾多个区域（上限可配），跨组同一时段不允许兼顾；
   填写端不展示区域，只显示"本时段需 X 人"。
9. **工作量偏好**：填写人可选“希望多排 / 正常 / 希望少排”，并可填“最多可排次数”；匹配时多排优先、少排靠后，上限为硬约束，手动调整超限只提示。
10. **日期规则**：班次支持“仅工作日 / 晚自习（次日工作日）/ 每天 / 仅周末 / 自定义星期 + 强制纳入/排除日期”；
   晚自习规则会保留周日晚与节假日最后一晚（只要次日是工作日），自动跳过节前夜。
11. **节假日日历**：默认从 holiday-cn / timor.tech / jiejiari 依次抓取，本地缓存 30 天，自定义覆盖优先级最高；
   创建任务时写入任务快照，历史任务不受后续接口变化影响；接口不可用时可用缓存或手动录入，不阻断创建。
12. **缺口不硬凑**（区域版）：缺口按区域报告；同组兼顾人数按“每人最多兼顾数”折算，不会把无法兼顾的区域硬塞给同一人。

### 手动调整排班（自动匹配之后）

结果页 `/admin/tasks/[id]/result` 的「手动调整排班」面板支持：

| 操作 | 说明 |
| --- | --- |
| 添加人员 | 按意愿排序（首选 → 次选 → 无选择 → 无法排班）列出候选人，可附「调整说明」 |
| 移除人员 | 自动匹配或手动添加的记录都可以移除（✕） |
| 修改说明 | 编辑某条排班的调整说明（例如“原定人员请假”） |
| 清空手动记录 | 一次删除全部 `manual=true` 的记录，保留自动匹配结果 |

约束与提示：

- **硬性拒绝**：绝不会把标记为“无法排班”的人员安排进去（返回 409 并说明理由）。
- **重复拒绝**：同一人不能在同一日期+班次+区域重复出现。
- **区域约束**：同一时段跨区域组不允许兼顾；同组兼顾超过 `maxAreasPerPerson` 拒绝；区域独立分人模式下同一时段只能一个区域。
- **提示但仍可保存**：超员（该区域已排人数 ≥ 需求）、同日已有其他班次、达到工作量上限会给出 warning，由管理员判断。
- 来源标记：手动加入但原本有首选/次选意愿时显示为 `手动·首选` / `手动·次选`，否则为 `手动`；
  导出文件的“来源”“是否手动调整”“调整说明”三列会完整体现。
- 所有手动调整都写入 `AuditLog`（`task.assignment.add / remove / note / clear_manual`）。
- 也可通过 API 自动化：`POST /api/admin/tasks/{id}/assignments`（body 需含 `date/shiftId/areaId/submissionId`）、`DELETE /api/admin/tasks/{id}/assignments?assignmentId=...`、`GET /api/admin/tasks/{id}/candidates?date=&shiftId=&areaId=`。

---

## 二、本地一键运行

### 方式 0：桌面一键启动（Windows，推荐日常使用）

项目自带启动器，把「准备环境 → 装依赖 → 建表 → 按需构建 → 启动服务 → 打开浏览器」全部串起来，采用**生产构建 + `next start`**，与线上运行方式一致。

**桌面文件**（执行一次安装脚本即可生成）：

| 桌面项 | 作用 |
| --- | --- |
| `启动排班系统.cmd` | 双击启动：会在控制台里显示进度、启动完成后自动打开浏览器；**关闭窗口即停止服务** |
| `启动排班系统(后台).lnk` | 双击启动：无窗口、后台常驻，日志写入 `.run\logs\`；需用「停止排班系统」关闭 |
| `停止排班系统.lnk` | 停止服务 |

重新生成桌面项：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install-desktop-shortcuts.ps1
# 可选：-StartNow 立即启动并打开浏览器；-NoDesktopCopy 只建快捷方式
```

**项目内等价命令**：

```bat
Start-Scheduling-System.cmd          :: 前台启动（日志实时显示，Ctrl+C 停止）
Start-Scheduling-Silent.cmd          :: 后台静默启动
Stop-Scheduling-System.cmd           :: 停止服务
Scheduling-System-Status.cmd         :: 查看 PID / 端口 / 健康检查
```

```bash
npm run one-click                     # 等价于 node scripts/launcher.mjs start
npm run one-click:background          # 后台启动
npm run stop                          # 停止
npm run status                        # 状态
node scripts/launcher.mjs start --port 3100 --no-browser --force-build
```

启动器行为说明：

- **首次运行**：自动生成 `.env`（复制 `.env.example`）、安装依赖、`prisma generate` + `prisma migrate deploy`、`next build`。
- **之后运行**：源码没变就跳过构建（几秒内启动）；检测到源码变更、或 `.next` 产物不完整时自动重新构建。
- **自愈能力**：先停掉上一次由启动器拉起的服务（Windows 上运行中的服务会锁定 Prisma 引擎 DLL），并清理 `.node.tmp*` 残留；端口被别的程序占用时给出明确提示。
- **日志**：`.run\logs\launcher.log`（启动器步骤）、`.run\logs\server.out.log`（服务输出）、`.run\logs\server.err.log`。
- **Linux / WSL**：使用 `./scripts/start-linux.sh`（`--background` 可后台常驻），停止用 `./scripts/stop-linux.sh`。

> 说明：本项目当前部署在 Windows 上运行。若要在 WSL 里跑，需要先 `wsl --install -d Ubuntu`（本机目前只启用了 WSL 功能、**尚未安装任何发行版**），然后在 WSL 内重新 `npm install`（Windows 的 `node_modules` 不能跨系统复用），再执行 `./scripts/start-linux.sh`。

### 方式 A：npm 手动运行（首次体验 / 开发）

需要 Node.js 20.11 或以上（推荐 22 LTS）。

```bash
# 1. 安装依赖
npm install

# 2. 准备环境变量（首次必须做）
cp .env.example .env          # Windows: copy .env.example .env
# 至少修改 SESSION_SECRET（随机长字符串）与 INITIAL_ADMIN_PASSWORD
# 生成随机密钥：openssl rand -base64 48  或  node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"

# 3. 生成 Prisma Client 并创建数据库（SQLite，默认文件 ./prisma/data/app.db）
npm run setup

# 4. 启动开发服务器
npm run dev
# 打开 http://localhost:3000/admin/login ，用 INITIAL_ADMIN_USERNAME / INITIAL_ADMIN_PASSWORD 登录
```

生产模式本地运行：

```bash
npm run build      # 等价于 prisma generate && next build
npm run start      # http://localhost:3000
```

> 提示：`.env` 中的 `NODE_ENV=development` 只影响手动 `npm run dev`；
> 启动器在构建和 `next start` 时会强制 `NODE_ENV=production`，否则构建阶段会因预渲染报错而失败。

> 首次启动（任意页面被访问时）会自动创建初始管理员，日志中会打印：
> `[init] 已创建初始管理员账号：admin（请登录后立即修改密码）`

可选：生成一份演示数据（一个已发布任务 + 5 人填写）：

```bash
SEED_DEMO=1 npm run db:seed     # Windows PowerShell: $env:SEED_DEMO=1; npm run db:seed
```

### 方式 B：Docker Compose

```bash
cp .env.example .env       # 修改 SESSION_SECRET / INITIAL_ADMIN_* / BASE_URL
docker compose up -d --build
docker compose logs -f app
# 打开 http://localhost:3000/admin/login
```

- 默认使用 SQLite，数据库文件保存在 Docker 命名卷 `app-data`（容器重建不丢数据）。
- 容器启动时会自动执行 `prisma migrate deploy` 建表。
- 健康检查：`GET /api/health`。

### 方式 C：打包 Docker 镜像（离线分发给云服务器）

```powershell
# Windows
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\package-docker.ps1
powershell ... -File scripts\package-docker.ps1 -Pg            # PostgreSQL 版本
powershell ... -File scripts\package-docker.ps1 -ContextOnly   # 只生成构建上下文（无 Docker 时）
```

```bash
# Linux / macOS / WSL
./scripts/package-docker.sh
./scripts/package-docker.sh --pg
./scripts/package-docker.sh --context-only
```

产物（`dist/`）：

| 文件 | 说明 |
| --- | --- |
| `scheduling-system-<版本>-<provider>.tar` | `docker save` 导出的镜像，云服务器 `docker load -i` 即可 |
| `…tar.sha256` | 镜像校验和 |
| `scheduling-system-docker-context-<版本>.tar.gz` | 完整构建上下文（不含依赖/密钥/数据库），可拷到任意有 Docker 的机器 `docker build` |
| `…manifest.json` | 上下文文件清单与校验和 |

> 已随 GitHub Release 发布可直接下载的构建包（v1.1.0 为旧版本；v1.3.0 构建包可用下述脚本本地生成，或按发布页最新 Release 下载）：
> <https://github.com/uniniconn/SchSys/releases>

服务器上加载并运行（把 `<版本>` 换成实际版本号）：

```bash
docker load -i scheduling-system-<版本>-sqlite.tar
docker run -d --name scheduling -p 3000:3000 \
  -e SESSION_SECRET="换成随机长字符串" \
  -e INITIAL_ADMIN_USERNAME=admin \
  -e INITIAL_ADMIN_PASSWORD="换成强密码" \
  -e BASE_URL="https://your-domain.com" \
  -v scheduling-data:/app/prisma/data \
  scheduling-system:<版本>
```

没有 Docker 时也可先做静态校验（检查 Dockerfile 指令、COPY 来源、启动路径、`.dockerignore` 是否排除密钥）：

```bash
node scripts/package-docker-context.mjs   # 生成 dist/docker-context
node scripts/verify-dockerfile.mjs        # 静态校验，输出 PASS/FAIL 报告
```

> 注意：本项目当前开发机的 WSL2 因未启用虚拟化（`wsl --status` 报 "WSL2 无法启动，因为此计算机上未启用虚拟化"）
> 而无法启动 Docker 引擎，因此**镜像构建需在已启用虚拟化/安装 Docker 的机器上执行**；
> 本仓库已提供构建上下文压缩包与一键打包脚本。

### 方式 D：上传到 GitHub

仓库已初始化并完成首次提交（`.gitignore` 已排除 `.env`、数据库、`node_modules`、构建产物、运行日志等）。
若要把源码推到自己的 GitHub 仓库：

```bash
# 1) 在 GitHub 新建空仓库（不要勾选 README），拿到地址，例如：
#    https://github.com/<你的账号>/scheduling-system.git

# 2) 关联远程并推送（首次会要求登录：用户名 + Personal Access Token）
git remote add origin https://github.com/<你的账号>/scheduling-system.git
git push -u origin main
```

> 也可以用 SSH：`git remote add origin git@github.com:<账号>/scheduling-system.git`。
> 若使用本机未安装 Git，项目内提供了便携版：`.tools/mingit/cmd/git.exe`（仅本机辅助，已被 gitignore 排除）。

---

## 三、环境变量（`.env`）

| 变量 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- |
| `DATABASE_PROVIDER` | 是 | `sqlite` | `sqlite` 或 `postgresql`（Docker 构建参数；docker-compose 会读取） |
| `DATABASE_URL` | 是 | `file:./data/app.db` | SQLite 文件路径或 PostgreSQL 连接串 |
| `SESSION_SECRET` | 是 | — | 会话/通行凭证签名密钥，**生产环境必须替换**（≥16 位随机串） |
| `SESSION_TTL_HOURS` | 否 | `12` | 管理员会话有效期 |
| `FILL_SESSION_TTL_HOURS` | 否 | `12` | 填写端通行凭证有效期 |
| `INITIAL_ADMIN_USERNAME` | 否 | `admin` | 初始管理员账号（仅首次启动创建） |
| `INITIAL_ADMIN_PASSWORD` | 否 | `Admin@12345` | 初始管理员密码，**务必修改** |
| `INITIAL_ADMIN_DISPLAY_NAME` | 否 | `系统管理员` | 显示名称 |
| `BASE_URL` | 否 | `http://localhost:3000` | 站点根地址，用于生成填写链接 |
| `COOKIE_SECURE` | 否 | `false` | HTTPS 部署时设为 `true`（生产环境自动为 true） |
| `FILL_RATE_LIMIT_MAX` / `FILL_RATE_LIMIT_WINDOW` | 否 | `30` / `60` | 填写端写接口限流（次数 / 秒） |
| `FILL_PASSWORD_MAX_ATTEMPTS` / `FILL_PASSWORD_WINDOW` | 否 | `10` / `300` | 填写密码尝试限流 |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | 否 | — | 仅 docker-compose 的 Postgres 容器使用 |

---

## 四、数据库切换（SQLite ⇄ PostgreSQL）

Prisma 不允许 `provider` 使用 `env()`，因此 provider 写在 `prisma/schema.prisma` 中，用脚本一键切换。

**切换到 PostgreSQL（云服务器）：**

```bash
# 1. 切换 provider 与迁移目录（会同步 prisma/migrations）
npm run db:switch:postgres

# 2. 修改 .env
#    DATABASE_PROVIDER="postgresql"
#    DATABASE_URL="postgresql://sched:密码@127.0.0.1:5432/scheduling?schema=public"

# 3. 生成客户端并建表
npm run setup      # prisma generate && prisma migrate deploy
```

**切回 SQLite（本地）：**

```bash
npm run db:switch:sqlite
# .env: DATABASE_PROVIDER="sqlite"  DATABASE_URL="file:./data/app.db"
npm run setup
```

迁移文件存放位置（切换脚本会自动同步到 `prisma/migrations`）：

- `prisma/migrations-sqlite/` —— SQLite 迁移
- `prisma/migrations-postgresql/` —— PostgreSQL 迁移

> 开发阶段改了 schema 后，请用 `npx prisma migrate dev --name xxx` 生成迁移，
> 并把新迁移同步回对应的长期目录（切换脚本会在下次切换时自动归档回去）。

---

## 五、云服务器部署

### 5.1 服务器准备（以 Ubuntu 22.04 为例）

```bash
sudo apt update && sudo apt install -y nginx postgresql postgresql-contrib git curl
# 安装 Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
```

### 5.2 创建数据库（PostgreSQL）

```bash
sudo -u postgres psql
CREATE DATABASE scheduling;
CREATE USER sched WITH ENCRYPTED PASSWORD '换成强密码';
GRANT ALL PRIVILEGES ON DATABASE scheduling TO sched;
\c scheduling
GRANT ALL ON SCHEMA public TO sched;
\q
```

### 5.3 部署应用

```bash
sudo mkdir -p /opt/scheduling && sudo chown $USER /opt/scheduling
git clone <你的仓库地址> /opt/scheduling
cd /opt/scheduling
npm ci --ignore-scripts          # 或 npm install
cp .env.example .env
nano .env                        # 设置 DATABASE_PROVIDER/DATABASE_URL/SESSION_SECRET/BASE_URL/COOKIE_SECURE=true
npm run db:switch:postgres
npm run setup                    # prisma generate + migrate deploy
npm run build
npm run start                    # 先用前台方式验证：http://127.0.0.1:3000/admin/login
```

### 5.4 用 systemd 常驻

```bash
sudo cp deploy/scheduling.service.example /etc/systemd/system/scheduling.service
sudo useradd -r -s /usr/sbin/nologin scheduling
sudo chown -R scheduling:scheduling /opt/scheduling
sudo nano /etc/systemd/system/scheduling.service   # 按需修改路径/用户
sudo systemctl daemon-reload
sudo systemctl enable --now scheduling
sudo systemctl status scheduling
```

### 5.5 Docker 方式部署

```bash
# Postgres 容器 + 应用容器（应用会自动使用 postgresql provider）
docker compose --profile postgres up -d --build
```

在 `.env` 中设置：

```env
DATABASE_PROVIDER=postgresql
DATABASE_URL=postgresql://sched:换成强密码@db:5432/scheduling?schema=public
POSTGRES_USER=sched
POSTGRES_PASSWORD=换成强密码
POSTGRES_DB=scheduling
BASE_URL=https://your-domain.com
COOKIE_SECURE=true
```

> 注意：切换到 PostgreSQL 后，镜像需要用 `--build-arg DATABASE_PROVIDER=postgresql` 重新构建
> （docker-compose 已通过 `${DATABASE_PROVIDER}` 自动传入该构建参数）。

---

## 六、Nginx 反向代理 + HTTPS

完整示例见 [`deploy/nginx.conf.example`](deploy/nginx.conf.example)，核心步骤：

```bash
# 1. 复制并按需修改域名
sudo cp deploy/nginx.conf.example /etc/nginx/sites-available/scheduling
sudo nano /etc/nginx/sites-available/scheduling      # 把 your-domain.com 换成你的域名

# 2. 先只保留 80 端口段，申请证书（webroot 方式）
sudo mkdir -p /var/www/certbot
sudo ln -s /etc/nginx/sites-available/scheduling /etc/nginx/sites-enabled/scheduling
sudo nginx -t && sudo systemctl reload nginx
sudo apt install -y certbot
sudo certbot certonly --webroot -w /var/www/certbot -d your-domain.com

# 3. 恢复 443 段配置并重载
sudo nginx -t && sudo systemctl reload nginx

# 4. 自动续期
sudo systemctl enable --now certbot.timer
sudo certbot renew --dry-run
```

代理必须传递真实 IP（应用用它做填写端限流）：

```nginx
proxy_set_header Host              $host;
proxy_set_header X-Real-IP         $remote_addr;
proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
```

启用 HTTPS 后，请把 `.env` 中的 `BASE_URL` 改为 `https://your-domain.com`、`COOKIE_SECURE=true`，然后重启应用。

---

## 七、数据库备份与恢复

### 7.1 使用脚本（推荐）

```bash
# 备份（自动识别 SQLite / PostgreSQL，输出到 ./backups，默认保留 30 天）
./scripts/backup.sh

# 自定义目录与保留天数
BACKUP_DIR=/data/backups RETENTION_DAYS=90 ./scripts/backup.sh

# 恢复（会二次确认，并自动保存恢复前的副本）
./scripts/restore.sh backups/scheduling-sqlite-20260101-020000.db.gz
./scripts/restore.sh backups/scheduling-pg-20260101-020000.sql.gz
```

定时备份（每天 02:00）：

```bash
crontab -e
0 2 * * * cd /opt/scheduling && ./scripts/backup.sh >> /var/log/sched-backup.log 2>&1
```

### 7.2 手工命令

SQLite：

```bash
sqlite3 prisma/data/app.db ".backup 'backups/app-$(date +%F).db'"
# 或停服后直接复制文件
```

PostgreSQL：

```bash
pg_dump -h 127.0.0.1 -U sched -d scheduling --no-owner | gzip > backups/scheduling-$(date +%F).sql.gz
gunzip -c backups/scheduling-2026-01-01.sql.gz | psql -h 127.0.0.1 -U sched -d scheduling
```

Docker 部署：

```bash
docker compose exec -T db pg_dump -U sched -d scheduling | gzip > backups/pg-$(date +%F).sql.gz
docker compose exec -T app sh -c 'sqlite3 /app/prisma/data/app.db ".backup /app/backups/app.db"'
```

> 建议同时备份 `.env`（含 `SESSION_SECRET`），并把备份文件同步到对象存储或异地机器。

---

## 八、自动匹配算法

实现见 [`src/lib/matching.ts`](src/lib/matching.ts)，规则如下：

1. **输入**：每个"日期 + 班次"的需求人数；每位填写人对每个"日期 + 班次"的选择（首选/次选/无法）与理由。
2. **硬约束**
   - 绝不安排标记为"无法排班"的班次；
   - 默认同一人同一天最多一个班次；
   - 仅在管理员开启"允许同日多班"且两个班次时间完全不重叠时，才可同日多班；
   - 同一人同一班次不会被安排两次。
3. **优先级**：第一轮用"首选"满足需求 → 第二轮用"次选"补充 → 第三轮仍不足则记录缺口（不使用"无法"）。
4. **超额公平规则**（可复现）：历史排班次数少者优先 → 提交时间早者优先 → 固定随机种子（mulberry32）打散同分者。
5. **输出**：全部满足 → 生成 `Assignment` 并输出日历排班表 + 姓名排班表；存在缺口 → **不生成结果**，只输出缺口报告（含可能原因）。
6. **重新匹配**：任务详情页可指定随机种子重新匹配（需二次确认，结果可复现，写入操作日志）。

---

## 九、安全设计

| 项目 | 实现 |
| --- | --- |
| 管理员密码 | Node 内置 scrypt 加盐哈希（格式 `scrypt$N$r$p$salt$hash`），不落明文 |
| 管理员会话 | HMAC-SHA256 签名的 HttpOnly Cookie（`SameSite=Lax`，HTTPS 下 `Secure`），服务端每次校验账号状态，禁用后立即失效 |
| 填写链接 | `Task.publicToken` 使用 UUID（`/fill/{uuid}`），不可枚举 |
| 填写密码 | 哈希存储，可随时重置；重置后旧通行凭证立即失效 |
| 填写端限流 | 内存固定窗口限流：提交/读取按 IP + 任务、密码尝试按 IP + 任务；可再加 Nginx `limit_req` |
| 锁定与解锁 | "截止并确认"锁定提交（`Submission.status = locked`）；"解锁填写"需二次确认并写日志 |
| 操作日志 | 登录、建/改/删任务、发布、重置密码、确认、解锁、匹配、名单变更等全部记录到 `AuditLog` |
| 其它 | 响应头 `X-Content-Type-Options` / `X-Frame-Options` / `Referrer-Policy`；上传文件 5MB 限制与类型校验 |

> 安全建议：生产环境使用 HTTPS、替换 `SESSION_SECRET`、删除或修改初始管理员密码、
> 只允许管理员访问 `/admin/*`（可在 Nginx 层再加 IP 白名单）。

---

## 十、数据模型

`prisma/schema.prisma` 共 12 个模型：

| 模型 | 说明 |
| --- | --- |
| `Admin` | 管理员账号、密码哈希、状态、是否超级管理员 |
| `Task` | 任务名称、说明、日期范围、填写截止、填写密码哈希、填写链接 UUID、状态、是否允许同日多班、区域模式/兼顾上限、日历快照、匹配种子/结论 |
| `Shift` | 任务下的班次：名称、开始/结束时间、默认人数、日期规则（JSON）、排序 |
| `Area` | 班次下的区域：名称、距离组、默认人数、排序 |
| `TaskDayRequirement` | 某个日期、班次、区域的需求人数（支持按天单独调整） |
| `RosterEntry` | 上传名单：姓名、工号、部门、归一化姓名 |
| `Submission` | 填写人：姓名、工号、部门、是否名单内、状态、工作量偏好、最多可排次数、提交时间 |
| `Selection` | 每个"日期 + 班次"的选择（preferred/backup/unavailable）与理由 |
| `Assignment` | 最终排班：日期、班次、区域、人员、来源（首选/次选/手动）、批次、种子、历史次数、是否手动、说明 |
| `CalendarCache` | 按年份缓存的节假日/调休数据、来源与抓取时间 |
| `CalendarOverride` | 管理员自定义的日历覆盖（优先级最高） |
| `AuditLog` | 管理员操作日志 |

---

## 十一、名单模板格式

支持 `.csv`（UTF-8，可带 BOM）与 `.xlsx`。第一行必须是表头，至少包含"姓名"列，"工号""部门"可选：

| 姓名 | 工号 | 部门 |
| --- | --- | --- |
| 张三 | A001 | 内科 |
| 李四 | A002 | 外科 |

- 可在任务详情页"下载名单模板 (CSV/XLSX)"获取模板。
- 上传后系统自动核对：名单内已填、未填写人员（可单独导出）、名单外提交（标记为"名单外提交"）。
- 也支持直接在页面粘贴名单文本（每行一个姓名，或 CSV 多列）。

---

## 十二、目录结构

```
.
├─ prisma/
│  ├─ schema.prisma              # 9 个模型（provider 由切换脚本修改）
│  ├─ migrations/                # 当前生效的迁移（Prisma 默认读取）
│  ├─ migrations-sqlite/         # SQLite 迁移长期保存
│  ├─ migrations-postgresql/     # PostgreSQL 迁移长期保存
│  ├─ seed.mjs                   # 初始管理员 / 演示数据
│  └─ data/                      # SQLite 数据文件（gitignore）
├─ scripts/
│  ├─ launcher.mjs               # 一键启动器核心（Windows/Linux 通用，Node 实现）
│  ├─ desktop-launcher.cmd       # 桌面版启动入口（含 PROJECT_DIR，可复制到桌面）
│  ├─ start-silent.vbs           # 静默启动（供桌面快捷方式调用）
│  ├─ stop-silent.vbs            # 静默停止
│  ├─ install-desktop-shortcuts.ps1  # 生成桌面「启动/停止」快捷方式
│  ├─ start-scheduling.ps1 / start-scheduling-background.ps1 / stop-scheduling.ps1
│  ├─ start-linux.sh / stop-linux.sh # Linux / WSL 一键启停
│  ├─ switch-provider.mjs        # SQLite <-> PostgreSQL 一键切换
│  ├─ backup.sh / restore.sh     # 备份与恢复
│  └─ e2e-test.mjs               # 端到端验证脚本（137 项断言）
├─ Start-Scheduling-System.cmd   # 项目内一键启动（前台）
├─ Start-Scheduling-Silent.cmd   # 项目内一键启动（后台静默）
├─ Stop-Scheduling-System.cmd    # 停止服务
├─ Scheduling-System-Status.cmd  # 查看服务状态
├─ deploy/
│  ├─ nginx.conf.example         # Nginx 反向代理 + HTTPS 示例
│  └─ scheduling.service.example # systemd 单元示例
├─ src/
│  ├─ app/
│  │  ├─ admin/login/            # 管理员登录
│  │  ├─ admin/(protected)/      # 后台（dashboard / tasks / settings）
│  │  ├─ api/                    # 管理端与填写端接口、健康检查、导出
│  │  └─ fill/[uuid]/            # 填写端三个页面
│  └─ lib/                       # 密码、会话、令牌、限流、匹配算法、名单、XLSX、导出
├─ .run/                         # 启动器运行时目录（PID 与日志，gitignore）
├─ docker/entrypoint.sh          # 容器启动时执行迁移
├─ Dockerfile / docker-compose.yml / .dockerignore
├─ .env.example
└─ README.md
```

---

## 十三、端到端验证

项目自带一套端到端脚本，覆盖登录、建任务、发布、填写、校验、名单、确认锁定、自动匹配、缺口报告与导出，
以及「只有 1 个班次的任务」回归用例（共 87 项断言）：

```bash
# 1. 先构建并启动服务
npm run build
npm run start            # 另开一个终端

# 2. 运行验证
node --experimental-strip-types scripts/e2e-test.mjs
```

导出产物（名单 XLSX、未填写名单、理由、排班结果、缺口报告）会写入 `.e2e-artifacts/`。
测试产生的任务会在结束时自动清理。

---

## 十四、常见问题

**Q：忘记管理员密码？**
A：让其他管理员在"管理员账号管理"里重置；若所有管理员都忘了，可在服务器上执行：

```bash
node -e "
const {PrismaClient}=require('@prisma/client');const {randomBytes,scryptSync}=require('crypto');
const p=new PrismaClient();const pw='新的强密码';
const salt=randomBytes(16);const key=scryptSync(pw.normalize('NFKC'),salt,64,{N:1<<15,r:8,p:1,maxmem:67108864});
const hash=['scrypt',1<<15,8,1,salt.toString('base64'),key.toString('base64')].join('\$');
p.admin.update({where:{username:'admin'},data:{passwordHash:hash}}).then(()=>{console.log('已重置为',pw);return p.\$disconnect()});
"
```

**Q：用户反馈"填写链接无效"？**
A：链接必须是完整的 `/fill/<uuid>`（uuid 为 36 位），且任务未被删除。可在任务详情页重新复制链接。

**Q：用户说"已超过填写截止时间"？**
A：在任务详情页"任务信息"里调整填写截止时间，或点击"解锁填写"（需确认）。

**Q：匹配出来有缺口怎么办？**
A：查看缺口报告的"可能原因"。常见处理：放宽截止时间让更多人填写首选/次选、开启"允许同日多班"（仅在班次时间不重叠时生效）、或调低某些班次的需求人数后重新匹配。

**Q：SQLite 数据库文件在哪？**
A：`DATABASE_URL="file:./data/app.db"` 是相对 `prisma/schema.prisma` 的路径，即 `prisma/data/app.db`（Docker 中为 `/app/prisma/data/app.db`，已挂载到命名卷）。

---

## 十五、验收对照

| 验收项 | 实现位置 |
| --- | --- |
| Docker / npm 一键运行 | `Dockerfile`、`docker-compose.yml`、`npm run setup && npm run dev` |
| 只有管理员登录入口 | `/admin/login`；无注册页；`/` 直接跳转登录 |
| 创建任务（日期、班次、时间、每日人数、密码） | `/admin/tasks/new` |
| 发布生成链接与密码 | 任务详情页"填写链接与密码" |
| 用户凭链接+密码进入并完成三选一 | `/fill/[uuid]` → `/fill/[uuid]/form` |
| 全部班次必须三选一、无法必须填理由 | `src/app/api/fill/[uuid]/submit/route.ts` 校验 |
| 查看已填/未填/一键查看全部理由 | 任务详情页"填写情况""名单核对结果""无法排班理由一键汇总" |
| 上传名单并标出未填写 | 任务详情页"名单核对"（CSV/XLSX 解析见 `src/lib/roster.ts`） |
| 截止确认锁定 + 自动匹配 | "截止确认与自动匹配"面板 |
| 匹配优先首选→次选、绝不安排无法 | `src/lib/matching.ts` |
| 全部满足输出日历/姓名排班表并可导出 | `/admin/tasks/[id]/result` + `/api/admin/tasks/[id]/result` |
| 无法满足输出缺口报告 | 结果页"缺口报告" + 导出 `sheet=gaps` |
| 界面不使用透明及立体元素 | `src/app/globals.css`（全局禁用阴影/透明度，纯色+边框+表格） |
| 完整源码、迁移、README、.env.example、Docker | 见"目录结构" |

---


## 十六、更新记录

### v1.3.0（本次）

- **简化创建流程与管理员引导**
  - 新建任务支持「快速创建」（名称 + 日期 + 模板）与「5 步详细向导」；
  - 4 套内置模板（晚自习多区域 / 白班 / 周末 / 空白），默认值自动补全；
  - 草稿自动保存到 localStorage，刷新/误关可恢复；创建前统一校验并定位；
  - 创建页提交改为「草稿配置 + 稀疏覆盖」JSON，服务端用同一纯函数权威生成需求，避免数万字段；
  - 仪表盘新手引导与一键示例任务，任务详情显示“下一步”，每个复杂字段带说明。
- **区域化多人值班**
  - 新增 `Area`（区域、距离组、默认人数）；需求与排班精确到区域；
  - 同一时段同组一人可兼顾多个区域（`maxAreasPerPerson`），跨组禁止；支持“独立分人”模式；
  - 匹配改为两阶段：先按时段需求供人，再分配到区域；缺口按区域报告；
  - 结果页/导出/手动调整均按区域展示与操作，新增“兼顾多区域人次”统计。
- **工作量偏好**：填写人多排/正常/少排 + 最多可排次数；匹配排序与硬上限；手动超限提示。
- **批量填写**：整表/整行/整列/日期区间批量首选/次选/无法，统一理由，撤销 10 步。
- **日期规则与日历 API**
  - 班次支持仅工作日 / 晚自习（次日工作日）/ 每天 / 仅周末 / 自定义星期 + 强制纳入/排除；
  - 接入 holiday-cn、timor.tech、jiejiariapi 三源回退，缓存 30 天，自定义覆盖优先；
  - 新增 `/admin/settings/calendar` 管理页与 `/api/admin/calendar` 接口；任务创建写入日历快照。
- **数据库**：SQLite / PostgreSQL 双迁移（区域、工作量、日历表、历史数据回填默认区域）。
- **测试**：E2E 扩展至 137 项（日历规范化/规则、自定义优先级、区域共享与跨组、工作量上限、批量选择、多区域全链路）。

### v1.1.0

- **新增：自动匹配后的手动调整排班**
  - 结果页新增「手动调整排班」面板：按日期×班次增删人员、填写调整说明、一键清空手动记录；
  - 数据模型 `Assignment` 新增 `manual`（是否手动）与 `note`（调整说明），并附带 SQLite / PostgreSQL 迁移；
  - 硬约束保留：**不允许安排标记“无法排班”的人员**；超员、同日冲突给出提示但允许管理员决断；
  - 缺口报告改为**按实际排班结果计算**，手动补齐后缺口实时减少；导出文件新增“是否手动调整 / 调整说明”列；
  - 新增 API：`POST/DELETE /api/admin/tasks/{id}/assignments`、`GET /api/admin/tasks/{id}/candidates`；
  - 所有调整写入操作日志（`task.assignment.*`）；重新匹配会二次确认并覆盖手动调整。
- **新增：Docker 打包**
  - `scripts/package-docker.ps1` / `.sh`：构建镜像 → `docker save` → 生成 SHA256；
  - `scripts/package-docker-context.mjs`：生成可离线分发的构建上下文压缩包；
  - `scripts/verify-dockerfile.mjs`：无需 Docker 守护进程即可静态校验 Dockerfile；
  - 补齐 `public/` 目录（此前缺失会导致 Dockerfile 的 `COPY public` 失败）。
- **新增：GitHub 仓库**
  - 已初始化仓库并完成首次提交，`.gitignore` 排除密钥、数据库、依赖与构建产物。

### v1.0.1

- **修复：班次只有 1 个时无法创建任务 / 班次丢失**
  「新建任务」表单原先用 React 行 key 命名班次字段（`shiftName_1`、`shiftName_2`…），
  而服务端按位置解析（`shiftName_0`、`shiftName_1`…）。默认两行时恰好对得上，
  一旦删除某一行（例如只剩第 2 行），提交的数据就会落在服务端读不到的名字上：
  创建出的任务班次为空（发布时提示"请先为任务添加班次"），或按默认人数写入错误的需求。
  现已改为**按位置下标**命名（`shiftName_0/1/2…`、`req_0_日期`），并在以下位置加固：
  - 前端提交前本地校验班次名称/时间是否填写完整（不再静默丢弃未命名班次）；
  - 服务端区分"整行缺失（表单结构异常）"与"整行为空（忽略）"，避免一半填写的行被丢弃；
  - 修改某班次的"默认人数"时，同步刷新该班次尚未单独调整过的每日人数单元格；
  - 新增端到端回归断言（`scripts/e2e-test.mjs` 第 11 节）覆盖单班次的创建、发布、填写与匹配。

- **新增：一键启动器**（`scripts/launcher.mjs` + 桌面快捷方式 + Linux/WSL 脚本），
  以生产构建模式启动，自动完成环境检查、依赖安装、数据库迁移、按需构建、健康检查与打开浏览器；
  并修复了 `NODE_ENV=development` 泄漏到构建导致预渲染失败、以及运行中的服务锁定 Prisma 引擎
  导致 `prisma generate` 失败的问题。

---

## 十七、许可

本项目为内部排班工具示例，可自由修改与部署。
