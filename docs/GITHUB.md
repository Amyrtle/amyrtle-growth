# GitHub 开源交付

仓库：[Amyrtle/amyrtle-growth](https://github.com/Amyrtle/amyrtle-growth)，采用 MIT License，以 `main` 分支交付。用户于 2026-10-28 明确授权将摄影预约与餐饮领券核销项目同步到 GitHub 并开源。

## 获取与运行

```sh
git clone https://github.com/Amyrtle/amyrtle-growth.git
cd amyrtle-growth
npm ci
npm run build
npm start
```

需要 Node.js 24。默认在 `http://127.0.0.1:4173` 启动本地演示，首次运行创建独立 SQLite 数据库、随机本地加密密钥与演示账号。当前没有经过验证的公网业务部署；GitHub 交付的是可本地运行的完整源码。生产迁移边界见 [部署说明](DEPLOYMENT.md)。

## 自动检查

[GitHub Actions CI](https://github.com/Amyrtle/amyrtle-growth/actions/workflows/ci.yml) 在 push 和 pull request 时执行锁定依赖安装、类型检查、lint、19 项服务端测试、生产构建、7 项浏览器测试及本地备份/恢复演练。数量对应当前测试集，后续以实际运行日志为准。

CI 使用 Ubuntu、Node.js 24 和 Playwright Chromium，保持 Mock AI 与本地合成数据，不需要模型或云平台密钥。工作流不会发布业务服务。首次公开提交及后续版本的检查结果，以对应提交的 Actions 运行结论为准。

2026-10-28 在隔离的 Windows / Node.js 24 副本执行 `npm run verify`：六个阶段退出码均为 0，服务端测试 19/19、Edge 浏览器测试 7/7（17.0 秒），备份和恢复演练通过。此次修正了隐藏目录下前端深层页面的静态回退路径，以及并发测试任意选择档期造成的不稳定夹具；原业务断言保持不变。2026-10-24 的历史日志和截图继续保留，未被此次复验覆盖。

## 提交与隐私

公开仓库保留源代码、数据库迁移、演示素材、测试、运维脚本和验收文档。`.env` 实值、`.local`、SQLite 数据库与密钥、依赖、构建产物及运行报告目录由 `.gitignore` 排除。README 中的账号和密码仅用于强制绑定回环地址的本机演示。

原本地 `master` 历史保留，公开 `main` 历史使用 GitHub 隐私邮箱，历史源码文件树保持一致。早期验收报告引用的是原本地提交标识；原 2026-10-24 的日志和演示截图仍作为历史验收证据保留。

贡献前运行 `npm run verify`，请使用虚构的商家与顾客信息。安全控制及尚未覆盖的生产场景见 [安全说明](SECURITY.md)。
