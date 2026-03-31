# 降本项目管理系统

一个基于 Next.js 的现代化项目管理系统，专注于成本降低项目的跟踪和管理。

## 功能特性

- 🔐 **安全认证** - 基于 bcrypt 的密码加密存储
- 📊 **项目仪表盘** - 实时项目进度和成本节约统计
- 👥 **角色权限管理** - 支持管理员、经理和员工三种角色
- 🗄️ **SQL Server 集成** - 支持连接外部数据库
- 🎨 **主题切换** - 支持多种主题风格
- 🐳 **Docker 部署** - 优化的容器化部署方案

## 技术栈

- **框架**: Next.js 16 (App Router)
- **语言**: TypeScript
- **样式**: Tailwind CSS 4
- **数据库**: SQL Server (可选) + 本地 JSON 存储
- **认证**: Cookie-based sessions
- **加密**: bcryptjs

## 快速开始

### 环境要求

- Node.js 20+
- npm 或其他包管理器

### 安装步骤

1. **克隆项目**
```bash
git clone <repository-url>
cd xm
```

2. **安装依赖**
```bash
npm install
```

3. **配置环境变量**
```bash
cp .env.example .env
```

编辑 `.env` 文件，配置以下变量：
```env
# 数据库配置（可选）
XM_SQLSERVER_CONNECTION_STRING=Server=localhost,1433;Database=ProjectDB;User Id=sa;Password=YourPassword;
XM_SQLSERVER_TABLE=ICBom
```

4. **运行开发服务器**
```bash
npm run dev
```

访问 [http://localhost:3000](http://localhost:3000)

### 默认账号

系统预置了以下测试账号：

- **管理员**: `administrator` / `admin`
- **技术部经理**: `techmanager` / `admin`
- **市场部经理**: `marketmanager` / `admin`
- **开发人员**: `developer` / `admin`
- **市场专员**: `marketer` / `admin`

⚠️ **重要**: 首次运行后，请立即修改默认密码！

## 密码迁移

如果你从旧版本升级，需要将明文密码迁移为加密格式：

```typescript
import { migratePasswordsToHash } from "@/lib/server/migrate-passwords";
await migratePasswordsToHash();
```

## Docker 部署

### 使用 Docker Compose

```bash
docker-compose up -d
```

### 手动构建

```bash
docker build -t xm-app .
docker run -p 3000:3000 --env-file .env xm-app
```

## 项目结构

```
xm/
├── app/                    # Next.js App Router 页面
│   ├── api/               # API 路由
│   ├── admin/             # 管理员页面
│   ├── login/             # 登录页面
│   └── projects/          # 项目管理页面
├── components/            # React 组件
├── lib/                   # 工具函数和服务
│   └── server/           # 服务端逻辑
│       ├── auth.ts       # 认证逻辑
│       ├── password.ts   # 密码加密
│       ├── logger.ts     # 日志系统
│       └── store.ts      # 数据存储
├── types/                 # TypeScript 类型定义
└── public/               # 静态资源
```

## 开发指南

### 添加新的 API 路由

使用认证中间件简化开发：

```typescript
import { withAuth, withManagerRole } from "@/lib/server/api-helpers";

export const GET = withAuth(async (request, user) => {
  // user 已经通过认证
  return NextResponse.json({ data: "..." });
});

// 需要特定角色
export const POST = withManagerRole(async (request, user) => {
  // user 是 admin 或 manager
  return NextResponse.json({ success: true });
});
```

### 日志记录

```typescript
import { logger } from "@/lib/server/logger";

logger.info("操作成功", { userId: "123" });
logger.warn("警告信息", { context: "..." });
logger.error("错误信息", error, { additionalInfo: "..." });
```

## 安全性

- ✅ 密码使用 bcrypt 加密存储
- ✅ Cookie 设置了 httpOnly 和 secure 标志
- ✅ 数据库凭证通过环境变量配置
- ✅ API 路由有认证和权限检查
- ✅ Docker 容器以非 root 用户运行

## 构建生产版本

```bash
npm run build
npm run start
```

## 许可证

[添加你的许可证信息]

## 贡献

欢迎提交 Issue 和 Pull Request！
