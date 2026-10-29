# Chi trả USDT tới UID sàn — khảo sát API

Ngày đối chiếu: 2026-10-17. Câu 1 đã chốt: MEXC và Bybit, trả USDT nội bộ; Binance bổ sung sau khi có dữ liệu và đáp ứng các điều kiện chi trả. Mỗi sàn dùng một tài khoản nguồn riêng do operator cung cấp, có thể khác tài khoản affiliate đang ingest. Chưa cấu hình key, chưa gọi API có tác động tiền, chưa xác minh tài khoản nguồn thực tế.

## Phân biệt các bước xác minh

Xác minh tài khoản/KYC, tạo key, whitelist IP, thêm/xác minh người nhận lần đầu và xác nhận từng lần chuyển là các bước khác nhau. API không có tham số OTP chưa chứng minh tài khoản cụ thể sẽ không gặp risk control/hold. Không dùng luồng web/app nội bộ hoặc tự đọc email/TOTP để lách xác minh. Nếu cần thao tác người dùng, giữ UNPAID + VERIFICATION_REQUIRED/RECIPIENT_SETUP_REQUIRED; nếu đã có thể gửi thì UNKNOWN và đối soát.

## MEXC

[Internal Transfer Spot v3](https://www.mexc.com/api-docs/spot-v3/wallet-endpoints/internal-transfer): POST `/api/v3/capital/transfer/internal`, `toAccountType=UID`, `toAccount=<UID nhận>`, asset/amount/timestamp/signature; quyền SPOT_WITHDRAW_WRITE. Contract không liệt kê mã email/SMS/TOTP hay client idempotency key. **Suy luận:** phù hợp gọi từ backend không nhập OTP trong payload; quyền key, whitelist/contact và hành vi tài khoản thực vẫn chưa xác minh.

[History](https://www.mexc.com/api-docs/spot-v3/wallet-endpoints/query-internal-transfer-history) dùng GET cùng path với quyền SPOT_WITHDRAW_READ, có tranId và SUCCESS/FAILED/WAIT. Không retry tạo transfer mới sau timeout khi chưa biết tranId/outcome; history trùng UID/amount/time không tự chứng minh đó là giao dịch của command đang khôi phục.

[Thông báo API withdrawal năm 2023](https://www.mexc.com/announcements/article/mexc-withdrawal-feature-optimization-17327472571161) nói default whitelist cho API withdrawal; đây là tài liệu cũ về withdrawal, **không đủ để kết luận** quy tắc UID transfer hiện tại. Phải kiểm tra trên account mới; không đề xuất tắt bảo vệ chỉ để tự động hóa.

## Bybit

[V5 Withdraw](https://bybit-exchange.github.io/docs/v5/asset/withdraw): POST `/v5/asset/withdraw/create`, coin=USDT, forceChain=2, address=UID của **một main account Bybit khác**; key của source main account. UID nhận phải được thêm vào address book trước. Có requestId cho idempotency; request không liệt kê trường OTP. **Suy luận:** có thể tự động lệnh cho người nhận đủ điều kiện, không đồng nghĩa onboarding UID mới hoàn toàn tự động.

[Address list](https://bybit-exchange.github.io/docs/v5/asset/withdraw/withdraw-address) cho GET `/v5/asset/withdraw/query-address`, lọc internal transfer, trả status/verified. Chưa tìm thấy endpoint công khai để tự thêm/xác minh UID. Preflight có thể kiểm recipient readiness; không giả lập API website để thêm UID.

[Withdrawal Security](https://www.bybit.com/en/help-center/article/How-to-Manage-Your-Withdrawal-Security) phân biệt xác minh whitelist lúc thiết lập với lần rút sau; các giới hạn/cấu hình bảo vệ có thể vẫn yêu cầu xác minh bổ sung. Hướng dẫn chủ yếu nói địa chỉ ví, không thay thế kiểm chứng UID transfer trên source account thực. Cần test riêng người nhận mới và đã có address book.

## Binance — kênh tương lai có điều kiện

[Batch Payout](https://developers.binance.com/en/docs/products/binance-pay-merchant/api-payout): POST `/binancepay/openapi/payout/transfer`, currency=USDT, receiveType=BINANCE_ID, receiver=Binance user ID; requestId/merchantSendId cho định danh. Đây là **Binance Pay Merchant/Partner**, không suy từ key affiliate/Spot hiện có hoặc customerId chưa mapping.

[Merchant Payout setup](https://merchant.binance.com/en/docs/functionalities/payout) yêu cầu bật Payout cho API key trong merchant platform. ACCEPTED chưa phải chuyển thành công; query/detail/webhook cần xác minh kết quả từng người nhận, không mark cả batch PAID nếu chỉ một số thành công.

[Merchant authentication](https://merchant.binance.com/en/docs/getting-started) mô tả credentials/signature cho backend. **Suy luận:** phù hợp automation sau thiết lập merchant/quyền; chưa kiểm chứng eligibility hay step-up trên account của operator. Không chọn C2C collection/app confirmation làm kênh tự trả, vì đó là luồng khác có xác nhận trong app: [Binance Pay scenarios](https://developers.binance.com/en/docs/products/binance-pay-merchant/introduction).

## Ràng buộc đưa vào spec

- Source account/credential scope riêng từng sàn, khác affiliate ingest; sourceAccountId cố định trên execution/receipt/recovery. Xoay key không đổi nghĩa vụ/UID nhận, đổi source không tự retry lệnh UNKNOWN.
- Phase đầu: cả MEXC và Bybit cùng được hỗ trợ, bật riêng theo readiness tài khoản/kênh/người nhận. Cấu hình hai sàn không bắt buộc bật cùng lúc khi một sàn còn thiếu điều kiện.
- Binance có dữ liệu không tự đủ điều kiện gửi: còn mapping customerId → UID, commission hợp lệ, merchant Payout permission, recipient và source readiness, policy/limits và kiểm chứng theo spec. Khi đủ điều kiện thì đi cùng CustomerPayable/async commands, không có đường tiền riêng.
- Chưa chọn SDK hoặc code signer; hiện chưa có SDK payout trong package manifests. Đã đối chiếu Context7 MEXC Spot v3 và Bybit V5; kết quả truy hồi Context7 chưa bao phủ đầy đủ POST UID MEXC nên kết luận endpoint dựa vào trang API chính thức. Không coi tài liệu là bằng chứng transfer thật thành công.

## Kiểm chứng tài khoản nguồn khi được cấp cấu hình

1. Ghi nhận exchange/site pháp nhân, source UID/main account, ví giữ USDT, key permissions, IP restrictions và trạng thái KYC/withdrawal. Secret cấu hình riêng trong worker, không gửi password/OTP/secret vào chat.
2. Dùng API đọc để kiểm account/balance/history và recipient book khi sàn hỗ trợ; không dùng request chuyển thử để kiểm quyền đọc.
3. Mock toàn bộ state machine/timeout/concurrency trên Docker. Chuyển tiền thật chỉ sau khi chốt UID nhận/số tiền/phạm vi test riêng; account mới có thể có restrictions cần hoàn tất trước.
4. Khi test được phép: phân biệt một UID mới với một UID đã được xác minh; ghi lại lần đầu cần xác minh gì, lần kế tiếp có cần can thiệp không, status/fee/ref và cách đối soát. Không tạo timeout giả trên giao dịch thật hoặc gọi lại send để kiểm idempotency.
5. Nếu phát hiện verification/risk hold, trả kết quả BLOCKED cho auto; không tự tắt whitelist, tự tạo OTP hoặc bỏ qua giới hạn sàn.

## Các điểm chưa chốt

#34 grain/khóa nguồn/mapping còn review; câu 13 đã loại customer withdrawal/partial, chỉ auto chi theo lịch và admin xử lý trên sổ chung. #35 đã chốt phạm vi sàn/tài sản và source accounts riêng. Câu 2 đã chốt: operator chấp nhận thêm/xác minh mỗi UID Bybit một lần; các lần chi sau tự động nếu đủ điều kiện, không yêu cầu lặp thao tác thiết lập cho mỗi lần trả. Quyền API/quy trình onboarding/step-up thực tế, Binance merchant eligibility và mapping vẫn phải xác minh; lựa chọn này không phải bằng chứng tài khoản hay recipient đã sẵn sàng.
