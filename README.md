# Amyrtle Growth

摄影预约 × 餐饮领券核销的本地可运行 MVP。技术栈为 Node.js 24、React 19、TypeScript、Vite、Express 5 和 SQLite；已包含前后端、持久化数据、安全控制、测试和运维脚本。

开源仓库：[Amyrtle/amyrtle-growth](https://github.com/Amyrtle/amyrtle-growth)，采用 [MIT License](LICENSE)。公开源码与运行方式见 [GitHub 交付说明](docs/GITHUB.md)，持续集成入口为 [GitHub Actions](https://github.com/Amyrtle/amyrtle-growth/actions/workflows/ci.yml)。

当前交付是本地演示与试点准备版本。CloudBase、云数据库 RLS、真实模型调用和实际商用尚未验证，也没有公开上线。

## 启动

安装 Node.js 24，在项目目录运行：

```powershell
npm ci
npm run build
npm start
```

打开 <http://127.0.0.1:4173>。Windows 也可运行 `启动-Amyrtle.cmd`。首次安装依赖需要网络；首次启动自动建立 `.local/amyrtle.sqlite`、本地加密密钥和演示账户。开发模式使用 `npm run dev`。

| 账号 | 角色 |
| --- | --- |
| photo@demo.amyrtle.local | 摄影店主 |
| food@demo.amyrtle.local | 餐饮店主 |
| staff@demo.amyrtle.local | 餐饮店员 |
| admin@demo.amyrtle.local | 平台管理员 |

以上本地演示账号密码均为 `AmyrtleDemo2026!`，通过服务端密码验证。服务仅绑定本机回环地址。

## 已交付

- 租户隔离、owner / staff / admin 角色、管理员手动开通商家、店铺资料与 Logo。
- 双行业活动草稿、编辑、复制、人工审核发布、暂停、结束，渠道链接与二维码。
- 摄影档期、预约、确认、取消、完成；餐饮限量领券、一次性核销、撤销。
- 事务性名额控制、幂等请求、审计、真实事件统计和店主预约导出。
- JPEG / PNG / WebP 素材上传与重新编码、素材归属校验。
- 离线 Mock 文案和兼容 Chat Completions 的服务端模型适配器，额度、超时、结构及事实校验。
- 隐私告知、凭证查询与资料删除；SQLite 备份、恢复和本地版本回滚演练。

模型默认不联网。演示数据不代表真实商家、客户或交易。领券限制识别同一浏览器，尚非实名身份防刷。

## 验证与文档

执行 `npm run verify` 可运行检查、构建、浏览器测试及运维演练。Windows 默认使用本机 Microsoft Edge；其他平台使用 Playwright Chromium，首次运行前执行 `npx playwright install --with-deps chromium`。可用 `PLAYWRIGHT_CHANNEL` 指定已安装的浏览器。最终结果、环境和局限见 [测试报告](docs/TEST_REPORT.md)，截图位于 `docs/screenshots/`。

| 文档 | 用途 |
| --- | --- |
| [架构](docs/ARCHITECTURE.md) | 技术选型与本地替代方案 |
| [API](docs/API.md) | 实际接口、请求和权限 |
| [安全](docs/SECURITY.md) | 已有控制及上线缺口 |
| [部署](docs/DEPLOYMENT.md) | 启动配置与云端迁移边界 |
| [操作与恢复](docs/OPERATIONS.md) | 演示、备份、恢复及故障定位 |
| [试点交付](docs/SALES_HANDOFF.md) | 演示顺序与商家交付范围 |
| [PRD](docs/PRD.md) | 原始目标；实现状态以本 README 与测试报告为准 |

源码在 `src/`、`server/`、`shared/`；迁移在 `db/migrations/`；测试在 `tests/`。环境变量示例见 `.env.example`。备份数据库时须另行保存原加密密钥。
