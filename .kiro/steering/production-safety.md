# Production Safety — Bắt buộc xác nhận trước khi thao tác production

> Scope: áp dụng cho mọi phiên làm việc trong workspace này.

## Quy tắc bắt buộc

**Production data changes và data deletion là high-risk — PHẢI xin xác nhận của người dùng trước khi thực hiện.**

Cụ thể, các hành động sau đây KHÔNG được tự ý thực hiện mà không có lệnh tường minh từ người dùng:

- Chạy bất kỳ lệnh `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE` trực tiếp trên production database
- Chạy `prisma migrate deploy` trên production (kể cả qua `railway ssh`)
- Chạy `prisma db push` hoặc bất kỳ lệnh DDL nào thay đổi schema production
- Xoá hoặc truncate bảng, index, constraint trên production
- Seed hoặc ghi dữ liệu vào production database
- Chạy script một lần (`*.mjs`, `*.ts`) có ghi vào production DB

## Quy trình đúng

1. Mô tả rõ lệnh sẽ chạy và tác động của nó
2. Chờ người dùng xác nhận tường minh ("OK", "làm đi", "chạy đi", v.v.)
3. Mới thực thi

## Lý do

Agent có `railway ssh` và `DATABASE_URL` production trong workspace. Về mặt kỹ thuật có thể chạy bất kỳ SQL nào. Kiểm soát kỹ thuật đầy đủ (restricted DB role, CI/CD migrations) sẽ được thêm ở Task 19. Cho đến lúc đó, quy tắc này là lớp bảo vệ chính.
