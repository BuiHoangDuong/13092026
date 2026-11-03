# Kế hoạch tiếp nối sau cuộc họp CashbackHub 20/10/2026

Cập nhật **03/11/2026**. Bước này chỉ cập nhật tài liệu; code calculator theo cấu hình phí từng sàn đã có (Task 44.1), chưa xác nhận browser; thay đổi mới thuộc **Task 45 chưa triển khai/kiểm chứng**. Không deploy hoặc bật chi tiền thật.

## 1. Năm lựa chọn đã chốt

| Nội dung | Quyết định của người dùng | Trạng thái |
|---|---|---|
| Công thức calculator | Tháng = volume giao dịch/tháng × 0.001 × Offer.cashbackRate; năm = tháng × 12 chính xác, chỉ round half-up 2 chữ số ở hiển thị cuối. Bybit 30%, volume 1,000,000 USDT → 300.00 USDT/tháng, 3,600.00 USDT/năm | Chốt 03/11/2026; Task 45 chưa triển khai |
| Đầu vào và nguồn hệ số | Khách chỉ nhập volume mặc định 1,000,000 USDT và nhóm nghìn; phí chung 0.1% trong code cho mọi sàn, không cấu hình admin. Xoá field phí theo sàn khỏi schema/contracts/DTO/form bằng migration mới, giữ nguyên migration đã push. Chỉ hiện tiền nhận, tỷ lệ hoàn ước tính/điều kiện, không phí/hoa hồng; tách rõ preset volume, nút Calculate my opportunity, lỗi và footnote trên mobile, không tràn ngang 360–1440px | Chốt 03/11/2026; Task 45.1–45.4 |
| Kỳ tra cứu | D là ngày UTC gần nhất ≤ hôm qua có ImportBatch COMMISSION/PUBLISHED phủ trọn ngày, chi tiết ngày (batch ≤1 ngày hoặc TRANSACTION), không partial (sourceAsOf null hoặc ≥periodEnd). Ngày D và 30 ngày [D−29,D+1); summaryPeriods { reportDay, rollingStart, end }, null khi chưa D. UID không tồn tại/chưa có cashback attribution → hasData=false, cùng shape rỗng/message no cashback data for this UID under our referral links. Chỉ hasData=true mới có metric: có D mà UID không dòng trong kỳ → REPORTED 0; chưa D → NO_DATA | Spec cập nhật; Task 44.2 chưa làm; sourceTz khác UTC có thể không phủ ngày UTC |
| Bảng public và quyền khách | Chỉ ngày/kỳ, tài sản, UID, cashback; totalPaid=Wallet.withdrawn (payables SETTLED cộng vào đây). Không commission/rate/volume, lịch sử lệnh hoặc bucket ví. Khách không email binding, phiên UID, ví riêng hoặc tự rút; chỉ lookup và nhận chi tự động về UID | Req 15/16 removed; Task 44.3 chưa làm; giữ /withdraw redirect /#lookup, queue admin legacy/payables |
| Báo cáo nhiều ngày | Giữ tổng nguyên kỳ; bản ghi nhiều ngày cắt biên thiếu breakdown → INSUFFICIENT_DETAIL/null, không chia đều/giả 0; quy tắc này ưu tiên hơn zero khi có coverage | Spec cập nhật; Task 44.4 chưa kiểm chứng |

Không hỏi lại các quyết định trên. Giữ policy chi trả: 23:00 UTC, minimum strict >0,5 USDT; tổng <=20 USDT có thể tự trả khi đủ gate, >20 cần duyệt; operator chịu phí. Không thay gate/backfill hoặc bật sender ở bước tài liệu này.

## 2. Đã làm và bằng chứng còn giá trị

| Phần | Trạng thái | Bằng chứng/giới hạn |
|---|---|---|
| Spec mới | Đã cập nhật Bước 1 ngày 30/10 | Requirements → design → tasks, RTM/runbook/kế hoạch; chỉ kiểm tra tài liệu |
| Task 43 | Code đang staged là baseline lịch sử | Công thức hai giả định và kỳ cố định hôm qua đã superseded bởi 44.1/44.2; việc giữ private customer APIs superseded bởi 44.3. Chưa sửa code trong bước này |
| Build/web tests trước đây | Lịch sử: Docker build đạt; web 32/32 PASS | Kết quả Task 43 trước đây không chứng minh target 30/10. Core tests/lint/UID-access trước đây chưa có kết quả hoàn tất |
| Browser QA | Chưa hoàn tất | DOM/HTTP không thay visual/responsive/focus QA |
| Docker | Chưa xác nhận lại | Ngày 22/10 không kết nối được dockerDesktopLinuxEngine; bước tài liệu 30/10 không chạy Docker/DB |
| Production/thực chi | Chưa triển khai | Không deploy/bật sender trong bước này |

## 3. Kế hoạch tiếp tục theo thứ tự

1. **45.1–45.3 — calculator theo quyết định 03/11:** code 44.1 theo cấu hình phí từng sàn đã có nhưng chưa xác nhận browser. Thay bằng phí chung 0.001 trong code, dùng Offer.cashbackRate, giữ mặc định 1,000,000 USDT/grouping; tháng/năm chính xác, half-up ở hiển thị cuối. Xoá field phí khỏi schema/contracts/DTO/form, tạo migration mới idempotent `202611030001_drop_exchange_commission_volume_rate` drop CHECK/cột IF EXISTS; giữ nguyên hai migration 30/10 trên origin/main theo design. Chỉ hiện tiền nhận và tỷ lệ hoàn ước tính/điều kiện; sửa khoảng cách preset volume/nút/lỗi/footnote trên mobile.
2. **44.2 — latest reported day:** helper coverage sàn từ ImportBatch, index `(exchangeId, datasetKind, status, periodEnd)` và migration index; contract summaryPeriods, giữ metric previousDay với nghĩa ngày D; gate hasData chống dò UID trước khi trả metric zero/no-data/insufficient detail theo Req 14, totalPaid không đếm đôi.
3. **44.3 — gỡ xác thực và truy cập khách riêng tư:** bỏ route/service/contract/env/SDK/cookie/guard và UI phụ thuộc; không biến GET private thành public. Giữ redirect /withdraw và retired POST 410 không mutation. Migration dự kiến `202610300002_drop_customer_otp` drop EmailOtp, UidSession, UidAccount.boundEmail/emailBoundAt và phụ thuộc; giữ Withdrawal.email/WithdrawalEvent.email, admin Session, Wallet/UidAccount, lookup rate-limit, queue legacy và payables. Không chạy migration trong Bước 1.
4. **44.4 và 45.4 — kiểm chứng:** calculator mọi sàn cùng phí 0.001, Bybit 30% cho 300.00/3,600.00 với volume 1,000,000; cashbackRate 0/1/4 chữ số, volume invalid precision/nhóm nghìn/mặc định 1,000,000 USDT/chỉnh sửa/năm không nhân từ tháng đã round; lookup D cũ hơn hôm qua, coverage/partial/TRANSACTION/sourceTz/UID lạ và UID chưa cashback cùng hasData=false/no-data shape-message/UID đã attribution nhưng không dòng trong kỳ REPORTED 0/sàn chưa D với hasData=true NO_DATA/kỳ cắt biên/>100 dòng và totalPaid; API đã gỡ không lộ history, retired POST không mutation; admin queue/payables và audit giữ nguyên. Bước triển khai sau mới chạy migration/integration trên schema Docker riêng, typecheck/lint/build, browser desktop/mobile/focus, spacing preset/nút/lỗi/footnote khi có/không lỗi và không tràn ngang 360–1440px; kiểm tra field phí đã xoá và migration mới chạy lại an toàn. Không Railway, không stage/commit/deploy nếu chưa có yêu cầu.
5. Sau Task 44/45, tiếp tục phần còn lại Task 42: dữ liệu và chi trả thật theo từng sàn, xác minh nguồn/quyền/recipient/receipt, backfill/cutover theo spec. Activity/volume không tự trở thành tiền phải trả; chưa bật thực chi chỉ bằng cờ cấu hình.

## 4. Điểm còn mở và phạm vi

- Volume calculator đã chốt mặc định **1,000,000 USDT** theo ví dụ cuộc họp 20/10; có thể chỉnh sau trong code, không còn quyết định mở về con số này.
- Giới hạn đã biết: ngày nguồn khác UTC có thể không phủ trọn ngày UTC. Không cam kết coverage đủ cả 30 ngày chỉ từ ngày D.
- Req 21 on-chain và tên mới vẫn theo các quyết định mở hiện có, không được phê duyệt thêm bởi Task 44. Không có kế hoạch dashboard email/ví riêng trong scope khách hiện hành.
- Bước ngày 03/11 chỉ sửa bốn tài liệu đã chỉ định; code/test/migration không đổi. Code calculator hiện còn lệch quyết định mới cho tới Task 45; chưa có xác nhận runtime/browser trong bước này.

## Changelog

| Ngày | File | Thay đổi | Lý do | Loại (added/updated/removed) |
|---|---|---|---|---|
| 2026-10-30 | meeting-2026-10-20-implementation-plan.md | Đồng bộ bảng quyết định/kế hoạch với gate hasData chống dò UID trước metric theo review Req 14.6 | Review Claude Bước 1 và quyết định người dùng 30/10/2026 | updated |
| 2026-10-30 | meeting-2026-10-20-implementation-plan.md | Chốt volume mặc định 1,000,000 USDT theo ví dụ 20/10; bỏ trạng thái và bước chờ chốt | Review Claude Bước 1 và quyết định người dùng 30/10/2026 | updated |
| 2026-10-30 | meeting-2026-10-20-implementation-plan.md | Thay năm lựa chọn theo volume-only, ngày báo cáo D và gỡ truy cập riêng tư khách; ghi trạng thái Task 44 chưa làm | Quyết định người dùng 30/10/2026 | updated |
| 2026-10-30 | meeting-2026-10-20-implementation-plan.md | Thay kế hoạch tiếp nối cũ bằng 44.1–44.4; giữ bằng chứng Task 43 như lịch sử, ghi migration dự kiến và con số mặc định còn mở | Spec trước code, không dùng PASS cũ thay kiểm chứng mới | updated |
| 2026-11-03 | meeting-2026-10-20-implementation-plan.md | Đính chính công thức/nguồn hệ số và kế hoạch tiếp nối sang Task 45; ghi code 44.1 đã có, browser chưa xác nhận; giữ nguyên migration lịch sử | Người dùng chốt phí chung 0.1%, khách chỉ thấy tiền nhận; sửa spacing mobile | updated/removed |
