# 部署与配置

## 本机运行

需要 Node.js 24 和 npm。在项目根目录运行：

```powershell
npm ci
npm run build
npm start
```

默认入口为 `http://127.0.0.1:4173`。`npm run dev` 启动 Vite 开发中间件；`npm start` 提供已构建的 dist 和同进程 API。这里的 production 参数表示使用构建产物，不代表已经通过公网生产验收。

可复制 `.env.example` 为 `.env` 后修改：

| 变量 | 默认 / 作用 |
| --- | --- |
| HOST | 127.0.0.1；入口只允许回环地址 |
| PORT | 4173 |
| DATABASE_PATH | .local/amyrtle.sqlite |
| DEMO_MODE | true；自动初始化演示账号与数据 |
| DATA_KEY | 留空时本机生成；生产候选配置应显式安全托管 |
| PUBLIC_ORIGIN | http://127.0.0.1:4173；须与访问地址一致 |
| AI_PROVIDER | mock |
| AI_DAILY_LIMIT / AI_MONTHLY_LIMIT | 每店 10 / 30；失败调用也计入记录额度 |
| ALLOW_EXTERNAL_AI | false |
| AI_BASE_URL / AI_API_KEY / AI_MODEL | 真实兼容模型待配置 |

修改端口时同时修改 PUBLIC_ORIGIN。不要在已有真实数据的数据库上启用演示种子。迁移在服务创建数据库连接时执行；迁移目录必须随代码一并保留。

## 非演示本地账户

使用独立的新数据库路径和 `DEMO_MODE=false`，通过环境变量设置 `PROVISION_EMAIL`、`PROVISION_PASSWORD`，密码至少 12 字符，然后运行 `npm run provision` 创建管理员。登录后在管理员界面手动开通摄影或餐饮店主。创建完成后清除用于开通的密码环境变量。

## 模型适配器

Mock 可以离线演示。要连接兼容服务，需非 mock 的 AI_PROVIDER、`ALLOW_EXTERNAL_AI=true`、HTTPS AI_BASE_URL、密钥和模型名称。适配器在基础 URL 后追加 `/chat/completions`，要求 JSON 输出，默认 8 秒超时。外部调用可能产生费用；本交付未配置真实凭据、未发生实际模型验收。失败时原活动仍可手动编辑发布。

## 云端迁移边界

本交付没有 CloudBase 项目、云域名或已上线服务。不能把 dist 单独上传后视为完成部署：鉴权、预约、领券、素材和数据库依赖 Node 服务端。

云部署需另行完成：选定账号与环境；迁移身份、数据库和素材存储；验证 RLS 或等价隔离；配置 HTTPS 与可信来源；处理会话、限流、多实例事务及数据库持久化；配置密钥、预算和监控；执行真实环境验收、备份恢复与回滚。不要直接移除回环限制来公开演示实例。

本地验证与部署边界详见 [测试报告](TEST_REPORT.md)；备份步骤见 [运维手册](OPERATIONS.md)。
