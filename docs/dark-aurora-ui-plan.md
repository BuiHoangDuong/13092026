# Kế hoạch giao diện Dark Aurora — trạng thái hiện hành

Cập nhật **27/10/2026**. Nguồn sự thật: requirements/design của cashback-platform, Req 8/14/19/20 và Task 43. Năm lựa chọn sau cuộc họp 20/10 được ghi trong [kế hoạch tiếp nối](meeting-2026-10-20-implementation-plan.md).

## 1. Giao diện và phạm vi

- Giữ tên **Cashback Hub**, UI tiếng Anh, nền xanh đen/aurora và điểm nhấn cam.
- Giữ hero “Same trades. More coming back.” cùng các số minh họa có nhãn, không gắn với ví thật.
- Thứ tự: hero → Opportunity Check → logo sàn → tra cứu UID → published offers → How it works → ledger minh họa → FAQ/footer.
- Dùng dữ liệu offers/logo/referral đã công bố. Bybit/Binance/MEXC là bộ dữ liệu hiện tại, không hard-code giới hạn hệ thống ở ba sàn hoặc dùng tỷ lệ seed làm cam kết thật.
- Theme public không đổi giao diện admin. Giữ nhiều offer/sàn, empty/unavailable, ledger có nhãn minh họa và reduced motion.

## 2. Calculator theo volume

Công thức tháng: **volume USDT × trading-fee % × affiliate-commission % × offer share**. Kết quả năm = tháng × 12 với giả định không đổi.

- Volume hàng tháng có phân tách hàng nghìn en-US; tối đa 16 chữ số nguyên và 8 chữ số thập phân.
- Khách nhập hai tỷ lệ giả định phí và affiliate, ban đầu rỗng, giới hạn 0–100%. Chưa nhập đủ hoặc input sai thì không có kết quả tiền.
- Share lấy từ published offer cụ thể. Đổi sàn/offer hoặc refresh props không giữ lựa chọn đã bị gỡ.
- Fixed-point BigInt; chỉ round half-up đến 2 chữ số khi hiển thị. Không lấy số tháng đã làm tròn để tính năm.
- Ví dụ để kiểm tra, không phải mặc định: 1.000.000 × 0,1% × 50% × 30% = 150 USDT/tháng, 1.800 USDT/năm.
- Tính trên trình duyệt, không gửi/lưu đầu vào và không ghi ví. Không hứa hoàn lại phí quá khứ; ước tính không là tiền đã nhận.
- Không tiếp tục dùng mô hình đầu vào “monthly trading fees” hoặc commission mặc định 50% của bản UI trước cuộc họp.

## 3. Tra cứu exchange + UID

- Giữ UID là chuỗi, bao gồm số 0 đầu, scope theo đúng sàn. Có loading/no-data/429/error và chặn response cũ sau đổi lựa chọn/unmount.
- Public API/bảng chỉ có kỳ, tài sản, UID, cashback khách được ghi nhận; không commission/rate/volume hoặc bucket ví.
- Hiển thị **tổng thực trả** riêng từ sổ settled, không cộng lại execution/payable vào tổng này.
- Cashback **ngày UTC trước** và **30 ngày kết thúc ngày trước** theo kỳ phát sinh báo cáo đã áp dụng, không theo ngày thanh toán.
- Tổng kỳ đọc toàn bộ bản ghi liên quan, không lấy từ page 100 dòng của bảng.
- Kỳ nhiều ngày nằm trọn cửa sổ cộng nguyên khoản; kỳ cắt biên không thể tách thì báo thiếu chi tiết/null. Không có báo cáo khác với báo cáo 0; không chia đều tiền để giả thành dữ liệu ngày.
- Lookup vẫn chỉ đọc và có IP rate limit trong Postgres. Bộ đếm phút/giờ phải độc lập dù trùng thời điểm bắt đầu.

## 4. Luồng public theo lịch trả UID

- Bỏ Wallet ở header/mobile/footer và bỏ “Verify email and withdraw”.
- `/withdraw` redirect `/#lookup`, không render form OTP/rút.
- POST tạo/hủy withdrawal cũ trả **410 CUSTOMER_WITHDRAWALS_RETIRED** trước đọc body/session/DB; không reserve/enqueue.
- Giữ phân quyền các API private history/OTP và thao tác admin; không xóa lịch sử tiền.
- Copy mô tả trả theo lịch tới UID; holding, approval, nguồn chi và readiness vẫn áp dụng. UI không làm sender thật trở thành sẵn sàng.
- Không thay lịch 23:00 UTC, minimum >0,5 USDT, nhánh <=20/>20, gate, cutover hoặc adapter trong phần layout này.

## 5. Kiểm chứng và bàn giao

Bằng chứng hiện tại và phần còn mở nằm trong [kế hoạch Task 43](meeting-2026-10-20-implementation-plan.md). Không dùng việc hoàn thành mockup/DOM/HTTP để thay visual QA.

- Unit/DOM: bốn thành phần, precision/rounding, giá trị rỗng/sai/0, format nhóm nghìn, đổi offer, ARIA/labels và menu Escape/focus.
- HTTP Docker: public privacy, UID số 0 đầu/nhiều asset, tổng vượt 100 dòng, ngày UTC/kỳ cắt biên, zero/no-data, redirect/410 và tiền/job không đổi.
- UID session: private reads và OTP vẫn đúng phân quyền; khách đã có session cũng không tạo/hủy yêu cầu rút.
- Browser thực: 360/390/768/1024/1440px; không tràn/cắt số/label, menu/focus/keyboard/contrast/reduced motion. Nếu không có browser điều khiển được, giữ mục này mở.
- Test/dev chỉ dùng stack `infra/docker-compose.yml`; không thay bằng Railway hoặc DB cài trên máy. Không chạy worker với credentials/schedule thật để kiểm thử UI.
- Giữ web/Postgres local cho người dùng xem khi stack đã healthy; không khẳng định URL đang chạy nếu chưa kiểm tra lại.

## 6. Phần để sau

Domain/tên mới, tỷ lệ thật/holding, tài khoản/quyền API, sender MEXC/Bybit, backfill/cutover và BingX có điều kiện riêng. Dashboard nhiều UID/email và ví nhận riêng chưa nằm trong Task 43.

Lộ trình nghiệp vụ/vận hành: [remaining-work-plan.md](remaining-work-plan.md). Việc gửi tiền thật cần hoàn tất Task 42 và các gate đã chốt, không suy từ hình ảnh hoặc copy public.
