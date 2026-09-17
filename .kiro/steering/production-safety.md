# Production Safety — Bắt buộc xác nhận trước khi thao tác production

> Scope: áp dụng cho mọi phiên làm việc trong workspace này.

## Giai đoạn hiện tại: Pre-golive (dùng DB Railway làm test/dev, chưa có dữ liệu thật)

- **Trạng thái (từ 2026-09-17):** project chưa go-live. DB Railway **hosted** hiện tại (biến `DATABASE_URL`) chỉ chứa dữ liệu seed/fake, KHÔNG có dữ liệu người dùng thật. Người dùng đã xác nhận: agent được dùng thẳng DB này làm test/dev DB (kể cả cho `TEST_DATABASE_URL`, integration test, backup/restore drill) và được thực hiện ghi / DDL / `prisma migrate deploy` / seed / script một lần **mà không cần hỏi xác nhận từng lần**.
- **Luôn là DB Railway hosted, KHÔNG BAO GIỜ dùng DB local.** Không dùng Postgres local (Docker/Postgres.app/service Windows), `localhost`/`127.0.0.1`, cũng không dùng SQLite hay DB thay thế nào khác. Mọi schema/DB test tạm (nếu cần) phải tạo trên chính server Railway Postgres, không tạo local.
- Khi go-live thật (có dữ liệu người dùng), người dùng sẽ xoá và init lại DB từ đầu. Lúc đó mục này bị gỡ bỏ và "Quy tắc mặc định" bên dưới quay lại áp dụng đầy đủ.
- Ngoại lệ này KHÔNG áp dụng cho: xoá toàn bộ database/instance production, thay đổi credential / access control / role, hoặc bất kỳ hành động làm mất khả năng phục hồi dữ liệu mà không có đường rollback rõ ràng — các hành động này vẫn PHẢI hỏi trước.

## Quy tắc mặc định (áp dụng lại sau go-live thật, hoặc khi ngoại lệ trên bị gỡ)

**Production data changes và data deletion là high-risk — PHẢI xin xác nhận của người dùng trước khi thực hiện.**

Cụ thể, các hành động sau đây KHÔNG được tự ý thực hiện mà không có lệnh tường minh từ người dùng:

- Chạy bất kỳ lệnh `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE` trực tiếp trên production database
- Chạy `prisma migrate deploy` trên production (kể cả qua `railway ssh`)
- Chạy `prisma db push` hoặc bất kỳ lệnh DDL nào thay đổi schema production
- Xoá hoặc truncate bảng, index, constraint trên production
- Seed hoặc ghi dữ liệu vào production database
- Chạy script một lần (`*.mjs`, `*.ts`) có ghi vào production DB

## Quy trình đúng (sau go-live thật)

1. Mô tả rõ lệnh sẽ chạy và tác động của nó
2. Chờ người dùng xác nhận tường minh ("OK", "làm đi", "chạy đi", v.v.)
3. Mới thực thi

## Lý do

Agent có `railway ssh` và `DATABASE_URL` production trong workspace. Về mặt kỹ thuật có thể chạy bất kỳ SQL nào. Trong giai đoạn pre-golive, rủi ro này được người dùng chấp nhận có chủ đích (mục "Giai đoạn hiện tại"). Sau go-live, quy tắc xác nhận là lớp bảo vệ chính; kiểm soát kỹ thuật đầy đủ (restricted DB role, CI/CD migrations) được thêm ở Task 19.
