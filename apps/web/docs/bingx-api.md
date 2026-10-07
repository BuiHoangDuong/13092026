# BingX API — ghi chú cho nền tảng cashback

Ngày đối chiếu: **07/10/2026**. Đây là tài liệu khảo sát; connector BingX chưa được triển khai trong dự án.

## Nguồn chính thức

- [BingX API Docs](https://bingx-api.github.io/docs/).
- [Authentication](https://github.com/BingX-API/api-ai-skills/blob/main/skills/references/authentication.md).
- [Agent overview](https://github.com/BingX-API/api-ai-skills/blob/main/skills/agent/SKILL.md) và [Agent API reference](https://github.com/BingX-API/api-ai-skills/blob/main/skills/agent/api-reference.md).
- [Base URLs](https://github.com/BingX-API/api-ai-skills/blob/main/skills/references/base-urls.md).
- [Error codes](https://github.com/BingX-API/api-ai-skills/blob/main/skills/references/error-codes.md).

Đã đối chiếu thêm qua Context7 `/bingx-api/docs`: tạo key, quyền mặc định và API restrictions. Context7 chưa trả được tài liệu Agent; phần này dùng reference chính thức ở trên.

## Tạo key và địa chỉ IP

Tạo tại [API Management](https://bingx.com/en/accounts/api). Key mới mặc định **read-only**. BingX khuyến nghị IP whitelist; tài liệu Authentication không nêu IP là điều kiện bắt buộc chung để tạo key. Nếu giao diện bắt nhập IP, cần kiểm tra loại key và quyền đang chọn. Chưa xác minh riêng quy định quyền rút tiền hoặc thời hạn key.

Khi whitelist, dùng **IP public outbound của server gọi API**. Với dự án này cần xác định IP của worker; domain web và IP nội bộ không thay thế được IP outbound. Chưa kiểm tra IP Railway trong lần khảo sát này.

Đề xuất cho cashback: key của tài khoản affiliate/agent, quyền đọc tối thiểu, secret chỉ ở worker. Chưa xác minh quyền Agent thực tế bằng credential.

Đã chuẩn bị biến trống trong `.env` và `.env.example`: `BINGX_AFFILIATE_API_KEY`, `BINGX_AFFILIATE_API_SECRET`, `BINGX_AFFILIATE_MASTER_UID` (UID tài khoản affiliate/agent). Đây là tên cấu hình dự kiến của dự án; hiện chưa có connector đọc các biến này.

## Kết nối và xác thực

Production: `https://open-api.bingx.com`; fallback `https://open-api.bingx.pro` khi lỗi mạng/timeout, không chuyển domain khi API trả lỗi nghiệp vụ. Môi trường VST: `https://open-api-vst.bingx.com`; chưa xác minh có dữ liệu Agent để thử nghiệm. [Nguồn base URLs](https://github.com/BingX-API/api-ai-skills/blob/main/skills/references/base-urls.md).

Request có `X-BX-APIKEY`, `timestamp` (milliseconds), `signature` HMAC-SHA256 dạng hex. Sắp tham số theo ASCII, ký chuỗi giá trị chưa encode, loại `signature`. Reference AI hiện còn yêu cầu `X-SOURCE-KEY: BX-AI-SKILL`. [Nguồn xác thực](https://github.com/BingX-API/api-ai-skills/blob/main/skills/references/authentication.md).

Có thể kiểm tra `ipRestrict` và `enableReading` bằng `GET /openApi/v1/account/apiRestrictions`. [Nguồn account API, đối chiếu qua Context7](https://github.com/bingx-api/docs/blob/main/_autodocs/api-reference/16-common-account-wallet.md).

## Agent API cần đọc

Các endpoint dưới đây dùng **GET**, có xác thực. [Nguồn Agent overview](https://github.com/BingX-API/api-ai-skills/blob/main/skills/agent/SKILL.md).

| Endpoint | Mục đích |
| --- | --- |
| `/openApi/agent/v1/account/inviteAccountList` | Danh sách invitee |
| `/openApi/agent/v1/account/inviteRelationCheck` | Kiểm tra quan hệ theo UID |
| `/openApi/agent/v2/reward/commissionDataList` | Hoa hồng ngày theo invitee |
| `/openApi/agent/v1/reward/third/commissionDataList` | Hoa hồng giao dịch API ngoài quan hệ mời |
| `/openApi/agent/v1/asset/partnerData` | Dữ liệu đối tác |
| `/openApi/agent/v1/asset/depositDetailList` | Chi tiết nạp của invitee |
| `/openApi/agent/v1/commissionDataList/referralCode` | Tổng hợp theo mã mời |
| `/openApi/agent/v1/account/superiorCheck` | Kiểm tra quan hệ cấp trên |

### Tham số và dữ liệu quan trọng

| API | Ghi chú |
| --- | --- |
| `inviteAccountList` | `pageIndex`, `pageSize`; thời gian milliseconds, tối đa 30 ngày; bỏ cả hai mốc để lấy toàn bộ. Trên 10.000 bản ghi dùng `lastUid`. |
| `commissionDataList` v2 | `startTime`, `endTime`: `YYYYMMDD`; tối đa 30 ngày/lượt, lịch sử 365 ngày; `pageSize` ≤ 100. |
| `inviteRelationCheck` | Bắt buộc `uid`; đọc `inviteResult`, `directInvitation`. |

V2 trả `uid`, `commissionTime`, `tradingVolume`, `commissionVolume` cùng breakdown theo sản phẩm. Giá trị tiền là string, đơn vị USDT. Response: `{ code, msg, data }`; thành công `code: 0`, danh sách ở `data.list`. Giới hạn các endpoint Agent: **20 request/s/UID, 2 request/s/IP**. [Nguồn Agent reference](https://github.com/BingX-API/api-ai-skills/blob/main/skills/agent/api-reference.md).

## Xử lý lỗi

| Code | Kiểm tra |
| --- | --- |
| `100001` | Chữ ký |
| `100413` | Key/header |
| `100419` | IP ngoài whitelist |
| `100421` | Timestamp, đồng hồ |
| `100410`, HTTP `429` | Rate limit |

Code có thể khác nghĩa theo nhóm API; cần đọc cả `msg`. [Nguồn error codes](https://github.com/BingX-API/api-ai-skills/blob/main/skills/references/error-codes.md).

## Điểm cần chốt trước tích hợp

Đề xuất theo kiến trúc hiện tại của dự án:

- Probe GET để xác minh quyền Agent; kết quả rỗng không chứng minh đầy đủ quyền.
- Giữ UID dưới dạng string, tiền dưới dạng decimal; loại trường cá nhân không cần thiết trước khi lưu raw.
- Chia kỳ, phân trang đầy đủ, giới hạn tốc độ chung theo IP và retry có backoff.
- Đối chiếu một ngày có hoa hồng với portal/export: timezone, ranh giới ngày, ngày chốt và điều chỉnh chưa được xác minh.
- Dữ liệu activity và hoa hồng báo cáo cần qua quy trình kiểm chứng của dự án trước khi ghi nhận số dư cashback. Không tự cộng ví chỉ vì API có `commissionVolume`.

Chưa gọi API bằng key thật, chưa thay đổi spec hoặc hành vi hệ thống.
