# Binance API — dữ liệu affiliate cho nền tảng cashback

Ngày đối chiếu: **09/10/2026**. Tài liệu khảo sát, chưa có connector Binance trong worker. Đọc cùng [Bybit](bybit-cashback.md), [MEXC](mexc-referral-activity.md) và [BingX](bingx-api.md).

## 1. Xác định chương trình và lấy key

Binance Link & Trade cần đăng ký và được cấp Link ID. Chưa xác minh API key thông thường có thể đọc toàn bộ khách hàng Referral Pro. Cần Binance xác nhận quyền Api-Agent và phạm vi Spot/Futures. [Hướng dẫn Link ID](https://www.binance.com/en/support/faq/detail/a78a065d0c4846aaa1af474d8e712ab9).

Các endpoint bên dưới lấy từ tài liệu Api-Agent chính thức cũ. Khi đối chiếu, đường dẫn Developer Docs Link & Trade Spot chuyển sang trang mang tên OMS; cần Binance xác nhận tài liệu áp dụng trước khi implement. [Developer Docs](https://developers.binance.com/en/docs/catalog/vip-and-institutional-link-and-trade/api/rest-api/spot).

1. Đăng nhập tài khoản đối tác → Account → API Management → Create API.
2. Chọn **System generated** để lấy cặp HMAC key/secret.
3. Đặt tên riêng cho worker, hoàn tất xác minh bảo mật, lưu secret riêng tư.
4. Dùng quyền đọc tối thiểu; không bật trading/withdrawal/transfer cho tác vụ này.
5. Whitelist IP public outbound của worker, không dùng domain web hoặc IP nội bộ.

FAQ nêu điều kiện 2FA, KYC và kích hoạt ví Spot bằng khoản nạp. Quyền đọc không tự chứng minh quyền affiliate. [Hướng dẫn tạo API](https://www.binance.com/en/support/faq/detail/360002502072).

### Cấu hình dự kiến

Đã chuẩn bị các biến trống trong `.env` và `.env.example` để điền cặp key HMAC của tài khoản Binance. Các biến này **chưa được connector sử dụng**:

```dotenv
BINANCE_AFFILIATE_API_KEY=
BINANCE_AFFILIATE_API_SECRET=
```

Khi triển khai, secret chỉ nằm ở worker. Chưa chốt biến master UID/Link ID; không đồng nhất Link ID, UID tài khoản và `customerId`.

Trạng thái 11/10/2026: đã gọi GET thật bằng credential trong `.env` từ máy local. Key được chấp nhận; hai endpoint affiliate trả HTTP 200 nhưng dữ liệu rỗng, nên chưa xác minh được phạm vi chương trình và mapping `customerId` ↔ UID. Chưa triển khai/bật lịch sync Binance.

## 2. Kết nối và xác thực

Với key HMAC: header `X-MBX-APIKEY`; query có `timestamp` milliseconds, `recvWindow=5000`, `signature`. Ký HMAC-SHA256 bằng secret trên đúng query gửi đi, loại `signature`, xuất hex. GET truyền tham số trong URL. Đồng bộ đồng hồ; không log credential hoặc URL có chữ ký. HTTP 429 cần backoff theo `Retry-After`; không tiếp tục retry khi IP bị chặn. [Request security và limits](https://developers.binance.com/en/docs/products/spot/rest-api).

## 3. Endpoint và dữ liệu lấy được

### Spot Api-Agent

Base `https://api.binance.com`. GET dành cho broker:

| Path | Dữ liệu |
| --- | --- |
| `/sapi/v1/apiReferral/customization` | `customerId`, `email`; lọc customerId hoặc email |
| `/sapi/v1/apiReferral/rebate/recentRecord` | `customerId`, `income`, `asset`, `symbol`, `time`, `orderId`, `tradeId` |

Rebate dùng `startTime`/`endTime` milliseconds, gửi cả hai hoặc bỏ cả hai; tối đa 7 ngày/cửa sổ, mặc định 7 ngày gần nhất; `limit` ≤500. Không có page/cursor được mô tả. `income` theo `asset`, không có volume. `kickback/recentRecord` là khoản của trader, không thay báo cáo broker. [Spot reference](https://binance-docs.github.io/apiAgent-API-EN/api_rebate_endpoints_spot_EN/).

**Quy tắc dự kiến của project:** đủ 500 dòng thì coi khả năng bị cắt dữ liệu là chưa giải quyết. Chia nhỏ cửa sổ và đối chiếu tổng; không tăng timestamp để bỏ qua dòng cùng thời điểm. Giới hạn 7 ngày/cửa sổ không chứng minh retention toàn bộ lịch sử.

### Futures Api-Agent

Base theo reference `https://fapi.binance.com`.

| GET path | Dữ liệu |
| --- | --- |
| `/fapi/v1/apiReferral/traderSummary` | Theo `customerId`: `unit`, `tradeVol`, `rebateVol`, `time` |
| `/fapi/v1/apiReferral/overview` | Tổng broker |
| `/fapi/v1/apiReferral/tradeVol` | Volume tổng |
| `/fapi/v1/apiReferral/rebateVol` | Rebate tổng |
| `/fapi/v1/apiReferral/traderNum` | Khách mới/cũ |

`traderSummary`: tùy chọn `customerId`, `startTime`, `endTime`; `type=1` USDⓈ-M, `type=2` COIN-M; `limit` mặc định 500, tối đa 1000; weight 100. Không mô tả page/cursor cho endpoint này. [Futures reference](https://binance-docs.github.io/apiAgent-API-EN/api_rebate_endpoints_futures_EN/).

**Quy tắc dự kiến của project:** giữ `unit`, không mặc định USDT. Aggregate chỉ đối soát, không gán cho từng UID. Không dùng dòng `COMMISSION` trong income tài khoản làm hoa hồng affiliate của khách.

## 4. Probe GET

Script `scripts/probe-binance-affiliate.mjs` đọc `.env`, đồng bộ timestamp theo đồng hồ Binance, kiểm tra quyền key và hai endpoint dữ liệu affiliate bằng GET. Chạy `node scripts/probe-binance-affiliate.mjs --days=7` để kiểm tra 7 ngày gần nhất; mặc định 1 ngày. Script chỉ in trạng thái, các quyền boolean, số dòng và tên trường đã cho phép; không in key, secret, URL đã ký hay dữ liệu khách hàng. Dừng các request còn lại khi nhận HTTP 418/429, không tự retry.

Mẫu request để đối chiếu (placeholder, không phải credential thật):

```http
GET https://api.binance.com/sapi/v1/apiReferral/customization?customerId=<known_customer_id>&recvWindow=5000&timestamp=<now_ms>&signature=<hex>
X-MBX-APIKEY: <private_key>

GET https://api.binance.com/sapi/v1/apiReferral/rebate/recentRecord?startTime=<from_ms>&endTime=<to_ms>&limit=500&recvWindow=5000&timestamp=<now_ms>&signature=<hex>
X-MBX-APIKEY: <private_key>

GET https://fapi.binance.com/fapi/v1/apiReferral/traderSummary?type=1&limit=1000&recvWindow=5000&timestamp=<now_ms>&signature=<hex>
X-MBX-APIKEY: <private_key>
```

Probe chỉ nên báo status, mã lỗi, số dòng và các trường có mặt. Không in khách hàng. Phân biệt lỗi chữ ký/đồng hồ/IP với lỗi quyền chương trình; kết quả rỗng không đủ chứng minh phạm vi truy cập đúng.

## 5. Mapping vào project

Đề xuất sau khi cập nhật requirements/design:

```text
Worker GET → loại dữ liệu cá nhân → RawLoad/raw_binance
           → TRANSFORM → ActivityMetricCurrent/history → Referral activity
```

| Dữ liệu sàn | Xử lý dự kiến |
| --- | --- |
| `customerId` | Cần mapping đã kiểm chứng sang UID Binance |
| `tradeVol` + `unit` | TRADE_VOLUME sau khi xác minh kỳ/đơn vị |
| `income` + `asset`, hoặc `rebateVol` + `unit` | REPORTED_COMMISSION; giữ nguồn/sản phẩm riêng |
| `email` | Không dùng làm UID, loại khỏi raw activity |

Không mặc định `customerId` là UID: mẫu reference có định danh tùy biến và email che. Chưa có mapping thì giữ ở vùng đối soát, chưa hiển thị theo UID. Giữ ID dạng string, tiền dạng decimal; không suy volume từ commission hoặc cộng aggregate vào chi tiết.

Giống activity MEXC, dữ liệu chưa tạo `CommissionRecord` hoặc cộng ví. Binance vẫn manual theo spec hiện tại cho đến khi bằng chứng tích hợp được chốt.

## 6. Bằng chứng cần có trước triển khai

- Quyền đúng chương trình; đọc được một khách đã biết trên portal.
- Mapping `customerId` ↔ UID thật và kiểm soát xung đột.
- Hai kỳ liền nhau có volume/hoa hồng khác 0; khớp từng khách và tổng.
- Chốt timezone, ý nghĩa `time`, đơn vị, ngày phân bổ/chốt, điều chỉnh.
- Lấy đủ dữ liệu khi chạm limit; khóa ổn định để chạy lại không nhân đôi.
- Phân biệt referral thông thường với giao dịch thuộc Link ID.
- Chốt hợp đồng dữ liệu, cập nhật spec trước code, kiểm thử trên Docker.

Nếu quyền API chưa được xác nhận, dùng portal làm bằng chứng khảo sát. [Referral Pro dashboard](https://www.binance.com/en/blog/vip/4657076685156899941).

### Kết quả probe 11/10/2026

| Kiểm tra | Kết quả |
| --- | --- |
| `/sapi/v1/account/apiRestrictions` | HTTP 200; `enableReading=true`, `ipRestrict=false`; các quyền Spot/Margin trading, Futures, withdrawal, internal/universal transfer và Margin đều false |
| Spot `/sapi/v1/apiReferral/rebate/recentRecord` | HTTP 200; 0 dòng ở cả cửa sổ 1 ngày và 7 ngày |
| Futures `/fapi/v1/apiReferral/traderSummary`, `type=1` | HTTP 200; 0 dòng ở cả cửa sổ 1 ngày và 7 ngày |

Kết quả chứng minh credential và chữ ký được chấp nhận từ máy local, chưa chứng minh đọc được khách hàng của Referral Pro/Link & Trade. Chưa có dòng dữ liệu để đối soát UID, đơn vị, timezone hoặc hoa hồng. Key hiện chưa giới hạn IP; quyền truy cập từ worker khi triển khai cần kiểm tra riêng. Probe không ghi database, không thay đổi quyền key và không bật lịch sync.
