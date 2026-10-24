# 实际 API 合约

基础地址：`http://127.0.0.1:4173/api`。本文件描述当前 Express 实现，PRD 中的示例路径不能直接视为已实现接口。

## 请求约定

JSON 成功响应：`{ "ok": true, "data": {}, "requestId": "..." }`；失败响应：`{ "ok": false, "error": { "code": "...", "message": "..." }, "requestId": "..." }`。图片读取直接返回 WebP。

所有写请求必须有 `x-amyrtle-request: 1`；带有 Origin 时必须匹配 `PUBLIC_ORIGIN`。登录后的写请求另需 `x-csrf-token`，取自登录或会话响应，并保留 HttpOnly 会话 Cookie。JSON 请求使用 `Content-Type: application/json`。

常见状态码：400 参数错误；401 未登录；403 权限或来源校验失败；404 对象不存在或不可访问；409 库存、状态或版本冲突；429 频率或额度限制；503 模型不可用。新建资源一般返回 201。

## 公开接口

| 方法与路径 | 输入 / 行为 |
| --- | --- |
| GET `/health` | 服务、演示模式及数据库类型 |
| POST `/auth/login` | `{email,password}`；返回 CSRF 并设置会话 |
| GET `/public/:slug` | 已发布活动、公开店铺资料、档期、库存和 active 标记 |
| POST `/public/:slug/events` | `{type,key,source}`；type 为 page_view / cta_click，key 为 UUID |
| POST `/public/:slug/book` | `{slotId,name,contact,consent:true,requestKey,source,website:""}` |
| POST `/public/:slug/claim` | `{consent:true,requestKey,source,website:""}` |
| POST `/privacy/access` | `{id,token}`；查询持有有效隐私凭证的记录 |
| POST `/privacy/delete` | `{id,token}`；删除联系方式、取消未完成预约或撤销未用券 |
| GET `/assets/:id` | 已发布活动引用的图片可公开读取；其他图片需要同店会话 |

`requestKey` 为 UUID。同一浏览器、活动和请求键的重试返回已有记录；预约内容改变而复用请求键返回 `IDEMPOTENCY_CONFLICT`。请求需要保留访客 Cookie。预约 contact 当前校验中国大陆 11 位手机号。

`source` 为 `unknown / wechat / xiaohongshu / poster / direct`。预约返回 `id,status,privacyToken`；领券另返回 `code,validUntil`。隐私凭证应仅由领取者保存。券码为 32 位十六进制字符串。

## 登录与商家接口

所有以下接口需要服务端验证的会话。未注明店主专属的商家接口允许本店 owner / staff，资源归属由服务端会话确定。

| 方法与路径 | 权限 / 行为 |
| --- | --- |
| GET `/auth/session` | 当前 user、shop、csrf、demoMode |
| POST `/auth/logout` | 删除当前会话 |
| GET / PATCH `/store` | 读取店铺；修改仅 owner |
| GET `/template` | 本店行业默认活动配置 |
| GET / POST `/campaigns` | 列表；创建仅 owner，完整 CampaignInput |
| GET / PATCH `/campaigns/:id` | 读取活动；编辑仅 owner，`{revision,config}` |
| POST `/campaigns/:id/publish` | owner；`{reviewed:true,revision}`，审核版本与素材权限校验 |
| POST `/campaigns/:id/status` | owner；`{status:"paused"}` 或 `"ended"` |
| POST `/campaigns/:id/duplicate` | owner；创建草稿副本 |
| POST `/campaigns/:id/ai-copy` | owner；以已保存活动为输入，返回文案及 requiresReview |
| GET `/bookings` | 可选 `?campaignId=`，最多 1000 条 |
| PATCH `/bookings/:id` | `{status:"confirmed" / "completed" / "canceled"}` |
| GET `/vouchers` | 可选 `?campaignId=`，最多 1000 条 |
| POST `/vouchers/redeem` | `{code}`；原子核销并记录操作者 |
| POST `/vouchers/:id/revoke` | owner；撤销尚未核销的券 |
| GET `/analytics/summary` | 可选 `?campaignId=`，事件计数、来源和近 7 日趋势 |
| GET `/export/bookings` | owner；可选 `?campaignId=`，返回 JSON，浏览器负责导出 |
| GET `/audit` | owner；最近 50 条本店审计 |
| POST `/assets` | owner；见下方图片上传 |

完整活动及店铺结构以 `shared/schema.ts` 为准。日期为包含时区的 ISO 8601 字符串。活动保存采用 revision 乐观版本检查；有业务历史的档期不能随意修改或删除。

图片上传使用原始二进制 body，Content-Type 为 image/jpeg、image/png 或 image/webp；另加 `x-asset-copyright: confirmed`。单请求上限 4 MB，静态图片最多 2000 万像素，服务端转换为最长边 1600 像素以内的 WebP。返回 `{id,url}`；活动 `assetIds` 最多引用 4 张。

## 平台接口

仅 admin 可访问 GET / POST `/admin/tenants`。创建输入为 `{name,industry,email,password,address,contact}`，industry 为 photo / food，密码至少 12 字符。事务内创建商户、店主及归属关系。没有开放注册接口，也没有通过该接口创建店员的功能。

接口测试证据与限制见 [测试报告](TEST_REPORT.md)。
