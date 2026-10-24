# Amyrtle Growth 本地验收报告

验证日期：2026-10-24（北京时间）。最终批次 23:20:07—23:20:39。代码提交：`fd872bbdfaade75d9b5457c953135eb41fb93733`。

环境：Windows、Node.js v24.19.0、SQLite 3.53.3、Microsoft Edge 无头浏览器。所有账号、顾客、券和业务数据均为测试/演示数据。

## 最终结果

执行 `npm run verify`，六个阶段退出码全部为 0：

| 实际命令 | 结果 | 证据 |
|---|---|---|
| `npm run typecheck` | 通过 | [typecheck.log](test-logs/typecheck.log) |
| `npm run lint` | 通过，0 错误 | [lint.log](test-logs/lint.log) |
| `npm test` | 19/19 通过 | [test.log](test-logs/test.log) |
| `npm run build` | 通过 | [build.log](test-logs/build.log) |
| `npm run test:e2e` | 7/7 通过 | [test-e2e.log](test-logs/test-e2e.log) |
| `npm run test:ops` | 本地版本切换、备份恢复通过 | [test-ops.log](test-logs/test-ops.log)、[operations.json](test-logs/operations.json) |

逐命令 UTC 时间、执行耗时、退出码：[verification.json](test-logs/verification.json)。另执行开发服务器冒烟验证，React 登录页可用且无页面异常：[dev-smoke.log](test-logs/dev-smoke.log)。

首次最终复核受新启用的网络沙箱限制，连接本机 `127.0.0.1` 返回 `EACCES`；原始记录保留在 [sandbox-localhost-blocked.log](test-logs/sandbox-localhost-blocked.log)。在获准的本地测试环境重跑后全部通过，没有删掉失败用例或放宽业务断言。

## 原交付包 P0 检查（T01—T14）

| 编号 | 实际输入 / 步骤 | 实际结果 |
|---|---|---|
| T01 | 未登录访问 `/app`、活动 API、导出、核销 | 页面转登录；私有 API 返回 401 |
| T02 | 摄影店请求餐饮店活动、预约、券、报表、导出与修改；店员请求导出 | 跨店 404；店员导出/配置 403，并记录拒绝审计 |
| T03 | 创建草稿、发布、暂停，再请求公共 URL | 草稿与暂停活动 404；发布后可见 |
| T04 | 发布传 `reviewed:false`；调用 AI；模型输出含未提供的 99999 元赠品 | 未审核发布 400；AI 结果不改活动状态；虚构数字/承诺被拒绝 |
| T05 | 两个客户端、两个独立 API 进程同时抢容量 1 档期 | 状态码恰为 201 和 409；仅 1 条预约，容量计数为 1 |
| T06 | 同浏览器重复相同幂等键，另以同键修改姓名 | 重试返回原编号；改动请求 409；记录不重复 |
| T07 | 店主和店员并发核销同券；另用两个独立进程核销 | 恰好一次 200、一次 409；成功核销日志和事件均为 1 |
| T08 | 其他店核销、再次核销、模拟过期券核销 | 分别拒绝，返回明确无效/已核销/过期状态，并留审计 |
| T09 | 负价格、HTML 标签、过长标题、非法时段、额外 tenant 字段、伪图片、错误 CSRF、异域 Origin | 安全拒绝；图片转码 WebP 且移除元数据；联系方式加密且不进入事件表 |
| T10 | 模型未配置、模拟截止超时、额度与结构化输出路径 | 无模型仍可手动保存并审核发布；截止超时不改变原事实；模拟传输验证输出结构 |
| T11 | 预约、领券、核销、渠道 PV 去重并读取汇总 | 相应服务端事件仅增加一次；未知来源单列；没有 GMV/收入字段 |
| T12 | 错误隐私凭证、正确访问、删除、重复删除 | 错误凭证拒绝；正确凭证可访问；联系方式清空、未完成预约取消并释放容量 |
| T13 | 375×812 完成预约、领券、核销、后台导航、编辑与设置 | 核心流程成功；各步骤断言无横向溢出；截图见下 |
| T14 | 服务版本 A → 演练版本 B → A；在线备份 → 修改店名 → 恢复 | 原 HTML 哈希一致；SQLite integrity_check=ok、foreign_key_check 无错误；恢复后登录成功且原店名恢复 |

T14 是本机同数据库结构的恢复演练；没有执行 CloudBase 云恢复或跨数据库版本降级。

## 新启动包 T01—T15 对照

T01 跨店隔离对应上表 T02；T02 容量对应 T05；T03 幂等对应 T06；T04 并发核销对应 T07；T05 暂停/过期活动在 API 集成中返回 404/409；T06 未授权对应 T01；T07 店员导出对应 T02；T08 AI 人审对应 T04；T09 模型不可用对应 T10；T10 未同意表单返回 400；T11 高熵券码、领券/核销频控和登录限速已实现，登录暴力重试测试返回 429（未作分布式反刷能力承诺）；T12 恢复对应 T14；T13 手机对应 T13；T14 渠道链接/二维码在浏览器验证 `source=poster`，接口验证归因；T15 页面持续显示演示标记，截图可见。

## 浏览器证据

- [首页](screenshots/01-home-desktop.png)
- [桌面商家后台](screenshots/02-dashboard-desktop.png)
- [审核发布与渠道二维码](screenshots/03-editor-share.png)
- [摄影活动手机页](screenshots/04-photo-mobile.png)
- [摄影预约手机表单](screenshots/05-booking-mobile.png)
- [咖啡活动手机页](screenshots/06-coffee-mobile.png)
- [领券成功页](screenshots/07-voucher-mobile.png)
- [店员核销与重复核销提示](screenshots/08-redemption-mobile.png)
- [手机商家后台](screenshots/09-dashboard-mobile.png)

自动无障碍检查使用 axe WCAG2A/2AA 标签，覆盖首页、登录、两种公开活动页和商家概览，最终 0 个报告违规；不等同于完整人工无障碍认证。最初发现的浅色文字及侧栏溢出已修正。

## 尚未验证 / 不属于完成声明

- CloudBase 身份认证、PostgreSQL 迁移/RLS、云端权限与恢复、域名与公网部署。
- 真实模型供应商连通性、模型收费和实际 token 账单；当前默认离线 Mock，外部适配器以模拟传输测试。
- iOS Safari、微信内置浏览器、实体手机键盘与扫码、真实公网性能和负载压力。
- 正式经营主体、有效客服联系方式、生产保留期限、备案/许可及真实商家试点。
- 领券身份为浏览器 Cookie，不能证明跨浏览器“每人限领”。

结论：当前成果通过本地 MVP 验收，可用于功能演示与继续开发；不能据此宣称已经达到真实客户公开商用的上线条件。
