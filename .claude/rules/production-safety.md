# Production Safety — Bắt buộc xác nhận trước khi thao tác production

> Scope: áp dụng cho mọi phiên làm việc trong workspace này.

## Giai đoạn hiện tại: Pre-golive — test trên Docker mô phỏng Railway (từ 2026-09-27)

- **Test / dev chạy trên Docker, cấu hình giống Railway.** Mọi build, migrate, seed, integration test, backup/restore drill và thử nghiệm dữ liệu do agent chạy đều dùng stack Docker trong `infra/docker-compose.yml`. Stack này mô phỏng đúng Railway: Postgres 18.6 (Debian), `TimeZone=Etc/UTC`, `max_connections=500`, DB `railway`, host nội bộ `postgres`; web và worker build/start bằng đúng lệnh Railway (`.railway/railway.ts`), web chạy `db:migrate` trước khi start và healthcheck `/api/health`. Trên stack Docker, agent được ghi / DDL / migrate / seed / reset **không cần hỏi từng lần**.
- **Không dùng DB thay thế khác:** không Postgres cài trực tiếp trên máy (scoop/Postgres.app/service Windows, cluster tạm), không SQLite, không bản Postgres khác version với Railway. Nếu Docker không chạy được: dừng và báo người dùng, không tự chuyển sang DB khác và không tự chuyển sang Railway.
- **Railway chỉ dùng khi người dùng yêu cầu tường minh**, và chỉ để **debug** (log, status, kết nối, cấu hình) hoặc **truy xuất dữ liệu** (đọc). Agent KHÔNG tự chạy test suite, migrate, seed, script một lần, `railway config apply` hay bất kỳ lệnh ghi nào lên Railway, kể cả khi DB Railway hiện chỉ có dữ liệu seed/fake. Khi được yêu cầu ghi lên Railway: mô tả lệnh và tác động, chờ xác nhận, chỉ chạy đúng lệnh đã duyệt.
- Việc Railway tự chạy `pnpm --filter @cashback/db db:migrate` trong `preDeploy` khi người dùng deploy là quy trình deploy của người dùng, không phải thao tác của agent.
- Khi go-live thật (có dữ liệu người dùng), người dùng sẽ xoá và init lại DB từ đầu; "Quy tắc mặc định" bên dưới áp dụng đầy đủ cho Railway production.
- Luôn PHẢI hỏi trước (kể cả trên Docker nếu ảnh hưởng ngoài stack test): xoá toàn bộ database/instance, thay đổi credential / access control / role, hoặc hành động làm mất khả năng phục hồi dữ liệu mà không có đường rollback rõ ràng.

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

Agent có `railway ssh`, Railway CLI và `DATABASE_URL` Railway trong workspace. Về mặt kỹ thuật có thể chạy bất kỳ SQL nào. Vì vậy mọi việc test chạy trên Docker, còn Railway chỉ được chạm tới khi người dùng yêu cầu (mục "Giai đoạn hiện tại"). Sau go-live, quy tắc xác nhận là lớp bảo vệ chính; kiểm soát kỹ thuật đầy đủ (restricted DB role, CI/CD migrations) được thêm ở Task 19.
