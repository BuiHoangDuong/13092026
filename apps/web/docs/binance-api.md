# Binance API — dữ liệu affiliate cho nền tảng cashback

Ngày cập nhật: **11/10/2026**. Đã có connector Binance GET-only trong worker và màn hình quản trị. Đọc cùng [Bybit](bybit-cashback.md), [MEXC](mexc-referral-activity.md) và [BingX](bingx-api.md).

## 1. Xác định chương trình và lấy key

Binance Link & Trade cần đăng ký và được cấp Link ID. Chưa xác minh API key thông thường có thể đọc toàn bộ khách hàng Referral Pro. Cần Binance xác nhận quyền Api-Agent và phạm vi Spot/Futures. [Hướng dẫn Link ID](https://www.binance.com/en/support/faq/detail/a78a065d0c4846aaa1af474d8e712ab9).

Các endpoint bên dưới lấy từ tài liệu Api-Agent chính thức cũ và đã GET thành công với key hiện tại. Khi đối chiếu, đường dẫn Developer Docs Link & Trade Spot chuyển sang trang mang tên OMS; phạm vi khách affiliate và ý nghĩa dữ liệu vẫn cần xác minh trước khi xuất activity theo UID. [Developer Docs](https://developers.binance.com/en/docs/catalog/vip-and-institutional-link-and-trade/api/rest-api/spot).

1. Đăng nhập tài khoản đối tác → Account → API Management → Create API.
2. Chọn **System generated** để lấy cặp HMAC key/secret.
3. Đặt tên riêng cho worker, hoàn tất xác minh bảo mật, lưu secret riêng tư.
4. Dùng quyền đọc tối thiểu; không bật trading/withdrawal/transfer cho tác vụ này.
5. Whitelist IP public outbound của worker, không dùng domain web hoặc IP nội bộ.

FAQ nêu điều kiện 2FA, KYC và kích hoạt ví Spot bằng khoản nạp. Quyền đọc không tự chứng minh quyền affiliate. [Hướng dẫn tạo API](https://www.binance.com/en/support/faq/detail/360002502072).

### Cấu hình worker

Worker sử dụng hai biến trong `.env` hoặc cấu hình Railway worker:

```dotenv
BINANCE_AFFILIATE_API_KEY=
BINANCE_AFFILIATE_API_SECRET=
```

Secret chỉ nằm ở worker. GET-only không cần master UID/Link ID; không đồng nhất Link ID, UID tài khoản và `customerId`. Root scope được tạo từ fingerprint SHA-256 của API key để tách dữ liệu khi đổi key; không phải UID đã xác minh.

Luồng đã triển khai: admin chọn Binance → worker kiểm tra key read-only → Sync now hoặc Scheduled → GET Spot rebate + USD-M Futures traderSummary theo ngày UTC → lưu slice `raw_binance` đã loại dữ liệu cá nhân → hoàn tất GET-only, hiển thị số dòng fetched. Mảng rỗng là kết quả thành công. Không backfill/reconcile lịch sử tự động; yêu cầu range giới hạn bảy ngày UTC gần nhất. Kết quả chạm limit bị cách ly, không lưu ngày có khả năng thiếu dữ liệu. Key chưa giới hạn IP chỉ tạo cảnh báo.

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

GET-only chưa tạo metric theo UID, `CommissionRecord` hoặc cộng ví. Dữ liệu raw giữ riêng product/asset/unit, tiền dạng chuỗi; bỏ email và customerId dạng email. Mapping và xuất Referral activity là bước tiếp theo sau khi có bằng chứng đối soát. Import commission thủ công vẫn giữ nguyên.

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

Kiểm thử triển khai 11/10/2026: worker build và web typecheck qua trên Docker; unit tests qua (32 pass, 1 fixture riêng tư skip). `scripts/test-binance-sync.mjs` kiểm tra end-to-end admin → job → raw → GET-only completion bằng dữ liệu mẫu, gồm dữ liệu rỗng/có dòng, thay slice, đổi key, tắt backfill/reconcile và không ghi ví. Chạy thêm `--live` trên schema Docker riêng với key thật: thành công, 0 dòng. Schema test được dọn sau kiểm tra; không dùng database Railway cho test.

Đã deploy production 11/10/2026: worker `8844a841-0cd6-4872-be89-3d97dd2c4bba` và web `a4cae153-13d3-49c1-8f24-e68cfaf62938` đều SUCCESS. Kiểm tra chỉ đọc trên worker: Binance supported/configured/ready, không paused; GET thực tế trả 0 Spot và 0 USD-M Futures. Web health OK. Admin tải lại `/admin/ingest/connectors`, chọn Binance rồi Sync now; muốn tự động chạy thì chọn Scheduled và lưu. Lịch hiện giữ disabled theo cấu hình hiện có. Không chạy test suite, migrate thủ công hay script ghi database production để kiểm chứng.
