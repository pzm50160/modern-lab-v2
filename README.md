# Modern Lab V2

員工用的交接工作台，包含登入、交接、備忘、待辦事項、已辦事項、管理員人員清單，以及舊 Firebase 使用者遷移到 Supabase 的工具。

## 功能

- 員工姓名 + 密碼登入
- 交接、備忘、待辦三種分類
- 已辦事項與恢復待辦
- 優先處理與截止時間
- Supabase Realtime 即時更新
- 管理員可切換員工角色
- Firebase users collection 遷移到 Supabase Auth + profiles

## 環境設定

`.env` 需要：

```env
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-publishable-or-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

FIREBASE_API_KEY=
FIREBASE_AUTH_DOMAIN=
FIREBASE_PROJECT_ID=
FIREBASE_STORAGE_BUCKET=
FIREBASE_MESSAGING_SENDER_ID=
FIREBASE_APP_ID=

ADMIN_NAMES=管理員姓名
```

`SUPABASE_SERVICE_ROLE_KEY` 只給 `scripts/` 使用，不會被前端打包。

## Supabase 初始化

先到 Supabase SQL Editor 執行：

```text
scripts/schema.sql
```

這會建立：

- `profiles`
- `categories`
- `tasks`
- 基本 Row Level Security policies

## 常用指令

```bash
npm run dev
npm run build
npm run lint
npm run fix:profiles
npm run migrate:users
```

Windows PowerShell 若擋 `npm.ps1`，可改用：

```powershell
npm.cmd run dev
```

## 登入帳號規則

前端會把員工姓名轉成 Base64，再組成隱藏 email：

```text
黃博逸 -> Base64 -> xxxxx@modern-lab.com
```

因此員工只需要輸入姓名與密碼。
