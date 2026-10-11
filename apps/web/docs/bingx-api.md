# BingX API — dữ liệu affiliate cho nền tảng cashback

Ngày đối chiếu: **09/10/2026**. Tài liệu khảo sát, chưa có connector BingX trong worker. Đọc cùng [Bybit](bybit-cashback.md), [MEXC](mexc-referral-activity.md) và [Binance](binance-api.md).

Đã tra Context7 `/bingx-api/docs`; phần Agent chưa có kết quả đủ dùng nên đối chiếu repository chính thức `BingX-API/api-ai-skills`. API tài khoản giao dịch cá nhân chưa chứng minh quyền Agent.

## 1. Lấy API key

Đăng nhập tài khoản affiliate/agent → User Center → [API Management](https://bingx.com/en/accounts/api) → tạo key riêng cho worker. Lưu API key/secret riêng tư; key mới mặc định read-only. Xác minh quyền Agent với BingX; không tự bật trading/withdrawal khi endpoint đọc báo thiếu quyền. IP whitelist được khuyến nghị. [Authentication](https://github.com/BingX-API/api-ai-skills/blob/main/skills/references/authentication.md).

IP whitelist là **IP public outbound của worker**. Domain web, IP LAN/Docker không thay thế được địa chỉ này. Chưa kiểm tra outbound IP Railway trong lần khảo sát này.

### Cấu hình dự kiến

`.env.example` đã có placeholder sau; connector chưa đọc chúng:

```dotenv
BINGX_AFFILIATE_API_KEY=
BINGX_AFFILIATE_API_SECRET=
BINGX_AFFILIATE_MASTER_UID=
```

Khi triển khai, secret chỉ nằm ở worker. Master UID là agent sở hữu key, không phải khách được mời. Có thể lấy `data.currentAgentUid` từ response roster/commission hợp lệ, đối chiếu portal trước khi cấu hình. [Agent reference](https://github.com/BingX-API/api-ai-skills/blob/main/skills/agent/api-reference.md).

## 2. Kết nối và xác thực

Production `https://open-api.bingx.com`; `.pro` chỉ fallback khi lỗi mạng/timeout, không đổi domain khi lỗi nghiệp vụ. Chưa xác minh VST có dữ liệu Agent phù hợp. [Base URLs](https://github.com/BingX-API/api-ai-skills/blob/main/skills/references/base-urls.md).

GET dùng `X-BX-APIKEY`, `timestamp` milliseconds, `signature` hex HMAC-SHA256. Sắp tham số ASCII, ký giá trị chưa URL-encode, bỏ `signature`; encode khi dựng URL. Reference AI còn yêu cầu `X-SOURCE-KEY: BX-AI-SKILL`: cần kiểm tra yêu cầu với client OpenAPI thực tế; đây không phải mã affiliate. [Authentication](https://github.com/BingX-API/api-ai-skills/blob/main/skills/references/authentication.md).

## 3. Endpoint và dữ liệu lấy được

Các endpoint đều GET có xác thực:

| Path | Mục đích |
| --- | --- |
| `/openApi/agent/v1/account/inviteAccountList` | Roster invitee |
| `/openApi/agent/v2/reward/commissionDataList` | Volume/hoa hồng ngày |
| `/openApi/agent/v1/account/inviteRelationCheck` | Quan hệ UID |
| `/openApi/agent/v1/reward/third/commissionDataList` | Hoa hồng API ngoài referral |
| `/openApi/agent/v1/asset/partnerData` | Thống kê đối tác |
| `/openApi/agent/v1/asset/depositDetailList` | Nạp tiền |
| `/openApi/agent/v1/commissionDataList/referralCode` | Tổng theo mã |
| `/openApi/agent/v1/account/superiorCheck` | Quan hệ cấp trên |

Roster: `pageIndex` từ 1, `pageSize`; thời gian milliseconds, cửa sổ ≤30 ngày; bỏ hai mốc lấy toàn bộ; trên 10.000 dòng dùng `lastUid`. Commission v2: ngày `YYYYMMDD`, ≤30 ngày/cửa sổ, lịch sử 365 ngày, `pageSize` ≤100. Giới hạn phổ biến 20 request/s/UID và 2 request/s/IP. [Agent overview](https://github.com/BingX-API/api-ai-skills/blob/main/skills/agent/SKILL.md).

### Trường dùng cho activity

| Nguồn | Trường |
| --- | --- |
| Roster | `uid`, `InvitationCode` (mã cấp trên), `ownInviteCode` (mã invitee), `directInvitation`, `registerTime` |
| Commission v2 | `uid`, `commissionTime`, `tradingVolume`, `commissionVolume` |

V2 có breakdown Spot, perpetual, standard futures, copy trading, MT5. Volume/commission là string USDT. Thành công `code: 0`; danh sách `data.list`, tổng `data.total`. [Agent reference](https://github.com/BingX-API/api-ai-skills/blob/main/skills/agent/api-reference.md).

**Quy tắc dự kiến của project:** không cộng tổng với breakdown. Giữ `third/commissionDataList` riêng để không trộn giao dịch ngoài referral vào cây mời. Các trường KYC/nạp/tài sản không cần lưu raw activity chỉ để hiển thị volume/hoa hồng.

## 4. Probe GET dự kiến

Mẫu thiết kế, chưa có script BingX trong repo. Thay placeholder, tính chữ ký mới từng request:

```http
GET https://open-api.bingx.com/openApi/agent/v1/account/inviteAccountList?pageIndex=1&pageSize=100&recvWindow=5000&timestamp=<now_ms>&signature=<hex>
X-BX-APIKEY: <private_key>

GET https://open-api.bingx.com/openApi/agent/v2/reward/commissionDataList?endTime=20261008&pageIndex=1&pageSize=100&recvWindow=5000&startTime=20261008&timestamp=<now_ms>&signature=<hex>
X-BX-APIKEY: <private_key>

GET https://open-api.bingx.com/openApi/agent/v1/account/inviteRelationCheck?recvWindow=5000&timestamp=<now_ms>&uid=<known_invitee_uid>&signature=<hex>
X-BX-APIKEY: <private_key>
```

Áp dụng header nguồn theo client đã xác minh ở mục 2. Probe chỉ nên in status/code, số dòng và việc master UID khớp; không in khách hàng/credential. Roster rỗng chưa đủ kết luận quyền đầy đủ hay không có giao dịch: đối chiếu một UID đã biết trên portal và kỳ có hoa hồng.

### Chẩn đoán lỗi

| Code | Kiểm tra |
| --- | --- |
| `100001` | Chữ ký |
| `100413` | Key/header |
| `100419` | IP whitelist |
| `100421` | Đồng hồ/timestamp |
| `100410`, HTTP `429` | Rate limit, backoff |

Đọc cả `msg`; xác minh quyền Agent trước khi đổi quyền key. [Error reference](https://github.com/BingX-API/api-ai-skills/blob/main/skills/references/error-codes.md).

## 5. Mapping vào project

Đề xuất sau khi cập nhật requirements/design:

```text
Worker GET → loại dữ liệu cá nhân → RawLoad/raw_bingx
           → TRANSFORM → ActivityMetricCurrent/history → Referral activity
```

| Dữ liệu sàn | Xử lý dự kiến |
| --- | --- |
| `uid` | UID dạng string |
| Roster `InvitationCode` | Referral code đã đối chiếu; giữ đúng chữ hoa I |
| `tradingVolume` | TRADE_VOLUME, USDT |
| `commissionVolume` | REPORTED_COMMISSION, USDT |
| `commissionTime` | Kỳ sau khi xác minh timezone/đơn vị |

ID kiểu long cần parser giữ chính xác số nguyên lớn ngay từ JSON; đổi sang string sau `JSON.parse` thông thường có thể đã mất chữ số. Dùng decimal cho tiền. Chưa xác minh đơn vị `commissionTime` hoặc timezone ngày hoa hồng, không suy từ timestamp request.

Giống activity MEXC, báo cáo chưa tạo `CommissionRecord` hay cộng ví. Khi thiết kế adapter, phân biệt số 0 thực sự với trường thiếu; roster và metric là hai nguồn khác nhau. Không coi UID vắng một ngày là đã rời cây referral.

## 6. Bằng chứng cần có trước triển khai

- Đọc được một UID đã biết, quan hệ referral đúng, master UID khớp portal.
- Hai ngày liền nhau có volume/hoa hồng khác 0; khớp từng UID và tổng.
- Chốt timezone, ranh giới ngày, ngày chốt, điều chỉnh, độ trễ.
- Lấy đủ page/cursor; limiter chung theo IP cho các job, retry có giới hạn.
- Chạy lại cùng kỳ không cộng dồn; số 0 hiển thị, trường thiếu báo chưa đầy đủ.
- Chốt hợp đồng dữ liệu và bằng chứng commission đủ điều kiện trước luồng payable.
- Cập nhật spec trước connector/scheduler, kiểm thử trên Docker theo rule project.

Đối soát từ [Partner portal](https://agent.bingx.com/). Chưa gọi API bằng credential thật, chưa thay đổi runtime/spec trong lần viết tài liệu này.
